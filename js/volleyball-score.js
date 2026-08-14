import { VOLLEYBALL_TEAMS, isVolleyballTeam, oppositeVolleyballTeam } from './volleyball-rules.js';

export function createVolleyballScoreState(options = {}) {
  const servingTeam = isVolleyballTeam(options.servingTeam) ? options.servingTeam : VOLLEYBALL_TEAMS.HOME;
  return {
    points: [0, 0],
    sets: [0, 0],
    completedSets: [],
    servingTeam,
    setOpeningTeam: servingTeam,
    rotations: [0, 0],
    lastAwardedRallyId: null,
    matchWinner: null,
  };
}

export function volleyballTeamIndex(team) {
  return team === VOLLEYBALL_TEAMS.HOME ? 0 : team === VOLLEYBALL_TEAMS.AWAY ? 1 : -1;
}

export function hasWonVolleyballSet(points, otherPoints, config) {
  return points >= config.setTarget && points - otherPoints >= config.winBy;
}

/** Mutates score once per unique rally id. Scoring is rally-point based. */
export function awardVolleyballRally(state, winner, rallyId, config) {
  const index = volleyballTeamIndex(winner);
  if (index < 0 || !Number.isSafeInteger(rallyId) || rallyId < 1 || state.matchWinner
    || (state.lastAwardedRallyId != null && rallyId <= state.lastAwardedRallyId)) {
    return { awarded: false, setWon: false, matchWon: false, winner: null };
  }
  const other = 1 - index;
  state.lastAwardedRallyId = rallyId;
  state.points[index]++;

  if (state.servingTeam !== winner) {
    state.servingTeam = winner;
    state.rotations[index] = (state.rotations[index] + 1) % config.teamSize;
  }

  let setWon = false;
  let matchWon = false;
  if (hasWonVolleyballSet(state.points[index], state.points[other], config)) {
    setWon = true;
    state.sets[index]++;
    state.completedSets.push([state.points[0], state.points[1]]);
    if (state.sets[index] >= config.setsToWin) {
      state.matchWinner = winner;
      matchWon = true;
    } else {
      state.points[0] = 0;
      state.points[1] = 0;
      state.setOpeningTeam = oppositeVolleyballTeam(state.setOpeningTeam);
      state.servingTeam = state.setOpeningTeam;
    }
  }
  return { awarded: true, setWon, matchWon, winner };
}

export function winnerForVolleyballFault(faultTeam) {
  return oppositeVolleyballTeam(faultTeam);
}

export function isValidVolleyballScoreSnapshot(value, config) {
  if (!value || !Array.isArray(value.points) || value.points.length !== 2
    || !Array.isArray(value.sets) || value.sets.length !== 2
    || !Array.isArray(value.rotations) || value.rotations.length !== 2
    || !Array.isArray(value.completedSets) || !isVolleyballTeam(value.servingTeam)
    || !isVolleyballTeam(value.setOpeningTeam)) return false;
  const ints = [...value.points, ...value.sets, ...value.rotations];
  if (ints.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) return false;
  if (value.sets.some((n) => n > config.setsToWin)) return false;
  if (value.rotations.some((n) => n >= config.teamSize)) return false;
  if (value.matchWinner != null && !isVolleyballTeam(value.matchWinner)) return false;
  if (value.lastAwardedRallyId != null
    && !(Number.isSafeInteger(value.lastAwardedRallyId) && value.lastAwardedRallyId >= 1)) return false;
  if (value.completedSets.length > config.setsToWin * 2 - 1) return false;
  if (value.completedSets.length !== value.sets[0] + value.sets[1]) return false;
  if (value.matchWinner == null && value.sets.some((n) => n >= config.setsToWin)) return false;
  if (value.matchWinner != null) {
    const winnerIndex = volleyballTeamIndex(value.matchWinner);
    if (value.sets[winnerIndex] !== config.setsToWin || value.sets[1 - winnerIndex] >= config.setsToWin) return false;
  }
  return value.completedSets.every((set) => {
    if (!Array.isArray(set) || set.length !== 2
      || set.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) return false;
    return hasWonVolleyballSet(set[0], set[1], config) !== hasWonVolleyballSet(set[1], set[0], config);
  });
}
