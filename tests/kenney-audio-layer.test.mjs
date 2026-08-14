// Kenney CC0 audio layer: tiny, lazy and always safe to fall back from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { Audio } from '../js/audio.js';

const CLIP_ENTRIES = Object.entries(Audio.KENNEY_CLIPS);

test('Kenney clip table stays a small CC0 UI/impact subset with shipped files', async () => {
    assert.equal(CLIP_ENTRIES.length, 5, 'do not silently turn this into a full-pack preload');
    for (const [name, path] of CLIP_ENTRIES) {
        assert.match(name, /^(ui-|deflect-)/);
        assert.match(path, /^assets\/cc0\/kenney\/audio\/(interface|impact)\/.+\.ogg$/);
        await access(new URL(`../${path}`, import.meta.url));
    }
    const manifest = await readFile(new URL('../assets/cc0/ASSET_MANIFEST.md', import.meta.url), 'utf8');
    assert.match(manifest, /Kenney Interface \+ Impact Sounds/);
    assert.match(manifest, /CC0 1\.0/);
});

test('Kenney playback reuses a decoded buffer and respects its retrigger cap', () => {
    const audio = new Audio();
    let sources = 0;
    audio.ctx = {
        currentTime: 1,
        createBufferSource: () => ({ connect() {}, start() { sources++; } }),
        createGain: () => ({ gain: { value: 0 }, connect() {} })
    };
    audio.masterGain = {};
    audio._kenneyBuffers.set('ui-click', { decoded: true });
    const originalPerformance = globalThis.performance;
    globalThis.performance = { now: () => 1000 };
    try {
        assert.equal(audio._playKenneyClip('ui-click', 0.2, 80), true);
        assert.equal(audio._playKenneyClip('ui-click', 0.2, 80), true, 'cap is handled without spawning a second source');
        assert.equal(sources, 1);
    } finally {
        globalThis.performance = originalPerformance;
    }
});

test('missing Kenney buffer schedules loading then leaves the procedural caller usable', () => {
    const audio = new Audio();
    audio.ctx = {};
    audio.masterGain = {};
    assert.equal(audio._playKenneyClip('ui-click', 0.2), false);
    assert.equal(audio._kenneyBuffers.size, 0, 'no synthetic replacement is cached as external audio');
});

test('decoded deflect foley layers under rather than replacing shot synth identity', () => {
    const audio = new Audio();
    let sources = 0;
    let oscillators = 0;
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    audio.ctx = {
        currentTime: 0,
        createBufferSource: () => ({ connect() {}, start() { sources++; } }),
        createGain: () => ({ gain: param(), connect() {} }),
        createOscillator: () => ({
            type: 'sine', frequency: param(), connect() {}, start() { oscillators++; }, stop() {}
        })
    };
    audio.masterGain = {};
    audio._kenneyBuffers.set('deflect-soft', { decoded: true });
    audio.playDeflect('spike');
    assert.equal(sources, 1, 'one restrained foley layer plays');
    assert.equal(oscillators, 3, 'spike keeps both synth body voices and its unique thump');
});

test('central menu click activates audio then delegates ui-click exactly once', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const start = main.indexOf('// UI sound effects for menu buttons');
    const end = main.indexOf('// ponytail:', start);
    const route = main.slice(start, end);
    assert.ok(start >= 0 && end > start, 'central menu sound route exists');
    assert.match(route, /this\.audio\?\.init\?\.\(\);\s*this\.audio\?\.playCue\?\.\('ui-click'\);/);
    assert.equal((route.match(/playCue/g) || []).length, 1, 'one click produces one named cue');
    assert.doesNotMatch(route, /playClick/, 'route does not bypass named cue cooldowns');
});

test('init resumes an existing suspended context on the next user gesture', () => {
    const audio = new Audio();
    audio.ctx = { state: 'suspended' };
    let resumes = 0;
    audio._resumeAudioContext = () => { resumes++; return Promise.resolve(true); };
    audio.init();
    assert.equal(resumes, 1);
});
