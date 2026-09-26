// Remote players recolour on a team change: a lobby switch or a host bot rebalance
// reaches other clients through lobbyState / botSync, and the existing entity must go
// through its setTeam (rig body + name pill), not a bare `p.team =` write. The pill is
// a per-player CanvasTexture + SpriteMaterial, freed on a redraw and on removal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isTeam } from '../js/team-switch.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const STATES = { MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN', PLAYING: 'PLAYING' };
const RED_PILL = 0xff5577;
const BLUE_PILL = 0x55aaff;

// ------------------------------------------------------------------ counting stubs

function makeWorld() {
    const counts = { mapsCreated: 0, mapsDisposed: 0, materialsCreated: 0, materialsDisposed: 0, rigTeams: [] };
    const textures = [];
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        setScalar(v) { return this.set(v, v, v); }
        copy(o) { return this.set(o.x, o.y, o.z); }
        add(o) { return this.set(this.x + o.x, this.y + o.y, this.z + o.z); }
        clone() { return new Vector3(this.x, this.y, this.z); }
    }
    class Object3D {
        constructor() { this.children = []; this.position = new Vector3(); this.rotation = new Vector3(); this.scale = new Vector3(1, 1, 1); this.visible = true; }
        add(child) { this.children.push(child); }
        remove(child) { this.children = this.children.filter(c => c !== child); }
        traverse(fn) { fn(this); this.children.forEach(c => c.traverse?.(fn)); }
    }
    class SpriteMaterial {
        constructor(options) { Object.assign(this, options); this.disposed = 0; counts.materialsCreated++; }
        dispose() { this.disposed++; counts.materialsDisposed++; }
    }
    class Sprite extends Object3D {
        constructor(material) { super(); this.material = material; }
    }
    const THREE = { Vector3, Group: Object3D, Sprite, SpriteMaterial };
    const makeNameLabelTexture = (name, colour) => {
        counts.mapsCreated++;
        const texture = { name, colour, disposed: 0, dispose() { this.disposed++; counts.mapsDisposed++; } };
        textures.push(texture);
        return texture;
    };
    const globals = {
        THREE,
        createCharacterRig: () => ({
            root: new Object3D(),
            sockets: { handR: new Object3D() },
            setTeam(team) { counts.rigTeams.push(team); },
            setCharacter() {},
            dispose() {}
        }),
        createKnifeModel: () => new Object3D(),
        KNIVES: { training: {} },
        createCharacterAnimator: () => ({ play() {} }),
        normalizeAvatarModel: model => model || 'classic',
        applyEntityCosmetics() {},
        disposeObject3D() {},
        clearTimeout() {}
    };
    const game = {
        network: { isHost: false, playerId: 'me', peer: { id: 'me-peer' } },
        player: { team: 'red' },
        remotePlayers: new Map(),
        renderer: {
            scene: { add() {}, remove() {} },
            createTargetOutline: () => ({ userData: { setVisible() {}, dispose() {} } })
        },
        arena: { getPlayerSpawn: team => new Vector3(0, 1.2, team === 'red' ? -10 : 10) },
        scoreboard: { addPlayer() {}, removePlayer() {} },
        _killStreakTimers: new Map(),
        _killStreaks: new Map(),
        updateLobbyUI() {},
        _makeNameLabelTexture: makeNameLabelTexture
    };
    for (const name of ['_createRemotePlayer', '_refreshRemoteLabel', 'removeRemotePlayer']) {
        game[name] = compileGameMethod(name, globals);
    }
    game.applyLobbyState = compileGameMethod('applyLobbyState', {
        STATES, isTeam, document: { getElementById: () => null },
        applyEntityCosmetics() {}, normalizeWearableLoadout: loadout => loadout
    });
    game.applyBotSync = compileGameMethod('applyBotSync', { isTeam, performance: { now: () => 0 } });
    game._pushPosBuffer = () => {};
    // addRemotePlayer sits at column 0 in js/game.js (extractGameMethod cannot reach it):
    // the same existing-or-create contract, minus the rally-duel cap.
    game.addRemotePlayer = function (playerId, name, team, avatar, peerId) {
        let p = this.remotePlayers.get(playerId);
        if (p) { p.peerId = peerId; return p; }
        p = this._createRemotePlayer(playerId, name, team || 'red', avatar);
        p.playerId = playerId;
        p.peerId = peerId;
        this.remotePlayers.set(playerId, p);
        return p;
    };
    return { game, counts, textures };
}

// A spy entity: records setTeam calls and applies them like the real one.
function spyEntity(name, team, extra = {}) {
    return {
        name, team, calls: [], alive: true, group: { visible: true }, rig: { setCharacter() {} },
        setTeam(next) { this.calls.push(next); this.team = next; },
        ...extra
    };
}

// ------------------------------------------------------------------ setTeam routing

test('lobbyState: an existing remote human moved red -> blue gets setTeam(blue) once; a repeat roster 0 times', () => {
    const { game } = makeWorld();
    const ana = spyEntity('Ana', 'red');
    game.remotePlayers.set('p-ana', ana);
    const roster = { players: [{ playerId: 'p-ana', peerId: 'peer-ana', name: 'Ana', team: 'blue' }] };
    game.applyLobbyState(roster);
    assert.deepEqual(ana.calls, ['blue']);
    assert.equal(ana.team, 'blue');
    game.applyLobbyState(roster);
    game.applyLobbyState(structuredClone(roster));
    assert.deepEqual(ana.calls, ['blue'], 'an unchanged roster never calls setTeam');
    assert.equal(game.remotePlayers.get('p-ana'), ana, 'the entity is kept, not rebuilt');
});

test('lobbyState: an existing bot: entity moved red -> blue gets setTeam(blue) once; a repeat roster 0 times', () => {
    const { game } = makeWorld();
    const bot = spyEntity('Bot-1', 'red', { isBotEntity: true });
    game.remotePlayers.set('bot:Bot-1', bot);
    const roster = { players: [{ name: 'Bot-1', isBot: true, team: 'blue' }] };
    game.applyLobbyState(roster);
    assert.deepEqual(bot.calls, ['blue']);
    game.applyLobbyState(roster);
    assert.deepEqual(bot.calls, ['blue']);
});

test('botSync: a bot whose bd.team changes gets setTeam once; the 30 Hz repeats 0 times', () => {
    const { game } = makeWorld();
    const bot = spyEntity('Bot-1', 'red', { isBotEntity: true });
    game.remotePlayers.set('bot:Bot-1', bot);
    const sync = team => ({ t: 0, bots: [{ name: 'Bot-1', team, x: 0, y: 0, z: 0, alive: true }] });
    game.applyBotSync(sync('red'));
    assert.deepEqual(bot.calls, [], 'same team: no call');
    game.applyBotSync(sync('blue'));
    for (let i = 0; i < 30; i++) game.applyBotSync(sync('blue'));
    assert.deepEqual(bot.calls, ['blue']);
    game.applyBotSync(sync(undefined));
    assert.equal(bot.team, 'blue', 'a packet without a team keeps the current one');
    assert.deepEqual(bot.calls, ['blue']);
});

test('stub entities without setTeam still take the team; bad teams are ignored', () => {
    const { game } = makeWorld();
    const plain = { name: 'Plain', team: 'red', group: { visible: true } };
    const bot = { name: 'B', team: 'red', isBotEntity: true, group: { visible: true } };
    game.remotePlayers.set('p-plain', plain);
    game.remotePlayers.set('bot:B', bot);
    game.applyLobbyState({ players: [
        { playerId: 'p-plain', name: 'Plain', team: 'blue' },
        { name: 'B', isBot: true, team: 'blue' }
    ] });
    assert.equal(plain.team, 'blue');
    assert.equal(bot.team, 'blue');
    game.applyLobbyState({ players: [
        { playerId: 'p-plain', name: 'Plain', team: 'green' },
        { name: 'B', isBot: true }
    ] });
    assert.equal(plain.team, 'blue');
    assert.equal(bot.team, 'blue');
});

// ------------------------------------------------------------------ name pill

test('_refreshRemoteLabel: disposes the old pill once and draws a new one in the team colour', () => {
    const { game, counts } = makeWorld();
    const old = { disposed: 0, dispose() { this.disposed++; } };
    const entity = { name: 'Ana', team: 'blue', labelSprite: { material: { map: old, needsUpdate: false } } };
    game._refreshRemoteLabel(entity);
    assert.equal(old.disposed, 1);
    const fresh = entity.labelSprite.material.map;
    assert.notEqual(fresh, old);
    assert.equal(fresh.colour, BLUE_PILL);
    assert.equal(fresh.name, 'Ana');
    assert.equal(entity.labelSprite.material.needsUpdate, true);
    entity.team = 'red';
    game._refreshRemoteLabel(entity);
    assert.equal(fresh.disposed, 1);
    assert.equal(entity.labelSprite.material.map.colour, RED_PILL);
    assert.equal(counts.mapsCreated, 2);
    assert.doesNotThrow(() => game._refreshRemoteLabel({ name: 'NoLabel', team: 'red' }));
});

test('a real remote entity: setTeam(blue) recolours the rig and redraws the pill in 0x55aaff', () => {
    const { game, counts } = makeWorld();
    const p = game._createRemotePlayer('p-ana', 'Ana', 'red', null);
    const firstPill = p.labelSprite.material.map;
    assert.equal(firstPill.colour, RED_PILL);
    p.setTeam('blue');
    assert.equal(p.team, 'blue');
    assert.equal(p._teamColor, 0x3355cc);
    assert.deepEqual(counts.rigTeams, ['blue']);
    assert.equal(firstPill.disposed, 1, 'the old pill texture is disposed once');
    assert.notEqual(p.labelSprite.material.map, firstPill);
    assert.equal(p.labelSprite.material.map.colour, BLUE_PILL);
    assert.equal(p.labelSprite.material.needsUpdate, true);
    p.setTeam('blue');
    assert.deepEqual(counts.rigTeams, ['blue'], 'same team: no rig call');
    assert.equal(counts.mapsCreated, 2, 'same team: no redraw');
});

test('client B sees client A switch to blue: body and pill recolour through lobbyState', () => {
    const { game, counts } = makeWorld();
    const roster = team => ({ players: [
        { playerId: 'me', peerId: 'me-peer', name: 'Me', team: 'red' },
        { playerId: 'p-a', peerId: 'peer-a', name: 'A', team }
    ] });
    game.applyLobbyState(roster('red'), { deferLocalPlayer: true });
    const a = game.remotePlayers.get('p-a');
    assert.equal(a.labelSprite.material.map.colour, RED_PILL);
    game.applyLobbyState(roster('blue'), { deferLocalPlayer: true });
    assert.equal(game.remotePlayers.get('p-a'), a);
    assert.equal(a.team, 'blue');
    assert.deepEqual(counts.rigTeams, ['blue']);
    assert.equal(a.labelSprite.material.map.colour, BLUE_PILL);
    game.applyLobbyState(roster('blue'), { deferLocalPlayer: true });
    assert.deepEqual(counts.rigTeams, ['blue']);
    assert.equal(counts.mapsCreated, 2);
});

test('20 create/removeRemotePlayer cycles free every pill texture and SpriteMaterial', () => {
    const { game, counts, textures } = makeWorld();
    for (let i = 0; i < 20; i++) {
        const id = `p-${i}`;
        const p = game.addRemotePlayer(id, `P${i}`, i % 2 ? 'blue' : 'red', null, id);
        if (i % 3 === 0) p.setTeam(p.team === 'red' ? 'blue' : 'red');
        game.removeRemotePlayer(id);
    }
    assert.equal(game.remotePlayers.size, 0);
    assert.equal(counts.materialsCreated, 20);
    assert.equal(counts.materialsDisposed, counts.materialsCreated);
    assert.equal(counts.mapsCreated, 27, '20 pills + 7 team redraws');
    assert.equal(counts.mapsDisposed, counts.mapsCreated);
    assert.ok(textures.every(texture => texture.disposed === 1), 'each texture is disposed exactly once');
});

// ------------------------------------------------------------------ source

test('source: no bare team writes for existing entities, no dead CylinderGeometry recolour', () => {
    assert.doesNotMatch(gameSource, /p\.team = pl\.team/);
    assert.doesNotMatch(gameSource, /p\.team = bd\.team/);
    assert.doesNotMatch(extractGameMethod('applyLobbyState'), /CylinderGeometry/);
    for (const name of ['applyLobbyState', 'applyBotSync']) {
        assert.match(extractGameMethod(name), /if \(typeof p\.setTeam === 'function'\) p\.setTeam\(nextTeam\);/, name);
    }
    const create = extractGameMethod('_createRemotePlayer');
    assert.match(create, /setTeam\(nextTeam\) \{\s*if \(nextTeam === this\.team\) return;/);
    assert.match(create, /game\._refreshRemoteLabel\(this\);/);
    const remove = extractGameMethod('removeRemotePlayer');
    assert.match(remove, /p\.labelSprite\?\.material\?\.map\?\.dispose\?\.\(\);/);
    assert.match(remove, /p\.labelSprite\?\.material\?\.dispose\?\.\(\);/);
});
