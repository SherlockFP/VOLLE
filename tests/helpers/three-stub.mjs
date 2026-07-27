// tests/helpers/three-stub.mjs — hand-written THREE stand-in for node:test coverage.
// ponytail: sadece js/character-rig.js + js/character-anim.js'in gerçekten dokunduğu yüzey.
// Real parent/child wiring + real dispose-call counting so tests can assert on structure
// (rig.dispose() correctness, shared-material dedup) without a renderer.

class VectorLike {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
    }
    set(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
        return this;
    }
    copy(v) {
        this.x = v.x; this.y = v.y; this.z = v.z;
        return this;
    }
}

export class Object3D {
    constructor() {
        this.name = '';
        this.parent = null;
        this.children = [];
        this.visible = true;
        this.userData = {};
        this.position = new VectorLike(0, 0, 0);
        this.rotation = new VectorLike(0, 0, 0);
        this.scale = new VectorLike(1, 1, 1);
    }

    add(child) {
        if (child.parent) child.parent.remove(child);
        child.parent = this;
        this.children.push(child);
        return this;
    }

    remove(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
        if (child.parent === this) child.parent = null;
        return this;
    }

    removeFromParent() {
        if (this.parent) this.parent.remove(this);
        return this;
    }

    clear() {
        for (const child of [...this.children]) this.remove(child);
        return this;
    }

    traverse(callback) {
        callback(this);
        for (const child of [...this.children]) child.traverse(callback);
    }
}

export class Group extends Object3D {}
export class Scene extends Group {}

// ponytail: added for tests/shop-showcase.test.mjs (ShopShowcaseRenderer) -- character-rig.test.mjs
// never touches these, so this is purely additive.
export class HemisphereLight extends Object3D {}
export class DirectionalLight extends Object3D {}

export class PerspectiveCamera extends Object3D {
    constructor(fov, aspect, near, far) {
        super();
        this.fov = fov;
        this.aspect = aspect;
        this.near = near;
        this.far = far;
    }
    lookAt() {}
    updateProjectionMatrix() { this.projectionUpdates = (this.projectionUpdates || 0) + 1; }
}

export const PCFSoftShadowMap = 1;
export const SRGBColorSpace = 2;
export const ACESFilmicToneMapping = 3;

export class WebGLRenderer {
    constructor(options = {}) {
        this.domElement = options.canvas;
        this.shadowMap = {};
        this.renderCount = 0;
        this.disposed = false;
    }
    setClearColor() {}
    setAnimationLoop(loop) { this.loop = loop; }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) { this.size = { width, height }; }
    render() { this.renderCount++; }
    dispose() { this.disposed = true; }
}

export class Mesh extends Object3D {
    constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        this.castShadow = false;
        this.receiveShadow = false;
    }
}

class DisposableGeometry {
    constructor(...args) {
        this.args = args;
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}

export class BoxGeometry extends DisposableGeometry {}
export class SphereGeometry extends DisposableGeometry {}
export class CylinderGeometry extends DisposableGeometry {}
export class TorusGeometry extends DisposableGeometry {}

export class Color {
    constructor(hex = 0xffffff) {
        this.isColor = true;
        this.hex = hex;
    }
    setHex(hex) {
        this.hex = hex;
        return this;
    }
}

class DisposableMaterial {
    constructor(options = {}) {
        Object.assign(this, options);
        this.color = new Color(typeof options.color === 'number' ? options.color : 0xffffff);
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}

export class MeshStandardMaterial extends DisposableMaterial {}
export class MeshBasicMaterial extends DisposableMaterial {}

export class Texture {
    constructor() {
        this.isTexture = true;
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}

export const NearestFilter = 'NearestFilter';

export default {
    Object3D, Group, Scene, Mesh,
    HemisphereLight, DirectionalLight, PerspectiveCamera, WebGLRenderer,
    PCFSoftShadowMap, SRGBColorSpace, ACESFilmicToneMapping,
    BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry,
    Color, MeshStandardMaterial, MeshBasicMaterial,
    Texture, NearestFilter
};
