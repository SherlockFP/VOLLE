import test from 'node:test';
import assert from 'node:assert/strict';
import {
    KNIFE_ACTION_DURATIONS,
    createKnifeAnimationState,
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

test('rare butterfly inspect is deterministic and articulates both handles', () => {
    const state = createKnifeAnimationState('butterfly');
    startKnifeAnimation(state, 'inspect', () => 0.01);
    state.elapsed = state.duration * 0.125;
    const pose = resolveKnifePose(state);
    assert.equal(state.variant, 'rare');
    assert.equal(state.duration, KNIFE_ACTION_DURATIONS.rareInspect);
    assert.ok(pose.parts[0] < -1);
    assert.ok(pose.parts[1] > 1);
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
