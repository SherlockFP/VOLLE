import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rootDir = new URL('../', import.meta.url);
const [main, ui, css] = await Promise.all([
    readFile(new URL('js/main.js', rootDir), 'utf8'),
    readFile(new URL('js/ui.js', rootDir), 'utf8'),
    readFile(new URL('css/polish.css', rootDir), 'utf8')
]);

function makeElement() {
    const classes = new Set();
    return {
        textContent: '',
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains: name => classes.has(name)
        }
    };
}

function loadActualMovementHud() {
    const start = ui.indexOf("    updateMovementHUD(speed = 0, state = 'MOVE', social = false) {");
    const end = ui.indexOf('\n    updateMovementTrialHUD(state)', start);
    assert.ok(start >= 0 && end > start, 'movement HUD must remain a bounded UI method');
    const method = ui.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    return new Function('speed', 'state', 'social', body);
}

test('actual movement HUD gives DASH its own visible, mutually-exclusive state class', () => {
    const root = makeElement();
    const value = makeElement();
    const label = makeElement();
    const previousDocument = globalThis.document;
    globalThis.document = {
        getElementById: id => ({ 'movement-hud': root, 'movement-speed-value': value, 'movement-state': label }[id] || null)
    };
    try {
        const updateMovementHUD = loadActualMovementHud();
        updateMovementHUD.call({}, 12, 'BHOP', false);
        assert.equal(root.classList.contains('bhop'), true);
        updateMovementHUD.call({}, 0, 'DASH', false);
        assert.equal(label.textContent, 'DASH');
        assert.equal(root.classList.contains('hidden'), false);
        assert.equal(root.classList.contains('boost'), true);
        assert.equal(root.classList.contains('dash'), true);
        assert.equal(root.classList.contains('bhop'), false);
        assert.equal(root.classList.contains('longjump'), false);
        updateMovementHUD.call({}, 15, 'LONGJUMP', false);
        assert.equal(root.classList.contains('longjump'), true);
        assert.equal(root.classList.contains('dash'), false);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('movement polish prioritizes LONGJUMP over DASH and DASH over bhop/sprint', () => {
    const start = main.indexOf('    _updateMovementPolish(social = false) {');
    const end = main.indexOf('\n    _receiveSocialPresence(data)', start);
    assert.ok(start >= 0 && end > start);
    const polish = main.slice(start, end);

    assert.match(polish, /const dashActive = this\.player\._justDashed \|\| this\.player\.dashTimer > 0;/);
    assert.match(polish, /longJumpEvent[\s\S]*?\? 'LONGJUMP'\s*:\s*dashActive\s*\? 'DASH'\s*:\s*!this\.player\.onGround/);
    assert.match(polish, /this\.ui\.updateMovementHUD\(speed, movementState, social\);/);
});

test('DASH presentation stays restrained and reduced-motion safe', () => {
    assert.match(css, /\.movement-hud\.dash\s*\{[\s\S]*?border-color:\s*var\(--screen-accent\);[\s\S]*?box-shadow:/);
    const dashStart = css.indexOf('.movement-hud.dash');
    const motionStart = css.indexOf('@media (prefers-reduced-motion: reduce) {', dashStart);
    const motionEnd = css.indexOf('\n}\n', motionStart) + 2;
    assert.ok(dashStart >= 0 && motionStart > dashStart && motionEnd > motionStart, 'dash reduced-motion block must remain bounded');
    assert.match(css.slice(motionStart, motionEnd), /\.movement-hud\.dash\s*\{[\s\S]*?box-shadow:\s*0 0 0 1px var\(--screen-accent\);/);
    assert.doesNotMatch(css.slice(css.indexOf('.movement-hud.dash'), css.indexOf('@keyframes movement-bhop-float')), /animation:/);
});
