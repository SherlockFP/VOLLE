import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

const {
    spinFromStrafe,
    spinLateralAcceleration,
    decaySpin,
    SPIN_STRAFE_THRESHOLD,
    SPIN_MAX,
    SPIN_EPSILON,
    SPIN_DECAY_PER_SECOND,
    DEFLECT_SPIN_SCALE
} = ballModule;

// ============================================================================
// Zero-spin is a bit-for-bit no-op: spinLateralAcceleration(0) returns exactly
// { x: 0, y: 0, z: 0 } regardless of velocity or dt.
// ============================================================================

test('spinLateralAcceleration(0) returns exact zero vector', () => {
    const tests = [
        { v: { x: 0, y: 0, z: 0 }, dt: 0.016 },
        { v: { x: 10, y: 0, z: 5 }, dt: 0.016 },
        { v: { x: -3.5, y: 2.1, z: 8 }, dt: 0.025 },
        { v: { x: 0.001, y: 0, z: 0.001 }, dt: 0.001 }
    ];
    tests.forEach(({ v, dt }) => {
        const result = spinLateralAcceleration(0, v, dt);
        assert.equal(result.x, 0, `zero spin, non-zero velocity: x should be 0`);
        assert.equal(result.y, 0, `zero spin, non-zero velocity: y should be 0`);
        assert.equal(result.z, 0, `zero spin, non-zero velocity: z should be 0`);
    });
});

test('spinLateralAcceleration returns zero for non-finite spin', () => {
    const spin_vals = [NaN, Infinity, -Infinity];
    const v = { x: 10, y: 0, z: 5 };
    spin_vals.forEach(spin => {
        const result = spinLateralAcceleration(spin, v, 0.016);
        assert.equal(result.x, 0, `spin=${spin} should give zero x`);
        assert.equal(result.y, 0, `spin=${spin} should give zero y`);
        assert.equal(result.z, 0, `spin=${spin} should give zero z`);
    });
});

test('spinLateralAcceleration returns zero for non-finite velocity', () => {
    const vel_vals = [
        { x: NaN, y: 0, z: 0 },
        { x: Infinity, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 }
    ];
    vel_vals.forEach(v => {
        const result = spinLateralAcceleration(1.5, v, 0.016);
        assert.equal(result.x, 0, `non-finite velocity should give zero x`);
        assert.equal(result.y, 0, `non-finite velocity should give zero y`);
        assert.equal(result.z, 0, `non-finite velocity should give zero z`);
    });
});

test('spinLateralAcceleration returns zero for non-positive dt', () => {
    const v = { x: 10, y: 0, z: 5 };
    [0, -0.016, NaN, -Infinity].forEach(dt => {
        const result = spinLateralAcceleration(1.5, v, dt);
        assert.equal(result.x, 0, `dt=${dt} should give zero x`);
        assert.equal(result.y, 0, `dt=${dt} should give zero y`);
        assert.equal(result.z, 0, `dt=${dt} should give zero z`);
    });
});

test('spinLateralAcceleration lateral direction matches spin sign', () => {
    const v = { x: 10, y: 0, z: 0 };
    const dt = 0.016;
    
    const posResult = spinLateralAcceleration(1.5, v, dt);
    const negResult = spinLateralAcceleration(-1.5, v, dt);
    
    // Positive spin -> positive z acceleration (perpendicular to x-velocity)
    // Negative spin -> negative z acceleration
    assert(posResult.z > 0, 'positive spin should give positive z acceleration for x-velocity');
    assert(negResult.z < 0, 'negative spin should give negative z acceleration for x-velocity');
});

test('spinLateralAcceleration magnitude increases with spin magnitude', () => {
    const v = { x: 10, y: 0, z: 5 };
    const dt = 0.016;
    
    const weak = spinLateralAcceleration(0.5, v, dt);
    const strong = spinLateralAcceleration(2, v, dt);
    
    const weakMag = Math.hypot(weak.x, weak.z);
    const strongMag = Math.hypot(strong.x, strong.z);
    assert(strongMag > weakMag, 'stronger spin should produce larger lateral acceleration');
});

test('spinLateralAcceleration y component is always zero', () => {
    const tests = [
        { spin: 1, v: { x: 10, y: 5, z: 3 }, dt: 0.016 },
        { spin: -2, v: { x: 0, y: 10, z: 5 }, dt: 0.025 },
        { spin: 3, v: { x: -5, y: -5, z: 0 }, dt: 0.01 }
    ];
    tests.forEach(({ spin, v, dt }) => {
        const result = spinLateralAcceleration(spin, v, dt);
        assert.equal(result.y, 0, `y should always be zero`);
    });
});

// ============================================================================
// Spin decay: monotonically approaches zero, never overshoots.
// ============================================================================

test('decaySpin monotonically approaches zero', () => {
    let spin = 2.5;
    const dt = 0.016;
    let prevAbs = Math.abs(spin);
    // Decay should reach epsilon within about 500 frames (~8 seconds of gameplay)
    for (let i = 0; i < 500; i++) {
        const next = decaySpin(spin, dt);
        const nextAbs = Math.abs(next);
        assert(nextAbs <= prevAbs + 1e-9, `spin should decay: ${nextAbs} <= ${prevAbs}`);
        if (nextAbs < SPIN_EPSILON) {
            assert.equal(next, 0, 'spin should clamp to exact zero when below epsilon');
            return;
        }
        prevAbs = nextAbs;
        spin = next;
    }
    // If we've decayed for 8 seconds and haven't hit epsilon, verify we're still decaying
    assert(Math.abs(spin) < 0.1, 'spin should be significantly decayed after 8 seconds');
});

test('decaySpin returns zero for zero input', () => {
    [0, 0.0, -0.0].forEach(spin => {
        const result = decaySpin(spin, 0.016);
        assert.equal(result, 0, `zero spin should return zero`);
    });
});

test('decaySpin returns spin unchanged for non-positive dt', () => {
    const spin = 1.5;
    [0, -0.016, NaN].forEach(dt => {
        const result = decaySpin(spin, dt);
        assert.equal(result, spin, `dt=${dt} should not change spin`);
    });
});

test('decaySpin handles non-finite spin gracefully', () => {
    const nonFinite = [NaN, Infinity, -Infinity];
    nonFinite.forEach(spin => {
        const result = decaySpin(spin, 0.016);
        assert.equal(result, 0, `non-finite spin ${spin} should return zero`);
    });
});

// ============================================================================
// Strafe spin: lateral velocity perpendicular to forward direction.
// ============================================================================

test('spinFromStrafe below threshold returns zero', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const strafes = [
        { x: 0, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 0.3, y: 5, z: 0 }
    ];
    strafes.forEach(strafe => {
        const result = spinFromStrafe(strafe, forward, 'normal');
        assert.equal(result, 0, `strafe below threshold should return zero`);
    });
});

test('spinFromStrafe above threshold produces non-zero spin', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const strafe = { x: 2, y: 0, z: 0 };
    const result = spinFromStrafe(strafe, forward, 'normal');
    assert(result !== 0, 'strafe above threshold should produce spin');
});

test('spinFromStrafe sign matches strafe direction', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const rightStrafe = { x: 2, y: 0, z: 0 };
    const leftStrafe = { x: -2, y: 0, z: 0 };
    
    const rightSpin = spinFromStrafe(rightStrafe, forward, 'normal');
    const leftSpin = spinFromStrafe(leftStrafe, forward, 'normal');
    
    assert(rightSpin * leftSpin < 0, 'opposite strafes should produce opposite spins');
});

test('spinFromStrafe tier scale is applied correctly', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const strafe = { x: 3, y: 0, z: 0 };
    
    const normal = spinFromStrafe(strafe, forward, 'normal');
    const great = spinFromStrafe(strafe, forward, 'great');
    const perfect = spinFromStrafe(strafe, forward, 'perfect');
    
    assert(normal !== 0, 'normal tier should produce spin');
    assert(great !== 0, 'great tier should produce spin');
    assert(perfect !== 0, 'perfect tier should produce spin');
    
    const normalMag = Math.abs(normal);
    const greatMag = Math.abs(great);
    const perfectMag = Math.abs(perfect);
    
    assert(greatMag > normalMag, `great (${greatMag}) > normal (${normalMag})`);
    assert(perfectMag > greatMag, `perfect (${perfectMag}) > great (${greatMag})`);
});

test('spinFromStrafe handles non-finite inputs gracefully', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const badStrafes = [
        { x: NaN, y: 0, z: 0 },
        { x: Infinity, y: 0, z: 0 },
        null,
        undefined
    ];
    badStrafes.forEach(strafe => {
        const result = spinFromStrafe(strafe, forward, 'normal');
        assert.equal(result, 0, `non-finite strafe should return zero`);
    });
    
    const badForwards = [
        { x: NaN, y: 0, z: 0 },
        null,
        undefined
    ];
    badForwards.forEach(fw => {
        const strafe = { x: 2, y: 0, z: 0 };
        const result = spinFromStrafe(strafe, fw, 'normal');
        assert.equal(result, 0, `non-finite forward should return zero`);
    });
});

test('spinFromStrafe clamped at SPIN_MAX', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const hugeStrafe = { x: 1000, y: 0, z: 0 };
    const result = spinFromStrafe(hugeStrafe, forward, 'perfect');
    assert(Math.abs(result) <= SPIN_MAX, `spin should be clamped to SPIN_MAX`);
});

test('spinFromStrafe returns zero for nearly-parallel forward', () => {
    const forward = { x: 0.0001, y: 0, z: 0.0001 };
    const strafe = { x: 3, y: 0, z: 0 };
    const result = spinFromStrafe(strafe, forward, 'normal');
    assert.equal(result, 0, 'near-zero forward should return zero');
});

test('invalid tier defaults to normal scale', () => {
    const forward = { x: 0, y: 0, z: 1 };
    const strafe = { x: 2, y: 0, z: 0 };
    const result = spinFromStrafe(strafe, forward, 'invalid-tier');
    const normalResult = spinFromStrafe(strafe, forward, 'normal');
    assert.equal(result, normalResult, 'invalid tier should use normal scale');
});
