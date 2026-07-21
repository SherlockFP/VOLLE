import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeTheme,
  normalizeUiScale,
  applyUiPreferences,
  loadUiPreferences
} from '../js/ui-theme.js';
import { selectSettingsTab } from '../js/settings-controller.js';

async function loadConsoleModule() {
  const source = fs.readFileSync(new URL('../js/console.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('// Host (lobby creator) can change game vars via commands.', 'const GAME_MODES = {}; const MAPS = {};\n// Host (lobby creator) can change game vars via commands.');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

const { Console, COMMANDS, commandNeedsHost } = await loadConsoleModule();

async function loadUiClass() {
  const source = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return (await import(moduleUrl)).UI;
}

function fakeClassList() {
  const values = new Set();
  return {
    toggle: (name, on) => on ? values.add(name) : values.delete(name),
    has: name => values.has(name)
  };
}

function fakeElement(tag) {
  return {
    tag,
    children: [],
    textContent: '',
    className: '',
    innerHTMLWrites: 0,
    appendChild(child) { this.children.push(child); return child; },
    set innerHTML(value) { this.innerHTMLWrites++; this.children = []; },
    get innerHTML() { return ''; }
  };
}

test('shared console commands require host while view commands remain local', () => {
  const sharedCommands = [
    ...Object.keys(COMMANDS).filter(name => name.startsWith('sv_') && name !== 'sv_hand'),
    'mp_restartgame',
    'endgame_1',
    'endgame_2'
  ];
  for (const name of sharedCommands) {
    assert.equal(commandNeedsHost(COMMANDS[name]), true, name);
  }
  for (const name of ['help', 'clear', 'sv_hand', 'cl_showfps', 'cl_hud', 'cl_showdamage', 'r_fullbright']) {
    assert.equal(commandNeedsHost(COMMANDS[name]), false, name);
  }
});

test('connected non-host console rejects a host command before mutation', () => {
  let gravity = -9.8;
  const instance = new Console();
  instance.game = {
    network: { connected: true, isHost: false },
    ball: {
      get gravity() { return gravity; },
      set gravity(value) { gravity = value; }
    }
  };
  instance.outputEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };

  assert.equal(instance.execute('sv_gravity -5'), false);
  assert.equal(gravity, -9.8);
  assert.equal(instance.lines.at(-1), 'Host only command: sv_gravity');
});

test('offline and connected host consoles can execute a shared command', () => {
  for (const network of [
    { connected: false, isHost: false },
    { connected: true, isHost: true }
  ]) {
    const instance = new Console();
    instance.game = { network, ball: { gravity: -9.8 } };
    instance.outputEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };

    assert.equal(instance.execute('sv_gravity -5'), true);
    assert.equal(instance.game.ball.gravity, -5);
  }
});

test('connected non-host console can still execute a local cl command', () => {
  const previousDocument = globalThis.document;
  const damageMeter = { style: { display: 'none' } };
  globalThis.document = { getElementById: id => id === 'damage-meter' ? damageMeter : null };
  try {
    const instance = new Console();
    instance.game = { network: { connected: true, isHost: false } };
    instance.outputEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };

    assert.equal(instance.execute('cl_showdamage 1'), true);
    assert.equal(damageMeter.style.display, '');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('help and autocomplete label host-only commands without hiding them', () => {
  const instance = new Console();
  instance.game = { network: { connected: true, isHost: false } };
  instance.outputEl = { textContent: '', scrollTop: 0, scrollHeight: 0 };
  assert.equal(instance.execute('help'), true);
  assert.match(instance.lines.find(line => line.includes('sv_gravity')), /\[HOST\]/);

  let autocompleteHtml = '';
  instance.inputEl = { value: 'sv_g' };
  instance._acEl = {
    style: {},
    set innerHTML(value) { autocompleteHtml = value; },
    get innerHTML() { return autocompleteHtml; },
    querySelectorAll: () => []
  };
  instance._acIdx = -1;
  instance._updateAutocomplete();
  assert.match(autocompleteHtml, /sv_gravity/);
  assert.match(autocompleteHtml, /\[HOST\]/);
});

test('scoreboard keeps hostile player names as text and uses stable bot levels', async () => {
  const tbody = fakeElement('tbody');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { __store: { get: () => 7 } };
  globalThis.document = {
    getElementById: id => id === 'scoreboard-body' ? tbody : null,
    createElement: tag => fakeElement(tag)
  };

  try {
    const UI = await loadUiClass();
    const ui = Object.create(UI.prototype);
    ui.updateScoreboardTable('scoreboard-body', [
      {
        name: '<img src=x onerror=alert(1)>', team: 'red', rank: 'R', level: 4,
        score: 1, deflections: 2, hits: 3, isYou: false
      },
      {
        name: 'Bot', team: 'blue', isBot: true,
        score: 0, deflections: 0, hits: 0, isYou: false
      }
    ]);

    assert.equal(tbody.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(tbody.children[0].innerHTMLWrites, 0);
    assert.equal(tbody.children[1].children[3].textContent, '2');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test('Tab release prevents browser focus movement before hiding the scoreboard', () => {
  const mainSource = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(
    mainSource,
    /if \(e\.code !== 'Tab'\) return;\s*e\.preventDefault\(\);\s*this\.ui\.hideScoreboard\(\);/
  );
});

test('conflicting chat, console, pause, settings, and screen transitions hide the scoreboard', () => {
  const mainSource = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const uiSource = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(mainSource, /if \(e\.code === 'Backquote'\) this\.ui\.hideScoreboard\(\);/);
  assert.match(mainSource, /openChat\(\) \{\s*this\.ui\.hideScoreboard\(\);/);
  assert.match(mainSource, /openSettingsModal\(\) \{\s*this\.ui\.hideScoreboard\(\);/);
  assert.match(mainSource, /this\.game\.setState\(STATES\.PAUSED\);\s*this\.ui\.hideScoreboard\(\);/);
  assert.match(uiSource, /showScreen\(name\) \{\s*this\.hideScoreboard\(\);/);
});

test('settings tabs select one named section', () => {
  const tabs = ['controls', 'video', 'game', 'access'].map(id => ({
    dataset: { tab: id },
    classList: fakeClassList()
  }));
  const sections = tabs.map(tab => ({
    dataset: { settingsSection: tab.dataset.tab },
    hidden: false
  }));
  assert.equal(selectSettingsTab(tabs, sections, 'video'), 'video');
  assert.deepEqual(sections.map(section => section.hidden), [true, false, true, true]);
  assert.equal(tabs[1].classList.has('selected'), true);
});

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

test('index loads UI foundation after legacy styles', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const legacy = html.indexOf('css/style.css');
  const tokens = html.indexOf('css/ui-tokens.css');
  const shell = html.indexOf('css/ui-shell.css');
  assert.ok(legacy >= 0 && tokens > legacy && shell > tokens);
});

test('index declares a local favicon so the browser does not probe a missing default path', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<link[^>]+rel="icon"[^>]+href="(?:data:image\/svg\+xml,|assets\/generated\/warrball-logo(?:-v2|-transparent-v1)?\.png)"/);
});

test('Phase 1 static integration assertions remain true', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const uiSource = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const shellCss = fs.readFileSync(new URL('../css/ui-shell.css', import.meta.url), 'utf8');
  const scoreboardMethod = uiSource.slice(
    uiSource.indexOf('updateScoreboardTable('),
    uiSource.indexOf('showScoreboard(', uiSource.indexOf('updateScoreboardTable('))
  );
  assert.ok(!html.includes('id="settings-panel"'));
  assert.ok(html.includes('css/ui-tokens.css'));
  assert.ok(html.includes('css/ui-shell.css'));
  assert.ok(!scoreboardMethod.includes('row.innerHTML'));
  assert.ok(shellCss.includes('#scoreboard-overlay'));
  assert.ok(shellCss.includes('transform: none'));
});

const shellCss = fs.readFileSync(new URL('../css/ui-shell.css', import.meta.url), 'utf8');
const tokenCss = fs.readFileSync(new URL('../css/ui-tokens.css', import.meta.url), 'utf8');
const legacyCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return shellCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

test('scoreboard overlay stays fixed to every viewport edge and centers its shell', () => {
  const rule = cssRule('#scoreboard-overlay');
  assert.match(rule, /position:\s*fixed/);
  assert.match(rule, /inset:\s*0/);
  assert.doesNotMatch(rule, /(?:top|right|bottom|left):\s*auto/);
  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /place-items:\s*center/);
});

test('scoreboard shell constrains overflowing rows to its scroll region', () => {
  const shell = cssRule('.scoreboard-shell');
  const scroll = cssRule('#scoreboard-overlay .scoreboard-scroll');
  assert.match(shell, /display:\s*flex/);
  assert.match(shell, /flex-direction:\s*column/);
  assert.match(shell, /box-sizing:\s*border-box/);
  assert.match(scroll, /min-height:\s*0/);
  assert.match(scroll, /flex:\s*1 1 auto/);
});

function assertLegacyScoreboardOwnership(css) {
  const overlayOccurrences = css.match(/#scoreboard-overlay/g) ?? [];
  const shellOccurrences = css.match(/\.scoreboard-shell/g) ?? [];
  assert.equal(
    overlayOccurrences.length,
    1,
    'style.css must contain exactly one raw #scoreboard-overlay occurrence'
  );
  assert.equal(
    shellOccurrences.length,
    0,
    'style.css must contain zero raw .scoreboard-shell occurrences'
  );

  const overlayBody = css.match(/#scoreboard-overlay\s*\{([^}]*)\}/)?.[1];
  assert.notEqual(overlayBody, undefined, 'the sole #scoreboard-overlay occurrence must own a rule block');
  assert.match(overlayBody, /^\s*z-index:\s*160;?\s*$/);
}

test('legacy CSS has exactly one stacking-only scoreboard overlay rule and no shell rules', () => {
  assertLegacyScoreboardOwnership(legacyCss);
});

test('legacy scoreboard ownership rejects grouped and qualified duplicate selectors', () => {
  const validLegacyCss = '#scoreboard-overlay { z-index: 160; }';
  const duplicateSelectors = [
    ['grouped overlay', '.other, #scoreboard-overlay { inset: 0; }'],
    ['qualified overlay', 'body #scoreboard-overlay { display: grid; }'],
    ['grouped shell', '.other, .scoreboard-shell { padding: 1rem; }'],
    ['qualified shell', 'body .scoreboard-shell { width: 100%; }']
  ];

  for (const [description, duplicateRule] of duplicateSelectors) {
    assert.throws(
      () => assertLegacyScoreboardOwnership(`${validLegacyCss}\n${duplicateRule}`),
      undefined,
      description
    );
  }
});

test('settings overlay provides a definite full-width grid track for the 920px modal', () => {
  const overlay = cssRule('.settings-overlay');
  assert.match(overlay, /width:\s*100%/);
  assert.match(overlay, /box-sizing:\s*border-box/);
  assert.match(overlay, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(cssRule('.settings-modal'), /width:\s*min\(920px,\s*100%\)/);
});

test('root high-contrast tokens outrank the selected theme tokens', () => {
  assert.match(tokenCss, /:root\.high-contrast\s*\{[^}]*--ui-border:\s*#ffffff;[^}]*--ui-muted:\s*#ffffff;/s);
});

test('dark settings and scoreboard descendants use accessible theme text tokens', () => {
  const textSelectors = [
    '#unified-settings .settings-title h2',
    '#unified-settings .settings-tab:hover',
    '#unified-settings .settings-section-heading h3',
    '#unified-settings .settings-row > label:first-child',
    '#unified-settings .settings-row select',
    '#unified-settings .settings-row-scale output',
    '#unified-settings .crosshair-preview-card',
    '#scoreboard-overlay .scoreboard-header h3',
    '#scoreboard-overlay #scoreboard-ping b',
    '#scoreboard-overlay .scoreboard-table',
    '#scoreboard-overlay .scoreboard-table thead'
  ];
  const mutedSelectors = [
    '#unified-settings .settings-kicker',
    '#unified-settings .settings-tab',
    '#unified-settings .settings-close-btn',
    '#unified-settings .settings-section-heading p',
    '#unified-settings .settings-hint',
    '#unified-settings .crosshair-preview-card small',
    '#scoreboard-overlay #scoreboard-ping',
    '#scoreboard-overlay .scoreboard-hint'
  ];

  for (const selector of textSelectors) {
    assert.match(cssRule(selector), /color:\s*var\(--ui-text\)/, selector);
  }
  for (const selector of mutedSelectors) {
    assert.match(cssRule(selector), /color:\s*var\(--ui-muted\)/, selector);
  }
});
