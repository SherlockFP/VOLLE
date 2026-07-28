// Theme catalog contract: a theme is only real when all three places agree —
// js/ui-theme.js (accepted values), css/ui-tokens.css (token block) and the
// index.html picker. Drift in any one of them ships a dead or unreachable theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UI_THEMES, normalizeTheme } from '../js/ui-theme.js';

const tokens = fs.readFileSync(new URL('../css/ui-tokens.css', import.meta.url), 'utf8');
const markup = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const polish = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

function themeBlock(theme) {
    const start = tokens.indexOf(`:root[data-theme="${theme}"]`);
    if (start === -1) return null;
    const open = tokens.indexOf('{', start);
    const close = tokens.indexOf('}', open);
    if (open === -1 || close === -1) return null;
    return tokens.slice(open + 1, close);
}

test('every registered theme normalizes to itself', () => {
    assert.ok(UI_THEMES.length >= 2, 'at least a default and one alternative theme');
    for (const theme of UI_THEMES) assert.equal(normalizeTheme(theme), theme);
});

test('every registered theme declares a token block with a menu accent', () => {
    for (const theme of UI_THEMES) {
        const block = themeBlock(theme);
        assert.ok(block, `css/ui-tokens.css has no :root[data-theme="${theme}"] block`);
        assert.match(
            block,
            /--ui-menu-accent:/,
            `theme "${theme}" must set --ui-menu-accent, otherwise the menu never re-tints`
        );
    }
});

test('theme picker options match the registered themes exactly', () => {
    const open = markup.indexOf('<select id="setting-theme">');
    assert.notEqual(open, -1, 'index.html must expose #setting-theme');
    const body = markup.slice(open, markup.indexOf('</select>', open));
    const options = [...body.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(options, [...UI_THEMES]);
});

test('main menu palette derives from theme tokens instead of fixed colors', () => {
    for (const token of [
        '--ui-menu-accent',
        '--ui-menu-line',
        '--ui-menu-base',
        '--ui-menu-panel',
        '--ui-menu-stage'
    ]) {
        assert.ok(
            polish.includes(`var(${token}`),
            `css/polish.css must consume ${token} so themes reach the main menu`
        );
    }
});

test('team colors stay theme-independent for ownership readability', () => {
    for (const theme of UI_THEMES) {
        const block = themeBlock(theme);
        assert.doesNotMatch(
            block,
            /--menu-red|--menu-blue/,
            `theme "${theme}" must not repaint team red/blue`
        );
    }
});
