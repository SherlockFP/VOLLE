const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CATALOG, ProfileStore } = require('../server/profile-store');

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
    assert.equal(store.purchase(profile, 'ball', 'inferno').status, 200);
    assert.equal(profile.currency, 130);
    assert.equal(store.purchase(profile, 'ball', 'fire').status, 409);
    assert.equal(store.purchase(profile, 'ball', 'missing').status, 404);
});

test('ball catalog contains the new cosmetic skin collection', () => {
    for (const id of ['inferno', 'frostbite', 'voltstorm', 'nebula', 'creeper', 'happy', 'glitch', 'void_eye', 'candy', 'solar', 'toxic', 'disco', 'magma', 'ocean', 'honey', 'dragon', 'portal', 'moon', 'pumpkin', 'matrix', 'sakura', 'blackhole']) {
        assert.ok(Number.isInteger(CATALOG.ball[id]) && CATALOG.ball[id] > 0, `${id} missing from server catalog`);
    }
});

test('wearable catalog is server-priced and migrated through its own ownership field', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.equal(Object.keys(CATALOG.cosmetic).length, 30);
    const session = store.session('', 'Player', {
        currency: 1000,
        ownedCosmetics: ['cape_ember', 'unknown_cosmetic']
    });
    const profile = store.authenticate(session.token);
    assert.deepEqual(profile.ownedCosmetics, ['cape_ember']);
    assert.equal(store.purchase(profile, 'cosmetic', 'pet_slime').status, 200);
    assert.ok(profile.ownedCosmetics.includes('pet_slime'));
});

test('pre-wearable persisted profiles normalize before cosmetic purchase', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Legacy', { currency: 1000 });
    const file = path.join(dir, 'profiles.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw[session.profile.id].ownedCosmetics;
    delete raw[session.profile.id].equippedWearables;
    fs.writeFileSync(file, JSON.stringify(raw));
    const restored = new ProfileStore(file);
    const profile = restored.authenticate(session.token);
    assert.deepEqual(profile.ownedCosmetics, []);
    assert.equal(restored.purchase(profile, 'cosmetic', 'pet_slime').status, 200);
});

test('server case opening is priced, persistent, and idempotent', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Cases', { currency: 1000 });
    const profile = store.authenticate(session.token);
    const first = store.openCase(profile, 'elemental', 'case:elemental:first', 0);
    assert.equal(first.status, 200);
    assert.deepEqual(first.result.reward, { id: 'magma', type: 'ball', rarity: 'legendary' });
    assert.ok(profile.ownedBalls.includes('magma'));
    const replay = store.openCase(profile, 'elemental', 'case:elemental:first', 0.99);
    assert.equal(replay.replayed, true);
    assert.equal(profile.currency, 810);
});

test('legacy migration clamps currency and filters unknown ownership', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player', {
        currency: 999999,
        ownedBalls: ['fire', 'inferno', 'developer_only']
    });
    assert.equal(session.profile.currency, 10000);
    assert.deepEqual(session.profile.ownedBalls, ['classic', 'fire', 'inferno']);
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
    assert.equal(reward.coins, 5);
    assert.equal(store.reward(profile, { matchId: 'match-1' }).status, 409);
});
