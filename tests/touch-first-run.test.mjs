// A phone's first run is the welcome card + guided drill. Touch players get touch
// control copy (not WASD / clicks), and the Practice Lab readout stays clear of
// the right-hand action buttons (it used to sit under Deflect/Stab/Skill/R/F).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import en from '../js/locales/en.js';
import tr from '../js/locales/tr.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/touch.css', import.meta.url), 'utf8');

test('each welcome tip has a touch variant in EN and TR, shown only in touch mode', () => {
    for (const key of ['moveCopy', 'deflectCopy', 'meleeCopy']) {
        assert.match(html, new RegExp(`class="ftue-copy-keys" data-i18n="ftue\\.${key}"`));
        assert.match(html, new RegExp(`class="ftue-copy-touch" data-i18n="ftue\\.${key}Touch"`));
        for (const table of [en, tr]) {
            const copy = table.ftue[`${key}Touch`];
            assert.ok(copy, `ftue.${key}Touch`);
            assert.doesNotMatch(copy, /WASD|click|tık|\bCtrl\b|\bSpace\b/i);
        }
    }
    assert.match(css, /\.ftue-copy-touch \{ display: none; \}/);
    assert.match(css, /body\.touch-controls-on \.ftue-copy-keys \{ display: none; \}/);
    assert.match(css, /body\.touch-controls-on \.ftue-copy-touch \{ display: block; \}/);
});

test('touch Practice Lab readout sits between the vitals and the R/F button column', () => {
    const rule = css.match(/body\.touch-controls-on \.practice-lab-hud \{([^}]*)\}/)?.[1] || '';
    assert.match(rule, /--pl-reserve-right: calc\(214px \* var\(--touch-scale, 1\)/);
    assert.match(rule, /left: clamp\(172px, calc\(50% - var\(--pl-w\) \/ 2\), calc\(100vw - var\(--pl-reserve-right\) - var\(--pl-w\)\)\);/);
    assert.match(rule, /right: auto;/);
});

test('short landscape touch screens keep the ultimate ring centered, off the JUMP button', () => {
    assert.match(css, /body\.touch-controls-on #ultimate-hud \{ left: 50%; right: auto; bottom: 8px;/);
});
