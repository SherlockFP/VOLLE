import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COSMETIC_LIMITS,
    DEFAULT_COSMETIC_LOADOUT,
    canEquipCosmeticLoadout,
    deterministicDuplicateTradeUp,
    migrateCosmeticLoadout,
    normalizeCosmeticLoadout,
    patternColors,
    sanitizeNameTag,
    validateCosmeticEquip
} from '../js/cosmetic-customization.js';

const ownership = {
    knives: ['tide'],
    stickers: ['ace', 'bolt'],
    charms: ['ball'],
    mvpEffects: ['spotlight'],
    ballTrails: ['comet'],
    goalEffects: ['burst']
};

test('knife customization is allowlisted, bounded, sanitized, and does not mutate input', () => {
    const input = {
        knife: {
            id: 'tide',
            stickers: ['ace', 'unknown', 'bolt', null, 'star'],
            charm: 'hacked',
            nameTag: '  <b>Best\nKnife</b>  ',
            patternSeed: 1000002.8,
            wear: -0.5
        },
        mvpEffect: 'spotlight',
        ballTrail: 'invalid',
        goalEffect: 'burst'
    };
    const before = structuredClone(input);
    const loadout = normalizeCosmeticLoadout(input);

    assert.deepEqual(input, before);
    assert.deepEqual(loadout.knife.stickers, ['ace', null, 'bolt', null]);
    assert.equal(loadout.knife.charm, null);
    assert.equal(loadout.knife.nameTag, 'bBest Knife/b');
    assert.equal(loadout.knife.patternSeed, COSMETIC_LIMITS.patternSeed);
    assert.equal(loadout.knife.wear, 0);
    assert.equal(loadout.ballTrail, 'none');
});

test('name tags remove unsafe text and enforce a code-point limit', () => {
    assert.equal(sanitizeNameTag(' "Goal" & <script> '), 'Goal script');
    assert.equal([...sanitizeNameTag('x'.repeat(40))].length, COSMETIC_LIMITS.nameTagLength);
    assert.equal(sanitizeNameTag(null), '');
});

test('pattern colors are deterministic, seed-sensitive, and palette-bound', () => {
    const first = patternColors(42, 'ember');
    assert.deepEqual(patternColors(42, 'ember'), first);
    assert.notDeepEqual(patternColors(43, 'ember'), first);
    assert.equal(first.length, 3);
    assert.ok(first.every(color => /^#[0-9a-f]{6}$/.test(color)));
});

test('equip validation enforces team, ownership, slots, and normalized values', () => {
    const valid = normalizeCosmeticLoadout({
        knife: {
            id: 'tide',
            stickers: ['ace'],
            charm: 'ball',
            nameTag: 'Clean',
            patternSeed: 12,
            wear: 0.25
        },
        mvpEffect: 'spotlight',
        ballTrail: 'comet',
        goalEffect: 'burst'
    });
    assert.equal(canEquipCosmeticLoadout(valid, { team: 'blue', ownership }), true);
    assert.equal(canEquipCosmeticLoadout(valid, { team: 'red', ownership }), false);

    const invalid = structuredClone(valid);
    invalid.knife.stickers.push('star');
    invalid.knife.wear = 2;
    invalid.ballTrail = 'rainbow';
    const result = validateCosmeticEquip(invalid, { team: 'blue', ownership });
    assert.equal(result.valid, false);
    assert.match(result.errors.join('|'), /sticker slot limit|wear|ballTrail is not owned/);
});

test('duplicate trade-up consumes ten copies and gives a stable reward', () => {
    const inventory = { tide: 12, prism: 1 };
    const pool = ['sherlock', 'fade', 'doppler', 'fade'];
    const first = deterministicDuplicateTradeUp(inventory, 'tide', pool);
    const second = deterministicDuplicateTradeUp(inventory, 'tide', [...pool].reverse());

    assert.deepEqual(first, second);
    assert.deepEqual(inventory, { tide: 12, prism: 1 });
    assert.equal(first.inventory.tide, 2);
    assert.equal(first.inventory[first.rewardId], 1);
    assert.throws(
        () => deterministicDuplicateTradeUp({ tide: 9 }, 'tide', pool),
        /requires 10/
    );
});

test('legacy customization migrates to normalized v2 slots', () => {
    const legacy = {
        equippedKnife: 'flare',
        stickers: ['gg', 'bad'],
        knifeCharm: 'trophy',
        knifeNameTag: '  Winner  ',
        seed: '17',
        wear: '0.125',
        mvp: 'confetti',
        trail: 'electric',
        goal: 'fireworks',
        ignored: '<unsafe>'
    };
    const migrated = migrateCosmeticLoadout(legacy);

    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.knife, {
        id: 'flare',
        stickers: ['gg', null, null, null],
        charm: 'trophy',
        nameTag: 'Winner',
        patternSeed: 17,
        wear: 0.125
    });
    assert.equal(migrated.mvpEffect, 'confetti');
    assert.equal(migrated.ballTrail, 'electric');
    assert.equal(migrated.goalEffect, 'fireworks');
    assert.deepEqual(migrateCosmeticLoadout(null), {
        version: DEFAULT_COSMETIC_LOADOUT.version,
        knife: {
            ...DEFAULT_COSMETIC_LOADOUT.knife,
            stickers: [...DEFAULT_COSMETIC_LOADOUT.knife.stickers]
        },
        mvpEffect: 'none',
        ballTrail: 'none',
        goalEffect: 'none'
    });
});
