import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ESTATE_BOUNDS = Object.freeze({ minX: -180, maxX: 180, minY: -8, maxY: 80, minZ: -160, maxZ: 160 });
const ESTATE_GROUND_Y = 0;
const POSE_AREA = Object.freeze({ x: 0, z: 34, radius: 9 });
const ESTATE_POOLS = Object.freeze([
    Object.freeze({ minX: -105, maxX: -59, minZ: 72, maxZ: 98, surfaceY: 1.65, floorY: -3.2 }),
    Object.freeze({ minX: 59, maxX: 105, minZ: 72, maxZ: 98, surfaceY: 1.65, floorY: -3.2 })
]);

export const SOCIAL_HUB_MAPS = Object.freeze({
    estate: Object.freeze({
        id: 'estate',
        name: 'Grand Estate',
        bounds: ESTATE_BOUNDS,
        spawn: Object.freeze({ x: 0, y: 2, z: 126 }),
        credit: 'Original Warrball procedural environment'
    })
});

// [centerX, centerZ, halfWidth, halfDepth, maxY, zone]
const SOCIAL_MAP_BLOCKS = Object.freeze([
    [0, -128, 61, 1.25, 18, 'main-manor'],
    [-60, -96, 1.25, 33, 18, 'main-manor'], [60, -96, 1.25, 33, 18, 'main-manor'],
    [-43, -63, 18, 1.25, 18, 'main-manor'], [43, -63, 18, 1.25, 18, 'main-manor'],
    [-42, -96, 16, .8, 8, 'main-interior'], [42, -96, 16, .8, 8, 'main-interior'],
    [-28, -113, .8, 14, 8, 'main-interior'], [28, -113, .8, 14, 8, 'main-interior'],
    [-108, -30, 26, 1, 9, 'west-house'], [-134, 0, 1, 31, 9, 'west-house'], [-82, 0, 1, 31, 9, 'west-house'],
    [-125, 30, 8, 1, 9, 'west-house'], [-91, 30, 8, 1, 9, 'west-house'],
    [108, -30, 26, 1, 9, 'east-house'], [134, 0, 1, 31, 9, 'east-house'], [82, 0, 1, 31, 9, 'east-house'],
    [91, 30, 8, 1, 9, 'east-house'], [125, 30, 8, 1, 9, 'east-house']
]);

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = Object.freeze([
    ['assets/cc0/kenney/mini-arena/statue.glb', [-31, 1.4, 34], 1.45, .25, 2.1],
    ['assets/cc0/kenney/mini-arena/statue.glb', [31, 1.4, 34], 1.45, -.25, 2.1],
    ['assets/cc0/kenney/mini-arena/trophy.glb', [0, 2.25, 11], 1.35, 0, 1.7],
    ['assets/cc0/kenney/mini-arena/banner.glb', [-19, 0, -61], 2.1, 0, 1.1],
    ['assets/cc0/kenney/mini-arena/banner.glb', [19, 0, -61], 2.1, Math.PI, 1.1],
    ['assets/cc0/kenney/mini-arena/tree.glb', [-145, 0, 78], 3, .4, 2.4],
    ['assets/cc0/kenney/mini-arena/tree.glb', [145, 0, 78], 3, -.4, 2.4]
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

function getSocialHubMap(mapId = 'estate') {
    return SOCIAL_HUB_MAPS[String(mapId).toLowerCase()] || SOCIAL_HUB_MAPS.estate;
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

export function getSocialLobbyMapState(player, presence, mapId = 'estate') {
    const map = getSocialHubMap(mapId);
    return {
        bounds: map.bounds,
        player: normalizeMapMarker(player, map.bounds),
        visitors: (Array.isArray(presence) ? presence : []).flatMap(visitor => {
            const marker = normalizeMapMarker(visitor, map.bounds);
            return marker ? [{ id: visitor.id ?? null, name: visitor.name ?? null, local: Boolean(visitor.local), ...marker }] : [];
        })
    };
}

export function createSocialLobbyArena(mapId = 'estate') {
    const map = getSocialHubMap(mapId);
    const boundaries = createSocialBoundaryColliders(map.bounds);
    const blocks = SOCIAL_MAP_BLOCKS.map(([x, z, halfWidth, halfDepth, maxY, zone]) => ({
        minX: x - halfWidth, maxX: x + halfWidth, minY: -2, maxY, minZ: z - halfDepth, maxZ: z + halfDepth, zone
    }));
    const props = SOCIAL_LOBBY_PROP_COLLIDERS.map(({ position, radius }) => ({ pos: position, radius, zone: 'decor' }));
    const collidables = [...boundaries, ...blocks, ...props];
    const grid = createSocialColliderGrid(collidables, 22);
    return {
        bounds: map.bounds,
        ceilingHeight: map.bounds.maxY,
        config: { name: `Warrball Social Hub - ${map.name}`, lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables,
        getNearbyCollidables: position => grid.query(position),
        platforms: [{ x: 0, z: 0, y: ESTATE_GROUND_Y, halfWidth: 174, halfDepth: 154 }],
        jumpPads: [],
        getWaterAt(position) {
            if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null;
            const pool = ESTATE_POOLS.find(entry => position.x >= entry.minX && position.x <= entry.maxX && position.z >= entry.minZ && position.z <= entry.maxZ);
            return pool ? { kind: 'pool', surfaceY: pool.surfaceY, floorY: pool.floorY } : null;
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

function createEstateMaterials(renderer) {
    const textured = (color, map, roughness = .72, metalness = .03) => new THREE.MeshStandardMaterial({ color, map, roughness, metalness });
    return {
        lawn: textured(0xb4c89c, createProceduralTexture(renderer, 'lawn', ['#789d68', '#9fbd83', '#5e865b'], 30, 30), .92),
        marble: textured(0xf5eee2, createProceduralTexture(renderer, 'marble', ['#eee5d8', '#6f8795'], 6, 6), .43),
        stone: textured(0x87939a, createProceduralTexture(renderer, 'stone', ['#69747a', '#8e999f', '#56636a'], 12, 12), .82),
        wood: textured(0x7c4b32, createProceduralTexture(renderer, 'wood', ['#6d412b', '#85543a', '#4a291d'], 5, 5), .68),
        stucco: textured(0xe7ddd0, createProceduralTexture(renderer, 'stone', ['#d9cec0', '#ede5da', '#c8bbab'], 10, 5), .85),
        roof: textured(0x34434c, createProceduralTexture(renderer, 'stone', ['#27363e', '#43535b', '#1f2b31'], 15, 7), .7),
        trim: new THREE.MeshStandardMaterial({ color: 0xf8f3e9, roughness: .52 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xa98348, roughness: .28, metalness: .82 }),
        glass: new THREE.MeshPhysicalMaterial({ color: 0x9edcf1, roughness: .12, metalness: .08, transparent: true, opacity: .55, depthWrite: false }),
        water: new THREE.MeshPhysicalMaterial({ color: 0x55cfe4, roughness: .16, metalness: .05, transparent: true, opacity: .78, depthWrite: false }),
        hedge: new THREE.MeshStandardMaterial({ color: 0x315f43, roughness: .95 }),
        accent: new THREE.MeshStandardMaterial({ color: 0x27c7bd, emissive: 0x0c5b57, emissiveIntensity: .42, roughness: .35 })
    };
}

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

function addMansionShell(group, materials, centerX, centerZ, width, depth, height, main = false) {
    const frontZ = centerZ + depth / 2;
    const backZ = centerZ - depth / 2;
    const doorHalf = main ? 24 : 9;
    const sideWidth = (width / 2 - doorHalf) / 2;
    addBox(group, [width, .35, depth], [centerX, .18, centerZ], materials.wood, { castShadow: false });
    addBox(group, [width, height, 2], [centerX, height / 2, backZ], materials.stucco);
    addBox(group, [2, height, depth], [centerX - width / 2, height / 2, centerZ], materials.stucco);
    addBox(group, [2, height, depth], [centerX + width / 2, height / 2, centerZ], materials.stucco);
    addBox(group, [sideWidth * 2, height, 2], [centerX - doorHalf - sideWidth, height / 2, frontZ], materials.stucco);
    addBox(group, [sideWidth * 2, height, 2], [centerX + doorHalf + sideWidth, height / 2, frontZ], materials.stucco);
    addBox(group, [width + 5, .65, depth + 5], [centerX, height + .3, centerZ], materials.roof);
    for (const x of [centerX - width * .32, centerX, centerX + width * .32]) {
        addBox(group, [8, 3.1, .18], [x, height * .6, backZ - 1.08], materials.glass, { castShadow: false });
    }
    for (const x of [centerX - doorHalf, centerX + doorHalf]) addCylinder(group, .75, height + 1.2, [x, (height + 1.2) / 2, frontZ + 1.5], materials.marble, 24);
    const table = addCylinder(group, main ? 4.5 : 3, 1.1, [centerX, .55, centerZ], materials.marble, 28);
    table.castShadow = false;
    for (const offset of [-1, 1]) addBox(group, [main ? 13 : 8, 1.25, 2.6], [centerX + offset * (main ? 14 : 9), .65, centerZ + 8], materials.accent, { rotationY: offset * .18 });
}

function addPool(group, materials, centerX, centerZ) {
    addBox(group, [52, .35, 32], [centerX, .06, centerZ], materials.marble, { castShadow: false });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(46, 26), materials.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(centerX, .24, centerZ);
    water.userData.estateWater = true;
    group.add(water);
    for (const x of [-19, -9, 1, 11, 21]) addBox(group, [1.4, .08, 25], [centerX + x, .29, centerZ], materials.glass, { castShadow: false });
}

function addStatue(group, materials, x, z, scale = 1) {
    addBox(group, [6 * scale, 2 * scale, 6 * scale], [x, scale, z], materials.marble);
    addCylinder(group, 1.25 * scale, 4 * scale, [x, 4 * scale, z], materials.stone, 24);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5 * scale, 18, 14), materials.stone);
    head.position.set(x, 7 * scale, z);
    head.castShadow = true;
    group.add(head);
    for (const side of [-1, 1]) addBox(group, [3.6 * scale, .65 * scale, .8 * scale], [x + side * 2 * scale, 4.8 * scale, z], materials.metal, { rotationY: side * .32 });
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
        this.mapId = 'estate';
        this.arenas = { estate: createSocialLobbyArena('estate') };
        this.arena = this.arenas.estate;
        this.mixers = [];
        this.visitors = new Map();
        this.characterTemplates = [];
        this._savedArena = null;
        this._elapsed = 0;
        this._presenceDirty = true;
        this._insidePoseArea = false;
        this._disposed = false;
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        this._mapBlocks = Object.freeze(this.arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary));
        this._buildEstateWorld();
        this.scene?.add(this.root);
        this._assetLoadPromise = null;
        this.ready = Promise.resolve();
    }

    _buildEstateWorld() {
        this.estateWorld = new THREE.Group();
        this.estateWorld.name = 'warrball-grand-estate';
        this.estateWorld.visible = true;
        const materials = createEstateMaterials(this.renderer?.renderer);
        this._estateMaterials = materials;
        addBox(this.estateWorld, [360, 2, 320], [0, -1, 0], materials.lawn, { castShadow: false });
        addBox(this.estateWorld, [34, .22, 238], [0, .12, 22], materials.marble, { castShadow: false });
        addBox(this.estateWorld, [210, .22, 24], [0, .13, 36], materials.marble, { castShadow: false });
        const plaza = new THREE.Mesh(new THREE.CircleGeometry(42, 48), materials.marble);
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = .18;
        plaza.receiveShadow = true;
        this.estateWorld.add(plaza);

        addMansionShell(this.estateWorld, materials, 0, -95.5, 120, 65, 14, true);
        addMansionShell(this.estateWorld, materials, -108, 0, 52, 60, 8, false);
        addMansionShell(this.estateWorld, materials, 108, 0, 52, 60, 8, false);
        addPool(this.estateWorld, materials, -82, 85);
        addPool(this.estateWorld, materials, 82, 85);

        const fountain = new THREE.Group();
        addCylinder(fountain, 10, 1.3, [0, .65, 11], materials.stone, 36);
        addCylinder(fountain, 7.8, .24, [0, 1.32, 11], materials.water, 36);
        addCylinder(fountain, 1.35, 6, [0, 4, 11], materials.marble, 24);
        const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8, 20, 14), materials.metal);
        crown.position.set(0, 7.4, 11);
        crown.castShadow = true;
        fountain.add(crown);
        this.estateWorld.add(fountain);

        addStatue(this.estateWorld, materials, -31, 34, 1.05);
        addStatue(this.estateWorld, materials, 31, 34, 1.05);
        const posePad = addCylinder(this.estateWorld, POSE_AREA.radius, .42, [POSE_AREA.x, .26, POSE_AREA.z], materials.accent, 36);
        posePad.userData.poseArea = true;

        for (const [x, z, w, d] of [[-151,-72,10,120],[151,-72,10,120],[-151,82,10,74],[151,82,10,74],[-52,137,70,8],[52,137,70,8]]) {
            addBox(this.estateWorld, [w, 3.6, d], [x, 1.8, z], materials.hedge, { castShadow: false });
        }
        for (const [x, z] of [[-46,56],[46,56],[-122,84],[122,84],[-37,122],[37,122],[-70,-49],[70,-49]]) {
            addCylinder(this.estateWorld, .42, 5.5, [x, 2.75, z], materials.metal, 14);
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(.8, 14, 10), materials.accent);
            lamp.position.set(x, 5.8, z);
            this.estateWorld.add(lamp);
        }

        const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 32, 24), new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: { sunDirection: { value: new THREE.Vector3(-.48, .77, -.35).normalize() } },
            vertexShader: 'varying vec3 vDir; void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
            fragmentShader: 'varying vec3 vDir;uniform vec3 sunDirection;void main(){float h=clamp(vDir.y*.72+.38,0.,1.);vec3 c=mix(vec3(.58,.83,.92),vec3(.08,.25,.48),h);float s=pow(max(dot(vDir,sunDirection),0.),320.);c+=vec3(1.,.78,.42)*s;gl_FragColor=vec4(c,1.);}'
        }));
        this.estateWorld.add(sky);
        const sun = new THREE.DirectionalLight(0xffefd0, 2.35);
        sun.position.set(-90, 130, -70);
        sun.castShadow = true;
        this.estateWorld.add(sun, new THREE.HemisphereLight(0xc9f3ff, 0x3d563d, 1.25));
        this.root.add(this.estateWorld);
        this.mapWorlds = { estate: this.estateWorld };
        this._waterMeshes = [];
        this.estateWorld.traverse(child => { if (child.userData?.estateWater) this._waterMeshes.push(child); });
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
            this.estateWorld.add(model);
        }).catch(() => null).then(complete));
        const mapJobs = Object.values(SOCIAL_HUB_MAPS).filter(map => map.asset).map(map => loader.loadAsync(map.asset)
            .then(gltf => this._installHubMap(map, gltf.scene)).catch(() => null));
        await Promise.allSettled([...characterJobs, ...propJobs, ...mapJobs]);
        return this;
    }

    loadAssets() {
        if (!this._assetLoadPromise) this._assetLoadPromise = this._loadAssets();
        this.ready = this._assetLoadPromise;
        return this._assetLoadPromise;
    }

    selectMap(mapId = 'estate') {
        const map = getSocialHubMap(mapId);
        this.mapId = map.id;
        this.arena = this.arenas[map.id];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        this._mapBlocks = Object.freeze(this.arena.collidables.filter(collider => Number.isFinite(collider.minX) && !collider.invisibleBoundary));
        if (this.player && this.active) this.player.arena = this.arena;
        Object.entries(this.mapWorlds || {}).forEach(([id, world]) => { world.visible = id === map.id; });
        this._presenceDirty = true;
        return map;
    }

    _installHubMap(map, model) {
        if (this._disposed || !map?.asset || !model) return;
        model.scale.setScalar(map.assetScale || 1);
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -(Number.isFinite(map.assetGroundY) ? map.assetGroundY : bounds.min.y), -center.z);
        tuneHubMaterials(model);
        const world = new THREE.Group();
        world.name = `social-map-${map.id}`;
        world.visible = this.mapId === map.id;
        world.add(model);
        this.mapWorlds[map.id] = world;
        this.root.add(world);
    }

    _installCharacter(gltf, index) {
        if (this._disposed) return;
        const model = gltf.scene;
        model.scale.setScalar(1.15);
        model.rotation.y = index % 2 ? Math.PI : 0;
        setMeshShadows(model);
        this.characterTemplates[index] = { scene: model, animations: gltf.animations || [] };
    }

    enter(spawn, mapId = this.mapId) {
        if (this._disposed || this.active) return false;
        const map = this.selectMap(mapId);
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
        for (let i = 0; i < this._waterMeshes.length; i++) this._waterMeshes[i].position.y = .24 + Math.sin(this._elapsed * 1.4 + i) * .025;
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
                addBox(group, [1.2, 1.8, .8], [0, 1.4, 0], this._estateMaterials.accent.clone());
                addBox(group, [1, 1, 1], [0, 2.75, 0], this._estateMaterials.marble.clone());
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
    }
}
