// rtc-config.js — ponytail: builds a WebRTC ICE server config (STUN/TURN) plus
// optional self-hosted PeerJS broker settings from environment variables only.
// Zero deps: Node's built-in crypto for ephemeral coturn REST credentials.
'use strict';

const crypto = require('crypto');

const DEFAULT_STUN_URLS = Object.freeze(['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478']);
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

module.exports = {
    buildRtcConfig,
    buildPeerBrokerConfig,
    deriveTurnCredential,
    parseUrlList,
    DEFAULT_STUN_URLS,
    DEFAULT_TURN_TTL_SECONDS
};
