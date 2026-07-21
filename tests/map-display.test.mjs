import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMapSize } from '../js/map-display.js';

test('map size labels never expose object serialization', () => {
    assert.equal(formatMapSize({ size: 'large', courtWidth: 90 }), 'large');
    assert.equal(formatMapSize({ size: { x: 72, y: 28, z: 110 }, courtWidth: 72 }), 'small');
    assert.equal(formatMapSize({ size: { x: 100, y: 30, z: 120 }, courtWidth: 100 }), 'medium');
    assert.equal(formatMapSize({ size: { x: 120, y: 35, z: 140 }, courtWidth: 120 }), 'large');
    assert.equal(formatMapSize({ size: { x: 140, y: 40, z: 160 }, courtWidth: 140 }), 'xxl');
    assert.doesNotMatch(formatMapSize({ size: { x: 90 } }), /\[object Object\]/);
});