import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateVoiceSpatialMix, shouldInitiateVoice } from '../js/voice.js';

test('voice mesh creates one call per peer pair', () => {
    assert.equal(shouldInitiateVoice('alpha', 'bravo'), true);
    assert.equal(shouldInitiateVoice('bravo', 'alpha'), false);
    assert.equal(shouldInitiateVoice('same', 'same'), false);
    assert.equal(shouldInitiateVoice('', 'bravo'), false);
});

test('main routes V voice to living teammates with distance and stereo metadata', async () => {
    const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const targets = main.slice(main.indexOf('    _voiceTargets() {'), main.indexOf('    _syncVoiceChat() {'));
    assert.match(targets, /target\.team === this\.player\.team/);
    assert.match(targets, /distance,/);
    assert.match(targets, /teamChannel: !this\.game\._ffa/);
    assert.match(targets, /pan:/);
    assert.match(main, /e\.code === 'KeyV'[\s\S]*?_startVoicePtt/);
});

test('voice spatial mix preserves team intelligibility and positional direction', () => {
    assert.deepEqual(calculateVoiceSpatialMix(0, .7), { gain: 1, pan: .7 });
    assert.deepEqual(calculateVoiceSpatialMix(80, -2), { gain: .35, pan: -1 });
    assert.deepEqual(calculateVoiceSpatialMix(22, .5, { maxDistance: 22, teamChannel: false }), { gain: .06, pan: .5 });
    assert.deepEqual(calculateVoiceSpatialMix(2, 1, { muted: true }), { gain: 0, pan: 0 });
});
