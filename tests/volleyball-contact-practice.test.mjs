import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolleyballController } from '../js/volleyball-controller.js';
import { VOLLEYBALL_CONTACTS, VOLLEYBALL_TEAMS } from '../js/volleyball-rules.js';
import {
  applyVolleyballPracticeAction,
  createVolleyballContactScratch,
  isVolleyballPracticeAction,
  writeVolleyballPracticeAction,
} from '../js/volleyball-contact.js';

function action(type, aim = { x: 0, y: 0, z: 1 }, sequence = 1) {
  const value = { type: 'serve', aimX: 0, aimY: 0, aimZ: 0, sequence: 0 };
  assert.equal(writeVolleyballPracticeAction(value, type, aim, sequence), true);
  return value;
}

test('practice actions use an exact intent-only schema', () => {
  const value = action(VOLLEYBALL_CONTACTS.SERVE);
  assert.equal(isVolleyballPracticeAction(value), true);
  assert.equal(isVolleyballPracticeAction({ ...value, damage: 100 }), false);
  assert.equal(isVolleyballPracticeAction({ ...value, homing: true }), false);
  assert.equal(isVolleyballPracticeAction({ ...value, skin: 'legendary' }), false);
  assert.equal(writeVolleyballPracticeAction(value, 'weapon', { x: 0, y: 0, z: 1 }, 2), false);
  assert.equal(writeVolleyballPracticeAction(value, VOLLEYBALL_CONTACTS.PASS, { x: 0, y: 0, z: 1 }, 2), false);
  assert.equal(isVolleyballPracticeAction({ ...value, type: VOLLEYBALL_CONTACTS.PASS }), false);
  assert.equal(writeVolleyballPracticeAction(value, VOLLEYBALL_CONTACTS.SERVE, { x: Infinity, y: 0, z: 1 }, 2), false);
  assert.equal(writeVolleyballPracticeAction(value, VOLLEYBALL_CONTACTS.SERVE, { x: 10001, y: 0, z: 1 }, 2), false);
});

test('serve intent prepares the rally and writes only the strict physical ball shape', () => {
  const controller = createVolleyballController({ config: { teamSize: 1, allowControlledSelfSetOneVsOne: true } });
  const result = applyVolleyballPracticeAction(
    controller,
    action(VOLLEYBALL_CONTACTS.SERVE),
    { team: VOLLEYBALL_TEAMS.HOME, playerId: 'p1', origin: { x: 0, y: 1.7, z: -6.5 } },
    createVolleyballContactScratch(),
  );
  assert.equal(result.accepted, true);
  assert.equal(controller.state.ballActive, true);
  assert.equal(controller.state.ball.z, -6.5);
  assert.ok(controller.state.ball.vz > 0);
  assert.deepEqual(Object.keys(controller.state.ball).sort(), ['radius', 'vx', 'vy', 'vz', 'x', 'y', 'z']);
});

test('malformed action is rejected without mutating controller state', () => {
  const controller = createVolleyballController();
  const before = controller.getSnapshot();
  const invalid = { ...action(VOLLEYBALL_CONTACTS.SERVE), cosmetic: 'paid' };
  assert.equal(applyVolleyballPracticeAction(
    controller, invalid, { team: VOLLEYBALL_TEAMS.HOME, playerId: 'p1' }, createVolleyballContactScratch(),
  ).accepted, false);
  assert.deepEqual(controller.getSnapshot(), before);
});

test('out-of-bounds origin is rejected atomically before serve preparation or contact', () => {
  const controller = createVolleyballController();
  const before = controller.getSnapshot();
  const result = applyVolleyballPracticeAction(
    controller,
    action(VOLLEYBALL_CONTACTS.SERVE),
    { team: VOLLEYBALL_TEAMS.HOME, playerId: 'p1', origin: { x: 10001, y: 1.7, z: -6.5 } },
    createVolleyballContactScratch(),
  );
  assert.equal(result.accepted, false);
  assert.deepEqual(controller.getSnapshot(), before);
});

test('serve intent cannot be replayed during an active rally', () => {
  const controller = createVolleyballController({ config: { teamSize: 1, allowControlledSelfSetOneVsOne: true } });
  assert.equal(applyVolleyballPracticeAction(
    controller,
    action(VOLLEYBALL_CONTACTS.SERVE, { x: 0, y: 0, z: 1 }, 1),
    { team: VOLLEYBALL_TEAMS.HOME, playerId: 'p1' },
    createVolleyballContactScratch(),
  ).accepted, true);
  const before = controller.getSnapshot();
  assert.equal(applyVolleyballPracticeAction(
    controller,
    action(VOLLEYBALL_CONTACTS.SERVE, { x: 0, y: 0, z: 1 }, 2),
    { team: VOLLEYBALL_TEAMS.HOME, playerId: 'p1' },
    createVolleyballContactScratch(),
  ).accepted, false);
  assert.deepEqual(controller.getSnapshot(), before);
});

test('block reverses the incoming horizontal direction and remains a free contact', () => {
  const controller = createVolleyballController({ config: { teamSize: 1, allowControlledSelfSetOneVsOne: true } });
  applyVolleyballPracticeAction(
    controller, action(VOLLEYBALL_CONTACTS.SERVE),
    { team: VOLLEYBALL_TEAMS.HOME, playerId: 'home' }, createVolleyballContactScratch(),
  );
  controller.setBall({ x: 0, y: 3, z: -0.5, vx: 2, vy: -1, vz: -12, radius: 0.34 });
  const result = applyVolleyballPracticeAction(
    controller, action(VOLLEYBALL_CONTACTS.BLOCK),
    { team: VOLLEYBALL_TEAMS.AWAY, playerId: 'away' }, createVolleyballContactScratch(),
  );
  assert.equal(result.accepted, true);
  assert.equal(controller.state.teamContacts, 0);
  assert.ok(controller.state.ball.vz > 0);
});
