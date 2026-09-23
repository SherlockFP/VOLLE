// Lobby registry: spectators do not take a player slot, have their own cap, and the
// public lobby list shows only a bounded spectator count (no identities).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-spectator-lobby-'));
process.env.DATA_DIR = dataDir;
const { server, lobbies } = require('../server.js');

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

test('spectators join a full lobby without a player slot and stay private', async () => {
    const register = username => api('/api/account/register', { method: 'POST', body: { username, email: `${username.toLowerCase()}@example.com`, password: 'hunter22' } });
    const host = (await register('SpecHost')).body;
    const player = (await register('SpecPlayer')).body;
    const fan = (await register('SpecFan')).body;

    const hosted = await api('/api/lobbies', { token: host.sessionToken, method: 'POST', body: { code: 'spec-room', name: 'Spec', players: 1, spectators: 999 } });
    assert.equal(hosted.status, 200);
    const admissionToken = hosted.body.admissionToken;
    lobbies.get('spec-room').maxPlayers = 1; // host alone fills it

    const full = await api('/api/lobbies/spec-room/join', { token: player.sessionToken, method: 'POST', body: { admissionToken } });
    assert.equal(full.status, 409, 'player slots are full');

    const watching = await api('/api/lobbies/spec-room/join', { token: fan.sessionToken, method: 'POST', body: { admissionToken, spectator: true } });
    assert.equal(watching.status, 200, 'a full lobby can still be watched');
    const record = lobbies.get('spec-room');
    assert.equal(record.memberProfileIds.has(fan.profile.id), false, 'spectators are not match members');
    assert.equal(record.spectatorProfileIds.has(fan.profile.id), true);

    const bad = await api('/api/lobbies/spec-room/join', { token: fan.sessionToken, method: 'POST', body: { admissionToken: 'x'.repeat(admissionToken.length), spectator: true } });
    assert.equal(bad.status, 403, 'spectators still need the host admission proof');

    const listed = (await api('/api/lobbies')).body.find(lobby => lobby.code === 'spec-room');
    assert.equal(listed.spectators, 16, 'host-reported count is clamped');
    assert.equal('spectatorProfileIds' in listed, false);
    assert.equal('memberProfileIds' in listed, false);

    const left = await api('/api/lobbies/spec-room/leave', { token: fan.sessionToken, method: 'POST', body: {} });
    assert.equal(left.status, 200);
    assert.equal(lobbies.get('spec-room').spectatorProfileIds.has(fan.profile.id), false);
});
