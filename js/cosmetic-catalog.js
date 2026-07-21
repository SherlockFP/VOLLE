const item = (id, type, name, price, rarity, colors, style, description) => Object.freeze({
    id, type, name, price, rarity, colors: Object.freeze(colors), style, description
});

export const COSMETIC_TYPES = Object.freeze({
    cape: 'Capes',
    pet: 'Pets',
    shoes: 'Shoes',
    aura: 'Auras',
    impact: 'Hit Effects'
});

export const COSMETICS = Object.freeze({
    cape_ember: item('cape_ember', 'cape', 'Ember Mantle', 280, 'rare', ['#ffb020', '#7a1600'], 'ember', 'Burning cloth with a molten edge.'),
    cape_frost: item('cape_frost', 'cape', 'Frostveil', 300, 'rare', ['#dffaff', '#238ed1'], 'frost', 'Crystalline cape with cold shimmer.'),
    cape_void: item('cape_void', 'cape', 'Void Shroud', 440, 'epic', ['#9a6cff', '#130629'], 'void', 'A starless rift follows every turn.'),
    cape_creeper: item('cape_creeper', 'cape', 'Block Creeper', 360, 'epic', ['#6ed447', '#163c18'], 'pixel', 'Pixel cape inspired by block worlds.'),
    cape_royal: item('cape_royal', 'cape', 'Arena Royal', 520, 'legendary', ['#ffd86a', '#652db4'], 'royal', 'Champion fabric with gold trim.'),
    cape_glitch: item('cape_glitch', 'cape', 'Glitch Protocol', 480, 'legendary', ['#ff3cbb', '#28f7e2'], 'glitch', 'Broken scanlines and chromatic edges.'),

    pet_slime: item('pet_slime', 'pet', 'Pocket Slime', 260, 'rare', ['#75f36a', '#17602c'], 'slime', 'A bouncy cube that follows your feet.'),
    pet_dragon: item('pet_dragon', 'pet', 'Ember Whelp', 520, 'legendary', ['#ff6a2f', '#621313'], 'dragon', 'Tiny winged dragon with ember eyes.'),
    pet_drone: item('pet_drone', 'pet', 'Deflect Drone', 420, 'epic', ['#63f7ff', '#213c62'], 'drone', 'Orbital training drone with a cyan lens.'),
    pet_snowman: item('pet_snowman', 'pet', 'Chill Buddy', 300, 'rare', ['#ffffff', '#54b9ff'], 'snow', 'Small snow guardian with an icy trail.'),
    pet_bee: item('pet_bee', 'pet', 'Turbo Bee', 340, 'epic', ['#ffd63d', '#1c1b18'], 'bee', 'Fast striped companion with tiny wings.'),
    pet_axolotl: item('pet_axolotl', 'pet', 'Pixel Axolotl', 460, 'legendary', ['#ff8bc8', '#55d8ff'], 'axolotl', 'Blocky aquatic friend with neon gills.'),

    shoes_blaze: item('shoes_blaze', 'shoes', 'Blaze Runners', 240, 'rare', ['#ff8a28', '#8f1700'], 'ember', 'Hot soles leave short flame sparks.'),
    shoes_ice: item('shoes_ice', 'shoes', 'Ice Skippers', 240, 'rare', ['#dffbff', '#318bd6'], 'frost', 'Frozen boots with crystal heels.'),
    shoes_lightning: item('shoes_lightning', 'shoes', 'Volt Steps', 340, 'epic', ['#fff257', '#3570ff'], 'electric', 'Electric soles pulse while moving.'),
    shoes_cloud: item('shoes_cloud', 'shoes', 'Cloud Hoppers', 300, 'epic', ['#ffffff', '#91d9ff'], 'cloud', 'Soft floating soles with air rings.'),
    shoes_magma: item('shoes_magma', 'shoes', 'Magma Stompers', 420, 'legendary', ['#ffcf3d', '#4b0900'], 'magma', 'Cracked volcanic armor for both feet.'),
    shoes_pixel: item('shoes_pixel', 'shoes', 'Diamond Blocks', 380, 'legendary', ['#61e7e5', '#12666a'], 'pixel', 'Chunky cyan boots with pixel shine.'),

    aura_flame: item('aura_flame', 'aura', 'Flame Orbit', 320, 'rare', ['#ffbd3c', '#ee2d12'], 'ember', 'Three flames circle the player.'),
    aura_frost: item('aura_frost', 'aura', 'Frozen Halo', 340, 'rare', ['#eaffff', '#4aa8ff'], 'frost', 'Ice shards rotate around the waist.'),
    aura_void: item('aura_void', 'aura', 'Void Singularity', 520, 'legendary', ['#c074ff', '#210842'], 'void', 'Dark rings bend light around you.'),
    aura_hearts: item('aura_hearts', 'aura', 'Happy Hearts', 360, 'epic', ['#ff5c9e', '#ffd1e6'], 'hearts', 'Cheerful heart particles bounce nearby.'),
    aura_music: item('aura_music', 'aura', 'Disco Beat', 420, 'epic', ['#52f7ff', '#ff49cd'], 'music', 'Rhythmic neon notes spin to the rally.'),
    aura_toxic: item('aura_toxic', 'aura', 'Toxic Reactor', 460, 'legendary', ['#a8ff31', '#214f08'], 'toxic', 'Radioactive rings and green bubbles.'),

    impact_confetti: item('impact_confetti', 'impact', 'Confetti Pop', 220, 'rare', ['#ffe14a', '#ff4d8f'], 'confetti', 'Hits burst into tournament confetti.'),
    impact_ice: item('impact_ice', 'impact', 'Ice Break', 260, 'rare', ['#e8ffff', '#48a9ff'], 'frost', 'Deflects crack into frozen shards.'),
    impact_fire: item('impact_fire', 'impact', 'Fire Punch', 320, 'epic', ['#ffc342', '#ef3318'], 'ember', 'Successful hits erupt with flame petals.'),
    impact_pixels: item('impact_pixels', 'impact', 'Pixel Burst', 360, 'epic', ['#5cf5dc', '#3170ff'], 'pixel', 'Square particles explode on contact.'),
    impact_stars: item('impact_stars', 'impact', 'Happy Stars', 400, 'legendary', ['#fff35a', '#ff65bd'], 'stars', 'Smiling star sparks celebrate the hit.'),
    impact_glitch: item('impact_glitch', 'impact', 'Reality Error', 480, 'legendary', ['#ff35d3', '#25f4e8'], 'glitch', 'Chromatic fragments tear through space.')
});

export const DEFAULT_WEARABLE_LOADOUT = Object.freeze({
    cape: 'none', pet: 'none', shoes: 'none', aura: 'none', impact: 'none'
});

export function normalizeWearableLoadout(value = {}, ownership = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const owned = ownership instanceof Set ? ownership : new Set(Array.isArray(ownership) ? ownership : []);
    return Object.fromEntries(Object.keys(COSMETIC_TYPES).map(type => {
        const id = source[type];
        const valid = id === 'none' || (COSMETICS[id]?.type === type && (!ownership || owned.has(id)));
        return [type, valid ? id : 'none'];
    }));
}

export function cosmeticsByType(type) {
    return Object.values(COSMETICS).filter(entry => entry.type === type);
}
