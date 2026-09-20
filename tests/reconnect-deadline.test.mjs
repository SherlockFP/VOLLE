import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Network } from '../js/network.js';

function connection(peer) {
    const conn = new EventEmitter();
    Object.assign(conn, { peer, open: false, closed: false, closeCalls: 0, sent: [] });
    conn.send = packet => conn.sent.push(packet);
    conn.close = () => {
        conn.closeCalls++;
        conn.open = false;
        if (conn.closed) return;
        conn.closed = true;
        conn.emit('close');
    };
    conn.openNow = () => { conn.open = true; conn.emit('open'); };
    return conn;
}

function fixture(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const network = new Network({});
    const peer = new EventEmitter();
    const requests = [];
    const states = [];
    peer.id = 'local-peer';
    // Match the permanent signalling error listener installed by initPeer.
    peer.on('error', () => {});
    peer.connect = (roomCode, options) => {
        const conn = connection(roomCode);
        requests.push({ conn, roomCode, options });
        return conn;
    };
    peer.destroy = () => { peer.destroyed = true; };
    network.peer = peer;
    network.connected = true;
    network.hostRoomCode = 'host-peer';
    network.playerName = 'Returning player';
    network.joinPassword = 'private-lobby';
    network.onReconnectState = (...state) => states.push(state);
    const migrate = network._beginHostMigration.bind(network);
    let migrations = 0;
    let exits = 0;
    network._beginHostMigration = () => { migrations++; migrate(); };
    network.onHostLeft = () => { exits++; };
    t.after(() => network.disconnect());
    return {
        network, peer, requests, states,
        advance: ms => t.mock.timers.tick(ms),
        start() { network._scheduleReconnect(); t.mock.timers.tick(500); return requests[0].conn; },
        get migrations() { return migrations; },
        get exits() { return exits; }
    };
}

const unavailable = peer => Object.assign(new Error(`Could not connect to peer ${peer}`), {
    type: 'peer-unavailable'
});

test('Peer-level host unavailability consumes three retries then invokes existing migration', t => {
    const f = fixture(t);
    f.network._scheduleReconnect();
    for (const [index, delay] of [500, 1000, 2000].entries()) {
        f.advance(delay);
        assert.equal(f.requests.length, index + 1);
        assert.equal(f.peer.listenerCount('error'), 2);
        f.peer.emit('error', unavailable('host-peer'));
        assert.equal(f.requests[index].conn.closeCalls, 1);
        assert.equal(f.peer.listenerCount('error'), 1);
    }
    assert.equal(f.migrations, 1);
    assert.equal(f.exits, 1, 'the existing lone-survivor rule still closes the lobby');
    assert.deepEqual(f.states.filter(([state]) => state === 'reconnecting'), [
        ['reconnecting', 1], ['reconnecting', 2], ['reconnecting', 3]
    ]);
    f.advance(60_000);
    assert.equal(f.requests.length, 3);
});

test('a silent transport expires after five seconds on every attempt', t => {
    const f = fixture(t);
    f.network._scheduleReconnect();
    for (const [index, delay] of [500, 1000, 2000].entries()) {
        f.advance(delay);
        const conn = f.requests[index].conn;
        f.advance(4999);
        assert.equal(conn.closed, false);
        f.advance(1);
        assert.equal(conn.closed, true);
        assert.equal(f.peer.listenerCount('error'), 1);
    }
    assert.equal(f.migrations, 1);
    assert.equal(f.requests.length, 3);
});

test('unrelated mesh and signalling errors cannot consume the host retry', t => {
    const f = fixture(t);
    const conn = f.start();
    f.peer.emit('error', unavailable('mesh-peer'));
    f.peer.emit('error', unavailable('host-peer-extra'));
    f.peer.emit('error', Object.assign(new Error('socket closed'), { type: 'network' }));
    f.advance(4999);
    assert.equal(conn.closed, false);
    assert.deepEqual(f.states, [['reconnecting', 1]]);
    conn.openNow();
    f.advance(10_000);
    assert.equal(f.network.hostConn, conn);
    assert.equal(f.requests.length, 1);
});

test('success retains identity and admission routing and removes the deadline listener', t => {
    const f = fixture(t);
    const identity = [f.network.playerId, f.network.resumeToken];
    const conn = f.start();
    assert.deepEqual(f.requests[0].options.metadata, {
        name: 'Returning player', password: 'private-lobby', playerId: identity[0],
        capabilities: { positionV2: true, migrationVotes: true }
    });
    conn.openNow();
    conn.openNow();
    assert.deepEqual([f.network.playerId, f.network.resumeToken], identity);
    assert.equal(f.network.connections.get('host-peer'), conn);
    assert.equal(conn.sent.filter(packet => packet.type === 'capabilities').length, 1);
    assert.equal(f.peer.listenerCount('error'), 1);
    assert.deepEqual(f.states, [['reconnecting', 1], ['connected', 0]]);
    f.advance(20_000);
    assert.equal(conn.closed, false);
    assert.equal(f.requests.length, 1);
    conn.close();
    f.advance(500);
    assert.equal(f.requests.length, 2, 'a later outage gets a fresh retry budget');
    assert.deepEqual(f.states.at(-1), ['reconnecting', 1]);
});

test('error plus close and duplicate scheduling consume only one attempt', t => {
    const f = fixture(t);
    const conn = f.start();
    f.network._scheduleReconnect();
    f.network._reconnectOnce();
    assert.equal(f.requests.length, 1);
    conn.emit('error', new Error('negotiation failed'));
    conn.emit('close');
    conn.emit('error', new Error('late failure'));
    assert.equal(conn.closeCalls, 1);
    assert.deepEqual(f.states, [['reconnecting', 1], ['reconnecting', 2]]);
    f.advance(1000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.migrations, 0);
});

test('an expired transport opening late cannot replace the successful next attempt', t => {
    const f = fixture(t);
    const stale = f.start();
    f.advance(5000);
    f.advance(1000);
    const current = f.requests[1].conn;
    current.openNow();
    stale.openNow();
    stale.emit('close');
    stale.emit('error', new Error('late failure'));
    assert.equal(stale.open, false);
    assert.equal(stale.sent.length, 0, 'obsolete transports never enter admission handling');
    assert.equal(f.network.hostConn, current);
    assert.equal(f.network.connections.get('host-peer'), current);
    assert.equal(f.states.filter(([state]) => state === 'connected').length, 1);
    f.advance(20_000);
    assert.equal(f.requests.length, 2);
});

test('manual disconnect cancels a pending attempt, its deadline and any late open', t => {
    const f = fixture(t);
    const stale = f.start();
    f.network.disconnect();
    assert.equal(stale.closeCalls, 1);
    assert.equal(f.peer.listenerCount('error'), 1);
    stale.openNow();
    f.advance(60_000);
    assert.equal(stale.open, false);
    assert.equal(f.network.hostConn, null);
    assert.equal(f.network.connections.size, 0);
    assert.equal(f.network.connected, false);
    assert.equal(f.requests.length, 1);
    assert.equal(f.migrations, 0);
});

test('manual disconnect cancels backoff before it opens another transport', t => {
    const f = fixture(t);
    f.start().emit('error', new Error('failed'));
    f.network.disconnect();
    f.advance(60_000);
    assert.equal(f.requests.length, 1);
    assert.equal(f.migrations, 0);
});

test('host migration cancels pending reconnect work before selecting its new host', t => {
    const f = fixture(t);
    const stale = f.start();
    f.network._beginHostMigration();
    assert.equal(stale.closed, true);
    assert.equal(f.peer.listenerCount('error'), 1);
    const migrated = connection('new-host');
    f.network.hostRoomCode = migrated.peer;
    f.network.hostConn = migrated;
    f.network.connections.set(migrated.peer, migrated);
    stale.openNow();
    f.advance(60_000);
    assert.equal(f.network.hostConn, migrated);
    assert.equal(f.requests.length, 1);
    assert.equal(f.migrations, 1);
});

for (const failure of ['throw', 'undefined', 'synchronous-peer-error']) {
    test(`connect ${failure} cleans up and schedules the next retry`, t => {
        const f = fixture(t);
        const createConnection = f.peer.connect;
        f.peer.connect = (...args) => {
            if (failure === 'throw') throw new Error('disconnected broker');
            if (failure === 'undefined') return undefined;
            const conn = createConnection(...args);
            f.peer.emit('error', unavailable('host-peer'));
            return conn;
        };
        f.network._scheduleReconnect();
        assert.doesNotThrow(() => f.advance(500));
        assert.equal(f.peer.listenerCount('error'), 1);
        assert.deepEqual(f.states, [['reconnecting', 1], ['reconnecting', 2]]);
        if (failure === 'synchronous-peer-error') assert.equal(f.requests[0].conn.closed, true);
        f.peer.connect = createConnection;
        f.advance(1000);
        f.requests.at(-1).conn.openNow();
        assert.deepEqual(f.states.at(-1), ['connected', 0]);
    });
}
