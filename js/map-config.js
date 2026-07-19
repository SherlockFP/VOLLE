export const MAP_CONFIG_VERSION = 1;
export const MAX_MAP_PROPS = 64;
export const PRIMITIVE_TYPES = Object.freeze(['box', 'cylinder', 'sphere', 'cone']);
export const WEATHER_TYPES = Object.freeze(['none', 'clear', 'rain', 'storm', 'snow', 'indoor']);
export const FLAG_NAMES = Object.freeze(['openSides', 'openAir', 'lowGravity', 'slippery', 'portals']);

export const MAP_LIMITS = Object.freeze({
    width: Object.freeze([20, 300]),
    length: Object.freeze([20, 300]),
    wallHeight: Object.freeze([2, 80]),
    ceilingHeight: Object.freeze([0, 120]),
    propExtent: Object.freeze([0.25, 50]),
    propRadius: Object.freeze([0.25, 25]),
    propHeight: Object.freeze([0.25, 80])
});

const DEFAULTS = Object.freeze({
    name: 'Custom Arena',
    dimensions: Object.freeze({ width: 100, length: 120, wallHeight: 20, ceilingHeight: 30 }),
    colors: Object.freeze({
        floorRed: '#d85c5c',
        floorBlue: '#5c7fe0',
        wall: '#aac0d8',
        sky: '#88bbff',
        fog: '#cfeeff'
    }),
    weather: 'clear',
    flags: Object.freeze({
        openSides: false,
        openAir: false,
        lowGravity: false,
        slippery: false,
        portals: false
    })
});

const COLOR_KEYS = Object.freeze(Object.keys(DEFAULTS.colors));
const DANGEROUS_KEY = /^(?:code|script|html|url|uri|href|src|onclick|onload|prototype|constructor|__proto__)$/i;
const UNSAFE_TEXT = /(?:https?:\/\/|www\.|data:|javascript:|vbscript:|file:|<[^>]*>|=>|\b(?:eval|function)\s*\()/i;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function clampNumber(value, min, max, fallback) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeColor(value, fallback = '#ffffff') {
    if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) {
        return `#${value.toString(16).padStart(6, '0')}`;
    }
    if (typeof value !== 'string') return fallback;
    const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return fallback;
    const hex = match[1].length === 3
        ? [...match[1]].map(char => char + char).join('')
        : match[1];
    return `#${hex.toLowerCase()}`;
}

export function isSafeText(value) {
    return typeof value === 'string'
        && !/[\u0000-\u001f\u007f]/.test(value)
        && !UNSAFE_TEXT.test(value);
}

function normalizeName(value) {
    if (!isSafeText(value)) return DEFAULTS.name;
    const name = value.trim().replace(/\s+/g, ' ').slice(0, 48);
    return name || DEFAULTS.name;
}

function normalizeDimensions(value) {
    const source = isRecord(value) ? value : {};
    return {
        width: clampNumber(source.width, ...MAP_LIMITS.width, DEFAULTS.dimensions.width),
        length: clampNumber(source.length, ...MAP_LIMITS.length, DEFAULTS.dimensions.length),
        wallHeight: clampNumber(source.wallHeight, ...MAP_LIMITS.wallHeight, DEFAULTS.dimensions.wallHeight),
        ceilingHeight: clampNumber(
            source.ceilingHeight,
            ...MAP_LIMITS.ceilingHeight,
            DEFAULTS.dimensions.ceilingHeight
        )
    };
}

function normalizeColors(value) {
    const source = isRecord(value) ? value : {};
    return Object.fromEntries(COLOR_KEYS.map(key => [
        key,
        normalizeColor(source[key], DEFAULTS.colors[key])
    ]));
}

function normalizeFlags(value) {
    const source = isRecord(value) ? value : {};
    return Object.fromEntries(FLAG_NAMES.map(key => [key, source[key] === true]));
}

function positionSource(value) {
    if (Array.isArray(value)) return { x: value[0], y: value[1], z: value[2] };
    return isRecord(value) ? value : {};
}

function sizeSource(value, type) {
    if (!Array.isArray(value)) return isRecord(value) ? value : {};
    if (type === 'box') return { width: value[0], height: value[1], depth: value[2] };
    if (type === 'sphere') return { radius: value[0] };
    return { radius: value[0], height: value[1] };
}

function normalizeSize(value, type) {
    const source = sizeSource(value, type);
    if (type === 'box') {
        return {
            width: clampNumber(source.width, ...MAP_LIMITS.propExtent, 4),
            height: clampNumber(source.height, ...MAP_LIMITS.propHeight, 4),
            depth: clampNumber(source.depth, ...MAP_LIMITS.propExtent, 4)
        };
    }
    if (type === 'sphere') {
        return { radius: clampNumber(source.radius, ...MAP_LIMITS.propRadius, 2) };
    }
    return {
        radius: clampNumber(source.radius, ...MAP_LIMITS.propRadius, 2),
        height: clampNumber(source.height, ...MAP_LIMITS.propHeight, 6)
    };
}

function propHalfHeight(type, size) {
    return type === 'sphere' ? size.radius : size.height / 2;
}

function uniquePropId(value, index, usedIds) {
    const requested = typeof value === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value)
        ? value
        : `prop-${index + 1}`;
    let id = requested;
    let suffix = 2;
    while (usedIds.has(id)) id = `${requested.slice(0, 35)}-${suffix++}`;
    usedIds.add(id);
    return id;
}

function normalizeProp(value, index, dimensions, usedIds) {
    const source = isRecord(value) ? value : {};
    const type = PRIMITIVE_TYPES.includes(source.type) ? source.type : 'box';
    const size = normalizeSize(source.size, type);
    const position = positionSource(source.position ?? source.pos);
    const maxY = dimensions.ceilingHeight > 0 ? dimensions.ceilingHeight : MAP_LIMITS.ceilingHeight[1];
    return {
        id: uniquePropId(source.id, index, usedIds),
        type,
        position: {
            x: clampNumber(position.x, -dimensions.width / 2, dimensions.width / 2, 0),
            y: clampNumber(position.y, 0, maxY, propHalfHeight(type, size)),
            z: clampNumber(position.z, -dimensions.length / 2, dimensions.length / 2, 0)
        },
        size,
        color: normalizeColor(source.color, '#cccccc')
    };
}

export function normalizeMapConfig(value = {}) {
    const source = isRecord(value) ? value : {};
    const dimensions = normalizeDimensions(source.dimensions);
    const props = Array.isArray(source.props) ? source.props.slice(0, MAX_MAP_PROPS) : [];
    const usedIds = new Set();
    return {
        version: MAP_CONFIG_VERSION,
        name: normalizeName(source.name),
        dimensions,
        colors: normalizeColors(source.colors),
        weather: WEATHER_TYPES.includes(source.weather) ? source.weather : DEFAULTS.weather,
        flags: normalizeFlags(source.flags),
        props: props.map((prop, index) => normalizeProp(prop, index, dimensions, usedIds))
    };
}

function containsUnsafeContent(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') return !isSafeText(value);
    if (!value || typeof value !== 'object') return false;
    if (depth > 8 || seen.has(value)) return true;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
        if (DANGEROUS_KEY.test(key) || containsUnsafeContent(child, seen, depth + 1)) return true;
    }
    return false;
}

function checkNumber(errors, value, limits, path) {
    if (value === undefined) return;
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number < limits[0] || number > limits[1]) {
        errors.push(`${path} must be between ${limits[0]} and ${limits[1]}`);
    }
}

function validateProp(errors, prop, index, dimensions) {
    const path = `props[${index}]`;
    if (!isRecord(prop)) {
        errors.push(`${path} must be an object`);
        return;
    }
    const type = PRIMITIVE_TYPES.includes(prop.type) ? prop.type : 'box';
    if (type !== prop.type) errors.push(`${path}.type is not allowed`);
    if (prop.id !== undefined && (typeof prop.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(prop.id))) {
        errors.push(`${path}.id is not allowed`);
    }
    if (prop.color !== undefined && normalizeColor(prop.color, null) === null) {
        errors.push(`${path}.color must be a hex color`);
    }
    const position = positionSource(prop.position ?? prop.pos);
    const maxY = dimensions.ceilingHeight > 0 ? dimensions.ceilingHeight : MAP_LIMITS.ceilingHeight[1];
    checkNumber(errors, position.x, [-dimensions.width / 2, dimensions.width / 2], `${path}.position.x`);
    checkNumber(errors, position.y, [0, maxY], `${path}.position.y`);
    checkNumber(errors, position.z, [-dimensions.length / 2, dimensions.length / 2], `${path}.position.z`);
    const size = sizeSource(prop.size, type);
    if (type === 'box') {
        checkNumber(errors, size.width, MAP_LIMITS.propExtent, `${path}.size.width`);
        checkNumber(errors, size.height, MAP_LIMITS.propHeight, `${path}.size.height`);
        checkNumber(errors, size.depth, MAP_LIMITS.propExtent, `${path}.size.depth`);
    } else {
        checkNumber(errors, size.radius, MAP_LIMITS.propRadius, `${path}.size.radius`);
        if (type !== 'sphere') {
            checkNumber(errors, size.height, MAP_LIMITS.propHeight, `${path}.size.height`);
        }
    }
}

export function validateMapConfig(value) {
    const errors = [];
    if (!isRecord(value)) {
        errors.push('config must be an object');
        return { valid: false, errors, config: normalizeMapConfig() };
    }
    if (containsUnsafeContent(value)) errors.push('config contains URL, code, markup, or unsafe keys');
    if (value.name !== undefined && (!isSafeText(value.name) || !value.name.trim() || value.name.trim().length > 48)) {
        errors.push('name must be safe text up to 48 characters');
    }
    if (value.dimensions !== undefined && !isRecord(value.dimensions)) {
        errors.push('dimensions must be an object');
    } else if (isRecord(value.dimensions)) {
        checkNumber(errors, value.dimensions.width, MAP_LIMITS.width, 'dimensions.width');
        checkNumber(errors, value.dimensions.length, MAP_LIMITS.length, 'dimensions.length');
        checkNumber(errors, value.dimensions.wallHeight, MAP_LIMITS.wallHeight, 'dimensions.wallHeight');
        checkNumber(errors, value.dimensions.ceilingHeight, MAP_LIMITS.ceilingHeight, 'dimensions.ceilingHeight');
    }
    if (value.colors !== undefined && !isRecord(value.colors)) {
        errors.push('colors must be an object');
    } else if (isRecord(value.colors)) {
        for (const [key, color] of Object.entries(value.colors)) {
            if (!COLOR_KEYS.includes(key)) errors.push(`colors.${key} is not allowed`);
            else if (normalizeColor(color, null) === null) errors.push(`colors.${key} must be a hex color`);
        }
    }
    if (value.weather !== undefined && !WEATHER_TYPES.includes(value.weather)) {
        errors.push('weather is not allowed');
    }
    if (value.flags !== undefined && !isRecord(value.flags)) {
        errors.push('flags must be an object');
    } else if (isRecord(value.flags)) {
        for (const [key, flag] of Object.entries(value.flags)) {
            if (!FLAG_NAMES.includes(key)) errors.push(`flags.${key} is not allowed`);
            else if (typeof flag !== 'boolean') errors.push(`flags.${key} must be boolean`);
        }
    }
    if (value.props !== undefined && !Array.isArray(value.props)) {
        errors.push('props must be an array');
    } else if (Array.isArray(value.props)) {
        if (value.props.length > MAX_MAP_PROPS) errors.push(`props cannot exceed ${MAX_MAP_PROPS}`);
        const dimensions = normalizeDimensions(value.dimensions);
        value.props.slice(0, MAX_MAP_PROPS)
            .forEach((prop, index) => validateProp(errors, prop, index, dimensions));
    }
    return { valid: errors.length === 0, errors, config: normalizeMapConfig(value) };
}

export function addMapProp(config, prop) {
    const normalized = normalizeMapConfig(config);
    if (normalized.props.length >= MAX_MAP_PROPS) return normalized;
    return normalizeMapConfig({ ...normalized, props: [...normalized.props, prop] });
}

export function deleteMapProp(config, propId) {
    const normalized = normalizeMapConfig(config);
    return {
        ...normalized,
        props: normalized.props.filter(prop => prop.id !== propId)
    };
}
