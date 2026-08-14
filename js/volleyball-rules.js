/**
 * Renderer-independent rules shared by the future Volleyball runtime and UI.
 * This module deliberately contains no dodgeball combat, homing, health or
 * cosmetic state.
 */

export const VOLLEYBALL_PHASES = Object.freeze({
  SERVE_SETUP: 'serve_setup',
  SERVE_READY: 'serve_ready',
  RALLY: 'rally',
  DEAD_BALL: 'dead_ball',
  POINT_AWARDED: 'point_awarded',
  MATCH_END: 'match_end',
});

export const VOLLEYBALL_TEAMS = Object.freeze({ HOME: 'home', AWAY: 'away' });

export const VOLLEYBALL_CONTACTS = Object.freeze({
  SERVE: 'serve',
  RECEIVE: 'receive',
  PASS: 'pass',
  SET: 'set',
  SPIKE: 'spike',
  BLOCK: 'block',
});

export const VOLLEYBALL_FAULTS = Object.freeze({
  GROUND: 'ground',
  LINE_IN: 'line_in',
  OUT: 'out',
  NET: 'net',
  FOUR_HITS: 'four_hits',
  DOUBLE_CONTACT: 'double_contact',
  CENTER_LINE: 'center_line',
  SERVE_TIMEOUT: 'serve_timeout',
});

const PHASE_SET = new Set(Object.values(VOLLEYBALL_PHASES));
const TEAM_SET = new Set(Object.values(VOLLEYBALL_TEAMS));
const CONTACT_SET = new Set(Object.values(VOLLEYBALL_CONTACTS));
const FAULT_SET = new Set(Object.values(VOLLEYBALL_FAULTS));

export const DEFAULT_VOLLEYBALL_CONFIG = Object.freeze({
  fixedStep: 1 / 120,
  maxFrameDelta: 0.25,
  gravity: -22,
  ballRadius: 0.34,
  courtHalfWidth: 9,
  courtHalfLength: 9,
  centerLine: 0,
  centerLineTolerance: 0.04,
  floorY: 0,
  netHeight: 2.43,
  netHalfWidth: 9.5,
  netThickness: 0.08,
  netRestitution: 0.38,
  netTangentialDamping: 0.84,
  maxContacts: 3,
  teamSize: 1,
  allowControlledSelfSetOneVsOne: false,
  serveTimeoutSeconds: 8,
  deadBallHoldSeconds: 0.18,
  pointAwardHoldSeconds: 0.22,
  setTarget: 15,
  setsToWin: 2,
  winBy: 2,
  maxPassSetAssistDegrees: 12,
  maxCasualSpikeAssistDegrees: 4,
});

function finiteInRange(value, min, max, fallback) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function createVolleyballConfig(overrides = {}) {
  const base = DEFAULT_VOLLEYBALL_CONFIG;
  return Object.freeze({
    fixedStep: finiteInRange(overrides.fixedStep, 1 / 500, 1 / 20, base.fixedStep),
    maxFrameDelta: finiteInRange(overrides.maxFrameDelta, 1 / 30, 1, base.maxFrameDelta),
    gravity: finiteInRange(overrides.gravity, -80, -1, base.gravity),
    ballRadius: finiteInRange(overrides.ballRadius, 0.1, 1, base.ballRadius),
    courtHalfWidth: finiteInRange(overrides.courtHalfWidth, 2, 40, base.courtHalfWidth),
    courtHalfLength: finiteInRange(overrides.courtHalfLength, 2, 40, base.courtHalfLength),
    centerLine: finiteInRange(overrides.centerLine, -10, 10, base.centerLine),
    centerLineTolerance: finiteInRange(overrides.centerLineTolerance, 0, 0.5, base.centerLineTolerance),
    floorY: finiteInRange(overrides.floorY, -20, 20, base.floorY),
    netHeight: finiteInRange(overrides.netHeight, 0.5, 8, base.netHeight),
    netHalfWidth: finiteInRange(overrides.netHalfWidth, 2, 40, base.netHalfWidth),
    netThickness: finiteInRange(overrides.netThickness, 0.01, 0.5, base.netThickness),
    netRestitution: finiteInRange(overrides.netRestitution, 0.05, 0.8, base.netRestitution),
    netTangentialDamping: finiteInRange(overrides.netTangentialDamping, 0.2, 1, base.netTangentialDamping),
    maxContacts: Math.trunc(finiteInRange(overrides.maxContacts, 1, 6, base.maxContacts)),
    teamSize: Math.trunc(finiteInRange(overrides.teamSize, 1, 8, base.teamSize)),
    allowControlledSelfSetOneVsOne: overrides.allowControlledSelfSetOneVsOne === true,
    serveTimeoutSeconds: finiteInRange(overrides.serveTimeoutSeconds, 1, 30, base.serveTimeoutSeconds),
    deadBallHoldSeconds: finiteInRange(overrides.deadBallHoldSeconds, 0, 3, base.deadBallHoldSeconds),
    pointAwardHoldSeconds: finiteInRange(overrides.pointAwardHoldSeconds, 0, 3, base.pointAwardHoldSeconds),
    setTarget: Math.trunc(finiteInRange(overrides.setTarget, 3, 50, base.setTarget)),
    setsToWin: Math.trunc(finiteInRange(overrides.setsToWin, 1, 5, base.setsToWin)),
    winBy: Math.trunc(finiteInRange(overrides.winBy, 1, 10, base.winBy)),
    maxPassSetAssistDegrees: finiteInRange(overrides.maxPassSetAssistDegrees, 0, 12, base.maxPassSetAssistDegrees),
    maxCasualSpikeAssistDegrees: finiteInRange(overrides.maxCasualSpikeAssistDegrees, 0, 4, base.maxCasualSpikeAssistDegrees),
  });
}

export function isVolleyballPhase(value) { return PHASE_SET.has(value); }
export function isVolleyballTeam(value) { return TEAM_SET.has(value); }
export function isVolleyballContact(value) { return CONTACT_SET.has(value); }
export function isVolleyballFault(value) { return FAULT_SET.has(value); }

export function oppositeVolleyballTeam(team) {
  return team === VOLLEYBALL_TEAMS.HOME ? VOLLEYBALL_TEAMS.AWAY
    : team === VOLLEYBALL_TEAMS.AWAY ? VOLLEYBALL_TEAMS.HOME : null;
}

/** Home owns z <= center, away owns z >= center. The center line is neutral. */
export function isOnOwnVolleyballHalf(position, team, config = DEFAULT_VOLLEYBALL_CONFIG) {
  if (!position || !Number.isFinite(position.z) || !isVolleyballTeam(team)) return false;
  const delta = position.z - config.centerLine;
  return team === VOLLEYBALL_TEAMS.HOME
    ? delta <= config.centerLineTolerance
    : delta >= -config.centerLineTolerance;
}

export function contactConsumesTeamHit(contactType) {
  return contactType !== VOLLEYBALL_CONTACTS.BLOCK && isVolleyballContact(contactType);
}

function normalizedDot(ax, ay, az, bx, by, bz) {
  const aLen = Math.hypot(ax, ay, az);
  const bLen = Math.hypot(bx, by, bz);
  if (aLen < 1e-8 || bLen < 1e-8) return -1;
  return (ax * bx + ay * by + az * bz) / (aLen * bLen);
}

/**
 * Small, honest aim magnetism. It only considers living teammates already near
 * the reticle and never redirects toward a teammate behind the player.
 * `out` lets the hot path reuse a vector-shaped object.
 */
export function computeVolleyballAimAssist(params, out = { x: 0, y: 0, z: 0 }) {
  const aim = params?.aimDirection;
  if (!aim) return null;
  const aimLength = Math.hypot(aim.x, aim.y, aim.z);
  if (!Number.isFinite(aimLength) || aimLength < 1e-8) return null;

  out.x = aim.x / aimLength;
  out.y = aim.y / aimLength;
  out.z = aim.z / aimLength;

  if (params.competitive === true) return out;

  const type = params.contactType;
  let maxDegrees = 0;
  if (type === VOLLEYBALL_CONTACTS.PASS || type === VOLLEYBALL_CONTACTS.SET) {
    maxDegrees = Math.min(12, params.config?.maxPassSetAssistDegrees ?? 12);
  } else if (type === VOLLEYBALL_CONTACTS.SPIKE) {
    maxDegrees = Math.min(4, params.config?.maxCasualSpikeAssistDegrees ?? 4);
  }
  if (maxDegrees <= 0 || !Array.isArray(params.teammates) || !params.origin) return out;

  const minDot = Math.cos(maxDegrees * Math.PI / 180);
  let best = null;
  let bestDot = minDot;
  for (let i = 0; i < params.teammates.length; i++) {
    const mate = params.teammates[i];
    if (!mate || mate.active === false || mate.id === params.playerId || !mate.position) continue;
    const dx = mate.position.x - params.origin.x;
    const dy = mate.position.y - params.origin.y;
    const dz = mate.position.z - params.origin.z;
    const dot = normalizedDot(out.x, out.y, out.z, dx, dy, dz);
    if (dot >= bestDot && dot > 0) {
      best = mate;
      bestDot = dot;
    }
  }
  if (!best) return out;

  const dx = best.position.x - params.origin.x;
  const dy = best.position.y - params.origin.y;
  const dz = best.position.z - params.origin.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-8) return out;
  out.x = dx / length;
  out.y = dy / length;
  out.z = dz / length;
  return out;
}
