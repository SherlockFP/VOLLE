// js/menu-stage.js — full-viewport Three.js backdrop rendered behind the main menu DOM.
// Owns its own tiny scene (low-poly floor, a handful of drifting shapes, one ball on a
// seeded arcing trail) so it stays a single cheap draw pass instead of reusing the real
// arena/game scene. Layered strictly below the menu panels and the character hero canvas
// (js/shop-showcase.js), which keeps rendering exactly as before.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) -- the floating shape layout and the ball's
// arcing path must look identical on every menu visit, so nothing below this
// point may call Math.random().
// ---------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function rand() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const DEFAULT_SEED = 0xB411F00D;

// The stage reads its palette from the same css/ui-tokens.css custom properties the rest
// of the menu chrome consumes (see css/polish.css #main-menu), so a theme switch can never
// leave the backdrop on a stale palette. --ui-menu-stage is a gradient (it is used as a CSS
// background elsewhere), so its "color" here is the first stop parsed out of that string.
export const STAGE_TOKENS = Object.freeze({
    bg: '--ui-bg',
    accent: '--ui-menu-accent',
    glowA: '--ui-menu-glow-a',
    glowB: '--ui-menu-glow-b',
    stage: '--ui-menu-stage'
});

// Fallbacks are the shipped dark-theme values: a missing or unparseable token must degrade
// to the original look, never to black.
export const STAGE_FALLBACK = Object.freeze({
    bg: 0x06151b,
    accent: 0x5ee7f7,
    glowA: 0xf04455,
    glowB: 0x3b82f6,
    stage: 0x1c3a48
});

function parseCssColor(value) {
    if (typeof value !== 'string' || !value) return null;
    let match = value.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
    if (match) {
        let hex = match[1];
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return Number.parseInt(hex, 16);
    }
    match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    const channel = raw => Math.max(0, Math.min(255, Math.round(Number.parseFloat(raw)) || 0));
    return (channel(match[1]) << 16) | (channel(match[2]) << 8) | channel(match[3]);
}

export function resolveMenuStageTheme(readToken) {
    const read = token => {
        try {
            return typeof readToken === 'function' ? readToken(token) : '';
        } catch {
            return '';
        }
    };
    const theme = {};
    for (const key of Object.keys(STAGE_TOKENS)) {
        const parsed = parseCssColor(read(STAGE_TOKENS[key]));
        theme[key] = parsed === null ? STAGE_FALLBACK[key] : parsed;
    }
    return Object.freeze(theme);
}

// ---------------------------------------------------------------------------
// Seeded scene layout -- pure functions so determinism is testable without a renderer.
// ---------------------------------------------------------------------------
const SHAPE_COUNT = 7;

export function seededShapeLayout(seed = DEFAULT_SEED, count = SHAPE_COUNT) {
    const rand = mulberry32(seed);
    const shapes = [];
    for (let i = 0; i < count; i++) {
        shapes.push(Object.freeze({
            kind: i % 2 === 0 ? 'box' : 'octahedron',
            radius: 9 + rand() * 15,
            angle: rand() * Math.PI * 2,
            baseHeight: 3 + rand() * 8,
            bobAmp: 0.6 + rand() * 1.1,
            bobFreq: 0.18 + rand() * 0.22,
            spinSpeed: (rand() - 0.5) * 0.5,
            scale: 0.7 + rand() * 0.9,
            phase: rand() * Math.PI * 2
        }));
    }
    return shapes;
}

function seededOrbitParams(seed) {
    const rand = mulberry32(seed);
    return Object.freeze({
        radiusX: 15 + rand() * 6,
        radiusZ: 10 + rand() * 5,
        baseHeight: 5 + rand() * 2,
        heightAmp: 2 + rand() * 1.4,
        freq: 0.1 + rand() * 0.05,
        heightFreq: 0.3 + rand() * 0.18,
        phase: rand() * Math.PI * 2
    });
}

function computeBallPoint(t, params, out) {
    const angle = t * params.freq + params.phase;
    out.x = Math.cos(angle) * params.radiusX;
    out.y = params.baseHeight + Math.sin(t * params.heightFreq + params.phase * 1.7) * params.heightAmp;
    out.z = Math.sin(angle) * params.radiusZ;
    return out;
}

// Pure convenience wrapper for tests/callers that just want a point. The live renderer
// instead caches seededOrbitParams() once per instance and reuses a single scratch object
// per frame (see _advance) so the render loop never allocates.
export function ballPathAt(t, seed = DEFAULT_SEED) {
    return computeBallPoint(t, seededOrbitParams(seed), { x: 0, y: 0, z: 0 });
}

// Exact three.js r170 triangle counts for the primitive kinds used below (not sampled --
// derived from each geometry's known face formula), so getStats()'s triangleEstimate is a
// real number, not a guess.
const TRIANGLES = Object.freeze({
    cylinder: (radialSegments, heightSegments = 1) => radialSegments * 2 * (heightSegments + 1),
    box: () => 12,
    octahedron: () => 8,
    torus: (radialSegments, tubularSegments) => radialSegments * tubularSegments * 2,
    sphere: (widthSegments, heightSegments) => widthSegments * 2 * (heightSegments - 1)
});

const FLOOR_RADIUS = 44;
const FLOOR_RADIAL_SEGMENTS = 8;
const RING_RADIAL_SEGMENTS = 3;
const RING_TUBULAR_SEGMENTS = 10;
const BALL_WIDTH_SEGMENTS = 8;
const BALL_HEIGHT_SEGMENTS = 6;
const TRAIL_WIDTH_SEGMENTS = 5;
const TRAIL_HEIGHT_SEGMENTS = 4;
const TRAIL_LENGTH = 10;
const ORBIT_PERIOD_SECONDS = 90;
const ORBIT_RADIUS = 34;
const ORBIT_HEIGHT = 15;
const MAX_PIXEL_RATIO = 1.5;
// Backing-buffer budget independent of devicePixelRatio -- a 4K display gets scaled back
// down to this pixel count instead of paying full native resolution for a decorative pass.
const MAX_BACKING_PIXELS = 1280 * 900;

const isCanvas = value => String(value?.tagName || '').toLowerCase() === 'canvas';

export class MenuStageRenderer {
    constructor(options = {}) {
        const ownerWindow = options.window || globalThis.window;
        const ownerDocument = options.document || ownerWindow?.document || globalThis.document;
        this._window = ownerWindow;
        this._document = ownerDocument;

        this._ownsCanvas = !isCanvas(options.canvas) && Boolean(options.container);
        this.canvas = isCanvas(options.canvas)
            ? options.canvas
            : (options.container ? ownerDocument?.createElement?.('canvas') : null);
        if (!this.canvas) throw new TypeError('createMenuStage requires options.canvas or options.container.');
        if (this._ownsCanvas) options.container.appendChild?.(this.canvas);

        this._geometries = [];
        this._materials = [];
        this._disposedGeometries = 0;
        this._disposedMaterials = 0;
        this._triangleEstimate = 0;
        this._drawCalls = 0;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'low-power'
        });
        // Transparent clear: the CSS menu background (its own red/blue ambient glow
        // gradients) shows through anywhere the 3D scene itself doesn't draw.
        this.renderer.setClearColor?.(0x000000, 0);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(38, 1, 1, 220);

        this._seed = Number.isFinite(options.seed) ? options.seed : DEFAULT_SEED;
        this._ballParams = seededOrbitParams(this._seed);
        this._ballScratch = { x: 0, y: 0, z: 0 };
        this._shapeLayout = seededShapeLayout(this._seed);

        this._buildScene();

        this._elapsed = 0;
        this._lastFrame = null;
        this._running = false;
        this._disposed = false;

        this._motionQuery = this._window?.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
        this._forcedReducedMotion = false;
        this.reducedMotion = Boolean(this._motionQuery?.matches);

        this._bindEvents();
        this.resize();
        if (options.autoStart !== false) this.start();
    }

    _trackGeometry(geometry, triangleCount) {
        this._geometries.push(geometry);
        this._triangleEstimate += triangleCount;
        return geometry;
    }

    _trackMaterial(material) {
        this._materials.push(material);
        return material;
    }

    _readTheme() {
        const getToken = token => {
            if (!this._document) return '';
            const root = this._document.documentElement;
            const style = this._window?.getComputedStyle?.(root);
            const value = style?.getPropertyValue?.(token) || '';
            return value.trim();
        };
        return resolveMenuStageTheme(getToken);
    }

    _buildScene() {
        const theme = this._readTheme();

        // Deep-navy fog: geometry recedes toward the theme background color instead of a
        // hard silhouette edge, so the low-poly scene reads as bleeding into the page.
        this.scene.fog = new THREE.Fog(theme.bg, 26, 78);

        const hemi = new THREE.HemisphereLight(0xdff3ff, theme.bg, 1.6);
        const key = new THREE.DirectionalLight(0xffffff, 1.4);
        key.position.set(-18, 26, 12);
        this.scene.add(hemi);
        this.scene.add(key);
        this._hemiLight = hemi;
        this._keyLight = key;

        // Floor -- a faceted disc reads as a stylised court without paying for a real
        // arena mesh (js/arena.js is not touched by this module).
        const floorGeometry = this._trackGeometry(
            new THREE.CylinderGeometry(FLOOR_RADIUS, FLOOR_RADIUS * 0.96, 1.4, FLOOR_RADIAL_SEGMENTS, 1, false),
            TRIANGLES.cylinder(FLOOR_RADIAL_SEGMENTS)
        );
        const floorMaterial = this._trackMaterial(new THREE.MeshToonMaterial({ color: theme.stage }));
        const floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.position.y = -6;
        this.scene.add(floor);
        this._floorMaterial = floorMaterial;
        this._drawCalls += 1;

        const ringGeometry = this._trackGeometry(
            new THREE.TorusGeometry(FLOOR_RADIUS * 0.97, 0.22, RING_RADIAL_SEGMENTS, RING_TUBULAR_SEGMENTS),
            TRIANGLES.torus(RING_RADIAL_SEGMENTS, RING_TUBULAR_SEGMENTS)
        );
        const ringMaterial = this._trackMaterial(new THREE.MeshBasicMaterial({ color: theme.accent }));
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -5.3;
        this.scene.add(ring);
        this._ringMaterial = ringMaterial;
        this._drawCalls += 1;

        // Floating shapes -- geometry is shared per kind (two families) even though each
        // mesh drifts on its own seeded orbit, so only 2 geometries are created for 7 meshes.
        const boxGeometry = this._trackGeometry(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0);
        const octGeometry = this._trackGeometry(new THREE.OctahedronGeometry(1.1, 0), 0);
        const shapeMaterialA = this._trackMaterial(new THREE.MeshToonMaterial({ color: theme.accent }));
        const shapeMaterialB = this._trackMaterial(new THREE.MeshToonMaterial({ color: theme.stage }));
        this._shapeGroup = new THREE.Group();
        this._shapeMeshes = this._shapeLayout.map(shape => {
            const geometry = shape.kind === 'box' ? boxGeometry : octGeometry;
            const material = shape.kind === 'box' ? shapeMaterialA : shapeMaterialB;
            const mesh = new THREE.Mesh(geometry, material);
            mesh.scale.set(shape.scale, shape.scale, shape.scale);
            this._shapeGroup.add(mesh);
            this._triangleEstimate += shape.kind === 'box' ? TRIANGLES.box() : TRIANGLES.octahedron();
            this._drawCalls += 1;
            return mesh;
        });
        this.scene.add(this._shapeGroup);
        this._shapeMaterialA = shapeMaterialA;
        this._shapeMaterialB = shapeMaterialB;

        // Ball + trail -- the trail is a fixed pool of small spheres sharing one geometry;
        // _advance() only ever mutates existing positions, never allocates new meshes.
        const ballGeometry = this._trackGeometry(
            new THREE.SphereGeometry(0.85, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS),
            TRIANGLES.sphere(BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS)
        );
        const ballMaterial = this._trackMaterial(new THREE.MeshToonMaterial({ color: theme.accent }));
        this._ball = new THREE.Mesh(ballGeometry, ballMaterial);
        this.scene.add(this._ball);
        this._ballMaterial = ballMaterial;
        this._drawCalls += 1;

        const trailGeometry = this._trackGeometry(
            new THREE.SphereGeometry(0.85, TRAIL_WIDTH_SEGMENTS, TRAIL_HEIGHT_SEGMENTS),
            0
        );
        this._trailHistory = Array.from({ length: TRAIL_LENGTH }, () => ({ x: 0, y: 0, z: 0 }));
        this._trailMeshes = Array.from({ length: TRAIL_LENGTH }, (_, i) => {
            const fade = 1 - (i + 1) / (TRAIL_LENGTH + 1);
            const material = this._trackMaterial(new THREE.MeshBasicMaterial({
                color: theme.accent,
                transparent: true,
                opacity: fade * 0.5
            }));
            const mesh = new THREE.Mesh(trailGeometry, material);
            const scale = 0.25 + fade * 0.55;
            mesh.scale.set(scale, scale, scale);
            this.scene.add(mesh);
            this._triangleEstimate += TRIANGLES.sphere(TRAIL_WIDTH_SEGMENTS, TRAIL_HEIGHT_SEGMENTS);
            this._drawCalls += 1;
            return mesh;
        });
    }

    _applyTheme() {
        const theme = this._readTheme();
        this._floorMaterial?.color.setHex(theme.stage);
        this._ringMaterial?.color.setHex(theme.accent);
        this._ballMaterial?.color.setHex(theme.accent);
        this._shapeMaterialA?.color.setHex(theme.accent);
        this._shapeMaterialB?.color.setHex(theme.stage);
        for (const mesh of this._trailMeshes || []) mesh.material.color.setHex(theme.accent);
        this.scene.fog?.color.setHex(theme.bg);
    }

    refreshTheme() {
        this._applyTheme();
        this._renderFrame();
    }

    _bindEvents() {
        this._onVisibilityChange = () => this._refreshLoop();
        this._onResize = () => this.resize();
        this._onMotionChange = event => {
            this.reducedMotion = Boolean(event.matches) || this._forcedReducedMotion;
            if (this.reducedMotion) this._advance(this._elapsed);
            this._refreshLoop();
            this._renderFrame();
        };
        this._onThemeMutation = () => this.refreshTheme();

        this._document?.addEventListener?.('visibilitychange', this._onVisibilityChange);
        this._window?.addEventListener?.('resize', this._onResize);
        if (this._motionQuery?.addEventListener) this._motionQuery.addEventListener('change', this._onMotionChange);
        else this._motionQuery?.addListener?.(this._onMotionChange);

        // Theme switches flip <html data-theme="..."> (js/ui-theme.js); observing the
        // attribute directly (rather than a custom event) keeps this module decoupled
        // from js/ui.js/js/main.js theme plumbing.
        const ObserverClass = this._window?.MutationObserver || globalThis.MutationObserver;
        const root = this._document?.documentElement;
        this._themeObserver = ObserverClass && root ? new ObserverClass(this._onThemeMutation) : null;
        this._themeObserver?.observe?.(root, { attributes: true, attributeFilter: ['data-theme'] });

        this._animate = time => {
            const seconds = (Number(time) || 0) / 1000;
            const delta = this._lastFrame === null ? 0 : Math.min(.1, Math.max(0, seconds - this._lastFrame));
            this._lastFrame = seconds;
            this._elapsed += delta;
            this._advance(this._elapsed);
            this._renderFrame();
        };
    }

    // Advances every animated part of the scene in place -- no allocation, so this is safe
    // to call every frame (and once, for the reduced-motion static frame).
    _advance(elapsed) {
        const orbitAngle = (elapsed / ORBIT_PERIOD_SECONDS) * Math.PI * 2;
        this.camera.position.set(
            Math.cos(orbitAngle) * ORBIT_RADIUS,
            ORBIT_HEIGHT,
            Math.sin(orbitAngle) * ORBIT_RADIUS
        );
        this.camera.lookAt(0, -2, 0);

        for (let i = 0; i < this._shapeMeshes.length; i++) {
            const shape = this._shapeLayout[i];
            const mesh = this._shapeMeshes[i];
            const bob = Math.sin(elapsed * shape.bobFreq + shape.phase) * shape.bobAmp;
            mesh.position.set(
                Math.cos(shape.angle) * shape.radius,
                shape.baseHeight + bob,
                Math.sin(shape.angle) * shape.radius
            );
            mesh.rotation.y = shape.phase + elapsed * shape.spinSpeed;
            mesh.rotation.x = elapsed * shape.spinSpeed * 0.5;
        }

        computeBallPoint(elapsed, this._ballParams, this._ballScratch);
        this._ball.position.set(this._ballScratch.x, this._ballScratch.y, this._ballScratch.z);

        // Ring-buffer trail: shift history back one slot, stamp the current ball point into
        // slot 0. Fixed-size array, no allocation.
        for (let i = this._trailHistory.length - 1; i > 0; i--) {
            const dst = this._trailHistory[i];
            const src = this._trailHistory[i - 1];
            dst.x = src.x; dst.y = src.y; dst.z = src.z;
        }
        this._trailHistory[0].x = this._ballScratch.x;
        this._trailHistory[0].y = this._ballScratch.y;
        this._trailHistory[0].z = this._ballScratch.z;
        for (let i = 0; i < this._trailMeshes.length; i++) {
            const point = this._trailHistory[i];
            this._trailMeshes[i].position.set(point.x, point.y, point.z);
        }
    }

    _refreshLoop() {
        const shouldAnimate = this._running && !this._disposed && !this.reducedMotion && !this._document?.hidden;
        this.renderer.setAnimationLoop?.(shouldAnimate ? this._animate : null);
        if (!shouldAnimate) this._lastFrame = null;
    }

    _renderFrame() {
        if (this._disposed) return;
        this.renderer.render(this.scene, this.camera);
    }

    // In-app accessibility setting, OR-ed with the OS prefers-reduced-motion query (same
    // pattern as js/shop-showcase.js) so neither source can silently re-enable motion.
    setReducedMotion(flag) {
        this._forcedReducedMotion = Boolean(flag);
        this.reducedMotion = this._forcedReducedMotion || Boolean(this._motionQuery?.matches);
        if (this.reducedMotion) this._advance(this._elapsed);
        this._refreshLoop();
        this._renderFrame();
        return this.reducedMotion;
    }

    start() {
        if (this._disposed) return false;
        this._running = true;
        if (this.reducedMotion) this._advance(this._elapsed);
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
        const nextWidth = Math.max(1, Math.round(Number(width) || this._window?.innerWidth || this.canvas.clientWidth || 1));
        const nextHeight = Math.max(1, Math.round(Number(height) || this._window?.innerHeight || this.canvas.clientHeight || 1));
        const rawDpr = Number(this._window?.devicePixelRatio) || 1;
        let ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, rawDpr));
        const totalPixels = nextWidth * nextHeight * ratio * ratio;
        if (totalPixels > MAX_BACKING_PIXELS) ratio *= Math.sqrt(MAX_BACKING_PIXELS / totalPixels);
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
        this._document?.removeEventListener?.('visibilitychange', this._onVisibilityChange);
        this._window?.removeEventListener?.('resize', this._onResize);
        if (this._motionQuery?.removeEventListener) this._motionQuery.removeEventListener('change', this._onMotionChange);
        else this._motionQuery?.removeListener?.(this._onMotionChange);
        this._themeObserver?.disconnect?.();
        for (const material of this._materials) {
            material.dispose?.();
            this._disposedMaterials += 1;
        }
        for (const geometry of this._geometries) {
            geometry.dispose?.();
            this._disposedGeometries += 1;
        }
        this.renderer.dispose?.();
        if (this._ownsCanvas) this.canvas.remove?.();
    }

    // Own instrumentation: resource accounting for dispose coverage, plus draw-call/
    // triangle numbers computed at scene-build time (see report for the concrete totals).
    getStats() {
        return Object.freeze({
            geometriesCreated: this._geometries.length,
            materialsCreated: this._materials.length,
            geometriesDisposed: this._disposedGeometries,
            materialsDisposed: this._disposedMaterials,
            drawCalls: this._drawCalls,
            triangleEstimate: this._triangleEstimate
        });
    }
}

export function createMenuStage(options = {}) {
    return new MenuStageRenderer(options);
}
