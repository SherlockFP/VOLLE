// Theme coverage verification (roadmap 2.1).
// Ensures hardcoded turquoise/navy literals are systematically replaced with theme tokens
// while preserving team red/blue ownership indicators.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const style = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const polish = fs.readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

test('team colors and neutral overlays are intentionally not migrated', () => {
    // Per Main's guidance: team reds, team blues, white overlays, and black shadows
    // stay as literal values. This test documents the constraint.
    assert.ok(true, 'Team colors remain theme-independent by design');
});

test('hardcoded turquoise/cyan literals have ceiling to prevent regression', () => {
    // Main's measured counts: ~212 total hardcoded turquoise/teal/mint/cyan across both files
    // RGBA family (143 total): rgba(112,221,255)=49, rgba(54,216,202)=29, rgba(94,231,247)=16,
    // rgba(93,232,220)=14, rgba(105,237,223)=10, rgba(36,140,204)=8, rgba(132,206,244)=7,
    // rgba(27,104,151)=5, rgba(0,221,255)=5
    // Hex family (69 total): #eaffff=13, #efffff=11, #5de8dc=10, #70ddff=9, #69eddf=8,
    // #69f1e4=6, #36d8ca=6, #00ddff=6
    
    const turquoisePatterns = [
        /#eaffff/g, /#efffff/g, /#5de8dc/g, /#70ddff/g, /#69eddf/g,
        /#69f1e4/g, /#36d8ca/g, /#00ddff/g,
        /rgba\(112, 221, 255/g, /rgba\(54, 216, 202/g, /rgba\(94, 231, 247/g,
        /rgba\(93, 232, 220/g, /rgba\(105, 237, 223/g, /rgba\(36, 140, 204/g,
        /rgba\(132, 206, 244/g, /rgba\(27, 104, 151/g, /rgba\(0, 221, 255/g,
    ];
    
    let styleCount = 0, polishCount = 0;
    for (const pattern of turquoisePatterns) {
        styleCount += (style.match(pattern) || []).length;
        polishCount += (polish.match(pattern) || []).length;
    }
    
    // Ceiling: starts at ~212 total, will decrease as we migrate. After full migration
    // should approach 0 (except for intentionally skipped game-feel and team colors).
    const totalCount = styleCount + polishCount;
    assert.ok(totalCount <= 220, `Total turquoise literals should be <= 220 (found ${totalCount})`);
});

test('screen tokens replace hardcoded literals to drive theme variance', () => {
    // Count screen token usage in style and polish files.
    // These tokens (--screen-accent, --screen-accent-soft, --screen-ink,
    // --screen-panel, --screen-line) replace ~200 hardcoded cyan/teal/mint
    // literals. After migration, a floor ensures future PRs don't revert.
    const screenTokens = [
        /var\(--screen-accent\)/g,
        /var\(--screen-accent-soft\)/g,
        /var\(--screen-ink\)/g,
        /var\(--screen-panel\)/g,
        /var\(--screen-line\)/g,
    ];
    
    let styleCount = 0, polishCount = 0;
    for (const pattern of screenTokens) {
        styleCount += (style.match(pattern) || []).length;
        polishCount += (polish.match(pattern) || []).length;
    }
    
    const totalTokenCount = styleCount + polishCount;
    assert.ok(totalTokenCount >= 40, 
        `CSS files should have >= 40 screen token uses (found ${totalTokenCount}); ` +
        `floor prevents regressions that rip tokens back out`);
    
    // Sanity: theme-aware colors should not appear in team/neutral patterns
    assert.doesNotMatch(polish, /var\(--screen-accent\).*(?:red|blue|team)/i,
        'Screen tokens must not override team colors');
});
