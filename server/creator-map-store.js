const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAP_KEYS = ['version', 'name', 'dimensions', 'colors', 'weather', 'flags', 'props'];
const DIMENSION_KEYS = ['width', 'length', 'wallHeight', 'ceilingHeight'];
const COLOR_KEYS = ['floorRed', 'floorBlue', 'wall', 'sky', 'fog'];
const FLAG_KEYS = ['openSides', 'openAir', 'lowGravity', 'slippery', 'portals'];
const PROP_KEYS = ['id', 'type', 'position', 'size', 'color'];
const POSITION_KEYS = ['x', 'y', 'z'];
const WEATHER = new Set(['none', 'clear', 'rain', 'storm', 'snow', 'indoor']);
const PROP_TYPES = new Set(['box', 'cylinder', 'sphere', 'cone']);
const MAX_MAPS_PER_CREATOR = 20;

function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
    return isRecord(value) && Object.keys(value).every(key => allowed.includes(key));
}

function safeText(value, maxLength, fallback = '') {
    if (typeof value !== 'string') return null;
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text || [...text].length > maxLength) return null;
    if (/[\u0000-\u001f\u007f<>]|(?:javascript|data):|:\/\//i.test(text)) return null;
    return text || fallback;
}

function finiteInRange(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
}

function normalizeColor(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return null;
    const hex = value.toLowerCase();
    return hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
}

function validateSize(type, size) {
    if (!isRecord(size)) return null;
    if (type === 'box') {
        if (!hasExactKeys(size, ['width', 'height', 'depth'])) return null;
        if (!finiteInRange(size.width, 0.25, 50)
            || !finiteInRange(size.height, 0.25, 80)
            || !finiteInRange(size.depth, 0.25, 50)) return null;
        return { width: size.width, height: size.height, depth: size.depth };
    }
    if (type === 'sphere') {
        if (!hasExactKeys(size, ['radius']) || !finiteInRange(size.radius, 0.25, 25)) return null;
        return { radius: size.radius };
    }
    if (!hasExactKeys(size, ['radius', 'height'])
        || !finiteInRange(size.radius, 0.25, 25)
        || !finiteInRange(size.height, 0.25, 80)) return null;
    return { radius: size.radius, height: size.height };
}

function propFitsArena(type, position, size, dimensions) {
    const halfWidth = dimensions.width / 2;
    const halfLength = dimensions.length / 2;
    const maxY = dimensions.ceilingHeight > 0 ? dimensions.ceilingHeight : 120;
    const radiusX = type === 'box' ? size.width / 2 : size.radius;
    const radiusZ = type === 'box' ? size.depth / 2 : size.radius;
    const halfHeight = type === 'sphere' ? size.radius : size.height / 2;
    return Math.abs(position.x) + radiusX <= halfWidth
        && Math.abs(position.z) + radiusZ <= halfLength
        && position.y - halfHeight >= 0
        && position.y + halfHeight <= maxY;
}

function validateCreatorMap(input) {
    const errors = [];
    if (!hasExactKeys(input, MAP_KEYS)) return { valid: false, errors: ['invalid map schema'] };
    if (input.version !== 1) errors.push('unsupported map version');
    const name = safeText(input.name, 48);
    if (!name) errors.push('invalid map name');

    const d = input.dimensions;
    if (!hasExactKeys(d, DIMENSION_KEYS)
        || !finiteInRange(d.width, 20, 300)
        || !finiteInRange(d.length, 20, 300)
        || !finiteInRange(d.wallHeight, 2, 80)
        || !finiteInRange(d.ceilingHeight, 0, 120)) {
        errors.push('invalid dimensions');
    }
    const dimensions = errors.includes('invalid dimensions') ? null : {
        width: d.width,
        length: d.length,
        wallHeight: d.wallHeight,
        ceilingHeight: d.ceilingHeight
    };

    const colors = {};
    if (!hasExactKeys(input.colors, COLOR_KEYS)) {
        errors.push('invalid colors');
    } else {
        for (const key of COLOR_KEYS) {
            const color = normalizeColor(input.colors[key]);
            if (!color) errors.push(`invalid color: ${key}`);
            else colors[key] = color;
        }
    }

    if (!WEATHER.has(input.weather)) errors.push('invalid weather');
    const flags = {};
    if (!hasExactKeys(input.flags, FLAG_KEYS)) {
        errors.push('invalid flags');
    } else {
        for (const key of FLAG_KEYS) {
            if (typeof input.flags[key] !== 'boolean') errors.push(`invalid flag: ${key}`);
            else flags[key] = input.flags[key];
        }
    }

    const props = [];
    const ids = new Set();
    if (!Array.isArray(input.props) || input.props.length > 64) {
        errors.push('invalid props');
    } else if (dimensions) {
        input.props.forEach((prop, index) => {
            if (!hasExactKeys(prop, PROP_KEYS)
                || typeof prop.id !== 'string'
                || !/^[a-z0-9_-]{1,40}$/.test(prop.id)
                || ids.has(prop.id)
                || !PROP_TYPES.has(prop.type)
                || !hasExactKeys(prop.position, POSITION_KEYS)) {
                errors.push(`invalid prop: ${index}`);
                return;
            }
            const position = {
                x: prop.position.x,
                y: prop.position.y,
                z: prop.position.z
            };
            if (!Object.values(position).every(Number.isFinite)) {
                errors.push(`invalid prop position: ${index}`);
                return;
            }
            const size = validateSize(prop.type, prop.size);
            const color = normalizeColor(prop.color);
            if (!size || !color || !propFitsArena(prop.type, position, size, dimensions)) {
                errors.push(`unsafe prop bounds: ${index}`);
                return;
            }
            ids.add(prop.id);
            props.push({ id: prop.id, type: prop.type, position, size, color });
        });
    }

    if (errors.length) return { valid: false, errors: errors.slice(0, 8) };
    return {
        valid: true,
        errors: [],
        config: {
            version: 1,
            name,
            dimensions,
            colors,
            weather: input.weather,
            flags,
            props
        }
    };
}

class CreatorMapStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.records = this._read();
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return isRecord(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    _save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.records, null, 2));
        fs.renameSync(temp, this.filePath);
    }

    _checksum(config) {
        return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
    }

    _summary(record) {
        const { config, moderationNote, moderatedAt, ...summary } = record;
        return { ...summary, propCount: config.props.length };
    }

    _ownerSummary(record) {
        return {
            ...this._summary(record),
            moderationNote: record.moderationNote || '',
            moderatedAt: record.moderatedAt || null
        };
    }

    publish(profile, payload = {}) {
        const validation = validateCreatorMap(payload.config);
        if (!validation.valid) return { status: 400, error: validation.errors[0] || 'invalid map' };
        const emptyDescription = payload.description === undefined
            || (typeof payload.description === 'string' && !payload.description.trim());
        const description = emptyDescription ? '' : safeText(payload.description, 160);
        if (description === null) return { status: 400, error: 'invalid description' };

        const checksum = this._checksum(validation.config);
        const requestedId = typeof payload.mapId === 'string' ? payload.mapId : '';
        let record = requestedId ? this.records[requestedId] : null;
        if (record && record.creatorId !== profile.id) return { status: 403, error: 'forbidden' };
        if (!record) {
            record = Object.values(this.records).find(item =>
                item.creatorId === profile.id && item.checksum === checksum
            );
            if (record) return { status: 200, map: this._summary(record), replayed: true };
            const count = Object.values(this.records).filter(item => item.creatorId === profile.id).length;
            if (count >= MAX_MAPS_PER_CREATOR) return { status: 409, error: 'creator map limit reached' };
            const id = crypto.randomUUID();
            const now = Date.now();
            record = {
                id,
                creatorId: profile.id,
                creatorName: String(profile.playerName || 'Creator').slice(0, 16),
                name: validation.config.name,
                description,
                status: 'pending',
                revision: 1,
                checksum,
                config: validation.config,
                createdAt: now,
                updatedAt: now
            };
            this.records[id] = record;
        } else {
            if (record.checksum === checksum && record.description === description) {
                return { status: 200, map: this._summary(record), replayed: true };
            }
            record.name = validation.config.name;
            record.description = description;
            record.status = 'pending';
            delete record.moderationNote;
            delete record.moderatedAt;
            record.revision = Math.max(1, Number(record.revision) || 1) + 1;
            record.checksum = checksum;
            record.config = validation.config;
            record.updatedAt = Date.now();
        }
        this._save();
        return { status: 201, map: this._summary(record), replayed: false };
    }

    list({ creatorId = '', cursor = 0, limit = 20, query = '', sort = 'newest' } = {}) {
        const safeCursor = Math.max(0, Math.floor(Number(cursor) || 0));
        const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
        const safeQuery = typeof query === 'string' ? query.trim().slice(0, 48).toLowerCase() : '';
        const maps = Object.values(this.records)
            .filter(record => creatorId ? record.creatorId === creatorId : record.status === 'approved')
            .filter(record => !safeQuery || [
                record.name,
                record.creatorName,
                record.description
            ].some(value => String(value || '').toLowerCase().includes(safeQuery)))
            .sort((a, b) => {
                if (sort === 'oldest') return a.createdAt - b.createdAt;
                if (sort === 'name') return a.name.localeCompare(b.name);
                return b.updatedAt - a.updatedAt;
            });
        const summarize = creatorId
            ? record => this._ownerSummary(record)
            : record => this._summary(record);
        const page = maps.slice(safeCursor, safeCursor + safeLimit).map(summarize);
        const next = safeCursor + page.length;
        return {
            maps: page,
            nextCursor: next < maps.length ? String(next) : null
        };
    }

    get(id, requesterId = '') {
        const record = this.records[id];
        if (!record || (record.status !== 'approved' && record.creatorId !== requesterId)) {
            return { status: 404, error: 'map not found' };
        }
        return {
            status: 200,
            map: {
                ...(record.creatorId === requesterId ? this._ownerSummary(record) : this._summary(record)),
                config: record.config
            }
        };
    }

    moderate(id, status, note = '') {
        const record = this.records[id];
        if (!record) return { status: 404, error: 'map not found' };
        if (!['approved', 'rejected'].includes(status)) {
            return { status: 400, error: 'invalid moderation status' };
        }
        const emptyNote = note === undefined
            || (typeof note === 'string' && !note.trim());
        const moderationNote = emptyNote ? '' : safeText(note, 160);
        if (moderationNote === null) return { status: 400, error: 'invalid moderation note' };
        record.status = status;
        record.moderationNote = moderationNote;
        record.moderatedAt = Date.now();
        record.updatedAt = record.moderatedAt;
        this._save();
        return { status: 200, map: this._ownerSummary(record) };
    }
}

module.exports = { CreatorMapStore, MAX_MAPS_PER_CREATOR, validateCreatorMap };
