const CASES = Object.freeze({
    kickoff: { price: 120, drops: [
        ['knife', 'tide', 'rare', 19], ['knife', 'flare', 'rare', 19], ['knife', 'courtline', 'rare', 10], ['knife', 'stiletto', 'rare', 10], ['knife', 'prism', 'epic', 16], ['knife', 'sherlock', 'legendary', 3], ['cosmetic', 'gloves_kinetic', 'rare', 8],
        ['avatar', 'neon', 'rare', 12], ['avatar', 'frost', 'rare', 7], ['avatar', 'astro', 'epic', 4], ['avatar', 'arcade', 'legendary', 2]
    ] },
    chroma: { price: 180, drops: [
        ['knife', 'tide', 'rare', 22], ['knife', 'flare', 'rare', 22], ['knife', 'prism', 'epic', 11], ['knife', 'crimson_web', 'epic', 6], ['knife', 'doppler', 'legendary', 2], ['cosmetic', 'gloves_prism', 'epic', 6],
        ['avatar', 'samurai', 'rare', 10], ['avatar', 'moss', 'rare', 8], ['avatar', 'striker', 'epic', 4], ['avatar', 'void', 'epic', 2], ['avatar', 'circuit', 'rare', 7]
    ] },
    arsenal: { price: 240, drops: [
        ['knife', 'prism', 'epic', 27], ['knife', 'crimson_web', 'epic', 20], ['knife', 'pulsewing', 'epic', 10], ['knife', 'cleaver', 'epic', 14], ['knife', 'fade', 'legendary', 10], ['knife', 'doppler', 'legendary', 5], ['knife', 'sherlock', 'legendary', 3],
        ['avatar', 'astro', 'rare', 10], ['avatar', 'void', 'epic', 9], ['avatar', 'royal', 'legendary', 6]
    ] },
    elemental: { price: 190, drops: [
        ['ball', 'magma', 'legendary', 4], ['ball', 'ocean', 'epic', 12], ['ball', 'moon', 'rare', 18], ['knife', 'icefang', 'epic', 14], ['knife', 'dragonclaw', 'legendary', 4],
        ['cosmetic', 'cape_ember', 'rare', 18], ['cosmetic', 'cape_frost', 'rare', 18], ['cosmetic', 'aura_void', 'legendary', 4], ['cosmetic', 'impact_fire', 'epic', 8], ['knife', 'huntsman_tide', 'rare', 8]
    ] },
    companions: { price: 210, drops: [
        ['cosmetic', 'pet_slime', 'rare', 24], ['cosmetic', 'pet_snowman', 'rare', 20], ['cosmetic', 'pet_bee', 'epic', 16], ['cosmetic', 'pet_drone', 'epic', 14], ['cosmetic', 'pet_axolotl', 'legendary', 8], ['cosmetic', 'pet_dragon', 'legendary', 4],
        ['avatar', 'bee_runner', 'epic', 8], ['avatar', 'axolotl_scout', 'legendary', 4], ['knife', 'pixel_edge', 'rare', 2], ['knife', 'flip_carbon', 'rare', 2]
    ] },
    mythic: { price: 280, drops: [
        ['knife', 'aurora', 'legendary', 5], ['knife', 'reactor', 'legendary', 5], ['knife', 'dark_eater', 'legendary', 5], ['knife', 'rift_hook', 'legendary', 5], ['ball', 'portal', 'legendary', 10], ['ball', 'blackhole', 'legendary', 6],
        ['avatar', 'galaxy_idol', 'legendary', 10], ['avatar', 'infernal_smile', 'legendary', 10], ['cosmetic', 'cape_royal', 'legendary', 9], ['cosmetic', 'cape_glitch', 'legendary', 10], ['cosmetic', 'shoes_magma', 'legendary', 12], ['cosmetic', 'impact_glitch', 'legendary', 12], ['cosmetic', 'gloves_crown', 'legendary', 6]
    ] },
    // Glovebox Case: coin-only, gloves-exclusive chase box (owner ask — "lots of
    // gloves, people should open many cases to chase items"). Legendary is kept
    // rare by weight so the S-tier gauntlets stay a real chase, not a coinflip.
    gloves: { price: 260, drops: [
        ['cosmetic', 'gloves_windrunner', 'rare', 12], ['cosmetic', 'gloves_clay_court', 'rare', 12], ['cosmetic', 'gloves_riptide', 'rare', 12], ['cosmetic', 'gloves_sandstorm', 'rare', 12],
        ['cosmetic', 'gloves_thornback', 'rare', 12], ['cosmetic', 'gloves_ashfall', 'rare', 12], ['cosmetic', 'gloves_lowlight', 'rare', 12], ['cosmetic', 'gloves_terra', 'rare', 12],
        ['cosmetic', 'gloves_neon_pulse', 'epic', 6], ['cosmetic', 'gloves_ironclad', 'epic', 6], ['cosmetic', 'gloves_wildfire', 'epic', 6], ['cosmetic', 'gloves_deep_current', 'epic', 6],
        ['cosmetic', 'gloves_grid_runner', 'epic', 6], ['cosmetic', 'gloves_venom_weave', 'epic', 6], ['cosmetic', 'gloves_frostbyte', 'epic', 6], ['cosmetic', 'gloves_crimson_circuit', 'epic', 6],
        ['cosmetic', 'gloves_supernova', 'legendary', 2], ['cosmetic', 'gloves_voidforge', 'legendary', 2], ['cosmetic', 'gloves_phoenix_ember', 'legendary', 2], ['cosmetic', 'gloves_aurora_veil', 'legendary', 2],
        ['cosmetic', 'gloves_titanium_crest', 'legendary', 2], ['cosmetic', 'gloves_dragon_lord', 'legendary', 2], ['cosmetic', 'gloves_starforged', 'legendary', 2], ['cosmetic', 'gloves_eclipse_king', 'legendary', 2]
    ] },
    // Blade Vault Case: the kukri/gut/huntsman/talon/flip silhouettes (js/weapon-models.js
    // KNIFE_MODELS) get their own dedicated box instead of crowding the locked odds
    // of kickoff/chroma/arsenal/mythic (tests/server-commerce-parity.test.mjs pins
    // those four exactly).
    blades: { price: 240, drops: [
        ['knife', 'night_kukri', 'rare', 20], ['knife', 'gut_frost', 'rare', 20], ['knife', 'huntsman_brass', 'rare', 20],
        ['knife', 'gut_circuit', 'epic', 12], ['knife', 'kukri_sunset', 'epic', 12], ['knife', 'talon_reactor', 'epic', 12], ['knife', 'flip_prism', 'epic', 12],
        ['knife', 'huntsman_wildfire', 'legendary', 5], ['knife', 'talon_aurora', 'legendary', 5], ['knife', 'kukri_void', 'legendary', 5]
    ] },
    // Collection cases (owner ask: "extra skin themes"): one case per js/cosmetics.js
    // COLLECTIONS entry, mixing that collection's 3 knives, 3 gloves and 2 (reused,
    // already-priced) ball skins. Must mirror js/cosmetics.js CASES exactly — see
    // tests/server-commerce-parity.test.mjs and tests/glovebox-blade-vault.test.mjs.
    neon_syndicate: { price: 250, drops: [
        ['knife', 'ns_pulse', 'rare', 18], ['knife', 'ns_wraith', 'epic', 10], ['knife', 'ns_overdrive', 'legendary', 4],
        ['cosmetic', 'gloves_ns_circuit', 'rare', 18], ['cosmetic', 'gloves_ns_pulsegrip', 'rare', 18], ['cosmetic', 'gloves_ns_overclock', 'epic', 10],
        ['ball', 'neon_dash', 'rare', 18], ['ball', 'plasma', 'epic', 10]
    ] },
    frostbite: { price: 230, drops: [
        ['knife', 'fb_shard', 'rare', 18], ['knife', 'fb_glacier', 'epic', 10], ['knife', 'fb_permafrost', 'legendary', 4],
        ['cosmetic', 'gloves_fb_permafrost', 'rare', 18], ['cosmetic', 'gloves_fb_glacierweave', 'rare', 18], ['cosmetic', 'gloves_fb_avalanche', 'epic', 10],
        ['ball', 'frostbite', 'rare', 18], ['ball', 'aurora', 'epic', 10]
    ] },
    inferno_forge: { price: 260, drops: [
        ['knife', 'if_cinder', 'rare', 16], ['knife', 'if_slagfang', 'epic', 9], ['knife', 'if_wyrmforge', 'legendary', 3],
        ['cosmetic', 'gloves_if_cinderwrap', 'rare', 16], ['cosmetic', 'gloves_if_slagforge', 'rare', 16], ['cosmetic', 'gloves_if_wyrmforge', 'epic', 9],
        ['ball', 'fire', 'rare', 16], ['ball', 'ember_wisp', 'rare', 16]
    ] },
    celestial: { price: 270, drops: [
        ['knife', 'cel_comet', 'rare', 18], ['knife', 'cel_starfall', 'epic', 10], ['knife', 'cel_zenith', 'legendary', 4],
        ['cosmetic', 'gloves_cel_stardust', 'rare', 18], ['cosmetic', 'gloves_cel_orbit', 'rare', 18], ['cosmetic', 'gloves_cel_supernova', 'epic', 10],
        ['ball', 'moon', 'rare', 18], ['ball', 'nebula', 'epic', 10]
    ] },
    ronin: { price: 250, drops: [
        ['knife', 'ro_sakura', 'rare', 18], ['knife', 'ro_crimson_blade', 'epic', 10], ['knife', 'ro_shogun', 'legendary', 4],
        ['cosmetic', 'gloves_ro_lacquer', 'rare', 18], ['cosmetic', 'gloves_ro_petal', 'rare', 18], ['cosmetic', 'gloves_ro_shogun', 'epic', 10],
        ['ball', 'copper', 'rare', 18], ['ball', 'sakura', 'epic', 10]
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
    'mask', 'wings', 'backpack', 'banner', 'trail', 'finisher', 'gloves'
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
    gloves_kinetic: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_prism: Object.freeze({ type: 'gloves', price: 420 }),
    gloves_crown: Object.freeze({ type: 'gloves', price: 620 }),
    hat_solar_circuit_headset: Object.freeze({ type: 'hat', price: 340 }),
    gloves_solar_circuit_grips: Object.freeze({ type: 'gloves', price: 300 }),
    cape_solar_circuit_streamer: Object.freeze({ type: 'cape', price: 360 }),
    wings_solar_circuit_panels: Object.freeze({ type: 'wings', price: 440 }),
    shoes_solar_circuit_sprints: Object.freeze({ type: 'shoes', price: 340 }),
    backpack_solar_circuit_court_bag: Object.freeze({ type: 'backpack', price: 420 }),
    hat_tidal_drift_cap: Object.freeze({ type: 'hat', price: 280 }),
    cape_tidal_drift_swell: Object.freeze({ type: 'cape', price: 300 }),
    wings_tidal_drift_sails: Object.freeze({ type: 'wings', price: 380 }),
    shoes_tidal_drift_skimmers: Object.freeze({ type: 'shoes', price: 300 }),
    backpack_tidal_drift_float: Object.freeze({ type: 'backpack', price: 380 }),
    pet_tidal_drift_ray: Object.freeze({ type: 'pet', price: 460 }),
    hat_court_carnival_visor: Object.freeze({ type: 'hat', price: 240 }),
    backpack_court_carnival_popcorn: Object.freeze({ type: 'backpack', price: 320 }),
    shoes_court_carnival_rally: Object.freeze({ type: 'shoes', price: 220 }),
    cape_court_carnival_pennants: Object.freeze({ type: 'cape', price: 240 }),
    hat_orbital_club_antennas: Object.freeze({ type: 'hat', price: 260 }),
    pet_orbital_club_satellite: Object.freeze({ type: 'pet', price: 420 }),
    backpack_orbital_club_star: Object.freeze({ type: 'backpack', price: 360 }),
    wings_orbital_club_comet: Object.freeze({ type: 'wings', price: 480 }),
    finisher_confetti: Object.freeze({ type: 'finisher', price: 260 }),
    finisher_shatter: Object.freeze({ type: 'finisher', price: 300 }),
    finisher_lightning: Object.freeze({ type: 'finisher', price: 400 }),
    finisher_vortex: Object.freeze({ type: 'finisher', price: 440 }),
    finisher_explosion: Object.freeze({ type: 'finisher', price: 620 }),
    cape_dark_eater: Object.freeze({ type: 'cape', price: 560 }),
    aura_dark_eater: Object.freeze({ type: 'aura', price: 540 }),
    trail_dark_eater: Object.freeze({ type: 'trail', price: 500 }),

    // Glovebox Case wave — must mirror js/cosmetic-catalog.js COSMETICS exactly (id/price).
    gloves_windrunner: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_clay_court: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_riptide: Object.freeze({ type: 'gloves', price: 300 }),
    gloves_sandstorm: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_thornback: Object.freeze({ type: 'gloves', price: 300 }),
    gloves_ashfall: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_lowlight: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_terra: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_neon_pulse: Object.freeze({ type: 'gloves', price: 400 }),
    gloves_ironclad: Object.freeze({ type: 'gloves', price: 420 }),
    gloves_wildfire: Object.freeze({ type: 'gloves', price: 440 }),
    gloves_deep_current: Object.freeze({ type: 'gloves', price: 400 }),
    gloves_grid_runner: Object.freeze({ type: 'gloves', price: 420 }),
    gloves_venom_weave: Object.freeze({ type: 'gloves', price: 380 }),
    gloves_frostbyte: Object.freeze({ type: 'gloves', price: 400 }),
    gloves_crimson_circuit: Object.freeze({ type: 'gloves', price: 440 }),
    gloves_supernova: Object.freeze({ type: 'gloves', price: 620 }),
    gloves_voidforge: Object.freeze({ type: 'gloves', price: 600 }),
    gloves_phoenix_ember: Object.freeze({ type: 'gloves', price: 640 }),
    gloves_aurora_veil: Object.freeze({ type: 'gloves', price: 600 }),
    gloves_titanium_crest: Object.freeze({ type: 'gloves', price: 580 }),
    gloves_dragon_lord: Object.freeze({ type: 'gloves', price: 660 }),
    gloves_starforged: Object.freeze({ type: 'gloves', price: 620 }),
    gloves_eclipse_king: Object.freeze({ type: 'gloves', price: 680 }),

    // Collection wave — must mirror js/cosmetic-catalog.js COSMETICS exactly (id/price).
    gloves_ns_circuit: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_ns_pulsegrip: Object.freeze({ type: 'gloves', price: 300 }),
    gloves_ns_overclock: Object.freeze({ type: 'gloves', price: 420 }),
    gloves_fb_permafrost: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_fb_glacierweave: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_fb_avalanche: Object.freeze({ type: 'gloves', price: 400 }),
    gloves_if_cinderwrap: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_if_slagforge: Object.freeze({ type: 'gloves', price: 300 }),
    gloves_if_wyrmforge: Object.freeze({ type: 'gloves', price: 440 }),
    gloves_cel_stardust: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_cel_orbit: Object.freeze({ type: 'gloves', price: 300 }),
    gloves_cel_supernova: Object.freeze({ type: 'gloves', price: 420 }),
    gloves_ro_lacquer: Object.freeze({ type: 'gloves', price: 260 }),
    gloves_ro_petal: Object.freeze({ type: 'gloves', price: 280 }),
    gloves_ro_shogun: Object.freeze({ type: 'gloves', price: 420 })
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
