const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CATALOG, ProfileStore } = require('../server/profile-store');

function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-profile-'));
    return { dir, store: new ProfileStore(path.join(dir, 'profiles.json')) };
}

test('session token restores a persisted profile', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const created = store.session('', 'Player');
    const restored = store.session(created.token, 'Renamed');
    assert.equal(restored.profile.id, created.profile.id);
    assert.equal(restored.profile.playerName, 'Renamed');
    assert.equal(restored.profile.tokenHash, undefined);
});

test('purchase validates catalog, ownership and balance', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player', { currency: 500 });
    const profile = store.authenticate(session.token);
    assert.equal(store.purchase(profile, 'ball', 'fire').status, 200);
    assert.equal(profile.currency, 350);
    assert.equal(store.purchase(profile, 'ball', 'inferno').status, 200);
    assert.equal(profile.currency, 130);
    assert.equal(store.purchase(profile, 'ball', 'fire').status, 409);
    assert.equal(store.purchase(profile, 'ball', 'missing').status, 404);
});

test('ball catalog contains the new cosmetic skin collection', () => {
    for (const id of ['inferno', 'frostbite', 'voltstorm', 'nebula', 'creeper', 'happy', 'glitch', 'void_eye', 'candy', 'solar', 'toxic', 'disco', 'magma', 'ocean', 'honey', 'dragon', 'portal', 'moon', 'pumpkin', 'matrix', 'sakura', 'blackhole']) {
        assert.ok(Number.isInteger(CATALOG.ball[id]) && CATALOG.ball[id] > 0, `${id} missing from server catalog`);
    }
});

test('wearable catalog is server-priced and migrated through its own ownership field', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.equal(Object.keys(CATALOG.cosmetic).length, 135);
    const session = store.session('', 'Player', {
        currency: 1000,
        ownedCosmetics: ['cape_ember', 'unknown_cosmetic']
    });
    const profile = store.authenticate(session.token);
    assert.deepEqual(profile.ownedCosmetics, ['cape_ember']);
    assert.equal(store.purchase(profile, 'cosmetic', 'pet_slime').status, 200);
    assert.ok(profile.ownedCosmetics.includes('pet_slime'));
});

test('pre-wearable persisted profiles normalize before cosmetic purchase', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Legacy', { currency: 1000 });
    const file = path.join(dir, 'profiles.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw[session.profile.id].ownedCosmetics;
    delete raw[session.profile.id].equippedWearables;
    fs.writeFileSync(file, JSON.stringify(raw));
    const restored = new ProfileStore(file);
    const profile = restored.authenticate(session.token);
    assert.deepEqual(profile.ownedCosmetics, []);
    assert.equal(restored.purchase(profile, 'cosmetic', 'pet_slime').status, 200);
});

test('server case opening is priced, persistent, and idempotent', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Cases', { currency: 1000 });
    const profile = store.authenticate(session.token);
    const first = store.openCase(profile, 'elemental', 'case:elemental:first', 0);
    assert.equal(first.status, 200);
    assert.deepEqual(first.result.reward, { id: 'magma', type: 'ball', rarity: 'legendary' });
    assert.ok(profile.ownedBalls.includes('magma'));
    const replay = store.openCase(profile, 'elemental', 'case:elemental:first', 0.99);
    assert.equal(replay.replayed, true);
    assert.equal(profile.currency, 810);
});

test('daily free case is server-owned: once per UTC day, Kickoff only, never charges', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Daily', { currency: 500 });
    const profile = store.authenticate(session.token);
    const dayOne = Date.UTC(2026, 8, 23, 12);
    const dayTwo = Date.UTC(2026, 8, 24, 1);
    const first = store.openCase(profile, 'kickoff', 'daily:first-open', 0, { dailyFree: true, now: dayOne });
    assert.equal(first.status, 200);
    assert.equal(first.result.free, true);
    assert.ok(profile.currency >= 500, 'a free opening never debits credits');
    const replay = store.openCase(profile, 'kickoff', 'daily:first-open', 0.9, { dailyFree: true, now: dayOne });
    assert.equal(replay.replayed, true);
    assert.equal(store.openCase(profile, 'kickoff', 'daily:second-open', 0, { dailyFree: true, now: dayOne }).status, 409);
    assert.equal(store.openCase(profile, 'mythic', 'daily:wrong-case', 0, { dailyFree: true, now: dayTwo }).status, 400);
    assert.equal(store.openCase(profile, 'kickoff', 'daily:next-day', 0, { dailyFree: true, now: dayTwo }).status, 200);
});

test('legacy migration clamps currency and filters unknown ownership', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player', {
        currency: 999999,
        ownedBalls: ['fire', 'inferno', 'developer_only']
    });
    assert.equal(session.profile.currency, 10000);
    assert.deepEqual(session.profile.ownedBalls, ['classic', 'fire', 'inferno']);
    const empty = store.session('', 'Empty', { currency: 0 });
    assert.equal(empty.profile.currency, 0);
});

test('match rewards are bounded and idempotent', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Player');
    const profile = store.authenticate(session.token);
    const reward = store.reward(profile, {
        matchId: 'match-1',
        won: true,
        deflections: 9999,
        score: 9999
    });
    assert.equal(reward.status, 200);
    assert.equal(reward.base, 120);
    assert.equal(reward.bonus, 60);
    assert.equal(reward.coins, 180);
    const replay = store.reward(profile, { matchId: 'match-1' });
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    const lossReward = store.reward(profile, { matchId: 'match-2', won: false, deflections: 0, score: 0 });
    assert.equal(lossReward.coins, 40);
});

test('onboarding is profile-scoped, monotonic, idempotent, and persisted', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const accountA = store.session('', 'AccountA');
    const accountB = store.session('', 'AccountB');
    const profileA = store.authenticate(accountA.token);
    const profileB = store.authenticate(accountB.token);
    assert.deepEqual(accountA.profile.onboarding, { ftueSeen: false, ftueCompleted: false, ftueMatchHintsSeen: false });
    const first = store.advanceOnboarding(profileA, { ftueSeen: true, ftueCompleted: true });
    assert.equal(first.updated, true);
    assert.deepEqual(first.onboarding, { ftueSeen: true, ftueCompleted: true, ftueMatchHintsSeen: false });
    assert.deepEqual(store._public(profileB).onboarding, { ftueSeen: false, ftueCompleted: false, ftueMatchHintsSeen: false }, 'another account cannot inherit FTUE state');
    assert.equal(store.advanceOnboarding(profileA, { ftueSeen: true }).updated, false, 'repeat update is idempotent');
    assert.equal(store.advanceOnboarding(profileA, { ftueSeen: false }).status, 400, 'flags cannot reset');
    assert.equal(store.advanceOnboarding(profileA, { unknown: true }).status, 400);
    const restored = new ProfileStore(path.join(dir, 'profiles.json'));
    assert.deepEqual(restored._public(restored.authenticate(accountA.token)).onboarding, first.onboarding);
});

test('onboarding endpoint is authenticated and client maps/syncs the server profile flags', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const clientStore = fs.readFileSync(path.join(__dirname, '..', 'js', 'store.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
    assert.match(server, /urlPath === '\/api\/profile\/onboarding' && req\.method === 'POST'/);
    assert.match(server, /allowRequest\(req, res, 'onboarding'\)/);
    assert.match(server, /requireAuth\(req, res, body\)\?\.profile/);
    assert.match(server, /profiles\.advanceOnboarding\(profile, body\.onboarding\)/);
    assert.match(clientStore, /async syncOnboarding\(onboarding\)/);
    assert.match(clientStore, /fetch\('\/api\/profile\/onboarding'/);
    assert.match(clientStore, /this\.data\[flag\] = profile\.onboarding\[flag\]/);
    assert.match(main, /syncOnboarding\(\{ ftueCompleted: true \}\)/);
    assert.doesNotMatch(main, /syncOnboarding\(\{ ftueSeen: true \}\)|syncOnboarding\(\{ ftueMatchHintsSeen: true \}\)/,
        'automatic first-entry and timed match-hint onboarding stay removed');
});

test('earned case entitlement is match-idempotent, drought-bounded, and opens before credits', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'EarnedCases', { currency: 0 });
    const profile = store.authenticate(session.token);
    let earned = null;
    for (let index = 0; index < 5 && !earned; index += 1) {
        const result = store.reward(profile, { matchId: `earned-case-${index}`, won: false, score: 0, deflections: 0 });
        if (result.earnedCase) earned = { matchId: `earned-case-${index}`, result };
    }
    assert.equal(earned?.result.earnedCase, 'kickoff', 'a completed-match cosmetic case must arrive within five rewards');
    assert.ok(['match_roll', 'drought_guarantee'].includes(earned.result.earnedCaseSource));
    const balance = profile.currency;
    const opened = store.openCase(profile, 'kickoff', 'earned-open:first', 0);
    assert.equal(opened.status, 200);
    assert.equal(opened.result.free, true);
    assert.equal(profile.currency, balance, 'earned case must consume entitlement before credits');
    const replay = store.reward(profile, { matchId: earned.matchId, won: true, score: 99, deflections: 99 });
    assert.equal(replay.replayed, true);
    assert.equal(replay.earnedCase, 'kickoff');
});

test('Arena Cache is awarded by the idempotent match-reward record, not a purchase', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Cards');
    const profile = store.authenticate(session.token);
    let awarded = null;
    for (let index = 0; index < 80 && !awarded; index += 1) {
        const matchId = `card-match-${index}`;
        const result = store.reward(profile, { matchId, won: index % 2 === 0, score: 0, deflections: 0 });
        if (result.cardReward) awarded = { matchId, result };
    }
    assert.ok(awarded?.result.cardReward?.card?.id, 'a deterministic earned match should grant a cache in this bounded sample');
    const earnedBeforeReplay = profile.arenaCache.earned;
    const copiesBeforeReplay = profile.cardCollection[awarded.result.cardReward.card.id];
    const replay = store.reward(profile, { matchId: awarded.matchId, won: true, score: 99, deflections: 99 });
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.cardReward, awarded.result.cardReward);
    assert.equal(profile.arenaCache.earned, earnedBeforeReplay);
    assert.equal(profile.cardCollection[awarded.result.cardReward.card.id], copiesBeforeReplay);
    assert.equal(replay.profile.cardRewardReceipts, undefined);
    assert.equal(replay.profile.cardTradeReceipts, undefined);
});

test('card equip and trade-up validate ownership and are idempotent', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'Cards');
    const profile = store.authenticate(session.token);
    assert.equal(store.equipCard(profile, 'apex-smash', 'active').status, 403);
    profile.cardCollection['apex-smash'] = 1;
    assert.equal(store.equipCard(profile, 'apex-smash', 'passive').status, 400);
    const equip = store.equipCard(profile, 'apex-smash', 'active');
    assert.equal(equip.status, 200);
    assert.equal(equip.loadout.active, 'apex-smash');
    profile.cardCollection['bastion-shield'] = 5;
    assert.equal(store.tradeUpCards(profile, Array(5).fill('bastion-shield')).status, 400);
    const first = store.tradeUpCards(profile, Array(5).fill('bastion-shield'), 'cardtrade:one');
    assert.equal(first.status, 200);
    assert.equal(first.result.reward.rarity, 'epic');
    const replay = store.tradeUpCards(profile, Array(5).fill('bastion-shield'), 'cardtrade:one');
    assert.equal(replay.status, 200);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(store.tradeUpCards(profile, Array(5).fill('bastion-shield'), 'cardtrade:two').status, 409);
});

test('legacy skill and rune ownership survives migration but cannot be purchased again', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'LegacyCards', {
        currency: 1000,
        ownedSkills: ['freeze', 'unknown'],
        ownedItems: ['speed_bonus', 'unknown'],
        cardCollection: { 'apex-smash': 1, 'unknown-card': 8 },
        equippedCards: { active: 'apex-smash', passive: 'deflect-plate' }
    });
    const profile = store.authenticate(session.token);
    assert.ok(profile.ownedSkills.includes('freeze'));
    assert.ok(profile.ownedItems.includes('speed_bonus'));
    assert.equal(profile.cardCollection['apex-smash'], 1);
    assert.equal(profile.cardCollection['unknown-card'], undefined);
    assert.equal(profile.equippedCards.active, 'apex-smash');
    assert.equal(store.purchase(profile, 'skill', 'freeze').status, 403);
    assert.equal(store.purchase(profile, 'rune', 'speed_bonus').status, 403);
});

// --- Leaderboard (read-only) projection ------------------------------------

test('leaderboardEntries derives elo/placement/record/flair from rankedState and never leaks the raw profile id', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const session = store.session('', 'LadderQA', {
        currency: 5000,
        ownedAvatarSkins: ['default', 'neon', 'royal'],
        ownedKnives: ['training', 'stiletto', 'rift_hook']
    });
    const profile = store.authenticate(session.token);
    profile.rankedState = {
        elo: 1450,
        currentSeason: {
            id: 'season-1', startedAt: 0, startingElo: 1200,
            placements: { required: 5, completed: 5, placed: true },
            record: { games: 12, wins: 8, losses: 4, draws: 0, highestElo: 1500, lowestElo: 1100 },
            matches: []
        },
        pastSeasons: []
    };
    const entry = store.leaderboardEntries().find(e => e.profileId === profile.id);
    assert.ok(entry, 'entry present for a placed profile');
    assert.equal(entry.elo, 1450);
    assert.equal(entry.placed, true);
    assert.equal(entry.games, 12);
    assert.equal(entry.wins, 8);
    assert.equal(entry.winRate, 8 / 12);
    assert.equal(entry.seasonDelta, 250);
    assert.equal(entry.displayName, 'LadderQA');
    // No server-side "equipped" avatar/knife exists, so flair stands in with
    // the most recently unlocked non-starter item of each kind (ownership
    // arrays are append-only, so "last" means "most recent").
    assert.equal(entry.avatarId, 'royal');
    assert.equal(entry.knifeId, 'rift_hook');
    // The public code stands in for the profile id and must not just be it.
    assert.notEqual(entry.publicCode, profile.id);
    assert.match(entry.publicCode, /^[a-f0-9]{12}$/);
});

test('a fresh profile has not cleared ranked placements and is reported unplaced', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = store.authenticate(store.session('', 'Placing').token);
    const entry = store.leaderboardEntries().find(e => e.profileId === profile.id);
    assert.equal(entry.placed, false);
    assert.equal(entry.games, 0);
});

test('leaderboard publicCode is stable per profile and unique across profiles', t => {
    const { dir, store } = tempStore();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const a = store.authenticate(store.session('', 'A').token);
    const b = store.authenticate(store.session('', 'B').token);
    const first = store.leaderboardEntries();
    const second = store.leaderboardEntries();
    const codeA1 = first.find(e => e.profileId === a.id).publicCode;
    const codeA2 = second.find(e => e.profileId === a.id).publicCode;
    const codeB = first.find(e => e.profileId === b.id).publicCode;
    assert.equal(codeA1, codeA2);
    assert.notEqual(codeA1, codeB);
});
