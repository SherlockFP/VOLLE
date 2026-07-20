import test from 'node:test';
import assert from 'node:assert/strict';

import { ObjectPool } from '../js/objectPool.js';

test('object pool reuses released objects', () => {
    let created = 0;
    const pool = new ObjectPool(() => ({ id: ++created }), item => { item.reset = true; });
    const first = pool.acquire();
    pool.release(first);
    const second = pool.acquire();
    assert.equal(second, first);
    assert.equal(second.reset, true);
    assert.equal(created, 1);
});

test('object pool caps retained objects and discards overflow', () => {
    let discarded = 0;
    const pool = new ObjectPool(() => ({}), null, () => discarded++, 2);
    pool.release({});
    pool.release({});
    pool.release({});
    assert.equal(pool.size, 2);
    assert.equal(discarded, 1);
});

