import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { Store } = await import('../js/store.js');

test('a completed level-up match grants one earn-only Arena Cache at most once', () => {
    Store.reset();
    const reward = Store.awardArenaCache({ matchId: 'cache-level-up', won: false, leveledUp: true });
    assert.ok(reward?.card?.id);
    assert.equal(Store.get('arenaCache').earned, 1);
    assert.equal(Store.awardArenaCache({ matchId: 'cache-level-up', won: true, leveledUp: true }), null);
    assert.equal(Store.get('arenaCache').earned, 1);
});

test('Store equips owned card effects for casual and normalizes ranked', () => {
    Store.reset();
    Store.set('cardCollection', { 'orbit-slow': 1, 'deflect-plate': 1, 'apex-smash': 1, 'iron-resolve': 1 });
    assert.equal(Store.equipCard('apex-smash', 'active'), true);
    assert.equal(Store.equipCard('iron-resolve', 'passive'), true);
    assert.deepEqual(Store.getCardEffects('classic'), { skill: 'smash', runes: ['dmg_resist'], normalized: false });
    assert.deepEqual(Store.getCardEffects('competitive'), { skill: 'slow', runes: ['deflect_power'], normalized: true });
});

test('Store never turns coins into new skills or runes', async () => {
    Store.reset();
    Store.set('currency', 1000);
    assert.equal(await Store.purchase('skill', 'freeze'), false);
    assert.equal(await Store.purchase('rune', 'speed_bonus'), false);
    assert.equal(Store.get('currency'), 1000);
    assert.equal(Store.get('ownedSkills').includes('freeze'), false);
    assert.equal(Store.get('ownedItems').includes('speed_bonus'), false);
});
