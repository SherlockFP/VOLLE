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
const THREE_STUB = { Vector3: Vec3, Mesh, DoubleSide: 2 };
for (const name of ['BoxGeometry', 'CylinderGeometry', 'TorusGeometry', 'CircleGeometry', 'PlaneGeometry', 'DodecahedronGeometry']) {
    THREE_STUB[name] = class { constructor(...args) { this.args = args; } };
}
THREE_STUB.MeshBasicMaterial = class { constructor(options = {}) { Object.assign(this, options); } };
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
    LOW_COVER_BALL_RADIUS, lowCoverCenterY, blockColliderCircles
} = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

// Entity sizes the collider checks run against (js/ball.js, js/player.js, js/bot.js).
const BALL_RADIUS = 0.47;
const PLAYER = { radius: 0.7, height: 1.7, jumpForce: 8, gravity: 20 };
const BOT_RADIUS = 0.5;
const MAX_TEAM_SPAWNS = 8;

const FLAGSHIP_MAPS = ['pillar', 'circuit_dome', 'volcano', 'mecha'];
const ART_PASS_MAPS = ['neon_rooftop', 'sunken_temple', 'orbital_station'];
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
        _buildArtColumn: Arena.prototype._buildArtColumn,
        _buildLayoutBlock: Arena.prototype._buildLayoutBlock
    };
    Arena.prototype.buildGameplayLayout.call(arena);
    return arena;
}

// Same vertical test ball.js / player.js / bot.js use for {pos, radius} colliders.
const ballBlockedAt = (c, y) => Math.abs(y - c.pos.y) < c.radius + BALL_RADIUS + PROP_COLLIDER_SLACK;
const playerBlocksOnGround = c => Math.abs(PLAYER.height - c.pos.y) < c.radius + PLAYER.radius + PROP_COLLIDER_SLACK;
const botBlocksOnGround = c => Math.abs(1.7 - c.pos.y) < c.radius + BOT_RADIUS + PROP_COLLIDER_SLACK;
const key = (...values) => values.map(v => (Object.is(v, -0) ? 0 : v).toFixed(3)).join('|');

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
            assert.ok(c.pos.x - c.radius > bounds.minX + 2 && c.pos.x + c.radius < bounds.maxX - 2, `${id} collider inside X`);
            assert.ok(c.pos.z - c.radius > bounds.minZ + 2 && c.pos.z + c.radius < bounds.maxZ - 2, `${id} collider inside Z`);
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
                        const distance = Math.hypot(x - c.pos.x, spawn.z - c.pos.z);
                        assert.ok(distance > c.radius + PLAYER.radius + 1.5,
                            `${id} ${team} spawn ${index} (${x}, ${spawn.z}) is ${distance.toFixed(2)} from a prop`);
                    }
                    for (const p of arena.platforms) {
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
            .map(c => [c.pos.x - c.radius - BALL_RADIUS, c.pos.x + c.radius + BALL_RADIUS])
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
            assert.ok(Math.hypot(c.pos.x, c.pos.z) > c.radius + BALL_RADIUS + 5, `${id} centre ball drop stays clear`);
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

test('map-art pass low cover blocks the ball exactly to its visual top and still stops walkers', () => {
    for (const id of ART_PASS_MAPS) {
        const layout = getGameplayLayout(id);
        const arena = build(id);
        const lowProps = [
            ...(layout.blocks || []).map(block => ({ height: block.height, circles: blockColliderCircles(block) })),
            ...(layout.columns || []).filter(col => col.lowCover)
                .map(col => ({ height: col.height, circles: [{ x: col.x, z: col.z, radius: col.radius }] }))
        ];
        assert.ok(lowProps.length >= 4, `${id} has low cover`);
        for (const prop of lowProps) {
            assert.ok(prop.height >= 2, `${id} low cover is at least 2 m (bots collide below that)`);
            for (const circle of prop.circles) {
                const stack = arena.collidables.filter(c => c.pos.x === circle.x && c.pos.z === circle.z && c.radius === circle.radius);
                assert.ok(stack.length >= 1, `${id} circle (${circle.x}, ${circle.z}) has a collider`);
                for (let y = LOW_COVER_BALL_RADIUS; y <= prop.height; y += 0.1) {
                    assert.ok(stack.some(c => ballBlockedAt(c, y)), `${id} low cover leaks the ball at y=${y.toFixed(2)}`);
                }
                assert.ok(!stack.some(c => ballBlockedAt(c, prop.height + 0.05)), `${id} low cover has no invisible wall above it`);
                assert.ok(stack.some(playerBlocksOnGround), `${id} low cover stops grounded players`);
                assert.ok(stack.some(botBlocksOnGround), `${id} low cover stops bots`);
            }
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

test('block colliders tile the footprint along the long axis with no slot to slip through', () => {
    for (const id of ART_PASS_MAPS) {
        for (const block of getGameplayLayout(id).blocks || []) {
            const circles = blockColliderCircles(block);
            const alongX = block.halfWidth >= block.halfDepth;
            const long = alongX ? block.halfWidth : block.halfDepth;
            const radius = alongX ? block.halfDepth : block.halfWidth;
            const axis = c => (alongX ? c.x - block.x : c.z - block.z);
            assert.ok(circles.every(c => c.radius === radius), `${id} circles use the short half-extent`);
            assert.ok(Math.abs(axis(circles[0]) + (long - radius)) < 1e-9, `${id} block starts at its end`);
            assert.ok(Math.abs(axis(circles.at(-1)) - (long - radius)) < 1e-9, `${id} block reaches its end`);
            for (let i = 1; i < circles.length; i++) {
                const gap = axis(circles[i]) - axis(circles[i - 1]) - 2 * radius;
                assert.ok(gap < 2 * BALL_RADIUS && gap < 2 * BOT_RADIUS, `${id} block has no slot`);
            }
        }
    }
});
