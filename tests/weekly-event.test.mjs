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

test('server mirror agrees with the client and scores only this week\'s mode', async () => {
    const { createRequire } = await import('node:module');
    const server = createRequire(import.meta.url)('../server/weekly-event.js');
    assert.deepEqual([...server.WEEKLY_EVENT_MODES], [...WEEKLY_EVENT_MODES]);
    for (let i = 0; i < 20; i++) {
        const date = new Date(Date.UTC(2026, 0, 1) + i * 5 * 864e5);
        assert.deepEqual(server.weeklyEvent(date), weeklyEvent(date));
    }
    const date = new Date(Date.UTC(2026, 8, 25, 12));
    const { modeId, week } = weeklyEvent(date);
    let step = server.applyWeeklyEventResult(null, { gameMode: modeId, won: true, date });
    assert.deepEqual(step, { counted: true, state: { week, modeId, points: 3, wins: 1, matches: 1 } });
    step = server.applyWeeklyEventResult(step.state, { gameMode: modeId, won: false, date });
    assert.deepEqual(step.state, { week, modeId, points: 4, wins: 1, matches: 2 });
    assert.equal(server.applyWeeklyEventResult(step.state, { gameMode: 'classic', won: true, date }).counted, false);
    assert.equal(server.applyWeeklyEventResult(step.state, { gameMode: '<x>', won: true, date }).counted, false);
    const nextWeek = new Date(date.getTime() + 7 * 864e5);
    const fresh = server.applyWeeklyEventResult(step.state, { gameMode: weeklyEvent(nextWeek).modeId, won: false, date: nextWeek });
    assert.deepEqual(fresh.state, { week: week + 1, modeId: weeklyEvent(nextWeek).modeId, points: 1, wins: 0, matches: 1 }, 'a new week starts from zero');
});

test('settled matches feed the ladder through ProfileStore; the API ranks and hides profile ids', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { ProfileStore } = require('../server/profile-store.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-event-'));
    const store = new ProfileStore(path.join(dir, 'profiles.json'));
    const now = Date.UTC(2026, 8, 25, 12);
    const { modeId, week } = weeklyEvent(new Date(now));
    const a = store.authenticate(store.session('', 'Ada').token);
    const b = store.authenticate(store.session('', 'Bora').token);
    store.reward(a, { matchId: 'event-m1', won: true, gameMode: modeId }, now);
    store.reward(a, { matchId: 'event-m2', won: true, gameMode: modeId }, now);
    const r = store.reward(b, { matchId: 'event-m3', won: false, gameMode: modeId }, now);
    assert.deepEqual(r.weeklyEvent, { points: 1, wins: 0, matches: 1 });
    store.reward(b, { matchId: 'event-m4', won: true, gameMode: 'classic' }, now);
    assert.equal(store.reward(a, { matchId: 'event-m1', won: true, gameMode: modeId }, now).replayed, true, 'a retry never scores twice');
    const rows = store.weeklyEventEntries(week).sort((x, y) => y.points - x.points);
    assert.deepEqual(rows.map(row => [row.displayName, row.points, row.wins, row.matches]), [['Ada', 6, 2, 2], ['Bora', 1, 0, 1]]);
    assert.deepEqual(store.weeklyEventEntries(week + 1), []);
    fs.rmSync(dir, { recursive: true, force: true });

    const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(src, /if \(urlPath === '\/api\/events\/weekly' && req\.method === 'GET'\) \{/);
    assert.match(src, /const strip = \(\{ profileId: _id, \.\.\.entry \}\) => entry;/);
    assert.match(src, /matchAuthority\.start\(profile, \{ matchId: b\.matchId, mode: b\.mode, lobbyCode: b\.lobbyCode, gameMode: b\.gameMode \}\)/);
    const authority = fs.readFileSync(new URL('../server/match-authority.js', import.meta.url), 'utf8');
    assert.equal((authority.match(/gameMode: match\.gameMode \}/g) || []).length, 3, 'every settle path carries the mode');
});
