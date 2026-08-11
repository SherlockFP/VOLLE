// Server-owned mirror of js/cards.js. Cards are earned, never bought, and
// remain disabled in ranked through the client-side normalized loadout.
const crypto = require('crypto');

const CARD_RARITIES = Object.freeze({
    common: Object.freeze({ rank: 0, label: 'Common', weight: 58 }),
    rare: Object.freeze({ rank: 1, label: 'Rare', weight: 28 }),
    epic: Object.freeze({ rank: 2, label: 'Epic', weight: 11 }),
    legendary: Object.freeze({ rank: 3, label: 'Legendary', weight: 3 })
});

const ARENA_CARDS = Object.freeze({
    'orbit-slow': Object.freeze({ id: 'orbit-slow', name: 'Orbit Slow', rarity: 'common', slot: 'active', effectId: 'slow' }),
    'deflect-plate': Object.freeze({ id: 'deflect-plate', name: 'Deflect Plate', rarity: 'common', slot: 'passive', effectId: 'deflect_power' }),
    'vital-core': Object.freeze({ id: 'vital-core', name: 'Vital Core', rarity: 'common', slot: 'passive', effectId: 'hp_bonus' }),
    'mender-pulse': Object.freeze({ id: 'mender-pulse', name: 'Mender Pulse', rarity: 'common', slot: 'active', effectId: 'heal' }),
    'glacier-lock': Object.freeze({ id: 'glacier-lock', name: 'Glacier Lock', rarity: 'rare', slot: 'active', effectId: 'freeze' }),
    'ember-mark': Object.freeze({ id: 'ember-mark', name: 'Ember Mark', rarity: 'rare', slot: 'active', effectId: 'burn' }),
    'bastion-shield': Object.freeze({ id: 'bastion-shield', name: 'Bastion Shield', rarity: 'rare', slot: 'active', effectId: 'shield' }),
    'kinetic-step': Object.freeze({ id: 'kinetic-step', name: 'Kinetic Step', rarity: 'rare', slot: 'passive', effectId: 'speed_bonus' }),
    'recovery-loop': Object.freeze({ id: 'recovery-loop', name: 'Recovery Loop', rarity: 'rare', slot: 'passive', effectId: 'stam_regen' }),
    'rift-step': Object.freeze({ id: 'rift-step', name: 'Rift Step', rarity: 'epic', slot: 'active', effectId: 'teleport' }),
    'gravity-well': Object.freeze({ id: 'gravity-well', name: 'Gravity Well', rarity: 'epic', slot: 'active', effectId: 'blackhole' }),
    'chrono-coil': Object.freeze({ id: 'chrono-coil', name: 'Chrono Coil', rarity: 'epic', slot: 'passive', effectId: 'cooldown_red' }),
    'siphon-thread': Object.freeze({ id: 'siphon-thread', name: 'Siphon Thread', rarity: 'epic', slot: 'passive', effectId: 'lifesteal' }),
    'apex-smash': Object.freeze({ id: 'apex-smash', name: 'Apex Smash', rarity: 'legendary', slot: 'active', effectId: 'smash' }),
    'iron-resolve': Object.freeze({ id: 'iron-resolve', name: 'Iron Resolve', rarity: 'legendary', slot: 'passive', effectId: 'dmg_resist' }),
    'thorn-mesh': Object.freeze({ id: 'thorn-mesh', name: 'Thorn Mesh', rarity: 'legendary', slot: 'passive', effectId: 'thorns' })
});

const DEFAULT_CARD_COLLECTION = Object.freeze({ 'orbit-slow': 1, 'deflect-plate': 1 });
const DEFAULT_CARD_LOADOUT = Object.freeze({ active: 'orbit-slow', passive: 'deflect-plate' });
const RARITY_IDS = Object.freeze(Object.keys(CARD_RARITIES));
const MAX_CARD_COPIES = 999;

function clampInt(value, min, max) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function normalizeCardCollection(input) {
    const collection = { ...DEFAULT_CARD_COLLECTION };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return collection;
    for (const [cardId, copies] of Object.entries(input)) {
        if (ARENA_CARDS[cardId]) collection[cardId] = clampInt(copies, 0, MAX_CARD_COPIES);
    }
    return collection;
}

function normalizeCardLoadout(input, collection = DEFAULT_CARD_COLLECTION) {
    const safeCollection = normalizeCardCollection(collection);
    const result = { ...DEFAULT_CARD_LOADOUT };
    for (const slot of ['active', 'passive']) {
        const cardId = input?.[slot];
        if (ARENA_CARDS[cardId]?.slot === slot && safeCollection[cardId] > 0) result[slot] = cardId;
    }
    return result;
}

function cardSeedUnit(seed, salt = '') {
    const text = `${String(seed || 'arena-cache')}:${salt}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) + 0.5) / 4294967296;
}

function cardsForRarity(rarity) {
    return Object.values(ARENA_CARDS).filter(card => card.rarity === rarity);
}

function shouldAwardArenaCache({ matchId, won = false, leveledUp = false } = {}) {
    if (leveledUp) return true;
    return cardSeedUnit(matchId, 'earn') < (won ? 0.35 : 0.18);
}

function rollArenaCache(seed = 'arena-cache') {
    const roll = cardSeedUnit(seed, 'rarity') * 100;
    let total = 0;
    let rarity = 'legendary';
    for (const candidate of RARITY_IDS) {
        total += CARD_RARITIES[candidate].weight;
        if (roll < total) { rarity = candidate; break; }
    }
    const choices = cardsForRarity(rarity);
    return { card: choices[Math.min(choices.length - 1, Math.floor(cardSeedUnit(seed, 'card') * choices.length))], rarity };
}

function grantArenaCache(collection, seed) {
    const next = normalizeCardCollection(collection);
    const reward = rollArenaCache(seed);
    next[reward.card.id] = clampInt((next[reward.card.id] || 0) + 1, 0, MAX_CARD_COPIES);
    return { collection: next, reward: { ...reward, duplicate: next[reward.card.id] > 1 } };
}

function tradeUpCards(collection, cardIds, seed = crypto.randomUUID()) {
    const next = normalizeCardCollection(collection);
    if (!Array.isArray(cardIds) || cardIds.length !== 5) return null;
    const cards = cardIds.map(id => ARENA_CARDS[id]);
    if (cards.some(card => !card)) return null;
    const rarity = cards[0].rarity;
    if (!cards.every(card => card.rarity === rarity) || rarity === 'legendary') return null;
    const requested = {};
    for (const card of cards) requested[card.id] = (requested[card.id] || 0) + 1;
    if (Object.entries(requested).some(([id, count]) => (next[id] || 0) < count)) return null;
    for (const [id, count] of Object.entries(requested)) next[id] -= count;
    const nextRarity = RARITY_IDS[CARD_RARITIES[rarity].rank + 1];
    const choices = cardsForRarity(nextRarity);
    const reward = choices[Math.min(choices.length - 1, Math.floor(cardSeedUnit(seed, 'trade') * choices.length))];
    next[reward.id] = clampInt((next[reward.id] || 0) + 1, 0, MAX_CARD_COPIES);
    return { collection: next, consumed: [...cardIds], reward };
}

module.exports = {
    ARENA_CARDS, CARD_RARITIES, DEFAULT_CARD_COLLECTION, DEFAULT_CARD_LOADOUT,
    grantArenaCache, normalizeCardCollection, normalizeCardLoadout,
    shouldAwardArenaCache, tradeUpCards
};
