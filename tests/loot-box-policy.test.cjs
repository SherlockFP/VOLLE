const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CASES } = require('../server/case-catalog');
const { ProfileStore } = require('../server/profile-store');

// Legal invariant (docs/V3_ECONOMY.md): random-reward cases are earned-currency only.
// Paid (gem / real-money) access to cases is banned in Belgium and regulated in NL,
// so this must fail loudly the moment someone adds a premium path.
test('case catalog prices are soft-currency only', () => {
    for (const [id, box] of Object.entries(CASES)) {
        const premiumKeys = Object.keys(box).filter(key => /gem|premium|real|usd|eur/i.test(key));
        assert.deepEqual(premiumKeys, [], `${id} must not carry a premium price`);
        assert.ok(Number.isInteger(box.price) && box.price > 0, `${id} needs a coin price`);
    }
});

test('opening a case never reads or spends gems', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-lootbox-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(dir, 'profiles.json'));
    const session = store.session('', 'Policy', { currency: 0 });
    const profile = store.authenticate(session.token);
    store.grantPremium(profile, 5000, 'policy-test-grant');
    const caseId = Object.keys(CASES)[0];
    const result = store.openCase(profile, caseId, 'policy:gems-only', 0);
    assert.equal(result.status, 409, 'gems must not substitute for coins');
    assert.equal(profile.gems, 5000);
});
