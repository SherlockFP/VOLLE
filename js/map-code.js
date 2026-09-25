// Map share codes: a custom map packed into one pasteable string ("VM1." + base64url
// of a compact JSON array). Nothing is stored on the server: the host pastes a code
// when setting up a custom game and the lobby carries it to every client, which
// decodes it synchronously, runs the normal map validator and registers the map
// under an id derived from the code itself.
import { PRIMITIVE_TYPES, WEATHER_TYPES, FLAG_NAMES, normalizeMapConfig, validateMapConfig } from './map-config.js';

export const MAP_CODE_PREFIX = 'VM1.';
export const MAP_CODE_MAX_LENGTH = 16000;
const COLOR_KEYS = ['floorRed', 'floorBlue', 'wall', 'sky', 'fog'];

const round = value => Math.round(Number(value) * 100) / 100;
const hex = value => String(value || '').replace(/^#/, '').toLowerCase();

function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function sizeList(prop) {
    const size = prop.size || {};
    if (prop.type === 'box') return [round(size.width), round(size.height), round(size.depth)];
    if (prop.type === 'sphere') return [round(size.radius)];
    return [round(size.radius), round(size.height)];
}

export function encodeMapCode(config) {
    const map = normalizeMapConfig(config);
    const d = map.dimensions;
    const flags = FLAG_NAMES.reduce((bits, name, index) => bits | (map.flags[name] ? 1 << index : 0), 0);
    const packed = [
        1,
        map.name,
        [round(d.width), round(d.length), round(d.wallHeight), round(d.ceilingHeight)],
        COLOR_KEYS.map(key => hex(map.colors[key])),
        Math.max(0, WEATHER_TYPES.indexOf(map.weather)),
        flags,
        map.props.map(prop => [
            PRIMITIVE_TYPES.indexOf(prop.type),
            round(prop.position.x), round(prop.position.y), round(prop.position.z),
            sizeList(prop),
            hex(prop.color)
        ])
    ];
    return MAP_CODE_PREFIX + toBase64Url(JSON.stringify(packed));
}

function unpack(packed) {
    if (!Array.isArray(packed) || packed[0] !== 1 || packed.length !== 7) return null;
    const [, name, dims, colors, weather, flags, props] = packed;
    if (!Array.isArray(dims) || !Array.isArray(colors) || !Array.isArray(props)) return null;
    return {
        name,
        dimensions: { width: dims[0], length: dims[1], wallHeight: dims[2], ceilingHeight: dims[3] },
        colors: Object.fromEntries(COLOR_KEYS.map((key, index) => [key, `#${String(colors[index] ?? '')}`])),
        weather: WEATHER_TYPES[weather] ?? 'clear',
        flags: Object.fromEntries(FLAG_NAMES.map((flag, index) => [flag, (Number(flags) & (1 << index)) !== 0])),
        props: props.map((prop, index) => {
            if (!Array.isArray(prop)) return null;
            const type = PRIMITIVE_TYPES[prop[0]];
            const size = Array.isArray(prop[4]) ? prop[4] : [];
            return {
                id: `prop-${index + 1}`,
                type,
                position: { x: prop[1], y: prop[2], z: prop[3] },
                size: type === 'box' ? { width: size[0], height: size[1], depth: size[2] }
                    : type === 'sphere' ? { radius: size[0] } : { radius: size[0], height: size[1] },
                color: `#${String(prop[5] ?? '')}`
            };
        })
    };
}

// { ok: true, config } or { ok: false, error }. Untrusted input: every value goes
// through validateMapConfig (ranges, prop count, unsafe text) before use.
export function decodeMapCode(code) {
    const text = String(code ?? '').replace(/\s+/g, '');
    if (!text.startsWith(MAP_CODE_PREFIX)) return { ok: false, error: 'not a map code' };
    if (text.length > MAP_CODE_MAX_LENGTH) return { ok: false, error: 'map code is too long' };
    const body = text.slice(MAP_CODE_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, error: 'map code is damaged' };
    let packed;
    try {
        packed = JSON.parse(fromBase64Url(body));
    } catch {
        return { ok: false, error: 'map code is damaged' };
    }
    const config = unpack(packed);
    if (!config) return { ok: false, error: 'map code is damaged' };
    const validation = validateMapConfig(config);
    if (!validation.valid) return { ok: false, error: validation.errors[0] || 'map is not valid' };
    return { ok: true, config: normalizeMapConfig(validation.config) };
}

// Same code -> same id on every client (FNV-1a over the canonical code).
export function mapIdForCode(code) {
    const text = String(code ?? '').replace(/\s+/g, '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `custom-code-${hash.toString(36)}`;
}

export function isCodedMapId(mapId) {
    return /^custom-code-[a-z0-9]{1,8}$/.test(String(mapId ?? ''));
}
