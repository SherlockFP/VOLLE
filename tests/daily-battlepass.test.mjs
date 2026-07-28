// daily-battlepass.test.mjs — js/daily.js <-> js/battlepass.js bridge (js/store.js
// #claimDailyChallenge). Covers the progression-loop gap: completing daily
// challenges must grant battlepass XP exactly once per (day, challenge), plus a
// per-day "all 3 done" bonus, surviving day rollover and season rollover.
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { Store } = await import('../js/store.js');
const { Daily, DAILY_CHALLENGE_XP, DAILY_ALL_COMPLETE_BONUS_XP } = await import('../js/daily.js');
const { normalizeProgress, SEASON_DURATION_MS, xpForTier } = await import('../js/battlepass.js');

// Mirrors js/daily.js's own todayKey() (local YYYY-MM-DD) so fixtures pass its
// `data.date !== todayKey()` freshness check without needing to export it.
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeChallenge(id, overrides = {}) {
    return { id, name: id, emoji: '', target: 1, type: 'games', reward: 100, progress: 1, claimed: false, ...overrides };
}

// Writes directly through Daily's own persisted shape (same trick the existing
// store-replay tests use for Store.data) so fixtures don't depend on the
// deterministic-seed challenge picker.
function setDailyState(challenges, { date = todayKey(), bonusGranted = false } = {}) {
    Daily.data = { date, challenges, bonusGranted };
    Daily._save();
}

test.beforeEach(() => {
    Store.reset();
});

// ===== Per-challenge XP =====

test('claiming a single completed challenge grants its coins and DAILY_CHALLENGE_XP', () => {
    setDailyState([
        makeChallenge('a', { reward: 100, progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    const startingCurrency = Store.data.currency;
    const result = Store.claimDailyChallenge('a');
    assert.ok(result);
    assert.equal(result.coins, 100);
    assert.equal(result.xpGranted, DAILY_CHALLENGE_XP);
    assert.equal(Store.data.currency, startingCurrency + 100);
    assert.equal(Store.data.battlepass.tier, 0);
    assert.equal(Store.data.battlepass.xp, DAILY_CHALLENGE_XP);
});

test('an unclaimable challenge (not finished, wrong id) grants nothing and does not touch battlepass', () => {
    setDailyState([
        makeChallenge('a', { progress: 0, target: 5 })
    ]);
    const before = Store.data.battlepass;
    assert.equal(Store.claimDailyChallenge('a'), null, 'progress below target must be rejected');
    assert.equal(Store.claimDailyChallenge('missing'), null, 'unknown challenge id must be rejected');
    assert.equal(Store.claimDailyChallenge(undefined), null, 'undefined id must not crash');
    assert.deepEqual(Store.data.battlepass, before);
});

// ===== Completion bonus =====

test('completing all 3 challenges grants the extra bonus exactly once, on the 3rd claim', () => {
    setDailyState([
        makeChallenge('a', { reward: 60, progress: 1, target: 1 }),
        makeChallenge('b', { reward: 60, progress: 1, target: 1 }),
        makeChallenge('c', { reward: 60, progress: 1, target: 1 })
    ]);
    const r1 = Store.claimDailyChallenge('a');
    const r2 = Store.claimDailyChallenge('b');
    const r3 = Store.claimDailyChallenge('c');
    assert.equal(r1.xpGranted, DAILY_CHALLENGE_XP, 'first claim: no bonus yet');
    assert.equal(r2.xpGranted, DAILY_CHALLENGE_XP, 'second claim: still no bonus');
    assert.equal(r3.xpGranted, DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP, 'third claim completes the day');
    assert.equal(Daily.isBonusClaimed(), true);
});

test('order of claiming does not change total XP granted for the day', () => {
    setDailyState([
        makeChallenge('a', { reward: 60, progress: 1, target: 1 }),
        makeChallenge('b', { reward: 60, progress: 1, target: 1 }),
        makeChallenge('c', { reward: 60, progress: 1, target: 1 })
    ]);
    Store.claimDailyChallenge('c');
    Store.claimDailyChallenge('a');
    const last = Store.claimDailyChallenge('b');
    const totalGranted = 3 * DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP;
    assert.equal(last.xpGranted, DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP);
    // battlepass.addXp rolls xp into tiers, so reconstruct total granted from the
    // final (tier, xp) pair rather than assuming a flat xp field.
    let reconstructed = 0;
    for (let t = 1; t <= Store.data.battlepass.tier; t++) {
        reconstructed += xpForTier(t);
    }
    reconstructed += Store.data.battlepass.xp;
    assert.equal(reconstructed, totalGranted);
});

// ===== Idempotency =====

test('double-claiming the same challenge only grants XP and coins once', () => {
    setDailyState([
        makeChallenge('a', { reward: 100, progress: 1, target: 1 })
    ]);
    const first = Store.claimDailyChallenge('a');
    assert.ok(first);
    const currencyAfterFirst = Store.data.currency;
    const xpAfterFirst = Store.data.battlepass.xp;
    const tierAfterFirst = Store.data.battlepass.tier;

    const second = Store.claimDailyChallenge('a');
    assert.equal(second, null, 'second claim of the same challenge must be rejected');
    assert.equal(Store.data.currency, currencyAfterFirst);
    assert.equal(Store.data.battlepass.xp, xpAfterFirst);
    assert.equal(Store.data.battlepass.tier, tierAfterFirst);
});

test('the completion bonus itself cannot be double-granted even if re-checked repeatedly', () => {
    setDailyState([
        makeChallenge('a', { reward: 60, progress: 1, target: 1, claimed: true }),
        makeChallenge('b', { reward: 60, progress: 1, target: 1, claimed: true }),
        makeChallenge('c', { reward: 60, progress: 1, target: 1, claimed: true })
    ]);
    assert.equal(Daily.claimCompletionBonus(), true, 'first check grants the bonus');
    assert.equal(Daily.claimCompletionBonus(), false, 'second check is a no-op');
    assert.equal(Daily.claimCompletionBonus(), false, 'third check is still a no-op');
});

// ===== Day rollover =====

test('a day rollover resets claimed/bonus flags for new challenges but preserves already-granted battlepass XP', () => {
    setDailyState([
        makeChallenge('a', { reward: 100, progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    Store.claimDailyChallenge('a');
    const xpBeforeRollover = Store.data.battlepass.xp;
    const tierBeforeRollover = Store.data.battlepass.tier;

    // Force a real day rollover through Daily's own _reset() path (stale stored
    // date), rather than mocking the reset directly.
    Daily.data.date = '2000-01-01';
    Daily._save();
    const freshChallenges = Daily.getChallenges();

    assert.notEqual(freshChallenges[0].claimed, undefined);
    assert.equal(freshChallenges.every(c => c.claimed === false), true, 'new day starts fully unclaimed');
    assert.equal(Daily.isBonusClaimed(), false, 'new day starts with the bonus not yet granted');
    assert.equal(Store.data.battlepass.xp, xpBeforeRollover, 'already-granted xp must survive the daily rollover');
    assert.equal(Store.data.battlepass.tier, tierBeforeRollover);

    // A fresh day's challenge grants XP again normally (bonus is per-day, not once-forever).
    setDailyState([
        makeChallenge('new-a', { reward: 50, progress: 1, target: 1 }),
        makeChallenge('new-b', { progress: 0, target: 5 }),
        makeChallenge('new-c', { progress: 0, target: 5 })
    ]);
    const afterNewDay = Store.claimDailyChallenge('new-a');
    assert.ok(afterNewDay);
    assert.equal(afterNewDay.xpGranted, DAILY_CHALLENGE_XP);
});

// ===== Season rollover interaction =====

test('a daily-challenge XP grant that lands on an expired season rolls over first, without crashing or double-counting', () => {
    const expiredSeason = normalizeProgress({
        seasonId: 1,
        seasonStartAt: Date.now() - SEASON_DURATION_MS - 1000,
        tier: 10,
        xp: 300,
        claimedFree: [1, 2, 3],
        claimedPremium: [1],
        premium: true
    });
    Store.data.battlepass = expiredSeason;
    Store.save();

    setDailyState([
        makeChallenge('a', { reward: 100, progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    const result = Store.claimDailyChallenge('a');

    assert.ok(result, 'claim must succeed and not throw across a season boundary');
    assert.equal(Store.data.battlepass.seasonId, 2, 'season rolled over');
    assert.equal(Store.data.battlepass.tier, 0, 'fresh season starts at tier 0, old tier is not carried over');
    assert.equal(Store.data.battlepass.xp, DAILY_CHALLENGE_XP, 'only the new grant applies to the fresh season, no leftover xp');
    assert.deepEqual(Store.data.battlepass.claimedFree, [], 'claimed tiers do not survive a season rollover');
    assert.equal(Store.data.battlepass.premium, false, 'premium flag resets with the season, same as any other battlepass xp grant');
});

// ===== Hostile inputs =====

test('malformed persisted daily state (bad JSON) is recovered without crashing the claim path', () => {
    // Mirrors js/daily.js's DAILY_KEY constant.
    memory.set('dodgball_daily_v1', '{not valid json');
    assert.doesNotThrow(() => Daily.getChallenges());
    assert.doesNotThrow(() => Store.claimDailyChallenge('a'));
    assert.equal(Store.claimDailyChallenge('a'), null);
});

test('malformed persisted daily state (challenges not an array) is recovered without crashing', () => {
    memory.set('dodgball_daily_v1', JSON.stringify({ date: todayKey(), challenges: 'oops', bonusGranted: false }));
    const challenges = Daily.getChallenges();
    assert.ok(Array.isArray(challenges), 'a corrupted challenges field must fall back to a fresh reset');
});

test('a reward-less (undefined) challenge cannot corrupt battlepass progress', () => {
    setDailyState([
        makeChallenge('a', { reward: undefined, progress: 1, target: 1 })
    ]);
    const before = Store.data.battlepass;
    const result = Store.claimDailyChallenge('a');
    assert.equal(result, null, 'a falsy reward must be treated as an invalid/no-op claim');
    assert.deepEqual(Store.data.battlepass, before);
});

test('claimCompletionBonus on an empty or missing challenge list does not throw or grant', () => {
    setDailyState([]);
    assert.equal(Daily.claimCompletionBonus(), false);
    Daily.data.challenges = undefined;
    Daily._save();
    assert.doesNotThrow(() => Daily.claimCompletionBonus());
});
