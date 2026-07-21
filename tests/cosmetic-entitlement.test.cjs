const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    normalizeEquippedCosmetics,
    signCosmeticEntitlement,
    verifyCosmeticEntitlement
} = require('../server/cosmetic-entitlement');

test('server cosmetic loadout accepts only owned items in matching slots', () => {
    const catalog = { cape_ember: 280, pet_slime: 260 };
    assert.deepEqual(normalizeEquippedCosmetics({
        cape: 'cape_ember', pet: 'pet_slime', shoes: 'cape_ember', aura: 'missing', impact: 'none'
    }, ['cape_ember'], catalog), {
        cape: 'cape_ember', pet: 'none', shoes: 'none', aura: 'none', impact: 'none'
    });
});

test('signed cosmetic entitlement is identity-bound, expiring, and tamper-evident', () => {
    const secret = crypto.randomBytes(32);
    const loadout = { cape: 'cape_ember', pet: 'none', shoes: 'none', aura: 'none', impact: 'none' };
    const token = signCosmeticEntitlement(secret, { id: 'profile-1' }, 'player-1', loadout, 1000);
    assert.deepEqual(verifyCosmeticEntitlement(secret, token, 2000).loadout, loadout);
    assert.equal(verifyCosmeticEntitlement(secret, `${token}x`, 2000), null);
    assert.equal(verifyCosmeticEntitlement(secret, token, 700000), null);
});
