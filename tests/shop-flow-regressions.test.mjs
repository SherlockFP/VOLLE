import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { COSMETICS } from '../js/cosmetic-catalog.js';
import { SHOP_COLLECTIONS, shopCollectionForItem, matchesShopQuery, deriveShopCardState } from '../js/shop-clarity.js';

const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
function method(source, name, globals) {
    const start = new RegExp(`^    (?:async )?${name}\\(`, 'm').exec(source);
    assert.ok(start, `Missing method ${name}`);
    const remainder = source.slice(start.index + start[0].length);
    const next = /\r?\n    (?:async )?[A-Za-z_$][\w$]*\(/.exec(remainder);
    assert.ok(next, `Missing next method after ${name}`);
    const body = source.slice(start.index, start.index + start[0].length + next.index);
    return runInNewContext(`({${body}\n}).${name}`, globals);
}

test('new collections contain four distinct products each and combine with slot/search filters', () => {
    const fresh = SHOP_COLLECTIONS.filter(entry => entry.isNew);
    assert.equal(fresh.length, 2);
    for (const collection of fresh) {
        const entries = Object.values(COSMETICS).filter(item => shopCollectionForItem(item)?.id === collection.id);
        assert.equal(entries.length, 4);
        assert.equal(new Set(entries.map(item => item.id)).size, 4);
        for (const item of entries) {
            const card = { ...item, category: item.type, collection: collection.id };
            assert.equal(matchesShopQuery(card, { collection: collection.id, slot: item.type, query: collection.label }), true);
            assert.equal(matchesShopQuery(card, { collection: fresh.find(entry => entry.id !== collection.id).id }), false);
        }
    }
    assert.equal(shopCollectionForItem({ name: 'Unrelated Hat' }), null);
});

test('selected product affordability is truthful and accessible labels change with the item', () => {
    const action = { textContent: 'Buy Visor — 240', attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
    const nodes = {
        'shop-selected-action': action,
        'shop-selected-description': {},
        'shop-selected-balance': { dataset: {} },
        'shop-preview-controls': {}
    };
    const document = { getElementById: id => nodes[id], querySelector: () => null };
    const setCopy = method(uiSource, '_setShopProductCopy', { document, deriveShopCardState });
    const store = { get: () => 100 };
    setCopy(store, { price: 240, description: 'Broad brim', type: 'character' });
    assert.equal(action.disabled, true);
    assert.match(nodes['shop-selected-balance'].textContent, /Need 140 more/);
    assert.equal(nodes['shop-selected-description'].textContent, 'Broad brim');
    action.textContent = 'Equip Satellite';
    setCopy(store, { price: 420, owned: true, type: 'ball' });
    assert.equal(action.disabled, false, 'owned items can be equipped even with a low balance');
    assert.equal(action.attributes['aria-label'], 'Equip Satellite');
    assert.equal(action.title, '', 'an earlier shortfall tooltip must not leak to an owned item');
    assert.equal(nodes['shop-preview-controls'].hidden, true);
    setCopy(store, { price: 420, owned: true, equipped: true });
    assert.equal(action.disabled, true);
    assert.equal(nodes['shop-preview-controls'].hidden, false);
});

function purchaseFixture(purchase) {
    const classes = new Set(['shop-buy']);
    const button = {
        disabled: false, dataset: { type: 'cosmetic', id: 'hat_court_carnival_visor' },
        classList: { contains: name => classes.has(name) },
        setAttribute() {}, removeAttribute() {},
        closest(selector) { return classes.has(selector.slice(1)) ? this : null; }
    };
    let equips = 0;
    let renders = 0;
    const document = {
        body: { dataset: { screen: 'shop' } },
        querySelector: () => ({ dataset: { tab: 'wearables' } })
    };
    const app = {
        store: { purchase, equipCosmetic() { equips++; return true; } },
        ui: { showMessage() {}, renderShop() { renders++; classes.delete('shop-buy'); classes.add('shop-equip'); } },
        productAnalytics: { track() {} },
        refreshMetaStats() {}, _syncWearableLoadout: async () => {}
    };
    const start = mainSource.indexOf('            const buyBtn =');
    const end = mainSource.indexOf('            // Battlepass claim', start);
    const handler = runInNewContext(`(async function(e) { ${mainSource.slice(start, end)} })`, { document, COSMETICS, AVATAR_SKINS: {}, CHARACTERS: {} });
    return { app, button, document, click: () => handler.call(app, { target: button }), equips: () => equips, renders: () => renders };
}

test('one purchase click never falls through into Equip after the selected action changes class', async () => {
    const fixture = purchaseFixture(async () => true);
    await fixture.click();
    assert.equal(fixture.renders(), 1);
    assert.equal(fixture.equips(), 0);
    assert.equal(fixture.app._shopPurchaseInFlight, false);
});

test('rapid purchase clicks submit once and always release the pending guard', async () => {
    let resolve;
    let calls = 0;
    const response = new Promise(done => { resolve = done; });
    const fixture = purchaseFixture(() => { calls++; return response; });
    const pending = fixture.click();
    await fixture.click();
    assert.equal(calls, 1);
    resolve(false);
    await pending;
    assert.equal(fixture.app._shopPurchaseInFlight, false);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.equips(), 0);
});

test('finishing a purchase after leaving the shop does not rebuild its preview', async () => {
    let resolve;
    const fixture = purchaseFixture(() => new Promise(done => { resolve = done; }));
    const pending = fixture.click();
    fixture.document.body.dataset.screen = 'mainMenu';
    resolve(true);
    await pending;
    assert.equal(fixture.renders(), 0);
    assert.equal(fixture.equips(), 0);
});

test('a late live-market response cannot steal another category or reopen a closed shop', async () => {
    for (const state of [{ screen: 'shop', tab: 'balls' }, { screen: 'mainMenu', tab: 'live' }]) {
        let resolve;
        let renders = 0;
        const tab = { dataset: { tab: 'live' } };
        const document = { body: { dataset: { screen: 'shop' } }, querySelector: selector => selector === '.shop-live-retry' ? null : tab };
        const refresh = method(mainSource, '_refreshShopLiveMarket', { document });
        const app = { store: { refreshLiveMarket: () => new Promise(done => { resolve = done; }) }, ui: { renderShop: () => renders++ } };
        const pending = refresh.call(app);
        document.body.dataset.screen = state.screen;
        tab.dataset.tab = state.tab;
        resolve(true);
        assert.equal(await pending, true);
        assert.equal(renders, 0);
    }
});

test('failed live-market refresh rebuilds the recoverable empty state in the active category', async () => {
    let renders = 0;
    const document = { body: { dataset: { screen: 'shop' } }, querySelector: selector => selector === '.shop-live-retry' ? null : { dataset: { tab: 'live' } } };
    const refresh = method(mainSource, '_refreshShopLiveMarket', { document });
    const app = { store: { refreshLiveMarket: async () => false }, ui: { renderShop: () => renders++ } };
    assert.equal(await refresh.call(app), false);
    assert.equal(renders, 1);
});

test('delayed equipment removal keeps the new category and never redraws a closed shop', async () => {
    const start = mainSource.indexOf('            const cosmeticClear =');
    const end = mainSource.indexOf('            const wearableInspect =', start);
    for (const screen of ['shop', 'mainMenu']) {
        let resolve;
        let removed;
        const renders = [];
        const tab = { dataset: { tab: 'wearables' } };
        const document = { body: { dataset: { screen: 'shop' } }, querySelector: () => tab };
        const handler = runInNewContext(`(async function(e) { ${mainSource.slice(start, end)} })`, { document });
        const app = {
            store: { clearCosmeticSlot: slot => { removed = slot; } },
            _syncWearableLoadout: () => new Promise(done => { resolve = done; }),
            ui: { renderShop: (store, category) => renders.push(category), showMessage() {} }
        };
        const pending = handler.call(app, { target: { closest: () => ({ dataset: { type: 'hat' } }) } });
        tab.dataset.tab = 'balls';
        document.body.dataset.screen = screen;
        resolve(true);
        await pending;
        assert.equal(removed, 'hat');
        assert.deepEqual(renders, screen === 'shop' ? ['balls'] : []);
    }
});

test('delayed equip updates ownership without rebuilding a shop left during the request', async () => {
    let resolve;
    const fixture = purchaseFixture(async () => false);
    fixture.button.closest = selector => selector === '.shop-equip' ? fixture.button : null;
    fixture.app._syncWearableLoadout = () => new Promise(done => { resolve = done; });
    const pending = fixture.click();
    fixture.document.body.dataset.screen = 'mainMenu';
    resolve(true);
    await pending;
    assert.equal(fixture.equips(), 1);
    assert.equal(fixture.renders(), 0);
});
