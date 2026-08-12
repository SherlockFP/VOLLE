// tests/skin-presets.test.mjs — coverage for js/skin-presets.js (Wave 5 avatar skin presets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKIN_PRESETS, SKIN_PRESET_IDS, renderSkinPreset } from '../js/skin-presets.js';
import { ATLAS_SIZE, FRONT_UV, AVATAR_SKINS } from '../js/avatar.js';

// Substrings that would collide with a real trademarked character/franchise name. Presets must
// read as original archetypes (see each preset's `inspiration` string), never these.
const TRADEMARK_BLACKLIST = [
    'batman', 'joker', 'naruto', 'goku', 'saitama', 'luffy', 'spiderman', 'spider-man',
    'superman', 'ironman', 'iron man', 'pikachu', 'mario', 'sonic', 'elsa', 'darth', 'vader',
    'harry potter', 'mickey', 'jack sparrow', 'wolverine', 'deadpool', 'thanos', 'thor'
];

test('ships at least 16 presets: 6 expression variants + >=10 themed originals', () => {
    assert.ok(SKIN_PRESET_IDS.length >= 16, `expected >= 16 presets, got ${SKIN_PRESET_IDS.length}`);
    const byTheme = SKIN_PRESET_IDS.reduce((acc, id) => {
        const theme = SKIN_PRESETS[id].theme;
        acc[theme] = (acc[theme] || 0) + 1;
        return acc;
    }, {});
    assert.equal(byTheme.expression, 6, 'exactly 6 expression variants');
    assert.ok((byTheme.themed || 0) >= 10, `>= 10 themed originals, got ${byTheme.themed}`);
});

test('every preset has required fields with correct shapes', () => {
    for (const id of SKIN_PRESET_IDS) {
        const p = SKIN_PRESETS[id];
        assert.equal(p.id, id, `${id}: id field matches its key`);
        assert.equal(typeof p.name, 'string', `${id}: name is a string`);
        assert.ok(p.name.length > 0, `${id}: name is non-empty`);
        assert.ok(p.theme === 'expression' || p.theme === 'themed', `${id}: theme is expression|themed`);
        if (p.theme === 'themed') {
            assert.equal(typeof p.inspiration, 'string', `${id}: themed preset has an inspiration blurb`);
            assert.ok(p.inspiration.length > 0, `${id}: inspiration is non-empty`);
        }
        assert.ok(Array.isArray(p.face), `${id}: face is an array`);
        assert.equal(p.face.length, 64, `${id}: face is the full 8x8 head-front grid (64 cells)`);
        assert.ok(Array.isArray(p.motif), `${id}: motif is an array`);
        for (const point of p.motif) {
            assert.equal(typeof point.x, 'number', `${id}: motif point.x is numeric`);
            assert.equal(typeof point.y, 'number', `${id}: motif point.y is numeric`);
            assert.equal(typeof point.color, 'string', `${id}: motif point.color is a hex string`);
        }
        // Sparse by design (see TEAM DOMINANCE note in skin-presets.js) -- well under the
        // 96-pixel front-torso area so the team hex always keeps the strict majority.
        assert.ok(p.motif.length <= 16, `${id}: motif stays sparse (${p.motif.length} points)`);
        assert.equal(typeof p.partMotifs, 'object', `${id}: full-body motif table exists`);
        for (const partName of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
            const region = FRONT_UV[partName];
            const points = p.partMotifs[partName];
            assert.ok(Array.isArray(points), `${id}: ${partName} motif is an array`);
            assert.ok(points.length <= 16, `${id}: ${partName} leaves a team-color majority`);
            for (const point of points) {
                assert.ok(point.x >= 0 && point.x < region.width, `${id}: ${partName} x is in bounds`);
                assert.ok(point.y >= 0 && point.y < region.height, `${id}: ${partName} y is in bounds`);
                assert.match(point.color, /^#[0-9a-f]{6}$/i, `${id}: ${partName} color is hex`);
            }
        }
        if (p.theme === 'themed') {
            assert.ok(
                Object.values(p.partMotifs).every((points) => points.length >= 8),
                `${id}: themed preset should visibly change every limb`
            );
        }
    }
});

test('atlas render function produces correct dimensions for every preset on both teams', () => {
    for (const id of SKIN_PRESET_IDS) {
        for (const team of ['red', 'blue']) {
            const atlas = renderSkinPreset(id, team);
            assert.ok(Array.isArray(atlas), `${id}/${team}: renders an array`);
            assert.equal(atlas.length, ATLAS_SIZE * ATLAS_SIZE, `${id}/${team}: atlas is ${ATLAS_SIZE}x${ATLAS_SIZE}`);
        }
    }
});

test('renderSkinPreset returns null for an unknown preset id instead of throwing', () => {
    assert.equal(renderSkinPreset('totally_not_a_preset', 'red'), null);
});

test('team-tint preserves team dominance: torso stays strictly majority team-colored', () => {
    const region = FRONT_UV.body;
    const regionSize = region.width * region.height;
    for (const id of SKIN_PRESET_IDS) {
        for (const [team, skinId] of [['red', 'red_guard'], ['blue', 'blue_default']]) {
            const atlas = renderSkinPreset(id, team);
            const teamHex = AVATAR_SKINS[skinId].body;
            let teamCount = 0;
            for (let y = region.y; y < region.y + region.height; y++) {
                for (let x = region.x; x < region.x + region.width; x++) {
                    if (atlas[y * ATLAS_SIZE + x] === teamHex) teamCount++;
                }
            }
            assert.ok(
                teamCount > regionSize / 2,
                `${id}/${team}: team color must stay torso majority (${teamCount}/${regionSize})`
            );
        }
    }
});

test('full-body costumes preserve a strict team-color majority on every limb', () => {
    for (const id of SKIN_PRESET_IDS) {
        for (const [team, skinId] of [['red', 'red_guard'], ['blue', 'blue_default']]) {
            const atlas = renderSkinPreset(id, team);
            const teamHex = AVATAR_SKINS[skinId].arms;
            for (const partName of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
                const region = FRONT_UV[partName];
                const expectedHex = partName.includes('Arm') ? teamHex : AVATAR_SKINS[skinId].legs;
                let count = 0;
                for (let y = region.y; y < region.y + region.height; y++) {
                    for (let x = region.x; x < region.x + region.width; x++) {
                        if (atlas[y * ATLAS_SIZE + x] === expectedHex) count++;
                    }
                }
                assert.ok(count > (region.width * region.height) / 2,
                    `${id}/${team}/${partName}: team base stays majority (${count}/${region.width * region.height})`);
            }
        }
    }
});

test('presets render distinctly across the two team-tint variants (same design, different base hue)', () => {
    for (const id of SKIN_PRESET_IDS) {
        const redAtlas = renderSkinPreset(id, 'red');
        const blueAtlas = renderSkinPreset(id, 'blue');
        assert.notDeepEqual(redAtlas, blueAtlas, `${id}: red and blue variants are visually different`);
    }
});

test('no preset id or name collides with a trademarked character/franchise term', () => {
    const offenders = [];
    for (const id of SKIN_PRESET_IDS) {
        const preset = SKIN_PRESETS[id];
        const haystack = `${preset.id} ${preset.name}`.toLowerCase();
        for (const term of TRADEMARK_BLACKLIST) {
            if (haystack.includes(term)) offenders.push(`${id}: matches blacklisted term "${term}"`);
        }
    }
    assert.deepEqual(offenders, [], 'preset names/ids must read as original archetypes, not trademarked characters');
});
