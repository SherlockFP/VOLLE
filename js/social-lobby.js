import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SOCIAL_LOBBY_PORTALS = Object.freeze([
    { id: 'quick-play', label: 'Quick Play', position: Object.freeze({ x: 0, y: 0, z: -28 }), color: 0x49b8ff },
    { id: 'ranked', label: 'Ranked', position: Object.freeze({ x: 20, y: 0, z: -19 }), color: 0xffc247 },
    { id: 'practice', label: 'Practice', position: Object.freeze({ x: -24, y: 0, z: -12 }), color: 0x62df9b },
    { id: 'shop', label: 'Shop', position: Object.freeze({ x: 24, y: 0, z: 10 }), color: 0xff79bb },
    { id: 'clans', label: 'Clans', position: Object.freeze({ x: -23, y: 0, z: 15 }), color: 0x9b8cff }
]);

const CHARACTER_ASSETS = ['a', 'f', 'k', 'r'].map(
    id => `assets/cc0/kenney/blocky-characters/character-${id}.glb`
);
const PROP_ASSETS = [
    ['assets/cc0/kenney/mini-arena/wall-gate.glb', [0, 0, -34], 3.2, 0],
    ['assets/cc0/kenney/mini-arena/trophy.glb', [0, 0.25, -17], 2.4, 0],
    ['assets/cc0/kenney/mini-arena/statue.glb', [17, 0, 20], 2.2, -0.5],
    ['assets/cc0/kenney/mini-arena/column.glb', [-7, 0, -24], 2.1, 0],
    ['assets/cc0/kenney/mini-arena/column.glb', [7, 0, -24], 2.1, 0],
    ['assets/cc0/kenney/mini-arena/tree.glb', [-28, 0, -26], 2.6, 0],
    ['assets/cc0/kenney/mini-arena/tree.glb', [29, 0, 25], 2.4, 0.8],
    ['assets/cc0/kenney/mini-arena/banner.glb', [-8, 0, -31], 2.2, 0],
    ['assets/cc0/kenney/mini-arena/banner.glb', [8, 0, -31], 2.2, 0],
    ['assets/cc0/kenney/platformer-kit/chest.glb', [25, 0, 13], 1.7, -0.6],
    ['assets/cc0/kenney/platformer-kit/flag.glb', [-24, 0, -8], 2.2, 0],
    ['assets/cc0/kenney/platformer-kit/platform-ramp.glb', [-34, 0, 3], 2.2, Math.PI / 2],
    ['assets/cc0/kenney/platformer-kit/platform.glb', [-29, 2.2, -2], 2.4, 0],
    ['assets/cc0/kenney/platformer-kit/block-moving-blue.glb', [-17, 6.5, -2], 2, 0],
    ['assets/cc0/kenney/platformer-kit/spring.glb', [-31, 0.2, 8], 1.8, 0],
    ['assets/cc0/kenney/platformer-kit/tree.glb', [-33, 0, 21], 1.8, 0]
];

export function findNearestPortal(position, portals = SOCIAL_LOBBY_PORTALS, maxDistance = 3.8) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
    let nearest = null;
    let nearestDistance = Math.max(0, Number(maxDistance) || 0);
    for (const portal of portals) {
        const dx = position.x - portal.position.x;
        const dz = position.z - portal.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= nearestDistance) {
            nearest = portal;
            nearestDistance = distance;
        }
    }
    return nearest ? { portal: nearest, distance: nearestDistance } : null;
}

export function createSocialLobbyArena() {
    const bounds = Object.freeze({ minX: -38, maxX: 38, minY: 0, maxY: 18, minZ: -38, maxZ: 38 });
    return {
        bounds,
        ceilingHeight: 18,
        config: { name: 'VOLLE Social Hub', lowGravity: false, slippery: false, gameplay: { sandTraction: 1 } },
        collidables: [],
        platforms: [],
        jumpPads: [],
        getHazardAt: () => null,
        getPlayerSpawn: () => new THREE.Vector3(0, 1.7, 24)
    };
}

function setMeshShadows(root) {
    root.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
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
        this.onInteract = options.onInteract || (() => {});
        this.onPrompt = options.onPrompt || (() => {});
        this.onPresence = options.onPresence || (() => {});
        this.arena = createSocialLobbyArena();
        this.portals = SOCIAL_LOBBY_PORTALS;
        this.mixers = [];
        this.visitors = new Map();
        this.characterTemplates = [];
        this._savedArena = null;
        this._nearPortal = null;
        this._elapsed = 0;
        this._presenceDirty = true;
        this._disposed = false;

        this._buildFallbackPlaza();
        this.scene?.add(this.root);
        this.ready = this._loadAssets();
    }

    _buildFallbackPlaza() {
        const floor = new THREE.Mesh(
            new THREE.CylinderGeometry(37, 39, 0.8, 48),
            material(0xbfe9ff)
        );
        floor.position.y = -0.4;
        floor.receiveShadow = true;
        this.root.add(floor);

        const center = new THREE.Mesh(
            new THREE.CylinderGeometry(12, 13, 0.35, 32),
            material(0xf4fbff)
        );
        center.position.y = 0.18;
        center.receiveShadow = true;
        this.root.add(center);

        for (let i = 0; i < 12; i++) {
            const angle = i / 12 * Math.PI * 2;
            const mesh = box(
                this.root,
                [2.1, 1.4 + i % 3 * 0.35, 2.1],
                [Math.cos(angle) * 34, 0.7, Math.sin(angle) * 34],
                i % 2 ? 0x6ec9ed : 0xffca67
            );
            this.arena.collidables.push({ mesh, pos: mesh.position.clone(), radius: 1.35 });
        }

        this._buildPortals();
        this._buildPracticeCourse();
        this._buildFallbackVisitors();
    }

    _buildPortals() {
        for (const portal of this.portals) {
            const group = new THREE.Group();
            group.name = `portal-${portal.id}`;
            group.position.set(portal.position.x, 0, portal.position.z);
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(2.5, 0.22, 10, 32),
                new THREE.MeshStandardMaterial({
                    color: portal.color,
                    emissive: portal.color,
                    emissiveIntensity: 0.35,
                    roughness: 0.35
                })
            );
            ring.position.y = 2.7;
            ring.castShadow = true;
            group.add(ring);
            const pad = new THREE.Mesh(
                new THREE.CylinderGeometry(2.8, 3.2, 0.25, 24),
                material(portal.color)
            );
            pad.position.y = 0.12;
            pad.receiveShadow = true;
            group.add(pad);
            this.root.add(group);
        }
    }

    _buildPracticeCourse() {
        const course = new THREE.Group();
        course.name = 'practice-parkour';
        const steps = [
            [-29, 1.1, -2, 5, 2.2, 5],
            [-23, 2.1, 2, 4, 4.2, 4],
            [-17, 3.2, -2, 4, 6.4, 4],
            [-11, 4.4, 3, 5, 8.8, 5]
        ];
        for (const [x, y, z, width, height, depth] of steps) {
            box(course, [width, height, depth], [x, y, z], 0x68d79f);
            this.arena.platforms.push({ x, y: height, z, halfWidth: width / 2, halfDepth: depth / 2 });
        }
        const jumpPosition = new THREE.Vector3(-31, 0.18, 8);
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
        const spots = [[-8, 0, 14], [8, 0, 15], [-13, 0, -12], [13, 0, -10]];
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
                this.root.add(model);
            })
            .catch(() => null));
        await Promise.allSettled([...characterJobs, ...propJobs]);
        return this;
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
                : new THREE.Vector3(spawn?.x || 0, spawn?.y || this.player.height || 1.7, spawn?.z ?? 24);
            this.player.position.copy(target);
            this.player.velocity?.set(0, 0, 0);
            this.player.verticalVel = 0;
            this.player.onGround = true;
            this.player.alive = true;
            this.player.camera?.position.copy(this.player.position);
        }
        this._nearPortal = null;
        this._presenceDirty = true;
        this.onPrompt(null);
        this._emitPresence();
        return true;
    }

    exit() {
        if (!this.active) return false;
        this.active = false;
        this.root.visible = false;
        if (this.player && this._savedArena) this.player.arena = this._savedArena;
        this._savedArena = null;
        this._nearPortal = null;
        this.onPrompt(null);
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

        const nearest = findNearestPortal(this.player?.position, this.portals);
        const portal = nearest?.portal || null;
        if (portal?.id !== this._nearPortal?.id) {
            this._nearPortal = portal;
            this.onPrompt(portal ? { id: portal.id, label: portal.label, distance: nearest.distance } : null);
        }
        if (this._presenceDirty) this._emitPresence();
    }

    interact() {
        if (!this.active || !this._nearPortal) return false;
        this.onInteract(this._nearPortal.id, this._nearPortal);
        return true;
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
