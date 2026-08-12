const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-party-http-'));
process.env.DATA_DIR = dataDir;
const { server, social, presence } = require('../server.js');

let baseUrl;
async function api(pathname, { token = '', method = 'GET', body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
}

test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('authenticated HTTP discovery, friend status allowlist and party flow converge securely', async () => {
    const register = username => api('/api/account/register', { method: 'POST', body: { username, password: 'hunter22' } });
    const alice = (await register('RouteAlice')).body;
    const bob = (await register('RouteBob')).body;
    const charlie = (await register('RouteCharlie')).body;
    assert.equal((await api('/api/social/available')).status, 401);

    const beat = (token, instanceId, extra = {}) => api('/api/social/heartbeat', { token, method: 'POST', body: { instanceId, state: 'menu', discoverable: true, region: 'eu', ...extra } });
    await beat(alice.sessionToken, 'alice-one', { accountId: bob.account.id, username: 'Spoofed' });
    await beat(alice.sessionToken, 'alice-two');
    await beat(bob.sessionToken, 'bob-one');
    const legacyHeartbeat = await api('/api/social/heartbeat', { token: charlie.sessionToken, method: 'POST', body: { avatar: 'ignored-client-avatar' } });
    assert.equal(legacyHeartbeat.status, 200, 'current client heartbeat remains backward compatible');
    await beat(charlie.sessionToken, 'charlie-one');

    const available = await api('/api/social/available?region=eu', { token: alice.sessionToken });
    assert.equal(available.status, 200);
    assert.deepEqual(available.body.players.map(row => row.accountId).sort(), [bob.account.id, charlie.account.id].sort());
    assert.equal(available.body.players.some(row => row.username === 'Spoofed'), false);

    const blockedStatus = await api('/api/social/status', { token: alice.sessionToken, method: 'POST', body: { usernames: ['RouteBob', 'RouteCharlie'] } });
    assert.deepEqual(blockedStatus.body.statuses, []);
    social.createFriendRequest(alice.account.id, bob.account.friendTag);
    const request = social.listRequests(bob.account.id).find(row => row.status === 'pending');
    social.actOnFriendRequest(bob.account.id, request.id, 'accept');
    const friendStatus = await api('/api/social/status', { token: alice.sessionToken, method: 'POST', body: { usernames: ['RouteBob', 'RouteCharlie'] } });
    assert.deepEqual(friendStatus.body.statuses.map(row => row.username), ['RouteBob']);

    const invited = await api('/api/party/invites', { token: alice.sessionToken, method: 'POST', body: { recipientAccountId: bob.account.id } });
    assert.equal(invited.status, 201);
    const accepted = await api(`/api/party/invites/${encodeURIComponent(invited.body.invite.id)}`, { token: bob.sessionToken, method: 'POST', body: { action: 'accept' } });
    assert.equal(accepted.status, 200);
    const [aliceParty, bobParty] = await Promise.all([api('/api/party', { token: alice.sessionToken }), api('/api/party', { token: bob.sessionToken })]);
    assert.deepEqual(aliceParty.body.party, bobParty.body.party);

    const logout = await api('/api/account/logout', { token: alice.sessionToken, method: 'POST', body: { instanceId: 'alice-one' } });
    assert.equal(logout.body.ok, true);
    assert.equal(presence.getAccount(alice.account.id), null, 'revoking a shared account session removes all ghost tab presence');
});
