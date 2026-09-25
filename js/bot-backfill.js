// Casual online lobbies should not wait on a half-empty court. When the host
// starts (or rematches), bots fill each team to the size of the bigger team, at
// least BACKFILL_MIN_TEAM a side and at most BACKFILL_MAX_TEAM. FFA fills to
// BACKFILL_FFA_TOTAL players. Ranked/competitive, the 1v1 rally duel and a lobby
// with the toggle off are never filled. Only bots this added (`_backfill`) are
// ever removed again, so a host's hand-picked bots always stay.
export const BACKFILL_MIN_TEAM = 2;
export const BACKFILL_MAX_TEAM = 4;
export const BACKFILL_FFA_TOTAL = 4;
const NO_FILL_MODES = new Set(['competitive', 'rally_duel']);

const count = value => Math.max(0, Math.floor(Number(value) || 0));

// red/blue: everyone on each team now (humans + all bots); backfillRed/Blue: how
// many of those are backfill bots. Returns the change per team: > 0 add that many
// backfill bots, < 0 remove that many of them.
export function backfillPlan({
    red = 0, blue = 0, backfillRed = 0, backfillBlue = 0,
    enabled = true, ranked = false, modeId = '', ffa = false
} = {}) {
    const filledRed = Math.min(count(backfillRed), count(red));
    const filledBlue = Math.min(count(backfillBlue), count(blue));
    const fixedRed = count(red) - filledRed;
    const fixedBlue = count(blue) - filledBlue;
    if (!enabled || ranked || NO_FILL_MODES.has(modeId)) return { red: -filledRed, blue: -filledBlue };
    let wantRed;
    let wantBlue;
    if (ffa) {
        const missing = Math.max(0, BACKFILL_FFA_TOTAL - fixedRed - fixedBlue);
        // Alternate onto the smaller side; teams only label bots in FFA.
        wantRed = 0;
        wantBlue = 0;
        for (let i = 0; i < missing; i++) {
            if (fixedRed + wantRed <= fixedBlue + wantBlue) wantRed++;
            else wantBlue++;
        }
    } else {
        const target = Math.min(BACKFILL_MAX_TEAM, Math.max(BACKFILL_MIN_TEAM, fixedRed, fixedBlue));
        wantRed = Math.max(0, target - fixedRed);
        wantBlue = Math.max(0, target - fixedBlue);
    }
    return { red: wantRed - filledRed, blue: wantBlue - filledBlue };
}
