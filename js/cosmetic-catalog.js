const item = (id, type, name, price, rarity, colors, style, description) => Object.freeze({
    id, type, name, price, rarity, colors: Object.freeze(colors), style, description
});

export const COSMETIC_TYPES = Object.freeze({
    cape: 'Capes',
    pet: 'Pets',
    shoes: 'Shoes',
    aura: 'Auras',
    impact: 'Hit Effects',
    hat: 'Hats',
    mask: 'Masks',
    wings: 'Wings',
    backpack: 'Backpacks',
    banner: 'Banners',
    trail: 'Trails',
    finisher: 'Finishers'
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
    impact_glitch: item('impact_glitch', 'impact', 'Reality Error', 480, 'legendary', ['#ff35d3', '#25f4e8'], 'glitch', 'Chromatic fragments tear through space.'),

    hat_cap: item('hat_cap', 'hat', 'Backwards Cap', 240, 'rare', ['#ff4d4d', '#ffffff'], 'cap', 'Flat brim worn backwards for max style.'),
    hat_beanie: item('hat_beanie', 'hat', 'Chill Beanie', 260, 'rare', ['#4aa8ff', '#ffffff'], 'beanie', 'Warm knit beanie with a bouncy pompom.'),
    hat_pixel: item('hat_pixel', 'hat', 'Block Helmet', 300, 'rare', ['#6ed447', '#163c18'], 'pixel', 'Chunky pixel helmet built from square plates.'),
    hat_helm: item('hat_helm', 'hat', 'Battle Helm', 360, 'epic', ['#9aa4b2', '#cc3333'], 'helm', 'Riveted steel helm forged for the arena.'),
    hat_wizard: item('hat_wizard', 'hat', 'Wizard Peak', 400, 'epic', ['#7a4fff', '#1c1040'], 'wizard', 'Tall starlit hat for tactical spellcasters.'),
    hat_horns: item('hat_horns', 'hat', 'Devil Horns', 380, 'epic', ['#ff2d2d', '#1a0505'], 'horns', 'Curved horns on a blackened headband.'),
    hat_crown: item('hat_crown', 'hat', 'Arena Crown', 620, 'legendary', ['#ffd86a', '#652db4'], 'crown', "Champion's crown, gold with royal trim."),
    hat_halo: item('hat_halo', 'hat', 'Saint Halo', 560, 'legendary', ['#fff7d6', '#ffd86a'], 'halo', 'A softly glowing ring that never falls.'),

    mask_ember: item('mask_ember', 'mask', 'Ember Bandana', 260, 'rare', ['#ff8a28', '#7a1600'], 'ember', 'Scorched bandana with a smoldering trim.'),
    mask_frost: item('mask_frost', 'mask', 'Frost Guard', 280, 'rare', ['#dffaff', '#238ed1'], 'frost', 'Crystal mask fogged with cold breath.'),
    mask_visor: item('mask_visor', 'mask', 'Combat Visor', 360, 'epic', ['#63f7ff', '#12314f'], 'visor', 'Tactical visor with a glowing cyan strip.'),
    mask_ninja: item('mask_ninja', 'mask', 'Shadow Wrap', 400, 'epic', ['#3a3a46', '#7a4fff'], 'ninja', 'Wrapped cloth mask for silent throws.'),
    mask_skull: item('mask_skull', 'mask', 'Bone Guard', 480, 'legendary', ['#f4f0e6', '#161616'], 'skull', 'Bleached skull mask that grins in a fight.'),
    mask_glitch: item('mask_glitch', 'mask', 'Static Face', 520, 'legendary', ['#ff35d3', '#25f4e8'], 'glitch', 'A face lost to broken scanlines.'),

    wings_paper: item('wings_paper', 'wings', 'Paper Wings', 300, 'rare', ['#ffffff', '#8fd3ff'], 'paper', 'Folded origami wings, light as a breeze.'),
    wings_bat: item('wings_bat', 'wings', 'Bat Wings', 320, 'rare', ['#6a2fb0', '#0d0616'], 'bat', 'Leathery wings for a night arena flyer.'),
    wings_dragon: item('wings_dragon', 'wings', 'Dragon Wings', 420, 'epic', ['#3fae4d', '#123018'], 'dragon', 'Scaled wings that beat with every dash.'),
    wings_circuit: item('wings_circuit', 'wings', 'Circuit Wings', 440, 'epic', ['#4af0ff', '#123c62'], 'circuit', 'Panelled tech wings humming with current.'),
    wings_angel: item('wings_angel', 'wings', 'Seraph Wings', 700, 'legendary', ['#ffffff', '#ffd86a'], 'angel', 'Feathered wings blessed with gold light.'),
    wings_demon: item('wings_demon', 'wings', 'Inferno Wings', 720, 'legendary', ['#ff5722', '#1a0505'], 'demon', 'Charred wings trailing embers as they flap.'),

    backpack_supplies: item('backpack_supplies', 'backpack', 'Supply Rig', 260, 'rare', ['#8a6a3c', '#3f5f2e'], 'supplies', 'Field pack loaded with spare gear.'),
    backpack_balloon: item('backpack_balloon', 'backpack', 'Balloon Pack', 280, 'rare', ['#ff6ea8', '#ffd166'], 'balloon', 'Three balloons tug gently at your back.'),
    backpack_battery: item('backpack_battery', 'backpack', 'Battery Pack', 380, 'epic', ['#ffd400', '#1a1a1a'], 'battery', 'Warning-striped cell humming with charge.'),
    backpack_rocket: item('backpack_rocket', 'backpack', 'Dual Rockets', 420, 'epic', ['#ff4d4d', '#ffd166'], 'rocket', 'Twin rockets primed for a quick escape.'),
    backpack_jetpack: item('backpack_jetpack', 'backpack', 'Jetpack Mk1', 640, 'legendary', ['#9aa4b2', '#ff8a28'], 'jetpack', 'Working thrusters with a low flame idle.'),

    banner_flame: item('banner_flame', 'banner', 'Flame Pennant', 260, 'rare', ['#ff8a28', '#8f1700'], 'flame', 'Small pennant licked by painted flame.'),
    banner_guild: item('banner_guild', 'banner', 'Guild Pennant', 360, 'epic', ['#3ba7ff', '#ffffff'], 'guild', "Crest banner for your crew's colors."),
    banner_skull: item('banner_skull', 'banner', 'Skull Standard', 400, 'epic', ['#1a1a1a', '#cc3333'], 'skull', 'Grim standard flown into every match.'),
    banner_champion: item('banner_champion', 'banner', 'Champion Banner', 560, 'legendary', ['#ffd86a', '#652db4'], 'champion', "Gold-fringed banner for the arena's best."),

    trail_flame: item('trail_flame', 'trail', 'Flame Trail', 260, 'rare', ['#ffbd3c', '#ee2d12'], 'ember', 'Hot footprints spark with every step.'),
    trail_frost: item('trail_frost', 'trail', 'Frost Trail', 280, 'rare', ['#eaffff', '#4aa8ff'], 'frost', 'Icy mist trails behind your feet.'),
    trail_pixel: item('trail_pixel', 'trail', 'Pixel Trail', 360, 'epic', ['#5cf5dc', '#3170ff'], 'pixel', 'Blocky squares fall away as you sprint.'),
    trail_stardust: item('trail_stardust', 'trail', 'Stardust Trail', 400, 'epic', ['#c9a6ff', '#ff9ee0'], 'stardust', 'Fine sparkles drift behind every dash.'),
    trail_glitch: item('trail_glitch', 'trail', 'Glitch Trail', 480, 'legendary', ['#ff35d3', '#25f4e8'], 'glitch', 'Torn scanlines flicker behind your run.'),
    trail_rainbow: item('trail_rainbow', 'trail', 'Rainbow Trail', 520, 'legendary', ['#ff5c9e', '#52f7ff'], 'rainbow', 'A shifting rainbow streak marks your path.'),

    finisher_confetti: item('finisher_confetti', 'finisher', 'Victory Confetti', 260, 'rare', ['#ffe14a', '#ff4d8f'], 'confetti', 'Eliminations burst into golden confetti.'),
    finisher_shatter: item('finisher_shatter', 'finisher', 'Shatter Point', 300, 'rare', ['#e8ffff', '#48a9ff'], 'shatter', 'Opponents crack apart like frozen glass.'),
    finisher_lightning: item('finisher_lightning', 'finisher', 'Thunderstrike', 400, 'epic', ['#fff257', '#3570ff'], 'lightning', 'A bolt seals the elimination in light.'),
    finisher_vortex: item('finisher_vortex', 'finisher', 'Void Collapse', 440, 'epic', ['#c074ff', '#210842'], 'vortex', 'A dark vortex swallows the final hit.'),
    finisher_explosion: item('finisher_explosion', 'finisher', 'Grand Finale', 620, 'legendary', ['#ffcf3d', '#ff4d1a'], 'explosion', 'A fireworks-grade blast ends the round.'),

    // ponytail: "Dark Eater" set — one palette (#c48cff void-purple on #0b0416) across a ball
    // skin (js/ball.js dark_eater), a knife (js/cosmetics.js KNIVES.dark_eater) and these three
    // wearables. Every entry reuses the existing 'void' style, so cosmetic-models.js needs no
    // new builder; the accent sits above the 0.78 bloom threshold so the trim actually glows.
    cape_dark_eater: item('cape_dark_eater', 'cape', 'Dark Eater Shroud', 560, 'legendary', ['#c48cff', '#0b0416'], 'void', 'Torn voidcloth that drinks the arena light.'),
    aura_dark_eater: item('aura_dark_eater', 'aura', 'Dark Eater Halo', 540, 'legendary', ['#e6ccff', '#1a0b2e'], 'void', 'A starved ring of dark energy circles you.'),
    trail_dark_eater: item('trail_dark_eater', 'trail', 'Dark Eater Trail', 500, 'legendary', ['#c48cff', '#2a0f4d'], 'void', 'Each step leaves a bite taken out of the light.')
});

// ponytail: loadout shape is derived from COSMETIC_TYPES so new types never need a second hardcoded list.
export const DEFAULT_WEARABLE_LOADOUT = Object.freeze(
    Object.fromEntries(Object.keys(COSMETIC_TYPES).map(type => [type, 'none']))
);

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
