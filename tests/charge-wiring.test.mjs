// Wires ball.js's chargeProfile/ballHeatLevel (pure, already unit-tested in
// ball-charge-shot.test.mjs) into game.js's actual deflect loop. This file
// tests the game.js consume methods (_updateCharge/_cancelCharge/_releaseCharge/
// _seededSpreadAngle/_applyChargeSpread/_lerpHex/_applyRallyHeat) in isolation
// via the compileGameMethod extraction harness — see tests/game-source.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileGameMethod } from './game-source.mjs';

// ball.js imports THREE + ObjectPool at module scope, which don't exist under
// node --test. Same stub-and-reimport trick as tests/ball-charge-shot.test.mjs.
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableBallSource = ballSource
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(testableBallSource).toString('base64')}`);
const { chargeProfile, ballHeatLevel, BALL_HEAT_TIERS, CHARGE_FULL_SECONDS, CHARGE_OVERCHARGE_SECONDS } = ballModule;

const updateCharge = compileGameMethod('_updateCharge', { chargeProfile, CHARGE_OVERCHARGE_SECONDS, BALL_HEAT_TIERS });
const cancelCharge = compileGameMethod('_cancelCharge', {});
const releaseCharge = compileGameMethod('_releaseCharge', { chargeProfile });
const seededSpreadAngle = compileGameMethod('_seededSpreadAngle', {});
const applyChargeSpread = compileGameMethod('_applyChargeSpread', {});
const lerpHex = compileGameMethod('_lerpHex', {});
const applyRallyHeat = compileGameMethod('_applyRallyHeat', { ballHeatLevel });

// Builds a minimal mock Game with the real extracted methods attached, plus
// just enough player/ball state for _updateCharge's eligibility check
// (alive, PLAYING, ball active, held, in range) to pass by default.
function makeGame(overrides = {}) {
    const game = {
        _updateCharge: updateCharge,
        _cancelCharge: cancelCharge,
        _releaseCharge: releaseCharge,
        _seededSpreadAngle: seededSpreadAngle,
        _applyChargeSpread: applyChargeSpread,
        _lerpHex: lerpHex,
        _applyRallyHeat: applyRallyHeat,
        state: 'PLAYING',
        rallyCount: 0,
        _charging: false,
        _chargeHeldSeconds: 0,
        _preChargeGlow: null,
        chargeRatio: 0,
        heatTier: 'cool',
        heatColor: BALL_HEAT_TIERS[0].color,
        heatProgress: 0,
        heatIntensity: 0,
        player: {
            alive: true,
            _deflectHeld: true,
            _chargeMoveScale: 1,
            position: { x: 0, y: 0, z: 0 }
        },
        ball: {
            active: true,
            state: 'rally',
            heldPlayer: null,
            skinConfig: { glow: 0xff8844 },
            _affixGlowColor: null,
            _affixTrailColor: null,
            isInAttackRange: () => true
        }
    };
    return Object.assign(game, overrides);
}

// ---------------------------------------------------------------------------
// _updateCharge — accumulation, power/spread/movementScale application
// ---------------------------------------------------------------------------

test('_updateCharge accumulates heldSeconds and applies chargeProfile.movementScale to the player', () => {
    const game = makeGame();
    game._updateCharge(0.3);
    const expected1 = chargeProfile(0.3);
    assert.equal(game._charging, true);
    assert.equal(game._chargeHeldSeconds, 0.3);
    assert.equal(game.chargeRatio, expected1.ratio);
    assert.equal(game.player._chargeMoveScale, expected1.movementScale);

    game._updateCharge(0.3);
    const expected2 = chargeProfile(0.6);
    assert.equal(game._chargeHeldSeconds, 0.6);
    assert.equal(game.player._chargeMoveScale, expected2.movementScale);
    assert.ok(expected2.movementScale <= expected1.movementScale, 'movement scale decreases monotonically as charge builds');
});

test('_updateCharge clamps accumulated hold time at CHARGE_OVERCHARGE_SECONDS', () => {
    const game = makeGame();
    game._updateCharge(5); // way past the overcharge cap in one tick
    assert.equal(game._chargeHeldSeconds, CHARGE_OVERCHARGE_SECONDS);
});

test('_updateCharge drives ball._affixGlowColor toward the acid-yellow tier color as charge ratio grows', () => {
    const game = makeGame();
    game._updateCharge(CHARGE_FULL_SECONDS); // ratio === 1 exactly
    assert.equal(game.ball._affixGlowColor, BALL_HEAT_TIERS[1].color, 'full charge glow reaches the acid-yellow target exactly');
});

test('_updateCharge does nothing on a plain instant tap (no accumulated ineligibility state to reset)', () => {
    const game = makeGame({ player: { alive: true, _deflectHeld: false, _chargeMoveScale: 1, position: { x: 0, y: 0, z: 0 } } });
    game._updateCharge(0.016);
    assert.equal(game._charging, false);
    assert.equal(game._chargeHeldSeconds, 0);
    assert.equal(game.player._chargeMoveScale, 1);
});

// ---------------------------------------------------------------------------
// Charge cancel — death / round end / button release / ball leaving range
// ---------------------------------------------------------------------------

test('_updateCharge cancels an in-progress charge when the deflect button is released', () => {
    const game = makeGame();
    game._updateCharge(0.3);
    assert.equal(game._charging, true);
    game.player._deflectHeld = false;
    game._updateCharge(0.1);
    assert.equal(game._charging, false);
    assert.equal(game._chargeHeldSeconds, 0);
    assert.equal(game.chargeRatio, 0);
    assert.equal(game.player._chargeMoveScale, 1, 'movement speed restored on cancel');
    assert.equal(game.ball._affixGlowColor, null, 'glow restored to its pre-charge value');
});

test('_updateCharge cancels an in-progress charge when the player dies mid-hold', () => {
    const game = makeGame();
    game._updateCharge(0.3);
    game.player.alive = false;
    game._updateCharge(0.1);
    assert.equal(game._charging, false);
    assert.equal(game.player._chargeMoveScale, 1);
});

test('_updateCharge cancels an in-progress charge when the state leaves PLAYING (round end)', () => {
    const game = makeGame();
    game._updateCharge(0.3);
    game.state = 'ROUND_END';
    game._updateCharge(0.1);
    assert.equal(game._charging, false);
    assert.equal(game._chargeHeldSeconds, 0);
    assert.equal(game.player._chargeMoveScale, 1);
});

test('_updateCharge cancels an in-progress charge when the ball leaves range and is not orbiting', () => {
    const game = makeGame();
    game._updateCharge(0.3);
    game.ball.isInAttackRange = () => false;
    game._updateCharge(0.1);
    assert.equal(game._charging, false);
});

test('_updateCharge restores a pre-existing affix glow color instead of nulling it', () => {
    const game = makeGame();
    game.ball._affixGlowColor = 0xff2200; // e.g. a fire-ball affix tell already active
    game._updateCharge(0.2);
    assert.notEqual(game.ball._affixGlowColor, 0xff2200, 'glow ramps toward acid yellow while charging');
    game.player._deflectHeld = false;
    game._updateCharge(0.1);
    assert.equal(game.ball._affixGlowColor, 0xff2200, 'affix glow restored, not left null, after cancel');
});

// ---------------------------------------------------------------------------
// Eligibility — in range OR orbiting, gated to this player
// ---------------------------------------------------------------------------

test('_updateCharge accumulates while the ball orbits this player, even outside attack range', () => {
    const game = makeGame();
    game.ball.isInAttackRange = () => false;
    game.ball.state = 'orbiting';
    game.ball.heldPlayer = game.player;
    game._updateCharge(0.2);
    assert.equal(game._charging, true);
    assert.equal(game._chargeHeldSeconds, 0.2);
});

test('_updateCharge does not charge when the ball orbits a different player', () => {
    const game = makeGame();
    game.ball.isInAttackRange = () => false;
    game.ball.state = 'orbiting';
    game.ball.heldPlayer = { name: 'someone-else' };
    game._updateCharge(0.2);
    assert.equal(game._charging, false);
    assert.equal(game._chargeHeldSeconds, 0);
});

// ---------------------------------------------------------------------------
// _releaseCharge — consumption at the moment of an actual deflect
// ---------------------------------------------------------------------------

test('_releaseCharge returns the exact chargeProfile snapshot for the held duration and resets state', () => {
    const game = makeGame();
    game._updateCharge(0.45);
    const result = game._releaseCharge();
    assert.deepEqual(result, chargeProfile(0.45));
    assert.equal(game._charging, false);
    assert.equal(game._chargeHeldSeconds, 0);
    assert.equal(game.player._chargeMoveScale, 1);
});

test('_releaseCharge returns null when no charge was active (plain instant tap)', () => {
    const game = makeGame();
    assert.equal(game._releaseCharge(), null);
});

// ---------------------------------------------------------------------------
// Deterministic spread — seeded by rallyCount, never Math.random
// ---------------------------------------------------------------------------

test('_seededSpreadAngle is deterministic for a given rallyCount and bounded by spread', () => {
    const game = makeGame();
    game.rallyCount = 3;
    const a1 = game._seededSpreadAngle(0.1);
    const a2 = game._seededSpreadAngle(0.1);
    assert.equal(a1, a2, 'identical rallyCount produces an identical spread angle');
    assert.ok(Math.abs(a1) <= 0.1 + 1e-9, 'angle stays within [-spread, spread]');

    game.rallyCount = 7;
    const a3 = game._seededSpreadAngle(0.1);
    assert.notEqual(a3, a1, 'a different rallyCount seeds a different angle');
});

test('_seededSpreadAngle returns exactly 0 for zero spread', () => {
    const game = makeGame();
    game.rallyCount = 5;
    assert.equal(game._seededSpreadAngle(0), 0);
});

test('_applyChargeSpread rotates dir.{x,z} around Y by exactly the seeded angle and leaves y untouched', () => {
    const game = makeGame();
    game.rallyCount = 4;
    const angle = game._seededSpreadAngle(0.15);
    const dir = { x: 0.2, y: 0.05, z: -0.9 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const expectedX = dir.x * cos - dir.z * sin;
    const expectedZ = dir.x * sin + dir.z * cos;
    game._applyChargeSpread(dir, 0.15);
    assert.ok(Math.abs(dir.x - expectedX) < 1e-12);
    assert.ok(Math.abs(dir.z - expectedZ) < 1e-12);
    assert.equal(dir.y, 0.05, 'spread only rotates the horizontal aim plane');
});

test('_applyChargeSpread is a no-op for zero spread', () => {
    const game = makeGame();
    const dir = { x: 0, y: 0, z: -1 };
    game._applyChargeSpread(dir, 0);
    assert.deepEqual(dir, { x: 0, y: 0, z: -1 });
});

// ---------------------------------------------------------------------------
// _lerpHex — pure color-channel interpolation used for the charge glow ramp
// ---------------------------------------------------------------------------

test('_lerpHex interpolates RGB channels and clamps t to [0, 1]', () => {
    const game = makeGame();
    assert.equal(game._lerpHex(0x000000, 0xffffff, 0), 0x000000);
    assert.equal(game._lerpHex(0x000000, 0xffffff, 1), 0xffffff);
    assert.equal(game._lerpHex(0x000000, 0xffffff, 2), 0xffffff, 't > 1 clamps to 1');
    assert.equal(game._lerpHex(0x000000, 0xffffff, -1), 0x000000, 't < 0 clamps to 0');
    assert.equal(game._lerpHex(0x000000, 0xff0000, 0.5), 0x800000, 'half red at 50%');
});

// ---------------------------------------------------------------------------
// _applyRallyHeat — rallyCount -> ballHeatLevel tier exposure + trail color
// ---------------------------------------------------------------------------

test('_applyRallyHeat feeds rallyCount into ballHeatLevel with baseSpeed=1 and exposes results on the game object', () => {
    const game = makeGame();
    for (const rally of [0, 1, 2, 3, 4, 5, 9]) {
        game.rallyCount = rally;
        const heat = game._applyRallyHeat();
        const direct = ballHeatLevel(rally, 1);
        assert.deepEqual(heat, direct);
        assert.equal(game.heatTier, direct.tier);
        assert.equal(game.heatColor, direct.color);
        assert.equal(game.heatProgress, direct.progress);
        assert.equal(game.heatIntensity, direct.intensity);
        assert.equal(game.ball._affixTrailColor, direct.color, 'rally heat color applied to the ball trail channel');
    }
});

test('_applyRallyHeat climbs tiers as rallyCount grows: cool -> warm -> hot -> blazing -> overdrive', () => {
    const game = makeGame();
    const tiers = [0, 1, 2, 3, 4, 5].map(rally => {
        game.rallyCount = rally;
        return game._applyRallyHeat().tier;
    });
    assert.deepEqual(tiers, ['cool', 'cool', 'warm', 'hot', 'blazing', 'overdrive']);
});

test('_applyRallyHeat caps at the overdrive tier for very long rallies', () => {
    const game = makeGame();
    game.rallyCount = 50;
    const heat = game._applyRallyHeat();
    assert.equal(heat.tier, 'overdrive');
    assert.equal(heat.progress, 1);
});
