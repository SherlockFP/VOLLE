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

// A last rendered menu is a useful diagnostic, but it is not a lifecycle
// outcome. In particular, players can enter a lobby, begin a match, then have
// the final recorded screen remain `lobby`. Keep the legacy screen breakdown
// above, and derive a separate journey stage from ordered product events.
// Reaching a completion/post-game event wins over later launch attempts: this
// is a journey funnel, not an assertion that the last in-progress match ended.
function journeyTerminalStageCounts(events, profileFilter = () => true) {
    const eventsByProfile = new Map();
    for (const event of events) {
        if (!event.profileKey || !profileFilter(event.profileKey)) continue;
        const profileEvents = eventsByProfile.get(event.profileKey) || [];
        profileEvents.push(event);
        eventsByProfile.set(event.profileKey, profileEvents);
    }
    const counts = {
        total: eventsByProfile.size,
        lobbyWithoutMatch: 0,
        matchStartedNotCompleted: 0,
        completedOrPostgame: 0
    };
    for (const profileEvents of eventsByProfile.values()) {
        let startedMatch = false;
        let completedOrPostgame = false;
        profileEvents.sort((a, b) => (a.serverTimestamp || 0) - (b.serverTimestamp || 0));
        for (const event of profileEvents) {
            if (event.name === 'match_start') startedMatch = true;
            if (event.name === 'match_complete'
                || (event.name === 'screen_view' && event.dimensions?.screen === 'postgame')) {
                completedOrPostgame = true;
            }
        }
        if (completedOrPostgame) counts.completedOrPostgame += 1;
        else if (startedMatch) counts.matchStartedNotCompleted += 1;
        else counts.lobbyWithoutMatch += 1;
    }
    return counts;
}

function sampleQuality(players, sampleKind = 'unlabeled') {
    const localQaOrTest = sampleKind === 'local_qa_or_test';
    const productionCohort = sampleKind === 'production_cohort';
    return {
        source: sampleKind,
        totalProfiles: players.size,
        qaOrTestProfileCount: localQaOrTest ? players.size : 0,
        cohortEligibleProfileCount: localQaOrTest ? 0 : players.size,
        retentionClaimsAllowed: productionCohort,
        warning: localQaOrTest
            ? 'LOCAL_QA_OR_TEST_SAMPLE: local QA/test profiles are excluded from retention claims.'
            : productionCohort
                ? null
                : 'UNLABELED_SAMPLE: retention claims require a labeled production cohort.'
    };
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

// A stable matchId is present for real game starts. Legacy events without one
// are deliberately retained rather than guessed into a false identity.
function uniqueMatchLifecycle(events, name) {
    const seen = new Set();
    return events.filter(event => {
        if (event.name !== name) return false;
        const matchId = event.dimensions?.matchId;
        if (!event.profileKey || !matchId) return true;
        const key = `${event.profileKey}:${matchId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function longestSessionDurations(events) {
    const longest = new Map();
    for (const event of events) {
        if ((event.name !== 'session_heartbeat' && event.name !== 'session_end')
            || !event.profileKey || !event.sessionId || !Number.isFinite(event.metrics?.sessionDurationSec)) continue;
        const key = `${event.profileKey}:${event.sessionId}`;
        longest.set(key, Math.max(longest.get(key) || 0, event.metrics.sessionDurationSec));
    }
    return [...longest.values()];
}

function observedMetricAverage(events, eventName, metricName) {
    const observations = events
        .filter(event => event.name === eventName && Number.isFinite(event.metrics?.[metricName]))
        .map(event => event.metrics[metricName]);
    return ratio(observations.reduce((sum, value) => sum + value, 0), observations.length);
}

function paymentMetrics(events, activeSessionStarts) {
    const payments = events.filter(event => event.name === 'payment_completed'
        && event.profileKey
        && /^[A-Z]{3}$/.test(event.dimensions?.currency || '')
        && Number.isSafeInteger(event.metrics?.revenueMinor)
        && event.metrics.revenueMinor >= 0);
    const byCurrency = {};
    const activeProfiles = new Set(activeSessionStarts.map(event => event.profileKey));
    const activeProfileDays = new Set(activeSessionStarts.map(event => `${dayKey(event.serverTimestamp)}:${event.profileKey}`));
    for (const payment of payments) {
        const currency = payment.dimensions.currency;
        const group = byCurrency[currency] || (byCurrency[currency] = { payers: new Set(), activePayers: new Set(), revenueMinor: 0, activeProfileDays: new Set() });
        group.payers.add(payment.profileKey);
        if (activeProfiles.has(payment.profileKey)) group.activePayers.add(payment.profileKey);
        group.revenueMinor += payment.metrics.revenueMinor;
    }
    // ARPDAU is intentionally reported per currency: monetary units are never
    // added together. DAU is session-start activity only; a payment or a lone
    // heartbeat never creates a player/day in the denominator.
    for (const payment of payments) {
        const group = byCurrency[payment.dimensions.currency];
        const day = dayKey(payment.serverTimestamp);
        for (const key of activeProfileDays) if (key.startsWith(day + ':')) group.activeProfileDays.add(key);
    }
    return Object.fromEntries(Object.entries(byCurrency).map(([currency, group]) => [currency, {
        payerConversion: ratio(group.activePayers.size, activeProfiles.size),
        // ARPPU includes all verified payers/revenue, even if a payment arrived
        // outside the observable active-session cohort.
        ARPPU: ratio(group.revenueMinor, group.payers.size),
        ARPDAU: ratio(group.revenueMinor, group.activeProfileDays.size),
        revenueMinor: group.revenueMinor
    }]));
}

function rematchPropensity(events, completedMatches) {
    const completeByProfileAndMatch = new Set(completedMatches
        .filter(event => event.profileKey && event.dimensions?.matchId)
        .map(event => `${event.profileKey}:${event.dimensions.matchId}`));
    const startsAfterCompletion = unique(events, event => event.name === 'rematch_start'
        && event.profileKey
        && event.dimensions?.source
        && completeByProfileAndMatch.has(`${event.profileKey}:${event.dimensions.source}`), event => `${event.profileKey}:${event.dimensions.source}`);
    return ratio(startsAfterCompletion.size, completedMatches.length);
}

function buildKpiReport(rawEvents, now = Date.now(), options = {}) {
    const events = rawEvents.filter(event => event && Number.isFinite(event.serverTimestamp) && event.serverTimestamp <= now);
    const players = new Set(events.map(event => event.profileKey).filter(Boolean));
    const activeSessionStarts = events.filter(event => event.name === 'session_start' && event.profileKey && event.sessionId);
    const sessions = new Set(events.filter(event => event.name === 'session_start').map(event => event.sessionId).filter(Boolean));
    const matchStarts = uniqueMatchLifecycle(events, 'match_start');
    const matchCompletes = uniqueMatchLifecycle(events, 'match_complete');
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
    const sessionDurations = longestSessionDurations(events);
    const paidRevenueByCurrency = paymentMetrics(events, activeSessionStarts);
    const lastScreenByProfile = new Map();
    for (const event of [...events].sort((a, b) => (a.serverTimestamp || 0) - (b.serverTimestamp || 0))) {
        if (event.name === 'screen_view' && event.profileKey && event.dimensions?.screen) {
            lastScreenByProfile.set(event.profileKey, event.dimensions.screen);
        }
    }
    const allJourneyStages = journeyTerminalStageCounts(events);
    const lobbyJourneyStages = journeyTerminalStageCounts(events, profileKey => lastScreenByProfile.get(profileKey) === 'lobby');

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
        // CTA reliability measures click -> launch. Propensity is distinct and
        // only credits starts linked to a completed source match.
        rematchClickToStart: ratio(rematchStarts, rematchClicks),
        rematchRate: ratio(rematchStarts, rematchClicks),
        rematchPropensityAfterMatch: rematchPropensity(events, matchCompletes),
        sessionsPerPlayer: ratio(sessions.size, players.size),
        matchesPerSession: ratio(matchStarts.length, sessions.size),
        averageSessionLengthSec: ratio(sessionDurations.reduce((total, duration) => total + duration, 0), sessionDurations.length),
        averageMatchDurationSec: observedMetricAverage(events, 'match_complete', 'matchDurationSec'),
        averagePostgameDelaySec: observedMetricAverage(events, 'match_complete', 'postgameDelaySec'),
        averagePostgameToRematchSec: observedMetricAverage(events, 'rematch_click', 'postgameToRematchSec'),
        averageMatchLoadElapsedMs: observedMetricAverage(events, 'match_start', 'matchLoadElapsedMs'),
        averageMatchSetupMs: observedMetricAverage(events, 'match_start', 'matchSetupMs'),
        averageClickToCountdownMs: observedMetricAverage(events, 'match_start', 'clickToCountdownMs'),
        churnLastScreen: lastScreenCounts(events),
        journeyTerminalStage: {
            ...allJourneyStages,
            lastLobbyScreen: lobbyJourneyStages
        },
        sampleQuality: sampleQuality(players, options.sampleKind),
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
        paidRevenueByCurrency,
        payerConversion: Object.fromEntries(Object.entries(paidRevenueByCurrency).map(([currency, metrics]) => [currency, metrics.payerConversion])),
        ARPPU: Object.fromEntries(Object.entries(paidRevenueByCurrency).map(([currency, metrics]) => [currency, metrics.ARPPU])),
        ARPDAU: Object.fromEntries(Object.entries(paidRevenueByCurrency).map(([currency, metrics]) => [currency, metrics.ARPDAU])),
        // The current catalogue has only soft-currency BP unlocks. Do not
        // relabel those as a paid conversion before a signed paid BP SKU exists.
        softBattlePass: {
            unlocks: unique(events, event => event.name === 'battlepass_premium_unlocked' && event.dimensions?.source === 'soft_currency').size,
            rewardClaims: events.filter(event => event.name === 'battlepass_reward_claimed').length
        },
        paidBattlePassConversion: { numerator: 0, denominator: 0, rate: null, status: 'NOT_AVAILABLE_NO_PAID_BP_SKU' },
        notInstrumentedYet: [
            'paidBattlePassConversion'
        ]
    };
}

if (require.main === module) {
    const fileIndex = process.argv.indexOf('--file');
    const filePath = fileIndex >= 0 ? process.argv[fileIndex + 1] : path.resolve(__dirname, '..', 'data', 'product-analytics.json');
    const sampleIndex = process.argv.indexOf('--sample');
    const sampleKind = sampleIndex >= 0
        ? process.argv[sampleIndex + 1]
        : path.resolve(filePath) === path.resolve(__dirname, '..', 'data', 'product-analytics.json')
            ? 'local_qa_or_test'
            : 'unlabeled';
    process.stdout.write(JSON.stringify(buildKpiReport(readEvents(filePath), Date.now(), { sampleKind }), null, 2) + '\n');
}

module.exports = { buildKpiReport, readEvents, ratio, retention, firstSessionCompletion, uniqueMatchLifecycle, longestSessionDurations, observedMetricAverage, paymentMetrics, rematchPropensity, journeyTerminalStageCounts, sampleQuality };
