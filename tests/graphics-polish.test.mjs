// tests/graphics-polish.test.mjs — coverage for the V4 renderer graphics-polish pass:
// filmic tone mapping (js/renderer.js constructor) + the setBloomProfile() per-map
// bloom override hook (threshold/radius/strength) and its quality-gated strength.
//
// js/renderer.js can't be imported directly under Node (it pulls in 'three/addons/...'
// which only resolves through index.html's browser importmap) — same constraint
// tests/target-outline.test.mjs and tests/settings-options.test.mjs document. So this
// slices the relevant literals/method bodies straight out of the source text and
// evaluates them standalone via `new Function`, exactly like those two files do for
// createTargetOutline and QUALITY_PRESETS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rendererSource = fs.readFileSync(new URL('../js/renderer.js', import.meta.url), 'utf8');
const toonFragSource = fs.readFileSync(new URL('../js/shaders/toon.frag.js', import.meta.url), 'utf8');

// --- helpers ------------------------------------------------------------------

function extractObjectLiteral(startMarker) {
    const start = rendererSource.indexOf(startMarker);
    assert.ok(start !== -1, `${startMarker} not found in js/renderer.js`);
    const open = rendererSource.indexOf('{', start);
    const close = rendererSource.indexOf('};', open);
    assert.ok(close !== -1, `${startMarker} object literal is not terminated with "};"`);
    const literal = rendererSource.slice(open, close + 1);
    // eslint-disable-next-line no-new-func
    return new Function(`return ${literal}`)();
}

// startMarker must be the full method signature line, ending in "{" — everything
// after it up to (not including) endMarker's own "}" is the method body.
function extractMethodBody(startMarker, endMarker) {
    const startIndex = rendererSource.indexOf(startMarker);
    assert.ok(startIndex !== -1, `${startMarker} not found in js/renderer.js`);
    const bodyStart = startIndex + startMarker.length;
    const endIndex = rendererSource.indexOf(endMarker, startIndex);
    assert.ok(endIndex !== -1 && endIndex > startIndex, `${endMarker} not found after ${startMarker}`);
    const chunk = rendererSource.slice(bodyStart, endIndex);
    return chunk.slice(0, chunk.lastIndexOf('}'));
}

// --- tone mapping ---------------------------------------------------------------

test('constructor sets a filmic/neutral tone mapping mode on the WebGLRenderer (not the NoToneMapping default)', () => {
    const match = rendererSource.match(/this\.renderer\.toneMapping\s*=\s*THREE\.(ACESFilmicToneMapping|NeutralToneMapping);/);
    assert.ok(match, 'expected this.renderer.toneMapping = THREE.ACESFilmicToneMapping or THREE.NeutralToneMapping in the constructor');
});

test('toneMappingExposure is set to a sane, non-default value (0.8-1.5 range)', () => {
    const match = rendererSource.match(/this\.renderer\.toneMappingExposure\s*=\s*([\d.]+);/);
    assert.ok(match, 'expected this.renderer.toneMappingExposure = <number> in the constructor');
    const exposure = Number(match[1]);
    assert.ok(exposure >= 0.8 && exposure <= 1.5, `toneMappingExposure ${exposure} outside the sane 0.8-1.5 band`);
});

test('the toon shader (js/shaders/toon.frag.js) has no tonemapping include — it renders raw and is graded exactly once by OutputPass', () => {
    assert.ok(!toonFragSource.includes('tonemapping'), 'toon fragment shader should not reference a tonemapping chunk');
    // Outline silhouette is solid black — invariant under every tone-mapping curve (f(0) = 0), so
    // the outline pass stays correct regardless of which tone mapping mode the renderer picks.
    assert.match(toonFragSource, /outlineFragmentShader[\s\S]*gl_FragColor = vec4\(0\.0, 0\.0, 0\.0, 1\.0\);/);
});

// --- postprocessing chain intact -------------------------------------------------

test('_initComposer still wires RenderPass -> UnrealBloomPass -> OutputPass, in that order', () => {
    const body = extractMethodBody('    _initComposer(camera) {', '    // Public so main.js can call composer.setSize');
    const renderPassIdx = body.indexOf('new RenderPass(');
    const bloomIdx = body.indexOf('new UnrealBloomPass(');
    const outputPassIdx = body.indexOf('new OutputPass()');
    assert.ok(renderPassIdx !== -1 && bloomIdx !== -1 && outputPassIdx !== -1, 'expected all three passes to still be constructed');
    assert.ok(renderPassIdx < bloomIdx && bloomIdx < outputPassIdx, 'passes must be added in RenderPass -> Bloom -> Output order');
});

// --- bloom profile default + bounds ----------------------------------------------

const DEFAULT_BLOOM_PROFILE = extractObjectLiteral('static DEFAULT_BLOOM_PROFILE = {');
const QUALITY_PRESETS = extractObjectLiteral('static QUALITY_PRESETS = {');

test('DEFAULT_BLOOM_PROFILE defers strength to the active quality preset and keeps radius/threshold within sane bounds', () => {
    assert.equal(DEFAULT_BLOOM_PROFILE.strength, null, 'default profile should not override quality-driven strength');
    assert.ok(DEFAULT_BLOOM_PROFILE.radius > 0 && DEFAULT_BLOOM_PROFILE.radius <= 1, 'radius should be a tight (0,1] value');
    assert.ok(DEFAULT_BLOOM_PROFILE.threshold > 0.5 && DEFAULT_BLOOM_PROFILE.threshold <= 1, 'threshold should be raised so only true emissives bloom');
});

test('QUALITY_PRESETS bloom contract (locked by tests/settings-options.test.mjs) is untouched by the graphics-polish pass', () => {
    assert.deepEqual(QUALITY_PRESETS.low, { pixelRatio: 1, shadows: false, bloom: 0 });
    assert.deepEqual(QUALITY_PRESETS.medium, { pixelRatio: 1.5, shadows: true, bloom: 0.05 });
    assert.deepEqual(QUALITY_PRESETS.high, { pixelRatio: 2, shadows: true, bloom: 0.08 });
});

// --- setBloomProfile / _applyBloomStrength behavior -------------------------------

const setBloomProfileBody = extractMethodBody(
    '    setBloomProfile({ strength, radius, threshold } = {}) {',
    '    // Single point that decides live UnrealBloomPass.strength'
);
const applyBloomStrengthBody = extractMethodBody(
    '    _applyBloomStrength() {',
    '    // Exported so settings tooling'
);

// eslint-disable-next-line no-new-func
const applyBloomStrengthFn = new Function('Renderer', applyBloomStrengthBody);
// eslint-disable-next-line no-new-func
const setBloomProfileFn = new Function('{ strength, radius, threshold } = {}', setBloomProfileBody);

const RendererStatic = { QUALITY_PRESETS };

function makeCtx(overrides = {}) {
    const ctx = {
        _bloom: { strength: -1, radius: -1, threshold: -1, enabled: true },
        _bloomProfile: { strength: null, radius: 0.22, threshold: 0.78 },
        _quality: 'high',
        _hubPerformanceMode: false,
        ...overrides,
    };
    ctx._applyBloomStrength = () => applyBloomStrengthFn.call(ctx, RendererStatic);
    ctx.setBloomProfile = (opts) => setBloomProfileFn.call(ctx, opts);
    return ctx;
}

test('setBloomProfile clamps out-of-range strength/radius/threshold into their sane bounds', () => {
    const ctx = makeCtx();
    ctx.setBloomProfile({ strength: 99, radius: -5, threshold: 5 });
    assert.equal(ctx._bloomProfile.strength, 2, 'strength should clamp to the 2 ceiling');
    assert.equal(ctx._bloomProfile.radius, 0, 'radius should clamp to the 0 floor');
    assert.equal(ctx._bloomProfile.threshold, 1, 'threshold should clamp to the 1 ceiling');
    assert.equal(ctx._bloom.radius, 0);
    assert.equal(ctx._bloom.threshold, 1);
});

test('setBloomProfile({strength: null}) resets the override back to quality-driven strength', () => {
    const ctx = makeCtx({ _bloomProfile: { strength: 0.9, radius: 0.22, threshold: 0.78 } });
    ctx.setBloomProfile({ strength: null });
    assert.equal(ctx._bloomProfile.strength, null);
    assert.equal(ctx._bloom.strength, QUALITY_PRESETS.high.bloom, 'should fall back to the high-quality preset strength (0.08)');
    assert.equal(ctx._bloom.enabled, true);
});

test('_applyBloomStrength disables the UnrealBloomPass outright at low quality (0 strength = skip the blur cascade)', () => {
    const ctx = makeCtx({ _quality: 'low' });
    ctx._applyBloomStrength();
    assert.equal(ctx._bloom.strength, 0);
    assert.equal(ctx._bloom.enabled, false, 'pass should be disabled, not just zero-strength, to skip the 5-mip blur cascade');
});

test('_applyBloomStrength keeps the pass enabled with the expected strength at high quality (no profile override)', () => {
    const ctx = makeCtx({ _quality: 'high' });
    ctx._applyBloomStrength();
    assert.equal(ctx._bloom.strength, 0.08);
    assert.equal(ctx._bloom.enabled, true);
});

test('_applyBloomStrength forces 0/disabled under hub-performance mode even with a high profile override', () => {
    const ctx = makeCtx({ _quality: 'high', _hubPerformanceMode: true, _bloomProfile: { strength: 1.5, radius: 0.22, threshold: 0.78 } });
    ctx._applyBloomStrength();
    assert.equal(ctx._bloom.strength, 0);
    assert.equal(ctx._bloom.enabled, false);
});

test('a per-map bloom profile strength override takes priority over the quality preset', () => {
    const ctx = makeCtx({ _quality: 'high', _bloomProfile: { strength: 0.5, radius: 0.22, threshold: 0.78 } });
    ctx._applyBloomStrength();
    assert.equal(ctx._bloom.strength, 0.5, 'explicit profile override should win over the 0.08 high-quality default');
    assert.equal(ctx._bloom.enabled, true);
});
