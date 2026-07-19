// arena.js — 10+ maps with themed visuals, transparent walls, portals, bright skyboxes.
// ponytail: her map tek config objesi, build() mevcut pattern'i takip eder.
import * as THREE from 'three';
import { WeatherSystem } from './weather.js';

// Daha büyük court'lar + aydınlık temalar. dark space/neon → aydınlık palet.
export const MAPS = {
    beach: {
        name: '🏖️ Beach Arena',
        courtWidth: 106, courtLength: 120, wallHeight: 22, ceilingHeight: 31,
        floorRed: 0xe8a050, floorBlue: 0x7fd0e8, wallColor: 0xeaf2ff,
        skyTop: 0x3aa5ff, skyBottom: 0xcfeeff, fogColor: 0xcfeeff,
        hasOcean: true, hasGlass: true, size: 'medium', weather: 'clear', openSides: true
    },
    beach_open: {
        name: 'Beach Volleyball',
        courtWidth: 52, courtLength: 68, wallHeight: 9, ceilingHeight: 0,
        floorRed: 0xe8a050, floorBlue: 0xd0a860, wallColor: 0xf0d090,
        skyTop: 0x3aa5ff, skyBottom: 0xcfeeff, fogColor: 0xcfeeff,
        hasOcean: true, hasGlass: false, openAir: true, isBeachOpen: true, size: 'small', weather: 'clear', noSides: true,
        spectator: {
            bounds: { minX: -46, maxX: 46, minY: 0, maxY: 18, minZ: -50, maxZ: 50 },
            stands: [
                { side: 'west', tiers: 3, length: 34, depth: 2.2, rise: 0.75, setback: 5 },
                { side: 'east', tiers: 3, length: 34, depth: 2.2, rise: 0.75, setback: 5 }
            ]
        },
        gameplay: {
            mechanics: ['volleyball-net', 'sand-traction', 'open-air'],
            netHeight: 2.43,
            sandTraction: 0.9,
            ballGravityScale: 0.88,
            playerSpawnZ: 20,
            fallDeathY: -8
        },
        sky: { horizonColor: 0xffe1a8, sun: true, sunColor: 0xfff1b0, cloudAmount: 0.55 }
    },
    industrial: {
        name: '🏭 Factory',
        courtWidth: 101, courtLength: 112, wallHeight: 21, ceilingHeight: 28,
        floorRed: 0xd85c5c, floorBlue: 0x5c7fe0, wallColor: 0xaac0d8,
        skyTop: 0x6a90c8, skyBottom: 0xe6eefc, fogColor: 0xdde6f5,
        hasOcean: false, hasGlass: true, size: 'medium', weather: 'clear'
    },
    space: {
        name: '🚀 Space Station',
        courtWidth: 115, courtLength: 125, wallHeight: 24, ceilingHeight: 34,
        floorRed: 0xd04080, floorBlue: 0x4080d0, wallColor: 0x8090b0,
        skyTop: 0x1a2050, skyBottom: 0x3a4080, fogColor: 0x2a3060,
        hasOcean: false, hasGlass: true, isSpace: true, size: 'large',
        lowGravity: true, hasPortals: true, weather: 'clear', openSides: true
    },
    neon: {
        name: '🌆 Neon City',
        courtWidth: 106, courtLength: 120, wallHeight: 22, ceilingHeight: 31,
        floorRed: 0xff3d81, floorBlue: 0x2de2e6, wallColor: 0x4a3a7a,
        skyTop: 0x4a2a8a, skyBottom: 0x8a5acc, fogColor: 0x5a3a9a,
        hasOcean: false, hasGlass: true, isNeon: true, size: 'medium',
        hasPortals: true, weather: 'rain', openSides: true
    },
    dojo: {
        courtWidth: 90, courtLength: 62, wallHeight: 17, ceilingHeight: 24,
        floorRed: 0x8B4513, floorBlue: 0x6e3b10, wallColor: 0x654321, fogColor: 0x87CEEB,
        isDojo: true,
        name: 'Dojo', emoji: '🥋',
        floor: 0x8B4513, wall: 0x654321, ceiling: 0x3d2b1f,
        skyTop: 0x87CEEB, skyBottom: 0xE0F0FF,
        fog: 0x87CEEB, fogNear: 30, fogFar: 120,
        ambient: 0xffeedd, hemisphere: 0xffeebb,
        size: { x: 90, z: 62 },
        props: [
            { type: 'box', pos: [0, 1, 0], size: [4, 2, 4], color: 0x654321 },
            { type: 'cylinder', pos: [-20, 3, 15], size: [0.3, 6], color: 0xff4400 },
            { type: 'cylinder', pos: [20, 3, -15], size: [0.3, 6], color: 0xff4400 }
        ],
        weather: 'none'
    },
    colosseum: {
        courtWidth: 100, courtLength: 70, wallHeight: 19, ceilingHeight: 27,
        floorRed: 0xD2B48C, floorBlue: 0xb99a70, wallColor: 0xC4A882, fogColor: 0xC4A882,
        isColosseum: true,
        name: 'Colosseum', emoji: '🏛️',
        floor: 0xD2B48C, wall: 0xC4A882, ceiling: 0x8B7355,
        skyTop: 0x4169E1, skyBottom: 0x87CEEB,
        fog: 0xC4A882, fogNear: 40, fogFar: 150,
        ambient: 0xffeedd, hemisphere: 0xffddaa,
        size: { x: 100, z: 70 },
        props: [
            { type: 'cylinder', pos: [-30, 5, 0], size: [2, 10], color: 0xC4A882 },
            { type: 'cylinder', pos: [30, 5, 0], size: [2, 10], color: 0xC4A882 },
            { type: 'cylinder', pos: [0, 5, -25], size: [2, 10], color: 0xC4A882 }
        ],
        weather: 'none'
    },
    volcano: {
        courtWidth: 88, courtLength: 60, wallHeight: 20, ceilingHeight: 28,
        floorRed: 0x2d1b00, floorBlue: 0x1f1200, wallColor: 0x1a0f00, fogColor: 0x330000,
        isVolcano: true,
        name: 'Volcano', emoji: '🌋',
        floor: 0x2d1b00, wall: 0x1a0f00, ceiling: 0x0a0500,
        skyTop: 0x1a0000, skyBottom: 0x330000,
        fog: 0x330000, fogNear: 20, fogFar: 100,
        ambient: 0xff4400, hemisphere: 0xff2200,
        size: { x: 88, z: 60 },
        props: [
            { type: 'cone', pos: [0, 0, 0], size: [8, 15], color: 0x440000 },
            { type: 'sphere', pos: [-25, 2, 20], size: [2], color: 0xff4400 },
            { type: 'sphere', pos: [25, 2, -20], size: [2], color: 0xff4400 }
        ],
        weather: 'storm'
    },
    ice: {
        name: '❄️ Ice Palace',
        courtWidth: 108, courtLength: 120, wallHeight: 22, ceilingHeight: 31,
        floorRed: 0xa8d8f0, floorBlue: 0xd8f0ff, wallColor: 0xc8e8ff,
        skyTop: 0x88c8ff, skyBottom: 0xe0f4ff, fogColor: 0xe0f4ff,
        hasOcean: false, hasGlass: true, isIce: true, size: 'medium',
        slippery: true, weather: 'snow', openSides: true
    },
    cloud: {
        name: '☁️ Cloud Realm',
        courtWidth: 120, courtLength: 132, wallHeight: 21, ceilingHeight: 29,
        floorRed: 0xffd8e8, floorBlue: 0xd8e8ff, wallColor: 0xffffff,
        skyTop: 0xaaddff, skyBottom: 0xffeef8, fogColor: 0xffeef8,
        hasOcean: false, hasGlass: true, isCloud: true, size: 'large',
        lowGravity: true, weather: 'clear', openSides: true
    },
    jungle: {
        name: '🌴 Jungle',
        courtWidth: 115, courtLength: 125, wallHeight: 24, ceilingHeight: 33,
        floorRed: 0x6a8a3a, floorBlue: 0x3a6a5a, wallColor: 0x8a7a5a,
        skyTop: 0x88cc66, skyBottom: 0xeef8c8, fogColor: 0xddeec0,
        hasOcean: false, hasGlass: false, isJungle: true, size: 'medium', weather: 'rain'
    },
    cyber: {
        name: '🤖 Cyber Grid',
        courtWidth: 101, courtLength: 114, wallHeight: 22, ceilingHeight: 31,
        floorRed: 0xff2266, floorBlue: 0x22ddff, wallColor: 0x334455,
        skyTop: 0x00ddff, skyBottom: 0x66ffee, fogColor: 0x44ccdd,
        hasOcean: false, hasGlass: true, isCyber: true, size: 'medium',
        hasPortals: true, weather: 'storm', openSides: true
    },
    canyon: {
        name: '🏜️ Canyon',
        courtWidth: 163, courtLength: 77, wallHeight: 31, ceilingHeight: 39,
        floorRed: 0xd4a06a, floorBlue: 0xb8885a, wallColor: 0xc89868,
        skyTop: 0x3a88cc, skyBottom: 0xeec888, fogColor: 0xeec888,
        hasOcean: false, hasGlass: false, isCanyon: true, size: 'xl', weather: 'clear'
    },
    pillar: {
        name: '🏛️ Pillar Hall',
        courtWidth: 123, courtLength: 132, wallHeight: 22, ceilingHeight: 31,
        floorRed: 0x887a6a, floorBlue: 0x6a7a8a, wallColor: 0x9a8a7a,
        skyTop: 0x6a80a0, skyBottom: 0xd0c8b8, fogColor: 0xc8c0b0,
        hasOcean: false, hasGlass: true, isPillar: true, size: 'large', weather: 'clear'
    },
    lava: {
        name: '🌋 Lava Pit',
        courtWidth: 110, courtLength: 125, wallHeight: 22, ceilingHeight: 0,
        floorRed: 0xff3300, floorBlue: 0xff5500, wallColor: 0x4a2020,
        skyTop: 0xff4422, skyBottom: 0x662200, fogColor: 0x442200,
        hasOcean: false, hasGlass: false, isLava: true, size: 'medium',
        openAir: true, openSides: true, weather: 'clear'
    },
    crystal: {
        name: '💎 Crystal Cave',
        courtWidth: 106, courtLength: 120, wallHeight: 21, ceilingHeight: 26,
        floorRed: 0x88aacc, floorBlue: 0x6688bb, wallColor: 0x7799bb,
        skyTop: 0x4488aa, skyBottom: 0x88ccee, fogColor: 0x88ccee,
        hasOcean: false, hasGlass: false, isCrystal: true, size: 'medium',
        hasPortals: true, weather: 'clear'
    },
    mecha: {
        name: '🤖 Mecha Hangar',
        courtWidth: 144, courtLength: 145, wallHeight: 29, ceilingHeight: 38,
        floorRed: 0x556677, floorBlue: 0x445566, wallColor: 0x667788,
        skyTop: 0x334455, skyBottom: 0x8899aa, fogColor: 0x778899,
        hasOcean: false, hasGlass: true, isMecha: true, size: 'xxl',
        hasPortals: true, weather: 'clear'
    },
    atlantis: {
        name: '🌊 Atlantis',
        courtWidth: 115, courtLength: 128, wallHeight: 24, ceilingHeight: 33,
        floorRed: 0x14758f, floorBlue: 0x125f91, wallColor: 0x59c7d4,
        skyTop: 0x003c5a, skyBottom: 0x1490a8, fogColor: 0x0b6680,
        hasOcean: false, hasGlass: true, isAtlantis: true, size: 'large',
        weather: 'clear', openSides: true
    },
    minecraft: {
        name: '⛏️ Minecraft',
        courtWidth: 101, courtLength: 114, wallHeight: 17, ceilingHeight: 33,
        floorRed: 0x7cb342, floorBlue: 0x5a8a2a, wallColor: 0x8a6a3a,
        skyTop: 0x88ddff, skyBottom: 0xcceeff, fogColor: 0xcceeff,
        hasOcean: false, hasGlass: false, size: 'medium', weather: 'clear',
        isMinecraft: true, openSides: true
    },
    esport_arena: {
        name: '🏟️ Esport Arena',
        courtWidth: 67, courtLength: 44, wallHeight: 17, ceilingHeight: 24,
        floorRed: 0xcc3333, floorBlue: 0x3355cc, wallColor: 0xcccccc,
        skyTop: 0x88bbff, skyBottom: 0xddddee, fogColor: 0xccccdd,
        hasOcean: false, hasGlass: true, isEsport: true, size: 'medium', weather: 'indoor', openSides: true
    },
    dropworks: {
        name: 'Dropworks Parkour',
        courtWidth: 72, courtLength: 92, wallHeight: 34, ceilingHeight: 52,
        floorRed: 0xb84435, floorBlue: 0x3d6f91, wallColor: 0x667078,
        skyTop: 0x4a6078, skyBottom: 0xd7b98b, fogColor: 0x9aa4aa,
        hasOcean: false, hasGlass: false, isVerticalDrop: true, size: 'large',
        weather: 'clear', openSides: true,
        spectator: {
            bounds: { minX: -58, maxX: 58, minY: -18, maxY: 62, minZ: -66, maxZ: 66 },
            stands: [
                { side: 'west', tiers: 5, length: 54, depth: 2.4, rise: 1.1, setback: 6 },
                { side: 'east', tiers: 5, length: 54, depth: 2.4, rise: 1.1, setback: 6 }
            ]
        },
        gameplay: {
            mechanics: ['fall-death', 'vertical-drop', 'parkour-route', 'jump-pads'],
            fallDeathY: -14,
            respawnOnFall: true,
            jumpPadImpulse: 18,
            verticalRouteHeight: 30,
            playerSpawnZ: 29
        },
        sky: { horizonColor: 0xd8bd91, sun: true, sunColor: 0xffd79a, cloudAmount: 0.25 }
    },
    grand_stadium: {
        name: 'Grand Stadium',
        courtWidth: 96, courtLength: 118, wallHeight: 24, ceilingHeight: 42,
        floorRed: 0xc83f45, floorBlue: 0x3569c8, wallColor: 0xd7dce2,
        skyTop: 0x398bea, skyBottom: 0xd9f1ff, fogColor: 0xc8e4f2,
        hasOcean: false, hasGlass: false, isStadium: true, size: 'large',
        weather: 'clear', openSides: true,
        spectator: {
            bounds: { minX: -78, maxX: 78, minY: 0, maxY: 36, minZ: -88, maxZ: 88 },
            stands: [
                { side: 'north', tiers: 6, length: 104, depth: 2.8, rise: 1.05, setback: 5 },
                { side: 'south', tiers: 6, length: 104, depth: 2.8, rise: 1.05, setback: 5 },
                { side: 'west', tiers: 6, length: 92, depth: 2.8, rise: 1.05, setback: 5 },
                { side: 'east', tiers: 6, length: 92, depth: 2.8, rise: 1.05, setback: 5 }
            ]
        },
        gameplay: {
            mechanics: ['stadium-bounds', 'symmetric-spawns', 'spectator-sightlines'],
            fallDeathY: -10,
            playerSpawnZ: 39,
            symmetric: true
        },
        sky: { horizonColor: 0xf0d8b8, sun: true, sunColor: 0xfff0c0, cloudAmount: 0.35 }
    },
    mega_pinball: {
        name: 'Mega Pinball Complex',
        courtWidth: 960, courtLength: 1180, wallHeight: 80, ceilingHeight: 120,
        floorRed: 0x173a45, floorBlue: 0x16485a, wallColor: 0x70ddff,
        skyTop: 0x071526, skyBottom: 0x16485a, fogColor: 0x0b2432,
        hasOcean: false, hasGlass: true, isPinball: true, size: 'mega',
        weather: 'clear', openSides: false,
        gameplay: { mechanics: ['pinball-bounce', 'breakable-glass-chain', 'mega-arena'], fallDeathY: -20 },
        sky: { horizonColor: 0x16485a, sun: false, cloudAmount: 0 }
    },
    temple_sym: {
        name: '🏛️ Temple',
        courtWidth: 62, courtLength: 39, wallHeight: 17, ceilingHeight: 24,
        floorRed: 0xc9a878, floorBlue: 0xa89060, wallColor: 0xe8d8b0,
        skyTop: 0x6aa5ff, skyBottom: 0xffe8c8, fogColor: 0xffd8a8,
        hasOcean: false, hasGlass: false, isTemple: true, size: 'medium', weather: 'clear'
    }
};

function ensureMapMetadata(config) {
    const halfW = config.courtWidth / 2;
    const halfL = config.courtLength / 2;
    const maxY = config.ceilingHeight > 0 ? config.ceilingHeight : Math.max(config.wallHeight, 24);
    config.spectator ||= {
        bounds: {
            minX: -halfW - 12, maxX: halfW + 12,
            minY: 0, maxY: maxY + 10,
            minZ: -halfL - 12, maxZ: halfL + 12
        },
        stands: []
    };
    if (!config.spectator.stands?.length) {
        config.spectator.stands = [
            { side: 'north', tiers: 3, depth: 1.4, rise: 0.65, setback: 3, length: Math.max(10, config.courtWidth * 0.28) },
            { side: 'south', tiers: 3, depth: 1.4, rise: 0.65, setback: 3, length: Math.max(10, config.courtWidth * 0.28) }
        ];
    }
    config.gameplay ||= { mechanics: [], fallDeathY: -12 };
    config.gameplay.mechanics ||= [];
    if (!Number.isFinite(config.gameplay.fallDeathY)) config.gameplay.fallDeathY = -12;
    config.sky ||= {
        horizonColor: config.skyBottom,
        sun: false,
        sunColor: 0xfff2c0,
        cloudAmount: 0
    };
    return config;
}

Object.values(MAPS).forEach(ensureMapMetadata);

export function getArenaBounds(config, margin = 0) {
    const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 0;
    const halfW = Math.max(0, Number(config?.courtWidth) || 0) / 2;
    const halfL = Math.max(0, Number(config?.courtLength) || 0) / 2;
    const maxY = Number(config?.ceilingHeight) > 0
        ? Number(config.ceilingHeight)
        : Math.max(Number(config?.wallHeight) || 0, 24);
    return {
        minX: -halfW - safeMargin,
        maxX: halfW + safeMargin,
        minY: 0,
        maxY,
        minZ: -halfL - safeMargin,
        maxZ: halfL + safeMargin
    };
}

export function getSpectatorBounds(config) {
    const explicit = config?.spectator?.bounds;
    return explicit ? { ...explicit } : getArenaBounds(config, 12);
}

export function isOutsideArenaBounds(position, bounds) {
    if (!position || !bounds) return true;
    return position.x < bounds.minX || position.x > bounds.maxX
        || position.z < bounds.minZ || position.z > bounds.maxZ
        || (Number.isFinite(bounds.minY) && position.y < bounds.minY)
        || (Number.isFinite(bounds.maxY) && position.y > bounds.maxY);
}

export function isFallDeathPosition(position, config) {
    const fallDeathY = Number(config?.gameplay?.fallDeathY);
    return Number.isFinite(position?.y) && Number.isFinite(fallDeathY) && position.y < fallDeathY;
}

const colorNumber = value => Number.parseInt(String(value).replace('#', ''), 16);

export function registerCustomMap(id, custom) {
    if (!/^custom-[a-z0-9_-]{1,40}$/i.test(id) || !custom?.dimensions || !custom?.colors) return false;
    MAPS[id] = ensureMapMetadata({
        name: custom.name,
        courtWidth: custom.dimensions.width,
        courtLength: custom.dimensions.length,
        wallHeight: custom.dimensions.wallHeight,
        ceilingHeight: custom.flags?.openAir ? 0 : custom.dimensions.ceilingHeight,
        floorRed: colorNumber(custom.colors.floorRed),
        floorBlue: colorNumber(custom.colors.floorBlue),
        wallColor: colorNumber(custom.colors.wall),
        skyTop: colorNumber(custom.colors.sky),
        skyBottom: colorNumber(custom.colors.sky),
        fogColor: colorNumber(custom.colors.fog),
        weather: custom.weather,
        openSides: custom.flags?.openSides,
        openAir: custom.flags?.openAir,
        isIce: custom.flags?.slippery,
        slippery: custom.flags?.slippery,
        lowGravity: custom.flags?.lowGravity,
        hasPortals: custom.flags?.portals,
        customProps: custom.props,
        size: 'custom'
    });
    return true;
}

// ponytail: per-map UI theme — CSS custom property overrides keyed by mapId.
// Applied via _applyTheme() so the HUD matches the active arena's palette.
export const MAP_THEMES = {
    beach:        { '--ui-primary': '#e8a050', '--ui-secondary': '#7fd0e8', '--ui-bg': '#1a2a3e', '--ui-accent': '#ffb066' },
    beach_open:   { '--ui-primary': '#e8a050', '--ui-secondary': '#d0a860', '--ui-bg': '#2e2418', '--ui-accent': '#ffcc66' },
    industrial:   { '--ui-primary': '#d85c5c', '--ui-secondary': '#5c7fe0', '--ui-bg': '#1a1f2e', '--ui-accent': '#ff8844' },
    space:        { '--ui-primary': '#d04080', '--ui-secondary': '#4080d0', '--ui-bg': '#0a0a1e', '--ui-accent': '#ff66aa' },
    neon:         { '--ui-primary': '#ff3d81', '--ui-secondary': '#2de2e6', '--ui-bg': '#1a0e2e', '--ui-accent': '#ff44cc' },
    dojo:         { '--ui-primary': '#cc9933', '--ui-secondary': '#996633', '--ui-bg': '#1a1410', '--ui-accent': '#ffaa44' },
    garden:       { '--ui-primary': '#44aa66', '--ui-secondary': '#88cc44', '--ui-bg': '#0e1a14', '--ui-accent': '#66ff99' },
    sunset:       { '--ui-primary': '#ff7744', '--ui-secondary': '#ffaa44', '--ui-bg': '#2e1810', '--ui-accent': '#ffaa66' },
    frost:        { '--ui-primary': '#44aaff', '--ui-secondary': '#88ddff', '--ui-bg': '#0a1a2e', '--ui-accent': '#aaddff' },
    lava:         { '--ui-primary': '#ff5533', '--ui-secondary': '#ffaa44', '--ui-bg': '#2e0a0a', '--ui-accent': '#ff8833' },
    tournament:   { '--ui-primary': '#ffcc44', '--ui-secondary': '#ff8844', '--ui-bg': '#1a1a0a', '--ui-accent': '#ffaa44' },
    rooftop:      { '--ui-primary': '#5577aa', '--ui-secondary': '#8899bb', '--ui-bg': '#101418', '--ui-accent': '#aabbdd' },
    temple:       { '--ui-primary': '#c9a878', '--ui-secondary': '#a89060', '--ui-bg': '#1e1a14', '--ui-accent': '#ffd8a8' },
    classic:      { '--ui-primary': '#457bca', '--ui-secondary': '#6fa8dc', '--ui-bg': '#0f0f23', '--ui-accent': '#ff8800' }
};

export class Arena {
    // ponytail: statik MAPS — game.js pickRandomMap() için.
    static MAPS = MAPS;

    constructor(renderer, mapId = 'beach', options = {}) {
        this.renderer = renderer;
        this.scene = renderer.scene;
        this.mapId = MAPS[mapId] ? mapId : 'beach';
        this.config = MAPS[this.mapId];
        this.portalsEnabled = options.portalsEnabled !== false;

        this.courtWidth = this.config.courtWidth;
        this.courtLength = this.config.courtLength;
        this.wallHeight = this.config.wallHeight;
        this.ceilingHeight = this.config.ceilingHeight;
        // ponytail: spawn lower so ball doesn't get stuck on ceiling (neon map)
        this.spawnPoint = new THREE.Vector3(0, this._ballSpawnHeight(), 0);
        this.bounds = getArenaBounds(this.config);
        this.spectatorBounds = getSpectatorBounds(this.config);
        this.objects = [];
        this.collidables = [];  // ball collision objects: {mesh, radius, pos}
        this.hazardZones = [];
        this.portals = [];
        this.portalTimer = 0;
        this.portalSwapInterval = 30;
        this.portalSwapTimer = this.portalSwapInterval;
        this.build();
        // ponytail: apply initial map theme
        this._applyTheme(this.mapId);
    }

    _ballSpawnHeight() {
        const configured = Number(this.config?.gameplay?.ballSpawnHeight);
        if (Number.isFinite(configured)) return configured;
        return this.ceilingHeight > 2 ? Math.min(this.ceilingHeight - 1, 12) : 12;
    }

    // Track every object we add so we can tear down cleanly on map switch,
    // without nuking lights/camera the way clearing the whole scene would.
    add(obj) {
        this.scene.add(obj);
        this.objects.push(obj);
        return obj;
    }

    // Register a prop as collidable for the ball. pos = position, radius = collision sphere radius
    addCollidable(mesh, pos, radius) {
        this.collidables.push({ mesh, pos: pos.clone(), radius });
    }

    _buildHazardZones() {
        const width = this.courtWidth || this.config.size?.x || 100;
        const length = this.courtLength || this.config.size?.z || 100;
        const zones = [];
        if (this.config.isLava || this.config.isVolcano) {
            const radius = Math.min(5, width * 0.08);
            [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]].forEach(([x, z]) => {
                zones.push({ kind: 'lava', x: width * x, z: length * z, radius, damage: 18 });
            });
        }
        if (this.config.isJungle) {
            const radius = Math.min(6, width * 0.1);
            [[-0.32, 0], [0.32, 0]].forEach(([x, z]) => {
                zones.push({ kind: 'mud', x: width * x, z: length * z, radius, slow: 0.55 });
            });
        }
        if (this.config.isVerticalDrop) {
            [[-0.25, 0], [0.25, 0]].forEach(([x, z]) => {
                zones.push({ kind: 'void', x: width * x, z: length * z, radius: 6.5 });
            });
        }
        this.hazardZones = zones;
    }

    getHazardAt(pos) {
        return this.hazardZones.find(zone => {
            const dx = pos.x - zone.x;
            const dz = pos.z - zone.z;
            return dx * dx + dz * dz <= zone.radius * zone.radius;
        }) || null;
    }

    build() {
        this.platforms = [];
        this._buildHazardZones();
        if (this.config.isMinecraft) {
            this.buildMinecraft();
            this.buildNet();
            this.buildSkybox();
            this.buildPortals();
            this.buildSpectatorStands();
            this.buildChicken();
            if (!this.bounds.maxY) this.bounds.maxY = this.ceilingHeight || 30;
            if (this.config.weather && this.config.weather !== 'clear' && this.config.weather !== 'indoor') {
                this.weather = new WeatherSystem(this.scene, this.bounds);
                this.weather.setWeather(this.config.weather);
            }
            this.addAmbientParticles('dust');
            return;
        }
        this.buildFloor();
        this.buildBoundaryGuides();
        this.buildWalls();
        this.buildNet();
        if (!this.config.openAir) this.buildCeiling();
        this.buildSkybox();
        this.buildProps();
        this.buildCustomProps();
        this.buildLights();
        if (this.config.hasOcean) this.buildOcean();
        if (this.config.isCloud) this.buildStars();
        if (this.config.isSpace) this.buildSpaceMap();
        if (this.config.isNeon) this.buildNeon();
        if (this.config.isDojo) this.buildDojoProps();
        if (this.config.isColosseum) this.buildColosseumProps();
        if (this.config.isVolcano) this.buildVolcanoProps();
        if (this.config.isIce) this.buildIceProps();
        if (this.config.isJungle) this.buildJungleProps();
        if (this.config.isCyber) this.buildCyberProps();
        if (this.config.isCloud) this.buildCloudProps();
        if (this.config.isBeachOpen) this.buildBeachOpenProps();
        if (this.config.isCanyon) this.buildCanyonProps();
        if (this.config.isPillar) this.buildPillarProps();
        if (this.config.isLava) this.buildLavaProps();
        if (this.config.isCrystal) this.buildCrystalProps();
        if (this.config.isMecha) this.buildMechaProps();
        if (this.config.isAtlantis) this.buildAtlantisProps();
        if (this.config.isTemple) this.buildTempleProps();
        if (this.config.isVerticalDrop) this.buildVerticalDropProps();
        if (this.config.isStadium) this.buildStadiumProps();
        if (this.config.isPinball) this.buildPinballComplex();
        this.buildSpectatorStands();
        this.buildChicken();
        this.buildHazardVisuals();
        // Generic open-world env for open-sided maps without specific theming
        if (this.config.openSides && !this.config.isCloud && !this.config.isSpace &&
            !this.config.isNeon && !this.config.isVolcano && !this.config.isIce &&
            !this.config.isBeachOpen && !this.config.isMinecraft && !this.config.isJungle &&
            !this.config.isAtlantis && !this.config.isVerticalDrop && !this.config.isStadium) {
            this.buildOpenEnv();
        }
        this.buildPortals();
        this._buildDecorations();
        // Weather — init after scene is built if config has non-clear weather
        if (this.config.weather && this.config.weather !== 'clear' && this.config.weather !== 'indoor') {
            this.weather = new WeatherSystem(this.scene, this.bounds);
            this.weather.setWeather(this.config.weather);
        }
        // Default bounds.y for weather system
        if (!this.bounds.maxY) this.bounds.maxY = this.ceilingHeight || 30;
        // Ambient particles based on map theme
        const particleType = (this.config.isVolcano || this.config.isLava) ? 'ember'
            : (this.config.isIce || this.config.isCrystal) ? 'crystal'
            : (this.config.isJungle || this.config.isBeachOpen) ? 'leaf'
            : (this.config.weather === 'snow') ? 'snow'
            : (this.config.weather === 'rain') ? 'rain'
            : (this.config.isSpace || this.config.isNeon) ? 'spark'
            : 'dust';
        this.addAmbientParticles(particleType);
    }

    buildChicken() {
        const group = new THREE.Group();
        const white = this.renderer.createToonMaterial(0xf7f1d0);
        const red = this.renderer.createToonMaterial(0xe84b4b);
        const yellow = this.renderer.createToonMaterial(0xf6b83f);
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), white);
        body.scale.set(1, 1.15, 0.85);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), white);
        head.position.set(0, 0.55, -0.18);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 4), yellow);
        beak.rotation.x = -Math.PI / 2;
        beak.position.set(0, 0.55, -0.48);
        const comb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), red);
        comb.position.set(0, 0.86, -0.16);
        group.add(body, head, beak, comb);
        group.position.set(this.courtWidth * 0.28, 0.48, this.courtLength * 0.18);
        group.userData.phase = Math.random() * Math.PI * 2;
        this.chicken = group;
        this.add(group);
    }

    buildPinballComplex() {
        this.pinballTargets = [];
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x70ddff, emissive: 0x123f52, emissiveIntensity: 0.55,
            transparent: true, opacity: 0.68, roughness: 0.12, metalness: 0.15
        });
        for (let i = 0; i < 12; i++) {
            const side = i % 2 ? 1 : -1;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(22, 18, 1.2), material.clone());
            mesh.position.set(side * (120 + (i % 3) * 90), 12 + (i % 4) * 13, -420 + i * 76);
            mesh.rotation.y = side * (0.3 + (i % 3) * 0.12);
            mesh.userData.pinballTarget = i + 1;
            this.add(mesh);
            const target = { mesh, pos: mesh.position.clone(), radius: 13, breakable: true, broken: false };
            this.collidables.push(target);
            this.pinballTargets.push(target);
        }
    }

    hitChicken(ballPosition, radius = 1) {
        if (!this.chicken?.visible || !ballPosition) return false;
        if (this.chicken.position.distanceTo(ballPosition) > radius + 0.55) return false;
        this.chicken.visible = false;
        return true;
    }

    buildCustomProps() {
        for (const prop of this.config.customProps || []) {
            const size = prop.size;
            let geometry;
            let radius;
            if (prop.type === 'sphere') {
                geometry = new THREE.SphereGeometry(size.radius, 16, 12);
                radius = size.radius;
            } else if (prop.type === 'cylinder') {
                geometry = new THREE.CylinderGeometry(size.radius, size.radius, size.height, 16);
                radius = Math.max(size.radius, size.height / 2);
            } else if (prop.type === 'cone') {
                geometry = new THREE.ConeGeometry(size.radius, size.height, 16);
                radius = Math.max(size.radius, size.height / 2);
            } else {
                geometry = new THREE.BoxGeometry(size.width, size.height, size.depth);
                radius = Math.hypot(size.width, size.height, size.depth) / 2;
            }
            const mesh = new THREE.Mesh(geometry, this.renderer.createToonMaterial(colorNumber(prop.color)));
            mesh.position.set(prop.position.x, prop.position.y, prop.position.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.add(mesh);
            this.addCollidable(mesh, mesh.position, radius);
        }
    }
    buildHazardVisuals() {
        for (const zone of this.hazardZones) {
            const color = zone.kind === 'lava' ? 0xff3b12 : zone.kind === 'void' ? 0x111827 : 0x2e8b57;
            const geo = new THREE.CircleGeometry(zone.radius, 24);
            geo.rotateX(-Math.PI / 2);
            const mat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: zone.kind === 'lava' ? 0.72 : zone.kind === 'void' ? 0.94 : 0.38,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(zone.x, 0.025, zone.z);
            this.add(mesh);
            zone.mesh = mesh;
        }
    }

    buildBoundaryGuides() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const railHeight = 0.45;
        const railMat = new THREE.MeshStandardMaterial({
            color: this.config.wallColor,
            emissive: this.config.wallColor,
            emissiveIntensity: 0.12,
            roughness: 0.6
        });
        const sideGeo = new THREE.BoxGeometry(0.35, railHeight, this.courtLength);
        const endGeo = new THREE.BoxGeometry(this.courtWidth, railHeight, 0.35);
        [-halfW, halfW].forEach(x => {
            const rail = new THREE.Mesh(sideGeo, railMat);
            rail.position.set(x, railHeight / 2, 0);
            this.add(rail);
        });
        [-halfL, halfL].forEach(z => {
            const rail = new THREE.Mesh(endGeo, railMat);
            rail.position.set(0, railHeight / 2, z);
            this.add(rail);
        });
    }

    // Portal mekaniği — 2 döner halka + iç parçacıklar + ışık sütunu.
    // Top bir portala girince diğerinden çıkar.
    // Sadece sci-fi/fantezi haritalarda (hasPortals: true).
    buildPortals() {
        if (!this.config.hasPortals || !this.portalsEnabled || this.portals?.length) return;
        this.portals = [];
        const colors = [0x44ddff, 0xff8844];
        const glowColors = [0x2288ff, 0xff5500];
        const halfW = this.courtWidth / 2 - 4;
        const halfL = this.courtLength / 2 - 4;
        for (let i = 0; i < 2; i++) {
            const px = (i === 0 ? -1 : 1) * halfW * 0.6;
            const pz = (i === 0 ? -1 : 1) * halfL * 0.32;
            const py = 3;

            // Outer ring — torus, rotates
            const ringGeo = new THREE.TorusGeometry(1.6, 0.12, 8, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: colors[i], transparent: true, opacity: 0.8
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(px, py, pz);
            ring.rotation.x = Math.PI / 2; // flat ring
            this.add(ring);

            // Inner glow — bright cylinder core
            const coreGeo = new THREE.CylinderGeometry(1.2, 1.2, 3, 16);
            const coreMat = new THREE.MeshBasicMaterial({
                color: colors[i], transparent: true, opacity: 0.15,
                side: THREE.DoubleSide
            });
            const core = new THREE.Mesh(coreGeo, coreMat);
            core.position.set(px, py, pz);
            this.add(core);

            // Bright center light
            const lightGeo = new THREE.SphereGeometry(0.3, 8, 8);
            const lightMat = new THREE.MeshBasicMaterial({
                color: glowColors[i], transparent: true, opacity: 0.9
            });
            const light = new THREE.Mesh(lightGeo, lightMat);
            light.position.set(px, py, pz);
            this.add(light);

            // Portal particle sparkles — small points around the ring
            const particleCount = 16;
            const pPos = [];
            for (let j = 0; j < particleCount; j++) {
                const angle = (j / particleCount) * Math.PI * 2;
                const rr = 1.4 + Math.random() * 0.4;
                pPos.push(px + Math.cos(angle) * rr, py + (Math.random() - 0.5) * 0.8, pz + Math.sin(angle) * rr);
            }
            const pGeo = new THREE.BufferGeometry();
            pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
            const pMat = new THREE.PointsMaterial({
                color: glowColors[i], size: 0.12, transparent: true, opacity: 0.8
            });
            const particles = new THREE.Points(pGeo, pMat);
            this.add(particles);

            this.portals.push({
                mesh: ring, core, light, particles, pGeo, pMat,
                color: colors[i], glowColor: glowColors[i],
                pos: new THREE.Vector3(px, py, pz),
                cooldown: 0
            });
        }
        this.portalTimer = 0;
    }

    setPortalsEnabled(enabled) {
        this.portalsEnabled = !!enabled;
        if (this.portals?.length) {
            this.portals.forEach(portal => {
                portal.mesh.visible = this.portalsEnabled;
                portal.core.visible = this.portalsEnabled;
                portal.light.visible = this.portalsEnabled;
                portal.particles.visible = this.portalsEnabled;
            });
        } else if (this.portalsEnabled) {
            this.buildPortals();
        }
    }

    buildDojoProps() {
        // Ahşap fenerler köşelerde
        const lanternGeo = new THREE.BoxGeometry(0.6, 1.2, 0.6);
        const lanternMat = this.renderer.createToonMaterial(0xff8844);
        const halfW = this.courtWidth/2 - 2;
        const halfL = this.courtLength/2 - 2;
        [[-halfW,-halfL],[halfW,-halfL],[-halfW,halfL],[halfW,halfL]].forEach(([x,z]) => {
            const l = new THREE.Mesh(lanternGeo, lanternMat);
            l.position.set(x, 1.5, z);
            this.add(l);
            // Glow
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.8, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.3 })
            );
            glow.position.set(x, 1.5, z);
            this.add(glow);
        });
    }

    buildColosseumProps() {
        // Antik sütunlar etrafta + collision
        const colGeo = new THREE.CylinderGeometry(0.8, 0.9, 10, 12);
        const colMat = this.renderer.createToonMaterial(0xf0e0c0);
        const halfW = this.courtWidth/2 + 2;
        for (let i = 0; i < 12; i++) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = (i / 11 - 0.5) * this.courtLength;
            [-1, 1].forEach(s => {
                const c = new THREE.Mesh(colGeo, colMat);
                c.position.set(s * halfW, 5, z);
                c.castShadow = true;
                this.add(c);
                this.addCollidable(c, new THREE.Vector3(s * halfW, 5, z), 0.9);
            });
        }
    }

    buildVolcanoProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        // Lav parçacıkları zeminde
        for (let i = 0; i < 30; i++) {
            const geo = new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 6, 6);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() > 0.5 ? 0xff4400 : 0xffaa00,
                transparent: true, opacity: 0.85
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.set(
                (Math.random() - 0.5) * this.courtWidth,
                Math.random() * 2,
                (Math.random() - 0.5) * this.courtLength
            );
            this.add(p);
        }
        // Volkanik kaya köşelerde
        const rockGeo = new THREE.DodecahedronGeometry(2, 0);
        const rockMat = this.renderer.createToonMaterial(0x3a1a1a);
        const hW = this.courtWidth/2 - 1;
        const hL = this.courtLength/2 - 1;
        [[-hW,-hL,0.8],[hW,-hL,1.2],[-hW,hL,1],[hW,hL,0.9]].forEach(([x,z,s]) => {
            const r = new THREE.Mesh(rockGeo, rockMat);
            r.position.set(x, 1.5, z);
            r.scale.setScalar(s);
            this.add(r);
        });
        // Exterior lava glow — particles outside court edges
        for (let i = 0; i < 20; i++) {
            const s = 0.3 + Math.random() * 0.6;
            const geo = new THREE.SphereGeometry(s, 6, 6);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() > 0.4 ? 0xff4400 : 0xff8800,
                transparent: true, opacity: 0.5 + Math.random() * 0.3
            });
            const p = new THREE.Mesh(geo, mat);
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.max(halfW, halfL) + 4 + Math.random() * 20;
            p.position.set(
                Math.cos(angle) * dist,
                1 + Math.random() * 8,
                Math.sin(angle) * dist
            );
            this.add(p);
        }
        // Lava fountain columns outside court
        const lavaMat = new THREE.MeshBasicMaterial({
            color: 0xff4400, transparent: true, opacity: 0.15
        });
        for (let i = 0; i < 6; i++) {
            const col = new THREE.Mesh(
                new THREE.CylinderGeometry(0.5 + Math.random() * 0.5, 1.5, 6 + Math.random() * 10, 6),
                lavaMat
            );
            const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
            const dist = Math.max(halfW, halfL) + 6 + Math.random() * 12;
            col.position.set(
                Math.cos(angle) * dist,
                (6 + Math.random() * 10) / 2,
                Math.sin(angle) * dist
            );
            this.add(col);
        }
    }

    buildIceProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        // Buz sarkıtları tavana (varsa)
        if (this.ceilingHeight > 0) {
            for (let i = 0; i < 12; i++) {
                const h = 1 + Math.random() * 2;
                const geo = new THREE.ConeGeometry(0.3, h, 6);
                const mat = this.renderer.createToonMaterial(0xc8e8ff);
                const icicle = new THREE.Mesh(geo, mat);
                icicle.position.set(
                    (Math.random() - 0.5) * this.courtWidth * 0.8,
                    this.ceilingHeight - h/2,
                    (Math.random() - 0.5) * this.courtLength * 0.8
                );
                this.add(icicle);
            }
        }
        // Buz parçacıkları yerde
        for (let i = 0; i < 20; i++) {
            const geo = new THREE.OctahedronGeometry(0.3);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xe0f4ff, transparent: true, opacity: 0.7
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.set(
                (Math.random() - 0.5) * this.courtWidth,
                0.2,
                (Math.random() - 0.5) * this.courtLength
            );
            this.add(p);
        }
        // Exterior ice crystal formations (pointed, transparent blue)
        const crystalMat = new THREE.MeshBasicMaterial({
            color: 0xaaddff, transparent: true, opacity: 0.35
        });
        const crystalMatBright = new THREE.MeshBasicMaterial({
            color: 0x88ddff, transparent: true, opacity: 0.5
        });
        for (let i = 0; i < 16; i++) {
            const h = 3 + Math.random() * 8;
            const rad = 0.4 + Math.random() * 0.8;
            const geo = new THREE.ConeGeometry(rad, h, 5 + Math.floor(Math.random() * 3));
            const mat = i % 2 === 0 ? crystalMat : crystalMatBright;
            const crystal = new THREE.Mesh(geo, mat);
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.max(halfW, halfL) + 4 + Math.random() * 18;
            crystal.position.set(
                Math.cos(angle) * dist,
                h / 2,
                Math.sin(angle) * dist
            );
            // Slight lean
            crystal.rotation.z = (Math.random() - 0.5) * 0.15;
            crystal.rotation.x = (Math.random() - 0.5) * 0.15;
            this.add(crystal);
        }
    }

    buildJungleProps() {
        // Ağaçlar etrafta + collision
        const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 12, 8);
        const trunkMat = this.renderer.createToonMaterial(0x6a4a2a);
        const leafGeo = new THREE.SphereGeometry(3, 8, 8);
        const leafMat = this.renderer.createToonMaterial(0x3a8a3a);
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const r = Math.max(this.courtWidth, this.courtLength) / 2 + 4;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const trunk = new THREE.Mesh(trunkGeo, trunkMat);
            trunk.position.set(x, 6, z);
            trunk.castShadow = true;
            this.add(trunk);
            this.addCollidable(trunk, new THREE.Vector3(x, 6, z), 0.7);
            const leaves = new THREE.Mesh(leafGeo, leafMat);
            leaves.position.set(x, 12, z);
            this.add(leaves);
        }
    }

    buildCyberProps() {
        // Hologram gridler etrafta
        for (let i = 0; i < 8; i++) {
            const geo = new THREE.PlaneGeometry(4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x22ddff, transparent: true, opacity: 0.25,
                wireframe: true, side: THREE.DoubleSide
            });
            const holo = new THREE.Mesh(geo, mat);
            const side = i % 2 === 0 ? -1 : 1;
            holo.position.set(side * (this.courtWidth/2 + 3), 4 + (i % 3) * 3, (i / 7 - 0.5) * this.courtLength);
            holo.rotation.y = Math.PI / 2;
            this.add(holo);
        }
    }

    buildCloudProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;

        // 1. Cloud floor — overlapping sphere clusters at y=0 for puffy cloud tops
        const floorCloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.85
        });
        const floorCloudMatLight = new THREE.MeshBasicMaterial({
            color: 0xddeeff, transparent: true, opacity: 0.6
        });
        for (let i = 0; i < 70; i++) {
            const r = 2 + Math.random() * 3;
            const geo = new THREE.SphereGeometry(r, 7, 7);
            const mat = i % 3 === 0 ? floorCloudMatLight : floorCloudMat;
            const c = new THREE.Mesh(geo, mat);
            c.position.set(
                (Math.random() - 0.5) * (this.courtWidth + 10),
                Math.random() * 0.4,
                (Math.random() - 0.5) * (this.courtLength + 10)
            );
            c.scale.y = 0.35 + Math.random() * 0.25;  // flatten for cloud top look
            this.add(c);
        }

        // 2. Subtle white/blue glow underneath the floor
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xaaccff, transparent: true, opacity: 0.12,
            side: THREE.DoubleSide
        });
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth + 30, this.courtLength + 30),
            glowMat
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -0.5;
        this.add(glow);

        // 3. Large cloud formations outside court bounds
        const bigCloudMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.45
        });
        const positions = [
            [-halfW - 14, -halfL - 10], [halfW + 14, -halfL - 10],
            [-halfW - 14, halfL + 10], [halfW + 14, halfL + 10]
        ];
        positions.forEach(([cx, cz]) => {
            for (let j = 0; j < 6; j++) {
                const r = 3 + Math.random() * 6;
                const geo = new THREE.SphereGeometry(r, 7, 7);
                const c = new THREE.Mesh(geo, bigCloudMat);
                c.position.set(
                    cx + (Math.random() - 0.5) * 14,
                    6 + Math.random() * 12,
                    cz + (Math.random() - 0.5) * 14
                );
                this.add(c);
            }
        });

        // 4. Distant floating clouds at various heights
        for (let i = 0; i < 24; i++) {
            const r = 1.5 + Math.random() * 4;
            const geo = new THREE.SphereGeometry(r, 6, 6);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.2 + Math.random() * 0.2
            });
            const c = new THREE.Mesh(geo, mat);
            const angle = Math.random() * Math.PI * 2;
            const dist = 25 + Math.random() * 70;
            c.position.set(
                Math.cos(angle) * dist,
                10 + Math.random() * 40,
                Math.sin(angle) * dist
            );
            c.scale.set(1, 0.6 + Math.random() * 0.3, 1);
            this.add(c);
        }
    }

    buildSpaceMap() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;

        // 1. Starfield — 2000 particles in a spherical shell (radius 80-150)
        const starPos = [];
        for (let i = 0; i < 2000; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 80 + Math.random() * 70;
            starPos.push(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.cos(phi),
                r * Math.sin(phi) * Math.sin(theta)
            );
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xffffff, size: 0.35, transparent: true, opacity: 0.9,
            sizeAttenuation: true
        });
        this._spaceStars = new THREE.Points(starGeo, starMat);
        this.add(this._spaceStars);

        // 2. Planets outside the court
        // Mars-like (reddish/orange)
        const mars = new THREE.Mesh(
            new THREE.SphereGeometry(8, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xcc6633 })
        );
        mars.position.set(halfW + 58, 8, halfL + 18);
        this.add(mars);

        // Earth-like (blue/green)
        const earth = new THREE.Mesh(
            new THREE.SphereGeometry(10, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x4488cc })
        );
        earth.position.set(-(halfW + 52), -4, -(halfL + 32));
        this.add(earth);

        // Saturn (yellow/tan with ring)
        const saturn = new THREE.Mesh(
            new THREE.SphereGeometry(7, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xddcc88 })
        );
        saturn.position.set(halfW + 42, 16, -(halfL + 48));
        this.add(saturn);

        const ringGeo = new THREE.RingGeometry(10, 15, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xccbb88, side: THREE.DoubleSide, transparent: true, opacity: 0.6
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(saturn.position);
        ring.rotation.x = Math.PI / 3;
        ring.rotation.z = 0.15;
        this.add(ring);

        // 3. Sci-fi grid overlay on the floor
        const gridMat = new THREE.MeshBasicMaterial({
            color: 0x66aaff, transparent: true, opacity: 0.12, wireframe: true
        });
        const grid = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth - 2, this.courtLength - 2, 14, 12),
            gridMat
        );
        grid.rotation.x = -Math.PI / 2;
        grid.position.y = 0.02;
        this.add(grid);

        // Additional panel subdivision lines (thinner grid inside)
        const panelMat = new THREE.MeshBasicMaterial({
            color: 0x88ccff, transparent: true, opacity: 0.06, wireframe: true
        });
        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth - 4, this.courtLength - 4, 4, 3),
            panelMat
        );
        panel.rotation.x = -Math.PI / 2;
        panel.position.y = 0.025;
        this.add(panel);

        // 4. Nebula effect — large transparent colored spheres
        const nebulaColors = [0x8844aa, 0x4488cc, 0xaa4488];
        for (let i = 0; i < 3; i++) {
            const geo = new THREE.SphereGeometry(18 + Math.random() * 12, 10, 10);
            const mat = new THREE.MeshBasicMaterial({
                color: nebulaColors[i], transparent: true, opacity: 0.05, side: THREE.DoubleSide
            });
            const neb = new THREE.Mesh(geo, mat);
            const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.4;
            neb.position.set(
                Math.cos(angle) * 75,
                (Math.random() - 0.5) * 35,
                Math.sin(angle) * 75
            );
            neb.scale.set(1, 0.5 + Math.random() * 0.3, 1);
            this.add(neb);
        }

        // 5. Asteroids — dodecahedrons with random scale
        for (let i = 0; i < 8; i++) {
            const s = 0.8 + Math.random() * 2.5;
            const geo = new THREE.DodecahedronGeometry(s, 0);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x887766, transparent: true, opacity: 0.7
            });
            const ast = new THREE.Mesh(geo, mat);
            const angle = Math.random() * Math.PI * 2;
            const dist = 38 + Math.random() * 28;
            ast.position.set(
                Math.cos(angle) * dist,
                (Math.random() - 0.5) * 45,
                Math.sin(angle) * dist
            );
            ast.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
            this.add(ast);
        }
    }

    buildOpenEnv() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;

        // Distant tree silhouettes (cone + cylinder) at far Z positions
        const trunkMat = new THREE.MeshBasicMaterial({ color: 0x2a1a0a });
        const leafMat = new THREE.MeshBasicMaterial({
            color: 0x3a6a2a, transparent: true, opacity: 0.65
        });
        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 5; i++) {
                const z = side * (halfL + 14 + Math.random() * 22);
                const x = (Math.random() - 0.5) * this.courtWidth * 1.6;
                const h = 5 + Math.random() * 8;
                const trunk = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.15, 0.35, h, 5),
                    trunkMat
                );
                trunk.position.set(x, h / 2, z);
                this.add(trunk);
                const leafH = 3 + Math.random() * 4;
                const leaf = new THREE.Mesh(
                    new THREE.ConeGeometry(leafH * 0.55, leafH, 6),
                    leafMat
                );
                leaf.position.set(x, h + leafH / 2, z);
                this.add(leaf);
            }
        }

        // Low rolling hills outside court
        const hillMat = new THREE.MeshBasicMaterial({
            color: 0x4a7a3a, transparent: true, opacity: 0.35
        });
        for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.max(halfW, halfL) + 8 + Math.random() * 20;
            const hill = new THREE.Mesh(
                new THREE.SphereGeometry(4 + Math.random() * 6, 8, 8),
                hillMat
            );
            hill.position.set(
                Math.cos(angle) * dist,
                -1 + Math.random() * 2,
                Math.sin(angle) * dist
            );
            hill.scale.y = 0.25 + Math.random() * 0.2;
            this.add(hill);
        }
    }

    buildBeachOpenProps() {
        const ropeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
        const poleMat = this.renderer.createToonMaterial(0xddccaa);
        const halfW = this.courtWidth/2;
        const halfL = this.courtLength/2;
        [[-halfW,-halfL],[halfW,-halfL],[-halfW,halfL],[halfW,halfL]].forEach(([x,z]) => {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4, 6), poleMat);
            pole.position.set(x, 2, z);
            this.add(pole);
            this.addCollidable(pole, new THREE.Vector3(x, 2, z), 0.15);
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), poleMat);
            ball.position.set(x, 4, z);
            this.add(ball);
        });
        const sideRopeGeo = new THREE.CylinderGeometry(0.025, 0.025, this.courtLength, 5);
        const endRopeGeo = new THREE.CylinderGeometry(0.025, 0.025, this.courtWidth, 5);
        for (const y of [1.1, 2.7]) {
            [-halfW, halfW].forEach(x => {
                const rope = new THREE.Mesh(sideRopeGeo, ropeMat);
                rope.rotation.x = Math.PI / 2;
                rope.position.set(x, y, 0);
                this.add(rope);
            });
            [-halfL, halfL].forEach(z => {
                const rope = new THREE.Mesh(endRopeGeo, ropeMat);
                rope.rotation.z = Math.PI / 2;
                rope.position.set(0, y, z);
                this.add(rope);
            });
        }

        const lineMat = new THREE.MeshBasicMaterial({ color: 0xfff7dd, transparent: true, opacity: 0.9 });
        const innerW = Math.min(36, this.courtWidth - 8);
        const innerL = Math.min(54, this.courtLength - 8);
        [
            [innerW, 0.11, 0, -innerL / 2],
            [innerW, 0.11, 0, innerL / 2],
            [0.11, innerL, -innerW / 2, 0],
            [0.11, innerL, innerW / 2, 0]
        ].forEach(([w, l, x, z]) => {
            const line = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(x, 0.035, z);
            this.add(line);
        });

        const serviceMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.32, side: THREE.DoubleSide
        });
        [-innerL * 0.34, innerL * 0.34].forEach(z => {
            const marker = new THREE.Mesh(new THREE.RingGeometry(1.8, 2, 24), serviceMat);
            marker.rotation.x = -Math.PI / 2;
            marker.position.set(0, 0.04, z);
            this.add(marker);
        });

        for (let i = 0; i < 6; i++) {
            const a = (i/6)*Math.PI*2 + 0.3;
            const r = halfW + 5 + Math.random()*8;
            this.buildPalmTree(Math.cos(a)*r, Math.sin(a)*r);
        }
        const umbrellaColors = [0xff5555, 0xffcc33, 0x33bbff, 0xff77bb];
        [[-halfW-6,-halfL-4],[halfW+6,-halfL-4],[-halfW-6,halfL+4],[halfW+6,halfL+4]].forEach(([x,z],i) => {
            this.buildBeachUmbrella(x, z, umbrellaColors[i % umbrellaColors.length]);
        });
        for (let i = 0; i < 4; i++) {
            const bx = (Math.random()-0.5) * this.courtWidth * 0.7;
            const bz = (Math.random()>0.5?-1:1) * (halfL + 3 + Math.random()*4);
            const bmat = new THREE.MeshBasicMaterial({ color: umbrellaColors[i % umbrellaColors.length] });
            const bball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), bmat);
            bball.position.set(bx, 0.5, bz);
            this.add(bball);
        }

        const chairMat = this.renderer.createToonMaterial(0xf4f0df);
        [-1, 1].forEach(side => {
            const x = side * (halfW - 3);
            const stand = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 1.5), chairMat);
            stand.position.set(x, 1.6, 2.2);
            this.add(stand);
            const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 1.8), chairMat);
            seat.position.set(x, 3.3, 2.2);
            this.add(seat);
        });
    }

    // A glowing sun disc + halo for open-air beach/sky maps — disabled (visual artifact)
    buildSun(x, y, z) {
        // ponytail: sun creates white circle artifact near crosshair, removed
    }

    // Classic parasol: pole + colored canopy cone. Decorative (edge of court).
    buildBeachUmbrella(x, z, color) {
        const poleMat = this.renderer.createToonMaterial(0xeeeeee);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), poleMat);
        pole.position.set(x, 2.5, z);
        this.add(pole);
        const canopy = new THREE.Mesh(
            new THREE.ConeGeometry(3, 1.6, 12),
            new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
        );
        canopy.position.set(x, 5, z);
        this.add(canopy);
    }

    buildSpectatorStands() {
        const stands = this.config.spectator?.stands?.slice(0, 8) || [];
        if (!stands.length) return;
        const seatMat = this.renderer.createToonMaterial(this.config.isBeachOpen ? 0xc9a46a : 0x606a73);
        const railMat = new THREE.MeshBasicMaterial({ color: this.config.wallColor });
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;

        for (const stand of stands) {
            const tiers = Math.min(8, Math.max(1, Math.floor(stand.tiers || 1)));
            const depth = Math.max(1, stand.depth || 2);
            const rise = Math.max(0.35, stand.rise || 0.8);
            const setback = Math.max(2, stand.setback || 4);
            const northSouth = stand.side === 'north' || stand.side === 'south';
            const length = Math.max(8, stand.length || (northSouth ? this.courtWidth : this.courtLength) * 0.8);

            for (let tier = 0; tier < tiers; tier++) {
                const height = rise * (tier + 1);
                const geo = northSouth
                    ? new THREE.BoxGeometry(length, height, depth)
                    : new THREE.BoxGeometry(depth, height, length);
                const mesh = new THREE.Mesh(geo, seatMat);
                const offset = setback + depth * (tier + 0.5);
                const x = stand.side === 'west' ? -halfW - offset
                    : stand.side === 'east' ? halfW + offset : 0;
                const z = stand.side === 'north' ? -halfL - offset
                    : stand.side === 'south' ? halfL + offset : 0;
                mesh.position.set(x, height / 2, z);
                mesh.receiveShadow = true;
                this.add(mesh);
            }

            const railHeight = rise * tiers + 1;
            const rail = new THREE.Mesh(
                northSouth
                    ? new THREE.BoxGeometry(length, 0.18, 0.18)
                    : new THREE.BoxGeometry(0.18, 0.18, length),
                railMat
            );
            const edgeOffset = setback + depth * tiers;
            rail.position.set(
                stand.side === 'west' ? -halfW - edgeOffset : stand.side === 'east' ? halfW + edgeOffset : 0,
                railHeight,
                stand.side === 'north' ? -halfL - edgeOffset : stand.side === 'south' ? halfL + edgeOffset : 0
            );
            this.add(rail);
        }
    }

    buildVerticalDropProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const steelMat = this.renderer.createToonMaterial(0x4f5961);
        const accentMats = [
            new THREE.MeshBasicMaterial({ color: this.config.floorRed }),
            new THREE.MeshBasicMaterial({ color: this.config.floorBlue })
        ];
        const voidMat = new THREE.MeshBasicMaterial({ color: 0x111820, transparent: true, opacity: 0.9 });
        const voidRing = new THREE.Mesh(
            new THREE.RingGeometry(Math.max(halfW, halfL) + 3, Math.max(halfW, halfL) + 32, 48),
            voidMat
        );
        voidRing.rotation.x = -Math.PI / 2;
        voidRing.position.y = -0.5;
        this.add(voidRing);

        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        corners.forEach(([sx, sz], index) => {
            const x = sx * (halfW + 6);
            const z = sz * (halfL + 6);
            const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 32, 3), steelMat);
            tower.position.set(x, 16, z);
            this.add(tower);
            for (let level = 0; level < 3; level++) {
                const ledge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 5), accentMats[index % 2]);
                ledge.position.set(sx * (halfW - 5), 7 + level * 9, sz * (halfL - 8));
                this.add(ledge);
                this.platforms.push({
                    x: ledge.position.x,
                    z: ledge.position.z,
                    y: ledge.position.y + 0.3,
                    halfWidth: 4.5,
                    halfDepth: 2.5
                });
            }
        });

        this.jumpPads = [];
        [[-halfW * 0.32, -halfL * 0.18], [halfW * 0.32, halfL * 0.18]].forEach(([x, z], index) => {
            const pad = new THREE.Mesh(
                new THREE.CylinderGeometry(2.3, 2.7, 0.3, 16),
                accentMats[index]
            );
            pad.position.set(x, 0.15, z);
            this.add(pad);
            this.jumpPads.push({ position: pad.position.clone(), impulse: this.config.gameplay.jumpPadImpulse });
        });

        for (let level = 0; level < 3; level++) {
            const y = 8 + level * 9;
            [-1, 1].forEach(side => {
                const beam = new THREE.Mesh(new THREE.BoxGeometry(this.courtWidth * 0.65, 0.4, 1), steelMat);
                beam.position.set(0, y, side * (halfL - 10));
                this.add(beam);
                this.platforms.push({
                    x: beam.position.x,
                    z: beam.position.z,
                    y: beam.position.y + 0.2,
                    halfWidth: this.courtWidth * 0.325,
                    halfDepth: 0.5
                });
            });
        }
    }

    buildStadiumProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const frameMat = this.renderer.createToonMaterial(0xd8dde3);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x182536 });
        [-1, 1].forEach(side => {
            const board = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 0.8), screenMat);
            board.position.set(0, 13, side * (halfL + 8));
            this.add(board);
            const frame = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 1), frameMat);
            frame.position.set(0, 17, side * (halfL + 8));
            this.add(frame);
        });
        for (let i = 0; i < 8; i++) {
            const angle = i / 8 * Math.PI * 2;
            const x = Math.cos(angle) * (halfW + 16);
            const z = Math.sin(angle) * (halfL + 16);
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 22, 8), frameMat);
            mast.position.set(x, 11, z);
            this.add(mast);
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 1), new THREE.MeshBasicMaterial({ color: 0xfff4cc }));
            lamp.position.set(x, 22, z);
            lamp.lookAt(0, 3, 0);
            this.add(lamp);
        }
    }

    buildCanyonProps() {
        // Towering canyon walls with layered rock strata + collision
        const rockMat = this.renderer.createToonMaterial(0xb08050);
        const darkRock = this.renderer.createToonMaterial(0x8a6030);
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        // Giant rock formations on sides
        for (let i = 0; i < 6; i++) {
            const h = 10 + Math.random() * 14;
            const rad = 3 + Math.random() * 4;
            const geo = new THREE.CylinderGeometry(rad, 5 + Math.random() * 5, h, 7);
            const mat = i % 2 === 0 ? rockMat : darkRock;
            const rock = new THREE.Mesh(geo, mat);
            const rx = (Math.random() > 0.5 ? -1 : 1) * (halfW - 2 - Math.random() * 8);
            const rz = (Math.random() - 0.5) * (halfL - 4);
            rock.position.set(rx, h / 2, rz);
            rock.castShadow = true;
            this.add(rock);
            this.addCollidable(rock, new THREE.Vector3(rx, h / 2, rz), rad);
        }
        // Cacti
        const cactusMat = this.renderer.createToonMaterial(0x3a8a3a);
        for (let i = 0; i < 8; i++) {
            const c = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.3, 2 + Math.random() * 3, 6),
                cactusMat
            );
            c.position.set(
                (Math.random() - 0.5) * this.courtWidth * 0.8,
                1 + Math.random() * 1.5,
                (Math.random() > 0.5 ? -1 : 1) * (halfL - 2)
            );
            this.add(c);
        }
    }

    buildPillarProps() {
        // Tall stone columns throughout the court + collision
        const colMat = this.renderer.createToonMaterial(0x9a8a7a);
        const capMat = this.renderer.createToonMaterial(0xbaa88a);
        for (let i = 0; i < 10; i++) {
            const x = (Math.random() - 0.5) * (this.courtWidth - 16);
            const z = (Math.random() - 0.5) * (this.courtLength - 16);
            const h = this.wallHeight * 0.7;
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, h, 10), colMat);
            col.position.set(x, h / 2, z);
            col.castShadow = true;
            this.add(col);
            // ponytail: collidable at ground level so players on y=0 collide
            this.addCollidable(col, new THREE.Vector3(x, 0, z), 1.0);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.8, 0.5, 10), capMat);
            cap.position.set(x, h + 0.25, z);
            this.add(cap);
        }
    }

    buildTempleProps() {
        // 4 symmetric pillars at quadrant centers + collision
        const colMat = this.renderer.createToonMaterial(0xbaa88a);
        const capMat = this.renderer.createToonMaterial(0xd4c4a0);
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const positions = [
            [-halfW * 0.4, -halfL * 0.4],
            [halfW * 0.4, -halfL * 0.4],
            [-halfW * 0.4, halfL * 0.4],
            [halfW * 0.4, halfL * 0.4]
        ];
        positions.forEach(([x, z]) => {
            const h = this.wallHeight * 0.7;
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, h, 10), colMat);
            col.position.set(x, h / 2, z);
            col.castShadow = true;
            this.add(col);
            this.addCollidable(col, new THREE.Vector3(x, 0, z), 0.9);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.7, 0.5, 10), capMat);
            cap.position.set(x, h + 0.25, z);
            this.add(cap);
        });
    }

    buildLavaProps() {
        // Glowing lava floor + embers
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xff4400, transparent: true, opacity: 0.4
        });
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth, this.courtLength),
            glowMat
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.05;
        this.add(glow);
        this._lavaGlow = glow;
        // Ember particles
        const emberMat = new THREE.PointsMaterial({
            color: 0xff6600, size: 0.3, transparent: true, opacity: 0.7
        });
        const pos = [];
        for (let i = 0; i < 100; i++) {
            pos.push(
                (Math.random() - 0.5) * this.courtWidth,
                Math.random() * 6 + 1,
                (Math.random() - 0.5) * this.courtLength
            );
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        this._embers = new THREE.Points(geo, emberMat);
        this.add(this._embers);
        // Stone bridges across the lava + collision
        const bridgeMat = this.renderer.createToonMaterial(0x666666);
        for (let s = -1; s <= 1; s += 2) {
            const bridge = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.3, this.courtLength * 0.6),
                bridgeMat
            );
            bridge.position.set(s * 12, 1.5, 0);
            this.add(bridge);
            this.addCollidable(bridge, new THREE.Vector3(s * 12, 1.5, 0), 1.5);
        }
    }

    buildCrystalProps() {
        // Glowing crystal formations
        const colors = [0x88ccff, 0xcc88ff, 0x88ffcc, 0xffcc88];
        const glowColors = [0x4488ff, 0x8844ff, 0x44ff88, 0xff8844];
        for (let i = 0; i < 20; i++) {
            const h = 1.5 + Math.random() * 4;
            const ci = i % 4;
            const rad = 0.3 + Math.random() * 0.4;
            const crystal = new THREE.Mesh(
                new THREE.ConeGeometry(rad, h, 5 + Math.floor(Math.random() * 3)),
                this.renderer.createToonMaterial(colors[ci])
            );
            const cx = (Math.random() - 0.5) * (this.courtWidth - 10);
            const cz = (Math.random() - 0.5) * (this.courtLength - 10);
            crystal.position.set(cx, h / 2, cz);
            this.add(crystal);
            this.addCollidable(crystal, new THREE.Vector3(cx, h / 2, cz), rad);
            // Glow
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.5 + Math.random() * 0.3, 6, 6),
                new THREE.MeshBasicMaterial({
                    color: glowColors[ci], transparent: true, opacity: 0.25
                })
            );
            glow.position.copy(crystal.position);
            glow.position.y -= 0.3;
            this.add(glow);
        }
    }

    buildMechaProps() {
        // Giant mecha statues and industrial elements + collision
        const metalMat = this.renderer.createToonMaterial(0x556677);
        const accentMat = this.renderer.createToonMaterial(0x88aacc);
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        [-1, 1].forEach(sx => {
            [-1, 1].forEach(sz => {
                // Mecha leg
                const leg = new THREE.Mesh(
                    new THREE.BoxGeometry(2, 8, 2),
                    metalMat
                );
                leg.position.set(sx * (halfW - 10), 4, sz * (halfL - 10));
                this.add(leg);
                this.addCollidable(leg, new THREE.Vector3(sx * (halfW - 10), 4, sz * (halfL - 10)), 2.0);
                // Mecha foot
                const foot = new THREE.Mesh(
                    new THREE.BoxGeometry(3, 1.5, 4),
                    accentMat
                );
                foot.position.set(sx * (halfW - 10), 0.75, sz * (halfL - 10));
                this.add(foot);
            });
        });
        // Conveyor belts
        const beltMat = this.renderer.createToonMaterial(0x334455);
        for (let i = 0; i < 4; i++) {
            const belt = new THREE.Mesh(
                new THREE.BoxGeometry(6, 0.2, 3),
                beltMat
            );
            belt.position.set(
                (Math.random() - 0.5) * this.courtWidth * 0.6,
                0.1,
                (Math.random() - 0.5) * this.courtLength * 0.6
            );
            this.add(belt);
        }
        // Overhead crane
        const craneMat = this.renderer.createToonMaterial(0x445566);
        const beam = new THREE.Mesh(
            new THREE.BoxGeometry(4, 0.5, this.courtLength - 10),
            craneMat
        );
        beam.position.set(0, this.ceilingHeight - 3, 0);
        this.add(beam);
    }

    // Neon city vibe — glowing grid billboards around the court.
    buildNeon() {
        const colors = [0xff3d81, 0x2de2e6, 0xf5d300, 0xa855f7];
        const halfW = this.courtWidth / 2 + 6;
        const halfL = this.courtLength / 2 + 6;
        const c = this.config;
        // Translucent colored buildings (existing)
        for (let i = 0; i < 26; i++) {
            const h = 8 + Math.random() * 28;
            const geo = new THREE.BoxGeometry(3 + Math.random() * 4, h, 3 + Math.random() * 4);
            const mat = new THREE.MeshBasicMaterial({
                color: colors[i % colors.length], transparent: true, opacity: 0.35
            });
            const b = new THREE.Mesh(geo, mat);
            const edge = Math.random() > 0.5;
            const x = edge ? (Math.random() > 0.5 ? -1 : 1) * (halfW + Math.random() * 30)
                           : (Math.random() - 0.5) * this.courtWidth * 2;
            const z = edge ? (Math.random() - 0.5) * this.courtLength * 2
                           : (Math.random() > 0.5 ? -1 : 1) * (halfL + Math.random() * 30);
            b.position.set(x, h / 2, z);
            this.add(b);
        }
        // Dark building silhouettes with neon edge glow — city skyline feel
        const darkBuildings = [
            { x: -halfW - 12, z: -halfL - 8, w: 5, h: 45, d: 5 },
            { x: -halfW - 18, z: -halfL + 2, w: 4, h: 38, d: 4 },
            { x: -halfW - 8, z: halfL + 10, w: 6, h: 52, d: 5 },
            { x: -halfW - 22, z: halfL + 4, w: 3, h: 30, d: 4 },
            { x: halfW + 14, z: -halfL - 6, w: 5, h: 48, d: 5 },
            { x: halfW + 10, z: -halfL - 14, w: 4, h: 35, d: 4 },
            { x: halfW + 20, z: halfL + 8, w: 6, h: 55, d: 5 },
            { x: halfW + 8, z: halfL + 16, w: 4, h: 40, d: 4 },
            { x: -halfW - 6, z: 0, w: 4, h: 42, d: 4 },
            { x: halfW + 6, z: 0, w: 4, h: 36, d: 4 },
        ];
        darkBuildings.forEach(b => {
            const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
            const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a2e });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(b.x, b.h / 2, b.z);
            this.add(mesh);
            // Thin glowing edge lines on each building
            const edgeColor = colors[Math.floor(Math.random() * colors.length)];
            const edgeMat = new THREE.MeshBasicMaterial({
                color: edgeColor, transparent: true, opacity: 0.5, wireframe: true
            });
            const edge = new THREE.Mesh(geo.clone(), edgeMat);
            edge.position.copy(mesh.position);
            this.add(edge);
        });
        // Star field above too
        this.buildStars();
    }

    _buildFloorTexture(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 256; i += 32) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
        }
        const imgData = ctx.getImageData(0, 0, 256, 256);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 12;
            imgData.data[i] += noise;
            imgData.data[i+1] += noise;
            imgData.data[i+2] += noise;
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(8, 8);
        return tex;
    }

    buildFloor() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const c = this.config;

        // Red half
        const rGeo = new THREE.PlaneGeometry(this.courtWidth, halfL);
        const rTex = this._buildFloorTexture(c.floorRed);
        const rMat = new THREE.MeshStandardMaterial({
            map: rTex, roughness: 0.7, metalness: 0.1,
            emissive: new THREE.Color(c.floorRed), emissiveIntensity: 0.05
        });
        const rFloor = new THREE.Mesh(rGeo, rMat);
        rFloor.rotation.x = -Math.PI / 2;
        rFloor.position.set(0, 0, -halfL / 2);
        rFloor.receiveShadow = true;
        this.add(rFloor);

        // Blue half
        const bGeo = new THREE.PlaneGeometry(this.courtWidth, halfL);
        const bTex = this._buildFloorTexture(c.floorBlue);
        const bMat = new THREE.MeshStandardMaterial({
            map: bTex, roughness: 0.7, metalness: 0.1,
            emissive: new THREE.Color(c.floorBlue), emissiveIntensity: 0.05
        });
        const bFloor = new THREE.Mesh(bGeo, bMat);
        bFloor.rotation.x = -Math.PI / 2;
        bFloor.position.set(0, 0, halfL / 2);
        bFloor.receiveShadow = true;
        this.add(bFloor);

        // Lines
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        // Center
        const cl = new THREE.Mesh(new THREE.PlaneGeometry(this.courtWidth, 0.2), lineMat);
        cl.rotation.x = -Math.PI / 2;
        cl.position.y = 0.01;
        this.add(cl);

        // Center circle
        const circGeo = new THREE.RingGeometry(3, 3.2, 32);
        const circ = new THREE.Mesh(circGeo, lineMat);
        circ.rotation.x = -Math.PI / 2;
        circ.position.y = 0.01;
        this.add(circ);

        // Borders
        [-halfW, halfW].forEach(x => {
            const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, this.courtLength), lineMat);
            l.rotation.x = -Math.PI / 2;
            l.position.set(x, 0.01, 0);
            this.add(l);
        });
        [-halfL, halfL].forEach(z => {
            const l = new THREE.Mesh(new THREE.PlaneGeometry(this.courtWidth, 0.12), lineMat);
            l.rotation.x = -Math.PI / 2;
            l.position.set(0, 0.01, z);
            this.add(l);
        });

        // ponytail: court glow strips — team-colored neon lines at zone boundaries
        const glowRed = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth, 4),
            new THREE.MeshBasicMaterial({ color: c.floorRed, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
        );
        glowRed.rotation.x = -Math.PI / 2;
        glowRed.position.set(0, 0.015, -halfL / 2);
        this.add(glowRed);
        const glowBlue = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth, 4),
            new THREE.MeshBasicMaterial({ color: c.floorBlue, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
        );
        glowBlue.rotation.x = -Math.PI / 2;
        glowBlue.position.set(0, 0.015, halfL / 2);
        this.add(glowBlue);
        // Center line glow — bright white
        const centerGlow = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth, 1.5),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
        );
        centerGlow.rotation.x = -Math.PI / 2;
        centerGlow.position.set(0, 0.015, 0);
        this.add(centerGlow);
    }

    buildWalls() {
        return; // ponytail: no visual walls, keep bounds for collision
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const c = this.config;

        // Open sides (beach_open, minecraft) — corner posts only, no full walls
        if (c.openSides || c.noSides) {
            const postMat = this.renderer.createToonMaterial(c.wallColor);
            const postGeo = new THREE.BoxGeometry(0.8, 1.5, 0.8);
            // 4 corner posts
            [[-halfW, -halfL], [-halfW, halfL], [halfW, -halfL], [halfW, halfL]].forEach(([x, z]) => {
                const p = new THREE.Mesh(postGeo, postMat);
                p.position.set(x, 0.75, z);
                this.add(p);
            });
            return;
        }

        if (c.hasGlass) {
            // Transparent glass walls on sides
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xaaccee,
                transparent: true,
                opacity: 0.15,
                roughness: 0.1,
                side: THREE.DoubleSide
            });

            // Side walls — glass
            const sideGeo = new THREE.PlaneGeometry(this.courtLength + 1, this.wallHeight);
            [-halfW, halfW].forEach(x => {
                const wall = new THREE.Mesh(sideGeo, glassMat);
                wall.position.set(x, this.wallHeight / 2, 0);
                wall.rotation.y = Math.PI / 2;
                this.add(wall);
            });

            // Glass frame pillars
            const pillarGeo = new THREE.BoxGeometry(0.3, this.wallHeight, 0.3);
            const pillarMat = this.renderer.createToonMaterial(c.wallColor);
            for (let z = -halfL; z <= halfL; z += 8) {
                [-halfW, halfW].forEach(x => {
                    const p = new THREE.Mesh(pillarGeo, pillarMat);
                    p.position.set(x, this.wallHeight / 2, z);
                    this.add(p);
                });
            }
        } else {
            // Solid walls
            const wallMat = this.renderer.createToonMaterial(c.wallColor);
            const sideGeo = new THREE.BoxGeometry(0.6, this.wallHeight, this.courtLength + 1);
            [-halfW - 0.3, halfW + 0.3].forEach(x => {
                const w = new THREE.Mesh(sideGeo, wallMat);
                w.position.set(x, this.wallHeight / 2, 0);
                w.castShadow = true;
                this.add(w);
            });
        }

        // Back walls always solid
        const backMat = this.renderer.createToonMaterial(c.wallColor);
        const backGeo = new THREE.BoxGeometry(this.courtWidth + 1, this.wallHeight, 0.6);
        [-halfL - 0.3, halfL + 0.3].forEach(z => {
            const w = new THREE.Mesh(backGeo, backMat);
            w.position.set(0, this.wallHeight / 2, z);
            w.castShadow = true;
            this.add(w);
        });

        // Team banners
        const banGeo = new THREE.PlaneGeometry(10, 4);
        const rBan = new THREE.Mesh(banGeo, new THREE.MeshBasicMaterial({
            color: 0xee4444, side: THREE.DoubleSide, transparent: true, opacity: 0.8
        }));
        rBan.position.set(0, this.wallHeight - 4, -halfL + 0.05);
        this.add(rBan);

        const bBan = new THREE.Mesh(banGeo, new THREE.MeshBasicMaterial({
            color: 0x4466ee, side: THREE.DoubleSide, transparent: true, opacity: 0.8
        }));
        bBan.position.set(0, this.wallHeight - 4, halfL - 0.05);
        bBan.rotation.y = Math.PI;
        this.add(bBan);
    }

    buildNet() {
        const halfW = this.courtWidth / 2;
        const netH = Number(this.config.gameplay?.netHeight) || 4.5;
        const netBottom = this.config.isBeachOpen ? 0.35 : 1;

        // Posts
        const postHeight = netH + 1;
        const postGeo = new THREE.CylinderGeometry(0.12, 0.15, postHeight, 8);
        const postMat = this.renderer.createToonMaterial(0xdddddd);
        [-halfW + 1, halfW - 1].forEach(x => {
            const p = new THREE.Mesh(postGeo, postMat);
            p.position.set(x, postHeight / 2, 0);
            p.castShadow = true;
            this.add(p);
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), postMat);
            cap.position.set(x, postHeight, 0);
            this.add(cap);
        });

        // Top bar
        const bar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, this.courtWidth - 2, 8),
            postMat
        );
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, netH, 0);
        this.add(bar);

        // Net
        const netMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.2,
            side: THREE.DoubleSide, wireframe: true
        });
        const net = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth - 2, netH - netBottom),
            netMat
        );
        net.position.set(0, (netH + netBottom) / 2, 0);
        this.add(net);
    }

    buildCeiling() {
        return; // ponytail: no visual ceiling, keep ceilingHeight for bounds
        // Beams
        const beamMat = this.renderer.createToonMaterial(this.config.wallColor);
        const beamGeo = new THREE.BoxGeometry(this.courtWidth + 2, 0.35, 0.35);
        for (let z = -this.courtLength / 2; z <= this.courtLength / 2; z += 7) {
            const b = new THREE.Mesh(beamGeo, beamMat);
            b.position.set(0, this.ceilingHeight, z);
            this.add(b);
        }

        // Spawn marker
        const mGeo = new THREE.RingGeometry(1.0, 1.5, 24);
        const mMat = new THREE.MeshBasicMaterial({
            color: 0xffaa33, side: THREE.DoubleSide, transparent: true, opacity: 0.5
        });
        const marker = new THREE.Mesh(mGeo, mMat);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(0, this.ceilingHeight - 0.1, 0);
        this.add(marker);

        // Spawn glow — removed (visual artifact)
        this.spawnGlow = null;

        // Lights
        const lgGeo = new THREE.BoxGeometry(2.5, 0.15, 0.5);
        const lgMat = new THREE.MeshBasicMaterial({ color: 0xfffedd });
        for (let x = -this.courtWidth / 2 + 10; x <= this.courtWidth / 2 - 10; x += 12) {
            for (let z = -this.courtLength / 2 + 6; z <= this.courtLength / 2 - 6; z += 10) {
                const l = new THREE.Mesh(lgGeo, lgMat);
                l.position.set(x, this.ceilingHeight - 0.5, z);
                this.add(l);
            }
        }
    }

    buildOcean() {
        // Ocean plane around arena
        const oceanGeo = new THREE.PlaneGeometry(500, 500);
        const oceanMat = new THREE.MeshBasicMaterial({
            color: 0x2288aa,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        this.ocean = new THREE.Mesh(oceanGeo, oceanMat);
        this.ocean.rotation.x = -Math.PI / 2;
        this.ocean.position.y = -0.5;
        this.add(this.ocean);

        // Waves (animated in update)
        const wave1Geo = new THREE.TorusGeometry(80, 0.3, 4, 60);
        const waveMat = new THREE.MeshBasicMaterial({
            color: 0x44bbdd, transparent: true, opacity: 0.3
        });
        this.wave1 = new THREE.Mesh(wave1Geo, waveMat);
        this.wave1.rotation.x = -Math.PI / 2;
        this.wave1.position.y = -0.3;
        this.add(this.wave1);

        // Palm trees (simple)
        this.buildPalmTree(-35, -25);
        this.buildPalmTree(35, -25);
        this.buildPalmTree(-35, 25);
        this.buildPalmTree(35, 25);
    }

    buildPalmTree(x, z) {
        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 8, 6);
        const trunkMat = this.renderer.createToonMaterial(0x8B6914);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, 4, z);
        trunk.rotation.z = (Math.random() - 0.5) * 0.15;
        this.add(trunk);
        this.addCollidable(trunk, new THREE.Vector3(x, 4, z), 0.5);

        // Leaves
        for (let i = 0; i < 5; i++) {
            const leafGeo = new THREE.PlaneGeometry(4, 1.2);
            const leafMat = this.renderer.createToonMaterial(0x33aa33);
            leafMat.side = THREE.DoubleSide;
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            const angle = (i / 5) * Math.PI * 2;
            leaf.position.set(
                x + Math.cos(angle) * 1.5,
                8.5,
                z + Math.sin(angle) * 1.5
            );
            leaf.rotation.x = -0.4;
            leaf.rotation.y = angle;
            this.add(leaf);
        }
    }

    buildStars() {
        // Star particles for space map
        const starGeo = new THREE.BufferGeometry();
        const positions = [];
        for (let i = 0; i < 500; i++) {
            positions.push(
                (Math.random() - 0.5) * 300,
                Math.random() * 150,
                (Math.random() - 0.5) * 300
            );
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const starMat = new THREE.PointsMaterial({
            color: 0xffffff, size: 0.5, transparent: true, opacity: 0.8
        });
        this.stars = new THREE.Points(starGeo, starMat);
        this.add(this.stars);
    }

    buildProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const c = this.config;
        const id = this.mapId;
        const red = c.floorRed;
        const blue = c.floorBlue;

        // --- 1. Team banners/flags on the wall perimeter ---
        // Red side = -Z end, Blue side = +Z end (matches buildFloor halves).
        const banH = Math.min(6, this.wallHeight * 0.5);
        const banW = 3;
        const banGeo = new THREE.PlaneGeometry(banW, banH);
        const banMatRed = new THREE.MeshBasicMaterial({ color: red, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const banMatBlue = new THREE.MeshBasicMaterial({ color: blue, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const banY = this.wallHeight - banH / 2 - 1;
        // Back walls: red back at -halfL, blue back at +halfL
        [[0, -halfL, banMatRed, 0], [0, halfL, banMatBlue, Math.PI]].forEach(([x, z, mat, rot]) => {
            const b = new THREE.Mesh(banGeo, mat);
            b.position.set(x, banY, z);
            b.rotation.y = rot;
            this.add(b);
        });
        // Side walls: 2 flags each, colored by which half they sit on (red half / blue half)
        [-halfW, halfW].forEach(x => {
            [[-halfL / 2, banMatRed], [halfL / 2, banMatBlue]].forEach(([z, mat]) => {
                const f = new THREE.Mesh(banGeo, mat);
                f.position.set(x, banY, z);
                f.rotation.y = Math.PI / 2;
                this.add(f);
            });
        });

        // --- 2. Floor markings: team zone rings + subtle center accent ---
        const zoneMatRed = new THREE.MeshBasicMaterial({ color: red, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const zoneMatBlue = new THREE.MeshBasicMaterial({ color: blue, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const zoneGeo = new THREE.RingGeometry(4, 4.4, 32);
        [[0, -halfL / 2, zoneMatRed], [0, halfL / 2, zoneMatBlue]].forEach(([x, z, mat]) => {
            const r = new THREE.Mesh(zoneGeo, mat);
            r.rotation.x = -Math.PI / 2;
            r.position.set(x, 0.02, z);
            this.add(r);
        });
        const centerAccent = new THREE.Mesh(
            new THREE.PlaneGeometry(this.courtWidth, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 })
        );
        centerAccent.rotation.x = -Math.PI / 2;
        centerAccent.position.y = 0.015;
        this.add(centerAccent);

        // --- 3. Varied corner props by map type (corners only, never center court) ---
        const corners = [
            [-halfW + 2, -halfL + 2], [halfW - 2, -halfL + 2],
            [-halfW + 2, halfL - 2], [halfW - 2, halfL - 2]
        ];
        if (['industrial', 'cyber', 'mecha', 'pillar'].includes(id)) {
            // Crates (boxes) for industrial/sci-fi maps
            const g = new THREE.BoxGeometry(1.6, 1.6, 1.6);
            const m = this.renderer.createToonMaterial(id === 'cyber' ? 0x445566 : 0x8a6a4a);
            corners.forEach(([x, z]) => {
                const crate = new THREE.Mesh(g, m);
                crate.position.set(x, 0.8, z);
                crate.rotation.y = Math.random() * 0.4;
                crate.castShadow = true;
                this.add(crate);
                this.addCollidable(crate, new THREE.Vector3(x, 0.8, z), 1.0);
            });
        } else if (['ice', 'space', 'crystal'].includes(id)) {
            // Crystal shards (octahedra) for cold/sparkly maps
            const g = new THREE.OctahedronGeometry(1.1, 0);
            const m = this.renderer.createToonMaterial(id === 'ice' ? 0x9fd8ff : (id === 'space' ? 0xb080d0 : 0x88aacc));
            corners.forEach(([x, z]) => {
                const cr = new THREE.Mesh(g, m);
                cr.position.set(x, 1.2, z);
                cr.rotation.y = Math.random() * Math.PI;
                cr.castShadow = true;
                this.add(cr);
                this.addCollidable(cr, new THREE.Vector3(x, 1.2, z), 1.0);
            });
        } else if (['volcano', 'lava', 'dojo'].includes(id)) {
            // Torches: wooden post + glowing flame
            const postG = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8);
            const postM = this.renderer.createToonMaterial(0x5a3a1a);
            const flameGeo = new THREE.SphereGeometry(0.35, 8, 8);
            const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722, transparent: true, opacity: 0.85 });
            corners.forEach(([x, z]) => {
                const post = new THREE.Mesh(postG, postM);
                post.position.set(x, 1.1, z);
                this.add(post);
                this.addCollidable(post, new THREE.Vector3(x, 1.1, z), 0.5);
                const flame = new THREE.Mesh(flameGeo, flameMat);
                flame.position.set(x, 2.4, z);
                this.add(flame);
            });
        } else if (['jungle', 'beach', 'beach_open'].includes(id)) {
            // Plants: pot + foliage cone
            const potG = new THREE.CylinderGeometry(0.5, 0.4, 0.6, 8);
            const potM = this.renderer.createToonMaterial(id === 'jungle' ? 0x6a4a2a : 0xd8b888);
            const foliG = new THREE.ConeGeometry(0.7, 1.4, 8);
            const foliM = this.renderer.createToonMaterial(id === 'jungle' ? 0x4a8a3a : 0x3a9a5a);
            corners.forEach(([x, z]) => {
                const pot = new THREE.Mesh(potG, potM);
                pot.position.set(x, 0.3, z);
                pot.castShadow = true;
                this.add(pot);
                this.addCollidable(pot, new THREE.Vector3(x, 0.3, z), 0.5);
                const foli = new THREE.Mesh(foliG, foliM);
                foli.position.set(x, 1.3, z);
                foli.castShadow = true;
                this.add(foli);
            });
        } else {
            // Default: barrel (original behavior) for colosseum/cloud/neon/canyon
            const barrelGeo = new THREE.CylinderGeometry(0.5, 0.55, 1.2, 8);
            const barrelMat = this.renderer.createToonMaterial(0x8B4513);
            corners.forEach(([x, z]) => {
                const b = new THREE.Mesh(barrelGeo, barrelMat);
                b.position.set(x, 0.6, z);
                b.castShadow = true;
                this.add(b);
                this.addCollidable(b, new THREE.Vector3(x, 0.6, z), 0.55);
            });
        }

        // --- 4. Wall light strips (glowing, team-colored) ---
        // Warm on red side, cool on blue side. 2-3 strips per wall.
        const stripMatWarm = new THREE.MeshBasicMaterial({ color: 0xff7744 });
        const stripMatCool = new THREE.MeshBasicMaterial({ color: 0x44aaff });
        const stripTopY = this.wallHeight - 0.5;
        const backStripGeo = new THREE.BoxGeometry(this.courtWidth / 4, 0.18, 0.18);
        [-halfL, halfL].forEach((z, zi) => {
            const mat = zi === 0 ? stripMatWarm : stripMatCool;
            [-this.courtWidth / 4, 0, this.courtWidth / 4].forEach(x => {
                const s = new THREE.Mesh(backStripGeo, mat);
                s.position.set(x, stripTopY, z);
                this.add(s);
            });
        });
        const sideStripGeo = new THREE.BoxGeometry(0.18, 0.18, this.courtLength / 4);
        [-halfW, halfW].forEach(x => {
            [[-halfL / 2, stripMatWarm], [halfL / 2, stripMatCool]].forEach(([z, mat]) => {
                const s = new THREE.Mesh(sideStripGeo, mat);
                s.position.set(x, stripTopY, z);
                this.add(s);
            });
        });

        // --- 5. Floating ambient particles (theme-colored, gentle bobbing) ---
        // Placed around court edges, never center. Updated in update().
        const particleColor = c.skyTop || c.fogColor;
        const pGeo = new THREE.SphereGeometry(0.18, 6, 6);
        const pMat = new THREE.MeshBasicMaterial({ color: particleColor, transparent: true, opacity: 0.7 });
        this._ambientParticles = [];
        for (let i = 0; i < 12; i++) {
            const p = new THREE.Mesh(pGeo, pMat);
            const edge = i % 4;
            let x, z;
            if (edge === 0) { x = -halfW + 2 + Math.random() * 4; z = (Math.random() - 0.5) * this.courtLength * 0.85; }
            else if (edge === 1) { x = halfW - 2 - Math.random() * 4; z = (Math.random() - 0.5) * this.courtLength * 0.85; }
            else if (edge === 2) { z = -halfL + 2 + Math.random() * 4; x = (Math.random() - 0.5) * this.courtWidth * 0.85; }
            else { z = halfL - 2 - Math.random() * 4; x = (Math.random() - 0.5) * this.courtWidth * 0.85; }
            const baseY = 3 + Math.random() * (this.wallHeight - 5);
            p.position.set(x, baseY, z);
            this.add(p);
            this._ambientParticles.push({ mesh: p, baseY, phase: Math.random() * Math.PI * 2, amp: 0.3 + Math.random() * 0.4 });
        }
    }

    buildSkybox() {
        const c = this.config;
        const skyConfig = c.sky || {};
        // Match world fog + clear color to this map's palette.
        if (this.scene.fog) this.scene.fog.color.set(c.fogColor);
        this.renderer.renderer.setClearColor(c.fogColor);
        // Keep the camera safely inside the dome; a small dome exposes its circular edge at steep pitch angles.
        const skyGeo = new THREE.SphereGeometry(1000, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
            fog: false,
            uniforms: {
                topColor: { value: new THREE.Color(c.skyTop) },
                bottomColor: { value: new THREE.Color(c.skyBottom) },
                horizonColor: { value: new THREE.Color(skyConfig.horizonColor ?? c.skyBottom) },
                sunColor: { value: new THREE.Color(skyConfig.sunColor ?? 0xfff2c0) },
                sunAmount: { value: skyConfig.sun ? 1 : 0 },
                cloudAmount: { value: Math.min(1, Math.max(0, skyConfig.cloudAmount || 0)) }
            },
            vertexShader: `
                varying vec3 vWP;
                void main() {
                    vWP = (modelMatrix * vec4(position,1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform vec3 horizonColor;
                uniform vec3 sunColor;
                uniform float sunAmount;
                uniform float cloudAmount;
                varying vec3 vWP;
                void main() {
                    vec3 n = normalize(vWP);
                    float h = clamp(n.y, 0.0, 1.0);
                    vec3 color = mix(bottomColor, horizonColor, smoothstep(0.0, 0.16, h));
                    color = mix(color, topColor, smoothstep(0.12, 0.82, h));
                    vec3 sunDir = normalize(vec3(-0.55, 0.38, -0.74));
                    float sun = 1.0 - smoothstep(0.035, 0.075, distance(n, sunDir));
                    float bands = sin(n.x * 28.0 + n.z * 19.0) + sin(n.x * 51.0 - n.z * 33.0);
                    float clouds = smoothstep(0.65, 1.45, bands) * smoothstep(0.08, 0.24, h)
                        * (1.0 - smoothstep(0.48, 0.72, h)) * cloudAmount;
                    color = mix(color, vec3(1.0), clouds * 0.24);
                    color += sunColor * sun * sunAmount * 0.7;
                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });
        const sky = this.add(new THREE.Mesh(skyGeo, skyMat));
        sky.renderOrder = -1000;
        sky.frustumCulled = false;
        this.skybox = sky;
    }

    buildAtlantisProps() {
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        this._atlantisFish = [];
        this._atlantisKelp = [];

        const glowMat = new THREE.MeshBasicMaterial({ color: 0x7df5ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
        for (let i = 0; i < 5; i++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(10 + i * 9, 0.08, 6, 96), glowMat.clone());
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(0, 0.04 + i * 0.01, 0);
            ring.scale.z = 0.55;
            this.add(ring);
        }

        const colMat = this.renderer.createToonMaterial(0x6ee0dc);
        [[-halfW + 8, -halfL + 8], [halfW - 8, -halfL + 8], [-halfW + 8, halfL - 8], [halfW - 8, halfL - 8]].forEach(([x, z]) => {
            const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 9, 10), colMat);
            col.position.set(x, 4.5, z);
            this.add(col);
            this.addCollidable(col, col.position, 1.4);

            const cap = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 4), colMat);
            cap.position.set(x, 9.2, z);
            this.add(cap);
        });

        const coralColors = [0xff6f9f, 0xffc857, 0x8cffc1, 0xa887ff];
        for (let i = 0; i < 22; i++) {
            const edge = i % 4;
            const x = edge < 2 ? -halfW + 5 + Math.random() * (halfW * 2 - 10) : (edge === 2 ? -halfW + 6 : halfW - 6);
            const z = edge < 2 ? (edge === 0 ? -halfL + 6 : halfL - 6) : -halfL + 5 + Math.random() * (halfL * 2 - 10);
            const group = new THREE.Group();
            group.position.set(x, 0, z);
            for (let j = 0; j < 4; j++) {
                const stem = new THREE.Mesh(
                    new THREE.ConeGeometry(0.25 + Math.random() * 0.2, 1.2 + Math.random() * 1.7, 6),
                    this.renderer.createToonMaterial(coralColors[(i + j) % coralColors.length])
                );
                stem.position.set((Math.random() - 0.5) * 1.2, stem.geometry.parameters.height / 2, (Math.random() - 0.5) * 1.2);
                stem.rotation.z = (Math.random() - 0.5) * 0.6;
                group.add(stem);
            }
            this.add(group);
        }

        const kelpMat = new THREE.MeshBasicMaterial({ color: 0x2bd68f, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
        for (let i = 0; i < 28; i++) {
            const edge = i % 4;
            const x = edge < 2 ? -halfW + 4 + Math.random() * (halfW * 2 - 8) : (edge === 2 ? -halfW + 4 : halfW - 4);
            const z = edge < 2 ? (edge === 0 ? -halfL + 4 : halfL - 4) : -halfL + 4 + Math.random() * (halfL * 2 - 8);
            const kelp = new THREE.Group();
            kelp.position.set(x, 0, z);
            for (let j = 0; j < 3; j++) {
                const h = 3 + Math.random() * 4;
                const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.55, h), kelpMat);
                blade.position.set((j - 1) * 0.22, h / 2, 0);
                blade.rotation.y = j * 2.1;
                kelp.add(blade);
            }
            kelp.userData.phase = Math.random() * Math.PI * 2;
            this.add(kelp);
            this._atlantisKelp.push(kelp);
        }

        const fishColors = [0xffcc55, 0xff7aa2, 0x8cf5ff, 0xd9ff7a];
        for (let i = 0; i < 12; i++) {
            const fish = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: fishColors[i % fishColors.length] }));
            body.scale.set(1.7, 0.7, 0.8);
            const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), new THREE.MeshBasicMaterial({ color: fishColors[i % fishColors.length] }));
            tail.rotation.z = Math.PI / 2;
            tail.position.x = -0.8;
            fish.add(body, tail);
            fish.userData = { phase: Math.random() * Math.PI * 2, radius: 28 + Math.random() * 18, speed: 0.18 + Math.random() * 0.12, y: 5 + Math.random() * 10, tail };
            this.add(fish);
            this._atlantisFish.push(fish);
        }

        const bubbleCount = 160;
        const pos = new Float32Array(bubbleCount * 3);
        for (let i = 0; i < bubbleCount; i++) {
            pos[i * 3] = (Math.random() - 0.5) * this.courtWidth;
            pos[i * 3 + 1] = Math.random() * this.ceilingHeight;
            pos[i * 3 + 2] = (Math.random() - 0.5) * this.courtLength;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0xbffbff, size: 0.18, transparent: true, opacity: 0.55 });
        this._atlantisBubbles = new THREE.Points(geo, mat);
        this.add(this._atlantisBubbles);
    }

    buildLights() {
        const spot = new THREE.SpotLight(0xffffff, 0.5, 60, Math.PI / 4);
        const lightY = this.ceilingHeight > 0 ? this.ceilingHeight - 1 : Math.max(18, this.wallHeight + 8);
        spot.position.set(0, lightY, 0);
        spot.target.position.set(0, 0, 0);
        this.add(spot);
        this.add(spot.target);

        const halfL = this.courtLength / 2;
        [-halfL / 2, halfL / 2].forEach(z => {
            const s = new THREE.SpotLight(0xfff8ee, 0.25, 45, Math.PI / 5);
            s.position.set(0, lightY, z);
            s.target.position.set(0, 0, z);
            this.add(s);
            this.add(s.target);
        });

        // ponytail: team zone glow lights — soft colored light at each team's zone
        const c = this.config;
        const redLight = new THREE.PointLight(c.floorRed || 0xff4444, 0.25, 35);
        redLight.position.set(0, 2, -halfL / 3);
        this.add(redLight);
        const blueLight = new THREE.PointLight(c.floorBlue || 0x4488ff, 0.25, 35);
        blueLight.position.set(0, 2, halfL / 3);
        this.add(blueLight);

        // ponytail: corner accent lights
        const halfW = this.courtWidth / 2;
        [[-halfW, 3, -halfL], [halfW, 3, -halfL], [-halfW, 3, halfL], [halfW, 3, halfL]].forEach(([x, y, z]) => {
            const light = new THREE.PointLight(c.wallColor || 0xffffff, 0.12, 25);
            light.position.set(x, y, z);
            this.add(light);
        });
    }

    update(time, dt = 1 / 60) {
        dt = Math.min(Math.max(dt, 0), 0.05);
        if (this.spawnGlow) {
            this.spawnGlow.material.opacity = 0.25 + Math.sin(time * 3) * 0.15;
            this.spawnGlow.scale.setScalar(1 + Math.sin(time * 2) * 0.15);
        }
        if (this.ocean) {
            this.ocean.position.y = -0.5 + Math.sin(time * 0.5) * 0.15;
        }
        if (this.wave1) {
            this.wave1.rotation.z = time * 0.1;
            this.wave1.position.y = -0.3 + Math.sin(time * 0.7) * 0.1;
        }
        if (this.stars) {
            this.stars.rotation.y = time * 0.005;
        }
        if (this._spaceStars) {
            this._spaceStars.rotation.y = time * 0.003;
        }
        if (this.chicken?.visible) {
            const phase = this.chicken.userData.phase || 0;
            const limitX = this.courtWidth * 0.38;
            const limitZ = this.courtLength * 0.38;
            this.chicken.position.x = Math.sin(time * 0.62 + phase) * limitX;
            this.chicken.position.z = Math.sin(time * 0.91 + phase * 1.7) * limitZ;
            this.chicken.rotation.y = Math.atan2(
                Math.cos(time * 0.62 + phase) * limitX,
                Math.cos(time * 0.91 + phase * 1.7) * limitZ
            );
            this.chicken.position.y = 0.48 + Math.abs(Math.sin(time * 7 + phase)) * 0.08;
        }
        // Lava glow pulse
        if (this._lavaGlow) {
            this._lavaGlow.material.opacity = 0.3 + Math.sin(time * 2) * 0.15;
            this._lavaGlow.scale.setScalar(1 + Math.sin(time * 1.5) * 0.02);
        }
        if (this._embers) {
            this._embers.rotation.y = time * 0.02;
            const pos = this._embers.geometry.attributes.position.array;
            for (let i = 1; i < pos.length; i += 3) {
                pos[i] += Math.sin(time + i) * 0.005;
                if (pos[i] > 8) pos[i] = 1;
            }
            this._embers.geometry.attributes.position.needsUpdate = true;
        }
        // Portal animasyonu — dönsün, parlasın, 30sn'de yer değiştir
        if (this.portals) {
            this.portals.forEach((p, i) => {
                // Outer ring rotates
                p.mesh.rotation.z += 0.02;
                p.core.material.opacity = 0.1 + Math.sin(time * 3 + i) * 0.1;
                // Inner light pulses
                p.light.scale.setScalar(1 + Math.sin(time * 4 + i * 2) * 0.2);
                // Particle sparkles rotate
                p.particles.rotation.y += 0.01 - i * 0.005;
                // Opacity pulse for particles
                p.pMat.opacity = 0.5 + Math.sin(time * 2 + i) * 0.3;
                if (p.cooldown > 0) p.cooldown -= dt;
            });
            this.portalSwapTimer -= dt;
            if (this.portalSwapTimer <= 0) {
                this.portalSwapTimer = this.portalSwapInterval;
                this.portals.forEach(p => {
                    const nx = (Math.random() - 0.5) * this.courtWidth * 0.7;
                    const nz = (Math.random() - 0.5) * this.courtLength * 0.7;
                    [p.mesh, p.core, p.light, p.particles].forEach(obj => {
                        obj.position.x = nx;
                        obj.position.z = nz;
                    });
                    p.pos.set(nx, 3, nz);
                });
            }
        }

        // Ambient particles — gentle bobbing
        if (this._ambientParticles) {
            this._ambientParticles.forEach(p => {
                p.mesh.position.y = p.baseY + Math.sin(time * 1.5 + p.phase) * p.amp;
            });
        }

        if (this._atlantisKelp) {
            this._atlantisKelp.forEach(kelp => {
                const sway = Math.sin(time * 1.4 + kelp.userData.phase) * 0.18;
                kelp.children.forEach((blade, i) => { blade.rotation.z = sway * (1 + i * 0.25); });
            });
        }
        if (this._atlantisFish) {
            this._atlantisFish.forEach((fish, i) => {
                const d = fish.userData;
                const a = time * d.speed + d.phase;
                fish.position.set(Math.cos(a) * d.radius, d.y + Math.sin(time * 1.2 + i) * 0.7, Math.sin(a) * d.radius * 0.75);
                fish.rotation.y = -a + Math.PI / 2;
                if (d.tail) d.tail.rotation.y = Math.sin(time * 8 + i) * 0.45;
            });
        }
        if (this._atlantisBubbles) {
            const pos = this._atlantisBubbles.geometry.attributes.position.array;
            for (let i = 1; i < pos.length; i += 3) {
                pos[i] += 0.035 + Math.sin(time + i) * 0.004;
                if (pos[i] > this.ceilingHeight) pos[i] = 0.2;
            }
            this._atlantisBubbles.geometry.attributes.position.needsUpdate = true;
        }

        // Weather update
        if (this.weather) {
            this.weather.update(0.016, time);
        }
        // Scene ambient particles
        this.updateAmbientParticles(0.016);
    }

    buildMinecraft() {
        // Minecraft-style terrain with BIG blocky look, optimized (no 20k individual meshes)
        const S = 2.0; // block size — bigger = more Minecraft feel + fewer draw calls
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const grassMat = new THREE.MeshBasicMaterial({ color: 0x7cb342 });
        const dirtMat = new THREE.MeshBasicMaterial({ color: 0x8a6a3a });
        const stoneMat = new THREE.MeshBasicMaterial({ color: 0x888888 });
        const woodMat = new THREE.MeshBasicMaterial({ color: 0x6a4a2a });
        const leafMat = new THREE.MeshBasicMaterial({ color: 0x4a8a2a });
        const plankMat = new THREE.MeshBasicMaterial({ color: 0xc8a86a });
        const waterMat = new THREE.MeshBasicMaterial({ color: 0x3388cc, transparent: true, opacity: 0.6 });

        // Helper: single block mesh
        const block = (x, y, z, mat, sz = S) => {
            const geo = new THREE.BoxGeometry(sz * 0.95, sz * 0.95, sz * 0.95);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, y, z);
            this.add(mesh);
            return mesh;
        };

        // Floor: 3 large flat boxes instead of thousands of tiny blocks
        const layer = (y, mat) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(this.courtWidth - 0.5, 1, this.courtLength - 0.5), mat);
            m.position.set(0, y - 0.5, 0);
            this.add(m);
        };
        layer(0, grassMat);
        layer(-1, dirtMat);
        layer(-2, stoneMat);

        // Block grid lines on grass layer to make it look blocky
        const gridMat = new THREE.LineBasicMaterial({ color: 0x5a8a2a, transparent: true, opacity: 0.3 });
        for (let x = -halfW; x <= halfW; x += S) {
            const pts = [new THREE.Vector3(x, 0.01, -halfL), new THREE.Vector3(x, 0.01, halfL)];
            this.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
        }
        for (let z = -halfL; z <= halfL; z += S) {
            const pts = [new THREE.Vector3(-halfW, 0.01, z), new THREE.Vector3(halfW, 0.01, z)];
            this.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
        }

        // Block trees — bigger (4×4 blocks) with S=2
        const trees = [
            { x: -halfW + 6, z: -halfL + 6 },
            { x: halfW - 6, z: -halfL + 6 },
            { x: -halfW + 6, z: halfL - 6 },
            { x: halfW - 6, z: halfL - 6 },
            { x: -halfW + 4, z: 0 },
            { x: halfW - 4, z: 0 },
        ];
        trees.forEach(t => {
            for (let y = 2; y <= 6; y += S) block(t.x, y, t.z, woodMat, S);      // trunk
            for (let dx = -S; dx <= S; dx += S) {
                for (let dz = -S; dz <= S; dz += S) {
                    block(t.x + dx, 6, t.z + dz, leafMat, S);
                    if (Math.random() < 0.7) block(t.x + dx, 8, t.z + dz, leafMat, S);
                }
            }
            block(t.x, 10, t.z, leafMat, S);
        });

        // Small house
        const hx = halfW - 8, hz = halfL - 8;
        const wall = (x, y, z) => block(x, y, z, plankMat, S);
        // Floor
        for (let x = hx; x < hx + S * 3; x += S) for (let z = hz; z < hz + S * 2; z += S) block(x, S, z, woodMat, S);
        // Walls
        for (let x = hx; x < hx + S * 3; x += S) { wall(x, S * 2, hz); wall(x, S * 2, hz + S * 2); }
        for (let z = hz; z < hz + S * 2; z += S) { wall(hx, S * 2, z); wall(hx + S * 3, S * 2, z); }
        // Roof
        for (let x = hx - S/2; x < hx + S * 3.5; x += S) {
            for (let z = hz - S/2; z < hz + S * 2.5; z += S) {
                const slab = new THREE.Mesh(new THREE.BoxGeometry(S * 0.9, 0.4, S * 0.9), stoneMat);
                slab.position.set(x + S/2, S * 4, z + S/2);
                this.add(slab);
            }
        }

        // Pond
        const pondGeo = new THREE.CircleGeometry(3, 16);
        const pond = new THREE.Mesh(pondGeo, waterMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(6, 0.05, -5);
        this.add(pond);
    }

    // Portal çarpışma kontrolü — top portala girince diğerine çıkar.
    // ball.js update()'inden çağrılır. Returns true if teleported + flash.
    checkPortalTeleport(ballPos, ballRadius) {
        if (!this.portals) return false;
        for (let i = 0; i < this.portals.length; i++) {
            const p = this.portals[i];
            if (p.cooldown > 0) continue;
            const pp = p.pos || p.mesh?.position;
            if (!pp) continue;
            const dx = ballPos.x - pp.x;
            const dz = ballPos.z - pp.z;
            const dy = Math.abs(ballPos.y - pp.y);
            if (Math.hypot(dx, dz) < 1.2 + ballRadius && dy < 2) {
                const other = this.portals[1 - i];
                const op = other.pos || other.mesh?.position;
                if (!op) return false;
                ballPos.x = op.x;
                ballPos.y = op.y + 1;
                ballPos.z = op.z;
                p.cooldown = 1.5;
                other.cooldown = 1.5;
                // Visual flash on both portals (if core/light exist)
                [p, other].forEach(portal => {
                    if (portal.core) portal.core.material.opacity = 0.8;
                    if (portal.light) portal.light.scale.setScalar(3);
                });
                return true;
            }
        }
        return false;
    }

    addAmbientParticles(type = 'dust') {
        const configs = {
            dust:   { color: 0xffeedd, count: 50, size: 0.06, opacity: 0.5, speed: 0.3 },
            spark:  { color: 0xffaa44, count: 40, size: 0.08, opacity: 0.7, speed: 0.5 },
            rain:   { color: 0x88bbff, count: 80, size: 0.04, opacity: 0.4, speed: 2.0 },
            snow:   { color: 0xffffff, count: 60, size: 0.06, opacity: 0.6, speed: 0.8 },
            ember:  { color: 0xff4400, count: 40, size: 0.07, opacity: 0.7, speed: 0.4 },
            crystal:{ color: 0x88ddff, count: 35, size: 0.09, opacity: 0.5, speed: 0.2 },
            leaf:   { color: 0x44aa44, count: 30, size: 0.08, opacity: 0.5, speed: 0.3 },
        };
        const cfg = configs[type] || configs.dust;
        for (let i = 0; i < cfg.count; i++) {
            const geo = new THREE.SphereGeometry(cfg.size, 4, 4);
            const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.opacity });
            const p = new THREE.Mesh(geo, mat);
            p.position.set(
                (Math.random() - 0.5) * 60,
                Math.random() * 15 + 2,
                (Math.random() - 0.5) * 40
            );
            p.userData = { speed: cfg.speed * (0.5 + Math.random()), phase: Math.random() * Math.PI * 2 };
            this.add(p);
            this._sceneParticles = this._sceneParticles || [];
            this._sceneParticles.push(p);
        }
    }

    updateAmbientParticles(dt) {
        if (!this._sceneParticles) return;
        this._sceneParticles.forEach(p => {
            p.position.y -= p.userData.speed * dt;
            p.position.x += Math.sin(performance.now() / 1000 + p.userData.phase) * dt * 0.5;
            if (p.position.y < 0) p.position.y = 15 + Math.random() * 5;
        });
    }

    getSpawnPoint() { return this.spawnPoint.clone(); }

    // ponytail: optional index param spreads spawns along X at 6m intervals.
    // Without index, returns the team center spawn (backward-compatible).
    getPlayerSpawn(team, index = 0) {
        const configuredZ = Number(this.config.gameplay?.playerSpawnZ);
        const spawnZ = Number.isFinite(configuredZ)
            ? Math.min(Math.abs(configuredZ), this.courtLength / 2 - 3)
            : this.courtLength / 3;
        const z = team === 'red' ? -spawnZ : spawnZ;
        const spacing = 6;
        // Simpler: center the row. index 0 → x=0, 1 → +3, 2 → -3, 3 → +6, 4 → -6...
        const side = index % 2 === 0 ? 1 : -1;
        const offset = Math.floor((index + 1) / 2) * spacing;
        const spawnX = index === 0 ? 0 : side * offset;
        return new THREE.Vector3(spawnX, 1.7, z);
    }

    // Remove only the objects THIS arena added — leaves lights/camera intact.
    clearMap() {
        this.objects.forEach(obj => {
            this.scene.remove(obj);
            obj.traverse?.(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => m.dispose?.());
                }
            });
        });
        this.objects = [];
        this.collidables = [];
        this.spawnGlow = null;
        this.ocean = null;
        this.wave1 = null;
        this.stars = null;
        this._spaceStars = null;
        this.chicken = null;
        this.pinballTargets = null;
        this.portals = null;
        this._lavaGlow = null;
        this._embers = null;
        this._sceneParticles = null;
        this.jumpPads = null;
        if (this.weather) { this.weather.clear(); this.weather = null; }
    }

    // Tear down and rebuild as a different map.
    rebuild(mapId) {
        if (!MAPS[mapId]) return;
        this.clearMap();
        this.mapId = mapId;
        this.config = MAPS[mapId];
        this.courtWidth = this.config.courtWidth;
        this.courtLength = this.config.courtLength;
        this.wallHeight = this.config.wallHeight;
        this.ceilingHeight = this.config.ceilingHeight;
        // ponytail: spawn lower so ball doesn't get stuck on ceiling (neon map)
        this.spawnPoint = new THREE.Vector3(0, this._ballSpawnHeight(), 0);
        this.bounds = getArenaBounds(this.config);
        this.spectatorBounds = getSpectatorBounds(this.config);
        this.build();
        // ponytail: apply per-map UI theme overrides
        this._applyTheme(mapId);
    }

    // Apply per-map CSS theme variables so HUD matches the active arena palette.
    _applyTheme(mapId) {
        const config = MAPS[mapId];
        const hex = value => `#${value.toString(16).padStart(6, '0')}`;
        const theme = MAP_THEMES[mapId] || (config ? {
            '--ui-primary': hex(config.floorRed),
            '--ui-secondary': hex(config.floorBlue),
            '--ui-bg': hex(config.fogColor || config.skyBottom),
            '--ui-accent': hex(config.floorRed)
        } : MAP_THEMES.classic);
        const root = document.documentElement;
        for (const [key, val] of Object.entries(theme)) {
            root.style.setProperty(key, val);
        }
    }

    // ponytail: themed decorative meshes — extra visual flair per map.
    _buildDecorations() {
        const halfW = this.courtWidth * 0.4;
        const halfL = this.courtLength * 0.4;
        const c = this.config;

        if (c.isDojo) {
            // 4 wooden pillar cylinders at court corners
            const mat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
            const geo = new THREE.CylinderGeometry(0.3, 0.3, 4, 8);
            [[-halfW, -halfL], [halfW, -halfL], [-halfW, halfL], [halfW, halfL]].forEach(([x, z]) => {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(x, 2, z);
                this.add(m);
            });
        }
        if (c.isVolcano) {
            // 6 lava pool circles scattered around floor
            const mat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
            const geo = new THREE.CircleGeometry(1.2, 8);
            geo.rotateX(-Math.PI / 2);
            for (let i = 0; i < 6; i++) {
                const m = new THREE.Mesh(geo, mat);
                m.position.set((Math.random() - 0.5) * this.courtWidth * 0.7, 0.02, (Math.random() - 0.5) * this.courtLength * 0.7);
                m.scale.set(0.5 + Math.random() * 0.8, 1, 0.5 + Math.random() * 0.8);
                this.add(m);
            }
        }
        if (c.isIce) {
            // 8 ice crystal spikes near walls
            const mat = new THREE.MeshLambertMaterial({ color: 0xaaddff });
            for (let i = 0; i < 8; i++) {
                const h = 1 + Math.random() * 2;
                const geo = new THREE.ConeGeometry(0.2 + Math.random() * 0.15, h, 5);
                const m = new THREE.Mesh(geo, mat);
                const edge = i % 4;
                let x, z;
                if (edge === 0) { x = -halfW + 1; z = (Math.random() - 0.5) * halfL * 2; }
                else if (edge === 1) { x = halfW - 1; z = (Math.random() - 0.5) * halfL * 2; }
                else if (edge === 2) { z = -halfL + 1; x = (Math.random() - 0.5) * halfW * 2; }
                else { z = halfL - 1; x = (Math.random() - 0.5) * halfW * 2; }
                m.position.set(x, h / 2, z);
                this.add(m);
            }
        }
        if (c.isJungle) {
            // 6 leafy sphere bushes at floor level
            const mat = new THREE.MeshLambertMaterial({ color: 0x2d8a2d });
            for (let i = 0; i < 6; i++) {
                const r = 0.5 + Math.random() * 0.5;
                const geo = new THREE.SphereGeometry(r, 7, 7);
                const m = new THREE.Mesh(geo, mat);
                m.position.set((Math.random() - 0.5) * this.courtWidth * 0.6, r * 0.5, (Math.random() - 0.5) * this.courtLength * 0.6);
                this.add(m);
            }
        }
        if (c.isColosseum) {
            // 4 arch-shaped torus segments at cardinal directions
            const mat = new THREE.MeshLambertMaterial({ color: 0xc9a878 });
            const geo = new THREE.TorusGeometry(1.8, 0.25, 8, 16, Math.PI);
            [-halfW, halfW].forEach(x => {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(x, 3, 0);
                m.rotation.y = Math.PI / 2;
                this.add(m);
            });
            [-halfL, halfL].forEach(z => {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(0, 3, z);
                this.add(m);
            });
        }
        if (c.isCrystal) {
            // 10 crystal shards pointing up
            const mat = new THREE.MeshLambertMaterial({ color: 0x88ccff });
            for (let i = 0; i < 10; i++) {
                const h = 0.8 + Math.random() * 2.5;
                const geo = new THREE.ConeGeometry(0.1 + Math.random() * 0.25, h, 4);
                const m = new THREE.Mesh(geo, mat);
                m.position.set((Math.random() - 0.5) * this.courtWidth * 0.6, h / 2, (Math.random() - 0.5) * this.courtLength * 0.6);
                this.add(m);
            }
        }
        if (c.isCyber) {
            // 4 floating hologram rings at mid-height
            const mat = new THREE.MeshBasicMaterial({ color: 0x22ddff, transparent: true, opacity: 0.4 });
            const geo = new THREE.TorusGeometry(1.5, 0.06, 8, 24);
            for (let i = 0; i < 4; i++) {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(
                    (i < 2 ? -1 : 1) * halfW * 0.5,
                    4 + i * 1.5,
                    (i % 2 === 0 ? -1 : 1) * halfL * 0.5
                );
                m.rotation.x = Math.PI / 3;
                this.add(m);
            }
        }
        if (c.isCloud) {
            // 8 fluffy sphere clusters above floor
            const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
            for (let i = 0; i < 8; i++) {
                const cluster = new THREE.Group();
                for (let j = 0; j < 3; j++) {
                    const r = 0.4 + Math.random() * 0.4;
                    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), mat);
                    s.position.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8);
                    cluster.add(s);
                }
                cluster.position.set(
                    (Math.random() - 0.5) * this.courtWidth * 0.6,
                    0.3 + Math.random() * 0.5,
                    (Math.random() - 0.5) * this.courtLength * 0.6
                );
                this.add(cluster);
            }
        }
        if (c.isNeon) {
            // 6 neon tube lines along ceiling
            const colors = [0xff3d81, 0x2de2e6, 0xf5d300, 0xa855f7, 0xff6644, 0x44ff88];
            for (let i = 0; i < 6; i++) {
                const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
                const geo = new THREE.CylinderGeometry(0.04, 0.04, 4, 4);
                const m = new THREE.Mesh(geo, mat);
                const ceilY = c.ceilingHeight > 0 ? c.ceilingHeight - 0.5 : 20;
                m.position.set(
                    (Math.random() - 0.5) * this.courtWidth * 0.7,
                    ceilY,
                    (Math.random() - 0.5) * this.courtLength * 0.7
                );
                m.rotation.z = Math.PI / 2;
                this.add(m);
            }
        }
        if (c.isEsport) {
            // 4 spot light cones hanging from ceiling
            const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
            const geo = new THREE.ConeGeometry(0.8, 1.5, 8);
            for (let i = 0; i < 4; i++) {
                const m = new THREE.Mesh(geo, mat);
                const ceilY = c.ceilingHeight > 0 ? c.ceilingHeight - 0.5 : 20;
                m.position.set(
                    (i < 2 ? -1 : 1) * halfW * 0.5,
                    ceilY - 0.75,
                    (i % 2 === 0 ? -1 : 1) * halfL * 0.5
                );
                m.rotation.x = Math.PI;
                this.add(m);
            }
        }
        if (c.isTemple) {
            // 4 guardian statue pillars at corners
            const mat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
            const geo = new THREE.BoxGeometry(1.2, 5, 1.2);
            [[-halfW, -halfL], [halfW, -halfL], [-halfW, halfL], [halfW, halfL]].forEach(([x, z]) => {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(x, 2.5, z);
                this.add(m);
            });
        }
        if (c.isMecha) {
            // 6 machinery cube details on walls
            const mat = new THREE.MeshLambertMaterial({ color: 0x778899 });
            const geo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
            for (let i = 0; i < 6; i++) {
                const m = new THREE.Mesh(geo, mat);
                const edge = i % 4;
                let x, z;
                if (edge === 0) { x = -halfW; z = (Math.random() - 0.5) * halfL * 2; }
                else if (edge === 1) { x = halfW; z = (Math.random() - 0.5) * halfL * 2; }
                else if (edge === 2) { z = -halfL; x = (Math.random() - 0.5) * halfW * 2; }
                else { z = halfL; x = (Math.random() - 0.5) * halfW * 2; }
                m.position.set(x, 2 + Math.random() * 4, z);
                this.add(m);
            }
        }
        if (c.isAtlantis) {
            // 8 bubble spheres scattered at mid-height
            const mat = new THREE.MeshBasicMaterial({ color: 0xbffbff, transparent: true, opacity: 0.3 });
            for (let i = 0; i < 8; i++) {
                const r = 0.2 + Math.random() * 0.3;
                const geo = new THREE.SphereGeometry(r, 8, 8);
                const m = new THREE.Mesh(geo, mat);
                m.position.set(
                    (Math.random() - 0.5) * this.courtWidth * 0.6,
                    3 + Math.random() * 5,
                    (Math.random() - 0.5) * this.courtLength * 0.6
                );
                this.add(m);
            }
        }
        if (c.isSpace) {
            // 4 satellite dish shapes at corners
            const stemMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
            const dishMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
            const stemGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
            const dishGeo = new THREE.ConeGeometry(0.8, 0.5, 8);
            [[-halfW, -halfL], [halfW, -halfL], [-halfW, halfL], [halfW, halfL]].forEach(([x, z]) => {
                const stem = new THREE.Mesh(stemGeo, stemMat);
                stem.position.set(x, 1.6, z);
                this.add(stem);
                const dish = new THREE.Mesh(dishGeo, dishMat);
                dish.position.set(x, 2.2, z);
                dish.rotation.x = Math.PI;
                this.add(dish);
            });
        }
        if (c.isPillar) {
            // 6 tall decorative columns
            const mat = new THREE.MeshLambertMaterial({ color: 0x9a8a7a });
            for (let i = 0; i < 6; i++) {
                const h = 3 + Math.random() * 3;
                const geo = new THREE.CylinderGeometry(0.25, 0.3, h, 8);
                const m = new THREE.Mesh(geo, mat);
                m.position.set(
                    (Math.random() - 0.5) * this.courtWidth * 0.6,
                    h / 2,
                    (Math.random() - 0.5) * this.courtLength * 0.6
                );
                this.add(m);
            }
        }
        if (c.isMinecraft) {
            // 4 blocky torch structures
            const stoneMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
            const torchMat = new THREE.MeshBasicMaterial({ color: 0xffaa33 });
            [[-halfW, -halfL], [halfW, -halfL], [-halfW, halfL], [halfW, halfL]].forEach(([x, z]) => {
                const base = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), stoneMat);
                base.position.set(x, 0.2, z);
                this.add(base);
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.15), stoneMat);
                post.position.set(x, 0.7, z);
                this.add(post);
                const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), torchMat);
                top.position.set(x, 1.1, z);
                this.add(top);
            });
        }
    }

    updatePortals(dt) {
        if (!this.portalsEnabled || !this.portals?.length) return;
        this.portalTimer += dt;
        this.portals.forEach(p => {
            p.mesh.rotation.z += dt * 2;
            p.core.rotation.y -= dt;
            p.cooldown = Math.max(0, p.cooldown - dt);
        });
    }

    checkPortalCollision(ball) {
        if (!this.portalsEnabled || this.portals?.length !== 2) return false;
        for (let i = 0; i < this.portals.length; i++) {
            const portal = this.portals[i];
            if (portal.cooldown <= 0 && ball.position.distanceTo(portal.pos) < 2.2) {
                const exit = this.portals[1 - i];
                ball.position.copy(exit.pos);
                ball.position.y += 0.8;
                ball.velocity.multiplyScalar(1.08);
                portal.cooldown = 0.8;
                exit.cooldown = 0.8;
                return true;
            }
        }
        return false;
    }

}


