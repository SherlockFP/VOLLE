import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import { COSMETICS } from '../js/cosmetic-catalog.js';

const require = createRequire(import.meta.url);
const { COSMETIC_DESCRIPTORS } = require('../server/case-catalog');
const { ProfileStore } = require('../server/profile-store');

const SOLAR_IDS = Object.freeze([
    'hat_solar_circuit_headset', 'gloves_solar_circuit_grips',
    'cape_solar_circuit_streamer', 'wings_solar_circuit_panels',
    'shoes_solar_circuit_sprints', 'backpack_solar_circuit_court_bag'
]);
const TIDAL_IDS = Object.freeze([
    'hat_tidal_drift_cap', 'cape_tidal_drift_swell',
    'wings_tidal_drift_sails', 'shoes_tidal_drift_skimmers',
    'backpack_tidal_drift_float', 'pet_tidal_drift_ray'
]);
const SEASON_IDS = Object.freeze([...SOLAR_IDS, ...TIDAL_IDS]);

test('Solar Circuit and Tidal Drift remain complete, searchable shop collections', () => {
    assert.equal(SEASON_IDS.length, 12);
    assert.equal(new Set(SEASON_IDS).size, 12);
    assert.deepEqual(new Set(SOLAR_IDS.map(id => COSMETICS[id]?.type)), new Set(['hat', 'gloves', 'cape', 'wings', 'shoes', 'backpack']));
    assert.deepEqual(new Set(TIDAL_IDS.map(id => COSMETICS[id]?.type)), new Set(['hat', 'cape', 'wings', 'shoes', 'backpack', 'pet']));
    for (const id of SOLAR_IDS) {
        const item = COSMETICS[id];
        assert.match(`${item.name} ${item.description}`, /solar circuit/i, `${id} stays searchable`);
        assert.deepEqual(item.colors, ['#f6af32', '#142a4b'], `${id} uses the Solar Circuit palette`);
    }
    for (const id of TIDAL_IDS) {
        const item = COSMETICS[id];
        assert.match(`${item.name} ${item.description}`, /tidal drift/i, `${id} stays searchable`);
        assert.deepEqual(item.colors, ['#74e4cf', '#313c8a'], `${id} uses the Tidal Drift palette`);
    }
});

test('season descriptors retain exact client/server type and price parity', () => {
    for (const id of SEASON_IDS) {
        assert.deepEqual(COSMETIC_DESCRIPTORS[id], {
            type: COSMETICS[id].type,
            price: COSMETICS[id].price
        }, `${id} descriptor parity`);
    }
});

test('season purchases grant only server-authorized cosmetics and equip their owned slots', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-season-cosmetics-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(directory, 'profiles.json'));
    const session = store.session('', 'Season', { currency: 10000 });
    const profile = store.authenticate(session.token);
    for (const id of SEASON_IDS) {
        assert.equal(store.purchase(profile, 'cosmetic', id).status, 200, `${id} can be purchased`);
    }
    assert.deepEqual(new Set(profile.ownedCosmetics.filter(id => SEASON_IDS.includes(id))), new Set(SEASON_IDS));
    const equipped = store.equipCosmetics(profile, {
        hat: 'hat_solar_circuit_headset', gloves: 'gloves_solar_circuit_grips',
        cape: 'cape_solar_circuit_streamer', wings: 'wings_solar_circuit_panels',
        shoes: 'shoes_solar_circuit_sprints', backpack: 'backpack_solar_circuit_court_bag',
        pet: 'pet_tidal_drift_ray'
    });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.loadout.hat, 'hat_solar_circuit_headset');
    assert.equal(equipped.loadout.backpack, 'backpack_solar_circuit_court_bag');
    assert.equal(equipped.loadout.pet, 'pet_tidal_drift_ray');
});

test('season headset and court bag keep distinct lightweight geometry and socket lifecycle', async () => {
    const [threeSource, modelSource] = await Promise.all([
        readFile(new URL('./helpers/three-stub.mjs', import.meta.url), 'utf8'),
        readFile(new URL('../js/cosmetic-models.js', import.meta.url), 'utf8')
    ]);
    const threeUrl = `data:text/javascript;base64,${Buffer.from(`${threeSource}\nexport class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }`).toString('base64')}`;
    const modelUrl = `data:text/javascript;base64,${Buffer.from(modelSource
        .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
        .replace(/import \{[\s\S]*?\} from '\.\/character-rig\.js';/, `const HEAD_SIZE = 0.5; const HEAD_MESH_LOCAL_Y = 0.2; const HEAD_HALF_DEPTH = 0.25; const HIPS_WORLD_Y = 0.75; const HEAD_SOCKET_LOCAL_Y = 0.45; const FACE_SOCKET_LOCAL_Y = 0.2; const FACE_SOCKET_LOCAL_Z = -0.25;`)
        .replace("import { COSMETICS, normalizeWearableLoadout } from './cosmetic-catalog.js';", `const COSMETICS = ${JSON.stringify(COSMETICS)}; const normalizeWearableLoadout = value => Object.fromEntries(['cape', 'pet', 'shoes', 'aura', 'impact', 'hat', 'mask', 'wings', 'backpack', 'banner', 'trail', 'finisher', 'gloves'].map(type => [type, COSMETICS[value?.[type]]?.type === type ? value[type] : 'none']));`)
        .replace("import { disposeObject3D } from './weapon-models.js';", 'const disposeObject3D = object => object.traverse(child => { child.geometry?.dispose?.(); child.material?.dispose?.(); });')).toString('base64')}`;
    const THREE = await import(threeUrl);
    const { applyEntityCosmetics } = await import(modelUrl);
    const group = new THREE.Group();
    Object.getPrototypeOf(group.position).sub = function(vector) {
        this.x -= vector.x;
        this.y -= vector.y;
        this.z -= vector.z;
        return this;
    };
    const head = new THREE.Group();
    const back = new THREE.Group();
    head.position.y = 2;
    back.position.y = 1.4;
    head.getWorldPosition = out => out.set(0, 2, 0);
    back.getWorldPosition = out => out.set(0, 1.4, 0);
    group.updateMatrixWorld = () => {};
    group.worldToLocal = point => point;
    group.add(head, back);
    const entity = { group, rig: { sockets: { head, back } } };

    applyEntityCosmetics(entity, {
        hat: 'hat_solar_circuit_headset', backpack: 'backpack_solar_circuit_court_bag'
    });
    const headset = entity._rigCosmetics.find(model => model.name === 'cosmetic-hat');
    const courtBag = entity._rigCosmetics.find(model => model.name === 'cosmetic-backpack');
    assert.equal(headset.userData.silhouette, 'sport-headset');
    assert.equal(courtBag.userData.silhouette, 'court-bag');
    assert.equal(headset.children.length, 4, 'headset remains a four-piece low-poly silhouette');
    assert.equal(courtBag.children.length, 5, 'court bag remains a five-piece low-poly silhouette');
    assert.ok(Math.abs(headset.position.y + 0.04) < 1e-9, 'headset preserves the cap-local head socket baseline');
    assert.ok(Math.abs(courtBag.position.y + 1.4) < 1e-9, 'court bag preserves the authored back-pack space');

    applyEntityCosmetics(entity, { hat: 'hat_tidal_drift_cap' });
    assert.equal(head.children.includes(headset), false, 'reapplying cosmetics detaches the replaced headset');
    assert.equal(back.children.includes(courtBag), false, 'reapplying cosmetics detaches the replaced court bag');
});
