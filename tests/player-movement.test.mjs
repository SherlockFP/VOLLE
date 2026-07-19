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
    moveHorizontalState,
    isEditableTarget,
    resolveJump,
    resolveLongJump,
    clipInwardVelocity,
    clipMovementState,
    GROUND_ACCEL,
    AIR_ACCEL,
    GROUND_FRICTION,
    STOP_SPEED,
    AIR_WISH_CAP,
    SLIPPERY_SURFACE_FACTOR,
    LONG_JUMP_SPEED,
    LONG_JUMP_MAX_SPEED,
    LONG_JUMP_VERTICAL_BOOST,
    LONG_JUMP_COOLDOWN,
    LONG_JUMP_STAMINA_COST
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

test('air acceleration scales by wish speed', () => {
    const strafed = sourceAccelerate(
        { x: 10, z: 0 },
        { x: 0, z: 1 },
        10,
        AIR_ACCEL,
        1 / 60,
        AIR_WISH_CAP
    );
    closeTo(strafed.z, 0.94);
});

test('air acceleration preserves over-cap tangent momentum', () => {
    const strafed = sourceAccelerate(
        { x: 20, z: 0 },
        { x: 0, z: 1 },
        10,
        AIR_ACCEL,
        1 / 60,
        AIR_WISH_CAP
    );
    closeTo(strafed.x, 20);
    closeTo(strafed.z, AIR_WISH_CAP);
    assert.ok(Math.hypot(strafed.x, strafed.z) > 16);
});

test('slippery factor scales both ground friction and acceleration', () => {
    const normalCoast = moveHorizontalState({ x: 10, z: 0 }, { x: 0, z: 0 }, 10, 1 / 120, true);
    const iceCoast = moveHorizontalState(
        { x: 10, z: 0 },
        { x: 0, z: 0 },
        10,
        1 / 120,
        true,
        SLIPPERY_SURFACE_FACTOR
    );
    closeTo(
        10 - iceCoast.velocity.x,
        (10 - normalCoast.velocity.x) * SLIPPERY_SURFACE_FACTOR
    );

    const normalAccel = moveHorizontalState({ x: 0, z: 0 }, { x: 1, z: 0 }, 10, 1 / 120, true);
    const iceAccel = moveHorizontalState(
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        10,
        1 / 120,
        true,
        SLIPPERY_SURFACE_FACTOR
    );
    closeTo(iceAccel.velocity.x, normalAccel.velocity.x * SLIPPERY_SURFACE_FACTOR);
});

test('fixed horizontal substeps are stable across common frame rates', () => {
    const simulate = fps => {
        let velocity = { x: 0, z: 0 };
        let position = { x: 0, z: 0 };
        for (let i = 0; i < fps; i++) {
            const moved = moveHorizontalState(velocity, { x: 1, z: 0 }, 10, 1 / fps, true);
            velocity = moved.velocity;
            position = {
                x: position.x + moved.displacement.x,
                z: position.z + moved.displacement.z
            };
        }
        return { velocity, position };
    };

    const at120 = simulate(120);
    for (const fps of [30, 60]) {
        const result = simulate(fps);
        closeTo(result.velocity.x, at120.velocity.x);
        closeTo(result.position.x, at120.position.x);
    }
});

test('editable targets are excluded from gameplay keydown', () => {
    assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
    assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
    assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isEditableTarget({ tagName: 'CANVAS', isContentEditable: false }), false);
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

test('grounded Ctrl+Space+W triggers one capped longjump', () => {
    const result = resolveLongJump({
        ctrlDown: true,
        spaceDown: true,
        forwardDown: true,
        onGround: true,
        comboHeld: false,
        dashActive: false,
        cooldown: 0,
        stamina: 100,
        velocity: { x: 4, z: 0 },
        forward: { x: 1, z: 0 }
    });

    assert.equal(result.triggered, true);
    assert.equal(result.onGround, false);
    closeTo(Math.hypot(result.velocity.x, result.velocity.z), LONG_JUMP_SPEED);
    assert.ok(Math.hypot(result.velocity.x, result.velocity.z) <= LONG_JUMP_MAX_SPEED);
    assert.equal(result.verticalVel, LONG_JUMP_VERTICAL_BOOST);
    assert.equal(result.cooldown, LONG_JUMP_COOLDOWN);
    assert.equal(result.stamina, 100 - LONG_JUMP_STAMINA_COST);
    assert.deepEqual(result.event, {
        type: 'longjump',
        staminaCost: LONG_JUMP_STAMINA_COST,
        cooldown: LONG_JUMP_COOLDOWN
    });

    const held = resolveLongJump({
        ctrlDown: true,
        spaceDown: true,
        forwardDown: true,
        onGround: true,
        comboHeld: result.comboHeld,
        dashActive: false,
        cooldown: 0,
        stamina: 100,
        velocity: result.velocity,
        forward: { x: 1, z: 0 }
    });
    assert.equal(held.triggered, false);
});

test('longjump rejects missing gates and active dash without spending stamina', () => {
    const base = {
        ctrlDown: true,
        spaceDown: true,
        forwardDown: true,
        onGround: true,
        comboHeld: false,
        dashActive: false,
        cooldown: 0,
        stamina: 100,
        velocity: { x: 3, z: 2 },
        verticalVel: -2,
        forward: { x: 1, z: 0 }
    };
    const blocked = [
        { forwardDown: false },
        { onGround: false },
        { dashActive: true },
        { cooldown: 0.1 },
        { stamina: LONG_JUMP_STAMINA_COST - 1 }
    ];

    for (const gate of blocked) {
        const result = resolveLongJump({ ...base, ...gate });
        assert.equal(result.triggered, false);
        assert.equal(result.stamina, gate.stamina ?? base.stamina);
        assert.deepEqual(result.velocity, base.velocity);
        assert.equal(result.verticalVel, base.verticalVel);
        assert.equal(result.event, null);
    }
});

test('longjump clamps combined tangent momentum to its safe maximum', () => {
    const result = resolveLongJump({
        ctrlDown: true,
        spaceDown: true,
        forwardDown: true,
        onGround: true,
        comboHeld: false,
        dashActive: false,
        cooldown: 0,
        stamina: 100,
        velocity: { x: 12, z: 15 },
        forward: { x: 1, z: 0 }
    });

    assert.equal(result.triggered, true);
    closeTo(Math.hypot(result.velocity.x, result.velocity.z), LONG_JUMP_MAX_SPEED);
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
