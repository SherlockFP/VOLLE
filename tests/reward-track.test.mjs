// Free case cadence: every 3rd rewarded match grants a case, five times (accounts on
// the server, guests locally), and login streak days 3/5/7 add a case to the coins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import * as client from '../js/reward-track.js';

const require = createRequire(import.meta.url);
const server = require('../server/reward-track.js');
const { ProfileStore } = require('../server/profile-store.js');

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};
const { Store } = await import('../js/store.js');

test('browser mirror behaves exactly like the server module', () => {
    assert.deepEqual(client.STARTER_TRACK_CASES, server.STARTER_TRACK_CASES);
    assert.equal(client.STARTER_TRACK_EVERY, server.STARTER_TRACK_EVERY);
    assert.deepEqual(client.STREAK_CASES, server.STREAK_CASES);
    let a = null; let b = null;
    for (let i = 0; i < 20; i++) {
        const x = client.advanceStarterTrack(a); const y = server.advanceStarterTrack(b);
        assert.deepEqual(x, y); assert.deepEqual(client.starterTrackStatus(x.track), server.starterTrackStatus(y.track));
        a = x.track; b = y.track;
    }
    for (let day = -1; day <= 30; day++) assert.equal(client.streakCaseForDay(day), server.streakCaseForDay(day));
    for (const junk of [null, 'x', { matches: -4, granted: 99 }, { matches: 1e9 }]) {
        assert.deepEqual(client.normalizeStarterTrack(junk), server.normalizeStarterTrack(junk));
    }
});

test('a case every 3rd match, five cases total, escalating', () => {
    let track = null; const grants = [];
    for (let match = 1; match <= 20; match++) {
        const step = server.advanceStarterTrack(track);
        track = step.track;
        if (step.caseId) grants.push([match, step.caseId]);
    }
    assert.deepEqual(grants, [[3, 'kickoff'], [6, 'chroma'], [9, 'arsenal'], [12, 'elemental'], [15, 'mythic']]);
    assert.equal(server.starterTrackStatus(track).done, true);
    assert.deepEqual(server.starterTrackStatus({ matches: 4, granted: 1 }), { every: 3, cap: 5, granted: 1, progress: 1, nextCase: 'chroma', done: false });
});

test('login streak adds a case on days 3, 5 and 7 of every week', () => {
    const cases = Array.from({ length: 14 }, (_, i) => server.streakCaseForDay(i + 1));
    assert.deepEqual(cases, [null, null, 'kickoff', null, 'chroma', null, 'mythic', null, null, 'kickoff', null, 'chroma', null, 'mythic']);
});

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-starter-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

test('accounts: the server grants the starter case once per match and exposes progress', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.authenticate(store.session('', 'Starter').token);
    const before = { ...profile.earnedCases };
    const starterCases = [];
    for (let i = 1; i <= 16; i++) {
        const result = store.reward(profile, { matchId: `starter-match-${i}`, won: i % 2 === 0 });
        if (result.starterCase) starterCases.push([i, result.starterCase]);
        if (i === 3) {
            const replay = store.reward(profile, { matchId: 'starter-match-3', won: true });
            assert.equal(replay.replayed, true);
            assert.equal(replay.starterCase, 'kickoff', 'a replay reports the original grant');
            assert.equal(profile.starterTrack.matches, 3, 'a replay never advances the track');
        }
        if (i === 4) assert.deepEqual(store._public(profile).starterTrack, { every: 3, cap: 5, granted: 1, progress: 1, nextCase: 'chroma', done: false });
    }
    assert.deepEqual(starterCases, [[3, 'kickoff'], [6, 'chroma'], [9, 'arsenal'], [12, 'elemental'], [15, 'mythic']]);
    for (const id of ['chroma', 'arsenal', 'elemental', 'mythic']) {
        assert.ok(profile.earnedCases[id] >= (before[id] || 0) + 1, id);
    }
    const reloaded = new ProfileStore(store.filePath).getById(profile.id);
    assert.equal(reloaded.starterTrack.granted, 5);
});

test('accounts: streak day 3 grants a Kickoff case on top of the coins, replay-safe', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.authenticate(store.session('', 'Streaker').token);
    const day = 86400000; const start = Date.UTC(2026, 0, 1, 12);
    assert.equal(store.streakClaim(profile, 'streak-req-01', start).rewardCase, null);
    assert.equal(store.streakClaim(profile, 'streak-req-02', start + day).rewardCase, null);
    const kickoffBefore = profile.earnedCases.kickoff || 0;
    const third = store.streakClaim(profile, 'streak-req-03', start + 2 * day);
    assert.equal(third.day, 3);
    assert.equal(third.rewardCase, 'kickoff');
    assert.equal(profile.earnedCases.kickoff, kickoffBefore + 1);
    const replay = store.streakClaim(profile, 'streak-req-03', start + 2 * day);
    assert.equal(replay.replayed, true);
    assert.equal(replay.rewardCase, 'kickoff');
    assert.equal(profile.earnedCases.kickoff, kickoffBefore + 1);
});

test('guests are offered the track (sign-up gated); only the server grants starter cases', () => {
    const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /'#menu-streak-badge', '#menu-starter-card',/);
    assert.match(main, /const grantedCases = freshAuthorityResult && synced \? \[[\s\S]{0,200}\{ id: synced\.starterCase, source: 'starter_track'/);
    assert.match(main, /if \(guest\) \{\s+if \(title\) title\.textContent = t\('menu\.starterGuestTitle'/);
    Store.reset();
    assert.deepEqual(Store.getStarterTrackStatus(), { every: 3, cap: 5, granted: 0, progress: 0, nextCase: 'kickoff', done: false });
    // Offline account fallback: the local streak claim mirrors the server's case days.
    Store.set('dailyStreak', { count: 2, lastClaimDay: '2026-01-02' });
    const claim = Store._claimLoginStreakLocal(new Date(Date.UTC(2026, 0, 3, 9)));
    assert.equal(claim.day, 3);
    assert.equal(claim.rewardCase, 'kickoff');
    assert.equal(Store.get('earnedCases').kickoff, 1);
});
