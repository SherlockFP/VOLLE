import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Scoreboard } from '../js/scoreboard.js';

test('the HUD labels the shared match clock rather than implying a fresh round clock', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const clock = html.match(/<div[^>]*id="hud-round-timer"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(clock, 'live HUD clock is present');
    assert.match(clock, /<span>MATCH<\/span>/);
    assert.match(clock, /data-timer-value/);
});

test('the displayed time limit is consumed across rounds and restored only for a new match', () => {
    const scoreboard = new Scoreboard();
    scoreboard.setTimeLimit(180);
    scoreboard.newRound();
    scoreboard.updateTimer(20);
    scoreboard.newRound();
    assert.equal(scoreboard.timeRemaining, 160);
    assert.equal(scoreboard.getFormattedTime(), '2:40');
    scoreboard.updateTimer(40);
    scoreboard.newRound();
    assert.equal(scoreboard.getFormattedTime(), '2:00');
    scoreboard.reset();
    assert.equal(scoreboard.roundNum, 0);
    assert.equal(scoreboard.getFormattedTime(), '3:00');
});
