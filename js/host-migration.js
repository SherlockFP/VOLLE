const MAX_SAFE_EPOCH = Number.MAX_SAFE_INTEGER - 1;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
const FORBIDDEN_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'resumeToken'
]);
const RESUME_PROOF_PATTERN = /^[a-f0-9]{64}$/;

export const HOST_MIGRATION_TIMEOUT_MS = 5000;
export const HOST_MIGRATION_BACKOFF_BASE_MS = 250;
export const HOST_MIGRATION_BACKOFF_MAX_MS = 4000;
export const HOST_MIGRATION_MAX_ATTEMPTS = 5;
export const HOST_MIGRATION_MAX_ROSTER = 64;
export const HOST_CHECKPOINT_MAX_BYTES = 64 * 1024;
export const HOST_CHECKPOINT_MAX_DEPTH = 8;
export const HOST_CHECKPOINT_MAX_ITEMS = 256;
export const HOST_CHECKPOINT_MAX_KEYS = 128;
export const HOST_CHECKPOINT_MAX_STRING_LENGTH = 4096;

export const HOST_MIGRATION_POLICY = Object.freeze({
    timeoutMs: HOST_MIGRATION_TIMEOUT_MS,
    backoffBaseMs: HOST_MIGRATION_BACKOFF_BASE_MS,
    backoffMaxMs: HOST_MIGRATION_BACKOFF_MAX_MS,
    maxAttempts: HOST_MIGRATION_MAX_ATTEMPTS,
    checkpointMaxBytes: HOST_CHECKPOINT_MAX_BYTES
});

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function boundedMetric(value, min, max, fallback) {
    return Math.min(max, Math.max(min, finite(value, fallback)));
}

export function isValidPlayerId(playerId) {
    return typeof playerId === 'string' && PLAYER_ID_PATTERN.test(playerId);
}

export function isEligibleHostCandidate(candidate) {
    return Boolean(candidate)
        && isValidPlayerId(candidate.playerId)
        && candidate.eligible === true
        && candidate.connected !== false
        && candidate.spectator !== true;
}

function candidateScore(candidate) {
    return {
        eligible: isEligibleHostCandidate(candidate),
        ping: boundedMetric(candidate?.ping, 0, 60000, Number.POSITIVE_INFINITY),
        stability: boundedMetric(candidate?.stability, 0, 1, 0),
        uptime: boundedMetric(candidate?.uptime, 0, Number.MAX_SAFE_INTEGER, 0),
        packetLoss: boundedMetric(candidate?.packetLoss, 0, 1, 1),
        migrationOrder: Number.isSafeInteger(candidate?.migrationOrder)
            && candidate.migrationOrder >= 0
            ? candidate.migrationOrder
            : Number.MAX_SAFE_INTEGER,
        playerId: isValidPlayerId(candidate?.playerId) ? candidate.playerId : ''
    };
}

export function compareHostCandidates(left, right) {
    const a = candidateScore(left);
    const b = candidateScore(right);
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.ping !== b.ping) return a.ping - b.ping;
    if (a.stability !== b.stability) return b.stability - a.stability;
    if (a.uptime !== b.uptime) return b.uptime - a.uptime;
    if (a.packetLoss !== b.packetLoss) return a.packetLoss - b.packetLoss;
    if (a.migrationOrder !== b.migrationOrder) return a.migrationOrder - b.migrationOrder;
    if (a.playerId < b.playerId) return -1;
    if (a.playerId > b.playerId) return 1;
    return 0;
}

export function rankHostCandidates(candidates = []) {
    if (!Array.isArray(candidates)) return [];
    return candidates.slice().sort(compareHostCandidates);
}

export function selectHostCandidate(candidates = []) {
    return rankHostCandidates(candidates).find(isEligibleHostCandidate) || null;
}

export function nextMigrationEpoch(currentEpoch = 0, observedEpoch = currentEpoch) {
    const current = Number(currentEpoch);
    const observed = Number(observedEpoch);
    if (!Number.isSafeInteger(current) || current < 0
        || !Number.isSafeInteger(observed) || observed < 0) return null;
    const latest = Math.max(current, observed);
    return latest <= MAX_SAFE_EPOCH ? latest + 1 : null;
}

export function isStaleMigrationEpoch(epoch, currentEpoch) {
    return !Number.isSafeInteger(epoch)
        || epoch < 1
        || !Number.isSafeInteger(currentEpoch)
        || currentEpoch < 0
        || epoch <= currentEpoch;
}

export function migrationBackoffMs(attempt) {
    const boundedAttempt = Math.min(
        HOST_MIGRATION_MAX_ATTEMPTS - 1,
        Math.max(0, Math.trunc(finite(attempt, 0)))
    );
    return Math.min(
        HOST_MIGRATION_BACKOFF_MAX_MS,
        HOST_MIGRATION_BACKOFF_BASE_MS * (2 ** boundedAttempt)
    );
}

function sanitizeCheckpointValue(value, depth) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return typeof value === 'string'
            ? value.slice(0, HOST_CHECKPOINT_MAX_STRING_LENGTH)
            : value;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (depth >= HOST_CHECKPOINT_MAX_DEPTH || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
        return value.slice(0, HOST_CHECKPOINT_MAX_ITEMS)
            .map(item => sanitizeCheckpointValue(item, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output = Object.create(null);
    for (const key of Object.keys(value).slice(0, HOST_CHECKPOINT_MAX_KEYS)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        output[key.slice(0, HOST_CHECKPOINT_MAX_STRING_LENGTH)] =
            sanitizeCheckpointValue(value[key], depth + 1);
    }
    return output;
}

function jsonByteLength(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch (_) {
        return Number.POSITIVE_INFINITY;
    }
}

export function normalizeHostCheckpoint(checkpoint, options = {}) {
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return null;
    const epoch = Number(checkpoint.epoch);
    const sequence = Number(checkpoint.sequence ?? checkpoint.seq ?? 0);
    const createdAt = Number(checkpoint.createdAt ?? checkpoint.timestamp ?? 0);
    if (!Number.isSafeInteger(epoch) || epoch < 0
        || !Number.isSafeInteger(sequence) || sequence < 0
        || !Number.isFinite(createdAt) || createdAt < 0) return null;

    const maxBytes = Math.min(
        HOST_CHECKPOINT_MAX_BYTES,
        Math.max(1, Math.trunc(finite(options.maxBytes, HOST_CHECKPOINT_MAX_BYTES)))
    );
    const sourceState = checkpoint.state ?? checkpoint.snapshot;
    if (!sourceState || typeof sourceState !== 'object') return null;
    if (jsonByteLength(sourceState) > maxBytes) return null;
    const state = sanitizeCheckpointValue(sourceState, 0);
    if (!state) return null;
    const normalized = { epoch, sequence, createdAt, state };
    return jsonByteLength(normalized) <= maxBytes ? normalized : null;
}

function eligibleIdSet(candidates) {
    return new Set((Array.isArray(candidates) ? candidates : [])
        .filter(isEligibleHostCandidate)
        .map(candidate => candidate.playerId));
}

function migrationRosterPairs(roster) {
    if (!Array.isArray(roster)
        || roster.length < 1
        || roster.length > HOST_MIGRATION_MAX_ROSTER) return null;
    const pairs = [];
    const playerIds = new Set();
    const peerIds = new Set();
    for (const player of roster) {
        if (!player || !isValidPlayerId(player.playerId)
            || typeof player.peerId !== 'string'
            || player.peerId.length < 1
            || player.peerId.length > 128
            || Object.hasOwn(player, 'resumeToken')
            || playerIds.has(player.playerId)
            || peerIds.has(player.peerId)) return null;
        const resumeProof = player.resumeProof;
        if (resumeProof !== undefined
            && (typeof resumeProof !== 'string'
                || !RESUME_PROOF_PATTERN.test(resumeProof))) return null;
        playerIds.add(player.playerId);
        peerIds.add(player.peerId);
        const migrationOrder = Number.isSafeInteger(player.migrationOrder)
            && player.migrationOrder >= 0
            ? player.migrationOrder
            : '';
        const resumeReserved = player.resumeReserved === true
            || resumeProof !== undefined;
        pairs.push(
            `${player.playerId}\0${player.peerId}\0${migrationOrder}`
            + `\0${resumeReserved ? 1 : 0}\0${resumeProof || ''}`
        );
    }
    return pairs.sort();
}

function digestText(value) {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193);
        right = Math.imul(right ^ code, 0x85ebca6b);
    }
    return `${(left >>> 0).toString(16).padStart(8, '0')}`
        + `${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function migrationRosterDigest(roster) {
    const pairs = migrationRosterPairs(roster);
    return pairs ? digestText(pairs.join('\u0001')) : null;
}

export function migrationAttemptId(epoch, roster, candidateId) {
    const digest = migrationRosterDigest(roster);
    if (!Number.isSafeInteger(epoch) || epoch < 1
        || !digest || !isValidPlayerId(candidateId)) return null;
    return `migration-${epoch}-${digestText(`${digest}\0${candidateId}`)}`;
}

function migrationRostersMatch(left, right) {
    const a = migrationRosterPairs(left);
    const b = migrationRosterPairs(right);
    return Boolean(a && b)
        && a.length === b.length
        && a.every((pair, index) => pair === b[index]);
}

export function electionAgreement(
    votes,
    candidates,
    epoch,
    attemptId = undefined,
    rosterDigest = undefined
) {
    if (!Array.isArray(votes)
        || votes.length > HOST_MIGRATION_MAX_ROSTER
        || !Number.isSafeInteger(epoch)
        || epoch < 1) return null;
    const eligibleIds = eligibleIdSet(candidates);
    if (!eligibleIds.size) return null;
    const seenVoters = new Set();
    const counts = new Map();
    for (const vote of votes) {
        if (!vote || vote.epoch !== epoch
            || (attemptId !== undefined && vote.attemptId !== attemptId)
            || (rosterDigest !== undefined && vote.rosterDigest !== rosterDigest)
            || !eligibleIds.has(vote.voterId)
            || !eligibleIds.has(vote.candidateId)
            || seenVoters.has(vote.voterId)) return null;
        seenVoters.add(vote.voterId);
        counts.set(vote.candidateId, (counts.get(vote.candidateId) || 0) + 1);
    }
    const quorum = Math.floor(eligibleIds.size / 2) + 1;
    const agreed = [...counts.entries()]
        .filter(([, count]) => count >= quorum)
        .map(([candidateId]) => candidateId)
        .sort();
    return agreed[0] || null;
}

export function hasElectionAgreement(
    votes,
    candidateId,
    candidates,
    epoch,
    attemptId = undefined,
    rosterDigest = undefined
) {
    return isValidPlayerId(candidateId)
        && electionAgreement(
            votes,
            candidates,
            epoch,
            attemptId,
            rosterDigest
        ) === candidateId;
}

function votesMatchObserved(votes, observedVotes, epoch, attemptId, rosterDigest) {
    if (observedVotes === undefined) return true;
    const observed = observedVotes instanceof Map
        ? [...observedVotes.values()]
        : observedVotes;
    if (!Array.isArray(observed)) return false;
    const byVoter = new Map();
    for (const vote of observed) {
        if (!vote || vote.epoch !== epoch
            || vote.attemptId !== attemptId
            || vote.rosterDigest !== rosterDigest
            || byVoter.has(vote.voterId)) return false;
        byVoter.set(vote.voterId, vote);
    }
    return votes.every(vote => {
        const seen = byVoter.get(vote.voterId);
        return seen?.epoch === vote.epoch
            && seen?.candidateId === vote.candidateId
            && seen?.attemptId === vote.attemptId
            && seen?.rosterDigest === vote.rosterDigest;
    });
}

export function validateHostMigrationProposal(proposal, context = {}) {
    if (!proposal || typeof proposal !== 'object' || !isValidPlayerId(proposal.candidateId)) {
        return false;
    }
    const expectedEpoch = nextMigrationEpoch(context.currentEpoch);
    if (expectedEpoch === null || proposal.epoch !== expectedEpoch) return false;
    const candidates = Array.isArray(context.candidates) ? context.candidates : [];
    const expectedRoster = context.roster || candidates;
    const expectedDigest = migrationRosterDigest(expectedRoster);
    const expectedAttemptId = migrationAttemptId(
        proposal.epoch,
        expectedRoster,
        proposal.candidateId
    );
    if (!expectedDigest || !expectedAttemptId
        || proposal.rosterDigest !== expectedDigest
        || proposal.attemptId !== expectedAttemptId
        || (context.expectedRosterDigest !== undefined
            && proposal.rosterDigest !== context.expectedRosterDigest)
        || (context.expectedAttemptId !== undefined
            && proposal.attemptId !== context.expectedAttemptId)) return false;
    const candidate = candidates.find(item => item?.playerId === proposal.candidateId);
    const elected = selectHostCandidate(candidates);
    if (!isEligibleHostCandidate(candidate)
        || elected?.playerId !== proposal.candidateId
        || (context.expectedPeerId !== undefined
            && (proposal.hostPeerId !== context.expectedPeerId
                || candidate.peerId !== context.expectedPeerId))) return false;

    return migrationRostersMatch(proposal.roster, expectedRoster)
        && Array.isArray(proposal.votes)
        && proposal.votes.every(vote =>
            vote?.candidateId === proposal.candidateId
            && vote.attemptId === proposal.attemptId
            && vote.rosterDigest === proposal.rosterDigest)
        && votesMatchObserved(
            proposal.votes,
            context.observedVotes,
            proposal.epoch,
            proposal.attemptId,
            proposal.rosterDigest
        )
        && hasElectionAgreement(
            proposal.votes,
            proposal.candidateId,
            candidates,
            proposal.epoch,
            proposal.attemptId,
            proposal.rosterDigest
        );
}
