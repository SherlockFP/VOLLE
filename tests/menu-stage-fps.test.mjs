import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeUrl = new URL('./helpers/three-stub-menu.mjs', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});
const { createMenuStage } = await import('../js/menu-stage.js');

function setup(t) {
    const media = Object.assign(new EventTarget(), { matches: false });
    const window = Object.assign(new EventTarget(), {
        innerWidth: 640, innerHeight: 480, devicePixelRatio: 1,
        matchMedia: () => media,
        getComputedStyle: () => ({ getPropertyValue: () => '' })
    });
    const document = Object.assign(new EventTarget(), { hidden: false, documentElement: {} });
    const canvas = { tagName: 'CANVAS', clientWidth: 640, clientHeight: 480 };
    const preview = createMenuStage({ canvas, document, window, autoStart: false });
    t.after(() => preview.dispose());
    return { preview, document };
}

test('menu Unlimited uses 60 decorative draws while explicit 1 and 30 FPS keep their budgets', t => {
    for (const [limit, expected] of [[0, 60], ['0', 60], [1, 1], ['1', 1], [30, 30], [144, 60]]) {
        for (const sourceHz of [60, 144, 240]) {
            const { preview } = setup(t);
            assert.equal(preview.setFrameLimit(limit), expected);
            preview.start();
            preview.renderer.renderCount = 0;
            for (let frame = 0; frame < sourceHz; frame++) preview.renderer.loop(frame * 1000 / sourceHz);
            assert.equal(preview.renderer.renderCount, expected, `${limit} at ${sourceHz} Hz`);
        }
    }
});

test('changing menu cap from 1 to Unlimited removes the stale deadline without absorbing a pause', t => {
    const { preview, document } = setup(t);
    preview.setFrameLimit(1);
    preview.start();
    preview.renderer.loop(0);
    preview.renderer.loop(100);
    const phase = preview._elapsed;
    const draws = preview.renderer.renderCount;
    preview.setFrameLimit(0);
    assert.equal(preview.renderer.renderCount, draws);
    preview.renderer.loop(110);
    assert.equal(preview._elapsed, phase);
    preview.renderer.loop(130);
    assert.equal(preview.renderer.renderCount, draws + 2);
    preview.setReducedMotion(true);
    preview.setFrameLimit(0);
    assert.equal(preview.renderer.loop, null, 'Unlimited never overrides accessibility');
    preview.setReducedMotion(false);
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    preview.setFrameLimit(0);
    assert.equal(preview.renderer.loop, null, 'Unlimited does not start a hidden preview');
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const resumedPhase = preview._elapsed;
    preview.renderer.loop(10_000);
    assert.equal(preview._elapsed, resumedPhase);
    preview.stop();
    preview.setFrameLimit(0);
    assert.equal(preview.renderer.loop, null, 'Unlimited does not restart a stopped preview');
});

test('menu missing or nonpositive FPS settings fall back without changing positive fractional caps', t => {
    const { preview } = setup(t);
    for (const value of [undefined, null, '', NaN, Infinity, -Infinity, -30, 'invalid']) {
        assert.equal(preview.setFrameLimit(value), 60);
    }
    for (const [value, expected] of [[.5, 1], [1.9, 1], [30.9, 30], [60, 60], [240, 60]]) {
        assert.equal(preview.setFrameLimit(value), expected);
    }
});
