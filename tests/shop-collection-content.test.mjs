import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { COSMETICS, normalizeWearableLoadout } from '../js/cosmetic-catalog.js';
import { cosmeticIconDescriptor, createCosmeticIcon } from '../js/cosmetic-icons.js';

// Exercise real matrices, bounds, geometry and disposal using the shipped engine.
const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});
const THREE = await import(threeUrl);
const { createCharacterRig } = await import('../js/character-rig.js');
const { applyEntityCosmetics, updateEntityCosmetics, HEAD_TOP_WORLD_Y } = await import('../js/cosmetic-models.js');
const require = createRequire(import.meta.url);
const { CASES, COSMETIC_DESCRIPTORS } = require('../server/case-catalog.js');
const { ProfileStore } = require('../server/profile-store.js');

const COLLECTIONS = {
    'Court Carnival': [
        'hat_court_carnival_visor', 'backpack_court_carnival_popcorn',
        'shoes_court_carnival_rally', 'cape_court_carnival_pennants'
    ],
    'Orbital Club': [
        'hat_orbital_club_antennas', 'pet_orbital_club_satellite',
        'backpack_orbital_club_star', 'wings_orbital_club_comet'
    ]
};
const IDS = Object.values(COLLECTIONS).flat();
const ANIMATED_IDS = IDS.filter(id => !/visor|popcorn|rally/.test(id));

function entityFor(t, rigged = true) {
    const entity = { group: new THREE.Group() };
    if (rigged) {
        entity.rig = createCharacterRig({ outlines: false });
        entity.group.add(entity.rig.root);
    }
    t.after(() => {
        applyEntityCosmetics(entity, {});
        entity.rig?.dispose();
        entity.group.clear();
    });
    return entity;
}

function equip(entity, id) {
    const item = COSMETICS[id];
    applyEntityCosmetics(entity, { [item.type]: id });
    return entity;
}

function rootsOf(entity) {
    return [...entity.cosmeticsRoot.children, ...(entity._rigCosmetics || [])];
}

function meshesOf(entity) {
    const meshes = [];
    for (const root of rootsOf(entity)) root.traverse(node => { if (node.isMesh) meshes.push(node); });
    return meshes;
}

function boundsOf(entity) {
    entity.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const root of rootsOf(entity)) bounds.union(new THREE.Box3().setFromObject(root));
    return bounds;
}

function poseOf(entity) {
    const values = [];
    for (const root of rootsOf(entity)) root.traverse(node => {
        values.push(...node.position.toArray(), ...node.rotation.toArray().slice(0, 3), ...node.scale.toArray());
    });
    return values;
}

class SvgNode {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    append(node) { this.children.push(node); }
}
const svgDocument = { createElementNS: (_namespace, tag) => new SvgNode(tag) };

test('two affordable four-item collections remain searchable and outside every case', () => {
    assert.equal(IDS.length, 8);
    assert.equal(new Set(IDS).size, 8);
    for (const [name, ids] of Object.entries(COLLECTIONS)) {
        assert.equal(ids.length, 4);
        assert.equal(new Set(ids.map(id => COSMETICS[id].type)).size, 4, 'each collection fills four different slots');
        for (const id of ids) {
            const item = COSMETICS[id];
            assert.ok(item.name.includes(name) && item.description.includes(name), `${id}: searchable collection name`);
            assert.ok(Number.isInteger(item.price) && item.price >= 180 && item.price <= 480, `${id}: affordable price`);
            assert.deepEqual(COSMETIC_DESCRIPTORS[id], { type: item.type, price: item.price });
            assert.ok(Object.values(CASES).every(box => box.drops.every(([, dropId]) => dropId !== id)), `${id}: shop-only`);
        }
    }
});

test('every new item normalizes only into its own slot and respects ownership', () => {
    for (const id of IDS) {
        const { type } = COSMETICS[id];
        assert.equal(normalizeWearableLoadout({ [type]: id }, new Set([id]))[type], id);
        assert.equal(normalizeWearableLoadout({ [type]: id }, [id])[type], id);
        assert.equal(normalizeWearableLoadout({ [type]: id }, [])[type], 'none');
        const wrongSlot = type === 'hat' ? 'pet' : 'hat';
        assert.equal(normalizeWearableLoadout({ [wrongSlot]: id }, [id])[wrongSlot], 'none');
    }
});

test('all eight server purchases charge the exact price, equip, replay safely and persist', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-shop-collections-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'profiles.json');
    const store = new ProfileStore(file);
    const session = store.session('', 'Collections', { currency: 10000 });
    const profile = store.authenticate(session.token);
    for (const id of IDS) {
        const item = COSMETICS[id];
        assert.equal(store.equipCosmetics(profile, { [item.type]: id }).loadout[item.type], 'none', 'unowned item cannot equip');
        const before = profile.currency;
        const requestId = `collection:${id}`;
        assert.equal(store.purchase(profile, 'cosmetic', id, requestId).status, 200, id);
        assert.equal(profile.currency, before - item.price, `${id}: exact debit`);
        assert.equal(store.purchase(profile, 'cosmetic', id, requestId).replayed, true);
        assert.equal(profile.currency, before - item.price, `${id}: no duplicate debit`);
        assert.equal(profile.ownedCosmetics.filter(owned => owned === id).length, 1);
        const equipped = store.equipCosmetics(profile, { ...profile.equippedWearables, [item.type]: id });
        assert.equal(equipped.status, 200);
        assert.equal(equipped.loadout[item.type], id);
    }
    const restored = new ProfileStore(file).authenticate(session.token);
    assert.deepEqual(restored.ownedCosmetics, profile.ownedCosmetics);
    assert.deepEqual(restored.equippedWearables, profile.equippedWearables);
    assert.equal(restored.currency, profile.currency);
});

test('eight style-specific SVG silhouettes differ by their actual primitives', () => {
    const silhouettes = new Set();
    for (const id of IDS) {
        const item = COSMETICS[id];
        const descriptor = cosmeticIconDescriptor(item);
        assert.equal(descriptor.style, item.style, `${id}: explicit matching icon style`);
        const icon = createCosmeticIcon(item, svgDocument);
        assert.equal(icon.attributes.viewBox, '0 0 96 96');
        assert.ok(icon.children.length > 2);
        silhouettes.add(JSON.stringify(icon.children, (key, value) =>
            (key === 'fill' || key === 'stroke') && value !== 'none' ? 'paint' : value));
    }
    assert.equal(silhouettes.size, 8, 'new items are not generic category icons with renamed labels');
});

test('new silhouettes have distinct real geometry within bounded mesh and triangle budgets', t => {
    const signatures = new Set();
    for (const id of IDS) {
        const entity = equip(entityFor(t, false), id);
        const model = entity.cosmeticsRoot.children[0];
        assert.equal(model.userData.silhouette, COSMETICS[id].style, id);
        const meshes = meshesOf(entity);
        assert.ok(meshes.length >= 3 && meshes.length <= 18, `${id}: bounded visible components`);
        const triangles = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3, 0);
        assert.ok(triangles > 0 && triangles <= 750, `${id}: ${triangles} triangles`);
        signatures.add(JSON.stringify(meshes.map(mesh => {
            mesh.geometry.computeBoundingBox();
            return [mesh.geometry.type, mesh.geometry.attributes.position.count, mesh.geometry.boundingBox.min.toArray(), mesh.geometry.boundingBox.max.toArray(), mesh.position.toArray()];
        })));
    }
    assert.equal(signatures.size, 8, 'shape geometry differs independently of names and palettes');
});

test('new cosmetics attach to the real rig with finite visible bounds and no loadout churn', t => {
    for (const id of IDS) {
        const entity = equip(entityFor(t), id);
        const bounds = boundsOf(entity);
        const size = bounds.getSize(new THREE.Vector3());
        assert.ok([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), id);
        assert.ok(size.x > 0.2 && size.y > 0.07 && size.z > 0.02, `${id}: visible extent`);
        assert.ok(bounds.min.y >= -0.001 && bounds.max.y <= 2.7, `${id}: anchored to the body`);
        const before = rootsOf(entity);
        applyEntityCosmetics(entity, entity.wearableLoadout);
        assert.deepEqual(rootsOf(entity), before, `${id}: unchanged loadout reuses its models`);
        if (COSMETICS[id].type === 'hat') assert.equal(before[0].parent, entity.rig.sockets.head);
        if (['cape', 'backpack', 'wings'].includes(COSMETICS[id].type)) assert.equal(before[0].parent, entity.rig.sockets.back);
        if (COSMETICS[id].type === 'pet') assert.equal(before[0].parent, entity.cosmeticsRoot);
        if (COSMETICS[id].type === 'shoes') {
            assert.ok(before.some(node => node.parent === entity.rig.sockets.footL));
            assert.ok(before.some(node => node.parent === entity.rig.sockets.footR));
        }
    }
});

test('visor keeps its crown open and its brim in front; star pack has five extruded points', t => {
    const visor = equip(entityFor(t, false), 'hat_court_carnival_visor');
    const visorMeshes = meshesOf(visor);
    assert.equal(visorMeshes.some(mesh => mesh.geometry.type === 'SphereGeometry'), false, 'no dome disguising a cap as a visor');
    assert.ok(boundsOf(visor).min.z < -0.5, 'visor brim projects beyond the front face');
    const brim = visorMeshes.find(mesh => mesh.geometry.type === 'CylinderGeometry');
    assert.equal(brim.geometry.parameters.thetaLength, Math.PI, 'half-disc sports brim');
    const pack = equip(entityFor(t, false), 'backpack_orbital_club_star');
    const star = meshesOf(pack).find(mesh => mesh.geometry.type === 'ExtrudeGeometry');
    assert.ok(star, 'star has real depth, not a printed box');
    assert.equal(star.geometry.parameters.options.bevelEnabled, false);
    assert.equal(star.geometry.parameters.shapes.curves.length, 10, 'five tips alternate with five inner corners');
});

test('collection animations mutate existing objects and restore the reduced-motion time-zero pose', t => {
    assert.equal(ANIMATED_IDS.length, 5);
    for (const id of ANIMATED_IDS) {
        const entity = equip(entityFor(t), id);
        const beforeMeshes = meshesOf(entity);
        const resources = beforeMeshes.map(mesh => [mesh.geometry, mesh.material]);
        updateEntityCosmetics(entity, 0);
        const staticPose = poseOf(entity);
        updateEntityCosmetics(entity, 1.75);
        assert.notDeepEqual(poseOf(entity), staticPose, `${id}: visible idle motion`);
        for (let frame = 0; frame < 240; frame++) updateEntityCosmetics(entity, frame / 30);
        updateEntityCosmetics(entity, 100000);
        assert.ok(poseOf(entity).every(Number.isFinite));
        assert.deepEqual(meshesOf(entity), beforeMeshes, `${id}: no growing scene graph`);
        for (let index = 0; index < beforeMeshes.length; index++) {
            assert.equal(beforeMeshes[index].geometry, resources[index][0]);
            assert.equal(beforeMeshes[index].material, resources[index][1]);
        }
        updateEntityCosmetics(entity, 0);
        assert.deepEqual(poseOf(entity), staticPose, `${id}: time zero restores the static pose`);
        updateEntityCosmetics(entity, 0);
        assert.deepEqual(poseOf(entity), staticPose, `${id}: time zero never advances motion`);
    }
});

test('replacing and clearing collections detaches all sockets and disposes owned GPU resources', t => {
    const entity = entityFor(t);
    for (const ids of Object.values(COLLECTIONS)) {
        applyEntityCosmetics(entity, Object.fromEntries(ids.map(id => [COSMETICS[id].type, id])));
        const roots = rootsOf(entity);
        const resources = new Map();
        for (const mesh of meshesOf(entity)) {
            for (const resource of [mesh.geometry, mesh.material]) {
                if (resources.has(resource)) continue;
                resources.set(resource, 0);
                resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
            }
        }
        applyEntityCosmetics(entity, {});
        assert.equal(rootsOf(entity).length, 0);
        for (const root of roots) assert.equal(root.parent, null);
        for (const count of resources.values()) assert.ok(count >= 1, 'every formerly rendered geometry/material was disposed');
        for (const socket of Object.values(entity.rig.sockets)) assert.equal(socket.children.length, 0);
    }
});

test('all hats share one head-top origin, including crown, wizard and beanie pompom', t => {
    const entity = entityFor(t);
    for (const item of Object.values(COSMETICS).filter(item => item.type === 'hat')) {
        equip(entity, item.id);
        const bounds = boundsOf(entity);
        assert.ok(bounds.min.y >= HEAD_TOP_WORLD_Y - 0.25, `${item.id}: stays on the head`);
        assert.ok(bounds.max.y <= HEAD_TOP_WORLD_Y + 0.65, `${item.id}: no doubled absolute height`);
    }
});

test('masks sit on the front face and gloves remain local to both moving hand sockets', t => {
    const entity = entityFor(t);
    for (const item of Object.values(COSMETICS).filter(item => item.type === 'mask')) {
        equip(entity, item.id);
        const bounds = boundsOf(entity);
        assert.ok(bounds.min.z < -0.25 && bounds.max.z < -0.1, `${item.id}: visible ahead of the face`);
    }
    entity.rig.joints.shoulderL.rotation.z = 0.35;
    entity.rig.joints.shoulderR.rotation.x = -0.4;
    for (const item of Object.values(COSMETICS).filter(item => item.type === 'gloves')) {
        equip(entity, item.id);
        assert.equal(entity._rigCosmetics.length, 2);
        for (const glove of entity._rigCosmetics) {
            assert.ok(glove.parent === entity.rig.sockets.handL || glove.parent === entity.rig.sockets.handR);
            const socketPosition = glove.parent.getWorldPosition(new THREE.Vector3());
            const glovePosition = glove.getWorldPosition(new THREE.Vector3());
            assert.ok(socketPosition.distanceTo(glovePosition) < 1e-9, 'hand-local origin is never canceled into feet space');
            assert.ok(glove.children.length > 0, 'both hands have actual geometry');
        }
    }
});

test('court bag circular end caps face outwards along the duffel axis', t => {
    const entity = equip(entityFor(t), 'backpack_solar_circuit_court_bag');
    const caps = meshesOf(entity).filter(mesh => mesh.geometry.type === 'CylinderGeometry');
    assert.equal(caps.length, 2);
    for (const cap of caps) {
        const size = new THREE.Box3().setFromObject(cap).getSize(new THREE.Vector3());
        assert.ok(size.x < 0.04 && size.y > 0.27 && size.z > 0.27, 'thin axis matches the bag ends');
    }
});
