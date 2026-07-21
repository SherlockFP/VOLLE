const crypto = require('crypto');

const TYPES = ['cape', 'pet', 'shoes', 'aura', 'impact'];
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeEquippedCosmetics(value, owned, catalog) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const ownership = new Set(Array.isArray(owned) ? owned : []);
    return Object.fromEntries(TYPES.map(type => {
        const id = source[type];
        return [type, id === 'none' || (
            typeof id === 'string'
            && id.startsWith(`${type}_`)
            && catalog[id]
            && ownership.has(id)
        ) ? id : 'none'];
    }));
}

function signCosmeticEntitlement(secret, profile, playerId, loadout, now = Date.now()) {
    if (!Buffer.isBuffer(secret) || secret.length < 32 || !PLAYER_ID.test(String(playerId || ''))) return null;
    const payload = Buffer.from(JSON.stringify({
        profileId: profile.id,
        playerId,
        loadout,
        expiresAt: now + 10 * 60 * 1000
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyCosmeticEntitlement(secret, entitlement, now = Date.now()) {
    if (!Buffer.isBuffer(secret) || secret.length < 32 || typeof entitlement !== 'string' || entitlement.length > 2048) return null;
    const [payload, signature, extra] = entitlement.split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    let provided;
    try { provided = Buffer.from(signature, 'base64url'); } catch { return null; }
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!PLAYER_ID.test(String(parsed.playerId || '')) || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt < now) return null;
        return parsed;
    } catch {
        return null;
    }
}

module.exports = { TYPES, normalizeEquippedCosmetics, signCosmeticEntitlement, verifyCosmeticEntitlement };
