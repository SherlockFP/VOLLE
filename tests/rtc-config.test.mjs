import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    buildRtcConfig,
    deriveTurnCredential,
    parseUrlList,
    DEFAULT_STUN_URLS
} from '../server/rtc-config.js';

test('STUN-only fallback when no TURN env vars are set (today\'s behavior)', () => {
    const config = buildRtcConfig({});
    assert.deepEqual(config.iceServers, [{ urls: DEFAULT_STUN_URLS.slice() }]);
    assert.deepEqual(config.peer, {});
});

test('STUN_URLS override replaces the default STUN list', () => {
    const config = buildRtcConfig({ STUN_URLS: 'stun:a.example.com:3478, stun:b.example.com:3478' });
    assert.deepEqual(config.iceServers, [{ urls: ['stun:a.example.com:3478', 'stun:b.example.com:3478'] }]);
});

test('credential derivation is correct and deterministic for a fixed secret/time', () => {
    const secret = 'super-secret-value';
    const nowSeconds = 1_700_000_000;
    const { username, credential, expiresAt } = deriveTurnCredential(secret, 'alice', nowSeconds, 3600);

    assert.equal(username, '1700003600:alice');
    assert.equal(expiresAt, 1700003600);
    const expected = crypto.createHmac('sha1', secret).update(username).digest('base64');
    assert.equal(credential, expected);

    // Deterministic: same inputs always produce the same output.
    const again = deriveTurnCredential(secret, 'alice', nowSeconds, 3600);
    assert.deepEqual(again, { username, credential, expiresAt });
});

test('ephemeral TURN credentials: expiry is in the future relative to "now"', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const { expiresAt } = deriveTurnCredential('secret', 'bob', nowSeconds, 3600);
    assert.ok(expiresAt > nowSeconds);
    assert.equal(expiresAt, nowSeconds + 3600);
});

test('buildRtcConfig issues ephemeral TURN credentials when TURN_SECRET is set', () => {
    const secret = 'coturn-shared-secret';
    const fixedNow = () => 1_700_000_000_000; // ms
    const config = buildRtcConfig({
        TURN_URLS: 'turn:turn.warball.io:3478',
        TURN_SECRET: secret
    }, { now: fixedNow, userId: 'player-42' });

    const turnEntry = config.iceServers.find(entry => entry.urls[0]?.startsWith('turn:'));
    assert.ok(turnEntry);
    assert.match(turnEntry.username, /^1700003600:player-42$/);
    const expectedCredential = crypto.createHmac('sha1', secret).update(turnEntry.username).digest('base64');
    assert.equal(turnEntry.credential, expectedCredential);
});

test('buildRtcConfig falls back to static TURN_USERNAME/TURN_CREDENTIAL when no secret is set', () => {
    const config = buildRtcConfig({
        TURN_URLS: 'turn:turn.warball.io:3478',
        TURN_USERNAME: 'static-user',
        TURN_CREDENTIAL: 'static-pass'
    });
    const turnEntry = config.iceServers.find(entry => entry.urls[0]?.startsWith('turn:'));
    assert.deepEqual(turnEntry, {
        urls: ['turn:turn.warball.io:3478'],
        username: 'static-user',
        credential: 'static-pass'
    });
});

test('TURN_URLS with neither secret nor static credentials is skipped, not broken', () => {
    const config = buildRtcConfig({ TURN_URLS: 'turn:turn.warball.io:3478' });
    assert.equal(config.iceServers.some(entry => entry.urls[0]?.startsWith('turn:')), false);
});

test('the raw TURN_SECRET never appears anywhere in the response', () => {
    const secret = 'do-not-leak-this-secret-1234567890';
    const config = buildRtcConfig({
        TURN_URLS: 'turn:turn.warball.io:3478',
        TURN_SECRET: secret
    }, { now: () => 1_700_000_000_000, userId: 'player-1' });

    const serialized = JSON.stringify(config);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(Buffer.from(secret).toString('base64')), false);
});

test('self-hostable PeerJS broker config passes through host/port/path when set', () => {
    const config = buildRtcConfig({
        PEER_HOST: 'peer.warball.io',
        PEER_PORT: '443',
        PEER_PATH: 'peerjs',
        PEER_SECURE: 'true'
    });
    assert.deepEqual(config.peer, {
        host: 'peer.warball.io',
        port: 443,
        path: '/peerjs',
        secure: true
    });
});

test('default (nothing configured) peer broker config remains empty — today\'s public-cloud behavior', () => {
    const config = buildRtcConfig({});
    assert.deepEqual(config.peer, {});
});

test('malformed/hostile env values do not crash and are dropped safely', () => {
    assert.doesNotThrow(() => buildRtcConfig({
        TURN_URLS: ',,,,'.repeat(50),
        TURN_SECRET: '',
        TURN_USERNAME: '',
        TURN_CREDENTIAL: '',
        PEER_PORT: 'not-a-number',
        PEER_HOST: 'x'.repeat(10000),
        STUN_URLS: null,
        TURN_TTL_SECONDS: 'NaN-ish'
    }));

    const config = buildRtcConfig({
        PEER_PORT: 'not-a-number',
        PEER_HOST: 'x'.repeat(10000)
    });
    assert.equal(config.peer.port, undefined);
    assert.equal(config.peer.host.length <= 256, true);

    const outOfRangePort = buildRtcConfig({ PEER_PORT: '999999' });
    assert.equal(outOfRangePort.peer.port, undefined);

    const negativePort = buildRtcConfig({ PEER_PORT: '-1' });
    assert.equal(negativePort.peer.port, undefined);
});

test('TURN_TTL_SECONDS is clamped to a sane range even when hostile', () => {
    const huge = buildRtcConfig({
        TURN_URLS: 'turn:t.example.com:3478',
        TURN_SECRET: 'secret',
        TURN_TTL_SECONDS: '999999999'
    }, { now: () => 1_700_000_000_000, userId: 'p' });
    const hugeEntry = huge.iceServers.find(e => e.urls[0]?.startsWith('turn:'));
    const [expiryHuge] = hugeEntry.username.split(':');
    assert.equal(Number(expiryHuge), 1_700_000_000 + 86400);

    const tiny = buildRtcConfig({
        TURN_URLS: 'turn:t.example.com:3478',
        TURN_SECRET: 'secret',
        TURN_TTL_SECONDS: '-500'
    }, { now: () => 1_700_000_000_000, userId: 'p' });
    const tinyEntry = tiny.iceServers.find(e => e.urls[0]?.startsWith('turn:'));
    const [expiryTiny] = tinyEntry.username.split(':');
    assert.equal(Number(expiryTiny), 1_700_000_000 + 60);
});

test('parseUrlList bounds entry count and rejects empty/garbage input', () => {
    assert.deepEqual(parseUrlList(''), []);
    assert.deepEqual(parseUrlList(undefined), []);
    assert.deepEqual(parseUrlList(null), []);
    const many = Array.from({ length: 20 }, (_, i) => `turn:${i}.example.com`).join(',');
    assert.equal(parseUrlList(many).length, 8);
});

test('turn userid is sanitized to a safe charset so credentials cannot be forged via injection', () => {
    const { username } = deriveTurnCredential('secret', '../../etc/passwd:evil', 1_700_000_000, 3600);
    assert.equal(username, '1700003600:etcpasswdevil');
});
