const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CATALOG = {
    character: {
        tank: 300, scout: 300, sniper: 400, guardian: 400, blazer: 500, frost: 500
    },
    ball: {
        fire: 150, ice: 150, lightning: 150, bomb: 150, star: 150, rainbow: 150
    },
    skill: {
        freeze: 100, burn: 100, shield: 100, smash: 100,
        heal: 100, teleport: 100, blackhole: 100
    },
    rune: {
        hp_bonus: 80, dmg_resist: 80, deflect_power: 80, speed_bonus: 80,
        stam_regen: 80, cooldown_red: 80, lifesteal: 80, thorns: 80
    },
    avatar: {
        neon: 250, samurai: 350, frost: 300, circuit: 650
    }
};

const PROFILE_FIELDS = {
    character: 'unlockedChars',
    ball: 'ownedBalls',
    skill: 'ownedSkills',
    rune: 'ownedItems',
    avatar: 'ownedAvatarSkins'
};

function defaults(id, name) {
    return {
        id,
        playerName: String(name || 'Player').slice(0, 16),
        currency: 200,
        gems: 0,
        unlockedChars: ['rally'],
        ownedBalls: ['classic'],
        ownedSkills: ['slow'],
        ownedItems: [],
        ownedAvatarSkins: ['default'],
        rewardedMatches: [],
        purchaseReceipts: [],
        premiumTransactions: [],
        economyRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

class ProfileStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.records = this._read();
    }

    _read() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
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

    _hash(token) {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    _public(record) {
        const { tokenHash, rewardedMatches, purchaseReceipts, premiumTransactions, ...profile } = record;
        return profile;
    }

    create(name, legacy) {
        const id = crypto.randomUUID();
        const token = crypto.randomBytes(32).toString('base64url');
        const record = { ...defaults(id, name), tokenHash: this._hash(token) };
        this._migrate(record, legacy);
        this.records[id] = record;
        this._save();
        return { token, profile: this._public(record) };
    }

    authenticate(token) {
        if (typeof token !== 'string' || token.length < 32) return null;
        const hash = this._hash(token);
        const record = Object.values(this.records).find(item => {
            const a = Buffer.from(item.tokenHash || '');
            const b = Buffer.from(hash);
            return a.length === b.length && crypto.timingSafeEqual(a, b);
        });
        return record || null;
    }

    getById(id) {
        return typeof id === 'string' ? this.records[id] || null : null;
    }

    session(token, name, legacy) {
        const existing = this.authenticate(token);
        if (existing) {
            existing.playerName = String(name || existing.playerName).slice(0, 16);
            existing.updatedAt = Date.now();
            this._save();
            return { token, profile: this._public(existing) };
        }
        return this.create(name, legacy);
    }

    purchase(record, kind, id, requestId = '') {
        const price = CATALOG[kind]?.[id];
        const field = PROFILE_FIELDS[kind];
        if (!price || !field) return { status: 404, error: 'item not found' };
        const receiptId = typeof requestId === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(requestId)
            ? requestId
            : '';
        record.purchaseReceipts = Array.isArray(record.purchaseReceipts) ? record.purchaseReceipts : [];
        const prior = receiptId
            ? record.purchaseReceipts.find(receipt => receipt.requestId === receiptId)
            : null;
        if (prior) {
            if (prior.kind !== kind || prior.id !== id) {
                return { status: 409, error: 'idempotency key conflict' };
            }
            return { status: 200, profile: this._public(record), replayed: true };
        }
        if (record[field].includes(id)) return { status: 409, error: 'already owned' };
        if (record.currency < price) return { status: 409, error: 'insufficient funds' };
        record.currency -= price;
        record[field].push(id);
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        if (receiptId) {
            record.purchaseReceipts.push({
                requestId: receiptId,
                kind,
                id,
                price,
                createdAt: Date.now()
            });
            record.purchaseReceipts = record.purchaseReceipts.slice(-100);
        }
        record.updatedAt = Date.now();
        this._save();
        return { status: 200, profile: this._public(record), replayed: false };
    }

    reward(record, match) {
        const matchId = typeof match?.matchId === 'string' ? match.matchId.slice(0, 64) : '';
        if (!matchId) return { status: 400, error: 'matchId required' };
        if (record.rewardedMatches.includes(matchId)) return { status: 409, error: 'reward already claimed' };
        const coins = match.won === true ? 5 : 1;
        record.currency += coins;
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.rewardedMatches.push(matchId);
        record.rewardedMatches = record.rewardedMatches.slice(-50);
        record.updatedAt = Date.now();
        this._save();
        return { status: 200, coins, profile: this._public(record) };
    }

    grantPremium(record, gems, transactionId) {
        const amount = Math.max(0, Math.min(100000, Math.floor(Number(gems) || 0)));
        if (!record || !amount || !/^[A-Za-z0-9._:-]{8,96}$/.test(String(transactionId || ''))) {
            return { status: 400, error: 'invalid premium grant' };
        }
        record.premiumTransactions = Array.isArray(record.premiumTransactions)
            ? record.premiumTransactions : [];
        const prior = record.premiumTransactions.find(item => item.transactionId === transactionId);
        if (prior) return { status: 200, replayed: true, profile: this._public(record) };
        record.gems = Math.min(1000000, Math.max(0, Number(record.gems) || 0) + amount);
        record.premiumTransactions.push({ transactionId, gems: amount, createdAt: Date.now() });
        record.premiumTransactions = record.premiumTransactions.slice(-100);
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = Date.now();
        this._save();
        return { status: 200, replayed: false, profile: this._public(record) };
    }

    _migrate(record, legacy) {
        if (!legacy || typeof legacy !== 'object') return;
        const currency = Number(legacy.currency);
        const gems = Number(legacy.gems);
        record.currency = Number.isFinite(currency)
            ? Math.max(0, Math.min(10000, currency))
            : record.currency;
        record.gems = Number.isFinite(gems)
            ? Math.max(0, Math.min(1000, gems))
            : record.gems;
        for (const [kind, field] of Object.entries(PROFILE_FIELDS)) {
            const allowed = new Set(Object.keys(CATALOG[kind]));
            const defaultsForField = record[field];
            const imported = Array.isArray(legacy[field])
                ? legacy[field].filter(id => allowed.has(id))
                : [];
            record[field] = [...new Set([...defaultsForField, ...imported])];
        }
    }
}

module.exports = { CATALOG, ProfileStore };
