// battlepass.js — Pure battlepass tier/XP/season/claim logic (Phase 3 #13).
// No DOM, no THREE — node-testable. js/store.js owns persistence + inventory grants,
// js/ui.js owns rendering. Every reward id here is asserted against a real catalog
// at module load so a typo fails loudly instead of silently granting nothing.
import { COSMETICS } from './cosmetic-catalog.js';

export const MAX_TIER = 50;
// PLAN.md section 7 ("Battle pass"): eight-week initial season.
export const SEASON_DURATION_MS = 56 * 24 * 60 * 60 * 1000;
export const FIRST_SEASON_ID = 1;
export const PREMIUM_PASS_PRICE = 950;

// ponytail: duplicated from js/ball.js BALL_SKINS (id -> coin price) instead of
// imported, because ball.js pulls in THREE which plain `node --test` can't resolve.
// js/store.js imports this same object for buyBall(), so it stays a single source
// of truth for which ball ids are real.
export const BALL_PRICES = Object.freeze({
    fire: 150, ice: 150, lightning: 150, bomb: 150, star: 150, rainbow: 150,
    plasma: 180, abyss: 180, melon: 180,
    inferno: 220, frostbite: 220, voltstorm: 260, nebula: 280, creeper: 300,
    happy: 300, glitch: 340, void_eye: 340, candy: 260, solar: 360, toxic: 240, disco: 320,
    magma: 380, ocean: 300, honey: 280, dragon: 420, portal: 400,
    moon: 260, pumpkin: 300, matrix: 340, sakura: 320, blackhole: 460,
    // ponytail: these 12 were added to js/ball.js BALL_SKINS by the .io shop
    // expansion but never mirrored here, so buyBall() silently rejected every
    // one of them (price lookup returned undefined). Fixed by syncing prices.
    copper: 200, blizzard: 230, ember_wisp: 210, neon_dash: 240, bubblegum: 220,
    cobalt_storm: 300, venom: 310, circuit: 340, aurora: 290,
    phoenix: 430, cosmic_serpent: 450, prism_king: 480,
    // ponytail: NewSkins pass — 6 more skins (js/ball.js BALL_SKINS).
    emberfall: 210, glacies: 230, binary_ghost: 310, event_null: 320,
    wildfire_phantom: 440, oblivion_shard: 470
});

const BALL_IDS = Object.keys(BALL_PRICES);
const COSMETIC_IDS = Object.keys(COSMETICS);

function titleCase(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ===== XP curve =====
// Linear ramp: tier 1 costs 100 xp, every tier after costs 20 xp more.
// Monotonically non-decreasing by construction; clamped to [1, MAX_TIER].
export function xpForTier(tier) {
    const t = Math.max(1, Math.min(MAX_TIER, Math.floor(Number(tier)) || 1));
    return 100 + (t - 1) * 20;
}

function clampTier(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(MAX_TIER, n);
}

// ===== Reward tables =====
function buildFreeTrack() {
    const rewards = [];
    for (let tier = 1; tier <= MAX_TIER; tier++) {
        if (tier % 10 === 0) {
            const id = BALL_IDS[(tier / 10 - 1) % BALL_IDS.length];
            rewards.push({ tier, kind: 'ball', id, name: `${titleCase(id)} Ball` });
        } else if (tier % 5 === 0) {
            rewards.push({
                tier, kind: 'xpboost', multiplier: 1.25, durationMs: 20 * 60 * 1000,
                name: '20-min XP Boost (1.25x)'
            });
        } else {
            const amount = 40 + tier * 3;
            rewards.push({ tier, kind: 'currency', amount, name: `+${amount} Coins` });
        }
    }
    return rewards;
}

function buildPremiumTrack() {
    const rewards = [];
    let cosmeticIndex = 0;
    for (let tier = 1; tier <= MAX_TIER; tier++) {
        if (tier === MAX_TIER) {
            const id = 'finisher_explosion';
            rewards.push({ tier, kind: 'cosmetic', id, name: COSMETICS[id].name });
        } else if (tier % 5 === 0) {
            const amount = 100 + tier * 4;
            rewards.push({ tier, kind: 'currency', amount, name: `+${amount} Coins` });
        } else if (tier % 3 === 0) {
            rewards.push({
                tier, kind: 'xpboost', multiplier: 1.5, durationMs: 30 * 60 * 1000,
                name: '30-min XP Boost (1.5x)'
            });
        } else {
            const id = COSMETIC_IDS[cosmeticIndex % COSMETIC_IDS.length];
            cosmeticIndex++;
            rewards.push({ tier, kind: 'cosmetic', id, name: COSMETICS[id].name });
        }
    }
    return rewards;
}

function assertRewardTrack(track, label) {
    const seen = new Set();
    for (const r of track) {
        if (!Number.isInteger(r.tier) || r.tier < 1 || r.tier > MAX_TIER) {
            throw new Error(`${label}: invalid tier ${r.tier}`);
        }
        if (seen.has(r.tier)) throw new Error(`${label}: duplicate tier ${r.tier}`);
        seen.add(r.tier);
        if (typeof r.name !== 'string' || !r.name) throw new Error(`${label} tier ${r.tier}: missing name`);
        switch (r.kind) {
            case 'currency':
                if (!Number.isFinite(r.amount) || r.amount <= 0) {
                    throw new Error(`${label} tier ${r.tier}: invalid currency amount`);
                }
                break;
            case 'xpboost':
                if (!Number.isFinite(r.multiplier) || r.multiplier <= 1) {
                    throw new Error(`${label} tier ${r.tier}: invalid xp boost multiplier`);
                }
                if (!Number.isFinite(r.durationMs) || r.durationMs <= 0) {
                    throw new Error(`${label} tier ${r.tier}: invalid xp boost duration`);
                }
                break;
            case 'cosmetic':
                if (!COSMETICS[r.id]) throw new Error(`${label} tier ${r.tier}: unknown cosmetic id "${r.id}"`);
                break;
            case 'ball':
                if (!BALL_PRICES[r.id]) throw new Error(`${label} tier ${r.tier}: unknown ball id "${r.id}"`);
                break;
            default:
                throw new Error(`${label} tier ${r.tier}: unknown reward kind "${r.kind}"`);
        }
    }
    if (seen.size !== MAX_TIER) throw new Error(`${label}: expected ${MAX_TIER} tiers, found ${seen.size}`);
}

export const FREE_TRACK = Object.freeze(buildFreeTrack().map(Object.freeze));
export const PREMIUM_TRACK = Object.freeze(buildPremiumTrack().map(Object.freeze));

// Fail loudly at import time — a typo'd reward id must never ship silently.
assertRewardTrack(FREE_TRACK, 'battlepass free track');
assertRewardTrack(PREMIUM_TRACK, 'battlepass premium track');

function isValidTier(tier) {
    return Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIER;
}

function isValidTrack(track) {
    return track === 'free' || track === 'premium';
}

export function getReward(tier, track) {
    if (!isValidTier(tier) || !isValidTrack(track)) return null;
    const table = track === 'free' ? FREE_TRACK : PREMIUM_TRACK;
    return table.find(r => r.tier === tier) || null;
}

// ===== Season model =====
export function createSeason(id = FIRST_SEASON_ID, startAt = Date.now()) {
    const safeId = Number.isInteger(id) && id > 0 ? id : FIRST_SEASON_ID;
    const safeStart = Number.isFinite(startAt) ? startAt : Date.now();
    return { id: safeId, startAt: safeStart, durationMs: SEASON_DURATION_MS };
}

export function seasonEndAt(season) {
    return season.startAt + season.durationMs;
}

export function isSeasonExpired(season, now = Date.now()) {
    return Number(now) >= seasonEndAt(season);
}

export function rolloverSeason(season, now = Date.now()) {
    if (!isSeasonExpired(season, now)) return season;
    return createSeason(season.id + 1, seasonEndAt(season));
}

// ===== Progress state =====
export function createProgressState(season = createSeason()) {
    return {
        seasonId: season.id,
        seasonStartAt: season.startAt,
        tier: 0,
        xp: 0,
        claimedFree: [],
        claimedPremium: [],
        premium: false
    };
}

// Rebuilds a well-formed progress object from whatever was in storage, including
// the pre-season single-track shape ({ tier, xp, claimed: [...], premium }).
export function normalizeProgress(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const legacyClaimed = Array.isArray(src.claimed)
        ? src.claimed.filter(n => Number.isInteger(n))
        : null;
    return {
        seasonId: Number.isInteger(src.seasonId) && src.seasonId > 0 ? src.seasonId : FIRST_SEASON_ID,
        seasonStartAt: Number.isFinite(src.seasonStartAt) ? src.seasonStartAt : Date.now(),
        tier: clampTier(src.tier),
        xp: Math.max(0, Math.floor(Number(src.xp)) || 0),
        claimedFree: Array.isArray(src.claimedFree)
            ? src.claimedFree.filter(n => Number.isInteger(n))
            : (legacyClaimed || []),
        claimedPremium: Array.isArray(src.claimedPremium)
            ? src.claimedPremium.filter(n => Number.isInteger(n))
            : [],
        premium: src.premium === true
    };
}

// Adds XP and rolls completed tiers forward. Pure, hostile-input safe: negative,
// NaN, or non-finite amounts are treated as zero gain. Never advances past MAX_TIER.
export function addXp(progress, amount) {
    const state = { ...progress, tier: clampTier(progress?.tier), xp: Math.max(0, Number(progress?.xp) || 0) };
    const gain = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
    state.xp += gain;
    let tiersGained = 0;
    while (state.tier < MAX_TIER) {
        const need = xpForTier(state.tier + 1);
        if (state.xp < need) break;
        state.xp -= need;
        state.tier += 1;
        tiersGained += 1;
    }
    return { state, tiersGained };
}

export function applySeasonRollover(progress, season, now = Date.now()) {
    if (!isSeasonExpired(season, now)) return { progress, season };
    const next = rolloverSeason(season, now);
    return { progress: createProgressState(next), season: next };
}

export function canClaim(progress, tier, track, { hasPremium = false } = {}) {
    if (!progress || !isValidTier(tier) || !isValidTrack(track)) return false;
    if (clampTier(progress.tier) < tier) return false;
    if (track === 'premium' && !hasPremium) return false;
    const claimedList = track === 'free' ? progress.claimedFree : progress.claimedPremium;
    return Array.isArray(claimedList) && !claimedList.includes(tier);
}

// Pure claim resolution. Returns null when the claim is invalid or already made
// (idempotent no-op) or { progress, reward } with the tier appended to the
// matching claimed list, ready for js/store.js to grant the reward.
export function claimReward(progress, tier, track, { hasPremium = false } = {}) {
    if (!canClaim(progress, tier, track, { hasPremium })) return null;
    const reward = getReward(tier, track);
    if (!reward) return null;
    const claimedField = track === 'free' ? 'claimedFree' : 'claimedPremium';
    return {
        progress: { ...progress, [claimedField]: [...progress[claimedField], tier] },
        reward
    };
}
