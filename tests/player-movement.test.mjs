import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const helperStart = source.indexOf('export const GROUND_ACCEL');
const helperEnd = source.indexOf('export class Player');
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const helpers = await import(`data:text/javascript,${encodeURIComponent(source.slice(helperStart, helperEnd))}`);

const {
    applyGroundFriction,
    sourceAccelerate,
    resolveJump,
    clipInwardVelocity,
    clipMovementState,
    GROUND_ACCEL,
    AIR_ACCEL,
    GROUND_FRICTION,
    STOP_SPEED,
    AIR_WISH_CAP,
    AIR_SPEED_CAP
} = helpers;

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test('Source friction uses stop speed and reaches a full stop', () => {
    const slowed = applyGroundFriction({ x: 2, z: 0 }, GROUND_FRICTION, STOP_SPEED, 0.1);
    closeTo(slowed.x, 0.75);
    assert.deepEqual(
        applyGroundFriction(slowed, GROUND_FRICTION, STOP_SPEED, 0.1),
        { x: 0, z: 0 }
    );
});

test('ground friction applies while making a 90 degree turn', () => {
    const slowed = applyGroundFriction({ x: 10, z: 0 }, GROUND_FRICTION, STOP_SPEED, 0.1);
    const turned = sourceAccelerate(slowed, { x: 0, z: 1 }, 10, GROUND_ACCEL, 0.1);
    closeTo(turned.x, 6);
    closeTo(turned.z, 10);
});

test('air acceleration scales by wish speed and caps runaway speed', () => {
    const strafed = sourceAccelerate(
        { x: 10, z: 0 },
        { x: 0, z: 1 },
        10,
        AIR_ACCEL,
        1 / 60,
        AIR_WISH_CAP,
        10 * AIR_SPEED_CAP
    );
    closeTo(strafed.z, 0.94);

    const capped = sourceAccelerate(
        { x: 15.99, z: 0 },
        { x: 0, z: 1 },
        10,
        AIR_ACCEL,
        1 / 60,
        AIR_WISH_CAP,
        10 * AIR_SPEED_CAP
    );
    closeTo(Math.hypot(capped.x, capped.z), 10 * AIR_SPEED_CAP);
});

test('initial jump and double jump consume separate charges', () => {
    const initial = resolveJump({
        spaceDown: true,
        onGround: true,
        jumpHeld: false,
        jumpsRemaining: 2,
        verticalVel: 0,
        jumpForce: 8,
        bhopEnabled: true
    });
    assert.equal(initial.kind, 'ground');
    assert.equal(initial.jumpsRemaining, 1);

    const sameFrame = resolveJump({
        ...initial,
        spaceDown: true,
        jumpForce: 8,
        bhopEnabled: true
    });
    assert.equal(sameFrame.kind, null);
    assert.equal(sameFrame.jumpsRemaining, 1);

    const released = resolveJump({
        ...sameFrame,
        spaceDown: false,
        jumpForce: 8,
        bhopEnabled: true
    });
    const doubleJump = resolveJump({
        ...released,
        spaceDown: true,
        jumpForce: 8,
        bhopEnabled: true
    });
    assert.equal(doubleJump.kind, 'double');
    assert.equal(doubleJump.jumpsRemaining, 0);
});

test('held bhop jumps before landing friction can reduce speed', () => {
    const landingSpeed = { x: 12, z: 0 };
    const jump = resolveJump({
        spaceDown: true,
        onGround: true,
        jumpHeld: true,
        jumpsRemaining: 2,
        verticalVel: 0,
        jumpForce: 8,
        bhopEnabled: true
    });
    const afterMovement = jump.onGround
        ? applyGroundFriction(landingSpeed, GROUND_FRICTION, STOP_SPEED, 1 / 60)
        : landingSpeed;
    assert.equal(jump.kind, 'ground');
    assert.deepEqual(afterMovement, landingSpeed);
});

test('collision clipping removes inward speed and preserves tangent', () => {
    assert.deepEqual(
        clipInwardVelocity({ x: -4, z: 3 }, { x: 1, z: 0 }),
        { x: 0, z: 3 }
    );

    const radial = clipInwardVelocity({ x: -3, z: 1 }, { x: 1, z: 1 });
    closeTo(radial.x, -2);
    closeTo(radial.z, 2);
    closeTo(radial.x + radial.z, 0);
});

test('final dash tick clips dash direction before reporting momentum', () => {
    const clipped = clipMovementState(
        { x: 0, z: 0 },
        { x: -1, z: 0 },
        { x: 1, z: 0 },
        true
    );

    assert.deepEqual(clipped.velocity, { x: 0, z: 0 });
    assert.deepEqual(clipped.dashDir, { x: 0, z: 0 });
});
