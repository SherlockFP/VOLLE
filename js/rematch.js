const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function isSafeMatchId(value) {
    return typeof value === 'string' && SAFE_ID.test(value);
}

export function createMatchId() {
    return globalThis.crypto?.randomUUID?.()
        || `match-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePlayerIds(playerIds) {
    return [...new Set(Array.from(playerIds || []).filter(isSafeMatchId))].sort();
}

export function isTerminalRematchState(state) {
    return state === 'celebration';
}

export function snapshotRematchParticipants(localPlayerId, connectedPlayerIds, queuedPlayerIds = []) {
    const queued = new Set(normalizePlayerIds(queuedPlayerIds));
    return normalizePlayerIds([localPlayerId, ...Array.from(connectedPlayerIds || [])])
        .filter(playerId => !queued.has(playerId));
}

export function connectedRematchParticipants(completedPlayerIds, localPlayerId, connectedPlayerIds) {
    const connected = new Set(normalizePlayerIds([
        localPlayerId,
        ...Array.from(connectedPlayerIds || [])
    ]));
    return normalizePlayerIds(completedPlayerIds)
        .filter(playerId => connected.has(playerId));
}

export class RematchVote {
    constructor() {
        this.reset();
    }

    reset() {
        this.sourceMatchId = null;
        this.required = new Set();
        this.ready = new Set();
        this.started = false;
    }

    begin(sourceMatchId, playerIds) {
        if (!isSafeMatchId(sourceMatchId)) return { accepted: false, reason: 'invalid-match' };
        const required = normalizePlayerIds(playerIds);
        if (!required.length) return { accepted: false, reason: 'no-players' };
        this.sourceMatchId = sourceMatchId;
        this.required = new Set(required);
        this.ready.clear();
        this.started = false;
        return { accepted: true, ...this.snapshot() };
    }

    setRequired(playerIds) {
        this.required = new Set(normalizePlayerIds(playerIds));
        this.ready = new Set([...this.ready].filter(id => this.required.has(id)));
        return this.snapshot();
    }

    vote(sourceMatchId, playerId, ready = true) {
        if (this.started) return { accepted: false, reason: 'already-started' };
        if (sourceMatchId !== this.sourceMatchId) return { accepted: false, reason: 'stale-match' };
        if (!this.required.has(playerId)) return { accepted: false, reason: 'unknown-player' };
        const changed = ready ? !this.ready.has(playerId) : this.ready.has(playerId);
        if (!changed) return { accepted: true, changed: false, ...this.snapshot() };
        if (ready) this.ready.add(playerId);
        else this.ready.delete(playerId);
        return { accepted: true, changed: true, ...this.snapshot() };
    }

    markStarted(sourceMatchId, nextMatchId) {
        if (this.started) return { accepted: false, reason: 'already-started' };
        if (sourceMatchId !== this.sourceMatchId) return { accepted: false, reason: 'stale-match' };
        if (!isSafeMatchId(nextMatchId) || nextMatchId === sourceMatchId) {
            return { accepted: false, reason: 'invalid-next-match' };
        }
        if (!this.snapshot().complete) return { accepted: false, reason: 'not-ready' };
        this.started = true;
        return { accepted: true, nextMatchId, ...this.snapshot() };
    }

    snapshot() {
        const requiredPlayerIds = [...this.required].sort();
        const readyPlayerIds = [...this.ready].filter(id => this.required.has(id)).sort();
        return {
            sourceMatchId: this.sourceMatchId,
            requiredPlayerIds,
            readyPlayerIds,
            complete: requiredPlayerIds.length > 0
                && requiredPlayerIds.every(id => this.ready.has(id)),
            started: this.started
        };
    }
}
