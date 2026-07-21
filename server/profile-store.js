const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CASES } = require('./case-catalog');
const { normalizeEquippedCosmetics } = require('./cosmetic-entitlement');

const CATALOG = {
    character: {
        tank: 300, scout: 300, sniper: 400, guardian: 400, blazer: 500, frost: 500
    },
    ball: {
        fire: 150, ice: 150, lightning: 150, bomb: 150, star: 150, rainbow: 150,
        plasma: 180, abyss: 180, melon: 180,
        inferno: 220, frostbite: 220, voltstorm: 260, nebula: 280, creeper: 300,
        happy: 300, glitch: 340, void_eye: 340, candy: 260, solar: 360, toxic: 240, disco: 320,
        magma: 380, ocean: 300, honey: 280, dragon: 420, portal: 400,
        moon: 260, pumpkin: 300, matrix: 340, sakura: 320, blackhole: 460
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
        neon: 250, samurai: 350, frost: 300, astro: 420, arcade: 380, moss: 450,
        striker: 500, void: 600, royal: 750, circuit: 650, creeper_knight: 520,
        ender_mage: 680, magma_guard: 620, bee_runner: 460, axolotl_scout: 560,
        ghost_keeper: 720, infernal_smile: 760, galaxy_idol: 820
    },
    knife: {
        tide: 1, flare: 1, prism: 1, sherlock: 1, doppler: 1, fade: 1, crimson_web: 1,
        obsidian: 1, aurora: 1, pixel_edge: 1, icefang: 1, dragonclaw: 1, reactor: 1
    },
    cosmetic: {
        cape_ember: 280, cape_frost: 300, cape_void: 440, cape_creeper: 360, cape_royal: 520, cape_glitch: 480,
        pet_slime: 260, pet_dragon: 520, pet_drone: 420, pet_snowman: 300, pet_bee: 340, pet_axolotl: 460,
        shoes_blaze: 240, shoes_ice: 240, shoes_lightning: 340, shoes_cloud: 300, shoes_magma: 420, shoes_pixel: 380,
        aura_flame: 320, aura_frost: 340, aura_void: 520, aura_hearts: 360, aura_music: 420, aura_toxic: 460,
        impact_confetti: 220, impact_ice: 260, impact_fire: 320, impact_pixels: 360, impact_stars: 400, impact_glitch: 480
    }
};

const PROFILE_FIELDS = {
    character: 'unlockedChars',
    ball: 'ownedBalls',
    skill: 'ownedSkills',
    rune: 'ownedItems',
    avatar: 'ownedAvatarSkins',
    knife: 'ownedKnives',
    cosmetic: 'ownedCosmetics'
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
        ownedKnives: ['training'],
        ownedCosmetics: [],
        equippedWearables: { cape: 'none', pet: 'none', shoes: 'none', aura: 'none', impact: 'none' },
        casePity: {},
        caseReceipts: [],
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
            if (!parsed || typeof parsed !== 'object') return {};
            return Object.fromEntries(Object.entries(parsed)
                .filter(([, record]) => record && typeof record === 'object')
                .map(([id, record]) => [id, this._normalizeRecord({ ...record, id })]));
        } catch {
            return {};
        }
    }

    _normalizeRecord(record) {
        const base = defaults(record.id || crypto.randomUUID(), record.playerName);
        const normalized = { ...base, ...record };
        for (const [kind, field] of Object.entries(PROFILE_FIELDS)) {
            const allowed = new Set(Object.keys(CATALOG[kind]));
            normalized[field] = [...new Set([
                ...base[field],
                ...(Array.isArray(record[field]) ? record[field].filter(id => allowed.has(id)) : [])
            ])];
        }
        normalized.casePity = normalized.casePity && typeof normalized.casePity === 'object' ? normalized.casePity : {};
        normalized.caseReceipts = Array.isArray(normalized.caseReceipts) ? normalized.caseReceipts.slice(-50) : [];
        normalized.equippedWearables = normalizeEquippedCosmetics(
            normalized.equippedWearables,
            normalized.ownedCosmetics,
            CATALOG.cosmetic
        );
        return normalized;
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
        const { tokenHash, rewardedMatches, purchaseReceipts, premiumTransactions, caseReceipts, ...profile } = record;
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

    purchase(record, kind, id, requestId = '', priceOverride = null) {
        if (kind === 'knife') return { status: 404, error: 'item not found' };
        const catalogPrice = CATALOG[kind]?.[id];
        const price = Number.isInteger(priceOverride) && priceOverride > 0 && priceOverride <= catalogPrice
            ? priceOverride : catalogPrice;
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

    equipCosmetics(record, loadout) {
        record.equippedWearables = normalizeEquippedCosmetics(loadout, record.ownedCosmetics, CATALOG.cosmetic);
        record.updatedAt = Date.now();
        this._save();
        return { status: 200, profile: this._public(record), loadout: record.equippedWearables };
    }

    openCase(record, caseId, requestId = '', random = null) {
        const box = CASES[caseId];
        if (!box) return { status: 404, error: 'case not found' };
        record.caseReceipts = Array.isArray(record.caseReceipts) ? record.caseReceipts : [];
        const receiptId = /^[A-Za-z0-9._:-]{8,96}$/.test(String(requestId || '')) ? requestId : '';
        const prior = receiptId ? record.caseReceipts.find(item => item.requestId === receiptId) : null;
        if (prior) return { status: 200, profile: this._public(record), result: prior.result, replayed: true };
        if (record.currency < box.price) return { status: 409, error: 'insufficient funds' };
        const pityBefore = Math.min(9, Math.max(0, Number(record.casePity?.[caseId]) || 0));
        const eligible = pityBefore >= 9
            ? box.drops.filter(([, , rarity]) => rarity === 'epic' || rarity === 'legendary')
            : box.drops;
        const total = eligible.reduce((sum, drop) => sum + drop[3], 0);
        let roll = Number.isFinite(random) ? Math.max(0, Math.min(0.999999, random)) : crypto.randomInt(0, 0x100000000) / 0x100000000;
        roll *= total;
        let selected = eligible[eligible.length - 1];
        for (const drop of eligible) {
            roll -= drop[3];
            if (roll < 0) { selected = drop; break; }
        }
        const [kind, id, rarity] = selected;
        const field = PROFILE_FIELDS[kind];
        if (!field || !CATALOG[kind]?.[id]) return { status: 500, error: 'invalid case catalog' };
        const duplicate = record[field].includes(id);
        const refund = duplicate ? Math.floor(box.price * 0.35) : 0;
        record.currency -= box.price;
        if (refund) record.currency += refund;
        else record[field].push(id);
        const premium = rarity === 'epic' || rarity === 'legendary';
        record.casePity = { ...record.casePity, [caseId]: premium ? 0 : pityBefore + 1 };
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = Date.now();
        const result = {
            reward: { id, type: kind, rarity }, duplicate, refund,
            pity: { before: pityBefore, after: record.casePity[caseId], guaranteed: pityBefore >= 9 }
        };
        if (receiptId) {
            record.caseReceipts.push({ requestId: receiptId, result });
            record.caseReceipts = record.caseReceipts.slice(-50);
        }
        this._save();
        return { status: 200, profile: this._public(record), result, replayed: false };
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
        record.equippedWearables = normalizeEquippedCosmetics(
            legacy.equippedWearables,
            record.ownedCosmetics,
            CATALOG.cosmetic
        );
        const legacyPity = legacy.casePity && typeof legacy.casePity === 'object' ? legacy.casePity : {};
        record.casePity = Object.fromEntries(Object.keys(CASES).map(caseId => [
            caseId,
            Math.min(9, Math.max(0, Math.floor(Number(legacyPity[caseId]) || 0)))
        ]));
    }
}

module.exports = { CATALOG, ProfileStore };
