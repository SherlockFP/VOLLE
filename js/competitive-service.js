const QUEUE_RANGE = 250;
const QUEUE_EXPAND_PER_SECOND = 8;

export function createDraftState(players = [], classes = []) {
    return {
        active: true,
        phase: 'team',
        players: players.map(player => ({
            id: String(player.id),
            name: String(player.name || 'Player'),
            team: player.team === 'red' || player.team === 'blue' ? player.team : null,
            classId: classes.includes(player.classId) ? player.classId : null,
            ready: false
        })),
        classes: [...classes],
        startedAt: Date.now()
    };
}

export function updateDraftPick(state, playerId, patch) {
    if (!state?.active) return state;
    const players = state.players.map(player => {
        if (player.id !== String(playerId)) return player;
        const team = patch.team === 'red' || patch.team === 'blue' ? patch.team : player.team;
        const classId = state.classes.includes(patch.classId) ? patch.classId : player.classId;
        return { ...player, team, classId, ready: patch.ready === true && !!team && !!classId };
    });
    const teamDone = players.every(player => !!player.team);
    const classDone = players.every(player => !!player.classId);
    return {
        ...state,
        players,
        phase: !teamDone ? 'team' : !classDone ? 'class' : 'ready',
        active: !players.length || !players.every(player => player.ready)
    };
}

export function canChangeClass(lastChangedRound, currentRound) {
    return !Number.isFinite(lastChangedRound) || lastChangedRound !== currentRound;
}

export function shouldStartOvertime({ redScore, blueScore, timeUp, maxRounds }) {
    return Boolean((timeUp || maxRounds) && Number(redScore) === Number(blueScore));
}

export function shouldEndOvertime({ redScore, blueScore, roundsExtended = 0, maxExtensions = 8 }) {
    return Math.abs(Number(redScore) - Number(blueScore)) >= 2 || roundsExtended >= maxExtensions;
}

export function rankQueueCandidates(lobbies, {
    elo,
    waitedSeconds = 0,
    playerCount = 1
}) {
    const range = QUEUE_RANGE + Math.max(0, waitedSeconds) * QUEUE_EXPAND_PER_SECOND;
    return (Array.isArray(lobbies) ? lobbies : [])
        .filter(lobby => lobby?.ranked === true || String(lobby?.mode || '').toLowerCase().includes('competitive'))
        .filter(lobby => Number(lobby.players || 0) + playerCount <= Number(lobby.maxPlayers || 8))
        .map(lobby => ({
            ...lobby,
            eloGap: Math.abs(Number(lobby.averageElo ?? elo) - elo)
        }))
        .filter(lobby => lobby.eloGap <= range)
        .sort((a, b) => a.eloGap - b.eloGap || Number(a.players || 0) - Number(b.players || 0));
}

export const COMPETITIVE_LIMITS = Object.freeze({
    initialEloRange: QUEUE_RANGE,
    expandPerSecond: QUEUE_EXPAND_PER_SECOND
});
