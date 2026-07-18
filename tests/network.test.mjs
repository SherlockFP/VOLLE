import test from 'node:test';
import assert from 'node:assert/strict';

import { Network, isNewerSequence, reconnectDelay } from '../js/network.js';

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

test('host admits each connection once while preserving join avatar', () => {
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
    network.handleMessage({ type: 'join', name: 'A', playerId: 'player-a', avatar: 'avatar' }, 'peer-a');
    network.handleMessage({ type: 'join', name: 'A', playerId: 'player-a', avatar: 'avatar' }, 'peer-a');

    assert.deepEqual(joins, [['A', 'player-a', 'avatar', 'peer-a']]);
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
