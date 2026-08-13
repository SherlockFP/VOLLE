import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const arenaSource = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
const moduleSource = arenaSource
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, '')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');

const { MAPS, getLobbyPreviewCommands } = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
);

test('volleyball and factory expose small, distinct immutable lobby signatures', () => {
    const volleyball = getLobbyPreviewCommands(MAPS.beach_open);
    const factory = getLobbyPreviewCommands(MAPS.industrial);

    assert.ok(volleyball.length > 0 && volleyball.length <= 6);
    assert.ok(factory.length > 0 && factory.length <= 6);
    assert.deepEqual(volleyball.map(command => command.kind), [
        'shore', 'shore', 'net', 'palm', 'palm', 'service-rings'
    ]);
    assert.deepEqual(factory.map(command => command.kind), [
        'truss', 'conveyor', 'crate', 'crate', 'safety-lamps'
    ]);
    assert.notDeepEqual(volleyball.map(command => command.kind), factory.map(command => command.kind));
    assert.equal(Object.isFrozen(MAPS.beach_open.lobbyPreview), true);
    assert.equal(Object.isFrozen(MAPS.industrial.lobbyPreview), true);
    assert.equal(Object.isFrozen(volleyball[0]), true);
});

test('lobby preview command lookup is pure and rejects unknown primitives', () => {
    const config = structuredClone(MAPS.industrial);
    const before = structuredClone(config);

    assert.deepEqual(getLobbyPreviewCommands(config), config.lobbyPreview);
    assert.deepEqual(config, before);
    assert.deepEqual(getLobbyPreviewCommands({ lobbyPreview: [{ kind: 'unknown' }] }), []);
});
