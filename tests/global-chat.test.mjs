// Main-menu global chat: server ring buffer, per-identity limits, host-only lobby
// invites, and the /api/chat/global routes (read open, post with account or guest).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GlobalChat } = require('../server/global-chat.js');

function clock(start = 1_000_000) {
    let now = start;
    return { now: () => now, advance: ms => { now += ms; } };
}

test('messages are cleaned, capped, paged and numbered', () => {
    const c = clock();
    const chat = new GlobalChat({ now: c.now, capacity: 3, minIntervalMs: 0 });
    const ada = { id: 'a', name: 'Ada' };
    assert.equal(chat.post(ada, { text: '   ' }).status, 400);
    const first = chat.post(ada, { text: '  hello\u0000\n  world  ' });
    assert.equal(first.status, 200);
    assert.equal(first.message.text, 'hello world');
    assert.equal(chat.post(ada, { text: 'x'.repeat(500) }).message.text.length, 200);
    for (const text of ['one', 'two', 'three']) { c.advance(20000); chat.post(ada, { text }); }
    assert.deepEqual(chat.since().messages.map(m => m.text), ['one', 'two', 'three'], 'ring keeps the newest');
    const latest = chat.since().latestId;
    c.advance(20000);
    chat.post(ada, { text: 'four' });
    assert.deepEqual(chat.since(latest).messages.map(m => m.text), ['four']);
});

test('per-identity pacing, burst cap and duplicate guard', () => {
    const c = clock();
    const chat = new GlobalChat({ now: c.now });
    const bo = { id: 'b', name: 'Bo' };
    assert.equal(chat.post(bo, { text: 'hi' }).status, 200);
    assert.equal(chat.post(bo, { text: 'again' }).code, 'rate_limited', 'within 1.5 s');
    c.advance(1600);
    assert.equal(chat.post(bo, { text: 'HI' }).code, 'duplicate');
    for (let i = 0; i < 4; i++) { c.advance(1600); assert.equal(chat.post(bo, { text: `m${i}` }).status, 200); }
    c.advance(1600);
    assert.equal(chat.post(bo, { text: 'sixth' }).code, 'rate_limited', 'five per 20 s');
    assert.equal(chat.post({ id: 'c', name: 'Cy' }, { text: 'sixth' }).status, 200, 'limits are per identity');
    assert.equal(chat.post(null, { text: 'x' }).status, 401);
});

test('only the host can share a lobby, once per 30 s', () => {
    const c = clock();
    const chat = new GlobalChat({ now: c.now });
    const lobby = { code: 'ROOM1', name: 'Fun room', mode: 'Classic', map: 'Beach', players: 2, maxPlayers: 8, locked: false, ownerAccountId: 'host' };
    assert.equal(chat.postInvite({ id: 'other', name: 'X' }, lobby).code, 'not_host');
    assert.equal(chat.postInvite({ id: 'host', name: 'H' }, null).code, 'lobby_unavailable');
    const shared = chat.postInvite({ id: 'host', name: 'H' }, lobby);
    assert.equal(shared.status, 200);
    assert.deepEqual(shared.message.invite, { code: 'ROOM1', name: 'Fun room', mode: 'Classic', map: 'Beach', players: 2, maxPlayers: 8, locked: false, ranked: false });
    assert.equal(shared.message.invite.ownerAccountId, undefined, 'no private lobby fields');
    c.advance(5000);
    assert.equal(chat.postInvite({ id: 'host', name: 'H' }, lobby).code, 'invite_cooldown');
});

// ---------------------------------------------------------------- HTTP routes
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-global-chat-'));
process.env.DATA_DIR = dataDir;
const { server, lobbies, normalizeLobbyRecord, lobbyRelay } = require('../server.js');
let baseUrl;

async function api(pathname, { token = '', method = 'GET', body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    lobbyRelay?.close?.();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('routes: anyone reads, guests and accounts post, invites are host-only', async () => {
    assert.equal((await api('/api/chat/global')).status, 200);
    assert.equal((await api('/api/chat/global', { method: 'POST', body: { text: 'anon' } })).status, 401);

    const guest = (await api('/api/lobbies/guest-session', { method: 'POST', body: { name: 'Guest4321' } })).body;
    const posted = await api('/api/chat/global', { method: 'POST', token: guest.guestToken, body: { text: 'hello arena' } });
    assert.equal(posted.status, 200);
    assert.equal(posted.body.message.author, 'Guest4321');
    assert.equal(posted.body.message.guest, true);

    const host = (await api('/api/account/register', { method: 'POST', body: { username: 'ChatHost', email: 'chathost@example.com', password: 'hunter22x' } })).body;
    const hostId = (await api('/api/account/me', { token: host.sessionToken })).body.account?.id;
    lobbies.set('CHATROOM', normalizeLobbyRecord({
        code: 'CHATROOM', name: 'Chat room', hostName: 'ChatHost', ownerAccountId: hostId,
        memberProfileIds: new Set(), guestMemberIds: new Set(), admissionToken: 'x'.repeat(43),
        players: 1, map: 'Beach', mode: 'Classic', maxPlayers: 8
    }, Date.now()));
    assert.equal((await api('/api/chat/global', { method: 'POST', token: guest.guestToken, body: { inviteCode: 'CHATROOM' } })).status, 403);
    const invite = await api('/api/chat/global', { method: 'POST', token: host.sessionToken, body: { inviteCode: 'CHATROOM' } });
    assert.equal(invite.status, 200);
    assert.equal(invite.body.message.invite.code, 'CHATROOM');
    assert.equal(invite.body.message.invite.admissionToken, undefined);

    const feed = await api(`/api/chat/global?after=${posted.body.message.id}`);
    assert.deepEqual(feed.body.messages.map(m => m.kind), ['invite']);
});
