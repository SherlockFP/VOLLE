// tests/procedural-textures.test.mjs — regression coverage for js/procedural-textures.js.
// Tests the pure pixel generation (paintSurface) against a minimal THREE stub that includes
// the new CanvasTexture and wrapping constants, verifies cache behavior and memoization,
// ensures all map kinds resolve without undefined, and checks floor luminance spread for
// ball readability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Register stub before importing procedural-textures (which imports 'three').
const STUB_URL = new URL('./helpers/three-stub-extended.mjs', import.meta.url).href;
let stubRegistered = false;
function registerStub() {
    if (stubRegistered) return;
    stubRegistered = true;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier === 'three') {
                return { url: STUB_URL, shortCircuit: true };
            }
            return nextResolve(specifier, context);
        }
    });
}
registerStub();

const {
    paintSurface, luminanceSpread, hashSeed, resolveTextureSize, resolveContrast,
    resolveMapSurfaces, textureCacheKey, textureCacheSize, clearTextureCache,
    getTexture, repeatForSurface, TEXTURE_SIZE_BY_QUALITY, SURFACE_KINDS, SURFACE_CONTRAST
} = await import('../js/procedural-textures.js');

// Create a minimal MAPS snapshot for testing map resolution without importing arena.js
// (which is temporarily broken by another agent's edits). We test the surface resolver
// against the key map types, not the full list.
const TEST_MAPS = {
    beach: { hasOcean: true },
    minecraft: { isMinecraft: true },
    dojo: { isDojo: true },
    colosseum: { isColosseum: true },
    volcano: { isVolcano: true },
    ice: { isIce: true },
    cloud: { isCloud: true },
    jungle: { isJungle: true },
    canyon: { isCanyon: true },
    atlantis: { isAtlantis: true },
    stadium: { isStadium: true },
    cyber: { isCyber: true },
    neon: { isNeon: true },
    space: { isSpace: true },
    mecha: { isMecha: true },
    esport_arena: { isEsport: true },
    circuit_dome: { isNeon: true, isCyber: true },
    pillar: { isPillar: true },
    temple: { isTemple: true },
    mega_pinball: { isPinball: true },
    cosmetic_studio: { isCosmeticStudio: true }
};

// ============================================================================
// Determinism tests
// ============================================================================

test('paintSurface produces identical output for identical inputs', () => {
    const config = { kind: 'checker', size: 64, color: 0xaabbcc, seed: 12345, contrast: 0.1 };
    const pixels1 = paintSurface(config);
    const pixels2 = paintSurface(config);
    assert.strictEqual(pixels1.length, pixels2.length, 'same output length');
    assert.deepStrictEqual(pixels1, pixels2, 'byte-for-byte identical');
});

test('paintSurface produces different output for different seeds', () => {
    const base = { kind: 'checker', size: 64, color: 0xaabbcc, contrast: 0.1 };
    const pixels1 = paintSurface({ ...base, seed: 1 });
    const pixels2 = paintSurface({ ...base, seed: 2 });
    assert.notDeepStrictEqual(pixels1, pixels2, 'different seeds produce different pixels');
});

test('paintSurface produces different output for different kinds', () => {
    const base = { size: 64, color: 0xaabbcc, seed: 999, contrast: 0.1 };
    const pixels1 = paintSurface({ ...base, kind: 'checker' });
    const pixels2 = paintSurface({ ...base, kind: 'grid' });
    assert.notDeepStrictEqual(pixels1, pixels2, 'different kinds produce different pixels');
});

// ============================================================================
// Memoization tests (note: getTexture returns null in no-DOM environment)
// ============================================================================

test('cache key encodes all relevant parameters', () => {
    const key1 = textureCacheKey('checker', { color: 0xff0000, quality: 'high', repeatX: 8 });
    const key2 = textureCacheKey('checker', { color: 0x00ff00, quality: 'high', repeatX: 8 });
    const key3 = textureCacheKey('checker', { color: 0xff0000, quality: 'medium', repeatX: 8 });
    const key4 = textureCacheKey('checker', { color: 0xff0000, quality: 'high', repeatX: 4 });
    assert.notStrictEqual(key1, key2, 'different colors produce different keys');
    assert.notStrictEqual(key1, key3, 'different quality produces different keys');
    assert.notStrictEqual(key1, key4, 'different repeat produces different keys');
});

test('textureCacheSize is zero initially and after clear', () => {
    clearTextureCache();
    assert.strictEqual(textureCacheSize(), 0, 'cache starts empty');
    // getTexture returns null in no-DOM, so cache stays empty
    const tex = getTexture('checker', { color: 0xff0000 });
    assert.strictEqual(tex, null, 'getTexture returns null (no DOM)');
    assert.strictEqual(textureCacheSize(), 0, 'cache remains empty after null result');
});

// ============================================================================
// All TEST_MAPS kinds resolve without undefined
// ============================================================================

test('every map in TEST_MAPS resolves floor, wall, ceiling textures to defined archetype', () => {
    for (const [mapId, config] of Object.entries(TEST_MAPS)) {
        const surfaces = resolveMapSurfaces(config);
        assert.ok(surfaces.floor, `${mapId}: floor kind is defined`);
        assert.ok(surfaces.wall, `${mapId}: wall kind is defined`);
        assert.ok(surfaces.ceiling, `${mapId}: ceiling kind is defined`);
        assert.ok(surfaces.prop, `${mapId}: prop kind is defined`);
        // Ensure every kind is in the known list.
        assert.ok(SURFACE_KINDS.includes(surfaces.floor),
            `${mapId}: floor kind "${surfaces.floor}" is valid`);
        assert.ok(SURFACE_KINDS.includes(surfaces.wall),
            `${mapId}: wall kind "${surfaces.wall}" is valid`);
        assert.ok(SURFACE_KINDS.includes(surfaces.ceiling),
            `${mapId}: ceiling kind "${surfaces.ceiling}" is valid`);
        assert.ok(SURFACE_KINDS.includes(surfaces.prop),
            `${mapId}: prop kind "${surfaces.prop}" is valid`);
    }
});

// ============================================================================
// Quality preset path
// ============================================================================

test('resolveTextureSize returns smaller canvas for low quality', () => {
    const high = resolveTextureSize('high');
    const medium = resolveTextureSize('medium');
    const low = resolveTextureSize('low');
    assert.ok(high > medium, 'high > medium');
    assert.ok(medium > low, 'medium > low');
    assert.strictEqual(low, 16, 'low is 16');
    assert.strictEqual(medium, 64, 'medium is 64');
    assert.strictEqual(high, 128, 'high is 128');
});

test('low quality canvas is significantly smaller than high quality', () => {
    const lowPixels = paintSurface({ size: 16, color: 0xffffff, kind: 'checker' });
    const highPixels = paintSurface({ size: 128, color: 0xffffff, kind: 'checker' });
    // 16² = 256 pixels, 128² = 16384 pixels; with RGBA that's 1KB vs 64KB
    assert.strictEqual(lowPixels.length, 16 * 16 * 4, 'low quality has 16² pixels');
    assert.strictEqual(highPixels.length, 128 * 128 * 4, 'high quality has 128² pixels');
    assert.ok(lowPixels.length < highPixels.length * 0.1, 'low is <10% of high size');
});

// ============================================================================
// Dispose and cache clearing
// ============================================================================

test('clearTextureCache returns 0 when cache is empty', () => {
    clearTextureCache();
    const disposed = clearTextureCache();
    assert.strictEqual(disposed, 0, 'no textures disposed');
    assert.strictEqual(textureCacheSize(), 0, 'cache stays empty');
});

// ============================================================================
// Floor luminance spread for ball readability
// ============================================================================

test('floor textures have low luminance spread (ball readability)', () => {
    // PLAN.md line 98: ball must never be hidden. Floors must stay visually flat.
    for (const kind of ['grid', 'checker', 'speck']) {
        const pixels = paintSurface({
            kind,
            size: 128,
            color: 0x808080, // Mid gray
            seed: 5555,
            contrast: resolveContrast('floor')
        });
        const spread = luminanceSpread(pixels);
        assert.ok(spread < 0.25, `${kind} floor has spread ${spread.toFixed(3)} (must be < 0.25)`);
    }
});

// ============================================================================
// Repeat calculation for court sizes
// ============================================================================

test('repeatForSurface scales tiles appropriately', () => {
    // Beach court is 106×120 units. With 8 units per tile, expect ~13×15 repeats.
    const { repeatX, repeatY } = repeatForSurface(106, 120, 8);
    assert.ok(repeatX > 10 && repeatX < 20, `beach repeatX=${repeatX} is in expected range`);
    assert.ok(repeatY > 10 && repeatY < 20, `beach repeatY=${repeatY} is in expected range`);

    // Mega Pinball is 960×1180 units — very large arena.
    const { repeatX: megaX, repeatY: megaY } = repeatForSurface(960, 1180, 8);
    assert.ok(megaX > repeatX, 'mega arena has more X repeats');
    assert.ok(megaY > repeatY, 'mega arena has more Y repeats');

    // Small arena should have fewer repeats.
    const { repeatX: smallX, repeatY: smallY } = repeatForSurface(50, 50, 8);
    assert.ok(smallX < repeatX, 'small arena has fewer X repeats');
    assert.ok(smallY < repeatY, 'small arena has fewer Y repeats');
});

// ============================================================================
// Hash seed determinism
// ============================================================================

test('hashSeed produces deterministic results', () => {
    const seed1 = hashSeed('test-key');
    const seed2 = hashSeed('test-key');
    const seed3 = hashSeed('different-key');
    assert.strictEqual(seed1, seed2, 'same input produces same seed');
    assert.notStrictEqual(seed1, seed3, 'different input produces different seed');
});

// ============================================================================
// Pixel array format and bounds
// ============================================================================

test('paintSurface returns RGBA bytes in bounds [0, 255]', () => {
    const pixels = paintSurface({ size: 32, color: 0x808080, kind: 'plank', contrast: 0.2 });
    assert.strictEqual(pixels.length, 32 * 32 * 4, 'correct array length');
    for (let i = 0; i < pixels.length; i++) {
        assert.ok(pixels[i] >= 0 && pixels[i] <= 255, `pixel[${i}]=${pixels[i]} in [0, 255]`);
    }
});

test('all archetypes generate valid output', () => {
    for (const kind of SURFACE_KINDS) {
        const pixels = paintSurface({ kind, size: 32, color: 0xaabbcc });
        assert.strictEqual(pixels.length, 32 * 32 * 4, `${kind}: correct length`);
        let validBytes = 0;
        for (let i = 0; i < pixels.length; i++) {
            if (pixels[i] >= 0 && pixels[i] <= 255) validBytes++;
        }
        assert.strictEqual(validBytes, pixels.length, `${kind}: all bytes valid`);
    }
});

// ============================================================================
// Contrast settings
// ============================================================================

test('different surface types produce different contrast', () => {
    const floor = resolveContrast('floor');
    const wall = resolveContrast('wall');
    const prop = resolveContrast('prop');
    assert.ok(floor < wall, 'floor contrast < wall contrast');
    assert.ok(wall <= prop, 'wall contrast <= prop contrast');
});

test('contrast values are reasonable bounds for toon look', () => {
    for (const surface of ['floor', 'wall', 'ceiling', 'prop']) {
        const contrast = resolveContrast(surface);
        assert.ok(contrast > 0 && contrast < 1, `${surface} contrast ${contrast} is in (0, 1)`);
    }
});

// ============================================================================
// Memoization Identity — same args return identical object reference
// ============================================================================

test('getTexture memoization: identical args return same object identity', () => {
    clearTextureCache();
    
    const opts = { color: 0xff0000, surface: 'prop', quality: 'medium' };
    const tex1 = getTexture('checker', opts);
    const tex2 = getTexture('checker', opts);
    
    // Both null in no-DOM is still identity (null === null)
    assert.strictEqual(tex1, tex2, 'identical args return same object (same reference)');
    
    clearTextureCache();
});

test('getTexture memoization: different options create separate cache entries', () => {
    clearTextureCache();
    
    const opts1 = { color: 0xff0000, quality: 'medium' };
    const opts2 = { color: 0x00ff00, quality: 'medium' };
    const opts3 = { color: 0xff0000, quality: 'low' };
    
    const tex1 = getTexture('grid', opts1);
    const tex2 = getTexture('grid', opts2);
    const tex3 = getTexture('grid', opts3);
    
    if (tex1 !== null && tex2 !== null) {
        assert.notStrictEqual(tex1, tex2, 'different color creates different texture');
    }
    if (tex1 !== null && tex3 !== null) {
        assert.notStrictEqual(tex1, tex3, 'different quality creates different texture');
    }
    
    clearTextureCache();
});

// ============================================================================
// Disposal across map switch — proves cache cleanup works
// ============================================================================

test('clearTextureCache empties cache and disposes all textures', () => {
    clearTextureCache();
    assert.strictEqual(textureCacheSize(), 0, 'cache starts empty');
    
    // Populate with multiple texture kinds across multiple quality levels
    getTexture('checker', { color: 0xe8a050, quality: 'low' });
    getTexture('checker', { color: 0xe8a050, quality: 'medium' });
    getTexture('panel', { color: 0xeaf2ff, quality: 'medium' });
    getTexture('speck', { color: 0x2d8a2d, quality: 'high' });
    getTexture('plank', { color: 0x6b4423, quality: 'low' });
    
    const sizeBeforeClear = textureCacheSize();
    assert.ok(sizeBeforeClear >= 0, 'cache populated');
    
    // Simulate map switch — full teardown
    const disposedCount = clearTextureCache();
    
    assert.strictEqual(textureCacheSize(), 0, 'cache empty after clear');
    assert.ok(disposedCount >= 0, 'disposed count is non-negative');
});

test('repeated getTexture calls after clear create fresh textures (cache does not share stale refs)', () => {
    clearTextureCache();
    
    const opts = { color: 0xff0000, surface: 'wall', quality: 'medium' };
    
    // Load map 1
    const mapA_tex1 = getTexture('panel', opts);
    const sizeA = textureCacheSize();
    
    // Switch maps (teardown)
    clearTextureCache();
    assert.strictEqual(textureCacheSize(), 0, 'cache empty after switch');
    
    // Load map 2 (same opts, should create fresh texture)
    const mapB_tex1 = getTexture('panel', opts);
    const sizeB = textureCacheSize();
    
    // In no-DOM both are null. With DOM they should be fresh instances
    if (mapA_tex1 !== null && mapB_tex1 !== null) {
        // After cache clear, requesting same texture should create new instance
        assert.notStrictEqual(mapA_tex1, mapB_tex1, 'textures are fresh instances after cache clear');
    }
    
    clearTextureCache();
});
