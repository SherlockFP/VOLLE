import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { getCompetitiveHUDView } from '../js/competitive-hud.js';

test('competitive HUD stays hidden outside normalized rulesets', () => {
    assert.deepEqual(getCompetitiveHUDView(), {
        active: false,
        mode: '',
        roundLabel: '',
        phase: '',
        rulesLabel: '',
        ariaLabel: '',
        key: ''
    });
});

test('competitive HUD exposes stable round and disabled-rule communication', () => {
    const view = getCompetitiveHUDView({
        active: true,
        mode: 'Rally Duel',
        round: 2,
        maxRounds: 5,
        abilities: false,
        runes: false,
        passives: false,
        powerUps: false
    });
    assert.equal(view.mode, 'RALLY DUEL');
    assert.equal(view.roundLabel, 'ROUND 2/5');
    assert.equal(view.phase, 'LIVE');
    assert.equal(view.rulesLabel, 'NO POWERS / NORMALIZED');
    assert.match(view.ariaLabel, /Abilities disabled.*Power-ups disabled/);
});

test('competitive HUD prioritizes sudden death and sanitizes numeric state', () => {
    const view = getCompetitiveHUDView({
        active: true,
        mode: '<unsafe>',
        round: Number.NaN,
        maxRounds: -4,
        overtime: true,
        suddenDeath: true,
        tiebreakRound: 3
    });
    assert.equal(view.roundLabel, 'TIEBREAK 3');
    assert.equal(view.phase, 'SUDDEN DEATH');
    assert.equal(view.mode, '<UNSAFE>');
});

test('competitive HUD is wired to the authoritative game HUD payload', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
    const game = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const network = await readFile(new URL('../js/network.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    assert.match(html, /id="hud-competitive-status"[\s\S]*?aria-live="polite"/);
    assert.match(ui, /this\.updateCompetitiveHUD\(competitive\);/);
    assert.match(ui, /showHUD\(\)\s*\{\s*this\.updateCompetitiveHUD\(\);/);
    assert.match(game, /competitive: this\.getCompetitiveHUDState\(\)/);
    assert.match(game, /overtimeExtends: this\._overtimeExtends/);
    assert.match(game, /overtimeTimer: this\._overtimeTimer/);
    assert.match(game, /suddenDeathAnnounced: this\._suddenDeathAnnounced/);
    assert.match(game, /startRoundFromNetwork\(data = \{\}\)[\s\S]*?this\._applyOvertimeSnapshot\(data\);/);
    assert.match(network, /broadcastRoundStart\(snapshot = \{\}\)[\s\S]*?overtimeExtends:[\s\S]*?overtimeTimer:[\s\S]*?suddenDeathAnnounced:/);
    assert.match(css, /#hud \.hud-top\s*\{[\s\S]*?flex-direction: column/);
    assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.hud-competitive-status/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.hud-speed-text\s*\{[\s\S]*?display: none/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
