// G4 simulation harness: uncapped-rally approaches against the REAL swing code
// (js/player.js Player.tryAttack / _stepAttackTimers / _openSwingForSpeed /
// _recoverFromWhiff / onSuccessfulDeflect), the REAL G2 contact solver
// (Game._resolveFrameContacts via tests/frame-contact-sim.mjs), the REAL G4
// game hooks (Game.shouldRearmAfterWhiff / _trackThreatAssignment /
// _localContactMs) and the REAL bot decision (js/bot.js observeDefenseIntent /
// advanceDeflectReady / commitDeflect). Only stamina regen is mirrored.
//
// Rally geometry: the ball is assigned to the defender at `distance` (25 u =
// the 1v1 exchange distance the card's wall numbers use) and flies straight
// at r · 17 u/s. Frames: clicks → Player timers → ball step → in-frame
// contacts → assignment bookkeeping (Game.updatePlayerThreat order).
import { registerHooks } from 'node:module';

import {
    BOT_DIFFICULTY,
    Vector3,
    createBall,
    createContactGame,
    mulberry32,
    straightPath
} from './frame-contact-sim.mjs';
import { compileGameMethod } from './game-source.mjs';
import { predictContactMs } from '../js/perfect-deflect.js';
import { targetFeetY } from '../js/combat.js';

const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});

export const playerModule = await import('../js/player.js');
export const botModule = await import('../js/bot.js');
const { Player } = playerModule;
const { Bot, RALLY_CRACK_SETTINGS, DEFENSE_SQUEEZE_MARGIN_SECONDS } = botModule;

export const BASE_SPEED = 17;
export const RALLY_DISTANCE = 25;
export const STATES = Object.freeze({ PLAYING: 'PLAYING', COUNTDOWN: 'COUNTDOWN' });

export const trackThreatAssignment = compileGameMethod('_trackThreatAssignment');
export const localContactMs = compileGameMethod('_localContactMs', { predictContactMs, targetFeetY });
export const shouldRearmAfterWhiff = compileGameMethod('shouldRearmAfterWhiff', { STATES });

// A real Player (prototype methods from js/player.js) with only the fields the
// swing path reads. `legacy: true` pins r at 0 — the exact pre-G4 code path.
export function createSwingPlayer({ game = null, legacy = false, literalRearm = false } = {}) {
    const player = Object.create(Player.prototype);
    Object.assign(player, {
        game,
        position: new Vector3(0, 1.7, 0),
        height: 1.7,
        alive: true,
        team: 'blue',
        _sizeScale: 1,
        aim: { x: 1, y: 0, z: 0 },
        attacking: false,
        attackActive: 0,
        attackCooldown: 0,
        attackDuration: 0.6,
        swingAge: 0,
        swingClickDt: 0,
        _swingAgePending: false,
        _swingLiveWindow: 0,
        swingTail: false,
        _swingSpeedRatio: 0,
        _swingWhiffPending: false,
        _whiffStreak: 0,
        canAttack: true,
        stamina: 100,
        staminaMax: 100,
        exhausted: false,
        deflectFatigue: 0,
        _lastDeflectAttemptAt: -Infinity,
        consecutiveMisses: 0,
        knifeGroup: null,
        _rapidDeflect: false,
        runeBonuses: null
    });
    if (legacy) player._ballSpeedRatio = () => 0;
    if (literalRearm) {
        // Card-literal re-arm (no first-whiff-in-a-row gate), for comparison.
        player._recoverFromWhiff = function () {
            this._whiffStreak = 0;
            return Player.prototype._recoverFromWhiff.call(this);
        };
    }
    return player;
}

// Mirror of Player.update's stamina regen (not the code under test).
function regenStamina(player, dt) {
    const rate = player.exhausted ? 20 * 0.4 : 20;
    player.stamina = Math.min(player.staminaMax, player.stamina + rate * dt);
    if (player.exhausted && player.stamina >= 15) player.exhausted = false;
}

// Game stub: G2 contact solver + the G4 hooks, compiled from js/game.js.
export function createRallyGame(player, ball, { rearm = true } = {}) {
    const game = createContactGame({ player, ball, throwerTeam: 'red' });
    Object.assign(game, {
        state: STATES.PLAYING,
        _trackThreatAssignment: trackThreatAssignment,
        _localContactMs: localContactMs,
        shouldRearmAfterWhiff: rearm ? shouldRearmAfterWhiff : () => false,
        rearmCalls: 0,
        rearmGrants: 0
    });
    if (rearm) {
        game.shouldRearmAfterWhiff = function (...args) {
            this.rearmCalls++;
            const granted = shouldRearmAfterWhiff.apply(this, args);
            if (granted) this.rearmGrants++;
            return granted;
        };
    }
    return game;
}

const performanceRef = globalThis.performance;

// One incoming ball. The ball waits at `distance` (another player's target)
// until `assignAt`, then flies at the player; contact (G1 capsule) at
// assignAt + (distance − R) / speed. `clicks(t)` → click times (s) or a
// `spam: true` flag (a click attempt on every frame). Returns
// { outcome: 'deflect'|'hit'|'none', tier info, rearmGrants, clickCount }.
export function simulateRallyApproach({
    ratio, dt, distance = RALLY_DISTANCE, assignAt = 1.5, clicks = [], spam = false,
    spamStart = 0, legacy = false, rearm = true, literalRearm = false, maxTime = assignAt + 3, recordClicks = false
}) {
    const clickFrames = recordClicks ? [] : null;
    const speed = ratio * BASE_SPEED;
    const bonus = Math.min(speed * 0.003, 2.0);
    const capsuleGap = 0.47 + 0.4 + bonus;
    const contactTime = assignAt + (distance - capsuleGap) / speed;
    const path = straightPath({ speed, contactTime });
    const player = createSwingPlayer({ legacy, literalRearm });
    const other = { name: 'thrower', team: 'red', alive: true };
    const ball = createBall({ position: path.at(assignAt), speed, target: other });
    ball.baseSpeed = BASE_SPEED;
    const game = createRallyGame(player, ball, { rearm });
    player.game = game;
    const startPoint = path.at(assignAt);
    let clickIndex = 0;
    let clickCount = 0;
    const frames = Math.ceil(maxTime / dt);
    const clock = { now: () => 0 };
    globalThis.performance = clock;
    try {
        for (let j = 1; j <= frames; j++) {
            const frameStart = (j - 1) * dt;
            const wall = j * dt;
            clock.now = () => frameStart * 1000;
            if (frameStart >= assignAt) ball.targetPlayer = player;
            if (spam) {
                if (frameStart >= spamStart && player.tryAttack()) {
                    clickCount++;
                    clickFrames?.push(j);
                }
            } else {
                while (clickIndex < clicks.length && clicks[clickIndex] < wall) {
                    if (player.tryAttack()) clickCount++;
                    clickIndex++;
                }
            }
            regenStamina(player, dt);
            player._stepAttackTimers(dt);
            ball._prevPosition.copy(ball.position);
            if (wall > assignAt) path.at(wall, ball.position);
            else ball.position.copy(startPoint);
            game.events.length = 0;
            const result = game._resolveFrameContacts(dt, true, false);
            game._trackThreatAssignment();
            if (result === 'deflect') {
                const event = game.events.find(entry => entry.kind === 'player');
                player.onSuccessfulDeflect();
                return {
                    outcome: 'deflect', leadMs: event.leadMs, contactTime, frame: j,
                    rearmGrants: game.rearmGrants, rearmCalls: game.rearmCalls, clickCount, player
                };
            }
            if (result === 'hit') {
                return { outcome: 'hit', contactTime, frame: j, rearmGrants: game.rearmGrants, rearmCalls: game.rearmCalls, clickCount, player };
            }
        }
        return { outcome: 'none', contactTime, rearmGrants: game.rearmGrants, rearmCalls: game.rearmCalls, clickCount, clickFrames, player };
    } finally {
        globalThis.performance = performanceRef;
    }
}

function gaussian(random) {
    return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

// Frames between two max-rate spam clicks once the cycle is steady (no ball
// ever reaches the player: every swing whiffs). The spam timeline is periodic
// with this length, so an assignment frame drawn uniformly from one cycle
// gives an exactly uniform spam phase.
export function spamCycleFrames({ ratio, dt, legacy = false }) {
    const result = simulateRallyApproach({ ratio, dt, assignAt: 1e9, spam: true, legacy, rearm: false, maxTime: 4, recordClicks: true });
    const frames = result.clickFrames;
    return frames[frames.length - 1] - frames[frames.length - 2];
}

// Timed player: one click at contact − lead, lead ~ N(mean, sd) ms.
// Spam: a click attempt on every frame (max rate) from t = 0; the ball is
// assigned at 2 s + a uniform whole number of frames within one spam cycle.
export function rallyStudy({ mode, ratio, hz, approaches, seed, lead = { mean: 80, sd: 30 }, legacy = false, rearm = true, literalRearm = false }) {
    const random = mulberry32(seed);
    const dt = 1 / hz;
    let success = 0;
    let rearmGrants = 0;
    let perfect = 0;
    const cycle = mode === 'spam' ? spamCycleFrames({ ratio, dt, legacy }) : 0;
    for (let index = 0; index < approaches; index++) {
        let result;
        if (mode === 'spam') {
            const assignAt = 2 + Math.floor(random() * cycle) * dt;
            result = simulateRallyApproach({ ratio, dt, assignAt, spam: true, legacy, rearm, literalRearm });
        } else {
            const assignAt = 1.5 + Math.floor(random() * 30) * dt;
            const speed = ratio * BASE_SPEED;
            const capsuleGap = 0.87 + Math.min(speed * 0.003, 2.0);
            const contactTime = assignAt + (RALLY_DISTANCE - capsuleGap) / speed;
            const click = contactTime - (lead.mean + lead.sd * gaussian(random)) / 1000;
            result = simulateRallyApproach({ ratio, dt, assignAt, clicks: [click], legacy, rearm, literalRearm });
        }
        if (result.outcome === 'deflect') {
            success++;
            if (result.leadMs <= 60) perfect++;
        }
        rearmGrants += result.rearmGrants;
    }
    return { approaches, success, rate: success / approaches, perfect, rearmGrants };
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

// A real Bot (prototype from js/bot.js) with the defense fields its
// constructor sets. `legacy: true` removes the G4 curve and squeeze fields —
// the guarded code then runs exactly the pre-G4 path.
export function createRallyBot({ difficulty = 'hard', legacy = false } = {}) {
    const tuning = BOT_DIFFICULTY[difficulty];
    const crack = RALLY_CRACK_SETTINGS[difficulty];
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, {
        name: `Bot-${difficulty}`,
        difficulty,
        team: 'red',
        alive: true,
        _sizeScale: 1,
        position: new Vector3(0, 0, 0),
        attacking: false,
        attackTimer: 0,
        deflectionCount: 0,
        deflectChance: tuning.deflectChance,
        reactionTime: tuning.reactionTime,
        windUpTime: tuning.windUp,
        mishitRate: tuning.mishitRate,
        deflectReadyAt: Infinity,
        deflectDecayStart: legacy ? undefined : crack.r0,
        deflectDecay: legacy ? undefined : crack.decay,
        defenseTimeFloor: legacy ? undefined : crack.floor,
        defenseSqueezeMargin: DEFENSE_SQUEEZE_MARGIN_SECONDS,
        animator: null,
        getPosition() { return new Vector3(this.position.x, this.position.y + 1.2, this.position.z); },
        getFeetY() { return this.position.y; }
    });
    bot._resetDefenseIntent();
    return bot;
}

// One incoming ball at a bot: assigned at `distance`, straight at chest
// height at r · 17 u/s; the real advanceDeflectReady + in-frame contact.
export function simulateBotRallyApproach({ bot, ratio, dt = 1 / 60, distance = RALLY_DISTANCE, maxTime = 4 }) {
    const speed = ratio * BASE_SPEED;
    const capsuleGap = 0.87 + Math.min(speed * 0.003, 2.0);
    const contactTime = (distance - capsuleGap) / speed;
    const path = straightPath({ speed, contactTime, aimY: 1.25 });
    const idle = createSwingPlayer();
    idle.team = 'blue';
    idle.position.set(-400, 1.7, 0);
    const ball = createBall({ position: path.at(0), speed, target: bot });
    ball.baseSpeed = BASE_SPEED;
    ball.velocity.set(path.dir.x * speed, path.dir.y * speed, path.dir.z * speed);
    const game = createContactGame({ player: idle, bots: [bot], ball, throwerTeam: 'blue' });
    bot.attacking = false;
    bot.attackTimer = 0;
    bot._resetDefenseIntent();
    const frames = Math.ceil(maxTime / dt);
    for (let j = 1; j <= frames; j++) {
        const wall = j * dt;
        bot.advanceDeflectReady(ball, dt);
        ball._prevPosition.copy(ball.position);
        path.at(wall, ball.position);
        game.events.length = 0;
        const result = game._resolveFrameContacts(dt, true, false);
        if (result === 'deflect') {
            const event = game.events.find(entry => entry.kind === 'bot');
            return { outcome: 'deflect', mishit: event.mishit, frame: j, intent: 'deflect' };
        }
        if (result === 'hit') return { outcome: 'hit', frame: j };
    }
    return { outcome: 'none' };
}

// A rally against a human who always returns: every deflect adds +0.3× base
// (uncapped). The bot's first ball arrives at 1.3× (the human returned the
// 1× serve). Returns the ratio the bot cracked at and its return count.
export function simulateBotRally({ difficulty, seed, legacy = false, startRatio = 1.3, dt = 1 / 60, distance = RALLY_DISTANCE, capRatio = 40 }) {
    const random = mulberry32(seed);
    const realRandom = Math.random;
    Math.random = random;
    try {
        const bot = createRallyBot({ difficulty, legacy });
        let ratio = startRatio;
        let returns = 0;
        while (ratio < capRatio) {
            const result = simulateBotRallyApproach({ bot, ratio, dt, distance });
            bot.attacking = false;
            bot.attackTimer = 0;
            if (result.outcome !== 'deflect') return { crackRatio: ratio, returns };
            returns++;
            ratio = Math.round((ratio + 0.6) * 1000) / 1000; // bot +0.3, human +0.3
        }
        return { crackRatio: ratio, returns, capped: true };
    } finally {
        Math.random = realRandom;
    }
}

export function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
