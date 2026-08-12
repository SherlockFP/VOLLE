const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../server/profile-store');
const { normalizeDailyState } = require('../server/daily-challenge-service');

function battlepassTotal(progress) {
    let total = Math.max(0, Number(progress?.xp) || 0);
    for (let tier = 1; tier <= Math.max(0, Number(progress?.tier) || 0); tier += 1) total += 100 + (tier - 1) * 20;
    return total;
}

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-daily-'));
    return { dir, file: path.join(dir, 'profiles.json'), store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

test('authenticated server daily state survives a second ProfileStore session and UTC rollover rebuilds it', t => {
    const { dir, file, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Daily');
    const profile = store.authenticate(session.token);
    const first = store._public(profile).dailyChallenges;
    assert.equal(first.challenges.filter(challenge => challenge.type === 'games').length, 2, 'each daily must include two solo-accessible play tasks');
    assert.equal(first.challenges.filter(challenge => challenge.type === 'wins').length, 1, 'each daily must include at most one multiplayer win task');
    assert.match(first.challenges.find(challenge => challenge.type === 'wins').name, /Multiplayer/);
    store._save();
    const restored = new ProfileStore(file);
    const restoredDaily = restored._public(restored.authenticate(session.token)).dailyChallenges;
    assert.deepEqual(restoredDaily, first, 'same UTC day must retain server-owned tasks and progress');
    const tomorrow = normalizeDailyState(profile.dailyChallenges, Date.now() + 86400000);
    assert.notEqual(tomorrow.date, first.date, 'UTC rollover must select a new server day');
    assert.equal(tomorrow.challenges.every(challenge => challenge.progress === 0 && challenge.claimed === false), true);
    assert.equal(tomorrow.bonusGranted, false);
});

test('settled match rewards advance only server-verifiable daily types once and replays do not progress twice', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Progress');
    const profile = store.authenticate(session.token);
    const before = store._public(profile).dailyChallenges;
    const first = store.reward(profile, { matchId: 'daily-progress-one', won: true, score: 99, deflections: 99 });
    const after = first.profile.dailyChallenges;
    assert.equal(after.challenges.some((challenge, index) => challenge.progress > before.challenges[index].progress), true);
    assert.equal(after.challenges.every(challenge => ['games', 'wins'].includes(challenge.type)), true);
    const replay = store.reward(profile, { matchId: 'daily-progress-one', won: false, score: 0, deflections: 0 });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.profile.dailyChallenges, after, 'same match id cannot advance Daily twice');
});

test('daily claims reject incomplete work, grant coin and Battle Pass XP once, and third claim grants the completion bonus once', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Claims');
    const profile = store.authenticate(session.token);
    const initial = store._public(profile).dailyChallenges;
    const incomplete = store.claimDailyChallenge(profile, initial.challenges[0].id, 'daily:incomplete');
    assert.equal(incomplete.status, 409);
    for (let index = 0; index < 6; index += 1) store.reward(profile, { matchId: `daily-claim-${index}`, won: true, score: 0, deflections: 0 });
    const ready = store._public(profile).dailyChallenges;
    assert.equal(ready.challenges.every(challenge => challenge.progress === challenge.target), true);
    const currencyBefore = profile.currency;
    const battlepassBefore = battlepassTotal(profile.battlepass);
    const claims = ready.challenges.map((challenge, index) => store.claimDailyChallenge(profile, challenge.id, `daily:claim:${index}`));
    assert.deepEqual(claims.map(result => result.status), [200, 200, 200]);
    assert.deepEqual(claims.map(result => result.xpGranted), [50, 50, 150]);
    assert.equal(profile.currency, currencyBefore + ready.challenges.reduce((sum, challenge) => sum + challenge.reward, 0));
    const duplicate = store.claimDailyChallenge(profile, ready.challenges[2].id, 'daily:claim:2');
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.replayed, true);
    assert.equal(duplicate.xpGranted, 150);
    assert.equal(battlepassTotal(profile.battlepass), battlepassBefore + 250, '250 daily XP must be awarded exactly once');
});

test('daily claim idempotency is scoped to one challenge and a currency-capped claim reports the actual grant', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'ClaimSafety');
    const profile = store.authenticate(session.token);
    profile.dailyChallenges.challenges = profile.dailyChallenges.challenges.map(challenge => ({ ...challenge, progress: challenge.target }));
    profile.currency = 10000;
    const [firstChallenge, secondChallenge] = profile.dailyChallenges.challenges;
    const first = store.claimDailyChallenge(profile, firstChallenge.id, 'daily:key:one');
    assert.equal(first.status, 200);
    assert.equal(first.coins, 0, 'the response must not claim coins that the cap rejected');
    assert.equal(profile.currency, 10000);
    const replay = store.claimDailyChallenge(profile, firstChallenge.id, 'daily:key:replacement');
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true, 'a lost response can be retried with a fresh key without minting again');
    const collision = store.claimDailyChallenge(profile, secondChallenge.id, 'daily:key:one');
    assert.equal(collision.status, 409, 'one idempotency key cannot silently replay another challenge');
});

test('daily claim route is authenticated/rate-limited and Store remote path does not mutate Daily optimistically', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const client = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
    assert.match(server, /dailyChallenge: \[20, 60000\]/);
    assert.match(server, /urlPath === '\/api\/profile\/daily-challenges\/claim' && req\.method === 'POST'/);
    assert.match(server, /allowRequest\(req, res, 'dailyChallenge'\)/);
    assert.match(server, /requireAuth\(req, res, body\)\?\.profile/);
    assert.match(client, /async _claimDailyChallengeRemote\(challengeId\)/);
    const remoteBody = client.slice(client.indexOf('async _claimDailyChallengeRemote'), client.indexOf('claimDailyChallenge(challengeId)'));
    assert.doesNotMatch(remoteBody, /Daily\.claim\(/);
    assert.doesNotMatch(remoteBody, /this\.grant\(/);
});

test('Daily product events are allowlisted and only emitted from authoritative success paths', () => {
    const clientAnalytics = fs.readFileSync(path.join(__dirname, '..', 'js', 'product-analytics.js'), 'utf8');
    const serverAnalytics = fs.readFileSync(path.join(__dirname, '..', 'server', 'product-analytics.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    const store = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const polish = fs.readFileSync(path.join(__dirname, '..', 'css', 'polish.css'), 'utf8');
    for (const source of [clientAnalytics, serverAnalytics]) {
        assert.match(source, /'daily_challenge_completed', 'daily_challenge_claimed'/);
    }
    assert.match(store, /dailyProgress: completion\.dailyProgress \|\| null/);
    assert.match(main, /!synced\.replayed && Array\.isArray\(synced\.dailyProgress\?\.completed\)/);
    assert.match(main, /this\.productAnalytics\.track\('daily_challenge_completed'/);
    assert.match(main, /this\.store\.remoteReady && reward\.replayed !== true/);
    assert.match(main, /this\.productAnalytics\.track\('daily_challenge_claimed'/);
    assert.match(ui, /const dailies = store\?\.getDailyChallenges\?\.\(\) \|\| daily\?\.getChallenges/,
        'the in-match objective tracker must use the account-authoritative catalog');
    assert.match(html, /daily-shell/);
    assert.match(html, /UTC DAILY RESET/);
    assert.doesNotMatch(html, /LOCAL RESET/);
    assert.match(polish, /\.daily-shell \.daily-name \{ color: var\(--screen-ink/,
        'Daily task names need an explicit high-contrast token on dark cards');
});
