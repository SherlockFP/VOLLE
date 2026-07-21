function utcDayKey(now = Date.now()) {
    const date = new Date(now);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function hash(value) {
    let result = 2166136261;
    for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
    return result >>> 0;
}

function createLiveMarket(catalog, now = Date.now()) {
    const day = utcDayKey(now);
    const items = ['ball', 'cosmetic'].flatMap(kind =>
        Object.entries(catalog?.[kind] || {}).map(([itemId, basePrice]) => ({ kind, itemId, basePrice }))
    ).sort((a, b) => `${a.kind}:${a.itemId}`.localeCompare(`${b.kind}:${b.itemId}`));
    const count = Math.min(4, items.length);
    const offers = [];
    let cursor = hash(day) % Math.max(1, items.length);
    for (let index = 0; index < count; index++) {
        const { kind, itemId, basePrice } = items[cursor];
        const discount = [20, 25, 30, 15][index];
        offers.push({
            id: `${day}:${kind}:${itemId}`,
            kind,
            itemId,
            basePrice,
            price: Math.max(1, Math.floor(basePrice * (100 - discount) / 100)),
            discount
        });
        cursor = (cursor + 1) % items.length;
    }
    const expiresAt = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
    return { day, expiresAt, offers };
}

function findLiveOffer(catalog, offerId, now = Date.now()) {
    return createLiveMarket(catalog, now).offers.find(offer => offer.id === offerId) || null;
}

module.exports = { createLiveMarket, findLiveOffer, utcDayKey };
