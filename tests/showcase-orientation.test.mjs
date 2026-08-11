import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, arena] = await Promise.all([
    readFile(new URL('../js/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/arena.js', import.meta.url), 'utf8')
]);

test('cosmetic practice opens at a readable front-facing presentation distance', () => {
    assert.match(main, /this\.player\.position\.set\(0, this\.player\.height, -8\);/);
    assert.match(main, /this\._cosmeticPracticeAvatar\.root\.rotation\.y = Math\.PI;/);
    assert.match(main, /this\._cosmeticPracticeAvatar\.root\.scale\.setScalar\(1\.55\);/);
    const start = arena.indexOf('cosmetic_studio: {');
    const studio = arena.slice(start, arena.indexOf('\n    temple_sym:', start));
    assert.match(studio, /sun: false/);
    assert.doesNotMatch(studio, /skyBottom: 0xf5fbff/);
});
