// Netcode v3: snapshot interpolation, ball prediction, clock sync, compact codecs,
// spectator batching and migration follow. Everything here is deterministic: simulated
// clocks, seeded jitter/loss, no real timers except where noted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import { Network, isNewerSequence } from '../js/network.js';
import {
    NET_BIN, encodePositionQ, decodePositionQ, encodeBallQ, decodeBallQ,
    encodePositionBatch, decodePositionBatch, encodeBotSync, decodeBotSync,
    wrapTime32, unwrapTime32, encodeOct, decodeOct
} from '../js/net-codec.js';
import { ClockSync } from '../js/net-clock.js';
import { RemoteInterp, BALL_SMOOTHING, ballErrorDecay, ballPredictAt } from '../js/net-interp.js';
import { compileGameMethod } from './game-source.mjs';

function rng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const dv = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

function fakeConn(peer, metadata = {}) {
    const conn = new EventEmitter();
    Object.assign(conn, { peer, metadata: { ...metadata }, open: true, sent: [], closed: false });
    conn.send = data => conn.sent.push(data);
    conn.close = () => {
        if (conn.closed) return;
        conn.closed = true;
        conn.open = false;
        conn.emit('close');
    };
    return conn;
}

// ------------------------------------------------------------------ codec

test('POS_Q round-trips within quantization error and meets the size budget', () => {
    const moving = {
        seq: 513, t: 123456.4, x: 12.3456, y: 1.7, z: -33.21, ry: 2.5,
        ax: 0.3, ay: -0.2, az: Math.sqrt(1 - 0.13), vx: 6.25, vy: -1.5, vz: 0.031
    };
    const u8 = encodePositionQ(moving);
    assert.equal(u8[0], NET_BIN.POS_Q);
    assert.equal(u8.byteLength, 27, 'moving player: 27 bytes (legacy POS_V2 was 44 + 37-byte id)');
    const back = decodePositionQ(dv(u8));
    for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(back[key] - moving[key]) <= 1 / 128 + 1e-9, key);
    for (const key of ['vx', 'vy', 'vz']) assert.ok(Math.abs(back[key] - moving[key]) <= 1 / 128 + 1e-9, key);
    assert.ok(Math.abs(back.ry - moving.ry) < 1e-4);
    assert.ok(Math.hypot(back.ax - moving.ax, back.ay - moving.ay, back.az - moving.az) < 1e-3);
    assert.equal(back.t, 123456);
    assert.equal(back.seq, 513);

    const idle = encodePositionQ({ seq: 1, t: 5, x: 1, y: 1.7, z: 2, ry: 0, ax: 0, ay: 0, az: 1 });
    assert.equal(idle.byteLength, 21, 'a player at rest omits the velocity block');
    assert.deepEqual([decodePositionQ(dv(idle)).vx, decodePositionQ(dv(idle)).vy], [0, 0]);

    const full = decodePositionQ(dv(encodePositionQ({
        seq: 2, x: 0, y: 0, z: 0, alive: false, hp: 42, team: 'blue', name: 'Ada',
        charId: 'rally', playerId: 'player-1', knifeId: 'karambit'
    })));
    assert.deepEqual(
        [full.alive, full.hp, full.team, full.name, full.charId, full.playerId, full.knifeId],
        [false, 42, 'blue', 'Ada', 'rally', 'player-1', 'karambit']
    );
});

test('POS_Q decoder rejects truncation, trailing bytes, unknown flags and bad ids', () => {
    const u8 = encodePositionQ({ seq: 1, t: 9, x: 1, y: 2, z: 3, vx: 1, playerId: 'player-9' });
    for (let length = 0; length < u8.byteLength; length++) {
        assert.equal(decodePositionQ(dv(u8.slice(0, length))), null, `truncated at ${length}`);
    }
    const padded = new Uint8Array(u8.byteLength + 1);
    padded.set(u8);
    assert.equal(decodePositionQ(dv(padded)), null);
    const flagged = u8.slice();
    flagged[1] |= 0x80;
    assert.equal(decodePositionQ(dv(flagged)), null);
    // Invalid playerId is dropped by the encoder, and a forged one fails the decoder.
    const forged = encodePositionQ({ seq: 1, x: 0, y: 0, z: 0, playerId: 'good-id' });
    forged.set(new TextEncoder().encode('bad id!'), forged.byteLength - 7);
    assert.equal(decodePositionQ(dv(forged)), null);
    const network = new Network({});
    assert.equal(network._decodeBinary(encodePositionQ({ seq: 1, x: 511.99, y: 0, z: -511.99 }))?.type, 'position');
});

test('BALL_Q delta packets are ~4x smaller and keep target/affix/skin semantics', () => {
    const ball = {
        seq: 7, t: 9000, x: 1.5, y: 2.25, z: -3, vx: 120.5, vy: -3, vz: 0.25, speed: 121,
        active: true, state: 'rally', targetName: 'Bob', targetPlayerId: '6a1f4c2e-9d0b-4f7e-8a3c-5b2d1e0f9a8b',
        targetPeerId: '0b9f8e7d-6c5b-4a39-8271-605f4e3d2c1b', affix: { id: 'ghost', color: 0x44ff88 }, skinId: 'classic'
    };
    const network = new Network({});
    const legacy = network.encodeBallState(ball);
    const delta = encodeBallQ(ball, { meta: false });
    const keyframe = encodeBallQ(ball, { meta: true });
    assert.equal(delta.byteLength, 31);
    assert.ok(legacy.byteLength >= 3.5 * delta.byteLength, `legacy ${legacy.byteLength} B vs delta ${delta.byteLength} B`);
    assert.ok(keyframe.byteLength < legacy.byteLength);

    const d = network._decodeBinary(delta);
    assert.equal(d.type, 'ballState');
    assert.equal(d.affixUnchanged, true, 'delta packet leaves the affix alone');
    assert.equal(Object.hasOwn(d, 'targetPlayerId'), false, 'delta packet does not touch the target');
    assert.equal(d.vx, Math.fround(120.5));
    assert.equal(d.t, 9000);

    const k = network._decodeBinary(keyframe);
    assert.deepEqual([k.targetName, k.targetPlayerId, k.targetPeerId, k.affix, k.affixColor, k.skinId],
        ['Bob', ball.targetPlayerId, ball.targetPeerId, 'ghost', 0x44ff88, 'classic']);
    const cleared = network._decodeBinary(encodeBallQ({ ...ball, affix: null, targetName: null, targetPlayerId: null, targetPeerId: null }, { meta: true }));
    assert.equal(cleared.affix, undefined);
    assert.equal(cleared.affixUnchanged, undefined, 'keyframe without affix clears it');
    assert.equal(cleared.targetPlayerId, null);
    for (let length = 1; length < keyframe.byteLength; length++) {
        assert.equal(network._decodeBinary(keyframe.slice(0, length)), null, `truncated ball at ${length}`);
    }
    assert.equal(network._decodeBinary(encodeBallQ({ ...ball, vx: Number.POSITIVE_INFINITY }, { meta: false })), null);
});

test('spectator batch and bot sync codecs round-trip; unknown bot intent falls back to JSON', () => {
    const entries = [
        { netId: 1, seq: 10, t: 777, x: 1, y: 1.7, z: 2, ry: 1, ax: 0, ay: 0, az: 1, vx: 3, vy: 0, vz: 0, hp: 80, alive: true },
        { netId: 2, seq: 11, t: 778, x: -4, y: 1.7, z: 9, ry: -1, vx: 0, vy: 0, vz: 0, alive: false }
    ];
    const batch = encodePositionBatch(entries);
    const back = decodePositionBatch(dv(batch));
    assert.equal(back.length, 2);
    assert.deepEqual([back[0].netId, back[0].hp, back[0].alive, back[0].vx, back[1].alive, back[1].hp],
        [1, 80, true, 3, false, undefined]);
    assert.ok(batch.byteLength <= 2 + 27 + 17 + 2, `batch ${batch.byteLength} B`);
    assert.equal(decodePositionBatch(dv(batch.slice(0, batch.byteLength - 1))), null);

    const bots = [
        { name: 'Bot Alpha', team: 'red', x: 1, y: 0, z: -5, ry: 0.5, alive: true, hp: 100, charId: 'rally', intent: 'dodge-left', strafe: -0.5, attacking: false },
        { name: 'Bot Beta', team: 'blue', x: -1, y: 0, z: 5, ry: -0.5, alive: false, hp: 0, charId: 'tank', intent: 'deflect', strafe: 1, attacking: true }
    ];
    const packed = encodeBotSync(bots, 4242);
    const decoded = decodeBotSync(dv(packed));
    assert.equal(decoded.t, 4242);
    assert.deepEqual(decoded.bots.map(bot => [bot.name, bot.team, bot.alive, bot.intent, bot.attacking, bot.charId]),
        bots.map(bot => [bot.name, bot.team, bot.alive, bot.intent, bot.attacking, bot.charId]));
    assert.ok(packed.byteLength < JSON.stringify({ type: 'botSync', bots }).length / 4);
    assert.equal(encodeBotSync([{ ...bots[0], intent: 'mystery' }], 1), null);
});

test('time and aim helpers wrap and normalise', () => {
    assert.equal(unwrapTime32(wrapTime32(2 ** 32 + 5000), 2 ** 32 + 4990), 2 ** 32 + 5000);
    assert.equal(unwrapTime32(10, 2 ** 32 - 20), 2 ** 32 + 10);
    const out = decodeOct(...encodeOct(0.2, -0.9, -0.3));
    const length = Math.hypot(0.2, -0.9, -0.3);
    assert.ok(Math.hypot(out.x - 0.2 / length, out.y + 0.9 / length, out.z + 0.3 / length) < 1e-3);
});

// ------------------------------------------------------------------ interpolation

// Circle of radius 5 at 1 rad/s (5 m/s): smooth, curved, with exact velocities.
const truth = ms => {
    const s = ms / 1000;
    return { x: 5 * Math.cos(s), y: 1.7, z: 5 * Math.sin(s), vx: -5 * Math.sin(s), vy: 0, vz: 5 * Math.cos(s) };
};

function simulate({ seed = 1, sendHz = 30, baseTransit = 40, jitter = 30, loss = 0, reorder = 0, durationMs = 4000,
    frameHz = 144, stopSendingAt = Infinity, path = truth, interp = new RemoteInterp() } = {}) {
    const random = rng(seed);
    const packets = [];
    for (let t = 0, seq = 0; t <= durationMs && t < stopSendingAt; t += 1000 / sendHz, seq++) {
        if (random() < loss) continue;
        let arrival = t + baseTransit + random() * jitter;
        if (random() < reorder) arrival += 1000 / sendHz * 1.5; // overtaken by the next one
        packets.push({ t, arrival, ...path(t) });
    }
    packets.sort((a, b) => a.arrival - b.arrival);
    const frames = [];
    let next = 0;
    const frameMs = 1000 / frameHz;
    for (let now = 0; now <= durationMs + 400; now += frameMs) {
        while (next < packets.length && packets[next].arrival <= now) {
            const p = packets[next++];
            interp.push(p.t, p.arrival, p.x, p.y, p.z, p.vx, p.vy, p.vz, 0, true);
        }
        const out = interp.update(now, frameMs);
        if (out) frames.push({ now, x: out.x, y: out.y, z: out.z, renderTime: interp.lastRenderTime, mode: interp.mode });
    }
    return { frames, interp };
}

function pathError(frames, path = truth, fromMs = 1000, toMs = 3800) {
    let max = 0;
    for (const f of frames) {
        if (f.now < fromMs || f.now > toMs) continue;
        const want = path(f.renderTime);
        max = Math.max(max, Math.hypot(f.x - want.x, f.z - want.z));
    }
    return max;
}

function maxStep(frames, fromMs = 1000, toMs = 3800) {
    let max = 0;
    for (let i = 1; i < frames.length; i++) {
        if (frames[i].now < fromMs || frames[i].now > toMs) continue;
        max = Math.max(max, Math.hypot(frames[i].x - frames[i - 1].x, frames[i].z - frames[i - 1].z));
    }
    return max;
}

test('interpolation tracks a curved path through heavy jitter using sender time', () => {
    const { frames, interp } = simulate({ jitter: 40 });
    const error = pathError(frames);
    assert.ok(error < 0.02, `path error ${error.toFixed(4)} m`);
    // 5 m/s at 144 Hz is 3.5 cm per frame; nothing larger may appear (no jitter judder).
    assert.ok(maxStep(frames) < 0.045, `max frame step ${maxStep(frames).toFixed(4)} m`);
    const steady = frames.filter(f => f.now > 1000 && f.now < 3800);
    assert.ok(steady.filter(f => f.mode !== 'interp').length / steady.length < 0.02, 'buffer rarely underruns');
    assert.equal(interp.stats.late, 0);
    assert.ok(interp.extraMs >= 35 && interp.extraMs <= 250);
});

test('adaptive delay grows with measured jitter and stays small on a clean link', () => {
    const clean = simulate({ jitter: 2 }).interp;
    const noisy = simulate({ jitter: 80 }).interp;
    assert.ok(clean.extraMs < 60, `clean lerp ${clean.extraMs.toFixed(1)} ms`);
    assert.ok(noisy.extraMs > clean.extraMs + 40, `noisy lerp ${noisy.extraMs.toFixed(1)} ms`);
    assert.ok(Math.abs(clean.transit - 41) < 3, 'mean transit is learned');
});

test('20% packet loss and reordering stay smooth and on-path', () => {
    const lossy = simulate({ seed: 7, loss: 0.2, jitter: 30 });
    assert.ok(pathError(lossy.frames) < 0.06, `lossy error ${pathError(lossy.frames).toFixed(4)}`);
    assert.ok(maxStep(lossy.frames) < 0.05);
    const shuffled = simulate({ seed: 11, reorder: 0.25, jitter: 20 });
    assert.ok(shuffled.interp.stats.pushed > 100);
    assert.ok(pathError(shuffled.frames) < 0.05, `reordered error ${pathError(shuffled.frames).toFixed(4)}`);
    assert.ok(maxStep(shuffled.frames) < 0.05);
});

test('extrapolation is capped, then holds', () => {
    const { frames, interp } = simulate({ stopSendingAt: 2000, jitter: 5, durationMs: 3500 });
    const newest = interp.samples.at(-1);
    const last = frames.at(-1);
    assert.equal(last.mode, 'hold');
    const lead = Math.hypot(last.x - newest.x, last.z - newest.z);
    assert.ok(lead <= 5 * 0.1 + 0.01, `extrapolated ${lead.toFixed(3)} m past the last sample (cap 100 ms)`);
    const held = frames.filter(f => f.now > 3000);
    assert.ok(maxStep(held, 3000, 4000) < 1e-9, 'no drift while holding');
});

test('a correction after a missed turn blends in instead of snapping', () => {
    // Straight line, then an abrupt 90° turn during a 250 ms packet gap.
    const turnAt = 2000;
    const path = ms => ms < turnAt
        ? { x: ms / 1000 * 5, y: 1.7, z: 0, vx: 5, vy: 0, vz: 0 }
        : { x: turnAt / 1000 * 5, y: 1.7, z: (ms - turnAt) / 1000 * 5, vx: 0, vy: 0, vz: 5 };
    const random = rng(3);
    const interp = new RemoteInterp();
    const frames = [];
    const packets = [];
    for (let t = 0; t <= 3500; t += 1000 / 30) {
        if (t > turnAt - 100 && t < turnAt + 150) continue; // gap straddling the turn
        packets.push({ t, arrival: t + 40 + random() * 5, ...path(t) });
    }
    let next = 0;
    for (let now = 0; now <= 3600; now += 1000 / 144) {
        while (next < packets.length && packets[next].arrival <= now) {
            const p = packets[next++];
            interp.push(p.t, p.arrival, p.x, p.y, p.z, p.vx, p.vy, p.vz, 0, true);
        }
        const out = interp.update(now, 1000 / 144);
        if (out) frames.push({ now, x: out.x, z: out.z, renderTime: interp.lastRenderTime });
    }
    const around = frames.filter(f => f.now > 1800 && f.now < 2600);
    let worst = 0;
    for (let i = 1; i < around.length; i++) {
        worst = Math.max(worst, Math.hypot(around[i].x - around[i - 1].x, around[i].z - around[i - 1].z));
    }
    // The raw correction here is ~0.5 m; spread over frames it must stay well under that.
    assert.ok(worst < 0.12, `worst correction step ${worst.toFixed(3)} m`);
    const settled = frames.filter(f => f.now > 3000);
    const err = Math.max(...settled.map(f => {
        const want = path(f.renderTime);
        return Math.hypot(f.x - want.x, f.z - want.z);
    }));
    assert.ok(err < 0.02, `converged error ${err.toFixed(4)} m`);
});

test('teleports snap; idle senders hold still until they move again', () => {
    const interp = new RemoteInterp();
    interp.push(0, 40, 0, 1.7, 0, 0, 0, 0, 0, true);
    interp.update(100, 16);
    assert.equal(interp.push(33, 73, 30, 1.7, 0, 0, 0, 0, 0, true), 'snap');
    assert.equal(interp.samples.length, 1);
    const out = interp.update(120, 16);
    assert.equal(out.x, 30);

    const idle = new RemoteInterp();
    for (let t = 0; t <= 500; t += 33) idle.push(t, t + 40, 0, 1.7, 0, 0, 0, 0, 0, true);
    let now = 600;
    for (; now < 1500; now += 16) idle.update(now, 16);
    // Silent for a second (sender suppresses unchanged packets), then starts running.
    idle.push(1500, 1540, 0.2, 1.7, 0, 6, 0, 0, 0, true);
    idle.push(1533, 1573, 0.4, 1.7, 0, 6, 0, 0, 0, true);
    const renders = [];
    for (; now < 1700; now += 16) renders.push({ rt: idle.update(now, 16) && idle.lastRenderTime, x: idle.out.x });
    const beforeMove = renders.filter(r => r.rt < 1450);
    assert.ok(beforeMove.length > 0);
    assert.ok(beforeMove.every(r => Math.abs(r.x) < 1e-6), 'no smear across the silent gap');
});

// ------------------------------------------------------------------ clock sync

test('clock filter converges on the true offset despite asymmetric queueing', () => {
    const random = rng(5);
    const clock = new ClockSync();
    const trueOffset = 123456.789;
    let local = 1000;
    for (let i = 0; i < 12; i++) {
        const up = 20 + (random() < 0.5 ? random() * 80 : 0);
        const down = 20 + (random() < 0.5 ? random() * 80 : 0);
        const t0 = local;
        const remote = t0 + up + trueOffset;
        const t2 = t0 + up + down;
        clock.addSample(t0, remote, t2);
        local += 1000;
    }
    assert.equal(clock.synced, true);
    assert.ok(Math.abs(clock.offset - trueOffset) < 6, `offset error ${(clock.offset - trueOffset).toFixed(2)} ms`);
    assert.ok(clock.rtt > 35 && clock.rtt < 200);
    assert.ok(Math.abs(clock.hostNow(5000) - (5000 + clock.offset)) < 1e-9);
});

test('clock slews small corrections and resyncs large ones', () => {
    const clock = new ClockSync();
    clock.addSample(0, 1000 + 10, 20);
    const epoch = clock.syncEpoch;
    assert.equal(clock.offset, 1000);
    for (let i = 0; i < 8; i++) clock.addSample(100 * i, 100 * i + 1100 + 10, 100 * i + 20);
    assert.ok(clock.offset > 1000 && clock.offset <= 1000 + 8 * 4 + 1e-9, 'bounded slew');
    assert.equal(clock.syncEpoch, epoch);
    for (let i = 0; i < 8; i++) clock.addSample(2000 + i, 2000 + i + 50000 + 10, 2000 + i + 20);
    assert.ok(Math.abs(clock.offset - 50000) < 1e-6, 'large jump resyncs immediately');
    assert.ok(clock.syncEpoch > epoch);
    assert.equal(clock.addSample(10, 0, 5), false, 'negative RTT rejected');
});

test('pong feeds the clock filter; host pongs only track per-peer RTT', () => {
    const client = new Network({});
    const host = fakeConn('host-peer');
    client.connections.set('host-peer', host);
    client.hostConn = host;
    client.connected = true;
    client.sendPing();
    const ping = host.sent.at(-1);
    assert.equal(ping.type, 'ping');
    client.handleMessage({ type: 'pong', nonce: ping.nonce, remoteTime: performance.now() + 5000 }, 'host-peer');
    assert.equal(client.clock.synced, true);
    assert.ok(Math.abs(client.getClockOffset() - 5000) < 50);
    assert.equal(client._validateMsg({ type: 'pong', nonce: 'x'.repeat(40) }), false);
    assert.equal(client._validateMsg({ type: 'pong', nonce: 'abc', remoteTime: Number.NaN }), false);

    const hostNet = new Network({});
    hostNet.isHost = true;
    hostNet.connected = true;
    const a = fakeConn('peer-a');
    a._admitted = true;
    hostNet.connections.set('peer-a', a);
    hostNet.sendPing();
    hostNet.handleMessage({ type: 'pong', nonce: a.sent.at(-1).nonce, remoteTime: 1 }, 'peer-a');
    assert.equal(hostNet.clock.synced, false, 'the host is the reference clock');
    assert.ok(hostNet._peerRtt.has('peer-a'));
    assert.equal(hostNet.getClockOffset(), 0);
});

// ------------------------------------------------------------------ network wiring

function hostWithPeers() {
    const network = new Network({ remotePlayers: new Map(), player: {} });
    network.isHost = true;
    network.peer = { id: 'peer-host' };
    const modern = fakeConn('peer-modern');
    const legacy = fakeConn('peer-legacy');
    network.connections.set('peer-modern', modern);
    network.connections.set('peer-legacy', legacy);
    network.peerCapabilities.set('peer-modern', { positionV2: true, migrationVotes: true, netV3: true });
    network.peerCapabilities.set('peer-legacy', { positionV2: true, migrationVotes: true });
    return { network, modern, legacy };
}

test('capability negotiation: netV3 peers get POS_Q, others keep POS_V2', () => {
    const { network, modern, legacy } = hostWithPeers();
    network.sendPosition({ x: 1, y: 1.7, z: 2 }, 0.5, { ax: 0, ay: 0, az: 1, vx: 4, vy: 0, vz: 0 });
    assert.equal(modern.sent[0][0], NET_BIN.POS_Q);
    assert.equal(legacy.sent[0][0], 3);
    const decoded = network._decodeBinary(modern.sent[0]);
    assert.equal(decoded.playerId, network.playerId, 'first packet carries the id');
    assert.ok(Number.isFinite(decoded.t), 'host stamps with its own clock');
    network.sendPosition({ x: 1, y: 1.7, z: 2 }, 0.5, {});
    assert.equal(network._decodeBinary(modern.sent[1]).playerId, undefined, 'id is not repeated every packet');
    assert.ok(modern.sent[1].byteLength < legacy.sent[1].byteLength / 2);
});

test('ball sends adapt: ~30 Hz on a predictable path, immediate on discontinuities', () => {
    const network = new Network({});
    let sent = 0;
    const ball = { x: 0, y: 1, z: 0, vx: 20, vy: 0, vz: 0, active: true, state: 'rally', targetPlayerId: null, targetPeerId: null, targetName: null, affix: null, skinId: 'classic' };
    for (let frame = 0; frame < 60; frame++) {
        const now = frame * 1000 / 60;
        ball.x = 20 * now / 1000;
        if (network._ballSendDecision({ ...ball }, now).send) sent++;
    }
    assert.ok(sent >= 29 && sent <= 31, `straight flight: ${sent} sends/s from 60 offers`);
    const deflect = network._ballSendDecision({ ...ball, vx: -20, vz: 5 }, 1000 + 1);
    assert.equal(deflect.send, true);
    assert.equal(deflect.discontinuity, true);
    const retarget = network._ballSendDecision({ ...ball, vx: -20, vz: 5, x: ball.x, targetPlayerId: 'player-x' }, 1000 + 2);
    assert.equal(retarget.send, true);
    assert.equal(retarget.meta, true, 'target change travels with the next packets');
});

test('mixed audience: modern peers get BALL_Q, legacy peers the old packet', () => {
    const { network, modern, legacy } = hostWithPeers();
    const ball = {
        position: { x: 1, y: 2, z: 3 }, velocity: { x: 10, y: 0, z: 0 }, currentSpeed: 10,
        active: true, state: 'rally', targetPlayer: null, affix: null, skinId: 'classic'
    };
    assert.equal(network.broadcastBallState(ball, 1), true);
    assert.equal(modern.sent[0][0], NET_BIN.BALL_Q);
    assert.equal(legacy.sent[0][0], 1);
    assert.equal(network._decodeBinary(modern.sent[0]).skinId, 'classic', 'first packet is a keyframe');
});

test('spectators get one batched snapshot per tick plus a net-id table', () => {
    const updates = [];
    const network = new Network({ remotePlayers: new Map(), spectators: new Map(), updateRemotePlayer: () => {} });
    network.isHost = true;
    network.peer = { id: 'peer-host' };
    const spectator = fakeConn('peer-spec');
    Object.defineProperty(spectator, '_spectator', { value: true });
    network.connections.set('peer-spec', spectator);
    network.peerCapabilities.set('peer-spec', { positionV2: true, migrationVotes: true, netV3: true });
    network._specRelayLastFlush = performance.now(); // inside the batching window
    network.relayPositionToSpectators({ seq: 1, t: 100, x: 1, y: 1.7, z: 2, ry: 0, vx: 1, vy: 0, vz: 0 }, 'player-a', 'peer-a', { hp: 90, alive: true });
    network.relayPositionToSpectators({ seq: 1, t: 101, x: 3, y: 1.7, z: 4, ry: 0, vx: 0, vy: 0, vz: 0 }, 'player-b', 'peer-b', { hp: 70, alive: true });
    network.relayPositionToSpectators({ seq: 2, t: 110, x: 1.2, y: 1.7, z: 2, ry: 0, vx: 1, vy: 0, vz: 0 }, 'player-a', 'peer-a', { hp: 90, alive: true });
    assert.equal(spectator.sent.length, 0, 'queued until the tick');
    network._flushSpectatorRelay();
    assert.equal(spectator.sent.length, 2);
    assert.equal(spectator.sent[0].type, 'netIds');
    assert.equal(spectator.sent[1][0], NET_BIN.POS_BATCH);
    // Rare identity fields still go out immediately as JSON.
    network.relayPositionToSpectators({ seq: 3, x: 0, y: 1.7, z: 0, team: 'blue' }, 'player-a', 'peer-a', null);
    assert.equal(spectator.sent.at(-1).type, 'position');

    // Spectator side: the table resolves ids, the batch lands in updateRemotePlayer.
    const viewer = new Network({ updateRemotePlayer: (playerId, data, peerId) => updates.push([playerId, peerId, data.x, data.hp]) });
    const hostConn = fakeConn('peer-host');
    viewer.hostConn = hostConn;
    viewer.connections.set('peer-host', hostConn);
    viewer.handleMessage(spectator.sent[1], 'peer-host');
    assert.equal(updates.length, 0, 'unknown ids are ignored until the table arrives');
    viewer.handleMessage(spectator.sent[0], 'peer-host');
    viewer.handleMessage(spectator.sent[1], 'peer-host');
    assert.deepEqual(updates.map(([playerId, peerId, x, hp]) => [playerId, peerId, Math.round(x * 10) / 10, hp]),
        [['player-a', 'peer-a', 1.2, 90], ['player-b', 'peer-b', 3, 70]]);
    viewer.handleMessage(spectator.sent[1], 'peer-rogue');
    assert.equal(updates.length, 2, 'batches are host-only');
    assert.equal(viewer._validateMsg({ type: 'netIds', ids: [[0, 'player-a', 'peer-a']] }), false);
});

test('botSync: binary for netV3 peers, stamped JSON for legacy, host-only on receipt', () => {
    const { network, modern, legacy } = hostWithPeers();
    const bots = [{ name: 'Bot A', team: 'red', x: 1, y: 0, z: 2, ry: 0, alive: true, hp: 100, charId: 'rally', intent: 'none', strafe: 0, attacking: false }];
    network.broadcast({ type: 'botSync', bots });
    assert.equal(modern.sent[0][0], NET_BIN.BOT_Q);
    assert.equal(legacy.sent[0].type, 'botSync');
    assert.ok(Number.isFinite(legacy.sent[0].t));

    const applied = [];
    const client = new Network({ applyBotSync: data => applied.push(data) });
    const hostConn = fakeConn('host-peer');
    client.hostConn = hostConn;
    client.connections.set('host-peer', hostConn);
    client.connections.set('mesh-peer', fakeConn('mesh-peer'));
    client.handleMessage(modern.sent[0], 'mesh-peer');
    assert.equal(applied.length, 0, 'a mesh peer cannot move bots');
    client.handleMessage(modern.sent[0], 'host-peer');
    assert.equal(applied.length, 1);
    assert.equal(applied[0].bots[0].name, 'Bot A');
    assert.equal(client._validateMsg({ type: 'botSync', bots: [{ name: 'x', x: Number.NaN, y: 0, z: 0 }] }), false);
});

test('initPeer rejects when the signalling broker never answers', async () => {
    const created = [];
    const previousPeer = globalThis.Peer;
    globalThis.Peer = class extends EventEmitter {
        constructor() { super(); this.destroyed = false; created.push(this); }
        destroy() { this.destroyed = true; }
    };
    try {
        const network = new Network({});
        network.peerOpenTimeoutMs = 20;
        await assert.rejects(network.initPeer(), /matchmaking server/);
        assert.equal(created[0].destroyed, true);
        assert.equal(network.peer, null);
    } finally {
        globalThis.Peer = previousPeer;
    }
});

test('a spectator follows host migration to the next roster candidate', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const network = new Network({});
    const peer = new EventEmitter();
    peer.id = 'peer-spec';
    const attempts = [];
    peer.connect = (id, options) => {
        const conn = fakeConn(id, options.metadata);
        attempts.push(conn);
        return conn;
    };
    network.peer = peer;
    network.spectatorMode = true;
    network.connected = true;
    network.hostRoomCode = 'peer-old-host';
    network._updateMigrationRoster([
        { playerId: 'player-old', peerId: 'peer-old-host', migrationOrder: 0 },
        { playerId: 'player-c', peerId: 'peer-c', migrationOrder: 2 },
        { playerId: 'player-b', peerId: 'peer-b', migrationOrder: 1 }
    ]);
    const states = [];
    let left = 0;
    network.onReconnectState = state => states.push(state);
    network.onHostLeft = () => left++;
    network._beginHostMigration();
    assert.equal(network.hostRoomCode, 'peer-b', 'likely winner first');
    t.mock.timers.tick(500);
    assert.equal(attempts.at(-1).peer, 'peer-b');
    assert.equal(attempts.at(-1).metadata.spectator, true);
    // peer-b never became host (refuses): three attempts, then the next candidate.
    for (const delay of [1000, 2000, 4000]) {
        attempts.at(-1).close();
        t.mock.timers.tick(delay);
    }
    assert.equal(network.hostRoomCode, 'peer-c');
    const winner = attempts.at(-1);
    assert.equal(winner.peer, 'peer-c');
    winner.emit('open');
    assert.equal(network.hostConn, winner);
    assert.equal(network._spectatorFollow, null);
    assert.equal(states.at(-1), 'connected');
    assert.equal(left, 0, 'the viewing session survived');
});

test('a spectator with no reachable candidate still ends the session', () => {
    const network = new Network({});
    network.peer = new EventEmitter();
    network.peer.id = 'peer-spec';
    network.peer.destroy = () => {};
    network.spectatorMode = true;
    network.hostRoomCode = 'peer-old-host';
    let left = 0;
    network.onHostLeft = () => left++;
    network._beginHostMigration();
    assert.equal(left, 1);
});

// ------------------------------------------------------------------ client ball

function ballClient() {
    let now = 0;
    const clientBall = {
        active: true, mesh: { visible: true }, state: 'rally', currentSpeed: 20,
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, copy(o) { return this.set(o.x, o.y, o.z); }, clone() { return { ...this }; } },
        velocity: { set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
        setTarget() {}
    };
    const game = { ball: clientBall, remotePlayers: new Map(), player: {}, bots: [], ui: { updateBallAffix() {} } };
    const network = new Network(game);
    network.hostConn = { peer: 'host-peer' };
    game.network = network;
    const offset = 50000;
    network.clock.synced = true;
    network.hostNow = () => now + offset;
    game.updateBallFromNetwork = compileGameMethod('updateBallFromNetwork', {
        performance: { now: () => now }, isNewerSequence, ballPredictAt, BALL_SMOOTHING, Math
    });
    game.invokeBallSmoothing = compileGameMethod('invokeBallSmoothing', {
        performance: { now: () => now }, ballPredictAt, ballErrorDecay, Math
    });
    return { game, network, offset, setNow: value => { now = value; }, get now() { return now; } };
}

test('client ball flight is jitter-free: displayed speed stays constant under 40 ms jitter', () => {
    const client = ballClient();
    const random = rng(9);
    const v = 20;
    const packets = [];
    for (let hostT = 0, seq = 1; hostT < 3000; hostT += 1000 / 30, seq++) {
        packets.push({ hostT, seq, arrival: hostT - client.offset + 40 + random() * 40 });
    }
    let next = 0;
    let previousX = null;
    let worst = 0;
    for (let local = -client.offset; local < 3000 - client.offset; local += 1000 / 60) {
        client.setNow(local);
        while (next < packets.length && packets[next].arrival <= local) {
            const p = packets[next++];
            client.game.updateBallFromNetwork({
                type: 'ballState', seq: p.seq, t: wrapTime32(p.hostT), x: v * p.hostT / 1000, y: 1, z: 0,
                vx: v, vy: 0, vz: 0, speed: v, active: true, state: 'rally', affixUnchanged: true
            });
        }
        client.game.invokeBallSmoothing(1 / 60);
        const x = client.game.ball.position.x;
        if (previousX !== null && local > 1000 - client.offset) {
            const speed = (x - previousX) * 60;
            worst = Math.max(worst, Math.abs(speed - v) / v);
        }
        previousX = x;
    }
    assert.ok(worst < 0.1, `displayed speed deviates ${(worst * 100).toFixed(1)}% (arrival-time smoothing: ~100%+)`);
});

test('ball correction blends instead of snapping; stale pre-deflect packets are held back', () => {
    const client = ballClient();
    const { game, network } = client;
    client.setNow(0);
    const packet = (seq, hostT, x, vx) => ({ type: 'ballState', seq, t: wrapTime32(hostT), x, y: 1, z: 0, vx, vy: 0, vz: 0, speed: 20, active: true, state: 'rally', affixUnchanged: true });
    game.updateBallFromNetwork(packet(1, client.offset - 40, 0, 20));
    game.invokeBallSmoothing(1 / 60);
    const before = game.ball.position.x;
    // Host says the ball is 1.5 m off our prediction: first frame must not jump there.
    game.updateBallFromNetwork(packet(2, client.offset - 40, 1.5, 20));
    game.invokeBallSmoothing(1 / 60);
    assert.ok(game.ball.position.x - before < 0.6, 'correction spread over frames');
    for (let i = 0; i < 30; i++) game.invokeBallSmoothing(1 / 60);
    // Local deflect prediction: a new base and a guard window.
    game._ballTarget = { x: 0, y: 1, z: 0, vx: -20, vy: 0, vz: 0 };
    game._ballTargetTime = client.now;
    network.clock.rtt = 80;
    game._ballPredictGuardUntil = network.predictionGuardHostTime();
    const stale = packet(3, client.offset + client.now - 5, 0.3, 20);
    game.updateBallFromNetwork(stale);
    assert.equal(game._ballTarget.vx, -20, 'pre-deflect host state ignored');
    const fresh = packet(4, game._ballPredictGuardUntil + 1, -1, -20);
    game.updateBallFromNetwork(fresh);
    assert.equal(game._ballTarget.x, -1, 'post-deflect host state applied');
    assert.equal(game._ballPredictGuardUntil, 0);
});

// ------------------------------------------------------------------ net_graph

test('net_graph command formats live stats and toggles the Network byte counter', async () => {
    const source = readFileSync(new URL('../js/console.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '')
        .replace('// Host (lobby creator) can change game vars via commands.', 'const GAME_MODES = {}; const MAPS = {};\n// Host (lobby creator) can change game vars via commands.');
    const { COMMANDS, formatNetGraph, commandNeedsHost } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.equal(commandNeedsHost(COMMANDS.net_graph), false);
    const text = formatNetGraph({
        role: 'client', peers: 2, ping: 48.4, jitter: 3.26, lerp: 61.2, extrapolating: 0, entities: 3,
        inPps: 71, outPps: 32, inBps: 2600, outBps: 900, clockSynced: true
    });
    assert.match(text, /ping 48 ms {2}jitter 3\.3 ms/);
    assert.match(text, /lerp 61 ms/);
    assert.match(text, /in {2}71 pkt\/s {2}2\.5 KB\/s/);
    assert.match(formatNetGraph(null), /offline/);

    const network = new Network({ updateRemotePlayer() {}, addChatMessage() {} });
    network.netGraphEnabled = true;
    network.handleMessage(encodePositionQ({ seq: 1, x: 0, y: 0, z: 0 }), 'nobody');
    network.handleMessage({ type: 'chat', text: 'hi' }, 'nobody');
    assert.equal(network._netCounters.inPackets, 2);
    assert.ok(network._netCounters.inBytes > 13);
    const stats = network.getNetGraph();
    assert.equal(stats.role, 'client');
});
