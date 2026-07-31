// P2P_HOST_FIXES: host-exit lobby closure, host migration re-registration, and
// full-state snapshot completeness. Exercises real shipped source (server.js lobby
// registry, js/network.js migration guard, js/game.js snapshot/late-join, and
// js/main.js migrated-host handoff) via node:test + isolated vm contexts — no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Network } from '../js/network.js';
import { formatLobbyAge, lobbyCapacity } from '../js/lobby-browser.js';
import { compileGameMethod } from './game-source.mjs';

const require = createRequire(import.meta.url);
const { normalizeLobbyRecord, pruneLobbies, lobbies, LOBBY_TTL } = require('../server.js');

// --- 1) Server lobby registry: TTL prune behavior (P2P_HOST_FIXES #1) ---

test('normalizeLobbyRecord stamps both updatedAt and lastSeen for TTL bookkeeping', () => {
    const record = normalizeLobbyRecord({ code: 'x', players: 2 }, 555);
    assert.equal(record.updatedAt, 555);
    assert.equal(record.lastSeen, 555);
});

test('pruneLobbies drops entries past LOBBY_TTL and keeps fresh ones', () => {
    const now = Date.now();
    lobbies.set('lifecycle-stale', normalizeLobbyRecord({ code: 'lifecycle-stale', players: 1 }, now - LOBBY_TTL - 1000));
    lobbies.set('lifecycle-fresh', normalizeLobbyRecord({ code: 'lifecycle-fresh', players: 1 }, now - 1000));
    try {
        pruneLobbies();
        assert.equal(lobbies.has('lifecycle-stale'), false);
        assert.equal(lobbies.has('lifecycle-fresh'), true);
    } finally {
        lobbies.delete('lifecycle-stale');
        lobbies.delete('lifecycle-fresh');
    }
});

test('pruneLobbies falls back to updatedAt when lastSeen is absent (legacy record shape)', () => {
    const now = Date.now();
    lobbies.set('lifecycle-legacy', { code: 'lifecycle-legacy', players: 1, updatedAt: now - LOBBY_TTL - 1000 });
    try {
        pruneLobbies();
        assert.equal(lobbies.has('lifecycle-legacy'), false);
    } finally {
        lobbies.delete('lifecycle-legacy');
    }
});

test('lobby TTL outlives a background tab throttled to one keep-alive tick per minute', () => {
    // Chrome intensive throttling clamps hidden-tab setInterval to 1/min, so the 12s
    // keep-alive cadence degrades to ~60s. A TTL at or below that prunes a live host.
    assert.ok(LOBBY_TTL > 60000, `TTL must exceed the 60s throttled tick floor, got ${LOBBY_TTL}`);
    assert.ok(LOBBY_TTL <= 120000, `TTL should not keep dead lobbies listed for minutes, got ${LOBBY_TTL}`);
});

// --- 2) Host migration: 1v1 closes, 2v2+ migrates (P2P_HOST_FIXES #1 / #2) ---

function rosterEntry(playerId, peerId, migrationOrder) {
    return { playerId, peerId, migrationOrder };
}

test('lone survivor after host loss closes the lobby instead of self-promoting (1v1)', () => {
    const network = new Network({});
    network.peer = { id: 'peer-self' };
    network.playerId = 'player-self';
    network.migrationRoster = new Map([
        ['player-self', rosterEntry('player-self', 'peer-self', 0)],
        ['player-host', rosterEntry('player-host', 'peer-host', 1)]
    ]);
    // The departed host's connection is gone — nothing registered for peer-host,
    // so _migrationCandidates() reports it ineligible and the roster shrinks to 1.
    let hostLeftCalls = 0;
    let migrationCalls = 0;
    network.onHostLeft = () => hostLeftCalls++;
    network.onHostMigration = () => migrationCalls++;

    network._beginHostMigration();

    assert.equal(hostLeftCalls, 1);
    assert.equal(migrationCalls, 0);
    assert.equal(network._migrationActive, false);
    assert.equal(network._migrationElection, null);
    assert.equal(network.isHost, false);
});

test('three or more remaining players migrate to a new host instead of closing (2v2+)', () => {
    const network = new Network({});
    network.peer = { id: 'peer-self' };
    network.playerId = 'player-self';
    network.migrationRoster = new Map([
        ['player-self', rosterEntry('player-self', 'peer-self', 0)],
        ['player-b', rosterEntry('player-b', 'peer-b', 1)],
        ['player-c', rosterEntry('player-c', 'peer-c', 2)]
    ]);
    network.connections.set('peer-b', { open: true, send: () => {} });
    network.connections.set('peer-c', { open: true, send: () => {} });
    let hostLeftCalls = 0;
    let migrationCalls = 0;
    network.onHostLeft = () => hostLeftCalls++;
    network.onHostMigration = () => migrationCalls++;

    network._beginHostMigration();

    assert.equal(hostLeftCalls, 0);
    assert.equal(migrationCalls, 1);
    assert.equal(network._migrationActive, true);
    assert.equal(network._migrationElection.candidates.length, 3);
});

// --- 3) Migrated host re-registers the lobby with a keep-alive handoff (P2P_HOST_FIXES #2) ---

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractAppMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(mainSource);
    assert.ok(match, `App.${name} method not found`);
    const start = match.index;
    const bodyStart = mainSource.indexOf('{', start);
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

test('migrated host re-registers the lobby and arms a keep-alive handoff', () => {
    const timers = new Map();
    let nextTimerId = 1;
    const globals = {
        setInterval: (callback, delay) => {
            const id = nextTimerId++;
            timers.set(id, { callback, delay });
            return id;
        },
        clearInterval: id => timers.delete(id)
    };
    const install = compileAppMethod('_installMigratedHostHandlers', globals);
    const registered = [];
    const app = {
        network: { connected: true, isHost: true, connections: new Map() },
        game: { mode: { name: 'Classic' } },
        arena: { config: { name: 'Beach Arena' } },
        _lobbyName: 'Migrated Lobby',
        _lobbyCode: null,
        _lobbyKeepAlive: null,
        _registerLobby(...args) { registered.push(args); }
    };

    install.call(app, 'new-host-room-code');

    assert.equal(app._lobbyCode, 'new-host-room-code');
    assert.equal(registered.length, 1, 'new host registers its own lobby record immediately');
    assert.equal(registered[0][0], 'new-host-room-code');
    assert.equal(timers.size, 1, 'a keep-alive interval was armed');
    const [[, timer]] = timers;
    assert.equal(timer.delay, 12000);

    timer.callback();
    assert.equal(registered.length, 2, 'keep-alive tick re-registers while still the connected host');

    app.network.isHost = false;
    timer.callback();
    assert.equal(registered.length, 2, 'keep-alive tick is a no-op once no longer host');
});

// --- 4) Full state snapshot completeness (P2P_HOST_FIXES #3) ---

const snapshotState = compileGameMethod('snapshotState');
// ponytail: snapshotState() runs inside a vm context, so nested objects it builds
// (settings/ballAffix/chaos) carry that realm's Object.prototype — deepStrictEqual
// treats prototype identity as part of equality, so round-trip through JSON first.
const plain = value => JSON.parse(JSON.stringify(value));

function baseSnapshotGame(overrides = {}) {
    return {
        matchId: 'match-1',
        getPlayerList: () => [{ name: 'p1', team: 'red' }],
        state: 'playing',
        mode: { id: 'classic' },
        arena: { mapId: 'beach' },
        scoreboard: { maxRounds: 5, timeLimit: 300, roundNum: 2, redScore: 3, blueScore: 1, timeRemaining: 120 },
        _overtimeExtends: 0,
        _overtime: false,
        _overtimeTimer: 0,
        _suddenDeathAnnounced: false,
        getHotPotatoSnapshot: () => null,
        botDifficulty: 'hard',
        currentBallAffix: null,
        _chaosModeIds: new Set(),
        chaosManager: null,
        ball: null,
        ...overrides
    };
}

test('snapshotState carries match settings so a late joiner does not fall back to defaults', () => {
    const snap = snapshotState.call(baseSnapshotGame());
    assert.deepEqual(plain(snap.settings), { matchTime: 300, maxRounds: 5, botDifficulty: 'hard' });
});

test('snapshotState carries the active ball affix (mutator) when one is applied', () => {
    const affixed = snapshotState.call(baseSnapshotGame({
        currentBallAffix: { id: 'fire', color: 0xff5500, extra: 'ignored-by-shape-not-by-picker' }
    }));
    assert.deepEqual(plain(affixed.ballAffix), { id: 'fire', color: 0xff5500 });

    const unaffixed = snapshotState.call(baseSnapshotGame());
    assert.equal(unaffixed.ballAffix, null);
});

test('snapshotState carries chaos map hazards only while a chaos mode is active', () => {
    const tornado = { x: 1, z: 2, radius: 3, strength: 4, life: 5, age: 6, rotation: 7 };
    const inChaos = snapshotState.call(baseSnapshotGame({
        mode: { id: 'chaos' },
        _chaosModeIds: new Set(['chaos']),
        chaosManager: { tornadoes: [tornado], gravityFlipped: true }
    }));
    assert.deepEqual(plain(inChaos.chaos), { tornadoes: [tornado], gravityFlipped: true });

    const outOfChaos = snapshotState.call(baseSnapshotGame({
        mode: { id: 'classic' },
        _chaosModeIds: new Set(['chaos']),
        chaosManager: { tornadoes: [tornado], gravityFlipped: true }
    }));
    assert.equal(outOfChaos.chaos, null);
});

// --- 5) Late join applies the snapshot's ball/affix/chaos state (regression for the
//        `data.ball` dead-code bug: welcome only ever carried `ball` under `snapshot`) ---

const STATES = Object.freeze({
    MENU: 'menu',
    LOBBY: 'lobby',
    SOCIAL_HUB: 'social-hub',
    COUNTDOWN: 'countdown',
    PLAYING: 'playing'
});
// ponytail: the shared game-source.mjs compileGameMethod locates a method's opening
// brace via `indexOf('{', start)`, which mis-fires on `handleLateJoin(data = {})` —
// it finds the `{` inside the default param object instead of the real body. Its
// own regex match already ends at the true opening brace, so scan from there instead.
// Local-only fix (game-source.mjs is shared by other in-flight test suites).
const gameSourceText = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
function compileGameMethodFixed(name, globals = {}) {
    const match = new RegExp(`^ {4}${name}\\([^\\n]*\\) \\{`, 'm').exec(gameSourceText);
    assert.ok(match, `Game.${name} method not found`);
    const start = match.index;
    const bodyStart = start + match[0].length - 1;
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < gameSourceText.length; index++) {
        const character = gameSourceText[index];
        const next = gameSourceText[index + 1];
        if (lineComment) { if (character === '\n') lineComment = false; continue; }
        if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index++; } continue; }
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
        if (character === '}' && --depth === 0) {
            const method = gameSourceText.slice(start, index + 1);
            return runInNewContext(`({ ${method} }).${name}`, globals);
        }
    }
    assert.fail(`Game.${name} method body is incomplete`);
}
const handleLateJoin = compileGameMethodFixed('handleLateJoin', { STATES, performance: { now: () => 1000 } });

function vector3() {
    return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
}

function makeLateJoinGame() {
    const calls = { applyChaosState: [], updateBallAffix: [] };
    const game = {
        network: { isHost: false, playerId: 'me', peer: { id: 'peer-me' } },
        selectMode() {},
        arena: { mapId: 'beach', rebuild() {}, getPlayerSpawn: () => ({ x: 0, y: 0, z: 0 }) },
        scoreboard: {
            redScore: 0, blueScore: 0, roundNum: 0, timeRemaining: 0,
            reset() {}, players: { clear() {} }, addPlayer() {}
        },
        applyLobbyState() {},
        setState() {},
        _applyOvertimeSnapshot() {},
        rallyCount: 0,
        killStreak: 0,
        _spectateTarget: null,
        _hideKillcam() {},
        ui: { hideAll() {}, showHUD() {}, showCountdown() {}, updateBallAffix(affix) { calls.updateBallAffix.push(affix); } },
        player: { queuedForNextRound: false, alive: true, hp: 100, respawn() {}, setHandVisible() {}, team: 'red', pendingTeam: null, activateRound: null },
        playerName: 'me',
        bots: [],
        remotePlayers: new Map(),
        audio: { init() {}, preloadSfx() {} },
        initMinimap() {},
        ball: { position: vector3(), velocity: vector3(), currentSpeed: 0, active: false, mesh: { visible: false }, affix: null },
        clearBlackHoles() {},
        clearSplitBalls() {},
        chaosManager: { clear() {} },
        _clearAllPowerUps() {},
        currentBallAffix: null,
        applyChaosState(data) { calls.applyChaosState.push(data); }
    };
    return { game, calls };
}

test('late join applies ball position from data.snapshot.ball (the field welcome actually sends)', () => {
    const { game } = makeLateJoinGame();
    handleLateJoin.call(game, {
        state: STATES.PLAYING,
        snapshot: {
            players: [],
            ball: { x: 10, y: 1, z: -5, vx: 1, vy: 0, vz: 2, speed: 8, active: true }
        }
    });
    assert.deepEqual({ x: game.ball.position.x, y: game.ball.position.y, z: game.ball.position.z }, { x: 10, y: 1, z: -5 });
    assert.equal(game.ball.active, true);
    assert.equal(game.ball.mesh.visible, true);
});

test('late join still honors a bare data.ball for backward compatibility', () => {
    const { game } = makeLateJoinGame();
    handleLateJoin.call(game, {
        state: STATES.PLAYING,
        ball: { x: 3, y: 0, z: 4, vx: 0, vy: 0, vz: 0, speed: 2, active: false }
    });
    assert.deepEqual({ x: game.ball.position.x, y: game.ball.position.y, z: game.ball.position.z }, { x: 3, y: 0, z: 4 });
});

test('late join restores the active ball affix and chaos hazards from the snapshot', () => {
    const { game, calls } = makeLateJoinGame();
    const chaos = { tornadoes: [], gravityFlipped: true };
    handleLateJoin.call(game, {
        state: STATES.PLAYING,
        snapshot: {
            players: [],
            ballAffix: { id: 'frost', color: 0x00ffff },
            chaos
        }
    });
    assert.deepEqual(game.currentBallAffix, { id: 'frost', color: 0x00ffff });
    assert.deepEqual(game.ball.affix, { id: 'frost', color: 0x00ffff });
    assert.deepEqual(calls.updateBallAffix[0], { id: 'frost', color: 0x00ffff });
    assert.deepEqual(calls.applyChaosState[0], chaos);
});

test('late join is a no-op for affix/chaos when the snapshot omits them', () => {
    const { game, calls } = makeLateJoinGame();
    handleLateJoin.call(game, { state: STATES.PLAYING, snapshot: { players: [] } });
    assert.equal(game.currentBallAffix, null);
    assert.equal(calls.updateBallAffix.length, 0);
    assert.equal(calls.applyChaosState.length, 0);
});

// --- 6) Host migration checkpoint best-effort restores the ball affix too ---

const applyHostMigrationCheckpoint = compileGameMethod('applyHostMigrationCheckpoint');
const validateHostMigrationCheckpointState = compileGameMethod('_validateHostMigrationCheckpointState', {
    STATES: Object.freeze({ PLAYING: 'playing', ROUND_END: 'round-end' })
});
const restoreHostMigrationState = compileGameMethod('_restoreHostMigrationState', {
    STATES: Object.freeze({ PLAYING: 'playing', ROUND_END: 'round-end' })
});

test('migration checkpoint restore also resyncs the ball affix on success', () => {
    const game = {
        state: 'playing',
        mode: { id: 'classic' },
        arena: { mapId: 'beach' },
        scoreboard: null,
        ball: { _clientOnly: true, affix: null },
        audio: { resetThreatAudio() {} },
        ui: { updateScores() {}, updateBallAffix(affix) { this.lastAffix = affix; } },
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _restoreHostMigrationState: restoreHostMigrationState
    };

    const ok = applyHostMigrationCheckpoint.call(
        game,
        { state: 'round-end', ballAffix: { id: 'wobbly', color: 0x88ff44 } },
        true
    );

    assert.equal(ok, true);
    assert.deepEqual(game.currentBallAffix, { id: 'wobbly', color: 0x88ff44 });
    assert.deepEqual(game.ball.affix, { id: 'wobbly', color: 0x88ff44 });
    assert.deepEqual(game.ui.lastAffix, { id: 'wobbly', color: 0x88ff44 });
});

test('migration checkpoint restore without a ballAffix leaves the current one untouched', () => {
    const game = {
        state: 'playing',
        mode: { id: 'classic' },
        arena: { mapId: 'beach' },
        scoreboard: null,
        ball: { _clientOnly: true, affix: { id: 'keep-me', color: 1 } },
        audio: { resetThreatAudio() {} },
        ui: { updateScores() {} },
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _restoreHostMigrationState: restoreHostMigrationState,
        currentBallAffix: { id: 'keep-me', color: 1 }
    };

    const ok = applyHostMigrationCheckpoint.call(game, { state: 'round-end' }, false);

    assert.equal(ok, true);
    assert.deepEqual(game.currentBallAffix, { id: 'keep-me', color: 1 });
});

// --- 7) Lobby browser pure helpers: age formatting + players/maxPlayers capacity (#4) ---

test('formatLobbyAge renders short relative labels', () => {
    const now = 1_000_000;
    assert.equal(formatLobbyAge(now - 2000, now), 'just now');
    assert.equal(formatLobbyAge(now - 45 * 1000, now), '45s ago');
    assert.equal(formatLobbyAge(now - 130 * 1000, now), '2m ago');
});

test('lobbyCapacity bounds players/maxPlayers the same way the open-slots filter does', () => {
    assert.deepEqual(lobbyCapacity({ players: 3, maxPlayers: 8 }), { players: 3, maxPlayers: 8 });
    assert.deepEqual(lobbyCapacity({}), { players: 1, maxPlayers: 8 });
    assert.deepEqual(lobbyCapacity({ players: 5, maxPlayers: 1 }), { players: 5, maxPlayers: 2 });
});

// --- 8) In-progress lobbies stay discoverable (late join, 2026-07-31) ---
// Starting the match used to run `clearInterval(this._lobbyKeepAlive);
// this._unregisterLobby(this._lobbyCode); this._lobbyCode = null;`, which deleted the
// lobby from the browser the instant it became joinable-as-a-late-joiner, and left the
// host with no code to clean up on exit. Both regressions are covered here.

test('starting a match re-registers the lobby instead of unregistering it', () => {
    const startHandler = mainSource.slice(
        mainSource.indexOf("bind('btn-start-game'"),
        mainSource.indexOf("bind('btn-party-ready'")
    );
    assert.ok(startHandler.length > 0, 'btn-start-game handler not found in js/main.js');
    assert.doesNotMatch(startHandler, /_unregisterLobby/,
        'match start must not delete the lobby — late joiners find it through the browser');
    assert.doesNotMatch(startHandler, /this\._lobbyCode = null/,
        'match start must keep _lobbyCode so beforeunload/leaveLobby can still clean up');
    assert.doesNotMatch(startHandler, /clearInterval\(this\._lobbyKeepAlive\)/,
        'the 12s keep-alive must survive match start or the lobby expires at LOBBY_TTL');
    assert.match(startHandler, /this\._registerLobby\(\s*this\._lobbyCode/,
        'match start should refresh the lobby record with the live player count');
});

test('a host tab throttled to one keep-alive per minute is not pruned', () => {
    const now = Date.now();
    // Hidden-tab intensive throttling: the 12s interval last fired 60s ago.
    lobbies.set('lifecycle-throttled', normalizeLobbyRecord({ code: 'lifecycle-throttled', players: 2 }, now - 60000));
    try {
        pruneLobbies();
        assert.equal(lobbies.has('lifecycle-throttled'), true,
            'a live host whose timer was throttled to 1/min must stay listed');
    } finally {
        lobbies.delete('lifecycle-throttled');
    }
});

// --- 9) joinGame surfaces an unreachable room code instead of hanging ---

function fakeEmitter() {
    const handlers = new Map();
    return {
        handlers,
        on(type, fn) { (handlers.get(type) || handlers.set(type, []).get(type)).push(fn); return this; },
        off(type, fn) {
            const list = handlers.get(type) || [];
            const index = list.indexOf(fn);
            if (index >= 0) list.splice(index, 1);
            return this;
        },
        emit(type, payload) { [...(handlers.get(type) || [])].forEach(fn => fn(payload)); }
    };
}

function joinableNetwork() {
    const network = new Network({});
    const conn = Object.assign(fakeEmitter(), { peer: 'host-peer', send() {}, close() {} });
    const peer = Object.assign(fakeEmitter(), { id: 'me', connect: () => conn });
    network.initPeer = async () => { network.peer = peer; network.connected = true; return peer.id; };
    return { network, peer, conn };
}

test('joinGame rejects when PeerJS reports the room code is unavailable', async () => {
    const { network, peer } = joinableNetwork();
    const pending = network.joinGame('host-peer', 'Joiner');
    await Promise.resolve();
    peer.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer host-peer' });
    await assert.rejects(pending, /Lobby not found/);
});

test('joinGame ignores unrelated peer errors and still resolves on open', async () => {
    const { network, peer, conn } = joinableNetwork();
    const pending = network.joinGame('host-peer', 'Joiner');
    await Promise.resolve();
    peer.emit('error', { type: 'network', message: 'transient' });
    conn.emit('open');
    await pending;
    assert.equal(network.hostConn, conn);
    // The one-shot peer-unavailable listener must be detached once the join succeeds.
    assert.equal((peer.handlers.get('error') || []).length, 0);
});

test('joinGame trims a pasted room code before dialling the peer', async () => {
    const { network, conn } = joinableNetwork();
    const pending = network.joinGame('  host-peer\n', 'Joiner');
    await Promise.resolve();
    conn.emit('open');
    await pending;
    assert.equal(network.hostRoomCode, 'host-peer');
    assert.equal(network.connections.get('host-peer'), conn);
});
