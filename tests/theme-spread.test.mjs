// Theme spread verification (V3_UX_ROADMAP.md §2.1 — ThemeSpread pass).
// Ensures shop/lobby/career/social-hub screens no longer hardcode the old fixed
// turquoise/cyan palette and instead consume the --screen-* / --ui-* tokens that
// already vary per theme in css/ui-tokens.css. Complements tests/theme-coverage.test.mjs
// (which tracks the whole-file literal ceiling) with a screen-scoped assertion and
// documents the remaining "diğer" (other) inventory left for the next session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const polish = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

// --- classifier: same "turquoise family" definition used to drive the migration ---
// A literal counts as "turquoise family" when it sits within THRESH euclidean RGB
// distance of one of the tokens that already replace it (screen-accent / ui-menu-accent
// / ui-primary-hover / ui-focus / screen-panel / screen-line / screen-accent-soft).
const REAL_REFS = {
    'screen-accent': [112, 221, 255],
    'screen-accent-soft': [54, 216, 202],
    'screen-panel': [36, 140, 204],
    'screen-line': [132, 206, 244],
    'ui-menu-accent': [94, 231, 247],
    'ui-primary-hover': [97, 234, 220],
    'ui-focus': [159, 246, 238],
};
const THRESH = 35;

function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    else if (h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    else if (h.length === 8) h = h.slice(0, 6);
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestRef(r, g, b) {
    let best = null;
    let bestD = Infinity;
    for (const [name, [rr, gg, bb]] of Object.entries(REAL_REFS)) {
        const d = Math.sqrt((r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2);
        if (d < bestD) { bestD = d; best = name; }
    }
    return [best, bestD];
}

function findVarSpans(line) {
    // Literals inside var(--x, #fallback) are already theme-driven (the fallback only
    // fires if the custom property is undefined, which never happens here) — skip them.
    const spans = [];
    const re = /var\(/g;
    let m;
    while ((m = re.exec(line))) {
        const start = m.index;
        let depth = 1;
        let i = re.lastIndex;
        while (i < line.length && depth > 0) {
            if (line[i] === '(') depth++;
            else if (line[i] === ')') depth--;
            i++;
        }
        spans.push([start, i]);
    }
    return spans;
}
const inSpans = (pos, spans) => spans.some(([s, e]) => pos >= s && pos < e);

const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
const rgbaRe = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g;

function scanFile(text) {
    const lines = text.split('\r\n');
    const hits = [];
    const selectorStack = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const line = lines[i];
        const stripped = line.trim();
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        const vspans = findVarSpans(line);

        hexRe.lastIndex = 0;
        let hm;
        while ((hm = hexRe.exec(line))) {
            if (inSpans(hm.index, vspans)) continue;
            const rgb = hexToRgb(hm[0]);
            if (!rgb) continue;
            const [ref, d] = nearestRef(...rgb);
            if (d <= THRESH) {
                hits.push({ line: lineNo, val: hm[0], ref, ctx: selectorStack[selectorStack.length - 1] || '', text: stripped });
            }
        }
        rgbaRe.lastIndex = 0;
        let rm;
        while ((rm = rgbaRe.exec(line))) {
            if (inSpans(rm.index, vspans)) continue;
            const r = parseFloat(rm[1]);
            const g = parseFloat(rm[2]);
            const b = parseFloat(rm[3]);
            const [ref, d] = nearestRef(r, g, b);
            if (d <= THRESH) {
                hits.push({ line: lineNo, val: rm[0], ref, ctx: selectorStack[selectorStack.length - 1] || '', text: stripped });
            }
        }
        if (opens || closes) {
            if (opens > 0) selectorStack.push(stripped.slice(0, 200));
            for (let k = 0; k < closes; k++) selectorStack.pop();
        }
    }
    return hits;
}

function screenBucket(ctx) {
    const s = ctx.toLowerCase();
    if (s.includes('shop') || s.includes('case-')) return 'shop';
    if (s.includes('lobby') || s.includes('multiplayer-menu') || s.includes('mp-lobby') || s.includes('cs-')) return 'lobby';
    if (s.includes('career') || s.includes('progression') || s.includes('battlepass') || s.includes('bp-') || s.includes('daily') || s.includes('achievement') || s.includes('skill-') || s.includes('rune-') || s.includes('workshop')) return 'career';
    if (s.includes('social') || s.includes('leaderboard') || s.includes('chat')) return 'social';
    return 'other';
}

// Documented, intentionally-untouched zones (DOKUNULMAZ per AGENTS.md / this pass):
//  - `.ow-*`, `.social-lobby-*`, `.friends-*`, `.ow-world*`: the 3D-world social hub
//    card (index.html "3D SOCIAL HUB") is a deliberately light/pastel floating card,
//    separate from the dark menu system; also covers #main-menu's own .ow-* palette
//    which the roadmap already tracks as "done" territory (out of this pass's scope).
//  - `.case-art` (#shop-screen .case-art): the aspect-ratio/object-fit fix — untouchable.
//  - `.case-reel-item`, `[data-winner=...]`, `.prestige-badge`, `.cs-team-col.red|blue`:
//    rarity ladders and team red/blue ownership colors stay theme-independent by design.
function isProtectedZone(ctx) {
    const s = ctx.toLowerCase();
    if (/(^|[\s,.#:])ow-/.test(s)) return true;
    if (s.includes('social-lobby') || s.includes('friends-') || s.includes('ow-social') || s.includes('ow-create-map') || s.includes('ow-world')) return true;
    if (s.includes('case-art')) return true;
    if (s.includes('case-reel-item')) return true;
    if (s.includes('prestige-badge')) return true;
    if (s.includes('cs-team-col.blue') || s.includes('cs-team-col.red') || s.includes('data-winner')) return true;
    return false;
}

const allHits = [
    ...scanFile(style).map((h) => ({ ...h, file: 'style.css' })),
    ...scanFile(polish).map((h) => ({ ...h, file: 'polish.css' })),
];

test('shop/lobby/career/social-hub selector blocks have zero un-migrated turquoise literals', () => {
    const priority = allHits.filter((h) => ['shop', 'lobby', 'career', 'social'].includes(screenBucket(h.ctx)));
    const offenders = priority.filter((h) => !isProtectedZone(h.ctx));
    assert.deepEqual(
        offenders.map((h) => `${h.file}:${h.line} ${h.val}`),
        [],
        'shop/lobby/career/social screens must consume --screen-*/--ui-* tokens, not fixed turquoise literals ' +
        '(protected zones — case-art fix, case-reel-item rarity ladder, team red/blue, the 3D social-lobby card — are exempt)',
    );
});

test('global remaining turquoise-family literal count has a ceiling that only decreases', () => {
    // Measured after this pass: 368 total (56 style.css + 312 polish.css), all outside
    // shop/lobby/career/social (see previous test) or inside a protected zone above.
    // Breakdown of what remains ("diğer" inventory for the next session):
    //   - #main-menu / .ow-* component-level literals (roadmap items 1.4, 4.2) — the
    //     menu *container* already reads tokens, but individual .ow-avatar/.ow-logo/etc
    //     child rules still hardcode values in a handful of places.
    //   - The "3D SOCIAL HUB" world-overlay card (.ow-social-lobby, .social-lobby-*,
    //     #social-lobby-*) — intentionally light/pastel, out of the dark theme system.
    //   - Replay screen, avatar/customization screen, settings scroll, network
    //     diagnostics, host-migration banner, practice-lab HUD — none named in the
    //     roadmap's shop/lobby/career/social scope for this pass.
    //   - --shell-blue/--shell-blue-dark local component palette (css/style.css ~4503).
    const total = allHits.length;
    assert.ok(total <= 368, `Total remaining turquoise-family literals should be <= 368 (found ${total})`);
});

test('screen/menu-accent tokens gained ground in shop/lobby/career screens (floor prevents revert)', () => {
    const tokenPattern = /var\(--(?:screen-accent|screen-accent-soft|screen-panel|screen-line|ui-menu-accent|ui-primary-hover|ui-focus)\)/g;
    const total = (style.match(tokenPattern) || []).length + (polish.match(tokenPattern) || []).length;
    assert.ok(total >= 110, `CSS files should have >= 110 screen-scoped token uses after this pass (found ${total})`);
});

test('team ownership and rarity-ladder colors were not swept into theme tokens', () => {
    assert.match(polish, /\.cs-team-col\.blue\s*\{\s*\r?\n\s*border-top-color:\s*#70ddff;/,
        'lobby team-select blue indicator must stay a fixed literal, not var(--screen-accent)');
    assert.match(polish, /\.cs-team-col\.red\s*\{\s*\r?\n\s*border-top-color:\s*#ff7184;/,
        'lobby team-select red indicator must stay a fixed literal');
    assert.match(polish, /--reel-core:\s*#6fe3c0;/,
        'case-reel-item common-rarity core color must stay a fixed literal (rarity ladder, not theme)');
});
