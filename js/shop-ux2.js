// shop-ux2.js — pure, unit-tested helpers for the Shop's character-select portrait
// mapping, name-fit tiering, and inventory grouping. No DOM/THREE/window access here
// (see tests/shop-ux2.test.mjs); rendering lives in js/ui.js's chars/inventory tab
// sections (renderShop). Mirrors the js/shop-clarity.js separation established for the
// filter-chip/card-badge layer.

// The 15 generated portrait files at assets/generated/characters/portrait-<id>.jpg —
// see js/characters.js ROSTER for the full id set (CHARACTERS only exports the current
// 10-hero competitive subset, but every ROSTER id already has generated art).
export const CHARACTER_PORTRAIT_IDS = Object.freeze([
    'rally', 'tank', 'scout', 'sniper', 'guardian', 'blazer', 'frost',
    'volt', 'nova', 'ripple', 'soldier', 'anchor', 'phantom', 'hardy', 'swift'
]);

const PORTRAIT_BASE = 'assets/generated/characters/portrait-';

// Returns the generated portrait path for a known roster id, or null when the id has
// no generated art (defensive — the JS falls back to the character emoji in that case).
export function characterPortraitPath(id) {
    return CHARACTER_PORTRAIT_IDS.includes(id) ? `${PORTRAIT_BASE}${id}.jpg` : null;
}

// Name-fit tier: buckets a display name by length so the shop chars-tab card can step
// its font-size down for longer names instead of letting them clip/overflow. Boundaries
// were picked against the actual roster: short covers everything up to 6 chars (Rally,
// Scout, Anchor, Sniper...), medium covers the 7-9 char names that used to clip
// (Guardian, Bulwark, Soldier, Phantom), long is a headroom bucket for future names.
export function shopNameFitTier(name) {
    const len = String(name ?? '').trim().length;
    if (len <= 6) return 'short';
    if (len <= 9) return 'medium';
    return 'long';
}

// Inventory grouping: two fixed, ordered buckets (knives first, then cosmetics).
// Empty buckets are dropped so the inventory tab never renders an empty section header.
export const INVENTORY_GROUPS = Object.freeze([
    { id: 'knives', label: 'Knives' },
    { id: 'cosmetics', label: 'Cosmetics' }
]);

export function inventoryGroupOf(entry) {
    return entry?.type === 'cosmetic' ? 'cosmetics' : 'knives';
}

export function groupInventoryEntries(entries = []) {
    const buckets = { knives: [], cosmetics: [] };
    for (const entry of entries) buckets[inventoryGroupOf(entry)].push(entry);
    return INVENTORY_GROUPS
        .map(group => ({ ...group, items: buckets[group.id] }))
        .filter(group => group.items.length > 0);
}

// Team-restriction indicator: null means the item is usable on both teams (no badge
// needed); otherwise the single team it's locked to.
export function knifeTeamRestriction(teams) {
    const list = Array.isArray(teams) ? teams : [];
    const red = list.includes('red');
    const blue = list.includes('blue');
    if (red && blue) return null;
    if (red) return 'red';
    if (blue) return 'blue';
    return null;
}

// Whether a knife is equipped on at least one team — used to feed the shared
// .shop-status-badge EQUIPPED/OWNED state (js/shop-clarity.js deriveShopCardState).
export function isKnifeEquippedAny(knifeId, equippedKnives = {}) {
    return Object.values(equippedKnives || {}).includes(knifeId);
}
