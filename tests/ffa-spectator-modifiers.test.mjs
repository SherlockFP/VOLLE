import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('FFA supports spectator targets and FFA-only round modifiers', async () => {
    const [game, ball, main] = await Promise.all([
        readFile(new URL('../js/game.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/ball.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/main.js', import.meta.url), 'utf8')
    ]);

    assert.match(game, /\['ffa_sudden', 'ffa_double'\]\.includes\(modifier\)/);
    assert.match(game, /this\.ball\._ffaSpeedMultiplier = modifier === 'ffa_sudden' && this\._ffa \? 1\.3 : 1;/);
    assert.match(game, /this\.spawnSplitBall\(this\.ball, 18\)/);
    assert.match(game, /this\._ffa\s*\? this\.getAllTargets\(\)\.filter\(p => p !== this\.player && p\.alive\)/);
    assert.match(ball, /\(this\._ffaSpeedMultiplier \|\| 1\)/);
    assert.match(main, /this\.game\._ffa\s*\? `FFA \$\{view\.distance <= 1 \? 'POV' : 'TPS'\}/);
});
