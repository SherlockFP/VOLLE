// Weekly event: one featured mode per ISO week, the same for every player with no
// server involved (the week number picks it). The menu shows it with a countdown,
// "Play" drops you into a bot match in that mode, and matches played in it earn
// WEEKLY_EVENT_XP_BONUS extra match XP (local account XP, never coins or cases).
export const WEEKLY_EVENT_MODES = Object.freeze(['hotpotato', 'speedball', 'multiball', 'lowgrav', 'instagib', 'pinball', 'freeze', 'tanky']);
export const WEEKLY_EVENT_XP_BONUS = 0.5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// 1970-01-05 00:00 UTC was a Monday: weeks count from there.
const EPOCH_MONDAY_MS = Date.UTC(1970, 0, 5);

export function weekIndex(date = new Date()) {
    return Math.floor((date.getTime() - EPOCH_MONDAY_MS) / WEEK_MS);
}

// { modeId, week, endsAt } — endsAt: the next Monday 00:00 UTC (ms).
export function weeklyEvent(date = new Date(), modes = WEEKLY_EVENT_MODES) {
    const week = weekIndex(date);
    const pool = Array.isArray(modes) && modes.length ? modes : WEEKLY_EVENT_MODES;
    const modeId = pool[((week % pool.length) + pool.length) % pool.length];
    return { modeId, week, endsAt: EPOCH_MONDAY_MS + (week + 1) * WEEK_MS };
}

export function weeklyEventXpBonus(modeId, date = new Date()) {
    return typeof modeId === 'string' && modeId === weeklyEvent(date).modeId ? WEEKLY_EVENT_XP_BONUS : 0;
}

// "3d 4h" / "5h 12m" left.
export function timeLeftParts(endsAt, now = Date.now()) {
    const ms = Math.max(0, Number(endsAt) - Number(now));
    const minutes = Math.floor(ms / 60000);
    return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}
