import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');
const social = css.slice(
    css.lastIndexOf('/* Social directory keeps one deliberate scroll surface.'),
    css.indexOf('/* Social Hub is a complete secondary destination. */')
);

test('social directory owns a visible themed scrollbar instead of a browser-white rail', () => {
    assert.match(social, /#main-menu \.friends-sidebar-body \{[\s\S]*scrollbar-width: thin;[\s\S]*scrollbar-color:/);
    assert.match(social, /\.friends-sidebar-body::\-webkit-scrollbar \{[\s\S]*width: 9px;/);
    assert.match(social, /\.friends-sidebar-body::\-webkit-scrollbar-track \{[\s\S]*border-radius: 999px;/);
    assert.match(social, /\.friends-sidebar-body::\-webkit-scrollbar-thumb \{[\s\S]*min-height: 44px;[\s\S]*linear-gradient/);
});

test('mobile sheet restores the themed scrollbar after the legacy hidden-bar rule', () => {
    assert.match(social, /@media \(max-width: 760px\) \{[\s\S]*\.friends-sidebar-body::\-webkit-scrollbar \{ display: block; \}/);
    assert.match(social, /overscroll-behavior-y: contain;/);
});
