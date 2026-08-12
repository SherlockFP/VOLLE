const MATCH_ID = /^[A-Za-z0-9_-]{22,128}$/;
const MODES = new Set(['solo', 'casual', 'ranked']);

class MatchAuthority {
    constructor(profiles, { getLobby = () => null, now = () => Date.now(), minDurationMs = 20_000, ttlMs = 7200000, maxFinalized = 1000 } = {}) {
        this.profiles = profiles; this.getLobby = getLobby; this.now = now;
        this.minDurationMs = minDurationMs; this.ttlMs = ttlMs; this.maxFinalized = maxFinalized;
        this.matches = new Map(); this.activeByProfile = new Map(); this.finalized = new Map(); this.finalizedOrder = [];
    }
    _key(profile, id, mode) { return mode === 'solo' ? `solo:${profile.id}:${id}` : `${mode}:${id}`; }
    _valid(id, mode) { return MATCH_ID.test(String(id || '')) && MODES.has(mode); }
    _clean(now = this.now()) { for (const [key, match] of this.matches) if (now - match.startedAt > this.ttlMs) { this.matches.delete(key); for (const id of match.required) if (this.activeByProfile.get(id) === key) this.activeByProfile.delete(id); } }
    _public(match, profile) { return { matchId: match.id, mode: match.mode, status: match.finalized ? 'finalized' : match.reports.size ? 'pending' : match.readyAt ? 'ready' : 'started', participants: match.required.size, reported: match.reports.has(profile.id), profile: this.profiles._public(profile), completion: match.completions?.get(profile.id) || null }; }
    _lobbySnapshot(profile, lobbyCode, mode) {
        const lobby = this.getLobby(String(lobbyCode || ''));
        const members = lobby?.memberProfileIds instanceof Set ? lobby.memberProfileIds : new Set();
        if (!lobby || !members.has(profile.id) || members.size < 2) return null;
        if (mode === 'ranked' && lobby.ranked !== true) return null;
        if (mode === 'casual' && lobby.ranked === true) return null;
        const expectedCount = Math.max(2, Math.min(members.size, Math.floor(Number(lobby.players) || 2)));
        if (mode === 'ranked' && expectedCount !== 2) return null;
        return { members: new Set(members), expectedCount };
    }
    start(profile, { matchId, mode, lobbyCode }) {
        const now = this.now(); this._clean(now);
        if (!profile || !this._valid(matchId, mode)) return { httpStatus: 400, error: 'invalid match lifecycle' };
        const key = this._key(profile, matchId, mode);
        const active = this.activeByProfile.get(profile.id);
        if (active && active !== key) return { httpStatus: 409, error: 'profile already has an active match' };
        let match = this.matches.get(key);
        if (!match) {
            const snapshot = mode === 'solo' ? { members: new Set([profile.id]), expectedCount: 1 } : this._lobbySnapshot(profile, lobbyCode, mode);
            if (!snapshot) return { httpStatus: 403, error: 'authenticated lobby admission required' };
            if (mode === 'solo' && !this.profiles.canRewardSolo(profile, now) && !this.profiles.hasRewardedMatch(profile, matchId)) return { httpStatus: 429, error: 'daily solo reward limit reached' };
            match = { key, id: matchId, mode, startedAt: now, allowed: snapshot.members, expectedCount: snapshot.expectedCount, required: new Set(), started: new Set(), reports: new Map(), readyAt: null, finalized: false };
            this.matches.set(key, match);
        }
        if (!match.allowed.has(profile.id)) return { httpStatus: 403, error: 'not admitted to lobby match' };
        if (match.readyAt && !match.required.has(profile.id)) return { httpStatus: 409, error: 'match participants already frozen' };
        match.started.add(profile.id); this.activeByProfile.set(profile.id, key);
        if (match.started.size === match.expectedCount && !match.readyAt) {
            const required = new Set(match.started);
            if (match.mode === 'ranked' && !this.profiles.canStartRankedPair([...required], now)) {
                match.started.delete(profile.id);
                if (this.activeByProfile.get(profile.id) === key) this.activeByProfile.delete(profile.id);
                return { httpStatus: 429, error: 'daily ranked opponent limit reached' };
            }
            match.required = required; match.readyAt = now;
        }
        return { ...this._public(match, profile), httpStatus: 200, replayed: active === key };
    }
    status(profile, matchId) {
        const key = this.activeByProfile.get(profile?.id);
        const match = (key && (this.matches.get(key) || this.finalized.get(key)))
            || [...this.finalized.values()].find(item => item.id === matchId && item.required.has(profile?.id));
        if (!match || match.id !== matchId || !match.required.has(profile.id)) return { httpStatus: 404, error: 'match not found' };
        return { ...this._public(match, profile), httpStatus: 200 };
    }
    _finish(match) { match.finalized = true; this.matches.delete(match.key); for (const id of match.required) if (this.activeByProfile.get(id) === match.key) this.activeByProfile.delete(id); this.finalized.set(match.key, match); this.finalizedOrder.push(match.key); while (this.finalizedOrder.length > this.maxFinalized) this.finalized.delete(this.finalizedOrder.shift()); }
    _coherent(match) { const results = [...match.reports.values()].map(report => report.result); return results.every(x => x === 'draw') || (!results.includes('draw') && results.includes('win') && results.includes('loss')); }
    complete(profile, { matchId, mode, result, lobbyCode }) {
        const now = this.now(); this._clean(now);
        if (!profile || !this._valid(matchId, mode)) return { httpStatus: 400, error: 'invalid match lifecycle' };
        const key = this._key(profile, matchId, mode); const known = this.finalized.get(key);
        if (known) return { ...this._public(known, profile), httpStatus: 200, replayed: true };
        const match = this.matches.get(key);
        if (!match) return { httpStatus: 404, error: 'match was not started' };
        if (!match.required.has(profile.id)) {
            if (match.started.has(profile.id) && !match.readyAt) return { httpStatus: 409, error: 'match is not ready to complete' };
            return { httpStatus: 403, error: 'not a frozen match participant' };
        }
        if (match.started.size !== match.required.size || !match.readyAt || now - match.readyAt < this.minDurationMs) return { httpStatus: 409, error: 'match is not ready to complete' };
        if (mode === 'solo') {
            if (!this.profiles.hasRewardedMatch(profile, matchId) && !this.profiles.claimSoloReward(profile, matchId, now)) return { httpStatus: 429, error: 'daily solo reward limit reached' };
            const reward = this.profiles.reward(profile, { matchId, won: false, score: 0, deflections: 0 }, now);
            match.completions = new Map([[profile.id, reward]]); this._finish(match);
            return { ...this._public(match, profile), httpStatus: 200, replayed: reward.replayed === true };
        }
        if (!['win', 'loss', 'draw'].includes(result)) return { httpStatus: 400, error: 'invalid match result' };
        const prior = match.reports.get(profile.id); if (prior && prior.result !== result) return { httpStatus: 409, error: 'conflicting match result' };
        match.reports.set(profile.id, { result });
        if (match.reports.size !== match.required.size) return { ...this._public(match, profile), httpStatus: 202, pending: true };
        if (!this._coherent(match)) return { httpStatus: 409, error: 'incoherent match results' };
        const ids = [...match.required]; const completions = new Map();
        if (mode === 'ranked') {
            const [a, b] = ids; const ranked = this.profiles.finalizeRankedMatch(this.profiles.getById(a), this.profiles.getById(b), { matchId, firstResult: match.reports.get(a).result, secondResult: match.reports.get(b).result, playedAt: now });
            for (const id of ids) { const record = this.profiles.getById(id); const reward = this.profiles.reward(record, { matchId, won: match.reports.get(id).result === 'win', score: 0, deflections: 0 }, now); completions.set(id, { ...reward, rankedState: ranked[id] }); }
        } else for (const id of ids) { const record = this.profiles.getById(id); completions.set(id, this.profiles.reward(record, { matchId, won: match.reports.get(id).result === 'win', score: 0, deflections: 0 }, now)); }
        match.completions = completions; this._finish(match);
        return { ...this._public(match, profile), httpStatus: 200, replayed: false };
    }
}
module.exports = { MatchAuthority, MATCH_ID };
