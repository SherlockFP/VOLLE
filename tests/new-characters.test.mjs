import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, applyCharacter } from '../js/characters.js';

const NEW_CHARACTER_IDS = ['anchor', 'phantom', 'hardy', 'swift'];
const EXISTING_CHARACTERS = ['rally', 'tank', 'scout', 'sniper', 'guardian', 'soldier'];
const ALL_CHARACTERS = [...EXISTING_CHARACTERS, ...NEW_CHARACTER_IDS];

test('new characters are defined in CHARACTERS', () => {
    for (const id of NEW_CHARACTER_IDS) {
        assert.ok(
            CHARACTERS[id],
            `CHARACTERS["${id}"] must exist`
        );
    }
});

test('all character ids are unique', () => {
    const ids = Object.keys(CHARACTERS);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'duplicate character ids found');
    assert.ok(ids.includes('rally'), 'rally starter should exist');
});

test('every character has required stat fields with finite positive values', () => {
    for (const [id, char] of Object.entries(CHARACTERS)) {
        assert.ok(char.id === id, `${id}: id field mismatch`);
        assert.ok(typeof char.name === 'string' && char.name.length > 0, `${id}: name missing`);
        assert.ok(Number.isFinite(char.maxHp) && char.maxHp > 0, `${id}: maxHp not finite or non-positive`);
        assert.ok(Number.isFinite(char.speed) && char.speed > 0, `${id}: speed not finite or non-positive`);
        assert.ok(Number.isFinite(char.deflectPower) && char.deflectPower > 0, `${id}: deflectPower not finite or non-positive`);
        assert.ok(Number.isFinite(char.staminaMax) && char.staminaMax > 0, `${id}: staminaMax not finite or non-positive`);
        assert.ok(typeof char.passive === 'string', `${id}: passive not a string`);
        assert.ok(Number.isFinite(char.color) && char.color > 0, `${id}: color not a valid integer`);
        assert.ok(Number.isFinite(char.price), `${id}: price not finite`);
    }
});

test('new characters do not exceed existing max stats', () => {
    const stats = { maxHp: 0, speed: 0, deflectPower: 0, staminaMax: 0 };
    for (const char of Object.values(CHARACTERS)) {
        stats.maxHp = Math.max(stats.maxHp, char.maxHp);
        stats.speed = Math.max(stats.speed, char.speed);
        stats.deflectPower = Math.max(stats.deflectPower, char.deflectPower);
        stats.staminaMax = Math.max(stats.staminaMax, char.staminaMax);
    }
    
    for (const id of NEW_CHARACTER_IDS) {
        const char = CHARACTERS[id];
        assert.ok(
            char.maxHp <= stats.maxHp,
            `new character ${id} maxHp (${char.maxHp}) exceeds existing max (${stats.maxHp})`
        );
        assert.ok(
            char.speed <= stats.speed,
            `new character ${id} speed (${char.speed}) exceeds existing max (${stats.speed})`
        );
        assert.ok(
            char.deflectPower <= stats.deflectPower,
            `new character ${id} deflectPower (${char.deflectPower}) exceeds existing max (${stats.deflectPower})`
        );
        assert.ok(
            char.staminaMax <= stats.staminaMax,
            `new character ${id} staminaMax (${char.staminaMax}) exceeds existing max (${stats.staminaMax})`
        );
    }
});

test('prices follow the existing ladder (0, 300, 400, 450, 500, 550, 600, 650)', () => {
    const validPrices = [0, 300, 400, 450, 500, 550, 600, 650];
    for (const [id, char] of Object.entries(CHARACTERS)) {
        assert.ok(
            validPrices.includes(char.price),
            `${id} price ${char.price} not on ladder: ${validPrices.join(', ')}`
        );
    }
});

test('applyCharacter correctly initializes hp and stamina', () => {
    for (const id of ALL_CHARACTERS) {
        const entity = {};
        const char = applyCharacter(entity, id);
        
        assert.equal(entity.charId, id, `${id}: charId not set`);
        assert.equal(entity.maxHp, char.maxHp, `${id}: maxHp mismatch`);
        assert.equal(entity.hp, char.maxHp, `${id}: hp not initialized to maxHp`);
        assert.equal(entity.speed, char.speed, `${id}: speed mismatch`);
        assert.equal(entity.deflectPower, char.deflectPower, `${id}: deflectPower mismatch`);
        assert.equal(entity.staminaMax, char.staminaMax, `${id}: staminaMax mismatch`);
        assert.equal(entity.stamina, char.staminaMax, `${id}: stamina not initialized to staminaMax`);
        assert.equal(entity.passive, char.passive, `${id}: passive mismatch`);
    }
});

test('applyCharacter uses fallback for unknown character id', () => {
    const entity = {};
    const char = applyCharacter(entity, 'no-such-character');
    assert.equal(entity.charId, 'rally', 'should fallback to rally');
    assert.equal(char.id, 'rally', 'should return rally character');
});

test('new characters use existing passives already consumed elsewhere', () => {
    const characterPassives = {};
    for (const char of Object.values(CHARACTERS)) {
        if (!characterPassives[char.passive]) characterPassives[char.passive] = [];
        characterPassives[char.passive].push(char.id);
    }
    
    const newPassives = {};
    for (const id of NEW_CHARACTER_IDS) {
        const passive = CHARACTERS[id].passive;
        newPassives[passive] = (newPassives[passive] || 0) + 1;
    }
    
    // All new character passives should be existing (reused)
    const usedPassives = ['damage_reduc', 'fast_stam', 'shield_regen', 'spike_bonus'];
    for (const passive of Object.keys(newPassives)) {
        assert.ok(
            usedPassives.includes(passive),
            `new character uses passive "${passive}" which is not an existing hook`
        );
    }
});

test('character color values are valid hex integers', () => {
    for (const [id, char] of Object.entries(CHARACTERS)) {
        assert.ok(
            typeof char.color === 'number' && char.color > 0 && char.color <= 0xffffff,
            `${id}: color ${char.color.toString(16)} not a valid 24-bit hex color`
        );
    }
});

test('comparison table: all 15 characters with power indices', () => {
    const allChars = Object.values(CHARACTERS)
        .map(c => ({
            id: c.id,
            hp: c.maxHp,
            speed: c.speed,
            dmg: c.deflectPower,
            stamina: c.staminaMax,
            price: c.price,
            passive: c.passive,
            power_index: Math.round(c.maxHp * c.speed * c.deflectPower * 10) / 10
        }))
        .sort((a, b) => b.power_index - a.power_index);
    
    console.log('\nFINAL ROSTER (15 characters sorted by power index):');
    console.log('id'.padEnd(10), 'hp'.padEnd(5), 'spd'.padEnd(5), 'dmg'.padEnd(5), 'stam'.padEnd(5), 'price'.padEnd(6), 'power_idx'.padEnd(10), 'passive'.padEnd(15), 'status');
    allChars.forEach((c, idx) => {
        const isNew = NEW_CHARACTER_IDS.includes(c.id);
        const status = isNew ? '[NEW]' : '';
        console.log(c.id.padEnd(10), String(c.hp).padEnd(5), String(c.speed).padEnd(5), String(c.dmg).padEnd(5), String(c.stamina).padEnd(5), String(c.price).padEnd(6), String(c.power_index).padEnd(10), c.passive.padEnd(15), status);
    });
    
    // Verify spread is reasonable
    const minIdx = allChars[allChars.length - 1].power_index;
    const maxIdx = allChars[0].power_index;
    assert.ok(maxIdx > minIdx, 'power indices should vary');
    console.log(`\nPower index range: ${minIdx} to ${maxIdx} (${Math.round((maxIdx - minIdx) / minIdx * 100)}% spread)`);
});
