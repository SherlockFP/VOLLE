import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHARACTERS } from '../js/characters.js';

test('Soldier exposes a bounded rocket-jump loadout', () => {
    const soldier = CHARACTERS.soldier;
    assert.equal(soldier.passive, 'rocket_jump');
    assert.ok(soldier.maxHp >= 80 && soldier.maxHp <= 150);
    assert.ok(soldier.speed >= 8 && soldier.speed <= 13);
    assert.ok(soldier.price > 0);
});

test('rocket fire audio is bundled as a non-empty local asset', async () => {
    const audio = await readFile(new URL('../sfx/rocket_fire.sfx', import.meta.url));
    assert.ok(audio.length > 10_000);
    assert.notEqual(audio.subarray(0, 8).toString('utf8').toLowerCase(), '<!doctype');
});
