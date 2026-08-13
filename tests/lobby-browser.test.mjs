import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLobbies, lobbyOpenSlots, pickQuickLobby } from '../js/lobby-browser.js';

const lobbies = [
    { code: 'a', mode: 'Classic', map: 'Beach', players: 3, maxPlayers: 8, ranked: false, updatedAt: 1 },
    { code: 'b', mode: 'Free For All', map: 'Volcano', players: 7, maxPlayers: 8, ranked: false, updatedAt: 2 },
    { code: 'c', mode: 'Competitive', map: 'Beach', players: 8, maxPlayers: 8, ranked: true, updatedAt: 3 }
];

test('lobby browser filters mode, map, queue and full rooms', () => {
    assert.deepEqual(filterLobbies(lobbies, { mode: 'Free For All', map: 'vol', queue: 'casual', openOnly: true }).map(l => l.code), ['b']);
    assert.deepEqual(filterLobbies(lobbies, { queue: 'ranked', openOnly: true }), []);
});

test('quick play chooses the most populated available matching room', () => {
    assert.equal(pickQuickLobby(lobbies, { queue: 'casual' }).code, 'b');
});

test('party quick play only considers rooms with every squad slot available', () => {
    assert.equal(lobbyOpenSlots(lobbies[0]), 5);
    assert.deepEqual(filterLobbies(lobbies, { queue: 'casual', minOpenSlots: 6 }).map(lobby => lobby.code), []);
    assert.equal(pickQuickLobby(lobbies, { queue: 'casual', minOpenSlots: 5 }).code, 'a');
});
