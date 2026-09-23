// ball-skin-fx.js — rendering-only upgrades for BALL_SKINS (js/ball.js): procedural per-skin
// surface detail, rarity-aware trail tuning, and a tiny pooled impact-burst effect.
//
// SCOPE: this module adds NO new catalog entries, prices, or case drops — it only reads the
// `effect`/`rarity`/`shape` fields BALL_SKINS already carries and turns them into a look. The
// lead owns the catalog; this file only owns how an existing skin is drawn.
//
// PATTERN: mirrors js/procedural-textures.js's contract so it is testable the same way —
// a pure, DOM-free pixel painter (works under `node --test`, no canvas/WebGL) feeds a small
// document-guarded CanvasTexture factory. The two modules are kept independent on purpose
// (no shared import) since procedural-textures.js belongs to arena surfaces, not ball skins,
// and multiple agents may be touching either concurrently.
//
// SHADER NOTE: js/shaders/toon.frag.js multiplies `uColor * texture.rgb`, so a texture can
// only ever darken the equipped color, never out-brighten it. Every pattern below is drawn as
// a bright (~1.0) linework/facet network over a darker shaded body — seams, veins, hex edges,
// circuit traces — which reads as inlaid/lit detail against the base color without touching
// the shared toon shader files.
import * as THREE from 'three';
import { ObjectPool } from './objectPool.js';

// ---------------------------------------------------------------------------
// Pure helpers — no THREE, no DOM. Deterministic for a given seed.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// FNV-1a — same algorithm as procedural-textures.js#hashSeed, kept as a private local copy
// so this module has zero import coupling to it (see file header).
function hashText(text) {
    let hash = 0x811c9dc5;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export const SKIN_PATTERN_KINDS = Object.freeze([
    'panel', 'hex', 'circuit', 'vein', 'facet', 'drip', 'glitch', 'stripe', 'plain'
]);

// Maps BALL_SKINS' existing `effect` (and `shape`, for model skins) to a surface archetype.
// Every current skin already carries `effect`; any future one falls back to 'plain', so this
// never needs to change when the lead adds a new catalog entry.
export function skinPatternKind(effect, shape) {
    if (shape && shape !== 'sphere') return 'panel'; // built hardware reads as paneled plating
    switch (effect) {
        case 'flame': return 'vein';
        case 'frost': return 'facet';
        case 'spark': return 'circuit';
        case 'void': return 'hex';
        case 'glitch': return 'glitch';
        case 'toxic': return 'drip';
        case 'candy': return 'stripe';
        case 'prism': return 'facet';
        case 'pixel': return 'panel';
        default: return 'plain';
    }
}

const REPEAT_BY_KIND = Object.freeze({
    panel: [3, 2], hex: [3, 3], circuit: [3, 2], vein: [2, 2],
    facet: [2, 2], drip: [2, 3], glitch: [3, 3], stripe: [2, 2], plain: [1, 1]
});

export function repeatForPatternKind(kind) {
    return REPEAT_BY_KIND[kind] || REPEAT_BY_KIND.plain;
}

/**
 * Pure pixel painter — RGBA multiplier map (grayscale; toon shader multiplies this into
 * uColor). Deterministic for identical inputs, DOM-free so it is unit-testable directly.
 * @returns {Uint8ClampedArray}
 */
export function paintBallSkinPattern({ kind = 'plain', size = 48, seed = 0, legendary = false } = {}) {
    const dim = Math.max(2, Math.floor(size));
    const out = new Uint8ClampedArray(dim * dim * 4);
    const random = mulberry32(hashText(`${kind}:${dim}:${seed}:${legendary ? 1 : 0}`));
    const blocks = Math.max(2, Math.min(8, dim >> 2 || 2));
    const cell = dim / blocks;
    const jitter = new Float32Array(blocks * blocks);
    for (let i = 0; i < jitter.length; i++) jitter[i] = random();

    const base = legendary ? 0.86 : 0.80;
    const lineBoost = legendary ? 1.0 : 0.92;

    for (let y = 0; y < dim; y++) {
        const by = Math.min(blocks - 1, Math.floor(y / cell));
        const yInCell = y - by * cell;
        for (let x = 0; x < dim; x++) {
            const bx = Math.min(blocks - 1, Math.floor(x / cell));
            const xInCell = x - bx * cell;
            const cellJitter = jitter[by * blocks + bx];
            let value = base;

            switch (kind) {
                case 'panel': {
                    const groove = xInCell < 1 || yInCell < 1;
                    value = groove ? base - 0.28 : base + cellJitter * 0.06;
                    const mid = cell / 2;
                    if (Math.abs(xInCell - mid) < cell * 0.14 && Math.abs(yInCell - mid) < cell * 0.14 && cellJitter > 0.6) {
                        value = lineBoost;
                    }
                    break;
                }
                case 'hex': {
                    const rowShift = (by % 2) * (cell / 2);
                    const hx = (x + rowShift) % cell;
                    const edge = hx < 1 || hx > cell - 2 || yInCell < 1;
                    value = edge ? lineBoost : base - 0.1 + cellJitter * 0.05;
                    break;
                }
                case 'circuit': {
                    const trace = (xInCell < 1 && by % 2 === 0) || (yInCell < 1 && bx % 2 === 0);
                    const node = xInCell < 1.6 && yInCell < 1.6 && cellJitter > 0.7;
                    value = node ? lineBoost : trace ? lineBoost - 0.05 : base - 0.14;
                    break;
                }
                case 'vein': {
                    const dx = xInCell - cell / 2;
                    const dy = yInCell - cell / 2;
                    const dist = Math.hypot(dx, dy) / (cell * 0.7 || 1);
                    const vein = Math.abs(dist - (0.35 + cellJitter * 0.3)) < 0.12;
                    value = vein ? lineBoost : base - 0.16 - Math.abs(cellJitter) * 0.08;
                    break;
                }
                case 'facet': {
                    const tri = (bx + by) % 3;
                    value = base - tri * 0.09 + cellJitter * 0.05;
                    if (xInCell < 1 || yInCell < 1) value = Math.min(1, value + 0.14);
                    break;
                }
                case 'drip': {
                    const wave = Math.sin((by + cellJitter * 3) * 1.7) * cell * 0.25;
                    const dripX = ((xInCell + wave) % cell + cell) % cell;
                    value = dripX < cell * 0.22 ? base - 0.22 : base + cellJitter * 0.05;
                    break;
                }
                case 'glitch': {
                    const bandNoise = jitter[by * blocks + ((bx + 1) % blocks)];
                    value = bandNoise > 0.82 ? lineBoost : base - Math.abs(cellJitter) * 0.22;
                    break;
                }
                case 'stripe': {
                    const band = Math.max(4, Math.round(cell * 1.5));
                    const diag = ((x + y) % band + band) % band;
                    value = diag < 2 ? base - 0.18 : base + cellJitter * 0.05;
                    break;
                }
                case 'plain':
                default: {
                    // Kept near-neutral on purpose: skins with no strong archetype (classic,
                    // smile, simple faces) should barely darken relative to a flat uColor —
                    // only the detailed kinds below trade brightness for surface definition.
                    value = (legendary ? 0.97 : 0.94) + cellJitter * 0.03;
                    break;
                }
            }

            const v = Math.max(0, Math.min(1, value));
            const idx = (y * dim + x) * 4;
            const byteV = Math.round(v * 255);
            out[idx] = byteV;
            out[idx + 1] = byteV;
            out[idx + 2] = byteV;
            out[idx + 3] = 255;
        }
    }
    return out;
}

// Toon shader has no PBR roughness/metalness; uRimPower (already a per-material uniform
// createToonMaterial exposes) is the one knob that reads as "shiny vs matte" in a cel-shaded
// rim light — a tight, bright rim (low power... actually higher pow = tighter) for hardware
// skins and glossy effects, a soft wide rim for organic/soft ones.
export function rimPowerForSkin(skin = {}) {
    if (skin.shape && skin.shape !== 'sphere') return 7.5; // machined plating — tight specular-like rim
    switch (skin.effect) {
        case 'spark':
        case 'glitch':
            return 6.5; // metallic/circuit sheen
        case 'toxic':
        case 'candy':
            return 3.2; // soft organic falloff
        default:
            return 5.0; // matches createToonMaterial's existing default
    }
}

export const RARITY_TRAIL_SCALE = Object.freeze({
    common: 1, rare: 1.08, epic: 1.18, legendary: 1.32
});

// Overdrive stacks on top of the rarity multiplier — the same "pinned at the mode cap" signal
// ball.js's heat shell already uses, just carried into trail width/opacity too.
export function trailIntensityMultiplier(rarity, isOverdrive = false) {
    const base = RARITY_TRAIL_SCALE[rarity] ?? RARITY_TRAIL_SCALE.common;
    return isOverdrive ? base * 1.35 : base;
}

// ---------------------------------------------------------------------------
// Cached CanvasTexture factory — DOM-guarded, bounded LRU so a long session that cycles
// through many skins (shop preview, spectate) never leaks GPU textures.
// ---------------------------------------------------------------------------

const MAX_CACHED_TEXTURES = 28;
const textureCache = new Map();
const textureOrder = [];

export function ballSkinTextureCacheKey(skinId, quality) {
    return `${skinId}|${quality}`;
}

export function ballSkinTextureCacheSize() {
    return textureCache.size;
}

function buildBallSkinTexture(skinId, skin, quality) {
    // Same guard as js/procedural-textures.js#buildTexture and js/social-lobby.js — no DOM,
    // no texture (headless/node:test environment).
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const TextureClass = THREE.CanvasTexture || THREE.Texture;
    if (!TextureClass) return null;

    const size = quality === 'high' ? 64 : 32;
    const kind = skinPatternKind(skin.effect, skin.shape);
    const legendary = skin.rarity === 'legendary';
    const pixels = paintBallSkinPattern({ kind, size, seed: hashText(skinId), legendary });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);

    const texture = new TextureClass(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const [rx, ry] = repeatForPatternKind(kind);
    texture.repeat.set(rx, ry);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/**
 * Memoized per-skin, per-quality surface texture. Returns null on 'low' quality (task
 * requirement: Low quality = no extra FX) or in a DOM-less environment.
 */
export function getBallSkinTexture(skinId, skin, quality = 'medium') {
    if (!skin || quality === 'low') return null;
    // The free default (classic) skin has no `effect`/custom `shape` and keeps its exact
    // pre-existing flat look — only purchasable skins opt into the new surface detail.
    if (!skin.effect && (!skin.shape || skin.shape === 'sphere')) return null;
    const key = ballSkinTextureCacheKey(skinId, quality);
    if (textureCache.has(key)) {
        const idx = textureOrder.indexOf(key);
        if (idx !== -1) textureOrder.splice(idx, 1);
        textureOrder.push(key);
        return textureCache.get(key);
    }
    const texture = buildBallSkinTexture(skinId, skin, quality);
    if (!texture) return null;
    textureCache.set(key, texture);
    textureOrder.push(key);
    while (textureOrder.length > MAX_CACHED_TEXTURES) {
        const evictKey = textureOrder.shift();
        if (evictKey === key) continue;
        const evictTexture = textureCache.get(evictKey);
        evictTexture?.dispose?.();
        textureCache.delete(evictKey);
    }
    return texture;
}

// Disposes every cached texture (quality change, test teardown). Returns the count disposed.
export function clearBallSkinTextureCache() {
    let disposed = 0;
    for (const texture of textureCache.values()) {
        texture.dispose?.();
        disposed++;
    }
    textureCache.clear();
    textureOrder.length = 0;
    return disposed;
}

// ---------------------------------------------------------------------------
// Pooled impact burst — short skin-colored spark/ring on deflect/bounce/hit.
// Zero per-frame allocation: particles are plain records mutated in place, meshes are
// pulled from a bounded ObjectPool exactly like ball.js's own trail pool.
// ---------------------------------------------------------------------------

const IMPACT_SPARK_COUNT = 5;
export const IMPACT_FX_MAX_ACTIVE = 32;

let sharedImpactGeometries = null;
function getSharedImpactGeometries() {
    if (!sharedImpactGeometries) {
        sharedImpactGeometries = Object.freeze({
            ring: new THREE.TorusGeometry(0.5, 0.07, 6, 14),
            spark: new THREE.TetrahedronGeometry(1, 0)
        });
    }
    return sharedImpactGeometries;
}

export class BallImpactFX {
    constructor(scene, maxActive = IMPACT_FX_MAX_ACTIVE) {
        this.scene = scene;
        this.maxActive = maxActive;
        this.geometries = getSharedImpactGeometries();
        this.pool = new ObjectPool(
            () => new THREE.Mesh(this.geometries.spark, new THREE.MeshBasicMaterial({
                transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending
            })),
            mesh => { mesh.visible = false; this.scene?.remove(mesh); },
            mesh => mesh.material.dispose(),
            maxActive
        );
        this.active = [];
    }

    // position: {x,y,z}-like. options.intensity scales size/count (0.4..1.6 typical).
    spawn(position, color, { intensity = 1 } = {}) {
        if (!position || !this.scene) return;
        const clampedIntensity = Math.max(0.35, Math.min(1.8, intensity));

        const ring = this.pool.acquire();
        ring.geometry = this.geometries.ring;
        ring.material.color.setHex(color);
        ring.material.opacity = 0.85;
        ring.position.copy ? ring.position.copy(position) : Object.assign(ring.position, position);
        ring.rotation.set(Math.PI / 2, 0, 0);
        const ringScale = 0.16 * clampedIntensity;
        ring.scale.setScalar(ringScale);
        ring.visible = true;
        this.scene.add(ring);
        this.active.push({
            mesh: ring, life: 0.24, maxLife: 0.24, kind: 'ring',
            dx: 0, dy: 0, dz: 0, baseScale: ringScale, growTo: ringScale * 2.9
        });

        const sparkCount = Math.max(1, Math.round(IMPACT_SPARK_COUNT * clampedIntensity));
        for (let i = 0; i < sparkCount; i++) {
            const mesh = this.pool.acquire();
            mesh.geometry = this.geometries.spark;
            mesh.material.color.setHex(color);
            mesh.material.opacity = 0.92;
            mesh.position.copy ? mesh.position.copy(position) : Object.assign(mesh.position, position);
            // Deterministic-ish spread (no RNG call needed per particle): index angle nudged
            // by the impact position so repeated bursts at the same spot don't look identical.
            const angle = (i / sparkCount) * Math.PI * 2 + (position.x * 0.7 + position.z * 0.3);
            const speed = (1.4 + (i % 3) * 0.5) * clampedIntensity;
            const baseScale = 0.05 * clampedIntensity;
            mesh.scale.setScalar(baseScale);
            mesh.visible = true;
            this.scene.add(mesh);
            this.active.push({
                mesh, life: 0.2, maxLife: 0.2, kind: 'spark',
                dx: Math.cos(angle) * speed, dy: 1.3 + (i % 2) * 0.5, dz: Math.sin(angle) * speed,
                baseScale, growTo: 0
            });
        }

        // Hard cap even if callers spawn faster than particles die — release the oldest.
        while (this.active.length > this.maxActive) {
            const stale = this.active.shift();
            this.pool.release(stale.mesh);
        }
    }

    update(dt) {
        if (this.active.length === 0 || !Number.isFinite(dt) || dt <= 0) return;
        for (let i = this.active.length - 1; i >= 0; i--) {
            const p = this.active[i];
            p.life -= dt;
            const ratio = Math.max(0, p.life / p.maxLife);
            if (p.kind === 'ring') {
                p.mesh.scale.setScalar(p.baseScale + (p.growTo - p.baseScale) * (1 - ratio));
            } else {
                p.mesh.position.x += p.dx * dt;
                p.mesh.position.y += p.dy * dt;
                p.mesh.position.z += p.dz * dt;
                p.dy -= 6 * dt;
                p.mesh.scale.setScalar(Math.max(0.001, p.baseScale * ratio));
            }
            p.mesh.material.opacity = ratio;
            if (p.life <= 0) {
                this.pool.release(p.mesh);
                this.active.splice(i, 1);
            }
        }
    }

    get activeCount() {
        return this.active.length;
    }

    clear() {
        for (const p of this.active) this.pool.release(p.mesh);
        this.active.length = 0;
    }
}
