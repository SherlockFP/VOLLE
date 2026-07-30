export function pointSegmentDistanceSq(point, start, end) {
    const abx = end.x - start.x;
    const aby = end.y - start.y;
    const abz = end.z - start.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    if (lengthSq === 0) {
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        const dz = point.z - start.z;
        return dx * dx + dy * dy + dz * dz;
    }
    const t = Math.max(0, Math.min(1,
        ((point.x - start.x) * abx + (point.y - start.y) * aby + (point.z - start.z) * abz) / lengthSq
    ));
    const dx = point.x - (start.x + abx * t);
    const dy = point.y - (start.y + aby * t);
    const dz = point.z - (start.z + abz * t);
    return dx * dx + dy * dy + dz * dz;
}

export function segmentIntersectsSphere(start, end, center, radius) {
    return pointSegmentDistanceSq(center, start, end) <= radius * radius;
}

export function resolveKillerName(attacker, localPlayer, localName, lastShotBy, victimName) {
    const direct = attacker === localPlayer ? localName : attacker?.name;
    if (typeof direct === 'string' && direct.trim() && direct !== victimName) return direct.trim();
    if (typeof lastShotBy === 'string' && lastShotBy.trim() && lastShotBy !== victimName) return lastShotBy.trim();
    return 'Environment';
}

// ---------------------------------------------------------------------------
// Hitreg feel layer — pure, unit-tested tuning helpers wired from game.js's
// combat regions (hit detection, remoteAttack dedup, pending-lethal grace,
// kill-confirm "hot ball" timers). Kept here so every curve stays testable
// without instantiating Game/THREE.
// ---------------------------------------------------------------------------

// Swept-hit step count: how many extra interpolated samples are needed between
// last frame's ball position and this frame's so no gap along the segment can
// exceed `totalRadius` (ball + target capsule) times a safety factor. Distance-
// driven (not speed-only) so a large dt (frame drop) gets the same protection
// as a fast ball — the old speed*0.015 heuristic ignored dt entirely.
export function sweptHitStepCount(distance, totalRadius, maxSteps = 6) {
    if (!(distance > 0) || !(totalRadius > 0)) return 0;
    const gapTarget = totalRadius * 1.5;
    const steps = Math.ceil(distance / gapTarget) - 1;
    if (steps <= 0) return 0;
    return steps > maxSteps ? maxSteps : steps;
}

// remoteAttack dedup window: a fixed window eats legitimate fast-rally returns
// once the ball is moving well above base speed (its real round-trip shrinks
// with it). Scales the window down proportionally to the speed ratio, floored
// so it still catches literal duplicate/retried network packets.
export function scaleDedupWindowMs(baseMs, ballSpeed, baseSpeed, floorMs = 30) {
    if (!(ballSpeed > 0) || !(baseSpeed > 0) || !(baseMs > 0)) return baseMs;
    const ratio = ballSpeed / baseSpeed;
    if (ratio <= 1) return baseMs;
    const scaled = baseMs / ratio;
    return scaled < floorMs ? floorMs : scaled;
}

// Pending-lethal-hit grace window: base ms plus a ping-proportional bonus so a
// laggy victim's late deflect still has time to arrive and cancel the kill.
export function scaleLethalGraceMs(baseMs, pingMs, maxBonusMs = 120, ratio = 0.5) {
    const ping = Number.isFinite(pingMs) && pingMs > 0 ? pingMs : 0;
    const bonus = Math.min(maxBonusMs, ping * ratio);
    return baseMs + bonus;
}

// Kill-confirm "hot ball" timers: decrements every entry's duration in place
// and returns the keys that just expired, so the caller deletes only those —
// NOT the whole map (a prior bug cleared every player's window the instant any
// single one ran out).
export function decayKillConfirmEntries(entries, dt) {
    const expired = [];
    for (const [key, state] of entries) {
        state.duration -= dt;
        if (state.duration <= 0) expired.push(key);
    }
    return expired;
}
