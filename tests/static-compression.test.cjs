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

test('a large cache miss never blocks: identity now, compressed right after', async () => {
    const cache = new CompressionCache(64 * 1024 * 1024, { inlineLimit: 4096 });
    const big = Buffer.from('export const volle = "dodgeball";\n'.repeat(2000));
    const first = cache.encode(big, '.js', 'br');
    assert.equal(first.encoding, null, 'the first request is not held up');
    assert.equal(first.body, big);
    assert.equal(cache.pending.size, 1);
    cache.encode(big, '.js', 'br');
    assert.equal(cache.pending.size, 1, 'one compression job per content');
    await [...cache.pending.values()][0];
    const next = cache.encode(big, '.js', 'br');
    assert.equal(next.encoding, 'br');
    assert.deepEqual(zlib.brotliDecompressSync(next.body), big);
});

test('prewarm compresses br and gzip up front, off the event loop', async () => {
    const cache = new CompressionCache(64 * 1024 * 1024, { inlineLimit: 4096 });
    const bundle = Buffer.from('function play() { return "ball"; }\n'.repeat(3000));
    const count = await cache.prewarm([{ data: bundle, ext: '.js' }, { data: Buffer.from('tiny'), ext: '.js' }, { data: Buffer.alloc(9000), ext: '.png' }]);
    assert.equal(count, 2, 'only compressible text above the floor');
    assert.equal(cache.encode(bundle, '.js', 'br').encoding, 'br');
    assert.equal(cache.encode(bundle, '.js', 'gzip').encoding, 'gzip');
    assert.equal(cache.pending.size, 0);
});

test('the server prewarms the entry page, bundle and CSS once it listens', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /server\.listen\(PORT, \(\) => \{[\s\S]{0,200}prewarmStaticCompression\(\);/);
    assert.match(src, /for \(const dir of \['dist\/app', 'css'\]\)/);
});
