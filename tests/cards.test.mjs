import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ARENA_CARDS,
    DEFAULT_CARD_COLLECTION,
    grantArenaCache,
    resolveCardEffects,
    rollArenaCache,
    shouldAwardArenaCache,
    tradeUpCards
} from '../js/cards.js';
import { SKILLS, RUNES } from '../js/skills.js';

test('the collectible catalog covers every existing skill and rune exactly once', () => {
    const activeEffects = Object.values(ARENA_CARDS).filter(card => card.slot === 'active').map(card => card.effectId).sort();
    const passiveEffects = Object.values(ARENA_CARDS).filter(card => card.slot === 'passive').map(card => card.effectId).sort();
    assert.deepEqual(activeEffects, Object.keys(SKILLS).sort());
    assert.deepEqual(passiveEffects, Object.keys(RUNES).sort());
    for (const card of Object.values(ARENA_CARDS)) {
        assert.equal('power' in card, false, `${card.id} must not add rarity-based power`);
    }
});

test('Arena Cache rolls are deterministic and stay within the authored rarity catalog', () => {
    const first = rollArenaCache('match-100');
    const second = rollArenaCache('match-100');
    assert.deepEqual(first, second);
    assert.equal(ARENA_CARDS[first.card.id].rarity, first.rarity);
    const granted = grantArenaCache(DEFAULT_CARD_COLLECTION, 'match-100');
    assert.equal(granted.collection[first.card.id] >= 1, true);
});

test('level ups guarantee a free cache while non-level match drops are reproducible', () => {
    assert.equal(shouldAwardArenaCache({ matchId: 'level-up', leveledUp: true }), true);
    assert.equal(
        shouldAwardArenaCache({ matchId: 'stable-match', won: false }),
        shouldAwardArenaCache({ matchId: 'stable-match', won: false })
    );
});

test('card effects are collection-based in casual and normalized in ranked', () => {
    const collection = { ...DEFAULT_CARD_COLLECTION, 'apex-smash': 1, 'iron-resolve': 1 };
    const loadout = { active: 'apex-smash', passive: 'iron-resolve' };
    assert.deepEqual(resolveCardEffects(loadout, collection, 'classic'), {
        skill: 'smash', runes: ['dmg_resist'], normalized: false
    });
    assert.deepEqual(resolveCardEffects(loadout, collection, 'competitive'), {
        skill: 'slow', runes: ['deflect_power'], normalized: true
    });
});

test('five same-rarity cards trade into exactly one next-rarity card', () => {
    const collection = { ...DEFAULT_CARD_COLLECTION, 'bastion-shield': 5 };
    const result = tradeUpCards(collection, Array(5).fill('bastion-shield'), 'trade-rare');
    assert.ok(result);
    assert.equal(result.collection['bastion-shield'], 0);
    assert.equal(result.reward.rarity, 'epic');
    assert.equal(result.collection[result.reward.id], 1);
    assert.equal(tradeUpCards(collection, Array(5).fill('iron-resolve'), 'no-legendary'), null);
});
