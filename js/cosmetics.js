import { AVATAR_SKINS } from './avatar.js';
import { COSMETICS } from './cosmetic-catalog.js';

const CASE_BALLS = Object.freeze({
    magma: { id: 'magma', name: 'Magma Core', rarity: 'legendary' },
    ocean: { id: 'ocean', name: 'Ocean Depths', rarity: 'epic' },
    moon: { id: 'moon', name: 'Moon Rock', rarity: 'rare' },
    portal: { id: 'portal', name: 'Portal Rift', rarity: 'legendary' },
    blackhole: { id: 'blackhole', name: 'Black Hole', rarity: 'legendary' }
});

export const KNIVES = Object.freeze({
    training: Object.freeze({ id: 'training', name: 'Arena Standard', rarity: 'common', model: 'classic', finish: 'satin', color: '#d7f3ff', accent: '#4e7d99', teams: ['red', 'blue'] }),
    tide: Object.freeze({ id: 'tide', name: 'Tidal Fang', rarity: 'rare', model: 'bayonet', finish: 'tide', color: '#36d8ca', accent: '#1673a3', teams: ['blue'] }),
    flare: Object.freeze({ id: 'flare', name: 'Solar Talon', rarity: 'rare', model: 'bayonet', finish: 'ember', color: '#ff6b5f', accent: '#ffad52', teams: ['red'] }),
    prism: Object.freeze({ id: 'prism', name: 'Prism Breaker', rarity: 'epic', model: 'butterfly', finish: 'prism', color: '#b77dff', accent: '#5a2f9d', teams: ['red', 'blue'] }),
    sherlock: Object.freeze({ id: 'sherlock', name: 'Clockwork Signature', rarity: 'legendary', model: 'karambit', finish: 'brass', color: '#ffd36b', accent: '#7b4c11', teams: ['red', 'blue'] }),
    doppler: Object.freeze({ id: 'doppler', name: 'Emerald Flux', rarity: 'legendary', model: 'butterfly', finish: 'aurora', color: '#28e092', accent: '#075f4d', teams: ['red', 'blue'] }),
    fade: Object.freeze({ id: 'fade', name: 'Sunset Arc', rarity: 'legendary', model: 'karambit', finish: 'sunset', color: '#ffbd56', accent: '#f05ca8', teams: ['red', 'blue'] }),
    crimson_web: Object.freeze({ id: 'crimson_web', name: 'Crimson Circuit', rarity: 'epic', model: 'karambit', finish: 'circuit', color: '#d92f4d', accent: '#4a0918', teams: ['red', 'blue'] }),
    obsidian: Object.freeze({ id: 'obsidian', name: 'Obsidian Rift', rarity: 'epic', model: 'karambit', finish: 'void', color: '#181124', accent: '#9b5cff', teams: ['red', 'blue'] }),
    aurora: Object.freeze({ id: 'aurora', name: 'Aurora Wings', rarity: 'legendary', model: 'butterfly', finish: 'aurora', color: '#58f2d5', accent: '#ef72ff', teams: ['red', 'blue'] }),
    pixel_edge: Object.freeze({ id: 'pixel_edge', name: 'Pixel Edge', rarity: 'rare', model: 'bayonet', finish: 'pixel', color: '#59e5df', accent: '#166a78', teams: ['red', 'blue'] }),
    icefang: Object.freeze({ id: 'icefang', name: 'Frost Fang', rarity: 'epic', model: 'karambit', finish: 'frost', color: '#dffbff', accent: '#398bd1', teams: ['blue'] }),
    dragonclaw: Object.freeze({ id: 'dragonclaw', name: 'Dragon Claw', rarity: 'legendary', model: 'karambit', finish: 'ember', color: '#ff7d32', accent: '#5c0909', teams: ['red'] }),
    reactor: Object.freeze({ id: 'reactor', name: 'Reactor Wings', rarity: 'legendary', model: 'butterfly', finish: 'reactor', color: '#b5ff42', accent: '#174d1d', teams: ['red', 'blue'] })
});

export const CASES = Object.freeze({
    kickoff: Object.freeze({
        id: 'kickoff', name: 'Kickoff Case', price: 120,
        art: 'assets/generated/cases/kickoff-case.webp',
        drops: Object.freeze([
            { id: 'tide', weight: 28 }, { id: 'flare', weight: 28 },
            { id: 'prism', weight: 16 }, { id: 'sherlock', weight: 3 },
            { id: 'neon', type: 'avatar', rarity: 'rare', weight: 12 },
            { id: 'frost', type: 'avatar', rarity: 'rare', weight: 7 },
            { id: 'astro', type: 'avatar', rarity: 'epic', weight: 4 },
            { id: 'arcade', type: 'avatar', rarity: 'legendary', weight: 2 }
        ])
    }),
    chroma: Object.freeze({
        id: 'chroma', name: 'Chroma Case', price: 180,
        art: 'assets/generated/cases/chroma-case.webp',
        drops: Object.freeze([
            { id: 'tide', weight: 22 }, { id: 'flare', weight: 22 }, { id: 'prism', weight: 17 },
            { id: 'crimson_web', weight: 6 }, { id: 'doppler', weight: 2 },
            { id: 'samurai', type: 'avatar', rarity: 'rare', weight: 10 },
            { id: 'moss', type: 'avatar', rarity: 'rare', weight: 8 },
            { id: 'striker', type: 'avatar', rarity: 'epic', weight: 4 },
            { id: 'void', type: 'avatar', rarity: 'epic', weight: 2 },
            { id: 'circuit', type: 'avatar', rarity: 'rare', weight: 7 }
        ])
    }),
    arsenal: Object.freeze({
        id: 'arsenal', name: 'Arsenal Case', price: 240,
        art: 'assets/generated/cases/arsenal-case.webp',
        drops: Object.freeze([
            { id: 'prism', weight: 32 }, { id: 'crimson_web', weight: 25 }, { id: 'fade', weight: 10 },
            { id: 'doppler', weight: 5 }, { id: 'sherlock', weight: 3 },
            { id: 'astro', type: 'avatar', rarity: 'rare', weight: 10 },
            { id: 'void', type: 'avatar', rarity: 'epic', weight: 9 },
            { id: 'royal', type: 'avatar', rarity: 'legendary', weight: 6 }
        ])
    }),
    elemental: Object.freeze({
        id: 'elemental', name: 'Elemental Case', price: 190,
        art: 'assets/generated/cases/elemental-case.webp',
        drops: Object.freeze([
            { id: 'magma', type: 'ball', rarity: 'legendary', weight: 4 },
            { id: 'ocean', type: 'ball', rarity: 'epic', weight: 12 },
            { id: 'moon', type: 'ball', rarity: 'rare', weight: 18 },
            { id: 'icefang', weight: 14 }, { id: 'dragonclaw', weight: 4 },
            { id: 'cape_ember', type: 'cosmetic', weight: 18 },
            { id: 'cape_frost', type: 'cosmetic', weight: 18 },
            { id: 'aura_void', type: 'cosmetic', weight: 4 },
            { id: 'impact_fire', type: 'cosmetic', weight: 8 }
        ])
    }),
    companions: Object.freeze({
        id: 'companions', name: 'Companion Case', price: 210,
        art: 'assets/generated/cases/companions-case.webp',
        drops: Object.freeze([
            { id: 'pet_slime', type: 'cosmetic', weight: 24 },
            { id: 'pet_snowman', type: 'cosmetic', weight: 20 },
            { id: 'pet_bee', type: 'cosmetic', weight: 16 },
            { id: 'pet_drone', type: 'cosmetic', weight: 14 },
            { id: 'pet_axolotl', type: 'cosmetic', weight: 8 },
            { id: 'pet_dragon', type: 'cosmetic', weight: 4 },
            { id: 'bee_runner', type: 'avatar', rarity: 'epic', weight: 8 },
            { id: 'axolotl_scout', type: 'avatar', rarity: 'legendary', weight: 4 },
            { id: 'pixel_edge', weight: 2 }
        ])
    }),
    mythic: Object.freeze({
        id: 'mythic', name: 'Mythic Arena Case', price: 280,
        art: 'assets/generated/cases/mythic-case.webp',
        drops: Object.freeze([
            { id: 'aurora', weight: 8 }, { id: 'reactor', weight: 8 },
            { id: 'portal', type: 'ball', rarity: 'legendary', weight: 10 },
            { id: 'blackhole', type: 'ball', rarity: 'legendary', weight: 6 },
            { id: 'galaxy_idol', type: 'avatar', rarity: 'legendary', weight: 10 },
            { id: 'infernal_smile', type: 'avatar', rarity: 'legendary', weight: 10 },
            { id: 'cape_royal', type: 'cosmetic', weight: 12 },
            { id: 'cape_glitch', type: 'cosmetic', weight: 10 },
            { id: 'shoes_magma', type: 'cosmetic', weight: 12 },
            { id: 'impact_glitch', type: 'cosmetic', weight: 14 }
        ])
    })
});

function resolveCaseDrop(drop) {
    if (drop.type === 'avatar') {
        const skin = AVATAR_SKINS[drop.id];
        return skin ? { ...skin, type: 'avatar', rarity: drop.rarity } : null;
    }
    if (drop.type === 'ball') {
        const ball = CASE_BALLS[drop.id];
        return ball ? { ...ball, id: drop.id, type: 'ball', rarity: drop.rarity || ball.rarity } : null;
    }
    if (drop.type === 'cosmetic') {
        const cosmetic = COSMETICS[drop.id];
        return cosmetic ? { ...cosmetic, type: 'cosmetic' } : null;
    }
    const knife = KNIVES[drop.id];
    return knife ? { ...knife, type: 'knife' } : null;
}

export function resolveCaseReward(caseId, reward) {
    const drop = CASES[caseId]?.drops.find(item => item.id === reward?.id && (item.type || 'knife') === reward?.type);
    return drop ? resolveCaseDrop(drop) : null;
}

export function secureCosmeticRandom() {
    if (globalThis.crypto?.getRandomValues) {
        const values = new Uint32Array(1);
        globalThis.crypto.getRandomValues(values);
        return values[0] / 0x100000000;
    }
    return Math.random();
}

export function rollCase(caseId, random = secureCosmeticRandom, options = {}) {
    const box = CASES[caseId];
    if (!box) return null;
    const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
    const minimumRank = rarityRank[options.minimumRarity] ?? -1;
    const drops = box.drops.filter(drop => (rarityRank[resolveCaseDrop(drop)?.rarity] ?? 0) >= minimumRank);
    if (!drops.length) return null;
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    let roll = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * total;
    for (const drop of drops) {
        roll -= drop.weight;
        if (roll < 0) return resolveCaseDrop(drop);
    }
    return null;
}

export function getCaseDropRates(caseId, options = {}) {
    const box = CASES[caseId];
    if (!box) return [];
    const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
    const minimumRank = rarityRank[options.minimumRarity] ?? -1;
    const drops = box.drops.filter(drop => (rarityRank[resolveCaseDrop(drop)?.rarity] ?? 0) >= minimumRank);
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    return drops.map(drop => ({
        id: drop.id,
        name: resolveCaseDrop(drop)?.name || drop.id,
        rarity: resolveCaseDrop(drop)?.rarity || 'common',
        type: resolveCaseDrop(drop)?.type || 'knife',
        preview: ['avatar', 'cosmetic'].includes(resolveCaseDrop(drop)?.type) ? resolveCaseDrop(drop) : null,
        chance: total > 0 ? drop.weight / total : 0
    }));
}

export function canEquipKnife(knifeId, team) {
    const knife = KNIVES[knifeId];
    return !!knife && knife.teams.includes(team);
}

// Case reveal pacing. Keyed off rarity families, never per item: grinding commons
// must never cost the player time, while a legendary earns the long beat.
// `slowMo` mirrors Juice.slowMo's scale contract (<1 = slower) and is what
// stretches the reel, so the drama comes from one number instead of a table.
// CS:GO's real case reel runs ~6-7s total regardless of what was rolled (only
// the post-stop flourish differs by rarity) — REVEAL_BASE_SPIN_MS was 1200 (a
// 1.2s-3.4s spin the user correctly called "too fast/flat"). Tiers now cluster
// tightly in the 6.3s-7.0s band instead of spanning 1.2s-3.4s: the ordering
// invariant (legendary > rare > common) is preserved for tests/tuning, but the
// spread is small enough that every open reads as "the CS:GO wait", not a
// rarity-gated timer.
const REVEAL_BASE_SPIN_MS = 6300;

const REVEAL_TIERS = Object.freeze({
    fast: Object.freeze({ tier: 'fast', slowMo: 1, holdMs: 900, flash: 0, sfx: null }),
    medium: Object.freeze({ tier: 'medium', slowMo: 0.955, holdMs: 1800, flash: 0, sfx: null }),
    long: Object.freeze({ tier: 'long', slowMo: 0.9, holdMs: 3200, flash: 0.45, sfx: 'tf2_domination' })
});

const REVEAL_FAMILIES = Object.freeze({
    common: 'fast', uncommon: 'fast',
    rare: 'medium', epic: 'medium',
    legendary: 'long', exotic: 'long'
});

// Rarity-level reveal flourishes, layered on top of the tier timing above.
// Rare/epic used to be visually identical (both "medium" tier, no flash, no
// sfx) — this is what actually tells them apart: distinct glow colour, an
// epic-only screen pulse + sting, a legendary-only pre-stop hitch + confetti.
// Keyed by resolved rarity (not tier family) so rare and epic can diverge
// while sharing the same spin/hold pacing. `sfx` here overrides the tier's
// sfx when present; reduced motion never touches it (audio payoff survives).
const RARITY_FX = Object.freeze({
    common: Object.freeze({ flashAmt: 0, glow: null, pulse: false, confetti: false, preStop: false, sfx: null }),
    uncommon: Object.freeze({ flashAmt: 0, glow: null, pulse: false, confetti: false, preStop: false, sfx: null }),
    rare: Object.freeze({ flashAmt: 0.22, glow: 'blue', pulse: false, confetti: false, preStop: false, sfx: null }),
    epic: Object.freeze({ flashAmt: 0.34, glow: 'purple', pulse: true, confetti: false, preStop: false, sfx: 'tf2_crit' }),
    legendary: Object.freeze({ flashAmt: 0.55, glow: 'gold', pulse: true, confetti: true, preStop: true, sfx: 'tf2_domination' }),
    exotic: Object.freeze({ flashAmt: 0.55, glow: 'gold', pulse: true, confetti: true, preStop: true, sfx: 'tf2_domination' })
});

export function revealPresentationForRarity(rarity, options = {}) {
    const key = typeof rarity === 'string' ? rarity.trim().toLowerCase() : '';
    const base = REVEAL_TIERS[REVEAL_FAMILIES[key]] || REVEAL_TIERS.fast;
    const rarityFx = RARITY_FX[key] || RARITY_FX.common;
    const reducedMotion = options?.reducedMotion === true;
    // Reduced motion collapses the motion profile, never the audio payoff:
    // the sting is a reward cue, not an animation.
    const shape = reducedMotion ? REVEAL_TIERS.fast : base;
    const fxShape = reducedMotion ? RARITY_FX.common : rarityFx;
    const spinMs = Math.round(REVEAL_BASE_SPIN_MS / shape.slowMo);
    return {
        rarity: key || 'common',
        tier: base.tier,
        slowMo: shape.slowMo,
        spinMs,
        holdMs: shape.holdMs,
        durationMs: spinMs + shape.holdMs,
        flash: reducedMotion ? 0 : fxShape.flashAmt,
        sfx: rarityFx.sfx ?? base.sfx,
        glow: fxShape.glow,
        pulse: fxShape.pulse,
        confetti: fxShape.confetti,
        preStop: fxShape.preStop,
        reducedMotion
    };
}

// Duplicate-case conversion line, pure + testable without touching the DOM.
// Rounds/clamps so a bad refund number never renders "Duplicate -> +NaN coins".
export function formatDuplicateConversion(refund) {
    const amount = Math.max(0, Math.round(Number(refund) || 0));
    return `Duplicate \u2192 +${amount} coins`;
}

// ===== CS:GO-style reel pacing: tick schedule + near-miss arrangement =====
// Both pure (no DOM), so they're directly unit-testable and reusable if the
// reel ever needs a second driver (e.g. a replay/preview).

// Single bezier drives both the CSS spin animation (css/polish.css
// .case-reel-track.spin @keyframes case-reel-spin) and this tick math — they
// MUST stay the same curve or the clicks drift out of sync with the tiles.
const REEL_SPIN_BEZIER = Object.freeze({ x1: 0.08, y1: 0.6, x2: 0.1, y2: 1 });
// The last 8% of the animation is the tiny overshoot/back-correction wobble
// (see the keyframes), not real tile travel, so ticks only span the first 92%.
const REEL_TRAVEL_FRACTION = 0.92;
// Below this gap two "crossings" would sound like one smeared click — the
// bezier's fast-launch phase packs many tiles into the first handful of ms.
const REEL_TICK_MIN_GAP_MS = 20;

function cubicBezierComponent(t, c1, c2) {
    const mt = 1 - t;
    return 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t;
}

// Bisection is enough here — this schedules audio cues, not pixels, and it
// runs once per reel open (well under 1ms for ~30 tiles x 12 iterations).
function solveBezierTForY(targetY, y1, y2, iterations = 16) {
    let lo = 0, hi = 1;
    for (let i = 0; i < iterations; i++) {
        const mid = (lo + hi) / 2;
        if (cubicBezierComponent(mid, y1, y2) < targetY) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

// Computes the elapsed-time offsets (ms, from spin start) at which each tile
// boundary crosses the center marker, by inverting the same cubic-bezier the
// CSS spin animation runs. `crossingCount` is the number of crossings before
// AND including the landing tile (== targetIndex, since tile 0 is the start
// and tile targetIndex is the winner) — tiles are evenly spaced in DISTANCE,
// so crossing i happens when the bezier's output (distance) reaches
// i/crossingCount, solved via bisection on the curve's y (distance)
// component, then mapped back to real elapsed time via its x (time)
// component at that same parametric t. i === crossingCount lands at
// distanceFrac 1.0, i.e. exactly at the travel-fraction boundary — matching
// the CSS keyframes, where the tile is already visually in place by 92% and
// the last 8% is only the overshoot/back-correction wobble.
export function computeCaseReelTickSchedule(spinMs, crossingCount, options = {}) {
    const duration = Number(spinMs);
    const tiles = Math.floor(Number(crossingCount));
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(tiles) || tiles < 1) return [];
    const bezier = options.bezier || REEL_SPIN_BEZIER;
    const travelFraction = Number.isFinite(options.travelFraction) ? options.travelFraction : REEL_TRAVEL_FRACTION;
    const minGapMs = Number.isFinite(options.minGapMs) ? options.minGapMs : REEL_TICK_MIN_GAP_MS;
    const travelMs = duration * travelFraction;
    const schedule = [];
    let lastTime = -Infinity;
    for (let i = 1; i <= tiles; i++) {
        const distanceFrac = i / tiles;
        const t = solveBezierTForY(distanceFrac, bezier.y1, bezier.y2);
        const timeMs = Math.round(cubicBezierComponent(t, bezier.x1, bezier.x2) * travelMs);
        if (timeMs - lastTime < minGapMs) continue; // dedupe the fast-launch blur into one click
        schedule.push({ index: i, timeMs });
        lastTime = timeMs;
    }
    return schedule;
}

// Rarities that count as a "near miss" when sitting beside the winner.
const HIGH_RARITY_NEAR_MISS = Object.freeze(['epic', 'legendary', 'exotic']);

// CS:GO-style tension: reposition (never replace) filler tiles so a
// high-rarity item often sits right next to the winner. `items[targetIndex]`
// is the already-decided winner and is never touched or counted as a donor —
// this only swaps WHERE already-rolled filler tiles land, so drop-rate odds
// (which picked those fillers before this ever runs) are untouched.
export function arrangeNearMissFillers(items, targetIndex, options = {}) {
    const arranged = Array.isArray(items) ? items.slice() : [];
    const target = Number(targetIndex);
    if (!arranged.length || !Number.isInteger(target) || target < 0 || target >= arranged.length) return arranged;

    const windowSize = Number.isFinite(options.windowSize) ? Math.max(1, Math.floor(options.windowSize)) : 2;
    const minAdjacent = Number.isFinite(options.minAdjacent) ? Math.max(0, Math.floor(options.minAdjacent)) : 1;
    const highRarities = options.highRarities || HIGH_RARITY_NEAR_MISS;
    const isHigh = item => highRarities.includes(item?.rarity);

    const windowIndices = [];
    for (let d = 1; d <= windowSize; d++) {
        if (target - d >= 0) windowIndices.push(target - d);
        if (target + d < arranged.length) windowIndices.push(target + d);
    }

    const have = windowIndices.filter(i => isHigh(arranged[i])).length;
    if (have >= minAdjacent) return arranged;

    const donors = [];
    for (let i = 0; i < arranged.length; i++) {
        if (i === target || windowIndices.includes(i)) continue;
        if (isHigh(arranged[i])) donors.push(i);
    }
    const slots = windowIndices.filter(i => !isHigh(arranged[i]));

    const needed = minAdjacent - have;
    for (let k = 0; k < needed && k < donors.length && k < slots.length; k++) {
        const from = donors[k];
        const to = slots[k];
        [arranged[from], arranged[to]] = [arranged[to], arranged[from]];
    }
    return arranged;
}
