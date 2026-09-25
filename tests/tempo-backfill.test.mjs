// Tempo: the round-end wait still covers the killcam but no more, and solo can skip
// it. Backfill: casual online lobbies fill empty seats with bots, never in ranked,
// and only ever remove the bots they added.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractMethod } from './frame-contact-sim.mjs';
import { backfillPlan, BACKFILL_MIN_TEAM, BACKFILL_MAX_TEAM, BACKFILL_FFA_TOTAL } from '../js/bot-backfill.js';
import { roundEndSkipAllowed, SOLO_ROUND_SKIP_FROM_SECONDS } from '../js/run-it-back.js';

const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the round-end wait is 3 s: the whole 2.5 s killcam, then play', () => {
    const delay = Number(game.match(/this\.roundRestartDelay = ([\d.]+);/)[1]);
    const killcam = Number(game.match(/this\._killcamDuration = ([\d.]+);/)[1]);
    assert.equal(delay, 3);
    assert.ok(delay >= killcam, 'the killcam is never cut off');
});

test('solo may skip a non-final round-end after a beat; multiplayer and the final round never', () => {
    assert.equal(SOLO_ROUND_SKIP_FROM_SECONDS, 1);
    assert.equal(roundEndSkipAllowed({ solo: true, elapsed: 1.2, outcome: 'next' }), true);
    assert.equal(roundEndSkipAllowed({ solo: true, elapsed: 0.4, outcome: 'next' }), false);
    assert.equal(roundEndSkipAllowed({ solo: false, elapsed: 2, outcome: 'next' }), false);
    assert.equal(roundEndSkipAllowed({ solo: true, elapsed: 2, outcome: 'end' }), false);
    assert.equal(roundEndSkipAllowed({ solo: true, elapsed: 2, outcome: 'overtime' }), false);

    const skipRoundEnd = new Function('STATES', 'roundEndSkipAllowed',
        `return ({ ${extractMethod(game, 'skipRoundEnd')} }).skipRoundEnd;`)({ ROUND_END: 'ROUND_END' }, roundEndSkipAllowed);
    const fake = (extra = {}) => ({ state: 'ROUND_END', network: null, _roundEndElapsed: 1.5, roundRestartTimer: 1.5, _roundEndOutcome: () => 'next', ...extra });
    const solo = fake();
    assert.equal(skipRoundEnd.call(solo), true);
    assert.equal(solo.roundRestartTimer, 0, 'the normal ROUND_END branch starts the next round');
    const online = fake({ network: { connected: true } });
    assert.equal(skipRoundEnd.call(online), false);
    assert.equal(online.roundRestartTimer, 1.5);
    assert.equal(skipRoundEnd.call(fake({ state: 'PLAYING' })), false);
    assert.match(main, /this\.game\.state === STATES\.ROUND_END && CELEBRATION_SKIP_KEYS\.includes\(e\.code\)\s+&& !e\.repeat && this\.game\.skipRoundEnd\?\.\(\)/);
});

test('backfill: a lone host gets a 2v2, uneven teams even out, the cap holds', () => {
    assert.equal(BACKFILL_MIN_TEAM, 2);
    assert.equal(BACKFILL_MAX_TEAM, 4);
    assert.deepEqual(backfillPlan({ red: 1, blue: 0 }), { red: 1, blue: 2 });
    assert.deepEqual(backfillPlan({ red: 2, blue: 1 }), { red: 0, blue: 1 });
    assert.deepEqual(backfillPlan({ red: 3, blue: 1 }), { red: 0, blue: 2 });
    assert.deepEqual(backfillPlan({ red: 6, blue: 1 }), { red: 0, blue: 3 }, 'never more than 4 a side');
    assert.deepEqual(backfillPlan({ red: 2, blue: 2 }), { red: 0, blue: 0 });
});

test('backfill: humans take bot seats back, hand-picked bots stay', () => {
    // After a filled match: red = host + 1 backfill, blue = 2 backfill; a human joins blue.
    assert.deepEqual(backfillPlan({ red: 2, blue: 3, backfillRed: 1, backfillBlue: 2 }), { red: 0, blue: -1 });
    // Humans fill both teams to 3v3: every backfill bot leaves.
    assert.deepEqual(backfillPlan({ red: 4, blue: 5, backfillRed: 1, backfillBlue: 2 }), { red: -1, blue: -2 });
    // 3 humans vs 2: one backfill bot stays to even it out.
    assert.deepEqual(backfillPlan({ red: 4, blue: 4, backfillRed: 1, backfillBlue: 2 }), { red: -1, blue: -1 });
    // A host's own bots (not backfill) count as players and are never removed.
    assert.deepEqual(backfillPlan({ red: 3, blue: 1, backfillRed: 0, backfillBlue: 0 }), { red: 0, blue: 2 });
});

test('backfill never runs in ranked, competitive, the 1v1 duel or with the toggle off', () => {
    const filled = { red: 2, blue: 2, backfillRed: 1, backfillBlue: 2 };
    for (const off of [{ ranked: true }, { modeId: 'competitive' }, { modeId: 'rally_duel' }, { enabled: false }]) {
        assert.deepEqual(backfillPlan({ red: 1, blue: 0, ...off }), { red: -0, blue: -0 });
        assert.deepEqual(backfillPlan({ ...filled, ...off }), { red: -1, blue: -2 }, 'leftover backfill bots leave');
    }
});

test('backfill in FFA fills to four players, split across the labels', () => {
    assert.equal(BACKFILL_FFA_TOTAL, 4);
    const plan = backfillPlan({ red: 1, blue: 0, ffa: true });
    assert.equal(plan.red + plan.blue, 3);
    assert.deepEqual(plan, { red: 1, blue: 2 });
    assert.deepEqual(backfillPlan({ red: 3, blue: 2, ffa: true }), { red: 0, blue: 0 });
});

test('wiring: host start and rematch fill before the snapshot; the toggle defaults on', () => {
    assert.match(main, /this\._rollLobbyMapIfRandom\(\);\s+this\._backfillLobbyBots\?\.\(\);\s+const started = this\.game\.startGame\(\);/);
    assert.match(main, /this\._backfillLobbyBots\?\.\(\{ quiet: true \}\);\s+const started = this\.game\.startGame\(false, matchId\);/);
    assert.match(main, /if \(!this\.network\?\.connected \|\| !this\.network\.isHost \|\| this\._backfillRunning\) return 0;/, 'solo and clients never fill');
    assert.match(main, /if \(bot\) bot\._backfill = true;/);
    assert.match(main, /find\(entry => entry\._backfill && entry\.team === team\)/, 'only backfill bots are removed');
    assert.match(html, /<input type="checkbox" id="lobby-fill-bots" checked>/);
});

test('a kicked seat stays empty: the host can play 2v1 on purpose', () => {
    // 2 humans red, 1 human blue: blue would get a bot...
    assert.deepEqual(backfillPlan({ red: 2, blue: 1 }), { red: 0, blue: 1 });
    // ...the host kicks it (skipBlue 1): no refill, 2v1 it is.
    assert.deepEqual(backfillPlan({ red: 2, blue: 1, skipBlue: 1 }), { red: 0, blue: 0 });
    // A lone host kicks one AUTO bot on blue: red keeps its filler, blue has one.
    assert.deepEqual(backfillPlan({ red: 2, blue: 2, backfillRed: 1, backfillBlue: 2, skipBlue: 1 }), { red: 0, blue: -1 });
    // FFA: a kicked seat lowers the fill total too.
    assert.deepEqual(backfillPlan({ red: 1, blue: 0, ffa: true, skipBlue: 1 }), { red: 1, blue: 1 });
});

test('wiring: every lobby change re-plans, kicks and "- BOT" empty a seat, "+ Bot" and the toggle hand it back', () => {
    const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    assert.match(main, /broadcastLobbyState\(\) \{\s+if \(!\(this\.network\?\.isHost\)\) return;\s+if \(this\.game\.state === STATES\.LOBBY\) this\._backfillLobbyBots\?\.\(\{ broadcast: false \}\);/);
    assert.match(main, /if \(bot\) this\._noteBackfillSeat\?\.\(bot\.team, \+1\);\s+this\.game\.removeBotByName\(name\);/);
    assert.match(main, /if \(lastBot\) this\._noteBackfillSeat\?\.\(lastBot\.team, \+1\);\s+this\.game\.removeBot\(\);/);
    assert.equal((main.match(/this\._noteBackfillSeat\?\.\('(red|blue)', -1\);/g) || []).length, 2);
    assert.match(main, /if \(event\.target\.checked\) this\._backfillSkips = \{ red: 0, blue: 0 \};/);
    assert.match(main, /if \(!this\.network\?\.connected \|\| !this\.network\.isHost \|\| this\._backfillRunning\) return 0;/, 'no re-entry from the broadcast it triggers');
    assert.match(game, /\.\.\.\(b\._backfill \? \{ autoFill: true \} : \{\}\)/);
    assert.match(ui, /p\.autoFill \? 'BOT · AUTO' : 'BOT'/);
});
