import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Vector3 } from '../vendor/three/three.module.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const helperStart = source.indexOf('const OPENING_LOCAL_MIN_ETA_SECONDS');
const helperEnd = source.indexOf('\n}', helperStart) + 2;
const openingServeSpeed = runInNewContext(`${source.slice(helperStart, helperEnd).replace('export ', '')}\nopeningServeSpeed`);
const STATES = { PLAYING: 'playing', PAUSED: 'paused', MENU: 'menu', LOBBY: 'lobby',
    COUNTDOWN: 'countdown', ROUND_END: 'round_end', SOCIAL_HUB: 'social_hub' };
const advance = compileGameMethod('_updateOpeningServe', { STATES, openingServeSpeed });
const setState = compileGameMethod('setState', {
    STATES, RuntimeLog: { auditTransition() {} }, window: {},
});

function fixture() {
    const first = { alive: true, position: new Vector3(0, 1.2, -8) };
    const second = { alive: true, position: new Vector3(0, 1.2, 8) };
    let targets = [first, second];
    const ball = { active: true, state: 'idle', currentSpeed: 17, targetPlayer: null,
        position: new Vector3(0, 1.2, 0), serves: 0,
        setTarget(target) { this.targetPlayer = target; this.serves++; } };
    const game = {
        state: STATES.PLAYING, scoreboard: { roundNum: 1 }, ball,
        network: { connected: false, isHost: false },
        getAllTargets: () => targets,
        _clearPlayerThreat() {}, _clearLocalDeflectAttempt() {},
        armIncomingSettlement() {}, cancelIncomingSettlement() {},
        _startMusic() {}, _stopMusic() {},
    };
    game._openingServe = { remaining: 0.7, round: 1, scoreboard: game.scoreboard, ball, target: first };
    return { game, first, second, setTargets(value) { targets = value; } };
}

test('an offline opening serves once after 700 ms at 30/60/144 Hz with the readability speed cap', () => {
    for (const hz of [30, 60, 144]) {
        const { game, first } = fixture();
        const before = Math.ceil(0.7 * hz) - 1;
        for (let frame = 0; frame < before; frame++) assert.equal(advance.call(game, 1 / hz), false);
        assert.equal(game.ball.serves, 0);
        assert.equal(advance.call(game, 1 / hz), true);
        assert.equal(game.ball.targetPlayer, first);
        assert.equal(game.ball.currentSpeed, 8);
        assert.equal(game.ball.state, 'homing');
        for (let frame = 0; frame < hz; frame++) assert.equal(advance.call(game, 1 / hz), false);
        assert.equal(game.ball.serves, 1);
    }
});

test('pausing an opening preserves its remaining delay instead of losing or firing the serve', () => {
    const { game } = fixture();
    advance.call(game, 0.2);
    setState.call(game, STATES.PAUSED);
    for (let second = 0; second < 20; second++) assert.equal(advance.call(game, 1), false);
    assert.equal(game.ball.serves, 0);
    assert.ok(Math.abs(game._openingServe.remaining - 0.5) < 1e-9);
    setState.call(game, STATES.PLAYING);
    assert.equal(advance.call(game, 0.49), false);
    assert.equal(advance.call(game, 0.01), true);
    assert.equal(game.ball.serves, 1);
});

test('leaving the round cancels an opening, including returning to play before the old delay expires', () => {
    for (const destination of [STATES.MENU, STATES.LOBBY, STATES.ROUND_END, STATES.COUNTDOWN]) {
        const { game } = fixture();
        setState.call(game, destination);
        assert.equal(game._openingServe, null);
        setState.call(game, STATES.PLAYING);
        assert.equal(advance.call(game, 1), false);
        assert.equal(game.ball.serves, 0);
    }
});

test('old match, round, ball, inactive ball and client authority cannot execute a stale opening', () => {
    for (const mutate of [
        g => { g.scoreboard = { roundNum: 1 }; },
        g => { g.scoreboard.roundNum++; },
        g => { g.ball = { ...g.ball }; },
        g => { g.ball.active = false; },
        g => { g.network.connected = true; g.network.isHost = false; },
    ]) {
        const { game } = fixture();
        mutate(game);
        assert.equal(advance.call(game, 1), false);
        assert.equal(game._openingServe, null);
        assert.equal(game.ball.serves, 0);
    }
});

test('a target eliminated or removed before serve is replaced by a live current participant', () => {
    for (const removed of [false, true]) {
        const { game, first, second, setTargets } = fixture();
        if (removed) setTargets([second]); else first.alive = false;
        assert.equal(advance.call(game, 0.7), true);
        assert.equal(game.ball.targetPlayer, second);
    }
    const { game, first, second } = fixture();
    first.alive = second.alive = false;
    assert.equal(advance.call(game, 1), false);
    assert.equal(game._openingServe, null);
    assert.equal(game.ball.serves, 0);
});

test('the opening never steals an early deflection or an already acquired target', () => {
    for (const deflected of [false, true]) {
        const { game, second } = fixture();
        if (deflected) game.lastDeflector = second;
        else game.ball.targetPlayer = second;
        assert.equal(advance.call(game, 1), false);
        assert.equal(game.ball.serves, 0);
        assert.equal(game._openingServe, null);
    }
});

test('host openings work and malformed dt cannot corrupt the countdown', () => {
    const { game } = fixture();
    game.network = { connected: true, isHost: true };
    for (const dt of [NaN, Infinity, -1, 0]) assert.equal(advance.call(game, dt), false);
    assert.equal(game._openingServe.remaining, 0.7);
    assert.equal(advance.call(game, 0.7), true);
});

test('the real round and playing methods wire the opening to the simulation clock', () => {
    const start = extractGameMethod('startRound');
    assert.match(start, /this\._openingServe = null/);
    assert.match(start, /if \(targets\.length && !fromNetwork\)/);
    assert.match(start, /remaining: 0\.7/);
    assert.doesNotMatch(start.slice(start.indexOf('// First target')), /setTimeout/);
    assert.match(extractGameMethod('updatePlaying'), /if \(this\._openingServe\) this\._updateOpeningServe\(dt\)/);
});

test('the shipped round-start method replaces pending work and never creates a client-side opening', () => {
    const startRound = compileGameMethod('startRound', {
        STATES, THREE: { Vector3 }, window: {},
        BALL_HEAT_TIERS: [{ id: 'cold', color: 0 }],
        clearTimeout() {},
        setTimeout() { throw Error('round opening must not create an unowned wall-clock callback'); },
    });
    const { game, first, second, setTargets } = fixture();
    Object.assign(game, {
        ui: { hideMatchIntro() {}, showRoundBanner() {} },
        clearBlackHoles() {}, clearSplitBalls() {}, _clearRockets() {}, _hideKillcam() {},
        _killPresentationKeys: new Set(), _perfectDeflectCutTotals: new Map(),
        matchAnalytics: { recordEvent() {} }, activateQueuedPlayers() {},
        bots: [], remotePlayers: new Map(), _chaosModeIds: new Set(),
        arena: { config: {} }, mode: {}, guidedDrill: { active: false },
        player: { alive: true }, _applyBallAffix() {}, _cancelCharge() {},
        setState(state) { this.state = state; },
    });
    game.scoreboard.newRound = function () { this.roundNum++; };
    game.ball.spawn = function () { this.active = true; this.targetPlayer = null; this.state = 'idle'; };
    setTargets([first]);
    startRound.call(game);
    assert.equal(game._openingServe.target, first);
    assert.equal(advance.call(game, 0.5), false);
    setTargets([second]);
    startRound.call(game);
    assert.equal(game._openingServe.target, second);
    assert.equal(game._openingServe.remaining, 0.7);
    assert.equal(advance.call(game, 0.2), false, 'old round delay must not leak into the new one');
    assert.equal(advance.call(game, 0.5), true);
    assert.equal(game.ball.targetPlayer, second);
    game.network = { connected: true, isHost: false };
    startRound.call(game, { fromNetwork: true });
    assert.equal(game._openingServe, null);
});
