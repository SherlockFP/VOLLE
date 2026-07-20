import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RematchVote,
    connectedRematchParticipants,
    createMatchId,
    isSafeMatchId,
    isTerminalRematchState,
    snapshotRematchParticipants
} from '../js/rematch.js';

test('rematch requires every active player', () => {
    const vote = new RematchVote();
    assert.equal(vote.begin('match-a', ['host', 'guest']).accepted, true);
    assert.equal(vote.vote('match-a', 'host').changed, true);
    assert.equal(vote.vote('match-a', 'host').changed, false);
    assert.equal(vote.vote('match-a', 'guest').complete, true);
});

test('stale matches and unknown identities fail closed', () => {
    const vote = new RematchVote();
    vote.begin('match-current', ['host', 'guest']);
    assert.equal(vote.vote('match-old', 'guest').reason, 'stale-match');
    assert.equal(vote.vote('match-current', 'spoofed').reason, 'unknown-player');
    assert.deepEqual(vote.snapshot().readyPlayerIds, []);
});

test('disconnect removes readiness requirement', () => {
    const vote = new RematchVote();
    vote.begin('match-a', ['host', 'guest']);
    vote.vote('match-a', 'host');
    assert.equal(vote.setRequired(['host']).complete, true);
});

test('start is single-use and requires a distinct match id', () => {
    const vote = new RematchVote();
    vote.begin('match-a', ['host']);
    assert.equal(vote.markStarted('match-a', 'match-b').reason, 'not-ready');
    vote.vote('match-a', 'host');
    assert.equal(vote.markStarted('match-a', 'match-a').reason, 'invalid-next-match');
    assert.equal(vote.markStarted('match-a', 'match-b').accepted, true);
    assert.equal(vote.markStarted('match-a', 'match-c').reason, 'already-started');
    assert.equal(vote.vote('match-a', 'host').reason, 'already-started');
});

test('generated match ids are safe and unique', () => {
    const first = createMatchId();
    const second = createMatchId();
    assert.equal(isSafeMatchId(first), true);
    assert.equal(isSafeMatchId(second), true);
    assert.notEqual(first, second);
});

test('terminal state gates rewards and rematch requests', () => {
    assert.equal(isTerminalRematchState('playing'), false);
    assert.equal(isTerminalRematchState('countdown'), false);
    assert.equal(isTerminalRematchState('celebration'), true);
});

test('participant snapshot excludes queued and post-match joins', () => {
    const completed = snapshotRematchParticipants(
        'host',
        ['player-a', 'late-player'],
        ['late-player']
    );
    assert.deepEqual(completed, ['host', 'player-a']);
    assert.deepEqual(
        connectedRematchParticipants(completed, 'host', ['player-a', 'new-spectator']),
        ['host', 'player-a']
    );
    assert.deepEqual(
        connectedRematchParticipants(completed, 'host', ['new-spectator']),
        ['host']
    );
});
