// Weekly event: one featured mode per week for everyone (no server), a menu card,
// a one-click bot match in that mode, and +50% match XP in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { registerHooks } from 'node:module';

import { WEEKLY_EVENT_MODES, WEEKLY_EVENT_XP_BONUS, timeLeftParts, weekIndex, weeklyEvent, weeklyEventXpBonus } from '../js/weekly-event.js';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { return specifier === 'three' ? { url: THREE_URL, shortCircuit: true } : next(specifier, context); } });
const { GAME_MODES } = await import('../js/gamemodes.js');

test('every event mode is a real lobby mode', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of WEEKLY_EVENT_MODES) {
        assert.ok(GAME_MODES[id], id);
        assert.match(html, new RegExp(`data-mode="${id}"`), `${id} is pickable in the lobby`);
    }
    assert.ok(!WEEKLY_EVENT_MODES.includes('competitive') && !WEEKLY_EVENT_MODES.includes('rally_duel'));
});

test('the week decides the mode: same all week, Monday 00:00 UTC rolls it, the countdown ends there', () => {
    const monday = new Date(Date.UTC(2026, 8, 21, 0, 0));      // Mon 21 Sep 2026
    const sunday = new Date(Date.UTC(2026, 8, 27, 23, 59));
    const nextMonday = new Date(Date.UTC(2026, 8, 28, 0, 0));
    assert.equal(weekIndex(monday), weekIndex(sunday));
    assert.equal(weekIndex(nextMonday), weekIndex(monday) + 1);
    assert.equal(weeklyEvent(monday).modeId, weeklyEvent(sunday).modeId);
    assert.notEqual(weeklyEvent(monday).modeId, weeklyEvent(nextMonday).modeId);
    assert.equal(weeklyEvent(sunday).endsAt, nextMonday.getTime());
    assert.deepEqual(timeLeftParts(nextMonday.getTime(), Date.UTC(2026, 8, 24, 10, 30)), { days: 3, hours: 13, minutes: 30 });
    const seen = new Set(Array.from({ length: WEEKLY_EVENT_MODES.length }, (_, i) => weeklyEvent(new Date(monday.getTime() + i * 7 * 864e5)).modeId));
    assert.equal(seen.size, WEEKLY_EVENT_MODES.length, 'every mode gets its week');
});

test('only the event mode earns the bonus', () => {
    const now = new Date(Date.UTC(2026, 8, 25, 12));
    const { modeId } = weeklyEvent(now);
    assert.equal(weeklyEventXpBonus(modeId, now), WEEKLY_EVENT_XP_BONUS);
    assert.equal(weeklyEventXpBonus('classic', now), 0);
    assert.equal(weeklyEventXpBonus(undefined, now), 0);
});

test('wiring: menu card, one-click event match, XP row on the report', () => {
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<button type="button" id="menu-event-card" class="ow-retention-card ow-retention-event"/);
    assert.match(main, /bind\('menu-event-card', \(\) => this\._playWeeklyEvent\(\)\);/);
    assert.match(main, /document\.getElementById\('solo-paths-start'\)\?\.click\(\);\s+if \(this\.game\.state !== STATES\.LOBBY\) return false;\s+this\.game\.selectMode\(event\.modeId\);/);
    assert.match(main, /const eventXp = Math\.round\(baseXp \* weeklyEventXpBonus\(this\.game\.mode\?\.id\)\);\s+const rawXp = baseXp \+ eventXp;/);
    assert.match(main, /\.\.\.\(eventXp > 0 \? \[\{ label: 'Weekly event bonus', value: eventXp \}\] : \[\]\),/);
});
