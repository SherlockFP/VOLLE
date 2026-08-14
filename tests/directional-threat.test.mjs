import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function extractDirectionSampler(source) {
    const start = source.indexOf('export function sampleThreatDirection(');
    const end = source.indexOf('\n}\n\n// Ball uses positive Infinity', start);
    assert.ok(start >= 0 && end > start, 'direction sampler must remain independently testable');
    const declaration = source.slice(start, end + 2).replace('export function', 'function');
    return Function(`"use strict"; ${declaration}; return sampleThreatDirection;`)();
}

test('camera-relative threat direction distinguishes front, left, right and rear', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const sample = extractDirectionSampler(source);
    const out = {};

    assert.equal(sample(out, 0, -1, 0, -10).direction, 'front');
    assert.equal(out.side, 0);
    assert.equal(out.behind, false);
    assert.equal(out.offscreen, false);

    assert.equal(sample(out, 0, -1, -10, 0).direction, 'left');
    assert.equal(out.side, -1);
    assert.equal(out.offscreen, true);

    assert.equal(sample(out, 0, -1, 10, 0).direction, 'right');
    assert.equal(out.side, 1);
    assert.equal(out.offscreen, true);

    assert.equal(sample(out, 0, -1, 0, 10).direction, 'rear');
    assert.equal(out.behind, true);
    assert.equal(out.offscreen, true);
});

test('direction sampler mutates one caller-owned result and handles degenerate input', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const sample = extractDirectionSampler(source);
    const out = { side: 9, behind: true, offscreen: true, direction: 'rear' };
    assert.equal(sample(out, 0, 0, 0, 0), out);
    assert.deepEqual(out, { side: 0, behind: false, offscreen: false, direction: 'front' });

    const body = source.slice(
        source.indexOf('    updatePlayerThreat(dt) {'),
        source.indexOf('\n    updatePlaying(dt) {')
    );
    assert.doesNotMatch(body, /new THREE\.|\.clone\(/);
});

test('directional indicator exposes one accessible DOM arrow and safe desktop/mobile edge lanes', async () => {
    const [html, ui, css] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
        readFile(new URL('../css/polish.css', import.meta.url), 'utf8')
    ]);

    assert.equal((html.match(/class="incoming-direction-arrow"/g) || []).length, 1);
    assert.match(html, /id="incoming-indicator"[^>]*aria-hidden="true"[^>]*aria-label=/);
    assert.match(ui, /dataset\.direction = threat\.direction/);
    assert.match(ui, /dataset\.perfect = String\(threat\.active && threat\.perfectWindow\)/);
    assert.match(ui, /previousLevel !== threat\.level \|\| previousDirection !== threat\.direction/);
    assert.match(ui, /Incoming ball from \$\{ariaDirection\}/);
    assert.match(ui, /--threat-scale/);
    assert.match(ui, /--threat-pulse/);
    assert.match(css, /#incoming-indicator\[data-perfect="true"\][^{]*\{[^}]*255,214,71/s);
    assert.match(css, /#incoming-indicator\[data-direction="left"\][^{]*\.incoming-direction-arrow\s*\{[^}]*left:\s*24px/s);
    assert.match(css, /#incoming-indicator\[data-direction="right"\][^{]*\.incoming-direction-arrow\s*\{[^}]*left:\s*calc\(100vw - 24px\)/s);
    assert.match(css, /#incoming-indicator\[data-direction="rear"\][^{]*\.incoming-direction-arrow\s*\{[^}]*bottom:\s*96px/s);

    const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
    assert.match(mobile, /data-direction="left"[^}]*left:\s*14px/s);
    assert.match(mobile, /data-direction="right"[^}]*left:\s*calc\(100vw - 14px\)/s);
    assert.match(mobile, /data-direction="rear"[^}]*top:\s*36%[^}]*bottom:\s*auto[^}]*left:\s*14px/s);

    const desktopWidth = 1440;
    const mobileWidth = 375;
    const mobileHeight = 812;
    const mobileRearCenterY = mobileHeight * 0.36;
    const mobileRearTop = mobileRearCenterY - 7;
    const mobileRearBottom = mobileRearCenterY + 7;
    assert.ok(24 > 0 && desktopWidth - 24 < desktopWidth, '1440px arrows stay inside the viewport');
    assert.ok(14 > 0 && mobileWidth - 14 < mobileWidth, '375px arrows stay inside the viewport');
    assert.ok(mobileRearTop > 140, 'mobile rear arrow clears score, incoming label and upper status lane');
    assert.ok(mobileRearBottom < 390, 'mobile rear arrow stays above center-safe and chat lanes');
    assert.ok(14 < 32, 'mobile rear arrow remains in the left edge-safe lane, outside the reticle');
    assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.incoming-direction-arrow[^}]*animation:\s*none !important/);
});
