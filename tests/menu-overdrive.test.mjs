// tests/menu-overdrive.test.mjs — contract for the "Night Broadcast" menu layer
// (docs/MENU_DESIGN.md, css/menu-overdrive.css, js/menu-overdrive.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MENU_SCREENS, magnetOffset, shouldWipe, isStill } from '../js/menu-overdrive.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/menu-overdrive.css');
const sw = read('../sw.js');
const main = read('../js/main.js');

function mainMenuBlock() {
    const start = html.indexOf('<div id="main-menu"');
    const end = html.indexOf('<!-- ===== MULTIPLAYER MENU', start);
    return html.slice(start, end);
}

test('menu-overdrive.css is the last local stylesheet and is precached by the service worker', () => {
    const links = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"?]+)/g)].map(match => match[1]);
    assert.equal(links.at(-1), 'css/menu-overdrive.css', 'the menu layer must load after every older sheet');
    assert.match(sw, /'css\/menu-overdrive\.css'/);
    assert.match(sw, /CACHE_V1\s*=\s*'volle-shell-v11'/, 'shell list changed, so the cache name must be bumped');
});

test('the redesign keeps every main-menu control id and handler hook', () => {
    const menu = mainMenuBlock();
    for (const id of [
        'btn-play', 'btn-ranked', 'btn-practice', 'btn-map-editor', 'btn-character', 'btn-battlepass', 'btn-shop',
        'btn-profile', 'btn-play-solo', 'btn-social-lobby', 'btn-tournament', 'btn-avatar', 'btn-how-to-play',
        'btn-settings', 'player-name-input', 'meta-coins', 'meta-bp-tier', 'meta-level', 'menu-hero-canvas',
        'menu-player-name', 'menu-player-elo', 'menu-rank-badge', 'menu-daily-card', 'menu-bp-card',
        'menu-streak-badge', 'menu-featured', 'btn-replays', 'btn-achievements', 'btn-leaderboard',
        'btn-social-center', 'btn-patchnotes', 'friends-sidebar', 'fbar-sheet-handle', 'fbar-toggle',
        'btn-fbar-guest-signup', 'btn-menu-party-invite', 'btn-menu-squad-center', 'party-invite-dialog'
    ]) assert.match(menu, new RegExp(`id="${id}"`), `#${id} must survive the redesign`);
    assert.match(main, /initMenuOverdrive\(\{ signal: this\._mainAbort\.signal \}\)/);
});

test('the headline is real text and every decorative layer is hidden from assistive tech', () => {
    const menu = mainMenuBlock();
    assert.match(menu, /<h1 class="ovd-title">/);
    for (const cls of ['ovd-atmos', 'ovd-wordmark', 'ovd-arc', 'ovd-brand']) {
        assert.match(menu, new RegExp(`class="${cls}" aria-hidden="true"`), `.${cls} must be aria-hidden`);
    }
    for (const key of ['menu.ovdLine1', 'menu.ovdLine2', 'menu.ovdLine3', 'menu.ovdLive', 'menu.ovdSeries', 'menu.ovdLede']) {
        assert.ok(menu.includes(`data-i18n="${key}"`), `${key} must be localised`);
    }
});

test('ambient motion stays on the compositor: no SMIL, and looping keyframes animate only transform/opacity', () => {
    assert.doesNotMatch(mainMenuBlock(), /<animate(Motion)?\b/, 'SMIL restyles and relayouts the page every frame');
    const infinite = new Set([...css.matchAll(/animation(?:-name)?:\s*([a-zA-Z]+)[^;]*infinite/g)].map(match => match[1]));
    for (const rule of css.matchAll(/(\.ovd-ball-(?:in|out))\s*\{\s*animation-name:\s*(\w+)/g)) infinite.add(rule[2]);
    assert.ok(infinite.size >= 5, `expected the ambient loops to be found (got ${[...infinite]})`);
    for (const name of infinite) {
        const start = css.indexOf(`@keyframes ${name} `);
        assert.ok(start >= 0, `missing @keyframes ${name}`);
        let depth = 0;
        let end = start;
        for (let i = css.indexOf('{', start); i < css.length; i++) {
            if (css[i] === '{') depth++;
            if (css[i] === '}' && --depth === 0) { end = i; break; }
        }
        const props = [...css.slice(start, end).matchAll(/([a-z-]+)\s*:/g)].map(match => match[1]);
        for (const prop of props) assert.ok(['transform', 'opacity'].includes(prop), `@keyframes ${name} animates ${prop}`);
    }
});

test('reduced motion is honoured by the media query and by the in-game toggle mirror', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?:is\(\.ovd-ball-track, \.ovd-spark\) \{ display: none; \}/);
    assert.match(css, /html\.ovd-still #main-menu :is\(\.ovd-ball-track, \.ovd-spark\)/);
    assert.match(css, /html\.ovd-still \.ovd-wipe \{ display: none; \}/);
    const doc = cls => ({ documentElement: { classList: { contains: c => cls.html?.includes(c) } }, body: { classList: { contains: c => cls.body?.includes(c) } } });
    const win = reduce => ({ matchMedia: () => ({ matches: reduce }) });
    assert.equal(isStill(doc({}), win(false)), false);
    assert.equal(isStill(doc({}), win(true)), true);
    assert.equal(isStill(doc({ body: ['reduced-motion'] }), win(false)), true);
    assert.equal(isStill(doc({ html: ['reduce-motion'] }), win(false)), true);
});

test('magnetic PLAY pull is clamped to 6 px and the sheen origin stays inside the slab', () => {
    const rect = { left: 100, top: 200, width: 400, height: 100 };
    assert.deepEqual(magnetOffset(300, 250, rect), { x: 0, y: 0, hx: 50, hy: 50 });
    const far = magnetOffset(2000, -500, rect);
    assert.equal(far.x, 6);
    assert.equal(far.y, -6);
    assert.equal(far.hx, 100);
    assert.equal(far.hy, 0);
    const near = magnetOffset(320, 260, rect);
    assert.ok(Math.abs(near.x - 2.8) < 1e-9 && Math.abs(near.y - 1.4) < 1e-9);
});

test('the screen wipe runs only between two different menu screens and never into gameplay', () => {
    assert.ok(MENU_SCREENS.has('mainMenu') && MENU_SCREENS.has('shop') && MENU_SCREENS.has('lobby'));
    for (const excluded of ['gameplay', 'hud', 'gameOver', 'postGame']) assert.equal(MENU_SCREENS.has(excluded), false);
    assert.equal(shouldWipe('mainMenu', 'shop', false), true);
    assert.equal(shouldWipe('mainMenu', 'mainMenu', false), false);
    assert.equal(shouldWipe('lobby', 'gameplay', false), false);
    assert.equal(shouldWipe('mainMenu', 'shop', true), false, 'reduced motion skips the wipe');
});

test('pointer depth is published on the consuming layers, not inherited through the whole menu', () => {
    const depth = main.slice(main.indexOf('_setupMenuDepth(menu) {'), main.indexOf('// ===== Help / practice entry'));
    assert.match(depth, /querySelectorAll\('\.ovd-atmos, \.ow-showcase'\)/);
    assert.doesNotMatch(depth, /menu\.style\.setProperty\('--px'/);
    const mouse = main.slice(main.indexOf('_setupMenuMouse() {'), main.indexOf('_setupMenuDepth(menu) {'));
    assert.match(mouse, /glow\.style\.setProperty\('--mx'/);
    assert.doesNotMatch(mouse, /menu\.style\.setProperty\('--mx'/);
});

test('phones keep the social sheet docked so it can never cover PLAY', () => {
    const phone = css.slice(css.indexOf('4. Main menu: phones'), css.indexOf('5. Menu-flow shell'));
    assert.match(phone, /#main-menu \.friends-sidebar:not\(\.collapsed\),[\s\S]*?transform: translateY\(calc\(100% - 58px\)\);/);
    assert.match(phone, /#main-menu \.friends-sidebar\.mobile-open \{ transform: translateY\(0\); \}/);
});
