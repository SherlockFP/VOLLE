import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Audio } from '../js/audio.js';

class DashAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.created = { oscillators: [], buffers: 0, sources: 0 };
    }
    createGain() {
        return {
            gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {}
        };
    }
    createOscillator() {
        const oscillator = {
            type: 'sine',
            frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {}, start() {}, stop() {}
        };
        this.created.oscillators.push(oscillator);
        return oscillator;
    }
    createBuffer() { this.created.buffers++; return { getChannelData: () => new Float32Array(1) }; }
    createBufferSource() { this.created.sources++; return { connect() {}, start() {} }; }
}

function createAudioHarness(volume = 0.5) {
    const audio = new Audio();
    audio.ctx = new DashAudioContext();
    audio.masterGain = { connect() {} };
    audio.soundVolume = volume;
    return audio;
}

test('dash cue is a restrained two-oscillator signature, distinct from throw whoosh noise', () => {
    const audio = createAudioHarness();
    assert.equal(audio.playDash(), true);
    assert.deepEqual(audio.ctx.created.oscillators.map(node => node.type), ['triangle', 'sine']);
    assert.equal(audio.ctx.created.buffers, 0);
    assert.equal(audio.ctx.created.sources, 0);
    assert.deepEqual(Audio.CUES.dash, { fn: 'playDash', retriggerMs: 250 });
});

test('first dash named cue at time origin plays once, then the retrigger guard blocks its duplicate', () => {
    const audio = createAudioHarness();
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    try {
        assert.equal(audio.playCue('dash'), true);
        assert.equal(audio.ctx.created.oscillators.length, 2);
        assert.equal(audio.playCue('dash'), false);
        assert.equal(audio.ctx.created.oscillators.length, 2);
    } finally {
        globalThis.performance = originalPerformance;
    }
});

test('a missing cue implementation does not consume its retry cooldown', () => {
    const audio = createAudioHarness();
    const cueName = 'test-dash-missing-implementation';
    Audio.CUES[cueName] = { fn: 'missingDashImplementation', retriggerMs: 250 };
    try {
        assert.equal(audio.playCue(cueName), false);
        assert.equal(Object.hasOwn(audio._cueCooldowns, cueName), false);

        let calls = 0;
        audio.recoveredDashImplementation = () => { calls++; };
        Audio.CUES[cueName] = { fn: 'recoveredDashImplementation', retriggerMs: 250 };
        assert.equal(audio.playCue(cueName), true);
        assert.equal(calls, 1);
    } finally {
        delete Audio.CUES[cueName];
    }
});

test('a throwing cue restores its cooldown so an immediate fixed retry can play', () => {
    const audio = createAudioHarness();
    const cueName = 'test-dash-throwing-implementation';
    Audio.CUES[cueName] = { fn: 'throwingDashImplementation', retriggerMs: 250 };
    try {
        audio.throwingDashImplementation = () => { throw new Error('dash audio failure'); };
        assert.equal(audio.playCue(cueName), false);
        assert.equal(Object.hasOwn(audio._cueCooldowns, cueName), false);

        let calls = 0;
        audio.throwingDashImplementation = () => { calls++; };
        assert.equal(audio.playCue(cueName), true);
        assert.equal(calls, 1);
    } finally {
        delete Audio.CUES[cueName];
    }
});

test('dash cue respects uninitialized and muted audio contracts without creating nodes', () => {
    assert.equal(new Audio().playDash(), false);

    const muted = createAudioHarness(0);
    assert.equal(muted.playDash(), false);
    assert.equal(muted.ctx.created.oscillators.length, 0);
});

test('only the accepted dash edge has one named dash route; rejected paths and active frames have none', async () => {
    const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    const updateStart = source.indexOf('    update(dt) {');
    const updateEnd = source.indexOf('\n    // Apply damage through shield first.', updateStart);
    assert.ok(updateStart >= 0 && updateEnd > updateStart);
    const update = source.slice(updateStart, updateEnd);
    const activeDashStart = update.indexOf('        if (wasDashing) {');
    const triggerStart = update.indexOf('        if (ctrlDown && !this._dashWasDown && !longJump.triggered');
    const triggerEnd = update.indexOf('        this._dashWasDown = ctrlDown;', triggerStart);
    assert.ok(activeDashStart >= 0 && triggerStart > activeDashStart && triggerEnd > triggerStart);
    const activeDash = update.slice(activeDashStart, triggerStart);
    const trigger = update.slice(triggerStart, triggerEnd);

    assert.doesNotMatch(activeDash, /playCue|playWhoosh/);
    assert.match(trigger, /!longJump\.triggered\s*&& this\.dashCooldown <= 0 && this\.dashTimer <= 0 && this\.stamina >= this\.dashCost/);
    assert.equal((trigger.match(/playCue\?\.\('dash'\)/g) || []).length, 1);
    assert.doesNotMatch(trigger, /playWhoosh/);
});

test('dash envelope remains short, quiet, and separate from ball-throw implementation', async () => {
    const source = await readFile(new URL('../js/audio.js', import.meta.url), 'utf8');
    const dashStart = source.indexOf('    playDash() {');
    const dashEnd = source.indexOf('\n    // Clean musical', dashStart);
    const dash = source.slice(dashStart, dashEnd);

    assert.match(dash, /body\.frequency\.setValueAtTime\(330, t\)[\s\S]*?225, t \+ 0\.11/);
    assert.match(dash, /air\.frequency\.setValueAtTime\(980, t\)[\s\S]*?1480, t \+ 0\.075/);
    assert.match(dash, /0\.075, t \+ 0\.006[\s\S]*?0\.001, t \+ 0\.12/);
    assert.match(dash, /0\.018, t \+ 0\.006[\s\S]*?0\.001, t \+ 0\.09/);
    assert.doesNotMatch(dash, /createBuffer|createBufferSource|Math\.random/);
});
