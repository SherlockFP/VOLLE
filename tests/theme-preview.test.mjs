import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UI_THEMES, normalizeTheme } from '../js/ui-theme.js';
import { buildThemeSwatchCards } from '../js/settings-controller.js';

const tokens = fs.readFileSync(new URL('../css/ui-tokens.css', import.meta.url), 'utf8');
const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const shellCss = fs.readFileSync(new URL('../css/ui-shell.css', import.meta.url), 'utf8');

function themeBlock(theme) {
    const start = tokens.indexOf(`:root[data-theme="${theme}"]`);
    if (start === -1) return null;
    const open = tokens.indexOf('{', start);
    const close = tokens.indexOf('}', open);
    if (open === -1 || close === -1) return null;
    return tokens.slice(open + 1, close);
}

test('buildThemeSwatchCards returns one card per option, exactly one marked selected', () => {
    const options = [
        { value: 'dark', label: 'Dark' },
        { value: 'ember', label: 'Ember' },
        { value: 'unknown-theme', label: 'Fake' }
    ];
    const cards = buildThemeSwatchCards(options, 'dark');
    assert.equal(cards.length, 3, 'should return all three options');
    assert.equal(cards[0].selected, true, 'first card should be selected');
    assert.equal(cards[1].selected, false, 'second card should not be selected');
    assert.equal(cards[2].selected, false, 'third card should not be selected');
});

test('buildThemeSwatchCards with unknown selected value marks nothing selected', () => {
    const options = [
        { value: 'dark', label: 'Dark' }
    ];
    const cards = buildThemeSwatchCards(options, 'no-such-theme');
    assert.equal(cards[0].selected, false, 'card should not be marked selected for unknown value');
});

test('buildThemeSwatchCards derives ariaLabel from label field', () => {
    const options = [
        { value: 'dark', label: 'Dark' }
    ];
    const cards = buildThemeSwatchCards(options, 'dark');
    assert.ok(cards[0].ariaLabel.includes('Dark'), 'ariaLabel should contain the label');
    assert.ok(cards[0].ariaLabel.includes('theme'), 'ariaLabel should describe it as a theme');
});

test('every registered theme has a swatch card selector in css/ui-tokens.css', () => {
    for (const theme of UI_THEMES) {
        const selectorString = `.theme-swatch-card[data-theme="${theme}"]`;
        assert.ok(
            tokens.includes(selectorString),
            `css/ui-tokens.css must include selector for theme "${theme}" swatch card: ${selectorString}`
        );
    }
});

test('every registered theme swatch card block defines required color tokens', () => {
    for (const theme of UI_THEMES) {
        const block = themeBlock(theme);
        assert.ok(block, `css/ui-tokens.css has no token block for theme "${theme}"`);
        for (const token of ['--ui-bg:', '--ui-surface:', '--ui-menu-accent:']) {
            assert.ok(
                block.includes(token),
                `theme "${theme}" token block must define ${token} (swatch needs these colors)`
            );
        }
    }
});

test('settings modal contains the theme swatch preview container', () => {
    const container = markup.match(/<div[^>]*id="setting-theme-preview"[^>]*>/);
    assert.ok(
        container,
        'index.html must have <div id="setting-theme-preview"> in the settings modal'
    );
    const containerStr = container[0];
    assert.ok(containerStr.includes('class="theme-swatch-grid"'), 'preview container must have theme-swatch-grid class');
    assert.ok(containerStr.includes('role="group"'), 'preview container must have role="group" for accessibility');
    assert.ok(containerStr.includes('aria-label'), 'preview container must have aria-label');
});

test('theme swatch grid styles exist in css/ui-shell.css', () => {
    assert.ok(
        shellCss.includes('.theme-swatch-grid'),
        'css/ui-shell.css must define .theme-swatch-grid styles'
    );
    assert.ok(
        shellCss.includes('.theme-swatch-card'),
        'css/ui-shell.css must define .theme-swatch-card styles'
    );
});

test('theme swatch card styles include focus-visible ring', () => {
    assert.ok(
        shellCss.includes('focus-visible') && shellCss.includes('theme-swatch-card'),
        'css/ui-shell.css must have focus-visible styling for swatch cards'
    );
});

test('theme swatch card styles respect reduce-motion', () => {
    assert.ok(
        shellCss.includes('.reduce-motion') && shellCss.includes('theme-swatch-card'),
        'css/ui-shell.css must apply reduce-motion rules to theme swatch cards'
    );
});

test('settings-controller.js contains no hardcoded hex colors in swatch code', () => {
    const controller = fs.readFileSync(new URL('../js/settings-controller.js', import.meta.url), 'utf8');
    // Extract just the swatch-related functions
    const swatchMatch = controller.match(/export function (?:build|init)ThemeSwatch[\s\S]*?(?=export|\Z)/);
    assert.ok(swatchMatch, 'swatch functions should exist');
    const swatchCode = swatchMatch[0];
    // Check for hex color patterns (# followed by 3 or 6 hex digits)
    assert.doesNotMatch(
        swatchCode,
        /#[0-9a-fA-F]{3,6}/,
        'swatch code must not hardcode hex colors; colors must come from CSS tokens'
    );
});

test('buildThemeSwatchCards is a pure function with no side effects', () => {
    const options1 = [{ value: 'dark', label: 'Dark' }];
    const cards1 = buildThemeSwatchCards(options1, 'dark');
    const options2 = [{ value: 'dark', label: 'Dark' }];
    const cards2 = buildThemeSwatchCards(options2, 'dark');
    assert.deepEqual(cards1, cards2, 'same input should produce identical output');
    assert.deepEqual(options1, options2, 'function should not mutate input');
});
