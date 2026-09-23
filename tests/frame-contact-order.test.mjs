// G2 "high-speed contact decided inside the frame, not at frame edges".
// Covers the pure segment helpers (js/combat.js), the ordering rules of the
// real Game._resolveFrameContacts (earliest event wins, ties → deflect, swing
// live interval, bot ready time, facing at the contact point, _forceHit only
// without a deflect), the approach matrix before/after at 30/60/144 Hz, the
// committed hard bot at 1×/5×/10×, 1×/60 Hz regression bands, per-frame
// allocation, and source wiring (frame order, countdown path, client branch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

import {
    capsuleContact,
    deflectContactS,
    segmentCapsuleEntry,
    segmentIntersectsSphere,
    segmentSphereEntry,
    sweptHitStepCount
} from '../js/combat.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';
import {
    ATTACK_RANGE,
    BALL_RADIUS,
    EYE_HEIGHT,
    SWING_ACTIVE_WINDOW,
    SimPlayer,
    Vector3,
    allocation,
    botSource,
    createBall,
    createBot,
    createContactGame,
    gameSource,
    mulberry32,
    playerSource,
    simulateApproach,
    simulateBotApproach,
    straightPath
} from './frame-contact-sim.mjs';

const CHEST_Y = EYE_HEIGHT - 0.45;

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

test('segmentSphereEntry: entry/exit fractions, inside start, miss, tangent, degenerate', () => {
    const out = { enter: 0, exit: 0 };
    const centre = { x: 0, y: 0, z: 0 };
    // Straight through: enters at x = 2 (s = 0.4), leaves at x = −2 (s = 0.8).
    assert.equal(segmentSphereEntry({ x: 6, y: 0, z: 0 }, { x: -4, y: 0, z: 0 }, centre, 2, out), 0.4);
    assert.ok(Math.abs(out.exit - 0.8) < 1e-12);
    // Ends inside: exit clamps to 1.
    segmentSphereEntry({ x: 6, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, centre, 2, out);
    assert.ok(Math.abs(out.enter - 0.8) < 1e-12);
    assert.equal(out.exit, 1);
    // Starts inside → 0, exit where it leaves.
    assert.equal(segmentSphereEntry({ x: 1, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }, centre, 2, out), 0);
    assert.ok(Math.abs(out.exit - 0.75) < 1e-12);
    // Miss, pointing away, short of the sphere.
    assert.equal(segmentSphereEntry({ x: -5, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, centre, 2, out), -1);
    assert.deepEqual(out, { enter: -1, exit: -1 });
    assert.equal(segmentSphereEntry({ x: 3, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, centre, 2), -1);
    assert.equal(segmentSphereEntry({ x: 9, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, centre, 2), -1);
    // Tangent counts (like segmentIntersectsSphere's ≤).
    assert.ok(Math.abs(segmentSphereEntry({ x: -5, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, centre, 2) - 0.5) < 1e-9);
    // Degenerate segment: inside → 0, outside → −1.
    assert.equal(segmentSphereEntry({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, centre, 2), 0);
    assert.equal(segmentSphereEntry({ x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, centre, 2), -1);
});

test('segmentSphereEntry matches segmentIntersectsSphere on 10,000 random segments (grazing within 1e-6 excepted); entry lies on the surface', () => {
    const random = mulberry32(1);
    let checked = 0;
    for (let index = 0; index < 10000; index++) {
        const a = { x: random() * 12 - 6, y: random() * 6 - 1, z: random() * 12 - 6 };
        const length = random() * 7;
        const theta = random() * Math.PI * 2;
        const phi = (random() - 0.5) * 0.8;
        const b = { x: a.x + Math.cos(theta) * Math.cos(phi) * length, y: a.y + Math.sin(phi) * length, z: a.z + Math.sin(theta) * Math.cos(phi) * length };
        const centre = { x: random() * 2 - 1, y: 1 + random() * 1.5, z: random() * 2 - 1 };
        const r = 1.5 + random() * 2.5;
        const out = { enter: 0, exit: 0 };
        const enter = segmentSphereEntry(a, b, centre, r, out);
        const distance = Math.sqrt(pointSegmentDistance(centre, a, b));
        if (Math.abs(distance - r) <= 1e-6) continue;
        checked++;
        assert.equal(enter >= 0, segmentIntersectsSphere(a, b, centre, r), `segment ${index}`);
        if (enter > 0) {
            const p = lerp(a, b, enter);
            assert.ok(Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) - r) < 1e-6, `entry on surface ${index}`);
            const before = lerp(a, b, Math.max(0, enter - 1e-6));
            assert.ok(Math.hypot(before.x - centre.x, before.y - centre.y, before.z - centre.z) >= r - 1e-9);
            assert.ok(out.exit >= enter && out.exit <= 1);
        }
    }
    assert.ok(checked > 9900);
});

test('segmentCapsuleEntry is exact: 10,000 random segments vs the true segment-to-axis distance (grazing within 1e-6 excepted)', () => {
    const random = mulberry32(2);
    let hits = 0;
    let grazing = 0;
    for (let index = 0; index < 10000; index++) {
        const { a, b, feetY, height, R } = randomCapsuleCase(random);
        const entry = segmentCapsuleEntry(a, b, feetY, height, 0, 0, R);
        const distance = segmentAxisDistance(a, b, feetY, height);
        if (Math.abs(distance - R) <= 1e-6) { grazing++; continue; }
        assert.equal(entry >= 0, distance < R, `segment ${index}: distance ${distance} R ${R} entry ${entry}`);
        if (entry < 0) continue;
        hits++;
        const p = lerp(a, b, entry);
        if (entry > 0) {
            assert.ok(Math.abs(pointAxisDistance(p, feetY, height) - R) < 1e-6, `entry on the capsule surface ${index}`);
            // Nothing before the entry touches the capsule.
            for (let k = 0; k < 16; k++) {
                const q = lerp(a, b, entry * k / 16);
                assert.ok(pointAxisDistance(q, feetY, height) >= R - 1e-9, `earlier touch ${index}`);
            }
        } else {
            assert.ok(pointAxisDistance(a, feetY, height) <= R + 1e-12);
        }
    }
    assert.ok(hits > 1000 && grazing < 5, `hits ${hits} grazing ${grazing}`);
});

test('segmentCapsuleEntry vs today\'s swept sampling (G1): every sampled hit is an analytic hit, never later; the game keeps the sampled decision', t => {
    const random = mulberry32(3);
    let agree = 0;
    let rim = 0;
    let maxDeficit = 0;
    for (let index = 0; index < 10000; index++) {
        const { a, b, feetY, height, R, capsuleRadius } = randomCapsuleCase(random);
        const firstSample = sampledHit(a, b, feetY, height, capsuleRadius);
        const entry = segmentCapsuleEntry(a, b, feetY, height, 0, 0, R);
        if (firstSample >= 0) {
            assert.ok(entry >= 0 && entry <= firstSample + 1e-12, `sampled hit ${index} must be an analytic hit no later than ${firstSample}`);
            agree++;
        } else if (entry >= 0) {
            // Rim pass between two samples: the only kind of disagreement.
            rim++;
            maxDeficit = Math.max(maxDeficit, R - segmentAxisDistance(a, b, feetY, height));
        } else agree++;
    }
    t.diagnostic(`helper vs sampling: ${agree}/10000 agree, ${rim} rim passes caught only analytically (max clearance deficit ${maxDeficit.toFixed(3)} u)`);
    assert.ok(rim < 100);

    // Game._resolveFrameContacts decides hit/no-hit exactly like the sampling.
    const random2 = mulberry32(4);
    let identical = 0;
    for (let index = 0; index < 10000; index++) {
        const { a, b, feetY, speed } = randomCapsuleCase(random2);
        const target = new SimPlayer({ feetY, team: 'blue' });
        const ball = createBall({ position: b, speed, target });
        ball._prevPosition.set(a.x, a.y, a.z);
        const game = createContactGame({ player: target, ball, throwerTeam: 'red' });
        const result = game._resolveFrameContacts(1 / 60, true, false);
        const capsuleRadius = 0.4 + Math.min(speed * 0.003, 2.0);
        const sampled = sampledHit(a, b, feetY, 1.7, capsuleRadius, { includeStart: false }) >= 0;
        assert.equal(result === 'hit', sampled, `game decision ${index}`);
        identical++;
    }
    assert.equal(identical, 10000);
});

test('helpers are allocation-free', () => {
    for (const fn of [segmentSphereEntry, segmentCapsuleEntry, deflectContactS]) {
        assert.doesNotMatch(fn.toString(), /\bnew\b|\[|\{\s*\w+\s*:/, `${fn.name} allocates`);
    }
});

test('deflectContactS: max(entry, live start) bounded by exit, live end and the frame', () => {
    assert.equal(deflectContactS(0.3, 1, -Infinity, Infinity), 0.3);
    assert.equal(deflectContactS(0.3, 1, 0.5, Infinity), 0.5);
    assert.equal(deflectContactS(0.3, 0.4, 0.5, Infinity), -1, 'sphere already left');
    assert.equal(deflectContactS(0.3, 1, -1, 0.2), -1, 'swing over before entry');
    assert.equal(deflectContactS(0.3, 1, 1.2, Infinity), -1, 'not live this frame');
    assert.equal(deflectContactS(-1, 1, 0, 1), -1);
    assert.equal(deflectContactS(0.3, 1, 0.3, 0.3), 0.3, 'inclusive bounds');
});

// ---------------------------------------------------------------------------
// Ordering fixtures on the real Game._resolveFrameContacts.
// ---------------------------------------------------------------------------

// Local player at the origin (eye 1.7), ball along −x at chest height with the
// deflect sphere entered at s = sEnter and the body capsule at s = sBody.
function playerFixture({ speed = 60, sEnter = 0.3, sBody = 0.8, dt = 1 / 60, swingStart = -1, swingAge = null, aim = { x: 1, y: 0, z: 0 } } = {}) {
    const player = new SimPlayer({ aim, team: 'blue' });
    const sphereR = ATTACK_RANGE + Math.min(speed * 0.003, 3.0);
    const xEnter = Math.sqrt(sphereR * sphereR - 0.45 * 0.45);
    const xBody = BALL_RADIUS + 0.4 + Math.min(speed * 0.003, 2.0);
    const length = (xEnter - xBody) / (sBody - sEnter);
    const a = new Vector3(xEnter + sEnter * length, CHEST_Y, 0);
    const b = new Vector3(a.x - length, CHEST_Y, 0);
    const ball = createBall({ position: b, speed, target: player });
    ball._prevPosition.copy(a);
    // Live swing starting `swingStart` seconds into this frame (negative = earlier).
    player.attacking = true;
    player._swingLiveWindow = SWING_ACTIVE_WINDOW;
    if (swingAge !== null) {
        player.swingAge = swingAge;
        player.swingClickDt = dt;
    } else if (swingStart >= 0) {
        player.swingAge = 0;
        player.swingClickDt = swingStart * 2;
    } else {
        player.swingAge = -swingStart;
        player.swingClickDt = 0;
    }
    const game = createContactGame({ player, ball, throwerTeam: 'red' });
    return { game, player, ball, a, b, dt, xEnter, xBody };
}

test('ordering: sphere entry s=0.3, body s=0.8, swing live from before → deflect at the entry point', () => {
    const f = playerFixture({ swingStart: -0.05 });
    assert.equal(f.game._resolveFrameContacts(f.dt, true, false), 'deflect');
    const [event] = f.game.events;
    assert.equal(event.kind, 'player');
    assert.ok(Math.abs(event.point.x - f.xEnter) < 1e-9, `contact x ${event.point.x} vs entry ${f.xEnter}`);
    assert.ok(Math.abs(event.offset - 0.3 * f.dt) < 1e-12);
    assert.ok(Math.abs(f.ball.position.x - f.xEnter) < 1e-9, 'ball left on its contact point');
    assert.equal(f.player.attacking, false);
});

test('ordering: swing starts at s=0.9 (after the body contact at 0.8) → hit', () => {
    const f = playerFixture({ swingStart: 0.9 / 60 });
    assert.equal(f.game._resolveFrameContacts(f.dt, true, false), 'hit');
    assert.deepEqual(f.game.events.map(event => event.kind), ['hit']);
    // Swing opening mid-way between entry and body deflects at the swing start.
    const mid = playerFixture({ swingStart: 0.5 / 60 });
    assert.equal(mid.game._resolveFrameContacts(mid.dt, true, false), 'deflect');
    assert.ok(Math.abs(mid.game.events[0].offset - 0.5 / 60) < 1e-12);
    // Swing that ended before the entry (live end at s = 0.2) → hit.
    const over = playerFixture({ swingStart: -(SWING_ACTIVE_WINDOW - 0.2 / 60) });
    assert.equal(over.game._resolveFrameContacts(over.dt, true, false), 'hit');
});

test('ordering: a tie between the swing start and the body contact goes to the deflect', () => {
    const dt = 1 / 64; // exact binary fractions
    const f = playerFixture({ dt, sEnter: 0.25, sBody: 0.75, swingStart: 0.75 * dt });
    // Same arithmetic as the resolution's capsule radius.
    const R = f.ball.radius + (0.4 + (f.ball.effectiveHitRange - f.ball.hitRange));
    const bodyS = segmentCapsuleEntry(f.a, f.b, 0, 1.7, 0, 0, R);
    assert.ok(Math.abs(bodyS - 0.75) < 1e-9);
    f.player.swingClickDt = bodyS * dt * 2; // start exactly at the body contact
    assert.equal(f.game._resolveFrameContacts(dt, true, false), 'deflect');
});

test('ordering: facing gate at the contact point; a refused contact leaves the frame-end state for the body hit', () => {
    const f = playerFixture({ swingStart: -0.05, aim: { x: -1, y: 0, z: 0 } });
    assert.equal(f.game._resolveFrameContacts(f.dt, true, false), 'hit');
    assert.deepEqual(f.game.events.map(event => event.kind), ['facing-reject', 'hit']);
    assert.equal(f.game.events[1].point.x, f.b.x, 'ball restored to the frame end');
});

test('ordering: _forceHit only applies when no deflect happened this frame', () => {
    const f = playerFixture({ swingStart: -0.05 });
    f.ball._forceHit = true;
    f.ball.aimed = false;
    assert.equal(f.game._resolveFrameContacts(f.dt, true, false), 'deflect');
    assert.deepEqual(f.game.events.map(event => event.kind), ['player']);

    // Without a swing: segment ends outside the capsule (x 1.2 > 1.05) but
    // inside the 1.59 proximity assist → the forced hit fires.
    const g = playerFixture({ swingStart: -0.05 });
    g.player.attacking = false;
    g.ball._prevPosition.set(3, EYE_HEIGHT, 0);
    g.ball.position.set(1.2, EYE_HEIGHT, 0);
    g.ball._forceHit = true;
    g.ball.aimed = false;
    assert.equal(g.game._resolveFrameContacts(g.dt, true, false), 'hit');
});

test('ordering: a bounce this frame decides deflects on the frame-end state only (s = 1)', () => {
    const f = playerFixture({ swingStart: -0.05, sEnter: 0.3, sBody: 1.3 });
    assert.equal(f.game._resolveFrameContacts(f.dt, true, true), 'deflect');
    assert.equal(f.game.events[0].point.x, f.b.x);
    assert.ok(Math.abs(f.game.events[0].offset - f.dt) < 1e-12);
});

test('ordering: P2P clients never resolve deflects here (presentation branch owns prediction)', () => {
    const f = playerFixture({ swingStart: -0.05 });
    assert.equal(f.game._resolveFrameContacts(f.dt, false, false), 'hit');
});

// Bot at the origin (sphere centre y 1.2, radius 2.0) with the sphere entered
// at s = 0.3 and the body at s = 0.8 of a 30 Hz frame (16.7 ms apart).
function botFixture(readyAt) {
    const dt = 1 / 30;
    const speed = 60;
    const bot = createBot({ difficulty: 'hard', committed: true });
    const idle = new SimPlayer({ team: 'red', x: -40 });
    const xEnter = Math.sqrt(4 - 0.05 * 0.05);
    const xBody = BALL_RADIUS + 0.4 + speed * 0.003;
    const length = (xEnter - xBody) / 0.5;
    const a = new Vector3(xEnter + 0.3 * length, 1.25, 0);
    const b = new Vector3(a.x - length, 1.25, 0);
    const ball = createBall({ position: b, speed, target: bot });
    ball._prevPosition.copy(a);
    const game = createContactGame({ player: idle, bots: [bot], ball, throwerTeam: 'red' });
    bot.deflectReadyAt = readyAt;
    return { game, bot, dt, xEnter };
}

test('ordering: bot ready 5 ms before the sphere entry → deflect at the entry; ready 5 ms after the body contact → hit', () => {
    const entryTime = 0.3 / 30;
    const bodyTime = 0.8 / 30;
    const early = botFixture(entryTime - 0.005);
    assert.equal(early.game._resolveFrameContacts(early.dt, true, false), 'deflect');
    assert.equal(early.game.events[0].kind, 'bot');
    assert.ok(Math.abs(early.game.events[0].point.x - early.xEnter) < 1e-9);
    assert.equal(early.bot.attacking, true, 'commitDeflect ran for the accepted contact');

    const late = botFixture(bodyTime + 0.005);
    assert.equal(late.game._resolveFrameContacts(late.dt, true, false), 'hit');
    assert.equal(late.bot.attacking, false, 'no commit without a contact');

    const between = botFixture((entryTime + bodyTime) / 2);
    assert.equal(between.game._resolveFrameContacts(between.dt, true, false), 'deflect');
    assert.ok(between.game.events[0].point.x < between.xEnter);

    const notReady = botFixture(Infinity);
    assert.equal(notReady.game._resolveFrameContacts(notReady.dt, true, false), 'hit');
});

test('bot ready time: exact in-frame crossing of reaction + wind-up; tryDeflect keeps its frame-edge rule', () => {
    const bot = createBot({ difficulty: 'hard' });
    const ball = createBall({ position: { x: 3, y: 1.25, z: 0 }, speed: 17, target: bot });
    ball.velocity.set(-17, 0, 0);
    assert.equal(bot.observeDefenseIntent(ball, () => 0), 'deflect'); // roll the deflect
    const dt = 1 / 60;
    let time = 0;
    let readyWall = null;
    for (let frame = 0; frame < 40 && readyWall === null; frame++) {
        const readyAt = bot.advanceDeflectReady(ball, dt);
        if (readyAt <= dt) readyWall = time + readyAt;
        time += dt;
    }
    // Discrete timers: reaction 0.18 then wind-up 0.08 credited per frame.
    assert.ok(readyWall !== null);
    assert.ok(readyWall <= 0.18 + 0.08 + 1e-9 && readyWall >= 0.18 + 0.08 - dt - 1e-9, `ready at ${readyWall}`);
    assert.equal(bot.windUpCommitted, true);
    assert.equal(bot.advanceDeflectReady(ball, dt), 0, 'committed → ready from the frame start');

    // tryDeflect (countdown warm-up path): ready but out of range → no deflect.
    const far = createBot({ difficulty: 'hard', committed: true });
    const farBall = createBall({ position: { x: 3, y: 1.25, z: 0 }, speed: 17, target: far });
    farBall.velocity.set(-17, 0, 0);
    assert.equal(far.tryDeflect(farBall, dt), false);
    farBall.position.set(1.5, 1.25, 0);
    assert.equal(far.tryDeflect(farBall, dt), true);
});

// ---------------------------------------------------------------------------
// Approach matrix: 200 trials per cell, uniform in-frame phase.
// ---------------------------------------------------------------------------

const RATES = [30, 60, 144];

function runCell({ speed, lead, hz, order, trials = 200, seed = 1 }) {
    const dt = 1 / hz;
    const random = mulberry32(seed * 7919 + speed * 131 + lead * 17 + hz);
    const results = [];
    for (let index = 0; index < trials; index++) {
        const contactTime = 1 + random() * dt;
        const clickTime = contactTime - lead / 1000;
        const result = simulateApproach({ path: straightPath({ speed, contactTime }), dt, clicks: [clickTime], order });
        results.push({ ...result, clickTime, bodyTime: contactTime });
    }
    return results;
}

function sphereGeometry(speed) {
    const sphereR = ATTACK_RANGE + Math.min(speed * 0.003, 3.0);
    const xEnter = Math.sqrt(sphereR * sphereR - 0.45 * 0.45);
    const xBody = BALL_RADIUS + 0.4 + Math.min(speed * 0.003, 2.0);
    return { xEnter, gapMs: (xEnter - xBody) / speed * 1000 };
}

test('acceptance: 17/88/177 u/s × leads 30/100/200 ms deflect 100% at 30/60/144 Hz; contact point and G3 lead are frame-rate independent', t => {
    for (const speed of [17, 88, 177]) {
        const { xEnter, gapMs } = sphereGeometry(speed);
        for (const lead of [30, 100, 200]) {
            const row = [];
            for (const hz of RATES) {
                const dt = 1 / hz;
                const results = runCell({ speed, lead, hz, order: 'new' });
                const deflects = results.filter(result => result.outcome === 'deflect');
                assert.equal(deflects.length, results.length, `${speed}/${lead} @${hz}`);
                for (const result of deflects) {
                    // G3 lead within half a click-frame of the scripted lead.
                    assert.ok(Math.abs(result.leadMs - lead) <= dt * 500 + 1e-6, `${speed}/${lead} @${hz}: lead ${result.leadMs}`);
                    if (lead - gapMs > dt * 500) {
                        // Swing live before the entry: contact = the sphere entry point.
                        assert.ok(Math.abs(result.point.x - xEnter) <= 0.02, `${speed}/${lead} @${hz}: contact ${result.point.x} vs ${xEnter}`);
                    } else {
                        // Ball already in range at the click: contact at the click estimate.
                        const trueX = straightPath({ speed, contactTime: result.bodyTime }).at(result.clickTime).x;
                        assert.ok(Math.abs(result.point.x - trueX) <= speed * dt / 2 + 1e-9);
                    }
                }
                const before = runCell({ speed, lead, hz, order: 'old' }).filter(result => result.outcome === 'deflect').length;
                row.push(`${hz} Hz ${before}/200 → ${deflects.length}/200`);
            }
            t.diagnostic(`${speed} u/s lead ${lead} ms: ${row.join(', ')}`);
        }
    }
});

test('acceptance: lead 250 — 17 u/s (entry 187 ms after the click, inside the 220 ms swing) deflects 100%, 177 u/s (entry 244 ms after) is hit 100%', t => {
    const slow = sphereGeometry(17);
    const fast = sphereGeometry(177);
    t.diagnostic(`entry after click: 17 u/s ${(250 - slow.gapMs).toFixed(1)} ms, 177 u/s ${(250 - fast.gapMs).toFixed(1)} ms`);
    assert.ok(Math.abs(250 - slow.gapMs - 187) < 1);
    assert.ok(Math.abs(250 - fast.gapMs - 244) < 1);
    for (const hz of RATES) {
        const slowResults = runCell({ speed: 17, lead: 250, hz, order: 'new' });
        assert.equal(slowResults.filter(result => result.outcome === 'deflect').length, 200, `17/250 @${hz}`);
        const fastResults = runCell({ speed: 177, lead: 250, hz, order: 'new' });
        assert.equal(fastResults.filter(result => result.outcome === 'hit').length, 200, `177/250 @${hz}`);
        const before = runCell({ speed: 17, lead: 250, hz, order: 'old' }).filter(result => result.outcome === 'deflect').length;
        t.diagnostic(`17/250 @${hz} Hz before ${before}/200 → after 200/200`);
    }
});

test('before: 177 u/s lead 100 ms only deflected when a frame ended inside the gap (~20% / ~38% / ~90%)', t => {
    const shares = RATES.map(hz => runCell({ speed: 177, lead: 100, hz, order: 'old' })
        .filter(result => result.outcome === 'deflect').length / 200);
    t.diagnostic(`before 177/100: ${RATES.map((hz, index) => `${hz} Hz ${(shares[index] * 100).toFixed(1)}%`).join(', ')}`);
    assert.ok(shares[0] < 0.3 && shares[1] < 0.5 && shares[2] > 0.75 && shares[2] < 1);
});

test('1× / 60 Hz: accept/reject identical for true leads 10..240 ms; contact moves by at most one frame of travel', t => {
    const dt = 1 / 60;
    const bands = { lateOnlyBefore: [], tailOnlyAfter: [] };
    let maxEarlier = 0;
    let maxLater = 0;
    for (let lead = -30; lead <= 300; lead += 2.5) {
        for (let index = 0; index < 48; index++) {
            const contactTime = 1 + (index / 48) * dt;
            const clicks = [contactTime - lead / 1000];
            const before = simulateApproach({ path: straightPath({ speed: 17, contactTime }), dt, clicks, order: 'old' });
            const after = simulateApproach({ path: straightPath({ speed: 17, contactTime }), dt, clicks, order: 'new' });
            const oldDeflect = before.outcome === 'deflect';
            const newDeflect = after.outcome === 'deflect';
            if (lead >= 10 && lead <= 240) assert.equal(newDeflect, oldDeflect, `lead ${lead} phase ${index}`);
            if (oldDeflect && !newDeflect) bands.lateOnlyBefore.push(lead);
            if (newDeflect && !oldDeflect) bands.tailOnlyAfter.push(lead);
            if (oldDeflect && newDeflect) {
                const shift = after.point.x - before.point.x; // +x = earlier along the −x path
                maxEarlier = Math.max(maxEarlier, shift);
                maxLater = Math.max(maxLater, -shift);
            }
        }
    }
    const frameTravel = 17 * dt;
    assert.ok(maxEarlier <= frameTravel + 1e-9 && maxLater <= frameTravel / 2 + 1e-9);
    // The only differences are the edges the in-frame rule defines: clicks
    // landing after the ball reached the body (old accepted up to one frame
    // late) and the swing's last 220 ms edge (old closed it ~1.5 frames early).
    assert.ok(bands.lateOnlyBefore.every(lead => lead < 10));
    assert.ok(bands.tailOnlyAfter.every(lead => lead > 240));
    const range = list => list.length ? `${Math.min(...list)}..${Math.max(...list)} ms (${list.length} approaches)` : 'none';
    t.diagnostic(`contact shift vs before: up to ${maxEarlier.toFixed(3)} u earlier / ${maxLater.toFixed(3)} u later (frame travel ${frameTravel.toFixed(3)} u)`);
    t.diagnostic(`accepted before only (late click after body contact): true lead ${range(bands.lateOnlyBefore)}`);
    t.diagnostic(`accepted after only (swing tail to 220 ms): true lead ${range(bands.tailOnlyAfter)}`);
});

test('committed hard bot (ready ≤ entry) deflects 100% at 1×/5×/10× and 30/60/144 Hz', t => {
    for (const speed of [17.7, 88.5, 177]) {
        const row = [];
        for (const hz of RATES) {
            const dt = 1 / hz;
            const random = mulberry32(Math.round(speed * 10) + hz);
            let after = 0;
            let before = 0;
            for (let index = 0; index < 200; index++) {
                const contactTime = 0.2 + random() * dt;
                if (simulateBotApproach({ speed, dt, contactTime, order: 'new' }).outcome === 'deflect') after++;
                if (simulateBotApproach({ speed, dt, contactTime, order: 'old' }).outcome === 'deflect') before++;
            }
            assert.equal(after, 200, `${speed} u/s @${hz} Hz`);
            if (speed === 177 && hz === 60) assert.ok(before < 80, `before ${before}`);
            row.push(`${hz} Hz ${before}/200 → ${after}/200`);
        }
        t.diagnostic(`hard bot ${speed} u/s: ${row.join(', ')}`);
    }
});

// ---------------------------------------------------------------------------
// Swing live interval (Player) and whiff bookkeeping.
// ---------------------------------------------------------------------------

test('Player swing live interval: half-frame click estimate, full 220 ms, tail past attackActive, none after a consumed swing', () => {
    // Mirrored timer code is the shipped code.
    assert.match(playerSource, /this\._swingAgePending = true;\s+this\._swingLiveWindow = this\.attackActive;\s+this\.swingTail = false;/);
    assert.match(playerSource, /this\.attackActive -= dt;\s+(\/\/[^\n]*\s+)*this\.swingTail = this\.attacking && this\.attackActive <= 0;\s+if \(this\.attackActive <= 0\) \{\s+this\.attackActive = 0;\s+this\.attacking = false;/);
    assert.match(playerSource, /\} else if \(this\.swingTail\) \{\s+this\.swingAge \+= dt;\s+if \(\(this\.swingClickDt > 0 \? this\.swingClickDt \/ 2 : 0\) - this\.swingAge \+ this\._swingLiveWindow < 0\) \{\s+this\.swingTail = false;/);

    for (const hz of RATES) {
        const dt = 1 / hz;
        const player = new SimPlayer();
        player.tryAttack();
        const interval = { start: 0, end: 0 };
        let frame = 0;
        let lastLiveEnd = null;
        for (; frame < 60; frame++) {
            player.update(dt);
            if (!player.getSwingLiveInterval(interval)) break;
            // Absolute (click-frame-start based) interval is fixed.
            assert.ok(Math.abs(interval.start + frame * dt - dt / 2) < 1e-9);
            assert.ok(Math.abs(interval.end - interval.start - SWING_ACTIVE_WINDOW) < 1e-9);
            lastLiveEnd = interval.end;
        }
        // Live until the frame containing click + 220 ms, never past it.
        assert.ok(lastLiveEnd >= 0 && lastLiveEnd <= dt + 1e-9, `${hz} Hz last end ${lastLiveEnd}`);
        assert.ok(frame * dt >= dt / 2 + SWING_ACTIVE_WINDOW - 1e-9);

        const consumed = new SimPlayer();
        consumed.tryAttack();
        consumed.update(dt);
        consumed.attacking = false; // handler consumed the swing
        for (let index = 0; index < 60; index++) {
            consumed.update(dt);
            assert.equal(consumed.getSwingLiveInterval(interval), false);
        }
    }
});

test('a swing in its live tail is not a whiff yet; the miss lands once the tail is over', () => {
    const STATES = { PLAYING: 'PLAYING' };
    const update = compileGameMethod('_updateLocalDeflectAttempt', { STATES, Math });
    const messages = [];
    const player = { alive: true, attacking: false, swingTail: true, knifeAttackType: 'slash', position: { x: 0, y: 0, z: 0 } };
    const game = {
        state: 'PLAYING',
        player,
        ball: { active: true, targetPlayer: player, position: { x: 1, y: 0, z: 0 }, velocity: { x: -20, y: 0, z: 0 } },
        ui: { showMessage: text => messages.push(text) },
        audio: {},
        _localDeflectAttemptActive: true,
        _localDeflectAttemptHit: false,
        _localDeflectAttemptResolved: false,
        _localDeflectAttemptRemaining: 0,
        _localDeflectAttemptWindow: 0.2,
        _clearLocalDeflectAttempt: compileGameMethod('_clearLocalDeflectAttempt'),
        _onReplay: null
    };
    update.call(game, 1 / 60);
    assert.deepEqual(messages, []);
    assert.equal(game._localDeflectAttemptActive, true);
    player.swingTail = false;
    update.call(game, 1 / 60);
    assert.deepEqual(messages, ['MISSED DEFLECT — TIME IT CLOSER']);
});

// ---------------------------------------------------------------------------
// Allocation and source wiring.
// ---------------------------------------------------------------------------

test('contact resolution adds no per-frame allocation', t => {
    const player = new SimPlayer({ team: 'blue' });
    const bot = createBot({ difficulty: 'hard', committed: true, x: 30, team: 'blue' });
    const ball = createBall({ position: { x: 20, y: 1.25, z: 0 }, speed: 177, target: player });
    const game = createContactGame({ player, bots: [bot], ball, throwerTeam: 'red' });
    player.tryAttack();
    player.update(1 / 60);
    bot.deflectReadyAt = 0;
    game._resolveFrameContacts(1 / 60, true, false); // lazy scratch init
    allocation.count = 0;
    for (let frame = 0; frame < 1000; frame++) {
        ball._prevPosition.set(20 + frame * 0.001, 1.25, 5);
        ball.position.set(19 + frame * 0.001, 1.25, 5);
        assert.equal(game._resolveFrameContacts(1 / 60, true, frame % 2 === 0), null);
    }
    t.diagnostic(`scratch Vector3 constructions in 1000 resolved frames: ${allocation.count}`);
    assert.equal(allocation.count, 0);
    const body = extractGameMethod('_resolveFrameContacts');
    assert.equal((body.match(/\bnew THREE\.Vector3\(\)/g) || []).length, 3, 'only the lazy ??= scratch (centre, end, _sweptInterp)');
    assert.match(body, /const frame = this\._frameContact \?\?= \{/);
});

test('updatePlaying order (host/solo): bot readiness → ball step → in-frame resolution → whiff bookkeeping', () => {
    const playing = extractGameMethod('updatePlaying');
    const ready = playing.indexOf('bot.advanceDeflectReady(this.ball, dt)');
    const step = playing.indexOf('const bounced = this.ball.update(dt);');
    const resolve = playing.indexOf('const frameContact = this._resolveFrameContacts(dt, authoritative, ballBounced);');
    const whiff = playing.indexOf('this._updateLocalDeflectAttempt(dt);');
    const hitReturn = playing.indexOf("if (frameContact === 'hit') return;");
    assert.ok(ready > 0 && ready < step && step < resolve && resolve < whiff && whiff < hitReturn, `${ready} ${step} ${resolve} ${whiff} ${hitReturn}`);
    assert.equal((playing.match(/this\._updateLocalDeflectAttempt\(dt\);/g) || []).length, 1);
    assert.doesNotMatch(playing, /bot\.tryDeflect\(/, 'live play never uses the frame-edge bot check');
    assert.doesNotMatch(playing, /segmentIntersectsSphere/);
    // Client prediction: presentation only, rendered segment, before the visual step.
    const client = playing.slice(playing.indexOf('if (!authoritative && practiceAttacking) {'), playing.indexOf('this.ball._clientVisualUpdate(dt);'));
    assert.match(client, /segmentSphereEntry\(this\.ball\._prevPosition \|\| ballPos, ballPos, playerPos, deflectionRange\) >= 0/);
    assert.match(client, /const deflectionRange = this\.ball\.attackRange \* 1\.5 \+ speedBonus;/);
    // Countdown / warm-up path untouched.
    assert.match(gameSource, /if \(this\.player\.alive && this\.player\.isAttacking\(\)\) \{\s+const dist = this\.ball\.position\.distanceTo\(this\.player\.getPosition\(\)\);\s+if \(dist < this\.ball\.attackRange\) this\.handlePlayerDeflection\(\);\s+\}\s+if \(!this\.network\?\.connected \|\| this\.network\?\.isHost\) \{\s+this\.bots\.forEach\(bot => \{\s+if \(this\.ball\.active && bot\.tryDeflect\(this\.ball, dt\)\) this\.handleBotDeflection\(bot\);/);
});

test('contact wiring: deflect handlers run at the contact point; bot commit only after the decision; lead read with the contact offset', () => {
    const body = extractGameMethod('_resolveFrameContacts');
    assert.match(body, /ball\.position\.lerpVectors\(deflectFrom, end, playerS\);\s+this\._deflectContactOffset = playerS \* frameDt;\s+const deflected = this\.handlePlayerDeflection\(\);\s+this\._deflectContactOffset = 0;/);
    assert.match(body, /ball\.position\.lerpVectors\(deflectFrom, end, botS\);\s+deflectBot\.commitDeflect\(\);\s+this\.handleBotDeflection\(deflectBot\);/);
    assert.match(body, /if \(playerS <= botS && playerS <= hitS && playerS !== Infinity\) \{/, 'ties → deflect');
    assert.match(body, /if \(deflectBot && botS <= hitS\) \{/);
    assert.match(body, /if \(candidates && ball\._forceHit\) \{/);
    const handler = extractGameMethod('handlePlayerDeflection');
    assert.match(handler, /this\.audio\.playCue\?\.\('deflect-reject'\);\s+\}\s+return false;/);
    assert.match(extractGameMethod('_localDeflectLeadMs'), /\+ \(Number\.isFinite\(contactOffset\) \? contactOffset : 0\);/);
    // Bot readiness is range-free; the distance sample survives only in tryDeflect.
    assert.match(botSource, /tryDeflect\(ball, dt = 0\.016\) \{\s+if \(this\.observeDefenseIntent\(ball\) !== 'deflect'\) return false;\s+const dist = this\._defenseDistance;\s+\/\/[^\n]*\s+if \(!\(this\.advanceDeflectReady\(ball, dt\) <= dt\)\) return false;/);
});

// ---------------------------------------------------------------------------
// Real Ball physics + real Arena solid props: a deflect's contact point never
// sits inside a prop (the chord of a non-bounce frame is prop-free by the
// swept prop test; a bounce frame decides deflects on its end state).
// ---------------------------------------------------------------------------

const vendor = new URL('../vendor/three/', import.meta.url);
const threeUrl = new URL('three.module.js', vendor).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});

async function loadRealBall() {
    const THREE = await import(threeUrl);
    const { Arena } = await import('../js/arena.js');
    const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
    const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
    const { Ball } = await import(`data:text/javascript;base64,${Buffer.from(ballSource
        .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
        .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
        .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }')
    ).toString('base64')}`);
    return { THREE, Arena, Ball };
}

function propPenetration(point, radius, prop) {
    if (Number.isFinite(prop.minX)) {
        const dx = Math.max(prop.minX - point.x, 0, point.x - prop.maxX);
        const dy = Math.max(prop.minY - point.y, 0, point.y - prop.maxY);
        const dz = Math.max(prop.minZ - point.z, 0, point.z - prop.maxZ);
        return radius - Math.hypot(dx, dy, dz);
    }
    const radial = Math.max(0, Math.hypot(point.x - prop.pos.x, point.z - prop.pos.z) - prop.radius);
    const vertical = Math.max(prop.bottom - point.y, 0, point.y - prop.top);
    return radius - Math.hypot(radial, vertical);
}

test('real Ball + solid props: no deflect contact point ends inside a prop (60/144 Hz, 17–177 u/s)', async t => {
    const { THREE, Arena, Ball } = await loadRealBall();
    const random = mulberry32(99);
    let deflects = 0;
    let bounceFrameDeflects = 0;
    let worst = -Infinity;
    for (let trial = 0; trial < 600; trial++) {
        const arena = {
            bounds: { minX: -40, maxX: 40, minY: 0, minZ: -40, maxZ: 40, maxY: 30 },
            ceilingHeight: 0, config: {}, collidables: [], platforms: [], jumpPads: [],
            addCollidable: Arena.prototype.addCollidable,
            _markSolidColumn: Arena.prototype._markSolidColumn,
            _addSolidBox: Arena.prototype._addSolidBox,
            _addSolidCylinder: Arena.prototype._addSolidCylinder,
            getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
        };
        // One or two props inside the 2.5 u deflect sphere region, clear of the body.
        for (let index = 0; index < 1 + Math.floor(random() * 2); index++) {
            const angle = random() * Math.PI * 2;
            const distance = 1.6 + random() * 2.5;
            const x = Math.cos(angle) * distance;
            const z = Math.sin(angle) * distance;
            if (random() < 0.6) Arena.prototype._addSolidBox.call(arena, null, x, z, 0.2 + random() * 0.6, 0.2 + random() * 0.6, 0.6 + random() * 1.6);
            else Arena.prototype._addSolidCylinder.call(arena, null, x, 0, z, 0.2 + random() * 0.4, 0.6 + random() * 2, false);
        }
        const material = () => new THREE.ShaderMaterial({ uniforms: {
            uColor: { value: new THREE.Color() }, uTexture: { value: null },
            uTextureEnabled: { value: false }, uRimPower: { value: 5 }
        } });
        const ball = new Ball({ scene: new THREE.Scene(), createToonMaterial: material, createOutlineMesh: g => new THREE.Mesh(g), _quality: 'low' }, arena);
        ball._emitTrail = () => {};
        ball.updateTrail = () => {};
        ball.spawn();
        ball._noHitTimer = 0;
        ball.targetPlayer = null;
        ball.state = 'homing';
        const speed = 17 + random() * 160;
        const angle = random() * Math.PI * 2;
        ball.position.set(Math.cos(angle) * 9, 0.8 + random() * 1.6, Math.sin(angle) * 9);
        const aimX = (random() - 0.5) * 2;
        const aimZ = (random() - 0.5) * 2;
        ball.velocity.set(aimX - ball.position.x, 1.25 - ball.position.y, aimZ - ball.position.z).normalize().multiplyScalar(speed);
        ball.currentSpeed = speed;
        ball._prevPosition = ball.position.clone();

        const player = new SimPlayer({ team: 'blue' });
        player.attacking = true;
        player._swingLiveWindow = 10;
        player.swingAge = 1;
        const game = createContactGame({ player, ball, throwerTeam: 'red' });
        // Always facing the ball: only geometry decides.
        game._isDeflectFacingBall = () => true;
        const dt = trial % 2 ? 1 / 60 : 1 / 144;
        for (let frame = 0; frame < 120; frame++) {
            const bounced = !!ball.update(dt);
            const result = game._resolveFrameContacts(dt, true, bounced);
            if (result === 'deflect') {
                deflects++;
                if (bounced) bounceFrameDeflects++;
                for (const prop of arena.collidables) {
                    if (!Number.isFinite(prop.top)) continue;
                    const depth = propPenetration(ball.position, ball.radius, prop);
                    worst = Math.max(worst, depth);
                    assert.ok(depth <= 1e-3, `trial ${trial}: contact ${ball.position.x.toFixed(3)},${ball.position.y.toFixed(3)},${ball.position.z.toFixed(3)} inside a prop by ${depth}`);
                }
                break;
            }
            if (result === 'hit' || !ball.active) break;
        }
    }
    t.diagnostic(`${deflects} deflects (${bounceFrameDeflects} on a bounce frame), deepest prop overlap at contact ${worst.toFixed(4)} u (≤ 0 = clear)`);
    assert.ok(deflects > 300);
});

// ---------------------------------------------------------------------------
// Geometry utilities.
// ---------------------------------------------------------------------------

function lerp(a, b, s) {
    return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s };
}

function pointSegmentDistance(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    const s = lengthSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / lengthSq)) : 0;
    const dx = p.x - (a.x + abx * s), dy = p.y - (a.y + aby * s), dz = p.z - (a.z + abz * s);
    return dx * dx + dy * dy + dz * dz;
}

function pointAxisDistance(p, feetY, height) {
    const y = Math.max(feetY, Math.min(feetY + height, p.y));
    return Math.hypot(p.x, p.y - y, p.z);
}

// Exact distance between the segment a→b and the axis (0, feetY..feetY+height, 0)
// (closest points of two segments, Ericson §5.1.9).
function segmentAxisDistance(a, b, feetY, height) {
    const d1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const d2 = { x: 0, y: height, z: 0 };
    const r = { x: a.x, y: a.y - feetY, z: a.z };
    const aa = d1.x * d1.x + d1.y * d1.y + d1.z * d1.z;
    const e = height * height;
    const f = d2.y * r.y;
    const clamp = value => Math.max(0, Math.min(1, value));
    let s;
    let u;
    if (aa <= 1e-18) {
        s = 0;
        u = clamp(f / e);
    } else {
        const c = d1.x * r.x + d1.y * r.y + d1.z * r.z;
        const bb = d1.y * d2.y;
        const denom = aa * e - bb * bb;
        s = denom > 1e-18 ? clamp((bb * f - c * e) / denom) : 0;
        u = (bb * s + f) / e;
        if (u < 0) { u = 0; s = clamp(-c / aa); } else if (u > 1) { u = 1; s = clamp((bb - c) / aa); }
    }
    const p = lerp(a, b, s);
    return Math.hypot(p.x, p.y - (feetY + u * height), p.z);
}

// Frame-sized random segments around a grounded or perched capsule.
function randomCapsuleCase(random) {
    const speed = 17 + random() * 160;
    const dt = [1 / 30, 1 / 60, 1 / 144][Math.floor(random() * 3)];
    const length = speed * dt;
    const feetY = random() < 0.5 ? 0 : random() * 3;
    const capsuleRadius = 0.4 + Math.min(speed * 0.003, 2.0);
    const R = BALL_RADIUS + capsuleRadius;
    const a = { x: (random() * 2 - 1) * 4, y: feetY + random() * 3 - 0.5, z: (random() * 2 - 1) * 4 };
    let dx = random() * 2 - 1;
    let dy = (random() * 2 - 1) * 0.4;
    let dz = random() * 2 - 1;
    const norm = Math.hypot(dx, dy, dz) || 1;
    dx /= norm; dy /= norm; dz /= norm;
    const b = { x: a.x + dx * length, y: a.y + dy * length, z: a.z + dz * length };
    return { a, b, feetY, height: 1.7, R, capsuleRadius, speed };
}

// Today's G1 sampling (end point + sweptHitStepCount interior samples, and
// optionally the start, which the previous frame tested as its end point).
// Returns the earliest inside sample fraction or −1.
function sampledHit(a, b, feetY, height, capsuleRadius, { includeStart = true } = {}) {
    if (includeStart && capsuleContact(a, 0, 0, feetY, height, capsuleRadius, BALL_RADIUS)) return 0;
    const travelled = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = sweptHitStepCount(travelled, BALL_RADIUS + capsuleRadius);
    for (let s = 1; s <= steps; s++) {
        const f = s / (steps + 1);
        if (capsuleContact(lerp(a, b, f), 0, 0, feetY, height, capsuleRadius, BALL_RADIUS)) return f;
    }
    return capsuleContact(b, 0, 0, feetY, height, capsuleRadius, BALL_RADIUS) ? 1 : -1;
}
