import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('FFA is one-shot and ends with one individual winner', async () => {
    const [modes, game, player] = await Promise.all([
        readFile(new URL('../js/gamemodes.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/game.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/player.js', import.meta.url), 'utf8')
    ]);

    assert.match(modes, /mutators: \{ ffa: true, noNet: true, noTeams: true, oneHitKill: true \}/);
    assert.match(game, /if \(this\._ffa\) \{\s*const alive = all\.filter\(p => p\.alive\);\s*if \(alive\.length > 1\) return false;/);
    assert.match(game, /winnerName,\s*red: this\.scoreboard\.redScore/);
    assert.match(game, /data\?\.winner === 'ffa' && data\.winnerName/);
    assert.match(game, /const rankedFfa = \[\.\.\.stats\]\.sort/);
    assert.match(game, /this\._won = this\._ffa \? winner === this\.playerName/);
    assert.match(player, /this\.game\?\.state === 'PLAYING' && !this\.game\?\._ffa/);
});
