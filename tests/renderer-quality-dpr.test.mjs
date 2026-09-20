import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Use the shipped Three.js/composer implementations. Only the WebGL context is
// replaced: render-target dimensions are inspectable without a GPU or browser.
const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') {
            return { url: new URL('../vendor/three/three.module.js', import.meta.url).href, shortCircuit: true };
        }
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`../vendor/${specifier}`, import.meta.url).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
let Renderer;
let THREE;
try {
    ({ Renderer } = await import('../js/renderer.js'));
    THREE = await import('../vendor/three/three.module.js');
} finally {
    hooks.deregister();
}

function fixture(t, devicePixelRatio = 2) {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio };
    const gl = {
        width: 1280, height: 720, ratio: Math.min(devicePixelRatio, 2), shadowMap: {},
        getSize(target) { return target.set(this.width, this.height); },
        getPixelRatio() { return this.ratio; },
        setPixelRatio(value) { this.ratio = value; },
        setSize(width, height) { this.width = width; this.height = height; }
    };
    const renderer = Object.assign(Object.create(Renderer.prototype), {
        renderer: gl, scene: new THREE.Scene(), _composer: null, _camera: null, _bloom: null,
        _bloomProfile: { ...Renderer.DEFAULT_BLOOM_PROFILE },
        _quality: 'medium', _hubPerformanceMode: false, _qualityPixelRatioCap: 1.5,
        _renderScale: 1, _targetResolution: null, _viewport: { width: 1280, height: 720 }
    });
    t.after(() => {
        for (const pass of renderer._composer?.passes || []) pass.dispose?.();
        renderer._composer?.dispose();
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    });
    return renderer;
}

function assertTargets(renderer, ratio) {
    const width = renderer.renderer.width * ratio;
    const height = renderer.renderer.height * ratio;
    assert.equal(renderer.renderer.getPixelRatio(), ratio);
    for (const target of [renderer._composer.renderTarget1, renderer._composer.renderTarget2]) {
        assert.equal(target.width, width, 'composer target width must match drawing-buffer DPR');
        assert.equal(target.height, height, 'composer target height must match drawing-buffer DPR');
    }
    assert.equal(renderer._bloom.renderTargetBright.width, Math.round(width / 2));
    assert.equal(renderer._bloom.renderTargetBright.height, Math.round(height / 2));
}

test('lazy composer initialization follows the default medium DPR instead of initial device DPR', t => {
    const renderer = fixture(t);
    renderer._initComposer(new THREE.PerspectiveCamera());
    assertTargets(renderer, 1.5);
});

test('quality changes resize the existing scene and bloom targets without rebuilding the composer', t => {
    const renderer = fixture(t);
    renderer._initComposer(new THREE.PerspectiveCamera());
    const composer = renderer._composer;
    const target = composer.renderTarget1;
    for (const [quality, ratio] of [['high', 2], ['low', 1], ['medium', 1.5], ['high', 2]]) {
        renderer.setQuality(quality);
        assertTargets(renderer, ratio);
        assert.equal(renderer._composer, composer);
        assert.equal(composer.renderTarget1, target);
        assert.equal(renderer._bloom.enabled, quality !== 'low');
        assert.equal(renderer.renderer.shadowMap.enabled, quality !== 'low');
    }
});

test('render scale and explicit resolution update scene and bloom backing sizes together', t => {
    const renderer = fixture(t);
    renderer.setQuality('high');
    renderer._initComposer(new THREE.PerspectiveCamera());
    renderer.setRenderScale(0.5);
    assertTargets(renderer, 1);
    renderer.setRenderScale(1);
    renderer.setResolutionTarget(640, 360);
    assertTargets(renderer, 0.5);
    renderer.setRenderScale(0.5);
    assertTargets(renderer, 0.25);
    renderer.setResolutionTarget(null, null);
    assertTargets(renderer, 1);
});

test('resize recomputes target-resolution DPR and responds to a different display DPR', t => {
    const renderer = fixture(t);
    renderer.setQuality('high');
    renderer._initComposer(new THREE.PerspectiveCamera());
    renderer.setResolutionTarget(1280, 720);
    renderer.updateSize(2560, 1440);
    assertTargets(renderer, 0.5);
    renderer.updateSize(640, 360);
    assertTargets(renderer, 2);
    window.devicePixelRatio = 1.25;
    renderer.setResolutionTarget(null, null);
    renderer.updateSize(1280, 720);
    assertTargets(renderer, 1.25);
});

test('settings applied before the first frame initialize the composer at their final resolution', t => {
    const renderer = fixture(t);
    renderer.setQuality('low');
    renderer.setResolutionTarget(640, 360);
    renderer.setRenderScale(0.5);
    renderer.updateSize(1920, 1080);
    renderer._initComposer(new THREE.PerspectiveCamera());
    assertTargets(renderer, 1 / 6);
    assert.equal(renderer._bloom.enabled, false);
});

test('low quality and hub performance keep bloom off even with a map strength override', t => {
    const renderer = fixture(t);
    renderer.setQuality('high');
    renderer._initComposer(new THREE.PerspectiveCamera());
    renderer.setBloomProfile({ strength: 0.4 });
    assert.equal(renderer._bloom.enabled, true);
    renderer.setQuality('low');
    assertTargets(renderer, 1);
    assert.equal(renderer._bloom.enabled, false);
    assert.equal(renderer._bloom.strength, 0);
    renderer.setBloomProfile({ strength: 0.8 });
    assert.equal(renderer._bloom.enabled, false);
    renderer.setQuality('high');
    assert.equal(renderer._bloom.strength, 0.8);
    renderer.setHubPerformance(true);
    assert.equal(renderer._bloom.enabled, false);
    assertTargets(renderer, 2);
    renderer.setHubPerformance(false);
    assert.equal(renderer._bloom.enabled, true);
});
