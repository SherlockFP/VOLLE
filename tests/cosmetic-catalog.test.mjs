import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COSMETICS,
    COSMETIC_TYPES,
    cosmeticsByType,
    normalizeWearableLoadout
} from '../js/cosmetic-catalog.js';

test('wearable catalog has six priced effect skins in every slot', () => {
    assert.equal(Object.keys(COSMETICS).length, 30);
    for (const type of Object.keys(COSMETIC_TYPES)) {
        const items = cosmeticsByType(type);
        assert.equal(items.length, 6, `${type} catalog size`);
        assert.ok(items.every(item => item.price > 0 && item.colors.length >= 2 && item.description));
    }
});

test('wearable loadout rejects wrong slots, unknown ids, and unowned items', () => {
    assert.deepEqual(normalizeWearableLoadout({
        cape: 'pet_slime',
        pet: 'pet_slime',
        shoes: 'missing',
        aura: 'aura_void',
        impact: null
    }, ['pet_slime']), {
        cape: 'none',
        pet: 'pet_slime',
        shoes: 'none',
        aura: 'none',
        impact: 'none'
    });
});
