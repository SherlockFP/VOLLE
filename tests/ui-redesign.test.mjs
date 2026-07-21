import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const cosmetics = readFileSync(new URL('../js/cosmetics.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/polish.css', import.meta.url), 'utf8');

test('case catalog uses unique image-backed cards and a confirmation dialog', () => {
    const paths = ['kickoff', 'chroma', 'arsenal', 'elemental', 'companions', 'mythic']
        .map(id => `assets/generated/cases/${id}-case.webp`);
    for (const path of paths) assert.match(cosmetics, new RegExp(path.replaceAll('/', '\\/')));
    for (const path of paths) assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} is missing`);
    assert.equal(new Set(paths).size, 6);
    assert.match(ui, /class="case-art"><img src="\$\{box\.art\}"/);
    assert.match(ui, /class="btn btn-primary btn-small case-select"/);
    const caseBranch = ui.slice(ui.indexOf("tab === 'cases'"), ui.indexOf("tab === 'inventory'"));
    assert.doesNotMatch(caseBranch, /case-drop-rates|drop\.name|drop\.chance/);
    for (const id of ['case-inspector', 'case-inspector-art', 'case-inspector-title', 'case-inspector-open', 'case-inspector-close']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(main, /const caseSelect = e\.target\.closest\('\.case-select'\)/);
    assert.match(main, /const caseOpen = e\.target\.closest\('#case-inspector-open'\)/);
});

test('inventory is standalone and collection layouts are spacious', () => {
    assert.doesNotMatch(html, /id="cosmetic-customizer"/);
    assert.match(css, /data-shop-tab="inventory"[\s\S]*?grid-template-columns: 1fr;/);
    assert.match(css, /\.inventory-card \{[\s\S]*?grid-template-columns: minmax\(150px, \.9fr\) minmax\(140px, 1fr\);/);
});

test('quick play, progression, and hero dashboards keep stable hooks', () => {
    for (const id of ['quick-play-queue', 'quick-play-mode', 'quick-play-map', 'btn-mp-quick']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    for (const id of ['hero-selected-name', 'achievement-unlocked-count', 'achievement-reward-total', 'challenge-complete-count']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(ui, /card\.className = `shop-card shop-skill-card/);
    assert.match(ui, /class="btn btn-secondary btn-small skill-equip"/);
    assert.match(main, /pickQuickLobby\(lobbies, \{ queue, mode, map, openOnly: true \}\)/);
    assert.match(main, /const skillEquip = e\.target\.closest\('\.skill-equip'\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('hidden-tab simulation advances player lifecycle before host updates', () => {
    const start = main.indexOf('\n    _bgTick(dt) {');
    const hiddenTick = main.slice(start, main.indexOf('\n    _bgProcessAttackQueue() {', start));
    assert.match(hiddenTick, /if \(document\.hidden\)[\s\S]*?this\.player\.update\(dt\)/);
    assert.ok(hiddenTick.indexOf('this.player.update(dt)') < hiddenTick.indexOf('this.game.update(dt)'));
    assert.match(main, /You were kicked from the lobby\./);
});

test('lobby uses vertical rosters with host drag and compact kick control', () => {
    assert.match(ui, /card\.draggable = !!isHost && !p\.isYou;/);
    assert.match(css, /#lobby-screen #cs-team-red,[\s\S]*?grid-template-columns: 1fr;/);
    assert.match(css, /#lobby-screen \.cs-btn-kick \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
    assert.match(ui, /aria-label="Kick \$\{this\.escapeHTML\(p\.name\)\}"/);
});
