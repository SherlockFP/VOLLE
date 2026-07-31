// tests/shop-ux2.test.mjs — pure predicate coverage for js/shop-ux2.js: character
// portrait path mapping, shop-card name-fit tiering, and inventory grouping. No DOM,
// no Three.js — see tests/shop-clarity.test.mjs for the sibling shop layer this mirrors.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CHARACTER_PORTRAIT_IDS,
    characterPortraitPath,
    shopNameFitTier,
    INVENTORY_GROUPS,
    inventoryGroupOf,
    groupInventoryEntries,
    knifeTeamRestriction,
    isKnifeEquippedAny
} from '../js/shop-ux2.js';

test('CHARACTER_PORTRAIT_IDS lists exactly the 15 generated roster ids, frozen', () => {
    assert.deepEqual([...CHARACTER_PORTRAIT_IDS].sort(), [
        'anchor', 'blazer', 'frost', 'guardian', 'hardy', 'nova', 'phantom', 'rally',
        'ripple', 'scout', 'sniper', 'soldier', 'swift', 'tank', 'volt'
    ].sort());
    assert.ok(Object.isFrozen(CHARACTER_PORTRAIT_IDS));
});

test('characterPortraitPath maps every one of the 15 roster ids to its generated jpg', () => {
    for (const id of CHARACTER_PORTRAIT_IDS) {
        assert.equal(characterPortraitPath(id), `assets/generated/characters/portrait-${id}.jpg`);
    }
});

test('characterPortraitPath returns null for unknown/missing ids (emoji fallback path)', () => {
    assert.equal(characterPortraitPath('nonexistent'), null);
    assert.equal(characterPortraitPath(''), null);
    assert.equal(characterPortraitPath(undefined), null);
});

test('shopNameFitTier buckets short/medium/long by trimmed length', () => {
    assert.equal(shopNameFitTier('Rally'), 'short');
    assert.equal(shopNameFitTier('Scout'), 'short');
    assert.equal(shopNameFitTier('Anchor'), 'short', '6 chars is still short');
    assert.equal(shopNameFitTier('Guardian'), 'medium', '8 chars — the reported clipping name');
    assert.equal(shopNameFitTier('Phantom'), 'medium', '7 chars — the other reported clipping name');
    assert.equal(shopNameFitTier('Bulwark'), 'medium');
    assert.equal(shopNameFitTier('  Swift  '), 'short', 'trims whitespace before measuring');
    assert.equal(shopNameFitTier('Clockwork Signature'), 'long');
    assert.equal(shopNameFitTier(''), 'short');
    assert.equal(shopNameFitTier(undefined), 'short');
});

test('INVENTORY_GROUPS is a frozen, ordered knives-then-cosmetics contract', () => {
    assert.deepEqual(INVENTORY_GROUPS.map(g => g.id), ['knives', 'cosmetics']);
    assert.ok(Object.isFrozen(INVENTORY_GROUPS));
});

test('inventoryGroupOf routes by entry.type, defaulting unknown/missing types to knives', () => {
    assert.equal(inventoryGroupOf({ type: 'knife' }), 'knives');
    assert.equal(inventoryGroupOf({ type: 'cosmetic' }), 'cosmetics');
    assert.equal(inventoryGroupOf({}), 'knives');
    assert.equal(inventoryGroupOf(null), 'knives');
});

test('groupInventoryEntries orders knives before cosmetics and preserves item order within a group', () => {
    const entries = [
        { type: 'cosmetic', id: 'cape_ember' },
        { type: 'knife', id: 'flare' },
        { type: 'knife', id: 'training' },
        { type: 'cosmetic', id: 'pet_slime' }
    ];
    const groups = groupInventoryEntries(entries);
    assert.deepEqual(groups.map(g => g.id), ['knives', 'cosmetics']);
    assert.deepEqual(groups[0].items.map(i => i.id), ['flare', 'training']);
    assert.deepEqual(groups[1].items.map(i => i.id), ['cape_ember', 'pet_slime']);
});

test('groupInventoryEntries drops empty groups instead of rendering an empty section', () => {
    const onlyKnives = groupInventoryEntries([{ type: 'knife', id: 'training' }]);
    assert.deepEqual(onlyKnives.map(g => g.id), ['knives']);

    const empty = groupInventoryEntries([]);
    assert.deepEqual(empty, []);
});

test('knifeTeamRestriction is null for universal items, the single team otherwise', () => {
    assert.equal(knifeTeamRestriction(['red', 'blue']), null, 'both teams = no restriction badge');
    assert.equal(knifeTeamRestriction(['red']), 'red');
    assert.equal(knifeTeamRestriction(['blue']), 'blue');
    assert.equal(knifeTeamRestriction([]), null);
    assert.equal(knifeTeamRestriction(undefined), null);
});

test('isKnifeEquippedAny checks membership across every team slot', () => {
    assert.equal(isKnifeEquippedAny('flare', { red: 'flare', blue: 'tide' }), true);
    assert.equal(isKnifeEquippedAny('tide', { red: 'flare', blue: 'tide' }), true);
    assert.equal(isKnifeEquippedAny('prism', { red: 'flare', blue: 'tide' }), false);
    assert.equal(isKnifeEquippedAny('training', {}), false);
    assert.equal(isKnifeEquippedAny('training', undefined), false);
});
