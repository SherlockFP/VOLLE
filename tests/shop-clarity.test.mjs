// tests/shop-clarity.test.mjs — pure predicate coverage for js/shop-clarity.js: the shop
// clarity layer (filter chips + card owned/equipped/affordable/dim derivation). No DOM, no
// Three.js — these are plain data-in/data-out functions used by js/ui.js's renderShop.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SHOP_FILTERS,
    isShopItemAffordable,
    shopCoinShortfall,
    matchesShopFilter,
    deriveShopCardState
} from '../js/shop-clarity.js';

test('SHOP_FILTERS exposes exactly the six documented chips, all/category/owned/affordable', () => {
    const ids = SHOP_FILTERS.map(f => f.id);
    assert.deepEqual(ids, ['all', 'ball', 'cosmetic', 'knife', 'owned', 'affordable']);
    assert.ok(Object.isFrozen(SHOP_FILTERS));
    for (const filter of SHOP_FILTERS) assert.equal(typeof filter.label, 'string');
});

test('isShopItemAffordable compares price to balance, coercing missing/non-finite to 0', () => {
    assert.equal(isShopItemAffordable(100, 150), true);
    assert.equal(isShopItemAffordable(150, 150), true, 'exact balance is affordable');
    assert.equal(isShopItemAffordable(151, 150), false);
    assert.equal(isShopItemAffordable(undefined, 10), true, 'missing price treated as free');
    assert.equal(isShopItemAffordable(10, undefined), false, 'missing currency treated as 0');
    assert.equal(isShopItemAffordable(NaN, 10), true);
});

test('shopCoinShortfall is the clamped-to-zero gap between price and balance', () => {
    assert.equal(shopCoinShortfall(500, 120), 380);
    assert.equal(shopCoinShortfall(100, 150), 0, 'never negative when affordable');
    assert.equal(shopCoinShortfall(0, 0), 0);
    assert.equal(shopCoinShortfall(NaN, NaN), 0);
});

test('matchesShopFilter: all/owned/affordable are cross-category; others match by category', () => {
    const ownedBall = { category: 'ball', owned: true, price: 150, currency: 0 };
    const cheapKnife = { category: 'knife', owned: false, price: 50, currency: 200 };
    const pricyCosmetic = { category: 'cosmetic', owned: false, price: 900, currency: 10 };

    for (const card of [ownedBall, cheapKnife, pricyCosmetic]) {
        assert.equal(matchesShopFilter('all', card), true);
        assert.equal(matchesShopFilter(undefined, card), true, 'missing filter defaults to all');
    }

    assert.equal(matchesShopFilter('owned', ownedBall), true);
    assert.equal(matchesShopFilter('owned', cheapKnife), false);

    assert.equal(matchesShopFilter('affordable', cheapKnife), true);
    assert.equal(matchesShopFilter('affordable', pricyCosmetic), false);
    assert.equal(matchesShopFilter('affordable', ownedBall), false, 'the predicate is literally price <= currency, ownership is irrelevant to it');

    assert.equal(matchesShopFilter('ball', ownedBall), true);
    assert.equal(matchesShopFilter('ball', cheapKnife), false);
    assert.equal(matchesShopFilter('knife', cheapKnife), true);
    assert.equal(matchesShopFilter('cosmetic', pricyCosmetic), true);
    assert.equal(matchesShopFilter('cosmetic', cheapKnife), false);
});

test('deriveShopCardState: equipped beats owned for badge, both are never dim', () => {
    const equipped = deriveShopCardState({ price: 150, owned: true, equipped: true, currency: 0 });
    assert.equal(equipped.badge, 'EQUIPPED');
    assert.equal(equipped.dim, false);
    assert.equal(equipped.shortfall, 0);
    assert.equal(equipped.actionLabel, 'Equipped');

    const owned = deriveShopCardState({ price: 150, owned: true, currency: 0 });
    assert.equal(owned.badge, 'OWNED');
    assert.equal(owned.dim, false);
    assert.equal(owned.actionLabel, 'Equip');
});

test('deriveShopCardState: unowned + affordable is buyable and never dim', () => {
    const state = deriveShopCardState({ price: 500, owned: false, currency: 800 });
    assert.equal(state.badge, null);
    assert.equal(state.dim, false);
    assert.equal(state.shortfall, 0);
    assert.equal(state.actionLabel, 'Buy — 500');
});

test('deriveShopCardState: unowned + unaffordable is dim with a coin shortfall and Buy label', () => {
    const state = deriveShopCardState({ price: 500, owned: false, currency: 120 });
    assert.equal(state.badge, null);
    assert.equal(state.dim, true);
    assert.equal(state.shortfall, 380);
    assert.equal(state.actionLabel, 'Buy — 500');
});

test('deriveShopCardState: defaults to a free unowned item when called with no args', () => {
    const state = deriveShopCardState();
    assert.equal(state.badge, null);
    assert.equal(state.dim, false);
    assert.equal(state.actionLabel, 'Buy — 0');
});

test('deriveShopCardState result is frozen (no accidental caller mutation)', () => {
    const state = deriveShopCardState({ price: 10, owned: false, currency: 100 });
    assert.throws(() => { state.badge = 'HACKED'; }, /Cannot assign to read only property|not extensible/);
});
