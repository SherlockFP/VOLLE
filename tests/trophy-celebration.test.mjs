import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Same stubbing trick as tests/arena-decor.test.mjs: only the pure,
// framework-free trophy-celebration exports are exercised here (the actual
// clone/scene/animation wiring lives in js/game.js and needs a THREE/WebGL
// runtime to exercise for real — out of scope for a unit test).
const decorPath = new URL('../js/arena-decor.js', import.meta.url);
const decorSource = await readFile(decorPath, 'utf8');
const decorModuleSource = decorSource
    .replace(/^import \* as THREE from 'three';$/m, `
    const THREE = { Box3: class {}, Vector3: class {}, Group: class {}, PointLight: class {} };
    `)
    .replace(/^import \{ GLTFLoader \} from 'three\/addons\/loaders\/GLTFLoader\.js';$/m, 'class GLTFLoader {}')
    .replace(/^import \{ MeshoptDecoder \} from 'three\/addons\/libs\/meshopt_decoder\.module\.js';$/m, 'const MeshoptDecoder = {};');

const {
    shouldSpawnMatchTrophy,
    resolveTrophySpot,
    trophyTeardownPlan,
    FFA_TROPHY_SPOT
} = await import(`data:text/javascript;base64,${Buffer.from(decorModuleSource).toString('base64')}`);

// --- shouldSpawnMatchTrophy: spawn karari -----------------------------------

test('shouldSpawnMatchTrophy spawns only on match end, with a winner, with a loaded template', () => {
    assert.equal(shouldSpawnMatchTrophy({ isMatchEnd: true, hasWinner: true, hasTemplate: true }), true);
});

test('shouldSpawnMatchTrophy is a no-op on round end (mac sonu hayir)', () => {
    assert.equal(shouldSpawnMatchTrophy({ isMatchEnd: false, hasWinner: true, hasTemplate: true }), false);
});

test('shouldSpawnMatchTrophy is a no-op on a draw (no winner)', () => {
    assert.equal(shouldSpawnMatchTrophy({ isMatchEnd: true, hasWinner: false, hasTemplate: true }), false);
});

test('shouldSpawnMatchTrophy is a silent no-op when the trophy template has not loaded', () => {
    assert.equal(shouldSpawnMatchTrophy({ isMatchEnd: true, hasWinner: true, hasTemplate: false }), false);
});

test('shouldSpawnMatchTrophy tolerates undefined/falsy inputs without throwing', () => {
    assert.equal(shouldSpawnMatchTrophy({}), false);
});

// --- resolveTrophySpot -------------------------------------------------------

test('resolveTrophySpot returns the side-blind neutral point in FFA regardless of any team spawn', () => {
    const spot = resolveTrophySpot({ ffa: true, teamSpawn: { x: 12, y: 1.7, z: -30 } });
    assert.deepEqual(spot, FFA_TROPHY_SPOT);
});

test('resolveTrophySpot grounds the winning team spawn (y forced to 0) in team mode', () => {
    const spot = resolveTrophySpot({ ffa: false, teamSpawn: { x: 3, y: 1.7, z: -40 } });
    assert.deepEqual(spot, { x: 3, y: 0, z: -40 });
});

test('resolveTrophySpot returns null (never guesses) when team mode has no resolvable spawn', () => {
    assert.equal(resolveTrophySpot({ ffa: false, teamSpawn: null }), null);
});

// --- trophyTeardownPlan: teardown sozlesmesi ---------------------------------

test('trophyTeardownPlan always removes the clone from the scene', () => {
    assert.equal(trophyTeardownPlan({ materialCloned: false }).removeFromScene, true);
    assert.equal(trophyTeardownPlan({ materialCloned: true }).removeFromScene, true);
});

test('trophyTeardownPlan never disposes geometry — it is always shared with the template', () => {
    assert.equal(trophyTeardownPlan({ materialCloned: false }).disposeGeometry, false);
    assert.equal(trophyTeardownPlan({ materialCloned: true }).disposeGeometry, false);
});

test('trophyTeardownPlan disposes material only when the caller actually cloned it', () => {
    assert.equal(trophyTeardownPlan({ materialCloned: false }).disposeMaterial, false);
    assert.equal(trophyTeardownPlan({ materialCloned: true }).disposeMaterial, true);
});
