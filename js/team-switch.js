// team-switch.js — rules for changing teams from the M menu, the lobby and
// the draft. Pure (no DOM, no THREE) so node --test can pin them.
//
// Lobby / pre-match countdown: the switch is instant (the countdown respawns
// you on the new half). Once a round is live (PLAYING, ROUND_END, PAUSED) the
// pick is queued and applied when the next round starts, so nobody changes
// sides mid-rally, lands against the net under the cross-court rule or skews
// a team's alive count. Celebration / post-game / FFA: no team switching.

export const TEAM_SWITCH_INSTANT_STATES = Object.freeze(['LOBBY', 'MENU', 'COUNTDOWN']);
export const TEAM_SWITCH_NEXT_ROUND_STATES = Object.freeze(['PLAYING', 'ROUND_END', 'PAUSED']);

// Keys the open team menu owns (js/ui.js _bindTeamPopupKeys); js/main.js's
// global keydown leaves them alone while it is open.
export const TEAM_MENU_KEYS = Object.freeze([
    'Digit1', 'Digit2', 'Numpad1', 'Numpad2', 'ArrowLeft', 'ArrowRight',
    'Enter', 'NumpadEnter', 'Space', 'Tab'
]);

export function isTeam(team) {
    return team === 'red' || team === 'blue';
}

export function otherTeam(team) {
    return team === 'red' ? 'blue' : 'red';
}

// 'instant' | 'nextRound' | 'blocked'
export function teamSwitchMode(state, { ffa = false } = {}) {
    if (ffa) return 'blocked';
    if (TEAM_SWITCH_INSTANT_STATES.includes(state)) return 'instant';
    if (TEAM_SWITCH_NEXT_ROUND_STATES.includes(state)) return 'nextRound';
    return 'blocked';
}

// The M menu opens during a live match only (the lobby has its own buttons).
export function canOpenTeamMenu(state, { ffa = false } = {}) {
    return !ffa && (state === 'COUNTDOWN' || TEAM_SWITCH_NEXT_ROUND_STATES.includes(state));
}

// Team each roster entry will play for once queued switches apply.
export function effectiveTeam(entry) {
    if (entry?.queuedForNextRound && isTeam(entry.pendingTeam)) return entry.pendingTeam;
    if (isTeam(entry?.nextRoundTeam)) return entry.nextRoundTeam;
    return entry?.team === 'blue' ? 'blue' : 'red';
}

export function teamCounts(roster = []) {
    const counts = { red: 0, blue: 0 };
    for (const entry of roster) counts[effectiveTeam(entry)]++;
    return counts;
}

// Bots fill in for the humans: after a switch, move bots (last listed first)
// from the bigger team until the sides differ by at most one. Humans never
// move. Returns [{ name, team }] moves, applied in order.
export function botRebalanceMoves(roster = []) {
    const teams = roster.map(entry => ({ name: entry.name, isBot: !!entry.isBot, team: effectiveTeam(entry) }));
    const count = team => teams.filter(entry => entry.team === team).length;
    const moves = [];
    for (let guard = 0; guard < teams.length; guard++) {
        const red = count('red');
        const blue = count('blue');
        if (Math.abs(red - blue) < 2) break;
        const big = red > blue ? 'red' : 'blue';
        const bot = [...teams].reverse().find(entry => entry.isBot && entry.team === big);
        if (!bot) break;
        bot.team = otherTeam(big);
        moves.push({ name: bot.name, team: bot.team });
    }
    return moves;
}

// Auto-assign: the smaller side without you; a tie keeps your current team.
export function autoAssignTeam(roster = [], selfName, currentTeam) {
    const others = roster.filter(entry => entry.name !== selfName);
    const counts = teamCounts(others);
    if (counts.red === counts.blue) return currentTeam === 'blue' ? 'blue' : 'red';
    return counts.red < counts.blue ? 'red' : 'blue';
}
