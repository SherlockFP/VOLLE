const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function boundedInteger(value, fallback, min, max) {
    return Math.trunc(clamp(finiteNumber(value, fallback), min, max));
}

function sanitizeText(value, maxLength) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeId(value) {
    const id = String(value ?? '').trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

export const AFK_DEFAULTS = Object.freeze({
    warningMs: 120_000,
    kickMs: 180_000
});

export class AfkMonitor {
    constructor(options = {}) {
        const warningMs = boundedInteger(
            options.warningMs,
            AFK_DEFAULTS.warningMs,
            1_000,
            24 * 60 * 60 * 1_000
        );
        const kickMs = boundedInteger(
            options.kickMs,
            AFK_DEFAULTS.kickMs,
            warningMs + 1,
            24 * 60 * 60 * 1_000
        );
        this.warningMs = warningMs;
        this.kickMs = kickMs;
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.lastActivityAt = finiteNumber(options.startedAt, this.now());
    }

    recordActivity(at = this.now()) {
        const safeAt = finiteNumber(at, this.now());
        this.lastActivityAt = Math.max(this.lastActivityAt, safeAt);
        return this.status(safeAt);
    }

    reset(at = this.now()) {
        return this.recordActivity(at);
    }

    status(at = this.now()) {
        const idleMs = Math.max(0, finiteNumber(at, this.now()) - this.lastActivityAt);
        const state = idleMs >= this.kickMs
            ? 'kick'
            : idleMs >= this.warningMs ? 'warning' : 'active';
        return Object.freeze({
            state,
            idleMs,
            warning: state === 'warning',
            kick: state === 'kick'
        });
    }
}

export class RollingNetworkMonitor {
    constructor(options = {}) {
        this.windowMs = boundedInteger(options.windowMs, 10_000, 1_000, 300_000);
        this.maxSamples = boundedInteger(options.maxSamples, 120, 2, 10_000);
        this.packetLossThreshold = clamp(
            finiteNumber(options.packetLossThreshold, 0.1),
            0,
            1
        );
        this.desyncThresholdMs = clamp(
            finiteNumber(options.desyncThresholdMs, 250),
            1,
            60_000
        );
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.samples = [];
    }

    addSample(sample = {}, at = this.now()) {
        if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
            throw new TypeError('Network sample must be an object');
        }
        const expected = boundedInteger(
            sample.expectedPackets ?? sample.sentPackets ?? sample.sent,
            1,
            1,
            1_000_000
        );
        const receivedValue = sample.receivedPackets ?? sample.received;
        const explicitLoss = finiteNumber(sample.packetLoss, NaN);
        const lost = Number.isFinite(explicitLoss)
            ? Math.round(expected * clamp(explicitLoss, 0, 1))
            : boundedInteger(
                sample.lostPackets ?? sample.lost,
                Math.max(0, expected - finiteNumber(receivedValue, expected)),
                0,
                expected
            );
        const entry = Object.freeze({
            at: finiteNumber(at, this.now()),
            expected,
            lost,
            desyncMs: clamp(Math.abs(finiteNumber(sample.desyncMs, 0)), 0, 60_000)
        });
        this.samples.push(entry);
        if (this.samples.length > this.maxSamples) {
            this.samples.splice(0, this.samples.length - this.maxSamples);
        }
        this.#prune(entry.at);
        return this.snapshot(entry.at);
    }

    record(sample = {}, at = this.now()) {
        return this.addSample(sample, at);
    }

    reset() {
        this.samples.length = 0;
    }

    snapshot(at = this.now()) {
        this.#prune(finiteNumber(at, this.now()));
        let expectedPackets = 0;
        let lostPackets = 0;
        let desyncTotal = 0;
        let maxDesyncMs = 0;
        for (const sample of this.samples) {
            expectedPackets += sample.expected;
            lostPackets += sample.lost;
            desyncTotal += sample.desyncMs;
            maxDesyncMs = Math.max(maxDesyncMs, sample.desyncMs);
        }
        const packetLoss = expectedPackets ? lostPackets / expectedPackets : 0;
        const averageDesyncMs = this.samples.length ? desyncTotal / this.samples.length : 0;
        const packetLossAlert = packetLoss >= this.packetLossThreshold && expectedPackets > 0;
        const desyncAlert = averageDesyncMs >= this.desyncThresholdMs;
        return Object.freeze({
            samples: this.samples.length,
            expectedPackets,
            lostPackets,
            packetLoss,
            averageDesyncMs,
            maxDesyncMs,
            packetLossAlert,
            desyncAlert,
            unhealthy: packetLossAlert || desyncAlert
        });
    }

    #prune(at) {
        const cutoff = at - this.windowMs;
        while (this.samples.length && this.samples[0].at < cutoff) this.samples.shift();
    }
}

export const MODERATION_REASONS = Object.freeze([
    'cheating',
    'harassment',
    'spam',
    'unsafe_name',
    'other'
]);

export class ModerationReportQueue {
    constructor(options = {}) {
        this.capacity = boundedInteger(options.capacity, 20, 1, 100);
        this.rateLimit = boundedInteger(options.rateLimit, 3, 1, 20);
        this.rateWindowMs = boundedInteger(options.rateWindowMs, 60_000, 1_000, 3_600_000);
        this.now = typeof options.now === 'function' ? options.now : Date.now;
        this.queue = [];
        this.acceptedAt = [];
    }

    enqueue(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return Object.freeze({ accepted: false, reason: 'invalid_report' });
        }
        const at = finiteNumber(input.at, this.now());
        const cutoff = at - this.rateWindowMs;
        this.acceptedAt = this.acceptedAt.filter(time => time > cutoff && time <= at);
        if (this.acceptedAt.length >= this.rateLimit) {
            return Object.freeze({ accepted: false, reason: 'rate_limited' });
        }
        if (this.queue.length >= this.capacity) {
            return Object.freeze({ accepted: false, reason: 'queue_full' });
        }

        const targetId = sanitizeId(input.targetId);
        const reporterId = sanitizeId(input.reporterId);
        const reason = MODERATION_REASONS.includes(input.reason) ? input.reason : '';
        const details = sanitizeText(input.details, 500);
        if (!targetId || !reporterId || !reason || targetId === reporterId) {
            return Object.freeze({ accepted: false, reason: 'invalid_report' });
        }

        const report = Object.freeze({ targetId, reporterId, reason, details, at });
        this.queue.push(report);
        this.acceptedAt.push(at);
        return Object.freeze({ accepted: true, report });
    }

    dequeue() {
        return this.queue.shift() || null;
    }

    drain(limit = this.queue.length) {
        return this.queue.splice(0, boundedInteger(limit, this.queue.length, 0, this.capacity));
    }

    get size() {
        return this.queue.length;
    }
}

export const QUALITY_PRESETS = Object.freeze({
    low: Object.freeze({ name: 'low', pixelRatio: 1, shadows: false, bloom: 0 }),
    medium: Object.freeze({ name: 'medium', pixelRatio: 1.5, shadows: true, bloom: 0.05 }),
    high: Object.freeze({ name: 'high', pixelRatio: 2, shadows: true, bloom: 0.08 })
});

export function resolveQualityPreset(requested = 'auto', capabilities = {}) {
    const choice = String(requested).toLowerCase();
    if (Object.hasOwn(QUALITY_PRESETS, choice)) return QUALITY_PRESETS[choice];

    const fps = finiteNumber(capabilities.fps, 60);
    const frameTimeMs = finiteNumber(capabilities.frameTimeMs, 1_000 / fps);
    const memory = finiteNumber(capabilities.deviceMemory, 4);
    const cores = finiteNumber(capabilities.hardwareConcurrency, 4);
    const reducedMotion = capabilities.reducedMotion === true;
    if (reducedMotion || fps < 40 || frameTimeMs > 25 || memory <= 2 || cores <= 2) {
        return QUALITY_PRESETS.low;
    }
    if (fps >= 58 && frameTimeMs <= 18 && memory >= 8 && cores >= 6) {
        return QUALITY_PRESETS.high;
    }
    return QUALITY_PRESETS.medium;
}

export const SHADER_WARMUP_MANIFEST = Object.freeze([
    Object.freeze({
        id: 'toon',
        vertexExport: 'toonVertexShader',
        fragmentExport: 'toonFragmentShader',
        defines: Object.freeze([])
    }),
    Object.freeze({
        id: 'outline',
        vertexExport: 'outlineVertexShader',
        fragmentExport: 'outlineFragmentShader',
        defines: Object.freeze([])
    })
]);

export function createPublicDiagnostics(input = {}) {
    const network = input.network && typeof input.network === 'object' ? input.network : {};
    const performanceInfo = input.performance && typeof input.performance === 'object'
        ? input.performance
        : {};
    const quality = resolveQualityPreset(input.quality ?? 'auto', performanceInfo).name;
    return Object.freeze({
        version: sanitizeText(input.version, 32) || 'unknown',
        quality,
        network: Object.freeze({
            pingMs: clamp(finiteNumber(network.pingMs ?? network.ping, 0), 0, 60_000),
            packetLoss: clamp(finiteNumber(network.packetLoss, 0), 0, 1),
            desyncMs: clamp(Math.abs(finiteNumber(network.desyncMs, 0)), 0, 60_000),
            reconnecting: network.reconnecting === true
        }),
        performance: Object.freeze({
            fps: clamp(finiteNumber(performanceInfo.fps, 0), 0, 1_000),
            frameTimeMs: clamp(finiteNumber(performanceInfo.frameTimeMs, 0), 0, 1_000)
        })
    });
}
