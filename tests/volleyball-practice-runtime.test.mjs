import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createVolleyballPracticeRuntime } from '../js/volleyball-practice-runtime.js';

function inputTargetSpy() {
  const handlers = new Map();
  return {
    added: 0,
    removed: 0,
    addEventListener(type, handler) { handlers.set(type, handler); this.added++; },
    removeEventListener(type, handler) {
      if (handlers.get(type) === handler) handlers.delete(type);
      this.removed++;
    },
    dispatch(type, event) { handlers.get(type)?.(event); },
    listenerCount() { return handlers.size; },
  };
}

test('runtime installs no input before mount and creates an exact 18x18 court on mount', () => {
  const input = inputTargetSpy();
  const scene = new THREE.Group();
  const runtime = createVolleyballPracticeRuntime({ session: { config: { courtHalfWidth: 30, courtHalfLength: 4 } } });
  assert.equal(input.added, 0);
  assert.equal(runtime.group, null);
  assert.equal(runtime.mount({ scene, inputTarget: input }), true);
  assert.equal(input.listenerCount(), 3);
  assert.equal(scene.children.includes(runtime.group), true);
  const floor = runtime.group.getObjectByName('VolleyballPracticeFloor');
  assert.equal(floor.geometry.parameters.width, 18);
  assert.equal(floor.geometry.parameters.height, 18);
  assert.equal(runtime.group.getObjectByName('VolleyballPracticeBall') != null, true);
  runtime.dispose();
});

test('runtime exposes context input, stable HUD updates, restart and complete disposal', () => {
  const input = inputTargetSpy();
  const scene = new THREE.Group();
  const hudRefs = [];
  let hudDisposed = 0;
  const runtime = createVolleyballPracticeRuntime();
  assert.equal(runtime.mount({
    scene,
    inputTarget: input,
    hudAdapter: {
      mount(_runtime, state) { hudRefs.push(state); },
      update(state) { hudRefs.push(state); },
      dispose() { hudDisposed++; },
    },
  }), true);
  runtime.update(1 / 60);
  const event = { type: 'keydown', code: 'KeyE', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('keydown', event);
  assert.equal(event.prevented, true);
  assert.equal(runtime.session.getQueueSize(), 1);
  for (let i = 0; i < 20; i++) runtime.update(1 / 60);
  assert.ok(hudRefs.length >= 2);
  assert.equal(hudRefs.every((value) => value === hudRefs[0]), true);
  assert.equal(runtime.restart(), true);

  const group = runtime.group;
  const floor = group.getObjectByName('VolleyballPracticeFloor');
  let geometryDisposed = 0;
  floor.geometry.addEventListener('dispose', () => geometryDisposed++);
  runtime.dispose();
  assert.equal(scene.children.includes(group), false);
  assert.equal(input.listenerCount(), 0);
  assert.equal(hudDisposed, 1);
  assert.equal(geometryDisposed, 1);
  assert.equal(runtime.disposed, true);
  assert.equal(runtime.mount({ scene, inputTarget: input }), false);
  assert.equal(runtime.update(1), 0);
});

test('Space remains reserved for jump while RMB, Q and optional B own secondary contacts', () => {
  const input = inputTargetSpy();
  const scene = new THREE.Group();
  const runtime = createVolleyballPracticeRuntime();
  assert.equal(runtime.mount({ scene, inputTarget: input }), true);
  runtime.session.state.expectedAction = 'block';

  const space = { type: 'keydown', code: 'Space', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('keydown', space);
  assert.equal(space.prevented, false);
  assert.equal(runtime.session.getQueueSize(), 0);

  const secondary = { type: 'pointerdown', button: 2, repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('pointerdown', secondary);
  assert.equal(secondary.prevented, true);

  const setOrBlock = { type: 'keydown', code: 'KeyQ', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('keydown', setOrBlock);
  assert.equal(setOrBlock.prevented, true);

  const block = { type: 'keydown', code: 'KeyB', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('keydown', block);
  assert.equal(block.prevented, true);
  assert.equal(runtime.session.getQueueSize(), 3);
  runtime.dispose();
});

test('dedicated receive input buffers before the physical contact window', () => {
  const input = inputTargetSpy();
  const runtime = createVolleyballPracticeRuntime();
  assert.equal(runtime.mount({ scene: new THREE.Group(), inputTarget: input }), true);
  const earlyReceive = { type: 'keydown', code: 'KeyR', repeat: false, prevented: false, preventDefault() { this.prevented = true; } };
  input.dispatch('keydown', earlyReceive);
  assert.equal(earlyReceive.prevented, true);
  assert.equal(runtime.session.getQueueSize(), 1);
  runtime.dispose();
});
