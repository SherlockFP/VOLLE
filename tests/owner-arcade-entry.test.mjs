import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import en from '../js/locales/en.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const arcade = html.slice(html.indexOf('id="practice-menu-screen"'), html.indexOf('id="tournament-screen"'));

test('the Arcade screen exposes every local gameplay entry with a unique wired button', () => {
    for (const id of ['btn-menu-bots', 'btn-guided-deflect', 'btn-free-practice', 'btn-menu-volleyball']) {
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must exist exactly once`);
        assert.match(arcade, new RegExp(`<button[^>]*id="${id}"`));
        assert.ok(main.includes(`bind('${id}',`), `${id} must be wired to the existing launch path`);
    }
});

test('solo chooser is a labeled dialog and its Arcade entry declares the relationship', () => {
    assert.match(arcade, /id="btn-menu-bots"[^>]*aria-haspopup="dialog"[^>]*aria-controls="solo-paths"/);
    assert.match(html, /<dialog[^>]*id="solo-paths"[^>]*aria-labelledby="solo-paths-title"/);
    for (const id of ['warmup', 'rally_duel', 'pressure']) {
        assert.equal(html.split(`data-solo-preset="${id}"`).length - 1, 1);
    }
});

test('Volleyball is explicitly a local feeder drill and the solo clock is a match limit', () => {
    assert.match(arcade, /LOCAL ONLY \/ GUIDED CONTACTS/);
    assert.match(arcade, /Not a multiplayer match/);
    const selection = main.slice(main.indexOf('const selectSoloPreset ='), main.indexOf("bind('btn-menu-bots'"));
    // The rules line is localised: the source names the key, the table holds the copy.
    assert.match(selection, /setText\(detail, 'solo\.detail', \{ rounds: preset\.maxRounds, minutes: preset\.timeLimit \/ 60, opponent \}\)/);
    assert.doesNotMatch(selection, /minute (match|round) limit|Review your court|adaptive opponent/);
    assert.match(en.solo.detail, /minute match limit/);
    assert.doesNotMatch(en.solo.detail, /minute round limit/);
});
