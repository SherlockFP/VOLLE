// Ball return after a hit that keeps the round going: 1.5 s of match time, ticked by
// updatePlaying (never a wall-clock setTimeout), pause-safe, and a final kill settled
// under the pause menu ends the round on resume instead of behind the menu.
// Exercises the shipped Game methods extracted from js/game.js (see game-source.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const BALL_RETURN_SECONDS = Number(/^export const BALL_RETURN_SECONDS = ([0-9.]+);/m.exec(source)?.[1]);

// Same values as js/game.js STATES.
const STATES = {
    MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER',
    CELEBRATION: 'CELEBRATION', PAUSED: 'PAUSED', SOCIAL_HUB: 'SOCIAL_HUB',
    COSMETIC_PRACTICE: 'COSMETIC_PRACTICE'
};
const finisherCalls = [];
const globals = {
    STATES,
    BALL_RETURN_SECONDS,
    t: (key, params) => `${key}:${params?.n}`,
    RuntimeLog: { auditTransition() {} },
    window: { shaderFinishers: { playRoundEnd: options => finisherCalls.push(options) } }
};
const respawnBall = compileGameMethod('_respawnBall', globals);
const updateBallReturn = compileGameMethod('_updateBallReturn', globals);
const setState = compileGameMethod('setState', globals);

function fixture({ state = STATES.PLAYING, network = { connected: false, isHost: false } } = {}) {
    const red = { name: 'You', team: 'red', alive: true };
    const blue = { name: 'Bot', team: 'blue', alive: true };
    const messages = [];
    const ball = {
        active: false, state: 'idle', targetPlayer: null, spawns: 0,
        spawn() { this.active = true; this.state = 'idle'; this.targetPlayer = null; this.spawns++; },
        setTarget(target) { this.targetPlayer = target; },
        deactivate() { this.active = false; this.targetPlayer = null; }
    };
    const game = {
        state, network, ball,
        scoreboard: { roundNum: 3 },
        lastDeflector: red, lastDeflectorTeam: 'red',
        affixesApplied: 0, roundEnds: 0,
        _roundEndElapsed: 0, _celebrationElapsed: 0, _postGameOpenedEarly: false,
        ui: { showMessage: text => messages.push(text) },
        getAllTargets: () => [red, blue],
        _applyBallAffix() { this.affixesApplied++; },
        armIncomingSettlement() {}, cancelIncomingSettlement() {},
        _clearPlayerThreat() {}, _clearLocalDeflectAttempt() {},
        _startMusic() {}, _stopMusic() {},
        onRoundEnd() { this.roundEnds++; },
        _respawnBall: respawnBall,
        _updateBallReturn: updateBallReturn,
        setState
    };
    return { game, ball, messages, red, blue };
}

/** Ticks like updatePlaying does and returns the 1-based frame that served, or 0. */
function tick(game, hz, frames) {
    let servedAt = 0;
    for (let frame = 1; frame <= frames; frame++) {
        if (game._ballReturn && game._updateBallReturn(1 / hz)) {
            assert.equal(servedAt, 0, 'the ball must return exactly once');
            servedAt = frame;
        }
    }
    return servedAt;
}

function assertServed(game, ball, red, blue) {
    assert.equal(ball.spawns, 1);
    assert.equal(ball.active, true);
    assert.ok(ball.targetPlayer === red || ball.targetPlayer === blue, 'served at a live player');
    assert.equal(ball.state, 'homing');
    assert.equal(game.lastDeflector, null);
    assert.equal(game.lastDeflectorTeam, null);
    assert.equal(game.affixesApplied, 1);
    assert.equal(game._ballReturn, null);
}

test('the return is 1.5 s of match time: no wall-clock timer, ticked before updatePlaying can return early', () => {
    assert.equal(BALL_RETURN_SECONDS, 1.5);
    const respawn = extractGameMethod('_respawnBall');
    assert.doesNotMatch(respawn, /setTimeout|clearTimeout/);
    assert.doesNotMatch(extractGameMethod('_updateBallReturn'), /setTimeout/);
    assert.doesNotMatch(source, /_respawnTimer/, 'the wall-clock timer handle is gone');

    const playing = extractGameMethod('updatePlaying');
    const tickAt = playing.indexOf('if (this._ballReturn) this._updateBallReturn(dt);');
    assert.ok(tickAt > 0, 'updatePlaying ticks the ball return');
    assert.ok(tickAt < playing.indexOf('this._updateHotPotato(dt)'), 'before the hot-potato early return');
    assert.ok(tickAt < playing.indexOf('this.scoreboard.isTimeUp()'), 'before the time-up early return');
    assert.ok(tickAt < playing.indexOf('if (!this.ball.active) return;'), 'before the no-ball early return');

    for (const name of ['startRound', 'endGame', '_checkGoalRushScore']) {
        assert.match(extractGameMethod(name), /this\._ballReturn = null;/, `${name} clears the return`);
    }
    for (const name of ['startRound', 'endGame']) {
        assert.match(extractGameMethod(name), /this\._pendingRoundEnd = false;/, `${name} clears a deferred round end`);
    }
});

test('armed in PLAYING, the ball returns once at 1.5 s (to the frame) at 30, 60 and 144 Hz', () => {
    for (const hz of [30, 60, 144]) {
        const { game, ball, messages, red, blue } = fixture();
        game._respawnBall();
        assert.equal(game._ballReturn.remaining, 1.5);
        assert.equal(game._ballReturn.round, 3);
        const expected = Math.ceil(1.5 * hz);
        const servedAt = tick(game, hz, expected + hz);
        assert.equal(servedAt, expected, `${hz} Hz served on frame ${servedAt}`);
        assert.ok(Math.abs(servedAt / hz - 1.5) < 1 / hz + 1e-9);
        assertServed(game, ball, red, blue);
        assert.deepEqual(messages, ['match.ballReturns:2', 'match.ballReturns:1'], 'counts 2, 1, once each');
    }
});

test('a pause mid-countdown holds it: only the remaining 1.0 s runs after the resume', () => {
    const { game, ball, messages, red, blue } = fixture();
    game._respawnBall();
    assert.equal(tick(game, 60, 30), 0);
    game.setState(STATES.PAUSED);
    // Any amount of paused wall time, even a stray tick while paused, is not match time.
    for (let second = 0; second < 20; second++) assert.equal(game._updateBallReturn(1), false);
    assert.equal(ball.spawns, 0);
    assert.ok(Math.abs(game._ballReturn.remaining - 1.0) < 1e-9);

    game.setState(STATES.PLAYING);
    messages.length = 0;
    assert.equal(tick(game, 60, 59), 0, 'not before the remaining 1.0 s');
    assert.equal(messages[0], 'match.ballReturns:1', 'the countdown shows again after the resume');
    assert.equal(tick(game, 60, 1), 1);
    assertServed(game, ball, red, blue);
});

test('a hit settled under the pause menu arms the return; the ball is back 1.5 s after the resume', () => {
    const { game, ball, red, blue } = fixture();
    game.setState(STATES.PAUSED);
    game._respawnBall();
    assert.ok(game._ballReturn, 'armed while PAUSED');
    assert.equal(game._ballReturn.remaining, 1.5);
    game.setState(STATES.PLAYING);
    assert.equal(tick(game, 60, 120), 90);
    assertServed(game, ball, red, blue);

    for (const state of [STATES.ROUND_END, STATES.COUNTDOWN, STATES.MENU, STATES.CELEBRATION]) {
        const other = fixture({ state });
        other.game._respawnBall();
        assert.equal(other.game._ballReturn ?? null, null, `no return armed in ${state}`);
    }
});

test('a stale return never serves, a live ball is never served twice, and re-arming keeps one return', () => {
    for (const mutate of [
        game => { game.scoreboard.roundNum++; },
        game => { game.scoreboard = { roundNum: 3 }; },
        game => { game.ball.active = true; game.ball.state = 'homing'; }
    ]) {
        const { game, ball } = fixture();
        game._respawnBall();
        tick(game, 60, 30);
        mutate(game);
        assert.equal(tick(game, 60, 180), 0);
        assert.equal(ball.spawns, 0);
        assert.equal(game._ballReturn, null, 'the stale return is dropped');
    }

    const { game, ball, red, blue } = fixture();
    game._respawnBall();
    tick(game, 60, 30);
    game._respawnBall();
    assert.equal(game._ballReturn.remaining, 1.5, 'a second hit restarts the one return');
    assert.equal(tick(game, 60, 300), 90);
    assertServed(game, ball, red, blue);
});

test('clients never serve; hosts do; malformed dt cannot move the countdown', () => {
    const client = fixture({ network: { connected: true, isHost: false } });
    client.game._respawnBall();
    assert.equal(tick(client.game, 60, 600), 0);
    assert.equal(client.ball.spawns, 0);
    assert.equal(client.ball.active, false);

    const host = fixture({ network: { connected: true, isHost: true } });
    host.game._respawnBall();
    for (const dt of [NaN, Infinity, -1, 0]) assert.equal(host.game._updateBallReturn(dt), false);
    assert.equal(host.game._ballReturn.remaining, 1.5);
    assert.equal(tick(host.game, 60, 120), 90);
    assertServed(host.game, host.ball, host.red, host.blue);
});

test('resuming into ROUND_END or CELEBRATION does not replay their entry effects', () => {
    finisherCalls.length = 0;
    const roundEnd = fixture({ state: STATES.ROUND_END }).game;
    roundEnd._roundEndElapsed = 0.8;
    roundEnd.setState(STATES.PAUSED);
    roundEnd.setState(STATES.ROUND_END);
    assert.equal(roundEnd.state, STATES.ROUND_END);
    assert.equal(roundEnd.roundEnds, 0, 'onRoundEnd is not called again');
    assert.equal(roundEnd._roundEndElapsed, 0.8);
    assert.equal(finisherCalls.length, 0, 'the round-end flourish does not replay');

    const celebration = fixture({ state: STATES.CELEBRATION }).game;
    celebration._celebrationElapsed = 2.5;
    celebration._postGameOpenedEarly = true;
    celebration.setState(STATES.PAUSED);
    celebration.setState(STATES.CELEBRATION);
    assert.equal(celebration._celebrationElapsed, 2.5);
    assert.equal(celebration._postGameOpenedEarly, true);

    // A real entry still runs them: PLAYING -> ROUND_END, and PAUSED -> a state it did not pause from.
    const live = fixture().game;
    live._roundEndElapsed = 9;
    live.setState(STATES.ROUND_END);
    assert.equal(live.roundEnds, 1);
    assert.equal(live._roundEndElapsed, 0);
    assert.equal(finisherCalls.length, 1);
    const fromPlay = fixture().game;
    fromPlay.setState(STATES.PAUSED);
    fromPlay.setState(STATES.ROUND_END);
    assert.equal(fromPlay.roundEnds, 1);
});

test('a final kill settled while paused ends the round once, on resume', () => {
    const { game } = fixture();
    game.setState(STATES.PAUSED);
    game._pendingRoundEnd = true;
    game.roundRestartTimer = 4;
    game._roundEndElapsed = 7;
    game.setState(STATES.PLAYING);
    assert.equal(game.state, STATES.ROUND_END);
    assert.equal(game.roundEnds, 1);
    assert.equal(game._roundEndElapsed, 0);
    assert.equal(game._pendingRoundEnd, false);
    assert.equal(game.roundRestartTimer, 4);

    // A later pause from that round end resumes it without a second onRoundEnd.
    game.setState(STATES.PAUSED);
    game.setState(STATES.ROUND_END);
    assert.equal(game.roundEnds, 1);

    for (const exit of [STATES.MENU, STATES.LOBBY]) {
        const left = fixture().game;
        left.setState(STATES.PAUSED);
        left._pendingRoundEnd = true;
        left.setState(exit);
        assert.equal(left.state, exit);
        assert.equal(left.roundEnds, 0);
        assert.equal(left._pendingRoundEnd, false);
        left.setState(STATES.PLAYING);
        assert.equal(left.state, STATES.PLAYING, 'a dropped round end never resurfaces');
    }
});

// ----- The shipped hit path: _doApplyHit while the pause menu settles the incoming ball -----

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    project() { return this; }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

function hitHarness({ finalKill }) {
    const hitGlobals = {
        ...globals,
        THREE: { Vector3 },
        missRampDamage: base => base, BASE_HIT_DAMAGE: 25,
        calcDamage: damage => damage,
        spawnImpactCosmetic() {}, spawnFinisherCosmetic() {},
        comboTier: () => 0, comboPitchRate: () => 1,
        requestAnimationFrame: callback => callback(),
        document: { getElementById: () => null, body: null },
        setTimeout: () => 0, clearTimeout() {},
        window: { ...globals.window, innerWidth: 1280, innerHeight: 720, __store: null }
    };
    const { game, ball, red, blue } = fixture();
    const player = Object.assign(red, {
        camera: {}, hp: 100, maxHp: 100,
        getPosition: () => new Vector3(0, 1.2, 8),
        recordDamageDealt() {}
    });
    const victim = Object.assign(blue, {
        hp: 100, maxHp: 100, consecutiveMisses: 0, group: {},
        getPosition: () => new Vector3(0, 1.2, -8),
        onMissDeflect() {}, drawHpBar() {}
    });
    Object.assign(ball, { active: true, state: 'homing', targetPlayer: victim, position: new Vector3(0, 1.2, -7.6),
        lastPerfectBy: null, lastShotBy: 'You' });
    Object.assign(game, {
        player, killStreak: 0, _matchKills: 0, roundRestartDelay: 4, roundRestartTimer: 0,
        renderer: { scene: {} },
        _deflectHistory: [], _killStreaks: new Map(), _killStreakTimers: new Map(),
        juice: { combo: 0, getComboMultiplier: () => 1, resetCombo() {}, hitBurst() {}, shockwave() {}, hitStop() {}, flash() {} },
        audio: { playSfx() {}, playHit() {} },
        matchAnalytics: { recordHit() {}, recordKO() {} },
        scoreboard: Object.assign(game.scoreboard, {
            recordHit() {}, recordDamageDealt() {}, recordDamageTaken() {},
            recordPoint() {}, recordDeath() {}, recordAssist() {}
        }),
        ui: Object.assign(game.ui, {
            spawnDamageNumber() {}, showHitMarker() {}, showCombo() {}, updateVitals() {}, flashHit() {}
        }),
        _consumeKillConfirm: () => 1,
        getBodyZone: () => ({ multiplier: 1, label: 'BODY', zone: 'body' }),
        getDamageFalloff: () => 1,
        _applyAuthoritativeHitDamage(target, damage) { target.hp = Math.max(0, target.hp - damage); return target.hp <= 0; },
        _presentFlinch() {}, _presentLethalImpact: () => true, _pushKillFeedRow() {}, _flashKill() {},
        presentKnockout: () => true, announce() {}, announceStreak() {}, _grantKillConfirm() {},
        _checkTeamElimination: () => finalKill,
        _doApplyHit: compileGameMethod('_doApplyHit', hitGlobals)
    });
    return { game, ball, player, victim, red, blue };
}

test('shipped _doApplyHit under the pause menu: a chip hit returns the ball after the resume', () => {
    const { game, ball, player, victim, red, blue } = hitHarness({ finalKill: false });
    game.setState(STATES.PAUSED);
    game._doApplyHit(victim, victim.name, player.name, player, null);
    assert.equal(victim.hp, 75);
    assert.equal(ball.active, false);
    assert.equal(game.state, STATES.PAUSED);
    assert.ok(game._ballReturn, 'the return is armed, not dropped');
    game.setState(STATES.PLAYING);
    assert.equal(tick(game, 60, 120), 90);
    assertServed(game, ball, red, blue);
});

test('shipped _doApplyHit under the pause menu: a non-final kill returns the ball, a final kill waits for the resume', () => {
    const nonFinal = hitHarness({ finalKill: false });
    nonFinal.victim.hp = 25;
    nonFinal.game.setState(STATES.PAUSED);
    nonFinal.game._doApplyHit(nonFinal.victim, nonFinal.victim.name, 'You', nonFinal.player, null);
    assert.equal(nonFinal.victim.alive, false);
    assert.ok(nonFinal.game._ballReturn);
    nonFinal.game.setState(STATES.PLAYING);
    assert.equal(tick(nonFinal.game, 60, 120), 90);
    assert.equal(nonFinal.ball.targetPlayer, nonFinal.red, 'served at the one live player');

    const { game, ball, player, victim } = hitHarness({ finalKill: true });
    victim.hp = 25;
    game.setState(STATES.PAUSED);
    game._doApplyHit(victim, victim.name, 'You', player, null);
    assert.equal(victim.alive, false);
    assert.equal(ball.active, false);
    assert.equal(game.state, STATES.PAUSED, 'no round end behind the pause menu');
    assert.equal(game._pendingRoundEnd, true);
    assert.equal(game.roundRestartTimer, 4);
    assert.equal(game.roundEnds, 0);
    assert.equal(game._ballReturn ?? null, null);
    game.setState(STATES.PLAYING);
    assert.equal(game.state, STATES.ROUND_END);
    assert.equal(game.roundEnds, 1, 'onRoundEnd fires once, at the resume');

    // Unpaused, the final kill still enters ROUND_END at once.
    const live = hitHarness({ finalKill: true });
    live.victim.hp = 25;
    live.game._doApplyHit(live.victim, live.victim.name, 'You', live.player, null);
    assert.equal(live.game.state, STATES.ROUND_END);
    assert.equal(live.game.roundEnds, 1);
    assert.equal(live.game._pendingRoundEnd ?? false, false);
});

// Integration with js/pause-policy.js: main.js pauses and resumes through
// pauseAction/resumeAction, so drive the shipped setState and _doApplyHit the same way.
test('with the pause policy: a solo final kill under the menu ends the round once on Continue; online never pauses', async () => {
    const { pauseAction, resumeAction } = await import('../js/pause-policy.js');
    const { game, player, victim } = hitHarness({ finalKill: true });
    victim.hp = 25;
    const pause = pauseAction({ connected: false, state: game.state });
    assert.equal(pause.setState, STATES.PAUSED);
    const pausedFrom = game.state;
    game.setState(pause.setState);
    game._doApplyHit(victim, victim.name, 'You', player, null);
    assert.equal(game.state, STATES.PAUSED);
    assert.equal(game.roundEnds, 0);
    const resume = resumeAction({ state: game.state, pausedFrom });
    game.setState(resume.setState);
    assert.equal(game.state, STATES.ROUND_END);
    assert.equal(game.roundEnds, 1);
    assert.equal(resumeAction({ state: game.state, pausedFrom }).setState, null, 'a second Continue rewinds nothing');

    const online = hitHarness({ finalKill: true });
    online.victim.hp = 25;
    online.game.network = { connected: true, isHost: true, broadcast() {} };
    online.game._authoritativeHitState = (target, lethal) => ({ hp: lethal ? 0 : target.hp, alive: !lethal, lethal });
    assert.equal(pauseAction({ connected: true, state: online.game.state }).setState, null);
    online.game._doApplyHit(online.victim, online.victim.name, 'You', online.player, null);
    assert.equal(online.game.state, STATES.ROUND_END, 'the overlay never holds the shared round');
    assert.equal(online.game.roundEnds, 1);
    assert.equal(resumeAction({ state: online.game.state, pausedFrom: null }).setState, null);
});
