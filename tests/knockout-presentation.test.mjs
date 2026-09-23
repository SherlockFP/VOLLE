// G6 — Knockout that lands. Exercises the shipped Game/UI methods (extracted from
// js/game.js and js/ui.js, see game-source.mjs) frame by frame at 60 and 144 Hz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { getHeapStatistics } from 'node:v8';
import { compileGameMethod, extractGameMethod } from './game-source.mjs';
import { neutralPose, poseFor, writeDeadPose, triggerAction, createAnimatorState } from '../js/character-pose.js';

const CONSTANTS = {
    KNOCKOUT_SLIDE_DISTANCE: 1.2,
    KNOCKOUT_SLIDE_SECONDS: 0.35,
    KNOCKOUT_SHRINK_START: 0.55,
    KNOCKOUT_HIDE_AT: 0.9,
    KNOCKOUT_END_SCALE: 0.05,
    FLINCH_PUSH_DISTANCE: 0.25,
    FLINCH_SECONDS: 0.2,
    HIT_PRESENTATION_KEYS_MAX: 64,
    HIT_PRESENTATION_WINDOW_MS: 1000,
    KILL_FLASH_MS: 160
};

const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
const hudCss = readFileSync(new URL('../css/hud.css', import.meta.url), 'utf8');

test('shipped knockout constants match the card', () => {
    for (const [name, value] of Object.entries(CONSTANTS)) {
        assert.match(gameSource, new RegExp(`const ${name} = ${String(value).replace('.', '\\.')};`), name);
    }
});

const BODY_FX_METHODS = [
    'presentKnockout', '_presentFlinch', '_clearFlinch', '_endKnockout', '_stepKnockout',
    '_stepFlinch', '_updateKnockouts', '_resetKnockouts', '_listBodyFx'
];

// Compiled in this realm with the constants closed over, exactly like the module-scoped
// consts in js/game.js (a vm-context global lookup would box doubles and skew the
// allocation measurement below).
function compileScoped(name, scope) {
    const keys = Object.keys(scope);
    return new Function(...keys, `return ({ ${extractGameMethod(name)} }).${name};`)(...keys.map(key => scope[key]));
}

function knockoutGame(extraGlobals = {}) {
    const scope = { ...CONSTANTS, neutralPose, writeDeadPose, ...extraGlobals };
    const game = { _bodyFxList: [], _bodyFxMapId: null, bots: [], player: { name: 'Local' }, arena: { mapId: 'court' } };
    for (const name of BODY_FX_METHODS) game[name] = compileScoped(name, scope);
    return game;
}

function vec(x = 0, y = 0, z = 0) {
    return {
        x, y, z,
        set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
        setScalar(value) { this.x = value; this.y = value; this.z = value; return this; }
    };
}

function botEntity(game, { x = 2, z = -3 } = {}) {
    const poses = [];
    const played = [];
    const bot = {
        name: 'Bot Medium', team: 'blue', alive: true, spawnAnim: 1,
        position: vec(x, 0, z),
        group: { position: vec(x, 0, z), scale: vec(1, 1, 1), rotation: vec(0, 0.7, 0), visible: true },
        rig: { root: { position: vec() }, applyPose(pose) { poses.push(pose); } },
        animator: { play(action) { played.push(action); } },
        _koActive: false, _koTime: 0, _koDirX: 0, _koDirZ: 0, _koBaseX: 0, _koBaseZ: 0,
        _koOffsetX: 0, _koOffsetZ: 0, _koScale0: 1, _koProxy: false, _koPose: null,
        _flinchTime: -1, _flinchDirX: 0, _flinchDirZ: 0, _bodyFxListed: false
    };
    game.bots.push(bot);
    return { bot, poses, played };
}

function runKnockout(hz) {
    const game = knockoutGame();
    const { bot, poses, played } = botEntity(game);
    const dt = 1 / hz;
    // Ball travelling along (3, 0, 4): the body slides 1.2 u along (0.6, 0.8).
    bot.alive = false; // host sets alive=false first, same tick (scoring unchanged)
    assert.equal(game.presentKnockout(bot, 3, 4), true);
    const samples = [];
    let hiddenAt = null;
    for (let frame = 1; frame <= Math.ceil(1.2 * hz); frame++) {
        game._updateKnockouts(dt);
        const t = frame * dt;
        samples.push({
            t,
            visible: bot.group.visible,
            dx: bot.group.position.x - 2,
            dz: bot.group.position.z + 3,
            scale: bot.group.scale.x
        });
        if (!bot.group.visible && hiddenAt === null) hiddenAt = t;
    }
    return { game, bot, poses, played, samples, hiddenAt, dt };
}

for (const hz of [60, 144]) {
    test(`lethal bot knockout at ${hz} Hz: visible until ~0.9 s, slides 1.2 u along the ball, dead pose`, () => {
        const { game, bot, poses, played, samples, hiddenAt } = runKnockout(hz);
        assert.deepEqual(played, ['dead'], "animator.play('dead') once at t=0");
        // Visible from t=0 until the 0.85-0.95 s window, then hidden.
        assert.ok(hiddenAt >= 0.85 && hiddenAt <= 0.95, `hidden at ${hiddenAt}`);
        for (const sample of samples) {
            if (sample.t < 0.85) assert.equal(sample.visible, true, `visible at ${sample.t}`);
        }
        // Displacement at t = 0.35 s along the ball direction.
        const at35 = samples.reduce((best, s) => Math.abs(s.t - 0.35) < Math.abs(best.t - 0.35) ? s : best);
        const along = at35.dx * 0.6 + at35.dz * 0.8;
        const across = -at35.dx * 0.8 + at35.dz * 0.6;
        assert.ok(Math.abs(along - 1.2) <= 0.1, `along=${along} at t=${at35.t}`);
        assert.ok(Math.abs(across) < 1e-9, 'no sideways drift');
        // Shrink starts at 0.55 s and approaches 0.05 before the hide.
        const pre = samples.filter(s => s.t < 0.55);
        assert.ok(pre.every(s => s.scale === 1), 'no shrink before 0.55 s');
        const lastVisible = samples.filter(s => s.visible).at(-1);
        assert.ok(lastVisible.scale < 0.2, `scale before hide ${lastVisible.scale}`);
        // Dead pose written on the rig every frame, matching poseFor('dead').
        assert.ok(poses.length > 0);
        const mid = poses[Math.floor(poses.length / 2)];
        assert.equal(mid.hips.x < -1, true, 'hips folded back');
        const expected = poseFor('dead', 0, { progress: 1 });
        const final = poses.at(-1);
        assert.ok(Math.abs(final.offsetY - expected.offsetY) < 1e-9);
        // After the hide: offset and scale reset, knockout list empty, alive untouched.
        assert.equal(bot.group.visible, false);
        assert.equal(bot.group.scale.x, 1);
        assert.equal(bot.group.position.x, 2);
        assert.equal(bot.group.position.z, -3);
        assert.equal(bot.alive, false);
        assert.equal(bot._koActive, false);
        assert.equal(game._bodyFxList.length, 0);
    });
}

test('hit-stop does not freeze the knockout: it is ticked on raw dt before the juice early return', () => {
    const update = extractGameMethod('update');
    const knock = update.indexOf('this._updateKnockouts(dt);');
    const juice = update.indexOf('const effectiveDt = this.juice.update(dt);');
    assert.ok(knock > 0 && juice > knock, '_updateKnockouts runs before juice time scaling');
});

test('alive=false and scoring happen at t=0 in the host path; knockout replaces only the hide', () => {
    const source = extractGameMethod('_doApplyHit');
    assert.match(source, /hitTarget\.alive = false;\s*\/\/[^\n]*\n[^\n]*\/\/[^\n]*\n\s*if \(hitTarget\.group && !this\.presentKnockout\(hitTarget, this\._hitDirX, this\._hitDirZ\)\) \{\s*hitTarget\.group\.visible = false;/);
    const knockAt = source.indexOf('this.presentKnockout(');
    for (const stateCall of ['this.ball.deactivate();', 'this.scoreboard.recordPoint(scorerName, 1);',
        'this.scoreboard.recordDeath(name);', 'this.setState(STATES.ROUND_END);',
        'this.roundRestartTimer = this.roundRestartDelay;']) {
        assert.ok(source.indexOf(stateCall, knockAt) > knockAt, `${stateCall} still follows synchronously`);
    }
    // Hazard deaths keep the instant hide.
    const hazards = extractGameMethod('updateMapHazards');
    assert.doesNotMatch(hazards, /presentKnockout/);
    assert.match(hazards, /player\.group\.visible = false/);
});

test('presentKnockout and _updateKnockouts write nothing on Game except the body-fx list', () => {
    const writes = [];
    const game = knockoutGame();
    const { bot } = botEntity(game);
    const tracked = new Proxy(game, {
        set(target, key, value) { writes.push(key); target[key] = value; return true; }
    });
    bot.alive = false;
    game.presentKnockout.call(tracked, bot, 1, 0);
    for (let frame = 0; frame < 70; frame++) game._updateKnockouts.call(tracked, 1 / 60);
    assert.deepEqual([...new Set(writes)].sort(), ['_bodyFxMapId'].filter(key => writes.includes(key)));
    assert.equal(bot.alive, false, 'cosmetic only: alive never restored by the presentation');
});

test('round start / respawn mid-knockout: visible, scale 1, offset 0', () => {
    const game = knockoutGame();
    // Remote proxy: its own animator/position path; reset must restore scale 1.
    const proxy = {
        name: 'Remote', alive: false, position: vec(5, 1.2, 5),
        group: { position: vec(5, 0, 5), scale: vec(1, 1, 1), rotation: vec(), visible: true },
        rig: { root: { position: vec() } }, animator: { play() {} },
        _flinchTime: -1, _bodyFxListed: false
    };
    game.presentKnockout(proxy, 0, 1);
    for (let frame = 0; frame < 42; frame++) game._updateKnockouts(1 / 60); // 0.7 s: shrinking
    assert.ok(proxy.group.scale.x < 1 && proxy.group.position.z > 5.9);
    proxy.alive = true; // startRound revives remotes before _resetKnockouts()
    game._resetKnockouts();
    assert.equal(proxy.group.visible, true);
    assert.equal(proxy.group.scale.x, 1);
    assert.equal(proxy.group.position.x, 5);
    assert.equal(proxy.group.position.z, 5);
    assert.equal(proxy._koOffsetX, 0);
    assert.equal(proxy._koOffsetZ, 0);
    assert.equal(game._bodyFxList.length, 0);

    // Bot: startRound respawns it (alive, visible, spawn position, 0.01 grow-in scale)
    // before the reset; the reset must not stomp the respawn's grow-in.
    const { bot } = botEntity(game);
    bot.alive = false;
    game.presentKnockout(bot, 1, 0);
    for (let frame = 0; frame < 30; frame++) game._updateKnockouts(1 / 60);
    Object.assign(bot, { alive: true, spawnAnim: 0 });
    bot.position.set(9, 0, 9);
    bot.group.position.set(9, 0, 9);
    bot.group.scale.setScalar(0.01);
    bot.group.visible = true;
    game._resetKnockouts();
    assert.equal(bot.group.visible, true);
    assert.equal(bot.group.position.x, 9, 'offset 0 — respawn position kept');
    assert.equal(bot.group.scale.x, 0.01, 'respawn grow-in (0.01 → 1 in ~0.3 s) owns the scale');
    assert.equal(bot._koActive, false);

    // A respawn outside startRound is picked up by the next tick the same way.
    bot.alive = false;
    game.presentKnockout(bot, 1, 0);
    game._updateKnockouts(1 / 60);
    bot.alive = true;
    game._updateKnockouts(1 / 60);
    assert.equal(bot._koActive, false);
    assert.equal(game._bodyFxList.length, 0);

    // Wiring: startRound, celebration/menu entry and an arena rebuild all reset.
    assert.match(extractGameMethod('startRound'), /this\._resetKnockouts\?\.\(\);/);
    assert.match(extractGameMethod('setState'), /s === STATES\.CELEBRATION[^\n]*this\._resetKnockouts\?\.\(\)/);
    bot.alive = false;
    game.presentKnockout(bot, 1, 0);
    game.arena.mapId = 'other-map';
    game._updateKnockouts(1 / 60);
    assert.equal(bot._koActive, false, 'arena rebuild (map change) resets');
    assert.equal(game._bodyFxList.length, 0);
});

test('_updateKnockouts is allocation-free (V8 allocation counter over 200k frames)', (t) => {
    if (typeof getHeapStatistics().total_allocated_bytes !== 'number') {
        t.skip('this Node has no total_allocated_bytes counter');
        return;
    }
    // Hold the knockout open (hide at 1e9 s) so every frame runs the full slide/shrink/pose path.
    const game = knockoutGame({ KNOCKOUT_HIDE_AT: 1e9 });
    const entities = [];
    for (let index = 0; index < 4; index++) {
        const { bot } = botEntity(game, { x: index, z: index });
        bot.rig.applyPose = () => {};
        bot.alive = false;
        game.presentKnockout(bot, 1, index);
        entities.push(bot);
    }
    const flincher = botEntity(game).bot;
    const FRAMES = 200000;
    const noop = { _updateKnockouts() {} };
    // One monomorphic runner per target so JIT tier-up of the loop itself is warm
    // before the measured pass.
    const runner = target => new Function('target', 'flincher', 'FRAMES', `
        for (let frame = 0; frame < FRAMES; frame++) {
            if (frame % 1000 === 0) { flincher._flinchTime = 0; flincher._flinchDirX = 1; }
            target._updateKnockouts(1 / 144);
        }`);
    const measure = target => {
        const run = runner(target);
        run(target, flincher, FRAMES); // warm up / JIT
        run(target, flincher, FRAMES);
        const before = getHeapStatistics().total_allocated_bytes;
        run(target, flincher, FRAMES);
        return getHeapStatistics().total_allocated_bytes - before;
    };
    game._presentFlinch(flincher, 1, 0);
    const baseline = measure(noop);
    const allocated = measure(game);
    const perFrame = (allocated - baseline) / FRAMES;
    t.diagnostic(`_updateKnockouts: ${perFrame.toFixed(3)} B/frame above baseline (5 bodies, ${FRAMES} frames)`);
    // One 16-byte object per body per frame would read >= 80 here (5 bodies); what is
    // left is V8 code/feedback noise, not per-frame garbage.
    assert.ok(perFrame < 8, `~${perFrame.toFixed(2)} B/frame above the empty-loop baseline`);
    assert.ok(entities.every(bot => bot._koActive));

    // Sanity: the same instrument does see a per-frame allocation.
    const sink = [];
    const allocating = { _updateKnockouts(dt) { sink[sink.length & 7] = { dt }; } };
    assert.ok((measure(allocating) - baseline) / FRAMES >= 16);
});

test('nonlethal flinch: 0.25 u push along the ball, rotated into the yawed group, gone by 0.2 s', () => {
    const game = knockoutGame();
    const { bot } = botEntity(game);
    bot.group.rotation.y = Math.PI / 2;
    assert.equal(game._presentFlinch(bot, 0, -2), true);
    game._updateKnockouts(1e-6);
    // World push (0, 0, -0.25) seen from a group yawed +90°: local x = -wz*sin = 0.25.
    assert.ok(Math.abs(bot.rig.root.position.x - 0.25) < 1e-4, `local x ${bot.rig.root.position.x}`);
    assert.ok(Math.abs(bot.rig.root.position.z) < 1e-4);
    for (let frame = 0; frame < 12; frame++) game._updateKnockouts(1 / 60);
    assert.equal(bot.rig.root.position.x, 0);
    assert.equal(bot._flinchTime, -1);
    assert.equal(game._bodyFxList.length, 0);
    assert.equal(game._presentFlinch(game.player, 1, 0), false, 'never the local player');
    assert.equal(game.presentKnockout(game.player, 1, 0), false, 'never the local player');
});

test("'dead' trigger drops the in-flight hit one-shot; writeDeadPose matches poseFor('dead')", () => {
    const hit = triggerAction(createAnimatorState(), 'hit');
    const dead = triggerAction(hit, 'dead');
    assert.equal(dead.state, 'dead');
    assert.equal(dead.oneShot, null);
    for (const progress of [0, 0.3, 0.6, 1]) {
        assert.deepEqual(writeDeadPose(neutralPose(), progress), poseFor('dead', 3, { progress }));
    }
});

// ----- Show each hit once (client prediction vs host confirmation) -----

class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    project() { return this; }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

function dedupeHarness() {
    const counts = { damage: 0, markers: [], playHit: 0, impact: 0, hitBurst: 0, killBurst: 0, knockouts: 0, flinch: 0 };
    const globals = {
        ...CONSTANTS, neutralPose, writeDeadPose,
        THREE: { Vector3 },
        performance: { now: () => 5000 },
        setTimeout: () => 0, clearTimeout() {},
        window: { innerWidth: 1280, innerHeight: 720, __store: null },
        document: { getElementById: () => null, body: null },
        requestAnimationFrame: callback => callback(),
        missRampDamage: base => base, BASE_HIT_DAMAGE: 25,
        calcDamage: dmg => dmg,
        spawnImpactCosmetic() {}, spawnFinisherCosmetic() {}
    };
    const compile = name => compileGameMethod(name, globals);
    const victim = {
        name: 'Bot Medium', team: 'blue', hp: 100, maxHp: 100, alive: true, consecutiveMisses: 0,
        playerId: 'bot:Bot Medium',
        position: new Vector3(0, 0, -10),
        group: { position: vec(0, 0, -10), scale: vec(1, 1, 1), rotation: vec(), visible: true },
        rig: { root: { position: vec() } },
        animator: { play() {} },
        getPosition() { return new Vector3(0, 0, -10); },
        takeDamage(amount) { this.hp = Math.max(0, this.hp - amount); return this.hp <= 0; },
        onMissDeflect() {}, _flinchTime: -1, _bodyFxListed: false
    };
    const player = {
        name: 'Local', team: 'red', alive: true, camera: { rotation: { y: 0 } },
        getPosition: () => new Vector3(0, 0, 10),
        recordDamageDealt() {}
    };
    const game = {
        playerName: 'Local', player, bots: [], rallyCount: 4, killStreak: 0,
        remotePlayers: new Map([['bot:Bot Medium', victim]]),
        network: { connected: true, isHost: false },
        juice: {
            getComboMultiplier: () => 1, combo: 0,
            hitBurst: () => counts.hitBurst++, killBurst: () => counts.killBurst++,
            shockwave() {}, hitStop() {}, flash() {}, slowMo() {}, burst() {}
        },
        ball: { position: new Vector3(0, 1, -10), velocity: { x: 0, y: 0, z: -30 }, lastPerfectBy: null, lastShotBy: 'Local' },
        ui: {
            spawnDamageNumber: () => counts.damage++,
            showHitMarker: kind => counts.markers.push(kind),
            renderKillFeed() {}, showMessage() {}, showCombo() {}, flashHit() {}, showDamageDirection() {}
        },
        audio: { playHit: () => counts.playHit++, playKillImpact: () => counts.impact++, playSfx() {}, playExplosion() {}, playCue() {} },
        matchAnalytics: { recordHit() {}, recordKO() {} },
        scoreboard: { recordHit() {}, recordPoint() {} },
        arena: { mapId: 'court' },
        renderer: { scene: {} },
        killFeed: [],
        _killPresentationKeys: new Set(), _killConfirmationTimer: null, _killConfirmationUntil: 0,
        _hitPresentationKeys: new Map(), _bodyFxList: [], _bodyFxMapId: null,
        _consumeKillConfirm: () => 1,
        getBodyZone: () => ({ multiplier: 1, label: 'BODY', zone: 'body' }),
        getDamageFalloff: () => 1,
        spawnDeathExplosion() {},
        getAllTargets: () => [victim, player],
        _reconcileHostRevive(target, hp) { target.hp = hp; },
        _showKillcam() {}
    };
    for (const name of ['_doApplyHit', 'applyPlayerHit', '_applyAuthoritativeHitDamage', '_claimHitPresentation',
        '_claimKillPresentation', '_presentLethalImpact', '_pushKillFeedRow', '_resolveBodyFxDir', '_flashKill',
        ...BODY_FX_METHODS]) {
        game[name] = compile(name);
    }
    const present = game.presentKnockout;
    game.presentKnockout = function (...args) { counts.knockouts++; return present.apply(this, args); };
    const flinch = game._presentFlinch;
    game._presentFlinch = function (...args) { counts.flinch++; return flinch.apply(this, args); };
    // handleHit latches the contact direction before _doApplyHit (scalars only).
    game._hitDirX = 0; game._hitDirZ = -30; game._hitDirVictim = victim;
    return { game, victim, player, counts };
}

function hostPacket(victim, { dmg, lethal }) {
    return {
        victimPlayerId: victim.playerId, victimName: victim.name, victimTeam: 'blue',
        attackerName: 'Local', dmg, hp: lethal ? 0 : victim.maxHp - dmg, alive: !lethal, lethal,
        hitX: 0, hitY: 0, hitZ: -10, missTag: '', perfectTag: '', rallyCount: 4,
        hitZone: 'BODY', hitZoneId: 'body'
    };
}

test('client nonlethal hit: prediction + host confirmation present exactly once, 0 feed rows', () => {
    const { game, victim, player, counts } = dedupeHarness();
    game._doApplyHit(victim, victim.name, 'Local', player, null); // client prediction
    game.applyPlayerHit(hostPacket(victim, { dmg: 25, lethal: false })); // host confirmation
    assert.equal(counts.damage, 1);
    assert.deepEqual(counts.markers, ['hit']);
    assert.equal(counts.playHit, 1);
    assert.equal(counts.hitBurst, 1);
    assert.equal(counts.flinch, 1);
    assert.equal(game.killFeed.length, 0, 'kill feed lists eliminations only');
    assert.equal(victim.hp, 75, 'host state still applied by the confirmation');
});

test('client lethal hit: one number, one kill marker, one burst, one feed row, one knockout', () => {
    const { game, victim, player, counts } = dedupeHarness();
    victim.hp = 25;
    game._doApplyHit(victim, victim.name, 'Local', player, null);
    assert.equal(victim.alive, true, 'prediction never kills a remote body');
    game.applyPlayerHit(hostPacket(victim, { dmg: 25, lethal: true }));
    assert.equal(counts.damage, 1);
    assert.deepEqual(counts.markers, ['kill']);
    // G7: a lethal hit's sound is the single kill impact, not the hit bonk too.
    assert.equal(counts.playHit, 0);
    assert.equal(counts.impact, 1);
    assert.equal(counts.killBurst, 1);
    assert.equal(counts.knockouts, 1);
    assert.equal(victim.alive, false, 'host authority applied by the second caller');
    assert.equal(victim.group.visible, true, 'body stays up for the knockout');
    assert.equal(game.killFeed.length, 1);
    assert.deepEqual(
        { attackerTeam: game.killFeed[0].attackerTeam, victimTeam: game.killFeed[0].victimTeam },
        { attackerTeam: 'red', victimTeam: 'blue' }
    );
});

test('client confirmation without a prediction presents once; nonlethal→lethal upgrade still lands the kill', () => {
    const first = dedupeHarness();
    first.game.applyPlayerHit(hostPacket(first.victim, { dmg: 100, lethal: true }));
    assert.equal(first.counts.damage, 1);
    assert.deepEqual(first.counts.markers, ['kill']);
    assert.equal(first.counts.knockouts, 1);
    assert.equal(first.game.killFeed.length, 1);

    const upgrade = dedupeHarness();
    upgrade.game._doApplyHit(upgrade.victim, upgrade.victim.name, 'Local', upgrade.player, null); // predicted nonlethal
    upgrade.game.applyPlayerHit(hostPacket(upgrade.victim, { dmg: 100, lethal: true }));
    assert.equal(upgrade.counts.killBurst, 1, 'the host-decided kill is never swallowed');
    assert.equal(upgrade.game.killFeed.length, 1);
    assert.equal(upgrade.victim.alive, false);
});

test('_claimHitPresentation: first caller wins, keys capped at 64, expire after 1 s, cleared on round start', () => {
    let now = 0;
    const claim = compileGameMethod('_claimHitPresentation', { ...CONSTANTS, performance: { now: () => now } });
    const game = { _hitPresentationKeys: new Map() };
    assert.equal(claim.call(game, 'A', 3, false), true);
    assert.equal(claim.call(game, 'A', 3, false), false);
    assert.equal(claim.call(game, 'A', 3, true), true, 'lethal upgrade');
    assert.equal(claim.call(game, 'A', 3, true), false);
    now = 1500;
    assert.equal(claim.call(game, 'A', 3, false), true, 'a later hit in the same rally presents');
    for (let index = 0; index < 200; index++) claim.call(game, `V${index}`, index, false);
    assert.ok(game._hitPresentationKeys.size <= 64);
    assert.match(extractGameMethod('startRound'), /this\._hitPresentationKeys\?\.clear\(\);/);
});

// ----- UI: kill feed rows and hit marker kinds -----

function extractUiMethod(name) {
    const source = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    const match = new RegExp(`^ {4}${name}\\([^\\n]*\\) \\{`, 'm').exec(source);
    assert.ok(match, `UI.${name} not found`);
    let depth = 0;
    for (let index = match.index + match[0].length - 1; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}' && --depth === 0) return source.slice(match.index, index + 1);
    }
    assert.fail(`UI.${name} incomplete`);
}

function fakeDom() {
    const makeClassList = el => ({
        _set: new Set(),
        add(...names) { names.forEach(n => this._set.add(n)); el._sync(); },
        remove(...names) { names.forEach(n => this._set.delete(n)); el._sync(); },
        toggle(name, on) { if (on) this._set.add(name); else this._set.delete(name); el._sync(); },
        contains(name) { return this._set.has(name); }
    });
    const createElement = tag => {
        const el = {
            tag, children: [], textContent: '', dataset: {}, style: {}, _className: '',
            get className() { return this._className; },
            set className(value) { this._className = value; this.classList._set = new Set(value.split(/\s+/).filter(Boolean)); },
            _sync() { this._className = [...this.classList._set].join(' '); },
            append(...nodes) { this.children.push(...nodes); },
            appendChild(node) { this.children.push(node); },
            insertBefore(node, before) {
                const at = before ? this.children.indexOf(before) : -1;
                if (at < 0) this.children.push(node); else this.children.splice(at, 0, node);
            },
            removeChild(node) { this.children.splice(this.children.indexOf(node), 1); },
            get lastChild() { return this.children.at(-1); },
            get offsetWidth() { return 1; }
        };
        el.classList = makeClassList(el);
        return el;
    };
    const nodes = { 'kill-feed': createElement('div'), 'hit-marker': createElement('div') };
    return { document: { createElement, getElementById: id => nodes[id] || null }, nodes };
}

test('kill feed: lethal rows only, team-coloured names, PERFECT and HEADSHOT tags, per-frame reuse', () => {
    let now = 1000;
    const { document, nodes } = fakeDom();
    const globals = { document, performance: { now: () => now } };
    const ui = {};
    for (const name of ['renderKillFeed', '_buildKillFeedRow', '_killFeedTag']) {
        ui[name] = runInNewContext(`({ ${extractUiMethod(name)} }).${name}`, globals);
    }
    const feed = [{
        attacker: 'Local', victim: 'Bot Medium', attackerTeam: 'red', victimTeam: 'blue',
        perfect: true, headshot: true, time: 1000
    }];
    ui.renderKillFeed(feed);
    const el = nodes['kill-feed'];
    assert.equal(el.children.length, 1);
    const row = el.children[0];
    const [killer, , victim, head, perfect] = row.children;
    assert.match(killer.className, /\bkiller\b/);
    assert.match(killer.className, /\bteam-red\b/);
    assert.match(victim.className, /\bteam-blue\b/);
    assert.equal(head.textContent, 'HEADSHOT');
    assert.equal(perfect.textContent, 'PERFECT');
    // Same entries next frame: the row node is reused (its slide-in is not restarted).
    ui.renderKillFeed(feed);
    assert.equal(el.children[0], row);
    // Newest first, max 5, expired after 5 s.
    feed.unshift({ attacker: 'Bot Medium', victim: 'Local', attackerTeam: 'blue', victimTeam: 'red', time: 2000 });
    now = 2000;
    ui.renderKillFeed(feed);
    assert.equal(el.children.length, 2);
    assert.equal(el.children[1], row);
    now = 6500;
    ui.renderKillFeed(feed);
    assert.equal(el.children.length, 1);
    assert.match(el.children[0].className, /fade-out/);
    ui.renderKillFeed([]);
    assert.equal(el.children.length, 0);
});

test("hit marker kinds: 'kill' red X at 1.4x for 350 ms, hit/head otherwise; legacy boolean = head", () => {
    const { document, nodes } = fakeDom();
    const show = runInNewContext(`({ ${extractUiMethod('showHitMarker')} }).showHitMarker`, { document });
    const marker = nodes['hit-marker'];
    show('kill');
    assert.ok(marker.classList.contains('kill') && marker.classList.contains('show'));
    show('hit');
    assert.ok(marker.classList.contains('hit') && !marker.classList.contains('kill'));
    show(true);
    assert.ok(marker.classList.contains('head'));
    show(false);
    assert.ok(marker.classList.contains('hit'));

    const size = selector => Number(new RegExp(`${selector} \\{[^}]*font-size: ([\\d.]+)em`).exec(hudCss)?.[1]);
    assert.equal(size('#hit-marker\\.kill'), +(size('#hit-marker\\.hit') * 1.4).toFixed(2));
    assert.match(hudCss, /#hit-marker\.kill \{[^}]*color: #ff2d44/);
    assert.match(hudCss, /#hit-marker\.kill\.show \{ animation: hitMarkerKill 350ms/);
});

test('kill flash: 160 ms overlay; Reduced Motion variant animates opacity only', () => {
    assert.match(gameSource, /const KILL_FLASH_MS = 160;/);
    assert.doesNotMatch(gameSource, /classList\.remove\('hit-flash'\), 20\)/);
    assert.match(hudCss, /body\.hit-flash::after \{[^}]*animation: killFlash 160ms/);
    const fade = /@keyframes killFlashFade \{([\s\S]*?)\n\}/.exec(hudCss)[1];
    const markerFade = /@keyframes hitMarkerKillFade \{([\s\S]*?)\n\}/.exec(hudCss)[1];
    for (const frames of [fade, markerFade]) {
        assert.doesNotMatch(frames, /transform/);
        assert.match(frames, /opacity/);
    }
    // The global reduced-motion rules cut animations to 0.01ms; the opacity fades keep
    // their duration (!important + higher specificity) instead of vanishing.
    assert.match(hudCss, /@media \(prefers-reduced-motion: reduce\) \{\s*body\.hit-flash::after \{ animation: killFlashFade 160ms linear forwards !important; \}\s*#hit-marker\.kill\.show \{ animation: hitMarkerKillFade 350ms linear !important; \}/);
    assert.match(hudCss, /body\.reduced-motion\.hit-flash::after,\s*html\.reduce-motion body\.hit-flash::after \{ animation: killFlashFade 160ms/);
    assert.match(hudCss, /body\.reduced-motion #hit-marker\.kill\.show,\s*html\.reduce-motion #hit-marker\.kill\.show \{ animation: hitMarkerKillFade 350ms/);
    // Phones: the feed stays inside the viewport and long names truncate.
    assert.match(hudCss, /@media \(max-width: 700px\) \{\s*#kill-feed \{[^}]*max-width: calc\(100vw - 16px\)/);
    assert.match(hudCss, /#kill-feed \.kill-entry \.victim \{[^}]*text-overflow: ellipsis/);
});

test('remote position/bot-sync packets do not hide a body mid-knockout', () => {
    assert.match(extractGameMethod('updateRemotePlayer'), /p\.group\.visible = p\.alive \|\| p\._koActive === true;/);
    assert.match(extractGameMethod('applyBotSync'), /p\.group\.visible = p\.alive \|\| p\._koActive === true;/);
    assert.match(extractGameMethod('invokeRemoteSnapshots'), /p\.position\.x \+ \(p\._koOffsetX \|\| 0\)/);
});
