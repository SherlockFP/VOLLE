import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const SOCIAL_LOBBY_BOUNDS = Object.freeze({
    minX: -153,
    maxX: 153,
    minY: 0,
    maxY: 92,
    minZ: -153,
    maxZ: 153
});
const SOCIAL_LOBBY_PRACTICE_BOUNDS = Object.freeze({
    minX: -38,
    maxX: -12,
    minZ: -14,
    maxZ: 0
});
const CITY_ASSET = 'assets/cc-by/costowrld-low-poly-city/low-poly-city-social-hub.glb';
const CITY_COLLIDERS = 'assets/cc-by/costowrld-low-poly-city/colliders.json';
const CITY_SCALE = 0.6;
const CITY_CENTER = Object.freeze({ x: 130.3742904663086, z: -56.472755432128906 });

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = [
    ['assets/cc0/kenney/mini-arena/wall-gate.glb', [0, 0, -34], 3.2, 0, 0],
    ['assets/cc0/kenney/mini-arena/trophy.glb', [0, 0.25, -14], 2.4, 0, 1.4],
    ['assets/cc0/kenney/mini-arena/statue.glb', [17, 0, 20], 2.2, -0.5, 1.7],
    ['assets/cc0/kenney/mini-arena/column.glb', [-7, 0, -24], 2.1, 0, 1.25],
    ['assets/cc0/kenney/mini-arena/column.glb', [4, 0, -27], 2.1, 0, 1.25],
    ['assets/cc0/kenney/mini-arena/tree.glb', [-28, 0, -26], 2.6, 0, 1.8],
    ['assets/cc0/kenney/mini-arena/tree.glb', [25, 0, 28], 2.4, 0.8, 1.7],
    ['assets/cc0/kenney/mini-arena/banner.glb', [-8, 0, -31], 2.2, 0, 0],
    ['assets/cc0/kenney/mini-arena/banner.glb', [8, 0, -31], 2.2, 0, 0],
    ['assets/cc0/kenney/platformer-kit/chest.glb', [25, 0, 13], 1.7, -0.6, 1.2],
    ['assets/cc0/kenney/platformer-kit/flag.glb', [-24, 0, -8], 2.2, 0, 0],
    ['assets/cc0/kenney/platformer-kit/platform-ramp.glb', [-39, 0, 3], 2.2, Math.PI / 2, 0],
    ['assets/cc0/kenney/platformer-kit/platform.glb', [-29, 2.2, -2], 2.4, 0, 0],
    ['assets/cc0/kenney/platformer-kit/block-moving-blue.glb', [-17, 6.5, -2], 2, 0, 0],
    ['assets/cc0/kenney/platformer-kit/spring.glb', [-31, 0.2, 8], 1.8, 0, 0],
    ['assets/cc0/kenney/platformer-kit/tree.glb', [-33, 0, 21], 1.8, 0, 1.4]
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

function normalizeMapCoordinate(value, min, max) {
    if (!Number.isFinite(value)) return null;
    return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function normalizeMapMarker(value) {
    const position = value?.position || value;
    const x = normalizeMapCoordinate(position?.x, SOCIAL_LOBBY_BOUNDS.minX, SOCIAL_LOBBY_BOUNDS.maxX);
    const z = normalizeMapCoordinate(position?.z, SOCIAL_LOBBY_BOUNDS.minZ, SOCIAL_LOBBY_BOUNDS.maxZ);
    return x === null || z === null ? null : { x, z };
}

export function getSocialLobbyMapState(player, presence) {
    const visitors = Array.isArray(presence) ? presence : [];
    return {
        bounds: SOCIAL_LOBBY_BOUNDS,
        player: normalizeMapMarker(player),
        visitors: visitors.flatMap(visitor => {
            const marker = normalizeMapMarker(visitor);
            return marker ? [{
                id: visitor.id ?? null,
                name: visitor.name ?? null,
                local: Boolean(visitor.local),
                ...marker
            }] : [];
        }),
        practice: Object.freeze({
            minX: normalizeMapCoordinate(SOCIAL_LOBBY_PRACTICE_BOUNDS.minX, SOCIAL_LOBBY_BOUNDS.minX, SOCIAL_LOBBY_BOUNDS.maxX),
            maxX: normalizeMapCoordinate(SOCIAL_LOBBY_PRACTICE_BOUNDS.maxX, SOCIAL_LOBBY_BOUNDS.minX, SOCIAL_LOBBY_BOUNDS.maxX),
            minZ: normalizeMapCoordinate(SOCIAL_LOBBY_PRACTICE_BOUNDS.minZ, SOCIAL_LOBBY_BOUNDS.minZ, SOCIAL_LOBBY_BOUNDS.maxZ),
            maxZ: normalizeMapCoordinate(SOCIAL_LOBBY_PRACTICE_BOUNDS.maxZ, SOCIAL_LOBBY_BOUNDS.minZ, SOCIAL_LOBBY_BOUNDS.maxZ)
        })
    };
}

export function createSocialLobbyArena() {
    return {
        bounds: SOCIAL_LOBBY_BOUNDS,
        ceilingHeight: 92,
        config: { name: 'VOLLE Social Hub', lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables: [],
        platforms: [],
        jumpPads: [],
        getHazardAt: () => null,
        getPlayerSpawn: () => new THREE.Vector3(0, 1.7, -8)
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
            entry.roughness = Math.max(0.55, Number(entry.roughness) || 0);
            entry.envMapIntensity = 0.55;
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
        this.arena = createSocialLobbyArena();
        this.mixers = [];
        this.visitors = new Map();
        this.characterTemplates = [];
        this._savedArena = null;
        this._elapsed = 0;
        this._presenceDirty = true;
        this._disposed = false;
        this._roundColliders = [];
        this._fallbackColliders = [];
        this._cityColliderGrid = null;
        this.cityMapBlocks = [];
        this.cityModel = null;
        this.cityLoadError = null;

        this._buildFallbackPlaza();
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
        this.root.add(center);

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

        this._buildPracticeCourse();
        this._buildFallbackVisitors();
    }

    _buildPracticeCourse() {
        const course = new THREE.Group();
        course.name = 'practice-parkour';
        const steps = [
            [-34, 1.1, -10, 5, 2.2, 5],
            [-28, 2.1, -6, 4, 4.2, 4],
            [-22, 3.2, -10, 4, 6.4, 4],
            [-16, 4.4, -5, 5, 8.8, 5]
        ];
        for (const [x, y, z, width, height, depth] of steps) {
            box(course, [width, height, depth], [x, y, z], 0x68d79f);
            this.arena.platforms.push({ x, y: height, z, halfWidth: width / 2, halfDepth: depth / 2 });
        }
        const jumpPosition = new THREE.Vector3(-36, 0.18, -3);
        const jumpPad = new THREE.Mesh(
            new THREE.CylinderGeometry(2.1, 2.1, 0.3, 24),
            new THREE.MeshStandardMaterial({ color: 0xffce4c, emissive: 0xffa51f, emissiveIntensity: 0.4 })
        );
        jumpPad.position.copy(jumpPosition);
        jumpPad.receiveShadow = true;
        course.add(jumpPad);
        this.arena.jumpPads.push({ position: jumpPosition, impulse: 13 });
        this.root.add(course);
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
        this.root.add(model);
        this.cityModel = model;
        this.fallbackWorld.visible = false;

        const fallback = new Set(this._fallbackColliders);
        this.arena.collidables = this.arena.collidables.filter(collider => !fallback.has(collider));
        this._roundColliders = this._roundColliders.filter(collider => !fallback.has(collider));
        const boxes = (colliderData?.colliders || []).map(entry => ({
            minX: entry[0],
            maxX: entry[1],
            minY: entry[2],
            maxY: entry[3],
            minZ: entry[4],
            maxZ: entry[5],
            city: true
        }));
        this.arena.collidables.push(...boxes);
        this.cityMapBlocks = boxes;
        this._cityColliderGrid = createSocialColliderGrid(boxes, colliderData?.cellSize);
        this.arena.getNearbyCollidables = position => [
            ...this._roundColliders,
            ...this._cityColliderGrid.query(position)
        ];
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

    enter(spawn) {
        if (this._disposed || this.active) return false;
        this.active = true;
        this.root.visible = true;
        this._savedArena = this.player?.arena || null;
        if (this.player) {
            this.player.arena = this.arena;
            const target = spawn?.isVector3
                ? spawn
                : new THREE.Vector3(spawn?.x || 0, spawn?.y || this.player.height || 1.7, spawn?.z ?? -8);
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
        return this.cityMapBlocks;
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
