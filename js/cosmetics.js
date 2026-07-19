import { AVATAR_SKINS } from './avatar.js';

export const KNIVES = Object.freeze({
    training: Object.freeze({ id: 'training', name: 'Training Edge', rarity: 'common', model: 'classic', color: '#d7f3ff', accent: '#4e7d99', teams: ['red', 'blue'] }),
    tide: Object.freeze({ id: 'tide', name: 'Tidal Fang', rarity: 'rare', model: 'classic', color: '#36d8ca', accent: '#1673a3', teams: ['blue'] }),
    flare: Object.freeze({ id: 'flare', name: 'Solar Talon', rarity: 'rare', model: 'classic', color: '#ff6b5f', accent: '#ffad52', teams: ['red'] }),
    prism: Object.freeze({ id: 'prism', name: 'Prism Breaker', rarity: 'epic', model: 'butterfly', color: '#b77dff', accent: '#5a2f9d', teams: ['red', 'blue'] }),
    sherlock: Object.freeze({ id: 'sherlock', name: 'Sherlock Signature', rarity: 'legendary', model: 'karambit', color: '#ffd36b', accent: '#7b4c11', teams: ['red', 'blue'] }),
    doppler: Object.freeze({ id: 'doppler', name: 'Butterfly | Emerald Doppler', rarity: 'legendary', model: 'butterfly', color: '#28e092', accent: '#075f4d', teams: ['red', 'blue'] }),
    fade: Object.freeze({ id: 'fade', name: 'Karambit | Fade', rarity: 'legendary', model: 'karambit', color: '#ffbd56', accent: '#f05ca8', teams: ['red', 'blue'] }),
    crimson_web: Object.freeze({ id: 'crimson_web', name: 'Karambit | Crimson Web', rarity: 'epic', model: 'karambit', color: '#d92f4d', accent: '#4a0918', teams: ['red', 'blue'] })
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
            { id: 'tide', weight: 24 }, { id: 'flare', weight: 24 }, { id: 'prism', weight: 18 },
            { id: 'crimson_web', weight: 6 }, { id: 'doppler', weight: 2 },
            { id: 'samurai', type: 'avatar', rarity: 'rare', weight: 11 },
            { id: 'moss', type: 'avatar', rarity: 'rare', weight: 9 },
            { id: 'striker', type: 'avatar', rarity: 'epic', weight: 4 },
            { id: 'void', type: 'avatar', rarity: 'epic', weight: 2 }
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
    })
});

function resolveCaseDrop(drop) {
    if (drop.type === 'avatar') {
        const skin = AVATAR_SKINS[drop.id];
        return skin ? { ...skin, type: 'avatar', rarity: drop.rarity } : null;
    }
    const knife = KNIVES[drop.id];
    return knife ? { ...knife, type: 'knife' } : null;
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
        preview: resolveCaseDrop(drop)?.type === 'avatar' ? resolveCaseDrop(drop) : null,
        chance: total > 0 ? drop.weight / total : 0
    }));
}

export function canEquipKnife(knifeId, team) {
    const knife = KNIVES[knifeId];
    return !!knife && knife.teams.includes(team);
}
