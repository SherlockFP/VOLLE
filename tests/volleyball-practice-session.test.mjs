import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createVolleyballPracticeSession } from '../js/volleyball-practice-session.js';
import { VOLLEYBALL_CONTACTS, VOLLEYBALL_PHASES } from '../js/volleyball-rules.js';

function queueThreeRallies(session) {
  for (let rally = 0; rally < 3; rally++) {
    for (const type of [
      VOLLEYBALL_CONTACTS.SERVE,
      VOLLEYBALL_CONTACTS.RECEIVE,
      VOLLEYBALL_CONTACTS.SET,
      VOLLEYBALL_CONTACTS.SPIKE,
    ]) assert.equal(session.queueAction(type), true);
  }
}

function runAtFps(fps, seconds = 8) {
  const session = createVolleyballPracticeSession({
    feederReturnPattern: [0],
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 },
  });
  queueThreeRallies(session);
  session.start();
  for (let i = 0; i < fps * seconds; i++) session.update(1 / fps);
  return session.getSnapshot();
}

test('scripted feeder completes three receive-set-spike rallies without Bot or rewards', () => {
  const snapshot = runAtFps(60);
  assert.equal(snapshot.ralliesCompleted, 3);
  assert.deepEqual(snapshot.controller.score.points, [3, 0]);
  assert.equal(snapshot.playerContacts, 12);
  assert.equal(snapshot.feederContacts, 9);
  assert.equal(snapshot.droppedActions, 0);
  assert.equal(snapshot.queueSize, 0);

  const source = fs.readFileSync(new URL('../js/volleyball-practice-session.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"].*bot\.js/i);
  assert.doesNotMatch(source, /from ['"].*(network|reward|inventory|store)/i);
});

test('session fixed step is equivalent at 30, 60, 120 and 144 render FPS', () => {
  const baseline = runAtFps(120);
  for (const fps of [30, 60, 144]) {
    const value = runAtFps(fps);
    assert.equal(value.controller.phase, baseline.controller.phase);
    assert.deepEqual(value.controller.score, baseline.controller.score);
    assert.equal(value.ralliesCompleted, baseline.ralliesCompleted);
    assert.equal(value.playerContacts, baseline.playerContacts);
    assert.equal(value.feederContacts, baseline.feederContacts);
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz']) {
      assert.ok(Math.abs(value.controller.ball[key] - baseline.controller.ball[key]) < 1e-9, `${fps} FPS ${key}`);
    }
  }
});

test('queue is bounded and lifecycle supports stop, restart and terminal dispose', () => {
  const session = createVolleyballPracticeSession({ queueCapacity: 4, feederReturnPattern: [0] });
  for (let i = 0; i < 4; i++) assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), false);
  assert.equal(session.start(), true);
  session.update(1 / 60);
  session.stop();
  const stoppedTime = session.controller.state.simulationTime;
  session.update(1);
  assert.equal(session.controller.state.simulationTime, stoppedTime);
  assert.equal(session.restart(), true);
  assert.equal(session.controller.state.phase, VOLLEYBALL_PHASES.SERVE_READY);
  assert.equal(session.getQueueSize(), 0);
  session.dispose();
  assert.equal(session.state.disposed, true);
  assert.equal(session.start(), false);
  assert.equal(session.restart(), false);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), false);
});

test('player action sequence rejects duplicate and out-of-order queue entries', () => {
  const session = createVolleyballPracticeSession();
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE, null, 7), true);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE, null, 7), false);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE, null, 3), false);
  assert.equal(session.getQueueSize(), 1);
});

test('mistimed buffered intent cannot block the next correct serve', () => {
  const session = createVolleyballPracticeSession({
    config: { deadBallHoldSeconds: 0.05, pointAwardHoldSeconds: 0.05 },
  });
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.RECEIVE), true);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  session.start();
  for (let i = 0; i < 30; i++) session.update(1 / 120);
  assert.equal(session.controller.state.phase, VOLLEYBALL_PHASES.RALLY);
  assert.equal(session.controller.state.lastContactType, VOLLEYBALL_CONTACTS.SERVE);
  assert.equal(session.state.droppedActions, 0);
  assert.equal(session.getQueueSize(), 1, 'early receive remains buffered for its contact window');
});

test('serve cannot be queued once the rally is active', () => {
  const session = createVolleyballPracticeSession();
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), true);
  session.start();
  for (let i = 0; i < 30 && session.controller.state.phase !== VOLLEYBALL_PHASES.RALLY; i++) {
    session.update(1 / 120);
  }
  assert.equal(session.controller.state.phase, VOLLEYBALL_PHASES.RALLY);
  assert.equal(session.queueAction(VOLLEYBALL_CONTACTS.SERVE), false);
});

test('queued block is consumed near the net and does not consume a team hit', () => {
  const session = createVolleyballPracticeSession({ feederReturnPattern: [4] });
  session.queueAction(VOLLEYBALL_CONTACTS.SERVE);
  session.queueAction(VOLLEYBALL_CONTACTS.BLOCK);
  session.start();
  let blocked = false;
  for (let i = 0; i < 600; i++) {
    session.update(1 / 120);
    if (session.controller.state.lastContactType === VOLLEYBALL_CONTACTS.BLOCK) {
      blocked = true;
      assert.equal(session.controller.state.teamContacts, 0);
      assert.ok(session.controller.state.ball.vz > 0);
      break;
    }
  }
  assert.equal(blocked, true);
});
