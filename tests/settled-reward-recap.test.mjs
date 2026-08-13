import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCH_XP, matchXp } from '../js/prestige.js';
import { buildRewardSummary } from '../js/match-analytics.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const game = read('../js/game.js');
const main = read('../js/main.js');
const store = read('../js/store.js');
const ui = read('../js/ui.js');
const css = read('../css/polish.css');

test('local receipt XP includes the authored rally term once and rows total the granted amount', () => {
    const stats = { deflections: 3, kills: 2, rally: 5, survived: true, won: true };
    const xp = matchXp(stats);
    const rows = [
        { label: 'Match played', value: MATCH_XP.base },
        { label: 'Deflections x3', value: 3 * MATCH_XP.perDeflection },
        { label: 'Eliminations x2', value: 2 * MATCH_XP.perKill },
        { label: 'Rally x5', value: 5 * MATCH_XP.perRally },
        { label: 'Survival bonus', value: MATCH_XP.survivalBonus },
        { label: 'Victory bonus', value: MATCH_XP.win }
    ];
    const summary = buildRewardSummary({ xp, xpSources: rows });
    assert.equal(summary.xpTotal, xp);
    assert.equal(summary.xpRows.reduce((total, row) => total + row.value, 0), xp);
    assert.equal(rows.filter(row => row.label.startsWith('Rally')).length, 1);
});

test('boosted local receipt keeps a visible residual row instead of overstating the base rows', () => {
    const raw = matchXp({ won: false });
    const granted = Math.floor(raw * 1.5);
    const summary = buildRewardSummary({ xp: granted, xpSources: [
        { label: 'Match played', value: raw },
        { label: 'Active XP boost', value: granted - raw }
    ] });
    assert.equal(summary.xpRows.reduce((total, row) => total + row.value, 0), granted);
});

test('zero or pending receipts keep the report honest instead of rendering fabricated rows', () => {
    const summary = buildRewardSummary({ xp: 0, xpSources: [], coins: { base: 0, bonus: 0, firstOfDay: 0, total: 0 }, dailies: [] });
    assert.deepEqual(summary, { xpTotal: 0, xpRows: [], coinTotal: 0, coinRows: [], dailyRows: [], rowCount: 0 });
    assert.match(ui, /_renderRewardFlow\(0, \[\], \{ pending: true \}\)/);
    assert.match(ui, /Settling your match rewards/);
});

test('authenticated and polled receipts project actual server fields before the profile mutates', () => {
    assert.match(store, /const dailyRows = this\._matchDailyRows\(settled\.profile\?\.dailyChallenges\);\s+if \(settled\.profile\) this\._applyRemoteProfile/);
    assert.match(store, /coins: completion\.coins,[\s\S]*?battlepassXp: completion\.battlepassXp,[\s\S]*?dailyRows: rows,/);
    assert.match(store, /const dailyRows = this\._matchDailyRows\(result\.profile\?\.dailyChallenges\);\s+if \(result\.profile\) this\._applyRemoteProfile/);
});

test('P2P client terminal data never carries economy and waits for its own receipt', () => {
    const broadcast = game.slice(game.indexOf("type: 'gameOver'"), game.indexOf('playerStats', game.indexOf("type: 'gameOver'")) + 20);
    assert.doesNotMatch(broadcast, /\bxp\b|coins|reward|drop/i);
    assert.match(game, /rewardsPending: true,[\s\S]*?matchId: this\.matchId/);
    assert.match(main, /this\.store\.remoteReady && \(!synced \|\| synced\.pending\) \? null/);
});

test('late, replayed, or rematch receipts cannot repaint the new report or duplicate a settlement', () => {
    assert.match(ui, /this\._postGameRewardMatchId !== matchId \|\| this\._postGameRewardSettledMatchId === matchId\) return false/);
    assert.match(main, /this\.game\.matchId === matchId && isTerminalRematchState\(this\.game\.state\)/);
    assert.match(main, /settledReceipt && synced\?\.replayed !== true/);
});

test('a receipt delayed beyond the first six-second window retries read-only and paints once', () => {
    assert.match(store, /async getSettledMatchRemote\(matchId\)/);
    assert.match(store, /getMatchRemoteStatus\(matchId, \{ applyProfile: false \}\)/);
    assert.match(main, /let attempts = 0;[\s\S]*?attempts < 12[\s\S]*?setTimeout\(\(\) => \{ void retry\(\); \}, 2500\)/);
    assert.match(main, /this\.ui\.setPostGameRewardReceipt\?\.\(matchId, receipt, this\.store\)/);
    assert.match(ui, /this\._postGameRewardSettledMatchId === matchId\) return false/);
});

test('the pending screen exposes an accessible manual retry and stops on a stale terminal context', () => {
    assert.match(ui, /textContent = 'Retry rewards'/);
    assert.match(ui, /aria-label', 'Retry loading your match rewards'/);
    assert.match(main, /const active = \(\) => this\.game\.matchId === matchId[\s\S]*?isTerminalRematchState\(this\.game\.state\)[\s\S]*?_postGameRewardMatchId === matchId/);
    assert.match(main, /clearTimeout\(this\._deferredRewardRetryTimer\);[\s\S]*?this\._deferredRewardRetryTimer = null;[\s\S]*?clearPostGameMatchDrops/);
    assert.doesNotMatch(main.slice(main.indexOf('_startDeferredMatchRewardRetry'), main.indexOf('// ponytail:', main.indexOf('_startDeferredMatchRewardRetry'))), /grantMatchRemote|fetch\('\/api\/matches\/complete/);
});

test('a late retry status cannot apply profile cache before the same-match guard passes', () => {
    const retryStart = main.indexOf('const retry = async () => {');
    const retryEnd = main.indexOf('// ponytail:', retryStart);
    const retry = main.slice(retryStart, retryEnd);
    const storeStart = store.indexOf('async getSettledMatchRemote(matchId)');
    const storeEnd = store.indexOf('getAdRewardStatus()', storeStart);
    const retryStore = store.slice(storeStart, storeEnd);
    assert.match(retryStore, /getMatchRemoteStatus\(matchId, \{ applyProfile: false \}\)/);
    assert.doesNotMatch(retryStore, /_applyRemoteProfile/);
    assert.match(retry, /const pendingStatus = await this\.store\.getSettledMatchRemote\(matchId\);[\s\S]*?if \(!active\(\)\) return false;[\s\S]*?applySettledMatchRemote\(pendingStatus\.status\)/);
});

test('earned drop actions carry exact safe identity to the case inspector or Locker Cards', () => {
    assert.match(ui, /_postGameDropAction\?\.\(\{ type: drop\.type, id: drop\.id \}\)/);
    assert.match(main, /CASES\[drop\.id\][\s\S]*?\.case-select\[data-id="\$\{drop\.id\}"\]/);
    assert.match(main, /ARENA_CARDS\[drop\.id\][\s\S]*?\[data-card-id="\$\{drop\.id\}"\]/);
    assert.doesNotMatch(main.slice(main.indexOf('window._postGameDropAction'), main.indexOf('window._postGameAction')), /_openShopCase|purchase|equip/i);
    assert.match(css, /\.pg-match-drop-visual \{[\s\S]*?width: 56px;[\s\S]*?height: 56px;/);
});
