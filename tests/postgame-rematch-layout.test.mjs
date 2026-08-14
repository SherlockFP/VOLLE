import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/polish.css');
const ui = read('../js/ui.js');
const main = read('../js/main.js');

test('post-game puts the single primary rematch action ahead of the detailed report', () => {
    const panelStart = html.indexOf('<div class="pg-panel"');
    const heroStart = html.indexOf('<section class="pg-rematch-hero"');
    const reportStart = html.indexOf('<section class="pg-detail-report"');
    const secondaryStart = html.indexOf('<div class="pg-secondary-actions">');

    assert.ok(panelStart >= 0, 'post-game panel is present');
    assert.ok(heroStart > panelStart, 'rematch hero stays inside the post-game panel');
    assert.ok(reportStart > heroStart, 'detailed rewards and stats follow the rematch action');
    assert.ok(secondaryStart > reportStart, 'exit routes remain lower-priority than the report');
    assert.equal((html.match(/id="pg-play-again"/g) || []).length, 1, 'rematch keeps one handler target');
    assert.equal((html.match(/id="pg-rematch-status"/g) || []).length, 1, 'readiness status keeps one live region');
    assert.match(html.slice(heroStart, reportStart), /id="pg-rematch-status"[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(html.slice(heroStart, reportStart), /id="pg-play-again"/);
    assert.match(html.slice(reportStart, secondaryStart), /id="postgame-stats"/);
    assert.match(html.slice(reportStart, secondaryStart), /id="pg-analysis"/);
});

test('post-game rematch action is full-width, touch-safe, and mobile-safe', () => {
    assert.match(css, /\.pg-rematch-hero\s*\{[\s\S]*?display:\s*grid;/);
    assert.match(css, /\.pg-rematch-hero #pg-play-again\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*52px;/);
    assert.match(css, /\.pg-secondary-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(css, /@media \(max-width: 700px\)\s*\{[\s\S]*?\.pg-secondary-actions\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('reward flow inserts by the nested stats parent and survives the post-game hierarchy', () => {
    const reportStart = html.indexOf('<section class="pg-detail-report"');
    const statsStart = html.indexOf('id="postgame-stats"');
    assert.ok(statsStart > reportStart, 'postgame stats are nested in the detailed report');
    assert.match(ui, /const stats = document\.getElementById\('postgame-stats'\);\s+const report = stats\?\.parentNode;/);
    assert.match(ui, /if \(host\.parentNode !== report \|\| host\.nextSibling !== stats\) report\.insertBefore\(host, stats\);/);
    assert.doesNotMatch(ui, /panel\.insertBefore\(host, document\.getElementById\('postgame-stats'\)\);/);
});

test('post-game status and XP label remain readable in the compact mobile card', () => {
    assert.match(css, /\.pg-rematch-hero \.rematch-status\s*\{[\s\S]*?color:\s*var\(--screen-ink\);[\s\S]*?background:\s*var\(--shell-ink\);/);
    assert.match(css, /\.pg-xp-text\s*\{[\s\S]*?width:\s*100%;[\s\S]*?white-space:\s*nowrap;[\s\S]*?line-height:\s*28px;/);
});

test('starting a rematch hides the registered post-game screen with every other screen', () => {
    const screensStart = ui.indexOf('this.screens = {');
    const screensEnd = ui.indexOf('};', screensStart);
    const hideAllStart = ui.indexOf('hideAll() {');
    const hideAllEnd = ui.indexOf('\n    }', hideAllStart);
    const screens = ui.slice(screensStart, screensEnd);
    const hideAll = ui.slice(hideAllStart, hideAllEnd);

    assert.match(screens, /postGame:\s*document\.getElementById\('post-game-screen'\)/);
    assert.match(hideAll, /Object\.values\(this\.screens\)\.forEach\(s => \{ if \(s\) s\.classList\.add\('hidden'\); \}\);/);
});

test('post-game gives keyboard focus to Rematch without scrolling the report', () => {
    const showPostGameStart = ui.indexOf('showPostGame(');
    const showPostGameEnd = ui.indexOf('\n    // Post-match', showPostGameStart);
    const showPostGame = ui.slice(showPostGameStart, showPostGameEnd);

    assert.match(showPostGame, /const playAgain = document\.getElementById\('pg-play-again'\);/);
    assert.match(showPostGame, /playAgain\?\.focus\?\.\(\{ preventScroll: true \}\);/);
    assert.ok(
        showPostGame.indexOf("window._postGameAction?.('main_menu')") < showPostGame.indexOf('playAgain?.focus?.'),
        'focus happens after post-game actions are wired'
    );
});

test('post-game match drop is hidden by default and stays below the primary Rematch decision', () => {
    const heroStart = html.indexOf('<section class="pg-rematch-hero"');
    const dropStart = html.indexOf('id="pg-match-drop"');
    const statsStart = html.indexOf('id="postgame-stats"');

    assert.ok(dropStart > heroStart, 'match drops never displace the primary Rematch decision');
    assert.ok(dropStart < statsStart, 'real match drops lead the detailed report rather than burying the collection handoff');
    assert.match(html.slice(dropStart, statsStart), /id="pg-match-drop"[^>]+hidden/);
    assert.match(html.slice(dropStart, statsStart), /id="pg-match-drop-list"/);
    assert.match(css, /\.pg-match-drop\s*\{[\s\S]*?display:\s*grid;/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.pg-match-drop-item \{ grid-template-columns:\s*1fr;/);
    assert.match(css, /\.pg-match-drop-item \.btn \{ width:\s*100%; min-height:\s*44px;/);
});

test('post-game match drop only renders settled local or authoritative rewards once', () => {
    const methodStart = ui.indexOf('    setPostGameMatchDrops(matchId, drops = []) {');
    const methodEnd = ui.indexOf('\n    // Count-up used by every earned-number', methodStart);
    const method = ui.slice(methodStart, methodEnd);
    const rewardStart = main.indexOf('    async awardMatchRewards() {');
    const rewardEnd = main.indexOf('\n    // ponytail: mouse-follow', rewardStart);
    const reward = main.slice(rewardStart, rewardEnd);

    assert.match(method, /drop\.type === 'case' \|\| drop\.type === 'card'/);
    assert.match(method, /wrap\.hidden = safeDrops\.length === 0;/, 'no reward must hide the component');
    assert.match(method, /this\._postGameDropMatchId && this\._postGameDropMatchId !== matchId\) return false;/, 'stale receipts cannot replace another match');
    assert.match(method, /textContent = drop\.name;/, 'item names are never HTML-injected');
    assert.match(method, /drop\.type === 'case' \? 'View Cases' : 'View Cards'/);
    assert.match(reward, /const freshAuthorityResult = !synced \|\| synced\.replayed !== true;/);
    assert.match(reward, /this\.game\.matchId === matchId && isTerminalRematchState\(this\.game\.state\)/);
    assert.match(reward, /this\.ui\.setPostGameMatchDrops\?\.\(matchId, matchDrops\);/);
    assert.equal((reward.match(/this\.productAnalytics\.track\('card_earned'/g) || []).length, 1,
        'remote card rewards must not double-track through both receipt branches');
    assert.equal((reward.match(/this\.productAnalytics\.track\('earned_case_granted'/g) || []).length, 1,
        'earned cosmetic cases have one analytics emission');
});

test('match-drop CTAs only navigate to cases or Locker Cards and do not open or buy rewards', () => {
    const actionStart = main.indexOf('        window._postGameDropAction = drop => {');
    const actionEnd = main.indexOf('\n        window._postGameAction =', actionStart);
    const action = main.slice(actionStart, actionEnd);

    assert.match(action, /drop\?\.type === 'case'[\s\S]*?CASES\[drop\.id\][\s\S]*?renderShop\(this\.store, 'cases'\)/);
    assert.match(action, /drop\?\.type === 'card'[\s\S]*?ARENA_CARDS\[drop\.id\][\s\S]*?_renderCardCollection\(\);[\s\S]*?setLockerTab\('cards'\)/);
    assert.doesNotMatch(action, /_openShopCase|purchase|equip/i);
    assert.match(main, /this\.ui\.clearPostGameMatchDrops\?\.\(\);/, 'a rematch clears stale collection UI before its next result');
});
