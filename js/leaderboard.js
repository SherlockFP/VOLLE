// leaderboard.js — Local leaderboard with simulated AI opponents.
// ponytail: localStorage blob, Math.random drift, no server, no deps beyond store.
import { Store } from './store.js';

const LEADERBOARD_KEY = 'dodgball_leaderboard_v1';
const FAKE_COUNT = 50;

const ADJ = ['Neon','Quick','Shadow','Silent','Crimson','Iron','Frozen','Wild','Dark','Blaze',
             'Swift','Toxic','Lucky','Ghost','Mega','Turbo','Hyper','Sly','Vivid','Nimble'];
const NOUN = ['Fox','Tiger','Wolf','Hawk','Bear','Lion','Viper','Drake','Phantom','Wraith',
              'Raven','Shark','Dragon','Cobra','Panther','Eagle','Reaper','Titan','Specter','Jaguar'];

// ponytail: LCG so a wiped cache regenerates the same roster (stable identity).
function seededRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function generateFakes() {
    const rng = seededRng(12345);
    const players = [];
    for (let i = 0; i < FAKE_COUNT; i++) {
        const name = ADJ[Math.floor(rng() * ADJ.length)] + NOUN[Math.floor(rng() * NOUN.length)];
        const elo = Math.round(800 + rng() * 1600); // 800..2400
        // ponytail: index suffix guarantees unique tags (gamer handles do this anyway)
        const classes = ['scout', 'soldier', 'tank'];
        players.push({
            name: `${name}${i}`,
            elo,
            weeklyElo: Math.max(0, elo - Math.round(rng() * 220)),
            classId: classes[i % classes.length],
            fake: true
        });
    }
    return players;
}

class LeaderboardClass {
    constructor() {
        this.players = this._load();
        if (!this.players) {
            this.players = generateFakes();
            this._save();
        } else {
            const classes = ['scout', 'soldier', 'tank'];
            this.players = this.players.map((player, index) => ({
                ...player,
                weeklyElo: Number(player.weeklyElo) || Math.max(0, player.elo - (index * 17 % 220)),
                classId: player.classId || classes[index % classes.length]
            }));
        }
    }

    _load() {
        try {
            const raw = localStorage.getItem(LEADERBOARD_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    _save() {
        try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(this.players)); } catch {}
    }

    // Merge the real player (from store) by ELO so they show at the right rank.
    _merged() {
        const elo = Store?.getElo?.() ?? 1000;
        return [...this.players, { name: 'You', elo, fake: false }];
    }

    getTop(n = 10) {
        return this._merged().sort((a, b) => b.elo - a.elo).slice(0, n);
    }

    getFiltered(filter = 'global', {
        limit = 20,
        friends = [],
        classId = ''
    } = {}) {
        const friendSet = new Set(friends.map(name => String(name).toLowerCase()));
        let players = this._merged();
        if (filter === 'friends') {
            players = players.filter(player => !player.fake || friendSet.has(player.name.toLowerCase()));
        } else if (filter === 'class' && classId) {
            players = players.filter(player => !player.fake || player.classId === classId);
        }
        const scoreKey = filter === 'weekly' ? 'weeklyElo' : 'elo';
        return players
            .map(player => ({ ...player, displayElo: player[scoreKey] ?? player.elo }))
            .sort((a, b) => b.displayElo - a.displayElo)
            .slice(0, limit);
    }

    // 1-indexed rank a player with this ELO would hold.
    getPlayerRank(elo) {
        const sorted = this._merged().sort((a, b) => b.elo - a.elo);
        let rank = 1;
        for (const p of sorted) {
            if (p.elo > elo) rank++;
            else break;
        }
        return rank;
    }

    addPlayer(name, elo) {
        this.players.push({ name, elo, fake: false });
        this._save();
    }

    // ponytail: tiny ±5 ELO drift on fakes only — feels alive, never persists real players.
    refresh() {
        for (const p of this.players) {
            if (p.fake) p.elo = Math.max(800, Math.min(2400, p.elo + Math.round((Math.random() - 0.5) * 10)));
        }
        this._save();
    }
}

export const Leaderboard = new LeaderboardClass();

// ponytail: self-check under ?debug — minimal asserts, no test framework.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
    const lb = Leaderboard;
    console.assert(lb.players.length === FAKE_COUNT, 'fake count');
    const top = lb.getTop(5);
    console.assert(top.length === 5 && top[0].elo >= top[1].elo, 'top sorted desc');
    console.assert(lb.getPlayerRank(9999) === 1, 'max elo = rank 1');
    const myRank = lb.getPlayerRank(Store?.data?.stats?.rankedElo ?? 1000);
    console.assert(myRank >= 1 && myRank <= FAKE_COUNT + 1, 'my rank in range');
    const e0 = lb.players[0].elo;
    lb.refresh();
    console.assert(typeof lb.players[0].elo === 'number', 'refresh keeps numeric elo');
    lb.players[0].elo = e0; lb._save(); // undo drift so the self-check is idempotent
    console.log('[leaderboard] self-check ok', { fakeCount: lb.players.length, top, myRank });
}
