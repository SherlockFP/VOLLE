import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolleyballController } from '../js/volleyball-controller.js';
import { VOLLEYBALL_CONTACTS, VOLLEYBALL_FAULTS, VOLLEYBALL_PHASES, VOLLEYBALL_TEAMS } from '../js/volleyball-rules.js';

function liveController(config = {}) {
  const controller = createVolleyballController({ config });
  controller.setBall({ x: 0, y: 12, z: -4, vx: 1, vy: 5, vz: 3, radius: 0.34 });
  assert.equal(controller.prepareServe(VOLLEYBALL_TEAMS.HOME), true);
  assert.equal(controller.contact({ team: VOLLEYBALL_TEAMS.HOME, playerId: 'h1', type: VOLLEYBALL_CONTACTS.SERVE }).accepted, true);
  return controller;
}

test('controller traverses serve setup, ready, rally, dead ball and point awarded', () => {
  const controller = liveController({ deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.2 });
  assert.equal(controller.state.phase, VOLLEYBALL_PHASES.RALLY);
  assert.equal(controller.reportFault(VOLLEYBALL_FAULTS.OUT, VOLLEYBALL_TEAMS.HOME), true);
  assert.equal(controller.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  controller.update(0.06);
  assert.equal(controller.state.phase, VOLLEYBALL_PHASES.POINT_AWARDED);
  assert.deepEqual(controller.state.score.points, [0, 1]);
  controller.update(0.21);
  assert.equal(controller.state.phase, VOLLEYBALL_PHASES.SERVE_SETUP);
});

test('block is free, fourth consuming contact faults the team', () => {
  const c = liveController({ teamSize: 4 });
  assert.equal(c.contact({ team: 'home', playerId: 'h2', type: 'block' }).teamContacts, 1); // serve consumed first hit
  assert.equal(c.contact({ team: 'home', playerId: 'h2', type: 'receive' }).teamContacts, 2);
  assert.equal(c.contact({ team: 'home', playerId: 'h3', type: 'set' }).teamContacts, 3);
  const result = c.contact({ team: 'home', playerId: 'h4', type: 'spike' });
  assert.equal(result.fault, VOLLEYBALL_FAULTS.FOUR_HITS);
  assert.equal(c.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
});

test('same player double contact faults unless explicit 1v1 controlled self-set is enabled', () => {
  const strict = liveController({ teamSize: 1 });
  assert.equal(strict.contact({ team: 'away', playerId: 'a1', type: 'receive' }).accepted, true);
  assert.equal(strict.contact({ team: 'away', playerId: 'a1', type: 'set' }).fault, VOLLEYBALL_FAULTS.DOUBLE_CONTACT);

  const assisted = liveController({ teamSize: 1, allowControlledSelfSetOneVsOne: true });
  assert.equal(assisted.contact({ team: 'away', playerId: 'a1', type: 'receive' }).accepted, true);
  assert.equal(assisted.contact({ team: 'away', playerId: 'a1', type: 'set' }).accepted, true);
  assert.equal(assisted.state.teamContacts, 2);
  assert.equal(assisted.contact({ team: 'away', playerId: 'a1', type: 'spike' }).accepted, true);
  assert.equal(assisted.state.teamContacts, 3);
});

test('serve timeout awards the receiver through the same fault state machine', () => {
  const c = createVolleyballController({ config: { serveTimeoutSeconds: 1, deadBallHoldSeconds: 0.05 } });
  c.prepareServe(VOLLEYBALL_TEAMS.HOME);
  for (let i = 0; i < 61; i++) c.update(1 / 60);
  assert.equal(c.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.equal(c.state.pendingFault, VOLLEYBALL_FAULTS.SERVE_TIMEOUT);
  c.update(0.06);
  assert.deepEqual(c.state.score.points, [0, 1]);
});

test('consecutive serve timeouts use unique rally ids and both score exactly once', () => {
  const c = createVolleyballController({ config: {
    serveTimeoutSeconds: 1, deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05,
  } });
  c.prepareServe(VOLLEYBALL_TEAMS.HOME);
  for (let i = 0; i < 61; i++) c.update(1 / 60);
  c.update(0.06);
  c.update(0.06);
  assert.equal(c.state.rallyId, 1);
  assert.deepEqual(c.state.score.points, [0, 1]);
  assert.equal(c.prepareServe(VOLLEYBALL_TEAMS.AWAY), true);
  for (let i = 0; i < 61; i++) c.update(1 / 60);
  c.update(0.06);
  assert.equal(c.state.rallyId, 2);
  assert.deepEqual(c.state.score.points, [1, 1]);
});

test('high-speed floor trajectory cannot tunnel in controller', () => {
  const floor = liveController();
  floor.setBall({ x: 0, y: 5, z: -4, vx: 0, vy: -500, vz: 0, radius: 0.34 });
  floor.update(1 / 60);
  assert.equal(floor.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.equal(floor.state.pendingFault, VOLLEYBALL_FAULTS.GROUND);

});

test('playable high-speed ball/net contact rebounds and rally continues', () => {
  const net = liveController();
  net.setBall({ x: 0, y: 2, z: -5, vx: 0, vy: 0, vz: 1000, radius: 0.34 });
  net.update(1 / 120);
  assert.equal(net.state.phase, VOLLEYBALL_PHASES.RALLY);
  assert.equal(net.state.pendingFault, null);
  assert.ok(net.state.ball.z < 0);
  assert.ok(net.state.ball.vz < 0);
  assert.ok(Math.abs(net.state.ball.vz) < 1000);
});

test('earliest swept event wins: floor before later net crossing is a landing fault', () => {
  const c = liveController();
  c.setBall({ x: 0, y: 0.4, z: -5, vx: 0, vy: -20, vz: 1000, radius: 0.34 });
  c.update(1 / 120);
  assert.equal(c.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.equal(c.state.pendingFault, VOLLEYBALL_FAULTS.GROUND);
});

test('out landing is resolved as out instead of interior ground', () => {
  const c = liveController();
  c.setBall({ x: 15, y: 0.4, z: -4, vx: 0, vy: -20, vz: 0, radius: 0.34 });
  c.update(1 / 120);
  assert.equal(c.state.pendingFault, VOLLEYBALL_FAULTS.OUT);
});

test('fixed-step simulation is equivalent at 30, 60, 120 and 144 render FPS', () => {
  function simulate(fps) {
    const c = liveController();
    for (let i = 0; i < fps; i++) c.update(1 / fps);
    return c.getSnapshot();
  }
  const baseline = simulate(120);
  for (const fps of [30, 60, 144]) {
    const snapshot = simulate(fps);
    assert.equal(snapshot.phase, baseline.phase);
    assert.equal(snapshot.rallyId, baseline.rallyId);
    assert.ok(Math.abs(snapshot.simulationTime - baseline.simulationTime) < 1e-9);
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
      assert.ok(Math.abs(snapshot.ball[key] - baseline.ball[key]) < 1e-9, `${fps} FPS ${key}`);
    }
  }
});

test('snapshot round-trip is stable and malformed input is rejected atomically', () => {
  const source = liveController();
  source.update(0.25);
  const snapshot = source.getSnapshot();
  const target = createVolleyballController();
  assert.equal(target.applySnapshot(snapshot), true);
  assert.deepEqual(target.getSnapshot(), snapshot);

  const before = target.getSnapshot();
  assert.equal(target.applySnapshot({ ...snapshot, ball: { ...snapshot.ball, vx: Infinity } }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({ ...snapshot, score: { ...snapshot.score, points: [-1, 0] } }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({ ...snapshot, pendingFault: 'out', pendingFaultTeam: null }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({ ...snapshot, ball: { ...snapshot.ball, skin: 'paid' } }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({ ...snapshot, damage: 999 }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({ ...snapshot, phase: 'match_end', ballActive: false }), false);
  assert.deepEqual(target.getSnapshot(), before);
  assert.equal(target.applySnapshot({
    ...snapshot,
    score: { ...snapshot.score, lastAwardedRallyId: snapshot.rallyId },
  }), false);
  assert.deepEqual(target.getSnapshot(), before);
});

test('setBall rejects combat, homing and cosmetic fields without partial mutation', () => {
  const c = createVolleyballController();
  const before = { ...c.state.ball };
  assert.equal(c.setBall({ ...before, homing: true }), false);
  assert.equal(c.setBall({ ...before, damage: 100 }), false);
  assert.equal(c.setBall({ ...before, skin: 'legendary' }), false);
  assert.equal(c.setBall({ ...before, radius: before.radius * 1.5 }), false);
  assert.deepEqual(c.state.ball, before);
});

test('center-line invasion reports a center-line fault', () => {
  const c = liveController();
  assert.equal(c.validatePlayerHalf(VOLLEYBALL_TEAMS.HOME, { z: 0.2 }), false);
  assert.equal(c.state.pendingFault, VOLLEYBALL_FAULTS.CENTER_LINE);
});

test('half validation never creates a point-bearing fault before serve', () => {
  const c = createVolleyballController();
  assert.equal(c.validatePlayerHalf(VOLLEYBALL_TEAMS.HOME, { z: 2 }), false);
  assert.equal(c.state.phase, VOLLEYBALL_PHASES.SERVE_SETUP);
  assert.equal(c.state.pendingFault, null);
  c.update(1);
  assert.deepEqual(c.state.score.points, [0, 0]);
});

test('explicit player net violation remains a live-rally fault', () => {
  const c = liveController();
  assert.equal(c.reportFault(VOLLEYBALL_FAULTS.NET, VOLLEYBALL_TEAMS.HOME), true);
  assert.equal(c.state.phase, VOLLEYBALL_PHASES.DEAD_BALL);
  assert.equal(c.state.pendingFault, VOLLEYBALL_FAULTS.NET);
});

test('a legitimate match-end snapshot passes strict semantic validation', () => {
  const config = { setTarget: 3, setsToWin: 1, deadBallHoldSeconds: 0, pointAwardHoldSeconds: 0 };
  const source = createVolleyballController({ config });
  for (let rally = 0; rally < 3; rally++) {
    assert.equal(source.prepareServe(source.state.score.servingTeam), true);
    assert.equal(source.contact({
      team: source.state.score.servingTeam, playerId: 'server', type: VOLLEYBALL_CONTACTS.SERVE,
    }).accepted, true);
    source.reportFault(VOLLEYBALL_FAULTS.OUT, VOLLEYBALL_TEAMS.AWAY);
    source.update(1 / 120);
    if (rally < 2) source.update(1 / 120);
  }
  assert.equal(source.state.phase, VOLLEYBALL_PHASES.MATCH_END);
  const target = createVolleyballController({ config });
  assert.equal(target.applySnapshot(source.getSnapshot()), true);
  assert.equal(target.state.score.matchWinner, VOLLEYBALL_TEAMS.HOME);
});
