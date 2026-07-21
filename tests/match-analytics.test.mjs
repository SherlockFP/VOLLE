import test from 'node:test';
import assert from 'node:assert/strict';

import {
    MatchAnalytics,
    buildHeatmap,
    downsampleTrajectory,
    sanitizeId,
    sanitizeName
} from '../js/match-analytics.js';

test('timeline is chronological, typed, and bounded', () => {
    let now = 100;
    const analytics = new MatchAnalytics({ now: () => now, maxEvents: 3 });
    analytics.recordRound({ round: 1, winner: 'red' });
    now += 5;
    analytics.recordDeflect({ player: { id: 'a', name: 'Ada', team: 'red' }, tier: 'perfect' });
    analytics.recordHit({ attacker: { id: 'a', team: 'red' }, damage: 12 });
    analytics.recordKO({ attacker: { id: 'a', team: 'red' }, victim: { id: 'b', team: 'blue' } });
    assert.deepEqual(analytics.getTimeline().map(event => event.type), ['deflect', 'hit', 'ko']);
    assert.deepEqual(analytics.getTimeline().map(event => event.t), [5, 5, 5]);
});

test('round, deflect tiers, hits, KOs, and clutches aggregate by player and team', () => {
    const analytics = new MatchAnalytics({ now: () => 0 });
    const ada = { id: 'ada', name: 'Ada', team: 'red' };
    const bob = { id: 'bob', name: 'Bob', team: 'blue' };
    analytics.recordRound({ round: 1, winner: 'red', players: [ada, bob] });
    analytics.recordDeflect({ player: ada, tier: 'perfect' });
    analytics.recordDeflect({ player: ada, tier: 'good' });
    analytics.recordHit({ attacker: ada, victim: bob, damage: 25 });
    analytics.recordKO({ attacker: ada, victim: bob });
    analytics.recordClutch({ player: ada, won: true, opponents: 2 });

    const player = analytics.getPlayerStats().find(value => value.id === 'ada');
    assert.deepEqual({
        rounds: player.rounds,
        roundWins: player.roundWins,
        deflects: player.deflects,
        tiers: player.deflectTiers,
        hits: player.hits,
        damage: player.damage,
        kos: player.kos,
        clutches: player.clutches,
        clutchWins: player.clutchWins
    }, {
        rounds: 1,
        roundWins: 1,
        deflects: 2,
        tiers: { perfect: 1, good: 1 },
        hits: 1,
        damage: 25,
        kos: 1,
        clutches: 1,
        clutchWins: 1
    });
    assert.equal(analytics.getPlayerStats().find(value => value.id === 'bob').deaths, 1);
    const red = analytics.getTeamStats().find(value => value.team === 'red');
    assert.equal(red.roundWins, 1);
    assert.equal(red.damage, 25);
    assert.equal(red.kos, 1);
});

test('MVP selection is deterministic for equal performances', () => {
    const analytics = new MatchAnalytics({ now: () => 0 });
    analytics.recordKO({ attacker: { id: 'z-player', team: 'red' } });
    analytics.recordKO({ attacker: { id: 'a-player', team: 'blue' } });
    assert.equal(analytics.getMVP().id, 'a-player');
    assert.equal(analytics.getMVP().mvpScore, 100);
});

test('trajectory keeps a capped deterministic sample including endpoints', () => {
    const source = Array.from({ length: 21 }, (_, index) => ({
        t: index,
        x: index,
        y: index / 2,
        z: -index
    }));
    const reduced = downsampleTrajectory(source, 5);
    assert.equal(reduced.length, 5);
    assert.deepEqual(reduced[0], source[0]);
    assert.deepEqual(reduced.at(-1), source.at(-1));

    const analytics = new MatchAnalytics({ now: () => 0, maxTrajectorySamples: 5 });
    source.forEach(sample => analytics.recordTrajectory(sample));
    assert.equal(analytics.getTrajectory().length, 5);
    assert.deepEqual(analytics.getTrajectory().at(-1), source.at(-1));
});

test('heatmap bins x/z samples with bounded edges', () => {
    const heatmap = buildHeatmap([
        { x: 0, z: 0 },
        { x: 5, z: 5 },
        { x: 10, z: 10 },
        { x: 99, z: 99 }
    ], {
        columns: 2,
        rows: 2,
        bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }
    });
    assert.deepEqual(heatmap.cells, [[1, 0], [0, 2]]);
    assert.equal(heatmap.total, 3);
    assert.equal(heatmap.max, 2);
});

test('report is serializable, sanitized, finite, and reset clears all state', () => {
    const analytics = new MatchAnalytics({ now: () => Number.NaN });
    analytics.recordHit({
        attacker: { id: '__proto__ <bad>', name: '<Ada>\u0000', team: 'RED' },
        damage: Number.POSITIVE_INFINITY
    });
    analytics.recordTrajectory({ x: Number.NaN, y: Number.NEGATIVE_INFINITY, z: 2 });
    analytics.recordEvent('custom', {
        value: Number.NaN,
        nested: { bad: Number.POSITIVE_INFINITY },
        ['__proto__']: Number.POSITIVE_INFINITY
    });
    analytics.recordDeflect({
        player: { id: 'safe', team: 'red' },
        tier: '__proto__'
    });

    const report = analytics.getReport({ columns: 2, rows: 2 });
    const json = JSON.stringify(report);
    assert.equal(json.includes('Infinity'), false);
    assert.equal(json.includes('NaN'), false);
    assert.deepEqual(report.timeline.at(-2).data, {
        value: 0,
        nested: { bad: 0 },
        ___proto__: 0
    });
    const attacker = report.players.find(player => player.name === 'Ada');
    assert.equal(attacker.damage, 0);
    assert.deepEqual(report.players.find(player => player.id === 'safe').deflectTiers, {
        ___proto__: 1
    });
    assert.deepEqual(report.trajectory[0], { t: 0, x: 0, y: 0, z: 2 });
    assert.equal(attacker.name, 'Ada');
    assert.equal(sanitizeId(' x <script> '), 'x-script');
    assert.equal(sanitizeName('<Sher>\u0007'), 'Sher');

    assert.equal(analytics.reset(), analytics);
    assert.equal(analytics.getTimeline().length, 0);
    assert.equal(analytics.getPlayerStats().length, 0);
    assert.equal(analytics.getTrajectory().length, 0);
    assert.equal(analytics.getMVP(), null);
});
