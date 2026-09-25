// Match outcome facts for balance tuning. They ride on the existing
// `match_complete` product event (js/product-analytics.js), so they share its
// allowlists: only short ids and bounded counts leave the client, never names.
// scripts/balance-report.js turns the stored events into win rates per bot
// difficulty, map, mode, character and team size.
const VALUE = /^[a-zA-Z0-9._:-]{1,40}$/;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

const safeId = (value, fallback) => (VALUE.test(String(value ?? '')) ? String(value) : fallback);
const bounded = (value, max) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

// Largest round deficit the player's team faced (from scoreboard.roundHistory,
// running red/blue totals). A win after trailing by two or more is a comeback.
export function maxRoundDeficit(roundHistory = [], team = 'red') {
    let deficit = 0;
    for (const entry of Array.isArray(roundHistory) ? roundHistory : []) {
        const mine = team === 'blue' ? entry?.blue : entry?.red;
        const theirs = team === 'blue' ? entry?.red : entry?.blue;
        if (Number.isFinite(mine) && Number.isFinite(theirs)) deficit = Math.max(deficit, theirs - mine);
    }
    return deficit;
}

// players: game.getPlayerList() ({ team, isBot, isYou }); bots: game.bots
// ({ team, difficulty }). Returns { dimensions, metrics } for match_complete.
export function matchOutcomeFacts({
    queue = 'solo', mapId = '', result = 'loss', team = 'red', ffa = false, character = '',
    players = [], bots = [], redScore = 0, blueScore = 0, roundHistory = [],
    kills = 0, deaths = 0, bestRally = 0
} = {}) {
    const list = Array.isArray(players) ? players : [];
    const enemyBots = (Array.isArray(bots) ? bots : []).filter(bot => ffa || bot?.team !== team);
    const levels = new Set(enemyBots.map(bot => (DIFFICULTIES.has(bot?.difficulty) ? bot.difficulty : 'other')));
    const difficulty = !levels.size ? 'none' : levels.size === 1 ? [...levels][0] : 'mixed';
    const mine = list.filter(player => player?.team === team).length;
    const teamSize = ffa ? `ffa${bounded(list.length, 32)}` : `${bounded(mine, 32)}v${bounded(list.length - mine, 32)}`;
    const map = String(mapId || '').startsWith('custom-') ? 'custom' : safeId(mapId, 'unknown');
    const won = team === 'blue' ? blueScore : redScore;
    const lost = team === 'blue' ? redScore : blueScore;
    return {
        dimensions: {
            queue: ['solo', 'casual', 'ranked'].includes(queue) ? queue : 'solo',
            map,
            result: ['win', 'loss', 'draw'].includes(result) ? result : 'loss',
            difficulty,
            character: safeId(character, 'unknown'),
            teamSize
        },
        metrics: {
            roundsWon: ffa ? 0 : bounded(won, 99),
            roundsLost: ffa ? 0 : bounded(lost, 99),
            maxDeficit: ffa ? 0 : bounded(maxRoundDeficit(roundHistory, team), 99),
            kills: bounded(kills, 999),
            deaths: bounded(deaths, 999),
            bestRally: bounded(bestRally, 999),
            botCount: bounded(list.filter(player => player?.isBot).length, 32),
            humanCount: bounded(list.filter(player => !player?.isBot).length, 32)
        }
    };
}
