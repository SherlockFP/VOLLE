// network.js — P2P via PeerJS for multiplayer
// ponytail: binary message types for hot-path packets (ballState/position) — ~4x smaller than JSON
import {
    HOST_MIGRATION_TIMEOUT_MS,
    HOST_MIGRATION_MAX_ATTEMPTS,
    HOST_MIGRATION_MAX_ROSTER,
    hasElectionAgreement,
    migrationAttemptId,
    migrationBackoffMs,
    migrationRosterDigest,
    nextMigrationEpoch,
    normalizeHostCheckpoint,
    selectHostCandidate,
    validateHostMigrationProposal
} from './host-migration.js';
import { isSafeMatchId } from './rematch.js';

const BIN = { BALL: 1, POS: 2, POS_V2: 3 };
const PLAYER_ID_KEY = 'dodgb.playerId';
const RESUME_TOKEN_KEY = 'dodgb.resumeToken';
export const TARGET_ID_MAX_BYTES = 128;
export const NETWORK_WORLD_BOUND = 512;
export const NETWORK_SPEED_BOUND = 512;
const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const PLAYER_HIT_DAMAGE_MAX = 1000;
const PENDING_JOIN_AVATAR_MAX_LENGTH = 512 * 1024;
const RESUME_TOKEN_MAX_BYTES = 256;
const RESUME_CHALLENGE_TTL_MS = 10_000;
const RESUME_PROOF_PATTERN = /^[a-f0-9]{64}$/;
const RESUME_NONCE_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_K = Uint32Array.of(
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4f, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
);
const RESUME_TOKEN_MAX_LENGTH = TARGET_ID_MAX_BYTES;
const RESUME_HANDSHAKE_TTL_MS = 5000;
const PROTOCOL_CAPABILITIES = Object.freeze({
    positionV2: true,
    migrationVotes: true
});

function normalizeProtocolCapabilities(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.freeze({
        positionV2: value.positionV2 === true,
        migrationVotes: value.migrationVotes === true
    });
}

export function isSafeTargetId(value) {
    return typeof value === 'string'
        && TARGET_ID_PATTERN.test(value)
        && UTF8_ENCODER.encode(value).byteLength <= TARGET_ID_MAX_BYTES;
}

function isBoundedFinite(value, bound) {
    return Number.isFinite(value) && Math.abs(value) <= bound;
}

function isValidPositionPacket(data) {
    return [data.x, data.y, data.z]
        .every(value => isBoundedFinite(value, NETWORK_WORLD_BOUND))
        && ['ry', 'ax', 'ay', 'az'].every(key =>
            data[key] === undefined || isBoundedFinite(data[key], NETWORK_WORLD_BOUND))
        && ['vx', 'vy', 'vz'].every(key =>
            data[key] === undefined || isBoundedFinite(data[key], NETWORK_SPEED_BOUND));
}

function isValidBallPacket(data) {
    return [data.x, data.y, data.z]
        .every(value => isBoundedFinite(value, NETWORK_WORLD_BOUND))
        && [data.vx, data.vy, data.vz]
            .every(value => isBoundedFinite(value, NETWORK_SPEED_BOUND))
        && Number.isFinite(data.speed)
        && data.speed >= 0
        && data.speed <= NETWORK_SPEED_BOUND;
}

function normalizePlayerHitPacket(data) {
    if (!Number.isFinite(data?.dmg)
        || data.dmg < 0
        || data.dmg > PLAYER_HIT_DAMAGE_MAX) return null;
    const targetPlayerId = data.targetPlayerId ?? data.targetId ?? data.playerId;
    const sourcePlayerId = data.sourcePlayerId
        ?? data.sourceId
        ?? data.attackerPlayerId
        ?? data.attackerId
        ?? null;
    if (!isSafeTargetId(targetPlayerId)
        || (sourcePlayerId !== null && !isSafeTargetId(sourcePlayerId))) return null;
    return {
        ...data,
        playerId: targetPlayerId,
        targetPlayerId,
        sourcePlayerId
    };
}

function encodeBinaryText(value, { maxBytes = 255, validate = null, coerce = true } = {}) {
    if (value === null || value === undefined || value === '') return new Uint8Array(0);
    if (!coerce && typeof value !== 'string') return null;
    const text = coerce ? String(value) : value;
    if (validate && !validate(text)) return null;
    const bytes = UTF8_ENCODER.encode(text);
    return bytes.byteLength <= Math.min(255, maxBytes) ? bytes : null;
}

function readBinaryText(dv, offset, { maxBytes = 255, validate = null } = {}) {
    if (offset + 1 > dv.byteLength) return null;
    const length = dv.getUint8(offset);
    const next = offset + 1 + length;
    if (length > maxBytes || next > dv.byteLength) return null;
    let value = '';
    try {
        if (length) {
            value = UTF8_DECODER.decode(new Uint8Array(
                dv.buffer,
                dv.byteOffset + offset + 1,
                length
            ));
        }
    } catch (_) {
        return null;
    }
    if (value && validate && !validate(value)) return null;
    return { next, value };
}

function createSessionValue(key, prefix) {
    try {
        const stored = globalThis.sessionStorage?.getItem(key);
        if (stored) return stored;
    } catch (_) {}
    const id = globalThis.crypto?.randomUUID?.()
        || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { globalThis.sessionStorage?.setItem(key, id); } catch (_) {}
    return id;
}

function constantTimeSessionValueEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBytes = UTF8_ENCODER.encode(left);
    const rightBytes = UTF8_ENCODER.encode(right);
    let different = leftBytes.byteLength ^ rightBytes.byteLength;
    for (let index = 0; index < TARGET_ID_MAX_BYTES; index++) {
        different |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
    }
    return different === 0;
}

function isSafeResumeProof(value) {
    return typeof value === 'string' && RESUME_PROOF_PATTERN.test(value);
}

function isSafeResumeToken(value) {
    return typeof value === 'string'
        && value.length > 0
        && UTF8_ENCODER.encode(value).byteLength <= RESUME_TOKEN_MAX_BYTES;
}

function sha256Fallback(bytes) {
    const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.byteLength] = 0x80;
    const view = new DataView(padded.buffer);
    const bitLength = bytes.byteLength * 8;
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    const hash = Uint32Array.of(
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    );
    const words = new Uint32Array(64);
    const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let index = 0; index < 16; index++) {
            words[index] = view.getUint32(offset + index * 4);
        }
        for (let index = 16; index < 64; index++) {
            const left = words[index - 15];
            const right = words[index - 2];
            const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
            const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
            words[index] = (
                words[index - 16] + sigma0 + words[index - 7] + sigma1
            ) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index++) {
            const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + sum1 + choose + SHA256_K[index] + words[index]) >>> 0;
            const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    return [...hash].map(word => word.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(token, cryptoProvider = globalThis.crypto) {
    if (typeof token !== 'string' || !token) return null;
    const bytes = UTF8_ENCODER.encode(token);
    if (cryptoProvider?.subtle) {
        try {
            const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
            return [...new Uint8Array(digest)]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        } catch (_) {}
    }
    return sha256Fallback(bytes);
}

function createResumeNonce() {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') return null;
    try {
        const bytes = new Uint8Array(32);
        globalThis.crypto.getRandomValues(bytes);
        return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return null;
    }
}

function removeConnectionListener(conn, type, handler) {
    if (typeof conn?.off === 'function') conn.off(type, handler);
    else conn?.removeListener?.(type, handler);
}

function restoreMapEntry(map, key, hadValue, value) {
    if (hadValue) map.set(key, value);
    else map.delete(key);
}

async function digestResumeToken(token) {
    if (typeof token !== 'string' || !token) return null;
    let subtle = globalThis.crypto?.subtle;
    if (subtle) {
        try {
            const digest = await subtle.digest('SHA-256', UTF8_ENCODER.encode(token));
            return [...new Uint8Array(digest)]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        } catch (_) {}
    }
    return sha256Fallback(UTF8_ENCODER.encode(token));
}

function sha256FallbackLegacy(bytes) {
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
        0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const bitLength = bytes.length * 8;
    const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    new DataView(padded.buffer).setBigUint64(padded.length - 8, BigInt(bitLength));
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        const view = new DataView(padded.buffer, offset, 64);
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
        for (let i = 16; i < 64; i++) {
            const x = w[i - 15], y = w[i - 2];
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + k[i] + w[i]) >>> 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
        }
        h = h.map((value, i) => (value + [a, b, c, d, e, f, g, hh][i]) >>> 0);
    }
    return h.map(value => value.toString(16).padStart(8, '0')).join('');
}

function createResumeNonceLegacy() {
    const getRandomValues = globalThis.crypto?.getRandomValues;
    if (typeof getRandomValues !== 'function') return null;
    const bytes = new Uint8Array(32);
    try {
        getRandomValues.call(globalThis.crypto, bytes);
    } catch (_) {
        return null;
    }
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isNewerSequence(next, previous) {
    const delta = (next - previous + 0x10000) & 0xffff;
    return delta > 0 && delta < 0x8000;
}

export function reconnectDelay(attempt) {
    return Math.min(2000, 500 * (2 ** Math.max(0, attempt - 1)));
}

export class Network {
    constructor(game) {
        this.game = game;
        this.peer = null;
        this.connections = new Map();
        this.peerToPlayerId = new Map();
        this.playerConnections = new Map();
        this.playerResumeProofs = new Map();
        this._pendingResumeProofs = new Map();
        this.pendingIdentityAdmissions = new Map();
        this.pendingResumeHandshakes = new Map();
        this._digestResumeToken = sha256Hex;
        this._createResumeNonce = createResumeNonce;
        this._answeredResumeChallenges = new WeakSet();
        this.allowedMeshPeers = new Map();
        this.peerCapabilities = new Map();
        this.pendingConnections = new Map();
        this.hostConn = null;      // direct reference to host connection (mesh routing)
        this.isHost = false;
        this.roomCode = '';
        this.playerId = createSessionValue(PLAYER_ID_KEY, 'player');
        this.resumeToken = createSessionValue(RESUME_TOKEN_KEY, 'resume');
        this.playerName = 'Player';
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onGameState = null;
        this.onPartyReady = null;
        this.connected = false;
        this.isParty = false;
        this.readyPlayers = new Set();
        this.onReadyChange = null;
        this.onPartyChat = null;
        this.onSocialPresence = null;
        this.onSocialChat = null;
        this.lobbyPassword = '';   // host-set; '' = open lobby
        this.onKicked = null;      // callback() when host kicks us
        this.onTeamChange = null;  // callback(name, team) applied on clients
        this.onHostLeft = null;    // callback() when the host connection drops / lobby closes
        this.onHostMigration = null;
        this.onHostMigrated = null;
        this._lastPing = 0;            // ms, son ölçülen RTT
        this._pingAwait = null;        // güncel bekleyen nonce
        this._clockOffset = 0;
        this._positionSeq = 0;
        this._lastPositionSeq = new Map();
        this.hostRoomCode = '';
        this.joinPassword = '';
        this.onReconnectState = null;
        this.onRematchReady = null;
        this.onRematchState = null;
        this.onRematchStart = null;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        this._reconnectTimer = null;
        this._joinPromise = null;
        this._socialRate = new Map();
        this._sentPackets = 0;
        this._receivedPackets = 0;
        this.migrationEpoch = 0;
        this.migrationRoster = new Map();
        this.latestHostCheckpoint = null;
        this._checkpointSequence = 0;
        this._migrationTimer = null;
        this._migrationTimeout = null;
        this._migrationActive = false;
        this._migrationElection = null;
        this._lastMigrationAttemptEpoch = 0;
        this._nextMigrationOrder = 0;
        this._sessionStartedAt = Date.now();
    }

    async initPeer() {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(undefined, {
                debug: 0
            });
            this.peer.on('open', id => {
                this.roomCode = id;
                this.connected = true;
                resolve(id);
            });
            this.peer.on('error', err => {
                console.error('Peer error:', err);
                reject(err);
            });
            // ALL peers accept incoming connections (mesh: P2P position relay)
            this.peer.on('connection', (conn) => this._onIncomingConnection(conn));
        });
    }

    async hostGame(playerName) {
        this.playerName = playerName;
        this.isHost = true;
        await this.initPeer();
        this.hostRoomCode = this.roomCode;
        await this._reservePlayerIdentity(this.playerId, this.resumeToken);
        this._updateMigrationRoster([{
            playerId: this.playerId,
            peerId: this.peer?.id,
            name: this.playerName,
            team: this.game?.player?.team
        }]);
        if (this.game?.player) this.game.player.peerId = this.roomCode;
        return this.roomCode;
    }

    joinGame(roomCode, playerName, password = '') {
        if (this._joinPromise) return this._joinPromise;
        const promise = this._joinGame(roomCode, playerName, password);
        this._joinPromise = promise;
        promise.finally(() => {
            if (this._joinPromise === promise) this._joinPromise = null;
        }).catch(() => {});
        return promise;
    }

    async _joinGame(roomCode, playerName, password = '') {
        this.playerName = playerName;
        this.isHost = false;
        this.hostRoomCode = roomCode;
        this.joinPassword = password;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        this._migrationActive = false;
        await this.initPeer();
        if (this.game?.player && this.peer) this.game.player.peerId = this.peer.id;

        const conn = this.peer.connect(roomCode, {
            metadata: {
                name: playerName,
                password,
                playerId: this.playerId,
                capabilities: PROTOCOL_CAPABILITIES
            }
        });

        return new Promise((resolve, reject) => {
            conn.on('open', () => {
                this._reconnectAttempts = 0;
                this.hostConn = conn;
                this.connections.set(roomCode, conn);
                this.setupDataHandlers(conn);
                resolve();
            });
            // Host went away (closed game / left lobby) → kick us back to menu.
            conn.on('close', () => {
                if (this.connections.get(roomCode) === conn) this.connections.delete(roomCode);
                if (this.hostConn === conn) this.hostConn = null;
                this._scheduleReconnect();
            });
            conn.on('error', reject);
        });
    }

    // Route incoming connections: new player join (host) vs P2P mesh (non-host peers)
    _scheduleReconnect() {
        if (this._manualDisconnect || this.isHost || !this.peer
            || this._reconnectTimer || this._migrationActive) return;
        const attempt = ++this._reconnectAttempts;
        if (attempt > 3) {
            this._beginHostMigration();
            return;
        }
        this.onReconnectState?.('reconnecting', attempt);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._reconnectOnce();
        }, reconnectDelay(attempt));
    }

    _reconnectOnce() {
        if (this._manualDisconnect || !this.peer || !this.hostRoomCode) return;
        const conn = this.peer.connect(this.hostRoomCode, {
            metadata: {
                name: this.playerName,
                password: this.joinPassword,
                playerId: this.playerId,
                capabilities: PROTOCOL_CAPABILITIES
            }
        });
        conn.on('open', () => {
            this._reconnectAttempts = 0;
            this.hostConn = conn;
            this.connections.set(this.hostRoomCode, conn);
            this.setupDataHandlers(conn);
            this.onReconnectState?.('connected', 0);
        });
        conn.on('close', () => {
            if (this.connections.get(this.hostRoomCode) === conn) this.connections.delete(this.hostRoomCode);
            if (this.hostConn === conn) this.hostConn = null;
            this._scheduleReconnect();
        });
        conn.on('error', () => this._scheduleReconnect());
    }

    _onIncomingConnection(conn) {
        conn.on('open', () => {
            if (conn.metadata?.isMesh) {
                if (this.isHost) conn.close();
                else this._handleMeshConn(conn);
            } else if (this.isHost) {
                this._ensureIdentityMaps();
                const playerId = conn.metadata?.playerId;
                if (!isSafeTargetId(playerId)) {
                    this._rejectIdentityConnection(conn, conn.metadata?.name, 'invalid_identity');
                    return;
                }
                if (this.playerConnections.has(playerId)
                    || this.pendingIdentityAdmissions.has(playerId)) {
                    this._rejectIdentityConnection(conn, conn.metadata?.name);
                    return;
                }
                this._handleJoinConn(conn);
            } else {
                // Non-host receiving a non-mesh connection = odd; close to be safe.
                conn.close();
            }
        });
    }

    _ensureIdentityMaps() {
        if (!(this.connections instanceof Map)) this.connections = new Map();
        if (!(this.peerToPlayerId instanceof Map)) this.peerToPlayerId = new Map();
        if (!(this.playerConnections instanceof Map)) this.playerConnections = new Map();
        if (!(this.playerResumeTokens instanceof Map)) this.playerResumeTokens = new Map();
        if (!(this.playerResumeProofs instanceof Map)) this.playerResumeProofs = new Map();
        if (!(this._pendingResumeProofs instanceof Map)) this._pendingResumeProofs = new Map();
        if (!(this.pendingIdentityAdmissions instanceof Map)) this.pendingIdentityAdmissions = new Map();
        if (!(this.pendingResumeHandshakes instanceof Map)) this.pendingResumeHandshakes = new Map();
        if (!(this.migrationRoster instanceof Map)) this.migrationRoster = new Map();
        if (!(this.allowedMeshPeers instanceof Map)) this.allowedMeshPeers = new Map();
        if (!(this.peerCapabilities instanceof Map)) this.peerCapabilities = new Map();
        if (!(this.pendingConnections instanceof Map)) this.pendingConnections = new Map();
    }

    _bindConnectionIdentity(conn, playerId, playerName = null) {
        if (!conn || !isSafeTargetId(playerId)) return null;
        const current = Object.getOwnPropertyDescriptor(conn, '_playerId');
        if (current && current.value !== playerId) return null;
        try {
            if (!current) {
                Object.defineProperty(conn, '_playerId', {
                    value: playerId,
                    enumerable: false,
                    writable: false,
                    configurable: false
                });
            }
            if (!Object.getOwnPropertyDescriptor(conn, '_playerName')) {
                Object.defineProperty(conn, '_playerName', {
                    value: String(playerName || 'Player').trim().slice(0, 32) || 'Player',
                    enumerable: false,
                    writable: false,
                    configurable: false
                });
            }
        } catch (_) {
            return null;
        }
        return conn._playerId;
    }

    _reservePlayerIdentity(playerId, resumeToken) {
        this._ensureIdentityMaps();
        if (!isSafeTargetId(playerId) || typeof resumeToken !== 'string'
            || !resumeToken) return Promise.resolve(null);
        if (this.playerResumeProofs.has(playerId)) {
            return Promise.resolve(this.playerResumeProofs.get(playerId));
        }
        const existing = this._pendingResumeProofs.get(playerId);
        if (existing) return existing;
        let digest;
        try {
            digest = this._digestResumeToken(resumeToken);
        } catch (_) {
            this.playerResumeProofs.set(playerId, null);
            return Promise.resolve(null);
        }
        const pending = Promise.resolve(digest).then(proof => {
            if (!isSafeResumeProof(proof)) {
                this.playerResumeProofs.set(playerId, null);
                return null;
            }
            this.playerResumeTokens.set(playerId, resumeToken);
            this.playerResumeProofs.set(playerId, proof);
            const entry = this.migrationRoster.get(playerId);
            if (entry) {
                this.migrationRoster.set(playerId, Object.freeze({
                    ...entry,
                    resumeReserved: true,
                    resumeProof: proof
                }));
            }
            if (this.isHost) {
                this.broadcast({
                    type: 'migrationRoster',
                    roster: [...this.migrationRoster.values()]
                });
            }
            return proof;
        }).catch(() => {
            this.playerResumeProofs.set(playerId, null);
            return null;
        }).finally(() => {
            if (this._pendingResumeProofs.get(playerId) === pending) {
                this._pendingResumeProofs.delete(playerId);
            }
        });
        this._pendingResumeProofs.set(playerId, pending);
        return pending;
    }

    _rejectIdentityConnection(conn, name, reason = 'duplicate_identity') {
        if (conn.closed || conn.open === false) return;
        conn.send({ type: 'kick', name, reason });
        setTimeout(() => conn.close(), 200);
    }

    _admitIdentityConnection(conn, playerId, name) {
        this._ensureIdentityMaps();
        if (conn.closed || conn.open === false
            || this.playerConnections.has(playerId)) return false;
        const oldRoster = this.migrationRoster;
        try {
            this.connections.set(conn.peer, conn);
            this.peerToPlayerId.set(conn.peer, playerId);
            this.playerConnections.set(playerId, conn);
            conn._admitted = true;
            conn._identityAdmissionManaged = true;
            this.setupDataHandlers(conn);
            this._updateMigrationRoster([
                ...this.migrationRoster.values(),
                { playerId, peerId: conn.peer, name, team: 'red' }
            ]);
            this.broadcast({
                type: 'migrationRoster',
                roster: [...this.migrationRoster.values()]
            });
        } catch (_) {
            if (this.connections.get(conn.peer) === conn) this.connections.delete(conn.peer);
            if (this.peerToPlayerId.get(conn.peer) === playerId) this.peerToPlayerId.delete(conn.peer);
            if (this.playerConnections.get(playerId) === conn) this.playerConnections.delete(playerId);
            this.peerCapabilities.delete(conn.peer);
            this.migrationRoster = oldRoster;
            return false;
        }
        conn._sendWelcome = () => conn.send({
            type: 'welcome',
            players: this.game.getPlayerList(),
            state: this.game.state,
            mode: this.game.mode?.id,
            map: this.game?.arena?.mapId,
            round: this.game.scoreboard?.roundNum,
            red: this.game.scoreboard?.redScore,
            blue: this.game.scoreboard?.blueScore,
            time: this.game.scoreboard?.timeRemaining,
            snapshot: this.game.snapshotState?.() || {},
            migrationRoster: [...this.migrationRoster.values()],
            migrationEpoch: this.migrationEpoch,
            checkpoint: this.latestHostCheckpoint
        });
        conn.on('close', () => {
            if (this.connections.get(conn.peer) === conn) {
                this.connections.delete(conn.peer);
                this.peerToPlayerId.delete(conn.peer);
            }
            if (this.playerConnections.get(playerId) !== conn) return;
            this.playerConnections.delete(playerId);
            this._lastPositionSeq.delete(playerId);
            this._removeMigrationPeer(conn.peer, playerId, conn);
            if (this.onPlayerLeave) this.onPlayerLeave(playerId, conn.peer);
        });
        return true;
    }

    _normalizePendingJoin(data) {
        if (data?.type !== 'join' || !this._validateMsg(data)
            || (data.avatar !== undefined
                && (typeof data.avatar !== 'string'
                    || data.avatar.length > PENDING_JOIN_AVATAR_MAX_LENGTH))) {
            return null;
        }
        return Object.freeze({
            type: 'join',
            name: data.name,
            ...(data.playerId === undefined ? {} : { playerId: data.playerId }),
            ...(data.avatar === undefined ? {} : { avatar: data.avatar })
        });
    }

    _beginResumeHandshake(conn) {
        this._ensureIdentityMaps();
        if (Object.hasOwn(conn.metadata || {}, 'resumeToken')) {
            conn.close();
            return false;
        }
        const nonce = createResumeNonce();
        if (!nonce) {
            conn.close();
            return false;
        }
        const pending = { conn, nonce, used: false, timer: null };
        pending.timer = setTimeout(() => {
            if (this.pendingResumeHandshakes.get(conn.peer) === pending) {
                this._clearResumeHandshake(pending);
                conn.close();
            }
        }, RESUME_HANDSHAKE_TTL_MS);
        this.pendingResumeHandshakes.set(conn.peer, pending);
        pending.onData = data => {
            if (this.pendingResumeHandshakes.get(conn.peer) !== pending) return;
            if (data?.type !== 'resumeResponse') return;
            this.handleMessage(data, conn.peer);
        };
        pending.onClose = () => {
            if (this.pendingResumeHandshakes.get(conn.peer) === pending) {
                this._clearResumeHandshake(pending);
            } else {
                clearTimeout(pending.timer);
            }
        };
        conn.on('data', pending.onData);
        conn.on('close', pending.onClose);
        try {
            conn.send({ type: 'resumeChallenge', nonce });
        } catch (_) {
            this._clearResumeHandshake(pending);
            conn.close();
            return false;
        }
        return true;
    }

    _clearResumeHandshake(pending) {
        clearTimeout(pending.timer);
        if (this.pendingResumeHandshakes.get(pending.conn.peer) === pending) {
            this.pendingResumeHandshakes.delete(pending.conn.peer);
        }
        pending.conn.off?.('data', pending.onData);
        pending.conn.off?.('close', pending.onClose);
        pending.conn.removeListener?.('data', pending.onData);
        pending.conn.removeListener?.('close', pending.onClose);
    }

    _handleJoinConn(conn) {
        return this._beginResumeHandshake(conn);
    }

    _handleResumeChallenge(data, peerId) {
        if (this.isHost || peerId !== this.hostConn?.peer
            || typeof data.nonce !== 'string') return;
        const conn = this.connections.get(peerId);
        if (!conn || conn.closed || conn.open === false) return;
        const token = this.resumeToken;
        const avatar = globalThis.window?.__store?.get?.('customAvatar')?.dataURL || '';
        if (typeof token !== 'string' || !token || token.length > RESUME_TOKEN_MAX_LENGTH
            || typeof avatar !== 'string' || avatar.length > PENDING_JOIN_AVATAR_MAX_LENGTH) {
            conn.close();
            return;
        }
        try {
            conn.send({
                type: 'resumeResponse',
                nonce: data.nonce,
                playerId: this.playerId,
                name: this.playerName,
                password: this.joinPassword,
                avatar,
                resumeToken: token,
                capabilities: PROTOCOL_CAPABILITIES
            });
        } catch (_) {
            conn.close();
        }
    }

    _beginIdentityAdmission(conn, playerId, name, resumeToken, expectedProof, earlyJoin = null) {
        this._ensureIdentityMaps();
        const activePending = this.pendingIdentityAdmissions.get(playerId);
        if (activePending && activePending.conn !== conn) {
            this._rejectIdentityConnection(conn, name);
            return Promise.resolve(false);
        }
        if (!resumeToken || (expectedProof !== null
            && !isSafeResumeProof(expectedProof))) {
            this._rejectIdentityConnection(conn, name);
            return Promise.resolve(false);
        }
        const admission = {
            conn,
            promise: null,
            buffering: true,
            earlyJoin,
            hadResumeState: this.playerResumeProofs.has(playerId)
                || this.playerResumeTokens.has(playerId)
        };
        this.pendingIdentityAdmissions.set(playerId, admission);
        conn.on('data', data => {
            if (!admission.buffering || admission.earlyJoin) return;
            if (data?.type === 'resumeResponse') return;
            const join = this._normalizePendingJoin(data);
            if (join) admission.earlyJoin = join;
        });
        conn.on('close', () => {
            admission.buffering = false;
            admission.earlyJoin = null;
            if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                this.pendingIdentityAdmissions.delete(playerId);
            }
        });
        let digest;
        try {
            digest = this._digestResumeToken(resumeToken);
        } catch (_) {
            this.pendingIdentityAdmissions.delete(playerId);
            this._rejectIdentityConnection(conn, name);
            return Promise.resolve(false);
        }
        admission.promise = Promise.resolve(digest).then(proof => {
            if (this.pendingIdentityAdmissions.get(playerId) !== admission
                || conn.closed || conn.open === false
                || !isSafeResumeProof(proof)) {
                if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                    this.pendingIdentityAdmissions.delete(playerId);
                }
                if (!conn.closed && conn.open !== false) {
                    this._rejectIdentityConnection(conn, name);
                }
                return false;
            }
            if (expectedProof !== null
                && !constantTimeSessionValueEqual(expectedProof, proof)) {
                if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                    this.pendingIdentityAdmissions.delete(playerId);
                }
                admission.buffering = false;
                admission.earlyJoin = null;
                this._rejectIdentityConnection(conn, name);
                return false;
            }
            if (this.playerConnections.has(playerId)) {
                if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                    this.pendingIdentityAdmissions.delete(playerId);
                }
                this._rejectIdentityConnection(conn, name);
                return false;
            }
            if (!this._bindConnectionIdentity(conn, playerId, name)) {
                if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                    this.pendingIdentityAdmissions.delete(playerId);
                }
                this._rejectIdentityConnection(conn, name);
                return false;
            }
            if (expectedProof === null) {
                this.playerResumeTokens.set(playerId, resumeToken);
                this.playerResumeProofs.set(playerId, proof);
            }
            this.pendingIdentityAdmissions.delete(playerId);
            const admitted = this._admitIdentityConnection(conn, playerId, name);
            if (!admitted && !admission.hadResumeState && expectedProof === null) {
                this.playerResumeTokens.delete(playerId);
                this.playerResumeProofs.delete(playerId);
            }
            const earlyJoin = admitted ? admission.earlyJoin : null;
            admission.buffering = false;
            admission.earlyJoin = null;
            if (earlyJoin?.resumeAdmission) {
                try {
                    this.onPlayerJoin?.(name, playerId, earlyJoin.avatar, conn.peer);
                    conn._sendWelcome?.();
                } catch (_) {
                    // Gameplay callbacks must not invalidate transport admission.
                }
            } else if (earlyJoin) {
                this.handleMessage(earlyJoin, conn.peer);
            }
            return admitted;
        }).catch(() => {
            if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                this.pendingIdentityAdmissions.delete(playerId);
            }
            this._rejectIdentityConnection(conn, name);
            return false;
        }).finally(() => {
            admission.buffering = false;
            admission.earlyJoin = null;
            if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                this.pendingIdentityAdmissions.delete(playerId);
            }
        });
        return admission.promise;
    }

    _handleResumeResponse(conn, data) {
        this._ensureIdentityMaps();
        const pending = this.pendingResumeHandshakes.get(conn.peer);
        if (!pending || pending.conn !== conn || pending.used) {
            if (this._answeredResumeChallenges.has(conn)) conn.close();
            conn.close();
            return false;
        }
        pending.used = true;
        this._answeredResumeChallenges.add(conn);
        this._clearResumeHandshake(pending);
        conn._resumeResponseObject = data;
        const metadataPlayerId = conn.metadata?.playerId;
        const playerId = data.playerId;
        const name = String(data.name || 'Player').trim().slice(0, 32) || 'Player';
        const valid = data.nonce === pending.nonce
            && isSafeTargetId(metadataPlayerId)
            && metadataPlayerId === playerId
            && isSafeTargetId(playerId)
            && (data.resumeToken === undefined
                || (typeof data.resumeToken === 'string'
                    && data.resumeToken.length <= RESUME_TOKEN_MAX_LENGTH))
            && typeof data.password === 'string'
            && data.password.length <= RESUME_TOKEN_MAX_LENGTH
            && typeof data.avatar === 'string'
            && data.avatar.length <= PENDING_JOIN_AVATAR_MAX_LENGTH
            && normalizeProtocolCapabilities(data.capabilities)
            && (!this.lobbyPassword || data.password === this.lobbyPassword)
            && (!this.lobbyPassword || conn.metadata?.password === this.lobbyPassword);
        if (!valid) {
            conn.close();
            return false;
        }
        const previous = this.playerConnections.get(playerId);
        const proofReserved = this.playerResumeProofs.has(playerId);
        const expectedProof = this.playerResumeProofs.get(playerId);
        const pendingAdmission = this.pendingIdentityAdmissions.get(playerId);
        if ((previous && previous !== conn)
            || (pendingAdmission && pendingAdmission.conn !== conn)) {
            this._rejectIdentityConnection(conn, name);
            return;
        }
        if (proofReserved && !isSafeResumeProof(expectedProof)) {
            this._rejectIdentityConnection(conn, name);
            return;
        }
        const capabilities = normalizeProtocolCapabilities(data.capabilities);
        return Promise.resolve(this._beginIdentityAdmission(
            conn,
            playerId,
            name,
            typeof data.resumeToken === 'string' ? data.resumeToken : '',
            proofReserved ? expectedProof : null,
            { type: 'join', name, playerId, avatar: data.avatar, resumeAdmission: true }
        )).then(admitted => {
            if (admitted && this.playerConnections.get(playerId) === conn) {
                this.peerCapabilities.set(conn.peer, capabilities);
            }
            return admitted;
        });
    }

    _updateMigrationRoster(players = []) {
        this._ensureIdentityMaps();
        if (!Array.isArray(players)) return;
        const previous = this.migrationRoster;
        const next = [];
        const seenPlayers = new Set();
        const seenPeers = new Set();
        for (const player of players) {
            if (!player || player.isBot || typeof player.playerId !== 'string'
                || typeof player.peerId !== 'string'
                || !isSafeTargetId(player.playerId)
                || !isSafeTargetId(player.peerId)
                || seenPlayers.has(player.playerId)
                || seenPeers.has(player.peerId)) continue;
            seenPlayers.add(player.playerId);
            seenPeers.add(player.peerId);
            const existing = previous.get(player.playerId);
            const suppliedProof = isSafeResumeProof(player.resumeProof)
                ? player.resumeProof
                : null;
            const resumeReserved = this.isHost
                ? this.playerResumeProofs.has(player.playerId)
                    || this.playerResumeTokens.has(player.playerId)
                : player.resumeReserved === true
                    || Boolean(suppliedProof)
                    || existing?.resumeReserved === true;
            const resumeProof = this.isHost
                ? this.playerResumeProofs.get(player.playerId)
                : suppliedProof || existing?.resumeProof || null;
            const migrationOrder = !this.isHost
                && Number.isSafeInteger(player.migrationOrder)
                && player.migrationOrder >= 0
                ? player.migrationOrder
                : existing?.migrationOrder ?? this._nextMigrationOrder++;
            this._nextMigrationOrder = Math.max(this._nextMigrationOrder, migrationOrder + 1);
            next.push({
                playerId: player.playerId,
                peerId: player.peerId,
                name: String(player.name || 'Player').slice(0, 32),
                team: player.team === 'blue' ? 'blue' : 'red',
                migrationOrder,
                resumeReserved,
                ...(isSafeResumeProof(resumeProof) ? { resumeProof } : {}),
                _snapshotOrder: next.length
            });
        }
        if (this.peer?.id && isSafeTargetId(this.peer.id) && isSafeTargetId(this.playerId)
            && !seenPlayers.has(this.playerId) && !seenPeers.has(this.peer.id)) {
            const existing = previous.get(this.playerId);
            const resumeProof = this.playerResumeProofs.get(this.playerId)
                || existing?.resumeProof;
            next.push({
                playerId: this.playerId,
                peerId: this.peer.id,
                name: this.playerName,
                team: this.game?.player?.team === 'blue' ? 'blue' : 'red',
                migrationOrder: existing?.migrationOrder ?? this._nextMigrationOrder++,
                resumeReserved: this.playerResumeProofs.has(this.playerId)
                    || this.playerResumeTokens.has(this.playerId)
                    || existing?.resumeReserved === true,
                ...(isSafeResumeProof(resumeProof) ? { resumeProof } : {}),
                _snapshotOrder: next.length
            });
        }
        next.sort((left, right) =>
            left.migrationOrder - right.migrationOrder
            || left._snapshotOrder - right._snapshotOrder);
        let bounded = next.slice(0, HOST_MIGRATION_MAX_ROSTER);
        const local = next.find(player => player.playerId === this.playerId);
        if (local && !bounded.includes(local)) {
            bounded = bounded.slice(0, HOST_MIGRATION_MAX_ROSTER - 1).concat(local);
        }
        this.migrationRoster = new Map(bounded.map(player => {
            delete player._snapshotOrder;
            return [player.playerId, Object.freeze(player)];
        }));
        if (!this.isHost) {
            this.playerResumeProofs = new Map(
                bounded
                    .filter(player => player.resumeReserved === true)
                    .map(player => [
                        player.playerId,
                        isSafeResumeProof(player.resumeProof)
                            ? player.resumeProof
                            : null
                    ])
            );
            this.allowedMeshPeers.clear();
            for (const player of this.migrationRoster.values()) {
                if (player.peerId !== this.peer?.id) {
                    this.allowedMeshPeers.set(player.peerId, player.playerId);
                }
            }
        }
    }

    _removeMigrationPeer(peerId, playerId = null, closingConn = null) {
        this._ensureIdentityMaps();
        const identity = playerId || this.peerToPlayerId.get(peerId);
        const currentConnection = this.connections.get(peerId);
        const connection = closingConn || currentConnection;
        const replacedConnection = Boolean(
            closingConn && currentConnection && currentConnection !== closingConn
        );
        const pendingHandshake = this.pendingResumeHandshakes.get(peerId);
        if (pendingHandshake) this._clearResumeHandshake(pendingHandshake);
        if (identity && this.playerConnections.get(identity) === connection) {
            this.playerConnections.delete(identity);
            this._lastPositionSeq.delete(identity);
        }
        const entry = identity ? this.migrationRoster.get(identity) : null;
        if (entry?.peerId === peerId) {
            if (!this.playerResumeProofs.has(identity)
                && isSafeResumeProof(entry.resumeProof)) {
                this.playerResumeProofs.set(identity, entry.resumeProof);
            }
            this.migrationRoster.delete(identity);
        }
        this.allowedMeshPeers.delete(peerId);
        this.peerCapabilities.delete(peerId);
        if (!replacedConnection && this._migrationActive
            && this._migrationElection?.roster?.some(player => player.peerId === peerId)) {
            this._clearMigrationTimers();
            this._migrationActive = false;
            this._migrationElection = null;
            queueMicrotask(() => this._beginHostMigration());
        }
    }

    _migrationCandidates() {
        return [...this.migrationRoster.values()]
            .slice(0, HOST_MIGRATION_MAX_ROSTER)
            .map(player => {
            const local = player.playerId === this.playerId;
            const connection = local ? null : this.connections.get(player.peerId);
            return {
                ...player,
                eligible: local || Boolean(connection?.open),
                connected: local || Boolean(connection?.open),
                spectator: false,
                ping: 50,
                stability: 1,
                uptime: Date.now() - this._sessionStartedAt,
                packetLoss: 0
            };
        });
    }

    publishHostCheckpoint(state) {
        if (!this.isHost || !state) return null;
        this._updateMigrationRoster(state.players);
        const checkpoint = normalizeHostCheckpoint({
            epoch: this.migrationEpoch,
            sequence: ++this._checkpointSequence,
            createdAt: Date.now(),
            state
        });
        if (!checkpoint) return null;
        this.latestHostCheckpoint = checkpoint;
        this.broadcast({
            type: 'hostCheckpoint',
            checkpoint,
            roster: [...this.migrationRoster.values()]
        });
        return checkpoint;
    }

    _clearMigrationTimers() {
        if (this._migrationTimer) clearTimeout(this._migrationTimer);
        if (this._migrationTimeout) clearTimeout(this._migrationTimeout);
        this._migrationTimer = null;
        this._migrationTimeout = null;
    }

    _beginHostMigration(attempt = 0) {
        if (this._manualDisconnect || this.isHost || !this.peer
            || (this._migrationActive && attempt === 0)
            || !Number.isSafeInteger(attempt)
            || attempt < 0
            || attempt >= HOST_MIGRATION_MAX_ATTEMPTS) return;
        this._migrationActive = true;
        this._clearMigrationTimers();
        const candidates = this._migrationCandidates().filter(candidate =>
            candidate.eligible === true
            && candidate.connected !== false
            && candidate.spectator !== true);
        const selected = selectHostCandidate(candidates);
        const epoch = nextMigrationEpoch(
            this.migrationEpoch,
            this._lastMigrationAttemptEpoch
        );
        if (!selected || epoch === null) {
            this._migrationActive = false;
            this._migrationElection = null;
            this.onReconnectState?.('failed', this._reconnectAttempts);
            this.onHostLeft?.();
            return;
        }
        const roster = candidates.map(({
            playerId,
            peerId,
            migrationOrder,
            resumeReserved,
            resumeProof
        }) => ({
            playerId,
            peerId,
            migrationOrder,
            resumeReserved: resumeReserved === true,
            ...(isSafeResumeProof(resumeProof) ? { resumeProof } : {})
        }));
        const rosterDigest = migrationRosterDigest(roster);
        const attemptId = migrationAttemptId(epoch, roster, selected.playerId);
        if (!rosterDigest || !attemptId) {
            this._migrationActive = false;
            this._migrationElection = null;
            this.onReconnectState?.('failed', this._reconnectAttempts);
            this.onHostLeft?.();
            return;
        }
        this._lastMigrationAttemptEpoch = epoch;
        const votes = new Map();
        const election = {
            epoch,
            attempt,
            attemptId,
            rosterDigest,
            candidates,
            selected,
            roster,
            votes
        };
        this._migrationElection = election;
        const localVote = {
            type: 'hostMigrationVote',
            voterId: this.playerId,
            candidateId: selected.playerId,
            epoch,
            attemptId,
            rosterDigest
        };
        this._recordMigrationVote(localVote, this.peer.id);
        for (const player of roster) {
            if (player.playerId === this.playerId) continue;
            const conn = this.connections.get(player.peerId);
            if (conn?.open) conn.send(localVote);
        }
        this.onReconnectState?.('migrating', attempt);
        this.onHostMigration?.({
            epoch,
            attemptId,
            rosterDigest,
            candidate: selected,
            candidates
        });
        this._migrationTimeout = setTimeout(() => {
            if (!this._migrationActive || this._migrationElection !== election) return;
            this._migrationTimeout = null;
            const nextAttempt = attempt + 1;
            if (nextAttempt >= HOST_MIGRATION_MAX_ATTEMPTS) {
                this._migrationActive = false;
                this._migrationElection = null;
                this.onReconnectState?.('failed', this._reconnectAttempts);
                this.onHostLeft?.();
                return;
            }
            this._migrationTimer = setTimeout(() => {
                this._migrationTimer = null;
                if (this._migrationActive && this._migrationElection === election) {
                    this._beginHostMigration(nextAttempt);
                }
            }, migrationBackoffMs(attempt));
        }, HOST_MIGRATION_TIMEOUT_MS);
    }

    _migrationVotes(election = this._migrationElection) {
        if (election?.votes instanceof Map) return [...election.votes.values()];
        return Array.isArray(election?.votes) ? election.votes.slice() : [];
    }

    _recordMigrationVote(data, peerId) {
        const election = this._migrationElection;
        if (!this._migrationActive || !election || data?.epoch !== election.epoch
            || data.attemptId !== election.attemptId
            || data.rosterDigest !== election.rosterDigest
            || data.candidateId !== election.selected?.playerId) return false;
        const sourceConn = this.connections.get(peerId);
        const voterId = peerId === this.peer?.id
            ? this.playerId
            : sourceConn?._playerId || this.peerToPlayerId.get(peerId);
        const rosterEntry = election.roster.find(player => player.playerId === voterId);
        if (!voterId || data.voterId !== voterId || rosterEntry?.peerId !== peerId) return false;
        if (!(election.votes instanceof Map)) {
            election.votes = new Map(this._migrationVotes(election)
                .map(vote => [vote.voterId, vote]));
        }
        if (election.votes.has(voterId)) return false;
        election.votes.set(voterId, Object.freeze({
            voterId,
            candidateId: election.selected.playerId,
            epoch: election.epoch,
            attemptId: election.attemptId,
            rosterDigest: election.rosterDigest
        }));
        const votes = this._migrationVotes(election);
        if (election.selected.playerId === this.playerId
            && !this._migrationTimer
            && hasElectionAgreement(
                votes,
                election.selected.playerId,
                election.candidates,
                election.epoch,
                election.attemptId,
                election.rosterDigest
            )) {
            this._migrationTimer = setTimeout(
                () => this._promoteToHost(election.selected, election.epoch),
                migrationBackoffMs(0)
            );
        }
        return true;
    }

    _promoteToHost(candidate, epoch) {
        this._ensureIdentityMaps();
        const election = this._migrationElection;
        const votes = this._migrationVotes(election);
        const proposal = {
            epoch,
            candidateId: this.playerId,
            hostPeerId: this.peer?.id,
            roster: election?.roster,
            votes,
            attemptId: election?.attemptId,
            rosterDigest: election?.rosterDigest
        };
        if (!this._migrationActive || candidate.playerId !== this.playerId || !this.peer?.id
            || !election
            || !validateHostMigrationProposal(proposal, {
                currentEpoch: this.migrationEpoch,
                candidates: election.candidates,
                roster: election.roster,
                expectedPeerId: this.peer.id,
                observedVotes: votes,
                expectedAttemptId: election.attemptId,
                expectedRosterDigest: election.rosterDigest
            })) return;
        const state = this.latestHostCheckpoint?.state;
        if (state && this.game?.applyHostMigrationCheckpoint?.(state, true) !== true) return;
        this._clearMigrationTimers();
        this.migrationEpoch = epoch;
        this.isHost = true;
        this.connected = true;
        this.hostConn = null;
        this.hostRoomCode = this.peer.id;
        this.roomCode = this.peer.id;
        this.playerResumeTokens.clear();
        this.playerResumeProofs = new Map(election.roster.map(player => [
            player.playerId,
            isSafeResumeProof(player.resumeProof) ? player.resumeProof : null
        ]));
        for (const [peerId, conn] of this.connections) {
            if (!conn?.open) continue;
            const playerId = election.roster
                .find(player => player.peerId === peerId)?.playerId;
            if (!this._bindConnectionIdentity(conn, playerId)) continue;
            conn._admitted = true;
            this.peerToPlayerId.set(peerId, playerId);
            this.playerConnections.set(playerId, conn);
            conn.on('close', () => {
                if (this.playerConnections.get(playerId) !== conn) return;
                this.playerConnections.delete(playerId);
                this.connections.delete(peerId);
                this.peerToPlayerId.delete(peerId);
                this.onPlayerLeave?.(playerId, peerId);
            });
        }
        this.broadcast({
            type: 'hostMigrated',
            epoch,
            candidateId: this.playerId,
            hostPeerId: this.peer.id,
            roster: election.roster,
            votes,
            attemptId: election.attemptId,
            rosterDigest: election.rosterDigest,
            checkpoint: this.latestHostCheckpoint
        });
        this._migrationActive = false;
        this._migrationElection = null;
        this.onReconnectState?.('connected', 0);
        this.onHostMigrated?.({ isHost: true, epoch, roomCode: this.peer.id });
    }

    _acceptHostMigration(data, peerId) {
        const election = this._migrationElection;
        const observedVotes = this._migrationVotes(election);
        if (!this._migrationActive || !election
            || !validateHostMigrationProposal(data, {
                currentEpoch: this.migrationEpoch,
                candidates: election.candidates,
                roster: election.roster,
                expectedPeerId: peerId,
                observedVotes,
                expectedAttemptId: election.attemptId,
                expectedRosterDigest: election.rosterDigest
            })) return;
        const conn = this.connections.get(peerId);
        const boundCandidate = conn?._playerId || this.peerToPlayerId.get(peerId);
        if (!conn?.open || boundCandidate !== data.candidateId) return;
        const checkpoint = data.checkpoint === undefined || data.checkpoint === null
            ? null
            : normalizeHostCheckpoint(data.checkpoint);
        if ((data.checkpoint !== undefined && data.checkpoint !== null && !checkpoint)
            || (checkpoint && checkpoint.epoch !== this.migrationEpoch)
            || (checkpoint
                && this.game?.applyHostMigrationCheckpoint?.(checkpoint.state, false) !== true)) return;
        this._clearMigrationTimers();
        this.migrationEpoch = data.epoch;
        this.hostConn = conn;
        this.hostRoomCode = peerId;
        this.isHost = false;
        if (checkpoint) {
            this.latestHostCheckpoint = checkpoint;
        }
        this._migrationActive = false;
        this._migrationElection = null;
        conn.send({
            type: 'migrationJoin',
            epoch: data.epoch,
            playerId: this.playerId,
            name: this.playerName
        });
        this.onReconnectState?.('connected', 0);
        this.onHostMigrated?.({ isHost: false, epoch: data.epoch, roomCode: peerId });
    }

    _prefersOutgoingMesh(peerId) {
        return typeof this.peer?.id === 'string'
            && this.peer.id.localeCompare(peerId) > 0;
    }

    _installMeshConnection(conn, playerId, direction) {
        if (!conn || !isSafeTargetId(playerId)
            || !['incoming', 'outgoing'].includes(direction)
            || !this._bindConnectionIdentity(conn, playerId, conn.metadata?.name)) {
            conn?.close();
            return false;
        }
        if (!Object.getOwnPropertyDescriptor(conn, '_meshDirection')) {
            Object.defineProperty(conn, '_meshDirection', {
                value: direction,
                enumerable: false,
                writable: false,
                configurable: false
            });
        }
        const current = this.connections.get(conn.peer);
        if (current && current !== conn) {
            const outgoingPreferred = this._prefersOutgoingMesh(conn.peer);
            const nextPreferred = (direction === 'outgoing') === outgoingPreferred;
            const currentPreferred =
                (current._meshDirection === 'outgoing') === outgoingPreferred;
            const nextId = String(conn.connectionId || '');
            const currentId = String(current.connectionId || '');
            const nextWins = nextPreferred !== currentPreferred
                ? nextPreferred
                : Boolean(nextId && currentId && nextId < currentId);
            if (!nextWins) {
                conn.close();
                return false;
            }
        }
        this.connections.set(conn.peer, conn);
        this.peerToPlayerId.set(conn.peer, playerId);
        this._lastPositionSeq.delete(playerId);
        this.setupDataHandlers(conn);
        if (current && current !== conn) current.close();
        return true;
    }

    _handleMeshConn(conn) {
        const playerId = this.allowedMeshPeers.get(conn.peer);
        if (!playerId || conn.metadata?.playerId !== playerId
            || !this._installMeshConnection(conn, playerId, 'incoming')) {
            conn.close();
            return;
        }
        if (this._prefersOutgoingMesh(conn.peer)) {
            this.connectToPeer(conn.peer, playerId);
        }
        conn.on('close', () => {
            if (this.connections.get(conn.peer) === conn) {
                this.connections.delete(conn.peer);
                this.peerToPlayerId.delete(conn.peer);
                this._removeMigrationPeer(conn.peer, playerId, conn);
            }
        });
    }

    setupDataHandlers(conn) {
        const announcedIdentity = this.allowedMeshPeers.get(conn.peer)
            || this.peerToPlayerId.get(conn.peer);
        if (conn.metadata?.isMesh && announcedIdentity) {
            this._bindConnectionIdentity(conn, announcedIdentity);
        }
        conn.send({ type: 'capabilities', ...PROTOCOL_CAPABILITIES });
        conn.on('data', data => {
            if (data?.type === 'resumeChallenge') {
                this.handleMessage(data, conn.peer);
                return;
            }
            if (data?.type === 'resumeResponse') {
                if (conn._resumeResponseObject === data) {
                    conn._resumeResponseObject = null;
                    return;
                }
                conn.close();
                return;
            }
            if (this.connections.get(conn.peer) !== conn) return;
            this.handleMessage(data, conn.peer);
        });
        conn.on('close', () => {
            if (this.connections.get(conn.peer) !== conn) return;
            const ratePrefix = `${conn.peer}:`;
            for (const key of this._socialRate.keys()) {
                if (key.startsWith(ratePrefix)) this._socialRate.delete(key);
            }
            this.peerCapabilities.delete(conn.peer);
            if (conn._playerId && !conn._identityAdmissionManaged) {
                this._removeMigrationPeer(conn.peer, conn._playerId, conn);
            }
        });
    }

    _allowSocialPacket(peerId, type, now = Date.now()) {
        const config = type === 'socialChat'
            ? { windowMs: 5000, max: 8 }
            : type === 'rematchReady'
                ? { windowMs: 1000, max: 4 }
                : { windowMs: 1000, max: 30 };
        const key = `${peerId}:${type}`;
        let entry = this._socialRate.get(key);
        if (!entry || now - entry.startedAt >= config.windowMs) {
            entry = { startedAt: now, count: 0 };
            this._socialRate.set(key, entry);
        }
        entry.count++;
        return entry.count <= config.max;
    }

    // --- ponytail: binary codec for hot-path packets ---
    _decodeBinary(data) {
        try {
            const dv = data instanceof Uint8Array
                ? new DataView(data.buffer, data.byteOffset, data.byteLength)
                : new DataView(data);
            if (dv.byteLength < 1) return null;
            const t = dv.getUint8(0);
            if (t === BIN.BALL) return this._decodeBallState(dv);
            if (t === BIN.POS) return this._decodePositionLayout(dv, false, false);
            if (t === BIN.POS_V2) return this._decodePositionLayout(dv, true, true);
        } catch (_) {
            return null;
        }
        return null;
    }

    _decodeBallState(dv) {
        if (dv.byteLength < 32) return null;
        const msg = { type: 'ballState', seq: dv.getUint16(1) };
        msg.x = dv.getFloat32(3); msg.y = dv.getFloat32(7); msg.z = dv.getFloat32(11);
        msg.vx = dv.getFloat32(15); msg.vy = dv.getFloat32(19); msg.vz = dv.getFloat32(23);
        msg.speed = dv.getFloat32(27);
        const flags = dv.getUint8(31);
        msg.active = !!(flags & 1);
        let off = 32;
        if (flags & 2) {
            if (off + 1 > dv.byteLength) return null;
            const sc = dv.getUint8(off++);
            msg.state = { 0: 'idle', 1: 'rally', 2: 'hold', 3: 'warmup', 4: 'other' }[sc] || 'rally';
        }
        if (flags & 4) {
            const segment = readBinaryText(dv, off);
            if (!segment) return null;
            off = segment.next;
            msg.targetName = segment.value || null;
        }
        if (flags & 8) {
            const segment = readBinaryText(dv, off);
            if (!segment || segment.next + 4 > dv.byteLength) return null;
            off = segment.next;
            msg.affix = segment.value;
            msg.affixColor = dv.getUint32(off);
            off += 4;
        }
        if (flags & 16) {
            const segment = readBinaryText(dv, off, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId
            });
            if (!segment) return null;
            off = segment.next;
            msg.targetPlayerId = segment.value || null;
        }
        if (flags & 32) {
            const segment = readBinaryText(dv, off, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId
            });
            if (!segment) return null;
            off = segment.next;
            msg.targetPeerId = segment.value || null;
        }
        return off === dv.byteLength && isValidBallPacket(msg) ? msg : null;
    }

    _decodePositionLayout(dv, modern, sequenced) {
        const minimum = sequenced ? 44 : modern ? 42 : 30;
        if (dv.byteLength < minimum) return null;
        const msg = { type: 'position' };
        msg.x = dv.getFloat32(1); msg.y = dv.getFloat32(5); msg.z = dv.getFloat32(9);
        msg.ry = dv.getFloat32(13);
        msg.ax = dv.getFloat32(17); msg.ay = dv.getFloat32(21); msg.az = dv.getFloat32(25);
        msg.vx = modern ? dv.getFloat32(29) : 0; msg.vy = modern ? dv.getFloat32(33) : 0; msg.vz = modern ? dv.getFloat32(37) : 0;
        if (sequenced) msg.seq = dv.getUint16(41);
        const flags = dv.getUint8(sequenced ? 43 : modern ? 41 : 29);
        if (flags & ~0x3f) return null;
        let off = sequenced ? 44 : modern ? 42 : 30;
        if (flags & 1) {
            if (off + 1 > dv.byteLength) return null;
            msg.alive = dv.getUint8(off++) === 1;
        }
        if (flags & 2) {
            if (off + 1 > dv.byteLength) return null;
            msg.hp = dv.getUint8(off++);
        }
        if (flags & 4) {
            if (off + 1 > dv.byteLength) return null;
            msg.team = dv.getUint8(off++) === 0 ? 'red' : 'blue';
        }
        if (flags & 8) {
            const segment = readBinaryText(dv, off);
            if (!segment) return null;
            off = segment.next;
            msg.name = segment.value;
        }
        if (flags & 16) {
            const segment = readBinaryText(dv, off);
            if (!segment) return null;
            off = segment.next;
            msg.charId = segment.value;
        }
        if (flags & 32) {
            const segment = readBinaryText(dv, off, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId
            });
            if (!segment) return null;
            off = segment.next;
            msg.playerId = segment.value;
        }
        return off === dv.byteLength && isValidPositionPacket(msg) ? msg : null;
    }

    encodeBallState(b) {
        const hasState = Object.prototype.hasOwnProperty.call(b, 'state');
        const targetRequested = Object.prototype.hasOwnProperty.call(b, 'targetName');
        const affixRequested = !!b.affix;
        const targetPlayerIdRequested = Object.prototype.hasOwnProperty.call(b, 'targetPlayerId');
        const targetPeerIdRequested = Object.prototype.hasOwnProperty.call(b, 'targetPeerId');
        let size = 32;
        let stateCode = 1, targetBytes = null, affixBytes = null;
        let targetPlayerIdBytes = null, targetPeerIdBytes = null;
        if (hasState) { size += 1; stateCode = { idle: 0, hold: 2, warmup: 3, rally: 1, other: 4 }[b.state] ?? 4; }
        if (targetRequested) targetBytes = encodeBinaryText(b.targetName);
        if (affixRequested) affixBytes = encodeBinaryText(b.affix.id || b.affix.name);
        if (targetPlayerIdRequested) {
            targetPlayerIdBytes = encodeBinaryText(b.targetPlayerId, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId,
                coerce: false
            });
        }
        if (targetPeerIdRequested) {
            targetPeerIdBytes = encodeBinaryText(b.targetPeerId, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId,
                coerce: false
            });
        }
        const hasTarget = targetRequested && targetBytes !== null;
        const hasAffix = affixRequested && affixBytes !== null;
        const hasTargetPlayerId = targetPlayerIdRequested && targetPlayerIdBytes !== null;
        const hasTargetPeerId = targetPeerIdRequested && targetPeerIdBytes !== null;
        if (hasTarget) size += 1 + targetBytes.length;
        if (hasAffix) size += 1 + affixBytes.length + 4;
        if (hasTargetPlayerId) size += 1 + targetPlayerIdBytes.length;
        if (hasTargetPeerId) size += 1 + targetPeerIdBytes.length;
        const buf = new ArrayBuffer(size);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        dv.setUint8(0, BIN.BALL);
        dv.setUint16(1, (b.seq || 0) & 0xffff);
        dv.setFloat32(3, b.x); dv.setFloat32(7, b.y); dv.setFloat32(11, b.z);
        dv.setFloat32(15, b.vx); dv.setFloat32(19, b.vy); dv.setFloat32(23, b.vz);
        dv.setFloat32(27, b.speed);
        let flags = b.active ? 1 : 0, off = 32;
        if (hasState) { flags |= 2; dv.setUint8(off, stateCode); off += 1; }
        if (hasTarget) { flags |= 4; dv.setUint8(off, targetBytes.length); off += 1; u8.set(targetBytes, off); off += targetBytes.length; }
        if (hasAffix) { flags |= 8; dv.setUint8(off, affixBytes.length); off += 1; u8.set(affixBytes, off); off += affixBytes.length; dv.setUint32(off, b.affix.color || 0); off += 4; }
        if (hasTargetPlayerId) { flags |= 16; dv.setUint8(off, targetPlayerIdBytes.length); off += 1; u8.set(targetPlayerIdBytes, off); off += targetPlayerIdBytes.length; }
        if (hasTargetPeerId) { flags |= 32; dv.setUint8(off, targetPeerIdBytes.length); off += 1; u8.set(targetPeerIdBytes, off); off += targetPeerIdBytes.length; }
        dv.setUint8(31, flags);
        return u8;
    }

    encodePosition(p) {
        let size = 44;
        let nameBytes = null, charBytes = null, playerIdBytes = null;
        if (p.alive !== undefined) size += 1;
        if (p.hp !== undefined) size += 1;
        if (p.team) size += 1;
        if (p.name) nameBytes = encodeBinaryText(p.name);
        if (p.charId) charBytes = encodeBinaryText(p.charId);
        if (p.playerId) {
            playerIdBytes = encodeBinaryText(p.playerId, {
                maxBytes: TARGET_ID_MAX_BYTES,
                validate: isSafeTargetId,
                coerce: false
            });
        }
        if (nameBytes) size += 1 + nameBytes.length;
        if (charBytes) size += 1 + charBytes.length;
        if (playerIdBytes) size += 1 + playerIdBytes.length;
        const buf = new ArrayBuffer(size);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        dv.setUint8(0, BIN.POS_V2);
        dv.setFloat32(1, p.x); dv.setFloat32(5, p.y); dv.setFloat32(9, p.z);
        dv.setFloat32(13, p.ry || 0);
        dv.setFloat32(17, p.ax || 0); dv.setFloat32(21, p.ay || 0); dv.setFloat32(25, p.az || 0);
        dv.setFloat32(29, p.vx || 0); dv.setFloat32(33, p.vy || 0); dv.setFloat32(37, p.vz || 0);
        dv.setUint16(41, (p.seq || 0) & 0xffff);
        let flags = 0, off = 44;
        if (p.alive !== undefined) { flags |= 1; dv.setUint8(off, p.alive ? 1 : 0); off += 1; }
        if (p.hp !== undefined) { flags |= 2; dv.setUint8(off, Math.max(0, Math.min(255, p.hp | 0))); off += 1; }
        if (p.team) { flags |= 4; dv.setUint8(off, p.team === 'red' ? 0 : 1); off += 1; }
        if (nameBytes) { flags |= 8; dv.setUint8(off, nameBytes.length); off += 1; u8.set(nameBytes, off); off += nameBytes.length; }
        if (charBytes) { flags |= 16; dv.setUint8(off, charBytes.length); off += 1; u8.set(charBytes, off); off += charBytes.length; }
        if (playerIdBytes) { flags |= 32; dv.setUint8(off, playerIdBytes.length); off += 1; u8.set(playerIdBytes, off); off += playerIdBytes.length; }
        dv.setUint8(43, flags);
        return u8;
    }

    encodeLegacyPosition(p) {
        let size = 30;
        const nameBytes = p.name ? encodeBinaryText(p.name) : null;
        const charBytes = p.charId ? encodeBinaryText(p.charId) : null;
        if (p.alive !== undefined) size += 1;
        if (p.hp !== undefined) size += 1;
        if (p.team) size += 1;
        if (nameBytes) size += 1 + nameBytes.length;
        if (charBytes) size += 1 + charBytes.length;
        const buffer = new ArrayBuffer(size);
        const dv = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        dv.setUint8(0, BIN.POS);
        dv.setFloat32(1, p.x); dv.setFloat32(5, p.y); dv.setFloat32(9, p.z);
        dv.setFloat32(13, p.ry || 0);
        dv.setFloat32(17, p.ax || 0); dv.setFloat32(21, p.ay || 0); dv.setFloat32(25, p.az || 0);
        let flags = 0;
        let offset = 30;
        if (p.alive !== undefined) { flags |= 1; dv.setUint8(offset++, p.alive ? 1 : 0); }
        if (p.hp !== undefined) { flags |= 2; dv.setUint8(offset++, Math.max(0, Math.min(255, p.hp | 0))); }
        if (p.team) { flags |= 4; dv.setUint8(offset++, p.team === 'red' ? 0 : 1); }
        if (nameBytes) {
            flags |= 8;
            dv.setUint8(offset++, nameBytes.length);
            bytes.set(nameBytes, offset);
            offset += nameBytes.length;
        }
        if (charBytes) {
            flags |= 16;
            dv.setUint8(offset++, charBytes.length);
            bytes.set(charBytes, offset);
        }
        dv.setUint8(29, flags);
        return bytes;
    }

    broadcastBinary(u8) {
        this.connections.forEach(conn => { if (conn.open) conn.send(u8); });
    }

    broadcastAllBinary(u8) {
        this.connections.forEach(conn => { if (conn.open) conn.send(u8); });
    }

    // ponytail: validate critical message fields to reject rogue peer data
    _validateMsg(data) {
        if (typeof data !== 'object' || !data.type) return false;
        switch (data.type) {
            case 'join':
                return typeof data.name === 'string'
                    && data.name.length > 0
                    && data.name.length <= 32
                    && (data.playerId === undefined || isSafeTargetId(data.playerId));
            case 'capabilities':
                return typeof data.positionV2 === 'boolean'
                    && typeof data.migrationVotes === 'boolean';
            case 'kick':
                return typeof data.name === 'string' && data.name.length > 0;
            case 'playerHit':
                return Boolean(normalizePlayerHitPacket(data));
            case 'ballState':
                return isValidBallPacket(data)
                    && (data.targetPlayerId === undefined || data.targetPlayerId === null
                        || isSafeTargetId(data.targetPlayerId))
                    && (data.targetPeerId === undefined || data.targetPeerId === null
                        || isSafeTargetId(data.targetPeerId));
            case 'scoreUpdate':
                return [data.red, data.blue, data.time, data.round].every(Number.isFinite)
                    && (!data.hotPotato || (
                        typeof data.hotPotato === 'object'
                        && typeof data.hotPotato.enabled === 'boolean'
                        && typeof data.hotPotato.active === 'boolean'
                        && Number.isFinite(data.hotPotato.remaining)
                        && data.hotPotato.remaining >= 0
                        && Number.isFinite(data.hotPotato.duration)
                        && data.hotPotato.duration >= 1
                        && data.hotPotato.duration <= 30
                        && Number.isSafeInteger(data.hotPotato.revision)
                        && data.hotPotato.revision >= 0
                        && String(data.hotPotato.holderId || '').length <= 128
                        && String(data.hotPotato.holderName || '').length <= 32
                        && ['', 'red', 'blue'].includes(data.hotPotato.holderTeam)
                    ));
            case 'attack':
                return typeof data.name === 'string'
                    && typeof data.x === 'number'
                    && typeof data.y === 'number'
                    && (data.ping === undefined || (Number.isFinite(data.ping) && data.ping >= 0 && data.ping <= 250));
            case 'position':
                return isValidPositionPacket(data);
            case 'chat':
                return typeof data.text === 'string' && data.text.length <= 500;
            case 'socialPresence':
                return typeof data.playerId === 'string'
                    && data.playerId.length <= 128
                    && (!data.name || (typeof data.name === 'string' && data.name.length <= 24))
                    && [data.x, data.y, data.z].every(value => Number.isFinite(value) && Math.abs(value) <= 100);
            case 'socialChat':
                return typeof data.playerId === 'string'
                    && data.playerId.length <= 128
                    && typeof data.name === 'string'
                    && data.name.length <= 24
                    && typeof data.text === 'string'
                    && data.text.length <= 160;
            case 'teamChange':
                return data.team === 'red' || data.team === 'blue';
            case 'lateJoinTeam':
                return data.team === 'red' || data.team === 'blue';
            case 'systemChat':
                return typeof data.text === 'string' && data.text.length <= 160;
            case 'partyReady':
                return typeof data.name === 'string'
                    && data.name.length <= 32
                    && typeof data.ready === 'boolean';
            case 'hostCheckpoint':
                return Array.isArray(data.roster)
                    && data.roster.length <= 64
                    && Boolean(normalizeHostCheckpoint(data.checkpoint || {}));
            case 'hostDeparture':
                return Array.isArray(data.roster)
                    && data.roster.length <= 64
                    && Boolean(normalizeHostCheckpoint(data.checkpoint || {}));
            case 'migrationRoster':
                return Array.isArray(data.roster)
                    && data.roster.length <= 64
                    && data.roster.every(player =>
                        !Object.hasOwn(player || {}, 'resumeToken')
                        && (player?.resumeProof === undefined
                            || isSafeResumeProof(player.resumeProof)));
            case 'hostMigrated':
                return Number.isSafeInteger(data.epoch)
                    && data.epoch > 0
                    && typeof data.candidateId === 'string'
                    && data.candidateId.length <= 128
                    && typeof data.hostPeerId === 'string'
                    && data.hostPeerId.length <= 128
                    && typeof data.attemptId === 'string'
                    && data.attemptId.length <= 128
                    && typeof data.rosterDigest === 'string'
                    && /^[a-f0-9]{16}$/.test(data.rosterDigest)
                    && (data.roster === undefined
                        || (Array.isArray(data.roster) && data.roster.length <= 64))
                    && (data.votes === undefined
                        || (Array.isArray(data.votes) && data.votes.length <= 64));
        case 'hostMigrationVote':
            return Number.isSafeInteger(data.epoch)
                && data.epoch > 0
                && isSafeTargetId(data.voterId)
                && isSafeTargetId(data.candidateId)
                && typeof data.attemptId === 'string'
                && data.attemptId.length <= 128
                && typeof data.rosterDigest === 'string'
                && /^[a-f0-9]{16}$/.test(data.rosterDigest);
        case 'migrationJoin':
            return Number.isSafeInteger(data.epoch)
                && typeof data.playerId === 'string'
                && data.playerId.length <= 128
                && typeof data.name === 'string'
                && data.name.length <= 32;
        case 'rematchReady':
            return isSafeMatchId(data.sourceMatchId)
                && typeof data.ready === 'boolean';
        case 'rematchState':
            return isSafeMatchId(data.sourceMatchId)
                && Array.isArray(data.requiredPlayerIds)
                && data.requiredPlayerIds.length <= 64
                && data.requiredPlayerIds.every(isSafeMatchId)
                && Array.isArray(data.readyPlayerIds)
                && data.readyPlayerIds.length <= 64
                && data.readyPlayerIds.every(isSafeMatchId)
                && typeof data.complete === 'boolean';
        case 'rematchStart':
            return isSafeMatchId(data.sourceMatchId)
                && isSafeMatchId(data.matchId);
        default:
                return true;
        }
    }

    handleMessage(data, peerId) {
        this._receivedPackets++;
        // ponytail: decode binary hot-path packets to plain objects
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            data = this._decodeBinary(data);
            if (!data) return;
        }
        // ponytail: reject malformed messages
        if (!this._validateMsg(data)) return;
        const sourceConn = this.connections.get(peerId);
        if (data.type === 'resumeChallenge') {
            this._handleResumeChallenge(data, peerId);
            return;
        }
        if (data.type === 'resumeResponse') {
            if (this.isHost) {
                const pending = this.pendingResumeHandshakes.get(peerId);
                if (pending) this._handleResumeResponse(pending.conn, data);
                else if (sourceConn) sourceConn.close();
            }
            return;
        }
        if (this.isHost && data.type !== 'join' && data.type !== 'migrationJoin'
            && data.type !== 'capabilities'
            && (!sourceConn || !sourceConn._admitted)) return;
        switch (data.type) {
            case 'capabilities':
                if (sourceConn) {
                    this.peerCapabilities.set(peerId, Object.freeze({
                        positionV2: data.positionV2 === true,
                        migrationVotes: data.migrationVotes === true
                    }));
                }
                break;
            case 'join':
                if (!this.isHost) break;
                {
                    const conn = this.connections.get(peerId);
                    if (!conn) break;
                    const playerId = conn._playerId;
                    if (data.playerId && data.playerId !== playerId) {
                        conn.close();
                        break;
                    }
                    if (conn._admitted) break;
                    conn._admitted = true;
                    this._updateMigrationRoster([
                        ...this.migrationRoster.values(),
                        {
                            playerId,
                            peerId,
                            name: conn._playerName,
                            team: 'red'
                        }
                    ]);
                    if (this.onPlayerJoin) {
                        this.onPlayerJoin(conn._playerName, playerId, data.avatar, peerId);
                    }
                    conn._sendWelcome?.();
                }
                break;
            case 'position':
                {
                    const trustedRelay = !this.isHost && peerId === this.hostConn?.peer;
                    const transportPeerId = trustedRelay && data.peerId ? data.peerId : peerId;
                    const boundPlayerId = this.peerToPlayerId.get(peerId);
                    if (!trustedRelay && boundPlayerId && data.playerId && data.playerId !== boundPlayerId) return;
                    const playerId = trustedRelay
                        ? (data.playerId || this.peerToPlayerId.get(transportPeerId) || transportPeerId)
                        : (boundPlayerId || data.playerId || peerId);
                    if (trustedRelay) this.peerToPlayerId.set(transportPeerId, playerId);
                if (data.seq !== undefined) {
                    const previous = this._lastPositionSeq.get(playerId);
                    if (previous !== undefined && !isNewerSequence(data.seq, previous)) return;
                    this._lastPositionSeq.set(playerId, data.seq);
                }
                    this.game.updateRemotePlayer(playerId, data, transportPeerId);
                }
                break;
            case 'attack':
                this.game.remoteAttack(this.peerToPlayerId.get(peerId) || data.playerId || peerId, data, peerId);
                break;
            case 'skillUse':
                if (this.isHost) this.game.handleSkillUse(this.peerToPlayerId.get(peerId) || data.playerId || peerId, data);
                break;
            case 'skillEffect':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.handleSkillEffect(data);
                }
                break;
            case 'announce':
                if (!this.isHost) this.game.applyAnnounce(data);
                break;
            case 'chat':
                if (this.isHost) {
                    const playerId = this.peerToPlayerId.get(peerId);
                    const player = this.game.remotePlayers.get(playerId);
                    if (!player) break;
                    const trusted = { ...data, name: player.name };
                    this.game.addChatMessage(trusted.name, trusted.text);
                    this.broadcast(trusted);
                } else if (peerId === this.hostConn?.peer && data.name !== this.playerName) {
                    this.game.addChatMessage(data.name, data.text);
                }
                break;
            case 'systemChat':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.addChatMessage('SERVER', data.text);
                }
                break;
            case 'partyReady':
                if (this.isHost) {
                    const playerId = this.peerToPlayerId.get(peerId);
                    const player = this.game?.remotePlayers?.get(playerId);
                    if (!player) break;
                    const ready = { type: 'partyReady', name: player.name, ready: data.ready };
                    this.onPartyReady?.(ready);
                    this.broadcast(ready);
                } else if (peerId === this.hostConn?.peer) {
                    this.onPartyReady?.(data);
                }
                break;
            case 'socialPresence':
                if (this.isHost) {
                    const boundPlayerId = this.peerToPlayerId.get(peerId);
                    if (boundPlayerId && data.playerId !== boundPlayerId) break;
                    if (!this._allowSocialPacket(peerId, data.type)) break;
                }
                this.onSocialPresence?.(data);
                if (this.isHost) this.broadcast(data);
                break;
            case 'socialChat':
                if (this.isHost) {
                    const boundPlayerId = this.peerToPlayerId.get(peerId);
                    if (boundPlayerId && data.playerId !== boundPlayerId) break;
                    if (!this._allowSocialPacket(peerId, data.type)) break;
                }
                this.onSocialChat?.(data);
                if (this.isHost) this.broadcast(data);
                break;
            case 'gameState':
                if (this.onGameState) this.onGameState(data);
                break;
            case 'lobbyState':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this._updateMigrationRoster(data.players);
                    this.game.applyLobbyState(data);
                }
                break;
            case 'hostCheckpoint':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    const checkpoint = normalizeHostCheckpoint(data.checkpoint);
                    if (checkpoint && checkpoint.epoch >= this.migrationEpoch
                        && (!this.latestHostCheckpoint
                            || checkpoint.sequence > this.latestHostCheckpoint.sequence
                            || checkpoint.epoch > this.latestHostCheckpoint.epoch)) {
                        this.latestHostCheckpoint = checkpoint;
                        this.migrationEpoch = checkpoint.epoch;
                    }
                    this._updateMigrationRoster(data.roster);
                }
                break;
            case 'migrationRoster':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this._updateMigrationRoster(data.roster);
                }
                break;
            case 'hostDeparture':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    const checkpoint = normalizeHostCheckpoint(data.checkpoint);
                    if (checkpoint) {
                        this.latestHostCheckpoint = checkpoint;
                        this.migrationEpoch = Math.max(this.migrationEpoch, checkpoint.epoch);
                    }
                    this._updateMigrationRoster(data.roster);
                    this._removeMigrationPeer(peerId);
                    this.connections.delete(peerId);
                    this.hostConn = null;
                    this._beginHostMigration();
                }
                break;
            case 'hostMigrationVote':
                this._recordMigrationVote(data, peerId);
                break;
            case 'hostMigrated':
                this._acceptHostMigration(data, peerId);
                break;
            case 'migrationJoin':
                if (this.isHost && data.epoch === this.migrationEpoch) {
                    const conn = this.connections.get(peerId);
                    if (!conn) break;
                    const expected = conn._playerId
                        || this.allowedMeshPeers.get(peerId)
                        || this.peerToPlayerId.get(peerId);
                    if (!expected || expected !== data.playerId
                        || !this._bindConnectionIdentity(conn, expected, data.name)) {
                        conn.close();
                        break;
                    }
                    conn._admitted = true;
                    this.peerToPlayerId.set(peerId, data.playerId);
                    this.playerConnections.set(data.playerId, conn);
                    const existing = this.migrationRoster.get(data.playerId);
                    this.migrationRoster.set(data.playerId, {
                        ...existing,
                        playerId: data.playerId,
                        peerId,
                        name: data.name,
                        team: this.game?.remotePlayers?.get(data.playerId)?.team || 'red'
                    });
                }
                break;
            case 'gameStart':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.startGameFromNetwork(data);
                }
                break;
            case 'playerHit':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    const hit = normalizePlayerHitPacket(data);
                    if (hit) this.game.applyPlayerHit(hit);
                }
                break;
            case 'ping':
                // Periyodik ping alındı → pong ile geri cevap ver.
                this._sendToConn(peerId, { type: 'pong', nonce: data.nonce, remoteTime: performance.now() });
                break;
            case 'pong':
                // RTT hesaplayan client tarafında kayıtlı nonce eşleşirse ping kayıt edilir.
                if (this._pingAwait && data.nonce === this._pingAwait.nonce) {
                    const now = performance.now();
                    const rtt = now - this._pingAwait.t;
                    this._lastPing = rtt;
                    if (typeof data.remoteTime === 'number') {
                        const sample = data.remoteTime - (this._pingAwait.t + now) * 0.5;
                        this._clockOffset += (sample - this._clockOffset) * 0.2;
                    }
                    this._pingAwait = null;
                }
                break;
            case 'ballState':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.updateBallFromNetwork(data);
                }
                break;
            case 'scoreUpdate':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.updateScoresFromNetwork(data);
                }
                break;
            case 'roundStart':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.startRoundFromNetwork(data);
                }
                break;
            case 'roundEnd':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.applyRoundEnd?.(data);
                }
                break;
            case 'welcome':
                if (this.isHost || peerId !== this.hostConn?.peer) break;
                if (Array.isArray(data.players)) {
                    this._updateMigrationRoster(
                        Array.isArray(data.migrationRoster)
                            ? data.migrationRoster
                            : data.players
                    );
                    data.players.forEach(player => {
                        const meshPeerId = player?.peerId;
                        const meshPlayerId = player?.playerId || meshPeerId;
                        if (meshPeerId && meshPlayerId) {
                            this.allowedMeshPeers.set(meshPeerId, meshPlayerId);
                            if (meshPeerId !== this.peer?.id
                                && meshPeerId !== this.hostConn?.peer) {
                                this.connectToPeer(meshPeerId, meshPlayerId);
                            }
                        }
                    });
                }
                if (Number.isSafeInteger(data.migrationEpoch)) {
                    this.migrationEpoch = Math.max(this.migrationEpoch, data.migrationEpoch);
                }
                {
                    const checkpoint = normalizeHostCheckpoint(data.checkpoint || {});
                    if (checkpoint) this.latestHostCheckpoint = checkpoint;
                }
                if (this.onGameState) this.onGameState(data);
                break;
            case 'ready':
                // ponytail: host is source of truth for ready set; clients mirror via broadcast
                if (data.ready) this.readyPlayers.add(data.name);
                else this.readyPlayers.delete(data.name);
                if (this.onReadyChange) this.onReadyChange(data.name, data.ready);
                break;
            case 'rematchReady':
                if (this.isHost) {
                    if (!this._allowSocialPacket(peerId, 'rematchReady')) break;
                    const playerId = this.peerToPlayerId.get(peerId);
                    if (playerId) {
                        this.onRematchReady?.({
                            playerId,
                            sourceMatchId: data.sourceMatchId,
                            ready: data.ready === true
                        });
                    }
                }
                break;
            case 'rematchState':
                if (!this.isHost && peerId === this.hostConn?.peer) this.onRematchState?.(data);
                break;
            case 'rematchStart':
                if (!this.isHost && peerId === this.hostConn?.peer) this.onRematchStart?.(data);
                break;
            case 'partyChat':
                if (this.onPartyChat) this.onPartyChat(data.name, data.text);
                break;
            case 'friendDM':
                if (this.onFriendDM) this.onFriendDM(data.from, data.text);
                break;
            case 'kick':
                // Host told us (or the named player) to leave the lobby.
                if (!this.isHost && (data.name === this.playerName || !data.name)) {
                    if (this.onKicked) this.onKicked(data.reason);
                    this.disconnect();
                }
                break;
            case 'teamChange':
                // Hem istemci hem host kendi callback'lerini çalıştırır.
                // Client sadece uygular, host ise uygulayıp yeni lobbyState'i broadcast eder.
                if (this.isHost) {
                    const playerId = this.peerToPlayerId.get(peerId);
                    const player = this.game.remotePlayers.get(playerId);
                    if (player) this.onTeamChange?.(player.name, data.team, playerId);
                } else if (peerId === this.hostConn?.peer) {
                    this.onTeamChange?.(data.name, data.team, data.playerId);
                }
                break;
            case 'lateJoinTeam':
                if (this.isHost) {
                    const playerId = this.peerToPlayerId.get(peerId);
                    if (playerId) this.onLateJoinTeam?.(playerId, data.team);
                }
                break;
            case 'remoteAttackAnim':
                if (!this.isHost) this.game.handleRemoteAttackAnim(data);
                break;
            case 'botSync':
                if (!this.isHost) this.game.applyBotSync(data);
                break;
case 'mapChange':
    if (!this.isHost && peerId === this.hostConn?.peer) this.game.applyMapChange(data);
    break;
case 'modeChange':
    if (!this.isHost && peerId === this.hostConn?.peer) this.game.applyModeChange(data);
    break;
            case 'powerUpState':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.applyPowerUpState(data);
                }
                break;
            case 'powerUpPickup':
                if (this.isHost) this.game.handlePowerUpPickup(data, peerId);
                break;
            case 'powerUpGranted':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.applyPowerUpGrant(data);
                }
                break;
            case 'celebrationStart':
                if (!this.isHost) this.game.applyCelebrationStart(data);
                break;
            case 'gameOver':
                if (!this.isHost) this.game.applyGameOver(data);
                break;
            case 'mapVoteOptions':
                if (!this.isHost && this.game.applyMapVoteOptions) this.game.applyMapVoteOptions(data);
                break;
            case 'mapVote':
                if (this.isHost && this.game.handleMapVote) this.game.handleMapVote(data, peerId);
                break;
            case 'mapVoteResult':
                if (!this.isHost && this.game.applyMapVoteResult) this.game.applyMapVoteResult(data);
                break;
            case 'newPeer':
                // Host tells us another client joined — establish mesh connection
                if (!this.isHost && peerId === this.hostConn?.peer
                    && data.peerId && data.peerId !== this.peer?.id && data.peerId !== this.hostConn?.peer) {
                    this.allowedMeshPeers.set(data.peerId, data.playerId || data.peerId);
                    this.connectToPeer(data.peerId, data.playerId);
                }
                break;
            case 'peerLeft':
                // Host tells us a client left — clean up mesh connection
                if (!this.isHost && peerId === this.hostConn?.peer && data.peerId) {
                    this.connections.get(data.peerId)?.close();
                    this.connections.delete(data.peerId);
                    this.allowedMeshPeers.delete(data.peerId);
                }
                break;
            case 'taunt':
                if (this.game) this.game.handleRemoteTaunt(data);
                break;
            case 'blackHoleSpawn':
                if (!this.isHost && this.game.spawnBlackHoleAt) this.game.spawnBlackHoleAt(data.x, data.y, data.z);
                break;
            case 'blackHoleDespawn':
                if (!this.isHost) this.game.clearBlackHoles();
                break;
            case 'splitBallSpawn':
                if (!this.isHost && this.game.spawnSplitBallAt) this.game.spawnSplitBallAt(data);
                break;
            case 'chaosState':
                if (!this.isHost && this.game.applyChaosState) this.game.applyChaosState(data);
                break;
            case 'lobbyClosed':
                // Lobby kapandı — ana menüye dön.
                this._manualDisconnect = true;
                if (!this.isHost && this.onHostLeft) this.onHostLeft();
                this.disconnect();
                break;
        }
    }

    // Host: drop a connection whose player metadata name matches.
    kickByName(name) {
        this.connections.forEach((conn, peerId) => {
            if (conn.metadata?.name === name) {
                try { conn.send({ type: 'kick', name }); } catch (e) {}
                setTimeout(() => conn.close(), 150);
                this.connections.delete(peerId);
            }
        });
    }

    setLobbyPassword(pw) { this.lobbyPassword = pw || ''; }

    // Establish a direct P2P mesh connection to another peer (non-host).
    async connectToPeer(peerId, playerId = peerId) {
        this.allowedMeshPeers.set(peerId, playerId);
        const active = this.connections.get(peerId);
        const replaceIncoming = active?._meshDirection === 'incoming'
            && this._prefersOutgoingMesh(peerId);
        if ((active && !replaceIncoming)
            || this.pendingConnections.has(peerId)
            || peerId === this.peer?.id
            || !this._prefersOutgoingMesh(peerId)) {
            return this.pendingConnections.get(peerId);
        }
        const conn = this.peer.connect(peerId, {
            metadata: { name: this.playerName, playerId: this.playerId, isMesh: true }
        });
        const pending = new Promise((resolve) => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            conn.on('open', () => {
                finish(this._installMeshConnection(
                    conn,
                    this.allowedMeshPeers.get(peerId) || playerId,
                    'outgoing'
                ));
            });
            conn.on('close', () => {
                if (this.connections.get(peerId) === conn) {
                    this.connections.delete(peerId);
                    this.peerToPlayerId.delete(peerId);
                    this._removeMigrationPeer(peerId, conn._playerId || playerId, conn);
                }
                finish(false);
            });
            conn.on('error', () => finish(false));
        });
        this.pendingConnections.set(peerId, pending);
        pending.finally(() => {
            if (this.pendingConnections.get(peerId) === pending) this.pendingConnections.delete(peerId);
        });
        return pending;
    }

    broadcast(data) {
        this.connections.forEach(conn => {
            if (conn.open) { conn.send(data); this._sentPackets++; }
        });
    }

    broadcastAll(data) {
        this.connections.forEach(conn => {
            if (conn.open) { conn.send(data); this._sentPackets++; }
        });
    }

    sendToHost(data) {
        if (this.hostConn && this.hostConn.open) { this.hostConn.send(data); this._sentPackets++; }
    }

    send(data) {
        if (this.isHost) {
            this.broadcast(data);
        } else {
            this.sendToHost(data);
        }
    }

    // Sync player pos — goes directly to ALL peers (mesh, skip host relay)
    sendPosition(position, rotation, extra = {}) {
        this._positionSeq = (this._positionSeq + 1) & 0xffff;
        const payload = {
            seq: this._positionSeq,
            playerId: this.playerId,
            x: position.x,
            y: position.y,
            z: position.z,
            ry: rotation,
            ...extra
        };
        if (!this.connections.size) {
            this.broadcastAllBinary(this.encodePosition(payload));
            return;
        }
        let legacyPacket = null;
        let v2Packet = null;
        for (const [peerId, conn] of this.connections) {
            if (!conn?.open) continue;
            const supportsV2 = this.peerCapabilities.get(peerId)?.positionV2 === true;
            const packet = supportsV2
                ? (v2Packet ||= this.encodePosition(payload))
                : (legacyPacket ||= this.encodeLegacyPosition(payload));
            conn.send(packet);
            this._sentPackets++;
        }
    }

    _sendToConn(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) { conn.send(data); this._sentPackets++; }
    }

    sendAttack(extra = {}) {
        this.send({ type: 'attack', ...extra });
    }

    sendSkillUse(extra = {}) {
        this.send({ type: 'skillUse', ...extra });
    }

    broadcastSkillEffect(skillId, playerId, peerId, pos) {
        if (!this.isHost) return;
        this.broadcast({ type: 'skillEffect', skill: skillId, playerId, peerId, pos });
    }

    // RTT ölçümü — nonce işaretlenir, periyodik olarak peer'a yollanır.
    sendPing() {
        if (!this.connected) return;
        this._pingAwait = { nonce: Math.random().toString(36).slice(2), t: performance.now() };
        this.send({ type: 'ping', nonce: this._pingAwait.nonce });
    }

    getPing() { return this._lastPing || 0; }
    getDiagnostics() {
        return {
            ping: this.getPing(),
            peers: this.connections.size,
            sent: this._sentPackets,
            received: this._receivedPackets,
            reconnecting: Boolean(this._reconnectTimer),
            migrating: this._migrationActive,
            migrationEpoch: this.migrationEpoch
        };
    }
    getClockOffset() { return this._clockOffset || 0; }

    broadcastBlackHoleSpawn(x, y, z) {
        if (!this.isHost) return;
        this.broadcast({ type: 'blackHoleSpawn', x, y, z });
    }

    broadcastBlackHoleDespawn() {
        if (!this.isHost) return;
        this.broadcast({ type: 'blackHoleDespawn' });
    }

    broadcastSplitBallSpawn(x, y, z, vx, vy, vz) {
        if (!this.isHost) return;
        this.broadcast({ type: 'splitBallSpawn', x, y, z, vx, vy, vz });
    }

    broadcastChaosState(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'chaosState', ...state });
    }

    broadcastBallState(ball, seq = undefined) {
        if (!this.isHost) return;
        const packetSeq = Number.isSafeInteger(seq)
            ? seq & 0xffff
            : ((this._ballSeq || 0) + 1) & 0xffff;
        this._ballSeq = packetSeq;
        const target = ball.targetPlayer || null;
        let targetPlayerId = target === this.game?.player ? this.playerId : null;
        if (!targetPlayerId) {
            for (const [playerId, player] of this.game?.remotePlayers || []) {
                if (player === target) {
                    targetPlayerId = playerId;
                    break;
                }
            }
        }
        this.broadcastBinary(this.encodeBallState({
            seq: packetSeq,
            x: ball.position.x,
            y: ball.position.y,
            z: ball.position.z,
            vx: ball.velocity.x,
            vy: ball.velocity.y,
            vz: ball.velocity.z,
            speed: ball.currentSpeed,
            active: ball.active,
            state: ball.state,
            targetName: target?.name || null,
            targetPlayerId,
            targetPeerId: target === this.game?.player ? this.peer?.id || null : target?.peerId || null,
            affix: ball.affix ? { id: ball.affix.id || ball.affix.name, color: ball.affix.color } : null
        }));
    }

    broadcastScores(scoreboard) {
        if (!this.isHost) return;
        this.broadcast({
            type: 'scoreUpdate',
            red: scoreboard.redScore,
            blue: scoreboard.blueScore,
            players: scoreboard.getPlayerStats(),
            time: scoreboard.timeRemaining,
            round: scoreboard.roundNum
        });
    }

    broadcastRoundStart(snapshot = {}) {
        if (!this.isHost) return;
        this.broadcast({
            type: 'roundStart',
            ...snapshot,
            overtimeExtends: Number.isSafeInteger(snapshot.overtimeExtends)
                ? Math.min(8, Math.max(0, snapshot.overtimeExtends))
                : 0,
            overtime: snapshot.overtime === true,
            overtimeTimer: Number.isFinite(snapshot.overtimeTimer)
                ? Math.min(3600, Math.max(0, snapshot.overtimeTimer))
                : 0,
            suddenDeathAnnounced: snapshot.suddenDeathAnnounced === true
        });
    }

    broadcastRoundEnd(snapshot = {}) {
        if (!this.isHost) return;
        this.broadcast({ type: 'roundEnd', ...snapshot });
    }

    sendRematchReady(sourceMatchId, ready = true) {
        if (this.isHost) {
            this.onRematchReady?.({
                playerId: this.playerId,
                sourceMatchId,
                ready: ready === true
            });
            return;
        }
        this.sendToHost({ type: 'rematchReady', sourceMatchId, ready: ready === true });
    }

    broadcastRematchState(snapshot = {}) {
        if (this.isHost) this.broadcast({ type: 'rematchState', ...snapshot });
    }

    broadcastRematchStart(snapshot = {}) {
        if (this.isHost) this.broadcast({ type: 'rematchStart', ...snapshot });
    }

    getConnectionCount() {
        return this.connections.size;
    }

    disconnect() {
        this._ensureIdentityMaps();
        this._manualDisconnect = true;
        this._clearMigrationTimers();
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        const conns = [...this.connections.values()];
        conns.forEach(conn => conn.close());
        this.connections.clear();
        this.peerToPlayerId.clear();
        this.playerConnections.clear();
        this.playerResumeTokens.clear();
        this.playerResumeProofs.clear();
        this._pendingResumeProofs.clear();
        this.pendingIdentityAdmissions.clear();
        for (const pending of this.pendingResumeHandshakes.values()) {
            clearTimeout(pending.timer);
        }
        this.pendingResumeHandshakes.clear();
        this.allowedMeshPeers.clear();
        this.peerCapabilities.clear();
        this.pendingConnections.clear();
        this.migrationRoster.clear();
        this.latestHostCheckpoint = null;
        this._migrationActive = false;
        this._migrationElection = null;
        this._lastMigrationAttemptEpoch = 0;
        this._socialRate.clear();
        if (this.peer) this.peer.destroy();
        this.peer = null;
        this.connected = false;
        this.isHost = false;
        this.isParty = false;
        this.readyPlayers.clear();
        // Notify the guest UI when the host connection drops abruptly.
        // Skipped during closeLobby() because that path already fired onHostLeft.
    }

    // Host: lobby kapanıyor — client'lara bildir, sonra bağlantıları kes.
    closeLobby(force = false) {
        if (!this.isHost) { this.disconnect(); return; }
        const survivors = [...this.connections.values()].filter(conn => conn?.open && conn._admitted);
        if (!force && survivors.length) {
            const checkpoint = this.publishHostCheckpoint(this.game?.snapshotState?.());
            if (checkpoint) {
                this.broadcast({
                    type: 'hostDeparture',
                    checkpoint,
                    roster: [...this.migrationRoster.values()]
                });
            }
        } else {
            this.broadcast({ type: 'lobbyClosed' });
        }
        this.disconnect();
    }

    // --- Party system ---

    async createParty(playerName) {
        const code = await this.hostGame(playerName);
        this.isParty = true;
        return code;
    }

    async joinParty(code, playerName) {
        await this.joinGame(code, playerName);
        this.isParty = true;
    }

    leaveParty() {
        this.disconnect();
        this.isParty = false;
        this.readyPlayers.clear();
    }

    getPartyMembers() {
        // ponytail: names from conn metadata may be sparse; host's own name prepended
        const members = [this.playerName];
        this.connections.forEach(conn => {
            const name = conn.metadata?.name;
            if (name) members.push(name);
        });
        return members;
    }

    // --- Lobby ready-check ---

    setReady(playerName, ready) {
        if (ready) this.readyPlayers.add(playerName);
        else this.readyPlayers.delete(playerName);
        this.broadcast({ type: 'ready', name: playerName, ready });
    }

    allReady(playerNames) {
        // ponytail: empty list = vacuously ready; caller guards empty lobby
        return playerNames.every(n => this.readyPlayers.has(n));
    }

    // --- Party chat ---

    sendPartyChat(text) {
        this.broadcast({ type: 'partyChat', name: this.playerName, text });
    }

    sendSocialPresence(position, rotation, skin = 'character-a') {
        if (!this.connected) return;
        this.send({
            type: 'socialPresence',
            playerId: this.playerId,
            name: this.playerName,
            skin,
            x: position.x,
            y: position.y,
            z: position.z,
            ry: rotation
        });
    }

    sendSocialChat(text) {
        const clean = String(text || '').trim().slice(0, 160);
        if (!clean || !this.connected) return false;
        this.send({
            type: 'socialChat',
            playerId: this.playerId,
            name: this.playerName,
            text: clean
        });
        return true;
    }

    // --- Friend DM ---

    sendDM(peerId, text) {
        this.sendTo(peerId, { type: 'friendDM', from: this.playerName, text });
    }

    sendTo(peerId, data) {
        const conn = this.connections.get(peerId) || this.hostConn;
        if (conn && conn.open) conn.send(data);
    }
}
