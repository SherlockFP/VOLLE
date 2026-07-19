const SAMPLE_INTERVAL = 100;
const MAX_SAMPLES = 750;

// Courses stay disabled until dedicated maps are ready.
export const MOVEMENT_TRIALS = Object.freeze({});

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const point = value => ({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });
const lerp = (a, b, alpha) => a + (b - a) * alpha;

export function getGhostPoint(samples = [], elapsed = 0) {
    if (!samples.length) return null;
    let nextIndex = samples.findIndex(sample => sample.t >= elapsed);
    if (nextIndex < 0) return point(samples.at(-1));
    if (nextIndex === 0) return point(samples[0]);
    const previous = samples[nextIndex - 1];
    const next = samples[nextIndex];
    const span = Math.max(1, next.t - previous.t);
    const alpha = Math.min(1, Math.max(0, (elapsed - previous.t) / span));
    return {
        x: lerp(previous.x, next.x, alpha),
        y: lerp(previous.y, next.y, alpha),
        z: lerp(previous.z, next.z, alpha)
    };
}

export class MovementTrialClass {
    constructor(options = {}) {
        this._now = options.now || (() => performance.now());
        this.active = null;
    }

    start(trialId, startPosition, best = null) {
        const trial = MOVEMENT_TRIALS[trialId];
        if (!trial) return null;
        const origin = point(startPosition);
        this.active = {
            trial,
            origin,
            previous: origin,
            startedAt: this._now(),
            lastSampleAt: -Infinity,
            distance: 0,
            airMs: 0,
            peakSpeed: 0,
            rocketJumps: 0,
            samples: [{ t: 0, x: 0, y: 0, z: 0 }],
            best
        };
        return this.getState();
    }

    addRocketJump() {
        if (this.active) this.active.rocketJumps++;
    }

    update(position, options = {}) {
        const run = this.active;
        if (!run) return null;
        const now = this._now();
        const elapsed = now - run.startedAt;
        const current = point(position);
        run.distance += Math.hypot(
            current.x - run.previous.x,
            current.y - run.previous.y,
            current.z - run.previous.z
        );
        run.previous = current;
        if (!options.onGround) run.airMs += Math.max(0, finite(options.dt) * 1000);
        run.peakSpeed = Math.max(run.peakSpeed, finite(options.speed));
        if (now - run.lastSampleAt >= SAMPLE_INTERVAL && run.samples.length < MAX_SAMPLES) {
            run.lastSampleAt = now;
            run.samples.push({
                t: Math.round(elapsed),
                x: current.x - run.origin.x,
                y: current.y - run.origin.y,
                z: current.z - run.origin.z
            });
        }
        const requirementsMet = run.airMs >= (run.trial.requiredAirMs || 0)
            && run.peakSpeed >= (run.trial.requiredPeakSpeed || 0)
            && run.rocketJumps >= (run.trial.requiredRocketJumps || 0);
        if (run.distance >= run.trial.targetDistance && requirementsMet) {
            return this._finish('completed', elapsed);
        }
        if (elapsed >= run.trial.timeLimit) return this._finish('failed', elapsed);
        return this.getState();
    }

    _finish(status, elapsed) {
        const result = {
            ...this.getState(),
            status,
            active: false,
            elapsed: Math.round(elapsed),
            record: {
                trialId: this.active.trial.id,
                time: Math.round(elapsed),
                distance: Math.round(this.active.distance * 10) / 10,
                peakSpeed: Math.round(this.active.peakSpeed * 10) / 10,
                rocketJumps: this.active.rocketJumps,
                samples: this.active.samples
            }
        };
        this.active = null;
        return result;
    }

    getState() {
        if (!this.active) return null;
        const elapsed = this._now() - this.active.startedAt;
        return {
            active: true,
            status: 'running',
            trial: this.active.trial,
            origin: this.active.origin,
            elapsed: Math.round(elapsed),
            distance: this.active.distance,
            airMs: this.active.airMs,
            peakSpeed: this.active.peakSpeed,
            rocketJumps: this.active.rocketJumps,
            ghost: getGhostPoint(this.active.best?.samples, elapsed)
        };
    }

    cancel() {
        const wasActive = Boolean(this.active);
        this.active = null;
        return wasActive;
    }
}
