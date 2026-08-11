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

test('product events endpoint is authenticated and rate limited', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(server, /urlPath === '\/api\/product-events' && req\.method === 'POST'/);
    assert.match(server, /allowRequest\(req, res, 'productAnalytics'\)/);
    assert.match(server, /requireAuth\(req, res, body\)\?\.profile/);
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
    assert.ok(report.notInstrumentedYet.includes('ARPPU'));
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
