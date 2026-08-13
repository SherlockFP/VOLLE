import * as THREE from 'three';
import { AVATAR_SKINS } from './avatar.js';
import { CHARACTERS } from './characters.js';
import { createCharacterRig } from './character-rig.js';
import { poseFor, neutralPose } from './character-pose.js';
// ponytail: character-rig.js imports normalizeShowcaseState/getShowcaseMaterialPalette/
// getShowcaseCharacterShape FROM this file (below) -- a genuine import cycle. It stays safe because
// every export both sides touch is a hoisted `function` declaration (never a top-level call), so both
// bindings are live and initialized before either module body runs createCharacterRig()/createShowcaseAvatar().

const DEFAULT_STATE = Object.freeze({ characterId: 'rally', skinId: 'default' });
const CHARACTER_SHAPES = Object.freeze({
    rally: Object.freeze({ width: 1, height: 1, depth: 1, shoulder: 1 }),
    tank: Object.freeze({ width: 1.18, height: .96, depth: 1.14, shoulder: 1.18 }),
    scout: Object.freeze({ width: .88, height: 1.04, depth: .9, shoulder: .86 }),
    sniper: Object.freeze({ width: .92, height: 1.08, depth: .92, shoulder: .94 }),
    guardian: Object.freeze({ width: 1.1, height: 1, depth: 1.08, shoulder: 1.24 }),
    soldier: Object.freeze({ width: 1.08, height: 1.02, depth: 1.08, shoulder: 1.18 }),
    anchor: Object.freeze({ width: 1.15, height: 1.05, depth: 1.0, shoulder: 1.2 }),
    phantom: Object.freeze({ width: 0.85, height: 1.0, depth: 1.0, shoulder: 0.9 }),
    hardy: Object.freeze({ width: 1.1, height: 1.05, depth: 1.0, shoulder: 1.15 }),
    swift: Object.freeze({ width: 0.9, height: 1.0, depth: 1.0, shoulder: 1.0 })
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

// The 3D stage reads its palette from the same css/ui-tokens.css custom properties the 2D
// menu consumes, so CSS stays the single source of truth for theme colour and a theme
// switch can never leave the stage on a stale palette. Fallbacks are the shipped dark-theme
// values: a missing or unparseable token must degrade to the original look, never to black.
export const STAGE_TOKENS = Object.freeze({ floor: '--ui-surface-2', ring: '--ui-menu-accent' });
export const STAGE_FALLBACK = Object.freeze({ floor: 0x12384d, ring: 0x5af7ef });

// The plinth's emissive is a dim self-glow of its own tint, so it has to follow the theme
// instead of being pinned to a second hard-coded colour.
const stageGlow = floor => mixColor(0x000000, floor, .62);

export function resolveStageTheme(readToken) {
    const read = token => {
        try {
            return typeof readToken === 'function' ? readToken(token) : '';
        } catch {
            return '';
        }
    };
    return Object.freeze({
        floor: hexNumber(read(STAGE_TOKENS.floor), STAGE_FALLBACK.floor),
        ring: hexNumber(read(STAGE_TOKENS.ring), STAGE_FALLBACK.ring)
    });
}

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
    // The base body can be a player-painted 64x64 atlas. Keep the selected
    // hero legible in that case with a separate, non-atlas costume palette.
    // These colours only drive static signature meshes in character-rig.js;
    // they never recolour or mutate a player's saved sheet.
    const identity = hexNumber(character.color, 0xff8844);
    const accent = mixColor(hexNumber(skin.arms, character.color), character.color, .42);
    return Object.freeze({
        head: hexNumber(skin.head, 0xffd8a8),
        body,
        arms: hexNumber(skin.arms, body),
        legs: hexNumber(skin.legs, body),
        accent,
        detail: mixColor(body, 0x071725, .68),
        visor: mixColor(accent, 0xbdfcff, .6),
        identity,
        identityDetail: mixColor(identity, 0x071725, .58)
    });
}

export function getShowcaseCharacterShape(characterId = DEFAULT_STATE.characterId) {
    const id = normalizeId(CHARACTERS, characterId, DEFAULT_STATE.characterId);
    return CHARACTER_SHAPES[id] || CHARACTER_SHAPES.rally;
}

// ponytail: no per-mesh box() building here anymore -- createCharacterRig owns geometry/material/
// palette/shape, this file just wraps it for the shop preview's API + idle sway.
export function createShowcaseAvatar(options = {}) {
    const rig = createCharacterRig({ characterId: options.characterId, skinId: options.skinId });
    const root = new THREE.Group();
    root.name = 'warrball-showcase-avatar';
    root.userData.showcaseAvatar = true;
    // Cosmetics-ready properties for applyEntityCosmetics() from main.js. The root serves
    // as both the scene group and the entity that receives cosmetics.
    root.group = root;
    root.rig = rig;
    root._rigCosmetics = [];
    root.add(rig.root);

    const api = {
        root,
        rig,
        setSkin(skinId) {
            return rig.setSkin(skinId);
        },
        setCharacter(characterId) {
            return rig.setCharacter(characterId);
        },
        sync(value = {}) {
            const next = normalizeShowcaseState({ ...rig.state, ...value });
            rig.setSkin(next.skinId);
            rig.setCharacter(next.characterId);
            return api.state;
        },
        // ponytail: showcase only ever shows an idle stance -- drive poseFor('idle', ...) straight
        // into rig.applyPose rather than pulling in the full createCharacterAnimator controller.
        setPoseTime(seconds = 0, reducedMotion = false) {
            const time = Number.isFinite(seconds) ? seconds : 0;
            const pose = reducedMotion ? neutralPose() : poseFor('idle', time, {});
            rig.applyPose(pose);
            // Frozen at t=0 under reduced motion so socketed cosmetics cannot animate
            // while the rig itself is held in a neutral pose.
            api.onPoseTime?.(reducedMotion ? 0 : time, reducedMotion);
        },
        dispose() {
            if (root.userData.disposed) return;
            root.userData.disposed = true;
            rig.dispose();
            root.removeFromParent?.();
            root.clear?.();
        }
    };
    Object.defineProperty(api, 'state', {
        enumerable: true,
        // rig.state also carries `team`; normalize back down to the showcase's {characterId, skinId} shape.
        get: () => normalizeShowcaseState(rig.state)
    });

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
        // ponytail: rig avatar stands ~2.16 tall (feet at local y=0) vs. the old hand-built box avatar's
        // ~3.45 -- camera distance/target and floor alignment scaled down to match (~0.63x).
        // options.camera lets a wider mount (e.g. the menu hero) pull back without a second renderer.
        const framing = options.camera || {};
        const position = framing.position || [0, 1.3, 4.5];
        const target = framing.target || [0, 1.0, 0];
        this.camera = new THREE.PerspectiveCamera(Number.isFinite(framing.fov) ? framing.fov : 31, 1, .1, 50);
        this.camera.position.set(position[0], position[1], position[2]);
        this.camera.lookAt(target[0], target[1], target[2]);
        this.avatar = createShowcaseAvatar(options);
        this.avatar.root.position.y = -.04;
        this.scene.add(this.avatar.root);

        // Resolved before _buildEnvironment() because the stage tint is read off the
        // document's computed style.
        this._window = ownerDocument?.defaultView || globalThis.window;
        this._document = ownerDocument;

        this._environmentResources = [];
        this._buildEnvironment();
        // Camera sits on +Z while the rig's face is -Z, therefore pi is the
        // actual front-facing rest pose (the old -.26 showed its back first).
        this._yaw = Math.PI;
        this._pitch = -.02;
        this._dragging = false;
        this._lastPointer = null;
        this._running = false;
        this._disposed = false;
        this._elapsed = 0;
        this._lastFrame = null;

        this._motionQuery = this._window?.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this._forcedReducedMotion = false;
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
        this._rimLight = rim;
        this.scene.add(hemi, key, rim);

        const floorGeometry = new THREE.CylinderGeometry(1.75, 2.02, .22, 48);
        const theme = this._readStageTheme();
        const floorMaterial = new THREE.MeshStandardMaterial({
            color: theme.floor,
            roughness: .36,
            metalness: .54,
            emissive: stageGlow(theme.floor),
            emissiveIntensity: .32
        });
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = -.17;
        floor.receiveShadow = true;
        this.scene.add(floor);
        this._floorMaterial = floorMaterial;
        this._environmentResources.push(floorGeometry, floorMaterial);

        const ringGeometry = new THREE.TorusGeometry(1.52, .025, 8, 64);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: theme.ring });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -.045;
        this.scene.add(ring);
        this._ringMaterial = ringMaterial;
        this._environmentResources.push(ringGeometry, ringMaterial);
    }

    _readStageTheme() {
        const getToken = token => {
            if (!this._document) return '';
            const root = this._document.documentElement;
            const style = this._window?.getComputedStyle?.(root);
            const value = style?.getPropertyValue?.(token) || '';
            return value.trim();
        };
        return resolveStageTheme(getToken);
    }

    _applyStageTheme() {
        const theme = this._readStageTheme();
        if (this._floorMaterial) {
            this._floorMaterial.color.setHex(theme.floor);
            this._floorMaterial.emissive.copy(new THREE.Color(stageGlow(theme.floor)));
        }
        if (this._ringMaterial) {
            this._ringMaterial.color.setHex(theme.ring);
        }
    }

    refreshTheme() {
        this._applyStageTheme();
        this._renderFrame();
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
                this._yaw = Math.PI;
                this._pitch = -.02;
            } else return;
            event.preventDefault?.();
            this._renderFrame();
        };
        this._onMotionChange = event => {
            this.reducedMotion = Boolean(event.matches) || this._forcedReducedMotion;
            this.avatar.setPoseTime(this._elapsed, this.reducedMotion);
            this._refreshLoop();
            this._renderFrame();
        };
        this._onThemeChange = () => this.refreshTheme();
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
        this._document?.addEventListener?.('warrball:theme', this._onThemeChange);
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

    // Tints the stage (rim light, plinth, ring) toward a UI theme accent. Never called
    // without an accent, so the shop preview keeps its original fixed palette.
    setAccent(value) {
        const accent = hexNumber(value, 0x5af7ef);
        this._rimLight?.color.setHex(accent);
        this._ringMaterial?.color.setHex(accent);
        this._floorMaterial?.color.setHex(mixColor(0x0d2532, accent, .18));
        this._floorMaterial?.emissive.setHex(mixColor(0x03151c, accent, .14));
        this._renderFrame();
        return accent;
    }

    // In-app accessibility setting, OR-ed with the OS prefers-reduced-motion query so
    // neither source can silently re-enable idle motion for the other.
    setReducedMotion(flag) {
        this._forcedReducedMotion = Boolean(flag);
        this.reducedMotion = this._forcedReducedMotion || Boolean(this._motionQuery?.matches);
        this.avatar.setPoseTime(this._elapsed, this.reducedMotion);
        this._refreshLoop();
        this._renderFrame();
        return this.reducedMotion;
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
        this._document?.removeEventListener?.('warrball:theme', this._onThemeChange);
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
