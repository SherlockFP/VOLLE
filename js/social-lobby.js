import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ISLAND_BOUNDS = Object.freeze({ minX: -220, maxX: 220, minY: -12, maxY: 110, minZ: -220, maxZ: 220 });
const ISLAND_GROUND_Y = 0;
const CONSTRUCT_BOUNDS = Object.freeze({ minX: -118, maxX: 118, minY: -12, maxY: 90, minZ: -150, maxZ: 150 });
const CITY_BOUNDS = Object.freeze({ minX: -120, maxX: 120, minY: -12, maxY: 78, minZ: -120, maxZ: 120 });
export const SOCIAL_HUB_MAPS = Object.freeze({
    island: Object.freeze({ id: 'island', name: 'Island', bounds: ISLAND_BOUNDS, spawn: Object.freeze({ x: 0, y: 2, z: 28 }), credit: 'VOLLE Harbor Plaza - CC0 Kenney props' }),
    construct: Object.freeze({ id: 'construct', name: 'Construct', bounds: CONSTRUCT_BOUNDS, spawn: Object.freeze({ x: 0, y: 2, z: 92 }), asset: 'assets/user-content/social-hub/construct.glb', assetScale: 2.25, assetGroundY: -1.6, credit: 'Garrys Map Construct by Providence Secretary (NIEZDE) - CC BY' }),
    city: Object.freeze({ id: 'city', name: 'Chicken City', bounds: CITY_BOUNDS, spawn: Object.freeze({ x: 0, y: 2, z: 86 }), asset: 'assets/user-content/social-hub/chicken-city.glb', assetScale: 1.5, assetGroundY: -18.45, credit: 'Chicken Gun Fruzzer City by amogusstrikesback2 - CC BY' })
});

const SOCIAL_MAP_BLOCKS = Object.freeze({
    island: Object.freeze([
        [-145, -145, 46, 16], [145, -145, 46, 16], [-145, 145, 46, 16], [145, 145, 46, 16],
        [-174, 0, 12, 62], [174, 0, 12, 62], [0, -174, 62, 12], [0, 174, 62, 12],
        [-82, -86, 30, 10], [82, -86, 30, 10], [-82, 86, 30, 10], [82, 86, 30, 10]
    ]),
    construct: Object.freeze([
        [-82, -104, 30, 18], [0, -104, 28, 18], [82, -104, 30, 18],
        [-92, -28, 18, 34], [92, -28, 18, 34], [-70, 48, 30, 22], [70, 48, 30, 22],
        [-95, 110, 18, 24], [0, 110, 40, 22], [95, 110, 18, 24], [0, 6, 12, 12]
    ]),
    city: Object.freeze([
        [-82, -76, 24, 18], [0, -76, 22, 18], [80, -76, 24, 18],
        [-88, -4, 18, 31], [-38, 2, 18, 24], [38, 2, 18, 24], [88, -4, 18, 31],
        [-78, 75, 28, 19], [0, 78, 23, 18], [78, 75, 28, 19]
    ])
});

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = [
    ['assets/cc0/kenney/mini-arena/statue.glb', [0, 1.8, -8], 1.25, 0],
    ['assets/cc0/kenney/mini-arena/trophy.glb', [0, 2.6, -8], 1.2, 0],
    ['assets/cc0/kenney/mini-arena/banner.glb', [-76, 0, -126], 1.9, 0],
    ['assets/cc0/kenney/mini-arena/banner.glb', [76, 0, -126], 1.9, Math.PI],
    ['assets/cc0/kenney/mini-arena/tree.glb', [-130, 0, 78], 2.6, .4],
    ['assets/cc0/kenney/mini-arena/tree.glb', [130, 0, 78], 2.6, -.4]
];

export const SOCIAL_LOBBY_PROP_COLLIDERS = Object.freeze(PROP_ASSETS
    .filter(([, , , , radius]) => radius > 0)
    .map(([url, position, , , radius]) => Object.freeze({
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
        const minCellX = Math.floor((collider.minX - margin) / size);
        const maxCellX = Math.floor((collider.maxX + margin) / size);
        const minCellZ = Math.floor((collider.minZ - margin) / size);
        const maxCellZ = Math.floor((collider.maxZ + margin) / size);
        for (let x = minCellX; x <= maxCellX; x++) {
            for (let z = minCellZ; z <= maxCellZ; z++) {
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
    const edge = Math.max(0.5, Number(thickness) || 1.5);
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

function normalizeMapCoordinate(value, min, max) {
    if (!Number.isFinite(value)) return null;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function getSocialHubMap(mapId = 'island') {
    return SOCIAL_HUB_MAPS[String(mapId).toLowerCase()] || SOCIAL_HUB_MAPS.island;
}

function normalizeMapMarker(value, bounds) {
    const position = value?.position || value;
    const x = normalizeMapCoordinate(position?.x, bounds.minX, bounds.maxX);
    const z = normalizeMapCoordinate(position?.z, bounds.minZ, bounds.maxZ);
    return x === null || z === null ? null : { x, z };
}

export function getSocialLobbyMapState(player, presence, mapId = 'island') {
    const visitors = Array.isArray(presence) ? presence : [];
    const map = getSocialHubMap(mapId);
    return {
        bounds: map.bounds,
        player: normalizeMapMarker(player, map.bounds),
        visitors: visitors.flatMap(visitor => {
            const marker = normalizeMapMarker(visitor, map.bounds);
            return marker ? [{
                id: visitor.id ?? null,
                name: visitor.name ?? null,
                local: Boolean(visitor.local),
                ...marker
            }] : [];
        })
    };
}

export function createSocialLobbyArena(mapId = 'island') {
    const map = getSocialHubMap(mapId);
    const boundaries = createSocialBoundaryColliders(map.bounds);
    const blocks = (SOCIAL_MAP_BLOCKS[map.id] || []).map(([x, z, halfWidth, halfDepth]) => ({ minX: x - halfWidth, maxX: x + halfWidth, minY: -2, maxY: map.bounds.maxY, minZ: z - halfDepth, maxZ: z + halfDepth }));
    const collidables = [...boundaries, ...blocks];
    const grid = createSocialColliderGrid(collidables, 22);
    return {
        bounds: map.bounds,
        ceilingHeight: map.bounds.maxY,
        config: { name: `VOLLE Social Hub - ${map.name}`, lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables,
        getNearbyCollidables: position => grid.query(position),
        platforms: [{ x: 0, z: 0, y: ISLAND_GROUND_Y, halfWidth: (map.bounds.maxX - map.bounds.minX) / 2 - 6, halfDepth: (map.bounds.maxZ - map.bounds.minZ) / 2 - 6 }],
        jumpPads: [],
        getWaterAt: () => null,
        getHazardAt: () => null,
        getPlayerSpawn: () => new THREE.Vector3(map.spawn.x, map.spawn.y, map.spawn.z)
    };
}

function setMeshShadows(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = false;
    });
}

function tuneHubMaterials(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = true;
        child.frustumCulled = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const entry of materials) {
            if (!entry) continue;
            if (entry.map) entry.map.colorSpace = THREE.SRGBColorSpace;
            if (entry.emissiveMap) entry.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            if (entry.transparent) entry.depthWrite = false;
            entry.roughness = Math.max(0.62, Number(entry.roughness) || 0);
        }
    });
}

function material(color, roughness = 0.78) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function box(group, size, position, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
    mesh.position.set(...position);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

function cylinder(group, radius, height, position, color, options = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material(color, options.roughness ?? .64));
    mesh.position.set(...position);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
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
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
    sprite.scale.set(2.8, .7, 1);
    sprite.position.set(0, 3.7, 0);
    return sprite;
}

export class SocialLobby {
    constructor(renderer, player, options = {}) {
        this.renderer = renderer;
        this.scene = renderer?.scene;
        this.player = player;
        this.root = new THREE.Group();
        this.root.name = 'social-lobby';
        this.root.visible = false;
        this.active = false;
        this.drivePlayer = options.drivePlayer !== false;
        this.onPresence = options.onPresence || (() => {});
        this.mapId = 'island';
        this.arenas = Object.fromEntries(Object.keys(SOCIAL_HUB_MAPS).map(id => [id, createSocialLobbyArena(id)]));
        this.arena = this.arenas.island;
        this.mixers = [];
        this.visitors = new Map();
        this.characterTemplates = [];
        this._savedArena = null;
        this._elapsed = 0;
        this._presenceDirty = true;
        this._disposed = false;
        this._roundColliders = [];
        this._fallbackColliders = [];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        this._buildIslandWorld();
        this.scene?.add(this.root);
        this.ready = this._loadAssets();
    }

    _buildIslandWorld() {
        this.islandWorld = new THREE.Group();
        this.islandWorld.name = 'volle-harbor-plaza';
        this.islandWorld.visible = true;
        box(this.islandWorld, [440, 2, 440], [0, -1, 0], 0x087b88);
        box(this.islandWorld, [180, .18, 26], [0, .05, 0], 0x30d1ca, { castShadow: false });
        box(this.islandWorld, [26, .18, 180], [0, .06, 0], 0x30d1ca, { castShadow: false });
        const plaza = new THREE.Mesh(new THREE.CircleGeometry(56, 48), material(0x62eee0, .46));
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = .12;
        plaza.receiveShadow = true;
        this.islandWorld.add(plaza);
        const fountain = new THREE.Group();
        cylinder(fountain, 13, 1.4, [0, .7, -8], 0x1a7182);
        cylinder(fountain, 9.5, .35, [0, 1.45, -8], 0x55dfe1);
        cylinder(fountain, 2.1, 5.2, [0, 3.5, -8], 0x166e83);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 12), new THREE.MeshStandardMaterial({ color: 0x9affef, emissive: 0x167b75, emissiveIntensity: .9, roughness: .26 }));
        beacon.position.set(0, 6.8, -8);
        fountain.add(beacon);
        this.islandWorld.add(fountain);
        for (const [x, z, w, d, h, color] of [[-145,-145,92,32,25,0x235d78],[145,-145,92,32,25,0x286d83],[-145,145,92,32,20,0x225267],[145,145,92,32,20,0x2a6a68],[-174,0,24,124,17,0x1c536b],[174,0,24,124,17,0x235d78],[0,-174,124,24,17,0x1d5368],[0,174,124,24,17,0x246f75]]) {
            box(this.islandWorld, [w, h, d], [x, h / 2, z], color);
            box(this.islandWorld, [w * .8, .5, d + .35], [x, h + .25, z], 0x63e7dc);
            for (let y = 5; y < h - 2; y += 6) box(this.islandWorld, [Math.min(w * .58, 40), 2, .28], [x, y, z - d / 2 - .2], 0x92f6f0, { castShadow: false });
        }
        for (const [x, z, scale] of [[-108,-82,1.2],[108,-82,1.15],[-108,82,1.2],[108,82,1.15],[-38,128,1.1],[38,128,1.1],[-38,-128,1.1],[38,-128,1.1]]) {
            const palm = new THREE.Group();
            cylinder(palm, .72 * scale, 9 * scale, [0, 4.5 * scale, 0], 0x785137);
            for (let i = 0; i < 5; i++) {
                const leaf = box(palm, [7 * scale, .42 * scale, 1.2 * scale], [0, 9 * scale, 0], 0x35aa79);
                leaf.rotation.y = i * Math.PI * .4;
                leaf.rotation.z = -.24;
            }
            palm.position.set(x, 0, z);
            this.islandWorld.add(palm);
        }
        for (const [x, z] of [[-92,-36],[92,-36],[-92,36],[92,36],[-36,-92],[36,-92],[-36,92],[36,92]]) {
            cylinder(this.islandWorld, 3.4, 8, [x, 4, z], 0x1a5968);
            cylinder(this.islandWorld, 4.1, .5, [x, 8.1, z], 0x6be7dc);
        }
        const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 32), new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: { sunDirection: { value: new THREE.Vector3(-.55, .72, -.42).normalize() } },
            vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `varying vec3 vDir; uniform vec3 sunDirection;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 27358.5); }
                float noise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y); }
                void main() { float h=clamp(vDir.y*.65+.42,0.,1.); vec3 sky=mix(vec3(.20,.72,.90),vec3(.02,.16,.48),h); float sun=pow(max(dot(vDir,sunDirection),0.),900.); float haze=pow(max(dot(vDir,sunDirection),0.),14.); float cloud=noise(vDir.xz*8.+vDir.y*3.); float cloudMask=smoothstep(.68,.8,cloud)*smoothstep(.02,.55,vDir.y); sky=mix(sky,vec3(.96,1.,1.),cloudMask*.55); sky+=vec3(1.,.82,.43)*(sun+haze*.16); gl_FragColor=vec4(sky,1.); }`
        }));
        this.islandWorld.add(sky);
        const sun = new THREE.DirectionalLight(0xfff0bd, 2.4);
        sun.position.set(-90, 130, -70);
        sun.castShadow = true;
        this.islandWorld.add(sun);
        this.islandWorld.add(new THREE.HemisphereLight(0x8ef6ff, 0x117b75, 1.35));
        this.root.add(this.islandWorld);
        this.mapWorlds = { island: this.islandWorld };
    }

    async _loadAssets() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const characterJobs = CHARACTER_ASSETS.map((url, index) => loader.loadAsync(url)
            .then(gltf => this._installCharacter(gltf, index))
            .catch(() => null));
        const propJobs = PROP_ASSETS.map(([url, position, scale, rotationY]) => loader.loadAsync(url)
            .then(gltf => {
                if (this._disposed) return;
                const model = gltf.scene;
                model.position.set(...position);
                model.scale.setScalar(scale);
                model.rotation.y = rotationY;
                setMeshShadows(model);
                this.islandWorld.add(model);
            })
            .catch(() => null));
        const mapJobs = Object.values(SOCIAL_HUB_MAPS)
            .filter(map => map.asset)
            .map(map => loader.loadAsync(map.asset)
                .then(gltf => this._installHubMap(map, gltf.scene))
                .catch(() => null));
        await Promise.allSettled([...characterJobs, ...propJobs, ...mapJobs]);
        return this;
    }

    selectMap(mapId = 'island') {
        const map = getSocialHubMap(mapId);
        this.mapId = map.id;
        this.arena = this.arenas[map.id];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
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
        const groundY = Number.isFinite(map.assetGroundY) ? map.assetGroundY * (map.assetScale || 1) : bounds.min.y;
        model.position.set(-center.x, -groundY, -center.z);
        model.updateMatrixWorld(true);
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
        const visitor = this.visitors.get(`local-${index}`);
        if (!visitor) return;
        visitor.group.traverse(child => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const entry of materials) entry?.dispose?.();
        });
        visitor.group.clear();
        visitor.group.add(model);
        visitor.group.userData.fallback = false;
        if (gltf.animations?.length) {
            visitor.mixer = new THREE.AnimationMixer(model);
            visitor.mixer.clipAction(gltf.animations.find(clip => /idle/i.test(clip.name)) || gltf.animations[0]).play();
            this.mixers.push(visitor.mixer);
        }
    }

    enter(spawn, mapId = this.mapId) {
        if (this._disposed || this.active) return false;
        const map = this.selectMap(mapId);
        this.active = true;
        this.root.visible = true;
        this._savedArena = this.player?.arena || null;
        if (this.player) {
            this.player.arena = this.arena;
            const target = spawn?.isVector3
                ? spawn
                : new THREE.Vector3(spawn?.x ?? map.spawn.x, spawn?.y ?? map.spawn.y, spawn?.z ?? map.spawn.z);
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
        const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
        this._elapsed += step;
        if (this.drivePlayer) this.player?.update?.(step);
        for (const mixer of this.mixers) mixer.update(step);
        for (const visitor of this.visitors.values()) {
            if (!visitor.local) continue;
            visitor.group.position.y = (visitor.group.userData.baseY || 0) + Math.sin(this._elapsed * 1.8) * 0.025;
        }

        if (this._presenceDirty) this._emitPresence();
    }

    interact() {
        return false;
    }

    setRemoteVisitor(id, state = {}) {
        if (!id) return null;
        const key = `remote-${id}`;
        let visitor = this.visitors.get(key);
        if (!visitor) {
            const group = new THREE.Group();
            group.name = key;
            const template = this.characterTemplates[Math.abs(Number(state.modelIndex) || 0) % Math.max(1, this.characterTemplates.length)];
            if (template?.scene) {
                const model = template.scene.clone(true);
                setMeshShadows(model);
                group.add(model);
            } else {
                box(group, [1.2, 1.8, 0.8], [0, 1.4, 0], 0x7d8cff);
                box(group, [1, 1, 1], [0, 2.75, 0], 0xffd3ad);
            }
            group.userData.displayName = String(state.name || id).slice(0, 24);
            const nameplate = createNameplate(group.userData.displayName);
            if (nameplate) group.add(nameplate);
            this.root.add(group);
            visitor = { group, mixer: null, local: false };
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
        this.visitors.delete(key);
        this._presenceDirty = true;
        return true;
    }

    getPresence() {
        return [...this.visitors.entries()].map(([id, visitor]) => ({
            id: id.replace(/^remote-/, ''),
            local: visitor.local,
            name: visitor.group.userData.displayName || null,
            position: {
                x: visitor.group.position.x,
                y: visitor.group.position.y,
                z: visitor.group.position.z
            }
        }));
    }

    getMapBlocks() {
        return [];
    }

    _emitPresence() {
        this._presenceDirty = false;
        this.onPresence(this.getPresence());
    }

    dispose() {
        if (this._disposed) return;
        this.exit();
        this._disposed = true;
        this.scene?.remove(this.root);
        this.root.traverse(child => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const entry of materials) entry?.dispose?.();
        });
        this.root.clear();
        this.visitors.clear();
        this.mixers.length = 0;
        this.characterTemplates.length = 0;
    }
}
