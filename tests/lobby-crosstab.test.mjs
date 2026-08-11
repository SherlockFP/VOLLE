// Lobby cross-tab bug (user report): two browser tabs/windows sometimes can't see or
// join each other's lobby. Live two-tab repro (headless browser, documented in the PR
// report) showed the lobby LIST and JOIN flow both already work end-to-end against a
// fresh server — the real gap is a latent identity collision: Chrome/Firefox's
// "duplicate tab" / crashed-session-restore features clone sessionStorage, so a
// duplicated tab briefly shares the exact same playerId+resumeToken as its source tab.
// If that duplicate then talks to the same host, the host's resume-identity dedup
// (_beginIdentityAdmission in js/network.js) binds it to a playerId it already reserved
// for a still-live peer and silently rejects the connection — "join just does nothing".
// This suite covers the three root-cause areas from the assignment's suspect list:
// (1) peer/player id uniqueness per tab — the actual bug, fixed in js/network.js;
// (2) host keep-alive really does refresh lastSeen (server.js) — verified NOT broken;
// (3) the open-slots filter default does not hide a freshly-hosted lobby (js/lobby-browser.js)
//     — verified NOT broken, record has no separate "open" field to go stale.
// Also covers the prescribed _lobbyApi error-visibility fix (js/main.js) so a broken
// fetch is no longer indistinguishable from "zero lobbies".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Network, pruneIdentityClaims, isSafeTargetId } from '../js/network.js';
import { filterLobbies } from '../js/lobby-browser.js';

const require = createRequire(import.meta.url);
const { normalizeLobbyRecord, pruneLobbies, lobbies, LOBBY_TTL } = require('../server.js');

// --- 1) Peer/player id uniqueness per tab (js/network.js, the actual root cause) ---

// Minimal Map-backed Storage stand-in, matching the shape network.js reads (getItem/setItem).
function fakeStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        snapshot: () => Object.fromEntries(values)
    };
}

function withStorages(sessionStorage, localStorage, fn) {
    const prevSession = globalThis.sessionStorage;
    const prevLocal = globalThis.localStorage;
    globalThis.sessionStorage = sessionStorage;
    globalThis.localStorage = localStorage;
    try {
        return fn();
    } finally {
        if (prevSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = prevSession;
        if (prevLocal === undefined) delete globalThis.localStorage; else globalThis.localStorage = prevLocal;
    }
}

test('pruneIdentityClaims keeps fresh heartbeats and drops stale ones', () => {
    const now = 1_700_000_000_000;
    const claims = {
        'still-open-tab': now - 2000,
        'closed-long-ago': now - 20000
    };
    const pruned = pruneIdentityClaims(claims, now, 15000);
    assert.deepEqual(pruned, { 'still-open-tab': now - 2000 });
});

test('a duplicated tab (cloned sessionStorage) gets a fresh identity while the source tab is still live', () => {
    // Shared localStorage: real browsers share this live across tabs of the same origin.
    const sharedLocal = fakeStorage();
    const tabASession = fakeStorage();

    const tabA = withStorages(tabASession, sharedLocal, () => new Network({}));
    assert.ok(isSafeTargetId(tabA.playerId));
    assert.ok(isSafeTargetId(tabA.resumeToken));

    // Simulate Chrome/Firefox "Duplicate tab": a NEW tab's sessionStorage starts as a
    // byte-for-byte copy of tabA's, taken while tabA is still open (its claim is live).
    const tabBSession = fakeStorage(tabASession.snapshot());
    assert.equal(tabBSession.getItem('dodgb.playerId'), tabA.playerId, 'precondition: clone really did copy the id');

    const tabB = withStorages(tabBSession, sharedLocal, () => new Network({}));

    assert.notEqual(tabB.playerId, tabA.playerId, 'duplicate tab must not collide with the still-open source tab');
    assert.notEqual(tabB.resumeToken, tabA.resumeToken, 'resumeToken is regenerated together with playerId');
    assert.ok(isSafeTargetId(tabB.playerId));
    // The duplicate's sessionStorage was overwritten so it keeps its NEW identity on its own reload.
    assert.equal(tabBSession.getItem('dodgb.playerId'), tabB.playerId);
});

test('a plain same-tab reload (no live claim left behind) keeps resuming the same identity', () => {
    const sharedLocal = fakeStorage();
    const tabSession = fakeStorage();
    const first = withStorages(tabSession, sharedLocal, () => new Network({}));

    // Simulate a clean reload: the departing page released its own claim (pagehide,
    // armed only in real browsers) before the new page's constructor runs.
    sharedLocal.setItem('dodgb.identityClaims', JSON.stringify({}));

    const reloaded = withStorages(tabSession, sharedLocal, () => new Network({}));
    assert.equal(reloaded.playerId, first.playerId, 'reload without a live rival claim must resume the persisted id');
    assert.equal(reloaded.resumeToken, first.resumeToken);
});

test('a stale claim (owning tab long gone / crash, past the liveness TTL) does not block reuse', () => {
    const sharedLocal = fakeStorage();
    const tabSession = fakeStorage({
        'dodgb.playerId': 'player-returning',
        'dodgb.resumeToken': 'resume-returning'
    });
    sharedLocal.setItem('dodgb.identityClaims', JSON.stringify({
        'player-returning': Date.now() - 10 * 60 * 1000 // 10 minutes old, well past any sane TTL
    }));

    const network = withStorages(tabSession, sharedLocal, () => new Network({}));
    assert.equal(network.playerId, 'player-returning', 'a long-stale claim must not be treated as a live collision');
    assert.equal(network.resumeToken, 'resume-returning');
});

// --- 2) Host keep-alive really refreshes lastSeen across repeated ticks (server.js) ---

test('repeated keep-alive re-registration keeps a lobby alive past the original TTL boundary', () => {
    const now0 = Date.now();
    const code = 'crosstab-keepalive';
    try {
        // Host registers once at t=0, matching js/main.js _doHostGame's initial _registerLobby.
        lobbies.set(code, normalizeLobbyRecord({ code, players: 1, maxPlayers: 8 }, now0));
        // Three 12s keep-alive ticks (js/main.js _lobbyKeepAlive cadence) land at 12s/24s/36s —
        // each one must bump lastSeen, or the lobby would be pruned once now crosses LOBBY_TTL.
        for (let tick = 1; tick <= 3; tick++) {
            const tickTime = now0 + tick * 12000;
            lobbies.set(code, normalizeLobbyRecord(
                { code, players: 1, maxPlayers: 8 },
                tickTime
            ));
        }
        // 36s + a hair under TTL margin: with a single stamp this would already be pruned
        // once "now" reaches now0 + LOBBY_TTL, but the last keep-alive re-stamped it at
        // now0 + 36000, so it must still survive here.
        const record = lobbies.get(code);
        assert.equal(record.lastSeen, now0 + 36000, 'keep-alive must advance lastSeen, not just updatedAt');

        const originalNow = Date.now;
        try {
            Date.now = () => now0 + 36000 + LOBBY_TTL - 1000; // just before TTL from the LAST keep-alive
            pruneLobbies();
            assert.equal(lobbies.has(code), true, 'lobby kept alive by continued keep-alive must survive prune');
        } finally {
            Date.now = originalNow;
        }
    } finally {
        lobbies.delete(code);
    }
});

test('keep-alive stopping (host gone) still lets the lobby expire, matching the P2P_HOST_FIXES TTL contract', () => {
    const now0 = Date.now();
    const code = 'crosstab-keepalive-stopped';
    try {
        lobbies.set(code, normalizeLobbyRecord({ code, players: 1, maxPlayers: 8 }, now0));
        const originalNow = Date.now;
        try {
            Date.now = () => now0 + LOBBY_TTL + 1000; // past TTL, no further keep-alive ticks happened
            pruneLobbies();
            assert.equal(lobbies.has(code), false, 'a lobby whose host stopped keep-aliving must eventually prune');
        } finally {
            Date.now = originalNow;
        }
    } finally {
        lobbies.delete(code);
    }
});

// --- 3) Open-slots filter default does not hide a freshly-hosted lobby (js/lobby-browser.js) ---

test('a freshly hosted lobby (no separate "open" field, default filter state) is visible to a second tab', () => {
    // Exact shape server.js POST /api/lobbies produces for js/main.js _registerLobby's
    // first call (host, zero connections yet): no "open" boolean anywhere on the record.
    const freshLobby = normalizeLobbyRecord({
        code: 'crosstab-visible',
        name: 'Lobby',
        hostName: 'Host',
        players: 1,
        map: 'Beach Volleyball',
        mode: 'Classic',
        ranked: false,
        averageElo: 1000,
        maxPlayers: 8
    }, Date.now());
    // Exact default UI filter state js/main.js _refreshLobbyList computes when the mode/
    // map/queue selects are untouched and the "Open slots" checkbox starts checked.
    const visible = filterLobbies([freshLobby], {
        mode: 'all',
        map: '',
        queue: 'all',
        openOnly: true
    });
    assert.deepEqual(visible.map(l => l.code), ['crosstab-visible']);
});

test('the open-slots filter only excludes a lobby once it is actually full, not by a stale flag', () => {
    const full = normalizeLobbyRecord({
        code: 'crosstab-full', players: 8, maxPlayers: 8
    }, Date.now());
    assert.deepEqual(filterLobbies([full], { openOnly: true }), []);
    assert.deepEqual(filterLobbies([full], { openOnly: false }).map(l => l.code), ['crosstab-full']);
});

// --- 4) _lobbyApi surfaces failures instead of silently returning {} (js/main.js) ---

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractAppMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}(?:async\\s+)?${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(mainSource);
    assert.ok(match, `App.${name} method not found`);
    const start = match.index;
    // The regex match already ends at the true opening brace; scanning forward for the
    // first "{" instead (as a naive version would) misfires on default-param objects
    // like `opts = {}` in `_lobbyApi(path, opts = {}) {`, matching that one instead.
    const bodyStart = start + match[0].length - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < mainSource.length; index++) {
        const character = mainSource[index];
        const next = mainSource[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') { blockComment = false; index++; }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === '/' && next === '/') { lineComment = true; index++; continue; }
        if (character === '/' && next === '*') { blockComment = true; index++; continue; }
        if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) return mainSource.slice(start, index + 1);
    }
    assert.fail(`App.${name} method body is incomplete`);
}

function compileAppMethod(name, globals = {}) {
    const method = extractAppMethod(name);
    return runInNewContext(`({ ${method} }).${name}`, globals);
}

test('_lobbyApi returns a distinct error marker (not a bare {}) when the fetch rejects, and warns', async () => {
    const warnings = [];
    const globals = {
        console: { warn: (...args) => warnings.push(args) },
        account: { getToken: () => '' },
        fetch: async () => { throw new TypeError('Failed to fetch'); }
    };
    const lobbyApi = compileAppMethod('_lobbyApi', globals);
    const result = await lobbyApi('/api/lobbies', { method: 'GET' });
    // result was built in the VM's own realm (its own Object.prototype), so compare via
    // JSON round-trip rather than deepEqual's cross-realm prototype identity check.
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { __lobbyApiError: true });
    assert.equal(warnings.length, 1, 'a failed lobby API call must be visible in the console');
});

test('_lobbyApi treats a non-2xx HTTP response as a failure instead of returning it as data', async () => {
    const warnings = [];
    const globals = {
        console: { warn: (...args) => warnings.push(args) },
        account: { getToken: () => '' },
        fetch: async () => ({ ok: false, status: 500, json: async () => ({ oops: true }) })
    };
    const lobbyApi = compileAppMethod('_lobbyApi', globals);
    const result = await lobbyApi('/api/lobbies', { method: 'GET' });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { __lobbyApiError: true });
    assert.equal(warnings.length, 1);
});

test('_lobbyApi passes real data through untouched on success and never warns', async () => {
    const warnings = [];
    const globals = {
        console: { warn: (...args) => warnings.push(args) },
        account: { getToken: () => '' },
        fetch: async () => ({ ok: true, status: 200, json: async () => ([{ code: 'ok' }]) })
    };
    const lobbyApi = compileAppMethod('_lobbyApi', globals);
    const result = await lobbyApi('/api/lobbies', { method: 'GET' });
    assert.deepEqual(result, [{ code: 'ok' }]);
    assert.equal(warnings.length, 0);
});

test('_refreshLobbyList shows "service unreachable" for an API failure, distinct from a genuinely empty board', async () => {
    const messages = [];
    const globals = {
        document: {
            getElementById: id => (id === 'mp-lobby-list' ? {} : null)
        }
    };
    const refresh = compileAppMethod('_refreshLobbyList', globals);

    const errorApp = {
        _lobbyApi: async () => ({ __lobbyApiError: true }),
        _renderLobbyEmpty: (container, message) => messages.push(message)
    };
    await refresh.call(errorApp);
    assert.match(messages[0], /unreachable/i);

    const emptyApp = {
        _lobbyApi: async () => [],
        _renderLobbyEmpty: (container, message) => messages.push(message)
    };
    await refresh.call(emptyApp);
    assert.doesNotMatch(messages[1], /unreachable/i);
    assert.match(messages[1], /no open lobbies/i);
});
