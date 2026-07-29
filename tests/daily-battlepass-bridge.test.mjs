// tests/daily-battlepass-bridge.test.mjs — Pure dailyXpAward function and daily->battlepass
// idempotency across day rollover (roadmap 3.6). Tests the pure award calculation and the
// stateful path through Daily.claim() + claimCompletionBonus().
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { Daily, DAILY_CHALLENGE_XP, DAILY_ALL_COMPLETE_BONUS_XP, dailyXpAward } = await import('../js/daily.js');
const { xpForTier } = await import('../js/battlepass.js');

// Mirrors js/daily.js's own todayKey() for test fixtures.
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeChallenge(id, overrides = {}) {
    return { id, name: id, emoji: '', target: 1, type: 'games', reward: 100, progress: 1, claimed: false, ...overrides };
}

function setDailyState(challenges, { date = todayKey(), bonusGranted = false } = {}) {
    Daily.data = { date, challenges, bonusGranted };
    Daily._save();
}

test.beforeEach(() => {
    memory.clear();
    // Force Daily to reload from the empty localStorage.
    Daily._load();
});

// ===== Pure function: dailyXpAward =====

test('dailyXpAward(0) returns 0', () => {
    assert.equal(dailyXpAward(0), 0);
});

test('dailyXpAward(1, false) returns DAILY_CHALLENGE_XP', () => {
    assert.equal(dailyXpAward(1, false), DAILY_CHALLENGE_XP);
});

test('dailyXpAward(3, false) returns 3 * DAILY_CHALLENGE_XP', () => {
    assert.equal(dailyXpAward(3, false), 3 * DAILY_CHALLENGE_XP);
});

test('dailyXpAward(3, true) returns 3 * DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP', () => {
    const expected = 3 * DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP;
    assert.equal(dailyXpAward(3, true), expected);
});

test('dailyXpAward(allComplete: true but 0 claimed) returns only bonus', () => {
    assert.equal(dailyXpAward(0, true), DAILY_ALL_COMPLETE_BONUS_XP);
});

test('dailyXpAward full daily clear is 250 xp (modest, less than 3 base tiers)', () => {
    const fullDaily = dailyXpAward(3, true);
    assert.equal(fullDaily, 250);
    // Verify the full daily is less than 3x the lowest tier cost (100), so it advances
    // ~2-2.5 tiers at the start but doesn't trivialize progression.
    assert.ok(fullDaily < xpForTier(1) * 3, 'full daily must be < 3x base tier cost');
});

test('dailyXpAward hostile: negative input degraded to 0', () => {
    assert.equal(dailyXpAward(-5, false), 0);
});

test('dailyXpAward hostile: NaN input degraded to 0', () => {
    assert.equal(dailyXpAward(NaN, false), 0);
});

test('dailyXpAward hostile: string input coerced then degraded to 0 if non-integer', () => {
    assert.equal(dailyXpAward('abc', false), 0);
});

test('dailyXpAward hostile: Infinity input degraded to 0', () => {
    assert.equal(dailyXpAward(Infinity, false), 0);
});

test('dailyXpAward with non-boolean allComplete defaults to false', () => {
    assert.equal(dailyXpAward(3, 'yes'), 3 * DAILY_CHALLENGE_XP);
    assert.equal(dailyXpAward(3, 1), 3 * DAILY_CHALLENGE_XP);
});

// ===== Stateful: Idempotency =====

test('single challenge completion grants DAILY_CHALLENGE_XP exactly once', () => {
    setDailyState([
        makeChallenge('a', { progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    
    assert.equal(Daily.claim('a'), 100);
    assert.equal(Daily.claim('a'), false, 'second claim must be rejected');
    assert.equal(Daily.isBonusClaimed(), false, 'bonus should not fire with only 1/3 claimed');
});

test('repeated evaluation of claimCompletionBonus is idempotent', () => {
    setDailyState([
        makeChallenge('a', { claimed: true }),
        makeChallenge('b', { claimed: true }),
        makeChallenge('c', { claimed: true })
    ]);
    
    const first = Daily.claimCompletionBonus();
    assert.equal(first, true, 'first call must return true');
    assert.equal(Daily.isBonusClaimed(), true);
    
    const second = Daily.claimCompletionBonus();
    assert.equal(second, false, 'second call must return false (already granted)');
});

test('all-three bonus fires exactly once on the 3rd claim', () => {
    setDailyState([
        makeChallenge('a', { progress: 1, target: 1 }),
        makeChallenge('b', { progress: 1, target: 1 }),
        makeChallenge('c', { progress: 1, target: 1 })
    ]);
    
    Daily.claim('a');
    assert.equal(Daily.claimCompletionBonus(), false, 'bonus does not fire at 1/3');
    
    Daily.claim('b');
    assert.equal(Daily.claimCompletionBonus(), false, 'bonus does not fire at 2/3');
    
    Daily.claim('c');
    assert.equal(Daily.claimCompletionBonus(), true, 'bonus fires at 3/3');
    assert.equal(Daily.claimCompletionBonus(), false, 'bonus does not fire a second time');
});

// ===== Day rollover =====

test('day rollover resets claimed and bonusGranted flags without retroactive re-grant', () => {
    // Day 1: all three claimed and bonus granted
    setDailyState(
        [
            makeChallenge('a', { claimed: true }),
            makeChallenge('b', { claimed: true }),
            makeChallenge('c', { claimed: true })
        ],
        { date: '2026-07-25', bonusGranted: true }
    );
    
    // Verify starting state
    assert.equal(Daily.data.date, '2026-07-25');
    assert.equal(Daily.data.bonusGranted, true);
    const firstDayState = JSON.parse(JSON.stringify(Daily.data));
    
    // Force _load to re-check against todayKey(), which is different, so it resets
    Daily._load();
    
    // Verify the reset happened: all challenges unclaimed, bonus not granted.
    // (The date will be set to today, not yesterday, because _reset() calls todayKey().)
    assert.equal(Daily.data.bonusGranted, false, 'bonus must be reset on rollover');
    assert.notEqual(Daily.data.date, firstDayState.date, 'date must have rolled to today');
    Daily.data.challenges.forEach(c => {
        assert.equal(c.claimed, false, `challenge ${c.id} must be unclaimed on rollover`);
    });
});

test('xp from repeated method calls never re-grants on same day', () => {
    setDailyState([
        makeChallenge('a', { progress: 1, target: 1 }),
        makeChallenge('b', { progress: 1, target: 1 }),
        makeChallenge('c', { progress: 1, target: 1 })
    ]);
    
    // Claim all three
    Daily.claim('a');
    Daily.claim('b');
    Daily.claim('c');
    Daily.claimCompletionBonus();
    
    // Attempt to re-check the bonus repeatedly (as might happen on re-render)
    const bonusAttempts = Array(5).fill(0).map(() => Daily.claimCompletionBonus());
    assert.deepEqual(bonusAttempts, [false, false, false, false, false], 'bonus must never re-grant');
});

// ===== Verification: Total XP matches pure function contract =====

test('total XP from method path equals dailyXpAward pure contract', () => {
    setDailyState([
        makeChallenge('a', { progress: 1, target: 1 }),
        makeChallenge('b', { progress: 1, target: 1 }),
        makeChallenge('c', { progress: 1, target: 1 })
    ]);
    
    // Simulate claiming all three (which marks claimed: true and fires bonus on 3rd)
    Daily.claim('a');
    Daily.claim('b');
    Daily.claim('c');
    Daily.claimCompletionBonus();
    
    // Compute XP from the method path
    const methodXp = Daily.data.challenges.length * DAILY_CHALLENGE_XP +
                     (Daily.isBonusClaimed() ? DAILY_ALL_COMPLETE_BONUS_XP : 0);
    const pureXp = dailyXpAward(3, true);
    
    assert.equal(methodXp, pureXp, 'method-driven XP must match pure function');
    assert.equal(methodXp, 250);
});

// ===== Integration: constants must not diverge =====

test('DAILY_CHALLENGE_XP must be present and non-zero', () => {
    assert.ok(typeof DAILY_CHALLENGE_XP === 'number');
    assert.ok(DAILY_CHALLENGE_XP > 0);
});

test('DAILY_ALL_COMPLETE_BONUS_XP must be present and non-zero', () => {
    assert.ok(typeof DAILY_ALL_COMPLETE_BONUS_XP === 'number');
    assert.ok(DAILY_ALL_COMPLETE_BONUS_XP > 0);
});

test('constants match hardcoded value expectations (50 + 100 = 250 full daily)', () => {
    assert.equal(DAILY_CHALLENGE_XP, 50);
    assert.equal(DAILY_ALL_COMPLETE_BONUS_XP, 100);
    assert.equal(dailyXpAward(3, true), 250);
});
