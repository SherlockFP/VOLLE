// map-layouts.test.mjs — pins the flagship gameplay layouts (Pillar Hall,
// Circuit Dome, Volcano, Mecha Hangar) and the map-art pass maps (Neon Rooftop,
// Sunken Temple, Orbital Station): mirror symmetry, clear spawns, an open
// ball lane between halves, deterministic builds and collider/visual agreement.
// Uses the same arena.js source-rewrite technique as tests/new-arenas.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
}
class Mesh {
    constructor(geometry, material) {
        assert.ok(geometry && material, 'mesh built with geometry + material');
        this.geometry = geometry;
        this.material = material;
        this.position = new Vec3();
        this.rotation = new Vec3();
    }
}
// Instanced part families (landmark maps) record every placed part.
class Object3D {
    constructor() { this.position = new Vec3(); this.rotation = new Vec3(); this.scale = new Vec3(1, 1, 1); this.matrix = null; }
    updateMatrix() { this.matrix = { p: this.position.clone(), r: this.rotation.clone(), s: this.scale.clone() }; }
}
class InstancedMesh extends Mesh {
    constructor(geometry, material, count) {
        super(geometry, material);
        this.count = count;
        this.parts = [];
        this.instanceMatrix = {};
        this.instanceColor = {};
    }
    setMatrixAt(i, matrix) { this.parts[i] = matrix; }
    setColorAt() {}
}
const THREE_STUB = {
    Vector3: Vec3, Mesh, InstancedMesh, Object3D, DoubleSide: 2,
    Color: class { set() { return this; } }
};
for (const name of ['BoxGeometry', 'CylinderGeometry', 'TorusGeometry', 'CircleGeometry', 'PlaneGeometry', 'DodecahedronGeometry', 'SphereGeometry', 'ConeGeometry']) {
    THREE_STUB[name] = class { constructor(...args) { this.args = args; this.kind = name; } };
}
for (const name of ['MeshBasicMaterial', 'MeshLambertMaterial', 'MeshStandardMaterial']) {
    THREE_STUB[name] = class { constructor(options = {}) { Object.assign(this, options); } };
}
globalThis.__LAYOUT_THREE_STUB__ = THREE_STUB;

const source = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
const moduleSource = source
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, 'const THREE = globalThis.__LAYOUT_THREE_STUB__;\n')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');
assert.equal(moduleSource.includes("from 'three'"), false, 'THREE import replaced by the stub');

const {
    MAPS, Arena, getArenaBounds, getGameplayLayout, PROP_COLLIDER_SLACK,
    LOW_COVER_BALL_RADIUS, lowCoverCenterY, blockCollider, SOLID_TOP_STANDABLE_MAX
} = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

// Entity sizes the collider checks run against (js/ball.js, js/player.js, js/bot.js).
const BALL_RADIUS = 0.47;
const PLAYER = { radius: 0.7, height: 1.7, jumpForce: 8, gravity: 20 };
const BOT_RADIUS = 0.5;
const MAX_TEAM_SPAWNS = 8;

const FLAGSHIP_MAPS = ['pillar', 'circuit_dome', 'volcano', 'mecha'];
const LANDMARK_MAPS = ['sunbaked_bazaar', 'harbor_nightworks', 'alpine_research', 'jade_garden'];
const ART_PASS_MAPS = ['neon_rooftop', 'sunken_temple', 'orbital_station', ...LANDMARK_MAPS];
const LAYOUT_MAPS = [...FLAGSHIP_MAPS, ...ART_PASS_MAPS];

function build(id) {
    const config = MAPS[id];
    const arena = {
        config,
        mapId: id,
        courtWidth: config.courtWidth,
        courtLength: config.courtLength,
        renderer: { createToonMaterial: color => ({ color }) },
        scene: { add() {} },
        objects: [],
        collidables: [],
        platforms: [],
        add: Arena.prototype.add,
        addCollidable: Arena.prototype.addCollidable,
        _placeMesh: Arena.prototype._placeMesh,
        _addColumnColliders: Arena.prototype._addColumnColliders,
        _addLowCoverColliders: Arena.prototype._addLowCoverColliders,
        _markSolidColumn: Arena.prototype._markSolidColumn,
        _addSolidBox: Arena.prototype._addSolidBox,
        _buildArtColumn: Arena.prototype._buildArtColumn,
        _buildLayoutBlock: Arena.prototype._buildLayoutBlock,
        _buildLandmarkProp: Arena.prototype._buildLandmarkProp,
        _newLayoutParts: Arena.prototype._newLayoutParts,
        _flushLayoutParts: Arena.prototype._flushLayoutParts,
        _layoutPartFamily: Arena.prototype._layoutPartFamily,
        _layoutCanvasTexture: Arena.prototype._layoutCanvasTexture
    };
    Arena.prototype.buildGameplayLayout.call(arena);
    return arena;
}

// Same vertical test ball.js / player.js / bot.js use for {pos, radius} colliders.
const ballBlockedAt = (c, y) => Math.abs(y - c.pos.y) < c.radius + BALL_RADIUS + PROP_COLLIDER_SLACK;
const playerBlocksOnGround = c => Math.abs(PLAYER.height - c.pos.y) < c.radius + PLAYER.radius + PROP_COLLIDER_SLACK;
const botBlocksOnGround = c => Math.abs(1.7 - c.pos.y) < c.radius + BOT_RADIUS + PROP_COLLIDER_SLACK;
const key = (...values) => values.map(v => (Object.is(v, -0) ? 0 : v).toFixed(3)).join('|');
const isBox = c => Number.isFinite(c.minX);
// Horizontal footprint of any collider: exact box, or the legacy circle.
const spanX = c => (isBox(c) ? [c.minX, c.maxX] : [c.pos.x - c.radius, c.pos.x + c.radius]);
const spanZ = c => (isBox(c) ? [c.minZ, c.maxZ] : [c.pos.z - c.radius, c.pos.z + c.radius]);
// Planar distance from a point to the collider surface (negative = inside).
function footprintDistance(c, x, z) {
    if (!isBox(c)) return Math.hypot(x - c.pos.x, z - c.pos.z) - c.radius;
    const dx = Math.max(c.minX - x, 0, x - c.maxX);
    const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
    return Math.hypot(dx, dz);
}

test('flagship + map-art maps carry distinct gameplay layouts; other maps carry none', () => {
    const ideas = LAYOUT_MAPS.map(id => getGameplayLayout(id)?.idea);
    assert.ok(ideas.every(Boolean), 'each layout map has a layout idea');
    assert.equal(new Set(ideas).size, LAYOUT_MAPS.length, 'each map is built around a different idea');
    for (const id of Object.keys(MAPS)) {
        if (!LAYOUT_MAPS.includes(id)) assert.equal(getGameplayLayout(id), null, `${id} unchanged`);
    }
    assert.equal(getGameplayLayout('custom-anything', { courtWidth: 10 }), null);
    // IDs, names and rotation visibility stay stable for saved settings / lobby sync.
    for (const id of LAYOUT_MAPS) {
        assert.ok(MAPS[id].name, `${id} keeps its name`);
        assert.ok(!MAPS[id].hiddenFromRotation, `${id} stays in rotation`);
    }
});

test('build() wires the layout pass and the layout builder is RNG-free', () => {
    const buildBody = source.slice(source.indexOf('    build() {'), source.indexOf('    _loadArenaDecor() {'));
    assert.match(buildBody, /this\.buildGameplayLayout\(\);/);
    const builder = source.slice(source.indexOf('    buildGameplayLayout() {'), source.indexOf('    buildTempleProps() {'));
    assert.equal(builder.includes('Math.random'), false);
    const layouts = source.slice(source.indexOf('const GAMEPLAY_LAYOUTS'), source.indexOf('export function getGameplayLayout'));
    assert.equal(layouts.includes('Math.random'), false);
});

test('layouts build identically every time (lobby clients agree on colliders)', () => {
    const originalRandom = Math.random;
    try {
        for (const id of LAYOUT_MAPS) {
            Math.random = () => 0.1;
            const first = build(id);
            Math.random = () => 0.9;
            const second = build(id);
            const snap = a => JSON.stringify({
                c: a.collidables.map(c => [c.pos.x, c.pos.y, c.pos.z, c.radius]),
                p: a.platforms
            });
            assert.equal(snap(first), snap(second), `${id} layout is deterministic`);
        }
    } finally {
        Math.random = originalRandom;
    }
});

test('every layout is mirror-symmetric across both axes (per team and per wing)', () => {
    for (const id of LAYOUT_MAPS) {
        const arena = build(id);
        assert.ok(arena.collidables.length + arena.platforms.length >= 2, `${id} adds real geometry`);
        const spots = new Set(arena.collidables.map(c => key(c.pos.x, c.pos.y, c.pos.z, c.radius)));
        for (const c of arena.collidables) {
            assert.ok(spots.has(key(-c.pos.x, c.pos.y, c.pos.z, c.radius)), `${id} collider (${c.pos.x}, ${c.pos.z}) lacks X mirror`);
            assert.ok(spots.has(key(c.pos.x, c.pos.y, -c.pos.z, c.radius)), `${id} collider (${c.pos.x}, ${c.pos.z}) lacks Z mirror`);
        }
        const decks = new Set(arena.platforms.map(p => key(p.x, p.z, p.y, p.halfWidth, p.halfDepth)));
        for (const p of arena.platforms) {
            assert.ok(decks.has(key(-p.x, p.z, p.y, p.halfWidth, p.halfDepth)), `${id} deck lacks X mirror`);
            assert.ok(decks.has(key(p.x, -p.z, p.y, p.halfWidth, p.halfDepth)), `${id} deck lacks Z mirror`);
        }
        // Equal count per team half.
        const red = arena.collidables.filter(c => c.pos.z < 0).length;
        const blue = arena.collidables.filter(c => c.pos.z > 0).length;
        assert.equal(red, blue, `${id} team halves carry the same cover`);
    }
});

test('props stay inside the court and every team spawn slot stays clear', () => {
    for (const id of LAYOUT_MAPS) {
        const config = MAPS[id];
        const bounds = getArenaBounds(config);
        const arena = build(id);
        for (const c of arena.collidables) {
            const [x0, x1] = spanX(c);
            const [z0, z1] = spanZ(c);
            assert.ok(x0 > bounds.minX + 2 && x1 < bounds.maxX - 2, `${id} collider inside X`);
            assert.ok(z0 > bounds.minZ + 2 && z1 < bounds.maxZ - 2, `${id} collider inside Z`);
        }
        const spawnHost = { config, courtLength: config.courtLength };
        for (const team of ['red', 'blue']) {
            for (let index = 0; index < MAX_TEAM_SPAWNS; index++) {
                const spawn = Arena.prototype.getPlayerSpawn.call(spawnHost, team, index);
                // Bots respawn with +/-4 x jitter around the slot.
                for (const jitter of [-4, 0, 4]) {
                    const x = spawn.x + jitter;
                    for (const c of arena.collidables) {
                        if (!playerBlocksOnGround(c) && !botBlocksOnGround(c)) continue;
                        const distance = footprintDistance(c, x, spawn.z);
                        assert.ok(distance > PLAYER.radius + 1.5,
                            `${id} ${team} spawn ${index} (${x}, ${spawn.z}) is ${distance.toFixed(2)} from a prop`);
                    }
                    for (const p of arena.platforms.filter(entry => !entry.solid)) {
                        const under = Math.abs(x - p.x) < p.halfWidth + 1 && Math.abs(spawn.z - p.z) < p.halfDepth + 1;
                        assert.equal(under, false, `${id} ${team} spawn ${index} sits under a deck`);
                    }
                }
            }
        }
    }
});

test('a straight ball lane runs net-to-back-wall unobstructed at every height, and the drop zone is clear', () => {
    for (const id of LAYOUT_MAPS) {
        const config = MAPS[id];
        const halfW = config.courtWidth / 2;
        const arena = build(id);
        // Every collider blocks its x-span for the whole court length, regardless of height.
        const blocked = arena.collidables
            .map(c => [spanX(c)[0] - BALL_RADIUS, spanX(c)[1] + BALL_RADIUS])
            .sort((a, b) => a[0] - b[0]);
        let cursor = -halfW + 2;
        let widest = 0;
        for (const [start, end] of blocked) {
            widest = Math.max(widest, start - cursor);
            cursor = Math.max(cursor, end);
        }
        widest = Math.max(widest, halfW - 2 - cursor);
        assert.ok(widest >= 6, `${id} keeps a full-length lane at least 6 wide (widest ${widest.toFixed(2)})`);
        for (const c of arena.collidables) {
            assert.ok(footprintDistance(c, 0, 0) > BALL_RADIUS + 5, `${id} centre ball drop stays clear`);
        }
    }
});

test('solid props block the ball from floor to their visual top (no passing through)', () => {
    for (const id of ['pillar', 'volcano']) {
        const layout = getGameplayLayout(id);
        const arena = build(id);
        for (const col of layout.columns) {
            const stack = arena.collidables.filter(c => c.pos.x === col.x && c.pos.z === col.z);
            assert.ok(stack.length >= 1);
            assert.ok(stack.every(c => c.radius === col.radius), `${id} collider radius matches the mesh`);
            for (let y = BALL_RADIUS; y <= col.height; y += 0.25) {
                assert.ok(stack.some(c => ballBlockedAt(c, y)), `${id} column (${col.x}, ${col.z}) leaks the ball at y=${y}`);
            }
            assert.ok(stack.some(playerBlocksOnGround), `${id} column stops players`);
            assert.ok(stack.some(botBlocksOnGround), `${id} column stops bots`);
        }
    }
});

test('lane rails stop walkers but a lobbed ball clears them; rails never block sightlines', () => {
    const layout = getGameplayLayout('circuit_dome');
    const arena = build('circuit_dome');
    assert.equal(layout.rails.length, 4);
    for (const rail of layout.rails) {
        assert.ok(rail.height < PLAYER.height, 'rail stays below eye height');
        const circles = arena.collidables
            .filter(c => c.pos.x === rail.x && Math.abs(c.pos.z - rail.z) <= rail.halfLength + 1e-9)
            .sort((a, b) => a.pos.z - b.pos.z);
        assert.ok(circles.length >= 2);
        assert.ok(Math.abs(circles[0].pos.z - (rail.z - rail.halfLength)) < 1e-9, 'rail starts at its end');
        assert.ok(Math.abs(circles.at(-1).pos.z - (rail.z + rail.halfLength)) < 1e-9, 'rail reaches its end');
        for (let i = 1; i < circles.length; i++) {
            const gap = circles[i].pos.z - circles[i - 1].pos.z - 2 * rail.radius;
            assert.ok(gap < 2 * BALL_RADIUS && gap < 2 * BOT_RADIUS, 'no slot a ball, bot or player fits through');
        }
        const c = circles[0];
        assert.ok(playerBlocksOnGround(c), 'grounded players are stopped');
        assert.ok(botBlocksOnGround(c), 'bots are stopped');
        assert.ok(ballBlockedAt(c, 1.5), 'a flat low shot is deflected');
        const clearance = c.pos.y + c.radius + BALL_RADIUS + PROP_COLLIDER_SLACK;
        assert.ok(!ballBlockedAt(c, clearance + 0.01), 'a lobbed ball clears the rail');
        assert.ok(clearance < 3.5, 'the lob height is reachable from a normal throw');
    }
    // Rails run parallel to the throw axis and leave the net gap and back court open.
    const spawnZ = MAPS.circuit_dome.courtLength / 3;
    for (const rail of layout.rails) {
        assert.ok(Math.abs(rail.z) - rail.halfLength >= 4, 'net gap lets players change lanes');
        assert.ok(Math.abs(rail.z) + rail.halfLength <= spawnZ - 4, 'back court stays open');
    }
});

test('gantry decks are a double-jump tier with walkable space beneath', () => {
    const layout = getGameplayLayout('mecha');
    const arena = build('mecha');
    const singleJump = PLAYER.jumpForce ** 2 / (2 * PLAYER.gravity);
    const halfL = MAPS.mecha.courtLength / 2;
    assert.equal(arena.platforms.length, 4);
    for (const deck of layout.decks) {
        assert.ok(deck.y > singleJump, 'a single jump does not reach the deck');
        assert.ok(deck.y < singleJump * 2 - 0.3, 'a double jump reaches the deck with margin');
        assert.ok(deck.y - 0.35 > PLAYER.height + 0.2, 'players and bots fit under the slab');
        assert.ok(Math.abs(deck.z) - deck.halfDepth > halfL / 2, 'decks sit in the back of each half');
    }
    // Only the legs collide; they are thin and ground-level.
    const legs = arena.collidables;
    assert.equal(legs.length, 16);
    for (const leg of legs) {
        assert.ok(leg.radius <= 0.5 && leg.pos.y === 0);
        assert.ok(playerBlocksOnGround(leg) && botBlocksOnGround(leg));
        assert.ok(!(Math.abs(layout.decks[0].y + PLAYER.height - leg.pos.y) < leg.radius + PLAYER.radius + PROP_COLLIDER_SLACK),
            'a player standing on the deck is not snagged by its legs');
    }
});

test('map-art pass cover is solid to its exact visual top, standable when reachable, and stops walkers', () => {
    for (const id of ART_PASS_MAPS) {
        const layout = getGameplayLayout(id);
        const arena = build(id);
        const blocks = layout.blocks || [];
        const lowColumns = (layout.columns || []).filter(col => col.lowCover);
        assert.ok(blocks.length + lowColumns.length >= 4, `${id} has low cover`);
        for (const block of blocks) {
            const expected = blockCollider(block);
            const match = arena.collidables.filter(c => isBox(c) && c.minX === expected.minX && c.maxZ === expected.maxZ);
            assert.equal(match.length, 1, `${id} block (${block.x}, ${block.z}) has exactly one solid box`);
            const [c] = match;
            for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) assert.equal(c[k], expected[k], `${id} box ${k} matches the mesh`);
            assert.equal(c.minY, 0);
            assert.equal(c.maxY, block.height, `${id} box top is the visual top`);
            assert.equal(c.top, block.height);
            assert.ok(c.pos && Number.isFinite(c.radius), 'legacy pos/radius kept for rocket splash checks');
            const top = arena.platforms.filter(p => p.solid && p.x === block.x && p.z === block.z && p.y === block.height);
            assert.equal(top.length, block.height <= SOLID_TOP_STANDABLE_MAX ? 1 : 0, `${id} block top is standable`);
            if (top.length) assert.deepEqual([top[0].halfWidth, top[0].halfDepth], [block.halfWidth, block.halfDepth]);
        }
        for (const col of lowColumns) {
            const stack = arena.collidables.filter(c => c.pos.x === col.x && c.pos.z === col.z && c.radius === col.radius);
            assert.ok(stack.length >= 1);
            assert.ok(stack.every(c => c.top === col.height && c.bottom === 0), `${id} column carries its exact top`);
            assert.ok(stack.some(botBlocksOnGround), `${id} low cover stops bots`);
            assert.ok(arena.platforms.some(p => p.solid && p.radius === col.radius && p.x === col.x && p.z === col.z && p.y === col.height),
                `${id} low column top is standable`);
        }
    }
    assert.equal(lowCoverCenterY(1, 5) + 1 + LOW_COVER_BALL_RADIUS + PROP_COLLIDER_SLACK, 5);
});

test('map-art pass full-height columns block the ball from floor to their visual top', () => {
    for (const id of ART_PASS_MAPS) {
        const arena = build(id);
        for (const col of (getGameplayLayout(id).columns || []).filter(entry => !entry.lowCover)) {
            const stack = arena.collidables.filter(c => c.pos.x === col.x && c.pos.z === col.z);
            assert.ok(stack.every(c => c.radius === col.radius), `${id} collider radius matches the mesh`);
            for (let y = BALL_RADIUS; y <= col.height; y += 0.25) {
                assert.ok(stack.some(c => ballBlockedAt(c, y)), `${id} column (${col.x}, ${col.z}) leaks the ball at y=${y}`);
            }
            assert.ok(stack.some(playerBlocksOnGround) && stack.some(botBlocksOnGround), `${id} column stops walkers`);
        }
    }
});

// Rotated half-extents of a unit part (box/cylinder/cone/sphere all fit the
// unit cube) scaled by s and rotated by Euler XYZ r.
function partHalfExtents(r, s) {
    const hx = s.x / 2, hy = s.y / 2, hz = s.z / 2;
    const [cx, sx] = [Math.cos(r.x), Math.sin(r.x)];
    const [cy, sy] = [Math.cos(r.y), Math.sin(r.y)];
    const [cz, sz] = [Math.cos(r.z), Math.sin(r.z)];
    // Rotation matrix R = Rx * Ry * Rz (three.js 'XYZ').
    const m = [
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy]
    ];
    return m.map(row => Math.abs(row[0]) * hx + Math.abs(row[1]) * hy + Math.abs(row[2]) * hz);
}

test('landmark cover is honest: every visual part sits inside its collider and at or under its top', () => {
    const bad = [];
    for (const id of LANDMARK_MAPS) {
        const arena = build(id);
        const solids = arena.collidables.filter(c => Number.isFinite(c.top));
        const parts = arena.objects.filter(o => o instanceof InstancedMesh)
            .flatMap(o => o.parts.map(part => ({ ...part, kind: o.geometry.kind, radial: o.geometry.kind !== 'BoxGeometry' })));
        assert.ok(parts.length > 40, `${id} dresses its cover with instanced parts (${parts.length})`);
        assert.ok(arena.objects.length <= 12, `${id} layout visuals stay a handful of draw calls (${arena.objects.length})`);
        for (const part of parts) {
            let [ex, ey, ez] = partHalfExtents(part.r, part.s);
            // Round parts spun only about y keep their radius in x/z.
            if (part.radial && !part.r.x && !part.r.z && part.s.x === part.s.z) ex = ez = part.s.x / 2;
            const owner = solids.find(c => (isBox(c)
                ? part.p.x >= c.minX && part.p.x <= c.maxX && part.p.z >= c.minZ && part.p.z <= c.maxZ
                : Math.hypot(part.p.x - c.pos.x, part.p.z - c.pos.z) <= c.radius));
            assert.ok(owner, `${id} part at (${part.p.x.toFixed(2)}, ${part.p.z.toFixed(2)}) belongs to a collider`);
            const slack = 0.06;
            const where = `${id} ${part.kind} (${part.p.x.toFixed(2)}, ${part.p.y.toFixed(2)}, ${part.p.z.toFixed(2)})`;
            if (part.p.y + ey > owner.top + slack) bad.push(`${where} top ${(part.p.y + ey).toFixed(2)} > ${owner.top}`);
            const out = isBox(owner)
                ? !(part.p.x - ex >= owner.minX - slack && part.p.x + ex <= owner.maxX + slack
                    && part.p.z - ez >= owner.minZ - slack && part.p.z + ez <= owner.maxZ + slack)
                : Math.max(Math.abs(part.p.x - owner.pos.x) + ex, Math.abs(part.p.z - owner.pos.z) + ez) > owner.radius + slack;
            if (out) bad.push(`${where} pokes outside its collider`);
        }
    }
    assert.deepEqual(bad, [], 'layout visuals match their colliders');
});
