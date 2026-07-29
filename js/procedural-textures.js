// procedural-textures.js — seeded, cached, tileable surface textures for the arenas.
// Replaces js/arena.js#_buildFloorTexture, which used Math.random() (so a map never looked
// the same twice and nothing was testable) and minted a fresh 256x256 texture per call that
// clearMap() never disposed — material.dispose() does not free material.map.
//
// PLAN.md section 9 mandates shared materials and a per-model texture budget, so every
// surface goes through the memoizing getTexture(): equal arguments return one shared
// instance, and clearTextureCache() releases the whole set on map switch.
//
// Pixel generation (paintSurface) is deliberately DOM-free and returns a raw byte array, so
// determinism is assertable under `node --test` where there is no canvas and no WebGL.
import * as THREE from 'three';

// 8 blocks per tile keeps the Minecraft-adjacent read: with the repeat values arena.js
// derives from court size, one block lands on roughly one world unit.
export const BLOCKS_PER_TILE = 8;

// Real quality flag is the renderer's: js/renderer.js#setQuality clamps to low|medium|high
// (js/store.js settings.quality). No second preset system is introduced here.
export const TEXTURE_SIZE_BY_QUALITY = { low: 16, medium: 64, high: 128 };

export const SURFACE_KINDS = ['checker', 'plank', 'panel', 'grid', 'stone', 'speck'];

// Contrast is capped per surface, and floors get the tightest cap on purpose: the ball
// travels along the floor, and PLAN.md line 98 forbids effects that hide the ball. A
// low luminance spread keeps floor detail from competing with the ball's silhouette.
export const SURFACE_CONTRAST = { floor: 0.07, wall: 0.18, ceiling: 0.16, prop: 0.2 };

export function resolveTextureSize(quality) {
    return TEXTURE_SIZE_BY_QUALITY[quality] ?? TEXTURE_SIZE_BY_QUALITY.medium;
}

export function resolveContrast(surface) {
    return SURFACE_CONTRAST[surface] ?? SURFACE_CONTRAST.prop;
}

// FNV-1a — turns the cache key into the generator seed, so the same surface on the same
// map is byte-identical across reloads and across processes.
export function hashSeed(text) {
    let hash = 0x811c9dc5;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

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

// ---------------------------------------------------------------------------
// Pixel generation — pure, DOM-free, deterministic for a given seed.
// ---------------------------------------------------------------------------

/**
 * @returns {Uint8ClampedArray} RGBA bytes, size*size*4, tileable under RepeatWrapping.
 */
export function paintSurface({ kind = 'grid', size = 128, color = 0xffffff, seed = 0, contrast = 0.1 } = {}) {
    const dim = Math.max(2, Math.floor(size));
    const out = new Uint8ClampedArray(dim * dim * 4);
    const baseR = (color >> 16) & 0xff;
    const baseG = (color >> 8) & 0xff;
    const baseB = color & 0xff;
    const amount = Math.max(0, contrast);
    const random = mulberry32(hashSeed(`${kind}:${dim}:${color}:${seed}`));

    const blocks = Math.max(1, Math.min(BLOCKS_PER_TILE, dim >> 1));
    const cell = dim / blocks;

    // Drawn up front so the result never depends on pixel iteration order.
    const blockJitter = new Float32Array(blocks * blocks);
    for (let i = 0; i < blockJitter.length; i++) blockJitter[i] = (random() - 0.5) * 2;

    // Speck noise is sampled per 2x2 pixel cluster, not per pixel: per-pixel noise on a
    // floor shimmers when the camera moves, which is exactly the kind of busy detail that
    // would compete with the ball.
    const clusters = Math.max(1, Math.ceil(dim / 2));
    const specks = new Float32Array(clusters * clusters);
    for (let i = 0; i < specks.length; i++) specks[i] = (random() - 0.5) * 2;

    const panelBlocks = Math.max(2, Math.min(4, blocks));

    for (let y = 0; y < dim; y++) {
        const by = Math.min(blocks - 1, Math.floor(y / cell));
        const yInCell = y - by * cell;
        for (let x = 0; x < dim; x++) {
            const bx = Math.min(blocks - 1, Math.floor(x / cell));
            const xInCell = x - bx * cell;
            let factor = 0;

            switch (kind) {
                case 'checker': {
                    factor = ((bx + by) % 2 === 0 ? 1 : -1) * 0.7
                        + blockJitter[by * blocks + bx] * 0.3;
                    break;
                }
                case 'plank': {
                    // 2-block-tall planks, each row shifted so seams never line up.
                    const row = Math.floor(by / 2);
                    const shifted = (((bx + row * 3) % blocks) + blocks) % blocks;
                    factor = blockJitter[by * blocks + shifted] * 0.8;
                    const seam = xInCell < 1 || yInCell < 1 && by % 2 === 0;
                    if (seam) factor -= 0.9;
                    break;
                }
                case 'panel': {
                    const px = bx % panelBlocks;
                    const py = by % panelBlocks;
                    factor = blockJitter[by * blocks + bx] * 0.25;
                    // Recessed groove between panels.
                    if (px === 0 && xInCell < 1) factor -= 1;
                    if (py === 0 && yInCell < 1) factor -= 1;
                    // Raised rivet near each panel corner.
                    const mid = cell / 2;
                    if (px === 0 && py === 0
                        && Math.abs(xInCell - mid) < cell * 0.18
                        && Math.abs(yInCell - mid) < cell * 0.18) factor += 1;
                    break;
                }
                case 'grid': {
                    // Lowest-contrast archetype — the default for floors.
                    factor = (xInCell < 1 || yInCell < 1) ? -1 : 0;
                    break;
                }
                case 'stone': {
                    // Offset courses with lighter mortar joints.
                    const course = Math.floor(by / 2);
                    const shifted = (((bx + (course % 2 === 0 ? 0 : 2)) % blocks) + blocks) % blocks;
                    factor = blockJitter[course % blocks * blocks + shifted] * 0.75;
                    if (xInCell < 1 || (yInCell < 1 && by % 2 === 0)) factor += 0.85;
                    break;
                }
                case 'speck':
                default: {
                    const cx = Math.min(clusters - 1, x >> 1);
                    const cy = Math.min(clusters - 1, y >> 1);
                    factor = specks[cy * clusters + cx];
                    break;
                }
            }

            const scale = 1 + factor * amount;
            const idx = (y * dim + x) * 4;
            out[idx] = baseR * scale;
            out[idx + 1] = baseG * scale;
            out[idx + 2] = baseB * scale;
            out[idx + 3] = 255;
        }
    }
    return out;
}

// Rec. 709 relative luminance in 0..1 — used by the ball-readability assertion.
export function luminanceSpread(pixels) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pixels.length; i += 4) {
        const luma = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
        if (luma < min) min = luma;
        if (luma > max) max = luma;
    }
    return max - min;
}

// ---------------------------------------------------------------------------
// Map surface -> archetype resolution
// ---------------------------------------------------------------------------

// Every map resolves; palette stays the map's own, so no map changes identity. Floors are
// restricted to the calm archetypes (grid/speck/checker) for ball readability.
export function resolveMapSurfaces(config = {}) {
    const c = config;
    if (c.isMinecraft) return { floor: 'checker', wall: 'stone', ceiling: 'checker', prop: 'stone' };
    if (c.isDojo) return { floor: 'grid', wall: 'plank', ceiling: 'plank', prop: 'plank' };
    if (c.isColosseum || c.isTemple || c.isPillar) return { floor: 'checker', wall: 'stone', ceiling: 'stone', prop: 'stone' };
    if (c.isVolcano || c.isLava) return { floor: 'speck', wall: 'stone', ceiling: 'stone', prop: 'stone' };
    if (c.isIce || c.isCrystal) return { floor: 'grid', wall: 'checker', ceiling: 'checker', prop: 'checker' };
    if (c.isCloud) return { floor: 'speck', wall: 'speck', ceiling: 'speck', prop: 'speck' };
    if (c.isJungle) return { floor: 'speck', wall: 'plank', ceiling: 'plank', prop: 'plank' };
    if (c.isCanyon) return { floor: 'speck', wall: 'stone', ceiling: 'stone', prop: 'stone' };
    if (c.isAtlantis) return { floor: 'checker', wall: 'stone', ceiling: 'stone', prop: 'stone' };
    if (c.isBeachOpen || c.hasOcean) return { floor: 'speck', wall: 'plank', ceiling: 'plank', prop: 'plank' };
    if (c.isStadium) return { floor: 'checker', wall: 'panel', ceiling: 'panel', prop: 'panel' };
    if (c.isPinball || c.isCyber || c.isNeon || c.isSpace || c.isCosmeticStudio || c.isEsport) {
        return { floor: 'grid', wall: 'panel', ceiling: 'panel', prop: 'panel' };
    }
    if (c.isMecha || c.isVerticalDrop) return { floor: 'grid', wall: 'panel', ceiling: 'panel', prop: 'panel' };
    return { floor: 'grid', wall: 'panel', ceiling: 'panel', prop: 'panel' };
}

// ---------------------------------------------------------------------------
// Cached THREE texture factory
// ---------------------------------------------------------------------------

const cache = new Map();

export function textureCacheKey(kind, options = {}) {
    const {
        color = 0xffffff, surface = 'prop', quality = 'medium',
        repeatX = 1, repeatY = 1, variant = ''
    } = options;
    return `${kind}|${color}|${surface}|${quality}|${repeatX}|${repeatY}|${variant}`;
}

export function textureCacheSize() {
    return cache.size;
}

function buildTexture(kind, options, key) {
    // Same guard as js/social-lobby.js#createProceduralTexture — no DOM, no texture.
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const TextureClass = THREE.CanvasTexture || THREE.Texture;
    if (!TextureClass) return null;

    const { color = 0xffffff, surface = 'prop', quality = 'medium', repeatX = 1, repeatY = 1, anisotropy } = options;
    const size = resolveTextureSize(quality);
    const pixels = paintSurface({
        kind, size, color,
        seed: hashSeed(key),
        contrast: resolveContrast(surface)
    });

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);

    const texture = new TextureClass(canvas);
    // Matches js/social-lobby.js#createProceduralTexture's configuration.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    // Nearest magnification is what makes the blocky read crisp instead of blurry; the
    // mipmapped minification filter keeps distant floor tiles from aliasing into noise.
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter || THREE.NearestFilter;
    if (Number.isFinite(anisotropy)) texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
    return texture;
}

/**
 * Memoized texture lookup. Equal arguments return the same instance so repeated props
 * share one upload (PLAN.md section 9).
 */
export function getTexture(kind, options = {}) {
    const key = textureCacheKey(kind, options);
    const cached = cache.get(key);
    if (cached) return cached;
    const texture = buildTexture(kind, options, key);
    if (!texture) return null;
    cache.set(key, texture);
    return texture;
}

// Called from js/arena.js#clearMap — material.dispose() does not release material.map, so
// without this every map switch leaked its textures.
export function clearTextureCache() {
    let disposed = 0;
    for (const texture of cache.values()) {
        texture.dispose?.();
        disposed++;
    }
    cache.clear();
    return disposed;
}

// Tile count is derived from court size so block scale stays constant across maps of very
// different dimensions (mega_pinball is 960 units wide, esport_arena 67).
export function repeatForSurface(worldWidth, worldDepth, worldUnitsPerTile = 8) {
    const unit = worldUnitsPerTile > 0 ? worldUnitsPerTile : 8;
    return {
        repeatX: Math.max(1, Math.round(Math.abs(worldWidth) / unit)),
        repeatY: Math.max(1, Math.round(Math.abs(worldDepth) / unit))
    };
}
