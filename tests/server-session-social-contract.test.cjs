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

test('match rewards require server authority or a signed legacy receipt', () => {
    const rewardBlock = source.slice(source.indexOf("if (urlPath === '/api/profile/reward'"), source.indexOf("if (urlPath === '/api/profile/cards/equip'"));
    assert.match(source, /urlPath === '\/api\/matches\/start' && req\.method === 'POST'/);
    assert.match(source, /urlPath === '\/api\/matches\/complete' && req\.method === 'POST'/);
    assert.match(source, /matchAuthority\.start\(profile/);
    assert.match(source, /matchAuthority\.complete\(profile/);
    assert.match(rewardBlock, /signed legacy receipt required/);
    assert.doesNotMatch(rewardBlock, /normalizeMatchReceipt/);
    assert.match(rewardBlock, /profiles\.reward\(profile, \{[\s\S]*?matchId: receipt\.matchId,[\s\S]*?won: receipt\.won/);
    assert.doesNotMatch(rewardBlock, /b\.(?:cardCollection|cardReward|equippedCards)/);
    assert.match(rewardBlock, /score: 0,[\s\S]*?deflections: 0/);
});

test('first ranked reporter awaits a bounded authenticated status path and consumes its final completion', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
    assert.match(store, /async getMatchRemoteStatus\(matchId\)/);
    assert.match(store, /async pollMatchRemote\(matchId/);
    assert.match(store, /Math\.min\(12/);
    assert.match(store, /status\.status === 'finalized' && status\.completion/);
    assert.match(store, /const settled = await this\.pollMatchRemote\(matchId\)/);
    assert.match(store, /dailyProgress: completion\.dailyProgress \|\| null/);
    assert.match(store, /this\.data\.stats\.rankedElo = this\.data\.elo/);
});

test('match status route passes the authenticated profile into authority', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /urlPath\.startsWith\('\/api\/matches\/'\)[\s\S]*?const profile = requireAuth\(req, res\)\?\.profile;[\s\S]*?matchAuthority\.status\(profile,/);
});

test('lobby admission keeps private member identities out of public lobby records', () => {
    assert.match(source, /memberProfileIds\.add\(auth\.profile\.id\)/);
    assert.match(source, /\/api\/lobbies\/.*\/join/);
    assert.match(source, /const \{ ownerAccountId, memberProfileIds, admissionToken, \.\.\.visible \} = record/);
    assert.match(source, /result\.httpStatus/);
});

test('admission proof is host-welcome-only and client join waits for it', () => {
    const network = fs.readFileSync(path.join(__dirname, '..', 'js', 'network.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    assert.match(source, /crypto\.randomBytes\(32\)\.toString\('base64url'\)/);
    assert.match(source, /crypto\.timingSafeEqual\(expected, proof\)/);
    assert.match(network, /type: 'welcome',[\s\S]*?admissionToken/);
    assert.match(network, /waitForLobbyAdmissionProof/);
    assert.match(network, /_resetLobbyAdmissionProof\(\)/);
    assert.match(network, /async _joinGame[\s\S]*?_resetLobbyAdmissionProof\(\)/);
    assert.match(network, /disconnect\(\) \{\s*this\._resetLobbyAdmissionProof\(\)/);
    assert.match(main, /await this\.network\.waitForLobbyAdmissionProof\(\)/);
    assert.doesNotMatch(network, /broadcast\(\{[\s\S]{0,160}admissionToken/);
});
