import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.js';
import { compileGameMethod } from './game-source.mjs';

// Game.updateSplitBalls / clearSplitBalls call arena.remove(); Arena used to
// define only add(), so an expiring split ball (_affixSplit, FFA opening
// double) threw every frame and froze updatePlaying.

const arenaSource = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');

function arenaMethod(name) {
    const match = arenaSource.match(new RegExp(`\\n    ${name}\\(obj\\) \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(match, `Arena.${name} exists`);
    return new Function('obj', match[1]);
}

function makeArena() {
    const scene = new THREE.Scene();
    return { scene, objects: [], add: arenaMethod('add'), remove: arenaMethod('remove') };
}

function makeGame(arena) {
    const globals = { THREE, Math };
    return {
        arena,
        network: null,
        _ffa: false,
        lastDeflector: null,
        lastDeflectorTeam: null,
        _splitBalls: [],
        getAllTargets: () => [],
        handleHit() { throw new Error('no targets in this fixture'); },
        _createSplitBallMesh: compileGameMethod('_createSplitBallMesh', globals),
        updateSplitBalls: compileGameMethod('updateSplitBalls', globals),
        clearSplitBalls: compileGameMethod('clearSplitBalls', globals),
        _disposeSplitBall: compileGameMethod('_disposeSplitBall', globals)
    };
}

function trackDisposal(mesh) {
    const disposed = { geometry: 0, material: 0 };
    const geometryDispose = mesh.geometry.dispose.bind(mesh.geometry);
    const materialDispose = mesh.material.dispose.bind(mesh.material);
    mesh.geometry.dispose = () => { disposed.geometry++; geometryDispose(); };
    mesh.material.dispose = () => { disposed.material++; materialDispose(); };
    return disposed;
}

test('an expiring split ball is removed, disposed and spliced without throwing', () => {
    const arena = makeArena();
    const game = makeGame(arena);
    game._createSplitBallMesh(new THREE.Vector3(0, 2, 0), new THREE.Vector3(3, 1, 0), 0.05);
    const { mesh } = game._splitBalls[0];
    const disposed = trackDisposal(mesh);
    assert.equal(mesh.parent, arena.scene);
    assert.equal(arena.objects.length, 1);

    for (let frame = 0; frame < 10; frame++) game.updateSplitBalls(1 / 60);

    assert.equal(game._splitBalls.length, 0);
    assert.equal(mesh.parent, null, 'mesh left the scene');
    assert.equal(arena.objects.length, 0, 'arena bookkeeping cleared');
    assert.deepEqual(disposed, { geometry: 1, material: 1 });
});

test('a failing removal still splices and disposes, so later frames never rethrow', () => {
    const arena = makeArena();
    arena.remove = () => { throw new Error('boom'); };
    const game = makeGame(arena);
    game._createSplitBallMesh(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 0, 0), 0.01);
    const disposed = trackDisposal(game._splitBalls[0].mesh);
    assert.throws(() => game.updateSplitBalls(1 / 60), /boom/);
    assert.equal(game._splitBalls.length, 0, 'spliced before removal');
    assert.deepEqual(disposed, { geometry: 1, material: 1 });
    assert.doesNotThrow(() => game.updateSplitBalls(1 / 60));
});

test('clearSplitBalls empties the list and disposes every mesh', () => {
    const arena = makeArena();
    const game = makeGame(arena);
    for (let index = 0; index < 3; index++) {
        game._createSplitBallMesh(new THREE.Vector3(index, 2, 0), new THREE.Vector3(1, 0, 0), 5);
    }
    const tracked = game._splitBalls.map(sb => trackDisposal(sb.mesh));
    game.clearSplitBalls();
    assert.equal(game._splitBalls.length, 0);
    assert.equal(arena.scene.children.length, 0);
    assert.equal(arena.objects.length, 0);
    for (const disposed of tracked) assert.deepEqual(disposed, { geometry: 1, material: 1 });
});
