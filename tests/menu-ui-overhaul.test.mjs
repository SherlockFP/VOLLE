// tests/menu-ui-overhaul.test.mjs — structural pins for the menu/HUD overhaul wave:
// per-model knife silhouettes, the CS-style inventory tiles, the model-skin ball
// preview, the CSS-only HUD liveliness, and the new patch-notes entry. These are
// source-shape assertions (the same style as tests/shop-showcase-ui.test.mjs) — they
// exist so a later pass cannot silently drop the hooks the CSS depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const ui = read('../js/ui.js');
const main = read('../js/main.js');
const polish = read('../css/polish.css');

// --- patch notes -----------------------------------------------------------
test('patch notes lead with the 2026-07-31 entry and only one current card', () => {
    const timeline = html.slice(html.indexOf('<div class="patch-timeline">'), html.indexOf('patch-footer'));
    assert.equal((timeline.match(/patch-card current/g) || []).length, 1);
    const current = timeline.slice(0, timeline.indexOf('</article>'));
    assert.match(current, /patch-card current/);
    assert.match(current, /2026-07-31/);
    assert.equal((timeline.match(/CURRENT PATCH/g) || []).length, 1, 'the demoted entry must not still say CURRENT PATCH');
});

test('the current patch entry names this wave in player-facing wording', () => {
    const currentStart = html.indexOf('patch-card current');
    const current = html.slice(currentStart, html.indexOf('</article>', currentStart));
    for (const phrase of [
        'ball freezing',           // solo/host sim-loop stall
        'QUICK PLAY',              // multiplayer hub reroute
        'Aquarium', 'Grand Museum', 'Neon Casino', 'Metro Interchange',
        'Neon Clubhouse',
        'Iron Shuriken', 'Sandlot Slugger', 'Blockball', 'Dark Eater',
        'Silver Stiletto', 'Scrap Cleaver',
        'welcome guide',
        'battlepass'
    ]) {
        assert.ok(current.includes(phrase), `patch notes should mention "${phrase}"`);
    }
});

// --- knife presentation ----------------------------------------------------
test('every KNIFE_MODELS silhouette has its own blade geometry in CSS', () => {
    for (const model of ['classic', 'bayonet', 'butterfly', 'karambit', 'tanto', 'cleaver', 'dagger']) {
        assert.match(polish, new RegExp(`\\.knife-preview\\.model-${model}\\s*\\{`),
            `knife model "${model}" must have its own silhouette rule`);
    }
    // The three newest models must not fall back to the shared default blade.
    for (const model of ['tanto', 'cleaver', 'dagger']) {
        const rule = polish.slice(polish.indexOf(`.knife-preview.model-${model} {`));
        assert.match(rule.slice(0, rule.indexOf('}')), /--blade-clip:/,
            `knife model "${model}" must define its own --blade-clip`);
    }
    assert.match(polish, /\.knife-preview::before \{[\s\S]*?clip-path: var\(--blade-clip,/,
        'the base blade rule must read the per-model custom property');
});

// --- CS-style inventory ----------------------------------------------------
test('inventory cards carry type/rarity/model on the element for the tile CSS', () => {
    const branch = ui.slice(ui.indexOf('renderLockerInventory(store)'));
    assert.match(branch, /card\.dataset\.invType = group\.type;/);
    assert.match(branch, /card\.dataset\.invRarity =/);
    assert.match(branch, /card\.dataset\.invModel = item\.model;/);
    assert.match(branch, /inventory-card inventory-tile/,
        'Locker inventory cards must keep the shared inventory tile contract');
});

test('inventory tiles get a rarity base edge, hover enlarge and a dense grid', () => {
    assert.match(polish, /\.locker-inventory-grid \.shop-card::before \{[\s\S]*?--shop-rarity-stripe/);
    assert.match(polish, /\.locker-inventory-grid \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(polish, /#shop-screen \.shop-card\.rarity-common \{ --shop-rarity-stripe:/,
        'common items still need a stripe value or the base edge disappears');
});

// --- ball model skins ------------------------------------------------------
test('ball cards expose the BALL_SKINS shape and flag model skins', () => {
    const branch = ui.slice(ui.indexOf("tab === 'balls'"), ui.indexOf("tab === 'skills'"));
    assert.match(branch, /card\.dataset\.ballShape = shape;/);
    assert.match(branch, /preview\.dataset\.shape = shape;/);
    assert.match(branch, /ball-shape-tag/);
    assert.match(branch, /Inspect in 3D/);
});

test('ball inspect renders real geometry for shape skins and clones the shared cache', () => {
    assert.match(main, /import \{ BALL_SKINS, ballShapeParts \} from '\.\/ball\.js';/);
    assert.match(main, /_renderCosmeticPreview\(container, style, build = null, autoDispose = true\)/);
    assert.match(main, /const model = build \? build\(\) : createKnifeModel\(style\);/);
    assert.match(main, /_buildBallPreviewModel\(skin\)/);
    assert.match(main, /part\.geo\.clone\(\)/,
        'shape geometry is shared across every ball in the session — the preview must clone, never dispose the cache');
    assert.match(main, /if \(skin\?\.shape && stage\)/);
    assert.match(main, /_disposeCosmeticPreview\(stage\)/);
});

test('selected ball drives the persistent live showcase with real model geometry', () => {
    assert.match(ui, /type: 'ball', id: item\.id, ball: item, source: 'shop'/);
    assert.match(main, /detail\?\.type === 'ball' && BALL_SKINS\[detail\.id\]/);
    assert.match(main, /_renderCosmeticPreview\(visual, skin, \(\) => this\._buildBallPreviewModel\(skin\), false\)/);
    assert.match(main, /skin\.shape\s*\? ballShapeParts\(skin\.shape, \.45, THREE\)/);
    assert.match(main, /skin\.shape === 'shuriken'\)[\s\S]{0,80}content\.rotation\.x = Math\.PI \/ 2/,
        'gameplay shuriken lies edge-on to the showcase camera unless its inner model is faced forward');
    assert.match(main, /group\.userData\.previewSpinAxis = 'z'/,
        'flat shuriken previews must spin in their face plane instead of turning edge-on every half rotation');
    assert.match(main, /model\.rotation\[previewSpinAxis\] \+= \.012/,
        'preview renderer must respect the model-specific turntable axis');
    assert.match(main, /if \(!ballInspect\.closest\('#shop-grid'\)\)/,
        'shop selection uses its status region instead of a toast over the catalog heading');
    assert.match(ui, /visual\.setAttribute\('role', 'img'\)/);
    assert.match(ui, /visual\.setAttribute\('aria-label', `\$\{item\.name\} 3D preview`\)/);
    assert.match(ui, /visual\.setAttribute\('aria-hidden', 'false'\)/);
    assert.doesNotMatch(ui, /innerHTML\s*\+?=.*\$\{item\.name\} 3D preview/,
        'accessible preview name must stay metadata, never visible heading text');
    assert.match(polish, /\.shop-selected-product-visual\.actual-preview canvas \{[\s\S]*?width: 100% !important/);
});

test('each shape gets a 2D differentiator so the grid reads without WebGL', () => {
    for (const shape of ['shuriken', 'cube', 'baseball', 'orb']) {
        assert.match(polish, new RegExp(`\\.ball-preview\\[data-shape="${shape}"\\]`),
            `shape "${shape}" needs a visible differentiator on the flat card`);
    }
    assert.match(polish, /\.ball-inspect-stage\.actual-preview canvas \{[\s\S]*?width: 100% !important/);
});

// --- HUD -------------------------------------------------------------------
test('HUD scores only touch the DOM when they change, and the pop is CSS', () => {
    assert.match(ui, /this\._hudScores \?\?= \{ red: null, blue: null \};/);
    assert.match(ui, /if \(this\._hudScores\[side\] === value\) continue;/);
    assert.match(ui, /node\.classList\.add\('score-pop'\)/);
    assert.match(polish, /@keyframes hud-score-pop/);
    assert.doesNotMatch(ui, /requestAnimationFrame[\s\S]{0,80}score-pop/,
        'the HUD accent must stay CSS-only — no per-frame JS');
});

test('low-health vignette toggles a class only when the threshold is crossed', () => {
    assert.match(ui, /hpFill\.className = 'vital-fill hp' \+ \(hpPct < 30 \? ' low'/);
    // updateVitals runs every frame, so the class write must be guarded by a cached flag.
    assert.match(ui, /const critical = hpPct < 30;/);
    assert.match(ui, /if \(this\._hudCritical !== critical\) \{/);
    assert.match(ui, /this\.screens\?\.hud\?\.classList\.toggle\('hud-critical', critical\);/);
    assert.match(polish, /#hud\.hud-critical::after/);
    assert.doesNotMatch(polish, /#hud:has\(/, ':has() does not match #hud reliably in Chromium here — the class is the contract');
    assert.match(polish, /transparent 55%/, 'the vignette must stay clear through the aiming area');
});

test('every new HUD/inventory animation opts out of reduced motion', () => {
    const optOut = polish.slice(polish.indexOf('MENU OVERHAUL WAVE'));
    assert.match(optOut, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?hud-score-pop|score-pop/);
    assert.match(optOut, /\.reduce-motion #hud \.hud-score-panel::after/);
    assert.match(optOut, /\.reduce-motion #shop-screen \.inventory-tile:hover/);
});

// --- settings --------------------------------------------------------------
test('the settings toggle follows the theme instead of a fixed cyan', () => {
    assert.match(polish, /\.toggle-switch input:checked \+ \.toggle-slider \{[\s\S]*?var\(--ui-primary\)/);
    assert.match(polish, /#unified-settings \.settings-row:hover/);
    assert.match(polish, /#unified-settings \.settings-tab\.selected::after \{ transform: scaleX\(1\); \}/);
});
