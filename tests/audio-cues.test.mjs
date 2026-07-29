// tests/audio-cues.test.mjs — Named cue API, retrigger guard, volume normalization, mute path, match-end cues
import test from 'node:test';
import assert from 'node:assert/strict';

const { Audio } = await import('../js/audio.js');

// Mock AudioContext for testing
class MockAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 44100;
        this._oscillators = [];
        this.destination = {};
    }
    createGain() {
        return { gain: { value: 0.5, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
    }
    createOscillator() {
        const osc = { type: 'sine', frequency: { value: 440, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, detune: { value: 0 }, connect: () => {}, start: () => {}, stop: () => {} };
        this._oscillators.push(osc);
        return osc;
    }
    createBiquadFilter() {
        return { type: 'lowpass', frequency: { value: 1000, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, Q: { value: 0.5 }, connect: () => {} };
    }
    createDynamicsCompressor() {
        return { threshold: { value: -14 }, knee: { value: 24 }, ratio: { value: 8 }, attack: { value: 0.003 }, release: { value: 0.2 }, connect: () => {} };
    }
    createBuffer(channels, length, sampleRate) {
        return {
            getChannelData: () => new Float32Array(length),
            numberOfChannels: channels,
            length,
            sampleRate
        };
    }
    createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {} };
    }
    resume() {
        return Promise.resolve();
    }
}

// Create a test harness that initializes AudioContext and Audio
function createAudioHarness() {
    // Set up global window with AudioContext mock
    globalThis.window = { webkitAudioContext: MockAudioContext };
    globalThis.window.AudioContext = MockAudioContext;
    globalThis.performance = { now: () => Date.now() };
    
    const audio = new Audio();
    // Manually initialize context chain
    audio.ctx = new MockAudioContext();
    audio.masterGain = audio.ctx.createGain();
    audio.masterGain.gain.value = audio.soundVolume * 0.4;
    audio.tone = audio.ctx.createBiquadFilter();
    audio.tone.type = 'lowpass';
    audio.tone.frequency.value = 3200;
    audio.tone.Q.value = 0.5;
    audio.limiter = audio.ctx.createDynamicsCompressor();
    audio.limiter.threshold.value = -14;
    audio.limiter.knee.value = 24;
    audio.limiter.ratio.value = 8;
    audio.limiter.attack.value = 0.003;
    audio.limiter.release.value = 0.2;
    audio.masterGain.connect(audio.tone);
    audio.tone.connect(audio.limiter);
    audio.limiter.connect(audio.ctx.destination);
    
    return { audio, ctx: audio.ctx };
}

test('playCue with valid cue plays the sound', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    const result = audio.playCue('ui-click');
    assert.equal(result, true, 'valid cue must return true');
});

test('playCue with unknown cue ID returns false and does not throw', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    assert.doesNotThrow(() => {
        const result = audio.playCue('unknown-cue-xyz');
        assert.equal(result, false, 'unknown cue must return false');
    });
});

test('playCue with null/undefined cueName returns false', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    assert.equal(audio.playCue(null), false);
    assert.equal(audio.playCue(undefined), false);
    assert.equal(audio.playCue(123), false, 'non-string cue name must return false');
});

test('retrigger guard: second call within 50ms returns false', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    const first = audio.playCue('ui-click');
    assert.equal(first, true, 'first call must succeed');
    
    // Immediate second call within 50ms
    const second = audio.playCue('ui-click');
    assert.equal(second, false, 'second call within retrigger window must be blocked');
});

test('retrigger guard: different cues do not block each other', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    const click = audio.playCue('ui-click');
    const hover = audio.playCue('ui-hover');
    assert.equal(click, true, 'first cue plays');
    assert.equal(hover, true, 'different cue plays immediately (not blocked)');
});

test('mute (soundVolume <= 0) silences all cues', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0;
    const result = audio.playCue('ui-click');
    assert.equal(result, false, 'muted audio must not play any cue');
});

test('mute state respected for positive soundVolume after mute', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0;
    assert.equal(audio.playCue('ui-click'), false, 'muted');
    
    audio.soundVolume = 0.5;
    const result = audio.playCue('ui-hover'); // different cue to avoid retrigger
    assert.equal(result, true, 'unmute must allow play');
});

test('volume normalization: masterGain stays in 0..1 range', () => {
    const { audio } = createAudioHarness();
    // setVolume should clamp input to [0, 1]
    audio.setVolume(-0.5);
    assert.equal(audio.soundVolume, 0, 'negative volume clamped to 0');
    
    audio.setVolume(1.5);
    assert.equal(audio.soundVolume, 1, 'volume > 1 clamped to 1');
    
    audio.setVolume(0.5);
    assert.equal(audio.soundVolume, 0.5, 'mid-range volume preserved');
    
    // masterGain internally applies * 0.4 factor, so it stays in [0, 0.4]
    assert.equal(audio.masterGain.gain.value, 0.5 * 0.4);
});

test('cue table exists and contains all 33 expected cue names', () => {
    const expectedCues = [
        'ui-click', 'ui-hover', 'deflect-spike', 'deflect-lob', 'deflect-flat',
        'whoosh', 'dinging', 'jump', 'land', 'bounce',
        'threat-1', 'threat-2', 'threat-3',
        'knife-inspect', 'knife-slash', 'knife-stab',
        'voice-ping-incoming', 'voice-ping-help', 'voice-ping-save',
        'beep', 'go', 'speed-warning', 'score', 'chat',
        'hit-tf2', 'crit-tf2', 'frying-pan',
        'match-win', 'match-loss', 'match-end',
        'respawn', 'equip-change', 'settings-apply'
    ];
    
    assert.equal(Object.keys(Audio.CUES).length, expectedCues.length, `cue table must have exactly ${expectedCues.length} cues`);
    
    for (const cueName of expectedCues) {
        assert.ok(Audio.CUES[cueName], `cue ${cueName} must exist in CUES table`);
        const cue = Audio.CUES[cueName];
        assert.equal(typeof cue.fn, 'string', `cue ${cueName} must have a fn property`);
    }
});

test('playCue returns boolean result consistently', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    
    const r1 = audio.playCue('ui-click');
    assert.equal(typeof r1, 'boolean', 'return type must be boolean');
    assert.equal(r1, true);
    
    const r2 = audio.playCue('ui-click');
    assert.equal(typeof r2, 'boolean', 'return type must be boolean');
    assert.equal(r2, false, 'retrigger blocked');
    
    const r3 = audio.playCue('unknown');
    assert.equal(typeof r3, 'boolean', 'return type must be boolean');
    assert.equal(r3, false, 'unknown cue');
});

test('sfx cues include volume parameter (hit-tf2, crit-tf2, frying-pan)', () => {
    const sfxCues = ['hit-tf2', 'crit-tf2', 'frying-pan'];
    
    for (const cueName of sfxCues) {
        const cue = Audio.CUES[cueName];
        assert.ok(cue.fn === 'playSfx', `${cueName} must use playSfx function`);
        assert.ok(Array.isArray(cue.args) && cue.args.length === 2, `${cueName} must have [filename, volume] args`);
        assert.ok(typeof cue.args[1] === 'number', `${cueName} volume must be a number`);
    }
});

test('match-end cues map to preloaded TF2 sounds with correct volumes', () => {
    const matchCues = {
        'match-win': { fn: 'playSfx', args: ['tf2_victory', 0.7] },
        'match-loss': { fn: 'playSfx', args: ['tf2_you_failed', 0.65] },
        'match-end': { fn: 'playSfx', args: ['tf2_notification', 0.5] }
    };
    
    for (const [cueName, expected] of Object.entries(matchCues)) {
        const cue = Audio.CUES[cueName];
        assert.ok(cue, `${cueName} must exist`);
        assert.equal(cue.fn, expected.fn, `${cueName} fn must be ${expected.fn}`);
        assert.deepEqual(cue.args, expected.args, `${cueName} args must match`);
        assert.equal(cue.retriggerMs, 1000, `${cueName} must have 1000ms retrigger guard`);
    }
});

test('match-end cue volume ladder is intentional: win >= loss > end', () => {
    const win = Audio.CUES['match-win'].args[1];
    const loss = Audio.CUES['match-loss'].args[1];
    const end = Audio.CUES['match-end'].args[1];
    
    assert.ok(win >= loss, 'victory must be >= loss volume');
    assert.ok(loss > end, 'loss must be > neutral terminator volume');
    assert.ok(win >= 0 && win <= 1, 'win volume must be in [0,1]');
    assert.ok(loss >= 0 && loss <= 1, 'loss volume must be in [0,1]');
    assert.ok(end >= 0 && end <= 1, 'end volume must be in [0,1]');
});

test('match-end cues have 1000ms retrigger guard (no overlap on double endGame)', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    
    const first = audio.playCue('match-win');
    assert.equal(first, true, 'first match-win plays');
    
    const second = audio.playCue('match-win');
    assert.equal(second, false, 'second match-win within 1000ms is blocked (guard prevents vocal overlap)');
});

test('graceful exception handling: cues degrade gracefully when functions unavailable', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    // All defined cues should work or gracefully no-op
    const cueNames = Object.keys(Audio.CUES);
    for (const cueName of cueNames) {
        assert.doesNotThrow(() => {
            audio.playCue(cueName);
        }, `cue ${cueName} must not throw`);
    }
});

test('threat cues with different levels', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    
    // All three threat levels should exist
    const r1 = audio.playCue('threat-1');
    assert.equal(r1, true, 'threat-1 must play');
    
    // Need different cue to bypass retrigger
    const r2 = audio.playCue('threat-2');
    assert.equal(r2, true, 'threat-2 must play (different cue)');
    
    const r3 = audio.playCue('threat-3');
    assert.equal(r3, true, 'threat-3 must play (different cue)');
});

test('knife action cues', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;
    
    const actions = ['knife-inspect', 'knife-slash', 'knife-stab'];
    for (const cue of actions) {
        const r = audio.playCue(cue);
        assert.equal(r, true, `${cue} must play`);
    }
});

test('respawn cue plays and uses the default 50ms retrigger guard', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;

    const first = audio.playCue('respawn');
    assert.equal(first, true, 'respawn cue must play');
    assert.equal(Audio.CUES['respawn'].fn, 'playRespawn');
    assert.equal(Audio.CUES['respawn'].retriggerMs, undefined, 'respawn has no custom retrigger override (defaults to 50ms)');

    const second = audio.playCue('respawn');
    assert.equal(second, false, 'immediate re-trigger within 50ms is blocked');
});

test('equip-change cue plays for character/knife loadout swaps', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;

    const result = audio.playCue('equip-change');
    assert.equal(result, true, 'equip-change cue must play');
    assert.equal(Audio.CUES['equip-change'].fn, 'playEquipChange');
});

test('settings-apply cue plays for settings confirmation', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0.5;

    const result = audio.playCue('settings-apply');
    assert.equal(result, true, 'settings-apply cue must play');
    assert.equal(Audio.CUES['settings-apply'].fn, 'playSettingsApply');
});

test('new cues (respawn, equip-change, settings-apply) respect mute like every other cue', () => {
    const { audio } = createAudioHarness();
    audio.soundVolume = 0;

    for (const cue of ['respawn', 'equip-change', 'settings-apply']) {
        assert.equal(audio.playCue(cue), false, `${cue} must be silenced when muted`);
    }
});
