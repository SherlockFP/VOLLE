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
