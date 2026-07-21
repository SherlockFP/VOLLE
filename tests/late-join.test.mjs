import test from 'node:test';
import assert from 'node:assert/strict';
import {
    activateQueuedEntity,
    isLiveJoinState,
    normalizeTeam,
    queueForNextRound,
    selectQueuedTeam
} from '../js/late-join.js';

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
