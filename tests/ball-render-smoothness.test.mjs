// Rendered ball smoothness across a deflect ("the ball used to feel smoother").
// G2 (_resolveFrameContacts) steps the ball to the frame end B, then puts it
// back on the in-frame contact point C for the deflect. Before the follow-
// through the mesh and trail had already been drawn at B, so every deflect
// rendered past the contact (up to a frame of travel: 2.2 m at 129 u/s, 60 Hz),
// snapped back the next frame, dropped (1 − s)·dt of travel (a frame-rate
// dependent lag), and a PERFECT hit-stop froze the whole world with the ball
// hanging past the contact. Measured in the browser (solo, 3 × 45 s rallies):
// mesh ≠ physics on 116 frames (max 2.24 m), 26 speed pops, post-deflect
// kink p50 0.40 (pre-G2 0.006), 48 frozen frames per 135 s at 60 Hz.
//
// Runs the real Ball.update + Ball.continueFromContact + Game._resolveFrameContacts
// + Game._followThroughDeflect (compiled from js/game.js) and the real Juice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

import { SimPlayer, createContactGame } from './frame-contact-sim.mjs';
import { extractGameMethod } from './game-source.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
const threeUrl = new URL('three.module.js', vendor).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});
const THREE = await import(threeUrl);
const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const { Ball } = await import(`data:text/javascript;base64,${Buffer.from(ballSource
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }')
).toString('base64')}`);
const { Juice } = await import('../js/juice.js');

const arena = {
    bounds: { minX: -80, maxX: 80, minY: 0, minZ: -80, maxZ: 80, maxY: 40 },
    ceilingHeight: 0, config: {}, collidables: [],
    getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
};

function makeBall() {
    const material = () => new THREE.ShaderMaterial({ uniforms: {
        uColor: { value: new THREE.Color() }, uTexture: { value: null },
        uTextureEnabled: { value: false }, uRimPower: { value: 5 }
    } });
    const ball = new Ball({ scene: new THREE.Scene(), createToonMaterial: material, createOutlineMesh: g => new THREE.Mesh(g), _quality: 'low' }, arena);
    ball.spawn();
    ball._noHitTimer = 0;
    ball.maxSpeed = Infinity;
    // No gravity: a slow ball would reach the floor, and a bounce is a real
    // (wanted) kink that is not what these tests measure.
    ball.gravity = 0;
    return ball;
}

// Far-away receiver of the return shot (never reached inside the window).
const receiver = { position: new THREE.Vector3(60, 0, 0), alive: true, team: 'red' };
receiver.getPosition = () => new THREE.Vector3(receiver.position.x, receiver.position.y + 1.2, receiver.position.z);

// One approach along −x at the local player (origin, always swinging and
// facing): the handler returns the ball straight back at `speed`. Records the
// rendered mesh per frame, the contact point and the wall time of the contact.
function rally({ speed, fps, offset = 0, followThrough = true, seconds = 0.9 }) {
    const dt = 1 / fps;
    const ball = makeBall();
    const player = new SimPlayer({ team: 'blue' });
    player.attacking = true;
    player._swingLiveWindow = 10;
    player.swingAge = 1;
    ball.position.set(14 + offset, 1.25, 0);
    ball.velocity.set(-speed, 0, 0);
    ball.currentSpeed = speed;
    ball.state = 'rally';
    ball.aimed = false;
    ball.targetPlayer = player;
    ball._prevPosition = ball.position.clone();
    ball.clearTrail();
    const game = createContactGame({ player, ball, throwerTeam: 'red' });
    let contact = null;
    let contactTime = null;
    let frameStart = 0;
    game.handlePlayerDeflection = function () {
        contact = ball.position.clone();
        contactTime = frameStart + this._deflectContactOffset;
        const aim = new THREE.Vector3().subVectors(receiver.getPosition(), contact).normalize();
        ball.deflectWithAim(contact.clone(), aim, receiver);
        ball.currentSpeed = speed;
        ball._clampSpeed();
        this.lastDeflectorTeam = player.team;
        player.attacking = false;
        return true;
    };
    game.handleHit = () => { throw new Error('unexpected body hit'); };
    if (!followThrough) game._followThroughDeflect = () => 'deflect';
    const frames = [];
    let deflectFrame = -1;
    let trailSpur = 0;
    for (let frame = 0; frame * dt < seconds; frame++) {
        frameStart = frame * dt;
        ball.update(dt);
        const result = game._resolveFrameContacts(dt, true, false);
        if (result === 'deflect') {
            deflectFrame = frame;
            // Trail drawn past the contact along the approach heading (−x).
            for (const dot of ball.trail) trailSpur = Math.max(trailSpur, contact.x - dot.mesh.position.x);
        }
        frames.push({ t: frameStart + dt, mesh: ball.mesh.position.clone(), pos: ball.position.clone() });
    }
    return { frames, contact, contactTime, deflectFrame, dt, trailSpur };
}

// Rendered position at wall time t (linear between rendered frames).
function renderedAt(run, t) {
    const { frames } = run;
    for (let i = 1; i < frames.length; i++) {
        if (frames[i].t >= t) {
            const a = frames[i - 1], b = frames[i];
            return new THREE.Vector3().lerpVectors(a.mesh, b.mesh, (t - a.t) / (b.t - a.t));
        }
    }
    return frames[frames.length - 1].mesh.clone();
}

function deflectMetrics(run, speed) {
    const { frames, deflectFrame: k, contact, dt } = run;
    assert.ok(k > 0, 'the ball was deflected');
    // What the player sees at the end of every frame is the physics state.
    const meshLag = Math.max(...frames.map(f => f.mesh.distanceTo(f.pos)));
    // Rendered path through the contact: A(k−1) → C → mesh(k) must be the
    // travel of one frame (s·v on the way in + (1 − s)·v on the way out).
    const a = frames[k - 1].mesh;
    const drawn = frames[k].mesh;
    const overshoot = Math.max(0, contact.x - drawn.x); // approach runs along −x
    const pathExcess = (a.distanceTo(contact) + contact.distanceTo(drawn)) / (speed * dt) - 1;
    // Largest single rendered step, in frames of travel.
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++) maxStep = Math.max(maxStep, frames[i].mesh.distanceTo(frames[i - 1].mesh) / (speed * dt));
    return { meshLag, overshoot, pathExcess, maxStep };
}

const SPEEDS = [17, 51, 129, 177];
const RATES = [30, 60, 144];

test('deflect frame: mesh never drawn past the contact, one frame of travel, no snap back (30/60/144 Hz, 17–177 u/s)', () => {
    let worstBefore = 0;
    for (const speed of SPEEDS) {
        for (const fps of RATES) {
            for (const offset of [0, 0.13, 0.29, 0.41]) {
                const run = rally({ speed, fps, offset });
                const m = deflectMetrics(run, speed);
                const label = `${speed} u/s ${fps} Hz offset ${offset}`;
                assert.ok(m.meshLag < 1e-9, `${label}: mesh ${m.meshLag} m off the physics ball`);
                assert.ok(m.overshoot < 1e-6, `${label}: drawn ${m.overshoot} m past the contact`);
                assert.ok(Math.abs(m.pathExcess) < 0.02, `${label}: deflect-frame path ${m.pathExcess} frames off`);
                assert.ok(m.maxStep < 1.02, `${label}: rendered step ${m.maxStep} frames of travel`);
                assert.ok(run.trailSpur < 1e-6, `${label}: trail drawn ${run.trailSpur} m past the contact`);
                const before = rally({ speed, fps, offset, followThrough: false });
                worstBefore = Math.max(worstBefore, deflectMetrics(before, speed).maxStep);
            }
        }
    }
    // The pre-fix path (contact resolution without follow-through) does snap.
    assert.ok(worstBefore > 1.5, `pre-fix rendered step ${worstBefore}`);
});

test('no travel lost at a deflect: the return flight is frame-rate independent', () => {
    // Along-track distance flown 0.25 s after the (in-frame) contact, measured
    // from that contact, vs a 480 Hz reference (17 u/s is left out: aimed
    // steering's own low-speed tick quantization is ±0.25 m there either way).
    const flown = run => renderedAt(run, run.contactTime + 0.25).x - run.contact.x;
    let worstAfter = 0;
    let worstBefore = 0;
    for (const speed of [51, 129, 177]) {
        for (const offset of [0, 0.21, 0.37]) {
            const reference = flown(rally({ speed, fps: 480, offset }));
            for (const fps of RATES) {
                const error = Math.abs(flown(rally({ speed, fps, offset })) - reference);
                assert.ok(error < 0.01, `${speed} u/s ${fps} Hz: ${error.toFixed(3)} m off the continuous flight`);
                worstAfter = Math.max(worstAfter, error);
                worstBefore = Math.max(worstBefore, Math.abs(flown(rally({ speed, fps, offset, followThrough: false })) - reference));
            }
        }
    }
    // Pre-fix: up to (1 − s) of a frame of travel was dropped at each deflect.
    assert.ok(worstBefore > 2, `pre-fix worst lag ${worstBefore} m (fixed ${worstAfter} m)`);
});

test('a body in the follow-through remainder is hit in that frame (no tunnel after a deflect)', () => {
    // 177 u/s at 30 Hz: 5.9 m per frame. The contact lands at s ≈ 0.1, so the
    // remainder (≈ 5.3 m) carries the ball clean through an enemy capsule
    // standing 2.5 m behind the contact; only the remainder's own body test
    // can see it (the next frame starts past the body).
    const speed = 177;
    const dt = 1 / 30;
    const ball = makeBall();
    const player = new SimPlayer({ team: 'blue' });
    player.attacking = true;
    player._swingLiveWindow = 10;
    player.swingAge = 1;
    const enemy = new SimPlayer({ team: 'red', x: 40, z: 0 });
    ball.position.set(8.98, 1.25, 0);
    ball.velocity.set(-speed, 0, 0);
    ball.currentSpeed = speed;
    ball.state = 'rally';
    ball.targetPlayer = player;
    ball._prevPosition = ball.position.clone();
    const game = createContactGame({ player, ball, throwerTeam: 'red' });
    game.getAllTargets = () => [player, enemy];
    let hits = 0;
    let deflectS = null;
    game.handlePlayerDeflection = function () {
        deflectS = this._deflectContactOffset / dt;
        enemy.position.set(ball.position.x + 2.5, 1.7, 0);
        ball.deflectWithAim(ball.position.clone(), new THREE.Vector3(1, 0, 0), enemy);
        ball.currentSpeed = speed;
        ball._clampSpeed();
        this.lastDeflectorTeam = 'blue';
        player.attacking = false;
        return true;
    };
    game.handleHit = target => { if (target === enemy) hits++; };
    let result = null;
    for (let frame = 0; frame < 6 && result === null; frame++) {
        ball.update(dt);
        result = game._resolveFrameContacts(dt, true, false);
    }
    assert.ok(deflectS !== null && deflectS < 0.3, `contact at s = ${deflectS}`);
    assert.ok(ball.position.x > enemy.position.x + 1.5, 'the remainder carried the ball past the body');
    assert.equal(result, 'hit', 'hit decided in the deflect frame');
    assert.equal(hits, 1);
});

test('hit-stop is a presentation freeze-frame: the simulation dt never drops to 0', () => {
    const juice = new Juice(null, null);
    juice.hitStop(150);
    juice.flashAmt = 0.5;
    const particle = { life: 1, maxLife: 1, ring: true, scaleRate: 1, mesh: { scale: { setScalar() {} }, material: { opacity: 1 } } };
    juice.particles.push(particle);
    let frozenFrames = 0;
    for (let i = 0; i < 12; i++) {
        const effective = juice.update(1 / 60);
        if (!(effective > 0)) frozenFrames++;
    }
    assert.equal(frozenFrames, 0, 'no world-freeze frames');
    // The impact FX held for the 150 ms freeze-frame (9 frames), then resumed.
    assert.ok(particle.life < 1 && particle.life > 0.94, `particle life ${particle.life}`);
    assert.ok(juice.flashAmt > 0.5 - 3 / 60 * 3 - 1e-9 && juice.flashAmt < 0.5);
    // Game.update keeps its gate (a 0 dt still returns early) but no longer
    // receives one from hit-stop; slow-mo stays out of a connected sim.
    const update = extractGameMethod('update');
    assert.match(update, /const effectiveDt = this\.juice\.update\(dt\);\s+if \(effectiveDt === 0 && this\.state !== STATES\.CELEBRATION\) return;/);
    assert.match(update, /if \(!this\.network\?\.connected\) dt = effectiveDt \|\| dt;/);
});

test('source wiring: both deflect branches follow through; the remainder is body-tested', () => {
    const resolve = extractGameMethod('_resolveFrameContacts');
    assert.match(resolve, /if \(deflected !== false\) return this\._followThroughDeflect\(deflectFrom, end, playerS, frameDt\);/);
    assert.match(resolve, /this\.handleBotDeflection\(deflectBot\);\s+return this\._followThroughDeflect\(deflectFrom, end, botS, frameDt\);/);
    const follow = extractGameMethod('_followThroughDeflect');
    assert.match(follow, /ball\.continueFromContact\(rest, from, end\)/);
    assert.match(follow, /this\._resolveFrameContacts\(rest, false, bounced\) === 'hit'/);
});
