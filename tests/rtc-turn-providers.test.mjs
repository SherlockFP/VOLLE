// Hosted TURN providers for /api/ice-servers (server/rtc-config.js): the API
// token / key stays server-side, only the provider's short-lived credentials
// reach clients, results are cached, and a provider outage degrades to STUN.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildRtcConfigWithProviders,
    fetchProviderIceServers,
    sanitizeProviderIceServers,
    resetProviderCacheForTests,
    DEFAULT_STUN_URLS
} from '../server/rtc-config.js';
import { FALLBACK_RTC_CONFIG, fetchRtcConfig, sanitizeRtcConfig } from '../js/network.js';

function fakeFetch(responder) {
    const calls = [];
    const impl = async (url, options = {}) => {
        calls.push({ url, options });
        const body = await responder(url, options);
        if (body === null) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => body };
    };
    impl.calls = calls;
    return impl;
}

test('defaults include several independent public STUN operators', () => {
    assert.ok(DEFAULT_STUN_URLS.includes('stun:stun.l.google.com:19302'));
    assert.ok(DEFAULT_STUN_URLS.includes('stun:stun.cloudflare.com:3478'));
    assert.ok(DEFAULT_STUN_URLS.length >= 3);
});

test('Cloudflare Realtime TURN: token stays server-side, short-lived creds are served and cached', async () => {
    resetProviderCacheForTests();
    const env = { CLOUDFLARE_TURN_KEY_ID: 'key-123', CLOUDFLARE_TURN_API_TOKEN: 'SECRET-API-TOKEN', TURN_TTL_SECONDS: '600' };
    const fetchImpl = fakeFetch(() => ({
        iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'short-user', credential: 'short-cred' }
        ]
    }));
    const config = await buildRtcConfigWithProviders(env, { fetchImpl, now: () => 1000 });
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers');
    assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer SECRET-API-TOKEN');
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { ttl: 600 });
    assert.equal(config.turn, true);
    const turn = config.iceServers.find(server => server.urls.some(url => url.startsWith('turn')));
    assert.deepEqual(turn, {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'short-user',
        credential: 'short-cred'
    });
    assert.doesNotMatch(JSON.stringify(config), /SECRET-API-TOKEN|key-123/);

    await buildRtcConfigWithProviders(env, { fetchImpl, now: () => 2000 });
    assert.equal(fetchImpl.calls.length, 1, 'cached within the TTL');
    await buildRtcConfigWithProviders(env, { fetchImpl, now: () => 1000 + 600 * 1000 });
    assert.equal(fetchImpl.calls.length, 2, 'refreshed after half the TTL');
});

test('Metered TURN: api key only in the server-side request', async () => {
    resetProviderCacheForTests();
    const env = { METERED_TURN_APP: 'volle.metered.live', METERED_TURN_API_KEY: 'METERED-KEY' };
    const fetchImpl = fakeFetch(() => ([
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80', username: 'u1', credential: 'c1' },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u1', credential: 'c1' }
    ]));
    const servers = await fetchProviderIceServers(env, { fetchImpl, now: () => 0 });
    assert.equal(fetchImpl.calls[0].url, 'https://volle.metered.live/api/v1/turn/credentials?apiKey=METERED-KEY');
    assert.equal(servers.length, 2);
    assert.ok(servers.every(server => server.username === 'u1' && server.credential === 'c1'));
    assert.doesNotMatch(JSON.stringify(servers), /METERED-KEY/);
});

test('provider outage or garbage degrades to STUN without throwing', async () => {
    resetProviderCacheForTests();
    const env = { CLOUDFLARE_TURN_KEY_ID: 'k', CLOUDFLARE_TURN_API_TOKEN: 't' };
    const down = await buildRtcConfigWithProviders(env, { fetchImpl: fakeFetch(() => null) });
    assert.equal(down.turn, false);
    assert.deepEqual(down.iceServers, [{ urls: DEFAULT_STUN_URLS.slice() }]);
    const throwing = await buildRtcConfigWithProviders(env, { fetchImpl: async () => { throw new Error('boom'); } });
    assert.equal(throwing.turn, false);
    assert.deepEqual(sanitizeProviderIceServers([
        { urls: 'turn:x.example:3478' },                   // TURN without credentials
        { urls: ['javascript:alert(1)'] },                // not an ICE url
        { urls: 'turn:ok.example:3478', username: 'a', credential: 'b' }
    ]), [{ urls: ['turn:ok.example:3478'], username: 'a', credential: 'b' }]);
});

test('client: /api/rtc-config that never answers falls back to public STUN quickly', async () => {
    const started = Date.now();
    const config = await fetchRtcConfig(() => new Promise(() => {}), 50);
    assert.equal(config, FALLBACK_RTC_CONFIG);
    assert.ok(Date.now() - started < 1000);
    assert.ok(FALLBACK_RTC_CONFIG.iceServers[0].urls.length >= 3);
    assert.equal(sanitizeRtcConfig({ iceServers: [{ urls: 'stun:a' }], relay: false }).relay, false);
    assert.equal(sanitizeRtcConfig({ iceServers: [{ urls: 'stun:a' }] }).relay, true);
});

test('anonymous callers get STUN only: no static TURN and no hosted-provider mint', async () => {
    resetProviderCacheForTests();
    const env = { TURN_URLS: 'turn:turn.example.com:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'c', METERED_TURN_APP: 'app', METERED_TURN_API_KEY: 'k' };
    const providerFetch = fakeFetch(() => [{ urls: 'turn:relay.metered.ca:80', username: 'x', credential: 'y' }]);
    const anonymous = await buildRtcConfigWithProviders(env, { includeTurn: false, fetchImpl: providerFetch });
    const urls = anonymous.iceServers.flatMap(server => [].concat(server.urls));
    assert.ok(urls.length > 0, 'still returns STUN');
    assert.ok(urls.every(url => !/^turns?:/i.test(url)), 'no TURN urls for anonymous callers');
    assert.equal(anonymous.turn, false);
    assert.equal(providerFetch.calls.length, 0, 'provider API never called for anonymous callers');
    assert.ok(!JSON.stringify(anonymous).includes('"credential"'));
});

test('fetchRtcConfig sends the lobby session so the server can unlock TURN', async () => {
    const calls = [];
    const impl = async (url, options = {}) => { calls.push({ url, options }); return { ok: true, json: async () => ({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }) }; };
    await fetchRtcConfig(impl, 1000, 'lg1.guest.token');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer lg1.guest.token');
    await fetchRtcConfig(impl, 1000);
    assert.equal(calls[1].options?.headers, undefined, 'no header without a session');
});
