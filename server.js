// server.js — ponytail: zero-dep static file server for local play.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg'
};

// --- In-memory lobby registry for the lobby browser (no external deps) ---
// Hosts register their room code + metadata; clients list + quick-join.
const lobbies = new Map(); // code -> { code, name, players, map, mode, hostName, updatedAt }
const LOBBY_TTL = 30000; // 30s stale prune

function pruneLobbies() {
    const now = Date.now();
    for (const [code, l] of lobbies) {
        if (now - l.updatedAt > LOBBY_TTL) lobbies.delete(code);
    }
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { resolve({}); }
        });
    });
}

function sendJson(res, obj, status = 200) {
    const data = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
}

const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];

    // --- Lobby API ---
    if (urlPath === '/api/lobbies' && req.method === 'GET') {
        pruneLobbies();
        sendJson(res, [...lobbies.values()]);
        return;
    }
    if (urlPath === '/api/lobbies' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.code) { sendJson(res, { error: 'code required' }, 400); return; }
        lobbies.set(b.code, {
            code: b.code,
            name: b.name || 'Lobby',
            hostName: b.hostName || 'Host',
            players: b.players || 1,
            map: b.map || 'Unknown',
            mode: b.mode || 'Classic',
            updatedAt: Date.now()
        });
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath.startsWith('/api/lobbies/') && (req.method === 'DELETE' || req.method === 'POST')) {
        const code = decodeURIComponent(urlPath.split('/').pop());
        lobbies.delete(code);
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath === '/api/lobbies' && req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
    }
    // sendBeacon can only POST — used by the client's beforeunload to close a lobby.
    if (urlPath === '/api/lobbies/close' && req.method === 'POST') {
        const b = await readBody(req);
        if (b.code) lobbies.delete(b.code);
        sendJson(res, { ok: true });
        return;
    }

    // --- Static files ---
    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    const fullPath = path.join(ROOT, filePath);
    // Prevent path traversal
    if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + filePath);
            console.log('404', filePath);
            return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  DODGBALL running on port ${PORT}\n  Local: http://localhost:${PORT}\n`);
});
