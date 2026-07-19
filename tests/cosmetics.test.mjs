import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, KNIVES, canEquipKnife, getCaseDropRates, rollCase } from '../js/cosmetics.js';

test('case boundaries resolve only catalog knives', () => {
    assert.equal(rollCase('missing', () => 0), null);
    assert.equal(rollCase('kickoff', () => 0).id, 'tide');
    assert.equal(rollCase('kickoff', () => 0.999999).id, 'sherlock');
    for (const drop of CASES.kickoff.drops) assert.ok(KNIVES[drop.id]);
});

test('team-exclusive knives cannot cross-equip', () => {
    assert.equal(canEquipKnife('tide', 'blue'), true);
    assert.equal(canEquipKnife('tide', 'red'), false);
    assert.equal(canEquipKnife('flare', 'red'), true);
    assert.equal(canEquipKnife('training', 'blue'), true);
});

test('case drop rates are normalized and expose every drop', () => {
    const rates = getCaseDropRates('kickoff');
    assert.equal(rates.length, CASES.kickoff.drops.length);
    assert.equal(rates.reduce((sum, drop) => sum + drop.chance, 0), 1);
    assert.deepEqual(rates.map(drop => Math.round(drop.chance * 100)), [38, 38, 20, 4]);
});

test('minimum rarity rolls only within the eligible case pool', () => {
    assert.equal(rollCase('kickoff', () => 0, { minimumRarity: 'epic' }).id, 'prism');
    assert.equal(rollCase('kickoff', () => 0.999, { minimumRarity: 'epic' }).id, 'sherlock');
    const rates = getCaseDropRates('kickoff', { minimumRarity: 'epic' });
    assert.deepEqual(rates.map(drop => Math.round(drop.chance * 100)), [83, 17]);
});
