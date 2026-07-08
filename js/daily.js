// daily.js — Daily challenges for addicting retention. 24h reset.
// ponytail: localStorage ile tarih kontrol, basit objeler.
const DAILY_KEY = 'dodgball_daily_v1';

const CHALLENGE_POOL = [
    { id: 'win_3', name: 'Win 3 Matches', emoji: '🏆', target: 3, type: 'wins', reward: 100 },
    { id: 'deflect_50', name: '50 Deflects', emoji: '🏐', target: 50, type: 'deflects', reward: 80 },
    { id: 'play_5', name: 'Play 5 Matches', emoji: '🎮', target: 5, type: 'games', reward: 60 },
    { id: 'rally_7', name: '7 Rally in One Match', emoji: '🔥', target: 7, type: 'bestRally', reward: 120 },
    { id: 'spike_5', name: '5 Spike Shots', emoji: '💥', target: 5, type: 'spikes', reward: 90 },
    { id: 'damage_500', name: 'Deal 500 Damage', emoji: '⚔️', target: 500, type: 'damage', reward: 110 },
    { id: 'win_streak_2', name: '2 Win Streak', emoji: '🌶️', target: 2, type: 'winStreak', reward: 150 },
    { id: 'no_damage_win', name: 'Win Without Damage', emoji: '✨', target: 1, type: 'cleanWins', reward: 200 }
];

// Bugünün tarih anahtarı (YYYY-MM-DD)
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Günlük 3 challenge seç (deterministic — tarihe göre seed).
function pickDailies(dateKey) {
    let seed = 0;
    for (let i = 0; i < dateKey.length; i++) seed = (seed * 31 + dateKey.charCodeAt(i)) | 0;
    const pool = [...CHALLENGE_POOL];
    const picked = [];
    for (let i = 0; i < 3; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const idx = seed % pool.length;
        picked.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return picked;
}

class DailyClass {
    constructor() { this._load(); }

    _load() {
        try {
            const raw = localStorage.getItem(DAILY_KEY);
            if (!raw) { this._reset(); return; }
            const data = JSON.parse(raw);
            if (data.date !== todayKey()) { this._reset(); return; }
            this.data = data;
        } catch { this._reset(); }
    }

    _reset() {
        const date = todayKey();
        const challenges = pickDailies(date).map(c => ({
            ...c, progress: 0, claimed: false
        }));
        this.data = { date, challenges };
        this._save();
    }

    _save() { try { localStorage.setItem(DAILY_KEY, JSON.stringify(this.data)); } catch {} }

    getChallenges() { this._load(); return this.data.challenges; }

    // Maç sonunda ilerleme güncelle. ctx: {won, deflects, bestRally, spikes, damage, winStreak, cleanWin}
    progress(ctx) {
        this._load();
        this.data.challenges.forEach(c => {
            if (c.claimed) return;
            switch (c.type) {
                case 'wins': if (ctx.won) c.progress++; break;
                case 'deflects': c.progress += ctx.deflects || 0; break;
                case 'games': c.progress++; break;
                case 'bestRally': c.progress = Math.max(c.progress, ctx.bestRally || 0); break;
                case 'spikes': c.progress += ctx.spikes || 0; break;
                case 'damage': c.progress += ctx.damage || 0; break;
                case 'winStreak': c.progress = Math.max(c.progress, ctx.winStreak || 0); break;
                case 'cleanWins': if (ctx.cleanWin) c.progress++; break;
            }
            c.progress = Math.min(c.progress, c.target);
        });
        this._save();
    }

    claim(challengeId) {
        this._load();
        const c = this.data.challenges.find(x => x.id === challengeId);
        if (!c || c.claimed || c.progress < c.target) return false;
        c.claimed = true;
        this._save();
        return c.reward;
    }

    isExpired() { return this.data.date !== todayKey(); }
}

export const Daily = new DailyClass();
