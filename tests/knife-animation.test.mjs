import test from 'node:test';
import assert from 'node:assert/strict';
import {
    KNIFE_ACTION_DURATIONS,
    createKnifeAnimationState,
    knifeAnimationActionForAttack,
    resolveKnifePose,
    startKnifeAnimation,
    stepKnifeAnimation
} from '../js/knife-animation.js';

test('knife action state returns to idle after its bounded duration', () => {
    const state = createKnifeAnimationState('classic');
    startKnifeAnimation(state, 'slash');
    assert.equal(state.duration, KNIFE_ACTION_DURATIONS.slash);
    stepKnifeAnimation(state, state.duration + 0.1);
    for (let index = 0; index < 4; index++) stepKnifeAnimation(state, 0.1);
    assert.equal(state.action, 'idle');
});

test('stab moves forward while slash rotates across the view', () => {
    const stab = createKnifeAnimationState('bayonet');
    startKnifeAnimation(stab, 'stab');
    stab.elapsed = stab.duration * 0.42;
    const stabPose = resolveKnifePose(stab);
    assert.ok(stabPose.armPosition[2] < -0.6);

    const slash = createKnifeAnimationState('classic');
    startKnifeAnimation(slash, 'slash');
    slash.elapsed = slash.duration * 0.55;
    const slashPose = resolveKnifePose(slash);
    assert.ok(slashPose.knifeRotation[2] > 0.4);
});

test('combat input maps primary to slash and secondary stab intent to a heavier presentation', () => {
    assert.equal(knifeAnimationActionForAttack('slash'), 'slash');
    assert.equal(knifeAnimationActionForAttack('stab'), 'heavy');
    assert.equal(knifeAnimationActionForAttack('heavy'), 'heavy');
    const heavy = createKnifeAnimationState('bayonet');
    startKnifeAnimation(heavy, 'heavy');
    heavy.elapsed = heavy.duration * 0.42;
    assert.equal(heavy.duration, KNIFE_ACTION_DURATIONS.heavy);
    assert.ok(resolveKnifePose(heavy).armPosition[2] < -0.7);
});

test('pose resolution reuses its vectors and part records in the frame loop', () => {
    for (const model of ['classic', 'bayonet', 'karambit', 'butterfly']) {
        const state = createKnifeAnimationState(model);
        const pose = resolveKnifePose(state);
        const armPosition = pose.armPosition;
        const knifeRotation = pose.knifeRotation;
        const parts = pose.parts;
        const firstPart = parts[0];
        assert.equal(resolveKnifePose(state), pose, `${model} pose object allocated again`);
        assert.equal(pose.armPosition, armPosition, `${model} arm vector allocated again`);
        assert.equal(pose.knifeRotation, knifeRotation, `${model} knife vector allocated again`);
        assert.equal(pose.parts, parts, `${model} parts allocated again`);
        assert.equal(pose.parts[0], firstPart, `${model} part record allocated again`);
    }
});

test('rare butterfly inspect is deterministic and articulates both handles', () => {
    const state = createKnifeAnimationState('butterfly');
    startKnifeAnimation(state, 'inspect', () => 0.01);
    state.elapsed = state.duration * 0.125;
    const pose = resolveKnifePose(state);
    assert.equal(state.variant, 'rare');
    assert.equal(state.duration, KNIFE_ACTION_DURATIONS.rareInspect);
    assert.ok(pose.parts[0].z < -1);
    assert.ok(pose.parts[1].z > 1);
});

test('butterfly rests closed and opens meaningfully during draw and inspect', () => {
    const idleState = createKnifeAnimationState('butterfly');
    startKnifeAnimation(idleState, 'idle');
    const idlePose = resolveKnifePose(idleState);
    // Rest silhouette: blade folded fully back (bladeRoot y-delta of -PI means "closed").
    assert.equal(idlePose.parts[2].y, 0);

    const drawState = createKnifeAnimationState('butterfly');
    startKnifeAnimation(drawState, 'draw');
    drawState.elapsed = drawState.duration * 0.05;
    const drawPose = resolveKnifePose(drawState);
    assert.ok(Math.abs(drawPose.parts[2].y - idlePose.parts[2].y) > 1, 'draw should swing the blade open relative to rest');

    const inspectState = createKnifeAnimationState('butterfly');
    startKnifeAnimation(inspectState, 'inspect', () => 0.9);
    inspectState.elapsed = inspectState.duration * 0.5;
    const inspectPose = resolveKnifePose(inspectState);
    assert.ok(Math.abs(inspectPose.parts[2].y - idlePose.parts[2].y) > 1, 'inspect midpoint should visibly open the blade');

    // draw and inspect both settle back onto the resting (closed) silhouette by the end.
    drawState.elapsed = drawState.duration;
    const drawEndPose = resolveKnifePose(drawState);
    assert.ok(Math.abs(drawEndPose.parts[2].y - idlePose.parts[2].y) < 1e-9);
});

test('karambit rests tucked, snaps to combat pose on strikes, and inspect completes a full rotation', () => {
    const idleState = createKnifeAnimationState('karambit');
    startKnifeAnimation(idleState, 'idle');
    const idlePose = resolveKnifePose(idleState);
    // Rest is tucked (non-zero delta); combat pose is the authored default (zero delta).
    assert.notEqual(idlePose.parts[0].x, 0);

    const slashState = createKnifeAnimationState('karambit');
    startKnifeAnimation(slashState, 'slash');
    slashState.elapsed = slashState.duration * 0.2;
    const slashPose = resolveKnifePose(slashState);
    assert.ok(Math.abs(slashPose.parts[0].x) < Math.abs(idlePose.parts[0].x), 'mid-slash should be closer to the combat pose than rest');

    const inspectState = createKnifeAnimationState('karambit');
    startKnifeAnimation(inspectState, 'inspect', () => 0.9);
    inspectState.elapsed = inspectState.duration;
    const inspectPose = resolveKnifePose(inspectState);
    assert.ok(Math.abs(inspectPose.parts[0].x - idlePose.parts[0].x) >= Math.PI * 2, 'inspect should complete at least one full rotation');
});

test('classic and bayonet poses stay 3-element numeric arrays and unaffected by part deltas', () => {
    for (const model of ['classic', 'bayonet']) {
        const state = createKnifeAnimationState(model);
        startKnifeAnimation(state, 'inspect');
        state.elapsed = state.duration * 0.5;
        const pose = resolveKnifePose(state);
        assert.equal(pose.armPosition.length, 3);
        assert.equal(pose.armRotation.length, 3);
        assert.equal(pose.knifePosition.length, 3);
        assert.equal(pose.knifeRotation.length, 3);
        assert.deepEqual(pose.parts, [0, 0, 0]);
    }
});

test('every pose field stays finite for every action/model/progress combination', () => {
    const models = ['classic', 'bayonet', 'karambit', 'butterfly'];
    const actions = ['idle', 'draw', 'slash', 'stab', 'heavy', 'inspect'];
    const progresses = [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1];
    for (const model of models) {
        for (const action of actions) {
            for (const progress of progresses) {
                const state = createKnifeAnimationState(model);
                startKnifeAnimation(state, action, () => 0.5);
                state.elapsed = state.duration === Infinity ? 0 : state.duration * progress;
                const pose = resolveKnifePose(state, {
                    time: Number.MAX_VALUE,
                    speed: Number.MAX_VALUE,
                    swayX: Number.MAX_VALUE,
                    swayY: -Number.MAX_VALUE
                });
                for (const field of [pose.armPosition, pose.armRotation, pose.knifePosition, pose.knifeRotation]) {
                    assert.ok(field.every(Number.isFinite), `${model}/${action}/${progress} produced a non-finite vector`);
                }
                for (const part of pose.parts) {
                    if (typeof part === 'number') {
                        assert.ok(Number.isFinite(part), `${model}/${action}/${progress} produced a non-finite part`);
                    } else {
                        assert.ok(Number.isFinite(part.x) && Number.isFinite(part.y) && Number.isFinite(part.z), `${model}/${action}/${progress} produced a non-finite part`);
                    }
                }
            }
        }
    }
});

test('mouse sway remains bounded under hostile input', () => {
    const pose = resolveKnifePose(createKnifeAnimationState('classic'), {
        swayX: Number.MAX_VALUE,
        swayY: Number.MIN_SAFE_INTEGER,
        speed: Number.MAX_VALUE,
        time: 10
    });
    assert.ok(pose.armPosition.every(Number.isFinite));
    assert.ok(Math.abs(pose.armPosition[0]) < 1);
    assert.ok(Math.abs(pose.armPosition[1]) < 1);
});
