const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, ProfileStore } = require('../server/profile-store');
const { createLiveMarket, findLiveOffer } = require('../server/live-market');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('live market is daily-stable and server-priceable', t => {
    const now = Date.UTC(2026, 6, 21, 12);
    const market = createLiveMarket(CATALOG, now);
    assert.equal(market.offers.length, 4);
    assert.deepEqual(market, createLiveMarket(CATALOG, now));
    const offer = findLiveOffer(CATALOG, market.offers[0].id, now);
    assert.equal(offer.price, market.offers[0].price);
    assert.ok(offer.price < offer.basePrice);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-live-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
    const session = profiles.session('', 'Player', { currency: 10000 });
    const record = profiles.authenticate(session.token);
    const result = profiles.purchase(record, offer.kind, offer.itemId, 'live-offer-2026-07-21', offer.price);
    assert.equal(result.status, 200);
    assert.equal(record.currency, 10000 - offer.price);
});

test('live market can rotate balls and wearable cosmetics together', () => {
    const market = createLiveMarket({
        ball: { fire: 100, ice: 100 },
        cosmetic: { cape_ember: 200, pet_slime: 200 }
    }, Date.UTC(2026, 6, 22, 12));
    assert.deepEqual(new Set(market.offers.map(offer => offer.kind)), new Set(['ball', 'cosmetic']));
    assert.equal(new Set(market.offers.map(offer => offer.id)).size, 4);
});
