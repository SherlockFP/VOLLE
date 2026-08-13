import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function extractAppMethod(name) {
    const match = new RegExp(`^ {4}${name}\\([^\\n]*\\) \\{`, 'm').exec(mainSource);
    assert.ok(match, `App.${name} method not found`);
    const start = match.index;
    const bodyStart = mainSource.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < mainSource.length; index++) {
        const char = mainSource[index];
        if (char === '{') depth++;
        if (char === '}' && --depth === 0) return mainSource.slice(start, index + 1);
    }
    assert.fail(`App.${name} method body is incomplete`);
}

function compileHostPublisher(document) {
    const method = extractAppMethod('_hostBgSlowBroadcast');
    return runInNewContext(`({ ${method} })._hostBgSlowBroadcast`, { document });
}

function createHost() {
    const packets = [];
    return {
        packets,
        network: {
            isHost: true,
            broadcastBallState(_ball, sequence) { packets.push({ type: 'ballState', sequence }); },
            broadcast(packet) { packets.push(packet); }
        },
        game: {
            ball: { active: true, state: 'flying' },
            scoreboard: { redScore: 1, blueScore: 0, timeRemaining: 42, roundNum: 2, getPlayerStats: () => [] },
            getHotPotatoSnapshot: () => null,
            killFeed: [],
            bots: [],
            powerUps: []
        },
        _bgBallTimer: 0,
        _bgScoreTimer: 0,
        _bgBotTimer: 0,
        _bgPowerUpTimer: 0,
        _ballSeq: 7
    };
}

test('hidden-tab host publisher is inert while the RAF owns visible transport', () => {
    const document = { hidden: false };
    const publish = compileHostPublisher(document);
    const host = createHost();

    publish.call(host, 1);

    assert.deepEqual(host.packets, []);
    assert.equal(host._ballSeq, 7);
});

test('hidden-tab host publisher keeps ordered ball snapshots and clears expired powerups', () => {
    const document = { hidden: true };
    const publish = compileHostPublisher(document);
    const host = createHost();

    publish.call(host, 0.5);

    const balls = host.packets.filter(packet => packet.type === 'ballState');
    assert.equal(balls.length, 1);
    assert.deepEqual(balls.map(packet => packet.sequence), [8]);
    assert.ok(host.packets.some(packet => packet.type === 'scoreUpdate'));
    const powerUpClear = host.packets.find(packet => packet.type === 'powerUpState');
    assert.equal(powerUpClear?.type, 'powerUpState');
    assert.equal(powerUpClear?.powerUps.length, 0);
});

test('background loop only invokes the host publisher while the document is hidden', () => {
    const loop = extractAppMethod('_startBgLoop');
    assert.match(loop, /if \(document\.hidden && this\.game\.state === STATES\.PLAYING\) \{\s*this\._hostBgSlowBroadcast\(dt\);/);
});
