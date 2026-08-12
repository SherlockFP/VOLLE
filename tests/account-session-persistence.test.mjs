import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_KEY, Account } from '../js/account.js';

class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; }
    };
}

const PUBLIC_ACCOUNT = Object.freeze({
    id: 'account-1',
    username: 'VolleyFan',
    avatar: '',
    friendTag: 'VolleyFan#A1B2C3D4'
});

test('a successful login survives a reload and restores with only the revocable session token', async () => {
    const storage = new MemoryStorage();
    const calls = [];
    const fetchImpl = async (path, options = {}) => {
        calls.push({ path, options });
        if (path === '/api/account/login') {
            return jsonResponse(200, { sessionToken: 's'.repeat(43), account: PUBLIC_ACCOUNT });
        }
        if (path === '/api/account/me') return jsonResponse(200, { account: PUBLIC_ACCOUNT });
        return jsonResponse(404, {});
    };

    const firstPage = new Account({ storage, fetchImpl });
    assert.deepEqual(await firstPage.login('VolleyFan', 'correct horse battery staple'), {
        ok: true,
        account: PUBLIC_ACCOUNT
    });

    const persisted = storage.getItem(ACCOUNT_KEY);
    assert.ok(persisted, 'login must persist the session for the next page load');
    assert.doesNotMatch(persisted, /correct horse battery staple|password/i, 'plaintext credentials must never be stored');

    const reloadedPage = new Account({ storage, fetchImpl });
    assert.equal(reloadedPage.isLoggedIn(), true, 'the next page load should discover the saved session');
    assert.deepEqual(await reloadedPage.restore(), { ok: true, account: PUBLIC_ACCOUNT });
    const restoreCall = calls.find(call => call.path === '/api/account/me');
    assert.equal(restoreCall?.options?.headers?.Authorization, `Bearer ${'s'.repeat(43)}`);
});

test('registration uses the same persistent session path without storing its password', async () => {
    const storage = new MemoryStorage();
    const fetchImpl = async path => path === '/api/account/register'
        ? jsonResponse(201, { sessionToken: 'r'.repeat(43), account: PUBLIC_ACCOUNT })
        : jsonResponse(404, {});
    const account = new Account({ storage, fetchImpl });

    assert.equal((await account.register('VolleyFan', 'register-secret')).ok, true);
    const persisted = storage.getItem(ACCOUNT_KEY);
    assert.match(persisted, /"sessionToken"/);
    assert.doesNotMatch(persisted, /register-secret|password/i);
});

test('logout clears the local session before the network request and prevents reload auto-login', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_KEY, JSON.stringify({
        sessionToken: 'l'.repeat(43),
        account: PUBLIC_ACCOUNT
    }));
    let clearedBeforeRequest = false;
    const active = new Account({
        storage,
        fetchImpl: async (path, options = {}) => {
            clearedBeforeRequest = storage.getItem(ACCOUNT_KEY) === null && !active.isLoggedIn();
            assert.equal(path, '/api/account/logout');
            assert.equal(options.headers.Authorization, `Bearer ${'l'.repeat(43)}`);
            throw new Error('offline after local logout');
        }
    });

    await active.logout();
    assert.equal(clearedBeforeRequest, true, 'logout must be local-first even when the server is unavailable');
    assert.equal(storage.getItem(ACCOUNT_KEY), null);
    assert.equal(new Account({ storage, fetchImpl: async () => jsonResponse(500, {}) }).isLoggedIn(), false);
});
