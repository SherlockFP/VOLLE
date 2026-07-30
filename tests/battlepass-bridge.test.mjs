// tests/battlepass-bridge.test.mjs — Wave 3 acceptance coverage for the battlepass
// screen rework (docs/V3_UX_ROADMAP.md 3.6 + the visual redesign in js/ui.js).
// Three focused areas, all pure or store-level (no DOM):
//   1. Bridge XP calc — daily->battlepass xp is proportional to the real xpForTier
//      curve, not an arbitrary/inflated number.
//   2. Double-count protection — the same daily challenge (and the all-3 bonus)
//      can never grant battlepass xp twice, across re-renders and repeated calls.
//   3. Claim/tier-card state derivation (pure) — js/battlepass.js#rewardRowState
//      and #tierCardState, the new single source of truth the redesigned
//      js/ui.js#renderBattlepass reads instead of re-deriving lock/claim logic
//      ad-hoc (that ad-hoc duplication was the root cause of every tier showing
//      a "Premium" lock regardless of whether it was reachable yet).
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
const { Daily, DAILY_CHALLENGE_XP, DAILY_ALL_COMPLETE_BONUS_XP, dailyXpAward } = await import('../js/daily.js');
const { xpForTier, createProgressState, rewardRowState, tierCardState } = await import('../js/battlepass.js');

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
    Store.reset();
});

// ===== 1. Bridge XP calc is proportional to the real curve =====

test('a single daily challenge grants less xp than a full tier costs', () => {
    // The roadmap explicitly warns against over-inflating this bridge. One
    // challenge (of three) should nudge progress, never hand out a free tier.
    assert.ok(dailyXpAward(1, false) < xpForTier(1));
});

test('a full daily clear (3 challenges + all-complete bonus) is a small multiple of one tier, not a runaway number', () => {
    const fullClear = dailyXpAward(3, true);
    assert.equal(fullClear, 3 * DAILY_CHALLENGE_XP + DAILY_ALL_COMPLETE_BONUS_XP);
    // Bounded: at least one tier's worth (the bridge must matter) but well
    // under a lopsided multiple of it (the bridge must not dwarf normal play).
    assert.ok(fullClear >= xpForTier(1));
    assert.ok(fullClear <= xpForTier(1) * 3);
});

test('claiming a real challenge through the store grants exactly the pure dailyXpAward amount', () => {
    setDailyState([
        makeChallenge('a', { reward: 50, progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    const xpBefore = Store.data.battlepass.xp;
    const result = Store.claimDailyChallenge('a');
    assert.ok(result);
    assert.equal(result.xpGranted, dailyXpAward(1, false));
    assert.equal(Store.data.battlepass.xp, xpBefore + dailyXpAward(1, false));
});

// ===== 2. Double-count protection =====

test('re-rendering the battlepass screen after a claim never re-triggers a grant', () => {
    setDailyState([
        makeChallenge('a', { reward: 40, progress: 1, target: 1 }),
        makeChallenge('b', { progress: 0, target: 5 }),
        makeChallenge('c', { progress: 0, target: 5 })
    ]);
    const first = Store.claimDailyChallenge('a');
    assert.ok(first);
    const xpAfterFirst = Store.data.battlepass.xp;
    const tierAfterFirst = Store.data.battlepass.tier;
    // Simulate the UI calling renderBattlepass (which only reads state) several
    // times, and the player re-opening the daily screen and re-attempting the
    // same claim id — none of this may add xp a second time.
    for (let i = 0; i < 3; i++) {
        const again = Store.claimDailyChallenge('a');
        assert.equal(again, null);
    }
    assert.equal(Store.data.battlepass.xp, xpAfterFirst);
    assert.equal(Store.data.battlepass.tier, tierAfterFirst);
});

test('the all-3 completion bonus is granted exactly once even if every challenge is reclaimed in a different order', () => {
    setDailyState([
        makeChallenge('a', { reward: 40 }),
        makeChallenge('b', { reward: 40 }),
        makeChallenge('c', { reward: 40 })
    ]);
    Store.claimDailyChallenge('c');
    Store.claimDailyChallenge('a');
    const xpBeforeLast = Store.data.battlepass.xp;
    const last = Store.claimDailyChallenge('b');
    assert.ok(last);
    assert.equal(last.xpGranted, dailyXpAward(1, true), 'the 3rd claim carries the bonus');
    const xpAfterBonus = Store.data.battlepass.xp;
    assert.ok(xpAfterBonus > xpBeforeLast);
    // Re-checking completion afterward must never add xp again.
    assert.equal(Daily.claimCompletionBonus(), false);
    assert.equal(Store.claimDailyChallenge('a'), null);
    assert.equal(Store.claimDailyChallenge('b'), null);
    assert.equal(Store.claimDailyChallenge('c'), null);
});

// ===== 3. Claim / tier-card state derivation (pure) =====

test('rewardRowState: a future tier is locked-tier regardless of track (no premature Premium badge)', () => {
    const progress = { ...createProgressState(), tier: 2 };
    assert.equal(rewardRowState(progress, 10, 'free', { hasPremium: false }), 'locked-tier');
    assert.equal(rewardRowState(progress, 10, 'premium', { hasPremium: false }), 'locked-tier');
    assert.equal(rewardRowState(progress, 10, 'premium', { hasPremium: true }), 'locked-tier');
});

test('rewardRowState: a reached premium tier without the pass is locked-premium; with the pass it is claimable', () => {
    const progress = { ...createProgressState(), tier: 5 };
    assert.equal(rewardRowState(progress, 3, 'premium', { hasPremium: false }), 'locked-premium');
    assert.equal(rewardRowState(progress, 3, 'premium', { hasPremium: true }), 'claimable');
});

test('rewardRowState: a reached free tier is always claimable regardless of premium ownership', () => {
    const progress = { ...createProgressState(), tier: 5 };
    assert.equal(rewardRowState(progress, 3, 'free', { hasPremium: false }), 'claimable');
    assert.equal(rewardRowState(progress, 3, 'free', { hasPremium: true }), 'claimable');
});

test('rewardRowState: an already-claimed tier reports claimed on its own track only', () => {
    const progress = { ...createProgressState(), tier: 5, claimedFree: [3], premium: true };
    assert.equal(rewardRowState(progress, 3, 'free', { hasPremium: true }), 'claimed');
    assert.equal(rewardRowState(progress, 3, 'premium', { hasPremium: true }), 'claimable');
});

test('rewardRowState: hostile/invalid input degrades to locked-tier instead of throwing', () => {
    assert.equal(rewardRowState(null, 3, 'free'), 'locked-tier');
    assert.equal(rewardRowState(createProgressState(), 999, 'free'), 'locked-tier');
    assert.equal(rewardRowState(createProgressState(), 3, 'bogus'), 'locked-tier');
});

test('tierCardState: tiers behind the current tier are completed, the current tier is current, the rest are future', () => {
    const progress = { ...createProgressState(), tier: 4 };
    assert.equal(tierCardState(progress, 1), 'completed');
    assert.equal(tierCardState(progress, 3), 'completed');
    assert.equal(tierCardState(progress, 4), 'current');
    assert.equal(tierCardState(progress, 5), 'future');
    assert.equal(tierCardState(progress, 50), 'future');
});

test('tierCardState: a fresh season (tier 0) treats tier 1 as the active card, not every card as future', () => {
    const progress = createProgressState();
    assert.equal(tierCardState(progress, 1), 'current');
    assert.equal(tierCardState(progress, 2), 'future');
});

test('tierCardState: max tier reached marks tier 50 as current, not completed', () => {
    const progress = { ...createProgressState(), tier: 50 };
    assert.equal(tierCardState(progress, 49), 'completed');
    assert.equal(tierCardState(progress, 50), 'current');
});
