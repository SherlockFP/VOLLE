// tests/edge-flash.test.mjs — covers the docs/V3_GAMEPLAY.md requirement
// ("No full-screen flash hiding the trajectory"): js/juice.js's flash() must
// still expose the same amt-only API/call sites, but drive an edge-only
// vignette (js/ui.js#updateFlash + css/polish.css's .juice-flash override)
// instead of a full-screen white wash that could hide the ball/crosshair on
// back-to-back kills.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// juice.js (and its TrailRibbon.js dependency) import the bare specifier
// 'three'. The repo's shared tests/helpers/three-stub.mjs is hand-written for
// character-rig coverage and doesn't implement RingGeometry/TetrahedronGeometry/
// BufferGeometry/ShaderMaterial, which juice.js and TrailRibbon.js both need.
// Redirect to the real vendor module instead (same file volleyball-playtest.test.mjs
// imports directly) so Juice can be constructed for real behavioral assertions.
const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});

const { Juice } = await import('../js/juice.js');

test('juice.flash(amt) keeps the existing one-arg API and infers kill vs generic tint from amt', () => {
    const j = new Juice(null, null);
    assert.equal(j.flashAmt, 0);
    assert.equal(j.flashKind, 'generic');

    // game.js's kill flash is flash(0.55) — an unchanged one-arg call site.
    j.flash(0.55);
    assert.equal(j.flashAmt, 0.55);
    assert.equal(j.flashKind, 'kill', 'amt >= 0.4 should read as a kill-tint pulse');

    j.reset();
    assert.equal(j.flashAmt, 0);
    assert.equal(j.flashKind, 'generic', 'reset() must clear the tint back to generic');

    // js/juice.js's own hitBurst() call site: flash(0.12).
    j.flash(0.12);
    assert.equal(j.flashKind, 'generic', 'amt < 0.4 should read as a generic/white pulse');
});

test('juice.flash() explicit kind overrides the amt heuristic without breaking the amt-only signature', () => {
    const j = new Juice(null, null);
    j.flash(0.2, 'kill');
    assert.equal(j.flashKind, 'kill');
    assert.equal(j.flashAmt, 0.2);
});

test('an overlapping smaller pulse cannot downgrade an in-flight kill flash (mirrors the Math.max on flashAmt)', () => {
    const j = new Juice(null, null);
    j.flash(0.55); // kill
    j.flash(0.1);  // generic-sized hit flash arriving mid-decay
    assert.equal(j.flashAmt, 0.55, 'flashAmt keeps the running peak');
    assert.equal(j.flashKind, 'kill', 'kind must not flicker back to generic while the bigger pulse is still active');
});

test('screenFlashEnabled=false suppresses flash() entirely, same as before', () => {
    const j = new Juice(null, null);
    j.screenFlashEnabled = false;
    j.flash(0.9);
    assert.equal(j.flashAmt, 0);
    assert.equal(j.flashKind, 'generic');
});

test('js/ui.js#updateFlash renders an edge-only vignette: no more Math.min(0.6, amt) full-screen opacity, and tints via a rising-edge dataset flag', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'js', 'ui.js'), 'utf8');
    const start = source.indexOf('updateFlash(amt) {');
    assert.notEqual(start, -1, 'updateFlash(amt) must exist with the original one-arg signature');
    const end = source.indexOf('\n    }', start);
    const body = source.slice(start, end);

    assert.doesNotMatch(body, /Math\.min\(0\.6/, 'must not clamp to the old 0.6 full-screen opacity ceiling');
    assert.match(body, /Math\.min\(0\.5,\s*amt\)/, 'edge vignette should clamp opacity to ~0.5 max');
    assert.match(body, /dataset\.tint/, 'must set a tint flag for CSS to key off (kill vs generic)');
    assert.match(body, /amt >= 0\.4/, 'kill-tint threshold should match juice.js\'s own >=0.4 heuristic');
});

test('css/polish.css overrides .juice-flash with a transparent-center radial vignette, not a full-screen wash', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'css', 'polish.css'), 'utf8');
    const ruleStart = css.indexOf('.juice-flash {');
    assert.notEqual(ruleStart, -1, 'polish.css must define its own .juice-flash rule (loaded after css/style.css)');
    const ruleEnd = css.indexOf('}', ruleStart);
    const rule = css.slice(ruleStart, ruleEnd);

    assert.match(rule, /rgba\(255,255,255,0\)\s*55%/, 'center must stay fully transparent through ~55% radius');
    assert.match(rule, /radial-gradient/, 'must remain a radial vignette, not a flat full-screen fill');
    assert.match(css, /\.juice-flash\[data-tint="kill"\]/, 'kill pulses must get a distinct (warm) rim tint rule');
    // Fast decay per the design ask (~180ms), and reduced-motion should disable the transition.
    assert.match(rule, /transition:\s*opacity\s*180ms/);
    assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*{\s*\.juice-flash\s*{\s*transition:\s*none;/);
});

test('css load order: polish.css is included after style.css so its .juice-flash rule wins the cascade', () => {
    const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const styleIdx = html.indexOf('css/style.css');
    const polishIdx = html.indexOf('css/polish.css');
    assert.ok(styleIdx !== -1 && polishIdx !== -1, 'both stylesheets must be linked from index.html');
    assert.ok(polishIdx > styleIdx, 'polish.css must load after style.css for the .juice-flash override to take effect');
});
