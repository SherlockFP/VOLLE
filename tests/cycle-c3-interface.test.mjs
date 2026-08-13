import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
const render = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');

test('registration requires email while login accepts a username or email identity', () => {
    assert.match(html, /id="auth-login-username"[^>]*placeholder="Username or email"/);
    assert.match(html, /<input[^>]*type="email"[^>]*id="auth-register-email"[^>]*required/);
    assert.match(main, /account\.register\(username, password, email\)/);
});

test('shop utility cluster is below the catalog and the catalog owns the largest column', () => {
    const shop = html.slice(html.indexOf('id="shop-screen"'), html.indexOf('<!-- ===== BATTLEPASS'));
    assert.ok(shop.indexOf('shop-showcase-layout') < shop.indexOf('shop-footer'));
    assert.match(shop, /shop-footer[\s\S]*shop-footer-brand[\s\S]*btn-shop-back[\s\S]*shop-footer-wallet/);
    assert.match(css, /#shop-screen \.shop-shell \{ grid-template-rows: auto minmax\(0, 1fr\) auto; \}/);
    assert.match(css, /#shop-screen \.shop-showcase-layout \{ grid-template-columns: minmax\(360px, \.68fr\) minmax\(0, 1\.72fr\); \}/);
    assert.match(css, /#shop-screen \.shop-grid \{ grid-template-columns: repeat\(auto-fill, minmax\(270px, 1fr\)\); gap: 18px; \}/);
});

test('short desktop character cards budget every row and keep a full 44px action inside the card', () => {
    const cycle = css.slice(css.indexOf('/* Cycle C3:'));
    const value = name => Number(cycle.match(new RegExp(`--shop-character-${name}:\\s*(\\d+)px`))?.[1]);
    const shortBlock = cycle.slice(cycle.indexOf('@media (min-width: 981px) and (max-height: 800px)'), cycle.indexOf('@media (max-width: 980px)'));
    const shortArt = Number(shortBlock.match(/--shop-character-art-height:\s*(\d+)px/)?.[1]);
    const [, shortInset, shortGap] = shortBlock.match(/\.shop-catalog \{ padding:\s*(\d+)px 18px; gap:\s*(\d+)px; \}/) || [];
    const innerHeight = shortArt + value('name-height') + value('description-height')
        + value('action-height') + value('row-gaps');
    const cardHeight = innerHeight + value('card-padding');
    const reclaimedHeight = (18 - Number(shortInset)) * 2 + (12 - Number(shortGap)) * 2;
    assert.equal(value('action-height'), 44, 'Inspect must retain a full accessible action row');
    assert.equal(innerHeight, 302, 'short layout must account for art, copy, CTA and all row gaps');
    assert.equal(cardHeight, 334, 'card must include its vertical padding instead of clipping the button');
    assert.ok(reclaimedHeight >= 32,
        `short catalog must reclaim at least 32px around the grid; reclaimed ${reclaimedHeight}px`);
    assert.match(css, /shop-card\[data-shop-preview="character"\][\s\S]*?min-height:\s*calc\(var\(--shop-character-art-height\)[\s\S]*?var\(--shop-character-card-padding\)\)/);
    assert.match(css, /shop-character-select[\s\S]*?grid-template-rows:\s*var\(--shop-character-art-height\)[\s\S]*?var\(--shop-character-action-height\)/);
});

test('navigation and social rail have explicit wide, compact and mobile contracts', () => {
    const cycleLayer = css.indexOf('/* Cycle C3:');
    assert.ok(cycleLayer > css.indexOf('/* Cycle C2:'), 'C3 navigation must win the cascade after C2');
    assert.ok(cycleLayer > css.indexOf('/* Showcase shop:'), 'C3 shop sizing must win the cascade after showcase defaults');
    const cycle = css.slice(cycleLayer);
    assert.match(cycle, /#main-menu \.ow-world-grid \{ min-width: 0; grid-template-columns: minmax\(0, 1fr\); \}/,
        'the single Social Hub destination must own the full action-panel width at desktop sizes');
    assert.match(css, /@media \(min-width: 1340px\)/);
    assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1339px\)[\s\S]*?\.ow-tabs[\s\S]*?overflow-x: auto/);
    assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1339px\)[\s\S]*?\.friends-sidebar\s*\{[\s\S]*?top: 96px/);
    assert.match(css, /#main-menu \.ow-social-lobby \{[\s\S]*?min-height: 92px/);
    assert.match(main, /\(min-width: 761px\) and \(max-width: 1339px\)/);
    assert.match(main, /Close social and party panel/);
});

test('Render Blueprint mounts the embedded account database on a persistent disk', () => {
    assert.match(render, /plan: starter/);
    assert.match(render, /DATA_DIR[\s\S]*value: \/var\/data/);
    assert.match(render, /disk:[\s\S]*mountPath: \/var\/data[\s\S]*sizeGB: 1/);
    assert.match(render, /healthCheckPath: \/healthz/);
});
