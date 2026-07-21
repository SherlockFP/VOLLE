import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldInitiateVoice } from '../js/voice.js';

test('voice mesh creates one call per peer pair', () => {
    assert.equal(shouldInitiateVoice('alpha', 'bravo'), true);
    assert.equal(shouldInitiateVoice('bravo', 'alpha'), false);
    assert.equal(shouldInitiateVoice('same', 'same'), false);
    assert.equal(shouldInitiateVoice('', 'bravo'), false);
});
