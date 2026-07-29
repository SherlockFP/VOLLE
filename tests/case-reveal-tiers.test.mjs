import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { revealPresentationForRarity, CASES } from '../js/cosmetics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('revealPresentationForRarity: every rollable rarity produces a presentation', async () => {
    const rarities = new Set();
    for (const caseId of Object.keys(CASES)) {
        for (const drop of CASES[caseId].drops) {
            const resolved = drop.rarity;
            if (resolved) rarities.add(resolved);
        }
    }
    
    for (const rarity of rarities) {
        const presentation = revealPresentationForRarity(rarity);
        assert.ok(presentation, `missing presentation for rarity: ${rarity}`);
        assert.ok(presentation.tier, `presentation.tier missing for ${rarity}`);
        assert.ok(Number.isFinite(presentation.spinMs) && presentation.spinMs > 0, `spinMs invalid for ${rarity}`);
        assert.ok(Number.isFinite(presentation.holdMs) && presentation.holdMs > 0, `holdMs invalid for ${rarity}`);
        assert.ok(Number.isFinite(presentation.durationMs) && presentation.durationMs > 0, `durationMs invalid for ${rarity}`);
        assert.equal(presentation.durationMs, presentation.spinMs + presentation.holdMs, `durationMs mismatch for ${rarity}`);
        assert.ok(Number.isFinite(presentation.slowMo) && presentation.slowMo > 0, `slowMo invalid for ${rarity}`);
        assert.ok(Number.isFinite(presentation.flash) && presentation.flash >= 0, `flash invalid for ${rarity}`);
    }
});

test('revealPresentationForRarity: ordering invariant (legendary > rare > common)', () => {
    const legendary = revealPresentationForRarity('legendary');
    const rare = revealPresentationForRarity('rare');
    const common = revealPresentationForRarity('common');
    
    assert.ok(legendary.spinMs > rare.spinMs, 'legendary spin should be longer than rare');
    assert.ok(rare.spinMs > common.spinMs, 'rare spin should be longer than common');
    assert.ok(legendary.holdMs > rare.holdMs, 'legendary hold should be longer than rare');
    assert.ok(rare.holdMs > common.holdMs, 'rare hold should be longer than common');
    assert.ok(legendary.durationMs > rare.durationMs, 'legendary total should be longer than rare');
    assert.ok(rare.durationMs > common.durationMs, 'rare total should be longer than common');
});

test('revealPresentationForRarity: reduced-motion collapses all tiers to fast path', () => {
    const fastNormal = revealPresentationForRarity('common', { reducedMotion: false });
    const fastReduced = revealPresentationForRarity('common', { reducedMotion: true });
    const legendaryReduced = revealPresentationForRarity('legendary', { reducedMotion: true });
    const rareReduced = revealPresentationForRarity('rare', { reducedMotion: true });
    
    // All reduced-motion results should match the fast baseline
    assert.equal(legendaryReduced.spinMs, fastNormal.spinMs, 'legendary reduced should equal fast spinMs');
    assert.equal(legendaryReduced.holdMs, fastNormal.holdMs, 'legendary reduced should equal fast holdMs');
    assert.equal(legendaryReduced.slowMo, fastNormal.slowMo, 'legendary reduced should equal fast slowMo');
    assert.equal(legendaryReduced.flash, fastNormal.flash, 'legendary reduced should equal fast flash');
    
    assert.equal(rareReduced.spinMs, fastNormal.spinMs, 'rare reduced should equal fast spinMs');
    assert.equal(rareReduced.holdMs, fastNormal.holdMs, 'rare reduced should equal fast holdMs');
    assert.equal(rareReduced.slowMo, fastNormal.slowMo, 'rare reduced should equal fast slowMo');
    assert.equal(rareReduced.flash, fastNormal.flash, 'rare reduced should equal fast flash');
    
    // But audio payoff survives reduced motion (it's not motion)
    const legendaryNormal = revealPresentationForRarity('legendary', { reducedMotion: false });
    assert.equal(legendaryReduced.sfx, legendaryNormal.sfx, 'audio sfx should persist under reduced motion');
    assert.equal(legendaryReduced.tier, 'long', 'tier label should preserve original tier even when reduced');
});

test('revealPresentationForRarity: garbage input falls back safely', () => {
    const cases = [
        undefined, null, '', '  ', 'sparkly', 'UNKNOWN', 42, {}, [], true, false
    ];
    
    for (const input of cases) {
        assert.doesNotThrow(() => revealPresentationForRarity(input), `threw on input: ${JSON.stringify(input)}`);
        const presentation = revealPresentationForRarity(input);
        assert.ok(presentation.tier === 'fast', `garbage input ${JSON.stringify(input)} should fall back to fast tier`);
    }
});

test('revealPresentationForRarity: case-insensitive and whitespace-tolerant', () => {
    const tests = [
        ['LEGENDARY', 'legendary'],
        ['Rare', 'rare'],
        ['  epic  ', 'epic'],
        ['COMMON', 'common']
    ];
    
    for (const [input, expected] of tests) {
        const presentation = revealPresentationForRarity(input);
        const baselineRarity = expected.toLowerCase();
        const baseline = revealPresentationForRarity(baselineRarity);
        assert.deepEqual(presentation, baseline, `case/whitespace variance for ${JSON.stringify(input)}`);
    }
});

test('revealPresentationForRarity: results are independent (not shared singletons)', () => {
    const p1 = revealPresentationForRarity('legendary');
    const p2 = revealPresentationForRarity('legendary');
    
    assert.deepEqual(p1, p2, 'two calls should return equal objects');
    assert.notEqual(p1, p2, 'two calls should return independent objects');
    
    p1.spinMs = 9999;
    assert.notEqual(p2.spinMs, 9999, 'mutating p1 should not affect p2');
});

test('revealPresentationForRarity: ui.js actually calls the function (wiring verification)', () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const uiSource = readFileSync(uiPath, 'utf8');
    assert.match(uiSource, /revealPresentationForRarity/, 'ui.js must import revealPresentationForRarity');
    assert.match(uiSource, /revealPresentationForRarity\s*\(\s*result\.reward\.rarity/, 'ui.js must call the function with rarity');
    assert.match(uiSource, /reducedMotion\s*:\s*this\._isReducedMotion\(\)/, 'ui.js must pass reduced-motion option');
});

test('revealPresentationForRarity: exotic tier maps to long like legendary', () => {
    const legendary = revealPresentationForRarity('legendary');
    const exotic = revealPresentationForRarity('exotic');
    assert.equal(exotic.tier, legendary.tier, 'exotic and legendary should have same tier');
    assert.equal(exotic.spinMs, legendary.spinMs, 'exotic and legendary should have same spinMs');
});

test('revealPresentationForRarity: uncommon tier maps to fast like common', () => {
    const common = revealPresentationForRarity('common');
    const uncommon = revealPresentationForRarity('uncommon');
    assert.equal(uncommon.tier, common.tier, 'uncommon and common should have same tier');
    assert.equal(uncommon.spinMs, common.spinMs, 'uncommon and common should have same spinMs');
});
