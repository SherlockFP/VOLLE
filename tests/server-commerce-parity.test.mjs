import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import { COSMETICS, COSMETIC_TYPES, DEFAULT_WEARABLE_LOADOUT } from '../js/cosmetic-catalog.js';
import { CASES as CLIENT_CASES, KNIVES } from '../js/cosmetics.js';

const require = createRequire(import.meta.url);
const {
    BALL_PRICES: SERVER_BALL_PRICES,
    CASES,
    COSMETIC_DESCRIPTORS,
    COSMETIC_PRICES,
    COSMETIC_TYPES: SERVER_COSMETIC_TYPES,
    KNIFE_CATALOG
} = require('../server/case-catalog');
const { CATALOG, ProfileStore } = require('../server/profile-store');

// ball.js imports Three.js through the browser import map. Replace only those
// imports so this server parity test reads the real BALL_SKINS object in Node.
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableBallSource = ballSource
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { BALL_SKINS } = await import(`data:text/javascript;base64,${Buffer.from(testableBallSource).toString('base64')}`);

test('every purchasable BALL_SKINS id is server-authorized at the exact client price', () => {
    const clientPrices = Object.fromEntries(Object.entries(BALL_SKINS)
        .filter(([, skin]) => Number.isInteger(skin.price) && skin.price > 0)
        .map(([id, skin]) => [id, skin.price]));
    assert.deepEqual(SERVER_BALL_PRICES, clientPrices);
    assert.deepEqual(CATALOG.ball, clientPrices);
});

test('server wearable descriptors exactly cover client types, ids, and prices', () => {
    const clientTypes = Object.keys(COSMETIC_TYPES);
    const clientDescriptors = Object.fromEntries(Object.entries(COSMETICS)
        .map(([id, item]) => [id, { type: item.type, price: item.price }]));
    const clientPrices = Object.fromEntries(Object.entries(COSMETICS)
        .map(([id, item]) => [id, item.price]));
    assert.deepEqual(SERVER_COSMETIC_TYPES, clientTypes);
    assert.deepEqual(COSMETIC_DESCRIPTORS, clientDescriptors);
    assert.deepEqual(COSMETIC_PRICES, clientPrices);
    assert.deepEqual(CATALOG.cosmetic, clientPrices);
});

test('every authoritative case reward resolves through its server ownership catalog', () => {
    for (const [caseId, box] of Object.entries(CASES)) {
        for (const [kind, id] of box.drops) {
            assert.ok(CATALOG[kind]?.[id], `${caseId} ${kind}:${id} is not grantable`);
        }
    }
    assert.equal(KNIFE_CATALOG.stiletto, 1);
    assert.equal(KNIFE_CATALOG.cleaver, 1);
    assert.equal(KNIFE_CATALOG.dark_eater, 1);
    assert.equal(KNIFE_CATALOG.courtline, 1);
    assert.equal(KNIFE_CATALOG.pulsewing, 1);
    assert.equal(KNIFE_CATALOG.rift_hook, 1);
});

test('client and server case tables mirror rewards while legacy rarity odds stay fixed', () => {
    for (const [caseId, serverCase] of Object.entries(CASES)) {
        const clientCase = CLIENT_CASES[caseId];
        assert.ok(clientCase, `${caseId} missing from client catalog`);
        const clientDrops = clientCase.drops.map(drop => {
            const kind = drop.type || 'knife';
            const rarity = drop.rarity || (kind === 'knife' ? KNIVES[drop.id]?.rarity : COSMETICS[drop.id]?.rarity);
            return [kind, drop.id, rarity, drop.weight];
        });
        assert.deepEqual(serverCase.drops, clientDrops, `${caseId} reward table drift`);
    }

    const protectedOdds = {
        kickoff: { total: 110, rare: 85, epic: 20, legendary: 5 },
        chroma: { total: 100, rare: 69, epic: 29, legendary: 2 },
        arsenal: { total: 114, rare: 10, epic: 80, legendary: 24 },
        mythic: { total: 105, legendary: 105 }
    };
    for (const [caseId, expected] of Object.entries(protectedOdds)) {
        const actual = { total: 0 };
        for (const [, , rarity, weight] of CASES[caseId].drops) {
            actual.total += weight;
            actual[rarity] = (actual[rarity] || 0) + weight;
        }
        assert.deepEqual(actual, expected, `${caseId} rarity value changed`);
    }
});

test('new knife drops grant through the authoritative case-opening path', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-case-knives-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const session = store.session('', 'CaseKnives', { currency: 10000 });
    const profile = store.authenticate(session.token);
    const targets = [
        ['kickoff', 'stiletto'],
        ['kickoff', 'courtline'],
        ['arsenal', 'cleaver'],
        ['arsenal', 'pulsewing'],
        ['mythic', 'dark_eater'],
        ['mythic', 'rift_hook']
    ];
    for (const [caseId, targetId] of targets) {
        const drops = CASES[caseId].drops;
        const total = drops.reduce((sum, drop) => sum + drop[3], 0);
        const targetIndex = drops.findIndex(([kind, id]) => kind === 'knife' && id === targetId);
        const before = drops.slice(0, targetIndex).reduce((sum, drop) => sum + drop[3], 0);
        const random = (before + drops[targetIndex][3] / 2) / total;
        const result = store.openCase(profile, caseId, `case-knife:${caseId}:${targetId}`, random);
        assert.equal(result.status, 200);
        assert.deepEqual(result.result.reward, { id: targetId, type: 'knife', rarity: drops[targetIndex][2] });
        assert.ok(profile.ownedKnives.includes(targetId));
    }
});

test('premium glove drops grant as cosmetic-only ownership', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-case-gloves-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const session = store.session('', 'CaseGloves', { currency: 10000 });
    const profile = store.authenticate(session.token);
    for (const [caseId, targetId] of [
        ['kickoff', 'gloves_kinetic'],
        ['chroma', 'gloves_prism'],
        ['mythic', 'gloves_crown']
    ]) {
        const drops = CASES[caseId].drops;
        const total = drops.reduce((sum, drop) => sum + drop[3], 0);
        const targetIndex = drops.findIndex(([kind, id]) => kind === 'cosmetic' && id === targetId);
        const before = drops.slice(0, targetIndex).reduce((sum, drop) => sum + drop[3], 0);
        const random = (before + drops[targetIndex][3] / 2) / total;
        const result = store.openCase(profile, caseId, `case-glove:${caseId}`, random);
        assert.equal(result.status, 200);
        assert.deepEqual(result.result.reward, { id: targetId, type: 'cosmetic', rarity: drops[targetIndex][2] });
        assert.ok(profile.ownedCosmetics.includes(targetId));
    }
});

test('profile defaults and equip normalization cover every slot without bypassing ownership', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-commerce-parity-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const owned = ['hat_cap', 'mask_ember', 'wings_paper', 'backpack_supplies', 'banner_flame', 'trail_flame', 'finisher_confetti', 'gloves_kinetic'];
    const session = store.session('', 'Wearables', { currency: 10000, ownedCosmetics: owned });
    const profile = store.authenticate(session.token);
    assert.deepEqual(Object.keys(profile.equippedWearables), Object.keys(DEFAULT_WEARABLE_LOADOUT));
    assert.ok(Object.values(profile.equippedWearables).every(id => id === 'none'));

    const result = store.equipCosmetics(profile, {
        hat: 'hat_cap', mask: 'mask_ember', wings: 'wings_paper',
        backpack: 'backpack_supplies', banner: 'banner_flame', trail: 'trail_flame',
        finisher: 'finisher_confetti', gloves: 'gloves_kinetic', cape: 'cape_royal'
    });
    assert.equal(result.status, 200);
    assert.equal(result.loadout.hat, 'hat_cap');
    assert.equal(result.loadout.finisher, 'finisher_confetti');
    assert.equal(result.loadout.gloves, 'gloves_kinetic');
    assert.equal(result.loadout.cape, 'none', 'an unowned catalog item must remain unequipped');
    assert.deepEqual(Object.keys(result.loadout), Object.keys(DEFAULT_WEARABLE_LOADOUT));
});
