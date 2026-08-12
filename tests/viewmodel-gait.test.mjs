import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    advanceViewmodelGait,
    advanceViewmodelLanding,
    createKnifeAnimationState,
    resolveKnifePose,
    resolveViewmodelGaitBob,
    startKnifeAnimation,
    triggerViewmodelLanding,
    VIEWMODEL_LANDING_DURATION,
    VIEWMODEL_LANDING_IMPACT_SPEED
} from '../js/knife-animation.js';

const createGait = () => ({ phase: 0, weight: 0, speed: 0 });
const idleKnife = () => {
    const state = createKnifeAnimationState('classic');
    startKnifeAnimation(state, 'idle');
    return state;
};
const poseFor = (state, gait, reduceMotion = false) => resolveKnifePose(state, {
    gaitPhase: gait.phase,
    gaitWeight: gait.weight,
    gaitSpeed: gait.speed,
    reduceMotion
});

test('gait settles below the idle amplitude budget within 250ms', () => {
    const idle = createGait();
    assert.equal(resolveViewmodelGaitBob(idle.phase, idle.weight, idle.speed), 0, 'idle startup must be still');

    const gait = { phase: Math.PI / 2, weight: 1, speed: 13 };
    for (let index = 0; index < 15; index++) advanceViewmodelGait(gait, 1 / 60, 0, true, false);
    assert.ok(Math.abs(resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed)) <= 0.001);
});

test('gait has bounded 60Hz arm deltas across idle, move, sprint, and dash', () => {
    const gait = createGait();
    const state = idleKnife();
    let previousY = poseFor(state, gait).armPosition[1];
    let maxDelta = 0;
    for (const [speed, dashActive] of [
        ...Array.from({ length: 30 }, () => [0, false]),
        ...Array.from({ length: 45 }, () => [10, false]),
        ...Array.from({ length: 45 }, () => [13, false]),
        ...Array.from({ length: 30 }, () => [12, true]),
        ...Array.from({ length: 30 }, () => [0, false])
    ]) {
        advanceViewmodelGait(gait, 1 / 60, speed, true, dashActive);
        const nextY = poseFor(state, gait).armPosition[1];
        maxDelta = Math.max(maxDelta, Math.abs(nextY - previousY));
        previousY = nextY;
    }
    assert.ok(maxDelta <= 0.004, `max armY delta ${maxDelta}`);
});

test('gait amplitude stays in the walk and sprint/bhop budgets, while dash can only decay it', () => {
    assert.ok(Math.abs(resolveViewmodelGaitBob(Math.PI / 2, 1, 10)) >= 0.006);
    assert.ok(Math.abs(resolveViewmodelGaitBob(Math.PI / 2, 1, 10)) <= 0.010);
    for (const speed of [13, 16]) {
        assert.ok(Math.abs(resolveViewmodelGaitBob(Math.PI / 2, 1, speed)) <= 0.014);
    }

    const gait = { phase: Math.PI / 2, weight: 1, speed: 10 };
    const before = Math.abs(resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed));
    advanceViewmodelGait(gait, 1 / 60, 12, true, true);
    const duringDash = Math.abs(resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed));
    assert.ok(duringDash <= before, `dash bob grew from ${before} to ${duringDash}`);
});

test('dash and stop cadence envelopes never snap more than the 60Hz arm-Y budget', () => {
    for (const target of [0, 12]) {
        let worstDelta = 0;
        for (let sample = 0; sample < 120; sample++) {
            const gait = { phase: sample / 120 * Math.PI * 2, weight: 1, speed: 12 };
            const before = resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed);
            advanceViewmodelGait(gait, 1 / 60, target, true, target === 0);
            const after = resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed);
            worstDelta = Math.max(worstDelta, Math.abs(after - before));
        }
        assert.ok(worstDelta <= 0.004, `target ${target} snapped by ${worstDelta}`);
    }
});

test('dt integration keeps phase, weight, and pose amplitude within five percent across frame rates', () => {
    const simulate = fps => {
        const gait = createGait();
        for (let index = 0; index < fps; index++) advanceViewmodelGait(gait, 1 / fps, 10, true, false);
        return { ...gait, bob: Math.abs(resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed)) };
    };
    const at60 = simulate(60);
    for (const fps of [20, 144]) {
        const result = simulate(fps);
        for (const key of ['phase', 'weight', 'bob']) {
            const tolerance = Math.max(1e-9, Math.abs(at60[key]) * 0.05);
            assert.ok(Math.abs(result[key] - at60[key]) <= tolerance, `${fps}fps ${key} drifted`);
        }
    }
});

test('gait phase only advances through speed changes and reduced motion preserves knife actions', () => {
    const gait = createGait();
    advanceViewmodelGait(gait, 1 / 60, 10, true, false);
    const walkPhase = gait.phase;
    advanceViewmodelGait(gait, 1 / 60, 2, true, false);
    const slowPhase = gait.phase;
    advanceViewmodelGait(gait, 1 / 60, 13, true, false);
    assert.ok(slowPhase > walkPhase && gait.phase > slowPhase, 'speed changes must not reset or reverse phase');

    const state = createKnifeAnimationState('bayonet');
    startKnifeAnimation(state, 'slash');
    state.elapsed = state.duration * 0.5;
    const activeGait = { phase: Math.PI / 2, weight: 1, speed: 13 };
    const regular = poseFor(state, activeGait);
    const reduced = poseFor(state, activeGait, true);
    const regularBob = Math.abs(regular.armPosition[1] - (-0.3));
    const reducedBob = Math.abs(reduced.armPosition[1] - (-0.3));
    assert.ok(reducedBob <= regularBob * 0.25 + 1e-9);
    assert.equal(reduced.action, 'slash');
    assert.equal(reduced.progress, regular.progress);
    assert.equal(reduced.armPosition[2], regular.armPosition[2]);
    assert.equal(reduced.knifeRotation[2], regular.knifeRotation[2]);
});

test('landing is a thresholded, impact-scaled sine pulse with no restart or plateau', () => {
    const tooSoft = { active: false, elapsed: 0, offset: 0, depth: 0 };
    assert.equal(triggerViewmodelLanding(tooSoft, 3.99), false);
    assert.equal(tooSoft.active, false);

    const peakFor = impact => {
        const landing = { active: false, elapsed: 0, offset: 0, depth: 0 };
        assert.equal(triggerViewmodelLanding(landing, impact), true);
        const depth = landing.depth;
        const startDepth = landing.depth;
        assert.equal(triggerViewmodelLanding(landing, 12), false, 'an active pulse must not restart or stack');
        assert.equal(landing.depth, startDepth);
        const offsets = [];
        const samples = [];
        while (landing.active) {
            offsets.push(advanceViewmodelLanding(landing, 1 / 60));
            samples.push(landing.elapsed);
        }
        return { depth, offsets, samples, landing };
    };
    const at4 = peakFor(4);
    const at8 = peakFor(8);
    const at12 = peakFor(12);
    assert.deepEqual([at4.depth, at8.depth, at12.depth], [0.002, 0.004, 0.006]);
    for (const result of [at4, at8, at12]) {
        const peak = Math.max(...result.offsets.map(Math.abs));
        const peakIndex = result.offsets.findIndex(value => Math.abs(value) === peak);
        assert.ok(peakIndex >= 0 && result.samples[peakIndex] >= 0.08 && result.samples[peakIndex] <= 0.1, 'peak must be near 90ms');
        assert.ok(result.offsets.every(value => value <= 0 && value >= -0.006));
        assert.ok(Math.abs(result.offsets[0]) <= 0.004, `first delta ${result.offsets[0]}`);
        for (let index = 1; index < result.offsets.length; index++) {
            assert.ok(Math.abs(result.offsets[index] - result.offsets[index - 1]) <= 0.004, '60Hz landing delta exceeded budget');
        }
        assert.equal(result.offsets.at(-1), 0);
        assert.equal(result.landing.active, false);
        assert.equal(result.landing.elapsed, 0);
        assert.equal(result.landing.depth, 0);
    }
});

test('landing peak and duration remain within five percent at 20, 60, and 144Hz', () => {
    const simulate = fps => {
        const landing = { active: false, elapsed: 0, offset: 0, depth: 0 };
        triggerViewmodelLanding(landing, 12);
        let peak = 0;
        let duration = 0;
        while (landing.active) {
            const previousElapsed = landing.elapsed;
            peak = Math.max(peak, Math.abs(advanceViewmodelLanding(landing, 1 / fps)));
            if (!landing.active) duration = previousElapsed + Math.min(1 / fps, VIEWMODEL_LANDING_DURATION - previousElapsed);
        }
        return { peak, duration };
    };
    const at60 = simulate(60);
    for (const fps of [20, 144]) {
        const result = simulate(fps);
        assert.ok(Math.abs(result.peak - at60.peak) <= at60.peak * 0.05, `${fps}fps peak drifted`);
        assert.ok(Math.abs(result.duration - at60.duration) <= at60.duration * 0.05, `${fps}fps duration drifted`);
    }
});

test('airborne-to-ground landing ordering holds gait reactivation until the visual pulse ends', () => {
    let worstDelta = 0;
    for (const flightFrames of [3, 9, 18]) {
        for (const speed of [12, 13]) {
            for (const impact of [8, 10, 12]) {
                for (let sample = 0; sample < 180; sample++) {
                    const gait = { phase: sample / 180 * Math.PI * 2, weight: 1, speed };
                    const landing = { active: false, elapsed: 0, offset: 0, depth: 0 };
                    for (let frame = 0; frame < flightFrames; frame++) advanceViewmodelGait(gait, 1 / 60, speed, false, false);
                    triggerViewmodelLanding(landing, impact);
                    let previous = resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed) + landing.offset;
                    while (landing.active) {
                        advanceViewmodelGait(gait, 1 / 60, speed, false, false);
                        const landingOffset = advanceViewmodelLanding(landing, 1 / 60);
                        const next = resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed) + landingOffset;
                        worstDelta = Math.max(worstDelta, Math.abs(next - previous));
                        previous = next;
                    }
                    advanceViewmodelGait(gait, 1 / 60, speed, true, false);
                    const resumed = resolveViewmodelGaitBob(gait.phase, gait.weight, gait.speed);
                    worstDelta = Math.max(worstDelta, Math.abs(resumed - previous));
                }
            }
        }
    }
    assert.ok(worstDelta <= 0.004, `combined gait/landing delta ${worstDelta}`);
});

test('reduced motion scales the landing-only viewmodel offset without suppressing an attack pose', () => {
    const state = createKnifeAnimationState('classic');
    startKnifeAnimation(state, 'slash');
    state.elapsed = state.duration * 0.5;
    const context = { landingElapsed: 0.05, landingDepth: 0.006, gaitPhase: 0, gaitWeight: 0, gaitSpeed: 0 };
    const regular = resolveKnifePose(state, context);
    const reduced = resolveKnifePose(state, { ...context, reduceMotion: true });
    assert.equal(reduced.action, 'slash');
    assert.equal(reduced.progress, regular.progress);
    assert.equal(reduced.armPosition[2], regular.armPosition[2]);
    assert.ok(Math.abs(reduced.armPosition[1] + 0.3) <= Math.abs(regular.armPosition[1] + 0.3) * 0.25 + 1e-9);
});

test('bhop-scale landing pulse stays at forty percent of the full visual cap', () => {
    const landing = { active: false, elapsed: 0, offset: 0, depth: 0 };
    assert.equal(triggerViewmodelLanding(landing, 12, 0.4), true);
    let peak = 0;
    while (landing.active) peak = Math.max(peak, Math.abs(advanceViewmodelLanding(landing, 1 / 144)));
    assert.ok(peak <= 0.0024 + 1e-9);
});

test('Player wires gait after final speed resolution and derives reduced motion locally', async () => {
    const source = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    const speedIndex = source.indexOf('        this.horizontalSpeed = Math.hypot(this._frameVel.x, this._frameVel.z);');
    const gaitIndex = source.indexOf('        advanceViewmodelGait(this._viewGait, dt, this.horizontalSpeed, this.onGround && !this._viewLanding.active, wasDashing);');
    const cameraIndex = source.indexOf('        if (!this.killcamLock) {', speedIndex);
    assert.ok(speedIndex >= 0 && gaitIndex > speedIndex && cameraIndex > gaitIndex);
    assert.match(source, /context\.gaitPhase = this\._viewGait\.phase;[\s\S]*?context\.gaitWeight = this\._viewGait\.weight;[\s\S]*?context\.reduceMotion = this\._prefersReducedMotion\(\);/);
    assert.match(source, /this\._reducedMotionMedia = typeof window !== 'undefined'[\s\S]*?window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\) \|\| null/);
    const reducedMotionStart = source.indexOf('    _prefersReducedMotion() {');
    const reducedMotionEnd = source.indexOf('\n    }', reducedMotionStart) + 6;
    const reducedMotion = source.slice(reducedMotionStart, reducedMotionEnd);
    assert.match(reducedMotion, /document\.body\?\.classList\?\.contains\('reduced-motion'\)/);
    assert.match(reducedMotion, /this\._reducedMotionMedia\?\.matches === true/);
    assert.doesNotMatch(reducedMotion, /matchMedia/);
    assert.doesNotMatch(source, /_viewTime/);
    assert.match(source, /const wasAirborneBeforeLanding = !this\.onGround;[\s\S]*?const landingImpactSpeed = Math\.max\(0, -this\.verticalVel\);/);
    assert.match(source, /pendingLanding = wasAirborneBeforeLanding;/);
    assert.match(source, /pendingLanding = true;/);
    assert.match(source, /if \(pendingLanding && !swimming && this\.onGround\) \{[\s\S]*?const landingScale = this\.bhopEnabled && this\.keys\['Space'\] \? 0\.4 : 1;[\s\S]*?this\._onViewmodelLanding\(landingImpactSpeed, landingScale\);/);
    assert.equal((source.match(/this\._onViewmodelLanding\(landingImpactSpeed, landingScale\);/g) || []).length, 1, 'ground and platform contacts share one deferred landing emission');
    const jumpPadIndex = source.indexOf('        this._jumpPadCooldown = Math.max(0, (this._jumpPadCooldown || 0) - dt);');
    const pendingEmissionIndex = source.indexOf('        if (pendingLanding && !swimming && this.onGround) {');
    assert.ok(jumpPadIndex >= 0 && pendingEmissionIndex > jumpPadIndex, 'landing feedback must wait until after jump-pad launch resolution');
    const landingHandlerStart = source.indexOf('    _onViewmodelLanding(impactSpeed, visualScale = 1) {');
    const landingHandlerEnd = source.indexOf('\n    }', landingHandlerStart) + 6;
    const landingHandler = source.slice(landingHandlerStart, landingHandlerEnd);
    assert.match(landingHandler, /this\.audio\?\.playLand\?\.\(\);/);
    assert.match(landingHandler, /return triggerViewmodelLanding\(this\._viewLanding, impactSpeed, visualScale\);/);
    assert.match(source, /advanceViewmodelLanding\(this\._viewLanding, dt, this\._prefersReducedMotion\(\)\);/);
    assert.match(source, /this\.armGroup\.position\.set\(0\.25, -0\.3 \+ this\._viewLanding\.offset, -0\.3\);/);
    for (const method of ['die', 'respawn']) {
        const start = source.indexOf(`    ${method}() {`);
        const end = source.indexOf('\n    }', start) + 6;
        assert.match(source.slice(start, end), /this\._resetViewmodelLanding\(\);/, `${method} must clear landing state`);
    }
});
