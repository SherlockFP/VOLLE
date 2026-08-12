import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const ui = read('../js/ui.js');
const main = read('../js/main.js');
const css = read('../css/polish.css');

test('Locker owns Loadout, Inventory and Cards while Shop has no inventory tab', () => {
    for (const tab of ['loadout', 'inventory', 'cards']) {
        assert.match(html, new RegExp(`data-locker-tab="${tab}"`));
        assert.match(html, new RegExp(`data-locker-panel="${tab}"`));
    }
    assert.doesNotMatch(html, /id="shop-tab-inventory"/);
    assert.match(ui, /renderLockerInventory\(store\)/);
    for (const ownership of ['ownedKnives', 'ownedCosmetics', 'ownedBalls', 'ownedAvatarSkins']) {
        assert.ok(ui.includes(`store.get('${ownership}')`), `${ownership} must be represented in Locker`);
    }
});

test('Locker roster uses generated portraits and inventory never offers a purchase CTA', () => {
    const roster = ui.slice(ui.indexOf('renderCharacterSelect(store)'), ui.indexOf('setLockerTab('));
    assert.match(roster, /characterPortraitPath\(c\.id\)/);
    const inventory = ui.slice(ui.indexOf('renderLockerInventory(store)'), ui.indexOf('_syncShopTabs('));
    assert.doesNotMatch(inventory, /shop-buy|Buy —|purchase/);
    assert.match(inventory, /knife-inspect/);
    assert.match(inventory, /wearable-inspect/);
    assert.match(inventory, /data-type="ball"/);
    assert.match(inventory, /data-type="avatar"/);
});

test('wearable inspect previews a temporary loadout without mutating Store', () => {
    const previewStart = main.indexOf("detail?.type === 'cosmetic'");
    const previewEnd = main.indexOf("        }, { signal: this._mainAbort.signal });", previewStart);
    const preview = main.slice(previewStart, previewEnd);
    const applyStart = main.indexOf('_applyShopShowcaseCosmetics(loadout');
    const apply = main.slice(applyStart, main.indexOf('async _equipCaseReward', applyStart));
    assert.match(preview, /\{ \.\.\.equipped, \[cosmetic\.type\]: cosmetic\.id \}/);
    assert.match(apply, /applyEntityCosmetics\(avatar, loadout\)/);
    assert.match(apply, /updateEntityCosmetics\(avatar, seconds\)/);
    assert.doesNotMatch(preview, /store\.(?:set|equipCosmetic)\(/);
    assert.match(apply, /\['cape', 'wings', 'backpack', 'banner'\]/);
});

test('case result is persistent and actions remain behind one settlement gate', () => {
    for (const id of ['case-reel-inspect', 'case-reel-equip', 'case-reel-open-another', 'case-reel-close']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    const reelStart = ui.indexOf('showCaseReel(');
    const reel = ui.slice(reelStart, ui.indexOf('\n    _scheduleReelTicks(', reelStart));
    assert.match(reel, /this\._caseReelGeneration !== generation/);
    assert.match(reel, /actions\?\.classList\.remove\('hidden'\)/);
    assert.doesNotMatch(reel, /setTimeout\(\(\) => overlay\.classList\.add\('hidden'\)/);
    assert.match(reel, /onOpenAnother\?\.\(box, result\)/);
    assert.match(reel, /onEquip\?\.\(result\)/);
    assert.match(reel, /result\.reward\.type === 'knife' \? 'Manage in Locker' : 'Equip'/);
    assert.match(reel, /if \(result\.reward\.type === 'knife'\)[\s\S]*?onInspect\?\.\(result\)/);
    assert.match(reel, /if \(event\.key === 'Escape'\)[\s\S]*?if \(settled\) closeReel\(true\);[\s\S]*?else settleImmediately\(\)/);
    assert.match(reel, /event\.key !== 'Tab'[\s\S]*?button:not\(\[hidden\]\):not\(\[disabled\]\)/);
    assert.match(reel, /overlay\.removeEventListener\('keydown', onKeyDown\)/);
    assert.match(reel, /requestAnimationFrame\(\(\) => \{\s*if \(this\._caseReelGeneration !== generation\) return;/);
    assert.match(reel, /getReturnFocus = \(\) => document\.querySelector\(`\.case-select/);
    assert.doesNotMatch(reel, /document\.activeElement instanceof HTMLElement/);
});

test('Shop has no dead legacy inventory renderer', () => {
    assert.doesNotMatch(ui, /legacy-inventory|tab === 'inventory'/);
});

test('case Open another starts one direct remote/fallback opening without a second confirm', () => {
    const present = main.slice(main.indexOf('_presentCaseResult('), main.indexOf('_showCaseOpenError(', main.indexOf('_presentCaseResult(')));
    const open = main.slice(main.indexOf('async _openShopCase('), main.indexOf('async _equipCaseReward', main.indexOf('async _openShopCase(')));
    assert.match(present, /onOpenAnother: \(\) => \{\s*void this\._openShopCase\(box\)/);
    assert.match(open, /if \(!box \|\| this\._caseOpenInFlight\) return false/);
    assert.match(open, /openCaseRemote\(box\.id\)/);
    assert.match(open, /!result && !this\.store\.remoteReady[\s\S]*?openCase\(box\.id\)/);
    assert.match(open, /!earned && balance < box\.price[\s\S]*?_showCaseOpenError/);
    assert.doesNotMatch(present, /case-select|case-inspector-open|\.click\(\)/);
});

test('wearable live preview owns readable showcase, selected state and item-bound CTA', () => {
    const cosmetic = ui.slice(ui.indexOf('_setShopCosmeticShowcase('), ui.indexOf('_resetShopCosmeticShowcase('));
    assert.match(cosmetic, /name\.textContent = item\.name/);
    assert.match(cosmetic, /status\.textContent = `\$\{item\.name\} · Preview`/);
    assert.match(cosmetic, /action\.dataset\.id = item\.id/);
    assert.match(cosmetic, /aria-pressed/);
    assert.match(cosmetic, /is-previewing/);
    assert.match(main, /this\.ui\._setShopCosmeticShowcase\?\.\(this\.store, cosmetic, true\)/);
    assert.match(main, /shop-preview-reset[\s\S]*?this\.ui\._resetShopCosmeticShowcase/);
    assert.doesNotMatch(cosmetic, /store\.(?:set|equipCosmetic)\(/);
});

test('Locker Inventory copy has explicit high-contrast name and metadata hierarchy', () => {
    assert.match(css, /\.locker-inventory-grid \.inventory-card-copy \.char-name \{ color: #f3ffff;[\s\S]*?font-weight: 900/);
    assert.match(css, /\.locker-inventory-grid \.inventory-card-copy \.char-desc \{ color: #b8dce2;[\s\S]*?font-weight: 700/);
});

test('avatar equip validates catalog and ownership before preview or success copy', () => {
    const start = main.indexOf("equipBtn.dataset.type === 'avatar'");
    const branch = main.slice(start, main.indexOf("equipBtn.dataset.type === 'char'", start));
    assert.match(branch, /const avatarSkin = AVATAR_SKINS\[ballId\]/);
    assert.match(branch, /Boolean\(avatarSkin\) && this\.store\.equipAvatarSkin\(ballId\)/);
    assert.match(branch, /if \(equippedForAnalytics\)[\s\S]*?applyPreset\(ballId\)/);
    assert.match(branch, /equippedForAnalytics \? `🎨 Equipped:/);
});

test('375 layout keeps two inventory columns and unclipped left-aligned main nav', () => {
    assert.match(css, /\.locker-inventory-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 16px; \}/);
    assert.match(css, /#main-menu \.ow-topbar \{ order: 0; max-height: none;[\s\S]*?overflow: visible; \}/);
    assert.match(css, /#main-menu \.ow-tabs \{ order: 3;[\s\S]*?justify-content: flex-start;[\s\S]*?overflow-x: auto;/);
    assert.match(css, /#main-menu \.ow-tab \{ min-width: max-content; min-height: 44px; height: 44px;/);
});
