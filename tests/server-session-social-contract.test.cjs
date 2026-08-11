const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('server resolves public API identity from account sessions, not profile bearer tokens', () => {
    assert.match(source, /function resolveAuth\(req, body = null\)/);
    assert.match(source, /return accounts\.resolveSession\(sessionToken\)/);
    assert.doesNotMatch(source, /profiles\.authenticate\(bearer\(req\)\)/);
    assert.match(source, /ALLOW_GUEST_SESSIONS === '1'/);
});

test('account and social endpoint contract stays session-authenticated', () => {
    for (const endpoint of [
        '/api/account/me', '/api/account/logout', '/api/social/me', '/api/social/friend-requests',
        '/api/social/friends', '/api/social/conversations/', '/api/social/lobby-invites'
    ]) assert.ok(source.includes(endpoint), `missing ${endpoint}`);
    assert.match(source, /const auth = requireAuth\(req, res, b\);/);
    assert.match(source, /lobby\.ownerAccountId !== auth\.account\.id/);
    assert.match(source, /ownerAccountId: auth\.account\.id/);
    assert.match(source, /\[\.\.\.lobbies\.values\(\)\]\.map\(publicLobby\)/);
});

test('social messaging has isolated rate buckets and no analytics sink', () => {
    assert.match(source, /directMessage: \[30, 60000\]/);
    assert.match(source, /lobbyInvite: \[20, 60000\]/);
    assert.doesNotMatch(source, /productAnalytics\.ingest\([^\n]*message/);
});

test('standalone server handles termination through the close cleanup path', () => {
    assert.match(source, /function shutdown\(signal\)/);
    assert.match(source, /process\.once\('SIGTERM'/);
    assert.match(source, /process\.once\('SIGINT'/);
    assert.match(source, /server\.close\(\(\) =>/);
});

test('card APIs are authenticated earn-only collection endpoints, not paid power paths', () => {
    assert.match(source, /\/api\/profile\/cards\/equip/);
    assert.match(source, /\/api\/profile\/cards\/trade-up/);
    assert.match(source, /profiles\.equipCard\(profile, body\.cardId, body\.slot\)/);
    assert.match(source, /profiles\.tradeUpCards\(profile, body\.cardIds, requestId\)/);
    assert.doesNotMatch(source, /\/api\/profile\/cards\/purchase/);
    const profileSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'profile-store.js'), 'utf8');
    assert.match(profileSource, /kind === 'skill' \|\| kind === 'rune'/);
    assert.doesNotMatch(profileSource, /skill:\s*\{[\s\S]*?freeze:\s*100/);
    assert.doesNotMatch(profileSource, /rune:\s*\{[\s\S]*?hp_bonus:\s*80/);
});

test('card reward is derived only inside the existing authenticated match-claim boundary', () => {
    const rewardBlock = source.slice(source.indexOf("if (urlPath === '/api/profile/reward'"), source.indexOf("if (urlPath === '/api/profile/cards/equip'"));
    assert.match(rewardBlock, /profileId: profile\.id/);
    assert.match(rewardBlock, /profiles\.reward\(profile, \{[\s\S]*?matchId: receipt\.matchId,[\s\S]*?won: receipt\.won/);
    assert.doesNotMatch(rewardBlock, /b\.(?:cardCollection|cardReward|equippedCards)/);
});
