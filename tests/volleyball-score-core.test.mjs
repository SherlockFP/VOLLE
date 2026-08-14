import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolleyballConfig, VOLLEYBALL_TEAMS } from '../js/volleyball-rules.js';
import { awardVolleyballRally, createVolleyballScoreState } from '../js/volleyball-score.js';

test('rally point is awarded exactly once for a rally id', () => {
  const config = createVolleyballConfig({ teamSize: 2 });
  const score = createVolleyballScoreState({ servingTeam: VOLLEYBALL_TEAMS.HOME });
  assert.equal(awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, 7, config).awarded, true);
  assert.equal(awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, 7, config).awarded, false);
  assert.deepEqual(score.points, [0, 1]);
});

test('older rally ids cannot replay after a newer rally was awarded', () => {
  const config = createVolleyballConfig();
  const score = createVolleyballScoreState();
  assert.equal(awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, 7, config).awarded, true);
  assert.equal(awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, 8, config).awarded, true);
  assert.equal(awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, 7, config).awarded, false);
  assert.deepEqual(score.points, [1, 1]);
});

test('receiving team winning a rally takes service and rotates once', () => {
  const config = createVolleyballConfig({ teamSize: 3 });
  const score = createVolleyballScoreState({ servingTeam: VOLLEYBALL_TEAMS.HOME });
  awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, 1, config);
  assert.equal(score.servingTeam, VOLLEYBALL_TEAMS.AWAY);
  assert.deepEqual(score.rotations, [0, 1]);
  awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, 2, config);
  assert.deepEqual(score.rotations, [0, 1]);
});

test('best-of-three short sets require 15 points and a two-point lead', () => {
  const config = createVolleyballConfig();
  const score = createVolleyballScoreState();
  let rally = 1;
  for (let i = 0; i < 14; i++) awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, rally++, config);
  for (let i = 0; i < 14; i++) awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, rally++, config);
  awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, rally++, config);
  assert.deepEqual(score.points, [15, 14]);
  const firstSet = awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, rally++, config);
  assert.equal(firstSet.setWon, true);
  assert.equal(firstSet.matchWon, false);
  assert.deepEqual(score.completedSets, [[16, 14]]);
  assert.deepEqual(score.points, [0, 0]);

  for (let i = 0; i < 15; i++) {
    const result = awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, rally++, config);
    if (i === 14) {
      assert.equal(result.setWon, true);
      assert.equal(result.matchWon, true);
    }
  }
  assert.equal(score.matchWinner, VOLLEYBALL_TEAMS.HOME);
  assert.deepEqual(score.sets, [2, 0]);
});

test('first service alternates at each new set regardless of previous set winner', () => {
  const config = createVolleyballConfig({ setTarget: 3, setsToWin: 3 });
  const score = createVolleyballScoreState({ servingTeam: VOLLEYBALL_TEAMS.HOME });
  for (let rally = 1; rally <= 3; rally++) awardVolleyballRally(score, VOLLEYBALL_TEAMS.HOME, rally, config);
  assert.equal(score.setOpeningTeam, VOLLEYBALL_TEAMS.AWAY);
  assert.equal(score.servingTeam, VOLLEYBALL_TEAMS.AWAY);
  for (let rally = 4; rally <= 6; rally++) awardVolleyballRally(score, VOLLEYBALL_TEAMS.AWAY, rally, config);
  assert.equal(score.setOpeningTeam, VOLLEYBALL_TEAMS.HOME);
  assert.equal(score.servingTeam, VOLLEYBALL_TEAMS.HOME);
});
