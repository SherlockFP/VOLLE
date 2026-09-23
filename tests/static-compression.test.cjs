const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { CompressionCache, negotiateEncoding, shouldCompress } = require('../server/compress');

test('encoding negotiation prefers brotli, honours q=0, falls back to identity', () => {
    assert.equal(negotiateEncoding('gzip, deflate, br'), 'br');
    assert.equal(negotiateEncoding('gzip, br;q=0'), 'gzip');
    assert.equal(negotiateEncoding('identity'), null);
    assert.equal(negotiateEncoding(undefined), null);
});

test('only text assets above 1 KiB are compressed; media passes through', () => {
    assert.equal(shouldCompress('.js', 5000), true);
    assert.equal(shouldCompress('.js', 200), false);
    assert.equal(shouldCompress('.png', 500000), false);
    assert.equal(shouldCompress('.glb', 500000), false);
});

test('compressed output round-trips and is cached by content', () => {
    const cache = new CompressionCache();
    const data = Buffer.from('const volle = "dodgeball";\n'.repeat(400));
    const first = cache.encode(data, '.js', 'br, gzip');
    assert.equal(first.encoding, 'br');
    assert.ok(first.body.length < data.length / 5);
    assert.deepEqual(zlib.brotliDecompressSync(first.body), data);
    const second = cache.encode(data, '.js', 'br');
    assert.equal(second.body, first.body, 'second request hits the cache');
    const gz = cache.encode(data, '.js', 'gzip');
    assert.deepEqual(zlib.gunzipSync(gz.body), data);
});

test('cache stays within its byte limit', () => {
    const cache = new CompressionCache(4096);
    for (let i = 0; i < 50; i++) cache.encode(Buffer.from(`// file ${i}\n` + 'x'.repeat(20000 + i)), '.js', 'gzip');
    assert.ok(cache.bytes <= 4096 + 2048);
});
