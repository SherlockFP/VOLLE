import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const main = read('../js/main.js');
const ui = read('../js/ui.js');
const css = read('../css/polish.css');
const tokens = read('../css/ui-tokens.css');
const master = read('../design-system/warrball/MASTER.md');

function menuBlock() {
    const start = html.indexOf('<div id="main-menu"');
    const end = html.indexOf('<!-- ===== MULTIPLAYER MENU', start);
    return html.slice(start, end);
}

test('primary menu navigation has exactly the eight approved routes', () => {
    const menu = menuBlock();
    const nav = menu.slice(menu.indexOf('<nav class="ow-tabs"'), menu.indexOf('</nav>', menu.indexOf('<nav class="ow-tabs"')));
    const routes = [...nav.matchAll(/data-menu-route="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(routes, ['play', 'ranked', 'arcade', 'custom', 'locker', 'battlepass', 'shop', 'profile']);
    assert.equal((nav.match(/<button\b/g) || []).length, 8);
    const ids = [...menu.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'the menu must not create duplicate IDs');
});

test('each menu route delegates to an existing screen flow', () => {
    for (const source of [
        "bind('btn-play', openMultiplayer);",
        "bind('btn-ranked', () => {",
        "bind('btn-practice', () => {",
        "bind('btn-map-editor', () => {",
        "bind('btn-character', () => {",
        "bind('btn-battlepass', () => {",
        "bind('btn-shop', () => {",
        "bind('btn-profile', () => this.ui.showProfile());"
    ]) assert.ok(main.includes(source), `missing route handler: ${source}`);
    assert.match(main, /const openMultiplayer = \(\) => \{[\s\S]*?showScreen\('multiplayerMenu'\)[\s\S]*?_showSportSelect\(\)/);
    assert.match(main, /_openMultiplayerForSport\(sportId\) \{[\s\S]*?_refreshLobbyList\(\)[\s\S]*?setInterval\(\(\) => this\._refreshLobbyList\(\), 5000\)/);
});

test('menu uses the shared live renderer, player identity card and social-center party handoff', () => {
    const menu = menuBlock();
    assert.match(menu, /id="menu-hero-canvas"/);
    assert.match(menu, /menu-arena-plate/);
    assert.match(menu, /id="menu-player-name"/);
    assert.match(menu, /id="menu-player-elo"/);
    assert.match(menu, /id="menu-rank-badge"/);
    assert.match(menu, /id="menu-party-list"/);
    assert.match(menu, /id="btn-menu-party-invite"/);
    assert.match(menu, /id="btn-menu-squad-center"/);
    assert.match(main, /_renderMenuIdentity\(\)/);
    assert.match(main, /_renderMenuPartyRail\(/);
    assert.match(main, /bind\('btn-menu-party-invite', \(\) => \{[\s\S]*?Friends\.isPartyLeader/);
    assert.match(main, /bind\('btn-menu-squad-center', openSocialCenter\)/);
    assert.match(main, /new ShopShowcaseRenderer\(canvas/);
});

test('rank badges are SVG/CSS presentation rather than emoji-only primary UI', () => {
    assert.match(ui, /<svg class="profile-rank-badge"/);
    assert.doesNotMatch(ui.slice(ui.indexOf('showProfile()'), ui.indexOf('hideProfile()')), /rank\.emoji/);
    assert.match(css, /\.menu-rank-badge,/);
});

test('Profile route resolves through the UI screen registry instead of a DOM id', () => {
    const profile = ui.slice(ui.indexOf('showProfile()'), ui.indexOf('hideProfile()'));
    assert.match(profile, /this\.showScreen\('profile'\);/);
    assert.doesNotMatch(profile, /this\.showScreen\('screen-profile'\);/);
});

test('menu layout supplies tokenized responsive, focus and reduced-motion contracts', () => {
    assert.match(tokens, /--ui-space-8: 64px;/);
    for (const token of ['--ui-surface-rest', '--ui-menu-max-width', '--ui-hud-edge', '--ui-ultrawide-safe', '--ui-z-hud']) {
        assert.ok(tokens.includes(token), `missing ${token}`);
    }
    assert.match(css, /#main-menu \{[\s\S]*?overflow-x: clip/);
    assert.match(css, /@media \(max-width: 1180px\)/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /#main-menu :is\(button, input\):focus-visible/);
});

test('mobile menu protects the full-body hero and resets primary navigation on entry', () => {
    const cycleMenuCss = css.slice(css.indexOf('/* Cycle C2: cinematic CS-style command menu'));
    const mobileCss = cycleMenuCss.slice(
        cycleMenuCss.indexOf('@media (max-width: 760px)'),
        cycleMenuCss.indexOf('@media (prefers-reduced-motion: reduce)')
    );
    assert.match(mobileCss, /\.ow-name-input \{[^}]*margin-top: var\(--ui-space-2\)/);
    assert.match(mobileCss, /\.ow-showcase \{[^}]*height: 300px/);
    assert.match(mobileCss, /\.ow-hero-stage \{[^}]*inset: -2% -6% var\(--ui-space-5\)/);
    assert.match(main, /const primaryNav = document\.querySelector\('#main-menu \.ow-tabs'\);\s*window\.addEventListener\('warrball:screen', event => \{\s*if \(event\.detail\?\.screen === 'mainMenu' && primaryNav\) primaryNav\.scrollLeft = 0/);
});

test('the implementation bible preserves commercial and competitive guardrails', () => {
    const normalized = master.toLowerCase();
    for (const phrase of [
        'every ui element must answer',
        'purchasable cases are cosmetics-only',
        'characters remain separate presentation choices',
        'server-signed entitlement and authoritative validation',
        'this is a quality bar, not authorization to change maps in the current ui pass'
    ]) assert.ok(normalized.includes(phrase), `MASTER must include: ${phrase}`);
});

test('the supplied arena plate exists for the menu showcase', () => {
    assert.ok(fs.existsSync(new URL('../assets/generated/warrball-arena-menu-bg-v1.webp', import.meta.url)));
});
