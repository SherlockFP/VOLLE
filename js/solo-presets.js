// solo-presets.js — short, deterministic local match starts.
//
// These descriptors deliberately contain only session configuration. They do
// not read or write Store data, lobby controls, account preferences, or RNG.

export const SOLO_PRESET_IDS = Object.freeze({
    MATCHED: 'matched',
    WARMUP: 'warmup',
    RALLY_DUEL: 'rally_duel',
    PRESSURE: 'pressure'
});

const PRESETS = Object.freeze({
    [SOLO_PRESET_IDS.WARMUP]: Object.freeze({
        id: SOLO_PRESET_IDS.WARMUP,
        name: 'Warmup',
        modeId: 'instagib',
        mapId: 'beach_open',
        botDifficulty: 'easy',
        maxRounds: 3,
        timeLimit: 180,
        botName: 'Warmup BOT'
    }),
    [SOLO_PRESET_IDS.RALLY_DUEL]: Object.freeze({
        id: SOLO_PRESET_IDS.RALLY_DUEL,
        name: 'Rally Duel',
        modeId: 'rally_duel',
        mapId: 'industrial',
        botDifficulty: 'medium',
        maxRounds: 3,
        timeLimit: 180,
        botName: 'Rally BOT'
    }),
    [SOLO_PRESET_IDS.PRESSURE]: Object.freeze({
        id: SOLO_PRESET_IDS.PRESSURE,
        name: 'Pressure',
        modeId: 'instagib',
        mapId: 'esport_arena',
        botDifficulty: 'hard',
        maxRounds: 5,
        timeLimit: 180,
        botName: 'Pressure BOT'
    }),
    // 'auto': the bot is built from the player's adaptive skill level
    // (js/adaptive-difficulty.js via Game.resolveAdaptiveSkill), which each
    // finished match of this preset nudges up or down.
    [SOLO_PRESET_IDS.MATCHED]: Object.freeze({
        id: SOLO_PRESET_IDS.MATCHED,
        name: 'Matched',
        modeId: 'classic',
        mapId: 'grand_stadium',
        botDifficulty: 'auto',
        maxRounds: 5,
        timeLimit: 180,
        botName: 'Rival BOT'
    })
});

export const SOLO_PRESETS = Object.freeze(Object.values(PRESETS));

export function getSoloPreset(presetId) {
    return Object.hasOwn(PRESETS, presetId) ? PRESETS[presetId] : null;
}

function canApply(game) {
    return Boolean(
        game
        && Array.isArray(game.bots)
        && typeof game.removeBot === 'function'
        && typeof game.addBot === 'function'
        && typeof game.selectMode === 'function'
        && typeof game.selectMap === 'function'
        && typeof game.setMatchModifier === 'function'
        && typeof game.scoreboard?.setMaxRounds === 'function'
        && typeof game.scoreboard?.setTimeLimit === 'function'
    );
}

function rejected(reason) {
    return Object.freeze({ accepted: false, preset: null, reason });
}

function hasRemoteHuman(game) {
    if (!game.remotePlayers || typeof game.remotePlayers.values !== 'function') return false;
    return Array.from(game.remotePlayers.values()).some(player => player && !player.isBotEntity);
}

// Call after Game.startSolo(), while the game is in its local lobby. startSolo
// intentionally leaves a bot from an earlier lobby in place, so clear every
// current bot before creating the preset's one known opponent. game.botDifficulty
// is a session field consumed by Bot's constructor; no persistent settings change.
export function applySoloPreset(game, presetId) {
    const preset = getSoloPreset(presetId);
    if (!preset) return rejected('unknown-preset');
    if (!canApply(game)) return rejected('unsupported-game');
    if (game.network?.connected || hasRemoteHuman(game)) return rejected('not-solo');

    while (game.bots.length) game.removeBot();
    game.botCounter = 0;
    game.botDifficulty = preset.botDifficulty;
    game.setMatchModifier('none');
    game.selectMode(preset.modeId);
    game.selectMap(preset.mapId);
    game.scoreboard.setMaxRounds(preset.maxRounds);
    game.scoreboard.setTimeLimit(preset.timeLimit);
    game.addBot('blue', { name: preset.botName });

    return Object.freeze({ accepted: true, preset, reason: null });
}
