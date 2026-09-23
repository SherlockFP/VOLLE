// Personal lethal-feedback contract. These use the shipped Game methods through
// game-source.mjs because js/game.js itself needs browser/Three.js globals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGameMethod } from './game-source.mjs';

function timers() {
    const pending = [];
    return {
        setTimeout(callback, delay = 0) {
            const timer = { callback, delay, cancelled: false };
            pending.push(timer);
            return timer;
        },
        clearTimeout(timer) { if (timer) timer.cancelled = true; },
        runAll() { for (const timer of pending) if (!timer.cancelled) timer.callback(); },
        pending
    };
}

// G6 hit-presentation helpers compiled from the shipped source.
function hitPresentationMethods(globals) {
    const scoped = { ...globals, HIT_PRESENTATION_WINDOW_MS: 1000, HIT_PRESENTATION_KEYS_MAX: 64 };
    return {
        _hitPresentationKeys: new Map(),
        _claimHitPresentation: compileGameMethod('_claimHitPresentation', scoped),
        _resolveBodyFxDir: compileGameMethod('_resolveBodyFxDir', scoped),
        _pushKillFeedRow: compileGameMethod('_pushKillFeedRow', scoped),
        _flashKill() {}
    };
}

function claimFixture(playerName) {
    const clock = timers();
    const messages = [];
    const cues = [];
    const claim = compileGameMethod('_claimKillPresentation', {
        performance: { now: () => 1000 },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout
    });
    return {
        game: {
            playerName,
            _killPresentationKeys: new Set(),
            _killConfirmationTimer: null,
            _killConfirmationUntil: 0,
            ui: { showMessage: (text, duration) => messages.push({ text, duration }) },
            audio: { playCue: cue => cues.push(cue) }
        },
        claim,
        clock,
        messages,
        cues
    };
}

test('lethal copy is personal for local killer, victim, environment, and observer', () => {
    const killer = claimFixture('Local');
    assert.equal(killer.claim.call(killer.game, 'Local', 'Opponent', 1), true);
    killer.clock.runAll();
    assert.deepEqual(killer.messages, [{ text: 'KO CONFIRMED - Opponent', duration: 900 }]);
    assert.deepEqual(killer.cues, ['kill-confirm']);

    const victim = claimFixture('Local');
    assert.equal(victim.claim.call(victim.game, 'Opponent', 'Local', 1), true);
    victim.clock.runAll();
    assert.deepEqual(victim.messages, [{ text: 'ELIMINATED BY Opponent', duration: 900 }]);
    assert.deepEqual(victim.cues, []);

    const environment = claimFixture('Local');
    assert.equal(environment.claim.call(environment.game, 'Environment', 'Local', 1), true);
    environment.clock.runAll();
    assert.deepEqual(environment.messages, [{ text: 'ELIMINATED', duration: 900 }]);
    assert.deepEqual(environment.cues, []);

    const observer = claimFixture('Local');
    assert.equal(observer.claim.call(observer.game, 'Opponent A', 'Opponent B', 1), true);
    assert.equal(observer.clock.pending.length, 0, 'observers do not lose their match-status lane to personal KO copy');
    assert.deepEqual(observer.messages, []);
    assert.deepEqual(observer.cues, []);
});

test('a duplicate P2P lethal packet gives the local killer one confirmation and no score mutation', () => {
    const clock = timers();
    const messages = [];
    const cues = [];
    const scoreCalls = [];
    const Three = {
        Vector3: class Vector3 {
            constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
            clone() { return new this.constructor(this.x, this.y, this.z); }
            project() { return this; }
        }
    };
    const globals = {
        THREE: Three,
        performance: { now: () => 1000 },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        window: { innerWidth: 1280, innerHeight: 720, addKillFeed() {} },
        document: { getElementById: () => null },
        requestAnimationFrame: callback => callback()
    };
    const claim = compileGameMethod('_claimKillPresentation', globals);
    const present = compileGameMethod('_presentLethalImpact', globals);
    const applyPlayerHit = compileGameMethod('applyPlayerHit', globals);
    const victim = { name: 'Opponent', hp: 100, alive: true, group: { visible: true } };
    let knockouts = 0;
    const game = {
        ...hitPresentationMethods(globals),
        presentKnockout(target) { knockouts++; target._koActive = true; return true; },
        playerName: 'Local',
        player: { name: 'Local', camera: {} },
        remotePlayers: new Map([['opponent', victim]]),
        bots: [],
        network: { connected: true, isHost: false },
        _killPresentationKeys: new Set(),
        _killConfirmationTimer: null,
        _killConfirmationUntil: 0,
        _claimKillPresentation: claim,
        _presentLethalImpact: present,
        ui: {
            showMessage: (text, duration) => messages.push({ text, duration }),
            spawnDamageNumber() {}, showHitMarker() {}, renderKillFeed() {}
        },
        audio: {
            playCue: cue => cues.push(cue), playSfx() {}, playExplosion() {}, playHit() {}
        },
        juice: { killBurst() {}, hitStop() {}, flash() {} },
        spawnDeathExplosion() {},
        killFeed: [],
        scoreboard: { recordPoint: () => scoreCalls.push('point') }
    };
    const packet = {
        victimPlayerId: 'opponent', victimName: 'Opponent', victimTeam: 'blue',
        attackerName: 'Local', lethal: true, alive: false, dmg: 100,
        hitX: 0, hitY: 1, hitZ: 0, rallyCount: 3
    };

    applyPlayerHit.call(game, packet);
    applyPlayerHit.call(game, packet);
    clock.runAll();

    assert.equal(victim.alive, false);
    assert.equal(knockouts, 1, 'G6: one knockout, the duplicate packet only re-applies state');
    assert.equal(game.killFeed.length, 1, 'G6: one elimination row for the duplicated packet');
    assert.deepEqual(messages, [{ text: 'KO CONFIRMED - Opponent', duration: 900 }]);
    assert.deepEqual(cues, ['kill-confirm']);
    assert.deepEqual(scoreCalls, []);
});

test('an authoritative P2P death clears stale local combo feedback', () => {
    const clock = timers();
    const messages = [];
    const combo = [];
    const globals = {
        THREE: { Vector3: class Vector3 {
            constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
            clone() { return new this.constructor(this.x, this.y, this.z); }
            project() { return this; }
        } },
        performance: { now: () => 1000 },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        window: { innerWidth: 1280, innerHeight: 720, addKillFeed() {} },
        document: { getElementById: () => null },
        requestAnimationFrame: callback => callback()
    };
    const claim = compileGameMethod('_claimKillPresentation', globals);
    const present = compileGameMethod('_presentLethalImpact', globals);
    const applyPlayerHit = compileGameMethod('applyPlayerHit', globals);
    const player = {
        name: 'Local', hp: 100, alive: true, camera: { rotation: { y: 0 } },
        getPosition: () => ({ x: 0, y: 0, z: 0 }),
        die() { this.alive = false; }
    };
    const opponent = { name: 'Opponent', getPosition: () => ({ x: 1, y: 0, z: 0 }) };
    const game = {
        ...hitPresentationMethods(globals),
        playerName: 'Local', player, remotePlayers: new Map(), bots: [],
        network: { connected: true, isHost: false }, killStreak: 4,
        _killPresentationKeys: new Set(), _killConfirmationTimer: null, _killConfirmationUntil: 0,
        _claimKillPresentation: claim, _presentLethalImpact: present,
        ui: {
            showMessage: (text, duration) => messages.push({ text, duration }),
            showCombo: value => combo.push(value), spawnDamageNumber() {}, showHitMarker() {},
            renderKillFeed() {}, flashHit() {}, showDamageDirection() {}, _comboPinnedUntil: 2500
        },
        audio: { playCue() {}, playSfx() {}, playExplosion() {}, playHit() {} },
        juice: { killBurst() {}, hitStop() {}, flash() {}, slowMo() {}, burst() {} },
        spawnDeathExplosion() {}, killFeed: [],
        getAllTargets: () => [opponent], _showKillcam() {}
    };

    applyPlayerHit.call(game, {
        victimName: 'Local', victimTeam: 'red', attackerName: 'Opponent',
        lethal: true, alive: false, dmg: 100, hitX: 0, hitY: 1, hitZ: 0, rallyCount: 3
    });
    clock.runAll();

    assert.equal(game.killStreak, 0);
    assert.deepEqual(combo, [0]);
    assert.equal(game.ui._comboPinnedUntil, 0);
    assert.deepEqual(messages, [{ text: 'ELIMINATED BY Opponent', duration: 900 }]);
});
