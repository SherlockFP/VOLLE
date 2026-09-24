// tests/menu-arena.test.mjs — contract for the "Arena Lobby" menu layer
// (docs/MENU_DESIGN.md, css/menu-arena.css).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../js/locales/en.js';
import tr from '../js/locales/tr.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/menu-arena.css');
const sw = read('../sw.js');
const main = read('../js/main.js');

function block(startMarker, endMarker) {
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `could not locate ${startMarker}`);
    return html.slice(start, end);
}
const mainMenu = () => block('<div id="main-menu"', '<!-- ===== MULTIPLAYER MENU');
const multiplayer = () => block('<div id="multiplayer-menu"', '<!-- ===== JOIN MENU');
const section = (from, to) => css.slice(css.indexOf(from), css.indexOf(to));

test('menu-arena.css loads after every older sheet, is precached, and no extra web fonts are loaded', () => {
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(match => match[1]);
    assert.deepEqual(links.slice(-2), ['css/menu-arena.css', 'css/locker.css'],
        'the menu layer loads after every older sheet; only the Locker sheet (same tokens) follows it');
    assert.ok(!links.some(href => /fonts\.googleapis/.test(href)), 'the menu uses the game fonts (DM Sans + Nunito from style.css)');
    assert.doesNotMatch(css, /Big Shoulders|JetBrains Mono/);
    assert.match(sw, /'css\/menu-arena\.css'/);
    assert.doesNotMatch(sw, /menu-overdrive/);
    assert.match(sw, /CACHE_V1\s*=\s*'volle-shell-v13'/, 'shell list changed, so the cache name must be bumped');
    assert.match(sw, /'css\/locker\.css'/);
    assert.equal(fs.existsSync(new URL('../js/menu-overdrive.js', import.meta.url)), false);
    assert.doesNotMatch(main, /menu-overdrive|initMenuOverdrive/);
});

test('every main-menu control id and handler hook survives', () => {
    const menu = mainMenu();
    for (const id of [
        'btn-play', 'btn-ranked', 'btn-practice', 'btn-map-editor', 'btn-character', 'btn-battlepass', 'btn-shop',
        'btn-profile', 'btn-play-solo', 'btn-social-lobby', 'btn-tournament', 'btn-avatar', 'btn-how-to-play',
        'btn-settings', 'player-name-input', 'meta-coins', 'meta-bp-tier', 'meta-level', 'menu-hero-canvas',
        'menu-player-name', 'menu-player-elo', 'menu-rank-badge', 'menu-daily-card', 'menu-bp-card',
        'menu-streak-badge', 'menu-featured', 'btn-replays', 'btn-achievements', 'btn-leaderboard',
        'btn-social-center', 'btn-patchnotes', 'friends-sidebar', 'fbar-sheet-handle', 'fbar-toggle',
        'btn-fbar-guest-signup', 'btn-menu-party-invite', 'btn-menu-squad-center', 'party-invite-dialog'
    ]) assert.match(menu, new RegExp(`id="${id}"`), `#${id} must survive the redesign`);
    for (const id of ['btn-change-sport', 'btn-mp-quick', 'btn-mp-create', 'btn-mp-join', 'btn-mp-solo', 'btn-mp-back',
        'btn-mp-refresh', 'btn-mp-host-strip', 'btn-sport-back', 'mp-lobby-list', 'mp-lobby-heading']) {
        assert.match(multiplayer(), new RegExp(`id="${id}"`), `#${id} must survive the redesign`);
    }
    assert.match(main, /bind\('btn-play-solo', openMultiplayer\)/);
});

test('the AI-landing-page furniture is gone: no tagline, numbering, wordmark, kickers or broadcast decor', () => {
    const menu = mainMenu();
    for (const gone of ['ovd-', 'ovd-title', 'ovd-wordmark', 'ovd-arc', 'ovd-onair', 'ovd-brand']) {
        assert.ok(!menu.includes(gone), `${gone} must not return to the menu markup`);
    }
    assert.doesNotMatch(css, /counter\(|counter-reset|writing-mode:\s*vertical|corner-shape|clip-path:\s*polygon/,
        'no numbered routes, vertical slugs or knife-cut corners');
    assert.doesNotMatch(css, /-webkit-text-stroke/, 'no outlined display type');
    for (const kicker of ['mp.routeKicker', 'mp.commandKicker', 'mp.fastDeploy', 'mp.serverBoard', 'menu.live3d', 'social.network']) {
        assert.ok(!html.includes(`data-i18n="${kicker}"`), `${kicker} kicker must stay removed`);
    }
    for (const key of ['ovdLive', 'ovdSeries', 'ovdLine1', 'ovdLine2', 'ovdLine3', 'ovdLede', 'live3d']) {
        assert.equal(en.menu[key], undefined, `menu.${key} is unused and must be removed`);
        assert.equal(tr.menu[key], undefined, `menu.${key} is unused and must be removed`);
    }
    for (const key of ['routeKicker', 'commandKicker', 'fastDeploy', 'serverBoard']) {
        assert.equal(en.mp[key], undefined);
        assert.equal(tr.mp[key], undefined);
    }
    assert.equal(en.social.network, undefined);
    assert.equal(en.social.socialCaps, undefined);
    assert.equal(tr.social.network, undefined);
    assert.equal(tr.social.socialCaps, undefined);
});

test('PLAY is one chunky, pressable key with localized copy, and the copy is short and game-native', () => {
    const menu = mainMenu();
    assert.match(menu, /<button id="btn-play-solo" class="ow-play"><svg class="ui-icon ow-play-icon" aria-hidden="true">/);
    assert.match(menu, /data-i18n="menu\.playKicker">PLAY<\/b>/);
    assert.match(menu, /data-i18n="mp\.quickPlay">Quick Play<\/span>/);
    assert.match(menu, /<strong data-i18n="menu\.chooseMatch">Choose your match<\/strong>/);
    const play = css.slice(css.indexOf('#main-menu .ow-play {'), css.indexOf('#main-menu .ow-play > .ow-play-icon'));
    assert.match(play, /inset 0 -6px 0 var\(--mm-go-lip\)/, 'PLAY has a hard lip');
    assert.match(play, /:active \{\s*translate: 0 3px;/, 'PLAY presses down on click');
    for (const [key, value] of [['enterHub', 'Social Hub'], ['hubCopy', 'Hang out with friends in 3D'], ['featuredKicker', 'In the shop']]) {
        assert.equal(en.menu[key], value);
        assert.ok(tr.menu[key] && tr.menu[key] !== value, `menu.${key} needs a Turkish string`);
    }
    assert.ok(en.mp.subtitle.length <= 40 && tr.mp.subtitle.length <= 40, 'directory subtitle stays short');
});

test('decorative layers stay hidden from assistive tech and the backdrop is the bright arena', () => {
    const menu = mainMenu();
    assert.match(menu, /<div class="menu-backdrop" aria-hidden="true"><div class="menu-backdrop-plate"><\/div><\/div>/);
    assert.match(css, /\.menu-backdrop-plate \{[^}]*var\(--arena-menu-image/);
    const scrim = css.slice(css.indexOf('#main-menu .menu-backdrop::after {'), css.indexOf('2. Main menu grid'));
    const alphas = [...scrim.matchAll(/rgb\(4 14 22 \/ (\.\d+)\)/g)].map(match => Number(match[1]));
    assert.ok(alphas.length && Math.max(...alphas) <= .65, 'no heavy night grade over the arena art');
    assert.match(main, /querySelectorAll\('\.menu-backdrop, \.ow-showcase'\)/, 'parallax vars go only to the consuming layers');
});

test('motion is feedback only: no infinite loops, one-shot keyframes animate only transform/opacity', () => {
    assert.doesNotMatch(css, /\binfinite\b/, 'no ambient loops in the menu layer');
    const names = [...css.matchAll(/@keyframes (\w+)/g)].map(match => match[1]);
    assert.deepEqual(names.sort(), ['mmFade', 'mmRise', 'mmScaleIn']);
    for (const name of names) {
        const start = css.indexOf(`@keyframes ${name} `);
        const body = css.slice(start, css.indexOf('}\n', start) + 1);
        const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1]);
        for (const prop of props) assert.ok(['transform', 'opacity'].includes(prop), `@keyframes ${name} animates ${prop}`);
    }
    // The play panel fades (opacity only) so it never becomes a containing block for positioned children.
    const panel = css.slice(css.indexOf('#main-menu .ow-action-panel {'), css.indexOf('#main-menu .ow-action-heading'));
    assert.match(panel, /animation: mmFade/);
});

test('reduced motion is honoured by the media query and by the in-game toggle classes', () => {
    const reduced = css.slice(css.indexOf('7. Reduced motion'));
    assert.match(reduced, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/);
    assert.match(reduced, /:is\(\.reduced-motion, \.reduce-motion\) #main-menu \*/);
    assert.match(reduced, /:is\(\.reduced-motion, \.reduce-motion\) #main-menu :is\(\.menu-backdrop-plate, \.ow-hero-stage, \.menu-player-card\) \{ transform: none; translate: none; \}/);
    assert.match(reduced, /#lobby-screen/);
});

test('focus is always visible on menu and flow controls', () => {
    assert.match(css, /#main-menu :is\(button, input, select, \[tabindex\]\):focus-visible \{\s*outline: 2px solid var\(--mm-accent\);/);
    assert.match(css, /#lobby-screen\)\s*:is\(button, input, select, a, \[tabindex\]\):focus-visible/);
});

test('phones keep the social sheet docked so it can never cover PLAY, and PLAY leads the panel', () => {
    const phone = section('4. Main menu: phones', '5. Menu-flow shell');
    assert.match(phone, /#main-menu \.friends-sidebar:not\(\.collapsed\),[\s\S]*?transform: translateY\(calc\(100% - 58px\)\);/);
    assert.match(phone, /#main-menu \.friends-sidebar\.mobile-open \{ transform: translateY\(0\); \}/);
    assert.match(phone, /grid-template-areas:\s*"play play"/, 'PLAY is the first thing in the phone panel');
    assert.match(phone, /#main-menu \.ow-action-heading \{ display: none; \}/);
});

test('the flow screens share the same go-key and ghost back buttons', () => {
    assert.match(css, /:is\(#multiplayer-menu #btn-mp-quick, #multiplayer-menu #btn-mp-host-strip, #multiplayer-menu \.mp-lobby-empty-cta, #lobby-screen \.cs-btn-start\) \{/);
    assert.match(css, /:is\(#btn-sport-back, #btn-mp-back, #btn-join-back\) \{/);
});
