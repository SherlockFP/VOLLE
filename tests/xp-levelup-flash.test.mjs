// tests/xp-levelup-flash.test.mjs — the post-game XP bar's level-up flash and
// its Reduce Motion behavior (js/ui.js#_paintXpBarFill, #setPostGameRewardReceipt),
// plus the main.js hook that resolves the MVP's live loadout before showPostGame
// paints. Source-inspection style, matching tests/postgame-broadcast.test.mjs —
// js/ui.js pulls in enough browser-only globals that it isn't imported directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const ui = read('../js/ui.js');
const main = read('../js/main.js');
const css = read('../css/postgame.css');

test('_paintXpBarFill sets the final width instantly under reduced motion, with no flash', () => {
    const start = ui.indexOf('    _paintXpBarFill(');
    const end = ui.indexOf('\n    // Animated XP-source', start);
    const body = ui.slice(start, end === -1 ? undefined : end);
    assert.match(body, /if \(!leveledUp \|\| this\._isReducedMotion\(\)\) \{\s*fill\.style\.width = perc \+ '%';\s*return;/);
    assert.match(body, /fill\.classList\.remove\('pg-xp-levelup'\);/);
});

test('a real level-up fills to 100%, flashes, then rolls over on transitionend or a safety-net timeout', () => {
    const start = ui.indexOf('    _paintXpBarFill(');
    const end = ui.indexOf('\n    // Animated XP-source', start);
    const body = ui.slice(start, end === -1 ? undefined : end);
    assert.match(body, /fill\.style\.width = '100%';/);
    assert.match(body, /fill\.classList\.add\('pg-xp-levelup'\);/);
    assert.match(body, /fill\.addEventListener\('transitionend', onFull\);/);
    // transitionend alone can be suppressed (hidden tab, a zero-duration user
    // stylesheet, the panel closing mid-flash), so a bounded timeout must also
    // be able to trigger the same rollover exactly once.
    assert.match(body, /const safety = setTimeout\(rollover, 1700\);/);
    assert.match(body, /let rolled = false;\s*const rollover = \(\) => \{\s*if \(rolled\) return;\s*rolled = true;/);
    assert.match(body, /clearTimeout\(safety\);/);
});

test('setPostGameRewardReceipt detects level-up by comparing to the pre-grant snapshot, not a receipt flag', () => {
    assert.match(ui, /this\._postGameStartLevel = account\.level;/);
    assert.match(ui, /this\._postGameStartPrestige = account\.prestige \|\| 0;/);
    const start = ui.indexOf('    setPostGameRewardReceipt(');
    const end = ui.indexOf('\n    setPostGameRewardRetry(', start);
    const body = ui.slice(start, end);
    assert.match(body, /const leveledUp = account\.level > \(this\._postGameStartLevel \?\? account\.level\)\s*\|\| \(account\.prestige \|\| 0\) > \(this\._postGameStartPrestige \?\? \(account\.prestige \|\| 0\)\);/);
    assert.match(body, /this\._paintXpBarFill\(progress, \{ leveledUp \}\);/);
    assert.match(body, /document\.getElementById\('pg-level'\)\.textContent = accountRankLabel\(account\);/);
});

test('the level-up flash animation is fully disabled under both reduced-motion toggles', () => {
    assert.match(css, /body\.reduced-motion #post-game-screen \.pg-xp-bar-fill,[\s\S]*?\.reduce-motion #post-game-screen \.pg-bp-bar-fill \{[\s\S]*?transition: none;[\s\S]*?animation: none;/);
});

test('js/main.js resolves the MVP loadout from live game state before awardMatchRewards runs', () => {
    const start = main.indexOf('this.game.onMatchComplete = () => {');
    const end = main.indexOf('this.productAnalytics.track(\'match_complete\'', start);
    const body = main.slice(start, end);
    assert.match(body, /const mvp = selectMvp\(this\.game\.scoreboard\.getPlayerStats\(\)\);/);
    assert.match(body, /this\.ui\.setPostGameMvpShowcase\?\.\(this\.game\.matchId, mvp && resolveMvpLoadout\(mvp, \{ game: this\.game, player: this\.player, store: this\.store \}\)\);/);
    assert.match(body, /this\.awardMatchRewards\(\);/, 'the MVP lookup must run before the reward grant, not replace it');
});
