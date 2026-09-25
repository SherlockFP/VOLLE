// ws.js — minimal, zero-dependency RFC 6455 WebSocket server side: the upgrade
// handshake plus framing for text / binary / ping / pong / close, with
// fragmentation, a hard message-size cap and a keep-alive ping. Only what the
// lobby relay (server/lobby-relay.js) needs — no extensions, no compression.
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODES = Object.freeze({ CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA });
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const DEFAULT_PING_INTERVAL_MS = 25000;

function acceptKey(key) {
    return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

// Encodes one unmasked (server -> client) frame. Exported for tests.
function encodeFrame(opcode, payload = Buffer.alloc(0), { fin = true, mask = false } = {}) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const length = data.length;
    let headerLength = 2;
    if (length >= 126 && length <= 0xffff) headerLength += 2;
    else if (length > 0xffff) headerLength += 8;
    if (mask) headerLength += 4;
    const frame = Buffer.alloc(headerLength + length);
    frame[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
    let offset = 2;
    if (length < 126) {
        frame[1] = length;
    } else if (length <= 0xffff) {
        frame[1] = 126;
        frame.writeUInt16BE(length, 2);
        offset = 4;
    } else {
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(length), 2);
        offset = 10;
    }
    if (mask) {
        frame[1] |= 0x80;
        const key = crypto.randomBytes(4);
        key.copy(frame, offset);
        offset += 4;
        for (let i = 0; i < length; i++) frame[offset + i] = data[i] ^ key[i & 3];
    } else {
        data.copy(frame, offset);
    }
    return frame;
}

class WebSocketConnection extends EventEmitter {
    constructor(socket, { maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES, pingIntervalMs = DEFAULT_PING_INTERVAL_MS, requireMask = true } = {}) {
        super();
        this.socket = socket;
        this.maxMessageBytes = maxMessageBytes;
        this.requireMask = requireMask;
        this.readyState = 1; // OPEN
        this._buffer = Buffer.alloc(0);
        this._fragments = null;
        this._fragmentOpcode = 0;
        this._fragmentBytes = 0;
        this._alive = true;
        this._closeSent = false;
        socket.setNoDelay?.(true);
        socket.on('data', chunk => this._onData(chunk));
        socket.on('close', () => this._finish(1006, ''));
        socket.on('error', () => this._finish(1006, ''));
        socket.on('end', () => this._finish(1006, ''));
        if (pingIntervalMs > 0) {
            this._pingTimer = setInterval(() => {
                if (!this._alive) { this.terminate(); return; }
                this._alive = false;
                this._write(OPCODES.PING, Buffer.alloc(0));
            }, pingIntervalMs);
            this._pingTimer.unref?.();
        }
    }

    get bufferedAmount() {
        return this.socket.writableLength || 0;
    }

    _write(opcode, payload) {
        if (this.readyState !== 1 && opcode !== OPCODES.CLOSE) return false;
        if (this.socket.destroyed) return false;
        try {
            this.socket.write(encodeFrame(opcode, payload));
            return true;
        } catch {
            return false;
        }
    }

    send(data) {
        if (this.readyState !== 1) return false;
        if (typeof data === 'string') return this._write(OPCODES.TEXT, Buffer.from(data, 'utf8'));
        return this._write(OPCODES.BINARY, Buffer.isBuffer(data) ? data : Buffer.from(data));
    }

    close(code = 1000, reason = '') {
        if (this.readyState !== 1) return;
        this.readyState = 2; // CLOSING
        const reasonBytes = Buffer.from(String(reason).slice(0, 120), 'utf8');
        const payload = Buffer.alloc(2 + reasonBytes.length);
        payload.writeUInt16BE(code, 0);
        reasonBytes.copy(payload, 2);
        this._closeSent = true;
        try { this.socket.write(encodeFrame(OPCODES.CLOSE, payload)); } catch {}
        const timer = setTimeout(() => this.terminate(), 1000);
        timer.unref?.();
        this.socket.end?.();
    }

    terminate() {
        try { this.socket.destroy(); } catch {}
        this._finish(1006, '');
    }

    _finish(code, reason) {
        if (this.readyState === 3) return;
        this.readyState = 3; // CLOSED
        clearInterval(this._pingTimer);
        this._buffer = Buffer.alloc(0);
        this._fragments = null;
        this.emit('close', code, reason);
    }

    _fail(code, reason) {
        this.close(code, reason);
        const timer = setTimeout(() => this.terminate(), 50);
        timer.unref?.();
    }

    _onData(chunk) {
        if (this.readyState === 3) return;
        this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
        while (this._buffer.length >= 2 && this.readyState !== 3) {
            const first = this._buffer[0];
            const second = this._buffer[1];
            const fin = (first & 0x80) !== 0;
            if (first & 0x70) { this._fail(1002, 'reserved bits'); return; }
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            if (this.requireMask && !masked) { this._fail(1002, 'unmasked client frame'); return; }
            let length = second & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (this._buffer.length < 4) return;
                length = this._buffer.readUInt16BE(2);
                offset = 4;
            } else if (length === 127) {
                if (this._buffer.length < 10) return;
                const big = this._buffer.readBigUInt64BE(2);
                if (big > BigInt(this.maxMessageBytes)) { this._fail(1009, 'message too big'); return; }
                length = Number(big);
                offset = 10;
            }
            if (length > this.maxMessageBytes) { this._fail(1009, 'message too big'); return; }
            const control = opcode >= 0x8;
            if (control && (length > 125 || !fin)) { this._fail(1002, 'bad control frame'); return; }
            const maskOffset = offset;
            if (masked) offset += 4;
            if (this._buffer.length < offset + length) return;
            let payload = this._buffer.subarray(offset, offset + length);
            if (masked) {
                const key = this._buffer.subarray(maskOffset, maskOffset + 4);
                const unmasked = Buffer.alloc(length);
                for (let i = 0; i < length; i++) unmasked[i] = payload[i] ^ key[i & 3];
                payload = unmasked;
            } else {
                payload = Buffer.from(payload);
            }
            this._buffer = this._buffer.subarray(offset + length);
            this._alive = true;
            this._handleFrame(fin, opcode, payload);
        }
    }

    _handleFrame(fin, opcode, payload) {
        switch (opcode) {
            case OPCODES.PING:
                this._write(OPCODES.PONG, payload);
                return;
            case OPCODES.PONG:
                return;
            case OPCODES.CLOSE: {
                const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
                if (!this._closeSent) {
                    this._closeSent = true;
                    try { this.socket.write(encodeFrame(OPCODES.CLOSE, payload.subarray(0, 2))); } catch {}
                }
                try { this.socket.end(); } catch {}
                this._finish(code, payload.subarray(2).toString('utf8'));
                return;
            }
            case OPCODES.TEXT:
            case OPCODES.BINARY:
                if (this._fragments) { this._fail(1002, 'expected continuation'); return; }
                if (fin) { this._deliver(opcode, payload); return; }
                this._fragments = [payload];
                this._fragmentOpcode = opcode;
                this._fragmentBytes = payload.length;
                return;
            case OPCODES.CONTINUATION:
                if (!this._fragments) { this._fail(1002, 'unexpected continuation'); return; }
                this._fragmentBytes += payload.length;
                if (this._fragmentBytes > this.maxMessageBytes) { this._fail(1009, 'message too big'); return; }
                this._fragments.push(payload);
                if (fin) {
                    const whole = Buffer.concat(this._fragments);
                    const kind = this._fragmentOpcode;
                    this._fragments = null;
                    this._deliver(kind, whole);
                }
                return;
            default:
                this._fail(1002, 'unknown opcode');
        }
    }

    _deliver(opcode, payload) {
        if (opcode === OPCODES.TEXT) {
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(payload); } catch { this._fail(1007, 'invalid utf-8'); return; }
            this.emit('message', text, false);
        } else {
            this.emit('message', payload, true);
        }
    }
}

// Completes the HTTP/1.1 upgrade. Returns a WebSocketConnection, or null after
// answering 400 when the request is not a valid version-13 WebSocket upgrade.
function acceptUpgrade(req, socket, head, options = {}) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const version = String(req.headers['sec-websocket-version'] || '');
    if (req.method !== 'GET' || upgrade !== 'websocket' || version !== '13'
        || typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16) {
        try { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch {}
        return null;
    }
    const lines = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(key)}`
    ];
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    const connection = new WebSocketConnection(socket, options);
    if (head && head.length) connection._onData(Buffer.from(head));
    return connection;
}

module.exports = { acceptUpgrade, acceptKey, encodeFrame, WebSocketConnection, OPCODES };
