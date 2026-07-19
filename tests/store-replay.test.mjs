import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { Store } = await import('../js/store.js');
const { ReplayClass } = await import('../js/replay.js');
const { CHARACTERS } = await import('../js/characters.js');

test('every class is available without a currency purchase', () => {
    Store.reset();
    assert.deepEqual(new Set(Store.get('unlockedChars')), new Set(Object.keys(CHARACTERS)));
    assert.equal(Store.ownsCharacter('soldier'), true);
    assert.equal(Store.setLoadout({ char: 'soldier' }), true);
});

test('coin purchases reject insufficient funds and persist ownership', () => {
    Store.reset();
    assert.equal(Store.buyAvatarSkin('neon'), false);
    Store.grant({ currency: 100 });
    assert.equal(Store.buyAvatarSkin('neon'), true);
    assert.equal(Store.ownsAvatarSkin('neon'), true);
    assert.equal(Store.equipAvatarSkin('neon'), true);
    assert.equal(Store.get('equippedAvatarSkin'), 'neon');
    assert.equal(Store.buyAvatarSkin('neon'), false);
});

test('character mastery levels up without losing overflow XP', () => {
    Store.reset();
    const result = Store.recordGame({ characterId: 'rally', characterXp: 300 });
    const progress = Store.getCharacterProgress('rally');
    assert.equal(result.masteryLeveledUp, true);
    assert.equal(progress.level, 2);
    assert.equal(progress.xp, 50);
});

test('avatar trials grant temporary access and XP boosts affect rewards', () => {
    Store.reset();
    assert.equal(Store.hasAvatarAccess('astro'), false);
    assert.equal(Store.startAvatarTrial('astro'), true);
    assert.equal(Store.hasAvatarAccess('astro'), true);
    assert.equal(Store.equipAvatarSkin('astro'), true);
    assert.equal(Store.buyAndActivateXpBoost(), true);
    assert.equal(Store.boostedXp(100), 150);
    assert.equal(Store.buyAndActivateXpBoost(), false);
});

test('case opening charges once, handles duplicates, and enforces team equip', () => {
    Store.reset();
    const before = Store.get('currency');
    const first = Store.openCase('kickoff', () => 0);
    assert.equal(first.reward.id, 'tide');
    assert.equal(first.duplicate, false);
    assert.equal(Store.get('currency'), before - 120);
    assert.equal(Store.equipKnife('tide', 'red'), false);
    assert.equal(Store.equipKnife('tide', 'blue'), true);
    Store.grant({ currency: 120 });
    const duplicate = Store.openCase('kickoff', () => 0);
    assert.equal(duplicate.duplicate, true);
    assert.equal(Store.get('currency'), 122);
    assert.equal(Store.openCase('missing', () => 0), null);
});

test('case opening can unlock a character skin', () => {
    Store.reset();
    const result = Store.openCase('kickoff', () => 0.92);
    assert.equal(result.reward.type, 'avatar');
    assert.ok(Store.get('ownedAvatarSkins').includes(result.reward.id));
});

test('case pity guarantees epic or better on the tenth non-premium run', () => {
    Store.reset();
    Store.grant({ currency: 1000 });
    for (let i = 0; i < 9; i++) {
        assert.equal(Store.openCase('kickoff', () => 0).reward.rarity, 'rare');
    }
    assert.equal(Store.getCasePityState('kickoff').nextGuaranteed, true);
    const guaranteed = Store.openCase('kickoff', () => 0);
    assert.equal(guaranteed.reward.id, 'prism');
    assert.equal(guaranteed.pity.guaranteed, true);
    assert.equal(Store.getCasePityState('kickoff').count, 0);
});

test('season contract rewards are claimable once', () => {
    Store.reset();
    Store.progressSeasonContracts({ games: 30, wins: 2 });
    const contract = Store.getSeasonContracts().find(item => item.id === 'matchmaker');
    assert.equal(contract.progress, contract.target);
    assert.equal(Store.claimSeasonContract('matchmaker'), 700);
    assert.equal(Store.claimSeasonContract('matchmaker'), 0);
});

test('movement trials reward first clear and keep only faster personal bests', () => {
    Store.reset();
    const trial = { id: 'test-run', reward: 200 };
    const first = Store.saveMovementTrialResult(trial, {
        trialId: 'test-run',
        time: 5000,
        distance: 100,
        samples: []
    });
    const slower = Store.saveMovementTrialResult(trial, {
        trialId: 'test-run',
        time: 6000,
        distance: 120,
        samples: []
    });
    assert.deepEqual(first, { personalBest: true, reward: 200 });
    assert.deepEqual(slower, { personalBest: false, reward: 0 });
    assert.equal(Store.getMovementTrialBest('test-run').time, 5000);
});

test('daily login and free case can be claimed once per local day', () => {
    Store.reset();
    const dayOne = new Date(2026, 6, 19, 12);
    const dayTwo = new Date(2026, 6, 20, 12);
    const login = Store.claimDailyLogin(dayOne);
    assert.deepEqual(login, { coins: 50, streak: 1 });
    assert.equal(Store.claimDailyLogin(dayOne), null);
    const free = Store.openDailyCase('kickoff', () => 0.5, dayOne);
    assert.equal(free.free, true);
    assert.equal(Store.openDailyCase('kickoff', () => 0.5, dayOne), null);
    assert.deepEqual(Store.claimDailyLogin(dayTwo), { coins: 60, streak: 2 });
    assert.equal(Store.getDailyRewardState(dayTwo).freeCaseClaimed, false);
});

test('legacy ranked ELO migrates into seasonal ranked state', () => {
    Store.reset();
    localStorage.setItem('dodgball_save_v2', JSON.stringify({
        playerName: 'Legacy',
        stats: { rankedElo: 1875, rankedGames: 12 }
    }));
    Store.load();
    assert.equal(Store.getElo(), 1875);
});

test('replay import validates shape and save keeps latest ten', () => {
    const replay = new ReplayClass();
    assert.throws(() => replay.importJSON('{"events":null}'), /Invalid replay JSON/);

    for (let i = 0; i < 12; i++) {
        replay.save({ meta: { id: i }, events: [], duration: 0 });
    }
    const saved = replay.loadAll();
    assert.equal(saved.length, 10);
    assert.equal(saved[0].meta.id, 2);
    assert.equal(saved[9].meta.id, 11);
    assert.equal(replay.delete(0), true);
    assert.equal(replay.loadAll().length, 9);
    assert.equal(replay.delete(99), false);
});

test('replay snapshots are throttled and imports require ordered timestamps', () => {
    const replay = new ReplayClass();
    replay.startRecording({ map: 'beach' });
    replay.recordSnapshot({ ball: { x: 1.234, y: 2, z: 3 }, actors: [] });
    replay.recordSnapshot({ ball: { x: 2, y: 2, z: 3 }, actors: [] });
    const result = replay.stopRecording();
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].data.ball.x, 1.23);
    assert.throws(() => replay.importJSON(JSON.stringify({
        events: [{ t: 2, type: 'a' }, { t: 1, type: 'b' }]
    })), /Invalid replay event/);
});
