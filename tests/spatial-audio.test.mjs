// tests/spatial-audio.test.mjs — Directional ball SFX: pure pan/attenuation
// math (computeStereoPan) plus Audio.setListener/playWhoosh/playHit/
// playDeflect/playBounce wiring a StereoPannerNode when a world position is
// given, with no change to non-spatial callers.
import test from 'node:test';
import assert from 'node:assert/strict';

const { Audio, computeStereoPan } = await import('../js/audio.js');

// ===== Pure helper: computeStereoPan =====

test('computeStereoPan: source directly right of listener pans positive', () => {
    const listener = { x: 0, y: 0, z: 0 };
    // Facing -Z (Three.js default forward), right is +X.
    const { pan } = computeStereoPan(listener, 0, -1, { x: 10, y: 0, z: 0 });
    assert.ok(pan > 0.5, `expected strongly positive pan, got ${pan}`);
});

test('computeStereoPan: source directly left of listener pans negative', () => {
    const listener = { x: 0, y: 0, z: 0 };
    const { pan } = computeStereoPan(listener, 0, -1, { x: -10, y: 0, z: 0 });
    assert.ok(pan < -0.5, `expected strongly negative pan, got ${pan}`);
});

test('computeStereoPan: source directly ahead pans near-center', () => {
    const listener = { x: 0, y: 0, z: 0 };
    const { pan, behind } = computeStereoPan(listener, 0, -1, { x: 0, y: 0, z: -10 });
    assert.ok(Math.abs(pan) < 0.05, `expected near-zero pan, got ${pan}`);
    assert.equal(behind, false);
});

test('computeStereoPan: source behind listener is flagged and dips gain', () => {
    const listener = { x: 0, y: 0, z: 0 };
    const ahead = computeStereoPan(listener, 0, -1, { x: 0, y: 0, z: -10 });
    const behind = computeStereoPan(listener, 0, -1, { x: 0, y: 0, z: 10 });
    assert.equal(behind.behind, true);
    assert.ok(behind.gain < ahead.gain, 'behind source should be quieter than one directly ahead at same distance');
});

test('computeStereoPan: pan is clamped to +/-0.85 (never hard-panned)', () => {
    const listener = { x: 0, y: 0, z: 0 };
    const { pan } = computeStereoPan(listener, 0, -1, { x: 500, y: 0, z: 0 });
    assert.ok(pan <= 0.85 && pan >= -0.85, `pan ${pan} exceeds +/-0.85 clamp`);
    assert.ok(pan > 0.8, 'far off-axis source should still pan near the clamp ceiling');
});

test('computeStereoPan: farther sources are quieter than closer ones', () => {
    const listener = { x: 0, y: 0, z: 0 };
    const near = computeStereoPan(listener, 0, -1, { x: 2, y: 0, z: 0 });
    const far = computeStereoPan(listener, 0, -1, { x: 50, y: 0, z: 0 });
    assert.ok(far.gain < near.gain, 'more distant source must attenuate');
    assert.ok(far.gain > 0, 'attenuation should floor above zero, not silence entirely');
});

test('computeStereoPan: missing listener or source position is a safe no-op', () => {
    assert.deepEqual(computeStereoPan(null, 0, -1, { x: 1, y: 0, z: 0 }), { pan: 0, gain: 1, behind: false });
    assert.deepEqual(computeStereoPan({ x: 0, y: 0, z: 0 }, 0, -1, null), { pan: 0, gain: 1, behind: false });
});

// ===== Audio class wiring =====

class MockAudioContext {
    constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = {};
        this.panners = [];
    }
    createGain() {
        return { gain: { value: 0.5, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: () => {} };
    }
    createOscillator() {
        return {
            type: 'sine',
            frequency: { value: 440, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
            detune: { value: 0 },
            connect: () => {},
            start: () => {},
            stop: () => {}
        };
    }
    createBiquadFilter() {
        return { type: 'lowpass', frequency: { value: 1000, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, Q: { value: 0.5 }, connect: () => {} };
    }
    createDynamicsCompressor() {
        return { threshold: { value: -14 }, knee: { value: 24 }, ratio: { value: 8 }, attack: { value: 0.003 }, release: { value: 0.2 }, connect: () => {} };
    }
    createBuffer(channels, length, sampleRate) {
        return { getChannelData: () => new Float32Array(length), numberOfChannels: channels, length, sampleRate };
    }
    createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {} };
    }
    createStereoPanner() {
        const panner = { pan: { value: 0 }, connect: () => {} };
        this.panners.push(panner);
        return panner;
    }
    resume() {
        return Promise.resolve();
    }
}

function createAudioHarness() {
    globalThis.window = { webkitAudioContext: MockAudioContext, AudioContext: MockAudioContext };
    globalThis.performance = { now: () => Date.now() };
    const audio = new Audio();
    audio.ctx = new MockAudioContext();
    audio.masterGain = audio.ctx.createGain();
    audio.masterGain.gain.value = audio.soundVolume * 0.4;
    audio.tone = audio.ctx.createBiquadFilter();
    audio.limiter = audio.ctx.createDynamicsCompressor();
    audio.masterGain.connect(audio.tone);
    audio.tone.connect(audio.limiter);
    audio.limiter.connect(audio.ctx.destination);
    return audio;
}

test('setListener with no position clears the listener (non-spatial fallback)', () => {
    const audio = createAudioHarness();
    audio.setListener({ x: 1, y: 0, z: 1 }, 0, -1);
    assert.equal(audio._listenerSet, true);
    audio.setListener(null);
    assert.equal(audio._listenerSet, false);
});

test('setListener mutates the same reused objects — zero per-call allocation', () => {
    const audio = createAudioHarness();
    const posRef = audio._listenerPos;
    const fwdRef = audio._listenerFwd;
    audio.setListener({ x: 3, y: 0, z: 4 }, 1, 0);
    assert.equal(audio._listenerPos, posRef, 'listener position object must be reused, not replaced');
    assert.equal(audio._listenerFwd, fwdRef, 'listener forward object must be reused, not replaced');
    assert.equal(audio._listenerPos.x, 3);
    assert.equal(audio._listenerPos.z, 4);
});

test('without a listener, playHit/playWhoosh/playDeflect/playBounce behave exactly as before (no panner created)', () => {
    const audio = createAudioHarness();
    audio.playHit({ x: 10, y: 0, z: 0 }); // pos given, but no setListener call yet
    audio.playWhoosh(5, { x: 10, y: 0, z: 0 });
    audio.playDeflect('flat', { x: 10, y: 0, z: 0 });
    audio.playBounce({ x: 10, y: 0, z: 0 });
    assert.equal(audio.ctx.panners.length, 0, 'no StereoPannerNode should be created without an active listener');
});

test('playHit with a listener and a source position creates a panner panned toward the source', () => {
    const audio = createAudioHarness();
    audio.setListener({ x: 0, y: 0, z: 0 }, 0, -1);
    audio.playHit({ x: 10, y: 0, z: 0 });
    assert.equal(audio.ctx.panners.length, 1);
    assert.ok(audio.ctx.panners[0].pan.value > 0, 'source to the right should pan positive');
});

test('playWhoosh/playDeflect/playBounce each spatialize when given a position', () => {
    const audio = createAudioHarness();
    audio.setListener({ x: 0, y: 0, z: 0 }, 0, -1);
    audio.playWhoosh(5, { x: -10, y: 0, z: 0 });
    audio.playDeflect('spike', { x: -10, y: 0, z: 0 });
    audio.playBounce({ x: -10, y: 0, z: 0 });
    assert.equal(audio.ctx.panners.length, 3);
    for (const panner of audio.ctx.panners) {
        assert.ok(panner.pan.value < 0, 'source to the left should pan negative');
    }
});

test('playHit/playWhoosh/playDeflect/playBounce with no pos argument stay non-spatial even with a listener set', () => {
    const audio = createAudioHarness();
    audio.setListener({ x: 0, y: 0, z: 0 }, 0, -1);
    audio.playHit();
    audio.playWhoosh(5);
    audio.playDeflect('flat');
    audio.playBounce();
    assert.equal(audio.ctx.panners.length, 0, 'omitting pos must keep behaviour identical to today (no spatialization)');
});
