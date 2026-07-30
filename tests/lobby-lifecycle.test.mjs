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

test('lobby TTL keeps a reasonable margin above the 12s host keep-alive cadence', () => {
    assert.ok(LOBBY_TTL >= 30000 && LOBBY_TTL <= 45000, `expected 30-45s TTL, got ${LOBBY_TTL}`);
    assert.ok(LOBBY_TTL > 12000 * 2, 'TTL should survive at least two missed keep-alive ticks');
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
