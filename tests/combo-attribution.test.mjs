import assert from 'node:assert/strict';
import test from 'node:test';
import { extractGameMethod } from './game-source.mjs';

// juice.combo tracks only the local player's perfect-deflect streak. Bots and remote
// players hitting someone must not inherit that streak as bonus damage.
test('combo damage bonus applies only when the local player is the attacker', () => {
    const source = extractGameMethod('_doApplyHit');
    assert.match(source, /const comboMul = attacker === this\.player \? this\.juice\.getComboMultiplier\(\) : 1;/);
    assert.doesNotMatch(source, /const comboMul = this\.juice\.getComboMultiplier\(\);/);
});
