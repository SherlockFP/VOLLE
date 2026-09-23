// tests/helpers/three-stub-ball-fx.mjs — minimal standalone THREE stand-in for
// tests/ball-skin-fx.test.mjs.
//
// Deliberately NOT built on top of the shared tests/helpers/three-stub(.-extended).mjs:
// that stub's Object3D.scale has no setScalar() (js/character-rig.js/character-anim.js,
// the surfaces it was written for, never call it), and js/ball-skin-fx.js's impact-burst
// pool does. Keeping this a fully self-contained file avoids editing a stub other agents'
// suites depend on, and keeps this addition inside this task's file ownership (js/ball.js,
// js/skin-presets.js, and new modules/tests).
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}

class DisposableGeometry {
    constructor(...args) { this.args = args; this.disposeCalls = 0; }
    dispose() { this.disposeCalls += 1; }
}
export class TorusGeometry extends DisposableGeometry {}
export class TetrahedronGeometry extends DisposableGeometry {}

export class Color {
    constructor(hex = 0xffffff) { this.hex = hex; }
    setHex(hex) { this.hex = hex; return this; }
}

class DisposableMaterial {
    constructor(options = {}) {
        Object.assign(this, options);
        this.color = new Color(typeof options.color === 'number' ? options.color : 0xffffff);
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}
export class MeshBasicMaterial extends DisposableMaterial {}

export class Mesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = new Vec3();
        this.rotation = new Vec3();
        this.scale = new Vec3(1, 1, 1);
        this.visible = true;
        this.parent = null;
    }
}

export const AdditiveBlending = 'AdditiveBlending';
export const NormalBlending = 'NormalBlending';
export const NearestFilter = 'NearestFilter';
export const LinearFilter = 'LinearFilter';
export const RepeatWrapping = 'RepeatWrapping';

export class CanvasTexture {
    constructor(canvas) {
        this.isCanvasTexture = true;
        this.canvas = canvas;
        this.disposeCalls = 0;
        this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
        this.wrapS = undefined;
        this.wrapT = undefined;
        this.magFilter = undefined;
        this.minFilter = undefined;
        this.needsUpdate = false;
    }
    dispose() { this.disposeCalls += 1; }
}
export class Texture extends CanvasTexture {}

export default {
    TorusGeometry, TetrahedronGeometry, Color, MeshBasicMaterial, Mesh,
    AdditiveBlending, NormalBlending, NearestFilter, LinearFilter, RepeatWrapping,
    CanvasTexture, Texture
};
