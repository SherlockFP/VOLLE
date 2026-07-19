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
