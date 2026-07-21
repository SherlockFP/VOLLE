import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const arenaPath = new URL('../js/arena.js', import.meta.url);
const arenaSource = await readFile(arenaPath, 'utf8');
const moduleSource = arenaSource
    .replace(/^import \* as THREE from 'three';$/m, 'const THREE = {};')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';$/m, 'class WeatherSystem {}');

assert.equal(moduleSource.includes("from 'three'"), false);
assert.equal(moduleSource.includes("from './weather.js'"), false);

const {
    MAPS,
    getArenaBounds,
    getSpectatorBounds,
    isFallDeathPosition,
    isOutsideArenaBounds
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

test('new procedural arenas expose stable IDs and mechanic metadata', () => {
    assert.equal(MAPS.dropworks.isVerticalDrop, true);
    assert.equal(MAPS.grand_stadium.isStadium, true);
    assert.equal(MAPS.circuit_dome.isCyber, true);
    assert.ok(MAPS.dropworks.gameplay.mechanics.includes('vertical-drop'));
    assert.ok(MAPS.dropworks.gameplay.mechanics.includes('fall-death'));
    assert.ok(MAPS.grand_stadium.gameplay.mechanics.includes('stadium-bounds'));
    assert.deepEqual(MAPS.circuit_dome.gameplay.mechanics, ['symmetric-lanes', 'clear-sightlines', 'pulse-rail']);
});

test('every map exposes spectator, gameplay, and procedural sky metadata', () => {
    for (const [id, config] of Object.entries(MAPS)) {
        assert.ok(config.spectator, `${id} spectator metadata`);
        assert.ok(Array.isArray(config.spectator.stands), `${id} spectator stands`);
        assert.ok(config.spectator.bounds, `${id} spectator bounds`);
        assert.ok(Array.isArray(config.gameplay?.mechanics), `${id} gameplay mechanics`);
        assert.ok(Number.isFinite(config.gameplay?.fallDeathY), `${id} fall-death bound`);
        assert.ok(config.sky, `${id} sky metadata`);
        assert.equal(JSON.stringify(config.sky).includes('http'), false, `${id} sky uses no remote asset`);
    }
});

test('beach volleyball config has regulation net and bounded sand gameplay hints', () => {
    const beach = MAPS.beach_open;

    assert.equal(beach.gameplay.netHeight, 2.43);
    assert.ok(beach.gameplay.sandTraction > 0 && beach.gameplay.sandTraction <= 1);
    assert.ok(beach.gameplay.ballGravityScale > 0 && beach.gameplay.ballGravityScale <= 1);
    assert.equal(beach.spectator.stands.length, 2);
});

test('arena bounds helpers are pure and handle fall-death thresholds', () => {
    const config = MAPS.dropworks;
    const before = structuredClone(config);
    const bounds = getArenaBounds(config, 3);
    const spectatorBounds = getSpectatorBounds(config);

    assert.deepEqual(config, before);
    assert.deepEqual(bounds, {
        minX: -39,
        maxX: 39,
        minY: 0,
        maxY: 52,
        minZ: -49,
        maxZ: 49
    });
    assert.notEqual(spectatorBounds, config.spectator.bounds);
    assert.equal(isOutsideArenaBounds({ x: 0, y: 2, z: 0 }, bounds), false);
    assert.equal(isOutsideArenaBounds({ x: 40, y: 2, z: 0 }, bounds), true);
    assert.equal(isFallDeathPosition({ y: -14 }, config), false);
    assert.equal(isFallDeathPosition({ y: -14.01 }, config), true);
});

test('stand geometry metadata remains under the runtime mesh budget', () => {
    for (const config of Object.values(MAPS)) {
        assert.ok(config.spectator.stands.length <= 8);
        const tierMeshes = config.spectator.stands.reduce(
            (sum, stand) => sum + Math.min(8, Math.max(1, Math.floor(stand.tiers || 1))),
            0
        );
        assert.ok(tierMeshes <= 32, `${config.name} stand tier mesh count`);
    }
});

test('legacy map dimensions and flags remain available', () => {
    assert.equal(MAPS.beach.courtWidth, 106);
    assert.equal(MAPS.industrial.courtLength, 112);
    assert.equal(MAPS.space.lowGravity, true);
    assert.equal(MAPS.ice.slippery, true);
});
