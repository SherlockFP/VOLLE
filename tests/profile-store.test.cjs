const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../server/profile-store');

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-profile-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

test('session token restores a persisted profile', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const created = store.session('', 'Player');
    const restored = store.session(created.token, 'Renamed');
    assert.equal(restored.profile.id, created.profile.id);
    assert.equal(restored.profile.playerName, 'Renamed');
    assert.equal(restored.profile.tokenHash, undefined);
});

test('purchase validates catalog, ownership and balance', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player', { currency: 500 });
    const profile = store.authenticate(session.token);
    assert.equal(store.purchase(profile, 'ball', 'fire').status, 200);
    assert.equal(profile.currency, 350);
    assert.equal(store.purchase(profile, 'ball', 'fire').status, 409);
    assert.equal(store.purchase(profile, 'ball', 'missing').status, 404);
});

test('legacy migration clamps currency and filters unknown ownership', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player', {
        currency: 999999,
        ownedBalls: ['fire', 'developer_only']
    });
    assert.equal(session.profile.currency, 10000);
    assert.deepEqual(session.profile.ownedBalls, ['classic', 'fire']);
    const empty = store.session('', 'Empty', { currency: 0 });
    assert.equal(empty.profile.currency, 0);
});

test('match rewards are bounded and idempotent', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const reward = store.reward(profile, {
        matchId: 'match-1',
        won: true,
        deflections: 9999,
        score: 9999
    });
    assert.equal(reward.status, 200);
    assert.equal(reward.coins, 500);
    assert.equal(store.reward(profile, { matchId: 'match-1' }).status, 409);
});
