const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TelemetryStore, normalizeTelemetryEvent } = require('../server/telemetry');

function input(overrides = {}) {
    return {
        eventId: 'telemetry_12345678', matchId: 'match_12345678', type: 'input',
        timestamp: 100000, metrics: { inputRate: 120, rttMs: 44 }, ...overrides
    };
}

test('telemetry normalizes allowlisted metrics and derives a non-punitive flag', () => {
    const normal = normalizeTelemetryEvent(input(), 'profile_12345678', 100000);
    assert.equal(normal.flagged, false);
    const suspicious = normalizeTelemetryEvent(input({
        eventId: 'telemetry_87654321',
        metrics: { inputRate: 800, speedViolations: 2, impossibleDeflects: 1 }
    }), 'profile_12345678', 100000);
    assert.equal(suspicious.flagged, true);
    assert.equal(suspicious.profileKey.includes('profile'), false);
    assert.equal(normalizeTelemetryEvent(input({ metrics: { clientBan: 1 } }), 'profile_12345678', 100000), null);
});

test('telemetry store deduplicates events, bounds retention and summarizes hashed profiles', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-telemetry-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new TelemetryStore(path.join(dir, 'telemetry.json'), {
        maxEvents: 100,
        now: () => 100000
    });
    const first = store.ingest('profile_12345678', input());
    assert.equal(first.status, 202);
    assert.equal(store.ingest('profile_12345678', input()).replayed, true);
    assert.equal(store.summary('profile_12345678').events, 1);
    assert.equal(store.ingest('profile_87654321', input({ eventId: 'telemetry_other1' })).status, 202);
    assert.equal(store.summary('profile_12345678').events, 1);
});
