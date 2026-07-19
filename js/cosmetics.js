export const KNIVES = Object.freeze({
    training: Object.freeze({ id: 'training', name: 'Training Edge', rarity: 'common', color: '#d7f3ff', teams: ['red', 'blue'] }),
    tide: Object.freeze({ id: 'tide', name: 'Tidal Fang', rarity: 'rare', color: '#36d8ca', teams: ['blue'] }),
    flare: Object.freeze({ id: 'flare', name: 'Solar Talon', rarity: 'rare', color: '#ff6b5f', teams: ['red'] }),
    prism: Object.freeze({ id: 'prism', name: 'Prism Breaker', rarity: 'epic', color: '#b77dff', teams: ['red', 'blue'] }),
    sherlock: Object.freeze({ id: 'sherlock', name: 'Sherlock Signature', rarity: 'legendary', color: '#ffd36b', teams: ['red', 'blue'] })
});

export const CASES = Object.freeze({
    kickoff: Object.freeze({
        id: 'kickoff', name: 'Kickoff Case', price: 120,
        drops: Object.freeze([
            { id: 'tide', weight: 38 }, { id: 'flare', weight: 38 },
            { id: 'prism', weight: 20 }, { id: 'sherlock', weight: 4 }
        ])
    })
});

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
    const drops = box.drops.filter(drop => (rarityRank[KNIVES[drop.id]?.rarity] ?? 0) >= minimumRank);
    if (!drops.length) return null;
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    let roll = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * total;
    for (const drop of drops) {
        roll -= drop.weight;
        if (roll < 0) return KNIVES[drop.id] || null;
    }
    return null;
}

export function getCaseDropRates(caseId, options = {}) {
    const box = CASES[caseId];
    if (!box) return [];
    const rarityRank = { common: 0, rare: 1, epic: 2, legendary: 3 };
    const minimumRank = rarityRank[options.minimumRarity] ?? -1;
    const drops = box.drops.filter(drop => (rarityRank[KNIVES[drop.id]?.rarity] ?? 0) >= minimumRank);
    const total = drops.reduce((sum, drop) => sum + drop.weight, 0);
    return drops.map(drop => ({
        id: drop.id,
        name: KNIVES[drop.id]?.name || drop.id,
        rarity: KNIVES[drop.id]?.rarity || 'common',
        chance: total > 0 ? drop.weight / total : 0
    }));
}

export function canEquipKnife(knifeId, team) {
    const knife = KNIVES[knifeId];
    return !!knife && knife.teams.includes(team);
}
