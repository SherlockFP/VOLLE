import { extractGameMethod, compileGameMethod } from './game-source.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GOAL_RUSH_MODE_ID,
    DEFAULT_SCORE_TO_WIN,
    DEFAULT_RESPAWN_DELAY,
    DEFAULT_GOAL_RUSH_MUTATORS,
    computeGoalZones,
    isInsideGoal,
    checkGoalEntry,
    createGoalRushState,
    applyGoalScore,
    advanceGoalRushClock,
    resolveGoalRushTick,
    goalScoringTeam
} from '../js/goal-mode.js';

const STANDARD_BOUNDS = { minX: -50, maxX: 50, minY: 0, maxY: 30, minZ: -60, maxZ: 60 };

test('module exports stable mode id + defaults', () => {
    assert.equal(GOAL_RUSH_MODE_ID, 'goal_rush');
    assert.equal(DEFAULT_SCORE_TO_WIN, 5);
    assert.equal(DEFAULT_RESPAWN_DELAY, 3);
    assert.equal(DEFAULT_GOAL_RUSH_MUTATORS.goalRush, true);
    assert.equal(DEFAULT_GOAL_RUSH_MUTATORS.scoreToWin, 5);
    assert.equal(DEFAULT_GOAL_RUSH_MUTATORS.respawnDelay, 3);
});

test('computeGoalZones derives symmetric red/blue zones from arbitrary bounds', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);
    assert.ok(zones);
    assert.equal(zones.red.team, 'red');
    assert.equal(zones.blue.team, 'blue');
    // Red defends the min-Z end, blue defends the max-Z end (matches arena.js floor layout).
    assert.ok(zones.red.center.z < 0);
    assert.ok(zones.blue.center.z > 0);
    // Zones are symmetric around the court's center X.
    assert.equal(zones.red.minX, zones.blue.minX);
    assert.equal(zones.red.maxX, zones.blue.maxX);
    // Goal mouth stays within the arena's own bounds.
    assert.ok(zones.red.minZ >= STANDARD_BOUNDS.minZ);
    assert.ok(zones.blue.maxZ <= STANDARD_BOUNDS.maxZ);
    assert.ok(zones.red.maxX <= STANDARD_BOUNDS.maxX);
    assert.ok(zones.red.minX >= STANDARD_BOUNDS.minX);
});

test('computeGoalZones scales proportionally across very different map sizes', () => {
    const tiny = computeGoalZones({ minX: -20, maxX: 20, minY: 0, maxY: 15, minZ: -22, maxZ: 22 });
    const huge = computeGoalZones({ minX: -480, maxX: 480, minY: 0, maxY: 60, minZ: -590, maxZ: 590 });
    assert.ok(tiny && huge);
    const tinyWidth = tiny.red.maxX - tiny.red.minX;
    const hugeWidth = huge.red.maxX - huge.red.minX;
    assert.ok(hugeWidth > tinyWidth);
    // Neither goal exceeds its own court width.
    assert.ok(tinyWidth <= 40);
    assert.ok(hugeWidth <= 960);
});

test('computeGoalZones returns null for unusable bounds instead of throwing', () => {
    assert.equal(computeGoalZones(null), null);
    assert.equal(computeGoalZones(undefined), null);
    assert.equal(computeGoalZones({}), null);
    assert.equal(computeGoalZones({ minX: 5, maxX: 5, minZ: -5, maxZ: 5 }), null); // zero width
    assert.equal(computeGoalZones({ minX: NaN, maxX: 10, minZ: -10, maxZ: 10 }), null);
    assert.doesNotThrow(() => computeGoalZones('not an object'));
    assert.doesNotThrow(() => computeGoalZones(42));
});

test('isInsideGoal: inside, outside, and on-boundary positions', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);
    const zone = zones.red;

    // Dead center of the goal mouth is inside.
    assert.equal(isInsideGoal({ x: zone.center.x, y: zone.center.y, z: zone.center.z }, zone), true);

    // Well outside on every axis.
    assert.equal(isInsideGoal({ x: 0, y: 0, z: 0 }, zone), false);
    assert.equal(isInsideGoal({ x: zone.maxX + 50, y: zone.center.y, z: zone.center.z }, zone), false);
    assert.equal(isInsideGoal({ x: zone.center.x, y: zone.maxY + 50, z: zone.center.z }, zone), false);

    // Exactly on each boundary edge counts as inside (inclusive box).
    assert.equal(isInsideGoal({ x: zone.minX, y: zone.minY, z: zone.minZ }, zone), true);
    assert.equal(isInsideGoal({ x: zone.maxX, y: zone.maxY, z: zone.maxZ }, zone), true);

    // Just outside the boundary by an epsilon is outside.
    assert.equal(isInsideGoal({ x: zone.minX - 0.001, y: zone.center.y, z: zone.center.z }, zone), false);
    assert.equal(isInsideGoal({ x: zone.center.x, y: zone.center.y, z: zone.maxZ + 0.001 }, zone), false);
});

test('checkGoalEntry credits the OPPOSING team when the ball enters a zone', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);

    const entryInRed = checkGoalEntry(zones.red.center, zones);
    assert.equal(entryInRed.scored, true);
    assert.equal(entryInRed.concededTeam, 'red');
    assert.equal(entryInRed.scoringTeam, 'blue');

    const entryInBlue = checkGoalEntry(zones.blue.center, zones);
    assert.equal(entryInBlue.scored, true);
    assert.equal(entryInBlue.concededTeam, 'blue');
    assert.equal(entryInBlue.scoringTeam, 'red');

    const noEntry = checkGoalEntry({ x: 0, y: 1, z: 0 }, zones);
    assert.equal(noEntry.scored, false);
    assert.equal(noEntry.scoringTeam, null);
});

test('own goal: ball ending up in your own zone still scores for the OTHER team', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);
    let state = createGoalRushState({ scoreToWin: 10 });

    // Red player deflects the ball backward into red's OWN goal.
    const { state: nextState, entry } = resolveGoalRushTick(state, zones.red.center, zones, { shooterTeam: 'red' });
    assert.equal(entry.scoringTeam, 'blue');
    assert.equal(nextState.blueScore, 1);
    assert.equal(nextState.redScore, 0);
    assert.equal(nextState.goalHistory.at(-1).ownGoal, true);
    assert.equal(nextState.goalHistory.at(-1).team, 'blue');
});

test('applyGoalScore rejects invalid teams and finished matches without throwing', () => {
    const state = createGoalRushState();
    assert.equal(applyGoalScore(state, 'green'), state);
    assert.equal(applyGoalScore(state, undefined), state);
    assert.equal(applyGoalScore(null, 'red'), null);

    let finished = createGoalRushState({ scoreToWin: 1 });
    finished = applyGoalScore(finished, 'red');
    assert.equal(finished.over, true);
    const afterFinish = applyGoalScore(finished, 'blue');
    assert.equal(afterFinish, finished); // no-op once the match is over
});

test('score-to-win ends the match once a team reaches the target', () => {
    let state = createGoalRushState({ scoreToWin: 3 });
    state = applyGoalScore(state, 'red');
    assert.equal(state.over, false);
    state = applyGoalScore(state, 'red');
    assert.equal(state.over, false);
    state = applyGoalScore(state, 'blue');
    assert.equal(state.over, false);
    state = applyGoalScore(state, 'red');
    assert.equal(state.over, true);
    assert.equal(state.winner, 'red');
    assert.equal(state.endReason, 'score');
    assert.equal(state.redScore, 3);
    assert.equal(state.blueScore, 1);
});

test('time-limit win condition: higher score wins, equal score is a draw', () => {
    let ahead = createGoalRushState({ scoreToWin: 99, timeLimit: 120 });
    ahead = applyGoalScore(ahead, 'blue');
    ahead = advanceGoalRushClock(ahead, 119);
    assert.equal(ahead.over, false);
    ahead = advanceGoalRushClock(ahead, 5);
    assert.equal(ahead.over, true);
    assert.equal(ahead.winner, 'blue');
    assert.equal(ahead.endReason, 'time');

    let tied = createGoalRushState({ scoreToWin: 99, timeLimit: 60 });
    tied = advanceGoalRushClock(tied, 61);
    assert.equal(tied.over, true);
    assert.equal(tied.winner, 'draw');
    assert.equal(tied.endReason, 'time');
});

test('without a timeLimit configured, the clock never ends the match on its own', () => {
    let state = createGoalRushState({ scoreToWin: 99 });
    assert.equal(state.timeLimit, null);
    state = advanceGoalRushClock(state, 100000);
    assert.equal(state.over, false);
});

test('respawnDelay defaults and clamps to a non-negative finite value', () => {
    assert.equal(createGoalRushState().respawnDelay, DEFAULT_RESPAWN_DELAY);
    assert.equal(createGoalRushState({ respawnDelay: 1.5 }).respawnDelay, 1.5);
    assert.equal(createGoalRushState({ respawnDelay: -5 }).respawnDelay, DEFAULT_RESPAWN_DELAY);
    assert.equal(createGoalRushState({ respawnDelay: NaN }).respawnDelay, DEFAULT_RESPAWN_DELAY);
});

test('hostile inputs (NaN/undefined/null positions) never crash isInsideGoal or checkGoalEntry', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);

    assert.doesNotThrow(() => isInsideGoal(undefined, zones.red));
    assert.doesNotThrow(() => isInsideGoal(null, zones.red));
    assert.doesNotThrow(() => isInsideGoal({}, zones.red));
    assert.doesNotThrow(() => isInsideGoal({ x: NaN, y: NaN, z: NaN }, zones.red));
    assert.doesNotThrow(() => isInsideGoal({ x: 0, y: 0, z: 0 }, null));
    assert.doesNotThrow(() => isInsideGoal({ x: 0, y: 0, z: 0 }, undefined));
    assert.doesNotThrow(() => isInsideGoal({ x: 0, y: 0, z: 0 }, {}));

    assert.equal(isInsideGoal(undefined, zones.red), false);
    assert.equal(isInsideGoal({ x: NaN, y: 0, z: 0 }, zones.red), false);
    assert.equal(isInsideGoal({ x: Infinity, y: 0, z: 0 }, zones.red), false);

    assert.doesNotThrow(() => checkGoalEntry(undefined, zones));
    assert.doesNotThrow(() => checkGoalEntry(null, null));
    assert.doesNotThrow(() => checkGoalEntry({ x: NaN, y: undefined, z: null }, zones));
    assert.equal(checkGoalEntry(undefined, zones).scored, false);
    assert.equal(checkGoalEntry({ x: 0, y: 0, z: 0 }, undefined).scored, false);

    assert.doesNotThrow(() => resolveGoalRushTick(createGoalRushState(), { x: NaN }, zones));
    assert.doesNotThrow(() => resolveGoalRushTick(null, zones.red.center, zones));
    assert.doesNotThrow(() => advanceGoalRushClock(createGoalRushState(), NaN));
    assert.doesNotThrow(() => advanceGoalRushClock(createGoalRushState(), undefined));
    assert.doesNotThrow(() => advanceGoalRushClock(createGoalRushState(), -50));
});

// Game._checkGoalRushScore() wiring test: validates the extracted method detects
// goal entries and drives round end state transition. It's called every frame.
test('_checkGoalRushScore wires goal detection to round end state transition', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);
    const STATES = Object.freeze({
        PLAYING: 'playing',
        ROUND_END: 'round-end'
    });

    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', {
        STATES,
        goalScoringTeam,
        checkGoalEntry
    });

    const mockGame = {
        _goalRush: true,
        state: STATES.PLAYING,
        network: { connected: false, isHost: false },
        ball: {
            active: true,
            position: { x: zones.red.minX + 0.1, y: zones.red.minY + 0.1, z: zones.red.minZ + 0.1 },
            deactivate: function() { this.active = false; }
        },
        arena: { getGoalZones: () => zones },
        scoreboard: { recordRoundWin: function(team) { this.lastWin = team; } },
        setState: function(s) { this.state = s; },
        announce: () => {},
        roundRestartDelay: 3
    };

    const scored = checkGoalRushScore.call(mockGame, 1000 / 60);
    assert.equal(scored, true, 'should return true when goal detected');
    assert.equal(mockGame.scoreboard.lastWin, 'blue', 'should credit blue team');
    assert.equal(mockGame.state, STATES.ROUND_END, 'should transition to ROUND_END');
    assert.equal(mockGame.ball.active, false, 'should deactivate ball');
});

test('_checkGoalRushScore returns false when goal rush disabled', () => {
    const STATES = Object.freeze({ PLAYING: 'playing' });
    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', { STATES, goalScoringTeam, checkGoalEntry });
    const mockGame = {
        _goalRush: false,
        state: STATES.PLAYING,
        network: { connected: false },
        ball: { active: true }
    };
    assert.equal(checkGoalRushScore.call(mockGame, 1000 / 60), false);
});

test('_checkGoalRushScore returns false when not in PLAYING state', () => {
    const STATES = Object.freeze({ PLAYING: 'playing', ROUND_END: 'round-end' });
    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', { STATES, goalScoringTeam, checkGoalEntry });
    const mockGame = {
        _goalRush: true,
        state: STATES.ROUND_END,
        network: { connected: false },
        ball: { active: true }
    };
    assert.equal(checkGoalRushScore.call(mockGame, 1000 / 60), false);
});

test('_checkGoalRushScore returns false when ball is inactive', () => {
    const STATES = Object.freeze({ PLAYING: 'playing' });
    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', { STATES, goalScoringTeam, checkGoalEntry });
    const mockGame = {
        _goalRush: true,
        state: STATES.PLAYING,
        network: { connected: false },
        ball: { active: false }
    };
    assert.equal(checkGoalRushScore.call(mockGame, 1000 / 60), false);
});

test('_checkGoalRushScore returns false when zones unavailable', () => {
    const STATES = Object.freeze({ PLAYING: 'playing' });
    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', { STATES, goalScoringTeam, checkGoalEntry });
    const mockGame = {
        _goalRush: true,
        state: STATES.PLAYING,
        network: { connected: false },
        ball: { active: true },
        arena: { getGoalZones: () => null }
    };
    assert.equal(checkGoalRushScore.call(mockGame, 1000 / 60), false);
});

test('_checkGoalRushScore returns false when ball not in goal zone', () => {
    const zones = computeGoalZones(STANDARD_BOUNDS);
    const STATES = Object.freeze({ PLAYING: 'playing' });
    const checkGoalRushScore = compileGameMethod('_checkGoalRushScore', { STATES, goalScoringTeam, checkGoalEntry });
    const mockGame = {
        _goalRush: true,
        state: STATES.PLAYING,
        network: { connected: false },
        ball: { active: true, position: { x: 0, y: 1, z: 0 } },
        arena: { getGoalZones: () => zones }
    };
    assert.equal(checkGoalRushScore.call(mockGame, 1000 / 60), false);
});
