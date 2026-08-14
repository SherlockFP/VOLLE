import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVolleyballLanding, isVolleyballLandingInBounds, sweepVolleyballFloor, sweepVolleyballNet } from '../js/volleyball-physics.js';

test('swept floor test catches a high-speed ball without tunneling', () => {
  const hit = sweepVolleyballFloor({ x: 1, y: 20, z: 2 }, { x: 2, y: -20, z: 4 }, 0.34, 0);
  assert.equal(hit.hit, true);
  assert.ok(hit.t > 0 && hit.t < 1);
  assert.equal(hit.y, 0.34);
  assert.ok(hit.x > 1 && hit.x < 2);
});

test('swept net test catches a high-speed crossing without tunneling', () => {
  const hit = sweepVolleyballNet(
    { x: 0, y: 2, z: -30 }, { x: 0, y: 2, z: 30 }, 0.34,
    { centerLine: 0, netHeight: 2.43, netHalfWidth: 9.5, netThickness: 0.08 },
  );
  assert.equal(hit.hit, true);
  assert.ok(hit.t > 0 && hit.t < 1);
  assert.ok(Math.abs(hit.z) <= 0.39);
});

test('ball crossing above or outside the finite net does not collide', () => {
  assert.equal(sweepVolleyballNet(
    { x: 0, y: 4, z: -10 }, { x: 0, y: 4, z: 10 }, 0.34,
    { netHeight: 2.43, netHalfWidth: 9.5 },
  ).hit, false);
  assert.equal(sweepVolleyballNet(
    { x: 15, y: 2, z: -10 }, { x: 15, y: 2, z: 10 }, 0.34,
    { netHeight: 2.43, netHalfWidth: 9.5 },
  ).hit, false);
});

test('line contact is in while a fully separated footprint is out', () => {
  assert.equal(isVolleyballLandingInBounds({ x: 9.34, z: 0 }, 0.34, 9, 9), true);
  assert.equal(isVolleyballLandingInBounds({ x: 9.3401, z: 0 }, 0.34, 9, 9), false);
  assert.equal(isVolleyballLandingInBounds({ x: 0, z: -9.34 }, 0.34, 9, 9), true);
  assert.equal(classifyVolleyballLanding({ x: 9.34, z: 0 }, 0.34, 9, 9), 'line_in');
  assert.equal(classifyVolleyballLanding({ x: 8, z: 0 }, 0.34, 9, 9), 'in');
  assert.equal(classifyVolleyballLanding({ x: 10, z: 0 }, 0.34, 9, 9), 'out');
});
