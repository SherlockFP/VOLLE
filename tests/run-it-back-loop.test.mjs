// tests/run-it-back-loop.test.mjs — Gauntlet G8: final kill -> report timing
// (solo shortened, multiplayer host untouched), skip / peek, Enter/R rematch keys,
// solo rematch keeps the map, the level-up moment, the toast queue, the personal
// strip, match-wide rally and the daily nudge. Game/UI/main methods are compiled
// out of the shipped source (tests/method-source.mjs) and run against stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMethod, extractMethod, fakeElement, readSource } from './method-source.mjs';
import {
    CELEBRATION_SKIP_KEYS,
    FINAL_ROUND_END_SECONDS,
    LEVEL_STAMP_VISIBLE_MS,
    MULTIPLAYER_POSTGAME_PEEK_FROM_SECONDS,
    SOLO_CELEBRATION_SECONDS,
    SOLO_CELEBRATION_SKIP_FROM_SECONDS,
    TOAST_QUEUE_MAX,
    TOAST_QUEUE_MIN_MS,
    celebrationSkipAction,
    comparePersonalBests,
    roundEndOutcome,
    shouldEndFinalRoundEarly
} from '../js/run-it-back.js';
import { shouldEndOvertime, shouldStartOvertime } from '../js/competitive-service.js';
import { nearestDailyNudge } from '../js/daily.js';
import { matchXp, MATCH_XP } from '../js/prestige.js';
import { LOCALES } from '../js/i18n.js';

const STATES = {
    MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN', PLAYING: 'PLAYING', ROUND_END: 'ROUND_END',
    GAME_OVER: 'GAME_OVER', CELEBRATION: 'CELEBRATION', PAUSED: 'PAUSED', SOCIAL_HUB: 'SOCIAL_HUB'
};
const CELEBRATION_DURATION_SECONDS = 8;
const FRAME = 1 / 60;

// ---- A frame-stepped Game built from the shipped update/setState/endGame/... ----

function buildLoopGame({ connected = false, isHost = false } = {}) {
    const clock = { now: 0 };
    const timeouts = [];
    const globals = {
        STATES,
        CELEBRATION_DURATION_SECONDS,
        SOLO_CELEBRATION_SECONDS,
        celebrationSkipAction,
        roundEndOutcome,
        shouldEndFinalRoundEarly,
        shouldEndOvertime,
        shouldStartOvertime,
        t: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key,
        RuntimeLog: { auditTransition() {} },
        window: {},
        document: { getElementById: () => null, body: null, hidden: false },
        performance: { now: () => clock.now * 1000 },
        setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
        clearTimeout() {},
        THREE: {}
    };
    const methods = ['update', 'setState', 'endGame', '_onCelebrationEnd', '_openPostGameReport',
        'skipCelebration', '_openPostGameEarly', '_roundEndOutcome', 'getMatchBestRally'];
    const game = {};
    for (const name of methods) game[name] = compileMethod('js/game.js', name, globals);

    // The final kill's juice: slow-mo at 0.25 for ~0.95 s, easing back — the
    // stretch that made the old hand-off 12.7 s. Hit-stop is FX-only since the
    // ball-feel fix (js/juice.js never returns 0), so it is not modelled here.
    let juiceT = 0;
    const juice = {
        update(dt) {
            juiceT += dt;
            if (juiceT <= 0.95) return dt * 0.25;
            return dt * Math.min(1, 0.25 + (juiceT - 0.95) * 1.5);
        }
    };
    const shown = [];
    const broadcasts = [];
    Object.assign(game, {
        state: STATES.PLAYING,
        network: { connected, isHost, broadcast: packet => broadcasts.push({ at: clock.now, packet }) },
        juice,
        _timeScale: 1,
        _updateKnockouts() {}, // G6 knockout presentation (cosmetic, raw dt)
        _roundEndElapsed: 0,
        _celebrationElapsed: 0,
        _postGameOpenedEarly: false,
        _matchBestRally: 0,
        rallyCount: 0,
        roundRestartDelay: 4,
        roundRestartTimer: 0,
        _overtimeExtends: 0,
        _goalRush: false,
        _ffa: false,
        matchId: 'match-g8',
        localCosmeticEntity: null,
        player: {
            camera: null, team: 'red', totalDamageDealt: 50, attacking: false,
            respawn() {}, unlock() {}, setHandTemporarilyVisible() {}, armGroup: { visible: true }
        },
        bots: [],
        remotePlayers: new Map(),
        ball: { deactivate() {} },
        audio: { playSfx() {}, playScore() {}, playCue() {} },
        ui: {
            showMessage() {}, hideMessage() {}, setPlayerTarget() {},
            showPostGame: (...args) => shown.push({ at: clock.now, state: game.state, result: args[6] })
        },
        scoreboard: {
            redScore: 3, blueScore: 1, roundNum: 5, maxRounds: 5, roundHistory: [],
            isTimeUp: () => false, isMaxRounds: () => true,
            getWinner: () => 'RED', getPlayerStats: () => [{ name: 'You', team: 'red', score: 3 }]
        },
        matchAnalytics: { getReport: () => ({}) },
        arena: { update() {} },
        _updateSpectatorLayer() {}, _updateKillConfirm() {}, _updateRockets() {}, _updateOverdrivePresentation() {},
        _updateCelebrationTrophy() {}, updateDeathParticles() {}, updateChatBubbles() {},
        _notifyGameplayEnded() {}, _hideKillcam() { game.killcamHiddenAt = clock.now; },
        clearBlackHoles() {}, clearSplitBalls() {}, _clearRockets() {}, _showCelebrationBanner() {},
        _maybeSpawnCelebrationTrophy() {}, _hideCelebrationBanner() {}, _teardownCelebrationTrophy() {},
        _startMapVoting() {}, _clearPlayerThreat() {}, _clearLocalDeflectAttempt() {},
        _startMusic() {}, _stopMusic() {}, _roundEndStatusText: () => 'Match complete',
        _setCelebrationGloveColor() {}, _buildCelebWeapons() {}, _showCelebWeapon() {},
        onMatchComplete: () => ({ prevAccount: { level: 3, xp: 10, prestige: 0 }, personal: null })
    });
    return {
        game, clock, shown, broadcasts,
        step(dt = FRAME) { clock.now += dt; game.update(dt); }
    };
}

function finalKill(loop) {
    // _doApplyHit on the deciding elimination: ROUND_END with the full restart delay.
    loop.game.setState(STATES.ROUND_END);
    loop.game.roundRestartTimer = loop.game.roundRestartDelay;
}

function runUntil(loop, predicate, limit = 30) {
    while (!predicate() && loop.clock.now < limit) loop.step();
    return loop.clock.now;
}

test('run-it-back timing constants match the card', () => {
    assert.equal(FINAL_ROUND_END_SECONDS, 1.5);
    assert.equal(SOLO_CELEBRATION_SECONDS, 4.0);
    assert.equal(SOLO_CELEBRATION_SKIP_FROM_SECONDS, 1.0);
    assert.equal(MULTIPLAYER_POSTGAME_PEEK_FROM_SECONDS, 2.0);
    assert.deepEqual([...CELEBRATION_SKIP_KEYS], ['Space', 'KeyE']);
    assert.equal(celebrationSkipAction({ solo: true, elapsed: 0.99 }), null);
    assert.equal(celebrationSkipAction({ solo: true, elapsed: 1.0 }), 'skip');
    assert.equal(celebrationSkipAction({ solo: false, elapsed: 1.99 }), null);
    assert.equal(celebrationSkipAction({ solo: false, elapsed: 2.0 }), 'peek');
    assert.equal(celebrationSkipAction({ solo: false, elapsed: 5, postGameOpen: true }), null);
    assert.equal(shouldEndFinalRoundEarly({ solo: false, elapsed: 9, outcome: 'end' }), false);
    assert.equal(shouldEndFinalRoundEarly({ solo: true, elapsed: 1.5, outcome: 'next' }), false);
    assert.equal(shouldEndFinalRoundEarly({ solo: true, elapsed: 1.5, outcome: 'end' }), true);
    assert.equal(roundEndOutcome({ regulationComplete: true, overtimeWanted: true, overtimeExtends: 0 }), 'overtime');
    assert.equal(roundEndOutcome({ regulationComplete: true, overtimeWanted: true, overtimeExtends: 8 }), 'end');
    assert.equal(roundEndOutcome({ overtimeExtends: 2, overtimeComplete: true }), 'end');
    assert.equal(roundEndOutcome({ goalComplete: true }), 'end');
    assert.equal(roundEndOutcome({}), 'next');
});

test('solo final kill: report is interactive within 6.0 s with no input (killcam cleared at endGame)', () => {
    const loop = buildLoopGame();
    finalKill(loop);
    const celebrationAt = runUntil(loop, () => loop.game.state === STATES.CELEBRATION);
    assert.ok(celebrationAt >= FINAL_ROUND_END_SECONDS && celebrationAt < FINAL_ROUND_END_SECONDS + 2 * FRAME,
        `final round hands off at 1.5 s wall-clock despite hit-stop + slow-mo (got ${celebrationAt.toFixed(3)} s)`);
    assert.equal(loop.game.killcamHiddenAt, celebrationAt, 'endGame hides the killcam in the same frame');
    const reportAt = runUntil(loop, () => loop.shown.length > 0);
    assert.equal(loop.game.state, STATES.GAME_OVER);
    assert.ok(reportAt <= 6.0, `no-input hand-off ${reportAt.toFixed(3)} s must be <= 6.0 s`);
    assert.ok(reportAt >= FINAL_ROUND_END_SECONDS + SOLO_CELEBRATION_SECONDS - FRAME, 'the lap still plays its 4 s');
    assert.equal(loop.shown.length, 1);
    assert.deepEqual(loop.shown[0].result.prevAccount, { level: 3, xp: 10, prestige: 0 },
        'the pre-grant account from onMatchComplete reaches showPostGame');
});

test('solo skip at 1.0 s into the lap opens the report within 2.6 s of the final kill', () => {
    const loop = buildLoopGame();
    finalKill(loop);
    runUntil(loop, () => loop.game.state === STATES.CELEBRATION);
    const lapStart = loop.clock.now;
    assert.equal(loop.game.skipCelebration(), false, 'no skip before 1.0 s');
    runUntil(loop, () => loop.game._celebrationElapsed >= SOLO_CELEBRATION_SKIP_FROM_SECONDS);
    assert.ok(loop.clock.now - lapStart <= 1.0 + 2 * FRAME);
    assert.equal(loop.game.skipCelebration(), true);
    assert.equal(loop.game.state, STATES.GAME_OVER);
    assert.equal(loop.shown.length, 1);
    assert.ok(loop.shown[0].at <= 2.6, `skip hand-off ${loop.shown[0].at.toFixed(3)} s must be <= 2.6 s`);
});

// Independent model of the host clock BEFORE G8: a 4 s ROUND_END restart
// delay, then an 8 s lap. Since the ball-feel fix (merge f563de7) hit-stop and
// slow-mo are presentation-only in connected matches, so the host sim — and
// this clock — run on raw dt.
function expectedHostTimeline() {
    const effective = dt => dt;
    let now = 0;
    let restart = 4;
    let endGameAt = null;
    while (endGameAt === null) {
        now += FRAME;
        const e = effective(FRAME);
        if (e === 0) continue;
        restart -= e;
        if (restart <= 0) endGameAt = now;
    }
    let celebration = 8;
    let gameOverAt = null;
    while (gameOverAt === null) {
        now += FRAME;
        celebration -= effective(FRAME) || FRAME;
        if (celebration <= 0) gameOverAt = now;
    }
    return { endGameAt, gameOverAt };
}

test('multiplayer host round-end and 8 s lap are bit-identical to the pre-G8 clock', () => {
    const expected = expectedHostTimeline();
    const loop = buildLoopGame({ connected: true, isHost: true });
    finalKill(loop);
    const endGameAt = runUntil(loop, () => loop.game.state === STATES.CELEBRATION);
    assert.equal(endGameAt, expected.endGameAt, 'host ROUND_END keeps the 4 s effective-dt restart delay');
    const start = loop.broadcasts.find(entry => entry.packet.type === 'celebrationStart');
    assert.equal(start.packet.duration, CELEBRATION_DURATION_SECONDS);
    const gameOverAt = runUntil(loop, () => loop.game.state === STATES.GAME_OVER);
    assert.equal(gameOverAt, expected.gameOverAt, 'host lap keeps its 8 s timer');
    assert.equal(loop.broadcasts.filter(entry => entry.packet.type === 'gameOver').length, 1);
    assert.ok(expected.gameOverAt > 12, `host path still ~${expected.gameOverAt.toFixed(1)} s (unchanged by design)`);
});

test('multiplayer peek at 2.0 s opens this player’s report without touching host state or timers', () => {
    const expected = expectedHostTimeline();
    const loop = buildLoopGame({ connected: true, isHost: true });
    finalKill(loop);
    runUntil(loop, () => loop.game.state === STATES.CELEBRATION);
    runUntil(loop, () => loop.game._celebrationElapsed >= 1.9);
    assert.equal(loop.game.skipCelebration(), false, 'no peek before 2.0 s');
    runUntil(loop, () => loop.game._celebrationElapsed >= MULTIPLAYER_POSTGAME_PEEK_FROM_SECONDS);
    const timerBefore = loop.game._celebrationTimer;
    assert.equal(loop.game.skipCelebration(), true);
    assert.equal(loop.game.state, STATES.CELEBRATION, 'host stays in CELEBRATION');
    assert.equal(loop.game._celebrationTimer, timerBefore, 'peek does not touch the lap timer');
    assert.equal(loop.shown.length, 1, 'report painted once for this player');
    assert.equal(loop.broadcasts.filter(entry => entry.packet.type === 'gameOver').length, 0);
    const gameOverAt = runUntil(loop, () => loop.game.state === STATES.GAME_OVER);
    assert.equal(gameOverAt, expected.gameOverAt, 'gameOver still fires on the unchanged 8 s boundary');
    assert.equal(loop.broadcasts.filter(entry => entry.packet.type === 'gameOver').length, 1);
    assert.equal(loop.shown.length, 1, 'the open report is not re-painted (rewards settle once)');
});

test('client gameOver keeps a report the player already opened over the lap', () => {
    const src = extractMethod('js/game.js', 'applyGameOver');
    assert.match(src, /if \(!this\._postGameOpenedEarly\) \{\s*const completion = this\.onMatchComplete\?\.\(\) \|\| null;/);
    assert.match(src, /this\.onGameOverState\?\.\(\);/);
});

// ---- Rematch keys, chat keys, map ----------------------------------------

function rematchKeyFixture({ focus = 'rematch', disabled = false } = {}) {
    const screen = fakeElement('post-game-screen');
    const rematch = fakeElement('pg-play-again');
    const nextMap = fakeElement('pg-next-map');
    rematch.disabled = disabled;
    nextMap.matches = selector => selector.includes('button');
    screen.contains = node => node === rematch || node === nextMap;
    const trace = [];
    rematch.onclick = () => trace.push('rematch');
    const document = {
        body: { id: 'body' },
        activeElement: null,
        getElementById: id => ({ 'post-game-screen': screen, 'pg-play-again': rematch })[id] || null
    };
    document.activeElement = focus === 'rematch' ? rematch : focus === 'next' ? nextMap : document.body;
    const handle = compileMethod('js/main.js', '_handlePostGameRematchKey', { STATES, document });
    const app = { game: { state: STATES.GAME_OVER } };
    const key = code => {
        const event = { code, repeat: false, prevented: false, stopped: false,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
        return { handled: handle.call(app, event), event };
    };
    return { app, key, trace, rematch };
}

test('GAME_OVER: Enter and R press the focused Rematch synchronously (same frame)', () => {
    for (const code of ['Enter', 'KeyR']) {
        const { key, trace } = rematchKeyFixture();
        const { handled, event } = key(code);
        assert.equal(handled, true);
        assert.deepEqual(trace, ['rematch'], `${code} dispatches the Rematch click in the keydown`);
        assert.equal(event.prevented, true, `${code} never also opens chat or double-activates`);
    }
    const onNext = rematchKeyFixture({ focus: 'next' });
    assert.equal(onNext.key('Enter').handled, false, 'Enter on a focused Next map keeps its native click');
    assert.equal(onNext.key('KeyR').handled, true, 'R always means Rematch');
    assert.deepEqual(onNext.trace, ['rematch']);
    const disabled = rematchKeyFixture({ disabled: true });
    assert.equal(disabled.key('Enter').handled, true);
    assert.deepEqual(disabled.trace, [], 'a disabled Rematch (vote sent / lap running) is not clicked');
    const playing = rematchKeyFixture();
    playing.app.game.state = STATES.PLAYING;
    assert.equal(playing.key('KeyR').handled, false, 'R keeps its in-match meaning outside GAME_OVER');
});

test('GAME_OVER chat opens on T or Y only; Enter belongs to Rematch', () => {
    const main = readSource('js/main.js');
    const guard = main.indexOf('if (this._handlePostGameRematchKey(e)) return;');
    const chat = main.indexOf("(e.code === 'Enter' && this.game.state !== STATES.GAME_OVER)");
    assert.ok(guard > 0 && chat > guard, 'the rematch key runs before the chat opener');
    assert.match(main, /if \(\(e\.code === 'KeyY' \|\| e\.code === 'KeyT' \|\| \(e\.code === 'Enter' && this\.game\.state !== STATES\.GAME_OVER\)\) &&/);
    assert.match(main, /this\.game\.state === STATES\.CELEBRATION && CELEBRATION_SKIP_KEYS\.includes\(e\.code\)\s*&& !e\.repeat && this\.game\.skipCelebration\?\.\(\)/);
    assert.match(main, /document\.addEventListener\('mousedown', e => \{\s*if \(this\.game\.state !== STATES\.CELEBRATION \|\| e\.button !== 0\) return;/);
});

test('T/Y on the report focus the after-match chat, opening its Match details disclosure', () => {
    const details = { open: false };
    const input = fakeElement('pg-chat-input');
    input.closest = selector => selector === 'details' ? details : null;
    const openChat = compileMethod('js/main.js', 'openChat', {
        STATES,
        document: { getElementById: id => id === 'pg-chat-input' ? input : null }
    });
    const app = { game: { state: STATES.GAME_OVER }, ui: { hideScoreboard() {}, _openExclusive() {} }, closeChat() {} };
    openChat.call(app);
    assert.equal(details.open, true, 'the chat is inside the closed disclosure; it must open');
    assert.equal(input.focused, 1);
});

test('solo Rematch keeps the map; Next map rotates to a different rotation map', () => {
    const startMapVoting = compileMethod('js/game.js', '_startMapVoting', {
        Arena: { MAPS: { a: {}, b: {}, c: {}, secret: { hiddenFromRotation: true } } },
        Math, t: key => key
    });
    const rebuilt = [];
    const game = {
        _mapVoteActive: false, _mapVotes: new Map(), network: { connected: false },
        arena: { mapId: 'a', rebuild(id) { rebuilt.push(id); this.mapId = id; } },
        player: { respawn() {} }, bots: [], ui: { showMessage() {}, showMapVoting() {} },
        onMapChange() { throw Error('solo rematch must not change map'); }
    };
    startMapVoting.call(game);
    assert.equal(game.arena.mapId, 'a', 'solo map id unchanged after the report opens');
    assert.deepEqual(rebuilt, []);
    assert.equal(game._mapVoteActive, false);

    const rotate = compileMethod('js/game.js', 'rotateSoloMap', {
        Arena: { MAPS: { a: {}, b: {}, c: {}, secret: { hiddenFromRotation: true } } },
        Math, normalizeRallyDuelMap: id => id
    });
    const changes = [];
    Object.assign(game, { bannedMaps: new Set(['c']), onMapChange: id => changes.push(id) });
    assert.equal(rotate.call(game), 'b', 'next map skips the current, banned and hidden maps');
    assert.deepEqual(changes, ['b']);
    game.network.connected = true;
    assert.equal(rotate.call(game), null, 'multiplayer map voting is unchanged');

    const main = readSource('js/main.js');
    assert.match(main, /action === 'next_map'[\s\S]*?this\.game\.rotateSoloMap\?\.\(\);\s*this\._requestRematch\(\);/);
    const html = readSource('index.html');
    const hero = html.slice(html.indexOf('<section class="pg-rematch-hero"'), html.indexOf('<section class="pg-detail-report"'));
    assert.ok(hero.indexOf('id="pg-play-again"') < hero.indexOf('id="pg-next-map"'), 'Next map is secondary to Rematch');
    assert.match(hero, /id="pg-next-map" class="btn btn-secondary btn-small"[^>]*data-i18n="postgame\.nextMap"/);
});

// ---- Level-up moment -----------------------------------------------------

function postGameDom() {
    const els = new Map();
    const get = id => {
        if (!els.has(id)) els.set(id, fakeElement(id));
        return els.get(id);
    };
    const pgLevel = fakeElement('pg-level-pill');
    get('pg-levelup-stamp').closest = () => pgLevel;
    get('pg-levelup-stamp').hidden = true;
    return { get, els, pgLevel, document: { getElementById: get, querySelector: () => null, documentElement: fakeElement('html'), body: fakeElement('body') } };
}

test('level-up fixture: pre-grant snapshot -> leveledUp, pg-xp-levelup, LEVEL N stamp >= 1.5 s', () => {
    const dom = postGameDom();
    const timers = [];
    const globals = {
        document: dom.document,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        requestAnimationFrame: () => 0,
        performance: { now: () => 0 },
        accountRankLabel: account => `Lv ${account.level}`,
        levelProgress: account => ({ level: account.level, xp: account.xp, need: 100, ratio: account.xp / 100 }),
        setText() {},
        t: (key, params) => key === 'postgame.levelStamp' ? `LEVEL ${params.level}` : key,
        LEVEL_STAMP_VISIBLE_MS,
        Store: null,
        window: {}
    };
    const ui = {};
    for (const name of ['showPostGame', 'setPostGameRewardReceipt', '_paintXpBarFill', '_showLevelStamp', '_hideLevelStamp']) {
        ui[name] = compileMethod('js/ui.js', name, globals);
    }
    Object.assign(ui, {
        hideHUD() {}, hideMessage() {}, _paintPrestigeBadge() {}, _buildAARTable: () => '', _renderMvpCard() {},
        _renderPersonalStrip() {}, setPostGameDailyNudge() {}, _animateCount() {}, _renderMatchRewardBreakdown() {},
        _renderRewardFlow() {}, renderMatchAnalysis() {}, _renderRoundStrip() {}, _renderPostGameBattlepass() {},
        _renderPostGameRewardCard() {}, _isReducedMotion: () => false
    });
    // store.grant() already ran (awardMatchRewards): the live account is level 4.
    const store = { getAccount: () => ({ level: 4, xp: 20, prestige: 0 }) };
    ui.showPostGame(true, 0, 1, 0, 0, null, {
        matchId: 'm1', rewardsPending: true, prevAccount: { level: 3, xp: 90, prestige: 0 }
    }, store);
    assert.equal(ui._postGameStartLevel, 3, 'report snapshots the pre-grant level');
    assert.equal(dom.get('pg-level').textContent, 'Lv 3', 'rank opens on the level the match started at');
    const painted = ui.setPostGameRewardReceipt('m1', { xp: 120 }, store);
    assert.equal(painted, true);
    const fill = dom.get('pg-xp-fill');
    assert.equal(fill.classList.contains('pg-xp-levelup'), true, 'pg-xp-levelup applied (leveledUp === true)');
    assert.equal(fill.style.width, '100%', 'bar sweeps to full before rolling over');
    const stamp = dom.get('pg-levelup-stamp');
    assert.equal(stamp.hidden, true, 'stamp waits for the rollover');
    const safety = timers.find(timer => timer.ms === 1700);
    safety.fn(); // transitionend suppressed (hidden tab): the safety net rolls over
    assert.equal(fill.style.width, '20%', 'rolled over onto the new level progress');
    assert.equal(stamp.hidden, false);
    assert.equal(stamp.textContent, 'LEVEL 4');
    assert.equal(stamp.classList.contains('is-stamping'), true);
    const hide = timers.find(timer => timer.ms === LEVEL_STAMP_VISIBLE_MS);
    assert.ok(hide && hide.ms >= 1500, 'stamp stays visible at least 1.5 s');
    hide.fn();
    assert.equal(stamp.hidden, true);

    // Unchanged level: no flash, no stamp.
    const dom2 = postGameDom();
    globals.document = dom2.document;
    const ui2 = { ...ui };
    for (const name of ['showPostGame', 'setPostGameRewardReceipt', '_paintXpBarFill', '_showLevelStamp', '_hideLevelStamp']) {
        ui2[name] = compileMethod('js/ui.js', name, globals);
    }
    const same = { getAccount: () => ({ level: 3, xp: 95, prestige: 0 }) };
    ui2.showPostGame(true, 0, 1, 0, 0, null, { matchId: 'm2', rewardsPending: true, prevAccount: { level: 3, xp: 90, prestige: 0 } }, same);
    ui2.setPostGameRewardReceipt('m2', { xp: 5 }, same);
    assert.equal(dom2.get('pg-xp-fill').classList.contains('pg-xp-levelup'), false);
    assert.equal(dom2.get('pg-levelup-stamp').hidden, true);
});

test('main snapshots the account before store.grant and hands it to the report', () => {
    const main = readSource('js/main.js');
    const hook = main.slice(main.indexOf('this.game.onMatchComplete = () => {'), main.indexOf('this.game.onRoundEnd ='));
    assert.ok(hook.indexOf('const prevAccount = this.store.getAccount?.() || null;') < hook.indexOf('this.awardMatchRewards();'),
        'prevAccount is captured before awardMatchRewards() runs store.grant()');
    assert.match(hook, /return \{\s*prevAccount: prevAccount \?/);
    const report = extractMethod('js/game.js', '_openPostGameReport');
    assert.match(report, /const completion = this\.onMatchComplete\?\.\(\) \|\| null;/);
    assert.match(report, /prevAccount: completion\?\.prevAccount \|\| null,/);
});

// ---- Toast queue ---------------------------------------------------------

function toastFixture() {
    const timers = [];
    const shown = [];
    const globals = {
        TOAST_QUEUE_MAX, TOAST_QUEUE_MIN_MS, TOAST_QUEUE_PRIORITY: 3,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {}
    };
    const ui = {
        showMessage: (text, duration, options) => { shown.push({ text, duration, priority: options?.priority }); return true; },
        hideMessage() {}
    };
    for (const name of ['queueToast', '_pumpToastQueue', 'clearToastQueue']) ui[name] = compileMethod('js/ui.js', name, globals);
    return { ui, timers, shown };
}

test('toast queue: three toasts show in order, sequentially, each >= 1.2 s; max 4', () => {
    const { ui, timers, shown } = toastFixture();
    assert.equal(ui.queueToast('Level Up! Lv 4', 2200), true);
    assert.equal(ui.queueToast('Achievement: Rally Master', 500), true);
    assert.equal(ui.queueToast('+120 coins, +140 XP'), true);
    assert.deepEqual(shown.map(item => item.text), ['Level Up! Lv 4'], 'only the first is on screen');
    timers.shift().fn();
    assert.deepEqual(shown.map(item => item.text), ['Level Up! Lv 4', 'Achievement: Rally Master']);
    assert.equal(shown[1].duration, TOAST_QUEUE_MIN_MS, 'short toasts are held for 1.2 s');
    timers.shift().fn();
    assert.deepEqual(shown.map(item => item.text), ['Level Up! Lv 4', 'Achievement: Rally Master', '+120 coins, +140 XP']);
    assert.ok(shown.every(item => item.duration >= 1200 && item.priority === 3));
    timers.shift().fn();
    assert.equal(ui._toastActive, false);

    const capped = toastFixture();
    const accepted = ['a', 'b', 'c', 'd', 'e'].map(text => capped.ui.queueToast(text));
    assert.deepEqual(accepted, [true, true, true, true, false], 'at most 4 toasts in flight');
    capped.ui.clearToastQueue();
    assert.equal(capped.ui._toastQueue.length, 0);

    const main = readSource('js/main.js');
    const reward = main.slice(main.indexOf('    async awardMatchRewards() {'), main.indexOf('    _startDeferredMatchRewardRetry('));
    assert.doesNotMatch(reward, /this\.ui\.showMessage\?\.\(t\('toast\.(levelUp|achievement|mastery|matchDrop|rewardsSummary)'/,
        'post-match toasts no longer overwrite each other');
    assert.ok(reward.indexOf("t('toast.levelUp'") < reward.indexOf("t('toast.achievement'"), 'the rank moment leads the queue');
});

// ---- Personal strip ------------------------------------------------------

function stripFixture() {
    const cells = ['deflects', 'perfects', 'topSpeed', 'bestRally', 'kos'].map(stat => {
        const cell = fakeElement(`cell-${stat}`);
        cell.dataset.stat = stat;
        const value = fakeElement();
        const best = fakeElement();
        cell.querySelector = selector => selector === '.pg-personal-value' ? value : selector === '.pg-personal-best' ? best : null;
        return { stat, cell, value, best };
    });
    const wrap = fakeElement('pg-personal');
    wrap.querySelectorAll = () => cells.map(entry => entry.cell);
    const render = compileMethod('js/ui.js', '_renderPersonalStrip', {
        document: { getElementById: id => id === 'pg-personal' ? wrap : null },
        t: (key, params) => key === 'postgame.newBest' ? 'NEW BEST' : `Best ${params.value}`
    });
    return { wrap, cells, render };
}

test('personal strip: beaten records read NEW BEST, unbeaten ones do not', () => {
    const result = comparePersonalBests(
        { deflects: 14, perfects: 2, topSpeed: 2.43, bestRally: 7, kos: 3 },
        { deflects: 20, perfects: 1, topSpeed: 2.4, bestRally: 5, kos: 3 }
    );
    assert.deepEqual(result.beaten, { deflects: false, perfects: true, topSpeed: false, bestRally: true, kos: false });
    assert.equal(result.next.bestRally, 7);
    assert.equal(result.next.deflects, 20, 'an unbeaten record is kept');
    const { wrap, cells, render } = stripFixture();
    render.call({}, { stats: result.stats, previous: result.previous, beaten: result.beaten });
    assert.equal(wrap.hidden, false);
    const by = Object.fromEntries(cells.map(entry => [entry.stat, entry]));
    assert.equal(by.perfects.best.textContent, 'NEW BEST');
    assert.equal(by.perfects.cell.classList.contains('is-new-best'), true);
    assert.equal(by.bestRally.best.textContent, 'NEW BEST');
    assert.equal(by.deflects.best.textContent, 'Best 20');
    assert.equal(by.deflects.cell.classList.contains('is-new-best'), false);
    assert.equal(by.topSpeed.value.textContent, '2.4×');
    assert.notEqual(by.topSpeed.best.textContent, 'NEW BEST', '2.43× rounds to the stored 2.4×');
    assert.notEqual(by.kos.best.textContent, 'NEW BEST', 'tying a record is not a new best');
    render.call({}, null);
    assert.equal(wrap.hidden, true, 'no settled match -> strip hidden');
});

// ---- Rally across the match ----------------------------------------------

test('rounds with rallies 7 then 3 -> match best rally 7 feeds XP, daily, achievements and stats', () => {
    const fold = extractMethod('js/game.js', 'startRound');
    assert.match(fold, /else \{\s*this\._matchBestRally = Math\.max\(this\._matchBestRally \|\| 0, this\.rallyCount \|\| 0\);\s*\}\s*this\.rallyCount = 0;/);
    const getMatchBestRally = compileMethod('js/game.js', 'getMatchBestRally');
    const game = { _matchBestRally: 0, rallyCount: 7, getMatchBestRally };
    // round 2 starts: fold round 1 (7), reset
    game._matchBestRally = Math.max(game._matchBestRally || 0, game.rallyCount || 0);
    game.rallyCount = 3; // final round ends on a 3 rally
    assert.equal(game.getMatchBestRally(), 7);

    const main = readSource('js/main.js');
    const reward = main.slice(main.indexOf('    async awardMatchRewards() {'), main.indexOf('    _startDeferredMatchRewardRetry('));
    assert.match(reward, /const rally = this\.game\.getMatchBestRally\(\);/);
    assert.match(reward, /matchXp\(\{[\s\S]*?rally,/, 'XP input');
    assert.match(reward, /Daily\.progress\(\{[^}]*bestRally: rally/, 'bestRally daily');
    assert.match(reward, /checkAchievements\(this\.store, \{\s*rally,/, 'achievements');
    assert.match(reward, /this\.store\.recordGame\(\{[\s\S]*?rally,/, 'stats.bestRally');
    assert.doesNotMatch(reward, /this\.game\.rallyCount/);
    // XP formula unchanged: the rally term is still perRally * rally.
    const base = { deflections: 4, kills: 1, survived: false, won: true };
    assert.equal(matchXp({ ...base, rally: 7 }) - matchXp({ ...base, rally: 3 }), 4 * MATCH_XP.perRally);
});

// ---- Daily nudge + locales -----------------------------------------------

test('daily nudge names the nearest incomplete daily at >= 50%', () => {
    const challenges = [
        { id: 'win_3', name: 'Win 3 Matches', type: 'wins', target: 3, progress: 2, claimed: false },
        { id: 'deflect_50', name: '50 Deflects', type: 'deflects', target: 50, progress: 30, claimed: false },
        { id: 'play_5', name: 'Play 5 Matches', type: 'games', target: 5, progress: 5, claimed: false }
    ];
    const nudge = nearestDailyNudge(challenges);
    assert.equal(nudge.id, 'win_3');
    assert.equal(nudge.remaining, 1);
    assert.equal(nearestDailyNudge([{ id: 'x', type: 'wins', target: 3, progress: 1 }]), null, 'under 50% stays quiet');
    assert.equal(nearestDailyNudge([{ ...challenges[0], claimed: true }]), null);

    const line = fakeElement('pg-daily-nudge');
    const setNudge = compileMethod('js/ui.js', 'setPostGameDailyNudge', {
        document: { getElementById: id => id === 'pg-daily-nudge' ? line : null },
        DAILY_NUDGE_UNITS: { wins: 'wins' },
        t: (key, params) => {
            if (key === 'postgame.units.wins') return params.count === 1 ? 'win' : 'wins';
            return `${params.count} ${params.unit} from ${params.name}`;
        }
    });
    assert.equal(setNudge.call({ _postGameRewardMatchId: 'm1' }, 'm1', nudge), true);
    assert.equal(line.textContent, '1 win from Win 3 Matches');
    assert.equal(line.hidden, false);
    assert.equal(setNudge.call({ _postGameRewardMatchId: 'm2' }, 'm1', nudge), false, 'stale match ignored');
    setNudge.call({ _postGameRewardMatchId: 'm1' }, 'm1', null);
    assert.equal(line.hidden, true);
});

function leaves(table, prefix = '', out = new Map()) {
    for (const [key, value] of Object.entries(table || {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !('one' in value)) leaves(value, path, out);
        else out.set(path, value);
    }
    return out;
}

test('EN/TR parity for every postgame.* key and its placeholders', () => {
    const en = leaves(LOCALES.en.postgame, 'postgame');
    const tr = leaves(LOCALES.tr.postgame, 'postgame');
    assert.ok(en.size >= 20);
    assert.deepEqual([...tr.keys()].sort(), [...en.keys()].sort());
    const params = value => [...String(typeof value === 'object' ? Object.values(value).join(' ') : value)
        .matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const [key, value] of en) assert.deepEqual(params(tr.get(key)), params(value), key);
    const html = readSource('index.html');
    for (const key of html.matchAll(/data-i18n="(postgame\.[\w.]+)"/g)) assert.ok(en.has(key[1]), key[1]);
});
