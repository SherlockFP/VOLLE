// scoreboard.js — Score tracking, timer, round mgmt
export class Scoreboard {
    constructor() {
        this.players = new Map(); // name → { score, deflections, hits, team }
        this.roundNum = 0;
        this.maxRounds = 16;
        this.timeLimit = 300; // 5 min
        this.timeRemaining = this.timeLimit;
        this.redScore = 0;
        this.blueScore = 0;
    }

    addPlayer(name, team, opts = {}) {
        this.players.set(name, { score: 0, deflections: 0, hits: 0, team, ...opts });
    }

    removePlayer(name) {
        this.players.delete(name);
    }

    recordDeflection(name) {
        const p = this.players.get(name);
        if (p) p.deflections++;
    }

    recordHit(name) {
        const p = this.players.get(name);
        if (p) p.hits++;
    }

    recordPoint(name, amount = 1) {
        const p = this.players.get(name);
        if (p) {
            p.score += amount;
            if (p.team === 'red') this.redScore += amount;
            else this.blueScore += amount;
        }
    }

    newRound() {
        this.roundNum++;
    }

    updateTimer(dt) {
        this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    }

    isTimeUp() {
        return this.timeRemaining <= 0;
    }

    isMaxRounds() {
        return this.roundNum >= this.maxRounds;
    }

    getFormattedTime() {
        const min = Math.floor(this.timeRemaining / 60);
        const sec = Math.floor(this.timeRemaining % 60);
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    getWinner() {
        if (this.redScore > this.blueScore) return 'RED';
        if (this.blueScore > this.redScore) return 'BLUE';
        return 'DRAW';
    }

    getPlayerStats() {
        const stats = [];
        this.players.forEach((data, name) => {
            stats.push({ name, ...data });
        });
        stats.sort((a, b) => b.score - a.score);
        return stats;
    }

    reset() {
        this.roundNum = 0;
        this.timeRemaining = this.timeLimit;
        this.redScore = 0;
        this.blueScore = 0;
        this.players.forEach(p => {
            p.score = 0;
            p.deflections = 0;
            p.hits = 0;
        });
    }

    setTimeLimit(seconds) {
        this.timeLimit = seconds;
        this.timeRemaining = seconds;
    }

    setMaxRounds(n) {
        this.maxRounds = n;
    }
}
