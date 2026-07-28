// prestige.js — Account progression: Call of Duty style level + prestige loop.
//
// Casual-first by design: this is the rank a player actually sees and chases.
// Ranked ELO still lives in js/competitive-service.js, but it is matchmaking
// plumbing, not the headline result of a casual match.
//
// ponytail: pure functions, no state, no deps. js/store.js owns persistence,
// js/main.js owns presentation. The XP curve is the one store.js already
// shipped (100 + 50 per level), so existing saves keep their pacing.

export const MAX_LEVEL = 55;
export const MAX_PRESTIGE = 10;

// Index 0 is "no prestige yet" and deliberately has no title.
const PRESTIGE_TITLES = Object.freeze([
    '',
    'Dodger',
    'Deflector',
    'Rebounder',
    'Spiker',
    'Curveball',
    'Cannon',
    'Ricochet',
    'Juggernaut',
    'Legend',
    'Master Prestige'
]);

// XP required to leave `level`. Unchanged from store.js's original curve.
export function xpForLevel(level) {
    const lvl = Math.floor(Number(level));
    if (!Number.isFinite(lvl) || lvl < 1) return 100;
    return 100 + (Math.min(lvl, MAX_LEVEL) - 1) * 50;
}

export function prestigeTitle(prestige) {
    const p = Math.floor(Number(prestige));
    if (!Number.isFinite(p) || p <= 0) return '';
    return PRESTIGE_TITLES[Math.min(p, MAX_PRESTIGE)] || '';
}

// True once the player is level-capped with no prestige left to earn.
export function isMaxed(account) {
    const { level, prestige } = normalizeAccount(account);
    return prestige >= MAX_PRESTIGE && level >= MAX_LEVEL;
}

// Short label for the menu/scoreboard. "Lv 12" -> "Deflector · Lv 12".
export function accountRankLabel(account) {
    const { level, prestige } = normalizeAccount(account);
    const title = prestigeTitle(prestige);
    return title ? `${title} · Lv ${level}` : `Lv ${level}`;
}

// Progress toward the next level, for bars and "next reward" copy.
// Returns xp needed as 0 when the account is fully maxed (nothing left to fill).
export function levelProgress(account) {
    const { level, xp, prestige } = normalizeAccount(account);
    if (prestige >= MAX_PRESTIGE && level >= MAX_LEVEL) {
        return { level, xp, need: 0, ratio: 1, prestige };
    }
    const need = xpForLevel(level);
    return { level, xp, need, ratio: need > 0 ? Math.min(1, xp / need) : 1, prestige };
}

// Hostile/legacy saves: missing prestige (pre-feature saves) reads as 0, and
// nonsense values clamp instead of throwing.
function normalizeAccount(account) {
    const level = Math.floor(Number(account?.level));
    const xp = Math.floor(Number(account?.xp));
    const prestige = Math.floor(Number(account?.prestige));
    return {
        level: Number.isFinite(level) ? Math.min(Math.max(level, 1), MAX_LEVEL) : 1,
        xp: Number.isFinite(xp) && xp > 0 ? xp : 0,
        prestige: Number.isFinite(prestige) ? Math.min(Math.max(prestige, 0), MAX_PRESTIGE) : 0
    };
}

// Applies match XP and rolls levels, prestiging at MAX_LEVEL.
//
// Prestige resets level to 1 and banks no leftover XP — same clean slate CoD
// gives you. That is safe here because account level gates nothing: unlocks
// live in ownedItems/ownedSkills/unlockedChars, so a prestige never revokes
// anything the player bought or earned.
//
// At MAX_PRESTIGE + MAX_LEVEL the account is done: extra XP is discarded
// rather than silently accumulating into a bar that can never fill.
export function applyAccountXp(account, amount) {
    const base = normalizeAccount(account);
    const gain = Math.floor(Number(amount));
    const next = { ...base, leveledUp: false, prestiged: false };
    if (!Number.isFinite(gain) || gain <= 0) return next;
    if (base.prestige >= MAX_PRESTIGE && base.level >= MAX_LEVEL) return next;

    next.xp += gain;

    for (;;) {
        if (next.level >= MAX_LEVEL) {
            if (next.prestige >= MAX_PRESTIGE) {
                // Fully maxed: park the bar full instead of growing forever.
                next.xp = 0;
                break;
            }
            next.prestige += 1;
            next.level = 1;
            next.xp = 0;
            next.prestiged = true;
            next.leveledUp = true;
            break;
        }
        const need = xpForLevel(next.level);
        if (next.xp < need) break;
        next.xp -= need;
        next.level += 1;
        next.leveledUp = true;
    }

    return next;
}

// Match XP, casual-first. Rewards how you played over whether you won: the
// win/loss gap is deliberately small (40 vs 20) so a good match in a loss
// still out-earns a passive win, and nobody feels punished for losing.
export const MATCH_XP = Object.freeze({
    base: 60,
    perDeflection: 4,
    perKill: 6,
    perRally: 2,
    survivalBonus: 15,
    win: 40,
    loss: 20
});

export function matchXp(stats = {}) {
    const num = value => {
        const n = Math.floor(Number(value));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const deflections = num(stats.deflections);
    const kills = num(stats.kills);
    const rally = num(stats.rally);
    const survived = stats.survived === true;
    return MATCH_XP.base
        + deflections * MATCH_XP.perDeflection
        + kills * MATCH_XP.perKill
        + rally * MATCH_XP.perRally
        + (survived ? MATCH_XP.survivalBonus : 0)
        + (stats.won === true ? MATCH_XP.win : MATCH_XP.loss);
}
