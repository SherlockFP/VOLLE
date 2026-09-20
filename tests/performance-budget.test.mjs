import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const THREE_STUB_URL = new URL('./helpers/three-stub-menu.mjs', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_STUB_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});

const { ReplayClass, interpolateReplaySnapshots } = await import('../js/replay.js');
const { createMenuStage } = await import('../js/menu-stage.js');
const { createShopShowcase } = await import('../js/shop-showcase.js');

class FakeTarget {
    constructor() {
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
    }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
    setPointerCapture() {}
    releasePointerCapture() {}
}

function fakeBrowser({ width = 640, height = 480, dpr = 2 } = {}) {
    const media = new FakeTarget();
    media.matches = false;
    const window = new FakeTarget();
    window.innerWidth = width;
    window.innerHeight = height;
    window.devicePixelRatio = dpr;
    window.matchMedia = () => media;
    window.getComputedStyle = () => ({ getPropertyValue: () => '' });
    const document = new FakeTarget();
    document.defaultView = window;
    document.hidden = false;
    document.documentElement = new FakeTarget();
    document.documentElement.tagName = 'HTML';
    const canvas = new FakeTarget();
    canvas.tagName = 'CANVAS';
    canvas.ownerDocument = document;
    canvas.clientWidth = width;
    canvas.clientHeight = height;
    return { canvas, document, media, window };
}

function sampleIdleDraws(createRenderer, hz) {
    const preview = createRenderer();
    preview.start();
    preview.renderer.renderCount = 0;
    for (let frame = 0; frame < hz; frame++) preview.renderer.loop(frame * 1000 / hz);
    const draws = preview.renderer.renderCount;
    preview.dispose();
    return draws;
}

test('replay snapshot due gate is reset-safe, rejects backwards time, and limits construction to 8 Hz', () => {
    let now = 0;
    const replay = new ReplayClass({ now: () => now });
    replay.startRecording();
    assert.equal(replay.isSnapshotDue(), true);
    replay.recordSnapshot({});
    now = 124;
    assert.equal(replay.isSnapshotDue(), false);
    now = 125;
    assert.equal(replay.isSnapshotDue(), true);
    replay.recordSnapshot({});
    now = 100;
    assert.equal(replay.isSnapshotDue(), false, 'a backwards clock cannot reopen the snapshot gate');
    replay.startRecording();
    assert.equal(replay.isSnapshotDue(), true, 'a fresh recording resets the gate');
    replay.stopRecording();
    assert.equal(replay.isSnapshotDue(), false);

    const constructions = [60, 144, 240].map(hz => {
        now = 0;
        replay.startRecording();
        let count = 0;
        for (let frame = 0; frame < hz; frame++) {
            now = frame * 1000 / hz;
            if (!replay.isSnapshotDue()) continue;
            count += 1; // The main loop only builds the expensive snapshot in this branch.
            replay.recordSnapshot({});
        }
        return count;
    });
    assert.deepEqual(constructions, [8, 8, 8]);
});

test('replay yaw interpolation crosses the negative-pi boundary on the short path', () => {
    const degrees = Math.PI / 180;
    const snapshot = interpolateReplaySnapshots(
        { players: [{ id: 'p', x: 0, y: 0, z: 0, yaw: 179 * degrees }], camera: { position: { x: 0, y: 0, z: 0 }, yaw: 179 * degrees } },
        { players: [{ id: 'p', x: 0, y: 0, z: 0, yaw: -179 * degrees }], camera: { position: { x: 0, y: 0, z: 0 }, yaw: -179 * degrees } },
        .5
    );
    // Snapshot normalization persists angles to two decimals, so compare at that stored precision.
    assert.ok(Math.abs(Math.abs(snapshot.players[0].yaw) - Math.PI) < .01);
    assert.ok(Math.abs(Math.abs(snapshot.camera.yaw) - Math.PI) < .01);
});

test('idle preview loops draw 60 frames in one simulated second at 60, 144, and 240 Hz', () => {
    const menuDraws = [60, 144, 240].map(hz => sampleIdleDraws(() => {
        const browser = fakeBrowser();
        return createMenuStage({ ...browser, autoStart: false });
    }, hz));
    const shopDraws = [60, 144, 240].map(hz => sampleIdleDraws(() => {
        const browser = fakeBrowser();
        return createShopShowcase(browser.canvas, { autoStart: false });
    }, hz));
    assert.deepEqual(menuDraws, [60, 60, 60]);
    assert.deepEqual(shopDraws, [60, 60, 60]);
});

test('preview frame limits honor 30 FPS and clamp decorative requests to 60 FPS', () => {
    const sample = (createRenderer, limit, sourceHz) => {
        const preview = createRenderer();
        assert.equal(preview.setFrameLimit(limit), Math.min(60, Math.max(1, Math.floor(limit))));
        preview.start();
        preview.renderer.renderCount = 0;
        for (let frame = 0; frame < sourceHz; frame++) preview.renderer.loop(frame * 1000 / sourceHz);
        const draws = preview.renderer.renderCount;
        preview.dispose();
        return draws;
    };
    const menu30 = [30, 60, 144, 240].map(hz => sample(() => {
        const browser = fakeBrowser();
        return createMenuStage({ ...browser, autoStart: false });
    }, 30, hz));
    const shop30 = [30, 60, 144, 240].map(hz => sample(() => {
        const browser = fakeBrowser();
        return createShopShowcase(browser.canvas, { autoStart: false });
    }, 30, hz));
    assert.deepEqual(menu30, [30, 30, 30, 30]);
    assert.deepEqual(shop30, [30, 30, 30, 30]);
    for (const createRenderer of [
        () => { const browser = fakeBrowser(); return createMenuStage({ ...browser, autoStart: false }); },
        () => { const browser = fakeBrowser(); return createShopShowcase(browser.canvas, { autoStart: false }); }
    ]) {
        const preview = createRenderer();
        assert.equal(preview.setFrameLimit(999), 60);
        assert.equal(preview.setFrameLimit('invalid'), 60);
        preview.dispose();
    }
});

test('preview clocks reset across reduced motion, visibility, and start-stop while drag stays immediate', () => {
    const browser = fakeBrowser();
    const shop = createShopShowcase(browser.canvas, { autoStart: false });
    shop.start();
    shop.renderer.loop(0);
    shop.renderer.loop(1000 / 60);
    const elapsed = shop._elapsed;

    shop.setReducedMotion(true);
    assert.equal(shop.renderer.loop, null);
    shop.setReducedMotion(false);
    shop.renderer.loop(5000);
    assert.equal(shop._elapsed, elapsed, 'resuming does not absorb paused wall time');

    browser.document.hidden = true;
    browser.document.dispatch('visibilitychange');
    assert.equal(shop.renderer.loop, null);
    browser.document.hidden = false;
    browser.document.dispatch('visibilitychange');
    shop.renderer.loop(10_000);
    assert.equal(shop._elapsed, elapsed, 'visibility resume resets the animation clock');

    shop.stop();
    shop.start();
    shop.renderer.loop(15_000);
    assert.equal(shop._elapsed, elapsed, 'restart resets the animation clock');

    shop.renderer.renderCount = 0;
    browser.canvas.dispatch('pointerdown', { clientX: 1, clientY: 1, pointerId: 1 });
    browser.canvas.dispatch('pointermove', { clientX: 8, clientY: 1, pointerId: 1 });
    assert.equal(shop.renderer.renderCount, 1, 'drag renders immediately without waiting for the idle cadence');
    shop.dispose();
});

test('shop preview backing buffer stays within the 1280x900 pixel budget', () => {
    const browser = fakeBrowser({ width: 3840, height: 2160, dpr: 2 });
    const shop = createShopShowcase(browser.canvas, { autoStart: false });
    const size = shop.resize(3840, 2160);
    assert.ok(size.width * size.height * size.pixelRatio * size.pixelRatio <= 1280 * 900 + 1);
    shop.dispose();
});
