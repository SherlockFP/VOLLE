import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { BALL_SKINS } = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

// ponytail: the 12 skins added for the .io shop expansion — keep this list in
// sync with BALL_SKINS so the roster-count assertion below stays meaningful.
const NEW_SKIN_IDS = [
    'copper', 'blizzard', 'ember_wisp', 'neon_dash', 'bubblegum',
    'cobalt_storm', 'venom', 'circuit', 'aurora',
    'phoenix', 'cosmic_serpent', 'prism_king'
];

const EXPECTED = {
    copper:         { rarity: 'rare',      price: 200 },
    blizzard:       { rarity: 'rare',      price: 230 },
    ember_wisp:     { rarity: 'rare',      price: 210 },
    neon_dash:      { rarity: 'rare',      price: 240 },
    bubblegum:      { rarity: 'rare',      price: 220 },
    cobalt_storm:   { rarity: 'epic',      price: 300 },
    venom:          { rarity: 'epic',      price: 310 },
    circuit:        { rarity: 'epic',      price: 340 },
    aurora:         { rarity: 'epic',      price: 290 },
    phoenix:        { rarity: 'legendary', price: 430 },
    cosmic_serpent: { rarity: 'legendary', price: 450 },
    prism_king:     { rarity: 'legendary', price: 480 }
};

test('all 12 new skins exist with the expected rarity/price and are unique ids', () => {
    assert.equal(NEW_SKIN_IDS.length, 12);
    assert.equal(new Set(NEW_SKIN_IDS).size, 12, 'new skin ids must be unique');

    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        assert.ok(skin, `${id} should be defined in BALL_SKINS`);
        assert.equal(skin.rarity, EXPECTED[id].rarity, `${id} rarity mismatch`);
        assert.equal(skin.price, EXPECTED[id].price, `${id} price mismatch`);
    }
});

test('new skin roster is split roughly 5 rare / 4 epic / 3 legendary', () => {
    const counts = { rare: 0, epic: 0, legendary: 0 };
    for (const id of NEW_SKIN_IDS) counts[BALL_SKINS[id].rarity]++;
    assert.equal(counts.rare, 5);
    assert.equal(counts.epic, 4);
    assert.equal(counts.legendary, 3);
});

test('every skin id in BALL_SKINS is unique (no accidental key collisions)', () => {
    const ids = Object.keys(BALL_SKINS);
    assert.equal(new Set(ids).size, ids.length);
    // classic + all pre-existing skins + the 12 new ones.
    assert.ok(ids.length >= 32 + 12, 'roster should include the 12 new skins on top of the existing set');
});

test('new skins match the existing purchasable-skin shape and invariants', () => {
    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        assert.equal(typeof skin.name, 'string');
        assert.ok(skin.name.length > 0, `${id} needs a name`);
        assert.ok(Number.isInteger(skin.price) && skin.price > 0, `${id} needs an integer price > 0`);
        assert.match(skin.rarity, /^(rare|epic|legendary)$/, `${id} rarity must be rare|epic|legendary`);
        assert.equal(typeof skin.color, 'number', `${id} needs a numeric color`);
        assert.equal(typeof skin.glow, 'number', `${id} needs a numeric glow`);
        assert.equal(typeof skin.trail, 'number', `${id} needs a numeric trail color`);
        assert.equal(typeof skin.starColor, 'number', `${id} needs a numeric starColor`);
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

test('legendary skins reuse the existing trail hook for a denser afterimage (no new update loop)', () => {
    for (const id of NEW_SKIN_IDS) {
        const skin = BALL_SKINS[id];
        if (skin.rarity !== 'legendary') continue;
        assert.equal(skin.burstTrail, true, `${id} legendary skin should opt into the burst trail`);
        assert.equal(typeof skin.trailStyle, 'string', `${id} legendary skin should set a trailStyle`);
    }
    // The trail system itself must stay a reused per-frame hook, not a new loop.
    assert.match(source, /_emitTrail\(dt\)/);
    assert.match(source, /addTrailDot\(/);
});
