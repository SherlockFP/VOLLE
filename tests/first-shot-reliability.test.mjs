import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const playerHelpersStart = playerSource.indexOf('export const GROUND_ACCEL');
const playerHelpersEnd = playerSource.indexOf('export class Player');
assert.ok(playerHelpersStart >= 0 && playerHelpersEnd > playerHelpersStart);
const playerHelpers = await import(`data:text/javascript,${encodeURIComponent(playerSource.slice(playerHelpersStart, playerHelpersEnd))}`);

const botSource = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
const holdHelperStart = botSource.indexOf('export function shouldHoldDeflectPosition');
const holdHelperEnd = botSource.indexOf('export class Bot');
assert.ok(holdHelperStart >= 0 && holdHelperEnd > holdHelperStart);
const botHelpers = await import(`data:text/javascript,${encodeURIComponent(botSource.slice(holdHelperStart, holdHelperEnd))}`);

test('primary attack is available during countdown only for an explicit warm-up ball', () => {
    const { canStartPrimaryAttack } = playerHelpers;
    assert.equal(canStartPrimaryAttack('COUNTDOWN', { _warmup: true }), true);
    assert.equal(canStartPrimaryAttack('COUNTDOWN', { _warmup: false }), false);
    assert.equal(canStartPrimaryAttack('COUNTDOWN', null), false);
    assert.equal(canStartPrimaryAttack('LOBBY', { _warmup: true }), false);
});

test('primary attack stays available in live play and celebration', () => {
    const { canStartPrimaryAttack } = playerHelpers;
    assert.equal(canStartPrimaryAttack('PLAYING', null), true);
    assert.equal(canStartPrimaryAttack('CELEBRATION', null), true);
    assert.equal(canStartPrimaryAttack('ROUND_END', { _warmup: true }), false);
});

test('a bot that has chosen its deflect holds position through the telegraph', () => {
    const { shouldHoldDeflectPosition } = botHelpers;
    assert.equal(shouldHoldDeflectPosition(true, true), true);
    assert.equal(shouldHoldDeflectPosition(true, false), false);
    assert.equal(shouldHoldDeflectPosition(false, true), false);
    assert.equal(shouldHoldDeflectPosition(false, false), false);
});

test('the bot movement path gates dodge, intercept, drift, and strafe with the hold invariant', () => {
    const guardedMoves = [
        /!holdingDeflectPosition && isTargeted && speed > 8/,
        /!holdingDeflectPosition && isTargeted && interceptDist > 2\.5/,
        /!holdingDeflectPosition && !isTargeted && ballDist < 8/,
        /!holdingDeflectPosition && ballDist > 1\.5/
    ];
    for (const pattern of guardedMoves) assert.match(botSource, pattern);
    assert.match(botSource, /const holdingDeflectPosition = isTargeted && shouldHoldDeflectPosition/);
});

test('the bot commits before reaction timing so the hold spans reaction and wind-up', () => {
    const decision = botSource.indexOf('if (!this._deflectDecided) {');
    const reaction = botSource.indexOf('this.reactionTimer += dt;');
    assert.ok(decision >= 0 && decision < reaction, 'deflect decision must precede reaction timing');
});

test('bot wind-up starts before the attack-range gate, then redirects only in range', () => {
    const methodStart = botSource.indexOf('tryDeflect(ball, dt = 0.016) {');
    const method = botSource.slice(methodStart);
    const windUp = method.indexOf('this.windUpTimer += dt;');
    const rangeGate = method.indexOf('if (dist > ball.attackRange) return false;');
    assert.ok(windUp >= 0 && windUp < rangeGate, 'wind-up must complete during the alert window before range is required');
});
