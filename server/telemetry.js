const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const TYPES = new Set(['match', 'network', 'input']);
const METRIC_LIMITS = Object.freeze({
    packetRate: 1000,
    inputRate: 1000,
    stalePackets: 10000,
    droppedPackets: 10000,
    speedViolations: 100,
    impossibleDeflects: 100,
    rttMs: 5000,
    jitterMs: 2000,
    fps: 500
});

function hashProfileId(profileId) {
    return crypto.createHash('sha256').update(profileId).digest('hex').slice(0, 32);
}

function normalizeTelemetryEvent(input, profileId, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (!PROFILE_ID_PATTERN.test(String(profileId || ''))) return null;
    const eventId = typeof input.eventId === 'string' ? input.eventId : '';
    const matchId = typeof input.matchId === 'string' ? input.matchId : '';
    const type = typeof input.type === 'string' ? input.type : '';
    const timestamp = Number(input.timestamp);
    if (!EVENT_ID_PATTERN.test(eventId)
        || (matchId && !EVENT_ID_PATTERN.test(matchId))
        || !TYPES.has(type)
        || !Number.isSafeInteger(timestamp)
        || timestamp < now - 10 * 60 * 1000
        || timestamp > now + 30 * 1000
        || !input.metrics || typeof input.metrics !== 'object'
        || Array.isArray(input.metrics)) return null;
    const metrics = {};
    for (const [key, value] of Object.entries(input.metrics)) {
        if (!(key in METRIC_LIMITS) || !Number.isFinite(value)
            || value < 0 || value > METRIC_LIMITS[key]) return null;
        metrics[key] = Math.round(value * 100) / 100;
    }
    const score = Math.min(1000,
        (metrics.impossibleDeflects || 0) * 10
        + (metrics.speedViolations || 0) * 5
        + Math.max(0, (metrics.inputRate || 0) - 240) / 20
        + Math.max(0, (metrics.packetRate || 0) - 240) / 40);
    return {
        eventId,
        matchId,
        type,
        timestamp,
        metrics,
        suspiciousScore: Math.round(score * 100) / 100,
        flagged: score >= 10,
        profileKey: hashProfileId(String(profileId))
    };
}

class TelemetryStore {
    constructor(filePath, { maxEvents = 10000, now = () => Date.now() } = {}) {
        this.filePath = filePath;
        this.maxEvents = Math.max(100, Math.floor(Number(maxEvents) || 10000));
        this.now = now;
        this.events = this._read();
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return Array.isArray(parsed) ? parsed.slice(-this.maxEvents) : [];
        } catch {
            return [];
        }
    }

    _save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.events));
        fs.renameSync(temp, this.filePath);
    }

    ingest(profileId, input) {
        const event = normalizeTelemetryEvent(input, profileId, this.now());
        if (!event) return { status: 400, error: 'invalid telemetry event' };
        if (this.events.some(item => item.eventId === event.eventId)) {
            return { status: 200, accepted: false, replayed: true, flagged: false };
        }
        this.events.push(event);
        if (this.events.length > this.maxEvents) this.events = this.events.slice(-this.maxEvents);
        this._save();
        return { status: 202, accepted: true, replayed: false, flagged: event.flagged };
    }

    summary(profileId) {
        const key = hashProfileId(String(profileId || ''));
        const events = this.events.filter(item => item.profileKey === key);
        return {
            events: events.length,
            flagged: events.filter(item => item.flagged).length,
            score: Math.min(1000, events.reduce((total, item) => total + item.suspiciousScore, 0))
        };
    }
}

module.exports = { METRIC_LIMITS, TelemetryStore, normalizeTelemetryEvent };
