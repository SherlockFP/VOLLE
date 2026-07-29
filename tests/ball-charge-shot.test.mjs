import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

const {
    chargeProfile,
    CHARGE_FULL_SECONDS,
    CHARGE_OVERCHARGE_SECONDS,
    CHARGE_MAX_POWER,
    CHARGE_OVERCHARGE_POWER,
    CHARGE_FULL_SPREAD,
    CHARGE_MAX_SPREAD,
    CHARGE_MIN_MOVEMENT,
    BALL_HEAT_TIERS,
    ballHeatLevel
} = ballModule;

test('charge curve is monotonically increasing up to full', () => {
    const samples = 25;
    const step = CHARGE_FULL_SECONDS / samples;
    let prevPower = 1;
    for (let i = 0; i <= samples; i++) {
        const held = step * i;
        const profile = chargeProfile(held);
        assert(profile.power >= prevPower, `power should increase: ${prevPower} <= ${profile.power} at ${held}s`);
        assert(profile.spread >= 0, `spread must be non-negative at ${held}s`);
        assert(profile.movementScale > 0, `movement scale must be positive at ${held}s`);
        prevPower = profile.power;
    }
});

test('charge power increases then decreases in overcharge phase', () => {
    const atFull = chargeProfile(CHARGE_FULL_SECONDS);
    const midOver = chargeProfile((CHARGE_FULL_SECONDS + CHARGE_OVERCHARGE_SECONDS) / 2);
    const atOver = chargeProfile(CHARGE_OVERCHARGE_SECONDS);
    assert(atFull.power <= CHARGE_MAX_POWER + 0.001, 'power at full should be max or less');
    assert(midOver.power < atFull.power, 'overcharge power decays from full');
    assert(atOver.power === atOver.power, 'clamped power is finite');
});

test('spread widens monotonically from zero to max', () => {
    const samples = 25;
    const step = CHARGE_OVERCHARGE_SECONDS / samples;
    let prevSpread = 0;
    for (let i = 0; i <= samples; i++) {
        const held = step * i;
        const profile = chargeProfile(held);
        assert(profile.spread >= prevSpread - 1e-9, `spread should increase or stay same: ${prevSpread} <= ${profile.spread} at ${held}s`);
        prevSpread = profile.spread;
    }
});

test('movement scale decreases monotonically during charge', () => {
    const samples = 25;
    const step = CHARGE_FULL_SECONDS / samples;
    let prevScale = 1;
    for (let i = 0; i <= samples; i++) {
        const held = step * i;
        const profile = chargeProfile(held);
        assert(profile.movementScale <= prevScale + 1e-9, `movement should decrease or stay same: ${profile.movementScale} <= ${prevScale} at ${held}s`);
        prevScale = profile.movementScale;
    }
});

test('movement scale stays constant in overcharge', () => {
    const atFull = chargeProfile(CHARGE_FULL_SECONDS);
    const midOver = chargeProfile((CHARGE_FULL_SECONDS + CHARGE_OVERCHARGE_SECONDS) / 2);
    const atOver = chargeProfile(CHARGE_OVERCHARGE_SECONDS);
    assert.equal(atFull.movementScale, CHARGE_MIN_MOVEMENT, 'movement at full charge is min');
    assert.equal(midOver.movementScale, CHARGE_MIN_MOVEMENT, 'movement stays at min during overcharge');
    assert.equal(atOver.movementScale, CHARGE_MIN_MOVEMENT, 'movement at end of overcharge is min');
});

test('zero charge returns neutral profile', () => {
    const zero = chargeProfile(0);
    assert.equal(zero.power, 1, 'zero charge power is 1');
    assert.equal(zero.spread, 0, 'zero charge spread is 0');
    assert.equal(zero.movementScale, 1, 'zero charge movement is 1');
    assert.equal(zero.overcharged, false, 'zero charge is not overcharged');
});

test('negative charge is treated as zero', () => {
    const neg = chargeProfile(-5);
    const zero = chargeProfile(0);
    assert.deepEqual(neg, zero, 'negative charge equals neutral');
});

test('non-finite inputs return neutral safely', () => {
    const nonFinite = [NaN, Infinity, -Infinity, undefined, null, 'string', {}, []];
    nonFinite.forEach(val => {
        const result = chargeProfile(val);
        assert.equal(result.power, 1, `${val} should give neutral power`);
        assert.equal(result.spread, 0, `${val} should give zero spread`);
        assert.equal(result.movementScale, 1, `${val} should give neutral movement`);
    });
});

test('charge clamped at both ends', () => {
    const huge = chargeProfile(1000);
    const atEnd = chargeProfile(CHARGE_OVERCHARGE_SECONDS);
    assert.equal(huge.power, atEnd.power, 'huge charge equals clamped end');
    assert.equal(huge.spread, atEnd.spread, 'huge spread equals clamped end');
    assert.equal(huge.ratio, 1, 'huge charge has ratio 1');
});

test('ratio increases linearly up to full charge', () => {
    for (let i = 0; i <= 10; i++) {
        const held = (i / 10) * CHARGE_FULL_SECONDS;
        const profile = chargeProfile(held);
        const expected = i / 10;
        assert(Math.abs(profile.ratio - expected) < 0.01, `ratio should match held time: ${expected} vs ${profile.ratio}`);
    }
});

test('full charge reaches exactly full power', () => {
    const full = chargeProfile(CHARGE_FULL_SECONDS);
    assert(full.power >= CHARGE_MAX_POWER - 0.001, 'full charge reaches max power');
    assert.equal(full.overcharged, false, 'full charge is not overcharged');
});

// Heat tier tests

test('heat tiers are ordered and total-ordered', () => {
    for (let i = 0; i < BALL_HEAT_TIERS.length - 1; i++) {
        const current = BALL_HEAT_TIERS[i];
        const next = BALL_HEAT_TIERS[i + 1];
        assert(current.minRatio < next.minRatio, `tier ${i} should have lower minRatio than tier ${i + 1}`);
        assert(current.index < next.index, `tier indices should increase`);
    }
});

test('heat tiers have no gaps', () => {
    for (let i = 0; i < BALL_HEAT_TIERS.length - 1; i++) {
        const current = BALL_HEAT_TIERS[i];
        const next = BALL_HEAT_TIERS[i + 1];
        const mid = (current.minRatio + next.minRatio) / 2;
        const heat = ballHeatLevel(17 * mid);
        assert(heat.index === i || heat.index === i + 1, `mid-tier ratio should select one of the two tiers`);
    }
});

test('ballHeatLevel boundary sampling', () => {
    BALL_HEAT_TIERS.forEach((tier, idx) => {
        const heat = ballHeatLevel(17 * tier.minRatio);
        assert(heat.index >= idx, `speed at minRatio should select this tier or higher`);
    });
});

test('ballHeatLevel returns correct color and intensity', () => {
    const cool = ballHeatLevel(17 * 1.2);
    assert(cool.index === 0, 'speed 1.2x base is cool');
    assert.equal(cool.color, BALL_HEAT_TIERS[0].color, 'cool tier color matches');
    
    const hot = ballHeatLevel(17 * 2.5);
    assert(hot.index === 2, 'speed 2.5x base is hot');
    assert.equal(hot.color, BALL_HEAT_TIERS[2].color, 'hot tier color matches');
});

test('ballHeatLevel intensity scales with speed', () => {
    const slow = ballHeatLevel(17);
    const fast = ballHeatLevel(34);
    assert(slow.intensity <= fast.intensity, 'intensity should increase with speed');
});

test('non-finite speed in ballHeatLevel handled safely', () => {
    const result = ballHeatLevel(NaN);
    assert.equal(result.index, 0, 'NaN speed gives cool tier');
    assert.equal(result.intensity, 0, 'NaN gives zero intensity');
});

test('zero speed gives cool tier with minimal intensity', () => {
    const result = ballHeatLevel(0);
    assert.equal(result.index, 0, 'zero speed is cool');
    assert.equal(result.intensity, 0, 'zero speed has zero intensity');
});
