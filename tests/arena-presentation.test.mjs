import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
const start = source.indexOf('export const ARENA_PRESENTATION_PROFILES');
const end = source.indexOf('// Daha b', start);
assert.ok(start >= 0 && end > start, 'arena presentation profile block missing');
const profileSource = source.slice(start, end).replaceAll('export ', '');
const { ARENA_PRESENTATION_PROFILES, arenaPresentationProfile } = new Function(
    `${profileSource}\nreturn { ARENA_PRESENTATION_PROFILES, arenaPresentationProfile };`
)();

test('arena presentation profiles lock the approved exposure, sun, and bloom channels', () => {
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.default,
        { exposure: 1.10, sun: 1.80, bloomRadius: 0.22, bloomThreshold: 0.78 });
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.neon,
        { exposure: 1.06, sun: 1.65, bloomRadius: 0.18, bloomThreshold: 0.72 });
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.grand_stadium,
        { exposure: 1.12, sun: 1.90, bloomRadius: 0.18, bloomThreshold: 0.82 });
    assert.equal(arenaPresentationProfile('beach'), ARENA_PRESENTATION_PROFILES.default);
    assert.equal(arenaPresentationProfile('neon'), ARENA_PRESENTATION_PROFILES.neon);
});
test('initial construction and every rebuild apply all presentation channels', () => {
    assert.match(source, /this\.spectatorBounds = getSpectatorBounds\(this\.config\);\s*this\._applyPresentation\(this\.mapId\);/);
    assert.match(source, /rebuild\(mapId\)[\s\S]*?this\.spectatorBounds = getSpectatorBounds\(this\.config\);\s*this\._applyPresentation\(mapId\);\s*this\.build\(\);/);
    const method = source.slice(
        source.indexOf('    _applyPresentation(mapId) {'),
        source.indexOf('    // Apply per-map CSS theme', source.indexOf('    _applyPresentation(mapId) {'))
    );
    assert.match(method, /toneMappingExposure = profile\.exposure/);
    assert.match(method, /this\.renderer\.sun\.intensity = profile\.sun/);
    assert.match(method, /strength: null/);
    assert.match(method, /radius: profile\.bloomRadius/);
    assert.match(method, /threshold: profile\.bloomThreshold/);
});
