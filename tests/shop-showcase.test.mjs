import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AVATAR_SKINS } from '../js/avatar.js';
import { CHARACTERS } from '../js/characters.js';

const fakeThree = String.raw`
class Color {
    constructor(value = 0) { this.setHex(value); }
    setHex(value) { this.hex = value; return this; }
}
class Object3D {
    constructor() {
        this.children = [];
        this.parent = null;
        this.name = '';
        this.userData = {};
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    }
    add(...items) { for (const item of items) { item.parent = this; this.children.push(item); } return this; }
    clear() { for (const child of this.children) child.parent = null; this.children.length = 0; }
    removeFromParent() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent = null;
    }
}
class Group extends Object3D {}
class Scene extends Group {}
class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class Geometry {
    constructor(...args) { this.args = args; this.disposed = false; }
    dispose() { this.disposed = true; }
}
class BoxGeometry extends Geometry {}
class CylinderGeometry extends Geometry {}
class TorusGeometry extends Geometry {}
class Material {
    constructor(options = {}) {
        Object.assign(this, options);
        this.color = new Color(options.color);
        this.emissive = new Color(options.emissive);
        this.disposed = false;
    }
    dispose() { this.disposed = true; }
}
class MeshStandardMaterial extends Material {}
class MeshBasicMaterial extends Material {}
class HemisphereLight extends Object3D {}
class DirectionalLight extends Object3D {}
class PerspectiveCamera extends Object3D {
    constructor(fieldOfView, aspect) { super(); this.fieldOfView = fieldOfView; this.aspect = aspect; }
    lookAt() {}
    updateProjectionMatrix() { this.projectionUpdates = (this.projectionUpdates || 0) + 1; }
}
class WebGLRenderer {
    constructor(options) { this.domElement = options.canvas; this.shadowMap = {}; this.renderCount = 0; }
    setClearColor() {}
    setAnimationLoop(loop) { this.loop = loop; }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) { this.size = { width, height }; }
    render() { this.renderCount++; }
    dispose() { this.disposed = true; }
}
const THREE = {
    Group, Scene, Mesh, BoxGeometry, CylinderGeometry, TorusGeometry,
    MeshStandardMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight,
    PerspectiveCamera, WebGLRenderer, PCFSoftShadowMap: 1, SRGBColorSpace: 2,
    ACESFilmicToneMapping: 3
};
`;

const source = await readFile(new URL('../js/shop-showcase.js', import.meta.url), 'utf8');
const moduleSource = source
    .replace("import * as THREE from 'three';", fakeThree)
    .replace("import { AVATAR_SKINS } from './avatar.js';", `const AVATAR_SKINS = ${JSON.stringify(AVATAR_SKINS)};`)
    .replace("import { CHARACTERS } from './characters.js';", `const CHARACTERS = ${JSON.stringify(CHARACTERS)};`);
const showcase = await import(`data:text/javascript,${encodeURIComponent(moduleSource)}`);

function descendants(root) {
    return root.children.flatMap(child => [child, ...descendants(child)]);
}

class FakeTarget {
    constructor() {
        this.listeners = new Map();
        this.attributes = new Map();
    }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
}

function fakeBrowser(reducedMotion = false) {
    const media = new FakeTarget();
    media.matches = reducedMotion;
    const window = new FakeTarget();
    window.devicePixelRatio = 2.5;
    window.matchMedia = () => media;
    const document = new FakeTarget();
    document.defaultView = window;
    document.hidden = false;
    const canvas = new FakeTarget();
    canvas.tagName = 'CANVAS';
    canvas.ownerDocument = document;
    canvas.style = {};
    canvas.clientWidth = 640;
    canvas.clientHeight = 480;
    canvas.getBoundingClientRect = () => ({ width: 640, height: 480 });
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    return { canvas, document, media, window };
}

test('normalizes catalog state and derives a deterministic material palette', () => {
    assert.deepEqual(showcase.normalizeShowcaseState(), { characterId: 'rally', skinId: 'default' });
    assert.deepEqual(
        showcase.normalizeShowcaseState({ characterId: 'tank', skinId: 'frost' }),
        { characterId: 'tank', skinId: 'frost' }
    );
    assert.deepEqual(
        showcase.normalizeShowcaseState({ characterId: '__proto__', skinId: 'missing' }),
        { characterId: 'rally', skinId: 'default' }
    );

    const palette = showcase.getShowcaseMaterialPalette({ characterId: 'tank', skinId: 'frost' });
    assert.equal(palette.head, 0xffffff);
    assert.equal(palette.body, 0x4488ff);
    assert.equal(palette.arms, 0x88ccff);
    assert.ok(showcase.getShowcaseCharacterShape('tank').width > showcase.getShowcaseCharacterShape('rally').width);
});

test('reusable avatar rig swaps skin materials in place and disposes GPU resources', () => {
    const rig = showcase.createShowcaseAvatar({ characterId: 'scout', skinId: 'neon' });
    const torso = descendants(rig.root).find(item => item.name === 'torso');
    const arm = descendants(rig.root).find(item => item.name === 'left-arm');
    const material = torso.material;
    const oldColor = material.color.hex;

    assert.equal(rig.root.name, 'warrball-showcase-avatar');
    assert.deepEqual(rig.state, { characterId: 'scout', skinId: 'neon' });
    assert.equal(arm.scale.x, .82);
    assert.equal(rig.setSkin('frost'), 'frost');
    assert.equal(torso.material, material);
    assert.notEqual(material.color.hex, oldColor);
    assert.equal(material.color.hex, 0x4488ff);
    assert.equal(arm.scale.x, 1);
    assert.equal(rig.setCharacter('tank'), 'tank');
    assert.equal(rig.root.children[0].scale.x, 1.18);

    const meshes = descendants(rig.root).filter(item => item.geometry);
    rig.dispose();
    assert.equal(rig.root.userData.disposed, true);
    assert.ok(meshes.every(mesh => mesh.geometry.disposed && mesh.material.disposed));
});

test('renderer supports canvas mounts, keyboard rotation, reactive reduced motion, and cleanup', () => {
    const { canvas, document, media } = fakeBrowser(false);
    const renderer = showcase.createShopShowcase(canvas, {
        characterId: 'rally',
        skinId: 'default',
        autoStart: false
    });

    assert.equal(canvas.getAttribute('role'), 'img');
    assert.match(canvas.getAttribute('aria-label'), /arrow keys/i);
    assert.deepEqual(renderer.resize(), { width: 640, height: 480, pixelRatio: 2 });
    assert.equal(renderer.camera.aspect, 4 / 3);
    assert.equal(renderer.start(), true);
    assert.equal(typeof renderer.renderer.loop, 'function');

    const initialYaw = renderer.avatar.root.rotation.y;
    let prevented = false;
    canvas.dispatch('keydown', { key: 'ArrowRight', shiftKey: false, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.ok(renderer.avatar.root.rotation.y > initialYaw);
    const keyboardYaw = renderer.avatar.root.rotation.y;
    canvas.dispatch('pointerdown', { clientX: 10, clientY: 20, pointerId: 1 });
    canvas.dispatch('pointermove', { clientX: 30, clientY: 24, pointerId: 1 });
    canvas.dispatch('pointerup', { pointerId: 1 });
    assert.ok(renderer.avatar.root.rotation.y > keyboardYaw);
    assert.deepEqual(renderer.sync({ skinId: 'neon' }), { characterId: 'rally', skinId: 'neon' });

    media.matches = true;
    media.dispatch('change', { matches: true });
    assert.equal(renderer.reducedMotion, true);
    assert.equal(renderer.renderer.loop, null);
    media.matches = false;
    media.dispatch('change', { matches: false });
    assert.equal(typeof renderer.renderer.loop, 'function');

    document.hidden = true;
    document.dispatch('visibilitychange');
    assert.equal(renderer.renderer.loop, null);
    renderer.dispose();
    assert.equal(renderer.renderer.disposed, true);
    assert.equal(canvas.getAttribute('role'), null);
    assert.equal(canvas.style.touchAction, '');
});
