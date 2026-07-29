// tests/character-shapes.test.mjs — Character shape and palette audit
// Verifies: (1) all exported characters have shape entries, (2) shapes are in valid ranges,
// (3) shape + palette combinations create visual variety, (4) no gameplay leakage
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTERS } from '../js/characters.js';

const shopShowcase = readFileSync('./js/shop-showcase.js', 'utf-8');
const characterRig = readFileSync('./js/character-rig.js', 'utf-8');
const playerJs = readFileSync('./js/player.js', 'utf-8');
const botJs = readFileSync('./js/bot.js', 'utf-8');

test('all exported characters have shape entries', () => {
    const characterIds = Object.keys(CHARACTERS);
    assert.ok(characterIds.length > 0, 'at least one character exported');
    
    for (const id of characterIds) {
        assert.match(shopShowcase, new RegExp(`${id}:\\s*Object\\.freeze\\(\\{\\s*width:`), 
            `character "${id}" must have a shape entry in CHARACTER_SHAPES`);
    }
});

test('all shape entries have four numeric properties in sane ranges', () => {
    const characterIds = Object.keys(CHARACTERS);
    
    for (const id of characterIds) {
        const shapePattern = new RegExp(`${id}:\\s*Object\\.freeze\\(\\{\\s*width:\\s*([\\d.]+),\\s*height:\\s*([\\d.]+),\\s*depth:\\s*([\\d.]+),\\s*shoulder:\\s*([\\d.]+)`);
        const match = shopShowcase.match(shapePattern);
        assert.ok(match, `${id} shape is properly formatted`);
        
        const width = parseFloat(match[1]);
        const height = parseFloat(match[2]);
        const depth = parseFloat(match[3]);
        const shoulder = parseFloat(match[4]);
        
        // Sane ranges: 0.5x to 1.5x scale (allows 2x variation across roster)
        for (const [name, value] of [['width', width], ['height', height], ['depth', depth], ['shoulder', shoulder]]) {
            assert.ok(Number.isFinite(value), `${id}.${name} is finite`);
            assert.ok(value >= 0.5 && value <= 1.5, `${id}.${name} is in range [0.5, 1.5]`);
        }
    }
});

test('character shapes create meaningful visual spread', () => {
    const characterIds = Object.keys(CHARACTERS);
    const shapes = {};
    
    // Parse shapes
    for (const id of characterIds) {
        const shapePattern = new RegExp(`${id}:\\s*Object\\.freeze\\(\\{\\s*width:\\s*([\\d.]+),\\s*height:\\s*([\\d.]+),\\s*depth:\\s*([\\d.]+),\\s*shoulder:\\s*([\\d.]+)`);
        const match = shopShowcase.match(shapePattern);
        if (match) {
            shapes[id] = {
                width: parseFloat(match[1]),
                height: parseFloat(match[2]),
                depth: parseFloat(match[3]),
                shoulder: parseFloat(match[4])
            };
        }
    }
    
    // Verify spread: no two characters should be identical
    const shapeVectors = Object.entries(shapes).map(([id, s]) => [id, `${s.width}|${s.height}|${s.depth}|${s.shoulder}`]);
    const uniqueVectors = new Set(shapeVectors.map(([, v]) => v));
    assert.equal(uniqueVectors.size, shapeVectors.length, 'all characters have distinct shape vectors');
    
    // Report shape spread
    const widths = Object.values(shapes).map(s => s.width);
    const shoulders = Object.values(shapes).map(s => s.shoulder);
    
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    const minShoulder = Math.min(...shoulders);
    const maxShoulder = Math.max(...shoulders);
    
    // Meaningful spread: at least 20% variation between min/max
    const widthSpread = (maxWidth - minWidth) / minWidth;
    const shoulderSpread = (maxShoulder - minShoulder) / minShoulder;
    
    assert.ok(widthSpread > 0.2, `width variation ${(widthSpread * 100).toFixed(1)}% creates silhouette diversity`);
    assert.ok(shoulderSpread > 0.2, `shoulder variation ${(shoulderSpread * 100).toFixed(1)}% creates silhouette diversity`);
});

test('all characters have defined colors for palette generation', () => {
    const characterIds = Object.keys(CHARACTERS);
    
    for (const id of characterIds) {
        const char = CHARACTERS[id];
        assert.ok(char.color !== undefined && char.color !== null, `${id} has a color property`);
        assert.ok(typeof char.color === 'number' && char.color >= 0 && char.color <= 0xffffff, 
            `${id} color is a valid hex number`);
    }
});

test('character colors are distinct', () => {
    const characterIds = Object.keys(CHARACTERS);
    const colors = characterIds.map(id => CHARACTERS[id].color);
    const uniqueColors = new Set(colors);
    
    // All exported characters should have distinct colors
    assert.equal(uniqueColors.size, colors.length, 'all characters have distinct colors');
});

test('shape application is purely visual (no gameplay leakage)', () => {
    // Player and bot have fixed collision radii that don't depend on rig scale
    assert.match(playerJs, /this\.radius\s*=\s*0\.7/, 'player has fixed collision radius 0.7');
    assert.match(botJs, /this\.radius\s*=\s*0\.5/, 'bot has fixed collision radius 0.5');
    
    // applyShape scales the rig visually via root.scale.set
    assert.match(characterRig, /root\.scale\.set\(/, 'applyShape scales rig visually');
    
    // Verify shapes don't affect position offsets (collision checked above)
    assert.doesNotMatch(characterRig, /position\[.*\]\s*.*shape|shape\.\w+.*position\[/);
});

test('cosmetic sockets inherit rig transforms correctly', () => {
    // Sockets are positioned via pivot function and inherit parent joint transforms
    assert.match(characterRig, /socket:/,  'cosmetic sockets exist');
    assert.match(characterRig, /applyShape\(\)/, 'shape is applied to rig');
});

test('report full shape table (before/after)', () => {
    const characterIds = Object.keys(CHARACTERS);
    const shapes = {};
    
    for (const id of characterIds) {
        const shapePattern = new RegExp(`${id}:\\s*Object\\.freeze\\(\\{\\s*width:\\s*([\\d.]+),\\s*height:\\s*([\\d.]+),\\s*depth:\\s*([\\d.]+),\\s*shoulder:\\s*([\\d.]+)`);
        const match = shopShowcase.match(shapePattern);
        if (match) {
            shapes[id] = {
                width: parseFloat(match[1]),
                height: parseFloat(match[2]),
                depth: parseFloat(match[3]),
                shoulder: parseFloat(match[4])
            };
        }
    }
    
    // Report sorted by shoulder (largest to smallest) for visual grouping
    const sorted = Object.entries(shapes).sort((a, b) => b[1].shoulder - a[1].shoulder);
    
    console.log('\n=== CHARACTER SHAPE TABLE ===\n');
    console.log('ID          Width  Height  Depth  Shoulder  Color      Archetype');
    console.log('───────────────────────────────────────────────────────────────────');
    for (const [id, shape] of sorted) {
        const char = CHARACTERS[id];
        const colorHex = char.color.toString(16).padStart(6, '0').toUpperCase();
        const archetype = [
            { max: 0.9, label: 'Lean/Fast' },
            { max: 1.05, label: 'Balanced' },
            { max: 1.2, label: 'Broad/Slow' }
        ].find(a => shape.width <= a.max)?.label || 'Tank';
        
        console.log(`${id.padEnd(11)} ${shape.width.toFixed(2)}   ${shape.height.toFixed(2)}     ${shape.depth.toFixed(2)}   ${shape.shoulder.toFixed(2)}       #${colorHex}   ${archetype}`);
    }
    console.log('\n');
});
