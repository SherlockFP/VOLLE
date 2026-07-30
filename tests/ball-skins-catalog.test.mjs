import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BALL_PRICES } from '../js/battlepass.js';

// ball.js pulls in THREE, which plain `node --test` can't resolve, so it is
// loaded through the same string-substitution shim as tests/ball-skins.test.mjs.
const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { BALL_SKINS } = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

// ponytail: the 6 skins added in the NewSkins content pass. Kept in sync with
// BALL_SKINS by hand, same pattern as tests/ball-skins.test.mjs NEW_SKIN_IDS.
const NEW_SKIN_IDS = ['emberfall', 'glacies', 'binary_ghost', 'event_null', 'wildfire_phantom', 'oblivion_shard'];

const EXPECTED = {
    emberfall:        { rarity: 'rare',      price: 210, effect: 'flame' },
    glacies:           { rarity: 'rare',      price: 230, effect: 'frost' },
    binary_ghost:      { rarity: 'epic',      price: 310, effect: 'glitch' },
    event_null:        { rarity: 'epic',      price: 320, effect: 'void' },
    wildfire_phantom:  { rarity: 'legendary', price: 440, effect: 'flame' },
    oblivion_shard:    { rarity: 'legendary', price: 470, effect: 'void' }
};

// shader-finishers.js SKIN_FINISHERS only defines these four variants -- any
// other `effect` value silently gets no elimination/round-end shader.
const EFFECT_FAMILIES = ['flame', 'void', 'glitch', 'frost'];

test('all 6 new skins exist with the expected rarity/price and stay inside the 4 shader-finisher effect families', () => {
    assert.equal(NEW_SKIN_IDS.length, 6);
    assert.equal(new Set(NEW_SKIN_IDS).size, 6, 'new skin ids must be unique');

    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        assert.ok(skin, `${id} should be defined in BALL_SKINS`);
        assert.equal(skin.rarity, EXPECTED[id].rarity, `${id} rarity mismatch`);
        assert.equal(skin.price, EXPECTED[id].price, `${id} price mismatch`);
        assert.equal(skin.effect, EXPECTED[id].effect, `${id} effect mismatch`);
        assert.ok(EFFECT_FAMILIES.includes(skin.effect), `${id} effect "${skin.effect}" must be one of ${EFFECT_FAMILIES.join('/')}`);
    }
});

test('new skin roster covers all four effect families and splits 2 rare / 2 epic / 2 legendary', () => {
    const families = new Set(NEW_SKIN_IDS.map(id => BALL_SKINS[id].effect));
    for (const family of EFFECT_FAMILIES) assert.ok(families.has(family), `no new skin uses the "${family}" effect family`);

    const counts = { rare: 0, epic: 0, legendary: 0 };
    for (const id of NEW_SKIN_IDS) counts[BALL_SKINS[id].rarity]++;
    assert.deepEqual(counts, { rare: 2, epic: 2, legendary: 2 });
});

test('new skins carry every field the shop card and ball renderer read', () => {
    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        assert.equal(typeof skin.name, 'string');
        assert.ok(skin.name.length > 0, `${id} needs a name`);
        assert.equal(typeof skin.color, 'number', `${id} needs a numeric color`);
        assert.equal(typeof skin.glow, 'number', `${id} needs a numeric glow`);
        assert.equal(typeof skin.trail, 'number', `${id} needs a numeric trail color`);
        assert.equal(typeof skin.starColor, 'number', `${id} needs a numeric starColor`);
        assert.ok(Number.isInteger(skin.price) && skin.price > 0, `${id} needs an integer price > 0`);
    }
});

test('new skins carry no gameplay-affecting fields — cosmetic only', () => {
    const forbiddenFields = ['speedBonus', 'damageBonus', 'homingBonus', 'sizeBonus', 'stat', 'stats'];
    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        for (const field of forbiddenFields) {
            assert.equal(Object.hasOwn(skin, field), false, `${id} must not carry gameplay field "${field}"`);
        }
    }
});

test('legendary new skins reuse the existing burst-trail hook (no new update loop)', () => {
    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        if (skin.rarity !== 'legendary') continue;
        assert.equal(skin.burstTrail, true, `${id} legendary skin should opt into the burst trail`);
        assert.equal(typeof skin.trailStyle, 'string', `${id} legendary skin should set a trailStyle`);
    }
});

test('every purchasable skin id in BALL_SKINS has a matching price in js/battlepass.js BALL_PRICES', () => {
    // Regression for a real bug found during the NewSkins purchase-chain audit:
    // BALL_PRICES is a hand-duplicated copy of BALL_SKINS prices (js/battlepass.js
    // can't import ball.js because ball.js pulls in THREE, which plain
    // `node --test` can't resolve). js/store.js#buyBall() gates every purchase on
    // BALL_PRICES, not BALL_SKINS — so a skin present only in BALL_SKINS renders
    // fine in the shop grid but silently fails to purchase. This test would have
    // caught the 12 .io-expansion skins that shipped with no purchase price.
    const missing = [];
    const mismatched = [];
    for (const [id, skin] of Object.entries(BALL_SKINS)) {
        if (id === 'classic') continue;
        if (!(id in BALL_PRICES)) { missing.push(id); continue; }
        if (BALL_PRICES[id] !== skin.price) mismatched.push(`${id}: BALL_SKINS=${skin.price} BALL_PRICES=${BALL_PRICES[id]}`);
    }
    assert.deepEqual(missing, [], `ball ids missing from BALL_PRICES (unbuyable): ${missing.join(', ')}`);
    assert.deepEqual(mismatched, [], `BALL_SKINS/BALL_PRICES price mismatches: ${mismatched.join('; ')}`);
});

test('BALL_PRICES carries no id left over after a skin was ever removed from BALL_SKINS', () => {
    for (const id of Object.keys(BALL_PRICES)) {
        assert.ok(BALL_SKINS[id], `BALL_PRICES has ball id "${id}" with no matching BALL_SKINS entry`);
    }
});
