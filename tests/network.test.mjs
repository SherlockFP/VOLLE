import test from 'node:test';
import assert from 'node:assert/strict';

import { Network, isNewerSequence, reconnectDelay } from '../js/network.js';

test('position packet preserves movement and identity fields', () => {
    const network = new Network({});
    const encoded = network.encodePosition({
        seq: 42,
        x: 1, y: 2, z: 3,
        ry: 4,
        ax: 5, ay: 6, az: 7,
        vx: 8, vy: 9, vz: 10,
        alive: true,
        hp: 80,
        team: 'red',
        name: 'Player',
        charId: 'rally'
    });
    const decoded = network._decodeBinary(encoded);

    assert.equal(decoded.type, 'position');
    assert.equal(decoded.seq, 42);
    assert.deepEqual(
        [decoded.x, decoded.y, decoded.z, decoded.vx, decoded.vy, decoded.vz],
        [1, 2, 3, 8, 9, 10]
    );
    assert.equal(decoded.hp, 80);
    assert.equal(decoded.name, 'Player');
    assert.equal(decoded.charId, 'rally');
});

test('sequence ordering handles duplicates, stale packets, and wraparound', () => {
    assert.equal(isNewerSequence(11, 10), true);
    assert.equal(isNewerSequence(10, 10), false);
    assert.equal(isNewerSequence(9, 10), false);
    assert.equal(isNewerSequence(0, 65535), true);
    assert.equal(isNewerSequence(65535, 0), false);
});

test('stale position packets never reach the game', () => {
    let updates = 0;
    const network = new Network({ updateRemotePlayer: () => updates++ });
    network.handleMessage({ type: 'position', seq: 5, x: 1, z: 1 }, 'peer');
    network.handleMessage({ type: 'position', seq: 5, x: 2, z: 2 }, 'peer');
    network.handleMessage({ type: 'position', seq: 4, x: 3, z: 3 }, 'peer');
    network.handleMessage({ type: 'position', seq: 6, x: 4, z: 4 }, 'peer');
    assert.equal(updates, 2);
});

test('reconnect backoff is bounded', () => {
    assert.deepEqual([1, 2, 3, 4].map(reconnectDelay), [500, 1000, 2000, 2000]);
});

test('legacy position packet remains readable', () => {
    const network = new Network({});
    const buffer = new ArrayBuffer(30);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setFloat32(1, 1);
    view.setFloat32(5, 2);
    view.setFloat32(9, 3);
    view.setUint8(29, 0);

    const decoded = network._decodeBinary(buffer);
    assert.equal(decoded.x, 1);
    assert.equal(decoded.vx, 0);
    assert.equal(decoded.seq, undefined);
});
