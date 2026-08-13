import assert from 'node:assert/strict';
import test from 'node:test';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';
import { scaleDedupWindowMs } from '../js/combat.js';

class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        this.set(x, y, z);
    }

    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    normalize() {
        const length = Math.hypot(this.x, this.y, this.z) || 1;
        this.x /= length;
        this.y /= length;
        this.z /= length;
        return this;
    }

    distanceTo(other) {
        return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
    }

    copy(other) {
        return this.set(other.x, other.y, other.z);
    }
}

function fakeTimers() {
    const pending = [];
    return {
        setTimeout(callback, delay = 0) {
            pending.push({ callback, delay });
            return pending.length;
        },
        runAll() {
            pending.sort((a, b) => a.delay - b.delay);
            while (pending.length) pending.shift().callback();
        },
        pending
    };
}

function remoteAnimFixture() {
    const timers = fakeTimers();
    const audioCalls = [];
    const animatorCalls = [];
    const trailCalls = [];
    const remote = {
        attacking: false,
        attackType: null,
        attackTimer: 0,
        team: 'red',
        aimDir: new Vector3(0, 0, -1),
        animator: { play: name => animatorCalls.push(name) }
    };
    const context = {
        network: { isHost: false, playerId: 'local-player', peer: { id: 'local-peer' } },
        player: { attacking: false, attackType: null, attackTimer: 0 },
        remotePlayers: new Map([['remote-player', remote]]),
        ball: { active: true, addTrailDot: () => trailCalls.push('trail') },
        audio: {
            playSfx: (...args) => audioCalls.push(['sfx', ...args]),
            playDeflect: (...args) => audioCalls.push(['deflect', ...args])
        },
        juice: {
            sparks: () => animatorCalls.push('sparks'),
            burst: () => animatorCalls.push('burst')
        },
        rallyCount: 3,
        _applyRallyHeat: () => animatorCalls.push('heat')
    };
    const method = compileGameMethod('handleRemoteAttackAnim', {
        THREE: { Vector3 },
        setTimeout: timers.setTimeout
    });
    return { method, context, timers, audioCalls, animatorCalls, trailCalls, remote };
}

test('game-source extracts methods whose default parameters contain object literals', () => {
    const source = extractGameMethod('remoteAttack');
    assert.match(source, /^    remoteAttack\(playerId, data = \{\}, peerId = data\.peerId \|\| playerId\) \{/);
    assert.match(source, /setTimeout\(\(\) => \{ if \(p\) p\.attacking = false; \}, 300\);\s+\}$/);
});

test('local authoritative attack echo performs no input, timer, audio, or FX replay', () => {
    const fixture = remoteAnimFixture();
    fixture.method.call(fixture.context, {
        playerId: 'local-player',
        peerId: 'local-peer',
        attacking: true,
        action: 'stab',
        shot: 'flat',
        perfect: true,
        pos: { x: 1, y: 2, z: 3 }
    });

    assert.equal(fixture.context.player.attacking, false);
    assert.equal(fixture.context.player.attackType, null);
    assert.equal(fixture.context.rallyCount, 3);
    assert.equal(fixture.timers.pending.length, 0);
    assert.deepEqual(fixture.audioCalls, []);
    assert.deepEqual(fixture.animatorCalls, []);
    assert.deepEqual(fixture.trailCalls, []);
});

test('remote authoritative attack echo still animates, plays feedback, and clears its timer', () => {
    const fixture = remoteAnimFixture();
    fixture.method.call(fixture.context, {
        playerId: 'remote-player',
        attacking: true,
        action: 'slash',
        shot: 'flat',
        ax: 1,
        ay: 0,
        az: 0
    });

    assert.equal(fixture.remote.attacking, true);
    assert.equal(fixture.remote.attackType, 'slash');
    assert.equal(fixture.remote.attackTimer, 0.34);
    assert.deepEqual(fixture.animatorCalls, ['deflect', 'heat']);
    assert.deepEqual(fixture.audioCalls, [['sfx', 'tf2_hit', 0.15], ['deflect', 'flat']]);
    assert.equal(fixture.timers.pending.length, 9);

    fixture.timers.runAll();
    assert.equal(fixture.remote.attacking, false);
    assert.equal(fixture.trailCalls.length, 8);
});

function hostAttackFixture({ queued = false, alive = true, ballActive = true } = {}) {
    let now = 1000;
    const broadcasts = [];
    const timers = fakeTimers();
    const player = {
        name: 'Remote',
        team: 'red',
        peerId: 'remote-peer',
        queuedForNextRound: queued,
        alive,
        hp: alive ? 100 : 0,
        maxHp: 100,
        position: new Vector3(),
        aimDir: new Vector3(0, 0, -1),
        group: { visible: alive },
        attackType: 'slash',
        deflectPower: 1,
        animator: { play() {} },
        onSuccessfulDeflect() {}
    };
    const ball = {
        active: ballActive,
        mesh: { visible: ballActive },
        state: ballActive ? 'rally' : 'idle',
        position: new Vector3(),
        attackRange: 1,
        currentSpeed: 102,
        baseSpeed: 17,
        homingStrength: 0,
        _affixSplit: false,
        getPerfectTimingErrorMs: () => Infinity,
        deflectWithAim: () => ({ shot: 'flat' }),
        setTarget() {}
    };
    const context = {
        network: { isHost: true, broadcast: packet => broadcasts.push(packet) },
        remotePlayers: new Map([['remote-player', player]]),
        ball,
        experimentalNetcode: { enabled: false },
        _remotePerfectChains: new Map(),
        _lastRemoteAttack: null,
        _pendingLethalHit: null,
        _pendingLethalVictim: null,
        getAimedEnemy: () => null,
        _claimOpeningOwner() {},
        _pushDeflectHistory() {},
        _applyRallyHeat() {},
        scoreboard: { recordDeflection() {} },
        matchAnalytics: { recordDeflect() {} },
        audio: { playDeflect() {} },
        rallyCount: 0
    };
    const method = compileGameMethod('remoteAttack', {
        THREE: { Vector3 },
        performance: { now: () => now },
        setTimeout: timers.setTimeout,
        clearTimeout() {},
        scaleDedupWindowMs,
        normalizeNetcode: value => value,
        rewindSnapshot: () => null,
        normalizeGameplayDeflectTimingError: value => value,
        resolvePerfectDeflect: ({ chain }) => ({ tier: 'normal', chain })
    });
    const attack = (attackId, overrides = {}) => method.call(context, 'remote-player', {
        attackId,
        x: 0,
        y: 0,
        z: 0,
        bx: 0,
        by: 0,
        bz: 0,
        ax: 0,
        ay: 0,
        az: -1,
        action: 'slash',
        ...overrides
    }, 'remote-peer');
    return {
        context,
        player,
        ball,
        broadcasts,
        timers,
        attack,
        setNow(value) { now = value; }
    };
}

test('host accepts two unique remote attacks exactly at the speed-scaled dedup boundary', () => {
    const fixture = hostAttackFixture();
    fixture.attack('attack-1');
    fixture.setNow(1030);
    fixture.attack('attack-2');

    assert.equal(fixture.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 2);
    assert.equal(fixture.context.rallyCount, 2);
});

test('host rejects remote attacks inside the dedup window and duplicate attack ids', () => {
    const withinWindow = hostAttackFixture();
    withinWindow.attack('attack-1');
    withinWindow.setNow(1029);
    withinWindow.attack('attack-2');
    assert.equal(withinWindow.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 1);

    const duplicateId = hostAttackFixture();
    duplicateId.attack('attack-1');
    duplicateId.setNow(1100);
    duplicateId.attack('attack-1');
    assert.equal(duplicateId.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 1);
});

test('host rejects a queued remote player before mutating attack state', () => {
    const fixture = hostAttackFixture({ queued: true });
    fixture.attack('queued-attack');
    assert.equal(fixture.player.attacking, undefined);
    assert.equal(fixture.broadcasts.length, 0);
    assert.equal(fixture.context.rallyCount, 0);
    assert.equal(fixture.timers.pending.length, 0);
});

test('host keeps late-deflect grace behavior for inactive ball and dead remote player', () => {
    const fixture = hostAttackFixture({ alive: false, ballActive: false });
    fixture.attack('late-deflect');

    assert.equal(fixture.player.alive, true);
    assert.equal(fixture.player.hp, fixture.player.maxHp);
    assert.equal(fixture.player.group.visible, true);
    assert.equal(fixture.ball.active, true);
    assert.equal(fixture.ball.mesh.visible, true);
    assert.equal(fixture.ball.state, 'rally');
    assert.equal(fixture.broadcasts.filter(packet => packet.type === 'playerHit').length, 1);
    assert.equal(fixture.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 1);
});

test('host reconciles an implausible client ball snapshot to its authoritative ball', () => {
    const fixture = hostAttackFixture();
    fixture.attack('implausible-snapshot', { bx: 300, by: 0, bz: 0 });

    assert.equal(fixture.ball.position.x, 0);
    assert.equal(fixture.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 1);
});

test('host accepts a close high-ping predicted snapshot within its bounded tolerance', () => {
    const fixture = hostAttackFixture();
    fixture.attack('high-ping-snapshot', {
        x: 6, y: 0, z: 0,
        bx: 8, by: 0, bz: 0,
        ping: 250
    });

    assert.equal(fixture.ball.position.x, 8);
    assert.equal(fixture.broadcasts.filter(packet => packet.type === 'remoteAttackAnim').length, 1);
});

test('host rejects malformed direct remote attacks before dedup or ball mutation', () => {
    const fixture = hostAttackFixture();
    fixture.attack('bad-direct-attack', { ax: 0, ay: 0, az: 0 });
    fixture.attack('bad-snapshot', { bx: Infinity });
    fixture.attack('outside-world', { x: 513 });

    assert.equal(fixture.ball.position.x, 0);
    assert.equal(fixture.broadcasts.length, 0);
    assert.equal(fixture.context.rallyCount, 0);
});
