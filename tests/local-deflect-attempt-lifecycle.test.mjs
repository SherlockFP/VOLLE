import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const STATES = { PLAYING: 'PLAYING', PAUSED: 'PAUSED', ROUND_END: 'ROUND_END' };
const clearAttempt = compileGameMethod('_clearLocalDeflectAttempt');
const markHit = compileGameMethod('_markLocalDeflectAttemptHit');
const updateAttempt = compileGameMethod('_updateLocalDeflectAttempt', { STATES, Math });
const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');

function createFixture({ distance = 4, speed = 20, attackDuration = 0.3 } = {}) {
    const messages = [];
    const cues = [];
    const player = {
        alive: true,
        attacking: true,
        knifeAttackType: 'slash',
        attackCooldown: attackDuration,
        attackDuration,
        position: { x: 0, y: 0, z: 0 }
    };
    const ball = {
        active: true,
        targetPlayer: player,
        position: { x: distance, y: 0, z: 0 },
        velocity: { x: -speed, y: 0, z: 0 }
    };
    return {
        state: STATES.PLAYING,
        player,
        ball,
        ui: { showMessage: (...args) => { messages.push(args); return true; } },
        audio: { playCue: name => cues.push(name) },
        messages,
        cues,
        _localDeflectAttemptActive: false,
        _localDeflectAttemptHit: false,
        _localDeflectAttemptResolved: false,
        _localDeflectAttemptRemaining: 0,
        _localDeflectAttemptWindow: 0,
        _clearLocalDeflectAttempt: clearAttempt,
        _markLocalDeflectAttemptHit: markHit,
        _updateLocalDeflectAttempt: updateAttempt
    };
}

function runUntilWindowEnds(fixture, fps) {
    const dt = 1 / fps;
    fixture._updateLocalDeflectAttempt(dt); // arm from the eligible LMB slash
    while (fixture._localDeflectAttemptActive) fixture._updateLocalDeflectAttempt(dt);
}

function assertFeedback(fixture, message) {
    assert.equal(fixture.messages.length, 1);
    assert.equal(fixture.messages[0][0], message);
    assert.equal(fixture.messages[0][1], 650);
    assert.equal(fixture.messages[0][2].priority, 0);
    assert.equal(fixture.messages[0][2].tone, 'deflect-miss');
    assert.deepEqual(fixture.cues, ['deflect-reject']);
}

test('only a live assigned local LMB swing in PLAYING arms a missed-deflect attempt', () => {
    const fixture = createFixture();
    fixture.state = STATES.PAUSED;
    fixture._updateLocalDeflectAttempt(1 / 60);
    assert.equal(fixture._localDeflectAttemptActive, false);

    fixture.state = STATES.PLAYING;
    fixture.ball.targetPlayer = null;
    fixture._updateLocalDeflectAttempt(1 / 60);
    assert.equal(fixture._localDeflectAttemptActive, false);

    fixture.ball.targetPlayer = fixture.player;
    fixture.player.knifeAttackType = 'stab';
    fixture._updateLocalDeflectAttempt(1 / 60);
    assert.equal(fixture._localDeflectAttemptActive, false, 'right-click stab is not an LMB deflect attempt');

    fixture.player.knifeAttackType = 'slash';
    fixture._updateLocalDeflectAttempt(1 / 60);
    assert.equal(fixture._localDeflectAttemptActive, true);
    assert.equal(fixture._localDeflectAttemptWindow, 0.3);
});

test('a reliable arrival beyond the swing window reports exactly one EARLY cue at 20/60/144 FPS', () => {
    for (const fps of [20, 60, 144]) {
        const fixture = createFixture({ distance: 20, speed: 20, attackDuration: 0.3 });
        runUntilWindowEnds(fixture, fps);
        assertFeedback(fixture, 'EARLY — WAIT FOR THE BALL');
        fixture._updateLocalDeflectAttempt(1 / fps);
        assert.equal(fixture.messages.length, 1, `${fps} FPS does not leave a stale/spam attempt`);
    }
});

test('a late or uncertain swing reports MISSED DEFLECT once and a successful contact clears silently', () => {
    const missed = createFixture({ distance: 4, speed: 20, attackDuration: 0.3 });
    runUntilWindowEnds(missed, 60);
    assertFeedback(missed, 'MISSED DEFLECT — TIME IT CLOSER');

    const hit = createFixture();
    hit._updateLocalDeflectAttempt(1 / 60);
    hit._markLocalDeflectAttemptHit();
    hit._updateLocalDeflectAttempt(1 / 60);
    assert.equal(hit._localDeflectAttemptActive, false);
    assert.deepEqual(hit.messages, []);
    assert.deepEqual(hit.cues, []);
});

test('inactive, unassigned, dead, spectator, paused, and round-exit attempts discard without feedback', () => {
    for (const mutate of [
        fixture => { fixture.ball.active = false; },
        fixture => { fixture.ball.targetPlayer = null; },
        fixture => { fixture.player.alive = false; },
        fixture => { fixture.ui.spectating = true; },
        fixture => { fixture.state = STATES.PAUSED; },
        fixture => { fixture.state = STATES.ROUND_END; }
    ]) {
        const fixture = createFixture();
        fixture._updateLocalDeflectAttempt(1 / 60);
        mutate(fixture);
        fixture._updateLocalDeflectAttempt(1 / 60);
        assert.equal(fixture._localDeflectAttemptActive, false);
        assert.deepEqual(fixture.messages, []);
        assert.deepEqual(fixture.cues, []);
    }
});

test('successful local handling resolves the attempt while remote echo stays presentation-free', () => {
    assert.match(gameSource, /const result = this\.ball\.deflectWithAim\(pos, aimDir, nextTarget, flick, null, chargedPower\);\s+this\._markLocalDeflectAttemptHit\(\);/);
    assert.match(gameSource, /const result = this\.ball\.deflectWithAim\(pos, aimDir, nextTarget, flick, momentum, chargedPower\);\s+this\._markLocalDeflectAttemptHit\(\);/);
    const echo = extractGameMethod('handleRemoteAttackAnim');
    assert.doesNotMatch(echo, /_updateLocalDeflectAttempt|_markLocalDeflectAttemptHit|showMessage/);
    assert.match(gameSource, /'MISSED DEFLECT — TIME IT CLOSER',\s+650,\s+\{ priority: 0, tone: 'deflect-miss' \}/);
});
