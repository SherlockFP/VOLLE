import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ARENA_CARDS, CARD_RARITIES, DEFAULT_CARD_COLLECTION, DEFAULT_CARD_LOADOUT } from '../js/cards.js';

const require = createRequire(import.meta.url);
const serverCatalog = require('../server/card-catalog.js');

test('server card catalog mirrors the client card ids, rarity, slots and effects', () => {
    const clientCards = Object.values(ARENA_CARDS).map(card => ({
        id: card.id, name: card.name, rarity: card.rarity, slot: card.slot, effectId: card.effectId
    })).sort((a, b) => a.id.localeCompare(b.id));
    const serverCards = Object.values(serverCatalog.ARENA_CARDS).map(card => ({
        id: card.id, name: card.name, rarity: card.rarity, slot: card.slot, effectId: card.effectId
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(serverCards, clientCards);
    assert.deepEqual(serverCatalog.CARD_RARITIES, CARD_RARITIES);
    assert.deepEqual(serverCatalog.DEFAULT_CARD_COLLECTION, DEFAULT_CARD_COLLECTION);
    assert.deepEqual(serverCatalog.DEFAULT_CARD_LOADOUT, DEFAULT_CARD_LOADOUT);
});
