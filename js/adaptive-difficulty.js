// Adaptive bot difficulty ("Matched to you" solo preset, "Auto" in settings).
// The player has one skill level in [0, 1] (stored locally). It picks the bot
// tier (easy < 1/3 <= medium < 2/3 <= hard) and interpolates the four decision
// values inside it (easy at 0, medium at 0.5, hard at 1), so the step from one
// match to the next is small. A solo win raises it, a loss lowers it, a bigger
// round margin moves it more: matches drift towards close.
export const ADAPTIVE_DIFFICULTY = 'auto';
export const ADAPTIVE_START_SKILL = 0.35;
export const ADAPTIVE_STEP = 0.05;
export const ADAPTIVE_MARGIN_STEP = 0.025;

const TUNED_KEYS = ['deflectChance', 'reactionTime', 'windUp', 'mishitRate'];

export function normalizeSkill(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : ADAPTIVE_START_SKILL;
}

export function tierForSkill(skill) {
    const s = normalizeSkill(skill);
    return s < 1 / 3 ? 'easy' : s < 2 / 3 ? 'medium' : 'hard';
}

// result: 'win' | 'loss' | 'draw' (the player's); a 3-0 moves it further than 3-2.
export function nextSkill(skill, { result, roundsWon = 0, roundsLost = 0 } = {}) {
    const s = normalizeSkill(skill);
    const margin = Math.abs((Number(roundsWon) || 0) - (Number(roundsLost) || 0));
    const step = ADAPTIVE_STEP + ADAPTIVE_MARGIN_STEP * Math.min(3, Math.max(0, margin - 1));
    const delta = result === 'win' ? step : result === 'loss' ? -step : 0;
    return Math.round(Math.max(0, Math.min(1, s + delta)) * 1000) / 1000;
}

// table: js/bot.js DIFFICULTY_SETTINGS ({ easy, medium, hard } each with the TUNED_KEYS).
export function tuningForSkill(skill, table) {
    const s = normalizeSkill(skill);
    const [from, to, t] = s <= 0.5 ? [table.easy, table.medium, s / 0.5] : [table.medium, table.hard, (s - 0.5) / 0.5];
    const tuning = { skill: s, tier: tierForSkill(s) };
    for (const key of TUNED_KEYS) tuning[key] = from[key] + (to[key] - from[key]) * t;
    return tuning;
}

export const skillPercent = skill => Math.round(normalizeSkill(skill) * 100);
