'use strict';
// Static-file compression (Node built-in zlib — no dependency). Text assets are
// brotli- or gzip-encoded once and cached by content hash, so a 2 MB bundle costs one
// compression per deploy, not per request. Media (png/webp/ogg/mp3/glb) is already
// compressed and is sent as-is.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.map', '.webmanifest', '.txt', '.md']);
const MIN_BYTES = 1024;
const CACHE_LIMIT_BYTES = 64 * 1024 * 1024;
// Above this, a cache miss never compresses inline (quality-9 brotli held the event
// loop ~120 ms for the 1.3 MB entry bundle, ~260 ms for all JS, measured): that
// request goes out identity while the compression runs off the loop.
const INLINE_LIMIT_BYTES = 512 * 1024;
const BROTLI_OPTIONS = size => ({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size } });

function compressAsync(data, encoding) {
    return new Promise((resolve, reject) => {
        const done = (error, body) => (error ? reject(error) : resolve(body));
        if (encoding === 'br') zlib.brotliCompress(data, BROTLI_OPTIONS(data.length), done);
        else zlib.gzip(data, { level: 9 }, done);
    });
}

// Pure: pick the best encoding the client accepts ('br' > 'gzip' > null).
function negotiateEncoding(acceptEncoding = '') {
    const accepted = String(acceptEncoding || '').toLowerCase().split(',').map(part => {
        const [name, ...params] = part.trim().split(';');
        const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
        return { name: name.trim(), q: q ? Number(q.slice(2)) : 1 };
    }).filter(entry => entry.name && entry.q > 0);
    const has = name => accepted.some(entry => entry.name === name || entry.name === '*');
    if (has('br')) return 'br';
    if (has('gzip')) return 'gzip';
    return null;
}

function shouldCompress(ext, byteLength) {
    return COMPRESSIBLE.has(ext) && byteLength >= MIN_BYTES;
}

class CompressionCache {
    constructor(limitBytes = CACHE_LIMIT_BYTES, { inlineLimit = INLINE_LIMIT_BYTES } = {}) {
        this.limitBytes = limitBytes;
        this.inlineLimit = inlineLimit;
        this.bytes = 0;
        this.entries = new Map();
        this.pending = new Map(); // key -> Promise of an off-loop compression
    }

    static keyFor(encoding, data) {
        return `${encoding}:${crypto.createHash('sha1').update(data).digest('base64')}`;
    }

    _store(key, data, body) {
        if (body.length >= data.length) return null;
        if (!this.entries.has(key)) this.bytes += body.length;
        this.entries.delete(key);
        this.entries.set(key, body);
        while (this.bytes > this.limitBytes && this.entries.size) {
            const [oldestKey, oldest] = this.entries.entries().next().value;
            this.entries.delete(oldestKey);
            this.bytes -= oldest.length;
        }
        return body;
    }

    // Compresses off the event loop and caches it; one job per key.
    compressLater(data, encoding, key = CompressionCache.keyFor(encoding, data)) {
        if (this.entries.has(key)) return Promise.resolve(this.entries.get(key));
        if (!this.pending.has(key)) {
            this.pending.set(key, compressAsync(data, encoding)
                .then(body => this._store(key, data, body))
                .catch(() => null)
                .finally(() => this.pending.delete(key)));
        }
        return this.pending.get(key);
    }

    // Startup: compress the files a first visit needs (br + gzip) before anyone asks.
    async prewarm(files = []) {
        const jobs = [];
        for (const { data, ext } of files) {
            if (!data || !shouldCompress(ext, data.length)) continue;
            for (const encoding of ['br', 'gzip']) jobs.push(this.compressLater(data, encoding));
        }
        await Promise.all(jobs);
        return jobs.length;
    }

    // Returns { body, encoding } — encoding null means send `data` unchanged.
    encode(data, ext, acceptEncoding) {
        const encoding = negotiateEncoding(acceptEncoding);
        if (!encoding || !shouldCompress(ext, data.length)) return { body: data, encoding: null };
        const key = CompressionCache.keyFor(encoding, data);
        const cached = this.entries.get(key);
        if (cached) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            return { body: cached, encoding };
        }
        if (data.length > this.inlineLimit) {
            this.compressLater(data, encoding, key);
            return { body: data, encoding: null };
        }
        const body = this._store(key, data, encoding === 'br'
            ? zlib.brotliCompressSync(data, BROTLI_OPTIONS(data.length))
            : zlib.gzipSync(data, { level: 9 }));
        return body ? { body, encoding } : { body: data, encoding: null };
    }
}

module.exports = { CompressionCache, negotiateEncoding, shouldCompress };
