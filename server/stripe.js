// Stripe Checkout over the REST API with Node built-ins only (zero-dependency
// server rule: no Stripe SDK). Products/prices are NOT created in the Stripe
// dashboard; each Checkout Session carries inline price_data from the server
// catalog in server/payment-ledger.js. Setup: docs/PAYMENTS.md.
const crypto = require('crypto');
const { PREMIUM_PACKS } = require('./payment-ledger');

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const PAID_SESSION_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);

function normalizeBaseUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value.trim());
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return '';
        return url.origin;
    } catch {
        return '';
    }
}

// Read per request (not at boot) so an operator can rotate keys with a restart
// and tests can toggle the feature without re-requiring server.js.
function stripeConfig(env = process.env) {
    const secretKey = typeof env.STRIPE_SECRET_KEY === 'string' ? env.STRIPE_SECRET_KEY.trim() : '';
    const webhookSecret = typeof env.STRIPE_WEBHOOK_SECRET === 'string' ? env.STRIPE_WEBHOOK_SECRET.trim() : '';
    const publicBaseUrl = normalizeBaseUrl(env.PUBLIC_BASE_URL);
    const validKey = /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey);
    return {
        secretKey: validKey ? secretKey : '',
        webhookSecret,
        publicBaseUrl,
        checkoutEnabled: validKey && !!publicBaseUrl,
        webhookEnabled: webhookSecret.length >= 16,
        testMode: /^(sk|rk)_test_/.test(secretKey)
    };
}

// Stripe's application/x-www-form-urlencoded dialect: nested keys as a[b][c].
function formEncode(value, prefix = '', out = new URLSearchParams()) {
    if (value === undefined || value === null) return out;
    if (Array.isArray(value)) {
        value.forEach((item, index) => formEncode(item, `${prefix}[${index}]`, out));
    } else if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) formEncode(item, prefix ? `${prefix}[${key}]` : key, out);
    } else {
        out.append(prefix, String(value));
    }
    return out;
}

function checkoutSessionParams({ packId, pack, profileId, accountId, requestId, publicBaseUrl }) {
    const metadata = { app: 'volle', packId, profileId, accountId, requestId };
    return {
        mode: 'payment',
        submit_type: 'pay',
        client_reference_id: profileId,
        success_url: `${publicBaseUrl}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${publicBaseUrl}/?purchase=cancel`,
        line_items: [{
            quantity: 1,
            price_data: {
                currency: pack.currency.toLowerCase(),
                unit_amount: pack.amountMinor,
                product_data: { name: `VOLLE ${pack.label}`, description: `${pack.gems} gems for the VOLLE shop. Gems cannot open cases.` }
            }
        }],
        metadata,
        // Mirrored onto the PaymentIntent so refunds/disputes in the dashboard
        // still show which profile and pack they belong to (support tooling).
        payment_intent_data: { metadata }
    };
}

async function createCheckoutSession({ config, packId, profileId, accountId, requestId, fetchImpl = globalThis.fetch }) {
    const pack = Object.hasOwn(PREMIUM_PACKS, packId) ? PREMIUM_PACKS[packId] : null;
    if (!pack) return { status: 400, error: 'unknown gem pack' };
    if (!REQUEST_ID_PATTERN.test(String(requestId || ''))) return { status: 400, error: 'checkout requires a valid request id' };
    if (!config?.checkoutEnabled) return { status: 503, error: 'payments unavailable' };
    const body = formEncode(checkoutSessionParams({
        packId, pack, profileId, accountId: String(accountId || ''), requestId, publicBaseUrl: config.publicBaseUrl
    }));
    let response;
    let result;
    try {
        response = await fetchImpl(`${STRIPE_API_BASE}/checkout/sessions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                // Same profile + request id => Stripe returns the same session
                // instead of creating a second one on a double click / retry.
                'Idempotency-Key': `volle-checkout:${profileId}:${requestId}`
            },
            body: body.toString(),
            signal: AbortSignal.timeout(10000)
        });
        result = await response.json().catch(() => ({}));
    } catch {
        return { status: 502, error: 'payment provider unreachable' };
    }
    if (!response.ok || typeof result?.url !== 'string' || !/^https:\/\//.test(result.url)) {
        console.warn('[payments] Stripe checkout session failed:', response.status, result?.error?.type || '', result?.error?.code || '');
        return { status: 502, error: 'payment provider error' };
    }
    return { status: 200, url: result.url, sessionId: String(result.id || '') };
}

// Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>][,v0=...]". HMAC-SHA256 over
// `${t}.${rawBody}` keyed by the endpoint's whsec_ secret. Must use the raw
// bytes Stripe sent; re-serialized JSON will not verify.
function verifyStripeSignature(rawBody, header, secret, { nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS } = {}) {
    if (typeof secret !== 'string' || !secret) return { ok: false, reason: 'webhook secret not configured' };
    if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing signature' };
    let timestamp = NaN;
    const signatures = [];
    for (const part of header.split(',')) {
        const index = part.indexOf('=');
        if (index < 1) continue;
        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
        else if (key === 'v1' && /^[a-f0-9]{64}$/.test(value)) signatures.push(value);
    }
    if (!Number.isSafeInteger(timestamp) || !signatures.length) return { ok: false, reason: 'malformed signature' };
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
    const expected = crypto.createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(payload)
        .digest();
    const matched = signatures.some(signature => {
        const actual = Buffer.from(signature, 'hex');
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    });
    if (!matched) return { ok: false, reason: 'signature mismatch' };
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'timestamp outside tolerance' };
    return { ok: true, timestamp };
}

// Test/dev helper that produces a header exactly like Stripe does.
function signStripePayload(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
}

// Buffer of the exact request bytes, or null when larger than maxBytes.
function readRawBody(req, maxBytes = 64 * 1024) {
    return new Promise(resolve => {
        const chunks = [];
        let size = 0;
        let tooLarge = false;
        req.on('data', chunk => {
            if (tooLarge) return;
            size += chunk.length;
            if (size > maxBytes) { tooLarge = true; chunks.length = 0; return; }
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks)));
        req.on('error', () => resolve(null));
    });
}

// Maps a verified Stripe event to the provider-neutral ledger input, or null
// for events that must be acknowledged but never grant anything. The session id
// is both eventId and transactionId, so `completed` + `async_payment_succeeded`
// for one session (or any Stripe retry) credits exactly once.
function paymentEventFromStripe(event) {
    if (!event || typeof event !== 'object' || !PAID_SESSION_EVENTS.has(event.type)) return null;
    const session = event.data?.object;
    if (!session || session.object !== 'checkout.session' || session.mode !== 'payment') return null;
    if (session.payment_status !== 'paid') return null;
    const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    if (metadata.app !== 'volle' || !Object.hasOwn(PREMIUM_PACKS, metadata.packId)) return null;
    const created = Number(event.created);
    return {
        eventId: String(session.id || ''),
        transactionId: String(session.id || ''),
        provider: 'stripe',
        profileId: String(metadata.profileId || session.client_reference_id || ''),
        sku: metadata.packId,
        status: 'paid',
        // Subtotal is the catalog price before any tax Stripe Tax may add.
        amountMinor: Number(session.amount_subtotal ?? session.amount_total),
        currency: String(session.currency || '').toUpperCase(),
        occurredAt: Number.isFinite(created) ? Math.floor(created * 1000) : Date.now()
    };
}

module.exports = {
    SIGNATURE_TOLERANCE_SECONDS,
    STRIPE_API_BASE,
    checkoutSessionParams,
    createCheckoutSession,
    formEncode,
    normalizeBaseUrl,
    paymentEventFromStripe,
    readRawBody,
    signStripePayload,
    stripeConfig,
    verifyStripeSignature
};
