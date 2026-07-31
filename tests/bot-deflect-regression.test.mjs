// tests/bot-deflect-regression.test.mjs — Regression test for the CRITICAL "bots never
// deflect" bug fixed in js/bot.js tryDeflect(). js/bot.js imports 'three' and can't run
// under `node --test` directly (see tests/bot-tendency.test.mjs), so this file mirrors the
// tryDeflect() alert-range/commit state machine verbatim as a pure shadow copy. Keep these
// literals byte-identical to js/bot.js if either changes.
//
// Root cause: commit ea037d5 added sequential wind-up telegraphing (windUpTimer/windUpTime)
// AFTER the pre-existing reaction-timer gate, but never widened the alert range that gates
// when the reaction timer starts filling — it stayed hardcoded at 8, sized only to cover
// reaction time (see the comment it shipped with). A ball closing at typical speed then
// crossed the bot's entire engagement window before the reaction+wind-up sequence could
// ever finish, so tryDeflect() almost never returned true: in a clean isolated live-browser
// test (straight-line ball, medium difficulty) it committed 0/40 times before this fix,
// 32/40 after.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Mirrors js/bot.js DIFFICULTY_SETTINGS ---
const DIFFICULTY_SETTINGS = {
    easy:   { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08 },
    hard:   { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02 }
};

// --- Mirrors js/bot.js tryDeflect()'s alert-range formula ---
function computeAlertRange(reactionTime, windUpTime, ballSpeed, attackRange) {
    return ballSpeed * (reactionTime + windUpTime) + attackRange;
}

// --- Mirrors js/bot.js tryDeflect()'s commit state machine. The alive/attacking early-out
// is omitted: every real call site already gates on that before calling tryDeflect, so it
// isn't part of the reaction/wind-up timing behavior under test here. ---
function makeBotState(diff) {
    return {
        reactionTime: diff.reactionTime, windUpTime: diff.windUp,
        deflectChance: diff.deflectChance, mishitRate: diff.mishitRate,
        reactionTimer: 0, windUpTimer: 0, windUpCommitted: false,
        _deflectDecided: false, _willDeflect: false, _mishit: false
    };
}

function tryDeflect(state, dist, ballSpeed, attackRange, dt, rng) {
    const alertRange = computeAlertRange(state.reactionTime, state.windUpTime, ballSpeed, attackRange);
    if (dist > alertRange) {
        state.reactionTimer = 0;
        state._deflectDecided = false;
        state.windUpTimer = 0;
        state.windUpCommitted = false;
        return false;
    }
    state.reactionTimer += dt;
    if (state.reactionTimer < state.reactionTime) return false;
    if (dist > attackRange) return false;

    if (!state.windUpCommitted && !state._deflectDecided) {
        state._deflectDecided = true;
        state._willDeflect = rng() < state.deflectChance;
    }
    if (!state._willDeflect) {
        state.windUpTimer = 0;
        state.windUpCommitted = false;
        return false;
    }
    if (!state.windUpCommitted) {
        state.windUpTimer += dt;
        if (state.windUpTimer < state.windUpTime) return false;
        state.windUpCommitted = true;
    }
    state._mishit = rng() < state.mishitRate;
    state._deflectDecided = false;
    state.windUpTimer = 0;
    state.windUpCommitted = false;
    return true;
}

// Simulates a ball closing straight in on a stationary bot at constant speed, calling
// tryDeflect once per frame exactly like game.js's per-frame bot-deflection block
// ("Bot deflections — before ball moves"), and reports whether a deflect decision (a true
// return, mishit or clean) was ever produced before the ball closed the whole distance.
function simulateApproach(diff, { ballSpeed = 17, attackRange = 2, dt = 1 / 60, maxSteps = 240, rng = () => 0.3 } = {}) {
    const state = makeBotState(diff);
    let dist = computeAlertRange(state.reactionTime, state.windUpTime, ballSpeed, attackRange);
    for (let frame = 0; frame < maxSteps; frame++) {
        if (tryDeflect(state, dist, ballSpeed, attackRange, dt, rng)) {
            return { committed: true, distAtCommit: dist, frame };
        }
        dist -= ballSpeed * dt;
    }
    return { committed: false, distAtCommit: dist, frame: maxSteps };
}

test('REGRESSION: alert range covers the FULL commit budget (reaction + wind-up), not just reaction time', () => {
    const ballSpeed = 17, attackRange = 2;
    for (const diff of Object.values(DIFFICULTY_SETTINGS)) {
        const alertRange = computeAlertRange(diff.reactionTime, diff.windUp, ballSpeed, attackRange);
        const reactionOnlyRange = ballSpeed * diff.reactionTime + attackRange;
        // Wind-up is a nonzero, sequential delay after reaction: the range must strictly
        // exceed a reaction-only range, otherwise wind-up eats into time the bot doesn't have.
        assert.ok(alertRange > reactionOnlyRange,
            `alertRange (${alertRange}) must exceed reaction-only range (${reactionOnlyRange})`);
    }
});

test('a bot within deflect range and reaction window produces a deflect decision (medium)', () => {
    const result = simulateApproach(DIFFICULTY_SETTINGS.medium);
    assert.equal(result.committed, true, 'medium bot never committed to a deflect');
    assert.ok(result.frame < 200, `commit took unreasonably long (frame=${result.frame})`);
});

test('a bot within deflect range and reaction window produces a deflect decision (easy)', () => {
    const result = simulateApproach(DIFFICULTY_SETTINGS.easy);
    assert.equal(result.committed, true, 'easy bot never committed to a deflect');
});

test('a bot within deflect range and reaction window produces a deflect decision (hard)', () => {
    const result = simulateApproach(DIFFICULTY_SETTINGS.hard);
    assert.equal(result.committed, true, 'hard bot never committed to a deflect');
});

test('REGRESSION GUARD: the pre-fix hardcoded alert range of 8 could not fit the medium/easy commit budget', () => {
    // Documents why bots stopped deflecting: with the shipped constant (8), the reaction
    // timer only had (8 - attackRange) / ballSpeed seconds to fill before the ball reached
    // attack range, and wind-up then had to fit in whatever remained. For medium/easy, the
    // full reaction+windUp budget is larger than that entire pre-attack-range window, so the
    // bot could never finish committing before the ball arrived.
    const ballSpeed = 17, attackRange = 2, preFixAlertRange = 8;
    const windowBeforeAttackRange = (preFixAlertRange - attackRange) / ballSpeed;
    for (const [name, diff] of Object.entries(DIFFICULTY_SETTINGS)) {
        if (name === 'hard') continue; // hard's small budget happened to still fit
        const fullBudget = diff.reactionTime + diff.windUp;
        assert.ok(fullBudget > windowBeforeAttackRange,
            `${name}: expected pre-fix budget overrun (budget=${fullBudget}s, window=${windowBeforeAttackRange}s)`);
    }
});

test('a ball far outside the alert range never accumulates a reaction timer', () => {
    const state = makeBotState(DIFFICULTY_SETTINGS.medium);
    const result = tryDeflect(state, /* dist */ 100, 17, 2, 1 / 60, () => 0.3);
    assert.equal(result, false);
    assert.equal(state.reactionTimer, 0);
});

test('faster balls get a proportionally wider alert range (distance = speed * time)', () => {
    const slow = computeAlertRange(0.35, 0.15, 10, 2);
    const fast = computeAlertRange(0.35, 0.15, 30, 2);
    assert.ok(fast > slow);
    assert.equal(fast - slow, (30 - 10) * (0.35 + 0.15));
});
