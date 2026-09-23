import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Design decision: honour the game mode's rally speed cap. Rally speed ramps
// as before up to ball.maxSpeed, then holds there ("overdrive"). A raw Ball
// with no mode applied keeps maxSpeed = Infinity and stays uncapped, matching
// pre-existing behaviour (see tests/uncapped-rally-network.test.mjs, which
// pins the *nominal* getRallySpeed() formula — unchanged by this fix). This
// file covers the actually-applied currentSpeed/velocity, which is what
// _clampSpeed() enforces every physics tick and after every speed-setting
// call (deflect, spike, orbit, charge release).
const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}')
    .replace("import { getBallSkinTexture, rimPowerForSkin, trailIntensityMultiplier, BallImpactFX } from './ball-skin-fx.js';", 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} get activeCount() { return 0; } }');
const { Ball, BALL_HEAT_TIERS } = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

function makeVelocity(x = 1, y = 0, z = 0) {
    return {
        x, y, z,
        length() { return Math.hypot(this.x, this.y, this.z); },
        copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; },
        multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
        normalize() {
            const l = this.length() || 1;
            this.x /= l; this.y /= l; this.z /= l;
            return this;
        }
    };
}

function makeBall(overrides = {}) {
    const ball = Object.create(Ball.prototype);
    ball.baseSpeed = 17;
    ball.currentSpeed = 17;
    ball.maxRallyMultiplier = Infinity;
    ball.maxSpeed = Infinity;
    ball._steeringInitialDir = { x: 1, y: 0, z: 0 };
    ball.velocity = makeVelocity(1, 0, 0);
    Object.assign(ball, overrides);
    return ball;
}

test('_clampSpeed holds currentSpeed at the mode cap once it is reached (overdrive)', () => {
    const ball = makeBall({ maxSpeed: 102, currentSpeed: 250 });
    ball.velocity = makeVelocity(1, 0, 0).multiplyScalar(250);
    ball._clampSpeed();
    assert.equal(ball.currentSpeed, 102);
    assert.ok(Math.abs(ball.velocity.length() - 102) < 1e-9, 'velocity magnitude follows the capped speed');
    assert.equal(ball.isOverdrive, true);
});

test('_clampSpeed is a no-op below the cap', () => {
    const ball = makeBall({ maxSpeed: 102, currentSpeed: 40 });
    ball.velocity = makeVelocity(1, 0, 0).multiplyScalar(40);
    ball._clampSpeed();
    assert.equal(ball.currentSpeed, 40);
    assert.equal(ball.isOverdrive, false);
});

test('a raw/uncapped ball (maxSpeed = Infinity) behaves exactly as before: never overdrive, no ceiling', () => {
    const ball = makeBall({ maxSpeed: Infinity, currentSpeed: 500 });
    ball.velocity = makeVelocity(1, 0, 0).multiplyScalar(500);
    ball._clampSpeed();
    assert.equal(ball.currentSpeed, 500, 'default Ball stays uncapped-safe');
    assert.equal(ball.isOverdrive, false, 'Infinity maxSpeed can never be "reached"');
});

test('isOverdrive is false while non-finite or below cap, true only once pinned at the cap', () => {
    const ball = makeBall({ maxSpeed: 102 });
    ball.currentSpeed = 101.999;
    assert.equal(ball.isOverdrive, false);
    ball.currentSpeed = 102;
    assert.equal(ball.isOverdrive, true);
});

test('repeated deflections eventually stop increasing currentSpeed once maxSpeed is set (mode-applied rally)', () => {
    const ball = makeBall({ maxSpeed: 102, rallySpeedStep: 0.30, deflections: 0, skinConfig: null });
    ball.aimed = false;
    const observed = [];
    for (let i = 0; i < 60; i++) {
        // Mirrors ball.deflect()'s speed-setting contract: currentSpeed is
        // (re)computed from the rally formula, then _clampSpeed() enforces
        // the mode ceiling before the value is used for movement/threat math.
        ball.deflections = i;
        ball.currentSpeed = ball.getRallySpeed();
        ball.velocity = makeVelocity(1, 0, 0).multiplyScalar(ball.currentSpeed);
        ball._clampSpeed();
        observed.push(ball.currentSpeed);
    }
    assert.ok(observed.every(s => s <= 102), 'currentSpeed never exceeds the mode cap');
    assert.equal(observed[observed.length - 1], 102, 'a long rally settles at the cap instead of climbing forever');
    assert.equal(ball.isOverdrive, true);
    // getRallySpeed() itself is intentionally left uncapped (nominal ramp) —
    // the ceiling is enforced where currentSpeed is actually consumed.
    assert.ok(ball.getRallySpeed() > 102);
});

test('overdrive forces the ball into the hottest existing heat tier visual (no new materials)', () => {
    const overdriveTier = BALL_HEAT_TIERS[BALL_HEAT_TIERS.length - 1];
    assert.equal(overdriveTier.id, 'overdrive');

    const heatMat = { color: { hex: null, setHex(h) { this.hex = h; } }, opacity: 0 };
    const heatShell = { scale: { value: 0, setScalar(v) { this.value = v; } } };
    const ball = makeBall({ maxSpeed: 102, currentSpeed: 102, baseSpeed: 17, heatMat, heatShell });

    ball._updateHeatVisual();
    assert.equal(heatMat.color.hex, overdriveTier.color, 'heat shell uses the existing overdrive tier color');
    assert.ok(heatMat.opacity > 0);
    assert.ok(heatShell.scale.value > 1.08, 'heat shell visibly grows past its resting scale');
});

test('overdrive shifts the trail hue to the overdrive tier color, otherwise keeps the skin/affix trail color', () => {
    const overdriveTier = BALL_HEAT_TIERS[BALL_HEAT_TIERS.length - 1];
    const trailGeometries = { orb: {} };
    const pooledDot = {
        visible: false, geometry: null,
        material: { color: { hex: null, setHex(h) { this.hex = h; } }, blending: null, depthWrite: null, depthTest: null, opacity: 0 },
        scale: { set() {} },
        position: { copy() {} }
    };
    const scene = { add() {} };
    function baseBall(overrides) {
        return makeBall({
            maxSpeed: 102,
            currentSpeed: 102,
            baseSpeed: 17,
            skinConfig: { trail: 0xff2222 },
            _affixTrailColor: null,
            _trailGeometries: trailGeometries,
            _trailPool: { acquire: () => pooledDot, release() {} },
            scene,
            trail: [],
            spin: 0,
            ...overrides
        });
    }

    const overdriveBall = baseBall({});
    overdriveBall.addTrailDot({ x: 0, y: 0, z: 0 });
    assert.equal(pooledDot.material.color.hex, overdriveTier.color);

    const normalBall = baseBall({ maxSpeed: 102, currentSpeed: 40 });
    normalBall.addTrailDot({ x: 0, y: 0, z: 0 });
    assert.equal(pooledDot.material.color.hex, 0xff2222, 'below the cap, trail keeps its normal skin color');
});
