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

// Gems (the real-money currency) must never reach a random reward. GEM_PRICES is
// the only gem-spend catalog and ProfileStore.spendGems the only gem debit.
test('gem spend catalog holds no case, key or other random reward', () => {
    const { GEM_PRICES, PREMIUM_PACKS } = require('../server/payment-ledger');
    for (const sku of Object.keys(GEM_PRICES)) {
        assert.equal(Object.hasOwn(CASES, sku), false, `${sku} must not be a case id`);
        assert.doesNotMatch(sku, /case|key|crate|loot|box|chest|drop|roll/i, `${sku} looks like a random reward`);
    }
    for (const [id, pack] of Object.entries(PREMIUM_PACKS)) {
        assert.deepEqual(Object.keys(pack).sort(), ['amountMinor', 'currency', 'gems', 'label'], `${id} grants gems only`);
    }
});

test('gems can never open a case or buy a case key', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'volle-lootbox-gems-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = new ProfileStore(path.join(dir, 'profiles.json'));
    const profile = store.authenticate(store.session('', 'NoGemCases', { currency: 0 }).token);
    store.grantPremium(profile, 100000, 'policy-gem-grant');
    for (const caseId of Object.keys(CASES)) {
        for (const sku of [caseId, `${caseId}_key`, `case_${caseId}`, 'case_key', '__proto__', 'constructor']) {
            const spent = store.spendGems(profile, sku, `policy:${sku}`.slice(0, 90));
            assert.equal(spent.status, 404, `${sku} must not be gem-purchasable`);
        }
        const opened = store.openCase(profile, caseId, `policy:open:${caseId}`, 0);
        assert.equal(opened.status, 409, `${caseId} cannot be paid for with gems`);
    }
    assert.equal(profile.gems, 100000, 'no gem was spent on any case path');
    assert.deepEqual(profile.caseReceipts, []);
});

test('case-opening and purchase code paths never reference gems', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'profile-store.js'), 'utf8');
    const methodBody = name => {
        const match = new RegExp(`\\n    ${name}\\(.*\\{\\r?\\n[\\s\\S]*?\\n    \\}\\r?\\n`).exec(source);
        assert.ok(match, `${name} exists`);
        return match[0];
    };
    for (const name of ['openCase', 'purchase']) assert.doesNotMatch(methodBody(name), /gems/i, `${name} must stay coin-only`);
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const caseRoute = server.slice(server.indexOf("'/api/profile/cases/open'"), server.indexOf('return;', server.indexOf("'/api/profile/cases/open'")));
    assert.doesNotMatch(caseRoute, /gem|spendGems/i);
});
