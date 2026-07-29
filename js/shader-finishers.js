// shader-finishers.js — skin-driven elimination / round-end shader effects.
// The generic burst, screen shake, flash and hit-stop already live in js/juice.js,
// and per-skin ball trails live in js/ball.js (trailStyle). This module only adds
// the elimination / round-end shader layer, which neither of those covers.
import * as THREE from 'three';
import { finisherVertexShader } from './shaders/finisher.vert.js';
import { finisherFragmentShader } from './shaders/finisher.frag.js';
import { BALL_SKINS } from './ball.js';

// Keyed on the ball skin's own `effect` field, not on 40+ skin ids — ball.js
// already classifies every skin, so one row per family is the whole mapping.
// Skins whose effect is outside these four (spark, prism, pixel, toxic, ...)
// are an intentional silent no-op; they are not forced into a variant.
export const SKIN_FINISHERS = {
    void: { variant: 0, durationMs: 900, particleCount: 120 },
    flame: { variant: 1, durationMs: 750, particleCount: 160 },
    glitch: { variant: 2, durationMs: 850, particleCount: 140 },
    frost: { variant: 3, durationMs: 1000, particleCount: 100 }
};

// Team colours for the round-end spark layer. The shader shell always keeps the
// skin colour, so team ownership stays readable without the tint hiding the skin.
const TEAM_TINT = { red: 0xff4455, blue: 0x4488ff, 0: 0xff4455, 1: 0x4488ff };

// ponytail: hard cap instead of a pool — effects live under a second and the
// arena rarely stacks more than a few kills at once. Pool it if that changes.
const MAX_ACTIVE = 8;

// Reused by playRoundEnd so the celebration path allocates no vector per call.
const _center = new THREE.Vector3();

// ponytail: one scratch config reused by _resolve — it is consumed synchronously
// by the _spawn call on the very next line, so no aliasing is possible.
const _cfg = { variant: 0, durationMs: 0, particleCount: 0, color: 0 };

export class ShaderFinishers {
    constructor() {
        // Constructor touches nothing but fields: this runs at import time,
        // before the DOM or the Three.js scene exists.
        this.active = [];
        this._raf = 0;
        this._lastTs = 0;
        this._hostTicked = false;
        this._tick = this._tick.bind(this);
    }

    playElimination({ skinId, position, scene, camera } = {}) {
        const cfg = this._resolve(skinId, scene);
        if (!cfg || !position) return;
        // camera is unused: the effect is world-space geometry parented to the
        // scene, so it renders correctly through whatever camera the host uses.
        this._spawn(cfg, scene, position, 0.9, cfg.durationMs, 1.0, cfg.particleCount, cfg.color);
    }

    playRoundEnd({ skinId, scene, camera, winnerTeam } = {}) {
        const cfg = this._resolve(skinId, scene);
        if (!cfg) return;
        // No position in the contract — celebrate above the arena centre.
        _center.set(0, 3.5, 0);
        const tint = TEAM_TINT[winnerTeam] ?? cfg.color;
        this._spawn(cfg, scene, _center, 3.4, cfg.durationMs * 2.2, 1.6, cfg.particleCount * 2, tint);
    }

    // Host loop drives this. Zero allocation: every vector maths step writes
    // into typed arrays that were sized once at spawn time.
    update(dt) {
        this._hostTicked = true;
        if (this._raf !== 0) {
            cancelAnimationFrame(this._raf);
            this._raf = 0;
        }
        this._step(dt);
    }

    clear() {
        for (let i = 0; i < this.active.length; i++) this._destroy(this.active[i]);
        this.active.length = 0;
        if (this._raf !== 0) {
            cancelAnimationFrame(this._raf);
            this._raf = 0;
        }
    }

    // --- internals ---

    // Ball skin id -> its `effect` family -> finisher row, with the colour taken
    // from the skin's own glow so the effect matches the ball the player sees.
    _resolve(skinId, scene) {
        if (!scene) return null;
        const skin = BALL_SKINS[skinId];
        const row = skin && SKIN_FINISHERS[skin.effect];
        if (!row) return null;
        if (typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return null;
        _cfg.variant = row.variant;
        _cfg.durationMs = row.durationMs;
        _cfg.particleCount = row.particleCount;
        _cfg.color = skin.glow ?? skin.trail ?? skin.color;
        return _cfg;
    }

    _spawn(cfg, scene, position, scale, durationMs, intensity, particleCount, particleColor) {
        if (this.active.length >= MAX_ACTIVE) {
            this._destroy(this.active[0]);
            this.active[0] = this.active[this.active.length - 1];
            this.active.pop();
        }

        const uniforms = {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uIntensity: { value: intensity },
            uVariant: { value: cfg.variant },
            uColor: { value: new THREE.Color(cfg.color) }
        };
        const material = new THREE.ShaderMaterial({
            vertexShader: finisherVertexShader,
            fragmentShader: finisherFragmentShader,
            uniforms,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            // dark-eater subtracts light, so it cannot use additive blending.
            blending: cfg.variant === 0 ? THREE.NormalBlending : THREE.AdditiveBlending
        });
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 3), material);
        mesh.position.copy(position);
        mesh.frustumCulled = false;
        scene.add(mesh);

        const count = Math.max(1, particleCount | 0);
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const t = Math.random() * Math.PI * 2;
            const z = Math.random() * 2 - 1;
            const r = Math.sqrt(1 - z * z);
            const speed = (2 + Math.random() * 6) * scale;
            velocities[i * 3] = Math.cos(t) * r * speed;
            velocities[i * 3 + 1] = z * speed + 2;
            velocities[i * 3 + 2] = Math.sin(t) * r * speed;
        }
        const pGeom = new THREE.BufferGeometry();
        pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        // ponytail: PointsMaterial covers skin-tinted sparks; no second shader pair.
        const pMat = new THREE.PointsMaterial({
            color: particleColor,
            size: 0.12 * scale,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const points = new THREE.Points(pGeom, pMat);
        points.position.copy(position);
        points.frustumCulled = false;
        scene.add(points);

        this.active.push({
            scene, mesh, points, uniforms, positions, velocities, count,
            elapsed: 0,
            duration: durationMs / 1000,
            baseOpacity: pMat.opacity
        });
        this._ensureTicking();
    }

    _step(dt) {
        for (let i = this.active.length - 1; i >= 0; i--) {
            const e = this.active[i];
            e.elapsed += dt;
            const p = e.elapsed / e.duration;
            if (p >= 1) {
                this._destroy(e);
                // Swap-pop: order is irrelevant and pop() allocates nothing.
                this.active[i] = this.active[this.active.length - 1];
                this.active.pop();
                continue;
            }
            e.uniforms.uProgress.value = p;
            e.uniforms.uTime.value += dt;

            const pos = e.positions;
            const vel = e.velocities;
            for (let j = 0; j < e.count; j++) {
                const k = j * 3;
                vel[k + 1] -= 14 * dt;
                pos[k] += vel[k] * dt;
                pos[k + 1] += vel[k + 1] * dt;
                pos[k + 2] += vel[k + 2] * dt;
            }
            e.points.geometry.attributes.position.needsUpdate = true;
            e.points.material.opacity = e.baseOpacity * (1 - p * p);
        }
        if (this.active.length === 0 && this._raf !== 0) {
            cancelAnimationFrame(this._raf);
            this._raf = 0;
        }
    }

    // Fallback only: if the host never calls update(), self-drive via RAF.
    _ensureTicking() {
        if (this._hostTicked || this._raf !== 0) return;
        if (typeof requestAnimationFrame !== 'function') return;
        this._lastTs = 0;
        this._raf = requestAnimationFrame(this._tick);
    }

    _tick(ts) {
        this._raf = 0;
        if (this._hostTicked) return;
        const dt = this._lastTs === 0 ? 1 / 60 : Math.min(0.1, (ts - this._lastTs) / 1000);
        this._lastTs = ts;
        this._step(dt);
        if (this.active.length > 0) this._raf = requestAnimationFrame(this._tick);
    }

    _destroy(e) {
        e.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
        e.scene.remove(e.points);
        e.points.geometry.dispose();
        e.points.material.dispose();
    }
}

export const shaderFinishers = new ShaderFinishers();
