import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the shipped Bot implementation, not a second copy of its movement AI.
const source = readFileSync(new URL('../js/bot.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
    multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
    add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
    negate() { return this.multiplyScalar(-1); }
}
const rng = Object.create(Math);
rng.random = () => 0.5;
const Bot = runInNewContext(`${source}\nBot`, {
    THREE: { Vector3 }, Math: rng, tickSkillCooldowns() {}, useSkill() {},
});
function fixture(collidables = []) {
    const bot = Object.assign(Object.create(Bot.prototype), {
        alive: true, hp: 100, maxHp: 100, shield: 0, radius: 0.5,
        loadout: { skill: 'slow' }, skillCooldowns: {}, runeBonuses: {},
        skillChance: 0, moveSpeed: 5.5, team: 'red',
        position: new Vector3(-3, 0, -6), velocity: new Vector3(),
        group: { position: new Vector3(), rotation: {}, scale: { setScalar() {} } },
        arena: { bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, collidables },
        spawnAnim: 1, attackTimer: 0, strafeTimer: 100, strafeDir: 1,
        _gameRef: {}, _defenseIntent: 'none', _defenseDodgeLatch: 0,
        _tendencyDepthBias: 0, _tendencyApproachMul: 1, _tendencyLateralMul: 1,
        drawHpBar() {}, setTargetOutline() {},
    });
    for (const key of ['_toBall', '_ballDir', '_predOffset', '_interceptTarget',
        '_toIntercept', '_dodgeDir', '_perpDir']) bot[key] = new Vector3();
    return bot;
}

test('a living bot goes around a ground prop instead of walking through it', () => {
    for (const hz of [30, 60, 144]) {
        const bot = fixture([{ pos: { x: 0, y: 0.8, z: -6 }, radius: 1 }]);
        let travelled = 0;
        for (let frame = 0; frame < hz * 6; frame++) {
            const { x, z } = bot.position;
            bot.update(1 / hz, null);
            const step = Math.hypot(bot.position.x - x, bot.position.z - z);
            assert.ok(step <= 5.5 * 0.3 / hz + 1e-8, 'avoidance cannot add a speed boost');
            assert.ok(Math.hypot(bot.position.x, bot.position.z + 6) >= 1.5 - 1e-4,
                `prop penetration at ${hz}Hz, frame ${frame}`);
            travelled += step;
        }
        assert.ok(bot.position.x > 2, `bot got stuck at ${hz}Hz`);
        assert.ok(travelled <= 9.9 + 1e-7);
    }
});

test('box cover blocks crossing and allows a stable sidestep without tunnelling', () => {
    const box = { minX: -0.1, maxX: 0.1, minY: 0, maxY: 3, minZ: -8, maxZ: -4 };
    const bot = fixture([box]);
    for (let i = 0; i < 600; i++) {
        bot.update(1 / 60, null);
        const p = bot.position;
        assert.ok(!(p.x > -0.6 + 1e-4 && p.x < 0.6 - 1e-4 && p.z > -8.5 + 1e-4 && p.z < -3.5 - 1e-4));
    }
    assert.ok(bot.position.x > 1, 'head-on cover approach must eventually clear the cover');
    const stalledFrame = fixture([box]);
    stalledFrame.update(4, null);
    assert.ok(stalledFrame.position.x <= -0.6 || Math.abs(stalledFrame.position.z + 6) >= 2.5,
        'large frame may not jump through thin cover');
});

test('overhead and broken props do not obstruct ground footwork', () => {
    for (const collider of [
        { pos: { x: 0, y: 8, z: -6 }, radius: 1 },
        { pos: { x: 0, y: 0.8, z: -6 }, radius: 1, broken: true },
        { minX: -1, maxX: 1, minY: 5, maxY: 8, minZ: -8, maxZ: -4 },
    ]) {
        const bot = fixture([collider]);
        for (let i = 0; i < 240; i++) bot.update(1 / 60, null);
        assert.ok(Math.abs(bot.position.z + 6) < 1e-9);
        assert.ok(Math.abs(bot.position.x - 3.6) < 1e-8);
    }
});

test('FFA bots can cross the former team half while team matches retain their side', () => {
    for (const freeForAll of [false, true]) {
        const bot = fixture();
        bot.position.z = 6;
        bot._gameRef._ffa = freeForAll;
        bot.update(1 / 60, null);
        assert.equal(bot.position.z, freeForAll ? 6 : -1);
    }
});

test('dead bots do not wander and a committed defender keeps its feet planted', () => {
    const dead = fixture();
    dead.alive = false;
    dead.update(0.2, null);
    assert.equal(dead.position.x, -3);
    const bot = fixture([{ pos: { x: 0, y: 0.8, z: -6 }, radius: 1 }]);
    bot._defenseIntent = 'deflect';
    const ball = { active: true, targetPlayer: bot, currentSpeed: 17,
        position: new Vector3(-3, 1.2, -3), velocity: new Vector3(0, 0, -17) };
    bot.update(1 / 60, ball);
    assert.equal(bot.position.x, -3);
    assert.equal(bot.position.z, -6);
});

test('clear-ground movement remains unchanged and invalid dt cannot poison a bot', () => {
    const bot = fixture();
    bot.update(0.05, null);
    assert.ok(Math.abs(bot.position.x - (-3 + 5.5 * 0.3 * 0.05)) < 1e-12);
    const x = bot.position.x;
    for (const dt of [NaN, Infinity, -1, 0]) bot.update(dt, null);
    assert.equal(bot.position.x, x);
});
