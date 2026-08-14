// First-session bot guard: mirrors the tiny decision branch in Bot.tryDeflect.
// The real Bot imports Three.js, so this keeps the decision contract directly
// executable under node:test while source checks pin its integration boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DIFFICULTIES = {
    easy: 0.35,
    medium: 0.75,
    hard: 0.92
};

function makeState() {
    return { _deflectDecided: false, _willDeflect: false, _firstSoloDeflectGuard: { forceNextOpportunity: false } };
}

function decide(state, chance, rng) {
    if (state._deflectDecided) return state._willDeflect;
    state._deflectDecided = true;
    const rolledWillDeflect = rng() < chance;
    const guard = state._firstSoloDeflectGuard;
    if (guard?.forceNextOpportunity) {
        state._willDeflect = true;
        state._firstSoloDeflectGuard = null;
    } else {
        state._willDeflect = rolledWillDeflect;
        if (guard) state._firstSoloDeflectGuard = rolledWillDeflect ? null : { forceNextOpportunity: true };
    }
    return state._willDeflect;
}

function resolveFirstSoloAimFeedback(state, { connected = false, coneRejected = false, successful = false } = {}) {
    if (connected) return [];
    if (coneRejected && state.pending) {
        state.pending = false;
        state.attacking = false;
        return ['BALL BEHIND — TURN TO FACE IT', 'deflect-reject'];
    }
    if (successful) state.pending = false;
    return [];
}

test('first-session guard converts only opportunity two after a declined opening roll at every difficulty', () => {
    for (const [difficulty, chance] of Object.entries(DIFFICULTIES)) {
        const state = makeState();
        assert.equal(decide(state, chance, () => 0.99), false, `${difficulty}: opening chance roll may decline`);
        assert.deepEqual(state._firstSoloDeflectGuard, { forceNextOpportunity: true }, `${difficulty}: exactly one retry is armed`);
        state._deflectDecided = false; // ball leaves/re-enters the readable alert range
        assert.equal(decide(state, chance, () => 0.99), true, `${difficulty}: next opportunity commits`);
        assert.equal(state._firstSoloDeflectGuard, null, `${difficulty}: retry cannot affect later opportunities`);
    }
});

test('a natural opening commitment keeps ordinary difficulty behavior and consumes the guard', () => {
    const state = makeState();
    assert.equal(decide(state, DIFFICULTIES.medium, () => 0.1), true);
    assert.equal(state._firstSoloDeflectGuard, null);
    state._deflectDecided = false;
    assert.equal(decide(state, DIFFICULTIES.medium, () => 0.99), false, 'later decisions remain the normal chance roll');
});

test('first offline cone rejection gives exactly one aim correction and cancels the swing', () => {
    const state = { pending: true, attacking: true };
    assert.deepEqual(resolveFirstSoloAimFeedback(state, { coneRejected: true }), [
        'BALL BEHIND — TURN TO FACE IT', 'deflect-reject'
    ]);
    assert.deepEqual(state, { pending: false, attacking: false });
    assert.deepEqual(resolveFirstSoloAimFeedback(state, { coneRejected: true }), []);
});

test('a successful offline deflect clears the one-shot feedback without a cue', () => {
    const state = { pending: true, attacking: true };
    assert.deepEqual(resolveFirstSoloAimFeedback(state, { successful: true }), []);
    assert.deepEqual(state, { pending: false, attacking: true });
});

test('connected matches never use first-solo aim feedback', () => {
    const state = { pending: true, attacking: true };
    assert.deepEqual(resolveFirstSoloAimFeedback(state, { connected: true, coneRejected: true }), []);
    assert.deepEqual(state, { pending: true, attacking: true });
});

test('guard is explicitly scoped to the first offline opposing bot without automatic FTUE hints', async () => {
    const [bot, game, main] = await Promise.all([
        readFile(new URL('../js/bot.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/game.js', import.meta.url), 'utf8'),
        readFile(new URL('../js/main.js', import.meta.url), 'utf8')
    ]);

    assert.match(bot, /armFirstSoloDeflectGuard\(\) \{\s*this\._firstSoloDeflectGuard = \{ forceNextOpportunity: false \};/);
    assert.match(bot, /const rolledWillDeflect = rng\(\) < this\.deflectChance;/);
    assert.match(bot, /if \(guard\?\.forceNextOpportunity\) \{\s*this\._willDeflect = true;/);
    assert.match(bot, /Math\.random\(\) < this\.mishitRate/, 'guard must not bypass mishit variance');
    assert.match(game, /armFirstSoloBotDeflectGuard\(\) \{\s*this\._firstSoloBotDeflectGuardArmed = true;\s*this\._firstSoloAimFeedbackArmed = true;/);
    assert.match(game, /if \(!this\.network\?\.connected && this\._firstSoloBotDeflectGuardArmed\) \{[\s\S]*?this\.bots\.find\(bot => bot\.team !== this\.player\.team\)[\s\S]*?this\._firstSoloAimFeedbackPending = this\._firstSoloAimFeedbackArmed;[\s\S]*?this\._firstSoloBotDeflectGuardArmed = false;/);
    assert.match(game, /if \(!this\._isDeflectFacingBall\(aimDir, pos, this\.ball\.position\)\) \{[\s\S]*?this\.player\.attacking = false;[\s\S]*?this\.ui\.showMessage\?\.\('BALL BEHIND — TURN TO FACE IT', 900\);[\s\S]*?this\.audio\.playCue\?\.\('deflect-reject'\);/);
    assert.match(game, /if \(!this\.network\?\.connected\) this\._firstSoloAimFeedbackPending = false;/);
    const guardFn = main.slice(main.indexOf('_armFirstSoloBotGuard()'), main.indexOf('setupMenuHandlers()', main.indexOf('_armFirstSoloBotGuard()')));
    assert.match(guardFn, /this\.game\.armFirstSoloBotDeflectGuard\(\);/);
    assert.doesNotMatch(main, /_pendingFirstMatchHints|_runFirstMatchHints/);
});
