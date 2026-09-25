// lobby-guest.js — anonymous, stateless guest identities for the online lobby
// endpoints ONLY (host / join / leave / close / relay). A guest token is an
// HMAC-signed { guest id, display name, expiry } triple: the server keeps no
// guest state, guests never get a profile, economy, rewards or ranked access,
// and every other API keeps using AccountStore sessions (a guest token there is
// just an unknown bearer -> 401).
'use strict';

const crypto = require('crypto');

const GUEST_TOKEN_PREFIX = 'lg1.';
const DEFAULT_GUEST_TTL_MS = 12 * 60 * 60 * 1000;
const GUEST_NAME_PATTERN = /^Guest\d{4}$/;
const GUEST_ID_PATTERN = /^[a-f0-9]{24}$/;

function base64url(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function sanitizeGuestName(name) {
    const value = String(name || '').trim();
    if (GUEST_NAME_PATTERN.test(value)) return value;
    return `Guest${String(crypto.randomInt(1000, 10000))}`;
}

class LobbyGuestSessions {
    constructor({ secret = crypto.randomBytes(32), ttlMs = DEFAULT_GUEST_TTL_MS, now = () => Date.now() } = {}) {
        this.secret = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret));
        if (this.secret.length < 16) throw new Error('guest session secret too short');
        this.ttlMs = Math.max(60_000, Number(ttlMs) || DEFAULT_GUEST_TTL_MS);
        this.now = now;
    }

    _sign(payload) {
        return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    }

    issue(name) {
        const guestId = crypto.randomBytes(12).toString('hex');
        const displayName = sanitizeGuestName(name);
        const expiresAt = this.now() + this.ttlMs;
        const payload = base64url(JSON.stringify({ g: guestId, n: displayName, e: expiresAt }));
        return {
            guestToken: `${GUEST_TOKEN_PREFIX}${payload}.${this._sign(payload)}`,
            guestId: `guest:${guestId}`,
            name: displayName,
            expiresAt
        };
    }

    // -> { guest: true, profile: { id }, account: { id, username } } | null
    resolve(token) {
        if (typeof token !== 'string' || !token.startsWith(GUEST_TOKEN_PREFIX) || token.length > 512) return null;
        const body = token.slice(GUEST_TOKEN_PREFIX.length);
        const dot = body.indexOf('.');
        if (dot <= 0) return null;
        const payload = body.slice(0, dot);
        const signature = Buffer.from(body.slice(dot + 1));
        const expected = Buffer.from(this._sign(payload));
        if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) return null;
        let data;
        try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
        if (!data || !GUEST_ID_PATTERN.test(String(data.g || '')) || !GUEST_NAME_PATTERN.test(String(data.n || ''))
            || !Number.isFinite(data.e) || data.e <= this.now()) return null;
        const id = `guest:${data.g}`;
        return Object.freeze({
            guest: true,
            profile: Object.freeze({ id }),
            account: Object.freeze({ id, username: data.n })
        });
    }
}

function isGuestToken(token) {
    return typeof token === 'string' && token.startsWith(GUEST_TOKEN_PREFIX);
}

module.exports = { LobbyGuestSessions, isGuestToken, sanitizeGuestName, GUEST_TOKEN_PREFIX };
