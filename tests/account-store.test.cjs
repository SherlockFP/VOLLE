const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    AccountStore,
    MAX_ACTIVE_SESSIONS,
    MAX_KDF_CONCURRENCY,
    MAX_KDF_QUEUE,
    PASSWORD_MAX_LENGTH,
    SESSION_TTL_MS
} = require('../server/account-store');
const { ProfileStore } = require('../server/profile-store');

function tempAccounts(now = () => Date.now()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-accounts-'));
    const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
    const accounts = new AccountStore(path.join(dir, 'accounts.db'), profiles, { now });
    return { dir, accounts, profiles };
}

function cleanup(t, { dir, accounts }) {
    t.after(() => { accounts.close(); fs.rmSync(dir, { recursive: true, force: true }); });
}

test('register creates a unique public friend tag and a revocable session', async t => {
    const ctx = tempAccounts(); cleanup(t, ctx);
    const result = await ctx.accounts.register('Player1', 'hunter22', 'red');
    assert.equal(result.status, 201);
    assert.match(result.sessionToken, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(result.account.friendTag, /^Player1#[A-F0-9]{8}$/);
    assert.equal(result.profile.playerName, 'Player1');
    assert.equal(ctx.accounts.resolveSession(result.sessionToken).account.id, result.account.id);
    assert.equal(ctx.profiles.authenticate(result.sessionToken), null, 'session bearer is not a legacy profile token');
});

test('migration backfills a stable unique friend code for pre-session accounts', async t => {
    const ctx = tempAccounts();
    const first = await ctx.accounts.register('Player1', 'hunter22', '');
    ctx.accounts.db.exec("UPDATE accounts SET friend_code = '', friend_tag = '' WHERE id = '" + first.account.id + "'");
    ctx.accounts.close();
    const reopened = new AccountStore(path.join(ctx.dir, 'accounts.db'), ctx.profiles);
    ctx.accounts = reopened;
    cleanup(t, ctx);
    const resolved = reopened.getById(first.account.id);
    assert.match(resolved.friendTag, /^Player1#[A-F0-9]{8}$/);
    assert.equal(reopened.getByFriendTag(resolved.friendTag).id, first.account.id);
});

test('registration is case-insensitive, validates password bounds, and never returns a profile token', async t => {
    const ctx = tempAccounts(); cleanup(t, ctx);
    await ctx.accounts.register('Player1', 'hunter22', '');
    assert.equal((await ctx.accounts.register('player1', 'anotherpass', '')).status, 409);
    assert.equal((await ctx.accounts.register('a b', 'longenough1', '')).status, 400);
    assert.equal((await ctx.accounts.register('validname', 'x'.repeat(PASSWORD_MAX_LENGTH + 1), '')).status, 400);
    assert.equal(Object.hasOwn(await ctx.accounts.register('Player2', 'hunter22', ''), 'profileToken'), false);
});

test('login gives a fresh session, expires sessions, and logout revokes only the presented session', async t => {
    let now = 10_000;
    const ctx = tempAccounts(() => now); cleanup(t, ctx);
    const registered = await ctx.accounts.register('Player1', 'hunter22', 'blue');
    const login = await ctx.accounts.login('PLAYER1', 'hunter22');
    assert.equal(login.status, 200);
    assert.notEqual(login.sessionToken, registered.sessionToken);
    assert.equal(ctx.accounts.logout(login.sessionToken, login.account.id), true);
    assert.equal(ctx.accounts.resolveSession(login.sessionToken), null);
    assert.ok(ctx.accounts.resolveSession(registered.sessionToken));
    now += SESSION_TTL_MS + 1;
    assert.equal(ctx.accounts.resolveSession(registered.sessionToken), null);
});

test('invalid username/password response is generic and active sessions are bounded', async t => {
    const ctx = tempAccounts(); cleanup(t, ctx);
    await ctx.accounts.register('Player1', 'hunter22', '');
    assert.deepEqual(await ctx.accounts.login('nobody', 'whatever1'), { status: 401, error: 'invalid credentials' });
    assert.deepEqual(await ctx.accounts.login('Player1', 'wrongpass'), { status: 401, error: 'invalid credentials' });
    const sessions = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 2; i++) sessions.push((await ctx.accounts.login('Player1', 'hunter22')).sessionToken);
    assert.equal(ctx.accounts.resolveSession(sessions[0]), null);
    assert.ok(ctx.accounts.resolveSession(sessions.at(-1)));
});

test('password KDF work has a bounded global queue', async t => {
    const ctx = tempAccounts(); cleanup(t, ctx);
    await ctx.accounts.register('Player1', 'hunter22', '');
    const attempts = await Promise.all(Array.from(
        { length: MAX_KDF_CONCURRENCY + MAX_KDF_QUEUE + 2 },
        () => ctx.accounts.login('Player1', 'hunter22')
    ));
    assert.ok(attempts.some(result => result.status === 503));
    assert.ok(attempts.some(result => result.status === 200));
});
