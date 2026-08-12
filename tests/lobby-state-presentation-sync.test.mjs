import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const GAME_MODES = { classic: {}, speedball: {} };

async function loadActualLobbyPresentation() {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = main.indexOf('    _applyClientLobbyStatePresentation(data) {');
    const end = main.indexOf('\n    _applyInitialLobbyWelcome(data)', start);
    assert.ok(start >= 0 && end > start, 'lobby presentation bridge must be a bounded App method');
    const method = main.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    return new Function('GAME_MODES', `return function(data) {${body}}`)(GAME_MODES);
}

async function loadActualLobbyIdentity() {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = main.indexOf('    _syncClientLobbyIdentity(code) {');
    const end = main.indexOf('\n    _applyClientLobbyStatePresentation(data)', start);
    assert.ok(start >= 0 && end > start, 'lobby identity bridge must be a bounded App method');
    const method = main.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    return new Function(`return function(code) {${body}}`)();
}

function createApp() {
    const calls = [];
    const game = {
        mode: { id: 'classic' },
        getSelectableMaps: () => ['beach', 'space'],
        applyModeChange: ({ modeId }) => {
            calls.push(['mode', modeId]);
            game.mode = { id: modeId };
        },
        applyMapChange: ({ mapId }) => calls.push(['map', mapId]),
        onModeChange: modeId => calls.push(['role', modeId])
    };
    return {
        network: { hostRoomCode: ' trusted-room ' },
        ui: { setRoomCode: code => calls.push(['room', code]) },
        game,
        calls
    };
}

test('actual lobby-state presentation accepts only catalog mode and selectable map', async () => {
    const applyPresentation = await loadActualLobbyPresentation();
    const app = createApp();

    applyPresentation.call(app, { type: 'lobbyState', mode: 'speedball', map: 'space' });
    assert.deepEqual(app.calls, [['mode', 'speedball'], ['map', 'space'], ['role', 'speedball']]);

    app.calls.length = 0;
    applyPresentation.call(app, { type: 'lobbyState', mode: 'forged-mode', map: '../arena' });
    assert.deepEqual(app.calls, [['role', 'speedball']]);
});

test('actual lobby identity uses only transport room code and leaves pending welcome intact', async () => {
    const syncIdentity = await loadActualLobbyIdentity();
    const app = createApp();
    const pendingWelcome = { type: 'welcome', mode: 'speedball' };
    app._pendingInitialLobbyWelcome = pendingWelcome;

    syncIdentity.call(app, 'packet-room');
    assert.equal(app._lobbyCode, 'trusted-room');
    assert.equal(app._pendingInitialLobbyWelcome, pendingWelcome);
    assert.deepEqual(app.calls, [['room', 'trusted-room'], ['role', 'classic']]);
});

test('host lobby broadcast and client callback keep presentation one-way and packet-bounded', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const broadcastStart = main.indexOf('    broadcastLobbyState() {');
    const broadcastEnd = main.indexOf('\n    async _syncWearableLoadout()', broadcastStart);
    const setupStart = main.indexOf('    _setupClientNetHandlers() {');
    const setupEnd = main.indexOf('\n    leaveLobby()', setupStart);
    assert.ok(broadcastStart >= 0 && broadcastEnd > broadcastStart && setupStart >= 0 && setupEnd > setupStart);
    const broadcast = main.slice(broadcastStart, broadcastEnd);
    const setup = main.slice(setupStart, setupEnd);

    assert.match(broadcast, /if \(!\(this\.network\?\.isHost\)\) return;/);
    assert.match(broadcast, /type: 'lobbyState',[\s\S]*mode: this\.game\.mode\?\.id,[\s\S]*map: this\.arena\?\.mapId,/);
    assert.match(broadcast, /this\.network\.broadcast\(/);
    assert.match(setup, /this\.game\.applyLobbyState\(data\);\s*if \(data\?\.type === 'lobbyState' && !this\.network\.isHost\) \{\s*this\._applyClientLobbyStatePresentation\(data\);\s*this\._syncClientLobbyIdentity\(this\.network\.hostRoomCode\);/);
    const presentationStart = main.indexOf('    _applyClientLobbyStatePresentation(data) {');
    const presentationEnd = main.indexOf('\n    _applyInitialLobbyWelcome(data)', presentationStart);
    const presentation = main.slice(presentationStart, presentationEnd);
    assert.match(presentation, /Object\.hasOwn\(GAME_MODES, lobbyMode\)/);
    assert.match(presentation, /getSelectableMaps\?\.\(\)\.includes\(lobbyMap\)/);
    assert.doesNotMatch(presentation, /\.broadcast\(|\.send\(|_pendingInitialLobbyWelcome/);
});
