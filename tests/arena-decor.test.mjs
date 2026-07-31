import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// arena-decor.js's THREE-dependent functions (normalizeAndGround, loadArenaDecor,
// preloadTrophyTemplate) are never called below — only the pure, framework-free
// exports are exercised — so lightweight stubs are enough to satisfy module load,
// same pattern as tests/social-lobby.test.mjs and tests/arena-config.test.mjs.
const decorPath = new URL('../js/arena-decor.js', import.meta.url);
const decorSource = await readFile(decorPath, 'utf8');
const decorModuleSource = decorSource
    .replace(/^import \* as THREE from 'three';$/m, `
    const THREE = { Box3: class {}, Vector3: class {}, Group: class {}, PointLight: class {} };
    `)
    .replace(/^import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader\.js';$/m, 'class GLTFLoader {}')
    .replace(/^import \{ MeshoptDecoder \} from 'three\/addons\/libs\/meshopt_decoder\.module\.js';$/m, 'const MeshoptDecoder = {};');

const {
    DECOR_ASSETS,
    resolveDecorKinds,
    computeNormalizeScale,
    computeGroundOffset,
    computeDecorPlacements,
    disposeArenaDecor
} = await import(`data:text/javascript;base64,${Buffer.from(decorModuleSource).toString('base64')}`);

test('DECOR_ASSETS ships a url and a positive targetHeight for every known kind', () => {
    const kinds = ['bleachers', 'seats', 'scoreboard', 'lights', 'gym', 'trophy'];
    for (const kind of kinds) {
        assert.ok(DECOR_ASSETS[kind], `${kind} entry exists`);
        assert.ok(DECOR_ASSETS[kind].url.startsWith('assets/cc-by/sketchfab/'), `${kind} url points at the downloaded pack`);
        assert.ok(DECOR_ASSETS[kind].url.endsWith('.glb'), `${kind} url is a .glb`);
        assert.ok(Number.isFinite(DECOR_ASSETS[kind].targetHeight) && DECOR_ASSETS[kind].targetHeight > 0, `${kind} has a positive targetHeight`);
    }
});

test('resolveDecorKinds filters unknown keys, dedups, and rejects non-arrays', () => {
    assert.deepEqual(resolveDecorKinds(['bleachers', 'lights', 'bleachers']), ['bleachers', 'lights']);
    assert.deepEqual(resolveDecorKinds(['bleachers', 'not-a-real-asset', 'scoreboard']), ['bleachers', 'scoreboard']);
    assert.deepEqual(resolveDecorKinds(undefined), []);
    assert.deepEqual(resolveDecorKinds(null), []);
    assert.deepEqual(resolveDecorKinds('bleachers'), []);
    assert.deepEqual(resolveDecorKinds([]), []);
});

test('computeNormalizeScale maps arbitrary source units onto the target height', () => {
    // A model whose raw bbox is 100 units tall, normalized to a 4-unit-tall bleacher.
    assert.equal(computeNormalizeScale(100, 4), 0.04);
    // A tiny 0.5-unit model normalized up to an 8-unit light pole.
    assert.equal(computeNormalizeScale(0.5, 8), 16);
    // Degenerate bbox (flat/zero height) or missing target — scale falls back to 1,
    // never divides by zero or returns Infinity/NaN.
    assert.equal(computeNormalizeScale(0, 4), 1);
    assert.equal(computeNormalizeScale(-3, 4), 1);
    assert.equal(computeNormalizeScale(10, 0), 1);
    assert.equal(computeNormalizeScale(10, undefined), 1);
});

test('computeGroundOffset plants the scaled bbox minimum at world Y=0', () => {
    // Raw bbox min.y = -2.45 (model straddles its own origin), scaled 2x -> offset +4.9
    // moves the lowest scaled vertex exactly to 0.
    assert.equal(computeGroundOffset(-2.45, 2), 4.9);
    assert.ok(Math.abs(computeGroundOffset(-2.45, 2) + -2.45 * 2) < 1e-9);
    // A model already resting on y=0 needs no offset.
    assert.equal(computeGroundOffset(0, 3), -0);
    // A model whose lowest point is above the origin gets pulled down.
    assert.equal(computeGroundOffset(5, 1), -5);
});

test('computeDecorPlacements aligns bleachers/seats to the configured spectator stands', () => {
    const mapDef = {
        courtWidth: 100, courtLength: 70, wallHeight: 20, ceilingHeight: 28,
        spectator: {
            stands: [
                { side: 'west', tiers: 5, depth: 2.4, rise: 1.1, setback: 6 },
                { side: 'east', tiers: 5, depth: 2.4, rise: 1.1, setback: 6 }
            ]
        }
    };
    const placements = computeDecorPlacements(mapDef, mapDef);
    assert.equal(placements.bleachers.length, 2);
    assert.equal(placements.seats.length, 2);
    // West stand sits at negative X, outside the court's half-width + setback + tier depth.
    const west = placements.bleachers.find(p => p.x < 0);
    const east = placements.bleachers.find(p => p.x > 0);
    assert.ok(west && east, 'one stand on each side');
    assert.ok(west.x < -(100 / 2), 'west stand clears the court boundary');
    assert.ok(east.x > 100 / 2, 'east stand clears the court boundary');
    assert.equal(west.z, 0);
    assert.ok(Math.abs(west.rotationY - Math.PI / 2) < 1e-9);
    assert.ok(Math.abs(east.rotationY - -Math.PI / 2) < 1e-9);
});

test('computeDecorPlacements grounds lights/gym and elevates the scoreboard under the ceiling', () => {
    const mapDef = { courtWidth: 90, courtLength: 60, wallHeight: 18, ceilingHeight: 26, spectator: { stands: [] } };
    const placements = computeDecorPlacements(mapDef, mapDef);
    assert.equal(placements.bleachers.length, 0);
    assert.equal(placements.lights.length, 4);
    placements.lights.forEach(p => assert.equal(p.y, 0));
    assert.equal(placements.gym.length, 1);
    assert.equal(placements.gym[0].y, 0);
    assert.equal(placements.scoreboard.length, 1);
    const board = placements.scoreboard[0];
    assert.ok(board.y > 0 && board.y < mapDef.ceilingHeight, 'scoreboard base sits below the ceiling, above the floor');
    assert.equal(board.x, 0);
    assert.equal(board.z, mapDef.courtLength / 2 + 1.5);
});

test('computeDecorPlacements never mutates the map config it reads from', () => {
    const mapDef = Object.freeze({
        courtWidth: 80, courtLength: 60, wallHeight: 16, ceilingHeight: 22,
        spectator: Object.freeze({ stands: Object.freeze([Object.freeze({ side: 'north', tiers: 3, depth: 1.4, rise: 0.65, setback: 3 })]) })
    });
    assert.doesNotThrow(() => computeDecorPlacements(mapDef, mapDef));
});

test('disposeArenaDecor disposes geometry/materials/textures, skips lights, and is null-safe', () => {
    assert.doesNotThrow(() => disposeArenaDecor(null));
    assert.doesNotThrow(() => disposeArenaDecor(undefined));

    const disposed = [];
    const texture = { dispose: () => disposed.push('texture') };
    const material = {
        map: texture,
        dispose: () => disposed.push('material')
    };
    const geometry = { dispose: () => disposed.push('geometry') };
    const mesh = { isMesh: true, geometry, material };
    const light = { isLight: true, dispose: () => disposed.push('light-should-not-dispose') };
    let removedFrom = null;
    const parent = { remove: child => { removedFrom = child; } };
    const group = {
        userData: {},
        parent,
        traverse(fn) { [mesh, light].forEach(fn); }
    };

    disposeArenaDecor(group);

    assert.equal(group.userData.disposed, true);
    assert.equal(removedFrom, group);
    assert.deepEqual(disposed.sort(), ['geometry', 'material', 'texture'].sort());
});

test('disposeArenaDecor handles multi-material meshes and missing geometry/material gracefully', () => {
    const disposed = [];
    const matA = { dispose: () => disposed.push('a') };
    const matB = { dispose: () => disposed.push('b') };
    const bareMesh = { isMesh: true };
    const multiMatMesh = { isMesh: true, material: [matA, matB] };
    const group = {
        userData: {},
        parent: null,
        traverse(fn) { [bareMesh, multiMatMesh].forEach(fn); }
    };
    assert.doesNotThrow(() => disposeArenaDecor(group));
    assert.deepEqual(disposed.sort(), ['a', 'b']);
});

// Cross-checks the real js/arena.js MAPS config against resolveDecorKinds so a typo
// in a map's `decor: [...]` list (the actual config-parse contract between the two
// files) fails loudly instead of silently dropping a decor piece in the browser.
test('every MAPS.decor entry in arena.js resolves to a known DECOR_ASSETS kind', async () => {
    const arenaPath = new URL('../js/arena.js', import.meta.url);
    const arenaSource = await readFile(arenaPath, 'utf8');
    const arenaModuleSource = arenaSource
        .replace(/^import \* as THREE from 'three';?[\r\n]*/m, '')
        .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
        .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
        .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
        .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
        .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');

    const { MAPS } = await import(`data:text/javascript;base64,${Buffer.from(arenaModuleSource).toString('base64')}`);

    const decoratedMaps = Object.entries(MAPS).filter(([, config]) => Array.isArray(config.decor) && config.decor.length);
    assert.ok(decoratedMaps.length >= 3, 'at least 3 maps declare decor');
    for (const [id, config] of decoratedMaps) {
        const resolved = resolveDecorKinds(config.decor);
        assert.deepEqual(resolved, config.decor, `${id}.decor has no unknown/duplicate keys`);
    }
});
