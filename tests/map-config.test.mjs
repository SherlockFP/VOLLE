import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_MAP_PROPS,
    PRIMITIVE_TYPES,
    addMapProp,
    deleteMapProp,
    normalizeMapConfig,
    validateMapConfig
} from '../js/map-config.js';
import {
    canvasToWorld,
    findMapPropAt,
    worldToCanvas
} from '../js/map-editor.js';

test('normalization supplies a complete bounded default config', () => {
    const config = normalizeMapConfig();

    assert.equal(config.name, 'Custom Arena');
    assert.deepEqual(config.dimensions, {
        width: 100,
        length: 120,
        wallHeight: 20,
        ceilingHeight: 30
    });
    assert.equal(config.weather, 'clear');
    assert.deepEqual(config.props, []);
    assert.deepEqual(Object.values(config.flags), [false, false, false, false, false]);
});

test('numeric dimensions, positions, and sizes clamp to safe finite ranges', () => {
    const input = {
        dimensions: {
            width: 999,
            length: -1,
            wallHeight: Infinity,
            ceilingHeight: '40'
        },
        props: [{
            type: 'box',
            position: { x: 999, y: NaN, z: -999 },
            size: { width: 0, height: 999, depth: Infinity }
        }]
    };
    const config = normalizeMapConfig(input);

    assert.deepEqual(config.dimensions, {
        width: 300,
        length: 20,
        wallHeight: 20,
        ceilingHeight: 40
    });
    assert.deepEqual(config.props[0].position, { x: 150, y: 40, z: -10 });
    assert.deepEqual(config.props[0].size, { width: 0.25, height: 80, depth: 4 });
    assert.equal(validateMapConfig(input).valid, false);
});

test('colors accept only local hex values and numbers', () => {
    const config = normalizeMapConfig({
        colors: {
            floorRed: '#AbC',
            floorBlue: 0x1234,
            wall: 'red',
            sky: 'url(https://example.test/a.png)'
        }
    });

    assert.equal(config.colors.floorRed, '#aabbcc');
    assert.equal(config.colors.floorBlue, '#001234');
    assert.equal(config.colors.wall, '#aac0d8');
    assert.equal(config.colors.sky, '#88bbff');
});

test('unsafe URLs, markup, code, and unsafe keys fail validation and are not retained', () => {
    for (const value of [
        { name: 'https://example.test/map' },
        { name: '<script>alert(1)</script>' },
        { name: 'x => x' },
        { url: 'https://example.test/map.json' },
        { props: [{ type: 'box', code: 'eval(1)' }] }
    ]) {
        const result = validateMapConfig(value);
        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('unsafe') || error.includes('name')));
        assert.equal(JSON.stringify(result.config).includes('http'), false);
        assert.equal(JSON.stringify(result.config).includes('eval'), false);
    }
});

test('primitive whitelist and 64 prop cap are enforced', () => {
    const props = Array.from({ length: MAX_MAP_PROPS + 5 }, (_, index) => ({
        id: `item-${index}`,
        type: index === 0 ? 'mesh' : PRIMITIVE_TYPES[index % PRIMITIVE_TYPES.length],
        pos: [index, 1, index],
        size: [2, 4, 2]
    }));
    const result = validateMapConfig({ props });

    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(`props cannot exceed ${MAX_MAP_PROPS}`));
    assert.ok(result.errors.includes('props[0].type is not allowed'));
    assert.equal(result.config.props.length, MAX_MAP_PROPS);
    assert.equal(result.config.props[0].type, 'box');
});

test('shape-specific data is normalized and duplicate IDs become unique', () => {
    const config = normalizeMapConfig({
        props: [
            { id: 'same', type: 'sphere', pos: [1, 2, 3], size: [5], color: '#f00' },
            { id: 'same', type: 'cylinder', position: { x: 2 }, size: [3, 8] },
            { type: 'cone', size: { radius: 4, height: 9 } }
        ]
    });

    assert.deepEqual(config.props[0].size, { radius: 5 });
    assert.deepEqual(config.props[1].size, { radius: 3, height: 8 });
    assert.deepEqual(config.props[2].size, { radius: 4, height: 9 });
    assert.deepEqual(config.props.map(prop => prop.id), ['same', 'same-2', 'prop-3']);
});

test('flags and weather are whitelisted', () => {
    const result = validateMapConfig({
        weather: 'javascript:rain',
        flags: { openSides: true, portals: 'yes', remoteAssets: true }
    });

    assert.equal(result.valid, false);
    assert.equal(result.config.weather, 'clear');
    assert.deepEqual(result.config.flags, {
        openSides: true,
        openAir: false,
        lowGravity: false,
        slippery: false,
        portals: false
    });
});

test('pure add/delete helpers do not mutate their input', () => {
    const original = normalizeMapConfig({ props: [{ id: 'keep', type: 'sphere' }] });
    const added = addMapProp(original, { id: 'remove', type: 'cone' });
    const removed = deleteMapProp(added, 'remove');

    assert.equal(original.props.length, 1);
    assert.equal(added.props.length, 2);
    assert.deepEqual(removed, original);
});

test('a normalized config validates cleanly', () => {
    const config = normalizeMapConfig({
        name: 'Tournament Court',
        weather: 'indoor',
        flags: { portals: true },
        props: PRIMITIVE_TYPES.map(type => ({ type }))
    });

    assert.deepEqual(validateMapConfig(config), { valid: true, errors: [], config });
});

test('editor coordinate helpers round-trip and hit-test topmost props', () => {
    const config = normalizeMapConfig({
        dimensions: { width: 80, length: 120 },
        props: [
            { id: 'under', type: 'box', position: { x: 10, z: -20 }, size: { width: 8, depth: 8 } },
            { id: 'top', type: 'sphere', position: { x: 10, z: -20 }, size: { radius: 3 } }
        ]
    });
    const canvasPoint = worldToCanvas(config, 400, 300, 10, -20);
    const worldPoint = canvasToWorld(config, 400, 300, canvasPoint.x, canvasPoint.y);

    assert.ok(Math.abs(worldPoint.x - 10) < 1e-9);
    assert.ok(Math.abs(worldPoint.z + 20) < 1e-9);
    assert.equal(findMapPropAt(config, 10, -20)?.id, 'top');
    assert.equal(findMapPropAt(config, 40, 60), null);
});
