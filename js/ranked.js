// ranked.js — ELO-based ranked system for esport mode.
// ponytail: stdlib ELO formülü, store'a kaydet, basit.
const K = 32; // ELO katsayısı
const BASE_ELO = 1000;
const RANKS = [
    { name: 'Bronze',    min: 0,    emoji: '🥉', color: '#cd7f32' },
    { name: 'Silver',    min: 1100, emoji: '🥈', color: '#c0c0c0' },
    { name: 'Gold',      min: 1300, emoji: '🥇', color: '#ffd700' },
    { name: 'Platinum',  min: 1500, emoji: '💎', color: '#66e0ff' },
    { name: 'Diamond',   min: 1700, emoji: '💠', color: '#66ffcc' },
    { name: 'Master',    min: 1900, emoji: '👑', color: '#ff66ff' },
    { name: 'Grandmaster', min: 2100, emoji: '🏆', color: '#ff4444' }
];

// Beklenen skor (ELO farkına göre). 0..1 arası.
function expectedScore(eloA, eloB) {
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// ELO güncelle. winner/loser ELO'su döndür.
export function updateElo(winnerElo, loserElo, draw = false) {
    const eA = expectedScore(winnerElo, loserElo);
    const eB = 1 - eA;
    if (draw) {
        return {
            winner: Math.round(winnerElo + K * (0.5 - eA)),
            loser: Math.round(loserElo + K * (0.5 - eB))
        };
    }
    return {
        winner: Math.round(winnerElo + K * (1 - eA)),
        loser: Math.round(loserElo + K * (0 - eB))
    };
}

export function getRank(elo) {
    let rank = RANKS[0];
    for (const r of RANKS) if (elo >= r.min) rank = r;
    return rank;
}

export function getRankProgress(elo) {
    const rank = getRank(elo);
    const idx = RANKS.indexOf(rank);
    const next = RANKS[idx + 1];
    if (!next) return { rank, pct: 100, next: null };
    const pct = Math.min(100, ((elo - rank.min) / (next.min - rank.min)) * 100);
    return { rank, pct, next };
}

export const RANKED_BASE_ELO = BASE_ELO;
export const RANKED_RANKS = RANKS;

// ponytail: self-check
if (typeof window !== 'undefined' && window.location?.search?.includes('debug')) {
    const r = updateElo(1000, 1000);
    console.assert(r.winner > 1000, 'winner elo up');
    console.assert(r.loser < 1000, 'loser elo down');
    const d = updateElo(1000, 1000, true);
    console.assert(d.winner === 1016 && d.loser === 984, 'draw split');
    console.assert(getRank(1050).name === 'Bronze', 'bronze');
    console.assert(getRank(1400).name === 'Gold', 'gold');
}
