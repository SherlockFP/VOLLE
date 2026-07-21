import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
    HOST_CHECKPOINT_MAX_BYTES,
    HOST_MIGRATION_BACKOFF_MAX_MS,
    HOST_MIGRATION_TIMEOUT_MS,
    electionAgreement,
    hasElectionAgreement,
    migrationAttemptId,
    migrationBackoffMs,
    migrationRosterDigest,
    nextMigrationEpoch,
    normalizeHostCheckpoint,
    rankHostCandidates,
    selectHostCandidate,
    validateHostMigrationProposal
} from '../js/host-migration.js';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const STATES = Object.freeze({
    PLAYING: 'playing',
    ROUND_END: 'round-end'
});

function extractGameMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(gameSource);
    assert.ok(match, `Game.${name} method not found`);

    const start = match.index;
    const bodyStart = gameSource.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = bodyStart; index < gameSource.length; index++) {
        const character = gameSource[index];
        const next = gameSource[index + 1];

        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false;
                index++;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === '/' && next === '/') {
            lineComment = true;
            index++;
            continue;
        }
        if (character === '/' && next === '*') {
            blockComment = true;
            index++;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) {
            return gameSource.slice(start, index + 1);
        }
    }

    assert.fail(`Game.${name} method body is incomplete`);
}

function compileGameMethod(name, globals = {}) {
    const method = extractGameMethod(name);
    return runInNewContext(`({ ${method} }).${name}`, globals);
}

const reconcileHostRevive = compileGameMethod('_reconcileHostRevive');
const applyHostMigrationCheckpoint = compileGameMethod('applyHostMigrationCheckpoint');
const validateHostMigrationCheckpointState = compileGameMethod('_validateHostMigrationCheckpointState', { STATES });
const restoreHostMigrationState = compileGameMethod('_restoreHostMigrationState', { STATES });

const candidate = (playerId, overrides = {}) => ({
    playerId,
    eligible: true,
    connected: true,
    ping: 30,
    stability: 0.9,
    uptime: 1000,
    packetLoss: 0.01,
    ...overrides
});

test('candidate ranking is deterministic across every policy tier', () => {
    const ranked = rankHostCandidates([
        candidate('z', { ping: 10, eligible: false }),
        candidate('ping-slow', { ping: 50 }),
        candidate('loss-high', { stability: 0.8, uptime: 2000, packetLoss: 0.2 }),
        candidate('uptime-low', { stability: 0.8, uptime: 1000, packetLoss: 0 }),
        candidate('loss-low', { stability: 0.8, uptime: 2000, packetLoss: 0.1 }),
        candidate('b'),
        candidate('a')
    ]);
    assert.deepEqual(ranked.map(item => item.playerId), [
        'a', 'b', 'loss-low', 'loss-high', 'uptime-low', 'ping-slow', 'z'
    ]);
    assert.equal(selectHostCandidate(ranked).playerId, 'a');
    assert.equal(selectHostCandidate([candidate('bad', { spectator: true })]), null);
});

test('invalid metrics cannot outrank a healthy candidate', () => {
    const ranked = rankHostCandidates([
        candidate('nan', { ping: Number.NaN, stability: Number.POSITIVE_INFINITY }),
        candidate('healthy', { ping: 100 })
    ]);
    assert.equal(ranked[0].playerId, 'healthy');
});

test('migration epochs advance monotonically and reject unsafe values', () => {
    assert.equal(nextMigrationEpoch(2), 3);
    assert.equal(nextMigrationEpoch(2, 8), 9);
    assert.equal(nextMigrationEpoch(-1), null);
    assert.equal(nextMigrationEpoch(Number.MAX_SAFE_INTEGER), null);
});

test('checkpoint normalization bounds data and strips unsafe content', () => {
    const state = Object.create(null);
    state.score = { red: 2, blue: Number.NaN };
    state.label = 'x'.repeat(5000);
    state.resumeToken = 'resume-secret';
    Object.defineProperty(state, '__proto__', { value: { polluted: true }, enumerable: true });
    const normalized = normalizeHostCheckpoint({
        epoch: 3,
        seq: 9,
        timestamp: 100,
        snapshot: state
    });
    assert.equal(normalized.sequence, 9);
    assert.equal(normalized.state.score.blue, null);
    assert.equal(normalized.state.label.length, 4096);
    assert.equal(Object.hasOwn(normalized.state, '__proto__'), false);
    assert.equal(Object.hasOwn(normalized.state, 'resumeToken'), false);
    assert.equal({}.polluted, undefined);
    assert.equal(normalizeHostCheckpoint({
        epoch: 1,
        state: { payload: 'x'.repeat(HOST_CHECKPOINT_MAX_BYTES) }
    }), null);
});

test('checkpoint normalization rejects malformed and cyclic input', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    assert.equal(normalizeHostCheckpoint({ epoch: 1, state: cyclic }), null);
    assert.equal(normalizeHostCheckpoint({ epoch: -1, state: {} }), null);
    assert.equal(normalizeHostCheckpoint({ epoch: 1, state: {} }, { maxBytes: 4 }), null);
});

test('election agreement requires an eligible strict majority', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const observedVotes = [
        { type: 'hostMigrationVote', voterId: 'a', candidateId: 'b', epoch: 4 },
        { type: 'hostMigrationVote', voterId: 'b', candidateId: 'b', epoch: 4 }
    ];
    const proof = observedVotes.map(({ voterId, candidateId, epoch }) => ({
        voterId, candidateId, epoch
    }));
    assert.equal(electionAgreement(proof, candidates, 4), 'b');
    assert.equal(hasElectionAgreement(proof, 'b', candidates, 4), true);
    assert.equal(hasElectionAgreement(proof.slice(0, 1), 'b', candidates, 4), false);
    assert.equal(hasElectionAgreement([
        ...proof,
        { voterId: 'outsider', candidateId: 'b', epoch: 4 }
    ], 'b', candidates, 4), false);
});

test('migration proposals reject stale epochs, skipped epochs and invalid candidates', () => {
    const candidates = [
        candidate('a'),
        candidate('b', { ping: 50 }),
        candidate('offline', { connected: false })
    ];
    candidates[0].peerId = 'peer-a';
    candidates[1].peerId = 'peer-b';
    candidates[2].peerId = 'peer-offline';
    const roster = candidates.map(({ playerId, peerId }) => ({ playerId, peerId }));
    const rosterDigest = migrationRosterDigest(roster);
    const attemptId = migrationAttemptId(3, roster, 'a');
    const votes = [
        { voterId: 'a', candidateId: 'a', epoch: 3, attemptId, rosterDigest },
        { voterId: 'b', candidateId: 'a', epoch: 3, attemptId, rosterDigest }
    ];
    const proposal = {
        epoch: 3,
        candidateId: 'a',
        hostPeerId: 'peer-a',
        roster,
        attemptId,
        rosterDigest,
        votes
    };
    const context = {
        currentEpoch: 2,
        candidates,
        roster,
        expectedPeerId: 'peer-a',
        observedVotes: votes
    };
    assert.equal(validateHostMigrationProposal(proposal, context), true);
    assert.equal(validateHostMigrationProposal({ ...proposal, epoch: 2 }, context), false);
    assert.equal(validateHostMigrationProposal({ ...proposal, epoch: 4 }, context), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        candidateId: 'b',
        hostPeerId: 'peer-b'
    }, { ...context, expectedPeerId: 'peer-b' }), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        votes: [votes[0]]
    }, context), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        roster: roster.slice(0, 2)
    }, context), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        roster: roster.map((player, index) => index
            ? player
            : { ...player, resumeToken: 'resume-secret' })
    }, context), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        candidateId: '__proto__'
    }, context), false);
    assert.equal(validateHostMigrationProposal({
        ...proposal,
        attemptId: `${attemptId}-stale`
    }, context), false);
    assert.equal(validateHostMigrationProposal(proposal, {
        ...context,
        observedVotes: votes.slice(0, 1)
    }), false);
});

test('timeout and exponential retry backoff stay bounded', () => {
    assert.equal(HOST_MIGRATION_TIMEOUT_MS, 5000);
    assert.deepEqual([0, 1, 2, 3].map(migrationBackoffMs), [250, 500, 1000, 2000]);
    assert.equal(migrationBackoffMs(999), HOST_MIGRATION_BACKOFF_MAX_MS);
    assert.equal(migrationBackoffMs(-5), 250);
});

test('host revive clears death presentation only for a local predicted death', () => {
    const createGame = predicted => {
        const player = {
            alive: false,
            maxHp: 100,
            killcamLock: true,
            revive() { this.reviveCalls = (this.reviveCalls || 0) + 1; },
            respawn() { this.respawnCalls = (this.respawnCalls || 0) + 1; }
        };
        return {
            player,
            _predictedLocalDeath: predicted,
            _spectateTarget: { name: 'teammate' },
            _killcamActive: true,
            _killcamTimer: null,
            _killcamKillerPos: {},
            _killcamDeathPos: {},
            ui: {
                spectating: true,
                setPlayerTarget(value) { this.targeted = value; }
            },
            _hideKillcam() {
                this.hideKillcamCalls = (this.hideKillcamCalls || 0) + 1;
                this._killcamActive = false;
                this._killcamTimer = null;
                this._killcamKillerPos = null;
                this._killcamDeathPos = null;
                this.player.killcamLock = false;
            }
        };
    };

    const predicted = createGame(true);
    let reconciled;
    assert.doesNotThrow(() => {
        reconciled = reconcileHostRevive.call(predicted, predicted.player, 80);
    });
    assert.equal(reconciled, true);
    assert.equal(predicted.player.alive, true);
    assert.equal(predicted.player.hp, 80);
    assert.equal(predicted.player.reviveCalls, 1);
    assert.equal(predicted.player.respawnCalls, 1);
    assert.equal(predicted._predictedLocalDeath, false);
    assert.equal(predicted._spectateTarget, null);
    assert.equal(predicted.hideKillcamCalls, 1);
    assert.equal(predicted._killcamActive, false);
    assert.equal(predicted.player.killcamLock, false);
    assert.equal(predicted.ui.spectating, false);
    assert.equal(predicted.ui.targeted, false);

    const ordinary = createGame(false);
    assert.equal(reconcileHostRevive.call(ordinary, ordinary.player, 80), false);
    assert.notEqual(ordinary._spectateTarget, null);
    assert.equal(ordinary._killcamActive, true);
    assert.equal(ordinary.ui.spectating, true);
    assert.equal(ordinary.hideKillcamCalls, undefined);

    const authoritative = createGame(false);
    authoritative.ui = null;
    assert.doesNotThrow(() => {
        reconciled = reconcileHostRevive.call(
            authoritative,
            authoritative.player,
            90,
            true
        );
    });
    assert.equal(reconciled, true);
    assert.equal(authoritative.player.alive, true);
    assert.equal(authoritative.player.hp, 90);
    assert.equal(authoritative.player.reviveCalls, 1);
    assert.equal(authoritative.player.respawnCalls, 1);
    assert.equal(authoritative._spectateTarget, null);
    assert.equal(authoritative._killcamActive, false);
    assert.equal(authoritative.player.killcamLock, false);
});

test('migration checkpoint restores state silently and hard-resets threat audio', () => {
    let threatResets = 0;
    let roundEnds = 0;
    let stateTransitions = 0;
    const game = {
        state: STATES.PLAYING,
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: null,
        ball: { _clientOnly: true },
        audio: { resetThreatAudio: () => threatResets++ },
        ui: { updateScores() {} },
        onRoundEnd: () => roundEnds++,
        setState: () => stateTransitions++,
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };

    assert.equal(applyHostMigrationCheckpoint.call(
        game,
        { state: STATES.ROUND_END },
        true
    ), true);
    assert.equal(game.state, STATES.ROUND_END);
    assert.equal(game.ball._clientOnly, false);
    assert.equal(threatResets, 1);
    assert.equal(stateTransitions, 0);
    assert.equal(roundEnds, 0);
});

test('invalid migration checkpoint is rejected atomically without threat reset', () => {
    let threatResets = 0;
    let lobbyApplies = 0;
    let scoreWrites = 0;
    let ballWrites = 0;
    const score = {
        redScore: 7,
        blueScore: 8,
        roundNum: 9,
        timeRemaining: 10,
        setMaxRounds() { scoreWrites++; },
        setTimeLimit() { scoreWrites++; }
    };
    const ball = {
        _clientOnly: true,
        position: { set() { ballWrites++; } },
        velocity: { set() { ballWrites++; } },
        mesh: null,
        currentSpeed: 12,
        active: true
    };
    const game = {
        state: STATES.PLAYING,
        player: { alive: true },
        network: { playerId: 'local' },
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: score,
        ball,
        audio: { resetThreatAudio: () => threatResets++ },
        ui: { updateScores() {} },
        applyLobbyState: () => lobbyApplies++,
        selectMode() {},
        selectMap() {},
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };
    const invalid = {
        state: STATES.ROUND_END,
        players: [{
            playerId: 'local',
            peerId: 'peer-local',
            name: 'Local',
            team: 'red',
            alive: true
        }],
        red: 2,
        blue: 3,
        round: 4,
        time: 5,
        ball: {
            x: 1, y: 2, z: 3,
            vx: Number.NaN, vy: 5, vz: 6,
            speed: 12,
            active: true
        }
    };

    assert.equal(applyHostMigrationCheckpoint.call(game, invalid, false), false);
    assert.equal(game.state, STATES.PLAYING);
    assert.deepEqual(
        [score.redScore, score.blueScore, score.roundNum, score.timeRemaining],
        [7, 8, 9, 10]
    );
    assert.equal(lobbyApplies, 0);
    assert.equal(scoreWrites, 0);
    assert.equal(ballWrites, 0);
    assert.equal(threatResets, 0);
    assert.equal(ball._clientOnly, true);
});

test('migration checkpoint authoritative revive clears prediction presentation', () => {
    const player = {
        alive: false,
        maxHp: 100,
        killcamLock: true,
        revive() { this.reviveCalls = (this.reviveCalls || 0) + 1; },
        respawn() { this.respawnCalls = (this.respawnCalls || 0) + 1; }
    };
    const game = {
        state: STATES.PLAYING,
        player,
        network: { playerId: 'local' },
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: null,
        ball: { _clientOnly: true },
        audio: { resetThreatAudio() {} },
        ui: {
            spectating: true,
            setPlayerTarget(value) { this.targeted = value; },
            updateScores() {}
        },
        _predictedLocalDeath: false,
        _spectateTarget: { name: 'teammate' },
        _killcamActive: true,
        _hideKillcam() {
            this._killcamActive = false;
            this.player.killcamLock = false;
        },
        applyLobbyState() {},
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };
    const checkpoint = {
        state: STATES.PLAYING,
        players: [{
            playerId: 'local',
            peerId: 'peer-local',
            name: 'Local',
            team: 'red',
            alive: true,
            hp: 80
        }]
    };

    assert.equal(applyHostMigrationCheckpoint.call(game, checkpoint, false), true);
    assert.equal(player.alive, true);
    assert.equal(player.hp, 80);
    assert.equal(player.reviveCalls, 1);
    assert.equal(player.respawnCalls, 1);
    assert.equal(game._predictedLocalDeath, false);
    assert.equal(game._spectateTarget, null);
    assert.equal(game._killcamActive, false);
    assert.equal(player.killcamLock, false);
    assert.equal(game.ui.spectating, false);
    assert.equal(game.ui.targeted, false);
});

test('migration players branch defers local mutation until remote restore succeeds', () => {
    const player = {
        alive: false,
        hp: 0,
        maxHp: 100,
        team: 'blue',
        revive() { this.reviveCalls = (this.reviveCalls || 0) + 1; },
        respawn() { this.respawnCalls = (this.respawnCalls || 0) + 1; },
        setTeam(team) { this.team = team; }
    };
    let appliedPlayers;
    const game = {
        state: STATES.PLAYING,
        player,
        network: { playerId: 'local' },
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: null,
        ball: { _clientOnly: true },
        audio: { resetThreatAudio() {} },
        ui: null,
        _spectateTarget: { name: 'teammate' },
        _killcamActive: true,
        applyLobbyState({ players }) {
            assert.equal(this.player.alive, false);
            appliedPlayers = players;
        },
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };
    const remote = {
        playerId: 'remote',
        peerId: 'peer-remote',
        name: 'Remote',
        team: 'blue',
        alive: true
    };

    assert.equal(applyHostMigrationCheckpoint.call(game, {
        state: STATES.PLAYING,
        players: [{
            playerId: 'local',
            peerId: 'peer-local',
            name: 'Local',
            team: 'red',
            alive: true,
            hp: 75
        }, remote]
    }, false), true);
    assert.deepEqual(appliedPlayers, [remote]);
    assert.equal(player.team, 'red');
    assert.equal(player.alive, true);
    assert.equal(player.hp, 75);
    assert.equal(player.reviveCalls, 1);
    assert.equal(player.respawnCalls, 1);
    assert.equal(game._spectateTarget, null);
    assert.equal(game._killcamActive, false);
});

test('checkpoint apply exception leaves local death untouched', () => {
    const player = {
        alive: false,
        hp: 0,
        maxHp: 100,
        revive() { this.reviveCalls = (this.reviveCalls || 0) + 1; },
        respawn() { this.respawnCalls = (this.respawnCalls || 0) + 1; }
    };
    const game = {
        state: STATES.PLAYING,
        player,
        network: { playerId: 'local' },
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: null,
        ball: { _clientOnly: true },
        audio: { resetThreatAudio() {} },
        ui: null,
        applyLobbyState() { throw new Error('remote restore failed'); },
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };

    assert.equal(applyHostMigrationCheckpoint.call(game, {
        state: STATES.PLAYING,
        players: [{
            playerId: 'local',
            peerId: 'peer-local',
            name: 'Local',
            team: 'red',
            alive: true,
            hp: 80
        }]
    }, false), false);
    assert.equal(player.alive, false);
    assert.equal(player.hp, 0);
    assert.equal(player.reviveCalls, undefined);
    assert.equal(player.respawnCalls, undefined);
    assert.equal(game.state, STATES.PLAYING);
});

test('late state failure rolls back gameplay snapshot deeply', () => {
    const vector = (x, y, z) => ({
        x, y, z,
        set(nextX, nextY, nextZ) {
            this.x = nextX;
            this.y = nextY;
            this.z = nextZ;
        },
        copy(other) {
            this.set(other.x, other.y, other.z);
        }
    });
    let currentState = STATES.PLAYING;
    let threatResets = 0;
    const world = { players: ['Remote-before'] };
    const player = {
        alive: false,
        hp: 0,
        maxHp: 100,
        team: 'blue',
        queuedForNextRound: false,
        pendingTeam: null,
        activateRound: null,
        killcamLock: true,
        position: vector(1, 2, 3),
        velocity: vector(4, 5, 6),
        euler: vector(0.1, 0.2, 0.3),
        group: { position: vector(7, 8, 9), visible: false },
        armGroup: { visible: false },
        setTeam(team) { this.team = team; },
        revive() {
            this.alive = true;
            this.position.set(50, 51, 52);
        },
        respawn() {
            this.position.set(60, 61, 62);
            this.group.visible = true;
        },
        setHandVisible(visible) { this.armGroup.visible = visible; }
    };
    const score = {
        maxRounds: 5,
        timeLimit: 100,
        roundNum: 2,
        redScore: 3,
        blueScore: 4,
        timeRemaining: 90,
        setMaxRounds(value) { this.maxRounds = value; },
        setTimeLimit(value) { this.timeLimit = value; }
    };
    const ball = {
        position: vector(10, 11, 12),
        velocity: vector(13, 14, 15),
        mesh: { position: vector(10, 11, 12), visible: true },
        currentSpeed: 16,
        active: true,
        _clientOnly: true,
        target: { id: 'old-target' },
        state: 'flying'
    };
    const game = {
        player,
        network: { playerId: 'local', peer: { id: 'peer-local' } },
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: score,
        ball,
        audio: { resetThreatAudio() { threatResets++; } },
        ui: {
            spectating: true,
            targeted: true,
            setPlayerTarget(value) { this.targeted = value; },
            updateScores() {}
        },
        _overtime: false,
        _overtimeTimer: 1,
        _overtimeExtends: 2,
        _suddenDeathAnnounced: false,
        _predictedLocalDeath: true,
        _spectateTarget: { name: 'Remote-before' },
        _killcamActive: true,
        _killcamTimer: 20,
        _killcamKillerPos: { x: 1 },
        _killcamDeathPos: { x: 2 },
        _killcamKillerName: 'Remote-before',
        _ballTarget: { id: 'tracked-target' },
        _ballTargetTime: 12,
        snapshotState() {
            return {
                players: [{
                    playerId: 'local',
                    peerId: 'peer-local',
                    name: 'Local',
                    team: this.player.team,
                    alive: this.player.alive,
                    hp: this.player.hp
                }, {
                    playerId: 'remote-before',
                    peerId: 'peer-remote-before',
                    name: 'Remote-before',
                    team: 'red',
                    alive: true
                }]
            };
        },
        applyLobbyState({ players }) {
            world.players = players.map(entry => entry.name);
        },
        selectMode(modeId) { this.mode = { id: modeId }; },
        selectMap(mapId) { this.arena.mapId = mapId; },
        _applyOvertimeSnapshot(snapshot) {
            this._overtime = snapshot.overtime;
            this._overtimeTimer = snapshot.overtimeTimer;
            this._overtimeExtends = snapshot.overtimeExtends;
            this._suddenDeathAnnounced = snapshot.suddenDeathAnnounced;
        },
        _validateHostMigrationCheckpointState: validateHostMigrationCheckpointState,
        _reconcileHostRevive: reconcileHostRevive,
        _restoreHostMigrationState: restoreHostMigrationState
    };
    Object.defineProperty(game, 'state', {
        enumerable: true,
        configurable: true,
        get() { return currentState; },
        set(value) {
            currentState = value;
            if (value === STATES.ROUND_END) throw new Error('late state failure');
        }
    });
    const gameplaySnapshot = () => ({
        world: structuredClone(world),
        player: {
            alive: player.alive,
            hp: player.hp,
            team: player.team,
            queuedForNextRound: player.queuedForNextRound,
            pendingTeam: player.pendingTeam,
            activateRound: player.activateRound,
            killcamLock: player.killcamLock,
            position: [player.position.x, player.position.y, player.position.z],
            velocity: [player.velocity.x, player.velocity.y, player.velocity.z],
            euler: [player.euler.x, player.euler.y, player.euler.z],
            groupPosition: [player.group.position.x, player.group.position.y, player.group.position.z],
            groupVisible: player.group.visible,
            armVisible: player.armGroup.visible
        },
        score: {
            maxRounds: score.maxRounds,
            timeLimit: score.timeLimit,
            roundNum: score.roundNum,
            redScore: score.redScore,
            blueScore: score.blueScore,
            timeRemaining: score.timeRemaining
        },
        mode: game.mode.id,
        map: game.arena.mapId,
        ball: {
            position: [ball.position.x, ball.position.y, ball.position.z],
            velocity: [ball.velocity.x, ball.velocity.y, ball.velocity.z],
            meshPosition: [ball.mesh.position.x, ball.mesh.position.y, ball.mesh.position.z],
            currentSpeed: ball.currentSpeed,
            active: ball.active,
            clientOnly: ball._clientOnly,
            target: ball.target,
            state: ball.state,
            meshVisible: ball.mesh.visible
        },
        state: game.state,
        overtime: [
            game._overtime,
            game._overtimeTimer,
            game._overtimeExtends,
            game._suddenDeathAnnounced
        ],
        ballTracking: [game._ballTarget, game._ballTargetTime],
        spectate: [game._predictedLocalDeath, game._spectateTarget, game.ui.spectating, game.ui.targeted],
        killcam: [
            game._killcamActive,
            game._killcamTimer,
            game._killcamKillerPos,
            game._killcamDeathPos,
            game._killcamKillerName
        ]
    });
    const before = gameplaySnapshot();

    assert.equal(applyHostMigrationCheckpoint.call(game, {
        state: STATES.ROUND_END,
        mode: 'chaos',
        map: 'moon',
        maxRounds: 9,
        timeLimit: 300,
        round: 8,
        red: 7,
        blue: 6,
        time: 50,
        overtime: true,
        overtimeTimer: 40,
        overtimeExtends: 3,
        suddenDeathAnnounced: true,
        players: [{
            playerId: 'local',
            peerId: 'peer-local',
            name: 'Local',
            team: 'red',
            alive: true,
            hp: 80,
            x: 20,
            y: 21,
            z: 22
        }, {
            playerId: 'remote-after',
            peerId: 'peer-remote-after',
            name: 'Remote-after',
            team: 'blue',
            alive: true
        }],
        ball: {
            x: 30, y: 31, z: 32,
            vx: 33, vy: 34, vz: 35,
            speed: 36,
            active: false
        }
    }, true), false);
    assert.deepEqual(gameplaySnapshot(), before);
    assert.equal(threatResets, 0);
});
