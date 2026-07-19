import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, KNIVES, canEquipKnife, rollCase } from '../js/cosmetics.js';

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
