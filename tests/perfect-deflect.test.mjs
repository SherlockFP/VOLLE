import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractGameMethod } from './game-source.mjs';

import {
    DEFLECT_CHAIN_RULES,
    DEFLECT_REWARDS,
    DEFLECT_TIMING_WINDOWS,
    PracticeLabMetrics,
    classifyDeflectTiming,
    createPracticeMetrics,
    getDeflectReward,
    recordPracticeAttempt,
    resolvePerfectDeflect,
    summarizePracticeMetrics,
    updateDeflectChain
} from '../js/perfect-deflect.js';

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');

test('contact timing uses bounded normal, great, and perfect tiers', () => {
    assert.deepEqual({ ...DEFLECT_TIMING_WINDOWS }, { perfect: 60, great: 140, normal: 400 });
    assert.equal(classifyDeflectTiming(0), 'perfect');
    assert.equal(classifyDeflectTiming(-60), 'perfect');
    assert.equal(classifyDeflectTiming(60.01), 'great');
    assert.equal(classifyDeflectTiming(140), 'great');
    assert.equal(classifyDeflectTiming(140.01), 'normal');
    assert.equal(classifyDeflectTiming(400), 'normal');
    assert.equal(classifyDeflectTiming(400.01), null);
});

test('perfect chain expires, restarts, and never exceeds its cap', () => {
    let chain = updateDeflectChain(undefined, 'perfect', 1000);
    assert.equal(chain.count, 1);
    for (let index = 1; index <= DEFLECT_CHAIN_RULES.cap + 2; index++) {
        chain = updateDeflectChain(chain, 'perfect', 1000 + index * 100);
    }
    assert.equal(chain.count, DEFLECT_CHAIN_RULES.cap);

    chain = updateDeflectChain(chain, 'perfect', 1000 + 800 + DEFLECT_CHAIN_RULES.timeoutMs + 1);
    assert.equal(chain.count, 1);
    assert.equal(updateDeflectChain(chain, 'great', 5000).count, 0);
});

test('rewards never increase homing', () => {
    for (const tier of ['normal', 'great', 'perfect']) {
        assert.equal(DEFLECT_REWARDS[tier].homingMultiplier, 1);
        assert.equal(getDeflectReward(tier, 5).homingMultiplier, 1);
    }
    const resolved = resolvePerfectDeflect({
        timingErrorMs: 10,
        at: 100,
        homingStrength: 0.35
    });
    assert.equal(resolved.homingStrength, 0.35);
    assert.equal(resolved.reward.homingMultiplier, 1);
});

test('practice metrics track attempts, hits, perfects, reactions, accuracy, and streaks', () => {
    let metrics = createPracticeMetrics();
    metrics = recordPracticeAttempt(metrics, { hit: true, tier: 'perfect', reactionMs: 120 });
    metrics = recordPracticeAttempt(metrics, { hit: true, tier: 'great', reactionMs: 180 });
    metrics = recordPracticeAttempt(metrics, { hit: false, reactionMs: 240 });
    metrics = recordPracticeAttempt(metrics, { hit: true, tier: 'perfect', reactionMs: 100 });

    assert.deepEqual(summarizePracticeMetrics(metrics), {
        attempts: 4,
        hits: 3,
        perfects: 2,
        reaction: 100,
        accuracy: 75,
        avg: 160,
        best: 100,
        streak: 1,
        bestStreak: 2
    });
});

test('practice summaries are immutable snapshots', () => {
    const lab = new PracticeLabMetrics();
    const first = lab.record({ hit: true, tier: 'perfect', reactionMs: 90 });
    assert.equal(Object.isFrozen(first), true);
    assert.throws(() => {
        first.hits = 99;
    }, TypeError);
    lab.record({ hit: false });
    assert.equal(first.hits, 1);
    assert.equal(lab.getSummary().hits, 1);
});

test('all numeric inputs reject non-finite values', () => {
    assert.throws(() => classifyDeflectTiming(NaN), TypeError);
    assert.throws(() => classifyDeflectTiming('50'), TypeError);
    assert.throws(() => updateDeflectChain(undefined, 'perfect', Infinity), TypeError);
    assert.throws(() => getDeflectReward('perfect', -Infinity), TypeError);
    assert.throws(
        () => recordPracticeAttempt(createPracticeMetrics(), { hit: true, reactionMs: NaN }),
        TypeError
    );
    assert.throws(
        () => resolvePerfectDeflect({ timingErrorMs: 0, at: 0, homingStrength: Infinity }),
        TypeError
    );
    assert.throws(
        () => summarizePracticeMetrics({ ...createPracticeMetrics(), best: Infinity }),
        TypeError
    );
});

test('game grades local and remote deflects by click lead; an unmeasurable lead is an ordinary deflect', () => {
    for (const leadMs of [Infinity, NaN]) {
        const resolved = resolvePerfectDeflect({ leadMs, at: 100, homingStrength: 0 });
        assert.equal(resolved.tier, 'normal');
        assert.equal(resolved.chain.count, 0);
        assert.equal(resolved.reward.scoreMultiplier, DEFLECT_REWARDS.normal.scoreMultiplier);
    }
    assert.equal(resolvePerfectDeflect({ leadMs: 60, at: 100 }).tier, 'perfect');
    assert.equal(resolvePerfectDeflect({ leadMs: 1000, at: 100 }).tier, 'normal', 'no null tier beyond the normal window');

    // The Ball approach-window sentinel no longer feeds gameplay tiers.
    assert.doesNotMatch(gameSource, /\.getPerfectTimingErrorMs\(\)/);
    assert.doesNotMatch(gameSource, /normalizeGameplayDeflectTimingError/);

    const local = extractGameMethod('handlePlayerDeflection');
    const leadRead = local.indexOf('const deflectLeadMs = this._localDeflectLeadMs();');
    assert.ok(leadRead > 0, 'local lead is read once for both branches');
    assert.ok(leadRead < local.indexOf('this.ball.deflectWithAim('), 'lead is read before the ball is mutated');
    assert.match(local, /const resolvedDeflect = resolvePerfectDeflect\(\{\s*leadMs: deflectLeadMs,/);
    assert.match(local, /reactionMs: Number\.isFinite\(deflectLeadMs\) \? Math\.max\(0, deflectLeadMs\) : null/);
    assert.equal(local.match(/getDeflectPresentation\(\{\s*leadMs: deflectLeadMs,/g)?.length, 2, 'prediction + solo presentation');

    const remote = extractGameMethod('remoteAttack');
    const remoteRead = remote.indexOf('const remoteLeadMs = this._remoteDeflectLeadMs(p, attackPos, resolvedBallPos, data.sa);');
    assert.ok(remoteRead > 0);
    assert.ok(remoteRead < remote.indexOf('this.ball.deflectWithAim('), 'host reads the lead before deflectWithAim');
    assert.match(remote, /const remoteResolved = resolvePerfectDeflect\(\{\s*leadMs: remoteLeadMs,/);
});
