const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The ONE real-money catalog. Checkout (server/stripe.js), the webhook price
// check below and the client Gems tab (/api/payments/catalog) all read this;
// the browser never sends a price. See docs/PAYMENTS.md.
const PREMIUM_PACKS = Object.freeze({
    gems_100: Object.freeze({ gems: 100, amountMinor: 199, currency: 'USD', label: '100 Gems' }),
    gems_550: Object.freeze({ gems: 550, amountMinor: 899, currency: 'USD', label: '550 Gems' }),
    gems_1200: Object.freeze({ gems: 1200, amountMinor: 1699, currency: 'USD', label: '1,200 Gems' })
});
// Everything gems can buy. Direct, non-random items only: docs/V3_ECONOMY.md and
// tests/loot-box-policy.test.cjs forbid any case, key or other random reward here.
const GEM_PRICES = Object.freeze({
    battlepass_premium: 500
});
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;

// Bonus % is relative to the smallest pack's gems-per-cent rate; the best value
// tag goes to the highest rate. Derived, so a price edit can never mislabel.
function publicPackCatalog() {
    const entries = Object.entries(PREMIUM_PACKS);
    const rate = pack => pack.gems / pack.amountMinor;
    const baseRate = Math.min(...entries.map(([, pack]) => rate(pack)));
    const bestRate = Math.max(...entries.map(([, pack]) => rate(pack)));
    return entries.map(([id, pack]) => ({
        id,
        label: pack.label,
        gems: pack.gems,
        amountMinor: pack.amountMinor,
        currency: pack.currency,
        bonusPct: Math.max(0, Math.round((rate(pack) / baseRate - 1) * 100)),
        bestValue: entries.length > 1 && rate(pack) === bestRate
    }));
}

function normalizePaymentEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const event = {
        eventId: typeof input.eventId === 'string' ? input.eventId : '',
        transactionId: typeof input.transactionId === 'string' ? input.transactionId : '',
        provider: typeof input.provider === 'string' ? input.provider : '',
        profileId: typeof input.profileId === 'string' ? input.profileId : '',
        sku: typeof input.sku === 'string' ? input.sku : '',
        status: input.status === 'paid' ? 'paid' : input.status === 'refunded' ? 'refunded' : '',
        amountMinor: Number(input.amountMinor),
        currency: typeof input.currency === 'string' ? input.currency.toUpperCase() : '',
        occurredAt: Number(input.occurredAt)
    };
    if (!EVENT_ID_PATTERN.test(event.eventId)
        || !EVENT_ID_PATTERN.test(event.transactionId)
        || !EVENT_ID_PATTERN.test(event.profileId)
        || !/^[a-z0-9._-]{2,32}$/i.test(event.provider)
        || !PREMIUM_PACKS[event.sku]
        || !Number.isSafeInteger(event.amountMinor)
        || !Number.isSafeInteger(event.occurredAt)
        || !/^[A-Z]{3}$/.test(event.currency)) return null;
    return event;
}

function paymentPayload(event) {
    return JSON.stringify([
        event.eventId, event.transactionId, event.provider, event.profileId,
        event.sku, event.status, event.amountMinor, event.currency, event.occurredAt
    ]);
}

function signPaymentEvent(secret, input) {
    const event = normalizePaymentEvent(input);
    if (typeof secret !== 'string' || secret.length < 32 || !event) return null;
    return crypto.createHmac('sha256', secret).update(paymentPayload(event)).digest('hex');
}

function verifyPaymentEvent(secret, input, signature) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const event = normalizePaymentEvent(input);
    const expected = event ? signPaymentEvent(secret, event) : null;
    if (!expected) return null;
    const actual = Buffer.from(signature, 'hex');
    const wanted = Buffer.from(expected, 'hex');
    return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted) ? event : null;
}

class PaymentLedger {
    constructor(filePath, { now = () => Date.now() } = {}) {
        this.filePath = filePath;
        this.now = now;
        this.records = this._read();
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    _save() {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.records, null, 2));
        fs.renameSync(temp, this.filePath);
    }

    apply(profileStore, input) {
        const event = normalizePaymentEvent(input);
        if (!event) return { status: 400, error: 'invalid payment event' };
        const pack = PREMIUM_PACKS[event.sku];
        if (event.status !== 'paid') return { status: 202, accepted: false };
        if (event.amountMinor !== pack.amountMinor || event.currency !== pack.currency) {
            return { status: 409, error: 'payment amount mismatch' };
        }
        const prior = this.records[event.eventId];
        if (prior) {
            return prior.transactionId === event.transactionId
                ? { status: 200, applied: false, replayed: true }
                : { status: 409, error: 'event id conflict' };
        }
        const profile = profileStore.getById?.(event.profileId);
        if (!profile) return { status: 404, error: 'profile not found' };
        const grant = profileStore.grantPremium(profile, pack.gems, event.transactionId);
        if (grant.error) return grant;
        this.records[event.eventId] = {
            eventId: event.eventId,
            transactionId: event.transactionId,
            provider: event.provider,
            profileId: event.profileId,
            sku: event.sku,
            gems: pack.gems,
            status: 'applied',
            occurredAt: event.occurredAt,
            appliedAt: this.now()
        };
        this._save();
        return { status: 200, applied: true, replayed: grant.replayed === true, profile: grant.profile };
    }
}

module.exports = {
    GEM_PRICES,
    PREMIUM_PACKS,
    PaymentLedger,
    publicPackCatalog,
    normalizePaymentEvent,
    signPaymentEvent,
    verifyPaymentEvent
};
