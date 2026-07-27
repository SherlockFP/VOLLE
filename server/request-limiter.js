const DEFAULT_MAX_KEYS = 4096;

function finitePositive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

class RequestLimiter {
    constructor({ maxKeys = DEFAULT_MAX_KEYS, now = () => Date.now() } = {}) {
        this.maxKeys = Math.max(1, Math.floor(Number(maxKeys) || DEFAULT_MAX_KEYS));
        this.now = now;
        this.buckets = new Map();
    }

    _prune(now) {
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now) this.buckets.delete(key);
        }
        while (this.buckets.size > this.maxKeys) {
            const oldest = this.buckets.keys().next().value;
            if (oldest === undefined) break;
            this.buckets.delete(oldest);
        }
    }

    consume(key, limit, windowMs) {
        const safeKey = typeof key === 'string' && key ? key.slice(0, 160) : 'unknown';
        const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
        const safeWindow = finitePositive(Number(windowMs), 60000);
        const now = this.now();
        this._prune(now);
        let bucket = this.buckets.get(safeKey);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + safeWindow };
            this.buckets.delete(safeKey);
            this.buckets.set(safeKey, bucket);
        }
        bucket.count++;
        this.buckets.delete(safeKey);
        this.buckets.set(safeKey, bucket);
        this._prune(now);
        const allowed = bucket.count <= safeLimit;
        return {
            allowed,
            remaining: Math.max(0, safeLimit - bucket.count),
            retryAfterMs: Math.max(0, bucket.resetAt - now)
        };
    }
}

module.exports = { RequestLimiter, DEFAULT_MAX_KEYS };
