const test = require('node:test');
const assert = require('node:assert/strict');
const { RequestLimiter } = require('../server/request-limiter');

test('request limiter enforces a bounded fixed window and exposes retry timing', () => {
    let now = 1000;
    const limiter = new RequestLimiter({ now: () => now, maxKeys: 2 });
    assert.deepEqual(limiter.consume('ip-a', 2, 1000), {
        allowed: true, remaining: 1, retryAfterMs: 1000
    });
    assert.equal(limiter.consume('ip-a', 2, 1000).allowed, true);
    const blocked = limiter.consume('ip-a', 2, 1000);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.equal(blocked.retryAfterMs, 1000);
    now = 1500;
    assert.equal(limiter.consume('ip-a', 2, 1000).allowed, false);
    now = 2000;
    assert.equal(limiter.consume('ip-a', 2, 1000).allowed, true);
});

test('request limiter prunes expired and excess keys', () => {
    let now = 0;
    const limiter = new RequestLimiter({ now: () => now, maxKeys: 2 });
    limiter.consume('a', 1, 10);
    now = 1;
    limiter.consume('b', 1, 10);
    now = 2;
    limiter.consume('c', 1, 10);
    assert.equal(limiter.buckets.size, 2);
    now = 12;
    limiter.consume('d', 1, 10);
    assert.equal(limiter.buckets.has('b'), false);
    assert.equal(limiter.buckets.has('c'), false);
    assert.equal(limiter.buckets.has('d'), true);
});
