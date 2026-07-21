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
