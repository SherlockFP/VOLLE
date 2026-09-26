// Pause policy for the Esc key and the touch Pause button (which sends a
// synthetic Escape), plus the pause menu's Resume. Pure: the string values
// mirror STATES in js/game.js so this module needs no imports.
//
// Online nobody can freeze the shared match: Esc only opens the overlay and
// the simulation, clock and host broadcasts keep running. Solo Esc enters
// PAUSED. Resume restores the paused-from state only while the game is still
// PAUSED, so a state that moved on under the menu is never rewound.

export const IN_MATCH_PAUSE_STATES = Object.freeze(['PLAYING', 'COUNTDOWN', 'ROUND_END', 'CELEBRATION']);

// overlay: show the pause menu. setState: 'PAUSED' only for a solo match.
export function pauseAction({ connected, state } = {}) {
    const overlay = IN_MATCH_PAUSE_STATES.includes(state);
    return { overlay, setState: overlay && !connected ? 'PAUSED' : null };
}

// setState: the state to restore, or null when nothing was paused.
export function resumeAction({ state, pausedFrom } = {}) {
    if (state !== 'PAUSED') return { setState: null };
    return { setState: pausedFrom || 'PLAYING' };
}
