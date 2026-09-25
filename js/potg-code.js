// Play of the Game share codes: a clip packed into one pasteable string
// ("VP1." + base64url of deflate-raw JSON). Names are listed once and frames
// refer to them by index; positions round to 0.1 units, yaw to 0.01 rad; the
// camera is dropped (the viewer chases a player). Nothing is stored anywhere:
// whoever has the code can watch it from the Replays screen. Decoding treats the
// code as untrusted: every count, number and string is bounded.
export const POTG_CODE_PREFIX = 'VP1.';
export const POTG_CODE_MAX_LENGTH = 120000;
const MAX_JSON_BYTES = 400000;
const MAX_FRAMES = 600;
const MAX_NAMES = 32;
const MAX_EVENTS = 200;
const MAX_COORD = 5000;
const EVENT_TYPES = { k: 'kill', d: 'deflect' };

const q10 = value => Math.round((Number(value) || 0) * 10);
const q100 = value => Math.round((Number(value) || 0) * 100);
// Control, zero-width and bidi characters and angle brackets never survive a name.
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g;
const cleanName = value => String(value ?? '').replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 24);

function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function pipe(bytes, stream, limit = Infinity) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
            await reader.cancel();
            throw new Error('too large');
        }
        chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
}

export function canEncodePotgCode() {
    return typeof globalThis.CompressionStream === 'function' && typeof globalThis.Blob === 'function';
}

// clip: an extracted replay ({ meta, events, duration }); play: pickPlayOfTheGame().
export async function encodePotgCode(clip, play = {}) {
    if (!canEncodePotgCode()) return null;
    const names = [];
    const index = new Map();
    const nameIndex = (id, name, team) => {
        const key = String(id ?? name ?? '');
        if (!index.has(key)) {
            if (names.length >= MAX_NAMES) return -1;
            index.set(key, names.length);
            names.push([cleanName(name ?? id), team === 'blue' ? 1 : 0]);
        }
        return index.get(key);
    };
    const frames = [];
    const events = [];
    for (const event of clip?.events || []) {
        const t = Math.max(0, Math.round(Number(event.t) || 0));
        if (event.type === 'snapshot' && frames.length < MAX_FRAMES) {
            const data = event.data || {};
            const people = [];
            // Recorded snapshots are normalized: `players` already holds the local
            // player with its name (`player` is only a point). A raw snapshot
            // without a list falls back to a named `player`.
            const everyone = Array.isArray(data.players) && data.players.length
                ? data.players
                : (data.player?.name ? [data.player] : []);
            const seen = new Set();
            for (const p of everyone) {
                const key = String(p.id ?? p.name ?? '');
                if (seen.has(key)) continue;
                seen.add(key);
                const i = nameIndex(p.id, p.name, p.team);
                if (i < 0) continue;
                people.push(i, p.alive === false ? 0 : 1, q10(p.x ?? p.position?.x), q10(p.y ?? p.position?.y), q10(p.z ?? p.position?.z), q100(p.yaw));
            }
            const b = data.ball;
            frames.push([t, b ? [q10(b.x), q10(b.y), q10(b.z)] : 0, people]);
        } else if (event.type === 'kill' && events.length < MAX_EVENTS) {
            const d = event.data || {};
            events.push([t, 'k', cleanName(d.attacker), cleanName(d.victim), Math.round(Number(d.rally) || 0), (d.perfect ? 1 : 0) | (d.headshot ? 2 : 0)]);
        } else if (event.type === 'deflect' && events.length < MAX_EVENTS) {
            events.push([t, 'd', Math.round(Number(event.data?.rally) || 0)]);
        }
    }
    const packed = [1, { map: String(clip?.meta?.map || '').slice(0, 64), mode: String(clip?.meta?.mode || '').slice(0, 32) },
        { player: cleanName(play.player), kind: play.kind === 'rally' ? 'rally' : 'kill', streak: Math.max(0, Math.round(Number(play.streak) || 0)), rally: Math.max(0, Math.round(Number(play.rally) || 0)), perfect: play.perfect === true, headshot: play.headshot === true },
        names, frames, events, Math.max(0, Math.round(Number(clip?.duration) || 0))];
    const bytes = await pipe(new TextEncoder().encode(JSON.stringify(packed)), new CompressionStream('deflate-raw'));
    return POTG_CODE_PREFIX + toBase64Url(bytes);
}

const int = (value, limit) => Number.isInteger(value) && Math.abs(value) <= limit;

// { ok: true, clip, play } or { ok: false, error }.
export async function decodePotgCode(code) {
    const text = String(code ?? '').replace(/\s+/g, '');
    if (!text.startsWith(POTG_CODE_PREFIX)) return { ok: false, error: 'not a Play of the Game code' };
    if (text.length > POTG_CODE_MAX_LENGTH) return { ok: false, error: 'code is too long' };
    const body = text.slice(POTG_CODE_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(body) || typeof DecompressionStream !== 'function') return { ok: false, error: 'code is damaged' };
    let packed;
    try {
        const json = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
        packed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
    } catch {
        return { ok: false, error: 'code is damaged' };
    }
    if (!Array.isArray(packed) || packed[0] !== 1 || packed.length !== 7) return { ok: false, error: 'code is damaged' };
    const [, meta, play, names, frames, events, duration] = packed;
    if (!Array.isArray(names) || names.length > MAX_NAMES || !Array.isArray(frames) || frames.length > MAX_FRAMES
        || !Array.isArray(events) || events.length > MAX_EVENTS || !int(duration, 600000)) return { ok: false, error: 'code is damaged' };
    const roster = names.map(entry => (Array.isArray(entry) ? { name: cleanName(entry[0]) || 'Player', team: entry[1] === 1 ? 'blue' : 'red' } : null));
    if (roster.some(entry => !entry)) return { ok: false, error: 'code is damaged' };
    const out = [];
    for (const frame of frames) {
        if (!Array.isArray(frame) || !int(frame[0], 600000) || !Array.isArray(frame[2]) || frame[2].length % 6 !== 0) return { ok: false, error: 'code is damaged' };
        const [t, ball, flat] = frame;
        const players = [];
        for (let i = 0; i < flat.length; i += 6) {
            const [idx, alive, x, y, z, yaw] = flat.slice(i, i + 6);
            if (!int(idx, MAX_NAMES - 1) || idx < 0 || idx >= roster.length || ![x, y, z].every(v => int(v, MAX_COORD * 10)) || !int(yaw, 100000)) return { ok: false, error: 'code is damaged' };
            players.push({ id: `p${idx}`, name: roster[idx].name, team: roster[idx].team, alive: alive !== 0, x: x / 10, y: y / 10, z: z / 10, yaw: yaw / 100 });
        }
        const data = { players };
        if (Array.isArray(ball) && ball.length === 3 && ball.every(v => int(v, MAX_COORD * 10))) data.ball = { x: ball[0] / 10, y: ball[1] / 10, z: ball[2] / 10 };
        out.push({ t, type: 'snapshot', data });
    }
    for (const event of events) {
        if (!Array.isArray(event) || !int(event[0], 600000) || !EVENT_TYPES[event[1]]) return { ok: false, error: 'code is damaged' };
        if (event[1] === 'k') {
            out.push({ t: event[0], type: 'kill', data: { attacker: cleanName(event[2]), victim: cleanName(event[3]), rally: int(event[4], 1000) ? event[4] : 0, perfect: (event[5] & 1) === 1, headshot: (event[5] & 2) === 2 } });
        } else {
            out.push({ t: event[0], type: 'deflect', data: { rally: int(event[2], 1000) ? event[2] : 0 } });
        }
    }
    out.sort((a, b) => a.t - b.t);
    const safeMeta = { map: String(meta?.map || '').slice(0, 64), mode: String(meta?.mode || '').slice(0, 32), highlight: 'Play of the Game' };
    const safePlay = {
        player: cleanName(play?.player), kind: play?.kind === 'rally' ? 'rally' : 'kill',
        streak: int(play?.streak, 99) ? Math.max(0, play.streak) : 0, rally: int(play?.rally, 1000) ? Math.max(0, play.rally) : 0,
        perfect: play?.perfect === true, headshot: play?.headshot === true
    };
    return { ok: true, clip: { meta: safeMeta, events: out, duration }, play: safePlay };
}
