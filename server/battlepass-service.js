// Server-owned Battle Pass progression. Kept CommonJS/zero-dependency so the
// account service, not localStorage, decides season rollover, XP and claims.
const MAX_TIER = 50;
const SEASON_DURATION_MS = 56 * 24 * 60 * 60 * 1000;
const PREMIUM_PASS_PRICE = 950;
const MATCH_XP = Object.freeze({ win: 100, loss: 80, draw: 80 });

function xpForTier(tier) { return 100 + (Math.max(1, Math.min(MAX_TIER, Math.floor(Number(tier) || 1))) - 1) * 20; }
function validTier(tier) { return Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIER; }
function validTrack(track) { return track === 'free' || track === 'premium'; }

function createProgress(now = Date.now(), seasonId = 1) {
    return { seasonId: Math.max(1, Math.floor(Number(seasonId) || 1)), seasonStartAt: now, tier: 0, xp: 0, claimedFree: [], claimedPremium: [], premium: false };
}

function normalizeProgress(raw, now = Date.now()) {
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const base = createProgress(now, value.seasonId);
    const allowedClaims = claims => [...new Set(Array.isArray(claims) ? claims.filter(validTier) : [])].sort((a, b) => a - b);
    const start = Number(value.seasonStartAt);
    const progress = {
        ...base,
        seasonStartAt: Number.isFinite(start) && start > 0 && start <= now ? start : now,
        tier: Math.max(0, Math.min(MAX_TIER, Math.floor(Number(value.tier) || 0))),
        xp: Math.max(0, Math.floor(Number(value.xp) || 0)),
        claimedFree: allowedClaims(value.claimedFree ?? value.claimed),
        claimedPremium: allowedClaims(value.claimedPremium),
        premium: value.premium === true
    };
    return rollover(progress, now).progress;
}

function rollover(progress, now = Date.now()) {
    let state = progress;
    let changed = false;
    while (now >= state.seasonStartAt + SEASON_DURATION_MS) {
        state = createProgress(state.seasonStartAt + SEASON_DURATION_MS, state.seasonId + 1);
        changed = true;
    }
    return { progress: state, changed };
}

function addXp(progress, amount) {
    const state = { ...progress, xp: progress.xp + Math.max(0, Math.floor(Number(amount) || 0)) };
    while (state.tier < MAX_TIER && state.xp >= xpForTier(state.tier + 1)) {
        state.xp -= xpForTier(state.tier + 1);
        state.tier += 1;
    }
    return state;
}

function rewardFor(tier, track, catalog) {
    if (!validTier(tier) || !validTrack(track)) return null;
    const balls = Object.keys(catalog?.ball || {});
    const cosmetics = Object.keys(catalog?.cosmetic || {});
    if (track === 'free') {
        if (tier % 10 === 0) return balls.length ? { tier, kind: 'ball', id: balls[(tier / 10 - 1) % balls.length], name: `${balls[(tier / 10 - 1) % balls.length].replace(/_/g, ' ')} Ball` } : null;
        if (tier % 5 === 0) return { tier, kind: 'xpboost', multiplier: 1.25, durationMs: 20 * 60 * 1000, name: '20-min XP Boost (1.25x)' };
        const amount = 40 + tier * 3;
        return { tier, kind: 'currency', amount, name: `+${amount} Coins` };
    }
    if (tier === MAX_TIER) return catalog?.cosmetic?.finisher_explosion ? { tier, kind: 'cosmetic', id: 'finisher_explosion', name: 'Grand Finale' } : null;
    if (tier % 5 === 0) { const amount = 100 + tier * 4; return { tier, kind: 'currency', amount, name: `+${amount} Coins` }; }
    if (tier % 3 === 0) return { tier, kind: 'xpboost', multiplier: 1.5, durationMs: 30 * 60 * 1000, name: '30-min XP Boost (1.5x)' };
    let cosmeticIndex = 0;
    for (let current = 1; current <= tier; current += 1) {
        if (current !== MAX_TIER && current % 5 !== 0 && current % 3 !== 0) {
            if (current === tier) {
                const id = cosmetics[cosmeticIndex % cosmetics.length];
                return id ? { tier, kind: 'cosmetic', id, name: id.replace(/_/g, ' ') } : null;
            }
            cosmeticIndex += 1;
        }
    }
    return null;
}

function claim(progress, tier, track, catalog) {
    if (!validTier(tier) || !validTrack(track)) return { error: 'invalid battle pass reward' };
    const reward = rewardFor(tier, track, catalog);
    if (!reward) return { error: 'battle pass reward unavailable' };
    const claimedField = track === 'free' ? 'claimedFree' : 'claimedPremium';
    if (progress[claimedField].includes(tier)) return { replayed: true, progress, reward };
    if (progress.tier < tier) return { error: 'battle pass tier not reached' };
    if (track === 'premium' && !progress.premium) return { error: 'premium battle pass required' };
    return { progress: { ...progress, [claimedField]: [...progress[claimedField], tier] }, reward, replayed: false };
}

module.exports = { MATCH_XP, MAX_TIER, PREMIUM_PASS_PRICE, SEASON_DURATION_MS, addXp, claim, createProgress, normalizeProgress, rollover, rewardFor, xpForTier };
