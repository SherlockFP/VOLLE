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
import { COSMETIC_TYPES, normalizeWearableLoadout } from './cosmetic-catalog.js';
import {
    NET_BIN,
    decodeBallQ,
    decodeBotSync,
    decodePositionBatch,
    decodePositionQ,
    encodeBallQ,
    encodeBotSync,
    encodePositionBatch,
    encodePositionQ,
    unwrapTime32
} from './net-codec.js';
import { ClockSync } from './net-clock.js';
import { TransitTracker } from './net-interp.js';
import { RelayHostLink, connectRelayClient, isRelayPeerId } from './relay-transport.js';

const COSMETIC_TYPE_IDS = Object.freeze(Object.keys(COSMETIC_TYPES));

const BIN = { BALL: 1, POS: 2, POS_V2: 3 };
const PLAYER_ID_KEY = 'dodgb.playerId';
const RESUME_TOKEN_KEY = 'dodgb.resumeToken';
// Cross-tab identity collision guard (lobby cross-tab bug): browsers CLONE sessionStorage
// when a tab is duplicated or a crashed session is restored, so two tabs can briefly hold
// the identical playerId+resumeToken pair. If both then talk to the same host, the host's
// resume-identity dedup (_beginIdentityAdmission) binds the second connection to a
// playerId it already reserved for another live peer and silently rejects it — join just
// "does nothing", no visible error. localStorage IS live-shared across tabs of the same
// origin (unlike sessionStorage), so it doubles as a liveness registry: each open tab
// stamps a heartbeat under its own id, and a freshly-loaded page only reuses its
// persisted sessionStorage id when no OTHER still-open tab currently claims it.
const IDENTITY_CLAIMS_KEY = 'dodgb.identityClaims';
const IDENTITY_CLAIM_TTL_MS = 15000;
const IDENTITY_CLAIM_HEARTBEAT_MS = 5000;
export const TARGET_ID_MAX_BYTES = 128;
export const NETWORK_WORLD_BOUND = 512;
export const NETWORK_SPEED_BOUND = 512;
// Ball rallies are intentionally uncapped in gameplay. Keep a separate,
// generous wire guard so legitimate long rallies pass while absurd/hostile
// Float32 payloads are still rejected.
export const NETWORK_BALL_SPEED_BOUND = 16384;
export const BALL_SKIN_ID_MAX_BYTES = 64;
const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BALL_SKIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const PLAYER_HIT_DAMAGE_MAX = 1000;
const PENDING_JOIN_AVATAR_MAX_LENGTH = 512 * 1024;
const isAvatarModel = value => value === undefined || value === 'classic' || value === 'slim';
const RESUME_TOKEN_MAX_BYTES = 256;
const RESUME_CHALLENGE_TTL_MS = 10_000;
const RESUME_PROOF_PATTERN = /^[a-f0-9]{64}$/;
const RESUME_NONCE_PATTERN = /^[a-f0-9]{64}$/;
const LOBBY_ADMISSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
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
const RECONNECT_TIMEOUT_MS = 5000;
export const MAX_LOBBY_SPECTATORS = 16;
// Everything a spectator transport may send the host. Anything else (position,
// attack, skillUse, teamChange, powerUpPickup, mapVote, ...) is gameplay authority
// a spectator must never have — whitelist, so new gameplay packets are blocked by default.
export const SPECTATOR_ALLOWED_TYPES = Object.freeze([
    'join', 'capabilities', 'ping', 'pong', 'chat', 'emote', 'spectatorSeat',
    // Asks the host to re-send the (already earned) lobby admission proof.
    'lobbyAdmissionRequest'
]);
const SPECTATOR_ALLOWED_TYPE_SET = new Set(SPECTATOR_ALLOWED_TYPES);
export function isSpectatorAllowedMessage(type) {
    return SPECTATOR_ALLOWED_TYPE_SET.has(type);
}
const EMOTE_ID_PATTERN = /^[a-z]{1,16}$/;
// netV3: quantized + host-clock-stamped position/ball/bot packets (js/net-codec.js) and
// batched spectator relays. Peers without it keep receiving the legacy encodings.
const PROTOCOL_CAPABILITIES = Object.freeze({
    positionV2: true,
    migrationVotes: true,
    netV3: true
});

function normalizeProtocolCapabilities(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.freeze({
        positionV2: value.positionV2 === true,
        migrationVotes: value.migrationVotes === true,
        ...(value.netV3 === true ? { netV3: true } : {})
    });
}

// Hot-path send tuning (see broadcastBallState / relayPositionToSpectators).
const BALL_MIN_INTERVAL_MS = 1000 / 30 - 4;   // floor: at least ~30 Hz while the ball flies
const BALL_KEYFRAME_EVERY = 15;               // target/affix/skin re-sent every Nth packet
const BALL_META_REDUNDANCY = 3;               // …and on the next N packets after a change
const BALL_DEVIATION_M = 0.05;                // send early when linear prediction drifts
const SPECTATOR_BATCH_MS = 1000 / 30;         // one batched relay per ~30 Hz tick
const CONGESTED_BUFFER_BYTES = 256 * 1024;    // skip superseded hot packets above this
const PLAYER_ID_EVERY = 32;                   // POS_Q repeats playerId every Nth packet
const PEER_OPEN_TIMEOUT_MS = 20000;           // signalling broker must answer within this
// Joining: a direct/TURN WebRTC link normally opens in 1-4 s even between
// countries; past this the client also tries the server WebSocket relay.
export const P2P_JOIN_FALLBACK_MS = 8000;
// Without a relay, give ICE its full budget before reporting a blocked network.
export const P2P_JOIN_TIMEOUT_MS = 30000;
// Admission proof: long enough for a relayed / lossy intercontinental link and a
// host whose lobby registration is still in flight; the client re-asks the host
// every LOBBY_PROOF_REQUEST_MS instead of failing on one lost/late packet.
export const LOBBY_PROOF_WAIT_MS = 20000;
export const LOBBY_PROOF_REQUEST_MS = 2500;
const RELAY_HOST_RETRY_MS = Object.freeze([1000, 3000, 8000, 15000]);
const PING_BURST = Object.freeze([60, 160, 300, 500, 800]);
const NET_ID_MAX = 250;

function connectionCongested(conn) {
    const buffered = conn?.dataChannel?.bufferedAmount;
    return (Number.isFinite(buffered) && buffered > CONGESTED_BUFFER_BYTES) || conn?._buffering === true;
}

function approxPacketBytes(data) {
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
    try { return JSON.stringify(data)?.length || 0; } catch (_) { return 0; }
}

export function isSafeTargetId(value) {
    return typeof value === 'string'
        && TARGET_ID_PATTERN.test(value)
        && UTF8_ENCODER.encode(value).byteLength <= TARGET_ID_MAX_BYTES;
}

export function isSafeBallSkinId(value) {
    return typeof value === 'string'
        && BALL_SKIN_ID_PATTERN.test(value)
        && UTF8_ENCODER.encode(value).byteLength <= BALL_SKIN_ID_MAX_BYTES;
}

function isBoundedFinite(value, bound) {
    return Number.isFinite(value) && Math.abs(value) <= bound;
}

function isValidPositionPacket(data) {
    return [data.x, data.y, data.z]
        .every(value => isBoundedFinite(value, NETWORK_WORLD_BOUND))
        && (data.t === undefined || (Number.isFinite(data.t) && data.t >= 0 && data.t < 0x100000000))
        && ['ry', 'ax', 'ay', 'az'].every(key =>
            data[key] === undefined || isBoundedFinite(data[key], NETWORK_WORLD_BOUND))
        && ['vx', 'vy', 'vz'].every(key =>
            data[key] === undefined || isBoundedFinite(data[key], NETWORK_SPEED_BOUND));
}

function isValidBallPacket(data) {
    return [data.x, data.y, data.z]
        .every(value => isBoundedFinite(value, NETWORK_WORLD_BOUND))
        && [data.vx, data.vy, data.vz]
            .every(value => isBoundedFinite(value, NETWORK_BALL_SPEED_BOUND))
        && Number.isFinite(data.speed)
        && data.speed >= 0
        && data.speed <= NETWORK_BALL_SPEED_BOUND
        && (data.t === undefined || (Number.isFinite(data.t) && data.t >= 0 && data.t < 0x100000000))
        && (data.skinId === undefined || isSafeBallSkinId(data.skinId));
}

function isValidOptionalVector(data, keys, bound) {
    const supplied = keys.filter(key => data[key] !== undefined);
    return supplied.length === 0
        || (supplied.length === keys.length
            && supplied.every(key => isBoundedFinite(data[key], bound)));
}

function isValidOptionalAim(data) {
    if (!isValidOptionalVector(data, ['ax', 'ay', 'az'], 1.5)) return false;
    if (data.ax === undefined) return true;
    const length = Math.hypot(data.ax, data.ay, data.az);
    return length >= 0.5 && length <= 1.5;
}

function isValidAttackPacket(data) {
    return typeof data.name === 'string'
        && data.name.length > 0
        && data.name.length <= 32
        && ['x', 'y', 'z'].every(key => isBoundedFinite(data[key], NETWORK_WORLD_BOUND))
        // Keep legacy packets that omit aim/snapshot fields valid, but never allow a
        // partial vector to leak a NaN into host-side steering or reconciliation.
        && isValidOptionalAim(data)
        && isValidOptionalVector(data, ['bx', 'by', 'bz'], NETWORK_WORLD_BOUND)
        && (data.action === undefined || data.action === 'slash' || data.action === 'stab')
        && (data.ping === undefined || (Number.isFinite(data.ping) && data.ping >= 0 && data.ping <= 250));
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

// Pure: drops claims whose heartbeat is older than ttlMs. Exported for tests.
export function pruneIdentityClaims(claims, now, ttlMs = IDENTITY_CLAIM_TTL_MS) {
    const pruned = {};
    for (const [id, ts] of Object.entries(claims || {})) {
        if (typeof ts === 'number' && Number.isFinite(ts) && now - ts < ttlMs) pruned[id] = ts;
    }
    return pruned;
}

function readIdentityClaims() {
    try {
        const raw = globalThis.localStorage?.getItem(IDENTITY_CLAIMS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
}

function writeIdentityClaims(claims) {
    try { globalThis.localStorage?.setItem(IDENTITY_CLAIMS_KEY, JSON.stringify(claims)); } catch (_) {}
}

function touchIdentityClaim(id, now = Date.now()) {
    if (!id) return;
    const claims = pruneIdentityClaims(readIdentityClaims(), now);
    claims[id] = now;
    writeIdentityClaims(claims);
}

function releaseIdentityClaim(id, now = Date.now()) {
    if (!id) return;
    const claims = pruneIdentityClaims(readIdentityClaims(), now);
    delete claims[id];
    writeIdentityClaims(claims);
}

// Resolves this tab's (playerId, resumeToken) pair. Reuses the sessionStorage-persisted
// pair unless it's currently claimed live by another open tab (a duplicate-tab clone of
// this one), in which case both are regenerated together so the new tab never collides
// with the tab it was copied from. releaseIdentityClaim() (armed below, browser-only)
// frees a tab's own claim on unload so a plain same-tab reload keeps resuming normally.
function resolveTabIdentity(now = Date.now()) {
    let playerId = null, resumeToken = null;
    try {
        playerId = globalThis.sessionStorage?.getItem(PLAYER_ID_KEY) || null;
        resumeToken = globalThis.sessionStorage?.getItem(RESUME_TOKEN_KEY) || null;
    } catch (_) {}
    const claims = pruneIdentityClaims(readIdentityClaims(), now);
    const collision = !!playerId && Object.hasOwn(claims, playerId);
    if (!playerId || !resumeToken || collision) {
        const gen = seed => globalThis.crypto?.randomUUID?.()
            || `${seed}-${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
        playerId = gen('player');
        resumeToken = gen('resume');
        try {
            globalThis.sessionStorage?.setItem(PLAYER_ID_KEY, playerId);
            globalThis.sessionStorage?.setItem(RESUME_TOKEN_KEY, resumeToken);
        } catch (_) {}
    }
    claims[playerId] = now;
    writeIdentityClaims(claims);
    return { playerId, resumeToken };
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

// Join failures carry a stable `code` so main.js can show a precise, localized
// reason instead of a generic "try again".
function joinError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
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

// warball.io: STUN-only fallback used whenever /api/rtc-config can't be reached
// (offline dev server, network hiccup, ancient browser) so local play never breaks.
export const FALLBACK_RTC_CONFIG = Object.freeze({
    iceServers: Object.freeze([Object.freeze({
        urls: Object.freeze([
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun.cloudflare.com:3478'
        ])
    })]),
    peer: Object.freeze({})
});
const RTC_CONFIG_TIMEOUT_MS = 4000;

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Exported for tests: validates the shape of a server-provided rtc-config
// response before it's trusted to configure a live Peer connection.
export function sanitizeRtcConfig(data) {
    if (!isPlainObject(data) || !Array.isArray(data.iceServers)) return null;
    const iceServers = data.iceServers.filter(entry =>
        isPlainObject(entry) && (typeof entry.urls === 'string' || Array.isArray(entry.urls)));
    if (!iceServers.length) return null;
    const peer = isPlainObject(data.peer) ? data.peer : {};
    return { iceServers, peer, relay: data.relay !== false };
}

// A hung /api/rtc-config (cold server, captive proxy) must not stall hosting or
// joining: fall back to public STUN after RTC_CONFIG_TIMEOUT_MS.
// authToken (account or guest lobby session) unlocks TURN credentials; without it
// the server only returns public STUN, so TURN can't be farmed anonymously.
export async function fetchRtcConfig(fetchImpl = globalThis.fetch, timeoutMs = RTC_CONFIG_TIMEOUT_MS, authToken = '') {
    if (typeof fetchImpl !== 'function') return FALLBACK_RTC_CONFIG;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    try {
        const init = {};
        if (controller) init.signal = controller.signal;
        if (authToken) init.headers = { Authorization: `Bearer ${authToken}` };
        const request = fetchImpl('/api/rtc-config', Object.keys(init).length ? init : undefined);
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => { controller?.abort(); resolve(null); }, timeoutMs);
        });
        const res = await Promise.race([request, timeout]);
        if (!res || !res.ok) return FALLBACK_RTC_CONFIG;
        const data = await Promise.race([res.json(), timeout]);
        return sanitizeRtcConfig(data) || FALLBACK_RTC_CONFIG;
    } catch {
        return FALLBACK_RTC_CONFIG;
    } finally {
        clearTimeout(timer);
    }
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
        const identity = resolveTabIdentity();
        this.playerId = identity.playerId;
        this.resumeToken = identity.resumeToken;
        // Browser only — absent globals no-op, same convention as other optional-
        // chaining hooks. Keeps this tab's claim alive and releases it on unload so a
        // plain same-tab reload doesn't get mistaken for a duplicate tab.
        if (globalThis.window?.addEventListener) {
            const heartbeat = globalThis.setInterval(
                () => touchIdentityClaim(this.playerId),
                IDENTITY_CLAIM_HEARTBEAT_MS
            );
            heartbeat.unref?.();
            globalThis.window.addEventListener('pagehide', () => releaseIdentityClaim(this.playerId));
        }
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
        this.lobbyAdmissionToken = '';
        this._lobbyAdmissionProof = '';
        this._lobbyAdmissionWaiters = [];
        this._lastKickReason = '';
        this.lobbyAdmissionFailure = '';
        // WebSocket relay fallback (js/relay-transport.js). main.js supplies the
        // lobby auth token (account or guest session); null disables the relay.
        this.relayAuthProvider = null;
        this.relayUrl = undefined;      // default: same origin /api/relay (tests override)
        this._serverRelayAvailable = true;
        this._relayHost = null;
        this._relayHostConfig = null;
        this._relayHostRetry = 0;
        this._relayHostTimer = null;
        this._hostTransport = 'p2p';
        this.onJoinProgress = null;   // ('connecting' | 'relay' | 'admitting')
        this.joinPassword = '';
        this.onReconnectState = null;
        this.onRematchReady = null;
        this.onRematchState = null;
        this.onRematchStart = null;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        this._reconnectTimer = null;
        this._reconnectAttempt = null;
        this._signalReconnectAttempts = 0;
        this._signalReconnectTimer = null;
        this._peerOpened = false;
        this._latestGameStart = null;
        this._gameStartRetryTimers = [];
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
        // Spectating (see SPECTATOR_ALLOWED_TYPES): client-side flag + host callbacks.
        this.spectatorMode = false;
        this.onSpectatorJoin = null;
        this.onSpectatorLeave = null;
        this.onEmote = null;          // (playerId, emoteId, fromSpectator) - emote wheel
        this.onSpectatorSeat = null;
        // --- netcode: clock sync, hot-path send state, debug counters (net_graph) ---
        this.clock = new ClockSync();
        this._pings = new Map();          // nonce -> local send time
        this._peerRtt = new Map();        // host: peerId -> smoothed RTT
        this._pingBurstTimers = [];
        this._ballTransit = new TransitTracker();
        this._ballSend = {
            valid: false, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false, state: '',
            targetPlayerId: undefined, targetPeerId: undefined, targetName: undefined,
            affixId: undefined, affixColor: undefined, skinId: undefined, count: 0, metaLeft: 0
        };
        this._specRelay = new Map();      // host: playerId -> latest relayed movement (batched)
        this._specRelayPool = [];
        this._specRelayLastFlush = 0;
        this._specRelayTimer = null;
        this._netIds = new Map();         // host: playerId -> { id, peerId }
        this._netIdVersion = 0;
        this._netIdsFromHost = new Map(); // spectator: id -> { playerId, peerId }
        this.peerOpenTimeoutMs = PEER_OPEN_TIMEOUT_MS;
        this.netGraphEnabled = false;
        this._netCounters = { inPackets: 0, outPackets: 0, inBytes: 0, outBytes: 0 };
        this._netRates = { at: 0, inPackets: 0, outPackets: 0, inBytes: 0, outBytes: 0, inPps: 0, outPps: 0, inBps: 0, outBps: 0 };
        this._spectatorFollow = null;
    }

    // --- netcode helpers -------------------------------------------------------------

    _supportsNetV3(peerId) {
        return this.peerCapabilities.get(peerId)?.netV3 === true;
    }

    // Host clock estimate in ms. The host IS the clock; everyone else applies the
    // filtered ping offset (js/net-clock.js).
    hostNow(localNow = performance.now()) {
        return this.isHost ? localNow : this.clock.hostNow(localNow);
    }

    _countOut(data) {
        const counters = this._netCounters;
        counters.outPackets++;
        if (data instanceof Uint8Array || data instanceof ArrayBuffer) counters.outBytes += data.byteLength;
        else if (this.netGraphEnabled) counters.outBytes += approxPacketBytes(data);
    }

    _countIn(data) {
        const counters = this._netCounters;
        counters.inPackets++;
        if (data instanceof Uint8Array || data instanceof ArrayBuffer) counters.inBytes += data.byteLength;
        else if (this.netGraphEnabled) counters.inBytes += approxPacketBytes(data);
    }

    // Client: ball packets are stamped with host time. Returns how late (+ms) this one
    // arrived versus the running mean transit so the renderer can place it on a
    // jitter-free timeline (same average timeline as arrival-time, minus the jitter).
    noteBallTransit(stamp) {
        if (!Number.isFinite(stamp) || this.isHost || !this.clock.synced) return 0;
        if (this._ballTransitEpoch !== this.clock.syncEpoch) {
            this._ballTransitEpoch = this.clock.syncEpoch;
            this._ballTransit.reset();
        }
        const now = this.hostNow();
        return this._ballTransit.note(now - unwrapTime32(stamp, now));
    }

    // Wire uint32 host-clock stamp → unwrapped host ms near `reference` (NaN if absent).
    stampToHostTime(stamp, reference = this.hostNow()) {
        return Number.isFinite(stamp) ? unwrapTime32(stamp, reference) : NaN;
    }

    // Client: host time before which ball packets predate the host seeing our deflect.
    predictionGuardHostTime() {
        if (this.isHost || !this.clock.synced) return 0;
        const oneWay = (this.clock.rtt || 0) / 2;
        const guard = Math.min(300, oneWay + 2 * (this.clock.jitter || 0) + 10);
        return this.hostNow() + guard;
    }

    getNetGraph(game = this.game) {
        const now = performance.now();
        const rates = this._netRates;
        const counters = this._netCounters;
        const elapsed = now - rates.at;
        if (!rates.at || elapsed >= 500) {
            if (rates.at && elapsed > 0) {
                const scale = 1000 / elapsed;
                rates.inPps = (counters.inPackets - rates.inPackets) * scale;
                rates.outPps = (counters.outPackets - rates.outPackets) * scale;
                rates.inBps = (counters.inBytes - rates.inBytes) * scale;
                rates.outBps = (counters.outBytes - rates.outBytes) * scale;
            }
            rates.at = now;
            rates.inPackets = counters.inPackets;
            rates.outPackets = counters.outPackets;
            rates.inBytes = counters.inBytes;
            rates.outBytes = counters.outBytes;
        }
        const interp = game?._netInterpStats || null;
        return {
            role: this.isHost ? 'host' : this.spectatorMode ? 'spectator' : 'client',
            ping: this.getPing(),
            jitter: this.isHost ? (interp?.jitter || 0) : Math.max(this.clock.jitter || 0, this._ballTransit.jitter || 0),
            lerp: interp?.lerp || 0,
            extrapolating: interp?.extrapolating || 0,
            entities: interp?.count || 0,
            clockOffset: this.clock.offset,
            clockSynced: this.isHost || this.clock.synced,
            inPps: rates.inPps,
            outPps: rates.outPps,
            inBps: rates.inBps,
            outBps: rates.outBps,
            peers: this.connections.size
        };
    }

    _startPingBurst() {
        this._pingBurstTimers.forEach(timer => clearTimeout(timer));
        this._pingBurstTimers = PING_BURST.map(delay => {
            const timer = setTimeout(() => this.sendPing(), delay);
            timer?.unref?.();
            return timer;
        });
    }

    // A new host means a new clock: resync from scratch and re-anchor transit trackers.
    _resetNetTimeline() {
        this.clock.reset();
        this._ballTransit.reset();
        this._ballSend.valid = false;
        this._pings.clear();
        this._peerRtt.clear();
        if (!this.isHost && this.hostConn) this._startPingBurst();
    }

    // Host: is this transport an admitted spectator (no team slot, no gameplay authority)?
    isSpectatorPeer(peerId) {
        return this.connections.get(peerId)?._spectator === true;
    }

    // Players only — spectators never count toward lobby size / team slots.
    getPlayerConnectionCount() {
        let count = 0;
        this.connections.forEach(conn => { if (conn?._spectator !== true) count++; });
        return count;
    }

    getSpectatorConnectionCount() {
        let count = 0;
        this.connections.forEach(conn => { if (conn?._spectator === true) count++; });
        return count;
    }

    // Host → spectators: spectators are not part of the P2P mesh, so the host forwards
    // every player movement report to them (players still mesh directly with each other).
    // netV3 spectators get ONE batched binary snapshot per ~30 Hz tick for all players
    // (js/net-codec.js encodePositionBatch); legacy spectators keep the per-player JSON.
    // Packets carrying rare identity fields (name/team/charId/knifeId change) still go out
    // as JSON so nothing a spectator used to receive is lost.
    relayPositionToSpectators(data, playerId, peerId, entity = null) {
        if (!this.isHost) return;
        let packet = null;
        let batched = false;
        const rare = data.name !== undefined || data.team !== undefined
            || data.charId !== undefined || data.knifeId !== undefined;
        this.connections.forEach((conn, connPeerId) => {
            if (conn?._spectator !== true || !conn.open || connPeerId === peerId) return;
            if (!rare && this._supportsNetV3(connPeerId)) {
                batched = true;
                return;
            }
            packet ||= {
                ...data, type: 'position', playerId, peerId,
                ...(entity ? { hp: entity.hp, alive: entity.alive } : {})
            };
            conn.send(packet);
            this._sentPackets++;
            this._countOut(packet);
        });
        if (batched) this._queueSpectatorRelay(data, playerId, peerId, entity);
    }

    _queueSpectatorRelay(data, playerId, peerId, entity) {
        let entry = this._specRelay.get(playerId);
        if (!entry) {
            entry = this._specRelayPool.pop() || {};
            this._specRelay.set(playerId, entry);
        }
        entry.playerId = playerId;
        entry.peerId = peerId;
        entry.seq = data.seq;
        entry.t = data.t;
        entry.x = data.x; entry.y = data.y; entry.z = data.z;
        entry.ry = data.ry;
        entry.ax = data.ax; entry.ay = data.ay; entry.az = data.az;
        entry.vx = data.vx; entry.vy = data.vy; entry.vz = data.vz;
        entry.hp = entity ? entity.hp : data.hp;
        entry.alive = entity ? entity.alive : data.alive;
        const now = performance.now();
        if (now - this._specRelayLastFlush >= SPECTATOR_BATCH_MS) {
            this._flushSpectatorRelay(now);
        } else if (!this._specRelayTimer) {
            this._specRelayTimer = setTimeout(() => {
                this._specRelayTimer = null;
                this._flushSpectatorRelay(performance.now());
            }, Math.max(1, SPECTATOR_BATCH_MS - (now - this._specRelayLastFlush)));
        }
    }

    _netIdFor(playerId, peerId) {
        let record = this._netIds.get(playerId);
        if (record && record.peerId === peerId) return record.id;
        if (!record && this._netIds.size >= NET_ID_MAX) {
            this._netIds.clear();
        }
        const used = new Set([...this._netIds.values()].map(entry => entry.id));
        let id = record?.id || 1;
        while (!record && used.has(id)) id++;
        record = { id, peerId };
        this._netIds.set(playerId, record);
        this._netIdVersion++;
        return id;
    }

    _flushSpectatorRelay(now = performance.now()) {
        if (this._specRelayTimer) {
            clearTimeout(this._specRelayTimer);
            this._specRelayTimer = null;
        }
        if (!this.isHost || !this._specRelay.size) return false;
        this._specRelayLastFlush = now;
        const entries = [];
        for (const entry of this._specRelay.values()) {
            if (!isSafeTargetId(entry.playerId) || !isSafeTargetId(entry.peerId)) continue;
            entry.netId = this._netIdFor(entry.playerId, entry.peerId);
            entries.push(entry);
        }
        let batch = null;
        let idTable = null;
        this.connections.forEach((conn, connPeerId) => {
            if (conn?._spectator !== true || !conn.open || !this._supportsNetV3(connPeerId)) return;
            if (conn._netIdVersion !== this._netIdVersion) {
                idTable ||= {
                    type: 'netIds',
                    ids: [...this._netIds.entries()].map(([playerId, record]) => [record.id, playerId, record.peerId])
                };
                conn.send(idTable);
                conn._netIdVersion = this._netIdVersion;
                this._sentPackets++;
                this._countOut(idTable);
            }
            if (!entries.length || connectionCongested(conn)) return;
            batch ||= encodePositionBatch(entries);
            conn.send(batch);
            this._sentPackets++;
            this._countOut(batch);
        });
        for (const entry of this._specRelay.values()) this._specRelayPool.push(entry);
        this._specRelay.clear();
        return Boolean(batch);
    }

    async initPeer() {
        // Same lobby session the relay uses (bounded: a slow guest-session mint
        // must not delay hosting/joining — STUN-only is the fallback).
        let authToken = '';
        try {
            authToken = await Promise.race([
                Promise.resolve(this.relayAuthProvider?.()),
                new Promise(resolve => setTimeout(() => resolve(''), 3000))
            ]) || '';
        } catch (_) {
            authToken = '';
        }
        const rtcConfig = await fetchRtcConfig(globalThis.fetch, RTC_CONFIG_TIMEOUT_MS, typeof authToken === 'string' ? authToken : '');
        this._serverRelayAvailable = rtcConfig.relay !== false;
        return new Promise((resolve, reject) => {
            this._peerOpened = false;
            // P2P_HOST_FIXES.md: a broker that accepts the socket but never answers left
            // hostGame/joinGame pending forever. PeerJS normally opens in < 2 s; the
            // deadline is deliberately generous so slow networks are not cut off.
            let openTimer = null;
            const settleTimeout = () => { clearTimeout(openTimer); openTimer = null; };
            const peerOptions = { debug: 0 };
            if (rtcConfig.iceServers?.length) {
                peerOptions.config = { iceServers: rtcConfig.iceServers };
            }
            if (rtcConfig.peer?.host) peerOptions.host = rtcConfig.peer.host;
            if (rtcConfig.peer?.port) peerOptions.port = rtcConfig.peer.port;
            if (rtcConfig.peer?.path) peerOptions.path = rtcConfig.peer.path;
            if (rtcConfig.peer?.secure !== undefined) peerOptions.secure = rtcConfig.peer.secure;
            const peer = new Peer(undefined, peerOptions);
            this.peer = peer;
            const timeoutMs = Number(this.peerOpenTimeoutMs);
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                openTimer = setTimeout(() => {
                    openTimer = null;
                    if (this._peerOpened || this.peer !== peer) return;
                    try { peer.destroy?.(); } catch (_) {}
                    if (this.peer === peer) this.peer = null;
                    reject(new Error('Could not reach the matchmaking server — check your connection and try again.'));
                }, timeoutMs);
            }
            peer.on('open', id => {
                settleTimeout();
                this.roomCode = id;
                this.connected = true;
                this._peerOpened = true;
                this._signalReconnectAttempts = 0;
                resolve(id);
            });
            peer.on('error', err => {
                // PeerJS can lose its *signalling* WebSocket after WebRTC data
                // channels are established. Rejecting only matters before open;
                // tearing down a live P2P match here would be a false disconnect.
                if (!this._peerOpened) {
                    settleTimeout();
                    console.error('Peer error:', err);
                    reject(err);
                    return;
                }
                console.warn('Peer signalling error; keeping live data channels:', err);
                this._reconnectSignalling();
            });
            this.peer.on('disconnected', () => this._reconnectSignalling());
            // ALL peers accept incoming connections (mesh: P2P position relay)
            this.peer.on('connection', (conn) => this._onIncomingConnection(conn));
        });
    }

    _reconnectSignalling() {
        if (this._manualDisconnect || !this.peer || this._signalReconnectTimer) return;
        const attempt = ++this._signalReconnectAttempts;
        this._signalReconnectTimer = setTimeout(() => {
            this._signalReconnectTimer = null;
            if (this._manualDisconnect || !this.peer) return;
            try {
                this.peer.reconnect?.();
            } catch (_) {
                if (attempt < 3) this._reconnectSignalling();
            }
        }, reconnectDelay(attempt));
    }

    async hostGame(playerName) {
        this._cancelReconnect();
        this._resetLobbyAdmissionProof();
        this.disableRelayHost();
        this._hostTransport = 'p2p';
        this.playerName = playerName;
        this.isHost = true;
        this.spectatorMode = false;
        try {
            await this.initPeer();
        } catch (error) {
            // Peer never opened. Drop the host claim instead of leaving the session as
            // "host with no connection" — main.js's two simulation loops split on exactly
            // that pair (RAF skips hosts, bg loop skips disconnected), so a stuck flag
            // freezes every later solo/bot match in this tab.
            this.isHost = false;
            throw error;
        }
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

    joinGame(roomCode, playerName, password = '', options = {}) {
        if (this._joinPromise) return this._joinPromise;
        // Spectators join without a team slot; the host re-derives the role from the
        // transport metadata and never trusts later packets to change it.
        this.spectatorMode = options?.spectator === true;
        // Normalize here, not at the call sites: a pasted room code routinely carries
        // surrounding whitespace/newlines, and peer.connect() on a padded id silently
        // targets a peer that does not exist.
        const promise = this._joinGame(String(roomCode ?? '').trim(), playerName, password);
        this._joinPromise = promise;
        promise.finally(() => {
            if (this._joinPromise === promise) this._joinPromise = null;
        }).catch(() => {});
        return promise;
    }

    async _joinGame(roomCode, playerName, password = '') {
        this._cancelReconnect();
        this._resetLobbyAdmissionProof();
        this.disableRelayHost();
        this.playerName = playerName;
        this.isHost = false;
        this.hostRoomCode = roomCode;
        this.joinPassword = password;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        this._migrationActive = false;
        this._lastKickReason = '';
        this._hostTransport = 'p2p';
        await this.initPeer();
        if (this.game?.player && this.peer) this.game.player.peerId = this.peer.id;

        const metadata = this._hostJoinMetadata(playerName, password);
        const relayUsable = this._relayUsable();
        this.onJoinProgress?.('connecting');
        let conn;
        try {
            conn = await this._connectHostP2P(roomCode, metadata, relayUsable ? P2P_JOIN_FALLBACK_MS : P2P_JOIN_TIMEOUT_MS);
        } catch (p2pError) {
            if (!relayUsable || this._manualDisconnect || this.hostRoomCode !== roomCode) throw p2pError;
            // WebRTC could not reach the host (NAT / firewall / host off the
            // signalling broker): carry the same session over the server relay.
            this.onJoinProgress?.('relay');
            try {
                conn = await this._connectHostRelay(roomCode, metadata);
            } catch (relayError) {
                const reason = relayError?.code || '';
                if (reason === 'no_host' || reason === 'lobby_unavailable') {
                    throw joinError('Lobby not found — it may have closed already.', 'lobby_not_found');
                }
                if (reason === 'account_required') throw joinError('Ranked lobbies need an account.', 'account_required');
                if (reason === 'full') throw joinError('Lobby is full.', 'lobby_full');
                throw p2pError;
            }
            if (this._manualDisconnect || this.hostRoomCode !== roomCode) {
                conn.close();
                throw joinError('Join cancelled.', 'cancelled');
            }
        }
        this._attachHostConnection(roomCode, conn);
    }

    _hostJoinMetadata(playerName = this.playerName, password = this.joinPassword) {
        return {
            name: playerName,
            password,
            playerId: this.playerId,
            capabilities: PROTOCOL_CAPABILITIES,
            ...(this.spectatorMode ? { spectator: true } : {})
        };
    }

    _relayUsable() {
        return typeof this.relayAuthProvider === 'function'
            && this._serverRelayAvailable !== false
            && typeof globalThis.WebSocket === 'function';
    }

    // Resolves with the OPEN PeerJS DataConnection to the host, or rejects with a
    // coded Error: 'lobby_not_found' (host not on the broker), 'p2p_failed'
    // (ICE / negotiation failed), 'p2p_timeout' (no path within timeoutMs).
    _connectHostP2P(roomCode, metadata, timeoutMs) {
        const peer = this.peer;
        const conn = peer.connect(roomCode, { metadata });
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const settle = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                removeConnectionListener(peer, 'error', onPeerError);
                if (!error) {
                    resolve(conn);
                    return;
                }
                try { conn?.close?.(); } catch (_) {}
                reject(error);
            };
            // PeerJS reports an unreachable room code (host gone, lobby expired, typo) as a
            // `peer-unavailable` error on the Peer — never on the connection, whose 'open'
            // and 'error' both stay silent. Without this the join promise never settles and
            // the Join button hangs forever with no message, which reads as "can't join".
            const onPeerError = err => {
                if (err?.type !== 'peer-unavailable') return;
                settle(joinError('Lobby not found — it may have closed already.', 'lobby_not_found'));
            };
            peer.on('error', onPeerError);
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                timer = setTimeout(() => settle(joinError(
                    'Could not reach the host. Your network or the host\'s may be blocking direct connections.',
                    'p2p_timeout'
                )), timeoutMs);
            }
            conn.on('open', () => settle(null));
            conn.on('close', () => {
                if (!settled) {
                    settle(joinError('The host closed the connection.', 'p2p_failed'));
                    return;
                }
                // Host went away (closed game / left lobby) → reconnect / migrate.
                if (this.connections.get(roomCode) === conn) this.connections.delete(roomCode);
                if (this.hostConn === conn) this.hostConn = null;
                this._scheduleReconnect();
            });
            conn.on('error', err => {
                if (settled) return;
                const error = joinError(err?.message || 'Connection to the host failed.', 'p2p_failed');
                error.cause = err;
                settle(error);
            });
        });
    }

    async _connectHostRelay(roomCode, metadata) {
        const token = await this.relayAuthProvider?.();
        if (!token) throw joinError('Sign in or continue as guest to use the relay.', 'relay_unauthorized');
        const conn = await connectRelayClient({ url: this.relayUrl, code: roomCode, token, metadata });
        conn.on('close', () => {
            if (this.connections.get(roomCode) === conn) this.connections.delete(roomCode);
            if (this.hostConn === conn) this.hostConn = null;
            this._scheduleReconnect();
        });
        return conn;
    }

    _attachHostConnection(roomCode, conn) {
        this._reconnectAttempts = 0;
        this._hostTransport = conn?._relay === true ? 'relay' : 'p2p';
        this.hostConn = conn;
        this.connections.set(roomCode, conn);
        this.setupDataHandlers(conn);
        this._resetNetTimeline();
        this.onJoinProgress?.('admitting');
    }

    isRelayed() {
        return this._hostTransport === 'relay';
    }

    // Route incoming connections: new player join (host) vs P2P mesh (non-host peers)
    _scheduleReconnect() {
        if (this._manualDisconnect || this.isHost || !this.peer
            || this._reconnectTimer || this._reconnectAttempt || this._migrationActive) return;
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

    // A session that joined through the relay reconnects through it too: the
    // WebRTC path to that host already proved unreachable.
    _reconnectViaRelay() {
        const peer = this.peer;
        const roomCode = this.hostRoomCode;
        let cancelled = false;
        const attempt = { cancel: () => { cancelled = true; } };
        this._reconnectAttempt = attempt;
        const sameSession = () => !cancelled && this.peer === peer && this.hostRoomCode === roomCode
            && !this._manualDisconnect && !this.isHost && !this._migrationActive;
        this._connectHostRelay(roomCode, this._hostJoinMetadata()).then(conn => {
            if (this._reconnectAttempt === attempt) this._reconnectAttempt = null;
            if (!sameSession()) { conn.close(); return; }
            this._reconnectAttempts = 0;
            this._hostTransport = 'relay';
            this.hostConn = conn;
            this.connections.set(roomCode, conn);
            this.setupDataHandlers(conn);
            this._resetNetTimeline();
            if (this._spectatorFollow) {
                this._spectatorFollow = null;
                this._manualDisconnect = false;
            }
            this.onReconnectState?.('connected', 0);
        }, () => {
            if (this._reconnectAttempt === attempt) this._reconnectAttempt = null;
            if (sameSession()) this._scheduleReconnect();
        });
    }

    _reconnectOnce() {
        if (this._manualDisconnect || this.isHost || this._migrationActive
            || this._reconnectAttempt || !this.peer || !this.hostRoomCode) return;
        if (this._hostTransport === 'relay' && this._relayUsable()) {
            this._reconnectViaRelay();
            return;
        }
        const peer = this.peer;
        const roomCode = this.hostRoomCode;
        let conn;
        let timer;
        let pending = true;
        let closed = false;
        const sameSession = () => this.peer === peer && this.hostRoomCode === roomCode
            && !this._manualDisconnect && !this.isHost && !this._migrationActive;
        const closeConnection = () => {
            try { conn?.close(); } catch (_) {}
        };
        const cleanup = () => {
            if (!pending) return;
            pending = false;
            clearTimeout(timer);
            removeConnectionListener(peer, 'error', onPeerError);
            if (this._reconnectAttempt === attempt) this._reconnectAttempt = null;
        };
        const finish = retry => {
            if (closed) return;
            const active = this._reconnectAttempt === attempt || this.hostConn === conn;
            closed = true;
            cleanup();
            if (this.connections.get(roomCode) === conn) this.connections.delete(roomCode);
            if (this.hostConn === conn) this.hostConn = null;
            closeConnection();
            if (retry && active && sameSession()) this._scheduleReconnect();
        };
        const onPeerError = err => {
            // PeerJS reports EXPIRE on Peer, not DataConnection. Ignore errors
            // for mesh peers sharing this broker; the deadline covers silence.
            if (err?.type === 'peer-unavailable'
                && (err.peer === roomCode || err.message === `Could not connect to peer ${roomCode}`)) {
                finish(true);
            }
        };
        const attempt = { cancel: () => finish(false) };
        this._reconnectAttempt = attempt;
        peer.on('error', onPeerError);
        timer = setTimeout(() => finish(true), RECONNECT_TIMEOUT_MS);
        try {
            conn = peer.connect(roomCode, {
                metadata: {
                    name: this.playerName,
                    password: this.joinPassword,
                    playerId: this.playerId,
                    capabilities: PROTOCOL_CAPABILITIES,
                    ...(this.spectatorMode ? { spectator: true } : {})
                }
            });
        } catch (_) {
            finish(true);
            return;
        }
        // connect() can fail synchronously through Peer or return no transport
        // while signalling reconnects. Neither may strand the retry loop.
        if (!conn || closed) {
            finish(true);
            closeConnection();
            return;
        }
        conn.on('open', () => {
            if (closed) { closeConnection(); return; }
            if (!sameSession()) { finish(false); return; }
            if (!pending) return;
            cleanup();
            this._reconnectAttempts = 0;
            this.hostConn = conn;
            this.connections.set(roomCode, conn);
            this.setupDataHandlers(conn);
            this._resetNetTimeline();
            if (this._spectatorFollow) {
                // Spectator re-attached to the migrated host: the normal resume/welcome
                // handshake takes over from here.
                this._spectatorFollow = null;
                this._manualDisconnect = false;
            }
            this.onReconnectState?.('connected', 0);
        });
        // Keep these transport-local guards after cleanup: late open/error/close
        // events cannot resurrect an expired attempt or schedule another retry.
        conn.on('close', () => finish(true));
        conn.on('error', () => finish(true));
    }

    _cancelReconnect() {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        this._reconnectAttempt?.cancel();
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
                // An identity that is already bound may still be RE-CLAIMED by its
                // owner (page reload, dropped link, retry after a failed join): the
                // resume-token challenge below proves it, and _beginIdentityAdmission
                // then retires the stale transport. Without a reserved proof there is
                // nothing to prove against, so a live identity stays protected.
                if (this.pendingIdentityAdmissions.has(playerId)
                    || (this.playerConnections.has(playerId) && !this._canReclaimIdentity(playerId))) {
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

    _canReclaimIdentity(playerId) {
        return this.isHost === true
            && this.playerResumeProofs.has(playerId)
            && isSafeResumeProof(this.playerResumeProofs.get(playerId));
    }

    // The same player proved its resume token on a new transport: drop the old
    // one silently (no leave/join churn, the player keeps team, score and slot)
    // and let the new transport be admitted in its place.
    _retireReplacedConnection(oldConn, playerId) {
        if (this.playerConnections.get(playerId) === oldConn) this.playerConnections.delete(playerId);
        if (this.connections.get(oldConn.peer) === oldConn) {
            this.connections.delete(oldConn.peer);
            this.peerToPlayerId.delete(oldConn.peer);
        }
        this._lastPositionSeq.delete(playerId);
        this.peerCapabilities.delete(oldConn.peer);
        const entry = this.migrationRoster.get(playerId);
        if (entry?.peerId === oldConn.peer) this.migrationRoster.delete(playerId);
        try {
            if (oldConn.open !== false && !oldConn.closed) {
                oldConn.send({ type: 'kick', name: oldConn._playerName || 'Player', reason: 'replaced' });
            }
        } catch (_) {}
        setTimeout(() => { try { oldConn.close(); } catch (_) {} }, 150);
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
            // Spectators stay out of the migration roster: they are not mesh peers,
            // never host candidates, and must not appear as players to anyone.
            // Relay clients neither: their server-assigned id is no WebRTC endpoint.
            if (conn._spectator !== true && conn._relay !== true) {
                this._updateMigrationRoster([
                    ...this.migrationRoster.values(),
                    { playerId, peerId: conn.peer, name, team: 'red' }
                ]);
                this.broadcast({
                    type: 'migrationRoster',
                    roster: [...this.migrationRoster.values()]
                });
            }
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
            ...(this.lobbyAdmissionToken ? { admissionToken: this.lobbyAdmissionToken } : {}),
            players: this.game.getPlayerList(),
            state: this.game.state,
            mode: this.game.mode?.id,
            map: this.game?.arena?.mapId,
            round: this.game.scoreboard?.roundNum,
            red: this.game.scoreboard?.redScore,
            blue: this.game.scoreboard?.blueScore,
            time: this.game.scoreboard?.timeRemaining,
            snapshot: this._withBallAppearance(this.game.snapshotState?.() || {}),
            migrationRoster: [...this.migrationRoster.values()],
            migrationEpoch: this.migrationEpoch,
            checkpoint: this.latestHostCheckpoint,
            spectators: this.game.getSpectatorList?.() || [],
            allowCrossCourt: this.game.allowCrossCourt === true,
            ...(conn._spectator === true ? { spectator: true } : {})
        });
        if (this._latestGameStart && conn.open) {
            try { conn.send(this._latestGameStart); } catch (_) {}
        }
        conn.on('close', () => {
            if (this.connections.get(conn.peer) === conn) {
                this.connections.delete(conn.peer);
                this.peerToPlayerId.delete(conn.peer);
            }
            if (this.playerConnections.get(playerId) !== conn) return;
            this.playerConnections.delete(playerId);
            this._lastPositionSeq.delete(playerId);
            this._removeMigrationPeer(conn.peer, playerId, conn);
            if (conn._spectator === true) this.onSpectatorLeave?.(playerId, conn.peer);
            else if (this.onPlayerLeave) this.onPlayerLeave(playerId, conn.peer);
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
            ...(data.avatar === undefined ? {} : { avatar: data.avatar }),
            ...(isAvatarModel(data.avatarModel) && data.avatarModel !== undefined ? { avatarModel: data.avatarModel } : {})
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
        const customAvatar = globalThis.window?.__store?.get?.('customAvatar');
        const avatar = customAvatar?.dataURL || '';
        const avatarModel = customAvatar?.model === 'slim' ? 'slim' : 'classic';
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
                avatarModel,
                resumeToken: token,
                capabilities: PROTOCOL_CAPABILITIES,
                ...(this.spectatorMode ? { spectator: true } : {})
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
            const staleConnection = this.playerConnections.get(playerId);
            if (staleConnection && staleConnection !== conn) {
                // Only an owner who just proved the RESERVED resume token may take
                // over a still-bound identity; everyone else is a duplicate.
                if (expectedProof === null || !this._canReclaimIdentity(playerId)) {
                    if (this.pendingIdentityAdmissions.get(playerId) === admission) {
                        this.pendingIdentityAdmissions.delete(playerId);
                    }
                    this._rejectIdentityConnection(conn, name);
                    return false;
                }
                this._retireReplacedConnection(staleConnection, playerId);
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
                this._sendLobbyAdmissionProof(conn);
                const joinArgs = [name, playerId, earlyJoin.avatar, conn.peer];
                if (earlyJoin.avatarModel === 'slim') joinArgs.push('slim');
                try {
                    if (conn._spectator === true) this.onSpectatorJoin?.(name, playerId, conn.peer);
                    else this.onPlayerJoin?.(...joinArgs);
                } catch (_) {
                    // Gameplay/UI callbacks must not invalidate transport admission.
                }
                try { conn._sendWelcome?.(); } catch (_) {}
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
            && isAvatarModel(data.avatarModel)
            && normalizeProtocolCapabilities(data.capabilities)
            && (data.spectator === undefined || typeof data.spectator === 'boolean');
        if (!valid) {
            conn.close();
            return false;
        }
        if (this.lobbyPassword && (data.password !== this.lobbyPassword
            || conn.metadata?.password !== this.lobbyPassword)) {
            // Tell the joiner why instead of a silent close (it used to surface as
            // "Lobby admission proof was not received").
            this._rejectIdentityConnection(conn, name, 'password');
            return false;
        }
        const previous = this.playerConnections.get(playerId);
        const proofReserved = this.playerResumeProofs.has(playerId);
        const expectedProof = this.playerResumeProofs.get(playerId);
        const pendingAdmission = this.pendingIdentityAdmissions.get(playerId);
        if ((previous && previous !== conn && !this._canReclaimIdentity(playerId))
            || (pendingAdmission && pendingAdmission.conn !== conn)) {
            this._rejectIdentityConnection(conn, name);
            return;
        }
        if (proofReserved && !isSafeResumeProof(expectedProof)) {
            this._rejectIdentityConnection(conn, name);
            return;
        }
        // Either signal only ever lowers privileges, so honour whichever is set.
        if (conn.metadata?.spectator === true || data.spectator === true) {
            if (this.getSpectatorConnectionCount() >= MAX_LOBBY_SPECTATORS) {
                this._rejectIdentityConnection(conn, name, 'spectators_full');
                return;
            }
            try {
                Object.defineProperty(conn, '_spectator', {
                    value: true, enumerable: false, writable: false, configurable: false
                });
            } catch (_) {
                conn.close();
                return false;
            }
        }
        const capabilities = normalizeProtocolCapabilities(data.capabilities);
        return Promise.resolve(this._beginIdentityAdmission(
            conn,
            playerId,
            name,
            typeof data.resumeToken === 'string' ? data.resumeToken : '',
            proofReserved ? expectedProof : null,
            { type: 'join', name, playerId, avatar: data.avatar, avatarModel: data.avatarModel, resumeAdmission: true }
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
        // A spectator is outside the player roster and can never be (or elect) a
        // host. It cannot vote either, but it knows the roster and the election order,
        // so it follows the migration by knocking on the likely winners in order (a
        // non-host peer refuses non-mesh transports; the elected host admits spectators).
        // Only when every candidate refused does the viewing session end.
        if (this.spectatorMode && this._followMigratedHost()) return;
        if (this.spectatorMode) {
            this._spectatorFollow = null;
            this._manualDisconnect = true;
            this.onHostLeft?.();
            this.disconnect();
            return;
        }
        this._cancelReconnect();
        this._migrationActive = true;
        this._clearMigrationTimers();
        const candidates = this._migrationCandidates().filter(candidate =>
            candidate.eligible === true
            && candidate.connected !== false
            && candidate.spectator !== true);
        // ponytail: nobody left to hand the host role to (1v1, or last player
        // standing) — close instead of self-promoting into an empty lobby.
        // Root cause of P2P_HOST_FIXES #1: this used to fall through to
        // selectHostCandidate() below and always "win" against zero rivals.
        if (candidates.length < 2) {
            this._migrationActive = false;
            this._migrationElection = null;
            this.onReconnectState?.('failed', this._reconnectAttempts);
            this.onHostLeft?.();
            return;
        }
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

    // Spectator: pick the next roster player to try as the migrated host. Mirrors the
    // players' election order (migrationOrder; the old host excluded). Each candidate gets
    // the usual 3 reconnect attempts (~3.5 s, covering the vote window) before moving on.
    _followMigratedHost(now = Date.now()) {
        if (!this.peer || this._manualDisconnect) return false;
        let follow = this._spectatorFollow;
        if (!follow) {
            follow = this._spectatorFollow = {
                startedAt: now,
                tried: new Set([this.hostRoomCode, this.hostConn?.peer].filter(Boolean))
            };
        }
        if (now - follow.startedAt > 30000) return false;
        const candidates = [...this.migrationRoster.values()]
            .filter(player => player.playerId !== this.playerId
                && isSafeTargetId(player.peerId)
                && player.peerId !== this.peer?.id
                && !follow.tried.has(player.peerId))
            .sort((left, right) => (left.migrationOrder ?? 0) - (right.migrationOrder ?? 0));
        const next = candidates[0];
        if (!next) return false;
        follow.tried.add(next.peerId);
        this.hostRoomCode = next.peerId;
        this.hostConn = null;
        this._reconnectAttempts = 0;
        this._netIdsFromHost.clear();
        this._lastPositionSeq.clear();
        this.onReconnectState?.('migrating', 0);
        this._scheduleReconnect();
        return true;
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
        this._resetNetTimeline();
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
        this._resetNetTimeline();
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
            : type === 'cosmeticLoadout'
                ? { windowMs: 10000, max: 6 }
            : type === 'rematchReady'
                ? { windowMs: 1000, max: 4 }
            : type === 'emote'
                ? { windowMs: 4000, max: 3 }
            : type === 'spectatorSeat'
                ? { windowMs: 1000, max: 6 }
            : type === 'lobbyAdmissionRequest'
                ? { windowMs: 5000, max: 4 }
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

    async _acceptCosmeticEntitlement(entitlement, peerId) {
        const playerId = this.peerToPlayerId.get(peerId);
        if (!this.isHost || !playerId || typeof entitlement !== 'string') return false;
        try {
            const response = await fetch('/api/cosmetics/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entitlement })
            });
            if (!response.ok) return false;
            const verified = await response.json();
            if (verified.playerId !== playerId) return false;
            const safe = normalizeWearableLoadout(verified.loadout);
            if (!this.game.setRemoteCosmetics?.(playerId, safe)) return false;
            this.broadcast({ type: 'cosmeticLoadout', playerId, loadout: safe });
            return true;
        } catch {
            return false;
        }
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
            if (t === NET_BIN.POS_Q) {
                const msg = decodePositionQ(dv, { validateId: isSafeTargetId });
                return msg && isValidPositionPacket(msg) ? msg : null;
            }
            if (t === NET_BIN.BALL_Q) {
                const msg = decodeBallQ(dv, { validateId: isSafeTargetId, validateSkin: isSafeBallSkinId });
                return msg && isValidBallPacket(msg) ? msg : null;
            }
            if (t === NET_BIN.POS_BATCH) {
                const entries = decodePositionBatch(dv);
                return entries ? { type: 'positionBatch', entries } : null;
            }
            if (t === NET_BIN.BOT_Q) return decodeBotSync(dv);
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
        if (flags & 64) {
            const segment = readBinaryText(dv, off, {
                maxBytes: BALL_SKIN_ID_MAX_BYTES,
                validate: isSafeBallSkinId
            });
            if (!segment) return null;
            off = segment.next;
            msg.skinId = segment.value;
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
        const skinRequested = Object.prototype.hasOwnProperty.call(b, 'skinId');
        let size = 32;
        let stateCode = 1, targetBytes = null, affixBytes = null;
        let targetPlayerIdBytes = null, targetPeerIdBytes = null, skinBytes = null;
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
        if (skinRequested) {
            skinBytes = encodeBinaryText(b.skinId, {
                maxBytes: BALL_SKIN_ID_MAX_BYTES,
                validate: isSafeBallSkinId,
                coerce: false
            });
        }
        const hasTarget = targetRequested && targetBytes !== null;
        const hasAffix = affixRequested && affixBytes !== null;
        const hasTargetPlayerId = targetPlayerIdRequested && targetPlayerIdBytes !== null;
        const hasTargetPeerId = targetPeerIdRequested && targetPeerIdBytes !== null;
        const hasSkin = skinRequested && skinBytes !== null;
        if (hasTarget) size += 1 + targetBytes.length;
        if (hasAffix) size += 1 + affixBytes.length + 4;
        if (hasTargetPlayerId) size += 1 + targetPlayerIdBytes.length;
        if (hasTargetPeerId) size += 1 + targetPeerIdBytes.length;
        if (hasSkin) size += 1 + skinBytes.length;
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
        if (hasSkin) { flags |= 64; dv.setUint8(off, skinBytes.length); off += 1; u8.set(skinBytes, off); off += skinBytes.length; }
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
        this.connections.forEach(conn => { if (conn.open) { conn.send(u8); this._countOut(u8); } });
    }

    broadcastAllBinary(u8) {
        this.connections.forEach(conn => { if (conn.open) { conn.send(u8); this._countOut(u8); } });
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
                return isValidAttackPacket(data);
            case 'position':
                return isValidPositionPacket(data);
            case 'cosmeticLoadout':
                if (typeof data.entitlement === 'string') return data.entitlement.length <= 2048;
                return isSafeTargetId(data.playerId)
                    && data.loadout
                    && typeof data.loadout === 'object'
                    && !Array.isArray(data.loadout)
                    && Object.keys(data.loadout).length <= COSMETIC_TYPE_IDS.length
                    && Object.entries(data.loadout).every(([type, id]) =>
                        COSMETIC_TYPE_IDS.includes(type)
                        && (id === null || (typeof id === 'string' && id.length <= 32)));
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
            case 'lobbyAdmissionProof':
                return typeof data.admissionToken === 'string'
                    && LOBBY_ADMISSION_TOKEN_PATTERN.test(data.admissionToken);
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
        case 'emote':
            return typeof data.emote === 'string'
                && EMOTE_ID_PATTERN.test(data.emote)
                && (data.playerId === undefined || isSafeTargetId(data.playerId));
        case 'spectatorSeat':
            return Number.isSafeInteger(data.seat) && data.seat >= 0 && data.seat < 1024;
        case 'ping':
            return typeof data.nonce === 'string' && data.nonce.length > 0 && data.nonce.length <= 32;
        case 'pong':
            return typeof data.nonce === 'string' && data.nonce.length > 0 && data.nonce.length <= 32
                && (data.remoteTime === undefined || Number.isFinite(data.remoteTime));
        case 'netIds':
            return Array.isArray(data.ids)
                && data.ids.length <= NET_ID_MAX
                && data.ids.every(entry => Array.isArray(entry)
                    && entry.length === 3
                    && Number.isSafeInteger(entry[0]) && entry[0] >= 1 && entry[0] <= 255
                    && isSafeTargetId(entry[1])
                    && isSafeTargetId(entry[2]));
        case 'positionBatch':
            return Array.isArray(data.entries) && data.entries.length <= 64;
        case 'botSync':
            return Array.isArray(data.bots)
                && data.bots.length <= 64
                && (data.t === undefined || (Number.isFinite(data.t) && data.t >= 0 && data.t < 0x100000000))
                && data.bots.every(bot => bot
                    && typeof bot.name === 'string'
                    && bot.name.length > 0
                    && bot.name.length <= 32
                    && [bot.x, bot.y, bot.z].every(value => isBoundedFinite(value, NETWORK_WORLD_BOUND)));
        default:
                return true;
        }
    }

    handleMessage(data, peerId) {
        this._receivedPackets++;
        this._countIn(data);
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
        // Spectators have no gameplay authority (ball, score, movement, teams, votes):
        // the host drops everything outside the spectator whitelist.
        if (this.isHost && sourceConn?._spectator === true
            && !isSpectatorAllowedMessage(data.type)) return;
        switch (data.type) {
            case 'capabilities':
                if (sourceConn) {
                    this.peerCapabilities.set(peerId, Object.freeze({
                        positionV2: data.positionV2 === true,
                        migrationVotes: data.migrationVotes === true,
                        ...(data.netV3 === true ? { netV3: true } : {})
                    }));
                    // A fresh peer needs target/affix/skin on the next ball packets.
                    if (this.isHost) this._ballSend.metaLeft = BALL_META_REDUNDANCY;
                }
                break;
            case 'positionBatch':
                // Host → spectator relay: one packet, every watched player.
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    for (const entry of data.entries) {
                        const identity = this._netIdsFromHost.get(entry.netId);
                        if (!identity) continue;
                        entry.playerId = identity.playerId;
                        entry.peerId = identity.peerId;
                        delete entry.netId;
                        if (!this._validateMsg(entry)) continue;
                        this._applyPositionPacket(entry, peerId);
                    }
                }
                break;
            case 'netIds':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this._netIdsFromHost.clear();
                    for (const [id, playerId, idPeerId] of data.ids) {
                        this._netIdsFromHost.set(id, { playerId, peerId: idPeerId });
                    }
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
                    if (conn._spectator === true) {
                        this._sendLobbyAdmissionProof(conn);
                        try { this.onSpectatorJoin?.(conn._playerName, playerId, peerId); } catch (_) {}
                        try { conn._sendWelcome?.(); } catch (_) {}
                        break;
                    }
                    this._updateMigrationRoster([
                        ...this.migrationRoster.values(),
                        {
                            playerId,
                            peerId,
                            name: conn._playerName,
                            team: 'red'
                        }
                    ]);
                    this._sendLobbyAdmissionProof(conn);
                    if (this.onPlayerJoin) {
                        const joinArgs = [conn._playerName, playerId, data.avatar, peerId];
                        if (data.avatarModel === 'slim') joinArgs.push('slim');
                        try { this.onPlayerJoin(...joinArgs); } catch (_) {
                            // Gameplay/UI callbacks must not block the transport welcome.
                        }
                    }
                    try { conn._sendWelcome?.(); } catch (_) {}
                }
                break;
            case 'position':
                this._applyPositionPacket(data, peerId);
                break;
            case 'cosmeticLoadout':
                {
                    if (this.isHost) {
                        if (!this._allowSocialPacket(peerId, 'cosmeticLoadout')) break;
                        void this._acceptCosmeticEntitlement(data.entitlement, peerId);
                    } else if (peerId === this.hostConn?.peer && isSafeTargetId(data.playerId)) {
                        const safe = normalizeWearableLoadout(data.loadout);
                        this.game.setRemoteCosmetics?.(data.playerId, safe);
                    }
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
                    const spectator = sourceConn?._spectator === true
                        ? this.game.spectators?.get?.(playerId)
                        : null;
                    if (!player && !spectator) break;
                    const trusted = {
                        ...data,
                        name: player ? player.name : `${String(spectator.name).slice(0, 20)} (spectator)`
                    };
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
                    // App owns client lobby presentation (mode/map/role UI).
                    // Preserve the direct game fallback for transport-only users.
                    if (this.onGameState) this.onGameState(data);
                    else this.game.applyLobbyState(data);
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
                    if (data.matchId && this.game.matchId === data.matchId) break;
                    this._applyBallAppearance(data);
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
                // Several pings may be in flight (connect burst + periodic); each nonce
                // yields one RTT sample. Clients feed the host clock filter; the host only
                // tracks per-peer RTT (it is the reference clock).
                {
                    const sentAt = this._pings.get(data.nonce);
                    if (sentAt === undefined) break;
                    const now = performance.now();
                    const rtt = now - sentAt;
                    if (this.isHost) {
                        const previous = this._peerRtt.get(peerId);
                        this._peerRtt.set(peerId, previous === undefined ? rtt : previous + (rtt - previous) / 4);
                        let sum = 0;
                        for (const value of this._peerRtt.values()) sum += value;
                        this._lastPing = this._peerRtt.size ? sum / this._peerRtt.size : rtt;
                        break;
                    }
                    if (peerId !== this.hostConn?.peer) break;
                    this._pings.delete(data.nonce);
                    this._pingAwait = null;
                    if (typeof data.remoteTime === 'number'
                        && this.clock.addSample(sentAt, data.remoteTime, now)) {
                        this._lastPing = this.clock.rtt;
                        this._clockOffset = this.clock.offset;
                    } else {
                        this._lastPing = rtt;
                    }
                }
                break;
            case 'ballState':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this._applyBallAppearance(data);
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
                    this._applyBallAppearance(data);
                    this.game.startRoundFromNetwork(data);
                }
                break;
            case 'roundEnd':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this.game.applyRoundEnd?.(data);
                }
                break;
            case 'lobbyAdmissionProof':
                if (!this.isHost && peerId === this.hostConn?.peer) {
                    this._acceptLobbyAdmissionProof(data.admissionToken);
                }
                break;
            case 'lobbyAdmissionRequest':
                // Only an admitted transport reaches here (gate above) and
                // _sendLobbyAdmissionProof re-checks it; rate-limited per peer.
                if (this.isHost && sourceConn && this._allowSocialPacket(peerId, 'lobbyAdmissionRequest')) {
                    this._sendLobbyAdmissionProof(sourceConn);
                }
                break;
            case 'welcome':
                if (this.isHost || peerId !== this.hostConn?.peer) break;
                this._applyBallAppearance(data);
                this._acceptLobbyAdmissionProof(data.admissionToken);
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
                            if (!this.spectatorMode
                                && meshPeerId !== this.peer?.id
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
                if (!this.isHost
                    && peerId === this.hostConn?.peer
                    && data.name === this.playerName) {
                    this._lastKickReason = typeof data.reason === 'string' ? data.reason.slice(0, 32) : 'kicked';
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
                // Bots are host-simulated: only the host transport may move them.
                if (!this.isHost && peerId === this.hostConn?.peer) this.game.applyBotSync(data);
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
                if (!this.isHost && peerId === this.hostConn?.peer) this.game.applyCelebrationStart(data);
                break;
            case 'gameOver':
                if (!this.isHost && peerId === this.hostConn?.peer) this.game.applyGameOver(data);
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
                if (!this.isHost && !this.spectatorMode && peerId === this.hostConn?.peer
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
            case 'emote':
                // Emote wheel (players and spectators). The host is the only relay:
                // it re-stamps identity from the transport, rate-limits, then rebroadcasts.
                if (this.isHost) {
                    if (!sourceConn || !this._allowSocialPacket(peerId, 'emote')) break;
                    const playerId = this.peerToPlayerId.get(peerId);
                    if (playerId) this.onEmote?.(playerId, data.emote, sourceConn._spectator === true);
                } else if (peerId === this.hostConn?.peer && isSafeTargetId(data.playerId)) {
                    this.onEmote?.(data.playerId, data.emote, false);
                }
                break;
            case 'spectatorSeat':
                if (this.isHost && sourceConn?._spectator === true
                    && this._allowSocialPacket(peerId, 'spectatorSeat')) {
                    const playerId = this.peerToPlayerId.get(peerId);
                    if (playerId) this.onSpectatorSeat?.(playerId, data.seat);
                }
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

    _applyPositionPacket(data, peerId) {
        const trustedRelay = !this.isHost && peerId === this.hostConn?.peer;
        const transportPeerId = trustedRelay && data.peerId ? data.peerId : peerId;
        const boundPlayerId = this.peerToPlayerId.get(peerId);
        if (!trustedRelay && boundPlayerId && data.playerId && data.playerId !== boundPlayerId) return;
        // POS_Q carries the playerId only every PLAYER_ID_EVERY packets: resolve the
        // host's own id from the welcome roster (allowedMeshPeers) so its packets
        // never spawn a phantom "P-xxxx" remote player in the lobby.
        const playerId = trustedRelay
            ? (data.playerId || this.peerToPlayerId.get(transportPeerId)
                || this.allowedMeshPeers.get(transportPeerId) || transportPeerId)
            : (boundPlayerId || data.playerId || peerId);
        if (trustedRelay) this.peerToPlayerId.set(transportPeerId, playerId);
        if (data.seq !== undefined) {
            const previous = this._lastPositionSeq.get(playerId);
            if (previous !== undefined && !isNewerSequence(data.seq, previous)) return;
            this._lastPositionSeq.set(playerId, data.seq);
        }
        this.game.updateRemotePlayer(playerId, data, transportPeerId);
        if (this.isHost) this._forwardPositionForRelay(data, playerId, peerId);
    }

    // Relay clients have no WebRTC mesh: the host forwards movement between them
    // and everyone else (relay -> all, and all -> relay clients).
    _forwardPositionForRelay(data, playerId, sourcePeerId) {
        let hasRelay = false;
        for (const conn of this.connections.values()) {
            if (conn?._relay === true) { hasRelay = true; break; }
        }
        if (!hasRelay || !isSafeTargetId(playerId) || !isSafeTargetId(sourcePeerId)) return;
        const sourceRelay = this.connections.get(sourcePeerId)?._relay === true;
        let packet = null;
        this.connections.forEach((conn, connPeerId) => {
            if (connPeerId === sourcePeerId || !conn?.open || conn._admitted !== true || conn._spectator === true) return;
            if (!sourceRelay && conn._relay !== true) return;
            if (connectionCongested(conn)) return;
            if (!packet) {
                packet = { ...data, type: 'position', playerId, peerId: sourcePeerId };
                delete packet.netId;
                delete packet.t; // receivers stamp relayed samples on arrival
                if (!isValidPositionPacket(packet)) return;
            }
            try { conn.send(packet); } catch (_) {}
        });
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
        // Relay peers (server-assigned ids) have no WebRTC endpoint, and a client
        // that itself reached the host only through the relay cannot mesh: the
        // host forwards movement for both (_forwardPositionForRelay).
        if (isRelayPeerId(peerId) || this._hostTransport === 'relay') return undefined;
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
        if (data?.type === 'botSync' && this.isHost) {
            this._broadcastBotSync(data);
            return;
        }
        this.connections.forEach(conn => {
            if (conn.open) { conn.send(data); this._sentPackets++; this._countOut(data); }
        });
    }

    // Bot movement (host → all, 10 Hz from main.js): host-clock stamped for snapshot
    // interpolation; netV3 peers get the compact binary form (~30 B/bot vs ~170 B JSON).
    _broadcastBotSync(data) {
        const t = this.hostNow();
        let binary;
        let json = null;
        this.connections.forEach((conn, peerId) => {
            if (!conn.open) return;
            let packet = null;
            if (this._supportsNetV3(peerId)) {
                if (binary === undefined) binary = encodeBotSync(data.bots, t);
                packet = binary;
            }
            if (!packet) {
                if (connectionCongested(conn)) return;
                packet = json ||= { ...data, t: Math.round(t) };
            } else if (connectionCongested(conn)) {
                return;
            }
            conn.send(packet);
            this._sentPackets++;
            this._countOut(packet);
        });
    }

    // Match start is a one-shot transition, not a high-frequency simulation
    // packet. Retain it across a brief signalling outage and replay it on the
    // existing ordered DataChannel so a client cannot be stranded in lobby.
    broadcastGameStart(snapshot = {}) {
        if (!this.isHost) return;
        const packet = Object.freeze({ type: 'gameStart', ...this._withBallAppearance(snapshot) });
        this._latestGameStart = packet;
        this.broadcast(packet);
        this._gameStartRetryTimers.forEach(timer => clearTimeout(timer));
        this._gameStartRetryTimers = [300, 900, 1800].map(delay => setTimeout(() => {
            if (this._latestGameStart === packet) this.broadcast(packet);
        }, delay));
    }

    broadcastAll(data) {
        this.connections.forEach(conn => {
            if (conn.open) { conn.send(data); this._sentPackets++; }
        });
    }

    sendToHost(data) {
        if (this.hostConn && this.hostConn.open) { this.hostConn.send(data); this._sentPackets++; this._countOut(data); }
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
        if (this.spectatorMode) return;
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
        let v3Packet = null;
        for (const [peerId, conn] of this.connections) {
            if (!conn?.open) continue;
            const capabilities = this.peerCapabilities.get(peerId);
            let packet;
            if (capabilities?.netV3 === true) {
                // Movement is superseded by the next packet: under congestion drop it
                // rather than queue latency (identity/life fields ride again on change).
                if (connectionCongested(conn) && extra.name === undefined && extra.team === undefined
                    && extra.alive === undefined && extra.hp === undefined) continue;
                packet = v3Packet ||= encodePositionQ(this._positionQPayload(payload), { validateId: isSafeTargetId });
            } else {
                packet = capabilities?.positionV2 === true
                    ? (v2Packet ||= this.encodePosition(payload))
                    : (legacyPacket ||= this.encodeLegacyPosition(payload));
            }
            conn.send(packet);
            this._sentPackets++;
            this._countOut(packet);
        }
    }

    // POS_Q payload: host-clock stamp once synced, and the (bound-per-transport) playerId
    // only on the first/every Nth packet instead of 36 bytes on every packet.
    _positionQPayload(payload) {
        const stamped = this.isHost || this.clock.synced;
        const includeId = payload.seq % PLAYER_ID_EVERY === 1 || payload.name !== undefined;
        return {
            ...payload,
            t: stamped ? this.hostNow() : undefined,
            playerId: includeId ? payload.playerId : undefined
        };
    }

    _sendToConn(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) { conn.send(data); this._sentPackets++; this._countOut(data); }
    }

    sendAttack(extra = {}) {
        if (this.spectatorMode) return;
        this.send({ type: 'attack', ...extra });
    }

    sendSkillUse(extra = {}) {
        if (this.spectatorMode) return;
        this.send({ type: 'skillUse', ...extra });
    }

    broadcastSkillEffect(skillId, playerId, peerId, pos) {
        if (!this.isHost) return;
        this.broadcast({ type: 'skillEffect', skill: skillId, playerId, peerId, pos });
    }

    // RTT ölçümü — nonce işaretlenir, periyodik olarak peer'a yollanır.
    sendPing() {
        if (!this.connected) return;
        const now = performance.now();
        // Expire unanswered pings (lost / peer gone) so the map stays bounded.
        for (const [nonce, sentAt] of this._pings) {
            if (now - sentAt > 5000) this._pings.delete(nonce);
        }
        const nonce = Math.random().toString(36).slice(2, 14);
        this._pings.set(nonce, now);
        this._pingAwait = { nonce, t: now };
        this.send({ type: 'ping', nonce });
    }

    getPing() { return this._lastPing || 0; }
    getDiagnostics() {
        return {
            ping: this.getPing(),
            jitter: this.clock.jitter || 0,
            clockSynced: this.isHost || this.clock.synced,
            peers: this.connections.size,
            sent: this._sentPackets,
            received: this._receivedPackets,
            reconnecting: Boolean(this._reconnectTimer),
            migrating: this._migrationActive,
            migrationEpoch: this.migrationEpoch
        };
    }
    getClockOffset() { return this.isHost ? 0 : (this.clock.synced ? this.clock.offset : this._clockOffset || 0); }

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
        const snapshot = {
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
            affix: ball.affix ? { id: ball.affix.id || ball.affix.name, color: ball.affix.color } : null,
            skinId: ball.skinId || 'classic'
        };
        const now = performance.now();
        const decision = this._ballSendDecision(snapshot, now);
        if (!decision.send) return false;
        let legacy = 0;
        let modern = 0;
        this.connections.forEach((conn, peerId) => {
            if (!conn?.open) return;
            if (this._supportsNetV3(peerId)) modern++;
            else legacy++;
        });
        if (!modern) {
            // Legacy-only audience: identical wire format and fan-out as before netV3.
            this.broadcastBinary(this.encodeBallState(snapshot));
            return true;
        }
        snapshot.t = this.hostNow(now);
        let legacyPacket = null;
        let modernPacket = null;
        this.connections.forEach((conn, peerId) => {
            if (!conn?.open) return;
            // A congested link skips superseded continuous updates, never discontinuities.
            if (!decision.meta && !decision.discontinuity && connectionCongested(conn)) return;
            const packet = this._supportsNetV3(peerId)
                ? (modernPacket ||= encodeBallQ(snapshot, {
                    meta: decision.meta,
                    validateId: isSafeTargetId,
                    validateSkin: isSafeBallSkinId
                }))
                : (legacyPacket ||= this.encodeBallState(snapshot));
            conn.send(packet);
            this._countOut(packet);
        });
        return true;
    }

    // Adaptive ball send (host). main.js offers a state every 60 Hz frame; we transmit when
    // the client's linear prediction would drift, on any discontinuity (deflect, bounce,
    // state/target change), and at least every ~33 ms. target/affix/skin ride only on
    // change (+ BALL_META_REDUNDANCY repeats, unordered channel) and periodic keyframes.
    _ballSendDecision(b, now) {
        const s = this._ballSend;
        const affixId = b.affix ? b.affix.id : null;
        const affixColor = b.affix ? b.affix.color : null;
        let send = false;
        let discontinuity = false;
        if (!s.valid || b.active !== s.active || b.state !== s.state) {
            send = true;
            discontinuity = true;
        }
        if (b.targetPlayerId !== s.targetPlayerId || b.targetPeerId !== s.targetPeerId
            || b.targetName !== s.targetName || affixId !== s.affixId
            || affixColor !== s.affixColor || b.skinId !== s.skinId) {
            send = true;
            s.metaLeft = BALL_META_REDUNDANCY;
            s.targetPlayerId = b.targetPlayerId;
            s.targetPeerId = b.targetPeerId;
            s.targetName = b.targetName;
            s.affixId = affixId;
            s.affixColor = affixColor;
            s.skinId = b.skinId;
        }
        if (!send) {
            const dtMs = now - s.t;
            const dt = dtMs / 1000;
            const px = s.x + s.vx * dt, py = s.y + s.vy * dt, pz = s.z + s.vz * dt;
            const deviation = Math.hypot(b.x - px, b.y - py, b.z - pz);
            const dv = Math.hypot(b.vx - s.vx, b.vy - s.vy, b.vz - s.vz);
            const speed = Math.hypot(s.vx, s.vy, s.vz);
            if (deviation > BALL_DEVIATION_M || dv > Math.max(0.5, 0.03 * speed)) {
                send = true;
                discontinuity = deviation > 0.5 || dv > Math.max(2, 0.2 * speed);
            } else if (dtMs >= BALL_MIN_INTERVAL_MS) {
                send = true;
            }
        }
        const decision = this._ballDecision ||= { send: false, meta: false, discontinuity: false };
        decision.send = send;
        decision.meta = false;
        decision.discontinuity = discontinuity;
        if (!send) return decision;
        s.count++;
        const meta = s.metaLeft > 0 || s.count % BALL_KEYFRAME_EVERY === 1 || !s.valid;
        if (s.metaLeft > 0) s.metaLeft--;
        s.valid = true;
        s.t = now;
        s.x = b.x; s.y = b.y; s.z = b.z;
        s.vx = b.vx; s.vy = b.vy; s.vz = b.vz;
        s.active = b.active;
        s.state = b.state;
        decision.meta = meta;
        return decision;
    }

    _withBallAppearance(snapshot = {}) {
        const skinId = this.game?.ball?.skinId;
        if (!snapshot?.ball || !isSafeBallSkinId(skinId)) return snapshot;
        return { ...snapshot, ball: { ...snapshot.ball, skinId } };
    }

    _applyBallAppearance(packet = {}) {
        const skinId = packet.skinId ?? packet.ball?.skinId ?? packet.snapshot?.ball?.skinId;
        const ball = this.game?.ball;
        if (!ball || !isSafeBallSkinId(skinId) || ball.skinId === skinId) return false;
        ball.setSkin?.(skinId);
        return true;
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
            ...this._withBallAppearance(snapshot),
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

    _resetLobbyAdmissionProof() {
        this.lobbyAdmissionToken = '';
        this._lobbyAdmissionProof = '';
        const waiters = this._lobbyAdmissionWaiters.splice(0);
        if (waiters.length) {
            this.lobbyAdmissionFailure = this._lastKickReason ? `kicked:${this._lastKickReason}` : 'disconnected';
        }
        waiters.forEach(resolve => resolve(''));
    }

    _requestLobbyAdmissionProof() {
        if (this.isHost || this._lobbyAdmissionProof || !this.hostConn?.open) return false;
        try {
            this.hostConn.send({ type: 'lobbyAdmissionRequest' });
            return true;
        } catch (_) {
            return false;
        }
    }

    _sendLobbyAdmissionProof(conn) {
        const token = String(this.lobbyAdmissionToken || '');
        if (!this.isHost || !conn?.open || conn._admitted !== true
            || !LOBBY_ADMISSION_TOKEN_PATTERN.test(token)) return false;
        try {
            conn.send({ type: 'lobbyAdmissionProof', admissionToken: token });
            return true;
        } catch (_) {
            return false;
        }
    }

    setLobbyAdmissionToken(token) {
        const next = LOBBY_ADMISSION_TOKEN_PATTERN.test(String(token || '')) ? String(token) : '';
        const changed = next !== this.lobbyAdmissionToken;
        this.lobbyAdmissionToken = next;
        if (!changed || !next || !this.isHost) return;
        for (const conn of this.playerConnections.values()) {
            this._sendLobbyAdmissionProof(conn);
        }
    }

    // Host: keep a server-relay link open for this lobby so a client whose WebRTC
    // path fails (NAT / firewall) can still reach us. main.js calls this after
    // every successful lobby registration; unchanged config is a no-op.
    enableRelayHost({ code, token, admissionToken } = {}) {
        if (!this.isHost || !code || !token || !LOBBY_ADMISSION_TOKEN_PATTERN.test(String(admissionToken || ''))
            || this.hostRoomCode !== code || this._serverRelayAvailable === false
            || typeof globalThis.WebSocket !== 'function') return false;
        const previous = this._relayHostConfig;
        this._relayHostConfig = { code, token, admissionToken };
        const unchanged = previous && previous.code === code && previous.token === token
            && previous.admissionToken === admissionToken;
        if (unchanged && (this._relayHost || this._relayHostTimer)) return true;
        this._relayHostRetry = 0;
        this._openRelayHost();
        return true;
    }

    disableRelayHost() {
        clearTimeout(this._relayHostTimer);
        this._relayHostTimer = null;
        this._relayHostConfig = null;
        const link = this._relayHost;
        this._relayHost = null;
        try { link?.close(); } catch (_) {}
    }

    _openRelayHost() {
        clearTimeout(this._relayHostTimer);
        this._relayHostTimer = null;
        const config = this._relayHostConfig;
        const previous = this._relayHost;
        this._relayHost = null;
        try { previous?.close(); } catch (_) {}
        if (!config || !this.isHost || this.hostRoomCode !== config.code) return;
        const link = new RelayHostLink({ ...config, url: this.relayUrl });
        this._relayHost = link;
        link.on('connection', conn => {
            if (this._relayHost !== link || !this.isHost) {
                conn.close();
                return;
            }
            this._onIncomingConnection(conn);
        });
        link.on('closed', () => {
            if (this._relayHost !== link) return;
            this._relayHost = null;
            this._scheduleRelayHostRetry();
        });
        link.connect().then(() => {
            if (this._relayHost === link) this._relayHostRetry = 0;
        }, () => {
            if (this._relayHost !== link) return;
            this._relayHost = null;
            try { link.close(); } catch (_) {}
            this._scheduleRelayHostRetry();
        });
    }

    _scheduleRelayHostRetry() {
        if (!this._relayHostConfig || !this.isHost || this._relayHostTimer) return;
        const delay = RELAY_HOST_RETRY_MS[Math.min(this._relayHostRetry, RELAY_HOST_RETRY_MS.length - 1)];
        this._relayHostRetry++;
        this._relayHostTimer = setTimeout(() => {
            this._relayHostTimer = null;
            this._openRelayHost();
        }, delay);
    }

    _acceptLobbyAdmissionProof(token) {
        if (!LOBBY_ADMISSION_TOKEN_PATTERN.test(String(token || ''))) return false;
        this._lobbyAdmissionProof = String(token);
        this._lobbyAdmissionWaiters.splice(0).forEach(resolve => resolve(this._lobbyAdmissionProof));
        return true;
    }

    // Resolves with the host-delivered lobby admission token, or '' with
    // `lobbyAdmissionFailure` set to 'timeout' | 'disconnected' | 'kicked:<reason>'.
    // While waiting, a client re-asks the host every LOBBY_PROOF_REQUEST_MS so one
    // late / lost packet or a host whose registration was still in flight does
    // not fail a legitimate join (the host only ever answers admitted transports).
    waitForLobbyAdmissionProof(timeoutMs = LOBBY_PROOF_WAIT_MS) {
        if (this._lobbyAdmissionProof) return Promise.resolve(this._lobbyAdmissionProof);
        this.lobbyAdmissionFailure = '';
        return new Promise(resolve => {
            let requestTimer = null;
            const finish = token => {
                clearTimeout(timer);
                clearInterval(requestTimer);
                resolve(token || '');
            };
            const timer = setTimeout(() => {
                const index = this._lobbyAdmissionWaiters.indexOf(finish);
                if (index >= 0) this._lobbyAdmissionWaiters.splice(index, 1);
                if (!this.lobbyAdmissionFailure) this.lobbyAdmissionFailure = 'timeout';
                finish('');
            }, Math.max(250, Math.min(60000, Number(timeoutMs) || LOBBY_PROOF_WAIT_MS)));
            this._lobbyAdmissionWaiters.push(finish);
            if (!this.isHost) {
                requestTimer = setInterval(() => this._requestLobbyAdmissionProof(), LOBBY_PROOF_REQUEST_MS);
            }
        });
    }

    disconnect() {
        this._resetLobbyAdmissionProof();
        this.disableRelayHost();
        this._hostTransport = 'p2p';
        this._ensureIdentityMaps();
        this._manualDisconnect = true;
        this.spectatorMode = false;
        this._cancelReconnect();
        if (this._signalReconnectTimer) {
            clearTimeout(this._signalReconnectTimer);
            this._signalReconnectTimer = null;
        }
        this._gameStartRetryTimers.forEach(timer => clearTimeout(timer));
        this._gameStartRetryTimers = [];
        this._latestGameStart = null;
        this._clearMigrationTimers();
        this._pingBurstTimers.forEach(timer => clearTimeout(timer));
        this._pingBurstTimers = [];
        if (this._specRelayTimer) clearTimeout(this._specRelayTimer);
        this._specRelayTimer = null;
        this._specRelay.clear();
        this._netIds.clear();
        this._netIdsFromHost.clear();
        this._spectatorFollow = null;
        this._pings.clear();
        this._peerRtt.clear();
        this.clock.reset();
        this._ballTransit.reset();
        this._ballSend.valid = false;
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
        this._peerOpened = false;
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
