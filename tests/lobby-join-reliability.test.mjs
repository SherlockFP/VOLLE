// Joining a friend's lobby across countries / NATs (owner report: "my friend
// can't get into my lobby, it says something about admission proof").
// Reproduces each root cause and pins the fix:
//  1. a failed/dropped join left a ghost transport bound on the host, so every
//     retry was kicked as duplicate_identity -> "admission proof was not received";
//  2. the proof wait was a flat 5 s with no retry, so one late/lost packet on a
//     relayed / lossy intercontinental link failed a legitimate join;
//  3. WebRTC with STUN only has no path through symmetric / CGNAT: joins now
//     fall back to the server WebSocket relay, end-to-end identity + proof intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import {
    Network,
    LOBBY_PROOF_REQUEST_MS,
    LOBBY_PROOF_WAIT_MS,
    P2P_JOIN_FALLBACK_MS
} from '../js/network.js';

const require = createRequire(import.meta.url);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-join-reliability-'));
process.env.DATA_DIR = dataDir;
const { server, lobbyRelay } = require('../server.js');

const TOKEN = 'T'.repeat(43);
let baseUrl;
let relayUrl;

function gameStub(name = 'Host') {
    return {
        playerName: name,
        player: { team: 'red' },
        remotePlayers: new Map(),
        state: 'LOBBY',
        mode: { id: 'classic' },
        arena: { mapId: 'beach_open' },
        scoreboard: {},
        getPlayerList: () => [],
        getSpectatorList: () => [],
        snapshotState: () => ({}),
        updateRemotePlayer() {}
    };
}

function fakeConn(peer, metadata = {}) {
    const conn = new EventEmitter();
    Object.assign(conn, { peer, metadata, open: true, sent: [], closed: false });
    conn.send = data => conn.sent.push(data);
    conn.close = () => {
        if (conn.closed) return;
        conn.closed = true;
        conn.open = false;
        conn.emit('close');
    };
    return conn;
}

async function api(pathname, { token = '', method = 'GET', body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

function waitFor(predicate, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            const value = predicate();
            if (value) { resolve(value); return; }
            if (Date.now() - started > timeoutMs) { reject(new Error('timed out')); return; }
            setTimeout(tick, 10);
        };
        tick();
    });
}

test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    relayUrl = `ws://127.0.0.1:${server.address().port}/api/relay`;
});

test.after(async () => {
    lobbyRelay?.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('proof wait survives a lost proof and a 7 s late one (old flat 5 s wait failed it)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    // Host side: an admitted transport whose first proof packet is lost.
    const host = new Network(gameStub());
    host.isHost = true;
    const hostSide = fakeConn('client-peer');
    hostSide._admitted = true;
    host.connections.set('client-peer', hostSide);
    host.playerConnections.set('client-player', hostSide);
    host.setLobbyAdmissionToken(TOKEN);
    assert.equal(hostSide.sent.length, 1, 'proof sent once...');
    hostSide.sent.length = 0; // ...and lost on the wire

    const client = new Network(gameStub('Client'));
    const clientSide = fakeConn('host-peer');
    client.hostConn = clientSide;
    client.connections.set('host-peer', clientSide);
    let proof = null;
    client.waitForLobbyAdmissionProof().then(value => { proof = value; });

    t.mock.timers.tick(LOBBY_PROOF_REQUEST_MS);
    assert.deepEqual(clientSide.sent, [{ type: 'lobbyAdmissionRequest' }], 'client re-asks the host');
    host.handleMessage(clientSide.sent[0], 'client-peer');
    assert.deepEqual(hostSide.sent, [{ type: 'lobbyAdmissionProof', admissionToken: TOKEN }], 'host re-sends to the admitted transport');

    // The re-sent proof arrives 7 s after the join started (high-latency relay).
    t.mock.timers.tick(7000 - LOBBY_PROOF_REQUEST_MS);
    await Promise.resolve();
    assert.equal(proof, null, 'still waiting past the old 5 s cut-off');
    client.handleMessage(hostSide.sent[0], 'host-peer');
    await Promise.resolve();
    assert.equal(proof, TOKEN);
    assert.ok(LOBBY_PROOF_WAIT_MS >= 15000);
});

test('host never answers proof requests from unadmitted transports, and rate-limits them', () => {
    const host = new Network(gameStub());
    host.isHost = true;
    host.setLobbyAdmissionToken(TOKEN);
    const stranger = fakeConn('stranger');
    host.connections.set('stranger', stranger);
    host.handleMessage({ type: 'lobbyAdmissionRequest' }, 'stranger');
    assert.deepEqual(stranger.sent, []);

    const admitted = fakeConn('friend');
    admitted._admitted = true;
    host.connections.set('friend', admitted);
    for (let i = 0; i < 10; i++) host.handleMessage({ type: 'lobbyAdmissionRequest' }, 'friend');
    assert.ok(admitted.sent.length >= 1 && admitted.sent.length <= 4, `rate-limited (${admitted.sent.length})`);
});

test('a kick while waiting fails fast with the real reason (e.g. wrong password)', async () => {
    const client = new Network(gameStub('Client'));
    client.playerName = 'Client';
    const clientSide = fakeConn('host-peer');
    client.hostConn = clientSide;
    client.connections.set('host-peer', clientSide);
    const started = Date.now();
    const pending = client.waitForLobbyAdmissionProof(10000);
    client.handleMessage({ type: 'kick', name: 'Client', reason: 'password' }, 'host-peer');
    assert.equal(await pending, '');
    assert.equal(client.lobbyAdmissionFailure, 'kicked:password');
    assert.ok(Date.now() - started < 1000);
});

test('wrong lobby password is reported as a kick reason, not a silent close', async () => {
    const host = new Network(gameStub());
    host.isHost = true;
    host.lobbyPassword = 'secret';
    const conn = fakeConn('peer-a', { name: 'A', playerId: 'player-a', password: 'nope' });
    host._onIncomingConnection(conn);
    conn.emit('open');
    const challenge = conn.sent.at(-1);
    conn.emit('data', {
        type: 'resumeResponse', nonce: challenge.nonce, playerId: 'player-a', name: 'A',
        password: 'nope', avatar: '', resumeToken: 'resume-a', capabilities: { positionV2: true, migrationVotes: true }
    });
    assert.deepEqual(conn.sent.at(-1), { type: 'kick', name: 'A', reason: 'password' });
});

test('join: failed WebRTC negotiation falls back to the relay; unknown lobby stays "not found"', async () => {
    const client = new Network(gameStub('Client'));
    client.initPeer = async function () {
        this.peer = new EventEmitter();
        this.peer.id = 'client-peer-id';
        this.peer.destroy = () => {};
        this.peer.connect = () => {
            const conn = fakeConn('room-1');
            conn.open = false;
            queueMicrotask(() => conn.emit('error', new Error('Negotiation of connection to room-1 failed.')));
            return conn;
        };
    };
    globalThis.WebSocket ||= class {};
    client.relayAuthProvider = async () => 'session-token';
    const relayConn = fakeConn('room-1');
    relayConn._relay = true;
    const relayCalls = [];
    client._connectHostRelay = async (code, metadata) => { relayCalls.push({ code, metadata }); return relayConn; };
    const progress = [];
    client.onJoinProgress = stage => progress.push(stage);
    await client.joinGame('room-1', 'Client');
    assert.equal(client.hostConn, relayConn);
    assert.equal(client.isRelayed(), true);
    assert.equal(relayCalls[0].metadata.playerId, client.playerId);
    assert.equal('resumeToken' in relayCalls[0].metadata, false, 'resume token only ever travels inside the challenge');
    assert.deepEqual(progress, ['connecting', 'relay', 'admitting']);
    client.disconnect();

    const lost = new Network(gameStub('Client'));
    lost.initPeer = client.initPeer;
    lost.relayAuthProvider = async () => 'session-token';
    lost._connectHostRelay = async () => { const error = new Error('Relay refused: no_host'); error.code = 'no_host'; throw error; };
    await assert.rejects(lost.joinGame('room-1', 'Client'), { code: 'lobby_not_found' });
});

test('join: a WebRTC path that never opens gives up after P2P_JOIN_FALLBACK_MS and uses the relay', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const client = new Network(gameStub('Client'));
    let p2pConn = null;
    client.initPeer = async function () {
        this.peer = new EventEmitter();
        this.peer.id = 'client-peer-id';
        this.peer.destroy = () => {};
        this.peer.connect = () => {
            p2pConn = fakeConn('room-2');
            p2pConn.open = false;
            return p2pConn; // ICE never completes (symmetric NAT, no TURN)
        };
    };
    globalThis.WebSocket ||= class {};
    client.relayAuthProvider = async () => 'session-token';
    const relayConn = fakeConn('room-2');
    relayConn._relay = true;
    client._connectHostRelay = async () => relayConn;
    let joined = false;
    client.joinGame('room-2', 'Client').then(() => { joined = true; });
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(P2P_JOIN_FALLBACK_MS - 1);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(joined, false);
    t.mock.timers.tick(1);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(joined, true);
    assert.equal(p2pConn.closed, true, 'the dead WebRTC attempt is closed');
    assert.equal(client.hostConn, relayConn);
});

test('relay end to end: identity handshake, admission proof and server /join over the WebSocket relay', async () => {
    const register = async username => (await api('/api/account/register', {
        method: 'POST', body: { username, email: `${username.toLowerCase()}@example.com`, password: 'hunter22x' }
    })).body;
    const hostAccount = await register('E2EHost');
    const guest = (await api('/api/lobbies/guest-session', { method: 'POST', body: { name: 'Guest5555' } })).body;
    const code = 'e2e-relay-room';
    const hosted = await api('/api/lobbies', { token: hostAccount.sessionToken, method: 'POST', body: { code, name: 'E2E', players: 1 } });
    assert.equal(hosted.status, 200);

    const joins = [];
    const host = new Network(gameStub('E2EHost'));
    host.isHost = true;
    host.roomCode = code;
    host.hostRoomCode = code;
    host.relayUrl = relayUrl;
    host.onPlayerJoin = (...args) => joins.push(args);
    host.setLobbyAdmissionToken(hosted.body.admissionToken);
    assert.equal(host.enableRelayHost({ code, token: hostAccount.sessionToken, admissionToken: hosted.body.admissionToken }), true);
    await waitFor(() => host._relayHost?.ready);

    // A guest friend whose WebRTC failed joins through the relay.
    const client = new Network(gameStub('Guest5555'));
    client.playerName = 'Guest5555';
    client.hostRoomCode = code;
    client.relayUrl = relayUrl;
    client.relayAuthProvider = async () => guest.guestToken;
    const conn = await client._connectHostRelay(code, client._hostJoinMetadata('Guest5555', ''));
    client._attachHostConnection(code, conn);
    const proof = await client.waitForLobbyAdmissionProof(5000);
    assert.equal(proof, hosted.body.admissionToken);
    const hostConn = host.playerConnections.get(client.playerId);
    assert.equal(hostConn?._relay, true);
    assert.match(hostConn.peer, /^relay-/);
    assert.equal(joins.length, 1);
    assert.equal(host.migrationRoster.has(client.playerId), false, 'relay peers are not WebRTC migration candidates');

    const joined = await api(`/api/lobbies/${code}/join`, { token: guest.guestToken, method: 'POST', body: { admissionToken: proof } });
    assert.equal(joined.status, 200);

    // Reclaim: the same tab reconnects (dropped relay socket) and replaces its
    // stale transport instead of being kicked as a duplicate.
    const again = await client._connectHostRelay(code, client._hostJoinMetadata('Guest5555', ''));
    client._resetLobbyAdmissionProof();
    client.connections.delete(code);
    client._attachHostConnection(code, again);
    assert.equal(await client.waitForLobbyAdmissionProof(5000), hosted.body.admissionToken);
    await waitFor(() => host.playerConnections.get(client.playerId) !== hostConn);
    assert.equal(host.playerConnections.get(client.playerId)?._relay, true);
    assert.equal(client._lastKickReason, '');

    client.disconnect();
    host.disconnect();
});

test('host forwards movement between relay clients and everyone else; no mesh to relay peers', async () => {
    const updates = [];
    const game = gameStub();
    game.updateRemotePlayer = (playerId, data, peerId) => updates.push({ playerId, peerId });
    const host = new Network(game);
    host.isHost = true;
    const relayClient = fakeConn('relay-0123456789abcdef');
    relayClient._relay = true;
    relayClient._admitted = true;
    const p2pClient = fakeConn('p2p-peer');
    p2pClient._admitted = true;
    host.connections.set(relayClient.peer, relayClient);
    host.connections.set(p2pClient.peer, p2pClient);
    host.peerToPlayerId.set(relayClient.peer, 'relay-player');
    host.peerToPlayerId.set(p2pClient.peer, 'p2p-player');

    host._applyPositionPacket({ type: 'position', x: 1, y: 2, z: 3, seq: 1 }, 'p2p-peer');
    assert.deepEqual(relayClient.sent.map(p => [p.type, p.playerId, p.peerId, p.x]), [['position', 'p2p-player', 'p2p-peer', 1]]);
    assert.equal(p2pClient.sent.length, 0, 'P2P clients already mesh with each other');
    host._applyPositionPacket({ type: 'position', x: 4, y: 5, z: 6, seq: 1 }, relayClient.peer);
    assert.deepEqual(p2pClient.sent.map(p => [p.playerId, p.peerId, p.x]), [['relay-player', relayClient.peer, 4]]);

    const client = new Network(gameStub('Client'));
    client.peer = { id: 'me', connect: () => { throw new Error('must not mesh to a relay peer'); } };
    assert.equal(await client.connectToPeer('relay-0123456789abcdef', 'relay-player'), undefined);
});

test('client never spawns a phantom "P-xxxx" player for the host\'s id-less packets', () => {
    const updates = [];
    const game = gameStub('Client');
    game.updateRemotePlayer = (playerId) => updates.push(playerId);
    const client = new Network(game);
    client.hostConn = fakeConn('host-room');
    client.allowedMeshPeers.set('host-room', 'host-player'); // from the welcome roster
    client._applyPositionPacket({ type: 'position', x: 0, y: 0, z: 0, seq: 3 }, 'host-room');
    assert.deepEqual(updates, ['host-player']);
});
