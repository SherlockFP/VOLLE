// Roster/team integrity when friends play together: a POS_Q packet without its
// playerId, a same-named player or a client-sent team must not change the roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Network } from '../js/network.js';

function clientNetwork(game = {}) {
    const network = new Network({ updateRemotePlayer: () => {}, ...game });
    network.isHost = false;
    network.hostConn = { peer: 'host-peer', open: true, send() {} };
    return network;
}

test('host-relayed position without a known playerId is dropped, not turned into a "P-xxxx" phantom', () => {
    const updates = [];
    const network = clientNetwork({ updateRemotePlayer: (playerId, data, peerId) => updates.push([playerId, peerId]) });
    network._applyPositionPacket({ type: 'position', seq: 40, x: 0, y: 0, z: 0 }, 'host-peer');
    assert.deepEqual(updates, [], 'no id yet: sample dropped');

    network._applyPositionPacket({ type: 'position', seq: 41, x: 0, y: 0, z: 0, playerId: 'host-player' }, 'host-peer');
    network._applyPositionPacket({ type: 'position', seq: 42, x: 0, y: 0, z: 0 }, 'host-peer');
    assert.deepEqual(updates, [['host-player', 'host-peer'], ['host-player', 'host-peer']]);
});

test('the welcome roster resolves the host id before its first id-carrying packet', () => {
    const updates = [];
    const network = clientNetwork({ updateRemotePlayer: playerId => updates.push(playerId) });
    network._updateMigrationRoster([{ playerId: 'host-player', peerId: 'host-peer', name: 'Host', team: 'red' }]);
    network._applyPositionPacket({ type: 'position', seq: 7, x: 0, y: 0, z: 0 }, 'host-peer');
    assert.deepEqual(updates, ['host-player']);
});

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('team requests from remotes are matched by playerId, never moving a same-named host', () => {
    assert.match(gameSource, /switchPlayerTeam\(name, team, playerId = null\) \{[\s\S]{0,200}const byId = playerId \? this\.remotePlayers\.get\(playerId\) : null;\s+if \(!byId && name === this\.playerName\)/);
    assert.equal((mainSource.match(/switchPlayerTeam\?\.\((?:p)?[nN]ame, team, playerId\)/g) || []).length, 3, 'every remote team request passes its playerId');
});

test('join by code uses the profile/guest name instead of a shared "Player" default', () => {
    assert.match(html, /id="join-name-input"[^>]*value=""/);
    assert.match(mainSource, /document\.getElementById\('join-name-input'\)\?\.value\?\.trim\(\)\s+\|\| document\.getElementById\('player-name-input'\)\?\.value\?\.trim\(\) \|\| 'Player'/);
});

test('M menu: opens on the other side; 1 / 2 join in one press; re-clicking the picked side joins', () => {
    assert.match(uiSource, /\|\| \(game\.player\.queuedForNextRound \? current : \(current === 'red' \? 'blue' : 'red'\)\);/);
    assert.match(uiSource, /if \(event\.code === 'Digit1' \|\| event\.code === 'Numpad1'\) pick\('red', true\);/);
    assert.match(uiSource, /if \(event\.code === 'Digit2' \|\| event\.code === 'Numpad2'\) pick\('blue', true\);/);
    assert.match(uiSource, /if \(target === side && confirm && !confirm\.disabled\) confirm\.click\(\);/);
});

test('host never takes a remote team from position packets; guests reconcile an overruled switch', () => {
    // Guests take the packet's team through setTeam (body + name pill recolour).
    assert.match(gameSource, /if \(!this\.network\?\.isHost && data\.team !== p\.team && \(data\.team === 'red' \|\| data\.team === 'blue'\)\) \{\s+if \(typeof p\.setTeam === 'function'\) p\.setTeam\(data\.team\);\s+else p\.team = data\.team;/);
    assert.doesNotMatch(gameSource, /\n\s+p\.team = data\.team \|\| p\.team;/);
    assert.match(gameSource, /const overruled = isTeam\(pl\.team\) && pl\.team !== this\.player\.team[\s\S]{0,260}this\.player\.setTeam\(pl\.team\);\s+if \(overruled\) \{\s+this\.player\.respawn\(\);/);
});
