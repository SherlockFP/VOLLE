import assert from 'node:assert/strict';
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

test('host flow awaits initial registration and disconnects before success on failure', () => {
    const source = extractAppMethod('_doHostGame');
    const registration = source.indexOf('const registered = await this._registerLobby(');
    const success = source.indexOf('Lobby created! Code:');
    assert.ok(registration >= 0 && registration < success);
    assert.match(source.slice(registration, success), /if \(!registered\) \{\s*this\.network\.disconnect\(\);\s*throw new Error\('Lobby service registration failed/);
});
