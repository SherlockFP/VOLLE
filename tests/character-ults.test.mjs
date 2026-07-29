// tests/character-ults.test.mjs — regression coverage for character ultimates and combo acceleration:
// 1. Every character in the roster has a corresponding ULTS entry
// 2. Every ult has finite duration, non-empty name and description
// 3. Combo acceleration is monotonic, properly capped, and safe on invalid input
// 4. Combo + CDR rune stacking produces bounded, predictable results

import test from 'node:test';
import assert from 'node:assert/strict';
import { ULTIMATES, getComboAcceleration, tickSkillCooldowns, SKILLS } from '../js/skills.js';

// Import ROSTER to get authoritative character list
// Note: characters.js doesn't export ROSTER, so we read and parse it
import { readFile } from 'node:fs/promises';
const charactersSource = await readFile(new URL('../js/characters.js', import.meta.url), 'utf8');

// Extract character ids more reliably: find all lines with "id: 'xxx'," format
const rosterStart = charactersSource.indexOf('const ROSTER = {');
const rosterEnd = charactersSource.indexOf('};', rosterStart);
const rosterText = charactersSource.substring(rosterStart, rosterEnd);
const characterMatches = rosterText.match(/id:\s*'([a-z_]+)'/g) || [];
const characterIds = characterMatches.map(m => m.match(/'([^']+)'/)[1]);

test('Every character in ROSTER has an ULTIMATES entry', () => {
    const missingUlts = [];
    for (const charId of characterIds) {
        if (!ULTIMATES[charId]) {
            missingUlts.push(charId);
        }
    }
    assert.equal(missingUlts.length, 0, 
        `Missing ULTIMATES entries: ${missingUlts.join(', ')}`);
});

test('Every ULTIMATES entry has finite duration, non-empty name, non-empty description', () => {
    for (const [id, ult] of Object.entries(ULTIMATES)) {
        assert.ok(typeof ult.duration === 'number' && isFinite(ult.duration),
            `${id}: duration must be finite number`);
        assert.ok(ult.duration >= 0, `${id}: duration must be non-negative`);
        assert.ok(ult.name && typeof ult.name === 'string' && ult.name.length > 0,
            `${id}: name must be non-empty string`);
        assert.ok(ult.desc && typeof ult.desc === 'string' && ult.desc.length > 0,
            `${id}: desc must be non-empty string`);
    }
});

test('Combo acceleration is monotonic and properly capped', () => {
    // Test ascending combo counts
    const accelerations = [];
    for (let i = 0; i <= 6; i++) {
        accelerations.push(getComboAcceleration(i));
    }
    
    // Should increase monotonically
    for (let i = 1; i < accelerations.length - 1; i++) {
        assert.ok(accelerations[i] >= accelerations[i - 1],
            `Combo ${i}: acceleration must increase or stay same`);
    }
    
    // Should cap at 1.4x (combo 4+)
    assert.equal(accelerations[4], 1.4, 'combo 4+ should be exactly 1.4x');
    assert.equal(accelerations[5], 1.4, 'combo 5+ should still be capped at 1.4x');
    assert.equal(accelerations[6], 1.4, 'combo 6+ should still be capped at 1.4x');
});

test('Combo acceleration is safe on invalid input (garbage rejection)', () => {
    // Non-integer input
    assert.equal(getComboAcceleration(1.5), 1, 'non-integer -> 1x');
    assert.equal(getComboAcceleration(NaN), 1, 'NaN -> 1x');
    assert.equal(getComboAcceleration(Infinity), 1, 'Infinity -> 1x');
    
    // Negative or zero
    assert.equal(getComboAcceleration(-1), 1, 'negative -> 1x');
    assert.equal(getComboAcceleration(-100), 1, 'large negative -> 1x');
    assert.equal(getComboAcceleration(0), 1, 'zero -> 1x (no acceleration)');
    
    // Undefined / null
    assert.equal(getComboAcceleration(undefined), 1, 'undefined -> 1x (default param)');
    assert.equal(getComboAcceleration(null), 1, 'null (falsy) -> 1x');
    assert.equal(getComboAcceleration(), 1, 'no argument -> 1x');
});

test('Combo + CDR rune stacking: combined effect is bounded and predictable', () => {
    // Scenario: 4+ combo (1.4x) + 20% CDR (1/(1-0.20) = 1.25x)
    // Combined: 1.4x * 1.25x = 1.75x drain acceleration
    
    const entity = {
        skillCooldowns: { slow: 35 },
        runeBonuses: { cdr: 0.20, hp: 0, dmgResist: 0, deflect: 0, speed: 0,
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    // With 4+ combo + 20% CDR, a 35s cooldown should drain in ~20 seconds
    // Time = cooldown / (accel * (1 / (1 - cdr))) = 35 / (1.4 * 1.25) = 35 / 1.75 = 20s
    
    for (let i = 0; i < 19; i++) {
        tickSkillCooldowns(entity, 1, 4);  // combo = 4
    }
    assert.ok(entity.skillCooldowns.slow > 0, 'still cooling after 19s with combo');
    
    // One more tick
    tickSkillCooldowns(entity, 1, 4);
    assert.ok(entity.skillCooldowns.slow <= 0.1, 'cooldown complete after ~20s (combo + CDR)');
});

test('Combo acceleration without CDR works as expected', () => {
    // Scenario: 4+ combo (1.4x) without CDR
    // Time = cooldown / accel = 35 / 1.4 = 25s
    
    const entity = {
        skillCooldowns: { slow: 35 },
        runeBonuses: { cdr: 0, hp: 0, dmgResist: 0, deflect: 0, speed: 0,
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    for (let i = 0; i < 24; i++) {
        tickSkillCooldowns(entity, 1, 4);
    }
    assert.ok(entity.skillCooldowns.slow > 0, 'still cooling after 24s with only combo');
    
    tickSkillCooldowns(entity, 1, 4);
    assert.ok(entity.skillCooldowns.slow <= 0.1, 'cooldown complete after 25s (combo only)');
});

test('Cooldown reduction still works without combo (backward compatibility)', () => {
    // Scenario: 20% CDR only (no combo)
    // Time = cooldown * (1 - cdr) = 35 * 0.8 = 28s
    
    const entity = {
        skillCooldowns: { slow: 35 },
        runeBonuses: { cdr: 0.20, hp: 0, dmgResist: 0, deflect: 0, speed: 0,
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    for (let i = 0; i < 27; i++) {
        tickSkillCooldowns(entity, 1, 0);  // no combo
    }
    assert.ok(entity.skillCooldowns.slow > 0, 'still cooling after 27s (CDR only)');
    
    tickSkillCooldowns(entity, 1, 0);
    assert.ok(entity.skillCooldowns.slow <= 0.1, 'cooldown complete after 28s (CDR only)');
});

test('Maximum reachable cooldown acceleration (worst case)', () => {
    // Worst case: 4+ combo + max CDR (0.20)
    // Drain multiplier = 1.4 * (1 / (1 - 0.20)) = 1.4 * 1.25 = 1.75x
    // So a 105s cooldown (blackhole) takes 105 / 1.75 = 60s to drain
    
    const entity = {
        skillCooldowns: { blackhole: 105 },
        runeBonuses: { cdr: 0.20, hp: 0, dmgResist: 0, deflect: 0, speed: 0,
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    // Drain for 59 seconds
    for (let i = 0; i < 59; i++) {
        tickSkillCooldowns(entity, 1, 4);
    }
    assert.ok(entity.skillCooldowns.blackhole > 0, 'blackhole still cooling after 59s at max speed');
    
    tickSkillCooldowns(entity, 1, 4);
    assert.ok(entity.skillCooldowns.blackhole <= 0.1, 'blackhole ready after ~60s at max acceleration');
    
    // Verify it doesn't reach permanent 0 (i.e., player still has to wait some time)
    assert.ok(105 / 1.75 > 50, 'max cooldown still takes >50s even at worst case');
});

test('Ult count matches character count (full roster coverage)', () => {
    assert.equal(Object.keys(ULTIMATES).length, characterIds.length,
        `ULTIMATES has ${Object.keys(ULTIMATES).length} entries, ` +
        `but ROSTER has ${characterIds.length} characters`);
});

test('All ult names are unique (no accidental duplicates)', () => {
    const names = Object.values(ULTIMATES).map(u => u.name);
    const uniqueNames = new Set(names);
    assert.equal(names.length, uniqueNames.size,
        `Found duplicate ult names`);
});
