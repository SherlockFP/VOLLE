// js/shop-clarity.js — Shop clarity layer: pure predicates for ownership/affordability and
// filter-chip matching. Kept dependency-free (no DOM, no Three.js) so js/ui.js's shop render
// section (renderShop + card decoration) can stay thin while these stay unit-testable in isolation.

export const SHOP_FILTERS = Object.freeze([
    { id: 'all', label: 'All' },
    { id: 'ball', label: 'Balls' },
    { id: 'cosmetic', label: 'Cosmetics' },
    { id: 'hat', label: 'Hats' },
    { id: 'shoes', label: 'Shoes' },
    { id: 'cape', label: 'Capes' },
    { id: 'knife', label: 'Knives' },
    { id: 'owned', label: 'Owned' },
    { id: 'affordable', label: 'Affordable' }
]);

// price/currency default to 0 when missing or non-finite.
export function isShopItemAffordable(price, currency) {
    const cost = Number.isFinite(price) ? price : 0;
    const balance = Number.isFinite(currency) ? currency : 0;
    return cost <= balance;
}

export function shopCoinShortfall(price, currency) {
    const cost = Number.isFinite(price) ? price : 0;
    const balance = Number.isFinite(currency) ? currency : 0;
    return Math.max(0, cost - balance);
}

export function matchesShopFilter(filterId, card = {}) {
    switch (filterId || 'all') {
        case 'all': return true;
        case 'owned': return !!card.owned;
        case 'affordable': return isShopItemAffordable(card.price, card.currency);
        case 'cosmetic': return !['ball', 'knife', 'character', 'avatar', 'case', 'boost'].includes(card.category);
        default: return card.category === filterId;
    }
}

// Shared by the catalog controls and tests. Search treats user text as text,
// including punctuation and accents; it is never turned into markup or a regexp.
export function matchesShopQuery(card = {}, { query = '', rarity = 'all', slot = 'all', collection = 'all' } = {}) {
    if (rarity !== 'all' && card.rarity !== rarity) return false;
    if (slot !== 'all' && card.category !== slot) return false;
    if (collection !== 'all' && card.collection !== collection) return false;
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    const haystack = normalize(`${card.name || ''} ${card.description || ''} ${card.category || ''} ${card.rarity || ''}`);
    return terms.every(term => haystack.includes(term));
}

export const SHOP_COLLECTIONS = Object.freeze([
    Object.freeze({ id: 'court-carnival', label: 'Court Carnival', prefix: 'Court Carnival ', isNew: true }),
    Object.freeze({ id: 'orbital-club', label: 'Orbital Club', prefix: 'Orbital Club ', isNew: true }),
    Object.freeze({ id: 'solar-circuit', label: 'Solar Circuit', prefix: 'Solar Circuit ', isNew: false }),
    Object.freeze({ id: 'tidal-drift', label: 'Tidal Drift', prefix: 'Tidal Drift ', isNew: false }),
    Object.freeze({ id: 'dark-eater', label: 'Dark Eater', prefix: 'Dark Eater ', isNew: false })
]);

export function shopCollectionForItem(item = {}) {
    return SHOP_COLLECTIONS.find(collection => String(item.name || '').startsWith(collection.prefix)) || null;
}

export function compareShopItems(a, b, order = 'featured') {
    if (order === 'price-low') return a.price - b.price || a.order - b.order;
    if (order === 'price-high') return b.price - a.price || a.order - b.order;
    if (order === 'name') return a.name.localeCompare(b.name) || a.order - b.order;
    return a.order - b.order;
}

export function deriveShopCardState({ price = 0, owned = false, equipped = false, currency = 0 } = {}) {
    const affordable = owned || isShopItemAffordable(price, currency);
    const cost = Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0;
    return Object.freeze({
        badge: equipped ? 'EQUIPPED' : owned ? 'OWNED' : null,
        dim: !owned && !affordable,
        shortfall: owned ? 0 : shopCoinShortfall(price, currency),
        actionLabel: equipped ? 'Equipped' : owned ? 'Equip' : `Buy — ${cost}`
    });
}
