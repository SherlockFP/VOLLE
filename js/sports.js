// sports.js — canonical top-level sport routing for menus and lobby metadata.
// Match simulation remains owned by Game/GAME_MODES; Volleyball is intentionally
// feature-gated until its own authoritative rally controller exists.

export const SPORT_IDS = Object.freeze({
    DODGEBALL: 'dodgeball',
    VOLLEYBALL: 'volleyball'
});

const DODGEBALL_RULESETS = Object.freeze([
    'classic', 'speedball', 'lowgrav', 'instagib', 'tanky', 'multiball',
    'tiny', 'giant', 'freeze', 'hotpotato', 'ffa', 'competitive',
    'rally_duel', 'pinball', 'goal_rush'
]);

const DODGEBALL_MAPS = Object.freeze([
    'beach', 'beach_open', 'industrial', 'space', 'neon', 'circuit_dome',
    'dojo', 'colosseum', 'volcano', 'ice', 'cloud', 'jungle', 'cyber',
    'canyon', 'pillar', 'lava', 'crystal', 'mecha', 'atlantis', 'minecraft',
    'esport_arena', 'dropworks', 'grand_stadium', 'mega_pinball', 'temple_sym',
    'aquarium', 'museum', 'casino', 'subway'
]);

export const SPORTS = Object.freeze({
    [SPORT_IDS.DODGEBALL]: Object.freeze({
        id: SPORT_IDS.DODGEBALL,
        name: 'Dodgeball',
        shortDescription: 'Deflect, redirect and survive escalating rallies.',
        rulesetIds: DODGEBALL_RULESETS,
        mapIds: DODGEBALL_MAPS,
        defaultRulesetId: 'classic',
        defaultMapId: 'beach_open',
        maxPlayers: 8,
        hostEnabled: true,
        localPlayEnabled: true,
        status: 'LIVE'
    }),
    [SPORT_IDS.VOLLEYBALL]: Object.freeze({
        id: SPORT_IDS.VOLLEYBALL,
        name: 'Volleyball',
        shortDescription: 'Serve, receive, set and spike across a locked center court.',
        rulesetIds: Object.freeze(['volleyball_rally_v1']),
        mapIds: Object.freeze(['beach_open']),
        defaultRulesetId: 'volleyball_rally_v1',
        defaultMapId: 'beach_open',
        maxPlayers: 8,
        hostEnabled: false,
        localPlayEnabled: true,
        status: 'IN DEVELOPMENT'
    })
});

export function normalizeSportId(value) {
    const id = String(value || '').trim().toLowerCase();
    return SPORTS[id] ? id : SPORT_IDS.DODGEBALL;
}

export function sportDefinition(value) {
    return SPORTS[normalizeSportId(value)];
}

export function lobbySportId(lobby) {
    // Records created before sport routing had no sportId and are Dodgeball.
    return normalizeSportId(lobby?.sportId);
}

export function resolveSportRoute(input = {}) {
    const sport = sportDefinition(input.sportId);
    const requestedRuleset = String(input.rulesetId || '').trim();
    const requestedMap = String(input.mapId || '').trim();
    return Object.freeze({
        sportId: sport.id,
        rulesetId: sport.rulesetIds.includes(requestedRuleset) ? requestedRuleset : sport.defaultRulesetId,
        mapId: sport.mapIds.includes(requestedMap) ? requestedMap : sport.defaultMapId,
        maxPlayers: sport.maxPlayers,
        hostEnabled: sport.hostEnabled
    });
}

export function canHostSport(value) {
    return sportDefinition(value).hostEnabled === true;
}

export function canPlayLocalSport(value) {
    return sportDefinition(value).localPlayEnabled === true;
}
