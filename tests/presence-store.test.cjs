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

test('authenticated presence aggregates tabs and never trusts client identity fields', () => {
    let now = 1000;
    const presence = new PresenceStore(100, { now: () => now });
    const identity = { accountId: 'account-a', profileId: 'profile-a', username: 'RealName', avatar: 'server-avatar' };
    assert.equal(presence.heartbeatAccount(identity, { instanceId: 'tab-one', state: 'menu', discoverable: true, region: 'EU', username: 'Spoofed' }).status, 200);
    presence.heartbeatAccount(identity, { instanceId: 'tab-two', state: 'social', discoverable: false, region: 'invalid region!' });
    const account = presence.getAccount('account-a');
    assert.equal(account.username, 'RealName');
    assert.equal(account.avatar, 'server-avatar');
    assert.equal(account.instances.size, 2);
    assert.equal(account.instances.get('tab-two').region, '');
    assert.equal(presence.removeInstance('account-a', 'tab-one'), true);
    assert.ok(presence.getAccount('account-a'), 'second live tab keeps the account online');
    now += 101;
    assert.equal(presence.getAccount('account-a'), null);
});

test('available discovery excludes self, private/match/authority-active profiles and caps output', () => {
    let now = 5000;
    const presence = new PresenceStore(1000, { now: () => now });
    const beat = (n, state = 'menu', discoverable = true, region = 'eu') => presence.heartbeatAccount(
        { accountId: `a${n}`, profileId: `p${n}`, username: `Player${String(n).padStart(2, '0')}`, avatar: `av${n}` },
        { instanceId: `tab-${n}`, state, discoverable, region }
    );
    beat(0); beat(1, 'match'); beat(2, 'menu', false); beat(3);
    for (let n = 4; n < 30; n++) { now += 1; beat(n, 'lobby', true, n % 2 ? 'na' : 'eu'); }
    const rows = presence.available({ requesterAccountId: 'a0', requesterRegion: 'eu', isProfileActive: id => id === 'p3', limit: 99 });
    assert.equal(rows.length, 20);
    assert.equal(rows.some(row => ['a0', 'a1', 'a2', 'a3'].includes(row.accountId)), false);
    assert.ok(rows.every(row => Object.keys(row).sort().join(',') === 'accountId,avatar,region,sameRegion,state,username'));
    assert.equal(rows[0].sameRegion, true);
});
