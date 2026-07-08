// achievements.js — 15+ achievements for addicting progression.
// ponytail: tek dosya, basit objeler, store'a kaydet. game.js'den hook'lanır.
export const ACHIEVEMENTS = {
    first_blood: {
        id: 'first_blood', name: 'First Blood', emoji: '🩸', desc: 'İlk hasarını ver',
        check: (s) => s.totalHits >= 1, reward: 50
    },
    first_win: {
        id: 'first_win', name: 'First Victory', emoji: '🏆', desc: 'İlk maçını kazan',
        check: (s) => s.totalWins >= 1, reward: 100
    },
    rally_5: {
        id: 'rally_5', name: 'Rally Master', emoji: '🏐', desc: '5 rally tek maçta',
        check: (s, ctx) => ctx.rally >= 5, reward: 75
    },
    rally_10: {
        id: 'rally_10', name: 'Rally Legend', emoji: '🔥', desc: '10 rally tek maçta',
        check: (s, ctx) => ctx.rally >= 10, reward: 200
    },
    sharpshooter: {
        id: 'sharpshooter', name: 'Sharpshooter', emoji: '🎯', desc: '50 toplam deflect',
        check: (s) => s.totalDeflects >= 50, reward: 150
    },
    sniper_master: {
        id: 'sniper_master', name: 'Sniper Master', emoji: '💫', desc: '10 spike şut',
        check: (s, ctx) => (ctx.spikes || 0) >= 10, reward: 100
    },
    untouchable: {
        id: 'untouchable', name: 'Untouchable', emoji: '✨', desc: 'Bir maçta hasar alma',
        check: (s, ctx) => ctx.won && ctx.damageTaken === 0, reward: 300
    },
    veteran: {
        id: 'veteran', name: 'Veteran', emoji: '🎖️', desc: '10 maç oyna',
        check: (s) => s.gamesPlayed >= 10, reward: 100
    },
    veteran_50: {
        id: 'veteran_50', name: 'Seasoned Veteran', emoji: '🏅', desc: '50 maç oyna',
        check: (s) => s.gamesPlayed >= 50, reward: 500
    },
    win_streak_3: {
        id: 'win_streak_3', name: 'Hot Streak', emoji: '🌶️', desc: '3 maç üst üste kazan',
        check: (s) => s.winStreak >= 3, reward: 150
    },
    win_streak_5: {
        id: 'win_streak_5', name: 'On Fire', emoji: '🔥', desc: '5 maç üst üste kazan',
        check: (s) => s.winStreak >= 5, reward: 400
    },
    big_spender: {
        id: 'big_spender', name: 'Big Spender', emoji: '💰', desc: '500 coin harca',
        check: (s) => s.totalSpent >= 500, reward: 100
    },
    collector: {
        id: 'collector', name: 'Collector', emoji: '📦', desc: '5 karakter sahiplen',
        check: (s) => s.charsOwned >= 5, reward: 200
    },
    ball_collector: {
        id: 'ball_collector', name: 'Ball Collector', emoji: '🥎', desc: '5 top skin sahiplen',
        check: (s) => s.ballsOwned >= 5, reward: 200
    },
    bp_tier_10: {
        id: 'bp_tier_10', name: 'Battle Pass Climber', emoji: '🎟️', desc: 'Battle pass tier 10',
        check: (s) => s.bpTier >= 10, reward: 100
    },
    bp_tier_50: {
        id: 'bp_tier_50', name: 'Battle Pass Maxed', emoji: '👑', desc: 'Battle pass tier 50',
        check: (s) => s.bpTier >= 50, reward: 1000
    },
    artist: {
        id: 'artist', name: 'Avatar Artist', emoji: '🎨', desc: 'Avatar çiz',
        check: (s) => s.hasAvatar, reward: 50
    },
    critical_hit: {
        id: 'critical_hit', name: 'Critical Strike', emoji: '💢', desc: '3 miss ramp ile hasar ver',
        check: (s, ctx) => ctx.criticalHit, reward: 100
    },
    comeback: {
        id: 'comeback', name: 'Comeback King', emoji: '👑', desc: '10 HP altında kazan',
        check: (s, ctx) => ctx.won && ctx.finalHp <= 10, reward: 250
    }
};

// Tüm achievement'ları kontrol et, yeni açılanları döndür.
// store: store.data.stats, ctx: maç içi context {rally, won, damageTaken, spikes, criticalHit, finalHp}
export function checkAchievements(store, ctx = {}) {
    const stats = store.get('stats') || {};
    // Türetilmiş statlar
    const derived = {
        ...stats,
        charsOwned: store.get('unlockedChars').length,
        ballsOwned: store.get('ownedBalls').length,
        bpTier: store.get('battlepass').tier,
        hasAvatar: !!store.get('customAvatar'),
        totalSpent: stats.totalSpent || 0,
        winStreak: stats.winStreak || 0
    };
    const unlocked = store.get('unlockedAchievements') || [];
    const newlyUnlocked = [];
    Object.values(ACHIEVEMENTS).forEach(a => {
        if (unlocked.includes(a.id)) return;
        try {
            if (a.check(derived, ctx)) {
                unlocked.push(a.id);
                newlyUnlocked.push(a);
                store.grant({ currency: a.reward });
            }
        } catch {}
    });
    if (newlyUnlocked.length) store.set('unlockedAchievements', unlocked);
    return newlyUnlocked;
}
