const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../server/account-store');
const { ProfileStore } = require('../server/profile-store');

function tempAccounts() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-accounts-'));
    const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
    const accounts = new AccountStore(path.join(dir, 'accounts.db'), profiles);
    return { dir, accounts, profiles };
}

function cleanup(t, { dir, accounts }) {
    t.after(() => {
        accounts.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
}

test('register creates an account and a linked profile token', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    const result = ctx.accounts.register('Player1', 'hunter22', 'red');
    assert.equal(result.status, 200);
    assert.ok(result.profileToken);
    assert.equal(result.profile.playerName, 'Player1');
    assert.equal(result.avatar, 'red');
});

test('register rejects a duplicate username, case-insensitively', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    ctx.accounts.register('Player1', 'hunter22', '');
    const dupe = ctx.accounts.register('player1', 'anotherpass', '');
    assert.equal(dupe.status, 409);
});

test('register rejects an invalid username or a short password', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    assert.equal(ctx.accounts.register('a b', 'longenough1').status, 400);
    assert.equal(ctx.accounts.register('validname', 'short').status, 400);
});

test('login succeeds with correct credentials and reuses the same profile token', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    const registered = ctx.accounts.register('Player1', 'hunter22', 'blue');
    const login = ctx.accounts.login('Player1', 'hunter22');
    assert.equal(login.status, 200);
    assert.equal(login.profileToken, registered.profileToken);
    assert.equal(login.profile.id, registered.profile.id);
});

test('login rejects a wrong password and an unknown username', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    ctx.accounts.register('Player1', 'hunter22', '');
    assert.equal(ctx.accounts.login('Player1', 'wrongpass').status, 401);
    assert.equal(ctx.accounts.login('nobody', 'whatever1').status, 401);
});

test('login is case-insensitive on username', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    ctx.accounts.register('Player1', 'hunter22', '');
    assert.equal(ctx.accounts.login('PLAYER1', 'hunter22').status, 200);
});

test('getByProfileToken resolves the owning account for presence lookups', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    const registered = ctx.accounts.register('Player1', 'hunter22', 'ghost');
    const resolved = ctx.accounts.getByProfileToken(registered.profileToken);
    assert.equal(resolved.username, 'Player1');
    assert.equal(resolved.avatar, 'ghost');
    assert.equal(ctx.accounts.getByProfileToken('not-a-real-token'), null);
});

test('a freshly registered account token still authenticates against the existing ProfileStore', t => {
    const ctx = tempAccounts();
    cleanup(t, ctx);
    const registered = ctx.accounts.register('Player1', 'hunter22', '');
    const profile = ctx.profiles.authenticate(registered.profileToken);
    assert.ok(profile, 'existing /api/profile/* endpoints must accept this token unchanged');
    assert.equal(profile.playerName, 'Player1');
});
