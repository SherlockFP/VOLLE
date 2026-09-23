// js/leaderboard.js used to be a local fake-bot roster in localStorage.
// These tests cover its replacement: a thin fetch client over the real
// server-authoritative /api/leaderboard endpoint (server.js + server/profile-store.js).
import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
    constructor() { this.map = new Map(); }
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
    setItem(key, value) { this.map.set(key, String(value)); }
    removeItem(key) { this.map.delete(key); }
}

function withGlobals({ storage } = {}, run) {
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = storage || new MemoryStorage();
    return run().finally(() => {
        if (originalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = originalStorage;
    });
}

test('loading js/leaderboard.js deletes the legacy fake-bot roster key (clean one-time migration)', async () => {
    const storage = new MemoryStorage();
    storage.setItem('dodgball_leaderboard_v1', JSON.stringify([{ name: 'FakeBot0', elo: 1200, fake: true }]));
    globalThis.localStorage = storage;
    try {
        // Re-import with a cache-busting query so the module body (which runs
        // the migration on load) executes fresh against this storage stub.
        await import(`../js/leaderboard.js?case=migration`);
        assert.equal(storage.getItem('dodgball_leaderboard_v1'), null);
    } finally {
        delete globalThis.localStorage;
    }
});

test('fetchBoard requests the real API with board/season/limit and surfaces server entries verbatim', async () => {
    const storage = new MemoryStorage();
    let requestedUrl = '';
    let requestedHeaders = {};
    const fetchImpl = async (url, options = {}) => {
        requestedUrl = url;
        requestedHeaders = options.headers || {};
        return {
            ok: true,
            json: async () => ({
                board: 'ranked', season: 'current', total: 2, generatedAt: 12345,
                entries: [{ rank: 1, publicCode: 'abc123', displayName: 'Ace', elo: 1800, games: 10, wins: 8, winRate: 0.8, seasonDelta: 50, avatarId: 'default', knifeId: 'training' }],
                me: null
            })
        };
    };
    await withGlobals({ storage }, async () => {
        const { Leaderboard } = await import(`../js/leaderboard.js?case=fetch-basic`);
        Leaderboard.fetchImpl = fetchImpl;
        const result = await Leaderboard.fetchBoard('ranked', { limit: 10, around: false });
        assert.equal(result.ok, true);
        assert.equal(result.entries.length, 1);
        assert.equal(result.entries[0].displayName, 'Ace');
        assert.ok(requestedUrl.startsWith('/api/leaderboard?'));
        assert.match(requestedUrl, /board=ranked/);
        assert.match(requestedUrl, /season=current/);
        assert.match(requestedUrl, /limit=10/);
        assert.equal(requestedUrl.includes('around=me'), false);
        assert.equal(requestedHeaders.Authorization, undefined, 'no bearer token sent when around=me was not requested');
    });
});

test('an unsuccessful or network-failed fetch resolves to an error/offline state instead of throwing', async () => {
    const storage = new MemoryStorage();
    await withGlobals({ storage }, async () => {
        const { Leaderboard: FailingBoard } = await import(`../js/leaderboard.js?case=http-error`);
        FailingBoard.fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
        const errorResult = await FailingBoard.fetchBoard('ranked', { around: false });
        assert.equal(errorResult.ok, false);
        assert.equal(errorResult.error, 'boom');

        const { Leaderboard: OfflineBoard } = await import(`../js/leaderboard.js?case=network-error`);
        OfflineBoard.fetchImpl = async () => { throw new Error('network down'); };
        const offlineResult = await OfflineBoard.fetchBoard('ranked', { around: false });
        assert.equal(offlineResult.ok, false);
        assert.equal(offlineResult.offline, true);
    });
});

test('an unknown board name falls back to "ranked" rather than sending garbage to the server', async () => {
    const storage = new MemoryStorage();
    let requestedUrl = '';
    await withGlobals({ storage }, async () => {
        const { Leaderboard } = await import(`../js/leaderboard.js?case=bad-board`);
        Leaderboard.fetchImpl = async (url) => { requestedUrl = url; return { ok: true, json: async () => ({ board: 'ranked', entries: [] }) }; };
        await Leaderboard.fetchBoard('not-a-real-board', { around: false });
        assert.match(requestedUrl, /board=ranked/);
    });
});

test('repeated fetchBoard calls within the client cache window reuse the response instead of refetching', async () => {
    const storage = new MemoryStorage();
    await withGlobals({ storage }, async () => {
        const { Leaderboard } = await import(`../js/leaderboard.js?case=client-cache`);
        let calls = 0;
        Leaderboard.fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ board: 'ranked', entries: [] }) }; };
        await Leaderboard.fetchBoard('ranked', { around: false });
        await Leaderboard.fetchBoard('ranked', { around: false });
        assert.equal(calls, 1, 'second call served from the client-side cache');
        await Leaderboard.fetchBoard('ranked', { around: false, force: true });
        assert.equal(calls, 2, 'force bypasses the cache');
    });
});

test('the source no longer contains the old seeded fake-opponent generator', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, '..', 'js', 'leaderboard.js'), 'utf8');
    assert.doesNotMatch(source, /ADJ\s*=\s*\[/);
    assert.doesNotMatch(source, /NOUN\s*=\s*\[/);
    assert.doesNotMatch(source, /generateFakes/);
    assert.doesNotMatch(source, /seededRng/);
});
