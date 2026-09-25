// Online lobby connectivity: the zero-dependency RFC 6455 server (server/ws.js),
// the WebSocket lobby relay (server/lobby-relay.js + js/relay-transport.js),
// anonymous guest lobby sessions (server/lobby-guest.js) and /api/ice-servers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
    RelayHostLink,
    connectRelayClient,
    encodeRelayPayload,
    decodeRelayPayload
} from '../js/relay-transport.js';

const require = createRequire(import.meta.url);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-relay-guest-'));
process.env.DATA_DIR = dataDir;
const { acceptKey, encodeFrame } = require('../server/ws.js');
const { TokenBucket } = require('../server/lobby-relay.js');
const { LobbyGuestSessions } = require('../server/lobby-guest.js');
const { server, lobbies, lobbyRelay } = require('../server.js');

let baseUrl;
let relayUrl;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(pathname, { token = '', method = 'GET', body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function register(username) {
    const result = await api('/api/account/register', {
        method: 'POST',
        body: { username, email: `${username.toLowerCase()}@example.com`, password: 'hunter22x' }
    });
    assert.ok(result.status === 200 || result.status === 201, JSON.stringify(result.body).slice(0, 200));
    return result.body;
}

async function guest(name = 'Guest1234') {
    const result = await api('/api/lobbies/guest-session', { method: 'POST', body: { name } });
    assert.equal(result.status, 200);
    return result.body;
}

function waitFor(predicate, timeoutMs = 3000) {
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

// ---------------------------------------------------------------- server/ws.js

test('ws: RFC 6455 accept key and frame encoding', () => {
    assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    assert.deepEqual([...encodeFrame(0x1, Buffer.from('Hi'))], [0x81, 2, 0x48, 0x69]);
    const medium = encodeFrame(0x2, Buffer.alloc(300));
    assert.equal(medium[1], 126);
    assert.equal(medium.readUInt16BE(2), 300);
    const large = encodeFrame(0x2, Buffer.alloc(70000));
    assert.equal(large[1], 127);
    assert.equal(Number(large.readBigUInt64BE(2)), 70000);
});

test('ws: raw client handshake, masked + fragmented text, ping/pong, unmasked frame rejected', async () => {
    const port = server.address().port;
    const socket = net.connect(port, '127.0.0.1');
    await new Promise(resolve => socket.once('connect', resolve));
    const key = crypto.randomBytes(16).toString('base64');
    socket.write([
        'GET /api/relay HTTP/1.1', `Host: 127.0.0.1:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''
    ].join('\r\n'));
    let received = Buffer.alloc(0);
    socket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
    await waitFor(() => received.includes('\r\n\r\n'));
    const head = received.toString('latin1');
    assert.match(head, /^HTTP\/1\.1 101/);
    assert.match(head, new RegExp(`Sec-WebSocket-Accept: ${acceptKey(key).replace(/[+/=]/g, c => `\\${c}`)}`));
    received = received.subarray(received.indexOf('\r\n\r\n') + 4);
    // A masked ping must be answered with a pong carrying the same payload.
    socket.write(encodeFrame(0x9, Buffer.from('ok'), { mask: true }));
    await waitFor(() => received.length >= 4);
    assert.equal(received[0], 0x8A);
    assert.equal(received.subarray(2, 4).toString(), 'ok');
    received = Buffer.alloc(0);
    // A fragmented, masked hello (text + continuation) is reassembled: the relay
    // answers the (invalid) hello with an error control message.
    const hello = Buffer.from(JSON.stringify({ t: 'hello', role: 'client', code: 'no-such-lobby', token: 'x' }));
    socket.write(encodeFrame(0x1, hello.subarray(0, 10), { fin: false, mask: true }));
    socket.write(encodeFrame(0x0, hello.subarray(10), { fin: true, mask: true }));
    await waitFor(() => received.length > 2);
    assert.equal(received[0], 0x81);
    const text = received.subarray(2, 2 + received[1]).toString();
    assert.deepEqual(JSON.parse(text), { t: 'error', reason: 'unauthorized' });
    socket.destroy();

    // Unmasked client frames violate RFC 6455 and close the socket.
    const bad = net.connect(port, '127.0.0.1');
    await new Promise(resolve => bad.once('connect', resolve));
    bad.resume(); // consume the handshake so 'end' / 'close' can fire
    bad.write([
        'GET /api/relay HTTP/1.1', 'Host: x', 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13', '', ''
    ].join('\r\n'));
    await sleep(50);
    bad.write(encodeFrame(0x1, Buffer.from('{}')));
    await new Promise(resolve => bad.once('close', resolve));
});

test('ws: non-relay upgrade paths are refused', async () => {
    const port = server.address().port;
    const socket = net.connect(port, '127.0.0.1');
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write('GET /elsewhere HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    const reply = await new Promise(resolve => socket.once('data', chunk => resolve(chunk.toString())));
    assert.match(reply, /^HTTP\/1\.1 404/);
    socket.destroy();
});

// ---------------------------------------------------------------- relay

test('relay frame codec round-trips JSON and bytes', () => {
    const json = decodeRelayPayload(encodeRelayPayload('relay-0123456789abcdef', { type: 'welcome', n: 1 }));
    assert.deepEqual(json, { id: 'relay-0123456789abcdef', data: { type: 'welcome', n: 1 } });
    const bytes = decodeRelayPayload(encodeRelayPayload('', new Uint8Array([7, 8, 9])));
    assert.equal(bytes.id, '');
    assert.deepEqual([...new Uint8Array(bytes.data)], [7, 8, 9]);
    assert.equal(decodeRelayPayload(new Uint8Array([9, 0])), null);
});

test('relay token bucket rejects floods', () => {
    const bucket = new TokenBucket({ messagesPerSecond: 2, burstMessages: 2, bytesPerSecond: 100, burstBytes: 100 }, 0);
    assert.equal(bucket.take(10, 0), true);
    assert.equal(bucket.take(10, 0), true);
    assert.equal(bucket.take(10, 0), false, 'burst exhausted');
    assert.equal(bucket.take(10, 1000), true, 'refills over time');
    assert.equal(bucket.take(500, 5000), false, 'oversized burst');
});

test('relay: only the lobby owner with the admission token hosts; clients need a lobby identity', async () => {
    const host = await register('RelayHostA');
    const other = await register('RelayOther');
    const hosted = await api('/api/lobbies', { token: host.sessionToken, method: 'POST', body: { code: 'relay-room-a', name: 'R', players: 1 } });
    assert.equal(hosted.status, 200);

    // No host attached yet.
    await assert.rejects(connectRelayClient({ url: relayUrl, code: 'relay-room-a', token: other.sessionToken }), { code: 'no_host' });
    // Wrong admission token / wrong owner.
    await assert.rejects(new RelayHostLink({ url: relayUrl, code: 'relay-room-a', token: host.sessionToken, admissionToken: 'A'.repeat(43) }).connect(), { code: 'not_owner' });
    await assert.rejects(new RelayHostLink({ url: relayUrl, code: 'relay-room-a', token: other.sessionToken, admissionToken: hosted.body.admissionToken }).connect(), { code: 'not_owner' });

    const link = new RelayHostLink({ url: relayUrl, code: 'relay-room-a', token: host.sessionToken, admissionToken: hosted.body.admissionToken });
    await link.connect();
    await assert.rejects(connectRelayClient({ url: relayUrl, code: 'relay-room-a', token: 'garbage' }), { code: 'unauthorized' });
    await assert.rejects(connectRelayClient({ url: relayUrl, code: 'missing-room', token: other.sessionToken }), { code: 'lobby_unavailable' });
    link.close();
});

test('relay: host <-> client JSON and binary round trip, close propagation, lobby close drops the room', async () => {
    const host = await register('RelayHostB');
    const player = await register('RelayPlayerB');
    const hosted = await api('/api/lobbies', { token: host.sessionToken, method: 'POST', body: { code: 'relay-room-b', name: 'R', players: 1 } });
    const link = new RelayHostLink({ url: relayUrl, code: 'relay-room-b', token: host.sessionToken, admissionToken: hosted.body.admissionToken });
    const hostConns = [];
    link.on('connection', conn => hostConns.push(conn));
    await link.connect();

    const client = await connectRelayClient({
        url: relayUrl, code: 'relay-room-b', token: player.sessionToken,
        metadata: { name: 'P', playerId: 'player-b', password: 'pw', capabilities: { positionV2: true, netV3: true, evil: 1 }, resumeToken: 'must-not-pass' }
    });
    assert.equal(client.open, true);
    assert.equal(client.peer, 'relay-room-b', 'the client addresses the host by room code, like PeerJS');
    const hostConn = await waitFor(() => hostConns[0]);
    await waitFor(() => hostConn.open);
    assert.match(hostConn.peer, /^relay-[a-f0-9]{16}$/);
    assert.deepEqual(hostConn.metadata, {
        name: 'P', playerId: 'player-b', password: 'pw', capabilities: { positionV2: true, migrationVotes: false, netV3: true }
    }, 'metadata is sanitized server-side (no resume token, no unknown keys)');

    const hostGot = [];
    const clientGot = [];
    hostConn.on('data', data => hostGot.push(data));
    client.on('data', data => clientGot.push(data));
    client.send({ type: 'resumeResponse', nonce: 'n' });
    client.send(new Uint8Array([1, 2, 3]));
    hostConn.send({ type: 'welcome', admissionToken: hosted.body.admissionToken });
    hostConn.send(new Uint8Array([4, 5]).buffer);
    await waitFor(() => hostGot.length === 2 && clientGot.length === 2);
    assert.deepEqual(hostGot[0], { type: 'resumeResponse', nonce: 'n' });
    assert.deepEqual([...new Uint8Array(hostGot[1])], [1, 2, 3]);
    assert.deepEqual(clientGot[0], { type: 'welcome', admissionToken: hosted.body.admissionToken });
    assert.ok(clientGot[1] instanceof ArrayBuffer);

    // Host kicks -> client transport closes.
    let clientClosed = false;
    client.on('close', () => { clientClosed = true; });
    hostConn.close();
    await waitFor(() => clientClosed);

    // A new client, then the host closes the lobby: the relay room goes with it.
    const second = await connectRelayClient({ url: relayUrl, code: 'relay-room-b', token: player.sessionToken, metadata: { name: 'P', playerId: 'player-b' } });
    let secondClosed = false;
    second.on('close', () => { secondClosed = true; });
    let hostLinkClosed = false;
    link.on('closed', () => { hostLinkClosed = true; });
    const closed = await api('/api/lobbies/relay-room-b', { token: host.sessionToken, method: 'DELETE' });
    assert.equal(closed.status, 200);
    await waitFor(() => secondClosed && hostLinkClosed);
    assert.equal(lobbyRelay.rooms.has('relay-room-b'), false);
});

// ---------------------------------------------------------------- guests

test('guest lobby sessions: signed, expiring, forgery-proof', () => {
    let now = 1_000_000;
    const sessions = new LobbyGuestSessions({ secret: 'x'.repeat(32), ttlMs: 60_000, now: () => now });
    const issued = sessions.issue('Guest4321');
    assert.equal(issued.name, 'Guest4321');
    assert.match(issued.guestId, /^guest:[a-f0-9]{24}$/);
    const auth = sessions.resolve(issued.guestToken);
    assert.equal(auth.guest, true);
    assert.equal(auth.account.username, 'Guest4321');
    assert.equal(auth.profile.id, issued.guestId);
    assert.match(sessions.issue('<script>').name, /^Guest\d{4}$/, 'display names are server-chosen for anything unexpected');
    const [prefix, payload, signature] = issued.guestToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ g: 'a'.repeat(24), n: 'Guest0000', e: now + 1e9 })).toString('base64url');
    assert.equal(sessions.resolve(`${prefix}.${forgedPayload}.${signature}`), null);
    assert.equal(new LobbyGuestSessions({ secret: 'y'.repeat(32) }).resolve(issued.guestToken), null, 'other secret');
    now += 61_000;
    assert.equal(sessions.resolve(issued.guestToken), null, 'expired');
    assert.equal(sessions.resolve(`${prefix}.${payload}`), null);
});

test('guests can host and join casual lobbies with the unchanged admission proof', async () => {
    const hostGuest = await guest('Guest1111');
    const joinGuest = await guest('Guest2222');
    const account = await register('MixedPlayer');

    const hosted = await api('/api/lobbies', { token: hostGuest.guestToken, method: 'POST', body: { code: 'guest-room', name: 'G', players: 1, hostName: 'spoof' } });
    assert.equal(hosted.status, 200);
    assert.match(hosted.body.admissionToken, /^[A-Za-z0-9_-]{32,64}$/);
    const listed = (await api('/api/lobbies')).body.find(lobby => lobby.code === 'guest-room');
    assert.equal(listed.hostName, 'Guest1111', 'host name comes from the session, not the body');
    for (const hidden of ['guestMemberIds', 'memberProfileIds', 'admissionToken', 'ownerAccountId']) {
        assert.equal(hidden in listed, false, `${hidden} stays private`);
    }

    // Proof rules unchanged: no / wrong proof -> 403, right proof -> 200.
    assert.equal((await api('/api/lobbies/guest-room/join', { token: joinGuest.guestToken, method: 'POST', body: {} })).status, 403);
    assert.equal((await api('/api/lobbies/guest-room/join', { token: joinGuest.guestToken, method: 'POST', body: { admissionToken: 'z'.repeat(43) } })).status, 403);
    assert.equal((await api('/api/lobbies/guest-room/join', { token: 'lg1.bogus.token', method: 'POST', body: { admissionToken: hosted.body.admissionToken } })).status, 401);
    const joined = await api('/api/lobbies/guest-room/join', { token: joinGuest.guestToken, method: 'POST', body: { admissionToken: hosted.body.admissionToken } });
    assert.equal(joined.status, 200);
    const accountJoin = await api('/api/lobbies/guest-room/join', { token: account.sessionToken, method: 'POST', body: { admissionToken: hosted.body.admissionToken } });
    assert.equal(accountJoin.status, 200);

    const record = lobbies.get('guest-room');
    assert.equal(record.guestMemberIds.has(joinGuest.guestId), true);
    assert.equal(record.memberProfileIds.has(joinGuest.guestId), false, 'guests are never reward-eligible match members');
    assert.equal(record.memberProfileIds.has(account.profile.id), true);

    // Only the guest who owns it may close it; guests leave like anyone else.
    assert.equal((await api('/api/lobbies/guest-room/leave', { token: joinGuest.guestToken, method: 'POST', body: {} })).status, 200);
    assert.equal(lobbies.get('guest-room').guestMemberIds.has(joinGuest.guestId), false);
    assert.equal((await api('/api/lobbies/guest-room', { token: joinGuest.guestToken, method: 'DELETE' })).status, 404);
    assert.equal((await api('/api/lobbies/guest-room', { token: hostGuest.guestToken, method: 'DELETE' })).status, 200);
});

test('guests stay out of ranked, accounts, economy and rewards', async () => {
    const g = await guest('Guest3333');
    const rankedHost = await api('/api/lobbies', { token: g.guestToken, method: 'POST', body: { code: 'guest-ranked', ranked: true } });
    assert.equal(rankedHost.status, 403);
    assert.equal(rankedHost.body.code, 'account_required');

    const owner = await register('RankedOwner');
    const ranked = await api('/api/lobbies', { token: owner.sessionToken, method: 'POST', body: { code: 'ranked-room', ranked: true } });
    const rankedJoin = await api('/api/lobbies/ranked-room/join', { token: g.guestToken, method: 'POST', body: { admissionToken: ranked.body.admissionToken } });
    assert.equal(rankedJoin.status, 403);
    assert.equal(rankedJoin.body.code, 'account_required');
    await assert.rejects(connectRelayClient({ url: relayUrl, code: 'ranked-room', token: g.guestToken }), { code: 'account_required' });

    for (const [pathname, method] of [
        ['/api/account/me', 'GET'],
        ['/api/profile/session', 'POST'],
        ['/api/match/start', 'POST'],
        ['/api/party/lobby-target', 'POST']
    ]) {
        const result = await api(pathname, { token: g.guestToken, method, body: method === 'POST' ? {} : undefined });
        assert.ok([401, 403, 404].includes(result.status), `${pathname} must not accept a guest lobby token (got ${result.status})`);
        assert.notEqual(result.status, 200);
    }
});

// ---------------------------------------------------------------- ICE servers

test('/api/ice-servers serves public STUN defaults, no TURN secrets, and advertises the relay', async () => {
    const result = await api('/api/ice-servers');
    assert.equal(result.status, 200);
    const urls = result.body.iceServers.flatMap(server => server.urls);
    assert.ok(urls.includes('stun:stun.l.google.com:19302'));
    assert.ok(urls.includes('stun:stun.cloudflare.com:3478'));
    assert.equal(result.body.relay, true);
    assert.equal(result.body.turn, false);
    assert.deepEqual(await api('/api/rtc-config').then(r => r.body.iceServers), result.body.iceServers);
});
