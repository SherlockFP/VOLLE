// tests/menu-featured.test.mjs — coverage for js/menu-featured.js, the pure
// rotation/derivation helpers behind the main-menu FEATURED vitrin strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rotationIndex, pickFeaturedCase, pickFeaturedSkins, deriveFeaturedStrip } from '../js/menu-featured.js';
import { CASES } from '../js/cosmetics.js';

// ball.js pulls in THREE, which plain `node --test` can't resolve, so it is
// loaded through the same string-substitution shim as tests/ball-skins-catalog.test.mjs.
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testableBallSource = ballSource
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { BALL_SKINS } = await import(`data:text/javascript;base64,${Buffer.from(testableBallSource).toString('base64')}`);

test('rotationIndex is deterministic for a fixed date', () => {
    const date = new Date('2026-07-30T12:00:00Z');
    assert.equal(rotationIndex(6, date), rotationIndex(6, date));
});

test('rotationIndex wraps modulo length and stays in range', () => {
    for (let length = 1; length <= 9; length++) {
        for (let day = 0; day < 20; day++) {
            const date = new Date(Date.UTC(2026, 0, 1 + day));
            const index = rotationIndex(length, date);
            assert.ok(index >= 0 && index < length, `index ${index} out of range for length ${length}`);
        }
    }
});

test('rotationIndex changes across days for a short catalog', () => {
    const seen = new Set();
    for (let day = 0; day < 5; day++) {
        seen.add(rotationIndex(5, new Date(Date.UTC(2026, 0, 1 + day))));
    }
    assert.ok(seen.size > 1, 'a 5-day span over a 5-item catalog should visit more than one index');
});

test('rotationIndex treats an invalid or empty length as index 0', () => {
    const date = new Date('2026-07-30T00:00:00Z');
    assert.equal(rotationIndex(0, date), 0);
    assert.equal(rotationIndex(-3, date), 0);
    assert.equal(rotationIndex(NaN, date), 0);
});

test('pickFeaturedCase returns a deterministic member of a synthetic catalog', () => {
    const cases = { a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C' } };
    const date = new Date('2026-07-30T00:00:00Z');
    const picked = pickFeaturedCase(cases, date);
    assert.ok(['a', 'b', 'c'].includes(picked.id));
    assert.equal(picked.name, cases[picked.id].name);
    // Same catalog + date -> same pick every time.
    assert.deepEqual(pickFeaturedCase(cases, date), picked);
});

test('pickFeaturedCase returns null for an empty or missing catalog', () => {
    assert.equal(pickFeaturedCase({}), null);
    assert.equal(pickFeaturedCase(undefined), null);
});

test('pickFeaturedSkins skips free/unpriced entries and returns the requested count', () => {
    const skins = {
        free: { name: 'Free', price: 0 },
        cheap: { name: 'Cheap', price: 100 },
        mid: { name: 'Mid', price: 200 },
        top: { name: 'Top', price: 300 }
    };
    const date = new Date('2026-07-30T00:00:00Z');
    const picks = pickFeaturedSkins(skins, 2, date);
    assert.equal(picks.length, 2);
    for (const skin of picks) {
        assert.notEqual(skin.id, 'free');
        assert.ok(skin.price > 0);
    }
});

test('pickFeaturedSkins never returns duplicate ids and clamps count to catalog size', () => {
    const skins = { a: { price: 100 }, b: { price: 100 } };
    const picks = pickFeaturedSkins(skins, 5, new Date('2026-07-30T00:00:00Z'));
    assert.equal(picks.length, 2);
    assert.equal(new Set(picks.map(s => s.id)).size, 2);
});

test('pickFeaturedSkins returns an empty array when nothing is purchasable', () => {
    assert.deepEqual(pickFeaturedSkins({ free: { price: 0 } }), []);
    assert.deepEqual(pickFeaturedSkins(undefined), []);
});

test('deriveFeaturedStrip falls back to deterministic rotation when the live market is empty', () => {
    const date = new Date('2026-07-30T00:00:00Z');
    const result = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, liveMarket: { offers: [] }, date });
    assert.ok(result.case && CASES[result.case.id]);
    assert.equal(result.skins.length, 2);
    for (const skin of result.skins) {
        assert.ok(BALL_SKINS[skin.id]);
        assert.notEqual(skin.live, true);
    }
});

test('deriveFeaturedStrip without a liveMarket argument still works (pure default)', () => {
    const result = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, date: new Date('2026-07-30T00:00:00Z') });
    assert.ok(result.case);
    assert.equal(result.skins.length, 2);
});

test('deriveFeaturedStrip prefers live-market ball offers over the deterministic fallback', () => {
    const skinId = Object.keys(BALL_SKINS).find(id => BALL_SKINS[id].price > 0);
    const liveMarket = { offers: [{ id: 'offer-1', kind: 'ball', itemId: skinId, price: 90, basePrice: 150, discount: 40 }] };
    const result = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, liveMarket, date: new Date('2026-07-30T00:00:00Z') });
    assert.equal(result.skins.length, 1);
    assert.equal(result.skins[0].id, skinId);
    assert.equal(result.skins[0].live, true);
    assert.equal(result.skins[0].price, 90);
});

test('deriveFeaturedStrip ignores cosmetic-kind live offers (skins are ball items only)', () => {
    const liveMarket = { offers: [{ id: 'offer-1', kind: 'cosmetic', itemId: 'whatever', price: 10 }] };
    const date = new Date('2026-07-30T00:00:00Z');
    const result = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, liveMarket, date });
    assert.equal(result.skins.some(s => s.live), false);
    assert.deepEqual(result.skins, pickFeaturedSkins(BALL_SKINS, 2, date));
});

test('deriveFeaturedStrip is pure: repeated calls with equal args produce equal, independently-mutable results', () => {
    const date = new Date('2026-07-30T00:00:00Z');
    const a = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, date });
    const b = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, date });
    assert.deepEqual(a, b);
    a.skins.push({ id: 'mutated' });
    assert.notDeepEqual(a.skins, b.skins);
});

test('deriveFeaturedStrip never mutates the input catalogs', () => {
    const casesCopy = JSON.parse(JSON.stringify(CASES));
    const skinsCopy = JSON.parse(JSON.stringify(BALL_SKINS));
    deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, date: new Date('2026-07-30T00:00:00Z') });
    assert.deepEqual(JSON.parse(JSON.stringify(CASES)), casesCopy);
    assert.deepEqual(JSON.parse(JSON.stringify(BALL_SKINS)), skinsCopy);
});

test('every shipped case has a resolvable webp art path for the featured card', () => {
    for (const id of Object.keys(CASES)) {
        assert.match(CASES[id].art, /^assets\/generated\/cases\/.+\.webp$/, `case "${id}" art path looks wrong`);
    }
});
