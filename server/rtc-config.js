// rtc-config.js — ponytail: builds a WebRTC ICE server config (STUN/TURN) plus
// optional self-hosted PeerJS broker settings from environment variables only.
// Zero deps: Node's built-in crypto for ephemeral coturn REST credentials.
'use strict';

const crypto = require('crypto');

// Several independent public STUN operators: one being blocked or slow in a
// player's country (reported: Lithuania <-> Turkey) must not leave ICE without
// a server-reflexive candidate.
const DEFAULT_STUN_URLS = Object.freeze([
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
    'stun:global.stun.twilio.com:3478'
]);
const DEFAULT_TURN_TTL_SECONDS = 3600;
const MIN_TURN_TTL_SECONDS = 60;
const MAX_TURN_TTL_SECONDS = 86400;
const MAX_URL_LIST_ENTRIES = 8;
const MAX_URL_LENGTH = 256;
const MAX_STRING_FIELD_LENGTH = 256;
const MIN_PORT = 1;
const MAX_PORT = 65535;

function parseUrlList(value) {
    if (value === undefined || value === null) return [];
    return String(value)
        .split(',')
        .map(s => s.trim().slice(0, MAX_URL_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_URL_LIST_ENTRIES);
}

function boundedString(value, maxLength = MAX_STRING_FIELD_LENGTH) {
    if (value === undefined || value === null) return '';
    return String(value).slice(0, maxLength);
}

function safeTurnUserId(userId) {
    // ponytail: nokta da elenir — path-traversal benzeri userid'ler kimlik üretimine sızmasın.
    const cleaned = String(userId || 'warball').replace(/[^A-Za-z0-9_-]/g, '');
    return cleaned.slice(0, 64) || 'warball';
}

function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

// Standard coturn REST API "time-limited credentials" scheme:
// username = "<unix-expiry>:<userid>", credential = base64(HMAC-SHA1(secret, username)).
// https://github.com/coturn/coturn/blob/master/docs/turn_client_credentials.md
function deriveTurnCredential(secret, userId, nowSeconds, ttlSeconds = DEFAULT_TURN_TTL_SECONDS) {
    const expiry = Math.floor(finiteOr(nowSeconds, Date.now() / 1000)) + Math.floor(ttlSeconds);
    const username = `${expiry}:${safeTurnUserId(userId)}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return { username, credential, expiresAt: expiry };
}

function buildPeerBrokerConfig(env) {
    const peer = {};
    const host = boundedString(env.PEER_HOST);
    if (host) peer.host = host;

    const portRaw = Number(env.PEER_PORT);
    if (env.PEER_PORT !== undefined && Number.isFinite(portRaw) && portRaw >= MIN_PORT && portRaw <= MAX_PORT) {
        peer.port = Math.floor(portRaw);
    }

    const path = boundedString(env.PEER_PATH);
    if (path) peer.path = path.startsWith('/') ? path : `/${path}`;

    if (env.PEER_SECURE !== undefined) {
        peer.secure = String(env.PEER_SECURE).toLowerCase() === 'true';
    }

    return peer;
}

/**
 * Builds the response for GET /api/rtc-config.
 * With zero TURN env vars set, this returns STUN-only — identical to today's
 * no-TURN behavior — so local/offline play never breaks.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ now?: () => number, userId?: string }} [opts]
 */
function buildRtcConfig(env = process.env, opts = {}) {
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const iceServers = [];

    const stunUrls = env.STUN_URLS !== undefined ? parseUrlList(env.STUN_URLS) : DEFAULT_STUN_URLS.slice();
    if (stunUrls.length) iceServers.push({ urls: stunUrls });

    const turnUrls = parseUrlList(env.TURN_URLS);
    if (turnUrls.length) {
        const secret = env.TURN_SECRET ? String(env.TURN_SECRET) : '';
        if (secret) {
            const ttlSeconds = Math.max(
                MIN_TURN_TTL_SECONDS,
                Math.min(MAX_TURN_TTL_SECONDS, finiteOr(env.TURN_TTL_SECONDS, DEFAULT_TURN_TTL_SECONDS))
            );
            const { username, credential } = deriveTurnCredential(secret, opts.userId, now() / 1000, ttlSeconds);
            iceServers.push({ urls: turnUrls, username, credential });
        } else if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
            iceServers.push({
                urls: turnUrls,
                username: boundedString(env.TURN_USERNAME),
                credential: boundedString(env.TURN_CREDENTIAL)
            });
        }
        // TURN_URLS set with neither a secret nor static credentials is a
        // misconfiguration — skip adding an unauthenticated TURN entry rather
        // than emitting one that will simply fail to relay.
    }

    return { iceServers, peer: buildPeerBrokerConfig(env) };
}

// ---- Hosted TURN providers (short-lived credentials fetched server-side) ----
// Cloudflare Realtime TURN: CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN.
// Metered.ca:              METERED_TURN_APP (the <app>.metered.live subdomain) + METERED_TURN_API_KEY.
// The API token / key never leaves the server; clients only ever receive the
// provider's time-limited username/credential pair.
const PROVIDER_TIMEOUT_MS = 3500;
const PROVIDER_CACHE_MAX_MS = 30 * 60 * 1000;
let providerCache = null;

function turnProvider(env) {
    if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) return 'cloudflare';
    if (env.METERED_TURN_APP && env.METERED_TURN_API_KEY) return 'metered';
    return '';
}

function sanitizeProviderIceServers(value) {
    const list = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
    const out = [];
    for (const entry of list.slice(0, MAX_URL_LIST_ENTRIES)) {
        if (!entry || typeof entry !== 'object') continue;
        const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls])
            .filter(url => typeof url === 'string' && /^(stun|stuns|turn|turns):/i.test(url))
            .map(url => url.slice(0, MAX_URL_LENGTH))
            .slice(0, MAX_URL_LIST_ENTRIES);
        if (!urls.length) continue;
        const server = { urls };
        if (typeof entry.username === 'string') server.username = boundedString(entry.username);
        if (typeof entry.credential === 'string') server.credential = boundedString(entry.credential);
        if (urls.some(url => /^turns?:/i.test(url)) && (!server.username || !server.credential)) continue;
        out.push(server);
    }
    return out;
}

async function fetchJsonWithTimeout(fetchImpl, url, options) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
        if (!response || !response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchProviderIceServers(env, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    const provider = turnProvider(env);
    if (!provider || typeof fetchImpl !== 'function') return [];
    const ttlSeconds = Math.max(
        MIN_TURN_TTL_SECONDS,
        Math.min(MAX_TURN_TTL_SECONDS, finiteOr(env.TURN_TTL_SECONDS, DEFAULT_TURN_TTL_SECONDS))
    );
    const cacheKey = `${provider}:${env.CLOUDFLARE_TURN_KEY_ID || env.METERED_TURN_APP}:${ttlSeconds}`;
    if (providerCache && providerCache.key === cacheKey && providerCache.expiresAt > now()) {
        return providerCache.servers;
    }
    let servers = [];
    if (provider === 'cloudflare') {
        const keyId = encodeURIComponent(String(env.CLOUDFLARE_TURN_KEY_ID).trim());
        const data = await fetchJsonWithTimeout(fetchImpl, `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${String(env.CLOUDFLARE_TURN_API_TOKEN).trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ttl: ttlSeconds })
        });
        servers = sanitizeProviderIceServers(data?.iceServers);
    } else {
        const app = String(env.METERED_TURN_APP).trim().replace(/\.metered\.live$/i, '').replace(/[^A-Za-z0-9-]/g, '');
        const key = encodeURIComponent(String(env.METERED_TURN_API_KEY).trim());
        const data = await fetchJsonWithTimeout(fetchImpl, `https://${app}.metered.live/api/v1/turn/credentials?apiKey=${key}`, { method: 'GET' });
        servers = sanitizeProviderIceServers(data);
    }
    // Only TURN entries: our own STUN list already covers reflexive candidates.
    servers = servers.filter(server => server.urls.some(url => /^turns?:/i.test(url)));
    if (servers.length) {
        providerCache = {
            key: cacheKey,
            servers,
            expiresAt: now() + Math.min(PROVIDER_CACHE_MAX_MS, ttlSeconds * 500)
        };
    }
    return servers;
}

// GET /api/rtc-config (alias /api/ice-servers): static STUN/TURN from env plus,
// when configured, fresh hosted-TURN credentials. Never throws; a provider
// outage degrades to STUN (and the WebSocket relay covers the rest).
// opts.includeTurn === false (anonymous caller): STUN only — no static TURN
// credentials and no hosted-provider mint, so TURN can't be farmed anonymously.
async function buildRtcConfigWithProviders(env = process.env, opts = {}) {
    const config = buildRtcConfig(env, opts);
    if (opts.includeTurn === false) {
        config.iceServers = config.iceServers.filter(server =>
            !(Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(String(url))));
        config.turn = false;
        return config;
    }
    const provided = await fetchProviderIceServers(env, opts).catch(() => []);
    if (provided.length) config.iceServers.push(...provided);
    config.turn = config.iceServers.some(server =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(String(url))));
    return config;
}

function resetProviderCacheForTests() { providerCache = null; }

module.exports = {
    buildRtcConfig,
    buildRtcConfigWithProviders,
    fetchProviderIceServers,
    sanitizeProviderIceServers,
    resetProviderCacheForTests,
    buildPeerBrokerConfig,
    deriveTurnCredential,
    parseUrlList,
    DEFAULT_STUN_URLS,
    DEFAULT_TURN_TTL_SECONDS
};
