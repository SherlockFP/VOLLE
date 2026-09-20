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

function isTextEditingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return true;
  const tagName = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : '';
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function createCourt(resources, config) {
  const group = new THREE.Group();
  group.name = 'VolleyballPracticeCourt';
  // This is visual-only. The deterministic rules continue to collide at floorY;
  // lifting the overlay avoids z-fighting with the host arena's court markings.
  const surfaceY = config.floorY + 0.035;

  const floorGeometry = new THREE.PlaneGeometry(config.courtHalfWidth * 2, config.courtHalfLength * 2);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x159a8c, roughness: 0.82, metalness: 0 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.name = 'VolleyballPracticeFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = surfaceY;
  floor.receiveShadow = true;
  group.add(floor);
  resources.geometries.push(floorGeometry);
  resources.materials.push(floorMaterial);

  const lineGeometry = new THREE.BufferGeometry();
  const w = config.courtHalfWidth;
  const l = config.courtHalfLength;
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -w, surfaceY + 0.012, -l, w, surfaceY + 0.012, -l,
    w, surfaceY + 0.012, -l, w, surfaceY + 0.012, l,
    w, surfaceY + 0.012, l, -w, surfaceY + 0.012, l,
    -w, surfaceY + 0.012, l, -w, surfaceY + 0.012, -l,
    -w, surfaceY + 0.014, 0, w, surfaceY + 0.014, 0,
    -w, surfaceY + 0.012, -3, w, surfaceY + 0.012, -3,
    -w, surfaceY + 0.012, 3, w, surfaceY + 0.012, 3,
  ], 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xf7f4dd });
  const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
  lines.name = 'VolleyballPracticeLines';
  group.add(lines);
  resources.geometries.push(lineGeometry);
  resources.materials.push(lineMaterial);

  // A real net reads better than a wireframe box, while keeping the whole court
  // to one line draw call plus the tape and two posts.
  const net = new THREE.Group();
  net.name = 'VolleyballPracticeNet';
  const netVertices = [];
  const netBottom = surfaceY + 0.14;
  const netTop = surfaceY + config.netHeight - 0.10;
  const columns = 18;
  const rows = 8;
  for (let column = 0; column <= columns; column++) {
    const x = -config.netHalfWidth + (config.netHalfWidth * 2 * column) / columns;
    netVertices.push(x, netBottom, config.centerLine, x, netTop, config.centerLine);
  }
  for (let row = 0; row <= rows; row++) {
    const y = netBottom + ((netTop - netBottom) * row) / rows;
    netVertices.push(-config.netHalfWidth, y, config.centerLine, config.netHalfWidth, y, config.centerLine);
  }
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netVertices, 3));
  const netMaterial = new THREE.LineBasicMaterial({ color: 0xdaf6ff, transparent: true, opacity: 0.72 });
  const netGrid = new THREE.LineSegments(netGeometry, netMaterial);
  netGrid.name = 'VolleyballPracticeNetGrid';
  net.add(netGrid);
  resources.geometries.push(netGeometry);
  resources.materials.push(netMaterial);

  const tapeGeometry = new THREE.BoxGeometry(config.netHalfWidth * 2 + 0.24, 0.13, config.netThickness * 1.8);
  const tapeMaterial = new THREE.MeshStandardMaterial({ color: 0xfff4cc, roughness: 0.55, metalness: 0.04 });
  const tape = new THREE.Mesh(tapeGeometry, tapeMaterial);
  tape.name = 'VolleyballPracticeNetTape';
  tape.position.set(0, surfaceY + config.netHeight, config.centerLine);
  net.add(tape);
  resources.geometries.push(tapeGeometry);
  resources.materials.push(tapeMaterial);

  const postGeometry = new THREE.CylinderGeometry(0.105, 0.13, config.netHeight + 0.42, 10);
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x183954, roughness: 0.42, metalness: 0.28 });
  for (const x of [-config.netHalfWidth, config.netHalfWidth]) {
    const post = new THREE.Mesh(postGeometry, postMaterial);
    post.name = 'VolleyballPracticeNetPost';
    post.position.set(x, surfaceY + (config.netHeight + 0.42) * 0.5, config.centerLine);
    post.castShadow = true;
    net.add(post);
  }
  resources.geometries.push(postGeometry);
  resources.materials.push(postMaterial);
  group.add(net);

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
  let landingMarker = null;
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
    if (event?.type === 'keydown' && isTextEditingTarget(event.target)) return false;
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
    landingMarker.position.set(ball.x, session.controller.config.floorY + 0.043, ball.z);
    landingMarker.visible = session.controller.state.ballActive;
    if (landingMarker.visible) {
      const height = Math.max(0, ball.y - session.controller.config.floorY);
      const markerScale = Math.min(1.45, 0.58 + height * 0.13);
      landingMarker.scale.setScalar(markerScale);
    }
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

      ballMesh = new THREE.Group();
      ballMesh.name = 'VolleyballPracticeBall';
      const ballRadius = session.controller.config.ballRadius;
      const ballGeometry = new THREE.SphereGeometry(ballRadius, 24, 16);
      const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xfff7dc, roughness: 0.43, metalness: 0.02 });
      const ballCore = new THREE.Mesh(ballGeometry, ballMaterial);
      ballCore.name = 'VolleyballPracticeBallCore';
      ballCore.castShadow = true;
      ballMesh.add(ballCore);
      group.add(ballMesh);
      resources.geometries.push(ballGeometry);
      resources.materials.push(ballMaterial);

      // Keep the narrow colored seams just proud of the sphere: an inset torus
      // disappears behind the white shell from every camera angle.
      const stripeGeometry = new THREE.TorusGeometry(ballRadius * 0.99, ballRadius * 0.025, 6, 24);
      const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xffb52f, roughness: 0.38, metalness: 0.04 });
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
        stripe.name = 'VolleyballPracticeBallStripe';
        stripe.rotation.set(i === 2 ? Math.PI * 0.5 : 0, i === 1 ? Math.PI * 0.5 : 0, 0);
        ballMesh.add(stripe);
      }
      resources.geometries.push(stripeGeometry);
      resources.materials.push(stripeMaterial);

      const markerGeometry = new THREE.RingGeometry(ballRadius * 0.72, ballRadius * 0.96, 28);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd052, transparent: true, opacity: 0.82, side: THREE.DoubleSide });
      landingMarker = new THREE.Mesh(markerGeometry, markerMaterial);
      landingMarker.name = 'VolleyballPracticeLandingMarker';
      landingMarker.rotation.x = -Math.PI * 0.5;
      landingMarker.renderOrder = 1;
      landingMarker.visible = false;
      group.add(landingMarker);
      resources.geometries.push(markerGeometry);
      resources.materials.push(markerMaterial);

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
      landingMarker = null;
      mounted = false;
      disposed = true;
    },
  };

  return runtime;
}
