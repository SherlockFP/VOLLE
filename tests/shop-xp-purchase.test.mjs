import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Store } from '../js/store.js';
import { SHOP_XP_BOOST } from '../js/battlepass.js';

const require = createRequire(import.meta.url);
const { ProfileStore } = require('../server/profile-store.js');
const { SHOP_XP_BOOST: SERVER_BOOST } = require('../server/battlepass-service.js');
function profileFixture(t, currency = 1000) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-xp-checkout-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'profiles.json');
    const server = new ProfileStore(file);
    const session = server.session('', 'BoostQA', { currency });
    return { server, file, token: session.token, profile: server.authenticate(session.token) };
}
function clientFixture(t, accountId = 'account-a') {
    const originalFetch = globalThis.fetch;
    const originalStorage = globalThis.sessionStorage;
    const entries = new Map();
    globalThis.sessionStorage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
    t.after(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; });
    const client = new Store.constructor();
    client.data.currency = 1000;
    client.remoteReady = true;
    client.remoteAccountId = accountId;
    client.sessionToken = `token-${accountId}`;
    client.save = () => {};
    return { client, entries };
}
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test('XP product definition and price are identical on client and server', () => {
    assert.deepEqual(SHOP_XP_BOOST, SERVER_BOOST);
});

test('account checkout charges once, persists and replay after expiry never reactivates', t => {
    const { server, file, token, profile } = profileFixture(t);
    const now = Date.now();
    const first = server.purchaseXpBoost(profile, 'xp-15', 'xp-test-first', now);
    assert.equal(first.status, 200);
    assert.equal(profile.currency, 880);
    assert.equal(first.profile.purchaseReceipts, undefined);
    assert.equal(profile.battlepassActiveBoost.multiplier, 1.5);
    assert.equal(profile.battlepassActiveBoost.expiresAt, now + 3600000);
    const restoredServer = new ProfileStore(file);
    const restored = restoredServer.authenticate(token);
    assert.equal(restored.currency, 880);
    assert.deepEqual(restored.battlepassActiveBoost, profile.battlepassActiveBoost);
    const replay = restoredServer.purchaseXpBoost(restored, 'xp-15', 'xp-test-first', now + 3600000);
    assert.equal(replay.replayed, true);
    assert.equal(replay.profile.battlepassActiveBoost, null);
    assert.equal(restored.currency, 880);
    assert.equal(restoredServer.purchaseXpBoost(restored, 'xp-15', 'xp-test-second', now + 3600000).status, 200);
    assert.equal(restored.currency, 760);
});

test('existing purchase route dispatches server product and ignores discount override', t => {
    const { server, profile } = profileFixture(t);
    assert.equal(server.purchase(profile, 'xpboost', 'xp-15', 'xp-route-check', 1).status, 200);
    assert.equal(profile.currency, 880);
    assert.equal(server.purchase(profile, 'xpboost', 'xp-15', 'xp-route-check').replayed, true);
});

test('insufficient funds, invalid id and overlapping boosts never charge', t => {
    const { server, profile } = profileFixture(t, 100);
    assert.equal(server.purchaseXpBoost(profile, 'xp-15', 'xp-poor-player').status, 409);
    assert.equal(server.purchaseXpBoost(profile, 'made-up', 'xp-bad-product').status, 404);
    assert.equal(server.purchaseXpBoost(profile, 'xp-15', '').status, 400);
    assert.equal(profile.currency, 100);
    profile.currency = 1000;
    const now = Date.now();
    profile.battlepassActiveBoost = { boostId: 'earned-boost', multiplier: 1.25, activatedAt: now, expiresAt: now + 5000 };
    assert.equal(server.purchaseXpBoost(profile, 'xp-15', 'xp-overlap-test', now).status, 409);
    assert.equal(profile.currency, 1000);
    assert.equal(profile.battlepassActiveBoost.boostId, 'earned-boost');
});

test('receipt collision and save failure leave balance and active effect unchanged', t => {
    const { server, profile } = profileFixture(t);
    server.purchase(profile, 'ball', 'fire', 'xp-conflict-key');
    assert.equal(server.purchaseXpBoost(profile, 'xp-15', 'xp-conflict-key').status, 409);
    const before = JSON.stringify(profile);
    server._save = () => { throw new Error('disk unavailable'); };
    assert.equal(server.purchaseXpBoost(profile, 'xp-15', 'xp-storage-fail').status, 503);
    assert.equal(JSON.stringify(profile), before);
});

test('purchased boost affects settled match XP exactly once, never coins or ELO', t => {
    const a = profileFixture(t), b = profileFixture(t);
    const now = Date.now();
    a.server.purchaseXpBoost(a.profile, 'xp-15', 'xp-settlement', now);
    const rankBefore = JSON.stringify(a.profile.rankedState);
    const boosted = a.server.reward(a.profile, { matchId: 'xp-match', won: true }, now + 1);
    const normal = b.server.reward(b.profile, { matchId: 'xp-match', won: true }, now + 1);
    assert.equal(boosted.battlepassXp, 150);
    assert.equal(normal.battlepassXp, 100);
    assert.equal(boosted.coins, normal.coins);
    assert.equal(JSON.stringify(a.profile.rankedState), rankBefore);
    assert.equal(a.server.reward(a.profile, { matchId: 'xp-match', won: true }, now + 2).battlepassXp, 0);
    assert.equal(a.server.reward(a.profile, { matchId: 'xp-match-later', won: false }, now + 3600000).battlepassXp, 80);
});

test('client awaits authoritative confirmation and does not optimistically debit', async t => {
    const { client } = clientFixture(t);
    let resolve;
    globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/profile/purchase');
        assert.equal(JSON.parse(options.body).kind, 'xpboost');
        return new Promise(done => { resolve = done; });
    };
    const pending = client.buyAndActivateXpBoost();
    assert.equal(client.data.currency, 1000);
    resolve(response({ profile: { currency: 880 } }));
    assert.equal(await pending, true);
    assert.equal(client.data.currency, 880);
});

test('lost response and reload reuse the purchase key; success clears it', async t => {
    const { client, entries } = clientFixture(t);
    const ids = [];
    globalThis.fetch = async (_url, options) => {
        ids.push(JSON.parse(options.body).requestId);
        throw new Error('response lost after server commit');
    };
    assert.equal(await client.buyAndActivateXpBoost(), false);
    assert.equal(client.data.currency, 1000);
    assert.equal(entries.size, 1);
    client._xpBoostRequest = null; // page reload: only sessionStorage remains
    globalThis.fetch = async (_url, options) => {
        ids.push(JSON.parse(options.body).requestId);
        return response({ profile: { currency: 880 }, replayed: true });
    };
    assert.equal(await client.buyAndActivateXpBoost(), true);
    assert.equal(ids[0], ids[1]);
    assert.equal(entries.size, 0);
    assert.equal(client.lastXpBoostPurchase.replayed, true);
});

test('concurrent clicks share one request and an account switch cannot import its result', async t => {
    const { client } = clientFixture(t);
    let calls = 0, resolve;
    globalThis.fetch = () => { calls++; return new Promise(done => { resolve = done; }); };
    const first = client.buyAndActivateXpBoost();
    const second = client.buyAndActivateXpBoost();
    assert.equal(calls, 1);
    client.remoteAccountId = 'account-b';
    client.sessionToken = 'token-account-b';
    resolve(response({ profile: { currency: 880 } }));
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(client.data.currency, 1000);
});

test('known accounts cannot fall back to local checkout while disconnected', t => {
    const { client } = clientFixture(t);
    client.remoteReady = false;
    assert.equal(client.buyAndActivateXpBoost(), false);
    assert.equal(client.data.currency, 1000);
    assert.match(client.lastBattlepassError, /Reconnect/);
});

test('Player XP uses purchased boost only; earned boosts remain Battle Pass only', t => {
    const { client } = clientFixture(t);
    const active = { multiplier: 1.5, activatedAt: Date.now(), expiresAt: Date.now() + 5000 };
    client.data.battlepassActiveBoost = { ...active, boostId: SHOP_XP_BOOST.boostId };
    assert.equal(client.boostedXp(101), 151);
    client.data.battlepassActiveBoost = { ...active, boostId: 'bp-1-5' };
    assert.equal(client.boostedXp(101), 101);
    assert.equal(client.boostedXp(Infinity), 0);
});
