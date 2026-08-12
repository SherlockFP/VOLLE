import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DIFFICULTIES = {
    easy: { chance: 0.35, speed: 3.5 },
    medium: { chance: 0.75, speed: 5.5 },
    hard: { chance: 0.92, speed: 7.5 }
};
const MAX_DEFENSE_SPEED = 10;
const DODGE_LATCH_SECONDS = 0.25;

function makeRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function makeState() {
    return { decided: false, willDeflect: false, intent: 'none', sign: 0, latch: 0 };
}

function observe(state, { active = true, targeted = true, inAlert = true } = {}, chance, rng) {
    if (!active || !targeted) {
        state.decided = false; state.willDeflect = false; state.intent = 'none'; state.sign = 0;
        state.latch = 0;
        return state.intent;
    }
    if (!inAlert) {
        if ((state.intent === 'dodge-left' || state.intent === 'dodge-right') && state.latch > 0) return state.intent;
        state.decided = false; state.willDeflect = false; state.intent = 'none'; state.sign = 0; state.latch = 0;
        return state.intent;
    }
    if (!state.decided) {
        state.decided = true;
        state.willDeflect = rng() < chance;
        if (state.willDeflect) state.intent = 'deflect';
        else {
            state.sign = rng() < 0.5 ? -1 : 1;
            state.latch = DODGE_LATCH_SECONDS;
            state.intent = state.sign < 0 ? 'dodge-left' : 'dodge-right';
        }
    }
    return state.intent;
}

function advanceLatch(state, dt) {
    state.latch = Math.max(0, state.latch - dt);
    if (state.latch <= Number.EPSILON) state.latch = 0;
}

function defenseStep(intent, sign, speed, dt) {
    return intent === 'deflect' ? 0 : Math.min(MAX_DEFENSE_SPEED, speed * 1.8) * sign * dt;
}

test('1000 seeded opportunities retain exact difficulty chance commits', () => {
    const expected = { easy: 346, medium: 748, hard: 920 };
    for (const [difficulty, { chance }] of Object.entries(DIFFICULTIES)) {
        let commits = 0;
        for (let i = 0; i < 1000; i++) {
            const state = makeState();
            observe(state, {}, chance, makeRng(Math.imul(i + 1, 2654435761)));
            if (state.willDeflect) commits++;
        }
        assert.equal(commits, expected[difficulty], `${difficulty} chance sequence changed`);
    }
});

test('successful deflect intent never produces a dodge sample, including the first alert frame', () => {
    for (const { chance, speed } of Object.values(DIFFICULTIES)) {
        const state = makeState();
        observe(state, {}, chance, () => 0);
        assert.equal(state.intent, 'deflect');
        for (let frame = 0; frame < 120; frame++) assert.equal(defenseStep(state.intent, state.sign, speed, 1 / 60), 0);
    }
});

test('declined intent picks one stable dodge side and uses one capped movement branch', () => {
    const state = makeState();
    const rolls = [0.99, 0.1];
    observe(state, {}, DIFFICULTIES.hard.chance, () => rolls.shift());
    assert.equal(state.intent, 'dodge-left');
    for (let frame = 0; frame < 30; frame++) {
        assert.equal(observe(state, {}, DIFFICULTIES.hard.chance, () => { throw new Error('intent rerolled'); }), 'dodge-left');
        assert.equal(defenseStep(state.intent, state.sign, DIFFICULTIES.hard.speed, 1 / 60), -1 / 6);
    }
});

test('a declined dodge remains exclusive through its 250ms latch after leaving alert range', () => {
    const state = makeState();
    observe(state, {}, DIFFICULTIES.hard.chance, () => 0.99);
    assert.equal(state.intent, 'dodge-right');
    for (let frame = 0; frame < 15; frame++) {
        assert.equal(observe(state, { inAlert: false }, DIFFICULTIES.hard.chance, () => { throw new Error('latch rerolled'); }), 'dodge-right');
        assert.equal(defenseStep(state.intent, state.sign, DIFFICULTIES.hard.speed, 1 / 60), 1 / 6);
        advanceLatch(state, 1 / 60);
    }
    assert.equal(state.latch, 0);
    assert.equal(observe(state, { inAlert: false }, DIFFICULTIES.hard.chance, () => 0), 'none');
});

test('host and client play one deflect animation per opportunity', () => {
    const host = { braced: false, plays: 0 };
    const hostDecision = () => { if (!host.braced) { host.braced = true; host.plays++; } };
    hostDecision(); // alert edge
    // Contact consumes the existing telegraph rather than replaying it.
    assert.equal(host.plays, 1);

    const client = { intent: 'none', telegraphed: false, attacking: false, plays: 0 };
    const receive = ({ intent, attacking }) => {
        const previousIntent = client.intent;
        client.intent = intent;
        if (intent === 'deflect' && previousIntent !== 'deflect') { client.telegraphed = true; client.plays++; }
        if (attacking && !client.attacking && !client.telegraphed) client.plays++;
        client.attacking = attacking;
        if (!attacking && intent !== 'deflect') client.telegraphed = false;
    };
    receive({ intent: 'deflect', attacking: false });
    receive({ intent: 'none', attacking: true });
    receive({ intent: 'none', attacking: false });
    assert.equal(client.plays, 1);
});

test('hard defense cap and deterministic endpoint are stable at 20/60/144 Hz', () => {
    const endpoint = dt => {
        let x = 0, elapsed = 0;
        while (elapsed < 1 - 1e-12) {
            const step = Math.min(dt, 1 - elapsed);
            x += defenseStep('dodge-right', 1, DIFFICULTIES.hard.speed, step);
            elapsed += step;
        }
        return x;
    };
    const endpoints = [1 / 20, 1 / 60, 1 / 144].map(endpoint);
    assert.ok(Math.max(...endpoints) - Math.min(...endpoints) <= 0.15, `endpoint drift ${endpoints}`);
    assert.ok(Math.abs(defenseStep('dodge-right', 1, DIFFICULTIES.hard.speed, 1 / 60)) <= 0.17);
    assert.equal(Math.abs(defenseStep('dodge-right', 1, DIFFICULTIES.hard.speed, 1)), 10);
});

test('intent resets for inactive, untargeted, and out-of-alert opportunities', () => {
    for (const gate of [{ active: false }, { targeted: false }, { inAlert: false }]) {
        const state = makeState();
        observe(state, {}, DIFFICULTIES.medium.chance, () => 0);
        assert.equal(observe(state, gate, DIFFICULTIES.medium.chance, () => 0), 'none');
        assert.deepEqual(state, makeState());
    }
});

test('source establishes intent before update, syncs yaw/intent/strafe/attack, and applies attack edge', async () => {
    const [bot, game, main] = await Promise.all([
        readFile(new URL('../js/bot.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/game.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/main.js', import.meta.url), 'utf8')
    ]);
    assert.match(bot, /observeDefenseIntent\(ball, rng = Math\.random\)/);
    assert.match(bot, /const DEFENSE_DODGE_LATCH_SECONDS = 0\.25;/);
    assert.match(bot, /this\._defenseDodgeLatch = DEFENSE_DODGE_LATCH_SECONDS;/);
    assert.match(bot, /Math\.min\(MAX_DEFENSE_SPEED, moveSpeed \* 1\.8\)/);
    assert.match(bot, /facts\.strafe = this\._defenseStrafe;/);
    const hostMovement = game.slice(game.indexOf('// Bot AI only on host'), game.indexOf('if (this.player._rocketQueued)'));
    assert.ok(hostMovement.indexOf('bot.observeDefenseIntent(this.ball);') < hostMovement.indexOf('bot.update(dt, this.ball);'));
    assert.equal((main.match(/ry: b\.group\?\.rotation\.y \?\? 0/g) || []).length, 2);
    assert.equal((main.match(/intent: b\._defenseIntent \|\| 'none', strafe: b\._defenseStrafe \|\| 0,/g) || []).length, 2);
    assert.match(game, /p\._defenseIntent = typeof bd\.intent === 'string' \? bd\.intent : 'none';/);
    const tryDeflect = bot.slice(bot.indexOf('    tryDeflect(ball, dt = 0.016) {'), bot.indexOf('    isAttacking() {'));
    assert.doesNotMatch(tryDeflect, /animator\?\.play/, 'contact must not replay the alert telegraph');
    assert.match(game, /if \(p\._defenseIntent === 'deflect' && previousIntent !== 'deflect'\) \{\s*p\._botSyncTelegraphed = true;\s*p\.animator\?\.play\('deflect'\);/);
    assert.match(game, /if \(attacking && !p\._botSyncAttacking && !p\._botSyncTelegraphed\) \{\s*p\.attackTimer = 0\.3;\s*p\.animator\?\.play\('deflect'\);/);
});
