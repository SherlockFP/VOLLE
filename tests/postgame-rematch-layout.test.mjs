import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const css = read('../css/polish.css');
const ui = read('../js/ui.js');

test('post-game puts the single primary rematch action ahead of the detailed report', () => {
    const panelStart = html.indexOf('<div class="pg-panel">');
    const heroStart = html.indexOf('<section class="pg-rematch-hero"');
    const reportStart = html.indexOf('<section class="pg-detail-report"');
    const secondaryStart = html.indexOf('<div class="pg-secondary-actions">');

    assert.ok(panelStart >= 0, 'post-game panel is present');
    assert.ok(heroStart > panelStart, 'rematch hero stays inside the post-game panel');
    assert.ok(reportStart > heroStart, 'detailed rewards and stats follow the rematch action');
    assert.ok(secondaryStart > reportStart, 'exit routes remain lower-priority than the report');
    assert.equal((html.match(/id="pg-play-again"/g) || []).length, 1, 'rematch keeps one handler target');
    assert.equal((html.match(/id="pg-rematch-status"/g) || []).length, 1, 'readiness status keeps one live region');
    assert.match(html.slice(heroStart, reportStart), /id="pg-rematch-status"[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(html.slice(heroStart, reportStart), /id="pg-play-again"/);
    assert.match(html.slice(reportStart, secondaryStart), /id="postgame-stats"/);
    assert.match(html.slice(reportStart, secondaryStart), /id="pg-analysis"/);
});

test('post-game rematch action is full-width, touch-safe, and mobile-safe', () => {
    assert.match(css, /\.pg-rematch-hero\s*\{[\s\S]*?display:\s*grid;/);
    assert.match(css, /\.pg-rematch-hero #pg-play-again\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-height:\s*52px;/);
    assert.match(css, /\.pg-secondary-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(css, /@media \(max-width: 700px\)\s*\{[\s\S]*?\.pg-secondary-actions\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('reward flow inserts by the nested stats parent and survives the post-game hierarchy', () => {
    const reportStart = html.indexOf('<section class="pg-detail-report"');
    const statsStart = html.indexOf('id="postgame-stats"');
    assert.ok(statsStart > reportStart, 'postgame stats are nested in the detailed report');
    assert.match(ui, /const stats = document\.getElementById\('postgame-stats'\);\s+const report = stats\?\.parentNode;/);
    assert.match(ui, /if \(host\.parentNode !== report \|\| host\.nextSibling !== stats\) report\.insertBefore\(host, stats\);/);
    assert.doesNotMatch(ui, /panel\.insertBefore\(host, document\.getElementById\('postgame-stats'\)\);/);
});

test('post-game status and XP label remain readable in the compact mobile card', () => {
    assert.match(css, /\.pg-rematch-hero \.rematch-status\s*\{[\s\S]*?color:\s*var\(--screen-ink\);[\s\S]*?background:\s*var\(--shell-ink\);/);
    assert.match(css, /\.pg-xp-text\s*\{[\s\S]*?width:\s*100%;[\s\S]*?white-space:\s*nowrap;[\s\S]*?line-height:\s*28px;/);
});
