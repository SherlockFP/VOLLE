// Shared red/blue team palette (owner feedback: team halves read pink/salmon,
// teal, violet or brown depending on the map). Every map's court halves now
// derive from one true-but-subdued red and blue (js/team-colors.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    TEAM_COLORS, TEAM_COLOR_CSS, TEAM_COURT_LIGHTNESS, TEAM_COURT_ALBEDO, TEAM_COURT_EMISSIVE,
    hexToHsl, hslToHex, teamCourtColors, teamCourtMaterial, withTeamPalette
} from '../js/team-colors.js';

const arenaSource = readFileSync(new URL('../js/arena.js', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const hudCss = readFileSync(new URL('../css/hud.css', import.meta.url), 'utf8');
const polishCss = readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

// Every map's authored floorRed/floorBlue pair, read from the MAPS table.
const authored = [...arenaSource.matchAll(/floorRed: (0x[0-9a-fA-F]{6}), floorBlue: (0x[0-9a-fA-F]{6})/g)]
    .map(match => [Number(match[1]), Number(match[2])]);

const isRedHue = h => h >= 350 || h <= 12;
const isBlueHue = h => h >= 205 && h <= 228;

test('canonical team colours are a true red and a true blue', () => {
    const red = hexToHsl(TEAM_COLORS.red);
    const blue = hexToHsl(TEAM_COLORS.blue);
    assert.ok(isRedHue(red.h), `red hue ${red.h}`);
    assert.ok(isBlueHue(blue.h), `blue hue ${blue.h}`);
    assert.equal(TEAM_COLOR_CSS.red, '#c0392b');
    assert.equal(TEAM_COLOR_CSS.blue, '#2e6fd8');
    assert.equal(TEAM_COLOR_CSS.red, `#${TEAM_COLORS.red.toString(16).padStart(6, '0')}`);
    assert.equal(TEAM_COLOR_CSS.blue, `#${TEAM_COLORS.blue.toString(16).padStart(6, '0')}`);
});

test('HSL helpers round-trip', () => {
    for (const hex of [0xc0392b, 0x2e6fd8, 0x808080, 0x000000, 0xffffff, 0x9b3631]) {
        const { h, s, l } = hexToHsl(hex);
        const back = hslToHex(h, s, l);
        for (const shift of [16, 8, 0]) {
            assert.ok(Math.abs(((back >> shift) & 0xff) - ((hex >> shift) & 0xff)) <= 1, hex.toString(16));
        }
    }
});

test('every map gets red/blue court halves: fixed hue, subdued saturation, lightness in the band', () => {
    assert.ok(authored.length >= 30, `found ${authored.length} maps`);
    for (const [red, blue] of authored) {
        const court = teamCourtColors(red, blue);
        const r = hexToHsl(court.red);
        const b = hexToHsl(court.blue);
        const label = `${red.toString(16)}/${blue.toString(16)}`;
        assert.ok(isRedHue(r.h), `${label}: red hue ${r.h}`);
        assert.ok(isBlueHue(b.h), `${label}: blue hue ${b.h}`);
        for (const hsl of [r, b]) {
            assert.ok(hsl.s >= 0.4 && hsl.s <= 0.6, `${label}: saturation ${hsl.s}`);
            assert.ok(hsl.l >= TEAM_COURT_LIGHTNESS.min - 0.01 && hsl.l <= TEAM_COURT_LIGHTNESS.max + 0.01, `${label}: lightness ${hsl.l}`);
        }
        // Same lightness on both halves: neither side draws the eye more.
        assert.ok(Math.abs(r.l - b.l) < 0.02, `${label}: halves differ in lightness`);
    }
    // No more pink/salmon (beach_open's old coral) or teal/cyan (its old blue).
    const beach = teamCourtColors(0xc94f5c, 0x168fbc);
    assert.ok(hexToHsl(beach.red).h <= 12);
    assert.ok(hexToHsl(beach.blue).h >= 205);
});

test('withTeamPalette: derived copy, authored theme kept, custom maps and opt-outs untouched', () => {
    const map = Object.freeze({ name: 'X', floorRed: 0xff3d81, floorBlue: 0x2de2e6, teamCourt: { lightness: 0.3 } });
    const config = withTeamPalette(map, 'neon');
    assert.notEqual(config, map);
    assert.equal(config.themeFloorRed, 0xff3d81);
    assert.equal(config.themeFloorBlue, 0x2de2e6);
    assert.equal(config.teamPalette, true);
    assert.equal(config.floorRed, teamCourtColors(0xff3d81, 0x2de2e6, 0.3).red);
    assert.equal(map.floorRed, 0xff3d81, 'MAPS entry never mutated');
    const custom = { floorRed: 0x123456, floorBlue: 0x654321 };
    assert.equal(withTeamPalette(custom, 'custom-mine'), custom);
    assert.equal(withTeamPalette({ ...custom, keepAuthoredTeamColors: true }, 'x').floorRed, 0x123456);
    assert.equal(withTeamPalette(null, 'x'), null);
});

test('court material anchors hue with emissive; per-map tweaks are clamped', () => {
    assert.deepEqual(teamCourtMaterial({}), { albedo: TEAM_COURT_ALBEDO, emissive: TEAM_COURT_EMISSIVE });
    assert.ok(TEAM_COURT_ALBEDO < 1 && TEAM_COURT_EMISSIVE >= 0.5);
    assert.deepEqual(teamCourtMaterial({ teamCourt: { albedo: 0.01, emissive: 4 } }), { albedo: 0.2, emissive: 1 });
});

test('arena.js wires the palette into Arena.config and the floor halves', () => {
    assert.match(arenaSource, /import \{ withTeamPalette, teamCourtMaterial \} from '\.\/team-colors\.js';/);
    assert.match(arenaSource, /this\.config = withTeamPalette\(MAPS\[this\.mapId\], this\.mapId\);/);
    assert.match(arenaSource, /this\.config = withTeamPalette\(MAPS\[mapId\], mapId\);/);
    assert.doesNotMatch(arenaSource, /this\.config = MAPS\[/);
    assert.match(arenaSource, /const teamCourt = c\.teamPalette \? teamCourtMaterial\(c\) : null;/);
    // Lava's full-court orange wash stays faint so the blue half stays blue.
    const glow = /this\._lavaGlow\.material\.opacity = ([\d.]+) \+ Math\.sin\(time \* 2\) \* ([\d.]+);/.exec(arenaSource);
    assert.ok(glow && Number(glow[1]) + Number(glow[2]) <= 0.06, 'lava glow opacity');
});

test('UI team tokens: palette values, colour-blind overrides still win, HUD/team menu/kill feed use them', () => {
    assert.match(styleCss, /--red: #c0392b;/);
    assert.match(styleCss, /--blue: #2e6fd8;/);
    assert.match(styleCss, /body\[data-color-blind="deuteranopia"\] \{ --red: #ffb000; --blue: #1f9eff; \}/);
    assert.match(styleCss, /:root, body \{ --red-ink: color-mix\(in srgb, var\(--red\) 72%, #fff\); --blue-ink: color-mix\(in srgb, var\(--blue\) 70%, #fff\); \}/);
    const teamRules = [hudCss, polishCss].join('\n').split('\n')
        .filter(line => /hud-team-score\.(red|blue)|#team-overlay \.team-col\.(red|blue)|kill-entry \.team-(red|blue)/.test(line));
    assert.ok(teamRules.length >= 8);
    for (const line of teamRules) {
        assert.doesNotMatch(line, /#ff5a6e|#5aa8ff|#bc263b|#2774cf|#e84d58|#4b8efa|#ff8a98|#8cc2ff/, line);
    }
});
