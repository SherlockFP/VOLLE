import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COSMETICS,
    COSMETIC_TYPES,
    DEFAULT_WEARABLE_LOADOUT,
    cosmeticsByType,
    normalizeWearableLoadout,
    resolveEquippedGlove
} from '../js/cosmetic-catalog.js';

// cape/aura/trail are 7 (not 6): the Dark Eater set adds one wearable to each.
const EXPECTED_COUNTS = {
    cape: 7, pet: 6, shoes: 6, aura: 7, impact: 6,
    hat: 8, mask: 6, wings: 6, backpack: 5, banner: 4, trail: 7, finisher: 5,
    gloves: 3
};

test('wearable catalog has priced effect skins in every slot', () => {
    const total = Object.values(EXPECTED_COUNTS).reduce((sum, count) => sum + count, 0);
    assert.equal(Object.keys(COSMETICS).length, total);
    for (const type of Object.keys(COSMETIC_TYPES)) {
        const items = cosmeticsByType(type);
        assert.equal(items.length, EXPECTED_COUNTS[type], `${type} catalog size`);
        assert.ok(items.every(item => item.price > 0 && item.colors.length >= 2 && item.description));
        assert.ok(items.every(item => item.id.startsWith(`${type}_`)), `${type} ids share the type prefix`);
        assert.ok(items.every(item => ['rare', 'epic', 'legendary'].includes(item.rarity)), `${type} rarities are valid`);
    }
});

test('new cosmetic types price by rarity roughly in line with existing tiers', () => {
    const newTypes = ['hat', 'mask', 'wings', 'backpack', 'banner', 'trail', 'finisher', 'gloves'];
    for (const type of newTypes) {
        for (const item of cosmeticsByType(type)) {
            if (item.rarity === 'rare') assert.ok(item.price >= 240 && item.price <= 340, `${item.id} rare price`);
            if (item.rarity === 'epic') assert.ok(item.price >= 340 && item.price <= 480, `${item.id} epic price`);
            if (item.rarity === 'legendary') assert.ok(item.price >= 460 && item.price <= 820, `${item.id} legendary price`);
        }
    }
});

test('default loadout and normalized loadout cover every cosmetic type', () => {
    assert.deepEqual(Object.keys(DEFAULT_WEARABLE_LOADOUT).sort(), Object.keys(COSMETIC_TYPES).sort());
    for (const type of Object.keys(COSMETIC_TYPES)) {
        assert.equal(DEFAULT_WEARABLE_LOADOUT[type], 'none');
    }
    const normalized = normalizeWearableLoadout();
    assert.deepEqual(Object.keys(normalized).sort(), Object.keys(COSMETIC_TYPES).sort());
    assert.ok(Object.values(normalized).every(id => id === 'none'));
});

test('wearable loadout rejects wrong slots, unknown ids, and unowned items', () => {
    assert.deepEqual(normalizeWearableLoadout({
        cape: 'pet_slime',
        pet: 'pet_slime',
        shoes: 'missing',
        aura: 'aura_void',
        impact: null,
        hat: 'hat_crown',
        mask: 'mask_skull',
        wings: 'wings_angel',
        backpack: 'backpack_jetpack',
        banner: 'banner_champion',
        trail: 'trail_rainbow',
        finisher: 'finisher_explosion'
    }, ['pet_slime']), {
        cape: 'none',
        pet: 'pet_slime',
        shoes: 'none',
        aura: 'none',
        impact: 'none',
        hat: 'none',
        mask: 'none',
        wings: 'none',
        backpack: 'none',
        banner: 'none',
        trail: 'none',
        finisher: 'none',
        gloves: 'none'
    });
});

test('equipped glove resolver accepts only the dedicated cosmetic slot', () => {
    assert.equal(resolveEquippedGlove({ gloves: 'gloves_prism' })?.id, 'gloves_prism');
    assert.equal(resolveEquippedGlove({ gloves: 'hat_cap' }), null);
    assert.equal(resolveEquippedGlove({ hat: 'gloves_prism' }), null);
});
