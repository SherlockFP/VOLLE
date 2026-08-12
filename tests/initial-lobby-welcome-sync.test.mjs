import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const STATES = { MENU: 'MENU', LOBBY: 'LOBBY', PLAYING: 'PLAYING', SOCIAL_HUB: 'SOCIAL_HUB' };
const GAME_MODES = { classic: {}, speedball: {} };

async function loadActualWelcomeBridge() {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = main.indexOf('    _applyInitialLobbyWelcome(data) {');
    const end = main.indexOf('\n    _finalizeClientLobbyJoin(code)', start);
    assert.ok(start >= 0 && end > start, 'welcome bridge must be a bounded App method');
    const method = main.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    return new Function('STATES', 'GAME_MODES', `return function(data) {${body}}`)(STATES, GAME_MODES);
}

async function loadActualFinalizer() {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = main.indexOf('    _finalizeClientLobbyJoin(code) {');
    const end = main.indexOf('\n    _setupClientNetHandlers()', start);
    assert.ok(start >= 0 && end > start, 'join finalizer must be a bounded App method');
    const method = main.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    return new Function(`return function(code) {${body}}`)();
}

function createApp({ isHost = false, hostRoomCode = 'host-room', maps = ['beach', 'space'] } = {}) {
    const calls = [];
    return {
        network: { isHost, hostRoomCode },
        ui: { setRoomCode: code => calls.push(['room', code]) },
        game: {
            mode: { id: 'classic' },
            getSelectableMaps: () => maps,
            applyModeChange: payload => calls.push(['mode', payload.modeId]),
            applyMapChange: payload => calls.push(['map', payload.mapId]),
            onModeChange: modeId => calls.push(['refresh-controls', modeId])
        },
        calls
    };
}

test('actual welcome bridge accepts first welcome states and trusted snapshot fallbacks without authority writes', async () => {
    const bridge = await loadActualWelcomeBridge();
    for (const payload of [
        { type: 'welcome', state: undefined, mode: 'speedball', map: 'space' },
        { type: 'welcome', state: 'LOBBY', mode: 'speedball', map: 'space' },
        { type: 'welcome', state: 'PLAYING', mode: 'speedball', map: 'space' },
        { type: 'welcome', state: 'lobby', snapshot: { mode: 'speedball', map: 'space' } }
    ]) {
        const app = createApp();
        assert.equal(bridge.call(app, payload), true);
        assert.deepEqual(app.calls, [
            ['room', 'host-room'], ['mode', 'speedball'], ['map', 'space'], ['refresh-controls', 'classic']
        ]);
    }
});

test('actual welcome bridge isolates social, rejects malformed fields, and remains idempotent', async () => {
    const bridge = await loadActualWelcomeBridge();
    const social = createApp();
    assert.equal(bridge.call(social, { type: 'welcome', state: 'SOCIAL_HUB', mode: 'speedball', map: 'space' }), false);
    assert.deepEqual(social.calls, []);

    const malformed = createApp({ hostRoomCode: ' '.repeat(129) });
    assert.equal(bridge.call(malformed, { type: 'welcome', mode: '<script>', map: '../arena' }), true);
    assert.deepEqual(malformed.calls, [['refresh-controls', 'classic']]);

    const host = createApp({ isHost: true });
    assert.equal(bridge.call(host, { type: 'welcome', mode: 'speedball', map: 'space' }), false);
    assert.deepEqual(host.calls, []);
});

test('actual join finalizer reapplies a pending welcome after the lobby screen is ready', async () => {
    const finalize = await loadActualFinalizer();
    const calls = [];
    const pending = { type: 'welcome', mode: 'speedball', map: 'space' };
    const app = {
        network: { hostRoomCode: ' transport-room ' },
        ui: { setRoomCode: code => calls.push(['room', code]) },
        _pendingInitialLobbyWelcome: pending,
        _applyInitialLobbyWelcome: welcome => calls.push(['welcome', welcome]),
        game: { mode: { id: 'classic' }, onModeChange: mode => calls.push(['refresh', mode]) }
    };
    finalize.call(app, 'packet-room');
    assert.deepEqual(calls, [
        ['room', 'transport-room'], ['welcome', pending], ['refresh', 'classic']
    ]);
    assert.equal(app._lobbyCode, 'transport-room');
    assert.equal(app._pendingInitialLobbyWelcome, null);

    finalize.call(app, 'untrusted-packet-room');
    assert.deepEqual(calls, [
        ['room', 'transport-room'], ['welcome', pending], ['refresh', 'classic'],
        ['room', 'transport-room'], ['refresh', 'classic']
    ]);
    assert.equal(app._pendingInitialLobbyWelcome, null, 'a finalized welcome cannot be reapplied');
});

test('client welcome handler invokes the bridge before unchanged late-join handling without broadcast', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const bridgeStart = main.indexOf('    _applyInitialLobbyWelcome(data) {');
    const setupStart = main.indexOf('    _setupClientNetHandlers() {');
    const setupEnd = main.indexOf('\n    leaveLobby()', setupStart);
    assert.ok(bridgeStart >= 0 && setupStart > bridgeStart && setupEnd > setupStart);
    const bridge = main.slice(bridgeStart, setupStart);
    const setup = main.slice(setupStart, setupEnd);

    assert.match(bridge, /const welcomeState = data\?\.state \|\| data\?\.snapshot\?\.state;/);
    assert.match(bridge, /welcomeState === STATES\.SOCIAL_HUB/);
    assert.match(bridge, /this\.network\?\.hostRoomCode/);
    assert.doesNotMatch(bridge, /data\.room(?:Code)?/);
    assert.match(bridge, /data\.mode \?\? data\.snapshot\?\.mode/);
    assert.match(bridge, /data\.map \?\? data\.snapshot\?\.map/);
    assert.match(bridge, /this\.game\.applyModeChange\(\{ modeId: welcomeMode \}\);/);
    assert.match(bridge, /this\.game\.applyMapChange\(\{ mapId: welcomeMap \}\);/);
    assert.doesNotMatch(bridge, /\.broadcast\(|\.send\(/);
    assert.match(setup, /if \(data\?\.type === 'welcome'\) \{\s*this\._applyInitialLobbyWelcome\(data\);\s*const welcomeState = data\.state \|\| data\.snapshot\?\.state;/);
    assert.doesNotMatch(setup, /data\?\.type === 'welcome' && data\.state/);
    assert.match(setup, /if \(welcomeState === STATES\.SOCIAL_HUB\) this\._enterSocialLobby\(\);\s*else if \(welcomeState\) \{\s*const result = this\.game\.handleLateJoin\?\.\(data\);/);
    assert.match(setup, /if \(data\?\.type === 'welcome'\) this\._pendingInitialLobbyWelcome = data;\s*this\.game\.applyLobbyState\(data\);/);
    const manual = main.slice(main.indexOf("bind('btn-join-connect'"), main.indexOf("bind('btn-join-back'"));
    const quickStart = main.indexOf('    async _quickJoin(code, quickPlay = null) {');
    const quick = main.slice(quickStart, main.indexOf('\n    // Host:', quickStart));
    assert.match(manual, /await this\._confirmLobbyAdmission\(code\);[\s\S]*?this\.game\.playerName = name;[\s\S]*?this\.ui\.showScreen\('lobby'\);\s*this\._finalizeClientLobbyJoin\(code\);/);
    assert.match(quick, /await this\._confirmLobbyAdmission\(code\);[\s\S]*?this\.game\.playerName = name;[\s\S]*?this\.ui\.showScreen\('lobby'\);\s*this\._finalizeClientLobbyJoin\(code\);/);
    const finalizer = main.slice(main.indexOf('    _finalizeClientLobbyJoin(code) {'), setupStart);
    assert.match(finalizer, /this\.network\?\.hostRoomCode \?\? code/);
    assert.doesNotMatch(finalizer, /\.broadcast\(|\.send\(/);
});
