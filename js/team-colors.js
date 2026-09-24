// team-colors.js — the single shared red/blue team palette.
//
// Owner feedback: the team halves of the court (and the banners, zone rings,
// glow strips and lights keyed off them) used per-map "floorRed"/"floorBlue"
// values that read as coral/salmon/pink vs teal/cyan/violet — or not as a
// team colour at all (dojo's two browns, bazaar's terracotta/green). Every
// map now derives its team colours from ONE palette: a true red and a true
// blue, kept subdued (moderate saturation, mid-to-low lightness) so the
// floor detail and the map theme still read and the halves never compete
// with the ball.
//
// MAPS keeps the authored per-map colours untouched (lobby map cards and the
// per-map HUD theme still use them); Arena.config is a derived copy whose
// floorRed/floorBlue are replaced here, so every in-world consumer
// (buildFloor, buildProps, lights, map-art banners...) picks the palette up.
// Pure functions only (no THREE, no DOM) so node --test can pin the values.

// Canonical team colours (UI accents, banners). CSS mirrors these as
// --team-red / --team-blue in css/style.css.
export const TEAM_COLORS = Object.freeze({ red: 0xc0392b, blue: 0x2e6fd8 });
export const TEAM_COLOR_CSS = Object.freeze({ red: '#c0392b', blue: '#2e6fd8' });

// Court halves: hue fixed per team, saturation fixed (subdued), lightness
// follows the map's own floor brightness inside a narrow band — a dark night
// court gets a dark red/blue, a bright beach a mid one, never pastel/pink.
export const TEAM_COURT_HUE = Object.freeze({ red: 3, blue: 217 });
export const TEAM_COURT_SATURATION = Object.freeze({ red: 0.52, blue: 0.5 });
export const TEAM_COURT_LIGHTNESS = Object.freeze({ min: 0.22, max: 0.4 });
// Hue anchoring: the half's albedo is scaled down and the same colour is
// added back as emissive, so a map's tinted sun/hemisphere light (neon's
// violet, the bazaar's orange) cannot drag red to magenta/orange or blue to
// grey-green. Shadows still land on the lit part. Per-map `teamCourt`
// { lightness, albedo, emissive } may nudge these; hue never changes.
export const TEAM_COURT_ALBEDO = 0.45;
export const TEAM_COURT_EMISSIVE = 0.7;

export function teamCourtMaterial(config = {}) {
    const tweak = config.teamCourt || {};
    const albedo = Number.isFinite(tweak.albedo) ? Math.min(1, Math.max(0.2, tweak.albedo)) : TEAM_COURT_ALBEDO;
    const emissive = Number.isFinite(tweak.emissive) ? Math.min(1, Math.max(0, tweak.emissive)) : TEAM_COURT_EMISSIVE;
    return { albedo, emissive };
}

function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function hexToHsl(hex) {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
}

export function hslToHex(h, s, l) {
    const hue = ((h % 360) + 360) % 360 / 360;
    const sat = clamp01(s);
    const light = clamp01(l);
    if (sat === 0) {
        const v = Math.round(light * 255);
        return (v << 16) | (v << 8) | v;
    }
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    const channel = t => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    const r = Math.round(channel(hue + 1 / 3) * 255);
    const g = Math.round(channel(hue) * 255);
    const b = Math.round(channel(hue - 1 / 3) * 255);
    return (r << 16) | (g << 8) | b;
}

// Map floor brightness (mean HSL lightness of the authored halves), clamped
// into the court band. `override` (config.teamCourt.lightness) lets a map
// nudge luminance only — hue and saturation stay shared.
export function teamCourtLightness(authoredRed, authoredBlue, override) {
    if (Number.isFinite(override)) {
        return Math.min(TEAM_COURT_LIGHTNESS.max, Math.max(TEAM_COURT_LIGHTNESS.min, override));
    }
    const values = [authoredRed, authoredBlue].filter(Number.isFinite).map(hex => hexToHsl(hex).l);
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : TEAM_COURT_LIGHTNESS.max;
    return Math.min(TEAM_COURT_LIGHTNESS.max, Math.max(TEAM_COURT_LIGHTNESS.min, mean));
}

export function teamCourtColors(authoredRed, authoredBlue, override) {
    const l = teamCourtLightness(authoredRed, authoredBlue, override);
    return {
        red: hslToHex(TEAM_COURT_HUE.red, TEAM_COURT_SATURATION.red, l),
        blue: hslToHex(TEAM_COURT_HUE.blue, TEAM_COURT_SATURATION.blue, l)
    };
}

// Arena.config for a map: a shallow copy with the palette-derived team
// colours. Custom (editor) maps keep their author's colours.
export function withTeamPalette(config, mapId = '') {
    if (!config || String(mapId).startsWith('custom-') || config.keepAuthoredTeamColors === true) return config;
    const court = teamCourtColors(config.floorRed, config.floorBlue, config.teamCourt?.lightness);
    return {
        ...config,
        teamPalette: true,
        themeFloorRed: config.floorRed,
        themeFloorBlue: config.floorBlue,
        floorRed: court.red,
        floorBlue: court.blue
    };
}
