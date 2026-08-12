import test from 'node:test';
import assert from 'node:assert/strict';

import { Store, isDefinitiveCaseOpenRejection } from '../js/store.js';

const originalFetch = globalThis.fetch;

function prepare(accountId = 'account-a') {
    Store.remoteReady = true;
    Store.sessionToken = `session-${accountId}`;
    Store.remoteAccountId = accountId;
    Store._caseOpenRequests.clear();
    Store._caseOpenFlights.clear();
}

function requestIdOf(options) {
    return JSON.parse(options.body).requestId;
}

function successResponse(reward = { id: 'tide', type: 'knife', rarity: 'rare' }) {
    return {
        ok: true,
        status: 200,
        async json() {
            return { result: { reward, duplicate: false, refund: 0, free: false } };
        }
    };
}

test.after(() => { globalThis.fetch = originalFetch; });

test('ambiguous response loss retries the same logical case request, then success rotates it', async () => {
    prepare();
    const ids = [];
    globalThis.fetch = async (_url, options) => {
        ids.push(requestIdOf(options));
        throw new Error('response lost after server commit');
    };
    assert.equal(await Store.openCaseRemote('kickoff'), null);

    globalThis.fetch = async (_url, options) => {
        ids.push(requestIdOf(options));
        return successResponse();
    };
    assert.ok(await Store.openCaseRemote('kickoff'));
    assert.equal(ids[1], ids[0], 'manual retry must replay the server receipt');

    assert.ok(await Store.openCaseRemote('kickoff'));
    assert.notEqual(ids[2], ids[1], 'confirmed success starts a new logical opening');
});
test('request identity is isolated by case and account scope', async () => {
    prepare('account-a');
    const ids = [];
    globalThis.fetch = async (_url, options) => {
        ids.push(requestIdOf(options));
        throw new Error('ambiguous');
    };
    await Store.openCaseRemote('kickoff');
    await Store.openCaseRemote('elemental');
    Store.remoteAccountId = 'account-b';
    Store.sessionToken = 'session-account-b';
    await Store.openCaseRemote('kickoff');
    assert.equal(new Set(ids).size, 3);
});

test('definitive 4xx rejection clears the key while uncertain 5xx retains it', async () => {
    prepare();
    const ids = [];
    let status = 409;
    globalThis.fetch = async (_url, options) => {
        ids.push(requestIdOf(options));
        return { ok: false, status, async json() { return { error: 'failed' }; } };
    };
    assert.equal(await Store.openCaseRemote('kickoff'), null);
    assert.equal(await Store.openCaseRemote('kickoff'), null);
    assert.notEqual(ids[1], ids[0], 'definitive rejection permits a fresh logical attempt');

    status = 500;
    assert.equal(await Store.openCaseRemote('kickoff'), null);
    assert.equal(await Store.openCaseRemote('kickoff'), null);
    assert.equal(ids[3], ids[2], 'uncertain server failure must preserve the request id');
    assert.equal(isDefinitiveCaseOpenRejection(409), true);
    assert.equal(isDefinitiveCaseOpenRejection(500), false);
    assert.equal(isDefinitiveCaseOpenRejection(408), false);
});

test('same-box concurrent calls share one Store-level flight', async () => {
    prepare();
    let calls = 0;
    let resolveFetch;
    globalThis.fetch = () => {
        calls++;
        return new Promise(resolve => { resolveFetch = resolve; });
    };
    const first = Store.openCaseRemote('kickoff');
    const second = Store.openCaseRemote('kickoff');
    await Promise.resolve();
    assert.equal(calls, 1);
    resolveFetch(successResponse());
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
});
