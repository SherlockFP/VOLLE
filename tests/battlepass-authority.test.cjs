const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../server/profile-store');
const { PREMIUM_PASS_PRICE, SEASON_DURATION_MS } = require('../server/battlepass-service');

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-bp-'));
    return { dir, file: path.join(dir, 'profiles.json'), store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

test('battle pass is account-persistent and ignores local client state on a new server session', t => {
    const { dir, file, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Authority', { currency: 2000 });
    const profile = store.authenticate(session.token);
    const reward = store.reward(profile, { matchId: 'bp-account-match', won: true, score: 9999, deflections: 9999 });
    assert.equal(reward.battlepassXp, 100);
    assert.equal(profile.battlepass.tier, 1);
    const restored = new ProfileStore(file).authenticate(session.token);
    assert.equal(restored.battlepass.tier, 1);
    assert.equal(restored.battlepass.xp, 0);
    assert.equal(restored.battlepass.premium, false);
});

test('one match settlement adds fixed server XP once and replay cannot mint more', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Replay');
    const profile = store.authenticate(session.token);
    const first = store.reward(profile, { matchId: 'bp-replay-match', won: false, score: 500, deflections: 500 });
    assert.equal(first.battlepassXp, 80);
    assert.equal(profile.battlepass.xp, 80);
    const replay = store.reward(profile, { matchId: 'bp-replay-match', won: true, score: 9999, deflections: 9999 });
    assert.equal(replay.replayed, true);
    assert.equal(replay.battlepassXp, 0);
    assert.equal(profile.battlepass.xp, 80);
});

test('claim is atomic/idempotent and grants an authoritative inventory item once', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Claim');
    const profile = store.authenticate(session.token);
    store.reward(profile, { matchId: 'bp-claim-match', won: true });
    const first = store.claimBattlepass(profile, 1, 'free');
    assert.equal(first.status, 200);
    assert.equal(first.replayed, false);
    assert.equal(profile.currency, 200 + 43 + 120 + 80, 'match coin/first-day reward and first BP currency grant are applied once');
    const second = store.claimBattlepass(profile, 1, 'free');
    assert.equal(second.status, 200);
    assert.equal(second.replayed, true);
    assert.equal(profile.currency, 443);
});

test('premium unlock enforces server balance and duplicate unlock does not charge twice', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const poorSession = store.session('', 'Poor', { currency: PREMIUM_PASS_PRICE - 1 });
    const poor = store.authenticate(poorSession.token);
    assert.equal(store.unlockPremiumBattlepass(poor).status, 409);
    const richSession = store.session('', 'Rich', { currency: PREMIUM_PASS_PRICE });
    const rich = store.authenticate(richSession.token);
    assert.equal(store.unlockPremiumBattlepass(rich).status, 200);
    assert.equal(rich.currency, 0);
    assert.equal(store.unlockPremiumBattlepass(rich).replayed, true);
    assert.equal(rich.currency, 0);
});

test('server rollover resets season state using server time and persists the new season', t => {
    const { dir, file, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Rollover');
    const profile = store.authenticate(session.token);
    const now = Date.now();
    const start = now - SEASON_DURATION_MS;
    profile.battlepass = { seasonId: 3, seasonStartAt: start, tier: 20, xp: 80, claimedFree: [1], claimedPremium: [1], premium: true };
    const result = store.claimBattlepass(profile, 1, 'free', now);
    assert.equal(result.status, 409, 'a reset season has not yet reached tier one');
    assert.equal(profile.battlepass.seasonId, 4);
    assert.equal(profile.battlepass.tier, 0);
    assert.equal(profile.battlepass.premium, false);
    const restored = new ProfileStore(file).authenticate(session.token);
    assert.equal(restored.battlepass.seasonId, 4);
});

test('Battle Pass boost activation is server-owned, private, overlap-safe, and idempotent', t => {
    const { dir, file, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Booster');
    const profile = store.authenticate(session.token);
    const now = Date.now();
    profile.battlepass = { ...profile.battlepass, tier: 5, xp: 0 };
    assert.equal(store.claimBattlepass(profile, 5, 'free', now).status, 200);
    const boostId = Object.keys(profile.battlepassBoosts)[0];
    assert.ok(boostId);
    assert.equal(profile.battlepassBoosts[boostId].quantity, 1);

    const first = store.activateBattlepassBoost(profile, boostId, 'bp-request-0001', now + 1);
    assert.equal(first.status, 200);
    assert.equal(first.replayed, false);
    assert.deepEqual(first.activeBoost, {
        boostId,
        multiplier: 1.25,
        activatedAt: now + 1,
        expiresAt: now + 1 + 20 * 60 * 1000
    });
    assert.equal(profile.battlepassBoosts[boostId], undefined, 'server decrements the owned boost exactly once');
    assert.equal(first.profile.battlepassBoostReceipts, undefined, 'activation receipts stay private');
    assert.deepEqual(first.profile.battlepassActiveBoost, first.activeBoost, 'public state uses the activation server time');

    const replay = store.activateBattlepassBoost(profile, boostId, 'bp-request-0001', now + 2);
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.activeBoost, first.activeBoost);
    assert.equal(profile.battlepassBoostReceipts.length, 1);
    assert.equal(store.activateBattlepassBoost(profile, 'another-valid-boost', 'bp-request-0001', now + 3).status, 409);
    assert.equal(store.activateBattlepassBoost(profile, boostId, 'bp-request-0002', now + 3).status, 409, 'overlap is rejected before inventory is consumed');
    assert.equal(store.activateBattlepassBoost(profile, '../bad boost', 'bp-request-0003', now + 3).status, 400);

    const restored = new ProfileStore(file).authenticate(session.token);
    assert.deepEqual(restored.battlepassActiveBoost, first.activeBoost);
    assert.equal(restored.battlepassBoostReceipts.length, 1);
});

test('active boost floors authoritative Battle Pass XP, expires at equality, and replay grants zero', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const now = Date.now();
    const boostedSession = store.session('', 'Boosted');
    const boosted = store.authenticate(boostedSession.token);
    boosted.battlepassBoosts = { boost_125: { boostId: 'boost_125', quantity: 1, multiplier: 1.25, durationMs: 1000 } };
    assert.equal(store.activateBattlepassBoost(boosted, 'boost_125', 'bp-request-boosted', now).status, 200);
    const first = store.reward(boosted, { matchId: 'bp-boosted-loss', won: false }, now + 999);
    assert.equal(first.battlepassXp, 100);
    assert.equal(first.battlepassBoostMultiplier, 1.25);
    assert.equal(first.base, 40, 'coin reward shape remains independent from Battle Pass XP');
    const replay = store.reward(boosted, { matchId: 'bp-boosted-loss', won: true }, now + 999);
    assert.equal(replay.replayed, true);
    assert.equal(replay.battlepassXp, 0);
    assert.equal(replay.battlepassBoostMultiplier, 1);
    assert.equal(replay.base, 0);

    const expirySession = store.session('', 'Expiry');
    const expiry = store.authenticate(expirySession.token);
    expiry.battlepassBoosts = { boost_150: { boostId: 'boost_150', quantity: 1, multiplier: 1.5, durationMs: 1000 } };
    assert.equal(store.activateBattlepassBoost(expiry, 'boost_150', 'bp-request-expiry', now).status, 200);
    const atEquality = store.reward(expiry, { matchId: 'bp-expiry-equality', won: false }, now + 1000);
    assert.equal(atEquality.battlepassXp, 80, 'expiresAt equality is inactive');
    assert.equal(atEquality.battlepassBoostMultiplier, 1);
    assert.equal(expiry.battlepassActiveBoost, null);

    const flooredSession = store.session('', 'Floored');
    const floored = store.authenticate(flooredSession.token);
    floored.battlepassBoosts = { boost_fractional: { boostId: 'boost_fractional', quantity: 1, multiplier: 1.333, durationMs: 1000 } };
    assert.equal(store.activateBattlepassBoost(floored, 'boost_fractional', 'bp-request-floored', now).status, 200);
    assert.equal(store.reward(floored, { matchId: 'bp-floored-loss', won: false }, now + 1).battlepassXp, 106);
});

test('Battle Pass boost activation receipts stay bounded', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Bounded');
    const profile = store.authenticate(session.token);
    const now = Date.now();
    profile.battlepassBoosts = { short_boost: { boostId: 'short_boost', quantity: 30, multiplier: 1.25, durationMs: 1 } };
    for (let index = 0; index < 30; index += 1) {
        const result = store.activateBattlepassBoost(profile, 'short_boost', `bp-bound-${String(index).padStart(4, '0')}`, now + index);
        assert.equal(result.status, 200);
    }
    assert.equal(profile.battlepassBoostReceipts.length, 24);
    assert.equal(profile.battlepassBoostReceipts[0].requestId, 'bp-bound-0006');
    assert.equal(store._public(profile, now + 30).battlepassBoostReceipts, undefined);
});

test('client keeps guest/local battle pass functions and delegates authenticated calls to API', () => {
    const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'polish.css'), 'utf8');
    assert.match(client, /if \(this\.remoteReady\) return this\._claimBattlepassRewardRemote/);
    assert.match(client, /fetch\('\/api\/profile\/battlepass\/claim'/);
    assert.match(client, /fetch\('\/api\/profile\/battlepass\/premium'/);
    assert.match(client, /fetch\('\/api\/profile\/battlepass\/boost\/activate'/);
    assert.match(client, /'Idempotency-Key': requestId/);
    assert.match(client, /'battlepass', 'battlepassBoosts', 'battlepassActiveBoost'/);
    assert.match(client, /if \(!this\.remoteReady\) \{\s*this\._rolloverBattlepassSeason\(\);\s*const \{ state \} = addBattlepassXp/);
    assert.match(main, /await this\.store\.claimBattlepassReward/);
    assert.match(main, /await this\.store\.buyPremiumBattlepass/);
    assert.match(main, /await this\.store\.activateBattlepassBoost/);
    assert.match(main, /if \(!activation\.replayed\) \{\s*this\.productAnalytics\.track\('battlepass_boost_activated'/);
    assert.match(server, /urlPath === '\/api\/profile\/battlepass\/claim'/);
    assert.match(server, /urlPath === '\/api\/profile\/battlepass\/premium'/);
    assert.match(server, /urlPath === '\/api\/profile\/battlepass\/boost\/activate'/);
    assert.match(server, /req\.headers\['idempotency-key'\] \|\| body\.requestId/);
    assert.match(server, /profiles\.activateBattlepassBoost\(profile, body\.boostId, requestId\)/);
    assert.match(html, /id="bp-season-value-title"/);
    assert.match(html, /id="bp-value-next"/);
    assert.match(html, /id="bp-value-claims"/);
    assert.match(html, /id="bp-value-boosts"/);
    assert.match(html, /class="btn btn-secondary btn-small bp-boost-activate"/);
    assert.match(css, /@media \(max-width: 640px\), \(max-height: 620px\)[\s\S]*\.bp-season-value \{\s*grid-template-columns: 1fr;/);
    assert.match(css, /\.bp-value-stats \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*#battlepass-screen \.progression-hero \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 78px;/);
    assert.match(css, /#battlepass-screen \.bp-premium-buy \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*max-width: 100%;/);
    const battlepassUi = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8')
        .split('// ===== BATTLEPASS EKRANI =====')[1]
        .split('// ===== ACHIEVEMENTS EKRANI =====')[0];
    assert.doesNotMatch(battlepassUi, /scrollIntoView/);
    assert.match(battlepassUi, /currentCell\.offsetLeft - \(trackEl\.clientWidth - currentCell\.offsetWidth\) \/ 2/);
    assert.match(battlepassUi, /trackEl\.scrollTo\(\{[\s\S]*left: targetLeft,[\s\S]*top: trackEl\.scrollTop/);
    assert.match(battlepassUi, /trackEl\.scrollLeft = targetLeft/);
});
