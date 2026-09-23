// G3 "Deflect tiers you earn with timing": the deflect tier is the click lead —
// how many ms before the ball would have reached the defender's body capsule
// the swing started. Covers the pure helpers, a pure-kinematics simulation of
// the shipped frame order (G2: player.update → ball step → in-frame contact
// resolution, tests/frame-contact-sim.mjs) using the real
// Game._resolveFrameContacts/_localDeflectLeadMs, and the host authority path
// for remote deflects using the real Game.remoteAttack/_remoteDeflectLeadMs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DEFLECT_TIMING_WINDOWS,
    REMOTE_SWING_AGE_LIMITS,
    classifyDeflectLead,
    classifyDeflectTiming,
    predictContactMs,
    resolvePerfectDeflect,
    sanitizeRemoteSwingAgeMs
} from '../js/perfect-deflect.js';
import { capsuleContact, targetFeetY } from '../js/combat.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';
import { simulateApproach, straightPath } from './frame-contact-sim.mjs';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const ballSource = readFileSync(new URL('../js/ball.js', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

// Mirrors of shipped tuning; pinned below so the simulation cannot drift.
const BALL_RADIUS = 0.47;
const HIT_RANGE = 0.7;
const ATTACK_RANGE = 2.0;
const SWING_ACTIVE_WINDOW = 0.22;
const ATTACK_COOLDOWN = 0.6;
const EYE_HEIGHT = 1.7;
const CHEST_OFFSET = -0.45; // Ball.BODY_ZONES.chest relative to the eye

test('simulation constants match the shipped Ball/Player tuning', () => {
    assert.match(ballSource, /this\.radius = 0\.47;/);
    assert.match(ballSource, /this\.attackRange = 2\.0;/);
    assert.match(ballSource, /this\.hitRange = 0\.7;/);
    assert.match(ballSource, /chest:\s+\{ y: -0\.45,/);
    assert.match(ballSource, /this\.effectiveHitRange = this\.hitRange \+ Math\.min\(this\.currentSpeed \* 0\.003, 2\.0\);/);
    assert.match(playerSource, /export const SWING_ACTIVE_WINDOW = 0\.22;/);
    assert.match(playerSource, /const ATTACK_COOLDOWN = 0\.6;/);
    // swingAge: 0 when the swing opens; the opening frame reads 0 and records
    // its dt as swingClickDt, later frames add the same dt attackActive
    // consumes (mirrored by SimPlayer below).
    assert.match(playerSource, /this\.attackActive = Math\.min\(SWING_ACTIVE_WINDOW, this\.attackDuration\);\s+this\.swingAge = 0;\s+this\.swingClickDt = 0;\s+this\._swingAgePending = true;/);
    assert.match(playerSource, /if \(this\._swingAgePending\) \{\s+this\._swingAgePending = false;\s+this\.swingClickDt = dt;\s+\} else this\.swingAge \+= dt;\s+this\.attackActive -= dt;/);
    // Deflect range used by the solo/host in-frame contact resolution.
    assert.match(extractGameMethod('_resolveFrameContacts'), /const radius = ball\.attackRange \+ Math\.min\(ball\.currentSpeed \* 0\.003, 3\.0\);/);
});

test('classifyDeflectLead boundaries', () => {
    assert.deepEqual({ ...DEFLECT_TIMING_WINDOWS }, { perfect: 60, great: 140, normal: 400 });
    for (const lead of [0, 60, -5, -0]) assert.equal(classifyDeflectLead(lead), 'perfect', `lead ${lead}`);
    for (const lead of [60.01, 140]) assert.equal(classifyDeflectLead(lead), 'great', `lead ${lead}`);
    for (const lead of [140.01, 400, 400.01, 5000, NaN, Infinity, -Infinity, undefined, null, '30']) {
        assert.equal(classifyDeflectLead(lead), 'normal', `lead ${String(lead)}`);
    }
});

test('predictContactMs: capsule gap over speed, Infinity when unmeasurable, allocation-free', () => {
    // Grounded capsule 0..1.7, radius 0.4; ball 0.47 at chest height 5 u away.
    const ms = predictContactMs({ x: 5, y: 1.25, z: 0 }, 17, 0, 0, 0, 1.7, 0.4, 0.47);
    assert.ok(Math.abs(ms - (5 - 0.87) / 17 * 1000) < 1e-9);
    // Above the head the closest point is the capsule top.
    const over = predictContactMs({ x: 3, y: 5.7, z: 4 }, 10, 0, 0, 0, 1.7, 0.4, 0.47);
    assert.ok(Math.abs(over - (Math.hypot(3, 4, 4) - 0.87) / 10 * 1000) < 1e-9);
    assert.equal(predictContactMs({ x: 0.5, y: 1, z: 0 }, 17, 0, 0, 0, 1.7, 0.4, 0.47), 0, 'touching → 0');
    for (const speed of [0, 0.01, -5, NaN, Infinity, undefined]) {
        assert.equal(predictContactMs({ x: 5, y: 1, z: 0 }, speed, 0, 0, 0, 1.7, 0.4, 0.47), Infinity, `speed ${speed}`);
    }
    assert.equal(predictContactMs({ x: NaN, y: 1, z: 0 }, 17, 0, 0, 0, 1.7, 0.4, 0.47), Infinity);
    assert.equal(predictContactMs({ x: 5, y: 1, z: 0 }, 17, 0, 0, NaN, 1.7, 0.4, 0.47), Infinity);

    // Same capsule as the G1 hit test: zero predicted gap ⇔ capsuleContact.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let index = 0; index < 2000; index++) {
        const ball = { x: random() * 6 - 3, y: random() * 7 - 1, z: random() * 6 - 3 };
        const feet = random() < 0.5 ? 0 : 2.4;
        const contact = capsuleContact(ball, 0.2, -0.1, feet, 1.7, 0.55, 0.47);
        const predicted = predictContactMs(ball, 30, 0.2, -0.1, feet, 1.7, 0.55, 0.47);
        if (contact) assert.equal(predicted, 0);
        else assert.ok(predicted >= 0);
        if (predicted > 1e-9) assert.equal(contact, false);
    }

    const body = predictContactMs.toString();
    assert.doesNotMatch(body, /\bnew\b|\[|\{\s*\w+\s*:/, 'no per-call allocation');
});

// ---------------------------------------------------------------------------
// Pure-kinematics simulation of the shipped frame order.
// ---------------------------------------------------------------------------

// straightPath / simulateApproach live in tests/frame-contact-sim.mjs: one
// approach per call, clicks handled before the loop they fall in, then
// player.update → ball step → the real Game._resolveFrameContacts (G2), which
// grades the deflect with the real Game._localDeflectLeadMs at the contact.

// Every click phase inside one frame for a scripted lead.
function sweepPhases({ speed, lead, dt, samples = 48, feetY = 0, dir, aimY }) {
    const results = [];
    for (let index = 0; index < samples; index++) {
        const contactTime = 1 + (index / samples) * dt;
        const path = straightPath({ speed, contactTime, feetY, dir, aimY });
        const click = contactTime - lead / 1000;
        results.push({ ...simulateApproach({ path, dt, clicks: [click], feetY }), scriptedLead: lead });
    }
    return results;
}

test('predicted contact matches simulated G1 contact within max(2 ms, 1 frame)', () => {
    const dt = 1 / 60;
    for (const feetY of [0, 2.4]) {
        for (const speed of [17, 51, 88, 177]) {
            for (const phase of [0, 0.3, 0.77]) {
                const contactTime = 0.8 + phase * dt;
                const path = straightPath({ speed, contactTime, feetY });
                const start = path.at(0);
                const bonus = Math.min(speed * 0.003, 2.0);
                const predicted = predictContactMs(start, speed, 0, 0, feetY, 1.7, 0.4 + bonus, BALL_RADIUS);
                const simulated = simulateApproach({ path, dt, clicks: [], feetY });
                assert.equal(simulated.outcome, 'hit');
                const error = Math.abs(simulated.hitTime * 1000 - predicted);
                assert.ok(error <= Math.max(2, dt * 1000) + 1e-6,
                    `feet ${feetY} speed ${speed}: predicted ${predicted.toFixed(2)} vs simulated ${(simulated.hitTime * 1000).toFixed(2)}`);
            }
        }
    }
    // Serve-like diagonal descent aimed at the eye (capsule top).
    const len = Math.hypot(0.6, -0.35, 0.72);
    const dir = { x: -0.6 / len, y: -0.35 / len, z: -0.72 / len };
    const path = straightPath({ speed: 17, contactTime: 0.9, dir, aimY: EYE_HEIGHT });
    const predicted = predictContactMs(path.at(0), 17, 0, 0, 0, 1.7, 0.451, BALL_RADIUS);
    const simulated = simulateApproach({ path, dt, clicks: [] });
    assert.ok(Math.abs(simulated.hitTime * 1000 - predicted) <= Math.max(2, dt * 1000));
});

test('acceptance matrix: straight chest-height approach, grounded player, 60 Hz', () => {
    const dt = 1 / 60;
    const rows = [
        [17, 30, 'perfect'], [17, 100, 'great'], [17, 200, 'normal'], [17, 300, 'hit'],
        [88, 40, 'perfect'], [88, 110, 'great'], [88, 200, 'normal'],
        [177, 50, 'perfect'], [177, 130, 'great'], [177, 200, 'normal']
    ];
    for (const [speed, lead, expected] of rows) {
        const results = sweepPhases({ speed, lead, dt });
        const deflects = results.filter(result => result.outcome === 'deflect');
        for (const result of results) {
            assert.notEqual(result.outcome, 'none', `${speed}/${lead}: every approach resolves`);
        }
        if (expected === 'hit') {
            assert.equal(deflects.length, 0, `${speed}/${lead}: swing expired → hit`);
            continue;
        }
        // At 88/177 u/s a 60 Hz frame can step from outside deflect range into
        // the body (pre-existing, tier-independent). Every approach that is
        // accepted must carry the scripted tier.
        assert.ok(deflects.length > 0, `${speed}/${lead}: some phase is deflectable`);
        for (const result of deflects) {
            assert.equal(result.tier, expected, `${speed}/${lead}: L=${result.leadMs.toFixed(2)}`);
            const error = result.leadMs - lead;
            assert.ok(Math.abs(error) <= dt * 500 + 1e-6, `${speed}/${lead}: L=${result.leadMs}`);
        }
    }
});

test('half-frame compensation: mid-frame click reads the exact lead, a boundary click reads lead − dt/2', () => {
    for (const dt of [1 / 60, 1 / 144]) {
        for (const [speed, lead] of [[17, 30], [17, 100], [17, 200], [51, 45]]) {
            // Click exactly after a loop (the runtime harness case).
            const boundary = simulateApproach({ path: straightPath({ speed, contactTime: 1 + lead / 1000 }), dt, clicks: [1] });
            assert.equal(boundary.outcome, 'deflect');
            assert.ok(Math.abs(boundary.leadMs - (lead - dt * 500)) < 1e-6, `${speed}/${lead}: ${boundary.leadMs}`);
            // Click in the middle of its frame: the compensation is exact.
            const mid = simulateApproach({ path: straightPath({ speed, contactTime: 1 + dt / 2 + lead / 1000 }), dt, clicks: [1 + dt / 2] });
            assert.equal(mid.outcome, 'deflect');
            assert.ok(Math.abs(mid.leadMs - lead) < 1e-6, `${speed}/${lead}: ${mid.leadMs}`);
        }
    }
});

test('opening serve (homing descent) is graded too: 17 u/s, lead 40 → PERFECT', () => {
    const len = Math.hypot(0.6, -0.35, 0.72);
    const dir = { x: -0.6 / len, y: -0.35 / len, z: -0.72 / len };
    const results = sweepPhases({ speed: 17, lead: 40, dt: 1 / 60, dir, aimY: EYE_HEIGHT });
    const deflects = results.filter(result => result.outcome === 'deflect');
    assert.equal(deflects.length, results.length);
    assert.ok(deflects.every(result => result.tier === 'perfect'));
    // Classification never looks at ball state / the Ball approach window.
    for (const name of ['_localDeflectLeadMs', '_remoteDeflectLeadMs']) {
        assert.doesNotMatch(extractGameMethod(name), /\.state\b|perfectWindow|getPerfectTimingErrorMs/);
    }
});

test('measured lead stays within half a frame of the scripted lead at 1×..10× (card: one frame + 2 ms)', () => {
    const dt = 1 / 60;
    let checked = 0;
    for (let multiple = 1; multiple <= 10; multiple++) {
        const speed = 17 * multiple;
        for (const lead of [0, 15, 35, 60, 90, 120, 150, 180, 210]) {
            for (const result of sweepPhases({ speed, lead, dt, samples: 16 })) {
                if (result.outcome !== 'deflect') continue;
                checked++;
                const error = result.leadMs - lead;
                assert.ok(Math.abs(error) <= dt * 500 + 1e-6, `${speed}/${lead}: L=${result.leadMs}`);
            }
        }
    }
    assert.ok(checked > 500);
});

test('same lead → same tier at 30/60/120/144 Hz (except within one frame of a threshold)', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 144]) {
        const frameMs = dt * 1000;
        for (const speed of [17, 51, 88]) {
            for (const lead of [10, 25, 40, 55, 85, 100, 115, 125, 160, 200]) {
                const nearThreshold = [DEFLECT_TIMING_WINDOWS.perfect, DEFLECT_TIMING_WINDOWS.great]
                    .some(threshold => Math.abs(lead - threshold) < frameMs);
                if (nearThreshold) continue;
                for (const result of sweepPhases({ speed, lead, dt, samples: 24 })) {
                    if (result.outcome !== 'deflect') continue;
                    assert.equal(result.tier, classifyDeflectLead(lead), `${Math.round(1 / dt)} Hz ${speed}/${lead}: L=${result.leadMs}`);
                }
            }
        }
    }
});

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Spam: Mouse1 every 0.6 s at a random phase. Skill: one click, lead ~ N(40, 15) ms.
// Shares are PERFECT / successful deflects (a 10× ball is only deflectable when
// a 60 Hz frame lands in its ~6 ms range window — pre-existing, tier-blind).
function timingStudy({ mode, speed, dt = 1 / 60, approaches, seed }) {
    const random = mulberry32(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    let deflects = 0;
    let perfects = 0;
    for (let approach = 0; approach < approaches; approach++) {
        const contactTime = 1.2 + random() * 0.6;
        const clicks = [];
        if (mode === 'skill') {
            clicks.push(contactTime - (40 + 15 * gaussian()) / 1000);
        } else {
            for (let time = random() * ATTACK_COOLDOWN; time < contactTime + 0.5; time += ATTACK_COOLDOWN) clicks.push(time);
        }
        const result = simulateApproach({ path: straightPath({ speed, contactTime }), dt, clicks });
        if (result.outcome !== 'deflect') continue;
        deflects++;
        if (result.tier === 'perfect') perfects++;
    }
    return { deflects, perfects, share: perfects / deflects };
}

function reportStudy(t, mode, speed, hz, study) {
    t.diagnostic(`${mode} ${speed} u/s @${hz} Hz: ${study.perfects}/${study.deflects} perfect (${(study.share * 100).toFixed(1)}%) over ${STUDY_APPROACHES} approaches`);
}

// SOL G3 gates (20000 approaches; a 1000-approach sample has ~±1 pt noise):
// spam PERFECT ≤ 33% at 60 and 144 Hz, 1× and 10×; skill PERFECT ≥ 85% at 60
// and 144 Hz. 30 Hz is reported only (frame quantization, WARN).
const STUDY_APPROACHES = 20000;

function gateStudy(t, mode, hz, speed) {
    const study = timingStudy({ mode, speed, dt: 1 / hz, approaches: STUDY_APPROACHES, seed: (mode === 'spam' ? 1 : 2) * 100000 + hz * 1000 + speed });
    reportStudy(t, mode, speed, hz, study);
    return study;
}

test('spam gate: Mouse1 every 0.6 s at a random phase earns PERFECT on ≤ 33% of deflects (60/144 Hz, 1× and 10×)', t => {
    for (const hz of [60, 144]) {
        for (const speed of [17, 170]) {
            const study = gateStudy(t, 'spam', hz, speed);
            assert.ok(study.deflects > 1000);
            assert.ok(study.share <= 0.33, `spam ${hz} Hz ${speed} u/s perfect share ${study.share}`);
        }
    }
});

// Half-frame compensation (Game._localDeflectLeadMs subtracts swingClickDt/2)
// makes the measured lead unbiased: scripted lead ± half a frame.
test('skill gate: lead ~ N(40, 15) ms earns PERFECT on ≥ 85% of deflects (60/144 Hz, 1× and 10×)', t => {
    for (const hz of [60, 144]) {
        for (const speed of [17, 170]) {
            const study = gateStudy(t, 'skill', hz, speed);
            assert.ok(study.share >= 0.85, `skill ${hz} Hz ${speed} u/s perfect share ${study.share}`);
        }
    }
});

test('30 Hz spam/skill shares are reported (WARN: frame quantization, not gated)', t => {
    for (const mode of ['spam', 'skill']) {
        for (const speed of [17, 170]) {
            const study = gateStudy(t, mode, 30, speed);
            assert.ok(study.deflects > 0);
        }
    }
});

test('before counterexample: the old approach-window read could not grade a straight 17 u/s ball', () => {
    // Pre-G3 host read: Ball.perfectWindow opened (0.25 s) when the ball came
    // within perfectRange 2.8 of the target point in `rally`, ticked by dt, and
    // was classified as |remaining ms| against the old 50/100/180 windows.
    const oldWindows = { perfect: 50, great: 100, normal: 180 };
    const dt = 1 / 60;
    const speed = 17;
    const tiers = new Set();
    for (let lead = 0; lead <= 220; lead += 5) {
        for (let index = 0; index < 12; index++) {
            const contactTime = 1 + (index / 12) * dt;
            const path = straightPath({ speed, contactTime });
            const chest = { x: 0, y: EYE_HEIGHT + CHEST_OFFSET, z: 0 };
            // Replay the ball steps to find the window value at the deflect frame.
            const result = simulateApproach({ path, dt, clicks: [contactTime - lead / 1000] });
            if (result.outcome !== 'deflect') continue;
            let window = 0;
            let opened = false;
            const position = { x: 0, y: 0, z: 0 };
            for (let j = 1; j < result.frame; j++) {
                path.at(j * dt, position);
                const distance = Math.hypot(position.x - chest.x, position.y - chest.y, position.z - chest.z);
                if (!opened && distance < 2.8 && distance > HIT_RANGE) {
                    window = 0.25;
                    opened = true;
                }
                if (window > 0) window = Math.max(0, window - dt);
            }
            const oldTiming = window > 0 ? window * 1000 : oldWindows.normal;
            tiers.add(classifyDeflectTiming(oldTiming, oldWindows) || 'normal');
        }
    }
    assert.deepEqual([...tiers], ['normal']);
    // The local path was stricter still: it read the window after
    // deflectWithAim → setTarget(next) had already zeroed it (always NORMAL).
    assert.match(ballSource, /setTarget\(target\) \{\s+if \(this\.targetPlayer !== target\) \{\s+this\._resetSteering\(\);\s+this\.perfectWindow = 0;/);
});

test('outcome invariance: deflect launch arguments are untouched by the tier', () => {
    const local = extractGameMethod('handlePlayerDeflection');
    assert.match(local, /this\.ball\.deflectWithAim\(pos, aimDir, nextTarget, flick, null, chargedPower\);/);
    assert.match(local, /this\.ball\.deflectWithAim\(pos, aimDir, nextTarget, flick, momentum, chargedPower\);/);
    const remote = extractGameMethod('remoteAttack');
    assert.match(remote, /this\.ball\.deflectWithAim\(attackPos, p\.aimDir, target, data\.flick \|\| \{ vertical: 0, horizontal: 0, power: 0 \}, null, finalDeflectPower\);/);
    assert.match(remote, /if \(isPerfect\) \{\s+finalDeflectPower \*= 1\.3;/);
    // Ball.deflectWithAim never reads its deflectPower argument, so the remote
    // perfect ×1.3 stays inert (velocity/speed are tier-independent).
    const start = ballSource.indexOf('    deflectWithAim(fromPos, aimDir, target');
    const end = ballSource.indexOf('\n    deflect(fromPos', start);
    const body = ballSource.slice(ballSource.indexOf(') {', start) + 3, end);
    assert.doesNotMatch(body, /deflectPower/);
});

test('P2P client sends only a bounded integer swing-age hint', () => {
    const local = extractGameMethod('handlePlayerDeflection');
    // The client applies its own half-frame click compensation before sending,
    // so host and client grade identical input identically.
    assert.match(local, /sa: Math\.min\(400, Math\.max\(0, Math\.round\(\(\(Number\(this\.player\.swingAge\) \|\| 0\) - \(Number\(this\.player\.swingClickDt\) \|\| 0\) \/ 2\) \* 1000\)\)\)/);
    assert.doesNotMatch(local, /sendAttack\?\.\(\{[^}]*\b(tier|perfect|leadMs|contactMs)\b/);
    // The host never compensates client-reported data itself.
    assert.doesNotMatch(extractGameMethod('_remoteDeflectLeadMs'), /swingClickDt/);
    assert.match(extractGameMethod('_localDeflectLeadMs'), /clickDt \/ 2/);
});

// ---------------------------------------------------------------------------
// Host authority for remote deflects.
// ---------------------------------------------------------------------------

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(other) { return this.set(other.x, other.y, other.z); }
    clone() { return new Vector3(this.x, this.y, this.z); }
    normalize() {
        const length = Math.hypot(this.x, this.y, this.z) || 1;
        this.x /= length; this.y /= length; this.z /= length;
        return this;
    }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    applyAxisAngle() { return this; }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

function hostFixture({ hostBall = new Vector3(1.4, 1.25, 0), speed = 17 } = {}) {
    let now = 1000;
    const resolveCalls = [];
    const analytics = [];
    const broadcasts = [];
    const remote = {
        name: 'Remote',
        team: 'red',
        peerId: 'remote-peer',
        queuedForNextRound: false,
        alive: true,
        position: new Vector3(0, 1.7, 0),
        aimDir: new Vector3(1, 0, 0),
        deflectPower: 1,
        animator: { play() {} },
        onSuccessfulDeflect() {}
    };
    const ball = {
        active: true,
        state: 'rally',
        position: hostBall.clone(),
        velocity: new Vector3(-speed, 0, 0),
        currentSpeed: speed,
        baseSpeed: 17,
        attackRange: ATTACK_RANGE,
        hitRange: HIT_RANGE,
        effectiveHitRange: HIT_RANGE + Math.min(speed * 0.003, 2.0),
        radius: BALL_RADIUS,
        homingStrength: 0,
        _affixSplit: false,
        lastPerfectBy: null,
        // Mutates like the real launch: the tier must already be decided.
        deflectWithAim() {
            this.position.set(40, 9, 40);
            this.currentSpeed = 999;
            return { shot: 'flat' };
        },
        setTarget() {}
    };
    const context = {
        state: 'PLAYING',
        network: { isHost: true, broadcast: packet => broadcasts.push(packet) },
        remotePlayers: new Map([['remote-player', remote]]),
        ball,
        experimentalNetcode: { enabled: false },
        _remotePerfectChains: new Map(),
        _lastRemoteAttack: null,
        _pendingLethalHit: null,
        getAimedEnemy: () => null,
        _applyPerfectDeflectCooldownCut() { return 0; },
        _claimOpeningOwner() {},
        _pushDeflectHistory() {},
        _applyRallyHeat() {},
        scoreboard: { recordDeflection() {} },
        matchAnalytics: { recordDeflect: entry => analytics.push(entry.tier) },
        audio: { playDeflect() {} },
        rallyCount: 0
    };
    context._isDeflectFacingBall = compileGameMethod('_isDeflectFacingBall', { DEFLECT_MIN_FACING_DOT: 0.15, Math });
    context._remoteDeflectLeadMs = compileGameMethod('_remoteDeflectLeadMs', { predictContactMs, sanitizeRemoteSwingAgeMs, targetFeetY });
    const remoteAttack = compileGameMethod('remoteAttack', {
        STATES: { PLAYING: 'PLAYING', COUNTDOWN: 'COUNTDOWN' },
        THREE: { Vector3 },
        performance: { now: () => now },
        setTimeout() {},
        clearTimeout() {},
        scaleDedupWindowMs: base => base,
        normalizeNetcode: value => value,
        rewindSnapshot: () => null,
        resolvePerfectDeflect: options => {
            resolveCalls.push(options.leadMs);
            return resolvePerfectDeflect(options);
        }
    });
    let sequence = 0;
    return {
        context,
        remote,
        ball,
        resolveCalls,
        analytics,
        broadcasts,
        attack(overrides = {}) {
            now += 1000; // outside the dedup window
            ball.position.copy(hostBall);
            ball.currentSpeed = speed;
            remoteAttack.call(context, 'remote-player', {
                attackId: `a-${++sequence}`,
                name: 'Remote',
                x: 0, y: 1.7, z: 0,
                ax: 1, ay: 0, az: 0,
                bx: hostBall.x, by: hostBall.y, bz: hostBall.z,
                action: 'slash',
                ...overrides
            }, 'remote-peer');
            return {
                accepted: broadcasts.length,
                tier: analytics.at(-1),
                leadMs: resolveCalls.at(-1),
                perfectFlag: broadcasts.at(-1)?.perfect
            };
        }
    };
}

function hostContactMs(position, speed) {
    return predictContactMs(position, speed, 0, 0, 0, 1.7, 0.4 + Math.min(speed * 0.003, 2.0), BALL_RADIUS);
}

test('sanitizeRemoteSwingAgeMs: finite integer 0..400, clamped to 240', () => {
    assert.deepEqual({ ...REMOTE_SWING_AGE_LIMITS }, { acceptMaxMs: 400, clampMaxMs: 240 });
    assert.equal(sanitizeRemoteSwingAgeMs(0), 0);
    assert.equal(sanitizeRemoteSwingAgeMs(240), 240);
    assert.equal(sanitizeRemoteSwingAgeMs(241), 240);
    assert.equal(sanitizeRemoteSwingAgeMs(400), 240);
    for (const value of [401, -1, 12.5, NaN, Infinity, -Infinity, '30', null, undefined, {}, [30], true]) {
        assert.equal(sanitizeRemoteSwingAgeMs(value), null, String(value));
    }
});

test('host grades remote deflects from its own contact + the bounded sa hint', () => {
    const fixture = hostFixture();
    const contact = hostContactMs(new Vector3(1.4, 1.25, 0), 17);
    assert.ok(contact > 20 && contact < 40, `fixture contact ${contact}`);

    const perfect = fixture.attack({ sa: 17 });
    assert.equal(perfect.accepted, 1);
    assert.ok(Math.abs(perfect.leadMs - (17 + contact)) < 1e-9);
    assert.equal(perfect.tier, 'perfect');
    assert.equal(perfect.perfectFlag, true);
    assert.equal(fixture.ball.lastPerfectBy, fixture.remote);

    const great = fixture.attack({ sa: 100 });
    assert.equal(great.tier, 'great');
    assert.equal(fixture.ball.lastPerfectBy, null, 'a non-perfect deflect clears the ✨PERFECT tag');

    const clamped = fixture.attack({ sa: 400 });
    assert.ok(Math.abs(clamped.leadMs - (240 + contact)) < 1e-9);
    assert.equal(clamped.tier, 'normal');
});

test('missing/invalid/out-of-range sa → NORMAL with accept/reject unchanged; client tier fields ignored', () => {
    const fixture = hostFixture();
    const cases = [
        {},
        { sa: -1 }, { sa: 401 }, { sa: 12.5 }, { sa: '10' }, { sa: null }, { sa: NaN }, { sa: Infinity },
        { tier: 'perfect', perfect: true, timingErrorMs: 0, leadMs: 0, contactMs: 0, reactionMs: 0 }
    ];
    for (const [index, overrides] of cases.entries()) {
        const result = fixture.attack(overrides);
        assert.equal(result.accepted, index + 1, `case ${index} accepted like any deflect`);
        assert.equal(result.leadMs, Infinity);
        assert.equal(result.tier, 'normal', `case ${index}`);
        assert.equal(result.perfectFlag, false);
    }
    assert.equal(fixture.context.rallyCount, cases.length);

    // Rejection is equally independent of the hint: an out-of-range ball with
    // no plausible snapshot is rejected whatever sa says.
    const far = hostFixture({ hostBall: new Vector3(30, 1.25, 0) });
    const rejected = far.attack({ sa: 0, bx: undefined, by: undefined, bz: undefined });
    assert.equal(rejected.accepted, 0);
    assert.equal(far.resolveCalls.length, 0);

    const remote = extractGameMethod('remoteAttack');
    assert.doesNotMatch(remote, /data\.(tier|perfect|timingErrorMs|leadMs|contactMs|reactionMs)\b/);
    assert.doesNotMatch(extractGameMethod('_remoteDeflectLeadMs'), /\bdata\b/);
});

test('host contact uses resolvedBallPos and its own ball speed, read before deflectWithAim', () => {
    // Host ball 2.2 u out; the client snapshot (plausible) is 1.5 u out.
    const fixture = hostFixture({ hostBall: new Vector3(2.2, 1.25, 0), speed: 51 });
    const snapshot = new Vector3(1.5, 1.25, 0);
    const result = fixture.attack({ sa: 20, bx: snapshot.x, by: snapshot.y, bz: snapshot.z, speed: 1, currentSpeed: 1 });
    assert.equal(result.accepted, 1);
    assert.ok(Math.abs(result.leadMs - (20 + hostContactMs(snapshot, 51))) < 1e-9);
    assert.ok(Math.abs(result.leadMs - (20 + hostContactMs(new Vector3(2.2, 1.25, 0), 51))) > 1);
    // Implausible snapshot → host position.
    const fallback = fixture.attack({ sa: 20, bx: 9, by: 1.25, bz: 0 });
    assert.ok(Math.abs(fallback.leadMs - (20 + hostContactMs(new Vector3(2.2, 1.25, 0), 51))) < 1e-9);
});

test('host capsule for a remote attacker follows G1 remote-proxy feet (eye − 1.7, snapped)', () => {
    const fixture = hostFixture();
    const game = fixture.context;
    // Perched attacker on a 2.4 m ledge: capsule spans 2.4..4.1.
    const perched = game._remoteDeflectLeadMs(fixture.remote, { x: 0, y: 4.1, z: 0 }, { x: 1.4, y: 3.65, z: 0 }, 0);
    assert.ok(Math.abs(perched - predictContactMs({ x: 1.4, y: 3.65, z: 0 }, 17, 0, 0, 2.4, 1.7, 0.451, BALL_RADIUS)) < 1e-9);
    // Quantised grounded eye (1.703125) snaps to the floor capsule.
    const grounded = game._remoteDeflectLeadMs(fixture.remote, { x: 0, y: 1.703125, z: 0 }, { x: 1.4, y: 1.25, z: 0 }, 0);
    assert.ok(Math.abs(grounded - hostContactMs({ x: 1.4, y: 1.25, z: 0 }, 17)) < 1e-9);
});

test('bot deflects (normal and mishit) clear a stale ✨PERFECT tag and are never graded', () => {
    const botDeflection = compileGameMethod('handleBotDeflection', {
        THREE: { Vector3 },
        t: () => ''
    });
    for (const mishit of [false, true]) {
        const human = { name: 'Human' };
        const target = { getPosition: () => new Vector3(10, 1.7, 0) };
        const ball = {
            lastPerfectBy: human,
            _affixSplit: false,
            baseSpeed: 17,
            deflectWithAim() { return { shot: 'flat' }; },
            deflect() {},
            setTarget() {},
            getSpeed: () => 20
        };
        const game = {
            ball,
            rallyCount: 0,
            getClosestEnemy: () => target,
            _claimOpeningOwner() {},
            _pushDeflectHistory() {},
            _recordShotOrigin() {},
            _applyRallyHeat() {},
            spawnSplitBall() {},
            scoreboard: { recordDeflection() {} },
            audio: { playSfx() {}, playDeflect() {}, playWhoosh() {} },
            ui: { showMessage() {} },
            matchAnalytics: { recordDeflect() { throw new Error('bots are never graded'); } }
        };
        const bot = {
            name: 'Bot',
            team: 'blue',
            difficulty: 'easy',
            deflectPower: 1,
            _mishit: mishit,
            getPosition: () => new Vector3(0, 1.7, 0),
            onSuccessfulDeflect() {}
        };
        botDeflection.call(game, bot);
        assert.equal(ball.lastPerfectBy, null, `mishit=${mishit}`);
        assert.equal(game.rallyCount, 1);
    }
    assert.doesNotMatch(extractGameMethod('handleBotDeflection'), /resolvePerfectDeflect|classifyDeflect/);
});

test('local accepted deflect re-owns the ✨PERFECT tag on every tier', () => {
    const local = extractGameMethod('handlePlayerDeflection');
    assert.match(local, /this\.ball\.lastPerfectBy = isPerfect \? this\.player : null;\s+if \(isPerfect\) \{/);
    assert.equal(local.match(/lastPerfectBy/g).length, 1);
});

test('local PERFECT hit-stop only freezes the sim offline; connected matches keep the rest of the juice', () => {
    const local = extractGameMethod('handlePlayerDeflection');
    const hitStops = local.match(/this\.juice\.hitStop\(/g) || [];
    assert.equal(hitStops.length, 1);
    assert.match(local, /if \(!this\.network\?\.connected\) this\.juice\.hitStop\(100\);/);
    const perfectBlock = local.slice(local.indexOf('if (isPerfect) {'), local.indexOf('} else {', local.indexOf('if (isPerfect) {')));
    for (const juice of ['this.juice.shake(0.35)', 'this.juice.shockwave(', 'this.juice.burst(', 'this.juice.addCombo()']) {
        assert.ok(perfectBlock.includes(juice), `${juice} stays unconditional`);
    }
    // Game.update returns early while hit-stop runs, so gating it keeps a
    // connected host's authoritative simulation ticking.
    assert.match(extractGameMethod('update'), /const effectiveDt = this\.juice\.update\(dt\);\s+if \(effectiveDt === 0 && this\.state !== STATES\.CELEBRATION\) return;/);
});

test('spin-dodge orbit release clears a stale ✨PERFECT tag', () => {
    const playing = extractGameMethod('updatePlaying');
    const start = playing.indexOf('const result = this.ball.orbitRelease(aimDir, target);');
    const end = playing.indexOf('} else if (this.player.didSpinDodge()', start);
    assert.ok(start > 0 && end > start);
    const release = playing.slice(start, end);
    assert.match(release, /this\.ball\.lastPerfectBy = null;/);
    assert.ok(release.indexOf('this.ball.lastPerfectBy = null;') < release.indexOf('this.lastDeflector = this.player;'));
});
