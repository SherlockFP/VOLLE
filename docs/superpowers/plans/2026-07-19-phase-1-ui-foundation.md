# Phase 1 UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable dark/soft-spectrum UI foundation, consolidate settings, repair and secure the scoreboard, and enforce console host authority without rewriting the working game.

**Architecture:** Keep the current Three.js, vanilla JS, Store, UI screen routing, and DOM IDs. Add small testable modules for theme/settings state, use focused CSS loaded after the legacy stylesheet, convert unsafe scoreboard HTML to DOM construction, and attach explicit authority metadata to game-state console commands.

**Tech Stack:** Vanilla ES modules, Three.js 0.170, Node.js built-in test runner, CSS custom properties, localStorage-backed Store.

## Global Constraints

- No new runtime dependency or frontend framework.
- Existing game, arena, renderer, Store, network, and screen routing remain intact.
- Default theme is dark navy/graphite with coral primary and cyan information accents.
- Soft-spectrum uses low-saturation violet/cyan/pink/amber accents; no continuous rainbow animation.
- Normal text contrast target is at least 4.5:1.
- Minimum interactive target is 44px.
- Support 1280x720, 1366x768, 1920x1080, and ultrawide without clipping.
- Respect reduced-motion, high-contrast, and color-vision settings.
- Do not commit automatically. Human may commit reviewed checkpoints.
- Do not alter gameplay/network behavior except console authority checks in this phase.

---

## File Map

**Create**

- `js/ui-theme.js`: theme whitelist, normalization, Store hydration, root DOM application.
- `js/settings-controller.js`: tab selection and centralized settings tab behavior.
- `css/ui-tokens.css`: dark/soft-spectrum tokens, focus, motion, accessibility overrides.
- `css/ui-shell.css`: shared responsive modal/screen/panel rules plus Phase 1 settings/scoreboard fixes.
- `tests/ui-foundation.test.mjs`: theme, settings tab, scoreboard safety, console authority tests.

**Modify**

- `index.html`: load new CSS, add theme/UI-scale settings, remove legacy settings panel.
- `js/main.js`: initialize theme/settings controller, bind theme/UI scale, implement scoreboard keyup close.
- `js/ui.js`: safe scoreboard row construction and stable fallback level.
- `js/console.js`: command authority metadata and runtime host check.
- `css/style.css`: delete only superseded legacy scoreboard positioning/settings-panel blocks when proven unused.

## Interfaces

```js
// js/ui-theme.js
export const UI_THEMES = Object.freeze(['dark', 'soft-spectrum']);
export function normalizeTheme(value); // -> 'dark' | 'soft-spectrum'
export function normalizeUiScale(value); // -> number, 0.8..1.2
export function applyUiPreferences(root, { theme, scale, reduceMotion, highContrast });
export function loadUiPreferences(store); // -> normalized preference object

// js/settings-controller.js
export function selectSettingsTab(tabs, sections, tabId); // -> selected tabId
export function initSettingsTabs(root = document); // -> { select(tabId), destroy() }

// js/console.js
export const COMMANDS;
export function commandNeedsHost(command); // -> boolean
```

---

### Task 1: Theme and UI Scale Model

**Files:**
- Create: `js/ui-theme.js`
- Create: `tests/ui-foundation.test.mjs`

**Interfaces:**
- Produces: `UI_THEMES`, `normalizeTheme`, `normalizeUiScale`, `applyUiPreferences`, `loadUiPreferences`.
- Consumes: Store-compatible object exposing `get(key)`.

- [ ] **Step 1: Write failing normalization tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTheme,
  normalizeUiScale,
  applyUiPreferences,
  loadUiPreferences
} from '../js/ui-theme.js';

test('theme and UI scale normalization reject unsupported values', () => {
  assert.equal(normalizeTheme('soft-spectrum'), 'soft-spectrum');
  assert.equal(normalizeTheme('neon-script'), 'dark');
  assert.equal(normalizeUiScale(0.2), 0.8);
  assert.equal(normalizeUiScale(2), 1.2);
  assert.equal(normalizeUiScale('1.05'), 1.05);
  assert.equal(normalizeUiScale('bad'), 1);
});

test('UI preferences hydrate and apply only normalized root state', () => {
  const attrs = new Map();
  const root = {
    dataset: {},
    style: { setProperty: (key, value) => attrs.set(key, value) },
    classList: { toggle: (key, on) => attrs.set(key, on) }
  };
  const store = { get: key => ({ uiTheme: 'soft-spectrum', uiScale: 1.1, settings: { reduceMotion: true, highContrast: false } })[key] };
  const prefs = loadUiPreferences(store);
  applyUiPreferences(root, prefs);
  assert.equal(root.dataset.theme, 'soft-spectrum');
  assert.equal(attrs.get('--ui-scale'), '1.1');
  assert.equal(attrs.get('reduce-motion'), true);
  assert.equal(attrs.get('high-contrast'), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/ui-theme.js`.

- [ ] **Step 3: Implement the minimal theme module**

```js
export const UI_THEMES = Object.freeze(['dark', 'soft-spectrum']);

export function normalizeTheme(value) {
  return UI_THEMES.includes(value) ? value : 'dark';
}

export function normalizeUiScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.min(1.2, Math.max(0.8, scale)) : 1;
}

export function loadUiPreferences(store) {
  const settings = store?.get?.('settings') || {};
  return {
    theme: normalizeTheme(store?.get?.('uiTheme')),
    scale: normalizeUiScale(store?.get?.('uiScale')),
    reduceMotion: settings.reduceMotion === true,
    highContrast: settings.highContrast === true
  };
}

export function applyUiPreferences(root, preferences) {
  if (!root) return;
  const theme = normalizeTheme(preferences?.theme);
  const scale = normalizeUiScale(preferences?.scale);
  root.dataset.theme = theme;
  root.style.setProperty('--ui-scale', String(scale));
  root.classList.toggle('reduce-motion', preferences?.reduceMotion === true);
  root.classList.toggle('high-contrast', preferences?.highContrast === true);
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: 2 tests pass.

- [ ] **Step 5: Human review checkpoint**

Review normalization ranges and public interfaces. Do not commit automatically.

---

### Task 2: Theme Tokens and Shared Responsive Shell

**Files:**
- Create: `css/ui-tokens.css`
- Create: `css/ui-shell.css`
- Modify: `index.html:8-9`

**Interfaces:**
- Consumes root attributes/classes from `applyUiPreferences()`.
- Produces CSS tokens used by all later UI phases.

- [ ] **Step 1: Add a static failing asset assertion**

Append to `tests/ui-foundation.test.mjs`:

```js
import fs from 'node:fs';

test('index loads UI foundation after legacy styles', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const legacy = html.indexOf('css/style.css');
  const tokens = html.indexOf('css/ui-tokens.css');
  const shell = html.indexOf('css/ui-shell.css');
  assert.ok(legacy >= 0 && tokens > legacy && shell > tokens);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL because the new stylesheets are absent.

- [ ] **Step 3: Add stylesheet links after `style.css`**

```html
<link rel="stylesheet" href="css/style.css?v=1.74">
<link rel="stylesheet" href="css/ui-tokens.css?v=1">
<link rel="stylesheet" href="css/ui-shell.css?v=1">
```

- [ ] **Step 4: Define the exact token sets in `css/ui-tokens.css`**

```css
:root,
:root[data-theme="dark"] {
  --ui-scale: 1;
  --ui-bg: #070b14;
  --ui-bg-elevated: #0e1625;
  --ui-surface: #141f31;
  --ui-surface-2: #1a2940;
  --ui-border: #2b3b55;
  --ui-text: #f4f7fb;
  --ui-muted: #a9b5c7;
  --ui-primary: #ff725e;
  --ui-primary-hover: #ff8a76;
  --ui-info: #55d7f2;
  --ui-focus: #8be8fa;
  --ui-danger: #ff5d72;
  --ui-success: #4ed7a8;
  --ui-warning: #ffc665;
  --ui-shadow: 0 24px 64px rgb(0 0 0 / 0.42);
}

:root[data-theme="soft-spectrum"] {
  --ui-bg: #0b0b18;
  --ui-bg-elevated: #121329;
  --ui-surface: #191b36;
  --ui-surface-2: #22264a;
  --ui-border: #393e67;
  --ui-text: #f7f5ff;
  --ui-muted: #b9b4cf;
  --ui-primary: #bb8cff;
  --ui-primary-hover: #cba8ff;
  --ui-info: #68d9df;
  --ui-focus: #ffd07d;
  --ui-danger: #ff83a8;
  --ui-success: #74dfbd;
  --ui-warning: #ffd07d;
}

:focus-visible {
  outline: 3px solid var(--ui-focus);
  outline-offset: 3px;
}

.reduce-motion *,
.reduce-motion *::before,
.reduce-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.001ms !important;
}

.high-contrast {
  --ui-border: #ffffff;
  --ui-muted: #ffffff;
}
```

- [ ] **Step 5: Add shared layout rules in `css/ui-shell.css`**

```css
html { font-size: calc(16px * var(--ui-scale)); }
body { color: var(--ui-text); background: var(--ui-bg); }
button, input, select { min-height: 44px; }
.screen { max-width: 100vw; max-height: 100dvh; overflow: hidden; }
.settings-overlay { display: grid; place-items: center; padding: clamp(8px, 2vw, 24px); }
.settings-modal { width: min(920px, 100%); max-height: calc(100dvh - 32px); color: var(--ui-text); background: var(--ui-bg-elevated); border-color: var(--ui-border); }
.settings-scroll { display: block; overflow-y: auto; overscroll-behavior: contain; }
.settings-section { width: min(680px, 100%); margin-inline: auto; color: var(--ui-text); background: var(--ui-surface); border-color: var(--ui-border); }
.settings-section-heading p, .settings-hint { color: var(--ui-muted); }
#scoreboard-overlay { inset: 0; top: auto; left: auto; transform: none; width: auto; min-width: 0; display: grid; place-items: center; overflow: hidden; }
#scoreboard-overlay.hidden { display: none; }
.scoreboard-shell { width: min(980px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); color: var(--ui-text); background: var(--ui-bg-elevated); border-color: var(--ui-border); }
.scoreboard-scroll { overflow: auto; }
@media (max-width: 720px), (max-height: 720px) {
  .settings-modal { max-height: calc(100dvh - 16px); border-radius: 18px; }
  .settings-header { min-height: 64px; padding: 8px 12px; }
  .settings-tabs { overflow-x: auto; }
  .settings-scroll { padding: 12px; }
  .settings-section { padding: 14px; }
}
```

- [ ] **Step 6: Run focused test and syntax check**

Run: `node --test tests/ui-foundation.test.mjs && npm run check`

Expected: UI foundation tests pass; JS check exits 0.

- [ ] **Step 7: Human visual checkpoint**

Open `http://localhost:8000`, inspect main menu/settings at 1280x720 before expanding scope. Do not commit automatically.

---

### Task 3: Consolidate Settings and Add Theme/UI Scale Controls

**Files:**
- Create: `js/settings-controller.js`
- Modify: `tests/ui-foundation.test.mjs`
- Modify: `index.html:390-538,1049-1070`
- Modify: `js/main.js:1-20,1006-1112`

**Interfaces:**
- Consumes `applyUiPreferences`, `loadUiPreferences`, Store.
- Produces `initSettingsTabs(root)` and one active settings DOM.

- [ ] **Step 1: Write failing tab-controller tests**

```js
import { selectSettingsTab } from '../js/settings-controller.js';

test('settings tabs select one named section', () => {
  const tabs = ['controls', 'video', 'game', 'access'].map(id => ({ dataset: { tab: id }, classList: fakeClassList() }));
  const sections = tabs.map(tab => ({ dataset: { settingsSection: tab.dataset.tab }, hidden: false }));
  assert.equal(selectSettingsTab(tabs, sections, 'video'), 'video');
  assert.deepEqual(sections.map(section => section.hidden), [true, false, true, true]);
  assert.equal(tabs[1].classList.has('selected'), true);
});

function fakeClassList() {
  const values = new Set();
  return {
    toggle: (name, on) => on ? values.add(name) : values.delete(name),
    has: name => values.has(name)
  };
}
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `settings-controller.js`.

- [ ] **Step 3: Implement named tab selection**

```js
export function selectSettingsTab(tabs, sections, requested) {
  const ids = tabs.map(tab => tab.dataset.tab);
  const selected = ids.includes(requested) ? requested : ids[0];
  tabs.forEach(tab => {
    const active = tab.dataset.tab === selected;
    tab.classList.toggle('selected', active);
    tab.setAttribute?.('aria-selected', String(active));
  });
  sections.forEach(section => {
    section.hidden = section.dataset.settingsSection !== selected;
  });
  return selected;
}

export function initSettingsTabs(root = document) {
  const tabs = [...root.querySelectorAll('.settings-tab')];
  const sections = [...root.querySelectorAll('[data-settings-section]')];
  const listeners = tabs.map(tab => {
    const listener = () => selectSettingsTab(tabs, sections, tab.dataset.tab);
    tab.addEventListener('click', listener);
    return [tab, listener];
  });
  selectSettingsTab(tabs, sections, tabs[0]?.dataset.tab);
  return {
    select: id => selectSettingsTab(tabs, sections, id),
    destroy: () => listeners.forEach(([tab, listener]) => tab.removeEventListener('click', listener))
  };
}
```

- [ ] **Step 4: Convert tab markup from numeric indexes to names**

```html
<button class="settings-tab selected" data-tab="controls" role="tab">Controls</button>
<button class="settings-tab" data-tab="video" role="tab">Video</button>
<button class="settings-tab" data-tab="game" role="tab">Game</button>
<button class="settings-tab" data-tab="access" role="tab">Access</button>
```

Add matching `data-settings-section="controls|video|game|access"` to the four `.settings-section` elements.

- [ ] **Step 5: Add Theme and UI Scale rows to Access**

```html
<div class="settings-row">
  <label for="setting-theme">Interface Theme</label>
  <select id="setting-theme">
    <option value="dark">Dark</option>
    <option value="soft-spectrum">Soft Spectrum</option>
  </select>
</div>
<div class="settings-row settings-row-scale">
  <label for="setting-ui-scale">UI Scale</label>
  <input id="setting-ui-scale" type="range" min="80" max="120" value="100" step="5">
  <output id="setting-ui-scale-value" for="setting-ui-scale">100%</output>
</div>
```

- [ ] **Step 6: Delete the complete legacy `#settings-panel` block**

Delete `index.html:1049-1070`. Do not leave duplicate `set-fov`, `set-sens`, `set-music`, `set-sfx`, or `set-bloom` controls.

- [ ] **Step 7: Replace numeric tab logic in `main.js`**

```js
import { applyUiPreferences, loadUiPreferences, normalizeTheme, normalizeUiScale } from './ui-theme.js';
import { initSettingsTabs } from './settings-controller.js';

this.settingsTabs = initSettingsTabs(document);
applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
```

Bind exact persistence:

```js
bindSetting('setting-theme', event => {
  const theme = normalizeTheme(event.target.value);
  this.store.set('uiTheme', theme);
  applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
});

bindSetting('setting-ui-scale', event => {
  const scale = normalizeUiScale(Number(event.target.value) / 100);
  this.store.set('uiScale', scale);
  document.getElementById('setting-ui-scale-value').textContent = `${Math.round(scale * 100)}%`;
  applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
});
```

Hydrate both controls from `loadUiPreferences(this.store)` during setup.

- [ ] **Step 8: Reapply root preferences inside accessibility changes**

After `this.applyAccessibility()` in `bindAccessibility`, call:

```js
applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
```

- [ ] **Step 9: Run focused and full checks**

Run: `node --test tests/ui-foundation.test.mjs && npm test && npm run check`

Expected: all tests pass; check exits 0.

- [ ] **Step 10: Human visual checkpoint**

Verify each settings tab centers, scrolls, and switches theme immediately. Do not commit automatically.

---

### Task 4: Secure and Stabilize Scoreboard Rendering

**Files:**
- Modify: `tests/ui-foundation.test.mjs`
- Modify: `js/ui.js:131-170`
- Modify: `js/main.js:133-152` plus the matching keyup listener
- Modify: `css/style.css:710-723,5449-5459`

**Interfaces:**
- Consumes scoreboard stats.
- Produces safe DOM rows and hold-Tab behavior.

- [ ] **Step 1: Write a failing fake-DOM XSS regression test**

```js
import { UI } from '../js/ui.js';

test('scoreboard keeps hostile player names as text', () => {
  const tbody = fakeElement('tbody');
  globalThis.window = { __store: { get: () => 7 } };
  globalThis.document = {
    getElementById: id => id === 'scoreboard-body' ? tbody : null,
    createElement: tag => fakeElement(tag)
  };
  const ui = Object.create(UI.prototype);
  ui.updateScoreboardTable('scoreboard-body', [{
    name: '<img src=x onerror=alert(1)>', team: 'red', rank: 'R', level: 4,
    score: 1, deflections: 2, hits: 3, isYou: false
  }]);
  assert.equal(tbody.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(tbody.children[0].innerHTMLWrites, 0);
});

function fakeElement(tag) {
  return {
    tag, children: [], textContent: '', className: '', innerHTMLWrites: 0,
    appendChild(child) { this.children.push(child); return child; },
    set innerHTML(value) { this.innerHTMLWrites++; this.children = []; },
    get innerHTML() { return ''; }
  };
}
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL because scoreboard writes `row.innerHTML`.

- [ ] **Step 3: Replace row HTML with safe cells**

```js
const values = [
  `${p.name}${p.isYou ? ' (YOU)' : ''}`,
  String(p.team || '').toUpperCase(),
  String(rank),
  String(level),
  String(p.score ?? 0),
  String(p.deflections ?? 0),
  String(p.hits ?? 0)
];
values.forEach((value, cellIndex) => {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (cellIndex === 0) cell.className = `team-${p.team}`;
  row.appendChild(cell);
});
```

Use stable bot fallback level `Math.min(20, i + 1)` instead of `Math.random()`.

- [ ] **Step 4: Make scoreboard hold-Tab explicit**

Keep current PLAYING guard on keydown. Add:

```js
document.addEventListener('keyup', event => {
  if (event.code !== 'Tab') return;
  event.preventDefault();
  this.ui.hideScoreboard();
}, { signal: this._mainAbort.signal });
```

Also hide scoreboard when chat, console, pause, game-over, or menu opens.

- [ ] **Step 5: Remove obsolete scoreboard positioning from legacy CSS**

Delete the old `top: 50%`, `left: 50%`, `transform`, panel background, and `min-width: 500px` declarations from `style.css:712-723`. Keep final presentation in `ui-shell.css`; do not define `#scoreboard-overlay` position twice.

- [ ] **Step 6: Run tests and checks**

Run: `node --test tests/ui-foundation.test.mjs && npm test && npm run check`

Expected: hostile name test passes; all existing tests pass.

- [ ] **Step 7: Browser scoreboard proof**

Start a solo bot match, wait for PLAYING, hold Tab, capture screenshot. Verify overlay bounds are centered and release hides it.

---

### Task 5: Enforce Console Host Authority

**Files:**
- Modify: `tests/ui-foundation.test.mjs`
- Modify: `js/console.js:6-343,345-366,550-566`
- Modify: `js/main.js` where Console is initialized/network role changes

**Interfaces:**
- Produces exported `COMMANDS`, `commandNeedsHost(command)`.
- Consumes `game.network.connected` and `game.network.isHost`.

- [ ] **Step 1: Write failing authority tests**

```js
import { Console, COMMANDS, commandNeedsHost } from '../js/console.js';

test('server commands require host while client commands remain local', () => {
  assert.equal(commandNeedsHost(COMMANDS.sv_gravity), true);
  assert.equal(commandNeedsHost(COMMANDS.mp_restartgame), true);
  assert.equal(commandNeedsHost(COMMANDS.cl_showdamage), false);
});

test('non-host console cannot execute host command', () => {
  let changed = false;
  const instance = new Console();
  instance.game = {
    network: { connected: true, isHost: false },
    ball: { set gravity(value) { changed = true; } }
  };
  instance.outputEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };
  instance.execute('sv_gravity -5');
  assert.equal(changed, false);
  assert.match(instance.lines.at(-1), /host/i);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL because `COMMANDS` and `commandNeedsHost` are not exported and execute lacks a guard.

- [ ] **Step 3: Mark host commands explicitly**

Export the command table:

```js
export const COMMANDS = {
```

Add `hostOnly: true` to every command that changes shared game state:

- all `sv_*` commands except purely local view commands;
- `mp_restartgame`;
- `endgame_1`;
- `endgame_2`.

Keep `help`, `clear`, `cl_*`, and `r_fullbright` local in Phase 1.

- [ ] **Step 4: Add the authority helper and execute guard**

```js
export function commandNeedsHost(command) {
  return command?.hostOnly === true;
}
```

Before `command.run`:

```js
const isHost = !this.game?.network?.connected || this.game.network.isHost === true;
if (commandNeedsHost(command) && !isHost) {
  this.log(`Host only command: ${cmd}`);
  return false;
}
```

Return the command result from `execute()` so tests and callers can observe rejection.

- [ ] **Step 5: Filter host-only help/autocomplete for clients or label them**

Do not hide commands silently. Append `[HOST]` in `help` and autocomplete descriptions when `hostOnly` is true.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/ui-foundation.test.mjs && npm test && npm run check`

Expected: authority tests and all existing tests pass.

- [ ] **Step 7: Two-role browser proof**

Host: `sv_gravity -5` succeeds. Client: same command prints `Host only command: sv_gravity` and does not mutate local ball gravity.

---

### Task 6: Integration, Accessibility, and Visual Verification

**Files:**
- Modify only files already touched if verification exposes a defect.
- Update: `MIMO.md` current-state notes after all checks pass.

**Interfaces:**
- Verifies every Task 1-5 deliverable together.

- [ ] **Step 1: Run fresh automated gates**

Run: `npm test && npm run check`

Expected: exit 0; no failed test.

- [ ] **Step 2: Run static Phase 1 assertions**

Check all conditions:

```js
assert(!html.includes('id="settings-panel"'));
assert(html.includes('css/ui-tokens.css'));
assert(html.includes('css/ui-shell.css'));
assert(!uiSource.includes('row.innerHTML'));
assert(shellCss.includes('#scoreboard-overlay'));
assert(shellCss.includes('transform: none'));
```

Run as `node --test tests/ui-foundation.test.mjs`.

Expected: pass.

- [ ] **Step 3: Browser smoke matrix**

For 1280x720, 1366x768, 1920x1080, and ultrawide:

- main menu stays inside viewport;
- settings header and selected tab stay visible;
- settings content centers and scrolls;
- dark and soft-spectrum switch instantly;
- 80%, 100%, 120% UI scale remains usable;
- scoreboard centers and scrolls;
- keyboard focus ring is visible.

- [ ] **Step 4: Accessibility proof**

Verify reduced-motion disables decorative transitions and high-contrast increases border/text distinction. Use browser computed styles; do not rely only on visual judgment.

- [ ] **Step 5: Console and asset proof**

Read browser console after menu, settings, lobby, and match load. Expected: no new uncaught JS exception, no new CSS 404. Record existing GLTF texture 404s separately if not fixed in this phase.

- [ ] **Step 6: Update current-state documentation**

Add a concise Phase 1 entry to `MIMO.md` listing:

- two themes and UI scale;
- one settings system;
- centered safe scoreboard;
- console host authority;
- exact automated commands run.

- [ ] **Step 7: Final skeptical review**

Inspect `git diff --check` and `git diff --stat`. Confirm no gameplay/network code changed beyond console authority and scoreboard key handling. Do not commit, push, or open a PR.
