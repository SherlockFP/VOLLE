import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createVolleyballPracticeSession } from '../js/volleyball-practice-session.js';
import { createVolleyballPracticeRuntime } from '../js/volleyball-practice-runtime.js';
import { VOLLEYBALL_CONTACTS, VOLLEYBALL_PHASES, VOLLEYBALL_TEAMS } from '../js/volleyball-rules.js';

function queueCurrentRally(session, feederReturns) {
  const state = session.controller.state;
  if ((state.phase !== VOLLEYBALL_PHASES.SERVE_SETUP && state.phase !== VOLLEYBALL_PHASES.SERVE_READY)
    || session.getQueueSize() !== 0) return;
  if (state.score.servingTeam === VOLLEYBALL_TEAMS.HOME) {
    assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  }
  for (let i = 0; i <= feederReturns; i++) {
    assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.RECEIVE), true);
    assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SET), true);
    assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SPIKE), true);
  }
}

function runThirtyRallyPlaytest(fps) {
  const session = createVolleyballPracticeSession({
    feederReturnPattern: [4],
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 },
  });
  const observedContacts = new Set();
  queueCurrentRally(session, 4);
  assert.equal(session.start(), true);
  for (let frame = 0; frame < fps * 360 && session.state.ralliesCompleted < 30; frame++) {
    queueCurrentRally(session, 4);
    session.update(1 / fps);
    observedContacts.add(session.controller.state.lastContactType);
  }
  const snapshot = session.getSnapshot();
  return {
    phase: snapshot.controller.phase,
    score: snapshot.controller.score.points,
    ralliesCompleted: snapshot.ralliesCompleted,
    playerContacts: snapshot.playerContacts,
    feederContacts: snapshot.feederContacts,
    droppedActions: snapshot.droppedActions,
    queueSize: snapshot.queueSize,
    observedContacts,
  };
}

test('30-rally local practice playtest completes receive-set-spike exchanges at 30/60/144 FPS', () => {
  const baseline = runThirtyRallyPlaytest(60);
  assert.equal(baseline.ralliesCompleted, 30);
  assert.equal(baseline.droppedActions, 0);
  assert.equal(baseline.queueSize, 0);
  for (const type of [
    VOLLEYBALL_CONTACTS.SERVE,
    VOLLEYBALL_CONTACTS.RECEIVE,
    VOLLEYBALL_CONTACTS.SET,
    VOLLEYBALL_CONTACTS.SPIKE,
  ]) assert.equal(baseline.observedContacts.has(type), true, `${type} must occur in the playable drill`);

  for (const fps of [30, 144]) {
    const value = runThirtyRallyPlaytest(fps);
    assert.equal(value.ralliesCompleted, baseline.ralliesCompleted);
    assert.deepEqual(value.score, baseline.score);
    assert.equal(value.playerContacts, baseline.playerContacts);
    assert.equal(value.feederContacts, baseline.feederContacts);
    assert.equal(value.droppedActions, 0);
    assert.equal(value.queueSize, 0);
  }
});

test('buffered block, failed receive, and restart do not leave the drill softlocked', () => {
  const session = createVolleyballPracticeSession({
    feederReturnPattern: [4],
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 },
  });
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.BLOCK), true);
  assert.equal(session.start(), true);
  let blocked = false;
  for (let i = 0; i < 600; i++) {
    session.update(1 / 120);
    if (session.controller.state.lastContactType === VOLLEYBALL_CONTACTS.BLOCK) {
      blocked = true;
      break;
    }
  }
  assert.equal(blocked, true);

  const failed = createVolleyballPracticeSession({
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 },
  });
  assert.equal(failed.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  assert.equal(failed.start(), true);
  for (let i = 0; i < 900 && failed.state.ralliesCompleted === 0; i++) failed.update(1 / 120);
  assert.equal(failed.state.ralliesCompleted, 1, 'a missed receive awards the rally rather than stalling the ball');
  assert.equal(failed.restart(), true);
  assert.equal(failed.controller.state.phase, VOLLEYBALL_PHASES.SERVE_READY);
  assert.equal(failed.getQueueSize(), 0);
  assert.equal(failed.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
});

test('Volleyball keyboard controls ignore text-editing targets', () => {
  const runtime = createVolleyballPracticeRuntime();
  assert.equal(runtime.mount({ scene: new THREE.Group() }), true);
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { isContentEditable: true },
  ]) {
    const event = {
      type: 'keydown', code: 'KeyE', target, repeat: false, prevented: false,
      preventDefault() { this.prevented = true; },
    };
    assert.equal(runtime.captureInput(event), false);
    assert.equal(event.prevented, false);
  }
  assert.equal(runtime.session.getQueueSize(), 0);
  runtime.dispose();
});
