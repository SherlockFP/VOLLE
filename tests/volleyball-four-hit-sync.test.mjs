import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolleyballController } from '../js/volleyball-controller.js';
import { VOLLEYBALL_FAULTS, VOLLEYBALL_PHASES } from '../js/volleyball-rules.js';

const CONFIG = Object.freeze({ teamSize: 4, deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 });

function startRally(controller) {
  const team = controller.state.score.servingTeam;
  assert.equal(controller.prepareServe(team), true);
  assert.equal(controller.contact({ team, playerId: 'server', type: 'serve' }).accepted, true);
}

function fillAwayContacts(controller) {
  for (let index = 0; index < controller.config.maxContacts; index++) {
    const type = ['receive', 'set', 'spike'][index % 3];
    const result = controller.contact({ team: 'away', playerId: `a${index + 1}`, type });
    assert.equal(result.accepted, true);
    assert.equal(result.teamContacts, index + 1);
  }
}

function fullPossession(overrides = {}) {
  const controller = createVolleyballController({ config: { ...CONFIG, ...overrides } });
  startRally(controller);
  fillAwayContacts(controller);
  return controller;
}

function rejectFourth(controller, playerId = 'extra') {
  assert.deepEqual(controller.contact({ team: 'away', playerId, type: 'receive' }), {
    accepted: false, fault: VOLLEYBALL_FAULTS.FOUR_HITS,
  });
}

function advanceTo(controller, phase) {
  for (let step = 0; step < 240; step++) {
    if (controller.state.phase === phase) return;
    controller.update(controller.config.fixedStep);
  }
  assert.fail(`did not reach ${phase}; stopped in ${controller.state.phase}`);
}

function transfer(source, target) {
  const snapshot = source.getSnapshot();
  assert.equal(target.applySnapshot(snapshot), true, `${snapshot.phase} snapshot must be accepted`);
  assert.deepEqual(target.getSnapshot(), snapshot);
  return snapshot;
}

test('a fourth contact faults without replacing the last accepted contact or incrementing its count', () => {
  const controller = fullPossession();
  const before = controller.getSnapshot();
  rejectFourth(controller);
  assert.equal(controller.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.equal(controller.state.pendingFault, VOLLEYBALL_FAULTS.FOUR_HITS);
  assert.equal(controller.state.pendingFaultTeam, 'away');
  assert.equal(controller.state.ballActive, false);
  assert.equal(controller.state.teamContacts, before.teamContacts);
  assert.equal(controller.state.lastContactPlayerId, before.lastContactPlayerId);
  assert.equal(controller.state.lastContactType, before.lastContactType);
  assert.equal(controller.state.controlledSelfSetUsed, before.controlledSelfSetUsed);
  assert.deepEqual(controller.state.ball, before.ball, 'a rejected contact cannot change the ball');
  assert.deepEqual(controller.state.score.points, [0, 0], 'scoring still waits for the normal dead-ball phase');
});

test('two controllers agree through fourth-hit dead ball, one awarded point, and the next serve', () => {
  const source = fullPossession();
  const target = createVolleyballController({ config: CONFIG });
  transfer(source, target);
  rejectFourth(source);
  transfer(source, target);
  assert.equal(target.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.deepEqual(target.state.score.points, [0, 0]);

  advanceTo(source, VOLLEYBALL_PHASES.POINT_AWARDED);
  const awarded = transfer(source, target);
  assert.deepEqual(target.state.score.points, [1, 0]);
  assert.equal(target.state.score.lastAwardedRallyId, source.state.rallyId);
  assert.equal(target.applySnapshot(awarded), true, 'duplicate delivery remains idempotent');
  assert.deepEqual(target.state.score.points, [1, 0]);
  assert.equal(source.contact({ team: 'away', playerId: 'extra', type: 'receive' }).accepted, false);
  assert.equal(source.reportFault(VOLLEYBALL_FAULTS.FOUR_HITS, 'away'), false);

  advanceTo(source, VOLLEYBALL_PHASES.SERVE_SETUP);
  transfer(source, target);
  assert.equal(target.state.teamContacts, 0);
  assert.equal(target.state.pendingFault, null);
  assert.deepEqual(target.state.score.points, [1, 0]);
  const previousRallyId = source.state.rallyId;
  startRally(source);
  transfer(source, target);
  assert.equal(target.state.phase, VOLLEYBALL_PHASES.RALLY);
  assert.equal(target.state.rallyId, previousRallyId + 1);
  assert.equal(target.state.teamContacts, 1);
  assert.deepEqual(target.state.score.points, [1, 0]);
});

test('a block is still free at the hit limit and stays the last accepted contact if the next hit faults', () => {
  const source = fullPossession();
  assert.deepEqual(source.contact({ team: 'away', playerId: 'blocker', type: 'block' }), {
    accepted: true, fault: null, teamContacts: 3,
  });
  rejectFourth(source, 'blocker');
  assert.equal(source.state.lastContactPlayerId, 'blocker');
  assert.equal(source.state.lastContactType, 'block');
  assert.equal(source.state.teamContacts, 3);
  transfer(source, createVolleyballController({ config: CONFIG }));
});

test('an over-limit controlled self-set cannot mark itself accepted or invalidate the fault snapshot', () => {
  const config = { ...CONFIG, teamSize: 1, maxContacts: 1, allowControlledSelfSetOneVsOne: true };
  const source = fullPossession(config);
  assert.deepEqual(source.contact({ team: 'away', playerId: 'a1', type: 'set' }), {
    accepted: false, fault: VOLLEYBALL_FAULTS.FOUR_HITS,
  });
  assert.equal(source.state.controlledSelfSetUsed, false);
  assert.equal(source.state.lastContactPlayerId, 'a1');
  assert.equal(source.state.lastContactType, 'receive');
  assert.equal(source.state.teamContacts, 1);
  transfer(source, createVolleyballController({ config }));
});

test('configured contact limits preserve the accepted count and strict validation still rejects larger counts', () => {
  for (const maxContacts of [1, 2, 3, 4, 5, 6]) {
    const config = { ...CONFIG, maxContacts };
    const source = fullPossession(config);
    const target = createVolleyballController({ config });
    rejectFourth(source);
    assert.equal(source.state.teamContacts, maxContacts);
    const snapshot = transfer(source, target);
    assert.equal(target.applySnapshot({ ...snapshot, teamContacts: maxContacts + 1 }), false);
    assert.deepEqual(target.getSnapshot(), snapshot, 'malformed delivery cannot partially mutate the receiver');
  }
});

test('a match-winning fourth-hit fault has a valid final snapshot with no later serve needed to recover', () => {
  const config = { ...CONFIG, setTarget: 3, setsToWin: 1 };
  const source = createVolleyballController({ config });
  const target = createVolleyballController({ config });
  for (let rally = 0; rally < 3; rally++) {
    startRally(source);
    fillAwayContacts(source);
    transfer(source, target);
    rejectFourth(source);
    transfer(source, target);
    advanceTo(source, rally === 2 ? VOLLEYBALL_PHASES.MATCH_END : VOLLEYBALL_PHASES.POINT_AWARDED);
    transfer(source, target);
    if (rally < 2) advanceTo(source, VOLLEYBALL_PHASES.SERVE_SETUP);
  }
  assert.equal(target.state.phase, VOLLEYBALL_PHASES.MATCH_END);
  assert.equal(target.state.score.matchWinner, 'home');
  assert.deepEqual(target.state.score.sets, [1, 0]);
  assert.equal(target.state.pendingFault, VOLLEYBALL_FAULTS.FOUR_HITS);
  assert.equal(target.state.teamContacts, 3);
  const score = target.getSnapshot().score;
  source.update(0.25);
  transfer(source, target);
  assert.deepEqual(target.getSnapshot().score, score, 'finished match cannot award the foul twice');
});
