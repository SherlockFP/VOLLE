// tests/menu-flow.test.mjs — source-contract coverage for the consolidated main-menu
// multiplayer entry point (single "Play Online" button routing into the existing
// multiplayer screen) instead of separate Host Game / Join Game buttons.
// Style mirrors tests/endgame-controls.test.mjs: read the real source, assert on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldArmFirstMatchHints, shouldShowFtueWelcome } from '../js/store.js';

async function mainMenuBlock() {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="main-menu"');
    const end = html.indexOf('<!-- ===== 3D SOCIAL LOBBY HUD', start);
    assert.ok(start >= 0 && end > start, 'could not locate the #main-menu block in index.html');
    return html.slice(start, end);
}

async function multiplayerMenuBlock() {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="multiplayer-menu"');
    const end = html.indexOf('<!-- ===== JOIN MENU', start);
    assert.ok(start >= 0 && end > start, 'could not locate the #multiplayer-menu block in index.html');
    return html.slice(start, end);
}

test('#main-menu has no separate Host/Join/Play Online buttons — Quick Play is the single online entry', async () => {
    const block = await mainMenuBlock();
    assert.match(block, /id="btn-play-solo"/);
    assert.doesNotMatch(block, /id="btn-play-online"/);
    assert.doesNotMatch(block, /id="btn-host-game"/);
    assert.doesNotMatch(block, /id="btn-join-game"/);
});

test('#main-menu keeps Quick Play as the primary CTA above Social Hub/Tournament/Avatar', async () => {
    const block = await mainMenuBlock();
    const quickPlayIdx = block.indexOf('id="btn-play-solo"');
    const secondaryGroupIdx = block.indexOf('ow-secondary ow-secondary-right');
    const socialIdx = block.indexOf('id="btn-social-lobby"');
    const tournamentIdx = block.indexOf('id="btn-tournament"');
    const avatarIdx = block.indexOf('id="btn-avatar"');
    assert.ok(quickPlayIdx >= 0 && secondaryGroupIdx > quickPlayIdx, 'Quick Play must stay the primary CTA above the secondary button group');
    assert.ok(socialIdx > quickPlayIdx && secondaryGroupIdx > socialIdx && tournamentIdx < avatarIdx,
        'Quick Play must lead, followed by Social Hub and the lower-priority utility actions');
});

test('multiplayer screen still exposes a reachable host action (btn-mp-create) for Quick Play to route into', async () => {
    const block = await multiplayerMenuBlock();
    assert.match(block, /id="btn-mp-create"/);
    assert.match(block, /id="btn-mp-join"/);
    assert.match(block, /id="btn-mp-solo"/);
});

test('Quick Play routes into the multiplayer screen with lobby refresh', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /bind\('btn-host-game'/);
    assert.doesNotMatch(source, /bind\('btn-join-game'/);
    assert.doesNotMatch(source, /bind\('btn-play-online'/);

    const bindIdx = source.indexOf('const openMultiplayer =');
    assert.ok(bindIdx >= 0, 'expected the shared Quick Play route handler in main.js');
    const handlerSlice = source.slice(bindIdx, bindIdx + 900);
    assert.match(handlerSlice, /this\.ui\.showScreen\('multiplayerMenu'\)/);
    assert.match(handlerSlice, /this\._refreshLobbyList\(\)/);
    assert.match(handlerSlice, /this\._mpRefreshTimer = setInterval\(\(\) => this\._refreshLobbyList\(\), 5000\)/);
    assert.match(source, /bind\('btn-play-solo', openMultiplayer\)/);
    assert.match(source, /bind\('btn-play', openMultiplayer\)/);
});

test('hosting (_doHostGame) remains wired to the in-screen Create Lobby button, not removed', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /bind\('btn-mp-create', \(\) => \{[\s\S]*?this\._doHostGame\(\);/);
});

// Retention strip (2026 retention pass): daily-challenge + battlepass progress
// cards live inside #main-menu, alongside the pre-existing login-streak badge.
test('#main-menu has a retention strip with daily-challenge and battlepass progress cards', async () => {
    const block = await mainMenuBlock();
    const stripIdx = block.indexOf('id="menu-retention-strip"');
    assert.ok(stripIdx >= 0, 'expected #menu-retention-strip inside #main-menu');
    const dailyIdx = block.indexOf('id="menu-daily-card"');
    const bpIdx = block.indexOf('id="menu-bp-card"');
    const streakIdx = block.indexOf('id="menu-streak-badge"');
    assert.ok(dailyIdx > stripIdx, 'menu-daily-card must be inside the retention strip');
    assert.ok(bpIdx > stripIdx, 'menu-bp-card must be inside the retention strip');
    assert.ok(streakIdx > stripIdx, 'menu-streak-badge must be inside the retention strip');
    assert.match(block, /id="menu-daily-sub"/);
    assert.match(block, /id="menu-daily-fill"/);
    assert.match(block, /id="menu-bp-title"/);
    assert.match(block, /id="menu-bp-sub"/);
    assert.match(block, /id="menu-bp-fill"/);
});

test('retention strip cards route into the existing Daily/Battlepass screens (same handlers as the nav tabs)', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const dailyBind = source.indexOf("bind('menu-daily-card'");
    assert.ok(dailyBind >= 0, "expected a bind('menu-daily-card', ...) handler in main.js");
    const dailySlice = source.slice(dailyBind, dailyBind + 200);
    assert.match(dailySlice, /this\.ui\.renderDaily\(Daily, this\.store\)/);
    assert.match(dailySlice, /this\.ui\.showScreen\('daily'\)/);

    const bpBind = source.indexOf("bind('menu-bp-card'");
    assert.ok(bpBind >= 0, "expected a bind('menu-bp-card', ...) handler in main.js");
    const bpSlice = source.slice(bpBind, bpBind + 200);
    assert.match(bpSlice, /this\.ui\.renderBattlepass\(this\.store\)/);
    assert.match(bpSlice, /this\.ui\.showScreen\('battlepass'\)/);
});

// FTUE (first-time user experience): first-run welcome overlay + on-demand
// "?" button, both gated by the Store 'ftueSeen' flag (same JSON-blob
// persistence as every other Store flag — no new storage pattern).
test('index.html has the FTUE welcome overlay markup with tip cards, primary CTA, and practice link', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="ftue-welcome"');
    assert.ok(start >= 0, 'expected #ftue-welcome overlay in index.html');
    const end = html.indexOf('<section id="social-hub-browser"', start);
    assert.ok(end > start, 'could not bound the #ftue-welcome block');
    const block = html.slice(start, end);
    assert.match(block, /id="ftue-welcome-title"/);
    assert.match(block, /class="ftue-tips"/);
    assert.equal((block.match(/class="ftue-tip"/g) || []).length, 3, 'expected exactly 3 tip cards');
    assert.match(block, /id="ftue-welcome-start"/);
    assert.match(block, /id="ftue-welcome-practice"/);

    assert.match(html, /id="btn-how-to-play"/);
});

test('welcome overlay tip text matches the real bindings from js/player.js (WASD/Space/Ctrl move, L-Click deflect, R-Click stab)', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="ftue-welcome"');
    const end = html.indexOf('<section id="social-hub-browser"', start);
    const block = html.slice(start, end);
    assert.match(block, /WASD to move, Space to jump, Ctrl to dash/);
    assert.match(block, /Hold Left-Click near the ball to deflect it/);
    assert.match(block, /Right-Click to stab up close/);
});

test('FTUE welcome/start/practice buttons and first-match hint arming are wired in main.js', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /bind\('btn-how-to-play', \(\) => this\.showFtueWelcome\(\)\)/);
    assert.match(source, /bind\('ftue-welcome-start', \(\) => this\.hideFtueWelcome\(\)\)/);

    const practiceBind = source.indexOf("bind('ftue-welcome-practice'");
    assert.ok(practiceBind >= 0, "expected a bind('ftue-welcome-practice', ...) handler in main.js");
    const practiceSlice = source.slice(practiceBind, practiceBind + 150);
    assert.match(practiceSlice, /this\.ui\.showScreen\('practiceMenu'\)/);

    // Hints must arm only on solo/bot start paths, never on the multiplayer
    // host path (_doHostGame also calls startSolo() internally to seed lobby
    // state before real players join).
    assert.match(source, /this\.game\.startSolo\(\);\s*\n\s*this\._armFirstMatchHints\(\);/);
    const hostFnIdx = source.indexOf('async _doHostGame()');
    assert.ok(hostFnIdx >= 0, 'expected _doHostGame in main.js');
    const hostSlice = source.slice(hostFnIdx, hostFnIdx + 600);
    assert.doesNotMatch(hostSlice, /_armFirstMatchHints/);
});

// Pure-function pins (same style as store.js's isFirstMatchOfDay/loginStreakReward):
// exercised without touching localStorage or the DOM.
test('shouldShowFtueWelcome / shouldArmFirstMatchHints are pure flag gates', () => {
    assert.equal(shouldShowFtueWelcome(undefined), true, 'no flag yet -> overlay should show');
    assert.equal(shouldShowFtueWelcome(false), true);
    assert.equal(shouldShowFtueWelcome(true), false, 'flag already set -> overlay must not show again');

    assert.equal(shouldArmFirstMatchHints(undefined), true, 'no flag yet -> hints should arm');
    assert.equal(shouldArmFirstMatchHints(true), false, 'flag already set -> hints must never arm/fire again');
});
