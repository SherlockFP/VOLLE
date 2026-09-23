// tests/ball-skin-fx.test.mjs — coverage for js/ball-skin-fx.js (the per-skin surface
// detail / trail tuning / pooled impact FX module js/ball.js imports) plus a couple of
// regression guards on js/ball.js itself: model skins must stay a pure re-skin (radius/
// visualRadius untouched) even after this pass added new per-skin rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

// Redirect the bare 'three' specifier to a small standalone stub tailored to exactly
// what js/ball-skin-fx.js touches (see tests/helpers/three-stub-ball-fx.mjs for why this
// is its own file instead of reusing the shared character-rig stub).
const STUB_URL = new URL('./helpers/three-stub-ball-fx.mjs', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: STUB_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});

const {
    SKIN_PATTERN_KINDS, skinPatternKind, repeatForPatternKind, paintBallSkinPattern,
    rimPowerForSkin, RARITY_TRAIL_SCALE, trailIntensityMultiplier,
    ballSkinTextureCacheKey, ballSkinTextureCacheSize, getBallSkinTexture, clearBallSkinTextureCache,
    BallImpactFX, IMPACT_FX_MAX_ACTIVE
} = await import('../js/ball-skin-fx.js');

// ============================================================================
// Pure pixel painter — deterministic, DOM-free (mirrors js/procedural-textures.js's
// paintSurface contract, see that file's test suite for the same shape of coverage).
// ============================================================================

test('paintBallSkinPattern is deterministic for identical inputs', () => {
    const config = { kind: 'vein', size: 32, seed: 42, legendary: false };
    const a = paintBallSkinPattern(config);
    const b = paintBallSkinPattern(config);
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.length, 32 * 32 * 4);
});

test('paintBallSkinPattern differs across seeds and kinds', () => {
    const base = { size: 24, seed: 1, legendary: false };
    const seed1 = paintBallSkinPattern({ ...base, kind: 'hex' });
    const seed2 = paintBallSkinPattern({ ...base, kind: 'hex', seed: 2 });
    assert.notDeepStrictEqual(seed1, seed2);

    const otherKind = paintBallSkinPattern({ ...base, kind: 'facet' });
    assert.notDeepStrictEqual(seed1, otherKind);
});

test('every declared pattern kind renders without throwing and stays in RGBA byte range', () => {
    for (const kind of SKIN_PATTERN_KINDS) {
        const pixels = paintBallSkinPattern({ kind, size: 16, seed: 7, legendary: kind === 'hex' });
        assert.strictEqual(pixels.length, 16 * 16 * 4);
        for (let i = 0; i < pixels.length; i++) assert.ok(pixels[i] >= 0 && pixels[i] <= 255);
    }
});

test('legendary variant is brighter on average than the non-legendary pattern (visible rarity read)', () => {
    const kind = 'vein';
    const normal = paintBallSkinPattern({ kind, size: 32, seed: 5, legendary: false });
    const legendary = paintBallSkinPattern({ kind, size: 32, seed: 5, legendary: true });
    let normalSum = 0;
    let legendarySum = 0;
    for (let i = 0; i < normal.length; i += 4) { normalSum += normal[i]; legendarySum += legendary[i]; }
    assert.ok(legendarySum > normalSum, 'legendary pattern should read brighter on average');
});

test('the "plain" archetype (classic/simple skins) stays near-neutral, unlike the detailed kinds', () => {
    // The toon shader multiplies uColor * texture.rgb, so this baseline controls how much
    // a skin's color darkens purely from having a texture at all.
    const plain = paintBallSkinPattern({ kind: 'plain', size: 16, seed: 3 });
    const vein = paintBallSkinPattern({ kind: 'vein', size: 16, seed: 3 });
    const avg = pixels => {
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
        return sum / (pixels.length / 4);
    };
    assert.ok(avg(plain) > avg(vein), 'plain should be brighter (less darkened) than a detailed archetype');
    assert.ok(avg(plain) > 220, 'plain stays close to full brightness');
});

// ============================================================================
// Archetype selection
// ============================================================================

test('skinPatternKind maps every existing BALL_SKINS effect family to a declared kind', () => {
    const effectMap = {
        flame: 'vein', frost: 'facet', spark: 'circuit', void: 'hex',
        glitch: 'glitch', toxic: 'drip', candy: 'stripe', prism: 'facet', pixel: 'panel'
    };
    for (const [effect, expectedKind] of Object.entries(effectMap)) {
        const kind = skinPatternKind(effect, 'sphere');
        assert.equal(kind, expectedKind, `effect "${effect}" should map to "${expectedKind}"`);
        assert.ok(SKIN_PATTERN_KINDS.includes(kind));
    }
});

test('an unknown/missing effect falls back to "plain" so future skins never break', () => {
    assert.equal(skinPatternKind(undefined, 'sphere'), 'plain');
    assert.equal(skinPatternKind('totally-new-effect', 'sphere'), 'plain');
});

test('a non-sphere shape always reads as paneled hardware regardless of effect', () => {
    assert.equal(skinPatternKind('flame', 'cube'), 'panel');
    assert.equal(skinPatternKind('void', 'shuriken'), 'panel');
    assert.equal(skinPatternKind(undefined, 'orb'), 'panel');
});

test('repeatForPatternKind returns a positive [x,y] tile count for every declared kind', () => {
    for (const kind of SKIN_PATTERN_KINDS) {
        const [rx, ry] = repeatForPatternKind(kind);
        assert.ok(Number.isFinite(rx) && rx >= 1);
        assert.ok(Number.isFinite(ry) && ry >= 1);
    }
});

// ============================================================================
// Rim power ("roughness/metalness" stand-in on the toon shader's existing uniform)
// ============================================================================

test('rimPowerForSkin returns a finite positive value for every shape/effect combination', () => {
    const shapes = [undefined, 'sphere', 'cube', 'shuriken', 'baseball', 'orb'];
    const effects = [undefined, 'flame', 'frost', 'spark', 'glitch', 'toxic', 'candy', 'void', 'prism', 'pixel'];
    for (const shape of shapes) {
        for (const effect of effects) {
            const power = rimPowerForSkin({ shape, effect });
            assert.ok(Number.isFinite(power) && power > 0, `shape=${shape} effect=${effect}`);
        }
    }
});

test('model-skin hardware and metallic effects read shinier (higher rim power) than soft/organic ones', () => {
    const hardware = rimPowerForSkin({ shape: 'cube', effect: 'glitch' });
    const soft = rimPowerForSkin({ shape: 'sphere', effect: 'toxic' });
    assert.ok(hardware > soft);
});

// ============================================================================
// Trail intensity
// ============================================================================

test('RARITY_TRAIL_SCALE is monotonically increasing common -> rare -> epic -> legendary', () => {
    assert.ok(RARITY_TRAIL_SCALE.common < RARITY_TRAIL_SCALE.rare);
    assert.ok(RARITY_TRAIL_SCALE.rare < RARITY_TRAIL_SCALE.epic);
    assert.ok(RARITY_TRAIL_SCALE.epic < RARITY_TRAIL_SCALE.legendary);
});

test('trailIntensityMultiplier falls back to common for an unknown rarity and stacks overdrive on top', () => {
    assert.equal(trailIntensityMultiplier(undefined, false), RARITY_TRAIL_SCALE.common);
    assert.equal(trailIntensityMultiplier('made-up-rarity', false), RARITY_TRAIL_SCALE.common);
    const legendaryNormal = trailIntensityMultiplier('legendary', false);
    const legendaryOverdrive = trailIntensityMultiplier('legendary', true);
    assert.ok(legendaryOverdrive > legendaryNormal, 'overdrive must intensify the trail further');
});

// ============================================================================
// Cached CanvasTexture factory — DOM-guarded, bounded LRU (mirrors
// tests/procedural-textures.test.mjs's memoization coverage).
// ============================================================================

test('ballSkinTextureCacheKey encodes skin id and quality separately', () => {
    const a = ballSkinTextureCacheKey('fire', 'high');
    const b = ballSkinTextureCacheKey('fire', 'medium');
    const c = ballSkinTextureCacheKey('ice', 'high');
    assert.notEqual(a, b);
    assert.notEqual(a, c);
});

test('getBallSkinTexture returns null with no DOM, without populating the cache', () => {
    clearBallSkinTextureCache();
    const tex = getBallSkinTexture('fire', { effect: 'flame', rarity: 'rare', color: 0xff0000 }, 'medium');
    assert.strictEqual(tex, null, 'no document global in node --test');
    assert.strictEqual(ballSkinTextureCacheSize(), 0);
});

test('getBallSkinTexture always returns null for the free classic skin (no effect/custom shape)', () => {
    clearBallSkinTextureCache();
    assert.strictEqual(getBallSkinTexture('classic', { color: 0xff8844 }, 'high'), null);
});

test('getBallSkinTexture returns null on low quality even with a full stub document', () => {
    const previousDocument = globalThis.document;
    globalThis.document = makeStubDocument();
    try {
        clearBallSkinTextureCache();
        const tex = getBallSkinTexture('fire', { effect: 'flame', rarity: 'rare' }, 'low');
        assert.strictEqual(tex, null);
    } finally {
        globalThis.document = previousDocument;
    }
});

function makeStubDocument() {
    return {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            return {
                width: 0,
                height: 0,
                getContext(type) {
                    if (type !== '2d') return null;
                    return {
                        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
                        putImageData() {}
                    };
                }
            };
        }
    };
}

test('getBallSkinTexture builds once per (skin, quality), reuses the cached instance, and disposes on eviction', () => {
    const previousDocument = globalThis.document;
    globalThis.document = makeStubDocument();
    try {
        clearBallSkinTextureCache();
        const skin = { effect: 'flame', rarity: 'legendary', color: 0xff5500 };
        const first = getBallSkinTexture('phoenix', skin, 'high');
        const second = getBallSkinTexture('phoenix', skin, 'high');
        assert.ok(first, 'a texture is built when document exists');
        assert.strictEqual(first, second, 'same skin+quality reuses the cached texture, no rebuild');
        assert.strictEqual(ballSkinTextureCacheSize(), 1);

        // Fill the cache well past its bound with distinct skin ids to force LRU eviction.
        for (let i = 0; i < 40; i++) {
            getBallSkinTexture(`skin_${i}`, { effect: 'spark', rarity: 'rare' }, 'high');
        }
        assert.ok(ballSkinTextureCacheSize() <= 28, 'cache stays bounded (LRU eviction)');
        assert.ok(first.disposeCalls >= 1, 'the evicted original texture was disposed, not leaked');
    } finally {
        globalThis.document = previousDocument;
        clearBallSkinTextureCache();
    }
});

test('clearBallSkinTextureCache disposes every cached texture and reports the count', () => {
    const previousDocument = globalThis.document;
    globalThis.document = makeStubDocument();
    try {
        clearBallSkinTextureCache();
        getBallSkinTexture('a', { effect: 'frost' }, 'medium');
        getBallSkinTexture('b', { effect: 'void' }, 'medium');
        assert.equal(ballSkinTextureCacheSize(), 2);
        const disposed = clearBallSkinTextureCache();
        assert.equal(disposed, 2);
        assert.equal(ballSkinTextureCacheSize(), 0);
        assert.equal(clearBallSkinTextureCache(), 0, 'clearing an empty cache disposes nothing');
    } finally {
        globalThis.document = previousDocument;
    }
});

// ============================================================================
// Pooled impact burst — bounded, zero per-frame allocation.
// ============================================================================

function fakeScene() {
    const objects = [];
    return { objects, add(o) { objects.push(o); }, remove(o) { const i = objects.indexOf(o); if (i !== -1) objects.splice(i, 1); } };
}

test('BallImpactFX.spawn adds particles to the scene and update() ages/releases them', () => {
    const scene = fakeScene();
    const fx = new BallImpactFX(scene);
    assert.equal(fx.activeCount, 0);

    fx.spawn({ x: 1, y: 2, z: 3 }, 0xff0000, { intensity: 1 });
    assert.ok(fx.activeCount > 1, 'a burst spawns a ring plus multiple sparks');
    const spawnedCount = fx.activeCount;
    assert.equal(scene.objects.length, spawnedCount);

    // Advance past every particle's lifetime in a few steps.
    for (let i = 0; i < 20; i++) fx.update(1 / 30);
    assert.equal(fx.activeCount, 0, 'every particle eventually dies and is released');
    assert.equal(scene.objects.length, 0, 'dead particles are removed from the scene');
});

test('BallImpactFX never grows the active particle list past IMPACT_FX_MAX_ACTIVE, even without update() calls', () => {
    const scene = fakeScene();
    const fx = new BallImpactFX(scene, IMPACT_FX_MAX_ACTIVE);
    for (let i = 0; i < 50; i++) {
        fx.spawn({ x: i, y: 0, z: 0 }, 0x00ff00, { intensity: 1.8 });
    }
    assert.ok(fx.activeCount <= IMPACT_FX_MAX_ACTIVE, `active=${fx.activeCount} must stay <= ${IMPACT_FX_MAX_ACTIVE}`);
});

test('BallImpactFX reuses pooled meshes instead of allocating a new one per burst', () => {
    const scene = fakeScene();
    const fx = new BallImpactFX(scene, 40);
    fx.spawn({ x: 0, y: 0, z: 0 }, 0xffffff, { intensity: 1 });
    const firstBurstMeshes = new Set(scene.objects);
    for (let i = 0; i < 60; i++) fx.update(1 / 20); // let everything die and return to the pool

    fx.spawn({ x: 0, y: 0, z: 0 }, 0xffffff, { intensity: 1 });
    const secondBurstMeshes = new Set(scene.objects);
    let reused = 0;
    for (const mesh of secondBurstMeshes) if (firstBurstMeshes.has(mesh)) reused++;
    assert.ok(reused > 0, 'expected at least one mesh instance to be reused from the pool');
});

test('BallImpactFX.clear() releases every active particle immediately', () => {
    const scene = fakeScene();
    const fx = new BallImpactFX(scene);
    fx.spawn({ x: 0, y: 0, z: 0 }, 0x123456, { intensity: 1 });
    assert.ok(fx.activeCount > 0);
    fx.clear();
    assert.equal(fx.activeCount, 0);
    assert.equal(scene.objects.length, 0);
});

test('spawn() is a safe no-op with no position or no scene (defensive against isolated unit tests)', () => {
    const fx = new BallImpactFX(null);
    assert.doesNotThrow(() => fx.spawn({ x: 0, y: 0, z: 0 }, 0xffffff));
    assert.equal(fx.activeCount, 0);
    const fx2 = new BallImpactFX(fakeScene());
    assert.doesNotThrow(() => fx2.spawn(null, 0xffffff));
    assert.equal(fx2.activeCount, 0);
});

// ============================================================================
// Regression guards on js/ball.js itself — model skins must stay a pure re-skin even
// after wiring in per-skin materials/trail/impact FX (tests/viewmodel-cosmetics.test.mjs
// covers the same contract from the catalog side; this re-checks it from the source
// text so a future edit to ball.js's skin-material wiring cannot quietly reintroduce a
// physics field).
// ============================================================================

test('ball.js still declares exactly one ball collision radius/visualRadius constant', async () => {
    const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
    const radiusLines = source.match(/this\.radius = [\d.]+;/g) || [];
    assert.deepEqual(radiusLines, ['this.radius = 0.47;']);
    assert.match(source, /this\.visualRadius = 0\.43;/);
});

test('ball.js\'s new skin-material/impact-FX wiring never assigns to this.radius, this.velocity, or this.hitRange', async () => {
    const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
    const methodNames = ['_applySkinMaterial', '_updateLegendaryRim', '_triggerImpactFX'];
    for (const name of methodNames) {
        const start = source.indexOf(`    ${name}(`);
        assert.ok(start !== -1, `${name} should exist in js/ball.js`);
        const end = source.indexOf('\n    }', start);
        const body = source.slice(start, end);
        assert.doesNotMatch(body, /this\.radius\s*=/, `${name} must not touch this.radius`);
        assert.doesNotMatch(body, /this\.velocity\s*=/, `${name} must not touch this.velocity`);
        assert.doesNotMatch(body, /this\.hitRange\s*=/, `${name} must not touch this.hitRange`);
    }
});
