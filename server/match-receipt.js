const crypto = require('crypto');

const ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const MAX_RECEIPT_LIFETIME_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

function normalizeMatchReceipt(input, now = Date.now()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const profileId = typeof input.profileId === 'string' ? input.profileId : '';
    const matchId = typeof input.matchId === 'string' ? input.matchId : '';
    const issuedAt = Number(input.issuedAt);
    const expiresAt = Number(input.expiresAt);
    const mode = input.mode === 'ranked' ? 'ranked' : input.mode === 'casual' ? 'casual' : '';
    if (!ID_PATTERN.test(profileId) || !ID_PATTERN.test(matchId) || !mode) return null;
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) return null;
    if (issuedAt > now + MAX_CLOCK_SKEW_MS || expiresAt < now) return null;
    if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_RECEIPT_LIFETIME_MS) return null;
    return {
        profileId,
        matchId,
        mode,
        won: input.won === true,
        issuedAt,
        expiresAt
    };
}

function receiptPayload(receipt) {
    return JSON.stringify([
        receipt.profileId,
        receipt.matchId,
        receipt.mode,
        receipt.won,
        receipt.issuedAt,
        receipt.expiresAt
    ]);
}

function signMatchReceipt(secret, input, now = Date.now()) {
    if (typeof secret !== 'string' || secret.length < 32) return null;
    const receipt = normalizeMatchReceipt(input, now);
    if (!receipt) return null;
    return crypto.createHmac('sha256', secret).update(receiptPayload(receipt)).digest('hex');
}

function verifyMatchReceipt(secret, input, signature, now = Date.now()) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const receipt = normalizeMatchReceipt(input, now);
    const expected = receipt ? signMatchReceipt(secret, receipt, now) : null;
    if (!expected) return null;
    const actualBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer) ? receipt : null;
}

module.exports = {
    MAX_RECEIPT_LIFETIME_MS,
    normalizeMatchReceipt,
    signMatchReceipt,
    verifyMatchReceipt
};
