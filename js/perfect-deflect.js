import { pointSegmentDistanceSq } from './combat.js';

// Deflect tiers are graded by click lead: how many ms before the ball would
// have reached the defender's body capsule the swing was started. Fixed ms at
// every ball speed. `normal` bounds the lead that still counts as a timed
// swing (the host accepts a remote swing-age hint up to this value).
export const DEFLECT_TIMING_WINDOWS = Object.freeze({
    perfect: 60,
    great: 140,
    normal: 400
});

// Host-side bounds for the client's `sa` (swing age, integer ms) attack hint.
// Anything outside 0..acceptMaxMs is ignored (tier falls back to normal);
// accepted values are clamped to clampMaxMs (just above the 220 ms swing).
export const REMOTE_SWING_AGE_LIMITS = Object.freeze({
    acceptMaxMs: 400,
    clampMaxMs: 240
});

export const DEFLECT_CHAIN_RULES = Object.freeze({
    timeoutMs: 2000,
    cap: 5
});

export const DEFLECT_REWARDS = Object.freeze({
    normal: Object.freeze({ scoreMultiplier: 1, xpBonus: 0, homingMultiplier: 1 }),
    great: Object.freeze({ scoreMultiplier: 1.25, xpBonus: 5, homingMultiplier: 1 }),
    perfect: Object.freeze({ scoreMultiplier: 1.5, xpBonus: 10, homingMultiplier: 1 })
});

const TIERS = new Set(['normal', 'great', 'perfect']);

function finite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be finite`);
    }
    return value;
}

function nonNegative(value, name) {
    const number = finite(value, name);
    if (number < 0) throw new RangeError(`${name} must be non-negative`);
    return number;
}

function timingWindows(windows) {
    const perfect = nonNegative(windows?.perfect, 'perfect window');
    const great = nonNegative(windows?.great, 'great window');
    const normal = nonNegative(windows?.normal, 'normal window');
    if (perfect > great || great > normal) {
        throw new RangeError('timing windows must be ordered');
    }
    return { perfect, great, normal };
}

function chainRules(rules) {
    const timeoutMs = nonNegative(rules?.timeoutMs, 'chain timeout');
    const cap = nonNegative(rules?.cap, 'chain cap');
    if (!Number.isInteger(cap)) throw new TypeError('chain cap must be an integer');
    return { timeoutMs, cap };
}

function tierName(tier) {
    if (!TIERS.has(tier)) throw new TypeError('invalid deflect tier');
    return tier;
}

function round(value) {
    return Math.round(value * 100) / 100;
}

export function classifyDeflectTiming(timingErrorMs, windows = DEFLECT_TIMING_WINDOWS) {
    const error = Math.abs(finite(timingErrorMs, 'timing error'));
    const bounds = timingWindows(windows);
    if (error <= bounds.perfect) return 'perfect';
    if (error <= bounds.great) return 'great';
    if (error <= bounds.normal) return 'normal';
    return null;
}

// Click-lead tier: PERFECT 0..perfect ms, GREAT up to great ms, NORMAL beyond
// (or when no lead could be measured). A negative lead is treated as 0.
export function classifyDeflectLead(leadMs, windows = DEFLECT_TIMING_WINDOWS) {
    if (typeof leadMs !== 'number' || !Number.isFinite(leadMs)) return 'normal';
    const lead = leadMs < 0 ? 0 : leadMs;
    if (lead <= windows.perfect) return 'perfect';
    if (lead <= windows.great) return 'great';
    return 'normal';
}

const contactSegmentStart = { x: 0, y: 0, z: 0 };
const contactSegmentEnd = { x: 0, y: 0, z: 0 };

// Straight-line ms until the ball sphere would touch the G1 body capsule
// (vertical segment feetY..feetY+height at targetX/targetZ, inflated by
// capsuleRadius) at the current speed. 0 when already touching; Infinity when
// the ball is (nearly) stationary or any input is non-finite. Allocation-free.
export function predictContactMs(ballPos, ballSpeed, targetX, targetZ, feetY, height, capsuleRadius, ballRadius) {
    if (typeof ballSpeed !== 'number' || !Number.isFinite(ballSpeed) || ballSpeed <= 0.01) return Infinity;
    contactSegmentStart.x = targetX;
    contactSegmentStart.y = feetY;
    contactSegmentStart.z = targetZ;
    contactSegmentEnd.x = targetX;
    contactSegmentEnd.y = feetY + height;
    contactSegmentEnd.z = targetZ;
    const gap = Math.sqrt(pointSegmentDistanceSq(ballPos, contactSegmentStart, contactSegmentEnd))
        - (ballRadius + capsuleRadius);
    const ms = (gap > 0 ? gap : 0) / ballSpeed * 1000;
    return Number.isFinite(gap) && Number.isFinite(ms) ? ms : Infinity;
}

// Host validation of the client's swing-age hint: a finite integer in
// 0..acceptMaxMs, clamped to clampMaxMs. Anything else returns null (the host
// then grades the deflect NORMAL; accept/reject never depends on it).
export function sanitizeRemoteSwingAgeMs(swingAgeMs, limits = REMOTE_SWING_AGE_LIMITS) {
    if (typeof swingAgeMs !== 'number' || !Number.isInteger(swingAgeMs)) return null;
    if (swingAgeMs < 0 || swingAgeMs > limits.acceptMaxMs) return null;
    return swingAgeMs > limits.clampMaxMs ? limits.clampMaxMs : swingAgeMs;
}

export function updateDeflectChain(
    state = { count: 0, lastPerfectAt: null },
    tier,
    at,
    rules = DEFLECT_CHAIN_RULES
) {
    const now = nonNegative(at, 'deflect time');
    const limits = chainRules(rules);
    const count = nonNegative(state?.count ?? 0, 'chain count');
    if (!Number.isInteger(count)) throw new TypeError('chain count must be an integer');
    const last = state?.lastPerfectAt;

    if (tier !== 'perfect') {
        if (tier !== null) tierName(tier);
        return Object.freeze({ count: 0, lastPerfectAt: null });
    }
    if (last != null) {
        nonNegative(last, 'last perfect time');
        if (now < last) throw new RangeError('deflect time cannot move backwards');
    }

    const continues = last != null && now - last <= limits.timeoutMs;
    return Object.freeze({
        count: Math.min(limits.cap, continues ? count + 1 : 1),
        lastPerfectAt: now
    });
}

export function getDeflectReward(tier, chain = 0) {
    const name = tierName(tier);
    const chainCount = nonNegative(chain, 'chain count');
    if (!Number.isInteger(chainCount)) throw new TypeError('chain count must be an integer');
    const base = DEFLECT_REWARDS[name];
    return Object.freeze({
        ...base,
        chainBonus: name === 'perfect' ? Math.max(0, chainCount - 1) * 5 : 0
    });
}

// Pass `leadMs` (click lead, gameplay) to grade with classifyDeflectLead; the
// legacy `timingErrorMs` path keeps classifyDeflectTiming's contract.
export function resolvePerfectDeflect({
    leadMs,
    timingErrorMs,
    at,
    chain = { count: 0, lastPerfectAt: null },
    homingStrength = 0,
    windows = DEFLECT_TIMING_WINDOWS,
    chainRules: rules = DEFLECT_CHAIN_RULES
} = {}) {
    const homing = nonNegative(homingStrength, 'homing strength');
    const tier = leadMs !== undefined
        ? classifyDeflectLead(leadMs, windows)
        : classifyDeflectTiming(timingErrorMs, windows);
    const nextChain = updateDeflectChain(chain, tier, at, rules);
    return Object.freeze({
        tier,
        chain: nextChain,
        reward: tier ? getDeflectReward(tier, nextChain.count) : null,
        homingStrength: homing
    });
}

export function createPracticeMetrics() {
    return Object.freeze({
        attempts: 0,
        hits: 0,
        perfects: 0,
        reaction: null,
        reactionTotal: 0,
        reactionSamples: 0,
        avg: null,
        best: null,
        streak: 0,
        bestStreak: 0
    });
}

function validatedMetrics(state) {
    const attempts = nonNegative(state?.attempts ?? 0, 'attempts');
    const hits = nonNegative(state?.hits ?? 0, 'hits');
    const perfects = nonNegative(state?.perfects ?? 0, 'perfects');
    const reactionTotal = nonNegative(state?.reactionTotal ?? 0, 'reaction total');
    const reactionSamples = nonNegative(state?.reactionSamples ?? 0, 'reaction samples');
    const streak = nonNegative(state?.streak ?? 0, 'streak');
    const bestStreak = nonNegative(state?.bestStreak ?? 0, 'best streak');
    for (const [name, value] of Object.entries({
        attempts, hits, perfects, reactionSamples, streak, bestStreak
    })) {
        if (!Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
    }
    if (hits > attempts || perfects > hits || streak > hits || bestStreak > hits) {
        throw new RangeError('invalid practice metrics');
    }
    const reaction = state?.reaction == null
        ? null
        : nonNegative(state.reaction, 'reaction');
    const best = state?.best == null
        ? null
        : nonNegative(state.best, 'best reaction');
    if (!reactionSamples && (reactionTotal || reaction !== null || best !== null)) {
        throw new RangeError('invalid reaction metrics');
    }
    return {
        attempts,
        hits,
        perfects,
        reaction,
        reactionTotal,
        reactionSamples,
        streak,
        bestStreak,
        best
    };
}

export function recordPracticeAttempt(state = createPracticeMetrics(), attempt = {}) {
    const current = validatedMetrics(state);
    const tier = attempt.tier ?? null;
    if (tier !== null) tierName(tier);
    const hit = attempt.hit == null ? tier !== null : Boolean(attempt.hit);
    const reaction = attempt.reactionMs == null
        ? null
        : nonNegative(attempt.reactionMs, 'reaction time');
    const attempts = current.attempts + 1;
    const hits = current.hits + Number(hit);
    const perfects = current.perfects + Number(hit && tier === 'perfect');
    const streak = hit ? current.streak + 1 : 0;
    const reactionSamples = current.reactionSamples + Number(reaction !== null);
    const reactionTotal = current.reactionTotal + (reaction ?? 0);
    const best = reaction === null
        ? current.best
        : Math.min(current.best ?? Infinity, reaction);

    return Object.freeze({
        attempts,
        hits,
        perfects,
        reaction,
        reactionTotal,
        reactionSamples,
        avg: reactionSamples ? round(reactionTotal / reactionSamples) : null,
        best,
        streak,
        bestStreak: Math.max(current.bestStreak, streak)
    });
}

export function summarizePracticeMetrics(state = createPracticeMetrics()) {
    const current = validatedMetrics(state);
    return Object.freeze({
        attempts: current.attempts,
        hits: current.hits,
        perfects: current.perfects,
        reaction: current.reaction,
        accuracy: current.attempts ? round(current.hits / current.attempts * 100) : 0,
        avg: current.reactionSamples ? round(current.reactionTotal / current.reactionSamples) : null,
        best: current.best,
        streak: current.streak,
        bestStreak: current.bestStreak
    });
}

export class PracticeLabMetrics {
    constructor() {
        this._state = createPracticeMetrics();
    }

    recordAttempt(attempt) {
        this._state = recordPracticeAttempt(this._state, attempt);
        return this.summary();
    }

    record(attempt) {
        return this.recordAttempt(attempt);
    }

    summary() {
        return summarizePracticeMetrics(this._state);
    }

    getSummary() {
        return this.summary();
    }

    reset() {
        this._state = createPracticeMetrics();
        return this.summary();
    }
}
