// tests/ad-reward.test.mjs — House-promo "watch & earn" server rules:
// daily cap, cooldown, idempotency, UTC-day reset. ProfileStore.adReward().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfileStore } from '../server/profile-store.js';

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-adreward-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

const DAY1 = Date.UTC(2026, 0, 1, 12, 0, 0);

test('first ad-reward claim of the day pays 50 coins and decrements remaining', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const before = profile.currency;
    const result = store.adReward(profile, 'req-1', DAY1);
    assert.equal(result.status, 200);
    assert.equal(result.coins, 50);
    assert.equal(profile.currency, before + 50);
    assert.equal(result.remaining, 4);
    assert.equal(result.cap, 5);
    assert.equal(result.replayed, false);
});

test('cooldown blocks a second claim inside 90 seconds', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    store.adReward(profile, 'req-1', DAY1);
    const tooSoon = store.adReward(profile, 'req-2', DAY1 + 89 * 1000);
    assert.equal(tooSoon.status, 429);
    assert.match(tooSoon.error, /cooldown/);
    const ok = store.adReward(profile, 'req-2', DAY1 + 90 * 1000);
    assert.equal(ok.status, 200);
    assert.equal(ok.remaining, 3);
});

test('replaying the same requestId is idempotent and does not double-pay', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const first = store.adReward(profile, 'same-req', DAY1);
    const currencyAfterFirst = profile.currency;
    const replay = store.adReward(profile, 'same-req', DAY1 + 200 * 1000);
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.equal(replay.coins, 50);
    assert.equal(profile.currency, currencyAfterFirst, 'currency must not change on replay');
    assert.equal(first.coins, replay.coins);
});

test('daily cap of 5 blocks a 6th claim on the same UTC day', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    let now = DAY1;
    for (let i = 0; i < 5; i++) {
        const result = store.adReward(profile, `req-${i}`, now);
        assert.equal(result.status, 200, `claim ${i} should succeed`);
        now += 91 * 1000;
    }
    const sixth = store.adReward(profile, 'req-5', now);
    assert.equal(sixth.status, 429);
    assert.match(sixth.error, /limit/);
    assert.equal(profile.adRewards.count, 5);
});

test('remaining resets when the UTC day rolls over, even mid-cooldown', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    let now = DAY1;
    for (let i = 0; i < 5; i++) {
        store.adReward(profile, `req-${i}`, now);
        now += 91 * 1000;
    }
    assert.equal(store.adReward(profile, 'req-blocked', now).status, 429);
    const nextDay = DAY1 + 24 * 60 * 60 * 1000;
    const result = store.adReward(profile, 'req-next-day', nextDay);
    assert.equal(result.status, 200);
    assert.equal(result.remaining, 4);
    assert.equal(profile.adRewards.day, new Date(nextDay).toISOString().slice(0, 10));
});

test('a stale persisted profile without adRewards normalizes to a clean default', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-adreward-legacy-'));
    const file = path.join(dir, 'profiles.json');
    fs.writeFileSync(file, JSON.stringify({
        'legacy-id': { id: 'legacy-id', playerName: 'Old', currency: 200, tokenHash: 'x' }
    }));
    const store = new ProfileStore(file);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.getById('legacy-id');
    assert.deepEqual(profile.adRewards, { day: '', count: 0, lastAt: 0, receipts: [] });
    const result = store.adReward(profile, 'req-1', DAY1);
    assert.equal(result.status, 200);
    assert.equal(result.remaining, 4);
});
