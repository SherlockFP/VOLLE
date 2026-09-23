// spectator-seats.js — seat anchors for joined spectators in the sideline stands.
// Pure (no THREE/DOM): host and every client derive the exact same seat list from the
// map config, so the network only ever carries a seat index.
//
// Sidelines are west/east (x = ±courtWidth/2) — "left and right of the court" from a
// player's point of view. Seats sit on top of the tier boxes Arena.buildSpectatorStands()
// builds (same side/setback/depth/rise math). Maps without sideline stands get a
// generated symmetric pair so every playable map has seats.

export const SEAT_SPACING = 1.8;
export const MAX_SEATS_PER_ROW = 20;
export const SEATED_EYE_HEIGHT = 1.15;
export const SEAT_SIDES = Object.freeze(['west', 'east']);

const SIDELINE_SIDES = new Set(SEAT_SIDES);
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function standList(config) {
    return Array.isArray(config?.spectator?.stands) ? config.spectator.stands.slice(0, 8) : [];
}

// Extra west/east stands for maps that only have end-line (north/south) stands or none.
// Arena builds these as geometry too, so the generated seats are never floating.
export function generatedSidelineStands(config) {
    if (!config || config.practiceOnly || config.isCosmeticStudio) return [];
    if (standList(config).some(stand => SIDELINE_SIDES.has(stand?.side))) return [];
    const courtLength = Math.max(8, finite(config.courtLength, 60));
    const length = Math.max(12, Math.min(60, courtLength * 0.6));
    const base = { tiers: 3, depth: 1.8, rise: 0.7, setback: 4, length, generated: true };
    return [{ ...base, side: 'west' }, { ...base, side: 'east' }];
}

// Seats ordered west (tier 0 → n, slot -z → +z), then the east mirror in the same order:
// seat i on the west and seat i + half on the east are exact x-mirrors.
export function computeSpectatorSeats(config, { spacing = SEAT_SPACING, maxPerRow = MAX_SEATS_PER_ROW } = {}) {
    if (!config || config.practiceOnly || config.isCosmeticStudio) return [];
    const halfW = Math.max(0, finite(config.courtWidth, 0)) / 2;
    if (!(halfW > 0)) return [];
    const stands = [...standList(config), ...generatedSidelineStands(config)];
    const template = stands.find(stand => stand?.side === 'west') || stands.find(stand => stand?.side === 'east');
    if (!template) return [];
    const tiers = Math.min(8, Math.max(1, Math.floor(finite(template.tiers, 1))));
    const depth = Math.max(1, finite(template.depth, 2));
    const rise = Math.max(0.35, finite(template.rise, 0.8));
    const setback = Math.max(2, finite(template.setback, 4));
    const length = Math.max(8, finite(template.length, finite(config.courtLength, 40) * 0.8));
    const gap = Math.max(1, finite(spacing, SEAT_SPACING));
    const perRow = Math.max(1, Math.min(Math.max(1, Math.floor(maxPerRow)), Math.floor(length / gap)));
    const seats = [];
    for (const side of SEAT_SIDES) {
        const sign = side === 'west' ? -1 : 1;
        for (let tier = 0; tier < tiers; tier++) {
            const x = sign * (halfW + setback + depth * (tier + 0.5));
            const y = rise * (tier + 1);
            for (let slot = 0; slot < perRow; slot++) {
                seats.push(Object.freeze({
                    index: seats.length,
                    side,
                    tier,
                    slot,
                    x,
                    y,
                    z: (slot - (perRow - 1) / 2) * gap,
                    // Camera yaw (player.js convention: forward = (-sin, 0, -cos)) facing the court.
                    yaw: side === 'west' ? -Math.PI / 2 : Math.PI / 2
                }));
            }
        }
    }
    return seats;
}

export function isValidSeatIndex(seats, index) {
    return Number.isSafeInteger(index) && index >= 0 && index < (seats?.length || 0);
}

// Front row, centre first; the preferred side first, the other side as overflow.
export function findFreeSeat(seats, occupied = new Set(), preferredSide = 'west') {
    if (!seats?.length) return -1;
    const side = SIDELINE_SIDES.has(preferredSide) ? preferredSide : 'west';
    let best = -1;
    let bestScore = Infinity;
    for (const seat of seats) {
        if (occupied.has(seat.index)) continue;
        const score = (seat.side === side ? 0 : 10000) + seat.tier * 100 + Math.abs(seat.z);
        if (score < bestScore) {
            bestScore = score;
            best = seat.index;
        }
    }
    return best;
}

// Hop to the nearest free seat in a direction as seen by the seated spectator
// (facing the court). 'across' jumps to the mirrored seat on the other sideline.
export function neighborSeat(seats, index, direction, occupied = new Set()) {
    if (!isValidSeatIndex(seats, index)) return index;
    const from = seats[index];
    if (direction === 'across') {
        const mirror = seats.find(seat => seat.side !== from.side && seat.tier === from.tier && seat.slot === from.slot);
        if (mirror && !occupied.has(mirror.index)) return mirror.index;
        const others = seats.filter(seat => seat.side !== from.side);
        const free = findFreeSeat(others, occupied, others[0]?.side);
        return free >= 0 ? free : index;
    }
    // West seats face +x, so their right hand points to +z; east seats are mirrored.
    const facingSign = from.side === 'west' ? 1 : -1;
    let dSlot = 0;
    let dTier = 0;
    if (direction === 'right') dSlot = facingSign;
    else if (direction === 'left') dSlot = -facingSign;
    else if (direction === 'up') dTier = 1;
    else if (direction === 'down') dTier = -1;
    else return index;
    let slot = from.slot + dSlot;
    let tier = from.tier + dTier;
    for (let guard = 0; guard < 64; guard++) {
        const next = seats.find(seat => seat.side === from.side && seat.tier === tier && seat.slot === slot);
        if (!next) return index;
        if (!occupied.has(next.index)) return next.index;
        slot += dSlot;
        tier += dTier;
    }
    return index;
}
