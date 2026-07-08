// tournament.js — Single-elimination bracket for local/esport feel.
// ponytail: tek dosya, basit bracket tree, localStorage kaydet.
const KEY = 'dodgball_tournament_v1';

export class Tournament {
    constructor() {
        this.bracket = null;
        this.players = [];
        this.round = 0;
    }

    // Oyuncu listesinden bracket oluştur (8/16/32 oyuncu).
    create(playerNames) {
        // ponytail: bye'leri doldur, power-of-2'ye yuvarla
        let n = 2;
        while (n < playerNames.length) n *= 2;
        const padded = [...playerNames];
        while (padded.length < n) padded.push(`BYE-${padded.length}`);

        const matches = [];
        for (let i = 0; i < n; i += 2) {
            matches.push({
                id: `m${i/2}`,
                p1: padded[i], p2: padded[i+1],
                winner: null, score1: 0, score2: 0,
                played: false
            });
        }
        this.bracket = { rounds: [matches], currentRound: 0, champion: null };
        this.players = padded;
        this.round = 0;
        this._save();
        return this.bracket;
    }

    // Maç sonucunu kaydet, bir sonraki tura hazırla.
    recordResult(matchId, winner, score1 = 0, score2 = 0) {
        const match = this.bracket.rounds[this.round].find(m => m.id === matchId);
        if (!match || match.played) return false;
        match.winner = winner;
        match.score1 = score1;
        match.score2 = score2;
        match.played = true;

        // Tüm maçlar oynandıysa bir sonraki turu oluştur
        const allPlayed = this.bracket.rounds[this.round].every(m => m.played);
        if (allPlayed) {
            const winners = this.bracket.rounds[this.round].map(m => m.winner);
            if (winners.length === 1) {
                this.bracket.champion = winners[0];
            } else {
                const nextMatches = [];
                for (let i = 0; i < winners.length; i += 2) {
                    nextMatches.push({
                        id: `r${this.round+1}m${i/2}`,
                        p1: winners[i], p2: winners[i+1],
                        winner: null, score1: 0, score2: 0, played: false
                    });
                }
                this.bracket.rounds.push(nextMatches);
                this.round++;
            }
        }
        this._save();
        return true;
    }

    getCurrentMatches() {
        return this.bracket?.rounds[this.round] || [];
    }

    getChampion() { return this.bracket?.champion; }
    getBracket() { return this.bracket; }
    isActive() { return !!this.bracket && !this.bracket.champion; }

    reset() { this.bracket = null; this.players = []; this.round = 0; this._save(); }

    _save() { try { localStorage.setItem(KEY, JSON.stringify(this.bracket)); } catch {} }
    _load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                this.bracket = JSON.parse(raw);
                this.round = this.bracket.currentRound || 0;
            }
        } catch {}
    }
}

export const tournament = new Tournament();
