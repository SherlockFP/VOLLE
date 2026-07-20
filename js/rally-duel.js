export const RALLY_DUEL_MODE_ID = 'rally_duel';
export const RALLY_DUEL_MAPS = Object.freeze(['industrial', 'temple_sym']);
export const RALLY_DUEL_DEFAULT_MAP = RALLY_DUEL_MAPS[0];

export function isRallyDuelMode(modeId) {
    return modeId === RALLY_DUEL_MODE_ID;
}

export function normalizeRallyDuelMap(mapId) {
    return RALLY_DUEL_MAPS.includes(mapId) ? mapId : RALLY_DUEL_DEFAULT_MAP;
}

export function planRallyDuelRoster({
    remotePlayers = [],
    allowFallbackBot = true
} = {}) {
    const humans = Array.from(remotePlayers)
        .filter(player => player && !player.queuedForNextRound && !player.isBotEntity);
    if (humans.length > 1) {
        return Object.freeze({
            accepted: false,
            reason: 'too-many-players',
            opponent: null,
            needsFallbackBot: false
        });
    }
    if (humans.length === 1) {
        return Object.freeze({
            accepted: true,
            reason: null,
            opponent: humans[0],
            needsFallbackBot: false
        });
    }
    return Object.freeze({
        accepted: allowFallbackBot,
        reason: allowFallbackBot ? null : 'waiting-for-opponent',
        opponent: null,
        needsFallbackBot: allowFallbackBot
    });
}
