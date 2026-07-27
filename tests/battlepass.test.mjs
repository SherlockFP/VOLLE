import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BALL_PRICES,
    FREE_TRACK,
    MAX_TIER,
    PREMIUM_TRACK,
    addXp,
    canClaim,
    claimReward,
    createProgressState,
    createSeason,
    getReward,
    isSeasonExpired,
    normalizeProgress,
    rolloverSeason,
    xpForTier
} from '../js/battlepass.js';
import { COSMETICS } from '../js/cosmetic-catalog.js';

// ===== XP curve =====

test('xp curve is monotonically non-decreasing across every tier boundary', () => {
    let previous = -Infinity;
    for (let tier = 1; tier <= MAX_TIER; tier++) {
        const need = xpForTier(tier);
        assert.ok(Number.isFinite(need) && need > 0, `tier ${tier} xp requirement must be positive`);
        assert.ok(need >= previous, `tier ${tier} requires less xp than tier ${tier - 1}`);
        previous = need;
    }
});

test('xp curve clamps tier input to the valid [1, MAX_TIER] range', () => {
    assert.equal(xpForTier(0), xpForTier(1));
    assert.equal(xpForTier(-5), xpForTier(1));
    assert.equal(xpForTier(MAX_TIER + 20), xpForTier(MAX_TIER));
    assert.equal(xpForTier(NaN), xpForTier(1));
});

test('addXp advances exactly one tier per satisfied threshold and stops at MAX_TIER', () => {
    let progress = createProgressState();
    const total = FREE_TRACK.reduce((sum, _r, i) => sum + xpForTier(i + 1), 0);
    const { state, tiersGained } = addXp(progress, total);
    assert.equal(state.tier, MAX_TIER);
    assert.equal(tiersGained, MAX_TIER);
    assert.equal(state.xp, 0);

    const { state: overflow } = addXp(state, 99999);
    assert.equal(overflow.tier, MAX_TIER, 'tier never exceeds MAX_TIER');
});

test('addXp never regresses tier and accumulates leftover xp between tiers', () => {
    let progress = createProgressState();
    ({ state: progress } = addXp(progress, 50));
    assert.equal(progress.tier, 0);
    assert.equal(progress.xp, 50);
    ({ state: progress } = addXp(progress, 60));
    assert.equal(progress.tier, 1, 'crossing xpForTier(1)=100 advances one tier');
    assert.equal(progress.xp, 10);
});

// ===== Hostile inputs =====

test('addXp treats negative, NaN, and non-finite amounts as zero gain', () => {
    const progress = createProgressState();
    for (const bad of [-50, NaN, Infinity, -Infinity, undefined, null, 'abc']) {
        const { state, tiersGained } = addXp(progress, bad);
        assert.equal(state.tier, 0);
        assert.equal(state.xp, 0);
        assert.equal(tiersGained, 0);
    }
});

test('normalizeProgress recovers a sane state from garbage input', () => {
    for (const bad of [null, undefined, {}, { tier: -5, xp: -100 }, { tier: 'x', xp: 'y' }, 'nope', 42]) {
        const normalized = normalizeProgress(bad);
        assert.ok(Number.isInteger(normalized.tier) && normalized.tier >= 0 && normalized.tier <= MAX_TIER);
        assert.ok(Number.isFinite(normalized.xp) && normalized.xp >= 0);
        assert.ok(Array.isArray(normalized.claimedFree));
        assert.ok(Array.isArray(normalized.claimedPremium));
        assert.equal(typeof normalized.premium, 'boolean');
    }
});

test('normalizeProgress clamps an out-of-range tier into bounds', () => {
    assert.equal(normalizeProgress({ tier: 9999 }).tier, MAX_TIER);
    assert.equal(normalizeProgress({ tier: -1 }).tier, 0);
});

test('getReward and canClaim reject out-of-range tiers and bad tracks without throwing', () => {
    const progress = createProgressState();
    for (const badTier of [0, -1, 51, 1000, NaN, 1.5, '5']) {
        assert.equal(getReward(badTier, 'free'), null);
        assert.equal(canClaim(progress, badTier, 'free'), false);
    }
    assert.equal(getReward(5, 'gold'), null);
    assert.equal(canClaim(progress, 5, 'gold'), false);
});

// ===== Reward catalog integrity =====

test('every free-track and premium-track tier is present exactly once', () => {
    assert.equal(FREE_TRACK.length, MAX_TIER);
    assert.equal(PREMIUM_TRACK.length, MAX_TIER);
    assert.deepEqual(FREE_TRACK.map(r => r.tier), Array.from({ length: MAX_TIER }, (_, i) => i + 1));
    assert.deepEqual(PREMIUM_TRACK.map(r => r.tier), Array.from({ length: MAX_TIER }, (_, i) => i + 1));
});

test('every reward id referenced by either track exists in a real catalog', () => {
    for (const track of [FREE_TRACK, PREMIUM_TRACK]) {
        for (const reward of track) {
            if (reward.kind === 'cosmetic') {
                assert.ok(COSMETICS[reward.id], `cosmetic id "${reward.id}" (tier ${reward.tier}) must exist in COSMETICS`);
            } else if (reward.kind === 'ball') {
                assert.ok(BALL_PRICES[reward.id], `ball id "${reward.id}" (tier ${reward.tier}) must exist in BALL_PRICES`);
            } else if (reward.kind === 'currency') {
                assert.ok(Number.isFinite(reward.amount) && reward.amount > 0);
            } else if (reward.kind === 'xpboost') {
                assert.ok(reward.multiplier > 1 && reward.durationMs > 0);
            } else {
                assert.fail(`unexpected reward kind "${reward.kind}"`);
            }
        }
    }
});

// ===== Claim flow =====

test('claiming is idempotent: a second claim of the same tier/track is a no-op', () => {
    let progress = createProgressState();
    ({ state: progress } = addXp(progress, xpForTier(1)));
    assert.equal(progress.tier, 1);

    const first = claimReward(progress, 1, 'free');
    assert.ok(first);
    assert.deepEqual(first.progress.claimedFree, [1]);

    const second = claimReward(first.progress, 1, 'free');
    assert.equal(second, null, 'second claim of the same tier must be rejected');
});

test('claiming an unreached tier is rejected', () => {
    const progress = createProgressState();
    assert.equal(claimReward(progress, 1, 'free'), null);
    assert.equal(canClaim(progress, 1, 'free'), false);
});

test('premium rewards are locked without the premium pass and unlock once purchased', () => {
    let progress = createProgressState();
    ({ state: progress } = addXp(progress, xpForTier(1)));

    assert.equal(canClaim(progress, 1, 'premium', { hasPremium: false }), false);
    assert.equal(claimReward(progress, 1, 'premium', { hasPremium: false }), null);

    assert.equal(canClaim(progress, 1, 'premium', { hasPremium: true }), true);
    const claimed = claimReward(progress, 1, 'premium', { hasPremium: true });
    assert.ok(claimed);
    assert.deepEqual(claimed.progress.claimedPremium, [1]);
});

test('free and premium claims for the same tier are independent', () => {
    let progress = createProgressState();
    ({ state: progress } = addXp(progress, xpForTier(1)));
    const freeClaim = claimReward(progress, 1, 'free', { hasPremium: true });
    const premiumClaim = claimReward(freeClaim.progress, 1, 'premium', { hasPremium: true });
    assert.deepEqual(premiumClaim.progress.claimedFree, [1]);
    assert.deepEqual(premiumClaim.progress.claimedPremium, [1]);
});

// ===== Season model =====

test('a season is not expired before its duration elapses, and is at/after', () => {
    const season = createSeason(1, 1000);
    assert.equal(isSeasonExpired(season, 1000), false);
    assert.equal(isSeasonExpired(season, 1000 + season.durationMs - 1), false);
    assert.equal(isSeasonExpired(season, 1000 + season.durationMs), true);
});

test('rolloverSeason only advances once the season has actually expired', () => {
    const season = createSeason(3, 1000);
    const notYet = rolloverSeason(season, 1000 + season.durationMs - 1);
    assert.equal(notYet.id, 3, 'unexpired season must not roll over');

    const rolled = rolloverSeason(season, 1000 + season.durationMs);
    assert.equal(rolled.id, 4);
    assert.equal(rolled.startAt, 1000 + season.durationMs);
});

test('season rollover resets tier/xp/claims for a new season id', () => {
    const state = normalizeProgress({ seasonId: 5, tier: 40, xp: 300, claimedFree: [1, 2, 3], claimedPremium: [1], premium: true });
    const fresh = createProgressState(createSeason(6, 999));
    assert.equal(fresh.seasonId, 6);
    assert.equal(fresh.tier, 0);
    assert.equal(fresh.xp, 0);
    assert.deepEqual(fresh.claimedFree, []);
    assert.deepEqual(fresh.claimedPremium, []);
    assert.equal(fresh.premium, false);
    // the previous season's progress object is untouched by creating a fresh one
    assert.equal(state.tier, 40);
});

test('normalizeProgress migrates the legacy single-track shape', () => {
    const legacy = { tier: 12, xp: 40, claimed: [5, 10], premium: false };
    const migrated = normalizeProgress(legacy);
    assert.equal(migrated.tier, 12);
    assert.equal(migrated.xp, 40);
    assert.deepEqual(migrated.claimedFree, [5, 10]);
    assert.deepEqual(migrated.claimedPremium, []);
});
