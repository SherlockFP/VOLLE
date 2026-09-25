// Report tabs: Summary / Rewards / Details split the long report without moving
// any pinned markup; header and Rematch stay on every tab; fresh drops light a dot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractMethod } from './frame-contact-sim.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/postgame.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const report = html.slice(html.indexOf('<div id="post-game-screen"'), html.indexOf('<div class="pg-secondary-actions">'));

test('every report block belongs to one pane; header and Rematch belong to none', () => {
    const panes = { summary: ['pg-final-score-label', 'id="pg-winner"', 'id="pg-personal"', 'id="pg-mvp-card"', 'id="pg-potg"', 'class="pg-level"', 'class="guest-save-banner"'],
        rewards: ['class="pg-xp-bar-wrap"', 'id="pg-bp-progress"', 'id="pg-reward-card"', 'id="pg-coin-breakdown"', 'id="pg-match-drop"', 'id="pg-drop-log"'],
        details: ['id="pg-detail-disclosure"'] };
    for (const [pane, marks] of Object.entries(panes)) {
        for (const mark of marks) {
            const line = report.split('\n').find(l => l.includes(mark) && /^\s*<(div|section|span|details)/.test(l));
            assert.ok(line, mark);
            assert.match(line, new RegExp(`data-pg-pane="${pane}"`), mark);
        }
    }
    for (const always of ['<header class="pg-header">', '<section class="pg-rematch-hero"']) {
        const line = report.split('\n').find(l => l.includes(always));
        assert.doesNotMatch(line, /data-pg-pane/, always);
    }
    assert.match(html, /<div id="post-game-screen" class="hidden" data-pg-tab="summary">/);
    assert.equal((html.match(/data-pg-tab-btn="(summary|rewards|details)"/g) || []).length, 3);
    assert.match(css, /#post-game-screen\[data-pg-tab="rewards"\] \[data-pg-pane\]:not\(\[data-pg-pane="rewards"\]\)/);
});

test('switching tabs updates the screen, aria and the Rewards dot; Details opens itself', () => {
    const buttons = ['summary', 'rewards', 'details'].map(name => ({ dataset: { pgTabBtn: name }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }));
    const dot = { hidden: true };
    const details = { open: false };
    const screen = {
        dataset: { pgTab: 'summary' },
        addEventListener() {},
        querySelectorAll: () => buttons,
        querySelector: sel => (sel.includes('rewards') ? dot : null)
    };
    globalThis.document = { getElementById: id => ({ 'post-game-screen': screen, 'pg-detail-disclosure': details }[id] || null) };
    const setTab = new Function(`return ({ ${extractMethod(ui, 'setPostGameTab')} }).setPostGameTab;`)();
    const mark = new Function(`return ({ ${extractMethod(ui, '_markPostGameRewards')} })._markPostGameRewards;`)();
    const self = { setPostGameTab: setTab, _markPostGameRewards: mark };
    mark.call(self, true);
    assert.equal(dot.hidden, false, 'a drop while on Summary lights the dot');
    setTab.call(self, 'rewards');
    assert.equal(screen.dataset.pgTab, 'rewards');
    assert.equal(dot.hidden, true, 'seeing Rewards clears it');
    assert.deepEqual(buttons.map(b => b.attrs['aria-selected']), ['false', 'true', 'false']);
    mark.call(self, true);
    assert.equal(dot.hidden, true, 'no dot while already on Rewards');
    setTab.call(self, 'details');
    assert.equal(details.open, true);
    setTab.call(self, 'bogus');
    assert.equal(screen.dataset.pgTab, 'summary');
    delete globalThis.document;
});

test('the report opens on Summary; a new match clears the dot', () => {
    assert.match(ui, /showPostGame\([^)]*\) \{\s+const el = document\.getElementById\('post-game-screen'\);\s+if \(!el\) return;\s+this\.setPostGameTab\?\.\('summary'\);/);
    assert.match(ui, /clearPostGameMatchDrops\(\) \{\s+this\._markPostGameRewards\?\.\(false\);/);
});
