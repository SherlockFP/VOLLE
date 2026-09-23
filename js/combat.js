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
// 32 samples keep the gap under the capsule up to ~1900 u/s at 60 Hz — the
// rally speed is uncapped, so the old cap of 6 could let a late ball skip a body.
export function sweptHitStepCount(distance, totalRadius, maxSteps = 32) {
    if (!(distance > 0) || !(totalRadius > 0)) return 0;
    const gapTarget = totalRadius * 1.5;
    const steps = Math.ceil(distance / gapTarget) - 1;
    if (steps <= 0) return 0;
    return steps > maxSteps ? maxSteps : steps;
}

// Body hit capsule: a vertical segment from the target's feet (feetY) to
// feetY + height, inflated by capsuleRadius, tested against the ball sphere.
// With feetY = 0 this is bit-for-bit the original floor-anchored capsule
// (py = clamp(ball.y, 0, height)), so grounded hits are unchanged; airborne or
// perched targets are simply tested where their body actually is.
// Pure + allocation-free: called per target per swept sample every tick.
export function capsuleContact(ballPos, targetX, targetZ, feetY, height, capsuleRadius, ballRadius) {
    const py = Math.max(feetY, Math.min(feetY + height, ballPos.y));
    const dx = ballPos.x - targetX;
    const dz = ballPos.z - targetZ;
    const dy = ballPos.y - py;
    const distSq = dx * dx + dy * dy + dz * dz;
    const totalRadius = ballRadius + capsuleRadius;
    return distSq < totalRadius * totalRadius;
}

// Feet heights within this band of the floor snap to exactly 0 so network
// quantization (POS_SCALE 1/64 → grounded eye y 1.703125) and interpolation
// noise can never nudge a grounded capsule; below-floor states (swimming, void
// fall) also keep today's floor-anchored capsule instead of sinking it.
export const CAPSULE_GROUND_SNAP = 0.05;

// Feet height of a hit target: its own getFeetY() when present (Player, Bot,
// remote proxy), else 0 (today's floor-anchored behaviour).
export function targetFeetY(target) {
    const feet = typeof target?.getFeetY === 'function' ? target.getFeetY() : 0;
    return Number.isFinite(feet) && feet > CAPSULE_GROUND_SNAP ? feet : 0;
}

// ---------------------------------------------------------------------------
// G2 in-frame contact: where along this frame's ball segment a = start → b =
// end (s ∈ [0, 1], event time = frame start + s·dt) a deflect sphere or a
// body capsule is first touched. Pure + allocation-free (per-frame hot path).
// ---------------------------------------------------------------------------

// Earliest s ∈ [0, 1] with |a + s·(b − a) − centre| ≤ r: 0 when a is already
// inside, −1 when the segment never touches the sphere. When `out` is given,
// out.enter / out.exit receive the entry and exit fractions (exit clamped to 1,
// both −1 on a miss). Tangent-inclusive like segmentIntersectsSphere.
export function segmentSphereEntry(a, b, centre, r, out) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const fx = a.x - centre.x;
    const fy = a.y - centre.y;
    const fz = a.z - centre.z;
    const qa = dx * dx + dy * dy + dz * dz;
    const qb = 2 * (fx * dx + fy * dy + fz * dz);
    const qc = fx * fx + fy * fy + fz * fz - r * r;
    let enter = -1;
    let exit = -1;
    if (qc <= 0) {
        enter = 0;
        exit = 1;
        if (qa > 0) {
            const far = (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa);
            if (far < 1) exit = far > 0 ? far : 0;
        }
    } else if (qa > 0) {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) {
            const root = Math.sqrt(disc);
            const near = (-qb - root) / (2 * qa);
            if (near >= 0 && near <= 1) {
                enter = near;
                const far = (-qb + root) / (2 * qa);
                exit = far < 1 ? far : 1;
            }
        }
    }
    if (out) {
        out.enter = enter;
        out.exit = exit;
    }
    return enter;
}

// Sphere entry for a centre given by coordinates (capsule end caps).
function sphereEntryAt(a, b, cx, cy, cz, r) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const fx = a.x - cx;
    const fy = a.y - cy;
    const fz = a.z - cz;
    const qa = dx * dx + dy * dy + dz * dz;
    const qb = 2 * (fx * dx + fy * dy + fz * dz);
    const qc = fx * fx + fy * fy + fz * fz - r * r;
    if (qc <= 0) return 0;
    if (!(qa > 0)) return -1;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return -1;
    const near = (-qb - Math.sqrt(disc)) / (2 * qa);
    return near >= 0 && near <= 1 ? near : -1;
}

// Earliest s ∈ [0, 1] at which the segment touches the G1 body capsule (the
// vertical axis x, z from feetY to feetY + height inflated by r = ball radius +
// capsule radius, see capsuleContact), or −1. Analytic: the side of the
// cylinder (quadratic in x/z, entry height inside the axis span) plus the two
// hemisphere caps; the earliest of those is the first touch of the union.
export function segmentCapsuleEntry(a, b, feetY, height, x, z, r) {
    const top = feetY + height;
    // Start already touching the capsule.
    const startY = a.y < feetY ? feetY : (a.y > top ? top : a.y);
    const sx = a.x - x;
    const sy = a.y - startY;
    const sz = a.z - z;
    if (sx * sx + sy * sy + sz * sz <= r * r) return 0;

    let best = -1;
    // Cylinder side.
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const qa = dx * dx + dz * dz;
    if (qa > 0) {
        const qb = 2 * (sx * dx + sz * dz);
        const qc = sx * sx + sz * sz - r * r;
        const disc = qb * qb - 4 * qa * qc;
        if (qc > 0 && disc >= 0) {
            const near = (-qb - Math.sqrt(disc)) / (2 * qa);
            if (near >= 0 && near <= 1) {
                const y = a.y + (b.y - a.y) * near;
                if (y >= feetY && y <= top) best = near;
            }
        }
    }
    // Hemisphere caps (the flat ends of the cylinder lie inside them).
    const low = sphereEntryAt(a, b, x, feetY, z, r);
    if (low >= 0 && (best < 0 || low < best)) best = low;
    const high = sphereEntryAt(a, b, x, top, z, r);
    if (high >= 0 && (best < 0 || high < best)) best = high;
    return best;
}

// In-frame deflect fraction for a defender whose sphere the segment enters at
// `enter` and leaves at `exit`, with its swing / ready window [liveFrom,
// liveTo] expressed in frame fractions: max(enter, liveFrom) when that is no
// later than exit, liveTo or the frame end, else −1.
export function deflectContactS(enter, exit, liveFrom, liveTo) {
    if (!(enter >= 0)) return -1;
    const s = liveFrom > enter ? liveFrom : enter;
    return s <= exit && s <= liveTo && s <= 1 ? s : -1;
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
