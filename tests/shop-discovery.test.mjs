import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesShopQuery, matchesShopFilter, compareShopItems } from '../js/shop-clarity.js';

const catalog = [
    { name: 'Tidal Drift Gloves', description: 'Mint court gear', category: 'gloves', rarity: 'rare', price: 240, currency: 300, owned: true, order: 0 },
    { name: 'Solar Circuit Visor', description: 'Amber court gear', category: 'hat', rarity: 'epic', price: 400, currency: 300, owned: false, order: 1 },
    { name: 'Étoile', description: 'Solar star cape', category: 'cape', rarity: 'epic', price: 400, currency: 300, owned: false, order: 2 },
];

test('shop searches all terms across names, descriptions, slots and rarity', () => {
    assert.deepEqual(catalog.filter(item => matchesShopQuery(item, { query: '  TIDAL   rare  ' })), [catalog[0]]);
    assert.deepEqual(catalog.filter(item => matchesShopQuery(item, { query: 'solar epic' })), [catalog[1], catalog[2]]);
    assert.equal(matchesShopQuery(catalog[2], { query: 'etoile' }), true);
    assert.equal(matchesShopQuery(catalog[1], { query: '[.*] <script>' }), false);
});

test('search, rarity, equipment slot, and affordability combine without revealing other items', () => {
    assert.equal(matchesShopQuery(catalog[1], { rarity: 'rare', slot: 'hat' }), false);
    assert.equal(matchesShopQuery(catalog[1], { rarity: 'epic', slot: 'hat' }), true);
    assert.equal(matchesShopQuery(catalog[1], { rarity: 'epic', slot: 'gloves' }), false);
    assert.deepEqual(catalog.filter(item => matchesShopFilter('affordable', item) && matchesShopQuery(item, { query: 'court' })), [catalog[0]]);
    assert.deepEqual(catalog.filter(item => matchesShopFilter('owned', item)), [catalog[0]]);
});

test('a live offer keeps its catalog rarity even when its card has no visible rarity badge', () => {
    const liveOffer = { name: 'Limited Solar Ball', description: 'Rotates at midnight', category: 'ball', rarity: 'epic' };
    assert.equal(matchesShopQuery(liveOffer, { rarity: 'epic' }), true);
    assert.equal(matchesShopQuery(liveOffer, { rarity: 'rare' }), false);
});

test('price order is stable, name order is alphabetical, and featured restores authored order', () => {
    assert.deepEqual([...catalog].reverse().sort((a, b) => compareShopItems(a, b, 'price-low')), catalog);
    assert.deepEqual([...catalog].sort((a, b) => compareShopItems(a, b, 'price-high')), [catalog[1], catalog[2], catalog[0]]);
    assert.deepEqual([...catalog].sort((a, b) => compareShopItems(a, b, 'name')).map(item => item.name), ['Étoile', 'Solar Circuit Visor', 'Tidal Drift Gloves']);
    assert.deepEqual([...catalog].reverse().sort((a, b) => compareShopItems(a, b)), catalog);
});

test('an earned case is affordable with zero credits, paid case is not', () => {
    assert.equal(matchesShopFilter('affordable', { category: 'case', price: 0, currency: 0 }), true);
    assert.equal(matchesShopFilter('affordable', { category: 'case', price: 250, currency: 0 }), false);
});
