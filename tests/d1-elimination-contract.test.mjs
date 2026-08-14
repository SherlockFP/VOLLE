import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { shouldEndOvertime, shouldStartOvertime } from '../js/competitive-service.js';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';

function extractClassMethod(path, name) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const start = source.indexOf(`    ${name}(`);
    assert.ok(start >= 0, `${path} ${name} not found`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`${path} ${name} is incomplete`);
}

function compileClassMethod(path, name, globals = {}) {
    const method = extractClassMethod(path, name);
    return runInNewContext(`({ ${method} }).${name}`, globals);
}

const playerTakeDamage = compileClassMethod('../js/player.js', 'takeDamage', {
    performance: { now: () => 1000 }
});
const botTakeDamage = compileClassMethod('../js/bot.js', 'takeDamage');
const applyAuthoritativeHitDamage = compileGameMethod('_applyAuthoritativeHitDamage');
const authoritativeHitState = compileGameMethod('_authoritativeHitState');

function playerFixture() {
    return {
        hp: 100,
        maxHp: 100,
        shield: 50,
        runeBonuses: {},
        passive: 'none',
        _damageReduction: 0.3,
        totalDamageTaken: 0,
        lastDamageAt: 0,
        takeDamage: playerTakeDamage
    };
}

function botFixture() {
    return {
        hp: 100,
        maxHp: 100,
        shield: 50,
        runeBonuses: {},
        passive: 'none',
        totalDamageTaken: 0,
        drawHpBar() {},
        animator: { play() {} },
        takeDamage: botTakeDamage
    };
}

test('before counterexample: maxHp damage alone is not instagib through Player or Bot defenses', () => {
    const player = playerFixture();
    const bot = botFixture();
    assert.equal(player.takeDamage(player.maxHp), false);
    assert.equal(player.hp, 80, 'Player shield plus reduction survives the old maxHp shortcut');
    assert.equal(bot.takeDamage(bot.maxHp), false);
    assert.equal(bot.hp, 50, 'Bot shield survives the old maxHp shortcut');
});

test('instagib enforces lethal HP after exactly one normal Player or Bot damage call', () => {
    for (const target of [playerFixture(), botFixture()]) {
        let calls = 0;
        const takeDamage = target.takeDamage;
        target.takeDamage = function wrapped(amount) {
            calls++;
            return takeDamage.call(this, amount);
        };
        const game = { _oneHitKill: true };
        assert.equal(applyAuthoritativeHitDamage.call(game, target, target.maxHp), true);
        assert.equal(target.hp, 0);
        assert.equal(calls, 1, 'damage/stat ownership remains in the existing entity method');
    }
});

test('ordinary damage still preserves shield and reduction behavior', () => {
    const target = playerFixture();
    const game = { _oneHitKill: false };
    assert.equal(applyAuthoritativeHitDamage.call(game, target, 40), false);
    assert.equal(target.hp, 100);
    assert.equal(target.shield, 22);
});

test('host lethal packet state cannot advertise a live zero-HP victim', () => {
    const state = authoritativeHitState.call({}, { hp: 0, alive: true }, true);
    assert.deepEqual({ ...state }, { hp: 0, alive: false, lethal: true });
    assert.deepEqual(
        { ...authoritativeHitState.call({}, { hp: 64, alive: true }, false) },
        { hp: 64, alive: true, lethal: false }
    );
    const source = extractGameMethod('_doApplyHit');
    assert.match(source, /const hitState = this\._authoritativeHitState\(hitTarget, isLethal\);/);
    assert.match(source, /type: 'playerHit'[\s\S]*?\.\.\.hitState,/);
});

test('exact P2P applyPlayerHit harness never routes an authoritative lethal packet through revive', () => {
    const applyPlayerHit = compileGameMethod('applyPlayerHit');
    const target = { name: 'Victim', hp: 100, alive: true, group: { visible: true } };
    let revives = 0;
    const game = {
        remotePlayers: new Map([['victim-id', target]]),
        bots: [],
        player: { name: 'Local' },
        playerName: 'Local',
        network: { connected: true, isHost: false },
        _reconcileHostRevive() { revives++; }
    };

    applyPlayerHit.call(game, {
        victimPlayerId: 'victim-id',
        victimName: 'Victim',
        hp: 0,
        alive: false,
        lethal: true
    });
    assert.equal(revives, 0);
    assert.equal(target.hp, 0);
    assert.equal(target.alive, false);
    assert.equal(target.group.visible, false);

    // Contradictory legacy/malformed packets also cannot revive when lethal is true.
    applyPlayerHit.call(game, {
        victimPlayerId: 'victim-id',
        victimName: 'Victim',
        hp: 0,
        alive: true,
        lethal: true
    });
    assert.equal(revives, 0);
    assert.equal(target.alive, false);
});

function fakeTimers() {
    const pending = [];
    return {
        setTimeout(callback, delay) {
            const timer = { callback, delay, cancelled: false };
            pending.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            if (timer) timer.cancelled = true;
        },
        runAll() {
            for (const timer of pending) if (!timer.cancelled) timer.callback();
        },
        pending
    };
}

test('local and P2P lethal routes share one exactly-once readable KO presenter', () => {
    const timers = fakeTimers();
    let now = 1000;
    const messages = [];
    const calls = [];
    const claim = compileGameMethod('_claimKillPresentation', {
        performance: { now: () => now },
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout
    });
    const present = compileGameMethod('_presentLethalImpact', {
        window: { addKillFeed: () => calls.push('external-feed') }
    });
    const game = {
        _killPresentationKeys: new Set(),
        _killConfirmationTimer: null,
        _killConfirmationUntil: 0,
        _claimKillPresentation: claim,
        ui: { showMessage: (text, duration) => messages.push({ text, duration }) },
        audio: {
            playCue: cue => calls.push(cue),
            playSfx: cue => calls.push(cue),
            playExplosion: () => calls.push('explosion')
        },
        juice: {
            killBurst: () => calls.push('kill-burst'),
            hitStop: value => calls.push(`hit-stop:${value}`),
            flash: value => calls.push(`flash:${value}`)
        },
        spawnDeathExplosion: () => calls.push('finisher')
    };
    const hit = { x: 0, y: 1, z: 0 };

    assert.equal(present.call(game, hit, 'blue', 'Attacker', 'Victim', 7), true);
    assert.equal(present.call(game, hit, 'blue', 'Attacker', 'Victim', 7), false);
    assert.equal(calls.filter(call => call === 'kill-burst').length, 1);
    assert.equal(calls.filter(call => call === 'explosion').length, 1);
    assert.equal(timers.pending.length, 1);
    timers.runAll();
    assert.deepEqual(messages, [{ text: 'KO CONFIRMED - Victim', duration: 900 }]);
    assert.ok(messages[0].duration >= 500);
    assert.equal(calls.filter(call => call === 'kill-confirm').length, 1);

    const source = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    const local = source.slice(source.indexOf('    _doApplyHit('), source.indexOf('    applyPlayerHit('));
    const client = source.slice(source.indexOf('    applyPlayerHit('), source.indexOf('    _reconcileHostRevive('));
    assert.match(local, /this\._presentLethalImpact\(/);
    assert.match(client, /this\._presentLethalImpact\(/);
});

test('nonlethal route has zero elimination presentation calls', () => {
    const source = extractGameMethod('_doApplyHit');
    assert.match(source, /const presentedLethal = isLethal\s*\? this\._presentLethalImpact\(/);
    assert.match(source, /if \(!isLethal\) \{\s*this\.juice\.hitBurst/);
});

test('death explosion delegates to the bounded Juice pool with no per-kill geometry allocation', () => {
    const source = extractGameMethod('spawnDeathExplosion');
    assert.doesNotMatch(source, /new THREE\.(?:BoxGeometry|CircleGeometry|MeshBasicMaterial|Mesh)\(/);
    assert.match(source, /if \(pooledBurst\) this\.juice\?\.killBurst\?\.\(pos\);/);

    let bursts = 0;
    let finishers = 0;
    const spawn = compileGameMethod('spawnDeathExplosion', {
        window: { shaderFinishers: { playElimination: () => { finishers++; } } }
    });
    const game = {
        ball: { skinId: 'default' },
        renderer: { scene: {} },
        player: { camera: {} },
        juice: { killBurst: () => { bursts++; } }
    };
    for (let index = 0; index < 240; index++) spawn.call(game, {}, 'red');
    assert.equal(bursts, 240);
    assert.equal(finishers, 240);
    // The exact shipped method ran without a THREE constructor in scope: after
    // Juice warm-up, these 240 calls add zero death Geometry/Material objects.
});

test('round-end copy distinguishes terminal matches without changing timing constants', () => {
    const status = compileGameMethod('_roundEndStatusText', {
        shouldEndOvertime,
        shouldStartOvertime,
        Math
    });
    const fixture = ({ red = 2, blue = 1, max = false, time = false, overtime = 0 } = {}) => ({
        _overtimeExtends: overtime,
        _goalRush: false,
        _goalScoreToWin: 5,
        scoreboard: {
            redScore: red,
            blueScore: blue,
            isMaxRounds: () => max,
            isTimeUp: () => time
        }
    });
    assert.equal(status.call(fixture(), 4), 'Next round in 4s');
    assert.equal(status.call(fixture({ max: true }), 4), 'Match complete');
    assert.equal(status.call(fixture({ red: 2, blue: 2, max: true }), 4), 'Next round in 4s');
    assert.equal(status.call(fixture({ red: 3, blue: 2, max: true, overtime: 1 }), 4), 'Match complete');

    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    assert.match(game, /this\.roundRestartDelay = 4\.0;/);
    assert.match(game, /CELEBRATION_DURATION_SECONDS = 8;/);
});
