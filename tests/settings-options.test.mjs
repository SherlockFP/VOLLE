// tests/settings-options.test.mjs — coverage for the settings-modal expansion:
// performance controls (quality/resolution-scale/FOV/FPS-cap), audio (master
// volume + mute) and input (invert-Y) + Game tab killfeed toggle.
//
// js/renderer.js can't be imported directly under Node (it pulls in
// 'three/addons/...' which only resolves through index.html's browser
// importmap) — same constraint tests/target-outline.test.mjs documents. So
// the quality-preset test slices Renderer.QUALITY_PRESETS out of the source
// text and evaluates it standalone, exactly like that file's technique for
// createTargetOutline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    clampResolutionScalePercent,
    resolutionScalePercentToFactor,
    clampFov,
    clampSensitivity,
    clampVolumePercent,
    normalizeFpsCap,
    computeEffectiveVolume,
    shouldRenderFrame,
    readExtraSettings,
    writeExtraSetting,
    applyKillfeedVisibility,
    initSettingsExtras
} from '../js/settings-controller.js';

const rendererSource = fs.readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8');
const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const polish = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

// --- test doubles ------------------------------------------------------------

function fakeClassList(initial = []) {
    const values = new Set(initial);
    return {
        has: name => values.has(name),
        toggle: (name, force) => {
            const on = force === undefined ? !values.has(name) : Boolean(force);
            on ? values.add(name) : values.delete(name);
            return on;
        }
    };
}

function fakeElement({ value, checked, classList } = {}) {
    const listeners = {};
    return {
        value,
        checked,
        textContent: '',
        classList: classList || fakeClassList(),
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        dispatch(type, target = {}) {
            for (const fn of listeners[type] || []) fn({ target: { ...this, ...target } });
        }
    };
}

function createFakeStore(initialSettings = {}) {
    const data = { settings: { ...initialSettings } };
    return {
        get: key => data[key],
        set: (key, val) => { data[key] = val; },
        _data: data
    };
}

// --- bounds clamping ---------------------------------------------------------

test('clampResolutionScalePercent clamps to the shipped 50-150 range', () => {
    assert.equal(clampResolutionScalePercent(10), 50);
    assert.equal(clampResolutionScalePercent(50), 50);
    assert.equal(clampResolutionScalePercent(100), 100);
    assert.equal(clampResolutionScalePercent(150), 150);
    assert.equal(clampResolutionScalePercent(999), 150);
    assert.equal(clampResolutionScalePercent('not-a-number'), 100);
    assert.equal(clampResolutionScalePercent(undefined), 100);
});

test('resolutionScalePercentToFactor mirrors js/renderer.js#setRenderScale\'s own 0.5-1.5 clamp', () => {
    assert.equal(resolutionScalePercentToFactor(50), 0.5);
    assert.equal(resolutionScalePercentToFactor(100), 1);
    assert.equal(resolutionScalePercentToFactor(150), 1.5);
    assert.equal(resolutionScalePercentToFactor(500), 1.5);
    assert.equal(resolutionScalePercentToFactor(-20), 0.5);
});

test('clampFov clamps to the shipped #setting-fov range (60-110)', () => {
    assert.equal(clampFov(50), 60);
    assert.equal(clampFov(60), 60);
    assert.equal(clampFov(75), 75);
    assert.equal(clampFov(110), 110);
    assert.equal(clampFov(200), 110);
    assert.equal(clampFov(NaN), 75);
});

test('clampSensitivity clamps to the shipped #setting-sensitivity range (1-10)', () => {
    assert.equal(clampSensitivity(0), 1);
    assert.equal(clampSensitivity(1), 1);
    assert.equal(clampSensitivity(5.5), 5.5);
    assert.equal(clampSensitivity(10), 10);
    assert.equal(clampSensitivity(50), 10);
    assert.equal(clampSensitivity('x'), 2);
});

test('clampVolumePercent clamps to 0-100', () => {
    assert.equal(clampVolumePercent(-5), 0);
    assert.equal(clampVolumePercent(0), 0);
    assert.equal(clampVolumePercent(63), 63);
    assert.equal(clampVolumePercent(100), 100);
    assert.equal(clampVolumePercent(150), 100);
});

test('normalizeFpsCap only accepts the shipped #setting-fps-limit option set', () => {
    for (const value of [0, 30, 60, 120, 144, 240]) assert.equal(normalizeFpsCap(value), value);
    assert.equal(normalizeFpsCap(59), 0);
    assert.equal(normalizeFpsCap('junk'), 0);
    assert.equal(normalizeFpsCap(undefined), 0);
});

// --- quality preset: single source is js/renderer.js#QUALITY_PRESETS --------

test('quality preset maps to the expected renderer values (js/renderer.js#QUALITY_PRESETS)', () => {
    const start = rendererSource.indexOf('static QUALITY_PRESETS = {');
    assert.ok(start !== -1, 'Renderer.QUALITY_PRESETS not found in js/renderer.js');
    const open = rendererSource.indexOf('{', start);
    const close = rendererSource.indexOf('};', open);
    assert.ok(close !== -1, 'QUALITY_PRESETS object literal is not terminated with "};"');
    const literal = rendererSource.slice(open, close + 1);
    // eslint-disable-next-line no-new-func
    const QUALITY_PRESETS = new Function(`return ${literal}`)();

    assert.deepEqual(QUALITY_PRESETS.low, { pixelRatio: 1, shadows: false, bloom: 0 });
    assert.deepEqual(QUALITY_PRESETS.medium, { pixelRatio: 1.5, shadows: true, bloom: 0.05 });
    assert.deepEqual(QUALITY_PRESETS.high, { pixelRatio: 2, shadows: true, bloom: 0.08 });

    // setQuality must read from this exact table (single source of truth —
    // no second inline config object left behind after the refactor).
    assert.match(rendererSource, /setQuality\(quality = 'medium'\) \{[\s\S]*?Renderer\.QUALITY_PRESETS\[this\._quality\]/);
});

test('js/arena.js reads renderer._quality for procedural textures — the same field setQuality writes', () => {
    const arenaSource = fs.readFileSync(new URL('../js/arena.js', import.meta.url), 'utf8');
    assert.match(arenaSource, /quality:\s*this\.renderer\?\.\_quality/);
});

// --- FPS-cap throttle: pure decide-render/skip math --------------------------

test('shouldRenderFrame: Uncapped (0) always renders', () => {
    assert.equal(shouldRenderFrame(0, 1000, 1000.001), true);
    assert.equal(shouldRenderFrame(0, 1000, 1000000), true);
});

test('shouldRenderFrame: invalid/negative caps degrade to uncapped', () => {
    assert.equal(shouldRenderFrame(-30, 1000, 1000.5), true);
    assert.equal(shouldRenderFrame(NaN, 1000, 1000.5), true);
    assert.equal(shouldRenderFrame(undefined, 1000, 1000.5), true);
});

test('shouldRenderFrame: first frame (no prior timestamp) always renders', () => {
    assert.equal(shouldRenderFrame(30, 0, 500), true);
    assert.equal(shouldRenderFrame(60, NaN, 500), true);
});

test('shouldRenderFrame: 30fps cap — skips inside the ~33.3ms window, renders at/after it', () => {
    const cap = 30;
    const last = 1000;
    const minInterval = 1000 / cap;
    assert.equal(shouldRenderFrame(cap, last, 1000 + 10), false);
    assert.equal(shouldRenderFrame(cap, last, 1000 + 33), false);
    assert.equal(shouldRenderFrame(cap, last, last + minInterval + 0.001), true);
    assert.equal(shouldRenderFrame(cap, last, 1000 + 40), true);
});

test('shouldRenderFrame: 60fps cap — skips inside the ~16.7ms window, renders at/after it', () => {
    const cap = 60;
    const last = 2000;
    const minInterval = 1000 / cap;
    assert.equal(shouldRenderFrame(cap, last, 2000 + 5), false);
    assert.equal(shouldRenderFrame(cap, last, 2000 + 16), false);
    assert.equal(shouldRenderFrame(cap, last, last + minInterval + 0.001), true);
    assert.equal(shouldRenderFrame(cap, last, 2000 + 20), true);
});

test('shouldRenderFrame: 120fps cap allows roughly double the 60fps throughput', () => {
    const last = 1000; // non-zero: 0 is the "no prior frame" sentinel, tested separately above
    const at60Interval = 1000 / 60;
    // A tick that just barely clears the 60fps window comfortably clears 120's window too.
    assert.equal(shouldRenderFrame(120, last, last + at60Interval), true);
    // But a tick inside 120's own tighter window still skips.
    assert.equal(shouldRenderFrame(120, last, last + 1000 / 120 - 1), false);
});

// --- master volume + mute: effective gain layering ---------------------------

test('computeEffectiveVolume multiplies channel and master as independent 0-100 faders', () => {
    assert.equal(computeEffectiveVolume(100, 100, false), 1);
    assert.equal(computeEffectiveVolume(50, 100, false), 0.5);
    assert.equal(computeEffectiveVolume(100, 50, false), 0.5);
    assert.equal(computeEffectiveVolume(50, 50, false), 0.25);
    assert.equal(computeEffectiveVolume(0, 100, false), 0);
});

test('computeEffectiveVolume: mute silences regardless of either fader', () => {
    assert.equal(computeEffectiveVolume(100, 100, true), 0);
    assert.equal(computeEffectiveVolume(0, 0, true), 0);
});

test('computeEffectiveVolume clamps out-of-range inputs before multiplying', () => {
    assert.equal(computeEffectiveVolume(500, 100, false), 1);
    assert.equal(computeEffectiveVolume(100, -50, false), 0);
});

// --- persistence round-trip for every new setting key -------------------------

test('masterVolume: write then read round-trips through the store', () => {
    const store = createFakeStore();
    writeExtraSetting(store, 'masterVolume', 65);
    assert.equal(readExtraSettings(store).masterVolume, 65);
});

test('muted: write then read round-trips through the store', () => {
    const store = createFakeStore();
    writeExtraSetting(store, 'muted', true);
    assert.equal(readExtraSettings(store).muted, true);
    writeExtraSetting(store, 'muted', false);
    assert.equal(readExtraSettings(store).muted, false);
});

test('invertY: write then read round-trips through the store', () => {
    const store = createFakeStore();
    writeExtraSetting(store, 'invertY', true);
    assert.equal(readExtraSettings(store).invertY, true);
});

test('killfeedVisible: write then read round-trips through the store', () => {
    const store = createFakeStore();
    writeExtraSetting(store, 'killfeedVisible', false);
    assert.equal(readExtraSettings(store).killfeedVisible, false);
});

test('readExtraSettings defaults every new key when the store has never seen it', () => {
    const store = createFakeStore();
    assert.deepEqual(readExtraSettings(store), {
        masterVolume: 100,
        muted: false,
        invertY: false,
        killfeedVisible: true
    });
});

test('writeExtraSetting never clobbers sibling keys already on the settings object', () => {
    const store = createFakeStore({ quality: 'high', fov: 90 });
    writeExtraSetting(store, 'masterVolume', 40);
    const settings = store.get('settings');
    assert.equal(settings.quality, 'high');
    assert.equal(settings.fov, 90);
    assert.equal(settings.masterVolume, 40);
});

test('readExtraSettings clamps a corrupted persisted masterVolume back into range', () => {
    const store = createFakeStore({ masterVolume: 999 });
    assert.equal(readExtraSettings(store).masterVolume, 100);
});

// --- killfeed visibility: pure DOM toggle -------------------------------------

test('applyKillfeedVisibility toggles the "hidden" class opposite of visible', () => {
    const el = fakeElement();
    applyKillfeedVisibility(el, false);
    assert.equal(el.classList.has('hidden'), true);
    applyKillfeedVisibility(el, true);
    assert.equal(el.classList.has('hidden'), false);
});

test('applyKillfeedVisibility no-ops safely when the element is missing', () => {
    assert.doesNotThrow(() => applyKillfeedVisibility(null, true));
    assert.doesNotThrow(() => applyKillfeedVisibility(undefined, false));
});

// --- initSettingsExtras: end-to-end DOM wiring against fake elements ---------

function buildFakeRoot(overrides = {}) {
    const elements = {
        '#setting-master-volume': fakeElement({ value: 100 }),
        '#setting-master-volume-value': fakeElement(),
        '#setting-mute': fakeElement({ checked: false }),
        '#setting-music-volume': fakeElement({ value: 2 }),
        '#setting-sound-volume': fakeElement({ value: 50 }),
        '#setting-invert-y': fakeElement({ checked: false }),
        '#setting-killfeed': fakeElement({ checked: true }),
        '#kill-feed': fakeElement(),
        ...overrides
    };
    return { querySelector: sel => elements[sel] || null, elements };
}

test('initSettingsExtras hydrates every control from the store on init', () => {
    const store = createFakeStore({ masterVolume: 70, muted: true, invertY: true, killfeedVisible: false });
    const root = buildFakeRoot();
    initSettingsExtras({ store, root });
    assert.equal(root.elements['#setting-master-volume'].value, 70);
    assert.equal(root.elements['#setting-master-volume-value'].textContent, '70%');
    assert.equal(root.elements['#setting-mute'].checked, true);
    assert.equal(root.elements['#setting-invert-y'].checked, true);
    assert.equal(root.elements['#setting-killfeed'].checked, false);
    assert.equal(root.elements['#kill-feed'].classList.has('hidden'), true);
});

test('initSettingsExtras: moving the master volume slider persists + applies effective audio gain', () => {
    const store = createFakeStore({ masterVolume: 100, muted: false });
    const calls = { sound: [], music: [] };
    const audio = { setSoundVolume: v => calls.sound.push(v) };
    const game = { setMusicVolume: v => calls.music.push(v) };
    const root = buildFakeRoot();
    initSettingsExtras({ store, audio, game, root });
    calls.sound.length = 0;
    calls.music.length = 0;

    root.elements['#setting-master-volume'].dispatch('input', { value: '50' });

    assert.equal(readExtraSettings(store).masterVolume, 50);
    assert.equal(root.elements['#setting-master-volume-value'].textContent, '50%');
    // sound=50 (store default), music=2 (store default), master now 50%
    assert.equal(calls.sound.at(-1), computeEffectiveVolume(50, 50, false));
    assert.equal(calls.music.at(-1), computeEffectiveVolume(2, 50, false));
});

test('initSettingsExtras: mute silences both channels without losing the stored sliders', () => {
    const store = createFakeStore({ masterVolume: 80, soundVolume: 90, musicVolume: 40 });
    const calls = { sound: [], music: [] };
    const audio = { setSoundVolume: v => calls.sound.push(v) };
    const game = { setMusicVolume: v => calls.music.push(v) };
    const root = buildFakeRoot();
    initSettingsExtras({ store, audio, game, root });
    calls.sound.length = 0;
    calls.music.length = 0;

    root.elements['#setting-mute'].dispatch('change', { checked: true });

    assert.equal(readExtraSettings(store).muted, true);
    assert.equal(calls.sound.at(-1), 0);
    assert.equal(calls.music.at(-1), 0);
    // The raw sliders are untouched — unmuting should restore them.
    assert.equal(store.get('settings').soundVolume, 90);
    assert.equal(store.get('settings').musicVolume, 40);
});

test('initSettingsExtras: nudging the existing sound-volume slider re-applies master/mute on top', () => {
    const store = createFakeStore({ masterVolume: 50, muted: false, soundVolume: 50 });
    const calls = { sound: [] };
    const audio = { setSoundVolume: v => calls.sound.push(v) };
    const root = buildFakeRoot();
    initSettingsExtras({ store, audio, root });
    calls.sound.length = 0;

    // main.js's own listener would normally update the store first; simulate that.
    store.get('settings').soundVolume = 80;
    root.elements['#setting-sound-volume'].dispatch('input');

    assert.equal(calls.sound.at(-1), computeEffectiveVolume(80, 50, false));
});

test('initSettingsExtras: invert-Y checkbox persists and calls player.setInvertY', () => {
    const store = createFakeStore();
    const calls = [];
    const player = { setInvertY: v => calls.push(v) };
    const root = buildFakeRoot();
    initSettingsExtras({ store, player, root });
    calls.length = 0;

    root.elements['#setting-invert-y'].dispatch('change', { checked: true });

    assert.equal(readExtraSettings(store).invertY, true);
    assert.deepEqual(calls, [true]);
});

test('initSettingsExtras: invert-Y wiring is inert (no throw) when player.setInvertY does not exist yet', () => {
    const store = createFakeStore();
    const root = buildFakeRoot();
    assert.doesNotThrow(() => initSettingsExtras({ store, player: {}, root }));
    assert.doesNotThrow(() => root.elements['#setting-invert-y'].dispatch('change', { checked: true }));
});

test('initSettingsExtras: killfeed checkbox persists and toggles #kill-feed visibility', () => {
    const store = createFakeStore();
    const root = buildFakeRoot();
    initSettingsExtras({ store, root });

    root.elements['#setting-killfeed'].dispatch('change', { checked: false });
    assert.equal(readExtraSettings(store).killfeedVisible, false);
    assert.equal(root.elements['#kill-feed'].classList.has('hidden'), true);

    root.elements['#setting-killfeed'].dispatch('change', { checked: true });
    assert.equal(readExtraSettings(store).killfeedVisible, true);
    assert.equal(root.elements['#kill-feed'].classList.has('hidden'), false);
});

test('initSettingsExtras returns null without throwing when the store is missing get/set', () => {
    assert.equal(initSettingsExtras({ root: buildFakeRoot() }), null);
    assert.equal(initSettingsExtras({}), null);
});

// --- markup + styling contracts -----------------------------------------------

function section(tab) {
    const start = markup.indexOf(`data-settings-section="${tab}"`);
    assert.ok(start !== -1, `settings modal has no data-settings-section="${tab}"`);
    const nextSection = markup.indexOf('data-settings-section="', start + 1);
    return markup.slice(start, nextSection === -1 ? undefined : nextSection);
}

test('Video tab exposes master volume + mute controls with aria-labels', () => {
    const video = section('video');
    assert.match(video, /id="setting-master-volume"[^>]*aria-label="Master volume"/);
    assert.match(video, /id="setting-master-volume-value"/);
    assert.match(video, /id="setting-mute"[^>]*aria-label="Mute all audio"/);
});

test('Game tab exposes a killfeed toggle with an aria-label', () => {
    const game = section('game');
    assert.match(game, /id="setting-killfeed"[^>]*aria-label="Show kill feed"/);
});

test('Controls tab exposes an invert-Y toggle with an aria-label', () => {
    const controls = section('controls');
    assert.match(controls, /id="setting-invert-y"[^>]*aria-label="Invert vertical look axis"/);
});

test('every new toggle/slider is a native input (checkbox or range), so it is keyboard-focusable for free', () => {
    for (const id of ['setting-master-volume', 'setting-mute', 'setting-invert-y', 'setting-killfeed']) {
        const idx = markup.indexOf(`id="${id}"`);
        assert.ok(idx !== -1, `#${id} missing from index.html`);
        const tagStart = markup.lastIndexOf('<input', idx);
        assert.ok(tagStart !== -1 && tagStart > idx - 80, `#${id} must be a native <input>`);
    }
});

test('css/polish.css styles the new settings sub-group divider with theme tokens, not hardcoded colors', () => {
    assert.match(polish, /\.settings-subgroup-label\s*\{[^}]*var\(--ui-border\)[^}]*\}/s);
    assert.match(polish, /\.settings-subgroup-label\s*\{[^}]*var\(--ui-muted\)[^}]*\}/s);
});

test('global :focus-visible ring (--ui-focus) covers the new native inputs — no bespoke focus CSS needed', () => {
    const tokens = fs.readFileSync(new URL('../css/ui-tokens.css', import.meta.url), 'utf8');
    assert.match(tokens, /:focus-visible\s*\{[^}]*var\(--ui-focus\)/s);
});
