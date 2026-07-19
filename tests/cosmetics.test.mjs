import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, KNIVES, canEquipKnife, getCaseDropRates, rollCase } from '../js/cosmetics.js';

test('case boundaries resolve catalog cosmetics', () => {
    assert.equal(rollCase('missing', () => 0), null);
    assert.equal(rollCase('kickoff', () => 0).id, 'tide');
    assert.equal(rollCase('kickoff', () => 0.999999).id, 'arcade');
    assert.equal(rollCase('kickoff', () => 0.92).type, 'avatar');
    for (const drop of CASES.kickoff.drops.filter(drop => !drop.type)) assert.ok(KNIVES[drop.id]);
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
    assert.ok(Math.abs(rates.reduce((sum, drop) => sum + drop.chance, 0) - 1) < 1e-12);
    assert.deepEqual(rates.map(drop => Math.round(drop.chance * 100)), [28, 28, 16, 3, 12, 7, 4, 2]);
});

test('minimum rarity rolls only within the eligible case pool', () => {
    assert.equal(rollCase('kickoff', () => 0, { minimumRarity: 'epic' }).id, 'prism');
    assert.equal(rollCase('kickoff', () => 0.999, { minimumRarity: 'epic' }).id, 'arcade');
    const rates = getCaseDropRates('kickoff', { minimumRarity: 'epic' });
    assert.deepEqual(rates.map(drop => Math.round(drop.chance * 100)), [64, 12, 16, 8]);
});

test('premium cases expose local butterfly and karambit finishes', () => {
    assert.deepEqual(Object.keys(CASES).sort(), ['arsenal', 'chroma', 'kickoff']);
    assert.equal(KNIVES.doppler.model, 'butterfly');
    assert.equal(KNIVES.fade.model, 'karambit');
    assert.equal(KNIVES.crimson_web.rarity, 'epic');
    assert.equal(rollCase('arsenal', () => 0.99).id, 'royal');
});
