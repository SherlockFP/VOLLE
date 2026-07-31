// tests/pwa.test.mjs — coverage for 'add to home screen' installability:
// manifest.webmanifest (valid JSON + required fields), sw.js (network-first,
// P2P/API bypass rules present as text), and the index.html registration hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifestRaw = await readFile(new URL('manifest.webmanifest', root), 'utf8');
const swSource = await readFile(new URL('sw.js', root), 'utf8');
const indexHtml = await readFile(new URL('index.html', root), 'utf8');

test('manifest.webmanifest is valid JSON with required installability fields', () => {
    const manifest = JSON.parse(manifestRaw);
    assert.equal(manifest.name, 'Warrball');
    assert.equal(typeof manifest.short_name, 'string');
    assert.ok(manifest.short_name.length > 0);
    assert.equal(manifest.start_url, '.');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, 'landscape');
    assert.match(manifest.theme_color, /^#[0-9a-fA-F]{6}$/);
    assert.match(manifest.background_color, /^#[0-9a-fA-F]{6}$/);
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
    const icon512 = manifest.icons.find((icon) => icon.sizes === '512x512');
    assert.ok(icon512, 'missing a 512x512 icon entry');
    assert.equal(icon512.type, 'image/png');
    assert.match(icon512.purpose, /maskable/);
});

test('manifest icon file referenced actually exists on disk', () => {
    const manifest = JSON.parse(manifestRaw);
    for (const icon of manifest.icons) {
        assert.ok(existsSync(new URL(icon.src, root)), `missing icon ${icon.src}`);
    }
});

test('sw.js declares a cache version constant', () => {
    assert.match(swSource, /CACHE_V1\s*=\s*['"][\w-]+['"]/);
});

test('sw.js bypasses /api/* requests (never intercepted)', () => {
    assert.match(swSource, /pathname\.startsWith\(['"]\/api\/['"]\)/);
});

test('sw.js bypasses PeerJS/WebRTC requests (never intercepted)', () => {
    assert.match(swSource, /peerjs/i);
    assert.match(swSource, /url\.origin\s*!==\s*self\.location\.origin/);
});

test('sw.js precaches the static shell on install and cleans old caches on activate', () => {
    assert.match(swSource, /addEventListener\(['"]install['"]/);
    assert.match(swSource, /cache\.addAll/);
    assert.match(swSource, /addEventListener\(['"]activate['"]/);
    assert.match(swSource, /caches\.delete/);
});

test('sw.js fetch handler is network-first with a cache fallback', () => {
    assert.match(swSource, /addEventListener\(['"]fetch['"]/);
    assert.match(swSource, /fetch\(request\)/);
    assert.match(swSource, /caches\.match\(request\)/);
});

test('index.html links the manifest and sets theme-color', () => {
    assert.match(indexHtml, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(indexHtml, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/);
});

test('index.html registers the service worker with a guarded, silent-fallback call', () => {
    assert.match(indexHtml, /navigator\.serviceWorker\?\.register\(['"]sw\.js['"]\)/);
});

test('server.js maps .webmanifest to a manifest MIME type', async () => {
    const serverSource = await readFile(new URL('server.js', root), 'utf8');
    assert.match(serverSource, /'\.webmanifest':\s*'application\/manifest\+json'/);
});
