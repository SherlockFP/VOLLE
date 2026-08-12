import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const modulePath = new URL('../js/social-lobby.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const manifest = await readFile(new URL('../assets/cc0/ASSET_MANIFEST.md', import.meta.url), 'utf8');
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
    SOCIAL_HUB_MAP_ID,
    SocialLobby,
    createSocialBoundaryColliders,
    createSocialColliderGrid,
    createSocialLobbyArena,
    getSocialLobbyMapState
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

const CLUBHOUSE_BOUNDS = { minX: -76, maxX: 76, minY: -8, maxY: 32, minZ: -68, maxZ: 68 };
const arenaBlocks = arena => arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary);

test('social hub exposes one compact clubhouse and no retired map id', () => {
    assert.deepEqual(Object.keys(SOCIAL_HUB_MAPS), ['plaza']);
    assert.equal(SOCIAL_HUB_MAP_ID, 'plaza');
    assert.equal(SOCIAL_HUB_MAPS.plaza.name, 'Neon Clubhouse');
    assert.deepEqual(SOCIAL_HUB_MAPS.plaza.bounds, CLUBHOUSE_BOUNDS);
    assert.deepEqual(SOCIAL_HUB_MAPS.plaza.zones.map(zone => zone.id), ['lobby', 'social', 'pool', 'stage']);
    for (const id of ['island', 'estate', 'skyline', 'harbor']) {
        assert.equal(source.toLowerCase().includes(`id: '${id}'`), false, `retired map id ${id} remains`);
    }
    const width = CLUBHOUSE_BOUNDS.maxX - CLUBHOUSE_BOUNDS.minX;
    const depth = CLUBHOUSE_BOUNDS.maxZ - CLUBHOUSE_BOUNDS.minZ;
    assert.ok(width <= 160 && depth <= 140, 'hub should stay compact enough for visible social density');
});

test('arena satisfies movement, spawn, boundary and standable-platform contracts', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(arena.bounds, CLUBHOUSE_BOUNDS);
    assert.equal(arena.ceilingHeight, 32);
    const spawn = arena.getPlayerSpawn();
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 2, 56]);
    assert.equal(arena.collidables.filter(collider => collider.invisibleBoundary).length, 4);
    assert.deepEqual(arena.platforms.at(-1), { x: 0, z: 0, y: 0, halfWidth: 74, halfDepth: 66 });
    assert.deepEqual(arena.jumpPads, []);
    assert.equal(typeof arena.getNearbyCollidables, 'function');
    const blocks = arenaBlocks(arena);
    assert.ok(blocks.length >= 14);
    for (const block of blocks) {
        assert.ok(block.minX >= CLUBHOUSE_BOUNDS.minX && block.maxX <= CLUBHOUSE_BOUNDS.maxX);
        assert.ok(block.minZ >= CLUBHOUSE_BOUNDS.minZ && block.maxZ <= CLUBHOUSE_BOUNDS.maxZ);
        assert.ok(block.maxY > block.minY && block.maxY <= CLUBHOUSE_BOUNDS.maxY);
        if (block.zone === 'decor') continue;
        assert.ok(arena.platforms.some(platform => platform.y === block.maxY
            && platform.x === (block.minX + block.maxX) / 2
            && platform.z === (block.minZ + block.maxZ) / 2));
    }
});

test('clubhouse has open pavilion, social lounge, pool, stage, garden and lobby silhouettes', () => {
    const arena = createSocialLobbyArena();
    const blocks = arenaBlocks(arena);
    for (const zone of ['pavilion', 'social', 'pool', 'stage', 'garden', 'lobby']) {
        assert.ok(blocks.some(block => block.zone === zone), `${zone} is missing`);
    }
    const pavilion = blocks.filter(block => block.zone === 'pavilion');
    assert.equal(pavilion.length, 4, 'clubhouse collision should be floor plus three walls');
    assert.ok(pavilion.some(block => block.maxY === .35));
    assert.equal(pavilion.some(block => block.minZ < -7 && block.maxZ < -6), false, 'southern entrance must remain open');
    assert.match(source, /function addGrandPavilion\(group, materials\)/);
    assert.match(source, /addPavilionLounge\(group, materials\)/);
    assert.match(source, /neon-clubhouse-lounge/);
});

test('pool is swimmable while spawn, clubhouse and pose pad remain dry', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(arena.getWaterAt({ x: -43, z: -38 }), { kind: 'pool', surfaceY: 1.55, floorY: -2.8 });
    assert.ok(arena.getWaterAt({ x: -43, z: -38 }).surfaceY + .25 >= 1.7);
    assert.equal(arena.getWaterAt(arena.getPlayerSpawn()), null);
    assert.equal(arena.getWaterAt({ x: 0, z: 15 }), null);
    assert.equal(arena.getWaterAt(SOCIAL_HUB_MAPS.plaza.poseArea), null);
    assert.equal(arena.getWaterAt({ x: Infinity, z: 0 }), null);
});

test('map state normalizes and clamps players without mutating inputs', () => {
    const player = { position: { x: -76, y: 7, z: 68 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 1000, z: -1000 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);
    assert.deepEqual(state.bounds, CLUBHOUSE_BOUNDS);
    assert.deepEqual(state.player, { x: 0, z: 1 });
    assert.deepEqual(state.visitors, [
        { id: 'center', name: 'Center', local: false, x: .5, z: .5 },
        { id: 'outside', name: null, local: true, x: 1, z: 0 }
    ]);
    assert.deepEqual({ player, presence }, before);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('boundary and collider grid helpers remain bounded and deterministic', () => {
    const boundaries = createSocialBoundaryColliders(CLUBHOUSE_BOUNDS);
    assert.equal(boundaries.length, 4);
    assert.ok(boundaries.every(collider => collider.invisibleBoundary));
    assert.ok(boundaries.some(collider => collider.maxX <= -76));
    assert.ok(boundaries.some(collider => collider.minX >= 76));
    assert.ok(boundaries.some(collider => collider.maxZ <= -68));
    assert.ok(boundaries.some(collider => collider.minZ >= 68));
    const near = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const far = { minX: 40, maxX: 44, minZ: 40, maxZ: 44 };
    const round = { pos: { x: 12, z: 0 }, radius: 2 };
    const grid = createSocialColliderGrid([near, far, round], 12);
    assert.deepEqual(grid.query({ x: 0, z: 0 }), [near, round]);
    assert.ok(grid.query({ x: 12.5, z: 0 }).includes(round));
    assert.deepEqual(grid.query({ x: 42, z: 42 }), [far]);
});

test('runtime builds one local world from licensed CC0 props and preserves lifecycle API', async () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /_buildPlazaWorld\(\)/);
    assert.match(source, /warrball-neon-clubhouse/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
    assert.match(source, /disposeObjectResources/);
    assert.match(source, /selectMap\(\)/);
    assert.match(source, /getMapBlocks\(\)/);
    assert.match(source, /interact\(\) \{ return false; \}/);
    assert.equal(SocialLobby.prototype.interact.call({ active: true }), false);
    assert.ok(SOCIAL_LOBBY_PROP_COLLIDERS.length >= 12);
    assert.match(manifest, /Kenney Furniture Kit/);
    assert.match(manifest, /CC0/);
    for (const prop of SOCIAL_LOBBY_PROP_COLLIDERS) {
        assert.ok(prop.position.x >= CLUBHOUSE_BOUNDS.minX && prop.position.x <= CLUBHOUSE_BOUNDS.maxX);
        assert.ok(prop.position.z >= CLUBHOUSE_BOUNDS.minZ && prop.position.z <= CLUBHOUSE_BOUNDS.maxZ);
        await access(new URL(`../${prop.url}`, import.meta.url));
    }
});
