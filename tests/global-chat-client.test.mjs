// Global chat client + menu wiring: polling merges new messages, posts carry the
// lobby identity, invites render as Join / Copy cards, sharing is host-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { GlobalChatClient, GLOBAL_CHAT_KEEP } from '../js/global-chat.js';
import { readAppSource } from './app-source.mjs';

function fakeFetch(routes) {
    const calls = [];
    const fn = async (url, init = {}) => {
        calls.push({ url, init });
        const handler = routes[`${init.method || 'GET'} ${url.split('?')[0]}`];
        const { status = 200, body = {} } = handler ? handler(url, init) : { status: 404 };
        return { ok: status >= 200 && status < 300, status, json: async () => body };
    };
    fn.calls = calls;
    return fn;
}

test('polling asks for messages after the latest id and merges only new ones', async () => {
    const updates = [];
    const fetchImpl = fakeFetch({
        'GET /api/chat/global': url => ({ body: { messages: url.endsWith('after=0') ? [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] : [{ id: 2, text: 'b' }, { id: 3, text: 'c' }] } })
    });
    const client = new GlobalChatClient({ fetchImpl, onUpdate: (all, fresh) => updates.push(fresh.map(m => m.id)) });
    await client.poll();
    await client.poll();
    assert.deepEqual(fetchImpl.calls.map(c => c.url), ['/api/chat/global?after=0', '/api/chat/global?after=2']);
    assert.deepEqual(updates, [[1, 2], [3]]);
    assert.deepEqual(client.messages.map(m => m.id), [1, 2, 3]);
    client.ingest(Array.from({ length: GLOBAL_CHAT_KEEP + 20 }, (_, i) => ({ id: 10 + i })));
    assert.equal(client.messages.length, GLOBAL_CHAT_KEEP);
});

test('an unreachable server flips availability once', async () => {
    let updates = 0;
    const client = new GlobalChatClient({ fetchImpl: async () => { throw new Error('down'); }, onUpdate: () => { updates++; } });
    await client.poll();
    await client.poll();
    assert.equal(client.available, false);
    assert.equal(updates, 1);
});

test('send and share post with the bearer identity and surface server codes', async () => {
    const fetchImpl = fakeFetch({
        'POST /api/chat/global': (url, init) => {
            const body = JSON.parse(init.body);
            if (body.inviteCode === 'NOPE') return { status: 403, body: { code: 'not_host' } };
            return { body: { message: { id: 9, ...(body.text ? { kind: 'text', text: body.text } : { kind: 'invite', invite: { code: body.inviteCode } }) } } };
        }
    });
    const client = new GlobalChatClient({ fetchImpl, getToken: async () => 'tok' });
    assert.deepEqual(await client.send('   '), { ok: false, code: 'empty' });
    const sent = await client.send(' hello ');
    assert.equal(sent.ok, true);
    assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { text: 'hello' });
    assert.deepEqual(await client.shareLobby('NOPE'), { ok: false, code: 'not_host' });
    const noIdentity = new GlobalChatClient({ fetchImpl, getToken: async () => '' });
    assert.deepEqual(await noIdentity.send('hi'), { ok: false, code: 'sign_in_required' });
});

test('menu wiring: global tab, host-only share, password lobbies go through Join by Code', () => {
    const main = readAppSource();
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /data-fbar-tab="global"/);
    assert.match(html, /id="fbar-global" class="fbar-global" role="tabpanel"/);
    assert.match(html, /id="btn-lobby-share-global"/);
    assert.match(main, /\['friends', 'online', 'nearby', 'global'\]\.includes\(tab\)/);
    assert.match(main, /if \(screen === 'mainMenu'\) this\.globalChat\.start\(\);\s+else this\.globalChat\.stop\(\);/);
    assert.match(main, /if \(!code \|\| !this\.network\?\.isHost\) \{\s+this\.ui\.showMessage\?\.\(t\('toast\.gchatHostOnly'\)/);
    assert.match(main, /if \(invite\.locked \|\| invite\.ranked\) \{[\s\S]{0,200}this\.ui\.showScreen\('joinMenu'\);/);
    assert.match(main, /author\.textContent = this\._chatClean\(String\(message\.author/);
    assert.match(main, /document\.createTextNode\(` \$\{this\._chatClean\(String\(message\.text/);
    assert.doesNotMatch(main.slice(main.indexOf('    _renderGlobalChat() {'), main.indexOf('    async _copyLobbyCode(')), /innerHTML/);
});
