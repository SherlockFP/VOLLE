// tests/solo-sim-loop.test.mjs — regression guard for "the ball just hangs in the air
// and goes to nobody" in solo/bot matches.
//
// Root cause: the game simulation has two mutually exclusive drivers.
//   * js/main.js loop()   — runs game.update() for non-hosts (requestAnimationFrame)
//   * js/main.js _bgTick  — runs game.update() for hosts, but _startBgLoop's interval
//                           bails out early unless network.connected
// The pair leaves a hole: isHost && !connected has NO driver at all, so nothing ticks —
// the ball freezes wherever it spawned, bots never move, the round timer stops.
// Network.hostGame() sets isHost before awaiting initPeer, so one failed "create lobby"
// (offline, blocked WebRTC, broker down) parked the tab in exactly that state and every
// later bot match started dead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Network } from '../js/network.js';

test('a failed hostGame() does not leave the session claiming to be host', async () => {
    const network = new Network({});
    network.initPeer = async () => { throw new Error('peer broker unreachable'); };

    await assert.rejects(() => network.hostGame('Host'), /peer broker unreachable/);

    assert.equal(network.isHost, false, 'isHost must be cleared when the peer never opened');
    assert.equal(network.connected, false);
});

test('a successful hostGame() still marks the session as host', async () => {
    const network = new Network({});
    network.initPeer = async () => {
        network.roomCode = 'room-1';
        network.connected = true;
        return network.roomCode;
    };
    network._reservePlayerIdentity = async () => {};

    assert.equal(await network.hostGame('Host'), 'room-1');
    assert.equal(network.isHost, true);
});

test('the RAF loop simulates whenever the background host loop is not connected', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const anchor = source.indexOf('// Host simulation runs in the 60Hz background loop');
    assert.ok(anchor >= 0, 'expected the RAF-side simulation guard in main.js loop()');
    const idx = source.indexOf('this.game.update(dt);', anchor);
    assert.ok(idx >= 0, 'expected a game.update(dt) call in main.js loop()');
    const guardLine = source.slice(source.lastIndexOf('\n', idx) + 1, idx + 'this.game.update(dt);'.length);

    assert.match(
        guardLine,
        /!this\.network\?\.isHost \|\| !this\.network\?\.connected/,
        'loop() must still tick the sim for an isHost session with no live connection, '
        + 'otherwise nothing drives the game and the ball hangs in mid-air'
    );
});

test('the background loop remains the connected-host driver (the other half of the pair)', async () => {
    const source = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
    const startIdx = source.indexOf('_startBgLoop() {');
    assert.ok(startIdx >= 0, 'expected the _startBgLoop() definition in main.js');
    assert.match(source.slice(startIdx, startIdx + 1600), /if \(!this\.network\?\.connected\) return;/);

    const tickIdx = source.indexOf('_bgTick(dt) {');
    assert.ok(tickIdx >= 0, 'expected the _bgTick(dt) definition in main.js');
    assert.match(source.slice(tickIdx, tickIdx + 1600), /if \(this\.network\?\.isHost\) \{[\s\S]{0,80}?this\.game\.update\(dt\);/);
});
