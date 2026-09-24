// audio.js — Friendly, smooth, cute synthesized SFX
const THREAT_ENTER_SECONDS = [Infinity, 1.8, 0.9, 0.42];
const THREAT_COOLDOWN_MS = [Infinity, 1300, 850, 450];
const THREAT_EXIT_FACTOR = 1.25;

// ===== G7: one audio bus =====
// Every sound — recorded samples, Kenney foley and synth cues — rides one Web Audio
// graph: layer → category bus (sfx / announcer / ui / threat) → master → 12 kHz
// low-pass → limiter. sfx and announcer each have a duck stage in front of the bus;
// kill layers enter after it (they trigger the duck, they must not duck themselves)
// and the threat bus has no duck stage at all.
export const AUDIO_BUSES = Object.freeze(['sfx', 'announcer', 'ui', 'threat']);
export const DUCKED_BUSES = Object.freeze(['sfx', 'announcer']);
// Relative peak levels (dB vs the deflect reference). Samples are peak-normalised
// at decode, synth cues carry a measured trim, so these are the mix.
export const LOUDNESS_DB = Object.freeze({
    deflect: 0,
    hit: -1,
    killImpact: 0,
    streakSting: -3,
    overdrive: -3,
    threatCritical: -2,
    ui: -6,
    observerCue: -6,
    killerCue: -4,
    victimCue: -3
});
// Pre-master peak of a 0 dB layer. At default settings (sound 50 % → master 0.2)
// the deflect lands near the level the old HTMLAudio tf2_hit had.
export const REFERENCE_PEAK = 0.6;
export const DUCK = Object.freeze({ depthDb: -6, attack: 0.010, release: 0.200, hold: 0.12 });
export const MAX_SAMPLE_VOICES = 4;
// Decoded AudioBuffers are kept under this (LRU eviction, compressed bytes stay
// cached for a re-decode). Samples decode at 24 kHz — the bus low-passes at 12 kHz.
export const DECODED_BUDGET_BYTES = 10 * 1024 * 1024;
export const DECODE_SAMPLE_RATE = 24000;
export const TONE_CUTOFF_HZ = 12000;
export const REAR_THREAT_DOT = -0.05;
// A play request that arrives while its sample is still decoding is honoured only
// if the buffer lands within this window; later it would be a stale, late sound.
const PENDING_PLAY_MS = 150;
// Kill stack window: ≤ 3 layers per listener role inside it. Match announcements
// (round win, broadcast stings) that land inside an open window start right after it.
export const KILL_STACK_WINDOW = 0.15;
// Back-off after a sample fetch fails (404, offline) before trying it again.
export const SAMPLE_RETRY_MS = 30000;

export function dbToGain(db) {
    return Math.pow(10, db / 20);
}

export function gainToDb(gain) {
    return 20 * Math.log10(Math.max(1e-9, gain));
}

// The deflect cue is the 0 dB reference as a whole: tf2_hit / frying pan sample +
// the playDeflect synth body + Kenney foley + whoosh sum to REFERENCE_PEAK.
const DEFLECT_SAMPLE_DB = -2.3;

// Recorded samples. `db` is the level at `nominal` call volume; other legacy
// playSfx volumes scale from it. `kill` marks a kill layer: it enters its bus
// after the duck stage and ducks sfx + announcer for its duration.
const SAMPLE_SPECS = Object.freeze({
    tf2_hit: { url: 'sfx/tf2_hit.sfx', bus: 'sfx', db: DEFLECT_SAMPLE_DB, nominal: 0.35 },
    tf2_frying_pan: { url: 'sfx/tf2_frying_pan.sfx', bus: 'sfx', db: DEFLECT_SAMPLE_DB, nominal: 0.35 },
    tf2_crit: { url: 'sfx/tf2_crit.sfx', bus: 'sfx', db: -3, nominal: 0.65 },
    // Not a kill layer by default: rockets also use it. playKillImpact() opts in with { kill: true }.
    tf2_explosion: { url: 'sfx/tf2_explosion.sfx', bus: 'sfx', db: LOUDNESS_DB.killImpact, nominal: 0.5 },
    tf2_scout_scream: { url: 'sfx/tf2_scout_scream.sfx', bus: 'sfx', db: -5, nominal: 0.45 },
    tf2_you_are_dead: { url: 'sfx/tf2_you_are_dead.sfx', bus: 'announcer', db: LOUDNESS_DB.victimCue, nominal: 0.5, kill: true },
    tf2_notification: { url: 'sfx/tf2_notification.sfx', bus: 'announcer', db: LOUDNESS_DB.observerCue, nominal: 0.4 },
    tf2_domination: { url: 'sfx/tf2_domination.sfx', bus: 'announcer', db: -3, nominal: 0.5 },
    tf2_victory: { url: 'sfx/tf2_victory.sfx', bus: 'announcer', db: -3, nominal: 0.55 },
    tf2_you_failed: { url: 'sfx/tf2_you_failed.sfx', bus: 'announcer', db: -3, nominal: 0.5 },
    tf2_medic: { url: 'sfx/tf2_medic.sfx', bus: 'sfx', db: -6, nominal: 0.35 },
    rocket_fire: { url: 'sfx/rocket_fire.sfx', bus: 'sfx', db: -3, nominal: 0.72 },
    // Kill-streak stings (were per-file HTMLAudio at a fixed 0.12 that ignored mute).
    'music/1kill.sfx': { url: 'music/1kill.sfx', bus: 'announcer', db: LOUDNESS_DB.streakSting, nominal: 1, kill: true },
    'music/2kill.sfx': { url: 'music/2kill.sfx', bus: 'announcer', db: LOUDNESS_DB.streakSting, nominal: 1, kill: true },
    'music/3kill.sfx': { url: 'music/3kill.sfx', bus: 'announcer', db: LOUDNESS_DB.streakSting, nominal: 1, kill: true },
    'music/4kill.sfx': { url: 'music/4kill.sfx', bus: 'announcer', db: LOUDNESS_DB.streakSting, nominal: 1, kill: true },
    'music/ace.sfx': { url: 'music/ace.sfx', bus: 'announcer', db: LOUDNESS_DB.streakSting, nominal: 1, kill: true }
});
// Decoded as soon as the context exists so the first deflect/kill never waits on
// a decode; everything else decodes on first use.
const WARM_SAMPLES = Object.freeze(['tf2_hit', 'tf2_frying_pan', 'tf2_explosion', 'tf2_crit', 'tf2_scout_scream', 'tf2_you_are_dead', 'tf2_notification', 'music/2kill.sfx']);

// Kenney CC0 clips share the same normalisation (level at the caller's nominal gain).
const KENNEY_SPECS = Object.freeze({
    'ui-click': { bus: 'ui', db: LOUDNESS_DB.ui, nominal: 0.24 },
    'ui-hover': { bus: 'ui', db: -14, nominal: 0.1 },
    'ui-confirm': { bus: 'ui', db: LOUDNESS_DB.ui, nominal: 0.3 },
    'deflect-soft': { bus: 'sfx', db: -15.5, nominal: 0.11 },
    'deflect-reject': { bus: 'ui', db: -9, nominal: 0.13 }
});

// Synth cue trims: pre-master peak of each synth cue at trim 1, measured by rendering
// it through this bus in an OfflineAudioContext (48 kHz, Chrome) → the gain that
// puts it at its LOUDNESS_DB level.
export const SYNTH_PEAKS = Object.freeze({
    deflect: 0.2137, // playDeflect('flat') body + triangle
    hit: 0.3415, // playHit bonk + slide
    threat3: 0.04935, // _playThreatCueNow(3), front variant
    overdrive: 0.1181, // saw sweep + two square stabs
    click: 0.1053, // playClick synth fallback (Kenney clip is peak-normalised)
    killConfirm: 0.0871, // playKillConfirm single-voice arpeggio
    explosion: 0.2862 // playExplosion pop + crackle
});
function synthTrim(peakKey, db) {
    return REFERENCE_PEAK * dbToGain(db) / SYNTH_PEAKS[peakKey];
}
export const SYNTH_TRIMS = Object.freeze({
    // The deflect synth is a body layer under the deflect sample, not the whole cue.
    deflect: synthTrim('deflect', -11.5),
    hit: synthTrim('hit', LOUDNESS_DB.hit),
    threat: synthTrim('threat3', LOUDNESS_DB.threatCritical),
    overdrive: synthTrim('overdrive', LOUDNESS_DB.overdrive),
    click: synthTrim('click', LOUDNESS_DB.ui),
    killConfirm: synthTrim('killConfirm', LOUDNESS_DB.killerCue),
    explosion: synthTrim('explosion', LOUDNESS_DB.killImpact)
});

function bufferPeak(buffer) {
    if (!buffer || typeof buffer.getChannelData !== 'function') return 1;
    let peak = 0;
    const channels = buffer.numberOfChannels || 1;
    for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
            const v = data[i] < 0 ? -data[i] : data[i];
            if (v > peak) peak = v;
        }
    }
    return peak > 1e-4 ? peak : 1;
}

function bufferBytes(buffer) {
    if (!buffer) return 0;
    return (buffer.length || 0) * (buffer.numberOfChannels || 1) * 4;
}

function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export function createThreatAudioState() {
    return { urgency: 0, lastCueAt: null };
}

// Pure helper: camera-relative stereo pan + distance/behind attenuation for a
// world-space sound source. No allocation beyond the returned plain object —
// safe to call from a hot path as long as the caller doesn't retain garbage
// from its own arguments.
// - listenerPos: {x,y,z} — usually the camera/player position.
// - fwdX, fwdZ: listener forward direction (XZ plane; need not be normalized).
// - sourcePos: {x,y,z} — the sound's world position.
// - opts.maxPan: pan clamp (default 0.85 — never hard-panned).
// - opts.refDistance: distance under which there's no attenuation (default 6).
// - opts.maxDistance: distance at which attenuation bottoms out (default 60).
// - opts.behindDip: max fractional volume cut when source is directly behind (default 0.35).
export function computeStereoPan(listenerPos, fwdX, fwdZ, sourcePos, opts = {}) {
    const maxPan = Number.isFinite(opts.maxPan) ? opts.maxPan : 0.85;
    const refDistance = Number.isFinite(opts.refDistance) ? opts.refDistance : 6;
    const maxDistance = Number.isFinite(opts.maxDistance) ? opts.maxDistance : 60;
    const behindDip = Number.isFinite(opts.behindDip) ? opts.behindDip : 0.35;

    if (!listenerPos || !sourcePos) return { pan: 0, gain: 1, behind: false };

    const dx = (sourcePos.x || 0) - (listenerPos.x || 0);
    const dz = (sourcePos.z || 0) - (listenerPos.z || 0);
    const horizDist = Math.hypot(dx, dz);
    const dy = (sourcePos.y || 0) - (listenerPos.y || 0);
    const dist3 = Math.hypot(horizDist, dy);

    const fLen = Math.hypot(fwdX, fwdZ) || 1;
    const fx = fwdX / fLen;
    const fz = fwdZ / fLen;
    // Right vector = forward rotated -90deg around Y (matches Three.js default
    // forward (0,0,-1) -> right (1,0,0)).
    const rx = -fz;
    const rz = fx;

    let pan = 0;
    let behind = false;
    let behindFactor = 1;
    if (horizDist > 1e-4) {
        pan = (dx * rx + dz * rz) / horizDist;
        const fwdDot = (dx * fx + dz * fz) / horizDist;
        if (fwdDot < 0) {
            behind = true;
            behindFactor = 1 - behindDip * Math.min(1, -fwdDot);
        }
    }
    pan = Math.max(-maxPan, Math.min(maxPan, pan));

    let distGain = 1;
    if (dist3 > refDistance) {
        const span = Math.max(1, maxDistance - refDistance);
        const t = Math.min(1, (dist3 - refDistance) / span);
        distGain = 1 - t * 0.7; // floor at 0.3x so distant sounds stay audible
    }

    return { pan, gain: Math.max(0, distGain * behindFactor), behind };
}

// Threat-cue voicing toward the ball: stereo pan from computeStereoPan, plus the
// facing dot (listener forward · direction to the ball, XZ). A ball behind the
// player (dot < REAR_THREAT_DOT) gets the lower, low-passed rear variant.
export function computeThreatVoicing(listenerPos, fwdX, fwdZ, sourcePos) {
    if (!listenerPos || !sourcePos) return { pan: 0, rear: false, dot: 1 };
    const { pan } = computeStereoPan(listenerPos, fwdX, fwdZ, sourcePos);
    const dx = (sourcePos.x || 0) - (listenerPos.x || 0);
    const dz = (sourcePos.z || 0) - (listenerPos.z || 0);
    const dist = Math.hypot(dx, dz);
    const fLen = Math.hypot(fwdX, fwdZ) || 1;
    const dot = dist > 1e-4 ? (dx * fwdX + dz * fwdZ) / (dist * fLen) : 1;
    return { pan, rear: dot < REAR_THREAT_DOT, dot };
}

function classifyThreat(distance, speed, thresholdFactor = 1) {
    if (!Number.isFinite(distance) || !Number.isFinite(speed) || distance < 0 || speed <= 0) return 0;
    const seconds = distance / speed;
    if (seconds <= THREAT_ENTER_SECONDS[3] * thresholdFactor) return 3;
    if (seconds <= THREAT_ENTER_SECONDS[2] * thresholdFactor) return 2;
    if (seconds <= THREAT_ENTER_SECONDS[1] * thresholdFactor) return 1;
    return 0;
}

export function scheduleThreatAudio(state, sample) {
    const reset = createThreatAudioState();
    const current = state?.urgency >= 0 && state.urgency <= 3 ? state : reset;
    if (!Number.isFinite(sample?.now)) return { state: reset, cue: 0 };
    if (!sample.active) return { state: current, cue: 0 };

    const rawUrgency = classifyThreat(sample.distance, sample.speed);
    let urgency = rawUrgency;
    if (rawUrgency < current.urgency) {
        urgency = classifyThreat(sample.distance, sample.speed, THREAT_EXIT_FACTOR);
    }
    if (urgency === 0) return { state: reset, cue: 0 };

    const elapsed = current.lastCueAt === null ? Infinity : sample.now - current.lastCueAt;
    const cue = urgency > current.urgency || elapsed >= THREAT_COOLDOWN_MS[urgency]
        ? urgency
        : 0;
    return {
        state: {
            urgency,
            lastCueAt: cue ? sample.now : current.lastCueAt
        },
        cue
    };
}

export class Audio {
    // Tiny CC0 layer: each effect is fetched and decoded only after first use.
    // Synth cues remain the immediate/offline-safe fallback.
    static KENNEY_CLIPS = Object.freeze({
        'ui-click': 'assets/cc0/kenney/audio/interface/click_003.ogg',
        'ui-hover': 'assets/cc0/kenney/audio/interface/tick_002.ogg',
        'ui-confirm': 'assets/cc0/kenney/audio/interface/confirmation_002.ogg',
        'deflect-soft': 'assets/cc0/kenney/audio/impact/impactSoft_medium_001.ogg',
        'deflect-reject': 'assets/cc0/kenney/audio/interface/error_002.ogg'
    });

    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.volume = 0.5;
        // Sound channel (0-1). Master fader and mute are separate so a caller that
        // only knows the sound slider can never undo them.
        this.soundVolume = 0.5;
        this.masterVolume = 1;
        this.muted = false;
        this.buses = null; // bus name → GainNode (post-duck entry)
        this._duckNodes = null; // sfx/announcer → GainNode (ducked entry)
        this._noWebAudio = false;
        this._threatAudioState = createThreatAudioState();
        this._threatCueGeneration = 0;
        this._threatVoicePos = { x: 0, y: 0, z: 0 };
        this._threatVoicePosSet = false;
        this._contextResumePromise = null;
        // Samples: compressed bytes (fetched once), decoded AudioBuffers (LRU, budgeted).
        this._sampleBytes = new Map();
        this._sampleFetches = new Map();
        this._samples = new Map(); // name → { buffer, peak, bytes, lastUsed }
        this._sampleDecodes = new Map();
        this._pendingPlays = new Map();
        this._voices = new Map(); // name → [{ source, gain, startedAt }] oldest first
        this._fallbackPools = new Map();
        this._sfxBasePath = 'sfx/';
        this._bufferPeaks = new WeakMap();
        this._trace = null;
        this._killStackAt = -Infinity; // ctx time the current kill stack opened
        this._kenneyBuffers = new Map();
        this._kenneyLoads = new Map();
        this._kenneyLastPlayed = Object.create(null);
        // Reused objects for the positional-audio listener — updated in place
        // from setListener() every frame, never reallocated.
        this._listenerPos = { x: 0, y: 0, z: 0 };
        this._listenerFwd = { x: 0, z: -1 };
        this._listenerSet = false;
    }

    // ===== Bus plumbing =====
    _effectiveVolume() {
        if (this.muted) return 0;
        const sound = Number.isFinite(this.soundVolume) ? this.soundVolume : 0;
        const master = Number.isFinite(this.masterVolume) ? this.masterVolume : 1;
        return Math.max(0, Math.min(1, sound * master));
    }

    // True when a sound may start right now: a context exists and the combined
    // sound × master × mute level is audible. Every play path checks this first, so
    // mute starts zero sources in every category.
    _live() {
        return !!this.ctx && this._effectiveVolume() > 0;
    }

    // Entry node for a bus. Kill layers (`priority`) skip the duck stage. Falls
    // back to the master gain when the bus graph is not built (tests, old callers).
    _out(bus = 'sfx', priority = false) {
        if (!priority && this._duckNodes?.[bus]) return this._duckNodes[bus];
        return this.buses?.[bus] || this.masterGain;
    }

    // A one-shot trim stage for a synth cue so its peak lands on its table level.
    _synthOut(bus, trim = 1, priority = false, pos = null) {
        const dest = pos ? this._spatialOutput(pos, bus, priority) : this._out(bus, priority);
        if (trim === 1 || !this.ctx?.createGain) return dest;
        const gain = this.ctx.createGain();
        gain.gain.value = trim;
        gain.connect(dest);
        return gain;
    }

    _traceEvent(event) {
        if (!this._trace) return;
        this._trace.push({ wall: nowMs(), at: this.ctx?.currentTime ?? 0, ...event });
        if (this._trace.length > 2000) this._trace.shift();
    }

    // Debug/evidence hook (window.__volle.audio): records every layer start, voice
    // steal and duck with its bus and gain. Off by default; zero cost when off.
    setTrace(enabled = true) {
        this._trace = enabled ? [] : null;
        return this._trace;
    }

    takeTrace() {
        const out = this._trace ? this._trace.slice() : [];
        if (this._trace) this._trace.length = 0;
        return out;
    }

    // Duck sfx + announcer by DUCK.depthDb: 10 ms attack, hold, 200 ms release. The
    // threat and ui buses are never ducked. Re-triggering extends the hold.
    duck(reason = 'kill', hold = DUCK.hold) {
        if (!this.ctx || !this._duckNodes) return false;
        const t = this.ctx.currentTime;
        const floor = dbToGain(DUCK.depthDb);
        const holdS = Math.max(0, Number(hold) || 0);
        for (const bus of DUCKED_BUSES) {
            const param = this._duckNodes[bus]?.gain;
            if (!param) continue;
            // Anchor the attack ramp at the live value (a re-trigger mid-release
            // ramps down from where it is, never jumps).
            const current = Number.isFinite(param.value) ? param.value : 1;
            param.cancelScheduledValues?.(t);
            param.setValueAtTime?.(current, t);
            param.linearRampToValueAtTime?.(floor, t + DUCK.attack);
            param.setValueAtTime?.(floor, t + DUCK.attack + holdS);
            param.linearRampToValueAtTime?.(1, t + DUCK.attack + holdS + DUCK.release);
        }
        this._traceEvent({ kind: 'duck', reason, depthDb: DUCK.depthDb, attack: DUCK.attack, hold: holdS, release: DUCK.release });
        return true;
    }

    // ===== Volume: sound channel × master × mute =====
    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Math.min(1, Number(v) || 0));
        this._applyVolume();
    }

    setMuted(muted) {
        this.muted = Boolean(muted);
        this._applyVolume();
    }

    // settings-controller hands all three at once (0-1 sound/master, boolean mute).
    setMix({ sound, master, muted } = {}) {
        if (sound !== undefined) this.soundVolume = Math.max(0, Math.min(1, Number(sound) || 0));
        if (master !== undefined) this.masterVolume = Math.max(0, Math.min(1, Number(master) || 0));
        if (muted !== undefined) this.muted = Boolean(muted);
        this.volume = this.soundVolume;
        this._applyVolume();
    }

    _applyVolume() {
        const effective = this._effectiveVolume();
        if (this.masterGain?.gain) this.masterGain.gain.value = effective * 0.4;
        if (effective <= 0) this._stopAllVoices();
        for (const pool of this._fallbackPools.values()) {
            for (const el of pool.elements) {
                if (effective <= 0) el.pause?.();
            }
        }
    }

    // Call once per frame (e.g. from the game's update loop) with the camera/
    // player world position and forward direction so playWhoosh/playHit/
    // playDeflect/playBounce can pan relative to it when given a `pos`. Copies
    // fields into reused objects — no allocation. Passing a falsy position
    // clears the listener, after which positional args are ignored and
    // playback falls back to today's non-spatial behaviour.
    setListener(position, forwardX, forwardZ) {
        if (!position) {
            this._listenerSet = false;
            return;
        }
        this._listenerPos.x = position.x || 0;
        this._listenerPos.y = position.y || 0;
        this._listenerPos.z = position.z || 0;
        if (Number.isFinite(forwardX)) this._listenerFwd.x = forwardX;
        if (Number.isFinite(forwardZ)) this._listenerFwd.z = forwardZ;
        this._listenerSet = true;
    }

    // Returns the node a one-shot sound's gain stages should connect to.
    // With no listener/position that's the bus entry (masterGain when the bus
    // graph isn't built). With both set, builds a small gain->panner->bus chain
    // (created per one-shot sound, same lifecycle as the oscillators/buffers
    // themselves — no per-frame allocation).
    _spatialOutput(pos, bus = 'sfx', priority = false) {
        const out = this._out(bus, priority);
        if (!pos || !this._listenerSet || !this.ctx || !out) return out;
        const panner = this.ctx.createStereoPanner?.();
        if (!panner) return out;
        const { pan, gain } = computeStereoPan(this._listenerPos, this._listenerFwd.x, this._listenerFwd.z, pos);
        const spatialGain = this.ctx.createGain();
        spatialGain.gain.value = gain;
        panner.pan.value = pan;
        spatialGain.connect(panner);
        panner.connect(out);
        return spatialGain;
    }

    // ===== Named cue API with retrigger guard and graceful fallback =====
    // Cue table: canonical per-cue definitions with volume normalization (0-1).
    // Retrigger guard (50ms default) prevents rapid bursts from stacking/clipping.
    // Unknown cue IDs silently no-op rather than throwing.
    static CUES = {
        'ui-click': { fn: 'playClick' },
        'ui-hover': { fn: 'playHover' },
        'deflect-spike': { fn: 'playDeflect', args: ['spike'] },
        'deflect-lob': { fn: 'playDeflect', args: ['lob'] },
        'deflect-flat': { fn: 'playDeflect', args: ['flat'] },
        'whoosh': { fn: 'playWhoosh' },
        'dash': { fn: 'playDash', retriggerMs: 250 },
        'dinging': { fn: 'playDing' },
        'jump': { fn: 'playJump' },
        'land': { fn: 'playLand' },
        'bounce': { fn: 'playBounce' },
        'threat-1': { fn: 'playThreatCue', args: [1] },
        'threat-2': { fn: 'playThreatCue', args: [2] },
        'threat-3': { fn: 'playThreatCue', args: [3] },
        'knife-inspect': { fn: 'playKnife', args: ['inspect'] },
        'knife-slash': { fn: 'playKnife', args: ['slash'] },
        'knife-stab': { fn: 'playKnife', args: ['stab'] },
        'voice-ping-incoming': { fn: 'playVoicePing', args: ['incoming'] },
        'voice-ping-help': { fn: 'playVoicePing', args: ['help'] },
        'voice-ping-save': { fn: 'playVoicePing', args: ['save'] },
        'beep': { fn: 'playBeep' },
        'go': { fn: 'playGo' },
        'speed-warning': { fn: 'playSpeedWarning' },
        'score': { fn: 'playScore' },
        'chat': { fn: 'playChat' },
        'hit-tf2': { fn: 'playSfx', args: ['tf2_hit', 0.35], retriggerMs: 50 },
        'crit-tf2': { fn: 'playSfx', args: ['tf2_crit', 0.65] },
        'frying-pan': { fn: 'playSfx', args: ['tf2_frying_pan', 0.35], retriggerMs: 50 },
        'match-win': { fn: 'playSfx', args: ['tf2_victory', 0.7], retriggerMs: 1000 },
        'match-loss': { fn: 'playSfx', args: ['tf2_you_failed', 0.65], retriggerMs: 1000 },
        'match-end': { fn: 'playSfx', args: ['tf2_notification', 0.5], retriggerMs: 1000 },
        'respawn': { fn: 'playRespawn' },
        'equip-change': { fn: 'playEquipChange' },
        'settings-apply': { fn: 'playSettingsApply' },
        'kill-confirm': { fn: 'playKillConfirm', retriggerMs: 400 },
        'deflect-reject': { fn: 'playDeflectReject', retriggerMs: 250 },
        // G4: rally ball crossed into OVERDRIVE (Game._updateOverdrivePresentation).
        'overdrive-enter': { fn: 'playOverdriveEnter', retriggerMs: 1200 },
    };

    _cueCooldowns = {};

    playCue(cueName) {
        if (!cueName || typeof cueName !== 'string') return false;
        const cue = Audio.CUES[cueName];
        if (!cue) return false;
        if (this._effectiveVolume() <= 0) return false;
        const now = performance.now?.() || Date.now?.() || 0;
        const minGap = cue.retriggerMs ?? 50;
        const fn = this[cue.fn];
        if (!fn || typeof fn !== 'function') return false;
        const hasPlayed = Object.prototype.hasOwnProperty.call(this._cueCooldowns, cueName);
        const previousPlay = this._cueCooldowns[cueName];
        if (hasPlayed && now - previousPlay < minGap) return false;
        try {
            this._cueCooldowns[cueName] = now;
            if (cue.args) fn.apply(this, cue.args);
            else fn.call(this);
            return true;
        } catch (_e) {
            if (hasPlayed) this._cueCooldowns[cueName] = previousPlay;
            else delete this._cueCooldowns[cueName];
            return false;
        }
    }

    // `context` lets tests and the OfflineAudioContext loudness harness inject a
    // context; the game passes nothing and gets a realtime AudioContext.
    init(context = null) {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this._resumeAudioContext();
            return;
        }
        try {
            const Ctor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
            if (!context && !Ctor) {
                this._noWebAudio = true; // HTMLAudio fallback for samples only
                return;
            }
            this.ctx = context || new Ctor();
        } catch (e) {
            console.warn('AudioContext:', e);
            this._noWebAudio = true;
            return;
        }
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this._effectiveVolume() * 0.4;

        // Rolls off only the fizz above 12 kHz (Butterworth Q, no resonant bump), so
        // knife partials (2.3-7.1 kHz) and sample transients stay bright; then a
        // compressor/limiter tames peaks so nothing ever screeches.
        this.tone = this.ctx.createBiquadFilter();
        this.tone.type = 'lowpass';
        this.tone.frequency.value = TONE_CUTOFF_HZ;
        this.tone.Q.value = Math.SQRT1_2;

        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -14;
        this.limiter.knee.value = 24;
        this.limiter.ratio.value = 8;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.2;

        this.masterGain.connect(this.tone);
        this.tone.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);

        // Category buses → master; sfx/announcer get a duck stage in front.
        this.buses = {};
        this._duckNodes = {};
        for (const name of AUDIO_BUSES) {
            const bus = this.ctx.createGain();
            bus.gain.value = 1;
            bus.connect(this.masterGain);
            this.buses[name] = bus;
        }
        for (const name of DUCKED_BUSES) {
            const duck = this.ctx.createGain();
            duck.gain.value = 1;
            duck.connect(this.buses[name]);
            this._duckNodes[name] = duck;
        }
        if (this.ctx.state === 'suspended') this._resumeAudioContext();
        this._warmDecode();
    }

    setVolume(v) {
        this.setSoundVolume(v);
    }

    setSoundVolume(v) {
        this.soundVolume = Math.max(0, Math.min(1, Number(v) || 0));
        this.volume = this.soundVolume;
        this._applyVolume();
    }

    resetThreatAudio() {
        this._threatAudioState = createThreatAudioState();
        this._threatCueGeneration++;
    }

    updateThreatAudio(sample = {}) {
        const now = Number.isFinite(sample.now)
            ? sample.now
            : (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const result = scheduleThreatAudio(this._threatAudioState, { ...sample, now });
        this._threatAudioState = result.state;
        if (result.cue) this.playThreatCue(result.cue, sample.pos || null);
        return result.cue;
    }

    // pos: the ball's world position — the cue pans toward it and switches to the
    // rear variant when it is behind the listener. Copied, never retained.
    playThreatCue(urgency = 1, pos = null) {
        const generation = ++this._threatCueGeneration;
        if (!this.ctx || !this.masterGain || this._effectiveVolume() <= 0) return;
        const level = Math.max(1, Math.min(3, Math.floor(urgency)));
        this._threatVoicePosSet = !!pos;
        if (pos) {
            this._threatVoicePos.x = pos.x || 0;
            this._threatVoicePos.y = pos.y || 0;
            this._threatVoicePos.z = pos.z || 0;
        }
        if (this.ctx.state === 'suspended') {
            this._resumeAudioContext().then(running => {
                if (!running
                    || generation !== this._threatCueGeneration
                    || !this.masterGain
                    || this._effectiveVolume() <= 0) return;
                this._playThreatCueNow(level);
            });
            return;
        }
        this._playThreatCueNow(level);
    }

    _resumeAudioContext() {
        if (!this.ctx || this.ctx.state !== 'suspended') {
            return Promise.resolve(this.ctx?.state === 'running');
        }
        if (this._contextResumePromise) return this._contextResumePromise;
        let resumed;
        try {
            resumed = this.ctx.resume();
        } catch (_) {
            return Promise.resolve(false);
        }
        const flight = Promise.resolve(resumed)
            .then(() => this.ctx?.state === 'running')
            .catch(() => false)
            .finally(() => {
                if (this._contextResumePromise === flight) this._contextResumePromise = null;
            });
        this._contextResumePromise = flight;
        return flight;
    }

    _loadKenneyClip(name) {
        if (this._kenneyBuffers.has(name) || this._kenneyLoads.has(name)) return;
        const url = Audio.KENNEY_CLIPS[name];
        if (!url || typeof fetch !== 'function' || !this.ctx?.decodeAudioData) return;
        const context = this.ctx;
        const flight = fetch(url)
            .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`Kenney audio ${response.status}`)))
            .then(data => context.decodeAudioData(data))
            .then(buffer => {
                if (buffer && this.ctx === context) this._kenneyBuffers.set(name, buffer);
            })
            .catch(() => {}) // Procedural audio is the intentional no-network fallback.
            .finally(() => this._kenneyLoads.delete(name));
        this._kenneyLoads.set(name, flight);
    }

    _playKenneyClip(name, gainValue, minGapMs = 50) {
        if (!this.ctx || !this.masterGain || this._effectiveVolume() <= 0) return false;
        const buffer = this._kenneyBuffers.get(name);
        if (!buffer) {
            this._loadKenneyClip(name);
            return false;
        }
        const now = nowMs();
        const lastPlayed = this._kenneyLastPlayed[name];
        if (Number.isFinite(lastPlayed) && now - lastPlayed < minGapMs) return true;
        const spec = KENNEY_SPECS[name] || { bus: 'sfx', db: -12, nominal: gainValue || 1 };
        const gain = this._levelGain(spec, this._peakOf(buffer), gainValue);
        const voice = this._startVoice(`kenney:${name}`, buffer, { bus: spec.bus, gain });
        if (!voice) return false;
        this._kenneyLastPlayed[name] = now;
        return true;
    }

    _peakOf(buffer) {
        if (!buffer || typeof buffer !== 'object') return 1;
        let peak = this._bufferPeaks.get(buffer);
        if (peak === undefined) {
            peak = bufferPeak(buffer);
            this._bufferPeaks.set(buffer, peak);
        }
        return peak;
    }

    // Linear gain that puts a buffer with `peak` at spec.db (vs REFERENCE_PEAK) when
    // called at spec.nominal volume; other call volumes scale proportionally.
    _levelGain(spec, peak, vol = spec.nominal) {
        const callVol = Number.isFinite(vol) && vol > 0 ? vol : spec.nominal;
        const scale = callVol / (spec.nominal || 1);
        const gain = REFERENCE_PEAK * dbToGain(spec.db) / Math.max(1e-4, peak) * scale;
        return Math.min(8, gain);
    }

    _playThreatCueNow(level) {
        const t = this.ctx.currentTime;
        const voicing = this._threatVoicePosSet && this._listenerSet
            ? computeThreatVoicing(this._listenerPos, this._listenerFwd.x, this._listenerFwd.z, this._threatVoicePos)
            : { pan: 0, rear: false, dot: 1 };
        // Threat bus: never ducked. Rear variant = lower pitch through a low-pass.
        let out = this._out('threat');
        const pitch = voicing.rear ? 0.7 : 1;
        if (voicing.rear) {
            const lowpass = this.ctx.createBiquadFilter?.();
            if (lowpass) {
                lowpass.type = 'lowpass';
                lowpass.frequency.value = 1100;
                lowpass.Q.value = 0.7;
                lowpass.connect(out);
                out = lowpass;
            }
        }
        const panner = this.ctx.createStereoPanner?.();
        if (panner) {
            panner.pan.value = voicing.pan;
            panner.connect(out);
            out = panner;
        }
        // The rear variant (lower pitch, low-passed) measures ~0.4 dB hotter; trim it level.
        const trim = SYNTH_TRIMS.threat * (voicing.rear ? 0.95 : 1);
        const pulse = (type, frequency, offset, duration, gainValue) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = frequency * pitch;
            gain.gain.setValueAtTime(0.0001, t + offset);
            gain.gain.exponentialRampToValueAtTime(gainValue * trim, t + offset + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.001, t + offset + duration);
            osc.connect(gain);
            gain.connect(out);
            osc.start(t + offset);
            osc.stop(t + offset + duration + 0.01);
        };

        pulse('sine', 300 + level * 55, 0, 0.15, 0.07);
        if (level >= 2) pulse('triangle', 520 + level * 70, 0.07, 0.13, 0.055);
        if (level >= 3) pulse('square', 920, 0.14, 0.08, 0.025);
        this._traceEvent({ kind: 'layer', name: `threat-${level}`, bus: 'threat', gain: trim, pan: voicing.pan, rear: voicing.rear, dot: voicing.dot });
        if (level >= 3) this.duck('threat-critical', 0.2);
    }

    // ===== Samples =====
    // Fetch the compressed bytes of every recorded sample (.sfx aliases so download
    // managers don't grab .mp3 URLs). Decoding is lazy: the hot deflect/kill set
    // decodes once a context exists, everything else on first play.
    async preloadSfx(basePath = 'sfx/') {
        this._sfxBasePath = basePath;
        await Promise.all(Object.keys(SAMPLE_SPECS).map(name => this._fetchSample(name)));
        this._warmDecode();
    }

    _sampleUrl(name) {
        const spec = SAMPLE_SPECS[name];
        if (!spec) return null;
        return spec.url.startsWith('sfx/') ? `${this._sfxBasePath}${spec.url.slice(4)}` : spec.url;
    }

    _fetchSample(name) {
        if (this._sampleBytes.has(name)) return Promise.resolve(true);
        const inFlight = this._sampleFetches.get(name);
        if (inFlight) return inFlight;
        // A missing/broken sample must not re-fetch on every play (tf2_hit fires
        // on every deflect): back off for SAMPLE_RETRY_MS after a failure.
        this._sampleFailedAt ??= new Map();
        const failedAt = this._sampleFailedAt.get(name);
        if (failedAt !== undefined && nowMs() - failedAt < SAMPLE_RETRY_MS) return Promise.resolve(false);
        const url = this._sampleUrl(name);
        if (!url || typeof fetch !== 'function') return Promise.resolve(false);
        const flight = fetch(url)
            .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`sample ${response.status}`)))
            .then(bytes => {
                this._sampleBytes.set(name, bytes);
                if (this._pendingPlays.has(name)) this._decodeSample(name);
                return true;
            })
            .catch(e => {
                console.warn(`SFX load failed: ${name}`, e);
                this._sampleFailedAt.set(name, nowMs());
                this._pendingPlays.delete(name);
                return false;
            })
            .finally(() => this._sampleFetches.delete(name));
        this._sampleFetches.set(name, flight);
        return flight;
    }

    _warmDecode() {
        if (!this.ctx) return;
        for (const name of WARM_SAMPLES) {
            if (this._sampleBytes.has(name)) this._decodeSample(name);
        }
    }

    _decodeContext() {
        // Decode at 24 kHz (half the memory of 48 kHz; the bus low-passes at 12 kHz
        // anyway). AudioBuffers are context-independent, the realtime context
        // resamples on playback. Falls back to the live context.
        if (this._decoder !== undefined) return this._decoder || this.ctx;
        this._decoder = null;
        try {
            const Offline = typeof window !== 'undefined'
                ? (window.OfflineAudioContext || window.webkitOfflineAudioContext)
                : null;
            if (Offline && this.ctx && typeof this.ctx.decodeAudioData === 'function') {
                this._decoder = new Offline(1, 1, DECODE_SAMPLE_RATE);
            }
        } catch (_) {
            this._decoder = null;
        }
        return this._decoder || this.ctx;
    }

    _decodeSample(name) {
        if (!this.ctx) return null;
        if (this._samples.has(name)) return Promise.resolve(this._samples.get(name));
        const inFlight = this._sampleDecodes.get(name);
        if (inFlight) return inFlight;
        const bytes = this._sampleBytes.get(name);
        if (!bytes) {
            this._fetchSample(name);
            return null;
        }
        const decoder = this._decodeContext();
        if (!decoder || typeof decoder.decodeAudioData !== 'function') return null;
        const context = this.ctx;
        const flight = new Promise((resolve, reject) => {
            // decodeAudioData detaches its input; keep the compressed copy for re-decode.
            const result = decoder.decodeAudioData(bytes.slice(0), resolve, reject);
            if (result && typeof result.then === 'function') result.then(resolve, reject);
        })
            .then(buffer => {
                if (!buffer || this.ctx !== context) return null;
                const entry = { buffer, peak: bufferPeak(buffer), bytes: bufferBytes(buffer), lastUsed: nowMs() };
                this._samples.set(name, entry);
                this._enforceDecodedBudget(name);
                const pending = this._pendingPlays.get(name);
                this._pendingPlays.delete(name);
                if (pending && nowMs() - pending.at <= PENDING_PLAY_MS) this.playSample(name, pending.opts);
                return entry;
            })
            .catch(() => null)
            .finally(() => this._sampleDecodes.delete(name));
        this._sampleDecodes.set(name, flight);
        return flight;
    }

    decodedBytes() {
        let total = 0;
        for (const entry of this._samples.values()) total += entry.bytes;
        return total;
    }

    _enforceDecodedBudget(keep) {
        let total = this.decodedBytes();
        while (total > DECODED_BUDGET_BYTES) {
            let victim = null;
            for (const [name, entry] of this._samples) {
                if (name === keep || this._voices.get(name)?.length) continue;
                if (!victim || entry.lastUsed < victim[1].lastUsed) victim = [name, entry];
            }
            if (!victim) break;
            this._samples.delete(victim[0]);
            total -= victim[1].bytes;
        }
    }

    hasSample(name) {
        return this._samples.has(name);
    }

    // Start one voice of a decoded buffer: a fresh AudioBufferSourceNode every time
    // (never rewinds a playing one). ≤ MAX_SAMPLE_VOICES per sample; the oldest is
    // stolen with a 5 ms fade.
    _startVoice(key, buffer, { bus = 'sfx', gain = 1, rate = 1, priority = false, pan = null, when = null } = {}) {
        const ctx = this.ctx;
        const source = ctx?.createBufferSource?.();
        const gainNode = ctx?.createGain?.();
        if (!source || !gainNode) return null;
        const now = ctx.currentTime || 0;
        const t = Number.isFinite(when) && when > now ? when : now;
        let voices = this._voices.get(key);
        if (!voices) {
            voices = [];
            this._voices.set(key, voices);
        }
        while (voices.length >= MAX_SAMPLE_VOICES) {
            const oldest = voices.shift();
            this._stopVoice(oldest, now);
            this._traceEvent({ kind: 'steal', name: key });
        }
        source.buffer = buffer;
        const playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
        if (source.playbackRate) source.playbackRate.value = playbackRate;
        gainNode.gain.value = gain;
        source.connect(gainNode);
        let dest = this._out(bus, priority);
        if (Number.isFinite(pan) && pan !== 0) {
            const panner = ctx.createStereoPanner?.();
            if (panner) {
                panner.pan.value = Math.max(-1, Math.min(1, pan));
                panner.connect(dest);
                dest = panner;
            }
        }
        gainNode.connect(dest);
        const voice = { source, gain: gainNode, startedAt: t, key };
        source.onended = () => {
            const list = this._voices.get(key);
            const index = list ? list.indexOf(voice) : -1;
            if (index >= 0) list.splice(index, 1);
        };
        source.start(t);
        voices.push(voice);
        this._traceEvent({ kind: 'layer', name: key, bus, priority, gain, rate: playbackRate, voices: voices.length, startAt: t });
        return voice;
    }

    _stopVoice(voice, t = this.ctx?.currentTime || 0) {
        if (!voice) return;
        try {
            const param = voice.gain?.gain;
            if (param?.setTargetAtTime) {
                param.cancelScheduledValues?.(t);
                param.setTargetAtTime(0, t, 0.005);
            }
            voice.source.stop?.(t + 0.03);
        } catch (_) { /* already stopped */ }
    }

    _stopAllVoices() {
        for (const voices of this._voices.values()) {
            while (voices.length) this._stopVoice(voices.shift());
        }
    }

    // A kill layer opens (or joins) the current kill stack window.
    _markKillLayer() {
        const t = this.ctx?.currentTime || 0;
        if (t - this._killStackAt > KILL_STACK_WINDOW) this._killStackAt = t;
    }

    // Play a recorded sample on its bus. opts: vol (legacy playSfx volume), rate,
    // bus/db overrides, pan (-1..1), priority/kill (skip the duck stage; a kill
    // layer also ducks the other layers), afterKillStack (an announcement: wait
    // for an open kill stack window to close instead of stacking a 4th layer).
    playSample(name, opts = {}) {
        const base = SAMPLE_SPECS[name];
        if (!base) return false;
        if (this._effectiveVolume() <= 0) return false;
        const spec = {
            bus: opts.bus || base.bus,
            db: Number.isFinite(opts.db) ? opts.db : base.db,
            nominal: base.nominal
        };
        const kill = opts.kill ?? base.kill ?? false;
        if (!this.ctx) return this._noWebAudio ? this._playFallback(name, spec, opts) : false;
        const entry = this._samples.get(name);
        if (!entry) {
            this._pendingPlays.set(name, { at: nowMs(), opts });
            this._decodeSample(name);
            return false;
        }
        entry.lastUsed = nowMs();
        const gain = this._levelGain(spec, entry.peak, opts.vol);
        let when = null;
        if (opts.afterKillStack) {
            const close = this._killStackAt + KILL_STACK_WINDOW + 0.01;
            if (close > (this.ctx.currentTime || 0)) when = close;
        } else if (kill) {
            this._markKillLayer();
        }
        const voice = this._startVoice(name, entry.buffer, {
            bus: spec.bus, gain, rate: opts.rate, priority: kill || !!opts.priority, pan: opts.pan, when
        });
        if (voice && kill) this.duck(name, Math.min(0.35, entry.buffer.duration || 0.2));
        return !!voice;
    }

    // Legacy entry point (game.js, ui.js, cue table). rate is the playback rate —
    // the combo-tier pitch ramp in js/game.js.
    playSfx(name, vol = 0.5, rate = 1) {
        return this.playSample(name, { vol, rate });
    }

    // HTMLAudio only when this browser has no Web Audio at all: a small element pool
    // per sample (same 4-voice cap), volume from the same table × sound × master.
    _playFallback(name, spec, opts = {}) {
        if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
        const bytes = this._sampleBytes.get(name);
        if (!bytes) {
            this._fetchSample(name);
            return false;
        }
        let pool = this._fallbackPools.get(name);
        if (!pool) {
            const src = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
            pool = { src, elements: [], next: 0 };
            this._fallbackPools.set(name, pool);
        }
        let el = pool.elements[pool.next];
        if (!el) {
            el = document.createElement('audio');
            el.preload = 'auto';
            el.src = pool.src;
            pool.elements[pool.next] = el;
        }
        pool.next = (pool.next + 1) % MAX_SAMPLE_VOICES;
        const level = this._levelGain(spec, 1, opts.vol) * this._effectiveVolume() * 0.4;
        el.volume = Math.max(0, Math.min(1, level));
        el.playbackRate = Number.isFinite(opts.rate) && opts.rate > 0 ? opts.rate : 1;
        el.currentTime = 0;
        el.play?.().catch?.(() => {});
        return true;
    }

    // ===== Kill layers (G7: ≤ 3 per listener role) =====
    // Impact: the recorded explosion when decoded, otherwise the synth — never both.
    playKillImpact() {
        if (!this._live()) return false;
        if (this._samples.has('tf2_explosion')) return this.playSample('tf2_explosion', { kill: true });
        this._decodeSample('tf2_explosion');
        this.playExplosion(true);
        return true;
    }

    // Role cue. killer: kill-confirm chime; victim: "you are dead"; observer: the
    // notification at -6 dB, pitched down when the victim was a teammate.
    playKillRoleCue(role, { teammate = false } = {}) {
        if (!this._live()) return false;
        if (role === 'killer') return this.playCue('kill-confirm');
        if (role === 'victim') return this.playSample('tf2_you_are_dead', { kill: true });
        if (role === 'observer') {
            return this.playSample('tf2_notification', {
                db: LOUDNESS_DB.observerCue, rate: teammate ? 0.8 : 1, kill: true
            });
        }
        return false;
    }

    // Kill-streak sting (music/Nkill.sfx) on the announcer bus.
    playStreakSting(file, rate = 1) {
        return this.playSample(file, { rate, kill: true });
    }

    // Match announcer sample (announce()/applyAnnounce()): announcer bus, sting level
    // at the default 0.5 announce volume.
    playAnnouncement(name, vol = 0.5) {
        const base = SAMPLE_SPECS[name];
        if (!base) return false;
        const scale = Number.isFinite(vol) && vol > 0 ? vol / 0.5 : 1;
        return this.playSample(name, {
            bus: 'announcer', db: LOUDNESS_DB.streakSting + gainToDb(scale), vol: base.nominal, kill: true, afterKillStack: true
        });
    }

    _osc(type, freq, duration, gainVal = 0.3, detune = 0, out = null) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain);
        gain.connect(out || this._out('sfx'));
        osc.start(t);
        osc.stop(t + duration);
    }

    // Soft, rounded "pock" on deflect — varies by shot type, never harsh.
    // Knife foley, synthesized (no asset files): air whoosh from band-passed noise,
    // metallic "shing" from inharmonic partials, and mechanical clicks for flips.
    // action: draw | slash | stab | heavy | inspect ; model tweaks the character.
    playKnife(action = 'slash', model = 'classic') {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const out = this._out('sfx');
        if (action === 'slash' || action === 'heavy') {
            const heavy = action === 'heavy';
            this._knifeWhoosh(t, heavy ? 0.26 : 0.2, heavy ? 0.22 : 0.17, heavy ? 700 : 950, heavy ? 2600 : 3400, out);
            // Low body layer under the bright air so the swing has weight, not just hiss.
            this._knifeWhoosh(t + 0.015, heavy ? 0.3 : 0.23, heavy ? 0.09 : 0.06, 260, 780, out);
            if (heavy) this._knifeThump(t + 0.05, 0.1, out);
        } else if (action === 'stab') {
            this._knifeWhoosh(t, 0.14, 0.15, 1200, 2800, out);
            this._knifeThump(t + 0.06, 0.08, out);
        } else if (action === 'draw') {
            // Unsheathe: rising scrape, then a short bright ring.
            this._knifeScrape(t, 0.22, 0.08, out);
            this._knifeRing(t + 0.2, 0.055, model === 'karambit' ? 1.12 : 1, out);
            if (model === 'butterfly') this._knifeClicks(t + 0.04, 3, 0.07, out);
        } else if (action === 'twirl') {
            this._knifeWhoosh(t + 0.06, 0.34, 0.07, 600, 2400, out);
            if (model === 'butterfly') this._knifeClicks(t + 0.05, 4, 0.08, out);
            else this._knifeRing(t + 0.5, 0.03, 1.35, out);
        } else if (action === 'inspect') {
            this._knifeRing(t + 0.05, 0.04, 1.2, out);
            this._knifeScrape(t + 0.45, 0.28, 0.035, out);
            if (model === 'butterfly') this._knifeClicks(t + 0.3, 5, 0.09, out);
            else if (model === 'karambit') this._knifeWhoosh(t + 0.35, 0.3, 0.06, 500, 1800, out);
        }
    }

    _knifeNoiseBuffer() {
        if (this._knifeNoise) return this._knifeNoise;
        const length = Math.floor(this.ctx.sampleRate * 0.6);
        const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this._knifeNoise = buffer;
        return buffer;
    }

    _knifeWhoosh(t, duration, peak, fromHz, toHz, out) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._knifeNoiseBuffer();
        const band = this.ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 1.4;
        band.frequency.setValueAtTime(fromHz, t);
        band.frequency.exponentialRampToValueAtTime(toHz, t + duration * 0.45);
        band.frequency.exponentialRampToValueAtTime(fromHz * 0.6, t + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + duration * 0.35);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.connect(band); band.connect(gain); gain.connect(out);
        src.start(t);
        src.stop(t + duration + 0.02);
    }

    _knifeScrape(t, duration, peak, out) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._knifeNoiseBuffer();
        const high = this.ctx.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.value = 2500;
        const band = this.ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 6;
        band.frequency.setValueAtTime(3200, t);
        band.frequency.linearRampToValueAtTime(6200, t + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(peak, t + duration * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.connect(high); high.connect(band); band.connect(gain); gain.connect(out);
        src.start(t);
        src.stop(t + duration + 0.02);
    }

    // Metallic ring: inharmonic partials with fast, staggered decays read as steel.
    _knifeRing(t, peak, pitch, out) {
        const partials = [[2310, 1, 0.5], [3690, 0.6, 0.32], [5270, 0.4, 0.22], [7110, 0.25, 0.14]];
        for (const [hz, amp, decay] of partials) {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(hz * pitch, t);
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(peak * amp, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
            osc.connect(gain); gain.connect(out);
            osc.start(t);
            osc.stop(t + decay + 0.02);
        }
    }

    _knifeThump(t, peak, out) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(peak, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        osc.connect(gain); gain.connect(out);
        osc.start(t);
        osc.stop(t + 0.12);
    }

    _knifeClicks(t, count, spacing, out) {
        for (let i = 0; i < count; i++) {
            const at = t + i * spacing * (0.85 + (i % 2) * 0.3);
            const src = this.ctx.createBufferSource();
            src.buffer = this._knifeNoiseBuffer();
            const band = this.ctx.createBiquadFilter();
            band.type = 'bandpass';
            band.Q.value = 9;
            band.frequency.value = 4200 + (i % 3) * 600;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.09, at);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.025);
            src.connect(band); band.connect(gain); gain.connect(out);
            src.start(at, (i * 0.037) % 0.5);
            src.stop(at + 0.03);
        }
    }

    playDeflect(shot = 'flat', pos = null) {
        if (!this._live()) return;
        // Foley is a quiet body layer; the synth below keeps spike/lob/flat
        // readable through their distinct pitch, envelope and spike thump.
        this._playKenneyClip('deflect-soft', shot === 'spike' ? 0.16 : 0.11, 55);
        const t = this.ctx.currentTime;
        const output = this._synthOut('sfx', SYNTH_TRIMS.deflect, false, pos);

        // Base pitch by shot: spike = punchy/low, lob = soft/high, flat = mid.
        const base = shot === 'spike' ? 520 : shot === 'lob' ? 900 : 700;
        const peak = shot === 'spike' ? 1.0 : 0.7;

        // Rounded body — quick pitch drop = "pock" not "ping".
        const osc1 = this.ctx.createOscillator();
        const g1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(base * 1.6, t);
        osc1.frequency.exponentialRampToValueAtTime(base, t + 0.06);
        g1.gain.setValueAtTime(0.0001, t);
        g1.gain.exponentialRampToValueAtTime(0.22 * peak, t + 0.008); // soft attack
        g1.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc1.connect(g1);
        g1.connect(output);
        osc1.start(t);
        osc1.stop(t + 0.24);

        // Warm triangle sub-layer for body (no shrill overtones).
        const osc2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = base * 0.5;
        g2.gain.setValueAtTime(0.12 * peak, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc2.connect(g2);
        g2.connect(output);
        osc2.start(t);
        osc2.stop(t + 0.2);

        // Spike gets a tiny extra "thwack" thump.
        if (shot === 'spike') {
            const osc3 = this.ctx.createOscillator();
            const g3 = this.ctx.createGain();
            osc3.type = 'sine';
            osc3.frequency.setValueAtTime(180, t);
            osc3.frequency.exponentialRampToValueAtTime(90, t + 0.12);
            g3.gain.setValueAtTime(0.18, t);
            g3.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc3.connect(g3);
            g3.connect(output);
            osc3.start(t);
            osc3.stop(t + 0.16);
        }
    }

    // Soft thud + cute "bonk" on hit
    playHit(pos = null) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const output = this._synthOut('sfx', SYNTH_TRIMS.hit, false, pos);

        // Low bonk
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(g);
        g.connect(output);
        osc.start(t);
        osc.stop(t + 0.3);

        // Comedic descending slide
        const osc2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(600, t + 0.05);
        osc2.frequency.exponentialRampToValueAtTime(150, t + 0.35);
        g2.gain.setValueAtTime(0.15, t + 0.05);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc2.connect(g2);
        g2.connect(output);
        osc2.start(t + 0.05);
        osc2.stop(t + 0.4);
    }

    // Gentle airy "swish" — soft-pass filtered noise that sweeps down.
    // Quiet and rounded; no bandpass scream, no harshness at high speed.
    playWhoosh(speed, pos = null) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const output = this._spatialOutput(pos);
        const dur = 0.16;
        const bufSize = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        // Smooth bell envelope so it fades in AND out — no clicky edges.
        for (let i = 0; i < bufSize; i++) {
            const env = Math.sin(Math.PI * i / bufSize);
            data[i] = (Math.random() * 2 - 1) * env * env * 0.09;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;

        // Low-pass that sweeps downward = soft "swishhh" trailing off.
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.7;
        const startF = 1400 + Math.min(speed, 30) * 20;
        filter.frequency.setValueAtTime(startF, t);
        filter.frequency.exponentialRampToValueAtTime(500, t + dur);

        const g = this.ctx.createGain();
        g.gain.value = 0.11;
        src.connect(filter);
        filter.connect(g);
        g.connect(output);
        src.start(t);
    }

    // A dash is a compact movement confirmation, not a ball throw: a low body
    // with a small rising air tick. It uses no noise buffer and stays beneath
    // the 0.11 throw-whoosh peak so deflect/throw feedback remains dominant.
    playDash() {
        if (!this.ctx || !this.masterGain || this._effectiveVolume() <= 0) return false;
        if (this.ctx.state === 'suspended') {
            this._resumeAudioContext().then(running => {
                if (running && this.masterGain && this._effectiveVolume() > 0) this._playDashNow();
            });
            return false;
        }
        this._playDashNow();
        return true;
    }

    _playDashNow() {
        const t = this.ctx.currentTime;
        const out = this._out('sfx');
        const body = this.ctx.createOscillator();
        const bodyGain = this.ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(330, t);
        body.frequency.exponentialRampToValueAtTime(225, t + 0.11);
        bodyGain.gain.setValueAtTime(0.0001, t);
        bodyGain.gain.exponentialRampToValueAtTime(0.075, t + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        body.connect(bodyGain);
        bodyGain.connect(out);
        body.start(t);
        body.stop(t + 0.13);

        const air = this.ctx.createOscillator();
        const airGain = this.ctx.createGain();
        air.type = 'sine';
        air.frequency.setValueAtTime(980, t);
        air.frequency.exponentialRampToValueAtTime(1480, t + 0.075);
        airGain.gain.setValueAtTime(0.0001, t);
        airGain.gain.exponentialRampToValueAtTime(0.018, t + 0.006);
        airGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        air.connect(airGain);
        airGain.connect(out);
        air.start(t);
        air.stop(t + 0.1);
    }

    // Clean musical "ding" — for XP bar, level-up, etc.
    playDing(freq = 880, vol = 0.15) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(g);
        g.connect(this._out('ui'));
        osc.start(t);
        osc.stop(t + 0.3);
    }

    playVoicePing(kind = 'incoming') {
        if (!this._live()) return;
        const notes = { incoming: [740, 620, 740], help: [430, 370, 430], save: [660, 830, 990] }[kind] || [600, 760];
        notes.forEach((note, index) => setTimeout(() => this._osc('triangle', note, 0.12, 0.1, 0, this._out('ui')), index * 95));
    }

    // UI click — short tick for menu buttons
    playClick() {
        if (!this._live()) return;
        if (this._playKenneyClip('ui-click', 0.24, 45)) return;
        const out = this._synthOut('ui', SYNTH_TRIMS.click);
        this._osc('square', 800, 0.03, 0.08, 0, out);
        this._osc('sine', 1200, 0.02, 0.04, 0, out);
    }
    // UI hover — subtle pip
    playHover() {
        if (!this._live()) return;
        if (this._playKenneyClip('ui-hover', 0.1, 70)) return;
        this._osc('sine', 600, 0.015, 0.03, 0, this._out('ui'));
    }

    // Friendly beep — round countdown
    playBeep(pitch = 440) {
        if (!this._live()) return;
        const out = this._out('announcer');
        this._osc('sine', pitch, 0.15, 0.2, 0, out);
        this._osc('sine', pitch * 2, 0.1, 0.05, 0, out);
    }

    // Quiet low warning for the one-time first-match aim correction.
    playDeflectReject() {
        if (!this._live()) return;
        if (this._playKenneyClip('deflect-reject', 0.13, 200)) return;
        const out = this._out('ui');
        this._osc('triangle', 240, 0.07, 0.04, 0, out);
        this._osc('sine', 160, 0.05, 0.025, 0, out);
    }

    // Happy GO chord
    playGo() {
        [523, 659, 784].forEach((f, i) => {
            setTimeout(() => this._osc('sine', f, 0.3, 0.2, 0, this._out('announcer')), i * 40);
        });
    }

    // Gentle speed tick — not alarming
    playSpeedWarning(speed) {
        if (!this._live()) return;
        this._osc('sine', 300 + speed * 5, 0.06, 0.06);
    }

    // OVERDRIVE entry — synthesized (no asset): a short rising saw sweep under
    // a bright two-note stab, ~0.3 s, distinct from the speed tick and threat cues.
    playOverdriveEnter() {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const out = this._synthOut('announcer', SYNTH_TRIMS.overdrive);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.22);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + 0.3);
        this._osc('square', 1175, 0.12, 0.05, 0, out);
        this._osc('square', 1568, 0.16, 0.04, 0, out);
        this._traceEvent({ kind: 'layer', name: 'overdrive-enter', bus: 'announcer', gain: SYNTH_TRIMS.overdrive });
    }

    // Victory jingle
    playScore() {
        if (!this._live()) return;
        if (this._playKenneyClip('ui-confirm', 0.3, 500)) return;
        [523, 587, 659, 784, 1047].forEach((f, i) => {
            setTimeout(() => this._osc('sine', f, 0.25, 0.15, 0, this._out('ui')), i * 80);
        });
    }

    // Bounce sound — soft rounded "boing" that bends down in pitch.
    playBounce(pos = null) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const output = this._spatialOutput(pos);
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.1, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(output);
        osc.start(t);
        osc.stop(t + 0.13);
    }

    // Jump sound
    playJump() {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.linearRampToValueAtTime(500, t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(g);
        g.connect(this._out('sfx'));
        osc.start(t);
        osc.stop(t + 0.15);
    }

    // Soft landing thud
    playLand() {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(this._out('sfx'));
        osc.start(t);
        osc.stop(t + 0.13);
    }

    // Death explosion — pop. kill: the synth kill impact (playKillImpact's fallback
    // when the recorded explosion isn't decoded) — trimmed to the impact level,
    // enters after the duck stage and ducks the rest.
    playExplosion(kill = false) {
        if (!this._live()) return;
        const t = this.ctx.currentTime;
        const out = kill ? this._synthOut('sfx', SYNTH_TRIMS.explosion, true) : this._out('sfx');
        // Pop
        this._osc('sine', 150, 0.2, 0.3, 0, out);
        // Crackle
        const bufSize = Math.floor(this.ctx.sampleRate * 0.15);
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.3)) * 0.2;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.value = 0.2;
        src.connect(g);
        g.connect(out);
        src.start(t + 0.05);
        this._traceEvent({ kind: 'layer', name: 'synth-explosion', bus: 'sfx', priority: kill, gain: kill ? SYNTH_TRIMS.explosion : 1 });
        if (kill) {
            this._markKillLayer();
            this.duck('kill-impact', 0.2);
        }
    }

    // Chat message pop
    playChat() {
        this._osc('sine', 800, 0.05, 0.08, 0, this._out('ui'));
    }

    // Respawn — soft rising "materialize" swell (0.12 peak) followed by a bright
    // confirm ding (0.08) once the swell lands. Distinct from jump/land (grounded
    // thuds) and score/go (multi-note fanfares reserved for round transitions).
    playRespawn() {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.22);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(g);
        g.connect(this._out('sfx'));
        osc.start(t);
        osc.stop(t + 0.32);
        setTimeout(() => this._osc('sine', 990, 0.15, 0.08), 200);
    }

    // Equip change — quick two-tone "swap" tick (0.07/0.06), for character/knife
    // loadout changes. Distinct from ui-click (menu nav) so equipping reads as a
    // confirmed action rather than just another button press.
    playEquipChange() {
        if (!this._live()) return;
        this._osc('square', 500, 0.04, 0.07, 0, this._out('ui'));
        setTimeout(() => this._osc('square', 760, 0.04, 0.06, 0, this._out('ui')), 45);
    }

    // Settings apply — short affirmative two-note chime (0.1/0.1), calmer than
    // playGo's 3-note round-start fanfare (that one stays reserved for match/round
    // transitions).
    playSettingsApply() {
        if (!this._live()) return;
        this._osc('sine', 660, 0.12, 0.1, 0, this._out('ui'));
        setTimeout(() => this._osc('sine', 880, 0.16, 0.1, 0, this._out('ui')), 70);
    }

    // Kill-confirm "hot ball" window opened — quick rising three-note power-up
    // chime with a shimmering tail. Distinct from the escalating streak/combo
    // fanfares (comboSounds in game.js): those celebrate the kill itself, this
    // one signals "your next hit is buffed", so it stays short and singular
    // rather than layering onto the kill sound.
    playKillConfirm() {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        // Killer role cue: announcer bus after the duck stage, then ducks the rest.
        const out = this._synthOut('announcer', SYNTH_TRIMS.killConfirm, true);
        this._traceEvent({ kind: 'layer', name: 'kill-confirm', bus: 'announcer', priority: true, gain: SYNTH_TRIMS.killConfirm });
        this._markKillLayer();
        this.duck('kill-confirm', 0.2);
        // One voice stepping 660 → 880 → 1180 Hz, each step re-struck, so the whole
        // cue is a single source in the kill stack (was three overlapping ones).
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0.0001, t);
        [660, 880, 1180].forEach((freq, i) => {
            const start = t + i * 0.045;
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.exponentialRampToValueAtTime(0.09, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(i === 2 ? 0.001 : 0.03, start + (i === 2 ? 0.16 : 0.044));
        });
        osc.connect(gain);
        gain.connect(out);
        osc.start(t);
        osc.stop(t + 0.09 + 0.18);
    }

    // Case-reel tick — a very short (~4ms) click as a tile crosses the center
    // marker while the case reel spins. Deliberately far shorter than every
    // other cue here (playDing/playClick are 20-300ms): 20-30 of these fire
    // across one 6-7s spin, so anything longer would blur into a buzz instead
    // of a mechanical tick-tick-tick. `pitchMul` rises slightly as the reel
    // approaches its target tile (see js/ui.js _scheduleReelTicks), so the
    // last few ticks read as "spinning down" rather than a flat metronome.
    playCaseTick(pitchMul = 1) {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const freq = 1300 * Math.max(0.7, Math.min(2, Number(pitchMul) || 1));
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.004);
        osc.connect(gain);
        gain.connect(this._out('ui'));
        osc.start(t);
        osc.stop(t + 0.006);
    }

    // Case-reel detent, synthesized in the same style as the knife foley above:
    // a band-passed noise "click" (the pawl) over a short pitched "tock" (the body).
    // `progress` is 0..1 through the spin and `gapMs` the time since the previous
    // tick — as the reel slows the gaps widen, so the tick gets lower, fuller and a
    // little louder, and its tail rings longer. The last crawling ticks land like a
    // ratchet instead of the flat 4ms beep of playCaseTick.
    playCaseReelTick(progress = 0, gapMs = 60) {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        const slow = Math.max(0, Math.min(1, ((Number(gapMs) || 0) - 25) / 260));
        const out = this._out('ui');
        const click = this.ctx.createBufferSource();
        click.buffer = this._knifeNoiseBuffer();
        const band = this.ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = 3.5;
        band.frequency.value = 4600 - slow * 1500;
        const clickGain = this.ctx.createGain();
        const clickDecay = 0.008 + slow * 0.014;
        clickGain.gain.setValueAtTime(0.07 + slow * 0.05 + p * 0.02, t);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, t + clickDecay);
        click.connect(band); band.connect(clickGain); clickGain.connect(out);
        click.start(t, (p * 0.37) % 0.5);
        click.stop(t + clickDecay + 0.01);

        const body = this.ctx.createOscillator();
        body.type = 'triangle';
        const pitch = 1250 - slow * 520 + p * 90;
        body.frequency.setValueAtTime(pitch, t);
        body.frequency.exponentialRampToValueAtTime(pitch * 0.72, t + 0.03 + slow * 0.03);
        const bodyGain = this.ctx.createGain();
        const bodyDecay = 0.022 + slow * 0.05;
        bodyGain.gain.setValueAtTime(0.0001, t);
        bodyGain.gain.exponentialRampToValueAtTime(0.045 + slow * 0.05, t + 0.002);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + bodyDecay);
        body.connect(bodyGain); bodyGain.connect(out);
        body.start(t);
        body.stop(t + bodyDecay + 0.01);
    }

    // Reveal sting under the 3D reveal stage. rare: a soft steel shimmer; epic: a
    // rising shimmer + ring; legendary/exotic: sub boom, bright rising sweep, a
    // three-note steel chord and a long ring tail — deliberately bigger than epic.
    playCaseRevealSting(rarity = 'rare') {
        if (!this._live() || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const out = this._out('ui');
        const key = String(rarity || '').toLowerCase();
        if (key === 'legendary' || key === 'exotic') {
            const boom = this.ctx.createOscillator();
            boom.type = 'sine';
            boom.frequency.setValueAtTime(95, t);
            boom.frequency.exponentialRampToValueAtTime(38, t + 0.55);
            const boomGain = this.ctx.createGain();
            boomGain.gain.setValueAtTime(0.0001, t);
            boomGain.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
            boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
            boom.connect(boomGain); boomGain.connect(out);
            boom.start(t);
            boom.stop(t + 0.75);
            this._knifeWhoosh(t, 0.55, 0.12, 500, 5200, out);
            this._knifeRing(t + 0.06, 0.07, 0.9, out);
            this._knifeRing(t + 0.14, 0.06, 1.2, out);
            this._knifeRing(t + 0.22, 0.055, 1.5, out);
            [523.25, 659.25, 783.99, 1046.5].forEach((hz, index) => {
                const osc = this.ctx.createOscillator();
                osc.type = 'triangle';
                const start = t + 0.08 + index * 0.05;
                osc.frequency.setValueAtTime(hz, start);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.3);
                osc.connect(gain); gain.connect(out);
                osc.start(start);
                osc.stop(start + 1.35);
            });
            return;
        }
        if (key === 'epic') {
            this._knifeWhoosh(t, 0.36, 0.08, 700, 4200, out);
            this._knifeRing(t + 0.05, 0.055, 1.1, out);
            this._knifeRing(t + 0.16, 0.04, 1.4, out);
            return;
        }
        if (key === 'rare') {
            this._knifeRing(t + 0.02, 0.035, 1.25, out);
        }
    }
}
