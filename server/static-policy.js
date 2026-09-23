'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The server process runs from the repo root, which also holds data/ (accounts.db,
// profiles), server/ source and .git. Only the game client itself is public.
const PUBLIC_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const PUBLIC_DIRS = new Set(['assets', 'css', 'js', 'vendor', 'music', 'sfx', 'dist']);

// Returns the absolute file to serve, or null when the path must not be served.
function resolvePublicPath(root, urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath); } catch { return null; }
    if (decoded.includes('\0')) return null;
    const fullPath = path.join(root, decoded);
    const relative = path.relative(root, fullPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const parts = relative.split(path.sep);
    if (parts.some(part => part.startsWith('.'))) return null;
    const allowed = parts.length === 1 ? PUBLIC_FILES.has(parts[0]) : PUBLIC_DIRS.has(parts[0]);
    return allowed ? fullPath : null;
}

// `npm run build` output. When present (and VOLLE_DEV is not set) the page is the
// bundled dist/index.html; hashed bundle files are immutable and cached for a year.
function resolveEntryHtml(root, env = process.env, exists = fs.existsSync) {
    const bundled = path.join(root, 'dist', 'index.html');
    return env.VOLLE_DEV !== '1' && exists(bundled) ? bundled : path.join(root, 'index.html');
}

function isImmutableAsset(relativeUrlPath) {
    return /^\/dist\/app\/[^/]+\.(?:js|map)$/.test(relativeUrlPath);
}

module.exports = { resolvePublicPath, resolveEntryHtml, isImmutableAsset, PUBLIC_FILES, PUBLIC_DIRS };
