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

test('avatar cards keep purchase/equip hooks and stable preview attributes', () => {
  assert.match(ui, /card\.dataset\.shopPreview = 'avatar';\s*card\.dataset\.id = s\.id;/);
  assert.match(ui, /select\.dataset\.shopPreview = 'avatar';\s*select\.dataset\.id = s\.id;/);
  assert.match(ui, /'btn btn-small shop-equip' : 'btn btn-primary btn-small shop-buy'/);
  assert.match(ui, /new CustomEvent\('warrball:shop-preview'/);
  assert.match(ui, /practice\.dataset\.id = selected\.id/);
  assert.match(ui, /this\._setShopShowcase\(store, selectedSkin, false\);/);
});

test('shop layout covers target breakpoints and reduced motion', () => {
  assert.match(css, /@media \(min-width: 1500px\)/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /#shop-screen \.shop-tab \{[\s\S]*?min-height: 44px;/);
});
