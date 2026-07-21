import test from 'node:test';
import assert from 'node:assert/strict';

import {
    Audio,
    createThreatAudioState,
    scheduleThreatAudio
} from '../js/audio.js';

function schedule(state, { now, distance, speed, active = true }) {
    return scheduleThreatAudio(state, { now, distance, speed, active });
}

test('classifies distance and speed into three urgency levels', () => {
    const cases = [
        { distance: 18, speed: 12, urgency: 1 },
        { distance: 8, speed: 10, urgency: 2 },
        { distance: 4, speed: 12, urgency: 3 }
    ];

    for (const sample of cases) {
        const result = schedule(createThreatAudioState(), { ...sample, now: 0 });
        assert.equal(result.state.urgency, sample.urgency);
        assert.equal(result.cue, sample.urgency);
    }
});

test('enforces urgency-specific cooldowns', () => {
    let result = schedule(createThreatAudioState(), { now: 0, distance: 18, speed: 12 });
    assert.equal(result.cue, 1);

    result = schedule(result.state, { now: 1299, distance: 18, speed: 12 });
    assert.equal(result.cue, 0);

    result = schedule(result.state, { now: 1300, distance: 18, speed: 12 });
    assert.equal(result.cue, 1);
});

test('urgency increase bypasses the previous cue cooldown', () => {
    let result = schedule(createThreatAudioState(), { now: 0, distance: 18, speed: 12 });
    assert.equal(result.cue, 1);

    result = schedule(result.state, { now: 100, distance: 8, speed: 10 });
    assert.equal(result.cue, 2);

    result = schedule(result.state, { now: 200, distance: 4, speed: 12 });
    assert.equal(result.cue, 3);
});

test('uses hysteresis when urgency falls near a boundary', () => {
    let result = schedule(createThreatAudioState(), { now: 0, distance: 8, speed: 10 });
    assert.equal(result.state.urgency, 2);

    result = schedule(result.state, { now: 100, distance: 9.5, speed: 10 });
    assert.equal(result.state.urgency, 2);

    result = schedule(result.state, { now: 200, distance: 12, speed: 10 });
    assert.equal(result.state.urgency, 1);
});

test('transient target loss preserves cooldown until a hard lifecycle reset', () => {
    const initial = schedule(createThreatAudioState(), { now: 0, distance: 4, speed: 12 });
    const lost = schedule(initial.state, { now: 100, distance: 4, speed: 12, active: false });
    assert.deepEqual(lost, { state: initial.state, cue: 0 });

    const reacquired = schedule(lost.state, { now: 200, distance: 4, speed: 12 });
    assert.equal(reacquired.cue, 0);

    const hardReset = createThreatAudioState();
    const afterLifecycle = schedule(hardReset, { now: 200, distance: 4, speed: 12 });
    assert.equal(afterLifecycle.cue, 3);
});

function createAudioHarness(resume) {
    const audio = new Audio();
    let oscillatorCount = 0;
    const automation = {
        value: 0,
        setValueAtTime() {},
        exponentialRampToValueAtTime() {}
    };
    audio.ctx = {
        state: 'suspended',
        currentTime: 1,
        resume,
        createOscillator() {
            oscillatorCount++;
            return {
                type: '',
                frequency: { value: 0 },
                connect() {},
                start() {},
                stop() {}
            };
        },
        createGain() {
            return { gain: { ...automation }, connect() {} };
        }
    };
    audio.masterGain = {};
    return { audio, oscillatorCount: () => oscillatorCount };
}

test('suspended AudioContext resumes and retries the threat cue', async () => {
    let harness;
    harness = createAudioHarness(async () => {
        harness.audio.ctx.state = 'running';
    });

    harness.audio.playThreatCue(1);
    assert.equal(harness.oscillatorCount(), 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.oscillatorCount(), 1);
});

test('AudioContext resume rejection is handled without playing', async () => {
    const harness = createAudioHarness(() => Promise.reject(new Error('blocked')));
    harness.audio.playThreatCue(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.oscillatorCount(), 0);
});

test('suspended AudioContext uses one resume flight and plays only the newest cue', async () => {
    let resolveResume;
    let resumeCalls = 0;
    let harness;
    harness = createAudioHarness(() => {
        resumeCalls++;
        return new Promise(resolve => {
            resolveResume = () => {
                harness.audio.ctx.state = 'running';
                resolve();
            };
        });
    });

    harness.audio.playThreatCue(1);
    harness.audio.playThreatCue(3);
    assert.equal(resumeCalls, 1);
    assert.equal(harness.oscillatorCount(), 0);
    resolveResume();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.oscillatorCount(), 3);
});

test('threat reset invalidates a cue waiting on AudioContext resume', async () => {
    let resolveResume;
    let harness;
    harness = createAudioHarness(() => new Promise(resolve => {
        resolveResume = () => {
            harness.audio.ctx.state = 'running';
            resolve();
        };
    }));

    harness.audio.playThreatCue(3);
    harness.audio.resetThreatAudio();
    resolveResume();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.oscillatorCount(), 0);
});
