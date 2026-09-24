// G7 — one audio bus. Every sound (recorded samples, Kenney foley, synth cues, combo
// stings) rides one Web Audio graph: layer → category bus → master → 12 kHz low-pass
// → limiter. Runs the real js/audio.js (and the real Game kill/announce methods out
// of js/game.js) against a fake AudioContext that records every node, connection,
// source start and gain automation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    Audio,
    AUDIO_BUSES,
    DECODED_BUDGET_BYTES,
    DUCK,
    KILL_STACK_WINDOW,
    LOUDNESS_DB,
    MAX_SAMPLE_VOICES,
    REAR_THREAT_DOT,
    REFERENCE_PEAK,
    SYNTH_PEAKS,
    SYNTH_TRIMS,
    TONE_CUTOFF_HZ,
    computeThreatVoicing,
    dbToGain,
    gainToDb
} from '../js/audio.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

// ---------------------------------------------------------------------------
// Fake Web Audio
class FakeParam {
    constructor(value) {
        this.value = value;
        this.events = [];
    }
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; }
    linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); }
    exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); }
    setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); }
    cancelScheduledValues(t) { this.events.push(['cancel', t]); }
    cancelAndHoldAtTime(t) { this.events.push(['hold', t]); }
}

class FakeNode {
    constructor(ctx, kind) {
        this.ctx = ctx;
        this.kind = kind;
        this.outputs = [];
        ctx.nodes.push(this);
    }
    connect(node) { this.outputs.push(node); return node; }
    disconnect() { this.outputs.length = 0; }
}

const FAKE_RATE = 1000; // tiny fake buffers keep the byte math readable

class FakeAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 1;
        this.sampleRate = FAKE_RATE;
        this.nodes = [];
        this.started = []; // every source start: { kind, node, at }
        this.destination = new FakeNode(this, 'destination');
    }
    _source(kind) {
        const node = new FakeNode(this, kind);
        node.startCalls = 0;
        node.stopCalls = [];
        node.start = (at = 0) => {
            node.startCalls++;
            this.started.push({ kind, node, at });
        };
        node.stop = at => node.stopCalls.push(at);
        return node;
    }
    createGain() {
        const node = new FakeNode(this, 'gain');
        node.gain = new FakeParam(1);
        return node;
    }
    createBufferSource() {
        const node = this._source('buffer');
        node.buffer = null;
        node.playbackRate = new FakeParam(1);
        return node;
    }
    createOscillator() {
        const node = this._source('osc');
        node.type = 'sine';
        node.frequency = new FakeParam(440);
        node.detune = new FakeParam(0);
        return node;
    }
    createBiquadFilter() {
        const node = new FakeNode(this, 'biquad');
        node.type = 'lowpass';
        node.frequency = new FakeParam(350);
        node.Q = new FakeParam(1);
        return node;
    }
    createDynamicsCompressor() {
        const node = new FakeNode(this, 'compressor');
        for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam(0);
        return node;
    }
    createStereoPanner() {
        const node = new FakeNode(this, 'panner');
        node.pan = new FakeParam(0);
        return node;
    }
    createBuffer(channels, length, sampleRate) {
        return fakeBuffer(0.2, length / sampleRate, channels, sampleRate);
    }
    // Fake "compressed" bytes: Float32 [peak, seconds, channels].
    decodeAudioData(bytes, resolve) {
        const [peak, seconds, channels] = new Float32Array(bytes);
        const buffer = fakeBuffer(peak, seconds, channels || 2, FAKE_RATE);
        resolve?.(buffer);
        return Promise.resolve(buffer);
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
}

function fakeBuffer(peak, seconds, channels, rate) {
    const length = Math.max(1, Math.round(seconds * rate));
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    data[0][Math.min(3, length - 1)] = -peak;
    return { length, numberOfChannels: channels, sampleRate: rate, duration: length / rate, getChannelData: c => data[c] };
}

function sampleBytes(peak, seconds = 0.5, channels = 2) {
    return new Float32Array([peak, seconds, channels]).buffer;
}

// Intrinsic peaks of the shipped samples (measured in Chrome, 24 kHz decode).
const SAMPLE_PEAKS = {
    tf2_hit: 1.09, tf2_frying_pan: 1.17, tf2_crit: 0.75, tf2_explosion: 0.92, tf2_scout_scream: 0.66,
    tf2_you_are_dead: 1.0, tf2_notification: 0.91, tf2_domination: 1.0, tf2_victory: 0.52,
    tf2_you_failed: 0.98, tf2_medic: 1.0, rocket_fire: 1.05,
    'music/1kill.sfx': 0.99, 'music/2kill.sfx': 0.97, 'music/3kill.sfx': 1.0, 'music/4kill.sfx': 1.0, 'music/ace.sfx': 0.99
};

async function createBus({ decode = Object.keys(SAMPLE_PEAKS) } = {}) {
    const audio = new Audio();
    const ctx = new FakeAudioContext();
    audio.init(ctx);
    audio._fetchSample = () => Promise.resolve(false); // bytes are injected below, no network
    for (const name of decode) {
        audio._sampleBytes.set(name, sampleBytes(SAMPLE_PEAKS[name]));
        await audio._decodeSample(name);
    }
    return { audio, ctx };
}

// Walks outputs from a node until it reaches one of the targets.
function reaches(node, target, seen = new Set()) {
    if (node === target) return true;
    if (!node || seen.has(node)) return false;
    seen.add(node);
    return node.outputs.some(out => reaches(out, target, seen));
}

function withTimers(fn) {
    const realSetTimeout = globalThis.setTimeout;
    const pending = [];
    globalThis.setTimeout = (cb, ms = 0) => { pending.push({ cb, ms }); return pending.length; };
    try {
        fn();
    } finally {
        globalThis.setTimeout = realSetTimeout;
    }
    for (const entry of pending.sort((a, b) => a.ms - b.ms)) entry.cb();
    return pending.length;
}

// ---------------------------------------------------------------------------
test('bus graph: sfx/announcer/ui/threat → master → 12 kHz low-pass → limiter; duck stages only on sfx and announcer', async () => {
    const { audio, ctx } = await createBus({ decode: [] });
    assert.deepEqual(AUDIO_BUSES, ['sfx', 'announcer', 'ui', 'threat']);
    for (const name of AUDIO_BUSES) {
        assert.ok(audio.buses[name], `${name} bus exists`);
        assert.deepEqual(audio.buses[name].outputs, [audio.masterGain], `${name} feeds master`);
    }
    assert.deepEqual(Object.keys(audio._duckNodes).sort(), ['announcer', 'sfx']);
    assert.equal(audio._duckNodes.sfx.outputs[0], audio.buses.sfx);
    assert.equal(audio._duckNodes.announcer.outputs[0], audio.buses.announcer);
    assert.equal(audio.masterGain.outputs[0], audio.tone);
    assert.equal(audio.tone.type, 'lowpass');
    assert.equal(audio.tone.frequency.value, TONE_CUTOFF_HZ);
    assert.equal(TONE_CUTOFF_HZ, 12000, 'low-pass raised from 3.2 kHz: knife partials (2.3-7.1 kHz) pass');
    assert.ok(audio.tone.Q.value <= Math.SQRT1_2 + 1e-9, 'no resonant bump under the cutoff');
    assert.equal(audio.tone.outputs[0], audio.limiter);
    assert.equal(audio.limiter.outputs[0], ctx.destination);
    assert.equal(audio.masterGain.gain.value, 0.5 * 0.4, 'default sound 50% × master 100% × 0.4');
});

test('samples: one fresh AudioBufferSourceNode per play, routed to its bus; no HTMLAudio when a context exists', async () => {
    const { audio, ctx } = await createBus();
    const realDocument = globalThis.document;
    let htmlAudio = 0;
    globalThis.document = { createElement: () => { htmlAudio++; return {}; } };
    try {
        assert.equal(audio.playSfx('tf2_hit', 0.35), true);
        assert.equal(audio.playSfx('tf2_hit', 0.35), true);
    } finally {
        globalThis.document = realDocument;
    }
    assert.equal(htmlAudio, 0);
    const sources = ctx.started.filter(s => s.kind === 'buffer').map(s => s.node);
    assert.equal(sources.length, 2);
    assert.notEqual(sources[0], sources[1], 'a replay is a new source, never a rewind');
    for (const source of sources) {
        assert.equal(source.startCalls, 1);
        assert.ok(reaches(source, audio._duckNodes.sfx), 'deflect sample enters the (duckable) sfx bus');
    }
    assert.equal(audio.playStreakSting('music/2kill.sfx'), true);
    const sting = ctx.started.at(-1).node;
    assert.ok(reaches(sting, audio.buses.announcer) && !reaches(sting, audio._duckNodes.announcer),
        'kill layer enters the announcer bus after its duck stage');
});

test('loudness table: every layer is set to its relative peak (dB vs the deflect reference)', async () => {
    const { audio, ctx } = await createBus();
    const prePeak = (name, play) => {
        play();
        const node = ctx.started.at(-1).node;
        return node.outputs[0].gain.value * SAMPLE_PEAKS[name];
    };
    const db = peak => gainToDb(peak / REFERENCE_PEAK);
    const near = (actual, expected, label) =>
        assert.ok(Math.abs(actual - expected) <= 0.05, `${label}: ${actual.toFixed(2)} dB, want ${expected}`);
    near(db(prePeak('tf2_explosion', () => audio.playKillImpact())), LOUDNESS_DB.killImpact, 'kill impact');
    near(db(prePeak('music/2kill.sfx', () => audio.playStreakSting('music/2kill.sfx'))), LOUDNESS_DB.streakSting, 'streak sting');
    near(db(prePeak('tf2_crit', () => audio.playAnnouncement('tf2_crit', 0.5))), LOUDNESS_DB.streakSting, 'broadcast sting');
    near(db(prePeak('tf2_notification', () => audio.playKillRoleCue('observer'))), LOUDNESS_DB.observerCue, 'observer cue');
    // Legacy call volumes still scale around the table level.
    const quiet = db(prePeak('tf2_hit', () => audio.playSfx('tf2_hit', 0.15)));
    const nominal = db(prePeak('tf2_hit', () => audio.playSfx('tf2_hit', 0.35)));
    near(quiet - nominal, gainToDb(0.15 / 0.35), 'playSfx volume ratio');

    // Synth cues: trim × measured trim-1 peak lands on the table.
    const synth = { hit: 'hit', threat: 'threat3', overdrive: 'overdrive', click: 'click', explosion: 'explosion' };
    const table = { hit: LOUDNESS_DB.hit, threat: LOUDNESS_DB.threatCritical, overdrive: LOUDNESS_DB.overdrive, click: LOUDNESS_DB.ui, explosion: LOUDNESS_DB.killImpact };
    for (const [trim, peakKey] of Object.entries(synth)) {
        near(db(SYNTH_TRIMS[trim] * SYNTH_PEAKS[peakKey]), table[trim], `synth ${trim}`);
    }
});

// Recorded by rendering each cue through the real bus in Chrome's OfflineAudioContext
// (48 kHz, default settings, full chain incl. limiter; cue started 0.5 s in). The
// LUNA evidence page re-measures this; this pins the numbers the card was graded on.
const OFFLINE_MEASURED_DB = {
    deflect: 0, hit: -0.96, killImpact: 0.04, streakSting: -2.92, overdrive: -2.93,
    threatCritical: -1.95, ui: -5.88
};
test('OfflineAudioContext measurement matches the loudness table within ±2 dB (before: tf2_hit vs threat +20.9 dB)', () => {
    for (const [key, measured] of Object.entries(OFFLINE_MEASURED_DB)) {
        assert.ok(Math.abs(measured - LOUDNESS_DB[key]) <= 2, `${key}: ${measured} vs ${LOUDNESS_DB[key]}`);
    }
    const deflectVsThreat = OFFLINE_MEASURED_DB.deflect - OFFLINE_MEASURED_DB.threatCritical;
    assert.ok(Math.abs(deflectVsThreat - 2) <= 2, `deflect vs critical threat ${deflectVsThreat} dB (was +20.9)`);
});

test('mute (and master 0, and sound 0) start zero sources across every category', async () => {
    for (const mix of [{ muted: true }, { master: 0 }, { sound: 0 }]) {
        const { audio, ctx } = await createBus();
        audio.setMix({ sound: 0.5, master: 1, muted: false, ...mix });
        audio.setListener({ x: 0, y: 0, z: 0 }, 0, -1);
        audio._kenneyBuffers.set('ui-click', fakeBuffer(0.85, 0.01, 1, FAKE_RATE));
        withTimers(() => {
            for (const cue of Object.keys(Audio.CUES)) audio.playCue(cue);
            for (const name of Object.keys(SAMPLE_PEAKS)) audio.playSfx(name, 0.5);
            audio.playKillImpact();
            for (const role of ['killer', 'victim', 'observer']) audio.playKillRoleCue(role);
            audio.playStreakSting('music/3kill.sfx');
            audio.playAnnouncement('tf2_domination', 0.5);
            audio.playExplosion(true);
            audio.playThreatCue(3, { x: 2, y: 0, z: -2 });
            audio.updateThreatAudio({ active: true, speed: 30, distance: 3, now: 5000, pos: { x: 1, y: 0, z: 0 } });
            audio.playDeflect('spike', { x: 1, y: 0, z: 0 });
            audio.playHit({ x: 1, y: 0, z: 0 });
            audio.playWhoosh(20, { x: 1, y: 0, z: 0 });
            audio.playBounce({ x: 1, y: 0, z: 0 });
            audio.playKnife('heavy');
            audio.playCaseTick();
            audio.playCaseReelTick(0.5, 80);
            audio.playCaseRevealSting('legendary');
            audio.playDing();
            audio.playGo();
        });
        assert.equal(ctx.started.length, 0, `${JSON.stringify(mix)} → 0 sources, got ${ctx.started.length}`);
    }
    // Sanity: the same calls do start sources when audible.
    const { audio, ctx } = await createBus();
    audio.playSfx('tf2_hit', 0.35);
    audio.playCue('overdrive-enter');
    assert.ok(ctx.started.length >= 2);
});

test('the sound slider alone cannot undo master or mute (main.js applyLoadout path)', async () => {
    const { audio, ctx } = await createBus();
    audio.setMix({ sound: 0.5, master: 0.5, muted: true });
    assert.equal(audio.masterGain.gain.value, 0);
    audio.setSoundVolume(0.8); // what main.js#applyLoadout does with the raw slider
    assert.equal(audio.muted, true);
    assert.equal(audio.masterGain.gain.value, 0);
    assert.equal(audio.playSfx('tf2_hit', 0.35), false);
    assert.equal(ctx.started.length, 0);
    audio.setMuted(false);
    assert.ok(Math.abs(audio.masterGain.gain.value - 0.8 * 0.5 * 0.4) < 1e-9, 'sound × master × 0.4');
});

test(`10 tf2_hit plays in 100 ms → ${MAX_SAMPLE_VOICES} live voices, oldest stolen, nothing restarted`, async () => {
    const { audio, ctx } = await createBus({ decode: ['tf2_hit'] });
    for (let i = 0; i < 10; i++) {
        audio.playSfx('tf2_hit', 0.35);
        ctx.currentTime += 0.01;
    }
    const sources = ctx.started.filter(s => s.kind === 'buffer').map(s => s.node);
    assert.equal(sources.length, 10, 'every play is a fresh source');
    assert.equal(new Set(sources).size, 10);
    assert.ok(sources.every(s => s.startCalls === 1), 'no source is started twice (no rewind)');
    const stolen = sources.filter(s => s.stopCalls.length > 0);
    assert.deepEqual(stolen, sources.slice(0, 6), 'the six oldest are stolen, in order');
    assert.equal(audio._voices.get('tf2_hit').length, 4);
    assert.deepEqual(audio._voices.get('tf2_hit').map(v => v.source), sources.slice(6));
    // Stolen voices fade (5 ms) rather than click.
    for (const s of stolen) assert.ok(s.outputs[0].gain.events.some(e => e[0] === 'target' && e[1] === 0));
    // A finished voice frees its slot.
    sources[9].onended();
    assert.equal(audio._voices.get('tf2_hit').length, 3);
});

function assertDuck(param, t0, label) {
    const cancel = param.events.find(e => e[0] === 'cancel');
    assert.ok(cancel && Math.abs(cancel[1] - t0) < 1e-9, `${label}: automation re-anchored at trigger time`);
    const anchor = param.events.find(e => e[0] === 'set');
    assert.ok(anchor && Math.abs(anchor[2] - t0) < 1e-9 && anchor[1] === 1, `${label}: attack starts from the live value`);
    const ramps = param.events.filter(e => e[0] === 'linear');
    assert.equal(ramps.length, 2, `${label}: attack + release ramps`);
    const [attack, release] = ramps;
    assert.ok(Math.abs(gainToDb(attack[1]) - DUCK.depthDb) <= 0.5, `${label}: depth ${gainToDb(attack[1]).toFixed(2)} dB`);
    assert.ok(Math.abs(DUCK.depthDb - -6) <= 0.5);
    assert.ok(Math.abs(attack[2] - t0 - 0.010) < 1e-9, `${label}: 10 ms attack`);
    const holdEnd = param.events.find(e => e[0] === 'set' && e[2] > t0);
    assert.ok(holdEnd, `${label}: hold point`);
    assert.equal(release[1], 1, `${label}: releases to unity`);
    assert.ok(Math.abs(release[2] - holdEnd[2] - 0.200) < 1e-9, `${label}: 200 ms release`);
}

test('ducking: kill layers and the critical threat duck sfx + announcer by -6 dB (10 ms / 200 ms); threat and ui never duck', async () => {
    const { audio, ctx } = await createBus();
    ctx.currentTime = 2;
    audio.playKillImpact();
    for (const bus of ['sfx', 'announcer']) assertDuck(audio._duckNodes[bus].gain, 2, `kill → ${bus}`);
    for (const bus of AUDIO_BUSES) assert.equal(audio.buses[bus].gain.events.length, 0, `${bus} bus level untouched`);
    assert.equal(audio._duckNodes.threat, undefined);
    assert.equal(audio._duckNodes.ui, undefined);

    const fresh = await createBus();
    fresh.ctx.currentTime = 3;
    fresh.audio.playThreatCue(2);
    assert.equal(fresh.audio._duckNodes.sfx.gain.events.length, 0, 'urgency 2 does not duck');
    fresh.audio.playThreatCue(3);
    assertDuck(fresh.audio._duckNodes.sfx.gain, 3, 'critical threat → sfx');
    const threatOsc = fresh.ctx.started.at(-1).node;
    assert.ok(reaches(threatOsc, fresh.audio.buses.threat), 'threat cue rides the threat bus');
    assert.ok(!reaches(threatOsc, fresh.audio._duckNodes.sfx));
});

// --- Game-level kill stack --------------------------------------------------
function killGame(audio, { playerName = 'Local', team = 'red', isHost = true } = {}) {
    const timers = [];
    const globals = {
        performance: { now: () => 1000 },
        setTimeout: (cb, ms) => { timers.push({ cb, ms }); return timers.length; },
        clearTimeout() {}
    };
    const packets = [];
    const game = {
        playerName,
        player: { name: playerName, team },
        audio,
        network: { isHost, broadcast: pkt => packets.push(pkt) },
        _killPresentationKeys: new Set(),
        _killConfirmationTimer: null,
        _killConfirmationUntil: 0,
        ui: { showMessage() {} },
        juice: { killBurst() {}, hitStop() {}, flash() {} },
        spawnDeathExplosion() {},
        _showMatchMessage() {}
    };
    for (const name of ['_claimKillPresentation', '_presentLethalImpact', '_playComboSound', 'announce', 'applyAnnounce', '_playAnnounceSfx']) {
        game[name] = compileGameMethod(name, globals);
    }
    const runTimers = () => { for (const t of timers.splice(0)) if (t.ms <= 150) t.cb(); };
    return { game, packets, runTimers };
}

test('kill stack: ≤ 3 sources per listener role within 150 ms, one impact (never recorded + synth)', async () => {
    const hitPos = { x: 0, y: 1, z: 0 };
    // Sources whose scheduled start falls inside the 150 ms window opened at t0.
    const inWindow = (ctx, t0 = 1) => ctx.started.filter(s => s.at - t0 <= KILL_STACK_WINDOW + 1e-9);

    // Killer (host, streak of 2): impact + kill-confirm + one streak sting.
    {
        const { audio, ctx } = await createBus();
        const { game, packets, runTimers } = killGame(audio);
        game._presentLethalImpact(hitPos, 'blue', 'Local', 'Bot', 3);
        game._playComboSound('music/2kill.sfx', 1.1);
        game.announce('🔥 DOUBLE KILL!', 'tf2_crit', 0.5, 2500, { localSfx: false });
        audio.playCue('kill-confirm'); // _grantKillConfirm
        runTimers(); // _claimKillPresentation's 100 ms kill-confirm (retrigger-guarded)
        assert.equal(ctx.started.length, 3, `killer: ${ctx.started.map(s => s.kind)}`);
        assert.equal(inWindow(ctx).length, 3);
        assert.equal(ctx.started.filter(s => s.node.buffer?.duration && s.kind === 'buffer').length, 2);
        assert.equal(packets.length, 1);
    }
    // Victim: impact + damage grunt + "you are dead"; a round-ending kill's
    // announcement waits for the window to close instead of being a 4th layer.
    {
        const { audio, ctx } = await createBus();
        const { game } = killGame(audio);
        game._presentLethalImpact(hitPos, 'red', 'Bot', 'Local', 3);
        audio.playSfx('tf2_scout_scream', 0.45);
        audio.playSfx('tf2_you_are_dead', 0.5);
        game.announce('BLUE WINS THE ROUND', 'tf2_domination', 0.5, 2000);
        assert.equal(ctx.started.length, 4);
        assert.equal(inWindow(ctx).length, 3, 'victim');
        assert.ok(ctx.started[3].at >= 1 + KILL_STACK_WINDOW, 'round-win sting lands after the kill stack');
    }
    // Observer client (teammate died) hearing the host's broadcast streak sting.
    {
        const { audio, ctx } = await createBus();
        const { game } = killGame(audio, { playerName: 'Guest', isHost: false });
        game._presentLethalImpact(hitPos, 'red', 'Host', 'Mate', 3);
        game.applyAnnounce({ type: 'announce', text: '🔥 DOUBLE KILL!', sfx: 'tf2_crit', sfxVol: 0.5, duration: 2500 });
        assert.equal(ctx.started.length, 3, 'observer: impact + notification + broadcast sting');
        assert.ok(inWindow(ctx).length <= 3);
        const notification = ctx.started[1].node;
        assert.equal(notification.playbackRate.value, 0.8, 'lower pitch when a teammate died');
        assert.ok(Math.abs(gainToDb(notification.outputs[0].gain.value * SAMPLE_PEAKS.tf2_notification / REFERENCE_PEAK) - LOUDNESS_DB.observerCue) < 0.05);
    }
    // Impact falls back to the synth only when the recording isn't decoded — never both.
    {
        const { audio, ctx } = await createBus({ decode: [] });
        audio.playKillImpact();
        assert.deepEqual(ctx.started.map(s => s.kind).sort(), ['buffer', 'osc'], 'synth pop + crackle only');
        assert.equal(audio._samples.size, 0, 'no recorded explosion played alongside');
        const { audio: ready, ctx: readyCtx } = await createBus({ decode: ['tf2_explosion'] });
        ready.playKillImpact();
        assert.equal(readyCtx.started.length, 1, 'recorded impact alone');
        assert.equal(readyCtx.started[0].node.buffer, ready._samples.get('tf2_explosion').buffer);
    }
});

test('streak sting starts exactly once locally and exactly once per client; the packet keeps its fields', async () => {
    const host = await createBus();
    const { game: hostGame, packets } = killGame(host.audio);
    hostGame._playComboSound('music/2kill.sfx', 1);
    hostGame.announce('🔥 DOUBLE KILL!', 'tf2_crit', 0.5, 2500, { localSfx: false });
    assert.equal(host.ctx.started.length, 1, 'host hears one sting');
    assert.equal(host.ctx.started[0].node.buffer, host.audio._samples.get('music/2kill.sfx').buffer);
    // Same fields as before plus a host sequence number (additive, JSON packet).
    assert.deepEqual(JSON.parse(JSON.stringify(packets)), [{ type: 'announce', text: '🔥 DOUBLE KILL!', sfx: 'tf2_crit', sfxVol: 0.5, duration: 2500, seq: 1 }]);

    const client = await createBus();
    const { game: clientGame } = killGame(client.audio, { playerName: 'Guest', isHost: false });
    clientGame.applyAnnounce(packets[0]);
    clientGame.applyAnnounce(packets[0]); // re-delivered packet
    assert.equal(client.ctx.started.length, 1, 'client hears the broadcast sting once');

    // Ordinary announcements (round win etc.) still play locally on the host.
    const round = await createBus();
    const { game: roundGame } = killGame(round.audio);
    roundGame.announce('RED WINS', 'tf2_domination', 0.5, 2000);
    assert.equal(round.ctx.started.length, 1);
});

test('streak block: sting only from streak 2, played once; FIRST BLOOD only for the match\'s first kill', () => {
    const block = extractGameMethod('_doApplyHit');
    const start = block.indexOf('const comboNames');
    const streak = block.slice(start, block.indexOf('if (scorerName) this.scoreboard.recordPoint', start));
    assert.equal((streak.match(/_playComboSound\(/g) || []).length, 1);
    assert.doesNotMatch(streak, /playSfx\(/, 'no second tf2 copy of the sting');
    assert.match(streak, /const firstBlood = idx === 1 && this\._matchKills === 1;/);
    assert.match(streak, /const sting = idx >= 2 \? tf2ComboSounds\[idx\] \|\| null : null;/);
    assert.match(streak, /this\.announce\(`🔥 \$\{comboName\}!`, sting, 0\.5, 2500, \{ localSfx: false \}\);/);
    assert.match(block, /this\._matchKills = \(this\._matchKills \|\| 0\) \+ 1;/);
    assert.doesNotMatch(block, /tf2_notification/, 'observer cue moved to _presentLethalImpact');
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(game, /this\.killStreak = 0;\r?\n\s+this\._matchKills = 0; \/\/ G7/, 'reset with the match');
});

test('combo stings ride the bus and honour mute (were HTMLAudio at a fixed 0.12)', async () => {
    const { audio, ctx } = await createBus();
    const { game } = killGame(audio);
    audio.setMix({ muted: true });
    assert.equal(game._playComboSound('music/3kill.sfx', 1.2), false);
    assert.equal(ctx.started.length, 0);
    audio.setMix({ muted: false });
    assert.equal(game._playComboSound('music/3kill.sfx', 1.2), true);
    assert.equal(ctx.started[0].node.playbackRate.value, 1.2, 'combo-tier pitch ramp kept');
    const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /_comboAudio/);
    assert.doesNotMatch(readFileSync(new URL('../js/audio.js', import.meta.url), 'utf8'), /new Audio\(/);
});

test('threat cue pans toward the ball; rear variant (lower, low-passed) when facing dot < -0.05', async () => {
    const listener = { x: 0, y: 0, z: 0 };
    // Facing -Z (three.js default forward).
    const left = computeThreatVoicing(listener, 0, -1, { x: -5, y: 0, z: -2 });
    const right = computeThreatVoicing(listener, 0, -1, { x: 5, y: 0, z: -2 });
    const rear = computeThreatVoicing(listener, 0, -1, { x: 0.5, y: 0, z: 8 });
    const side = computeThreatVoicing(listener, 0, -1, { x: 8, y: 0, z: 0.2 });
    assert.ok(left.pan < 0 && !left.rear);
    assert.ok(right.pan > 0 && !right.rear);
    assert.ok(rear.rear && rear.dot < REAR_THREAT_DOT);
    assert.ok(!side.rear && side.dot >= REAR_THREAT_DOT, 'just-behind side ball (dot -0.025) keeps the front voice');

    for (const [label, pos, sign, isRear] of [['left', { x: -5, y: 0, z: -2 }, -1, false], ['right', { x: 5, y: 0, z: -2 }, 1, false], ['rear', { x: -3, y: 0, z: 8 }, -1, true]]) {
        const { audio, ctx } = await createBus({ decode: [] });
        audio.setListener(listener, 0, -1);
        const cue = audio.updateThreatAudio({ active: true, speed: 20, distance: 5, now: 100, pos });
        assert.equal(cue, 3, `${label}: critical`);
        const panner = ctx.nodes.find(n => n.kind === 'panner');
        assert.equal(Math.sign(panner.pan.value), sign, `${label}: pan sign`);
        const filter = ctx.nodes.find(n => n.kind === 'biquad' && n !== audio.tone);
        assert.equal(!!filter, isRear, `${label}: low-pass only on the rear variant`);
        const first = ctx.started[0].node;
        assert.equal(first.frequency.value, (300 + 3 * 55) * (isRear ? 0.7 : 1), `${label}: pitch`);
        assert.ok(reaches(first, audio.buses.threat));
    }
});

test(`decoded sample memory stays under the budget (${DECODED_BUDGET_BYTES / 1048576} MB ≤ 12 MB), LRU with re-decode`, async () => {
    assert.ok(DECODED_BUDGET_BYTES <= 12 * 1024 * 1024);
    const audio = new Audio();
    const ctx = new FakeAudioContext();
    ctx.sampleRate = 48000;
    audio.init(ctx);
    // Real-size fakes: 8 s stereo at 48 kHz ≈ 2.9 MB each.
    ctx.decodeAudioData = (bytes, resolve) => {
        const buffer = { length: 8 * 48000, numberOfChannels: 2, sampleRate: 48000, duration: 8, getChannelData: () => new Float32Array(4) };
        resolve?.(buffer);
        return Promise.resolve(buffer);
    };
    const names = Object.keys(SAMPLE_PEAKS);
    for (const name of names) {
        audio._sampleBytes.set(name, sampleBytes(0.9));
        await audio._decodeSample(name);
        assert.ok(audio.decodedBytes() <= DECODED_BUDGET_BYTES, `after ${name}: ${audio.decodedBytes()}`);
    }
    assert.ok(audio._samples.has(names.at(-1)), 'the newest decode is kept');
    assert.ok(!audio._samples.has(names[0]), 'the least recently used was evicted');
    assert.ok(audio._sampleBytes.has(names[0]), 'compressed bytes stay for a re-decode');
});

test('a play that arrives mid-decode plays when the buffer lands within 150 ms; a stale one is dropped', async () => {
    const audio = new Audio();
    const ctx = new FakeAudioContext();
    audio.init(ctx);
    let release;
    ctx.decodeAudioData = bytes => new Promise(resolve => { release = () => resolve(fakeBuffer(0.9, 0.5, 2, FAKE_RATE)); });
    audio._sampleBytes.set('tf2_crit', sampleBytes(0.9));
    assert.equal(audio.playSfx('tf2_crit', 0.65), false);
    release();
    await new Promise(r => setImmediate(r));
    assert.equal(ctx.started.length, 1, 'played once decoded');

    audio._sampleBytes.set('tf2_medic', sampleBytes(1));
    const realNow = performance.now;
    let now = 10_000;
    performance.now = () => now;
    try {
        audio.playSfx('tf2_medic', 0.35);
        now += 400;
        release();
        await new Promise(r => setImmediate(r));
    } finally {
        performance.now = realNow;
    }
    assert.equal(ctx.started.length, 1, 'a 400 ms late sound is dropped, not played late');
});

test('HTMLAudio is only the no-Web-Audio fallback, and it honours mute too', async () => {
    const realWindow = globalThis.window;
    const realDocument = globalThis.document;
    const elements = [];
    globalThis.window = {};
    globalThis.document = { createElement: () => { const el = { play: () => { el.plays = (el.plays || 0) + 1; return Promise.resolve(); } }; elements.push(el); return el; } };
    try {
        const audio = new Audio();
        audio.init();
        assert.equal(audio.ctx, null);
        assert.equal(audio._noWebAudio, true);
        audio._sampleBytes.set('tf2_hit', sampleBytes(1));
        assert.equal(audio.playSfx('tf2_hit', 0.35), true);
        assert.equal(elements.length, 1);
        assert.ok(elements[0].volume > 0 && elements[0].volume <= 1);
        audio.setMuted(true);
        assert.equal(audio.playSfx('tf2_hit', 0.35), false);
        assert.equal(elements[0].plays, 1);
    } finally {
        globalThis.window = realWindow;
        globalThis.document = realDocument;
    }
});

test('deflect path adds no latency: the sample source starts at currentTime, synchronously', async () => {
    const { audio, ctx } = await createBus();
    ctx.currentTime = 7.25;
    audio.playSfx('tf2_frying_pan', 0.35);
    audio.playDeflect('spike');
    const starts = ctx.started.map(s => s.at);
    assert.ok(starts.length >= 3);
    assert.ok(starts.every(at => at === 7.25), `all deflect layers start now: ${starts}`);
    assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 1e-3);
});

test('two distinct announcements with the same text both play; a re-delivered one does not', async () => {
    const host = await createBus();
    const { game: hostGame, packets } = killGame(host.audio);
    hostGame.announce('🔥 DOUBLE KILL!', 'tf2_crit', 0.5, 2500, { localSfx: false });
    hostGame.announce('🔥 DOUBLE KILL!', 'tf2_crit', 0.5, 2500, { localSfx: false });
    assert.deepEqual(packets.map(p => p.seq), [1, 2]);

    const client = await createBus();
    const { game: clientGame } = killGame(client.audio, { playerName: 'Guest', isHost: false });
    clientGame.applyAnnounce(packets[0]);
    clientGame.applyAnnounce(packets[0]); // retransmission of the first
    clientGame.applyAnnounce(packets[1]); // a genuinely distinct second DOUBLE KILL
    assert.equal(client.ctx.started.length, 2);

    // An older host without seq keeps the 400 ms same-content window.
    const legacy = await createBus();
    const { game: legacyGame } = killGame(legacy.audio, { playerName: 'Guest', isHost: false });
    const bare = { type: 'announce', text: 'RED WINS', sfx: 'tf2_domination', sfxVol: 0.5, duration: 2000 };
    legacyGame.applyAnnounce(bare);
    legacyGame.applyAnnounce(bare);
    assert.equal(legacy.ctx.started.length, 1);
});

test('rocket blasts do not open a kill duck; a real kill impact still does', async () => {
    const rocket = await createBus({ decode: ['tf2_explosion'] });
    rocket.audio.playSfx('tf2_explosion', 0.55);
    assert.equal(rocket.ctx.started.length, 1);
    for (const bus of ['sfx', 'announcer']) {
        assert.equal(rocket.audio._duckNodes[bus].gain.events.length, 0, `rocket leaves ${bus} unducked`);
    }
    const kill = await createBus({ decode: ['tf2_explosion'] });
    kill.audio.playKillImpact();
    for (const bus of ['sfx', 'announcer']) {
        assert.ok(kill.audio._duckNodes[bus].gain.events.length > 0, `kill impact ducks ${bus}`);
    }
});

test('a failed sample fetch backs off instead of re-fetching on every play', async () => {
    const { SAMPLE_RETRY_MS } = await import('../js/audio.js');
    const audio = new Audio();
    audio.init(new FakeAudioContext());
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetches++; return { ok: false, status: 404 }; };
    const realWarn = console.warn;
    console.warn = () => {};
    try {
        await audio._fetchSample('tf2_hit');
        await audio._fetchSample('tf2_hit');
        await audio._fetchSample('tf2_hit');
        assert.equal(fetches, 1, 'one request inside the back-off window');
        assert.equal(audio._pendingPlays.has('tf2_hit'), false);
        audio._sampleFailedAt.set('tf2_hit', -SAMPLE_RETRY_MS * 2);
        await audio._fetchSample('tf2_hit');
        assert.equal(fetches, 2, 'retries once the window has passed');
    } finally {
        globalThis.fetch = realFetch;
        console.warn = realWarn;
    }
});
