// combat-fx.js — pure, unit-tested tuning helpers for the damage-number/combo
// visual escalation layer. No DOM/THREE/window access here so every curve is
// testable in plain node:test (see tests/combat-fx.test.mjs); the actual
// rendering lives in js/ui.js (damage-number/combo section), js/juice.js
// (combo state + particle reuse) and js/game.js (combat FX hook regions).

// Damage-number tier: classifies a single hit for the scale/color ladder
// (small white -> medium yellow -> large orange -> kill red+biggest).
// isLethal always wins over raw magnitude — a finishing blow always reads as
// the biggest, reddest number regardless of how much HP it actually removed.
export function classifyDamageTier(dmg, isLethal = false) {
    if (isLethal) return 'kill';
    const n = Number(dmg) || 0;
    if (n >= 45) return 'large';
    if (n >= 22) return 'medium';
    return 'small';
}

// Damage-number DOM pool: fixed-size round robin so spawnDamageNumber never
// calls createElement after the pool warms up (0-alloc steady state). cursor
// wraps at poolSize; a non-positive poolSize always yields slot 0.
export function nextPoolCursor(cursor, poolSize) {
    if (!(poolSize > 0)) return 0;
    const next = (Number(cursor) || 0) + 1;
    return ((next % poolSize) + poolSize) % poolSize;
}

// Deterministic per-slot jitter so consecutive hits landing on the same
// screen point don't stack pixel-for-pixel. Cycles through a small offset
// table keyed by the pool cursor — no per-hit Math.random needed, and the
// pattern still reads as varied because the cursor keeps advancing.
const DAMAGE_JITTER_TABLE = Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: -16, y: -6 }),
    Object.freeze({ x: 14, y: 4 }),
    Object.freeze({ x: -8, y: 10 }),
    Object.freeze({ x: 18, y: -10 }),
    Object.freeze({ x: -20, y: 2 }),
    Object.freeze({ x: 6, y: -14 }),
    Object.freeze({ x: -4, y: 12 })
]);
export function damageJitterFor(cursor) {
    const idx = ((Number(cursor) || 0) % DAMAGE_JITTER_TABLE.length + DAMAGE_JITTER_TABLE.length) % DAMAGE_JITTER_TABLE.length;
    return DAMAGE_JITTER_TABLE[idx];
}

// Combo visual/audio tier — independent of Juice.getComboMultiplier's per-hit
// damage curve, this drives escalating glow/pitch: 0 = base (below 3, no
// special treatment), 1 = bright (3-5), 2 = hot (6-9), 3 = max (10+, matches
// the multiplier's own cap at combo*0.2 -> +2x).
export function comboTier(combo) {
    const n = Number(combo) || 0;
    if (n >= 10) return 3;
    if (n >= 6) return 2;
    if (n >= 3) return 1;
    return 0;
}

// Audio pitch ramp for combo-tier sfx (perfect-deflect crit, kill-streak
// fanfare) — +6% playbackRate per tier, capped so it stays musical rather
// than chipmunk-pitched at max combo.
export function comboPitchRate(tier) {
    const t = Math.max(0, Math.min(3, Number(tier) || 0));
    return 1 + t * 0.06;
}
