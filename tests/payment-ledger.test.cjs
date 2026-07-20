const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('../server/profile-store');
const {
    PaymentLedger,
    signPaymentEvent,
    verifyPaymentEvent
} = require('../server/payment-ledger');

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warrball-payment-'));
    const profiles = new ProfileStore(path.join(dir, 'profiles.json'));
    const session = profiles.session('', 'Buyer');
    const ledger = new PaymentLedger(path.join(dir, 'payments.json'));
    return { dir, profiles, session, ledger };
}

function event(profileId, overrides = {}) {
    return {
        eventId: 'evt_12345678', transactionId: 'txn_12345678', provider: 'testpay',
        profileId, sku: 'gems_100', status: 'paid', amountMinor: 199,
        currency: 'USD', occurredAt: 1700000000000, ...overrides
    };
}

test('payment events require a valid signature and preserve canonical fields', () => {
    const secret = 's'.repeat(32);
    const input = event('profile_12345678');
    const signature = signPaymentEvent(secret, input);
    assert.ok(signature);
    assert.deepEqual(verifyPaymentEvent(secret, input, signature), input);
    assert.equal(verifyPaymentEvent(secret, { ...input, amountMinor: 1 }, signature), null);
});

test('payment ledger grants premium currency exactly once', t => {
    const { dir, profiles, session, ledger } = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = profiles.getById(session.profile.id);
    const first = ledger.apply(profiles, event(profile.id));
    assert.equal(first.status, 200);
    assert.equal(first.applied, true);
    assert.equal(first.profile.gems, 100);
    const replay = ledger.apply(profiles, event(profile.id));
    assert.equal(replay.replayed, true);
    assert.equal(profiles.getById(profile.id).gems, 100);
});

test('payment ledger rejects mismatched catalog price and cross-event reuse', t => {
    const { dir, profiles, session, ledger } = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.equal(ledger.apply(profiles, event(session.profile.id, { amountMinor: 1 })).status, 409);
    assert.equal(ledger.apply(profiles, event(session.profile.id, {
        transactionId: 'txn_other123', sku: 'gems_550', amountMinor: 899
    })).status, 200);
    assert.equal(ledger.apply(profiles, event(session.profile.id, {
        transactionId: 'txn_third123', sku: 'gems_550', amountMinor: 899
    })).status, 409);
});
