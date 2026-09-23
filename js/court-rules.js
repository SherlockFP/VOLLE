// court-rules.js — team-half confinement ("cross-court") rule.
// Pure functions (no THREE, no DOM) so player.js, bot.js, game.js and the host-side
// remote validation all share one definition and node tests can pin it.
//
// Court layout: red defends z < 0, blue defends z > 0, the midline is z = 0.
// The midline is an invisible wall for PLAYERS only — the ball never consults this.

export const COURT_MIDLINE_Z = 0;
export const DEFAULT_ALLOW_CROSS_COURT = false;

// -1 = red half (z < 0), +1 = blue half (z > 0), 0 = unknown / no team.
export function courtSideForTeam(team) {
    if (team === 'red') return -1;
    if (team === 'blue') return 1;
    return 0;
}

// The rule only exists in team play: FFA has no halves, Goal Rush needs players to
// reach the enemy goal, practice/drill sessions are free roam. Crossing is locked
// unless the host explicitly allowed it.
export function isCrossCourtLocked({ ffa = false, goalRush = false, practice = false, allowCrossCourt = DEFAULT_ALLOW_CROSS_COURT } = {}) {
    return !ffa && !goalRush && !practice && allowCrossCourt !== true;
}

export function confinementSideFor(team, context = {}) {
    return isCrossCourtLocked(context) ? courtSideForTeam(team) : 0;
}

// Clamp a z coordinate so a body of `radius` stays entirely on its own half.
// side 0 (or a non-finite z) passes through untouched.
export function clampToCourtHalf(z, side, radius = 0) {
    if (!side || !Number.isFinite(z)) return z;
    const margin = Number.isFinite(radius) && radius > 0 ? radius : 0;
    return side < 0
        ? Math.min(z, COURT_MIDLINE_Z - margin)
        : Math.max(z, COURT_MIDLINE_Z + margin);
}

// Normalize the host setting coming off the wire / DOM.
export function normalizeAllowCrossCourt(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}
