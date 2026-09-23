// arena-solid-props.test.mjs — the world-collision contract, checked on the
// REAL full build of every dodgeball map (vendored three.js, no WebGL, no-op
// canvas; the lazily loaded map-art layer included):
//   * every opaque mesh standing in the play space has a collider that the
//     ball AND players respect, or is explicitly pass-through (soft foliage,
//     clouds, portals, animated wildlife) — nothing solid-looking is walked or
//     shot through;
//   * props register exact-extent solids (one path: _addSolidBox /
//     _addSolidColumn); the legacy {pos, radius} band never leaks the ball
//     below a prop's visual top;
//   * collider layouts are deterministic (seeded), so lobby clients agree;
//   * one-way decks are real surfaces for the ball (ball-only slabs);
//   * a player rising into a raised slab bumps his head instead of being
//     shoved sideways, and ground-level GLB decor is kept out of the court.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const THREE = await import('three');
const { Arena, MAPS, PROP_COLLIDER_SLACK } = await import('../js/arena.js');
const art = await import('../js/map-art/index.js');
const { SPORTS } = await import('../js/sports.js');
const { resolveHeadBump } = await import('../js/player.js');
const { courtClearanceShift, computeDecorPlacements } = await import('../js/arena-decor.js');

const DODGEBALL_MAPS = SPORTS.dodgeball.mapIds;
const BALL_RADIUS = 0.47;

function makeRenderer() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x6fdfd9, 60, 180);
    scene.add(new THREE.DirectionalLight(0xfff4e6, 1.8), new THREE.AmbientLight(0x8899cc, 0.6), new THREE.HemisphereLight(0xbfe6ff, 0xffd8a8, 0.45));
    return {
        scene, _quality: 'medium',
        renderer: { setClearColor() {}, toneMappingExposure: 1 },
        createToonMaterial: color => new THREE.MeshBasicMaterial({ color }),
        shouldLightDecor: () => true,
        setBloomProfile() {}
    };
}

function buildFull(id) {
    const arena = new Arena(makeRenderer(), id);
    const tier = arena._mapArtTier();
    if (art.hasMapArt(id, tier)) art.buildMapArt(arena, tier);
    return arena;
}

const built = new Map();
function arenaFor(id) {
    if (!built.has(id)) built.set(id, buildFull(id));
    return built.get(id);
}

// Exact world AABB of a mesh (its own vertices only, not its children).
const vertex = new THREE.Vector3();
const instanceMatrix = new THREE.Matrix4();
function meshBoxes(mesh) {
    const position = mesh.geometry?.getAttribute?.('position');
    if (!position) return [];
    const boxes = [];
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let i = 0; i < count; i++) {
        let matrix = mesh.matrixWorld;
        if (mesh.isInstancedMesh) {
            mesh.getMatrixAt(i, instanceMatrix);
            matrix = instanceMatrix.premultiply(mesh.matrixWorld);
        }
        const box = new THREE.Box3();
        for (let v = 0; v < position.count; v++) box.expandByPoint(vertex.fromBufferAttribute(position, v).applyMatrix4(matrix));
        boxes.push(box);
    }
    return boxes;
}

function flaggedPassThrough(object) {
    for (let o = object; o; o = o.parent) {
        if (o.userData?.passThrough || o.userData?.nonColliding || o.userData?.presentationOnly) return true;
        if (o.visible === false) return true;
    }
    return false;
}

// Vertical extent a collider blocks at its footprint.
function colliderSpan(c) {
    if (Number.isFinite(c.top)) return [Number.isFinite(c.minY) ? c.minY : c.bottom, c.top];
    const reach = c.radius + BALL_RADIUS + PROP_COLLIDER_SLACK;
    return [c.pos.y - reach, c.pos.y + reach];
}
function colliderContains(c, x, y, z, slack) {
    const [lo, hi] = colliderSpan(c);
    if (y < lo - slack || y > hi + slack) return false;
    if (Number.isFinite(c.minX)) {
        return x >= c.minX - slack && x <= c.maxX + slack && z >= c.minZ - slack && z <= c.maxZ + slack;
    }
    return Math.hypot(x - c.pos.x, z - c.pos.z) <= c.radius + slack;
}

// Opaque, reachable meshes standing in the court with no collider.
function uncoveredSolids(arena) {
    const halfW = arena.courtWidth / 2;
    const halfL = arena.courtLength / 2;
    const registered = new Set(arena.collidables.filter(c => Number.isFinite(c.top) && c.mesh).map(c => c.mesh));
    const out = [];
    for (const root of arena.objects) {
        root.updateMatrixWorld(true);
        root.traverse(object => {
            if (!object.isMesh || flaggedPassThrough(object) || registered.has(object)) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            if (materials.every(m => m?.transparent && m.opacity < 0.5)) return;
            for (const box of meshBoxes(object)) {
                const bottom = Math.max(0, box.min.y);
                if (box.max.y < 0.5 || box.min.y > 3.5 || box.max.y - bottom < 0.5) continue;
                const sx = box.max.x - box.min.x;
                const sz = box.max.z - box.min.z;
                if (Math.max(sx, sz) < 0.55 || sx > arena.courtWidth * 0.9 || sz > arena.courtLength * 0.9) continue;
                if (box.max.x < -halfW + 0.5 || box.min.x > halfW - 0.5 || box.max.z < -halfL + 0.5 || box.min.z > halfL - 0.5) continue;
                const cx = (box.min.x + box.max.x) / 2;
                const cz = (box.min.z + box.max.z) / 2;
                const samples = [bottom + 0.3, (bottom + box.max.y) / 2, box.max.y - 0.3];
                const covered = samples.every(y => arena.collidables.some(c => colliderContains(c, cx, y, cz, 0.35)))
                    || arena.platforms.some(p => Math.abs(cx - p.x) <= p.halfWidth + 0.35 && Math.abs(cz - p.z) <= p.halfDepth + 0.35
                        && Math.abs(p.y - box.max.y) < 0.8 && box.max.y - bottom < 1.2);
                if (!covered) {
                    out.push(`${object.geometry.type} (${cx.toFixed(1)}, ${cz.toFixed(1)}) y ${bottom.toFixed(1)}-${box.max.y.toFixed(1)} ${sx.toFixed(1)}x${sz.toFixed(1)}`);
                }
            }
        });
    }
    return out;
}

test('every opaque prop standing in the court collides (ball + players) or is explicitly pass-through', () => {
    const bad = [];
    for (const id of DODGEBALL_MAPS) {
        for (const entry of uncoveredSolids(arenaFor(id))) bad.push(`${id}: ${entry}`);
    }
    assert.deepEqual(bad, [], 'solid-looking props without colliders');
});

test('props register exact-extent solids; a legacy band never leaks the ball below a mesh top', () => {
    const leaks = [];
    for (const id of DODGEBALL_MAPS) {
        const arena = arenaFor(id);
        for (const c of arena.collidables) {
            if (Number.isFinite(c.top)) {
                assert.ok(c.top > (Number.isFinite(c.minY) ? c.minY : c.bottom), `${id} solid has height`);
                continue;
            }
            if (c.breakable || !c.mesh?.isMesh) continue;
            const [box] = meshBoxes(c.mesh);
            const bandTop = c.pos.y + c.radius + BALL_RADIUS + PROP_COLLIDER_SLACK;
            if (box.max.y > bandTop + 0.05) leaks.push(`${id} (${c.pos.x}, ${c.pos.z}) mesh top ${box.max.y.toFixed(2)} > band ${bandTop.toFixed(2)}`);
        }
    }
    assert.deepEqual(leaks, []);
});

test('map builders never call the legacy collider primitive directly', async () => {
    const source = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
    const allowed = new Set(['_addColumnColliders', '_addSolidCylinder', '_addLowCoverColliders']);
    const callers = [];
    const pattern = /this\.addCollidable\(/g;
    let match;
    while ((match = pattern.exec(source))) {
        const before = source.slice(0, match.index);
        const methods = [...before.matchAll(/^ {4}([A-Za-z_]\w*)\([^)]*\) \{\r?$/gm)];
        callers.push(methods.at(-1)?.[1]);
    }
    assert.ok(callers.length > 0);
    assert.deepEqual(callers.filter(name => !allowed.has(name)), [], 'props use _addSolidBox / _addSolidColumn');
});

test('collider layouts are seeded: every client builds identical collision', () => {
    const originalRandom = Math.random;
    const snapshot = arena => JSON.stringify({
        c: arena.collidables.map(c => [c.pos.x, c.pos.y, c.pos.z, c.radius, c.minX, c.maxX, c.minZ, c.maxZ, c.bottom, c.top]),
        p: arena.platforms
    });
    try {
        for (const id of DODGEBALL_MAPS) {
            Math.random = () => 0.13;
            const first = new Arena(makeRenderer(), id);
            Math.random = () => 0.87;
            const second = new Arena(makeRenderer(), id);
            assert.equal(snapshot(first), snapshot(second), `${id} colliders do not depend on Math.random`);
            first.clearMap();
            second.clearMap();
        }
    } finally {
        Math.random = originalRandom;
    }
});

test('one-way decks are real surfaces for the ball: each has a ball-only slab', () => {
    let decks = 0;
    for (const id of DODGEBALL_MAPS) {
        const arena = arenaFor(id);
        for (const deck of arena.platforms.filter(p => !p.solid)) {
            decks++;
            const slab = arena.collidables.find(c => c.ballOnly && c.maxY === deck.y
                && Math.abs(c.minX - (deck.x - deck.halfWidth)) < 1e-9 && Math.abs(c.maxZ - (deck.z + deck.halfDepth)) < 1e-9);
            assert.ok(slab, `${id} deck (${deck.x}, ${deck.z}) has a ball slab`);
            assert.equal(slab.maxY, deck.y, 'slab top is the deck top');
            assert.ok(slab.minY > 0 && slab.minY < deck.y, 'slab floats (walkable beneath)');
        }
    }
    assert.ok(decks >= 8, 'mecha, subway and dropworks decks were checked');
});

test('a player rising into a raised slab bumps his head; walking beside it is untouched', () => {
    const slab = { minX: -1, maxX: 1, minY: 2, maxY: 2.3, minZ: -5, maxZ: 5, bottom: 2, top: 2.3 };
    const radius = 0.7;
    const height = 1.7;
    // Head (eye + 0.2) crosses the underside this frame.
    const rising = { x: 0.2, y: 1.95, z: 0 };
    assert.equal(resolveHeadBump(rising, { x: 0.2, y: 1.7, z: 0 }, radius, height, slab), true);
    assert.ok(Math.abs(rising.y + 0.2 - 2) < 1e-3 && rising.y + 0.2 <= 2, 'head rests on the underside');
    assert.equal(rising.x, 0.2, 'no sideways shove');
    // Already above the slab (landing from above) or beside it: no bump.
    assert.equal(resolveHeadBump({ x: 0, y: 4.1, z: 0 }, { x: 0, y: 4.2, z: 0 }, radius, height, slab), false);
    assert.equal(resolveHeadBump({ x: 3, y: 2.5, z: 0 }, { x: 3, y: 1.7, z: 0 }, radius, height, slab), false);
    // Floor-standing props never bump.
    assert.equal(resolveHeadBump({ x: 0, y: 1.9, z: 0 }, { x: 0, y: 1.7, z: 0 }, radius, height, { ...slab, minY: 0, bottom: 0 }), false);
});

test('ground-level GLB decor is pushed clear of the court (it never collides)', () => {
    const halfW = 50;
    const halfL = 35;
    // Bleachers poking 3 m into the court on the north end.
    const north = courtClearanceShift({ minX: -12, maxX: 12, minZ: -48, maxZ: -32 }, halfW, halfL);
    assert.deepEqual(north, { x: 0, z: -3.5 });
    // East stand poking 1 m in.
    const east = courtClearanceShift({ minX: 49, maxX: 65, minZ: -12, maxZ: 12 }, halfW, halfL);
    assert.deepEqual(east, { x: 1.5, z: 0 });
    assert.deepEqual(courtClearanceShift({ minX: 60, maxX: 70, minZ: 0, maxZ: 4 }, halfW, halfL), { x: 0, z: 0 });
    const gym = computeDecorPlacements(MAPS.dojo, MAPS.dojo).gym[0];
    assert.ok(Math.abs(gym.x) > MAPS.dojo.courtWidth / 2, 'gym clutter stands outside the court');
});

test.after(() => {
    for (const arena of built.values()) arena.clearMap();
});
