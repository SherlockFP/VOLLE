import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { revealPresentationForRarity, formatDuplicateConversion, CASES } from '../js/cosmetics.js';

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

// ===== V3 3.4: rare/epic/legendary now diverge (used to be identical "medium"/"long") =====

test('revealPresentationForRarity: rare/epic/legendary each get a distinct FX tier', () => {
    const common = revealPresentationForRarity('common');
    const rare = revealPresentationForRarity('rare');
    const epic = revealPresentationForRarity('epic');
    const legendary = revealPresentationForRarity('legendary');

    // common: no glow, no pulse, no confetti, no pre-stop hitch, no flash, no sfx
    assert.equal(common.glow, null);
    assert.equal(common.pulse, false);
    assert.equal(common.confetti, false);
    assert.equal(common.preStop, false);
    assert.equal(common.flash, 0);
    assert.equal(common.sfx, null);

    // rare: blue glow flash only, nothing else new
    assert.equal(rare.glow, 'blue');
    assert.ok(rare.flash > 0, 'rare should have a nonzero glow flash');
    assert.equal(rare.pulse, false, 'rare should not get the epic screen pulse');
    assert.equal(rare.confetti, false);
    assert.equal(rare.preStop, false);
    assert.equal(rare.sfx, null, 'rare has no dedicated cue in this pass');

    // epic: purple glow + screen pulse + its own cue, no confetti/pre-stop
    assert.equal(epic.glow, 'purple');
    assert.ok(epic.flash > 0);
    assert.equal(epic.pulse, true);
    assert.equal(epic.confetti, false);
    assert.equal(epic.preStop, false);
    assert.ok(epic.sfx, 'epic should have a distinct sfx cue');
    assert.notEqual(epic.sfx, legendary.sfx, 'epic sfx must differ from legendary fanfare');

    // legendary: gold glow + pulse + confetti + pre-stop hitch + fanfare
    assert.equal(legendary.glow, 'gold');
    assert.equal(legendary.pulse, true);
    assert.equal(legendary.confetti, true);
    assert.equal(legendary.preStop, true);
    assert.equal(legendary.sfx, 'tf2_domination');
    assert.ok(legendary.flash > epic.flash, 'legendary flash should read stronger than epic');
    assert.ok(epic.flash > rare.flash, 'epic flash should read stronger than rare');

    // exotic mirrors legendary's flourishes, same as it already mirrors legendary's timing
    const exotic = revealPresentationForRarity('exotic');
    assert.equal(exotic.glow, legendary.glow);
    assert.equal(exotic.pulse, legendary.pulse);
    assert.equal(exotic.confetti, legendary.confetti);
    assert.equal(exotic.preStop, legendary.preStop);
    assert.equal(exotic.sfx, legendary.sfx);
});

test('revealPresentationForRarity: reduced motion also collapses the new rarity flourishes', () => {
    for (const rarity of ['rare', 'epic', 'legendary', 'exotic']) {
        const reduced = revealPresentationForRarity(rarity, { reducedMotion: true });
        assert.equal(reduced.glow, null, `${rarity} glow should be off under reduced motion`);
        assert.equal(reduced.pulse, false, `${rarity} pulse should be off under reduced motion`);
        assert.equal(reduced.confetti, false, `${rarity} confetti should be off under reduced motion`);
        assert.equal(reduced.preStop, false, `${rarity} pre-stop hitch should be off under reduced motion`);
        assert.equal(reduced.flash, 0, `${rarity} flash should collapse to 0 under reduced motion`);
        // Audio payoff still survives reduced motion — same rule as before.
        const normal = revealPresentationForRarity(rarity, { reducedMotion: false });
        assert.equal(reduced.sfx, normal.sfx, `${rarity} sfx should be unaffected by reduced motion`);
    }
});

test('revealPresentationForRarity: ui.js wires the new rarity dataset + additive hooks', () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const uiSource = readFileSync(uiPath, 'utf8');
    assert.match(uiSource, /overlay\.dataset\.revealRarity\s*=\s*presentation\.rarity/, 'ui.js must expose the resolved rarity on the overlay for CSS hooks');
    assert.match(uiSource, /formatDuplicateConversion/, 'ui.js must use the pure duplicate-conversion formatter');
    assert.match(uiSource, /presentation\.confetti/, 'ui.js must gate confetti behind presentation.confetti');
    assert.match(uiSource, /presentation\.preStop/, 'ui.js must gate the pre-stop hitch behind presentation.preStop');
});

test('case reveal only exposes the external reward callback from its settled gate', () => {
    const uiPath = join(__dirname, '..', 'js', 'ui.js');
    const mainPath = join(__dirname, '..', 'js', 'main.js');
    const uiSource = readFileSync(uiPath, 'utf8');
    const mainSource = readFileSync(mainPath, 'utf8');
    const settledIndex = uiSource.indexOf('if (settled) return;');
    const callbackIndex = uiSource.indexOf('onSettled?.(result);');
    assert.ok(settledIndex >= 0 && callbackIndex > settledIndex, 'reveal callback must sit behind the once-only settled gate');
    const openBranch = mainSource.slice(mainSource.indexOf("const caseOpen = e.target.closest('#case-inspector-open')"), mainSource.indexOf("const knifeBtn = e.target.closest('.knife-equip')"));
    assert.match(openBranch, /showCaseReel\(box, result, \{ onSettled:/, 'main must defer the toast until the reel settles');
    assert.doesNotMatch(openBranch, /this\.ui\.showMessage\?\.\(result/, 'main must not leak result toast before the reel locks');
});

// ===== duplicate → coin conversion text (pure, no DOM) =====

test('formatDuplicateConversion: renders the coin amount clearly', () => {
    assert.equal(formatDuplicateConversion(35), 'Duplicate \u2192 +35 coins');
    assert.equal(formatDuplicateConversion(182), 'Duplicate \u2192 +182 coins');
});

test('formatDuplicateConversion: rounds fractional refunds', () => {
    assert.equal(formatDuplicateConversion(35.6), 'Duplicate \u2192 +36 coins');
    assert.equal(formatDuplicateConversion(35.4), 'Duplicate \u2192 +35 coins');
});

test('formatDuplicateConversion: clamps bad input to 0 instead of throwing/NaN', () => {
    for (const bad of [undefined, null, NaN, -50, 'x', {}, []]) {
        assert.doesNotThrow(() => formatDuplicateConversion(bad));
        assert.equal(formatDuplicateConversion(bad), 'Duplicate \u2192 +0 coins', `bad input ${JSON.stringify(bad)} should clamp to 0`);
    }
});

test('formatDuplicateConversion: matches the real refund shape from store.js (35 or 35% of case price)', () => {
    // store.js _openCase: refund = duplicate ? (free ? 35 : Math.floor(box.price * 0.35)) : 0
    for (const box of Object.values(CASES)) {
        const refund = Math.floor(box.price * 0.35);
        assert.match(formatDuplicateConversion(refund), /^Duplicate → \+\d+ coins$/);
    }
});
