import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');

function methodSource(name, nextName) {
    const start = source.indexOf(`    ${name}() {`);
    const end = source.indexOf(`    ${nextName}(`, start);
    assert.ok(start >= 0 && end > start, `${name} method missing`);
    return source.slice(start, end);
}

test('Factory has a dedicated static perimeter landmark pass', () => {
    const build = source.slice(source.indexOf('    build() {'), source.indexOf('    _loadArenaDecor()', source.indexOf('    build() {')));
    const factory = methodSource('buildIndustrialProps', 'buildSun');

    assert.match(build, /if \(this\.mapId === 'industrial'\) this\.buildIndustrialProps\(\);/);
    assert.match(factory, /group\.name = 'factory-presentation-landmarks';/);
    assert.match(factory, /group\.userData\.presentationOnly = true;/);
    assert.match(factory, /group\.userData\.nonColliding = true;/);
    assert.match(factory, /catwalkGeo/);
    assert.match(factory, /pipeGeo/);
    assert.equal(factory.includes('addCollidable('), false, 'Factory landmarks must not alter ball collision');
    assert.equal(factory.includes('Math.random'), false, 'Factory landmarks must rebuild deterministically');
    assert.equal(factory.includes('_mapAnimators'), false, 'Factory landmarks must not add a frame loop');
});

test('Beach Volleyball has static horizon separation without collision changes', () => {
    const build = source.slice(source.indexOf('    build() {'), source.indexOf('    _loadArenaDecor()', source.indexOf('    build() {')));
    const beach = methodSource('buildBeachPresentationProps', 'buildIndustrialProps');

    assert.match(build, /this\.buildBeachOpenProps\(\);\s*this\.buildBeachPresentationProps\(\);/);
    assert.match(beach, /group\.name = 'beach-presentation-landmarks';/);
    assert.match(beach, /shoreGeo/);
    assert.match(beach, /cabanaRoofGeo/);
    assert.equal(beach.includes('addCollidable('), false, 'Beach landmarks must not alter ball collision');
    assert.equal(beach.includes('Math.random'), false, 'Beach landmarks must rebuild deterministically');
    assert.equal(beach.includes('_mapAnimators'), false, 'Beach landmarks must not add a frame loop');
});

test('the map catalog remains static; landmark behavior is a render-only branch', () => {
    const industrial = source.slice(source.indexOf('    industrial: {'), source.indexOf('    space: {', source.indexOf('    industrial: {')));
    const beach = source.slice(source.indexOf('    beach_open: {'), source.indexOf('    industrial: {', source.indexOf('    beach_open: {')));

    assert.equal(industrial.includes('isIndustrial'), false);
    assert.equal(beach.includes('presentationOnly'), false);
    assert.match(source, /this\.collidables = \[\];/);
});
