// tests/combo-charge.test.mjs — V3_UX_ROADMAP.md 3.3: combo-based ability charge.
// Chained perfect deflects shave flat seconds off the active skill's cooldown
// (js/skills.js perfectDeflectCooldownCut). Pure function: chainLength comes from
// perfect-deflect.js's resolvePerfectDeflect().chain.count (already 0 on any
// normal/great/miss deflect — see tests/perfect-deflect.test.mjs "chain expires,
// restarts" coverage), totalCutThisRound is the caller-tracked running budget.
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileGameMethod } from './game-source.mjs';

import {
    PERFECT_DEFLECT_COOLDOWN_CUT,
    perfectDeflectCooldownCut
} from '../js/skills.js';

test('no chain (0 or negative) grants no cut', () => {
    assert.equal(perfectDeflectCooldownCut(0), 0);
    assert.equal(perfectDeflectCooldownCut(-1), 0);
    assert.equal(perfectDeflectCooldownCut(0, 3), 0);
});

test('first perfect of a chain cuts 1.0s', () => {
    assert.equal(perfectDeflectCooldownCut(1), PERFECT_DEFLECT_COOLDOWN_CUT.first);
    assert.equal(perfectDeflectCooldownCut(1), 1.0);
});

test('consecutive perfects (chain 2+) cut 1.5s', () => {
    assert.equal(perfectDeflectCooldownCut(2), PERFECT_DEFLECT_COOLDOWN_CUT.chained);
    assert.equal(perfectDeflectCooldownCut(2), 1.5);
    assert.equal(perfectDeflectCooldownCut(3), 1.5);
    assert.equal(perfectDeflectCooldownCut(10), 1.5, 'chain length beyond 2 still flat 1.5s, no further scaling');
});

test('chain length is truncated toward zero (defensive against fractional input)', () => {
    assert.equal(perfectDeflectCooldownCut(1.9), 1.0, 'truncates to chain 1, not rounds up to 2');
    assert.equal(perfectDeflectCooldownCut(2.9), 1.5);
});

test('non-finite or non-numeric chain length is treated as no chain', () => {
    assert.equal(perfectDeflectCooldownCut(NaN), 0);
    assert.equal(perfectDeflectCooldownCut(Infinity), 0);
    assert.equal(perfectDeflectCooldownCut(undefined), 0);
    assert.equal(perfectDeflectCooldownCut(null), 0);
});

test('round cap: total granted this round never exceeds roundCap (6.0s)', () => {
    assert.equal(PERFECT_DEFLECT_COOLDOWN_CUT.roundCap, 6.0);
    // Simulate a long chain (chain length pinned at whatever a real chain reaches,
    // e.g. perfect-deflect.js DEFLECT_CHAIN_RULES.cap = 5) hitting the cut function
    // back-to-back, threading totalCutThisRound through exactly as game.js does.
    let total = 0;
    const applied = [];
    for (let i = 0; i < 10; i++) {
        const chainLength = i === 0 ? 1 : 2; // first perfect, then all consecutive
        const cut = perfectDeflectCooldownCut(chainLength, total);
        applied.push(cut);
        total += cut;
    }
    assert.ok(total <= PERFECT_DEFLECT_COOLDOWN_CUT.roundCap, `total ${total} must not exceed cap`);
    assert.equal(total, PERFECT_DEFLECT_COOLDOWN_CUT.roundCap, 'budget should be fully (but not over-) consumed');
    // First cut is 1.0 (chain 1), rest are 1.5 until the cap truncates the last one.
    assert.equal(applied[0], 1.0);
    assert.equal(applied[1], 1.5);
    // 1.0 + 1.5*3 = 5.5, next full 1.5 would overshoot 6.0 -> clamped to 0.5, then 0 after.
    const nonZero = applied.filter(c => c > 0);
    assert.deepEqual(nonZero, [1.0, 1.5, 1.5, 1.5, 0.5]);
    assert.equal(applied.slice(5).every(c => c === 0), true, 'once cap is hit, further cuts are 0');
});

test('cap boundary: exactly at cap grants nothing further, partial remainder clamps the last cut', () => {
    assert.equal(perfectDeflectCooldownCut(2, 6.0), 0, 'already at cap');
    assert.equal(perfectDeflectCooldownCut(2, 6.5), 0, 'over cap (defensive) still clamps to 0, not negative');
    // 5.5 leaves exactly 0.5s of budget — an exact binary fraction, so this stays
    // float-safe (unlike e.g. 6.0 - 5.9, which is not exactly representable).
    assert.equal(perfectDeflectCooldownCut(2, 5.5), 0.5, 'partial remainder near the cap is granted, not the full 1.5');
});

test('negative or non-finite totalCutThisRound is treated as 0 already spent', () => {
    assert.equal(perfectDeflectCooldownCut(1, -5), 1.0);
    assert.equal(perfectDeflectCooldownCut(1, NaN), 1.0);
    assert.equal(perfectDeflectCooldownCut(1, undefined), 1.0, 'default param covers the common call site');
});

test('chain break (chain resets to 0 upstream in perfect-deflect.js) yields no cut', () => {
    // Mirrors js/perfect-deflect.js updateDeflectChain: any non-perfect tier resets
    // chain.count to 0, so a broken chain naturally flows into chainLength=0 here.
    assert.equal(perfectDeflectCooldownCut(0, 2.5), 0);
});

// ---------------------------------------------------------------------------
// Real game.js _applyPerfectDeflectCooldownCut, extracted + run in isolation
// (same approach as tests/hitreg-feel.test.mjs's kill-confirm methods) —
// verifies the actual shipped wiring: skillCooldowns mutation, no-op when the
// skill isn't cooling, and the per-round budget Map threading through
// perfectDeflectCooldownCut exactly as game.js's two call sites do.
// ---------------------------------------------------------------------------

const applyPerfectDeflectCooldownCut = compileGameMethod('_applyPerfectDeflectCooldownCut', {
    perfectDeflectCooldownCut
});

function makeGame(overrides = {}) {
    return {
        _perfectDeflectCutTotals: new Map(),
        _applyPerfectDeflectCooldownCut: applyPerfectDeflectCooldownCut,
        ...overrides
    };
}

test('_applyPerfectDeflectCooldownCut: reduces the equipped skill cooldown by the cut amount', () => {
    const game = makeGame();
    const entity = { loadout: { skill: 'slow' }, skillCooldowns: { slow: 20 } };
    const cut = game._applyPerfectDeflectCooldownCut(entity, 1, 'local');
    assert.equal(cut, 1.0);
    assert.equal(entity.skillCooldowns.slow, 19);
    assert.equal(game._perfectDeflectCutTotals.get('local'), 1.0);
});

test('_applyPerfectDeflectCooldownCut: no-ops (and spends no budget) when the skill is not on cooldown', () => {
    const game = makeGame();
    const entity = { loadout: { skill: 'slow' }, skillCooldowns: { slow: 0 } };
    const cut = game._applyPerfectDeflectCooldownCut(entity, 1, 'local');
    assert.equal(cut, 0);
    assert.equal(entity.skillCooldowns.slow, 0);
    assert.equal(game._perfectDeflectCutTotals.has('local'), false);
});

test('_applyPerfectDeflectCooldownCut: clamps at 0, never drives a cooldown negative', () => {
    const game = makeGame();
    const entity = { loadout: { skill: 'slow' }, skillCooldowns: { slow: 0.4 } };
    const cut = game._applyPerfectDeflectCooldownCut(entity, 1, 'local');
    assert.equal(cut, 1.0, 'the granted cut is still the nominal 1.0s (spent against the round budget)');
    assert.equal(entity.skillCooldowns.slow, 0, 'but the actual cooldown floors at 0');
});

test('_applyPerfectDeflectCooldownCut: separate roundKeys (local vs each remote playerId) get independent budgets', () => {
    const game = makeGame();
    const local = { loadout: { skill: 'heal' }, skillCooldowns: { heal: 50 } };
    const remote = { loadout: { skill: 'heal' }, skillCooldowns: { heal: 50 } };
    for (let i = 0; i < 6; i++) game._applyPerfectDeflectCooldownCut(local, 2, 'local');
    for (let i = 0; i < 6; i++) game._applyPerfectDeflectCooldownCut(remote, 2, 'peer-42');
    assert.equal(game._perfectDeflectCutTotals.get('local'), 6.0, "local player's own 6s cap");
    assert.equal(game._perfectDeflectCutTotals.get('peer-42'), 6.0, "remote player's own separate 6s cap, unaffected by local");
    assert.equal(local.skillCooldowns.heal, 44);
    assert.equal(remote.skillCooldowns.heal, 44);
});

test('_applyPerfectDeflectCooldownCut: missing entity/loadout/skillCooldowns is a safe no-op', () => {
    const game = makeGame();
    assert.equal(game._applyPerfectDeflectCooldownCut(null, 1, 'local'), 0);
    assert.equal(game._applyPerfectDeflectCooldownCut({}, 1, 'local'), 0);
    assert.equal(game._applyPerfectDeflectCooldownCut({ loadout: {} }, 1, 'local'), 0);
});
