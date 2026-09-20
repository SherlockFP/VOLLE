import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tickSkillCooldowns, useSkill } from '../js/skills.js';

// Execute the shipped Bot methods without constructing its WebGL/DOM presentation.
const source = readFileSync(new URL('../js/bot.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export /gm, '');

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

function fixture() {
    const rng = Object.create(Math);
    rng.random = () => 0;
    const Bot = runInNewContext(`${source}\nBot`, {
        THREE: { Vector3 }, Math: rng, tickSkillCooldowns, useSkill
    });
    const bot = Object.assign(Object.create(Bot.prototype), {
        alive: true, hp: 100, maxHp: 100, shield: 0,
        loadout: { skill: 'slow', runes: [] }, skillCooldowns: {}, runeBonuses: {},
        skillChance: 0.45, moveSpeed: 0, team: 'red',
        position: new Vector3(0, 0, -5), velocity: new Vector3(),
        group: { position: new Vector3(), rotation: {}, scale: { setScalar() {} } },
        arena: {
            bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
            getPlayerSpawn: () => new Vector3(0, 0, -5)
        },
        spawnAnim: 1, attackTimer: 0, strafeTimer: 1, strafeDir: 1,
        _gameRef: {}, _defenseIntent: 'deflect', _defenseDodgeLatch: 0,
        _tendencyDepthBias: 0, _tendencyApproachMul: 1, _tendencyLateralMul: 1,
        drawHpBar() {}, setTargetOutline() {}
    });
    for (const key of ['_toBall', '_ballDir', '_predOffset', '_interceptTarget',
        '_toIntercept', '_dodgeDir', '_perpDir']) bot[key] = new Vector3();
    const ball = {
        active: true, targetPlayer: bot, currentSpeed: 20,
        position: new Vector3(0, 1.2, -3), velocity: new Vector3(0, 0, -20)
    };
    return { bot, ball };
}

test('a fresh bot can use its equipped skill from an empty cooldown table', () => {
    const { bot, ball } = fixture();
    bot.update(1 / 60, ball);
    assert.equal(ball.currentSpeed, 10);
    assert.equal(ball.velocity.length(), 10);
    assert.equal(bot.skillCooldowns.slow, 35);
});

test('bot skill cannot repeat during cooldown and becomes available after expiry', () => {
    const { bot, ball } = fixture();
    bot.update(1 / 60, ball);
    for (let second = 0; second < 34; second++) bot.update(1, ball);
    assert.equal(ball.currentSpeed, 10);
    assert.equal(bot.skillCooldowns.slow, 1);
    bot.update(1, ball);
    assert.equal(ball.currentSpeed, 5);
    assert.equal(bot.skillCooldowns.slow, 35);
});

test('respawn clears cooldowns and preserves the next legitimate skill opportunity', () => {
    const { bot, ball } = fixture();
    bot.update(1 / 60, ball);
    bot.alive = false;
    bot.respawn();
    assert.equal(Object.keys(bot.skillCooldowns).length, 0);
    bot.update(1 / 60, ball);
    assert.equal(ball.currentSpeed, 5);
    assert.equal(bot.skillCooldowns.slow, 35);
});

test('dead, competitive, untargeted and inactive bots never spend a skill cooldown', () => {
    for (const mutate of [
        ({ bot }) => { bot.alive = false; },
        ({ bot }) => { bot._gameRef._skillsDisabled = true; },
        ({ ball }) => { ball.targetPlayer = {}; },
        ({ ball }) => { ball.active = false; }
    ]) {
        const current = fixture();
        mutate(current);
        current.bot.update(1 / 60, current.ball);
        assert.equal(current.ball.currentSpeed, 20);
        assert.equal(Object.keys(current.bot.skillCooldowns).length, 0);
    }
});
