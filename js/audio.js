// audio.js — Friendly, smooth, cute synthesized SFX
const THREAT_ENTER_SECONDS = [Infinity, 1.8, 0.9, 0.42];
const THREAT_COOLDOWN_MS = [Infinity, 1300, 850, 450];
const THREAT_EXIT_FACTOR = 1.25;

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
        this.soundVolume = 0.5;
        this._threatAudioState = createThreatAudioState();
        this._threatCueGeneration = 0;
        this._contextResumePromise = null;
        this._buffers = {}; // name → AudioBuffer cache
        this._kenneyBuffers = new Map();
        this._kenneyLoads = new Map();
        this._kenneyLastPlayed = Object.create(null);
        // Reused objects for the positional-audio listener — updated in place
        // from setListener() every frame, never reallocated.
        this._listenerPos = { x: 0, y: 0, z: 0 };
        this._listenerFwd = { x: 0, z: -1 };
        this._listenerSet = false;
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
    // With no listener/position (today's behaviour) that's masterGain
    // directly. With both set, builds a small gain->panner->masterGain chain
    // (created per one-shot sound, same lifecycle as the oscillators/buffers
    // themselves — no per-frame allocation).
    _spatialOutput(pos) {
        if (!pos || !this._listenerSet || !this.ctx || !this.masterGain) return this.masterGain;
        const panner = this.ctx.createStereoPanner?.();
        if (!panner) return this.masterGain;
        const { pan, gain } = computeStereoPan(this._listenerPos, this._listenerFwd.x, this._listenerFwd.z, pos);
        const spatialGain = this.ctx.createGain();
        spatialGain.gain.value = gain;
        panner.pan.value = pan;
        spatialGain.connect(panner);
        panner.connect(this.masterGain);
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
        if (this.soundVolume <= 0) return false;
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

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this._resumeAudioContext();
            return;
        }
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('AudioContext:', e);
            return;
        }
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.soundVolume * 0.4;

        // Soften everything: gentle low-pass rolls off harsh highs, then a
        // compressor/limiter tames peaks so nothing ever screeches.
        this.tone = this.ctx.createBiquadFilter();
        this.tone.type = 'lowpass';
        this.tone.frequency.value = 3200;
        this.tone.Q.value = 0.5;

        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -14;
        this.limiter.knee.value = 24;
        this.limiter.ratio.value = 8;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.2;

        this.masterGain.connect(this.tone);
        this.tone.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);
        if (this.ctx.state === 'suspended') this._resumeAudioContext();
    }

    setVolume(v) {
        this.setSoundVolume(v);
    }

    setSoundVolume(v) {
        this.soundVolume = Math.max(0, Math.min(1, Number(v) || 0));
        this.volume = this.soundVolume;
        if (this.masterGain) this.masterGain.gain.value = this.soundVolume * 0.4;
        for (const sound of Object.values(this._sfxAudios || {})) sound.volume = this.soundVolume;
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
        if (result.cue) this.playThreatCue(result.cue);
        return result.cue;
    }

    playThreatCue(urgency = 1) {
        const generation = ++this._threatCueGeneration;
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return;
        const level = Math.max(1, Math.min(3, Math.floor(urgency)));
        if (this.ctx.state === 'suspended') {
            this._resumeAudioContext().then(running => {
                if (!running
                    || generation !== this._threatCueGeneration
                    || !this.masterGain
                    || this.soundVolume <= 0) return;
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
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return false;
        const buffer = this._kenneyBuffers.get(name);
        if (!buffer) {
            this._loadKenneyClip(name);
            return false;
        }
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const lastPlayed = this._kenneyLastPlayed[name];
        if (Number.isFinite(lastPlayed) && now - lastPlayed < minGapMs) return true;
        const source = this.ctx.createBufferSource?.();
        const gain = this.ctx.createGain?.();
        if (!source || !gain) return false;
        source.buffer = buffer;
        gain.gain.value = gainValue;
        source.connect(gain);
        gain.connect(this.masterGain);
        source.start(this.ctx.currentTime);
        this._kenneyLastPlayed[name] = now;
        return true;
    }

    _playThreatCueNow(level) {
        const t = this.ctx.currentTime;
        const pulse = (type, frequency, offset, duration, gainValue) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, t + offset);
            gain.gain.exponentialRampToValueAtTime(gainValue, t + offset + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.001, t + offset + duration);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(t + offset);
            osc.stop(t + offset + duration + 0.01);
        };

        pulse('sine', 300 + level * 55, 0, 0.15, 0.07);
        if (level >= 2) pulse('triangle', 520 + level * 70, 0.07, 0.13, 0.055);
        if (level >= 3) pulse('square', 920, 0.14, 0.08, 0.025);
    }

    // Preload TF2 sfx via fetch+blob. Uses .sfx aliases so IDM doesn't grab .mp3 URLs.
    async preloadSfx(basePath) {
        const sounds = ['tf2_crit', 'tf2_domination', 'tf2_explosion', 'tf2_hit', 'tf2_you_are_dead', 'tf2_victory', 'tf2_scout_scream', 'tf2_notification', 'tf2_frying_pan', 'tf2_medic', 'tf2_you_failed', 'rocket_fire'];
        this._sfxAudios = {};
        for (const name of sounds) {
            const url = `${basePath}${name}.sfx`;
            try {
                const resp = await fetch(url);
                const blob = new Blob([await resp.arrayBuffer()], { type: 'audio/mpeg' });
                const objUrl = URL.createObjectURL(blob);
                const a = document.createElement('audio');
                a.preload = 'auto';
                a.src = objUrl;
                this._sfxAudios[name] = a;
            } catch (e) {
                console.warn(`SFX load failed: ${name}`, e);
            }
        }
    }

    // Play a preloaded TF2 sfx. Volume 0-1, defaults to 0.5. rate is HTMLMediaElement
    // playbackRate (default 1 = unchanged pitch) — used by the combo-tier pitch ramp
    // in js/game.js so escalating combos/streaks sound bigger, not just louder.
    playSfx(name, vol = 0.5, rate = 1) {
        const a = this._sfxAudios?.[name];
        if (!a) return;
        a.volume = vol * this.soundVolume;
        a.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
        a.currentTime = 0;
        a.play().catch(() => {}); // ignore autoplay blocking
    }

    _osc(type, freq, duration, gainVal = 0.3, detune = 0) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + duration);
    }

    // Soft, rounded "pock" on deflect — varies by shot type, never harsh.
    // Knife foley, synthesized (no asset files): air whoosh from band-passed noise,
    // metallic "shing" from inharmonic partials, and mechanical clicks for flips.
    // action: draw | slash | stab | heavy | inspect ; model tweaks the character.
    playKnife(action = 'slash', model = 'classic') {
        if (!this.ctx || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const out = this.masterGain;
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
        if (!this.ctx) return;
        // Foley is a quiet body layer; the synth below keeps spike/lob/flat
        // readable through their distinct pitch, envelope and spike thump.
        this._playKenneyClip('deflect-soft', shot === 'spike' ? 0.16 : 0.11, 55);
        const t = this.ctx.currentTime;
        const output = this._spatialOutput(pos);

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
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const output = this._spatialOutput(pos);

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
        if (!this.ctx) return;
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
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return false;
        if (this.ctx.state === 'suspended') {
            this._resumeAudioContext().then(running => {
                if (running && this.masterGain && this.soundVolume > 0) this._playDashNow();
            });
            return false;
        }
        this._playDashNow();
        return true;
    }

    _playDashNow() {
        const t = this.ctx.currentTime;
        const body = this.ctx.createOscillator();
        const bodyGain = this.ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(330, t);
        body.frequency.exponentialRampToValueAtTime(225, t + 0.11);
        bodyGain.gain.setValueAtTime(0.0001, t);
        bodyGain.gain.exponentialRampToValueAtTime(0.075, t + 0.006);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        body.connect(bodyGain);
        bodyGain.connect(this.masterGain);
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
        airGain.connect(this.masterGain);
        air.start(t);
        air.stop(t + 0.1);
    }

    // Clean musical "ding" — for XP bar, level-up, etc.
    playDing(freq = 880, vol = 0.15) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.3);
    }

    playVoicePing(kind = 'incoming') {
        if (!this.ctx) return;
        const notes = { incoming: [740, 620, 740], help: [430, 370, 430], save: [660, 830, 990] }[kind] || [600, 760];
        notes.forEach((note, index) => setTimeout(() => this._osc('triangle', note, 0.12, 0.1), index * 95));
    }

    // UI click — short tick for menu buttons
    playClick() {
        if (!this.ctx) return;
        if (this._playKenneyClip('ui-click', 0.24, 45)) return;
        this._osc('square', 800, 0.03, 0.08);
        this._osc('sine', 1200, 0.02, 0.04);
    }
    // UI hover — subtle pip
    playHover() {
        if (!this.ctx) return;
        if (this._playKenneyClip('ui-hover', 0.1, 70)) return;
        this._osc('sine', 600, 0.015, 0.03);
    }

    // Friendly beep — round countdown
    playBeep(pitch = 440) {
        if (!this.ctx) return;
        this._osc('sine', pitch, 0.15, 0.2);
        this._osc('sine', pitch * 2, 0.1, 0.05);
    }

    // Quiet low warning for the one-time first-match aim correction.
    playDeflectReject() {
        if (!this.ctx) return;
        if (this._playKenneyClip('deflect-reject', 0.13, 200)) return;
        this._osc('triangle', 240, 0.07, 0.04);
        this._osc('sine', 160, 0.05, 0.025);
    }

    // Happy GO chord
    playGo() {
        [523, 659, 784].forEach((f, i) => {
            setTimeout(() => this._osc('sine', f, 0.3, 0.2), i * 40);
        });
    }

    // Gentle speed tick — not alarming
    playSpeedWarning(speed) {
        if (!this.ctx) return;
        this._osc('sine', 300 + speed * 5, 0.06, 0.06);
    }

    // OVERDRIVE entry — synthesized (no asset): a short rising saw sweep under
    // a bright two-note stab, ~0.3 s, distinct from the speed tick and threat cues.
    playOverdriveEnter() {
        if (!this.ctx || !this.masterGain) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.22);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.3);
        this._osc('square', 1175, 0.12, 0.05);
        this._osc('square', 1568, 0.16, 0.04);
    }

    // Victory jingle
    playScore() {
        if (this._playKenneyClip('ui-confirm', 0.3, 500)) return;
        [523, 587, 659, 784, 1047].forEach((f, i) => {
            setTimeout(() => this._osc('sine', f, 0.25, 0.15), i * 80);
        });
    }

    // Bounce sound — soft rounded "boing" that bends down in pitch.
    playBounce(pos = null) {
        if (!this.ctx) return;
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
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.linearRampToValueAtTime(500, t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.15);
    }

    // Soft landing thud
    playLand() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.1);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.13);
    }

    // Death explosion — pop
    playExplosion() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        // Pop
        this._osc('sine', 150, 0.2, 0.3);
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
        g.connect(this.masterGain);
        src.start(t + 0.05);
    }

    // Chat message pop
    playChat() {
        this._osc('sine', 800, 0.05, 0.08);
    }

    // Respawn — soft rising "materialize" swell (0.12 peak) followed by a bright
    // confirm ding (0.08) once the swell lands. Distinct from jump/land (grounded
    // thuds) and score/go (multi-note fanfares reserved for round transitions).
    playRespawn() {
        if (!this.ctx || !this.masterGain) return;
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
        g.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.32);
        setTimeout(() => this._osc('sine', 990, 0.15, 0.08), 200);
    }

    // Equip change — quick two-tone "swap" tick (0.07/0.06), for character/knife
    // loadout changes. Distinct from ui-click (menu nav) so equipping reads as a
    // confirmed action rather than just another button press.
    playEquipChange() {
        if (!this.ctx) return;
        this._osc('square', 500, 0.04, 0.07);
        setTimeout(() => this._osc('square', 760, 0.04, 0.06), 45);
    }

    // Settings apply — short affirmative two-note chime (0.1/0.1), calmer than
    // playGo's 3-note round-start fanfare (that one stays reserved for match/round
    // transitions).
    playSettingsApply() {
        if (!this.ctx) return;
        this._osc('sine', 660, 0.12, 0.1);
        setTimeout(() => this._osc('sine', 880, 0.16, 0.1), 70);
    }

    // Kill-confirm "hot ball" window opened — quick rising three-note power-up
    // chime with a shimmering tail. Distinct from the escalating streak/combo
    // fanfares (comboSounds in game.js): those celebrate the kill itself, this
    // one signals "your next hit is buffed", so it stays short and singular
    // rather than layering onto the kill sound.
    playKillConfirm() {
        if (!this.ctx || !this.masterGain) return;
        const t = this.ctx.currentTime;
        [660, 880, 1180].forEach((freq, i) => {
            const start = t + i * 0.045;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.09, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(start);
            osc.stop(start + 0.18);
        });
    }

    // Case-reel tick — a very short (~4ms) click as a tile crosses the center
    // marker while the case reel spins. Deliberately far shorter than every
    // other cue here (playDing/playClick are 20-300ms): 20-30 of these fire
    // across one 6-7s spin, so anything longer would blur into a buzz instead
    // of a mechanical tick-tick-tick. `pitchMul` rises slightly as the reel
    // approaches its target tile (see js/ui.js _scheduleReelTicks), so the
    // last few ticks read as "spinning down" rather than a flat metronome.
    playCaseTick(pitchMul = 1) {
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return;
        const t = this.ctx.currentTime;
        const freq = 1300 * Math.max(0.7, Math.min(2, Number(pitchMul) || 1));
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.004);
        osc.connect(gain);
        gain.connect(this.masterGain);
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
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return;
        const t = this.ctx.currentTime;
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        const slow = Math.max(0, Math.min(1, ((Number(gapMs) || 0) - 25) / 260));
        const out = this.masterGain;
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
        if (!this.ctx || !this.masterGain || this.soundVolume <= 0) return;
        const t = this.ctx.currentTime;
        const out = this.masterGain;
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
