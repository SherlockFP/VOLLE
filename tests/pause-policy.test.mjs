// Pause policy (js/pause-policy.js) and its wiring: online Esc only opens the
// overlay, solo Resume never rewinds a state that moved on under the menu, and
// the solo pre-game countdown suspends with the pause and resumes after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { IN_MATCH_PAUSE_STATES, pauseAction, resumeAction } from '../js/pause-policy.js';
import { compileGameMethod } from './game-source.mjs';
import { compileMethod } from './method-source.mjs';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');

// The real STATES table from js/game.js (the module itself imports Three.js).
const statesStart = gameSource.indexOf('export const STATES = {');
const STATES = runInNewContext(`(${gameSource.slice(gameSource.indexOf('{', statesStart), gameSource.indexOf('};', statesStart) + 1)})`);

function sliceBlock(source, startNeedle, from = 0) {
    const start = source.indexOf(startNeedle, from);
    assert.ok(start >= 0, `${startNeedle} not found`);
    let depth = 0;
    for (let index = source.indexOf('{', start); index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    return assert.fail(`${startNeedle} block is incomplete`);
}

// The Esc keydown handler's pause-menu section: resume when open, else pause.
const escStart = /const pauseEl = document\.getElementById\('pause-menu'\);\r?\n\s*if \(pauseEl && !pauseEl\.classList\.contains\('hidden'\)\) \{/.exec(mainSource)?.index ?? -1;
assert.ok(escStart > 0, 'Esc pause-menu section not found');
const escResumeBranch = sliceBlock(mainSource, "if (pauseEl && !pauseEl.classList.contains('hidden')) {", escStart);
const escPauseBranch = sliceBlock(mainSource, 'if (pause.overlay) {', escStart);
const escPauseStart = mainSource.indexOf('const pause = pauseAction(', escStart);
const escPauseSnippet = mainSource.slice(escPauseStart, mainSource.indexOf(escPauseBranch, escStart) + escPauseBranch.length);

test('policy strings match the STATES table in js/game.js', () => {
    assert.deepEqual([...IN_MATCH_PAUSE_STATES], [STATES.PLAYING, STATES.COUNTDOWN, STATES.ROUND_END, STATES.CELEBRATION]);
    assert.equal(STATES.PAUSED, 'PAUSED');
    assert.ok(Object.isFrozen(IN_MATCH_PAUSE_STATES));
});

test('pauseAction: online opens only the overlay, solo pauses, menus do nothing', () => {
    for (const state of IN_MATCH_PAUSE_STATES) {
        assert.deepEqual(pauseAction({ connected: true, state }), { overlay: true, setState: null }, `online ${state}`);
        assert.deepEqual(pauseAction({ connected: false, state }), { overlay: true, setState: 'PAUSED' }, `solo ${state}`);
    }
    assert.deepEqual(pauseAction({ connected: false, state: 'PLAYING' }), { overlay: true, setState: 'PAUSED' });
    for (const state of ['MENU', 'LOBBY', 'GAME_OVER', 'PAUSED', 'SOCIAL_HUB', 'COSMETIC_PRACTICE', undefined]) {
        for (const connected of [true, false]) {
            assert.deepEqual(pauseAction({ connected, state }), { overlay: false, setState: null }, `${connected} ${state}`);
        }
    }
});

test('resumeAction restores only while PAUSED, so nothing that moved on is rewound', () => {
    assert.deepEqual(resumeAction({ state: 'PAUSED', pausedFrom: 'COUNTDOWN' }), { setState: 'COUNTDOWN' });
    assert.deepEqual(resumeAction({ state: 'PAUSED', pausedFrom: 'ROUND_END' }), { setState: 'ROUND_END' });
    assert.deepEqual(resumeAction({ state: 'PAUSED', pausedFrom: null }), { setState: 'PLAYING' });
    // A countdown that finished under the menu, or an online overlay (never PAUSED).
    assert.deepEqual(resumeAction({ state: 'PLAYING', pausedFrom: 'COUNTDOWN' }), { setState: null });
    assert.deepEqual(resumeAction({ state: 'PLAYING', pausedFrom: null }), { setState: null });
    assert.deepEqual(resumeAction({ state: 'ROUND_END', pausedFrom: 'PLAYING' }), { setState: null });
    assert.deepEqual(resumeAction({ state: 'GAME_OVER', pausedFrom: null }), { setState: null });
});

test('main.js: the Esc pause branch reaches PAUSED only through pauseAction', () => {
    assert.match(mainSource, /import \{ pauseAction, resumeAction \} from '\.\/pause-policy\.js';/);
    assert.match(escPauseSnippet, /^const pause = pauseAction\(\{ connected: !!this\.network\?\.connected, state: this\.game\.state \}\);/);
    assert.match(escPauseBranch, /if \(pause\.setState === STATES\.PAUSED\) \{\s*this\._pausedFromState = this\.game\.state;\s*this\.game\.setState\(STATES\.PAUSED\);/);
    assert.match(escPauseBranch, /this\.player\._clearInputState\?\.\(\);/);
    // Only the Esc branch above and the replay viewer ever set PAUSED.
    assert.equal(mainSource.split('this.game.setState(STATES.PAUSED)').length - 1, 2);
    const escSection = mainSource.slice(escStart, escPauseStart + escPauseSnippet.length);
    assert.doesNotMatch(escSection, /\.includes\(this\.game\.state\)/, 'the in-match list lives in js/pause-policy.js');
});

test('main.js: Esc-while-open and Continue both resume through _resumeFromPauseMenu / resumeAction', () => {
    assert.match(escResumeBranch, /^if \(pauseEl && !pauseEl\.classList\.contains\('hidden'\)\) \{\s*\/\/[^\n]*\n\s*this\._resumeFromPauseMenu\(\);\s*return;\s*\}$/);
    assert.ok(escPauseStart > escStart && escPauseStart - escStart < 600, 'the pause branch follows the resume branch');
    assert.match(mainSource, /bind\('pause-resume', \(\) => this\._resumeFromPauseMenu\(\)\);/);
    assert.match(mainSource, /_resumeFromPauseMenu\(\) \{[\s\S]*?resumeAction\(\{ state: this\.game\.state, pausedFrom: this\._pausedFromState \}\)/);
    assert.doesNotMatch(mainSource, /this\.game\.setState\(this\._pausedFromState \|\| STATES\.PLAYING\)/);
    // The overlay keeps its pointer input away from the live match underneath.
    assert.match(mainSource, /const pauseMenu = document\.getElementById\('pause-menu'\);\s*for \(const type of \['mousedown', 'mousemove', 'wheel'\]\) \{\s*pauseMenu\?\.addEventListener\(type, e => e\.stopPropagation\(\)/);
});

function fakeApp({ connected, state }) {
    const calls = [];
    const game = {
        state,
        setState(next) { calls.push(['setState', next]); this.state = next; },
        suspendPreGameCountdown() { calls.push(['suspend']); return true; },
        resumePreGameCountdown() { calls.push(['resume']); return true; },
    };
    const pauseEl = {
        hidden: true,
        classList: {
            add: name => { if (name === 'hidden') pauseEl.hidden = true; },
            remove: name => { if (name === 'hidden') pauseEl.hidden = false; },
            contains: name => name === 'hidden' && pauseEl.hidden,
        },
    };
    const app = {
        network: { connected },
        game,
        _pausedFromState: null,
        ui: { hideScoreboard: () => calls.push(['hideScoreboard']), setPlayerTarget: on => calls.push(['setPlayerTarget', on]) },
        player: {
            unlock: () => calls.push(['unlock']),
            lock: () => calls.push(['lock']),
            _clearInputState: () => calls.push(['clearInput']),
        },
    };
    return { app, game, pauseEl, calls };
}

const runEscPause = runInNewContext(`(function (pauseEl) { ${escPauseSnippet} })`, { pauseAction, STATES });
const documentFor = pauseEl => ({ getElementById: id => (id === 'pause-menu' ? pauseEl : null) });
const resumeFromPauseMenu = pauseEl => compileMethod('js/main.js', '_resumeFromPauseMenu', {
    document: documentFor(pauseEl), resumeAction, STATES,
});

test('online Esc opens the overlay without touching the match state, and Continue leaves it running', () => {
    for (const state of IN_MATCH_PAUSE_STATES) {
        const { app, game, pauseEl, calls } = fakeApp({ connected: true, state });
        runEscPause.call(app, pauseEl);
        assert.equal(game.state, state, `${state} keeps running for everyone`);
        assert.equal(pauseEl.hidden, false);
        assert.equal(app._pausedFromState, null);
        assert.deepEqual(calls.map(([name]) => name), ['hideScoreboard', 'unlock', 'clearInput', 'setPlayerTarget']);

        // The host moves on while the overlay is open; Continue must not rewind it.
        game.state = STATES.ROUND_END;
        calls.length = 0;
        resumeFromPauseMenu(pauseEl).call(app);
        assert.equal(pauseEl.hidden, true);
        assert.equal(game.state, STATES.ROUND_END);
        assert.deepEqual(calls, [['lock']]);
    }
});

test('solo Esc pauses; a countdown pause suspends the 3-2-1 and Resume restarts it', () => {
    const playing = fakeApp({ connected: false, state: STATES.PLAYING });
    runEscPause.call(playing.app, playing.pauseEl);
    assert.equal(playing.game.state, STATES.PAUSED);
    assert.equal(playing.app._pausedFromState, STATES.PLAYING);
    assert.ok(!playing.calls.some(([name]) => name === 'suspend'), 'only the countdown suspends');
    resumeFromPauseMenu(playing.pauseEl).call(playing.app);
    assert.equal(playing.game.state, STATES.PLAYING);
    assert.equal(playing.app._pausedFromState, null);
    assert.ok(!playing.calls.some(([name]) => name === 'resume'));

    const countdown = fakeApp({ connected: false, state: STATES.COUNTDOWN });
    runEscPause.call(countdown.app, countdown.pauseEl);
    assert.deepEqual(countdown.calls.slice(0, 2), [['setState', STATES.PAUSED], ['suspend']]);
    countdown.calls.length = 0;
    resumeFromPauseMenu(countdown.pauseEl).call(countdown.app);
    assert.deepEqual(countdown.calls, [['setState', STATES.COUNTDOWN], ['resume'], ['lock']]);
    assert.equal(countdown.pauseEl.hidden, true);
});

test('solo Resume after the state moved on under the menu never rewinds it', () => {
    const { app, game, pauseEl, calls } = fakeApp({ connected: false, state: STATES.COUNTDOWN });
    runEscPause.call(app, pauseEl);
    game.state = STATES.PLAYING; // e.g. a round started by something outside the pause
    calls.length = 0;
    resumeFromPauseMenu(pauseEl).call(app);
    assert.equal(game.state, STATES.PLAYING);
    assert.deepEqual(calls, [['lock']]);
    assert.equal(app._pausedFromState, null);
});

test('solo pause during PLAYING still enters PAUSED and arms the incoming settlement', () => {
    const setState = compileGameMethod('setState', { STATES, RuntimeLog: { auditTransition() {} }, window: {} });
    const { app, game, pauseEl } = fakeApp({ connected: false, state: STATES.PLAYING });
    let armed = 0;
    let cancelled = 0;
    Object.assign(game, {
        setState,
        _clearPlayerThreat() {}, _clearLocalDeflectAttempt() {}, _startMusic() {}, _stopMusic() {},
        armIncomingSettlement() { armed++; return true; },
        cancelIncomingSettlement() { cancelled++; },
    });
    runEscPause.call(app, pauseEl);
    assert.equal(game.state, STATES.PAUSED);
    assert.equal(armed, 1);
    resumeFromPauseMenu(pauseEl).call(app);
    assert.equal(game.state, STATES.PLAYING);
    assert.equal(cancelled, 1);
});

// A fake wall clock drives both the real ui.js countdown chain and the real
// Game countdown methods.
function countdownHarness() {
    let now = 0;
    let timers = [];
    const setTimeout = (fn, ms = 0) => { timers.push({ at: now + ms, fn }); return timers.length; };
    const advance = ms => {
        const end = now + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            const next = timers[0];
            if (!next || next.at > end) break;
            timers = timers.slice(1);
            now = next.at;
            next.fn();
        }
        now = end;
    };
    const countdownEl = { textContent: '', classList: { add() {}, remove() {}, contains: () => false } };
    const document = { getElementById: id => (id === 'countdown' ? countdownEl : null) };
    const uiGlobals = { document, setTimeout };
    const uiShow = compileMethod('js/ui.js', 'showCountdown', uiGlobals);
    const uiGo = compileMethod('js/ui.js', 'showCountdownGo', uiGlobals);
    const uiCancel = compileMethod('js/ui.js', 'cancelCountdown', uiGlobals);
    const ui = {
        _countdownToken: 0,
        shows: [],
        cancels: 0,
        showCountdownGo: uiGo,
        showCountdown(num, callback, token) {
            if (token === undefined) this.shows.push([num, callback]);
            return token === undefined ? uiShow.call(this, num, callback) : uiShow.call(this, num, callback, token);
        },
        cancelCountdown() { this.cancels++; return uiCancel.call(this); },
    };
    const performance = { now: () => now };
    const game = {
        state: STATES.COUNTDOWN,
        preGameDuration: 3,
        _preGameActive: true,
        ui,
        goes: 0,
        beeps: 0,
        audio: { playBeep: () => { game.beeps++; } },
        suspendPreGameCountdown: compileGameMethod('suspendPreGameCountdown', { performance }),
        resumePreGameCountdown: compileGameMethod('resumePreGameCountdown', { performance }),
        _schedulePreGameBeeps: compileGameMethod('_schedulePreGameBeeps', { setTimeout, STATES }),
        cancelPreGame: compileGameMethod('cancelPreGame'),
    };
    // What startGame's local countdown path does.
    const go = () => { game.goes++; game._preGameActive = false; game.state = STATES.PLAYING; };
    game._preGameGo = go;
    game._preGameCountdownStartedAt = performance.now();
    game._preGameCountdownLength = game.preGameDuration;
    ui.showCountdown(game.preGameDuration, go);
    game._schedulePreGameBeeps(game.preGameDuration);
    return { game, ui, go, advance };
}

test('suspend 0.5 s into a 3 s countdown cancels it once, GO never fires while paused, resume restarts 3-2-1', () => {
    const { game, ui, go, advance } = countdownHarness();
    advance(500);
    assert.equal(game.beeps, 1, 'the "3" beep played');
    game.state = STATES.PAUSED;
    assert.equal(game.suspendPreGameCountdown(), true);
    assert.equal(ui.cancels, 1);
    assert.equal(game._preGameRemaining, 3);
    assert.equal(game.suspendPreGameCountdown(), false, 'a second suspend is a no-op');
    assert.equal(ui.cancels, 1);

    advance(10_000);
    assert.equal(game.goes, 0, 'GO (startRound) never runs under the pause menu');
    assert.equal(game.state, STATES.PAUSED);
    assert.equal(game.beeps, 1, 'no countdown beeps under the pause menu');

    game.state = STATES.COUNTDOWN;
    ui.shows.length = 0;
    assert.equal(game.resumePreGameCountdown(), true);
    assert.deepEqual(ui.shows, [[3, go]], 'resume restarts showCountdown with the same GO callback');
    assert.equal(game.resumePreGameCountdown(), false, 'a second resume is a no-op');
    assert.equal(ui.shows.length, 1);

    advance(2_999);
    assert.equal(game.goes, 0);
    advance(1);
    assert.equal(game.goes, 1, 'the round starts exactly once');
    assert.equal(game.state, STATES.PLAYING);
    assert.equal(game.beeps, 4, 'the resumed 3-2-1 beeps once per second');
    advance(10_000);
    assert.equal(game.goes, 1);
    assert.equal(game.suspendPreGameCountdown(), false, 'nothing to suspend after GO');
});

test('a short pause does not double the beeps, and a second pause keeps the remaining whole seconds', () => {
    const { game, advance } = countdownHarness();
    advance(1_200);
    assert.equal(game.beeps, 2);
    game.state = STATES.PAUSED;
    game.suspendPreGameCountdown();
    assert.equal(game._preGameRemaining, 2);
    advance(100);
    game.state = STATES.COUNTDOWN;
    game.resumePreGameCountdown();
    advance(600);
    game.state = STATES.PAUSED;
    game.suspendPreGameCountdown();
    assert.equal(game._preGameRemaining, 2, 'ceil(2 - 0.6) whole seconds');
    advance(5_000);
    game.state = STATES.COUNTDOWN;
    game.resumePreGameCountdown();
    advance(2_000);
    assert.equal(game.goes, 1);
    // 3, 2 before the first pause; 2 after the first resume; 2, 1 after the second.
    assert.equal(game.beeps, 5);
});

test('quitting from the pause menu drops the suspended countdown', () => {
    const { game, ui, advance } = countdownHarness();
    advance(500);
    game.state = STATES.PAUSED;
    game.suspendPreGameCountdown();
    Object.assign(game, { ball: { _warmup: true }, hideMatchIntro() {} });
    ui.hideMatchIntro = () => {};
    game.cancelPreGame();
    assert.equal(game._preGameSuspended, false);
    assert.equal(game._preGameGo, null);
    assert.equal(game.resumePreGameCountdown(), false);
    advance(10_000);
    assert.equal(game.goes, 0);
});

test('startGame keeps its GO callback and clock on the instance and schedules gated beeps', () => {
    const countdownStart = gameSource.indexOf('// Pre-game countdown (configurable');
    const block = gameSource.slice(countdownStart, gameSource.indexOf('this._notifyCountdownReady();', countdownStart));
    assert.match(block, /const wrap = \(fn\) => \(this\._preGameGo = \(\) => \{ if \(!cancelled\) fn\(\); \}\);/);
    assert.match(block, /this\._preGameCountdownStartedAt = performance\.now\(\);\s*this\._preGameCountdownLength = this\.preGameDuration;/);
    assert.match(block, /this\._schedulePreGameBeeps\(this\.preGameDuration\);/);
    assert.doesNotMatch(block, /playBeep/);
    assert.match(gameSource, /this\.state !== STATES\.PAUSED\) this\.audio\.playBeep\(440\);/);
});
