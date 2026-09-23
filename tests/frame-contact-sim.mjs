// G2 simulation harness: one straight ball approach per call, stepped at a
// fixed frame rate through either the shipped in-frame contact order ('new':
// player.update → bot readiness → ball step → Game._resolveFrameContacts) or
// the pre-G2 frame-edge order ('old': player.update → deflect check on the
// frame-start state → bot tryDeflect → ball step → swept G1 hit test).
// The 'new' order runs the real Game._resolveFrameContacts, _localDeflectLeadMs,
// _isDeflectFacingBall and capsuleHitTest (compiled from js/game.js), the real
// Player.getSwingLiveInterval / endSwingTail (js/player.js) and the real Bot
// observeDefenseIntent / advanceDeflectReady / commitDeflect / tryDeflect
// (js/bot.js). Player.update's attack timers are mirrored (pinned in tests).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import {
    capsuleContact,
    deflectContactS,
    segmentCapsuleEntry,
    segmentIntersectsSphere,
    segmentSphereEntry,
    sweptHitStepCount,
    targetFeetY
} from '../js/combat.js';
import { classifyDeflectLead, predictContactMs } from '../js/perfect-deflect.js';
import { compileGameMethod } from './game-source.mjs';

export const gameSource = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
export const botSource = readFileSync(new URL('../js/bot.js', import.meta.url), 'utf8');
export const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

// Mirrors of shipped tuning (pinned by the tests that use them).
export const BALL_RADIUS = 0.47;
export const HIT_RANGE = 0.7;
export const ATTACK_RANGE = 2.0;
export const SWING_ACTIVE_WINDOW = 0.22;
export const ATTACK_COOLDOWN = 0.6;
export const EYE_HEIGHT = 1.7;
export const CHEST_OFFSET = -0.45;
export const DEFLECT_MIN_FACING_DOT = 0.15;
export const BOT_DIFFICULTY = {
    easy: { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08 },
    hard: { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02 }
};

// Slices `    name(args) {` … matching `}` (or `export function name(`) out of a
// source file, skipping strings and comments.
export function extractMethod(source, name, { exportedFunction = false } = {}) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = exportedFunction
        ? new RegExp(`^export function ${escaped}\\([^\\n]*\\) \\{`, 'm')
        : new RegExp(`^ {4}${escaped}\\([^\\n]*\\) \\{`, 'm');
    const match = pattern.exec(source);
    if (!match) throw new Error(`${name} not found`);
    const bodyStart = match.index + match[0].lastIndexOf('{');
    let depth = 0;
    let quote = null;
    let lineComment = false;
    let blockComment = false;
    for (let index = bodyStart; index < source.length; index++) {
        const character = source[index];
        const next = source[index + 1];
        if (lineComment) { if (character === '\n') lineComment = false; continue; }
        if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index++; } continue; }
        if (quote) { if (character === '\\') index++; else if (character === quote) quote = null; continue; }
        if (character === '/' && next === '/') { lineComment = true; index++; continue; }
        if (character === '/' && next === '*') { blockComment = true; index++; continue; }
        if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
        if (character === '{') depth++;
        if (character === '}' && --depth === 0) {
            const text = source.slice(match.index, index + 1);
            return exportedFunction ? text.replace(/^export /, '') : text;
        }
    }
    throw new Error(`${name} body is incomplete`);
}

function compileMethods(source, names, globals = {}) {
    const body = names.map(name => extractMethod(source, name)).join(',\n');
    return runInNewContext(`({ ${body} })`, globals);
}

export class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    lerpVectors(a, b, t) {
        this.x = a.x + (b.x - a.x) * t;
        this.y = a.y + (b.y - a.y) * t;
        this.z = a.z + (b.z - a.z) * t;
        return this;
    }
    distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

// Vector3 that counts its constructions (per-frame allocation evidence).
export const allocation = { count: 0 };
export class CountingVector3 extends Vector3 {
    constructor(x, y, z) { super(x, y, z); allocation.count++; }
}

function proximityAssistRange(speed, baseRange = 1.5) {
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    return Math.max(0, baseRange) + Math.min(safeSpeed * 0.0015, 1.0);
}

export const resolveFrameContacts = compileGameMethod('_resolveFrameContacts', {
    THREE: { Vector3: CountingVector3 },
    segmentSphereEntry,
    segmentCapsuleEntry,
    deflectContactS,
    sweptHitStepCount,
    targetFeetY,
    proximityAssistRange,
    Math
});
export const followThroughDeflect = compileGameMethod('_followThroughDeflect');
const frameFraction = compileGameMethod('_frameFraction');
const localSwingInterval = compileGameMethod('_localSwingInterval');
const capsuleHitTest = compileGameMethod('capsuleHitTest', { capsuleContact });
export const localDeflectLeadMs = compileGameMethod('_localDeflectLeadMs', { predictContactMs, targetFeetY });
const isDeflectFacingBall = compileGameMethod('_isDeflectFacingBall', { DEFLECT_MIN_FACING_DOT, Math });

const playerMethods = compileMethods(playerSource, ['getSwingLiveInterval', 'endSwingTail']);

// Player attack timers: tryAttack + the attack block of Player.update.
export class SimPlayer {
    constructor({ feetY = 0, x = 0, z = 0, team = 'blue', aim = { x: 1, y: 0, z: 0 } } = {}) {
        this.position = new Vector3(x, feetY + EYE_HEIGHT, z);
        this.team = team;
        this.alive = true;
        this.aim = aim;
        this._sizeScale = 1;
        this.attacking = false;
        this.attackActive = 0;
        this.attackCooldown = 0;
        this.swingAge = 0;
        this.swingClickDt = 0;
        this._swingAgePending = false;
        this._swingLiveWindow = 0;
        this.swingTail = false;
    }

    getPosition() { return new Vector3(this.position.x, this.position.y, this.position.z); }
    getFeetY() { return this.position.y - EYE_HEIGHT; }
    isAttacking() { return this.attacking; }

    tryAttack() {
        if (this.attackCooldown > 0) return false;
        this.attacking = true;
        this.attackCooldown = ATTACK_COOLDOWN;
        this.attackActive = Math.min(SWING_ACTIVE_WINDOW, ATTACK_COOLDOWN);
        this.swingAge = 0;
        this.swingClickDt = 0;
        this._swingAgePending = true;
        this._swingLiveWindow = this.attackActive;
        this.swingTail = false;
        return true;
    }

    update(dt) {
        if (this.attackActive > 0) {
            if (this._swingAgePending) {
                this._swingAgePending = false;
                this.swingClickDt = dt;
            } else this.swingAge += dt;
            this.attackActive -= dt;
            this.swingTail = this.attacking && this.attackActive <= 0;
            if (this.attackActive <= 0) {
                this.attackActive = 0;
                this.attacking = false;
            }
        } else if (this.swingTail) {
            this.swingAge += dt;
            if ((this.swingClickDt > 0 ? this.swingClickDt / 2 : 0) - this.swingAge + this._swingLiveWindow < 0) {
                this.swingTail = false;
            }
        }
        if (this.attackCooldown > 0) {
            this.attackCooldown -= dt;
            if (this.attackCooldown <= 0) this.attacking = false;
        }
    }
}
SimPlayer.prototype.getSwingLiveInterval = playerMethods.getSwingLiveInterval;
SimPlayer.prototype.endSwingTail = playerMethods.endSwingTail;

const isIncomingDefenseThreat = runInNewContext(`(${extractMethod(botSource, 'isIncomingDefenseThreat', { exportedFunction: true })})`, { Number });
const botMethods = compileMethods(botSource,
    ['_resetDefenseIntent', 'observeDefenseIntent', 'tryDeflect', 'advanceDeflectReady', 'commitDeflect'],
    { isIncomingDefenseThreat, DEFENSE_DODGE_LATCH_SECONDS: 0.25, Math, Infinity });

export function createBot({ difficulty = 'hard', x = 0, z = 0, feetY = 0, team = 'blue', committed = false } = {}) {
    const tuning = BOT_DIFFICULTY[difficulty];
    const bot = Object.assign(Object.create(botMethods), {
        name: `Bot-${difficulty}`,
        team,
        alive: true,
        _sizeScale: 1,
        position: new Vector3(x, feetY, z),
        attacking: false,
        attackTimer: 0,
        deflectionCount: 0,
        deflectChance: tuning.deflectChance,
        reactionTime: tuning.reactionTime,
        windUpTime: tuning.windUp,
        mishitRate: tuning.mishitRate,
        deflectReadyAt: Infinity,
        getPosition() { return new Vector3(this.position.x, this.position.y + 1.2, this.position.z); },
        getFeetY() { return this.position.y; }
    });
    bot._resetDefenseIntent();
    if (committed) {
        // Alerted, decided to deflect, reaction + wind-up already finished.
        bot._deflectDecided = true;
        bot._willDeflect = true;
        bot._defenseIntent = 'deflect';
        bot.reactionTimer = bot.reactionTime;
        bot.windUpTimer = bot.windUpTime;
        bot.windUpCommitted = true;
    }
    return bot;
}

export function createBall({ position, speed, target }) {
    return {
        active: true,
        position: new Vector3(position.x, position.y, position.z),
        _prevPosition: new Vector3(position.x, position.y, position.z),
        velocity: new Vector3(),
        currentSpeed: speed,
        attackRange: ATTACK_RANGE,
        radius: BALL_RADIUS,
        hitRange: HIT_RANGE,
        effectiveHitRange: HIT_RANGE + Math.min(speed * 0.003, 2.0),
        _noHitTimer: 0,
        _forceHit: false,
        _warmup: false,
        _affixGhost: false,
        _proximityRange: 1.5,
        aimed: true,
        targetPlayer: target
    };
}

// Game stub around the real contact resolution. The two handlers keep the
// real contract: the player handler applies the facing gate at ball.position
// (returns false, ball untouched) and reads the G3 lead before mutating;
// the bot handler just records the contact.
export function createContactGame({ player, bots = [], ball, throwerTeam = 'red' }) {
    const events = [];
    return {
        ball,
        player,
        bots,
        events,
        network: null,
        _practiceMode: false,
        _ffa: false,
        lastDeflectorTeam: throwerTeam,
        lastDeflector: null,
        _deflectContactOffset: 0,
        getAllTargets() { return [player, ...bots].filter(Boolean); },
        capsuleHitTest,
        _frameFraction: frameFraction,
        _localSwingInterval: localSwingInterval,
        _localDeflectLeadMs: localDeflectLeadMs,
        _isDeflectFacingBall: isDeflectFacingBall,
        _resolveFrameContacts: resolveFrameContacts,
        _followThroughDeflect: followThroughDeflect,
        handlePlayerDeflection() {
            if (!this._isDeflectFacingBall(player.aim, player.position, this.ball.position)) {
                events.push({ kind: 'facing-reject' });
                return false;
            }
            const leadMs = this._localDeflectLeadMs();
            player.attacking = false;
            events.push({ kind: 'player', point: this.ball.position.clone(), leadMs, offset: this._deflectContactOffset });
            return true;
        },
        handleBotDeflection(bot) {
            events.push({ kind: 'bot', bot, mishit: bot._mishit, point: this.ball.position.clone() });
        },
        handleHit(target) {
            events.push({ kind: 'hit', target, point: this.ball.position.clone() });
        }
    };
}

// Straight ball whose centre reaches the target's body capsule (radius
// ballR + 0.4 + speed bonus around the axis x/z) at `contactTime` while
// travelling along `dir` at the aim height. at(t) is the ball centre at t.
export function straightPath({ speed, contactTime, feetY = 0, dir = { x: -1, y: 0, z: 0 }, aimY = null, centre = { x: 0, z: 0 } }) {
    const bonus = Math.min(speed * 0.003, 2.0);
    const R = BALL_RADIUS + 0.4 + bonus;
    const y = aimY ?? feetY + EYE_HEIGHT + CHEST_OFFSET;
    const contact = { x: centre.x - dir.x * R, y: y - dir.y * R, z: centre.z - dir.z * R };
    return {
        speed,
        dir,
        contact,
        at(t, out = new Vector3()) {
            const travel = speed * (t - contactTime);
            out.x = contact.x + dir.x * travel;
            out.y = contact.y + dir.y * travel;
            out.z = contact.z + dir.z * travel;
            return out;
        }
    };
}

// One approach at a grounded (or perched) local player at the origin. Clicks
// are continuous wall-clock times; a click in [W[j-1], W[j]) is handled before
// loop j (Player.tryAttack). Loop j's ball segment covers [(j-1)·dt, j·dt].
export function simulateApproach({ path, dt, clicks = [], feetY = 0, maxTime = 4, order = 'new' }) {
    const aim = { x: -path.dir.x, y: -path.dir.y, z: -path.dir.z };
    const player = new SimPlayer({ feetY, aim });
    const speed = path.speed;
    const ball = createBall({ position: path.at(0), speed, target: player });
    const game = createContactGame({ player, ball, throwerTeam: 'red' });
    let clickIndex = 0;
    let acceptedClick = null;
    const frames = Math.ceil(maxTime / dt);
    // Old order scratch.
    const eye = player.position;
    const range = ATTACK_RANGE + Math.min(speed * 0.003, 3.0);
    const capsuleRadius = 0.4 + (ball.effectiveHitRange - HIT_RANGE);
    const sample = new Vector3();
    let hasPrev = false;
    for (let j = 1; j <= frames; j++) {
        const wall = j * dt;
        while (clickIndex < clicks.length && clicks[clickIndex] < wall) {
            if (player.tryAttack()) acceptedClick = clicks[clickIndex];
            clickIndex++;
        }
        player.update(dt);
        if (order === 'new') {
            ball._prevPosition.copy(ball.position);
            path.at(wall, ball.position);
            game.events.length = 0;
            const result = game._resolveFrameContacts(dt, true, false);
            if (result === 'deflect') {
                const event = game.events.find(entry => entry.kind === 'player');
                return {
                    outcome: 'deflect',
                    leadMs: event.leadMs,
                    tier: classifyDeflectLead(event.leadMs),
                    point: event.point,
                    contactTime: wall - dt + event.offset,
                    clickTime: acceptedClick,
                    frame: j
                };
            }
            if (result === 'hit') {
                const entry = segmentCapsuleEntry(ball._prevPosition, ball.position, targetFeetY(player), 1.7, 0, 0, BALL_RADIUS + capsuleRadius);
                return { outcome: 'hit', frame: j, hitTime: wall - dt + Math.max(0, entry) * dt };
            }
            continue;
        }
        // Pre-G2 frame-edge order.
        if (player.attacking) {
            const p = ball.position;
            const distance = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
            if (distance < range || (hasPrev && segmentIntersectsSphere(ball._prevPosition, p, eye, range))) {
                const leadMs = localDeflectLeadMs.call(game);
                return { outcome: 'deflect', leadMs, tier: classifyDeflectLead(leadMs), point: p.clone(), contactTime: wall - dt, clickTime: acceptedClick, frame: j };
            }
        }
        ball._prevPosition.copy(ball.position);
        hasPrev = true;
        path.at(wall, ball.position);
        const feet = targetFeetY(player);
        if (capsuleContact(ball.position, 0, 0, feet, 1.7, capsuleRadius, BALL_RADIUS)) {
            return { outcome: 'hit', frame: j, hitTime: wall };
        }
        const prev = ball._prevPosition;
        const travelled = prev.distanceTo(ball.position);
        const steps = sweptHitStepCount(travelled, BALL_RADIUS + capsuleRadius);
        for (let s = 1; s <= steps; s++) {
            const f = s / (steps + 1);
            sample.lerpVectors(prev, ball.position, f);
            if (capsuleContact(sample, 0, 0, feet, 1.7, capsuleRadius, BALL_RADIUS)) {
                return { outcome: 'hit', frame: j, hitTime: wall - dt + f * dt };
            }
        }
    }
    return { outcome: 'none' };
}

// One approach at a bot at the origin (feet 0) along −x at chest height, the
// ball thrown by the other team. `committed` bots already finished reaction +
// wind-up. Old order: observeDefenseIntent + tryDeflect on the frame-start
// state, then ball step + swept hit test; new order: advanceDeflectReady, ball
// step, Game._resolveFrameContacts.
export function simulateBotApproach({ speed, dt, contactTime, difficulty = 'hard', committed = true, order = 'new', maxTime = 2 }) {
    const bot = createBot({ difficulty, committed });
    const idle = new SimPlayer({ team: 'red', x: -40 });
    const path = straightPath({ speed, contactTime, aimY: 1.25 });
    const ball = createBall({ position: path.at(0), speed, target: bot });
    ball.velocity.set(path.dir.x * speed, path.dir.y * speed, path.dir.z * speed);
    const game = createContactGame({ player: idle, bots: [bot], ball, throwerTeam: 'red' });
    const capsuleRadius = 0.4 + (ball.effectiveHitRange - HIT_RANGE);
    const sample = new Vector3();
    const frames = Math.ceil(maxTime / dt);
    for (let j = 1; j <= frames; j++) {
        const wall = j * dt;
        game.events.length = 0;
        if (order === 'new') {
            bot.advanceDeflectReady(ball, dt);
            ball._prevPosition.copy(ball.position);
            path.at(wall, ball.position);
            const result = game._resolveFrameContacts(dt, true, false);
            if (result === 'deflect') {
                const event = game.events.find(entry => entry.kind === 'bot');
                return { outcome: 'deflect', mishit: event.mishit, point: event.point, frame: j };
            }
            if (result === 'hit') return { outcome: 'hit', frame: j };
            continue;
        }
        bot.observeDefenseIntent(ball);
        if (bot.tryDeflect(ball, dt)) return { outcome: 'deflect', mishit: bot._mishit, point: ball.position.clone(), frame: j };
        ball._prevPosition.copy(ball.position);
        path.at(wall, ball.position);
        if (capsuleContact(ball.position, 0, 0, 0, 1.7, capsuleRadius, BALL_RADIUS)) return { outcome: 'hit', frame: j };
        const steps = sweptHitStepCount(ball._prevPosition.distanceTo(ball.position), BALL_RADIUS + capsuleRadius);
        for (let s = 1; s <= steps; s++) {
            sample.lerpVectors(ball._prevPosition, ball.position, s / (steps + 1));
            if (capsuleContact(sample, 0, 0, 0, 1.7, capsuleRadius, BALL_RADIUS)) return { outcome: 'hit', frame: j };
        }
    }
    return { outcome: 'none' };
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
