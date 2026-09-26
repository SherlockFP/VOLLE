// prop-ghost-pinning.test.mjs — cover stops a targeted ball (js/ball.js
// _updatePropPin). A clean bounce keeps props solid; (i) two prop bounces
// within PROP_PIN_WINDOW or (ii) a bounce followed by a window without
// PROP_PIN_PROGRESS of distance change means the ball is PINNED. A pinned ball
// now routes around the cover (or over low, wide cover) to its target
// (propDetourWaypoints); it phases through only after PROP_DETOUR_TRIES
// detours, so every shot still resolves. Runs the REAL Ball.update() against
// colliders the real Arena helpers built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
const threeUrl = new URL('three.module.js', vendor).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const THREE = await import(threeUrl);
const { Arena } = await import('../js/arena.js');
const { capsuleContact } = await import('../js/combat.js');
const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const { Ball, PROP_GHOST_SECONDS, PROP_PIN_WINDOW, PROP_PIN_PROGRESS, PROP_DETOUR_TRIES, propDetourWaypoints } = await import(`data:text/javascript;base64,${Buffer.from(ballSource
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }')
).toString('base64')}`);

// One 2.4 m parkour ledge (the real piece size) centred on the origin.
const LEDGE = { x: 0, z: 0, halfWidth: 1.2, halfDepth: 1.5, height: 2.4 };
function ledgeArena() {
    const host = {
        bounds: { minX: -60, maxX: 60, minY: 0, minZ: -60, maxZ: 60, maxY: 30 },
        ceilingHeight: 0, config: {}, collidables: [], platforms: [], jumpPads: [],
        addCollidable: Arena.prototype.addCollidable,
        getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
    };
    Arena.prototype._addSolidBox.call(host, null, LEDGE.x, LEDGE.z, LEDGE.halfWidth, LEDGE.halfDepth, LEDGE.height, 'always', 0, 'ledge');
    return host;
}

function makeBall(arena) {
    const material = () => new THREE.ShaderMaterial({ uniforms: {
        uColor: { value: new THREE.Color() }, uTexture: { value: null },
        uTextureEnabled: { value: false }, uRimPower: { value: 5 }
    } });
    const ball = new Ball({ scene: new THREE.Scene(), createToonMaterial: material, createOutlineMesh: g => new THREE.Mesh(g), _quality: 'low' }, arena);
    ball._emitTrail = () => {};
    ball.updateTrail = () => {};
    ball.spawn();
    ball._noHitTimer = 0;
    return ball;
}

// A standing player (eye-height position, like js/player.js).
function player(x, z) {
    return {
        position: new THREE.Vector3(x, 1.7, z),
        getPosition() { return this.position.clone(); },
        getFeetY() { return this.position.y - 1.7; }
    };
}

function launch(ball, target, x, y, z, vx, vy, vz) {
    ball.state = 'rally';
    ball.aimed = false;
    ball.setTarget(target);
    ball.position.set(x, y, z);
    ball._prevPosition = ball.position.clone();
    ball.velocity.set(vx, vy, vz);
    ball.currentSpeed = Math.hypot(vx, vy, vz);
}

const insideLedge = ball => Math.abs(ball.position.x - LEDGE.x) < LEDGE.halfWidth
    && Math.abs(ball.position.z - LEDGE.z) < LEDGE.halfDepth && ball.position.y < LEDGE.height;

test('pin rule constants: the ghost starts within 0.45 s of the first pinned bounce and keeps its length', () => {
    assert.equal(PROP_GHOST_SECONDS, 0.6);
    assert.equal(PROP_PIN_WINDOW, 0.4);
    assert.equal(PROP_PIN_PROGRESS, 1.0);
    assert.ok(PROP_PIN_WINDOW <= 0.45);
});

test('a targeted ball\'s single clean bounce off a parkour block does not ghost', () => {
    for (const hz of [60, 144]) {
        const dt = 1 / hz;
        const ball = makeBall(ledgeArena());
        // The target stands on the shooter's side: after the bounce the ball flies clear to it.
        const target = player(8, 3);
        launch(ball, target, LEDGE.halfWidth + ball.radius + 0.2, 1.2, 0, -25, 0, 0);
        let bounced = false;
        for (let t = 0; t < 0.7; t += dt) {
            const before = ball.bounceCount;
            ball.update(dt);
            if (ball.bounceCount > before) bounced = true;
            assert.equal(ball._propGhost, 0, `${hz} Hz: no ghost at t=${t.toFixed(3)} after one clean bounce`);
            assert.ok(!insideLedge(ball), `${hz} Hz: never inside the ledge`);
        }
        assert.ok(bounced, `${hz} Hz: the ball bounced off the ledge face`);
        assert.equal(ball.bounceCount, 1, `${hz} Hz: exactly one clean prop bounce`);
    }
});

test('a second approach into the same block within 0.6 s bounces again (the old blanket ghost let it through)', () => {
    for (const delay of [0.2, 0.3, 0.45, 0.55]) {
        const dt = 1 / 60;
        const ball = makeBall(ledgeArena());
        const target = player(8, 3);
        launch(ball, target, LEDGE.halfWidth + ball.radius + 0.2, 1.2, 0, -25, 0, 0);
        let firstAt = null;
        let t = 0;
        for (; t < 1 && firstAt === null; t += dt) {
            const before = ball.bounceCount;
            ball.update(dt);
            if (ball.bounceCount > before) firstAt = t;
        }
        assert.notEqual(firstAt, null, 'first bounce happened');
        for (; t < firstAt + delay; t += dt) ball.update(dt);
        // Second approach, straight back into the same face.
        launch(ball, target, LEDGE.halfWidth + ball.radius + 0.2, 1.2, 0.2, -25, 0, 0);
        const before = ball.bounceCount;
        let second = false;
        for (let k = 0; k < 6; k++) {
            ball.update(dt);
            assert.ok(!insideLedge(ball), `delay ${delay}s: the second approach never enters the ledge`);
            if (ball.bounceCount > before) second = true;
        }
        assert.ok(second, `delay ${delay}s after the first bounce: the ledge bounced the ball again`);
        assert.ok(ball.velocity.x > 0, `delay ${delay}s: reflected back out`);
    }
});

// Owner: "the ball should hit objects around it and still bounce on to the
// player it is going for". A pinned ball used to phase straight through the
// cover within 0.45 s; now it routes around it (or over low, wide cover).
function arenaWith(kind) {
    const host = ledgeArena();
    host.collidables.length = 0;
    host.platforms.length = 0;
    if (kind === 'ledge') Arena.prototype._addSolidBox.call(host, null, LEDGE.x, LEDGE.z, LEDGE.halfWidth, LEDGE.halfDepth, LEDGE.height, 'always', 0, 'ledge');
    if (kind === 'wall') Arena.prototype._addSolidBox.call(host, null, 0, 0, 0.6, 7, 2.2, true);
    if (kind === 'pillar') Arena.prototype._addSolidColumn.call(host, null, 0, 0, 1.6, 12, false);
    if (kind === 'block') Arena.prototype._addSolidBox.call(host, null, 0, 0, 2.5, 2.5, 6, false);
    return host;
}
const insideSolid = (ball, c) => ball.position.y < c.top - 0.05 && (Number.isFinite(c.minX)
    ? ball.position.x > c.minX + 0.05 && ball.position.x < c.maxX - 0.05 && ball.position.z > c.minZ + 0.05 && ball.position.z < c.maxZ - 0.05
    : Math.hypot(ball.position.x - c.pos.x, ball.position.z - c.pos.z) < c.radius - 0.05);

test('a ball pinned against cover goes around or over it, never through, and still reaches its target', () => {
    const cases = [];
    for (const kind of ['ledge', 'wall', 'pillar', 'block']) {
        for (const hz of [30, 60, 144]) {
            for (const [tx, tz] of [[-3.5, 0], [-4, 1.5], [-8, -2], [-3.2, -0.6]]) {
                for (const speed of [18, 25, 40]) cases.push({ kind, hz, tx, tz, speed });
            }
        }
    }
    for (const { kind, hz, tx, tz, speed } of cases) {
        const dt = 1 / hz;
        const arena = arenaWith(kind);
        const prop = arena.collidables[0];
        const ball = makeBall(arena);
        const target = player(tx, tz);
        launch(ball, target, 9, 1.2, tz * 0.3, -speed, 0, 0);
        let firstBounce = null;
        let hitAt = null;
        let detoured = false;
        for (let t = 0; t < 3 && hitAt === null; t += dt) {
            const before = ball.bounceCount;
            ball.update(dt);
            if (ball.bounceCount > before && firstBounce === null) firstBounce = t;
            if (ball._propDetour) detoured = true;
            const label = `${kind} ${hz} Hz ${speed} u/s target (${tx}, ${tz}) t=${t.toFixed(3)}`;
            assert.equal(ball._propGhost, 0, `${label}: never phases through while a detour is left`);
            assert.ok(!insideSolid(ball, prop), `${label}: never inside the cover`);
            assert.ok(Number.isFinite(ball.position.x) && Number.isFinite(ball.velocity.x));
            const p = target.getPosition();
            if (ball._forceHit || capsuleContact(ball.position, p.x, p.z, target.getFeetY(), 1.7, 0.45, ball.radius)) hitAt = t;
        }
        const label = `${kind} ${hz} Hz ${speed} u/s target (${tx}, ${tz})`;
        assert.notEqual(firstBounce, null, `${label}: the cover bounced the ball first`);
        assert.ok(detoured, `${label}: the pinned ball took a detour`);
        assert.notEqual(hitAt, null, `${label}: shot resolved within 3.0 s`);
    }
});

test('detour planning: low wide cover is lobbed over, tall cover is passed on the side, a retry takes the other route', () => {
    const from = { x: 3, y: 1.2, z: 0.2 };
    const to = { x: -4, y: 1.7, z: 0 };
    const wall = { minX: -0.6, maxX: 0.6, minZ: -7, maxZ: 7, top: 2.2 };
    const [upNear, upFar] = propDetourWaypoints({ from, to, prop: wall, attempt: 0 });
    assert.ok(upNear.y > wall.top && upFar.y > wall.top, 'over the top');
    assert.ok(upNear.x > wall.maxX && upFar.x < wall.minX, 'near edge, then past the far edge');
    const pillar = { pos: { x: 0, y: 1.7, z: 0 }, radius: 1.6, top: 12 };
    const [sideNear, sideFar] = propDetourWaypoints({ from, to, prop: pillar, attempt: 0 });
    assert.ok(sideNear.y < 3 && Math.abs(sideNear.z) > pillar.radius + 1 && Math.sign(sideNear.z) === Math.sign(sideFar.z), 'beside it, one side');
    assert.equal(Math.sign(sideNear.z), Math.sign(from.z), 'the side the ball is already on');
    const [retry] = propDetourWaypoints({ from, to, prop: pillar, attempt: 1 });
    assert.equal(Math.sign(retry.z), -Math.sign(from.z), 'the retry goes round the other side');
    const [lowRetry] = propDetourWaypoints({ from, to, prop: wall, attempt: 1 });
    assert.ok(lowRetry.y < wall.top, 'low wide cover: the retry goes round instead of over');
    assert.equal(propDetourWaypoints({ from, to: { x: NaN, y: 0, z: 0 }, prop: pillar }), null);
});

test('phasing is the last resort: only after PROP_DETOUR_TRIES detours for the same target', () => {
    const arena = ledgeArena();
    const ball = makeBall(arena);
    const target = player(-3, 0);
    ball.setTarget(target);
    ball.position.set(2, 1.2, 0);
    ball._lastPropHit = arena.collidables[0];
    for (let attempt = 1; attempt <= PROP_DETOUR_TRIES; attempt++) {
        ball._updatePropPin(true);
        ball._propClock += PROP_PIN_WINDOW / 2;
        ball._updatePropPin(true);
        assert.equal(ball._propGhost, 0, `pin ${attempt}: a detour, not a ghost`);
        assert.equal(ball._propDetours, attempt);
        ball._propDetour = null;
        ball._propClock += PROP_PIN_WINDOW * 2;
    }
    ball._updatePropPin(true);
    ball._propClock += PROP_PIN_WINDOW / 2;
    ball._updatePropPin(true);
    assert.equal(ball._propGhost, PROP_GHOST_SECONDS, 'tries used up: it phases so the shot still resolves');
    ball.setTarget(player(9, 9));
    ball._updatePropPin(false);
    assert.equal(ball._propDetours, 0, 'a new target gets fresh detours');
});

test('rule (ii): a ball hovering at the prop for the whole window ghosts; one flying clear does not', () => {
    const ball = makeBall(ledgeArena());
    const target = player(-3, 0);
    ball.setTarget(target);
    ball.position.set(2, 1.2, 0);
    ball._updatePropPin(true);
    assert.equal(ball._propGhost, 0, 'the first bounce itself never ghosts');
    ball._propClock += PROP_PIN_WINDOW;
    ball.position.set(2.4, 1.3, 0.3); // still at the face: |distance change| < PROP_PIN_PROGRESS
    ball._updatePropPin(false);
    assert.equal(ball._propGhost, PROP_GHOST_SECONDS);

    const clear = makeBall(ledgeArena());
    clear.setTarget(target);
    clear.position.set(2, 1.2, 0);
    clear._updatePropPin(true);
    clear._propClock += PROP_PIN_WINDOW;
    clear.position.set(6, 1.2, 1); // flew clear (it may come back and bounce again)
    clear._updatePropPin(false);
    assert.equal(clear._propGhost, 0);

    // (i) a second bounce inside the window ghosts at once; a retarget resets the pin clock.
    const twice = makeBall(ledgeArena());
    twice.setTarget(target);
    twice._updatePropPin(true);
    twice._propClock += PROP_PIN_WINDOW / 2;
    twice.setTarget(player(9, 9));
    twice._updatePropPin(true);
    assert.equal(twice._propGhost, 0, 'bounce against a new target starts a new pin window');
    twice._propClock += PROP_PIN_WINDOW / 2;
    twice._updatePropPin(true);
    assert.equal(twice._propGhost, PROP_GHOST_SECONDS);
    for (const key of ['_propClock', '_propBounceAt', '_propBounceDist']) assert.equal(typeof twice[key], 'number', `${key} is a scalar`);
});

test('the pin detector is allocation-free (scalars only on the host hot path)', () => {
    const start = ballSource.indexOf('    _updatePropPin(bouncedOffProp) {');
    assert.ok(start > 0);
    const rest = ballSource.slice(start);
    const body = rest.slice(0, rest.search(/\r?\n {4}\}\r?\n/));
    assert.ok(body.includes('PROP_GHOST_SECONDS'));
    assert.doesNotMatch(body, /\bnew\b|\.clone\(|\[|\{\s*\w+\s*:/);
});
