// Play of the Game: every elimination is recorded, the best moment (multi-kills,
// long rallies, perfect/headshot) is picked across all players, shown on the
// report, and in solo it plays in the replay viewer and returns to the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pickPlayOfTheGame, playTags, scorePlay, POTG_CHAIN_MS, POTG_LEAD_MS, POTG_TAIL_MS } from '../js/play-of-game.js';
import { createReplayHighlights } from '../js/replay.js';

const kill = (t, attacker, victim, extra = {}) => ({ t, type: 'kill', data: { attacker, victim, rally: 0, perfect: false, headshot: false, ...extra } });

test('a triple kill beats a single perfect kill; the window leads into the first kill', () => {
    const replay = {
        duration: 60000,
        events: [
            kill(5000, 'Deniz', 'Bot-1', { perfect: true, rally: 4 }),
            kill(20000, 'Kaan', 'Bot-2', { rally: 2 }),
            kill(22000, 'Kaan', 'Bot-3'),
            kill(25500, 'Kaan', 'Bot-4', { headshot: true }),
            kill(40000, 'Environment', 'Kaan'),
            kill(41000, 'Bot-5', 'Bot-5')
        ]
    };
    const play = pickPlayOfTheGame(replay);
    assert.equal(play.player, 'Kaan');
    assert.equal(play.streak, 3);
    assert.equal(play.headshot, true);
    assert.equal(play.start, 20000 - POTG_LEAD_MS);
    assert.equal(play.end, 25500 + POTG_TAIL_MS);
    assert.ok(play.score > scorePlay({ perfect: true, rally: 4 }));
    assert.deepEqual(playTags(play, key => key), ['potg.triple', 'potg.headshot']);
});

test('chains break after the window; environment and self kills never count', () => {
    const spaced = pickPlayOfTheGame({ events: [kill(1000, 'Kaan', 'A'), kill(1000 + POTG_CHAIN_MS + 1, 'Kaan', 'B')] });
    assert.equal(spaced.streak, 1);
    assert.equal(pickPlayOfTheGame({ events: [kill(1000, 'Environment', 'A'), kill(2000, 'X', 'X')] }), null);
    assert.equal(pickPlayOfTheGame({ events: [] }), null);
});

test('a long rally wins by itself when nobody scored; tags stay readable', () => {
    const play = pickPlayOfTheGame({ duration: 9000, events: [{ t: 3000, type: 'deflect', data: { rally: 9 } }, { t: 1000, type: 'deflect', data: { rally: 3 } }] });
    assert.equal(play.kind, 'rally');
    assert.equal(play.rally, 9);
    assert.equal(play.player, '');
    const t = (key, params) => ({ 'potg.rally': `${params?.count} rally`, 'potg.double': 'Double kill', 'potg.kill': 'Elimination', 'potg.perfect': 'Perfect' }[key] || key);
    assert.deepEqual(playTags(play, t), ['9 rally']);
    assert.deepEqual(playTags({ kind: 'kill', streak: 2, rally: 12, perfect: true }, t), ['Double kill', '12 rally', 'Perfect']);
});

test('the Replays screen highlights now include everyone\'s eliminations', () => {
    const highlights = createReplayHighlights({ duration: 30000, events: [kill(10000, 'Deniz', 'Bot-1', { rally: 5 })] });
    assert.equal(highlights.length, 1);
    assert.match(highlights[0].label, /Deniz · Elimination/);
});

test('wiring: kills are recorded, the report shows the card, solo watching returns to the report', () => {
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    const view = readFileSync(new URL('../js/replay-view.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(game, /if \(!this\._claimKillPresentation\(attackerName, victimName, rallyCount, detail\)\) return false;\s+\/\/[^\n]*\n\s+this\.onReplayEvent\?\.\(\{\s+type: 'kill',/);
    assert.match(main, /this\._presentPlayOfTheGame\?\.\(this\.game\.matchId\);\s+this\.awardMatchRewards\(\);/);
    assert.match(main, /canWatch: !!play && !this\.network\?\.connected/);
    assert.match(main, /if \(!entry \|\| entry\.matchId !== this\.game\.matchId \|\| this\.network\?\.connected \|\| this\.game\.state !== STATES\.GAME_OVER\) return false;/);
    assert.match(main, /back\.hidden\.forEach\(group => \{ group\.visible = true; \}\);\s+this\.game\.setState\(STATES\.GAME_OVER\);/);
    assert.match(main, /position: \{ x: this\.player\.position\.x, y: this\.player\.position\.y - 1\.7, z: this\.player\.position\.z \}/, 'replays record feet height');
    assert.match(ui, /chip\.textContent = label;/);
    assert.match(view, /createCharacterRig\(\{ characterId: 'rally', team, castShadow: false \}\)/);
    assert.match(html, /<section class="pg-potg" id="pg-potg" hidden/);
    assert.match(html, /<button id="btn-pg-potg-watch"[^>]*hidden/);
});
