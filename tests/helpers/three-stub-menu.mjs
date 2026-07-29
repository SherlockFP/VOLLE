// tests/helpers/three-stub-menu.mjs — re-exports the shared three-stub.mjs with the
// additional exports js/menu-stage.js needs. Mirrors the three-stub-extended.mjs pattern
// (procedural-textures.test.mjs) so the shared stub stays unmodified and zero-risk to
// other suites while menu-stage.test.mjs gets the primitives it needs.
export * from './three-stub.mjs';
import { Color } from './three-stub.mjs';

class DisposableGeometry {
    constructor(...args) {
        this.args = args;
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}

class DisposableMaterial {
    constructor(options = {}) {
        Object.assign(this, options);
        this.color = new Color(typeof options.color === 'number' ? options.color : 0xffffff);
        this.disposeCalls = 0;
    }
    dispose() { this.disposeCalls += 1; }
}

// Octahedra for the drifting background shapes -- the base stub only ships
// Box/Sphere/Cylinder/Torus (character-rig/shop-showcase never needed more).
export class OctahedronGeometry extends DisposableGeometry {}

// Toon-shaded floor/shapes/ball -- keeps the stage on the shipped toon art
// direction instead of falling back to a standard/basic material.
export class MeshToonMaterial extends DisposableMaterial {}

// Linear fog so the low-poly arena's edges fade into the theme background color.
export class Fog {
    constructor(color, near = 1, far = 1000) {
        this.color = new Color(color);
        this.near = near;
        this.far = far;
    }
}
