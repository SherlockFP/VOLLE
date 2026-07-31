// daily.js — Daily challenges for addicting retention. 24h reset.
// ponytail: localStorage ile tarih kontrol, basit objeler.
const DAILY_KEY = 'dodgball_daily_v1';

// Battlepass XP bridge (was the biggest progression-loop gap: completing dailies
// gave coins but no battlepass progress). js/store.js#claimDailyChallenge is the
// only writer of battlepass XP for these; it grants DAILY_CHALLENGE_XP per claimed
// challenge and DAILY_ALL_COMPLETE_BONUS_XP once per day when all 3 are claimed.
// Idempotency lives here, not in the caller: `claimed` (per challenge) and
// `bonusGranted` (per day) are persisted fields that only reset in `_reset()`,
// i.e. on an actual day rollover — so re-claiming, reloading, or re-rendering the
// UI can never re-trigger a grant. Values are roughly a third and a full match's
// worth of xp (see js/main.js grant({xp}) call), enough to matter without
// dwarfing normal match progression.
export const DAILY_CHALLENGE_XP = 50;
export const DAILY_ALL_COMPLETE_BONUS_XP = 100;

// Pure award math, exported so the bridge's numbers stay unit-testable without
// localStorage, a Store instance or a DOM. Callers own idempotency (claim() and
// claimCompletionBonus() below); this only answers "how much xp is that worth".
// Hostile input degrades to 0 rather than poisoning battlepass xp with NaN.
export function dailyXpAward(challengesClaimed = 0, allComplete = false) {
    const n = Math.floor(Number(challengesClaimed));
    const claimed = Number.isFinite(n) && n > 0 ? n : 0;
    return claimed * DAILY_CHALLENGE_XP + (allComplete === true ? DAILY_ALL_COMPLETE_BONUS_XP : 0);
}

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
            if (!data || typeof data !== 'object' || data.date !== todayKey() || !Array.isArray(data.challenges)) {
                this._reset();
                return;
            }
            this.data = data;
        } catch { this._reset(); }
    }

    _reset() {
        const date = todayKey();
        const challenges = pickDailies(date).map(c => ({
            ...c, progress: 0, claimed: false
        }));
        this.data = { date, challenges, bonusGranted: false };
        this._save();
    }

    _save() { try { localStorage.setItem(DAILY_KEY, JSON.stringify(this.data)); } catch {} }

    getChallenges() { this._load(); return this.data.challenges; }

    // Maç sonunda ilerleme güncelle. ctx: {won, deflects, bestRally, spikes, damage, winStreak, cleanWin}
    // Side note for the post-match reward screen: this records which challenges
    // actually moved this match into `_lastMatch` (before/after per challenge).
    // js/ui.js consumes it through takeLastMatchProgress(), which clears it — so a
    // practice match (which never calls progress()) can't replay a stale delta.
    progress(ctx) {
        this._load();
        const deltas = [];
        this.data.challenges.forEach(c => {
            if (c.claimed) return;
            const before = c.progress;
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
            if (c.progress > before) {
                deltas.push({ id: c.id, name: c.name, emoji: c.emoji, target: c.target, from: before, to: c.progress });
            }
        });
        this._lastMatch = deltas;
        this._save();
    }

    // Returns (and clears) the challenges that advanced in the last completed
    // match. Clearing on read keeps the post-match screen honest: it can only
    // ever show progress from the match it is reporting on.
    takeLastMatchProgress() {
        const deltas = this._lastMatch || [];
        this._lastMatch = [];
        return deltas;
    }

    claim(challengeId) {
        this._load();
        const c = this.data.challenges.find(x => x.id === challengeId);
        if (!c || c.claimed || c.progress < c.target) return false;
        c.claimed = true;
        this._save();
        return c.reward;
    }

    // One-time per-day "all 3 done" bonus. Idempotent by construction: `bonusGranted`
    // only flips true here and only resets in `_reset()` (real day rollover), so
    // calling this after every successful claim() is always safe to repeat.
    claimCompletionBonus() {
        this._load();
        if (this.data.bonusGranted) return false;
        if (!Array.isArray(this.data.challenges) || this.data.challenges.length === 0) return false;
        if (!this.data.challenges.every(c => c.claimed)) return false;
        this.data.bonusGranted = true;
        this._save();
        return true;
    }

    isBonusClaimed() { this._load(); return this.data.bonusGranted === true; }

    isExpired() { return this.data.date !== todayKey(); }
}

export const Daily = new DailyClass();
