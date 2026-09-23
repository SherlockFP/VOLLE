// case-reveal-3d.js — the CS2-style "you got it" moment after the case reel settles.
//
// The won item (the real in-game model — built by item-thumbnails.js) spins in on a
// turntable under a rarity-coloured rim light. Epic+ adds a particle burst and a glow
// bloom; legendary+ adds light rays and a harder flare. The in-game Reduce Motion
// setting collapses it to a static hero shot (one render, no loop, no particles);
// the OS-level preference keeps the spin but drops particles/rays (same split as
// ui.js showCaseReel's flash/confetti handling).
//
// Lifecycle: create while the reel is still spinning (context + async shader compile
// happen off the reveal beat), play() when it settles, dispose() when the overlay
// closes — renderer, context, geometry and materials are all released.
// The render loop allocates nothing: timeline samples go into one reused object and
// particles update a preallocated Float32Array in place.
import * as THREE from 'three';
import {
    describeThumbnailItem, buildThumbnailSubject, frameSubject, subjectBounds,
    createStudioEnvironment, createStudioLights, setRarityLighting, rarityLightColor,
    getRadialGlowTexture
} from './item-thumbnails.js';

export const REVEAL_INTRO_SEC = 1.15;
export const REVEAL_INTRO_TURNS = 1.25;
export const REVEAL_IDLE_SPIN = 0.55;      // rad/s turntable after the intro
export const REVEAL_BURST_AT = 0.42;       // fraction of the intro where the burst fires
export const REVEAL_BURST_LIFE = 1.6;      // seconds a particle lives
export const REVEAL_CAMERA_PITCH = 0.16;   // camera looks slightly down onto the turntable

const STAGE_PROFILES = Object.freeze({
    common: Object.freeze({ particles: 0, rays: false, sting: 'none', flare: 1.15 }),
    uncommon: Object.freeze({ particles: 0, rays: false, sting: 'none', flare: 1.2 }),
    rare: Object.freeze({ particles: 0, rays: false, sting: 'soft', flare: 1.45 }),
    epic: Object.freeze({ particles: 56, rays: false, sting: 'epic', flare: 1.9 }),
    legendary: Object.freeze({ particles: 96, rays: true, sting: 'legendary', flare: 2.1 }),
    exotic: Object.freeze({ particles: 120, rays: true, sting: 'legendary', flare: 2.4 })
});

// Pure: presentation profile for a rarity. `reducedMotion` = in-game setting (static
// hero shot); `calmMotion` = OS preference only (spin stays, particles/rays go).
export function revealStageProfile(rarity, { reducedMotion = false, calmMotion = false } = {}) {
    const key = typeof rarity === 'string' ? rarity.trim().toLowerCase() : '';
    const base = STAGE_PROFILES[key] || STAGE_PROFILES.common;
    const still = reducedMotion === true;
    const calm = still || calmMotion === true;
    return {
        rarity: STAGE_PROFILES[key] ? key : 'common',
        static: still,
        spin: !still,
        particles: calm ? 0 : base.particles,
        rays: !calm && base.rays,
        sting: base.sting,
        flare: still ? 1 : base.flare,
        introSec: still ? 0 : REVEAL_INTRO_SEC
    };
}

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

// Pure + allocation-free: samples the reveal at `t` seconds into `out`.
//   scale  — turntable scale (easeOutBack pop-in)
//   angle  — turntable yaw (fast decelerating intro spin + constant idle spin)
//   rim    — rim light multiplier (flares at the burst)
//   glow   — bloom sprite opacity
//   burst  — burst age in seconds (-1 before it fires)
//   rays   — light ray opacity (legendary+)
export function sampleRevealTimeline(t, profile, out = {}) {
    if (!profile || profile.static) {
        out.scale = 1; out.angle = 0; out.rim = 1; out.glow = 0.32; out.burst = -1; out.rays = 0;
        return out;
    }
    const time = Math.max(0, Number(t) || 0);
    const k = clamp01(time / profile.introSec);
    const back = k - 1;
    out.scale = Math.max(0.001, 1 + 2.70158 * back * back * back + 1.70158 * back * back);
    out.angle = REVEAL_INTRO_TURNS * Math.PI * 2 * (1 - (1 - k) * (1 - k) * (1 - k)) + REVEAL_IDLE_SPIN * time;
    const burstAt = profile.introSec * REVEAL_BURST_AT;
    const since = time - burstAt;
    out.burst = since >= 0 ? since : -1;
    const flash = since >= 0 ? Math.exp(-(since * since) / 0.09) : 0;
    out.rim = 1 + (profile.flare - 1) * flash;
    const settleGlow = 0.26 + 0.12 * Math.min(1, profile.flare - 1);
    out.glow = since >= 0 ? settleGlow + (0.9 - settleGlow) * flash : settleGlow * k;
    out.rays = profile.rays && since >= 0 ? Math.min(1, since / 0.45) * (0.55 + 0.35 * flash) : 0;
    return out;
}

function createRevealRenderer() {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    return renderer;
}

// Cheap seeded PRNG so a burst is varied but allocation-free.
function lcg(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

export class CaseReveal3D {
    constructor(mount, desc, profile, { createRenderer = createRevealRenderer, now = () => performance.now() } = {}) {
        this.mount = mount;
        this.desc = desc;
        this.profile = profile;
        this._now = now;
        this.disposed = false;
        this.playing = false;
        this._raf = 0;
        this._t0 = 0;
        this._sample = { scale: 1, angle: 0, rim: 1, glow: 0, burst: -1, rays: 0 };

        // Subject first: if WebGL then fails, only plain JS objects need releasing.
        const subject = buildThumbnailSubject(desc);
        if (!subject?.object) throw new Error('reveal subject unavailable');
        let renderer;
        try {
            renderer = createRenderer();
        } catch (error) {
            subject.dispose();
            throw error;
        }
        this.renderer = renderer;
        const canvas = renderer.domElement;
        canvas.className = 'case-reveal-canvas';
        canvas.setAttribute?.('aria-hidden', 'true');
        mount.appendChild(canvas);

        const scene = new THREE.Scene();
        this.scene = scene;
        this.environment = createStudioEnvironment(renderer);
        scene.environment = this.environment;
        this.lights = createStudioLights(scene);
        setRarityLighting(this.lights, desc.rarity);
        this._rimBase = this.lights.rim.intensity;
        this._kickerBase = this.lights.kicker.intensity;

        this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
        this.turntable = new THREE.Group();
        this.pivot = new THREE.Group();
        this.turntable.add(this.pivot);
        scene.add(this.turntable);

        this.subject = subject;
        this.distance = frameSubject(this.pivot, subject.object, this.camera, desc.kind, { marginScale: 1.14 });
        const posedSize = subjectBounds(this.pivot).getSize(new THREE.Vector3());
        const unit = Math.max(0.05, this.distance * 0.22);
        this._unit = unit;
        const tint = new THREE.Color(rarityLightColor(desc.rarity));

        // Bloom stand-in: an additive rarity-tinted glow card behind the item. Depth-tested
        // so it haloes the silhouette instead of washing over the model.
        const glowMap = getRadialGlowTexture();
        this.glowMaterial = new THREE.SpriteMaterial({
            map: glowMap, color: tint, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        this.glow = new THREE.Sprite(this.glowMaterial);
        this.glow.scale.setScalar(unit * 5.2);
        this.glow.position.z = -unit * 1.6;
        this.glow.renderOrder = -2;
        scene.add(this.glow);

        // Turntable disc: a thin rarity ring under the item.
        this.ringMaterial = new THREE.MeshBasicMaterial({
            color: tint, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide
        });
        const ringRadius = Math.max(posedSize.x, posedSize.z) * 0.62;
        this.ring = new THREE.Mesh(new THREE.RingGeometry(ringRadius * 0.86, ringRadius, 64), this.ringMaterial);
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.position.y = -posedSize.y * 0.56;
        scene.add(this.ring);

        this.rays = null;
        if (profile.rays) {
            const count = 14;
            const positions = new Float32Array(count * 9);
            const reach = unit * 7;
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2;
                const w = 0.07 + (i % 3) * 0.03;
                const o = i * 9;
                positions[o + 3] = Math.cos(a - w) * reach; positions[o + 4] = Math.sin(a - w) * reach;
                positions[o + 6] = Math.cos(a + w) * reach; positions[o + 7] = Math.sin(a + w) * reach;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = new THREE.MeshBasicMaterial({
                color: tint, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
                depthWrite: false, side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = -unit * 2.2;
            mesh.renderOrder = -3;
            scene.add(mesh);
            this.rays = { mesh, material };
        }

        this.particles = null;
        if (profile.particles > 0) {
            const count = profile.particles;
            const positions = new Float32Array(count * 3);
            const velocities = new Float32Array(count * 3);
            const random = lcg(desc.id.length * 7919 + count);
            for (let i = 0; i < count; i++) {
                // Mostly radial in the view plane, a little depth — reads as a burst on screen.
                const a = random() * Math.PI * 2;
                const lift = (random() - 0.35) * 0.8;
                const speed = unit * (2.2 + random() * 3.4);
                velocities[i * 3] = Math.cos(a) * speed;
                velocities[i * 3 + 1] = Math.sin(a) * speed + lift * unit;
                velocities[i * 3 + 2] = (random() - 0.5) * speed * 0.5;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
            const material = new THREE.PointsMaterial({
                color: tint.clone().lerp(new THREE.Color('#ffffff'), 0.35),
                size: unit * 0.2, map: glowMap, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const points = new THREE.Points(geometry, material);
            points.frustumCulled = false;
            points.visible = false;
            scene.add(points);
            this.particles = { points, material, positions, velocities, count };
        }

        this._onResize = () => {
            this._resize();
            // The static hero shot has no loop — redraw it at the new size.
            if (this.profile.static && this.playing && !this.disposed) this._renderStatic();
        };
        this._frame = this._frame.bind(this);
        // Compile every shader variant now, while the reel is still spinning.
        let compiled = null;
        try { compiled = renderer.compileAsync?.(scene, this.camera); } catch { compiled = null; }
        this.ready = Promise.resolve(compiled).then(() => true, () => true);
    }

    _resize() {
        if (this.disposed) return;
        const width = Math.max(1, Math.round(this.mount.clientWidth || 1));
        const height = Math.max(1, Math.round(this.mount.clientHeight || 1));
        const dpr = Math.min(1.75, globalThis.devicePixelRatio || 1);
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(width, height, false);
        const aspect = width / height;
        this.camera.aspect = aspect;
        // Keep the item's height-fit; on a narrow stage fit the width instead.
        const scale = aspect < 1 ? 1 / aspect : 1;
        const distance = this.distance * scale;
        this.camera.position.set(0, Math.sin(REVEAL_CAMERA_PITCH) * distance, Math.cos(REVEAL_CAMERA_PITCH) * distance);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
    }

    _apply(sample) {
        this.turntable.scale.setScalar(sample.scale);
        this.turntable.rotation.y = sample.angle;
        this.lights.rim.intensity = this._rimBase * sample.rim;
        this.lights.kicker.intensity = this._kickerBase * sample.rim;
        this.glowMaterial.opacity = sample.glow;
        this.ringMaterial.opacity = 0.18 + 0.32 * Math.min(1, sample.scale);
        if (this.rays) {
            this.rays.material.opacity = sample.rays * 0.28;
            this.rays.mesh.rotation.z = sample.angle * 0.08;
        }
    }

    _updateParticles(age) {
        const particles = this.particles;
        if (!particles) return;
        if (age < 0 || age > REVEAL_BURST_LIFE) {
            particles.points.visible = false;
            return;
        }
        particles.points.visible = true;
        const { positions, velocities, count } = particles;
        // Closed-form ballistic path with drag — no integration state, no allocation.
        const drag = 1 - Math.exp(-age * 2.4);
        const travel = drag / 2.4;
        const fall = this._unit * 0.9 * age * age;
        for (let i = 0; i < count; i++) {
            const o = i * 3;
            positions[o] = velocities[o] * travel;
            positions[o + 1] = velocities[o + 1] * travel - fall;
            positions[o + 2] = velocities[o + 2] * travel;
        }
        particles.points.geometry.attributes.position.needsUpdate = true;
        const life = age / REVEAL_BURST_LIFE;
        particles.material.opacity = life < 0.08 ? life / 0.08 : 1 - (life - 0.08) / 0.92;
    }

    _renderStatic() {
        sampleRevealTimeline(0, this.profile, this._sample);
        this._apply(this._sample);
        this.renderer.render(this.scene, this.camera);
    }

    _frame(now) {
        if (this.disposed) return;
        const t = (now - this._t0) / 1000;
        sampleRevealTimeline(t, this.profile, this._sample);
        this._apply(this._sample);
        this._updateParticles(this._sample.burst);
        this.renderer.render(this.scene, this.camera);
        this._raf = requestAnimationFrame(this._frame);
    }

    // Starts the reveal once shaders are ready. Resolves true when something is on screen.
    async play() {
        if (this.disposed || this.playing) return !this.disposed;
        this.playing = true;
        await this.ready;
        if (this.disposed) return false;
        this.mount.classList?.add('is-playing');
        window.addEventListener?.('resize', this._onResize);
        this._resize();
        if (this.profile.static) {
            this._renderStatic();
            return true;
        }
        this._t0 = this._now();
        this._raf = requestAnimationFrame(this._frame);
        return true;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame?.(this._raf);
        window.removeEventListener?.('resize', this._onResize);
        this.mount.classList?.remove('is-playing');
        try { this.subject?.dispose(); } catch { /* ignore */ }
        this.subject = null;
        this.ring.geometry.dispose();
        this.ringMaterial.dispose();
        this.glowMaterial.dispose(); // map is the shared glow texture — kept
        if (this.rays) {
            this.rays.mesh.geometry.dispose();
            this.rays.material.dispose();
        }
        if (this.particles) {
            this.particles.points.geometry.dispose();
            this.particles.material.dispose();
        }
        this.environment?.dispose?.();
        this.scene.clear();
        try { this.renderer.dispose(); } catch { /* ignore */ }
        try { this.renderer.forceContextLoss?.(); } catch { /* ignore */ }
        this.renderer.domElement?.remove?.();
    }
}

// Builds a reveal stage for a rolled reward, or null (no WebGL / nothing 3D) so the
// caller keeps the classic reveal.
export function createCaseReveal3D(mount, item, { typeHint = null, reducedMotion = false, calmMotion = false, createRenderer } = {}) {
    if (!mount) return null;
    const desc = describeThumbnailItem(item, typeHint);
    if (!desc) return null;
    const profile = revealStageProfile(desc.rarity, { reducedMotion, calmMotion });
    try {
        return new CaseReveal3D(mount, desc, profile, createRenderer ? { createRenderer } : {});
    } catch {
        mount.querySelector?.('canvas.case-reveal-canvas')?.remove?.();
        return null;
    }
}
