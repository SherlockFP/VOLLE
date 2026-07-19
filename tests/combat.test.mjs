import test from 'node:test';
import assert from 'node:assert/strict';
import { pointSegmentDistanceSq, resolveKillerName, segmentIntersectsSphere } from '../js/combat.js';

test('segment hit catches a fast ball crossing the deflect sphere', () => {
    const player = { x: 0, y: 0, z: 0 };
    assert.equal(segmentIntersectsSphere(
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        player,
        2
    ), true);
});

test('segment miss stays outside the deflect sphere', () => {
    assert.equal(pointSegmentDistanceSq(
        { x: 0, y: 3, z: 0 },
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
    ), 9);
    assert.equal(segmentIntersectsSphere(
        { x: -10, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 },
        2
    ), false);
});

test('killer attribution uses the bot identity and never echoes the victim', () => {
    const player = { name: 'ignored' };
    assert.equal(resolveKillerName({ name: 'Bot-3' }, player, 'Sher', 'Bot-3', 'Sher'), 'Bot-3');
    assert.equal(resolveKillerName(player, player, 'Sher', 'Bot-2', 'Sher'), 'Bot-2');
    assert.equal(resolveKillerName(null, player, 'Sher', 'Sher', 'Sher'), 'Environment');
});
