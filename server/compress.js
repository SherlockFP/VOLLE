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
    constructor(limitBytes = CACHE_LIMIT_BYTES) {
        this.limitBytes = limitBytes;
        this.bytes = 0;
        this.entries = new Map();
    }

    // Returns { body, encoding } — encoding null means send `data` unchanged.
    encode(data, ext, acceptEncoding) {
        const encoding = negotiateEncoding(acceptEncoding);
        if (!encoding || !shouldCompress(ext, data.length)) return { body: data, encoding: null };
        const key = `${encoding}:${crypto.createHash('sha1').update(data).digest('base64')}`;
        const cached = this.entries.get(key);
        if (cached) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            return { body: cached, encoding };
        }
        const body = encoding === 'br'
            ? zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
            : zlib.gzipSync(data, { level: 9 });
        if (body.length >= data.length) return { body: data, encoding: null };
        this.entries.set(key, body);
        this.bytes += body.length;
        while (this.bytes > this.limitBytes && this.entries.size) {
            const [oldestKey, oldest] = this.entries.entries().next().value;
            this.entries.delete(oldestKey);
            this.bytes -= oldest.length;
        }
        return { body, encoding };
    }
}

module.exports = { CompressionCache, negotiateEncoding, shouldCompress };
