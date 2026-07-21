// server.js — ponytail: zero-dep static file server for local play.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CATALOG, ProfileStore } = require('./server/profile-store');
const { verifyMatchReceipt } = require('./server/match-receipt');
const { CreatorMapStore } = require('./server/creator-map-store');
const { RequestLimiter } = require('./server/request-limiter');
const { PaymentLedger, verifyPaymentEvent } = require('./server/payment-ledger');
const { TelemetryStore } = require('./server/telemetry');
const { createLiveMarket, findLiveOffer } = require('./server/live-market');
const {
    normalizeEquippedCosmetics,
    signCosmeticEntitlement,
    verifyCosmeticEntitlement
} = require('./server/cosmetic-entitlement');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const profiles = new ProfileStore(path.join(ROOT, 'data', 'profiles.json'));
const creatorMaps = new CreatorMapStore(path.join(ROOT, 'data', 'creator-maps.json'));
const paymentLedger = new PaymentLedger(path.join(ROOT, 'data', 'payment-ledger.json'));
const telemetry = new TelemetryStore(path.join(ROOT, 'data', 'telemetry.json'));
const MATCH_REWARD_SECRET = process.env.MATCH_REWARD_SECRET || '';
const CREATOR_MODERATION_KEY = process.env.CREATOR_MODERATION_KEY || '';
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || '';
const COSMETIC_ENTITLEMENT_SECRET = crypto.randomBytes(32);
const requestLimiter = new RequestLimiter();
const RATE_LIMITS = {
    session: [10, 60000],
    purchase: [20, 60000],
    reward: [30, 60000],
    mapRead: [90, 60000],
    mapWrite: [10, 60000],
    mapVote: [30, 60000],
    lobbyWrite: [30, 60000],
    paymentWebhook: [40, 60000],
    telemetry: [120, 60000]
};

function validModerationKey(req) {
    if (CREATOR_MODERATION_KEY.length < 32) return false;
    const expected = Buffer.from(CREATOR_MODERATION_KEY);
    const provided = Buffer.from(String(req.headers['x-moderation-key'] || ''));
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg'
};

// --- In-memory lobby registry for the lobby browser (no external deps) ---
// Hosts register their room code + metadata; clients list + quick-join.
const lobbies = new Map(); // code -> { code, name, players, map, mode, hostName, updatedAt }
const socialHubs = new Map(); // code -> { code, mapId, mapName, hostName, players, updatedAt }
const SOCIAL_HUB_MAP_NAMES = Object.freeze({
    estate: 'Grand Estate',
    skyline: 'Skyline Deck',
    harbor: 'Harbor Commons'
});
const LOBBY_TTL = 30000; // 30s stale prune

function pruneLobbies() {
    const now = Date.now();
    for (const [code, l] of lobbies) {
        if (now - l.updatedAt > LOBBY_TTL) lobbies.delete(code);
    }
    for (const [code, hub] of socialHubs) {
        if (now - hub.updatedAt > LOBBY_TTL) socialHubs.delete(code);
    }
}

function readBody(req, maxLength = 1e4) {
    return new Promise((resolve) => {
        let body = '';
        let tooLarge = false;
        req.on('data', c => {
            if (tooLarge) return;
            body += c;
            if (body.length > maxLength) {
                tooLarge = true;
                body = '';
            }
        });
        req.on('end', () => {
            if (tooLarge) { resolve({ __bodyTooLarge: true }); return; }
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { resolve({ __invalidJson: true }); }
        });
    });
}

function sendJson(res, obj, status = 200) {
    const data = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
}

function bearer(req) {
    const value = req.headers.authorization || '';
    return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requestIdentity(req) {
    return String(req.socket?.remoteAddress || 'unknown').slice(0, 80);
}

function allowRequest(req, res, bucketName) {
    const [limit, windowMs] = RATE_LIMITS[bucketName] || [30, 60000];
    const result = requestLimiter.consume(`${bucketName}:${requestIdentity(req)}`, limit, windowMs);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) return true;
    const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    sendJson(res, { error: 'rate limit exceeded', retryAfter }, 429);
    return false;
}

const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];

    // --- Persistent guest profile/economy API ---
    if (urlPath === '/api/profile/session' && req.method === 'POST') {
        if (!allowRequest(req, res, 'session')) return;
        const b = await readBody(req);
        sendJson(res, profiles.session(b.token, b.playerName, b.legacy));
        return;
    }
    if (urlPath === '/api/profile' && req.method === 'GET') {
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        sendJson(res, { profile: profiles._public(profile) });
        return;
    }
    if (urlPath === '/api/live-market' && req.method === 'GET') {
        sendJson(res, createLiveMarket(CATALOG));
        return;
    }
    if (urlPath === '/api/profile/live-market/purchase' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const body = await readBody(req);
        const offer = findLiveOffer(CATALOG, body.offerId);
        if (!offer) { sendJson(res, { error: 'offer unavailable' }, 404); return; }
        const requestId = req.headers['idempotency-key'] || body.requestId;
        const result = profiles.purchase(profile, offer.kind, offer.itemId, requestId, offer.price);
        sendJson(res, result.error ? { error: result.error } : {
            profile: result.profile,
            replayed: result.replayed
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/purchase' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const b = await readBody(req);
        const requestId = req.headers['idempotency-key'] || b.requestId;
        const result = profiles.purchase(profile, b.kind, b.id, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            profile: result.profile,
            replayed: result.replayed
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/reward' && req.method === 'POST') {
        if (!allowRequest(req, res, 'reward')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        if (MATCH_REWARD_SECRET.length < 32) {
            sendJson(res, { error: 'reward service unavailable' }, 503);
            return;
        }
        const b = await readBody(req);
        const signature = req.headers['x-match-signature'] || b.signature;
        const receipt = verifyMatchReceipt(MATCH_REWARD_SECRET, b.receipt, signature);
        if (!receipt || receipt.profileId !== profile.id) {
            sendJson(res, { error: 'invalid match receipt' }, 403);
            return;
        }
        const result = profiles.reward(profile, receipt);
        sendJson(res, result.error ? { error: result.error } : {
            coins: result.coins,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/cosmetics/equip' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const body = await readBody(req, 4096);
        const loadout = normalizeEquippedCosmetics(body.loadout, profile.ownedCosmetics, CATALOG.cosmetic);
        const entitlement = signCosmeticEntitlement(
            COSMETIC_ENTITLEMENT_SECRET,
            profile,
            body.playerId,
            loadout
        );
        if (!entitlement) { sendJson(res, { error: 'invalid player identity' }, 400); return; }
        const result = profiles.equipCosmetics(profile, loadout);
        sendJson(res, { profile: result.profile, entitlement, loadout: result.loadout });
        return;
    }
    if (urlPath === '/api/cosmetics/verify' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 4096);
        const verified = verifyCosmeticEntitlement(COSMETIC_ENTITLEMENT_SECRET, body.entitlement);
        if (!verified) { sendJson(res, { error: 'invalid entitlement' }, 403); return; }
        sendJson(res, { playerId: verified.playerId, loadout: verified.loadout });
        return;
    }
    if (urlPath === '/api/profile/cases/open' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const body = await readBody(req, 4096);
        const requestId = req.headers['idempotency-key'] || body.requestId;
        const result = profiles.openCase(profile, body.caseId, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            profile: result.profile,
            result: result.result,
            replayed: result.replayed
        }, result.status);
        return;
    }

    if (urlPath === '/api/payments/webhook' && req.method === 'POST') {
        if (!allowRequest(req, res, 'paymentWebhook')) return;
        if (PAYMENT_WEBHOOK_SECRET.length < 32) {
            sendJson(res, { error: 'payment service unavailable' }, 503);
            return;
        }
        const body = await readBody(req, 12000);
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const event = verifyPaymentEvent(
            PAYMENT_WEBHOOK_SECRET,
            body,
            req.headers['x-payment-signature']
        );
        if (!event) { sendJson(res, { error: 'invalid payment signature' }, 403); return; }
        const result = paymentLedger.apply(profiles, event);
        sendJson(res, result.error ? { error: result.error } : result, result.status);
        return;
    }

    if (urlPath === '/api/telemetry' && req.method === 'POST') {
        if (!allowRequest(req, res, 'telemetry')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const body = await readBody(req, 4096);
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const result = telemetry.ingest(profile.id, body);
        sendJson(res, result.error ? { error: result.error } : {
            accepted: result.accepted,
            replayed: result.replayed,
            flagged: result.flagged
        }, result.status);
        return;
    }

    // --- Authenticated creator map publishing and public workshop reads. ---
    if (urlPath === '/api/maps' && req.method === 'POST') {
        if (!allowRequest(req, res, 'mapWrite')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const body = await readBody(req, 100000);
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const result = creatorMaps.publish(profile, body);
        sendJson(res, result.error ? { error: result.error } : {
            map: result.map,
            replayed: result.replayed
        }, result.status);
        return;
    }
    if (urlPath === '/api/maps' && req.method === 'GET') {
        if (!allowRequest(req, res, 'mapRead')) return;
        const params = new URLSearchParams(req.url.split('?')[1] || '');
        const mine = params.get('mine') === '1';
        const profile = profiles.authenticate(bearer(req));
        if (mine && !profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        sendJson(res, creatorMaps.list({
            creatorId: profile?.id || '',
            viewerId: profile?.id || '',
            cursor: params.get('cursor'),
            limit: params.get('limit'),
            query: params.get('q'),
            sort: params.get('sort')
        }));
        return;
    }
    if (urlPath.startsWith('/api/maps/') && urlPath.endsWith('/vote') && req.method === 'POST') {
        if (!allowRequest(req, res, 'mapVote')) return;
        const profile = profiles.authenticate(bearer(req));
        if (!profile) { sendJson(res, { error: 'unauthorized' }, 401); return; }
        const encodedId = urlPath.slice('/api/maps/'.length, -'/vote'.length);
        if (!encodedId) { sendJson(res, { error: 'map not found' }, 404); return; }
        const body = await readBody(req, 1024);
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const result = creatorMaps.vote(profile, decodeURIComponent(encodedId), Number(body.value));
        sendJson(res, result.error ? { error: result.error } : { map: result.map }, result.status);
        return;
    }
    if (urlPath.startsWith('/api/maps/') && urlPath.endsWith('/moderate') && req.method === 'POST') {
        if (CREATOR_MODERATION_KEY.length < 32) {
            sendJson(res, { error: 'moderation unavailable' }, 503);
            return;
        }
        if (!validModerationKey(req)) {
            sendJson(res, { error: 'forbidden' }, 403);
            return;
        }
        const encodedId = urlPath.slice('/api/maps/'.length, -'/moderate'.length);
        if (!encodedId) { sendJson(res, { error: 'map not found' }, 404); return; }
        const body = await readBody(req, 4096);
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const result = creatorMaps.moderate(
            decodeURIComponent(encodedId),
            body.status,
            body.note
        );
        sendJson(res, result.error ? { error: result.error } : { map: result.map }, result.status);
        return;
    }
    if (urlPath.startsWith('/api/maps/') && req.method === 'GET') {
        const id = decodeURIComponent(urlPath.slice('/api/maps/'.length));
        const profile = profiles.authenticate(bearer(req));
        const result = creatorMaps.get(id, profile?.id || '');
        sendJson(res, result.error ? { error: result.error } : { map: result.map }, result.status);
        return;
    }

    // --- Lobby API ---
    if (urlPath === '/api/lobbies' && req.method === 'GET') {
        pruneLobbies();
        sendJson(res, [...lobbies.values()]);
        return;
    }
    if (urlPath === '/api/lobbies' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req);
        if (!b.code) { sendJson(res, { error: 'code required' }, 400); return; }
        lobbies.set(b.code, {
            code: b.code,
            name: b.name || 'Lobby',
            hostName: b.hostName || 'Host',
            players: b.players || 1,
            map: b.map || 'Unknown',
            mode: b.mode || 'Classic',
            ranked: b.ranked === true,
            averageElo: Math.max(0, Math.min(5000, Number(b.averageElo) || 1000)),
            maxPlayers: Math.max(2, Math.min(16, Number(b.maxPlayers) || 8)),
            updatedAt: Date.now()
        });
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath.startsWith('/api/lobbies/') && (req.method === 'DELETE' || req.method === 'POST')) {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
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

    // --- Social Hub registry: separate from competitive lobbies. ---
    if (urlPath === '/api/social-hubs' && req.method === 'GET') {
        pruneLobbies();
        sendJson(res, [...socialHubs.values()]);
        return;
    }
    if (urlPath === '/api/social-hubs' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req);
        const mapId = String(b.mapId || '').toLowerCase();
        const mapName = Object.hasOwn(SOCIAL_HUB_MAP_NAMES, mapId) ? SOCIAL_HUB_MAP_NAMES[mapId] : '';
        if (!b.code || !mapName) {
            sendJson(res, { error: 'valid code and mapId required' }, 400);
            return;
        }
        socialHubs.set(b.code, {
            code: b.code,
            mapId,
            mapName,
            hostName: String(b.hostName || 'Host').slice(0, 32),
            players: Math.max(1, Math.min(32, Number(b.players) || 1)),
            updatedAt: Date.now()
        });
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath.startsWith('/api/social-hubs/') && (req.method === 'DELETE' || req.method === 'POST')) {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const code = decodeURIComponent(urlPath.split('/').pop());
        socialHubs.delete(code);
        sendJson(res, { ok: true });
        return;
    }
    // sendBeacon can only POST — used by the client's beforeunload to close a lobby.
    if (urlPath === '/api/lobbies/close' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
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
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        if (ext === '.html' || ext === '.css' || ext === '.js') {
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }
        res.writeHead(200, headers);
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n  WARRBALL running on port ${PORT}\n  Local: http://localhost:${PORT}\n`);
});
