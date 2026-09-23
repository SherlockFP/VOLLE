// tests/build-bundle.test.mjs — production bundle wiring (scripts/build.mjs + server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { resolveEntryHtml, isImmutableAsset, resolvePublicPath } = require('../server/static-policy.js');

test('rewriteIndexHtml drops the import map and dev entries and points at the bundle', async () => {
    const { rewriteIndexHtml } = await import('../scripts/build.mjs');
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const out = rewriteIndexHtml(html, 'dist/app/volle-ABC123.js');
    assert.doesNotMatch(out, /type="importmap"/);
    assert.doesNotMatch(out, /import \{ shaderFinishers \}/);
    assert.doesNotMatch(out, /src="js\/main\.js/);
    assert.match(out, /<script type="module" src="dist\/app\/volle-ABC123\.js"><\/script>/);
    assert.match(out, /<link rel="stylesheet" href="css\/style\.css/, 'stylesheets stay as-is');
});

test('entry html: bundle when built, dev page when VOLLE_DEV=1 or no build', () => {
    const root = path.resolve('repo');
    const built = () => true;
    const none = () => false;
    assert.equal(resolveEntryHtml(root, {}, built), path.join(root, 'dist', 'index.html'));
    assert.equal(resolveEntryHtml(root, { VOLLE_DEV: '1' }, built), path.join(root, 'index.html'));
    assert.equal(resolveEntryHtml(root, {}, none), path.join(root, 'index.html'));
});

test('only hashed bundle files are immutable; dist is public, source maps included', () => {
    assert.equal(isImmutableAsset('/dist/app/volle-XRLNFJEJ.js'), true);
    assert.equal(isImmutableAsset('/dist/app/chunk-4C666HHU.js.map'), true);
    assert.equal(isImmutableAsset('/dist/index.html'), false);
    assert.equal(isImmutableAsset('/js/main.js'), false);
    assert.ok(resolvePublicPath(process.cwd(), '/dist/app/volle-X.js'));
    assert.equal(resolvePublicPath(process.cwd(), '/dist/../data/accounts.db'), null);
});
