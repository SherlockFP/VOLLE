const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_PRODUCT_EVENT_NAMES = new Set([
    'session_start', 'session_end', 'session_heartbeat',
    'ftue_view', 'ftue_exit', 'ftue_complete', 'practice_start', 'practice_complete',
    'screen_view', 'quick_play_click', 'quick_play_success', 'quick_play_failure',
    'party_queue_start', 'party_queue_follow_success', 'party_queue_follow_failure',
    'lobby_host', 'lobby_join', 'match_start', 'match_complete',
    'rematch_click', 'rematch_start',
    'shop_inspect', 'shop_purchase_success', 'shop_purchase_failure', 'cosmetic_equip', 'cosmetic_match_use',
    'arena_cache_earned', 'arena_cache_opened', 'card_earned', 'card_equipped', 'card_trade_up',
    'earned_case_granted', 'earned_case_opened',
    'battlepass_premium_unlocked', 'battlepass_reward_claimed', 'battlepass_boost_activated',
    'daily_challenge_completed', 'daily_challenge_claimed',
    'network_role', 'network_reconnect', 'network_disconnect'
]);
// Revenue facts come only from a verified provider webhook. They are deliberately
// excluded from the browser allowlist so a client cannot manufacture payer data.
const SERVER_ONLY_PRODUCT_EVENT_NAMES = new Set(['payment_completed']);
const PRODUCT_EVENT_NAMES = new Set([...CLIENT_PRODUCT_EVENT_NAMES, ...SERVER_ONLY_PRODUCT_EVENT_NAMES]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const VALUE_PATTERN = /^[a-zA-Z0-9._:-]{1,40}$/;
const DIMENSIONS = new Set(['screen', 'shopTab', 'itemType', 'itemId', 'queue', 'mode', 'map', 'entry', 'result', 'networkRole', 'reason', 'latencyBucket', 'practiceType', 'matchId', 'source', 'sku', 'currency', 'provider']);
const METRIC_LIMITS = Object.freeze({ sessionDurationSec: 86400, matchDurationSec: 10800, postgameDelaySec: 300, postgameToRematchSec: 3600, joinLatencyMs: 300000, matchLoadElapsedMs: 60000, matchSetupMs: 60000, clickToCountdownMs: 60000, revenueMinor: 100000000 });

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

function normalizeProductEvent(input, profileId, secret, now = Date.now(), { allowServerOnly = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || !ID_PATTERN.test(String(profileId || ''))
        || !PRODUCT_EVENT_NAMES.has(input.name)
        || (SERVER_ONLY_PRODUCT_EVENT_NAMES.has(input.name) && !allowServerOnly)
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
        const lifecycleSeen = new Set(this.events
            .filter(event => (event.name === 'match_start' || event.name === 'match_complete') && event.dimensions?.matchId)
            .map(event => `${event.profileKey}:${event.name}:${event.dimensions.matchId}`));
        let accepted = 0;
        let replayed = 0;
        let rejected = 0;
        for (const candidate of list) {
            const event = normalizeProductEvent(candidate, profileId, this.secret, now);
            if (!event) { rejected += 1; continue; }
            const lifecycleKey = (event.name === 'match_start' || event.name === 'match_complete') && event.dimensions.matchId
                ? `${event.profileKey}:${event.name}:${event.dimensions.matchId}`
                : '';
            if (seen.has(event.eventId) || (lifecycleKey && lifecycleSeen.has(lifecycleKey))) { replayed += 1; continue; }
            this.events.push(event);
            seen.add(event.eventId);
            if (lifecycleKey) lifecycleSeen.add(lifecycleKey);
            accepted += 1;
        }
        if (accepted) this._prune(now);
        if (accepted || replayed) this._save();
        return { status: accepted ? 202 : rejected ? 400 : 200, accepted, replayed, rejected };
    }

    recordPaymentCompleted(profileId, payment) {
        // Keep provider receipt identifiers out of the analytics payload and
        // within the event-ID length limit. Transaction-based identity also
        // backfills an interrupted sink write without double-counting a retry.
        const receiptKey = crypto.createHmac('sha256', this.secret)
            .update(`payment-receipt:${payment.transactionId}`)
            .digest('hex');
        const event = normalizeProductEvent({
            eventId: `payment:${receiptKey.slice(0, 64)}`,
            // Payments have no browser session. This opaque receipt key must not
            // be interpreted as a gameplay session by the KPI report.
            sessionId: `receipt:${receiptKey.slice(0, 64)}`,
            name: 'payment_completed',
            dimensions: {
                sku: payment.sku,
                currency: payment.currency,
                provider: payment.provider
            },
            metrics: { revenueMinor: payment.amountMinor }
        }, profileId, this.secret, this.now(), { allowServerOnly: true });
        if (!event) return { status: 400, error: 'invalid payment analytics event' };
        this._prune(this.now());
        if (this.events.some(existing => existing.eventId === event.eventId)) {
            return { status: 200, applied: false, replayed: true };
        }
        this.events.push(event);
        this._prune(this.now());
        this._save();
        return { status: 202, applied: true, replayed: false };
    }
}

module.exports = { CLIENT_PRODUCT_EVENT_NAMES, SERVER_ONLY_PRODUCT_EVENT_NAMES, PRODUCT_EVENT_NAMES, METRIC_LIMITS, ProductAnalyticsStore, normalizeProductEvent, profileKey };
