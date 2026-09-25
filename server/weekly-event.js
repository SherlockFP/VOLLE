'use strict';
// Server mirror of js/weekly-event.js (tests/weekly-event.test.mjs pins the two
// together) plus the event ladder's scoring: a settled match in this week's
// featured mode scores 3 for a win and 1 for a loss. The mode is what the client
// declared at match start, so the ladder is a bragging board only: it never
// grants coins, cases or anything else.
const WEEKLY_EVENT_MODES = Object.freeze(['hotpotato', 'speedball', 'multiball', 'lowgrav', 'instagib', 'pinball', 'freeze', 'tanky']);
const WEEKLY_EVENT_POINTS = Object.freeze({ win: 3, loss: 1 });
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EPOCH_MONDAY_MS = Date.UTC(1970, 0, 5);
const GAME_MODE = /^[a-z_]{1,24}$/;

function weekIndex(date = new Date()) {
    return Math.floor((date.getTime() - EPOCH_MONDAY_MS) / WEEK_MS);
}

function weeklyEvent(date = new Date()) {
    const week = weekIndex(date);
    const modeId = WEEKLY_EVENT_MODES[((week % WEEKLY_EVENT_MODES.length) + WEEKLY_EVENT_MODES.length) % WEEKLY_EVENT_MODES.length];
    return { modeId, week, endsAt: EPOCH_MONDAY_MS + (week + 1) * WEEK_MS };
}

function normalizeGameMode(value) {
    return typeof value === 'string' && GAME_MODE.test(value) ? value : null;
}

// state: the profile's stored { week, modeId, points, wins, matches } (any week).
// Returns { counted, state }: counted only for this week's event mode.
function applyWeeklyEventResult(state, { gameMode, won = false, date = new Date() } = {}) {
    const event = weeklyEvent(date);
    if (normalizeGameMode(gameMode) !== event.modeId) return { counted: false, state };
    const current = state && state.week === event.week ? state : { week: event.week, modeId: event.modeId, points: 0, wins: 0, matches: 0 };
    const next = {
        week: event.week,
        modeId: event.modeId,
        points: Math.max(0, Math.floor(Number(current.points) || 0)) + (won ? WEEKLY_EVENT_POINTS.win : WEEKLY_EVENT_POINTS.loss),
        wins: Math.max(0, Math.floor(Number(current.wins) || 0)) + (won ? 1 : 0),
        matches: Math.max(0, Math.floor(Number(current.matches) || 0)) + 1
    };
    return { counted: true, state: next };
}

module.exports = { WEEKLY_EVENT_MODES, WEEKLY_EVENT_POINTS, weekIndex, weeklyEvent, normalizeGameMode, applyWeeklyEventResult };
