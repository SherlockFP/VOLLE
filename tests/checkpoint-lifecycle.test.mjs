import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractAppMethod(name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^ {4}${escapedName}\\([^\\n]*\\) \\{`, 'm').exec(mainSource);
    assert.ok(match, `App.${name} method not found`);

    const start = match.index;
    const bodyStart = mainSource.indexOf('{', start);
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = bodyStart; index < mainSource.length; index++) {
        const character = mainSource[index];
        const next = mainSource[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false;
                index++;
            }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            continue;
        }
        if (character === '/' && next === '/') {
            lineComment = true;
            index++;
            continue;
        }
        if (character === '/' && next === '*') {
            blockComment = true;
            index++;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) {
            return mainSource.slice(start, index + 1);
        }
    }
    assert.fail(`App.${name} method body is incomplete`);
}

function compileAppMethod(name, globals = {}) {
    const method = extractAppMethod(name);
    return runInNewContext(`({ ${method} }).${name}`, globals);
}

function createFakeTimers() {
    let nextId = 1;
    const intervals = new Map();
    const cleared = [];
    return {
        intervals,
        cleared,
        setInterval(callback, delay) {
            const id = nextId++;
            intervals.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) {
            cleared.push(id);
            intervals.delete(id);
        }
    };
}

test('active host publishes bounded changed checkpoints and records API sequence', () => {
    const timers = createFakeTimers();
    const globals = {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        HOST_CHECKPOINT_INTERVAL_MS: 750,
        HOST_CHECKPOINT_SIGNATURE_MAX_CHARS: 64 * 1024
    };
    const publish = compileAppMethod('_publishHostCheckpointIfChanged', globals);
    const start = compileAppMethod('_startHostCheckpointLifecycle', globals);
    const stop = compileAppMethod('_stopHostCheckpointLifecycle', globals);
    let revision = 1;
    const published = [];
    const app = {
        game: {
            snapshotState: () => ({ state: 'PLAYING', revision })
        },
        network: {
            connected: true,
            isHost: true,
            migrationEpoch: 4,
            publishHostCheckpoint(state) {
                published.push(state);
                return {
                    epoch: this.migrationEpoch,
                    sequence: published.length
                };
            }
        },
        _hostCheckpointInterval: null,
        _hostCheckpointGeneration: 0,
        _lastHostCheckpointSignature: null,
        _lastHostCheckpointEpoch: null,
        _lastHostCheckpointSequence: null,
        _publishHostCheckpointIfChanged: publish,
        _startHostCheckpointLifecycle: start,
        _stopHostCheckpointLifecycle: stop
    };

    assert.equal(start.call(app), true);
    assert.equal(published.length, 1);
    const [interval] = timers.intervals.values();
    assert.equal(interval.delay, 750);
    interval.callback();
    assert.equal(published.length, 1);
    revision = 2;
    interval.callback();
    assert.equal(published.length, 2);
    assert.equal(app._lastHostCheckpointEpoch, 4);
    assert.equal(app._lastHostCheckpointSequence, 2);

    app.game.snapshotState = () => ({ payload: 'x'.repeat(64 * 1024 + 1) });
    interval.callback();
    assert.equal(published.length, 2);
});

test('host change and teardown invalidate stale interval and sequence state', () => {
    const timers = createFakeTimers();
    const globals = {
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
        HOST_CHECKPOINT_INTERVAL_MS: 750,
        HOST_CHECKPOINT_SIGNATURE_MAX_CHARS: 64 * 1024
    };
    const publish = compileAppMethod('_publishHostCheckpointIfChanged', globals);
    const start = compileAppMethod('_startHostCheckpointLifecycle', globals);
    const stop = compileAppMethod('_stopHostCheckpointLifecycle', globals);
    let publishCalls = 0;
    const app = {
        game: { snapshotState: () => ({ state: 'LOBBY', players: [] }) },
        network: {
            connected: true,
            isHost: true,
            migrationEpoch: 1,
            publishHostCheckpoint() {
                publishCalls++;
                return { epoch: this.migrationEpoch, sequence: publishCalls };
            }
        },
        _hostCheckpointInterval: null,
        _hostCheckpointGeneration: 0,
        _lastHostCheckpointSignature: null,
        _lastHostCheckpointEpoch: null,
        _lastHostCheckpointSequence: null,
        _publishHostCheckpointIfChanged: publish,
        _startHostCheckpointLifecycle: start,
        _stopHostCheckpointLifecycle: stop
    };

    start.call(app);
    const oldInterval = [...timers.intervals.values()][0];
    const previousGeneration = app._hostCheckpointGeneration;
    stop.call(app);
    assert.equal(app._hostCheckpointInterval, null);
    assert.equal(app._hostCheckpointGeneration, previousGeneration + 1);
    assert.equal(app._lastHostCheckpointSignature, null);
    assert.equal(app._lastHostCheckpointEpoch, null);
    assert.equal(app._lastHostCheckpointSequence, null);
    oldInterval.callback();
    assert.equal(publishCalls, 1);

    app.network.migrationEpoch = 2;
    start.call(app);
    const migratedInterval = [...timers.intervals.values()][0];
    assert.equal(publishCalls, 2);
    app.network.isHost = false;
    migratedInterval.callback();
    assert.equal(app._hostCheckpointInterval, null);
    assert.equal(publishCalls, 2);
});

test('lobby teardown paths stop checkpoint lifecycle before disconnect', () => {
    const leaveLobby = extractAppMethod('leaveLobby');
    const exitToMenu = extractAppMethod('_exitToMenu');
    assert.match(
        leaveLobby,
        /this\._stopHostCheckpointLifecycle\(\);[\s\S]*this\.network\?\.closeLobby\?\.\(\)/
    );
    assert.match(
        exitToMenu,
        /this\._stopHostCheckpointLifecycle\(\);[\s\S]*this\.network\?\.disconnect\(\)/
    );
});

test('background score loop has no duplicate checkpoint publisher wiring', () => {
    const backgroundBroadcast = extractAppMethod('_hostBgSlowBroadcast');
    assert.doesNotMatch(backgroundBroadcast, /publishHostCheckpoint|snapshotState/);
});
