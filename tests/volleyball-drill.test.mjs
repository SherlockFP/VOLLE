import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolleyballDrillTracker } from '../js/volleyball-drill.js';
import { VOLLEYBALL_CONTACTS, VOLLEYBALL_TEAMS } from '../js/volleyball-rules.js';
import { createVolleyballPracticeSession } from '../js/volleyball-practice-session.js';

function stateOf(tracker) {
  const state = {};
  assert.equal(tracker.writeState(state), true);
  return state;
}

test('local drill stages serve, receive, attack chains and blocks from accepted contacts', () => {
  const drill = createVolleyballDrillTracker();
  for (let i = 0; i < 3; i++) drill.recordContact(VOLLEYBALL_CONTACTS.SERVE, VOLLEYBALL_TEAMS.HOME, 1);
  assert.equal(stateOf(drill).drillStageId, 'receive');
  for (let i = 0; i < 5; i++) drill.recordContact(VOLLEYBALL_CONTACTS.RECEIVE, VOLLEYBALL_TEAMS.HOME, 2);
  assert.equal(stateOf(drill).drillStageId, 'attack_chain');
  for (let i = 0; i < 3; i++) {
    drill.recordContact(VOLLEYBALL_CONTACTS.RECEIVE, VOLLEYBALL_TEAMS.HOME, 3 + i);
    drill.recordContact(VOLLEYBALL_CONTACTS.SET, VOLLEYBALL_TEAMS.HOME, 3 + i);
    drill.recordContact(VOLLEYBALL_CONTACTS.SPIKE, VOLLEYBALL_TEAMS.HOME, 3 + i);
  }
  assert.equal(stateOf(drill).drillStageId, 'block');
  drill.recordContact(VOLLEYBALL_CONTACTS.BLOCK, VOLLEYBALL_TEAMS.HOME, 6);
  drill.recordContact(VOLLEYBALL_CONTACTS.BLOCK, VOLLEYBALL_TEAMS.HOME, 7);
  const complete = stateOf(drill);
  assert.equal(complete.drillComplete, true);
  assert.equal(complete.drillSuccessfulContacts, 19);
  assert.equal(complete.drillLastContact, VOLLEYBALL_CONTACTS.BLOCK);
  assert.equal(complete.drillContactSerial, 19);
  assert.equal(complete.drillCompletedStages, 4);
  assert.equal(complete.drillGrade, 'S');
  assert.equal(complete.drillAcceptedServe, 3);
  assert.equal(complete.drillAcceptedReceive, 8);
  assert.equal(complete.drillAcceptedSet, 3);
  assert.equal(complete.drillAcceptedSpike, 3);
  assert.equal(complete.drillAcceptedBlock, 2);
});

test('drill tracks rally length, local rally results and idempotent awards without affecting play', () => {
  const drill = createVolleyballDrillTracker();
  drill.recordContact(VOLLEYBALL_CONTACTS.SERVE, VOLLEYBALL_TEAMS.HOME, 12);
  drill.recordContact(VOLLEYBALL_CONTACTS.RECEIVE, VOLLEYBALL_TEAMS.AWAY, 12);
  drill.recordContact(VOLLEYBALL_CONTACTS.SET, VOLLEYBALL_TEAMS.AWAY, 12);
  assert.equal(drill.recordRallyAward(12, VOLLEYBALL_TEAMS.HOME), true);
  assert.equal(drill.recordRallyAward(12, VOLLEYBALL_TEAMS.AWAY), false);
  drill.recordContact(VOLLEYBALL_CONTACTS.SERVE, VOLLEYBALL_TEAMS.AWAY, 13);
  assert.equal(drill.recordRallyAward(13, VOLLEYBALL_TEAMS.AWAY), true);
  const state = stateOf(drill);
  assert.equal(state.drillLongestRally, 3);
  assert.equal(state.drillPointsWon, 1);
  assert.equal(state.drillPointsLost, 1);
  drill.reset();
  assert.deepEqual(stateOf(drill), {
    drillStage: 0, drillStageId: 'serve', drillLabel: 'SERVE BASICS', drillInstruction: 'Use E or primary attack to serve.', drillProgress: 0, drillTarget: 3,
    drillComplete: false, drillSuccessfulContacts: 0, drillLongestRally: 0, drillPointsWon: 0,
    drillPointsLost: 0, drillLastContact: '', drillContactSerial: 0,
    drillCompletedStages: 0, drillGrade: '—', drillGradeReason: '0 / 4 COURT SKILLS COMPLETE',
    drillAcceptedServe: 0, drillAcceptedReceive: 0, drillAcceptedPass: 0,
    drillAcceptedSet: 0, drillAcceptedSpike: 0, drillAcceptedBlock: 0,
  });
});

test('adaptive local input completes the full drill, including blocks, in a deterministic session', () => {
  const session = createVolleyballPracticeSession({
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05, setTarget: 50 },
  });
  assert.equal(session.start(), true);
  const hud = {};
  for (let frame = 0; frame < 120 * 240; frame++) {
    const phase = session.controller.state.phase;
    if (session.getQueueSize() === 0 && (phase === 'serve_setup' || phase === 'serve_ready')) {
      if (session.controller.state.score.servingTeam === VOLLEYBALL_TEAMS.HOME) {
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
      }
      for (let contact = 0; contact < 5; contact++) {
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.RECEIVE), true);
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SET), true);
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SPIKE), true);
      }
      for (let contact = 0; contact < 5; contact++) assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.BLOCK), true);
    }
    session.update(1 / 120);
    session.writeHudState(hud);
    if (hud.drillComplete) break;
  }
  assert.equal(hud.drillComplete, true, JSON.stringify({ hud, expected: session.state.expectedAction, queue: session.getQueueSize(), phase: session.controller.state.phase }));
  assert.equal(hud.drillLastContact, VOLLEYBALL_CONTACTS.BLOCK);
  assert.equal(hud.drillStageId, 'complete');
});

test('practice session exposes drill feedback only after accepted player contacts and clears it on restart', () => {
  const session = createVolleyballPracticeSession({ feederReturnPattern: [0] });
  const before = {};
  session.writeHudState(before);
  assert.equal(before.drillContactSerial, 0);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  assert.equal(session.start(), true);
  for (let i = 0; i < 60; i++) session.update(1 / 120);
  const afterServe = {};
  session.writeHudState(afterServe);
  assert.equal(afterServe.drillLastContact, VOLLEYBALL_CONTACTS.SERVE);
  assert.equal(afterServe.drillContactSerial, 1);
  assert.equal(afterServe.drillSuccessfulContacts, 1);
  assert.equal(session.restart(), true);
  const restarted = {};
  session.writeHudState(restarted);
  assert.equal(restarted.drillContactSerial, 0);
  assert.equal(restarted.drillPointsWon, 0);
});

test('challenge clock advances in fixed steps and freezes when the fourth goal completes', () => {
  const session = createVolleyballPracticeSession({
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05, setTarget: 50 },
  });
  assert.equal(session.start(), true);
  const hud = {};
  for (let frame = 0; frame < 120 * 240; frame++) {
    const phase = session.controller.state.phase;
    if (session.getQueueSize() === 0 && (phase === 'serve_setup' || phase === 'serve_ready')) {
      if (session.controller.state.score.servingTeam === VOLLEYBALL_TEAMS.HOME) session.queueAction(VOLLEYBALL_CONTACTS.SERVE);
      for (let i = 0; i < 5; i++) {
        session.queueAction(VOLLEYBALL_CONTACTS.RECEIVE);
        session.queueAction(VOLLEYBALL_CONTACTS.SET);
        session.queueAction(VOLLEYBALL_CONTACTS.SPIKE);
      }
      for (let i = 0; i < 5; i++) session.queueAction(VOLLEYBALL_CONTACTS.BLOCK);
    }
    session.update(1 / 120);
    session.writeHudState(hud);
    if (hud.drillComplete) break;
  }
  assert.ok(hud.completionElapsedSeconds > 0);
  assert.equal(hud.elapsedSeconds, hud.completionElapsedSeconds);
  for (let i = 0; i < 360; i++) session.update(1 / 60);
  session.writeHudState(hud);
  assert.equal(hud.elapsedSeconds, hud.completionElapsedSeconds);
  assert.equal(hud.drillGrade, 'S');
  assert.equal(hud.drillGradeReason, '4 / 4 COURT SKILLS COMPLETE');
});

function completeDefaultChallengeAtFps(fps) {
  const session = createVolleyballPracticeSession();
  const hud = {};
  assert.equal(session.start(), true);
  for (let frame = 0; frame < fps * 480; frame++) {
    const phase = session.controller.state.phase;
    // Deliberately queue ahead: the session must consume only the current
    // expected action, proving the grade cannot be advanced by input spam.
    if (session.getQueueSize() === 0 && (phase === 'serve_setup' || phase === 'serve_ready')) {
      if (session.controller.state.score.servingTeam === VOLLEYBALL_TEAMS.HOME) {
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
      }
      for (let i = 0; i < 5; i++) {
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.RECEIVE), true);
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SET), true);
        assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SPIKE), true);
      }
      for (let i = 0; i < 5; i++) assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.BLOCK), true);
    }
    session.update(1 / fps);
    session.writeHudState(hud);
    if (hud.drillComplete) return hud;
  }
  assert.fail(`default challenge did not complete at ${fps} FPS`);
}

test('default buffered challenge completes with identical fixed-step record time at 30/60/144 FPS', () => {
  const baseline = completeDefaultChallengeAtFps(60);
  assert.equal(baseline.drillGrade, 'S');
  assert.equal(baseline.completionElapsedSeconds, baseline.elapsedSeconds);
  for (const fps of [30, 144]) {
    const result = completeDefaultChallengeAtFps(fps);
    assert.equal(result.drillGrade, baseline.drillGrade);
    assert.equal(result.completionElapsedSeconds, baseline.completionElapsedSeconds);
    assert.equal(result.drillAcceptedBlock, baseline.drillAcceptedBlock);
  }
});
