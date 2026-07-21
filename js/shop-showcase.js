import * as THREE from 'three';
import { AVATAR_SKINS } from './avatar.js';
import { CHARACTERS } from './characters.js';

const DEFAULT_STATE = Object.freeze({ characterId: 'rally', skinId: 'default' });
const CHARACTER_SHAPES = Object.freeze({
    rally: Object.freeze({ width: 1, height: 1, depth: 1, shoulder: 1 }),
    tank: Object.freeze({ width: 1.18, height: .96, depth: 1.14, shoulder: 1.18 }),
    scout: Object.freeze({ width: .88, height: 1.04, depth: .9, shoulder: .86 }),
    sniper: Object.freeze({ width: .92, height: 1.08, depth: .92, shoulder: .94 }),
    guardian: Object.freeze({ width: 1.1, height: 1, depth: 1.08, shoulder: 1.24 }),
    soldier: Object.freeze({ width: 1.08, height: 1.02, depth: 1.08, shoulder: 1.18 })
});

const hasOwn = (catalog, id) => Object.prototype.hasOwnProperty.call(catalog, id);
const normalizeId = (catalog, value, fallback) => {
    const id = typeof value === 'string' ? value : value?.id;
    return hasOwn(catalog, id) ? id : fallback;
};

const hexNumber = (value, fallback = 0xffffff) => {
    if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
    if (typeof value !== 'string') return fallback;
    const match = value.trim().match(/^#([\da-f]{6})$/i);
    return match ? Number.parseInt(match[1], 16) : fallback;
};

const mixColor = (left, right, amount = .5) => {
    const ratio = Math.max(0, Math.min(1, Number(amount) || 0));
    const channel = shift => Math.round(
        ((left >> shift) & 255) * (1 - ratio) + ((right >> shift) & 255) * ratio
    );
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};

export function normalizeShowcaseState(value = {}) {
    return Object.freeze({
        characterId: normalizeId(CHARACTERS, value?.characterId, DEFAULT_STATE.characterId),
        skinId: normalizeId(AVATAR_SKINS, value?.skinId, DEFAULT_STATE.skinId)
    });
}

export function getShowcaseMaterialPalette(value = {}) {
    const state = normalizeShowcaseState(value);
    const skin = AVATAR_SKINS[state.skinId];
    const character = CHARACTERS[state.characterId];
    const body = hexNumber(skin.body, character.color);
    const accent = mixColor(hexNumber(skin.arms, character.color), character.color, .42);
    return Object.freeze({
        head: hexNumber(skin.head, 0xffd8a8),
        body,
        arms: hexNumber(skin.arms, body),
        legs: hexNumber(skin.legs, body),
        accent,
        detail: mixColor(body, 0x071725, .68),
        visor: mixColor(accent, 0xbdfcff, .6)
    });
}

export function getShowcaseCharacterShape(characterId = DEFAULT_STATE.characterId) {
    const id = normalizeId(CHARACTERS, characterId, DEFAULT_STATE.characterId);
    return CHARACTER_SHAPES[id] || CHARACTER_SHAPES.rally;
}

function disposeMaterial(material) {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose?.();
    }
    material.dispose?.();
}

export function createShowcaseAvatar(options = {}) {
    const state = { ...normalizeShowcaseState(options) };
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.name = 'warrball-showcase-avatar';
    root.userData.showcaseAvatar = true;
    root.add(model);

    const materials = {
        head: new THREE.MeshStandardMaterial({ roughness: .68, metalness: .02 }),
        body: new THREE.MeshStandardMaterial({ roughness: .56, metalness: .08 }),
        arms: new THREE.MeshStandardMaterial({ roughness: .58, metalness: .06 }),
        legs: new THREE.MeshStandardMaterial({ roughness: .72, metalness: .03 }),
        accent: new THREE.MeshStandardMaterial({ roughness: .3, metalness: .42 }),
        detail: new THREE.MeshStandardMaterial({ roughness: .7, metalness: .12 }),
        visor: new THREE.MeshStandardMaterial({ roughness: .18, metalness: .36, emissiveIntensity: .42 })
    };
    const geometries = new Set();
    const meshes = {};

    const box = (name, size, position, material, parent = model) => {
        const geometry = new THREE.BoxGeometry(...size);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(...position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        geometries.add(geometry);
        parent.add(mesh);
        meshes[name] = mesh;
        return mesh;
    };

    box('left-leg', [.37, 1.02, .42], [-.24, .56, 0], materials.legs);
    box('right-leg', [.37, 1.02, .42], [.24, .56, 0], materials.legs);
    box('left-boot', [.41, .24, .62], [-.24, .14, -.08], materials.detail);
    box('right-boot', [.41, .24, .62], [.24, .14, -.08], materials.detail);
    box('torso', [1.02, 1.28, .55], [0, 1.68, 0], materials.body);
    box('belt', [1.08, .18, .6], [0, 1.12, 0], materials.detail);
    box('left-arm', [.34, 1.18, .4], [-.7, 1.7, 0], materials.arms);
    box('right-arm', [.34, 1.18, .4], [.7, 1.7, 0], materials.arms);
    box('left-shoulder', [.48, .3, .54], [-.68, 2.18, 0], materials.accent);
    box('right-shoulder', [.48, .3, .54], [.68, 2.18, 0], materials.accent);
    box('neck', [.28, .22, .28], [0, 2.39, 0], materials.head);
    box('head', [.76, .76, .76], [0, 2.77, 0], materials.head);
    box('visor', [.58, .16, .055], [0, 2.82, -.405], materials.visor);
    box('crest', [.2, .34, .62], [0, 3.28, .02], materials.accent);
    box('chest-mark', [.34, .34, .045], [0, 1.78, -.3], materials.accent);

    const applyPalette = () => {
        const palette = getShowcaseMaterialPalette(state);
        for (const [key, color] of Object.entries(palette)) materials[key]?.color?.setHex(color);
        materials.visor.emissive?.setHex(palette.visor);
        return palette;
    };

    const applyShape = () => {
        const shape = getShowcaseCharacterShape(state.characterId);
        model.scale.set(shape.width, shape.height, shape.depth);
        meshes['left-shoulder'].scale.x = shape.shoulder;
        meshes['right-shoulder'].scale.x = shape.shoulder;
        const armWidth = AVATAR_SKINS[state.skinId].model === 'slim' ? .82 : 1;
        meshes['left-arm'].scale.x = armWidth;
        meshes['right-arm'].scale.x = armWidth;
    };

    const api = {
        root,
        setSkin(skinId) {
            state.skinId = normalizeId(AVATAR_SKINS, skinId, DEFAULT_STATE.skinId);
            applyPalette();
            applyShape();
            return state.skinId;
        },
        setCharacter(characterId) {
            state.characterId = normalizeId(CHARACTERS, characterId, DEFAULT_STATE.characterId);
            applyPalette();
            applyShape();
            return state.characterId;
        },
        sync(value = {}) {
            const next = normalizeShowcaseState({ ...state, ...value });
            state.characterId = next.characterId;
            state.skinId = next.skinId;
            applyPalette();
            applyShape();
            return api.state;
        },
        setPoseTime(seconds = 0, reducedMotion = false) {
            const time = Number.isFinite(seconds) ? seconds : 0;
            model.position.y = reducedMotion ? 0 : Math.sin(time * 1.7) * .025;
            meshes['left-arm'].rotation.x = reducedMotion ? 0 : Math.sin(time * 1.25) * .055;
            meshes['right-arm'].rotation.x = reducedMotion ? 0 : -Math.sin(time * 1.25) * .055;
        },
        dispose() {
            if (root.userData.disposed) return;
            root.userData.disposed = true;
            root.removeFromParent?.();
            for (const geometry of geometries) geometry.dispose?.();
            for (const material of Object.values(materials)) disposeMaterial(material);
            root.clear?.();
        }
    };
    Object.defineProperty(api, 'state', {
        enumerable: true,
        get: () => Object.freeze({ ...state })
    });

    applyPalette();
    applyShape();
    return api;
}

const isCanvas = value => String(value?.tagName || '').toLowerCase() === 'canvas';

function rememberAttributes(element, names) {
    return Object.fromEntries(names.map(name => [name, element?.getAttribute?.(name)]));
}

function restoreAttributes(element, values) {
    for (const [name, value] of Object.entries(values)) {
        if (value === null || value === undefined) element?.removeAttribute?.(name);
        else element?.setAttribute?.(name, value);
    }
}

export class ShopShowcaseRenderer {
    constructor(mount, options = {}) {
        if (!mount) throw new TypeError('ShopShowcaseRenderer requires a mount element.');
        this.mount = mount;
        this._ownsCanvas = !isCanvas(mount);
        const ownerDocument = mount.ownerDocument || globalThis.document;
        this.canvas = this._ownsCanvas ? ownerDocument?.createElement?.('canvas') : mount;
        if (!this.canvas) throw new TypeError('ShopShowcaseRenderer could not create a canvas.');

        this._mountAttributes = rememberAttributes(mount, ['tabindex']);
        this._canvasAttributes = rememberAttributes(this.canvas, ['role', 'aria-label', 'aria-roledescription', 'tabindex']);
        this._previousTouchAction = this.canvas.style?.touchAction || '';
        this.canvas.setAttribute?.('role', 'img');
        this.canvas.setAttribute?.('aria-roledescription', 'interactive 3D character preview');
        this.canvas.setAttribute?.('aria-label', '3D character preview. Drag to rotate; use arrow keys for an alternative.');
        this.canvas.setAttribute?.('tabindex', this._ownsCanvas ? '-1' : '0');
        if (this.canvas.style) this.canvas.style.touchAction = 'none';
        if (this._ownsCanvas) {
            if (!mount.hasAttribute?.('tabindex')) mount.setAttribute?.('tabindex', '0');
            mount.appendChild?.(this.canvas);
        }

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: options.antialias !== false,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setClearColor?.(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if ('toneMapping' in this.renderer) this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        if ('toneMappingExposure' in this.renderer) this.renderer.toneMappingExposure = 1.08;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(31, 1, .1, 50);
        this.camera.position.set(0, 2.05, 7.1);
        this.camera.lookAt(0, 1.55, 0);
        this.avatar = createShowcaseAvatar(options);
        this.avatar.root.position.y = -.08;
        this.scene.add(this.avatar.root);

        this._environmentResources = [];
        this._buildEnvironment();
        this._yaw = -.26;
        this._pitch = -.02;
        this._dragging = false;
        this._lastPointer = null;
        this._running = false;
        this._disposed = false;
        this._elapsed = 0;
        this._lastFrame = null;

        this._window = ownerDocument?.defaultView || globalThis.window;
        this._document = ownerDocument;
        this._motionQuery = this._window?.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this.reducedMotion = Boolean(this._motionQuery?.matches);
        this._bindEvents();
        this.resize();
        if (options.autoStart !== false) this.start();
    }

    _buildEnvironment() {
        const hemi = new THREE.HemisphereLight(0xdffaff, 0x122a42, 2.15);
        const key = new THREE.DirectionalLight(0xffffff, 3.1);
        key.position.set(-3.5, 6, 4);
        key.castShadow = true;
        const rim = new THREE.DirectionalLight(0x42e8ff, 2.4);
        rim.position.set(4, 3, -3);
        this.scene.add(hemi, key, rim);

        const floorGeometry = new THREE.CylinderGeometry(1.75, 2.02, .22, 48);
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x12384d,
            roughness: .36,
            metalness: .54,
            emissive: 0x062d3b,
            emissiveIntensity: .32
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = -.17;
        floor.receiveShadow = true;
        this.scene.add(floor);
        this._environmentResources.push(floorGeometry, floorMaterial);

        const ringGeometry = new THREE.TorusGeometry(1.52, .025, 8, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x5af7ef });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -.045;
        this.scene.add(ring);
        this._environmentResources.push(ringGeometry, ringMaterial);
    }

    _bindEvents() {
        this._onPointerDown = event => {
            if (this._disposed) return;
            this._dragging = true;
            this._lastPointer = { x: event.clientX, y: event.clientY };
            this.canvas.setPointerCapture?.(event.pointerId);
        };
        this._onPointerMove = event => {
            if (!this._dragging || !this._lastPointer) return;
            this._yaw += (event.clientX - this._lastPointer.x) * .012;
            this._pitch = Math.max(-.18, Math.min(.18, this._pitch + (event.clientY - this._lastPointer.y) * .006));
            this._lastPointer = { x: event.clientX, y: event.clientY };
            this._renderFrame();
        };
        this._onPointerUp = event => {
            this._dragging = false;
            this._lastPointer = null;
            this.canvas.releasePointerCapture?.(event.pointerId);
        };
        this._onKeyDown = event => {
            const step = event.shiftKey ? .3 : .16;
            if (event.key === 'ArrowLeft') this._yaw -= step;
            else if (event.key === 'ArrowRight') this._yaw += step;
            else if (event.key === 'ArrowUp') this._pitch = Math.max(-.18, this._pitch - step * .45);
            else if (event.key === 'ArrowDown') this._pitch = Math.min(.18, this._pitch + step * .45);
            else if (event.key === 'Home') {
                this._yaw = -.26;
                this._pitch = -.02;
            } else return;
            event.preventDefault?.();
            this._renderFrame();
        };
        this._onMotionChange = event => {
            this.reducedMotion = Boolean(event.matches);
            this.avatar.setPoseTime(this._elapsed, this.reducedMotion);
            this._refreshLoop();
            this._renderFrame();
        };
        this._onVisibilityChange = () => this._refreshLoop();
        this._onResize = () => this.resize();

        this.canvas.addEventListener?.('pointerdown', this._onPointerDown);
        this.canvas.addEventListener?.('pointermove', this._onPointerMove);
        this.canvas.addEventListener?.('pointerup', this._onPointerUp);
        this.canvas.addEventListener?.('pointercancel', this._onPointerUp);
        this.mount.addEventListener?.('keydown', this._onKeyDown);
        if (this.mount !== this.canvas) this.canvas.addEventListener?.('keydown', this._onKeyDown);
        if (this._motionQuery?.addEventListener) this._motionQuery.addEventListener('change', this._onMotionChange);
        else this._motionQuery?.addListener?.(this._onMotionChange);
        this._document?.addEventListener?.('visibilitychange', this._onVisibilityChange);
        this._window?.addEventListener?.('resize', this._onResize);
        const ResizeObserverClass = this._window?.ResizeObserver || globalThis.ResizeObserver;
        this._resizeObserver = ResizeObserverClass ? new ResizeObserverClass(this._onResize) : null;
        this._resizeObserver?.observe?.(this.mount);
        this._animate = time => {
            const seconds = (Number(time) || 0) / 1000;
            const delta = this._lastFrame === null ? 0 : Math.min(.05, Math.max(0, seconds - this._lastFrame));
            this._lastFrame = seconds;
            this._elapsed += delta;
            if (!this._dragging && !this.reducedMotion) this._yaw += delta * .18;
            this.avatar.setPoseTime(this._elapsed, this.reducedMotion);
            this._renderFrame();
        };
    }

    _refreshLoop() {
        const shouldAnimate = this._running && !this._disposed && !this.reducedMotion && !this._document?.hidden;
        this.renderer.setAnimationLoop?.(shouldAnimate ? this._animate : null);
        if (!shouldAnimate) this._lastFrame = null;
    }

    _renderFrame() {
        if (this._disposed) return;
        this.avatar.root.rotation.set(this._pitch, this._yaw, 0);
        this.renderer.render(this.scene, this.camera);
    }

    setCharacter(characterId) {
        const selected = this.avatar.setCharacter(characterId);
        this._renderFrame();
        return selected;
    }

    setSkin(skinId) {
        const selected = this.avatar.setSkin(skinId);
        this._renderFrame();
        return selected;
    }

    sync(value = {}) {
        const state = this.avatar.sync(value);
        this._renderFrame();
        return state;
    }

    start() {
        if (this._disposed) return false;
        this._running = true;
        this._refreshLoop();
        this._renderFrame();
        return true;
    }

    stop() {
        this._running = false;
        this._refreshLoop();
        return true;
    }

    resize(width, height) {
        if (this._disposed) return false;
        const bounds = this.mount.getBoundingClientRect?.() || {};
        const nextWidth = Math.max(1, Math.round(Number(width) || bounds.width || this.mount.clientWidth || 1));
        const nextHeight = Math.max(1, Math.round(Number(height) || bounds.height || this.mount.clientHeight || nextWidth));
        const ratio = Math.min(2, Math.max(1, Number(this._window?.devicePixelRatio) || 1));
        this.renderer.setPixelRatio?.(ratio);
        this.renderer.setSize(nextWidth, nextHeight, false);
        this.camera.aspect = nextWidth / nextHeight;
        this.camera.updateProjectionMatrix();
        this._renderFrame();
        return Object.freeze({ width: nextWidth, height: nextHeight, pixelRatio: ratio });
    }

    dispose() {
        if (this._disposed) return;
        this.stop();
        this._disposed = true;
        this.canvas.removeEventListener?.('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener?.('pointermove', this._onPointerMove);
        this.canvas.removeEventListener?.('pointerup', this._onPointerUp);
        this.canvas.removeEventListener?.('pointercancel', this._onPointerUp);
        this.mount.removeEventListener?.('keydown', this._onKeyDown);
        if (this.mount !== this.canvas) this.canvas.removeEventListener?.('keydown', this._onKeyDown);
        if (this._motionQuery?.removeEventListener) this._motionQuery.removeEventListener('change', this._onMotionChange);
        else this._motionQuery?.removeListener?.(this._onMotionChange);
        this._document?.removeEventListener?.('visibilitychange', this._onVisibilityChange);
        this._window?.removeEventListener?.('resize', this._onResize);
        this._resizeObserver?.disconnect?.();
        this.avatar.dispose();
        for (const resource of this._environmentResources) resource.dispose?.();
        this.renderer.dispose?.();
        if (this._ownsCanvas) this.canvas.remove?.();
        else {
            restoreAttributes(this.canvas, this._canvasAttributes);
            if (this.canvas.style) this.canvas.style.touchAction = this._previousTouchAction;
        }
        if (this._ownsCanvas) restoreAttributes(this.mount, this._mountAttributes);
    }
}

export function createShopShowcase(mount, options = {}) {
    return new ShopShowcaseRenderer(mount, options);
}
