// net-interp.js — snapshot interpolation for remote entities + ball prediction helpers.
//
// Remote players/bots (RemoteInterp):
//   - samples are keyed by the SENDER's host-clock stamp, not by arrival time, so network
//     jitter never shows up as motion jitter; out-of-order samples are inserted in place;
//   - the render time runs `delay` behind host-now, where delay = mean transit (arrival −
//     stamp, which also absorbs any clock-offset error) + an adaptive margin derived from the
//     measured packet interval and jitter. The delay slews (never jumps) — slow-motion up to
//     0.75× to grow the buffer, 1.05× to shrink it;
//   - between samples: cubic Hermite with the packet velocities as tangents when they agree
//     with the observed motion (Catmull-Rom style centred differences otherwise, e.g. a
//     player pushing into a wall reports velocity but does not move);
//   - past the newest sample: bounded linear extrapolation, then hold;
//   - when a new sample changes the path under the current render time, the visible jump is
//     moved into an error offset that decays exponentially (no snap) unless it is huge
//     (respawn / teleport).
// Zero allocations per frame: samples are pooled, outputs are reused objects.

export const INTERP_DEFAULTS = Object.freeze({
    minExtraMs: 35,
    maxExtraMs: 250,
    maxExtrapolateMs: 100,
    errorTauMs: 90,
    snapDistance: 5,
    capacity: 24,
    holdGapMs: 250,
    idleSpeed: 0.3,
    transitAlpha: 0.1,
    jitterAlpha: 0.1,
    intervalAlpha: 0.2,
    resyncMs: 1000,
    slowdown: 0.25,
    speedup: 0.05
});

const TWO_PI = Math.PI * 2;

function wrapAngle(angle) {
    return angle - TWO_PI * Math.floor((angle + Math.PI) / TWO_PI);
}

function tangentAxis(sample, prev, next, fdx, fdy, fdz, out) {
    let cx = fdx, cy = fdy, cz = fdz;
    if (prev && next && next.time > prev.time) {
        const inv = 1000 / (next.time - prev.time);
        cx = (next.x - prev.x) * inv;
        cy = (next.y - prev.y) * inv;
        cz = (next.z - prev.z) * inv;
    }
    if (sample.hasVel) {
        const dx = sample.vx - cx, dy = sample.vy - cy, dz = sample.vz - cz;
        const tolerance = Math.max(1.5, 0.5 * Math.hypot(cx, cy, cz));
        if (dx * dx + dy * dy + dz * dz <= tolerance * tolerance) {
            out.x = sample.vx; out.y = sample.vy; out.z = sample.vz;
            return out;
        }
    }
    out.x = cx; out.y = cy; out.z = cz;
    return out;
}

export class RemoteInterp {
    constructor(options = {}) {
        this.o = { ...INTERP_DEFAULTS, ...options };
        this.samples = [];
        this._pool = [];
        this.out = { x: 0, y: 0, z: 0, ry: 0 };
        this.err = { x: 0, y: 0, z: 0 };
        this.transit = null;
        this.jitter = 0;
        this.interval = 50;
        this.delay = null;
        this.lastRenderTime = null;
        this.mode = 'empty';
        this._carryOut = false;
        this.stats = { pushed: 0, late: 0, snaps: 0, dup: 0, frames: 0, extrap: 0 };
        this._ta = { x: 0, y: 0, z: 0 };
        this._tb = { x: 0, y: 0, z: 0 };
        this._before = { x: 0, y: 0, z: 0, ry: 0 };
        this._after = { x: 0, y: 0, z: 0, ry: 0 };
    }

    get extraMs() {
        return this.delay === null ? 0 : this.delay - (this.transit || 0);
    }

    _alloc() {
        return this._pool.pop() || { time: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ry: 0, hasVel: false };
    }

    _clear() {
        while (this.samples.length) this._pool.push(this.samples.pop());
        this.err.x = this.err.y = this.err.z = 0;
    }

    reset() {
        this._clear();
        this.transit = null;
        this.jitter = 0;
        this.delay = null;
        this.lastRenderTime = null;
        this.mode = 'empty';
        this._carryOut = false;
    }

    // The receiver's host-clock estimate jumped (clock resync / new host): drop the old
    // timeline but keep the last rendered position, so the next sample is blended in
    // through the decaying error offset instead of popping.
    resetTimeline() {
        const hadOutput = this.lastRenderTime !== null;
        this.reset();
        this._carryOut = hadOutput;
    }

    _insert(sample) {
        const s = this.samples;
        let index = s.length;
        while (index > 0 && s[index - 1].time > sample.time) index--;
        s.splice(index, 0, sample);
        if (s.length > this.o.capacity) this._pool.push(s.shift());
    }

    // time: sender stamp (host clock ms). arrival: receiver host-clock ms at arrival.
    push(time, arrival, x, y, z, vx = 0, vy = 0, vz = 0, ry = undefined, hasVel = false) {
        if (!Number.isFinite(time) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 'invalid';
        if (!Number.isFinite(arrival)) arrival = time;
        const o = this.o;
        const transit = arrival - time;
        if (this.transit === null || Math.abs(transit - this.transit) > o.resyncMs) {
            // First sample, or the sender's timeline moved (host migration / clock resync):
            // never mix timelines inside one buffer.
            if (this.transit !== null) {
                this._carryOut = this.lastRenderTime !== null;
                this._clear();
                this.delay = null;
                this.lastRenderTime = null;
            }
            this.transit = transit;
            this.jitter = 0;
        } else {
            const deviation = transit - this.transit;
            this.jitter += (Math.abs(deviation) - this.jitter) * o.jitterAlpha;
            this.transit += deviation * o.transitAlpha;
        }
        const s = this.samples;
        for (let i = s.length - 1; i >= 0 && i >= s.length - 4; i--) {
            if (Math.abs(s[i].time - time) < 0.5) { this.stats.dup++; return 'dup'; }
        }
        this.stats.pushed++;
        if (this.lastRenderTime !== null && time < this.lastRenderTime) this.stats.late++;
        const sample = this._alloc();
        sample.time = time;
        sample.x = x; sample.y = y; sample.z = z;
        sample.hasVel = hasVel === true && Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz);
        sample.vx = sample.hasVel ? vx : 0;
        sample.vy = sample.hasVel ? vy : 0;
        sample.vz = sample.hasVel ? vz : 0;
        const newest = s[s.length - 1];
        sample.ry = Number.isFinite(ry) ? ry : (newest ? newest.ry : 0);
        if (newest && time > newest.time) {
            const gap = time - newest.time;
            if (gap <= o.holdGapMs) this.interval += (gap - this.interval) * o.intervalAlpha;
            const dx = x - newest.x, dy = y - newest.y, dz = z - newest.z;
            if (dx * dx + dy * dy + dz * dz > o.snapDistance * o.snapDistance) {
                // Respawn / teleport: restart the buffer at the new position (no smear).
                this._clear();
                this._carryOut = false;
                this.samples.push(sample);
                this.stats.snaps++;
                return 'snap';
            }
            // Idle senders skip packets while standing still. Without a hold sample the
            // first moving packet would be smeared across the whole silent gap.
            if (gap > Math.max(o.holdGapMs, 3 * this.interval) && newest.hasVel
                && Math.hypot(newest.vx, newest.vy, newest.vz) < o.idleSpeed) {
                const hold = this._alloc();
                hold.time = time - Math.min(this.interval, gap / 2);
                hold.x = newest.x; hold.y = newest.y; hold.z = newest.z;
                hold.vx = hold.vy = hold.vz = 0;
                hold.hasVel = true;
                hold.ry = newest.ry;
                this._insert(hold);
            }
        }
        const measure = this.lastRenderTime !== null && s.length > 0;
        if (measure) this._sampleInto(this.lastRenderTime, this._before, 1);
        this._insert(sample);
        if (this._carryOut && s.length === 1) {
            this._carryOut = false;
            const err = this.err;
            err.x = this.out.x - x; err.y = this.out.y - y; err.z = this.out.z - z;
            if (err.x * err.x + err.y * err.y + err.z * err.z > o.snapDistance * o.snapDistance) {
                err.x = err.y = err.z = 0;
            }
        }
        if (measure) {
            this._sampleInto(this.lastRenderTime, this._after, 1);
            const err = this.err;
            err.x += this._before.x - this._after.x;
            err.y += this._before.y - this._after.y;
            err.z += this._before.z - this._after.z;
            if (err.x * err.x + err.y * err.y + err.z * err.z > o.snapDistance * o.snapDistance) {
                err.x = err.y = err.z = 0;
            }
        }
        return 'ok';
    }

    // Raw trajectory sample (no error offset). Returns the mode used.
    _sampleInto(renderTime, out, strength) {
        const s = this.samples;
        const n = s.length;
        if (!n) return 'empty';
        if (renderTime <= s[0].time) {
            const a = s[0];
            out.x = a.x; out.y = a.y; out.z = a.z; out.ry = a.ry;
            return 'wait';
        }
        const newest = s[n - 1];
        if (renderTime >= newest.time) {
            const ahead = renderTime - newest.time;
            const dt = Math.min(ahead, this.o.maxExtrapolateMs) / 1000 * strength;
            let vx = 0, vy = 0, vz = 0;
            if (n >= 2) {
                const prev = s[n - 2];
                const h = (newest.time - prev.time) / 1000;
                if (h > 0) {
                    const v = tangentAxis(newest, null, null,
                        (newest.x - prev.x) / h, (newest.y - prev.y) / h, (newest.z - prev.z) / h, this._ta);
                    vx = v.x; vy = v.y; vz = v.z;
                }
            } else if (newest.hasVel) {
                vx = newest.vx; vy = newest.vy; vz = newest.vz;
            }
            out.x = newest.x + vx * dt;
            out.y = newest.y + vy * dt;
            out.z = newest.z + vz * dt;
            out.ry = newest.ry;
            return ahead > this.o.maxExtrapolateMs ? 'hold' : 'extrap';
        }
        let i = n - 2;
        while (i > 0 && s[i].time > renderTime) i--;
        const a = s[i];
        const b = s[i + 1];
        const spanMs = b.time - a.time;
        const u = spanMs > 0 ? (renderTime - a.time) / spanMs : 1;
        const h = spanMs / 1000;
        const fdx = (b.x - a.x) / h, fdy = (b.y - a.y) / h, fdz = (b.z - a.z) / h;
        const ma = tangentAxis(a, s[i - 1] || null, s[i - 1] ? b : null, fdx, fdy, fdz, this._ta);
        const mb = tangentAxis(b, s[i + 2] ? a : null, s[i + 2] || null, fdx, fdy, fdz, this._tb);
        const u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        out.x = h00 * a.x + h10 * h * ma.x + h01 * b.x + h11 * h * mb.x;
        out.y = h00 * a.y + h10 * h * ma.y + h01 * b.y + h11 * h * mb.y;
        out.z = h00 * a.z + h10 * h * ma.z + h01 * b.z + h11 * h * mb.z;
        out.ry = a.ry + wrapAngle(b.ry - a.ry) * u;
        return 'interp';
    }

    targetDelay(fixedExtraMs = null) {
        const o = this.o;
        const extra = Number.isFinite(fixedExtraMs)
            ? fixedExtraMs
            : Math.min(o.maxExtraMs, Math.max(o.minExtraMs, this.interval * 1.2 + 2.5 * this.jitter + 5));
        return (this.transit || 0) + extra;
    }

    // Advances the render clock and returns this.out (reused object), or null when empty.
    update(hostNow, dtMs, { fixedExtraMs = null, maxExtrapolateMs = null, strength = 1 } = {}) {
        if (!this.samples.length) return null;
        const o = this.o;
        if (Number.isFinite(maxExtrapolateMs)) o.maxExtrapolateMs = maxExtrapolateMs;
        const step = Math.max(0, Math.min(250, Number.isFinite(dtMs) ? dtMs : 0));
        const target = this.targetDelay(fixedExtraMs);
        if (this.delay === null || Math.abs(target - this.delay) > o.resyncMs) this.delay = target;
        else if (target > this.delay) this.delay += Math.min(target - this.delay, step * o.slowdown);
        else this.delay -= Math.min(this.delay - target, step * o.speedup);
        let renderTime = hostNow - this.delay;
        if (this.lastRenderTime !== null && renderTime < this.lastRenderTime) renderTime = this.lastRenderTime;
        this.mode = this._sampleInto(renderTime, this.out, Math.max(0, Math.min(1, strength)));
        const decay = Math.exp(-step / o.errorTauMs);
        const err = this.err;
        err.x *= decay; err.y *= decay; err.z *= decay;
        this.out.x += err.x;
        this.out.y += err.y;
        this.out.z += err.z;
        this.lastRenderTime = renderTime;
        const s = this.samples;
        while (s.length > 3 && s[2].time <= renderTime) this._pool.push(s.shift());
        this.stats.frames++;
        if (this.mode === 'extrap' || this.mode === 'hold') this.stats.extrap++;
        return this.out;
    }
}

// ---------------------------------------------------------------- ball

export const BALL_SMOOTHING = Object.freeze({
    maxExtrapolateS: 0.25,
    minAgeS: -0.05,
    snapDistance: 12,
    baseRate: 12,
    maxSpeedRate: 18
});

// Position of a host ball snapshot `base` ({x,y,z,vx,vy,vz}) at local time nowMs, when the
// snapshot is valid at local time baseTimeMs. Linear flight, bounded extrapolation.
export function ballPredictAt(base, baseTimeMs, nowMs, out) {
    const age = Math.min(BALL_SMOOTHING.maxExtrapolateS,
        Math.max(BALL_SMOOTHING.minAgeS, (nowMs - baseTimeMs) / 1000));
    out.x = base.x + base.vx * age;
    out.y = base.y + base.vy * age;
    out.z = base.z + base.vz * age;
    return out;
}

export function ballErrorDecay(dtSeconds, speed) {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0));
    const rate = BALL_SMOOTHING.baseRate + Math.min(BALL_SMOOTHING.maxSpeedRate, Math.max(0, speed || 0) * 0.25);
    return Math.exp(-dt * rate);
}

// Mean-transit tracker: returns how late (ms, +) or early (−) a stamped packet arrived
// compared with the running mean, so a consumer can place it on a jitter-free timeline.
export class TransitTracker {
    constructor({ alpha = 0.05, resyncMs = 1000, maxLateMs = 250, maxEarlyMs = 50 } = {}) {
        this.alpha = alpha;
        this.resyncMs = resyncMs;
        this.maxLateMs = maxLateMs;
        this.maxEarlyMs = maxEarlyMs;
        this.reset();
    }

    reset() {
        this.mean = null;
        this.jitter = 0;
    }

    note(transitMs) {
        if (!Number.isFinite(transitMs)) return 0;
        if (this.mean === null || Math.abs(transitMs - this.mean) > this.resyncMs) {
            this.mean = transitMs;
            this.jitter = 0;
            return 0;
        }
        const late = transitMs - this.mean;
        this.jitter += (Math.abs(late) - this.jitter) * 0.1;
        this.mean += late * this.alpha;
        return Math.max(-this.maxEarlyMs, Math.min(this.maxLateMs, late));
    }
}
