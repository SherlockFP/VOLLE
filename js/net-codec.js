// net-codec.js — compact binary codecs for the hot P2P packets (netV3).
//
// Wire rules shared by every codec here:
//   - positions are int16 at 1/64 m (±511.98 m, NETWORK_WORLD_BOUND is 512),
//   - player velocities int16 at 1/64 m/s, ball velocities stay float32 (rallies are uncapped),
//   - yaw is a uint16 turn fraction, aim is an octahedral-encoded unit vector (2 × int16),
//   - `t` is the sender's estimate of the HOST clock in ms (uint32, wraps after ~49 days),
//   - optional fields ride behind flag bits, so an idle player costs 19 bytes, a moving one 27.
// Decoders never throw: any truncated, oversized or trailing-garbage packet decodes to null,
// and the caller still runs the normal protocol validators on the decoded message.

export const NET_BIN = Object.freeze({ POS_Q: 4, BALL_Q: 5, POS_BATCH: 6, BOT_Q: 7 });

export const POS_SCALE = 64;
export const VEL_SCALE = 64;
const INT16_MAX = 32767;
const TWO_PI = Math.PI * 2;
const TIME_WRAP = 0x100000000;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const defaultIdValidator = value => typeof value === 'string' && DEFAULT_ID_PATTERN.test(value)
    && UTF8_ENCODER.encode(value).byteLength <= 128;

// Ball state enum — identical to the legacy BIN.BALL mapping on purpose: clients branch
// on ball.state (e.g. 'orbiting' drives local release logic), so the codec must not
// start delivering states the legacy wire never delivered.
const BALL_STATE_CODE = Object.freeze({ idle: 0, rally: 1, hold: 2, warmup: 3, other: 4 });
const BALL_STATE_NAME = Object.freeze(['idle', 'rally', 'hold', 'warmup', 'other']);
const BOT_INTENTS = Object.freeze(['none', 'deflect', 'dodge-left', 'dodge-right']);

// ---------------------------------------------------------------- scalar helpers

export function quantize(value, scale) {
    const q = Math.round((Number(value) || 0) * scale);
    return q > INT16_MAX ? INT16_MAX : q < -INT16_MAX ? -INT16_MAX : q;
}

export function wrapTime32(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.round(ms) % TIME_WRAP;
}

// Picks the unwrapped value of a uint32 ms stamp closest to `reference` (host-time now).
export function unwrapTime32(stamp, reference) {
    if (!Number.isFinite(stamp)) return NaN;
    if (!Number.isFinite(reference)) return stamp;
    const base = reference - (((reference % TIME_WRAP) + TIME_WRAP) % TIME_WRAP);
    let best = base + stamp;
    if (best - reference > TIME_WRAP / 2) best -= TIME_WRAP;
    else if (reference - best > TIME_WRAP / 2) best += TIME_WRAP;
    return best;
}

export function encodeYaw(radians) {
    const turns = ((Number(radians) || 0) % TWO_PI + TWO_PI) % TWO_PI / TWO_PI;
    return Math.round(turns * 65536) & 0xffff;
}

export function decodeYaw(code) {
    const angle = (code / 65536) * TWO_PI;
    return angle > Math.PI ? angle - TWO_PI : angle;
}

// Octahedral unit-vector encoding: ~0.005° worst-case error at 16 bits per axis.
export function encodeOct(x, y, z, out = [0, 0]) {
    const length = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (!(length > 1e-9)) { out[0] = 0; out[1] = INT16_MAX; return out; }
    let u = x / length;
    let v = y / length;
    if (z < 0) {
        const ou = u;
        u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
        v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
    }
    out[0] = Math.round(u * INT16_MAX);
    out[1] = Math.round(v * INT16_MAX);
    return out;
}

export function decodeOct(a, b, out = { x: 0, y: 0, z: 1 }) {
    let x = a / INT16_MAX;
    let y = b / INT16_MAX;
    const z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) {
        const ox = x;
        x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
        y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
    }
    const length = Math.hypot(x, y, z) || 1;
    out.x = x / length;
    out.y = y / length;
    out.z = z / length;
    return out;
}

function textBytes(value, maxBytes = 255, validate = null) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return null;
    if (validate && !validate(value)) return null;
    const bytes = UTF8_ENCODER.encode(value);
    return bytes.byteLength <= Math.min(255, maxBytes) ? bytes : null;
}

function readText(dv, offset, maxBytes = 255, validate = null) {
    if (offset + 1 > dv.byteLength) return null;
    const length = dv.getUint8(offset);
    const next = offset + 1 + length;
    if (length > maxBytes || next > dv.byteLength) return null;
    let value = '';
    if (length) {
        try {
            value = UTF8_DECODER.decode(new Uint8Array(dv.buffer, dv.byteOffset + offset + 1, length));
        } catch (_) {
            return null;
        }
    }
    if (value && validate && !validate(value)) return null;
    return { next, value };
}

function writeText(u8, dv, offset, bytes) {
    const length = bytes ? bytes.byteLength : 0;
    dv.setUint8(offset, length);
    if (length) u8.set(bytes, offset + 1);
    return offset + 1 + length;
}

// ---------------------------------------------------------------- player position

const POS_F = Object.freeze({
    VEL: 1, HAS_ALIVE: 2, ALIVE: 4, HP: 8, HAS_TEAM: 16, BLUE: 32,
    NAME: 64, CHAR: 128, PLAYER_ID: 256, KNIFE: 512, TIME: 1024, AIM: 2048
});
const POS_F_ALL = 4095;
const OCT_SCRATCH = [0, 0];

export function encodePositionQ(p, { validateId = defaultIdValidator } = {}) {
    let flags = 0;
    let size = 1 + 2 + 2 + 6 + 2; // type, flags, seq, xyz, yaw
    const hasTime = Number.isFinite(p.t);
    if (hasTime) { flags |= POS_F.TIME; size += 4; }
    const hasAim = Number.isFinite(p.ax) && Number.isFinite(p.ay) && Number.isFinite(p.az)
        && (p.ax !== 0 || p.ay !== 0 || p.az !== 0);
    if (hasAim) { flags |= POS_F.AIM; size += 4; }
    const vx = Number(p.vx) || 0, vy = Number(p.vy) || 0, vz = Number(p.vz) || 0;
    const qvx = quantize(vx, VEL_SCALE), qvy = quantize(vy, VEL_SCALE), qvz = quantize(vz, VEL_SCALE);
    // "Send only changed fields": a player at rest omits the 6-byte velocity block.
    if (qvx !== 0 || qvy !== 0 || qvz !== 0) { flags |= POS_F.VEL; size += 6; }
    if (typeof p.alive === 'boolean') { flags |= POS_F.HAS_ALIVE | (p.alive ? POS_F.ALIVE : 0); }
    if (p.hp !== undefined && Number.isFinite(Number(p.hp))) { flags |= POS_F.HP; size += 1; }
    if (p.team === 'red' || p.team === 'blue') { flags |= POS_F.HAS_TEAM | (p.team === 'blue' ? POS_F.BLUE : 0); }
    const name = textBytes(p.name, 255);
    const charId = textBytes(p.charId, 255);
    const playerId = textBytes(p.playerId, 128, validateId);
    const knifeId = textBytes(p.knifeId, 64, value => /^[a-z0-9][a-z0-9_-]*$/.test(value));
    if (name) { flags |= POS_F.NAME; size += 1 + name.byteLength; }
    if (charId) { flags |= POS_F.CHAR; size += 1 + charId.byteLength; }
    if (playerId) { flags |= POS_F.PLAYER_ID; size += 1 + playerId.byteLength; }
    if (knifeId) { flags |= POS_F.KNIFE; size += 1 + knifeId.byteLength; }
    const u8 = new Uint8Array(size);
    const dv = new DataView(u8.buffer);
    dv.setUint8(0, NET_BIN.POS_Q);
    dv.setUint16(1, flags);
    dv.setUint16(3, (p.seq || 0) & 0xffff);
    let o = 5;
    if (hasTime) { dv.setUint32(o, wrapTime32(p.t)); o += 4; }
    dv.setInt16(o, quantize(p.x, POS_SCALE)); dv.setInt16(o + 2, quantize(p.y, POS_SCALE)); dv.setInt16(o + 4, quantize(p.z, POS_SCALE)); o += 6;
    dv.setUint16(o, encodeYaw(p.ry)); o += 2;
    if (hasAim) {
        encodeOct(p.ax, p.ay, p.az, OCT_SCRATCH);
        dv.setInt16(o, OCT_SCRATCH[0]); dv.setInt16(o + 2, OCT_SCRATCH[1]); o += 4;
    }
    if (flags & POS_F.VEL) { dv.setInt16(o, qvx); dv.setInt16(o + 2, qvy); dv.setInt16(o + 4, qvz); o += 6; }
    if (flags & POS_F.HP) { dv.setUint8(o, Math.max(0, Math.min(255, Number(p.hp) | 0))); o += 1; }
    if (name) o = writeText(u8, dv, o, name);
    if (charId) o = writeText(u8, dv, o, charId);
    if (playerId) o = writeText(u8, dv, o, playerId);
    if (knifeId) o = writeText(u8, dv, o, knifeId);
    return u8;
}

export function decodePositionQ(dv, { validateId = defaultIdValidator } = {}) {
    if (dv.byteLength < 13 || dv.getUint8(0) !== NET_BIN.POS_Q) return null;
    const flags = dv.getUint16(1);
    if (flags & ~POS_F_ALL) return null;
    const msg = { type: 'position', seq: dv.getUint16(3) };
    let o = 5;
    const need = bytes => o + bytes <= dv.byteLength;
    if (flags & POS_F.TIME) { if (!need(4)) return null; msg.t = dv.getUint32(o); o += 4; }
    if (!need(8)) return null;
    msg.x = dv.getInt16(o) / POS_SCALE; msg.y = dv.getInt16(o + 2) / POS_SCALE; msg.z = dv.getInt16(o + 4) / POS_SCALE; o += 6;
    msg.ry = decodeYaw(dv.getUint16(o)); o += 2;
    if (flags & POS_F.AIM) {
        if (!need(4)) return null;
        const aim = decodeOct(dv.getInt16(o), dv.getInt16(o + 2));
        msg.ax = aim.x; msg.ay = aim.y; msg.az = aim.z; o += 4;
    }
    if (flags & POS_F.VEL) {
        if (!need(6)) return null;
        msg.vx = dv.getInt16(o) / VEL_SCALE; msg.vy = dv.getInt16(o + 2) / VEL_SCALE; msg.vz = dv.getInt16(o + 4) / VEL_SCALE; o += 6;
    } else {
        msg.vx = 0; msg.vy = 0; msg.vz = 0;
    }
    if (flags & POS_F.HAS_ALIVE) msg.alive = (flags & POS_F.ALIVE) !== 0;
    else if (flags & POS_F.ALIVE) return null;
    if (flags & POS_F.HP) { if (!need(1)) return null; msg.hp = dv.getUint8(o); o += 1; }
    if (flags & POS_F.HAS_TEAM) msg.team = (flags & POS_F.BLUE) ? 'blue' : 'red';
    else if (flags & POS_F.BLUE) return null;
    for (const [bit, key, max, validate] of [
        [POS_F.NAME, 'name', 255, null],
        [POS_F.CHAR, 'charId', 255, null],
        [POS_F.PLAYER_ID, 'playerId', 128, validateId],
        [POS_F.KNIFE, 'knifeId', 64, value => /^[a-z0-9][a-z0-9_-]*$/.test(value)]
    ]) {
        if (!(flags & bit)) continue;
        const segment = readText(dv, o, max, validate);
        if (!segment || !segment.value) return null;
        msg[key] = segment.value;
        o = segment.next;
    }
    return o === dv.byteLength ? msg : null;
}

// ---------------------------------------------------------------- ball

const BALL_F = Object.freeze({ ACTIVE: 1, TARGET: 2, AFFIX: 4, AFFIX_NONE: 8, SKIN: 16, TIME: 32 });
const BALL_F_ALL = 63;
const BALL_FIXED = 1 + 1 + 2 + 6 + 12 + 4 + 1; // type flags seq xyz v(f32×3) speed state

// `meta` = include target/affix/skin (on change + periodic keyframes). Without it the
// receiver keeps its current target/affix/skin — absence means "unchanged", not "cleared".
export function encodeBallQ(b, { meta = true, validateId = defaultIdValidator, validateSkin = null } = {}) {
    let flags = b.active ? BALL_F.ACTIVE : 0;
    let size = BALL_FIXED;
    const hasTime = Number.isFinite(b.t);
    if (hasTime) { flags |= BALL_F.TIME; size += 4; }
    let targetName = null, targetPlayerId = null, targetPeerId = null, affixBytes = null, skinBytes = null;
    if (meta) {
        flags |= BALL_F.TARGET;
        targetName = textBytes(b.targetName, 255);
        targetPlayerId = textBytes(b.targetPlayerId, 128, validateId);
        targetPeerId = textBytes(b.targetPeerId, 128, validateId);
        size += 3 + (targetName?.byteLength || 0) + (targetPlayerId?.byteLength || 0) + (targetPeerId?.byteLength || 0);
        const affixId = b.affix ? (b.affix.id || b.affix.name) : null;
        affixBytes = typeof affixId === 'string' ? textBytes(affixId, 255) : null;
        if (affixBytes) { flags |= BALL_F.AFFIX; size += 1 + affixBytes.byteLength + 4; }
        else flags |= BALL_F.AFFIX_NONE;
        skinBytes = textBytes(b.skinId, 64, validateSkin);
        if (skinBytes) { flags |= BALL_F.SKIN; size += 1 + skinBytes.byteLength; }
    }
    const u8 = new Uint8Array(size);
    const dv = new DataView(u8.buffer);
    dv.setUint8(0, NET_BIN.BALL_Q);
    dv.setUint8(1, flags);
    dv.setUint16(2, (b.seq || 0) & 0xffff);
    let o = 4;
    if (hasTime) { dv.setUint32(o, wrapTime32(b.t)); o += 4; }
    dv.setInt16(o, quantize(b.x, POS_SCALE)); dv.setInt16(o + 2, quantize(b.y, POS_SCALE)); dv.setInt16(o + 4, quantize(b.z, POS_SCALE)); o += 6;
    dv.setFloat32(o, b.vx); dv.setFloat32(o + 4, b.vy); dv.setFloat32(o + 8, b.vz); o += 12;
    dv.setFloat32(o, b.speed); o += 4;
    dv.setUint8(o, BALL_STATE_CODE[b.state] ?? 4); o += 1;
    if (flags & BALL_F.TARGET) {
        o = writeText(u8, dv, o, targetName);
        o = writeText(u8, dv, o, targetPlayerId);
        o = writeText(u8, dv, o, targetPeerId);
    }
    if (flags & BALL_F.AFFIX) {
        o = writeText(u8, dv, o, affixBytes);
        dv.setUint32(o, (b.affix.color >>> 0) || 0); o += 4;
    }
    if (flags & BALL_F.SKIN) o = writeText(u8, dv, o, skinBytes);
    return u8;
}

export function decodeBallQ(dv, { validateId = defaultIdValidator, validateSkin = null } = {}) {
    if (dv.byteLength < BALL_FIXED || dv.getUint8(0) !== NET_BIN.BALL_Q) return null;
    const flags = dv.getUint8(1);
    if ((flags & ~BALL_F_ALL) || ((flags & BALL_F.AFFIX) && (flags & BALL_F.AFFIX_NONE))) return null;
    const msg = { type: 'ballState', seq: dv.getUint16(2), active: (flags & BALL_F.ACTIVE) !== 0 };
    let o = 4;
    if (flags & BALL_F.TIME) {
        if (dv.byteLength < BALL_FIXED + 4) return null;
        msg.t = dv.getUint32(o); o += 4;
    }
    msg.x = dv.getInt16(o) / POS_SCALE; msg.y = dv.getInt16(o + 2) / POS_SCALE; msg.z = dv.getInt16(o + 4) / POS_SCALE; o += 6;
    msg.vx = dv.getFloat32(o); msg.vy = dv.getFloat32(o + 4); msg.vz = dv.getFloat32(o + 8); o += 12;
    msg.speed = dv.getFloat32(o); o += 4;
    const stateCode = dv.getUint8(o); o += 1;
    if (stateCode >= BALL_STATE_NAME.length) return null;
    msg.state = BALL_STATE_NAME[stateCode];
    if (flags & BALL_F.TARGET) {
        const name = readText(dv, o, 255);
        if (!name) return null;
        const playerId = readText(dv, name.next, 128, validateId);
        if (!playerId) return null;
        const peerId = readText(dv, playerId.next, 128, validateId);
        if (!peerId) return null;
        msg.targetName = name.value || null;
        msg.targetPlayerId = playerId.value || null;
        msg.targetPeerId = peerId.value || null;
        o = peerId.next;
    }
    if (flags & BALL_F.AFFIX) {
        const affix = readText(dv, o, 255);
        if (!affix || !affix.value || affix.next + 4 > dv.byteLength) return null;
        msg.affix = affix.value;
        msg.affixColor = dv.getUint32(affix.next);
        o = affix.next + 4;
    } else if (!(flags & BALL_F.AFFIX_NONE)) {
        msg.affixUnchanged = true;
    }
    if (flags & BALL_F.SKIN) {
        const skin = readText(dv, o, 64, validateSkin);
        if (!skin || !skin.value) return null;
        msg.skinId = skin.value;
        o = skin.next;
    }
    return o === dv.byteLength ? msg : null;
}

// ---------------------------------------------------------------- spectator batch
// One packet per flush for ALL players a spectator watches. Entities are addressed by a
// host-assigned 1-byte net id (the id → playerId table travels as a reliable JSON
// `netIds` message), so the 36-byte UUIDs are not repeated 30 times a second.

const BATCH_F = Object.freeze({ VEL: 1, AIM: 2, HAS_ALIVE: 4, ALIVE: 8, HP: 16, TIME: 32 });
const BATCH_F_ALL = 63;
export const POS_BATCH_MAX_ENTRIES = 64;

export function encodePositionBatch(entries) {
    const count = Math.min(entries.length, POS_BATCH_MAX_ENTRIES);
    let size = 2;
    for (let i = 0; i < count; i++) {
        const e = entries[i];
        size += 1 + 1 + 2 + 6 + 2;
        if (Number.isFinite(e.t)) size += 4;
        if (Number.isFinite(e.ax) && (e.ax || e.ay || e.az)) size += 4;
        if (quantize(e.vx, VEL_SCALE) || quantize(e.vy, VEL_SCALE) || quantize(e.vz, VEL_SCALE)) size += 6;
        if (e.hp !== undefined && Number.isFinite(Number(e.hp))) size += 1;
    }
    const u8 = new Uint8Array(size);
    const dv = new DataView(u8.buffer);
    dv.setUint8(0, NET_BIN.POS_BATCH);
    dv.setUint8(1, count);
    let o = 2;
    for (let i = 0; i < count; i++) {
        const e = entries[i];
        let flags = 0;
        const hasTime = Number.isFinite(e.t);
        const hasAim = Number.isFinite(e.ax) && (e.ax || e.ay || e.az);
        const qvx = quantize(e.vx, VEL_SCALE), qvy = quantize(e.vy, VEL_SCALE), qvz = quantize(e.vz, VEL_SCALE);
        if (hasTime) flags |= BATCH_F.TIME;
        if (hasAim) flags |= BATCH_F.AIM;
        if (qvx || qvy || qvz) flags |= BATCH_F.VEL;
        if (typeof e.alive === 'boolean') flags |= BATCH_F.HAS_ALIVE | (e.alive ? BATCH_F.ALIVE : 0);
        if (e.hp !== undefined && Number.isFinite(Number(e.hp))) flags |= BATCH_F.HP;
        dv.setUint8(o, e.netId & 0xff);
        dv.setUint8(o + 1, flags);
        dv.setUint16(o + 2, (e.seq || 0) & 0xffff);
        o += 4;
        if (hasTime) { dv.setUint32(o, wrapTime32(e.t)); o += 4; }
        dv.setInt16(o, quantize(e.x, POS_SCALE)); dv.setInt16(o + 2, quantize(e.y, POS_SCALE)); dv.setInt16(o + 4, quantize(e.z, POS_SCALE)); o += 6;
        dv.setUint16(o, encodeYaw(e.ry)); o += 2;
        if (hasAim) {
            encodeOct(e.ax, e.ay, e.az, OCT_SCRATCH);
            dv.setInt16(o, OCT_SCRATCH[0]); dv.setInt16(o + 2, OCT_SCRATCH[1]); o += 4;
        }
        if (flags & BATCH_F.VEL) { dv.setInt16(o, qvx); dv.setInt16(o + 2, qvy); dv.setInt16(o + 4, qvz); o += 6; }
        if (flags & BATCH_F.HP) { dv.setUint8(o, Math.max(0, Math.min(255, Number(e.hp) | 0))); o += 1; }
    }
    return u8;
}

export function decodePositionBatch(dv) {
    if (dv.byteLength < 2 || dv.getUint8(0) !== NET_BIN.POS_BATCH) return null;
    const count = dv.getUint8(1);
    if (count > POS_BATCH_MAX_ENTRIES) return null;
    const entries = [];
    let o = 2;
    for (let i = 0; i < count; i++) {
        if (o + 4 > dv.byteLength) return null;
        const netId = dv.getUint8(o);
        const flags = dv.getUint8(o + 1);
        if (!netId || (flags & ~BATCH_F_ALL)) return null;
        const e = { type: 'position', netId, seq: dv.getUint16(o + 2) };
        o += 4;
        const need = bytes => o + bytes <= dv.byteLength;
        if (flags & BATCH_F.TIME) { if (!need(4)) return null; e.t = dv.getUint32(o); o += 4; }
        if (!need(8)) return null;
        e.x = dv.getInt16(o) / POS_SCALE; e.y = dv.getInt16(o + 2) / POS_SCALE; e.z = dv.getInt16(o + 4) / POS_SCALE; o += 6;
        e.ry = decodeYaw(dv.getUint16(o)); o += 2;
        if (flags & BATCH_F.AIM) {
            if (!need(4)) return null;
            const aim = decodeOct(dv.getInt16(o), dv.getInt16(o + 2));
            e.ax = aim.x; e.ay = aim.y; e.az = aim.z; o += 4;
        }
        if (flags & BATCH_F.VEL) {
            if (!need(6)) return null;
            e.vx = dv.getInt16(o) / VEL_SCALE; e.vy = dv.getInt16(o + 2) / VEL_SCALE; e.vz = dv.getInt16(o + 4) / VEL_SCALE; o += 6;
        } else {
            e.vx = 0; e.vy = 0; e.vz = 0;
        }
        if (flags & BATCH_F.HAS_ALIVE) e.alive = (flags & BATCH_F.ALIVE) !== 0;
        else if (flags & BATCH_F.ALIVE) return null;
        if (flags & BATCH_F.HP) { if (!need(1)) return null; e.hp = dv.getUint8(o); o += 1; }
        entries.push(e);
    }
    return o === dv.byteLength ? entries : null;
}

// ---------------------------------------------------------------- bot sync

const BOT_F = Object.freeze({ ALIVE: 1, ATTACKING: 2, BLUE: 4, CHAR: 8 });
const BOT_F_ALL = 15;
export const BOT_BATCH_MAX = 64;

// Returns null when a bot carries a value the compact form cannot represent exactly
// (unknown intent, non-finite coordinate, oversize text) — the caller then keeps JSON.
export function encodeBotSync(bots, t) {
    if (!Array.isArray(bots) || bots.length > BOT_BATCH_MAX) return null;
    const names = [];
    const chars = [];
    let size = 1 + 1 + 4;
    for (const bot of bots) {
        const name = textBytes(bot?.name, 32);
        const intent = BOT_INTENTS.indexOf(bot?.intent || 'none');
        if (!name || intent < 0 || ![bot.x, bot.y, bot.z].every(v => Number.isFinite(v) && Math.abs(v) <= 511)) return null;
        const charId = bot.charId ? textBytes(String(bot.charId), 64) : null;
        if (bot.charId && !charId) return null;
        names.push(name);
        chars.push(charId);
        size += 1 + name.byteLength + 1 + 6 + 2 + 1 + 1 + 1 + (charId ? 1 + charId.byteLength : 0);
    }
    const u8 = new Uint8Array(size);
    const dv = new DataView(u8.buffer);
    dv.setUint8(0, NET_BIN.BOT_Q);
    dv.setUint8(1, bots.length);
    dv.setUint32(2, wrapTime32(t));
    let o = 6;
    bots.forEach((bot, index) => {
        o = writeText(u8, dv, o, names[index]);
        const flags = (bot.alive !== false ? BOT_F.ALIVE : 0)
            | (bot.attacking === true ? BOT_F.ATTACKING : 0)
            | (bot.team === 'blue' ? BOT_F.BLUE : 0)
            | (chars[index] ? BOT_F.CHAR : 0);
        dv.setUint8(o, flags); o += 1;
        dv.setInt16(o, quantize(bot.x, POS_SCALE)); dv.setInt16(o + 2, quantize(bot.y, POS_SCALE)); dv.setInt16(o + 4, quantize(bot.z, POS_SCALE)); o += 6;
        dv.setUint16(o, encodeYaw(bot.ry)); o += 2;
        dv.setUint8(o, Math.max(0, Math.min(255, Number(bot.hp) | 0))); o += 1;
        dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, Number(bot.strafe) || 0)) * 127)); o += 1;
        dv.setUint8(o, BOT_INTENTS.indexOf(bot.intent || 'none')); o += 1;
        if (chars[index]) o = writeText(u8, dv, o, chars[index]);
    });
    return u8;
}

export function decodeBotSync(dv) {
    if (dv.byteLength < 6 || dv.getUint8(0) !== NET_BIN.BOT_Q) return null;
    const count = dv.getUint8(1);
    if (count > BOT_BATCH_MAX) return null;
    const msg = { type: 'botSync', t: dv.getUint32(2), bots: [] };
    let o = 6;
    for (let i = 0; i < count; i++) {
        const name = readText(dv, o, 32);
        if (!name || !name.value) return null;
        o = name.next;
        if (o + 12 > dv.byteLength) return null;
        const flags = dv.getUint8(o); o += 1;
        if (flags & ~BOT_F_ALL) return null;
        const bot = {
            name: name.value,
            team: (flags & BOT_F.BLUE) ? 'blue' : 'red',
            x: dv.getInt16(o) / POS_SCALE, y: dv.getInt16(o + 2) / POS_SCALE, z: dv.getInt16(o + 4) / POS_SCALE
        };
        o += 6;
        bot.ry = decodeYaw(dv.getUint16(o)); o += 2;
        bot.hp = dv.getUint8(o); o += 1;
        bot.strafe = dv.getInt8(o) / 127; o += 1;
        const intent = dv.getUint8(o); o += 1;
        if (intent >= BOT_INTENTS.length) return null;
        bot.intent = BOT_INTENTS[intent];
        bot.alive = (flags & BOT_F.ALIVE) !== 0;
        bot.attacking = (flags & BOT_F.ATTACKING) !== 0;
        if (flags & BOT_F.CHAR) {
            const charId = readText(dv, o, 64);
            if (!charId || !charId.value) return null;
            bot.charId = charId.value;
            o = charId.next;
        }
        msg.bots.push(bot);
    }
    return o === dv.byteLength ? msg : null;
}
