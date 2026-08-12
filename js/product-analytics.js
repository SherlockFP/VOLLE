// Product analytics is intentionally separate from anti-cheat telemetry. It records
// only allowlisted product behavior; no player names, chat, positions, inputs, or art.
export const PRODUCT_EVENT_NAMES = Object.freeze([
    'session_start', 'session_end', 'session_heartbeat',
    'ftue_view', 'ftue_exit', 'ftue_complete', 'practice_start', 'practice_complete',
    'screen_view', 'quick_play_click', 'quick_play_success', 'quick_play_failure',
    'lobby_host', 'lobby_join', 'match_start', 'match_complete',
    'rematch_click', 'rematch_start',
    'shop_inspect', 'shop_purchase_success', 'shop_purchase_failure', 'cosmetic_equip', 'cosmetic_match_use',
    'arena_cache_earned', 'arena_cache_opened', 'card_earned', 'card_equipped', 'card_trade_up',
    'earned_case_granted', 'earned_case_opened',
    'battlepass_premium_unlocked', 'battlepass_reward_claimed', 'battlepass_boost_activated',
    'daily_challenge_completed', 'daily_challenge_claimed',
    'network_role', 'network_reconnect', 'network_disconnect'
]);

const EVENT_NAMES = new Set(PRODUCT_EVENT_NAMES);
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const SAFE_DIMENSION_VALUES = /^[a-zA-Z0-9._:-]{1,40}$/;
export const MATCH_START_TIMING_MAX_MS = 60_000;
const DIMENSIONS = new Set([
    'screen', 'shopTab', 'itemType', 'itemId', 'queue', 'mode', 'map',
    'entry', 'result', 'networkRole', 'reason', 'latencyBucket', 'practiceType',
    'matchId', 'source'
]);
const METRICS = Object.freeze({
    sessionDurationSec: 86400,
    matchDurationSec: 10800,
    postgameDelaySec: 300,
    postgameToRematchSec: 3600,
    joinLatencyMs: 300000,
    matchLoadElapsedMs: MATCH_START_TIMING_MAX_MS,
    matchSetupMs: MATCH_START_TIMING_MAX_MS,
    clickToCountdownMs: MATCH_START_TIMING_MAX_MS
});

function boundedTiming(value) {
    return Number.isFinite(value) && value >= 0 && value <= MATCH_START_TIMING_MAX_MS
        ? Math.round(value * 100) / 100
        : null;
}

// Converts short-lived local monotonic timestamps into bounded durations only.
// Callers never transmit raw timestamps or any player-identifying state.
export function matchStartTimingMetrics(timing = {}, now = performance.now()) {
    const metrics = {};
    const load = boundedTiming(timing.matchLoadElapsedMs);
    const setup = boundedTiming(now - timing.setupStartedAt);
    const total = boundedTiming(now - timing.requestedAt);
    if (load !== null) metrics.matchLoadElapsedMs = load;
    if (setup !== null) metrics.matchSetupMs = setup;
    if (total !== null) metrics.clickToCountdownMs = total;
    return metrics;
}

function makeId(prefix) {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
        || String(Math.random()).slice(2) + Date.now().toString(36);
    return (prefix + ':' + random).slice(0, 96);
}

function normalizeDimensions(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const dimensions = {};
    for (const [key, value] of Object.entries(input)) {
        if (!DIMENSIONS.has(key) || typeof value !== 'string' || !SAFE_DIMENSION_VALUES.test(value)) continue;
        dimensions[key] = value;
    }
    return dimensions;
}

function normalizeMetrics(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const metrics = {};
    for (const [key, value] of Object.entries(input)) {
        if (!(key in METRICS) || !Number.isFinite(value) || value < 0 || value > METRICS[key]) continue;
        metrics[key] = Math.round(value * 100) / 100;
    }
    return metrics;
}

export function normalizeProductEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !EVENT_NAMES.has(input.name)) return null;
    const eventId = typeof input.eventId === 'string' && ID_PATTERN.test(input.eventId) ? input.eventId : '';
    const sessionId = typeof input.sessionId === 'string' && ID_PATTERN.test(input.sessionId) ? input.sessionId : '';
    if (!eventId || !sessionId) return null;
    return Object.freeze({
        eventId,
        sessionId,
        name: input.name,
        dimensions: Object.freeze(normalizeDimensions(input.dimensions)),
        metrics: Object.freeze(normalizeMetrics(input.metrics))
    });
}

export function joinLatencyBucket(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return 'unknown';
    if (value < 250) return 'under_250ms';
    if (value < 1000) return '250ms_999ms';
    if (value < 3000) return '1s_3s';
    return 'over_3s';
}

export class ProductAnalytics {
    constructor(store, { endpoint = '/api/product-events', fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
        this.store = store;
        this.endpoint = endpoint;
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.queue = [];
        this.flushing = false;
        this._flushPromise = null;
        this.startedAt = this.now();
        this.sessionId = this._sessionId();
        this._heartbeatTimer = null;
        this._pageHideHandler = () => {
            this.track('session_end', {}, { sessionDurationSec: Math.max(0, (this.now() - this.startedAt) / 1000) });
            void this.flush();
        };
    }

    _sessionId() {
        const key = 'warrball_product_session_id';
        try {
            const saved = globalThis.sessionStorage?.getItem(key);
            if (saved && ID_PATTERN.test(saved)) return saved;
            const next = makeId('session');
            globalThis.sessionStorage?.setItem(key, next);
            return next;
        } catch {
            return makeId('session');
        }
    }

    start() {
        this.track('session_start');
        this._heartbeatTimer = globalThis.setInterval?.(() => {
            this.track('session_heartbeat', {}, { sessionDurationSec: Math.max(0, (this.now() - this.startedAt) / 1000) });
        }, 5 * 60 * 1000);
        globalThis.addEventListener?.('pagehide', this._pageHideHandler, { once: true });
    }

    track(name, dimensions = {}, metrics = {}) {
        const event = normalizeProductEvent({
            eventId: makeId('product'),
            sessionId: this.sessionId,
            name,
            dimensions,
            metrics
        });
        if (!event) return false;
        this.queue.push({ event, attempts: 0 });
        if (this.queue.length > 50) this.queue.shift();
        void this.flush();
        return true;
    }

    _canFlush() {
        return this.queue.length > 0 && !!this.store?.sessionToken && typeof this.fetchImpl === 'function';
    }

    async _drainQueue() {
        let delivered = false;
        while (this._canFlush()) {
            const batch = this.queue.splice(0, 20);
            try {
                // Native browser fetch performs a receiver brand check. Calling
                // the stored function as this.fetchImpl() uses ProductAnalytics
                // as its receiver and can reject before any request is sent.
                const response = await this.fetchImpl.call(globalThis, this.endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + this.store.sessionToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ events: batch.map(item => item.event) }),
                    keepalive: true
                });
                if (!response?.ok) throw new Error('product analytics rejected');
                delivered = true;
            } catch {
                const retryable = [];
                for (const item of batch) {
                    item.attempts += 1;
                    if (item.attempts < 3) retryable.push(item);
                }
                // Put the failed batch back ahead of arrivals so event order is kept.
                this.queue.unshift(...retryable);
                return delivered;
            }
        }
        // Let a synchronous authentication or track() continuation join this flight
        // before it resolves, rather than leaving an event behind after a valid send.
        await Promise.resolve();
        return this._canFlush() ? this._drainQueue() : delivered;
    }

    flush() {
        if (this._flushPromise) return this._flushPromise;
        if (!this._canFlush()) return Promise.resolve(false);
        this.flushing = true;
        this._flushPromise = this._drainQueue().finally(() => {
            this.flushing = false;
            this._flushPromise = null;
        });
        return this._flushPromise;
    }

    destroy() {
        globalThis.clearInterval?.(this._heartbeatTimer);
        globalThis.removeEventListener?.('pagehide', this._pageHideHandler);
    }
}
