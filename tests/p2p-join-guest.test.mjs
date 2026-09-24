// Guests and unlisted rooms can play together over P2P; a registry hiccup or a
// POS_Q packet without its playerId must not break the join or the roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Network } from '../js/network.js';

const TOKEN = 'T'.repeat(43);

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

test('an unlisted host (welcome without token) settles the admission wait at once', async () => {
    const network = clientNetwork();
    const waiting = network.waitForLobbyAdmissionProof(10000);
    network._settleLobbyAdmissionUnlisted();
    const started = Date.now();
    assert.equal(await waiting, '');
    assert.ok(Date.now() - started < 1000);
    assert.equal(await network.waitForLobbyAdmissionProof(10000), '', 'later waits resolve immediately too');
});

test('a proof that arrives after an unlisted join is handed to the app', () => {
    const network = clientNetwork();
    network._settleLobbyAdmissionUnlisted();
    const late = [];
    network.onLobbyAdmissionProof = token => late.push(token);
    assert.equal(network._acceptLobbyAdmissionProof(TOKEN), true);
    assert.deepEqual(late, [TOKEN]);
    network._acceptLobbyAdmissionProof(TOKEN);
    assert.deepEqual(late, [TOKEN], 'same proof is not re-announced');
});

test('a proof that a waiter receives is not also re-announced', async () => {
    const network = clientNetwork();
    const late = [];
    network.onLobbyAdmissionProof = token => late.push(token);
    const waiting = network.waitForLobbyAdmissionProof(10000);
    network._acceptLobbyAdmissionProof(TOKEN);
    assert.equal(await waiting, TOKEN);
    assert.deepEqual(late, []);
});

test('reset clears the unlisted flag and any late-proof hook', async () => {
    const network = clientNetwork();
    network._settleLobbyAdmissionUnlisted();
    network.onLobbyAdmissionProof = () => {};
    network._resetLobbyAdmissionProof();
    assert.equal(network.onLobbyAdmissionProof, null);
    const waiting = network.waitForLobbyAdmissionProof(250);
    network._acceptLobbyAdmissionProof(TOKEN);
    assert.equal(await waiting, TOKEN);
});

const networkSource = readFileSync(new URL('../js/network.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('welcome without a token marks the room unlisted', () => {
    assert.match(networkSource, /if \(!this\._acceptLobbyAdmissionProof\(data\.admissionToken\)\) this\._settleLobbyAdmissionUnlisted\(\);/);
});

test('team requests from remotes are matched by playerId, never moving a same-named host', () => {
    assert.match(gameSource, /switchPlayerTeam\(name, team, playerId = null\) \{[\s\S]{0,200}const byId = playerId \? this\.remotePlayers\.get\(playerId\) : null;\s+if \(!byId && name === this\.playerName\)/);
    assert.match(mainSource, /this\.game\.switchPlayerTeam\?\.\(pName, team, playerId\);/);
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
    assert.match(gameSource, /if \(!this\.network\?\.isHost\) p\.team = data\.team \|\| p\.team;/);
    assert.doesNotMatch(gameSource, /\n\s+p\.team = data\.team \|\| p\.team;/);
    assert.match(gameSource, /const overruled = isTeam\(pl\.team\) && pl\.team !== this\.player\.team[\s\S]{0,260}this\.player\.setTeam\(pl\.team\);\s+if \(overruled\) \{\s+this\.player\.respawn\(\);/);
});
