import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');

function compileMethod(source, name, globals = {}) {
    const match = new RegExp(`^ {4}${name}\\([^\\n]*\\) \\{`, 'm').exec(source);
    assert.ok(match, `${name} method not found`);
    const bodyStart = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) {
            const method = source.slice(match.index, index + 1);
            return runInNewContext(`({ ${method} }).${name}`, globals);
        }
    }
    assert.fail(`${name} method body is incomplete`);
}

function fakeElement() {
    const classes = new Set(['hidden']);
    return {
        textContent: '',
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name)
        }
    };
}

test('countdown crosses the gameplay boundary on GO and token cancellation prevents callbacks', () => {
    const countdown = fakeElement();
    const timers = [];
    const showCountdown = compileMethod(uiSource, 'showCountdown', {
        document: { getElementById: id => id === 'countdown' ? countdown : null },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
    });
    const cancelCountdown = compileMethod(uiSource, 'cancelCountdown', {
        document: { getElementById: id => id === 'countdown' ? countdown : null }
    });
    const showCountdownGo = compileMethod(uiSource, 'showCountdownGo', {
        document: { getElementById: id => id === 'countdown' ? countdown : null },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
    });
    const ui = { _countdownToken: 0, showCountdown, showCountdownGo };
    let callbacks = 0;

    showCountdown.call(ui, 3, () => callbacks++);
    const firstTick = timers.shift();
    assert.equal(firstTick.delay, 1000);
    firstTick.callback();
    // Execute the three one-second ticks. The last one reaches GO immediately.
    while (timers.length && callbacks === 0) timers.shift().callback();
    assert.equal(callbacks, 1);
    assert.equal(countdown.textContent, 'GO!');
    const goHide = timers.shift();
    assert.equal(goHide.delay, 500);
    goHide.callback();
    assert.equal(countdown.classList.contains('hidden'), true);
    assert.equal(callbacks, 1, 'the GO presentation cannot replay the host callback');

    const cancelledTimers = [];
    const cancelledShow = compileMethod(uiSource, 'showCountdown', {
        document: { getElementById: id => id === 'countdown' ? countdown : null },
        setTimeout: (callback, delay) => { cancelledTimers.push({ callback, delay }); return cancelledTimers.length; }
    });
    cancelledShow.call(ui, 1, () => callbacks++);
    cancelCountdown.call(ui);
    cancelledTimers.shift().callback();
    assert.equal(callbacks, 1, 'a cancelled token cannot advance gameplay');
});

test('network round start advances once, applies host ball data, and never requests a local spawn', () => {
    const startRoundFromNetwork = compileMethod(gameSource, 'startRoundFromNetwork', {
        Number,
        activateQueuedEntity: () => assert.fail('not queued in this trace')
    });
    const calls = { cancel: 0, starts: [], go: 0, ball: [], overtime: 0 };
    const game = {
        network: { isHost: false },
        player: { queuedForNextRound: false },
        cancelPreGame: () => calls.cancel++,
        startRound: options => calls.starts.push(options),
        ui: { showCountdownGo: () => calls.go++ },
        updateBallFromNetwork: ball => calls.ball.push(ball),
        _applyOvertimeSnapshot: () => calls.overtime++
    };
    const packet = {
        matchId: 'match-safe', round: 1,
        ball: { x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, speed: 17, active: true, state: 'falling' }
    };

    startRoundFromNetwork.call(game, packet);
    startRoundFromNetwork.call(game, packet);

    assert.equal(calls.cancel, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.starts)), [{ fromNetwork: true }]);
    assert.equal(calls.go, 1, 'the client presents GO only after the host roundStart');
    assert.deepEqual(calls.ball, [packet.ball]);
    assert.equal(calls.overtime, 1);
});

test('fresh and rematch gameStart packets wait in COUNTDOWN; only roundStart may transition clients', () => {
    assert.match(gameSource, /this\.preGameDuration = 3;/);
    assert.match(gameSource, /this\.ui\.showCountdown\(this\.preGameDuration, wrap\(\(\) => \{\s*this\._preGameActive = false;\s*this\.audio\.playGo\(\);\s*this\.startRound\(\);/);
    assert.doesNotMatch(gameSource, /this\.ui\.showCountdown\(3, wrap/);
    assert.match(gameSource, /this\._awaitHostRoundStart = data\.state === STATES\.COUNTDOWN;/);
    assert.match(gameSource, /if \(waitForHostRoundStart\) \{[\s\S]*?this\.ui\.showCountdown\(displaySeconds, \(\) => \{[\s\S]*?return;/);
    assert.match(gameSource, /this\.startRound\(\{ fromNetwork: true \}\);[\s\S]*?this\.updateBallFromNetwork\(data\.ball\);/);
    assert.match(gameSource, /state: this\.state,\s*preGameRemaining:/);
});

test('snapshot countdown duration is instance-safe for isolated consumers', () => {
    const snapshotState = compileMethod(gameSource, 'snapshotState');
    const base = {
        matchId: 'match-safe',
        getPlayerList: () => [],
        state: 'COUNTDOWN',
        _preGameActive: true,
        preGameDuration: 3,
        mode: { id: 'classic' },
        arena: { mapId: 'beach' },
        scoreboard: { maxRounds: 5, timeLimit: 300, roundNum: 0, redScore: 0, blueScore: 0, timeRemaining: 300 },
        _overtimeExtends: 0,
        _overtime: false,
        _overtimeTimer: 0,
        _suddenDeathAnnounced: false,
        getHotPotatoSnapshot: () => null,
        botDifficulty: 'medium',
        currentBallAffix: null,
        _chaosModeIds: new Set(),
        chaosManager: null,
        ball: null
    };

    assert.equal(snapshotState.call(base).preGameRemaining, 3);
    assert.equal(snapshotState.call({ ...base, state: 'PLAYING' }).preGameRemaining, 0);
});

test('countdown-ready callback is once per match and skip paths use the same boundary', () => {
    const notify = compileMethod(gameSource, '_notifyCountdownReady');
    let callbacks = 0;
    const game = { matchId: 'match-a', onCountdownReady: () => callbacks++ };
    assert.equal(notify.call(game), true);
    assert.equal(notify.call(game), false);
    game.matchId = 'match-b';
    assert.equal(notify.call(game), true);
    assert.equal(callbacks, 2);
    assert.match(gameSource, /this\.startRound\(\);\s*this\._notifyCountdownReady\(\);\s*return;/);
});
