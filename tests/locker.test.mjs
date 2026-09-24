// tests/locker.test.mjs — Locker overhaul: pure view helpers (js/locker.js), markup ids,
// the existing equip path, one shared 3D stage, EN/TR parity and responsive rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../js/locales/en.js';
import tr from '../js/locales/tr.js';
import { KNIVES } from '../js/cosmetics.js';
import { COSMETICS } from '../js/cosmetic-catalog.js';
import {
    LOCKER_FILTERS, LOCKER_SOURCE_TAB, buildLockerEntries, filterLockerEntries, sortLockerEntries, lockerCounts,
    normalizeLockerQuery, readKeySet, writeKeySet, seedSeenKeys, lockerInspectPlan, sampleLockerInspect, entryKey
} from '../js/locker.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const ui = read('../js/ui.js');
const main = read('../js/main.js');
const css = read('../css/locker.css');

const catalogs = {
    knives: {
        training: { id: 'training', name: 'Training Knife', rarity: 'common', model: 'classic', teams: ['red', 'blue'] },
        prism: { id: 'prism', name: 'Prism Breaker', rarity: 'epic', model: 'butterfly', teams: ['red', 'blue'] },
        tide: { id: 'tide', name: 'Tide Fang', rarity: 'legendary', model: 'karambit', teams: ['blue'] }
    },
    cosmetics: {
        gloves_ember: { id: 'gloves_ember', type: 'gloves', name: 'Ember Grips', rarity: 'rare' },
        gloves_void: { id: 'gloves_void', type: 'gloves', name: 'Void Wraps', rarity: 'legendary' },
        hat_crown: { id: 'hat_crown', type: 'hat', name: 'Çelik Taç', rarity: 'epic' }
    },
    balls: { classic: { name: 'Classic Volleyball' }, fire: { name: 'Fireball', rarity: 'rare' } },
    avatars: { default: { id: 'default', name: 'Default' }, samurai: { id: 'samurai', name: 'Cyber Samurai' } }
};
const state = {
    ownedKnives: ['training', 'tide', 'prism'],
    ownedCosmetics: ['gloves_ember'],
    ownedBalls: ['classic'],
    ownedAvatarSkins: ['default'],
    equippedKnives: { red: 'prism', blue: 'tide' },
    equippedWearables: { gloves: 'gloves_ember' },
    equippedBall: 'classic',
    equippedAvatar: 'default',
    seen: new Set(['knife:training', 'knife:tide', 'cosmetic:gloves_ember', 'ball:classic', 'avatar:default']),
    favorites: new Set(['cosmetic:gloves_void'])
};

test('Locker keeps every existing id and adds the stage, slot and toolbar ids', () => {
    for (const id of [
        'character-screen', 'character-locker-content', 'locker-tabs', 'locker-tab-loadout', 'locker-tab-inventory',
        'locker-tab-cards', 'locker-panel-loadout', 'locker-panel-inventory', 'locker-panel-cards', 'char-grid',
        'skill-grid', 'rune-grid', 'hero-selected-name', 'hero-selected-skill', 'hero-selected-rune',
        'locker-inventory-grid', 'locker-inventory-count', 'card-collection-grid', 'card-tradeup-select',
        'btn-card-tradeup', 'btn-char-back', 'btn-card-collection', 'btn-char-save',
        'locker-stage', 'locker-stage-mount', 'locker-stage-caption', 'btn-locker-inspect', 'btn-locker-reset',
        'locker-slots', 'locker-slot-hero', 'locker-slot-avatar', 'locker-slot-knife', 'locker-slot-gloves',
        'locker-slot-ball', 'locker-slot-wearable', 'locker-slot-ability', 'locker-slot-rune',
        'locker-filters', 'locker-search', 'locker-sort', 'locker-show-locked', 'locker-new-count'
    ]) assert.match(html, new RegExp(`id="${id}"`), `#${id}`);
    for (const filter of LOCKER_FILTERS) assert.match(html, new RegExp(`data-locker-filter="${filter}"`));
    // The stage sits between the tabs and the panels so it can serve Loadout and Inventory.
    const tabs = html.indexOf('id="locker-tabs"');
    const stage = html.indexOf('id="locker-stage"');
    const loadout = html.indexOf('id="locker-panel-loadout"');
    assert.ok(tabs < stage && stage < loadout);
    assert.doesNotMatch(html.slice(html.indexOf('<div id="character-screen"'), html.indexOf('<!-- ===== SHOP')), /data-i18n="locker\.kicker"|data-i18n="locker\.owned"/);
});

test('entries map every catalog item to a slot with ownership, equipped, NEW and favourite state', () => {
    const entries = buildLockerEntries(catalogs, state);
    assert.equal(entries.length, 3 + 3 + 2 + 2);
    const byKey = Object.fromEntries(entries.map(entry => [entry.key, entry]));
    assert.equal(byKey['cosmetic:gloves_ember'].slot, 'gloves');
    assert.equal(byKey['cosmetic:hat_crown'].slot, 'wearable');
    assert.equal(byKey['ball:fire'].slot, 'ball');
    assert.equal(byKey['ball:fire'].id, 'fire', 'ball ids come from catalog keys');
    assert.equal(byKey['knife:prism'].equipped, true);
    assert.equal(byKey['knife:tide'].equipped, true);
    assert.equal(byKey['knife:training'].equipped, false);
    assert.equal(byKey['knife:prism'].isNew, true, 'owned and never seen');
    assert.equal(byKey['knife:tide'].isNew, false);
    assert.equal(byKey['cosmetic:gloves_void'].owned, false);
    assert.equal(byKey['cosmetic:gloves_void'].isNew, false, 'locked items are never NEW');
    assert.equal(byKey['cosmetic:gloves_void'].favorite, true);
    assert.equal(byKey['knife:tide'].tier, 'S');
    assert.equal(entryKey('knife', 'tide'), 'knife:tide');
});

test('slot filters, search and the locked toggle narrow the grid', () => {
    const entries = buildLockerEntries(catalogs, state);
    const ids = list => list.map(entry => entry.id).sort();
    assert.deepEqual(ids(filterLockerEntries(entries, { filter: 'gloves' })), ['gloves_ember', 'gloves_void']);
    assert.deepEqual(ids(filterLockerEntries(entries, { filter: 'gloves', showLocked: false })), ['gloves_ember']);
    assert.deepEqual(ids(filterLockerEntries(entries, { filter: 'wearable' })), ['hat_crown']);
    assert.deepEqual(ids(filterLockerEntries(entries, { filter: 'knife', query: 'FANG' })), ['tide']);
    assert.deepEqual(ids(filterLockerEntries(entries, { query: 'celik tac' })), ['hat_crown'], 'accent-insensitive');
    assert.equal(filterLockerEntries(entries, { filter: 'bogus' }).length, entries.length, 'unknown filter = all');
    assert.equal(normalizeLockerQuery('  İSTANBUL  Işık '), 'istanbul isik');
});

test('sorting pins favourites, then owned items, then rarity / newest / name', () => {
    const entries = buildLockerEntries(catalogs, state).filter(entry => entry.group === 'knife' || entry.slot === 'gloves');
    const order = sort => sortLockerEntries(entries, sort).map(entry => entry.id);
    assert.deepEqual(order('rarity'), ['gloves_void', 'tide', 'prism', 'gloves_ember', 'training']);
    // Newest = latest acquisition within each owned list (ties fall back to rarity).
    assert.deepEqual(order('newest'), ['gloves_void', 'prism', 'tide', 'gloves_ember', 'training']);
    assert.deepEqual(order('name'), ['gloves_void', 'gloves_ember', 'prism', 'tide', 'training']);
    assert.deepEqual(order('nonsense'), order('rarity'));
});

test('owned counts per chip read "owned / total" and track NEW', () => {
    const counts = lockerCounts(buildLockerEntries(catalogs, state));
    assert.deepEqual(counts.all, { owned: 6, total: 10, fresh: 1 });
    assert.deepEqual(counts.knife, { owned: 3, total: 3, fresh: 1 });
    assert.deepEqual(counts.gloves, { owned: 1, total: 2, fresh: 0 });
    assert.deepEqual(counts.wearable, { owned: 0, total: 1, fresh: 0 });
    assert.equal(en.locker.ownedCount, '{owned} / {total}');
});

test('seen/favourite sets persist safely and the first visit seeds everything owned as seen', () => {
    const memory = new Map();
    const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
    assert.equal(readKeySet(storage, 'k'), null);
    assert.equal(writeKeySet(storage, 'k', new Set(['knife:tide'])), true);
    assert.deepEqual([...readKeySet(storage, 'k')], ['knife:tide']);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.equal(readKeySet(broken, 'k'), null);
    assert.equal(writeKeySet(broken, 'k', new Set()), false);
    memory.set('bad', '{nope');
    assert.equal(readKeySet(storage, 'bad'), null);
    const seeded = seedSeenKeys(null, buildLockerEntries(catalogs, { ...state, seen: new Set() }));
    assert.equal(seeded.size, 6);
    assert.equal(seeded.has('cosmetic:gloves_void'), false);
    const existing = new Set(['x']);
    assert.equal(seedSeenKeys(existing, []), existing);
});

test('locked items only link to where they are obtained; the Locker never sells', () => {
    assert.deepEqual({ ...LOCKER_SOURCE_TAB }, { knife: 'cases', gloves: 'wearables', wearable: 'wearables', ball: 'balls', avatar: 'avatars' });
    const block = ui.slice(ui.indexOf('    _lockerCard(entry'), ui.indexOf('    _syncShopTabs(tab) {'));
    assert.match(block, /class="btn btn-small locker-get" type="button" data-shop-tab=/);
    assert.doesNotMatch(block, /shop-buy|purchase|buyCosmetic|buyBall|\.buy\(/);
    const get = main.slice(main.indexOf("const get = target.closest('.locker-get')"), main.indexOf("if (target.closest('#btn-locker-inspect'))"));
    assert.match(get, /this\.ui\.renderShop\(this\.store, tab\)/);
    assert.match(get, /this\.ui\.showScreen\('shop'\)/);
    assert.doesNotMatch(get, /purchase|openCase|buy/i);
});

test('equip reuses the existing Store paths and confirms with the equip cue and a pop', () => {
    const card = ui.slice(ui.indexOf('    _lockerCard(entry'), ui.indexOf('    renderLockerInventory(store) {'));
    assert.match(card, /knife-equip locker-equip" type="button" data-id="\$\{item\.id\}" data-team="both"/);
    for (const type of ['cosmetic', 'ball', 'avatar']) {
        assert.match(card, new RegExp(`shop-equip locker-equip" type="button" data-type="${type}"`));
    }
    const knife = main.slice(main.indexOf("const knifeBtn = e.target.closest('.knife-equip')"), main.indexOf("const replayButton"));
    assert.match(knife, /knifeBtn\.dataset\.team === 'both'[\s\S]*?KNIVES\[knifeBtn\.dataset\.id\]\?\.teams/);
    assert.match(knife, /teams\.filter\(team => this\.store\.equipKnife\(knifeBtn\.dataset\.id, team\)\)/);
    assert.match(knife, /this\._confirmLockerEquip\('knife', knifeBtn\.dataset\.id, \{ sound: false \}\)/);
    const shopEquip = main.slice(main.indexOf("const equipBtn = e.target.closest('.shop-equip')"), main.indexOf("const ballInspect"));
    for (const call of ['this.store.equipCosmetic(', 'this.store.equipAvatarSkin(', 'this.store.equipBall(']) assert.ok(shopEquip.includes(call), call);
    assert.match(shopEquip, /if \(equippedForAnalytics\) this\._confirmLockerEquip\(itemType, ballId\)/);
    const confirm = main.slice(main.indexOf('    _confirmLockerEquip('), main.indexOf('    _handleLockerClick('));
    assert.match(confirm, /this\.audio\?\.playCue\?\.\('equip-change'\)/);
    assert.match(confirm, /this\.ui\.flashLockerEquip\?\.\(/);
    assert.match(css, /\.locker-card\.just-equipped,\s*\.locker-slot\.just-equipped \{ animation: lockerPop/);
    // The knife in the case (tide is blue-only) still equips only where allowed.
    assert.deepEqual(KNIVES.tide?.teams || ['blue'], ['blue']);
});

test('one shared 3D stage: the menu hero canvas moves into the Locker and pauses when hidden', () => {
    assert.equal((main.match(/new ShopShowcaseRenderer\(/g) || []).length, 3, 'no new renderer for the Locker');
    const place = main.slice(main.indexOf('    _placeMenuHero(screen) {'), main.indexOf('    _lockerStageVisible() {'));
    assert.match(place, /document\.getElementById\(locker \? 'locker-stage-mount' : 'menu-hero-stage'\)/);
    assert.match(place, /target\.appendChild\(canvas\)/);
    assert.match(place, /hero\.setAutoRotate\(!locker\)/);
    const listener = main.slice(main.indexOf('    _initMenuHero() {'), main.indexOf('    _placeMenuHero(screen) {'));
    assert.match(listener, /screen === 'mainMenu' \|\| screen === 'character'/);
    assert.match(listener, /this\.menuHero\.stop\(\);/);
    const running = main.slice(main.indexOf('    _syncLockerStageRunning(tab) {'), main.indexOf('    _syncLockerStageRunning(tab) {') + 400);
    assert.match(running, /if \(tab === 'cards'\) this\.menuHero\.stop\(\);/);
    assert.match(main, /this\._syncLockerStageRunning\(tab\);/);
});

test('inspect plays the viewmodel knife tracks (inspect then twirl), or one turn without a knife', () => {
    const rare = lockerInspectPlan({ knifeId: 'tide', rarity: 'legendary' });
    assert.deepEqual(rare.map(step => [step.action, step.variant]), [['inspect', 'rare'], ['twirl', 'default']]);
    const plain = lockerInspectPlan({ knifeId: 'prism', rarity: 'epic' });
    assert.equal(plain[0].variant, 'default');
    assert.deepEqual(lockerInspectPlan({ knifeId: 'training' }).map(step => step.action), ['spin']);
    assert.equal(sampleLockerInspect(plain, 0).step.action, 'inspect');
    const mid = sampleLockerInspect(plain, plain[0].duration + plain[1].duration / 2);
    assert.equal(mid.step.action, 'twirl');
    assert.ok(Math.abs(mid.progress - .5) < 1e-9);
    assert.equal(sampleLockerInspect(plain, 99), null);
    const step = main.slice(main.indexOf('    _stepLockerInspect('), main.indexOf('    _confirmLockerEquip('));
    assert.match(step, /sampleKnifeTrack\(track, sample\.progress, state\.buffer\)/);
    assert.match(step, /KNIFE_TRACKS\.twirl/);
    assert.match(step, /KNIFE_TRACKS\.inspectRare/);
    assert.match(step, /if \(reducedMotion\) \{/, 'reduced motion holds a static presented frame');
    assert.match(main, /this\.audio\?\.playCue\?\.\('knife-inspect'\)/);
});

test('keyboard: arrow keys move between tiles and every Locker control shows focus', () => {
    const bind = main.slice(main.indexOf('    _bindLockerControls() {'));
    assert.match(bind, /ArrowRight: 1, ArrowLeft: -1/);
    assert.match(bind, /gridTemplateColumns\.split\(' '\)/);
    assert.match(bind, /next\.querySelector\('\.locker-preview'\)\?\.focus\?\.\(\)/);
    assert.match(css, /#character-screen :is\(\.locker-slot, \.locker-filter, \.locker-preview, \.locker-fav, \.locker-equip, \.locker-get, \.locker-stage-btn, \.locker-stage-reset, #locker-sort, #locker-show-locked\):focus-visible/);
});

test('EN/TR Locker strings keep parity and placeholders', () => {
    const enKeys = Object.keys(en.locker).sort();
    assert.deepEqual(Object.keys(tr.locker).sort(), enKeys);
    for (const key of enKeys) {
        const params = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
        assert.equal(params(tr.locker[key]), params(en.locker[key]), `locker.${key} placeholders`);
    }
    for (const key of ['inspect', 'dragHint', 'equip', 'equipped', 'new', 'getInShop', 'openCase', 'search', 'sortRarity', 'sortNewest', 'sortName', 'showLocked', 'ownedOf']) {
        assert.ok(en.locker[key] && tr.locker[key] && en.locker[key] !== tr.locker[key] || key === 'ownedCount', `locker.${key}`);
    }
    assert.equal(en.locker.kicker, undefined, 'unused kicker removed');
    assert.equal(en.locker.owned, undefined, 'unused kicker removed');
});

test('responsive + reduced motion: phone stacks stage over content; motion switches off', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 700px)'));
    assert.match(phone, /grid-template-areas: "head" "tabs" "stage" "panel" "actions";/);
    assert.match(phone, /#character-screen \.locker-inventory-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(phone, /overflow-x: hidden;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*#character-screen \*, #character-screen \*::before, #character-screen \*::after \{ animation: none !important;/);
    assert.match(css, /:is\(\.reduced-motion, \.reduce-motion\) #character-screen \*/);
    assert.match(css, /content-visibility: auto;/, 'long grids skip offscreen rendering');
});

test('catalog smoke: real catalogs build without throwing and gloves stay a separate slot', () => {
    const entries = buildLockerEntries({ knives: KNIVES, cosmetics: COSMETICS, balls: {}, avatars: {} }, { ownedKnives: ['training'] });
    const counts = lockerCounts(entries);
    assert.equal(counts.knife.total, Object.keys(KNIVES).length);
    assert.equal(counts.gloves.total, Object.values(COSMETICS).filter(item => item.type === 'gloves').length);
    assert.equal(counts.wearable.total, Object.values(COSMETICS).filter(item => item.type !== 'gloves').length);
    assert.equal(counts.knife.owned, 1);
});
