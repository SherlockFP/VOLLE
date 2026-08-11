import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const ui = read('../js/ui.js');
const css = read('../css/polish.css');

test('shop exposes accessible showcase, catalog, tabs, and practice mounts', () => {
  assert.match(html, /id="shop-showcase-canvas"[^>]+aria-label="Live 3D character skin preview"/);
  assert.match(html, /id="shop-tabs" role="tablist"/);
  assert.match(html, /id="shop-grid" role="tabpanel"/);
  assert.match(html, /id="btn-shop-practice"[^>]+data-shop-practice="avatar"/);
  assert.match(html, /id="shop-showcase-status"[^>]+role="status"[^>]+aria-live="polite"/);
});

test('avatar cards are selection-only; commerce stays in the detail panel', () => {
  assert.match(ui, /card\.dataset\.shopPreview = 'avatar';\s*card\.dataset\.id = s\.id;/);
  assert.match(ui, /select\.dataset\.shopPreview = 'avatar';\s*select\.dataset\.id = s\.id;/);
  assert.match(html, /id="shop-selected-action"[^>]+disabled/);
  assert.match(ui, /action\.classList\.toggle\('shop-equip', !equipped && owned\)/);
  assert.match(ui, /action\.classList\.toggle\('shop-buy', !equipped && !owned\)/);
  assert.match(ui, /new CustomEvent\('warrball:shop-preview'/);
  assert.match(ui, /practice\.dataset\.id = selected\.id/);
  assert.match(ui, /this\._setShopShowcase\(store, selectedSkin, false\);/);
  assert.doesNotMatch(ui, /trial\.className = 'btn btn-secondary btn-small shop-trial'/);
});

test('characters and skins keep preview separate from practice and hide invalid filters', () => {
  assert.match(ui, /_setShopCharacterDetail\(store, character, announce = false\)/);
  assert.match(ui, /data-shop-preview="character"/);
  assert.match(ui, /_syncShopFilters\(tab\)/);
  assert.match(ui, /chars: \['all', 'owned', 'affordable'\]/);
  assert.match(ui, /chip\.hidden = !enabled/);
  assert.match(html, /volle-shop-roster\.webp/);
  assert.match(css, /\.shop-roster-art/);
});

test('shop layout covers target breakpoints and reduced motion', () => {
  assert.match(css, /@media \(min-width: 1500px\)/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /#shop-screen \.shop-tab \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /grid-template-rows: minmax\(210px, 34vh\) auto/);
});
