import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const modulePath = new URL('../js/social-lobby.js', import.meta.url);
const source = await readFile(modulePath, 'utf8');
const polishSource = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
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

const PLAZA_BOUNDS = { minX: -250, maxX: 250, minY: -14, maxY: 110, minZ: -230, maxZ: 230 };
const arenaBlocks = arena => arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary);

test('the social hub exposes exactly one flagship map and no retired map id', () => {
    const retired = ['island', 'estate', 'skyline', 'harbor'];
    assert.deepEqual(Object.keys(SOCIAL_HUB_MAPS), ['plaza']);
    assert.equal(SOCIAL_HUB_MAP_ID, 'plaza');
    assert.equal(SOCIAL_HUB_MAPS.plaza.id, 'plaza');
    assert.equal(SOCIAL_HUB_MAPS.plaza.name, 'Aurora Grand Plaza');
    assert.deepEqual(SOCIAL_HUB_MAPS.plaza.zones.map(zone => zone.id), ['lobby', 'social', 'activity', 'shop']);
    for (const id of retired) assert.equal(source.toLowerCase().includes(id), false, `retired map id "${id}" still in social-lobby.js`);
});

test('the hub dwarfs the retired maps and keeps the spawn inside its own bounds', () => {
    const map = SOCIAL_HUB_MAPS.plaza;
    assert.deepEqual(map.bounds, PLAZA_BOUNDS);
    // Retired ceiling was 170 x 150 half-extents (Harbor Commons).
    assert.ok(map.bounds.maxX >= 250 && map.bounds.maxZ >= 230);
    assert.ok((map.bounds.maxX - map.bounds.minX) * (map.bounds.maxZ - map.bounds.minZ) > 2 * 340 * 285);
    const arena = createSocialLobbyArena();
    const spawn = arena.getPlayerSpawn();
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 2, 196]);
    assert.ok(spawn.x > map.bounds.minX && spawn.x < map.bounds.maxX);
    assert.ok(spawn.z > map.bounds.minZ && spawn.z < map.bounds.maxZ);
    assert.equal(arena.getWaterAt(spawn), null);
    assert.equal(arena.getHazardAt(spawn), null);
});

test('arena satisfies the Player movement contract', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(arena.bounds, PLAZA_BOUNDS);
    assert.equal(arena.ceilingHeight, 110);
    assert.deepEqual(arena.config.zones.map(zone => zone.id), ['lobby', 'social', 'activity', 'shop']);
    assert.equal(arena.collidables.filter(collider => collider.invisibleBoundary).length, 4);
    assert.deepEqual(arena.jumpPads, []);
    assert.deepEqual(arena.platforms.at(-1), { x: 0, z: 0, y: 0, halfWidth: 244, halfDepth: 224 });
    assert.equal(typeof arena.getNearbyCollidables, 'function');
});

test('every collision block stays inside bounds and is standable on its top face', () => {
    const arena = createSocialLobbyArena();
    const blocks = arenaBlocks(arena);
    assert.ok(blocks.length >= 60, `expected a dense hub, got ${blocks.length} blocks`);
    for (const block of blocks) {
        assert.ok(block.minX >= PLAZA_BOUNDS.minX && block.maxX <= PLAZA_BOUNDS.maxX, `block escapes X bounds: ${JSON.stringify(block)}`);
        assert.ok(block.minZ >= PLAZA_BOUNDS.minZ && block.maxZ <= PLAZA_BOUNDS.maxZ, `block escapes Z bounds: ${JSON.stringify(block)}`);
        assert.ok(block.maxY > block.minY && block.maxY <= PLAZA_BOUNDS.maxY);
        const top = arena.platforms.find(platform =>
            platform.y === block.maxY
            && Math.abs(platform.x - (block.minX + block.maxX) / 2) < 1e-9
            && Math.abs(platform.z - (block.minZ + block.maxZ) / 2) < 1e-9);
        assert.ok(top, `no landing platform on top of ${JSON.stringify(block)}`);
        // Player radius is 0.7 — a ledge thinner than that can never be landed on.
        assert.ok(top.halfWidth > 0.7 && top.halfDepth > 0.7);
    }
    // Highest first so a fast fall lands on the top-most deck it crosses.
    const heights = arena.platforms.map(platform => platform.y);
    assert.deepEqual(heights, [...heights].sort((a, b) => b - a));
});

test('each district carries its own silhouette and the map has real verticality', () => {
    const blocks = arenaBlocks(createSocialLobbyArena());
    const byZone = zone => blocks.filter(block => block.zone === zone);
    for (const zone of ['lobby', 'social', 'activity', 'shop', 'observatory', 'garden', 'perimeter']) {
        assert.ok(byZone(zone).length >= 3, `district "${zone}" is too thin: ${byZone(zone).length} blocks`);
    }
    assert.ok(Math.max(...byZone('social').map(block => block.maxY)) >= 60, 'the Aurora Spire landmark must dominate the skyline');
    assert.ok(Math.max(...byZone('activity').map(block => block.maxY)) >= 25, 'the terrace tower must be climbable to a sky deck');
    assert.ok(Math.max(...byZone('observatory').map(block => block.maxY)) >= 30);
    const tops = [...new Set(blocks.map(block => block.maxY))].sort((a, b) => a - b);
    assert.ok(tops.length >= 15, 'expected many distinct standing heights');
});

test('Grand Pavilion is a walk-through, collision-backed focal area with registered platforms', () => {
    const arena = createSocialLobbyArena();
    const pavilion = arenaBlocks(arena).filter(block => block.zone === 'pavilion');
    assert.equal(pavilion.length, 6, 'floor, rear wall, two side walls, and split portico walls must share the collision layout');
    assert.ok(pavilion.some(block => block.maxY === .35), 'pavilion floor must be a registered landing platform');
    assert.ok(pavilion.some(block => block.minZ === 123 && block.maxZ === 127 && block.maxX < 0));
    assert.ok(pavilion.some(block => block.minZ === 123 && block.maxZ === 127 && block.minX > 0));
    assert.equal(pavilion.some(block => block.minZ === 123 && block.maxZ === 127 && block.minX < 0 && block.maxX > 0), false, 'the southern portico entrance must remain open');
    for (const block of pavilion) {
        assert.ok(arena.platforms.some(platform => platform.y === block.maxY
            && platform.x === (block.minX + block.maxX) / 2
            && platform.z === (block.minZ + block.maxZ) / 2));
    }
    assert.match(source, /function addGrandPavilion\(group, materials\)/);
    assert.match(source, /addGrandPavilion\(world, materials\)/);
    const pavilionBuilder = source.slice(source.indexOf('function addGrandPavilion'), source.indexOf('function createNameplate'));
    assert.match(pavilionBuilder, /leftRoof\.rotation\.z = \.16/);
    assert.match(pavilionBuilder, /rightRoof\.rotation\.z = -\.16/);
    assert.match(pavilionBuilder, /materials\.pavilionRoof/);
    assert.match(source, /pavilionRoof: new THREE\.MeshStandardMaterial\(\{ color: 0x7895a6/);
    assert.match(pavilionBuilder, /addPavilionLounge\(group, materials\)/);
    assert.match(pavilionBuilder, /pavilion-warm-lounge-light/);
    assert.match(pavilionBuilder, /pavilion-lounge-bench/);
    assert.match(pavilionBuilder, /pavilion-aurora-sculpture/);
});

test('Squad Center uses readable design tokens for headings, state text, and controls', () => {
    assert.match(polishSource, /\.community-shell \.shell-title h1,\.community-layout h2 \{ color:var\(--ui-text\)/);
    assert.match(polishSource, /\.community-row small \{ color:var\(--ui-muted\)/);
    assert.match(polishSource, /\.community-row span \{ color:var\(--ui-text\)/);
    assert.match(polishSource, /\.community-add input,\.community-showcase select \{ min-width:0; color:var\(--ui-text\)/);
});

test('the Skyward Terraces stay reachable with the Player jump budget', () => {
    const blocks = arenaBlocks(createSocialLobbyArena());
    // Feet-height gain: 1.6 for a single jump, ~3.2 chaining the double jump.
    const ladder = [[-153, -30], [-172, -40], [-196, -52], [-196, -76], [-176, -106], [-148, -108], [-160, -74]];
    let previous = null;
    for (const [x, z] of ladder) {
        const step = blocks
            .filter(block => x >= block.minX && x <= block.maxX && z >= block.minZ && z <= block.maxZ)
            .sort((a, b) => b.maxY - a.maxY)[0];
        assert.ok(step, `no terrace step at ${x}, ${z}`);
        if (previous) {
            assert.ok(step.maxY - previous.maxY > 0 && step.maxY - previous.maxY <= 3.2, `unreachable rise at ${x}, ${z}`);
            const gapX = Math.max(0, Math.max(step.minX, previous.minX) - Math.min(step.maxX, previous.maxX));
            const gapZ = Math.max(0, Math.max(step.minZ, previous.minZ) - Math.min(step.maxZ, previous.maxZ));
            assert.ok(Math.hypot(gapX, gapZ) <= 9, `terrace gap too wide at ${x}, ${z}`);
        }
        previous = step;
    }
    assert.equal(previous.maxY, 25.6);
});

test('fountain and canals are swimmable while the plaza deck stays dry', () => {
    const arena = createSocialLobbyArena();
    assert.deepEqual(arena.getWaterAt({ x: 0, z: 30 }), { kind: 'fountain', surfaceY: 1.75, floorY: -3.4 });
    assert.deepEqual(arena.getWaterAt({ x: -83, z: 100 }), { kind: 'canal', surfaceY: 1.6, floorY: -3.8 });
    assert.deepEqual(arena.getWaterAt({ x: 83, z: 100 }), { kind: 'canal', surfaceY: 1.6, floorY: -3.8 });
    assert.deepEqual(arena.getWaterAt({ x: -60, z: -120 }), { kind: 'pool', surfaceY: 1.55, floorY: -2.6 });
    // surfaceY must clear the 1.7 eye height, otherwise swim mode never engages.
    for (const probe of [{ x: 0, z: 30 }, { x: -83, z: 100 }, { x: -60, z: -120 }]) {
        assert.ok(arena.getWaterAt(probe).surfaceY + 0.25 >= 1.7);
    }
    assert.equal(arena.getWaterAt({ x: 0, z: 100 }), null, 'the causeway must stay walkable');
    assert.equal(arena.getWaterAt(SOCIAL_HUB_MAPS.plaza.poseArea), null, 'the pose pad must stay dry');
    assert.equal(arena.getWaterAt({ x: Infinity, z: 100 }), null);
});

test('the pose pad and every zone marker stand on free ground', () => {
    const map = SOCIAL_HUB_MAPS.plaza;
    const blocks = arenaBlocks(createSocialLobbyArena());
    const occupied = point => blocks.some(block => point.x > block.minX && point.x < block.maxX && point.z > block.minZ && point.z < block.maxZ);
    assert.equal(occupied(map.poseArea), false);
    for (const zone of map.zones) assert.equal(occupied(zone), false, `zone marker "${zone.id}" is buried in geometry`);
    assert.ok(map.poseArea.radius >= 9);
});

test('map state normalizes and clamps player and visitors without mutation', () => {
    const player = { position: { x: -250, y: 7, z: 230 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 1000, z: -1000 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);
    assert.deepEqual(state.bounds, PLAZA_BOUNDS);
    assert.deepEqual(state.player, { x: 0, z: 1 });
    assert.deepEqual(state.visitors, [
        { id: 'center', name: 'Center', local: false, x: .5, z: .5 },
        { id: 'outside', name: null, local: true, x: 1, z: 0 }
    ]);
    assert.deepEqual({ player, presence }, before);
});

test('optional map-state inputs stay safe', () => {
    assert.deepEqual(getSocialLobbyMapState({ x: 250, z: -230 }, []).player, { x: 1, z: 0 });
    assert.equal(getSocialLobbyMapState({ x: Infinity, z: 0 }).player, null);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('invisible boundaries enclose every plaza edge', () => {
    const boundaries = createSocialBoundaryColliders(createSocialLobbyArena().bounds);
    assert.equal(boundaries.length, 4);
    assert.ok(boundaries.every(collider => collider.invisibleBoundary));
    assert.ok(boundaries.some(collider => collider.maxX <= -250));
    assert.ok(boundaries.some(collider => collider.minX >= 250));
    assert.ok(boundaries.some(collider => collider.maxZ <= -230));
    assert.ok(boundaries.some(collider => collider.minZ >= 230));
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

test('runtime builds one local procedural world and preserves the lifecycle API', () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /_buildPlazaWorld\(\)/);
    assert.match(source, /warrball-aurora-grand-plaza/);
    assert.match(source, /addAuroraSpire/);
    assert.match(source, /createProceduralTexture/);
    assert.match(source, /new THREE\.CanvasTexture/);
    assert.match(source, /THREE\.RepeatWrapping/);
    assert.match(source, /new THREE\.MeshPhysicalMaterial/);
    assert.match(source, /new THREE\.ShaderMaterial/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /setMeshoptDecoder\(MeshoptDecoder\)/);
    assert.match(source, /disposeObjectResources/);
    assert.match(source, /selectMap\(\)/);
    assert.match(source, /getMapBlocks\(\)/);
    assert.match(source, /interact\(\) \{ return false; \}/);
    assert.equal(SocialLobby.prototype.interact.call({ active: true }), false);
    assert.ok(SOCIAL_LOBBY_PROP_COLLIDERS.length >= 6);
    for (const prop of SOCIAL_LOBBY_PROP_COLLIDERS) {
        assert.ok(prop.position.x >= PLAZA_BOUNDS.minX && prop.position.x <= PLAZA_BOUNDS.maxX);
        assert.ok(prop.position.z >= PLAZA_BOUNDS.minZ && prop.position.z <= PLAZA_BOUNDS.maxZ);
    }
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
