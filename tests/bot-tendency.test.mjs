// tests/bot-tendency.test.mjs — Round tendency (aggressive/defensive/flanker) pure-logic tests.
// js/bot.js imports 'three' and can't run under `node --test` (see tests/bot-behavior.test.mjs
// for the same constraint), so this file mirrors bot.js's tendency constants/functions verbatim
// as pure shadow copies. Keep these literals byte-identical to js/bot.js if either changes.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- Mirrors js/bot.js DIFFICULTY_SETTINGS ---
const DIFFICULTY_SETTINGS = {
    easy:   { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20, moveSpeed: 3.5, skillChance: 0.05 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08, moveSpeed: 5.5, skillChance: 0.20 },
    hard:   { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02, moveSpeed: 7.5, skillChance: 0.45 }
};

// --- Mirrors js/bot.js BOT_TENDENCIES / TENDENCY_PROFILES / TENDENCY_BOUNDS ---
const BOT_TENDENCIES = ['aggressive', 'defensive', 'flanker'];

const TENDENCY_PROFILES = {
    aggressive: { reactionMul: 0.88, windUpMul: 0.85, approachMul: 1.25, lateralMul: 0.85, depthBias: -1.0, shotBias:  0.08, lobBias: -0.15 },
    defensive:  { reactionMul: 1.12, windUpMul: 1.20, approachMul: 0.80, lateralMul: 1.00, depthBias:  1.0, shotBias: -0.05, lobBias:  0.10 },
    flanker:    { reactionMul: 1.00, windUpMul: 1.00, approachMul: 0.95, lateralMul: 1.40, depthBias:  0.0, shotBias:  0.05, lobBias:  0.20 }
};

const TENDENCY_BOUNDS = {
    reactionMul: [0.85, 1.15],
    windUpMul:   [0.80, 1.25],
    approachMul: [0.75, 1.30],
    lateralMul:  [0.80, 1.50],
    depthBias:   [-1.5, 1.5],
    shotBias:    [-0.10, 0.10],
    lobBias:     [-0.20, 0.20]
};

// --- Mirrors js/bot.js pickTendency/tierFloor/tendencyBoundedTime ---
function pickTendency(seed) {
    const clamped = Math.max(0, Math.min(0.999999, Number(seed) || 0));
    const idx = Math.min(BOT_TENDENCIES.length - 1, Math.floor(clamped * BOT_TENDENCIES.length));
    return BOT_TENDENCIES[idx];
}

function tierFloor(param, difficulty) {
    if (difficulty === 'easy') return DIFFICULTY_SETTINGS.medium[param];
    if (difficulty === 'medium') return DIFFICULTY_SETTINGS.hard[param];
    return DIFFICULTY_SETTINGS.hard[param] * 0.85;
}

function tendencyBoundedTime(param, difficulty, tendencyKey) {
    const settings = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
    const profile = TENDENCY_PROFILES[tendencyKey] || TENDENCY_PROFILES.flanker;
    const mul = param === 'reactionTime' ? profile.reactionMul : profile.windUpMul;
    const biased = settings[param] * mul;
    return Math.max(biased, tierFloor(param, difficulty));
}

// --- Mirrors js/game.js handleBotDeflection's tendency-biased trick-shot rate ---
function tendencyBoundedSkillRate(difficulty, tendencyKey) {
    const baseSkillRate = difficulty === 'hard' ? 0.4 : difficulty === 'medium' ? 0.2 : 0.05;
    const nextTierSkillRate = difficulty === 'hard' ? 0.5 : difficulty === 'medium' ? 0.4 : 0.2;
    const profile = TENDENCY_PROFILES[tendencyKey] || TENDENCY_PROFILES.flanker;
    return Math.max(0, Math.min(nextTierSkillRate, baseSkillRate + profile.shotBias));
}

// --- Seeded determinism ---

test('pickTendency is a pure function of its seed: same seed -> same tendency', () => {
    for (const seed of [0, 0.1, 0.33, 0.5, 0.66, 0.9, 0.999]) {
        assert.equal(pickTendency(seed), pickTendency(seed), `seed ${seed} must be deterministic`);
    }
});

test('pickTendency partitions [0,1) evenly across the three tendencies', () => {
    assert.equal(pickTendency(0), 'aggressive');
    assert.equal(pickTendency(0.1), 'aggressive');
    assert.equal(pickTendency(0.333), 'aggressive');
    assert.equal(pickTendency(0.34), 'defensive');
    assert.equal(pickTendency(0.5), 'defensive');
    assert.equal(pickTendency(0.666), 'defensive');
    assert.equal(pickTendency(0.67), 'flanker');
    assert.equal(pickTendency(0.9), 'flanker');
    assert.equal(pickTendency(0.999999), 'flanker');
});

test('same seed reproduces the same tendency-biased reactionTime and windUpTime', () => {
    const seed = 0.05; // aggressive
    const runA = {
        tendency: pickTendency(seed),
        reactionTime: tendencyBoundedTime('reactionTime', 'medium', pickTendency(seed)),
        windUpTime: tendencyBoundedTime('windUp', 'medium', pickTendency(seed))
    };
    const runB = {
        tendency: pickTendency(seed),
        reactionTime: tendencyBoundedTime('reactionTime', 'medium', pickTendency(seed)),
        windUpTime: tendencyBoundedTime('windUp', 'medium', pickTendency(seed))
    };
    assert.deepEqual(runA, runB, 'identical seed must reproduce identical decision bias');
});

test('out-of-range seeds clamp into the valid tendency partition instead of throwing', () => {
    assert.equal(pickTendency(-5), 'aggressive');
    assert.equal(pickTendency(1), 'flanker');
    assert.equal(pickTendency(NaN), 'aggressive');
    assert.equal(pickTendency(undefined), 'aggressive');
});

// --- Tendency bounds ---

test('every TENDENCY_PROFILES value stays within its documented TENDENCY_BOUNDS range', () => {
    for (const [name, profile] of Object.entries(TENDENCY_PROFILES)) {
        for (const [key, value] of Object.entries(profile)) {
            const [min, max] = TENDENCY_BOUNDS[key];
            assert.ok(value >= min && value <= max,
                `${name}.${key} = ${value} must be within [${min}, ${max}]`);
        }
    }
});

test('all three documented tendencies exist with a complete parameter set', () => {
    assert.deepEqual(Object.keys(TENDENCY_PROFILES).sort(), ['aggressive', 'defensive', 'flanker']);
    const requiredKeys = Object.keys(TENDENCY_BOUNDS).sort();
    for (const profile of Object.values(TENDENCY_PROFILES)) {
        assert.deepEqual(Object.keys(profile).sort(), requiredKeys);
    }
});

// --- Difficulty invariance: tendency modulates around difficulty, never exceeds it ---

test('difficulty invariance: an easy bot tendency-biased reactionTime never reaches medium baseline', () => {
    for (const tendency of BOT_TENDENCIES) {
        const value = tendencyBoundedTime('reactionTime', 'easy', tendency);
        assert.ok(value >= DIFFICULTY_SETTINGS.medium.reactionTime,
            `easy+${tendency} reactionTime ${value} must not be faster than medium's ${DIFFICULTY_SETTINGS.medium.reactionTime}`);
    }
});

test('difficulty invariance: a medium bot tendency-biased reactionTime never reaches hard baseline', () => {
    for (const tendency of BOT_TENDENCIES) {
        const value = tendencyBoundedTime('reactionTime', 'medium', tendency);
        assert.ok(value >= DIFFICULTY_SETTINGS.hard.reactionTime,
            `medium+${tendency} reactionTime ${value} must not be faster than hard's ${DIFFICULTY_SETTINGS.hard.reactionTime}`);
    }
});

test('difficulty invariance: a hard bot tendency-biased reactionTime never drops below its self-relative floor', () => {
    const floor = DIFFICULTY_SETTINGS.hard.reactionTime * 0.85;
    for (const tendency of BOT_TENDENCIES) {
        const value = tendencyBoundedTime('reactionTime', 'hard', tendency);
        assert.ok(value >= floor, `hard+${tendency} reactionTime ${value} must not drop below ${floor}`);
    }
});

test('difficulty invariance: windUpTime is bounded the same way as reactionTime, per tier', () => {
    for (const tendency of BOT_TENDENCIES) {
        assert.ok(tendencyBoundedTime('windUp', 'easy', tendency) >= DIFFICULTY_SETTINGS.medium.windUp);
        assert.ok(tendencyBoundedTime('windUp', 'medium', tendency) >= DIFFICULTY_SETTINGS.hard.windUp);
        assert.ok(tendencyBoundedTime('windUp', 'hard', tendency) >= DIFFICULTY_SETTINGS.hard.windUp * 0.85);
    }
});

test('difficulty invariance: an easy bot tendency-biased trick-shot rate never reaches medium baseline', () => {
    for (const tendency of BOT_TENDENCIES) {
        const rate = tendencyBoundedSkillRate('easy', tendency);
        assert.ok(rate <= 0.2, `easy+${tendency} skillRate ${rate} must not reach medium's base 0.2`);
    }
});

test('difficulty invariance: a medium bot tendency-biased trick-shot rate never reaches hard baseline', () => {
    for (const tendency of BOT_TENDENCIES) {
        const rate = tendencyBoundedSkillRate('medium', tendency);
        assert.ok(rate <= 0.4, `medium+${tendency} skillRate ${rate} must not reach hard's base 0.4`);
    }
});

test('aggressive tendency biases toward faster commit, defensive toward slower, within each difficulty tier', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        const aggressive = tendencyBoundedTime('reactionTime', difficulty, 'aggressive');
        const defensive = tendencyBoundedTime('reactionTime', difficulty, 'defensive');
        assert.ok(aggressive <= defensive,
            `${difficulty}: aggressive reactionTime (${aggressive}) must be <= defensive's (${defensive})`);
    }
});

test('shot-type bias never produces a negative or unbounded trick-shot rate', () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
        for (const tendency of BOT_TENDENCIES) {
            const rate = tendencyBoundedSkillRate(difficulty, tendency);
            assert.ok(rate >= 0 && rate <= 1, `${difficulty}+${tendency} skillRate ${rate} must be a valid probability`);
        }
    }
});
