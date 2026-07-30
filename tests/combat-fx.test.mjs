// tests/combat-fx.test.mjs — pure helpers behind the dmg/combo visual escalation
// pass: damage-number tier classification, DOM pool reuse logic, combo tier
// thresholds, and the audio pitch ramp derived from them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyDamageTier,
    nextPoolCursor,
    damageJitterFor,
    comboTier,
    comboPitchRate
} from '../js/combat-fx.js';

// ---------------------------------------------------------------------------
// classifyDamageTier
// ---------------------------------------------------------------------------

test('classifyDamageTier: small hits under 22 read as small', () => {
    assert.equal(classifyDamageTier(5), 'small');
    assert.equal(classifyDamageTier(21), 'small');
    assert.equal(classifyDamageTier(0), 'small');
});

test('classifyDamageTier: 22-44 reads as medium (base 25 body hit lands here)', () => {
    assert.equal(classifyDamageTier(22), 'medium');
    assert.equal(classifyDamageTier(25), 'medium');
    assert.equal(classifyDamageTier(44), 'medium');
});

test('classifyDamageTier: 45+ reads as large', () => {
    assert.equal(classifyDamageTier(45), 'large');
    assert.equal(classifyDamageTier(120), 'large');
});

test('classifyDamageTier: isLethal always wins regardless of raw magnitude', () => {
    assert.equal(classifyDamageTier(5, true), 'kill');
    assert.equal(classifyDamageTier(200, true), 'kill');
    assert.equal(classifyDamageTier(0, true), 'kill');
});

test('classifyDamageTier: non-finite/garbage dmg treated as 0 (small, non-lethal)', () => {
    assert.equal(classifyDamageTier(NaN), 'small');
    assert.equal(classifyDamageTier(undefined), 'small');
});

// ---------------------------------------------------------------------------
// nextPoolCursor — damage-number DOM pool round robin
// ---------------------------------------------------------------------------

test('nextPoolCursor: advances by one and wraps at pool size', () => {
    assert.equal(nextPoolCursor(0, 4), 1);
    assert.equal(nextPoolCursor(3, 4), 0);
});

test('nextPoolCursor: cycles through every slot exactly once per lap (0-alloc reuse)', () => {
    const size = 6;
    let cursor = -1;
    const seen = [];
    for (let i = 0; i < size; i++) {
        cursor = nextPoolCursor(cursor, size);
        seen.push(cursor);
    }
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
    // one more lap starts back at 0 — proves reuse, not growth
    assert.equal(nextPoolCursor(cursor, size), 0);
});

test('nextPoolCursor: a non-positive pool size always yields slot 0', () => {
    assert.equal(nextPoolCursor(5, 0), 0);
    assert.equal(nextPoolCursor(5, -1), 0);
});

// ---------------------------------------------------------------------------
// damageJitterFor — deterministic anti-stack offset
// ---------------------------------------------------------------------------

test('damageJitterFor: first slot has zero offset, later slots are offset', () => {
    const first = damageJitterFor(0);
    assert.deepEqual(first, { x: 0, y: 0 });
    const second = damageJitterFor(1);
    assert.ok(second.x !== 0 || second.y !== 0, 'slot 1 must differ from slot 0');
});

test('damageJitterFor: consecutive cursors never collide on the same offset', () => {
    for (let i = 0; i < 8; i++) {
        const a = damageJitterFor(i);
        const b = damageJitterFor(i + 1);
        assert.notDeepEqual(a, b, `slot ${i} and ${i + 1} must not share an offset`);
    }
});

test('damageJitterFor: wraps and stays deterministic (same cursor -> same offset)', () => {
    const a = damageJitterFor(2);
    const b = damageJitterFor(2 + 8); // one full table lap later
    assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// comboTier — visual/audio escalation thresholds
// ---------------------------------------------------------------------------

test('comboTier: below 3 is base tier 0', () => {
    assert.equal(comboTier(0), 0);
    assert.equal(comboTier(1), 0);
    assert.equal(comboTier(2), 0);
});

test('comboTier: 3-5 is tier 1', () => {
    assert.equal(comboTier(3), 1);
    assert.equal(comboTier(5), 1);
});

test('comboTier: 6-9 is tier 2', () => {
    assert.equal(comboTier(6), 2);
    assert.equal(comboTier(9), 2);
});

test('comboTier: 10+ is tier 3 (matches getComboMultiplier cap)', () => {
    assert.equal(comboTier(10), 3);
    assert.equal(comboTier(999), 3);
});

test('comboTier: monotonically non-decreasing as combo grows', () => {
    let prev = comboTier(0);
    for (let combo = 1; combo <= 20; combo++) {
        const t = comboTier(combo);
        assert.ok(t >= prev, `tier must not regress at combo=${combo}`);
        prev = t;
    }
});

// ---------------------------------------------------------------------------
// comboPitchRate — derived audio ramp, single source of truth with comboTier
// ---------------------------------------------------------------------------

test('comboPitchRate: tier 0 is unmodified playback speed', () => {
    assert.equal(comboPitchRate(0), 1);
});

test('comboPitchRate: ramps up 6% per tier and caps at tier 3', () => {
    assert.equal(comboPitchRate(1), 1.06);
    assert.equal(comboPitchRate(2), 1.12);
    assert.equal(comboPitchRate(3), 1.18);
    assert.equal(comboPitchRate(4), 1.18, 'must clamp beyond tier 3, never chipmunk out');
});

test('comboPitchRate composes directly with comboTier for a live combo count', () => {
    assert.equal(comboPitchRate(comboTier(10)), 1.18);
    assert.equal(comboPitchRate(comboTier(1)), 1);
});
