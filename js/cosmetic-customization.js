import { KNIVES } from './cosmetics.js';

const freezeList = values => Object.freeze([...values]);

export const COSMETIC_LIMITS = Object.freeze({
    stickerSlots: 4,
    nameTagLength: 24,
    patternSeed: 999999,
    tradeUpDuplicates: 10,
    maxInventoryCount: 999
});

export const COSMETIC_ALLOWLISTS = Object.freeze({
    stickers: freezeList(['ace', 'bolt', 'crown', 'flame', 'frost', 'gg', 'skull', 'star']),
    charms: freezeList(['ball', 'boot', 'glove', 'trophy']),
    mvpEffects: freezeList(['none', 'confetti', 'spotlight']),
    ballTrails: freezeList(['none', 'comet', 'electric', 'rainbow']),
    goalEffects: freezeList(['none', 'burst', 'fireworks', 'shockwave'])
});

export const PATTERN_PALETTES = Object.freeze({
    spectrum: freezeList(['#ff4d6d', '#ffca3a', '#8ac926', '#22b8cf', '#6c5ce7', '#f06595']),
    ember: freezeList(['#ffba08', '#f48c06', '#dc2f02', '#6a040f']),
    tide: freezeList(['#90e0ef', '#00b4d8', '#0077b6', '#03045e'])
});

export const DEFAULT_COSMETIC_LOADOUT = Object.freeze({
    version: 2,
    knife: Object.freeze({
        id: 'training',
        stickers: Object.freeze([null, null, null, null]),
        charm: null,
        nameTag: '',
        patternSeed: 0,
        wear: 0
    }),
    mvpEffect: 'none',
    ballTrail: 'none',
    goalEffect: 'none'
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowed = (kind, id) => typeof id === 'string' && COSMETIC_ALLOWLISTS[kind].includes(id);

function clampNumber(value, minimum, maximum, fallback) {
    let number;
    try {
        number = Number(value);
    } catch {
        return fallback;
    }
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizeSlot(kind, value) {
    return allowed(kind, value) ? value : 'none';
}

function normalizeSticker(value) {
    return allowed('stickers', value) ? value : null;
}

function owned(ownership, type, id) {
    if (id === null || id === 'none' || id === 'training') return true;
    if (typeof ownership === 'function') return ownership(type, id) === true;
    if (!isRecord(ownership)) return false;
    const plural = type === 'knife' ? 'knives' : `${type}s`;
    const collection = ownership[type] ?? ownership[plural];
    if (Array.isArray(collection) || collection instanceof Set) return collection.includes?.(id) ?? collection.has(id);
    if (isRecord(collection)) return collection[id] === true || Number(collection[id]) > 0;
    return false;
}

function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function cloneDefault() {
    return {
        version: DEFAULT_COSMETIC_LOADOUT.version,
        knife: {
            ...DEFAULT_COSMETIC_LOADOUT.knife,
            stickers: [...DEFAULT_COSMETIC_LOADOUT.knife.stickers]
        },
        mvpEffect: DEFAULT_COSMETIC_LOADOUT.mvpEffect,
        ballTrail: DEFAULT_COSMETIC_LOADOUT.ballTrail,
        goalEffect: DEFAULT_COSMETIC_LOADOUT.goalEffect
    };
}

export function sanitizeNameTag(value) {
    if (typeof value !== 'string') return '';
    const safe = value
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
        .replace(/[<>&"'`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return [...safe].slice(0, COSMETIC_LIMITS.nameTagLength).join('');
}

export function normalizePatternSeed(value) {
    return Math.trunc(clampNumber(value, 0, COSMETIC_LIMITS.patternSeed, 0));
}

export function normalizeWear(value) {
    return Math.round(clampNumber(value, 0, 1, 0) * 1000000) / 1000000;
}

export function patternColors(seed, palette = 'spectrum', count = 3) {
    const paletteId = typeof palette === 'string' && hasOwn(PATTERN_PALETTES, palette) ? palette : 'spectrum';
    const colors = PATTERN_PALETTES[paletteId];
    const length = Math.min(colors.length, Math.max(1, Math.trunc(clampNumber(count, 1, 8, 3))));
    let state = (normalizePatternSeed(seed) ^ hashText(paletteId)) >>> 0;
    const result = [];
    const available = [...colors];
    while (result.length < length) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        result.push(available.splice((state >>> 0) % available.length, 1)[0]);
    }
    return result;
}

export const getPatternColors = patternColors;

export function normalizeKnifeLoadout(value = {}) {
    const source = isRecord(value) ? value : {};
    const rawStickers = Array.isArray(source.stickers) ? source.stickers : [];
    const stickers = Array.from(
        { length: COSMETIC_LIMITS.stickerSlots },
        (_, index) => normalizeSticker(rawStickers[index])
    );
    return {
        id: typeof source.id === 'string' && hasOwn(KNIVES, source.id) ? source.id : 'training',
        stickers,
        charm: allowed('charms', source.charm) ? source.charm : null,
        nameTag: sanitizeNameTag(source.nameTag),
        patternSeed: normalizePatternSeed(source.patternSeed),
        wear: normalizeWear(source.wear)
    };
}

export function normalizeCosmeticLoadout(value = {}) {
    const source = isRecord(value) ? value : {};
    return {
        version: 2,
        knife: normalizeKnifeLoadout(source.knife),
        mvpEffect: normalizeSlot('mvpEffects', source.mvpEffect),
        ballTrail: normalizeSlot('ballTrails', source.ballTrail),
        goalEffect: normalizeSlot('goalEffects', source.goalEffect)
    };
}

export function validateCosmeticEquip(loadout, { team, ownership } = {}) {
    const source = isRecord(loadout) ? loadout : {};
    const knife = isRecord(source.knife) ? source.knife : {};
    const errors = [];

    if (typeof knife.id !== 'string' || !hasOwn(KNIVES, knife.id)) {
        errors.push('knife is not allowed');
    } else {
        if (team !== 'red' && team !== 'blue') errors.push('team is invalid');
        else if (!KNIVES[knife.id].teams.includes(team)) errors.push('knife is not available for team');
        if (!owned(ownership, 'knife', knife.id)) errors.push('knife is not owned');
    }

    const stickers = Array.isArray(knife.stickers) ? knife.stickers : [];
    if (stickers.length > COSMETIC_LIMITS.stickerSlots) errors.push('sticker slot limit exceeded');
    for (const sticker of stickers) {
        if (sticker !== null && !allowed('stickers', sticker)) errors.push('sticker is not allowed');
        else if (sticker !== null && !owned(ownership, 'sticker', sticker)) errors.push('sticker is not owned');
    }

    if (knife.charm !== null && knife.charm !== undefined) {
        if (!allowed('charms', knife.charm)) errors.push('charm is not allowed');
        else if (!owned(ownership, 'charm', knife.charm)) errors.push('charm is not owned');
    }
    if (sanitizeNameTag(knife.nameTag) !== (knife.nameTag ?? '')) errors.push('name tag is invalid');
    if (normalizePatternSeed(knife.patternSeed) !== knife.patternSeed) errors.push('pattern seed is invalid');
    if (normalizeWear(knife.wear) !== knife.wear) errors.push('wear is invalid');

    for (const [field, kind, type] of [
        ['mvpEffect', 'mvpEffects', 'mvpEffect'],
        ['ballTrail', 'ballTrails', 'ballTrail'],
        ['goalEffect', 'goalEffects', 'goalEffect']
    ]) {
        if (!allowed(kind, source[field])) errors.push(`${field} is not allowed`);
        else if (!owned(ownership, type, source[field])) errors.push(`${field} is not owned`);
    }

    return { valid: errors.length === 0, errors };
}

export function canEquipCosmeticLoadout(loadout, context) {
    return validateCosmeticEquip(loadout, context).valid;
}

function normalizeInventory(inventory) {
    const result = Object.create(null);
    if (!isRecord(inventory)) return result;
    for (const [id, count] of Object.entries(inventory)) {
        if (!/^[a-z0-9_-]{1,64}$/.test(id)) continue;
        result[id] = Math.trunc(clampNumber(count, 0, COSMETIC_LIMITS.maxInventoryCount, 0));
    }
    return result;
}

export function deterministicDuplicateTradeUp(inventory, cosmeticId, rewardPool) {
    const source = normalizeInventory(inventory);
    if (!/^[a-z0-9_-]{1,64}$/.test(cosmeticId || '')) throw new TypeError('cosmeticId is invalid');
    if ((source[cosmeticId] || 0) < COSMETIC_LIMITS.tradeUpDuplicates) {
        throw new RangeError('duplicate trade-up requires 10 copies');
    }
    const rewards = [...new Set(Array.isArray(rewardPool) ? rewardPool : [])]
        .filter(id => /^[a-z0-9_-]{1,64}$/.test(id) && id !== cosmeticId)
        .sort();
    if (!rewards.length) throw new RangeError('reward pool is empty');

    const nonce = Math.floor(source[cosmeticId] / COSMETIC_LIMITS.tradeUpDuplicates);
    const rewardId = rewards[hashText(`${cosmeticId}:${nonce}:${rewards.join(',')}`) % rewards.length];
    const nextInventory = { ...source };
    nextInventory[cosmeticId] -= COSMETIC_LIMITS.tradeUpDuplicates;
    if (nextInventory[cosmeticId] === 0) delete nextInventory[cosmeticId];
    nextInventory[rewardId] = Math.min(COSMETIC_LIMITS.maxInventoryCount, (nextInventory[rewardId] || 0) + 1);
    return { inventory: nextInventory, consumedId: cosmeticId, consumed: 10, rewardId };
}

export const tradeUpDuplicates = deterministicDuplicateTradeUp;

export function migrateCosmeticLoadout(value) {
    if (!isRecord(value)) return cloneDefault();
    const source = isRecord(value.cosmetics) ? value.cosmetics : value;
    const legacyKnife = typeof source.knife === 'string'
        ? { id: source.knife }
        : (isRecord(source.knife) ? source.knife : {});
    const migrated = {
        knife: {
            id: legacyKnife.id ?? source.knifeId ?? source.equippedKnife,
            stickers: legacyKnife.stickers ?? source.knifeStickers ?? source.stickers,
            charm: legacyKnife.charm ?? source.knifeCharm ?? source.charm,
            nameTag: legacyKnife.nameTag ?? source.knifeNameTag ?? source.nameTag,
            patternSeed: legacyKnife.patternSeed ?? source.patternSeed ?? source.seed,
            wear: legacyKnife.wear ?? source.wear
        },
        mvpEffect: source.mvpEffect ?? source.mvp,
        ballTrail: source.ballTrail ?? source.trail,
        goalEffect: source.goalEffect ?? source.goal
    };
    return normalizeCosmeticLoadout(migrated);
}

export const normalizeCosmeticCustomization = migrateCosmeticLoadout;
