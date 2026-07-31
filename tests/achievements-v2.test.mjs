// tests/achievements-v2.test.mjs — MIMO Phase 4 #17: Achievement System Enhancement
// (10 new achievements). Pure-logic coverage for js/achievements.js: required fields
// on the 10 new entries, unlock thresholds (check), progress computation (pure), and
// checkAchievements() integration (unlock + reward grant + idempotency). No DOM/browser
// needed — the self-mounted progress-bar UI block at the end of achievements.js is a
// no-op under plain Node (guarded by `typeof document !== 'undefined'`), so importing
// the module here never touches store.js or the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, checkAchievements, deriveAchievementStats, computeAchievementProgress } from '../js/achievements.js';

const NEW_IDS = [
    'century_club', 'ball_hoarder', 'case_curious', 'marksman', 'fashionista',
    'streak_master', 'rich', 'ranked_climber', 'dominant_win', 'iron_wall'
];

function makeStore(overrides = {}) {
    const data = {
        stats: { gamesPlayed: 0, totalWins: 0, totalDeflects: 0, totalHits: 0, bestRally: 0, totalSpent: 0, winStreak: 0, rankedElo: 1000, rankedGames: 0 },
        unlockedChars: [],
        ownedBalls: [],
        battlepass: { tier: 0 },
        customAvatar: null,
        ownedCosmetics: [],
        casePity: {},
        dailyRewards: { loginStreak: 0 },
        currency: 0,
        unlockedAchievements: [],
        ...overrides
    };
    return {
        get: (k) => data[k],
        set: (k, v) => { data[k] = v; },
        grant: ({ currency = 0 } = {}) => { data.currency += currency; },
        _data: data
    };
}

test('all 10 new achievements exist with required fields (id, name, emoji, desc, check, reward)', () => {
    assert.equal(NEW_IDS.length, 10);
    for (const id of NEW_IDS) {
        const a = ACHIEVEMENTS[id];
        assert.ok(a, `missing achievement ${id}`);
        assert.equal(a.id, id);
        assert.equal(typeof a.name, 'string');
        assert.ok(a.name.length > 0);
        assert.equal(typeof a.emoji, 'string');
        assert.equal(typeof a.desc, 'string');
        assert.ok(a.desc.length > 0);
        assert.equal(typeof a.check, 'function');
        assert.equal(typeof a.reward, 'number');
        assert.ok(a.reward > 0);
    }
});

test('no duplicate achievement ids across the whole catalog (19 original + 10 new)', () => {
    const ids = Object.values(ACHIEVEMENTS).map(a => a.id);
    assert.equal(ids.length, 29);
    assert.equal(new Set(ids).size, ids.length);
});

test('progress-eligible new achievements expose a progress() function; per-match ones do not', () => {
    const progressIds = ['century_club', 'ball_hoarder', 'case_curious', 'marksman', 'fashionista', 'streak_master', 'rich', 'ranked_climber'];
    for (const id of progressIds) {
        assert.equal(typeof ACHIEVEMENTS[id].progress, 'function', `${id} should expose progress()`);
    }
    assert.equal(ACHIEVEMENTS.dominant_win.progress, undefined);
    assert.equal(ACHIEVEMENTS.iron_wall.progress, undefined);
});

test('deriveAchievementStats maps new store fields (cosmeticsOwned, casesTried, loginStreak, currency)', () => {
    const store = makeStore({
        ownedCosmetics: ['cape_ember', 'cape_frost'],
        casePity: { kickoff: 3, chroma: 0 },
        dailyRewards: { loginStreak: 5 },
        currency: 1234
    });
    const derived = deriveAchievementStats(store);
    assert.equal(derived.cosmeticsOwned, 2);
    assert.equal(derived.casesTried, 2);
    assert.equal(derived.loginStreak, 5);
    assert.equal(derived.currency, 1234);
});

test('deriveAchievementStats tolerates missing/malformed store fields', () => {
    const store = makeStore({ ownedCosmetics: undefined, casePity: null, dailyRewards: undefined, currency: undefined });
    const derived = deriveAchievementStats(store);
    assert.equal(derived.cosmeticsOwned, 0);
    assert.equal(derived.casesTried, 0);
    assert.equal(derived.loginStreak, 0);
    assert.equal(derived.currency, 0);
});

test('century_club unlocks at 100 games played, not before', () => {
    assert.equal(ACHIEVEMENTS.century_club.check({ gamesPlayed: 99 }), false);
    assert.equal(ACHIEVEMENTS.century_club.check({ gamesPlayed: 100 }), true);
});

test('ball_hoarder unlocks at 10 owned ball skins', () => {
    assert.equal(ACHIEVEMENTS.ball_hoarder.check({ ballsOwned: 9 }), false);
    assert.equal(ACHIEVEMENTS.ball_hoarder.check({ ballsOwned: 10 }), true);
});

test('case_curious unlocks after trying 3 distinct case types', () => {
    assert.equal(ACHIEVEMENTS.case_curious.check({ casesTried: 2 }), false);
    assert.equal(ACHIEVEMENTS.case_curious.check({ casesTried: 3 }), true);
});

test('marksman unlocks at 200 total hits', () => {
    assert.equal(ACHIEVEMENTS.marksman.check({ totalHits: 199 }), false);
    assert.equal(ACHIEVEMENTS.marksman.check({ totalHits: 200 }), true);
});

test('fashionista unlocks at 5 owned cosmetics', () => {
    assert.equal(ACHIEVEMENTS.fashionista.check({ cosmeticsOwned: 4 }), false);
    assert.equal(ACHIEVEMENTS.fashionista.check({ cosmeticsOwned: 5 }), true);
});

test('streak_master unlocks at a 7-day login streak', () => {
    assert.equal(ACHIEVEMENTS.streak_master.check({ loginStreak: 6 }), false);
    assert.equal(ACHIEVEMENTS.streak_master.check({ loginStreak: 7 }), true);
});

test('rich unlocks at 5000 currency', () => {
    assert.equal(ACHIEVEMENTS.rich.check({ currency: 4999 }), false);
    assert.equal(ACHIEVEMENTS.rich.check({ currency: 5000 }), true);
});

test('ranked_climber unlocks at 1200 ranked ELO', () => {
    assert.equal(ACHIEVEMENTS.ranked_climber.check({ rankedElo: 1199 }), false);
    assert.equal(ACHIEVEMENTS.ranked_climber.check({ rankedElo: 1200 }), true);
});

test('dominant_win requires a won match with a critical hit and 3+ spikes', () => {
    assert.equal(ACHIEVEMENTS.dominant_win.check({}, { won: true, criticalHit: true, spikes: 2 }), false);
    assert.equal(ACHIEVEMENTS.dominant_win.check({}, { won: false, criticalHit: true, spikes: 3 }), false);
    assert.equal(ACHIEVEMENTS.dominant_win.check({}, { won: true, criticalHit: false, spikes: 5 }), false);
    assert.equal(ACHIEVEMENTS.dominant_win.check({}, { won: true, criticalHit: true, spikes: 3 }), true);
});

test('iron_wall requires a won match with 1-3 damage taken (0 is untouchable, not iron_wall)', () => {
    assert.equal(ACHIEVEMENTS.iron_wall.check({}, { won: true, damageTaken: 0 }), false);
    assert.equal(ACHIEVEMENTS.iron_wall.check({}, { won: true, damageTaken: 4 }), false);
    assert.equal(ACHIEVEMENTS.iron_wall.check({}, { won: false, damageTaken: 2 }), false);
    assert.equal(ACHIEVEMENTS.iron_wall.check({}, { won: true, damageTaken: 3 }), true);
    assert.equal(ACHIEVEMENTS.iron_wall.check({}, { won: true, damageTaken: 1 }), true);
});

test('computeAchievementProgress reports current/target/pct and clamps over-target values', () => {
    const under = computeAchievementProgress(ACHIEVEMENTS.century_club, { gamesPlayed: 40 });
    assert.deepEqual(under, { current: 40, target: 100, pct: 40 });
    const over = computeAchievementProgress(ACHIEVEMENTS.rich, { currency: 9000 });
    assert.equal(over.current, 5000);
    assert.equal(over.target, 5000);
    assert.equal(over.pct, 100);
});

test('computeAchievementProgress returns null for achievements without a progress() function', () => {
    assert.equal(computeAchievementProgress(ACHIEVEMENTS.dominant_win, {}), null);
});

test('computeAchievementProgress returns null when progress() yields a non-finite or zero target', () => {
    const badAch = { progress: () => ({ current: 1, target: 0 }) };
    assert.equal(computeAchievementProgress(badAch, {}), null);
    const throwingAch = { progress: () => { throw new Error('boom'); } };
    assert.equal(computeAchievementProgress(throwingAch, {}), null);
});

test('checkAchievements unlocks century_club at exactly 100 games and grants its reward once', () => {
    const store = makeStore({ stats: { gamesPlayed: 100, totalWins: 0, totalDeflects: 0, totalHits: 0, bestRally: 0, totalSpent: 0, winStreak: 0, rankedElo: 1000, rankedGames: 0 } });
    const unlocked = checkAchievements(store, {});
    const ids = unlocked.map(a => a.id);
    assert.ok(ids.includes('century_club'));
    const grantedTotal = unlocked.reduce((sum, a) => sum + a.reward, 0);
    assert.equal(store._data.currency, grantedTotal);
    assert.ok(store._data.unlockedAchievements.includes('century_club'));

    // Second call with the same store state must not re-unlock or re-grant.
    const currencyAfterFirst = store._data.currency;
    const unlockedAgain = checkAchievements(store, {});
    assert.equal(unlockedAgain.map(a => a.id).includes('century_club'), false);
    assert.equal(store._data.currency, currencyAfterFirst);
});

test('checkAchievements unlocks rich, streak_master, and case_curious together from derived store state', () => {
    const store = makeStore({ currency: 5000, dailyRewards: { loginStreak: 7 }, casePity: { kickoff: 1, chroma: 0, arsenal: 2 } });
    const unlocked = checkAchievements(store, {}).map(a => a.id);
    assert.ok(unlocked.includes('rich'));
    assert.ok(unlocked.includes('streak_master'));
    assert.ok(unlocked.includes('case_curious'));
});

test('checkAchievements unlocks dominant_win and iron_wall purely from match ctx, independent of store stats', () => {
    const store = makeStore();
    const unlocked = checkAchievements(store, { won: true, criticalHit: true, spikes: 4, damageTaken: 2 }).map(a => a.id);
    assert.ok(unlocked.includes('dominant_win'));
    // damageTaken=2 falls in iron_wall's 1-3 band too, both should fire in the same match.
    assert.ok(unlocked.includes('iron_wall'));
});

test('existing achievements still function unmodified (regression: first_blood, comeback)', () => {
    assert.equal(ACHIEVEMENTS.first_blood.check({ totalHits: 1 }), true);
    assert.equal(ACHIEVEMENTS.comeback.check({}, { won: true, finalHp: 5 }), true);
    assert.equal(ACHIEVEMENTS.comeback.check({}, { won: true, finalHp: 20 }), false);
});
