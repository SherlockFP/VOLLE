// tests/glovebox-blade-vault.test.mjs — pins the "lots of gloves + tier lists" wave:
//   1. js/tiers.js rarity -> tier mapping and ordering,
//   2. every new glove carries a schema-valid first-person `look`,
//   3. the Glovebox Case / Blade Vault Case drop tables are internally consistent
//      (weights sum, odds normalize) and mirror exactly between client and server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CASES, KNIVES, getCaseDropRates } from '../js/cosmetics.js';
import { COSMETICS } from '../js/cosmetic-catalog.js';
import { RARITY_TIER, TIER_ORDER, tierForRarity, tierClass, tierRank, tierBadgeHTML } from '../js/tiers.js';

const require = createRequire(import.meta.url);
const { CASES: SERVER_CASES, COSMETIC_DESCRIPTORS, KNIFE_CATALOG } = require('../server/case-catalog');

// js/viewmodel-hand.js pulls in THREE (browser-only import map) and knife-animation.js.
// resolveGloveLook / GLOVE_PATTERNS / GLOVE_FINISHES touch neither, so both imports are
// stubbed out the same way tests/ball-skins-catalog.test.mjs shims ball.js.
const handSource = (await readFile(new URL('../js/viewmodel-hand.js', import.meta.url), 'utf8'))
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { VIEWMODEL_BASE_POSITION, VIEWMODEL_BASE_ROTATION } from './knife-animation.js';", 'const VIEWMODEL_BASE_POSITION = [0, 0, 0]; const VIEWMODEL_BASE_ROTATION = [0, 0, 0];');
const { GLOVE_PATTERNS, GLOVE_FINISHES, resolveGloveLook } = await import(`data:text/javascript;base64,${Buffer.from(handSource).toString('base64')}`);

const NEW_GLOVE_IDS = [
    'gloves_windrunner', 'gloves_clay_court', 'gloves_riptide', 'gloves_sandstorm',
    'gloves_thornback', 'gloves_ashfall', 'gloves_lowlight', 'gloves_terra',
    'gloves_neon_pulse', 'gloves_ironclad', 'gloves_wildfire', 'gloves_deep_current',
    'gloves_grid_runner', 'gloves_venom_weave', 'gloves_frostbyte', 'gloves_crimson_circuit',
    'gloves_supernova', 'gloves_voidforge', 'gloves_phoenix_ember', 'gloves_aurora_veil',
    'gloves_titanium_crest', 'gloves_dragon_lord', 'gloves_starforged', 'gloves_eclipse_king'
];

const NEW_KNIFE_IDS = [
    'night_kukri', 'gut_circuit', 'huntsman_wildfire', 'talon_aurora', 'flip_carbon',
    'kukri_sunset', 'gut_frost', 'huntsman_brass', 'talon_reactor', 'flip_prism',
    'kukri_void', 'huntsman_tide'
];

test('tiers.js maps every rarity to the requested letter tier', () => {
    assert.deepEqual(RARITY_TIER, { common: 'C', uncommon: 'C+', rare: 'B', epic: 'A', legendary: 'S', exotic: 'S+' });
    for (const [rarity, tier] of Object.entries(RARITY_TIER)) assert.equal(tierForRarity(rarity), tier);
    assert.equal(tierForRarity('LEGENDARY'), 'S', 'case-insensitive');
    assert.equal(tierForRarity('unknown-thing'), 'C', 'unknown rarity falls back to common');
});

test('tiers.js TIER_ORDER is highest-first and tierRank is monotonic with it', () => {
    assert.deepEqual(TIER_ORDER, ['S+', 'S', 'A', 'B', 'C+', 'C']);
    assert.equal(tierRank('exotic'), 0);
    assert.equal(tierRank('legendary'), 1);
    assert.equal(tierRank('epic'), 2);
    assert.equal(tierRank('rare'), 3);
    assert.equal(tierRank('uncommon'), 4);
    assert.equal(tierRank('common'), 5);
    assert.ok(tierRank('legendary') < tierRank('epic') && tierRank('epic') < tierRank('rare'));
});

test('tierClass produces a CSS-safe token and tierBadgeHTML embeds it', () => {
    assert.equal(tierClass('exotic'), 'Splus');
    assert.equal(tierClass('rare'), 'B');
    const html = tierBadgeHTML('legendary');
    assert.match(html, /class="tier-badge tier-S"/);
    assert.match(html, />S<\/span>/);
});

test('every new glove has a schema-valid look and non-legacy pattern/finish', () => {
    assert.equal(NEW_GLOVE_IDS.length, 24, 'sanity: this wave adds exactly 24 gloves');
    for (const id of NEW_GLOVE_IDS) {
        const item = COSMETICS[id];
        assert.ok(item, `${id} missing from COSMETICS`);
        assert.equal(item.type, 'gloves');
        assert.ok(['rare', 'epic', 'legendary'].includes(item.rarity), `${id} rarity`);
        assert.ok(item.look, `${id} must carry a look`);
        assert.ok(GLOVE_PATTERNS.includes(item.look.pattern), `${id} pattern "${item.look.pattern}" not recognized by viewmodel-hand.js`);
        assert.ok(GLOVE_FINISHES.includes(item.look.finish), `${id} finish "${item.look.finish}" not recognized by viewmodel-hand.js`);
        assert.ok(Number.isFinite(item.look.glow) && item.look.glow >= 0 && item.look.glow <= 1, `${id} glow in [0,1]`);
        assert.equal(item.look.knuckles, true, `${id} should show knuckle plates`);
        // resolveGloveLook must actually use the authored look, not fall back to legacy style guesses.
        const resolved = resolveGloveLook(item);
        assert.equal(resolved.pattern, item.look.pattern, `${id} resolved pattern should match authored look`);
        assert.equal(resolved.finish, item.look.finish, `${id} resolved finish should match authored look`);
        assert.equal(resolved.glow, item.look.glow, `${id} resolved glow should match authored look`);
        // Third-person: style must be one createGloves() in js/cosmetic-models.js understands.
        assert.ok(['kinetic', 'prism', 'royal', 'leather', 'metal', 'frost'].includes(item.style), `${id} style "${item.style}" has no third-person silhouette`);
    }
    const byRarity = NEW_GLOVE_IDS.reduce((acc, id) => { acc[COSMETICS[id].rarity] = (acc[COSMETICS[id].rarity] || 0) + 1; return acc; }, {});
    assert.deepEqual(byRarity, { rare: 8, epic: 8, legendary: 8 });
    // Higher tiers read as flashier: legendary must not use the plain leather/rubber
    // finishes rare gloves use, and must carry visible glow.
    for (const id of NEW_GLOVE_IDS.filter(id => COSMETICS[id].rarity === 'legendary')) {
        const item = COSMETICS[id];
        assert.ok(['metal', 'iridescent', 'emissive'].includes(item.look.finish), `${id} legendary finish should be a premium finish`);
        assert.ok(item.look.glow > 0, `${id} legendary glow should be > 0`);
    }
});

test('Glovebox Case exposes exactly the 24 new gloves with weights that normalize', () => {
    const rates = getCaseDropRates('gloves');
    assert.equal(rates.length, 24);
    assert.deepEqual(rates.map(r => r.id).sort(), [...NEW_GLOVE_IDS].sort());
    assert.ok(rates.every(r => r.type === 'cosmetic'));
    assert.ok(Math.abs(rates.reduce((sum, r) => sum + r.chance, 0) - 1) < 1e-12, 'drop chances normalize to 1');
    const totalsByRarity = rates.reduce((acc, r) => { acc[r.rarity] = (acc[r.rarity] || 0) + r.chance; return acc; }, {});
    // Legendary must be the rarest tier to pull — the whole point of a "chase" case.
    assert.ok(totalsByRarity.legendary < totalsByRarity.epic, 'legendary should be rarer than epic overall');
    assert.ok(totalsByRarity.epic < totalsByRarity.rare, 'epic should be rarer than rare overall');
});

test('Blade Vault Case exposes the new blade-model knives with weights that normalize', () => {
    const rates = getCaseDropRates('blades');
    assert.equal(rates.length, 10);
    assert.ok(Math.abs(rates.reduce((sum, r) => sum + r.chance, 0) - 1) < 1e-12);
    for (const drop of rates) {
        assert.ok(KNIVES[drop.id], `${drop.id} should resolve through KNIVES`);
        assert.ok(['kukri', 'gut', 'huntsman', 'talon', 'flip'].includes(KNIVES[drop.id].model), `${drop.id} should use a new blade model`);
    }
});

test('every new knife exists with a real model, a case-recognized finish, and is reachable', () => {
    assert.equal(NEW_KNIFE_IDS.length, 12);
    const caseKnifeIds = new Set(Object.values(CASES).flatMap(box => box.drops.filter(d => !d.type).map(d => d.id)));
    for (const id of NEW_KNIFE_IDS) {
        const knife = KNIVES[id];
        assert.ok(knife, `${id} missing from KNIVES`);
        assert.ok(['kukri', 'gut', 'huntsman', 'talon', 'flip'].includes(knife.model), `${id} should use a new blade model`);
        assert.ok(['rare', 'epic', 'legendary'].includes(knife.rarity));
        assert.ok(Array.isArray(knife.teams) && knife.teams.length > 0);
        assert.ok(caseKnifeIds.has(id), `${id} must be reachable from at least one case`);
    }
});

test('client and server mirror the two new cases exactly, including the new knife placements', () => {
    for (const caseId of ['gloves', 'blades', 'elemental', 'companions']) {
        const clientCase = CASES[caseId];
        const serverCase = SERVER_CASES[caseId];
        assert.ok(clientCase && serverCase, `${caseId} must exist on both sides`);
        assert.equal(clientCase.price, serverCase.price, `${caseId} price parity`);
        const clientDrops = clientCase.drops.map(drop => {
            const kind = drop.type || 'knife';
            const rarity = drop.rarity || (kind === 'knife' ? KNIVES[drop.id]?.rarity : COSMETICS[drop.id]?.rarity);
            return [kind, drop.id, rarity, drop.weight];
        });
        assert.deepEqual(serverCase.drops, clientDrops, `${caseId} reward table drift`);
    }
});

test('server cosmetic descriptors exactly price every new glove like the client catalog', () => {
    for (const id of NEW_GLOVE_IDS) {
        assert.deepEqual(COSMETIC_DESCRIPTORS[id], { type: 'gloves', price: COSMETICS[id].price }, `${id} server/client price drift`);
    }
});

test('server KNIFE_CATALOG grants every new knife', () => {
    for (const id of NEW_KNIFE_IDS) assert.equal(KNIFE_CATALOG[id], 1, `${id} not in server KNIFE_CATALOG`);
});
