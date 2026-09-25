// Bots always return a reachable opening serve. Before, a missed serve ended the
// round with nobody having played (easy bot: 65% of serves), credited to "Environment".
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});
const { Bot } = await import('../js/bot.js');

function fakeBot(game) {
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, {
        alive: true, attacking: false, attackTimer: 0,
        position: { x: 0, y: 0, z: 0 },
        reactionTime: 0.65, windUpTime: 0.3, deflectChance: 0.35,
        deflectDecay: NaN, deflectDecayStart: 99, defenseTimeFloor: 0,
        _firstSoloDeflectGuard: null, _gameRef: game, animator: null
    });
    bot._resetDefenseIntent();
    return bot;
}

function incomingBall(bot) {
    // 10 units out on +z, flying straight at the bot, inside its alert range.
    return {
        active: true, targetPlayer: bot, currentSpeed: 17, baseSpeed: 17, attackRange: 2,
        position: { x: 0, y: 1.2, z: 10 }, velocity: { x: 0, y: 0, z: -17 }
    };
}

const alwaysMiss = () => 0.99;

test('the opening serve (no deflector yet) is always returned by a bot', () => {
    const bot = fakeBot({ lastDeflector: null });
    assert.equal(bot.observeDefenseIntent(incomingBall(bot), alwaysMiss), 'deflect');
    assert.equal(bot._willDeflect, true);
});

test('after anyone touched the ball the normal chance roll applies', () => {
    const bot = fakeBot({ lastDeflector: { name: 'Player' } });
    const intent = bot.observeDefenseIntent(incomingBall(bot), alwaysMiss);
    assert.match(intent, /^dodge-(left|right)$/);
    assert.equal(bot._willDeflect, false);
});

test('a bot outside a game (no _gameRef) keeps the plain roll', () => {
    const bot = fakeBot(null);
    assert.notEqual(bot.observeDefenseIntent(incomingBall(bot), alwaysMiss), 'deflect');
});
