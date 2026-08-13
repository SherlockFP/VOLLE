// server.js — ponytail: zero-dep static file server for local play.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CATALOG, ProfileStore } = require('./server/profile-store');
const { AccountStore } = require('./server/account-store');
const { SocialStore } = require('./server/social-store');
const { PresenceStore } = require('./server/presence-store');
const { PartyStore } = require('./server/party-store');
const { verifyMatchReceipt } = require('./server/match-receipt');
const { CreatorMapStore } = require('./server/creator-map-store');
const { RequestLimiter } = require('./server/request-limiter');
const { buildRtcConfig } = require('./server/rtc-config');
const { PaymentLedger, verifyPaymentEvent } = require('./server/payment-ledger');
const { TelemetryStore } = require('./server/telemetry');
const { ProductAnalyticsStore } = require('./server/product-analytics');
const { MatchAuthority } = require('./server/match-authority');
const { createLiveMarket, findLiveOffer } = require('./server/live-market');
const {
    normalizeEquippedCosmetics,
    signCosmeticEntitlement,
    verifyCosmeticEntitlement
} = require('./server/cosmetic-entitlement');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
// data/ is gitignored, so fresh clones (e.g. Render deploys) ship without it and
// SQLite hard-fails creating a db inside a missing directory (SQLITE_CANTOPEN 14).
// DATA_DIR env lets hosts point at a persistent disk mount.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (process.env.RENDER && !process.env.DATA_DIR) {
    console.warn('[server] RENDER is set without DATA_DIR; account data will not survive deploys. Mount a persistent disk and set DATA_DIR to its mount path.');
}
const profiles = new ProfileStore(path.join(DATA_DIR, 'profiles.json'));
const accounts = new AccountStore(path.join(DATA_DIR, 'accounts.db'), profiles);
const social = new SocialStore(path.join(DATA_DIR, 'accounts.db'));
const presence = new PresenceStore();
const creatorMaps = new CreatorMapStore(path.join(DATA_DIR, 'creator-maps.json'));
const paymentLedger = new PaymentLedger(path.join(DATA_DIR, 'payment-ledger.json'));
const telemetry = new TelemetryStore(path.join(DATA_DIR, 'telemetry.json'));
// Production should set PRODUCT_ANALYTICS_SECRET. The deterministic local fallback
// keeps pseudonymous keys stable for a development install without storing raw ids.
const PRODUCT_ANALYTICS_SECRET = process.env.PRODUCT_ANALYTICS_SECRET
    || (process.env.MATCH_REWARD_SECRET?.length >= 32 ? process.env.MATCH_REWARD_SECRET : crypto.createHash('sha256').update('warrball-local-product-analytics:' + path.resolve(DATA_DIR)).digest('hex'));
const productAnalytics = new ProductAnalyticsStore(path.join(DATA_DIR, 'product-analytics.json'), {
    secret: PRODUCT_ANALYTICS_SECRET
});
let matchAuthority;
const MATCH_REWARD_SECRET = process.env.MATCH_REWARD_SECRET || '';
const CREATOR_MODERATION_KEY = process.env.CREATOR_MODERATION_KEY || '';
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || '';
const COSMETIC_ENTITLEMENT_SECRET = crypto.randomBytes(32);
const requestLimiter = new RequestLimiter();
const RATE_LIMITS = {
    session: [10, 60000],
    purchase: [20, 60000],
    reward: [30, 60000],
    matchAuthority: [60, 60000],
    onboarding: [30, 60000],
    dailyChallenge: [20, 60000],
    adReward: [10, 60000],
    streak: [10, 60000],
    mapRead: [90, 60000],
    mapWrite: [10, 60000],
    mapVote: [30, 60000],
    // Bucketed per source IP, so every tab/browser on one machine (localhost dev) and
    // everyone behind one NAT shares it. One host alone spends ~5/min on keep-alive plus
    // a write per join/leave/name-edit; at 30 two or three local clients exhausted the
    // bucket, and _lobbyApi swallows the 429 — lobbies then vanished and could not be
    // re-created until the window rolled over.
    lobbyWrite: [120, 60000],
    account: [10, 60000],
    social: [60, 60000],
    directMessage: [30, 60000],
    lobbyInvite: [20, 60000],
    party: [30, 60000],
    paymentWebhook: [40, 60000],
    telemetry: [120, 60000],
    productAnalytics: [120, 60000],
    rtcConfig: [60, 60000]
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
    '.webmanifest': 'application/manifest+json',
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
    plaza: 'Neon Clubhouse'
});
matchAuthority = new MatchAuthority(profiles, { getLobby: code => lobbies.get(code) || null });
const partyStore = new PartyStore({
    isAccountAvailable: accountId => presence.isAccountAvailable(accountId),
    isAccountActive: accountId => {
        const profileId = presence.getAccount(accountId)?.profileId;
        return !!profileId && matchAuthority.isProfileActive(profileId);
    }
});
// 90s stale prune. The host keep-alive is a 12s setInterval, but Chrome's intensive
// throttling clamps timers in a hidden tab to ONE tick per minute — the previous 45s
// TTL sat below that floor, so a host's lobby silently expired off the browser the
// moment they tabbed away to a second tab/browser to look for it. 90s survives a full
// throttled minute plus margin.
const LOBBY_TTL = 90000;

function pruneLobbies() {
    const now = Date.now();
    for (const [code, l] of lobbies) {
        if (now - (l.lastSeen ?? l.updatedAt) > LOBBY_TTL) {
            lobbies.delete(code);
            partyStore.clearLobbyTargetByCode(code);
        }
    }
    for (const [code, hub] of socialHubs) {
        if (now - (hub.lastSeen ?? hub.updatedAt) > LOBBY_TTL) socialHubs.delete(code);
    }
}

function normalizeLobbyRecord(record, timestamp) {
    return Object.assign({}, record, { updatedAt: timestamp, lastSeen: timestamp });
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

function presenceInstanceId(req, body = null) {
    const supplied = typeof body?.instanceId === 'string' ? body.instanceId : '';
    if (supplied) return supplied;
    const token = bearer(req) || String(body?.sessionToken || body?.token || '');
    return token ? `session-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 32)}` : '';
}

// Session bearer is the only public profile credential. The legacy profile token
// stays inside AccountStore/ProfileStore, never accepted as a production API key.
function resolveAuth(req, body = null) {
    const sessionToken = bearer(req) || String(body?.sessionToken || body?.token || '');
    return accounts.resolveSession(sessionToken);
}

function requireAuth(req, res, body = null) {
    const auth = resolveAuth(req, body);
    if (!auth) sendJson(res, { error: 'unauthorized' }, 401);
    return auth;
}

function publicLobby(record) {
    if (!record) return null;
    const { ownerAccountId, memberProfileIds, admissionToken, ...visible } = record;
    return visible;
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

    if (urlPath === '/healthz' && req.method === 'GET') {
        sendJson(res, { ok: true, storage: process.env.DATA_DIR ? 'configured' : 'local-default' });
        return;
    }

    // --- WebRTC ICE config (STUN/TURN + optional self-hosted PeerJS broker) ---
    // Env-driven only; zero env vars set => STUN-only, identical to prior behavior.
    if (urlPath === '/api/rtc-config' && req.method === 'GET') {
        if (!allowRequest(req, res, 'rtcConfig')) return;
        sendJson(res, buildRtcConfig(process.env, { userId: resolveAuth(req)?.profile.id }));
        return;
    }

    // --- Persistent guest profile/economy API ---
    if (urlPath === '/api/profile/session' && req.method === 'POST') {
        if (!allowRequest(req, res, 'session')) return;
        const b = await readBody(req);
        const auth = resolveAuth(req, b);
        if (auth) sendJson(res, { sessionToken: bearer(req) || b.sessionToken || b.token, profile: profiles._public(auth.profile), account: auth.account });
        else if (process.env.ALLOW_GUEST_SESSIONS === '1') sendJson(res, profiles.session(b.legacyToken, b.playerName, b.legacy));
        else sendJson(res, { error: 'unauthorized' }, 401);
        return;
    }

    // --- Account management: register, login ---
    if (urlPath === '/api/account/register' && req.method === 'POST') {
        if (!allowRequest(req, res, 'account')) return;
        const b = await readBody(req, 2048);
        const result = await accounts.register(b.username, b.password, b.email, b.avatar);
        sendJson(res, result, result.status);
        return;
    }
    if (urlPath === '/api/account/login' && req.method === 'POST') {
        if (!allowRequest(req, res, 'account')) return;
        const b = await readBody(req, 2048);
        const result = await accounts.login(b.username ?? b.email, b.password);
        sendJson(res, result, result.status);
        return;
    }

    if (urlPath === '/api/account/me' && req.method === 'GET') {
        if (!allowRequest(req, res, 'account')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, { account: auth.account, profile: profiles._public(auth.profile), expiresAt: auth.expiresAt });
        return;
    }
    if (urlPath === '/api/account/logout' && req.method === 'POST') {
        if (!allowRequest(req, res, 'account')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const ok = accounts.logout(bearer(req) || b.sessionToken || b.token, auth.account.id);
            if (ok) presence.removeAccount(auth.account.id);
            sendJson(res, { ok });
        }
        return;
    }

    // --- Social presence: heartbeat, friend status ---
    if (urlPath === '/api/social/heartbeat' && req.method === 'POST') {
        if (!allowRequest(req, res, 'social')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const result = presence.heartbeatAccount({
                accountId: auth.account.id,
                profileId: auth.profile.id,
                username: auth.account.username,
                avatar: auth.account.avatar
            }, { ...b, instanceId: presenceInstanceId(req, b) });
            sendJson(res, result.error ? { error: result.error } : { ok: true, presence: result.presence }, result.status);
        }
        return;
    }
    if (urlPath === '/api/social/status' && req.method === 'POST') {
        if (!allowRequest(req, res, 'social')) return;
        const b = await readBody(req, 2048);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const friends = social.listFriends(auth.account.id);
            const accepted = new Map(friends.map(friend => [friend.username.toLowerCase(), friend.username]));
            const requested = Array.isArray(b.usernames) ? b.usernames.slice(0, 200) : [];
            const usernames = requested.map(name => accepted.get(String(name || '').toLowerCase())).filter(Boolean);
            sendJson(res, { statuses: presence.status(usernames) });
        }
        return;
    }
    if (urlPath === '/api/social/available' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) {
            const params = new URLSearchParams(req.url.split('?')[1] || '');
            const players = presence.available({
                requesterAccountId: auth.account.id,
                requesterRegion: params.get('region') || '',
                isProfileActive: profileId => matchAuthority.isProfileActive(profileId),
                limit: 20
            });
            sendJson(res, { players });
        }
        return;
    }

    // --- Ephemeral parties. Membership mutations are synchronous in PartyStore. ---
    if (urlPath === '/api/party' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, partyStore.snapshot(auth.account.id));
        return;
    }
    // Casual party follow is deliberately a server-side, short-lived intent. It
    // never enters the P2P protocol and only party members can read its room code.
    if (urlPath === '/api/party/lobby-target' && req.method === 'GET') {
        if (!allowRequest(req, res, 'party')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, partyStore.lobbyIntent(auth.account.id));
        return;
    }
    if (urlPath === '/api/party/queue-state' && req.method === 'POST') {
        if (!allowRequest(req, res, 'party')) return;
        const b = await readBody(req, 256);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const result = partyStore.beginCasualQueue(auth.account.id, b.partyRevision);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath === '/api/party/lobby-target' && req.method === 'POST') {
        if (!allowRequest(req, res, 'party')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        pruneLobbies();
        const party = partyStore.snapshot(auth.account.id).party;
        const code = String(b.lobbyCode || '').trim();
        const lobby = lobbies.get(code);
        const admitted = !!lobby?.memberProfileIds?.has(auth.profile.id);
        const ownsLobby = lobby?.ownerAccountId === auth.account.id;
        const partySize = party?.memberAccountIds?.length || 0;
        const occupied = lobby?.memberProfileIds instanceof Set ? lobby.memberProfileIds.size : 0;
        if (!party || party.leaderAccountId !== auth.account.id || !lobby || lobby.ranked === true
            || (!ownsLobby && !admitted)
            || occupied + Math.max(0, partySize - 1) > lobby.maxPlayers) {
            sendJson(res, { error: 'party lobby unavailable' }, 409);
            return;
        }
        const result = partyStore.setLobbyTarget(auth.account.id, b.partyRevision, code);
        sendJson(res, result, result.status);
        return;
    }
    if (urlPath === '/api/party/invites' && req.method === 'POST') {
        if (!allowRequest(req, res, 'party')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const result = partyStore.invite(auth.account.id, String(b.recipientAccountId || ''));
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath.startsWith('/api/party/invites/') && req.method === 'POST') {
        if (!allowRequest(req, res, 'party')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const inviteId = decodeURIComponent(urlPath.slice('/api/party/invites/'.length));
            const result = partyStore.act(auth.account.id, inviteId, b.action);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath === '/api/party/leave' && req.method === 'POST') {
        if (!allowRequest(req, res, 'party')) return;
        const b = await readBody(req, 256);
        const auth = requireAuth(req, res, b);
        if (auth) { const result = partyStore.leave(auth.account.id); sendJson(res, result, result.status); }
        return;
    }

    // --- Persistent social graph. Identity always comes from the account session. ---
    if (urlPath === '/api/social/me' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, social.getMe(auth.account.id));
        return;
    }
    if (urlPath === '/api/social/friend-requests' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, { requests: social.listRequests(auth.account.id) });
        return;
    }
    if (urlPath === '/api/social/friend-requests' && req.method === 'POST') {
        if (!allowRequest(req, res, 'social')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) { const result = social.createFriendRequest(auth.account.id, b.friendTag); sendJson(res, result, result.status); }
        return;
    }
    if (urlPath.startsWith('/api/social/friend-requests/') && req.method === 'POST') {
        if (!allowRequest(req, res, 'social')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const requestId = decodeURIComponent(urlPath.slice('/api/social/friend-requests/'.length));
            const result = social.actOnFriendRequest(auth.account.id, requestId, b.action);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath === '/api/social/friends' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, { friends: social.listFriends(auth.account.id) });
        return;
    }
    if (urlPath.startsWith('/api/social/friends/') && req.method === 'DELETE') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) {
            const result = social.removeFriend(auth.account.id, decodeURIComponent(urlPath.slice('/api/social/friends/'.length)));
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath.startsWith('/api/social/conversations/') && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) {
            const params = new URLSearchParams(req.url.split('?')[1] || '');
            const result = social.listMessages(auth.account.id, decodeURIComponent(urlPath.slice('/api/social/conversations/'.length)), { beforeId: params.get('beforeId'), limit: params.get('limit') });
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath.startsWith('/api/social/conversations/') && req.method === 'POST') {
        if (!allowRequest(req, res, 'directMessage')) return;
        const b = await readBody(req, 1024);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const result = social.sendMessage(auth.account.id, decodeURIComponent(urlPath.slice('/api/social/conversations/'.length)), b.body);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath === '/api/social/lobby-invites' && req.method === 'GET') {
        if (!allowRequest(req, res, 'social')) return;
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, { invites: social.listInvites(auth.account.id) });
        return;
    }
    if (urlPath === '/api/social/lobby-invites' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyInvite')) return;
        const b = await readBody(req, 1024);
        const auth = requireAuth(req, res, b);
        if (auth) {
            pruneLobbies();
            const lobby = lobbies.get(String(b.lobbyCode || ''));
            if (!lobby || lobby.ownerAccountId !== auth.account.id) { sendJson(res, { error: 'lobby unavailable' }, 404); return; }
            const result = social.createLobbyInvite(auth.account.id, String(b.friendAccountId || ''), lobby.code);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath.startsWith('/api/social/lobby-invites/') && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyInvite')) return;
        const b = await readBody(req, 512);
        const auth = requireAuth(req, res, b);
        if (auth) {
            const result = social.actOnLobbyInvite(auth.account.id, decodeURIComponent(urlPath.slice('/api/social/lobby-invites/'.length)), b.action);
            sendJson(res, result, result.status);
        }
        return;
    }
    if (urlPath === '/api/profile' && req.method === 'GET') {
        const auth = requireAuth(req, res);
        if (auth) sendJson(res, { profile: profiles._public(auth.profile), account: auth.account });
        return;
    }
    if (urlPath === '/api/profile/onboarding' && req.method === 'POST') {
        if (!allowRequest(req, res, 'onboarding')) return;
        const body = await readBody(req, 512);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const result = profiles.advanceOnboarding(profile, body.onboarding);
        sendJson(res, result.error ? { error: result.error } : {
            onboarding: result.onboarding,
            profile: result.profile,
            updated: result.updated
        }, result.status);
        return;
    }
    if (urlPath === '/api/live-market' && req.method === 'GET') {
        sendJson(res, createLiveMarket(CATALOG));
        return;
    }
    if (urlPath === '/api/profile/live-market/purchase' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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
        const b = await readBody(req);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const requestId = req.headers['idempotency-key'] || b.requestId;
        const result = profiles.purchase(profile, b.kind, b.id, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            profile: result.profile,
            replayed: result.replayed
        }, result.status);
        return;
    }
    if (urlPath === '/api/matches/start' && req.method === 'POST') {
        if (!allowRequest(req, res, 'matchAuthority')) return;
        const b = await readBody(req, 2048);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const result = matchAuthority.start(profile, { matchId: b.matchId, mode: b.mode, lobbyCode: b.lobbyCode });
        sendJson(res, result.error ? { error: result.error } : result, result.httpStatus);
        return;
    }
    if (urlPath === '/api/profile/battlepass/claim' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 1024);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const result = profiles.claimBattlepass(profile, body.tier, body.track);
        sendJson(res, result.error ? { error: result.error } : {
            reward: result.reward,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/battlepass/premium' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 512);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const result = profiles.unlockPremiumBattlepass(profile);
        sendJson(res, result.error ? { error: result.error } : {
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/battlepass/boost/activate' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 1024);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const requestId = req.headers['idempotency-key'] || body.requestId;
        const result = profiles.activateBattlepassBoost(profile, body.boostId, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            activeBoost: result.activeBoost,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/daily-challenges/claim' && req.method === 'POST') {
        if (!allowRequest(req, res, 'dailyChallenge')) return;
        const body = await readBody(req, 1024);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const requestId = req.headers['idempotency-key'] || body.requestId;
        const result = profiles.claimDailyChallenge(profile, body.challengeId, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            coins: result.coins,
            xpGranted: result.xpGranted,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/matches/complete' && req.method === 'POST') {
        if (!allowRequest(req, res, 'matchAuthority')) return;
        const b = await readBody(req, 4096);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const result = matchAuthority.complete(profile, {
            matchId: b.matchId, mode: b.mode, result: b.result, lobbyCode: b.lobbyCode
        });
        sendJson(res, result.error ? { error: result.error } : result, result.httpStatus);
        return;
    }
    if (urlPath.startsWith('/api/matches/') && req.method === 'GET') {
        if (!allowRequest(req, res, 'matchAuthority')) return;
        const profile = requireAuth(req, res)?.profile;
        if (!profile) return;
        const result = matchAuthority.status(profile, decodeURIComponent(urlPath.slice('/api/matches/'.length)));
        sendJson(res, result.error ? { error: result.error } : result, result.httpStatus);
        return;
    }
    if (urlPath === '/api/profile/reward' && req.method === 'POST') {
        if (!allowRequest(req, res, 'reward')) return;
        const b = await readBody(req);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const signature = req.headers['x-match-signature'] || b.signature;
        // Browser rewards use MatchAuthority. This legacy endpoint accepts
        // only a pre-signed receipt from a server-held secret.
        if (!signature || MATCH_REWARD_SECRET.length < 32) {
            sendJson(res, { error: 'signed legacy receipt required' }, 403);
            return;
        }
        const receipt = verifyMatchReceipt(MATCH_REWARD_SECRET, b.receipt, signature);
        if (!receipt || receipt.profileId !== profile.id) {
            sendJson(res, { error: 'invalid match receipt' }, 403);
            return;
        }
        const result = profiles.reward(profile, {
            matchId: receipt.matchId,
            won: receipt.won,
            score: 0,
            deflections: 0
        });
        sendJson(res, result.error ? { error: result.error } : {
            coins: result.coins,
            base: result.base,
            bonus: result.bonus,
            firstOfDay: result.firstOfDay,
            cardReward: result.cardReward,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/cards/equip' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 4096);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const result = profiles.equipCard(profile, body.cardId, body.slot);
        sendJson(res, result.error ? { error: result.error } : {
            loadout: result.loadout,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/cards/trade-up' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 4096);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        const requestId = req.headers['idempotency-key'] || body.requestId;
        const result = profiles.tradeUpCards(profile, body.cardIds, requestId);
        sendJson(res, result.error ? { error: result.error } : {
            result: result.result,
            replayed: result.replayed === true,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/ad-reward' && req.method === 'POST') {
        if (!allowRequest(req, res, 'adReward')) return;
        const b = await readBody(req);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const result = profiles.adReward(profile, b.requestId || req.headers['idempotency-key'] || '');
        sendJson(res, result.error ? { error: result.error, retryAfterMs: result.retryAfterMs } : {
            coins: result.coins,
            remaining: result.remaining,
            cap: result.cap,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/streak-claim' && req.method === 'POST') {
        if (!allowRequest(req, res, 'streak')) return;
        const b = await readBody(req);
        const profile = requireAuth(req, res, b)?.profile;
        if (!profile) return;
        const result = profiles.streakClaim(profile, b.requestId || req.headers['idempotency-key'] || '');
        sendJson(res, result.error ? { error: result.error } : {
            day: result.day,
            reward: result.reward,
            profile: result.profile
        }, result.status);
        return;
    }
    if (urlPath === '/api/profile/cosmetics/equip' && req.method === 'POST') {
        if (!allowRequest(req, res, 'purchase')) return;
        const body = await readBody(req, 4096);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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
        const body = await readBody(req, 4096);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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
        // Only a newly applied, signed paid receipt is revenue evidence. Replays,
        // refunds, rejected prices and browser requests never reach this sink.
        if (event.status === 'paid' && (result.applied === true || result.replayed === true)) productAnalytics.recordPaymentCompleted(event.profileId, event);
        sendJson(res, result.error ? { error: result.error } : result, result.status);
        return;
    }

    if (urlPath === '/api/telemetry' && req.method === 'POST') {
        if (!allowRequest(req, res, 'telemetry')) return;
        const body = await readBody(req, 4096);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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

    if (urlPath === '/api/product-events' && req.method === 'POST') {
        if (!allowRequest(req, res, 'productAnalytics')) return;
        const body = await readBody(req, 20000);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
        if (body.__bodyTooLarge) { sendJson(res, { error: 'payload too large' }, 413); return; }
        if (body.__invalidJson) { sendJson(res, { error: 'invalid json' }, 400); return; }
        const result = productAnalytics.ingest(profile.id, body);
        sendJson(res, result.error ? { error: result.error } : {
            accepted: result.accepted,
            replayed: result.replayed,
            rejected: result.rejected
        }, result.status);
        return;
    }

    // --- Authenticated creator map publishing and public workshop reads. ---
    if (urlPath === '/api/maps' && req.method === 'POST') {
        if (!allowRequest(req, res, 'mapWrite')) return;
        const body = await readBody(req, 100000);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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
        const profile = resolveAuth(req)?.profile;
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
        const encodedId = urlPath.slice('/api/maps/'.length, -'/vote'.length);
        if (!encodedId) { sendJson(res, { error: 'map not found' }, 404); return; }
        const body = await readBody(req, 1024);
        const profile = requireAuth(req, res, body)?.profile;
        if (!profile) return;
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
        const profile = resolveAuth(req)?.profile;
        const result = creatorMaps.get(id, profile?.id || '');
        sendJson(res, result.error ? { error: result.error } : { map: result.map }, result.status);
        return;
    }

    // --- Lobby API ---
    if (urlPath === '/api/lobbies' && req.method === 'GET') {
        pruneLobbies();
        sendJson(res, [...lobbies.values()].map(publicLobby));
        return;
    }
    if (urlPath === '/api/lobbies' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req);
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        if (!b.code) { sendJson(res, { error: 'code required' }, 400); return; }
        const prior = lobbies.get(b.code);
        if (prior && prior.ownerAccountId !== auth.account.id) { sendJson(res, { error: 'lobby unavailable' }, 404); return; }
        const memberProfileIds = prior?.memberProfileIds instanceof Set ? new Set(prior.memberProfileIds) : new Set();
        memberProfileIds.add(auth.profile.id);
        const admissionToken = typeof prior?.admissionToken === 'string' ? prior.admissionToken : crypto.randomBytes(32).toString('base64url');
        lobbies.set(b.code, normalizeLobbyRecord({
            code: b.code,
            name: b.name || 'Lobby',
            hostName: auth.account.username,
            ownerAccountId: auth.account.id,
            memberProfileIds,
            admissionToken,
            players: b.players || 1,
            map: b.map || 'Unknown',
            mode: b.mode || 'Classic',
            ranked: b.ranked === true,
            averageElo: Math.max(0, Math.min(5000, Number(b.averageElo) || 1000)),
            maxPlayers: Math.max(2, Math.min(16, Number(b.maxPlayers) || 8))
        }, Date.now()));
        sendJson(res, { ok: true, admissionToken });
        return;
    }
    if (urlPath.startsWith('/api/lobbies/') && urlPath.endsWith('/join') && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req, 1024);
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        const code = decodeURIComponent(urlPath.slice('/api/lobbies/'.length, -'/join'.length));
        const lobby = lobbies.get(code);
        if (!lobby) { sendJson(res, { error: 'lobby unavailable' }, 404); return; }
        const proof = Buffer.from(String(b.admissionToken || ''));
        const expected = Buffer.from(String(lobby.admissionToken || ''));
        if (!expected.length || expected.length !== proof.length || !crypto.timingSafeEqual(expected, proof)) { sendJson(res, { error: 'invalid lobby admission proof' }, 403); return; }
        lobby.memberProfileIds = lobby.memberProfileIds instanceof Set ? lobby.memberProfileIds : new Set([lobby.ownerProfileId].filter(Boolean));
        if (!lobby.memberProfileIds.has(auth.profile.id) && lobby.memberProfileIds.size >= lobby.maxPlayers) { sendJson(res, { error: 'lobby full' }, 409); return; }
        lobby.memberProfileIds.add(auth.profile.id);
        lobby.lastSeen = Date.now();
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath.startsWith('/api/lobbies/') && urlPath.endsWith('/leave') && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req, 1024); const auth = requireAuth(req, res, b); if (!auth) return;
        const code = decodeURIComponent(urlPath.slice('/api/lobbies/'.length, -'/leave'.length)); const lobby = lobbies.get(code);
        if (!lobby) { sendJson(res, { error: 'lobby unavailable' }, 404); return; }
        if (lobby.ownerAccountId === auth.account.id) { sendJson(res, { error: 'host must close lobby' }, 403); return; }
        lobby.memberProfileIds?.delete(auth.profile.id); lobby.lastSeen = Date.now(); sendJson(res, { ok: true }); return;
    }
    if (urlPath.startsWith('/api/lobbies/') && (req.method === 'DELETE' || req.method === 'POST')) {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = req.method === 'POST' ? await readBody(req, 1024) : null;
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        const code = urlPath === '/api/lobbies/close' ? String(b?.code || '') : decodeURIComponent(urlPath.split('/').pop());
        const lobby = lobbies.get(code);
        if (!lobby || lobby.ownerAccountId !== auth.account.id) { sendJson(res, { error: 'lobby unavailable' }, 404); return; }
        lobbies.delete(code);
        partyStore.clearLobbyTargetByCode(code);
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
        sendJson(res, [...socialHubs.values()].map(publicLobby));
        return;
    }
    if (urlPath === '/api/social-hubs' && req.method === 'POST') {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = await readBody(req);
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        const mapId = String(b.mapId || '').toLowerCase();
        const mapName = Object.hasOwn(SOCIAL_HUB_MAP_NAMES, mapId) ? SOCIAL_HUB_MAP_NAMES[mapId] : '';
        if (!b.code || !mapName) {
            sendJson(res, { error: 'valid code and mapId required' }, 400);
            return;
        }
        socialHubs.set(b.code, normalizeLobbyRecord({
            code: b.code,
            mapId,
            mapName,
            hostName: auth.account.username,
            ownerAccountId: auth.account.id,
            players: Math.max(1, Math.min(32, Number(b.players) || 1))
        }, Date.now()));
        sendJson(res, { ok: true });
        return;
    }
    if (urlPath.startsWith('/api/social-hubs/') && (req.method === 'DELETE' || req.method === 'POST')) {
        if (!allowRequest(req, res, 'lobbyWrite')) return;
        const b = req.method === 'POST' ? await readBody(req, 1024) : null;
        const auth = requireAuth(req, res, b);
        if (!auth) return;
        const code = decodeURIComponent(urlPath.split('/').pop());
        const hub = socialHubs.get(code);
        if (!hub || hub.ownerAccountId !== auth.account.id) { sendJson(res, { error: 'hub unavailable' }, 404); return; }
        socialHubs.delete(code);
        sendJson(res, { ok: true });
        return;
    }
    // sendBeacon can only POST — used by the client's beforeunload to close a lobby.
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

let storesClosed = false;
server.on('close', () => {
    if (storesClosed) return;
    storesClosed = true;
    try { social.close(); } catch {}
    try { accounts.close(); } catch {}
});

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal}: closing connections and embedded stores`);
    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();
    server.close(() => {
        clearTimeout(forceExit);
        process.exit(0);
    });
}

if (require.main === module) {
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
    server.listen(PORT, () => {
        console.log(`\n  WARRBALL running on port ${PORT}\n  Local: http://localhost:${PORT}\n`);
    });
}

module.exports = { normalizeLobbyRecord, pruneLobbies, lobbies, LOBBY_TTL, server, accounts, social, presence, partyStore, matchAuthority };
