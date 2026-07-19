// audio.js — Friendly, smooth, cute synthesized SFX
export class Audio {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.volume = 0.5;
        this.soundVolume = 0.5;
        this._buffers = {}; // name → AudioBuffer cache
    }

    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Bazı browser'larda AudioContext suspended başlar — resume gerek
            if (this.ctx.state === 'suspended') this.ctx.resume();
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

    // Play a preloaded TF2 sfx. Volume 0-1, defaults to 0.5.
    playSfx(name, vol = 0.5) {
        const a = this._sfxAudios?.[name];
        if (!a) return;
        a.volume = vol * this.soundVolume;
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
    playDeflect(shot = 'flat') {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;

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
        g1.connect(this.masterGain);
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
        g2.connect(this.masterGain);
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
            g3.connect(this.masterGain);
            osc3.start(t);
            osc3.stop(t + 0.16);
        }
    }

    // Soft thud + cute "bonk" on hit
    playHit() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;

        // Low bonk
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.25);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(g);
        g.connect(this.masterGain);
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
        g2.connect(this.masterGain);
        osc2.start(t + 0.05);
        osc2.stop(t + 0.4);
    }

    // Gentle airy "swish" — soft-pass filtered noise that sweeps down.
    // Quiet and rounded; no bandpass scream, no harshness at high speed.
    playWhoosh(speed) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
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
        g.connect(this.masterGain);
        src.start(t);
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
        this._osc('square', 800, 0.03, 0.08);
        this._osc('sine', 1200, 0.02, 0.04);
    }
    // UI hover — subtle pip
    playHover() {
        if (!this.ctx) return;
        this._osc('sine', 600, 0.015, 0.03);
    }

    // Friendly beep — round countdown
    playBeep(pitch = 440) {
        if (!this.ctx) return;
        this._osc('sine', pitch, 0.15, 0.2);
        this._osc('sine', pitch * 2, 0.1, 0.05);
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

    // Victory jingle
    playScore() {
        [523, 587, 659, 784, 1047].forEach((f, i) => {
            setTimeout(() => this._osc('sine', f, 0.25, 0.15), i * 80);
        });
    }

    // Bounce sound — soft rounded "boing" that bends down in pitch.
    playBounce() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.1, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g);
        g.connect(this.masterGain);
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
}
