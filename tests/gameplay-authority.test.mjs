import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGameMethod } from './game-source.mjs';
import { SKILLS, tickSkillCooldowns, useSkill } from '../js/skills.js';

const STATES = { PLAYING: 'PLAYING', COUNTDOWN: 'COUNTDOWN', ROUND_END: 'ROUND_END' };

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() {
        const length = Math.sqrt(this.lengthSq()) || 1;
        return this.set(this.x / length, this.y / length, this.z / length);
    }
    multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
}

function remoteFixture() {
    const effects = [];
    const rockets = [];
    const blackHoles = [];
    const remote = {
        alive: true, hp: 50, maxHp: 100, shield: 0, team: 'red',
        skillCooldowns: {}, position: new Vector3(), aimDir: new Vector3(0, 0, -1),
        group: { visible: true, rotation: {} },
        getPosition() { return this.position; }
    };
    const game = {
        state: STATES.PLAYING,
        network: { isHost: true, broadcastSkillEffect: (...args) => effects.push(args) },
        remotePlayers: new Map([['remote', remote]]),
        _remoteRocketCooldowns: new Map(),
        ball: { active: true, currentSpeed: 20, velocity: new Vector3(0, 0, 20), targetPlayer: null },
        _fireRocket: (...args) => rockets.push(args),
        spawnBlackHole: () => blackHoles.push(true)
    };
    const use = compileGameMethod('handleSkillUse', {
        STATES, SKILLS, useSkill, THREE: { Vector3 }, performance: { now: () => 1000 }
    });
    const tick = compileGameMethod('_updateRemoteSkillCooldowns', { STATES, tickSkillCooldowns });
    return { game, remote, effects, rockets, blackHoles,
        use: data => use.call(game, 'remote', data), tick: dt => tick.call(game, dt) };
}

test('remote skills reject dead, queued, wrong-state, non-host and competitive use without effects', () => {
    for (const mutate of [
        f => { f.remote.alive = false; },
        f => { f.remote.queuedForNextRound = true; },
        ...['MENU', 'LOBBY', 'COUNTDOWN', 'PAUSED', 'ROUND_END', 'CELEBRATION', 'GAME_OVER']
            .map(state => f => { f.game.state = state; }),
        f => { f.game.network.isHost = false; },
        f => { f.game._skillsDisabled = true; }
    ]) {
        for (const skill of ['heal', 'blackhole', 'soldier_rocket']) {
            const f = remoteFixture();
            f.remote.charId = 'soldier';
            mutate(f);
            f.use({ skill, ax: 1, ay: 0, az: 0 });
            assert.equal(f.remote.hp, 50);
            assert.equal(Object.keys(f.remote.skillCooldowns).length, 0);
            assert.equal(f.game._remoteRocketCooldowns.size, 0);
            assert.equal(f.effects.length + f.rockets.length + f.blackHoles.length, 0);
        }
    }
});

test('unknown and inherited skill names cannot consume cooldowns or broadcast effects', () => {
    for (const skill of ['unknown', '__proto__', 'constructor', '', null, {}, 12]) {
        const f = remoteFixture();
        f.use({ skill });
        assert.equal(Object.keys(f.remote.skillCooldowns).length, 0);
        assert.equal(f.effects.length, 0);
        assert.equal(f.remote.hp, 50);
    }
});

test('valid non-default remote skills remain usable without an unsynchronized loadout slot', () => {
    const f = remoteFixture();
    f.use({ skill: 'heal' });
    assert.equal(f.remote.hp, 75);
    assert.equal(f.remote.skillCooldowns.heal, 52);
    assert.equal(f.effects.length, 1);
    f.use({ skill: 'heal' });
    assert.equal(f.remote.hp, 75);
    assert.equal(f.effects.length, 1);
    f.tick(51);
    f.use({ skill: 'heal' });
    assert.equal(f.effects.length, 1);
    f.tick(1);
    f.use({ skill: 'heal' });
    assert.equal(f.remote.hp, 100);
    assert.equal(f.remote.skillCooldowns.heal, 52);
    assert.equal(f.effects.length, 2);
});

test('only the host live gameplay clock advances living remote cooldowns', () => {
    const f = remoteFixture();
    f.remote.skillCooldowns.heal = 52;
    const update = compileGameMethod('updatePlaying');
    f.game._updateRemoteSkillCooldowns = dt => f.tick(dt);
    f.game.scoreboard = { updateTimer() {}, isTimeUp: () => true, redScore: 1, blueScore: 0 };
    f.game._updateHotPotato = () => false;
    f.game.endGame = () => {};
    update.call(f.game, 0.5);
    assert.equal(f.remote.skillCooldowns.heal, 51.5);
    for (const dt of [0, -1, NaN, Infinity]) f.tick(dt);
    assert.equal(f.remote.skillCooldowns.heal, 51.5);
    f.game.state = STATES.ROUND_END;
    f.tick(1);
    f.game.state = STATES.PLAYING;
    f.game.network.isHost = false;
    f.tick(1);
    f.game.network.isHost = true;
    f.remote.alive = false;
    f.tick(1);
    f.remote.alive = true;
    f.remote.queuedForNextRound = true;
    f.tick(1);
    assert.equal(f.remote.skillCooldowns.heal, 51.5);
});

test('soldier rockets retain their character and cooldown contract outside the regular skill catalog', () => {
    const f = remoteFixture();
    f.use({ skill: 'soldier_rocket', ax: 1, ay: 0, az: 0 });
    assert.equal(f.rockets.length, 0);
    f.remote.charId = 'soldier';
    f.use({ skill: 'soldier_rocket', ax: NaN, ay: 0, az: 0 });
    assert.equal(f.game._remoteRocketCooldowns.size, 0);
    f.use({ skill: 'soldier_rocket', ax: 1, ay: 0, az: 0 });
    f.use({ skill: 'soldier_rocket', ax: 1, ay: 0, az: 0 });
    assert.equal(f.rockets.length, 1);
    assert.equal(f.effects.length, 1);
    assert.equal(f.game._remoteRocketCooldowns.get('remote'), 1820);
});

function missFixture(network = null) {
    const messages = [];
    let damageCalls = 0;
    const player = {
        hp: 100, maxHp: 100, shield: 0, alive: true, attacking: true,
        attackDuration: 0.3, knifeAttackType: 'slash', position: new Vector3(),
        takeDamage(amount) {
            damageCalls++;
            const absorbed = Math.min(this.shield, amount);
            this.shield -= absorbed;
            this.hp = Math.max(0, this.hp - (amount - absorbed));
            return this.hp <= 0;
        },
        die() { this.alive = false; }
    };
    const game = {
        state: STATES.PLAYING, player, network,
        ball: { active: true, targetPlayer: player, position: new Vector3(20, 0, 0),
            velocity: new Vector3(-20, 0, 0), deactivate() { this.active = false; } },
        ui: { showMessage: text => messages.push(text) }, audio: {},
        _applyAuthoritativeHitDamage: compileGameMethod('_applyAuthoritativeHitDamage'),
        _applyMissedDeflectPenalty: compileGameMethod('_applyMissedDeflectPenalty', { STATES, MISSED_DEFLECT_DAMAGE: 12 }),
        _clearLocalDeflectAttempt: compileGameMethod('_clearLocalDeflectAttempt'),
        _updateLocalDeflectAttempt: compileGameMethod('_updateLocalDeflectAttempt', { STATES, Math }),
        _checkTeamElimination() { throw new Error('a nonlethal or network miss must not score a round'); }
    };
    return { game, player, messages, damageCalls: () => damageCalls };
}

test('both connected host and guest get missed-swing feedback without local damage or round mutations', () => {
    for (const isHost of [false, true]) {
        const f = missFixture({ connected: true, isHost });
        f.game._oneHitKill = true;
        f.game._updateLocalDeflectAttempt(1 / 60);
        f.game._updateLocalDeflectAttempt(0.4);
        assert.equal(f.player.hp, 100);
        assert.equal(f.player.alive, true);
        assert.equal(f.game.ball.active, true);
        assert.equal(f.game.state, STATES.PLAYING);
        assert.equal(f.damageCalls(), 0);
        assert.deepEqual(f.messages, ['EARLY — WAIT FOR THE BALL']);
    }
});

test('offline miss damage uses one authoritative hit and respects the Instagib shield invariant', () => {
    const normal = missFixture({ connected: false, isHost: false });
    assert.equal(normal.game._applyMissedDeflectPenalty(), false);
    assert.equal(normal.player.hp, 88);
    assert.equal(normal.damageCalls(), 1);
    const lethal = missFixture();
    lethal.game._oneHitKill = true;
    lethal.player.hp = lethal.player.maxHp = 1;
    lethal.player.shield = 25;
    lethal.game._checkTeamElimination = () => false;
    assert.equal(lethal.game._applyMissedDeflectPenalty(), true);
    assert.equal(lethal.player.hp, 0);
    assert.equal(lethal.player.alive, false);
    assert.equal(lethal.player.shield, 24, 'defenses are not erased to force a death');
    assert.equal(lethal.game.ball.active, false);
    assert.equal(lethal.damageCalls(), 1);
});

function positionFixture({ isHost = true, alive = true, hp = 40, queued = false } = {}) {
    const f = remoteFixture();
    const broadcasts = [];
    const moves = [];
    Object.assign(f.remote, { alive, hp, queuedForNextRound: queued });
    Object.assign(f.game.network, { isHost, playerId: 'local', peer: { id: 'local-peer' }, broadcast: packet => broadcasts.push(packet) });
    f.game.addRemotePlayer = () => f.remote;
    f.game._pushPosBuffer = (...args) => moves.push(args);
    const update = compileGameMethod('updateRemotePlayer', { performance: { now: () => 1000 } });
    return { ...f, broadcasts, moves,
        position: data => update.call(f.game, 'remote', { x: 1, y: 0, z: 2, ...data }, 'remote-peer') };
}

test('host ignores reported HP/death while still accepting movement and relaying its authoritative life state', () => {
    const f = positionFixture();
    f.position({ hp: 100, alive: false });
    assert.equal(f.remote.hp, 40);
    assert.equal(f.remote.alive, true);
    assert.equal(f.remote.group.visible, true);
    assert.equal(f.moves.length, 1);
    assert.equal(f.broadcasts[0].hp, 40);
    assert.equal(f.broadcasts[0].alive, true);
});

test('a client position report cannot revive an eliminated player or undo a host-restored round start', () => {
    const f = positionFixture({ alive: false, hp: 0 });
    f.position({ hp: 100, alive: true });
    assert.equal(f.remote.hp, 0);
    assert.equal(f.remote.alive, false);
    assert.equal(f.remote.group.visible, false);
    f.remote.alive = true; // existing host round-start/reconnect restoration
    f.remote.hp = 100;
    f.position({ hp: 0, alive: false });
    assert.equal(f.remote.hp, 100);
    assert.equal(f.remote.alive, true);
});

test('guests apply host life snapshots and omitted delta fields never revive a dead remote', () => {
    const f = positionFixture({ isHost: false, alive: false, hp: 0 });
    f.position({});
    assert.equal(f.remote.alive, false);
    assert.equal(f.remote.hp, 0);
    f.position({ hp: 75, alive: true });
    assert.equal(f.remote.alive, true);
    assert.equal(f.remote.hp, 75);
    assert.equal(f.remote.group.visible, true);
    assert.equal(f.broadcasts.length, 0);
});

test('queued late joiners stay inactive regardless of movement life claims', () => {
    const f = positionFixture({ queued: true });
    f.position({ hp: 100, alive: true });
    assert.equal(f.remote.alive, false);
    assert.equal(f.remote.group.visible, false);
    assert.equal(f.moves.length, 0);
    assert.equal(f.broadcasts.length, 0);
});
