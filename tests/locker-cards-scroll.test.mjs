import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Cards uses its own bounded scroll region below persistent Locker chrome', () => {
    const start = css.indexOf('/* Cycle C16b: Card Collection is intentionally long.');
    const desktop = css.slice(start, css.indexOf('@media (max-width: 700px)', start));

    assert.ok(start >= 0, 'the Cards viewport ownership rule must remain documented');
    assert.match(desktop, /#character-locker-content:has\(#locker-panel-cards:not\(\.hidden\)\)\s*\{[\s\S]*?height: min\(900px, calc\(100dvh - 28px\)\);[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\) auto;[\s\S]*?overflow: hidden;/);
    assert.match(desktop, /#character-locker-content:has\(#locker-panel-cards:not\(\.hidden\)\) \.locker-rail\s*\{[\s\S]*?position: static;[\s\S]*?margin-top: 0;/);
    assert.match(desktop, /#locker-panel-cards:not\(\.hidden\)\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/);
    assert.match(desktop, /#character-locker-content:has\(#locker-panel-cards:not\(\.hidden\)\) \.hero-actions\s*\{[\s\S]*?flex: 0 0 auto;/);
});

test('Cards mobile viewport stays bounded and keeps the collection as the scroll owner', () => {
    const mobileStart = css.lastIndexOf('@media (max-width: 700px)');
    const mobile = css.slice(mobileStart);

    assert.match(mobile, /#character-locker-content:has\(#locker-panel-cards:not\(\.hidden\)\)\s*\{[\s\S]*?height: 100dvh;[\s\S]*?max-height: 100dvh;/);
    assert.match(mobile, /#locker-panel-cards:not\(\.hidden\)\s*\{[\s\S]*?padding-right: 4px;/);
    assert.match(mobile, /#locker-panel-cards \.locker-section-header\s*\{[\s\S]*?margin-top: 10px;/);
});

test('Cards panel remains structurally between Locker tabs and persistent actions', () => {
    const tabs = html.indexOf('id="locker-tabs"');
    const cards = html.indexOf('id="locker-panel-cards"');
    const actions = html.indexOf('class="hero-actions"', cards);

    assert.ok(tabs >= 0 && cards > tabs && actions > cards, 'Cards must stay below tabs and above persistent Locker actions');
    assert.match(html.slice(cards, actions), /id="card-collection-grid"/);
    assert.match(html.slice(cards, actions), /class="card-tradeup"/);
});
