const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-stripe-http-'));
process.env.DATA_DIR = dataDir;
for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PUBLIC_BASE_URL']) delete process.env[key];
const { server, accounts } = require('../server.js');
const {
    createCheckoutSession,
    formEncode,
    normalizeBaseUrl,
    paymentEventFromStripe,
    readRawBody,
    signStripePayload,
    stripeConfig,
    verifyStripeSignature
} = require('../server/stripe');
const { publicPackCatalog, PREMIUM_PACKS } = require('../server/payment-ledger');

const WEBHOOK_SECRET = 'whsec_test_0123456789abcdefghijklmnop';
const realFetch = globalThis.fetch;
let baseUrl;
let stripeCalls = [];

// Only api.stripe.com is mocked; requests to the local test server pass through.
globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://api.stripe.com/')) {
        stripeCalls.push({ url: String(url), init });
        return new Response(JSON.stringify({
            id: 'cs_test_a1b2c3d4e5f6g7h8',
            object: 'checkout.session',
            url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, init);
};

async function api(pathname, { token = '', method = 'GET', body, headers = {} } = {}) {
    const allHeaders = { ...headers };
    if (token) allHeaders.Authorization = `Bearer ${token}`;
    if (body !== undefined && !allHeaders['Content-Type']) allHeaders['Content-Type'] = 'application/json';
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const response = await realFetch(baseUrl + pathname, { method, headers: allHeaders, body: payload });
    return { status: response.status, body: await response.json() };
}

function sessionEvent(profileId, overrides = {}, sessionOverrides = {}) {
    return {
        id: 'evt_test_completed_0001',
        object: 'event',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        data: {
            object: {
                id: 'cs_test_a1b2c3d4e5f6g7h8',
                object: 'checkout.session',
                mode: 'payment',
                payment_status: 'paid',
                amount_subtotal: 899,
                amount_total: 899,
                currency: 'usd',
                client_reference_id: profileId,
                metadata: { app: 'volle', packId: 'gems_550', profileId, accountId: 'acct', requestId: 'checkout:req-1' },
                ...sessionOverrides
            }
        },
        ...overrides
    };
}

function postWebhook(event, { secret = WEBHOOK_SECRET, timestamp, tamper } = {}) {
    const raw = JSON.stringify(event);
    const header = signStripePayload(secret, raw, timestamp);
    return api('/api/payments/stripe/webhook', {
        method: 'POST',
        body: tamper ? tamper(raw) : raw,
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }
    });
}

let alice;
function gemsOf(sessionToken) { return accounts.resolveSession(sessionToken).profile.gems; }

test.before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    alice = (await api('/api/account/register', {
        method: 'POST', body: { username: 'GemBuyer', email: 'gembuyer@example.com', password: 'hunter22' }
    })).body;
    assert.ok(alice.sessionToken, 'test account registered');
});

test.after(async () => {
    globalThis.fetch = realFetch;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Stripe signature verification accepts valid, rejects tampered/expired/wrong-secret/malformed', () => {
    const raw = '{"id":"evt_1","type":"checkout.session.completed"}';
    const now = 1_800_000_000;
    const header = signStripePayload(WEBHOOK_SECRET, raw, now);
    assert.equal(verifyStripeSignature(raw, header, WEBHOOK_SECRET, { nowSeconds: now + 10 }).ok, true);
    assert.equal(verifyStripeSignature(Buffer.from(raw), header, WEBHOOK_SECRET, { nowSeconds: now }).ok, true, 'raw Buffer body');
    assert.equal(verifyStripeSignature(raw.replace('evt_1', 'evt_2'), header, WEBHOOK_SECRET, { nowSeconds: now }).reason, 'signature mismatch');
    assert.equal(verifyStripeSignature(raw, header, WEBHOOK_SECRET, { nowSeconds: now + 301 }).reason, 'timestamp outside tolerance');
    assert.equal(verifyStripeSignature(raw, header, WEBHOOK_SECRET, { nowSeconds: now - 301 }).reason, 'timestamp outside tolerance');
    assert.equal(verifyStripeSignature(raw, header, 'whsec_other_secret_value_000000', { nowSeconds: now }).ok, false);
    assert.equal(verifyStripeSignature(raw, '', WEBHOOK_SECRET).reason, 'missing signature');
    assert.equal(verifyStripeSignature(raw, 't=abc,v1=zz', WEBHOOK_SECRET).reason, 'malformed signature');
    // Stripe may send several v1 values during secret rotation; any match passes.
    const rotated = `t=${now},v1=${'0'.repeat(64)},${header.split(',')[1]},v0=legacy`;
    assert.equal(verifyStripeSignature(raw, rotated, WEBHOOK_SECRET, { nowSeconds: now }).ok, true);
});

test('raw body reader keeps exact bytes and rejects oversized payloads', async () => {
    const bytes = Buffer.from('{"a": 1,\n "b":"ü"}');
    assert.deepEqual(await readRawBody(Readable.from([bytes.subarray(0, 5), bytes.subarray(5)])), bytes);
    assert.equal(await readRawBody(Readable.from([Buffer.alloc(20)]), 10), null);
});

test('config gates checkout on key + base URL and form encoding matches Stripe nesting', () => {
    assert.equal(stripeConfig({}).checkoutEnabled, false);
    assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc' }).checkoutEnabled, false, 'needs PUBLIC_BASE_URL');
    assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', PUBLIC_BASE_URL: 'https://volle.example/' }).checkoutEnabled, true);
    assert.equal(stripeConfig({ STRIPE_SECRET_KEY: 'pk_test_abc', PUBLIC_BASE_URL: 'https://volle.example' }).checkoutEnabled, false, 'publishable key is rejected');
    assert.equal(normalizeBaseUrl('http://volle.example'), '', 'plain http only for localhost');
    assert.equal(normalizeBaseUrl('http://localhost:8000/x'), 'http://localhost:8000');
    assert.equal(formEncode({ a: [{ b: { c: 1 } }], d: 'x' }).toString(), 'a%5B0%5D%5Bb%5D%5Bc%5D=1&d=x');
});

test('public pack catalog derives bonus % and a single best-value tag from the server catalog', () => {
    const packs = publicPackCatalog();
    assert.deepEqual(packs.map(pack => pack.id), Object.keys(PREMIUM_PACKS));
    assert.equal(packs[0].bonusPct, 0);
    assert.ok(packs[1].bonusPct > 0 && packs[2].bonusPct > packs[1].bonusPct);
    assert.deepEqual(packs.filter(pack => pack.bestValue).map(pack => pack.id), ['gems_1200']);
});

test('only paid, VOLLE-tagged checkout sessions map to a ledger event', () => {
    assert.equal(paymentEventFromStripe(sessionEvent('p', {}, { payment_status: 'unpaid' })), null);
    assert.equal(paymentEventFromStripe(sessionEvent('p', { type: 'charge.refunded' })), null);
    assert.equal(paymentEventFromStripe(sessionEvent('p', {}, { metadata: { packId: 'gems_550' } })), null, 'foreign session');
    assert.equal(paymentEventFromStripe(sessionEvent('p', {}, { metadata: { app: 'volle', packId: 'case_key' } })), null);
    const mapped = paymentEventFromStripe(sessionEvent('profile_1234'));
    assert.equal(mapped.eventId, 'cs_test_a1b2c3d4e5f6g7h8');
    assert.equal(mapped.transactionId, mapped.eventId, 'idempotent on the session id');
    assert.equal(mapped.sku, 'gems_550');
    assert.equal(mapped.amountMinor, 899);
    assert.equal(mapped.currency, 'USD');
});

test('createCheckoutSession refuses unknown packs and bad request ids before calling Stripe', async () => {
    const config = stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', PUBLIC_BASE_URL: 'https://volle.example' });
    const never = () => { throw new Error('must not call Stripe'); };
    assert.equal((await createCheckoutSession({ config, packId: 'gems_9999', profileId: 'p', requestId: 'checkout:1234', fetchImpl: never })).status, 400);
    assert.equal((await createCheckoutSession({ config, packId: '__proto__', profileId: 'p', requestId: 'checkout:1234', fetchImpl: never })).status, 400);
    assert.equal((await createCheckoutSession({ config, packId: 'gems_100', profileId: 'p', requestId: 'x', fetchImpl: never })).status, 400);
    const failing = async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error' } }), { status: 400 });
    assert.equal((await createCheckoutSession({ config, packId: 'gems_100', profileId: 'p', requestId: 'checkout:1234', fetchImpl: failing })).status, 502);
});

test('HTTP: catalog is public; checkout is 401 for guests and 503 until Stripe env is set', async () => {
    const catalog = await api('/api/payments/catalog');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.enabled, false);
    assert.equal(catalog.body.packs.length, 3);
    assert.equal(catalog.body.gemPrices.battlepass_premium > 0, true);

    const guest = await api('/api/payments/checkout', { method: 'POST', body: { packId: 'gems_100', requestId: 'checkout:guest-1' } });
    assert.equal(guest.status, 401);
    assert.match(guest.body.message, /free account/i);

    const disabled = await api('/api/payments/checkout', { token: alice.sessionToken, method: 'POST', body: { packId: 'gems_100', requestId: 'checkout:off-1' } });
    assert.equal(disabled.status, 503);
    assert.equal(disabled.body.error, 'payments unavailable');
    assert.equal(stripeCalls.length, 0);

    process.env.STRIPE_SECRET_KEY = 'sk_test_only';
    const noBaseUrl = await api('/api/payments/checkout', { token: alice.sessionToken, method: 'POST', body: { packId: 'gems_100', requestId: 'checkout:off-2' } });
    assert.equal(noBaseUrl.status, 503, 'PUBLIC_BASE_URL is also required');
    delete process.env.STRIPE_SECRET_KEY;
});

test('HTTP: enabled checkout creates a form-encoded Stripe session with server-side price and metadata', async t => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_51abcDEF';
    process.env.PUBLIC_BASE_URL = 'https://volle.example';
    t.after(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.PUBLIC_BASE_URL; stripeCalls = []; });
    assert.equal((await api('/api/payments/catalog')).body.enabled, true);
    const result = await api('/api/payments/checkout', {
        token: alice.sessionToken, method: 'POST',
        headers: { 'Idempotency-Key': 'checkout:req-abc123' },
        body: { packId: 'gems_550', amountMinor: 1, gems: 999999 }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.url, 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8');
    assert.equal(stripeCalls.length, 1);
    const [call] = stripeCalls;
    assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(call.init.headers.Authorization, 'Bearer sk_test_51abcDEF');
    assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.match(call.init.headers['Idempotency-Key'], /checkout:req-abc123$/);
    const form = new URLSearchParams(call.init.body);
    const profileId = accounts.resolveSession(alice.sessionToken).profile.id;
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '899', 'price comes from the server catalog, not the body');
    assert.equal(form.get('line_items[0][price_data][currency]'), 'usd');
    assert.equal(form.get('client_reference_id'), profileId);
    assert.equal(form.get('metadata[packId]'), 'gems_550');
    assert.equal(form.get('metadata[profileId]'), profileId);
    assert.equal(form.get('metadata[accountId]'), alice.account.id);
    assert.equal(form.get('metadata[requestId]'), 'checkout:req-abc123');
    assert.equal(form.get('success_url'), 'https://volle.example/?purchase=success&session_id={CHECKOUT_SESSION_ID}');
    assert.equal(form.get('cancel_url'), 'https://volle.example/?purchase=cancel');

    const unknown = await api('/api/payments/checkout', { token: alice.sessionToken, method: 'POST', body: { packId: 'case_key', requestId: 'checkout:req-bad' } });
    assert.equal(unknown.status, 400);
});

test('HTTP: Stripe webhook credits gems exactly once per session and rejects bad signatures', async t => {
    const profileId = accounts.resolveSession(alice.sessionToken).profile.id;
    const before = gemsOf(alice.sessionToken);
    assert.equal((await postWebhook(sessionEvent(profileId))).status, 503, 'disabled without STRIPE_WEBHOOK_SECRET');

    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    t.after(() => { delete process.env.STRIPE_WEBHOOK_SECRET; });

    const tampered = await postWebhook(sessionEvent(profileId), { tamper: raw => raw.replace('"gems_550"', '"gems_1200"') });
    assert.equal(tampered.status, 400);
    const expired = await postWebhook(sessionEvent(profileId), { timestamp: Math.floor(Date.now() / 1000) - 600 });
    assert.equal(expired.status, 400);
    const wrongSecret = await postWebhook(sessionEvent(profileId), { secret: 'whsec_attacker_secret_00000000000' });
    assert.equal(wrongSecret.status, 400);
    const unsigned = await api('/api/payments/stripe/webhook', { method: 'POST', body: sessionEvent(profileId) });
    assert.equal(unsigned.status, 400);
    assert.equal(gemsOf(alice.sessionToken), before, 'nothing credited by rejected deliveries');

    const unpaid = await postWebhook(sessionEvent(profileId, {}, { payment_status: 'unpaid' }));
    assert.deepEqual(unpaid.body, { received: true, ignored: true });
    assert.equal(gemsOf(alice.sessionToken), before);

    const first = await postWebhook(sessionEvent(profileId));
    assert.equal(first.status, 200);
    assert.equal(first.body.applied, true);
    assert.equal(gemsOf(alice.sessionToken), before + 550);

    const retry = await postWebhook(sessionEvent(profileId));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.replayed, true);
    const asyncEvent = await postWebhook(sessionEvent(profileId, { id: 'evt_test_async_0002', type: 'checkout.session.async_payment_succeeded' }));
    assert.equal(asyncEvent.status, 200);
    assert.equal(gemsOf(alice.sessionToken), before + 550, 'same session never credits twice');

    const mismatch = await postWebhook(sessionEvent(profileId, {}, { id: 'cs_test_mismatch_000001', amount_subtotal: 1, amount_total: 1 }));
    assert.equal(mismatch.status, 409);
    assert.equal(gemsOf(alice.sessionToken), before + 550);
});

test('HTTP: premium battle pass is gem-purchasable, server-authoritative and idempotent', async () => {
    const profile = accounts.resolveSession(alice.sessionToken).profile;
    profile.battlepass = { ...profile.battlepass, premium: false };
    const gems = profile.gems;
    assert.ok(gems >= 500, 'webhook test credited enough gems');
    const noKey = await api('/api/profile/battlepass/premium-gems', { token: alice.sessionToken, method: 'POST', body: {} });
    assert.equal(noKey.status, 400);
    const guest = await api('/api/profile/battlepass/premium-gems', { method: 'POST', body: { requestId: 'bp-gems:guest1' } });
    assert.equal(guest.status, 401);
    const bought = await api('/api/profile/battlepass/premium-gems', {
        token: alice.sessionToken, method: 'POST', headers: { 'Idempotency-Key': 'bp-gems:s1' }, body: {}
    });
    assert.equal(bought.status, 200);
    assert.equal(bought.body.replayed, false);
    assert.equal(bought.body.profile.battlepass.premium, true);
    assert.equal(bought.body.profile.gems, gems - 500);
    assert.equal('gemSpendReceipts' in bought.body.profile, false, 'receipts stay server-private');
    const replay = await api('/api/profile/battlepass/premium-gems', {
        token: alice.sessionToken, method: 'POST', headers: { 'Idempotency-Key': 'bp-gems:s1' }, body: {}
    });
    assert.equal(replay.body.replayed, true);
    const second = await api('/api/profile/battlepass/premium-gems', {
        token: alice.sessionToken, method: 'POST', headers: { 'Idempotency-Key': 'bp-gems:other-key' }, body: {}
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true, 'already premium: no second charge');
    assert.equal(gemsOf(alice.sessionToken), gems - 500);
});
