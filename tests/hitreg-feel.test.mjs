// tests/hitreg-feel.test.mjs — Hitreg audit fixes + kill-confirm "hot ball" wiring.
// Covers the pure helpers added to js/combat.js (swept-hit step count, remoteAttack
// dedup window scaling, pending-lethal grace scaling, kill-confirm timer decay) and
// the actual js/game.js _grantKillConfirm/_updateKillConfirm/_consumeKillConfirm
// methods in isolation via the compileGameMethod extraction harness (same approach
// as tests/charge-wiring.test.mjs), so the bug fix (a single expired window used to
// wipe every player's window) is verified against the real shipped source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sweptHitStepCount,
    scaleDedupWindowMs,
    scaleLethalGraceMs,
    decayKillConfirmEntries
} from '../js/combat.js';
import { compileGameMethod } from './game-source.mjs';

// ---------------------------------------------------------------------------
// sweptHitStepCount — swept-hit decision (tunneling audit, item a)
// ---------------------------------------------------------------------------

test('sweptHitStepCount: no extra samples when the ball barely moved', () => {
    // Base-speed ball at 60fps travels ~0.28 units — far shorter than a normal
    // capsule radius, so a single endpoint check already covers the segment.
    assert.equal(sweptHitStepCount(0.28, 0.87), 0);
});

test('sweptHitStepCount: zero/negative distance or radius is always 0 steps', () => {
    assert.equal(sweptHitStepCount(0, 0.87), 0);
    assert.equal(sweptHitStepCount(-1, 0.87), 0);
    assert.equal(sweptHitStepCount(5, 0), 0);
});

test('sweptHitStepCount: scales up under a dt-spike-sized displacement', () => {
    // Max ball speed (102) at the 50ms dt clamp (main.js) = 5.1 units/frame —
    // the exact scenario the old speed*0.015 heuristic under-sampled.
    const steps = sweptHitStepCount(5.1, 0.87);
    assert.ok(steps >= 3, `expected several samples for a 5.1-unit jump, got ${steps}`);
});

test('sweptHitStepCount: never exceeds maxSteps regardless of distance', () => {
    assert.equal(sweptHitStepCount(500, 0.5, 6), 6);
});

test('sweptHitStepCount: guarantees every sample gap stays within 1.5x radius (below the maxSteps cap)', () => {
    for (const [distance, radius] of [[5.1, 0.87], [1.7, 0.67], [3.4, 1.2], [2.5, 0.5]]) {
        const steps = sweptHitStepCount(distance, radius);
        const gap = distance / (steps + 1);
        assert.ok(gap <= radius * 1.5 + 1e-9,
            `distance=${distance} radius=${radius} steps=${steps} gap=${gap} exceeds 1.5x radius`);
    }
});

// ---------------------------------------------------------------------------
// scaleDedupWindowMs — remoteAttack dedup window scaling (audit item b)
// ---------------------------------------------------------------------------

test('scaleDedupWindowMs: unchanged at or below base ball speed', () => {
    assert.equal(scaleDedupWindowMs(90, 17, 17), 90);
    assert.equal(scaleDedupWindowMs(90, 10, 17), 90);
});

test('scaleDedupWindowMs: shrinks proportionally above base speed', () => {
    // 2x base speed -> half the window.
    assert.equal(scaleDedupWindowMs(90, 34, 17), 45);
});

test('scaleDedupWindowMs: floors so literal duplicate packets are still caught', () => {
    // Max rally speed (102 = 6x base) would scale to 15ms; floor keeps it at 30ms.
    assert.equal(scaleDedupWindowMs(90, 102, 17), 30);
});

// ---------------------------------------------------------------------------
// scaleLethalGraceMs — pending-lethal-hit grace window (audit item c)
// ---------------------------------------------------------------------------

test('scaleLethalGraceMs: unscaled for a local/bot victim with no known ping', () => {
    assert.equal(scaleLethalGraceMs(80, undefined), 80);
    assert.equal(scaleLethalGraceMs(80, 0), 80);
});

test('scaleLethalGraceMs: grows with the victim\'s ping, capped', () => {
    assert.equal(scaleLethalGraceMs(80, 100), 130); // +50ms
    assert.equal(scaleLethalGraceMs(80, 1000), 200); // capped at +120ms
});

// ---------------------------------------------------------------------------
// decayKillConfirmEntries — hot-ball timer decay (item 3)
// ---------------------------------------------------------------------------

test('decayKillConfirmEntries: only reports the entry that actually expired', () => {
    const map = new Map([
        ['Alice', { duration: 0.2 }],
        ['Bob', { duration: 3.0 }]
    ]);
    const expired = decayKillConfirmEntries(map, 0.5);
    assert.deepEqual(expired, ['Alice']);
    // Bob's window must still be alive with its duration correctly decremented —
    // this is the exact bug that used to wipe every window on any one expiry.
    assert.ok(map.has('Bob'));
    assert.equal(map.get('Bob').duration, 2.5);
});

test('decayKillConfirmEntries: reports nothing when no entry has expired yet', () => {
    const map = new Map([['Alice', { duration: 3.5 }]]);
    assert.deepEqual(decayKillConfirmEntries(map, 1.0), []);
    assert.equal(map.get('Alice').duration, 2.5);
});

// ---------------------------------------------------------------------------
// Real game.js kill-confirm methods, extracted + run in isolation.
// ---------------------------------------------------------------------------

const grantKillConfirm = compileGameMethod('_grantKillConfirm', {
    KILL_CONFIRM_DURATION: 3.5,
    KILL_CONFIRM_DAMAGE_MULTIPLIER: 1.15,
    window: {}
});
const updateKillConfirm = compileGameMethod('_updateKillConfirm', { decayKillConfirmEntries });
const consumeKillConfirm = compileGameMethod('_consumeKillConfirm', {
    KILL_CONFIRM_DAMAGE_MULTIPLIER: 1.15,
    window: {}
});

function makeGame(overrides = {}) {
    return {
        _killConfirm: new Map(),
        _powerUpsDisabled: false,
        playerName: 'Sher',
        audio: { playCue: () => {} },
        _grantKillConfirm: grantKillConfirm,
        _updateKillConfirm: updateKillConfirm,
        _consumeKillConfirm: consumeKillConfirm,
        ...overrides
    };
}

test('_grantKillConfirm: opens a window with the real duration/multiplier constants', () => {
    const game = makeGame();
    assert.equal(game._grantKillConfirm('Bob'), true);
    const state = game._killConfirm.get('Bob');
    assert.equal(state.duration, 3.5);
    assert.equal(state.damageMultiplier, 1.15);
});

test('_grantKillConfirm: no-ops in competitive mode (ranked-safe gate)', () => {
    const game = makeGame({ _powerUpsDisabled: true });
    assert.equal(game._grantKillConfirm('Bob'), false);
    assert.equal(game._killConfirm.size, 0);
});

test('_updateKillConfirm: an unrelated player\'s window survives another player\'s expiry', () => {
    const game = makeGame();
    game._grantKillConfirm('Alice');
    game._grantKillConfirm('Bob');
    game._killConfirm.get('Alice').duration = 0.1; // about to expire
    game._updateKillConfirm(0.5); // Alice expires, Bob (3.5s) does not
    assert.equal(game._killConfirm.has('Alice'), false);
    assert.equal(game._killConfirm.has('Bob'), true);
});

test('_consumeKillConfirm: single-shot — returns the bonus once, then falls back to 1x', () => {
    const game = makeGame();
    game._grantKillConfirm('Bob');
    assert.equal(game._consumeKillConfirm('Bob'), 1.15);
    assert.equal(game._consumeKillConfirm('Bob'), 1.0);
});

test('_consumeKillConfirm: no bonus for a player with no active window', () => {
    const game = makeGame();
    assert.equal(game._consumeKillConfirm('Nobody'), 1.0);
});
