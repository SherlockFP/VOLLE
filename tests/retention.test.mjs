// tests/retention.test.mjs — Retention wave: first-match-of-day bonus and the
// main-menu login-streak badge. Covers both pure decision logic (js/store.js)
// and the mutating store/server layers (guest localStorage path + account
// server path via ProfileStore), matching js/store.js#matchRewardBreakdown /
// server/profile-store.js#reward,streakClaim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const {
    Store,
    computeStreakState,
    isFirstMatchOfDay,
    loginStreakReward,
    LOGIN_STREAK_CYCLE,
    LOGIN_STREAK_DAILY_COINS,
    LOGIN_STREAK_DAY7_COINS,
    FIRST_MATCH_OF_DAY_BONUS
} = await import('../js/store.js');
const { ProfileStore } = await import('../server/profile-store.js');

function tempProfileStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-retention-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

const UTC_DAY1 = Date.UTC(2026, 0, 1, 10);
const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Pure decision logic — no localStorage/filesystem involved.
// ---------------------------------------------------------------------------

test('pure: isFirstMatchOfDay is true until the UTC day has already been claimed', () => {
    const now = Date.UTC(2026, 0, 10, 8);
    const today = new Date(now).toISOString().slice(0, 10);
    assert.equal(isFirstMatchOfDay('', now), true);
    assert.equal(isFirstMatchOfDay('2026-01-09', now), true);
    assert.equal(isFirstMatchOfDay(today, now), false);
});

test('pure: loginStreakReward pays the daily amount except every 7th day', () => {
    assert.equal(loginStreakReward(1), LOGIN_STREAK_DAILY_COINS);
    assert.equal(loginStreakReward(6), LOGIN_STREAK_DAILY_COINS);
    assert.equal(loginStreakReward(7), LOGIN_STREAK_DAY7_COINS);
    assert.equal(loginStreakReward(14), LOGIN_STREAK_DAY7_COINS);
    assert.equal(loginStreakReward(8), LOGIN_STREAK_DAILY_COINS);
    assert.equal(LOGIN_STREAK_CYCLE, 7);
});

test('pure: computeStreakState reports claimed=true and holds the day number once claimed today', () => {
    const now = Date.UTC(2026, 0, 5, 9);
    const today = new Date(now).toISOString().slice(0, 10);
    const state = computeStreakState({ count: 4, lastClaimDay: today }, now);
    assert.equal(state.claimed, true);
    assert.equal(state.day, 4);
    assert.equal(state.reward, LOGIN_STREAK_DAILY_COINS);
});

test('pure: computeStreakState advances daily, cycles the day-7 bonus, and resets after a skipped day', () => {
    let streak = { count: 0, lastClaimDay: '' };
    const expected = [
        [1, LOGIN_STREAK_DAILY_COINS], [2, LOGIN_STREAK_DAILY_COINS], [3, LOGIN_STREAK_DAILY_COINS],
        [4, LOGIN_STREAK_DAILY_COINS], [5, LOGIN_STREAK_DAILY_COINS], [6, LOGIN_STREAK_DAILY_COINS],
        [7, LOGIN_STREAK_DAY7_COINS], [8, LOGIN_STREAK_DAILY_COINS]
    ];
    let now = UTC_DAY1;
    for (const [day, reward] of expected) {
        const state = computeStreakState(streak, now);
        assert.equal(state.claimed, false);
        assert.equal(state.day, day);
        assert.equal(state.reward, reward);
        streak = { count: state.day, lastClaimDay: state.today };
        now += DAY_MS;
    }
    // Skip an extra day beyond the pending next day — streak must reset to 1.
    now += DAY_MS;
    const resetState = computeStreakState(streak, now);
    assert.equal(resetState.day, 1);
    assert.equal(resetState.reward, LOGIN_STREAK_DAILY_COINS);
});

// ---------------------------------------------------------------------------
// Store level (guest/local path) — mutating localStorage-backed Store.
// ---------------------------------------------------------------------------

test('store: claimFirstMatchOfDay grants once per UTC day and feeds matchRewardBreakdown', () => {
    Store.reset();
    const day1 = new Date(UTC_DAY1);
    assert.equal(Store.claimFirstMatchOfDay(day1), true);
    assert.equal(Store.claimFirstMatchOfDay(day1), false, 'second match same day is not first-of-day');
    const breakdown = Store.matchRewardBreakdown({ won: true, kills: 0, deflects: 0, firstOfDay: true });
    assert.equal(breakdown.base, 120);
    assert.equal(breakdown.bonus, 0);
    assert.equal(breakdown.firstOfDay, FIRST_MATCH_OF_DAY_BONUS);
    assert.equal(breakdown.total, 120 + FIRST_MATCH_OF_DAY_BONUS);
    const noBonus = Store.matchRewardBreakdown({ won: true, kills: 0, deflects: 0, firstOfDay: false });
    assert.equal(noBonus.firstOfDay, 0);
    assert.equal(noBonus.total, 120);
    const day2 = new Date(UTC_DAY1 + DAY_MS);
    assert.equal(Store.claimFirstMatchOfDay(day2), true, 'next UTC day is first-of-day again');
});

test('store: claimLoginStreak (guest) grants coins and rejects a same-day double-claim', async () => {
    Store.reset();
    const now = new Date(UTC_DAY1);
    const before = Store.get('currency');
    const first = await Store.claimLoginStreak('req-guest-1', now);
    assert.equal(first.ok, true);
    assert.equal(first.day, 1);
    assert.equal(first.reward, LOGIN_STREAK_DAILY_COINS);
    assert.equal(Store.get('currency'), before + LOGIN_STREAK_DAILY_COINS);
    const afterFirst = Store.get('currency');
    const second = await Store.claimLoginStreak('req-guest-2', now);
    assert.equal(second.ok, false);
    assert.equal(Store.get('currency'), afterFirst, 'no coins granted on a rejected double-claim');
    const state = Store.getLoginStreakState(now);
    assert.equal(state.claimed, true);
    assert.equal(state.day, 1);
});

test('store: claimLoginStreak (guest) cycles the day-7 bonus across consecutive days and resets on a gap', async () => {
    Store.reset();
    let day = new Date(UTC_DAY1);
    const rewards = [];
    for (let i = 0; i < 8; i++) {
        const result = await Store.claimLoginStreak(`req-cycle-${i}`, day);
        assert.equal(result.ok, true);
        assert.equal(result.day, i + 1);
        rewards.push(result.reward);
        day = new Date(day.getTime() + DAY_MS);
    }
    assert.deepEqual(rewards, [20, 20, 20, 20, 20, 20, 150, 20]);
    // `day` now sits on the pending (unclaimed) 9th day; skip one more to force a gap.
    const gapDay = new Date(day.getTime() + DAY_MS);
    const resetResult = await Store.claimLoginStreak('req-cycle-reset', gapDay);
    assert.equal(resetResult.ok, true);
    assert.equal(resetResult.day, 1);
    assert.equal(resetResult.reward, LOGIN_STREAK_DAILY_COINS);
});

// ---------------------------------------------------------------------------
// Server level (account path) — ProfileStore owns the truth server-side.
// ---------------------------------------------------------------------------

test('server: reward() pays the first-of-day bonus once per UTC day on top of base+bonus', t => {
    const { dir, store } = tempProfileStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const before = profile.currency;
    const first = store.reward(profile, { matchId: 'm1', won: true, score: 0, deflections: 0 }, UTC_DAY1);
    assert.equal(first.firstOfDay, 80);
    assert.equal(first.base, 120);
    assert.equal(first.bonus, 0);
    assert.equal(first.coins, 120);
    assert.equal(profile.currency, before + first.coins + 80);
    const afterFirst = profile.currency;
    const second = store.reward(profile, { matchId: 'm2', won: false, score: 0, deflections: 0 }, UTC_DAY1 + 1000);
    assert.equal(second.firstOfDay, 0);
    assert.equal(profile.currency, afterFirst + second.coins);
    const nextDay = store.reward(profile, { matchId: 'm3', won: false, score: 0, deflections: 0 }, UTC_DAY1 + DAY_MS);
    assert.equal(nextDay.firstOfDay, 80, 'next UTC day pays the bonus again');
});

test('server: existing match-reward formula (base/bonus/coins) is unchanged by the first-of-day addition', t => {
    const { dir, store } = tempProfileStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const reward = store.reward(profile, { matchId: 'match-1', won: true, deflections: 9999, score: 9999 }, UTC_DAY1);
    assert.equal(reward.status, 200);
    assert.equal(reward.base, 120);
    assert.equal(reward.bonus, 60);
    assert.equal(reward.coins, 180);
    const replay = store.reward(profile, { matchId: 'match-1' }, UTC_DAY1);
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.coins, 0);
});

test('server: streakClaim pays day-based coins, cycles on day 7, and rejects a same-day double-claim', t => {
    const { dir, store } = tempProfileStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    let now = UTC_DAY1;
    const rewards = [];
    for (let i = 0; i < 8; i++) {
        const result = store.streakClaim(profile, `streak-req-${i}`, now);
        assert.equal(result.status, 200);
        rewards.push(result.reward);
        now += DAY_MS;
    }
    assert.deepEqual(rewards, [20, 20, 20, 20, 20, 20, 150, 20]);
    // `now` sits on the pending (unclaimed) 9th day. A fresh requestId on the
    // already-claimed 8th day must be rejected outright.
    const dup = store.streakClaim(profile, 'streak-req-dup', now - DAY_MS);
    assert.equal(dup.status, 409);
});

test('server: streakClaim replaying the same requestId is idempotent and does not double-pay', t => {
    const { dir, store } = tempProfileStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const first = store.streakClaim(profile, 'same-streak-req', UTC_DAY1);
    assert.equal(first.status, 200);
    const currencyAfterFirst = profile.currency;
    const replay = store.streakClaim(profile, 'same-streak-req', UTC_DAY1 + 5000);
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.day, first.day);
    assert.equal(replay.reward, first.reward);
    assert.equal(profile.currency, currencyAfterFirst, 'currency must not change on replay');
});

test('server: a stale persisted profile without dailyStreak/lastFirstMatchDay normalizes to clean defaults', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-retention-legacy-'));
    const file = path.join(dir, 'profiles.json');
    fs.writeFileSync(file, JSON.stringify({
        'legacy-id': { id: 'legacy-id', playerName: 'Old', currency: 200, tokenHash: 'x' }
    }));
    const store = new ProfileStore(file);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.getById('legacy-id');
    assert.equal(profile.lastFirstMatchDay, '');
    assert.deepEqual(profile.dailyStreak, { count: 0, lastClaimDay: '', receipts: [] });
    const result = store.streakClaim(profile, 'stale-req-12345', UTC_DAY1);
    assert.equal(result.status, 200);
    assert.equal(result.day, 1);
    assert.equal(result.reward, LOGIN_STREAK_DAILY_COINS);
});
