import {
  VOLLEYBALL_CONTACTS,
  VOLLEYBALL_FAULTS,
  VOLLEYBALL_PHASES,
  VOLLEYBALL_TEAMS,
  contactConsumesTeamHit,
  createVolleyballConfig,
  isOnOwnVolleyballHalf,
  isVolleyballContact,
  isVolleyballFault,
  isVolleyballPhase,
  isVolleyballTeam,
  oppositeVolleyballTeam,
} from './volleyball-rules.js';
import { classifyVolleyballLanding, integrateVolleyballBall, resolveVolleyballNetRebound, sweepVolleyballFloor, sweepVolleyballNet } from './volleyball-physics.js';
import { awardVolleyballRally, createVolleyballScoreState, isValidVolleyballScoreSnapshot } from './volleyball-score.js';

const SNAPSHOT_VERSION = 1;
const BALL_KEYS = Object.freeze(['x', 'y', 'z', 'vx', 'vy', 'vz', 'radius']);
const SNAPSHOT_KEYS = Object.freeze([
  'version', 'phase', 'phaseTime', 'simulationTime', 'rallyId', 'possessionTeam',
  'teamContacts', 'lastContactPlayerId', 'lastContactType', 'controlledSelfSetUsed',
  'pendingFault', 'pendingFaultTeam', 'ballActive', 'ball', 'score',
]);
const SCORE_KEYS = Object.freeze([
  'points', 'sets', 'completedSets', 'servingTeam', 'setOpeningTeam', 'rotations',
  'lastAwardedRallyId', 'matchWinner',
]);

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function finiteBall(ball) {
  return hasExactKeys(ball, BALL_KEYS)
    && BALL_KEYS.every((key) => Number.isFinite(ball[key]))
    && Math.abs(ball.x) <= 10000 && Math.abs(ball.y) <= 10000 && Math.abs(ball.z) <= 10000
    && Math.abs(ball.vx) <= 10000 && Math.abs(ball.vy) <= 10000 && Math.abs(ball.vz) <= 10000
    && ball.radius > 0 && ball.radius <= 2;
}

function validPlayerId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80;
}

export function createVolleyballController(options = {}) {
  const config = createVolleyballConfig(options.config);
  const state = {
    phase: VOLLEYBALL_PHASES.SERVE_SETUP,
    phaseTime: 0,
    simulationTime: 0,
    rallyId: 0,
    possessionTeam: null,
    teamContacts: 0,
    lastContactPlayerId: null,
    lastContactType: null,
    controlledSelfSetUsed: false,
    pendingFault: null,
    pendingFaultTeam: null,
    ballActive: false,
    ball: { x: 0, y: config.floorY + 1.2, z: -4, vx: 0, vy: 0, vz: 0, radius: config.ballRadius },
    score: createVolleyballScoreState({ servingTeam: options.servingTeam }),
  };

  let accumulator = 0;
  const previousBall = { x: 0, y: 0, z: 0 };
  const floorHit = { hit: false, t: 1, x: 0, y: 0, z: 0 };
  const netHit = { hit: false, t: 1, x: 0, y: 0, z: 0 };

  function clearPossession() {
    state.possessionTeam = null;
    state.teamContacts = 0;
    state.lastContactPlayerId = null;
    state.lastContactType = null;
    state.controlledSelfSetUsed = false;
  }

  function enterPhase(phase) {
    state.phase = phase;
    state.phaseTime = 0;
  }

  function reportFault(fault, faultTeam) {
    if (!isVolleyballFault(fault) || !isVolleyballTeam(faultTeam)
      || (state.phase !== VOLLEYBALL_PHASES.SERVE_READY
        && state.phase !== VOLLEYBALL_PHASES.RALLY)) return false;
    state.pendingFault = fault;
    state.pendingFaultTeam = faultTeam;
    state.ballActive = false;
    enterPhase(VOLLEYBALL_PHASES.DEAD_BALL);
    return true;
  }

  function fixedStep() {
    state.simulationTime += config.fixedStep;
    state.phaseTime += config.fixedStep;

    if (state.phase === VOLLEYBALL_PHASES.SERVE_READY
      && state.phaseTime >= config.serveTimeoutSeconds) {
      reportFault(VOLLEYBALL_FAULTS.SERVE_TIMEOUT, state.score.servingTeam);
      return;
    }

    if (state.phase === VOLLEYBALL_PHASES.DEAD_BALL) {
      if (state.phaseTime >= config.deadBallHoldSeconds) {
        const winner = oppositeVolleyballTeam(state.pendingFaultTeam);
        const result = awardVolleyballRally(state.score, winner, state.rallyId, config);
        enterPhase(result.matchWon ? VOLLEYBALL_PHASES.MATCH_END : VOLLEYBALL_PHASES.POINT_AWARDED);
      }
      return;
    }

    if (state.phase === VOLLEYBALL_PHASES.POINT_AWARDED) {
      if (state.phaseTime >= config.pointAwardHoldSeconds) {
        state.pendingFault = null;
        state.pendingFaultTeam = null;
        clearPossession();
        enterPhase(VOLLEYBALL_PHASES.SERVE_SETUP);
      }
      return;
    }

    if (state.phase !== VOLLEYBALL_PHASES.RALLY || !state.ballActive) return;

    previousBall.x = state.ball.x;
    previousBall.y = state.ball.y;
    previousBall.z = state.ball.z;
    const incomingVz = state.ball.vz;
    const incomingVy = state.ball.vy;
    integrateVolleyballBall(state.ball, config.gravity, config.fixedStep);

    sweepVolleyballFloor(previousBall, state.ball, state.ball.radius, config.floorY, floorHit);
    sweepVolleyballNet(previousBall, state.ball, state.ball.radius, config, netHit);

    // Resolve the earliest swept event. A playable ball/net touch rebounds;
    // explicit player net violations continue to use reportFault(NET, team).
    if (netHit.hit && (!floorHit.hit || netHit.t < floorHit.t)) {
      state.ball.vy = incomingVy + config.gravity * config.fixedStep * netHit.t;
      state.ball.vz = incomingVz;
      resolveVolleyballNetRebound(state.ball, netHit, incomingVz, config);
      const remaining = config.fixedStep * (1 - netHit.t);
      previousBall.x = state.ball.x;
      previousBall.y = state.ball.y;
      previousBall.z = state.ball.z;
      integrateVolleyballBall(state.ball, config.gravity, remaining);
      sweepVolleyballFloor(previousBall, state.ball, state.ball.radius, config.floorY, floorHit);
    }

    if (floorHit.hit) {
      const landing = classifyVolleyballLanding(
        floorHit, state.ball.radius, config.courtHalfWidth, config.courtHalfLength,
      );
      if (landing === 'out') {
        reportFault(VOLLEYBALL_FAULTS.OUT, state.possessionTeam || state.score.servingTeam);
      } else {
        const landingTeam = floorHit.z <= config.centerLine ? VOLLEYBALL_TEAMS.HOME : VOLLEYBALL_TEAMS.AWAY;
        reportFault(landing === 'line_in' ? VOLLEYBALL_FAULTS.LINE_IN : VOLLEYBALL_FAULTS.GROUND, landingTeam);
      }
    }
  }

  const controller = {
    config,
    state,

    update(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
      accumulator += Math.min(deltaSeconds, config.maxFrameDelta);
      let steps = 0;
      while (accumulator + 1e-12 >= config.fixedStep) {
        fixedStep();
        accumulator -= config.fixedStep;
        steps++;
      }
      return steps;
    },

    prepareServe(team = state.score.servingTeam) {
      if (state.phase !== VOLLEYBALL_PHASES.SERVE_SETUP || !isVolleyballTeam(team)
        || team !== state.score.servingTeam || state.rallyId >= Number.MAX_SAFE_INTEGER) return false;
      state.ballActive = false;
      state.pendingFault = null;
      state.pendingFaultTeam = null;
      state.rallyId++;
      clearPossession();
      enterPhase(VOLLEYBALL_PHASES.SERVE_READY);
      return true;
    },

    setBall(ball) {
      if (!finiteBall(ball) || Math.abs(ball.radius - config.ballRadius) > 1e-9) return false;
      Object.assign(state.ball, ball);
      return true;
    },

    contact(contact) {
      if (!contact || !isVolleyballTeam(contact.team) || !validPlayerId(contact.playerId)
        || !isVolleyballContact(contact.type)) return { accepted: false, fault: null };

      if (state.phase === VOLLEYBALL_PHASES.SERVE_READY) {
        if (contact.type !== VOLLEYBALL_CONTACTS.SERVE || contact.team !== state.score.servingTeam) {
          return { accepted: false, fault: null };
        }
        clearPossession();
        enterPhase(VOLLEYBALL_PHASES.RALLY);
        state.ballActive = true;
      } else if (state.phase !== VOLLEYBALL_PHASES.RALLY) {
        return { accepted: false, fault: null };
      }

      if (state.possessionTeam !== contact.team) {
        state.possessionTeam = contact.team;
        state.teamContacts = 0;
        state.lastContactPlayerId = null;
        state.lastContactType = null;
        state.controlledSelfSetUsed = false;
      }

      const samePlayer = state.lastContactPlayerId === contact.playerId;
      const controlledSelfSet = samePlayer
        && config.teamSize === 1
        && config.allowControlledSelfSetOneVsOne
        && !state.controlledSelfSetUsed
        && contact.type === VOLLEYBALL_CONTACTS.SET
        && (state.lastContactType === VOLLEYBALL_CONTACTS.RECEIVE || state.lastContactType === VOLLEYBALL_CONTACTS.PASS);
      const controlledSelfSpike = samePlayer
        && config.teamSize === 1
        && config.allowControlledSelfSetOneVsOne
        && state.controlledSelfSetUsed
        && contact.type === VOLLEYBALL_CONTACTS.SPIKE
        && state.lastContactType === VOLLEYBALL_CONTACTS.SET;
      if (samePlayer && state.lastContactType !== VOLLEYBALL_CONTACTS.BLOCK
        && !controlledSelfSet && !controlledSelfSpike) {
        reportFault(VOLLEYBALL_FAULTS.DOUBLE_CONTACT, contact.team);
        return { accepted: false, fault: VOLLEYBALL_FAULTS.DOUBLE_CONTACT };
      }
      if (controlledSelfSet) state.controlledSelfSetUsed = true;

      if (contactConsumesTeamHit(contact.type)) {
        state.teamContacts++;
        if (state.teamContacts > config.maxContacts) {
          reportFault(VOLLEYBALL_FAULTS.FOUR_HITS, contact.team);
          return { accepted: false, fault: VOLLEYBALL_FAULTS.FOUR_HITS };
        }
      }
      state.lastContactPlayerId = contact.playerId;
      state.lastContactType = contact.type;
      return { accepted: true, fault: null, teamContacts: state.teamContacts };
    },

    validatePlayerHalf(team, position) {
      if (isOnOwnVolleyballHalf(position, team, config)) return true;
      reportFault(VOLLEYBALL_FAULTS.CENTER_LINE, team);
      return false;
    },

    reportFault,

    getSnapshot() {
      return {
        version: SNAPSHOT_VERSION,
        phase: state.phase,
        phaseTime: state.phaseTime,
        simulationTime: state.simulationTime,
        rallyId: state.rallyId,
        possessionTeam: state.possessionTeam,
        teamContacts: state.teamContacts,
        lastContactPlayerId: state.lastContactPlayerId,
        lastContactType: state.lastContactType,
        controlledSelfSetUsed: state.controlledSelfSetUsed,
        pendingFault: state.pendingFault,
        pendingFaultTeam: state.pendingFaultTeam,
        ballActive: state.ballActive,
        ball: { ...state.ball },
        score: {
          points: [...state.score.points], sets: [...state.score.sets],
          completedSets: state.score.completedSets.map((set) => [...set]),
          servingTeam: state.score.servingTeam, setOpeningTeam: state.score.setOpeningTeam,
          rotations: [...state.score.rotations],
          lastAwardedRallyId: state.score.lastAwardedRallyId,
          matchWinner: state.score.matchWinner,
        },
      };
    },

    applySnapshot(snapshot) {
      if (!hasExactKeys(snapshot, SNAPSHOT_KEYS) || !hasExactKeys(snapshot.score, SCORE_KEYS)
        || snapshot.version !== SNAPSHOT_VERSION || !isVolleyballPhase(snapshot.phase)
        || !Number.isFinite(snapshot.phaseTime) || snapshot.phaseTime < 0 || snapshot.phaseTime > 3600
        || !Number.isFinite(snapshot.simulationTime) || snapshot.simulationTime < 0 || snapshot.simulationTime > 1e9
        || !Number.isSafeInteger(snapshot.rallyId) || snapshot.rallyId < 0 || snapshot.rallyId < state.rallyId
        || (snapshot.rallyId === state.rallyId && snapshot.simulationTime < state.simulationTime)
        || (snapshot.possessionTeam != null && !isVolleyballTeam(snapshot.possessionTeam))
        || !Number.isInteger(snapshot.teamContacts) || snapshot.teamContacts < 0 || snapshot.teamContacts > config.maxContacts
        || (snapshot.lastContactPlayerId != null && !validPlayerId(snapshot.lastContactPlayerId))
        || (snapshot.lastContactType != null && !isVolleyballContact(snapshot.lastContactType))
        || (snapshot.pendingFault != null && !isVolleyballFault(snapshot.pendingFault))
        || (snapshot.pendingFaultTeam != null && !isVolleyballTeam(snapshot.pendingFaultTeam))
        || ((snapshot.pendingFault == null) !== (snapshot.pendingFaultTeam == null))
        || typeof snapshot.ballActive !== 'boolean' || typeof snapshot.controlledSelfSetUsed !== 'boolean'
        || !finiteBall(snapshot.ball) || Math.abs(snapshot.ball.radius - config.ballRadius) > 1e-9
        || !isValidVolleyballScoreSnapshot(snapshot.score, config)) return false;

      const pending = snapshot.pendingFault != null;
      const hasWinner = snapshot.score.matchWinner != null;
      const hasLastContact = snapshot.lastContactPlayerId != null || snapshot.lastContactType != null;
      const lastAwarded = snapshot.score.lastAwardedRallyId;
      const isUnawardedLiveRally = snapshot.phase === VOLLEYBALL_PHASES.SERVE_READY
        || snapshot.phase === VOLLEYBALL_PHASES.RALLY
        || snapshot.phase === VOLLEYBALL_PHASES.DEAD_BALL;
      if ((snapshot.lastContactPlayerId == null) !== (snapshot.lastContactType == null)
        || (lastAwarded != null && lastAwarded > snapshot.rallyId)
        || (isUnawardedLiveRally && lastAwarded != null && lastAwarded >= snapshot.rallyId)
        || (snapshot.phase === VOLLEYBALL_PHASES.SERVE_SETUP && (snapshot.ballActive || pending))
        || (snapshot.phase === VOLLEYBALL_PHASES.SERVE_READY && (snapshot.ballActive || pending || snapshot.rallyId < 1))
        || (snapshot.phase === VOLLEYBALL_PHASES.RALLY && (!snapshot.ballActive || pending || snapshot.rallyId < 1))
        || (snapshot.phase === VOLLEYBALL_PHASES.DEAD_BALL && (snapshot.ballActive || !pending || snapshot.rallyId < 1))
        || (snapshot.phase === VOLLEYBALL_PHASES.POINT_AWARDED
          && (snapshot.ballActive || !pending || snapshot.score.lastAwardedRallyId !== snapshot.rallyId))
        || (snapshot.phase === VOLLEYBALL_PHASES.MATCH_END
          && (snapshot.ballActive || !pending || !hasWinner || snapshot.score.lastAwardedRallyId !== snapshot.rallyId))
        || (snapshot.phase !== VOLLEYBALL_PHASES.MATCH_END && hasWinner)
        || (snapshot.teamContacts === 0 && hasLastContact && snapshot.lastContactType !== VOLLEYBALL_CONTACTS.BLOCK)
        || (snapshot.possessionTeam == null && (snapshot.teamContacts !== 0 || hasLastContact))
        || (snapshot.possessionTeam != null && !hasLastContact)
        || (snapshot.controlledSelfSetUsed && (config.teamSize !== 1
          || !config.allowControlledSelfSetOneVsOne || snapshot.teamContacts < 2
          || (snapshot.lastContactType !== VOLLEYBALL_CONTACTS.SET
            && snapshot.lastContactType !== VOLLEYBALL_CONTACTS.SPIKE)))) return false;

      state.phase = snapshot.phase;
      state.phaseTime = snapshot.phaseTime;
      state.simulationTime = snapshot.simulationTime;
      state.rallyId = snapshot.rallyId;
      state.possessionTeam = snapshot.possessionTeam;
      state.teamContacts = snapshot.teamContacts;
      state.lastContactPlayerId = snapshot.lastContactPlayerId;
      state.lastContactType = snapshot.lastContactType;
      state.controlledSelfSetUsed = snapshot.controlledSelfSetUsed;
      state.pendingFault = snapshot.pendingFault;
      state.pendingFaultTeam = snapshot.pendingFaultTeam;
      state.ballActive = snapshot.ballActive;
      Object.assign(state.ball, snapshot.ball);
      Object.assign(state.score, {
        points: [...snapshot.score.points], sets: [...snapshot.score.sets],
        completedSets: snapshot.score.completedSets.map((set) => [...set]),
        servingTeam: snapshot.score.servingTeam, setOpeningTeam: snapshot.score.setOpeningTeam,
        rotations: [...snapshot.score.rotations],
        lastAwardedRallyId: snapshot.score.lastAwardedRallyId,
        matchWinner: snapshot.score.matchWinner,
      });
      accumulator = 0;
      return true;
    },
  };

  return controller;
}
