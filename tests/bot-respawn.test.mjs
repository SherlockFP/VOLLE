import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bot respawn restores its render and combat state', async () => {
    const source = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');

    assert.match(source, /tryDeflect\(ball, dt = 0\.016\) \{\s*if \(!this\.alive \|\| this\.attacking \|\| this\.attackTimer > 0\) return false;/);
    assert.match(source, /this\._deflectDecided = false;\s*this\._willDeflect = false;\s*this\.alive = true;/);
    assert.match(source, /this\.group\.position\.copy\(this\.position\);\s*this\.group\.rotation\.y = this\.team === 'red' \? 0 : Math\.PI;\s*this\.group\.visible = true;/);
    assert.match(source, /this\.group\.scale\.setScalar\(0\.01\);\s*this\.setTargetOutline\(false\);/);
});
