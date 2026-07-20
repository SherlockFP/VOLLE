export const GUIDED_DRILL_COUNTDOWN_MS = 3000;
export const GUIDED_DRILL_TRANSITION_MS = 2000;
export const GUIDED_DRILL_TOTAL_MS = 73000;
export const GUIDED_DRILL_LANES = Object.freeze([0, -1, 1, 1, -1, 0]);

export const GUIDED_DRILL_STAGES = Object.freeze([
    Object.freeze({
        id: 'control',
        name: 'CONTROL',
        durationMs: 20000,
        speedStart: 0.7,
        speedEnd: 0.9,
        instruction: 'Read the serve and make clean contact.'
    }),
    Object.freeze({
        id: 'direction',
        name: 'DIRECTION',
        durationMs: 22000,
        speedStart: 0.9,
        speedEnd: 1.1,
        instruction: 'Aim the return through the marked gate.'
    }),
    Object.freeze({
        id: 'timing',
        name: 'TIMING',
        durationMs: 24000,
        speedStart: 1.1,
        speedEnd: 1.3,
        instruction: 'Contact inside the perfect timing window.'
    })
]);

const TIER_POINTS = Object.freeze({
    perfect: 1,
    great: 0.65,
    normal: 0.3,
    miss: 0
});

function freshStats(stage) {
    return {
        id: stage.id,
        name: stage.name,
        attempts: 0,
        hits: 0,
        directed: 0,
        perfect: 0,
        great: 0,
        normal: 0,
        misses: 0,
        timingPoints: 0
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function freezeSnapshot(value) {
    value.stages.forEach(Object.freeze);
    return Object.freeze(value);
}

export class GuidedDeflectDrill {
    constructor() {
        this.reset();
    }

    get active() {
        return ['countdown', 'stage', 'transition'].includes(this.phase);
    }

    reset() {
        this.phase = 'idle';
        this.stageIndex = 0;
        this.phaseElapsedMs = 0;
        this.runElapsedMs = 0;
        this.attemptSeq = 0;
        this.openAttemptId = null;
        this.attemptRemainingMs = 0;
        this.nextServeInMs = 0;
        this.currentLane = 0;
        this.laneIndex = 0;
        this.stages = GUIDED_DRILL_STAGES.map(freshStats);
    }

    arm() {
        this.reset();
        this.phase = 'armed';
        return this.snapshot();
    }

    start() {
        if (this.phase !== 'armed') return { accepted: false, reason: 'not-armed' };
        this.phase = 'countdown';
        return { accepted: true, snapshot: this.snapshot() };
    }

    cancel() {
        if (this.phase === 'idle') return this.snapshot();
        this.phase = 'cancelled';
        this.openAttemptId = null;
        this.attemptRemainingMs = 0;
        return this.snapshot();
    }

    openAttempt({ timeoutMs = 3500 } = {}) {
        if (this.phase !== 'stage' || this.openAttemptId !== null || this.nextServeInMs > 0) {
            return { accepted: false, reason: 'not-ready' };
        }
        if (!Number.isFinite(timeoutMs)) return { accepted: false, reason: 'invalid-timeout' };
        this.openAttemptId = ++this.attemptSeq;
        this.attemptRemainingMs = clamp(timeoutMs, 2200, 5000);
        this.currentLane = GUIDED_DRILL_LANES[this.laneIndex % GUIDED_DRILL_LANES.length];
        this.laneIndex++;
        return {
            accepted: true,
            attemptId: this.openAttemptId,
            lane: this.currentLane,
            timeoutMs: this.attemptRemainingMs
        };
    }

    resolveAttempt({
        attemptId,
        hit = false,
        tier = 'normal',
        directionErrorDeg = null
    } = {}) {
        if (attemptId !== this.openAttemptId || this.phase !== 'stage') {
            return { accepted: false, reason: 'stale-attempt' };
        }
        if (typeof hit !== 'boolean') return { accepted: false, reason: 'invalid-hit' };
        const safeTier = hit && Object.hasOwn(TIER_POINTS, tier) ? tier : hit ? 'normal' : 'miss';
        const safeDirection = Number.isFinite(directionErrorDeg)
            ? clamp(directionErrorDeg, 0, 180)
            : null;
        this._recordAttempt(hit, safeTier, safeDirection);
        return { accepted: true, snapshot: this.snapshot() };
    }

    advance(dtMs) {
        if (!Number.isFinite(dtMs) || dtMs < 0) {
            return { accepted: false, reason: 'invalid-delta' };
        }
        let remaining = dtMs;
        while (remaining > 0 && this.active) {
            if (this.phase === 'stage'
                && this.openAttemptId === null
                && this.nextServeInMs <= 0) {
                break;
            }
            const phaseRemaining = this._phaseDuration() - this.phaseElapsedMs;
            let step = Math.min(remaining, phaseRemaining);
            if (this.phase === 'stage' && this.openAttemptId !== null) {
                step = Math.min(step, this.attemptRemainingMs);
            } else if (this.phase === 'stage' && this.nextServeInMs > 0) {
                step = Math.min(step, this.nextServeInMs);
            }
            if (step <= 0) {
                this._processBoundary();
                continue;
            }
            this.phaseElapsedMs += step;
            this.runElapsedMs += step;
            remaining -= step;
            if (this.phase === 'stage' && this.openAttemptId !== null) {
                this.attemptRemainingMs -= step;
            } else if (this.phase === 'stage' && this.nextServeInMs > 0) {
                this.nextServeInMs = Math.max(0, this.nextServeInMs - step);
            }
            this._processBoundary();
        }
        return {
            accepted: true,
            consumedMs: dtMs - remaining,
            remainingMs: remaining,
            snapshot: this.snapshot()
        };
    }

    _phaseDuration() {
        if (this.phase === 'countdown') return GUIDED_DRILL_COUNTDOWN_MS;
        if (this.phase === 'transition') return GUIDED_DRILL_TRANSITION_MS;
        if (this.phase === 'stage') return GUIDED_DRILL_STAGES[this.stageIndex].durationMs;
        return 0;
    }

    _processBoundary() {
        if (this.phase === 'stage' && this.openAttemptId !== null && this.attemptRemainingMs <= 0) {
            this._recordAttempt(false, 'miss', null);
        }
        if (this.phaseElapsedMs < this._phaseDuration()) return;
        if (this.phase === 'countdown') {
            this.phase = 'stage';
            this.phaseElapsedMs = 0;
            this.nextServeInMs = 0;
            return;
        }
        if (this.phase === 'stage') {
            if (this.openAttemptId !== null) this._recordAttempt(false, 'miss', null);
            this.phaseElapsedMs = 0;
            if (this.stageIndex === GUIDED_DRILL_STAGES.length - 1) {
                this.phase = 'complete';
            } else {
                this.phase = 'transition';
            }
            return;
        }
        if (this.phase === 'transition') {
            this.stageIndex++;
            this.phase = 'stage';
            this.phaseElapsedMs = 0;
            this.nextServeInMs = 0;
        }
    }

    _recordAttempt(hit, tier, directionErrorDeg) {
        const stats = this.stages[this.stageIndex];
        stats.attempts++;
        if (hit) stats.hits++;
        else stats.misses++;
        if (tier === 'perfect') stats.perfect++;
        else if (tier === 'great') stats.great++;
        else if (tier === 'normal' && hit) stats.normal++;
        stats.timingPoints += TIER_POINTS[tier] || 0;
        if (hit && this.stageIndex === 1 && directionErrorDeg !== null && directionErrorDeg <= 15) {
            stats.directed++;
        }
        this.openAttemptId = null;
        this.attemptRemainingMs = 0;
        this.nextServeInMs = 600;
    }

    _stageResult(stats) {
        const attempts = Math.max(1, stats.attempts);
        const hitRate = stats.hits / attempts;
        let score = hitRate * 100;
        let passed = stats.hits >= 5 && hitRate >= 0.65;
        if (stats.id === 'direction') {
            score = hitRate * 40 + stats.directed / attempts * 60;
            passed = stats.directed >= 4;
        } else if (stats.id === 'timing') {
            score = stats.timingPoints / attempts * 100;
            passed = stats.perfect >= 3;
        }
        return Object.freeze({
            ...stats,
            score: Math.round(clamp(score, 0, 100)),
            passed
        });
    }

    result() {
        const stages = this.stages.map(stats => this._stageResult(stats));
        const score = Math.round(
            stages[0].score * 0.3
            + stages[1].score * 0.35
            + stages[2].score * 0.35
        );
        const allPassed = stages.every(stage => stage.passed);
        const grade = score >= 90 && allPassed
            ? 'S'
            : score >= 80
                ? 'A'
                : score >= 70
                    ? 'B'
                    : score >= 60
                        ? 'C'
                        : 'D';
        return freezeSnapshot({ score, grade, allPassed, stages });
    }

    snapshot() {
        const stage = GUIDED_DRILL_STAGES[this.stageIndex] || GUIDED_DRILL_STAGES.at(-1);
        const nextStage = this.phase === 'transition'
            ? GUIDED_DRILL_STAGES[this.stageIndex + 1] || null
            : null;
        const progress = this.phase === 'stage'
            ? clamp(this.phaseElapsedMs / stage.durationMs, 0, 1)
            : 0;
        const speedStage = nextStage || stage;
        const speedMultiplier = speedStage.speedStart
            + (speedStage.speedEnd - speedStage.speedStart) * progress;
        const stats = this.stages[this.stageIndex] || this.stages.at(-1);
        return freezeSnapshot({
            phase: this.phase,
            active: this.active,
            complete: this.phase === 'complete',
            stageIndex: this.stageIndex,
            stageCount: GUIDED_DRILL_STAGES.length,
            stage: Object.freeze({ ...stage }),
            nextStage: nextStage ? Object.freeze({ ...nextStage }) : null,
            phaseElapsedMs: this.phaseElapsedMs,
            phaseRemainingMs: Math.max(0, this._phaseDuration() - this.phaseElapsedMs),
            runElapsedMs: this.runElapsedMs,
            totalRemainingMs: Math.max(0, GUIDED_DRILL_TOTAL_MS - this.runElapsedMs),
            speedMultiplier,
            openAttemptId: this.openAttemptId,
            needsServe: this.phase === 'stage'
                && this.openAttemptId === null
                && this.nextServeInMs <= 0,
            lane: this.currentLane,
            stats: Object.freeze({ ...stats }),
            stages: this.stages.map(item => ({ ...item }))
        });
    }
}
