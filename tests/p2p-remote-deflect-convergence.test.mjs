import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { isNewerSequence, Network } from '../js/network.js';
import { compileGameMethod } from './game-source.mjs';

// ball.js imports Three.js, so compile its pure smoothing helper from the shipped
// source just as game-source.mjs compiles Game methods for node:test.
function compileBallHelper(name) {
    const source = readFileSync(new URL('../js/ball.js', import.meta.url), 'utf8');
    const signature = new RegExp(`export function ${name}\\([^\\n]*\\) \\{`, 'm').exec(source);
    assert.ok(signature, `Ball.${name} method not found`);
    const start = signature.index;
    const bodyStart = start + signature[0].lastIndexOf('{');
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) {
            const helper = source.slice(start, index + 1).replace('export function ', 'function ');
            return runInNewContext(`
                const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
                const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
                ${helper}
                ${name};
            `);
        }
    }
    assert.fail(`Ball.${name} method body is incomplete`);
}

const networkBallStep = compileBallHelper('networkBallStep');

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

    copy(other) {
        return this.set(other.x, other.y, other.z);
    }

    clone() {
        return new Vector3(this.x, this.y, this.z);
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
}

function makeTrace({ currentSpeed, ping = 0 } = {}) {
    let now = 10_000;
    const timers = [];
    const remoteAnimations = [];
    const encodedBallStates = [];
    const remote = {
        name: 'Remote',
        team: 'red',
        peerId: 'remote-peer',
        queuedForNextRound: false,
        alive: true,
        hp: 100,
        maxHp: 100,
        position: new Vector3(),
        aimDir: new Vector3(1, 0, 0),
        group: { visible: true },
        deflectPower: 1,
        animator: { play() {} },
        onSuccessfulDeflect() {}
    };
    const hostBall = {
        active: true,
        mesh: { visible: true },
        state: 'rally',
        position: new Vector3(),
        velocity: new Vector3(currentSpeed, 0, 0),
        attackRange: 1,
        currentSpeed,
        baseSpeed: 17,
        homingStrength: 0,
        _affixSplit: false,
        targetPlayer: null,
        getPerfectTimingErrorMs: () => Infinity,
        // A minimal deterministic stand-in for Ball.deflectWithAim: the host
        // takes the accepted contact point, then launches a visible next leg.
        deflectWithAim(_origin, aim) {
            this.position.x += aim.x * 0.75;
            this.position.y += aim.y * 0.75;
            this.position.z += aim.z * 0.75;
            this.velocity.set(aim.x * this.currentSpeed, aim.y * this.currentSpeed, aim.z * this.currentSpeed);
            return { shot: 'flat' };
        },
        setTarget(target) {
            this.targetPlayer = target || null;
        }
    };
    const hostGame = {
        remotePlayers: new Map([['remote-player', remote]]),
        ball: hostBall,
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
    const host = new Network(hostGame);
    host.isHost = true;
    host.connections.set('remote-peer', { _admitted: true, open: true });
    host.peerToPlayerId.set('remote-peer', 'remote-player');
    host.broadcast = packet => remoteAnimations.push(packet);
    host.broadcastBinary = buffer => encodedBallStates.push(buffer);
    hostGame.network = host;
    hostGame._isDeflectFacingBall = compileGameMethod('_isDeflectFacingBall', {
        DEFLECT_MIN_FACING_DOT: 0.15,
        Math
    });
    hostGame.remoteAttack = compileGameMethod('remoteAttack', {
        THREE: { Vector3 },
        performance: { now: () => now },
        setTimeout: (callback, delay = 0) => timers.push({ callback, delay }),
        clearTimeout() {},
        scaleDedupWindowMs: (base, speed, baseSpeed) => base * Math.max(0.2, Math.min(1, baseSpeed / speed)),
        normalizeNetcode: value => value,
        rewindSnapshot: () => null,
        normalizeGameplayDeflectTimingError: value => value,
        resolvePerfectDeflect: ({ chain }) => ({ tier: 'normal', chain })
    });

    const clientBall = {
        active: true,
        mesh: { visible: true },
        state: 'rally',
        // Start far away to prove that authoritative packets correct a bad local prediction.
        position: new Vector3(-40, 0, 0),
        velocity: new Vector3(),
        currentSpeed,
        setTarget(target) {
            this.targetPlayer = target || null;
        }
    };
    const clientGame = {
        ball: clientBall,
        remotePlayers: new Map([['remote-player', remote]]),
        player: { name: 'Local' },
        playerName: 'Local',
        bots: [],
        currentBallAffix: null,
        ui: { updateBallAffix() {} }
    };
    const client = new Network(clientGame);
    client.isHost = false;
    client.hostConn = { peer: 'host-peer' };
    clientGame.network = client;
    clientGame.updateBallFromNetwork = compileGameMethod('updateBallFromNetwork', {
        performance: { now: () => now },
        isNewerSequence
    });
    clientGame.invokeBallSmoothing = compileGameMethod('invokeBallSmoothing', {
        performance: { now: () => now },
        networkBallStep
    });

    function sendAttack(id, { snapshotOffset = 0.5, attackOffset = 0, packetPing = ping } = {}) {
        const packet = {
            type: 'attack',
            attackId: id,
            name: 'Remote',
            x: hostBall.position.x + attackOffset,
            y: hostBall.position.y,
            z: hostBall.position.z,
            bx: hostBall.position.x + snapshotOffset,
            by: hostBall.position.y,
            bz: hostBall.position.z,
            ax: 1,
            ay: 0,
            az: 0,
            action: 'slash',
            ping: packetPing
        };
        assert.equal(host._validateMsg(packet), true, `${id} is sender-valid`);
        host.handleMessage(packet, 'remote-peer');
        host.broadcastBallState(hostBall, remoteAnimations.length);
        const encoded = encodedBallStates.at(-1);
        assert.ok(encoded instanceof Uint8Array, `${id} broadcasts an authoritative binary ball state`);
        client.handleMessage(encoded, 'host-peer');
        // Normal snapshots smooth; a 40-unit bad local prediction snaps directly to host.
        clientGame.invokeBallSmoothing(0.05);
        const authoritative = host._decodeBinary(encoded);
        return { packet, authoritative };
    }

    return {
        host,
        client,
        clientGame,
        hostGame,
        hostBall,
        clientBall,
        remoteAnimations,
        encodedBallStates,
        sendAttack,
        setNow(value) { now = value; },
        advance(ms) { now += ms; },
        timers
    };
}

function traceFiveDeflects({ currentSpeed, ping }) {
    const trace = makeTrace({ currentSpeed, ping });
    const packets = [];
    for (let index = 1; index <= 5; index++) {
        packets.push(trace.sendAttack(`deflect-${index}`));
        trace.advance(120);
    }
    return { trace, packets };
}

for (const scenario of [
    { name: 'normal rally', currentSpeed: 17, ping: 0 },
    { name: 'high rally at 250ms', currentSpeed: 102, ping: 250 }
]) {
    test(`five unique remote deflects converge through the ${scenario.name} authority trace`, () => {
        const { trace, packets } = traceFiveDeflects(scenario);

        assert.equal(trace.hostGame.rallyCount, 5, 'host advances rally exactly once per accepted ID');
        assert.equal(trace.remoteAnimations.length, 5, 'host emits exactly one remote action per accepted ID');
        assert.equal(trace.encodedBallStates.length, 5, 'host emits one authoritative ball correction per action tick');
        assert.deepEqual(packets.map(({ authoritative }) => authoritative.seq), [1, 2, 3, 4, 5]);
        assert.equal(trace.clientGame._ballSeq, 5, 'client consumes every newer authoritative state');
        assert.ok(
            trace.clientBall.position.distanceTo(trace.hostBall.position) <= scenario.currentSpeed * 0.08 + 0.01,
            'client is bounded to less than 80ms of the authoritative flight after correction'
        );

        trace.advance(500);
        trace.host.handleMessage(packets[4].packet, 'remote-peer');
        assert.equal(trace.hostGame.rallyCount, 5, 'duplicate attack ID is a no-op after a delay');
        assert.equal(trace.remoteAnimations.length, 5, 'duplicate ID produces no second action animation');
    });
}

test('250ms plausible snapshot is accepted, while a far snapshot cannot teleport host or client', () => {
    const trace = makeTrace({ currentSpeed: 102, ping: 250 });
    const plausible = trace.sendAttack('plausible-250ms', {
        attackOffset: 6,
        snapshotOffset: 8,
        packetPing: 250
    });
    assert.equal(trace.hostBall.position.x, 8.75, 'host accepts a bounded 250ms predicted contact point');
    assert.equal(plausible.authoritative.x, 8.75);

    trace.advance(500);
    const before = trace.hostBall.position.clone();
    const rejectedSnapshot = trace.sendAttack('far-snapshot', { snapshotOffset: 300, packetPing: 250 });
    assert.ok(trace.hostBall.position.x < 20, 'far snapshot does not teleport host ball across the arena');
    assert.ok(rejectedSnapshot.authoritative.x < 20, 'client receives the host-resolved position, not the far hint');
    assert.ok(trace.hostBall.position.x > before.x, 'valid attack still resolves from the authoritative contact point');
});
