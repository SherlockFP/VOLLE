import {
  VOLLEYBALL_CONTACTS,
  VOLLEYBALL_PHASES,
  VOLLEYBALL_TEAMS,
  isVolleyballContact,
  isVolleyballTeam,
} from './volleyball-rules.js';

const ACTION_KEYS = Object.freeze(['type', 'aimX', 'aimY', 'aimZ', 'sequence']);
const EPSILON = 1e-8;
const BALL_POSITION_LIMIT = 10000;

export const VOLLEYBALL_PRACTICE_ACTIONS = Object.freeze({
  SERVE: VOLLEYBALL_CONTACTS.SERVE,
  RECEIVE: VOLLEYBALL_CONTACTS.RECEIVE,
  SET: VOLLEYBALL_CONTACTS.SET,
  SPIKE: VOLLEYBALL_CONTACTS.SPIKE,
  BLOCK: VOLLEYBALL_CONTACTS.BLOCK,
});

export const VOLLEYBALL_PRACTICE_CONTACT_PROFILE = Object.freeze({
  [VOLLEYBALL_CONTACTS.SERVE]: Object.freeze({ horizontalSpeed: 13, verticalSpeed: 8.6 }),
  [VOLLEYBALL_CONTACTS.RECEIVE]: Object.freeze({ horizontalSpeed: 1.4, verticalSpeed: 10 }),
  [VOLLEYBALL_CONTACTS.SET]: Object.freeze({ horizontalSpeed: 0.75, verticalSpeed: 10.5 }),
  [VOLLEYBALL_CONTACTS.SPIKE]: Object.freeze({ horizontalSpeed: 16, verticalSpeed: -4.5 }),
  [VOLLEYBALL_CONTACTS.BLOCK]: Object.freeze({ horizontalSpeed: 10, verticalSpeed: 6 }),
});

function hasExactActionKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === ACTION_KEYS.length && ACTION_KEYS.every((key) => Object.hasOwn(value, key));
}

export function isVolleyballPracticeAction(value) {
  return hasExactActionKeys(value)
    && isVolleyballContact(value.type)
    && Object.hasOwn(VOLLEYBALL_PRACTICE_CONTACT_PROFILE, value.type)
    && Number.isFinite(value.aimX)
    && Number.isFinite(value.aimY)
    && Number.isFinite(value.aimZ)
    && Math.abs(value.aimX) <= 10000
    && Math.abs(value.aimY) <= 10000
    && Math.abs(value.aimZ) <= 10000
    && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0;
}

/** Writes into a preallocated queue slot. No timestamp or player-owned metadata is accepted. */
export function writeVolleyballPracticeAction(out, type, aimDirection, sequence) {
  if (!out || !isVolleyballContact(type)
    || !Object.hasOwn(VOLLEYBALL_PRACTICE_CONTACT_PROFILE, type)
    || !Number.isSafeInteger(sequence) || sequence < 0) return false;
  const x = aimDirection?.x ?? 0;
  const y = aimDirection?.y ?? 0;
  const z = aimDirection?.z ?? 0;
  if (![x, y, z].every((value) => Number.isFinite(value) && Math.abs(value) <= 10000)) return false;
  out.type = type;
  out.aimX = x;
  out.aimY = y;
  out.aimZ = z;
  out.sequence = sequence;
  return true;
}

export function createVolleyballContactScratch() {
  return {
    contact: { team: VOLLEYBALL_TEAMS.HOME, playerId: 'practice-player', type: VOLLEYBALL_CONTACTS.SERVE },
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0.34 },
  };
}

function defaultHorizontalDirection(team, type) {
  const towardOpponent = team === VOLLEYBALL_TEAMS.HOME ? 1 : -1;
  return type === VOLLEYBALL_CONTACTS.RECEIVE || type === VOLLEYBALL_CONTACTS.SET
    ? -towardOpponent : towardOpponent;
}

function writeProspectiveOrigin(out, origin, fallback) {
  if (origin == null) {
    out.x = fallback.x;
    out.y = fallback.y;
    out.z = fallback.z;
    return true;
  }
  if (typeof origin !== 'object' || Array.isArray(origin)) return false;
  for (const key of ['x', 'y', 'z']) {
    if (!Number.isFinite(origin[key]) || Math.abs(origin[key]) > BALL_POSITION_LIMIT) return false;
  }
  out.x = origin.x;
  out.y = origin.y;
  out.z = origin.z;
  return true;
}

function isProspectiveBallValid(ball, expectedRadius) {
  return Number.isFinite(expectedRadius)
    && expectedRadius > 0
    && expectedRadius <= 2
    && Math.abs(ball.radius - expectedRadius) <= 1e-9
    && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((key) => (
      Number.isFinite(ball[key]) && Math.abs(ball[key]) <= BALL_POSITION_LIMIT
    ));
}

/**
 * Applies one already-authorized local practice action. This adapter deliberately
 * transports only contact intent and physical ball state: combat, homing, rewards
 * and cosmetics have no accepted fields or controller path.
 */
export function applyVolleyballPracticeAction(controller, action, context, scratch = createVolleyballContactScratch()) {
  if (!controller?.state || !isVolleyballPracticeAction(action)
    || !isVolleyballTeam(context?.team)
    || typeof context.playerId !== 'string' || context.playerId.length < 1 || context.playerId.length > 80) {
    return { accepted: false, fault: null };
  }

  const profile = VOLLEYBALL_PRACTICE_CONTACT_PROFILE[action.type];
  const source = controller.state.ball;
  if (!writeProspectiveOrigin(scratch.ball, context.origin, source)) {
    return { accepted: false, fault: null };
  }
  scratch.ball.radius = controller.config.ballRadius;

  let horizontalX = action.aimX;
  let horizontalZ = action.aimZ;
  let horizontalLength = Math.hypot(horizontalX, horizontalZ);
  if (horizontalLength < EPSILON) {
    horizontalX = 0;
    horizontalZ = defaultHorizontalDirection(context.team, action.type);
    horizontalLength = 1;
  }
  horizontalX /= horizontalLength;
  horizontalZ /= horizontalLength;

  if (action.type === VOLLEYBALL_CONTACTS.BLOCK) {
    const incomingLength = Math.hypot(source.vx, source.vz);
    if (incomingLength >= EPSILON) {
      horizontalX = -source.vx / incomingLength;
      horizontalZ = -source.vz / incomingLength;
    }
  }

  scratch.ball.vx = horizontalX * profile.horizontalSpeed;
  scratch.ball.vy = profile.verticalSpeed;
  scratch.ball.vz = horizontalZ * profile.horizontalSpeed;

  // Validate the complete prospective physical state before prepareServe/contact.
  // Both controller calls mutate rally ownership, so a later setBall rejection
  // would otherwise leave a malformed action partially applied.
  if (!isProspectiveBallValid(scratch.ball, controller.config.ballRadius)) {
    return { accepted: false, fault: null };
  }

  const phase = controller.state.phase;
  if (action.type === VOLLEYBALL_CONTACTS.SERVE
    && phase !== VOLLEYBALL_PHASES.SERVE_SETUP
    && phase !== VOLLEYBALL_PHASES.SERVE_READY) {
    return { accepted: false, fault: null };
  }
  if (action.type === VOLLEYBALL_CONTACTS.SERVE
    && phase === VOLLEYBALL_PHASES.SERVE_SETUP
    && !controller.prepareServe(context.team)) return { accepted: false, fault: null };

  scratch.contact.team = context.team;
  scratch.contact.playerId = context.playerId;
  scratch.contact.type = action.type;
  const result = controller.contact(scratch.contact);
  if (!result.accepted) return result;

  if (!controller.setBall(scratch.ball)) return { accepted: false, fault: null };
  return result;
}
