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
test('index.html has the FTUE welcome overlay markup with tip cards, guided-drill CTA, and skip action', async () => {
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
    assert.match(block, />Start Guided Drill</);
    assert.match(block, />Skip for now</);

    assert.match(html, /id="btn-how-to-play"/);
});

test('FTUE uses the shared SVG icon sprite and the drill HUD/actions respect mobile safe layout', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const start = html.indexOf('<div id="ftue-welcome"');
    const end = html.indexOf('<section id="social-hub-browser"', start);
    const ftue = html.slice(start, end);
    assert.equal(/[🏃🏐🔪]/u.test(ftue), false, 'structural FTUE icons must not be emoji');
    for (const icon of ['#i-arrow-right', '#i-ball', '#i-target']) {
        assert.match(ftue, new RegExp(`<use href="${icon}"></use>`));
    }
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    assert.match(css, /\.drill-result-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /body\.practice-lab-active \.practice-lab-hud\s*\{\s*top:\s*76px;\s*right:\s*8px;\s*width:\s*calc\(100vw - 16px\);\s*max-height:\s*120px/);
    assert.match(css, /body\.practice-lab-active :is\(#network-diagnostics, #minimap-wrap, #ball-speed\)\s*\{\s*display:\s*none/);
    assert.match(css, /body\.practice-lab-active #vitals\s*\{\s*left:\s*16px;\s*bottom:\s*16px;\s*width:\s*min\(190px/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.drill-result-actions\s*\{\s*grid-template-columns:\s*1fr;/);
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

test('FTUE primary starts the real guided drill while skip/escape record exits without claiming completion', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /bind\('btn-how-to-play', \(\) => this\.showFtueWelcome\(\)\)/);
    assert.match(source, /bind\('ftue-welcome-start', \(\) => this\.startFtueGuidedDrill\(\)\)/);
    assert.match(source, /bind\('ftue-welcome-practice', \(\) => this\.hideFtueWelcome\(\{ reason: 'skip', trackExit: true \}\)\)/);
    assert.match(source, /hideFtueWelcome\(\{ reason: 'escape', trackExit: true \}\)/);

    const hideStart = source.indexOf('hideFtueWelcome({');
    const hideEnd = source.indexOf('// First-match HUD hints', hideStart);
    const hideSlice = source.slice(hideStart, hideEnd);
    assert.match(hideSlice, /this\.productAnalytics\.track\('ftue_exit'/);
    assert.doesNotMatch(hideSlice, /ftue_complete/, 'dismissing the overlay is not completion');
    const ftueStart = source.indexOf('startFtueGuidedDrill()');
    const ftueSlice = source.slice(ftueStart, ftueStart + 500);
    assert.match(ftueSlice, /this\.startGuidedDeflectDrill\(\{ source: firstRun \? 'ftue' : 'manual_help' \}\)/);

    const completionCount = (source.match(/productAnalytics\.track\('ftue_complete'/g) || []).length;
    assert.equal(completionCount, 1, 'only the guided-drill completion callback may claim FTUE completion');
    const completionIdx = source.indexOf("this.productAnalytics.track('ftue_complete'");
    assert.ok(completionIdx > source.indexOf('this.game.onGuidedDrillComplete'), 'completion belongs to guided drill completion');
    assert.match(source, /this\._ftueGuidedRun === true && this\.store\.get\('ftueCompleted'\) !== true/);
});

test('guided drill result CTA leaves practice and routes through the existing solo start-game handler', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="btn-drill-first-bot"[^>]*>Play First Bot Match</);
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = source.lastIndexOf('_startFirstBotMatchFromDrill()');
    const slice = source.slice(start, start + 850);
    assert.match(slice, /if \(this\.network\?\.connected\)/, 'must not auto-start multiplayer');
    assert.match(slice, /this\._exitPracticeSession\(\);/);
    assert.match(slice, /this\.game\.startSolo\(\);/);
    assert.match(slice, /this\._armFirstMatchHints\(\);/);
    assert.match(slice, /this\.ui\.showScreen\('lobby'\);/);
    assert.match(slice, /document\.getElementById\('btn-start-game'\)\?\.click\(\)/);
    assert.match(source, /bind\('btn-drill-first-bot', \(\) => this\._startFirstBotMatchFromDrill\(\)\)/);
});

test('guided drill routes only FTUE through the compact profile without duplicate practice-start analytics', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = source.indexOf("startGuidedDeflectDrill({ source = 'practice_menu' }");
    const slice = source.slice(start, start + 1000);
    assert.match(slice, /const firstRun = source === 'ftue';/);
    assert.match(slice, /this\.startPractice\(\{ track: false \}\);/);
    assert.match(slice, /this\.game\.armGuidedDrill\(\{ profile: firstRun \? 'first_run' : 'full' \}\);/);
    assert.match(slice, /this\.productAnalytics\.track\('practice_start'/);
    assert.match(source, /startPractice\(\{ launch = false, track = true \} = \{\}\) \{\s*if \(track\) this\.productAnalytics\.track\('practice_start'/);
});

test('first-run drill result is a match handoff rather than a grade and preserves full-drill results', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="drill-result-kicker"/);
    assert.match(html, /id="drill-result-headline"/);
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = source.indexOf('_showGuidedDrillResult(result = {}, { firstRun = false } = {})');
    const slice = source.slice(start, start + 3000);
    assert.match(slice, /FIRST DRILL COMPLETE/);
    assert.match(slice, /YOU’RE READY FOR A MATCH/);
    assert.match(slice, /grade\?\.closest\('\.drill-grade'\)\?\.toggleAttribute\('hidden', firstRun\)/);
    assert.match(slice, /freeLab\?\.toggleAttribute\('hidden', firstRun\)/);
    assert.match(slice, /\$\{stage\.hits \|\| 0\} contacts/);
    assert.match(slice, /\$\{stage\.directed \|\| 0\} on target/);
    assert.match(slice, /\$\{stage\.perfect \|\| 0\} perfect/);
});

test('first-match hint arming remains restricted to solo/bot paths', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');

    // Hints must arm only on solo/bot start paths, never on the multiplayer
    // host path (_doHostGame also calls startSolo() internally to seed lobby
    // state before real players join).
    assert.match(source, /this\.game\.startSolo\(\);\s*\n\s*this\._armFirstMatchHints\(\);/);
    const hostFnIdx = source.indexOf('async _doHostGame()');
    assert.ok(hostFnIdx >= 0, 'expected _doHostGame in main.js');
    const hostSlice = source.slice(hostFnIdx, hostFnIdx + 600);
    assert.doesNotMatch(hostSlice, /_armFirstMatchHints/);
});

test('Card Collection is a modal dialog that isolates Locker controls and restores focus on close', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="character-locker-content"/);
    assert.match(html, /id="card-collection-panel"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /class="card-collection-dialog"[^>]*role="document"/);
    assert.match(html, /class="card-collection-content"/);
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /_setCardCollectionOpen\(open\)/);
    assert.match(source, /locker\.inert = true;/);
    assert.match(source, /locker\.inert = false;/);
    assert.match(source, /bind\('btn-card-collection', \(\) => \{\s*this\._setCardCollectionOpen\(true\);/);
    assert.match(source, /bind\('btn-card-collection-close', \(\) => \{\s*this\._setCardCollectionOpen\(false\);/);
    assert.match(source, /cardCollection && !cardCollection\.classList\.contains\('hidden'\)[\s\S]*?this\._setCardCollectionOpen\(false\)/);
});

test('Card Collection render uses sprite art, rarity/state datasets, and responsive modal rules', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(source, /\$\{ownedUnique\}\/\$\{cards\.length\} unique owned/);
    assert.match(source, /article\.dataset\.rarity = card\.rarity;/);
    assert.match(source, /article\.dataset\.state = isEquipped \? 'equipped' : copies \? 'owned' : 'locked';/);
    assert.match(source, /const CARD_EFFECT_ICON_IDS = Object\.freeze\(\{/);
    for (const icon of ['#i-target', '#i-ball', '#i-play', '#i-refresh', '#i-access', '#i-chart', '#i-trophy']) {
        assert.match(source, new RegExp(`: '${icon}'`));
    }
    assert.match(source, /CARD_EFFECT_ICON_IDS\[card\.effectId\] \|\| \(card\.slot === 'active' \? '#i-target' : '#i-chart'\)/);
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    assert.match(css, /\.card-collection-panel\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*overflow:\s*hidden/);
    assert.match(css, /\.card-collection-dialog\s*\{[^}]*width:\s*min\(1040px, 100%\);[^}]*overflow:\s*auto/);
    assert.match(css, /\.card-collection-header\s*\{[^}]*position:\s*sticky;/);
    assert.match(css, /\.card-collection-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.arena-card\[data-rarity="rare"\]\s*\{\s*--card-rarity:\s*#55d9c6;/, 'rarity must not reuse team blue');
    assert.match(css, /\.card-collection-header h2\s*\{\s*color:\s*#f7fbff;/);
    assert.match(css, /\.card-tradeup h3\s*\{\s*color:\s*#f7fbff;/);
    assert.match(css, /\.card-tradeup label\s*\{[^}]*color:\s*#dceeff;/);
    assert.match(css, /\.arena-card \.card-equip:disabled\s*\{[^}]*opacity:\s*1;[^}]*filter:\s*none;/);
    assert.match(css, /\.arena-card\.is-locked \.card-equip:disabled\s*\{[^}]*color:\s*#d5e2ec;[^}]*border-color:/);
    assert.match(css, /\.arena-card\.is-equipped \.card-equip:disabled\s*\{[^}]*color:\s*#d8f4ee;[^}]*border-color:/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.card-collection-dialog\s*\{[^}]*height:\s*100dvh;[^}]*border-radius:\s*0/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.card-collection-grid\s*\{\s*grid-template-columns:\s*1fr/);
    assert.match(css, /\.card-collection-header \.btn\s*\{\s*min-width:\s*44px;\s*min-height:\s*44px/);
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
