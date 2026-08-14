import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOLLEYBALL_CONFIG,
  VOLLEYBALL_CONTACTS,
  VOLLEYBALL_PHASES,
  VOLLEYBALL_TEAMS,
  computeVolleyballAimAssist,
  contactConsumesTeamHit,
  createVolleyballConfig,
  isOnOwnVolleyballHalf,
} from '../js/volleyball-rules.js';

test('volleyball declares the full deterministic phase machine', () => {
  assert.deepEqual(Object.values(VOLLEYBALL_PHASES), [
    'serve_setup', 'serve_ready', 'rally', 'dead_ball', 'point_awarded', 'match_end',
  ]);
});

test('own-half helper treats the center line as neutral for both teams', () => {
  const config = createVolleyballConfig({ centerLineTolerance: 0.04 });
  assert.equal(isOnOwnVolleyballHalf({ z: -3 }, VOLLEYBALL_TEAMS.HOME, config), true);
  assert.equal(isOnOwnVolleyballHalf({ z: 3 }, VOLLEYBALL_TEAMS.HOME, config), false);
  assert.equal(isOnOwnVolleyballHalf({ z: 0 }, VOLLEYBALL_TEAMS.HOME, config), true);
  assert.equal(isOnOwnVolleyballHalf({ z: 0 }, VOLLEYBALL_TEAMS.AWAY, config), true);
});

test('block does not consume an indoor team contact', () => {
  assert.equal(contactConsumesTeamHit(VOLLEYBALL_CONTACTS.BLOCK), false);
  assert.equal(contactConsumesTeamHit(VOLLEYBALL_CONTACTS.RECEIVE), true);
  assert.equal(contactConsumesTeamHit(VOLLEYBALL_CONTACTS.SET), true);
  assert.equal(contactConsumesTeamHit(VOLLEYBALL_CONTACTS.SPIKE), true);
});

test('pass assist locks only a reticle-near front teammate and is capped at 12 degrees', () => {
  const out = {};
  const result = computeVolleyballAimAssist({
    contactType: VOLLEYBALL_CONTACTS.PASS,
    playerId: 'self',
    origin: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: 1 },
    teammates: [
      { id: 'near', position: { x: Math.tan(10 * Math.PI / 180) * 10, y: 0, z: 10 } },
      { id: 'outside', position: { x: Math.tan(13 * Math.PI / 180) * 10, y: 0, z: 10 } },
      { id: 'rear', position: { x: 0, y: 0, z: -1 } },
    ],
  }, out);
  assert.equal(result, out);
  assert.ok(result.x > 0);
  assert.ok(result.z > 0);
  assert.ok(Math.atan2(result.x, result.z) * 180 / Math.PI < 12);
});

test('assist never rear-snaps and leaves aim unchanged without a reticle-near target', () => {
  const result = computeVolleyballAimAssist({
    contactType: VOLLEYBALL_CONTACTS.SET,
    playerId: 'self',
    origin: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: 1 },
    teammates: [{ id: 'rear', position: { x: 0, y: 0, z: -2 } }],
  });
  assert.deepEqual(result, { x: 0, y: 0, z: 1 });
});

test('casual spike assist is capped at 4 degrees and competitive spike assist is zero', () => {
  const teammate = { id: 'mate', position: { x: Math.tan(3 * Math.PI / 180) * 10, y: 0, z: 10 } };
  const base = {
    contactType: VOLLEYBALL_CONTACTS.SPIKE,
    playerId: 'self', origin: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: 1 }, teammates: [teammate],
  };
  assert.ok(computeVolleyballAimAssist(base).x > 0);
  assert.deepEqual(computeVolleyballAimAssist({ ...base, competitive: true }), { x: 0, y: 0, z: 1 });
});

test('competitive mode disables pass and set assist as well as spike assist', () => {
  const base = {
    playerId: 'self', competitive: true,
    origin: { x: 0, y: 0, z: 0 }, aimDirection: { x: 0, y: 0, z: 1 },
    teammates: [{ id: 'mate', position: { x: 1, y: 0, z: 10 } }],
  };
  for (const contactType of [VOLLEYBALL_CONTACTS.PASS, VOLLEYBALL_CONTACTS.SET, VOLLEYBALL_CONTACTS.SPIKE]) {
    assert.deepEqual(computeVolleyballAimAssist({ ...base, contactType }), { x: 0, y: 0, z: 1 });
  }
});

test('skin/cosmetic values cannot alter volleyball physics constants', () => {
  const config = createVolleyballConfig({ skin: 'legendary', cosmeticSpeed: 999, gravity: -22 });
  assert.equal(config.gravity, -22);
  assert.equal(config.ballRadius, DEFAULT_VOLLEYBALL_CONFIG.ballRadius);
  assert.equal('skin' in config, false);
  assert.equal('cosmeticSpeed' in config, false);
});
