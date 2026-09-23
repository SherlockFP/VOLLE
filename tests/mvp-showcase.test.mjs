// tests/mvp-showcase.test.mjs — structural checks for the MVP card's markup,
// wiring and turntable renderer. js/mvp-showcase.js imports THREE, which plain
// `node --test` can't resolve (see tests/viewmodel-cosmetics.test.mjs), so the
// renderer itself is verified by source inspection rather than execution —
// the same approach tests/postgame-broadcast.test.mjs uses for its neighbors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const ui = read('../js/ui.js');
const main = read('../js/main.js');
const sw = read('../sw.js');
const showcase = read('../js/mvp-showcase.js');
const select = read('../js/mvp-select.js');

test('the MVP card sits above the Rematch decision, and the guest banner is present', () => {
    const winner = html.indexOf('id="pg-winner"');
    const mvp = html.indexOf('id="pg-mvp-card"');
    const rematch = html.indexOf('class="pg-rematch-hero"');
    const guestBanner = html.indexOf('id="pg-btn-guest-save"');
    const reportStart = html.indexOf('<section class="pg-detail-report"');

    assert.ok(winner > 0 && mvp > winner, 'MVP card renders after the winner banner');
    assert.ok(mvp < rematch, 'MVP card stays ahead of the Rematch CTA, not buried below it');
    assert.ok(guestBanner > rematch && guestBanner < reportStart, 'guest banner lives in the visible summary, not the details disclosure');
    assert.match(html, /id="pg-mvp-stage"/);
    assert.match(html, /id="pg-mvp-name"/);
    assert.match(html, /id="pg-mvp-stats"/);
});

test('postgame.css is linked and precached by the service worker', () => {
    assert.match(html, /<link rel="stylesheet" href="css\/postgame\.css/);
    assert.match(sw, /'css\/postgame\.css'/);
});

test('showPostGame renders the MVP card from a matchId-guarded showcase stash', () => {
    const start = ui.indexOf('    showPostGame(');
    const end = ui.indexOf('\n    // Post-match', start);
    const body = ui.slice(start, end);
    assert.match(body, /this\._pendingMvpShowcase\?\.matchId === result\.matchId/);
    assert.match(body, /this\._pendingMvpShowcase = null;/);
    assert.match(body, /this\._renderMvpCard\(playerStats, mvpShowcase\);/);
});

test('setPostGameMvpShowcase only stashes; _renderMvpCard disposes the previous stage and uses selectMvp', () => {
    assert.match(ui, /setPostGameMvpShowcase\(matchId, loadout\) \{\s*this\._pendingMvpShowcase = typeof matchId === 'string' && matchId \? \{ matchId, loadout \} : null;/);
    const start = ui.indexOf('    _renderMvpCard(');
    const end = ui.indexOf('\n    // Per-round breakdown', start);
    const body = ui.slice(start, end);
    assert.match(body, /this\._mvpShowcase\?\.dispose\(\);/);
    assert.match(body, /const mvp = selectMvp\(playerStats\);/);
    assert.match(body, /if \(!mvp\) \{ card\.hidden = true; return; \}/);
    assert.match(body, /createMvpShowcaseStage\(stage, \{ reducedMotion: this\._isReducedMotion\(\) \}\)/);
});

test('leaving post-game-screen through showScreen always disposes the MVP turntable', () => {
    const start = ui.indexOf('    showScreen(name) {');
    const end = ui.indexOf('\n    // _openExclusive', start);
    const body = ui.slice(start, end);
    assert.match(body, /extras\.forEach\(id => \{[\s\S]*?el\.classList\.add\('hidden'\);[\s\S]*?\}\);/);
    assert.match(body, /this\._mvpShowcase\?\.dispose\(\);\s*this\._mvpShowcase = null;/);
});

test('the AAR table MVP tag uses the same tie-break as the MVP card', () => {
    const start = ui.indexOf('    _buildAARTable(');
    const end = ui.indexOf('\n    _esc(', start);
    const body = ui.slice(start, end);
    assert.match(body, /const mvp = selectMvp\(playerStats\);/);
    assert.match(body, /class="pg-mvp-tag">MVP</);
});

test('the guest banner button reuses window._postGameAction and main.js prompts account creation', () => {
    assert.match(ui, /guestSave\.onclick = \(\) => window\._postGameAction\?\.\('create_account'\);/);
    assert.match(main, /\} else if \(action === 'create_account'\) \{\s*this\._promptAccount\(/);
});

test('the turntable renderer only mutates rotation per frame and always disposes cleanly', () => {
    const renderStart = showcase.indexOf('const render = (now');
    const renderEnd = showcase.indexOf('const mount =', renderStart);
    const renderBody = showcase.slice(renderStart, renderEnd);
    assert.doesNotMatch(renderBody, /new [A-Z]/, 'the per-frame render loop must not allocate');
    assert.match(renderBody, /if \(disposed \|\| !container\?\.isConnected\) return;/);
    assert.match(renderBody, /if \(!reducedMotion && composite\) composite\.rotation\.y \+= delta \* \.55;/);
    assert.match(renderBody, /if \(!reducedMotion\) frameHandle = requestAnimationFrame\(render\);/, 'reduced motion must stop the animation loop, not just skip the rotation');

    const disposeStart = showcase.indexOf('const dispose = () => {');
    const disposeEnd = showcase.indexOf('return { mount, dispose };', disposeStart);
    const disposeBody = showcase.slice(disposeStart, disposeEnd);
    assert.match(disposeBody, /cancelAnimationFrame\(frameHandle\);/);
    assert.match(disposeBody, /disposeComposite\(\);/);
    assert.match(disposeBody, /renderer\.dispose\(\);/);
    assert.match(disposeBody, /renderer\.domElement\.remove\(\);/);
});

test('an unknown knife/glove/ball on the MVP always falls back to the default piece', () => {
    assert.match(showcase, /const knifeStyle = KNIVES\[loadout\?\.knifeId\] \|\| KNIVES\.training;/);
    assert.match(showcase, /resolveEquippedGlove\(\{ gloves: loadout\?\.gloveId \}\)/);
    assert.match(showcase, /BALL_SKINS\[ballSkinId\] \|\| BALL_SKINS\.classic;/);
    assert.match(select, /knifeId: 'training', gloveId: 'none', ballSkinId: 'classic'/);
});

test('the showcase reuses the game\'s own knife/glove-hand builders instead of a bespoke model', () => {
    assert.match(showcase, /import \{ createKnifeModel, disposeObject3D \} from '\.\/weapon-models\.js';/);
    assert.match(showcase, /import \{ buildViewmodelHand, applyGloveLook, fitGripToModel \} from '\.\/viewmodel-hand\.js';/);
});
