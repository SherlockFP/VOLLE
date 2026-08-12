// store.js — Tiny localStorage persistence for meta progression.
// Zero-build, no deps. One JSON blob under a single key.
// ponytail: tek JSON blob, merge ile backward compat.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES, DEFAULT_LOADOUT } from './skills.js';
import { AVATAR_SKINS } from './avatar.js';
import { CASES, KNIVES, canEquipKnife, resolveCaseReward, rollCase } from './cosmetics.js';
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
import { COSMETICS, DEFAULT_WEARABLE_LOADOUT, normalizeWearableLoadout } from './cosmetic-catalog.js';
import {
    BALL_PRICES,
    FREE_TRACK as BATTLEPASS_FREE_TRACK,
    PREMIUM_TRACK as BATTLEPASS_PREMIUM_TRACK,
    PREMIUM_PASS_PRICE,
    addXp as addBattlepassXp,
    applySeasonRollover as applyBattlepassSeasonRollover,
    claimReward as claimBattlepassRewardPure,
    createSeason as createBattlepassSeason,
    normalizeProgress as normalizeBattlepassProgress,
    xpForTier as battlepassXpForTier
} from './battlepass.js';
import { Daily, DAILY_CHALLENGE_XP, DAILY_ALL_COMPLETE_BONUS_XP, dailyXpAward } from './daily.js';
import { applyAccountXp, xpForLevel } from './prestige.js';
import { account } from './account.js';
import {
    DEFAULT_CARD_COLLECTION,
    DEFAULT_CARD_LOADOUT,
    cardForEffect,
    grantArenaCache,
    normalizeCardCollection,
    normalizeCardLoadout,
    resolveCardEffects,
    shouldAwardArenaCache,
    tradeUpCards
} from './cards.js';

const KEY = 'dodgball_save_v2';
const CASE_OPEN_REQUEST_TTL_MS = 10 * 60 * 1000;
const CASE_OPEN_REQUEST_MAX = 12;

export function isDefinitiveCaseOpenRejection(status) {
    return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408;
}

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

// UTC-day helpers — retention features (first-of-day match bonus, login
// streak badge) key off UTC so the day boundary can't be gamed by flipping
// the device clock/timezone. Deliberately separate from localDateKey/
// previousLocalDateKey above, which the existing local-only Daily Login
// card (claimDailyLogin/getDailyRewardState) still uses unchanged.
function utcDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function previousUtcDateKey(value = new Date()) {
    const ts = (value instanceof Date ? value.getTime() : new Date(value).getTime()) - 86400000;
    return utcDateKey(ts);
}

// Free earning route (docs/V3_ECONOMY.md "First match of day"): today's
// first completed match pays a flat bonus regardless of win/loss. Guests
// track this locally (DEFAULTS.lastFirstMatchDay below); account players
// get the server-owned equivalent in server/profile-store.js#reward
// (client is never trusted for that path).
export const FIRST_MATCH_OF_DAY_BONUS = 80;

// Main-menu login-streak badge — UTC-day consecutive counter, +20/day with
// a +150 bonus every 7th day (cycles, does not cap). Independent of the
// Daily Challenges screen's local-only "Daily Login" card above (different
// UI surface, different formula, different persisted field).
export const LOGIN_STREAK_DAILY_COINS = 20;
export const LOGIN_STREAK_DAY7_COINS = 150;
export const LOGIN_STREAK_CYCLE = 7;

// Pure: given persisted lastFirstMatchDay and "now", decides whether today's
// match is the first-of-day without mutating anything.
export function isFirstMatchOfDay(lastFirstMatchDay, now = new Date()) {
    const today = utcDateKey(now);
    return !!today && lastFirstMatchDay !== today;
}

export function loginStreakReward(day) {
    return day > 0 && day % LOGIN_STREAK_CYCLE === 0 ? LOGIN_STREAK_DAY7_COINS : LOGIN_STREAK_DAILY_COINS;
}

// Pure: mirrors getDailyRewardState's "prospective streak" shape below but
// UTC-keyed and uncapped. `claimed` tells the badge to render the passive
// "✓ Day N" state instead of the claim CTA.
export function computeStreakState(streak, now = new Date()) {
    const today = utcDateKey(now);
    const last = streak?.lastClaimDay || '';
    const prevCount = Math.max(0, Math.floor(Number(streak?.count) || 0));
    const claimed = !!today && last === today;
    const day = claimed
        ? Math.max(1, prevCount)
        : last === previousUtcDateKey(now)
            ? prevCount + 1
            : 1;
    return { today, day, claimed, reward: loginStreakReward(day) };
}

const DEFAULTS = {
    currency: 200,
    gems: 0,
    xp: 0,
    level: 1,
    prestige: 0,           // Call of Duty style prestige rank (js/prestige.js)
    ownedItems: [],         // ball skin + rune ids
    ownedSkills: ['slow'],  // skill ids (slow default)
    unlockedChars: Object.keys(CHARACTERS),
    characterProgress: buildCharacterProgress(),
    selectedChar: 'rally',
    equippedBall: 'classic',
    ownedBalls: ['classic'],
    loadout: { ...DEFAULT_LOADOUT },
    battlepass: normalizeBattlepassProgress(),
    battlepassBoosts: {},
    battlepassActiveBoost: null,
    customAvatar: null,
    ownedAvatarSkins: ['default'],
    equippedAvatarSkin: 'default',
    ownedCosmetics: [],
    equippedWearables: { ...DEFAULT_WEARABLE_LOADOUT },
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
    lastFirstMatchDay: '',
    dailyStreak: { count: 0, lastClaimDay: '' },
    dailyChallenges: null,
    casePity: {},
    earnedCases: {},
    caseDropDrought: 0,
    cardCollection: { ...DEFAULT_CARD_COLLECTION },
    equippedCards: { ...DEFAULT_CARD_LOADOUT },
    arenaCache: { earned: 0, opened: 0, lastMatchId: '' },
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
    onboardingSeen: false,
    ftueSeen: false,
    ftueCompleted: false,
    ftueMatchHintsSeen: false
};

// Pure: whether the first-run welcome overlay should show, given the persisted flag.
export function shouldShowFtueWelcome(ftueSeen) {
    return ftueSeen !== true;
}

// Pure: whether the first-solo-match HUD hints should arm, given the persisted flag.
export function shouldArmFirstMatchHints(ftueMatchHintsSeen) {
    return ftueMatchHintsSeen !== true;
}

class StoreClass {
    constructor() {
        this.data = this._read();
        this.remoteReady = false;
        this.sessionToken = '';
        this.remoteAccountId = '';
        this._caseOpenRequests = new Map();
        this._caseOpenFlights = new Map();
        this.liveMarket = { offers: [], expiresAt: 0 };
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
                battlepass: normalizeBattlepassProgress(parsed.battlepass),
                stats: { ...DEFAULTS.stats, ...(parsed.stats||{}) },
                rankedState: parsed.rankedState || createRankedState({ elo: Math.round(legacyElo) }),
                unlockedChars: Object.keys(CHARACTERS),
                ownedAvatarSkins: parsed.ownedAvatarSkins || DEFAULTS.ownedAvatarSkins,
                ownedCosmetics: Array.isArray(parsed.ownedCosmetics)
                    ? parsed.ownedCosmetics.filter(id => COSMETICS[id])
                    : DEFAULTS.ownedCosmetics,
                equippedWearables: normalizeWearableLoadout(
                    parsed.equippedWearables,
                    parsed.ownedCosmetics || DEFAULTS.ownedCosmetics
                ),
                ownedKnives: Array.isArray(parsed.ownedKnives) ? parsed.ownedKnives.filter(id => KNIVES[id]) : DEFAULTS.ownedKnives,
                equippedKnives: { ...DEFAULTS.equippedKnives, ...(parsed.equippedKnives || {}) },
                knifeStats: parsed.knifeStats && typeof parsed.knifeStats === 'object' ? parsed.knifeStats : {},
                dailyRewards: { ...DEFAULTS.dailyRewards, ...(parsed.dailyRewards || {}) },
                dailyStreak: { ...DEFAULTS.dailyStreak, ...(parsed.dailyStreak || {}) },
                casePity: parsed.casePity && typeof parsed.casePity === 'object' ? parsed.casePity : {},
                earnedCases: parsed.earnedCases && typeof parsed.earnedCases === 'object' ? parsed.earnedCases : {},
                caseDropDrought: Math.min(4, Math.max(0, Math.floor(Number(parsed.caseDropDrought) || 0))),
                cardCollection: normalizeCardCollection(parsed.cardCollection),
                equippedCards: normalizeCardLoadout(parsed.equippedCards, parsed.cardCollection),
                arenaCache: {
                    ...DEFAULTS.arenaCache,
                    ...(parsed.arenaCache && typeof parsed.arenaCache === 'object' ? parsed.arenaCache : {})
                },
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
        const sessionToken = account.getToken();
        if (!sessionToken) return false;
        try {
            const response = await fetch('/api/profile/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
                body: JSON.stringify({ sessionToken, playerName })
            });
            if (!response.ok) return false;
            const result = await response.json();
            if (!result.sessionToken || !result.profile || !result.account) return false;
            this.sessionToken = result.sessionToken;
            this.remoteAccountId = String(result.account.id || '');
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
            'ownedSkills', 'ownedItems', 'ownedAvatarSkins', 'ownedKnives',
            'ownedCosmetics', 'casePity', 'earnedCases', 'caseDropDrought', 'equippedWearables', 'economyRevision', 'adRewards', 'dailyStreak', 'dailyChallenges',
            'cardCollection', 'equippedCards', 'arenaCache', 'rankedState', 'battlepass', 'battlepassBoosts', 'battlepassActiveBoost'
        ];
        fields.forEach(field => {
            if (profile[field] !== undefined) this.data[field] = profile[field];
        });
        this.data.equippedWearables = normalizeWearableLoadout(
            this.data.equippedWearables,
            this.data.ownedCosmetics
        );
        this.data.cardCollection = normalizeCardCollection(this.data.cardCollection);
        this.data.equippedCards = normalizeCardLoadout(this.data.equippedCards, this.data.cardCollection);
        this.data.arenaCache = {
            ...DEFAULTS.arenaCache,
            ...(this.data.arenaCache && typeof this.data.arenaCache === 'object' ? this.data.arenaCache : {})
        };
        this.data.battlepass = normalizeBattlepassProgress(this.data.battlepass);
        if (profile.battlepassBoosts && typeof profile.battlepassBoosts === 'object' && !Array.isArray(profile.battlepassBoosts)) {
            const userId = this._socialUserId();
            const current = this.data.socialState?.xpBoosts?.[userId] || { active: null };
            this.data.socialState = {
                ...this.data.socialState,
                xpBoosts: {
                    ...(this.data.socialState?.xpBoosts || {}),
                    [userId]: { active: current.active || null, inventory: { ...profile.battlepassBoosts } }
                }
            };
        }
        if (profile.rankedState && typeof profile.rankedState === 'object') {
            const elo = Number(profile.rankedState.elo);
            if (Number.isFinite(elo)) {
                this.data.elo = Math.round(elo);
                this.data.stats = this.data.stats || {};
                this.data.stats.rankedElo = this.data.elo;
                this.data.stats.rankedGames = Math.max(0, Math.floor(Number(profile.rankedState.currentSeason?.record?.games) || 0));
            }
        }
        this.data.earnedCases = this.data.earnedCases && typeof this.data.earnedCases === 'object' ? this.data.earnedCases : {};
        if (profile.onboarding && typeof profile.onboarding === 'object' && !Array.isArray(profile.onboarding)) {
            for (const flag of ['ftueSeen', 'ftueCompleted', 'ftueMatchHintsSeen']) {
                if (typeof profile.onboarding[flag] === 'boolean') this.data[flag] = profile.onboarding[flag];
            }
        }
        this.save();
    }

    async syncOnboarding(onboarding) {
        const updates = Object.fromEntries(Object.entries(onboarding || {})
            .filter(([flag, value]) => ['ftueSeen', 'ftueCompleted', 'ftueMatchHintsSeen'].includes(flag) && value === true));
        if (!Object.keys(updates).length) return false;
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return false;
        try {
            const response = await fetch('/api/profile/onboarding', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ onboarding: updates })
            });
            if (!response.ok) return false;
            const result = await response.json();
            if (result.profile) this._applyRemoteProfile(result.profile);
            return true;
        } catch {
            return false;
        }
    }

    async syncCosmeticLoadout(playerId) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return null;
        try {
            const response = await fetch('/api/profile/cosmetics/equip', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ playerId, loadout: this.data.equippedWearables })
            });
            if (!response.ok) return null;
            const result = await response.json();
            if (result.profile) this._applyRemoteProfile(result.profile);
            return typeof result.entitlement === 'string' ? result.entitlement : null;
        } catch {
            return null;
        }
    }

    async purchase(kind, id) {
        // Ability power is now card-collection-only. Keep old ownership arrays
        // readable for migration, but never add to them through currency.
        if (kind === 'skill' || kind === 'rune') return false;
        if (!this.remoteReady) {
            if (kind === 'character') return this.buyCharacter(id);
            if (kind === 'ball') return this.buyBall(id);
            if (kind === 'avatar') return this.buyAvatarSkin(id);
            if (kind === 'cosmetic') return this.buyCosmetic(id);
            return false;
        }
        try {
            const requestId = `purchase:${kind}:${id}`;
            const response = await fetch('/api/profile/purchase', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
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

    // Duplicated from server/profile-store.js (ponytail: server.js is CJS,
    // this is ESM — no shared import path without a build step). Both sides
    // must move together if the formula ever changes.
    // firstOfDay: today's first completed match bonus (docs/V3_ECONOMY.md
    // "First match of day") — additive, decided by the caller (guests via
    // claimFirstMatchOfDay() below; account players via the server's own
    // lastFirstMatchDay in server/profile-store.js#reward).
    matchRewardBreakdown({ won, kills = 0, deflects = 0, firstOfDay = false } = {}) {
        const base = won === true ? 120 : 40;
        const safeKills = Math.max(0, Math.floor(Number(kills) || 0));
        const safeDeflects = Math.max(0, Math.floor(Number(deflects) || 0));
        const bonus = Math.min(60, safeKills * 5 + safeDeflects * 1);
        const firstOfDayBonus = firstOfDay ? FIRST_MATCH_OF_DAY_BONUS : 0;
        return { base, bonus, firstOfDay: firstOfDayBonus, total: base + bonus + firstOfDayBonus };
    }

    // Guest/local path for the "first match of day" bonus above — mutates
    // lastFirstMatchDay at most once per UTC day. Called once per completed
    // match from js/main.js#awardMatchRewards before matchRewardBreakdown().
    claimFirstMatchOfDay(now = new Date()) {
        if (!isFirstMatchOfDay(this.data.lastFirstMatchDay, now)) return false;
        this.data.lastFirstMatchDay = utcDateKey(now);
        this.save();
        return true;
    }

    async beginMatchRemote(match) {
        if (!this.remoteReady) return false;
        const matchId = typeof match?.matchId === 'string' ? match.matchId : '';
        if (!matchId) return false;
        try {
            const response = await fetch('/api/matches/start', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId, mode: ['ranked', 'casual', 'solo'].includes(match.mode) ? match.mode : 'casual', lobbyCode: match.lobbyCode || '' })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) return false;
            if (result.profile) this._applyRemoteProfile(result.profile);
            return { ok: true, ...result };
        } catch {
            return false;
        }
    }

    async getMatchRemoteStatus(matchId) {
        if (!this.remoteReady || typeof matchId !== 'string' || !matchId) return false;
        try {
            const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}`, {
                headers: { 'Authorization': `Bearer ${this.sessionToken}` }
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) return false;
            if (result.profile) this._applyRemoteProfile(result.profile);
            return { ok: true, ...result };
        } catch {
            return false;
        }
    }

    async pollMatchRemote(matchId, { attempts = 6, delayMs = 1000 } = {}) {
        const total = Math.max(1, Math.min(12, Math.floor(Number(attempts) || 1)));
        for (let attempt = 0; attempt < total; attempt += 1) {
            const status = await this.getMatchRemoteStatus(matchId);
            if (!status) return { ok: false, pending: true };
            if (status.status === 'finalized' && status.completion) return { ok: true, pending: false, ...status };
            if (attempt + 1 < total) await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.min(5000, Number(delayMs) || 1000))));
        }
        return { ok: true, pending: true };
    }

    // Match rewards are authorized only after an authenticated start record.
    // Ranked results remain pending until the other authenticated participant
    // submits the reciprocal result.
    async grantMatchRemote(match) {
        if (!this.remoteReady) return false;
        const matchId = typeof match?.matchId === 'string' ? match.matchId : '';
        if (!matchId) return false;
        try {
            const response = await fetch('/api/matches/complete', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    matchId,
                    mode: ['ranked', 'casual', 'solo'].includes(match.mode) ? match.mode : 'casual',
                    lobbyCode: match.lobbyCode || '',
                    result: match.result,
                    won: match.won === true,
                    score: match.score,
                    deflections: match.deflections
                })
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 202) {
                // The first reciprocal reporter receives 202 while the other
                // participant is still settling. Wait on the bounded poll so
                // this client also receives the authoritative completion
                // delta (Daily telemetry/rewards), instead of silently losing
                // it in a detached promise.
                const settled = await this.pollMatchRemote(matchId);
                if (settled?.pending === false && settled.completion) {
                    const completion = settled.completion;
                    return {
                        ok: true,
                        pending: false,
                        cardReward: completion.cardReward || null,
                        earnedCase: completion.earnedCase || null,
                        earnedCaseSource: completion.earnedCaseSource || null,
                        dailyProgress: completion.dailyProgress || null,
                        replayed: settled.replayed === true,
                        rankedState: completion.rankedState || settled.profile?.rankedState || null
                    };
                }
                return { ok: true, pending: true, ...result };
            }
            if (!response.ok) return false;
            if (result.profile) this._applyRemoteProfile(result.profile);
            const completion = result.completion || result;
            return { ok: true, pending: false, cardReward: completion.cardReward || null, earnedCase: completion.earnedCase || null, earnedCaseSource: completion.earnedCaseSource || null, dailyProgress: completion.dailyProgress || null, replayed: result.replayed === true, rankedState: completion.rankedState || result.profile?.rankedState || null };
        } catch {
            return false;
        }
    }

    getAdRewardStatus() {
        return this.data.adRewards || { remaining: 0, cap: 5, cooldownRemainingMs: 0 };
    }

    async claimAdReward(requestId) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) {
            return { ok: false, error: 'offline' };
        }
        try {
            const response = await fetch('/api/profile/ad-reward', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ requestId })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                return { ok: false, error: result.error || 'ad reward unavailable', retryAfterMs: result.retryAfterMs };
            }
            this._applyRemoteProfile(result.profile);
            return { ok: true, coins: result.coins, remaining: result.remaining, cap: result.cap };
        } catch {
            return { ok: false, error: 'network error' };
        }
    }

    getLoginStreakState(now = new Date()) {
        return computeStreakState(this.data.dailyStreak, now);
    }

    // Guest/local claim — coin-only grant (no XP), mirrors claimDailyLogin's
    // shape but UTC-keyed and uncapped (see computeStreakState above).
    _claimLoginStreakLocal(now = new Date()) {
        const state = computeStreakState(this.data.dailyStreak, now);
        if (state.claimed) return { ok: false, error: 'already claimed today' };
        this.data.dailyStreak = { count: state.day, lastClaimDay: state.today };
        this.data.currency += state.reward;
        this.save();
        return { ok: true, day: state.day, reward: state.reward };
    }

    // Account players claim server-side (server owns lastClaimDay — never
    // trust the client); guests/pre-sync fall back to the local path so the
    // badge always works offline. See server/profile-store.js#streakClaim
    // and server.js /api/profile/streak-claim.
    async claimLoginStreak(requestId, now = new Date()) {
        if (!this.remoteReady) return this._claimLoginStreakLocal(now);
        try {
            const response = await fetch('/api/profile/streak-claim', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ requestId })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                return { ok: false, error: result.error || 'streak claim unavailable' };
            }
            this._applyRemoteProfile(result.profile);
            return { ok: true, day: result.day, reward: result.reward };
        } catch {
            return { ok: false, error: 'network error' };
        }
    }

    getLiveMarket() {
        return this.liveMarket;
    }

    async refreshLiveMarket() {
        try {
            const response = await fetch('/api/live-market');
            if (!response.ok) return false;
            const market = await response.json();
            if (!Array.isArray(market.offers) || !Number.isFinite(market.expiresAt)) return false;
            this.liveMarket = market;
            return true;
        } catch {
            return false;
        }
    }

    async purchaseLiveOffer(offerId) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return false;
        try {
            const requestId = `live:${String(offerId).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64)}`;
            const response = await fetch('/api/profile/live-market/purchase', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ offerId, requestId })
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
                    'Authorization': `Bearer ${this.sessionToken}`,
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
            const headers = this.sessionToken
                ? { 'Authorization': `Bearer ${this.sessionToken}` }
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
            const headers = this.sessionToken
                ? { 'Authorization': `Bearer ${this.sessionToken}` }
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
                    'Authorization': `Bearer ${this.sessionToken}`,
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

    // Award coins + xp, handle level-ups + battlepass tier fill (this is the
    // match-end hook: js/main.js calls Store.grant({ currency, xp }) once per game).
    // Account levelling, including the prestige roll at MAX_LEVEL, is delegated to
    // js/prestige.js so the XP curve lives in exactly one place.
    grant({ currency = 0, xp = 0, gems = 0 } = {}) {
        this.data.currency += currency;
        this.data.gems += gems;
        const account = applyAccountXp(
            { level: this.data.level, xp: this.data.xp, prestige: this.data.prestige },
            xp
        );
        this.data.level = account.level;
        this.data.xp = account.xp;
        this.data.prestige = account.prestige;
        // Account battle-pass state is server-owned. Do not show optimistic
        // local progress that the authoritative profile can later revoke.
        if (!this.remoteReady) {
            this._rolloverBattlepassSeason();
            const { state } = addBattlepassXp(this.data.battlepass, xp);
            this.data.battlepass = state;
        }
        this.save();
        return {
            leveledUp: account.leveledUp,
            level: account.level,
            prestige: account.prestige,
            prestiged: account.prestiged
        };
    }

    // Arena Caches are an earn-only collection route. The match id makes the
    // post-match chance reproducible and prevents a duplicate callback from
    // minting a second cache locally.
    awardArenaCache({ matchId, won = false, leveledUp = false } = {}) {
        const safeMatchId = String(matchId || '').slice(0, 128);
        if (!safeMatchId || this.data.arenaCache?.lastMatchId === safeMatchId) return null;
        this.data.arenaCache = { ...DEFAULTS.arenaCache, ...(this.data.arenaCache || {}), lastMatchId: safeMatchId };
        if (!shouldAwardArenaCache({ matchId: safeMatchId, won, leveledUp })) {
            this.save();
            return null;
        }
        const granted = grantArenaCache(this.data.cardCollection, safeMatchId);
        this.data.cardCollection = granted.collection;
        this.data.equippedCards = normalizeCardLoadout(this.data.equippedCards, granted.collection);
        this.data.arenaCache.earned = Math.max(0, Number(this.data.arenaCache.earned) || 0) + 1;
        this.data.arenaCache.opened = Math.max(0, Number(this.data.arenaCache.opened) || 0) + 1;
        this.save();
        return granted.reward;
    }

    getCardCollection() {
        return normalizeCardCollection(this.data.cardCollection);
    }

    getEquippedCards() {
        return normalizeCardLoadout(this.data.equippedCards, this.data.cardCollection);
    }

    equipCard(cardId, slot) {
        const current = this.getEquippedCards();
        const next = normalizeCardLoadout({ ...current, [slot]: cardId }, this.data.cardCollection);
        if (next[slot] !== cardId) return false;
        this.data.equippedCards = next;
        this.save();
        return true;
    }

    async equipCardRemote(cardId, slot) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return false;
        try {
            const response = await fetch('/api/profile/cards/equip', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cardId, slot })
            });
            if (!response.ok) return false;
            const result = await response.json();
            this._applyRemoteProfile(result.profile);
            return result.loadout || this.getEquippedCards();
        } catch {
            return false;
        }
    }

    getCardEffects(modeId = '') {
        return resolveCardEffects(this.data.equippedCards, this.data.cardCollection, modeId);
    }

    tradeUpCards(cardIds, seed = `trade-up:${Date.now()}`) {
        const result = tradeUpCards(this.data.cardCollection, cardIds, seed);
        if (!result) return null;
        this.data.cardCollection = result.collection;
        this.data.equippedCards = normalizeCardLoadout(this.data.equippedCards, result.collection);
        this.save();
        return result;
    }

    async tradeUpCardsRemote(cardIds) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return null;
        const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const requestId = `card-trade:${nonce}`.slice(0, 96);
        try {
            const response = await fetch('/api/profile/cards/trade-up', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ cardIds, requestId })
            });
            if (!response.ok) return null;
            const payload = await response.json();
            this._applyRemoteProfile(payload.profile);
            return payload.result || null;
        } catch {
            return null;
        }
    }

    // Rolls the battlepass into a fresh season once the current one has expired.
    // Tier/xp/claim progress resets; owned cosmetics/balls/currency are untouched
    // because those live outside `battlepass` and are never cleared here.
    _rolloverBattlepassSeason() {
        const season = createBattlepassSeason(this.data.battlepass.seasonId, this.data.battlepass.seasonStartAt);
        const { progress, season: nextSeason } = applyBattlepassSeasonRollover(this.data.battlepass, season, Date.now());
        if (nextSeason.id !== season.id) this.data.battlepass = progress;
    }

    // Applies a resolved reward into the player's persistent inventory using the
    // same ownership arrays / xp-boost inventory the rest of the store uses.
    _grantBattlepassReward(reward) {
        switch (reward.kind) {
            case 'currency':
                this.data.currency += reward.amount;
                break;
            case 'xpboost': {
                const userId = this._socialUserId();
                const boostId = `bp-${this.data.battlepass.seasonId}-${reward.tier}`;
                try {
                    this.data.socialState = grantXpBoost(this.data.socialState, {
                        userId, boostId, quantity: 1, multiplier: reward.multiplier, durationMs: reward.durationMs
                    });
                } catch { /* boost already granted this season for this tier — ponytail: no-op */ }
                break;
            }
            case 'ball':
                if (!this.ownsBall(reward.id)) this.data.ownedBalls.push(reward.id);
                break;
            case 'cosmetic':
                if (!this.ownsCosmetic(reward.id)) this.data.ownedCosmetics.push(reward.id);
                break;
        }
    }

    // Kept for existing callers; js/prestige.js owns the curve.
    _xpForLevel(lvl) { return xpForLevel(lvl); }

    // Account rank triple for the menu/scoreboard. Legacy saves predate prestige.
    getAccount() {
        return { level: this.data.level, xp: this.data.xp, prestige: this.data.prestige || 0 };
    }

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
    ownsCosmetic(cosmeticId) { return (this.data.ownedCosmetics || []).includes(cosmeticId); }

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

    buyCosmetic(cosmeticId) {
        const cosmetic = COSMETICS[cosmeticId];
        if (!cosmetic || this.ownsCosmetic(cosmeticId) || this.data.currency < cosmetic.price) return false;
        this.data.currency -= cosmetic.price;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + cosmetic.price;
        this.data.ownedCosmetics.push(cosmeticId);
        this.save();
        return true;
    }

    equipCosmetic(cosmeticId) {
        const cosmetic = COSMETICS[cosmeticId];
        if (!cosmetic || !this.ownsCosmetic(cosmeticId)) return false;
        this.data.equippedWearables = normalizeWearableLoadout({
            ...this.data.equippedWearables,
            [cosmetic.type]: cosmeticId
        }, this.data.ownedCosmetics);
        this.save();
        return true;
    }

    clearCosmeticSlot(type) {
        if (!Object.hasOwn(DEFAULT_WEARABLE_LOADOUT, type)) return false;
        this.data.equippedWearables = normalizeWearableLoadout({
            ...this.data.equippedWearables,
            [type]: 'none'
        }, this.data.ownedCosmetics);
        this.save();
        return true;
    }

    _openCase(caseId, random = Math.random, free = false) {
        const box = CASES[caseId];
        const earnedCount = Math.max(0, Math.floor(Number(this.data.earnedCases?.[caseId]) || 0));
        const usesEarned = !free && earnedCount > 0;
        if (!box || (!free && !usesEarned && this.data.currency < box.price)) return null;
        const pityBefore = Math.min(9, Math.max(0, Number(this.data.casePity?.[caseId]) || 0));
        const guaranteed = pityBefore >= 9;
        const reward = rollCase(caseId, random, guaranteed ? { minimumRarity: 'epic' } : {});
        if (!reward) return null;
        if (usesEarned) {
            this.data.earnedCases = { ...(this.data.earnedCases || {}), [caseId]: earnedCount - 1 };
        } else if (!free) {
            this.data.currency -= box.price;
            this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + box.price;
        }
        const ownership = {
            avatar: this.data.ownedAvatarSkins,
            knife: this.data.ownedKnives,
            ball: this.data.ownedBalls,
            cosmetic: this.data.ownedCosmetics
        };
        const owned = ownership[reward.type];
        if (!owned) return null;
        const duplicate = owned.includes(reward.id);
        const refund = duplicate ? ((free || usesEarned) ? 35 : Math.floor(box.price * 0.35)) : 0;
        if (refund) this.data.currency += refund;
        else if (owned.length < 64) owned.push(reward.id);
        const premium = reward.rarity === 'epic' || reward.rarity === 'legendary';
        this.data.casePity = { ...(this.data.casePity || {}), [caseId]: premium ? 0 : pityBefore + 1 };
        this.save();
        return {
            reward,
            duplicate,
            refund,
            free: free || usesEarned,
            pity: { before: pityBefore, after: this.data.casePity[caseId], guaranteed }
        };
    }

    openCase(caseId, random = Math.random) {
        return this._openCase(caseId, random, false);
    }

    _caseOpenScope(caseId) {
        const accountScope = this.remoteAccountId || this.sessionToken;
        return `${accountScope}\u0000${caseId}`;
    }

    _caseOpenRequest(scope, caseId, now = Date.now()) {
        for (const [key, entry] of this._caseOpenRequests) {
            if (!entry || now - entry.createdAt > CASE_OPEN_REQUEST_TTL_MS) this._caseOpenRequests.delete(key);
        }
        const pending = this._caseOpenRequests.get(scope);
        if (pending) return pending.requestId;
        const nonce = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
        const requestId = `case:${caseId}:${nonce}`.slice(0, 96);
        this._caseOpenRequests.set(scope, { requestId, createdAt: now });
        while (this._caseOpenRequests.size > CASE_OPEN_REQUEST_MAX) {
            this._caseOpenRequests.delete(this._caseOpenRequests.keys().next().value);
        }
        return requestId;
    }

    _clearCaseOpenRequest(scope, requestId) {
        if (this._caseOpenRequests.get(scope)?.requestId === requestId) this._caseOpenRequests.delete(scope);
    }

    async _performCaseOpenRemote(caseId, scope, requestId) {
        try {
            const response = await fetch('/api/profile/cases/open', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ caseId, requestId })
            });
            if (!response.ok) {
                if (isDefinitiveCaseOpenRejection(response.status)) this._clearCaseOpenRequest(scope, requestId);
                return null;
            }
            const payload = await response.json();
            const reward = resolveCaseReward(caseId, payload.result?.reward);
            if (!reward) return null;
            if (payload.profile) this._applyRemoteProfile(payload.profile);
            this._clearCaseOpenRequest(scope, requestId);
            return { ...payload.result, reward };
        } catch {
            // The server may have committed before transport/JSON failed. Retain
            // this logical request id so the next manual retry replays its receipt.
            return null;
        }
    }

    async openCaseRemote(caseId) {
        if (!this.remoteReady && !await this.connectRemote(this.get('playerName'))) return null;
        if (!CASES[caseId]) return null;
        const scope = this._caseOpenScope(caseId);
        const active = this._caseOpenFlights.get(scope);
        if (active) return active;
        const requestId = this._caseOpenRequest(scope, caseId);
        const operation = this._performCaseOpenRemote(caseId, scope, requestId);
        this._caseOpenFlights.set(scope, operation);
        try {
            return await operation;
        } finally {
            if (this._caseOpenFlights.get(scope) === operation) this._caseOpenFlights.delete(scope);
        }
    }

    getCasePityState(caseId) {
        const count = Math.min(9, Math.max(0, Number(this.data.casePity?.[caseId]) || 0));
        return { count, threshold: 10, remaining: 10 - count, nextGuaranteed: count >= 9 };
    }

    getEarnedCaseState(caseId) {
        return {
            cases: Math.max(0, Math.floor(Number(this.data.earnedCases?.[caseId]) || 0))
        };
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

    // Bridges js/daily.js challenges into battlepass XP. js/daily.js#claim() and
    // #claimCompletionBonus() own the idempotency guards (per-challenge `claimed`,
    // per-day `bonusGranted`); this method only fires the battlepass XP grant when
    // those return a fresh (not-already-granted) result, so re-claiming, reloading,
    // or re-rendering the UI can never double-grant. Rollover runs before addXp,
    // same as every other battlepass entry point, so a grant that lands exactly on
    // a season boundary always applies to the post-rollover (fresh) progress.
    getDailyChallenges() {
        const remote = this.data.dailyChallenges;
        return this.remoteReady && remote && Array.isArray(remote.challenges)
            ? remote.challenges
            : Daily.getChallenges();
    }

    async _claimDailyChallengeRemote(challengeId) {
        const requestId = `daily:${String(challengeId || '').slice(0, 64)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        this.lastDailyChallengeError = '';
        try {
            const response = await fetch('/api/profile/daily-challenges/claim', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Idempotency-Key': requestId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ challengeId, requestId })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                this.lastDailyChallengeError = result.error || 'Daily challenge claim unavailable';
                return null;
            }
            if (result.profile) this._applyRemoteProfile(result.profile);
            return { coins: result.coins, xpGranted: result.xpGranted, replayed: result.replayed === true };
        } catch {
            this.lastDailyChallengeError = 'Network error. Daily challenge progress is still on your account.';
            return null;
        }
    }

    claimDailyChallenge(challengeId) {
        // Account claims are server-authoritative: never call Daily.claim(),
        // mutate currency or add Battle Pass XP optimistically in this path.
        if (this.remoteReady) return this._claimDailyChallengeRemote(challengeId);
        const coins = Daily.claim(challengeId);
        if (!coins) return null;
        this.grant({ currency: coins });
        const completionBonus = Daily.claimCompletionBonus();
        // Daily claims predate account-authoritative Battle Pass progression.
        // Guests retain the existing bridge; authenticated accounts must not
        // receive a transient local grant that server sync will overwrite.
        const xpGranted = this.remoteReady ? 0 : dailyXpAward(1, completionBonus);
        if (!this.remoteReady) {
            this._rolloverBattlepassSeason();
            const { state } = addBattlepassXp(this.data.battlepass, xpGranted);
            this.data.battlepass = state;
        }
        this.save();
        return { coins, xpGranted };
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
        const price = BALL_PRICES[ballId];
        if (!price || this.data.currency < price) return false;
        this.data.currency -= price;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + price;
        this.data.ownedBalls.push(ballId);
        this.save();
        return true;
    }

    equipBall(ballId) {
        if (!BALL_PRICES[ballId] && ballId !== 'classic') return false;
        if (!this.ownsBall(ballId)) return false;
        this.data.equippedBall = ballId;
        this.save();
        return true;
    }

    // Skill satın al
    buySkill(skillId) {
        void skillId;
        return false;
    }

    // Rune satın al
    buyRune(runeId) {
        void runeId;
        return false;
    }

    // Loadout ayarla
    setLoadout(loadout) {
        if (loadout.char && !this.ownsCharacter(loadout.char)) return false;
        if (loadout.skill && !this.ownsSkill(loadout.skill)) return false;
        const runes = Array.isArray(loadout.runes)
            ? loadout.runes.filter(id => RUNES[id] && this.owns(id)).slice(0, 1)
            : this.data.loadout.runes;
        this.data.loadout = { ...this.data.loadout, ...loadout, runes };
        // Legacy Locker buttons still emit skill/rune ids. Mirror an owned
        // collectible card so old saves and the new card collection stay in
        // lockstep without tying either choice to a character.
        const cards = this.getEquippedCards();
        const skillCard = loadout.skill && cardForEffect(loadout.skill, 'active');
        const runeCard = runes[0] && cardForEffect(runes[0], 'passive');
        if (skillCard && this.getCardCollection()[skillCard.id] > 0) cards.active = skillCard.id;
        if (runeCard && this.getCardCollection()[runeCard.id] > 0) cards.passive = runeCard.id;
        this.data.equippedCards = normalizeCardLoadout(cards, this.data.cardCollection);
        if (loadout.char) this.data.selectedChar = loadout.char;
        if (loadout.ball) this.data.equippedBall = loadout.ball;
        this.save();
        return true;
    }

    // Battlepass tier reward claim. Idempotent: claiming an already-claimed tier,
    // an out-of-range tier, or a locked premium tier all return null with no side
    // effects. `track` is 'free' (default) or 'premium'.
    claimBattlepassReward(tier, track = 'free') {
        if (this.remoteReady) return this._claimBattlepassRewardRemote(tier, track);
        this._rolloverBattlepassSeason();
        const hasPremium = this.data.battlepass.premium === true;
        const result = claimBattlepassRewardPure(this.data.battlepass, Number(tier), track, { hasPremium });
        if (!result) return null;
        this.data.battlepass = result.progress;
        this._grantBattlepassReward(result.reward);
        this.save();
        return result.reward;
    }

    async _claimBattlepassRewardRemote(tier, track) {
        this.lastBattlepassError = '';
        try {
            const response = await fetch('/api/profile/battlepass/claim', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier: Number(tier), track: track === 'premium' ? 'premium' : 'free' })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) { this.lastBattlepassError = result.error || 'Battle Pass reward unavailable'; return null; }
            if (result.profile) this._applyRemoteProfile(result.profile);
            return result.reward || null;
        } catch {
            this.lastBattlepassError = 'Battle Pass service unavailable';
            return null;
        }
    }

    // One-time purchase that unlocks the premium track for the current season.
    buyPremiumBattlepass() {
        if (this.remoteReady) return this._buyPremiumBattlepassRemote();
        if (this.data.battlepass.premium) return false;
        if (this.data.currency < PREMIUM_PASS_PRICE) return false;
        this.data.currency -= PREMIUM_PASS_PRICE;
        this.data.stats.totalSpent = (this.data.stats.totalSpent || 0) + PREMIUM_PASS_PRICE;
        this.data.battlepass = { ...this.data.battlepass, premium: true };
        this.save();
        return true;
    }

    async _buyPremiumBattlepassRemote() {
        this.lastBattlepassError = '';
        try {
            const response = await fetch('/api/profile/battlepass/premium', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.sessionToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) { this.lastBattlepassError = result.error || 'Premium Battle Pass unavailable'; return false; }
            if (result.profile) this._applyRemoteProfile(result.profile);
            return true;
        } catch {
            this.lastBattlepassError = 'Battle Pass service unavailable';
            return false;
        }
    }

    async activateBattlepassBoost(boostId) {
        this.lastBattlepassError = '';
        if (!this.remoteReady || !this.sessionToken) {
            this.lastBattlepassError = 'Sign in to activate a Battle Pass boost';
            return { ok: false, replayed: false, error: this.lastBattlepassError };
        }
        const cleanBoostId = typeof boostId === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(boostId) ? boostId : '';
        if (!cleanBoostId) {
            this.lastBattlepassError = 'Battle Pass boost unavailable';
            return { ok: false, replayed: false, error: this.lastBattlepassError };
        }
        const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const requestId = `bp-boost:${nonce}`.slice(0, 128);
        try {
            const response = await fetch('/api/profile/battlepass/boost/activate', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`,
                    'Content-Type': 'application/json',
                    'Idempotency-Key': requestId
                },
                body: JSON.stringify({ boostId: cleanBoostId, requestId })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                this.lastBattlepassError = result.error || 'Battle Pass boost unavailable';
                return { ok: false, replayed: false, error: this.lastBattlepassError };
            }
            if (result.profile) this._applyRemoteProfile(result.profile);
            return {
                ok: true,
                replayed: result.replayed === true,
                activeBoost: result.activeBoost || this.data.battlepassActiveBoost || null
            };
        } catch {
            this.lastBattlepassError = 'Battle Pass service unavailable';
            return { ok: false, replayed: false, error: this.lastBattlepassError };
        }
    }

    getBattlepassBoostState(now = Date.now()) {
        const inventory = this.data.battlepassBoosts && typeof this.data.battlepassBoosts === 'object'
            && !Array.isArray(this.data.battlepassBoosts) ? this.data.battlepassBoosts : {};
        const available = Object.values(inventory)
            .filter(boost => boost && typeof boost.boostId === 'string' && Number(boost.quantity) > 0
                && Number(boost.multiplier) > 1 && Number(boost.durationMs) > 0)
            .map(boost => ({
                boostId: boost.boostId,
                quantity: Math.max(0, Math.floor(Number(boost.quantity) || 0)),
                multiplier: Number(boost.multiplier),
                durationMs: Math.max(1, Math.floor(Number(boost.durationMs) || 0))
            }))
            .sort((a, b) => b.multiplier - a.multiplier || b.durationMs - a.durationMs || a.boostId.localeCompare(b.boostId));
        const candidate = this.data.battlepassActiveBoost;
        const active = candidate && typeof candidate === 'object' && Number(candidate.expiresAt) > now
            ? { ...candidate, remainingMs: Math.max(0, Number(candidate.expiresAt) - now) }
            : null;
        return {
            inventory: available,
            active,
            ownedCount: available.reduce((total, boost) => total + boost.quantity, 0),
            strongestAvailable: available[0] || null
        };
    }

    getBattlepassRewards() { return { free: BATTLEPASS_FREE_TRACK, premium: BATTLEPASS_PREMIUM_TRACK }; }
    getBattlepassProgress() {
        this._rolloverBattlepassSeason();
        return this.data.battlepass;
    }
    getBattlepassXpForNextTier() {
        const tier = this.data.battlepass.tier;
        return tier >= 50 ? 0 : battlepassXpForTier(tier + 1);
    }
    getBattlepassPremiumPrice() { return PREMIUM_PASS_PRICE; }

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
