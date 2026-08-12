const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CASES } = require('./case-catalog');
const { normalizeEquippedCosmetics } = require('./cosmetic-entitlement');
const {
    ARENA_CARDS,
    DEFAULT_CARD_COLLECTION,
    DEFAULT_CARD_LOADOUT,
    grantArenaCache,
    normalizeCardCollection,
    normalizeCardLoadout,
    shouldAwardArenaCache,
    tradeUpCards
} = require('./card-catalog');
const {
    MATCH_XP,
    PREMIUM_PASS_PRICE,
    addXp: addBattlepassXp,
    claim: claimBattlepassReward,
    createProgress: createBattlepassProgress,
    normalizeProgress: normalizeBattlepassProgress,
    rollover: rolloverBattlepassProgress
} = require('./battlepass-service');
const {
    DAILY_CHALLENGE_XP,
    DAILY_ALL_COMPLETE_BONUS_XP,
    advanceDailyState,
    createDailyState,
    normalizeDailyState,
    publicDailyState
} = require('./daily-challenge-service');

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
        impact_confetti: 220, impact_ice: 260, impact_fire: 320, impact_pixels: 360, impact_stars: 400, impact_glitch: 480,
        finisher_explosion: 620
    }
};

const PROFILE_FIELDS = {
    character: 'unlockedChars',
    ball: 'ownedBalls',
    avatar: 'ownedAvatarSkins',
    knife: 'ownedKnives',
    cosmetic: 'ownedCosmetics'
};

const LEGACY_SKILL_IDS = new Set(['slow', 'freeze', 'burn', 'shield', 'smash', 'heal', 'teleport', 'blackhole']);
const LEGACY_RUNE_IDS = new Set(['hp_bonus', 'dmg_resist', 'deflect_power', 'speed_bonus', 'stam_regen', 'cooldown_red', 'lifesteal', 'thorns']);

// Match reward: base pays for the result, bonus rewards performance but is
// capped low so a stomp match can't out-earn several honest ones — coins stay
// a cosmetic currency, never a competitive-power lever (docs/V3_ECONOMY.md).
const MATCH_REWARD_WIN = 120;
const MATCH_REWARD_LOSE = 40;
const MATCH_REWARD_KILL_BONUS = 5;
const MATCH_REWARD_DEFLECT_BONUS = 1;
const MATCH_REWARD_BONUS_CAP = 60;

// House-promo "watch & earn" — no real ad SDK (zero new deps), just a
// server-enforced daily cap + cooldown so the coin faucet stays bounded.
const AD_REWARD_COINS = 50;
const AD_REWARD_DAILY_CAP = 5;
const AD_REWARD_COOLDOWN_MS = 90 * 1000;

// Free earning route (docs/V3_ECONOMY.md "First match of day") — flat bonus
// on today's first rewarded match, independent of win/loss. Server owns
// lastFirstMatchDay per profile; never trust a client-sent "is this my
// first match today" flag.
const FIRST_MATCH_OF_DAY_BONUS = 80;

// Main-menu login-streak badge (js/store.js#claimLoginStreak) — UTC-day
// consecutive counter, +20/day with a +150 bonus every 7th day (cycles,
// doesn't cap). Independent of the client's local-only Daily Login card.
const LOGIN_STREAK_DAILY_COINS = 20;
const LOGIN_STREAK_DAY7_COINS = 150;
const LOGIN_STREAK_CYCLE = 7;
const ONBOARDING_FLAGS = Object.freeze(['ftueSeen', 'ftueCompleted', 'ftueMatchHintsSeen']);
const ONBOARDING_FLAG_SET = new Set(ONBOARDING_FLAGS);
const BATTLEPASS_BOOST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/;
const BATTLEPASS_BOOST_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const BATTLEPASS_BOOST_RECEIPT_LIMIT = 24;
const BATTLEPASS_BOOST_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const RANKED_BASE_ELO = 1000;
const RANKED_MIN_ELO = 0;
const RANKED_MAX_ELO = 5000;
const RANKED_NORMAL_K = 32;
const RANKED_PLACEMENT_K = 48;
const RANKED_MAX_MATCHES = 100;

function clampRankedElo(value) {
    const numeric = Number(value);
    const rounded = Number.isFinite(numeric) ? Math.round(numeric) : RANKED_BASE_ELO;
    return Math.min(RANKED_MAX_ELO, Math.max(RANKED_MIN_ELO, rounded));
}

function createServerRankedState(elo = RANKED_BASE_ELO) {
    const initial = clampRankedElo(elo);
    return {
        elo: initial,
        currentSeason: {
            id: 'season-1', startedAt: 0, startingElo: initial,
            placements: { required: 5, completed: 0, placed: false },
            record: { games: 0, wins: 0, losses: 0, draws: 0, highestElo: initial, lowestElo: initial },
            matches: []
        },
        pastSeasons: []
    };
}

function normalizeRankedState(input) {
    const fallback = createServerRankedState(input?.elo);
    const season = input?.currentSeason && typeof input.currentSeason === 'object' ? input.currentSeason : {};
    const placements = season.placements && typeof season.placements === 'object' ? season.placements : {};
    const record = season.record && typeof season.record === 'object' ? season.record : {};
    const elo = clampRankedElo(input?.elo);
    const required = Math.min(10, Math.max(0, Math.floor(Number(placements.required) || 5)));
    const completed = Math.min(required, Math.max(0, Math.floor(Number(placements.completed) || 0)));
    return {
        ...fallback,
        elo,
        currentSeason: {
            ...fallback.currentSeason,
            id: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(String(season.id || '')) ? season.id : 'season-1',
            startedAt: Math.max(0, Math.floor(Number(season.startedAt) || 0)),
            startingElo: clampRankedElo(season.startingElo ?? elo),
            placements: { required, completed, placed: completed >= required },
            record: {
                games: Math.max(0, Math.floor(Number(record.games) || 0)),
                wins: Math.max(0, Math.floor(Number(record.wins) || 0)),
                losses: Math.max(0, Math.floor(Number(record.losses) || 0)),
                draws: Math.max(0, Math.floor(Number(record.draws) || 0)),
                highestElo: clampRankedElo(record.highestElo ?? elo),
                lowestElo: clampRankedElo(record.lowestElo ?? elo)
            },
            matches: Array.isArray(season.matches) ? season.matches.slice(-RANKED_MAX_MATCHES) : []
        },
        pastSeasons: Array.isArray(input?.pastSeasons) ? input.pastSeasons.slice(-8) : []
    };
}

function applyServerRankedResult(state, { matchId, opponentElo, opponentProfileId = '', result, playedAt }) {
    const current = normalizeRankedState(state);
    if (!['win', 'loss', 'draw'].includes(result)) throw new TypeError('invalid ranked result');
    const season = current.currentSeason;
    if (season.matches.some(match => match.id === matchId)) throw new Error('matchId already recorded');
    const placement = !season.placements.placed;
    const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    const expected = 1 / (1 + Math.pow(10, (clampRankedElo(opponentElo) - current.elo) / 400));
    const maxDelta = placement ? RANKED_PLACEMENT_K : RANKED_NORMAL_K;
    const nextElo = clampRankedElo(current.elo + Math.max(-maxDelta, Math.min(maxDelta, Math.round(maxDelta * (score - expected)))));
    const completed = Math.min(season.placements.required, season.placements.completed + (placement ? 1 : 0));
    const nextRecord = {
        games: season.record.games + 1,
        wins: season.record.wins + (result === 'win' ? 1 : 0),
        losses: season.record.losses + (result === 'loss' ? 1 : 0),
        draws: season.record.draws + (result === 'draw' ? 1 : 0),
        highestElo: Math.max(season.record.highestElo, nextElo),
        lowestElo: Math.min(season.record.lowestElo, nextElo)
    };
    return {
        ...current,
        elo: nextElo,
        currentSeason: {
            ...season,
            placements: { ...season.placements, completed, placed: completed >= season.placements.required },
            record: nextRecord,
            matches: [...season.matches, {
                id: matchId, playedAt, opponentElo: clampRankedElo(opponentElo), opponentProfileId: String(opponentProfileId).slice(0, 64), result, placement,
                eloBefore: current.elo, eloAfter: nextElo, delta: nextElo - current.elo
            }].slice(-RANKED_MAX_MATCHES)
        }
    };
}

function utcDateKey(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10);
}

function normalizeBattlepassActiveBoost(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.boostId !== 'string' || !BATTLEPASS_BOOST_ID_PATTERN.test(value.boostId)) return null;
    const multiplier = Number(value.multiplier);
    const activatedAt = Math.floor(Number(value.activatedAt));
    const expiresAt = Math.floor(Number(value.expiresAt));
    if (!Number.isFinite(multiplier) || multiplier < 1.01 || multiplier > 3
        || !Number.isFinite(activatedAt) || activatedAt < 0
        || !Number.isFinite(expiresAt) || expiresAt <= activatedAt
        || expiresAt - activatedAt > BATTLEPASS_BOOST_MAX_DURATION_MS) return null;
    return { boostId: value.boostId, multiplier, activatedAt, expiresAt };
}

function defaults(id, name) {
    return {
        id,
        playerName: String(name || 'Player').slice(0, 16),
        currency: 200,
        gems: 0,
        unlockedChars: ['rally'],
        ownedBalls: ['classic'],
        // Legacy arrays are kept so old local profiles migrate safely. New
        // skills/runes are Arena Cache cards only, never coin purchases.
        ownedSkills: ['slow'],
        ownedItems: [],
        ownedAvatarSkins: ['default'],
        ownedKnives: ['training'],
        ownedCosmetics: [],
        equippedWearables: { cape: 'none', pet: 'none', shoes: 'none', aura: 'none', impact: 'none' },
        casePity: {},
        caseReceipts: [],
        // Earned cosmetic openings are server-owned. A completed match can
        // mint one Case entitlement; it never buys power.
        earnedCases: {},
        caseDropDrought: 0,
        cardCollection: { ...DEFAULT_CARD_COLLECTION },
        equippedCards: { ...DEFAULT_CARD_LOADOUT },
        arenaCache: { earned: 0, opened: 0, lastMatchId: '' },
        battlepass: createBattlepassProgress(),
        battlepassBoosts: {},
        battlepassActiveBoost: null,
        battlepassBoostReceipts: [],
        dailyChallenges: createDailyState(),
        rankedState: createServerRankedState(),
        soloRewards: { day: '', count: 0, matchIds: [] },
        cardRewardReceipts: [],
        cardTradeReceipts: [],
        rewardedMatches: [],
        purchaseReceipts: [],
        premiumTransactions: [],
        adRewards: { day: '', count: 0, lastAt: 0, receipts: [] },
        lastFirstMatchDay: '',
        dailyStreak: { count: 0, lastClaimDay: '', receipts: [] },
        onboarding: { ftueSeen: false, ftueCompleted: false, ftueMatchHintsSeen: false },
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
        normalized.ownedSkills = [...new Set([
            ...base.ownedSkills,
            ...(Array.isArray(record.ownedSkills) ? record.ownedSkills.filter(id => LEGACY_SKILL_IDS.has(id)) : [])
        ])];
        normalized.ownedItems = [...new Set([
            ...base.ownedItems,
            ...(Array.isArray(record.ownedItems) ? record.ownedItems.filter(id => LEGACY_RUNE_IDS.has(id)) : [])
        ])];
        normalized.casePity = normalized.casePity && typeof normalized.casePity === 'object' ? normalized.casePity : {};
        normalized.caseReceipts = Array.isArray(normalized.caseReceipts) ? normalized.caseReceipts.slice(-50) : [];
        normalized.earnedCases = normalized.earnedCases && typeof normalized.earnedCases === 'object'
            ? Object.fromEntries(Object.keys(CASES).map(caseId => [caseId, Math.max(0, Math.floor(Number(normalized.earnedCases[caseId]) || 0))]))
            : {};
        normalized.caseDropDrought = Math.min(4, Math.max(0, Math.floor(Number(normalized.caseDropDrought) || 0)));
        normalized.cardCollection = normalizeCardCollection(record.cardCollection);
        normalized.equippedCards = normalizeCardLoadout(record.equippedCards, normalized.cardCollection);
        normalized.arenaCache = record.arenaCache && typeof record.arenaCache === 'object'
            ? {
                earned: Math.max(0, Math.floor(Number(record.arenaCache.earned) || 0)),
                opened: Math.max(0, Math.floor(Number(record.arenaCache.opened) || 0)),
                lastMatchId: typeof record.arenaCache.lastMatchId === 'string' ? record.arenaCache.lastMatchId.slice(0, 64) : ''
            }
            : { earned: 0, opened: 0, lastMatchId: '' };
        normalized.battlepass = normalizeBattlepassProgress(record.battlepass);
        normalized.dailyChallenges = normalizeDailyState(record.dailyChallenges);
        normalized.battlepassBoosts = record.battlepassBoosts && typeof record.battlepassBoosts === 'object' && !Array.isArray(record.battlepassBoosts)
            ? Object.fromEntries(Object.entries(record.battlepassBoosts)
                .filter(([id, boost]) => /^[A-Za-z0-9._:-]{1,96}$/.test(id) && boost && typeof boost === 'object')
                .map(([id, boost]) => [id, {
                    boostId: id,
                    quantity: Math.max(0, Math.min(99, Math.floor(Number(boost.quantity) || 0))),
                    multiplier: Math.min(3, Math.max(1.01, Number(boost.multiplier) || 1.25)),
                    durationMs: Math.max(1, Math.min(24 * 60 * 60 * 1000, Math.floor(Number(boost.durationMs) || 20 * 60 * 1000)))
                }])
                .filter(([, boost]) => boost.quantity > 0))
            : {};
        normalized.battlepassActiveBoost = normalizeBattlepassActiveBoost(record.battlepassActiveBoost);
        normalized.battlepassBoostReceipts = Array.isArray(record.battlepassBoostReceipts)
            ? record.battlepassBoostReceipts.filter(receipt => receipt && typeof receipt === 'object'
                && typeof receipt.requestId === 'string' && BATTLEPASS_BOOST_REQUEST_ID_PATTERN.test(receipt.requestId)
                && typeof receipt.boostId === 'string' && BATTLEPASS_BOOST_ID_PATTERN.test(receipt.boostId)
                && normalizeBattlepassActiveBoost(receipt.activeBoost)?.boostId === receipt.boostId)
                .map(receipt => ({
                    requestId: receipt.requestId,
                    boostId: receipt.boostId,
                    activeBoost: normalizeBattlepassActiveBoost(receipt.activeBoost)
                }))
                .slice(-BATTLEPASS_BOOST_RECEIPT_LIMIT)
            : [];
        normalized.cardRewardReceipts = Array.isArray(record.cardRewardReceipts)
            ? record.cardRewardReceipts.filter(item => item && typeof item.matchId === 'string').slice(-50)
            : [];
        normalized.cardTradeReceipts = Array.isArray(record.cardTradeReceipts)
            ? record.cardTradeReceipts.filter(item => item && typeof item.requestId === 'string').slice(-50)
            : [];
        normalized.adRewards = normalized.adRewards && typeof normalized.adRewards === 'object'
            ? {
                day: typeof normalized.adRewards.day === 'string' ? normalized.adRewards.day : '',
                count: Math.max(0, Math.floor(Number(normalized.adRewards.count) || 0)),
                lastAt: Math.max(0, Number(normalized.adRewards.lastAt) || 0),
                receipts: Array.isArray(normalized.adRewards.receipts) ? normalized.adRewards.receipts.slice(-20) : []
            }
            : { day: '', count: 0, lastAt: 0, receipts: [] };
        normalized.lastFirstMatchDay = typeof normalized.lastFirstMatchDay === 'string' ? normalized.lastFirstMatchDay : '';
        normalized.dailyStreak = normalized.dailyStreak && typeof normalized.dailyStreak === 'object'
            ? {
                count: Math.max(0, Math.floor(Number(normalized.dailyStreak.count) || 0)),
                lastClaimDay: typeof normalized.dailyStreak.lastClaimDay === 'string' ? normalized.dailyStreak.lastClaimDay : '',
                receipts: Array.isArray(normalized.dailyStreak.receipts) ? normalized.dailyStreak.receipts.slice(-20) : []
            }
            : { count: 0, lastClaimDay: '', receipts: [] };
        const savedOnboarding = record.onboarding && typeof record.onboarding === 'object' && !Array.isArray(record.onboarding)
            ? record.onboarding : {};
        normalized.onboarding = Object.fromEntries(ONBOARDING_FLAGS.map(flag => [flag,
            savedOnboarding[flag] === true || record[flag] === true
        ]));
        for (const flag of ONBOARDING_FLAGS) delete normalized[flag];
        normalized.rankedState = normalizeRankedState(record.rankedState);
        normalized.soloRewards = record.soloRewards && typeof record.soloRewards === 'object'
            ? { day: typeof record.soloRewards.day === 'string' ? record.soloRewards.day : '', count: Math.max(0, Math.min(3, Math.floor(Number(record.soloRewards.count) || 0))), matchIds: Array.isArray(record.soloRewards.matchIds) ? record.soloRewards.matchIds.filter(id => typeof id === 'string').slice(-3) : [] }
            : { day: '', count: 0, matchIds: [] };
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

    // Fresh-computed (never persists a stale value): remaining resets the
    // instant UTC day rolls over, without needing a write on every read.
    _adRewardStatus(record, now = Date.now()) {
        const state = record.adRewards && typeof record.adRewards === 'object'
            ? record.adRewards : { day: '', count: 0, lastAt: 0 };
        const count = state.day === utcDateKey(now) ? Math.max(0, Number(state.count) || 0) : 0;
        const cooldownRemainingMs = state.lastAt
            ? Math.max(0, AD_REWARD_COOLDOWN_MS - (now - Number(state.lastAt) || 0))
            : 0;
        return { remaining: Math.max(0, AD_REWARD_DAILY_CAP - count), cap: AD_REWARD_DAILY_CAP, cooldownRemainingMs };
    }
    _public(record, now = Date.now()) {
        if (this._rolloverBattlepass(record, now)) this._save();
        if (this._ensureDailyChallenges(record, now)) this._save();
        const { tokenHash, rewardedMatches, purchaseReceipts, premiumTransactions, caseReceipts, cardRewardReceipts, cardTradeReceipts, battlepassBoostReceipts, adRewards, dailyStreak, soloRewards, dailyChallenges, ...profile } = record;
        const activeBoost = normalizeBattlepassActiveBoost(record.battlepassActiveBoost);
        return {
            ...profile,
            battlepassActiveBoost: activeBoost && activeBoost.expiresAt > now ? activeBoost : null,
            dailyChallenges: publicDailyState(record.dailyChallenges),
            adRewards: this._adRewardStatus(record, now),
            dailyStreak: this._dailyStreakStatus(record, now)
        };
    }

    _ensureDailyChallenges(record, now = Date.now()) {
        const next = normalizeDailyState(record.dailyChallenges, now);
        const changed = JSON.stringify(record.dailyChallenges) !== JSON.stringify(next);
        if (changed) record.dailyChallenges = next;
        return changed;
    }

    _advanceDailyChallenges(record, match, now = Date.now()) {
        this._ensureDailyChallenges(record, now);
        const result = advanceDailyState(record.dailyChallenges, { won: match?.won === true });
        record.dailyChallenges = result.state;
        return result;
    }

    claimDailyChallenge(record, challengeId, requestId, now = Date.now()) {
        if (!record || typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(challengeId)
            || typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
            return { status: 400, error: 'invalid daily challenge claim' };
        }
        const rolled = this._ensureDailyChallenges(record, now);
        const state = record.dailyChallenges;
        const requestReceipt = state.claimReceipts.find(item => item.requestId === requestId);
        if (requestReceipt) {
            if (requestReceipt.challengeId !== challengeId) {
                if (rolled) { record.updatedAt = now; this._save(); }
                return { status: 409, error: 'idempotency key already used for another daily challenge' };
            }
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 200, replayed: true, coins: requestReceipt.coins, xpGranted: requestReceipt.xpGranted, profile: this._public(record) };
        }
        const challengeReceipt = state.claimReceipts.find(item => item.challengeId === challengeId);
        if (challengeReceipt) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 200, replayed: true, coins: challengeReceipt.coins, xpGranted: challengeReceipt.xpGranted, profile: this._public(record) };
        }
        const challenge = state.challenges.find(item => item.id === challengeId);
        if (!challenge) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 404, error: 'daily challenge unavailable' };
        }
        if (challenge.progress < challenge.target) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 409, error: 'daily challenge not complete' };
        }
        if (challenge.claimed) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 409, error: 'daily challenge already claimed' };
        }
        const challenges = state.challenges.map(item => item.id === challengeId ? { ...item, claimed: true } : item);
        const allClaimed = challenges.length > 0 && challenges.every(item => item.claimed);
        const completionBonus = allClaimed && state.bonusGranted !== true;
        const xpGranted = DAILY_CHALLENGE_XP + (completionBonus ? DAILY_ALL_COMPLETE_BONUS_XP : 0);
        const currentCurrency = Math.min(10000, Math.max(0, Number(record.currency) || 0));
        const coins = Math.min(challenge.reward, Math.max(0, 10000 - currentCurrency));
        record.currency = currentCurrency + coins;
        this._rolloverBattlepass(record, now);
        record.battlepass = addBattlepassXp(record.battlepass, xpGranted);
        record.dailyChallenges = {
            ...state,
            challenges,
            bonusGranted: state.bonusGranted === true || completionBonus,
            claimReceipts: [...state.claimReceipts, { requestId, challengeId, coins, xpGranted }].slice(-24)
        };
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = now;
        this._save();
        return { status: 200, replayed: false, coins, xpGranted, profile: this._public(record) };
    }

    // Server time, never browser time, defines the season boundary. This is
    // intentionally called before every public read/mutation so an account
    // cannot keep a past season alive by changing localStorage or its clock.
    _rolloverBattlepass(record, now = Date.now()) {
        const normalized = normalizeBattlepassProgress(record.battlepass, now);
        const { progress, changed } = rolloverBattlepassProgress(normalized, now);
        const differs = JSON.stringify(record.battlepass) !== JSON.stringify(progress);
        if (differs) record.battlepass = progress;
        return changed || differs;
    }

    _grantBattlepassReward(record, reward) {
        if (!reward || typeof reward !== 'object') return false;
        if (reward.kind === 'currency' && Number.isFinite(reward.amount) && reward.amount > 0) {
            record.currency = Math.min(10000, Math.max(0, Number(record.currency) || 0) + Math.floor(reward.amount));
            return true;
        }
        if (reward.kind === 'ball' && typeof reward.id === 'string' && CATALOG.ball[reward.id] !== undefined) {
            if (!record.ownedBalls.includes(reward.id)) record.ownedBalls.push(reward.id);
            return true;
        }
        if (reward.kind === 'cosmetic' && typeof reward.id === 'string' && CATALOG.cosmetic[reward.id] !== undefined) {
            if (!record.ownedCosmetics.includes(reward.id)) record.ownedCosmetics.push(reward.id);
            return true;
        }
        if (reward.kind === 'xpboost' && Number.isFinite(reward.multiplier) && Number.isFinite(reward.durationMs)) {
            const boostId = `bp-${record.battlepass.seasonId}-${reward.tier}`;
            const existing = record.battlepassBoosts?.[boostId];
            record.battlepassBoosts = {
                ...(record.battlepassBoosts || {}),
                [boostId]: {
                    boostId,
                    quantity: Math.min(99, Math.max(0, Number(existing?.quantity) || 0) + 1),
                    multiplier: reward.multiplier,
                    durationMs: reward.durationMs
                }
            };
            return true;
        }
        return false;
    }

    claimBattlepass(record, tier, track, now = Date.now()) {
        const rolled = this._rolloverBattlepass(record, now);
        const result = claimBattlepassReward(record.battlepass, Number(tier), track, CATALOG);
        if (result.error) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 409, error: result.error };
        }
        if (result.replayed) return { status: 200, replayed: true, reward: result.reward, profile: this._public(record) };
        if (!this._grantBattlepassReward(record, result.reward)) return { status: 409, error: 'battle pass reward unavailable' };
        record.battlepass = result.progress;
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = now;
        this._save();
        return { status: 200, replayed: false, reward: result.reward, profile: this._public(record) };
    }

    activateBattlepassBoost(record, boostId, requestId, now = Date.now()) {
        if (!record || typeof boostId !== 'string' || !BATTLEPASS_BOOST_ID_PATTERN.test(boostId)
            || typeof requestId !== 'string' || !BATTLEPASS_BOOST_REQUEST_ID_PATTERN.test(requestId)) {
            return { status: 400, error: 'invalid battle pass boost activation' };
        }
        const serverNow = Number.isFinite(Number(now)) ? Math.max(0, Math.floor(Number(now))) : Date.now();
        record.battlepassBoostReceipts = Array.isArray(record.battlepassBoostReceipts)
            ? record.battlepassBoostReceipts : [];
        const prior = record.battlepassBoostReceipts.find(receipt => receipt.requestId === requestId);
        if (prior) {
            if (prior.boostId !== boostId) return { status: 409, error: 'idempotency key already used' };
            return {
                status: 200,
                replayed: true,
                activeBoost: normalizeBattlepassActiveBoost(prior.activeBoost),
                profile: this._public(record, serverNow)
            };
        }

        const currentActive = normalizeBattlepassActiveBoost(record.battlepassActiveBoost);
        if (currentActive && currentActive.expiresAt > serverNow) {
            return { status: 409, error: 'a battle pass XP boost is already active' };
        }
        if (record.battlepassActiveBoost) record.battlepassActiveBoost = null;

        const inventoryBoost = record.battlepassBoosts?.[boostId];
        const quantity = Math.max(0, Math.min(99, Math.floor(Number(inventoryBoost?.quantity) || 0)));
        const multiplier = Number(inventoryBoost?.multiplier);
        const durationMs = Math.floor(Number(inventoryBoost?.durationMs));
        if (!inventoryBoost || quantity < 1 || !Number.isFinite(multiplier) || multiplier < 1.01 || multiplier > 3
            || !Number.isFinite(durationMs) || durationMs < 1 || durationMs > BATTLEPASS_BOOST_MAX_DURATION_MS) {
            return { status: 409, error: 'battle pass boost unavailable' };
        }

        const activeBoost = {
            boostId,
            multiplier,
            activatedAt: serverNow,
            expiresAt: serverNow + durationMs
        };
        const nextInventory = { ...(record.battlepassBoosts || {}) };
        if (quantity === 1) delete nextInventory[boostId];
        else nextInventory[boostId] = { ...inventoryBoost, boostId, quantity: quantity - 1, multiplier, durationMs };
        record.battlepassBoosts = nextInventory;
        record.battlepassActiveBoost = activeBoost;
        record.battlepassBoostReceipts.push({ requestId, boostId, activeBoost: { ...activeBoost } });
        record.battlepassBoostReceipts = record.battlepassBoostReceipts.slice(-BATTLEPASS_BOOST_RECEIPT_LIMIT);
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = serverNow;
        this._save();
        return { status: 200, replayed: false, activeBoost, profile: this._public(record, serverNow) };
    }

    unlockPremiumBattlepass(record, now = Date.now()) {
        const rolled = this._rolloverBattlepass(record, now);
        if (record.battlepass.premium) return { status: 200, replayed: true, profile: this._public(record) };
        if (Math.max(0, Number(record.currency) || 0) < PREMIUM_PASS_PRICE) {
            if (rolled) { record.updatedAt = now; this._save(); }
            return { status: 409, error: 'not enough coins for premium battle pass' };
        }
        record.currency -= PREMIUM_PASS_PRICE;
        record.battlepass = { ...record.battlepass, premium: true };
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = now;
        this._save();
        return { status: 200, replayed: false, profile: this._public(record) };
    }

    advanceOnboarding(record, input) {
        if (!record || !input || typeof input !== 'object' || Array.isArray(input)) {
            return { status: 400, error: 'invalid onboarding update' };
        }
        const entries = Object.entries(input);
        if (!entries.length || entries.some(([flag, value]) => !ONBOARDING_FLAG_SET.has(flag) || value !== true)) {
            return { status: 400, error: 'invalid onboarding update' };
        }
        record.onboarding = record.onboarding && typeof record.onboarding === 'object'
            ? record.onboarding : { ftueSeen: false, ftueCompleted: false, ftueMatchHintsSeen: false };
        let updated = false;
        for (const [flag] of entries) {
            if (record.onboarding[flag] !== true) {
                record.onboarding[flag] = true;
                updated = true;
            }
        }
        if (updated) {
            record.updatedAt = Date.now();
            this._save();
        }
        return { status: 200, updated, onboarding: { ...record.onboarding }, profile: this._public(record) };
    }

    // Fresh public view of the login streak — drops the idempotency receipts
    // array, same treatment as _adRewardStatus above.
    _dailyStreakStatus(record) {
        const state = record.dailyStreak && typeof record.dailyStreak === 'object'
            ? record.dailyStreak : { count: 0, lastClaimDay: '' };
        return {
            count: Math.max(0, Math.floor(Number(state.count) || 0)),
            lastClaimDay: typeof state.lastClaimDay === 'string' ? state.lastClaimDay : ''
        };
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
        if (kind === 'skill' || kind === 'rune') return { status: 403, error: 'skills and runes are earned through Arena Cache cards' };
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
        const earnedCount = Math.max(0, Math.floor(Number(record.earnedCases?.[caseId]) || 0));
        const usesEarned = earnedCount > 0;
        if (!usesEarned && record.currency < box.price) return { status: 409, error: 'insufficient funds' };
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
        const refund = duplicate ? (usesEarned ? 35 : Math.floor(box.price * 0.35)) : 0;
        if (usesEarned) {
            record.earnedCases = { ...(record.earnedCases || {}), [caseId]: earnedCount - 1 };
        } else record.currency -= box.price;
        if (refund) record.currency += refund;
        else record[field].push(id);
        const premium = rarity === 'epic' || rarity === 'legendary';
        record.casePity = { ...record.casePity, [caseId]: premium ? 0 : pityBefore + 1 };
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = Date.now();
        const result = {
            reward: { id, type: kind, rarity }, duplicate, refund,
            free: usesEarned,
            pity: { before: pityBefore, after: record.casePity[caseId], guaranteed: pityBefore >= 9 }
        };
        if (receiptId) {
            record.caseReceipts.push({ requestId: receiptId, result });
            record.caseReceipts = record.caseReceipts.slice(-50);
        }
        this._save();
        return { status: 200, profile: this._public(record), result, replayed: false };
    }

    // Both rank states are calculated before either record is assigned, then
    // persisted in one write. Only MatchAuthority may call this method; it
    // deliberately receives no browser-supplied opponent rating.
    finalizeRankedMatch(first, second, { matchId, firstResult, secondResult, playedAt = Date.now() } = {}) {
        if (!first || !second || first.id === second.id) throw new TypeError('two distinct profiles required');
        if (typeof matchId !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(matchId)) throw new TypeError('invalid ranked matchId');
        const firstNext = applyServerRankedResult(first.rankedState, {
            matchId, opponentElo: second.rankedState?.elo, opponentProfileId: second.id, result: firstResult, playedAt
        });
        const secondNext = applyServerRankedResult(second.rankedState, {
            matchId, opponentElo: first.rankedState?.elo, opponentProfileId: first.id, result: secondResult, playedAt
        });
        first.rankedState = firstNext;
        second.rankedState = secondNext;
        first.updatedAt = playedAt;
        second.updatedAt = playedAt;
        this._save();
        return { [first.id]: firstNext, [second.id]: secondNext };
    }

    canRewardSolo(record, now = Date.now()) {
        const state = record?.soloRewards || {};
        return state.day !== utcDateKey(now) || Math.max(0, Number(state.count) || 0) < 3;
    }

    hasRewardedMatch(record, matchId) { return Array.isArray(record?.rewardedMatches) && record.rewardedMatches.includes(matchId); }

    claimSoloReward(record, matchId, now = Date.now()) {
        const day = utcDateKey(now);
        const state = record.soloRewards && typeof record.soloRewards === 'object' ? record.soloRewards : { day: '', count: 0, matchIds: [] };
        if (state.day === day && Array.isArray(state.matchIds) && state.matchIds.includes(matchId)) return true;
        const count = state.day === day ? Math.max(0, Number(state.count) || 0) : 0;
        if (count >= 3) return false;
        record.soloRewards = { day, count: count + 1, matchIds: [...(state.day === day && Array.isArray(state.matchIds) ? state.matchIds : []), matchId].slice(-3) };
        this._save();
        return true;
    }

    canStartRankedPair(profileIds, now = Date.now()) {
        if (!Array.isArray(profileIds) || profileIds.length !== 2 || profileIds[0] === profileIds[1]) return false;
        const dayStart = new Date(utcDateKey(now)).getTime();
        return profileIds.every((id, index) => {
            const record = this.getById(id);
            const opponentProfileId = profileIds[1 - index];
            return (record?.rankedState?.currentSeason?.matches || []).filter(match => match?.opponentProfileId === opponentProfileId && Number(match.playedAt) >= dayStart).length < 3;
        });
    }

    reward(record, match, now = Date.now()) {
        const matchId = typeof match?.matchId === 'string' ? match.matchId.slice(0, 64) : '';
        if (!matchId) return { status: 400, error: 'matchId required' };
        record.cardRewardReceipts = Array.isArray(record.cardRewardReceipts) ? record.cardRewardReceipts : [];
        const previousCardReward = record.cardRewardReceipts.find(item => item.matchId === matchId);
        if (record.rewardedMatches.includes(matchId)) {
            return {
                status: 200,
                replayed: true,
                coins: 0,
                base: 0,
                bonus: 0,
                firstOfDay: 0,
                battlepassXp: 0,
                battlepassBoostMultiplier: 1,
                dailyProgress: null,
                cardReward: previousCardReward?.reward || null,
                earnedCase: previousCardReward?.earnedCase || null,
                earnedCaseSource: previousCardReward?.earnedCaseSource || null,
                profile: this._public(record)
            };
        }
        const kills = Math.max(0, Math.floor(Number(match.score) || 0));
        const deflects = Math.max(0, Math.floor(Number(match.deflections) || 0));
        const base = match.won === true ? MATCH_REWARD_WIN : MATCH_REWARD_LOSE;
        const bonus = Math.min(MATCH_REWARD_BONUS_CAP, kills * MATCH_REWARD_KILL_BONUS + deflects * MATCH_REWARD_DEFLECT_BONUS);
        const coins = base + bonus;
        // Free earning route: today's first rewarded match pays a flat bonus
        // on top, server-owned (docs/V3_ECONOMY.md "First match of day").
        const today = utcDateKey(now);
        const firstOfDay = record.lastFirstMatchDay !== today;
        const firstOfDayBonus = firstOfDay ? FIRST_MATCH_OF_DAY_BONUS : 0;
        if (firstOfDay) record.lastFirstMatchDay = today;
        record.currency += coins + firstOfDayBonus;
        // MatchAuthority only reaches here after a bounded, coherent result.
        // Do not use browser score/deflect input for Battle Pass XP.
        this._rolloverBattlepass(record, now);
        const baseBattlepassXp = match.won === true ? MATCH_XP.win : MATCH_XP.loss;
        const activeBoost = normalizeBattlepassActiveBoost(record.battlepassActiveBoost);
        const battlepassBoostMultiplier = activeBoost && activeBoost.expiresAt > now ? activeBoost.multiplier : 1;
        if (record.battlepassActiveBoost && battlepassBoostMultiplier === 1) record.battlepassActiveBoost = null;
        const battlepassXp = Math.floor(baseBattlepassXp * battlepassBoostMultiplier);
        record.battlepass = addBattlepassXp(record.battlepass, battlepassXp);
        // Daily tasks only consume MatchAuthority-settled result facts. The
        // replay guard above makes this exactly-once even when clients retry.
        const dailyProgress = this._advanceDailyChallenges(record, { won: match.won === true }, now);
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.rewardedMatches.push(matchId);
        record.rewardedMatches = record.rewardedMatches.slice(-50);
        const leveledUp = match?.leveledUp === true;
        let cardReward = null;
        // Deterministic 1-in-3 cadence with a five-match drought guarantee.
        // This is a reward for completing games, not a paid/competitive lever.
        const caseDropDrought = Math.min(4, Math.max(0, Number(record.caseDropDrought) || 0));
        const hash = crypto.createHash('sha256').update(matchId).digest()[0];
        const earnedCase = caseDropDrought >= 4 || hash % 3 === 0 ? 'kickoff' : null;
        const earnedCaseSource = earnedCase ? (caseDropDrought >= 4 ? 'drought_guarantee' : 'match_roll') : null;
        if (earnedCase) {
            record.earnedCases = { ...(record.earnedCases || {}), [earnedCase]: Math.max(0, Number(record.earnedCases?.[earnedCase]) || 0) + 1 };
            record.caseDropDrought = 0;
        } else record.caseDropDrought = caseDropDrought + 1;
        record.arenaCache = record.arenaCache && typeof record.arenaCache === 'object'
            ? record.arenaCache : { earned: 0, opened: 0, lastMatchId: '' };
        record.arenaCache.lastMatchId = matchId;
        if (shouldAwardArenaCache({ matchId, won: match.won === true, leveledUp })) {
            const granted = grantArenaCache(record.cardCollection, matchId);
            record.cardCollection = granted.collection;
            record.equippedCards = normalizeCardLoadout(record.equippedCards, granted.collection);
            record.arenaCache.earned = Math.max(0, Math.floor(Number(record.arenaCache.earned) || 0)) + 1;
            record.arenaCache.opened = Math.max(0, Math.floor(Number(record.arenaCache.opened) || 0)) + 1;
            cardReward = granted.reward;
        }
        record.cardRewardReceipts.push({ matchId, reward: cardReward, earnedCase, earnedCaseSource });
        record.cardRewardReceipts = record.cardRewardReceipts.slice(-50);
        record.updatedAt = now;
        this._save();
        return { status: 200, replayed: false, coins, base, bonus, firstOfDay: firstOfDayBonus, battlepassXp, battlepassBoostMultiplier, dailyProgress, cardReward, earnedCase, earnedCaseSource, profile: this._public(record, now) };
    }

    equipCard(record, cardId, slot) {
        const card = ARENA_CARDS[cardId];
        if (!card || !['active', 'passive'].includes(slot) || card.slot !== slot) {
            return { status: 400, error: 'invalid card loadout' };
        }
        record.cardCollection = normalizeCardCollection(record.cardCollection);
        if ((record.cardCollection[cardId] || 0) < 1) return { status: 403, error: 'card not owned' };
        const current = normalizeCardLoadout(record.equippedCards, record.cardCollection);
        const next = normalizeCardLoadout({ ...current, [slot]: cardId }, record.cardCollection);
        const replayed = current[slot] === next[slot];
        record.equippedCards = next;
        if (!replayed) {
            record.updatedAt = Date.now();
            this._save();
        }
        return { status: 200, replayed, loadout: next, profile: this._public(record) };
    }

    tradeUpCards(record, cardIds, requestId = '') {
        const receiptId = /^[A-Za-z0-9._:-]{8,96}$/.test(String(requestId || '')) ? requestId : '';
        if (!receiptId) return { status: 400, error: 'valid idempotency key required' };
        record.cardTradeReceipts = Array.isArray(record.cardTradeReceipts) ? record.cardTradeReceipts : [];
        const prior = receiptId ? record.cardTradeReceipts.find(item => item.requestId === receiptId) : null;
        if (prior) return { status: 200, replayed: true, result: prior.result, profile: this._public(record) };
        const result = tradeUpCards(record.cardCollection, cardIds, crypto.randomUUID());
        if (!result) return { status: 409, error: 'five owned cards of one non-legendary rarity required' };
        record.cardCollection = result.collection;
        record.equippedCards = normalizeCardLoadout(record.equippedCards, result.collection);
        if (receiptId) {
            record.cardTradeReceipts.push({ requestId: receiptId, result: { consumed: result.consumed, reward: result.reward } });
            record.cardTradeReceipts = record.cardTradeReceipts.slice(-50);
        }
        record.updatedAt = Date.now();
        this._save();
        return { status: 200, replayed: false, result: { consumed: result.consumed, reward: result.reward }, profile: this._public(record) };
    }

    // Login streak — main-menu badge (js/store.js#claimLoginStreak). UTC-day
    // counter, +20/day, +150 every 7th day (cycles, uncapped). Idempotent per
    // requestId; a genuine double-claim on the same UTC day is rejected 409.
    streakClaim(record, requestId = '', now = Date.now()) {
        const receiptId = typeof requestId === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(requestId) ? requestId : '';
        record.dailyStreak = record.dailyStreak && typeof record.dailyStreak === 'object'
            ? record.dailyStreak : { count: 0, lastClaimDay: '', receipts: [] };
        record.dailyStreak.receipts = Array.isArray(record.dailyStreak.receipts) ? record.dailyStreak.receipts : [];
        const prior = receiptId ? record.dailyStreak.receipts.find(item => item.requestId === receiptId) : null;
        if (prior) {
            return { status: 200, day: prior.day, reward: prior.reward, profile: this._public(record), replayed: true };
        }
        const today = utcDateKey(now);
        if (record.dailyStreak.lastClaimDay === today) {
            return { status: 409, error: 'streak already claimed today' };
        }
        const yesterday = utcDateKey(now - 86400000);
        const prevCount = Math.max(0, Math.floor(Number(record.dailyStreak.count) || 0));
        const day = record.dailyStreak.lastClaimDay === yesterday ? prevCount + 1 : 1;
        const reward = day > 0 && day % LOGIN_STREAK_CYCLE === 0 ? LOGIN_STREAK_DAY7_COINS : LOGIN_STREAK_DAILY_COINS;
        record.currency += reward;
        record.dailyStreak.count = day;
        record.dailyStreak.lastClaimDay = today;
        if (receiptId) {
            record.dailyStreak.receipts.push({ requestId: receiptId, day, reward, createdAt: now });
            record.dailyStreak.receipts = record.dailyStreak.receipts.slice(-20);
        }
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = now;
        this._save();
        return { status: 200, day, reward, profile: this._public(record), replayed: false };
    }

    // House-promo watch & earn — bearer identity is the only trust boundary
    // (same as purchase/openCase); daily cap + cooldown live here so a client
    // can't just hammer the endpoint. `now` is injectable for tests.
    adReward(record, requestId = '', now = Date.now()) {
        const receiptId = typeof requestId === 'string' && /^[A-Za-z0-9._:-]{8,80}$/.test(requestId) ? requestId : '';
        record.adRewards = record.adRewards && typeof record.adRewards === 'object'
            ? record.adRewards : { day: '', count: 0, lastAt: 0, receipts: [] };
        record.adRewards.receipts = Array.isArray(record.adRewards.receipts) ? record.adRewards.receipts : [];
        const prior = receiptId ? record.adRewards.receipts.find(item => item.requestId === receiptId) : null;
        if (prior) {
            return { status: 200, coins: prior.coins, ...this._adRewardStatus(record, now), profile: this._public(record), replayed: true };
        }
        const today = utcDateKey(now);
        if (record.adRewards.day !== today) {
            record.adRewards.day = today;
            record.adRewards.count = 0;
        }
        if (record.adRewards.count >= AD_REWARD_DAILY_CAP) {
            return { status: 429, error: 'daily ad reward limit reached' };
        }
        if (record.adRewards.lastAt && now - record.adRewards.lastAt < AD_REWARD_COOLDOWN_MS) {
            return {
                status: 429,
                error: 'ad reward cooldown active',
                retryAfterMs: AD_REWARD_COOLDOWN_MS - (now - record.adRewards.lastAt)
            };
        }
        record.currency += AD_REWARD_COINS;
        record.adRewards.count += 1;
        record.adRewards.lastAt = now;
        if (receiptId) {
            record.adRewards.receipts.push({ requestId: receiptId, coins: AD_REWARD_COINS, createdAt: now });
            record.adRewards.receipts = record.adRewards.receipts.slice(-20);
        }
        record.economyRevision = Math.max(0, Number(record.economyRevision) || 0) + 1;
        record.updatedAt = now;
        this._save();
        return { status: 200, coins: AD_REWARD_COINS, ...this._adRewardStatus(record, now), profile: this._public(record), replayed: false };
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
        record.ownedSkills = [...new Set([
            ...record.ownedSkills,
            ...(Array.isArray(legacy.ownedSkills) ? legacy.ownedSkills.filter(id => LEGACY_SKILL_IDS.has(id)) : [])
        ])];
        record.ownedItems = [...new Set([
            ...record.ownedItems,
            ...(Array.isArray(legacy.ownedItems) ? legacy.ownedItems.filter(id => LEGACY_RUNE_IDS.has(id)) : [])
        ])];
        record.cardCollection = normalizeCardCollection(legacy.cardCollection);
        record.equippedCards = normalizeCardLoadout(legacy.equippedCards, record.cardCollection);
        if (legacy.arenaCache && typeof legacy.arenaCache === 'object') {
            record.arenaCache = {
                earned: Math.max(0, Math.floor(Number(legacy.arenaCache.earned) || 0)),
                opened: Math.max(0, Math.floor(Number(legacy.arenaCache.opened) || 0)),
                lastMatchId: typeof legacy.arenaCache.lastMatchId === 'string' ? legacy.arenaCache.lastMatchId.slice(0, 64) : ''
            };
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

module.exports = { CATALOG, ONBOARDING_FLAGS, ProfileStore };
