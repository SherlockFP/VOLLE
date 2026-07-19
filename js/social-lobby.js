import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ISLAND_BOUNDS = Object.freeze({ minX: -96, maxX: 96, minY: 0, maxY: 72, minZ: -96, maxZ: 96 });
const ISLAND_GROUND_Y = 16.35;
export const SOCIAL_HUB_MAPS = Object.freeze({
    island: Object.freeze({ id: 'island', name: 'Island', bounds: ISLAND_BOUNDS, spawn: Object.freeze({ x: 0, y: 18.05, z: 20 }), credit: 'Olann Island - local OBJ conversion' })
});
const ISLAND_ASSET = 'assets/user-content/olann-island/olann-island.glb';
const ISLAND_SCALE = 250;

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
    const getWaterAt = map.id === 'island'
        ? position => {
            const radius = Math.hypot(Number(position?.x) || 0, Number(position?.z) || 0);
            return radius >= 61 && radius <= 94 ? { surfaceY: 16.25, floorY: 10.5 } : null;
        }
        : () => null;
    return {
        bounds: map.bounds,
        ceilingHeight: map.bounds.maxY,
        config: { name: `VOLLE Social Hub - ${map.name}`, lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables: boundaries,
        platforms: map.id === 'island' ? [{ x: 0, z: 0, y: ISLAND_GROUND_Y, halfWidth: 60, halfDepth: 60 }] : [],
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
        child.receiveShadow = false;
    });
}

function tuneIslandMaterials(root) {
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
        this.arenas = { island: createSocialLobbyArena('island') };
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
        this.islandModel = null;
        this.islandLoadError = null;

        this._buildIslandWorld();
        this.scene?.add(this.root);
        this.ready = this._loadAssets();
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

    async _loadAssets() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const islandJob = loader.loadAsync(ISLAND_ASSET)
            .then(gltf => this._installIsland(gltf))
            .catch(error => {
                this.islandLoadError = error;
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
        await Promise.allSettled([islandJob, ...characterJobs, ...propJobs]);
        return this;
    }

    _installIsland(gltf) {
        if (this._disposed) return;
        const model = gltf.scene;
        model.name = 'olann-island';
        model.scale.setScalar(ISLAND_SCALE);
        tuneIslandMaterials(model);
        model.visible = this.mapId === 'island';
        this.root.add(model);
        this.islandModel = model;
        this.islandWorld.visible = false;
    }

    selectMap(mapId = 'island') {
        const map = getSocialHubMap(mapId);
        this.mapId = map.id;
        this.arena = this.arenas[map.id];
        this._boundaryColliders = this.arena.collidables.filter(collider => collider.invisibleBoundary);
        if (this.player && this.active) this.player.arena = this.arena;
        if (this.islandWorld) this.islandWorld.visible = map.id === 'island' && !this.islandModel;
        if (this.islandModel) this.islandModel.visible = map.id === 'island';
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
