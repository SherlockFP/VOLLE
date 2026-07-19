export const DEFAULT_NETCODE = Object.freeze({
    enabled: false,
    interpolationMs: 70,
    maxExtrapolationMs: 120,
    lagCompensationMs: 160,
    predictionStrength: 0.75
});

export function normalizeNetcode(value = {}) {
    const clamp = (number, min, max, fallback) =>
        Math.min(max, Math.max(min, Number.isFinite(Number(number)) ? Number(number) : fallback));
    return {
        enabled: value.enabled === true,
        interpolationMs: clamp(value.interpolationMs, 30, 150, DEFAULT_NETCODE.interpolationMs),
        maxExtrapolationMs: clamp(value.maxExtrapolationMs, 0, 250, DEFAULT_NETCODE.maxExtrapolationMs),
        lagCompensationMs: clamp(value.lagCompensationMs, 0, 250, DEFAULT_NETCODE.lagCompensationMs),
        predictionStrength: clamp(value.predictionStrength, 0, 1, DEFAULT_NETCODE.predictionStrength)
    };
}

export function sampleSnapshots(buffer, renderTime) {
    if (!Array.isArray(buffer) || !buffer.length) return null;
    if (buffer.length === 1) return { from: buffer[0], to: buffer[0], alpha: 1 };
    let from = buffer[0];
    let to = buffer[buffer.length - 1];
    for (let index = 1; index < buffer.length; index++) {
        if (buffer[index].time >= renderTime) {
            from = buffer[index - 1];
            to = buffer[index];
            break;
        }
    }
    const span = Math.max(1, to.time - from.time);
    return { from, to, alpha: Math.min(1, Math.max(0, (renderTime - from.time) / span)) };
}

export function predictPosition(position, velocity, milliseconds, strength = 1) {
    const dt = Math.max(0, milliseconds) / 1000 * Math.min(1, Math.max(0, strength));
    return {
        x: Number(position.x) + Number(velocity.x || 0) * dt,
        y: Number(position.y) + Number(velocity.y || 0) * dt,
        z: Number(position.z) + Number(velocity.z || 0) * dt
    };
}

export function rewindSnapshot(buffer, now, pingMs, maxRewindMs = 160) {
    const rewind = Math.min(Math.max(0, Number(pingMs) || 0) / 2, maxRewindMs);
    return sampleSnapshots(buffer, now - rewind);
}
