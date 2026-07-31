// skybox-loader.test.mjs — pure seam-crossfade/horizon-average/fog-tint math for
// js/skybox-loader.js, its THREE-driven loadSkyboxTexture() fallback contract
// (exercised against minimal stand-in THREE/document objects, same technique as
// tests/arena-decor.test.mjs uses for its THREE-dependent exports), and the MAPS
// `skybox` field contract in js/arena.js (12 intended maps + beach_open sharing
// beach.jpg, everyone else unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loaderPath = new URL('../js/skybox-loader.js', import.meta.url);
const loaderSource = await readFile(loaderPath, 'utf8');

// --- pure math: no THREE/DOM needed at all ---
const pureModuleSource = loaderSource.replace(/^import \* as THREE from 'three';?[\r\n]*/m, '');
assert.equal(pureModuleSource.includes("from 'three'"), false);

const {
    SEAM_FRACTION,
    crossfadeWidth,
    crossfadeAlpha,
    applySeamCrossfade,
    averageHorizonColor,
    colorDistance,
    resolveFogColor
} = await import(`data:text/javascript;base64,${Buffer.from(pureModuleSource).toString('base64')}`);

// ---------------------------------------------------------------------------
// Crossfade math
// ---------------------------------------------------------------------------

test('crossfadeWidth scales with image width and the configured fraction, clamped at 0', () => {
    assert.equal(crossfadeWidth(2048), Math.round(2048 * SEAM_FRACTION));
    assert.equal(crossfadeWidth(2048, 0.1), 205);
    assert.equal(crossfadeWidth(0), 0);
    assert.equal(crossfadeWidth(-10), 0);
});

test('crossfadeAlpha ramps linearly from 0 at the band start to 1 at the seam', () => {
    const band = 82;
    assert.equal(crossfadeAlpha(0, band), 0);
    assert.equal(crossfadeAlpha(band - 1, band), 1);
    const mid = Math.floor((band - 1) / 2);
    assert.equal(crossfadeAlpha(mid, band), mid / (band - 1));
    // A degenerate (0 or 1 column) band is always fully blended — no ramp to speak of.
    assert.equal(crossfadeAlpha(0, 1), 1);
    assert.equal(crossfadeAlpha(0, 0), 1);
});

test('applySeamCrossfade blends the left edge into the right edge so they converge at the seam', () => {
    const width = 20, height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    // Left half solid red, right half solid blue, full alpha — an extreme seam to make
    // the blend direction and magnitude unambiguous.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const isLeft = x < width / 2;
            data[idx] = isLeft ? 255 : 0;
            data[idx + 2] = isLeft ? 0 : 255;
            data[idx + 3] = 255;
        }
    }
    const before = data.slice();
    applySeamCrossfade(data, width, height, 0.5); // half-width band exaggerates the effect
    const rightEdge = (width - 1) * 4;
    assert.ok(data[rightEdge] > 200, `right-edge red should blend toward the left edge (got ${data[rightEdge]})`);
    assert.ok(data[rightEdge + 2] < 60, `right-edge blue should fade out (got ${data[rightEdge + 2]})`);
    // Untouched interior (well inside the left half, outside any band) keeps its color.
    const farLeft = 2 * 4;
    assert.equal(data[farLeft], before[farLeft]);
    // Alpha channel is never touched by the crossfade.
    assert.equal(data[rightEdge + 3], 255);
});

test('applySeamCrossfade is a no-op for a degenerate fraction/width', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => i % 256);
    const before = data.slice();
    applySeamCrossfade(data, 4, 4, 0);
    assert.deepEqual(data, before);
    applySeamCrossfade(data, 0, 4);
    assert.deepEqual(data, before);
});

// ---------------------------------------------------------------------------
// Horizon average
// ---------------------------------------------------------------------------

test('averageHorizonColor averages only the band centered on the vertical midpoint', () => {
    const width = 4, height = 10;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            data[idx] = data[idx + 1] = data[idx + 2] = y * 10; // distinct color per row
            data[idx + 3] = 255;
        }
    }
    // bandFraction 0.2 over height 10 -> 2-row band centered on the midpoint -> rows 4,5.
    const result = averageHorizonColor(data, width, height, 0.2);
    assert.deepEqual(result, { r: 45, g: 45, b: 45 }); // avg(40, 50) = 45
});

test('averageHorizonColor returns null for degenerate dimensions', () => {
    assert.equal(averageHorizonColor(new Uint8ClampedArray(0), 0, 0), null);
    assert.equal(averageHorizonColor(new Uint8ClampedArray(0), -1, 10), null);
});

// ---------------------------------------------------------------------------
// Fog-tint decision
// ---------------------------------------------------------------------------

test('colorDistance is 0 for identical colors and grows with channel differences', () => {
    assert.equal(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 }), 0);
    assert.equal(colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }), Math.sqrt(3 * 255 * 255));
});

test('resolveFogColor leaves fogColor untouched when it already agrees with the horizon', () => {
    const fog = 0x87CEEB; // dojo's sky-blue fog
    const horizon = { r: 0x87, g: 0xCE, b: 0xEB };
    assert.equal(resolveFogColor(fog, horizon), fog);
});

test('resolveFogColor tints toward the horizon color once the two clash', () => {
    const fog = 0x330000; // volcano's dark red fog
    const horizon = { r: 20, g: 200, b: 220 }; // hypothetical bright cyan panorama horizon
    const tinted = resolveFogColor(fog, horizon, { mix: 0.5 });
    assert.notEqual(tinted, fog);
    assert.equal((tinted >> 16) & 255, Math.round(0x33 + (20 - 0x33) * 0.5));
    assert.equal((tinted >> 8) & 255, Math.round(0 + (200 - 0) * 0.5));
    assert.equal(tinted & 255, Math.round(0 + (220 - 0) * 0.5));
});

test('resolveFogColor is a safe no-op without a horizon color or a non-finite fog value', () => {
    assert.equal(resolveFogColor(0x112233, null), 0x112233);
    assert.equal(resolveFogColor(undefined, { r: 1, g: 2, b: 3 }), undefined);
    assert.equal(Number.isNaN(resolveFogColor(NaN, { r: 1, g: 2, b: 3 })), true);
});

// ---------------------------------------------------------------------------
// loadSkyboxTexture fallback contract — real THREE/canvas swapped for minimal
// stand-ins (never a real WebGL/DOM runtime), same spirit as arena-decor.test.mjs.
// ---------------------------------------------------------------------------

const stubTHREE = {
    TextureLoader: class {
        load(url, onLoad, _onProgress, onError) {
            if (url === 'broken.jpg') { onError(new Error('404')); return; }
            if (url === 'throws.jpg') { throw new Error('loader exploded'); }
            onLoad({ image: { width: 8, height: 4 }, userData: {}, dispose() {} });
        }
    },
    CanvasTexture: class {
        constructor(canvas) { this.canvas = canvas; this.userData = {}; }
        dispose() {}
    },
    EquirectangularReflectionMapping: 303,
    SRGBColorSpace: 'srgb'
};

function makeStubDocument(contextAvailable = true) {
    return {
        createElement(tag) {
            assert.equal(tag, 'canvas');
            return {
                width: 0,
                height: 0,
                getContext(type) {
                    if (type !== '2d' || !contextAvailable) return null;
                    return {
                        drawImage() {},
                        getImageData(_x, _y, w, h) {
                            return { data: new Uint8ClampedArray(w * h * 4).fill(128) };
                        },
                        putImageData() {}
                    };
                }
            };
        }
    };
}

async function importLoaderWithStubs(documentStub) {
    globalThis.__skyboxTestTHREE__ = stubTHREE;
    globalThis.document = documentStub;
    const moduleSource = loaderSource.replace(
        /^import \* as THREE from 'three';?[\r\n]*/m,
        'const THREE = globalThis.__skyboxTestTHREE__;\n'
    );
    return import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
}

test('loadSkyboxTexture resolves a seam-fixed texture with mapping/colorSpace/horizonColor set', async () => {
    const { loadSkyboxTexture } = await importLoaderWithStubs(makeStubDocument(true));
    const texture = await loadSkyboxTexture('ok.jpg');
    assert.ok(texture, 'texture resolved');
    assert.equal(texture.mapping, stubTHREE.EquirectangularReflectionMapping);
    assert.equal(texture.colorSpace, stubTHREE.SRGBColorSpace);
    assert.deepEqual(texture.userData.horizonColor, { r: 128, g: 128, b: 128 });
    assert.equal(texture.needsUpdate, true);
});

test('loadSkyboxTexture resolves null (never rejects) on a 404/decode error', async () => {
    const { loadSkyboxTexture } = await importLoaderWithStubs(makeStubDocument(true));
    const texture = await loadSkyboxTexture('broken.jpg');
    assert.equal(texture, null);
});

test('loadSkyboxTexture resolves null (never rejects) even if the underlying loader throws synchronously', async () => {
    const { loadSkyboxTexture } = await importLoaderWithStubs(makeStubDocument(true));
    const texture = await loadSkyboxTexture('throws.jpg');
    assert.equal(texture, null);
});

test('loadSkyboxTexture falls back to the raw texture (mapping set, horizonColor null) when canvas 2D is unavailable', async () => {
    const { loadSkyboxTexture } = await importLoaderWithStubs(makeStubDocument(false));
    const texture = await loadSkyboxTexture('ok.jpg');
    assert.ok(texture, 'raw texture still resolved, not null');
    assert.equal(texture.mapping, stubTHREE.EquirectangularReflectionMapping);
    assert.equal(texture.colorSpace, stubTHREE.SRGBColorSpace);
    assert.equal(texture.userData.horizonColor, null);
});

// ---------------------------------------------------------------------------
// MAPS `skybox` field contract (js/arena.js)
// ---------------------------------------------------------------------------

const arenaPath = new URL('../js/arena.js', import.meta.url);
const arenaSource = await readFile(arenaPath, 'utf8');
const arenaModuleSource = arenaSource
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, '')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');

const { MAPS } = await import(`data:text/javascript;base64,${Buffer.from(arenaModuleSource).toString('base64')}`);

// PRODUCT DECISION (2026-07-30): the AI panorama skyboxes were reverted after
// playtesting — the user judged the procedural gradient dome better in-game.
// The loader stays in the tree (pure math + fallback contract above remain
// covered) but NO map may opt in until a future decision reverses this.
test('no MAPS entry declares a skybox field (panorama revert is locked in)', () => {
    for (const [id, config] of Object.entries(MAPS)) {
        assert.equal(config.skybox, undefined, `${id} must not declare skybox`);
    }
});
