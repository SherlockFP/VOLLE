#!/usr/bin/env node
// Balance report from stored match outcomes: the `match_complete` product events
// that carry js/balance-outcome.js facts. Groups by solo bot difficulty, map,
// game mode, character and team size, and flags groups with enough matches
// whose win rate sits outside a target band.
//
//   node scripts/balance-report.js [--file data/product-analytics.json] [--min 20] [--days 30]
const path = require('path');
const { readEvents } = require('./product-kpi-report');

// Solo win-rate bands a player should see per bot difficulty; PvP groups
// (maps, characters, team sizes) should stay near a coin flip.
const DIFFICULTY_BANDS = Object.freeze({ easy: [0.65, 0.92], medium: [0.4, 0.65], hard: [0.15, 0.45] });
const FAIR_BAND = Object.freeze([0.4, 0.6]);

const round4 = value => Math.round(value * 10000) / 10000;

function summarize(events) {
    const matches = events.length;
    const wins = events.filter(event => event.dimensions.result === 'win').length;
    const draws = events.filter(event => event.dimensions.result === 'draw').length;
    const margins = events.map(event => (event.metrics?.roundsWon || 0) - (event.metrics?.roundsLost || 0));
    const durations = events.map(event => event.metrics?.matchDurationSec).filter(Number.isFinite);
    const rallies = events.map(event => event.metrics?.bestRally).filter(Number.isFinite);
    const avg = list => (list.length ? round4(list.reduce((sum, value) => sum + value, 0) / list.length) : null);
    return {
        matches,
        winRate: matches ? round4(wins / matches) : null,
        drawRate: matches ? round4(draws / matches) : null,
        avgRoundMargin: avg(margins),
        // A close match ends one round apart (or level); a comeback is a win
        // after trailing by two or more rounds.
        closeRate: matches ? round4(margins.filter(margin => Math.abs(margin) <= 1).length / matches) : null,
        comebackRate: matches ? round4(events.filter(event => event.dimensions.result === 'win' && (event.metrics?.maxDeficit || 0) >= 2).length / matches) : null,
        avgDurationSec: avg(durations),
        avgBestRally: avg(rallies)
    };
}

function groupBy(events, key) {
    const groups = new Map();
    for (const event of events) {
        const value = typeof key === 'function' ? key(event) : event.dimensions[key];
        if (!value) continue;
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(event);
    }
    return Object.fromEntries([...groups].sort((a, b) => b[1].length - a[1].length).map(([value, list]) => [value, summarize(list)]));
}

function buildBalanceReport(allEvents, now = Date.now(), { minMatches = 20, days = 30 } = {}) {
    const since = now - days * 24 * 60 * 60 * 1000;
    const events = allEvents.filter(event => event?.name === 'match_complete'
        && ['win', 'loss', 'draw'].includes(event.dimensions?.result)
        && (!Number.isFinite(event.serverTimestamp) || event.serverTimestamp >= since));
    const solo = events.filter(event => event.dimensions.queue === 'solo');
    const pvp = events.filter(event => event.dimensions.queue !== 'solo' && event.metrics?.botCount === 0);
    const report = {
        generatedAt: new Date(now).toISOString(),
        windowDays: days,
        minMatches,
        overall: summarize(events),
        byQueue: groupBy(events, 'queue'),
        soloByDifficulty: groupBy(solo, 'difficulty'),
        byMap: groupBy(events, 'map'),
        byMode: groupBy(events, 'mode'),
        byTeamSize: groupBy(events, 'teamSize'),
        // Characters and maps are only judged on human-vs-human matches: a bot
        // opponent's difficulty would swamp them.
        pvpByCharacter: groupBy(pvp, 'character'),
        pvpByMap: groupBy(pvp, 'map'),
        flags: []
    };
    const check = (section, name, stats, [low, high]) => {
        if (stats.matches < minMatches || stats.winRate === null) return;
        if (stats.winRate < low) report.flags.push({ section, name, winRate: stats.winRate, matches: stats.matches, issue: `win rate below ${low}` });
        else if (stats.winRate > high) report.flags.push({ section, name, winRate: stats.winRate, matches: stats.matches, issue: `win rate above ${high}` });
    };
    for (const [name, stats] of Object.entries(report.soloByDifficulty)) if (DIFFICULTY_BANDS[name]) check('soloByDifficulty', name, stats, DIFFICULTY_BANDS[name]);
    for (const [name, stats] of Object.entries(report.pvpByCharacter)) check('pvpByCharacter', name, stats, FAIR_BAND);
    // Team sizes are listed, not judged: an even PvP match reports one win per
    // loss (about 0.5 by construction) and 2v1 is lopsided on purpose.
    return report;
}

if (require.main === module) {
    const arg = (flag, fallback) => {
        const index = process.argv.indexOf(flag);
        return index >= 0 ? process.argv[index + 1] : fallback;
    };
    const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');
    const filePath = arg('--file', path.join(dataDir, 'product-analytics.json'));
    const report = buildBalanceReport(readEvents(filePath), Date.now(), {
        minMatches: Math.max(1, Number(arg('--min', 20)) || 20),
        days: Math.max(1, Number(arg('--days', 30)) || 30)
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

module.exports = { buildBalanceReport, summarize, DIFFICULTY_BANDS, FAIR_BAND };
