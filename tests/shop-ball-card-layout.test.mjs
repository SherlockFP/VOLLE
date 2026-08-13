import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');

test('ball shop cards reserve both inspect and purchase actions inside the clipped card', () => {
    const cycle = css.slice(css.indexOf('/* Shop utility moved to the bottom'));
    assert.match(cycle, /#shop-screen \.shop-card\.ball-skin \{ min-height: 348px; \}/);
    assert.match(cycle, /#shop-screen \.shop-card\.ball-skin > \.ball-inspect \{ margin-top: auto; \}/);
    assert.match(cycle, /#shop-screen \.shop-card\.ball-skin > :is\(\.shop-buy, \.shop-equip, \.shop-owned\) \{[\s\S]*?flex: 0 0 44px;[\s\S]*?margin-top: 8px;/);
});

test('short desktop ball cards keep two full 44px actions without overflowing the catalog', () => {
    const start = css.indexOf('@media (min-width: 981px) and (max-height: 800px)', css.indexOf('/* Shop utility moved to the bottom'));
    const end = css.indexOf('@media (max-width: 980px)', start);
    const compact = css.slice(start, end);
    assert.match(compact, /#shop-screen \.shop-card\.ball-skin \{ min-height: 304px; \}/);
    assert.match(compact, /#shop-screen \.ball-skin \.ball-inspect-stage \{ height: 120px; margin-bottom: 6px; \}/);
    assert.match(css, /#shop-screen \.shop-grid \{[\s\S]*?overflow-y: auto;/,
        'cards must remain inside the catalog scroll owner rather than escaping it');
});
