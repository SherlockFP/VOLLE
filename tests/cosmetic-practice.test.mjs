import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AVATAR_SKINS } from '../js/avatar.js';
import {
    COSMETIC_PRACTICE_CATALOG_ORDER,
    COSMETIC_PRACTICE_MAP_ID,
    CosmeticPracticeSession,
    getCosmeticPracticeCatalog,
    getCosmeticPracticeEligibility,
    getCosmeticPracticeSkin,
    isCosmeticPracticeSkinId
} from '../js/cosmetic-practice.js';

test('practice catalog follows AVATAR_SKINS order and exposes safe lookups', () => {
    assert.deepEqual(COSMETIC_PRACTICE_CATALOG_ORDER, Object.keys(AVATAR_SKINS));
    assert.equal(Object.isFrozen(COSMETIC_PRACTICE_CATALOG_ORDER), true);
    assert.equal(Object.isFrozen(getCosmeticPracticeCatalog()), true);
    assert.equal(getCosmeticPracticeSkin('frost'), AVATAR_SKINS.frost);
    assert.equal(getCosmeticPracticeSkin('__proto__'), null);
    assert.equal(isCosmeticPracticeSkinId('neon'), true);
    assert.equal(isCosmeticPracticeSkinId('missing'), false);
});

test('open, select, and catalog cycling return immutable preview snapshots', () => {
    const session = new CosmeticPracticeSession({
        currency: 400,
        ownedSkinIds: ['default'],
        equippedSkinId: 'default'
    });
    const opened = session.open('frost', 'shop');

    assert.equal(Object.isFrozen(opened), true);
    assert.equal(opened.active, true);
    assert.equal(opened.mapId, COSMETIC_PRACTICE_MAP_ID);
    assert.equal(opened.selectedSkinId, 'frost');
    assert.equal(opened.eligibility.canPurchase, true);
    assert.equal(opened.eligibility.canEquip, false);
    assert.equal(session.next().selectedSkinId, 'astro');
    assert.equal(session.previous().selectedSkinId, 'frost');

    session.selectSkin(COSMETIC_PRACTICE_CATALOG_ORDER.at(-1));
    assert.equal(session.next().selectedSkinId, COSMETIC_PRACTICE_CATALOG_ORDER[0]);
    assert.equal(session.previous().selectedSkinId, COSMETIC_PRACTICE_CATALOG_ORDER.at(-1));
});

test('commerce sync updates purchase/equip eligibility without mutating inventory inputs', () => {
    const owned = ['default'];
    const session = new CosmeticPracticeSession({ currency: 299, ownedSkinIds: owned });
    session.open('frost');
    assert.equal(session.snapshot().eligibility.canPurchase, false);

    let snapshot = session.syncCommerce({ currency: 300 });
    assert.equal(snapshot.eligibility.canPurchase, true);
    snapshot = session.syncCommerce({ ownedSkinIds: [...owned, 'frost'] });
    assert.deepEqual(owned, ['default']);
    assert.equal(snapshot.eligibility.owned, true);
    assert.equal(snapshot.eligibility.canPurchase, false);
    assert.equal(snapshot.eligibility.canEquip, true);

    snapshot = session.syncCommerce({ equippedSkinId: 'frost' });
    assert.equal(snapshot.eligibility.equipped, true);
    assert.equal(snapshot.eligibility.canEquip, false);
    assert.equal(snapshot.restoreSkinId, 'frost');
});

test('close restores the equipped skin and preserves the requested return screen', () => {
    const session = new CosmeticPracticeSession({
        ownedSkinIds: ['default', 'neon'],
        equippedSkinId: 'default'
    });
    session.open('neon', 'mainMenu');
    const closed = session.close();

    assert.equal(closed.active, false);
    assert.equal(closed.selectedSkinId, 'default');
    assert.equal(closed.restoreSkinId, 'default');
    assert.equal(closed.returnScreen, 'mainMenu');
});

test('skin ids and return screen ids reject unsafe values', () => {
    const session = new CosmeticPracticeSession();
    assert.throws(() => session.open('__proto__'), RangeError);
    assert.throws(() => session.selectSkin('missing'), RangeError);
    assert.throws(() => session.open('default', '<script>'), TypeError);
    assert.throws(() => session.syncCommerce({ equippedSkinId: 'constructor' }), RangeError);
    assert.throws(() => getCosmeticPracticeEligibility('missing'), RangeError);
});

test('cosmetic studio is a bounded practice-only, no-combat showroom', async () => {
    const arena = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
    const studioStart = arena.indexOf('cosmetic_studio: {');
    const studioEnd = arena.indexOf('\n    temple_sym:', studioStart);
    const studio = arena.slice(studioStart, studioEnd);

    assert.ok(studioStart >= 0 && studioEnd > studioStart);
    assert.match(studio, /practiceOnly: true, hiddenFromRotation: true/);
    assert.match(studio, /noCombat: true, noBots: true/);
    assert.match(studio, /combatEnabled: false/);
    assert.match(studio, /botsEnabled: false/);
    assert.match(studio, /ballEnabled: false/);
    assert.match(studio, /displayStage:/);
    assert.match(studio, /comparisonPads:/);
    assert.match(arena, /buildCosmeticStudio\(\)/);
    assert.match(arena, /cosmetic-preview-anchor/);
    assert.match(arena, /cosmetic-comparison-anchor-/);
});
