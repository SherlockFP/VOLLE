import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import { COSMETICS, COSMETIC_TYPES, DEFAULT_WEARABLE_LOADOUT } from '../js/cosmetic-catalog.js';

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
});

test('new knife drops grant through the authoritative case-opening path', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-case-knives-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const session = store.session('', 'CaseKnives', { currency: 10000 });
    const profile = store.authenticate(session.token);
    const targets = [
        ['kickoff', 'stiletto'],
        ['arsenal', 'cleaver'],
        ['mythic', 'dark_eater']
    ];
    for (const [caseId, targetId] of targets) {
        const drops = CASES[caseId].drops;
        const total = drops.reduce((sum, drop) => sum + drop[3], 0);
        const targetIndex = drops.findIndex(([kind, id]) => kind === 'knife' && id === targetId);
        const before = drops.slice(0, targetIndex).reduce((sum, drop) => sum + drop[3], 0);
        const random = (before + drops[targetIndex][3] / 2) / total;
        const result = store.openCase(profile, caseId, `case-knife:${caseId}`, random);
        assert.equal(result.status, 200);
        assert.deepEqual(result.result.reward, { id: targetId, type: 'knife', rarity: drops[targetIndex][2] });
        assert.ok(profile.ownedKnives.includes(targetId));
    }
});

test('profile defaults and equip normalization cover every slot without bypassing ownership', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-commerce-parity-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const owned = ['hat_cap', 'mask_ember', 'wings_paper', 'backpack_supplies', 'banner_flame', 'trail_flame', 'finisher_confetti'];
    const session = store.session('', 'Wearables', { currency: 10000, ownedCosmetics: owned });
    const profile = store.authenticate(session.token);
    assert.deepEqual(Object.keys(profile.equippedWearables), Object.keys(DEFAULT_WEARABLE_LOADOUT));
    assert.ok(Object.values(profile.equippedWearables).every(id => id === 'none'));

    const result = store.equipCosmetics(profile, {
        hat: 'hat_cap', mask: 'mask_ember', wings: 'wings_paper',
        backpack: 'backpack_supplies', banner: 'banner_flame', trail: 'trail_flame',
        finisher: 'finisher_confetti', cape: 'cape_royal'
    });
    assert.equal(result.status, 200);
    assert.equal(result.loadout.hat, 'hat_cap');
    assert.equal(result.loadout.finisher, 'finisher_confetti');
    assert.equal(result.loadout.cape, 'none', 'an unowned catalog item must remain unequipped');
    assert.deepEqual(Object.keys(result.loadout), Object.keys(DEFAULT_WEARABLE_LOADOUT));
});
