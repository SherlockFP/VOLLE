import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HOST_CHECKPOINT_MAX_BYTES,
    HOST_MIGRATION_BACKOFF_MAX_MS,
    HOST_MIGRATION_TIMEOUT_MS,
    electionAgreement,
    hasElectionAgreement,
    migrationBackoffMs,
    nextMigrationEpoch,
    normalizeHostCheckpoint,
    rankHostCandidates,
    selectHostCandidate,
    validateHostMigrationProposal
} from '../js/host-migration.js';

const candidate = (playerId, overrides = {}) => ({
    playerId,
    eligible: true,
    connected: true,
    ping: 30,
    stability: 0.9,
    uptime: 1000,
    packetLoss: 0.01,
    ...overrides
});

test('candidate ranking is deterministic across every policy tier', () => {
    const ranked = rankHostCandidates([
        candidate('z', { ping: 10, eligible: false }),
        candidate('ping-slow', { ping: 50 }),
        candidate('loss-high', { stability: 0.8, uptime: 2000, packetLoss: 0.2 }),
        candidate('uptime-low', { stability: 0.8, uptime: 1000, packetLoss: 0 }),
        candidate('loss-low', { stability: 0.8, uptime: 2000, packetLoss: 0.1 }),
        candidate('b'),
        candidate('a')
    ]);
    assert.deepEqual(ranked.map(item => item.playerId), [
        'a', 'b', 'loss-low', 'loss-high', 'uptime-low', 'ping-slow', 'z'
    ]);
    assert.equal(selectHostCandidate(ranked).playerId, 'a');
    assert.equal(selectHostCandidate([candidate('bad', { spectator: true })]), null);
});

test('invalid metrics cannot outrank a healthy candidate', () => {
    const ranked = rankHostCandidates([
        candidate('nan', { ping: Number.NaN, stability: Number.POSITIVE_INFINITY }),
        candidate('healthy', { ping: 100 })
    ]);
    assert.equal(ranked[0].playerId, 'healthy');
});

test('migration epochs advance monotonically and reject unsafe values', () => {
    assert.equal(nextMigrationEpoch(2), 3);
    assert.equal(nextMigrationEpoch(2, 8), 9);
    assert.equal(nextMigrationEpoch(-1), null);
    assert.equal(nextMigrationEpoch(Number.MAX_SAFE_INTEGER), null);
});

test('checkpoint normalization bounds data and strips unsafe content', () => {
    const state = Object.create(null);
    state.score = { red: 2, blue: Number.NaN };
    state.label = 'x'.repeat(5000);
    Object.defineProperty(state, '__proto__', { value: { polluted: true }, enumerable: true });
    const normalized = normalizeHostCheckpoint({
        epoch: 3,
        seq: 9,
        timestamp: 100,
        snapshot: state
    });
    assert.equal(normalized.sequence, 9);
    assert.equal(normalized.state.score.blue, null);
    assert.equal(normalized.state.label.length, 4096);
    assert.equal(Object.hasOwn(normalized.state, '__proto__'), false);
    assert.equal({}.polluted, undefined);
    assert.equal(normalizeHostCheckpoint({
        epoch: 1,
        state: { payload: 'x'.repeat(HOST_CHECKPOINT_MAX_BYTES) }
    }), null);
});

test('checkpoint normalization rejects malformed and cyclic input', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    assert.equal(normalizeHostCheckpoint({ epoch: 1, state: cyclic }), null);
    assert.equal(normalizeHostCheckpoint({ epoch: -1, state: {} }), null);
    assert.equal(normalizeHostCheckpoint({ epoch: 1, state: {} }, { maxBytes: 4 }), null);
});

test('election agreement requires an eligible strict majority', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('c')];
    const votes = [
        { voterId: 'a', candidateId: 'b', epoch: 4 },
        { voterId: 'b', candidateId: 'b', epoch: 4 },
        { voterId: 'b', candidateId: 'a', epoch: 4 },
        { voterId: 'outsider', candidateId: 'b', epoch: 4 },
        { voterId: 'c', candidateId: 'b', epoch: 3 }
    ];
    assert.equal(electionAgreement(votes, candidates, 4), 'b');
    assert.equal(hasElectionAgreement(votes, 'b', candidates, 4), true);
    assert.equal(hasElectionAgreement(votes, 'a', candidates, 4), false);
});

test('migration proposals reject stale epochs, skipped epochs and invalid candidates', () => {
    const candidates = [candidate('a'), candidate('b'), candidate('offline', { connected: false })];
    const votes = [
        { voterId: 'a', candidateId: 'b', epoch: 3 },
        { voterId: 'b', candidateId: 'b', epoch: 3 }
    ];
    const context = { currentEpoch: 2, candidates, votes };
    assert.equal(validateHostMigrationProposal({ epoch: 3, candidateId: 'b' }, context), true);
    assert.equal(validateHostMigrationProposal({ epoch: 2, candidateId: 'b' }, context), false);
    assert.equal(validateHostMigrationProposal({ epoch: 4, candidateId: 'b' }, context), false);
    assert.equal(validateHostMigrationProposal({ epoch: 3, candidateId: 'offline' }, context), false);
    assert.equal(validateHostMigrationProposal({ epoch: 3, candidateId: '__proto__' }, context), false);
});

test('timeout and exponential retry backoff stay bounded', () => {
    assert.equal(HOST_MIGRATION_TIMEOUT_MS, 5000);
    assert.deepEqual([0, 1, 2, 3].map(migrationBackoffMs), [250, 500, 1000, 2000]);
    assert.equal(migrationBackoffMs(999), HOST_MIGRATION_BACKOFF_MAX_MS);
    assert.equal(migrationBackoffMs(-5), 250);
});
