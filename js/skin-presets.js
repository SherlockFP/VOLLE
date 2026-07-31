// skin-presets.js — procedural face + torso-motif packs for the Minecraft-style avatar atlas
// (js/avatar.js owns the atlas/UV layout; this module only supplies preset *data* and the pure
// function that paints it onto a team-tinted atlas). No binary assets: every pixel here is a
// small data table, rendered at runtime via createAvatarAtlas() + canvas.
//
// IP SAFETY: every "themed" preset is an ORIGINAL archetype rendered in an evocative palette —
// never a trademarked name, logo, or 1:1 costume copy. See each preset's `inspiration` string
// and tests/skin-presets.test.mjs's trademark-term blacklist check.
//
// TEAM DOMINANCE (AGENTS rule: team red/blue stays theme-independent, never obscured): the base
// atlas under every preset comes from AVATAR_SKINS's own team skin (blue_default/red_guard), so
// head/torso/limb base colors are already the team's colors before a preset touches anything.
// Presets only ever repaint (a) the 8x8 face region -- outside the "never obscure team colour"
// rule, which is scoped to torso/trim -- and (b) a deliberately sparse torso `motif` (<= 10 of
// the 96 front-torso pixels), so the team hex always stays the strict pixel-count majority.
import { ATLAS_SIZE, FRONT_UV, HEAD_FRONT, createAvatarAtlas, getTeamPresetSkinId } from './avatar.js';

const FACE_W = HEAD_FRONT.width;
const FACE_H = HEAD_FRONT.height;

// Turns 8 row-strings (one char per pixel, '.' = transparent/keep base skin tone) into the flat
// 64-length color array avatar.js's atlas functions expect. Pure data->data, no canvas needed
// until renderSkinPreset() paints the result onto a real atlas.
function buildFace(rows, legend) {
    const face = Array(FACE_W * FACE_H).fill(null);
    for (let y = 0; y < FACE_H; y++) {
        const row = rows[y] || '';
        for (let x = 0; x < FACE_W; x++) {
            const ch = row[x];
            if (!ch || ch === '.') continue;
            const color = legend[ch];
            if (color) face[y * FACE_W + x] = color;
        }
    }
    return face;
}

// Torso motif points are relative to FRONT_UV.body (0..7 x, 0..11 y). Kept short (<=10 points
// out of the 96-pixel front torso) on purpose -- see TEAM DOMINANCE note above.
const motif = points => Object.freeze(points.map(([x, y, color]) => Object.freeze({ x, y, color })));

const preset = (id, name, theme, inspiration, rows, legend, motifPoints = []) => Object.freeze({
    id,
    name,
    theme,
    inspiration,
    face: Object.freeze(buildFace(rows, legend)),
    motif: motif(motifPoints)
});

export const SKIN_PRESETS = Object.freeze({
    // --- 6 expression variants on neutral bodies (no torso motif) ---
    happy: preset('happy', 'Happy', 'expression', null, [
        '........',
        '........',
        '........',
        '.k....k.',
        '........',
        '..rrrr..',
        '..r..r..',
        '........'
    ], { k: '#1a1a1a', r: '#d94f6b' }),

    angry: preset('angry', 'Angry', 'expression', null, [
        '........',
        '........',
        '...aa...',
        '.a....a.',
        '........',
        '...aa...',
        '........',
        '........'
    ], { a: '#5a1414' }),

    determined: preset('determined', 'Determined', 'expression', null, [
        '........',
        '........',
        '.d....d.',
        '.d....d.',
        '........',
        '..dddd..',
        '........',
        '........'
    ], { d: '#22314f' }),

    smug: preset('smug', 'Smug', 'expression', null, [
        '........',
        '.....k..',
        '........',
        '.k......',
        '.....k..',
        '..mmm...',
        '........',
        '........'
    ], { k: '#1a1a1a', m: '#c2607a' }),

    sleepy: preset('sleepy', 'Sleepy', 'expression', null, [
        '........',
        '........',
        '.z....z.',
        '........',
        '.h....h.',
        '...o....',
        '........',
        '........'
    ], { z: '#4a4a4a', h: '#cfcfcf', o: '#7a5a4a' }),

    hyped: preset('hyped', 'Hyped', 'expression', null, [
        '........',
        '.k....k.',
        '........',
        '.y....y.',
        '........',
        '..oooo..',
        '..o..o..',
        '........'
    ], { k: '#1a1a1a', y: '#ffd23f', o: '#ff6b6b' }),

    // --- 10 themed originals (inspired-by archetypes, not trademarked characters) ---
    night_vigilante: preset(
        'night_vigilante', 'Night Vigilante', 'themed',
        'A dark cowl-and-cape crimefighter archetype in an original low-poly palette -- no copyrighted costume, logo, or name.',
        [
            'cccccccc',
            'cccccccc',
            'cccccccc',
            'ccwccwcc',
            'cccccccc',
            '........',
            '........',
            '........'
        ], { c: '#14161f', w: '#e8f4ff' },
        [[1, 0, '#14161f'], [6, 0, '#14161f'], [3, 0, '#14161f'], [4, 0, '#14161f']]
    ),

    chaos_clown: preset(
        'chaos_clown', 'Chaos Clown', 'themed',
        'A trickster-performer archetype -- green hair, purple trim, painted grin -- an original palette combo, not a copyrighted character design.',
        [
            'gggggggg',
            'gg....gg',
            '........',
            '..p..p..',
            '...n....',
            '.rrrrrr.',
            '........',
            '........'
        ], { g: '#3fae56', p: '#7a3fc2', n: '#c23a3a', r: '#c23a3a' },
        [[1, 0, '#5a2f8f'], [6, 0, '#5a2f8f'], [0, 2, '#5a2f8f'], [7, 2, '#5a2f8f']]
    ),

    shonen_hero: preset(
        'shonen_hero', 'Shonen Hero', 'themed',
        'A spiky-haired martial-arts protagonist archetype from adventure fiction -- original silhouette and palette, no specific show\'s character or logo.',
        [
            'ooo..ooo',
            'o......o',
            '........',
            '.k....k.',
            '........',
            '..kkkk..',
            '........',
            '........'
        ], { o: '#ff7a1a', k: '#241a12' },
        [[2, 3, '#ff7a1a'], [3, 4, '#ff7a1a'], [4, 5, '#ff7a1a'], [5, 6, '#ff7a1a']]
    ),

    pirate_captain: preset(
        'pirate_captain', 'Pirate Captain', 'themed',
        'A swashbuckling sea-captain archetype -- eye patch, strap, gold buckle -- original design, not tied to any specific film franchise.',
        [
            '........',
            '........',
            '.....p..',
            '..k..p..',
            '....sp..',
            '..gggg..',
            '........',
            '........'
        ], { k: '#1a1a1a', p: '#171717', s: '#5a3a1f', g: '#3a2413' },
        [[2, 9, '#d9a441'], [3, 9, '#d9a441'], [4, 9, '#d9a441'], [5, 9, '#d9a441'], [3, 10, '#d9a441'], [4, 10, '#d9a441']]
    ),

    cyber_ninja: preset(
        'cyber_ninja', 'Cyber Ninja', 'themed',
        'A stealth cyber-operative archetype -- masked visor, piping trim -- original tech palette, not a specific franchise ninja.',
        [
            'kkkkkkkk',
            'kkkkkkkk',
            'kkkkkkkk',
            'kcccccck',
            'kkkkkkkk',
            'kkkkkkkk',
            '........',
            '........'
        ], { k: '#12141a', c: '#59f3ff' },
        [[3, 1, '#59f3ff'], [4, 1, '#59f3ff'], [3, 2, '#59f3ff'], [4, 2, '#59f3ff']]
    ),

    ice_queen: preset(
        'ice_queen', 'Ice Queen', 'themed',
        'A frost-and-crystal royalty archetype -- pale palette, icy accents -- original design, not any specific animated-film character.',
        [
            'wwwwwwww',
            'ww....ww',
            '........',
            '.i....i.',
            '........',
            '..iiii..',
            '........',
            '........'
        ], { w: '#eaf7ff', i: '#5fc9e8' },
        [[3, 0, '#bdeeff'], [4, 0, '#bdeeff'], [2, 1, '#bdeeff'], [5, 1, '#bdeeff']]
    ),

    robot: preset(
        'robot', 'Robot', 'themed',
        'A mechanical-guardian archetype -- plated visor, rivets -- original robotic palette, not a specific franchise robot.',
        [
            'mmmmmmmm',
            'm......m',
            '........',
            '.rrrrrr.',
            '........',
            '..mmmm..',
            '........',
            '........'
        ], { m: '#8b93a0', r: '#ff3b3b' },
        [[0, 1, '#c7ced6'], [7, 1, '#c7ced6'], [0, 10, '#c7ced6'], [7, 10, '#c7ced6'], [3, 5, '#c7ced6'], [4, 5, '#c7ced6']]
    ),

    zombie: preset(
        'zombie', 'Zombie', 'themed',
        'An undead-wanderer archetype -- sickly green palette, stitched mouth -- original horror-adjacent design, not a specific licensed character.',
        [
            'zzzzzzzz',
            'zzzzzzzz',
            'zzzzzzzz',
            'zzkzzkzz',
            'zzzzzzzz',
            'zz.ss.zz',
            'zzzzzzzz',
            '........'
        ], { z: '#7a9b5a', k: '#141c0a', s: '#241a12' },
        [[1, 3, '#2a331f'], [2, 4, '#2a331f'], [6, 3, '#2a331f'], [5, 4, '#2a331f']]
    ),

    astronaut: preset(
        'astronaut', 'Astronaut', 'themed',
        'A space-explorer archetype -- reflective visor, white suit paneling -- original sci-fi design, not any specific mission or franchise suit.',
        [
            'wwwwwwww',
            'w......w',
            'gggggggg',
            'gggggggg',
            'gggggggg',
            'wwwwwwww',
            '........',
            '........'
        ], { w: '#f2f6fa', g: '#e8a23c' },
        [[3, 1, '#e7edf5'], [3, 4, '#e7edf5'], [3, 7, '#e7edf5'], [3, 10, '#e7edf5'], [4, 1, '#e7edf5'], [4, 4, '#e7edf5']]
    ),

    royal_knight: preset(
        'royal_knight', 'Royal Knight', 'themed',
        'A noble armored-knight archetype -- gold crest, disciplined bearing -- original heraldry, not tied to any specific game or franchise knight.',
        [
            'g......g',
            '........',
            '.d....d.',
            '.d....d.',
            '........',
            '..dddd..',
            '........',
            '........'
        ], { g: '#d9b34a', d: '#26314a' },
        [[3, 2, '#d9b34a'], [3, 3, '#d9b34a'], [2, 3, '#d9b34a'], [4, 3, '#d9b34a'], [3, 4, '#d9b34a'], [1, 0, '#d9b34a'], [6, 0, '#d9b34a']]
    ),

    // Character accent for the "Dark Eater" set (ball skin + knife + cape/aura/trail share
    // this palette). Void-purple glow on a blacked-out face.
    dark_eater: preset(
        'dark_eater', 'Dark Eater', 'themed',
        'A void-devourer archetype -- blacked-out face with burning purple glare -- original palette and silhouette, not a licensed character.',
        [
            'vvvvvvvv',
            'vvvvvvvv',
            'vvvvvvvv',
            'vpvvvvpv',
            'vvvvvvvv',
            'vv.pp.vv',
            'vvvvvvvv',
            '........'
        ], { v: '#0b0416', p: '#c48cff' },
        [[0, 0, '#c48cff'], [7, 0, '#c48cff'], [3, 1, '#0b0416'], [4, 1, '#0b0416'], [3, 2, '#c48cff'], [4, 2, '#c48cff']]
    )
});

export const SKIN_PRESET_IDS = Object.freeze(Object.keys(SKIN_PRESETS));

// Renders a preset onto a fresh, fully team-tinted 64x64 atlas (see TEAM DOMINANCE note at the
// top of this file). Returns null for an unknown preset id so callers can no-op instead of
// crashing on a stale/removed id.
export function renderSkinPreset(presetId, team = 'red') {
    const preset = SKIN_PRESETS[presetId];
    if (!preset) return null;
    const baseSkinId = getTeamPresetSkinId(team) || getTeamPresetSkinId('red');
    const atlas = createAvatarAtlas(baseSkinId);
    for (let y = 0; y < FACE_H; y++) {
        for (let x = 0; x < FACE_W; x++) {
            const color = preset.face[y * FACE_W + x];
            if (color != null) atlas[(HEAD_FRONT.y + y) * ATLAS_SIZE + HEAD_FRONT.x + x] = color;
        }
    }
    for (const point of preset.motif) {
        if (point.x < 0 || point.x >= FRONT_UV.body.width || point.y < 0 || point.y >= FRONT_UV.body.height) continue;
        const px = FRONT_UV.body.x + point.x;
        const py = FRONT_UV.body.y + point.y;
        atlas[py * ATLAS_SIZE + px] = point.color;
    }
    return atlas;
}
