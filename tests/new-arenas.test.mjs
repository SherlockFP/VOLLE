// new-arenas.test.mjs — pins the four V5 arenas (aquarium, museum, casino, subway):
// config shape, size bounds, map-picker visibility, mirror-balanced cover, and a
// headless run of each builder against a hand-written THREE stand-in (same
// source-rewrite technique as tests/arena-config.test.mjs / tests/map-mechanics.test.mjs,
// extended so the builder bodies can actually execute without a WebGL runtime).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatMapSize } from '../js/map-display.js';

// --- minimal THREE stand-in: only the surface the four builders touch ---------
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    clone() { return new Vec3(this.x, this.y, this.z); }
    setScalar(s) { return this.set(s, s, s); }
    fromArray(a) { return this.set(a[0], a[1], a[2]); }
}

class Object3D {
    constructor() {
        this.children = [];
        this.parent = null;
        this.userData = {};
        this.visible = true;
        this.castShadow = false;
        this.receiveShadow = false;
        this.position = new Vec3();
        this.rotation = new Vec3();
        this.scale = new Vec3(1, 1, 1);
    }
    add(...kids) { for (const kid of kids) { kid.parent = this; this.children.push(kid); } return this; }
    traverse(cb) { cb(this); for (const kid of this.children) kid.traverse(cb); }
}

class Geometry {
    constructor(...args) { this.args = args; this.attributes = {}; }
    setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
    dispose() {}
}
class Material {
    constructor(options = {}) { Object.assign(this, options); }
    dispose() {}
}
class Mesh extends Object3D {
    constructor(geometry, material) {
        super();
        assert.ok(geometry, 'mesh built with a geometry');
        assert.ok(material, 'mesh built with a material');
        this.geometry = geometry;
        this.material = material;
    }
}

const GEOMETRIES = [
    'BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'ConeGeometry', 'TorusGeometry',
    'PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'OctahedronGeometry',
    'DodecahedronGeometry', 'BufferGeometry', 'TorusKnotGeometry'
];
const MATERIALS = [
    'MeshBasicMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial',
    'PointsMaterial', 'LineBasicMaterial', 'ShaderMaterial'
];

const THREE_STUB = {
    Vector3: Vec3,
    Color: class { constructor(hex) { this.hex = hex; } set(hex) { this.hex = hex; return this; } },
    Object3D, Group: class extends Object3D {}, Mesh,
    Points: class extends Object3D {
        constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
    },
    Float32BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    FrontSide: 0, BackSide: 1, DoubleSide: 2
};
for (const name of GEOMETRIES) THREE_STUB[name] = class extends Geometry {};
for (const name of MATERIALS) THREE_STUB[name] = class extends Material {};
globalThis.__ARENA_THREE_STUB__ = THREE_STUB;

// --- load js/arena.js with its imports swapped for stubs ----------------------
const arenaSource = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
const moduleSource = arenaSource
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, 'const THREE = globalThis.__ARENA_THREE_STUB__;\n')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');
assert.equal(moduleSource.includes("from 'three'"), false, 'THREE import replaced by the stub');

const { MAPS, MAP_THEMES, Arena, getArenaBounds } = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

const NEW_MAPS = Object.freeze({
    aquarium: { flag: 'isAquarium', builder: 'buildAquariumProps' },
    museum: { flag: 'isMuseum', builder: 'buildMuseumProps' },
    casino: { flag: 'isCasino', builder: 'buildCasinoProps' },
    subway: { flag: 'isSubway', builder: 'buildSubwayProps' }
});
const NEW_MAP_IDS = Object.keys(NEW_MAPS);

const REQUIRED_FIELDS = [
    'name', 'courtWidth', 'courtLength', 'wallHeight', 'ceilingHeight',
    'floorRed', 'floorBlue', 'wallColor', 'skyTop', 'skyBottom', 'fogColor',
    'size', 'weather'
];

// Mirrors js/game.js getSelectableMaps() / pickRandomMap(): the lobby carousel is
// driven straight off MAPS minus hiddenFromRotation, so registering there IS the
// picker registration.
const selectableMaps = () => Object.keys(MAPS).filter(id => !MAPS[id]?.hiddenFromRotation);

test('the four new arenas exist with every required config field populated', () => {
    for (const id of NEW_MAP_IDS) {
        const config = MAPS[id];
        assert.ok(config, `MAPS.${id} exists`);
        for (const field of REQUIRED_FIELDS) {
            assert.notEqual(config[field], undefined, `MAPS.${id}.${field} is set`);
        }
        assert.equal(typeof config.name, 'string');
        assert.ok(config.name.trim().length > 0, `${id} has a display name`);
        assert.equal(config[NEW_MAPS[id].flag], true, `${id} sets ${NEW_MAPS[id].flag}`);
        assert.equal(typeof Arena.prototype[NEW_MAPS[id].builder], 'function', `${id} builder exists`);
    }
});

test('new arena dimensions sit at the large end of the range and stay sane', () => {
    for (const id of NEW_MAP_IDS) {
        const config = MAPS[id];
        assert.ok(config.courtWidth >= 115 && config.courtWidth <= 180, `${id} courtWidth ${config.courtWidth}`);
        assert.ok(config.courtLength >= 125 && config.courtLength <= 200, `${id} courtLength ${config.courtLength}`);
        assert.ok(config.wallHeight >= 15 && config.wallHeight <= 40, `${id} wallHeight`);
        assert.ok(config.ceilingHeight > config.wallHeight, `${id} ceiling clears the wall`);
        assert.equal(formatMapSize(config), config.size, `${id} declared size matches its width bucket`);
        const bounds = getArenaBounds(config);
        assert.equal(bounds.maxX, config.courtWidth / 2);
        assert.equal(bounds.maxY, config.ceilingHeight);
    }
});

test('new arenas are visible to the lobby map picker and carry a UI theme', () => {
    const selectable = selectableMaps();
    for (const id of NEW_MAP_IDS) {
        assert.ok(!MAPS[id].hiddenFromRotation, `${id} is not hidden from rotation`);
        assert.ok(selectable.includes(id), `${id} shows up in the carousel/random-map list`);
        const theme = MAP_THEMES[id];
        assert.ok(theme, `${id} has a MAP_THEMES entry`);
        for (const key of ['--ui-primary', '--ui-secondary', '--ui-bg', '--ui-accent']) {
            assert.match(theme[key], /^#[0-9a-f]{6}$/i, `${id} theme ${key}`);
        }
    }
});

test('new arena identity flags are unique to their own map', () => {
    for (const [id, { flag }] of Object.entries(NEW_MAPS)) {
        for (const [otherId, otherConfig] of Object.entries(MAPS)) {
            if (otherId === id) continue;
            assert.ok(!otherConfig[flag], `${otherId} must not set ${flag}`);
        }
    }
});

test('new arenas expose symmetric gameplay + spectator + sky metadata', () => {
    for (const id of NEW_MAP_IDS) {
        const config = MAPS[id];
        assert.ok(config.gameplay.mechanics.length > 0, `${id} lists mechanics`);
        assert.equal(config.gameplay.symmetric, true, `${id} is declared symmetric`);
        assert.ok(Number.isFinite(config.gameplay.fallDeathY));
        assert.ok(config.gameplay.playerSpawnZ > 0 && config.gameplay.playerSpawnZ < config.courtLength / 2,
            `${id} spawn Z sits inside the court`);
        assert.ok(config.spectator.bounds, `${id} spectator bounds`);
        assert.ok(Array.isArray(config.spectator.stands) && config.spectator.stands.length > 0);
        assert.ok(config.sky, `${id} sky metadata`);
        assert.equal(JSON.stringify(config).includes('http'), false, `${id} pulls no remote asset`);
    }
});

test('team spawns stay mirrored on every new arena', () => {
    for (const id of NEW_MAP_IDS) {
        const config = MAPS[id];
        const arena = { config, courtLength: config.courtLength };
        const red = Arena.prototype.getPlayerSpawn.call(arena, 'red', 0);
        const blue = Arena.prototype.getPlayerSpawn.call(arena, 'blue', 0);
        assert.equal(red.x, 0);
        assert.equal(blue.x, 0);
        assert.equal(red.z, -blue.z);
        assert.ok(Math.abs(red.z) < config.courtLength / 2);
    }
});

// --- headless builder run -----------------------------------------------------
function runBuilder(id) {
    const config = MAPS[id];
    const arena = {
        config,
        mapId: id,
        courtWidth: config.courtWidth,
        courtLength: config.courtLength,
        wallHeight: config.wallHeight,
        ceilingHeight: config.ceilingHeight,
        renderer: { createToonMaterial: () => new THREE_STUB.MeshStandardMaterial({}) },
        scene: { add() {} },
        objects: [],
        collidables: [],
        platforms: [],
        add: Arena.prototype.add,
        addCollidable: Arena.prototype.addCollidable,
        _placeMesh: Arena.prototype._placeMesh,
        _animateProp: Arena.prototype._animateProp,
        _buildMuseumSkeleton: Arena.prototype._buildMuseumSkeleton,
        updateAmbientParticles: Arena.prototype.updateAmbientParticles
    };
    Arena.prototype[NEW_MAPS[id].builder].call(arena);
    return arena;
}

test('every new arena builder runs headlessly and fills the map with content', () => {
    for (const id of NEW_MAP_IDS) {
        const arena = runBuilder(id);
        assert.ok(arena.objects.length > 100, `${id} builds ${arena.objects.length} objects (expected > 100)`);
        assert.ok(arena.objects.length < 700, `${id} stays under the draw-call budget (${arena.objects.length})`);
        assert.ok(arena.collidables.length >= 4, `${id} registers ball/player cover`);
        for (const collidable of arena.collidables) {
            assert.ok(Number.isFinite(collidable.pos.x) && Number.isFinite(collidable.pos.z), `${id} finite collidable`);
            assert.ok(collidable.radius > 0, `${id} positive collision radius`);
        }
    }
});

test('cover geometry is mirror-balanced across both axes on every new arena', () => {
    const key = (x, z) => `${x.toFixed(3)}|${z.toFixed(3)}`;
    for (const id of NEW_MAP_IDS) {
        const arena = runBuilder(id);
        const spots = new Set(arena.collidables.map(c => key(c.pos.x, c.pos.z)));
        for (const c of arena.collidables) {
            assert.ok(spots.has(key(-c.pos.x, c.pos.z)),
                `${id} cover at (${c.pos.x}, ${c.pos.z}) has no X mirror`);
            assert.ok(spots.has(key(c.pos.x, -c.pos.z)),
                `${id} cover at (${c.pos.x}, ${c.pos.z}) has no Z mirror`);
        }
    }
});

test('subway mezzanines register standable platforms, mirrored', () => {
    const arena = runBuilder('subway');
    assert.equal(arena.platforms.length, 4);
    const key = (x, z) => `${x.toFixed(3)}|${z.toFixed(3)}`;
    const spots = new Set(arena.platforms.map(p => key(p.x, p.z)));
    for (const platform of arena.platforms) {
        assert.ok(platform.y > 1 && platform.y < MAPS.subway.ceilingHeight, 'platform height is reachable');
        assert.ok(platform.halfWidth > 0 && platform.halfDepth > 0);
        assert.ok(spots.has(key(-platform.x, platform.z)), 'platform X mirror');
        assert.ok(spots.has(key(platform.x, -platform.z)), 'platform Z mirror');
    }
});

test('animated map props update in place without allocating or drifting to NaN', () => {
    for (const id of NEW_MAP_IDS) {
        const arena = runBuilder(id);
        if (!arena._mapAnimators) continue;
        assert.ok(arena._mapAnimators.length > 0, `${id} registers animated props`);
        const before = arena._mapAnimators.length;
        const objectsBefore = arena.objects.length;
        for (const step of [0, 0.5, 3.25, 61]) {
            Arena.prototype.update.call(arena, step, 1 / 60);
        }
        assert.equal(arena._mapAnimators.length, before, `${id} animator list is stable`);
        assert.equal(arena.objects.length, objectsBefore, `${id} update() adds no objects`);
        for (const animator of arena._mapAnimators) {
            const { position, rotation } = animator.object;
            assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z),
                `${id} animated position stays finite`);
            assert.ok(Number.isFinite(rotation.y) && Number.isFinite(rotation.z),
                `${id} animated rotation stays finite`);
        }
    }
});

test('aquarium keeps its underwater identity distinct from atlantis', () => {
    assert.equal(MAPS.aquarium.hasGlass, true);
    assert.equal(MAPS.aquarium.weather, 'indoor');
    assert.ok(!MAPS.aquarium.isAtlantis);
    assert.ok(!MAPS.atlantis.isAquarium);
    assert.ok(MAPS.aquarium.gameplay.mechanics.includes('glass-tunnel'));
    const arena = runBuilder('aquarium');
    // Fish schools / mantas / jellies all live past the glass tunnel radius.
    const tunnelRadius = MAPS.aquarium.courtWidth / 2 + 8;
    const swimmers = arena._mapAnimators.filter(a => a.kind === 'orbit');
    assert.ok(swimmers.length >= 4, 'mantas + whale shark orbit the tunnel');
    for (const swimmer of swimmers) {
        assert.ok(swimmer.radius > tunnelRadius, 'swimmers stay outside the glass');
    }
});
