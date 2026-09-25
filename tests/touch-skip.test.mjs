// Touch has no Space: JUMP skips a solo round end or the victory lap, the round-end
// and lap hints name the JUMP button on touch, and loading tips use touch wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TouchInputModel } from '../js/touch-controls.js';
import en from '../js/locales/en.js';
import tr from '../js/locales/tr.js';

test('JUMP asks to skip, then still jumps', () => {
    const calls = [];
    const player = { keys: {}, touchMove: { x: 0, y: 0 } };
    const model = new TouchInputModel(player, { onSkip: () => { calls.push('skip'); return true; } });
    assert.equal(model.pressButton('jump', 1), true);
    assert.deepEqual(calls, ['skip']);
    assert.equal(player.keys.Space, true);
    const other = new TouchInputModel({ keys: {}, touchMove: { x: 0, y: 0 }, pressPrimary() { return true; } }, { onSkip: () => { calls.push('wrong'); return true; } });
    other.pressButton('deflect', 2);
    assert.deepEqual(calls, ['skip'], 'only JUMP skips');
});

test('wiring: main routes the skip by state; hints name JUMP on touch', () => {
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(main, /onSkip: \(\) => \(this\.game\.state === STATES\.ROUND_END \? this\.game\.skipRoundEnd\?\.\(\) === true\s+: this\.game\.state === STATES\.CELEBRATION \? this\.game\.skipCelebration\?\.\(\) === true : false\)/);
    assert.match(game, /const skipKey = globalThis\.document\?\.body\?\.classList\?\.contains\('touch-controls-on'\) \? t\('touch\.jump'\) : 'Space';/);
    assert.match(game, /t\(`\$\{hintKey\}Touch`, \{ button: t\('touch\.jump'\) \}\)/);
    for (const table of [en, tr]) {
        assert.match(table.postgame.skipHintTouch, /\{button\}/);
        assert.match(table.postgame.peekHintTouch, /\{button\}/);
    }
});

test('touch loading tips never mention the mouse, Ctrl or right-click', () => {
    for (const table of [en, tr]) {
        for (const key of ['tip2Touch', 'tip4Touch', 'tip5Touch']) {
            assert.equal(typeof table.loading[key], 'string', key);
            assert.doesNotMatch(table.loading[key], /mouse|fare|Ctrl|right-click|sağ tık/i, key);
        }
    }
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /touchOnly = matchMedia\('\(pointer: coarse\)'\)\.matches && !matchMedia\('\(any-pointer: fine\)'\)\.matches;/);
});
