import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileGameMethod } from './game-source.mjs';
import { sweptHitStepCount } from '../js/combat.js';

const mainSource = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
    lerpVectors(from, to, t) {
        this.x = from.x + (to.x - from.x) * t;
        this.y = from.y + (to.y - from.y) * t;
        this.z = from.z + (to.z - from.z) * t;
        return this;
    }
}

const hasPendingIncomingSettlement = compileGameMethod('hasPendingIncomingSettlement');
const cancelIncomingSettlement = compileGameMethod('cancelIncomingSettlement');
const armIncomingSettlement = compileGameMethod('armIncomingSettlement', {
    incomingSettlementSeconds: (distance, speed) => Math.min(2, Math.max(0.12, distance / speed + 0.12))
});
const capsuleHitTest = compileGameMethod('capsuleHitTest');
const updateIncomingSettlement = compileGameMethod('updateIncomingSettlement', {
    THREE: { Vector3 },
    sweptHitStepCount
});

function fixture({ connected = false, isHost = false } = {}) {
    const target = {
        alive: true,
        _sizeScale: 1,
        getPosition: () => new Vector3(0, 1.2, 0)
    };
    const ball = {
        active: true,
        targetPlayer: target,
        position: new Vector3(3, 1.2, 0),
        currentSpeed: 120,
        radius: 0.47,
        hitRange: 0.7,
        effectiveHitRange: 1.06,
        _noHitTimer: 0,
        _forceHit: false,
        update(dt) {
            this._prevPosition = this.position.clone();
            this.position.x -= this.currentSpeed * dt;
        }
    };
    const hits = [];
    const game = {
        network: { connected, isHost },
        ball,
        _incomingSettlementTimer: 0,
        hasPendingIncomingSettlement,
        capsuleHitTest,
        handleHit: hitTarget => hits.push(hitTarget)
    };
    return { game, target, hits };
}

test('offline paused settlement advances only the incoming ball and catches swept contact', () => {
    const { game, target, hits } = fixture();
    assert.equal(armIncomingSettlement.call(game), true);
    const budget = game._incomingSettlementTimer;

    assert.equal(updateIncomingSettlement.call(game, 0.05), true);
    assert.deepEqual(hits, [target]);
    assert.equal(game._incomingSettlementTimer, 0);
    assert.ok(budget > 0 && budget <= 2);
    assert.equal(game.ball.currentSpeed, 120, 'settlement must not cap rally speed');
});

test('P2P client never simulates authoritative paused contact', () => {
    const { game, hits } = fixture({ connected: true, isHost: false });
    assert.equal(armIncomingSettlement.call(game), false);
    game._incomingSettlementTimer = 0.5;
    assert.equal(updateIncomingSettlement.call(game, 0.05), false);
    assert.deepEqual(hits, []);
    assert.equal(game.ball.position.x, 3);
});

test('settlement budget includes the ball no-hit grace without becoming unbounded', () => {
    const { game } = fixture();
    game.ball.position.x = 0.1;
    game.ball._noHitTimer = 0.3;
    assert.equal(armIncomingSettlement.call(game), true);
    assert.ok(game._incomingSettlementTimer >= 0.42);
    assert.ok(game._incomingSettlementTimer <= 2);
});

test('pause and visibility wiring uses bounded settlement without player or bot updates', () => {
    assert.match(gameSource, /s === STATES\.PAUSED && prev === STATES\.PLAYING\) this\.armIncomingSettlement\(\)/);
    assert.match(mainSource, /!this\.network\?\.connected && this\.game\.armIncomingSettlement\?\.\(\)\) this\._startBgLoop\(\)/);
    assert.match(mainSource, /this\.game\.state === STATES\.PAUSED && !this\.network\?\.connected[\s\S]*?this\.game\.updateIncomingSettlement\?\.\(dt\)/);
    assert.match(mainSource, /advancesPlayer && !settlingIncoming && !Spectator\.active/);
    const methodStart = gameSource.indexOf('    updateIncomingSettlement(dt) {');
    const methodEnd = gameSource.indexOf('\n    }', methodStart) + 6;
    const method = gameSource.slice(methodStart, methodEnd);
    assert.doesNotMatch(method, /player\.update|bots\.forEach|scoreboard\.update/);
});

test('settlement cancellation clears the bounded budget', () => {
    const { game } = fixture();
    armIncomingSettlement.call(game);
    assert.equal(hasPendingIncomingSettlement.call(game), true);
    cancelIncomingSettlement.call(game);
    assert.equal(hasPendingIncomingSettlement.call(game), false);
});
