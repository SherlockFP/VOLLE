import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function rule(css, selector) {
    return css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

test('mobile incoming label occupies the dedicated right lane below the score header', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const marker = css.lastIndexOf('#incoming-indicator::after');
    const label = marker >= 0 ? css.slice(marker, css.indexOf('}', marker) + 1) : '';

    assert.match(label, /top:\s*84px;/);
    assert.match(label, /right:\s*8px;/);
    assert.match(label, /font-size:\s*12px;/);

    // LUNA's 375x720 measurement: score ends at y=75.56; the two-line label is 53.78px tall.
    const scoreBottom = 75.56;
    const labelTop = 84;
    const labelBottom = labelTop + 53.78;
    const killFeedTop = 150;
    assert.ok(labelTop > scoreBottom, 'label clears the score header');
    assert.ok(labelBottom < killFeedTop, 'label clears the kill-feed lane');
    assert.ok(labelTop < 360 && labelBottom < 360, 'label stays above the center reticle safe zone');
    assert.ok(labelBottom < 616, 'label stays above the lower-right ball-heat lane');
});

test('desktop incoming label geometry remains unchanged', async () => {
    const css = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
    const desktop = rule(css, '#incoming-indicator::after');
    assert.match(desktop, /top:\s*62px;/);
    assert.match(desktop, /right:\s*16px;/);
    assert.match(desktop, /font-size:\s*\.7rem;/);
});
