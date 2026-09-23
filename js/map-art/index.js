// map-art/index.js — entry point for the procedural map-art layer.
//
// Loaded lazily by Arena._loadMapArt() (a dynamic import, so it ships as its
// own chunk and never blocks first load). Pure presentation: every object is
// added through arena.add() (so Arena.clearMap() disposes it on map switch),
// every CanvasTexture is registered in arena._artTextures (disposed there
// too), and all animation is driven by the shared arena._artTime uniform.
import { createArtContext } from './kit.js';
import { buildNeonRooftopArt, buildSunkenTempleArt, buildOrbitalStationArt } from './new-maps.js';
import { POLISH_BUILDERS } from './polish.js';
import { buildSunbakedBazaarArt } from './landmark-bazaar.js';
import { buildHarborNightworksArt } from './landmark-harbor.js';
import { buildAlpineResearchArt } from './landmark-alpine.js';
import { buildJadeGardenArt } from './landmark-jade.js';

// Identity scenery for the new maps is built on every tier (Low gets a static,
// thinner version); the polish layer for existing maps is medium/high only.
export const IDENTITY_BUILDERS = Object.freeze({
    neon_rooftop: buildNeonRooftopArt,
    sunken_temple: buildSunkenTempleArt,
    orbital_station: buildOrbitalStationArt,
    sunbaked_bazaar: buildSunbakedBazaarArt,
    harbor_nightworks: buildHarborNightworksArt,
    alpine_research: buildAlpineResearchArt,
    jade_garden: buildJadeGardenArt
});

export function hasMapArt(mapId, tier) {
    return Object.hasOwn(IDENTITY_BUILDERS, mapId)
        || (tier !== 'low' && Object.hasOwn(POLISH_BUILDERS, mapId));
}

export function buildMapArt(arena, tier = 'medium') {
    const builder = IDENTITY_BUILDERS[arena.mapId]
        || (tier !== 'low' ? POLISH_BUILDERS[arena.mapId] : null);
    if (!builder) return 0;
    const before = arena.objects.length;
    builder(createArtContext(arena, tier));
    return arena.objects.length - before;
}

export { POLISH_BUILDERS };
// The world outside the court + stands (every tier; see backdrop.js).
export { buildBackdrop, backdropThemeFor, BACKDROP_THEMES } from './backdrop.js';
