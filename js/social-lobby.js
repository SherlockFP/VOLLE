import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Neon Clubhouse — the single compact Warrball social hub: open lounge,
// conversation pods, pool, creator stage and garden, all visible from spawn.
export const SOCIAL_HUB_MAP_ID = 'plaza';

const PLAZA_BOUNDS = Object.freeze({ minX: -76, maxX: 76, minY: -8, maxY: 32, minZ: -68, maxZ: 68 });
const PLAZA_GROUND_Y = 0;
const POSE_AREA = Object.freeze({ x: 0, z: -25, radius: 7.5 });
// The pavilion sits on the south-to-court route. Its open southern portico is
// deliberate: it reads as a mansion-scale focal point without interrupting the
// plaza's main walking line or requiring a larger social map.
const PLAZA_PAVILION = Object.freeze({ x: 0, z: 15, halfWidth: 27, halfDepth: 22, roofY: 8.2 });

// Swim volumes. surfaceY sits above the 1.7 eye height so Player.getWaterAt
// actually flips into swim mode (surfaceY + .25 >= standing eye height).
const PLAZA_POOLS = Object.freeze([
    Object.freeze({ minX: -59, maxX: -27, minZ: -50, maxZ: -26, surfaceY: 1.55, floorY: -2.8, kind: 'pool' })
]);

export const SOCIAL_HUB_MAPS = Object.freeze({
    plaza: Object.freeze({
        id: SOCIAL_HUB_MAP_ID,
        name: 'Neon Clubhouse',
        bounds: PLAZA_BOUNDS,
        spawn: Object.freeze({ x: 0, y: 2, z: 56 }),
        poseArea: POSE_AREA,
        zones: Object.freeze([
            Object.freeze({ id: 'lobby', name: 'Welcome Deck', x: 0, z: 54 }),
            Object.freeze({ id: 'social', name: 'Club Lounge', x: 0, z: 15 }),
            Object.freeze({ id: 'pool', name: 'Pool Terrace', x: -43, z: -38 }),
            Object.freeze({ id: 'stage', name: 'Creator Stage', x: 23, z: -30 })
        ]),
        credit: 'Original Warrball layout with Kenney Furniture Kit CC0 props'
    })
});

// [centerX, centerZ, halfWidth, halfDepth, topY, zone]
// Every block is solid from y = -2 up to topY and standable on its top face, so
// the same table drives collision, the walkable rooftops, and the mesh pass.
function buildPlazaBlocks() {
    const blocks = [
        // Open-front clubhouse: floor, glass-ready side walls and rear wall.
        [PLAZA_PAVILION.x, PLAZA_PAVILION.z, PLAZA_PAVILION.halfWidth, PLAZA_PAVILION.halfDepth, .35, 'pavilion'],
        [-27, 15, 1, 22, 8, 'pavilion'], [27, 15, 1, 22, 8, 'pavilion'],
        [0, 37, 27, 1, 8, 'pavilion'],
        // Conversation islands, photo stage, pool coping and garden.
        [-14, 13, 9, 7, .58, 'social'], [14, 13, 9, 7, .58, 'social'],
        [23, -30, 13, 7, 1.15, 'stage'], [23, -37, 13, 1, 7.5, 'stage'],
        [-43, -52, 18, 1, .75, 'pool'], [-43, -24, 18, 1, .75, 'pool'],
        [-61, -38, 1, 13, .75, 'pool'], [-25, -38, 1, 13, .75, 'pool'],
        [49, 15, 15, 18, .7, 'garden'],
        [0, 62, 18, 1.2, 5.5, 'lobby']
    ];
    return Object.freeze(blocks.map(entry => Object.freeze(entry)));
}

const PLAZA_BLOCKS = buildPlazaBlocks();

const PLAZA_LAYOUT = Object.freeze({
    blocks: PLAZA_BLOCKS,
    pools: PLAZA_POOLS,
    groundY: PLAZA_GROUND_Y,
    platform: Object.freeze({ x: 0, z: 0, y: PLAZA_GROUND_Y, halfWidth: 74, halfDepth: 66 })
});

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = Object.freeze([
    ['assets/cc0/kenney/furniture-kit/loungeSofa.glb', [-15, .6, 16], 2.2, Math.PI, 2.2],
    ['assets/cc0/kenney/furniture-kit/loungeSofa.glb', [15, .6, 16], 2.2, Math.PI, 2.2],
    ['assets/cc0/kenney/furniture-kit/loungeChair.glb', [-10, .6, 8], 2.1, -.35, 1.6],
    ['assets/cc0/kenney/furniture-kit/loungeChair.glb', [10, .6, 8], 2.1, .35, 1.6],
    ['assets/cc0/kenney/furniture-kit/tableCoffee.glb', [-15, .6, 12], 2.1, 0, 1.3],
    ['assets/cc0/kenney/furniture-kit/tableCoffee.glb', [15, .6, 12], 2.1, 0, 1.3],
    ['assets/cc0/kenney/furniture-kit/rugRound.glb', [0, .36, 22], 4.8, 0, 2.8],
    ['assets/cc0/kenney/furniture-kit/bookcaseOpen.glb', [-23.5, .35, 30], 2.2, Math.PI / 2, 1.8],
    ['assets/cc0/kenney/furniture-kit/speaker.glb', [-6, .35, 34], 2.6, Math.PI, 1.4],
    ['assets/cc0/kenney/furniture-kit/speaker.glb', [6, .35, 34], 2.6, Math.PI, 1.4],
    ['assets/cc0/kenney/furniture-kit/pottedPlant.glb', [-23, .35, 3], 2.7, 0, 1.4],
    ['assets/cc0/kenney/furniture-kit/pottedPlant.glb', [23, .35, 3], 2.7, 0, 1.4],
    ['assets/cc0/kenney/mini-arena/statue.glb', [23, 2.1, -30], 1.7, 0, 2.2],
    ['assets/cc0/kenney/mini-arena/tree.glb', [52, .7, 20], 2.5, .4, 2.2],
    ['assets/cc0/kenney/mini-arena/tree.glb', [44, .7, 4], 2.2, -.5, 2.0]
]);

export const SOCIAL_LOBBY_PROP_COLLIDERS = Object.freeze(PROP_ASSETS.map(([url, position, , , radius]) => Object.freeze({
    url,
    position: Object.freeze({ x: position[0], y: position[1], z: position[2] }),
    radius
})));

export function createSocialColliderGrid(colliders, cellSize = 12, padding = 1) {
    const size = Math.max(1, Number(cellSize) || 12);
    const margin = Math.max(0, Number(padding) || 0);
    const cells = new Map();
    const key = (x, z) => `${x}:${z}`;
    for (const collider of colliders) {
        const center = collider.pos || collider.position;
        const radius = Number(collider.radius) || 0;
        const minX = Number.isFinite(collider.minX) ? collider.minX : center?.x - radius;
        const maxX = Number.isFinite(collider.maxX) ? collider.maxX : center?.x + radius;
        const minZ = Number.isFinite(collider.minZ) ? collider.minZ : center?.z - radius;
        const maxZ = Number.isFinite(collider.maxZ) ? collider.maxZ : center?.z + radius;
        if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
        for (let x = Math.floor((minX - margin) / size); x <= Math.floor((maxX + margin) / size); x++) {
            for (let z = Math.floor((minZ - margin) / size); z <= Math.floor((maxZ + margin) / size); z++) {
                const cellKey = key(x, z);
                const entries = cells.get(cellKey) || [];
                entries.push(collider);
                cells.set(cellKey, entries);
            }
        }
    }
    return {
        cellSize: size,
        query(position) {
            if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return [];
            return cells.get(key(Math.floor(position.x / size), Math.floor(position.z / size))) || [];
        }
    };
}

export function createSocialBoundaryColliders(bounds, thickness = 1.5) {
    const edge = Math.max(.5, Number(thickness) || 1.5);
    const outerMinX = bounds.minX - edge;
    const outerMaxX = bounds.maxX + edge;
    const outerMinZ = bounds.minZ - edge;
    const outerMaxZ = bounds.maxZ + edge;
    return [
        { minX: outerMinX, maxX: bounds.minX, minY: bounds.minY, maxY: bounds.maxY, minZ: outerMinZ, maxZ: outerMaxZ, invisibleBoundary: true },
        { minX: bounds.maxX, maxX: outerMaxX, minY: bounds.minY, maxY: bounds.maxY, minZ: outerMinZ, maxZ: outerMaxZ, invisibleBoundary: true },
        { minX: outerMinX, maxX: outerMaxX, minY: bounds.minY, maxY: bounds.maxY, minZ: outerMinZ, maxZ: bounds.minZ, invisibleBoundary: true },
        { minX: outerMinX, maxX: outerMaxX, minY: bounds.minY, maxY: bounds.maxY, minZ: bounds.maxZ, maxZ: outerMaxZ, invisibleBoundary: true }
    ];
}

function getSocialHubMap() {
    return SOCIAL_HUB_MAPS[SOCIAL_HUB_MAP_ID];
}

function normalizeMapMarker(value, bounds) {
    const position = value?.position || value;
    const normalize = (coordinate, min, max) => Number.isFinite(coordinate)
        ? Math.min(1, Math.max(0, (coordinate - min) / (max - min)))
        : null;
    const x = normalize(position?.x, bounds.minX, bounds.maxX);
    const z = normalize(position?.z, bounds.minZ, bounds.maxZ);
    return x === null || z === null ? null : { x, z };
}

export function getSocialLobbyMapState(player, presence) {
    const map = getSocialHubMap();
    return {
        bounds: map.bounds,
        player: normalizeMapMarker(player, map.bounds),
        visitors: (Array.isArray(presence) ? presence : []).flatMap(visitor => {
            const marker = normalizeMapMarker(visitor, map.bounds);
            return marker ? [{ id: visitor.id ?? null, name: visitor.name ?? null, local: Boolean(visitor.local), ...marker }] : [];
        })
    };
}

export function createSocialLobbyArena() {
    const map = getSocialHubMap();
    const layout = PLAZA_LAYOUT;
    const boundaries = createSocialBoundaryColliders(map.bounds);
    const blocks = layout.blocks.map(([x, z, halfWidth, halfDepth, topY, zone]) => ({
        minX: x - halfWidth, maxX: x + halfWidth, minY: -2, maxY: topY, minZ: z - halfDepth, maxZ: z + halfDepth, zone
    }));
    const props = SOCIAL_LOBBY_PROP_COLLIDERS.map(({ position, radius }) => ({ pos: position, radius, zone: 'decor' }));
    const collidables = [...boundaries, ...blocks, ...props];
    const grid = createSocialColliderGrid(collidables, 22);
    // Highest-first so a fast fall through several decks lands on the top one;
    // the ground shelf stays last as the fallback.
    const platforms = layout.blocks
        .map(([x, z, halfWidth, halfDepth, topY]) => ({ x, z, y: topY, halfWidth, halfDepth }))
        .sort((a, b) => b.y - a.y);
    platforms.push({ ...layout.platform });
    return {
        bounds: map.bounds,
        ceilingHeight: map.bounds.maxY,
        config: { name: `Warrball Social Hub - ${map.name}`, zones: map.zones, lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables,
        getNearbyCollidables: position => grid.query(position),
        platforms,
        jumpPads: [],
        getWaterAt(position) {
            if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null;
            const pool = layout.pools.find(entry => position.x >= entry.minX && position.x <= entry.maxX && position.z >= entry.minZ && position.z <= entry.maxZ);
            return pool ? { kind: pool.kind || 'pool', surfaceY: pool.surfaceY, floorY: pool.floorY } : null;
        },
        getHazardAt: () => null,
        getPlayerSpawn: () => new THREE.Vector3(map.spawn.x, map.spawn.y, map.spawn.z)
    };
}

function setMeshShadows(root, cast = true) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = cast;
        child.receiveShadow = true;
        child.frustumCulled = true;
    });
}

function tuneHubMaterials(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const entry of materials) {
            if (!entry) continue;
            if (entry.map) entry.map.colorSpace = THREE.SRGBColorSpace;
            if (entry.emissiveMap) entry.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            if (entry.transparent) entry.depthWrite = false;
            entry.roughness = Math.max(.58, Number(entry.roughness) || 0);
        }
    });
}

function createProceduralTexture(renderer, kind, colors, repeatX = 8, repeatY = 8) {
    if (typeof document === 'undefined' || !THREE.CanvasTexture) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = colors[0];
    context.fillRect(0, 0, 256, 256);
    if (kind === 'marble') {
        for (let i = 0; i < 22; i++) {
            context.strokeStyle = `${colors[1]}${(30 + i % 5 * 12).toString(16).padStart(2, '0')}`;
            context.lineWidth = 1 + i % 3;
            context.beginPath();
            for (let x = -20; x <= 276; x += 12) {
                const y = (i * 31 + x * .22 + Math.sin(x * .055 + i) * 17) % 276 - 10;
                x === -20 ? context.moveTo(x, y) : context.lineTo(x, y);
            }
            context.stroke();
        }
    } else if (kind === 'wood') {
        for (let y = 0; y < 256; y += 32) {
            context.fillStyle = y % 64 ? colors[1] : colors[0];
            context.fillRect(0, y, 256, 30);
            context.strokeStyle = colors[2];
            context.strokeRect(0, y, 256, 31);
            for (let x = 0; x < 256; x += 64) context.fillRect(x + (y % 64), y + 8, 2, 14);
        }
    } else {
        for (let i = 0; i < 900; i++) {
            const x = (i * 73) % 256;
            const y = (i * 151) % 256;
            context.fillStyle = colors[1 + i % (colors.length - 1)];
            context.fillRect(x, y, kind === 'lawn' ? 2 : 5, kind === 'lawn' ? 5 : 2);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 4);
    return texture;
}

function createPlazaMaterials(renderer) {
    const textured = (color, map, roughness = .72, metalness = .03) => new THREE.MeshStandardMaterial({ color, map, roughness, metalness });
    return {
        lawn: textured(0xa8c493, createProceduralTexture(renderer, 'lawn', ['#6f9a67', '#9dbd80', '#587f57'], 34, 34), .92),
        marble: textured(0xf3ecdd, createProceduralTexture(renderer, 'marble', ['#efe6d6', '#6c8ba0'], 8, 8), .42),
        stone: textured(0x8b98a2, createProceduralTexture(renderer, 'stone', ['#6a757c', '#8f9aa1', '#57646b'], 14, 14), .82),
        wood: textured(0x8a5a34, createProceduralTexture(renderer, 'wood', ['#77482c', '#8e5c3c', '#4f2c1d'], 6, 6), .68),
        stucco: textured(0xeadcc5, createProceduralTexture(renderer, 'stone', ['#ddd0b8', '#f0e6d6', '#c9b99e'], 12, 6), .85),
        roof: textured(0x2f4254, createProceduralTexture(renderer, 'stone', ['#233542', '#3d5364', '#1b2833'], 16, 8), .7),
        // The Pavilion is viewed from below as well as across the plaza. A lighter,
        // double-sided roof avoids an unlit black underside in its open interior.
        pavilionRoof: new THREE.MeshStandardMaterial({ color: 0x7895a6, emissive: 0x102a38, emissiveIntensity: .18, roughness: .46, metalness: .14, side: THREE.DoubleSide }),
        trim: new THREE.MeshStandardMaterial({ color: 0xfff5e6, roughness: .5 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xc79a4e, roughness: .26, metalness: .84 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0x9fe2f4, roughness: .1, metalness: .08, transparent: true, opacity: .5, depthWrite: false }),
        water: new THREE.MeshPhysicalMaterial({ color: 0x3fc9e8, roughness: .14, metalness: .05, transparent: true, opacity: .76, depthWrite: false }),
        hedge: new THREE.MeshStandardMaterial({ color: 0x2c5c40, roughness: .95 }),
        accent: new THREE.MeshStandardMaterial({ color: 0x0d2530, emissive: 0x35e8d6, emissiveIntensity: 1.6, roughness: .34 }),
        lantern: new THREE.MeshStandardMaterial({ color: 0x2a1608, emissive: 0xffb347, emissiveIntensity: 2.2, roughness: .4 }),
        aurora: new THREE.MeshStandardMaterial({ color: 0x180b2c, emissive: 0xb46bff, emissiveIntensity: 1.9, roughness: .35 })
    };
}

const ZONE_MATERIAL = Object.freeze({
    lobby: 'stucco',
    social: 'marble',
    pool: 'stone',
    stage: 'wood',
    activity: 'stone',
    shop: 'wood',
    observatory: 'stucco',
    pavilion: 'stucco',
    garden: 'hedge',
    perimeter: 'stone'
});

function addBox(group, size, position, material, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.rotation.y = options.rotationY || 0;
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

function addCylinder(group, radius, height, position, material, segments = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

// One mesh per collision block keeps what players see identical to what they hit.
function addBlockMeshes(group, materials) {
    for (const [x, z, halfWidth, halfDepth, topY, zone] of PLAZA_BLOCKS) {
        const material = materials[ZONE_MATERIAL[zone] || 'stone'];
        addBox(group, [halfWidth * 2, topY + 2, halfDepth * 2], [x, (topY - 2) / 2, z], material, { castShadow: topY > 1.6 });
        if (topY >= 4) addBox(group, [halfWidth * 2 + .6, .35, halfDepth * 2 + .6], [x, topY + .1, z], materials.trim, { castShadow: false });
    }
}

function addLamp(group, materials, x, z, height = 7, material = materials.lantern) {
    addCylinder(group, .38, height, [x, height / 2, z], materials.metal, 12);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.9, 14, 10), material);
    bulb.position.set(x, height + .5, z);
    group.add(bulb);
    return bulb;
}

function addWaterPlanes(group, materials, sink) {
    for (const pool of PLAZA_POOLS) {
        const water = new THREE.Mesh(new THREE.PlaneGeometry(pool.maxX - pool.minX, pool.maxZ - pool.minZ), materials.water);
        water.rotation.x = -Math.PI / 2;
        water.position.set((pool.minX + pool.maxX) / 2, pool.surfaceY, (pool.minZ + pool.maxZ) / 2);
        water.userData.waterBaseY = water.position.y;
        group.add(water);
        sink.push(water);
        addBox(group, [pool.maxX - pool.minX + 2, .6, pool.maxZ - pool.minZ + 2], [(pool.minX + pool.maxX) / 2, pool.floorY, (pool.minZ + pool.maxZ) / 2], materials.stone, { castShadow: false });
    }
}

function addGrandPavilion(group, materials) {
    const { x, z, halfWidth, halfDepth, roofY } = PLAZA_PAVILION;
    addBox(group, [halfWidth * 2 + 2, .36, halfDepth * 2 + 2], [x, roofY, z], materials.pavilionRoof);
    addBox(group, [halfWidth * 2 - 2, .42, 2.2], [x, roofY - .5, z - halfDepth + 2], materials.aurora, { castShadow: false });
    for (const side of [-1, 1]) {
        for (const offset of [-14, 0, 14]) {
            addCylinder(group, .75, roofY, [x + side * (halfWidth - .5), roofY / 2, z + offset], materials.marble, 14);
        }
        addBox(group, [.28, roofY - 1.2, 9], [x + side * (halfWidth - .8), roofY / 2, z], materials.glass, { castShadow: false });
    }
    for (const px of [-18, 18]) {
        addCylinder(group, .82, roofY, [x + px, roofY / 2, z - halfDepth + .4], materials.marble, 14);
    }
    addBox(group, [18, .4, 2.5], [x, .3, z - halfDepth - 1.2], materials.stone, { castShadow: false });
    addPavilionLounge(group, materials);
}

function addPavilionLounge(group, materials) {
    const lounge = new THREE.Group();
    lounge.name = 'neon-clubhouse-lounge';
    group.add(lounge);
    addBox(lounge, [8, 2, 1], [0, 1.6, 34], materials.stone);
    addBox(lounge, [6.8, 1.1, .3], [0, 2.7, 33.45], materials.aurora, { castShadow: false });
    const sculpture = new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 1), materials.aurora);
    sculpture.name = 'pavilion-aurora-sculpture';
    sculpture.position.set(0, 4.6, 33.2);
    sculpture.castShadow = true;
    sculpture.receiveShadow = true;
    lounge.add(sculpture);
    for (const side of [-1, 1]) {
        const light = new THREE.PointLight(0xffb86a, 1.45, 25, 2);
        light.name = 'pavilion-warm-lounge-light';
        light.position.set(side * 14, 6.5, 16);
        lounge.add(light);
    }
}

function createNameplate(name) {
    if (typeof document === 'undefined' || !THREE.Sprite || !THREE.CanvasTexture) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.font = '700 26px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(3, 18, 30, .76)';
    context.roundRect?.(14, 10, 228, 44, 16);
    context.fill();
    context.fillStyle = '#eaffff';
    context.fillText(String(name).slice(0, 24), 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(2.8, .7, 1);
    sprite.position.set(0, 3.7, 0);
    return sprite;
}

function disposeObjectResources(...roots) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    for (const root of roots) {
        root?.traverse?.(child => {
            if (child.geometry) geometries.add(child.geometry);
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
                if (!material) continue;
                materials.add(material);
                for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
            }
        });
    }
    textures.forEach(texture => texture.dispose?.());
    materials.forEach(material => material.dispose?.());
    geometries.forEach(geometry => geometry.dispose?.());
}

export class SocialLobby {
    constructor(renderer, player, options = {}) {
        this.renderer = renderer;
        this.scene = renderer?.scene;
        this.player = player;
        this.onAssetProgress = options.onAssetProgress || null;
        this.onPoseArea = options.onPoseArea || null;
        this.drivePlayer = options.drivePlayer !== false;
        this.onPresence = options.onPresence || (() => {});
        this.root = new THREE.Group();
        this.root.name = 'social-lobby';
        this.root.visible = false;
        this.active = false;
        this.mapId = SOCIAL_HUB_MAP_ID;
        this.arena = createSocialLobbyArena();
        this.arenas = { [SOCIAL_HUB_MAP_ID]: this.arena };
        this.mixers = [];
        this.visitors = new Map();
        this.characterTemplates = [];
        this._savedArena = null;
        this._elapsed = 0;
        this._presenceDirty = true;
        this._insidePoseArea = false;
        this._disposed = false;
        this._waterMeshes = [];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        this._mapBlocks = Object.freeze(this.arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary));
        this._buildPlazaWorld();
        this.scene?.add(this.root);
        this._assetLoadPromise = null;
        this.ready = Promise.resolve();
    }

    _buildPlazaWorld() {
        const world = new THREE.Group();
        world.name = 'warrball-neon-clubhouse';
        world.visible = true;
        const materials = createPlazaMaterials(this.renderer?.renderer);
        this._hubMaterials = materials;

        addBox(world, [152, 2, 136], [0, -1, 0], materials.lawn, { castShadow: false });
        addBox(world, [58, .32, 118], [0, .16, 7], materials.marble, { castShadow: false });
        const court = new THREE.Mesh(new THREE.CircleGeometry(30, 40), materials.marble);
        court.rotation.x = -Math.PI / 2;
        court.position.set(0, .22, -25);
        court.receiveShadow = true;
        world.add(court);

        addBlockMeshes(world, materials);
        addWaterPlanes(world, materials, this._waterMeshes);
        addGrandPavilion(world, materials);

        const posePad = addCylinder(world, POSE_AREA.radius, .42, [POSE_AREA.x, .3, POSE_AREA.z], materials.accent, 40);
        posePad.userData.poseArea = true;
        for (const [x, z] of [[-25, 42], [25, 42], [-68, 0], [68, 0], [-20, -58], [20, -58]]) {
            addLamp(world, materials, x, z, 7.5, materials.aurora);
        }
        for (const [x, z] of [[-43, -58], [-64, -18], [47, 42], [61, 26], [55, 0]]) {
            addCylinder(world, 1.1, 6, [x, 3, z], materials.wood, 10);
            const canopy = new THREE.Mesh(new THREE.SphereGeometry(4.8, 12, 9), materials.hedge);
            canopy.position.set(x, 8, z);
            canopy.castShadow = true;
            world.add(canopy);
        }

        const sky = new THREE.Mesh(new THREE.SphereGeometry(210, 32, 24), new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: { sunDirection: { value: new THREE.Vector3(-.42, .68, -.6).normalize() } },
            vertexShader: 'varying vec3 vDir; void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
            fragmentShader: 'varying vec3 vDir;uniform vec3 sunDirection;void main(){float h=clamp(vDir.y*.7+.34,0.,1.);vec3 c=mix(vec3(.98,.78,.62),vec3(.09,.24,.52),h);float band=pow(max(0.,sin(vDir.x*5.0+vDir.y*9.0)),6.0)*smoothstep(.12,.62,vDir.y);c+=vec3(.22,.68,.55)*band;float s=pow(max(dot(vDir,sunDirection),0.),300.);c+=vec3(1.,.82,.5)*s;gl_FragColor=vec4(c,1.);}'
        }));
        world.add(sky);
        // The main renderer already contributes sun + ambient bounce. Keep
        // hub-local lights deliberately low so the two rigs do not wash the
        // marble and foliage into one flat highlight when shadows are off.
        const sun = new THREE.DirectionalLight(0xffeccd, 0.7);
        sun.position.set(-45, 80, -38);
        sun.castShadow = true;
        world.add(sun, new THREE.HemisphereLight(0xbfeeff, 0x3f5a48, 0.32));
        this.root.add(world);
        this.mapWorlds = { [SOCIAL_HUB_MAP_ID]: world };
        this.plazaWorld = world;
    }

    async _loadAssets() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const total = CHARACTER_ASSETS.length + PROP_ASSETS.length;
        let loaded = 0;
        const complete = value => {
            loaded++;
            this.onAssetProgress?.({ loaded, total, progress: loaded / total });
            return value;
        };
        const characterJobs = CHARACTER_ASSETS.map((url, index) => loader.loadAsync(url)
            .then(gltf => this._installCharacter(gltf, index)).catch(() => null).then(complete));
        const propJobs = PROP_ASSETS.map(([url, position, scale, rotationY]) => loader.loadAsync(url).then(gltf => {
            if (this._disposed) return;
            const model = gltf.scene;
            model.position.set(...position);
            model.scale.setScalar(scale);
            model.rotation.y = rotationY;
            tuneHubMaterials(model);
            this.plazaWorld.add(model);
        }).catch(() => null).then(complete));
        await Promise.allSettled([...characterJobs, ...propJobs]);
        return this;
    }

    loadAssets() {
        if (!this._assetLoadPromise) this._assetLoadPromise = this._loadAssets();
        this.ready = this._assetLoadPromise;
        return this._assetLoadPromise;
    }

    selectMap() {
        const map = getSocialHubMap();
        this.mapId = map.id;
        if (this.player && this.active) this.player.arena = this.arena;
        this._presenceDirty = true;
        return map;
    }

    _installCharacter(gltf, index) {
        if (this._disposed) return;
        const model = gltf.scene;
        model.scale.setScalar(1.15);
        model.rotation.y = index % 2 ? Math.PI : 0;
        setMeshShadows(model);
        this.characterTemplates[index] = { scene: model, animations: gltf.animations || [] };
    }

    enter(spawn) {
        if (this._disposed || this.active) return false;
        const map = this.selectMap();
        this.active = true;
        this.root.visible = true;
        this._savedArena = this.player?.arena || null;
        if (this.player) {
            this.player.arena = this.arena;
            const target = spawn?.isVector3 ? spawn : new THREE.Vector3(spawn?.x ?? map.spawn.x, spawn?.y ?? map.spawn.y, spawn?.z ?? map.spawn.z);
            this.player.position.copy(target);
            this.player.velocity?.set(0, 0, 0);
            this.player.verticalVel = 0;
            this.player.onGround = true;
            this.player.alive = true;
            this.player.camera?.position.copy(this.player.position);
        }
        this._presenceDirty = true;
        this._emitPresence();
        return true;
    }

    exit() {
        if (!this.active) return false;
        this.active = false;
        this.root.visible = false;
        if (this.player && this._savedArena) this.player.arena = this._savedArena;
        this._savedArena = null;
        return true;
    }

    update(dt = 0) {
        if (!this.active || this._disposed) return;
        const step = Math.min(Math.max(Number(dt) || 0, 0), .1);
        this._elapsed += step;
        if (this.drivePlayer) this.player?.update?.(step);
        for (const mixer of this.mixers) mixer.update(step);
        const position = this.player?.getPosition?.();
        if (position) {
            const inside = Math.hypot(position.x - POSE_AREA.x, position.z - POSE_AREA.z) < POSE_AREA.radius;
            if (inside !== this._insidePoseArea) this.onPoseArea?.(inside);
            this._insidePoseArea = inside;
        }
        for (let i = 0; i < this._waterMeshes.length; i++) {
            const water = this._waterMeshes[i];
            water.position.y = (water.userData.waterBaseY ?? .24) + Math.sin(this._elapsed * 1.4 + i) * .025;
        }
        if (this._spire) {
            this._spire.halo.rotation.z = this._elapsed * .35;
            this._spire.crown.rotation.y = this._elapsed * .5;
            this._spire.crown.position.y = 66 + Math.sin(this._elapsed * .9) * .7;
        }
        if (this._presenceDirty) this._emitPresence();
    }

    interact() { return false; }

    setRemoteVisitor(id, state = {}) {
        if (!id) return null;
        const key = `remote-${id}`;
        let visitor = this.visitors.get(key);
        if (!visitor) {
            const group = new THREE.Group();
            group.name = key;
            const template = this.characterTemplates[Math.abs(Number(state.modelIndex) || 0) % Math.max(1, this.characterTemplates.length)];
            if (template?.scene) {
                const sharedModel = template.scene.clone(true);
                group.add(sharedModel);
                visitor = { group, mixer: null, local: false, sharedModel };
            } else {
                addBox(group, [1.2, 1.8, .8], [0, 1.4, 0], this._hubMaterials.accent.clone());
                addBox(group, [1, 1, 1], [0, 2.75, 0], this._hubMaterials.marble.clone());
                visitor = { group, mixer: null, local: false, sharedModel: null };
            }
            group.userData.displayName = String(state.name || id).slice(0, 24);
            const nameplate = createNameplate(group.userData.displayName);
            if (nameplate) group.add(nameplate);
            this.root.add(group);
            this.visitors.set(key, visitor);
            this._presenceDirty = true;
        }
        const position = state.position || state;
        if (Number.isFinite(position.x)) visitor.group.position.x = position.x;
        if (Number.isFinite(position.y)) visitor.group.position.y = position.y - (this.player?.height || 1.7);
        if (Number.isFinite(position.z)) visitor.group.position.z = position.z;
        if (Number.isFinite(state.rotationY)) visitor.group.rotation.y = state.rotationY;
        return visitor.group;
    }

    removeRemoteVisitor(id) {
        const key = `remote-${id}`;
        const visitor = this.visitors.get(key);
        if (!visitor) return false;
        this.root.remove(visitor.group);
        if (visitor.sharedModel) visitor.group.remove(visitor.sharedModel);
        disposeObjectResources(visitor.group);
        this.visitors.delete(key);
        this._presenceDirty = true;
        return true;
    }

    getPresence() {
        return [...this.visitors.entries()].map(([id, visitor]) => ({
            id: id.replace(/^remote-/, ''), local: visitor.local, name: visitor.group.userData.displayName || null,
            position: { x: visitor.group.position.x, y: visitor.group.position.y, z: visitor.group.position.z }
        }));
    }

    getMapBlocks() { return this._mapBlocks; }

    _emitPresence() {
        this._presenceDirty = false;
        this.onPresence(this.getPresence());
    }

    dispose() {
        if (this._disposed) return;
        this.exit();
        this._disposed = true;
        this.scene?.remove(this.root);
        disposeObjectResources(this.root, ...this.characterTemplates.map(template => template?.scene));
        this.root.clear();
        this.visitors.clear();
        this.mixers.length = 0;
        this.characterTemplates.length = 0;
        this._waterMeshes.length = 0;
        this._spire = null;
    }
}
