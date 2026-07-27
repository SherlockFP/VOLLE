import test from 'node:test';
import assert from 'node:assert/strict';

import {
    JOINTS,
    POSE_STATES,
    ONE_SHOT_STATES,
    STATE_DURATION,
    neutralPose,
    isPoseState,
    poseFor,
    blendPose,
    locomotionState,
    stepAnimator,
    triggerAction,
    createAnimatorState,
    resolvePose
} from '../js/character-pose.js';

const AXES = ['x', 'y', 'z'];
const SCALAR_KEYS = ['offsetY', 'lean'];

function allValues(pose) {
    const values = SCALAR_KEYS.map((key) => pose[key]);
    for (const joint of JOINTS) {
        for (const axis of AXES) values.push(pose[joint][axis]);
    }
    return values;
}

function assertAllFinite(pose, message) {
    for (const value of allValues(pose)) {
        assert.equal(typeof value, 'number', message);
        assert.ok(Number.isFinite(value), message || `expected finite, got ${value}`);
    }
}

function assertPoseClose(actual, expected, eps = 1e-9, message = '') {
    for (const key of SCALAR_KEYS) {
        assert.ok(
            Math.abs(actual[key] - expected[key]) <= eps,
            `${message} ${key}: ${actual[key]} !~ ${expected[key]}`
        );
    }
    for (const joint of JOINTS) {
        for (const axis of AXES) {
            const a = actual[joint][axis];
            const b = expected[joint][axis];
            assert.ok(Math.abs(a - b) <= eps, `${message} ${joint}.${axis}: ${a} !~ ${b}`);
        }
    }
}

test('neutralPose returns every joint with x/y/z zeroed, plus offsetY and lean', () => {
    const pose = neutralPose();
    assert.deepEqual(Object.keys(pose).sort(), [...JOINTS, 'offsetY', 'lean'].sort());
    assert.equal(pose.offsetY, 0);
    assert.equal(pose.lean, 0);
    for (const joint of JOINTS) {
        assert.deepEqual(pose[joint], { x: 0, y: 0, z: 0 });
    }
});

test('neutralPose returns a fresh object every call (no shared aliasing)', () => {
    const a = neutralPose();
    const b = neutralPose();
    a.hips.x = 99;
    a.offsetY = 5;
    assert.equal(b.hips.x, 0);
    assert.equal(b.offsetY, 0);
    assert.notEqual(a, b);
    assert.notEqual(a.hips, b.hips);
});

test('poseFor is deterministic and produces only finite numbers across a broad sweep', () => {
    const times = [-12.5, 0, 0.001, 0.25, 1, 3.7, 12.34];
    const progresses = [-2, 0, 0.1, 0.4, 0.62, 0.75, 1, 2];
    const speeds = [-10, 0, 0.45, 3, 7.5, 12, 18, 24, 1000];
    const aims = [-10, -1.2, -0.5, 0, 0.5, 1.2, 10];

    for (const state of POSE_STATES) {
        for (const time of times) {
            for (const progress of progresses) {
                for (const speed of speeds) {
                    for (const aim of aims) {
                        const params = { progress, speed, aim, strafe: 0.3, seed: 1.1 };
                        const first = poseFor(state, time, params);
                        const second = poseFor(state, time, params);
                        assert.deepEqual(
                            first,
                            second,
                            `poseFor(${state}) not deterministic for ${JSON.stringify(params)} @ t=${time}`
                        );
                        assertAllFinite(first, `poseFor(${state}, ${time}, ${JSON.stringify(params)})`);
                    }
                }
            }
        }
    }
});

test('poseFor clamps hostile params to finite numbers for every state', () => {
    // NaN/Infinity/null/undefined/strings/huge numbers on speed, aim, progress, strafe, seed
    // all pass through num()+clamp() before use, so these must never leak NaN/Infinity.
    const hostileTimes = [NaN, Infinity, -Infinity, 'nope', null, undefined, {}, [], 0, -50, 1e6];
    const hostileParamSets = [
        { speed: NaN, aim: Infinity, progress: -Infinity, strafe: null, seed: undefined },
        { speed: undefined, aim: NaN, progress: null, strafe: 'abc', seed: {} },
        { speed: 'fast', aim: [], progress: true, strafe: Number.MAX_VALUE, seed: -Infinity },
        { speed: Number.MAX_VALUE, aim: -Number.MAX_VALUE, progress: NaN, strafe: Infinity, seed: NaN },
        {} // missing params entirely
    ];

    for (const state of POSE_STATES) {
        for (const time of hostileTimes) {
            for (const params of hostileParamSets) {
                const pose = poseFor(state, time, params);
                assertAllFinite(pose, `poseFor(${state}, ${String(time)}, ${JSON.stringify(params)})`);
            }
        }
    }
});

test('BUG: poseFor produces NaN for huge (but finite) time values', () => {
    // js/character-pose.js:52-59 does `const t = num(time)`, which only rejects
    // non-finite `time` (NaN/Infinity) — it does NOT bound its magnitude. Several
    // states then compute `t * rate + seed` (idle, walk, run, emote, victory). For
    // time values close to Number.MAX_VALUE, that multiplication overflows to
    // +/-Infinity, and Math.sin(Infinity) is NaN — which then flows straight into
    // the returned pose. This violates the module's own contract (the `num()`
    // helper exists specifically to keep hostile input from producing NaN) and
    // the task requirement that "huge numbers must never produce NaN in the
    // output". Expected/correct behavior: poseFor must clamp or otherwise bound
    // `time` so every field stays finite for ANY finite input, however large.
    const pose = poseFor('idle', Number.MAX_VALUE, {});
    assertAllFinite(pose, 'poseFor(idle, Number.MAX_VALUE, {}) must stay finite');
});

test('walk swings legs and arms in opposition at a non-zero phase', () => {
    // seed defaults to 0, walk phase = t * 5.4; pick t so phase === PI/2 (sin = 1, clearly non-zero).
    const t = (Math.PI / 2) / 5.4;
    const pose = poseFor('walk', t, {});

    assert.notEqual(pose.hipL.x, 0);
    assert.notEqual(pose.shoulderL.x, 0);

    // Legs oppose each other.
    assert.equal(pose.hipL.x, -pose.hipR.x);
    // Arms oppose each other.
    assert.equal(pose.shoulderL.x, -pose.shoulderR.x);
    // Same-side arm swings opposite to same-side leg.
    assert.notEqual(Math.sign(pose.shoulderL.x), Math.sign(pose.hipL.x));
    assert.notEqual(Math.sign(pose.shoulderR.x), Math.sign(pose.hipR.x));

    // Only the forward-swinging leg bends its knee; the trailing leg stays straight.
    const bentKnee = pose.hipL.x < 0 ? pose.kneeL.x : pose.kneeR.x;
    const straightKnee = pose.hipL.x < 0 ? pose.kneeR.x : pose.kneeL.x;
    assert.ok(bentKnee > 0);
    assert.equal(straightKnee, 0);
});

test('run swings legs and arms in opposition at a non-zero phase', () => {
    const speed = 0;
    const rate = 6.2 + Math.min(Math.max(speed, 0), 18) * .28; // matches internal `rate` for speed=0
    const t = (Math.PI / 2) / rate;
    const pose = poseFor('run', t, { speed });

    assert.notEqual(pose.hipL.x, 0);
    assert.notEqual(pose.shoulderL.x, 0);
    assert.equal(pose.hipL.x, -pose.hipR.x);
    assert.equal(pose.shoulderL.x, -pose.shoulderR.x);
    assert.notEqual(Math.sign(pose.shoulderL.x), Math.sign(pose.hipL.x));
    assert.notEqual(Math.sign(pose.shoulderR.x), Math.sign(pose.hipR.x));
});

test('dead pose ignores aim and strafe entirely', () => {
    const noAim = poseFor('dead', 1, { progress: .5, aim: 0, strafe: 0 });
    const bigAim = poseFor('dead', 1, { progress: .5, aim: 1.2, strafe: 1 });
    assert.deepEqual(noAim, bigAim);
    assert.equal(bigAim.lean, 0);

    // Sanity: aim/strafe DO affect a living state the same way, proving the sweep isn't vacuous.
    const idleNoAim = poseFor('idle', 1, { aim: 0, strafe: 0 });
    const idleBigAim = poseFor('idle', 1, { aim: 1.2, strafe: 1 });
    assert.notDeepEqual(idleNoAim, idleBigAim);
});

test('blendPose(a, b, 0) is a, blendPose(a, b, 1) is b, midpoint lies between', () => {
    const from = poseFor('idle', 0, {});
    const to = poseFor('run', 2, { speed: 10 });

    assertPoseClose(blendPose(from, to, 0), from);
    assertPoseClose(blendPose(from, to, 1), to);

    const mid = blendPose(from, to, 0.5);
    for (const key of SCALAR_KEYS) {
        const lo = Math.min(from[key], to[key]);
        const hi = Math.max(from[key], to[key]);
        assert.ok(mid[key] >= lo - 1e-9 && mid[key] <= hi + 1e-9, `mid.${key} out of range`);
    }
    for (const joint of JOINTS) {
        for (const axis of AXES) {
            const lo = Math.min(from[joint][axis], to[joint][axis]);
            const hi = Math.max(from[joint][axis], to[joint][axis]);
            const value = mid[joint][axis];
            assert.ok(value >= lo - 1e-9 && value <= hi + 1e-9, `mid.${joint}.${axis} out of range`);
        }
    }
});

test('blendPose clamps out-of-range and hostile amounts', () => {
    const from = poseFor('idle', 0, {});
    const to = poseFor('victory', 3, {});

    assertPoseClose(blendPose(from, to, -5), from);
    assertPoseClose(blendPose(from, to, 7), to);
    // Non-finite amounts (NaN/Infinity) go through the shared `num()` helper, which
    // falls back to 0 for any non-finite value — so they land on `from`, not `to`.
    assertPoseClose(blendPose(from, to, NaN), from);
    assertPoseClose(blendPose(from, to, Infinity), from);
    assertPoseClose(blendPose(from, to, -Infinity), from);
    assertPoseClose(blendPose(from, to, 'nope'), from);
});

test('locomotionState truth table', () => {
    // dead beats everything
    assert.equal(locomotionState({ alive: false }), 'dead');
    assert.equal(
        locomotionState({ alive: false, grounded: false, verticalSpeed: 10, speed: 100 }),
        'dead'
    );

    // airborne: rising vs falling
    assert.equal(locomotionState({ grounded: false, verticalSpeed: 0.401, alive: true }), 'jump');
    assert.equal(locomotionState({ grounded: false, verticalSpeed: 0.4, alive: true }), 'fall');
    assert.equal(locomotionState({ grounded: false, verticalSpeed: 0, alive: true }), 'fall');
    assert.equal(locomotionState({ grounded: false, verticalSpeed: -5, alive: true }), 'fall');

    // grounded speed thresholds
    assert.equal(locomotionState({ grounded: true, speed: 0, alive: true }), 'idle');
    assert.equal(locomotionState({ grounded: true, speed: 0.45, alive: true }), 'idle');
    assert.equal(locomotionState({ grounded: true, speed: 0.451, alive: true }), 'walk');
    assert.equal(locomotionState({ grounded: true, speed: 7.5, alive: true }), 'walk');
    assert.equal(locomotionState({ grounded: true, speed: 7.501, alive: true }), 'run');
    assert.equal(locomotionState({ grounded: true, speed: 1000, alive: true }), 'run');

    // defaults: no args => grounded true, speed 0, alive true => idle
    assert.equal(locomotionState(), 'idle');
    assert.equal(locomotionState({}), 'idle');
});

test('stepAnimator holds a one-shot state until its duration elapses, then falls back to locomotion', () => {
    let controller = triggerAction(createAnimatorState(), 'throw');
    assert.equal(controller.state, 'throw');
    assert.equal(controller.previousState, 'idle');

    const facts = { speed: 0, grounded: true, alive: true }; // locomotion underneath is 'idle'
    const dt = 0.1;
    const progresses = [];
    let switched = null;

    for (let i = 0; i < 8 && !switched; i++) {
        controller = stepAnimator(controller, dt, facts);
        if (controller.state === 'throw') {
            progresses.push(controller.progress);
        } else {
            switched = { ...controller };
        }
    }

    // Held in 'throw' for multiple ticks before falling back.
    assert.ok(progresses.length >= 4, `expected several throw ticks, got ${progresses.length}`);
    // progress rose monotonically 0 -> 1 while in the one-shot.
    for (let i = 1; i < progresses.length; i++) {
        assert.ok(progresses[i] > progresses[i - 1], `progress must rise monotonically: ${progresses}`);
    }
    assert.ok(progresses[progresses.length - 1] <= 1);
    assert.ok(progresses[0] > 0);

    // Fell back to locomotion once elapsed passed STATE_DURATION.throw.
    assert.ok(switched, 'expected a fallback tick within 8 steps');
    assert.equal(switched.state, 'idle');
    assert.equal(switched.oneShot, null);
    assert.equal(switched.previousState, 'throw');
    assert.equal(switched.blend, 0); // state just changed -> blend resets
});

test('blend ramps back to 1 after a state change', () => {
    let controller = triggerAction(createAnimatorState(), 'throw');
    const facts = { speed: 0, grounded: true, alive: true };
    const dt = 0.1;

    // Step through the whole throw duration (STATE_DURATION.throw = .52) plus the change tick.
    for (let i = 0; i < 6; i++) controller = stepAnimator(controller, dt, facts);
    assert.equal(controller.state, 'idle');
    assert.equal(controller.blend, 0);

    controller = stepAnimator(controller, dt, facts);
    assert.ok(controller.blend > 0 && controller.blend < 1, `expected partial blend, got ${controller.blend}`);

    controller = stepAnimator(controller, dt, facts);
    assert.equal(controller.blend, 1);

    // Further steps stay clamped at 1, never overshoot.
    controller = stepAnimator(controller, dt, facts);
    assert.equal(controller.blend, 1);
});

test('stepAnimator clamps dt so a huge or hostile dt cannot skip past one duration and cannot produce NaN', () => {
    const facts = { speed: 0, grounded: true, alive: true };

    // Huge dt: internal step is clamped to .25, which is less than STATE_DURATION.throw (.52),
    // so a single huge-dt tick must NOT finish the one-shot outright.
    let controller = triggerAction(createAnimatorState(), 'throw');
    controller = stepAnimator(controller, 1e15, facts);
    assert.equal(controller.state, 'throw', 'huge dt must not skip the whole one-shot in a single tick');
    assert.equal(controller.elapsed, 0.25);
    assertAllFinite(resolvePose(controller, facts));

    // Hostile dt values must never produce NaN/Infinity anywhere in the controller.
    for (const dt of [NaN, Infinity, -Infinity, -5, 'oops', null, undefined]) {
        const fresh = triggerAction(createAnimatorState(), 'deflect');
        const stepped = stepAnimator(fresh, dt, facts);
        for (const key of ['elapsed', 'time', 'progress', 'blend', 'seed']) {
            assert.ok(Number.isFinite(stepped[key]), `${key} must stay finite for dt=${String(dt)}, got ${stepped[key]}`);
        }
        assert.ok(isPoseState(stepped.state));
        assertAllFinite(resolvePose(stepped, facts));
    }
});

test('triggerAction ignores non-one-shot actions and returns the controller unchanged', () => {
    const controller = createAnimatorState();
    for (const bogus of ['idle', 'walk', 'run', 'jump', 'fall', 'emote', 'victory', 'nonsense', '', null, undefined]) {
        const result = triggerAction(controller, bogus);
        assert.equal(result, controller, `expected same reference for action=${String(bogus)}`);
    }
    // Sanity: real one-shots DO change it.
    for (const action of ONE_SHOT_STATES) {
        const result = triggerAction(controller, action);
        assert.notEqual(result, controller);
        assert.equal(result.state, action);
    }
});

test('resolvePose cross-fades: blend 0 matches previous state, blend 1 matches new state', () => {
    const shared = { state: 'walk', time: 1.234, progress: 0.3, seed: 0, previousState: 'idle' };

    const atStart = resolvePose({ ...shared, blend: 0 }, {});
    const expectedFrom = poseFor('idle', 1.234, { progress: 1, seed: 0 });
    assertPoseClose(atStart, expectedFrom);

    const atEnd = resolvePose({ ...shared, blend: 1 }, {});
    const expectedTarget = poseFor('walk', 1.234, { progress: 0.3, seed: 0 });
    assert.deepEqual(atEnd, expectedTarget);

    const mid = resolvePose({ ...shared, blend: 0.5 }, {});
    assertPoseClose(mid, blendPose(expectedFrom, expectedTarget, 0.5));
});

test('resolvePose skips cross-fade when previousState equals state or is absent', () => {
    const sameState = { state: 'idle', time: 0.5, progress: 0, seed: 0, blend: 0.2, previousState: 'idle' };
    assert.deepEqual(resolvePose(sameState, {}), poseFor('idle', 0.5, { progress: 0, seed: 0 }));

    const noPrev = { state: 'run', time: 0, progress: 0, seed: 0, blend: 0.3 };
    assert.deepEqual(resolvePose(noPrev, {}), poseFor('run', 0, { progress: 0, seed: 0 }));

    const noController = resolvePose(undefined, {});
    assert.deepEqual(noController, poseFor('idle', 0, { progress: 0, seed: 0 }));
});
