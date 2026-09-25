// Far-court readability: the ball never drops below BALL_MIN_PX on screen, and
// opponents (never teammates) carry a constant-size team marker once far away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { extractMethod } from './frame-contact-sim.mjs';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});
const THREE = await import(THREE_URL);
const {
    VisibilityAids, BALL_MIN_PX, MARKER_PX, MARKER_NEAR, MARKER_FAR,
    worldSizeForPixels, projectedPixels, beaconOpacity, markerOpacity
} = await import('../js/visibility-aids.js');

const VIEWPORT = 720;
function camera(z = 40) {
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.2, 2000);
    cam.position.set(0, 1.7, z);
    return cam;
}
function ballAt(scene, z, glow = 0x33ccff) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.43, 8, 8));
    mesh.position.set(0, 1, z);
    scene.add(mesh);
    return { mesh, visualRadius: 0.43, skinConfig: { glow } };
}
function entity(scene, team, z, alive = true) {
    const group = new THREE.Group();
    group.position.set(2, 0, z);
    scene.add(group);
    return { group, team, alive };
}

test('the far-court ball is too small today; the size math round-trips', () => {
    assert.ok(projectedPixels(0.86, 83, 75, VIEWPORT) < 6, 'the problem this fixes');
    for (const distance of [5, 40, 120]) {
        const world = worldSizeForPixels(distance, 75, VIEWPORT, 12);
        assert.ok(Math.abs(projectedPixels(world, distance, 75, VIEWPORT) - 12) < 1e-9);
    }
    assert.equal(beaconOpacity(4), 1);
    assert.equal(beaconOpacity(BALL_MIN_PX), 0);
    assert.equal(markerOpacity(MARKER_NEAR - 1), 0);
    assert.equal(markerOpacity(MARKER_FAR + 1), 1);
});

test('a distant ball gets a skin-tinted beacon at least BALL_MIN_PX wide; a near one does not', () => {
    const scene = new THREE.Scene();
    const cam = camera();
    const ball = ballAt(scene, -43);
    const aids = new VisibilityAids(scene);
    assert.equal(aids.updateBall(ball, cam, VIEWPORT), true);
    const beacon = aids.beacon;
    assert.equal(beacon.visible, true);
    assert.equal(beacon.parent, scene);
    assert.equal(beacon.material.fog, false);
    assert.equal(beacon.material.depthTest, true, 'walls still hide the ball');
    const distance = cam.position.distanceTo(beacon.position);
    assert.ok(projectedPixels(beacon.scale.x * 0.625, distance, 75, VIEWPORT) >= BALL_MIN_PX - 0.2);
    assert.equal(beacon.material.color.getHex(), new THREE.Color(0x33ccff).getHex());
    assert.ok(beacon.position.z > ball.mesh.position.z, 'pulled toward the camera, off the floor');

    ball.mesh.position.z = 30; // ~10 units away: the real ball is big enough
    assert.equal(aids.updateBall(ball, cam, VIEWPORT), false);
    assert.equal(beacon.visible, false);
    ball.mesh.position.z = -43;
    ball.mesh.visible = false;
    assert.equal(aids.updateBall(ball, cam, VIEWPORT), false);
    assert.equal(aids.beacon, beacon, 'one pooled sprite');
});

test('markers: far living opponents only, constant screen size, pooled', () => {
    const scene = new THREE.Scene();
    const cam = camera();
    const aids = new VisibilityAids(scene);
    const far = entity(scene, 'red', -40);
    const near = entity(scene, 'red', 32);
    const dead = entity(scene, 'red', -40, false);
    assert.equal(aids.updateEnemies([far, near, dead], cam, VIEWPORT), 1);
    const [marker] = aids.markers;
    assert.equal(marker.visible, true);
    assert.equal(marker.material.color.getHex(), new THREE.Color(0xff4d5e).getHex());
    assert.ok(marker.position.y > far.group.position.y + 3, 'above the head');
    const px = projectedPixels(marker.scale.y, cam.position.distanceTo(marker.position), 75, VIEWPORT);
    assert.ok(Math.abs(px - MARKER_PX) < 0.01);
    aids.updateEnemies([far], cam, VIEWPORT, { ffa: true });
    assert.equal(marker.material.color.getHex(), new THREE.Color(0xffa23a).getHex());
    assert.equal(aids.updateEnemies([], cam, VIEWPORT), 0);
    assert.equal(marker.visible, false);
    assert.equal(aids.markers.length, 1, 'no sprite churn');
});

test('the game feeds opponents only, and hides everything outside live rounds', async () => {
    const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    const method = extractMethod(source, 'updateVisibilityAids');
    const STATES = { MENU: 'menu', PLAYING: 'playing', COUNTDOWN: 'countdown', ROUND_END: 'roundEnd', CELEBRATION: 'celebration' };
    const updateVisibilityAids = new Function('STATES', `return ({ ${method} }).updateVisibilityAids;`)(STATES);
    const calls = [];
    const aids = {
        hide: () => calls.push('hide'),
        updateBall: () => calls.push('ball'),
        updateEnemies: (list, cam, h, opts) => calls.push({ names: list.map(e => e.name), ffa: opts.ffa })
    };
    const player = { team: 'blue', name: 'me' };
    const game = {
        state: STATES.PLAYING, visibilityAids: aids, _visibilityEnemies: [], ball: {}, player, _ffa: false,
        bots: [{ name: 'r1', team: 'red' }, { name: 'b1', team: 'blue' }],
        remotePlayers: new Map([['p', { name: 'r2', team: 'red' }], ['q', { name: 'b2', team: 'blue' }]])
    };
    updateVisibilityAids.call(game, {}, VIEWPORT);
    assert.deepEqual(calls, ['ball', { names: ['r1', 'r2'], ffa: false }]);
    calls.length = 0;
    game._ffa = true;
    updateVisibilityAids.call(game, {}, VIEWPORT);
    assert.deepEqual(calls[1], { names: ['r1', 'b1', 'r2', 'b2'], ffa: true });
    for (const state of [STATES.MENU, STATES.CELEBRATION]) {
        calls.length = 0;
        game.state = state;
        updateVisibilityAids.call(game, {}, VIEWPORT);
        assert.deepEqual(calls, ['hide']);
    }
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.equal((main.match(/this\.game\.updateVisibilityAids\?\.\(this\.camera, this\.renderer\._viewport\?\.height\);\s+this\.renderer\.render\(this\.camera\);/g) || []).length, 2,
        'menu and match render paths both update (or hide) the aids right before drawing');
});

// Shader prewarm: the pillar, beacon and markers used to compile on the frame they
// first appeared (a 0.2-0.6 s stall at the first kill on software GL).
test('match start compiles hidden effects against the composer target', async () => {
    const { KillPillars } = await import('../js/kill-pillars.js');
    const scene = new THREE.Scene();
    const pillars = new KillPillars(scene);
    pillars.prewarm();
    assert.equal(pillars.slots.length, 1);
    assert.equal(pillars.slots[0].group.parent, scene);
    assert.equal(pillars.slots[0].group.visible, false);
    const aids = new VisibilityAids(scene);
    aids.prewarm();
    assert.equal(aids.beacon.parent, scene);
    assert.equal(aids.beacon.visible, false);
    assert.equal(aids.markers.length, 1);

    const rendererSource = readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8');
    const prewarm = new Function(`return ({ ${extractMethod(rendererSource, 'prewarm')} }).prewarm;`)();
    const calls = [];
    const readBuffer = { id: 'composer-read' };
    let target = 'canvas';
    const fake = {
        scene: { id: 'scene' },
        _composer: { readBuffer },
        _initComposer: () => calls.push('init'),
        renderer: {
            compile: (root, cam, targetScene) => { calls.push({ root: root.id, target, targetScene: targetScene?.id ?? null }); },
            compileAsync: () => { throw new Error('compileAsync polls disposed materials; prewarm must not use it'); },
            getRenderTarget: () => target,
            setRenderTarget: value => { target = value; }
        }
    };
    assert.equal(await prewarm.call(fake, {}), true);
    assert.deepEqual(calls, ['init', { root: 'scene', target: readBuffer, targetScene: null }]);
    assert.equal(target, 'canvas', 'the previous render target is restored');
    calls.length = 0;
    await prewarm.call(fake, {}, { id: 'decor' });
    assert.deepEqual(calls[1], { root: 'decor', target: readBuffer, targetScene: 'scene' }, 'a subtree is lit by the scene');
    assert.equal(await prewarm.call(fake, null), false);

    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.equal((game.match(/this\.initMinimap\(\);\s+(?:\/\/[^\n]*\n\s+)*this\._prewarmMatchShaders\?\.\(\);/g) || []).length, 2,
        'both the countdown start and the late-join start prewarm');
    const arena = readFileSync(new URL('../js/arena.js', import.meta.url), 'utf8');
    assert.match(arena, /loadArenaDecor\(this\.scene, this\.config, arenaSize, \{ onModel \}\)/);
});
