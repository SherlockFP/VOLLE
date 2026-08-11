const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCT_EVENT_NAMES = new Set([
    'session_start', 'session_end', 'session_heartbeat',
    'ftue_view', 'ftue_complete', 'practice_start', 'practice_complete',
    'screen_view', 'quick_play_click', 'quick_play_success', 'quick_play_failure',
    'lobby_host', 'lobby_join', 'match_start', 'match_complete',
    'rematch_click', 'rematch_start',
    'shop_inspect', 'shop_purchase_success', 'shop_purchase_failure', 'cosmetic_equip', 'cosmetic_match_use',
    'arena_cache_earned', 'arena_cache_opened', 'card_earned', 'card_equipped', 'card_trade_up',
    'earned_case_granted', 'earned_case_opened',
    'network_role', 'network_reconnect', 'network_disconnect'
]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const VALUE_PATTERN = /^[a-zA-Z0-9._:-]{1,40}$/;
const DIMENSIONS = new Set(['screen', 'shopTab', 'itemType', 'itemId', 'queue', 'mode', 'map', 'entry', 'result', 'networkRole', 'reason', 'latencyBucket', 'practiceType']);
const METRIC_LIMITS = Object.freeze({ sessionDurationSec: 86400, matchDurationSec: 10800, joinLatencyMs: 300000 });

function profileKey(secret, profileId) {
    return crypto.createHmac('sha256', secret).update(String(profileId)).digest('hex').slice(0, 40);
}

function normalizeObject(input, allowed, validator) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (allowed.has(key) && validator(key, value)) output[key] = value;
    }
    return output;
}

function isAllowlistedObject(input, allowed, validator) {
    if (input === undefined) return true;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    return Object.entries(input).every(([key, value]) => allowed.has(key) && validator(key, value));
}

function normalizeProductEvent(input, profileId, secret, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || !ID_PATTERN.test(String(profileId || ''))
        || !PRODUCT_EVENT_NAMES.has(input.name)
        || !ID_PATTERN.test(String(input.eventId || ''))
        || !ID_PATTERN.test(String(input.sessionId || ''))
        || !isAllowlistedObject(input.dimensions, DIMENSIONS, (_key, value) => typeof value === 'string' && VALUE_PATTERN.test(value))
        || !isAllowlistedObject(input.metrics, new Set(Object.keys(METRIC_LIMITS)), (key, value) => Number.isFinite(value) && value >= 0 && value <= METRIC_LIMITS[key])) return null;
    return {
        eventId: input.eventId,
        sessionId: input.sessionId,
        name: input.name,
        dimensions: normalizeObject(input.dimensions, DIMENSIONS, (_key, value) => typeof value === 'string' && VALUE_PATTERN.test(value)),
        metrics: normalizeObject(input.metrics, new Set(Object.keys(METRIC_LIMITS)), (key, value) => Number.isFinite(value) && value >= 0 && value <= METRIC_LIMITS[key]),
        serverTimestamp: now,
        profileKey: profileKey(secret, profileId)
    };
}

class ProductAnalyticsStore {
    constructor(filePath, { secret, maxEvents = 100000, retentionMs = 90 * 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
        this.filePath = filePath;
        this.secret = typeof secret === 'string' && secret.length >= 32 ? secret : 'local-development-product-analytics-secret';
        this.maxEvents = Math.max(1, Math.floor(maxEvents));
        this.retentionMs = Math.max(24 * 60 * 60 * 1000, Math.floor(retentionMs));
        this.now = now;
        this.events = this._read();
        this._prune(this.now());
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [];
        } catch { return []; }
    }

    _prune(now) {
        const cutoff = now - this.retentionMs;
        this.events = this.events.filter(event => Number.isFinite(event.serverTimestamp) && event.serverTimestamp >= cutoff).slice(-this.maxEvents);
    }

    _save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = this.filePath + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(this.events));
        fs.renameSync(temp, this.filePath);
    }

    ingest(profileId, input) {
        const list = Array.isArray(input) ? input : Array.isArray(input?.events) ? input.events : [input];
        if (!list.length || list.length > 25) return { status: 400, error: 'invalid product event batch' };
        const now = this.now();
        this._prune(now);
        const seen = new Set(this.events.map(event => event.eventId));
        let accepted = 0;
        let replayed = 0;
        let rejected = 0;
        for (const candidate of list) {
            const event = normalizeProductEvent(candidate, profileId, this.secret, now);
            if (!event) { rejected += 1; continue; }
            if (seen.has(event.eventId)) { replayed += 1; continue; }
            this.events.push(event);
            seen.add(event.eventId);
            accepted += 1;
        }
        if (accepted) this._prune(now);
        if (accepted || replayed) this._save();
        return { status: accepted ? 202 : rejected ? 400 : 200, accepted, replayed, rejected };
    }
}

module.exports = { PRODUCT_EVENT_NAMES, METRIC_LIMITS, ProductAnalyticsStore, normalizeProductEvent, profileKey };
