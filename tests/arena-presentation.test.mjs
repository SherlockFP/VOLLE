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
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.beach_open,
        { exposure: 0.98, sun: 1.70, bloomRadius: 0.16, bloomThreshold: 0.84 });
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.industrial,
        { exposure: 1.16, sun: 2.10, bloomRadius: 0.18, bloomThreshold: 0.76 });
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.neon,
        { exposure: 1.06, sun: 1.65, bloomRadius: 0.18, bloomThreshold: 0.72 });
    assert.deepEqual(ARENA_PRESENTATION_PROFILES.grand_stadium,
        { exposure: 1.12, sun: 1.90, bloomRadius: 0.18, bloomThreshold: 0.82 });
    assert.equal(arenaPresentationProfile('beach'), ARENA_PRESENTATION_PROFILES.default);
    assert.equal(arenaPresentationProfile('beach_open'), ARENA_PRESENTATION_PROFILES.beach_open);
    assert.equal(arenaPresentationProfile('industrial'), ARENA_PRESENTATION_PROFILES.industrial);
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

test('floor materials consume each arena roughness, metalness, and emissive profile', () => {
    const method = source.slice(
        source.indexOf('    buildFloor() {'),
        source.indexOf('    _createTexturedToonMaterial(', source.indexOf('    buildFloor() {'))
    );
    assert.match(method, /c\.floorMaterial \|\| \{\}/);
    assert.match(method, /roughness: floorRoughness, metalness: floorMetalness/);
    assert.equal((method.match(/emissiveIntensity: floorEmissive/g) || []).length, 2);
});

test('Volleyball keeps a distinct court, horizon, and net without changing bloom ownership', () => {
    const beachStart = source.indexOf('    beach_open: {');
    const beachEnd = source.indexOf('    industrial: {', beachStart);
    const beach = source.slice(beachStart, beachEnd);
    const net = source.slice(source.indexOf('    buildNet() {'), source.indexOf('    buildCeiling() {'));

    assert.match(beach, /floorRed: 0xc94f5c, floorBlue: 0x168fbc/);
    assert.match(beach, /skyTop: 0x0d71c7, skyBottom: 0x8ecedc, fogColor: 0x79b7c6/);
    assert.match(beach, /horizonColor: 0x60b9d1, sun: true, sunColor: 0xffcf78, cloudAmount: 0.24/);
    assert.match(net, /this\.config\.isBeachOpen \? 0x173d5e : 0xdddddd/);
    assert.match(net, /this\.config\.isBeachOpen \? 0x184968 : 0xffffff/);
    assert.match(net, /this\.config\.isBeachOpen \? 0\.34 : 0\.2/);
    assert.match(source, /strength: null/, 'map presentation must retain quality-gated bloom ownership');
});
