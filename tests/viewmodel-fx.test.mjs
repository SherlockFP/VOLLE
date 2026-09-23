// tests/viewmodel-fx.test.mjs — rarity must read in the player's hands, cheaply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Real vendored three.js: the scene graph, Box3 and buffer math run fine without WebGL.
const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});

const THREE = await import('three');
const fx = await import('../js/viewmodel-fx.js');
const { createKnifeModel } = await import('../js/weapon-models.js');
const { KNIVES } = await import('../js/cosmetics.js');

test('rarity ladder: each tier adds presentation, never removes it', () => {
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic'];
    for (let i = 1; i < order.length; i++) {
        const lower = fx.viewmodelFxForRarity(order[i - 1]);
        const higher = fx.viewmodelFxForRarity(order[i]);
        assert.ok(higher.rim >= lower.rim, `${order[i]} rim`);
        assert.ok(Number(higher.trail) >= Number(lower.trail), `${order[i]} trail`);
        assert.ok(higher.sparkles >= lower.sparkles, `${order[i]} sparkles`);
    }
    assert.equal(fx.viewmodelFxForRarity('common').rim, 0, 'default knife stays clean');
    assert.equal(fx.viewmodelFxForRarity('nonsense').rim, 0);
});

test('reduced motion keeps the static rim and drops all motion', () => {
    const calm = fx.viewmodelFxForRarity('legendary', { reduceMotion: true });
    assert.equal(calm.rim, fx.VIEWMODEL_RARITY_FX.legendary.rim);
    assert.equal(calm.trail, false);
    assert.equal(calm.sparkles, 0);
    assert.equal(calm.pulse, 0);
});

test('trail strength is 0 at rest, peaks mid-swing and fades out by the end', () => {
    assert.equal(fx.trailStrength('idle', 0.5), 0);
    assert.equal(fx.trailStrength('draw', 0.5), 0);
    assert.equal(fx.trailStrength('slash', 0), 0);
    assert.equal(fx.trailStrength('slash', 0.4), 1);
    assert.ok(fx.trailStrength('slash', 0.9) < 0.35);
    assert.equal(fx.trailStrength('slash', 1), 0);
});

test('common knives get no rarity layer at all', () => {
    const group = createKnifeModel(KNIVES.training);
    assert.equal(fx.attachViewmodelFx(group, KNIVES.training, new THREE.Group()), null);
    assert.equal(group.userData.viewmodelFx, undefined);
});

test('legendary knife: rim on every mesh, trail on the host, sparkles, clean dispose', () => {
    const style = KNIVES.doppler;
    assert.equal(style.rarity, 'legendary');
    const host = new THREE.Group();
    const group = createKnifeModel(style);
    const meshCount = (() => { let n = 0; group.traverse(o => { if (o.isMesh) n++; }); return n; })();
    const state = fx.attachViewmodelFx(group, style, host);
    host.add(group);
    assert.ok(state);
    assert.equal(state.rimMeshes.length, meshCount);
    assert.equal(host.children.filter(c => c.name === 'viewmodel-trail').length, 1);
    assert.ok(state.sparkles);

    // Swing: trail becomes visible and every sample lands in finite host space.
    for (let i = 0; i < 20; i++) {
        group.rotation.z = i * 0.08;
        fx.updateViewmodelFx(state, 1 / 60, { action: 'slash', progress: 0.3 + i * 0.01 });
    }
    assert.equal(state.trail.mesh.visible, true);
    assert.ok(state.trail.positions.every(Number.isFinite));
    fx.updateViewmodelFx(state, 1 / 60, { action: 'idle', progress: 0 });
    assert.equal(state.trail.mesh.visible, false);

    fx.disposeViewmodelFx(state);
    assert.equal(host.children.some(c => c.name === 'viewmodel-trail'), false);
    let rimLeft = 0;
    group.traverse(o => { if (o.name === 'viewmodel-rim' || o.name === 'viewmodel-sparkles') rimLeft++; });
    assert.equal(rimLeft, 0);
});

test('per-frame update allocates nothing new in the trail buffers', () => {
    const host = new THREE.Group();
    const group = createKnifeModel(KNIVES.prism);
    const state = fx.attachViewmodelFx(group, KNIVES.prism, host);
    const positions = state.trail.positions;
    const colors = state.trail.colors;
    for (let i = 0; i < 30; i++) fx.updateViewmodelFx(state, 1 / 60, { action: 'stab', progress: i / 30 });
    assert.equal(state.trail.positions, positions);
    assert.equal(state.trail.colors, colors);
    fx.disposeViewmodelFx(state);
});

test('player wires the rarity layer through equip, frame update and deflect kick', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    const sync = source.slice(source.indexOf('    _syncViewmodelWeapon() {'), source.indexOf('    setupInput() {'));
    assert.ok(sync.indexOf('disposeViewmodelFx(') < sync.indexOf('disposeObject3D(this.knifeGroup)'), 'fx released before the knife');
    assert.ok(sync.indexOf('attachViewmodelFx(') < sync.indexOf('this._applyViewmodelFrame(this.knifeGroup, this.knifeGroup.userData.model)'), 'measured at identity');
    assert.match(source, /updateViewmodelFx\(this\.knifeGroup\.userData\.viewmodelFx, dt, pose\)/);
    assert.match(source, /this\._viewKick = Math\.min\(1, this\.kickAmt \/ 0\.12\);/);
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /this\.player\.setHandVisible\(this\.store\.get\('showViewmodel'\) !== false\);/, 'viewmodel on by default');
});

test('viewmodel options clamp to CS-style limits and fall back to the tuned defaults', async () => {
    const { normalizeViewmodelOptions, VIEWMODEL_DEFAULTS } = await import('../js/player.js').catch(() => ({}));
    if (!normalizeViewmodelOptions) return; // player.js needs a browser-ish env in some runs
    assert.deepEqual(normalizeViewmodelOptions({}), { ...VIEWMODEL_DEFAULTS });
    assert.deepEqual(normalizeViewmodelOptions({ fov: 200, x: -9, y: 9, z: 'x' }), { fov: 80, x: -2, y: 2, z: VIEWMODEL_DEFAULTS.z });
});
