import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const start = source.indexOf('export function spawnYawForTeam');
const end = source.indexOf('export function applyGroundFriction');
assert.ok(start >= 0 && end > start, 'spawn yaw helper must stay importable without Three.js');
const { spawnYawForTeam } = await import(`data:text/javascript,${encodeURIComponent(source.slice(start, end))}`);

test('spawn yaw faces each team toward the arena centre along Three camera forward -Z', () => {
    assert.equal(spawnYawForTeam('red'), Math.PI, 'red south spawn faces +Z toward centre');
    assert.equal(spawnYawForTeam('blue'), 0, 'blue north spawn faces -Z toward centre');
});

test('Player.respawn uses the canonical team spawn yaw helper', () => {
    assert.match(source, /this\.euler\.set\(0, spawnYawForTeam\(this\.team\), 0, 'YXZ'\);/);
});
