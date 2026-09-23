// prop-collision.test.mjs — solid map props (crates, containers, AC units,
// stalls, columns): players land on and walk off their tops, are stopped by
// their sides while their feet are below the top, and the ball bounces off
// both side and top faces with a swept test that cannot tunnel at rally speed.
// Runs the REAL Player.update() and Ball.update() against colliders built by
// the REAL Arena helpers (vendored three.js, no WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

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
const THREE = await import(threeUrl);
const { Arena, SOLID_TOP_STANDABLE_MAX } = await import('../js/arena.js');

const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(ballSource
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }')
).toString('base64')}`);
const { Ball, sweepSolidProp } = ballModule;

const DT = 1 / 60;

// Arena-shaped host whose colliders come from the real Arena helpers.
function propArena() {
    const host = {
        bounds: { minX: -40, maxX: 40, minY: 0, minZ: -40, maxZ: 40, maxY: 30 },
        ceilingHeight: 0,
        config: {},
        collidables: [],
        platforms: [],
        jumpPads: [],
        addCollidable: Arena.prototype.addCollidable,
        _markSolidColumn: Arena.prototype._markSolidColumn,
        _addSolidBox: Arena.prototype._addSolidBox,
        _addSolidCylinder: Arena.prototype._addSolidCylinder,
        getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
    };
    return host;
}

async function makePlayer(t, arena) {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const document = new EventTarget();
    const window = new EventTarget();
    const canvas = { tagName: 'CANVAS' };
    document.activeElement = canvas;
    document.pointerLockElement = null;
    document.hidden = false;
    document.body = { classList: { contains: () => false } };
    window.matchMedia = () => ({ matches: false });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    const { Player } = await import('../js/player.js');
    const player = new Player(
        { scene: new THREE.Scene(), domElement: canvas, createToonMaterial: color => new THREE.MeshBasicMaterial({ color }) },
        new THREE.PerspectiveCamera(75, 1, 0.1, 100),
        arena
    );
    player.game = { state: 'PLAYING', ui: { spectating: false }, ball: { _warmup: false } };
    t.after(() => {
        player.cleanupInput();
        player.armGroup.removeFromParent();
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    });
    return player;
}

const feet = player => player.position.y - player.height;

test('a player lands on a crate top, stands there, and drops when walking off its edge', async t => {
    const arena = propArena();
    // The real corner crate: 1.6 m cube (js/arena.js buildProps).
    Arena.prototype._addSolidBox.call(arena, null, 0, -12, 0.8, 0.8, 1.6);
    const player = await makePlayer(t, arena);
    player.position.set(0.3, 1.6 + player.height + 1.2, -12.2);
    player.verticalVel = 0;
    player.onGround = false;
    for (let i = 0; i < 60; i++) player.update(DT);
    assert.ok(Math.abs(feet(player) - 1.6) < 1e-6, `stands on the crate top (feet ${feet(player).toFixed(3)})`);
    assert.equal(player.onGround, true);
    assert.equal(player.jumpsRemaining, 2);
    // Standing still for a while never sinks into the box or gets shoved off.
    for (let i = 0; i < 90; i++) player.update(DT);
    assert.ok(Math.abs(feet(player) - 1.6) < 1e-6 && Math.abs(player.position.x - 0.3) < 1e-6 && Math.abs(player.position.z + 12.2) < 1e-6);

    // Walk forward (camera looks down -z) off the far edge.
    player.keys.KeyW = true;
    let leftTop = false;
    for (let i = 0; i < 60; i++) {
        player.update(DT);
        if (!player.onGround && feet(player) < 1.6) leftTop = true;
    }
    player.keys.KeyW = false;
    for (let i = 0; i < 60; i++) player.update(DT);
    assert.ok(leftTop, 'walking past the edge makes the player airborne');
    assert.ok(Math.abs(feet(player)) < 1e-6 && player.onGround, 'player dropped back to the floor');
    assert.ok(player.position.z < -12.8 - player.radius + 1e-6, `ended clear of the crate (z ${player.position.z.toFixed(2)})`);
});

test('a jumping player clears a waist-high box and lands on it instead of sinking inside', async t => {
    const arena = propArena();
    // A 1.2 m jersey barrier, 3 m deep along the run direction.
    Arena.prototype._addSolidBox.call(arena, null, 0, -14, 2.4, 1.5, 1.2);
    const player = await makePlayer(t, arena);
    // Run-up, then jump ~2 m before the barrier like a player would.
    player.position.set(0, player.height, 0);
    player.keys.KeyW = true;
    let landed = false;
    let insideBox = false;
    let jumpFrame = -1;
    for (let i = 0; i < 240 && !landed; i++) {
        if (jumpFrame < 0 && player.position.z <= -8) jumpFrame = i;
        player.keys.Space = jumpFrame >= 0 && i - jumpFrame < 2;
        player.update(DT);
        const over = Math.abs(player.position.z + 14) <= 1.5 && Math.abs(player.position.x) <= 2.4;
        if (over) player.keys.KeyW = false;
        if (over && feet(player) < 1.2 - 0.06) insideBox = true;
        landed = player.onGround && over && Math.abs(feet(player) - 1.2) < 1e-6;
    }
    assert.equal(insideBox, false, 'feet never pass through the top face');
    assert.ok(landed, `landed on the barrier (feet ${feet(player).toFixed(2)}, z ${player.position.z.toFixed(2)})`);
});

test('a wall-height prop stops a player even mid double jump', async t => {
    const arena = propArena();
    // Two-high container stack: 5.2 m, out of double-jump reach.
    Arena.prototype._addSolidBox.call(arena, null, 0, -14, 3, 1.25, 5.2);
    assert.equal(arena.platforms.length, 0, 'unreachable tops get no standable platform');
    assert.ok(5.2 > SOLID_TOP_STANDABLE_MAX);
    const player = await makePlayer(t, arena);
    player.position.set(0, player.height, -10);
    player.keys.KeyW = true;
    let maxFeet = 0;
    for (let i = 0; i < 150; i++) {
        player.keys.Space = i % 24 === 0 || i % 24 === 14;
        player.update(DT);
        maxFeet = Math.max(maxFeet, feet(player));
        assert.ok(player.position.z >= -14 + 1.25 + player.radius - 1e-6, `blocked at frame ${i} (z ${player.position.z.toFixed(3)})`);
    }
    assert.ok(maxFeet > 2, 'the player really did jump');
});

test('a short solid cylinder is standable; the step tolerance never snags a standing player', async t => {
    const arena = propArena();
    Arena.prototype._addSolidCylinder.call(arena, null, 0, 0.6, -12, 0.55, 1.2);
    assert.equal(arena.platforms[0].radius, 0.55);
    const player = await makePlayer(t, arena);
    player.position.set(0.2, 1.2 + player.height + 0.8, -12);
    for (let i = 0; i < 60; i++) player.update(DT);
    assert.ok(Math.abs(feet(player) - 1.2) < 1e-6 && player.onGround, `stands on the barrel (feet ${feet(player).toFixed(3)})`);
});

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
    ball.targetPlayer = null;
    ball.state = 'homing';
    return ball;
}

test('sweepSolidProp: side and top faces, grown by the ball radius, with outward normals', () => {
    const box = { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1, bottom: 0, top: 2 };
    const out = {};
    const side = sweepSolidProp({ x: -5, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, 0.5, box, out);
    assert.ok(side, 'a fast pass through the box is caught');
    assert.deepEqual([side.nx, side.ny, side.nz], [-1, 0, 0]);
    assert.ok(Math.abs(side.x - -1.5) < 0.01 && side.x <= -1.5, 'stops at the grown face');
    const top = sweepSolidProp({ x: 0.2, y: 4, z: 0 }, { x: 0.2, y: 1, z: 0 }, 0.5, box, {});
    assert.deepEqual([top.nx, top.ny, top.nz], [0, 1, 0]);
    assert.ok(Math.abs(top.y - 2.5) < 0.01 && top.y >= 2.5);
    assert.equal(sweepSolidProp({ x: -5, y: 2.6, z: 0 }, { x: 5, y: 2.6, z: 0 }, 0.5, box, {}), null, 'a ball skimming above the top passes');
    const column = { pos: { x: 0, y: 0, z: 0 }, radius: 1, bottom: 0, top: 3 };
    const round = sweepSolidProp({ x: 0, y: 1, z: -6 }, { x: 0, y: 1, z: 6 }, 0.5, column, {});
    assert.deepEqual([round.nx, round.ny, round.nz].map(v => Math.round(v * 1e6) / 1e6), [0, 0, -1]);
    const cap = sweepSolidProp({ x: 0.3, y: 5, z: 0 }, { x: 0.3, y: 2, z: 0 }, 0.5, column, {});
    assert.equal(cap.ny, 1, 'cylinder cap is a top face');
    // Starting inside (e.g. a respawn overlap) pushes out through the nearest face.
    const inside = sweepSolidProp({ x: 0.9, y: 1, z: 0 }, { x: 0.95, y: 1, z: 0 }, 0.5, box, {});
    assert.equal(inside.nx, 1);
    assert.ok(inside.x >= 1.5);
});

test('the ball bounces off a prop side with the prop restitution, even at max rally speed (no tunnelling)', () => {
    for (const speed of [20, 120, 400]) {
        const arena = propArena();
        // A 0.6 m thin energy barrier: thinner than one frame of travel at speed.
        Arena.prototype._addSolidBox.call(arena, null, 0, -10, 3, 0.3, 2);
        const ball = makeBall(arena);
        ball.position.set(0, 1.2, 0);
        ball.velocity.set(0, 0, -speed);
        ball.currentSpeed = speed;
        let bounced = false;
        for (let i = 0; i < 30; i++) {
            ball.update(DT);
            assert.ok(ball.position.z > -10 + 0.3, `${speed} m/s: ball never passes the barrier (z ${ball.position.z.toFixed(2)})`);
            if (ball.velocity.z > 0) bounced = true;
            if (bounced) break;
        }
        assert.ok(bounced, `${speed} m/s: ball reflected off the side face`);
    }
});

test('the ball bounces off a prop top like the floor and never comes to rest up there', () => {
    const arena = propArena();
    // Reactor-pylon-like tall column: its top is out of every player's reach.
    Arena.prototype._addSolidCylinder.call(arena, null, 0, 0, -10, 1.4, 9, false);
    const ball = makeBall(arena);
    ball.position.set(0, 14, -10);
    ball.velocity.set(0, -30, 0);
    ball.currentSpeed = 30;
    let topBounce = false;
    for (let i = 0; i < 400; i++) {
        ball.update(DT);
        const dx = ball.position.x;
        const dz = ball.position.z + 10;
        const inside = Math.hypot(dx, dz) < 1.4 && ball.position.y < 9;
        assert.equal(inside, false, `ball never inside the column (frame ${i})`);
        if (ball.velocity.y > 0 && ball.position.y > 9) topBounce = true;
    }
    assert.ok(topBounce, 'bounced up off the top face');
    const offTop = Math.hypot(ball.position.x, ball.position.z + 10) > 1.4 + ball.radius || ball.position.y > 9 + ball.radius + 0.5;
    assert.ok(offTop, 'ball rolled off / keeps bouncing instead of resting on an unreachable top');
});
