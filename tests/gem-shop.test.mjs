import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const memory = new Map();
globalThis.localStorage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    clear: () => memory.clear()
};

const {
    GEM_LEGAL_COPY, awaitGemCredit, buildGemShop, formatPackPrice, gemShopView, isTrustedCheckoutUrl,
    readPurchaseReturn, rememberGemsBeforeCheckout, stripPurchaseParams, takeGemsBeforeCheckout
} = await import('../js/gem-shop.js');
const { Store } = await import('../js/store.js');

const CATALOG = {
    enabled: true,
    packs: [
        { id: 'gems_100', label: '100 Gems', gems: 100, amountMinor: 199, currency: 'USD', bonusPct: 0, bestValue: false },
        { id: 'gems_550', label: '550 Gems', gems: 550, amountMinor: 899, currency: 'USD', bonusPct: 22, bestValue: false },
        { id: 'gems_1200', label: '1,200 Gems', gems: 1200, amountMinor: 1699, currency: 'USD', bonusPct: 41, bestValue: true }
    ],
    gemPrices: { battlepass_premium: 500 }
};

// Minimal DOM: enough for buildGemShop's createElement/append/textContent use.
function fakeDocument() {
    const make = tag => ({
        tagName: tag.toUpperCase(), className: '', textContent: '', dataset: {}, attributes: {}, children: [], disabled: false, type: '',
        get lastChild() { return this.children[this.children.length - 1]; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { nodes.forEach(node => this.children.push(node)); }
    });
    return { createElement: make, createTextNode: text => ({ textContent: text, children: [], className: '' }) };
}
function walk(node, out = []) { out.push(node); (node.children || []).forEach(child => walk(child, out)); return out; }
const byClass = (root, name) => walk(root).filter(node => String(node.className).split(' ').includes(name));
const allText = root => walk(root).map(node => node.textContent).join(' | ');

test('prices always show the currency; bonus and best-value labels come from the server catalog', () => {
    assert.match(formatPackPrice(199, 'USD'), /^USD\s1\.99$/);
    assert.match(formatPackPrice(1699, 'EUR'), /EUR/);
    const view = gemShopView(CATALOG, { gems: 40 });
    assert.deepEqual(view.packs.map(pack => pack.bonusLabel), ['', '+22% bonus', '+41% bonus']);
    assert.deepEqual(view.packs.filter(pack => pack.bestValue).map(pack => pack.id), ['gems_1200']);
    assert.equal(view.battlepass.shortfall, 460);
    assert.equal(gemShopView(null).loading, true);
});

test('enabled catalog renders buy buttons, legal copy and a gem-priced battle pass', () => {
    const root = buildGemShop(fakeDocument(), gemShopView(CATALOG, { gems: 600 }));
    const buys = byClass(root, 'gem-pack-buy');
    assert.deepEqual(buys.map(button => button.dataset.packId), ['gems_100', 'gems_550', 'gems_1200']);
    assert.ok(buys.every(button => /USD/.test(button.textContent)), 'buy labels include the currency');
    assert.ok(buys.every(button => button.dataset.guestReason), 'guest prompt copy is provided');
    assert.equal(byClass(root, 'gem-pack-tag').length, 1);
    const bp = byClass(root, 'gem-bp-buy')[0];
    assert.equal(bp.disabled, false);
    assert.match(bp.textContent, /500 gems/);
    const text = allText(root);
    assert.ok(text.includes(GEM_LEGAL_COPY.final));
    assert.match(text, /gems cannot be used to open cases/i);
    assert.match(text, /18 or older/);
    assert.match(text, /Terms of Sale/);
    assert.match(text, /Privacy Policy/);
});

test('disabled payments show Coming soon and no buy button', () => {
    const root = buildGemShop(fakeDocument(), gemShopView({ ...CATALOG, enabled: false }, { gems: 0 }));
    assert.equal(byClass(root, 'gem-pack-buy').length, 0);
    assert.equal(byClass(root, 'gem-pack-soon').length, 3);
    assert.match(allText(root), /Coming soon/);
    assert.equal(byClass(root, 'gem-bp-buy')[0].disabled, true, 'not enough gems');
});

test('checkout redirects are limited to Stripe-hosted https pages', () => {
    assert.equal(isTrustedCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1'), true);
    assert.equal(isTrustedCheckoutUrl('http://checkout.stripe.com/c/pay/cs_test_1'), false);
    assert.equal(isTrustedCheckoutUrl('https://checkout.stripe.com.evil.example/'), false);
    assert.equal(isTrustedCheckoutUrl('javascript:alert(1)'), false);
});

test('purchase return params are read once and stripped from the address bar', async () => {
    assert.equal(readPurchaseReturn('?purchase=success&session_id=cs_1'), 'success');
    assert.equal(readPurchaseReturn('?purchase=cancel'), 'cancel');
    assert.equal(readPurchaseReturn('?purchase=hack'), '');
    assert.equal(stripPurchaseParams('https://volle.example/?purchase=success&session_id=cs_1&debug'), '/?debug');
    const session = new Map();
    const storage = { getItem: k => session.get(k) ?? null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) };
    rememberGemsBeforeCheckout(120, storage);
    assert.equal(takeGemsBeforeCheckout(storage), 120);
    assert.equal(takeGemsBeforeCheckout(storage), null, 'consumed');

    let gems = 120;
    let refreshes = 0;
    const credited = await awaitGemCredit({
        before: 120, delays: [0, 1, 1], sleep: async () => {},
        refresh: async () => { refreshes += 1; if (refreshes === 2) gems = 670; },
        readGems: () => gems
    });
    assert.equal(credited, 550);
    assert.equal(refreshes, 2);
    assert.equal(await awaitGemCredit({ before: 5, delays: [0, 1], sleep: async () => {}, refresh: async () => {}, readGems: () => 5 }), 0);
});

test('store checkout posts only a pack id and rejects non-Stripe redirect URLs', async t => {
    const realFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = realFetch; Store.remoteReady = false; });
    Store.remoteReady = true;
    Store.sessionToken = 's'.repeat(40);
    const calls = [];
    let reply = { url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ok = await Store.startGemCheckout('gems_550');
    assert.deepEqual(ok, { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    assert.equal(calls[0].url, '/api/payments/checkout');
    assert.match(calls[0].init.headers['Idempotency-Key'], /^checkout:/);
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['packId', 'requestId']);
    reply = { url: 'https://evil.example/pay' };
    assert.equal((await Store.startGemCheckout('gems_550')).ok, false);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'payments unavailable' }), { status: 503 });
    assert.match((await Store.startGemCheckout('gems_550')).error, /coming soon/i);
});

test('guest gate covers gem buttons and the Gems tab exists in the shop', () => {
    const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    const selector = main.slice(main.indexOf('const GUEST_GATED_SELECTOR'), main.indexOf("].join(', ')"));
    assert.match(selector, /'\.gem-pack-buy'/);
    assert.match(selector, /'\.gem-bp-buy'/);
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="shop-tab-gems"[^>]*data-tab="gems"/);
    assert.match(html, /id="shop-gems"/);
});
