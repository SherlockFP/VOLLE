// store.js — Tiny localStorage persistence for meta progression.
// Zero-build, no deps. One JSON blob under a single key.
// ponytail: tek JSON blob, merge ile backward compat.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES, DEFAULT_LOADOUT } from './skills.js';
import { AVATAR_SKINS } from './avatar.js';

const KEY = 'dodgball_save_v2';

function buildCharacterProgress() {
    return Object.fromEntries(Object.keys(CHARACTERS).map(id => [id, { level: 1, xp: 0 }]));
}

// Battlepass tier reward'ları (50 tier). Her tier'da bir reward.
function buildBattlepassRewards() {
    const rewards = [];
    const charIds = ['tank','scout','sniper','guardian','blazer','frost'];
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
    unlockedChars: ['rally'],
    characterProgress: buildCharacterProgress(),
    selectedChar: 'rally',
    equippedBall: 'classic',
    ownedBalls: ['classic'],
    loadout: { ...DEFAULT_LOADOUT },
    battlepass: { tier: 0, xp: 0, claimed: [], premium: false },
    customAvatar: null,
    ownedAvatarSkins: ['default'],
    equippedAvatarSkin: 'default',
    settings: { sensitivity: 2, volume: 50, botDifficulty: 'hard', fov: 75, keybinds: {} },
    stats: { gamesPlayed: 0, totalWins: 0, totalDeflects: 0, totalHits: 0, bestRally: 0, totalSpent: 0, winStreak: 0, rankedElo: 1000, rankedGames: 0 },
    unlockedAchievements: [],
    playerName: 'Player'
};

class StoreClass {
    constructor() { this.data = this._read(); }

    _read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return structuredClone(DEFAULTS);
            const parsed = JSON.parse(raw);
            // Deep merge — yeni key'ler eski save'lerde de olsun
            return { ...structuredClone(DEFAULTS), ...parsed,
                settings: { ...DEFAULTS.settings, ...(parsed.settings||{}) },
                loadout: { ...DEFAULTS.loadout, ...(parsed.loadout||{}) },
                characterProgress: { ...DEFAULTS.characterProgress, ...(parsed.characterProgress||{}) },
                battlepass: { ...DEFAULTS.battlepass, ...(parsed.battlepass||{}) },
                stats: { ...DEFAULTS.stats, ...(parsed.stats||{}) },
                ownedAvatarSkins: parsed.ownedAvatarSkins || DEFAULTS.ownedAvatarSkins
            };
        } catch {
            return structuredClone(DEFAULTS);
        }
    }

    load() { this.data = this._read(); return this.data; }
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }

    get(key) { return this.data[key]; }
    set(key, val) { this.data[key] = val; this.save(); }

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

    ownsCharacter(charId) { return this.data.unlockedChars.includes(charId); }
    ownsBall(ballId) { return this.data.ownedBalls.includes(ballId); }
    ownsSkill(skillId) { return this.data.ownedSkills.includes(skillId); }
    ownsAvatarSkin(skinId) { return (this.data.ownedAvatarSkins || []).includes(skinId); }

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
        if (!this.ownsAvatarSkin(skinId)) return false;
        this.data.equippedAvatarSkin = skinId;
        this.save();
        return true;
    }

    // Karakter satın al
    buyCharacter(charId) {
        const c = CHARACTERS[charId];
        if (!c || !c.price) return false;
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
        this.data.loadout = { ...this.data.loadout, ...loadout };
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

    getElo() { return this.data.stats.rankedElo || 1000; }
    getWinStreak() { return this.data.stats.winStreak || 0; }

    reset() { this.data = structuredClone(DEFAULTS); this.save(); }
}

export const Store = new StoreClass();
