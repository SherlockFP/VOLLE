// tests/menu-stage.test.mjs — regression coverage for js/menu-stage.js (the full-viewport
// Three.js backdrop behind the main menu). Loads the real module via a local module-hooks
// redirect to tests/helpers/three-stub-menu.mjs (three-stub.mjs + the few extra primitives
// this scene needs), mirroring tests/procedural-textures.test.mjs's own-stub pattern instead
// of touching the shared three-stub.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const STUB_URL = new URL('./helpers/three-stub-menu.mjs', import.meta.url).href;
let stubRegistered = false;
function registerStub() {
    if (stubRegistered) return;
    stubRegistered = true;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === 'three') {
                return { url: STUB_URL, shortCircuit: true };
            }
            return nextResolve(specifier, context);
        }
    });
}
registerStub();

const { createMenuStage, resolveMenuStageTheme, ballPathAt, STAGE_FALLBACK } = await import('../js/menu-stage.js');

class FakeTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        FakeMutationObserver.instances.push(this);
    }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ type: 'attributes', attributeName: 'data-theme' }], this); }
}
FakeMutationObserver.instances = [];

function fakeBrowser({ reducedMotion = false, tokens = {} } = {}) {
    const media = new FakeTarget();
    media.matches = reducedMotion;
    const window = new FakeTarget();
    window.devicePixelRatio = 2;
    window.innerWidth = 1280;
    window.innerHeight = 720;
    window.matchMedia = () => media;
    window.MutationObserver = FakeMutationObserver;
    const tokenMap = { ...tokens };
    const computedStyle = { getPropertyValue: token => tokenMap[token] || '' };
    window.getComputedStyle = () => computedStyle;
    const document = new FakeTarget();
    document.defaultView = window;
    document.hidden = false;
    document.documentElement = new FakeTarget();
    document.documentElement.tagName = 'HTML';
    const canvas = new FakeTarget();
    canvas.tagName = 'CANVAS';
    canvas.ownerDocument = document;
    canvas.style = {};
    canvas.clientWidth = 1280;
    canvas.clientHeight = 720;
    canvas.getBoundingClientRect = () => ({ width: 1280, height: 720 });
    return { canvas, document, window, media, tokenMap };
}

test('resolveMenuStageTheme parses hex, rgba, and gradient tokens, and falls back per-token', () => {
    const theme = resolveMenuStageTheme(token => ({
        '--ui-bg': '#140b07',
        '--ui-menu-accent': '#ffa53c',
        '--ui-menu-glow-a': 'rgba(255, 122, 48, 0.22)',
        '--ui-menu-stage': 'linear-gradient(145deg, rgba(58, 30, 18, 0.9), rgba(24, 11, 6, 0.94))'
        // --ui-menu-glow-b intentionally omitted -> must degrade to the fallback, not black.
    }[token] || ''));
    assert.equal(theme.bg, 0x140b07);
    assert.equal(theme.accent, 0xffa53c);
    assert.equal(theme.glowA, 0xff7a30);
    assert.equal(theme.stage, 0x3a1e12, 'gradient token resolves to its first color stop');
    assert.equal(theme.glowB, STAGE_FALLBACK.glowB);
});

test('resolveMenuStageTheme never throws on a hostile reader and returns the full shipped fallback palette', () => {
    const theme = resolveMenuStageTheme(() => { throw new Error('boom'); });
    assert.deepEqual(theme, STAGE_FALLBACK);
});

test('reduced motion renders exactly one static frame and never starts an animation loop', () => {
    const { canvas, document, window } = fakeBrowser({ reducedMotion: true });
    const stage = createMenuStage({ canvas, window, document });
    assert.equal(stage.renderer.loop, null);
    assert.ok(stage.renderer.renderCount >= 1, 'a static frame was still drawn');
    stage.dispose();
});

test('document.hidden pauses the animation loop and resumes when visible again', () => {
    const { canvas, document, window } = fakeBrowser();
    const stage = createMenuStage({ canvas, window, document });
    assert.equal(typeof stage.renderer.loop, 'function', 'menu is visible: loop runs');

    document.hidden = true;
    document.dispatch('visibilitychange');
    assert.equal(stage.renderer.loop, null, 'tab hidden: loop stops');

    document.hidden = false;
    document.dispatch('visibilitychange');
    assert.equal(typeof stage.renderer.loop, 'function', 'tab visible again: loop resumes');

    stage.dispose();
});

test('dispose releases every tracked geometry and material exactly once', () => {
    const { canvas, document, window } = fakeBrowser();
    const stage = createMenuStage({ canvas, window, document });
    const before = stage.getStats();
    assert.ok(before.geometriesCreated > 0);
    assert.ok(before.materialsCreated > 0);
    assert.equal(before.geometriesDisposed, 0);
    assert.equal(before.materialsDisposed, 0);

    stage.dispose();
    const after = stage.getStats();
    assert.equal(after.geometriesDisposed, before.geometriesCreated);
    assert.equal(after.materialsDisposed, before.materialsCreated);
    assert.equal(stage.renderer.disposed, true);
    assert.equal(stage._floorMaterial.disposeCalls, 1);
    assert.equal(stage._ballMaterial.disposeCalls, 1);
});

test('observing a data-theme mutation re-resolves the palette and repaints tracked materials', () => {
    const { canvas, document, window, tokenMap } = fakeBrowser({
        tokens: { '--ui-menu-accent': '#5ee7f7', '--ui-bg': '#06151b', '--ui-menu-stage': '#1c3a48' }
    });
    const stage = createMenuStage({ canvas, window, document });
    assert.equal(stage._ballMaterial.color.hex, 0x5ee7f7);

    tokenMap['--ui-menu-accent'] = '#ffa53c';
    const observer = FakeMutationObserver.instances.at(-1);
    observer.trigger();

    assert.equal(stage._ballMaterial.color.hex, 0xffa53c);
    assert.equal(stage._ringMaterial.color.hex, 0xffa53c);
    stage.dispose();
});

test('ballPathAt is a pure seeded function: same seed+t always matches, different seeds diverge', () => {
    const a1 = ballPathAt(12.5);
    const a2 = ballPathAt(12.5);
    assert.deepEqual(a1, a2);

    const b1 = ballPathAt(12.5, 777);
    assert.notDeepEqual(a1, b1);

    for (const point of [a1, b1, ballPathAt(0), ballPathAt(500, 999)]) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    }
});

test('scene-build instrumentation matches the documented draw-call and triangle budget', () => {
    const { canvas, document, window } = fakeBrowser();
    const stage = createMenuStage({ canvas, window, document });
    const stats = stage.getStats();
    assert.equal(stats.drawCalls, 20);
    assert.equal(stats.triangleEstimate, 544);
    assert.equal(stats.geometriesCreated, 6);
    assert.equal(stats.materialsCreated, 15);
    stage.dispose();
});

test('resize caps pixel ratio at 1.5 and shrinks further under the backing-pixel budget on huge screens', () => {
    const { canvas, document, window } = fakeBrowser();
    window.devicePixelRatio = 3;
    window.innerWidth = 3840;
    window.innerHeight = 2160;
    const stage = createMenuStage({ canvas, window, document });
    const result = stage.resize();
    assert.ok(result.pixelRatio <= 1.5, 'DPR is capped at 1.5 regardless of the real device ratio');
    const backingPixels = result.width * result.height * result.pixelRatio * result.pixelRatio;
    assert.ok(backingPixels <= 1280 * 900 + 1, '4K screens are scaled back down to the pixel budget');
    stage.dispose();
});
