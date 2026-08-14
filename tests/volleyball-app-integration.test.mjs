import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canHostSport, canPlayLocalSport, SPORT_IDS } from '../js/sports.js';

const load = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Volleyball exposes local practice without opening P2P hosting', () => {
  assert.equal(canPlayLocalSport(SPORT_IDS.VOLLEYBALL), true);
  assert.equal(canHostSport(SPORT_IDS.VOLLEYBALL), false);
  assert.equal(canPlayLocalSport(SPORT_IDS.DODGEBALL), true);
  assert.equal(canHostSport(SPORT_IDS.DODGEBALL), true);
});

test('directory enables only the local Volleyball CTA and restores Dodgeball copy', async () => {
  const [html, source] = await Promise.all([load('index.html'), load('js/main.js')]);
  assert.match(html, /id="btn-mp-solo-label">Solo vs Bots</);
  const presentationStart = source.indexOf('    _applySportPresentation() {');
  const presentationEnd = source.indexOf('\n    _adoptTrustedLobbySport(', presentationStart);
  const presentation = source.slice(presentationStart, presentationEnd);
  for (const id of ['btn-mp-quick', 'btn-mp-create', 'btn-mp-host-strip', 'btn-mp-join', 'btn-mp-refresh', 'btn-mp-party-follow']) {
    assert.match(presentation, new RegExp(`'${id}'`));
  }
  assert.match(presentation, /const enabled = hostEnabled \|\| localPlayEnabled/);
  assert.match(presentation, /'Local Practice' : 'Solo vs Bots'/);
  assert.match(presentation, /directory\.inert = !hostEnabled/);

  const soloStart = source.indexOf("        bind('btn-mp-solo'");
  const solo = source.slice(soloStart, soloStart + 720);
  assert.match(solo, /SPORT_IDS\.VOLLEYBALL[\s\S]*?_startVolleyballPractice\(\)/);
  assert.match(solo, /this\.game\.startSolo\(\);[\s\S]*?this\._armFirstSoloBotGuard\(\);/,
    'Dodgeball solo path must remain intact');
});

test('local practice owns mount, simulation branch, clamp and idempotent teardown', async () => {
  const source = await load('js/main.js');
  assert.match(source, /import \{ createVolleyballPracticeRuntime \} from '\.\/volleyball-practice-runtime\.js'/);
  assert.match(source, /this\._activeSportSession = null/);

  const startIndex = source.indexOf('    _startVolleyballPractice() {');
  const exitIndex = source.indexOf('    _exitVolleyballPractice(', startIndex);
  const nextMethod = source.indexOf('\n    _adoptTrustedLobbySport(', exitIndex);
  const start = source.slice(startIndex, exitIndex);
  const exit = source.slice(exitIndex, nextMethod);
  assert.match(start, /if \(this\.network\?\.connected\)[\s\S]*?return false/);
  assert.match(start, /clearInterval\(this\._mpRefreshTimer\)/);
  assert.equal((start.match(/runtime\.mount\(/g) || []).length, 1);
  assert.match(start, /this\.game\.setState\(STATES\.COSMETIC_PRACTICE\)/);
  assert.match(start, /this\.game\._cosmeticPractice = false/);
  assert.doesNotMatch(start, /productAnalytics|reward|store\./);

  assert.match(exit, /if \(!session\) return false/);
  assert.match(exit, /this\._activeSportSession = null/);
  assert.equal((exit.match(/session\.runtime\.dispose\(\)/g) || []).length, 1);
  assert.match(exit, /this\.game\.selectMap\(restore\.mapId\)/);
  assert.match(exit, /this\.player\.position\.set\(restore\.px, restore\.py, restore\.pz\)/);
  assert.match(exit, /this\._openMultiplayerForSport\(SPORT_IDS\.VOLLEYBALL\)/);

  const loopStart = source.indexOf('        if (this._activeSportSession) {', source.indexOf('    loop() {'));
  const loopEnd = source.indexOf('        if (this.game._killcamActive)', loopStart);
  const loop = source.slice(loopStart, loopEnd);
  assert.match(loop, /this\.player\.update\(dt\)/);
  assert.match(loop, /this\.player\.position\.x = Math\.max\(-8\.65, Math\.min\(8\.65/);
  assert.match(loop, /this\.player\.position\.z = Math\.max\(-8\.65, Math\.min\(-0\.35/);
  assert.match(loop, /this\._activeSportSession\.runtime\.update\(dt\)/);
  assert.doesNotMatch(loop, /this\.game\.update\(dt\)/,
    'Volleyball runtime must never enter Dodgeball combat simulation');
});

test('practice input is capture-owned while Space remains player jump', async () => {
  const source = await load('js/main.js');
  const start = source.indexOf('    _createVolleyballInputTarget() {');
  const end = source.indexOf('\n    _createVolleyballHudAdapter()', start);
  const input = source.slice(start, end);
  assert.match(input, /new Set\(\['KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyB', 'KeyT'\]\)/);
  assert.doesNotMatch(input, /'Space'/);
  assert.match(input, /window\.addEventListener\(type, capture, true\)/);
  assert.match(input, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(input, /#volleyball-practice-hud button/,
    'HUD buttons must remain clickable when practice owns pointer input');
  assert.match(source, /window\.addEventListener\('mousedown', session\.mouseDownHandler, true\)/,
    'mousedown must not leak to the Dodgeball Player attack handler after pointerdown');
  assert.match(source, /document\.addEventListener\('pointerlockchange', session\.pointerLockHandler\)/);
  const pointerStart = source.indexOf('        session.pointerLockHandler = () =>');
  const pointerEnd = source.indexOf('        session.blurHandler', pointerStart);
  const pointerHandler = source.slice(pointerStart, pointerEnd);
  assert.match(pointerHandler, /session\.pointerLockRetry = false/,
    'pointer-lock loss must pause without automatic recapture after Alt-Tab or HUD focus');
  assert.doesNotMatch(pointerHandler, /_exitVolleyballPractice\(/,
    'only explicit Exit or Escape may end local practice');
  assert.match(source, /this\._activeSportSession\.focused && !pauseOpen/,
    'blurred local practice must pause its simulation');
});

test('semantic Volleyball HUD stays compact at desktop and 375px', async () => {
  const [html, css] = await Promise.all([load('index.html'), load('css/polish.css')]);
  assert.match(html, /id="volleyball-practice-hud"[^>]*role="region"[^>]*aria-label="Local Volleyball practice status"/);
  for (const id of ['volleyball-practice-home', 'volleyball-practice-away', 'volleyball-practice-sets',
    'volleyball-practice-phase', 'volleyball-practice-expected', 'volleyball-practice-restart',
    'volleyball-practice-exit']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.volleyball-practice-hud \{[\s\S]*?width: min\(620px, calc\(100vw - 32px\)\)/);
  assert.match(css, /@media \(max-width: 480px\) \{[\s\S]*?\.volleyball-practice-hud \{[^}]*width: calc\(100vw - 16px\)/);
  assert.match(css, /\.volleyball-practice-actions button \{[^}]*min-width: 0;[^}]*min-height: 44px;[^}]*flex: 1;/);
  assert.match(css, /body\.volleyball-practice-active :is\([\s\S]*?#incoming-indicator[\s\S]*?#network-diagnostics/);
  assert.match(css, /#multiplayer-menu\[data-sport="volleyball"\] \.mp-secondary-actions > :not\(#btn-mp-solo\) \{ display: none; \}/,
    'only Local Practice may remain visible in the gated action row');
  const gatedDesktopStart = css.indexOf('/* A gated Volleyball directory');
  const gatedDesktopEnd = css.indexOf('@media (prefers-reduced-motion: reduce)', gatedDesktopStart);
  const gatedDesktop = css.slice(gatedDesktopStart, gatedDesktopEnd);
  assert.doesNotMatch(gatedDesktop, /\.mp-secondary-actions,/,
    'the gated route must not hide the parent that owns Local Practice');
});
