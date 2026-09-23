// tests/knife-foley.test.mjs — synthesized knife sounds build real node graphs per action.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from '../js/audio.js';

const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
class CountingContext {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; this.counts = { osc: 0, noise: 0, buffers: 0 }; }
    createGain() { return { gain: param(), connect() {} }; }
    createOscillator() { this.counts.osc++; return { type: 'sine', frequency: param(), connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: param(), Q: param(), connect() {} }; }
    createBuffer(channels, length) { this.counts.buffers++; return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { this.counts.noise++; return { buffer: null, connect() {}, start() {}, stop() {} }; }
}

function harness() {
    globalThis.window = globalThis.window || {};
    const audio = new Audio();
    audio.ctx = new CountingContext();
    audio.masterGain = audio.ctx.createGain();
    return audio;
}

test('every knife action produces sound and none is the old single-oscillator beep', () => {
    for (const action of ['draw', 'slash', 'stab', 'heavy', 'inspect']) {
        const audio = harness();
        audio.playKnife(action, 'classic');
        const { osc, noise } = audio.ctx.counts;
        assert.ok(osc + noise >= 2, `${action} must layer at least two voices`);
        if (action !== 'draw' && action !== 'inspect') assert.ok(noise >= 1, `${action} needs an air whoosh`);
    }
});

test('the noise buffer is created once and reused across plays', () => {
    const audio = harness();
    for (let i = 0; i < 10; i++) audio.playKnife(i % 2 ? 'slash' : 'inspect', 'butterfly');
    assert.equal(audio.ctx.counts.buffers, 1);
});

test('butterfly draw and inspect add mechanical flip clicks', () => {
    const plain = harness();
    plain.playKnife('inspect', 'classic');
    const butterfly = harness();
    butterfly.playKnife('inspect', 'butterfly');
    assert.ok(butterfly.ctx.counts.noise > plain.ctx.counts.noise);
});

test('no audio context is a silent no-op', () => {
    const audio = new Audio();
    audio.ctx = null;
    assert.doesNotThrow(() => audio.playKnife('slash'));
});
