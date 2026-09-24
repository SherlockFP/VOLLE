import assert from 'node:assert/strict';
import en from '../js/locales/en.js';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveSportRoute } from '../js/sports.js';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractAppMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}(?:async\\s+)?${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(mainSource);
    assert.ok(match, `App.${name} method not found`);
    const start = match.index;
    const bodyStart = start + match[0].lastIndexOf('{');
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

const signedIn = { getToken: () => 'session-token' };
const signedOut = { getToken: () => '' };

test('delayed registration for an old room cannot overwrite the current host token', async () => {
    const registerLobby = compileAppMethod('_registerLobby', { resolveSportRoute, account: signedIn });
    let resolveRequest;
    const request = new Promise(resolve => { resolveRequest = resolve; });
    const installed = [];
    const app = {
        game: { mode: { id: 'classic' }, playerName: 'Host' },
        store: { getElo: () => 1000 },
        network: {
            isHost: true,
            hostRoomCode: 'new-room',
            setLobbyAdmissionToken: token => installed.push(token)
        },
        _lobbyApi: () => request
    };

    const pending = registerLobby.call(app, 'old-room', 'Old', 1, 'Arena', 'Classic');
    resolveRequest({ ok: true, admissionToken: 'O'.repeat(43) });

    assert.equal(await pending, false);
    assert.deepEqual(installed, []);
});

test('guest hosts skip the registry instead of posting a doomed request', async () => {
    const registerLobby = compileAppMethod('_registerLobby', { resolveSportRoute, account: signedOut });
    let requests = 0;
    const app = { game: { mode: { id: 'classic' } }, network: { isHost: true }, _lobbyApi: async () => { requests++; return {}; } };
    assert.equal(await registerLobby.call(app, 'room', 'Lobby', 1, 'Arena', 'Classic'), false);
    assert.equal(app._lastLobbyApiStatus, 401);
    assert.equal(requests, 0);
});

test('missing admission proof never cancels a P2P join and posts nothing', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission', { account: signedIn });
    let requests = 0;
    const app = {
        _lobbyCode: 'room-code',
        network: { waitForLobbyAdmissionProof: async () => '' },
        _lobbyApi: async () => { requests++; return { ok: true }; }
    };

    assert.equal(await confirmLobbyAdmission.call(app, 'room-code'), false);
    assert.equal(requests, 0);
    // A proof that arrives later (host listed the room afterwards) is still used.
    assert.equal(typeof app.network.onLobbyAdmissionProof, 'function');
});

test('guest joiners skip server admission entirely', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission', { account: signedOut });
    let waited = 0;
    const app = { network: { waitForLobbyAdmissionProof: async () => { waited++; return 'C'.repeat(43); } }, _lobbyApi: async () => ({ ok: true }) };
    assert.equal(await confirmLobbyAdmission.call(app, 'room'), false);
    assert.equal(waited, 0);
});

test('a rejected server admission does not throw (rewards only, the room still works)', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission', { account: signedIn });
    const app = {
        network: { waitForLobbyAdmissionProof: async () => 'C'.repeat(43) },
        _lobbyApi: async () => ({ __lobbyApiError: true, status: 403 })
    };
    assert.equal(await confirmLobbyAdmission.call(app, 'room'), false);
});

test('valid proof is posted once through the shared admission helper', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission', { account: signedIn });
    const token = 'C'.repeat(43);
    const requests = [];
    const app = {
        network: { waitForLobbyAdmissionProof: async () => token },
        _lobbyApi: async (...args) => { requests.push(args); return { ok: true }; }
    };

    assert.equal(await confirmLobbyAdmission.call(app, 'room code'), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], '/api/lobbies/room%20code/join');
    assert.deepEqual(JSON.parse(requests[0][1].body), { admissionToken: token });
});

test('host flow keeps the P2P room when the registry does not list it (guest, expired, offline)', () => {
    const source = extractAppMethod('_doHostGame');
    const registration = source.indexOf('const registered = await this._registerLobby(');
    const success = source.indexOf("t('toast.lobbyCreated'");
    assert.match(en.toast.lobbyCreated, /Lobby created! Code:/);
    assert.ok(registration >= 0 && registration < success);
    // Guests are no longer diverted to a local bot lobby before hostGame().
    assert.ok(source.indexOf('this.network.hostGame(') >= 0);
    assert.doesNotMatch(source, /_openLocalLobbyFallback|network\.disconnect\(\)/);
    assert.match(source, /'toast\.lobbyPrivateGuest'/);
    assert.match(source, /'toast\.lobbyPrivateSession' : 'toast\.lobbyPrivateOffline'/);
    for (const key of ['lobbyPrivateGuest', 'lobbyPrivateSession', 'lobbyPrivateOffline']) {
        assert.match(en.toast[key], /\{code\}/, `en toast.${key} shows the code`);
    }
    assert.doesNotMatch(source, /Lobby service registration failed/);
});
