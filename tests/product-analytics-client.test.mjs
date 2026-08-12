import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductAnalytics, joinLatencyBucket, matchStartTimingMetrics, normalizeProductEvent } from '../js/product-analytics.js';
import { readFileSync } from 'node:fs';

test('client event normalizer strips unapproved fields before delivery', () => {
    const event = normalizeProductEvent({
        eventId: 'product_event_123456',
        sessionId: 'session_123456',
        name: 'shop_inspect',
        dimensions: { itemType: 'avatar', playerName: 'not-sent' },
        metrics: { joinLatencyMs: 123, positionX: 99 }
    });
    assert.deepEqual(event.dimensions, { itemType: 'avatar' });
    assert.deepEqual(event.metrics, { joinLatencyMs: 123 });
    assert.equal(joinLatencyBucket(249), 'under_250ms');
    assert.equal(joinLatencyBucket(1000), '1s_3s');
    assert.equal(normalizeProductEvent({
        eventId: 'product_event_765432', sessionId: 'session_123456', name: 'ftue_exit',
        dimensions: { reason: 'skip', source: 'first_run' }
    })?.name, 'ftue_exit');
    assert.equal(normalizeProductEvent({
        eventId: 'product_event_123456', sessionId: 'session_123456', name: 'payment_completed',
        dimensions: { currency: 'USD' }, metrics: { revenueMinor: 199 }
    }), null, 'the browser cannot report revenue');
    assert.deepEqual(normalizeProductEvent({
        eventId: 'product_event_234567', sessionId: 'session_123456', name: 'match_complete',
        metrics: { matchDurationSec: 92.345, postgameDelaySec: 8.125 }
    })?.metrics, { matchDurationSec: 92.35, postgameDelaySec: 8.13 });
    assert.deepEqual(normalizeProductEvent({
        eventId: 'product_event_345678', sessionId: 'session_123456', name: 'rematch_click',
        metrics: { postgameToRematchSec: 4.567, postgameDelaySec: 301 }
    })?.metrics, { postgameToRematchSec: 4.57 }, 'out-of-range pacing metrics are stripped');
    assert.deepEqual(normalizeProductEvent({
        eventId: 'product_event_456789', sessionId: 'session_123456', name: 'battlepass_boost_activated',
        dimensions: { itemId: 'bp-1-5', source: 'battlepass', multiplier: 'forged' }
    })?.dimensions, { itemId: 'bp-1-5', source: 'battlepass' });
    assert.deepEqual(normalizeProductEvent({
        eventId: 'product_event_567890', sessionId: 'session_123456', name: 'match_start',
        metrics: { matchLoadElapsedMs: 950.125, matchSetupMs: 12.345, clickToCountdownMs: 962.47, positionX: 4 }
    })?.metrics, { matchLoadElapsedMs: 950.13, matchSetupMs: 12.35, clickToCountdownMs: 962.47 });
    assert.deepEqual(normalizeProductEvent({
        eventId: 'product_event_678901', sessionId: 'session_123456', name: 'match_start',
        metrics: { matchLoadElapsedMs: 60001, matchSetupMs: -1, clickToCountdownMs: 60000 }
    })?.metrics, { clickToCountdownMs: 60000 }, 'out-of-range launch timings are stripped client-side');
});

test('match-start timing derives bounded durations from a fake monotonic clock only', () => {
    assert.deepEqual(matchStartTimingMetrics({
        requestedAt: 100,
        matchLoadElapsedMs: 950.125,
        setupStartedAt: 1050
    }, 1082.345), {
        matchLoadElapsedMs: 950.13,
        matchSetupMs: 32.35,
        clickToCountdownMs: 982.35
    });
    assert.deepEqual(matchStartTimingMetrics({
        requestedAt: 0,
        matchLoadElapsedMs: 60001,
        setupStartedAt: -1
    }, 60001), {}, 'raw monotonic timestamps outside the 60 second window never become metrics');
});

test('queued events flush after the Store session token becomes available', async () => {
    const store = { sessionToken: '' };
    const calls = [];
    const analytics = new ProductAnalytics(store, {
        fetchImpl: async (...args) => { calls.push(args); return { ok: true }; }
    });
    analytics.track('session_start');
    await analytics.flush();
    assert.equal(calls.length, 0);
    store.sessionToken = 'session-token';
    await analytics.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].headers.Authorization, 'Bearer session-token');
    assert.equal(JSON.parse(calls[0][1].body).events[0].name, 'session_start');
});

test('flush invokes a stored native-style fetch implementation with the global receiver', async () => {
    const analytics = new ProductAnalytics({ sessionToken: 'session-token' }, {
        fetchImpl: async function () {
            assert.strictEqual(this, globalThis, 'unbound native fetch rejects a ProductAnalytics receiver');
            return { ok: true };
        }
    });
    analytics.track('session_start');
    await analytics.flush();
    assert.equal(analytics.queue.length, 0);
});

test('flush drains bounded batches until every authenticated queued event is delivered', async () => {
    const calls = [];
    const analytics = new ProductAnalytics({ sessionToken: 'session-token' }, {
        fetchImpl: async (...args) => { calls.push(args); return { ok: true }; }
    });
    for (let i = 0; i < 41; i++) analytics.track('screen_view', { screen: 'shop' });
    await analytics.flush();
    const batchSizes = calls.map(call => JSON.parse(call[1].body).events.length);
    assert.equal(batchSizes.reduce((total, size) => total + size, 0), 41);
    assert.ok(batchSizes.every(size => size > 0 && size <= 20), 'every delivery stays within the 20-event bound');
    assert.equal(calls.length, 3, '41 events require three bounded requests');
    assert.equal(analytics.queue.length, 0);
});

test('an event tracked while a request is in flight is drained by the same flush', async () => {
    let resolveFetch;
    const calls = [];
    const analytics = new ProductAnalytics({ sessionToken: 'session-token' }, {
        fetchImpl: (...args) => {
            calls.push(args);
            if (calls.length > 1) return Promise.resolve({ ok: true });
            return new Promise(resolve => { resolveFetch = () => resolve({ ok: true }); });
        }
    });
    analytics.track('session_start');
    await Promise.resolve();
    analytics.track('screen_view', { screen: 'shop' });
    resolveFetch();
    await analytics.flush();
    assert.deepEqual(calls.map(call => JSON.parse(call[1].body).events.map(event => event.name)), [
        ['session_start'], ['screen_view']
    ]);
    assert.equal(analytics.queue.length, 0);
});

test('rejected batches retry in original order at most three times and never loop inside one flush', async () => {
    const calls = [];
    const store = { sessionToken: '' };
    const analytics = new ProductAnalytics(store, {
        fetchImpl: async (...args) => { calls.push(args); return { ok: false }; }
    });
    analytics.track('session_start');
    analytics.track('screen_view', { screen: 'shop' });
    store.sessionToken = 'session-token';
    await analytics.flush();
    assert.equal(calls.length, 1);
    assert.deepEqual(analytics.queue.map(item => item.event.name), ['session_start', 'screen_view']);
    assert.deepEqual(analytics.queue.map(item => item.attempts), [1, 1]);
    await analytics.flush();
    await analytics.flush();
    assert.equal(calls.length, 3);
    assert.equal(analytics.queue.length, 0, 'the third failed attempt is discarded rather than retried forever');
});

test('concurrent flush calls share one in-flight request', async () => {
    let resolveFetch;
    let calls = 0;
    const analytics = new ProductAnalytics({ sessionToken: 'session-token' }, {
        fetchImpl: () => {
            calls += 1;
            return new Promise(resolve => { resolveFetch = () => resolve({ ok: true }); });
        }
    });
    analytics.track('session_start');
    const first = analytics.flush();
    const second = analytics.flush();
    assert.strictEqual(first, second);
    assert.equal(calls, 1);
    resolveFetch();
    await first;
});

test('main wiring flushes the pre-auth queue and records product-safe flow hooks', () => {
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /void this\.productAnalytics\.flush\(\);/);
    assert.match(main, /quick_play_click/);
    assert.match(main, /shop_purchase_success/);
    assert.match(main, /network_reconnect/);
    assert.match(main, /cosmetic_match_use/);
    assert.match(main, /arena_cache_earned/);
    assert.match(main, /card_trade_up/);
    assert.match(main, /battlepass_premium_unlocked', \{ source: 'soft_currency' \}/);
    assert.match(main, /battlepass_reward_claimed/);
    assert.match(main, /if \(!activation\.replayed\) \{\s*this\.productAnalytics\.track\('battlepass_boost_activated'/);
    assert.match(main, /if \(!hosted\)[\s\S]*quick_play_failure/);
    assert.match(main, /if \(equippedForAnalytics\) this\.productAnalytics\.track\('cosmetic_equip'/);
    assert.match(main, /this\.game\.onCountdownReady = \(\) => \{/);
    assert.match(main, /this\._analyticsMatchStartTrackedId === matchId/);
    assert.match(main, /matchStartTimingMetrics\(this\._matchLaunchTiming, performance\.now\(\)\)/);
});
