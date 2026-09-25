// run-it-back.js — the end-of-match loop's pure rules (Gauntlet G8): how long
// the deciding round and the victory lap last in solo, when a player may skip
// to the report, the post-match toast queue limits, the personal-best compare
// and the first solo match's session config. No DOM, THREE, Store or network:
// js/game.js, js/ui.js and js/main.js own the wiring, these only answer questions.
//
// Multiplayer timing is intentionally absent here. The host keeps its
// 3 s round-end (it covers the 2.5 s killcam) and 8 s celebration
// (CELEBRATION_DURATION_SECONDS in game.js); a multiplayer player can only open
// their own report early.

// Solo: the deciding round's ROUND_END hands off to CELEBRATION after this.
// Non-final rounds keep Game.roundRestartDelay (3 s); solo may skip it (below).
export const FINAL_ROUND_END_SECONDS = 1.5;
// Solo: the celebration opens the post-game report on its own after this.
export const SOLO_CELEBRATION_SECONDS = 4.0;
// Solo: Space / click / E skip the rest of the lap from this point.
export const SOLO_CELEBRATION_SKIP_FROM_SECONDS = 1.0;
// Multiplayer: each player may open their own report over the lap from here.
export const MULTIPLAYER_POSTGAME_PEEK_FROM_SECONDS = 2.0;

// Post-match toasts run one after another instead of overwriting each other.
export const TOAST_QUEUE_MIN_MS = 1200;
export const TOAST_QUEUE_MAX = 4;
// The LEVEL N stamp stays up at least this long (acceptance: >= 1.5 s).
export const LEVEL_STAMP_VISIBLE_MS = 2200;

// Keys that skip the solo lap (or open the report over a multiplayer lap).
export const CELEBRATION_SKIP_KEYS = Object.freeze(['Space', 'KeyE']);

const finiteNonNegative = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

// 'skip'  → solo: end the lap now and open the report.
// 'peek'  → multiplayer: open this player's report, host timers untouched.
// null    → too early (or the report is already open).
export function celebrationSkipAction({ solo = true, elapsed = 0, postGameOpen = false } = {}) {
    if (postGameOpen) return null;
    const seconds = finiteNonNegative(elapsed);
    if (solo) return seconds >= SOLO_CELEBRATION_SKIP_FROM_SECONDS ? 'skip' : null;
    return seconds >= MULTIPLAYER_POSTGAME_PEEK_FROM_SECONDS ? 'peek' : null;
}

// What the round-end timer will do when it expires: 'end' the match, extend it
// into 'overtime', or play the 'next' round. Mirrors the host branch in
// Game.update (ROUND_END) exactly; the host itself still runs that branch.
export function roundEndOutcome({
    overtimeExtends = 0,
    overtimeComplete = false,
    goalComplete = false,
    regulationComplete = false,
    overtimeWanted = false
} = {}) {
    if (overtimeExtends > 0 && overtimeComplete) return 'end';
    if (goalComplete) return 'end';
    if (regulationComplete) return overtimeWanted && overtimeExtends < 8 ? 'overtime' : 'end';
    return 'next';
}

// Solo: Space / E skip the rest of a non-final round-end from this point, once
// the kill and the score line have had a beat.
export const SOLO_ROUND_SKIP_FROM_SECONDS = 1.0;

export function roundEndSkipAllowed({ solo = false, elapsed = 0, outcome = 'next' } = {}) {
    return solo === true && outcome === 'next' && finiteNonNegative(elapsed) >= SOLO_ROUND_SKIP_FROM_SECONDS;
}

// Solo only: the deciding round hands off early. Multiplayer returns false so
// the host's round-end timer is the only clock for connected players.
export function shouldEndFinalRoundEarly({ solo = false, elapsed = 0, outcome = 'next' } = {}) {
    return solo === true && outcome === 'end' && finiteNonNegative(elapsed) >= FINAL_ROUND_END_SECONDS;
}

// ---- Personal strip ------------------------------------------------------

export const PERSONAL_STAT_KEYS = Object.freeze(['deflects', 'perfects', 'topSpeed', 'bestRally', 'kos']);

export function emptyPersonalBests() {
    return { deflects: 0, perfects: 0, topSpeed: 0, bestRally: 0, kos: 0 };
}

// Hostile or legacy saves degrade to zeros rather than NaN.
export function normalizePersonalBests(value) {
    const out = emptyPersonalBests();
    if (!value || typeof value !== 'object') return out;
    for (const key of PERSONAL_STAT_KEYS) out[key] = finiteNonNegative(value[key]);
    return out;
}

// topSpeed is a ball-speed multiple (×); one decimal is what the strip shows,
// so the compare uses the same precision (2.43× vs 2.4× is not a new best).
export function normalizePersonalStats(value) {
    const out = normalizePersonalBests(value);
    for (const key of PERSONAL_STAT_KEYS) {
        out[key] = key === 'topSpeed' ? Math.round(out[key] * 10) / 10 : Math.floor(out[key]);
    }
    return out;
}

// Beaten = strictly better than the stored best and non-zero. Returns the
// previous bests (what the strip compares against), the per-stat flags and the
// merged record to persist.
export function comparePersonalBests(stats, bests) {
    const current = normalizePersonalStats(stats);
    const previous = normalizePersonalBests(bests);
    const beaten = {};
    const next = { ...previous };
    for (const key of PERSONAL_STAT_KEYS) {
        beaten[key] = current[key] > 0 && current[key] > previous[key];
        if (beaten[key]) next[key] = current[key];
    }
    return { stats: current, previous, beaten, next, anyBeaten: Object.values(beaten).some(Boolean) };
}

// ---- First session -------------------------------------------------------

export const FIRST_SOLO_MATCH_CONFIG = Object.freeze({
    botDifficulty: 'medium',
    maxRounds: 5,
    timeLimit: 180
});

// A fresh profile's first solo match is shorter and fairer than the lobby
// defaults (hard bot, 16 rounds, 300 s). Anyone who has finished a match
// keeps their own lobby settings.
export function firstSoloMatchConfig({ matchesPlayed = 0, newProfile = true } = {}) {
    const played = Math.max(0, Math.floor(Number(matchesPlayed) || 0));
    return played === 0 && newProfile !== false ? FIRST_SOLO_MATCH_CONFIG : null;
}
