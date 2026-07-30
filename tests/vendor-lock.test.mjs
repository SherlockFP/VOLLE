// tests/vendor-lock.test.mjs — regression coverage for the CDN → local vendor
// migration (docs/V3_UX_ROADMAP.md 4.4). index.html used to importmap 'three'/
// 'three/addons/' straight from jsdelivr and load peerjs from unpkg; both now
// resolve to committed copies under vendor/ so the game boots without any
// third-party CDN dependency (version pinning + offline reliability).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('index.html has no jsdelivr/unpkg CDN references', () => {
    assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net/);
    assert.doesNotMatch(indexHtml, /unpkg\.com/);
});

test('index.html importmap points three + three/addons/ at vendor/three', () => {
    assert.match(indexHtml, /"three":\s*"\.\/vendor\/three\/three\.module\.js"/);
    assert.match(indexHtml, /"three\/addons\/":\s*"\.\/vendor\/three\/addons\/"/);
});

test('index.html loads peerjs from vendor/peerjs', () => {
    assert.match(indexHtml, /<script src="vendor\/peerjs\/peerjs\.min\.js"><\/script>/);
});

test('vendor/three core module + addon files used by js/*.js exist on disk', () => {
    const root = new URL('../', import.meta.url);
    const required = [
        'vendor/three/three.module.js',
        'vendor/three/LICENSE',
        'vendor/three/addons/loaders/GLTFLoader.js',
        'vendor/three/addons/libs/meshopt_decoder.module.js',
        'vendor/three/addons/postprocessing/EffectComposer.js',
        'vendor/three/addons/postprocessing/RenderPass.js',
        'vendor/three/addons/postprocessing/UnrealBloomPass.js',
        'vendor/three/addons/postprocessing/OutputPass.js',
        // transitive deps pulled in by the postprocessing/loader addons above
        'vendor/three/addons/postprocessing/Pass.js',
        'vendor/three/addons/postprocessing/ShaderPass.js',
        'vendor/three/addons/postprocessing/MaskPass.js',
        'vendor/three/addons/shaders/CopyShader.js',
        'vendor/three/addons/shaders/LuminosityHighPassShader.js',
        'vendor/three/addons/shaders/OutputShader.js',
        'vendor/three/addons/utils/BufferGeometryUtils.js',
        'vendor/peerjs/peerjs.min.js',
        'vendor/peerjs/LICENSE'
    ];
    for (const rel of required) {
        assert.ok(existsSync(new URL(rel, root)), `missing ${rel}`);
    }
});

test('vendor/three/three.module.js is the real three.js module (not empty/stub)', async () => {
    const src = await readFile(new URL('../vendor/three/three.module.js', import.meta.url), 'utf8');
    assert.match(src, /class Vector3/);
    assert.ok(src.length > 500000, 'three.module.js looks truncated');
});
