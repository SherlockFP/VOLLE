import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getDeflectPresentation } from '../js/deflect-presentation.js';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

function compileShowMessage(globals) {
    const start = uiSource.indexOf('    showMessage(text, duration = 2000');
    const bodyStart = uiSource.indexOf(') {', start) + 2;
    assert.ok(start >= 0 && bodyStart > start, 'UI.showMessage source is present');
    let depth = 0;
    for (let index = bodyStart; index < uiSource.length; index++) {
        if (uiSource[index] === '{') depth++;
        if (uiSource[index] === '}' && --depth === 0) {
            const method = uiSource.slice(start, index + 1);
            return runInNewContext(`({ ${method} }).showMessage`, globals);
        }
    }
    assert.fail('UI.showMessage source is incomplete');
}

test('local solo and P2P prediction classify the same 0/75/150ms presentation tiers', () => {
    assert.equal(getDeflectPresentation({ timingErrorMs: 0 }).tier, 'perfect');
    assert.equal(getDeflectPresentation({ timingErrorMs: 75 }).tier, 'great');
    assert.equal(getDeflectPresentation({ timingErrorMs: 150 }).tier, 'normal');
    assert.equal(getDeflectPresentation({ timingErrorMs: 0 }).duration, 1800);
    assert.equal(getDeflectPresentation({ timingErrorMs: 75, chain: 9 }).chain, 0, 'great never presents a fake x1 chain');
    assert.match(gameSource, /isClientCP[\s\S]*?_presentLocalDeflectResult\(getDeflectPresentation\(/);
    assert.match(gameSource, /const rawTimingErrorMs = this\.ball\.getPerfectTimingErrorMs\(\);[\s\S]*?_presentLocalDeflectResult\(\{/);
});

test('a perfect confirmation is durable and generic toasts cannot overwrite it', () => {
    const timerQueue = [];
    let now = 100;
    const classes = new Set(['hidden']);
    const el = {
        textContent: '',
        get offsetWidth() { return 1; },
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name))
        }
    };
    const timers = (callback, delay) => {
        const handle = { callback, delay, cleared: false };
        timerQueue.push(handle);
        return handle;
    };
    const showMessage = compileShowMessage({
        document: { getElementById: id => id === 'game-message' ? el : null },
        performance: { now: () => now },
        setTimeout: timers,
        clearTimeout: handle => { if (handle) handle.cleared = true; }
    });
    const ui = {};
    assert.equal(showMessage.call(ui, 'PERFECT DEFLECT!', 1800, { priority: 2, tone: 'deflect-perfect' }), true);
    now += 100;
    assert.equal(showMessage.call(ui, 'Rally 4', 750), false);
    assert.equal(el.textContent, 'PERFECT DEFLECT!');
    assert.equal(timerQueue[0].delay, 1800);
    now += 50;
    assert.equal(showMessage.call(ui, 'PERFECT DEFLECT! x2', 1800, { priority: 2, tone: 'deflect-perfect' }), true);
    timerQueue[0].callback();
    assert.equal(classes.has('hidden'), false, 'stale timer cannot hide the newer perfect toast');
    timerQueue[1].callback();
    assert.equal(classes.has('hidden'), true);
});

test('authoritative local echo stays presentation-free and great HUD omits chain text', () => {
    const echoStart = gameSource.indexOf('handleRemoteAttackAnim(data)');
    const echoEnd = gameSource.indexOf('\n    }', echoStart) + 6;
    const echo = gameSource.slice(echoStart, echoEnd);
    assert.match(echo, /if \(isLocal\) return;/);
    assert.doesNotMatch(echo, /_presentLocalDeflectResult|showMessage/);
    assert.match(mainSource, /chain\.textContent = perfect \? `x\$\{result\.chain \|\| 1\}` : '';/);
    assert.match(mainSource, /chain\.hidden = !perfect;/);
});
