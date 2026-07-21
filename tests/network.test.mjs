import test from 'node:test';
import assert from 'node:assert/strict';

import {
    Network,
    hasSimulationAuthority,
    isNewerSequence,
    localJoinCosmetics,
    normalizeCountdownState,
    reconnectDelay
} from '../js/network.js';

test('join profile carries avatar, ball skin, and trail selection', () => {
    const values = {
        customAvatar: { dataURL: 'data:image/png;base64,avatar' },
        equippedAvatarSkin: 'neon',
        equippedBall: 'space',
        cosmeticLoadout: { ballTrail: 'rainbow' }
    };
    assert.deepEqual(localJoinCosmetics({ get: key => values[key] }), {
        avatar: 'data:image/png;base64,avatar',
        ballSkinId: 'space',
        ballTrailId: 'rainbow'
    });
});

test('offline and host simulations own the ball while clients do not', () => {
    assert.equal(hasSimulationAuthority(null), true);
    assert.equal(hasSimulationAuthority({ connected: false, isHost: false }), true);
    assert.equal(hasSimulationAuthority({ connected: true, isHost: true }), true);
    assert.equal(hasSimulationAuthority({ connected: true, isHost: false }), false);
});

test('authoritative countdown snapshots clamp phase and timing', () => {
    assert.deepEqual(normalizeCountdownState({ phase: 'pre', remaining: 8.4, duration: 10 }), {
        phase: 'pre', remaining: 8.4, duration: 10
    });
    assert.deepEqual(normalizeCountdownState({ phase: 'invalid', remaining: -2, duration: 0 }), {
        phase: 'idle', remaining: 0, duration: 1
    });
});

test('ball packet preserves state and stable target identity', () => {
    const network = new Network({});
    const decoded = network._decodeBinary(network.encodeBallState({
        seq: 9,
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6,
        speed: 17,
        active: true,
        state: 'homing',
        targetId: 'player-stable',
        targetName: 'Same Name',
        skinId: 'space',
        trailId: 'rainbow'
    }));

    assert.deepEqual(
        [decoded.x, decoded.y, decoded.z, decoded.vx, decoded.vy, decoded.vz],
        [1, 2, 3, 4, 5, 6]
    );
    assert.equal(decoded.state, 'homing');
    assert.equal(decoded.targetId, 'player-stable');
    assert.equal(decoded.targetName, 'Same Name');
    assert.equal(decoded.skinId, 'space');
    assert.equal(decoded.trailId, 'rainbow');
});

test('truncated binary packets fail closed before decoding fields', () => {
    const network = new Network({ updateBallFromNetwork() { throw new Error('must not run'); } });
    assert.doesNotThrow(() => network.handleMessage(new Uint8Array([1]), 'host-peer'));
    assert.doesNotThrow(() => network.handleMessage(new Uint8Array([2, 0]), 'host-peer'));
});

test('ball packet caps byte-sized text fields without corrupting cosmetics', () => {
    const network = new Network({});
    const decoded = network._decodeBinary(network.encodeBallState({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 17, active: true,
        targetName: 'n'.repeat(300),
        targetId: 'x'.repeat(300),
        affix: { id: 'a'.repeat(300), color: 0xff00ff },
        skinId: 'space',
        trailId: 'rainbow'
    }));
    assert.equal(new TextEncoder().encode(decoded.targetName).length, 255);
    assert.equal(new TextEncoder().encode(decoded.targetId).length, 255);
    assert.equal(new TextEncoder().encode(decoded.affix).length, 255);
    assert.equal(decoded.skinId, 'space');
    assert.equal(decoded.trailId, 'rainbow');
});

test('position packet preserves movement and identity fields', () => {
    const network = new Network({});
    const encoded = network.encodePosition({
        seq: 42,
        x: 1, y: 2, z: 3,
        ry: 4,
        ax: 5, ay: 6, az: 7,
        vx: 8, vy: 9, vz: 10,
        alive: true,
        hp: 80,
        team: 'red',
        name: 'Player',
        charId: 'rally',
        playerId: 'player-stable'
    });
    const decoded = network._decodeBinary(encoded);

    assert.equal(decoded.type, 'position');
    assert.equal(decoded.seq, 42);
    assert.deepEqual(
        [decoded.x, decoded.y, decoded.z, decoded.vx, decoded.vy, decoded.vz],
        [1, 2, 3, 8, 9, 10]
    );
    assert.equal(decoded.hp, 80);
    assert.equal(decoded.name, 'Player');
    assert.equal(decoded.charId, 'rally');
    assert.equal(decoded.playerId, 'player-stable');
});

test('sequence ordering handles duplicates, stale packets, and wraparound', () => {
    assert.equal(isNewerSequence(11, 10), true);
    assert.equal(isNewerSequence(10, 10), false);
    assert.equal(isNewerSequence(9, 10), false);
    assert.equal(isNewerSequence(0, 65535), true);
    assert.equal(isNewerSequence(65535, 0), false);
});

test('stale position packets never reach the game', () => {
    let updates = 0;
    const network = new Network({ updateRemotePlayer: () => updates++ });
    network.handleMessage({ type: 'position', seq: 5, x: 1, z: 1 }, 'peer');
    network.handleMessage({ type: 'position', seq: 5, x: 2, z: 2 }, 'peer');
    network.handleMessage({ type: 'position', seq: 4, x: 3, z: 3 }, 'peer');
    network.handleMessage({ type: 'position', seq: 6, x: 4, z: 4 }, 'peer');
    assert.equal(updates, 2);
});

test('reconnect backoff is bounded', () => {
    assert.deepEqual([1, 2, 3, 4].map(reconnectDelay), [500, 1000, 2000, 2000]);
});

test('legacy position packet remains readable', () => {
    const network = new Network({});
    const buffer = new ArrayBuffer(30);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setFloat32(1, 1);
    view.setFloat32(5, 2);
    view.setFloat32(9, 3);
    view.setUint8(29, 0);

    const decoded = network._decodeBinary(buffer);
    assert.equal(decoded.x, 1);
    assert.equal(decoded.vx, 0);
    assert.equal(decoded.seq, undefined);
});

test('playerId persists in session storage and constructor tolerates no storage', () => {
    const original = globalThis.sessionStorage;
    const values = new Map();
    globalThis.sessionStorage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
    };
    try {
        const first = new Network({});
        const second = new Network({});
        assert.equal(second.playerId, first.playerId);
        assert.equal(second.resumeToken, first.resumeToken);
    } finally {
        if (original === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = original;
    }
    assert.ok(new Network({}).playerId);
});

function fakeConn(peer, metadata = {}) {
    const handlers = new Map();
    return {
        peer, metadata, open: true, sent: [], closed: false,
        on(type, handler) { handlers.set(type, handler); },
        emit(type, data) { handlers.get(type)?.(data); },
        send(data) { this.sent.push(data); },
        close() { this.closed = true; this.emit('close'); }
    };
}

test('host admits each connection once while preserving join cosmetics', () => {
    const joins = [];
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    });
    network.isHost = true;
    network.onPlayerJoin = (...args) => joins.push(args);
    const conn = fakeConn('peer-a', { name: 'A', playerId: 'player-a' });

    network._handleJoinConn(conn);
    const join = {
        type: 'join', name: 'A', playerId: 'player-a', avatar: 'avatar',
        ballSkinId: 'space', ballTrailId: 'rainbow'
    };
    network.handleMessage(join, 'peer-a');
    network.handleMessage(join, 'peer-a');

    assert.deepEqual(joins, [[
        'A', 'player-a', 'avatar', 'peer-a',
        { ballSkinId: 'space', ballTrailId: 'rainbow' }
    ]]);
});

test('replaced connection close does not remove current player', () => {
    const leaves = [];
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    network.onPlayerLeave = (...args) => leaves.push(args);
    const oldConn = fakeConn('peer-old', { name: 'A', playerId: 'player-a', resumeToken: 'resume-a' });
    const newConn = fakeConn('peer-new', { name: 'A', playerId: 'player-a', resumeToken: 'resume-a' });

    network._handleJoinConn(oldConn);
    network.handleMessage({ type: 'join', name: 'A', playerId: 'player-a' }, 'peer-old');
    network._handleJoinConn(newConn);
    network.handleMessage({ type: 'join', name: 'A', playerId: 'player-a' }, 'peer-new');

    assert.equal(network.playerConnections.get('player-a'), newConn);
    assert.deepEqual(leaves, []);
    newConn.close();
    assert.deepEqual(leaves, [['player-a', 'peer-new']]);
});

test('active identity cannot be replaced without its resume token', () => {
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    const oldConn = fakeConn('peer-old', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    const attacker = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-a',
        resumeToken: 'resume-evil'
    });

    network._handleJoinConn(oldConn);
    network._handleJoinConn(attacker);

    assert.equal(network.playerConnections.get('player-a'), oldConn);
    assert.deepEqual(attacker.sent, [{
        type: 'kick',
        name: 'Evil',
        reason: 'duplicate_identity'
    }]);
});

test('disconnected identity still requires its original resume token', () => {
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    const oldConn = fakeConn('peer-old', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    const attacker = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-a',
        resumeToken: 'resume-evil'
    });

    network._handleJoinConn(oldConn);
    oldConn.close();
    network._handleJoinConn(attacker);

    assert.equal(network.playerConnections.has('player-a'), false);
    assert.equal(attacker.sent[0]?.reason, 'duplicate_identity');
});

test('join payload cannot claim an identity different from transport metadata', () => {
    const joins = [];
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    network.onPlayerJoin = (...args) => joins.push(args);
    const conn = fakeConn('peer-a', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });

    network._handleJoinConn(conn);
    network.handleMessage({ type: 'join', name: 'A', playerId: 'player-b' }, 'peer-a');

    assert.deepEqual(joins, []);
    assert.equal(conn._admitted, undefined);
    assert.equal(conn.closed, true);
});

test('host ignores gameplay packets until transport completes admission', () => {
    let attacks = 0;
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {},
        remoteAttack: () => attacks++
    });
    network.isHost = true;
    const conn = fakeConn('peer-a', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });

    network._handleJoinConn(conn);
    network.handleMessage({ type: 'attack', name: 'A', x: 0, y: 0 }, 'peer-a');

    assert.equal(attacks, 0);
});

test('host rejects mesh connections and client requires host-announced identity', () => {
    const host = new Network({});
    host.isHost = true;
    const hostMesh = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    host._onIncomingConnection(hostMesh);
    hostMesh.emit('open');
    assert.equal(hostMesh.closed, true);

    const client = new Network({});
    const unknown = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    client._handleMeshConn(unknown);
    assert.equal(unknown.closed, true);

    const known = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    client.allowedMeshPeers.set('peer-a', 'player-a');
    client._handleMeshConn(known);
    assert.equal(client.connections.get('peer-a'), known);
});

test('direct position packet cannot spoof another logical player', () => {
    const updates = [];
    const network = new Network({
        updateRemotePlayer: (...args) => updates.push(args)
    });
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'position',
        playerId: 'player-b',
        seq: 1,
        x: 1,
        z: 2
    }, 'peer-a');

    assert.deepEqual(updates, []);
});

test('host-relayed position keeps the logical player identity', () => {
    const updates = [];
    const network = new Network({
        updateRemotePlayer: (...args) => updates.push(args)
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({
        type: 'position',
        peerId: 'mesh-peer',
        playerId: 'player-a',
        seq: 1,
        x: 1,
        z: 2
    }, 'host-peer');

    assert.equal(updates.length, 1);
    assert.equal(updates[0][0], 'player-a');
    assert.equal(updates[0][2], 'mesh-peer');
});

test('concurrent mesh connect shares one pending transport', async () => {
    let connects = 0;
    const conn = fakeConn('peer-b');
    const network = new Network({});
    network.peer = {
        id: 'self',
        connect() {
            connects++;
            return conn;
        }
    };

    const first = network.connectToPeer('peer-b');
    const second = network.connectToPeer('peer-b');
    assert.equal(connects, 1);
    conn.emit('open');
    await Promise.all([first, second]);
    assert.equal(network.connections.get('peer-b'), conn);
});

test('social presence and chat reject malformed packets', () => {
    const presence = [];
    const chat = [];
    const network = new Network({});
    network.onSocialPresence = data => presence.push(data);
    network.onSocialChat = data => chat.push(data);

    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: 1, y: 2 }, 'peer');
    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: Infinity, y: 2, z: 3 }, 'peer');
    network.handleMessage({ type: 'socialChat', name: 'Player', text: 'x'.repeat(161) }, 'peer');
    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: 1, y: 2, z: 3 }, 'peer');
    network.handleMessage({ type: 'socialChat', playerId: 'p1', name: 'Player', text: 'hello' }, 'peer');

    assert.equal(presence.length, 1);
    assert.equal(chat.length, 1);
});

test('host rejects spoofed social identity', () => {
    let presence = 0;
    const network = new Network({});
    network.isHost = true;
    network.onSocialPresence = () => presence++;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'socialPresence',
        playerId: 'player-b',
        x: 1,
        y: 2,
        z: 3
    }, 'peer-a');

    assert.equal(presence, 0);
});

test('host rate limits social packets per peer and type', () => {
    let presence = 0;
    const network = new Network({});
    network.isHost = true;
    network.onSocialPresence = () => presence++;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    for (let i = 0; i < 100; i++) {
        network.handleMessage({
            type: 'socialPresence',
            playerId: 'player-a',
            x: 1,
            y: 2,
            z: 3
        }, 'peer-a');
    }

    assert.equal(presence, 30);
});

test('closing a peer clears its social rate state', () => {
    const network = new Network({});
    const conn = fakeConn('peer-a');
    network._allowSocialPacket('peer-a', 'socialPresence', 1);
    network._allowSocialPacket('peer-a', 'socialChat', 1);
    network.setupDataHandlers(conn);

    conn.emit('close');

    assert.equal(network._socialRate.size, 0);
});

test('social send helpers sanitize chat and include identity', () => {
    const sent = [];
    const network = new Network({});
    network.connected = true;
    network.playerId = 'player-1';
    network.playerName = 'Rally';
    network.send = data => sent.push(data);

    assert.equal(network.sendSocialChat('  hello hub  '), true);
    network.sendSocialPresence({ x: 1, y: 2, z: 3 }, 0.5, 'character-f');

    assert.deepEqual(sent[0], {
        type: 'socialChat',
        playerId: 'player-1',
        name: 'Rally',
        text: 'hello hub'
    });
    assert.equal(sent[1].skin, 'character-f');
    assert.equal(sent[1].ry, 0.5);
});

test('late-join team selection uses transport-bound identity', () => {
    const selections = [];
    const game = { remotePlayers: new Map([['player-a', { name: 'Alice' }]]) };
    const network = new Network(game);
    network.isHost = true;
    network.onLateJoinTeam = (playerId, team) => selections.push([playerId, team]);
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'lateJoinTeam',
        playerId: 'player-b',
        team: 'blue'
    }, 'peer-a');

    assert.deepEqual(selections, [['player-a', 'blue']]);
});

test('system chat is accepted only from the host transport', () => {
    const messages = [];
    const network = new Network({
        addChatMessage: (name, text) => messages.push([name, text])
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({ type: 'systemChat', text: 'trusted' }, 'host-peer');
    network.handleMessage({ type: 'systemChat', text: 'spoofed' }, 'mesh-peer');

    assert.deepEqual(messages, [['SERVER', 'trusted']]);
});

test('round and lobby state are accepted only from the host transport', () => {
    let rounds = 0;
    let lobbies = 0;
    const network = new Network({
        startRoundFromNetwork: () => rounds++,
        applyLobbyState: () => lobbies++
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({ type: 'roundStart' }, 'mesh-peer');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'mesh-peer');
    network.handleMessage({ type: 'roundStart' }, 'host-peer');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'host-peer');

    assert.equal(rounds, 1);
    assert.equal(lobbies, 1);
});

test('game start is accepted once from the connected host and rejects mesh spoofing', () => {
    const starts = [];
    const network = new Network({ startGameFromNetwork: data => starts.push(data) });
    network.connected = true;
    network.hostConn = { peer: 'host-peer' };
    const countdown = { phase: 'pre', remaining: 7.25, duration: 10 };

    network.handleMessage({ type: 'gameStart', countdown: { phase: 'final', remaining: 1 } }, 'mesh-peer');
    network.handleMessage({ type: 'gameStart', countdown }, 'host-peer');

    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].countdown, countdown);
});

test('authoritative state packets reject mesh and local-host spoofing', () => {
    const received = {
        playerHit: [],
        scoreUpdate: [],
        roundEnd: [],
        gameState: []
    };
    const network = new Network({
        applyPlayerHit: data => received.playerHit.push(data),
        updateScoresFromNetwork: data => received.scoreUpdate.push(data),
        applyRoundEnd: data => received.roundEnd.push(data)
    });
    network.onGameState = data => received.gameState.push(data);
    network.connected = true;
    network.hostConn = { peer: 'host-peer' };
    const packets = [
        { type: 'playerHit', dmg: 5, victimName: 'Player' },
        { type: 'scoreUpdate', red: 2, blue: 1 },
        { type: 'roundEnd', winner: 'red' },
        { type: 'gameState', state: 'PLAYING' }
    ];

    for (const packet of packets) network.handleMessage(packet, 'mesh-peer');
    for (const packet of packets) assert.equal(received[packet.type].length, 0);

    for (const packet of packets) network.handleMessage(packet, 'host-peer');
    for (const packet of packets) assert.deepEqual(received[packet.type], [packet]);

    network.isHost = true;
    const client = fakeConn('client-peer');
    client._admitted = true;
    network.connections.set(client.peer, client);
    for (const packet of packets) network.handleMessage(packet, client.peer);
    for (const packet of packets) assert.deepEqual(received[packet.type], [packet]);
});

test('ball state is accepted only from the authoritative host transport', () => {
    const updates = [];
    const network = new Network({ updateBallFromNetwork: data => updates.push(data) });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({ type: 'ballState', x: 1, y: 2, z: 3 }, 'mesh-peer');
    network.handleMessage({ type: 'ballState', x: 4, y: 5, z: 6 }, 'host-peer');

    assert.deepEqual(updates.map(data => data.x), [4]);
});

test('host broadcasts identical velocity and target snapshots to every peer', () => {
    const network = new Network({ player: {}, remotePlayers: new Map() });
    network.isHost = true;
    network.playerId = 'host-player';
    const first = fakeConn('peer-a');
    const second = fakeConn('peer-b');
    network.connections.set(first.peer, first);
    network.connections.set(second.peer, second);
    const target = { playerId: 'target-player', name: 'Same Name' };

    network.broadcastBallState({
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 4, y: 5, z: 6 },
        currentSpeed: 17,
        active: true,
        state: 'homing',
        skinId: 'space',
        trailId: 'rainbow',
        targetPlayer: target,
        affix: null
    });

    const a = network._decodeBinary(first.sent[0]);
    const b = network._decodeBinary(second.sent[0]);
    assert.deepEqual(a, b);
    assert.deepEqual([a.vx, a.vy, a.vz], [4, 5, 6]);
    assert.equal(a.targetId, 'target-player');
    assert.equal(a.skinId, 'space');
    assert.equal(a.trailId, 'rainbow');
});

test('active late join gate rejects new identities but permits resume tokens', () => {
    const game = { getPlayerList: () => [], state: 'PLAYING', scoreboard: {}, shouldQueueLateJoin: () => true };
    const network = new Network(game);
    network.isHost = true;
    network.allowLateJoin = false;
    network.playerResumeTokens.set('returning', 'resume-ok');
    const newcomer = fakeConn('peer-new', { name: 'New', playerId: 'new', resumeToken: 'new-token' });
    const returning = fakeConn('peer-return', { name: 'Back', playerId: 'returning', resumeToken: 'resume-ok' });

    network._handleJoinConn(newcomer);
    network._handleJoinConn(returning);

    assert.equal(newcomer.sent[0]?.reason, 'late_join_disabled');
    assert.equal(network.playerConnections.get('returning'), returning);
});

test('explicit host close notifies clients without starting migration', () => {
    const network = new Network({ snapshotState: () => ({}) });
    network.isHost = true;
    network.peer = { destroy() {} };
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set(conn.peer, conn);
    let migrations = 0;
    network._beginHostMigration = () => migrations++;

    network.closeLobby();

    assert.equal(migrations, 0);
    assert.equal(conn.sent[0]?.type, 'lobbyClosed');
    assert.equal(network.connected, false);
});

test('client close is local and sends no lobby closure', () => {
    const network = new Network({});
    const host = fakeConn('host-peer');
    network.connections.set(host.peer, host);
    network.peer = { destroy() {} };

    network.closeLobby();

    assert.deepEqual(host.sent, []);
    assert.equal(host.closed, true);
});

test('host rejects client-authored round and lobby state', () => {
    let rounds = 0;
    let lobbies = 0;
    const network = new Network({
        startRoundFromNetwork: () => rounds++,
        applyLobbyState: () => lobbies++
    });
    network.isHost = true;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);

    network.handleMessage({ type: 'roundStart' }, 'peer-a');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'peer-a');

    assert.equal(rounds, 0);
    assert.equal(lobbies, 0);
});
