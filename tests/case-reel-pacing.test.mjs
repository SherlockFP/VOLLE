// Pure-helper tests for the CS:GO-style case reel pacing pass (Wave 5).
// computeCaseReelTickSchedule / arrangeNearMissFillers are DOM-free and drive
// js/ui.js showCaseReel() — see js/cosmetics.js for the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCaseReelTickSchedule, arrangeNearMissFillers, revealPresentationForRarity, getCaseDropRates, CASES } from '../js/cosmetics.js';

// ===== computeCaseReelTickSchedule =====

test('computeCaseReelTickSchedule: produces an increasing, bounded schedule', () => {
    const spinMs = 6300;
    const crossingCount = 24; // matches targetIndex as used by ui.js
    const schedule = computeCaseReelTickSchedule(spinMs, crossingCount);

    assert.ok(schedule.length > 0, 'should produce at least one tick');
    assert.ok(schedule.length <= crossingCount, 'never more ticks than tile crossings');
    let lastTime = -1;
    let lastIndex = -1;
    for (const entry of schedule) {
        assert.ok(Number.isInteger(entry.timeMs) || Number.isFinite(entry.timeMs), 'timeMs must be a finite number');
        assert.ok(entry.timeMs > lastTime, 'tick times must be strictly increasing');
        assert.ok(entry.index > lastIndex, 'tile indices must be strictly increasing');
        assert.ok(entry.timeMs >= 0 && entry.timeMs <= spinMs, 'tick time must fall within the spin duration');
        lastTime = entry.timeMs;
        lastIndex = entry.index;
    }
});

test('computeCaseReelTickSchedule: bounded by the travel fraction (last 8% is overshoot, not travel)', () => {
    const spinMs = 7000;
    const schedule = computeCaseReelTickSchedule(spinMs, 24, { travelFraction: 0.92 });
    const last = schedule[schedule.length - 1];
    assert.ok(last.timeMs <= spinMs * 0.92 + 1, `last tick (${last.timeMs}ms) should land within the travel window, not the overshoot tail`);
});

test('computeCaseReelTickSchedule: the final crossing (the winner landing) lands at the travel-fraction boundary', () => {
    const spinMs = 7000;
    const crossingCount = 24;
    const schedule = computeCaseReelTickSchedule(spinMs, crossingCount, { travelFraction: 0.92 });
    const last = schedule[schedule.length - 1];
    assert.equal(last.index, crossingCount, 'the last scheduled tick must be the landing crossing itself');
    assert.ok(Math.abs(last.timeMs - spinMs * 0.92) <= 2, `landing tick (${last.timeMs}ms) should sit right at the 92% travel boundary (${spinMs * 0.92}ms)`);
});

test('computeCaseReelTickSchedule: CS:GO deceleration signature — later gaps are wider than early gaps', () => {
    const schedule = computeCaseReelTickSchedule(6600, 30);
    assert.ok(schedule.length >= 4, 'need enough ticks to compare early vs late gaps');
    const firstGap = schedule[1].timeMs - schedule[0].timeMs;
    const lastGap = schedule[schedule.length - 1].timeMs - schedule[schedule.length - 2].timeMs;
    assert.ok(lastGap > firstGap, `deceleration means the tail should crawl (lastGap=${lastGap}ms) slower than the launch (firstGap=${firstGap}ms)`);
});

test('computeCaseReelTickSchedule: respects the minimum gap (no machine-gun bunching)', () => {
    const schedule = computeCaseReelTickSchedule(6300, 40, { minGapMs: 25 });
    for (let i = 1; i < schedule.length; i++) {
        const gap = schedule[i].timeMs - schedule[i - 1].timeMs;
        assert.ok(gap >= 25, `gap between consecutive ticks (${gap}ms) should honor minGapMs`);
    }
});

test('computeCaseReelTickSchedule: invalid input degrades to an empty schedule, never throws', () => {
    for (const [spinMs, tileCount] of [[0, 25], [-100, 25], [NaN, 25], [6300, 0], [6300, -1], [6300, NaN], [undefined, undefined]]) {
        assert.doesNotThrow(() => computeCaseReelTickSchedule(spinMs, tileCount));
        assert.deepEqual(computeCaseReelTickSchedule(spinMs, tileCount), []);
    }
});

test('computeCaseReelTickSchedule: custom bezier/options are honored (different curve -> different schedule)', () => {
    const linear = computeCaseReelTickSchedule(6300, 25, { bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } });
    const csgo = computeCaseReelTickSchedule(6300, 25);
    assert.notDeepEqual(linear.map(e => e.timeMs), csgo.map(e => e.timeMs), 'a linear curve should schedule differently than the CS:GO decel curve');
});

test('computeCaseReelTickSchedule: crossingCount of 1 is valid (a single crossing at the landing)', () => {
    const schedule = computeCaseReelTickSchedule(6300, 1);
    assert.equal(schedule.length, 1);
    assert.equal(schedule[0].index, 1);
    assert.ok(Math.abs(schedule[0].timeMs - 6300 * 0.92) <= 2);
});

// ===== arrangeNearMissFillers =====

function buildFillerArray(targetIndex, targetItem, fillerRarities) {
    const items = fillerRarities.map((rarity, id) => ({ id: `filler-${id}`, name: `Filler ${id}`, rarity }));
    items[targetIndex] = targetItem;
    return items;
}

test('arrangeNearMissFillers: winner index is always preserved', () => {
    const winner = { id: 'winner', name: 'Winner', rarity: 'legendary' };
    const items = buildFillerArray(24, winner, Array.from({ length: 31 }, () => 'common'));
    const arranged = arrangeNearMissFillers(items, 24, { windowSize: 2, minAdjacent: 1 });
    assert.equal(arranged[24], winner, 'the winner tile must be untouched by the shuffle');
});

test('arrangeNearMissFillers: pulls a high-rarity filler into the adjacent window when one exists', () => {
    const winner = { id: 'winner', name: 'Winner', rarity: 'rare' };
    const rarities = Array.from({ length: 31 }, () => 'common');
    rarities[3] = 'legendary'; // far from target(24), should get pulled near it
    const items = buildFillerArray(24, winner, rarities);

    const arranged = arrangeNearMissFillers(items, 24, { windowSize: 2, minAdjacent: 1 });
    const windowIndices = [22, 23, 25, 26];
    const highInWindow = windowIndices.filter(i => ['epic', 'legendary', 'exotic'].includes(arranged[i].rarity));
    assert.ok(highInWindow.length >= 1, 'at least one high-rarity filler should now sit in the near-miss window');
});

test('arrangeNearMissFillers: preserves the exact multiset of items (pure reorder, no odds change)', () => {
    const winner = { id: 'winner', name: 'Winner', rarity: 'epic' };
    const rarities = Array.from({ length: 31 }, (_, i) => (i % 5 === 0 ? 'legendary' : 'common'));
    const items = buildFillerArray(24, winner, rarities);
    const arranged = arrangeNearMissFillers(items, 24, { windowSize: 2, minAdjacent: 2 });

    const originalIds = items.map(i => i.id).sort();
    const arrangedIds = arranged.map(i => i.id).sort();
    assert.deepEqual(arrangedIds, originalIds, 'arrangement must be a pure permutation of the same tiles');
});

test('arrangeNearMissFillers: no donors available -> returns safely without throwing or fabricating rarity', () => {
    const winner = { id: 'winner', name: 'Winner', rarity: 'common' };
    const items = buildFillerArray(24, winner, Array.from({ length: 31 }, () => 'common'));
    assert.doesNotThrow(() => arrangeNearMissFillers(items, 24, { windowSize: 2, minAdjacent: 1 }));
    const arranged = arrangeNearMissFillers(items, 24, { windowSize: 2, minAdjacent: 1 });
    assert.ok(arranged.every(i => i.rarity === 'common' || i === winner), 'no rarity should be invented when no high-rarity filler exists');
});

test('arrangeNearMissFillers: out-of-range or non-integer targetIndex is a safe no-op', () => {
    const items = buildFillerArray(24, { id: 'winner', rarity: 'legendary' }, Array.from({ length: 31 }, () => 'common'));
    for (const bad of [-1, 999, 1.5, NaN, undefined]) {
        assert.doesNotThrow(() => arrangeNearMissFillers(items, bad));
        const result = arrangeNearMissFillers(items, bad);
        assert.equal(result.length, items.length);
    }
});

test('arrangeNearMissFillers: empty/non-array input never throws', () => {
    assert.doesNotThrow(() => arrangeNearMissFillers(null, 24));
    assert.doesNotThrow(() => arrangeNearMissFillers(undefined, 24));
    assert.deepEqual(arrangeNearMissFillers(null, 24), []);
});

// ===== integration-style: real case data through the real ui.js build pattern =====

test('real case drop tables: near-miss arrangement + tick schedule compose without breaking the winner', () => {
    for (const caseId of Object.keys(CASES)) {
        const drops = getCaseDropRates(caseId);
        const targetIndex = 24;
        const winner = { id: 'rolled-winner', name: 'Rolled Winner', rarity: 'legendary' };
        const items = Array.from({ length: 31 }, (_, index) => drops[index % Math.max(1, drops.length)] || winner);
        items[targetIndex] = winner;

        const arranged = arrangeNearMissFillers(items, targetIndex, { windowSize: 2, minAdjacent: 1 });
        assert.equal(arranged[targetIndex], winner, `${caseId}: winner must survive the shuffle`);
        assert.equal(arranged.length, items.length, `${caseId}: tile count must be unchanged`);

        const schedule = computeCaseReelTickSchedule(6300, targetIndex + 1);
        assert.ok(schedule.length > 0, `${caseId}: should schedule at least one tick`);
        assert.ok(schedule[schedule.length - 1].timeMs <= 6300, `${caseId}: last tick must not exceed the spin duration`);
    }
});

// ===== spin duration is now genuinely CS:GO-length (6-7s), not the old 1.2-3.4s =====

test('revealPresentationForRarity: spin duration lands in the 6-7s CS:GO band for every rarity', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'exotic']) {
        const presentation = revealPresentationForRarity(rarity);
        assert.ok(presentation.spinMs >= 6000 && presentation.spinMs <= 7200,
            `${rarity} spinMs (${presentation.spinMs}) should be in the ~6-7s CS:GO band, not the old 1.2-3.4s range`);
    }
});
