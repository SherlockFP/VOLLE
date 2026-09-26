// Adaptive bot difficulty ("Matched to you" solo preset, "Auto" setting): the
// player's level moves after each finished solo match and builds the next bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
    ADAPTIVE_START_SKILL, nextSkill, normalizeSkill, skillPercent, tierForSkill, tuningForSkill
} from '../js/adaptive-difficulty.js';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});
const { Bot } = await import('../js/bot.js');

const TABLE = {
    easy: { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08 },
    hard: { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02 }
};

test('the level: starts between easy and medium, a win raises it, a loss lowers it, a bigger margin moves it more', () => {
    assert.equal(normalizeSkill(undefined), ADAPTIVE_START_SKILL);
    assert.equal(normalizeSkill('nonsense'), ADAPTIVE_START_SKILL);
    assert.equal(normalizeSkill(7), 1);
    assert.equal(tierForSkill(ADAPTIVE_START_SKILL), 'medium');
    assert.deepEqual([0, 0.32, 0.34, 0.66, 0.67, 1].map(tierForSkill), ['easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
    assert.equal(nextSkill(0.5, { result: 'win', roundsWon: 3, roundsLost: 2 }), 0.55, 'close win: small step');
    assert.equal(nextSkill(0.5, { result: 'win', roundsWon: 3, roundsLost: 0 }), 0.6, 'a 3-0 moves it further');
    assert.equal(nextSkill(0.5, { result: 'loss', roundsWon: 0, roundsLost: 5 }), 0.375, 'margin capped at +3 steps');
    assert.equal(nextSkill(0.5, { result: 'draw', roundsWon: 2, roundsLost: 2 }), 0.5);
    assert.equal(nextSkill(0.98, { result: 'win', roundsWon: 5, roundsLost: 0 }), 1, 'clamped');
    assert.equal(nextSkill(0.01, { result: 'loss', roundsWon: 0, roundsLost: 5 }), 0);
    assert.equal(skillPercent(0.456), 46);
});

test('tuning matches the presets at 0, 0.5 and 1 and moves monotonically between them', () => {
    for (const [skill, tier] of [[0, 'easy'], [0.5, 'medium'], [1, 'hard']]) {
        const tuning = tuningForSkill(skill, TABLE);
        for (const key of Object.keys(TABLE.easy)) assert.ok(Math.abs(tuning[key] - TABLE[tier][key]) < 1e-9, `${key} at ${skill}`);
    }
    let previous = tuningForSkill(0, TABLE);
    for (let step = 1; step <= 20; step++) {
        const tuning = tuningForSkill(step / 20, TABLE);
        assert.ok(tuning.deflectChance >= previous.deflectChance && tuning.mishitRate <= previous.mishitRate);
        assert.ok(tuning.reactionTime <= previous.reactionTime && tuning.windUp <= previous.windUp);
        previous = tuning;
    }
});

test('a real Bot takes the tuned values, and a round tendency still biases them within its tier', () => {
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { difficulty: 'medium', tendency: null });
    const tuning = bot.applyAdaptiveSkill(0.6);
    assert.equal(bot.adaptiveSkill, 0.6);
    assert.ok(Math.abs(bot.deflectChance - tuning.deflectChance) < 1e-9 && bot.deflectChance > TABLE.medium.deflectChance && bot.deflectChance < TABLE.hard.deflectChance);
    assert.ok(Math.abs(bot.reactionTime - tuning.reactionTime) < 1e-9);
    Object.assign(bot, { _tendencyApproachMul: 1 });
    bot.rollTendency(() => 0.01); // aggressive: faster, but never below the hard tier
    assert.equal(bot.tendency, 'aggressive');
    assert.ok(bot.reactionTime < tuning.reactionTime, 'the tendency still applies');
    assert.ok(bot.reactionTime >= TABLE.hard.reactionTime, 'never faster than the tier above');
    assert.ok(bot.windUpTime >= TABLE.hard.windUp);
});

test('wiring: Game builds auto bots from the level, App settles it after solo matches and offers it', () => {
    const game = readFileSync(new URL('../js/game.js', import.meta.url), 'utf8');
    const meta = readFileSync(new URL('../js/app-match-meta.js', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(game, /const bot = new Bot\(this\.renderer, this\.arena, name, team, adaptive \? tierForSkill\(skill\) : this\.botDifficulty\);\s*if \(adaptive\) bot\.applyAdaptiveSkill\(skill\);/);
    assert.match(main, /this\.game\.resolveAdaptiveSkill = \(\) => this\._adaptiveSkill\?\.\(\);/);
    assert.match(main, /const balance = this\._matchBalanceFacts\?\.\(\) \|\| null;\s*this\._settleAdaptiveSkill\?\.\(balance\);/);
    assert.match(meta, /if \(!balance \|\| this\.network\?\.connected \|\| this\.game\.botDifficulty !== ADAPTIVE_DIFFICULTY\) return null;/, 'solo, adaptive bots only');
    assert.match(meta, /this\.store\.set\('adaptiveBotSkill', after\);/);
    assert.match(html, /data-solo-preset="matched"/);
    assert.match(html, /<option value="auto" data-i18n="settings\.botAuto">/);
    assert.match(main, /\['easy', 'medium', 'hard', 'auto'\]\.includes\(this\.store\.get\('settings'\)\?\.botDifficulty\)/);
});
