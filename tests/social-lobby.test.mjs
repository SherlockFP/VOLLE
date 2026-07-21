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

test('social hub exposes exactly one estate map with no retired map id', () => {
    const retiredMapId = [105, 115, 108, 97, 110, 100].map(code => String.fromCharCode(code)).join('');
    assert.deepEqual(Object.keys(SOCIAL_HUB_MAPS), ['estate']);
    assert.equal(SOCIAL_HUB_MAPS.estate.id, 'estate');
    assert.equal(source.toLowerCase().includes(retiredMapId), false);
});

test('estate arena satisfies Player movement contract', () => {
    const arena = createSocialLobbyArena();
    const spawn = arena.getPlayerSpawn();
    assert.deepEqual(arena.bounds, { minX: -180, maxX: 180, minY: -8, maxY: 80, minZ: -160, maxZ: 160 });
    assert.equal(arena.ceilingHeight, 80);
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 2, 126]);
    assert.deepEqual(arena.getHazardAt(spawn), null);
    assert.equal(arena.collidables.filter(collider => collider.invisibleBoundary).length, 4);
    assert.deepEqual(arena.jumpPads, []);
    assert.deepEqual(arena.platforms, [{ x: 0, z: 0, y: 0, halfWidth: 174, halfDepth: 154 }]);
});

test('walk-through mansions have bounded shells, interiors, and open entrances', () => {
    const arena = createSocialLobbyArena('estate');
    const boxes = arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary);
    assert.ok(boxes.filter(collider => collider.zone === 'main-manor').length >= 5);
    assert.ok(boxes.filter(collider => collider.zone === 'main-interior').length >= 4);
    assert.ok(boxes.filter(collider => collider.zone === 'west-house').length >= 5);
    assert.ok(boxes.filter(collider => collider.zone === 'east-house').length >= 5);
    assert.equal(boxes.some(collider => collider.minX <= 0 && collider.maxX >= 0 && collider.minZ <= -63 && collider.maxZ >= -63), false);
    assert.equal(boxes.some(collider => collider.minX <= -108 && collider.maxX >= -108 && collider.minZ <= 30 && collider.maxZ >= 30), false);
    assert.equal(boxes.some(collider => collider.minX <= 108 && collider.maxX >= 108 && collider.minZ <= 30 && collider.maxZ >= 30), false);
});

test('estate pools are swimmable and plaza remains dry', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(arena.getWaterAt({ x: -82, z: 85 }), { kind: 'pool', surfaceY: 1.65, floorY: -3.2 });
    assert.deepEqual(arena.getWaterAt({ x: 82, z: 85 }), { kind: 'pool', surfaceY: 1.65, floorY: -3.2 });
    assert.equal(arena.getWaterAt({ x: 0, z: 34 }), null);
    assert.equal(arena.getWaterAt({ x: Infinity, z: 85 }), null);
});

test('map state normalizes and clamps player and visitors without mutation', () => {
    const player = { position: { x: -180, y: 7, z: 160 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 1000, z: -1000 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);
    assert.deepEqual(state.bounds, { minX: -180, maxX: 180, minY: -8, maxY: 80, minZ: -160, maxZ: 160 });
    assert.deepEqual(state.player, { x: 0, z: 1 });
    assert.deepEqual(state.visitors, [
        { id: 'center', name: 'Center', local: false, x: .5, z: .5 },
        { id: 'outside', name: null, local: true, x: 1, z: 0 }
    ]);
    assert.deepEqual({ player, presence }, before);
});

test('invalid map ids fall back to estate and optional inputs stay safe', () => {
    assert.deepEqual(createSocialLobbyArena('missing').getPlayerSpawn(), createSocialLobbyArena('estate').getPlayerSpawn());
    assert.deepEqual(getSocialLobbyMapState({ x: 180, z: -160 }, [], 'missing').player, { x: 1, z: 0 });
    assert.equal(getSocialLobbyMapState({ x: Infinity, z: 0 }).player, null);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('invisible boundaries enclose every estate edge', () => {
    const boundaries = createSocialBoundaryColliders(createSocialLobbyArena().bounds);
    assert.equal(boundaries.length, 4);
    assert.ok(boundaries.every(collider => collider.invisibleBoundary));
    assert.ok(boundaries.some(collider => collider.maxX <= -180));
    assert.ok(boundaries.some(collider => collider.minX >= 180));
    assert.ok(boundaries.some(collider => collider.maxZ <= -160));
    assert.ok(boundaries.some(collider => collider.minZ >= 160));
});

test('collider grid indexes boxes and round decor in nearby cells', () => {
    const near = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const far = { minX: 40, maxX: 44, minZ: 40, maxZ: 44 };
    const round = { pos: { x: 12, z: 0 }, radius: 2 };
    const grid = createSocialColliderGrid([near, far, round], 12);
    assert.deepEqual(grid.query({ x: 0, z: 0 }), [near, round]);
    assert.ok(grid.query({ x: 12.5, z: 0 }).includes(round));
    assert.deepEqual(grid.query({ x: 42, z: 42 }), [far]);
    assert.deepEqual(grid.query({ x: 20, z: 20 }), []);
});

test('runtime builds a local procedural estate and preserves lifecycle API', () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /_buildEstateWorld\(\)/);
    assert.match(source, /warrball-grand-estate/);
    assert.match(source, /createProceduralTexture/);
    assert.match(source, /new THREE\.CanvasTexture/);
    assert.match(source, /THREE\.RepeatWrapping/);
    assert.match(source, /new THREE\.MeshPhysicalMaterial/);
    assert.match(source, /new THREE\.ShaderMaterial/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
    assert.match(source, /disposeObjectResources/);
    assert.match(source, /selectMap\(mapId/);
    assert.match(source, /getMapBlocks\(\)/);
    assert.match(source, /interact\(\) \{ return false; \}/);
    assert.equal(SocialLobby.prototype.interact.call({ active: true }), false);
    assert.ok(SOCIAL_LOBBY_PROP_COLLIDERS.length >= 6);
});

test('every social hub GLB ships each external texture it references', async () => {
    const assetRoot = new URL('../assets/cc0/kenney/', import.meta.url);
    const glbs = [
        ...['a', 'f', 'k', 'r'].map(id => new URL(`blocky-characters/character-${id}.glb`, assetRoot)),
        ...['banner', 'statue', 'tree', 'trophy'].map(name => new URL(`mini-arena/${name}.glb`, assetRoot))
    ];
    for (const glb of glbs) {
        const bytes = await readFile(glb);
        const jsonLength = bytes.readUInt32LE(12);
        const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
        for (const image of json.images || []) await assert.doesNotReject(access(new URL(image.uri, glb)), `${glb.pathname} -> ${image.uri}`);
    }
});
