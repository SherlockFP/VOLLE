// store.js — Tiny localStorage persistence for meta progression.
// Zero-build, no deps. One JSON blob under a single key.
// ponytail: tek JSON blob, merge ile backward compat.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES, DEFAULT_LOADOUT } from './skills.js';
import { AVATAR_SKINS } from './avatar.js';
import { CASES, KNIVES, canEquipKnife, rollCase } from './cosmetics.js';
import { createRankedState, recordRankedMatch as applyRankedMatch } from './ranked-service.js';
import {
    SEASON_CONTRACTS,
    claimSeasonContract,
    createSeasonContractState,
    progressSeasonContracts
} from './season-contracts.js';
import {
    activateXpBoost,
    applyXpBoost,
    createSocialState,
    getActiveCosmeticTrials,
    grantXpBoost,
    startCosmeticTrial
} from './social.js';
import { createSocialProfile } from './social-service.js';
import { DEFAULT_NETCODE, normalizeNetcode } from './experimental-netcode.js';

const KEY = 'dodgball_save_v2';
const PROFILE_TOKEN_KEY = 'dodgball_profile_token';

function buildCharacterProgress() {
    return Object.fromEntries(Object.keys(CHARACTERS).map(id => [id, { level: 1, xp: 0 }]));
}

function localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function previousLocalDateKey(value = new Date()) {
    const date = new Date(value);
    date.setDate(date.getDate() - 1);
    return localDateKey(date);
}

// Battlepass tier reward'ları (50 tier). Her tier'da bir reward.
function buildBattlepassRewards() {
    const rewards = [];
    const charIds = Object.keys(CHARACTERS).filter(id => id !== 'rally');
    const ballIds = ['fire','ice','lightning','bomb','star','rainbow'];
    const skillIds = Object.keys(SKILLS);
    const runeIds = Object.keys(RUNES);
    for (let i = 1; i <= 50; i++) {
        if (i % 10 === 0) rewards.push({ tier: i, type: 'character', id: charIds[(i/10-1) % charIds.length], name: `Character unlock` });
        else if (i % 5 === 0) rewards.push({ tier: i, type: 'ball', id: ballIds[(i/5-1) % ballIds.length], name: `Ball skin` });
        else if (i % 3 === 0) rewards.push({ tier: i, type: 'skill', id: skillIds[i % skillIds.length], name: `Skill unlock` });
        else if (i % 2 === 0) rewards.push({ tier: i, type: 'rune', id: runeIds[(i/2-1) % runeIds.length], name: `Rune unlock` });
        else rewards.push({ tier: i, type: 'currency', amount: 50, name: `+50 coins` });
    }
    return rewards;
}

const BATTLEPASS_REWARDS = buildBattlepassRewards();

const DEFAULTS = {
    currency: 200,
    gems: 0,
    xp: 0,
    level: 1,
    ownedItems: [],         // ball skin + rune ids
    ownedSkills: ['slow'],  // skill ids (slow default)
    unlockedChars: Object.keys(CHARACTERS),
    characterProgress: buildCharacterProgress(),
    selectedChar: 'rally',
    equippedBall: 'classic',
    ownedBalls: ['classic'],
    loadout: { ...DEFAULT_LOADOUT },
    battlepass: { tier: 0, xp: 0, claimed: [], premium: false },
    customAvatar: null,
    ownedAvatarSkins: ['default'],
    equippedAvatarSkin: 'default',
    ownedKnives: ['training'],
    equippedKnives: { red: 'training', blue: 'training' },
    knifeStats: {},
    cosmeticLoadout: {
        version: 2,
        knife: { id: 'training', stickers: [null, null, null, null], charm: null, nameTag: '', patternSeed: 0, wear: 0 },
        mvpEffect: 'none',
        ballTrail: 'none',
        goalEffect: 'none'
    },
    cosmeticInventory: {
        stickers: ['ace', 'bolt', 'gg', 'star'],
        charms: ['ball', 'glove'],
        mvpEffects: ['none', 'confetti'],
        ballTrails: ['none', 'comet'],
        goalEffects: ['none', 'burst'],
        duplicates: {}
    },
    dailyRewards: { lastLoginClaim: '', loginStreak: 0, lastFreeCase: '' },
    casePity: {},
    seasonContracts: createSeasonContractState(),
    movementTrials: { best: {}, rewarded: [] },
    customMaps: [],
    crosshairSettings: {
        style: 'cross',
        color: '#36d8ca',
        size: 12,
        gap: 6,
        thickness: 2,
        dot: true,
        outline: true,
        outlineThickness: 1,
        opacity: 1,
        dynamicGap: 6
    },
    mouseSensitivity: 2,
    rankedState: createRankedState(),
    socialState: createSocialState(),
    socialProfile: createSocialProfile(),
    experimentalNetcode: { ...DEFAULT_NETCODE },
    settings: {
        sensitivity: 2, volume: 50, musicVolume: 2, soundVolume: 50, botDifficulty: 'hard', fov: 75,
        quality: 'medium', autoQuality: true, publicDiagnostics: true, reduceMotion: false, screenShake: true,
        screenFlash: true, highContrast: false, colorBlind: 'none', keybinds: {}
    },
    stats: { gamesPlayed: 0, totalWins: 0, totalDeflects: 0, totalHits: 0, bestRally: 0, totalSpent: 0, winStreak: 0, rankedElo: 1000, rankedGames: 0 },
    unlockedAchievements: [],
    playerName: 'Player',
    onboardingSeen: false
};

class StoreClass {
    constructor() {
        this.data = this._read();
        this.remoteReady = false;
        this.profileToken = '';
    }

    _read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return structuredClone(DEFAULTS);
            const parsed = JSON.parse(raw);
            const legacyElo = Math.min(5000, Math.max(0,
                Number(parsed.rankedState?.elo ?? parsed.elo ?? parsed.stats?.rankedElo ?? 1000) || 1000
            ));
            // Deep merge — yeni key'ler eski save'lerde de olsun
            return { ...structuredClone(DEFAULTS), ...parsed,
                settings: {
                    ...DEFAULTS.settings,
                    ...(parsed.settings || {}),
                    musicVolume: Number(parsed.settings?.musicVolume ?? parsed.settings?.volume ?? DEFAULTS.settings.musicVolume),
                    soundVolume: Number(parsed.settings?.soundVolume ?? parsed.settings?.volume ?? DEFAULTS.settings.soundVolume)
                },
                loadout: {
                    ...DEFAULTS.loadout,
                    ...(parsed.loadout || {}),
                    char: CHARACTERS[parsed.loadout?.char] ? parsed.loadout.char : DEFAULTS.selectedChar,
                    runes: Array.isArray(parsed.loadout?.runes)
                        ? parsed.loadout.runes.filter(id => RUNES[id]).slice(0, 1)
                        : DEFAULTS.loadout.runes
                },
                crosshairSettings: { ...DEFAULTS.crosshairSettings, ...(parsed.crosshairSettings||{}) },
                selectedChar: CHARACTERS[parsed.selectedChar] ? parsed.selectedChar : DEFAULTS.selectedChar,
                characterProgress: { ...DEFAULTS.characterProgress, ...(parsed.characterProgress||{}) },
                battlepass: { ...DEFAULTS.battlepass, ...(parsed.battlepass||{}) },
                stats: { ...DEFAULTS.stats, ...(parsed.stats||{}) },
                rankedState: parsed.rankedState || createRankedState({ elo: Math.round(legacyElo) }),
                unlockedChars: Object.keys(CHARACTERS),
                ownedAvatarSkins: parsed.ownedAvatarSkins || DEFAULTS.ownedAvatarSkins,
                ownedKnives: Array.isArray(parsed.ownedKnives) ? parsed.ownedKnives.filter(id => KNIVES[id]) : DEFAULTS.ownedKnives,
                equippedKnives: { ...DEFAULTS.equippedKnives, ...(parsed.equippedKnives || {}) },
                knifeStats: parsed.knifeStats && typeof parsed.knifeStats === 'object' ? parsed.knifeStats : {},
                dailyRewards: { ...DEFAULTS.dailyRewards, ...(parsed.dailyRewards || {}) },
                casePity: parsed.casePity && typeof parsed.casePity === 'object' ? parsed.casePity : {},
                seasonContracts: createSeasonContractState(parsed.seasonContracts),
                movementTrials: {
                    best: parsed.movementTrials?.best && typeof parsed.movementTrials.best === 'object'
                        ? parsed.movementTrials.best
                        : {},
                    rewarded: Array.isArray(parsed.movementTrials?.rewarded) ? parsed.movementTrials.rewarded : []
                },
                socialProfile: createSocialProfile(parsed.socialProfile),
                experimentalNetcode: normalizeNetcode(parsed.experimentalNetcode)
            };
        } catch {
            return structuredClone(DEFAULTS);
        }
    }

    load() { this.data = this._read(); return this.data; }
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }

    get(key) { return this.data[key]; }
    set(key, val) { this.data[key] = val; this.save(); }
    recordRankedMatch(result) {
        this.data.rankedState = applyRankedMatch(this.data.rankedState || createRankedState(), result);
        this.data.elo = this.data.rankedState.elo;
        this.data.stats.rankedElo = this.data.rankedState.elo;
        this.data.stats.rankedGames = this.data.rankedState.currentSeason.record.games;
        this.save();
        return this.data.rankedState;
    }

    addKnifeKill(knifeId, amount = 1) {
        if (!KNIVES[knifeId]) return 0;
        const current = Math.max(0, Number(this.data.knifeStats?.[knifeId]) || 0);
        const next = current + Math.max(0, Math.floor(Number(amount) || 0));
        this.data.knifeStats = { ...(this.data.knifeStats || {}), [knifeId]: next };
        this.save();
        return next;
    }

    async connectRemote(playerName = this.data.playerName) {
        if (typeof fetch !== 'function') return false;
        try {
            const token = localStorage.getItem(PROFILE_TOKEN_KEY) || '';
            const legacy = token ? undefined : {
                currency: this.data.currency,
                gems: this.data.gems,
                unlockedChars: this.data.unlockedChars,
                ownedBalls: this.data.ownedBalls,
                ownedSkills: this.data.ownedSkills,
                ownedItems: this.data.ownedItems,
                ownedAvatarSkins: this.data.ownedAvatarSkins
            };
            const response = await fetch('/api/profile/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, playerName, legacy })
            });
            if (!response.ok) return false;
            const result = await response.json();
            if (!result.token || !result.profile) return false;
            this.profileToken = result.token;
            localStorage.setItem(PROFILE_TOKEN_KEY, result.token);
            this._applyRemoteProfile(result.profile);
            this.remoteReady = true;
            return true;
        } catch {
            return false;
        }
    }

    _applyRemoteProfile(profile) {
        const fields = [
            'currency', 'gems', 'ownedBalls',
            'ownedSkills', 'ownedItems', 'ownedAvatarSkins', 'economyRevision'
        ];
        fields.forEach(field => {
            if (profile[field] !== undefined) this.data[field] = profile[field];
        });
        this.save();
    }

    async purchase(kind, id) {
        if (!this.remoteReady) {
            if (kind === 'character') return this.buyCharacter(id);
            if (kind === 'ball') return this.buyBall(id);
            if (kind === 'skill') return this.buySkill(id);
            if (kind === 'rune') return this.buyRune(id);
            if (kind === 'avatar') return this.buyAvatarSkin(id);
            return false;
        }
        try {
            const requestId = `purchase:${kind}:${id}`;
            const response = await fetch('/api/profile/purchase', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.profileToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ kind, id, requestId })
            });
            if (!response.ok) return false;
            const result = await response.json();
            this._applyRemoteProfile(result.profile);
            return true;
        } catch {
            return false;
        }
    }

    async grantMatchRemote(match) {
        if (!this.remoteReady) return false;
        const receipt = match?.receipt;
        const signature = match?.signature;
        if (!receipt || typeof signature !== 'string') return false;
        try {
            const response = await fetch('/api/profile/reward', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.profileToken}`,
                    'X-Match-Signature': signature,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ receipt })
            });
            if (!response.ok) return false;
            const result = await response.json();
            this._applyRemoteProfile(result.profile);
            return true;
        } catch {
            return false;
        }
    }

    async publishMap(config, mapId = '', description = '') {
        if (!this.remoteReady) return { ok: false, error: 'Profile service unavailable' };
        try {
            const response = await fetch('/api/maps', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.profileToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config, mapId, description })
            });
            const result = await response.json();
            return response.ok
                ? { ok: true, map: result.map, replayed: result.replayed === true }
                : { ok: false, error: result.error || 'Publish failed' };
        } catch {
            return { ok: false, error: 'Publish service unavailable' };
        }
    }

    async listPublishedMaps({ mine = false, cursor = '', limit = 20, query = '', sort = 'newest' } = {}) {
        try {
            const params = new URLSearchParams({
                mine: mine ? '1' : '0',
                cursor: String(cursor || ''),
                limit: String(Math.max(1, Math.min(50, Number(limit) || 20))),
                q: String(query || '').slice(0, 48),
                sort: ['newest', 'oldest', 'name'].includes(sort) ? sort : 'newest'
            });
            const headers = this.profileToken
                ? { 'Authorization': `Bearer ${this.profileToken}` }
                : {};
            const response = await fetch(`/api/maps?${params}`, { headers });
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                return { maps: [], nextCursor: null, error: result.error || 'Workshop unavailable' };
            }
            return response.json();
        } catch {
            return { maps: [], nextCursor: null, error: 'Workshop unavailable' };
        }
    }

    async getPublishedMap(mapId) {
        if (typeof mapId !== 'string' || !mapId) return null;
        try {
            const headers = this.profileToken
                ? { 'Authorization': `Bearer ${this.profileToken}` }
                : {};
            const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}`, { headers });
            if (!response.ok) return null;
            const result = await response.json();
            return result.map || null;
        } catch {
            return null;
        }
    }

    async votePublishedMap(mapId, value) {
        if (!this.remoteReady || typeof mapId !== 'string' || !mapId || ![-1, 0, 1].includes(value)) {
            return { ok: false, error: 'Workshop vote unavailable' };
        }
        try {
            const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/vote`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.profileToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ value })
            });
            const result = await response.json();
            return response.ok
                ? { ok: true, map: result.map }
                : { ok: false, error: result.error || 'Vote failed' };
        } catch {
            return { ok: false, error: 'Workshop vote unavailable' };
        }
    }

    // Award coins + xp, handle level-ups + battlepass tier dolum.
    grant({ currency = 0, xp = 0, gems = 0 } = {}) {
        this.data.currency += currency;
        this.data.gems += gems;
        this.data.xp += xp;
        this.data.battlepass.xp += xp;
        let leveledUp = false;
        let need = this._xpForLevel(this.data.level);
        while (this.data.xp >= need) {
            this.data.xp -= need;
            this.data.level++;
            leveledUp = true;
            need = this._xpForLevel(this.data.level);
        }
        // Battlepass tier dolum (100xp = 1 tier)
        while (this.data.battlepass.xp >= 100) {
            this.data.battlepass.xp -= 100;
            if (this.data.battlepass.tier < 50) this.data.battlepass.tier++;
        }
        this.save();
        return { leveledUp, level: this.data.level };
    }

    _xpForLevel(lvl) { return 100 + (lvl - 1) * 50; }

    owns(id) {
        return this.data.ownedItems.includes(id)
            || this.data.unlockedChars.includes(id)
            || this.data.ownedBalls.includes(id)
            || this.data.ownedSkills.includes(id);
    }

    ownsCharacter(charId) { return Boolean(CHARACTERS[charId]); }
    ownsBall(ballId) { return this.data.ownedBalls.includes(ballId); }
    ownsSkill(skillId) { return this.data.ownedSkills.includes(skillId); }
    ownsAvatarSkin(skinId) { return (this.data.ownedAvatarSkins || []).includes(skinId); }

    _socialUserId() {
        return String(this.data.playerName || 'player')
            .replace(/[^A-Za-z0-9_.:-]/g, '-')
            .replace(/^-+/, '')
            .slice(0, 48) || 'player';
    }

    hasAvatarAccess(skinId) {
        return this.ownsAvatarSkin(skinId)
            || getActiveCosmeticTrials(this.data.socialState, this._socialUserId(), Date.now())
                .some(trial => trial.cosmeticId === skinId);
    }

    startAvatarTrial(skinId) {
        if (!AVATAR_SKINS[skinId] || this.ownsAvatarSkin(skinId)) return false;
        try {
            this.data.socialState = startCosmeticTrial(this.data.socialState, {
                userId: this._socialUserId(),
                cosmeticId: skinId,
                startedAt: Date.now(),
                durationMs: 15 * 60 * 1000
            });
            this.data.equippedAvatarSkin = skinId;
            this.save();
            return true;
        } catch {
            return false;
        }
    }

    buyAndActivateXpBoost() {
        const price = 120;
        if (this.data.currency < price) return false;
        const userId = this._socialUserId();
        const boostId = `boost-${Date.now()}`;
        try {
            let social = grantXpBoost(this.data.socialState, {
                userId,
                boostId,
                quantity: 1,
                multiplier: 1.5,
                durationMs: 60 * 60 * 1000
            });
            social = activateXpBoost(social, { userId, boostId, activatedAt: Date.now() });
            this.data.socialState = social;
            this.data.currency -= price;
            this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + price;
            this.save();
            return true;
        } catch {
            return false;
        }
    }

    boostedXp(baseXp) {
        return applyXpBoost(this.data.socialState, {
            userId: this._socialUserId(),
            baseXp: Math.max(0, Math.floor(baseXp)),
            at: Date.now()
        });
    }

    buyAvatarSkin(skinId) {
        const skin = AVATAR_SKINS[skinId];
        if (!skin || this.ownsAvatarSkin(skinId) || this.data.currency < skin.price) return false;
        this.data.currency -= skin.price;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + skin.price;
        this.data.ownedAvatarSkins.push(skinId);
        this.save();
        return true;
    }

    equipAvatarSkin(skinId) {
        if (!this.hasAvatarAccess(skinId)) return false;
        this.data.equippedAvatarSkin = skinId;
        this.save();
        return true;
    }

    _openCase(caseId, random = Math.random, free = false) {
        const box = CASES[caseId];
        if (!box || (!free && this.data.currency < box.price)) return null;
        const pityBefore = Math.min(9, Math.max(0, Number(this.data.casePity?.[caseId]) || 0));
        const guaranteed = pityBefore >= 9;
        const reward = rollCase(caseId, random, guaranteed ? { minimumRarity: 'epic' } : {});
        if (!reward) return null;
        if (!free) {
            this.data.currency -= box.price;
            this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + box.price;
        }
        const isAvatar = reward.type === 'avatar';
        const owned = isAvatar ? this.data.ownedAvatarSkins : this.data.ownedKnives;
        const duplicate = owned.includes(reward.id);
        const refund = duplicate ? (free ? 35 : Math.floor(box.price * 0.35)) : 0;
        if (refund) this.data.currency += refund;
        else if (owned.length < 64) owned.push(reward.id);
        const premium = reward.rarity === 'epic' || reward.rarity === 'legendary';
        this.data.casePity = { ...(this.data.casePity || {}), [caseId]: premium ? 0 : pityBefore + 1 };
        this.save();
        return {
            reward,
            duplicate,
            refund,
            free,
            pity: { before: pityBefore, after: this.data.casePity[caseId], guaranteed }
        };
    }

    openCase(caseId, random = Math.random) {
        return this._openCase(caseId, random, false);
    }

    getCasePityState(caseId) {
        const count = Math.min(9, Math.max(0, Number(this.data.casePity?.[caseId]) || 0));
        return { count, threshold: 10, remaining: 10 - count, nextGuaranteed: count >= 9 };
    }

    getSeasonContracts() {
        this.data.seasonContracts = createSeasonContractState(this.data.seasonContracts);
        return SEASON_CONTRACTS.map(contract => ({
            ...contract,
            progress: this.data.seasonContracts.progress[contract.id],
            claimed: this.data.seasonContracts.claimed.includes(contract.id)
        }));
    }

    progressSeasonContracts(context) {
        this.data.seasonContracts = progressSeasonContracts(this.data.seasonContracts, context);
        this.save();
        return this.getSeasonContracts();
    }

    claimSeasonContract(contractId) {
        const result = claimSeasonContract(this.data.seasonContracts, contractId);
        if (!result.reward) return 0;
        this.data.seasonContracts = result.state;
        this.data.currency += result.reward;
        this.save();
        return result.reward;
    }

    getMovementTrialBest(trialId) {
        return this.data.movementTrials?.best?.[trialId] || null;
    }

    saveMovementTrialResult(trial, record) {
        if (!trial || !record || record.trialId !== trial.id || !Number.isFinite(record.time)) {
            return { personalBest: false, reward: 0 };
        }
        const trials = this.data.movementTrials || { best: {}, rewarded: [] };
        const previous = trials.best?.[trial.id];
        const personalBest = !previous || record.time < previous.time;
        if (personalBest) {
            trials.best = {
                ...(trials.best || {}),
                [trial.id]: {
                    trialId: trial.id,
                    time: Math.max(0, Math.round(record.time)),
                    distance: Math.max(0, Number(record.distance) || 0),
                    peakSpeed: Math.max(0, Number(record.peakSpeed) || 0),
                    rocketJumps: Math.max(0, Math.round(Number(record.rocketJumps) || 0)),
                    samples: Array.isArray(record.samples) ? record.samples.slice(0, 750) : []
                }
            };
        }
        const firstClear = !trials.rewarded.includes(trial.id);
        if (firstClear) trials.rewarded.push(trial.id);
        const reward = firstClear ? trial.reward : 0;
        this.data.currency += reward;
        this.data.movementTrials = trials;
        this.save();
        return { personalBest, reward };
    }

    getDailyRewardState(now = new Date()) {
        const today = localDateKey(now);
        const rewards = this.data.dailyRewards || structuredClone(DEFAULTS.dailyRewards);
        const nextStreak = rewards.lastLoginClaim === previousLocalDateKey(now)
            ? Math.min(7, (rewards.loginStreak || 0) + 1)
            : rewards.lastLoginClaim === today
                ? Math.max(1, rewards.loginStreak || 1)
                : 1;
        return {
            today,
            loginClaimed: rewards.lastLoginClaim === today,
            freeCaseClaimed: rewards.lastFreeCase === today,
            streak: nextStreak,
            loginCoins: 40 + nextStreak * 10
        };
    }

    claimDailyLogin(now = new Date()) {
        const state = this.getDailyRewardState(now);
        if (!state.today || state.loginClaimed) return null;
        this.data.dailyRewards = {
            ...(this.data.dailyRewards || DEFAULTS.dailyRewards),
            lastLoginClaim: state.today,
            loginStreak: state.streak
        };
        this.data.currency += state.loginCoins;
        this.save();
        return { coins: state.loginCoins, streak: state.streak };
    }

    openDailyCase(caseId = 'kickoff', random = Math.random, now = new Date()) {
        const state = this.getDailyRewardState(now);
        if (!state.today || state.freeCaseClaimed) return null;
        const result = this._openCase(caseId, random, true);
        if (!result) return null;
        this.data.dailyRewards = {
            ...(this.data.dailyRewards || DEFAULTS.dailyRewards),
            lastFreeCase: state.today
        };
        this.save();
        return result;
    }

    equipKnife(knifeId, team) {
        if (!['red', 'blue'].includes(team) || !this.data.ownedKnives.includes(knifeId) || !canEquipKnife(knifeId, team)) return false;
        this.data.equippedKnives[team] = knifeId;
        this.save();
        return true;
    }

    // Karakter satın al
    buyCharacter(charId) {
        const c = CHARACTERS[charId];
        if (!c) return false;
        if (this.ownsCharacter(charId)) return false;
        if (this.data.currency < c.price) return false;
        this.data.currency -= c.price;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + c.price;
        this.data.unlockedChars.push(charId);
        this.save();
        return true;
    }

    // Top skin satın al
    buyBall(ballId) {
        if (this.ownsBall(ballId)) return false;
        if (this.data.currency < 150) return false;
        this.data.currency -= 150;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + 150;
        this.data.ownedBalls.push(ballId);
        this.save();
        return true;
    }

    // Skill satın al
    buySkill(skillId) {
        if (this.ownsSkill(skillId)) return false;
        if (this.data.currency < 100) return false;
        this.data.currency -= 100;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + 100;
        this.data.ownedSkills.push(skillId);
        this.save();
        return true;
    }

    // Rune satın al
    buyRune(runeId) {
        if (this.owns(runeId)) return false;
        if (this.data.currency < 80) return false;
        this.data.currency -= 80;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + 80;
        this.data.ownedItems.push(runeId);
        this.save();
        return true;
    }

    // Loadout ayarla
    setLoadout(loadout) {
        if (loadout.char && !this.ownsCharacter(loadout.char)) return false;
        if (loadout.skill && !this.ownsSkill(loadout.skill)) return false;
        const runes = Array.isArray(loadout.runes)
            ? loadout.runes.filter(id => RUNES[id] && this.owns(id)).slice(0, 1)
            : this.data.loadout.runes;
        this.data.loadout = { ...this.data.loadout, ...loadout, runes };
        if (loadout.char) this.data.selectedChar = loadout.char;
        if (loadout.ball) this.data.equippedBall = loadout.ball;
        this.save();
        return true;
    }

    // Battlepass tier reward claim
    claimBattlepassReward(tier) {
        if (tier > this.data.battlepass.tier) return null;
        if (this.data.battlepass.claimed.includes(tier)) return null;
        const reward = BATTLEPASS_REWARDS.find(r => r.tier === tier);
        if (!reward) return null;
        this.data.battlepass.claimed.push(tier);
        switch (reward.type) {
            case 'currency': this.data.currency += reward.amount; break;
            case 'character': if (!this.ownsCharacter(reward.id)) this.data.unlockedChars.push(reward.id); break;
            case 'ball': if (!this.ownsBall(reward.id)) this.data.ownedBalls.push(reward.id); break;
            case 'skill': if (!this.ownsSkill(reward.id)) this.data.ownedSkills.push(reward.id); break;
            case 'rune': if (!this.data.ownedItems.includes(reward.id)) this.data.ownedItems.push(reward.id); break;
        }
        this.save();
        return reward;
    }

    getBattlepassRewards() { return BATTLEPASS_REWARDS; }
    getBattlepassProgress() { return this.data.battlepass; }

    // İstatistik güncelle + win streak + ranked ELO
    recordGame({ won = false, deflects = 0, hits = 0, rally = 0, ranked = false, opponentElo = 1000, characterId = 'rally', characterXp = 0 } = {}) {
        this.data.stats.gamesPlayed++;
        if (won) {
            this.data.stats.totalWins++;
            this.data.stats.winStreak = (this.data.stats.winStreak || 0) + 1;
        } else {
            this.data.stats.winStreak = 0;
        }
        this.data.stats.totalDeflects += deflects;
        this.data.stats.totalHits += hits;
        this.data.stats.bestRally = Math.max(this.data.stats.bestRally, rally);
        // Ranked ELO güncelle
        if (ranked) {
            this.data.stats.rankedGames = (this.data.stats.rankedGames || 0) + 1;
            const myElo = this.data.stats.rankedElo || 1000;
            // ponytail: import cycle risk → inline ELO formülü
            const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
            const score = won ? 1 : 0;
            this.data.stats.rankedElo = Math.round(myElo + 32 * (score - expected));
        }
        const progress = this.data.characterProgress[characterId] || { level: 1, xp: 0 };
        const previousLevel = progress.level;
        progress.xp += characterXp;
        while (progress.level < 10 && progress.xp >= progress.level * 250) {
            progress.xp -= progress.level * 250;
            progress.level++;
        }
        this.data.characterProgress[characterId] = progress;
        this.save();
        return { masteryLevel: progress.level, masteryLeveledUp: progress.level > previousLevel };
    }

    getCharacterProgress(charId) {
        return this.data.characterProgress[charId] || { level: 1, xp: 0 };
    }

    getElo() { return this.data.rankedState?.elo ?? this.data.stats.rankedElo ?? 1000; }
    getWinStreak() { return this.data.stats.winStreak || 0; }

    reset() { this.data = structuredClone(DEFAULTS); this.save(); }
}

export const Store = new StoreClass();
