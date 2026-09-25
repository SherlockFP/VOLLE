// lobby-relay.js — WebSocket fallback transport for P2P lobbies whose WebRTC
// connection cannot be established (symmetric / carrier-grade NAT, blocked UDP,
// no TURN configured). The server only forwards opaque messages between ONE
// lobby host and that lobby's relay clients; it never interprets game packets,
// so host authority, the resume-token identity handshake and the lobby
// admission proof all run end-to-end exactly as over WebRTC.
//
// Wire format (both directions):
//   text frame   = JSON control message
//   binary frame = [u8 kind (0 JSON utf-8, 1 raw bytes)][u8 idLength][id][payload]
// Client sockets always use an empty id; the host socket names the relay
// connection id (server-assigned "relay-<hex>") of the client it talks to.
//
// Who may use a room:
//   host   = the authenticated owner of the registered lobby, and it must also
//            present the lobby admission token the server issued at registration;
//   client = any authenticated lobby identity (account or guest session) — the
//            same bar as the lobby /join endpoint; the host then runs its normal
//            identity admission over the relay, and only clients the server
//            admitted (/join with the host-delivered proof) count as members.
'use strict';

const crypto = require('crypto');

const HELLO_TIMEOUT_MS = 5000;
const MAX_ROOMS = 1000;
const MAX_CLIENTS_PER_ROOM = 40;
const MAX_SOCKETS_PER_IP = 12;
const SWEEP_INTERVAL_MS = 30000;
const LIMITS = Object.freeze({
    client: { messagesPerSecond: 240, burstMessages: 480, bytesPerSecond: 1024 * 1024, burstBytes: 2 * 1024 * 1024 },
    host: { messagesPerSecond: 3000, burstMessages: 6000, bytesPerSecond: 8 * 1024 * 1024, burstBytes: 16 * 1024 * 1024 }
});
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELAY_ID_PATTERN = /^relay-[a-f0-9]{16}$/;

class TokenBucket {
    constructor({ messagesPerSecond, burstMessages, bytesPerSecond, burstBytes }, now = Date.now()) {
        this.rate = messagesPerSecond;
        this.burst = burstMessages;
        this.byteRate = bytesPerSecond;
        this.byteBurst = burstBytes;
        this.messages = burstMessages;
        this.bytes = burstBytes;
        this.at = now;
    }

    take(size, now = Date.now()) {
        const elapsed = Math.max(0, now - this.at) / 1000;
        this.at = now;
        this.messages = Math.min(this.burst, this.messages + elapsed * this.rate);
        this.bytes = Math.min(this.byteBurst, this.bytes + elapsed * this.byteRate);
        if (this.messages < 1 || this.bytes < size) return false;
        this.messages -= 1;
        this.bytes -= size;
        return true;
    }
}

function encodeRelayFrame(kind, id, payload) {
    const idBytes = Buffer.from(String(id || ''), 'utf8');
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const frame = Buffer.alloc(2 + idBytes.length + body.length);
    frame[0] = kind;
    frame[1] = idBytes.length;
    idBytes.copy(frame, 2);
    body.copy(frame, 2 + idBytes.length);
    return frame;
}

function decodeRelayFrame(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 2) return null;
    const kind = buffer[0];
    const idLength = buffer[1];
    if ((kind !== 0 && kind !== 1) || buffer.length < 2 + idLength) return null;
    return {
        kind,
        id: buffer.subarray(2, 2 + idLength).toString('utf8'),
        payload: buffer.subarray(2 + idLength)
    };
}

function sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    const out = {};
    if (typeof meta.name === 'string') out.name = meta.name.slice(0, 32);
    if (typeof meta.playerId === 'string' && CODE_PATTERN.test(meta.playerId)) out.playerId = meta.playerId;
    if (typeof meta.password === 'string') out.password = meta.password.slice(0, 128);
    if (meta.spectator === true) out.spectator = true;
    if (meta.capabilities && typeof meta.capabilities === 'object' && !Array.isArray(meta.capabilities)) {
        out.capabilities = {
            positionV2: meta.capabilities.positionV2 === true,
            migrationVotes: meta.capabilities.migrationVotes === true,
            ...(meta.capabilities.netV3 === true ? { netV3: true } : {})
        };
    }
    return out;
}

class LobbyRelay {
    constructor({ resolveAuth, getLobby, now = () => Date.now(), log = () => {} } = {}) {
        if (typeof resolveAuth !== 'function' || typeof getLobby !== 'function') throw new Error('LobbyRelay needs resolveAuth and getLobby');
        this.resolveAuth = resolveAuth;
        this.getLobby = getLobby;
        this.now = now;
        this.log = log;
        this.rooms = new Map(); // code -> { host, ownerId, clients: Map<id, ws> }
        this.socketsByIp = new Map();
        this._sweep = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
        this._sweep.unref?.();
    }

    stats() {
        let clients = 0;
        for (const room of this.rooms.values()) clients += room.clients.size;
        return { rooms: this.rooms.size, clients };
    }

    // Drops rooms whose lobby is gone or changed owner (pruned, closed, expired).
    sweep() {
        for (const [code, room] of this.rooms) {
            const lobby = this.getLobby(code);
            if (!lobby || lobby.ownerAccountId !== room.ownerId) this._closeRoom(code, 'lobby_closed');
        }
    }

    close() {
        clearInterval(this._sweep);
        for (const code of [...this.rooms.keys()]) this._closeRoom(code, 'server_shutdown');
    }

    // Takes an accepted WebSocketConnection (server/ws.js) and the peer address.
    handle(ws, ip = 'unknown') {
        const count = this.socketsByIp.get(ip) || 0;
        if (count >= MAX_SOCKETS_PER_IP) {
            this._reject(ws, 'rate');
            return;
        }
        this.socketsByIp.set(ip, count + 1);
        ws.once('close', () => {
            const next = (this.socketsByIp.get(ip) || 1) - 1;
            if (next <= 0) this.socketsByIp.delete(ip);
            else this.socketsByIp.set(ip, next);
        });
        const state = { role: null, code: '', id: '', bucket: null };
        const helloTimer = setTimeout(() => {
            if (!state.role) this._reject(ws, 'hello_timeout');
        }, HELLO_TIMEOUT_MS);
        helloTimer.unref?.();
        ws.on('message', (data, isBinary) => {
            if (!state.role) {
                if (isBinary) { this._reject(ws, 'hello_required'); return; }
                clearTimeout(helloTimer);
                this._hello(ws, state, data);
                return;
            }
            const size = isBinary ? data.length : Buffer.byteLength(data);
            if (!state.bucket.take(size, this.now())) {
                this._reject(ws, 'rate');
                return;
            }
            if (state.role === 'host') this._fromHost(state, data, isBinary);
            else this._fromClient(state, data, isBinary);
        });
        ws.once('close', () => {
            clearTimeout(helloTimer);
            if (state.role === 'host') {
                const room = this.rooms.get(state.code);
                if (room?.host === ws) this._closeRoom(state.code, 'host_left');
            } else if (state.role === 'client') {
                const room = this.rooms.get(state.code);
                if (room?.clients.get(state.id) === ws) {
                    room.clients.delete(state.id);
                    this._sendControl(room.host, { t: 'close', id: state.id });
                }
            }
        });
    }

    _hello(ws, state, text) {
        let hello;
        try { hello = JSON.parse(String(text)); } catch { this._reject(ws, 'bad_hello'); return; }
        const code = String(hello?.code || '');
        if (hello?.t !== 'hello' || !CODE_PATTERN.test(code)) { this._reject(ws, 'bad_hello'); return; }
        const auth = this.resolveAuth(String(hello.token || ''));
        if (!auth) { this._reject(ws, 'unauthorized'); return; }
        const lobby = this.getLobby(code);
        if (!lobby) { this._reject(ws, 'lobby_unavailable'); return; }
        if (hello.role === 'host') {
            const proof = Buffer.from(String(hello.admissionToken || ''));
            const expected = Buffer.from(String(lobby.admissionToken || ''));
            if (lobby.ownerAccountId !== auth.account.id || !expected.length || expected.length !== proof.length
                || !crypto.timingSafeEqual(expected, proof)) {
                this._reject(ws, 'not_owner');
                return;
            }
            let room = this.rooms.get(code);
            if (!room && this.rooms.size >= MAX_ROOMS) { this._reject(ws, 'rate'); return; }
            if (room && room.host && room.host !== ws) {
                // Same owner re-attached (page reload / reconnect): the old host
                // socket and every client bound to it are stale.
                this._closeRoom(code, 'host_replaced');
                room = null;
            }
            room = { host: ws, ownerId: auth.account.id, clients: new Map() };
            this.rooms.set(code, room);
            Object.assign(state, { role: 'host', code, bucket: new TokenBucket(LIMITS.host, this.now()) });
            this._sendControl(ws, { t: 'ready', role: 'host', code });
            return;
        }
        if (hello.role !== 'client') { this._reject(ws, 'bad_hello'); return; }
        if (lobby.ranked === true && auth.guest === true) { this._reject(ws, 'account_required'); return; }
        const room = this.rooms.get(code);
        if (!room?.host || room.host.readyState !== 1) { this._reject(ws, 'no_host'); return; }
        if (room.clients.size >= MAX_CLIENTS_PER_ROOM) { this._reject(ws, 'full'); return; }
        const id = `relay-${crypto.randomBytes(8).toString('hex')}`;
        room.clients.set(id, ws);
        Object.assign(state, { role: 'client', code, id, bucket: new TokenBucket(LIMITS.client, this.now()) });
        this._sendControl(ws, { t: 'ready', role: 'client', id, host: code });
        this._sendControl(room.host, { t: 'open', id, meta: sanitizeMeta(hello.meta) });
    }

    _fromClient(state, data, isBinary) {
        const room = this.rooms.get(state.code);
        if (!room) return;
        if (!isBinary) {
            let message;
            try { message = JSON.parse(String(data)); } catch { return; }
            if (message?.t === 'bye') room.clients.get(state.id)?.close(1000, 'bye');
            return;
        }
        const frame = decodeRelayFrame(data);
        if (!frame || frame.id) return;
        room.host.send(encodeRelayFrame(frame.kind, state.id, frame.payload));
    }

    _fromHost(state, data, isBinary) {
        const room = this.rooms.get(state.code);
        if (!room) return;
        if (!isBinary) {
            let message;
            try { message = JSON.parse(String(data)); } catch { return; }
            if (message?.t === 'close' && RELAY_ID_PATTERN.test(String(message.id || ''))) {
                const client = room.clients.get(message.id);
                if (client) {
                    room.clients.delete(message.id);
                    this._sendControl(client, { t: 'closed', reason: 'host_closed' });
                    client.close(1000, 'host_closed');
                }
            }
            return;
        }
        const frame = decodeRelayFrame(data);
        if (!frame || !RELAY_ID_PATTERN.test(frame.id)) return;
        room.clients.get(frame.id)?.send(encodeRelayFrame(frame.kind, '', frame.payload));
    }

    _closeRoom(code, reason) {
        const room = this.rooms.get(code);
        if (!room) return;
        this.rooms.delete(code);
        for (const client of room.clients.values()) {
            this._sendControl(client, { t: 'closed', reason });
            client.close(1000, reason);
        }
        room.clients.clear();
        if (room.host?.readyState === 1) {
            this._sendControl(room.host, { t: 'closed', reason });
            room.host.close(1000, reason);
        }
    }

    _sendControl(ws, message) {
        if (ws?.readyState === 1) ws.send(JSON.stringify(message));
    }

    _reject(ws, reason) {
        this._sendControl(ws, { t: 'error', reason });
        ws.close(1008, reason);
    }
}

module.exports = { LobbyRelay, TokenBucket, encodeRelayFrame, decodeRelayFrame, sanitizeMeta, LIMITS, MAX_CLIENTS_PER_ROOM };
