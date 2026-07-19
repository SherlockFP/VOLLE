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
    SOCIAL_LOBBY_PORTALS,
    createSocialLobbyArena,
    findNearestPortal
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('social hub portals expose unique destinations', () => {
    assert.deepEqual(
        SOCIAL_LOBBY_PORTALS.map(portal => portal.id),
        ['quick-play', 'ranked', 'practice', 'shop', 'clans']
    );
    assert.equal(new Set(SOCIAL_LOBBY_PORTALS.map(portal => portal.id)).size, SOCIAL_LOBBY_PORTALS.length);
});

test('nearest portal helper is planar, bounded, and non-mutating', () => {
    const position = { x: 1, y: 99, z: -28 };
    const before = structuredClone(position);
    const match = findNearestPortal(position);

    assert.equal(match.portal.id, 'quick-play');
    assert.equal(match.distance, 1);
    assert.deepEqual(position, before);
    assert.equal(findNearestPortal({ x: 0, z: 0 }), null);
    assert.equal(findNearestPortal({ x: NaN, z: 0 }), null);
});

test('equal-distance portals resolve deterministically to the later entry', () => {
    const portals = [
        { id: 'a', position: { x: -1, z: 0 } },
        { id: 'b', position: { x: 1, z: 0 } }
    ];

    assert.equal(findNearestPortal({ x: 0, z: 0 }, portals, 2).portal.id, 'b');
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
