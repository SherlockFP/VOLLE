// net-clock.js — host-clock estimation for P2P snapshot timing (NTP-style ping filter).
//
// Every ping/pong gives one sample: t0 (local send), remote (host clock when it replied),
// t2 (local receive). offset = remote - (t0 + t2) / 2 assumes a symmetric path; queueing
// only ever ADDS delay, so the sample with the smallest RTT in the recent window is the
// least-biased one (classic NTP clock filter). The applied offset snaps on the first
// sample / after a timeline change, then slews by at most MAX_SLEW_MS per sample so a
// noisy ping never makes remote entities jump in time.

export const CLOCK_WINDOW = 8;
export const MAX_SLEW_MS = 4;
export const RESYNC_THRESHOLD_MS = 250;
export const MAX_RTT_MS = 5000;

export class ClockSync {
    constructor({ window = CLOCK_WINDOW, maxSlewMs = MAX_SLEW_MS } = {}) {
        this.window = Math.max(1, window | 0);
        this.maxSlewMs = maxSlewMs;
        this.reset();
    }

    reset() {
        this.samples = [];
        this.offset = 0;
        this.synced = false;
        this.rtt = 0;          // smoothed RTT (ms) — what the HUD shows as ping
        this.rttMin = 0;       // best RTT in window (ms)
        this.jitter = 0;       // mean |ΔRTT| (ms), RFC 3550 style estimator
        this.sampleCount = 0;
        this._lastRtt = null;
        this.epoch = (this.epoch || 0) + 1;
        // Bumps whenever the applied offset jumps (first sync, resync) — consumers that
        // measured transit against the old timeline must re-anchor.
        this.syncEpoch = (this.syncEpoch || 0) + 1;
    }

    addSample(t0, remoteTime, t2) {
        const rtt = t2 - t0;
        if (!Number.isFinite(rtt) || rtt < 0 || rtt > MAX_RTT_MS || !Number.isFinite(remoteTime)) return false;
        const offset = remoteTime - (t0 + t2) / 2;
        this.samples.push({ rtt, offset });
        if (this.samples.length > this.window) this.samples.shift();
        if (this._lastRtt === null) {
            this.rtt = rtt;
            this.jitter = 0;
        } else {
            this.jitter += (Math.abs(rtt - this._lastRtt) - this.jitter) / 8;
            this.rtt += (rtt - this.rtt) / 4;
        }
        this._lastRtt = rtt;
        this.sampleCount++;
        let best = this.samples[0];
        for (const sample of this.samples) if (sample.rtt < best.rtt) best = sample;
        this.rttMin = best.rtt;
        const delta = best.offset - this.offset;
        if (!this.synced || Math.abs(delta) > RESYNC_THRESHOLD_MS) {
            this.offset = best.offset;
            this.synced = true;
            this.syncEpoch++;
        } else {
            this.offset += Math.max(-this.maxSlewMs, Math.min(this.maxSlewMs, delta));
        }
        return true;
    }

    hostNow(localNow) {
        return localNow + this.offset;
    }
}
