import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rendererSource = await readFile(new URL('../js/renderer.js', import.meta.url), 'utf8');

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(other) { return this.set(other.x, other.y, other.z); }
}

class Quaternion extends Vector3 {
    constructor(x = 0, y = 0, z = 0, w = 1) { super(x, y, z); this.w = w; }
    copy(other) { super.copy(other); this.w = other.w; return this; }
}

class Matrix4 {
    constructor() {
        this.position = new Vector3();
        this.quaternion = new Quaternion();
        this.scale = new Vector3(1, 1, 1);
    }
    copy(other) {
        this.position.copy(other.position);
        this.quaternion.copy(other.quaternion);
        this.scale.copy(other.scale);
        return this;
    }
    invert() {
        this.position.set(-this.position.x, -this.position.y, -this.position.z);
        this.quaternion.set(-this.quaternion.x, -this.quaternion.y, -this.quaternion.z);
        this.scale.set(1 / this.scale.x, 1 / this.scale.y, 1 / this.scale.z);
        return this;
    }
    premultiply(other) {
        this.position.set(
            other.position.x + this.position.x,
            other.position.y + this.position.y,
            other.position.z + this.position.z
        );
        this.quaternion.set(
            other.quaternion.x + this.quaternion.x,
            other.quaternion.y + this.quaternion.y,
            other.quaternion.z + this.quaternion.z
        );
        this.scale.set(
            other.scale.x * this.scale.x,
            other.scale.y * this.scale.y,
            other.scale.z * this.scale.z
        );
        return this;
    }
    decompose(position, quaternion, scale) {
        position.copy(this.position);
        quaternion.copy(this.quaternion);
        scale.copy(this.scale);
    }
}

class Object3D {
    constructor() {
        this.parent = null;
        this.children = [];
        this.position = new Vector3();
        this.quaternion = new Quaternion();
        this.scale = new Vector3(1, 1, 1);
        this.matrixWorld = new Matrix4();
        this.userData = {};
        this.visible = true;
    }
    add(child) { child.parent = this; this.children.push(child); }
    updateWorldMatrix(updateParents) {
        if (updateParents) this.parent?.updateWorldMatrix(true, false);
        const parentMatrix = this.parent?.matrixWorld;
        this.matrixWorld.position.set(
            (parentMatrix?.position.x || 0) + this.position.x,
            (parentMatrix?.position.y || 0) + this.position.y,
            (parentMatrix?.position.z || 0) + this.position.z
        );
        this.matrixWorld.quaternion.set(
            (parentMatrix?.quaternion.x || 0) + this.quaternion.x,
            (parentMatrix?.quaternion.y || 0) + this.quaternion.y,
            (parentMatrix?.quaternion.z || 0) + this.quaternion.z
        );
        this.matrixWorld.scale.set(
            (parentMatrix?.scale.x || 1) * this.scale.x,
            (parentMatrix?.scale.y || 1) * this.scale.y,
            (parentMatrix?.scale.z || 1) * this.scale.z
        );
    }
}

class Group extends Object3D {}
class Geometry {
    constructor(type) { this.type = type; }
    clone() { return new Geometry(this.type); }
}
class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
class ShaderMaterial { constructor(options) { Object.assign(this, options); } }
class Color { constructor(value) { this.value = value; } getHex() { return this.value; } }

const THREE = { Group, Matrix4, Mesh, ShaderMaterial, Color, BackSide: 'back' };
const method = rendererSource.slice(
    rendererSource.indexOf('    createTargetOutline(parts) {'),
    rendererSource.indexOf('    render(camera) {')
);
const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
const createTargetOutline = new Function('THREE', 'outlineVertexShader', 'parts', body);

test('target outline clones each supplied mesh with its exact root-local transform', () => {
    const root = new Group();
    root.position.set(3, 2, -4);
    const torsoGeometry = new Geometry('BoxGeometry');
    const torsoMaterial = { id: 'torso-material' };
    const torso = new Mesh(torsoGeometry, torsoMaterial);
    torso.position.set(0.2, 1, -0.1);
    root.add(torso);
    const arm = new Group();
    arm.position.set(0.8, 1.1, 0);
    arm.quaternion.set(0, 0, 0.25);
    root.add(arm);
    const hand = new Mesh(new Geometry('BoxGeometry'), { id: 'hand-material' });
    hand.position.set(0, -0.4, 0.1);
    hand.scale.set(0.5, 0.75, 1.25);
    arm.add(hand);

    const outline = createTargetOutline(THREE, 'outline-vertex', [torso, hand]);
    root.add(outline);
    outline.userData.sync();

    assert.equal(outline.visible, false);
    assert.equal(outline.children.length, 2);
    assert.equal(outline.userData.materials.length, 2);
    assert.deepEqual(
        outline.children.map(child => [child.position.x, child.position.y, child.position.z]
            .map(value => Number(value.toFixed(9)))),
        [[0.2, 1, -0.1], [0.8, 0.7, 0.1]]
    );
    assert.equal(outline.children[1].quaternion.z, 0.25);
    assert.deepEqual(
        [outline.children[1].scale.x, outline.children[1].scale.y, outline.children[1].scale.z],
        [0.5, 0.75, 1.25]
    );
    assert.notEqual(outline.children[0].geometry, torsoGeometry);
    assert.equal(outline.children[0].geometry.type, torsoGeometry.type);
    assert.equal(torso.material, torsoMaterial);
    for (const material of outline.userData.materials) {
        assert.equal(material.uniforms.uColor.value.getHex(), 0xff202d);
        assert.equal(material.uniforms.uPulse.value, 0);
    }
});

test('Bot consumes the renderer target-outline API and pulses every returned material', async () => {
    const source = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
    assert.match(source, /this\.renderer\.createTargetOutline\(parts\)/);
    assert.match(source, /for \(const material of this\.targetOutline\.userData\.materials \|\| \[\]\)/);
    assert.doesNotMatch(source, /new THREE\.BoxGeometry\(0\.9, 1\.8, 0\.7\)/);
    assert.match(source, /const headGeo = new THREE\.BoxGeometry/);
    assert.match(source, /const handGeo = new THREE\.BoxGeometry/);
});

test('remote players use the same silhouette outline instead of a bounding box', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(source, /this\.renderer\.createTargetOutline\(\[\s*headMesh, bodyMesh, leftArm, rightArm, leftLeg, rightLeg/);
    assert.match(source, /for \(const material of p\.targetOutline\.userData\.materials \|\| \[\]\)/);
    assert.doesNotMatch(source, /new THREE\.BoxGeometry\(0\.9, 2\.0, 0\.7\)/);
});
