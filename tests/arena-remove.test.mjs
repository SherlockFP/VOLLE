import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// game.js (black hole / split-ball expiry) and console.js call arena.remove();
// it used to be missing, so every expiry threw once per frame.
test('Arena.remove undoes Arena.add for short-lived effects', async () => {
    const source = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
    const body = source.match(/\n    remove\(obj\) \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(body, 'Arena.remove exists');
    const remove = new Function('obj', body);
    const removed = [];
    const self = { scene: { remove: o => removed.push(o) }, objects: ['a', 'b', 'c'] };
    assert.equal(remove.call(self, 'b'), 'b');
    assert.deepEqual(self.objects, ['a', 'c']);
    assert.deepEqual(removed, ['b']);
    assert.equal(remove.call(self, null), null);
    remove.call(self, 'missing');
    assert.deepEqual(self.objects, ['a', 'c']);
    const callers = (await readFile(new URL('../js/game.js', import.meta.url), 'utf8')).match(/this\.arena\.remove\(/g) || [];
    assert.ok(callers.length > 0);
});
