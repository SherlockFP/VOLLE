import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

const {
    Ball,
    STEERING_CONTROL_WINDOW,
    createWideWaypoint,
    hasCrossedTargetPlane,
    isSteeringControlLocked,
    networkBallStep,
    predictLeadTarget,
    sampleBoundedVelocity,
    smoothSampledVelocity,
    splitSteeringDisplacement,
    steeringActiveDt,
    steeringTurnAlpha
} = ballModule;

test('sample smoothing absorbs target jitter without changing direction instantly', () => {
    const filtered = smoothSampledVelocity(
        { x: 0, y: 0, z: 0 },
        { x: 14, y: 0, z: 0 },
        1 / 60
    );
    assert.ok(filtered.x > 0);
    assert.ok(filtered.x < 14);
    assert.deepEqual(smoothSampledVelocity(filtered, { x: NaN }, -1), filtered);
});

test('network ball prediction advances every frame and bounds packet extrapolation', () => {
    const position = { x: 0, y: 1, z: 0 };
    const velocity = { x: 20, y: 0, z: 0 };
    const target = { x: 0, y: 1, z: 0 };
    const fresh = networkBallStep(position, velocity, target, 1 / 60, 0);
    const stale = networkBallStep(position, velocity, target, 1 / 60, 5);

    assert.ok(fresh.x > 0);
    assert.ok(stale.x > fresh.x);
    assert.ok(stale.x < 2);
});

test('straight shot leads a moving target with bounded sampled velocity', () => {
    const velocity = sampleBoundedVelocity(
        { x: 0, y: 1, z: -10 },
        { x: 2, y: 1, z: -10 },
        0.1,
        5
    );
    assert.ok(Math.abs(Math.hypot(velocity.x, velocity.y, velocity.z) - 5) < 1e-9);

    const lead = predictLeadTarget(
        { x: 2, y: 1, z: -10 },
        velocity,
        { x: 0, y: 1, z: 0 },
        20
    );
    assert.ok(lead.x > 2);
    assert.ok(lead.x <= 3.5);
    assert.equal(lead.z, -10);
});

test('wide shot creates a deterministic side/back waypoint and switches at target plane', () => {
    const origin = { x: 0, y: 1, z: 0 };
    const target = { x: 0, y: 1, z: -10 };
    const aim = { x: 1, y: 0, z: 0 };
    const first = createWideWaypoint(origin, aim, target);
    const second = createWideWaypoint(origin, aim, target);

    assert.deepEqual(first, second);
    assert.notEqual(first.position.x, target.x);
    assert.ok(Math.abs(first.position.x - target.x) <= 3.25);
    assert.ok(first.position.z <= target.z - 6);
    assert.ok(Math.abs(first.position.z - target.z) > Math.abs(first.position.x - target.x));
    assert.equal(hasCrossedTargetPlane({ x: 0, y: 1, z: -9 }, target, first.planeNormal), false);
    assert.equal(hasCrossedTargetPlane({ x: 0, y: 1, z: -11 }, target, first.planeNormal), true);
    assert.equal(createWideWaypoint(origin, { x: 0, y: 0, z: -1 }, target), null);
    assert.notEqual(createWideWaypoint(origin, { x: 0.4, y: 0, z: -1 }, target), null);
});

test('control delay preserves initial aim for 0.074 seconds', () => {
    assert.equal(isSteeringControlLocked(0), true);
    assert.equal(isSteeringControlLocked(STEERING_CONTROL_WINDOW - 1e-6), true);
    assert.equal(isSteeringControlLocked(STEERING_CONTROL_WINDOW), false);
    assert.equal(steeringActiveDt(0.05, 0.02), 0);
    assert.ok(Math.abs(steeringActiveDt(0.07, 0.01) - 0.006) < 1e-12);
    assert.ok(Math.abs(steeringActiveDt(0.08, 0.01) - 0.01) < 1e-12);
});

test('control-window boundary splits displacement within the frame', () => {
    const displacement = splitSteeringDisplacement(
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 0, z: 10 },
        0.1,
        0.026
    );

    assert.ok(Math.abs(displacement.x - 0.74) < 1e-12);
    assert.ok(Math.abs(displacement.z - 0.26) < 1e-12);
});

test('turn rate is frame-rate independent and grows per deflection', () => {
    const oneTick = steeringTurnAlpha(1 / 66, 0);
    const halfTick = steeringTurnAlpha(1 / 132, 0);
    const compounded = 1 - (1 - halfTick) ** 2;

    assert.ok(Math.abs(oneTick - 0.22) < 1e-12);
    assert.ok(Math.abs(compounded - oneTick) < 1e-12);
    assert.ok(Math.abs(steeringTurnAlpha(1 / 66, 3) - (0.22 + 3 * 0.016)) < 1e-12);
});

test('spawn, deactivate, and retarget reset steering; clamp repairs non-finite values', () => {
    const ball = Object.create(Ball.prototype);
    ball.arena = { getSpawnPoint: () => ({ x: 0, y: 4, z: 0 }) };
    ball.position = { copy() { return this; } };
    ball.velocity = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
    };
    ball.baseSpeed = 17;
    ball.mesh = { position: { copy() {} }, visible: false };
    ball.clearTrail = () => {};
    ball.updateColor = () => {};
    ball._steeringActive = true;
    ball.spawn();
    assert.equal(ball._steeringActive, false);

    ball._steeringActive = true;
    ball.deactivate();
    assert.equal(ball._steeringActive, false);

    ball.targetPlayer = {};
    ball._steeringActive = true;
    ball._steeringAge = 1;
    ball._steeringWaypoint = {};
    ball.setTarget({});

    assert.equal(ball._steeringActive, false);
    assert.equal(ball._steeringAge, 0);
    assert.equal(ball._steeringWaypoint, null);

    ball.maxSpeed = 102;
    ball.currentSpeed = Infinity;
    ball._steeringInitialDir = { x: 1, y: 0, z: 0 };
    ball.velocity = {
        x: NaN,
        y: 0,
        z: 0,
        copy(other) {
            this.x = other.x;
            this.y = other.y;
            this.z = other.z;
            return this;
        },
        multiplyScalar(scale) {
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
            return this;
        }
    };

    ball._clampSpeed();
    assert.equal(ball.currentSpeed, 17);
    assert.deepEqual(
        [ball.velocity.x, ball.velocity.y, ball.velocity.z].map(Number.isFinite),
        [true, true, true]
    );
});
