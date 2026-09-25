// item-thumbnails.js — real 3D thumbnails for case/shop/locker item tiles.
//
// The reel, shop, tier list and locker used to show every item as a generic CSS orb,
// so a player never saw the knife/glove/ball they were chasing. This module renders
// the ACTUAL in-game models (weapon-models.js knives + viewmodel-fx.js rarity rim,
// viewmodel-hand.js gloved fist, ball.js shapes + ball-skin-fx.js surface textures,
// the shop showcase avatar rig, cosmetic-models.js wearables) through ONE shared,
// small, transparent offscreen WebGLRenderer and hands back cached data URLs.
//
// Budget rules (AGENTS.md "Oyun Geliştirme Modu"):
//   - generation runs only in requestIdleCallback slots, one step at a time
//     (build+async shader compile, then render+encode), never in a rAF;
//   - shaders compile through renderer.compileAsync (KHR_parallel_shader_compile)
//     so a first-time MeshPhysicalMaterial variant does not stall the page;
//   - results live in a bounded LRU keyed by kind:id:version:size;
//   - every subject is disposed right after its render (shared geometry/texture
//     caches owned by other modules are never disposed here);
//   - no WebGL → `supported` is false and callers keep the old CSS orb/icon.
import * as THREE from 'three';
import { createKnifeModel } from './weapon-models.js';
import { attachViewmodelFx, disposeViewmodelFx } from './viewmodel-fx.js';
import { buildViewmodelHand, applyGloveLook, fitGripToModel } from './viewmodel-hand.js';
import { BALL_SKINS, ballShapeParts } from './ball.js';
import { getBallSkinTexture } from './ball-skin-fx.js';
import { KNIVES } from './cosmetics.js';
import { COSMETICS } from './cosmetic-catalog.js';
import { AVATAR_SKINS } from './avatar.js';
import { createShowcaseAvatar } from './shop-showcase.js';
import { applyEntityCosmetics, updateEntityCosmetics } from './cosmetic-models.js';

// Bump when the look changes so stale cached images never survive a deploy.
export const THUMBNAIL_VERSION = 1;
export const THUMBNAIL_SIZE = 256;
export const THUMBNAIL_CACHE_LIMIT = 160;
// Idle-slot budget: a step only starts when at least this much idle time remains,
// and one idle callback never runs more than MAX_STEPS_PER_IDLE steps.
export const MIN_IDLE_BUDGET_MS = 6;
export const MAX_STEPS_PER_IDLE = 2;

export const THUMBNAIL_KINDS = Object.freeze(['knife', 'glove', 'ball', 'avatar', 'wearable']);

// Reel palette (css/polish.css .case-reel-item --reel-glow) so the 3D rim matches the tile.
export const RARITY_LIGHT_COLORS = Object.freeze({
    common: '#9fb4c9',
    uncommon: '#7fd9ff',
    rare: '#36a8ff',
    epic: '#ae7cff',
    legendary: '#ffc02e',
    exotic: '#ff6b5f'
});

export function rarityLightColor(rarity) {
    const key = typeof rarity === 'string' ? rarity.trim().toLowerCase() : '';
    return RARITY_LIGHT_COLORS[key] || RARITY_LIGHT_COLORS.common;
}

// Hero pose per item type: Euler rotation applied to the (centred) subject, camera
// FOV, and fit margin. Knives lie on a diagonal with the flat of the blade to camera
// (the CS "inventory" shot); gloves show the back of the fist and knuckle plates;
// avatars stand at a 3/4 turn; balls tilt so the surface pattern and shape read.
export const THUMBNAIL_POSES = Object.freeze({
    knife: Object.freeze({ x: 0.2, y: -Math.PI / 2 + 0.35, z: 0.62, order: 'ZXY', fov: 26, margin: 1.08 }),
    // Fist knuckles point along +x and the handle axis is z: yaw -90° turns the
    // knuckle row to camera, then a tilt shows the back of the hand.
    glove: Object.freeze({ x: 0.38, y: -Math.PI / 2 + 0.5, z: -0.2, order: 'XYZ', fov: 28, margin: 1.1 }),
    ball: Object.freeze({ x: 0.42, y: -0.5, z: 0, order: 'YXZ', fov: 26, margin: 1.2 }),
    // The character rig faces -z (character-rig.js FACE_SOCKET_LOCAL_Z): turn it round, 3/4.
    avatar: Object.freeze({ x: 0.06, y: Math.PI - 0.5, z: 0, order: 'YXZ', fov: 26, margin: 1.04 }),
    wearable: Object.freeze({ x: 0.3, y: -0.6, z: 0, order: 'YXZ', fov: 28, margin: 1.16 })
});

export function thumbnailPose(kind) {
    return THUMBNAIL_POSES[kind] || THUMBNAIL_POSES.wearable;
}

// Pure: camera distance (from the subject centre) that fits an axis-aligned box of
// `size` (already in camera orientation) inside a perspective frustum. The front face
// sits at distance - size.z/2, which is what has to fit.
export function fitCameraDistance(size, fovDeg = 26, aspect = 1, margin = 1.1) {
    const sx = Math.max(1e-4, Number(size?.x) || 0);
    const sy = Math.max(1e-4, Number(size?.y) || 0);
    const sz = Math.max(0, Number(size?.z) || 0);
    const vHalf = Math.max(1, Math.min(170, Number(fovDeg) || 26)) * Math.PI / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.05, Number(aspect) || 1));
    const fitY = (sy / 2) / Math.tan(vHalf);
    const fitX = (sx / 2) / Math.tan(hHalf);
    return Math.max(fitX, fitY) * Math.max(1, Number(margin) || 1) + sz / 2;
}

export function thumbnailCacheKey(kind, id, size = THUMBNAIL_SIZE, version = THUMBNAIL_VERSION) {
    return `${kind}:${id}:v${version}:${size}`;
}

const WEARABLE_TYPES = new Set(['cape', 'pet', 'shoes', 'aura', 'hat', 'mask', 'wings', 'backpack', 'banner', 'trail']);

// Pure: normalise every item shape the UI passes (case drop-rate rows, rolled rewards,
// KNIVES/COSMETICS/BALL_SKINS/AVATAR_SKINS entries) into a thumbnail descriptor.
// `typeHint` is the UI's category ('knife'|'ball'|'avatar'|'cosmetic'); rolled
// cosmetic rewards carry type 'cosmetic', so the real slot comes from COSMETICS.
// Returns null when there is nothing 3D to show (impacts/finishers) → caller fallback.
export function describeThumbnailItem(item, typeHint = null) {
    if (!item || typeof item !== 'object') return null;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id) return null;
    const type = typeHint || item.type || (KNIVES[id] && item.model ? 'knife' : null);
    if (type === 'knife' || (!type && KNIVES[id])) {
        const knife = KNIVES[id] || (item.model ? item : null);
        if (!knife) return null;
        return Object.freeze({ kind: 'knife', id, rarity: item.rarity || knife.rarity || 'common', source: knife });
    }
    if (type === 'ball') {
        const skin = BALL_SKINS[id];
        if (!skin) return null;
        return Object.freeze({ kind: 'ball', id, rarity: item.rarity || skin.rarity || 'common', source: skin });
    }
    if (type === 'avatar') {
        const skin = AVATAR_SKINS[id];
        if (!skin) return null;
        return Object.freeze({ kind: 'avatar', id, rarity: item.rarity || skin.rarity || 'rare', source: skin });
    }
    const cosmetic = COSMETICS[id];
    if (!cosmetic) return null;
    if (type && type !== 'cosmetic' && type !== cosmetic.type) return null;
    const rarity = item.rarity || cosmetic.rarity || 'common';
    if (cosmetic.type === 'gloves') return Object.freeze({ kind: 'glove', id, rarity, source: cosmetic });
    if (WEARABLE_TYPES.has(cosmetic.type)) return Object.freeze({ kind: 'wearable', id, rarity, source: cosmetic });
    return null;
}

// ---------------------------------------------------------------------------
// Bounded LRU. Map insertion order is the recency order; `onEvict` lets a caller
// release a resource (ImageBitmap.close, URL.revokeObjectURL) when an entry drops.
// ---------------------------------------------------------------------------
export class ThumbnailLRU {
    constructor(limit = THUMBNAIL_CACHE_LIMIT, onEvict = null) {
        this.limit = Math.max(1, Math.floor(Number(limit) || 1));
        this.onEvict = typeof onEvict === 'function' ? onEvict : null;
        this._map = new Map();
    }

    get size() { return this._map.size; }

    has(key) { return this._map.has(key); }

    get(key) {
        if (!this._map.has(key)) return undefined;
        const value = this._map.get(key);
        this._map.delete(key);
        this._map.set(key, value);
        return value;
    }

    set(key, value) {
        if (this._map.has(key)) {
            const old = this._map.get(key);
            this._map.delete(key);
            if (old !== value) this.onEvict?.(old, key);
        }
        this._map.set(key, value);
        while (this._map.size > this.limit) {
            const [oldestKey, oldest] = this._map.entries().next().value;
            this._map.delete(oldestKey);
            this.onEvict?.(oldest, oldestKey);
        }
        return value;
    }

    keys() { return [...this._map.keys()]; }

    clear() {
        const entries = [...this._map.entries()];
        this._map.clear();
        for (const [key, value] of entries) this.onEvict?.(value, key);
        return entries.length;
    }
}

// ---------------------------------------------------------------------------
// Subjects: the real game models, built standalone. Each returns
// { object, dispose() } — dispose frees only what the builder created.
// ---------------------------------------------------------------------------

// Frees geometry/material created for a subject. Textures are never disposed here:
// glove patterns and ball surfaces come from their modules' shared caches.
export function disposeSubjectTree(root) {
    root?.traverse?.(child => {
        if (child.geometry && !child.userData?.sharedGeometry) child.geometry.dispose?.();
        const material = child.material;
        if (Array.isArray(material)) material.forEach(entry => entry?.dispose?.());
        else material?.dispose?.();
    });
    root?.removeFromParent?.();
}

function buildKnifeSubject(desc) {
    const style = { ...desc.source, rarity: desc.rarity };
    const group = createKnifeModel(style);
    // Static rim only (reduceMotion) — the same rarity read the player gets in hand.
    const fx = attachViewmodelFx(group, style, null, { reduceMotion: true });
    return {
        object: group,
        dispose() {
            disposeViewmodelFx(fx);
            disposeSubjectTree(group);
        }
    };
}

function buildGloveSubject(desc) {
    const arm = new THREE.Group();
    const hand = buildViewmodelHand(arm, color => new THREE.MeshStandardMaterial({ color }), '#3b4b5c');
    applyGloveLook(hand, desc.source, '#3b4b5c');
    fitGripToModel(hand, 'classic');
    // A thumbnail is the glove itself: detach the fist from the sleeve/wrist rig.
    const fist = hand.handMesh;
    fist.removeFromParent();
    fist.position.set(0, 0, 0);
    fist.rotation.set(0, 0, 0);
    return {
        object: fist,
        dispose() {
            disposeSubjectTree(arm);
            disposeSubjectTree(fist);
        }
    };
}

let sharedGlowTexture = null;
// Soft radial sprite used for the ball halo and the reveal stage glow. One small
// canvas for the whole session (like viewmodel-fx's sparkle texture).
export function getRadialGlowTexture() {
    if (sharedGlowTexture || typeof document === 'undefined') return sharedGlowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    sharedGlowTexture = new THREE.CanvasTexture(canvas);
    return sharedGlowTexture;
}

function buildBallSubject(desc) {
    const skin = desc.source;
    const radius = 0.43; // Ball.visualRadius — shared shape geometry is keyed by it
    const group = new THREE.Group();
    const texture = getBallSkinTexture(desc.id, skin, 'high');
    const body = new THREE.MeshPhysicalMaterial({
        // Ball skins are flat saturated toon colours in game: skip ACES (it pulls them
        // pastel) and keep reflections low so the skin colour, not the studio, reads.
        color: skin.color, map: texture, roughness: 0.4, metalness: 0.05,
        clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.35, toneMapped: false,
        emissive: new THREE.Color(skin.glow ?? skin.color).multiplyScalar(0.08)
    });
    const accent = new THREE.MeshStandardMaterial({
        color: skin.starColor ?? 0xffffff, roughness: 0.3, metalness: 0.4,
        emissive: new THREE.Color(skin.starColor ?? 0xffffff).multiplyScalar(0.2)
    });
    const shape = skin.shape || 'sphere';
    if (shape === 'sphere') {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), body));
        // The in-game ball's two star decals (ball.js buildMesh) — same identity mark.
        const starGeo = new THREE.CircleGeometry(0.12, 5);
        for (const side of [1, -1]) {
            const star = new THREE.Mesh(starGeo, accent);
            star.position.z = side * (radius + 0.004);
            if (side < 0) {
                star.rotation.y = Math.PI;
                star.userData.sharedGeometry = true; // disposed once via the front star
            }
            group.add(star);
        }
    } else {
        for (const part of ballShapeParts(shape, radius)) {
            const mesh = new THREE.Mesh(part.geo, part.tint === 'accent' ? accent : body);
            mesh.userData.sharedGeometry = true; // ball.js caches these for every ball
            group.add(mesh);
        }
    }
    const glowMap = getRadialGlowTexture();
    if (glowMap) {
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowMap, color: skin.glow ?? skin.color, transparent: true, opacity: 0.55,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        halo.scale.setScalar(radius * 3.1);
        halo.renderOrder = -1;
        halo.userData.excludeFromBounds = true;
        group.add(halo);
    }
    return { object: group, dispose: () => disposeSubjectTree(group) };
}

function buildAvatarSubject(desc) {
    const avatar = createShowcaseAvatar({ skinId: desc.id });
    avatar.setPoseTime(0, true);
    return { object: avatar.root, dispose: () => avatar.dispose() };
}

function buildWearableSubject(desc) {
    const entity = { group: new THREE.Group() };
    applyEntityCosmetics(entity, { [desc.source.type]: desc.id });
    updateEntityCosmetics(entity, 0.35);
    if (!entity.cosmeticsRoot?.children.length) {
        disposeSubjectTree(entity.group);
        return null;
    }
    return { object: entity.group, dispose: () => disposeSubjectTree(entity.group) };
}

const SUBJECT_BUILDERS = Object.freeze({
    knife: buildKnifeSubject,
    glove: buildGloveSubject,
    ball: buildBallSubject,
    avatar: buildAvatarSubject,
    wearable: buildWearableSubject
});

// Builds the real model for a descriptor. Returns null on failure (caller falls back).
export function buildThumbnailSubject(desc) {
    const builder = desc && SUBJECT_BUILDERS[desc.kind];
    if (!builder) return null;
    try {
        return builder(desc) || null;
    } catch {
        return null;
    }
}

const _box = new THREE.Box3();
const _childBox = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _vertex = new THREE.Vector3();
const PRECISE_BOUNDS_MAX_VERTICES = 20000;

// World bounds that ignore glow sprites / rim shells / particles (they would pad the
// framing with empty space). Per-vertex for normal-sized meshes: a rotated local AABB
// inflates up to √2 (a posed ball would render ~30% too small).
export function subjectBounds(object, target = _box) {
    target.makeEmpty();
    object.updateMatrixWorld(true);
    object.traverse(child => {
        if (!child.isMesh || child.userData?.excludeFromBounds || child.name === 'viewmodel-rim') return;
        const geometry = child.geometry;
        const position = geometry?.attributes?.position;
        if (!position) return;
        if (position.count <= PRECISE_BOUNDS_MAX_VERTICES) {
            for (let index = 0; index < position.count; index++) {
                _vertex.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
                target.expandByPoint(_vertex);
            }
            return;
        }
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        _childBox.copy(geometry.boundingBox).applyMatrix4(child.matrixWorld);
        target.union(_childBox);
    });
    return target;
}

// Centres `subject` inside `pivot`, applies the kind's hero pose, re-centres the
// posed bounds on the origin and places `camera` so the whole item fits. Returns the
// fitted distance. Shared by the thumbnail renderer and the 3D reveal stage.
export function frameSubject(pivot, subject, camera, kind, { aspect = 1, marginScale = 1 } = {}) {
    const pose = thumbnailPose(kind);
    pivot.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    if (subject.parent !== pivot) pivot.add(subject);
    subject.position.set(0, 0, 0);
    pivot.updateMatrixWorld(true);
    subjectBounds(subject).getCenter(_center);
    subject.position.sub(_center);
    pivot.rotation.set(pose.x, pose.y, pose.z, pose.order);
    pivot.updateMatrixWorld(true);
    const bounds = subjectBounds(pivot);
    if (bounds.isEmpty()) return 0;
    bounds.getCenter(_center);
    bounds.getSize(_size);
    pivot.position.sub(_center);
    const distance = fitCameraDistance(_size, pose.fov, aspect, pose.margin * marginScale);
    camera.fov = pose.fov;
    camera.aspect = aspect;
    camera.near = Math.max(0.001, distance / 100);
    camera.far = distance * 10 + _size.z;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    return distance;
}

// Procedural studio environment (sky gradient dome + softboxes) baked through PMREM,
// the same recipe as the in-game viewmodel pass (Renderer#_viewmodelEnvironment) so
// metal skins reflect identically in thumbnails and in hand.
export function createStudioEnvironment(renderer) {
    try {
        const studio = new THREE.Scene();
        studio.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide,
            vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'varying vec3 vDir; void main(){ float h = vDir.y * 0.5 + 0.5; vec3 c = mix(vec3(0.05, 0.07, 0.09), vec3(0.55, 0.85, 0.9), smoothstep(0.25, 0.95, h)); gl_FragColor = vec4(c, 1.0); }'
        })));
        const softbox = (w, h, x, y, z, intensity) => {
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity), side: THREE.DoubleSide }));
            panel.position.set(x, y, z);
            panel.lookAt(0, 0, 0);
            studio.add(panel);
        };
        softbox(6, 2.2, 0, 6, 3, 5);
        softbox(2, 5, -6, 1.5, 1, 3);
        softbox(2, 5, 6, 1, -2, 2.2);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const texture = pmrem.fromScene(studio, 0.02).texture;
        pmrem.dispose();
        studio.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
        return texture;
    } catch {
        return null;
    }
}

// Key / fill / rarity rim rig. The rim sits behind-left so its colour outlines the
// silhouette against the transparent background.
export function createStudioLights(scene) {
    const hemi = new THREE.HemisphereLight(0xe4f6ff, 0x0b1824, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(2.4, 3.2, 3.4);
    const fill = new THREE.DirectionalLight(0xbfe7ff, 0.7);
    fill.position.set(-3, 0.6, 2.2);
    const rim = new THREE.DirectionalLight(0xffffff, 3.2);
    rim.position.set(-2.2, 1.8, -3.2);
    const kicker = new THREE.DirectionalLight(0xffffff, 1.4);
    kicker.position.set(2.6, -1.2, -2.4);
    scene.add(hemi, key, fill, rim, kicker);
    return { hemi, key, fill, rim, kicker };
}

export function setRarityLighting(lights, rarity, strength = 1) {
    const color = rarityLightColor(rarity);
    lights.rim.color.set(color);
    lights.kicker.color.set(color);
    const premium = ['legendary', 'exotic'].includes(rarity) ? 1.25 : rarity === 'epic' ? 1.1 : 1;
    lights.rim.intensity = 3.2 * premium * strength;
    lights.kicker.intensity = 1.4 * premium * strength;
}

// Default renderer factory. Throws when WebGL is unavailable (service marks itself
// unsupported). `preserveDrawingBuffer` keeps toDataURL valid after render.
function createDefaultRenderer(size) {
    if (typeof document === 'undefined') throw new Error('no DOM');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, preserveDrawingBuffer: true,
        powerPreference: 'low-power', premultipliedAlpha: false
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    return renderer;
}

export function hasWebGLSupport() {
    return typeof document !== 'undefined'
        && (typeof WebGL2RenderingContext !== 'undefined' || typeof WebGLRenderingContext !== 'undefined');
}

function defaultEncode(renderer) {
    const canvas = renderer.domElement;
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

function defaultScheduler(callback) {
    if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(callback, { timeout: 700 });
        return () => cancelIdleCallback?.(handle);
    }
    // Safari: no rIC — emulate one small idle slot per ~2 frames.
    const handle = setTimeout(() => {
        const start = performance.now();
        callback({ didTimeout: false, timeRemaining: () => Math.max(0, 10 - (performance.now() - start)) });
    }, 34);
    return () => clearTimeout(handle);
}

// ---------------------------------------------------------------------------
// ThumbnailService — queue + idle pump + LRU + DOM attachment.
// Everything environment-specific is injectable so tests run with a stub renderer.
// ---------------------------------------------------------------------------
export class ThumbnailService {
    constructor({
        size = THUMBNAIL_SIZE,
        limit = THUMBNAIL_CACHE_LIMIT,
        createRenderer = createDefaultRenderer,
        buildSubject = buildThumbnailSubject,
        encode = defaultEncode,
        scheduler = defaultScheduler,
        createEnvironment = createStudioEnvironment,
        maxStepsPerIdle = MAX_STEPS_PER_IDLE,
        minIdleBudgetMs = MIN_IDLE_BUDGET_MS,
        probe = hasWebGLSupport
    } = {}) {
        this._probe = probe;
        this.size = size;
        this.cache = new ThumbnailLRU(limit);
        this._createRenderer = createRenderer;
        this._buildSubject = buildSubject;
        this._encode = encode;
        this._scheduler = scheduler;
        this._createEnvironment = createEnvironment;
        this._maxSteps = Math.max(1, maxStepsPerIdle);
        this._minBudget = Math.max(0, minIdleBudgetMs);
        this._jobs = new Map();       // key -> job (queued or active)
        this._queue = [];             // keys, front = next
        this._active = null;
        this._cancelIdle = null;
        this._renderer = null;
        this._stage = null;
        this._unsupported = false;
        this._contextLosses = 0;
        this._observer = null;
        this._observed = new WeakMap();
        this.disposed = false;
        this.stats = { rendered: 0, failed: 0, skipped: 0 };
    }

    // Cheap check — the real context is only created inside an idle slot. A context
    // that later fails to create flips this to false and every waiter falls back.
    get supported() {
        if (this._unsupported || this.disposed) return false;
        if (this._probeResult === undefined) {
            try { this._probeResult = Boolean(this._probe()); } catch { this._probeResult = false; }
        }
        return this._probeResult;
    }

    get pendingCount() { return this._queue.length + (this._active ? 1 : 0); }

    // Synchronous cache read (no generation).
    peek(item, typeHint = null) {
        const desc = describeThumbnailItem(item, typeHint);
        return desc ? this.cache.get(this._key(desc)) ?? null : null;
    }

    _key(desc) { return thumbnailCacheKey(desc.kind, desc.id, this.size); }

    _ensureRenderer() {
        if (this._renderer) return this._renderer;
        if (this._unsupported || this.disposed) return null;
        try {
            const renderer = this._createRenderer(this.size);
            if (!renderer) throw new Error('renderer unavailable');
            this._renderer = renderer;
            const canvas = renderer.domElement;
            canvas?.addEventListener?.('webglcontextlost', event => {
                event.preventDefault?.();
                this._onContextLost();
            }, false);
            const scene = new THREE.Scene();
            const env = this._createEnvironment?.(renderer) || null;
            scene.environment = env;
            const lights = createStudioLights(scene);
            const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
            const pivot = new THREE.Group();
            scene.add(pivot);
            this._stage = { scene, camera, pivot, lights, env };
            return renderer;
        } catch {
            this._unsupported = true;
            this._renderer = null;
            return null;
        }
    }

    _onContextLost() {
        this._contextLosses++;
        this._teardownRenderer();
        // Fail whatever was in flight; queued jobs retry on a fresh context once.
        if (this._active) this._finishJob(this._active, null);
        if (this._contextLosses >= 2) this._failAll();
        else this._schedule();
    }

    // Queue a thumbnail. Resolves to a data URL, or null (unsupported / nothing to
    // show / failed). `priority: true` jumps the queue (reel winner, open inspector).
    request(item, typeHint = null, { priority = false } = {}) {
        const desc = describeThumbnailItem(item, typeHint);
        if (!desc || this.disposed || !this.supported) return Promise.resolve(null);
        const key = this._key(desc);
        const cached = this.cache.get(key);
        if (cached) return Promise.resolve(cached);
        return new Promise(resolve => this._enqueue(desc, key, { resolve }, priority));
    }

    // Warm the cache for a list (case inspector → the reel is ready before it spins).
    prefetch(items, { priority = false } = {}) {
        let queued = 0;
        for (const entry of items || []) {
            const desc = describeThumbnailItem(entry?.item || entry, entry?.typeHint || null);
            if (!desc || this.disposed || !this.supported) continue;
            const key = this._key(desc);
            if (this.cache.has(key)) continue;
            this._enqueue(desc, key, { resolve: null, keep: true }, priority);
            queued++;
        }
        return queued;
    }

    // Put a thumbnail <img class="item-thumb"> into `container` when ready. Returns
    // false when no thumbnail will come (fallback art stays untouched).
    attach(container, item, typeHint = null, { priority = false, lazy = true, className = '' } = {}) {
        if (!container || this.disposed) return false;
        const desc = describeThumbnailItem(item, typeHint);
        if (!desc || !this.supported) return false;
        const key = this._key(desc);
        container.dataset.thumbKey = key;
        const cached = this.cache.get(key);
        if (cached) {
            insertThumbnail(container, cached, key, className);
            return true;
        }
        container.dataset.thumb = 'pending';
        const waiter = { element: container, className };
        const start = () => this._enqueue(desc, key, waiter, priority);
        if (lazy && typeof IntersectionObserver === 'function') this._observe(container, start);
        else start();
        return true;
    }

    _observe(element, start) {
        if (!this._observer) {
            this._observer = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const begin = this._observed.get(entry.target);
                    this._observer.unobserve(entry.target);
                    this._observed.delete(entry.target);
                    begin?.();
                }
            }, { rootMargin: '240px 0px' });
        }
        this._observed.set(element, start);
        this._observer.observe(element);
    }

    _enqueue(desc, key, waiter, priority) {
        let job = this._jobs.get(key);
        if (!job) {
            job = { key, desc, waiters: [], phase: 'queued', subject: null, priority: false };
            this._jobs.set(key, job);
            this._queue.push(key);
        }
        if (priority && job.phase === 'queued' && !job.priority) {
            // Priority jobs keep their own FIFO order ahead of normal ones, so a
            // prioritised batch (inspector strip, chase items first) renders in order.
            job.priority = true;
            const index = this._queue.indexOf(key);
            if (index !== -1) this._queue.splice(index, 1);
            let insertAt = 0;
            while (insertAt < this._queue.length && this._jobs.get(this._queue[insertAt])?.priority) insertAt++;
            this._queue.splice(insertAt, 0, key);
        }
        job.waiters.push(waiter);
        this._schedule();
    }

    _schedule() {
        if (this._cancelIdle || this.disposed) return;
        if (!this._queue.length && !(this._active && this._active.phase === 'ready')) return;
        this._cancelIdle = this._scheduler(deadline => {
            this._cancelIdle = null;
            this._pump(deadline);
        });
    }

    // One idle slot: at most `_maxSteps` steps, each only when budget remains.
    _pump(deadline) {
        let steps = 0;
        while (!this.disposed && steps < this._maxSteps) {
            const remaining = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0;
            if (steps > 0 && remaining < this._minBudget) break;
            if (steps === 0 && remaining < this._minBudget && !deadline?.didTimeout) break;
            if (this._active) {
                if (this._active.phase !== 'ready') break; // compiling: wait for its promise
                this._renderActive();
            } else if (!this._startNext()) {
                break;
            }
            steps++;
        }
        this._schedule();
    }

    _hasLiveWaiter(job) {
        return job.waiters.some(waiter => waiter.resolve || waiter.keep || waiter.element?.isConnected !== false);
    }

    // Phase A: build the subject, frame it, kick off async shader compile.
    _startNext() {
        while (this._queue.length) {
            const key = this._queue.shift();
            const job = this._jobs.get(key);
            if (!job) continue;
            if (!this._hasLiveWaiter(job)) {
                // Every tile that wanted it left the DOM (shop re-render) — skip the work.
                this._jobs.delete(key);
                this.stats.skipped++;
                continue;
            }
            const cached = this.cache.get(key);
            if (cached) {
                this._finishJob(job, cached);
                return true;
            }
            if (!this._ensureRenderer()) {
                this._finishJob(job, null);
                this._failAll();
                return false;
            }
            const subject = this._buildSubject(job.desc);
            if (!subject?.object) {
                this._finishJob(job, null);
                return true;
            }
            const { pivot, camera, lights, scene } = this._stage;
            job.subject = subject;
            job.phase = 'compiling';
            this._active = job;
            frameSubject(pivot, subject.object, camera, job.desc.kind);
            setRarityLighting(lights, job.desc.rarity);
            const renderer = this._renderer;
            let compiled = null;
            try {
                compiled = typeof renderer.compileAsync === 'function' ? renderer.compileAsync(scene, camera) : null;
            } catch {
                compiled = null;
            }
            const markReady = () => {
                if (this._active !== job) return;
                job.phase = 'ready';
                this._schedule();
            };
            if (compiled && typeof compiled.then === 'function') compiled.then(markReady, markReady);
            else markReady();
            return true;
        }
        return false;
    }

    // Phase B: render, encode, cache, dispose the subject, resolve waiters.
    _renderActive() {
        const job = this._active;
        let url = null;
        try {
            const renderer = this._ensureRenderer();
            if (renderer) {
                const { scene, camera } = this._stage;
                renderer.render(scene, camera);
                url = this._encode(renderer) || null;
            }
        } catch {
            url = null;
        }
        if (url) {
            this.cache.set(job.key, url);
            this.stats.rendered++;
        } else {
            this.stats.failed++;
        }
        this._finishJob(job, url);
    }

    _finishJob(job, url) {
        if (job.subject) {
            try { job.subject.dispose(); } catch { /* already gone */ }
            job.subject = null;
        }
        if (this._active === job) this._active = null;
        this._jobs.delete(job.key);
        const index = this._queue.indexOf(job.key);
        if (index !== -1) this._queue.splice(index, 1);
        for (const waiter of job.waiters) {
            if (waiter.resolve) waiter.resolve(url);
            else if (waiter.element && url && waiter.element.dataset?.thumbKey === job.key) {
                insertThumbnail(waiter.element, url, job.key, waiter.className);
            } else if (waiter.element && !url && waiter.element.dataset) {
                waiter.element.dataset.thumb = 'fallback';
            }
        }
        job.waiters.length = 0;
    }

    _failAll() {
        this._unsupported = true;
        if (this._active) this._finishJob(this._active, null);
        for (const key of [...this._queue]) {
            const job = this._jobs.get(key);
            if (job) this._finishJob(job, null);
        }
        this._queue.length = 0;
        this._teardownRenderer();
    }

    _teardownRenderer() {
        if (this._stage) {
            this._stage.env?.dispose?.();
            this._stage.pivot.clear();
            this._stage = null;
        }
        if (this._renderer) {
            try { this._renderer.dispose?.(); } catch { /* ignore */ }
            try { this._renderer.forceContextLoss?.(); } catch { /* ignore */ }
            this._renderer = null;
        }
    }

    // Frees the renderer + queue; cached URLs are dropped. Safe to call twice.
    dispose() {
        if (this.disposed) return;
        this._cancelIdle?.();
        this._cancelIdle = null;
        if (this._active) this._finishJob(this._active, null);
        for (const key of [...this._queue]) {
            const job = this._jobs.get(key);
            if (job) this._finishJob(job, null);
        }
        this._queue.length = 0;
        this._jobs.clear();
        this._observer?.disconnect?.();
        this._observer = null;
        this._teardownRenderer();
        this.cache.clear();
        this.disposed = true;
    }
}

// Inserts (or updates) the thumbnail image; the container gains `.has-item-thumb`
// so CSS hides the fallback orb/icon underneath.
export function insertThumbnail(container, url, key = '', className = '') {
    if (!container || !url) return null;
    const doc = container.ownerDocument || globalThis.document;
    let img = container.querySelector?.(':scope > img.item-thumb') || null;
    if (!img) {
        img = doc.createElement('img');
        img.className = `item-thumb${className ? ` ${className}` : ''}`;
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.setAttribute?.('aria-hidden', 'true');
        container.appendChild(img);
    }
    if (img.getAttribute?.('src') !== url) img.src = url;
    container.classList?.add('has-item-thumb');
    if (container.dataset) {
        container.dataset.thumb = 'ready';
        if (key) container.dataset.thumbKey = key;
    }
    return img;
}

let defaultService = null;
export function getItemThumbnails() {
    if (!defaultService || defaultService.disposed) defaultService = new ThumbnailService();
    return defaultService;
}

export function attachItemThumbnail(container, item, typeHint = null, options = {}) {
    return getItemThumbnails().attach(container, item, typeHint, options);
}

export function prefetchItemThumbnails(items, options = {}) {
    return getItemThumbnails().prefetch(items, options);
}

export function disposeItemThumbnails() {
    defaultService?.dispose();
    defaultService = null;
}
