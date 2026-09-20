import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard, normalizeLeaderboardPlayers } from '../js/leaderboard.js';
import { Store } from '../js/store.js';

test('malformed cached ladders recover without crashing initialization', () => {
    for (const value of [null, {}, 3, 'not a list']) assert.equal(normalizeLeaderboardPlayers(value), null);
    const valid = { name: 'Example', elo: 1200, fake: true, weeklyElo: 0 };
    const normalized = normalizeLeaderboardPlayers([null, {}, valid, { name: 'Bad', elo: Infinity }, { name: 'Bad', elo: -1 }]);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].weeklyElo, 0);
    assert.equal(normalized[0].fake, true);
    assert.equal(normalizeLeaderboardPlayers(Array(400).fill(valid)).length, 200);
});

test('position uses the current class/friend/sample filter, not the global roster', t => {
    const players = Leaderboard.players;
    const getElo = Store.getElo;
    t.after(() => { Leaderboard.players = players; Store.getElo = getElo; });
    Store.getElo = () => 1000;
    Leaderboard.players = [
        { name: 'ScoutBot', elo: 1500, weeklyElo: 800, classId: 'scout', fake: true },
        { name: 'TankBot', elo: 2000, weeklyElo: 1700, classId: 'tank', fake: true }
    ];
    assert.equal(Leaderboard.getPlayerRank(1000), 3);
    assert.equal(Leaderboard.getPlayerRank(1000, 'class', { classId: 'scout' }), 2);
    assert.equal(Leaderboard.getPlayerRank(1000, 'friends', { friends: [] }), 1);
    assert.equal(Leaderboard.getPlayerRank(1000, 'weekly'), 2);
    assert.equal(Leaderboard.getFiltered().filter(player => player.isYou).length, 1);
});
