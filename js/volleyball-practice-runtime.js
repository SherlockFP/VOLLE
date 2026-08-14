import * as THREE from '../vendor/three/three.module.js';
import { VOLLEYBALL_CONTACTS } from './volleyball-rules.js';
import { createVolleyballPracticeSession } from './volleyball-practice-session.js';

export const VOLLEYBALL_PRACTICE_INPUT_BINDINGS = Object.freeze({
  primary: Object.freeze({ pointerButton: 0, codes: Object.freeze(['KeyE']) }),
  secondary: Object.freeze({ pointerButton: 2, codes: Object.freeze(['KeyQ']) }),
  receive: Object.freeze({ codes: Object.freeze(['KeyR']) }),
  spike: Object.freeze({ codes: Object.freeze(['KeyF']) }),
  block: Object.freeze({ codes: Object.freeze(['KeyB']) }),
  restart: Object.freeze({ codes: Object.freeze(['KeyT']) }),
});

function expectedPrimary(expected) {
  return expected === VOLLEYBALL_CONTACTS.SERVE
    || expected === VOLLEYBALL_CONTACTS.RECEIVE
    || expected === VOLLEYBALL_CONTACTS.SPIKE ? expected : null;
}

function expectedSecondary(expected) {
  return expected === VOLLEYBALL_CONTACTS.SET || expected === VOLLEYBALL_CONTACTS.BLOCK
    ? expected : null;
}

function actionForInput(event, expected) {
  if (event?.type === 'pointerdown') {
    if (event.button === VOLLEYBALL_PRACTICE_INPUT_BINDINGS.primary.pointerButton) return expectedPrimary(expected);
    if (event.button === VOLLEYBALL_PRACTICE_INPUT_BINDINGS.secondary.pointerButton) return expectedSecondary(expected);
    return null;
  }
  const code = event?.code;
  if (code === 'KeyE') return expectedPrimary(expected);
  // Q is the dedicated set key; RMB remains the contextual set/block input.
  if (code === 'KeyQ') return VOLLEYBALL_CONTACTS.SET;
  // Dedicated keys may be buffered before the short physical contact window.
  // The session remains authoritative about when each action is consumed.
  if (code === 'KeyR') return VOLLEYBALL_CONTACTS.RECEIVE;
  if (code === 'KeyF') return VOLLEYBALL_CONTACTS.SPIKE;
  if (code === 'KeyB') return VOLLEYBALL_CONTACTS.BLOCK;
  return null;
}

function createCourt(resources, config) {
  const group = new THREE.Group();
  group.name = 'VolleyballPracticeCourt';

  const floorGeometry = new THREE.PlaneGeometry(config.courtHalfWidth * 2, config.courtHalfLength * 2);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x159a8c, roughness: 0.82, metalness: 0 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'VolleyballPracticeFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = config.floorY;
  floor.receiveShadow = true;
  group.add(floor);
  resources.geometries.push(floorGeometry);
  resources.materials.push(floorMaterial);

  const lineGeometry = new THREE.BufferGeometry();
  const w = config.courtHalfWidth;
  const l = config.courtHalfLength;
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -w, config.floorY + 0.012, -l, w, config.floorY + 0.012, -l,
    w, config.floorY + 0.012, -l, w, config.floorY + 0.012, l,
    w, config.floorY + 0.012, l, -w, config.floorY + 0.012, l,
    -w, config.floorY + 0.012, l, -w, config.floorY + 0.012, -l,
    -w, config.floorY + 0.014, 0, w, config.floorY + 0.014, 0,
  ], 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf7f4dd });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.name = 'VolleyballPracticeLines';
  group.add(lines);
  resources.geometries.push(lineGeometry);
  resources.materials.push(lineMaterial);

  const netGeometry = new THREE.BoxGeometry(
    config.netHalfWidth * 2,
    config.netHeight,
    config.netThickness,
  );
  const netMaterial = new THREE.MeshBasicMaterial({ color: 0xe7fbff, transparent: true, opacity: 0.58, wireframe: true });
  const net = new THREE.Mesh(netGeometry, netMaterial);
  net.name = 'VolleyballPracticeNet';
  net.position.set(0, config.floorY + config.netHeight * 0.5, config.centerLine);
  group.add(net);
  resources.geometries.push(netGeometry);
  resources.materials.push(netMaterial);

  return group;
}

/** Scene/HUD adapter for the isolated local practice session. No App wiring or renderer ownership. */
export function createVolleyballPracticeRuntime(options = {}) {
  const session = createVolleyballPracticeSession(options.session);
  const resources = { geometries: [], materials: [] };
  const hudState = {
    phase: 'serve_setup', expectedAction: null,
    homePoints: 0, awayPoints: 0, homeSets: 0, awaySets: 0,
    ralliesCompleted: 0, queueSize: 0,
  };
  let group = null;
  let ballMesh = null;
  let scene = null;
  let hudAdapter = null;
  let inputTarget = null;
  let aimProvider = null;
  let mounted = false;
  let disposed = false;
  let hudElapsed = 0;

  function readAim(event) {
    const aim = typeof aimProvider === 'function' ? aimProvider(event) : null;
    return aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) && Number.isFinite(aim.z) ? aim : null;
  }

  function captureInput(event) {
    if (!mounted || disposed || event?.repeat === true) return false;
    if (event?.type === 'keydown' && event.code === 'KeyT') {
      event.preventDefault?.();
      return runtime.restart();
    }
    const action = actionForInput(event, session.state.expectedAction);
    if (!action) return false;
    const queued = session.queueAction(action, readAim(event));
    if (queued) event.preventDefault?.();
    return queued;
  }

  function suppressContextMenu(event) {
    if (mounted && !disposed) event.preventDefault?.();
  }

  function syncPresentation(deltaSeconds) {
    const ball = session.controller.state.ball;
    ballMesh.position.set(ball.x, ball.y, ball.z);
    ballMesh.visible = session.controller.state.ballActive;
    hudElapsed += deltaSeconds;
    if (hudElapsed >= 0.1) {
      hudElapsed %= 0.1;
      session.writeHudState(hudState);
      hudAdapter?.update?.(hudState);
    }
  }

  const runtime = {
    session,
    inputBindings: VOLLEYBALL_PRACTICE_INPUT_BINDINGS,
    get group() { return group; },
    get mounted() { return mounted; },
    get disposed() { return disposed; },

    mount(mountOptions = {}) {
      if (mounted || disposed || !mountOptions.scene?.add || !mountOptions.scene?.remove) return false;
      scene = mountOptions.scene;
      hudAdapter = mountOptions.hudAdapter || null;
      inputTarget = mountOptions.inputTarget || null;
      aimProvider = mountOptions.aimProvider || null;
      group = createCourt(resources, session.controller.config);

      const ballGeometry = new THREE.SphereGeometry(session.controller.config.ballRadius, 24, 16);
      const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf45, roughness: 0.48, metalness: 0.02 });
      ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
      ballMesh.name = 'VolleyballPracticeBall';
      ballMesh.castShadow = true;
      group.add(ballMesh);
      resources.geometries.push(ballGeometry);
      resources.materials.push(ballMaterial);

      scene.add(group);
      inputTarget?.addEventListener?.('keydown', captureInput);
      inputTarget?.addEventListener?.('pointerdown', captureInput);
      inputTarget?.addEventListener?.('contextmenu', suppressContextMenu);
      mounted = true;
      session.start();
      session.writeHudState(hudState);
      hudAdapter?.mount?.(runtime, hudState);
      syncPresentation(0);
      return true;
    },

    captureInput,

    queueAction(type, aimDirection = null) {
      if (!mounted || disposed) return false;
      return session.queueAction(type, aimDirection);
    },

    update(deltaSeconds) {
      if (!mounted || disposed) return 0;
      const steps = session.update(deltaSeconds);
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) syncPresentation(deltaSeconds);
      return steps;
    },

    restart() {
      if (!mounted || disposed) return false;
      const restarted = session.restart();
      if (restarted) {
        hudElapsed = 0;
        session.writeHudState(hudState);
        hudAdapter?.update?.(hudState);
        syncPresentation(0);
      }
      return restarted;
    },

    dispose() {
      if (disposed) return;
      inputTarget?.removeEventListener?.('keydown', captureInput);
      inputTarget?.removeEventListener?.('pointerdown', captureInput);
      inputTarget?.removeEventListener?.('contextmenu', suppressContextMenu);
      if (group && scene) scene.remove(group);
      hudAdapter?.dispose?.();
      session.dispose();
      for (let i = 0; i < resources.geometries.length; i++) resources.geometries[i].dispose();
      for (let i = 0; i < resources.materials.length; i++) resources.materials[i].dispose();
      resources.geometries.length = 0;
      resources.materials.length = 0;
      inputTarget = null;
      aimProvider = null;
      hudAdapter = null;
      scene = null;
      ballMesh = null;
      mounted = false;
      disposed = true;
    },
  };

  return runtime;
}
