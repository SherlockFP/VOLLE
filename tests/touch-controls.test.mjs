import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    TOUCH_LAYOUT,
    TouchInputModel,
    clampStickBase,
    createStickVector,
    isPortrait,
    joystickVector,
    normalizeTouchMode,
    shouldEnableTouch,
    touchLookRadiansPerPixel
} from '../js/touch-controls.js';

const W = 812;
const H = 375;

function fakePlayer() {
    const calls = [];
    return {
        keys: {},
        touchMove: { x: 0, y: 0 },
        calls,
        deflectHeld: false,
        pressPrimary() { calls.push('pressPrimary'); this.deflectHeld = true; return true; },
        releasePrimary() { calls.push('releasePrimary'); this.deflectHeld = false; },
        pressSecondary() { calls.push('pressSecondary'); return true; },
        handleActionKey(e) { calls.push(`action:${e.code}:${e.repeat}`); },
        applyLookDelta(dx, dy, rad) { calls.push(['look', dx, dy, rad]); return true; }
    };
}

function model(player = fakePlayer(), extra = {}) {
    const keys = [];
    const m = new TouchInputModel(player, { emitKey: (code, type) => keys.push(`${type}:${code}`), ...extra });
    return { m, player, keys };
}

const stick = TOUCH_LAYOUT.stick;

test('joystick: radial deadzone outputs exactly zero', () => {
    const out = createStickVector();
    joystickVector(stick.radius * stick.deadzone * 0.9, 0, stick, out);
    assert.equal(out.x, 0);
    assert.equal(out.y, 0);
    assert.equal(out.magnitude, 0);
    assert.equal(out.sprint, false);
    joystickVector(0, 0, stick, out);
    assert.equal(out.magnitude, 0);
});

test('joystick: magnitude ramps from minWalk past the deadzone to 1 at the rim, y is forward-up', () => {
    const out = createStickVector();
    joystickVector(0, -(stick.radius * stick.deadzone + 0.01), stick, out);
    assert.ok(Math.abs(out.magnitude - stick.minWalk) < 0.01, `just past deadzone ~minWalk, got ${out.magnitude}`);
    assert.ok(out.y > 0 && Math.abs(out.x) < 1e-9, 'finger up = forward');
    joystickVector(0, -stick.radius * 0.5, stick, out);
    assert.ok(out.magnitude > stick.minWalk && out.magnitude < 1);
    joystickVector(stick.radius * 3, 0, stick, out);
    assert.equal(out.magnitude, 1, 'clamped at the rim');
    assert.ok(Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-9);
    assert.ok(out.x > 0.99, 'finger right = strafe right');
    assert.equal(out.knobX, stick.radius, 'knob stays on the ring');
});

test('joystick: sprint only at the edge', () => {
    const out = createStickVector();
    joystickVector(0, -stick.radius * (stick.sprintAt - 0.05), stick, out);
    assert.equal(out.sprint, false);
    joystickVector(0, -stick.radius * stick.sprintAt, stick, out);
    assert.equal(out.sprint, true);
    joystickVector(-stick.radius * 1.4, 0, stick, out);
    assert.equal(out.sprint, true, 'any direction, pushed past the rim');
});

test('joystick math reuses the output object (no per-move allocation)', () => {
    const out = createStickVector();
    assert.equal(joystickVector(10, 10, stick, out), out);
});

test('stick base is clamped fully on-screen', () => {
    const base = clampStickBase(2, H - 1, W, H, stick);
    assert.equal(base.x, stick.radius + stick.edgeMargin);
    assert.equal(base.y, H - stick.radius - stick.edgeMargin);
});

test('left-zone touch drives analog movement and edge sprint through player state', () => {
    const { m, player } = model();
    assert.equal(m.touchStart(1, 150, 250, null, W, H), 'stick');
    m.touchMove(1, 150, 250 - stick.radius * 0.5);
    assert.ok(player.touchMove.y > 0 && player.touchMove.y < 1);
    assert.equal(player.keys.ShiftLeft, undefined, 'no sprint at half push');
    m.touchMove(1, 150, 250 - stick.radius * 1.2);
    assert.equal(player.touchMove.y, 1);
    assert.equal(player.keys.ShiftLeft, true);
    m.touchEnd(1);
    assert.deepEqual(player.touchMove, { x: 0, y: 0 });
    assert.equal(player.keys.ShiftLeft, false);
});

test('multi-touch: joystick + look + deflect tracked independently by identifier', () => {
    const { m, player } = model();
    assert.equal(m.touchStart(7, 100, 260, null, W, H), 'stick');
    assert.equal(m.touchStart(3, 500, 150, null, W, H), 'look');
    assert.equal(m.touchStart(9, 700, 300, 'deflect', W, H), 'button');
    assert.equal(m.activeTouches, 3);
    assert.equal(player.deflectHeld, true);

    m.touchMove(3, 520, 140);
    const look = player.calls.filter(c => Array.isArray(c));
    assert.deepEqual(look.at(-1), ['look', 20, -10, m.lookRadPerPx]);
    // Deflect finger drags too, but a dedicated look finger owns the camera.
    m.touchMove(9, 720, 300);
    assert.equal(player.calls.filter(c => Array.isArray(c)).length, 1);
    m.touchMove(7, 100 + stick.radius, 260);
    assert.ok(player.touchMove.x > 0.99);

    m.touchEnd(3);
    assert.equal(m.lookId, -1);
    assert.equal(player.deflectHeld, true, 'ending look leaves deflect held');
    assert.ok(player.touchMove.x > 0.99, 'ending look leaves the stick alone');
    m.touchEnd(9);
    assert.equal(player.deflectHeld, false);
    m.touchEnd(7);
    assert.equal(m.activeTouches, 0);
    m.touchEnd(42); // unknown id is harmless
});

test('second left-zone finger looks instead of stealing the stick; duplicate ids ignored', () => {
    const { m } = model();
    m.touchStart(1, 100, 200, null, W, H);
    assert.equal(m.touchStart(1, 110, 210, null, W, H), null);
    assert.equal(m.touchStart(2, 120, 200, null, W, H), 'look');
    assert.equal(m.touchStart(3, 600, 200, null, W, H), null, 'only one look finger');
});

test('deflect button with no look finger aims while held (hold-and-drag like mobile FPS fire)', () => {
    const { m, player } = model();
    m.touchStart(4, 700, 300, 'deflect', W, H);
    m.touchMove(4, 690, 305);
    assert.deepEqual(player.calls.at(-1), ['look', -10, 5, m.lookRadPerPx]);
});

test('deflect hold/release mirrors left mouse down/up (charge window)', () => {
    const { m, player } = model();
    m.touchStart(1, 700, 300, 'deflect', W, H);
    assert.deepEqual(player.calls, ['pressPrimary']);
    m.tick(); m.tick(); m.tick(); // held across frames -> Game._updateCharge sees _deflectHeld
    assert.equal(player.deflectHeld, true);
    m.touchEnd(1);
    assert.deepEqual(player.calls, ['pressPrimary', 'releasePrimary']);
});

test('buttons map onto the keyboard/mouse input state', () => {
    const { m, player, keys } = model();
    m.touchStart(1, 0, 0, 'stab', W, H);
    m.touchStart(2, 0, 0, 'skill', W, H);
    m.touchStart(3, 0, 0, 'inspect', W, H);
    m.touchStart(4, 0, 0, 'twirl', W, H);
    assert.deepEqual(player.calls, ['pressSecondary', 'action:KeyQ:false', 'action:KeyF:false', 'action:KeyR:false']);
    m.touchStart(5, 0, 0, 'jump', W, H);
    m.touchStart(6, 0, 0, 'dash', W, H);
    assert.equal(player.keys.Space, true);
    assert.equal(player.keys.ControlLeft, true);
    m.tick();
    m.touchEnd(5);
    m.touchEnd(6);
    assert.equal(player.keys.Space, false);
    assert.equal(player.keys.ControlLeft, false);
    m.touchStart(7, 0, 0, 'scoreboard', W, H);
    m.touchEnd(7);
    m.touchStart(8, 0, 0, 'emote', W, H);
    m.touchEnd(8);
    m.touchStart(9, 0, 0, 'pause', W, H);
    assert.deepEqual(keys, ['keydown:Tab', 'keyup:Tab', 'keydown:KeyG', 'keydown:Escape', 'keyup:Escape']);
});

test('a same-frame jump tap stays down for one game frame', () => {
    const { m, player } = model();
    m.touchStart(1, 0, 0, 'jump', W, H);
    m.touchEnd(1);
    assert.equal(player.keys.Space, true, 'not released before any frame saw it');
    m.tick();
    assert.equal(player.keys.Space, false);
});

test('releaseAll drops every hold (overlay hidden / blur)', () => {
    const { m, player, keys } = model();
    m.touchStart(1, 100, 200, null, W, H);
    m.touchMove(1, 100, 200 - stick.radius * 2);
    m.touchStart(2, 0, 0, 'deflect', W, H);
    m.touchStart(3, 0, 0, 'jump', W, H);
    m.touchStart(4, 0, 0, 'scoreboard', W, H);
    m.releaseAll();
    assert.equal(m.activeTouches, 0);
    assert.equal(player.deflectHeld, false);
    assert.equal(player.keys.Space, false);
    assert.equal(player.keys.ShiftLeft, false);
    assert.deepEqual(player.touchMove, { x: 0, y: 0 });
    assert.equal(keys.at(-1), 'keyup:Tab');
});

test('haptics fire on press with a short pulse', () => {
    const pulses = [];
    const { m } = model(fakePlayer(), { haptic: ms => pulses.push(ms) });
    m.touchStart(1, 0, 0, 'deflect', W, H);
    m.touchStart(2, 0, 0, 'jump', W, H);
    assert.deepEqual(pulses, [TOUCH_LAYOUT.haptics.primary, TOUCH_LAYOUT.haptics.press]);
    assert.ok(pulses.every(ms => ms > 0 && ms <= 30));
});

test('portrait detection and enable modes', () => {
    assert.equal(isPortrait(375, 812), true);
    assert.equal(isPortrait(812, 375), false);
    assert.equal(isPortrait(800, 800), false);
    assert.equal(shouldEnableTouch('auto', true, false), true);
    assert.equal(shouldEnableTouch('auto', false, false), false);
    assert.equal(shouldEnableTouch('auto', false, true), true);
    // Touchscreen laptop with a mouse/trackpad: an accidental tap must not steal pointer lock.
    assert.equal(shouldEnableTouch('auto', false, true, true), false);
    assert.equal(shouldEnableTouch('off', true, true), false);
    assert.equal(shouldEnableTouch('on', false, false), true);
    assert.equal(normalizeTouchMode('bogus'), 'auto');
});

test('touch look sensitivity is its own scale and clamps', () => {
    assert.equal(touchLookRadiansPerPixel(5), 5 * TOUCH_LAYOUT.look.radiansPerPixelPerUnit);
    assert.equal(touchLookRadiansPerPixel(99), 10 * TOUCH_LAYOUT.look.radiansPerPixelPerUnit);
    assert.equal(touchLookRadiansPerPixel('x'), TOUCH_LAYOUT.look.defaultSensitivity * TOUCH_LAYOUT.look.radiansPerPixelPerUnit);
});

test('layout config keeps primary buttons thumb-sized and every button has markup', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const [name, cfg] of Object.entries(TOUCH_LAYOUT.buttons)) {
        assert.match(html, new RegExp(`data-touch-btn="${name}"`), `${name} markup`);
        if (['deflect', 'jump', 'stab', 'dash', 'skill'].includes(name)) assert.ok(cfg.size >= 56, `${name} >= 56px`);
        assert.ok(cfg.size >= 44, `${name} >= 44px touch target`);
    }
    assert.match(html, /<link rel="stylesheet" href="css\/touch\.css/);
    const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
    assert.match(sw, /'css\/touch\.css'/);
});

test('player input paths share one entry point for mouse and touch', async () => {
    const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    assert.match(source, /'mousemove'[\s\S]*?this\.applyLookDelta\(e\.movementX, e\.movementY, this\.sensitivity\)/);
    assert.match(source, /e\.button === 0\) this\.pressPrimary\(\)/);
    assert.match(source, /e\.button === 0\) this\.releasePrimary\(\)/);
    assert.match(source, /lock\(\) \{\s*if \(this\.touchInput\) return;/);
    assert.match(source, /forwardDown: !!this\.keys\['KeyW'\] \|\| touchMove\.y > 0\.5/);
});
