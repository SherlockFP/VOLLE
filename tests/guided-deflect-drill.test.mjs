import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GUIDED_DRILL_FIRST_RUN_TOTAL_MS,
    GUIDED_DRILL_TOTAL_MS,
    GuidedDeflectDrill
} from '../js/guided-deflect-drill.js';

function advanceRuntime(drill, durationMs) {
    let remainingMs = durationMs;
    let guard = 0;
    while (remainingMs > 0 && drill.active) {
        assert.ok(++guard < 1000, 'runtime advance must converge');
        const result = drill.advance(remainingMs);
        remainingMs = result.remainingMs;
        if (result.snapshot.needsServe && remainingMs > 0) {
            assert.equal(drill.openAttempt({ timeoutMs: 2200 }).accepted, true);
            continue;
        }
        if (result.consumedMs <= 0) break;
    }
    return drill.snapshot();
}

test('guided drill follows the deterministic 73 second phase order', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    assert.equal(drill.advance(2999).snapshot.phase, 'countdown');
    assert.equal(drill.advance(1).snapshot.stage.id, 'control');
    assert.equal(advanceRuntime(drill, 20000).phase, 'transition');
    assert.equal(drill.advance(2000).snapshot.stage.id, 'direction');
    assert.equal(advanceRuntime(drill, 22000).phase, 'transition');
    assert.equal(drill.advance(2000).snapshot.stage.id, 'timing');
    const final = advanceRuntime(drill, 24000);
    assert.equal(final.complete, true);
    assert.equal(final.runElapsedMs, GUIDED_DRILL_TOTAL_MS);
});

test('first-run profile follows the deterministic 40 second phase order', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm({ profile: 'first_run' });
    drill.start();
    assert.equal(drill.snapshot().profileId, 'first_run');
    assert.equal(drill.snapshot().totalMs, GUIDED_DRILL_FIRST_RUN_TOTAL_MS);
    assert.equal(drill.advance(1999).snapshot.phase, 'countdown');
    assert.equal(drill.advance(1).snapshot.stage.id, 'control');
    assert.equal(advanceRuntime(drill, 11000).phase, 'transition');
    assert.equal(drill.advance(1000).snapshot.stage.id, 'direction');
    assert.equal(advanceRuntime(drill, 12000).phase, 'transition');
    assert.equal(drill.advance(1000).snapshot.stage.id, 'timing');
    const final = advanceRuntime(drill, 13000);
    assert.equal(final.complete, true);
    assert.equal(final.runElapsedMs, GUIDED_DRILL_FIRST_RUN_TOTAL_MS);
});

test('first-run profile uses reachable 3/2/2 pass thresholds and unknown profiles fail safe', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm({ profile: 'unknown-profile' });
    assert.equal(drill.snapshot().profileId, 'full');

    drill.arm({ profile: 'first_run' });
    Object.assign(drill.stages[0], { attempts: 5, hits: 3 });
    assert.equal(drill._stageResult(drill.stages[0]).passed, true);
    Object.assign(drill.stages[1], { attempts: 4, hits: 2, directed: 2 });
    assert.equal(drill._stageResult(drill.stages[1]).passed, true);
    Object.assign(drill.stages[2], { attempts: 4, perfect: 2, timingPoints: 2 });
    assert.equal(drill._stageResult(drill.stages[2]).passed, true);
    assert.equal(drill.result().allPassed, true, 'result must preserve each stage threshold after the final stage');
});

test('speed increases monotonically within a stage', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    drill.advance(3000);
    const first = drill.snapshot().speedMultiplier;
    advanceRuntime(drill, 10000);
    const middle = drill.snapshot().speedMultiplier;
    advanceRuntime(drill, 9999);
    const last = drill.snapshot().speedMultiplier;
    assert.ok(first <= middle && middle <= last);
});

test('attempt ids are single-use and timeout records one miss', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    drill.advance(3000);
    const attempt = drill.openAttempt({ timeoutMs: 2200 });
    drill.advance(2200);
    assert.equal(drill.snapshot().stats.misses, 1);
    assert.equal(drill.resolveAttempt({ attemptId: attempt.attemptId, hit: true }).accepted, false);
});

test('direction threshold accepts 15 degrees and rejects 15.01', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    advanceRuntime(drill, 3000 + 20000 + 2000);
    const first = drill.openAttempt();
    drill.resolveAttempt({ attemptId: first.attemptId, hit: true, directionErrorDeg: 15 });
    drill.advance(600);
    const second = drill.openAttempt();
    drill.resolveAttempt({ attemptId: second.attemptId, hit: true, directionErrorDeg: 15.01 });
    assert.equal(drill.snapshot().stats.directed, 1);
});

test('non-finite inputs fail closed', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    drill.advance(3000);
    assert.equal(drill.openAttempt({ timeoutMs: Number.NaN }).accepted, false);
    assert.equal(drill.advance(Number.NaN).accepted, false);
});

test('complete drill rejects attempts and reset clears metrics', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    advanceRuntime(drill, GUIDED_DRILL_TOTAL_MS);
    assert.equal(drill.openAttempt().accepted, false);
    drill.reset();
    assert.equal(drill.snapshot().phase, 'idle');
    assert.equal(drill.snapshot().stages.every(stage => stage.attempts === 0), true);
});

test('large delta stops at the first serve boundary', () => {
    const drill = new GuidedDeflectDrill();
    drill.arm();
    drill.start();
    const result = drill.advance(GUIDED_DRILL_TOTAL_MS);
    assert.equal(result.snapshot.stage.id, 'control');
    assert.equal(result.snapshot.needsServe, true);
    assert.equal(result.snapshot.runElapsedMs, 3000);
    assert.equal(result.remainingMs, GUIDED_DRILL_TOTAL_MS - 3000);
});
