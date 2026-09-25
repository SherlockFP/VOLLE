// Browser mirror of server/reward-track.js for guest (local) profiles. Keep the two
// identical in behaviour; tests/reward-track.test.mjs runs both side by side.

export const STARTER_TRACK_EVERY = 3;
export const STARTER_TRACK_CASES = Object.freeze(['kickoff', 'chroma', 'arsenal', 'elemental', 'mythic']);
export const STREAK_CASES = Object.freeze({ 3: 'kickoff', 5: 'chroma', 7: 'mythic' });
const STREAK_CYCLE = 7;

export function normalizeStarterTrack(value) {
    const cap = STARTER_TRACK_CASES.length;
    const granted = Math.min(cap, Math.max(0, Math.floor(Number(value?.granted) || 0)));
    const matches = Math.min(cap * STARTER_TRACK_EVERY, Math.max(0, Math.floor(Number(value?.matches) || 0)));
    return { matches: Math.max(matches, granted * STARTER_TRACK_EVERY), granted };
}

export function advanceStarterTrack(value) {
    const track = normalizeStarterTrack(value);
    if (track.granted >= STARTER_TRACK_CASES.length) return { track, caseId: null };
    const matches = track.matches + 1;
    if (matches % STARTER_TRACK_EVERY !== 0) return { track: { matches, granted: track.granted }, caseId: null };
    return { track: { matches, granted: track.granted + 1 }, caseId: STARTER_TRACK_CASES[track.granted] };
}

export function starterTrackStatus(value) {
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

export function streakCaseForDay(day) {
    const n = Math.floor(Number(day) || 0);
    if (n < 1) return null;
    return STREAK_CASES[((n - 1) % STREAK_CYCLE) + 1] || null;
}
