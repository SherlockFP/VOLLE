// weather.js — Rain, snow, and storm (rain + lightning) particle system.
//
// Everything moves on the GPU: each drop/flake keeps a fixed seed position and
// the vertex shader derives where it is from one `uTime` uniform, wrapping the
// particles through a box that follows the camera (`cameraPosition`). So the
// weather is dense wherever the player looks, costs one draw call and zero
// per-frame JS work (no buffer uploads), and never runs out at the court edge.
// Particles fade out close to the lens (same idea as the arena's ambient
// points) and rain is drawn as 1 px streaks, so neither can smear the view.
import * as THREE from 'three';

// Particle budget per quality tier ('low' also covers hub-performance mode).
export const WEATHER_PARTICLE_COUNTS = Object.freeze({
    low: Object.freeze({ rain: 900, snow: 700 }),
    medium: Object.freeze({ rain: 2000, snow: 1400 }),
    high: Object.freeze({ rain: 3000, snow: 2200 })
});

const RAIN_BOX = 64;     // horizontal size of the camera-centred volume (m)
const RAIN_HEIGHT = 34;  // vertical size; the volume starts ~10 m below the eye
const SNOW_BOX = 56;
const SNOW_HEIGHT = 26;

const RAIN_VERTEX = `
uniform float uTime;
uniform float uBox;
uniform float uHeight;
uniform vec2 uWind;
attribute vec4 aDrop; // speed, streak length, unused, 0 = head / 1 = tail
varying float vAlpha;
void main() {
    float bottom = cameraPosition.y - uHeight * 0.3;
    float y = mod(position.y - uTime * aDrop.x - bottom, uHeight) + bottom;
    vec2 drift = position.xz + uWind * uTime;
    vec2 xz = cameraPosition.xz + mod(drift - cameraPosition.xz + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 p = vec3(xz.x, y, xz.y);
    // The tail trails up-wind of the head, so streaks slant with the wind.
    vec3 dir = normalize(vec3(-uWind.x, aDrop.x, -uWind.y));
    p += dir * aDrop.y * aDrop.w;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float near = smoothstep(1.4, 4.5, -mv.z);
    float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(xz - cameraPosition.xz));
    float vertical = smoothstep(0.0, 3.0, y - bottom) * (1.0 - smoothstep(uHeight - 4.0, uHeight, y - bottom));
    vAlpha = near * edge * vertical * mix(1.0, 0.35, aDrop.w);
}`;

const RAIN_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}`;

const SNOW_VERTEX = `
uniform float uTime;
uniform float uBox;
uniform float uHeight;
uniform vec2 uWind;
uniform float uPointScale;
attribute vec3 aFlake; // fall speed, size (m), phase
varying float vAlpha;
void main() {
    float bottom = cameraPosition.y - uHeight * 0.3;
    float y = mod(position.y - uTime * aFlake.x - bottom, uHeight) + bottom;
    float ph = aFlake.z * 6.2831;
    vec2 sway = vec2(sin(uTime * 0.9 + ph), cos(uTime * 0.7 + ph * 1.3)) * 0.7;
    vec2 drift = position.xz + uWind * uTime + sway;
    vec2 xz = cameraPosition.xz + mod(drift - cameraPosition.xz + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aFlake.y * uPointScale / max(-mv.z, 0.1), 9.0);
    float near = smoothstep(0.8, 2.6, -mv.z);
    float edge = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(xz - cameraPosition.xz));
    float vertical = smoothstep(0.0, 2.0, y - bottom) * (1.0 - smoothstep(uHeight - 3.0, uHeight, y - bottom));
    vAlpha = near * edge * vertical;
}`;

const SNOW_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = 1.0 - smoothstep(0.18, 0.5, d);
    if (disc * vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor, uOpacity * disc * vAlpha);
}`;

// Seeded so a weather system's layout is stable (visual only — the network-
// relevant part, *which* weather a map has, is rolled in js/arena.js).
function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class WeatherSystem {
    // options: { quality: 'low' | 'medium' | 'high', wind: [x, z], rainColor, snowColor }
    constructor(scene, arenaBounds, options = {}) {
        this.scene = scene;
        this.bounds = arenaBounds;
        this.maxY = arenaBounds?.maxY || 30;
        this.quality = WEATHER_PARTICLE_COUNTS[options.quality] ? options.quality : 'medium';
        this.options = options;
        this.type = 'none';
        this.group = new THREE.Group();
        this.group.name = 'weather';
        this.group.userData.passThrough = true;
        this.scene.add(this.group);
        this.uniforms = {
            uTime: { value: 0 },
            uWind: { value: new THREE.Vector2(...(options.wind || [1.2, 0.6])) }
        };

        this.rainCount = WEATHER_PARTICLE_COUNTS[this.quality].rain;
        this.snowCount = WEATHER_PARTICLE_COUNTS[this.quality].snow;
        this.rainMesh = null;
        this.snowMesh = null;

        // Lightning: no geometry — Arena reads flashIntensity and lights the sky.
        this.lightning = false;
        this.lightningTimer = 0;
        this.lightningInterval = 4 + Math.random() * 6;
        this.flashIntensity = 0;
        this._thunderPlayed = true;
        this._thunderCtx = null;
    }

    setWeather(type) {
        this.clear();
        this.type = type || 'none';
        if (this.type === 'rain' || this.type === 'storm') this._initRain();
        if (this.type === 'snow') this._initSnow();
        if (this.type === 'storm') this._initLightning();
    }

    _initRain() {
        const count = this.rainCount;
        const rand = seededRandom(0x5eed + count);
        const positions = new Float32Array(count * 6);
        const drops = new Float32Array(count * 8);
        for (let i = 0; i < count; i++) {
            const x = (rand() - 0.5) * RAIN_BOX;
            const y = rand() * RAIN_HEIGHT;
            const z = (rand() - 0.5) * RAIN_BOX;
            const speed = 26 + rand() * 12;
            const length = 0.55 + rand() * 0.5;
            for (let v = 0; v < 2; v++) {
                positions.set([x, y, z], i * 6 + v * 3);
                drops.set([speed, length, 0, v], i * 8 + v * 4);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('aDrop', new THREE.Float32BufferAttribute(drops, 4));
        const mat = new THREE.ShaderMaterial({
            vertexShader: RAIN_VERTEX,
            fragmentShader: RAIN_FRAGMENT,
            uniforms: {
                uTime: this.uniforms.uTime,
                uWind: this.uniforms.uWind,
                uBox: { value: RAIN_BOX },
                uHeight: { value: RAIN_HEIGHT },
                uColor: { value: new THREE.Color(this.options.rainColor ?? 0xaabbd8) },
                uOpacity: { value: 0.42 }
            },
            transparent: true,
            depthWrite: false,
            fog: false
        });
        this.rainMesh = new THREE.LineSegments(geo, mat);
        this.rainMesh.frustumCulled = false;
        this.rainMesh.renderOrder = 5;
        this.group.add(this.rainMesh);
    }

    _initSnow() {
        const count = this.snowCount;
        const rand = seededRandom(0xf1a6e + count);
        const positions = new Float32Array(count * 3);
        const flakes = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (rand() - 0.5) * SNOW_BOX;
            positions[i * 3 + 1] = rand() * SNOW_HEIGHT;
            positions[i * 3 + 2] = (rand() - 0.5) * SNOW_BOX;
            flakes[i * 3] = 0.7 + rand() * 0.9;       // slow, drifting fall
            flakes[i * 3 + 1] = 0.05 + rand() * 0.07;  // flake diameter (m)
            flakes[i * 3 + 2] = rand();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('aFlake', new THREE.Float32BufferAttribute(flakes, 3));
        const mat = new THREE.ShaderMaterial({
            vertexShader: SNOW_VERTEX,
            fragmentShader: SNOW_FRAGMENT,
            uniforms: {
                uTime: this.uniforms.uTime,
                uWind: { value: this.uniforms.uWind.value.clone().multiplyScalar(0.35) },
                uBox: { value: SNOW_BOX },
                uHeight: { value: SNOW_HEIGHT },
                uPointScale: { value: 420 },
                uColor: { value: new THREE.Color(this.options.snowColor ?? 0xf4f8ff) },
                uOpacity: { value: 0.9 }
            },
            transparent: true,
            depthWrite: false,
            fog: false
        });
        this.snowMesh = new THREE.Points(geo, mat);
        this.snowMesh.frustumCulled = false;
        this.snowMesh.renderOrder = 5;
        this.group.add(this.snowMesh);
    }

    _initLightning() {
        this.lightning = true;
        this.lightningTimer = 0;
        this.lightningInterval = 4 + Math.random() * 6;
        this.flashIntensity = 0;
        this._thunderPlayed = true;
    }

    update(dt, time) {
        if (this.type === 'none') return;
        this.uniforms.uTime.value = (Number(time) || 0) % 600;
        if (this.lightning) this._updateLightning(dt);
    }

    _updateLightning(dt) {
        if (this.flashIntensity > 0) {
            this.flashIntensity = Math.max(0, this.flashIntensity - dt * 3.2);
            if (this.flashIntensity < 0.55 && !this._thunderPlayed) {
                this._thunderPlayed = true;
                this._playThunder();
            }
        }
        this.lightningTimer += dt;
        if (this.lightningTimer >= this.lightningInterval) {
            // Double-strike flicker: the second flash re-arms before the first fades.
            this.flashIntensity = 1;
            this.lightningTimer = Math.random() < 0.35 ? this.lightningInterval - 0.12 : 0;
            if (this.lightningTimer === 0) this.lightningInterval = 4 + Math.random() * 6;
            this._thunderPlayed = false;
        }
    }

    _playThunder() {
        try {
            if (typeof window === 'undefined') return;
            if (!this._thunderCtx) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                this._thunderCtx = new Ctx();
            }
            const ctx = this._thunderCtx;
            const sr = ctx.sampleRate;
            const duration = 0.8;
            const len = Math.floor(sr * duration);
            const buf = ctx.createBuffer(1, len, sr);
            const data = buf.getChannelData(0);
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const noise = Math.random() * 2 - 1;
                const envelope = Math.exp(-t * 4) * (1 - Math.exp(-t * 30));
                data[i] = noise * envelope * 0.3;
            }
            const source = ctx.createBufferSource();
            source.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = 0.06;
            source.connect(gain);
            gain.connect(ctx.destination);
            source.start();
        } catch (_) { /* audio unavailable */ }
    }

    clear() {
        for (let i = this.group.children.length - 1; i >= 0; i--) {
            const child = this.group.children[i];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.group.remove(child);
        }
        this.rainMesh = null;
        this.snowMesh = null;
        this.lightning = false;
        this.flashIntensity = 0;
        this.lightningTimer = 0;
        this.type = 'none';
        if (this._thunderCtx) {
            this._thunderCtx.close().catch(() => {});
            this._thunderCtx = null;
        }
    }

    // Full teardown: clear() plus detaching the group from the scene.
    dispose() {
        this.clear();
        this.scene?.remove(this.group);
    }
}
