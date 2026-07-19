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
    .replace(/^import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader\.js';$/m, 'class GLTFLoader {}');
const {
    SOCIAL_LOBBY_PROP_COLLIDERS,
    SocialLobby,
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
        minX: -38,
        maxX: 38,
        minY: 0,
        maxY: 18,
        minZ: -38,
        maxZ: 38
    });
    assert.equal(arena.ceilingHeight, 18);
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 1.7, 24]);
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
    assert.match(source, /this\.arena\.collidables\.push\(\{\s*mesh: model,\s*pos: model\.position\.clone\(\),\s*radius: collisionRadius/s);
});

test('map state normalizes and clamps player, visitors, and practice area', () => {
    const player = { position: { x: -38, y: 7, z: 38 } };
    const presence = [
        { id: 'center', name: 'Center', local: false, position: { x: 0, z: 0 } },
        { id: 'outside', local: true, position: { x: 100, z: -100 } },
        { id: 'invalid', position: { x: NaN, z: 0 } }
    ];
    const before = structuredClone({ player, presence });
    const state = getSocialLobbyMapState(player, presence);

    assert.deepEqual(state.bounds, {
        minX: -38,
        maxX: 38,
        minY: 0,
        maxY: 18,
        minZ: -38,
        maxZ: 38
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
    assert.deepEqual(getSocialLobbyMapState({ x: 38, z: -38 }).player, { x: 1, z: 0 });
    assert.equal(getSocialLobbyMapState({ x: Infinity, z: 0 }).player, null);
    assert.deepEqual(getSocialLobbyMapState(null, null).visitors, []);
});

test('runtime keeps CC0 assets local and preserves procedural fallback', () => {
    assert.equal(source.includes('https://'), false);
    assert.match(source, /_buildFallbackPlaza\(\)/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /\['a', 'f', 'k', 'r'\]/);
    assert.match(source, /character-\$\{id\}\.glb/);
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
