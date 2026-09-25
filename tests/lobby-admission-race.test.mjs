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

test('delayed registration for an old room cannot overwrite the current host token', async () => {
    const registerLobby = compileAppMethod('_registerLobby', { resolveSportRoute });
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

test('blank admission proof fails before any server join request', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission');
    let requests = 0;
    const app = {
        network: { waitForLobbyAdmissionProof: async () => '' },
        _lobbyApi: async () => { requests++; return { ok: true }; }
    };

    await assert.rejects(
        confirmLobbyAdmission.call(app, 'room-code'),
        /proof was not received/
    );
    assert.equal(requests, 0);
});

test('valid proof is posted once through the shared admission helper', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission');
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

test('host flow awaits initial registration and falls back to a local lobby on failure', () => {
    const source = extractAppMethod('_doHostGame');
    const registration = source.indexOf('const registered = await this._registerLobby(');
    const success = source.indexOf("t('toast.lobbyCreated'");
    assert.match(en.toast.lobbyCreated, /Lobby created! Code:/);
    assert.ok(registration >= 0 && registration < success);
    assert.match(source.slice(registration, success), /if \(!registered\) \{\s*this\._openLocalLobbyFallback\(this\._lastLobbyApiStatus === 401 \? 'toast\.lobbySessionExpired' : 'toast\.lobbyLocalFallback'\);\s*return true;/);
    // Guests host online with a guest lobby session; only ranked is account-only.
    assert.doesNotMatch(source, /toast\.lobbyLocalGuest/);
    assert.match(source, /this\._isLobbyGuest\(\) && \(this\._rankedHosting === true/);
    assert.ok(source.indexOf("t('toast.rankedNeedsAccount')") < source.indexOf('this.network.hostGame('));
    const fallback = extractAppMethod('_openLocalLobbyFallback');
    assert.match(fallback, /this\.network\.disconnect\(\);/);
    assert.match(fallback, /this\.ui\.setRoomCode\('LOCAL'\);/);
    assert.doesNotMatch(source, /Lobby service registration failed/);
});

test('admission failures carry a precise code (kick reason, server status) instead of a generic retry', async () => {
    const confirmLobbyAdmission = compileAppMethod('_confirmLobbyAdmission');
    const kicked = {
        network: { waitForLobbyAdmissionProof: async () => '', lobbyAdmissionFailure: 'kicked:duplicate_identity' },
        _lobbyApi: async () => { throw new Error('must not post without a proof'); }
    };
    await assert.rejects(confirmLobbyAdmission.call(kicked, 'room'), { code: 'duplicate_identity' });
    const timedOut = { network: { waitForLobbyAdmissionProof: async () => '', lobbyAdmissionFailure: 'timeout' }, _lobbyApi: async () => ({}) };
    await assert.rejects(confirmLobbyAdmission.call(timedOut, 'room'), { code: 'no_proof' });
    for (const [reply, code] of [
        [{ __lobbyApiError: true, status: 409, code: 'lobby_full' }, 'lobby_full'],
        [{ __lobbyApiError: true, status: 403, code: 'account_required' }, 'account_required'],
        [{ __lobbyApiError: true, status: 403 }, 'invalid_proof'],
        [{ __lobbyApiError: true, status: 404 }, 'lobby_unavailable'],
        [{ __lobbyApiError: true, status: 401 }, 'sign_in_required'],
        [{ __lobbyApiError: true, status: 0 }, 'service']
    ]) {
        const app = { network: { waitForLobbyAdmissionProof: async () => 'D'.repeat(43) }, _lobbyApi: async () => reply };
        await assert.rejects(confirmLobbyAdmission.call(app, 'room'), { code });
    }
});

test('lobby writes fall back from an expired account session to a guest lobby session once', async () => {
    const calls = [];
    let status = 401;
    const globals = {
        console: { warn() {} },
        account: { getToken: () => 'expired-account-token' },
        fetch: async (path, opts) => {
            calls.push(opts.headers.Authorization);
            const current = status;
            status = 200;
            return { ok: current === 200, status: current, json: async () => ({ ok: current === 200 }) };
        }
    };
    const lobbyApi = compileAppMethod('_lobbyApi', globals);
    const app = {
        _lobbyAccountSessionExpired: false,
        async _lobbyAuthToken() { return this._lobbyAccountSessionExpired ? 'lg1.guest.token' : 'expired-account-token'; },
        _invalidateLobbyAuth: compileAppMethod('_invalidateLobbyAuth', { ...globals, t: key => key }),
        _lobbyApi: lobbyApi
    };
    const result = await lobbyApi.call(app, '/api/lobbies', { method: 'POST', body: '{}' });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['Bearer expired-account-token', 'Bearer lg1.guest.token']);
    assert.equal(app._lobbyAccountSessionExpired, true);
});
