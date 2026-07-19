import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AfkMonitor,
    ModerationReportQueue,
    QUALITY_PRESETS,
    RollingNetworkMonitor,
    SHADER_WARMUP_MANIFEST,
    createPublicDiagnostics,
    resolveQualityPreset
} from '../js/release-safety.js';

test('AFK warning, kick, and activity reset use strict thresholds', () => {
    let now = 0;
    const monitor = new AfkMonitor({ warningMs: 1_000, kickMs: 2_000, now: () => now });

    now = 999;
    assert.equal(monitor.status().state, 'active');
    now = 1_000;
    assert.equal(monitor.status().state, 'warning');
    now = 2_000;
    assert.equal(monitor.status().state, 'kick');

    monitor.recordActivity();
    now = 2_999;
    assert.deepEqual(monitor.status(), {
        state: 'active',
        idleMs: 999,
        warning: false,
        kick: false
    });
});

test('rolling network monitor aggregates and expires packet loss and desync', () => {
    let now = 0;
    const monitor = new RollingNetworkMonitor({
        windowMs: 1_000,
        packetLossThreshold: 0.2,
        desyncThresholdMs: 100,
        now: () => now
    });

    monitor.addSample({ expectedPackets: 10, receivedPackets: 7, desyncMs: 120 });
    now = 500;
    const unhealthy = monitor.addSample({ expectedPackets: 10, lostPackets: 1, desyncMs: 90 });
    assert.equal(unhealthy.packetLoss, 0.2);
    assert.equal(unhealthy.averageDesyncMs, 105);
    assert.equal(unhealthy.unhealthy, true);

    now = 1_001;
    const recovered = monitor.snapshot();
    assert.equal(recovered.samples, 1);
    assert.equal(recovered.packetLoss, 0.1);
    assert.equal(recovered.unhealthy, false);
});

test('network monitor clamps hostile values and limits retained samples', () => {
    const monitor = new RollingNetworkMonitor({ maxSamples: 2 });
    monitor.record({ sent: 10, packetLoss: -4, desyncMs: -30 }, 1);
    monitor.record({ sent: 10, packetLoss: 4, desyncMs: Infinity }, 2);
    const result = monitor.record({ sent: 10, received: 10 }, 3);

    assert.equal(result.samples, 2);
    assert.equal(result.lostPackets, 10);
    assert.equal(result.maxDesyncMs, 0);
    assert.throws(() => monitor.record('bad'), /object/);
});

test('moderation queue sanitizes, rate limits, and rejects invalid identity', () => {
    let now = 10;
    const reports = new ModerationReportQueue({
        rateLimit: 2,
        rateWindowMs: 1_000,
        now: () => now
    });
    const first = reports.enqueue({
        reporterId: 'player_1',
        targetId: 'player_2',
        reason: 'harassment',
        details: ' <script>alert(1)</script>\n rude '
    });
    assert.equal(first.accepted, true);
    assert.equal(first.report.details, 'scriptalert(1)/script rude');
    assert.equal(Object.isFrozen(first.report), true);
    assert.equal(reports.enqueue({
        reporterId: 'player_1',
        targetId: 'player_3',
        reason: 'spam'
    }).accepted, true);
    assert.deepEqual(reports.enqueue({
        reporterId: 'player_1',
        targetId: 'player_4',
        reason: 'cheating'
    }), { accepted: false, reason: 'rate_limited' });

    now = 1_011;
    assert.equal(reports.enqueue({
        reporterId: '__proto__',
        targetId: 'player_4',
        reason: 'not-allowed'
    }).accepted, false);
    assert.equal(reports.size, 2);
    assert.equal(reports.drain(1).length, 1);
    assert.equal(reports.dequeue().targetId, 'player_3');
});

test('quality resolver honors explicit presets and safe auto fallback', () => {
    assert.equal(resolveQualityPreset('HIGH'), QUALITY_PRESETS.high);
    assert.equal(resolveQualityPreset('auto', {
        fps: 30,
        deviceMemory: 16,
        hardwareConcurrency: 16
    }), QUALITY_PRESETS.low);
    assert.equal(resolveQualityPreset('invalid', {
        fps: 60,
        frameTimeMs: 16,
        deviceMemory: 8,
        hardwareConcurrency: 8
    }), QUALITY_PRESETS.high);
    assert.equal(resolveQualityPreset('auto', {
        fps: 60,
        deviceMemory: 4,
        hardwareConcurrency: 4
    }), QUALITY_PRESETS.medium);
});

test('shader warmup manifest is immutable and names existing shader exports', () => {
    assert.deepEqual(
        SHADER_WARMUP_MANIFEST.map(item => [
            item.id,
            item.vertexExport,
            item.fragmentExport
        ]),
        [
            ['toon', 'toonVertexShader', 'toonFragmentShader'],
            ['outline', 'outlineVertexShader', 'outlineFragmentShader']
        ]
    );
    assert.equal(Object.isFrozen(SHADER_WARMUP_MANIFEST), true);
    assert.equal(SHADER_WARMUP_MANIFEST.every(Object.isFrozen), true);
});

test('public diagnostics expose allowlisted bounded fields only', () => {
    const result = createPublicDiagnostics({
        version: '<1.2.3>\n',
        quality: 'low',
        playerId: 'secret-player',
        resumeToken: 'secret-token',
        network: {
            ping: -5,
            packetLoss: 4,
            desyncMs: -40,
            reconnecting: 1,
            peerId: 'secret-peer'
        },
        performance: { fps: Infinity, frameTimeMs: 2_000, gpu: 'secret-gpu' }
    });

    assert.deepEqual(result, {
        version: '1.2.3',
        quality: 'low',
        network: {
            pingMs: 0,
            packetLoss: 1,
            desyncMs: 40,
            reconnecting: false
        },
        performance: { fps: 0, frameTimeMs: 1_000 }
    });
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(Object.isFrozen(result.network), true);
});
