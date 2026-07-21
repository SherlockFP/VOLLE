const CASES = Object.freeze({
    kickoff: { price: 120, drops: [
        ['knife', 'tide', 'rare', 28], ['knife', 'flare', 'rare', 28], ['knife', 'prism', 'epic', 16], ['knife', 'sherlock', 'legendary', 3],
        ['avatar', 'neon', 'rare', 12], ['avatar', 'frost', 'rare', 7], ['avatar', 'astro', 'epic', 4], ['avatar', 'arcade', 'legendary', 2]
    ] },
    chroma: { price: 180, drops: [
        ['knife', 'tide', 'rare', 22], ['knife', 'flare', 'rare', 22], ['knife', 'prism', 'epic', 17], ['knife', 'crimson_web', 'epic', 6], ['knife', 'doppler', 'legendary', 2],
        ['avatar', 'samurai', 'rare', 10], ['avatar', 'moss', 'rare', 8], ['avatar', 'striker', 'epic', 4], ['avatar', 'void', 'epic', 2], ['avatar', 'circuit', 'rare', 7]
    ] },
    arsenal: { price: 240, drops: [
        ['knife', 'prism', 'epic', 32], ['knife', 'crimson_web', 'epic', 25], ['knife', 'fade', 'legendary', 10], ['knife', 'doppler', 'legendary', 5], ['knife', 'sherlock', 'legendary', 3],
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
        ['knife', 'aurora', 'legendary', 8], ['knife', 'reactor', 'legendary', 8], ['ball', 'portal', 'legendary', 10], ['ball', 'blackhole', 'legendary', 6],
        ['avatar', 'galaxy_idol', 'legendary', 10], ['avatar', 'infernal_smile', 'legendary', 10], ['cosmetic', 'cape_royal', 'legendary', 12], ['cosmetic', 'cape_glitch', 'legendary', 10], ['cosmetic', 'shoes_magma', 'legendary', 12], ['cosmetic', 'impact_glitch', 'legendary', 14]
    ] }
});

module.exports = { CASES };
