// tiers.js — pure rarity -> tier mapping shared by client catalogs, case-catalog
// helpers and ui.js renderers. No DOM, no imports, so tests and both catalog
// modules can use it without pulling in Three.js or the browser.
//
// Owner ask: "lots of gloves, tier lists" — a tier list needs one canonical
// rarity -> tier lookup instead of every screen inventing its own labels.
// 'exotic' rarity exists in the reveal-presentation/reel-fx layer (see
// js/cosmetics.js REVEAL_FAMILIES, js/viewmodel-fx.js) but server/profile-store.js
// still hardcodes `rarity === 'epic' || rarity === 'legendary'` for pity/premium
// checks, so exotic is NOT wired end-to-end for reward economy yet. New catalog
// content should ship as 'legendary' (mapped to S here) until that lands; the
// S+ tier stays mapped and ready for when it does.
export const RARITY_TIER = Object.freeze({
    common: 'C',
    uncommon: 'C+',
    rare: 'B',
    epic: 'A',
    legendary: 'S',
    exotic: 'S+'
});

// Highest tier first — drives Tier List grouping order.
export const TIER_ORDER = Object.freeze(['S+', 'S', 'A', 'B', 'C+', 'C']);

export function tierForRarity(rarity) {
    const key = typeof rarity === 'string' ? rarity.trim().toLowerCase() : '';
    return RARITY_TIER[key] || RARITY_TIER.common;
}

// CSS-safe token for a tier ('S+' -> 'splus') so it can be used as a class name.
export function tierClass(rarity) {
    return tierForRarity(rarity).replace('+', 'plus');
}

// Lower index = higher tier. Unknown rarities sort to the bottom (common).
export function tierRank(rarity) {
    const index = TIER_ORDER.indexOf(tierForRarity(rarity));
    return index === -1 ? TIER_ORDER.length - 1 : index;
}

// Small badge markup reused by shop cards, case reel items and locker tiles.
export function tierBadgeHTML(rarity) {
    const tier = tierForRarity(rarity);
    return `<span class="tier-badge tier-${tierClass(rarity)}" title="Tier ${tier}" aria-label="Tier ${tier}">${tier}</span>`;
}
