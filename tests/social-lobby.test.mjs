import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const modulePath = new URL('../js/social-lobby.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const moduleSource = source
    .replace(/^import \* as THREE from 'three';$/m, `
        class Vector3 {
            constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        }
        const THREE = { Vector3 };
    `)
    .replace(/^import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader\.js';$/m, 'class GLTFLoader {}')
    .replace(/^import \{ MeshoptDecoder \} from 'three\/addons\/libs\/meshopt_decoder\.module\.js';$/m, 'const MeshoptDecoder = {};');
const {
    SOCIAL_LOBBY_PROP_COLLIDERS,
    SocialLobby,
    createSocialColliderGrid,
    createSocialLobbyArena,
    getSocialLobbyMapState
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('social hub activity portal flow is disabled', () => {
    assert.doesNotMatch(source, /SOCIAL_LOBBY_PORTALS|findNearestPortal|_buildPortals/);
    assert.doesNotMatch(source, /onPrompt\s*\(|onInteract\s*\(/);
    assert.match(source, /interact\(\)\s*\{\s*return false;/);
    assert.equal(SocialLobby.prototype.interact.call({ active: true }), false);
});

test('lobby arena satisfies Player movement contract', () => {
    const arena = createSocialLobbyArena();
    const spawn = arena.getPlayerSpawn();

    assert.deepEqual(arena.bounds, {
        minX: -153,
        maxX: 153,
        minY: 0,
        maxY: 92,
        minZ: -153,
        maxZ: 153
    });
    assert.equal(arena.ceilingHeight, 92);
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 1.7, -8]);
    assert.deepEqual(arena.getHazardAt(spawn), null);
    assert.ok(Array.isArray(arena.collidables));
    assert.ok(Array.isArray(arena.platforms));
    assert.ok(Array.isArray(arena.jumpPads));
});

test('loaded solid props have bounded planar collision records', () => {
    const arena = createSocialLobbyArena();
    assert.ok(SOCIAL_LOBBY_PROP_COLLIDERS.length >= 8);

    for (const collider of SOCIAL_LOBBY_PROP_COLLIDERS) {
        assert.ok(collider.radius > 0 && collider.radius <= 2.2);
        assert.ok(collider.position.x - collider.radius >= arena.bounds.minX);
        assert.ok(collider.position.x + collider.radius <= arena.bounds.maxX);
        assert.ok(collider.position.z - collider.radius >= arena.bounds.minZ);
        assert.ok(collider.position.z + collider.radius <= arena.bounds.maxZ);
    }

    const collidableUrls = SOCIAL_LOBBY_PROP_COLLIDERS.map(collider => collider.url);
    const passable = [
        'wall-gate.glb',
        'banner.glb',
        'flag.glb',
        'platform-ramp.glb',
        'platform.glb',
        'block-moving-blue.glb',
        'spring.glb'
    ];
    for (const asset of passable) {
        assert.equal(collidableUrls.some(url => url.endsWith(asset)), false);
    }
    assert.match(source, /const collider = \{\s*mesh: model,\s*pos: model\.position\.clone\(\),\s*radius: collisionRadius/s);
    assert.match(source, /this\._roundColliders\.push\(collider\)/);
});

test('map state normalizes and clamps player, visitors, and practice area', () => {
    const player = { position: { x: -153, y: 7, z: 153 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 1000, z: -1000 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);

    assert.deepEqual(state.bounds, {
        minX: -153,
        maxX: 153,
        minY: 0,
        maxY: 92,
        minZ: -153,
        maxZ: 153
    });
    assert.deepEqual(state.player, { x: 0, z: 1 });
    assert.deepEqual(state.visitors, [
        { id: 'center', name: 'Center', local: false, x: 0.5, z: 0.5 },
        { id: 'outside', name: null, local: true, x: 1, z: 0 }
    ]);
    assert.ok(state.practice.minX >= 0 && state.practice.minX < state.practice.maxX);
    assert.ok(state.practice.maxX <= 1);
    assert.ok(state.practice.minZ >= 0 && state.practice.minZ < state.practice.maxZ);
    assert.ok(state.practice.maxZ <= 1);
    assert.deepEqual({ player, presence }, before);
});

test('map state handles exact bounds and invalid optional inputs', () => {
    assert.deepEqual(getSocialLobbyMapState({ x: 153, z: -153 }).player, { x: 1, z: 0 });
    assert.equal(getSocialLobbyMapState({ x: Infinity, z: 0 }).player, null);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('runtime keeps assets local and preserves procedural fallback', () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /_buildFallbackPlaza\(\)/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /low-poly-city-social-hub\.glb/);
    assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
    assert.match(source, /getMapBlocks\(\)/);
    assert.match(source, /\['a', 'f', 'k', 'r'\]/);
    assert.match(source, /character-\$\{id\}\.glb/);
});

test('city collider grid returns only the current spatial cell', () => {
    const near = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const far = { minX: 40, maxX: 44, minZ: 40, maxZ: 44 };
    const edge = { minX: 12.1, maxX: 14, minZ: -2, maxZ: 2 };
    const grid = createSocialColliderGrid([near, far, edge], 12);

    assert.deepEqual(grid.query({ x: 0, z: 0 }), [near, edge]);
    assert.ok(grid.query({ x: 11.5, z: 0 }).includes(edge));
    assert.deepEqual(grid.query({ x: 42, z: 42 }), [far]);
    assert.deepEqual(grid.query({ x: 20, z: 20 }), []);
});

test('optimized city, collision data, and attribution ship locally', async () => {
    const root = new URL('../assets/cc-by/costowrld-low-poly-city/', import.meta.url);
    const model = await readFile(new URL('low-poly-city-social-hub.glb', root));
    const jsonLength = model.readUInt32LE(12);
    const gltf = JSON.parse(model.subarray(20, 20 + jsonLength).toString('utf8').trim());
    const colliderData = JSON.parse(await readFile(new URL('colliders.json', root), 'utf8'));
    const license = await readFile(new URL('LICENSE.md', root), 'utf8');

    assert.ok(model.byteLength < 9_000_000);
    assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
    assert.ok(colliderData.colliders.length >= 450);
    assert.match(license, /costoWRLD/);
    assert.match(license, /creativecommons\.org\/licenses\/by\/4\.0/);
});

test('every social hub GLB ships each external texture it references', async () => {
    const assetRoot = new URL('../assets/cc0/kenney/', import.meta.url);
    const glbs = [
        ...['a', 'f', 'k', 'r'].map(id => new URL(`blocky-characters/character-${id}.glb`, assetRoot)),
        ...['banner', 'column', 'statue', 'tree', 'trophy', 'wall-gate']
            .map(name => new URL(`mini-arena/${name}.glb`, assetRoot)),
        ...['block-moving-blue', 'chest', 'flag', 'platform-ramp', 'platform', 'spring', 'tree']
            .map(name => new URL(`platformer-kit/${name}.glb`, assetRoot))
    ];

    for (const glb of glbs) {
        const bytes = await readFile(glb);
        const jsonLength = bytes.readUInt32LE(12);
        const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        for (const image of json.images || []) {
            await assert.doesNotReject(access(new URL(image.uri, glb)), `${glb.pathname} -> ${image.uri}`);
        }
    }
});
