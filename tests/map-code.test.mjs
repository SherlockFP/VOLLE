// Map share codes: exact round trip, strict rejection of damaged or unsafe codes,
// ids derived from the code, and the lobby carrying the code to every client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MAP_CODE_MAX_LENGTH, decodeMapCode, encodeMapCode, isCodedMapId, mapIdForCode } from '../js/map-code.js';
import { MAX_MAP_PROPS, normalizeMapConfig } from '../js/map-config.js';

function sampleMap(propCount = 12) {
    return normalizeMapConfig({
        name: "Kaan'ın Arenası",
        dimensions: { width: 80, length: 110, wallHeight: 18, ceilingHeight: 0 },
        colors: { floorRed: '#aa2233', floorBlue: '#2233aa', wall: '#99aabb', sky: '#112244', fog: '#334455' },
        weather: 'snow',
        flags: { openAir: true, slippery: true, portals: false },
        props: Array.from({ length: propCount }, (_, i) => ({
            type: ['box', 'cylinder', 'sphere', 'cone'][i % 4],
            position: { x: (i % 8) * 9 - 32, y: 2, z: Math.floor(i / 8) * 12 - 45 },
            size: [2 + (i % 3), 3.5, 2.25],
            color: '#3a7' + String(i % 10) + 'c0'
        }))
    });
}
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

test('a map survives encode -> decode exactly, even at the 64-prop limit', () => {
    for (const count of [0, 12, MAX_MAP_PROPS]) {
        const map = sampleMap(count);
        const code = encodeMapCode(map);
        assert.ok(code.startsWith('VM1.'));
        assert.ok(code.length < MAP_CODE_MAX_LENGTH);
        const back = decodeMapCode(code);
        assert.equal(back.ok, true, back.error);
        assert.deepEqual(back.config, map);
    }
    const spaced = encodeMapCode(sampleMap(3)).replace(/(.{40})/g, '$1\n  ');
    assert.equal(decodeMapCode(spaced).ok, true, 'line breaks from chat apps are ignored');
});

test('damaged, oversized or unsafe codes are refused with a reason', () => {
    const good = [1, 'Fine', [80, 110, 18, 0], ['aa2233', '2233aa', '99aabb', '112244', '334455'], 1, 0, []];
    assert.equal(decodeMapCode(`VM1.${b64(good)}`).ok, true);
    const cases = {
        'no prefix': 'hello',
        'bad characters': 'VM1.abc$def',
        'not json': `VM1.${Buffer.from('{oops').toString('base64url')}`,
        'wrong version': `VM1.${b64([2, ...good.slice(1)])}`,
        'markup in name': `VM1.${b64([1, '<img src=x onerror=1>', ...good.slice(2)])}`,
        'url in name': `VM1.${b64([1, 'visit https://evil.test', ...good.slice(2)])}`,
        'too wide': `VM1.${b64([1, 'Big', [9000, 110, 18, 0], ...good.slice(3)])}`,
        'too many props': `VM1.${b64([...good.slice(0, 6), Array.from({ length: MAX_MAP_PROPS + 1 }, () => [0, 0, 1, 0, [2, 2, 2], 'cccccc'])])}`,
        'unknown prop type': `VM1.${b64([...good.slice(0, 6), [[9, 0, 1, 0, [2, 2, 2], 'cccccc']]])}`,
        'too long': `VM1.${'A'.repeat(MAP_CODE_MAX_LENGTH)}`
    };
    for (const [label, code] of Object.entries(cases)) {
        const result = decodeMapCode(code);
        assert.equal(result.ok, false, label);
        assert.equal(typeof result.error, 'string', label);
    }
});

test('the map id comes from the code: same code, same id; fits registerCustomMap', () => {
    const code = encodeMapCode(sampleMap(5));
    const id = mapIdForCode(code);
    assert.equal(id, mapIdForCode(` ${code}\n`));
    assert.notEqual(id, mapIdForCode(encodeMapCode(sampleMap(6))));
    assert.equal(isCodedMapId(id), true);
    assert.match(id, /^custom-[a-z0-9_-]{1,40}$/i);
    assert.equal(isCodedMapId('custom-local'), false);
    assert.equal(isCodedMapId('beach'), false);
});

test('the lobby carries the code and clients only accept a code matching the host map id', () => {
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(game, /if \(expectedMapId && expectedMapId !== mapId\) return null;/);
    assert.match(game, /this\.network\.broadcast\(\{ type: 'mapChange', mapId, \.\.\.\(mapCode \? \{ mapCode \} : \{\}\) \}\);/);
    assert.match(game, /mapCode: this\.mapCodeFor\?\.\(this\.arena\?\.mapId\) \|\| undefined,/);
    assert.match(game, /if \(data\.mapCode\) this\.adoptMapCode\?\.\(data\.mapCode, data\.mapId\);/);
    assert.equal((game.match(/if \(data\.mapCode\) this\.adoptMapCode\?\.\(data\.mapCode, data\.map\);/g) || []).length, 2,
        'in-progress sync and game start both adopt before rebuild');
    assert.match(main, /this\.store\.set\('lobbyCustomMap', true\);[\s\S]{0,200}this\.game\.selectMap\(mapId\);/,
        'the random roll at match start must not replace a coded map');
});

test('a late joiner sees the coded map in the lobby: lobbyState carries the code, the client adopts it', async () => {
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /map: this\.arena\?\.mapId,\s+mapCode: this\.game\.mapCodeFor\?\.\(this\.arena\?\.mapId\) \|\| undefined,/);
    const start = main.indexOf('    _applyClientLobbyStatePresentation(data) {');
    const end = main.indexOf('\n    _applyInitialLobbyWelcome(data)', start);
    const method = main.slice(start, end);
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    const apply = new Function('GAME_MODES', `return function(data) {${body}}`)({ classic: {} });
    const code = encodeMapCode(sampleMap(3));
    const codedId = mapIdForCode(code);
    const applied = [];
    const self = {
        game: {
            mode: { id: 'classic' },
            adoptMapCode: (c, expected) => (mapIdForCode(c) === expected ? expected : null),
            getSelectableMaps: () => ['beach', 'harbor'],
            applyModeChange() {},
            applyMapChange: change => applied.push(change),
            onModeChange() {}
        }
    };
    apply.call(self, { map: codedId, mapCode: code });
    assert.deepEqual(applied.at(-1), { mapId: codedId }, 'adopted first, then switched to');
    applied.length = 0;
    apply.call(self, { map: 'custom-code-zzzz', mapCode: code });
    apply.call(self, { map: codedId });
    assert.deepEqual(applied, [], 'a code for another map, or no code for a coded map, is ignored');
    apply.call(self, { map: 'beach' });
    assert.deepEqual(applied, [{ mapId: 'beach' }]);
    assert.match(main, /const welcomeCode = data\.mapCode \?\? data\.snapshot\?\.mapCode;/);
});
