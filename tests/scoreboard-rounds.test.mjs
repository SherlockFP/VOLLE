import test from 'node:test';
import assert from 'node:assert/strict';
import { Scoreboard } from '../js/scoreboard.js';

test('damage and kill points never alter integer round score', () => {
    const board = new Scoreboard();
    board.addPlayer('Sherlock', 'red');
    board.recordPoint('Sherlock', 0.5);
    board.recordPoint('Sherlock', 1);
    assert.equal(board.players.get('Sherlock').score, 1.5);
    assert.equal(board.redScore, 0);
    assert.equal(board.blueScore, 0);
});

test('only explicit round wins change team score', () => {
    const board = new Scoreboard();
    assert.equal(board.recordRoundWin('red'), true);
    assert.equal(board.recordRoundWin('blue'), true);
    assert.equal(board.recordRoundWin('spectator'), false);
    assert.equal(board.redScore, 1);
    assert.equal(board.blueScore, 1);
    assert.equal(Number.isInteger(board.redScore), true);
});

// Per-round history: the match report can only say which round went wrong if the
// board records one entry per win. recordRoundWin() is the single funnel for
// elimination, goal rush and hot potato, so capturing there covers every mode.
test('each round win appends a history entry with the running score', () => {
    const board = new Scoreboard();
    board.newRound();
    board.recordRoundWin('red');
    board.newRound();
    board.recordRoundWin('blue');

    assert.equal(board.roundHistory.length, 2);
    assert.deepEqual(
        board.roundHistory.map(r => [r.round, r.winner, r.red, r.blue]),
        [[1, 'red', 1, 0], [2, 'blue', 1, 1]]
    );
    assert.equal(typeof board.roundHistory[0].clock, 'string');
});

test('a rejected round win records no history', () => {
    const board = new Scoreboard();
    board.recordRoundWin('spectator');
    assert.equal(board.roundHistory.length, 0);
});

test('reset clears history so a rematch does not inherit the old rounds', () => {
    const board = new Scoreboard();
    board.recordRoundWin('red');
    assert.equal(board.roundHistory.length, 1);
    board.reset();
    assert.equal(board.roundHistory.length, 0);
    assert.equal(board.redScore, 0);
});

test('history is bounded so an endless match cannot grow it without limit', () => {
    const board = new Scoreboard();
    for (let i = 0; i < 200; i += 1) board.recordRoundWin('red');
    assert.ok(
        board.roundHistory.length <= 32,
        `history grew to ${board.roundHistory.length}`
    );
    assert.equal(board.redScore, 200, 'the score itself still counts every win');
});
