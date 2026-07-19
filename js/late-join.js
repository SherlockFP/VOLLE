export const LIVE_JOIN_STATES = Object.freeze(['PLAYING', 'COUNTDOWN', 'ROUND_END', 'PAUSED']);

export function isLiveJoinState(state) {
    return LIVE_JOIN_STATES.includes(state);
}

export function normalizeTeam(team, fallback = 'red') {
    if (team === 'red' || team === 'blue') return team;
    return fallback === 'blue' ? 'blue' : 'red';
}

export function queueForNextRound(entity, { team, round } = {}) {
    if (!entity) return null;
    const pendingTeam = normalizeTeam(team, entity.team);
    entity.queuedForNextRound = true;
    entity.pendingTeam = pendingTeam;
    entity.activateRound = Math.max(1, Math.trunc(Number(round) || 1));
    entity.alive = false;
    if (entity.group) entity.group.visible = false;
    return { team: pendingTeam, activateRound: entity.activateRound };
}

export function selectQueuedTeam(entity, team) {
    if (!entity?.queuedForNextRound || (team !== 'red' && team !== 'blue')) return false;
    const changed = entity.pendingTeam !== team;
    entity.pendingTeam = team;
    return changed;
}

export function activateQueuedEntity(entity) {
    if (!entity?.queuedForNextRound) return false;
    entity.team = normalizeTeam(entity.pendingTeam, entity.team);
    entity.queuedForNextRound = false;
    entity.pendingTeam = null;
    entity.activateRound = null;
    entity.alive = false;
    return true;
}
