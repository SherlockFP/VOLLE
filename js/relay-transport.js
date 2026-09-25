// relay-transport.js — WebSocket fallback for a lobby host <-> client link when
// WebRTC cannot connect (symmetric / carrier-grade NAT, blocked UDP, no TURN).
// The game's own server (server/lobby-relay.js) forwards opaque messages; each
// RelayConnection looks like a PeerJS DataConnection to js/network.js (peer,
// metadata, open, send, close, on/off 'open' | 'data' | 'close' | 'error',
// dataChannel.bufferedAmount), so identity admission, the lobby admission
// proof and host authority run unchanged over it.
//
// Binary frame: [u8 kind (0 JSON utf-8, 1 raw bytes)][u8 idLength][id][payload]

export const RELAY_KIND_JSON = 0;
export const RELAY_KIND_BYTES = 1;
export const RELAY_PEER_PREFIX = 'relay-';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function isRelayPeerId(value) {
    return typeof value === 'string' && value.startsWith(RELAY_PEER_PREFIX);
}

export function relayUrl(location = globalThis.location) {
    if (!location?.host) return '';
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/relay`;
}

export function encodeRelayPayload(id, data) {
    let kind = RELAY_KIND_JSON;
    let body;
    if (data instanceof ArrayBuffer) {
        kind = RELAY_KIND_BYTES;
        body = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
        kind = RELAY_KIND_BYTES;
        body = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
        body = encoder.encode(JSON.stringify(data ?? null));
    }
    const idBytes = encoder.encode(String(id || ''));
    const frame = new Uint8Array(2 + idBytes.length + body.length);
    frame[0] = kind;
    frame[1] = idBytes.length;
    frame.set(idBytes, 2);
    frame.set(body, 2 + idBytes.length);
    return frame;
}

export function decodeRelayPayload(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 2) return null;
    const kind = bytes[0];
    const idLength = bytes[1];
    if ((kind !== RELAY_KIND_JSON && kind !== RELAY_KIND_BYTES) || bytes.length < 2 + idLength) return null;
    const id = decoder.decode(bytes.subarray(2, 2 + idLength));
    const payload = bytes.subarray(2 + idLength);
    if (kind === RELAY_KIND_BYTES) {
        return { id, data: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) };
    }
    try {
        return { id, data: JSON.parse(decoder.decode(payload)) };
    } catch (_) {
        return null;
    }
}

class Emitter {
    constructor() { this._listeners = new Map(); }
    on(type, handler) {
        if (!this._listeners.has(type)) this._listeners.set(type, new Set());
        this._listeners.get(type).add(handler);
        return this;
    }
    off(type, handler) { this._listeners.get(type)?.delete(handler); return this; }
    removeListener(type, handler) { return this.off(type, handler); }
    once(type, handler) {
        const wrapped = (...args) => { this.off(type, wrapped); handler(...args); };
        return this.on(type, wrapped);
    }
    emit(type, ...args) {
        for (const handler of [...(this._listeners.get(type) || [])]) {
            try { handler(...args); } catch (error) { console.error('[relay] listener failed', error); }
        }
    }
}

export class RelayConnection extends Emitter {
    constructor({ peer, metadata = {}, sendFrame, onClose, bufferedAmount = () => 0 }) {
        super();
        this.peer = peer;
        this.metadata = metadata;
        this.label = 'relay';
        this.reliable = true;
        this.open = false;
        this.closed = false;
        this._relay = true;
        this._sendFrame = sendFrame;
        this._onClose = onClose;
        this._bufferedAmount = bufferedAmount;
    }

    get dataChannel() {
        const amount = this._bufferedAmount;
        return { get bufferedAmount() { return amount(); } };
    }

    send(data) {
        if (!this.open || this.closed) return;
        this._sendFrame(data);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.open = false;
        try { this._onClose?.(); } catch (_) {}
        this.emit('close');
    }

    _markOpen() {
        if (this.closed || this.open) return;
        this.open = true;
        this.emit('open');
    }

    _receive(data) {
        if (!this.closed) this.emit('data', data);
    }

    _remoteClosed() {
        if (this.closed) return;
        this.closed = true;
        this.open = false;
        this.emit('close');
    }
}

function errorWithCode(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Host side: one socket carries every relayed client of the lobby. Emits
// 'connection' (RelayConnection) like a PeerJS Peer, and 'closed' when the
// socket drops (the caller re-attaches).
export class RelayHostLink extends Emitter {
    constructor({ url = relayUrl(), code, token, admissionToken, WebSocketImpl = globalThis.WebSocket } = {}) {
        super();
        this.url = url;
        this.code = code;
        this.token = token;
        this.admissionToken = admissionToken;
        this.WebSocketImpl = WebSocketImpl;
        this.connections = new Map();
        this.ws = null;
        this.ready = false;
        this.closed = false;
    }

    connect(timeoutMs = 8000) {
        if (typeof this.WebSocketImpl !== 'function' || !this.url) {
            return Promise.reject(errorWithCode('WebSocket relay unavailable', 'relay_unavailable'));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(this);
            };
            const timer = setTimeout(() => {
                settle(errorWithCode('Relay did not answer', 'relay_timeout'));
                this.close();
            }, timeoutMs);
            let ws;
            try {
                ws = new this.WebSocketImpl(this.url);
            } catch (error) {
                settle(errorWithCode(error?.message || 'Relay connect failed', 'relay_unavailable'));
                return;
            }
            ws.binaryType = 'arraybuffer';
            this.ws = ws;
            ws.onopen = () => {
                ws.send(JSON.stringify({ t: 'hello', role: 'host', code: this.code, token: this.token, admissionToken: this.admissionToken }));
            };
            ws.onmessage = event => {
                if (typeof event.data === 'string') {
                    let message;
                    try { message = JSON.parse(event.data); } catch (_) { return; }
                    if (message?.t === 'ready') {
                        this.ready = true;
                        settle(null);
                    } else if (message?.t === 'error') {
                        settle(errorWithCode(`Relay refused: ${message.reason}`, message.reason || 'relay_error'));
                    } else if (message?.t === 'open' && isRelayPeerId(message.id)) {
                        this._openConnection(message.id, message.meta || {});
                    } else if (message?.t === 'close' && this.connections.has(message.id)) {
                        const conn = this.connections.get(message.id);
                        this.connections.delete(message.id);
                        conn._remoteClosed();
                    }
                    return;
                }
                const frame = decodeRelayPayload(event.data);
                if (!frame) return;
                this.connections.get(frame.id)?._receive(frame.data);
            };
            ws.onclose = () => {
                settle(errorWithCode('Relay connection closed', 'relay_closed'));
                this._dropAll();
                this.ready = false;
                if (!this.closed) this.emit('closed');
            };
            ws.onerror = () => {};
        });
    }

    _openConnection(id, meta) {
        const conn = new RelayConnection({
            peer: id,
            metadata: { ...meta },
            sendFrame: data => {
                if (this.ws?.readyState === 1) this.ws.send(encodeRelayPayload(id, data));
            },
            onClose: () => {
                if (this.connections.get(id) === conn) this.connections.delete(id);
                if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'close', id }));
            },
            bufferedAmount: () => this.ws?.bufferedAmount || 0
        });
        this.connections.set(id, conn);
        this.emit('connection', conn);
        // PeerJS fires 'open' asynchronously after 'connection'; mirror that.
        setTimeout(() => conn._markOpen(), 0);
    }

    _dropAll() {
        const conns = [...this.connections.values()];
        this.connections.clear();
        conns.forEach(conn => conn._remoteClosed());
    }

    close() {
        this.closed = true;
        this._dropAll();
        try { this.ws?.close(); } catch (_) {}
        this.ws = null;
        this.ready = false;
    }
}

// Client side: resolves with an OPEN RelayConnection to the lobby host.
export function connectRelayClient({ url = relayUrl(), code, token, metadata = {}, WebSocketImpl = globalThis.WebSocket, timeoutMs = 8000 } = {}) {
    if (typeof WebSocketImpl !== 'function' || !url) {
        return Promise.reject(errorWithCode('WebSocket relay unavailable', 'relay_unavailable'));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        let conn = null;
        let ws;
        const settle = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) {
                try { ws?.close(); } catch (_) {}
                reject(error);
            } else {
                resolve(conn);
            }
        };
        const timer = setTimeout(() => settle(errorWithCode('Relay did not answer', 'relay_timeout')), timeoutMs);
        try {
            ws = new WebSocketImpl(url);
        } catch (error) {
            settle(errorWithCode(error?.message || 'Relay connect failed', 'relay_unavailable'));
            return;
        }
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            ws.send(JSON.stringify({ t: 'hello', role: 'client', code, token, meta: metadata }));
        };
        ws.onmessage = event => {
            if (typeof event.data === 'string') {
                let message;
                try { message = JSON.parse(event.data); } catch (_) { return; }
                if (message?.t === 'ready' && !conn) {
                    conn = new RelayConnection({
                        peer: code,
                        metadata: { ...metadata },
                        sendFrame: data => {
                            if (ws.readyState === 1) ws.send(encodeRelayPayload('', data));
                        },
                        onClose: () => {
                            try { ws.send(JSON.stringify({ t: 'bye' })); } catch (_) {}
                            try { ws.close(); } catch (_) {}
                        },
                        bufferedAmount: () => ws.bufferedAmount || 0
                    });
                    conn.relayId = message.id;
                    conn._markOpen();
                    settle(null);
                } else if (message?.t === 'error') {
                    settle(errorWithCode(`Relay refused: ${message.reason}`, message.reason || 'relay_error'));
                } else if (message?.t === 'closed') {
                    conn?._remoteClosed();
                }
                return;
            }
            const frame = decodeRelayPayload(event.data);
            if (frame && conn) conn._receive(frame.data);
        };
        ws.onclose = () => {
            settle(errorWithCode('Relay connection closed', 'relay_closed'));
            conn?._remoteClosed();
        };
        ws.onerror = () => {};
    });
}
