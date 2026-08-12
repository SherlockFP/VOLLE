import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    NETWORK_BALL_SPEED_BOUND,
    NETWORK_SPEED_BOUND,
    Network
} from '../js/network.js';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { Ball } = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

test('rally speed grows linearly past the former 6x / 102 cap', () => {
    const ball = Object.create(Ball.prototype);
    ball.baseSpeed = 17;
    ball.rallySpeedStep = 0.30;
    ball.maxRallyMultiplier = 6;
    ball.maxSpeed = 102;
    ball.skinConfig = null;
    const speeds = [0, 1, 6, 20, 40].map(deflections => {
        ball.deflections = deflections;
        return ball.getRallySpeed();
    });
    [17, 22.1, 47.6, 119, 221].forEach((expected, index) => {
        assert.ok(Math.abs(speeds[index] - expected) < 1e-9);
    });
    assert.ok(speeds[3] > 102);
    for (let i = 2; i < speeds.length; i++) {
        const previousDeflections = [0, 1, 6, 20, 40][i - 1];
        const deflections = [0, 1, 6, 20, 40][i];
        assert.ok(Math.abs((speeds[i] - speeds[i - 1]) / (deflections - previousDeflections) - 5.1) < 1e-9);
    }

    ball.deflections = Number.NaN;
    assert.equal(ball.getRallySpeed(), 17);
    assert.doesNotMatch(source, /Math\.min\(1 \+ this\.deflections \* this\.rallySpeedStep/);
});

test('repeated spikes use the linear rally baseline plus a stable 1.2x modifier', () => {
    assert.match(source, /speed = this\.getRallySpeed\(\) \* 1\.2 \* powerBonus/);
    assert.doesNotMatch(source, /speed = this\.currentSpeed \* 1\.2 \* powerBonus/);
    const spikeSpeed = deflections => 17 * (1 + deflections * 0.30) * 1.2;
    assert.ok(spikeSpeed(20) > 102);
    assert.ok(spikeSpeed(1000) < NETWORK_BALL_SPEED_BOUND);
    assert.ok(Math.abs(spikeSpeed(40) - spikeSpeed(39) - 17 * 0.30 * 1.2) < 1e-9);
});

test('ball wire guard accepts high legitimate rallies but rejects non-finite and abusive speeds', () => {
    assert.equal(NETWORK_SPEED_BOUND, 512, 'player motion bound stays unchanged');
    assert.equal(NETWORK_BALL_SPEED_BOUND, 16384);
    const network = new Network({});
    const ball = {
        type: 'ballState', x: 0, y: 2, z: 0,
        vx: 1200, vy: 0, vz: 0, speed: 1200
    };
    assert.equal(network._validateMsg(ball), true);
    assert.equal(network._validateMsg({ ...ball, speed: Number.NaN }), false);
    assert.equal(network._validateMsg({ ...ball, vx: Number.POSITIVE_INFINITY }), false);
    assert.equal(network._validateMsg({ ...ball, speed: NETWORK_BALL_SPEED_BOUND + 1 }), false);
    assert.equal(network._validateMsg({ ...ball, vx: NETWORK_BALL_SPEED_BOUND + 1 }), false);
});
