import { createVolleyballController } from './volleyball-controller.js';
import {
  VOLLEYBALL_CONTACTS,
  VOLLEYBALL_PHASES,
  VOLLEYBALL_TEAMS,
} from './volleyball-rules.js';
import {
  applyVolleyballPracticeAction,
  createVolleyballContactScratch,
  writeVolleyballPracticeAction,
} from './volleyball-contact.js';

const DEFAULT_QUEUE_CAPACITY = 24;
const DEFAULT_CONTACT_COOLDOWN = 0.18;
const DEFAULT_ACTION_TTL = 8;
const HOME_ID = 'practice-player';
const FEEDER_ID = 'practice-feeder';

function boundedInteger(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function boundedNumber(value, min, max, fallback) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function createActionSlot() {
  return { type: VOLLEYBALL_CONTACTS.SERVE, aimX: 0, aimY: 0, aimZ: 0, sequence: 0 };
}

/**
 * Deterministic local-only Volleyball drill. The feeder is a fixed state
 * machine, not a dodgeball Bot: it has no perception, randomness, navigation,
 * combat state, rewards, inventory or networking.
 */
export function createVolleyballPracticeSession(options = {}) {
  const queueCapacity = boundedInteger(options.queueCapacity, 4, 64, DEFAULT_QUEUE_CAPACITY);
  const actionTtl = boundedNumber(options.actionTtlSeconds, 1, 30, DEFAULT_ACTION_TTL);
  const contactCooldown = boundedNumber(
    options.contactCooldownSeconds, 0.05, 0.5, DEFAULT_CONTACT_COOLDOWN,
  );
  const feederReturnPattern = Array.isArray(options.feederReturnPattern)
    && options.feederReturnPattern.length > 0
    ? options.feederReturnPattern.slice(0, 16).map((value) => boundedInteger(value, 0, 8, 0))
    : [0, 1, 0];
  const controllerOptions = {
    config: {
      ...options.config,
      courtHalfWidth: 9,
      courtHalfLength: 9,
      teamSize: 1,
      allowControlledSelfSetOneVsOne: true,
      deadBallHoldSeconds: options.config?.deadBallHoldSeconds ?? 0.8,
      pointAwardHoldSeconds: options.config?.pointAwardHoldSeconds ?? 1.8,
    },
    servingTeam: options.servingTeam,
  };

  let controller = createVolleyballController(controllerOptions);
  let accumulator = 0;
  let running = false;
  let disposed = false;
  let queueHead = 0;
  let queueTail = 0;
  let queueCount = 0;
  let nextPlayerSequence = 1;
  let nextFeederSequence = 1;
  let lastQueuedPlayerSequence = 0;
  let lastConsumedPlayerSequence = 0;
  let contactElapsed = 0;
  let lastCompletedRallyId = 0;
  let currentRallyReturnLimit = feederReturnPattern[0];
  let playerSpikesReturned = 0;
  const queue = Array.from({ length: queueCapacity }, createActionSlot);
  const queuedAt = new Float64Array(queueCapacity);
  const playerScratch = createVolleyballContactScratch();
  const feederScratch = createVolleyballContactScratch();
  const feederAction = createActionSlot();
  const consumedAction = createActionSlot();
  const feederAim = { x: 0, y: 0, z: -1 };
  const playerContext = { team: VOLLEYBALL_TEAMS.HOME, playerId: HOME_ID, origin: { x: 0, y: 0, z: 0 } };
  const feederContext = { team: VOLLEYBALL_TEAMS.AWAY, playerId: FEEDER_ID, origin: { x: 0, y: 0, z: 0 } };
  const state = {
    expectedAction: null,
    ralliesCompleted: 0,
    playerContacts: 0,
    feederContacts: 0,
    droppedActions: 0,
    running: false,
    disposed: false,
  };

  function clearQueue() {
    queueHead = 0;
    queueTail = 0;
    queueCount = 0;
  }

  function servingOrigin(team, out) {
    out.x = 0;
    out.y = controller.config.floorY + 1.7;
    out.z = team === VOLLEYBALL_TEAMS.HOME ? -6.5 : 6.5;
    return out;
  }

  function applyAction(action, context, scratch, isFeeder) {
    if (action.type === VOLLEYBALL_CONTACTS.SERVE) servingOrigin(context.team, context.origin);
    else {
      context.origin.x = controller.state.ball.x;
      context.origin.y = controller.state.ball.y;
      context.origin.z = controller.state.ball.z;
    }
    const result = applyVolleyballPracticeAction(controller, action, context, scratch);
    if (result.accepted) {
      contactElapsed = 0;
      if (isFeeder) state.feederContacts++;
      else state.playerContacts++;
    }
    return result.accepted;
  }

  function writeFeederAction(type) {
    feederAim.z = type === VOLLEYBALL_CONTACTS.RECEIVE || type === VOLLEYBALL_CONTACTS.SET ? 1 : -1;
    writeVolleyballPracticeAction(feederAction, type, feederAim, nextFeederSequence++);
    return feederAction;
  }

  function dropQueueHead() {
    queueHead = (queueHead + 1) % queueCapacity;
    queueCount--;
  }

  function takeQueuedAction(type) {
    let offset = -1;
    for (let i = 0; i < queueCount; i++) {
      if (queue[(queueHead + i) % queueCapacity].type === type) { offset = i; break; }
    }
    if (offset < 0) return null;
    const selected = (queueHead + offset) % queueCapacity;
    Object.assign(consumedAction, queue[selected]);
    for (let i = offset; i < queueCount - 1; i++) {
      const to = (queueHead + i) % queueCapacity;
      const from = (queueHead + i + 1) % queueCapacity;
      Object.assign(queue[to], queue[from]);
      queuedAt[to] = queuedAt[from];
    }
    queueTail = (queueTail - 1 + queueCapacity) % queueCapacity;
    queueCount--;
    return consumedAction;
  }

  function expireStaleAction() {
    while (queueCount > 0 && controller.state.simulationTime - queuedAt[queueHead] > actionTtl) {
      dropQueueHead();
      state.droppedActions++;
    }
  }

  function consumeExpectedPlayerAction(expected) {
    state.expectedAction = expected;
    expireStaleAction();
    const action = takeQueuedAction(expected);
    if (!action) return false;
    lastConsumedPlayerSequence = Math.max(lastConsumedPlayerSequence, action.sequence);
    if (!applyAction(action, playerContext, playerScratch, false)) {
      state.droppedActions++;
      return false;
    }
    return true;
  }

  function prepareCurrentServe() {
    if (controller.state.phase !== VOLLEYBALL_PHASES.SERVE_SETUP) return false;
    const team = controller.state.score.servingTeam;
    currentRallyReturnLimit = feederReturnPattern[controller.state.rallyId % feederReturnPattern.length];
    playerSpikesReturned = 0;
    return controller.prepareServe(team);
  }

  function processServeReady() {
    const servingTeam = controller.state.score.servingTeam;
    if (servingTeam === VOLLEYBALL_TEAMS.HOME) {
      consumeExpectedPlayerAction(VOLLEYBALL_CONTACTS.SERVE);
      return;
    }
    state.expectedAction = null;
    if (controller.state.phaseTime >= Math.max(contactCooldown, 1.1)) {
      applyAction(writeFeederAction(VOLLEYBALL_CONTACTS.SERVE), feederContext, feederScratch, true);
    }
  }

  function processFeederRally() {
    const ball = controller.state.ball;
    const lastType = controller.state.lastContactType;
    if (lastType === VOLLEYBALL_CONTACTS.SPIKE && playerSpikesReturned >= currentRallyReturnLimit) return;
    if (lastType === VOLLEYBALL_CONTACTS.SPIKE && ball.z >= 2.25 && contactElapsed >= contactCooldown) {
      playerSpikesReturned++;
      applyAction(writeFeederAction(VOLLEYBALL_CONTACTS.RECEIVE), feederContext, feederScratch, true);
      return;
    }
    if ((lastType === VOLLEYBALL_CONTACTS.SERVE || lastType === VOLLEYBALL_CONTACTS.BLOCK)
      && ball.z >= 2.25 && contactElapsed >= contactCooldown) {
      applyAction(writeFeederAction(VOLLEYBALL_CONTACTS.RECEIVE), feederContext, feederScratch, true);
    }
  }

  function processPlayerRally() {
    const ball = controller.state.ball;
    if (ball.vz < 0 && ball.z <= 0.9 && ball.z > -2.25 && contactElapsed >= contactCooldown) {
      if (!consumeExpectedPlayerAction(VOLLEYBALL_CONTACTS.BLOCK)) {
        state.expectedAction = VOLLEYBALL_CONTACTS.BLOCK;
      }
      return;
    }
    if (ball.vz < 0 && ball.z <= -2.25 && contactElapsed >= contactCooldown) {
      consumeExpectedPlayerAction(VOLLEYBALL_CONTACTS.RECEIVE);
    } else {
      state.expectedAction = ball.vz < 0 ? VOLLEYBALL_CONTACTS.RECEIVE : null;
    }
  }

  function processRally() {
    if (controller.state.possessionTeam === VOLLEYBALL_TEAMS.HOME) {
      const lastType = controller.state.lastContactType;
      if (lastType === VOLLEYBALL_CONTACTS.RECEIVE && contactElapsed >= contactCooldown) {
        consumeExpectedPlayerAction(VOLLEYBALL_CONTACTS.SET);
      } else if (lastType === VOLLEYBALL_CONTACTS.SET && contactElapsed >= contactCooldown) {
        consumeExpectedPlayerAction(VOLLEYBALL_CONTACTS.SPIKE);
      } else {
        processFeederRally();
      }
    }
    else if (controller.state.possessionTeam === VOLLEYBALL_TEAMS.AWAY) {
      const lastType = controller.state.lastContactType;
      if (lastType === VOLLEYBALL_CONTACTS.RECEIVE && contactElapsed >= contactCooldown) {
        state.expectedAction = null;
        applyAction(writeFeederAction(VOLLEYBALL_CONTACTS.SET), feederContext, feederScratch, true);
      } else if (lastType === VOLLEYBALL_CONTACTS.SET && contactElapsed >= contactCooldown) {
        state.expectedAction = VOLLEYBALL_CONTACTS.RECEIVE;
        applyAction(writeFeederAction(VOLLEYBALL_CONTACTS.SPIKE), feederContext, feederScratch, true);
      } else {
        processPlayerRally();
      }
    }
  }

  function observeRallyCompletion() {
    const awarded = controller.state.score.lastAwardedRallyId;
    if (awarded != null && awarded > lastCompletedRallyId) {
      lastCompletedRallyId = awarded;
      state.ralliesCompleted++;
    }
  }

  function fixedStep() {
    contactElapsed += controller.config.fixedStep;
    state.expectedAction = null;
    if (controller.state.phase === VOLLEYBALL_PHASES.SERVE_SETUP) prepareCurrentServe();
    if (controller.state.phase === VOLLEYBALL_PHASES.SERVE_READY) processServeReady();
    else if (controller.state.phase === VOLLEYBALL_PHASES.RALLY) processRally();
    controller.update(controller.config.fixedStep);
    observeRallyCompletion();
  }

  const session = {
    state,
    get controller() { return controller; },

    start() {
      if (disposed) return false;
      running = true;
      state.running = true;
      if (controller.state.phase === VOLLEYBALL_PHASES.SERVE_SETUP) prepareCurrentServe();
      if (controller.state.phase === VOLLEYBALL_PHASES.SERVE_READY
        && controller.state.score.servingTeam === VOLLEYBALL_TEAMS.HOME) {
        state.expectedAction = VOLLEYBALL_CONTACTS.SERVE;
      }
      return true;
    },

    stop() {
      running = false;
      state.running = false;
    },

    restart() {
      if (disposed) return false;
      controller = createVolleyballController(controllerOptions);
      accumulator = 0;
      contactElapsed = 0;
      lastCompletedRallyId = 0;
      currentRallyReturnLimit = feederReturnPattern[0];
      playerSpikesReturned = 0;
      nextPlayerSequence = 1;
      nextFeederSequence = 1;
      lastQueuedPlayerSequence = 0;
      lastConsumedPlayerSequence = 0;
      clearQueue();
      state.expectedAction = null;
      state.ralliesCompleted = 0;
      state.playerContacts = 0;
      state.feederContacts = 0;
      state.droppedActions = 0;
      return session.start();
    },

    queueAction(type, aimDirection = null, sequence = null) {
      if (disposed || queueCount >= queueCapacity) return false;
      if (type === VOLLEYBALL_CONTACTS.SERVE
        && controller.state.phase !== VOLLEYBALL_PHASES.SERVE_SETUP
        && controller.state.phase !== VOLLEYBALL_PHASES.SERVE_READY) return false;
      const ownedSequence = sequence == null ? nextPlayerSequence : sequence;
      if (!Number.isSafeInteger(ownedSequence) || ownedSequence < 1
        || ownedSequence <= lastQueuedPlayerSequence
        || ownedSequence <= lastConsumedPlayerSequence) return false;
      const slot = queue[queueTail];
      if (!writeVolleyballPracticeAction(slot, type, aimDirection, ownedSequence)) return false;
      lastQueuedPlayerSequence = ownedSequence;
      nextPlayerSequence = ownedSequence + 1;
      queuedAt[queueTail] = controller.state.simulationTime;
      queueTail = (queueTail + 1) % queueCapacity;
      queueCount++;
      return true;
    },

    update(deltaSeconds) {
      if (!running || disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
      accumulator += Math.min(deltaSeconds, controller.config.maxFrameDelta);
      let steps = 0;
      while (accumulator + 1e-12 >= controller.config.fixedStep) {
        fixedStep();
        accumulator -= controller.config.fixedStep;
        steps++;
      }
      return steps;
    },

    getQueueSize() { return queueCount; },

    getSnapshot() {
      return {
        controller: controller.getSnapshot(),
        expectedAction: state.expectedAction,
        ralliesCompleted: state.ralliesCompleted,
        playerContacts: state.playerContacts,
        feederContacts: state.feederContacts,
        droppedActions: state.droppedActions,
        queueSize: queueCount,
        running,
      };
    },

    writeHudState(out) {
      if (!out || typeof out !== 'object') return false;
      out.phase = controller.state.phase;
      out.expectedAction = state.expectedAction;
      out.homePoints = controller.state.score.points[0];
      out.awayPoints = controller.state.score.points[1];
      out.homeSets = controller.state.score.sets[0];
      out.awaySets = controller.state.score.sets[1];
      out.ralliesCompleted = state.ralliesCompleted;
      out.queueSize = queueCount;
      return true;
    },

    dispose() {
      if (disposed) return;
      running = false;
      disposed = true;
      clearQueue();
      state.running = false;
      state.disposed = true;
      state.expectedAction = null;
    },
  };

  return session;
}
