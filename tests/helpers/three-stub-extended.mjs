// tests/helpers/three-stub-extended.mjs — re-exports the shared three-stub.mjs with
// additionalexports needed by tests/procedural-textures.test.mjs. This keeps the shared
// stub unmodified and zero-risk to other test suites.
export * from './three-stub.mjs';

// Texture wrapping modes for RepeatWrapping support in procedural-textures tests.
export const RepeatWrapping = 'RepeatWrapping';
export const ClampToEdgeWrapping = 'ClampToEdgeWrapping';

// Mipmap filter variants so CanvasTexture setup is testable.
export const NearestMipmapLinearFilter = 'NearestMipmapLinearFilter';
export const NearestMipmapNearestFilter = 'NearestMipmapNearestFilter';
export const LinearMipmapLinearFilter = 'LinearMipmapLinearFilter';
export const LinearMipmapNearestFilter = 'LinearMipmapNearestFilter';

// Additive to the stub's Texture: CanvasTexture is just a Texture that also holds a canvas.
// The stub's base Texture tracks dispose calls, so this inherits that behavior.
export class CanvasTexture {
    constructor(canvas) {
        this.isCanvasTexture = true;
        this.isTexture = true;
        this.canvas = canvas;
        this.disposeCalls = 0;
        this.colorSpace = undefined;
        this.wrapS = undefined;
        this.wrapT = undefined;
        this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
        this.magFilter = undefined;
        this.minFilter = undefined;
        this.anisotropy = 1;
        this.needsUpdate = false;
    }
    dispose() { this.disposeCalls += 1; }
}
