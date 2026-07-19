import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const SOCIAL_LOBBY_BOUNDS = Object.freeze({
    minX: -170,
    maxX: 170,
    minY: 0,
    maxY: 100,
    minZ: -170,
    maxZ: 170
});
const ISLAND_BOUNDS = Object.freeze({ minX: -96, maxX: 96, minY: 0, maxY: 72, minZ: -96, maxZ: 96 });
export const SOCIAL_HUB_MAPS = Object.freeze({
    city: Object.freeze({ id: 'city', name: 'City', bounds: SOCIAL_LOBBY_BOUNDS, spawn: Object.freeze({ x: 0, y: 1.7, z: -8 }), credit: 'City by costoWRLD - CC BY' }),
    island: Object.freeze({ id: 'island', name: 'Island', bounds: ISLAND_BOUNDS, spawn: Object.freeze({ x: 0, y: 2.2, z: 20 }), credit: 'Island world - VOLLE preview' })
});
const CITY_ASSET = 'assets/cc-by/costowrld-low-poly-city/low-poly-city-social-hub.glb';
const CITY_COLLIDERS = 'assets/cc-by/costowrld-low-poly-city/colliders.json';
const CITY_SCALE = 0.66;
const CITY_COLLIDER_SCALE = CITY_SCALE / 0.6;
const CITY_CENTER = Object.freeze({ x: 130.3742904663086, z: -56.472755432128906 });

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = [];

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

function getSocialHubMap(mapId = 'city') {
    return SOCIAL_HUB_MAPS[String(mapId).toLowerCase()] || SOCIAL_HUB_MAPS.city;
}

function normalizeMapMarker(value, bounds) {
    const position = value?.position || value;
    const x = normalizeMapCoordinate(position?.x, bounds.minX, bounds.maxX);
    const z = normalizeMapCoordinate(position?.z, bounds.minZ, bounds.maxZ);
    return x === null || z === null ? null : { x, z };
}

export function getSocialLobbyMapState(player, presence, mapId = 'city') {
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

export function createSocialLobbyArena(mapId = 'city') {
    const map = getSocialHubMap(mapId);
    const boundaries = createSocialBoundaryColliders(map.bounds);
    const getWaterAt = map.id === 'island'
        ? position => {
            const radius = Math.hypot(Number(position?.x) || 0, Number(position?.z) || 0);
            return radius >= 61 && radius <= 94 ? { surfaceY: 3.05, floorY: -5.5 } : null;
        }
        : () => null;
    return {
        bounds: map.bounds,
        ceilingHeight: map.bounds.maxY,
        config: { name: `VOLLE Social Hub - ${map.name}`, lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables: boundaries,
        platforms: [],
        jumpPads: [],
        getWaterAt,
        getHazardAt: () => null,
        getPlayerSpawn: () => new THREE.Vector3(map.spawn.x, map.spawn.y, map.spawn.z)
    };
}

function setMeshShadows(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
    });
}

function tuneCityMaterials(root) {
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
            entry.roughness = Math.max(0.55, Number(entry.roughness) || 0);
            entry.envMapIntensity = 0.55;
            if (entry.emissive && entry.color) {
                entry.emissive.copy(entry.color).multiplyScalar(0.11);
                entry.emissiveIntensity = Math.max(0.35, Number(entry.emissiveIntensity) || 0);
            }
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
        this.mapId = 'city';
        this.arenas = { city: createSocialLobbyArena('city'), island: createSocialLobbyArena('island') };
        this.arena = this.arenas.city;
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
        this._cityColliderGrid = null;
        this.cityMapBlocks = [];
        this.cityModel = null;
        this.cityLoadError = null;

        this._buildFallbackPlaza();
        this._buildIslandWorld();
        this._buildCityLighting();
        this.scene?.add(this.root);
        this.ready = this._loadAssets();
    }

    _buildFallbackPlaza() {
        this.fallbackWorld = new THREE.Group();
        this.fallbackWorld.name = 'social-city-fallback';
        this.root.add(this.fallbackWorld);
        const floor = new THREE.Mesh(
            new THREE.CylinderGeometry(151, 153, 0.8, 64),
            material(0xbfe9ff)
        );
        floor.position.y = -0.4;
        floor.receiveShadow = true;
        this.fallbackWorld.add(floor);

        const center = new THREE.Mesh(
            new THREE.CylinderGeometry(5.8, 6.2, 0.3, 32),
            material(0xf4fbff)
        );
        center.position.set(0, 0.16, -8);
        center.receiveShadow = true;
        this.fallbackWorld.add(center);

        for (let i = 0; i < 12; i++) {
            const angle = i / 12 * Math.PI * 2;
            const mesh = box(
                this.fallbackWorld,
                [2.1, 1.4 + i % 3 * 0.35, 2.1],
                [Math.cos(angle) * 146, 0.7, Math.sin(angle) * 146],
                i % 2 ? 0x6ec9ed : 0xffca67
            );
            const collider = { mesh, pos: mesh.position.clone(), radius: 1.35 };
            this.arena.collidables.push(collider);
            this._roundColliders.push(collider);
            this._fallbackColliders.push(collider);
        }

        this._buildFallbackVisitors();
    }

    _buildCityLighting() {
        this.cityLights = new THREE.Group();
        this.cityLights.name = 'social-city-lighting';
        const skyFill = new THREE.HemisphereLight(0xc9f4ff, 0x3e687a, 2.2);
        const sun = new THREE.DirectionalLight(0xfff3d8, 3.1);
        sun.position.set(70, 120, 45);
        this.cityLights.add(skyFill, sun);
        this.root.add(this.cityLights);
    }

    _buildIslandWorld() {
        this.islandWorld = new THREE.Group();
        this.islandWorld.name = 'social-island-preview';
        this.islandWorld.visible = false;
        const water = new THREE.Mesh(new THREE.RingGeometry(62, 95, 64), new THREE.MeshStandardMaterial({ color: 0x2499c9, roughness: 0.28, metalness: 0.16, transparent: true, opacity: 0.9 }));
        water.rotation.x = -Math.PI / 2;
        water.position.y = 1.05;
        this.islandWorld.add(water);
        const shore = new THREE.Mesh(new THREE.CylinderGeometry(66, 74, 2.2, 12), material(0xf3cb73));
        shore.position.y = -1.1;
        shore.receiveShadow = true;
        this.islandWorld.add(shore);
        const grass = new THREE.Mesh(new THREE.CylinderGeometry(54, 62, 1.1, 12), material(0x58b96b));
        grass.position.y = 0.1;
        grass.receiveShadow = true;
        this.islandWorld.add(grass);
        const lighthouse = new THREE.Group();
        box(lighthouse, [7, 17, 7], [0, 8.5, -16], 0xf6eee0);
        box(lighthouse, [7.8, 2.2, 7.8], [0, 17.5, -16], 0xd95d58);
        box(lighthouse, [3.3, 3.1, 3.3], [0, 20.2, -16], 0x5ee4e2);
        this.islandWorld.add(lighthouse);
        for (const [x, z, scale] of [[-34, -20, 1], [34, -16, .9], [-38, 28, 1.1], [32, 33, .86], [2, 42, .95]]) {
            const palm = new THREE.Group();
            box(palm, [1.25 * scale, 9 * scale, 1.25 * scale], [0, 4.5 * scale, 0], 0x805432);
            for (let i = 0; i < 5; i++) {
                const leaf = box(palm, [7 * scale, .42 * scale, 1.2 * scale], [0, 9 * scale, 0], 0x2f9b63);
                leaf.rotation.y = i * Math.PI * .4;
                leaf.rotation.z = -.24;
            }
            palm.position.set(x, 0, z);
            this.islandWorld.add(palm);
        }
        const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), new THREE.MeshBasicMaterial({ color: 0x65cbea, side: THREE.BackSide, fog: false }));
        this.islandWorld.add(sky);
        this.root.add(this.islandWorld);
    }

    _buildFallbackVisitors() {
        const spots = [[-5, 0, -2], [5, 0, -2], [-5, 0, -14], [5, 0, -14]];
        spots.forEach((position, index) => {
            const group = new THREE.Group();
            group.name = `visitor-local-${index}`;
            const body = box(group, [1.25, 1.7, 0.8], [0, 1.45, 0], index % 2 ? 0x509ee8 : 0xef6c72);
            const head = box(group, [1.05, 1.05, 1.05], [0, 2.75, 0], 0xffd3ad);
            body.castShadow = head.castShadow = true;
            group.position.set(...position);
            group.userData.baseY = position[1];
            group.userData.fallback = true;
            this.root.add(group);
            this.visitors.set(`local-${index}`, { group, mixer: null, local: true });
        });
    }

    async _loadAssets() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const cityJob = Promise.all([
            loader.loadAsync(CITY_ASSET),
            fetch(CITY_COLLIDERS).then(response => {
                if (!response.ok) throw new Error(`Social city colliders: ${response.status}`);
                return response.json();
            })
        ])
            .then(([gltf, colliderData]) => this._installCity(gltf, colliderData))
            .catch(error => {
                this.cityLoadError = error;
                return null;
            });
        const characterJobs = CHARACTER_ASSETS.map((url, index) => loader.loadAsync(url)
            .then(gltf => this._installCharacter(gltf, index))
            .catch(() => null));
        const propJobs = PROP_ASSETS.map(([url, position, scale, rotationY, collisionRadius]) => loader.loadAsync(url)
            .then(gltf => {
                if (this._disposed) return;
                const model = gltf.scene;
                model.position.set(...position);
                model.scale.setScalar(scale);
                model.rotation.y = rotationY;
                setMeshShadows(model);
                this.root.add(model);
                if (collisionRadius > 0) {
                    const collider = {
                        mesh: model,
                        pos: model.position.clone(),
                        radius: collisionRadius
                    };
                    this.arena.collidables.push(collider);
                    this._roundColliders.push(collider);
                }
            })
            .catch(() => null));
        await Promise.allSettled([cityJob, ...characterJobs, ...propJobs]);
        return this;
    }

    _installCity(gltf, colliderData) {
        if (this._disposed) return;
        const model = gltf.scene;
        model.name = 'costowrld-low-poly-city';
        model.scale.setScalar(CITY_SCALE);
        model.position.set(-CITY_CENTER.x * CITY_SCALE, 0, -CITY_CENTER.z * CITY_SCALE);
        tuneCityMaterials(model);
        model.visible = this.mapId === 'city';
        this.root.add(model);
        this.cityModel = model;
        this.fallbackWorld.visible = false;

        const cityArena = this.arenas.city;
        const fallback = new Set(this._fallbackColliders);
        cityArena.collidables = cityArena.collidables.filter(collider => !fallback.has(collider));
        this._roundColliders = this._roundColliders.filter(collider => !fallback.has(collider));
        const boxes = (colliderData?.colliders || []).map(entry => ({
            minX: entry[0] * CITY_COLLIDER_SCALE,
            maxX: entry[1] * CITY_COLLIDER_SCALE,
            minY: entry[2] * CITY_COLLIDER_SCALE,
            maxY: entry[3] * CITY_COLLIDER_SCALE,
            minZ: entry[4] * CITY_COLLIDER_SCALE,
            maxZ: entry[5] * CITY_COLLIDER_SCALE,
            city: true
        }));
        cityArena.collidables.push(...boxes);
        this.cityMapBlocks = boxes;
        this._cityColliderGrid = createSocialColliderGrid(boxes, colliderData?.cellSize);
        cityArena.getNearbyCollidables = position => [
            ...cityArena.collidables.filter(collider => collider.invisibleBoundary),
            ...this._roundColliders,
            ...this._cityColliderGrid.query(position)
        ];
    }

    selectMap(mapId = 'city') {
        const map = getSocialHubMap(mapId);
        this.mapId = map.id;
        this.arena = this.arenas[map.id];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        if (this.player && this.active) this.player.arena = this.arena;
        if (this.islandWorld) this.islandWorld.visible = map.id === 'island';
        if (this.cityModel) this.cityModel.visible = map.id === 'city';
        if (this.fallbackWorld) this.fallbackWorld.visible = map.id === 'city' && !this.cityModel;
        this._presenceDirty = true;
        return map;
    }

    _installCharacter(gltf, index) {
        if (this._disposed) return;
        const visitor = this.visitors.get(`local-${index}`);
        if (!visitor) return;
        const model = gltf.scene;
        model.scale.setScalar(1.15);
        model.rotation.y = index % 2 ? Math.PI : 0;
        setMeshShadows(model);
        visitor.group.traverse(child => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const entry of materials) entry?.dispose?.();
        });
        visitor.group.clear();
        visitor.group.add(model);
        visitor.group.userData.fallback = false;
        this.characterTemplates[index] = { scene: model, animations: gltf.animations || [] };
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
        return this.mapId === 'city' ? this.cityMapBlocks : [];
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
        this.cityMapBlocks.length = 0;
    }
}
