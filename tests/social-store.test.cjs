const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../server/account-store');
const { ProfileStore } = require('../server/profile-store');
const { SocialStore, INVITE_TTL_MS } = require('../server/social-store');

async function fixture(t) {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-social-'));
    const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
    const accounts = new AccountStore(path.join(dir, 'accounts.db'), profiles, { now: () => now });
    const social = new SocialStore(path.join(dir, 'accounts.db'), { now: () => now });
    t.after(() => { social.close(); accounts.close(); fs.rmSync(dir, { recursive: true, force: true }); });
    const a = await accounts.register('PlayerA', 'hunter22', '');
    const b = await accounts.register('PlayerB', 'hunter22', '');
    return { accounts, social, a: a.account, b: b.account, tick: ms => { now += ms; } };
}

test('friend requests are generic for unknown tags and enforce an ownership state machine', async t => {
    const ctx = await fixture(t);
    assert.deepEqual(ctx.social.createFriendRequest(ctx.a.id, 'Nobody#00000000'), { status: 202, generic: true });
    assert.equal(ctx.social.createFriendRequest(ctx.a.id, ctx.b.friendTag).status, 201);
    const request = ctx.social.listRequests(ctx.b.id)[0];
    assert.equal(ctx.social.actOnFriendRequest(ctx.a.id, request.id, 'accept').status, 403);
    assert.equal(ctx.social.actOnFriendRequest(ctx.b.id, request.id, 'accept').state, 'accepted');
    assert.equal(ctx.social.areFriends(ctx.a.id, ctx.b.id), true);
    assert.equal(ctx.social.createFriendRequest(ctx.a.id, ctx.b.friendTag).state, 'friends');
});

test('direct messages require friendship, paginate by id and retain a bounded conversation', async t => {
    const ctx = await fixture(t);
    assert.equal(ctx.social.sendMessage(ctx.a.id, ctx.b.id, 'blocked').status, 403);
    const request = ctx.social.createFriendRequest(ctx.a.id, ctx.b.friendTag);
    const pending = ctx.social.listRequests(ctx.b.id).find(item => item.status === 'pending');
    assert.equal(request.status, 201);
    ctx.social.actOnFriendRequest(ctx.b.id, pending.id, 'accept');
    for (let i = 0; i < 3; i++) assert.equal(ctx.social.sendMessage(ctx.a.id, ctx.b.id, `hello ${i}`).status, 201);
    const newest = ctx.social.listMessages(ctx.b.id, ctx.a.id, { limit: 2 });
    assert.equal(newest.messages.length, 2);
    assert.ok(newest.nextBeforeId);
    const older = ctx.social.listMessages(ctx.b.id, ctx.a.id, { beforeId: newest.nextBeforeId, limit: 2 });
    assert.equal(older.messages.length, 1);
    assert.equal(ctx.social.sendMessage(ctx.a.id, ctx.b.id, 'x'.repeat(501)).status, 400);
});

test('lobby invites are friend-only, idempotent while pending, and expire safely', async t => {
    const ctx = await fixture(t);
    const request = ctx.social.createFriendRequest(ctx.a.id, ctx.b.friendTag);
    const pending = ctx.social.listRequests(ctx.b.id).find(item => item.id === request.request?.id || item.status === 'pending');
    ctx.social.actOnFriendRequest(ctx.b.id, pending.id, 'accept');
    const first = ctx.social.createLobbyInvite(ctx.a.id, ctx.b.id, 'ROOM1');
    const repeat = ctx.social.createLobbyInvite(ctx.a.id, ctx.b.id, 'ROOM1');
    assert.equal(first.status, 201);
    assert.equal(repeat.replayed, true);
    ctx.tick(INVITE_TTL_MS + 1);
    assert.equal(ctx.social.listInvites(ctx.b.id)[0].status, 'expired');
    const next = ctx.social.createLobbyInvite(ctx.a.id, ctx.b.id, 'ROOM1');
    assert.equal(next.status, 201);
    assert.equal(ctx.social.actOnLobbyInvite(ctx.a.id, next.invite.id, 'accept').status, 403);
    assert.equal(ctx.social.actOnLobbyInvite(ctx.b.id, next.invite.id, 'accept').state, 'accepted');
});
