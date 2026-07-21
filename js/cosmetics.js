import { AVATAR_SKINS } from './avatar.js';
import { COSMETICS } from './cosmetic-catalog.js';

const CASE_BALLS = Object.freeze({
    magma: { id: 'magma', name: 'Magma Core', rarity: 'legendary' },
    ocean: { id: 'ocean', name: 'Ocean Depths', rarity: 'epic' },
    moon: { id: 'moon', name: 'Moon Rock', rarity: 'rare' },
    portal: { id: 'portal', name: 'Portal Rift', rarity: 'legendary' },
    blackhole: { id: 'blackhole', name: 'Black Hole', rarity: 'legendary' }
});

export const KNIVES = Object.freeze({
    training: Object.freeze({ id: 'training', name: 'Arena Standard', rarity: 'common', model: 'classic', finish: 'satin', color: '#d7f3ff', accent: '#4e7d99', teams: ['red', 'blue'] }),
    tide: Object.freeze({ id: 'tide', name: 'Tidal Fang', rarity: 'rare', model: 'bayonet', finish: 'tide', color: '#36d8ca', accent: '#1673a3', teams: ['blue'] }),
    flare: Object.freeze({ id: 'flare', name: 'Solar Talon', rarity: 'rare', model: 'bayonet', finish: 'ember', color: '#ff6b5f', accent: '#ffad52', teams: ['red'] }),
    prism: Object.freeze({ id: 'prism', name: 'Prism Breaker', rarity: 'epic', model: 'butterfly', finish: 'prism', color: '#b77dff', accent: '#5a2f9d', teams: ['red', 'blue'] }),
    sherlock: Object.freeze({ id: 'sherlock', name: 'Clockwork Signature', rarity: 'legendary', model: 'karambit', finish: 'brass', color: '#ffd36b', accent: '#7b4c11', teams: ['red', 'blue'] }),
    doppler: Object.freeze({ id: 'doppler', name: 'Emerald Flux', rarity: 'legendary', model: 'butterfly', finish: 'aurora', color: '#28e092', accent: '#075f4d', teams: ['red', 'blue'] }),
    fade: Object.freeze({ id: 'fade', name: 'Sunset Arc', rarity: 'legendary', model: 'karambit', finish: 'sunset', color: '#ffbd56', accent: '#f05ca8', teams: ['red', 'blue'] }),
    crimson_web: Object.freeze({ id: 'crimson_web', name: 'Crimson Circuit', rarity: 'epic', model: 'karambit', finish: 'circuit', color: '#d92f4d', accent: '#4a0918', teams: ['red', 'blue'] }),
    obsidian: Object.freeze({ id: 'obsidian', name: 'Obsidian Rift', rarity: 'epic', model: 'karambit', finish: 'void', color: '#181124', accent: '#9b5cff', teams: ['red', 'blue'] }),
    aurora: Object.freeze({ id: 'aurora', name: 'Aurora Wings', rarity: 'legendary', model: 'butterfly', finish: 'aurora', color: '#58f2d5', accent: '#ef72ff', teams: ['red', 'blue'] }),
    pixel_edge: Object.freeze({ id: 'pixel_edge', name: 'Pixel Edge', rarity: 'rare', model: 'bayonet', finish: 'pixel', color: '#59e5df', accent: '#166a78', teams: ['red', 'blue'] }),
    icefang: Object.freeze({ id: 'icefang', name: 'Frost Fang', rarity: 'epic', model: 'karambit', finish: 'frost', color: '#dffbff', accent: '#398bd1', teams: ['blue'] }),
    dragonclaw: Object.freeze({ id: 'dragonclaw', name: 'Dragon Claw', rarity: 'legendary', model: 'karambit', finish: 'ember', color: '#ff7d32', accent: '#5c0909', teams: ['red'] }),
    reactor: Object.freeze({ id: 'reactor', name: 'Reactor Wings', rarity: 'legendary', model: 'butterfly', finish: 'reactor', color: '#b5ff42', accent: '#174d1d', teams: ['red', 'blue'] })
});

export const CASES = Object.freeze({
    kickoff: Object.freeze({
        id: 'kickoff', name: 'Kickoff Case', price: 120,
        drops: Object.freeze([
            { id: 'tide', weight: 28 }, { id: 'flare', weight: 28 },
            { id: 'prism', weight: 16 }, { id: 'sherlock', weight: 3 },
            { id: 'neon', type: 'avatar', rarity: 'rare', weight: 12 },
            { id: 'frost', type: 'avatar', rarity: 'rare', weight: 7 },
            { id: 'astro', type: 'avatar', rarity: 'epic', weight: 4 },
            { id: 'arcade', type: 'avatar', rarity: 'legendary', weight: 2 }
        ])
    }),
    chroma: Object.freeze({
        id: 'chroma', name: 'Chroma Case', price: 180,
        drops: Object.freeze([
            { id: 'tide', weight: 22 }, { id: 'flare', weight: 22 }, { id: 'prism', weight: 17 },
            { id: 'crimson_web', weight: 6 }, { id: 'doppler', weight: 2 },
            { id: 'samurai', type: 'avatar', rarity: 'rare', weight: 10 },
            { id: 'moss', type: 'avatar', rarity: 'rare', weight: 8 },
            { id: 'striker', type: 'avatar', rarity: 'epic', weight: 4 },
            { id: 'void', type: 'avatar', rarity: 'epic', weight: 2 },
            { id: 'circuit', type: 'avatar', rarity: 'rare', weight: 7 }
        ])
    }),
    arsenal: Object.freeze({
        id: 'arsenal', name: 'Arsenal Case', price: 240,
        drops: Object.freeze([
            { id: 'prism', weight: 32 }, { id: 'crimson_web', weight: 25 }, { id: 'fade', weight: 10 },
            { id: 'doppler', weight: 5 }, { id: 'sherlock', weight: 3 },
            { id: 'astro', type: 'avatar', rarity: 'rare', weight: 10 },
            { id: 'void', type: 'avatar', rarity: 'epic', weight: 9 },
            { id: 'royal', type: 'avatar', rarity: 'legendary', weight: 6 }
        ])
    }),
    elemental: Object.freeze({
        id: 'elemental', name: 'Elemental Case', price: 190,
        drops: Object.freeze([
            { id: 'magma', type: 'ball', rarity: 'legendary', weight: 4 },
            { id: 'ocean', type: 'ball', rarity: 'epic', weight: 12 },
            { id: 'moon', type: 'ball', rarity: 'rare', weight: 18 },
            { id: 'icefang', weight: 14 }, { id: 'dragonclaw', weight: 4 },
            { id: 'cape_ember', type: 'cosmetic', weight: 18 },
            { id: 'cape_frost', type: 'cosmetic', weight: 18 },
            { id: 'aura_void', type: 'cosmetic', weight: 4 },
            { id: 'impact_fire', type: 'cosmetic', weight: 8 }
        ])
    }),
    companions: Object.freeze({
        id: 'companions', name: 'Companion Case', price: 210,
        drops: Object.freeze([
            { id: 'pet_slime', type: 'cosmetic', weight: 24 },
            { id: 'pet_snowman', type: 'cosmetic', weight: 20 },
            { id: 'pet_bee', type: 'cosmetic', weight: 16 },
            { id: 'pet_drone', type: 'cosmetic', weight: 14 },
            { id: 'pet_axolotl', type: 'cosmetic', weight: 8 },
            { id: 'pet_dragon', type: 'cosmetic', weight: 4 },
            { id: 'bee_runner', type: 'avatar', rarity: 'epic', weight: 8 },
            { id: 'axolotl_scout', type: 'avatar', rarity: 'legendary', weight: 4 },
            { id: 'pixel_edge', weight: 2 }
        ])
    }),
    mythic: Object.freeze({
        id: 'mythic', name: 'Mythic Arena Case', price: 280,
        drops: Object.freeze([
            { id: 'aurora', weight: 8 }, { id: 'reactor', weight: 8 },
            { id: 'portal', type: 'ball', rarity: 'legendary', weight: 10 },
            { id: 'blackhole', type: 'ball', rarity: 'legendary', weight: 6 },
            { id: 'galaxy_idol', type: 'avatar', rarity: 'legendary', weight: 10 },
            { id: 'infernal_smile', type: 'avatar', rarity: 'legendary', weight: 10 },
            { id: 'cape_royal', type: 'cosmetic', weight: 12 },
            { id: 'cape_glitch', type: 'cosmetic', weight: 10 },
            { id: 'shoes_magma', type: 'cosmetic', weight: 12 },
            { id: 'impact_glitch', type: 'cosmetic', weight: 14 }
        ])
    })
});

function resolveCaseDrop(drop) {
    if (drop.type === 'avatar') {
        const skin = AVATAR_SKINS[drop.id];
        return skin ? { ...skin, type: 'avatar', rarity: drop.rarity } : null;
    }
    if (drop.type === 'ball') {
        const ball = CASE_BALLS[drop.id];
        return ball ? { ...ball, id: drop.id, type: 'ball', rarity: drop.rarity || ball.rarity } : null;
    }
    if (drop.type === 'cosmetic') {
        const cosmetic = COSMETICS[drop.id];
        return cosmetic ? { ...cosmetic, type: 'cosmetic' } : null;
    }
    const knife = KNIVES[drop.id];
    return knife ? { ...knife, type: 'knife' } : null;
}

export function resolveCaseReward(caseId, reward) {
    const drop = CASES[caseId]?.drops.find(item => item.id === reward?.id && (item.type || 'knife') === reward?.type);
    return drop ? resolveCaseDrop(drop) : null;
}

export function secureCosmeticRandom() {
    if (globalThis.crypto?.getRandomValues) {
        const values = new Uint32Array(1);
        globalThis.crypto.getRandomValues(values);
        return values[0] / 0x100000000;
    }
    return Math.random();
}

export function rollCase(caseId, random = secureCosmeticRandom, options = {}) {
    const box = CASES[caseId];
    if (!box) return null;
    const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
    const minimumRank = rarityRank[options.minimumRarity] ?? -1;
    const drops = box.drops.filter(drop => (rarityRank[resolveCaseDrop(drop)?.rarity] ?? 0) >= minimumRank);
    if (!drops.length) return null;
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    let roll = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * total;
    for (const drop of drops) {
        roll -= drop.weight;
        if (roll < 0) return resolveCaseDrop(drop);
    }
    return null;
}

export function getCaseDropRates(caseId, options = {}) {
    const box = CASES[caseId];
    if (!box) return [];
    const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
    const minimumRank = rarityRank[options.minimumRarity] ?? -1;
    const drops = box.drops.filter(drop => (rarityRank[resolveCaseDrop(drop)?.rarity] ?? 0) >= minimumRank);
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    return drops.map(drop => ({
        id: drop.id,
        name: resolveCaseDrop(drop)?.name || drop.id,
        rarity: resolveCaseDrop(drop)?.rarity || 'common',
        type: resolveCaseDrop(drop)?.type || 'knife',
        preview: ['avatar', 'cosmetic'].includes(resolveCaseDrop(drop)?.type) ? resolveCaseDrop(drop) : null,
        chance: total > 0 ? drop.weight / total : 0
    }));
}

export function canEquipKnife(knifeId, team) {
    const knife = KNIVES[knifeId];
    return !!knife && knife.teams.includes(team);
}
