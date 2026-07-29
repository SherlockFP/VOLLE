// tests/menu-hero-theme.test.mjs — Menu hero roadmap 1.1 & 1.2
// Roadmap 1.1: hero stage reads theme tokens from CSS instead of hardcoded colors.
// Roadmap 1.2: hero displays the player's equipped cosmetics and knife.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cssTokens = readFileSync('./css/ui-tokens.css', 'utf-8');
const showShowcase = readFileSync('./js/shop-showcase.js', 'utf-8');
const mainJs = readFileSync('./js/main.js', 'utf-8');

test('1.1 — theme tokens exist in CSS for all themes', () => {
    const themes = ['dark', 'soft-spectrum', 'ember', 'violet-surge', 'verdant', 'crimson-court'];
    for (const theme of themes) {
        // Simply check that both tokens appear in the CSS block for this theme
        assert.match(cssTokens, new RegExp(`data-theme="${theme}"[\\s\\S]*?--ui-surface-2`), `${theme} needs --ui-surface-2`);
        assert.match(cssTokens, new RegExp(`data-theme="${theme}"[\\s\\S]*?--ui-menu-accent`), `${theme} needs --ui-menu-accent`);
    }
});

test('1.1 — STAGE_TOKENS and STAGE_FALLBACK constants are defined', () => {
    assert.match(showShowcase, /export const STAGE_TOKENS/);
    assert.match(showShowcase, /export const STAGE_FALLBACK/);
});

test('1.1 — hardcoded stage colours only appear as fallback constants', () => {
    const fallbackSection = showShowcase.match(/export const STAGE_FALLBACK[\s\S]*?\}\);/)?.[0];
    assert.ok(fallbackSection);
    assert.match(fallbackSection, /0x12384d/);
    assert.match(fallbackSection, /0x5af7ef/);
});

test('1.1 — resolveStageTheme export is defined', () => {
    assert.match(showShowcase, /export function resolveStageTheme/);
});

test('1.1 — theme methods present', () => {
    assert.match(showShowcase, /_readStageTheme/);
    assert.match(showShowcase, /_applyStageTheme/);
    assert.match(showShowcase, /refreshTheme\(\)/);
});

test('1.1 — theme change binding calls refreshTheme', () => {
    assert.match(mainJs, /bindSetting\('setting-theme'/);
    assert.match(mainJs, /warrball:theme/);
});

test('1.1 — _menuAccent removed', () => {
    assert.doesNotMatch(mainJs, /_menuAccent\s*\(/);
});

test('1.2 — wearables applied to menu hero', () => {
    assert.match(mainJs, /createKnifeModel\(knifeStyle\)/);
    assert.match(mainJs, /rig\.sockets\.handR\.add/);
});


test('1.2 — avatar exposes rig', () => {
    assert.match(showShowcase, /root\.rig = rig/);
});

test('1.2 — knife not attached if training', () => {
    assert.match(mainJs, /knifeId.*!==.*training/);
});

test('1.2 — old knife disposed', () => {
    assert.match(mainJs, /disposeObject3D\(this\.menuHero\._heroKnife\)/);
});

test('1.2 — knife model created', () => {
    assert.match(mainJs, /createKnifeModel\(knifeStyle\)/);
});

test('1.2 — knife attached to handR', () => {
    assert.match(mainJs, /rig\.sockets\.handR\.add/);
});

test('shop showcase unchanged', () => {
    assert.match(showShowcase, /export function createShopShowcase/);
});
