import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Vector3 } from '../vendor/three/three.module.js';
import { tickSkillCooldowns, useSkill } from '../js/skills.js';

// Actual shipped methods, real vector math; only presentation is replaced.
const source = readFileSync(new URL('../js/bot.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const math = Object.create(Math);
math.random = () => 0.5;
const Bot = runInNewContext(`${source}\nBot`, {
    THREE: { Vector3 }, Math: math, tickSkillCooldowns, useSkill,
    performance: { now: () => 0 }, disposeObject3D() {}
});

function fixture({ collidables = [], ffa = false, team = 'red' } = {}) {
    const bot = Object.assign(Object.create(Bot.prototype), {
        alive: true, hp: 100, maxHp: 100, radius: 0.5, moveSpeed: 5,
        position: new Vector3(-3, 0, -6), velocity: new Vector3(), team,
        group: { position: new Vector3(), rotation: {}, scale: { setScalar() {} } },
        arena: { bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, collidables },
        loadout: { skill: 'slow' }, skillCooldowns: {}, skillChance: 0,
        _gameRef: { _ffa: ffa }, spawnAnim: 1, attackTimer: 0,
        strafeDir: 1, strafeTimer: 100, _defenseIntent: 'none', _defenseDodgeLatch: 0,
        _tendencyApproachMul: 1, _tendencyLateralMul: 1, _tendencyDepthBias: 0
    });
    for (const name of ['_toBall', '_ballDir', '_predOffset', '_interceptTarget',
        '_toIntercept', '_dodgeDir', '_perpDir']) bot[name] = new Vector3();
    return bot;
}

test('FFA bots are not teleported back to their old team half', () => {
    for (const team of ['red', 'blue']) {
        const bot = fixture({ ffa: true, team });
        bot.moveSpeed = 0;
        bot.position.z = team === 'red' ? 7 : -7;
        const before = bot.position.clone();
        bot.update(1 / 60, null);
        assert.deepEqual(bot.position, before);
    }
});

test('ordinary team play retains its existing half-court limits', () => {
    for (const team of ['red', 'blue']) {
        const bot = fixture({ team });
        bot.moveSpeed = 0;
        bot.position.z = team === 'red' ? 7 : -7;
        bot.update(1 / 60, null);
        assert.equal(bot.position.z, team === 'red' ? -1 : 1);
    }
});

test('dead bots do not continue walking under their hidden model', () => {
    const bot = fixture();
    bot.alive = false;
    const before = bot.position.clone();
    bot.update(1 / 30, null);
    assert.deepEqual(bot.position, before);
});

test('chill applies the same 20% movement slow as the player, without stacking over time', () => {
    const normal = fixture();
    const chilled = fixture();
    chilled._chillTimer = 2;
    normal._hazardMoveMul = chilled._hazardMoveMul = 0.5;
    for (let i = 0; i < 60; i++) {
        normal.update(1 / 60, null);
        chilled.update(1 / 60, null);
    }
    assert.ok(Math.abs((chilled.position.x + 3) / (normal.position.x + 3) - 0.8) < 1e-9);
    assert.equal(chilled.moveSpeed, 5);
});

test('invalid hazard multipliers cannot corrupt bot positions', () => {
    for (const multiplier of [NaN, Infinity, -1, 0, undefined]) {
        const bot = fixture();
        bot._hazardMoveMul = multiplier;
        bot.update(1 / 60, null);
        assert.ok(Math.abs(bot.position.x - (-3 + 5 * 0.3 / 60)) < 1e-9);
    }
});

for (const fps of [30, 60, 144]) {
    test(`bot goes around a pillar rather than through it at ${fps} FPS`, () => {
        const pillar = { pos: new Vector3(0, 1, -6), radius: 1 };
        const bot = fixture({ collidables: [pillar] });
        let previous = bot.position.clone();
        for (let i = 0; i < fps * 6; i++) {
            bot.update(1 / fps, null);
            assert.ok(Math.hypot(bot.position.x, bot.position.z + 6) >= 1.5 - 1e-8, 'solid prop overlap');
            assert.ok(bot.position.distanceTo(previous) <= 1.5 / fps + 1e-8, 'detour added movement speed');
            previous.copy(bot.position);
        }
        assert.ok(bot.position.x > 1.5, `bot stalled at ${bot.position.toArray()}`);
    });

    test(`bot slides around a box wall at ${fps} FPS`, () => {
        const wall = { minX: -0.2, maxX: 0.2, minY: 0, maxY: 3, minZ: -7, maxZ: -5 };
        const bot = fixture({ collidables: [wall] });
        for (let i = 0; i < fps * 6; i++) {
            bot.update(1 / fps, null);
            assert.ok(!(Math.abs(bot.position.x) < 0.7 - 1e-8
                && bot.position.z > -7.5 + 1e-8 && bot.position.z < -4.5 - 1e-8), 'solid wall overlap');
        }
        assert.ok(bot.position.x > 1, `bot stalled at ${bot.position.toArray()}`);
    });
}

test('broken props and overhead geometry do not create invisible ground barriers', () => {
    const bot = fixture({ collidables: [
        { pos: new Vector3(0, 1, -6), radius: 1, broken: true },
        { minX: -1, maxX: 1, minY: 4, maxY: 5, minZ: -7, maxZ: -5 }
    ] });
    for (let i = 0; i < 240; i++) bot.update(1 / 60, null);
    assert.ok(Math.abs(bot.position.x - 3) < 1e-9);
    assert.equal(bot.position.z, -6);
});

test('a committed deflect does not detour or gain extra movement near cover', () => {
    const bot = fixture({ collidables: [{ pos: new Vector3(0, 1, -6), radius: 1 }] });
    bot._defenseIntent = 'deflect';
    const ball = { active: true, targetPlayer: bot, position: new Vector3(-3, 1.2, -4), velocity: new Vector3(0, 0, -17) };
    const before = bot.position.clone();
    for (let i = 0; i < 60; i++) bot.update(1 / 60, ball);
    assert.deepEqual(bot.position, before);
});

test('removing a bot releases its owned name, avatar and HP sprite resources exactly once', () => {
    const bot = fixture();
    const calls = [];
    for (const name of ['nameSprite', 'avatarSprite', 'hpBar']) {
        bot[name] = { material: { map: { dispose: () => calls.push(`${name}:texture`) }, dispose: () => calls.push(`${name}:material`) } };
    }
    bot.scene = { remove() {} };
    bot.remove();
    bot.remove();
    assert.equal(calls.length, 6);
    assert.equal(new Set(calls).size, 6);
});

test('an overlapping spawn recovers to free space without leaving the arena', () => {
    for (const prop of [
        { pos: new Vector3(18, 1, -6), radius: 1 },
        { minX: 16, maxX: 19, minY: 0, maxY: 3, minZ: -8, maxZ: -4 }
    ]) {
        const bot = fixture({ collidables: [prop] });
        bot.position.set(18, 0, -6);
        bot.moveSpeed = 0;
        bot.update(1 / 60, null);
        assert.ok(bot._canStandAt(bot.position.x, bot.position.z), `overlap recovery failed: ${bot.position.toArray()}`);
        assert.ok(bot.position.x <= 18.5 && bot.position.x >= -18.5);
    }
});

test('a fast frame cannot tunnel through a thin wall, even with both endpoints outside it', () => {
    const wall = { minX: -0.02, maxX: 0.02, minY: 0, maxY: 3, minZ: -18, maxZ: -1 };
    const bot = fixture({ collidables: [wall] });
    bot.position.set(-1, 0, -6);
    bot.moveSpeed = 100;
    bot.update(0.1, null);
    assert.ok(bot.position.x < -0.5, `crossed thin wall: ${bot.position.toArray()}`);
});

test('invalid frame deltas cannot move a live bot or spend a skill', () => {
    for (const delta of [NaN, Infinity, -0.1, 0]) {
        const bot = fixture();
        const before = bot.position.clone();
        bot.update(delta, null);
        assert.deepEqual(bot.position, before);
    }
});
