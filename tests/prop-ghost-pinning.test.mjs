// prop-ghost-pinning.test.mjs — cover stops a targeted ball; only a PINNED
// ball phases through props (js/ball.js _updatePropPin). Before: every prop
// bounce by a targeted ball set PROP_GHOST_SECONDS of ghosting, so a parkour
// block stopped a shot exactly once. Now: a clean bounce keeps props solid;
// (i) two prop bounces within PROP_PIN_WINDOW or (ii) a bounce followed by a
// window without PROP_PIN_PROGRESS of distance change starts the ghost.
// Runs the REAL Ball.update() against a collider the real Arena helper built.
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
const { Ball, PROP_GHOST_SECONDS, PROP_PIN_WINDOW, PROP_PIN_PROGRESS } = await import(`data:text/javascript;base64,${Buffer.from(ballSource
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

test('a ball pinned against cover ghosts within 0.45 s of the first pinned bounce and still reaches its target', () => {
    for (const hz of [30, 60, 144]) {
        for (const [tx, tz] of [[-2.6, 0], [-2.6, 0.8], [-3.5, -1]]) {
            const dt = 1 / hz;
            const ball = makeBall(ledgeArena());
            const target = player(tx, tz);
            launch(ball, target, 7, 1.2, tz * 0.5, -25, 0, 0);
            let firstBounce = null;
            let ghostAt = null;
            let hitAt = null;
            for (let t = 0; t < 3 && hitAt === null; t += dt) {
                const before = ball.bounceCount;
                ball.update(dt);
                if (ball.bounceCount > before && firstBounce === null) firstBounce = t;
                if (ball._propGhost > 0 && ghostAt === null) ghostAt = t;
                const p = target.getPosition();
                if (ball._forceHit || capsuleContact(ball.position, p.x, p.z, target.getFeetY(), 1.7, 0.45, ball.radius)) hitAt = t;
                assert.ok(Number.isFinite(ball.position.x) && Number.isFinite(ball.velocity.x));
            }
            const label = `${hz} Hz, target (${tx}, ${tz})`;
            assert.notEqual(firstBounce, null, `${label}: the cover bounced the ball first`);
            assert.notEqual(ghostAt, null, `${label}: pinned ball started phasing`);
            assert.ok(ghostAt - firstBounce <= 0.45 + 1e-9, `${label}: ghost ${(ghostAt - firstBounce).toFixed(3)} s after the first pinned bounce`);
            assert.notEqual(hitAt, null, `${label}: shot resolved within 3.0 s`);
        }
    }
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
