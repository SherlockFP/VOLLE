// Join-as-spectator protocol: a spectator transport has no gameplay authority, never
// takes a team slot or migration-roster entry, and can only chat / emote / change seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
    Network,
    MAX_LOBBY_SPECTATORS,
    SPECTATOR_ALLOWED_TYPES,
    isSpectatorAllowedMessage
} from '../js/network.js';

function fakeConn(peer, metadata = {}) {
    const conn = new EventEmitter();
    Object.assign(conn, { peer, metadata: { ...metadata }, open: true, sent: [], closed: false });
    conn.send = data => conn.sent.push(data);
    conn.close = () => {
        if (conn.closed) return;
        conn.closed = true;
        conn.open = false;
        conn.emit('close');
    };
    return conn;
}

function hostNetwork(gameOverrides = {}) {
    const calls = { remoteAttack: 0, updateRemotePlayer: 0, skill: 0, powerUp: 0, mapVote: 0, chat: [] };
    const game = {
        getPlayerList: () => [],
        state: 'LOBBY',
        scoreboard: {},
        remotePlayers: new Map(),
        spectators: new Map(),
        remoteAttack: () => calls.remoteAttack++,
        updateRemotePlayer: () => calls.updateRemotePlayer++,
        handleSkillUse: () => calls.skill++,
        handlePowerUpPickup: () => calls.powerUp++,
        handleMapVote: () => calls.mapVote++,
        addChatMessage: (name, text) => calls.chat.push([name, text]),
        ...gameOverrides
    };
    const network = new Network(game);
    network._ensureIdentityMaps();
    network.isHost = true;
    network.peer = { id: 'peer-host' };
    return { network, game, calls };
}

// Install an already-admitted spectator transport (what admission produces).
function admitSpectator(network, peer = 'peer-spec', playerId = 'player-spec') {
    const conn = fakeConn(peer, { name: 'Fan', playerId, spectator: true });
    Object.defineProperty(conn, '_spectator', { value: true });
    conn._admitted = true;
    network.connections.set(peer, conn);
    network.peerToPlayerId.set(peer, playerId);
    network.playerConnections.set(playerId, conn);
    return conn;
}

async function admitThroughHandshake(network, conn, token) {
    network._onIncomingConnection(conn);
    conn.emit('open');
    const challenge = conn.sent.at(-1);
    assert.equal(challenge?.type, 'resumeChallenge');
    conn.emit('data', {
        type: 'resumeResponse',
        nonce: challenge.nonce,
        playerId: conn.metadata.playerId,
        name: conn.metadata.name,
        password: '',
        avatar: '',
        resumeToken: token,
        capabilities: { positionV2: true, migrationVotes: true },
        ...(conn.metadata.spectator ? { spectator: true } : {})
    });
    return network.pendingIdentityAdmissions.get(conn.metadata.playerId)?.promise;
}

test('spectator whitelist excludes every gameplay packet', () => {
    assert.deepEqual([...SPECTATOR_ALLOWED_TYPES].sort(),
        ['capabilities', 'chat', 'emote', 'join', 'lobbyAdmissionRequest', 'ping', 'pong', 'spectatorSeat']);
    for (const type of ['position', 'attack', 'skillUse', 'teamChange', 'lateJoinTeam', 'powerUpPickup',
        'mapVote', 'partyReady', 'rematchReady', 'cosmeticLoadout', 'hostMigrationVote', 'ballState',
        'playerHit', 'scoreUpdate', 'gameStart', 'taunt', 'socialPresence', 'ready', 'kick']) {
        assert.equal(isSpectatorAllowedMessage(type), false, `${type} must be blocked for spectators`);
    }
});

test('host drops gameplay messages from a spectator but still accepts them from players', () => {
    const { network, calls } = hostNetwork();
    admitSpectator(network);
    const attack = { type: 'attack', name: 'P', x: 0, y: 1, z: 0, ax: 0, ay: 0, az: -1 };
    assert.equal(network._validateMsg(attack), true, 'fixture must be a valid attack packet');
    network.handleMessage(attack, 'peer-spec');
    network.handleMessage({ type: 'position', seq: 1, x: 0, y: 1.7, z: 3 }, 'peer-spec');
    network.handleMessage(network.encodePosition({ x: 0, y: 1.7, z: 3, seq: 2, playerId: 'player-spec' }), 'peer-spec');
    network.handleMessage({ type: 'skillUse', skill: 'slow' }, 'peer-spec');
    network.handleMessage({ type: 'powerUpPickup', id: 'p1' }, 'peer-spec');
    network.handleMessage({ type: 'mapVote', mapId: 'beach' }, 'peer-spec');
    let teamChanges = 0;
    network.onTeamChange = () => teamChanges++;
    network.handleMessage({ type: 'teamChange', team: 'blue' }, 'peer-spec');
    assert.deepEqual(
        { attack: calls.remoteAttack, move: calls.updateRemotePlayer, skill: calls.skill, powerUp: calls.powerUp, vote: calls.mapVote, teamChanges },
        { attack: 0, move: 0, skill: 0, powerUp: 0, vote: 0, teamChanges: 0 }
    );

    // Same packets from an ordinary admitted player still reach the game.
    const player = fakeConn('peer-player', { name: 'P', playerId: 'player-p' });
    player._admitted = true;
    network.connections.set('peer-player', player);
    network.peerToPlayerId.set('peer-player', 'player-p');
    network.handleMessage(attack, 'peer-player');
    network.handleMessage({ type: 'position', seq: 1, x: 0, y: 1.7, z: -3 }, 'peer-player');
    assert.equal(calls.remoteAttack, 1);
    assert.equal(calls.updateRemotePlayer, 1);
});

test('spectator chat is relayed under a spectator tag', () => {
    const { network, game, calls } = hostNetwork();
    const spectatorConn = admitSpectator(network);
    game.spectators.set('player-spec', { playerId: 'player-spec', name: 'Fan', seat: 0 });
    const other = fakeConn('peer-other', { playerId: 'player-other' });
    other._admitted = true;
    network.connections.set('peer-other', other);
    network.handleMessage({ type: 'chat', text: 'go red!' }, 'peer-spec');
    assert.deepEqual(calls.chat, [['Fan (spectator)', 'go red!']]);
    assert.equal(other.sent.at(-1).name, 'Fan (spectator)');
    assert.ok(spectatorConn.sent.length >= 1);
});

test('emotes are host-relayed, identity-stamped and rate limited for spectators and players', () => {
    const { network } = hostNetwork();
    admitSpectator(network);
    const emotes = [];
    network.onEmote = (playerId, emote, fromSpectator) => emotes.push([playerId, emote, fromSpectator]);
    for (let i = 0; i < 5; i++) {
        network.handleMessage({ type: 'emote', emote: 'fire', playerId: 'someone-else' }, 'peer-spec');
    }
    assert.equal(emotes.length, 3, 'three emotes per 4s window');
    assert.deepEqual(emotes[0], ['player-spec', 'fire', true], 'host uses the transport identity, not the packet');
    // Malformed ids never reach the game.
    network.handleMessage({ type: 'emote', emote: '<img>' }, 'peer-spec');
    assert.equal(emotes.length, 3);

    // Players use the same wheel; their emotes are tagged as player emotes.
    const player = fakeConn('peer-player', { playerId: 'player-p' });
    player._admitted = true;
    network.connections.set('peer-player', player);
    network.peerToPlayerId.set('peer-player', 'player-p');
    network.handleMessage({ type: 'emote', emote: 'gg' }, 'peer-player');
    assert.deepEqual(emotes.at(-1), ['player-p', 'gg', false]);
});

test('seat requests reach the host only from spectators and only as bounded integers', () => {
    const { network } = hostNetwork();
    admitSpectator(network);
    const seats = [];
    network.onSpectatorSeat = (playerId, seat) => seats.push([playerId, seat]);
    network.handleMessage({ type: 'spectatorSeat', seat: 4 }, 'peer-spec');
    network.handleMessage({ type: 'spectatorSeat', seat: -1 }, 'peer-spec');
    network.handleMessage({ type: 'spectatorSeat', seat: 1.5 }, 'peer-spec');
    network.handleMessage({ type: 'spectatorSeat', seat: 5000 }, 'peer-spec');
    assert.deepEqual(seats, [['player-spec', 4]]);
});

test('clients accept relayed emotes only from the host transport', () => {
    const network = new Network({});
    network.hostConn = { peer: 'host-peer' };
    const emotes = [];
    network.onEmote = (playerId, emote) => emotes.push([playerId, emote]);
    network.handleMessage({ type: 'emote', playerId: 'player-spec', emote: 'clap' }, 'mesh-peer');
    network.handleMessage({ type: 'emote', playerId: 'player-spec', emote: 'clap' }, 'host-peer');
    assert.deepEqual(emotes, [['player-spec', 'clap']]);
});

test('spectator admission: no team slot, no migration roster, spectator callback only', async () => {
    const { network } = hostNetwork();
    const joins = [];
    const spectatorJoins = [];
    const leaves = [];
    network.onPlayerJoin = (...args) => joins.push(args);
    network.onSpectatorJoin = (...args) => spectatorJoins.push(args);
    network.onSpectatorLeave = playerId => leaves.push(playerId);
    network.onPlayerLeave = () => assert.fail('a spectator leaving is not a player leaving');
    const conn = fakeConn('peer-fan', { name: 'Fan', playerId: 'player-fan', spectator: true });
    assert.equal(await admitThroughHandshake(network, conn, 'resume-fan'), true);
    assert.equal(conn._spectator, true);
    assert.equal(joins.length, 0);
    assert.deepEqual(spectatorJoins, [['Fan', 'player-fan', 'peer-fan']]);
    assert.equal(network.migrationRoster.has('player-fan'), false, 'spectators are never host candidates');
    assert.equal(network.getPlayerConnectionCount(), 0);
    assert.equal(network.getSpectatorConnectionCount(), 1);
    const welcome = conn.sent.find(packet => packet?.type === 'welcome');
    assert.equal(welcome?.spectator, true);
    conn.close();
    assert.deepEqual(leaves, ['player-fan']);
});

test('host enforces the spectator cap', async () => {
    const { network } = hostNetwork();
    for (let i = 0; i < MAX_LOBBY_SPECTATORS; i++) admitSpectator(network, `peer-s${i}`, `player-s${i}`);
    const conn = fakeConn('peer-late', { name: 'Late', playerId: 'player-late', spectator: true });
    await admitThroughHandshake(network, conn, 'resume-late');
    assert.equal(conn._spectator, undefined);
    assert.equal(network.playerConnections.has('player-late'), false);
    assert.equal(conn.sent.some(packet => packet?.type === 'kick' && packet.reason === 'spectators_full'), true);
});

test('movement is relayed to spectator transports only (they are off the mesh)', () => {
    const { network } = hostNetwork();
    const spectator = admitSpectator(network);
    const player = fakeConn('peer-player', { playerId: 'player-p' });
    network.connections.set('peer-player', player);
    network.relayPositionToSpectators({ x: 1, y: 1.7, z: -4, seq: 3 }, 'player-p', 'peer-player', { hp: 80, alive: true });
    assert.equal(player.sent.length, 0);
    assert.deepEqual(spectator.sent.at(-1), {
        x: 1, y: 1.7, z: -4, seq: 3, type: 'position', playerId: 'player-p', peerId: 'peer-player', hp: 80, alive: true
    });
});

test('a spectator client never sends movement, attacks or skills', () => {
    const network = new Network({});
    const conn = fakeConn('host-peer');
    network.connections.set('host-peer', conn);
    network.hostConn = conn;
    network.spectatorMode = true;
    network.sendPosition({ x: 0, y: 0, z: 0 }, 0);
    network.sendAttack({ x: 0 });
    network.sendSkillUse({ skill: 'slow' });
    assert.equal(conn.sent.length, 0);
    network.spectatorMode = false;
    network.sendAttack({ x: 0 });
    assert.equal(conn.sent.length, 1);
});

test('spectator packets are validated before dispatch', () => {
    const network = new Network({});
    assert.equal(network._validateMsg({ type: 'emote', emote: 'fire' }), true);
    assert.equal(network._validateMsg({ type: 'emote', emote: 'FIRE!' }), false);
    assert.equal(network._validateMsg({ type: 'emote', emote: 'fire', playerId: 'bad id' }), false);
    assert.equal(network._validateMsg({ type: 'spectatorSeat', seat: 3 }), true);
    assert.equal(network._validateMsg({ type: 'spectatorSeat', seat: '3' }), false);
});
