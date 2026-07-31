// post-match-rewards.test.mjs — pure logic behind the post-match reward flow:
// buildRewardSummary()/rewardStepDelays() in js/match-analytics.js (what the
// screen is allowed to claim the player earned) and js/daily.js's per-match
// progress deltas (which dailies the screen may tick). DOM/animation is not
// covered here on purpose — these are the numbers, not the presentation.
import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { buildRewardSummary, rewardStepDelays } = await import('../js/match-analytics.js');
const { Daily } = await import('../js/daily.js');

test('reward summary keeps only the sources that actually paid', () => {
    const summary = buildRewardSummary({
        xp: 520,
        xpSources: [
            { label: 'Victory bonus', value: 400 },
            { label: 'Eliminations x4', value: 120 },
            { label: 'Survival bonus', value: 0 }
        ],
        coins: { base: 120, bonus: 35, firstOfDay: 0, total: 155 }
    });
    assert.equal(summary.xpTotal, 520);
    assert.deepEqual(summary.xpRows.map(row => row.label), ['Victory bonus', 'Eliminations x4']);
    assert.deepEqual(summary.coinRows, [
        { label: 'Match reward', value: 120 },
        { label: 'Performance bonus', value: 35 }
    ]);
    assert.equal(summary.coinTotal, 155);
    assert.equal(summary.rowCount, 4);
});

test('reward summary surfaces the first-match-of-day bonus when it was paid', () => {
    const summary = buildRewardSummary({ coins: { base: 40, bonus: 0, firstOfDay: 75, total: 115 } });
    assert.deepEqual(summary.coinRows, [
        { label: 'Match reward', value: 40 },
        { label: 'First match of day', value: 75 }
    ]);
    assert.equal(summary.coinTotal, 115);
});

test('reward summary shows no rows and no totals for a match that paid nothing', () => {
    const summary = buildRewardSummary();
    assert.deepEqual(summary, {
        xpTotal: 0, xpRows: [], coinTotal: 0, coinRows: [], dailyRows: [], rowCount: 0
    });
});

test('reward summary degrades hostile numbers instead of rendering NaN', () => {
    const summary = buildRewardSummary({
        xp: 'lots',
        xpSources: [{ label: 'Victory bonus', value: Number.NaN }, { label: '', value: 50 }],
        coins: { base: -20, bonus: undefined, firstOfDay: 'x', total: Number.POSITIVE_INFINITY },
        dailies: 'nope'
    });
    assert.equal(summary.xpTotal, 0);
    assert.deepEqual(summary.xpRows, []);
    assert.deepEqual(summary.coinRows, []);
    assert.equal(summary.coinTotal, 0);
    assert.deepEqual(summary.dailyRows, []);
});

test('daily rows only include challenges that moved, clamped to their target', () => {
    const summary = buildRewardSummary({
        dailies: [
            { name: 'Win 3 Matches', from: 0, to: 1, target: 3 },
            { name: '50 Deflects', from: 44, to: 61, target: 50 },
            { name: 'Play 5 Matches', from: 2, to: 2, target: 5 }
        ]
    });
    assert.deepEqual(summary.dailyRows, [
        { name: 'Win 3 Matches', from: 0, to: 1, target: 3, completed: false },
        { name: '50 Deflects', from: 44, to: 50, target: 50, completed: true }
    ]);
    assert.equal(summary.rowCount, 2);
});

test('daily challenge names are sanitized before the screen renders them', () => {
    const [row] = buildRewardSummary({
        dailies: [{ name: '<img src=x onerror=alert(1)>', from: 0, to: 1, target: 2 }]
    }).dailyRows;
    assert.ok(!row.name.includes('<'));
    assert.ok(!row.name.includes('>'));
});

test('step delays stagger the reveal, cap out, and go flat under reduced motion', () => {
    assert.deepEqual(rewardStepDelays(4, { stepMs: 90 }), [0, 90, 180, 270]);
    assert.deepEqual(rewardStepDelays(3, { stepMs: 400, maxMs: 500 }), [0, 400, 500]);
    assert.deepEqual(rewardStepDelays(4, { reducedMotion: true }), [0, 0, 0, 0]);
    assert.deepEqual(rewardStepDelays(0), []);
    assert.deepEqual(rewardStepDelays(-3), []);
});

test('Daily records only the challenges a match advanced, and hands them over once', () => {
    memory.clear();
    Daily._reset();
    const before = Daily.getChallenges().map(c => ({ id: c.id, type: c.type, progress: c.progress }));
    Daily.progress({ won: true, deflects: 6, bestRally: 4, spikes: 1, damage: 220, winStreak: 1, cleanWin: false });
    const deltas = Daily.takeLastMatchProgress();

    assert.ok(deltas.length > 0, 'a won match must move at least one challenge');
    for (const delta of deltas) {
        const start = before.find(c => c.id === delta.id);
        assert.ok(start, 'delta must refer to a live challenge');
        assert.equal(delta.from, start.progress);
        assert.ok(delta.to > delta.from);
        assert.ok(delta.to <= delta.target);
    }
    // Consumed on read: replaying the screen must not re-show last match's ticks.
    assert.deepEqual(Daily.takeLastMatchProgress(), []);
});

test('Daily reports nothing for a match that advanced no challenge', () => {
    memory.clear();
    Daily._reset();
    Daily.data.challenges.forEach(c => { c.claimed = true; });
    Daily._save();
    Daily.progress({ won: true, deflects: 10, bestRally: 9, spikes: 3, damage: 900, winStreak: 3, cleanWin: true });
    assert.deepEqual(Daily.takeLastMatchProgress(), []);
});
