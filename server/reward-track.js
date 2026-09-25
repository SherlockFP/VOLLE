'use strict';
// Free case cadences. Accounts: server/profile-store.js applies these. Guests: the
// same rules run on the local store through js/reward-track.js, which must stay a
// line-for-line mirror (tests/reward-track.test.mjs compares the two).

// Starter track: every STARTER_TRACK_EVERY rewarded matches grant the next case in
// the list, once each, so a new player opens five free cases in their first 15 matches.
const STARTER_TRACK_EVERY = 3;
const STARTER_TRACK_CASES = Object.freeze(['kickoff', 'chroma', 'arsenal', 'elemental', 'mythic']);
// Login streak: these days of each 7-day cycle add a case on top of the coins.
const STREAK_CASES = Object.freeze({ 3: 'kickoff', 5: 'chroma', 7: 'mythic' });
const STREAK_CYCLE = 7;

function normalizeStarterTrack(value) {
    const cap = STARTER_TRACK_CASES.length;
    const granted = Math.min(cap, Math.max(0, Math.floor(Number(value?.granted) || 0)));
    const matches = Math.min(cap * STARTER_TRACK_EVERY, Math.max(0, Math.floor(Number(value?.matches) || 0)));
    return { matches: Math.max(matches, granted * STARTER_TRACK_EVERY), granted };
}

// One completed, rewarded match. Returns the next track state and the case it
// grants (null when this match is not a multiple of the cadence or the track is done).
function advanceStarterTrack(value) {
    const track = normalizeStarterTrack(value);
    if (track.granted >= STARTER_TRACK_CASES.length) return { track, caseId: null };
    const matches = track.matches + 1;
    if (matches % STARTER_TRACK_EVERY !== 0) return { track: { matches, granted: track.granted }, caseId: null };
    return { track: { matches, granted: track.granted + 1 }, caseId: STARTER_TRACK_CASES[track.granted] };
}

function starterTrackStatus(value) {
    const track = normalizeStarterTrack(value);
    const cap = STARTER_TRACK_CASES.length;
    const done = track.granted >= cap;
    return {
        every: STARTER_TRACK_EVERY,
        cap,
        granted: track.granted,
        progress: done ? STARTER_TRACK_EVERY : track.matches % STARTER_TRACK_EVERY,
        nextCase: done ? null : STARTER_TRACK_CASES[track.granted],
        done
    };
}

function streakCaseForDay(day) {
    const n = Math.floor(Number(day) || 0);
    if (n < 1) return null;
    return STREAK_CASES[((n - 1) % STREAK_CYCLE) + 1] || null;
}

module.exports = {
    STARTER_TRACK_EVERY,
    STARTER_TRACK_CASES,
    STREAK_CASES,
    advanceStarterTrack,
    normalizeStarterTrack,
    starterTrackStatus,
    streakCaseForDay
};
