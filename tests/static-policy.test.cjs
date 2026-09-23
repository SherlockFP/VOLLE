const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolvePublicPath } = require('../server/static-policy');

const ROOT = path.resolve(__dirname, '..');

test('game client files are served', () => {
    for (const url of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/js/main.js',
        '/css/style.css', '/vendor/three/three.module.js', '/music/1.sfx', '/assets/cc0/ASSET_MANIFEST.md']) {
        assert.ok(resolvePublicPath(ROOT, url), `${url} should be public`);
    }
});

test('account data, server source, git metadata and docs are never served', () => {
    for (const url of ['/data/accounts.db', '/data/profiles.json', '/server/account-store.js', '/server.js',
        '/.git/config', '/package.json', '/Dockerfile', '/docs/ROADMAP.md', '/tests/x.test.mjs', '/vault/STATUS.md',
        '/js/../data/accounts.db', '/js/%2e%2e/data/accounts.db', '/js/..%2fdata/accounts.db',
        '/assets/.hidden', '/%00', '/%E0%A4%A']) {
        assert.equal(resolvePublicPath(ROOT, url), null, `${url} must not be public`);
    }
});
