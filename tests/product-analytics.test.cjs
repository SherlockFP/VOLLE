const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProductAnalyticsStore, normalizeProductEvent, profileKey } = require('../server/product-analytics');
const { buildKpiReport } = require('../scripts/product-kpi-report');

const secret = 'test-product-analytics-secret-that-is-long-enough';
const now = Date.UTC(2026, 7, 11);
const base = (overrides = {}) => ({
    eventId: 'product_event_123456',
    sessionId: 'session_123456',
    name: 'session_start',
    dimensions: { screen: 'mainMenu' },
    metrics: {},
    ...overrides
});

test('product analytics normalizes only allowlisted, non-identifying fields', () => {
    const event = normalizeProductEvent(base(), 'profile_123456', secret, now);
    assert.equal(event.profileKey, profileKey(secret, 'profile_123456'));
    assert.equal(event.serverTimestamp, now);
    assert.equal(event.dimensions.screen, 'mainMenu');
    assert.equal(normalizeProductEvent(base({ dimensions: { playerName: 'Sher' } }), 'profile_123456', secret, now), null);
    assert.equal(normalizeProductEvent(base({ metrics: { positionX: 10 } }), 'profile_123456', secret, now), null);
    assert.equal(normalizeProductEvent(base({ dimensions: { screen: 'free text is rejected' } }), 'profile_123456', secret, now), null);
});

test('server accepts bounded pacing metrics and rejects fabricated extremes', () => {
    const complete = normalizeProductEvent(base({
        name: 'match_complete',
        metrics: { matchDurationSec: 92.35, postgameDelaySec: 8.13 }
    }), 'profile_123456', secret, now);
    const rematch = normalizeProductEvent(base({
        name: 'rematch_click', metrics: { postgameToRematchSec: 4.57 }
    }), 'profile_123456', secret, now);
    assert.deepEqual(complete.metrics, { matchDurationSec: 92.35, postgameDelaySec: 8.13 });
    assert.deepEqual(rematch.metrics, { postgameToRematchSec: 4.57 });
    assert.equal(normalizeProductEvent(base({
        name: 'match_complete', metrics: { postgameDelaySec: 301 }
    }), 'profile_123456', secret, now), null);
    assert.equal(normalizeProductEvent(base({
        name: 'rematch_click', metrics: { postgameToRematchSec: 3601 }
    }), 'profile_123456', secret, now), null);
    assert.deepEqual(normalizeProductEvent(base({
        name: 'match_start', metrics: { matchLoadElapsedMs: 950.12, matchSetupMs: 12.34, clickToCountdownMs: 962.46 }
    }), 'profile_123456', secret, now)?.metrics, { matchLoadElapsedMs: 950.12, matchSetupMs: 12.34, clickToCountdownMs: 962.46 });
    assert.equal(normalizeProductEvent(base({
        name: 'match_start', metrics: { clickToCountdownMs: 60001 }
    }), 'profile_123456', secret, now), null);
});

test('card progression events accept bounded product dimensions without social data', () => {
    const event = normalizeProductEvent(base({
        name: 'card_trade_up',
        dimensions: { itemId: 'curve_drive', itemType: 'epic', result: 'rare' }
    }), 'profile_123456', secret, now);
    assert.equal(event.name, 'card_trade_up');
    assert.deepEqual(event.dimensions, { itemId: 'curve_drive', itemType: 'epic', result: 'rare' });
    assert.equal(normalizeProductEvent(base({
        name: 'card_earned', dimensions: { playerName: 'Sher' }
    }), 'profile_123456', secret, now), null);
});

test('party queue analytics retains only anonymous queue outcomes', () => {
    const start = normalizeProductEvent(base({
        name: 'party_queue_start', dimensions: { queue: 'casual', source: 'party' }
    }), 'profile_123456', secret, now);
    const follow = normalizeProductEvent(base({
        eventId: 'product_event_654321', name: 'party_queue_follow_success', dimensions: { queue: 'casual', source: 'party', result: 'joined' }
    }), 'profile_123456', secret, now);
    assert.equal(start?.name, 'party_queue_start');
    assert.equal(follow?.name, 'party_queue_follow_success');
    assert.equal(normalizeProductEvent(base({
        name: 'party_queue_follow_failure', dimensions: { lobbyCode: 'private-room' }
    }), 'profile_123456', secret, now), null);
});

test('battle pass progression events are accepted from the authenticated client while revenue remains server-only', () => {
    const premium = normalizeProductEvent(base({
        name: 'battlepass_premium_unlocked', dimensions: { source: 'soft_currency' }
    }), 'profile_123456', secret, now);
    const claim = normalizeProductEvent(base({
        eventId: 'product_event_654321', name: 'battlepass_reward_claimed',
        dimensions: { itemId: 'reward_1', itemType: 'premium', source: 'battlepass' }
    }), 'profile_123456', secret, now);
    const boost = normalizeProductEvent(base({
        eventId: 'product_event_765432', name: 'battlepass_boost_activated',
        dimensions: { itemId: 'bp-1-5', source: 'battlepass' }
    }), 'profile_123456', secret, now);
    assert.equal(premium?.name, 'battlepass_premium_unlocked');
    assert.equal(claim?.name, 'battlepass_reward_claimed');
    assert.equal(boost?.name, 'battlepass_boost_activated');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-product-bp-'));
    const store = new ProductAnalyticsStore(path.join(dir, 'events.json'), { secret, now: () => now });
    assert.deepEqual(store.ingest('profile_123456', { events: [
        base({ name: 'battlepass_premium_unlocked', dimensions: { source: 'soft_currency' } }),
        base({ eventId: 'product_event_654321', name: 'battlepass_reward_claimed', dimensions: { itemId: 'reward_1', itemType: 'premium', source: 'battlepass' } }),
        base({ eventId: 'product_event_765432', name: 'battlepass_boost_activated', dimensions: { itemId: 'bp-1-5', source: 'battlepass' } })
    ] }), { status: 202, accepted: 3, replayed: 0, rejected: 0 });
    fs.rmSync(dir, { recursive: true, force: true });
});

test('FTUE exit is a bounded client event', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-product-ftue-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new ProductAnalyticsStore(path.join(dir, 'events.json'), { secret, now: () => now });
    const result = store.ingest('profile_123456', base({
        name: 'ftue_exit', dimensions: { reason: 'escape', source: 'first_run' }
    }));
    assert.deepEqual(result, { status: 202, accepted: 1, replayed: 0, rejected: 0 });
});

test('product events endpoint is authenticated and rate limited', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /urlPath === '\/api\/product-events' && req\.method === 'POST'/);
    assert.match(server, /allowRequest\(req, res, 'productAnalytics'\)/);
    assert.match(server, /requireAuth\(req, res, body\)\?\.profile/);
    assert.match(server, /event\.status === 'paid' && \(result\.applied === true \|\| result\.replayed === true\)\) productAnalytics\.recordPaymentCompleted\(event\.profileId, event\)/);
});

test('paid webhook analytics is server-only, pseudonymous, and replay safe', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-product-payment-'));
    const store = new ProductAnalyticsStore(path.join(dir, 'events.json'), { secret, now: () => now });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const payment = { eventId: 'evt_12345678', transactionId: 'txn_12345678', provider: 'testpay', sku: 'gems_100', currency: 'USD', amountMinor: 199 };
    assert.deepEqual(store.recordPaymentCompleted('profile_123456', payment), { status: 202, applied: true, replayed: false });
    assert.deepEqual(store.recordPaymentCompleted('profile_123456', payment), { status: 200, applied: false, replayed: true });
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0].name, 'payment_completed');
    assert.equal(store.events[0].profileKey, profileKey(secret, 'profile_123456'));
    assert.equal(JSON.stringify(store.events[0]).includes('profile_123456'), false);
    assert.equal(JSON.stringify(store.events[0]).includes('txn_12345678'), false);
    assert.deepEqual(store.events[0].dimensions, { sku: 'gems_100', currency: 'USD', provider: 'testpay' });
    assert.equal(store.events[0].metrics.revenueMinor, 199);
    assert.deepEqual(store.recordPaymentCompleted('profile_123456', { ...payment, eventId: 'evt_retry_12345678' }), { status: 200, applied: false, replayed: true }, 'same transaction backfill stays once-only');
    assert.equal(normalizeProductEvent(base({ name: 'payment_completed' }), 'profile_123456', secret, now), null);
});

test('product analytics deduplicates, batches, and retains only recent bounded events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-product-'));
    const file = path.join(dir, 'events.json');
    const clock = { now };
    const store = new ProductAnalyticsStore(file, { secret, maxEvents: 2, retentionMs: 90 * 24 * 60 * 60 * 1000, now: () => clock.now });
    const first = store.ingest('profile_123456', { events: [
        base(),
        base({ eventId: 'product_event_654321', name: 'shop_inspect', dimensions: { itemType: 'avatar', itemId: 'frost' } })
    ] });
    assert.deepEqual(first, { status: 202, accepted: 2, replayed: 0, rejected: 0 });
    const replay = store.ingest('profile_123456', base());
    assert.equal(replay.replayed, 1);
    store.ingest('profile_123456', base({ eventId: 'product_event_777777', name: 'match_start' }));
    assert.equal(store.events.length, 2);
    clock.now += 91 * 24 * 60 * 60 * 1000;
    store.ingest('profile_123456', base({ eventId: 'product_event_888888', name: 'session_start' }));
    assert.equal(store.events.length, 1, 'expired events are pruned before saving');
});

test('KPI report uses first-session completion and returns null for insufficient denominators', () => {
    const day0 = Date.UTC(2026, 7, 1);
    const events = [
        { ...base({ eventId: 'product_event_a00001', sessionId: 'session_a00001' }), profileKey: 'a', serverTimestamp: day0 },
        { ...base({ eventId: 'product_event_a00002', sessionId: 'session_a00001', name: 'match_complete' }), profileKey: 'a', serverTimestamp: day0 + 1000 },
        { ...base({ eventId: 'product_event_b00001', sessionId: 'session_b00001' }), profileKey: 'b', serverTimestamp: day0 },
        { ...base({ eventId: 'product_event_b00002', sessionId: 'session_b00002', name: 'match_complete' }), profileKey: 'b', serverTimestamp: day0 + 2000 }
    ];
    const report = buildKpiReport(events, day0 + 2 * 24 * 60 * 60 * 1000);
    assert.deepEqual(report.firstSessionCompletion, { numerator: 1, denominator: 2, rate: 0.5 });
    assert.deepEqual(report.ftueOverlayCompletion, { numerator: 0, denominator: 0, rate: null });
    assert.deepEqual(report.retention.d7, { numerator: 0, denominator: 0, rate: null });
    assert.ok(report.notInstrumentedYet.includes('paidBattlePassConversion'));
});

test('KPI report distinguishes lobby screen diagnostics from lifecycle-derived journey stages', () => {
    const events = [
        { ...base({ eventId: 'product_stage_a001', name: 'screen_view', dimensions: { screen: 'lobby' } }), profileKey: 'qa-profile-lobby', serverTimestamp: now },
        { ...base({ eventId: 'product_stage_b001', name: 'screen_view', dimensions: { screen: 'lobby' } }), profileKey: 'qa-profile-started', serverTimestamp: now + 1 },
        { ...base({ eventId: 'product_stage_b002', name: 'match_start', dimensions: { matchId: 'match_stage_b' } }), profileKey: 'qa-profile-started', serverTimestamp: now + 2 },
        { ...base({ eventId: 'product_stage_c001', name: 'screen_view', dimensions: { screen: 'lobby' } }), profileKey: 'qa-profile-completed', serverTimestamp: now + 3 },
        { ...base({ eventId: 'product_stage_c002', name: 'match_start', dimensions: { matchId: 'match_stage_c' } }), profileKey: 'qa-profile-completed', serverTimestamp: now + 4 },
        { ...base({ eventId: 'product_stage_c003', name: 'match_complete', dimensions: { matchId: 'match_stage_c' } }), profileKey: 'qa-profile-completed', serverTimestamp: now + 5 },
        { ...base({ eventId: 'product_stage_c004', name: 'match_start', dimensions: { matchId: 'match_stage_c2' } }), profileKey: 'qa-profile-completed', serverTimestamp: now + 6 }
    ];
    const report = buildKpiReport(events, now + 10, { sampleKind: 'local_qa_or_test' });
    assert.equal(report.churnLastScreen.lobby, 3, 'legacy screen diagnostic remains available');
    assert.deepEqual(report.journeyTerminalStage.lastLobbyScreen, {
        total: 3,
        lobbyWithoutMatch: 1,
        matchStartedNotCompleted: 1,
        completedOrPostgame: 1
    });
    assert.deepEqual(report.sampleQuality, {
        source: 'local_qa_or_test',
        totalProfiles: 3,
        qaOrTestProfileCount: 3,
        cohortEligibleProfileCount: 0,
        retentionClaimsAllowed: false,
        warning: 'LOCAL_QA_OR_TEST_SAMPLE: local QA/test profiles are excluded from retention claims.'
    });
    assert.equal(JSON.stringify(report).includes('qa-profile-'), false, 'report exposes aggregate counts only');
});

test('KPI report exposes Arena Cache and card engagement without inventing denominators', () => {
    const events = [
        { ...base({ eventId: 'product_card_a00001', name: 'arena_cache_earned' }), profileKey: 'a', serverTimestamp: now },
        { ...base({ eventId: 'product_card_a00002', name: 'arena_cache_opened' }), profileKey: 'a', serverTimestamp: now + 1 },
        { ...base({ eventId: 'product_card_a00003', name: 'card_earned' }), profileKey: 'a', serverTimestamp: now + 2 },
        { ...base({ eventId: 'product_card_a00004', name: 'card_equipped' }), profileKey: 'a', serverTimestamp: now + 3 },
        { ...base({ eventId: 'product_case_a00001', name: 'earned_case_granted' }), profileKey: 'a', serverTimestamp: now + 4 },
        { ...base({ eventId: 'product_case_a00002', name: 'earned_case_opened' }), profileKey: 'a', serverTimestamp: now + 5 }
    ];
    const report = buildKpiReport(events, now + 10);
    assert.deepEqual(report.arenaCacheOpenRate, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(report.earnedCaseOpenRate, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(report.cardEquipRate, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(report.cardTradeUpRate, { numerator: 0, denominator: 1, rate: 0 });
    assert.equal(buildKpiReport([], now).arenaCacheOpenRate.rate, null);
    assert.equal(buildKpiReport([], now).earnedCaseOpenRate.rate, null);
});

test('KPI report separates mixed-currency revenue, excludes soft BP from paid conversion, and uses longest session duration', () => {
    const events = [
        { ...base({ eventId: 'product_sess_a0001', sessionId: 'session_a00001' }), profileKey: 'a', serverTimestamp: now },
        { ...base({ eventId: 'product_sess_a0002', sessionId: 'session_a00001', name: 'session_heartbeat', metrics: { sessionDurationSec: 50 } }), profileKey: 'a', serverTimestamp: now + 50 },
        { ...base({ eventId: 'product_sess_a0003', sessionId: 'session_a00001', name: 'session_end', metrics: { sessionDurationSec: 40 } }), profileKey: 'a', serverTimestamp: now + 60 },
        { ...base({ eventId: 'product_sess_b0001', sessionId: 'session_b00001' }), profileKey: 'b', serverTimestamp: now },
        { ...base({ eventId: 'product_sess_b0002', sessionId: 'session_b00001', name: 'session_end', metrics: { sessionDurationSec: 10 } }), profileKey: 'b', serverTimestamp: now + 60 },
        { ...base({ eventId: 'product_pay_usd001', name: 'payment_completed', dimensions: { currency: 'USD', sku: 'gems_100', provider: 'testpay' }, metrics: { revenueMinor: 199 } }), profileKey: 'a', serverTimestamp: now + 70 },
        { ...base({ eventId: 'product_pay_eur001', name: 'payment_completed', dimensions: { currency: 'EUR', sku: 'gems_100', provider: 'testpay' }, metrics: { revenueMinor: 299 } }), profileKey: 'b', serverTimestamp: now + 80 },
        { ...base({ eventId: 'product_bp_soft001', name: 'battlepass_premium_unlocked', dimensions: { source: 'soft_currency' } }), profileKey: 'a', serverTimestamp: now + 90 },
        { ...base({ eventId: 'product_bp_claim01', name: 'battlepass_reward_claimed', dimensions: { itemId: 'reward_1', itemType: 'premium', source: 'battlepass' } }), profileKey: 'a', serverTimestamp: now + 100 }
    ];
    const report = buildKpiReport(events, now + 1000);
    assert.deepEqual(report.averageSessionLengthSec, { numerator: 60, denominator: 2, rate: 30 });
    assert.equal(report.paidRevenueByCurrency.USD.revenueMinor, 199);
    assert.equal(report.paidRevenueByCurrency.EUR.revenueMinor, 299);
    assert.equal(report.paidRevenueByCurrency.USD.ARPPU.rate, 199);
    assert.deepEqual(report.payerConversion.USD, { numerator: 1, denominator: 2, rate: 0.5 });
    assert.equal(report.ARPPU.EUR.rate, 299);
    assert.equal(report.ARPDAU.USD.rate, 99.5);
    assert.equal(report.softBattlePass.unlocks, 1);
    assert.equal(report.softBattlePass.rewardClaims, 1);
    assert.deepEqual(report.paidBattlePassConversion, { numerator: 0, denominator: 0, rate: null, status: 'NOT_AVAILABLE_NO_PAID_BP_SKU' });
});

test('KPI report deduplicates stable match lifecycle ids and ties rematches to a completed source match', () => {
    const events = [
        { ...base({ eventId: 'product_match_start1', name: 'match_start', dimensions: { matchId: 'match_12345678' } }), profileKey: 'a', serverTimestamp: now },
        { ...base({ eventId: 'product_match_start2', name: 'match_start', dimensions: { matchId: 'match_12345678' } }), profileKey: 'a', serverTimestamp: now + 1 },
        { ...base({ eventId: 'product_match_done01', name: 'match_complete', dimensions: { matchId: 'match_12345678' } }), profileKey: 'a', serverTimestamp: now + 2 },
        { ...base({ eventId: 'product_rematch001', name: 'rematch_click', dimensions: { source: 'match_12345678' } }), profileKey: 'a', serverTimestamp: now + 3 },
        { ...base({ eventId: 'product_rematch002', name: 'rematch_start', dimensions: { source: 'match_12345678', matchId: 'match_87654321' } }), profileKey: 'a', serverTimestamp: now + 4 }
    ];
    const report = buildKpiReport(events, now + 10);
    assert.deepEqual(report.matchCompletion, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(report.rematchClickToStart, { numerator: 1, denominator: 1, rate: 1 });
    assert.deepEqual(report.rematchPropensityAfterMatch, { numerator: 1, denominator: 1, rate: 1 });
});

test('KPI report averages only observed match and postgame pacing samples', () => {
    const events = [
        { ...base({ eventId: 'product_pacing_a01', name: 'match_complete', metrics: { matchDurationSec: 90, postgameDelaySec: 8 } }), profileKey: 'a', serverTimestamp: now },
        { ...base({ eventId: 'product_pacing_b01', name: 'match_complete', metrics: { matchDurationSec: 150 } }), profileKey: 'b', serverTimestamp: now + 1 },
        { ...base({ eventId: 'product_pacing_a02', name: 'rematch_click', metrics: { postgameToRematchSec: 4 } }), profileKey: 'a', serverTimestamp: now + 2 },
        { ...base({ eventId: 'product_pacing_b02', name: 'rematch_click' }), profileKey: 'b', serverTimestamp: now + 3 }
    ];
    const report = buildKpiReport(events, now + 10);
    assert.deepEqual(report.averageMatchDurationSec, { numerator: 240, denominator: 2, rate: 120 });
    assert.deepEqual(report.averagePostgameDelaySec, { numerator: 8, denominator: 1, rate: 8 });
    assert.deepEqual(report.averagePostgameToRematchSec, { numerator: 4, denominator: 1, rate: 4 });
    const empty = buildKpiReport([], now);
    assert.deepEqual(empty.averageMatchDurationSec, { numerator: 0, denominator: 0, rate: null });
    assert.deepEqual(empty.averagePostgameDelaySec, { numerator: 0, denominator: 0, rate: null });
    assert.deepEqual(empty.averagePostgameToRematchSec, { numerator: 0, denominator: 0, rate: null });
});

test('KPI report separates loader, synchronous setup, and click-to-countdown samples', () => {
    const events = [
        { ...base({ eventId: 'product_launch_a001', name: 'match_start', metrics: { matchLoadElapsedMs: 950, matchSetupMs: 20, clickToCountdownMs: 970 } }), profileKey: 'a', serverTimestamp: now },
        { ...base({ eventId: 'product_launch_b001', name: 'match_start', metrics: { matchLoadElapsedMs: 1250, clickToCountdownMs: 1300 } }), profileKey: 'b', serverTimestamp: now + 1 }
    ];
    const report = buildKpiReport(events, now + 10);
    assert.deepEqual(report.averageMatchLoadElapsedMs, { numerator: 2200, denominator: 2, rate: 1100 });
    assert.deepEqual(report.averageMatchSetupMs, { numerator: 20, denominator: 1, rate: 20 });
    assert.deepEqual(report.averageClickToCountdownMs, { numerator: 2270, denominator: 2, rate: 1135 });
});

test('payment-only activity never inflates session-start payer conversion or ARPDAU', () => {
    const events = [
        { ...base({ eventId: 'product_pay_only1', name: 'payment_completed', dimensions: { currency: 'USD', sku: 'gems_100', provider: 'testpay' }, metrics: { revenueMinor: 199 } }), profileKey: 'payment-only', serverTimestamp: now },
        { ...base({ eventId: 'product_heart_only', name: 'session_heartbeat', metrics: { sessionDurationSec: 30 } }), profileKey: 'heartbeat-only', serverTimestamp: now + 1 }
    ];
    const report = buildKpiReport(events, now + 10);
    assert.deepEqual(report.payerConversion.USD, { numerator: 0, denominator: 0, rate: null });
    assert.deepEqual(report.ARPDAU.USD, { numerator: 199, denominator: 0, rate: null });
    assert.deepEqual(report.ARPPU.USD, { numerator: 199, denominator: 1, rate: 199 });
});
