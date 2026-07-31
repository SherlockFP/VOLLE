// achievements.js — 15+ achievements for addicting progression.
// ponytail: tek dosya, basit objeler, store'a kaydet. game.js'den hook'lanır.
// Store, self-mounted progress bar UI'sinin dynamic import ile (checkAchievements()
// içindeki store parametresinden bağımsız) Store singleton'ına erişmesi için — bkz.
// dosya sonu. checkAchievements() bu importu KULLANMAZ, çağıran her yerden aldığı
// `store` parametresini kullanmaya devam eder (test edilebilirlik / import döngüsü riski).
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
    },
    century_club: {
        id: 'century_club', name: 'Century Club', emoji: '💯', desc: '100 maç oyna',
        check: (s) => s.gamesPlayed >= 100, reward: 750,
        progress: (s) => ({ current: s.gamesPlayed, target: 100 })
    },
    ball_hoarder: {
        id: 'ball_hoarder', name: 'Ball Hoarder', emoji: '🥎', desc: '10 top skini sahiplen',
        check: (s) => s.ballsOwned >= 10, reward: 350,
        progress: (s) => ({ current: s.ballsOwned, target: 10 })
    },
    case_curious: {
        id: 'case_curious', name: 'Case Curious', emoji: '🎁', desc: '3 farklı kasa türü dene',
        check: (s) => s.casesTried >= 3, reward: 150,
        progress: (s) => ({ current: s.casesTried, target: 3 })
    },
    marksman: {
        id: 'marksman', name: 'Marksman', emoji: '🏹', desc: '200 toplam isabet',
        check: (s) => s.totalHits >= 200, reward: 300,
        progress: (s) => ({ current: s.totalHits, target: 200 })
    },
    fashionista: {
        id: 'fashionista', name: 'Fashionista', emoji: '🧣', desc: '5 kozmetik eşya sahiplen',
        check: (s) => s.cosmeticsOwned >= 5, reward: 200,
        progress: (s) => ({ current: s.cosmeticsOwned, target: 5 })
    },
    streak_master: {
        id: 'streak_master', name: 'Streak Master', emoji: '📅', desc: '7 gün üst üste giriş yap',
        check: (s) => s.loginStreak >= 7, reward: 400,
        progress: (s) => ({ current: s.loginStreak, target: 7 })
    },
    rich: {
        id: 'rich', name: 'Rich', emoji: '💵', desc: '5000 coin biriktir',
        check: (s) => s.currency >= 5000, reward: 500,
        progress: (s) => ({ current: s.currency, target: 5000 })
    },
    ranked_climber: {
        id: 'ranked_climber', name: 'Ranked Climber', emoji: '📈', desc: '1200 ranked ELO\'ya ulaş',
        check: (s) => s.rankedElo >= 1200, reward: 350,
        progress: (s) => ({ current: Math.max(0, s.rankedElo || 0), target: 1200 })
    },
    dominant_win: {
        id: 'dominant_win', name: 'Dominant Win', emoji: '💥', desc: 'Kritik vuruş + 3 spike ile maçı kazan',
        check: (s, ctx) => !!ctx.won && !!ctx.criticalHit && (ctx.spikes || 0) >= 3, reward: 250
    },
    iron_wall: {
        id: 'iron_wall', name: 'Iron Wall', emoji: '🛡️', desc: 'En fazla 3 hasarla maçı kazan',
        check: (s, ctx) => !!ctx.won && ctx.damageTaken > 0 && ctx.damageTaken <= 3, reward: 200
    }
};

// store.data'dan türetilmiş salt-okunur snapshot. checkAchievements() ve dosya
// sonundaki progress-bar mount'u ikisi de bunu kullanır — stat listesi tek yerde.
export function deriveAchievementStats(store) {
    const stats = store.get('stats') || {};
    return {
        ...stats,
        charsOwned: store.get('unlockedChars').length,
        ballsOwned: store.get('ownedBalls').length,
        bpTier: store.get('battlepass').tier,
        hasAvatar: !!store.get('customAvatar'),
        totalSpent: stats.totalSpent || 0,
        winStreak: stats.winStreak || 0,
        cosmeticsOwned: (store.get('ownedCosmetics') || []).length,
        casesTried: Object.keys(store.get('casePity') || {}).length,
        loginStreak: (store.get('dailyRewards') || {}).loginStreak || 0,
        currency: store.get('currency') || 0
    };
}

// Tüm achievement'ları kontrol et, yeni açılanları döndür.
// store: store.data.stats, ctx: maç içi context {rally, won, damageTaken, spikes, criticalHit, finalHp}
export function checkAchievements(store, ctx = {}) {
    const derived = deriveAchievementStats(store);
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

// Bir achievement'ın progress hedefine göre {current, target, pct} döndürür, yoksa null.
export function computeAchievementProgress(a, derived) {
    if (typeof a.progress !== 'function') return null;
    try {
        const { current, target } = a.progress(derived) || {};
        if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return null;
        const clamped = Math.min(Math.max(current, 0), target);
        return { current: clamped, target, pct: (clamped / target) * 100 };
    } catch {
        return null;
    }
}

// ===== Achievement ekranı progress bar'ları (self-mounted) =====
// ui.js#renderAchievements() kartları progress bar olmadan çizer; ui.js bu slice'ın
// kapsamı dışında (MIMO Phase 4 #17 raporuna bkz). Bu blok #achievement-grid'i
// non-invasive izler: her render sonrası kilitli + progress-eligible kartlara minimal
// bir ilerleme çubuğu ekler. Store, sadece gerçekten tetiklendiğinde dynamic import
// edilir — Node/test ortamında (document yok) hiç yüklenmez, hiçbir şey çalışmaz.
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    const grid = document.getElementById('achievement-grid');
    if (grid) {
        const observer = new MutationObserver(async () => {
            const cards = grid.querySelectorAll('.achievement-card');
            if (!cards.length) return;
            const { Store } = await import('./store.js');
            const achievements = Object.values(ACHIEVEMENTS);
            const derived = deriveAchievementStats(Store);
            cards.forEach((card, i) => {
                const a = achievements[i];
                if (!a || card.classList.contains('unlocked')) return;
                const progress = computeAchievementProgress(a, derived);
                if (!progress) return;
                const wrap = document.createElement('div');
                wrap.className = 'ach-progress';
                const track = document.createElement('div');
                track.className = 'ach-progress-track';
                const fill = document.createElement('div');
                fill.className = 'ach-progress-fill';
                fill.style.width = `${progress.pct}%`;
                track.appendChild(fill);
                const label = document.createElement('span');
                label.className = 'ach-progress-label';
                label.textContent = `${Math.floor(progress.current)}/${progress.target}`;
                wrap.appendChild(track);
                wrap.appendChild(label);
                card.appendChild(wrap);
            });
        });
        observer.observe(grid, { childList: true });
    }
}
