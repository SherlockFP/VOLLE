// G4 "the reaction wall in uncapped rallies": speed-scaled swing window and
// whiff recovery, early-whiff re-arm, probabilistic bot cracks instead of a
// timing wall, and a readable telegraph (OVERDRIVE banner/chip/cue, per-frame
// ETA + closing reticle ring). Simulations run the REAL js/player.js swing
// code, the REAL G2 contact solver and G4 game hooks (compiled from
// js/game.js) and the REAL js/bot.js decision (tests/rally-reaction-sim.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import {
    BASE_SPEED,
    RALLY_DISTANCE,
    STATES,
    botModule,
    createRallyBot,
    createRallyGame,
    createSwingPlayer,
    localContactMs,
    playerModule,
    quantile,
    rallyStudy,
    simulateBotRally,
    simulateRallyApproach
} from './rally-reaction-sim.mjs';
import { SimPlayer, Vector3, createBall, extractMethod, mulberry32, straightPath } from './frame-contact-sim.mjs';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';
import { REMOTE_SWING_AGE_LIMITS, DEFLECT_TIMING_WINDOWS, predictContactMs } from '../js/perfect-deflect.js';
import { targetFeetY } from '../js/combat.js';

const {
    SWING_ACTIVE_WINDOW,
    SWING_RAMP_START_RATIO,
    EARLY_WHIFF_REARM_COOLDOWN,
    swingLiveWindowFor,
    whiffRecoveryFor
} = playerModule;
const { RALLY_CRACK_SETTINGS, DEFENSE_SQUEEZE_MARGIN_SECONDS } = botModule;

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const playerSource = read('../js/player.js');
const botSource = read('../js/bot.js');
const uiSource = read('../js/ui.js');
const gameSource = read('../js/game.js');
const audioSource = read('../js/audio.js');
const html = read('../index.html');
const hudCss = read('../css/hud.css');
const en = read('../js/locales/en.js');
const tr = read('../js/locales/tr.js');

const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// (a1, a2) formulas
// ---------------------------------------------------------------------------

test('w(r) = 0.22 + 0.01·clamp(r − 3, 0, 6): exactly SWING_ACTIVE_WINDOW up to 3×, 0.25 at 6×, 0.28 from 9×', () => {
    assert.equal(SWING_ACTIVE_WINDOW, 0.22);
    assert.equal(SWING_RAMP_START_RATIO, 3);
    for (const r of [0, 0.5, 1, 2, 2.99, 3, -4, NaN, undefined]) {
        assert.ok(Object.is(swingLiveWindowFor(r), SWING_ACTIVE_WINDOW), `w(${r}) is bit-identical to 0.22`);
    }
    assert.ok(close(swingLiveWindowFor(4), 0.23));
    assert.ok(close(swingLiveWindowFor(5), 0.24));
    assert.ok(close(swingLiveWindowFor(6), 0.25));
    assert.ok(close(swingLiveWindowFor(7.5), 0.265));
    for (const r of [9, 10, 14, 40, Infinity]) assert.ok(close(swingLiveWindowFor(r), 0.28), `w(${r})`);
});

test('rec(r) = clamp(0.38 − 0.035·(r − 3), 0.26, 0.38): 0.38 up to 3×, 0.31 at 5×, floor 0.26 from ~6.43×', () => {
    for (const r of [0, 1, 2, 3, NaN]) assert.equal(whiffRecoveryFor(r), 0.38, `rec(${r})`);
    assert.ok(close(whiffRecoveryFor(4), 0.345));
    assert.ok(close(whiffRecoveryFor(5), 0.31));
    assert.ok(close(whiffRecoveryFor(6), 0.275));
    for (const r of [6.43, 7, 10, 40]) assert.equal(whiffRecoveryFor(r), 0.26, `rec(${r})`);
    // 0.38 is the pre-G4 whiff remainder: ATTACK_COOLDOWN − SWING_ACTIVE_WINDOW.
    assert.match(playerSource, /const ATTACK_COOLDOWN = 0\.6;/);
    assert.ok(close(0.6 - SWING_ACTIVE_WINDOW, 0.38));
    assert.equal(EARLY_WHIFF_REARM_COOLDOWN, 0.05);
    assert.match(playerSource, /this\.attackCooldown = Math\.min\(this\.attackCooldown, this\._rapidDeflect \? 0\.08 : SUCCESSFUL_DEFLECT_RECOVERY\);/);
    assert.match(playerSource, /const SUCCESSFUL_DEFLECT_RECOVERY = 0\.18;/);
});

test('host swing-age hint clamps at 300 ms (longest live swing 280 ms); G3 tiers unchanged', () => {
    assert.deepEqual({ ...REMOTE_SWING_AGE_LIMITS }, { acceptMaxMs: 400, clampMaxMs: 300 });
    assert.deepEqual({ ...DEFLECT_TIMING_WINDOWS }, { perfect: 60, great: 140, normal: 400 });
    assert.ok(REMOTE_SWING_AGE_LIMITS.clampMaxMs >= swingLiveWindowFor(Infinity) * 1000);
});

// ---------------------------------------------------------------------------
// Below 3×: bit-for-bit the pre-G4 swing.
// ---------------------------------------------------------------------------

// Per-frame attack state of the real Player (ratio forced) vs the G2 harness
// mirror of the pre-G4 Player (SimPlayer), for a click timeline.
function traceSwing(player, clicks, dt, frames) {
    const trace = [];
    let clickIndex = 0;
    for (let j = 1; j <= frames; j++) {
        const wall = j * dt;
        while (clickIndex < clicks.length && clicks[clickIndex] < wall) {
            trace.push(['click', j, player.tryAttack()]);
            clickIndex++;
        }
        if (player._stepAttackTimers) player._stepAttackTimers(dt); else player.update(dt);
        trace.push([j, player.attacking, player.attackActive, player.attackCooldown, player.swingTail, player.swingAge, player.swingClickDt, player._swingLiveWindow]);
    }
    return trace;
}

test('at or below 3× the real swing timers match the pre-G4 mirror bit-for-bit (60/144 Hz, spam and single clicks)', () => {
    const performanceRef = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    try {
        for (const hz of [60, 144, 30]) {
            const dt = 1 / hz;
            const random = mulberry32(hz);
            const timelines = [
                Array.from({ length: 40 }, (_, index) => index * dt * 0.5 + 0.01),
                Array.from({ length: 12 }, () => random() * 3).sort((a, b) => a - b),
                [0.2, 0.9, 1.5, 1.52, 2.3]
            ];
            for (const ratio of [0, 1, 2.2, 3]) {
                for (const clicks of timelines) {
                    const player = createSwingPlayer();
                    player._ballSpeedRatio = () => ratio;
                    player.game = { shouldRearmAfterWhiff() { throw new Error('no re-arm at or below 3×'); } };
                    const mirror = new SimPlayer();
                    const real = traceSwing(player, clicks, dt, Math.ceil(3.5 / dt));
                    const legacy = traceSwing(mirror, clicks, dt, Math.ceil(3.5 / dt));
                    assert.equal(real.length, legacy.length);
                    for (let index = 0; index < real.length; index++) {
                        const a = real[index];
                        const b = legacy[index];
                        for (let k = 0; k < a.length; k++) {
                            assert.ok(Object.is(a[k], b[k]), `${hz} Hz r=${ratio} entry ${index}.${k}: ${a} vs ${b}`);
                        }
                    }
                }
            }
        }
    } finally {
        globalThis.performance = performanceRef;
    }
});

test('above 3×: the click opens w(r) live and a whiff recovers in rec(r) (cycle = live + tail + recovery)', () => {
    const performanceRef = globalThis.performance;
    globalThis.performance = { now: () => 0 };
    try {
        for (const hz of [60, 144]) {
            const dt = 1 / hz;
            for (const ratio of [3.5, 5, 6, 9, 10, 14]) {
                const player = createSwingPlayer();
                player._ballSpeedRatio = () => ratio;
                player.game = { shouldRearmAfterWhiff: () => false };
                assert.equal(player.tryAttack(), true);
                assert.ok(close(player.attackActive, swingLiveWindowFor(ratio)));
                assert.ok(close(player._swingLiveWindow, swingLiveWindowFor(ratio)));
                assert.equal(player.attackCooldown, 0.6);
                let frame = 0;
                let closedAt = null;
                let recBinds = false;
                while (++frame < 2000) {
                    const pending = player._swingWhiffPending;
                    const cooldownBefore = player.attackCooldown;
                    player._stepAttackTimers(dt);
                    if (pending && !player._swingWhiffPending) {
                        closedAt = frame;
                        // rec(r) from the close (never longer than the old
                        // remainder), then this frame's dt.
                        const expected = Math.min(cooldownBefore, whiffRecoveryFor(ratio));
                        recBinds = whiffRecoveryFor(ratio) < cooldownBefore;
                        assert.ok(close(player.attackCooldown, expected - dt, 1e-9), `${hz} Hz r=${ratio}`);
                    }
                    if (player.attackCooldown <= 0) break;
                }
                assert.ok(closedAt !== null);
                // Closed on the first frame whose start is past the live end
                // (click at half a frame, G2 tail).
                const liveEnd = dt / 2 + swingLiveWindowFor(ratio);
                assert.ok((closedAt - 1) * dt > liveEnd - 1e-9 && (closedAt - 2) * dt <= liveEnd + 1e-9, `${hz} Hz r=${ratio} closed at frame ${closedAt}`);
                const cycle = frame * dt;
                const oldCycle = Math.ceil(0.6 / dt - 1e-9) * dt;
                assert.ok(cycle <= oldCycle + 1e-9, `r=${ratio}: cycle ${cycle.toFixed(3)} s never exceeds the old ${oldCycle.toFixed(3)} s`);
                if (ratio >= 5) {
                    assert.ok(recBinds);
                    assert.ok(Math.abs(cycle - (liveEnd + whiffRecoveryFor(ratio))) <= 2 * dt, `${hz} Hz r=${ratio} cycle ${cycle}`);
                }
            }
        }
    } finally {
        globalThis.performance = performanceRef;
    }
});

test('a successful deflect keeps the 0.18 s recovery and never counts as a whiff', () => {
    const result = simulateRallyApproach({ ratio: 10, dt: 1 / 60, clicks: [], assignAt: 1 });
    assert.equal(result.outcome, 'hit');
    const speed = 170;
    const contact = 1 + (RALLY_DISTANCE - (0.87 + speed * 0.003)) / speed;
    const deflect = simulateRallyApproach({ ratio: 10, dt: 1 / 60, clicks: [contact - 0.08], assignAt: 1 });
    assert.equal(deflect.outcome, 'deflect');
    assert.equal(deflect.player._swingWhiffPending, false);
    assert.equal(deflect.player._whiffStreak, 0);
    assert.ok(deflect.player.attackCooldown <= 0.18 + 1e-12);
    assert.equal(deflect.rearmCalls, 0);
});

// ---------------------------------------------------------------------------
// (a3) early-whiff re-arm
// ---------------------------------------------------------------------------

function contactTimeFor(ratio, assignAt, distance = RALLY_DISTANCE) {
    const speed = ratio * BASE_SPEED;
    return assignAt + (distance - (0.87 + Math.min(speed * 0.003, 2))) / speed;
}

test('re-arm at 10×: an early whiff → the second click deflects; without re-arm the rec(10) lockout is a hit', () => {
    // [distance, first-click lead, second-click lead]: at 25 u the 10× flight
    // is 139 ms, so the whiffed window must close inside it (first click
    // ~420 ms early, an anticipation click before the assignment) and the
    // re-armed swing opens ~50 ms before contact. At 40 u (227 ms flight) a
    // 450 ms early click closes ~160 ms out and the lead-80 click connects.
    for (const [distance, first, second] of [[25, 0.42, 0.04], [40, 0.45, 0.08]]) {
        for (const hz of [60, 144]) {
            const dt = 1 / hz;
            const assignAt = 2;
            const contact = contactTimeFor(10, assignAt, distance);
            const clicks = [contact - first, contact - second];
            const rearmed = simulateRallyApproach({ ratio: 10, dt, assignAt, clicks, distance });
            assert.equal(rearmed.outcome, 'deflect', `${distance} u ${hz} Hz`);
            assert.equal(rearmed.rearmGrants, 1);
            assert.equal(rearmed.clickCount, 2);
            assert.ok(Math.abs(rearmed.leadMs - second * 1000) <= dt * 500 + 1, `second swing graded on its own lead: ${rearmed.leadMs}`);
            const locked = simulateRallyApproach({ ratio: 10, dt, assignAt, clicks, distance, rearm: false });
            assert.equal(locked.outcome, 'hit', `${distance} u ${hz} Hz without re-arm`);
            assert.equal(locked.clickCount, 1, 'second click refused during rec(10) = 0.26 s');
        }
    }
});

test('card example "early whiff at lead 300 ms, second click at lead 80 ms" is not reachable at 10×: the 280 ms swing is still live at lead 80', t => {
    for (const hz of [60, 144]) {
        const dt = 1 / hz;
        const assignAt = 2;
        const contact = contactTimeFor(10, assignAt);
        const result = simulateRallyApproach({ ratio: 10, dt, assignAt, clicks: [contact - 0.3, contact - 0.08] });
        t.diagnostic(`${hz} Hz lead 300 then 80 → ${result.outcome}, re-arm grants ${result.rearmGrants}, clicks accepted ${result.clickCount}`);
        // The first window [−300, −20] ms is live at lead 80 (click refused)
        // and closes ~20 ms before contact; w + re-arm = 330 ms > 300 ms.
        assert.equal(result.clickCount, 1);
    }
    assert.ok(swingLiveWindowFor(10) * 1000 + EARLY_WHIFF_REARM_COOLDOWN * 1000 > 300);
});

function rearmHarness(ratio = 10) {
    const player = createSwingPlayer();
    const other = { name: 'other', team: 'red', alive: true };
    const ball = createBall({ position: { x: 3, y: 1.25, z: 0 }, speed: ratio * BASE_SPEED, target: player });
    ball.baseSpeed = BASE_SPEED;
    const game = createRallyGame(player, ball);
    player.game = game;
    return { player, ball, game, other };
}

function whiffNow(player, ratio = 10) {
    player._swingSpeedRatio = ratio;
    player._swingWhiffPending = false;
    player.attackCooldown = 0.5;
    player._recoverFromWhiff();
    return player.attackCooldown;
}

test('re-arm fires once per assignment, only for the target, only inside rec(r), only for the first whiff in a row', () => {
    const { player, ball, game, other } = rearmHarness();
    // Target, contact (3 u → ~7 ms) inside rec(10) → re-armed.
    assert.equal(whiffNow(player), EARLY_WHIFF_REARM_COOLDOWN);
    assert.equal(game.rearmGrants, 1);
    // Same assignment again (streak reset to isolate the per-assignment rule).
    player._whiffStreak = 0;
    assert.equal(whiffNow(player), 0.26);
    assert.equal(game.rearmGrants, 1, 'once per assignment');
    // Not the target → never.
    ball.targetPlayer = other;
    game._trackThreatAssignment();
    player._whiffStreak = 0;
    assert.equal(whiffNow(player), 0.26);
    // New assignment to the player → available again.
    ball.targetPlayer = player;
    player._whiffStreak = 0;
    assert.equal(whiffNow(player), EARLY_WHIFF_REARM_COOLDOWN);
    assert.equal(game.rearmGrants, 2);
    // Second whiff in a row (no deflect / hit in between) → no re-arm even on a
    // fresh assignment: a stream of whiffs is spam.
    ball.targetPlayer = other;
    game._trackThreatAssignment();
    ball.targetPlayer = player;
    assert.equal(player._whiffStreak, 1);
    assert.equal(whiffNow(player), 0.26);
    assert.equal(game.rearmGrants, 2);
    // A hit taken or a deflect resets the streak.
    player.onMissDeflect();
    ball.targetPlayer = other;
    game._trackThreatAssignment();
    ball.targetPlayer = player;
    assert.equal(whiffNow(player), EARLY_WHIFF_REARM_COOLDOWN);
    // Contact beyond rec(r) → no re-arm.
    const far = rearmHarness();
    far.ball.position.set(70, 1.25, 0); // ~400 ms at 170 u/s
    assert.equal(whiffNow(far.player), 0.26);
    assert.equal(far.game.rearmGrants, 0);
    // Outside PLAYING (or a dead / inactive state) → never.
    const idle = rearmHarness();
    idle.game.state = 'ROUND_END';
    assert.equal(whiffNow(idle.player), 0.26);
    const dead = rearmHarness();
    dead.player.alive = false;
    assert.equal(whiffNow(dead.player), 0.26);
});

test('re-arm never applies at or below 3× and the re-armed click still pays the rapid-deflect stamina rule', () => {
    const { player, game } = rearmHarness(3);
    player._swingSpeedRatio = 3;
    player.attackCooldown = 0.2;
    player._recoverFromWhiff();
    assert.equal(player.attackCooldown, 0.2, '≤ 3×: cooldown untouched');
    assert.equal(game.rearmCalls, 0);

    const performanceRef = globalThis.performance;
    let now = 1000;
    globalThis.performance = { now: () => now };
    try {
        const harness = rearmHarness(10);
        harness.player.stamina = 100;
        assert.equal(harness.player.tryAttack(), true);
        const afterFirst = harness.player.stamina;
        assert.equal(100 - afterFirst, 7);
        harness.player.attacking = false;
        harness.player.attackActive = 0;
        harness.player.swingTail = false;
        harness.player._stepAttackTimers(0.3);
        assert.equal(harness.game.rearmGrants, 1);
        harness.player._stepAttackTimers(EARLY_WHIFF_REARM_COOLDOWN);
        now += 330;
        assert.equal(harness.player.tryAttack(), true, 're-armed swing opens');
        // fatigue 1 − 0.33·3 → ceil(0.01) = 1 → 7 + 2.
        assert.equal(afterFirst - harness.player.stamina, 9);
    } finally {
        globalThis.performance = performanceRef;
    }
});

// ---------------------------------------------------------------------------
// Timed vs spam (random phase, max rate) + G3 gates with the real G4 swing.
// ---------------------------------------------------------------------------

const STUDY_N = 3000;

test('timed player (lead ~ N(80, 30) ms) ≥ 95% and max-rate random-phase spam ≤ 50% (5×) / ≤ 55% (10×); gap ≥ 40 pts at every speed', t => {
    for (const hz of [60, 144]) {
        for (const ratio of [1, 2, 3, 4, 5, 6, 8, 10]) {
            const seed = 11 + ratio * 100 + hz;
            const spam = rallyStudy({ mode: 'spam', ratio, hz, approaches: STUDY_N, seed });
            const timed = rallyStudy({ mode: 'timed', ratio, hz, approaches: STUDY_N, seed: seed + 7 });
            t.diagnostic(`${hz} Hz ${ratio}×: timed ${(timed.rate * 100).toFixed(1)}% spam ${(spam.rate * 100).toFixed(1)}% (re-arm grants to spam ${spam.rearmGrants})`);
            if (ratio === 5 || ratio === 10) assert.ok(timed.rate >= 0.95, `${hz} Hz ${ratio}× timed ${timed.rate}`);
            if (ratio === 5) assert.ok(spam.rate <= 0.50, `${hz} Hz 5× spam ${spam.rate}`);
            if (ratio === 10) assert.ok(spam.rate <= 0.55, `${hz} Hz 10× spam ${spam.rate}`);
            assert.ok(timed.rate - spam.rate >= 0.40, `${hz} Hz ${ratio}× gap ${timed.rate - spam.rate}`);
        }
    }
});

test('card-literal re-arm (no first-whiff gate) would let random-phase spam through (reported, not shipped)', t => {
    for (const ratio of [5, 10]) {
        const literal = rallyStudy({ mode: 'spam', ratio, hz: 60, approaches: 1500, seed: 5 + ratio, literalRearm: true });
        const shipped = rallyStudy({ mode: 'spam', ratio, hz: 60, approaches: 1500, seed: 5 + ratio });
        t.diagnostic(`60 Hz ${ratio}× spam: literal re-arm ${(literal.rate * 100).toFixed(1)}% vs shipped ${(shipped.rate * 100).toFixed(1)}%`);
        assert.ok(literal.rate > shipped.rate);
    }
});

// G3 definitions: spam = Mouse1 every 0.6 s at a random phase; skill = one
// click at lead ~ N(40, 15) ms. Shares are PERFECT / successful deflects.
function g3Study({ mode, ratio, hz, approaches, seed }) {
    const random = mulberry32(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const dt = 1 / hz;
    let deflects = 0;
    let perfects = 0;
    for (let index = 0; index < approaches; index++) {
        const assignAt = 1.2 + random() * 0.6;
        const contact = contactTimeFor(ratio, assignAt);
        const clicks = [];
        if (mode === 'skill') clicks.push(contact - (40 + 15 * gaussian()) / 1000);
        else for (let time = random() * 0.6; time < contact + 0.5; time += 0.6) clicks.push(time);
        const result = simulateRallyApproach({ ratio, dt, assignAt, clicks });
        if (result.outcome !== 'deflect') continue;
        deflects++;
        if (result.leadMs <= DEFLECT_TIMING_WINDOWS.perfect) perfects++;
    }
    return { deflects, perfects, share: perfects / deflects };
}

test('G3 gates re-run with the G4 swing at 1×/5×/10×, 60/144 Hz: spam PERFECT ≤ 33%, skilled PERFECT ≥ 86.8%', t => {
    for (const hz of [60, 144]) {
        for (const ratio of [1, 5, 10]) {
            const spam = g3Study({ mode: 'spam', ratio, hz, approaches: 4000, seed: 100000 + hz * 1000 + ratio });
            const skill = g3Study({ mode: 'skill', ratio, hz, approaches: 4000, seed: 200000 + hz * 1000 + ratio });
            t.diagnostic(`${hz} Hz ${ratio}×: spam PERFECT ${(spam.share * 100).toFixed(1)}% of ${spam.deflects}, skilled PERFECT ${(skill.share * 100).toFixed(1)}% of ${skill.deflects}`);
            assert.ok(spam.deflects > 500);
            assert.ok(spam.share <= 0.33, `${hz} Hz ${ratio}× spam PERFECT ${spam.share}`);
            assert.ok(skill.share >= 0.868, `${hz} Hz ${ratio}× skilled PERFECT ${skill.share}`);
        }
    }
});

// ---------------------------------------------------------------------------
// (a5) bots: probability curve instead of a wall
// ---------------------------------------------------------------------------

const expectedChance = (difficulty, ratio) => {
    const base = { easy: 0.35, medium: 0.75, hard: 0.92 }[difficulty];
    const { r0, decay } = RALLY_CRACK_SETTINGS[difficulty];
    return base * decay ** Math.max(0, ratio - r0);
};

// One decision at a normal alert crossing (seen outside the alert range the
// frame before), so only the probability applies.
function decide(bot, ratio, rng) {
    bot.attacking = false;
    bot.attackTimer = 0;
    bot._resetDefenseIntent();
    const speed = ratio * BASE_SPEED;
    const alert = speed * (bot.reactionTime + bot.windUpTime) + 2;
    const ball = {
        active: true,
        targetPlayer: bot,
        currentSpeed: speed,
        baseSpeed: BASE_SPEED,
        attackRange: 2,
        position: new Vector3(alert + 1, 1.2, 0),
        velocity: new Vector3(-speed, 0, 0)
    };
    assert.equal(bot.observeDefenseIntent(ball, rng), 'none');
    assert.equal(bot._defenseSeenOutside, true);
    ball.position.x = alert - 0.5;
    return bot.observeDefenseIntent(ball, rng);
}

test('bot deflect chance p = deflectChance · decay^max(0, r − r0) within ±0.02 over 10,000 seeded decisions', t => {
    assert.deepEqual(JSON.parse(JSON.stringify(RALLY_CRACK_SETTINGS)), {
        easy: { r0: 2, decay: 0.75, floor: 0.2 },
        medium: { r0: 4, decay: 0.85, floor: 0.12 },
        hard: { r0: 6, decay: 0.9, floor: 0.08 }
    });
    assert.equal(DEFENSE_SQUEEZE_MARGIN_SECONDS, 0.02);
    assert.ok(Math.abs(expectedChance('hard', 8) - 0.745) < 0.001);
    assert.ok(Math.abs(expectedChance('hard', 10) - 0.604) < 0.001);
    assert.ok(Math.abs(expectedChance('medium', 6) - 0.542) < 0.001);
    const cases = { easy: [1, 2, 2.5, 3, 4, 6], medium: [1, 3, 4, 5, 6, 8], hard: [1, 4, 6, 8, 10, 13] };
    for (const [difficulty, ratios] of Object.entries(cases)) {
        for (const ratio of ratios) {
            const bot = createRallyBot({ difficulty });
            const rng = mulberry32(ratio * 1000 + difficulty.length);
            let deflects = 0;
            const N = 10000;
            for (let index = 0; index < N; index++) if (decide(bot, ratio, rng) === 'deflect') deflects++;
            const rate = deflects / N;
            t.diagnostic(`${difficulty} ${ratio}×: ${(rate * 100).toFixed(1)}% vs formula ${(expectedChance(difficulty, ratio) * 100).toFixed(1)}%`);
            assert.ok(Math.abs(rate - expectedChance(difficulty, ratio)) <= 0.02, `${difficulty} ${ratio}×: ${rate}`);
        }
    }
});

test('at or below r0 on a normal alert crossing the bot decision is bit-for-bit the pre-G4 one (same rng draws, same timers)', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const r0 = RALLY_CRACK_SETTINGS[difficulty].r0;
        for (const ratio of [1, 1.3, r0]) {
            const current = createRallyBot({ difficulty });
            const legacy = createRallyBot({ difficulty, legacy: true });
            const a = mulberry32(99);
            const b = mulberry32(99);
            for (let index = 0; index < 400; index++) {
                const intentA = decide(current, ratio, a);
                const intentB = decide(legacy, ratio, b);
                assert.equal(intentA, intentB);
                assert.equal(current._defenseTimeScale, 1);
                assert.ok(Object.is(current._defenseDodgeSign, legacy._defenseDodgeSign));
            }
        }
    }
    // Timers: scale 1 → identical ready times frame by frame.
    const ready = (bot, dt) => {
        const out = [];
        const ball = { active: true, targetPlayer: bot, currentSpeed: 17, baseSpeed: 17, attackRange: 2, position: new Vector3(8, 1.2, 0), velocity: new Vector3(-17, 0, 0) };
        bot._resetDefenseIntent();
        bot._deflectDecided = true;
        bot._willDeflect = true;
        bot._defenseIntent = 'deflect';
        bot._defenseSeenOutside = true;
        for (let j = 0; j < 40; j++) out.push(bot.advanceDeflectReady(ball, dt));
        return out;
    };
    for (const dt of [1 / 60, 1 / 144]) {
        const a = ready(createRallyBot({ difficulty: 'medium' }), dt);
        const b = ready(createRallyBot({ difficulty: 'medium', legacy: true }), dt);
        a.forEach((value, index) => assert.ok(Object.is(value, b[index])));
    }
});

test('a ball assigned inside the alert range squeezes reaction + wind-up to T − 0.02 s (never below the floor; below it the bot cannot deflect)', () => {
    const dt = 1 / 240;
    for (const [difficulty, ratio, expectDeflectPossible] of [
        ['hard', 8, true], ['hard', 13, true], ['hard', 15, false],
        ['medium', 6, true], ['medium', 9.5, true], ['medium', 10.5, false],
        ['easy', 3, true], ['easy', 6, true], ['easy', 6.5, false]
    ]) {
        const bot = createRallyBot({ difficulty });
        const speed = ratio * BASE_SPEED;
        const ball = {
            active: true, targetPlayer: bot, currentSpeed: speed, baseSpeed: BASE_SPEED, attackRange: 2,
            position: new Vector3(RALLY_DISTANCE, 1.2, 0), velocity: new Vector3(-speed, 0, 0)
        };
        const intent = bot.observeDefenseIntent(ball, () => 0); // roll: always "yes"
        const need = bot.reactionTime + bot.windUpTime;
        const available = (RALLY_DISTANCE - 2) / speed;
        assert.ok(available < need, `${difficulty} ${ratio}× is a wall case`);
        const fit = available - 0.02;
        const floor = RALLY_CRACK_SETTINGS[difficulty].floor;
        if (expectDeflectPossible) {
            assert.ok(fit >= floor);
            assert.equal(intent, 'deflect', `${difficulty} ${ratio}×`);
            assert.ok(close(bot._defenseTimeScale, fit / need, 1e-12));
            // Ready exactly T − 0.02 s after the decision (to within one step).
            let readyTime = null;
            for (let j = 1; j < 400 && readyTime === null; j++) {
                const readyAt = bot.advanceDeflectReady(ball, dt);
                if (readyAt <= dt) readyTime = (j - 1) * dt + readyAt;
            }
            assert.ok(Math.abs(readyTime - fit) <= dt + 1e-9, `${difficulty} ${ratio}× ready ${readyTime} vs ${fit}`);
        } else {
            assert.ok(fit < floor);
            assert.notEqual(intent, 'deflect', `${difficulty} ${ratio}× below the floor`);
        }
    }
});

test('Monte Carlo vs a human who always returns (+30%/deflect, 25 u): crack speed medians/p99 in band, no bot reaches 20×', t => {
    const RUNS = 2000;
    const summary = {};
    for (const difficulty of ['easy', 'medium', 'hard']) {
        for (const legacy of [true, false]) {
            const cracks = [];
            let capped = 0;
            for (let seed = 1; seed <= RUNS; seed++) {
                const result = simulateBotRally({ difficulty, seed, legacy });
                cracks.push(result.crackRatio);
                if (result.capped) capped++;
            }
            cracks.sort((a, b) => a - b);
            const stats = { median: quantile(cracks, 0.5), p99: quantile(cracks, 0.99), max: cracks.at(-1), capped };
            summary[`${difficulty}-${legacy ? 'before' : 'after'}`] = stats;
            t.diagnostic(`${difficulty} ${legacy ? 'before' : 'after'}: median ${stats.median.toFixed(2)}× p99 ${stats.p99.toFixed(2)}× max ${stats.max.toFixed(2)}×`);
        }
    }
    const hard = summary['hard-after'];
    assert.ok(hard.median >= 4.5 && hard.median <= 8, `hard median ${hard.median}`);
    assert.ok(hard.p99 <= 14, `hard p99 ${hard.p99}`);
    const medium = summary['medium-after'];
    assert.ok(medium.median >= 1.9 && medium.median <= 4, `medium median ${medium.median}`);
    assert.ok(summary['easy-after'].median <= 2);
    for (const [key, stats] of Object.entries(summary)) {
        assert.equal(stats.capped, 0, key);
        assert.ok(stats.max < 20, `${key} max ${stats.max}`);
    }
    // Before: a fixed wall — no hard bot ever returned past ~6×.
    assert.ok(summary['hard-before'].max <= 6.1 + 1e-9);
    assert.ok(summary['hard-after'].max > summary['hard-before'].max);
});

test('scripted 10× rally vs a hard bot (20 runs): before every run cracks on the first ball, after the bot returns probabilistically', t => {
    const before = [];
    const after = [];
    for (let seed = 1; seed <= 20; seed++) {
        before.push(simulateBotRally({ difficulty: 'hard', seed, legacy: true, startRatio: 10 }).returns);
        after.push(simulateBotRally({ difficulty: 'hard', seed, startRatio: 10 }).returns);
    }
    t.diagnostic(`bot returns per 10× rally — before: [${before}] after: [${after}]`);
    assert.ok(before.every(value => value === 0));
    assert.ok(after.some(value => value > 0));
    assert.ok(after.every(value => value <= 6), 'the floor still ends it by ~13.5×');
});

test('bot G4 code stays inside the decision/readiness path (G5 movement untouched)', () => {
    const observe = extractMethod(botSource, 'observeDefenseIntent');
    const ready = extractMethod(botSource, 'advanceDeflectReady');
    assert.match(observe, /chance \*= Math\.pow\(this\.deflectDecay, ratio - this\.deflectDecayStart\);/);
    assert.match(observe, /const rolledWillDeflect = rng\(\) < chance && reachable;/);
    assert.match(ready, /const timeScale = this\._defenseTimeScale > 0 \? this\._defenseTimeScale : 1;/);
    assert.match(extractMethod(botSource, '_resetDefenseIntent'), /this\._defenseTimeScale = 1;\s+this\._defenseSeenOutside = false;/);
    // Mishit roll and dodge latch unchanged.
    assert.match(extractMethod(botSource, 'commitDeflect'), /if \(Math\.random\(\) < this\.mishitRate\) \{/);
    assert.match(observe, /this\._defenseDodgeLatch = DEFENSE_DODGE_LATCH_SECONDS;/);
    assert.match(observe, /this\.animator\?\.play\('deflect'\);/);
});

// ---------------------------------------------------------------------------
// (b7) ETA readout + closing ring
// ---------------------------------------------------------------------------

function uiFunction(name, globals = {}) {
    return runInNewContext(`(${extractMethod(uiSource, name, { exportedFunction: true })})`, { Math, Number, ...globals });
}
const uiConst = name => Number(new RegExp(`export const ${name} = ([\\d.]+);`).exec(uiSource)[1]);
const THREAT_RING_MAX_RADIUS = uiConst('THREAT_RING_MAX_RADIUS');
const THREAT_RING_GOLD_MS = uiConst('THREAT_RING_GOLD_MS');
const THREAT_ETA_MAX_TENTHS = uiConst('THREAT_ETA_MAX_TENTHS');
const OVERDRIVE_BANNER_MS = uiConst('OVERDRIVE_BANNER_MS');
const OVERDRIVE_UI_MAX_RATIO = uiConst('OVERDRIVE_UI_MAX_RATIO');
const threatEtaKey = uiFunction('threatEtaKey', { THREAT_ETA_MAX_TENTHS });
const formatThreatEta = uiFunction('formatThreatEta', { threatEtaKey });
const threatRingRadius = uiFunction('threatRingRadius', { THREAT_RING_MAX_RADIUS });
const getBallHeat = uiFunction('getBallHeat', { BALL_BASE_SPEED: 17 });
const getBallThreat = uiFunction('getBallThreat', { getBallHeat, formatThreatEta });

test('ETA label: whole ms below 1 s ("140 MS"), one-decimal seconds from 1 s, rounded to the shown unit', () => {
    assert.equal(formatThreatEta(0.14), '140 MS');
    assert.equal(formatThreatEta(0.0004), '0 MS');
    assert.equal(formatThreatEta(-0.2), '0 MS');
    assert.equal(formatThreatEta(0.9994), '999 MS');
    assert.equal(formatThreatEta(0.9996), '1.0S');
    assert.equal(formatThreatEta(1), '1.0S');
    assert.equal(formatThreatEta(1.26), '1.3S');
    assert.equal(formatThreatEta(12.34), '12.3S');
    assert.equal(formatThreatEta(500), '99.9S');
    assert.equal(formatThreatEta(Infinity), '');
    assert.equal(formatThreatEta(NaN), '');
    const threat = getBallThreat(true, 170, 12, 'rear', false, 0.0612);
    assert.equal(threat.label, 'INCOMING 61 MS · BEHIND');
    assert.equal(getBallThreat(true, 17, 30, 'left', false, 1.73).label, 'INCOMING 1.7S · LEFT');
    // Without a predicted contact the label falls back to the distance ETA.
    assert.equal(getBallThreat(true, 17, 8.5, 'front').label, 'INCOMING 500 MS · FRONT');
    // Level still follows the distance ETA / heat (unchanged thresholds).
    assert.equal(getBallThreat(true, 17, 12, 'front', false, 5).level, 'danger');
    assert.equal(getBallThreat(true, 17, 20, 'front', false, 0.1).level, 'alert');
});

test('closing ring: 64 px at the assignment, reticle radius at contact, gold inside the 60 ms PERFECT lead', () => {
    assert.equal(THREAT_RING_MAX_RADIUS, 64);
    assert.equal(THREAT_RING_GOLD_MS, DEFLECT_TIMING_WINDOWS.perfect);
    assert.equal(threatRingRadius(300, 300, 18), 64);
    assert.equal(threatRingRadius(0, 300, 18), 18);
    assert.equal(threatRingRadius(150, 300, 18), 41);
    assert.equal(threatRingRadius(600, 300, 18), 64, 'clamped');
    assert.equal(threatRingRadius(Infinity, 300, 18), 64);
    assert.equal(threatRingRadius(10, 300, NaN), 18 + 46 * (10 / 300));
});

test('ring reaches the reticle within one frame of the simulated G1 contact (5×/10×, 60/144 Hz)', () => {
    for (const hz of [60, 144]) {
        const dt = 1 / hz;
        for (const ratio of [5, 10]) {
            for (let phase = 0; phase < 8; phase++) {
                const speed = ratio * BASE_SPEED;
                const contactTime = 0.5 + phase * dt / 8;
                const path = straightPath({ speed, contactTime });
                const player = createSwingPlayer();
                const ball = createBall({ position: path.at(0), speed, target: player });
                const game = { player, ball };
                let start = null;
                let ringFrame = null;
                for (let j = 1; j < 1000 && ringFrame === null; j++) {
                    path.at(j * dt, ball.position);
                    const contactMs = localContactMs.call(game);
                    start ??= contactMs;
                    if (threatRingRadius(contactMs, start, 18) === 18) ringFrame = j;
                }
                const contactFrame = Math.ceil(contactTime / dt - 1e-9);
                assert.ok(Math.abs(ringFrame - contactFrame) <= 1, `${hz} Hz ${ratio}× phase ${phase}: ring ${ringFrame} contact ${contactFrame}`);
            }
        }
    }
});

// Fake DOM for the UI methods.
function fakeElement(id) {
    const classes = new Set();
    const element = {
        id,
        writes: 0,
        attrs: {},
        dataset: {},
        textContent: '',
        offsetWidth: 10,
        classList: {
            add(...names) { names.forEach(name => classes.add(name)); element.writes++; },
            remove(...names) { names.forEach(name => classes.delete(name)); element.writes++; },
            toggle(name, on) { if (on) classes.add(name); else classes.delete(name); element.writes++; },
            contains: name => classes.has(name)
        },
        setAttribute(name, value) { element.attrs[name] = value; element.writes++; },
        getAttribute: name => element.attrs[name],
        querySelector: () => element.child || null,
        style: { getPropertyValue: name => ({ '--crosshair-size': '12px', '--crosshair-gap': '6px' })[name] || '' }
    };
    return element;
}

function uiHarness() {
    const elements = {};
    for (const id of ['threat-eta-ring', 'incoming-indicator', 'overdrive-banner', 'overdrive-chip', 'crosshair', 'body']) elements[id] = fakeElement(id);
    elements.circle = fakeElement('circle');
    elements['threat-eta-ring'].child = elements.circle;
    elements['threat-eta-ring'].classList.add('hidden');
    elements['overdrive-chip'].classList.add('hidden');
    elements['overdrive-banner'].classList.add('hidden');
    const timers = [];
    const document = {
        body: elements.body,
        getElementById: id => elements[id] || null,
        querySelector: selector => (selector === '#hud .crosshair' ? elements.crosshair : null)
    };
    const texts = [];
    const globals = {
        document,
        Math,
        Number,
        String,
        parseFloat,
        THREAT_RING_GOLD_MS,
        THREAT_RING_MAX_RADIUS,
        THREAT_DIRECTION_LABELS: ['FRONT', 'LEFT', 'RIGHT', 'BEHIND'],
        THREAT_DIRECTIONS: ['front', 'left', 'right', 'rear'],
        OVERDRIVE_BANNER_MS,
        OVERDRIVE_UI_MAX_RATIO,
        threatRingRadius,
        threatEtaKey,
        formatThreatEta,
        setText(el, key, params) { el.textContent = params ? `${key}:${params.x}` : key; texts.push([el.id, key, params?.x]); },
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {}
    };
    const names = ['setThreatEta', 'clearThreatEta', '_readReticleRadius', 'showOverdriveBanner', '_hideOverdriveBanner', 'setOverdrive', '_syncOverdriveChip'];
    const methods = runInNewContext(`({ ${names.map(name => extractMethod(uiSource, name)).join(',\n')} })`, globals);
    const ui = Object.create(methods);
    return { ui, elements, timers, texts };
}

test('UI setThreatEta: label + ring follow each frame, DOM written only on change, strings cached (no steady-state allocation)', () => {
    const { ui, elements } = uiHarness();
    const ring = elements['threat-eta-ring'];
    const circle = elements.circle;
    const indicator = elements['incoming-indicator'];
    // Before the first 20 Hz sample the indicator label is left alone.
    ui.setThreatEta(300, 300);
    assert.equal(ring.classList.contains('hidden'), false);
    assert.equal(circle.attrs.r, '64');
    assert.equal(indicator.dataset.label, undefined);
    ui._threatLabelDirection = 0;
    ui._threatLabelKey = -2;
    ui.setThreatEta(140.2, 300);
    assert.equal(indicator.dataset.label, 'INCOMING 140 MS · FRONT');
    const firstLabel = indicator.dataset.label;
    const writes = circle.writes + ring.writes;
    ui.setThreatEta(140.3, 300); // same ms, same half-pixel radius
    assert.equal(circle.writes + ring.writes, writes, 'no DOM write when nothing shown changes');
    ui.setThreatEta(59.4, 300);
    assert.equal(ring.classList.contains('gold'), true);
    assert.equal(indicator.dataset.label, 'INCOMING 59 MS · FRONT');
    ui.setThreatEta(140.2, 300);
    assert.equal(ring.classList.contains('gold'), false);
    assert.ok(Object.is(indicator.dataset.label, firstLabel), 'cached label string reused');
    ui.setThreatEta(1234, 2000);
    assert.equal(indicator.dataset.label, 'INCOMING 1.2S · FRONT');
    ui.setThreatEta(0, 2000);
    assert.equal(circle.attrs.r, '18', 'reticle radius (12 px arm + 6 px gap) at contact');
    ui.clearThreatEta();
    assert.equal(ring.classList.contains('hidden'), true);
    assert.equal(ring.classList.contains('gold'), false);
    const body = extractMethod(uiSource, 'setThreatEta');
    assert.doesNotMatch(body.replace(/\?\?= `[^`]*`/, '').replace(/\?\?= \[\]/g, '').replace(/\?\?= String\([^)]*\)/, ''), /`|new |\{\s*\w+:|\.toFixed\(/);
});

test('Game.updatePlayerThreat refreshes the ETA every frame while the 20 Hz sample (label level, arrow, audio) stays rate-limited', () => {
    const calls = { eta: [], target: 0, audio: 0 };
    const threat = compileGameMethod('updatePlayerThreat', {
        STATES,
        PLAYER_THREAT_SAMPLE_INTERVAL: 0.05,
        sampleThreatDirection(out) { out.side = 0; out.direction = 'front'; out.behind = false; out.offscreen = false; return out; }
    });
    const player = createSwingPlayer();
    player.camera = null;
    player.position.distanceTo = Vector3.prototype.distanceTo;
    const ball = createBall({ position: { x: 30, y: 1.25, z: 0 }, speed: 85, target: player });
    ball.getSpeed = () => 85;
    const game = {
        state: STATES.PLAYING, ball, player,
        _playerThreatSampleTimer: 0,
        _playerThreatForward: new Vector3(),
        _playerThreatDirection: {},
        _trackThreatAssignment: compileGameMethod('_trackThreatAssignment'),
        _localContactMs: localContactMs,
        _clearPlayerThreat() {},
        ui: {
            setThreatEta: (ms, start) => calls.eta.push([ms, start]),
            setPlayerTarget: () => { calls.target++; }
        },
        audio: { updateThreatAudio: () => { calls.audio++; } }
    };
    const dt = 1 / 144;
    for (let j = 0; j < 144; j++) {
        ball.position.x -= 20 * dt; // stays in front of the player for the whole second
        threat.call(game, dt);
    }
    assert.equal(calls.eta.length, 144, 'every frame');
    assert.ok(calls.target <= 21 && calls.target >= 17, `≤ 20 Hz samples: ${calls.target}`);
    assert.equal(calls.audio, calls.target, 'threat audio keeps its 20 Hz rate limit');
    const start = calls.eta[0][1];
    assert.ok(calls.eta.every(([, s]) => s === start), 'ETA at assignment is fixed for the assignment');
    assert.ok(calls.eta[143][0] < calls.eta[0][0]);
    const body = extractGameMethod('updatePlayerThreat');
    assert.doesNotMatch(body, /new THREE\.|\.clone\(|\{\s*side:/);
});

// ---------------------------------------------------------------------------
// (b6) OVERDRIVE banner / chip / cue
// ---------------------------------------------------------------------------

function overdriveHarness() {
    const log = [];
    const ball = {
        active: true, baseSpeed: BASE_SPEED, currentSpeed: BASE_SPEED, maxSpeed: Infinity,
        get isOverdrive() { return this.currentSpeed >= this.baseSpeed * 5; }
    };
    const game = {
        state: STATES.PLAYING,
        ball,
        ui: {
            showOverdriveBanner: max => log.push(['banner', max]),
            setOverdrive: ratio => log.push(['chip', Math.round(ratio * 10) / 10])
        },
        audio: { playCue: name => log.push(['cue', name]) }
    };
    const update = compileGameMethod('_updateOverdrivePresentation', { STATES, OVERDRIVE_MAX_RATIO: 8, OVERDRIVE_RALLY_RESET_RATIO: 2 });
    return { game, ball, log, step: () => update.call(game) };
}

test('OVERDRIVE: banner + cue exactly once per rally when r crosses 5, chip ×N.N after, MAX from 8×, removed on rally end / round change', () => {
    const { game, ball, log, step } = overdriveHarness();
    const count = kind => log.filter(entry => entry[0] === kind).length;
    // Rally: +0.3× per deflect, 10 frames per exchange.
    for (let deflects = 0; deflects <= 20; deflects++) {
        ball.currentSpeed = BASE_SPEED * (1 + 0.3 * deflects);
        for (let frame = 0; frame < 10; frame++) step();
    }
    assert.equal(count('banner'), 1);
    assert.deepEqual(log.filter(entry => entry[0] === 'cue'), [['cue', 'overdrive-enter']]);
    const bannerIndex = log.findIndex(entry => entry[0] === 'banner');
    assert.deepEqual(log[bannerIndex], ['banner', false], 'first crossing at 5.2× is not MAX');
    assert.equal(log.filter(entry => entry[0] === 'chip' && entry[1] > 0 && entry[1] < 5).length, 0);
    assert.ok(log.some(entry => entry[0] === 'chip' && entry[1] === 7));
    // A slow skill halves the speed mid-rally and it climbs back: no second banner.
    ball.currentSpeed = BASE_SPEED * 3.5;
    step();
    assert.deepEqual(log.at(-1), ['chip', 0], 'chip hidden while not in overdrive');
    ball.currentSpeed = BASE_SPEED * 5.3;
    step();
    assert.equal(count('banner'), 1);
    assert.equal(count('cue'), 1);
    // Rally ends (ball inactive) → chip removed; next rally announces again.
    ball.active = false;
    step();
    assert.deepEqual(log.at(-1), ['chip', 0]);
    ball.active = true;
    ball.currentSpeed = BASE_SPEED;
    step();
    ball.currentSpeed = BASE_SPEED * 8.2;
    step();
    assert.equal(count('banner'), 2);
    assert.deepEqual(log.filter(entry => entry[0] === 'banner')[1], ['banner', true], 'MAX style from 8×');
    assert.equal(count('cue'), 2);
    // Round change (state leaves PLAYING) → removed.
    game.state = 'ROUND_END';
    step();
    assert.deepEqual(log.at(-1), ['chip', 0]);
    const before = log.length;
    step();
    assert.equal(log.length, before, 'no repeated clears');
});

test('OVERDRIVE UI: banner 1.2 s then chip; setOverdrive(0) removes both; chip text rebuilt only when ×N.N changes', () => {
    const { ui, elements, timers, texts } = uiHarness();
    const banner = elements['overdrive-banner'];
    const chip = elements['overdrive-chip'];
    ui.setOverdrive(0);
    ui.showOverdriveBanner(false);
    ui.setOverdrive(5.2);
    assert.equal(banner.classList.contains('hidden'), false);
    assert.equal(banner.classList.contains('show'), true);
    assert.equal(banner.textContent, 'hud.overdrive');
    assert.equal(chip.classList.contains('hidden'), true, 'chip waits for the banner');
    assert.equal(elements.body.classList.contains('overdrive-on'), true);
    assert.equal(timers.at(-1).ms, 1200);
    timers.at(-1).fn();
    assert.equal(banner.classList.contains('hidden'), true);
    assert.equal(chip.classList.contains('hidden'), false);
    assert.equal(chip.textContent, 'hud.overdriveChip:5.2');
    const textCount = texts.length;
    for (let index = 0; index < 50; index++) ui.setOverdrive(5.2);
    assert.equal(texts.length, textCount, 'no rebuild while the ratio is unchanged');
    ui.setOverdrive(8.2);
    assert.equal(chip.dataset.max, 'true');
    assert.equal(chip.textContent, 'hud.overdriveChip:8.2');
    ui.showOverdriveBanner(true);
    assert.equal(banner.textContent, 'hud.overdriveMax');
    assert.equal(banner.dataset.max, 'true');
    ui.setOverdrive(0);
    assert.equal(banner.classList.contains('hidden'), true);
    assert.equal(chip.classList.contains('hidden'), true);
    assert.equal(elements.body.classList.contains('overdrive-on'), false);
});

test('overdrive-enter cue is registered with a ≥ 1200 ms retrigger guard and synthesized', () => {
    assert.match(audioSource, /'overdrive-enter': \{ fn: 'playOverdriveEnter', retriggerMs: 1200 \}/);
    const start = audioSource.indexOf('    playOverdriveEnter() {');
    const body = audioSource.slice(start, audioSource.indexOf('\n    }', start));
    assert.ok(start > 0);
    assert.match(body, /createOscillator\(\)/);
    assert.doesNotMatch(body, /_playKenneyClip|playSfx|\.ogg|\.mp3|\.wav/);
    assert.match(gameSource, /this\.audio\?\.playCue\?\.\('overdrive-enter'\);/);
});

test('HUD markup, locales (EN/TR parity), reduced motion and lane geometry for banner/chip/ring', () => {
    assert.match(html, /<svg id="threat-eta-ring" class="hidden" aria-hidden="true"[^>]*><circle cx="0" cy="0" r="64"><\/circle><\/svg>/);
    assert.match(html, /<div id="overdrive-banner" class="hidden" role="status" aria-live="polite"/);
    assert.match(html, /<div id="overdrive-chip" class="hidden" aria-hidden="true"><\/div>/);
    for (const key of ['overdrive', 'overdriveMax', 'overdriveChip']) {
        assert.match(en, new RegExp(`\\n        ${key}: '`), `en hud.${key}`);
        assert.match(tr, new RegExp(`\\n        ${key}: '`), `tr hud.${key}`);
    }
    assert.match(en, /overdriveChip: 'OVERDRIVE ×\{x\}'/);
    assert.match(tr, /overdriveChip: '[^']*×\{x\}'/);
    for (const source of [en, tr, html, uiSource, gameSource, hudCss]) {
        assert.doesNotMatch(source.slice(source.indexOf('overdrive')), /SUDDEN DEATH[^']*overdrive|overdrive[^\n]*SUDDEN DEATH/i);
    }
    assert.doesNotMatch(en.slice(en.indexOf('overdrive:'), en.indexOf('overdriveChip')), /SUDDEN/i);
    // Reduced Motion: text only, no pulse.
    assert.match(hudCss, /@media \(prefers-reduced-motion: reduce\) \{\s+#overdrive-banner\.show, #overdrive-chip \{ animation: none; \}/);
    assert.match(hudCss, /body\.reduced-motion #overdrive-banner\.show,\s+body\.reduced-motion #overdrive-chip,/);
    // Desktop slot 98..126 px: below the score (≤ 68), heat pip (≤ 84) and the
    // front threat arrow (top 82 ± 10), above the countdown lane (128 px).
    const bannerTop = Number(/#overdrive-banner \{\s+top: max\((\d+)px/.exec(hudCss)[1]);
    const chipTop = Number(/#overdrive-chip \{\s+top: max\((\d+)px/.exec(hudCss)[1]);
    assert.equal(bannerTop, 98);
    assert.equal(chipTop, 100);
    const bannerHeight = 22 + 3 * 2; // line-height + padding
    assert.ok(bannerTop + bannerHeight <= 128, 'clear of the countdown (top 128 px) and the COVER chip (292 px)');
    assert.ok(bannerTop > 82 + 8.5 * 1.18, 'clear of the front arrow at its largest scale');
    assert.match(hudCss, /body\.overdrive-on #controls-hint \{ display: none; \}/);
    // Phones: left lane, 16 px short of the right-lane incoming label
    // (right 8 px + 118 px min-width + 22 px padding/border).
    assert.match(hudCss, /@media \(max-width: 700px\) \{[\s\S]*?left: 8px;\s+transform: none;\s+max-width: calc\(100vw - 172px\);/);
    const labelLeftFromRight = 8 + 118 + 2 * 10 + 2;
    assert.ok(8 + (375 - 172) <= 375 - labelLeftFromRight - 8);
    // The ring is centred on the reticle, pointer-transparent.
    assert.match(hudCss, /#threat-eta-ring \{\s+position: fixed;\s+top: 50%;\s+left: 50%;[\s\S]*?pointer-events: none;/);
});
