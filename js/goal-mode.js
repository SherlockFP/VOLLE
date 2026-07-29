// goal-mode.js — Goal Rush objective mode: score by putting the ball in the enemy goal.
// ponytail: pure functions only (no THREE, no game.js) so this is node-testable in isolation.
// arena.js consumes computeGoalZones() to place procedural goal geometry;
// gamemodes.js registers the mode + mutator defaults exported here.

export const GOAL_RUSH_MODE_ID = 'goal_rush';

export const DEFAULT_SCORE_TO_WIN = 5;

// Power Shot (Goal Rush objective 3.5): goals scored from closer than 8m count as 2 points
export const POWER_SHOT_RANGE = 8;        // metres — distance threshold for power-shot eligibility
export const POWER_SHOT_POINTS = 2;       // points for a power shot
export const NORMAL_GOAL_POINTS = 1;      // points for a normal goal
export const DEFAULT_RESPAWN_DELAY = 3; // seconds — fast respawn keeps Goal Rush's pace up

// Goal mouth sizing as a fraction of the arena's own width/height so every map
// (from tiny esport_arena to mega_pinball) gets a proportionate goal.
const GOAL_WIDTH_RATIO = 0.32;
const GOAL_HEIGHT_RATIO = 0.42;
const MIN_GOAL_WIDTH = 5;
const MIN_GOAL_HEIGHT = 4;
const GOAL_INSET_RATIO = 0.035; // how far the goal mouth sits in from the back boundary
const GOAL_DEPTH_RATIO = 0.045; // trigger-volume thickness along the court's long axis

export const DEFAULT_GOAL_RUSH_MUTATORS = Object.freeze({
    goalRush: true,
    scoreToWin: DEFAULT_SCORE_TO_WIN,
    respawnDelay: DEFAULT_RESPAWN_DELAY
});

function clamp(value, lo, hi) {
    if (!Number.isFinite(value)) return lo;
    if (hi < lo) return lo;
    return Math.min(hi, Math.max(lo, value));
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

// Normalizes an arbitrary bounds-like object (e.g. arena.getArenaBounds() output)
// into a validated {minX,maxX,minY,maxY,minZ,maxZ}, or null if unusable.
function normalizeBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') return null;
    const minX = finiteOr(Number(bounds.minX), null);
    const maxX = finiteOr(Number(bounds.maxX), null);
    const minZ = finiteOr(Number(bounds.minZ), null);
    const maxZ = finiteOr(Number(bounds.maxZ), null);
    if (minX === null || maxX === null || minZ === null || maxZ === null) return null;
    if (maxX <= minX || maxZ <= minZ) return null;
    const minY = finiteOr(Number(bounds.minY), 0);
    const maxYRaw = finiteOr(Number(bounds.maxY), minY + 20);
    const maxY = maxYRaw > minY ? maxYRaw : minY + 20;
    return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Derives red/blue goal zones (axis-aligned trigger boxes) from arena bounds.
 * Purely geometric — works for any map's size/bounds, no per-map hardcoding.
 * Returns { red: zone, blue: zone } or null if bounds are unusable.
 */
export function computeGoalZones(bounds, options = {}) {
    const b = normalizeBounds(bounds);
    if (!b) return null;

    const width = b.maxX - b.minX;
    const depth = b.maxZ - b.minZ;
    const height = b.maxY - b.minY;
    const centerX = (b.minX + b.maxX) / 2;

    const goalWidth = clamp(
        Number.isFinite(options.goalWidth) ? options.goalWidth : width * GOAL_WIDTH_RATIO,
        Math.min(MIN_GOAL_WIDTH, width * 0.9),
        width * 0.9
    );
    const goalHeight = clamp(
        Number.isFinite(options.goalHeight) ? options.goalHeight : height * GOAL_HEIGHT_RATIO,
        Math.min(MIN_GOAL_HEIGHT, height * 0.9 || MIN_GOAL_HEIGHT),
        height * 0.9 || MIN_GOAL_HEIGHT
    );
    const inset = clamp(
        Number.isFinite(options.goalInset) ? options.goalInset : depth * GOAL_INSET_RATIO,
        0.5,
        depth / 2 - 0.5
    );
    const halfDepth = clamp(
        (Number.isFinite(options.goalDepth) ? options.goalDepth : depth * GOAL_DEPTH_RATIO) / 2,
        0.5,
        depth / 2
    );

    const halfWidth = goalWidth / 2;
    const zoneMinY = b.minY;
    const zoneMaxY = Math.min(b.maxY, b.minY + goalHeight);

    const makeZone = (team, mouthZ) => {
        const minZ = Math.max(b.minZ, mouthZ - halfDepth);
        const maxZ = Math.min(b.maxZ, mouthZ + halfDepth);
        return {
            team,
            minX: centerX - halfWidth,
            maxX: centerX + halfWidth,
            minY: zoneMinY,
            maxY: zoneMaxY,
            minZ,
            maxZ,
            center: { x: centerX, y: (zoneMinY + zoneMaxY) / 2, z: mouthZ }
        };
    };

    // Floor layout (see arena.js buildFloor): red occupies z < 0, blue occupies z > 0.
    // Each team's goal sits at its own back line — the enemy scores by reaching it.
    return {
        red: makeZone('red', b.minZ + inset),
        blue: makeZone('blue', b.maxZ - inset)
    };
}

/** True if `position` ({x,y,z}) lies inside `zone` (inclusive boundary). Hostile-input safe. */
export function isInsideGoal(position, zone) {
    if (!position || !zone) return false;
    const { x, y, z } = position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (!Number.isFinite(zone.minX) || !Number.isFinite(zone.maxX)
        || !Number.isFinite(zone.minY) || !Number.isFinite(zone.maxY)
        || !Number.isFinite(zone.minZ) || !Number.isFinite(zone.maxZ)) return false;
    return x >= zone.minX && x <= zone.maxX
        && y >= zone.minY && y <= zone.maxY
        && z >= zone.minZ && z <= zone.maxZ;
}

/**
 * Checks a ball position against both goal zones. Scoring is zone-based, not
 * shooter-based, so own goals (ball ends up in your own team's zone, whoever
 * last touched it) are handled automatically: the OTHER team is credited.
 * Returns { scored, scoringTeam, concededTeam, zone } — scored:false on no
 * entry or on hostile/missing input, never throws.
 */
export function checkGoalEntry(position, zones, options = {}) {
    const none = { scored: false, scoringTeam: null, concededTeam: null, zone: null, points: null, powerShot: false };
    if (!zones) return none;
    for (const team of ['red', 'blue']) {
        const zone = zones[team];
        if (zone && isInsideGoal(position, zone)) {
            // Power shot needs a known shot origin; the ball's entry position is
            // inside the zone by definition, so falling back to it would make every
            // goal a power shot. Unknown origin = safe default of 1 point.
            const points = options.shotOrigin ? goalShotPoints(options.shotOrigin, zone) : NORMAL_GOAL_POINTS;
            const powerShot = points === POWER_SHOT_POINTS;
            return {
                scored: true,
                scoringTeam: team === 'red' ? 'blue' : 'red',
                concededTeam: team,
                zone,
                points,
                powerShot
            };
        }
    }
    return none;
}

/**
 * Allocation-free variant of checkGoalEntry() for per-frame callers (js/game.js runs
 * this every frame, so returning a fresh result object there would churn the GC).
 * Same own-goal credit rule: the team whose zone was entered never scores.
 * Returns 'red' | 'blue' | null. Hostile/missing input yields null, never throws.
 */
export function goalScoringTeam(position, zones) {
    if (!zones) return null;
    if (isInsideGoal(position, zones.red)) return 'blue';
    if (isInsideGoal(position, zones.blue)) return 'red';
    return null;
}

/**
 * Calculate goal points based on shot distance from goal centre.
 * Power shot (closer than POWER_SHOT_RANGE) = 2 points.
 * Otherwise = 1 point.
 * @param {Object} position - Ball position {x, y, z}
 * @param {Object} zone - Goal zone {center: {x, y, z}, ...}
 * @returns {number} Points: 2 for power shot, 1 for normal goal
 */
export function goalShotPoints(position, zone) {
    if (!position || !zone || !zone.center) return NORMAL_GOAL_POINTS;
    const dx = position.x - zone.center.x;
    const dz = position.z - zone.center.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return distance < POWER_SHOT_RANGE ? POWER_SHOT_POINTS : NORMAL_GOAL_POINTS;
}

/** Fresh Goal Rush match state. `timeLimit` in seconds; null/undefined disables the clock win condition. */
export function createGoalRushState(options = {}) {
    const scoreToWin = Number.isFinite(options.scoreToWin) && options.scoreToWin > 0
        ? options.scoreToWin : DEFAULT_SCORE_TO_WIN;
    const respawnDelay = Number.isFinite(options.respawnDelay) && options.respawnDelay >= 0
        ? options.respawnDelay : DEFAULT_RESPAWN_DELAY;
    const timeLimit = Number.isFinite(options.timeLimit) && options.timeLimit > 0
        ? options.timeLimit : null;
    return {
        modeId: GOAL_RUSH_MODE_ID,
        scoreToWin,
        respawnDelay,
        timeLimit,
        redScore: 0,
        blueScore: 0,
        elapsed: 0,
        lastScoringTeam: null,
        goalHistory: [],
        over: false,
        winner: null,
        endReason: null
    };
}

function evaluateGoalRushState(state) {
    if (state.over) return state;
    if (state.redScore >= state.scoreToWin) {
        return { ...state, over: true, winner: 'red', endReason: 'score' };
    }
    if (state.blueScore >= state.scoreToWin) {
        return { ...state, over: true, winner: 'blue', endReason: 'score' };
    }
    if (Number.isFinite(state.timeLimit) && state.elapsed >= state.timeLimit) {
        const winner = state.redScore === state.blueScore
            ? 'draw'
            : (state.redScore > state.blueScore ? 'red' : 'blue');
        return { ...state, over: true, winner, endReason: 'time' };
    }
    return state;
}

/**
 * Records a goal for `scoringTeam` ('red'|'blue'). Pure — returns a new state,
 * never mutates the input. Invalid team or an already-finished match is a no-op
 * that returns the original state unchanged (never throws).
 */
export function applyGoalScore(state, scoringTeam, meta = {}) {
    if (!state || state.over) return state;
    if (scoringTeam !== 'red' && scoringTeam !== 'blue') return state;
    const points = Number.isFinite(meta.points) && meta.points > 0 ? meta.points : NORMAL_GOAL_POINTS;
    const historyEntry = {
        team: scoringTeam,
        at: Number.isFinite(meta.at) ? meta.at : state.elapsed,
        scorerName: meta.scorerName ?? null,
        ownGoal: !!meta.ownGoal,
        points
    };
    const next = {
        ...state,
        redScore: state.redScore + (scoringTeam === 'red' ? points : 0),
        blueScore: state.blueScore + (scoringTeam === 'blue' ? points : 0),
        lastScoringTeam: scoringTeam,
        goalHistory: [...state.goalHistory, historyEntry]
    };
    return evaluateGoalRushState(next);
}

/** Advances the match clock by `dt` seconds and re-checks the time-limit win condition. */
export function advanceGoalRushClock(state, dt) {
    if (!state || state.over) return state;
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    return evaluateGoalRushState({ ...state, elapsed: state.elapsed + safeDt });
}
/** Convenience: run a ball position through the zones + scoring pipeline in one call. */
export function resolveGoalRushTick(state, ballPosition, zones, meta = {}) {
    if (!state) return { state, entry: { scored: false, scoringTeam: null, concededTeam: null, zone: null, points: null } };
    const entry = checkGoalEntry(ballPosition, zones, meta);
    if (!entry.scored) return { state, entry };
    const ownGoal = meta.shooterTeam ? meta.shooterTeam === entry.concededTeam : false;
    // An own goal is a gift, not a skill shot: never award the power-shot bonus for it.
    const points = ownGoal ? NORMAL_GOAL_POINTS : entry.points;
    const nextState = applyGoalScore(state, entry.scoringTeam, { ...meta, ownGoal, points });
    return { state: nextState, entry };
}
