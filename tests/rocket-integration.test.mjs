import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CHARACTERS } from '../js/characters.js';

const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');

test('Soldier exposes a bounded rocket-jump loadout', () => {
    const soldier = CHARACTERS.soldier;
    assert.equal(soldier.passive, 'rocket_jump');
    assert.ok(soldier.maxHp >= 80 && soldier.maxHp <= 150);
    assert.ok(soldier.speed >= 8 && soldier.speed <= 13);
    assert.ok(soldier.price > 0);
});

test('rocket fire audio is bundled as a non-empty local asset', async () => {
    const audio = await readFile(new URL('../sfx/rocket_fire.sfx', import.meta.url));
    assert.ok(audio.length > 10_000);
    assert.notEqual(audio.subarray(0, 8).toString('utf8').toLowerCase(), '<!doctype');
});

test('Soldier rocket remains a self-movement tool', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
    const rocketUpdate = source.slice(source.indexOf('    _updateRockets(dt) {'), source.indexOf('    updateMapHazards(dt) {'));
    const rocketExplosion = source.slice(source.indexOf('    _explodeRocket(rocket) {'), source.indexOf('    _clearRockets() {'));

    assert.ok(!rocketUpdate.includes('segmentIntersectsSphere'));
    assert.ok(!rocketExplosion.includes('takeDamage'));
    assert.ok(!rocketExplosion.includes('recordDeath'));
    assert.ok(rocketExplosion.includes('const owner = rocket.owner'));
});

test('Soldier uses the launcher viewmodel instead of a knife point', async () => {
    const source = playerSource;
    assert.ok(source.includes("createRocketLauncherModel(this.team)"));
    assert.ok(source.includes("if (this.charId === 'soldier')"));
    assert.match(source, /knifeGroup\.scale\.setScalar\(0\.62\)/);
});

test('sv_hand shows only the selected weapon and hides the whole viewmodel when off', () => {
    const method = playerSource.slice(
        playerSource.indexOf('    setHandVisible(on) {'),
        playerSource.indexOf('    _applyKnifeIdlePose() {')
    );
    const body = method.slice(method.indexOf('{') + 1, method.lastIndexOf('}'));
    const setHandVisible = new Function('on', body);
    const player = {
        armGroup: { visible: false },
        armMesh: { visible: true },
        handMesh: { visible: true },
        gloveMesh: { visible: true },
        knifeGroup: { visible: false }
    };

    setHandVisible.call(player, true);
    assert.equal(player.armGroup.visible, true);
    assert.equal(player.knifeGroup.visible, true);
    assert.equal(player.armMesh.visible, false);
    assert.equal(player.handMesh.visible, false);
    assert.equal(player.gloveMesh.visible, false);

    setHandVisible.call(player, false);
    assert.equal(player.armGroup.visible, false);
    assert.equal(player.knifeGroup.visible, false);
});

test('endgame winners use rockets only', async () => {
    const source = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

    assert.ok(!source.includes('createKnucklesModel'));
    assert.ok(!source.includes("['fists', 'rocket']"));
    assert.match(source, /WINNER LOADOUT: ROCKET/);
    assert.match(source, /const weapons = \[\['rocket', '2', 'ROCKET'\]\];/);
    assert.match(source, /launcher\.scale\.setScalar\(0\.74\)/);
});
