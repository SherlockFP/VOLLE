// matchhistory.js — localStorage-based match history + stats.
const KEY = 'dodgball_matchhistory_v1';
const MAX_MATCHES = 100;

class MatchHistoryClass {
    constructor() { this.data = this._load(); }

    _load() {
        try {
            const raw = localStorage.getItem(KEY);
            return raw ? JSON.parse(raw) : { matches: [], stats: { wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, damage: 0 } };
        } catch { return { matches: [], stats: { wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, damage: 0 } }; }
    }

    _save() { localStorage.setItem(KEY, JSON.stringify(this.data)); }

    add(result) {
        this.data.matches.unshift({
            ...result,
            date: Date.now(),
            id: `m${Date.now()}`
        });
        if (this.data.matches.length > MAX_MATCHES) this.data.matches.pop();
        if (result.winner === result.playerName) {
            this.data.stats.wins++;
            this.data.stats.kills += result.kills || 0;
        } else if (result.loser === result.playerName) {
            this.data.stats.losses++;
            this.data.stats.deaths += result.deaths || 0;
        } else {
            this.data.stats.draws++;
        }
        this.data.stats.damage += result.damage || 0;
        this._save();
    }

    getRecent(n = 10) { return this.data.matches.slice(0, n); }
    getStats() { return { ...this.data.stats }; }
    getWinRate() {
        const t = this.data.stats.wins + this.data.stats.losses + this.data.stats.draws;
        return t ? Math.round((this.data.stats.wins / t) * 100) : 0;
    }
}

export const MatchHistory = new MatchHistoryClass();

// ponytail: self-check
if (typeof window !== 'undefined' && window.location?.search?.includes('debug')) {
    const m = new MatchHistoryClass();
    console.assert(Array.isArray(m.data.matches), 'matches array');
    console.assert(typeof m.getStats() === 'object', 'stats object');
}
