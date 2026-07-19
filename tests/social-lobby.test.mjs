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
    SOCIAL_HUB_MAPS,
    SocialLobby,
    createSocialBoundaryColliders,
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

test('island arena satisfies Player movement contract', () => {
    const arena = createSocialLobbyArena();
    const spawn = arena.getPlayerSpawn();

    assert.deepEqual(arena.bounds, {
        minX: -220,
        maxX: 220,
        minY: -12,
        maxY: 110,
        minZ: -220,
        maxZ: 220
    });
    assert.equal(arena.ceilingHeight, 110);
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 2, 28]);
    assert.deepEqual(arena.getHazardAt(spawn), null);
    assert.equal(arena.collidables.filter(collider => collider.invisibleBoundary).length, 4);
    assert.ok(Array.isArray(arena.platforms));
    assert.ok(Array.isArray(arena.jumpPads));
});

test('island removes custom parkour props and keeps a terrain floor', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(SOCIAL_LOBBY_PROP_COLLIDERS, []);
    assert.deepEqual(arena.jumpPads, []);
    assert.deepEqual(arena.platforms, [{ x: 0, z: 0, y: 0, halfWidth: 214, halfDepth: 214 }]);
    assert.doesNotMatch(source, /_buildPracticeCourse|practice-parkour/);
});

test('map state normalizes and clamps player and visitors', () => {
    const player = { position: { x: -220, y: 7, z: 220 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 1000, z: -1000 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);

    assert.deepEqual(state.bounds, {
        minX: -220,
        maxX: 220,
        minY: -12,
        maxY: 110,
        minZ: -220,
        maxZ: 220
    });
    assert.deepEqual(state.player, { x: 0, z: 1 });
    assert.deepEqual(state.visitors, [
        { id: 'center', name: 'Center', local: false, x: 0.5, z: 0.5 },
        { id: 'outside', name: null, local: true, x: 1, z: 0 }
    ]);
    assert.equal('practice' in state, false);
    assert.deepEqual({ player, presence }, before);
});

test('each social hub map has a bounded spawn and collision layout', () => {
    const arena = createSocialLobbyArena('island');
    const construct = createSocialLobbyArena('construct');
    const city = createSocialLobbyArena('city');
    const state = getSocialLobbyMapState({ x: 220, z: -220 }, [], 'island');
    const spawn = arena.getPlayerSpawn();

    assert.equal(SOCIAL_HUB_MAPS.island.name, 'Island');
    assert.deepEqual(arena.bounds, { minX: -220, maxX: 220, minY: -12, maxY: 110, minZ: -220, maxZ: 220 });
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 2, 28]);
    assert.deepEqual(state.player, { x: 1, z: 0 });
    assert.equal(arena.collidables.filter(collider => collider.invisibleBoundary).length, 4);
    assert.equal(arena.getWaterAt({ x: 80, z: 0 }), null);
    assert.equal(arena.getWaterAt({ x: 0, z: 0 }), null);
    assert.deepEqual([construct.getPlayerSpawn().x, construct.getPlayerSpawn().y, construct.getPlayerSpawn().z], [0, 2, 92]);
    assert.deepEqual([city.getPlayerSpawn().x, city.getPlayerSpawn().y, city.getPlayerSpawn().z], [0, 2, 86]);
    assert.ok(construct.collidables.length > 8);
    assert.ok(city.collidables.length > 8);
    assert.match(SOCIAL_HUB_MAPS.construct.credit, /CC BY/);
    assert.match(SOCIAL_HUB_MAPS.city.credit, /CC BY/);
});

test('map state handles exact bounds and invalid optional inputs', () => {
    assert.deepEqual(getSocialLobbyMapState({ x: 220, z: -220 }).player, { x: 1, z: 0 });
    assert.equal(getSocialLobbyMapState({ x: Infinity, z: 0 }).player, null);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('invisible hub boundaries enclose every map edge', () => {
    const boundaries = createSocialBoundaryColliders(createSocialLobbyArena('city').bounds);
    assert.equal(boundaries.length, 4);
    assert.ok(boundaries.every(collider => collider.invisibleBoundary));
    assert.ok(boundaries.some(collider => collider.maxX <= -120));
    assert.ok(boundaries.some(collider => collider.minX >= 120));
    assert.ok(boundaries.some(collider => collider.maxZ <= -120));
    assert.ok(boundaries.some(collider => collider.minZ >= 120));
});

test('runtime keeps the island assets local without a retired map runtime', () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /Promise\.allSettled/);
    assert.doesNotMatch(source, /olann-island\/olann-island\.glb/);
    assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
    assert.match(source, /createSocialBoundaryColliders/);
    assert.match(source, /THREE\.SRGBColorSpace/);
    assert.match(source, /getMapBlocks\(\)/);
    assert.match(source, /_buildIslandWorld\(\)/);
    assert.match(source, /_installHubMap\(map, model\)/);
    assert.match(source, /assets\/user-content\/social-hub\/construct\.glb/);
    assert.match(source, /assets\/user-content\/social-hub\/chicken-city\.glb/);
    assert.match(source, /volle-harbor-plaza/);
    assert.match(source, /selectMap\(mapId/);
    assert.match(source, /\['a', 'f', 'k', 'r'\]/);
    assert.match(source, /character-\$\{id\}\.glb/);
});

test('optimized Construct and Chicken City hub assets ship locally', async () => {
    const assets = [
        new URL('../assets/user-content/social-hub/construct.glb', import.meta.url),
        new URL('../assets/user-content/social-hub/chicken-city.glb', import.meta.url)
    ];
    for (const asset of assets) {
        const file = await readFile(asset);
        assert.ok(file.length > 100_000);
        assert.equal(file.subarray(0, 4).toString('ascii'), 'glTF');
    }
});

test('collider grid returns only the current spatial cell', () => {
    const near = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const far = { minX: 40, maxX: 44, minZ: 40, maxZ: 44 };
    const edge = { minX: 12.1, maxX: 14, minZ: -2, maxZ: 2 };
    const grid = createSocialColliderGrid([near, far, edge], 12);

    assert.deepEqual(grid.query({ x: 0, z: 0 }), [near, edge]);
    assert.ok(grid.query({ x: 11.5, z: 0 }).includes(edge));
    assert.deepEqual(grid.query({ x: 42, z: 42 }), [far]);
    assert.deepEqual(grid.query({ x: 20, z: 20 }), []);
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
