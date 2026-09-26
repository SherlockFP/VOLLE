// tests/first-session.test.mjs — Gauntlet G8 first session: the FTUE welcome
// runs the 40 s guided drill and its completion sets ftueCompleted; a fresh
// profile's first solo match is medium / 5 rounds / 180 s; new profiles default
// to a medium bot while existing saves keep theirs; the settings dropdown and
// the session both read the stored value; personal bests persist locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { compileMethod, extractMethod, readSource } from './method-source.mjs';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const { Store, isNewPlayerProfile } = await import('../js/store.js');
const { GuidedDeflectDrill, GUIDED_DRILL_FIRST_RUN_TOTAL_MS } = await import('../js/guided-deflect-drill.js');
const { FIRST_SOLO_MATCH_CONFIG, firstSoloMatchConfig } = await import('../js/run-it-back.js');

const SAVE_KEY = 'dodgball_save_v2';
const STATES = { MENU: 'MENU', LOBBY: 'LOBBY', PLAYING: 'PLAYING' };

// ---- FTUE drill ------------------------------------------------------------

function ftueApp({ ftueCompleted = false, firstRun = true } = {}) {
    const store = new Map([['ftueCompleted', ftueCompleted]]);
    const tracked = [];
    const game = {
        state: STATES.MENU,
        guidedDrill: new GuidedDeflectDrill(),
        selectMode() {}, selectMap() {}, startGame() { this.started = true; },
        armGuidedDrill({ profile }) { this.guidedDrill.arm({ profile }); }
    };
    const document = {
        getElementById: () => ({ classList: { add() {}, remove() {} } }),
        body: { classList: { add() {}, remove() {} } }
    };
    const app = {
        game,
        store: {
            get: key => store.get(key),
            set: (key, value) => store.set(key, value),
            syncOnboarding: async () => true
        },
        productAnalytics: { track: (name, props) => tracked.push({ name, props }) },
        player: { lock() {} },
        _ftueWelcomeFirstRun: firstRun,
        _capturePracticeSession() {},
        startPractice() {},
        hideFtueWelcome() { this._ftueWelcomeFirstRun = false; },
        _showGuidedDrillResult() {}
    };
    app.startFtueGuidedDrill = compileMethod('js/main.js', 'startFtueGuidedDrill');
    app.startGuidedDeflectDrill = compileMethod('js/main.js', 'startGuidedDeflectDrill', { STATES, document });
    // The shipped completion callback, lifted out of the App constructor.
    const main = readSource('js/main.js');
    const start = main.indexOf('this.game.onGuidedDrillComplete = result => {');
    const end = main.indexOf('\n        };', start) + '\n        };'.length;
    const handlerSource = main.slice(start, end).replace('this.game.onGuidedDrillComplete = ', 'return ').replace(/;\s*$/, '');
    app.onGuidedDrillComplete = runInNewContext(`(function () { ${handlerSource} })`, {}).call(app);
    return { app, store, tracked };
}

test('fresh profile: the FTUE welcome runs the 40 s drill and completing it sets ftueCompleted', () => {
    const { app, store, tracked } = ftueApp();
    app.startFtueGuidedDrill();
    assert.equal(app._ftueGuidedRun, true, 'the welcome path is the FTUE run');
    assert.equal(app.game.guidedDrill.profile.id, 'first_run');
    assert.equal(app.game.guidedDrill.profile.totalMs, GUIDED_DRILL_FIRST_RUN_TOTAL_MS);
    assert.equal(GUIDED_DRILL_FIRST_RUN_TOTAL_MS, 40000);
    assert.equal(tracked.find(entry => entry.name === 'practice_start').props.source, 'ftue');
    assert.equal(app.game.started, true);
    app.onGuidedDrillComplete({ allPassed: true });
    assert.equal(store.get('ftueCompleted'), true, 'ftueCompleted gets set');
    assert.equal(tracked.filter(entry => entry.name === 'ftue_complete').length, 1);
    assert.equal(app._ftueGuidedRun, false);
});

test('only the ftue source runs the first-run drill; a completed profile replays the full drill as manual help', () => {
    const body = extractMethod('js/main.js', 'startGuidedDeflectDrill');
    assert.match(body, /const firstRun = source === 'ftue';/);
    const { app, store } = ftueApp({ ftueCompleted: true, firstRun: false });
    app.startFtueGuidedDrill();
    assert.equal(app._ftueGuidedRun, false, 'a completed profile replays the full drill as manual help');
    assert.equal(app.game.guidedDrill.profile.id, 'full');
    app.onGuidedDrillComplete({ allPassed: true });
    assert.equal(store.get('ftueCompleted'), true);
});

// ---- First solo match --------------------------------------------------------

test('firstSoloMatchConfig: medium / 5 rounds / 180 s only while matchesPlayed === 0', () => {
    assert.deepEqual({ ...FIRST_SOLO_MATCH_CONFIG }, { botDifficulty: 'medium', maxRounds: 5, timeLimit: 180 });
    assert.equal(firstSoloMatchConfig({ matchesPlayed: 0 }), FIRST_SOLO_MATCH_CONFIG);
    assert.equal(firstSoloMatchConfig({ matchesPlayed: 1 }), null);
    assert.equal(firstSoloMatchConfig({ matchesPlayed: 0, newProfile: false }), null, 'an account with server history is not new');
});

function soloGame(resolveFirstSoloMatch) {
    const startSolo = compileMethod('js/game.js', 'startSolo', {
        STATES,
        document: {
            querySelectorAll: () => [],
            getElementById: id => ({ 'setting-match-time': { value: '300' }, 'setting-max-rounds': { value: '16' } })[id] || null
        },
        parseInt,
        Scoreboard: class {
            constructor() { this.players = new Map(); }
            setTimeLimit(value) { this.timeLimit = value; }
            setMaxRounds(value) { this.maxRounds = value; }
            addPlayer(name) { this.players.set(name, {}); }
        }
    });
    const created = [];
    const game = {
        botDifficulty: 'hard',
        resolveFirstSoloMatch,
        ui: { setRoomCode() {} },
        player: { setTeam() {}, respawn() {} },
        addBot(team) { created.push({ team, difficulty: this.botDifficulty }); },
        setState(state) { this.state = state; },
        _startMusic() {}, updateLobbyUI() {}
    };
    startSolo.call(game);
    return { game, created };
}

test('first solo match of a fresh profile: medium bot, 5 rounds, 180 s; later matches keep lobby settings', () => {
    const first = soloGame(() => firstSoloMatchConfig({ matchesPlayed: 0 }));
    assert.equal(first.game.scoreboard.maxRounds, 5);
    assert.equal(first.game.scoreboard.timeLimit, 180);
    assert.deepEqual(first.created, [{ team: 'blue', difficulty: 'medium' }]);
    assert.equal(first.game.botDifficulty, 'hard', 'the session difficulty is left alone for later bots');

    const later = soloGame(() => firstSoloMatchConfig({ matchesPlayed: 3 }));
    assert.equal(later.game.scoreboard.maxRounds, 16);
    assert.equal(later.game.scoreboard.timeLimit, 300);
    assert.deepEqual(later.created, [{ team: 'blue', difficulty: 'hard' }]);

    const main = readSource('js/main.js');
    assert.match(main, /this\.game\.resolveFirstSoloMatch = \(\) => firstSoloMatchConfig\(\{\s*matchesPlayed: this\.store\.get\('stats'\)\?\.gamesPlayed,\s*newProfile: isNewPlayerProfile\(this\.store\.data\)\s*\}\);/);
});

// ---- Bot difficulty defaults ----------------------------------------------

test('new profiles default to a medium bot; existing saves keep theirs', () => {
    memory.clear();
    Store.data = Store._read();
    assert.equal(Store.get('settings').botDifficulty, 'medium', 'fresh profile');
    assert.equal(isNewPlayerProfile(Store.data), true);

    memory.set(SAVE_KEY, JSON.stringify({ settings: { sensitivity: 3 }, stats: { gamesPlayed: 12 } }));
    assert.equal(Store._read().settings.botDifficulty, 'hard', 'a save from before the default change keeps hard');

    memory.set(SAVE_KEY, JSON.stringify({ settings: { botDifficulty: 'easy' } }));
    assert.equal(Store._read().settings.botDifficulty, 'easy', 'an explicit choice is kept');

    memory.set(SAVE_KEY, JSON.stringify({ settings: { botDifficulty: 'hard' } }));
    assert.equal(Store._read().settings.botDifficulty, 'hard');
    memory.clear();
    Store.data = Store._read();
});

test('the settings dropdown shows the stored difficulty and the session plays it', () => {
    const main = readSource('js/main.js');
    assert.match(main, /hydrateSetting\('setting-bot-difficulty', storedBotDifficulty\);\s*this\.game\.setBotDifficulty\(storedBotDifficulty\);/);
    assert.match(main, /const storedBotDifficulty = \['easy', 'medium', 'hard', 'auto'\]\.includes\(this\.store\.get\('settings'\)\?\.botDifficulty\)/, "'auto' = adaptive (js/adaptive-difficulty.js)");
    const game = readSource('js/game.js');
    assert.match(game, /this\.botDifficulty = 'medium';/, 'the Game default matches a fresh profile');
    const store = readSource('js/store.js');
    assert.match(store, /botDifficulty: 'medium', fov: 75,/);
    assert.match(store, /botDifficulty: LEGACY_BOT_DIFFICULTY,\s*\.\.\.\(parsed\.settings \|\| \{\}\),/);
});

// ---- Personal bests persist locally ---------------------------------------

test('personal bests are a local Store field that only ever improves', () => {
    memory.clear();
    Store.data = Store._read();
    assert.deepEqual(Store.getPersonalBests(), { deflects: 0, perfects: 0, topSpeed: 0, bestRally: 0, kos: 0 });
    const first = Store.recordPersonalBests({ deflects: 9, perfects: 1, topSpeed: 2.26, bestRally: 4, kos: 2 });
    assert.deepEqual(first.beaten, { deflects: true, perfects: true, topSpeed: true, bestRally: true, kos: true });
    assert.equal(Store.getPersonalBests().topSpeed, 2.3);
    const second = Store.recordPersonalBests({ deflects: 5, perfects: 3, topSpeed: 1.8, bestRally: 4, kos: 0 });
    assert.deepEqual(second.previous, { deflects: 9, perfects: 1, topSpeed: 2.3, bestRally: 4, kos: 2 });
    assert.deepEqual(second.beaten, { deflects: false, perfects: true, topSpeed: false, bestRally: false, kos: false });
    assert.deepEqual(Store.getPersonalBests(), { deflects: 9, perfects: 3, topSpeed: 2.3, bestRally: 4, kos: 2 });
    const saved = JSON.parse(memory.get(SAVE_KEY));
    assert.equal(saved.personalBests.perfects, 3, 'persisted to the local save');
    memory.set(SAVE_KEY, JSON.stringify({ personalBests: { deflects: 'x', kos: -4, topSpeed: 3.1 } }));
    assert.deepEqual(Store._read().personalBests, { deflects: 0, perfects: 0, topSpeed: 3.1, bestRally: 0, kos: 0 },
        'hostile saves degrade to zeros');
    memory.clear();
    Store.data = Store._read();
});
