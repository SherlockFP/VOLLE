// Client ball sequence gate across rounds, matches and host changes.
// The host's 16-bit ballState counter is never reset, so once it passed 0x8000 a client
// that reset its gate to 0 at round end dropped every packet of the next round (the ball
// froze while the host's real ball flew). The gate now survives round ends and is
// cleared only where a new host counter can start: gameStart, welcome, migration.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Network, isNewerSequence } from '../js/network.js';
import { BALL_SMOOTHING, ballPredictAt } from '../js/net-interp.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const STATES = {
    MENU: 'MENU', LOBBY: 'LOBBY', SOCIAL_HUB: 'SOCIAL_HUB', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER'
};

const vector = () => ({
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
    copy(o) { return this.set(o.x, o.y, o.z); },
    clone() { return { ...this }; }
});

// Same stub shape as tests/netcode-sync.test.mjs ballClient(), plus what applyRoundEnd
// and applyHostMigrationCheckpoint touch. `applied` counts writes of _ballTarget, the
// field updateBallFromNetwork sets once for every packet it accepts.
function ballClient() {
    let now = 0;
    const clientBall = {
        active: true, mesh: { visible: true, position: vector() }, state: 'rally', currentSpeed: 20,
        position: vector(), velocity: vector(),
        setTarget() {},
        deactivate() { this.active = false; this.state = 'idle'; this.mesh.visible = false; }
    };
    const game = {
        ball: clientBall, remotePlayers: new Map(), player: {}, bots: [], ui: { updateBallAffix() {} },
        roundRestartDelay: 3, chaosManager: null,
        states: [],
        setState(state) { this.states.push(state); },
        clearSplitBalls() {},
        _showMatchMessage() {}
    };
    let target = null;
    let applied = 0;
    Object.defineProperty(game, '_ballTarget', {
        enumerable: true,
        get() { return target; },
        set(value) { target = value; if (value) applied++; }
    });
    const network = new Network(game);
    network.hostConn = { peer: 'host-peer' };
    game.network = network;
    game.updateBallFromNetwork = compileGameMethod('updateBallFromNetwork', {
        performance: { now: () => now }, isNewerSequence, ballPredictAt, BALL_SMOOTHING, Math
    });
    game.applyRoundEnd = compileGameMethod('applyRoundEnd', { STATES, t: key => key });
    return {
        game,
        get applied() { return applied; },
        tick() { now += 1000 / 60; },
        send(seq, x = 0, extra = {}) {
            game.updateBallFromNetwork({
                type: 'ballState', ...(seq === undefined ? {} : { seq }),
                x, y: 1, z: 0, vx: 20, vy: 0, vz: 0, speed: 20, active: true, state: 'rally',
                affixUnchanged: true, ...extra
            });
        }
    };
}

const LAST_ROUND_SEQS = [100, 0x7FFF, 0x8000, 0xC000, 0xFFF0];

for (const last of LAST_ROUND_SEQS) {
    test(`round end at host seq 0x${last.toString(16)}: 600/600 next-round packets apply, late ones stay rejected`, () => {
        const client = ballClient();
        // The finished round: a few packets up to `last`.
        for (let back = 5; back >= 0; back--) client.send((last - back) & 0xffff, -back);
        assert.equal(client.game._ballSeq, last);

        client.game.applyRoundEnd({ winner: 'red' });
        assert.deepEqual(client.game.states, [STATES.ROUND_END]);
        assert.equal(client.game._ballSeq, last, 'the gate survives the round end');

        // Late packets from the finished round arrive after roundEnd: still rejected.
        const beforeLate = client.applied;
        client.send((last - 1) & 0xffff, 999);
        client.send(last, 999);
        assert.equal(client.applied, beforeLate, 'late / duplicate packets of the old round are dropped');

        // roundStart carries a seq-less ball snapshot: it always passes the gate.
        client.send(undefined, 0, { active: false, state: 'idle' });
        assert.equal(client.applied, beforeLate + 1);

        // The next round: the host's counter keeps rising from where it was.
        const start = client.applied;
        let lastApplied = last;
        for (let i = 1; i <= 600; i++) {
            client.tick();
            const seq = (last + i) & 0xffff;
            client.send(seq, i * 0.33);
            lastApplied = seq;
        }
        assert.equal(client.applied - start, 600, 'every next-round packet is applied');
        assert.equal(client.game._ballSeq, lastApplied);
        assert.equal(client.game._ballTarget.x, 600 * 0.33);

        // A straggler below the last applied seq is still rejected.
        const beforeStraggler = client.applied;
        client.send((lastApplied - 3) & 0xffff, -50);
        assert.equal(client.applied, beforeStraggler);
        assert.equal(client.game._ballTarget.x, 600 * 0.33);
    });
}

test('regression: the old reset to 0 dropped the next round once the host counter passed 0x7FFF', () => {
    // Documents why applyRoundEnd no longer writes _ballSeq = 0 (network.js isNewerSequence).
    const acceptedFromZero = last => {
        let gate = 0;
        let accepted = 0;
        for (let i = 1; i <= 600; i++) {
            const seq = (last + i) & 0xffff;
            if (isNewerSequence(seq, gate)) { gate = seq; accepted++; }
        }
        return accepted;
    };
    assert.equal(acceptedFromZero(100), 600);
    for (const last of [0x7FFF, 0x8000, 0xC000, 0xFFF0]) assert.ok(acceptedFromZero(last) < 600, `0x${last.toString(16)}`);
    assert.equal(isNewerSequence(1, 20000), false, 'a stale gate drops a new host counter');
});

test('source: applyRoundEnd keeps the gate; gameStart, welcome and migration clear it', () => {
    assert.doesNotMatch(extractGameMethod('applyRoundEnd'), /this\._ballSeq = 0/);
    for (const name of ['startGameFromNetwork', 'handleLateJoin', 'applyHostMigrationCheckpoint']) {
        assert.match(extractGameMethod(name), /this\._ballSeq = undefined;/, name);
    }
    const migration = extractGameMethod('applyHostMigrationCheckpoint');
    assert.match(migration, /ballSeq: this\._ballSeq\s*\} : null;/, 'captured in ballBefore');
    assert.match(migration, /this\._ballSeq = ballBefore\.ballSeq;/, 'restored on rollback');
    assert.match(migration, /this\._ballTarget = null;\s*this\._ballTargetTime = 0;\s*(?:\/\/[^\n]*\n\s*)*this\._ballSeq = undefined;/);
});

test('startGameFromNetwork: a stale gate of 20000 accepts the new match seq=1', () => {
    const client = ballClient();
    client.game._ballSeq = 20000;
    const startGameFromNetwork = compileGameMethod('startGameFromNetwork', { STATES });
    Object.assign(client.game, {
        arena: { mapId: 'dojo' }, preGameDuration: 10,
        onMatchLoading() {}, selectMode() {}, _applyOvertimeSnapshot() {},
        startGame() { return true; }
    });
    startGameFromNetwork.call(client.game, { state: STATES.COUNTDOWN, mode: 'classic', matchId: 'm2' });
    assert.equal(client.game._ballSeq, undefined);
    const before = client.applied;
    client.send(1, 4);
    assert.equal(client.applied, before + 1);
    assert.equal(client.game._ballSeq, 1);
    client.send(2, 5);
    assert.equal(client.applied, before + 2, 'the gate tracks the new counter from there');
});

test('handleLateJoin: a welcome from a new host clears a stale gate of 20000', () => {
    // Any other member the late-join path touches is an inert, callable stub.
    const inert = () => new Proxy(function () {}, {
        get: (target, key) => (key === Symbol.toPrimitive ? () => 0 : key === 'size' || key === 'length' ? 0 : inert()),
        apply: () => inert(), set: () => true
    });
    const lenient = object => new Proxy(object, { get: (target, key) => (key in target ? target[key] : inert()) });
    const handleLateJoin = compileGameMethod('handleLateJoin', { STATES, THREE: {}, performance: { now: () => 0 } });
    for (const state of [STATES.PLAYING, STATES.LOBBY]) {
        const client = ballClient();
        client.game._ballSeq = 20000;
        client.game.ui = lenient(client.game.ui);
        client.game.player = lenient(client.game.player);
        handleLateJoin.call(lenient(client.game), { state, red: 1, blue: 0, round: 2, time: 60 });
        assert.equal(client.game._ballSeq, undefined, state);
        const before = client.applied;
        client.send(1, 4);
        assert.equal(client.applied, before + 1, `${state}: seq=1 is accepted`);
    }
});

function migrationClient({ restoreOk = true } = {}) {
    const client = ballClient();
    client.game._ballSeq = 20000;
    Object.assign(client.game, {
        state: STATES.PLAYING,
        _applyOvertimeSnapshot() {},
        _validateHostMigrationCheckpointState: compileGameMethod('_validateHostMigrationCheckpointState', { STATES }),
        _restoreHostMigrationState: restoreOk
            ? compileGameMethod('_restoreHostMigrationState', { STATES })
            : () => false
    });
    const apply = compileGameMethod('applyHostMigrationCheckpoint');
    const checkpoint = {
        state: STATES.PLAYING,
        ball: { x: 1, y: 2, z: 3, vx: 4, vy: 0, vz: 0, speed: 4, active: true }
    };
    return { client, run: () => apply.call(client.game, checkpoint, false) };
}

test('applyHostMigrationCheckpoint: the new host\'s seq=1 is accepted after a stale gate of 20000', () => {
    const { client, run } = migrationClient();
    assert.equal(run(), true);
    assert.equal(client.game._ballSeq, undefined);
    assert.equal(client.game._ballTarget, null);
    const before = client.applied;
    client.send(1, 4);
    assert.equal(client.applied, before + 1);
    assert.equal(client.game._ballSeq, 1);
});

test('applyHostMigrationCheckpoint: a failed migration rolls the gate back', () => {
    const { client, run } = migrationClient({ restoreOk: false });
    const target = { x: 9, y: 9, z: 9, vx: 0, vy: 0, vz: 0 };
    client.game._ballTarget = target;
    assert.equal(run(), false);
    assert.equal(client.game._ballSeq, 20000, 'rollback restores the previous gate');
    assert.equal(client.game._ballTarget, target);
});
