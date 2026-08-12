const CASES = Object.freeze({
    kickoff: { price: 120, drops: [
        ['knife', 'tide', 'rare', 28], ['knife', 'flare', 'rare', 28], ['knife', 'prism', 'epic', 16], ['knife', 'stiletto', 'rare', 10], ['knife', 'sherlock', 'legendary', 3],
        ['avatar', 'neon', 'rare', 12], ['avatar', 'frost', 'rare', 7], ['avatar', 'astro', 'epic', 4], ['avatar', 'arcade', 'legendary', 2]
    ] },
    chroma: { price: 180, drops: [
        ['knife', 'tide', 'rare', 22], ['knife', 'flare', 'rare', 22], ['knife', 'prism', 'epic', 17], ['knife', 'crimson_web', 'epic', 6], ['knife', 'doppler', 'legendary', 2],
        ['avatar', 'samurai', 'rare', 10], ['avatar', 'moss', 'rare', 8], ['avatar', 'striker', 'epic', 4], ['avatar', 'void', 'epic', 2], ['avatar', 'circuit', 'rare', 7]
    ] },
    arsenal: { price: 240, drops: [
        ['knife', 'prism', 'epic', 32], ['knife', 'crimson_web', 'epic', 25], ['knife', 'cleaver', 'epic', 14], ['knife', 'fade', 'legendary', 10], ['knife', 'doppler', 'legendary', 5], ['knife', 'sherlock', 'legendary', 3],
        ['avatar', 'astro', 'rare', 10], ['avatar', 'void', 'epic', 9], ['avatar', 'royal', 'legendary', 6]
    ] },
    elemental: { price: 190, drops: [
        ['ball', 'magma', 'legendary', 4], ['ball', 'ocean', 'epic', 12], ['ball', 'moon', 'rare', 18], ['knife', 'icefang', 'epic', 14], ['knife', 'dragonclaw', 'legendary', 4],
        ['cosmetic', 'cape_ember', 'rare', 18], ['cosmetic', 'cape_frost', 'rare', 18], ['cosmetic', 'aura_void', 'legendary', 4], ['cosmetic', 'impact_fire', 'epic', 8]
    ] },
    companions: { price: 210, drops: [
        ['cosmetic', 'pet_slime', 'rare', 24], ['cosmetic', 'pet_snowman', 'rare', 20], ['cosmetic', 'pet_bee', 'epic', 16], ['cosmetic', 'pet_drone', 'epic', 14], ['cosmetic', 'pet_axolotl', 'legendary', 8], ['cosmetic', 'pet_dragon', 'legendary', 4],
        ['avatar', 'bee_runner', 'epic', 8], ['avatar', 'axolotl_scout', 'legendary', 4], ['knife', 'pixel_edge', 'rare', 2]
    ] },
    mythic: { price: 280, drops: [
        ['knife', 'aurora', 'legendary', 8], ['knife', 'reactor', 'legendary', 8], ['knife', 'dark_eater', 'legendary', 5], ['ball', 'portal', 'legendary', 10], ['ball', 'blackhole', 'legendary', 6],
        ['avatar', 'galaxy_idol', 'legendary', 10], ['avatar', 'infernal_smile', 'legendary', 10], ['cosmetic', 'cape_royal', 'legendary', 12], ['cosmetic', 'cape_glitch', 'legendary', 10], ['cosmetic', 'shoes_magma', 'legendary', 12], ['cosmetic', 'impact_glitch', 'legendary', 14]
    ] }
});

// Server-owned commerce descriptors. Client catalogs are intentionally kept as
// presentation modules; parity tests fail if an id, type, or exact price drifts.
const BALL_PRICES = Object.freeze({
    fire: 150, ice: 150, lightning: 150, bomb: 150, star: 150, rainbow: 150,
    plasma: 180, abyss: 180, melon: 180,
    inferno: 220, frostbite: 220, voltstorm: 260, nebula: 280, creeper: 300,
    happy: 300, glitch: 340, void_eye: 340, candy: 260, solar: 360, toxic: 240, disco: 320,
    magma: 380, ocean: 300, honey: 280, dragon: 420, portal: 400,
    moon: 260, pumpkin: 300, matrix: 340, sakura: 320, blackhole: 460,
    copper: 200, blizzard: 230, ember_wisp: 210, neon_dash: 240, bubblegum: 220,
    cobalt_storm: 300, venom: 310, circuit: 340, aurora: 290,
    phoenix: 430, cosmic_serpent: 450, prism_king: 480,
    emberfall: 210, glacies: 230, binary_ghost: 310, event_null: 320,
    wildfire_phantom: 440, oblivion_shard: 470,
    shuriken: 280, baseball: 240, blockball: 260, dark_eater: 500
});

const COSMETIC_TYPES = Object.freeze([
    'cape', 'pet', 'shoes', 'aura', 'impact', 'hat',
    'mask', 'wings', 'backpack', 'banner', 'trail', 'finisher'
]);

const COSMETIC_DESCRIPTORS = Object.freeze({
    cape_ember: Object.freeze({ type: 'cape', price: 280 }),
    cape_frost: Object.freeze({ type: 'cape', price: 300 }),
    cape_void: Object.freeze({ type: 'cape', price: 440 }),
    cape_creeper: Object.freeze({ type: 'cape', price: 360 }),
    cape_royal: Object.freeze({ type: 'cape', price: 520 }),
    cape_glitch: Object.freeze({ type: 'cape', price: 480 }),
    pet_slime: Object.freeze({ type: 'pet', price: 260 }),
    pet_dragon: Object.freeze({ type: 'pet', price: 520 }),
    pet_drone: Object.freeze({ type: 'pet', price: 420 }),
    pet_snowman: Object.freeze({ type: 'pet', price: 300 }),
    pet_bee: Object.freeze({ type: 'pet', price: 340 }),
    pet_axolotl: Object.freeze({ type: 'pet', price: 460 }),
    shoes_blaze: Object.freeze({ type: 'shoes', price: 240 }),
    shoes_ice: Object.freeze({ type: 'shoes', price: 240 }),
    shoes_lightning: Object.freeze({ type: 'shoes', price: 340 }),
    shoes_cloud: Object.freeze({ type: 'shoes', price: 300 }),
    shoes_magma: Object.freeze({ type: 'shoes', price: 420 }),
    shoes_pixel: Object.freeze({ type: 'shoes', price: 380 }),
    aura_flame: Object.freeze({ type: 'aura', price: 320 }),
    aura_frost: Object.freeze({ type: 'aura', price: 340 }),
    aura_void: Object.freeze({ type: 'aura', price: 520 }),
    aura_hearts: Object.freeze({ type: 'aura', price: 360 }),
    aura_music: Object.freeze({ type: 'aura', price: 420 }),
    aura_toxic: Object.freeze({ type: 'aura', price: 460 }),
    impact_confetti: Object.freeze({ type: 'impact', price: 220 }),
    impact_ice: Object.freeze({ type: 'impact', price: 260 }),
    impact_fire: Object.freeze({ type: 'impact', price: 320 }),
    impact_pixels: Object.freeze({ type: 'impact', price: 360 }),
    impact_stars: Object.freeze({ type: 'impact', price: 400 }),
    impact_glitch: Object.freeze({ type: 'impact', price: 480 }),
    hat_cap: Object.freeze({ type: 'hat', price: 240 }),
    hat_beanie: Object.freeze({ type: 'hat', price: 260 }),
    hat_pixel: Object.freeze({ type: 'hat', price: 300 }),
    hat_helm: Object.freeze({ type: 'hat', price: 360 }),
    hat_wizard: Object.freeze({ type: 'hat', price: 400 }),
    hat_horns: Object.freeze({ type: 'hat', price: 380 }),
    hat_crown: Object.freeze({ type: 'hat', price: 620 }),
    hat_halo: Object.freeze({ type: 'hat', price: 560 }),
    mask_ember: Object.freeze({ type: 'mask', price: 260 }),
    mask_frost: Object.freeze({ type: 'mask', price: 280 }),
    mask_visor: Object.freeze({ type: 'mask', price: 360 }),
    mask_ninja: Object.freeze({ type: 'mask', price: 400 }),
    mask_skull: Object.freeze({ type: 'mask', price: 480 }),
    mask_glitch: Object.freeze({ type: 'mask', price: 520 }),
    wings_paper: Object.freeze({ type: 'wings', price: 300 }),
    wings_bat: Object.freeze({ type: 'wings', price: 320 }),
    wings_dragon: Object.freeze({ type: 'wings', price: 420 }),
    wings_circuit: Object.freeze({ type: 'wings', price: 440 }),
    wings_angel: Object.freeze({ type: 'wings', price: 700 }),
    wings_demon: Object.freeze({ type: 'wings', price: 720 }),
    backpack_supplies: Object.freeze({ type: 'backpack', price: 260 }),
    backpack_balloon: Object.freeze({ type: 'backpack', price: 280 }),
    backpack_battery: Object.freeze({ type: 'backpack', price: 380 }),
    backpack_rocket: Object.freeze({ type: 'backpack', price: 420 }),
    backpack_jetpack: Object.freeze({ type: 'backpack', price: 640 }),
    banner_flame: Object.freeze({ type: 'banner', price: 260 }),
    banner_guild: Object.freeze({ type: 'banner', price: 360 }),
    banner_skull: Object.freeze({ type: 'banner', price: 400 }),
    banner_champion: Object.freeze({ type: 'banner', price: 560 }),
    trail_flame: Object.freeze({ type: 'trail', price: 260 }),
    trail_frost: Object.freeze({ type: 'trail', price: 280 }),
    trail_pixel: Object.freeze({ type: 'trail', price: 360 }),
    trail_stardust: Object.freeze({ type: 'trail', price: 400 }),
    trail_glitch: Object.freeze({ type: 'trail', price: 480 }),
    trail_rainbow: Object.freeze({ type: 'trail', price: 520 }),
    finisher_confetti: Object.freeze({ type: 'finisher', price: 260 }),
    finisher_shatter: Object.freeze({ type: 'finisher', price: 300 }),
    finisher_lightning: Object.freeze({ type: 'finisher', price: 400 }),
    finisher_vortex: Object.freeze({ type: 'finisher', price: 440 }),
    finisher_explosion: Object.freeze({ type: 'finisher', price: 620 }),
    cape_dark_eater: Object.freeze({ type: 'cape', price: 560 }),
    aura_dark_eater: Object.freeze({ type: 'aura', price: 540 }),
    trail_dark_eater: Object.freeze({ type: 'trail', price: 500 })
});

const COSMETIC_PRICES = Object.freeze(Object.fromEntries(
    Object.entries(COSMETIC_DESCRIPTORS).map(([id, descriptor]) => [id, descriptor.price])
));

// Obsidian remains a valid legacy-owned knife even though it is not currently
// in a case. Every case knife is derived, so adding a drop cannot silently miss
// server authorization again.
const KNIFE_CATALOG = Object.freeze(Object.fromEntries([
    'obsidian',
    ...new Set(Object.values(CASES).flatMap(box => box.drops
        .filter(([kind]) => kind === 'knife')
        .map(([, id]) => id)))
].map(id => [id, 1])));

module.exports = {
    BALL_PRICES,
    CASES,
    COSMETIC_DESCRIPTORS,
    COSMETIC_PRICES,
    COSMETIC_TYPES,
    KNIFE_CATALOG
};
