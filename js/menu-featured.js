// js/menu-featured.js — pure helpers for the main-menu FEATURED vitrin strip
// (today's case + 1-2 ball skins). No DOM here: js/main.js wires the result
// into #menu-featured. Deterministic — same catalog + same date always
// produces the same picks, no server round-trip required. When a live-market
// snapshot (js/store.js getLiveMarket) has offers loaded, those win over the
// deterministic fallback (ponytail: one rotation rule, not two systems).

function dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((today - start) / 86400000);
}

// Deterministic index into a `length`-item list for the given day.
export function rotationIndex(length, date = new Date()) {
    if (!Number.isFinite(length) || length <= 0) return 0;
    return dayOfYear(date) % length;
}

// Today's featured case from a CASES-shaped catalog (js/cosmetics.js).
export function pickFeaturedCase(cases, date = new Date()) {
    const ids = Object.keys(cases || {});
    if (!ids.length) return null;
    const id = ids[rotationIndex(ids.length, date)];
    return { id, ...cases[id] };
}

// `count` featured ball skins from a BALL_SKINS-shaped catalog (js/ball.js).
// Only priced (purchasable) entries rotate through — the free starter skin
// never fills a sales slot.
export function pickFeaturedSkins(skins, count = 2, date = new Date()) {
    const ids = Object.keys(skins || {}).filter(id => Number.isFinite(skins[id]?.price) && skins[id].price > 0);
    if (!ids.length) return [];
    const n = Math.min(count, ids.length);
    const start = rotationIndex(ids.length, date);
    const out = [];
    for (let i = 0; i < n; i++) {
        const id = ids[(start + i) % ids.length];
        out.push({ id, ...skins[id] });
    }
    return out;
}

// Full derivation: { case, skins }. Live-market ball offers (when present)
// replace the deterministic skin picks; the case rotation is always
// deterministic since cases aren't part of the live-market system.
export function deriveFeaturedStrip({ cases, skins, liveMarket, count = 2, date = new Date() } = {}) {
    const offers = Array.isArray(liveMarket?.offers) ? liveMarket.offers : [];
    const liveSkins = offers
        .filter(offer => offer && offer.kind !== 'cosmetic' && skins?.[offer.itemId])
        .slice(0, count)
        .map(offer => ({ id: offer.itemId, ...skins[offer.itemId], live: true, price: offer.price, basePrice: offer.basePrice, discount: offer.discount }));
    return {
        case: pickFeaturedCase(cases, date),
        skins: liveSkins.length ? liveSkins : pickFeaturedSkins(skins, count, date)
    };
}
