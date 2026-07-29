const test = require('node:test');
const assert = require('node:assert/strict');
const { PresenceStore } = require('../server/presence-store');

test('heartbeat marks a username online and status reports it', () => {
    const presence = new PresenceStore(45000);
    presence.heartbeat('Player1', 'red');
    const [entry] = presence.status(['Player1']);
    assert.equal(entry.online, true);
    assert.equal(entry.avatar, 'red');
});

test('status reports offline for a username with no heartbeat', () => {
    const presence = new PresenceStore(45000);
    const [entry] = presence.status(['Ghost']);
    assert.equal(entry.online, false);
    assert.equal(entry.avatar, '');
});

test('lookup is case-insensitive', () => {
    const presence = new PresenceStore(45000);
    presence.heartbeat('Player1', '');
    const [entry] = presence.status(['player1']);
    assert.equal(entry.online, true);
});

test('entries older than the ttl are pruned to offline', () => {
    const presence = new PresenceStore(10);
    presence.heartbeat('Player1', '');
    const stale = presence.online.get('player1');
    stale.lastSeen = Date.now() - 1000;
    const [entry] = presence.status(['Player1']);
    assert.equal(entry.online, false);
    assert.equal(presence.online.has('player1'), false);
});
