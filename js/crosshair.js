export const CROSSHAIR_CODE_PREFIX = 'WARRBALL-X1';
const LEGACY_CROSSHAIR_CODE_PREFIXES = Object.freeze(['VOLLE-X1']);
export const MAX_CROSSHAIR_CODE_LENGTH = 2048;
export const CROSSHAIR_STYLES = Object.freeze(['cross', 'dot', 'circle']);

export const CROSSHAIR_LIMITS = Object.freeze({
    size: Object.freeze([1, 64]),
    gap: Object.freeze([0, 32]),
    thickness: Object.freeze([1, 8]),
    outlineThickness: Object.freeze([0, 4]),
    opacity: Object.freeze([0, 1]),
    dynamicGap: Object.freeze([0, 32])
});

export const CROSSHAIR_DEFAULTS = Object.freeze({
    style: 'dot',
    color: '#00ff88',
    size: 12,
    gap: 6,
    thickness: 2,
    dot: true,
    outline: false,
    outlineThickness: 1,
    opacity: 1,
    dynamicGap: 0
});

const CONFIG_KEYS = Object.freeze(Object.keys(CROSSHAIR_DEFAULTS));
const STYLE_CLASSES = CROSSHAIR_STYLES.map(style => `crosshair-style-${style}`);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CHECKSUM = /^[0-9a-f]{8}$/;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, key) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return CROSSHAIR_DEFAULTS[key];
    const [min, max] = CROSSHAIR_LIMITS[key];
    return Math.min(max, Math.max(min, value));
}

function normalizeColor(value) {
    if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) return CROSSHAIR_DEFAULTS.color;
    const hex = value.trim().slice(1).toLowerCase();
    return hex.length === 3
        ? `#${[...hex].map(character => character + character).join('')}`
        : `#${hex}`;
}

function normalizeBoolean(value, key) {
    return typeof value === 'boolean' ? value : CROSSHAIR_DEFAULTS[key];
}

export function normalizeCrosshairConfig(value = {}) {
    const source = isRecord(value) ? value : {};
    return {
        style: CROSSHAIR_STYLES.includes(source.style) ? source.style : CROSSHAIR_DEFAULTS.style,
        color: normalizeColor(source.color),
        size: clamp(source.size, 'size'),
        gap: clamp(source.gap, 'gap'),
        thickness: clamp(source.thickness, 'thickness'),
        dot: normalizeBoolean(source.dot, 'dot'),
        outline: normalizeBoolean(source.outline, 'outline'),
        outlineThickness: clamp(source.outlineThickness, 'outlineThickness'),
        opacity: clamp(source.opacity, 'opacity'),
        dynamicGap: clamp(source.dynamicGap, 'dynamicGap')
    };
}

function setProperties(target, config, gap) {
    if (!target.style || typeof target.style.setProperty !== 'function') return;
    const properties = {
        '--crosshair-color': config.color,
        '--crosshair-size': `${config.size}px`,
        '--crosshair-gap': `${gap}px`,
        '--crosshair-thickness': `${config.thickness}px`,
        '--crosshair-outline-thickness': `${config.outline ? config.outlineThickness : 0}px`,
        '--crosshair-opacity': String(config.opacity)
    };
    for (const [name, value] of Object.entries(properties)) target.style.setProperty(name, value);
    target.style.opacity = String(config.opacity);
}

function stylePart(part, config) {
    const outline = config.outline && config.outlineThickness > 0
        ? `0 0 0 ${config.outlineThickness}px #000000`
        : 'none';
    Object.assign(part.style, {
        position: 'absolute',
        background: config.color,
        boxShadow: outline,
        opacity: String(config.opacity)
    });
}

function appendPart(target, className, config, styles) {
    const documentRef = target.ownerDocument || globalThis.document;
    if (!documentRef || typeof documentRef.createElement !== 'function') return;
    const part = documentRef.createElement('div');
    part.className = className;
    stylePart(part, config);
    Object.assign(part.style, styles);
    target.appendChild(part);
}

function renderParts(target, config, gap) {
    if (typeof target.replaceChildren !== 'function' || typeof target.appendChild !== 'function') return;
    target.replaceChildren();

    const centered = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)'
    };
    const dotSize = config.style === 'dot' ? config.thickness + 4 : config.thickness + 2;

    if (config.style === 'circle') {
        appendPart(target, 'crosshair-circle', config, {
            ...centered,
            width: `${config.size * 2}px`,
            height: `${config.size * 2}px`,
            background: 'transparent',
            border: `${config.thickness}px solid ${config.color}`,
            borderRadius: '50%'
        });
    } else if (config.style === 'cross') {
        const lines = [
            ['top', { left: '50%', top: `calc(50% - ${gap + config.size}px)`, width: `${config.thickness}px`, height: `${config.size}px`, transform: 'translateX(-50%)' }],
            ['bottom', { left: '50%', top: `calc(50% + ${gap}px)`, width: `${config.thickness}px`, height: `${config.size}px`, transform: 'translateX(-50%)' }],
            ['left', { left: `calc(50% - ${gap + config.size}px)`, top: '50%', width: `${config.size}px`, height: `${config.thickness}px`, transform: 'translateY(-50%)' }],
            ['right', { left: `calc(50% + ${gap}px)`, top: '50%', width: `${config.size}px`, height: `${config.thickness}px`, transform: 'translateY(-50%)' }]
        ];
        for (const [direction, styles] of lines) {
            appendPart(target, `crosshair-line ${direction}`, config, styles);
        }
    }

    if (config.dot) {
        appendPart(target, 'crosshair-dot', config, {
            ...centered,
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '50%'
        });
    }
}

export function renderCrosshair(target, config, dynamicScale = 0) {
    const normalized = normalizeCrosshairConfig(config);
    if (!target) return normalized;

    const scale = typeof dynamicScale === 'number' && Number.isFinite(dynamicScale)
        ? Math.min(1, Math.max(0, dynamicScale))
        : 0;
    const gap = normalized.gap + normalized.dynamicGap * scale;

    if (target.classList) {
        target.classList.remove(...STYLE_CLASSES);
        target.classList.add('crosshair-rendered', `crosshair-style-${normalized.style}`);
    }
    if (typeof target.setAttribute === 'function') target.setAttribute('aria-hidden', 'true');
    setProperties(target, normalized, gap);
    renderParts(target, normalized, gap);
    return normalized;
}

function encodeBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = typeof globalThis.btoa === 'function'
        ? globalThis.btoa(binary)
        : Buffer.from(bytes).toString('base64');
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(payload) {
    const padding = '='.repeat((4 - payload.length % 4) % 4);
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/') + padding;
    if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(base64);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(base64, 'base64'));
}

function checksum(payload) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index++) {
        hash ^= payload.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function exportCrosshairCode(config) {
    const payload = encodeBase64Url(JSON.stringify(normalizeCrosshairConfig(config)));
    return `${CROSSHAIR_CODE_PREFIX}.${payload}.${checksum(payload)}`;
}

export function importCrosshairCode(code) {
    if (typeof code !== 'string' || code.length > MAX_CROSSHAIR_CODE_LENGTH) return null;
    const parts = code.split('.');
    const supportedPrefixes = [CROSSHAIR_CODE_PREFIX, ...LEGACY_CROSSHAIR_CODE_PREFIXES];
    if (parts.length !== 3 || !supportedPrefixes.includes(parts[0])) return null;

    const [, payload, expectedChecksum] = parts;
    if (!BASE64URL.test(payload) || !CHECKSUM.test(expectedChecksum)) return null;
    if (checksum(payload) !== expectedChecksum) return null;

    try {
        const parsed = JSON.parse(decodeBase64Url(payload));
        if (!isRecord(parsed)) return null;
        const keys = Object.keys(parsed);
        if (keys.length !== CONFIG_KEYS.length || keys.some(key => !CONFIG_KEYS.includes(key))) return null;
        return normalizeCrosshairConfig(parsed);
    } catch {
        return null;
    }
}
