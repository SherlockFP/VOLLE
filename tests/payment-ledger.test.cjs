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

test('refunds are acknowledged without a grant and invalid webhook signatures cannot verify', t => {
    const { dir, profiles, session, ledger } = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = profiles.getById(session.profile.id);
    const refund = ledger.apply(profiles, event(profile.id, { status: 'refunded' }));
    assert.deepEqual(refund, { status: 202, accepted: false });
    assert.equal(profiles.getById(profile.id).gems, 0);
    assert.equal(verifyPaymentEvent('s'.repeat(32), event(profile.id), '0'.repeat(64)), null);
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

test('gem spend for premium battle pass needs enough gems and replays by request id', t => {
    const { dir, profiles, session } = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const profile = profiles.getById(session.profile.id);
    const { GEM_PRICES } = require('../server/payment-ledger');
    const price = GEM_PRICES.battlepass_premium;
    assert.equal(profiles.spendGems(profile, 'battlepass_premium', 'bp-gems:s1').status, 409, 'no gems yet');
    assert.equal(profile.battlepass.premium, false);
    profiles.grantPremium(profile, price + 25, 'txn_grant_0001');
    const first = profiles.spendGems(profile, 'battlepass_premium', 'bp-gems:s1');
    assert.equal(first.status, 200);
    assert.equal(first.replayed, false);
    assert.equal(profile.gems, 25);
    assert.equal(profile.battlepass.premium, true);
    assert.equal(profiles.spendGems(profile, 'battlepass_premium', 'bp-gems:s1').replayed, true);
    assert.equal(profiles.spendGems(profile, 'battlepass_premium', 'short').status, 400);
    assert.equal(profile.gems, 25, 'replays never charge again');
    const restored = new ProfileStore(profiles.filePath).getById(profile.id);
    assert.equal(restored.gems, 25);
    assert.equal(restored.battlepass.premium, true);
});
