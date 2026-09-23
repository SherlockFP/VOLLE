// map-art/kit.js — shared toolkit for the procedural map-art layer.
//
// Everything here is build-time only: geometry is merged (BufferGeometryUtils)
// or instanced so a whole prop family costs one draw call, textures are
// CanvasTextures drawn once, and all ambient animation (flag wave, water
// shimmer, beacon blink, LED scroll, decal pulse) runs on the GPU from a single
// shared `uArtTime` uniform that Arena.update() writes once per frame — no
// per-frame JS allocation, no per-object update loop.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// --- deterministic randomness -------------------------------------------------
// Art is seeded from the map id so every client (and every test run) builds the
// same skyline; nothing here affects gameplay, but stable output keeps
// screenshots and draw-call budgets reproducible.
export function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- context ------------------------------------------------------------------
// tier: 'low' | 'medium' | 'high'. Low builds only static identity pieces (the
// polish layer skips Low entirely); medium/high add animated materials.
export function createArtContext(arena, tier = 'medium') {
    const halfW = arena.courtWidth / 2;
    const halfL = arena.courtLength / 2;
    return {
        arena,
        tier,
        high: tier === 'high',
        animate: tier !== 'low',
        time: arena._artTime || { value: 0 },
        textures: arena._artTextures || (arena._artTextures = []),
        rng: mulberry32(hashString(String(arena.mapId))),
        config: arena.config,
        halfW,
        halfL,
        add(object) {
            object.userData.mapArt = true;
            object.castShadow = false;
            return arena.add(object);
        }
    };
}

// --- textures -----------------------------------------------------------------
export function canvasTexture(ctx, width, height, draw, { repeatX = 1, repeatY = 1, srgb = true } = {}) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) return null;
    draw(g, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    if (repeatX !== 1 || repeatY !== 1) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
    }
    ctx.textures.push(texture);
    return texture;
}

export const css = hex => `#${(hex >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

// --- animated materials -----------------------------------------------------------
// Each mode is a small GLSL splice; parameters live in uniforms so every
// material of one mode shares a single compiled program.
const VERTEX_MODES = {
    // Cloth anchored at uv.x = 0 (pennants) or uv.y = 1 (hanging banners).
    wave: `
        float artAnchor = uArtD > 0.5 ? (1.0 - uv.y) : uv.x;
        float artPhase = (position.x + position.z) * uArtC;
        transformed += normal * sin(uArtTime * uArtB + artPhase + uv.x * 4.0 + uv.y * 2.0) * uArtA * artAnchor;
    `,
    bob: `
        transformed.y += sin(uArtTime * uArtB + (position.x * 0.37 + position.z * 0.23)) * uArtA;
    `,
    // Whole merged batch circles the world origin (drones, birds, satellites).
    orbit: `
        float artAng = uArtTime * uArtB;
        float artCs = cos(artAng);
        float artSn = sin(artAng);
        transformed.xz = mat2(artCs, artSn, -artSn, artCs) * transformed.xz;
        transformed.y += sin(uArtTime * uArtC + position.x * 0.05) * uArtA;
    `
};

const FRAGMENT_MODES = {
    // Water: travelling interference bands brighten the surface colour.
    shimmer: `
        float artS = sin(vArtWorld.x * uArtC + uArtTime * uArtB) * sin(vArtWorld.z * uArtC * 0.83 - uArtTime * uArtB * 0.77);
        float artG = sin((vArtWorld.x + vArtWorld.z) * uArtC * 2.3 + uArtTime * uArtB * 1.9);
        gl_FragColor.rgb += (max(artS, 0.0) * 0.6 + max(artG, 0.0) * 0.4) * uArtA;
    `,
    // Beacons: hard on/off, phase from world position so neighbours desync.
    blink: `
        float artPh = fract(uArtTime * uArtB + dot(vArtWorld, vec3(0.071, 0.013, 0.053)));
        gl_FragColor.rgb *= mix(uArtA, 1.0, step(0.5, artPh));
    `,
    // Neon tube flicker: mostly lit, brief dropouts.
    flicker: `
        float artF = fract(sin(floor(uArtTime * uArtB + dot(vArtWorld, vec3(0.13, 0.07, 0.11))) * 12.9898) * 43758.5453);
        gl_FragColor.rgb *= artF > 0.93 ? uArtA : 1.0;
    `,
    // Energy pulse travelling outward from the court centre.
    pulse: `
        float artP = 0.5 + 0.5 * sin(uArtTime * uArtB - length(vArtWorld.xz) * uArtC);
        gl_FragColor.rgb *= mix(uArtA, 1.0, artP);
        gl_FragColor.a *= mix(uArtA, 1.0, artP);
    `
};

const UV_MODES = {
    scroll: `
        #ifdef USE_MAP
            vMapUv.x += uArtTime * uArtB;
        #endif
    `
};

export function animate(material, ctx, anim) {
    if (!anim || !ctx.animate) return material;
    const mode = anim.mode;
    const uniforms = {
        uArtTime: ctx.time,
        uArtA: { value: anim.amp ?? 0.3 },
        uArtB: { value: anim.speed ?? 1 },
        uArtC: { value: anim.freq ?? 0.5 },
        uArtD: { value: anim.anchorTop ? 1 : 0 }
    };
    const header = 'uniform float uArtTime;\nuniform float uArtA;\nuniform float uArtB;\nuniform float uArtC;\nuniform float uArtD;\nvarying vec3 vArtWorld;\n';
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        let vertex = header + shader.vertexShader;
        if (VERTEX_MODES[mode]) {
            vertex = vertex.replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MODES[mode]}`);
        }
        if (UV_MODES[mode]) {
            vertex = vertex.replace('#include <uv_vertex>', `#include <uv_vertex>\n${UV_MODES[mode]}`);
        }
        vertex = vertex.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 artWorld = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                artWorld = instanceMatrix * artWorld;
            #endif
            vArtWorld = (modelMatrix * artWorld).xyz;`);
        shader.vertexShader = vertex;
        let fragment = header + shader.fragmentShader;
        if (FRAGMENT_MODES[mode]) {
            fragment = fragment.replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAGMENT_MODES[mode]}`);
        }
        shader.fragmentShader = fragment;
    };
    material.customProgramCacheKey = () => `volle-art-${mode}`;
    material.userData.artMode = mode;
    return material;
}

// --- geometry batching -----------------------------------------------------------
// Collects transformed primitives and merges them into ONE mesh. Every part is
// converted to non-indexed so polyhedra (non-indexed) and boxes (indexed) mix.
export class GeoBatch {
    constructor({ colors = false } = {}) {
        this.parts = [];
        this.colors = colors;
        this._matrix = new THREE.Matrix4();
        this._quat = new THREE.Quaternion();
        this._euler = new THREE.Euler();
        this._pos = new THREE.Vector3();
        this._scale = new THREE.Vector3();
        this._color = new THREE.Color();
    }

    get size() { return this.parts.length; }

    // opts: { rx, ry, rz, sx, sy, sz, color, uvScale: [u, v], uvOffset: [u, v], uvConst: [u, v] }
    add(geometry, x = 0, y = 0, z = 0, opts = {}) {
        let geo = geometry.index ? geometry.toNonIndexed() : geometry;
        if (geo !== geometry) geometry.dispose();
        this._euler.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
        this._quat.setFromEuler(this._euler);
        this._pos.set(x, y, z);
        this._scale.set(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
        this._matrix.compose(this._pos, this._quat, this._scale);
        geo.applyMatrix4(this._matrix);
        const uv = geo.getAttribute('uv');
        if (uv && (opts.uvScale || opts.uvOffset || opts.uvConst)) {
            for (let i = 0; i < uv.count; i++) {
                if (opts.uvConst) {
                    uv.setXY(i, opts.uvConst[0], opts.uvConst[1]);
                    continue;
                }
                const su = opts.uvScale?.[0] ?? 1;
                const sv = opts.uvScale?.[1] ?? 1;
                uv.setXY(i, uv.getX(i) * su + (opts.uvOffset?.[0] || 0), uv.getY(i) * sv + (opts.uvOffset?.[1] || 0));
            }
        }
        if (!uv) {
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
        }
        if (this.colors) {
            this._color.set(opts.color ?? 0xffffff);
            const count = geo.getAttribute('position').count;
            const data = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                data[i * 3] = this._color.r;
                data[i * 3 + 1] = this._color.g;
                data[i * 3 + 2] = this._color.b;
            }
            geo.setAttribute('color', new THREE.Float32BufferAttribute(data, 3));
        }
        this.parts.push(geo);
        return this;
    }

    // Only the attributes every part shares survive the merge.
    build(material) {
        if (!this.parts.length) return null;
        const keep = ['position', 'normal', 'uv', ...(this.colors ? ['color'] : [])];
        for (const part of this.parts) {
            for (const name of Object.keys(part.attributes)) {
                if (!keep.includes(name)) part.deleteAttribute(name);
            }
        }
        const merged = mergeGeometries(this.parts, false);
        for (const part of this.parts) part.dispose();
        this.parts = [];
        if (!merged) return null;
        merged.computeBoundingSphere();
        if (this.colors) material.vertexColors = true;
        return new THREE.Mesh(merged, material);
    }
}

// --- instancing --------------------------------------------------------------------
// transforms: [{ x, y, z, rx, ry, rz, s | sx/sy/sz, color }]
export function instanced(geometry, material, transforms) {
    if (!transforms.length) { geometry.dispose(); return null; }
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    transforms.forEach((t, i) => {
        euler.set(t.rx || 0, t.ry || 0, t.rz || 0);
        quat.setFromEuler(euler);
        pos.set(t.x || 0, t.y || 0, t.z || 0);
        scale.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
        matrix.compose(pos, quat, scale);
        mesh.setMatrixAt(i, matrix);
        if (t.color !== undefined) mesh.setColorAt(i, color.set(t.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
}

// --- court decal --------------------------------------------------------------------
// One transparent plane over the whole court. Drawn above the floor/lines but
// below zone rings (y 0.02) so gameplay markings always stay on top.
export function courtDecal(ctx, draw, { opacity = 1, anim = null, blending = THREE.NormalBlending, pad = 0 } = {}) {
    const width = ctx.arena.courtWidth + pad * 2;
    const length = ctx.arena.courtLength + pad * 2;
    const px = ctx.high ? 2048 : 1024;
    const texW = width >= length ? px : Math.round(px * width / length);
    const texH = width >= length ? Math.round(px * length / width) : px;
    const texture = canvasTexture(ctx, texW, texH, (g, w, h) => draw(g, w, h, w / width));
    if (!texture) return null;
    const material = animate(new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        blending, toneMapped: true
    }), ctx, anim);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.013;
    plane.renderOrder = 1;
    plane.name = 'map-art-court-decal';
    return ctx.add(plane);
}

// Pennant string (triangular flags) between two points, sagging in the middle.
// Returns nothing; adds triangles to the given batch with uv.x running pole->tip
// (0 at the rope) so the 'wave' material flutters the tips only.
export function addBunting(batch, from, to, { count = 14, sag = 1.2, size = 0.9, colors = [0xffffff] } = {}) {
    for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const x = from[0] + (to[0] - from[0]) * t;
        const z = from[2] + (to[2] - from[2]) * t;
        const y = from[1] + (to[1] - from[1]) * t - Math.sin(Math.PI * t) * sag;
        const geo = new THREE.BufferGeometry();
        const w = size * 0.5;
        // Triangle hangs down from the rope: top edge along the rope, tip below.
        const pos = new Float32Array([-w, 0, 0, w, 0, 0, 0, -size * 1.1, 0]);
        const uv = new Float32Array([0, 1, 0, 1, 1, 0]);
        const normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
        const ry = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
        batch.add(geo, x, y, z, { ry, color: colors[i % colors.length] });
    }
}

export { THREE };
