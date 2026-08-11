import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductAnalytics, joinLatencyBucket, normalizeProductEvent } from '../js/product-analytics.js';
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

test('main wiring flushes the pre-auth queue and records product-safe flow hooks', () => {
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.match(main, /void this\.productAnalytics\.flush\(\);/);
    assert.match(main, /quick_play_click/);
    assert.match(main, /shop_purchase_success/);
    assert.match(main, /network_reconnect/);
    assert.match(main, /cosmetic_match_use/);
    assert.match(main, /arena_cache_earned/);
    assert.match(main, /card_trade_up/);
    assert.match(main, /if \(!hosted\)[\s\S]*quick_play_failure/);
    assert.match(main, /if \(equippedForAnalytics\) this\.productAnalytics\.track\('cosmetic_equip'/);
});
