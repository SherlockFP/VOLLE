const BASE_ELO = 1000;
const MIN_ELO = 0;
const MAX_ELO = 5000;
const DEFAULT_PLACEMENTS = 5;
const MAX_PLACEMENTS = 10;
const MAX_MATCHES = 100;
const MAX_SEASONS = 8;
const NORMAL_K = 32;
const PLACEMENT_K = 48;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const RESULT_SCORES = Object.freeze({
    loss: 0,
    draw: 0.5,
    win: 1
});

function assertObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
}

function assertId(value, name) {
    if (typeof value !== 'string'
        || RESERVED_IDS.has(value.toLowerCase())
        || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)) {
        throw new TypeError(`${name} is invalid`);
    }
    return value;
}

function assertInteger(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
    }
    return value;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function makeSeason(id, placementsRequired, startedAt, startingElo) {
    return {
        id,
        startedAt,
        startingElo,
        placements: {
            required: placementsRequired,
            completed: 0,
            placed: placementsRequired === 0
        },
        record: {
            games: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            highestElo: startingElo,
            lowestElo: startingElo
        },
        matches: []
    };
}

function assertRankedState(state) {
    assertObject(state, 'state');
    assertInteger(state.elo, MIN_ELO, MAX_ELO, 'state.elo');
    assertObject(state.currentSeason, 'state.currentSeason');
    assertId(state.currentSeason.id, 'state.currentSeason.id');
    if (!Array.isArray(state.currentSeason.matches) || !Array.isArray(state.pastSeasons)) {
        throw new TypeError('state has invalid season lists');
    }
}

export function expectedRankedScore(playerElo, opponentElo) {
    assertInteger(playerElo, MIN_ELO, MAX_ELO, 'playerElo');
    assertInteger(opponentElo, MIN_ELO, MAX_ELO, 'opponentElo');
    return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

export function calculateEloChange({
    playerElo,
    opponentElo,
    result,
    placement = false
}) {
    const score = RESULT_SCORES[result];
    if (score === undefined) throw new TypeError('result must be win, loss, or draw');
    const expected = expectedRankedScore(playerElo, opponentElo);
    const limit = placement ? PLACEMENT_K : NORMAL_K;
    return clamp(Math.round(limit * (score - expected)), -limit, limit);
}

export function createRankedState({
    seasonId = 'season-1',
    elo = BASE_ELO,
    placementsRequired = DEFAULT_PLACEMENTS,
    startedAt = 0
} = {}) {
    assertId(seasonId, 'seasonId');
    assertInteger(elo, MIN_ELO, MAX_ELO, 'elo');
    assertInteger(placementsRequired, 0, MAX_PLACEMENTS, 'placementsRequired');
    assertInteger(startedAt, 0, Number.MAX_SAFE_INTEGER, 'startedAt');
    return {
        elo,
        currentSeason: makeSeason(seasonId, placementsRequired, startedAt, elo),
        pastSeasons: []
    };
}

export function recordRankedMatch(state, {
    matchId,
    opponentElo,
    result,
    playedAt
}) {
    assertRankedState(state);
    assertId(matchId, 'matchId');
    assertInteger(opponentElo, MIN_ELO, MAX_ELO, 'opponentElo');
    assertInteger(playedAt, 0, Number.MAX_SAFE_INTEGER, 'playedAt');
    if (RESULT_SCORES[result] === undefined) {
        throw new TypeError('result must be win, loss, or draw');
    }

    const season = state.currentSeason;
    if (season.matches.some(match => match.id === matchId)) {
        throw new Error('matchId already recorded');
    }

    const placement = !season.placements.placed;
    const delta = calculateEloChange({
        playerElo: state.elo,
        opponentElo,
        result,
        placement
    });
    const eloAfter = clamp(state.elo + delta, MIN_ELO, MAX_ELO);
    const appliedDelta = eloAfter - state.elo;
    const completed = Math.min(
        season.placements.required,
        season.placements.completed + (placement ? 1 : 0)
    );
    const record = {
        ...season.record,
        games: season.record.games + 1,
        wins: season.record.wins + (result === 'win' ? 1 : 0),
        losses: season.record.losses + (result === 'loss' ? 1 : 0),
        draws: season.record.draws + (result === 'draw' ? 1 : 0),
        highestElo: Math.max(season.record.highestElo, eloAfter),
        lowestElo: Math.min(season.record.lowestElo, eloAfter)
    };
    const match = {
        id: matchId,
        playedAt,
        opponentElo,
        result,
        placement,
        eloBefore: state.elo,
        eloAfter,
        delta: appliedDelta
    };

    return {
        ...state,
        elo: eloAfter,
        currentSeason: {
            ...season,
            placements: {
                ...season.placements,
                completed,
                placed: completed >= season.placements.required
            },
            record,
            matches: [...season.matches, match].slice(-MAX_MATCHES)
        },
        pastSeasons: [...state.pastSeasons]
    };
}

export function startRankedSeason(state, {
    seasonId,
    startedAt,
    placementsRequired = DEFAULT_PLACEMENTS
}) {
    assertRankedState(state);
    assertId(seasonId, 'seasonId');
    assertInteger(startedAt, 0, Number.MAX_SAFE_INTEGER, 'startedAt');
    assertInteger(placementsRequired, 0, MAX_PLACEMENTS, 'placementsRequired');
    if (seasonId === state.currentSeason.id
        || state.pastSeasons.some(season => season.id === seasonId)) {
        throw new Error('seasonId already exists');
    }

    const elo = clamp(
        Math.round(BASE_ELO + (state.elo - BASE_ELO) * 0.5),
        MIN_ELO,
        MAX_ELO
    );
    return {
        elo,
        currentSeason: makeSeason(seasonId, placementsRequired, startedAt, elo),
        pastSeasons: [...state.pastSeasons, state.currentSeason].slice(-MAX_SEASONS)
    };
}

export const RANKED_LIMITS = Object.freeze({
    baseElo: BASE_ELO,
    minElo: MIN_ELO,
    maxElo: MAX_ELO,
    normalMaxDelta: NORMAL_K,
    placementMaxDelta: PLACEMENT_K,
    maxPlacements: MAX_PLACEMENTS,
    maxMatches: MAX_MATCHES,
    maxSeasons: MAX_SEASONS
});
