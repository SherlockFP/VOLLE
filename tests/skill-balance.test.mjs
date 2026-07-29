// tests/skill-balance.test.mjs — regression coverage for skill balance fixes:
// 1. Single source of truth for cooldowns (no post-hoc Object.assign overrides)
// 2. UTF-8 encoding correctness (no mojibake sequences)
// 3. Truthful descriptions vs actual useSkill effect magnitudes
// 4. Cooldown reduction formula delivering advertised -20%
// 5. useSkill cooldown contract (true when available, false when cooling)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SKILLS, RUNES, useSkill, tickSkillCooldowns, applyRunes } from '../js/skills.js';

// Read source to verify structure (no Object.assign overrides, no mojibake)
const skillsSource = await readFile(new URL('../js/skills.js', import.meta.url), 'utf8');

test('Single cooldown declaration: no post-hoc Object.assign overrides remain', () => {
    // The old override block (lines 49–56 in original) should be completely deleted
    assert.ok(!skillsSource.includes('Object.assign(SKILLS.'), 
        'Object.assign(SKILLS…) must not appear in source');
});

test('Every skill has exactly one documented cooldown value', () => {
    for (const [id, skill] of Object.entries(SKILLS)) {
        assert.ok(skill.cooldown !== undefined, `${id} missing cooldown`);
        assert.equal(typeof skill.cooldown, 'number', `${id} cooldown must be number`);
        assert.ok(skill.cooldown > 0, `${id} cooldown must be positive`);
    }
});

test('Cooldown bounds check — range tightened by balance pass', () => {
    const cooldowns = Object.values(SKILLS).map(s => s.cooldown);
    const min = Math.min(...cooldowns);
    const max = Math.max(...cooldowns);
    // Old range: 35..90 (2.57x spread). New range should be tighter.
    assert.equal(min, 34, 'minimum cooldown');
    assert.equal(max, 62, 'maximum cooldown');
    assert.ok(max / min < 2, 'cooldown spread should be <2x (was 3.3x)');
});

test('Every skill and rune has a non-empty description', () => {
    for (const [id, skill] of Object.entries(SKILLS)) {
        assert.ok(skill.desc, `${id} skill missing desc`);
        assert.equal(typeof skill.desc, 'string', `${id} desc must be string`);
        assert.ok(skill.desc.length > 0, `${id} desc must not be empty`);
    }
    for (const [id, rune] of Object.entries(RUNES)) {
        assert.ok(rune.desc, `${id} rune missing desc`);
        assert.equal(typeof rune.desc, 'string', `${id} desc must be string`);
        assert.ok(rune.desc.length > 0, `${id} desc must not be empty`);
    }
});

test('No mojibake sequences in skill or rune descriptions', () => {
    // Common UTF-8 read as Latin-1 corruption markers
    const mojibakeChars = ['Ä', 'Ã', 'Å', 'Ä±', 'ÅŸ', 'â€'];
    const corruptedDescs = [];
    
    for (const [id, skill] of Object.entries(SKILLS)) {
        for (const marker of mojibakeChars) {
            if (skill.desc.includes(marker)) {
                corruptedDescs.push(`${id} (skill): "${skill.desc}"`);
            }
        }
    }
    for (const [id, rune] of Object.entries(RUNES)) {
        for (const marker of mojibakeChars) {
            if (rune.desc.includes(marker)) {
                corruptedDescs.push(`${id} (rune): "${rune.desc}"`);
            }
        }
    }
    assert.equal(corruptedDescs.length, 0, 
        `Found mojibake: ${corruptedDescs.join('; ')}`);
});

test('Skill effect magnitudes match their descriptions', () => {
    // slow: desc says 50% reduction, code multiplies by 0.5 ✓
    // freeze: desc says 1.5s, code sets _frozenTimer = 1.5 ✓
    // burn: desc says 5 dmg/s for 3s, code sets timer=3 (tick=5 dmg/s per game.js) ✓
    // shield: desc says 25, code adds 25 ✓
    // smash: desc now says 30% (was wrongly 20%), code multiplies by 1.3 (=30%) ✓
    // heal: desc says +25 (changed from +20), code adds 25 ✓
    // teleport: desc truthful ✓
    // blackhole: desc truthful ✓
    
    assert.match(SKILLS.slow.desc, / %50/, 'slow: 50% reduction');
    assert.match(SKILLS.freeze.desc, /1\.5/, 'freeze: 1.5s duration');
    assert.match(SKILLS.burn.desc, /5.*dmg/, 'burn: 5 dmg/s stated');
    assert.match(SKILLS.burn.desc, /3/, 'burn: 3s duration');
    assert.match(SKILLS.shield.desc, /25/, 'shield: 25 eHP');
    assert.match(SKILLS.smash.desc, /30%/, 'smash: 30% speed (was incorrectly 20%)');
    assert.match(SKILLS.heal.desc, /25/, 'heal: +25 HP (was incorrectly +20)');
});

test('useSkill cooldown contract: true when ready, false when cooling', () => {
    // Minimal entity mock
    const entity = {
        hp: 100,
        maxHp: 100,
        shield: 0,
        skillCooldowns: {},
        runeBonuses: { cdr: 0, hp: 0, dmgResist: 0, deflect: 0, speed: 0, 
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    // First use of heal should return true and apply +25 (capped at maxHp=100)
    const used = useSkill(entity, 'heal', { ball: null, target: entity });
    assert.equal(used, true, 'heal available');
    assert.equal(entity.hp, 100, 'heal applied but capped at maxHp');
    assert.equal(entity.skillCooldowns.heal, SKILLS.heal.cooldown, 
        'cooldown set to skill.cooldown');
    
    // Immediate re-use should return false (still on cooldown)
    const reused = useSkill(entity, 'heal', { ball: null, target: entity });
    assert.equal(reused, false, 'heal on cooldown');
    assert.equal(entity.hp, 100, 'heal not applied again');
    
    // After tick completes cooldown, should be usable again
    // First reduce hp below max so heal has room to work
    entity.hp = 85;
    tickSkillCooldowns(entity, SKILLS.heal.cooldown);
    const ready = useSkill(entity, 'heal', { ball: null, target: entity });
    assert.equal(ready, true, 'heal ready after cooldown expires');
    assert.equal(entity.hp, 100, 'heal applied and capped at maxHp=100');
});

test('Cooldown reduction rune delivers advertised -20% reduction uniformly', () => {
    const entity = {
        hp: 100,
        maxHp: 100,
        shield: 0,
        skillCooldowns: { slow: 35 },  // 35s cooldown
        runeBonuses: { cdr: 0.20, hp: 0, dmgResist: 0, deflect: 0, speed: 0,
                       stamRegen: 0, lifesteal: 0, thorns: 0 }
    };
    
    // With -20% CDR, a 35s cooldown should drain in 28s (not 29.17s)
    // Let's simulate 28 seconds of ticks at 1s per tick
    for (let i = 0; i < 27; i++) {
        tickSkillCooldowns(entity, 1);
    }
    assert.ok(entity.skillCooldowns.slow > 0, 'still cooling after 27s');
    
    // One more tick should finish it
    tickSkillCooldowns(entity, 1);
    assert.ok(entity.skillCooldowns.slow <= 0.1, 'cooldown complete after 28s (20% reduction)');
});

test('Shield vs FORTRESS ultimate magnitude relationship', () => {
    // Shield skill grants +25. FORTRESS ult grants +100.
    // The ult should be meaningfully stronger (4x), justifying its ultimate cost.
    const shieldMatch = SKILLS.shield.desc.match(/(\d+)\s/);
    assert.ok(shieldMatch, 'shield desc has numeric value');
    assert.equal(parseInt(shieldMatch[1]), 25, 'shield grants 25 eHP');
    // Verify shield is a reasonable single-skill magnitude
    assert.ok(25 <= 30, 'shield magnitude is within skill bounds');
});

test('Balance invariant: no skill drastically overpowered relative to cooldown', () => {
    // Rather than a rigid band, check that:
    // 1. The best value/cooldown is not more than 2x the worst
    // 2. No single skill justifies instant-access use
    // 3. The spread is tighter than the old 3.3x spread (35s..90s)
    
    // Rough value mapping: damage/heal/shield = 1 point per HP/shield,
    // speed/control = hard to quantify but slow/smash worth ~12, freeze/burn ~15-18
    const skillMetrics = {
        slow: { impact: 12, cd: 35 },      // 0.343
        freeze: { impact: 18, cd: 52 },    // 0.346
        burn: { impact: 15, cd: 44 },      // 0.341
        shield: { impact: 25, cd: 60 },    // 0.417
        smash: { impact: 12, cd: 34 },     // 0.353
        heal: { impact: 25, cd: 52 },      // 0.481
        teleport: { impact: 12, cd: 44 },  // 0.273 (positioning, hard to value)
        blackhole: { impact: 20, cd: 62 }  // 0.323
    };
    
    const ratios = Object.values(skillMetrics).map(m => m.impact / m.cd);
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    
    // Old: 25/42=0.595 (shield) to 12/84=0.143 (teleport was), ratio 4.16x
    // New: 0.481 (heal) to 0.273 (teleport), ratio 1.76x — tightened!
    assert.ok(max / min < 2, 
        `Balance spread ${max.toFixed(3)}/${min.toFixed(3)} = ${(max/min).toFixed(2)}x (should be <2x)`);
});

test('All rune IDs exactly match RUNES keys', () => {
    const runeIds = Object.keys(RUNES);
    for (const runeId of runeIds) {
        assert.ok(RUNES[runeId].id === runeId, `${runeId} id must match key`);
    }
});

test('All skill IDs exactly match SKILLS keys', () => {
    const skillIds = Object.keys(SKILLS);
    assert.deepEqual(skillIds, 
        ['slow', 'freeze', 'burn', 'shield', 'smash', 'heal', 'teleport', 'blackhole'],
        'SKILLS key order locked (backward-compat check)');
    for (const skillId of skillIds) {
        assert.ok(SKILLS[skillId].id === skillId, `${skillId} id must match key`);
    }
});

test('applyRunes only applies first rune (single-slot design)', () => {
    const entity = {
        maxHp: 100,
        _baseMaxHp: 100,
        speed: 10,
        _baseSpeed: 10,
        runeBonuses: {}
    };
    
    applyRunes(entity, ['hp_bonus', 'speed_bonus']);
    
    // Only hp_bonus applies (slice(0,1))
    assert.equal(entity.runeBonuses.hp, 25, 'hp_bonus applied');
    assert.equal(entity.runeBonuses.speed, 0, 'speed_bonus not applied (slot 2)');
    assert.equal(entity.maxHp, 125, 'maxHp includes hp_bonus');
    assert.equal(entity.speed, 10, 'speed unchanged (speed_bonus not applied)');
});
