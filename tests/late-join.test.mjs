import test from 'node:test';
import assert from 'node:assert/strict';
import {
    activateQueuedEntity,
    isLiveJoinState,
    normalizeTeam,
    queueForNextRound,
    selectQueuedTeam
} from '../js/late-join.js';
import { normalizeCountdownState } from '../js/network.js';
import { readFile } from 'node:fs/promises';

function compileGameMethod(source, name, nextName) {
    const signature = source.indexOf(`    ${name}(`);
    assert.notEqual(signature, -1);
    const paramsStart = signature + name.length + 5;
    const paramsEnd = source.indexOf(') {', paramsStart);
    const bodyStart = paramsEnd + 2;
    const bodyEnd = source.indexOf(`\n    ${nextName}(`, bodyStart);
    assert.notEqual(bodyEnd, -1);
    const params = source.slice(paramsStart, paramsEnd);
    const body = source.slice(bodyStart, bodyEnd).trimEnd();
    return new Function('normalizeCountdownState', `return function(${params}) ${body}`)(normalizeCountdownState);
}

test('only live round states queue late joins', () => {
    assert.equal(isLiveJoinState('PLAYING'), true);
    assert.equal(isLiveJoinState('COUNTDOWN'), true);
    assert.equal(isLiveJoinState('ROUND_END'), true);
    assert.equal(isLiveJoinState('PAUSED'), true);
    assert.equal(isLiveJoinState('LOBBY'), false);
    assert.equal(isLiveJoinState('GAME_OVER'), false);
});

test('queue hides entity and records a bounded activation round', () => {
    const entity = { team: 'blue', alive: true, group: { visible: true } };
    assert.deepEqual(queueForNextRound(entity, { team: 'red', round: 4.9 }), {
        team: 'red',
        activateRound: 4
    });
    assert.equal(entity.alive, false);
    assert.equal(entity.group.visible, false);
    assert.equal(entity.queuedForNextRound, true);
});

test('queued team selection validates and reports changes', () => {
    const entity = { queuedForNextRound: true, pendingTeam: 'red' };
    assert.equal(selectQueuedTeam(entity, 'blue'), true);
    assert.equal(selectQueuedTeam(entity, 'blue'), false);
    assert.equal(selectQueuedTeam(entity, 'green'), false);
    assert.equal(selectQueuedTeam({}, 'red'), false);
});

test('activation applies team once and leaves respawn to caller', () => {
    const entity = {
        team: 'red',
        pendingTeam: 'blue',
        queuedForNextRound: true,
        activateRound: 2,
        alive: false,
        score: 12
    };
    assert.equal(activateQueuedEntity(entity), true);
    assert.equal(entity.team, 'blue');
    assert.equal(entity.alive, false);
    assert.equal(entity.queuedForNextRound, false);
    assert.equal(entity.score, 12);
    assert.equal(activateQueuedEntity(entity), false);
});

test('team normalization never creates a spectator scoring team', () => {
    assert.equal(normalizeTeam('blue'), 'blue');
    assert.equal(normalizeTeam('spectator', 'blue'), 'blue');
    assert.equal(normalizeTeam(null, 'invalid'), 'red');
});

test('late join restores the authoritative ball snapshot', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('handleLateJoin(data = {})'), source.indexOf('startGameFromNetwork(data = {})'));

    assert.match(block, /data\.snapshot\?\.ball \|\| data\.ball/);
    assert.match(block, /this\._applyBallSnapshot\(ballState\)/);
});

test('authoritative countdown shows host remaining and cancellation blocks stale transition', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const showCountdown = compileGameMethod(source, '_showAuthoritativeCountdown', '_applyBallAffix');
    const cancelPreGame = compileGameMethod(source, 'cancelPreGame', '_countdownSnapshot');
    const calls = [];
    let generation = 0;
    const game = {
        state: 'COUNTDOWN',
        ball: {},
        _cancelCountdown: () => {},
        ui: {
            cancelCountdown() { generation++; },
            hideMatchIntro() {},
            showCountdown(remaining, callback) {
                const current = generation;
                calls.push({
                    remaining,
                    run: () => { if (current === generation) callback(); }
                });
            }
        }
    };

    showCountdown.call(game, { phase: 'pre', remaining: 4.2, duration: 10 });
    assert.equal(calls[0].remaining, 5);
    cancelPreGame.call(game);
    calls[0].run();
    assert.equal(calls.length, 1);

    showCountdown.call(game, { phase: 'final', remaining: 1.2, duration: 3 });
    assert.equal(calls[1].remaining, 2);
});
