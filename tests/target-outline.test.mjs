// tests/target-outline.test.mjs — regression coverage for the rig-sourced silhouette
// target outline (js/renderer.js#createTargetOutline), restored after the character-rig
// migration deleted the old implementation and both call sites (js/bot.js, js/game.js)
// were downgraded to a single crude bounding box.
//
// Same technique as the test this file restores: 'three' isn't an installed npm package
// (CDN-only via index.html's importmap) and js/renderer.js also imports EffectComposer/
// UnrealBloomPass/etc from 'three/addons/...', which the checked-in THREE stub used by
// tests/character-rig.test.mjs doesn't cover either. So instead of importing js/renderer.js
// as a module, this slices the createTargetOutline method's source text straight out of the
// file and evaluates it standalone via `new Function`, against a minimal local THREE mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rendererSource = await readFile(new URL('../js/renderer.js', import.meta.url), 'utf8');

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
}

class Object3D {
    constructor() {
        this.name = '';
        this.parent = null;
        this.children = [];
        this.position = new Vector3();
        this.rotation = new Vector3();
        this.scale = new Vector3(1, 1, 1);
        this.visible = true;
        this.userData = {};
    }
    add(child) {
        if (child.parent) child.parent.remove(child);
        child.parent = this;
        this.children.push(child);
        return this;
    }
    remove(child) {
        const i = this.children.indexOf(child);
        if (i !== -1) this.children.splice(i, 1);
        if (child.parent === this) child.parent = null;
        return this;
    }
}

class Group extends Object3D {}

class Mesh extends Object3D {
    constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        this.isMesh = true;
    }
}

class BoxGeometry {
    constructor(...args) { this.args = args; this.disposeCalls = 0; }
    dispose() { this.disposeCalls += 1; }
}

class ShaderMaterial {
    constructor(options) { Object.assign(this, options); this.disposeCalls = 0; }
    dispose() { this.disposeCalls += 1; }
}

const THREE = { Group, Mesh, ShaderMaterial, BoxGeometry, BackSide: 'back' };

// Pull just the createTargetOutline method body out of renderer.js and run it as a
// standalone function — mirrors the extraction the removed test used for this exact method.
const START_MARKER = '    createTargetOutline(parts = []) {';
const END_MARKER = '    render(camera) {';
const startIndex = rendererSource.indexOf(START_MARKER);
const endIndex = rendererSource.indexOf(END_MARKER);
assert.ok(startIndex !== -1, 'createTargetOutline method not found in js/renderer.js');
assert.ok(endIndex !== -1 && endIndex > startIndex, 'render(camera) method not found after createTargetOutline');
const method = rendererSource.slice(startIndex, endIndex);
const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
const createTargetOutline = new Function('THREE', 'outlineVertexShader', 'parts', body);

function buildParts() {
    const torsoGeo = new BoxGeometry(0.62, 0.68, 0.36);
    const torso = new Mesh(torsoGeo, { id: 'torso-material' });
    torso.name = 'torso-mesh';
    const torsoParent = new Group();
    torsoParent.add(torso);

    const armGeo = new BoxGeometry(0.2, 0.48, 0.22);
    const arm = new Mesh(armGeo, { id: 'arm-material' });
    arm.name = 'upper-arm-L';
    const armParent = new Group();
    armParent.add(arm);

    return { torso, arm, torsoParent, armParent };
}

test('createTargetOutline exists on the renderer and returns a group with non-empty userData.materials', () => {
    const { torso, arm } = buildParts();
    const outline = createTargetOutline(THREE, 'outline-vertex-shader', [torso, arm]);
    assert.ok(outline, 'createTargetOutline should return a value');
    assert.ok(Array.isArray(outline.userData.materials), 'userData.materials should be an array');
    assert.equal(outline.userData.materials.length, 2, 'one material per traced part');
});

test('every material carries a uPulse uniform, initialized to 0', () => {
    const { torso, arm } = buildParts();
    const outline = createTargetOutline(THREE, 'outline-vertex-shader', [torso, arm]);
    for (const material of outline.userData.materials) {
        assert.ok(material.uniforms?.uPulse, 'material should have a uPulse uniform');
        assert.equal(material.uniforms.uPulse.value, 0);
    }
});

test('outline meshes are hidden by default and parented alongside their source part (tracks rig animation for free)', () => {
    const { torso, arm, torsoParent, armParent } = buildParts();
    const outline = createTargetOutline(THREE, 'outline-vertex-shader', [torso, arm]);
    assert.equal(outline.userData.meshes.length, 2);
    for (const mesh of outline.userData.meshes) assert.equal(mesh.visible, false, 'outline mesh should start hidden');

    const torsoOutline = outline.userData.meshes.find(m => m.name.includes('torso-mesh'));
    const armOutline = outline.userData.meshes.find(m => m.name.includes('upper-arm-L'));
    assert.equal(torsoOutline.parent, torsoParent, 'outline mesh should share its source part\'s parent, not a detached group');
    assert.equal(armOutline.parent, armParent, 'outline mesh should share its source part\'s parent, not a detached group');
    // Reuses the part's own geometry (no clone) — geometry ownership/disposal stays with the rig.
    assert.equal(torsoOutline.geometry, torso.geometry);
});

test('userData.setVisible toggles every outline mesh together', () => {
    const { torso, arm } = buildParts();
    const outline = createTargetOutline(THREE, 'outline-vertex-shader', [torso, arm]);
    outline.userData.setVisible(true);
    for (const mesh of outline.userData.meshes) assert.equal(mesh.visible, true);
    outline.userData.setVisible(false);
    for (const mesh of outline.userData.meshes) assert.equal(mesh.visible, false);
});

test('userData.dispose() releases every material exactly once and detaches every mesh, without touching the shared part geometry', () => {
    const { torso, arm, torsoParent, armParent } = buildParts();
    const outline = createTargetOutline(THREE, 'outline-vertex-shader', [torso, arm]);
    const materials = [...outline.userData.materials];
    const meshes = [...outline.userData.meshes];

    for (const material of materials) assert.equal(material.disposeCalls, 0);

    outline.userData.dispose();

    for (const material of materials) assert.equal(material.disposeCalls, 1, 'material disposed exactly once');
    for (const mesh of meshes) assert.equal(mesh.parent, null, 'outline mesh should be detached from its parent');
    assert.equal(torsoParent.children.includes(torso), true, 'the traced source part itself must remain untouched');
    assert.equal(armParent.children.includes(arm), true, 'the traced source part itself must remain untouched');
    // Geometry is owned by the rig, not the outline — dispose() must not free it (would
    // double-free once rig.dispose() runs, or yank geometry out from under the visible mesh).
    assert.equal(torso.geometry.disposeCalls, 0);
    assert.equal(arm.geometry.disposeCalls, 0);

    // Idempotent-ish: userData arrays are drained so a second dispose is a no-op, not a re-dispose.
    outline.userData.dispose();
    for (const material of materials) assert.equal(material.disposeCalls, 1, 'second dispose() must not double-free');
});

test('Bot consumes the renderer target-outline API, snapshots rig parts before the knife attaches, and pulses every returned material', async () => {
    const source = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
    assert.match(source, /this\.renderer\.createTargetOutline\(this\._outlineParts \|\| \[\]\)/);
    assert.match(source, /this\.rig\.root\.traverse\(o => \{ if \(o\.isMesh\) this\._outlineParts\.push\(o\); \}\)/);
    assert.match(source, /for \(const material of this\.targetOutline\?\.userData\.materials \|\| \[\]\)/);
    assert.doesNotMatch(source, /new THREE\.BoxGeometry\(0\.9, 1\.8, 0\.7\)/, 'crude fixed-size box outline must be gone');
});

test('remote players (js/game.js) use the same rig-sourced silhouette outline instead of a bounding box, and pulse every returned material', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(source, /this\.renderer\.createTargetOutline\(outlineParts\)/);
    assert.match(source, /rig\.root\.traverse\(o => \{ if \(o\.isMesh\) outlineParts\.push\(o\); \}\)/);
    assert.match(source, /for \(const material of p\.targetOutline\?\.userData\.materials \|\| \[\]\)/);
    assert.doesNotMatch(source, /new THREE\.BoxGeometry\(0\.9, 2\.0, 0\.7\)/, 'crude fixed-size box outline must be gone');
});

test('both call sites dispose the target outline alongside the rest of the entity teardown', async () => {
    const botSource = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
    const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(botSource, /this\.targetOutline\?\.userData\.dispose\?\.\(\)/);
    assert.match(gameSource, /p\.targetOutline\?\.userData\.dispose\?\.\(\)/);
});
