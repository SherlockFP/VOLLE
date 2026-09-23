// tests/mvp-select.test.mjs — MVP tie-break rules and loadout resolution for
// the post-game MVP card (js/mvp-select.js). Pure module, no THREE import, so
// it runs directly under plain `node --test` unlike js/mvp-showcase.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMvp, resolveMvpLoadout } from '../js/mvp-select.js';

test('selectMvp picks the most kills', () => {
    const stats = [
        { name: 'Ada', score: 5, deflections: 2, damageDealt: 100 },
        { name: 'Bob', score: 8, deflections: 1, damageDealt: 50 }
    ];
    assert.equal(selectMvp(stats).name, 'Bob');
});

test('selectMvp breaks a kill tie on deflections', () => {
    const stats = [
        { name: 'Ada', score: 5, deflections: 6, damageDealt: 10 },
        { name: 'Bob', score: 5, deflections: 3, damageDealt: 999 }
    ];
    assert.equal(selectMvp(stats).name, 'Ada');
});

test('selectMvp breaks a kill+deflection tie on damage dealt', () => {
    const stats = [
        { name: 'Ada', score: 5, deflections: 3, damageDealt: 120 },
        { name: 'Bob', score: 5, deflections: 3, damageDealt: 340 }
    ];
    assert.equal(selectMvp(stats).name, 'Bob');
});

test('selectMvp is stable on a full tie (keeps scoreboard order)', () => {
    const stats = [
        { name: 'Ada', score: 5, deflections: 3, damageDealt: 120 },
        { name: 'Bob', score: 5, deflections: 3, damageDealt: 120 }
    ];
    assert.equal(selectMvp(stats).name, 'Ada');
});

test('selectMvp handles empty or missing input without throwing', () => {
    assert.equal(selectMvp([]), null);
    assert.equal(selectMvp(null), null);
    assert.equal(selectMvp(undefined), null);
});

test('resolveMvpLoadout returns null for a null MVP', () => {
    assert.equal(resolveMvpLoadout(null, {}), null);
});

test('resolveMvpLoadout without a game falls back to full defaults', () => {
    const loadout = resolveMvpLoadout({ name: 'Ada', team: 'blue' }, {});
    assert.deepEqual(loadout, { knifeId: 'training', gloveId: 'none', ballSkinId: 'classic', team: 'blue' });
});

test('resolveMvpLoadout reads the local human MVP from Player + Store', () => {
    const game = { playerName: 'Ada', remotePlayers: new Map(), bots: [] };
    const player = { team: 'red', knifeId: 'dragonclaw' };
    const store = {
        get: key => ({
            equippedKnives: { red: 'training' },
            equippedWearables: { gloves: 'gloves_crown' },
            equippedBall: 'magma'
        })[key]
    };
    const loadout = resolveMvpLoadout({ name: 'Ada', team: 'red' }, { game, player, store });
    assert.deepEqual(loadout, { knifeId: 'dragonclaw', gloveId: 'gloves_crown', ballSkinId: 'magma', team: 'red' });
});

test('resolveMvpLoadout falls back to the store equip when Player has no knifeId', () => {
    const game = { playerName: 'Ada', remotePlayers: new Map(), bots: [] };
    const player = { team: 'blue' };
    const store = { get: key => ({ equippedKnives: { blue: 'icefang' } }[key]) };
    const loadout = resolveMvpLoadout({ name: 'Ada', team: 'blue' }, { game, player, store });
    assert.equal(loadout.knifeId, 'icefang');
    assert.equal(loadout.gloveId, 'none');
    assert.equal(loadout.ballSkinId, 'classic');
});

test('resolveMvpLoadout reads a remote MVP from the synced entity, ball always default', () => {
    const remotePlayers = new Map([
        ['peer-1', { name: 'Bob', team: 'blue', knifeId: 'prism', wearableLoadout: { gloves: 'gloves_kinetic' } }]
    ]);
    const game = { playerName: 'Ada', remotePlayers, bots: [] };
    const loadout = resolveMvpLoadout({ name: 'Bob', team: 'blue' }, { game, player: { team: 'red' }, store: null });
    assert.deepEqual(loadout, { knifeId: 'prism', gloveId: 'gloves_kinetic', ballSkinId: 'classic', team: 'blue' });
});

test('resolveMvpLoadout defaults an unknown remote glove to none', () => {
    const remotePlayers = new Map([
        ['peer-1', { name: 'Bob', team: 'blue', knifeId: 'prism', wearableLoadout: { gloves: 'none' } }]
    ]);
    const game = { playerName: 'Ada', remotePlayers, bots: [] };
    const loadout = resolveMvpLoadout({ name: 'Bob', team: 'blue' }, { game, player: {}, store: null });
    assert.equal(loadout.gloveId, 'none');
});

test('resolveMvpLoadout reads a bot MVP\'s knife but never gives it gloves or a ball skin', () => {
    const game = { playerName: 'Ada', remotePlayers: new Map(), bots: [{ name: 'Bot 1', team: 'red', knifeId: 'cleaver' }] };
    const loadout = resolveMvpLoadout({ name: 'Bot 1', team: 'red' }, { game, player: {}, store: null });
    assert.deepEqual(loadout, { knifeId: 'cleaver', gloveId: 'none', ballSkinId: 'classic', team: 'red' });
});

test('resolveMvpLoadout falls back to defaults for an MVP not found anywhere', () => {
    const game = { playerName: 'Ada', remotePlayers: new Map(), bots: [] };
    const loadout = resolveMvpLoadout({ name: 'Ghost', team: 'blue' }, { game, player: {}, store: null });
    assert.deepEqual(loadout, { knifeId: 'training', gloveId: 'none', ballSkinId: 'classic', team: 'blue' });
});
