#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readEvents(filePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [];
    } catch { return []; }
}

function ratio(numerator, denominator) {
    return {
        numerator,
        denominator,
        rate: denominator > 0 ? Math.round(numerator / denominator * 10000) / 10000 : null
    };
}

function unique(events, predicate, key = event => event.profileKey) {
    return new Set(events.filter(predicate).map(key).filter(Boolean));
}

function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function retention(events, days, now) {
    const sessions = events.filter(event => event.name === 'session_start' && event.profileKey && Number.isFinite(event.serverTimestamp));
    const firstByProfile = new Map();
    for (const event of sessions) {
        const day = dayKey(event.serverTimestamp);
        if (!firstByProfile.has(event.profileKey) || day < firstByProfile.get(event.profileKey)) firstByProfile.set(event.profileKey, day);
    }
    let eligible = 0;
    let returned = 0;
    for (const [profileKey, firstDay] of firstByProfile) {
        const target = new Date(firstDay + 'T00:00:00.000Z');
        target.setUTCDate(target.getUTCDate() + days);
        if (target.getTime() > now) continue;
        eligible += 1;
        const targetDay = dayKey(target.getTime());
        if (sessions.some(event => event.profileKey === profileKey && dayKey(event.serverTimestamp) === targetDay)) returned += 1;
    }
    return ratio(returned, eligible);
}

function lastScreenCounts(events) {
    const sorted = [...events].sort((a, b) => (a.serverTimestamp || 0) - (b.serverTimestamp || 0));
    const last = new Map();
    for (const event of sorted) {
        if (event.name === 'screen_view' && event.profileKey && event.dimensions?.screen) last.set(event.profileKey, event.dimensions.screen);
    }
    const counts = {};
    for (const screen of last.values()) counts[screen] = (counts[screen] || 0) + 1;
    return counts;
}

function firstSessionCompletion(events) {
    const starts = events
        .filter(event => event.name === 'session_start' && event.profileKey && event.sessionId)
        .sort((a, b) => a.serverTimestamp - b.serverTimestamp);
    const firstSessionByProfile = new Map();
    for (const event of starts) {
        if (!firstSessionByProfile.has(event.profileKey)) firstSessionByProfile.set(event.profileKey, event.sessionId);
    }
    const completed = new Set(events
        .filter(event => event.name === 'match_complete' && event.profileKey && event.sessionId)
        .filter(event => firstSessionByProfile.get(event.profileKey) === event.sessionId)
        .map(event => event.profileKey));
    return ratio(completed.size, firstSessionByProfile.size);
}

function buildKpiReport(rawEvents, now = Date.now()) {
    const events = rawEvents.filter(event => event && Number.isFinite(event.serverTimestamp) && event.serverTimestamp <= now);
    const players = new Set(events.map(event => event.profileKey).filter(Boolean));
    const sessions = new Set(events.filter(event => event.name === 'session_start').map(event => event.sessionId).filter(Boolean));
    const sessionEnds = events.filter(event => event.name === 'session_end' && Number.isFinite(event.metrics?.sessionDurationSec));
    const matchStarts = events.filter(event => event.name === 'match_start');
    const matchCompletes = events.filter(event => event.name === 'match_complete');
    const shopViewers = unique(events, event => event.name === 'screen_view' && event.dimensions?.screen === 'shop');
    const purchasers = unique(events, event => event.name === 'shop_purchase_success');
    const ftueViews = unique(events, event => event.name === 'ftue_view');
    const quickClicks = events.filter(event => event.name === 'quick_play_click').length;
    const quickSuccess = events.filter(event => event.name === 'quick_play_success').length;
    const rematchClicks = events.filter(event => event.name === 'rematch_click').length;
    const rematchStarts = events.filter(event => event.name === 'rematch_start').length;
    const networkAttempts = events.filter(event => event.name === 'quick_play_click').length;
    const networkSuccess = events.filter(event => event.name === 'quick_play_success').length;
    const cacheEarns = events.filter(event => event.name === 'arena_cache_earned');
    const cacheOpens = events.filter(event => event.name === 'arena_cache_opened');
    const earnedCaseGrants = events.filter(event => event.name === 'earned_case_granted');
    const earnedCaseOpens = events.filter(event => event.name === 'earned_case_opened');
    const cardEarners = unique(events, event => event.name === 'card_earned');
    const sessionLengthTotal = sessionEnds.reduce((total, event) => total + event.metrics.sessionDurationSec, 0);

    return {
        generatedAt: new Date(now).toISOString(),
        eventCount: events.length,
        uniqueProfiles: players.size,
        retention: { d1: retention(events, 1, now), d7: retention(events, 7, now), d30: retention(events, 30, now) },
        firstSessionCompletion: firstSessionCompletion(events),
        ftueOverlayCompletion: ratio(unique(events, event => event.name === 'ftue_complete').size, ftueViews.size),
        guidedPracticeCompletion: ratio(unique(events, event => event.name === 'practice_complete' && event.dimensions?.practiceType === 'guided_deflect').size, unique(events, event => event.name === 'practice_start' && event.dimensions?.practiceType === 'guided_deflect').size),
        quickPlayToJoin: ratio(quickSuccess, quickClicks),
        quickPlayToMatch: ratio(unique(matchStarts, event => event.dimensions?.entry === 'quick_play').size, unique(events, event => event.name === 'quick_play_click').size),
        matchCompletion: ratio(matchCompletes.length, matchStarts.length),
        rematchRate: ratio(rematchStarts, rematchClicks),
        sessionsPerPlayer: ratio(sessions.size, players.size),
        matchesPerSession: ratio(matchStarts.length, sessions.size),
        averageSessionLengthSec: ratio(sessionLengthTotal, sessionEnds.length),
        churnLastScreen: lastScreenCounts(events),
        shopViewRate: ratio(shopViewers.size, players.size),
        purchaseConversion: ratio(purchasers.size, shopViewers.size),
        cosmeticEquipRate: ratio(unique(events, event => event.name === 'cosmetic_equip').size, shopViewers.size),
        cosmeticMatchUseRate: ratio(unique(events, event => event.name === 'cosmetic_match_use').size, unique(events, event => event.name === 'match_start').size),
        arenaCacheOpenRate: ratio(cacheOpens.length, cacheEarns.length),
        earnedCaseOpenRate: ratio(earnedCaseOpens.length, earnedCaseGrants.length),
        cardEquipRate: ratio(unique(events, event => event.name === 'card_equipped').size, cardEarners.size),
        cardTradeUpRate: ratio(unique(events, event => event.name === 'card_trade_up').size, cardEarners.size),
        p2pConnectSuccess: ratio(networkSuccess, networkAttempts),
        averageJoinLatencyMs: ratio(
            events.filter(event => Number.isFinite(event.metrics?.joinLatencyMs)).reduce((sum, event) => sum + event.metrics.joinLatencyMs, 0),
            events.filter(event => Number.isFinite(event.metrics?.joinLatencyMs)).length
        ),
        notInstrumentedYet: [
            'payerConversion',
            'ARPPU',
            'ARPDAU',
            'battlePassConversion'
        ]
    };
}

if (require.main === module) {
    const fileIndex = process.argv.indexOf('--file');
    const filePath = fileIndex >= 0 ? process.argv[fileIndex + 1] : path.resolve(__dirname, '..', 'data', 'product-analytics.json');
    process.stdout.write(JSON.stringify(buildKpiReport(readEvents(filePath)), null, 2) + '\n');
}

module.exports = { buildKpiReport, readEvents, ratio, retention, firstSessionCompletion };
