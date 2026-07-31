// skybox-loader.js — async equirectangular panorama loading for js/arena.js's
// buildSkybox(). Never throws: a missing/broken file resolves to `null` so the
// procedural gradient dome (already built by the time this is called) stays the
// permanent sky instead of the game crashing or freezing on a blank frame.
//
// Pure math (seam crossfade, horizon-color average, fog-tint decision) is kept
// free of THREE/DOM dependencies below `loadSkyboxTexture` so it's directly
// unit-testable, same split as js/arena-decor.js.
import * as THREE from 'three';

// Fraction of the image width blended at the horizontal wrap seam. AI-generated
// equirect panoramas rarely tile perfectly at x=0/x=width, so a visible vertical
// line appears at the wrap point; crossfading the last SEAM_FRACTION of the image
// toward the first hides it. One-time cost at load, zero per-frame cost.
export const SEAM_FRACTION = 0.04;

// Vertical slice (as a fraction of image height) averaged for the horizon color —
// centered on the image's vertical midpoint, which is pitch=0 (the horizon) in an
// equirectangular projection.
export const HORIZON_BAND_FRACTION = 0.1;

// ---------------------------------------------------------------------------
// Pure helpers — no THREE/DOM dependency, unit-testable with plain arrays.
// ---------------------------------------------------------------------------

// Crossfade band width in pixels for an image `width` px wide.
export function crossfadeWidth(width, fraction = SEAM_FRACTION) {
    if (!(width > 0)) return 0;
    return Math.max(0, Math.round(width * fraction));
}

// Linear alpha ramp for column `i` (0-based) within a crossfade band `bandWidth`
// columns wide: 0 at the band's outer edge, 1 at its inner edge (the seam).
export function crossfadeAlpha(i, bandWidth) {
    if (bandWidth <= 1) return 1;
    return Math.min(1, Math.max(0, i / (bandWidth - 1)));
}

// Blends the image's left edge into its right edge in place, so the two edges
// (which sit adjacent to each other once the equirect sphere wraps u=1 back to
// u=0) converge to matching colors instead of showing a hard seam. `data` is a
// flat RGBA buffer (e.g. ImageData.data), `width`/`height` its dimensions.
// Mutates and returns `data`.
export function applySeamCrossfade(data, width, height, fraction = SEAM_FRACTION) {
    const band = crossfadeWidth(width, fraction);
    if (band < 1) return data;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width * 4;
        for (let i = 0; i < band; i++) {
            const alpha = crossfadeAlpha(i, band);
            if (alpha <= 0) continue;
            const destIdx = rowOffset + (width - band + i) * 4;
            const srcIdx = rowOffset + i * 4;
            data[destIdx] = data[destIdx] * (1 - alpha) + data[srcIdx] * alpha;
            data[destIdx + 1] = data[destIdx + 1] * (1 - alpha) + data[srcIdx + 1] * alpha;
            data[destIdx + 2] = data[destIdx + 2] * (1 - alpha) + data[srcIdx + 2] * alpha;
        }
    }
    return data;
}

// Averages RGB over a horizontal band centered on the image's vertical midpoint.
// `data` is a flat RGBA buffer, `bandFraction` the slice height as a fraction of
// `height`. Returns {r,g,b} (0-255 each) or null for a degenerate (zero-area)
// input.
export function averageHorizonColor(data, width, height, bandFraction = HORIZON_BAND_FRACTION) {
    if (!(width > 0) || !(height > 0)) return null;
    const bandPx = Math.max(1, Math.round(height * bandFraction));
    const yStart = Math.max(0, Math.floor((height - bandPx) / 2));
    const yEnd = Math.min(height, yStart + bandPx);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
            const idx = rowOffset + x * 4;
            r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
            n++;
        }
    }
    if (!n) return null;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function hexToRgb(hex) {
    return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

function rgbToHex({ r, g, b }) {
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// Euclidean RGB distance, 0 (identical) to ~441.7 (black vs white).
export function colorDistance(a, b) {
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Nudges `fogColorHex` (numeric 0xRRGGBB) toward `horizonColor` ({r,g,b}) only
// when the two are far enough apart in RGB space that the hand-tuned fog would
// visibly clash with the panorama's own horizon tone. A close match returns
// `fogColorHex` untouched, so maps whose fog already agrees with their panorama
// are never altered. `mix` is the blend weight (0..1) toward horizonColor once a
// clash is detected.
export function resolveFogColor(fogColorHex, horizonColor, { threshold = 90, mix = 0.5 } = {}) {
    if (!horizonColor || !Number.isFinite(fogColorHex)) return fogColorHex;
    const base = hexToRgb(fogColorHex);
    if (colorDistance(base, horizonColor) <= threshold) return fogColorHex;
    return rgbToHex({
        r: base.r + (horizonColor.r - base.r) * mix,
        g: base.g + (horizonColor.g - base.g) * mix,
        b: base.b + (horizonColor.b - base.b) * mix
    });
}

// ---------------------------------------------------------------------------
// THREE-dependent runtime
// ---------------------------------------------------------------------------

// Loads an equirectangular panorama from `url`, seam-fixes it (applySeamCrossfade)
// via an offscreen canvas, and resolves a texture ready for `scene.background`/
// `scene.environment` (mapping + colorSpace already set). Resolves `null` on a
// 404/decode error instead of rejecting — callers keep whatever sky they already
// have, no crash, no unhandled rejection. `texture.userData.horizonColor` carries
// the sampled {r,g,b} average (see averageHorizonColor) for fog-tint decisions,
// or null when the canvas step couldn't run (e.g. 2D context unavailable).
export function loadSkyboxTexture(url) {
    return new Promise(resolve => {
        try {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                rawTexture => resolve(seamFixTexture(rawTexture)),
                undefined,
                () => resolve(null)
            );
        } catch {
            resolve(null); // TextureLoader itself misbehaved — still never rejects.
        }
    });
}

// Draws the decoded image to an offscreen canvas, applies the seam crossfade and
// samples the horizon color, then rebuilds the texture from that canvas. Falls
// back to the raw (un-fixed) texture if canvas manipulation throws (e.g. a
// CORS-tainted image), and to `null` only if even that minimal setup fails.
function seamFixTexture(rawTexture) {
    try {
        const image = rawTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2d context unavailable');
        ctx.drawImage(image, 0, 0);
        const { width, height } = canvas;
        const imageData = ctx.getImageData(0, 0, width, height);
        applySeamCrossfade(imageData.data, width, height);
        ctx.putImageData(imageData, 0, 0);
        const horizonColor = averageHorizonColor(imageData.data, width, height);
        rawTexture.dispose();

        const texture = new THREE.CanvasTexture(canvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData.horizonColor = horizonColor;
        texture.needsUpdate = true;
        return texture;
    } catch {
        try {
            rawTexture.mapping = THREE.EquirectangularReflectionMapping;
            rawTexture.colorSpace = THREE.SRGBColorSpace;
            rawTexture.userData.horizonColor = null;
            return rawTexture;
        } catch {
            return null;
        }
    }
}
