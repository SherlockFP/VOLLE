// Cross-court rule: in team modes players (local, remote-on-host, bots) stay on their
// own half unless the host allowed crossing. FFA / Goal Rush / practice are free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { runInNewContext } from 'node:vm';
import {
    clampToCourtHalf,
    confinementSideFor,
    courtSideForTeam,
    DEFAULT_ALLOW_CROSS_COURT,
    isCrossCourtLocked,
    normalizeAllowCrossCourt
} from '../js/court-rules.js';
import { compileGameMethod } from './game-source.mjs';

const STATES = { PLAYING: 'PLAYING', COUNTDOWN: 'COUNTDOWN', ROUND_END: 'ROUND_END', LOBBY: 'LOBBY', CELEBRATION: 'CELEBRATION' };

test('rule defaults to locked and only team play is confined', () => {
    assert.equal(DEFAULT_ALLOW_CROSS_COURT, false);
    assert.equal(isCrossCourtLocked(), true);
    assert.equal(courtSideForTeam('red'), -1);
    assert.equal(courtSideForTeam('blue'), 1);
    assert.equal(courtSideForTeam(undefined), 0);
    assert.equal(confinementSideFor('red'), -1);
    assert.equal(confinementSideFor('blue', { allowCrossCourt: true }), 0);
    assert.equal(confinementSideFor('red', { ffa: true }), 0);
    assert.equal(confinementSideFor('red', { goalRush: true }), 0);
    assert.equal(confinementSideFor('red', { practice: true }), 0);
    assert.equal(normalizeAllowCrossCourt('true'), true);
    assert.equal(normalizeAllowCrossCourt('yes'), false);
});

test('midline clamp keeps the whole body on its half and never moves a legal position', () => {
    assert.equal(clampToCourtHalf(3, -1, 0.7), -0.7);
    assert.equal(clampToCourtHalf(-5, -1, 0.7), -5);
    assert.equal(clampToCourtHalf(-3, 1, 0.7), 0.7);
    assert.equal(clampToCourtHalf(9, 1, 0.7), 9);
    assert.equal(clampToCourtHalf(3, 0, 0.7), 3, 'side 0 = free');
    assert.ok(Number.isNaN(clampToCourtHalf(Number.NaN, -1, 0.7)));
});

test('Game.getCourtConfinementSide follows mode, state and the host setting', () => {
    const side = compileGameMethod('getCourtConfinementSide', { STATES, confinementSideFor });
    const game = { state: STATES.PLAYING, _ffa: false, _goalRush: false, _practiceMode: false, guidedDrill: { active: false }, arena: { config: {} }, allowCrossCourt: false };
    assert.equal(side.call(game, 'red'), -1);
    assert.equal(side.call(game, 'blue'), 1);
    assert.equal(side.call({ ...game, allowCrossCourt: true }, 'red'), 0);
    assert.equal(side.call({ ...game, _ffa: true }, 'red'), 0);
    assert.equal(side.call({ ...game, _goalRush: true }, 'red'), 0);
    assert.equal(side.call({ ...game, guidedDrill: { active: true } }, 'red'), 0);
    assert.equal(side.call({ ...game, state: STATES.LOBBY }, 'red'), 0);
    assert.equal(side.call({ ...game, state: STATES.CELEBRATION }, 'red'), 0, 'celebration is free roam');
    assert.equal(side.call({ ...game, state: STATES.COUNTDOWN }, 'blue'), 1);
});

test('host clamps a remote player report that crosses the midline (and relays the clamped value)', () => {
    const update = compileGameMethod('updateRemotePlayer', { clampToCourtHalf, performance: { now: () => 1000 }, KNIVES: {} });
    const pushed = [];
    const relayed = [];
    const remote = { team: 'red', radius: 0.7, alive: true, hp: 100, group: { rotation: {}, visible: true }, aimDir: { set() { return this; }, normalize() {} } };
    const makeGame = (allowCrossCourt, isHost = true) => ({
        network: {
            isHost, playerId: 'host', peer: { id: 'host-peer' },
            broadcast: packet => relayed.push(packet),
            relayPositionToSpectators: data => relayed.push(data)
        },
        spectators: { has: () => false },
        addRemotePlayer: () => remote,
        getCourtConfinementSide: team => (allowCrossCourt ? 0 : team === 'red' ? -1 : 1),
        _pushPosBuffer: (p, x, y, z) => pushed.push(z),
        _peerLastSeen: new Map([['player-r', 990]])
    });
    update.call(makeGame(false), 'player-r', { x: 0, y: 1.7, z: 6, team: 'red' }, 'peer-r');
    assert.equal(pushed.at(-1), -0.7);
    assert.equal(relayed.at(-1).z, -0.7, 'spectator relay carries the authoritative position');
    update.call(makeGame(true), 'player-r', { x: 0, y: 1.7, z: 6, team: 'red' }, 'peer-r');
    assert.equal(pushed.at(-1), 6, 'crossing allowed');
    update.call(makeGame(false, false), 'player-r', { x: 0, y: 1.7, z: 6, team: 'red' }, 'peer-r');
    assert.equal(pushed.at(-1), 6, 'clients render the host snapshot as-is');
});

test('a remote packet cannot turn a spectator into a player', () => {
    const update = compileGameMethod('updateRemotePlayer', { clampToCourtHalf, performance: { now: () => 0 }, KNIVES: {} });
    let added = 0;
    update.call({
        network: { isHost: true, playerId: 'host', peer: { id: 'hp' } },
        spectators: { has: id => id === 'player-spec' },
        addRemotePlayer: () => { added++; return null; }
    }, 'player-spec', { x: 0, y: 1.7, z: 0 }, 'peer-spec');
    assert.equal(added, 0);
});

// --- Bots: the shipped Bot.update, with an aggressive depth bias that used to let a
// red bot's forward line sit past z = 0.
const botSource = readFileSync(new URL('../js/bot.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
    multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
    add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
    negate() { return this.multiplyScalar(-1); }
}
const rng = Object.create(Math);
rng.random = () => 0.5;
const Bot = runInNewContext(`${botSource}\nBot`, {
    THREE: { Vector3 }, Math: rng, tickSkillCooldowns() {}, useSkill() {}, clampToCourtHalf
});

function botFixture(team, courtSide) {
    const bot = Object.assign(Object.create(Bot.prototype), {
        alive: true, hp: 100, maxHp: 100, shield: 0, radius: 0.5,
        loadout: { skill: 'slow' }, skillCooldowns: {}, runeBonuses: {},
        skillChance: 0, moveSpeed: 5.5, team,
        position: new Vector3(0, 0, team === 'red' ? 0.4 : -0.4), velocity: new Vector3(),
        group: { position: new Vector3(), rotation: {}, scale: { setScalar() {} } },
        arena: { bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, collidables: [] },
        spawnAnim: 1, attackTimer: 0, strafeTimer: 100, strafeDir: 1,
        _gameRef: { _ffa: false, getCourtConfinementSide: () => courtSide },
        _defenseIntent: 'none', _defenseDodgeLatch: 0,
        _tendencyDepthBias: -1.5, _tendencyApproachMul: 1, _tendencyLateralMul: 1,
        drawHpBar() {}, setTargetOutline() {}
    });
    for (const key of ['_toBall', '_ballDir', '_predOffset', '_interceptTarget',
        '_toIntercept', '_dodgeDir', '_perpDir']) bot[key] = new Vector3();
    return bot;
}

test('bots respect the midline while crossing is locked', () => {
    for (const [team, side] of [['red', -1], ['blue', 1]]) {
        const bot = botFixture(team, side);
        for (let i = 0; i < 120; i++) bot.update(1 / 60, null);
        assert.ok(side < 0 ? bot.position.z <= -0.6 + 1e-9 : bot.position.z >= 0.6 - 1e-9,
            `${team} bot stays on its half (z=${bot.position.z})`);
    }
    // Rule off: the old tactical line (which may touch the midline) is unchanged.
    const free = botFixture('red', 0);
    free.update(1 / 60, null);
    assert.ok(free.position.z > 0, 'no extra clamp when crossing is allowed');
});

// --- Local player: the real Player.update with a real THREE build.
const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});

test('the local player is stopped by the midline only while confined', async t => {
    const THREE = await import(threeUrl);
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const document = new EventTarget();
    const window = new EventTarget();
    const canvas = { tagName: 'CANVAS' };
    document.activeElement = canvas;
    document.pointerLockElement = null;
    document.hidden = false;
    document.body = { classList: { contains: () => false } };
    window.matchMedia = () => ({ matches: false });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    const { Player } = await import('../js/player.js');
    const player = new Player(
        { scene: new THREE.Scene(), domElement: canvas, createToonMaterial: color => new THREE.MeshBasicMaterial({ color }) },
        new THREE.PerspectiveCamera(75, 1, 0.1, 100),
        { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40, maxY: 30 }, config: {}, collidables: [], platforms: [], jumpPads: [] }
    );
    player.game = { state: 'PLAYING', ui: { spectating: false }, ball: { _warmup: false } };
    t.after(() => {
        player.cleanupInput();
        player.armGroup.removeFromParent();
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    });

    // Red player sprinting toward the blue half (+z).
    player.courtSide = -1;
    player.position.set(0, player.height, -1);
    player.velocity.set(0, 0, 12);
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    assert.ok(player.position.z <= -player.radius + 1e-9, `confined red player z=${player.position.z}`);
    assert.ok(player.velocity.z <= 1e-9, 'velocity into the midline is clipped');

    player.courtSide = 0;
    player.position.set(0, player.height, -1);
    player.velocity.set(0, 0, 12);
    for (let i = 0; i < 30; i++) player.update(1 / 60);
    assert.ok(player.position.z > 0, 'free player crosses when the rule is off');
});
