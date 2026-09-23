// hit-capsule-elevation.test.mjs — the body hit capsule rides with the body.
// Before: Game.capsuleHitTest anchored the capsule at world y=0..1.7 using only
// the target's x/z, so a jumping (apex 1.6 m) or parkour-perched (2.4 / 3.6 m)
// target could only die through the force-hit / orbit-rescue fallback.
// Now: capsule spans [feetY, feetY + 1.7*sizeScale]; feetY = 0 is bit-for-bit
// the old formula, so grounded hit timing/results are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';
import { compileGameMethod } from './game-source.mjs';
import {
    capsuleContact,
    targetFeetY,
    CAPSULE_GROUND_SNAP,
    sweptHitStepCount
} from '../js/combat.js';

const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

// Base-speed numbers, from js/ball.js: radius 0.47, hitRange 0.7,
// effectiveHitRange = hitRange + min(speed*0.003, 2) → hitBonus 0.051 @ 17 u/s.
const BALL_RADIUS = 0.47;
const CAPSULE_RADIUS = 0.4 + 17 * 0.003; // 0.451
const HEIGHT = 1.7;

// Verbatim copy of the pre-change Game.capsuleHitTest (floor-anchored capsule).
function oldCapsuleHitTest(ballPos, playerPos, playerHeight = 1.7, capsuleRadius = 0.4, ballRadius = BALL_RADIUS) {
    const px = playerPos.x, pz = playerPos.z;
    const py = Math.max(0, Math.min(playerHeight, ballPos.y));
    const dx = ballPos.x - px;
    const dz = ballPos.z - pz;
    const dy = ballPos.y - py;
    const distSq = dx * dx + dy * dy + dz * dz;
    const totalRadius = ballRadius + capsuleRadius;
    return distSq < totalRadius * totalRadius;
}

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hit = (feetY, offset, y) => capsuleContact({ x: offset, y, z: 0 }, 0, 0, feetY, HEIGHT, CAPSULE_RADIUS, BALL_RADIUS);

test('base-speed radii match the task numbers (0.451 + 0.47 = 0.921)', () => {
    assert.ok(Math.abs(CAPSULE_RADIUS - 0.451) < 1e-12);
    assert.ok(Math.abs(CAPSULE_RADIUS + BALL_RADIUS - 0.921) < 1e-12);
});

test('grounded (feetY 0): 1000 random samples identical to the old formula', () => {
    const rand = mulberry32(0xC4F5);
    const capsuleHitTest = compileGameMethod('capsuleHitTest', { capsuleContact });
    const game = { ball: { radius: BALL_RADIUS } };
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
        const ball = { x: (rand() - 0.5) * 3, y: -0.5 + rand() * 4, z: (rand() - 0.5) * 3 };
        const player = { x: (rand() - 0.5) * 0.6, y: 1.7, z: (rand() - 0.5) * 0.6 };
        const sizeScale = rand() < 0.2 ? 0.5 + rand() : 1;
        const capsuleRadius = (0.4 + rand() * 0.3) * sizeScale;
        const height = 1.7 * sizeScale;
        const expected = oldCapsuleHitTest(ball, player, height, capsuleRadius);
        if (expected) hits++;
        assert.equal(capsuleContact(ball, player.x, player.z, 0, height, capsuleRadius, BALL_RADIUS), expected, `sample ${i}`);
        assert.equal(capsuleHitTest.call(game, ball, player, height, capsuleRadius), expected, `default feetY, sample ${i}`);
        assert.equal(capsuleHitTest.call(game, ball, player, height, capsuleRadius, 0), expected, `feetY 0, sample ${i}`);
    }
    assert.ok(hits > 100 && hits < 900, `sample mix covers hits and misses (${hits})`);
});

test('perched / airborne matrix at base speed', () => {
    const player = { x: 0, z: 0 };
    // 2.4 m parkour ledge.
    assert.equal(hit(2.4, 0.5, 3.25), true);
    assert.equal(oldCapsuleHitTest({ x: 0.5, y: 3.25, z: 0 }, player, HEIGHT, CAPSULE_RADIUS), false, 'old: miss (counterexample)');
    assert.equal(hit(2.4, 0.5, 1.0), false, 'ball under the ledge passes beneath the feet');
    // Jump apex 1.6 m.
    assert.equal(hit(1.6, 0, 2.85), true);
    assert.equal(hit(1.6, 0, 0.5), false);
    assert.equal(oldCapsuleHitTest({ x: 0, y: 2.85, z: 0 }, player, HEIGHT, CAPSULE_RADIUS), false);
    assert.equal(oldCapsuleHitTest({ x: 0, y: 0.5, z: 0 }, player, HEIGHT, CAPSULE_RADIUS), true, 'old hit the empty floor under a jumper');
    // 3.6 m perch.
    assert.equal(hit(3.6, 0, 4.5), true);
    assert.equal(oldCapsuleHitTest({ x: 0, y: 4.5, z: 0 }, player, HEIGHT, CAPSULE_RADIUS), false);
    // Rim of the capsule: head cap and foot cap follow feetY exactly.
    assert.equal(hit(2.4, 0, 2.4 + HEIGHT + 0.92), true);
    assert.equal(hit(2.4, 0, 2.4 + HEIGHT + 0.93), false);
    assert.equal(hit(2.4, 0, 2.4 - 0.92), true);
    assert.equal(hit(2.4, 0, 2.4 - 0.93), false);
});

test('targetFeetY: getFeetY when present, 0 otherwise, ground noise snaps to 0', () => {
    assert.equal(targetFeetY(null), 0);
    assert.equal(targetFeetY({}), 0);
    assert.equal(targetFeetY({ getFeetY: () => 2.4 }), 2.4);
    assert.equal(targetFeetY({ getFeetY: () => 0 }), 0);
    // POS_SCALE 64 quantizes grounded eye y 1.7 to 1.703125 → raw feet 0.003125.
    assert.equal(targetFeetY({ getFeetY: () => Math.round(1.7 * 64) / 64 - 1.7 }), 0);
    assert.equal(targetFeetY({ getFeetY: () => CAPSULE_GROUND_SNAP }), 0);
    assert.equal(targetFeetY({ getFeetY: () => -0.8 }), 0, 'below-floor (swimming) keeps old capsule');
    assert.equal(targetFeetY({ getFeetY: () => NaN }), 0);
    assert.equal(targetFeetY({ getFeetY: () => 0.3 }), 0.3);
});

test('Player / Bot / remote proxy getFeetY', async () => {
    const { Player } = await import('../js/player.js');
    const { Bot } = await import('../js/bot.js');
    // Player.position is eye height (feet + this.height).
    const player = { position: { y: 1.7 }, height: 1.7 };
    assert.equal(Player.prototype.getFeetY.call(player), 0, 'grounded local player is exactly 0');
    player.position.y = 2.4 + 1.7;
    assert.ok(Math.abs(Player.prototype.getFeetY.call(player) - 2.4) < 1e-12);
    // Bot.position is feet-based.
    assert.equal(Bot.prototype.getFeetY.call({ position: { y: 0 } }), 0);
    assert.equal(Bot.prototype.getFeetY.call({ position: { y: 3.6 } }), 3.6);
    // Remote proxy: synced y is the sender's Player.position.y (eye); bot dummies carry feet.
    const match = /getFeetY\(\) \{ (return [^}]+) \},/.exec(gameSource);
    assert.ok(match, 'remote proxy defines getFeetY');
    const remoteFeet = new Function(match[1]);
    assert.ok(Math.abs(remoteFeet.call({ position: { y: 4.1 }, isBotEntity: false }) - 2.4) < 1e-12);
    assert.equal(remoteFeet.call({ position: { y: 1.7 }, isBotEntity: false }), 0);
    assert.equal(remoteFeet.call({ position: { y: 0 }, isBotEntity: true }), 0);
    assert.equal(targetFeetY({ getFeetY() { return remoteFeet.call({ position: { y: 1.703125 } }); } }), 0);
});

test('all four capsule call sites pass the target feet height', () => {
    const calls = gameSource.match(/this\.capsuleHitTest\([^\n]*?\)\)|this\.capsuleHitTest\(\s*this\.ball\.position,[\s\S]*?\);/g) || [];
    assert.equal(calls.length, 4, 'four capsuleHitTest call sites');
    for (const call of calls) assert.match(call, /capsuleRadius,\s*feetY\s*\)/, call);
    const feetDefs = gameSource.match(/const feetY = targetFeetY\(target\);/g) || [];
    assert.equal(feetDefs.length, 2, 'feetY resolved once per target in both hit loops');
    // Force-hit / orbit-rescue fallback stays eye-anchored and untouched.
    assert.match(gameSource, /if \(this\.ball\._forceHit\) \{\s*const px = headPos\.x, pz = headPos\.z;\s*const py = headPos\.y;/);
    // Height and radius formulas unchanged.
    assert.equal((gameSource.match(/const capsuleRadius = \(0\.4 \+ hitBonus\) \* sizeScale;/g) || []).length, 2);
});

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
    lerpVectors(a, b, t) {
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        return this;
    }
}

function settlementFixture(target, speed) {
    const updateIncomingSettlement = compileGameMethod('updateIncomingSettlement', {
        THREE: { Vector3 },
        sweptHitStepCount,
        targetFeetY
    });
    const capsuleHitTest = compileGameMethod('capsuleHitTest', { capsuleContact });
    const hits = [];
    const ball = {
        active: true,
        targetPlayer: target,
        // 177 u/s * 1/60 s = 2.95 u: x 1.5 → -1.45, both beyond the 1.401 contact
        // radius (0.47 + 0.4 + 177*0.003), so only swept samples can see the torso.
        position: new Vector3(1.5, 3.25, 0),
        currentSpeed: speed,
        radius: BALL_RADIUS,
        hitRange: 0.7,
        effectiveHitRange: 0.7 + Math.min(speed * 0.003, 2),
        _noHitTimer: 0,
        _forceHit: false,
        update(dt) {
            this._prevPosition = this.position.clone();
            this.position.x -= this.currentSpeed * dt;
        }
    };
    const game = {
        network: { connected: false, isHost: false },
        ball,
        _incomingSettlementTimer: 1,
        hasPendingIncomingSettlement: () => true,
        capsuleHitTest,
        handleHit: t => hits.push(t)
    };
    return { run: dt => updateIncomingSettlement.call(game, dt), hits, ball };
}

test('177 u/s one-frame segment through a perched torso hits via swept samples', () => {
    // Perched player: feet 2.4, eye 4.1. Ball crosses the torso at y 3.25.
    const perched = { alive: true, _sizeScale: 1, getPosition: () => new Vector3(0, 4.1, 0), getFeetY: () => 2.4 };
    const { run, hits, ball } = settlementFixture(perched, 177);
    run(1 / 60);
    const total = BALL_RADIUS + 0.4 + 177 * 0.003;
    assert.ok(Math.abs(ball._prevPosition.x) > total && Math.abs(ball.position.x) > total, 'both endpoints outside the capsule');
    assert.ok(sweptHitStepCount(ball._prevPosition.distanceTo(ball.position), total) > 0);
    assert.deepEqual(hits, [perched]);

    // Same shot vs the old floor-anchored capsule (no getFeetY) → passes through.
    const legacy = { alive: true, _sizeScale: 1, getPosition: () => new Vector3(0, 4.1, 0) };
    const old = settlementFixture(legacy, 177);
    old.run(1 / 60);
    assert.deepEqual(old.hits, []);
});
