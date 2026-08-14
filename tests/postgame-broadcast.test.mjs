import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/polish.css');
const ui = read('../js/ui.js');

test('Arena Broadcast Aftershow keeps result, final score and Rematch ahead of details', () => {
    const panel = html.indexOf('<div class="pg-panel" role="dialog"');
    const art = html.indexOf('victory-arena-broadcast-v1.webp', panel);
    const result = html.indexOf('id="pg-result"', panel);
    const score = html.indexOf('pg-final-score-label', panel);
    const rematch = html.indexOf('id="pg-play-again"', panel);
    const details = html.indexOf('id="pg-detail-disclosure"', panel);

    assert.ok(panel >= 0);
    assert.ok(art > panel);
    assert.ok(result > art);
    assert.ok(score > result);
    assert.ok(rematch > score);
    assert.ok(details > rematch);
    assert.match(html.slice(panel, details), /FINAL SCORE/);
    assert.match(html.slice(details), /Overview &middot; Timeline &middot; Stats/);
});

test('post-game key art is a bounded optimized WebP asset', () => {
    const asset = new URL('../assets/generated/postgame/victory-arena-broadcast-v1.webp', import.meta.url);
    const bytes = statSync(asset).size;
    assert.ok(bytes > 25_000, 'key art should be a real image rather than a placeholder');
    assert.ok(bytes < 400_000, `key art should stay cheap to decode and transfer, got ${bytes} bytes`);
    assert.match(html, /width="1600" height="900" alt="" decoding="async"/);
});

test('post-game result and structural stats do not depend on emoji glyphs', () => {
    const showStart = ui.indexOf('    showPostGame(');
    const showEnd = ui.indexOf('\n    // Post-match', showStart);
    const tableStart = ui.indexOf('    _buildAARTable(');
    const tableEnd = ui.indexOf('\n    _esc(', tableStart);
    const ownedPresentation = ui.slice(showStart, showEnd) + ui.slice(tableStart, tableEnd);

    assert.match(ownedPresentation, /resultEl\.textContent = won \? 'VICTORY' : 'DEFEAT'/);
    assert.doesNotMatch(ownedPresentation, /[🏆💀💥🏐👑🔴🔵]/u);
    assert.match(ownedPresentation, /class="pg-mvp-tag">MVP</);
});

test('real case art is used when the earned case catalog provides it', () => {
    const methodStart = ui.indexOf('    setPostGameMatchDrops(');
    const methodEnd = ui.indexOf('\n    // A terminal report', methodStart);
    const method = ui.slice(methodStart, methodEnd);

    assert.match(method, /const caseArt = drop\.type === 'case' \? CASES\[drop\.id\]\?\.art : null/);
    assert.match(method, /visual = document\.createElement\('img'\)/);
    assert.match(method, /visual\.className = 'pg-match-drop-visual pg-match-drop-art'/);
    assert.match(method, /window\._postGameDropAction\?\.\(\{ type: drop\.type, id: drop\.id \}\)/);
});

test('empty analysis hides and mobile stats use cards without horizontal table scrolling', () => {
    assert.match(ui, /if \(wrap\) wrap\.hidden = !hasAnalysis/);
    assert.match(ui, /if \(!hasAnalysis\) \{\s*content\.replaceChildren\(\);\s*return;/);
    assert.match(ui, /data-label="Kills"/);
    assert.match(css, /#post-game-screen \.pg-analysis\[hidden\] \{ display: none; \}/);
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*?#post-game-screen \.pg-stats \{ overflow: visible; \}/);
    assert.match(css, /#post-game-screen \.pg-aar-table tbody tr \{[\s\S]*?display: grid;/);
    assert.match(css, /content: attr\(data-label\)/);
});

test('Aftershow is dark, bounded, touch-safe and reduced-motion safe', () => {
    assert.match(css, /#post-game-screen \.pg-panel \{[\s\S]*?width: min\(1040px, calc\(100vw - 24px\)\);[\s\S]*?max-height: min\(94dvh, 900px\);/);
    assert.match(css, /#post-game-screen \.pg-detail-disclosure > summary \{[\s\S]*?min-height: 52px;/);
    assert.match(css, /#post-game-screen \.pg-secondary-actions \{[\s\S]*?position: sticky;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#post-game-screen \.pg-xp-bar-fill/);
});
