// tests/settings-ui.test.mjs — coverage for the settings-modal redesign:
// per-tab "Reset to defaults" (two-tap confirm + native-default sweep), the
// shared "saved" pulse indicator, and tying the theme swatch preview back to
// the js/ui-theme.js catalog (docs/V3_UX_ROADMAP.md #2.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UI_THEMES } from '../js/ui-theme.js';
import {
    RESET_CONFIRM_WINDOW_MS,
    nextResetConfirmState,
    resetControlToDefault,
    resetSectionToDefaults,
    initSettingsResetButtons,
    pulseSavedIndicator,
    initSettingsSavedIndicator,
    buildThemeSwatchCards
} from '../js/settings-controller.js';

const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// --- test doubles ------------------------------------------------------------

function fakeClassList(initial = []) {
    const values = new Set(initial);
    return {
        has: name => values.has(name),
        contains: name => values.has(name),
        add: name => { values.add(name); },
        remove: name => { values.delete(name); },
        toggle: (name, force) => {
            const on = force === undefined ? !values.has(name) : Boolean(force);
            on ? values.add(name) : values.delete(name);
            return on;
        }
    };
}

// A minimal EventTarget-backed control: real addEventListener/dispatchEvent
// (Node's global EventTarget/Event, the same pair js/settings-controller.js's
// initThemeSwatches already dispatches through) so resetSectionToDefaults's
// `el.dispatchEvent(new Event(...))` calls are exercised for real, not mocked.
function fakeControl({ tagName = 'INPUT', type = 'range', value, defaultValue, checked, defaultChecked, options } = {}) {
    const el = new EventTarget();
    Object.assign(el, { tagName, type, value, defaultValue, checked, defaultChecked, options });
    return el;
}

function fakeSection(controls) {
    return { querySelectorAll: () => controls };
}

// Delegation-style fake root: addEventListener/dispatch takes an explicit
// target object (there is no real parent/child tree to bubble through here),
// matching how initSettingsSavedIndicator reads event.target.
function fakeDelegationTarget() {
    const listeners = {};
    return {
        addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
        removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
        dispatch(type, target) { for (const fn of (listeners[type] || [])) fn({ target }); }
    };
}

function fakeButton(text, resetTab) {
    const el = new EventTarget();
    Object.assign(el, { textContent: text, dataset: { resetTab }, classList: fakeClassList() });
    return el;
}

// --- nextResetConfirmState: pure two-tap reducer -----------------------------

test('nextResetConfirmState: a bare click (no prior arm) arms and does not confirm', () => {
    const result = nextResetConfirmState(null, 1000);
    assert.equal(result.action, 'arm');
    assert.equal(result.armedAt, 1000);
});

test('nextResetConfirmState: a second click inside the window confirms and clears the arm', () => {
    const result = nextResetConfirmState(1000, 1000 + RESET_CONFIRM_WINDOW_MS);
    assert.equal(result.action, 'confirm');
    assert.equal(result.armedAt, null);
});

test('nextResetConfirmState: a second click past the window re-arms instead of confirming', () => {
    const result = nextResetConfirmState(1000, 1000 + RESET_CONFIRM_WINDOW_MS + 1);
    assert.equal(result.action, 'arm');
    assert.equal(result.armedAt, 1000 + RESET_CONFIRM_WINDOW_MS + 1);
});

test('nextResetConfirmState is a pure function: same inputs, same output, no shared state', () => {
    assert.deepEqual(nextResetConfirmState(500, 800), nextResetConfirmState(500, 800));
});

// --- resetControlToDefault: pure per-control default sweep -------------------

test('resetControlToDefault: select resets to the option with defaultSelected, not the first option', () => {
    const select = fakeControl({
        tagName: 'SELECT',
        value: '120',
        options: [
            { value: '0', defaultSelected: false },
            { value: '60', defaultSelected: true },
            { value: '120', defaultSelected: false }
        ]
    });
    assert.equal(resetControlToDefault(select), true);
    assert.equal(select.value, '60');
});

test('resetControlToDefault: select already at default returns false and is a no-op', () => {
    const select = fakeControl({
        tagName: 'SELECT',
        value: '60',
        options: [{ value: '60', defaultSelected: true }]
    });
    assert.equal(resetControlToDefault(select), false);
    assert.equal(select.value, '60');
});

test('resetControlToDefault: checkbox resets checked back to defaultChecked', () => {
    const checkbox = fakeControl({ type: 'checkbox', checked: true, defaultChecked: false });
    assert.equal(resetControlToDefault(checkbox), true);
    assert.equal(checkbox.checked, false);
});

test('resetControlToDefault: checkbox already at default returns false', () => {
    const checkbox = fakeControl({ type: 'checkbox', checked: false, defaultChecked: false });
    assert.equal(resetControlToDefault(checkbox), false);
});

test('resetControlToDefault: range/text/color input resets value back to defaultValue', () => {
    const range = fakeControl({ type: 'range', value: '9', defaultValue: '2' });
    assert.equal(resetControlToDefault(range), true);
    assert.equal(range.value, '2');
});

test('resetControlToDefault: input already at defaultValue returns false', () => {
    const range = fakeControl({ type: 'range', value: '2', defaultValue: '2' });
    assert.equal(resetControlToDefault(range), false);
});

test('resetControlToDefault: missing/unsupported element does not throw', () => {
    assert.equal(resetControlToDefault(null), false);
    assert.equal(resetControlToDefault(undefined), false);
    assert.equal(resetControlToDefault({ tagName: 'BUTTON' }), false);
});

// --- resetSectionToDefaults: sweeps a section and replays input+change ------

test('resetSectionToDefaults: only touches and reports controls that actually changed', () => {
    const changedRange = fakeControl({ type: 'range', value: '9', defaultValue: '2' });
    const alreadyDefault = fakeControl({ type: 'checkbox', checked: false, defaultChecked: false });
    const changedCheckbox = fakeControl({ type: 'checkbox', checked: true, defaultChecked: false });
    const section = fakeSection([changedRange, alreadyDefault, changedCheckbox]);

    const inputEvents = [];
    const changeEvents = [];
    changedRange.addEventListener('input', e => inputEvents.push(e.target));
    changedRange.addEventListener('change', e => changeEvents.push(e.target));
    changedCheckbox.addEventListener('input', e => inputEvents.push(e.target));
    alreadyDefault.addEventListener('input', () => inputEvents.push(alreadyDefault));

    const changed = resetSectionToDefaults(section);

    assert.equal(changed.length, 2);
    assert.equal(changedRange.value, '2');
    assert.equal(changedCheckbox.checked, false);
    assert.equal(alreadyDefault.checked, false, 'unchanged control keeps its value');
    assert.deepEqual(inputEvents, [changedRange, changedCheckbox], 'input replayed only for changed controls');
    assert.deepEqual(changeEvents, [changedRange]);
});

test('resetSectionToDefaults: missing/empty section returns an empty list without throwing', () => {
    assert.deepEqual(resetSectionToDefaults(null), []);
    assert.deepEqual(resetSectionToDefaults(undefined), []);
    assert.deepEqual(resetSectionToDefaults(fakeSection([])), []);
});

// --- initSettingsResetButtons: two-tap confirm wired to real click events ---

function fakeResetRoot(buttons, sections) {
    return {
        querySelectorAll: sel => (sel === '.settings-reset-btn[data-reset-tab]' ? buttons : []),
        querySelector: sel => sections[sel] ?? null
    };
}

test('initSettingsResetButtons: first click arms ("Sure?") without resetting anything yet', () => {
    const range = fakeControl({ type: 'range', value: '9', defaultValue: '2' });
    const btn = fakeButton('Reset to defaults', 'controls');
    const root = fakeResetRoot([btn], { '[data-settings-section="controls"]': fakeSection([range]) });
    initSettingsResetButtons(root);

    btn.dispatchEvent(new Event('click'));

    assert.equal(btn.textContent, 'Sure?');
    assert.equal(btn.classList.has('is-armed'), true);
    assert.equal(range.value, '9', 'nothing reset on the first (arming) click');
});

test('initSettingsResetButtons: second click within the window confirms and resets only its own tab', () => {
    const controlsRange = fakeControl({ type: 'range', value: '9', defaultValue: '2' });
    const videoRange = fakeControl({ type: 'range', value: '77', defaultValue: '50' });
    const btn = fakeButton('Reset to defaults', 'controls');
    const root = fakeResetRoot([btn], {
        '[data-settings-section="controls"]': fakeSection([controlsRange]),
        '[data-settings-section="video"]': fakeSection([videoRange])
    });
    initSettingsResetButtons(root);

    btn.dispatchEvent(new Event('click'));
    btn.dispatchEvent(new Event('click'));

    assert.equal(controlsRange.value, '2', 'own tab was reset');
    assert.equal(videoRange.value, '77', 'other tabs are untouched');
    assert.equal(btn.textContent, 'Reset to defaults', 'label reverts after confirming');
    assert.equal(btn.classList.has('is-armed'), false);
});

test('initSettingsResetButtons: each reset button only ever touches its own data-reset-tab section', () => {
    const gameSelect = fakeControl({ tagName: 'SELECT', value: 'hard', options: [{ value: 'medium', defaultSelected: true }, { value: 'hard', defaultSelected: false }] });
    const accessRange = fakeControl({ type: 'range', value: '120', defaultValue: '100' });
    const gameBtn = fakeButton('Reset to defaults', 'game');
    const accessBtn = fakeButton('Reset to defaults', 'access');
    const root = fakeResetRoot([gameBtn, accessBtn], {
        '[data-settings-section="game"]': fakeSection([gameSelect]),
        '[data-settings-section="access"]': fakeSection([accessRange])
    });
    initSettingsResetButtons(root);

    gameBtn.dispatchEvent(new Event('click'));
    gameBtn.dispatchEvent(new Event('click'));

    assert.equal(gameSelect.value, 'medium');
    assert.equal(accessRange.value, '120', 'the access tab button was never clicked');
});

// --- pulseSavedIndicator + initSettingsSavedIndicator: instant feedback -----

test('pulseSavedIndicator restarts the pulse class on a fresh element', () => {
    const el = { classList: fakeClassList(), offsetWidth: 0 };
    pulseSavedIndicator(el);
    assert.equal(el.classList.has('settings-saved-pulse'), true);
});

test('pulseSavedIndicator no-ops safely when the element is missing', () => {
    assert.doesNotThrow(() => pulseSavedIndicator(null));
    assert.doesNotThrow(() => pulseSavedIndicator(undefined));
});

test('initSettingsSavedIndicator: a change on a settings-row input pulses the shared indicator', () => {
    const scroll = fakeDelegationTarget();
    const indicator = { classList: fakeClassList(), offsetWidth: 0 };
    const root = { querySelector: sel => (sel === '.settings-scroll' ? scroll : sel === '#settings-saved-indicator' ? indicator : null) };
    initSettingsSavedIndicator(root);

    const rowInput = { tagName: 'INPUT', closest: sel => (sel === '.settings-row' ? {} : null) };
    scroll.dispatch('input', rowInput);

    assert.equal(indicator.classList.has('settings-saved-pulse'), true);
});

test('initSettingsSavedIndicator: ignores events whose target is not inside a .settings-row control', () => {
    const scroll = fakeDelegationTarget();
    const indicator = { classList: fakeClassList(), offsetWidth: 0 };
    const root = { querySelector: sel => (sel === '.settings-scroll' ? scroll : sel === '#settings-saved-indicator' ? indicator : null) };
    initSettingsSavedIndicator(root);

    // A button (not input/select) inside a row: e.g. "Copy crash report" / reset button.
    scroll.dispatch('input', { tagName: 'BUTTON', closest: () => ({}) });
    assert.equal(indicator.classList.has('settings-saved-pulse'), false);

    // An input outside any .settings-row.
    scroll.dispatch('input', { tagName: 'INPUT', closest: () => null });
    assert.equal(indicator.classList.has('settings-saved-pulse'), false);
});

test('initSettingsSavedIndicator returns null when the scroll container or indicator is missing', () => {
    assert.equal(initSettingsSavedIndicator({ querySelector: () => null }), null);
});

// --- theme swatch preview: tied to the js/ui-theme.js catalog (V3_UX_ROADMAP #2.3) ---

test('buildThemeSwatchCards produces exactly one card per catalog theme when fed from UI_THEMES', () => {
    const options = UI_THEMES.map(value => ({ value, label: value }));
    const cards = buildThemeSwatchCards(options, UI_THEMES[0]);
    assert.equal(cards.length, UI_THEMES.length);
    assert.deepEqual(cards.map(c => c.theme), [...UI_THEMES]);
    assert.equal(cards.filter(c => c.selected).length, 1, 'exactly one card selected');
    assert.equal(cards[0].selected, true);
});

test('buildThemeSwatchCards stays in sync if the catalog grows: every theme gets a card, none dropped', () => {
    const options = UI_THEMES.map(value => ({ value, label: value }));
    const cards = buildThemeSwatchCards(options, 'no-such-theme');
    assert.equal(cards.length, UI_THEMES.length);
    assert.equal(cards.every(c => c.selected === false), true, 'unknown selection marks nothing selected');
});

test('index.html settings modal renders the theme swatch preview inside the Accessibility tab, after the theme picker', () => {
    const accessStart = markup.indexOf('data-settings-section="access"');
    const pickerIdx = markup.indexOf('id="setting-theme"', accessStart);
    const previewIdx = markup.indexOf('id="setting-theme-preview"', accessStart);
    assert.ok(accessStart !== -1 && pickerIdx !== -1 && previewIdx !== -1);
    assert.ok(pickerIdx < previewIdx, 'the swatch preview follows the picker it mirrors');
});
