// map-art/backdrop.js — the world beyond the court and the spectator stands.
//
// Every map used to float in an empty sky dome (its lower half read as "water
// to the horizon"). Each theme here lays a ground ring from the court edge to
// the horizon and dresses it: mountain ranges, a hotel beach resort, city
// skylines, volcanoes, cloud seas... (see MAP_BACKDROPS in js/arena.js).
//
// Contract (tests/arena-backdrop.test.mjs):
//   * nothing is placed inside the court or the stands: every non-ground
//     vertex sits outside the court + spectator-bounds rectangle (plus
//     BACKDROP_MARGIN), the ground ring has the court cut out and stays below
//     the court floor there; every mesh is pass-through (no colliders);
//   * cheap: each family is one merged or instanced mesh — at most
//     BACKDROP_DRAW_CALL_BUDGET draw calls per map, fewer on Low, no per-frame
//     work (static geometry, shared haze uniforms);
//   * deterministic (seeded from the map id), so screenshots and budgets are
//     reproducible.
// Distance haze is baked into the materials (fog: false + a small shader
// splice): near the court it follows the scene fog, far away it fades to the
// sky's horizon colour, so the ranges read at any fog setting and dim with
// the weather (arena._backdropHaze.applyWeather).
import { THREE, GeoBatch, instanced, canvasTexture, facadeBox, hashString, mulberry32 } from './kit.js';
import { MAP_BACKDROPS, WEATHER_LOOK } from '../arena.js';

export const BACKDROP_DRAW_CALL_BUDGET = 8;
// Minimum clearance (m) between backdrop geometry and the court + stands.
export const BACKDROP_MARGIN = 6;

const TAU = Math.PI * 2;
const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const luminance = c => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

// The rectangle nothing may enter: court + stands (spectator bounds).
export function backdropExclusion(arena) {
    const sb = arena.spectatorBounds || {};
    const hx = Math.max(arena.courtWidth / 2, Math.abs(sb.minX ?? 0), Math.abs(sb.maxX ?? 0));
    const hz = Math.max(arena.courtLength / 2, Math.abs(sb.minZ ?? 0), Math.abs(sb.maxZ ?? 0));
    return { hx, hz, reach: Math.hypot(hx, hz) };
}

// Distance from the origin to the edge of a centred hx x hz rectangle along `angle`.
function rectEdge(hx, hz, angle) {
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    return Math.min(c > 1e-9 ? hx / c : Infinity, s > 1e-9 ? hz / s : Infinity);
}

// Cheap deterministic value noise for ground patches and ridge detail.
function makeNoise(seed) {
    const hash = (x, z) => {
        let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    return (x, z) => {
        const ix = Math.floor(x);
        const iz = Math.floor(z);
        const fx = x - ix;
        const fz = z - iz;
        const ux = fx * fx * (3 - 2 * fx);
        const uz = fz * fz * (3 - 2 * fz);
        const a = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * ux;
        const b = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * ux;
        return a + (b - a) * uz;
    };
}

// --- haze ------------------------------------------------------------------------
function createHaze(arena) {
    const cfg = arena.config;
    const u = arena.skybox?.material?.uniforms;
    const bottom = u?.bottomColor?.value?.clone?.() ?? new THREE.Color(cfg.skyBottom);
    const horizon = u?.horizonColor?.value?.clone?.() ?? new THREE.Color(cfg.sky?.horizonColor ?? cfg.skyBottom);
    // Roughly the sky's colour just above the horizon (gradient + haze band).
    const base = bottom.clone().lerp(horizon.clone().multiplyScalar(1.08).addScalar(0.02), 0.32);
    const fog = arena.scene?.fog || null;
    const uniforms = {
        uBdSky: { value: base.clone() },
        uBdFog: { value: fog ? fog.color : base.clone() }, // live: follows weather tint
        uBdFogNear: { value: fog?.near ?? 60 },
        uBdFogFar: { value: fog?.far ?? 180 },
        uBdK: { value: 520 },
        uBdMax: { value: 0.86 },
        uBdDim: { value: 0 }
    };
    const haze = {
        uniforms,
        applyWeather(look = WEATHER_LOOK.clear) {
            const o = look.overcast || 0;
            const l = luminance(base);
            uniforms.uBdSky.value.copy(base).lerp(new THREE.Color(l * 0.9, l * 0.94, l), o * 0.75).multiplyScalar(1 - o * 0.3);
            uniforms.uBdDim.value = look.backdropDim || 0;
            if (fog) {
                uniforms.uBdFogNear.value = fog.near;
                uniforms.uBdFogFar.value = fog.far;
            }
        }
    };
    haze.applyWeather(WEATHER_LOOK[arena.weatherType] || WEATHER_LOOK.clear);
    return haze;
}

// Splices the haze into a stock material (fog off; everything else stock).
function hazed(material, haze, { glow = false } = {}) {
    material.fog = false;
    const amount = glow ? '0.55' : '1.0';
    material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, haze.uniforms);
        shader.vertexShader = 'varying float vBdDist;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
            vec4 bdWorld = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                bdWorld = instanceMatrix * bdWorld;
            #endif
            bdWorld = modelMatrix * bdWorld;
            vBdDist = length(bdWorld.xyz - cameraPosition);`);
        shader.fragmentShader = `varying float vBdDist;
uniform vec3 uBdSky;
uniform vec3 uBdFog;
uniform float uBdFogNear;
uniform float uBdFogFar;
uniform float uBdK;
uniform float uBdMax;
uniform float uBdDim;
` + shader.fragmentShader.replace('#include <fog_fragment>', `
            gl_FragColor.rgb *= 1.0 - uBdDim;
            float bdNear = smoothstep(uBdFogNear, uBdFogFar, vBdDist) * 0.5;
            float bdFar = uBdMax * (1.0 - exp(-vBdDist / uBdK));
            vec3 bdCol = mix(uBdFog, uBdSky, smoothstep(uBdFogNear, uBdFogFar * 2.5, vBdDist));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, bdCol, max(bdNear, bdFar) * ${amount});
            #include <fog_fragment>`);
    };
    material.customProgramCacheKey = () => `volle-backdrop-${glow ? 'glow' : 'lit'}`;
    return material;
}

// --- context ------------------------------------------------------------------------
function createContext(arena, tier, theme) {
    const { hx, hz, reach } = backdropExclusion(arena);
    const u = arena.skybox?.material?.uniforms;
    const top = u?.topColor?.value ?? new THREE.Color(arena.config.skyTop);
    const horizon = u?.horizonColor?.value ?? new THREE.Color(arena.config.skyBottom);
    const night = 1 - smoothstep(0.06, 0.26, Math.max(luminance(top), luminance(horizon)));
    const haze = createHaze(arena);
    arena._backdropHaze = haze;
    const seed = hashString(`${arena.mapId}:backdrop`);
    const ctx = {
        arena, tier, theme, hx, hz, reach, night, haze,
        low: tier === 'low',
        high: tier === 'high',
        rng: mulberry32(seed),
        noise: makeNoise(seed),
        outer: Math.max(900, reach + 620),
        textures: arena._artTextures || (arena._artTextures = []),
        meshes: [],
        add(mesh, name) {
            if (!mesh) return null;
            mesh.name = `backdrop-${name}`;
            mesh.userData.backdrop = theme;
            mesh.userData.mapArt = true;
            mesh.userData.passThrough = true; // pure scenery: never collides
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            if (typeof arena._passThrough === 'function') arena._passThrough(mesh);
            arena.add(mesh);
            this.meshes.push(mesh);
            return mesh;
        },
        // Is a footprint of radius r at (x, z) clear of court + stands?
        clear(x, z, r = 0) {
            const dx = Math.max(Math.abs(x) - hx, 0);
            const dz = Math.max(Math.abs(z) - hz, 0);
            return Math.hypot(dx, dz) >= r + BACKDROP_MARGIN;
        },
        lit(opts = {}) {
            return hazed(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: opts.flat !== false, side: opts.side ?? THREE.FrontSide }), haze);
        },
        glow() {
            return hazed(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }), haze, { glow: true });
        }
    };
    return ctx;
}

// Scatter footprints outside the rectangle: `min`..`max` metres beyond its
// edge along random rays within [a0, a1]. Rejects anything not clear by r.
function scatter(ctx, count, { min, max, r = 2, a0 = 0, a1 = TAU, tries = 6 }) {
    const out = [];
    for (let i = 0; i < count; i++) {
        for (let t = 0; t < tries; t++) {
            const a = a0 + ctx.rng() * (a1 - a0);
            const d = rectEdge(ctx.hx, ctx.hz, a) + min + ctx.rng() * (max - min);
            const x = Math.cos(a) * d;
            const z = Math.sin(a) * d;
            if (!ctx.clear(x, z, r)) continue;
            out.push({ x, z, a, d });
            break;
        }
    }
    return out;
}

// --- ground ------------------------------------------------------------------------
// Flat ring from a centred hole (default: the court) out to the horizon.
// color(x, z, dist) -> THREE.Color; height(x, z, dist) -> metres added to y.
function groundRing(ctx, { y = -0.06, hole = [ctx.arena.courtWidth / 2, ctx.arena.courtLength / 2], outer = ctx.outer, color, height, name = 'ground' }) {
    const [hx, hz] = hole;
    const seg = ctx.low ? 64 : 120;
    let angles = [];
    for (let i = 0; i < seg; i++) angles.push((i / seg) * TAU);
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) angles.push((Math.atan2(sz * hz, sx * hx) + TAU) % TAU);
    angles.sort((a, b) => a - b);
    angles = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-4);
    const rings = [0, 0.01, 0.022, 0.036, 0.052, 0.07, 0.092, 0.12, 0.16, 0.21, 0.28, 0.37, 0.5, 0.68, 0.85, 1];
    const n = angles.length;
    const positions = new Float32Array(rings.length * n * 3);
    const colors = new Float32Array(rings.length * n * 3);
    let k = 0;
    for (const t of rings) {
        for (const a of angles) {
            const e = rectEdge(hx, hz, a);
            const r = e + (outer - e) * t;
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            const yy = y + (height ? height(x, z, r) : 0);
            positions[k * 3] = x;
            positions[k * 3 + 1] = t === 0 ? Math.min(yy, y) : yy;
            positions[k * 3 + 2] = z;
            const c = color(x, z, r);
            colors[k * 3] = c.r;
            colors[k * 3 + 1] = c.g;
            colors[k * 3 + 2] = c.b;
            k++;
        }
    }
    const index = [];
    for (let j = 0; j < rings.length - 1; j++) {
        for (let i = 0; i < n; i++) {
            const a = j * n + i;
            const b = j * n + (i + 1) % n;
            const c = (j + 1) * n + i;
            const d = (j + 1) * n + (i + 1) % n;
            index.push(a, c, b, b, c, d);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, ctx.lit({ flat: false, side: THREE.DoubleSide }));
    mesh.renderOrder = -10;
    return ctx.add(mesh, name);
}

// Ground colour from patchy noise between palette entries.
function patchy(ctx, palette, scale = 0.018, extra) {
    const cols = palette.map(c => new THREE.Color(c));
    const out = new THREE.Color();
    return (x, z, r) => {
        const v = ctx.noise(x * scale, z * scale) * 0.7 + ctx.noise(x * scale * 3.7 + 11, z * scale * 3.7) * 0.3;
        const f = Math.min(cols.length - 1.001, Math.max(0, v * (cols.length - 1) * 1.15 - 0.05));
        const i = Math.floor(f);
        out.copy(cols[i]).lerp(cols[i + 1], f - i);
        if (extra) extra(out, x, z, r);
        return out;
    };
}

// --- ridges ------------------------------------------------------------------------
// A continuous mountain range around the arena (or along an arc), as faceted
// strips: front foot -> shoulder -> crest -> back foot. Several layers merge
// into one mesh. palette(t, a, crest) -> colour for a vertex at height t (0..1).
function ridgeLayer(ctx, out, { radius, depth = 120, base = -4, height = 80, peak = 1.6, freqs = [2, 5, 9, 17, 31], seg, arc = null, bell = false, palette }) {
    const r0 = ridgeRadius(ctx, radius, depth);
    const segments = seg || (ctx.low ? 90 : ctx.high ? 220 : 160);
    const phases = freqs.map(() => ctx.rng() * TAU);
    const amps = freqs.map((_, i) => 1 / (1 + i * 0.9));
    const ampSum = amps.reduce((s, a) => s + a, 0);
    const [a0, a1] = arc || [0, TAU];
    const closed = !arc;
    const cols = [];
    const count = closed ? segments : Math.max(8, Math.round(segments * (a1 - a0) / TAU));
    for (let i = 0; i <= count; i++) {
        const t = i / count;
        const a = a0 + (a1 - a0) * t;
        let p = 0;
        freqs.forEach((f, k) => { p += amps[k] * (0.5 + 0.5 * Math.sin(f * a + phases[k])); });
        p /= ampSum;
        let h;
        if (bell) {
            // A lone cone (volcano, sacred peak): centred summit, gently noisy flanks.
            h = height * Math.pow(1 - Math.abs(2 * t - 1), peak) * (0.92 + 0.08 * p);
        } else {
            h = height * (0.22 + 0.78 * Math.pow(p, peak));
            if (!closed) h *= smoothstep(0, 0.18, t) * smoothstep(0, 0.18, 1 - t);
        }
        const jr = (ctx.rng() - 0.5) * depth * 0.12;
        cols.push({ a, h, jr });
    }
    const cRidge = new THREE.Color();
    const pushV = (a, r, y, t, crest) => {
        out.pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        const c = palette(t, a, crest, cRidge);
        out.col.push(c.r, c.g, c.b);
    };
    const profile = col => [
        [r0 - depth * 0.5, base, 0],
        [r0 - depth * 0.2 + col.jr, base + col.h * 0.55, 0.55],
        [r0 + col.jr * 0.5, base + col.h, 1],
        [r0 + depth * 0.5, base + col.h * 0.15, 0.15]
    ];
    for (let i = 0; i < cols.length - 1; i++) {
        const A = profile(cols[i]);
        const B = profile(cols[i + 1]);
        for (let s = 0; s < 3; s++) {
            const quad = [[cols[i], A[s]], [cols[i + 1], B[s]], [cols[i], A[s + 1]], [cols[i + 1], B[s + 1]]];
            for (const idx of [0, 2, 1, 1, 2, 3]) {
                const [col, [r, y, t]] = quad[idx];
                pushV(col.a, r, y, t, col.h / height);
            }
        }
    }
}

function buildRidges(ctx, layers, name = 'ridges') {
    const out = { pos: [], col: [] };
    for (const layer of layers) ridgeLayer(ctx, out, layer);
    if (!out.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return ctx.add(new THREE.Mesh(geo, ctx.lit({ side: THREE.DoubleSide })), name);
}

// Palette for mountains: foot -> rock -> cap above a noisy line.
function mountainPalette(ctx, foot, rock, cap, capLine = 0.62) {
    const f = new THREE.Color(foot);
    const r = new THREE.Color(rock);
    const c = cap === null ? null : new THREE.Color(cap);
    return (t, a, crest, out) => {
        const line = capLine + (ctx.noise(a * 9, 3.1) - 0.5) * 0.18;
        if (c && t > 0.5 && crest * t > line * 0.9) return out.copy(c);
        return out.copy(f).lerp(r, smoothstep(0.1, 0.8, t));
    };
}

// Where a ridge layer's crest sits for angle a (for props placed on a peak).
function ridgeRadius(ctx, radius, depth) {
    return Math.max(radius, ctx.reach + depth * 0.5 + BACKDROP_MARGIN + 30);
}

// Flat ribbon between two points (lava rivers, waterfalls), `width` wide
// across the horizontal perpendicular of p0 -> p1.
function ribbon(p0, p1, width) {
    const dx = p1[0] - p0[0];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * width * 0.5;
    const oz = (dx / len) * width * 0.5;
    const pos = new Float32Array([
        p0[0] - ox, p0[1], p0[2] - oz, p0[0] + ox, p0[1], p0[2] + oz, p1[0] - ox, p1[1], p1[2] - oz,
        p0[0] + ox, p0[1], p0[2] + oz, p1[0] + ox, p1[1], p1[2] + oz, p1[0] - ox, p1[1], p1[2] - oz
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    geo.computeVertexNormals();
    return geo;
}

// --- props -------------------------------------------------------------------------
function templateGeometry(build) {
    const batch = new GeoBatch({ colors: true });
    build(batch);
    const mesh = batch.build(new THREE.MeshBasicMaterial());
    if (!mesh) return null;
    mesh.material.dispose();
    return mesh.geometry;
}

function instancedProps(ctx, geometry, transforms, name, material = ctx.lit()) {
    if (!geometry || !transforms.length) { geometry?.dispose(); material.dispose(); return null; }
    return ctx.add(instanced(geometry, material, transforms), name);
}

const TREES = {
    pine: (b, trunk = 0x4a3526, leaf = 0x2c5a3a) => {
        b.add(new THREE.CylinderGeometry(0.3, 0.45, 3, 5), 0, 1.5, 0, { color: trunk });
        for (let k = 0; k < 3; k++) b.add(new THREE.ConeGeometry(2.6 - k * 0.65, 3.4, 7), 0, 3.4 + k * 2.1, 0, { color: leaf });
    },
    snowPine: b => {
        b.add(new THREE.CylinderGeometry(0.3, 0.45, 3, 5), 0, 1.5, 0, { color: 0x4a3526 });
        for (let k = 0; k < 3; k++) {
            b.add(new THREE.ConeGeometry(2.6 - k * 0.65, 3.4, 7), 0, 3.4 + k * 2.1, 0, { color: 0x2a4a3a });
            b.add(new THREE.ConeGeometry(1.7 - k * 0.45, 1.3, 7), 0, 4.5 + k * 2.1, 0, { color: 0xeef4fa });
        }
    },
    broadleaf: (b, leaf = 0x4d8a3c) => {
        b.add(new THREE.CylinderGeometry(0.35, 0.55, 4, 6), 0, 2, 0, { color: 0x5a4028 });
        b.add(new THREE.IcosahedronGeometry(2.8, 0), 0, 5.6, 0, { color: leaf });
        b.add(new THREE.IcosahedronGeometry(2, 0), 1.4, 4.9, 0.6, { color: leaf });
        b.add(new THREE.IcosahedronGeometry(1.9, 0), -1.2, 5, -0.8, { color: leaf });
    },
    cypress: b => {
        b.add(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 5), 0, 0.8, 0, { color: 0x4a3526 });
        b.add(new THREE.CylinderGeometry(0.2, 1.1, 8.5, 7), 0, 5.4, 0, { color: 0x2f4f2a });
    },
    palm: b => {
        const segs = 5;
        for (let i = 0; i < segs; i++) {
            const t = i / segs;
            b.add(new THREE.CylinderGeometry(0.26 - t * 0.06, 0.32 - t * 0.06, 2.1, 6), t * t * 1.6, 1.05 + i * 2, 0, { rz: -0.1 - t * 0.12, color: i % 2 ? 0x8a6a45 : 0x9a7a52 });
        }
        const topX = 1.6;
        const topY = segs * 2 + 0.2;
        for (let f = 0; f < 7; f++) {
            const a = (f / 7) * TAU;
            const frond = new THREE.PlaneGeometry(4.6, 1.1, 2, 1);
            frond.translate(2.3, 0, 0);
            b.add(frond, topX, topY, 0, { rx: -Math.PI / 2, ry: a, rz: -0.45, color: f % 2 ? 0x3f8f3a : 0x4fa344 });
            b.add(frond.clone(), topX, topY, 0, { rx: Math.PI / 2, ry: a, rz: -0.45, color: 0x357a33 });
        }
        b.add(new THREE.IcosahedronGeometry(0.45, 0), topX, topY - 0.4, 0, { color: 0x6a4a2a });
    },
    sakura: b => {
        b.add(new THREE.CylinderGeometry(0.3, 0.5, 3.4, 6), 0, 1.7, 0, { rz: 0.1, color: 0x4a3030 });
        b.add(new THREE.IcosahedronGeometry(2.6, 0), 0.2, 4.6, 0, { color: 0xf6b8cc });
        b.add(new THREE.IcosahedronGeometry(1.8, 0), 1.6, 4.1, 0.4, { color: 0xf9cad8 });
        b.add(new THREE.IcosahedronGeometry(1.7, 0), -1.4, 4.2, -0.6, { color: 0xf2a6bf });
    },
    olive: b => {
        b.add(new THREE.CylinderGeometry(0.3, 0.5, 2.2, 5), 0, 1.1, 0, { rz: 0.15, color: 0x5a4a38 });
        b.add(new THREE.IcosahedronGeometry(2, 0), 0.3, 3.1, 0, { sy: 0.7, color: 0x7d8f5a });
        b.add(new THREE.IcosahedronGeometry(1.4, 0), -1, 2.8, 0.5, { sy: 0.7, color: 0x8a9a66 });
    },
    jungle: b => {
        b.add(new THREE.CylinderGeometry(0.5, 0.8, 9, 6), 0, 4.5, 0, { color: 0x5a4632 });
        b.add(new THREE.IcosahedronGeometry(4.4, 0), 0, 10.2, 0, { sy: 0.6, color: 0x2f7a35 });
        b.add(new THREE.IcosahedronGeometry(3, 0), 2.6, 9.2, 1, { sy: 0.6, color: 0x3d8c3a });
        b.add(new THREE.IcosahedronGeometry(3, 0), -2.4, 9.4, -1.2, { sy: 0.6, color: 0x276a30 });
    },
    cactus: b => {
        b.add(new THREE.CylinderGeometry(0.45, 0.5, 5, 7), 0, 2.5, 0, { color: 0x4f7a3a });
        b.add(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6), 0.9, 2.4, 0, { rz: Math.PI / 2, color: 0x4f7a3a });
        b.add(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 6), 1.6, 3.2, 0, { color: 0x4f7a3a });
        b.add(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6), -0.8, 3, 0, { rz: Math.PI / 2, color: 0x4f7a3a });
        b.add(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6), -1.4, 3.6, 0, { color: 0x4f7a3a });
    },
    blocky: b => {
        b.add(new THREE.BoxGeometry(1, 5, 1), 0, 2.5, 0, { color: 0x6b4a2a });
        b.add(new THREE.BoxGeometry(5, 3, 5), 0, 6, 0, { color: 0x3f8a2a });
        b.add(new THREE.BoxGeometry(3, 2, 3), 0, 8.5, 0, { color: 0x4a9a32 });
    }
};

function treeTransforms(ctx, spots, { scale = [0.9, 1.5], tint = null } = {}) {
    return spots.map(p => ({
        x: p.x, y: p.y ?? -0.05, z: p.z,
        ry: ctx.rng() * TAU,
        s: scale[0] + ctx.rng() * (scale[1] - scale[0]),
        ...(tint ? { color: tint[Math.floor(ctx.rng() * tint.length)] } : {})
    }));
}

function forest(ctx, kind, count, band, opts = {}) {
    const n = Math.round(count * (ctx.low ? 0.45 : ctx.high ? 1.35 : 1));
    const spots = scatter(ctx, n, { r: 4 * (opts.scale?.[1] || 1.5), ...band });
    const geo = templateGeometry(b => TREES[kind](b, ...(opts.args || [])));
    return instancedProps(ctx, geo, treeTransforms(ctx, spots, opts), `trees-${kind}`);
}

// --- facades -----------------------------------------------------------------------
// Diffuse facade (walls + dark glass) and a matching emissive mask of lit
// windows, one 16 m x 32 m tile each; both share facadeBox UVs.
function facadePair(ctx, style) {
    const rng = mulberry32(hashString(`${ctx.arena.mapId}:${style.name}`));
    const cols = style.cols || 6;
    const rows = style.rows || 10;
    const W = 128;
    const H = 256;
    const cw = W / cols;
    const rh = (H - 8) / rows;
    const lit = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) lit.push(rng() < (style.litChance ?? 0.4) ? rng() : -1);
    const diffuse = canvasTexture(ctx, W, H, g => {
        g.fillStyle = style.wall;
        g.fillRect(0, 0, W, H);
        g.fillStyle = style.roof || style.wall;
        g.fillRect(0, 0, W, 8);
        for (let r = 0; r < rows; r++) {
            const y = 8 + r * rh;
            if (style.balcony) {
                g.fillStyle = style.balcony;
                g.fillRect(0, y + rh * 0.78, W, rh * 0.14);
            }
            for (let c = 0; c < cols; c++) {
                g.fillStyle = style.glass;
                g.fillRect(c * cw + cw * (style.gapX ?? 0.16), y + rh * 0.18, cw * (1 - 2 * (style.gapX ?? 0.16)), rh * 0.56);
            }
        }
    });
    const glowColors = style.lights || ['#ffd89a', '#ffe8c0', '#fff4dc'];
    const emissive = canvasTexture(ctx, W, H, g => {
        g.fillStyle = '#000000';
        g.fillRect(0, 0, W, H);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const v = lit[r * cols + c];
                if (v < 0) continue;
                g.fillStyle = glowColors[Math.floor(v * glowColors.length) % glowColors.length];
                g.globalAlpha = 0.55 + v * 0.45;
                g.fillRect(c * cw + cw * (style.gapX ?? 0.16), 8 + r * rh + rh * 0.18, cw * (1 - 2 * (style.gapX ?? 0.16)), rh * 0.56);
            }
        }
        g.globalAlpha = 1;
    });
    for (const tex of [diffuse, emissive]) {
        if (tex) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    }
    const material = hazed(new THREE.MeshLambertMaterial({
        color: 0xffffff, vertexColors: true, map: diffuse, emissiveMap: emissive,
        emissive: 0xffffff, emissiveIntensity: 0.06 + 1.05 * ctx.night
    }), ctx.haze);
    return material;
}

// Towers on concentric rings (skylines). Returns { batch, tops } for extras.
function towerRing(ctx, batch, { count, rings, heights, widths = [14, 30], a0 = 0, a1 = TAU, base = -0.06, tints }) {
    const tops = [];
    for (let i = 0; i < count; i++) {
        const ring = i % rings.length;
        const a = a0 + (a1 - a0) * ((i + ctx.rng() * 0.8) / count);
        const w = widths[0] + ctx.rng() * (widths[1] - widths[0]);
        const d = widths[0] + ctx.rng() * (widths[1] - widths[0]);
        const dist = Math.max(rings[ring][0] + ctx.rng() * rings[ring][1], rectEdge(ctx.hx, ctx.hz, a) + Math.hypot(w, d) / 2 + BACKDROP_MARGIN + 4);
        const x = Math.cos(a) * dist;
        const z = Math.sin(a) * dist;
        if (!ctx.clear(x, z, Math.hypot(w, d) / 2)) continue;
        const [h0, h1] = heights[ring];
        const top = h0 + ctx.rng() * (h1 - h0);
        const h = top - base;
        batch.add(facadeBox(w, h, d), x, base + h / 2, z, { ry: -a - Math.PI / 2, color: tints[Math.floor(ctx.rng() * tints.length)] });
        tops.push({ x, z, top, w, d, a });
    }
    return tops;
}

// --- themes ------------------------------------------------------------------------
const THEMES = {
    resort(ctx) {
        const { hx, hz } = ctx;
        // Sea to the west (under the default sun), the resort strip to the east.
        const shoreX = z => -(hx + 24) + 7 * Math.sin(z * 0.018) + 4 * Math.sin(z * 0.047 + 1);
        const wet = new THREE.Color(0xc9ae7c);
        const lawn = new THREE.Color(0x7fae5a);
        groundRing(ctx, {
            color: patchy(ctx, [0xe8cf9c, 0xf1dcae, 0xe2c792], 0.02, (out, x, z, r) => {
                const d = x - shoreX(z);
                if (d < 8) out.lerp(wet, smoothstep(8, -4, d) * 0.8);
                // Resort gardens behind the promenade.
                if (x > hx + 40 && r > ctx.reach + 30) out.lerp(lawn, 0.55 * smoothstep(hx + 40, hx + 70, x) * (0.6 + 0.4 * ctx.noise(x * 0.05, z * 0.05)));
            }),
            height: (x, z, r) => {
                const d = x - shoreX(z);
                if (d < 0) return Math.max(-3.5, d * 0.09);
                return r > ctx.reach + 260 ? (ctx.noise(x * 0.01, z * 0.01) - 0.3) * 6 * smoothstep(ctx.reach + 260, ctx.reach + 420, r) : 0;
            }
        });
        // Open sea (the map's own transparent ocean plane shimmers on top near the court).
        const shallow = new THREE.Color(0x39c3cf);
        const deep = new THREE.Color(0x1f7fa8);
        const far = new THREE.Color(0x1a5f8e);
        const sea = new THREE.Color();
        groundRing(ctx, {
            y: -0.62,
            name: 'sea',
            color: (x, z, r) => sea.copy(shallow).lerp(deep, smoothstep(0, 140, shoreX(z) - x)).lerp(far, smoothstep(300, 800, r))
        });

        // Hotels: an arc of towers facing the court across the promenade.
        const hotels = new GeoBatch({ colors: true });
        const count = ctx.low ? 5 : ctx.high ? 11 : 8;
        const spots = [];
        for (let i = 0; i < count; i++) {
            const a = -1.75 + (3.5 * (i + 0.5)) / count + (ctx.rng() - 0.5) * 0.12;
            const w = 34 + ctx.rng() * 22;
            const d = 15 + ctx.rng() * 5;
            const dist = Math.max(rectEdge(hx, hz, a) + 95 + ctx.rng() * 90, 150);
            const x = Math.cos(a) * dist;
            const z = Math.sin(a) * dist;
            if (!ctx.clear(x, z, Math.hypot(w + 12, d + 30) / 2) || x < shoreX(z) + 40) continue;
            const h = 34 + ctx.rng() * 58;
            const ry = -a - Math.PI / 2;
            const tint = [0xffffff, 0xfff1e0, 0xffe6da, 0xe8f6f4, 0xfdf0c8][i % 5];
            hotels.add(facadeBox(w, h, d), x, h / 2 - 0.06, z, { ry, color: tint });
            // Stepped crown + podium lobby.
            hotels.add(facadeBox(w * 0.62, 7, d * 0.8), x, h + 3.44, z, { ry, color: tint });
            hotels.add(facadeBox(w + 12, 7, d + 10), x, 3.44, z, { ry, color: 0xf6efe2 });
            if (ctx.rng() < 0.5) {
                // Side wing angled toward the sea.
                const wa = a + (ctx.rng() < 0.5 ? -1 : 1) * 0.1;
                hotels.add(facadeBox(d, h * 0.62, w * 0.5), Math.cos(wa) * (dist + 8), h * 0.31 - 0.06, Math.sin(wa) * (dist + 8), { ry, color: tint });
            }
            spots.push({ x, z, a, dist, w, d, h, ry });
        }
        const hotelMesh = hotels.build(facadePair(ctx, {
            name: 'hotel', wall: '#f4efe6', glass: '#5d97ad', balcony: '#ffffff', roof: '#d8d2c6',
            cols: 5, rows: 10, litChance: 0.45, lights: ['#ffd89a', '#ffe9c4', '#bfe4ff']
        }));
        ctx.add(hotelMesh, 'hotels');

        // Far green headlands behind the resort, islands out at sea.
        buildRidges(ctx, [
            { radius: 560, depth: 170, height: 120, base: -6, arc: [-1.9, 1.9], palette: mountainPalette(ctx, 0x4f8a45, 0x6f8d5a, null) },
            { radius: 700, depth: 120, height: 70, base: -8, arc: [2.5, 3.3], palette: mountainPalette(ctx, 0x4a7d48, 0x6a8a60, null) },
            { radius: 820, depth: 90, height: 45, base: -8, arc: [3.5, 3.95], palette: mountainPalette(ctx, 0x4a7d48, 0x6a8a60, null) }
        ]);
        if (ctx.low) return;

        // Pool decks, loungers, umbrellas, cabanas, promenade, pier, boats.
        const p = new GeoBatch({ colors: true });
        const umbrellaCols = [0xff5d6c, 0xffd23d, 0x21b6d9, 0xffffff, 0xff8a3d];
        for (const s of spots) {
            const pd = s.dist - s.d / 2 - 20;
            const px = Math.cos(s.a) * pd;
            const pz = Math.sin(s.a) * pd;
            if (!ctx.clear(px, pz, Math.hypot((s.w + 6) / 2, 13))) continue;
            p.add(new THREE.BoxGeometry(s.w + 6, 0.3, 26), px, 0.09, pz, { ry: s.ry, color: 0xf2ece0 });
            p.add(new THREE.BoxGeometry(s.w * 0.6, 0.12, 11), px, 0.27, pz, { ry: s.ry, color: 0x3fd0e0 });
            for (let k = 0; k < 6; k++) {
                const off = (k - 2.5) * (s.w * 0.14);
                for (const side of [-1, 1]) {
                    const lx = px + Math.cos(s.ry) * off - Math.sin(s.ry) * side * 8.5;
                    const lz = pz - Math.sin(s.ry) * off - Math.cos(s.ry) * side * 8.5;
                    p.add(new THREE.BoxGeometry(0.8, 0.35, 2), lx, 0.4, lz, { ry: s.ry, color: 0xffffff });
                    if (k % 2 === 0) {
                        p.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 4), lx, 1.5, lz, { color: 0xeeeeee });
                        p.add(new THREE.ConeGeometry(1.5, 0.7, 8), lx, 2.8, lz, { color: umbrellaCols[(k + (side > 0 ? 1 : 0)) % umbrellaCols.length] });
                    }
                }
            }
        }
        // Promenade + lamp posts along the resort side of the beach.
        const promX = hx + 16;
        for (let z = -Math.min(420, ctx.outer * 0.45); z <= Math.min(420, ctx.outer * 0.45); z += 20) {
            if (!ctx.clear(promX, z, 3)) continue;
            p.add(new THREE.BoxGeometry(6, 0.14, 20.2), promX, 0.02, z, { color: 0xd9c7a8 });
            p.add(new THREE.CylinderGeometry(0.08, 0.1, 4, 5), promX + 3.4, 2, z, { color: 0x3a3f46 });
        }
        // Beach umbrellas + loungers on the sand, seaward of the west stands.
        for (const s of scatter(ctx, 28, { min: 4, max: 20, r: 2, a0: Math.PI * 0.62, a1: Math.PI * 1.38 })) {
            if (s.x < shoreX(s.z) + 3) continue;
            p.add(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), s.x, 1.2, s.z, { color: 0xffffff });
            p.add(new THREE.ConeGeometry(1.4, 0.6, 8), s.x, 2.5, s.z, { color: umbrellaCols[Math.floor(ctx.rng() * umbrellaCols.length)] });
            p.add(new THREE.BoxGeometry(0.75, 0.3, 1.9), s.x + 1.2, 0.15, s.z, { color: 0xfafafa });
        }
        // Cabanas at both ends of the beach.
        for (const sz of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
                const cx = -hx + 6 + k * 9;
                const cz = sz * (hz + 14);
                if (!ctx.clear(cx, cz, 4)) continue;
                for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
                    p.add(new THREE.BoxGeometry(0.2, 3, 0.2), cx + dx, 1.5, cz + dz, { color: 0xf7f0dc });
                }
                p.add(new THREE.ConeGeometry(3, 1.2, 4), cx, 3.6, cz, { ry: Math.PI / 4, color: k % 2 ? 0xe84f61 : 0x249fd0 });
            }
        }
        // Pier into the sea with a hut at the end.
        const pierZ = hz + 40;
        const pierX0 = shoreX(pierZ) + 6;
        for (let k = 0; k < 12; k++) {
            const x = pierX0 - k * 8;
            p.add(new THREE.BoxGeometry(8.2, 0.3, 4), x, 0.9, pierZ, { color: 0xb58a5a });
            for (const dz of [-1.8, 1.8]) p.add(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 5), x, -0.3, pierZ + dz, { color: 0x6b4f35 });
        }
        p.add(new THREE.BoxGeometry(7, 3.2, 6), pierX0 - 96, 2.6, pierZ, { color: 0xf3e6cf });
        p.add(new THREE.ConeGeometry(5.4, 2.4, 4), pierX0 - 96, 5.4, pierZ, { ry: Math.PI / 4, color: 0x2a8fb0 });
        // Sailboats and a yacht out at sea.
        for (let k = 0; k < (ctx.high ? 8 : 5); k++) {
            const bz = (ctx.rng() - 0.5) * 700;
            const bx = shoreX(bz) - 90 - ctx.rng() * 380;
            if (!ctx.clear(bx, bz, 8)) continue;
            p.add(new THREE.BoxGeometry(8, 1.2, 2.6), bx, -0.1, bz, { color: 0xffffff });
            p.add(new THREE.CylinderGeometry(0.1, 0.1, 9, 4), bx, 4.6, bz, { color: 0xdddddd });
            p.add(new THREE.ConeGeometry(3, 8, 3), bx + 1.4, 4.8, bz, { sz: 0.08, color: k % 3 ? 0xffffff : 0xff6a5a });
        }
        ctx.add(p.build(ctx.lit()), 'resort-props');
        // Palms: promenade line, pool gardens, beach ends.
        const palmSpots = [];
        for (let z = -300; z <= 300; z += 18) palmSpots.push({ x: hx + 11 + (ctx.rng() - 0.5) * 3, z: z + (ctx.rng() - 0.5) * 6 });
        palmSpots.push(...scatter(ctx, ctx.high ? 60 : 36, { min: 30, max: 160, r: 3, a0: -1.6, a1: 1.6 }));
        palmSpots.push(...scatter(ctx, 14, { min: 8, max: 24, r: 3, a0: Math.PI * 0.6, a1: Math.PI * 1.4 }).filter(s => s.x > shoreX(s.z) + 4));
        const palms = palmSpots.filter(s => ctx.clear(s.x, s.z, 3));
        instancedProps(ctx, templateGeometry(TREES.palm), treeTransforms(ctx, palms, { scale: [0.9, 1.35] }), 'palms');
        // Lamp heads + hotel rooftop signs (glow).
        const g = new GeoBatch({ colors: true });
        for (let z = -Math.min(420, ctx.outer * 0.45); z <= Math.min(420, ctx.outer * 0.45); z += 20) {
            if (ctx.clear(promX, z, 3)) g.add(new THREE.SphereGeometry(0.32, 6, 4), promX + 3.4, 4.1, z, { color: 0xfff0c8 });
        }
        for (const s of spots) g.add(new THREE.BoxGeometry(s.w * 0.4, 2.2, 0.4), s.x - Math.cos(s.a) * (s.d * 0.4 + 0.3), s.h + 9.5, s.z - Math.sin(s.a) * (s.d * 0.4 + 0.3), { ry: s.ry, color: [0xff6a8a, 0x5fd8ff, 0xffd26a][Math.floor(ctx.rng() * 3)] });
        ctx.add(g.build(ctx.glow()), 'resort-lights');
    },

    city(ctx, style) {
        const { night } = ctx;
        const base = style.groundY ?? -0.06;
        groundRing(ctx, {
            y: base,
            color: patchy(ctx, style.ground, 0.03, style.parks ? (out, x, z) => {
                if (ctx.noise(x * 0.012 + 40, z * 0.012) > 0.62) out.lerp(new THREE.Color(0x5f8f4a), 0.7);
            } : null)
        });
        const towers = new GeoBatch({ colors: true });
        const n = ctx.low ? style.count * 0.55 : ctx.high ? style.count * 1.3 : style.count;
        const r0 = ctx.reach;
        const tops = towerRing(ctx, towers, {
            count: Math.round(n),
            rings: [[r0 + 60, 40], [r0 + 150, 80], [r0 + 300, 150]],
            heights: style.heights, base,
            widths: style.widths || [14, 30],
            tints: style.tints
        });
        ctx.add(towers.build(facadePair(ctx, style.facade)), 'skyline');
        if (style.hills) {
            buildRidges(ctx, [{ radius: ctx.outer * 0.8, depth: 160, height: style.hills.height, base: base - 4, palette: mountainPalette(ctx, style.hills.foot, style.hills.rock, style.hills.cap ?? null) }]);
        }
        if (ctx.low) return;
        // Rooftop beacons / neon crowns / edge strips (one glow batch).
        const g = new GeoBatch({ colors: true });
        for (const t of tops) {
            if (ctx.rng() < (style.beaconChance ?? 0.35)) {
                g.add(new THREE.SphereGeometry(0.9, 6, 4), t.x, t.top + 1.2, t.z, { color: style.beacon ?? 0xff3a3a });
            }
            if (style.crowns && ctx.rng() < style.crowns.chance) {
                const c = style.crowns.colors[Math.floor(ctx.rng() * style.crowns.colors.length)];
                g.add(new THREE.BoxGeometry(t.w + 0.4, 0.8, t.d + 0.4), t.x, t.top - 1.5, t.z, { ry: -t.a - Math.PI / 2, color: c });
                if (style.crowns.vertical) {
                    g.add(new THREE.BoxGeometry(0.5, t.top - base, 0.5), t.x + Math.cos(t.a + Math.PI / 2) * t.w * 0.5, (t.top + base) / 2, t.z + Math.sin(t.a + Math.PI / 2) * t.w * 0.5, { color: c });
                }
            }
        }
        if (g.size) ctx.add(g.build(ctx.glow()), 'skyline-lights');
        if (style.parks && night < 0.5) forest(ctx, 'broadleaf', 70, { min: 14, max: 70 }, { scale: [0.9, 1.4], args: [0x4f8f40] });
    },

    factory(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x6f7666, 0x7c8270, 0x62685c, 0x8a8a7a], 0.025) });
        const b = new GeoBatch({ colors: true });
        const spots = scatter(ctx, ctx.low ? 14 : 26, { min: 45, max: 260, r: 40 });
        spots.forEach((s, i) => {
            const ry = -s.a - Math.PI / 2;
            const kind = i % 4;
            if (kind === 0) {
                // Sawtooth-roof shed.
                const w = 40 + ctx.rng() * 30;
                b.add(new THREE.BoxGeometry(w, 12, 26), s.x, 6, s.z, { ry, color: 0x9aa3ad });
                for (let k = 0; k < 4; k++) b.add(new THREE.BoxGeometry(w, 4, 5), s.x + Math.cos(s.a) * (k * 6 - 9), 13.6, s.z + Math.sin(s.a) * (k * 6 - 9), { ry, rx: 0.5, color: 0x7d8792 });
            } else if (kind === 1) {
                // Chimney with red/white bands.
                const h = 40 + ctx.rng() * 35;
                s.h = h;
                for (let k = 0; k < 6; k++) b.add(new THREE.CylinderGeometry(2.4 - k * 0.12, 2.6 - k * 0.12, h / 6, 10), s.x, h / 12 + (h / 6) * k, s.z, { color: k % 2 ? 0xe8e8e8 : 0xc0392b });
                b.add(new THREE.BoxGeometry(16, 9, 12), s.x + 6, 4.5, s.z, { color: 0xa8a39a });
            } else if (kind === 2) {
                // Cooling tower (waisted cylinder).
                const r = 14 + ctx.rng() * 6;
                b.add(new THREE.CylinderGeometry(r * 0.7, r, 26, 16, 1, true), s.x, 13, s.z, { color: 0xc9c5bd });
                b.add(new THREE.CylinderGeometry(r * 0.78, r * 0.7, 14, 16, 1, true), s.x, 33, s.z, { color: 0xc2beb6 });
            } else {
                // Tank farm.
                for (let k = 0; k < 3; k++) b.add(new THREE.CylinderGeometry(7, 7, 10, 14), s.x + (k - 1) * 16 * Math.cos(s.a + 1.57), 5, s.z + (k - 1) * 16 * Math.sin(s.a + 1.57), { color: 0xd8d4c8 });
            }
        });
        ctx.add(b.build(ctx.lit()), 'factory');
        buildRidges(ctx, [{ radius: ctx.outer * 0.72, depth: 170, height: 90, base: -6, palette: mountainPalette(ctx, 0x5e7a52, 0x7a8672, null) }]);
        if (ctx.low) return;
        forest(ctx, 'broadleaf', 40, { min: 20, max: 120 }, { args: [0x55803f] });
        const g = new GeoBatch({ colors: true });
        spots.forEach((s, i) => { if (i % 4 === 1) g.add(new THREE.SphereGeometry(0.8, 6, 4), s.x, s.h + 1, s.z, { color: 0xff3030 }); });
        if (g.size) ctx.add(g.build(ctx.glow()), 'factory-lights');
    },

    dojo(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x5f7d45, 0x6d8a4d, 0x7d9a58, 0x8a8a70], 0.02) });
        const fujiA = 0.6 + ctx.rng() * 0.5;
        const pal = mountainPalette(ctx, 0x3f6440, 0x5a6a70, 0xf2f5f8, 0.72);
        const fuji = new THREE.Color();
        buildRidges(ctx, [
            { radius: ctx.reach + 150, depth: 110, height: 55, base: -4, peak: 1.2, palette: mountainPalette(ctx, 0x335a37, 0x4b6b45, null) },
            { radius: ctx.outer * 0.62, depth: 180, height: 120, base: -8, palette: pal },
            // The lone snow cone on the skyline.
            { radius: ctx.outer * 0.86, depth: 260, height: 260, base: -10, arc: [fujiA - 0.32, fujiA + 0.32], peak: 1.15, bell: true, freqs: [7, 13],
                palette: (t, a, crest, out) => out.copy(t > 0.62 && crest > 0.55 ? fuji.set(0xf4f7fa) : fuji.set(0x58677a)) }
        ]);
        if (ctx.low) return;
        forest(ctx, 'pine', 90, { min: 10, max: 140 }, { args: [0x3a2a1c, 0x234a2c] });
        forest(ctx, 'sakura', 40, { min: 8, max: 70 }, { scale: [0.9, 1.3] });
        // Pagoda + torii on the near hills.
        const b = new GeoBatch({ colors: true });
        const [pa] = scatter(ctx, 1, { min: 70, max: 90, r: 10 });
        if (pa) {
            for (let k = 0; k < 5; k++) {
                const s = 9 - k * 1.3;
                b.add(new THREE.BoxGeometry(s * 0.7, 3.2, s * 0.7), pa.x, 1.6 + k * 4, pa.z, { color: 0xc8372d });
                b.add(new THREE.ConeGeometry(s * 0.95, 1.6, 4), pa.x, 3.9 + k * 4, pa.z, { ry: Math.PI / 4, color: 0x2e3238 });
            }
            b.add(new THREE.CylinderGeometry(0.2, 0.2, 5, 5), pa.x, 23, pa.z, { color: 0xc9a44a });
        }
        for (const t of scatter(ctx, 4, { min: 20, max: 60, r: 5 })) {
            const ry = -t.a;
            for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.35, 0.4, 7, 8), t.x + Math.cos(ry) * 0 + Math.sin(t.a) * s * 2.6, 3.5, t.z - Math.cos(t.a) * s * 2.6, { color: 0xd83a2a });
            b.add(new THREE.BoxGeometry(0.6, 0.6, 8), t.x, 7.1, t.z, { ry: -t.a, color: 0x1f1f22 });
            b.add(new THREE.BoxGeometry(0.4, 0.4, 6.6), t.x, 6, t.z, { ry: -t.a, color: 0xd83a2a });
        }
        if (b.size) ctx.add(b.build(ctx.lit()), 'shrines');
    },

    roman(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0xa89a62, 0x9aa060, 0xb8a874, 0x8f9a5a], 0.02) });
        buildRidges(ctx, [
            { radius: ctx.reach + 170, depth: 140, height: 45, base: -4, peak: 1, freqs: [2, 4, 7, 11], palette: mountainPalette(ctx, 0x8a9a55, 0xa29a68, null) },
            { radius: ctx.outer * 0.78, depth: 200, height: 110, base: -8, palette: mountainPalette(ctx, 0x6c7a60, 0x8a8c80, 0xe8ecef, 0.8) }
        ]);
        // Aqueduct, temple, villas.
        const b = new GeoBatch({ colors: true });
        const aqA = 2.3;
        const aqD = rectEdge(ctx.hx, ctx.hz, aqA) + 70;
        for (let k = -9; k <= 9; k++) {
            const a = aqA + k * 0.028;
            const x = Math.cos(a) * aqD;
            const z = Math.sin(a) * aqD;
            if (!ctx.clear(x, z, 5)) continue;
            b.add(new THREE.BoxGeometry(2.4, 18, 3), x, 9, z, { ry: -a, color: 0xd8c8a0 });
            b.add(new THREE.BoxGeometry(2.6, 3, aqD * 0.028 + 0.3), x, 19.5, z, { ry: -a, color: 0xcdbb92 });
        }
        const [tp] = scatter(ctx, 1, { min: 90, max: 110, r: 16, a0: 4.2, a1: 5.2 });
        if (tp) {
            const ry = -tp.a - Math.PI / 2;
            b.add(new THREE.BoxGeometry(26, 2, 16), tp.x, 1, tp.z, { ry, color: 0xe6dcc4 });
            for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
                const off = (i - 2.5) * 4.4;
                b.add(new THREE.CylinderGeometry(0.8, 0.9, 10, 10), tp.x + Math.cos(ry) * off + Math.sin(ry) * s * 6, 7, tp.z - Math.sin(ry) * off + Math.cos(ry) * s * 6, { color: 0xf0e8d4 });
            }
            b.add(new THREE.BoxGeometry(27, 2, 15), tp.x, 13, tp.z, { ry, color: 0xe6dcc4 });
            b.add(new THREE.ConeGeometry(15, 4, 4), tp.x, 16, tp.z, { ry: ry + Math.PI / 4, sz: 0.55, color: 0xe0d4b8 });
        }
        for (const v of scatter(ctx, ctx.low ? 6 : 14, { min: 40, max: 200, r: 8 })) {
            const ry = -v.a;
            b.add(new THREE.BoxGeometry(10, 6, 8), v.x, 3, v.z, { ry, color: 0xf2ece0 });
            b.add(new THREE.ConeGeometry(7.5, 2.6, 4), v.x, 7.3, v.z, { ry: ry + Math.PI / 4, color: 0xc0623a });
        }
        ctx.add(b.build(ctx.lit()), 'ruins');
        if (ctx.low) return;
        forest(ctx, 'cypress', 70, { min: 10, max: 160 }, { scale: [0.9, 1.6] });
        forest(ctx, 'olive', 60, { min: 12, max: 120 });
    },

    volcanic(ctx) {
        const glowC = new THREE.Color(0xff5a1a);
        groundRing(ctx, {
            color: patchy(ctx, [0x1d1512, 0x2a1d17, 0x15100e, 0x33241b], 0.03, (out, x, z) => {
                const crack = Math.abs(ctx.noise(x * 0.02 + 9, z * 0.02) - 0.5);
                if (crack < 0.025) out.lerp(glowC, 0.7);
            })
        });
        const coneA = 1 + ctx.rng() * 4;
        // Basalt silhouettes, lit orange from below by the lava.
        const ember = new THREE.Color(0x7a2a10);
        const rock = new THREE.Color(0x2a201c);
        const pal = (t, a, crest, out) => out.copy(ember).lerp(rock, smoothstep(0, 0.45, t));
        const coneDepth = 300;
        const coneH = 240;
        const coneR = ctx.outer * 0.62;
        buildRidges(ctx, [
            { radius: ctx.reach + 140, depth: 120, height: 60, base: -4, peak: 2, freqs: [3, 7, 13, 27, 41], palette: pal },
            { radius: ctx.outer * 0.7, depth: 220, height: 140, base: -8, peak: 1.8, palette: pal },
            { radius: coneR, depth: coneDepth, height: coneH, base: -10, arc: [coneA - 0.35, coneA + 0.35], peak: 1.1, bell: true, freqs: [9, 17], palette: pal }
        ]);
        // Lava: crater glow on the cone's summit, rivers down its flank, pools.
        const g = new GeoBatch({ colors: true });
        const cr = ridgeRadius(ctx, coneR, coneDepth);
        const top = -10 + coneH * 0.95;
        g.add(new THREE.CylinderGeometry(16, 10, 5, 12), Math.cos(coneA) * cr, top, Math.sin(coneA) * cr, { color: 0xff6a1a });
        // Meandering rivers down the flanks: crest -> shoulder -> foot, each leg
        // split into wobbling segments that hug the ridge profile.
        const flank = (r, t) => (r > cr - coneDepth * 0.2)
            ? top - 4 - (cr - r) / (coneDepth * 0.2) * (top - 4 - (-10 + coneH * 0.52))
            : -10 + coneH * 0.52 - (cr - coneDepth * 0.2 - r) / (coneDepth * 0.3) * (coneH * 0.52);
        for (let k = 0; k < (ctx.low ? 2 : 4); k++) {
            const a0 = coneA + (k - 1.5) * 0.03;
            const steps = ctx.low ? 5 : 9;
            let prev = null;
            for (let i = 0; i <= steps; i++) {
                const r = (cr - 6) - (coneDepth * 0.48) * (i / steps);
                const a = a0 + Math.sin(i * 1.7 + k * 2.1) * 0.012 + (k - 1.5) * 0.02 * (i / steps);
                const pt = [Math.cos(a) * r, Math.max(-9, flank(r)) + 0.8, Math.sin(a) * r];
                if (prev) g.add(ribbon(prev, pt, 4 + i * 0.5), 0, 0, 0, { color: i < steps / 2 ? 0xff6a1a : 0xff4a10 });
                prev = pt;
            }
        }
        for (const s of scatter(ctx, ctx.low ? 3 : 7, { min: 30, max: 150, r: 16 })) {
            g.add(new THREE.CylinderGeometry(9 + ctx.rng() * 8, 9, 0.2, 12), s.x, 0.02, s.z, { color: 0xff5a14 });
        }
        ctx.add(g.build(ctx.glow()), 'lava');
        if (ctx.low) return;
        const rocks = scatter(ctx, 60, { min: 10, max: 160, r: 5 }).map(s => ({ x: s.x, y: 0.5, z: s.z, s: 1.5 + ctx.rng() * 4, ry: ctx.rng() * TAU, rx: ctx.rng() }));
        instancedProps(ctx, templateGeometry(b => b.add(new THREE.DodecahedronGeometry(1, 0), 0, 0, 0, { sy: 0.7, color: 0x2c2220 })), rocks, 'rocks');
    },

    alpine(ctx) {
        groundRing(ctx, {
            color: patchy(ctx, [0xe9eff6, 0xf6f9fc, 0xd9e2ec, 0xeaf0f7], 0.02, (out, x, z) => {
                if (ctx.noise(x * 0.008 + 5, z * 0.008) > 0.7) out.set(0xbcd6ea); // frozen ponds
            })
        });
        buildRidges(ctx, [
            { radius: ctx.reach + 150, depth: 130, height: 70, base: -4, palette: mountainPalette(ctx, 0x2f4a3c, 0x6a7888, 0xf4f7fa, 0.5) },
            { radius: ctx.outer * 0.72, depth: 240, height: 210, base: -8, peak: 1.9, palette: mountainPalette(ctx, 0x3e5060, 0x6f7c8c, 0xf6f9fc, 0.45) }
        ]);
        if (ctx.low) return;
        forest(ctx, 'snowPine', 120, { min: 8, max: 150 }, { scale: [0.9, 1.7] });
        const b = new GeoBatch({ colors: true });
        for (const c of scatter(ctx, 8, { min: 24, max: 90, r: 7 })) {
            const ry = -c.a;
            b.add(new THREE.BoxGeometry(8, 4.5, 6), c.x, 2.25, c.z, { ry, color: 0x7a4a2c });
            b.add(new THREE.ConeGeometry(6.4, 3.4, 4), c.x, 6.2, c.z, { ry: ry + Math.PI / 4, sz: 0.8, color: 0xf2f6fa });
        }
        ctx.add(b.build(ctx.lit()), 'chalets');
    },

    sky_islands(ctx) {
        const cloud = patchy(ctx, [0xffffff, 0xf4f0ff, 0xffeef6, 0xe8f0ff], 0.012);
        groundRing(ctx, {
            y: -26, name: 'cloud-sea', color: cloud,
            height: (x, z) => (ctx.noise(x * 0.02, z * 0.02) * 7 + ctx.noise(x * 0.07, z * 0.07) * 2.5)
        });
        const white = new THREE.Color(0xffffff);
        buildRidges(ctx, [
            { radius: ctx.outer * 0.7, depth: 200, height: 150, base: -30, peak: 0.7, freqs: [3, 5, 11, 19], palette: (t, a, c, out) => out.copy(white).lerp(new THREE.Color(0xdfe6f4), 1 - t) }
        ], 'cumulus');
        const b = new GeoBatch({ colors: true });
        for (const s of scatter(ctx, ctx.low ? 7 : 14, { min: 40, max: 360, r: 20 })) {
            const r = 9 + ctx.rng() * 14;
            const y = 4 + ctx.rng() * 50;
            b.add(new THREE.ConeGeometry(r, r * 1.6, 8), s.x, y - r * 0.8, s.z, { rx: Math.PI, color: 0x8a6a52 });
            b.add(new THREE.CylinderGeometry(r * 1.02, r, 1.6, 8), s.x, y + 0.8, s.z, { color: 0x6fbf5a });
            for (let k = 0; k < 3; k++) {
                const ta = ctx.rng() * TAU;
                const tr = ctx.rng() * r * 0.6;
                b.add(new THREE.ConeGeometry(1.6, 4.5, 6), s.x + Math.cos(ta) * tr, y + 3.8, s.z + Math.sin(ta) * tr, { color: 0x3f8f4a });
            }
            if (ctx.rng() < 0.4) b.add(new THREE.BoxGeometry(0.8, 0.2, r * 0.9), s.x, y - r * 0.5, s.z, { color: 0x9fd8ff }); // waterfall lip
        }
        ctx.add(b.build(ctx.lit()), 'islands');
    },

    jungle(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x2f5a2a, 0x3b6b30, 0x4a7a36, 0x55603a], 0.025) });
        buildRidges(ctx, [
            { radius: ctx.outer * 0.7, depth: 200, height: 120, base: -6, peak: 1, palette: mountainPalette(ctx, 0x2c5a30, 0x3f6e40, null) }
        ]);
        // Karst towers: tall rounded limestone pillars cloaked in green.
        // Karst hills: steep, rounded, lumpy limestone domes cloaked in forest.
        const karst = templateGeometry(b => {
            b.add(new THREE.CylinderGeometry(0.66, 1, 0.55, 9), 0, 0.275, 0, { color: 0x6f7f5a });
            b.add(new THREE.IcosahedronGeometry(0.7, 1), 0, 0.62, 0, { sy: 0.62, color: 0x3f7a3a });
            b.add(new THREE.IcosahedronGeometry(0.42, 1), 0.35, 0.86, 0.1, { sy: 0.7, color: 0x34703a });
        });
        const towers = scatter(ctx, ctx.low ? 12 : 22, { min: 90, max: 320, r: 40 }).map(s => {
            const h = 45 + ctx.rng() * 50;
            const w = 20 + ctx.rng() * 14;
            return { x: s.x, y: -2, z: s.z, sx: w, sy: h, sz: w * (0.8 + ctx.rng() * 0.3), ry: ctx.rng() * TAU };
        });
        instancedProps(ctx, karst, towers, 'karst');
        if (ctx.low) return;
        forest(ctx, 'jungle', 110, { min: 6, max: 130 }, { scale: [0.9, 1.7] });
        forest(ctx, 'palm', 30, { min: 6, max: 60 });
        const w = new GeoBatch({ colors: true });
        // Waterfalls down the court-facing flank of a few karsts.
        towers.slice(0, 4).forEach(t => {
            const d = Math.hypot(t.x, t.z) || 1;
            const ux = t.x / d;
            const uz = t.z / d;
            const r = t.sx * 0.72;
            w.add(ribbon([t.x - ux * r * 0.8, t.sy * 0.62, t.z - uz * r * 0.8], [t.x - ux * (r + 2), -1.5, t.z - uz * (r + 2)], 2.6), 0, 0, 0, { color: 0xd8f4ff });
        });
        if (w.size) ctx.add(w.build(ctx.glow()), 'waterfalls');
    },

    canyon(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0xc98a55, 0xd6a06a, 0xb8764a, 0xe0b27a], 0.02) });
        const strata = [0xa8583a, 0xc97a4a, 0xe0a070, 0xb8663f, 0xd89060];
        const strataPal = (t, a, crest, out) => out.set(strata[Math.min(strata.length - 1, Math.floor(t * crest * strata.length * 1.6) % strata.length)]);
        buildRidges(ctx, [
            { radius: ctx.reach + 200, depth: 160, height: 90, base: -4, peak: 0.6, freqs: [3, 6, 11], palette: strataPal },
            { radius: ctx.outer * 0.75, depth: 240, height: 150, base: -8, peak: 0.5, palette: strataPal }
        ]);
        const mesa = templateGeometry(b => {
            for (let k = 0; k < 4; k++) b.add(new THREE.CylinderGeometry(1 - k * 0.05, 1.05 - k * 0.05, 0.25, 9), 0, 0.125 + k * 0.25, 0, { color: strata[k] });
        });
        const mesas = scatter(ctx, ctx.low ? 10 : 20, { min: 50, max: 300, r: 36 }).map(s => ({
            x: s.x, y: -1, z: s.z, sx: 12 + ctx.rng() * 20, sy: 30 + ctx.rng() * 60, sz: 12 + ctx.rng() * 20, ry: ctx.rng() * TAU
        }));
        instancedProps(ctx, mesa, mesas, 'mesas');
        if (ctx.low) return;
        forest(ctx, 'cactus', 60, { min: 8, max: 120 }, { scale: [0.8, 1.4] });
    },

    crystal(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x2a3050, 0x343a60, 0x262a44, 0x3a3f6a], 0.03) });
        buildRidges(ctx, [
            { radius: ctx.reach + 150, depth: 130, height: 80, base: -4, peak: 2.2, freqs: [4, 9, 17, 33], palette: mountainPalette(ctx, 0x2a2f4a, 0x4a5078, 0x9fd8ff, 0.8) },
            { radius: ctx.outer * 0.7, depth: 220, height: 170, base: -8, peak: 2, palette: mountainPalette(ctx, 0x2a2f4a, 0x404670, 0xb8e4ff, 0.7) }
        ]);
        const shard = templateGeometry(b => b.add(new THREE.OctahedronGeometry(1, 0), 0, 1, 0, { sy: 1, color: 0xffffff }));
        const spikes = [];
        for (const s of scatter(ctx, ctx.low ? 14 : 30, { min: 12, max: 220, r: 12 })) {
            const cols = [0x7fdcff, 0xb88cff, 0x9fffe8, 0x6fa8ff];
            for (let k = 0; k < 3; k++) {
                spikes.push({ x: s.x + (ctx.rng() - 0.5) * 8, y: -1, z: s.z + (ctx.rng() - 0.5) * 8, sx: 2 + ctx.rng() * 3, sy: 8 + ctx.rng() * 26, sz: 2 + ctx.rng() * 3, rx: (ctx.rng() - 0.5) * 0.5, rz: (ctx.rng() - 0.5) * 0.5, color: cols[Math.floor(ctx.rng() * cols.length)] });
            }
        }
        instancedProps(ctx, shard, spikes, 'crystals', hazed(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85 }), ctx.haze, { glow: true }));
    },

    mech_base(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x5f666e, 0x6c737a, 0x575d63, 0x7a7f84], 0.03) });
        buildRidges(ctx, [{ radius: ctx.outer * 0.7, depth: 220, height: 150, base: -6, palette: mountainPalette(ctx, 0x4a5560, 0x6a7482, 0xe8eef4, 0.7) }]);
        const b = new GeoBatch({ colors: true });
        for (const s of scatter(ctx, ctx.low ? 5 : 9, { min: 40, max: 180, r: 26 })) {
            // Vaulted hangar.
            b.add(new THREE.CylinderGeometry(16, 16, 40, 14, 1, false, 0, Math.PI), s.x, 0, s.z, { rz: Math.PI / 2, ry: -s.a, color: 0x8a96a4 });
        }
        // Two parked giant mechs on opposite sides.
        for (const [a, col] of [[0.9, 0x5a6a7a], [0.9 + Math.PI, 0x6a5a58]]) {
            const d = rectEdge(ctx.hx, ctx.hz, a) + 110;
            const x = Math.cos(a) * d;
            const z = Math.sin(a) * d;
            const ry = -a - Math.PI / 2;
            for (const s of [-1, 1]) {
                const ox = Math.cos(ry) * s * 7;
                const oz = -Math.sin(ry) * s * 7;
                b.add(new THREE.BoxGeometry(5, 26, 6), x + ox, 13, z + oz, { ry, color: col });
                b.add(new THREE.BoxGeometry(4, 20, 4), x + ox * 2.4, 38, z + oz * 2.4, { ry, color: col });
            }
            b.add(new THREE.BoxGeometry(22, 22, 12), x, 37, z, { ry, color: col });
            b.add(new THREE.BoxGeometry(8, 6, 7), x, 51, z, { ry, color: 0x3a3f46 });
        }
        for (const s of scatter(ctx, 4, { min: 60, max: 200, r: 10 })) {
            b.add(new THREE.BoxGeometry(3, 60, 3), s.x, 30, s.z, { color: 0xb0b8c0 });
            b.add(new THREE.CylinderGeometry(6, 0.5, 3, 10), s.x, 62, s.z, { rx: 0.6, color: 0xd8dde2 });
        }
        ctx.add(b.build(ctx.lit()), 'hangars');
        if (ctx.low) return;
        const g = new GeoBatch({ colors: true });
        for (const s of scatter(ctx, 30, { min: 20, max: 200, r: 2 })) g.add(new THREE.SphereGeometry(0.7, 6, 4), s.x, 1 + ctx.rng() * 3, s.z, { color: ctx.rng() < 0.5 ? 0xffb347 : 0x5fd8ff });
        ctx.add(g.build(ctx.glow()), 'base-lights');
    },

    seabed(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x1f6a70, 0x2a7a78, 0x1a5a66, 0x3a8a80], 0.025) });
        buildRidges(ctx, [
            { radius: ctx.reach + 160, depth: 140, height: 60, base: -4, peak: 1.8, palette: mountainPalette(ctx, 0x184a58, 0x2a6068, null) },
            { radius: ctx.outer * 0.62, depth: 220, height: 120, base: -8, palette: mountainPalette(ctx, 0x123e50, 0x1f5060, null) }
        ]);
        const ruins = new GeoBatch({ colors: true });
        for (const s of scatter(ctx, ctx.low ? 6 : 12, { min: 25, max: 200, r: 12 })) {
            const ry = -s.a;
            for (let k = 0; k < 4; k++) {
                const hgt = 6 + ctx.rng() * 12;
                ruins.add(new THREE.CylinderGeometry(1, 1.2, hgt, 10), s.x + Math.cos(ry) * (k - 1.5) * 5, hgt / 2, s.z - Math.sin(ry) * (k - 1.5) * 5, { color: 0x8fb8b0 });
            }
            ruins.add(new THREE.BoxGeometry(20, 1.4, 4), s.x, 14, s.z, { ry, rz: (ctx.rng() - 0.5) * 0.3, color: 0x7fa8a0 });
        }
        ctx.add(ruins.build(ctx.lit()), 'ruins');
        if (ctx.low) return;
        const coral = templateGeometry(b => {
            b.add(new THREE.ConeGeometry(0.6, 3, 6), 0, 1.5, 0, { color: 0xffffff });
            b.add(new THREE.ConeGeometry(0.45, 2.4, 6), 0.8, 1.6, 0.2, { rz: -0.5, color: 0xffffff });
            b.add(new THREE.ConeGeometry(0.45, 2.2, 6), -0.7, 1.5, -0.3, { rz: 0.5, color: 0xffffff });
        });
        const corals = scatter(ctx, 90, { min: 6, max: 140, r: 2 }).map(s => ({ x: s.x, y: 0, z: s.z, s: 1 + ctx.rng() * 2, ry: ctx.rng() * TAU, color: [0xff7a8a, 0xffb347, 0xb88cff, 0x5fd8c0, 0xff5fa8][Math.floor(ctx.rng() * 5)] }));
        instancedProps(ctx, coral, corals, 'coral');
        const kelp = templateGeometry(b => b.add(new THREE.PlaneGeometry(1.2, 14, 1, 4), 0, 7, 0, { color: 0x3f8f4a }));
        const kelps = scatter(ctx, 70, { min: 8, max: 120, r: 2 }).map(s => ({ x: s.x, y: 0, z: s.z, sy: 0.7 + ctx.rng(), ry: ctx.rng() * TAU }));
        instancedProps(ctx, kelp, kelps, 'kelp', hazed(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), ctx.haze));
    },

    voxel(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0x6aa84a, 0x7cb342, 0x5a9a3a, 0x8ac04f], 0.04) });
        const cell = ctx.low ? 18 : 12;
        const extent = Math.max(ctx.reach + 300, ctx.outer * 0.5);
        const cols = [];
        const stone = 0x8a8a8a;
        for (let x = -extent; x <= extent; x += cell) {
            for (let z = -extent; z <= extent; z += cell) {
                const r = Math.hypot(x, z);
                if (r > extent || !ctx.clear(x, z, cell * 0.8 + 10)) continue;
                const rise = smoothstep(ctx.reach + 20, ctx.reach + 260, r);
                const n = ctx.noise(x * 0.012, z * 0.012) * 0.75 + ctx.noise(x * 0.04, z * 0.04) * 0.25;
                const h = Math.floor((n * n * 90 * rise + rise * 8) / 4) * 4;
                if (h < 4) continue;
                const color = h > 64 ? 0xf4f7fa : h > 44 ? stone : h > 8 ? 0x5f9a3a : 0xd9c78a;
                cols.push({ x, y: h / 2 - 0.06, z, sx: cell, sy: h, sz: cell, color });
            }
        }
        instancedProps(ctx, templateGeometry(b => b.add(new THREE.BoxGeometry(1, 1, 1), 0, 0, 0, { color: 0xffffff })), cols, 'voxels');
        if (ctx.low) return;
        forest(ctx, 'blocky', 60, { min: 6, max: 80 });
    },

    highlands(ctx) {
        groundRing(ctx, { color: patchy(ctx, [0xb8a468, 0xa8a060, 0xc8b47a, 0x98945a], 0.02) });
        buildRidges(ctx, [
            { radius: ctx.reach + 160, depth: 150, height: 55, base: -4, peak: 1.1, palette: mountainPalette(ctx, 0x8a8a52, 0xa89a6a, null) },
            { radius: ctx.outer * 0.75, depth: 230, height: 170, base: -8, palette: mountainPalette(ctx, 0x6a6f60, 0x8a8478, 0xf2f4f6, 0.62) }
        ]);
        const b = new GeoBatch({ colors: true });
        for (const s of scatter(ctx, ctx.low ? 4 : 8, { min: 30, max: 160, r: 9 })) {
            const ry = -s.a;
            for (let k = 0; k < 3; k++) b.add(new THREE.BoxGeometry(12 - k * 3, 2.4, 10 - k * 3), s.x, 1.2 + k * 2.4, s.z, { ry, color: 0xd8c8a0 });
            for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.6, 0.7, 7, 8), s.x + Math.cos(ry) * sx * 3, 10.7, s.z - Math.sin(ry) * sx * 3, { color: 0xe8dcc0 });
        }
        ctx.add(b.build(ctx.lit()), 'ruins');
        if (ctx.low) return;
        forest(ctx, 'cypress', 60, { min: 10, max: 150 }, { scale: [0.9, 1.5] });
    },

    space(ctx) {
        // No ground: a far station and an asteroid belt around the arena.
        const b = new GeoBatch({ colors: true });
        const a = 2.2;
        const d = ctx.outer * 0.55;
        const sx = Math.cos(a) * d;
        const sz = Math.sin(a) * d;
        const sy = 140;
        b.add(new THREE.TorusGeometry(60, 5, 8, 48), sx, sy, sz, { rx: 1.2, color: 0xb8c4d8 });
        b.add(new THREE.CylinderGeometry(9, 9, 40, 14), sx, sy, sz, { rx: 1.2, color: 0xd8e0ec });
        for (let k = 0; k < 4; k++) b.add(new THREE.BoxGeometry(2.4, 2.4, 116), sx, sy, sz, { rx: 1.2, rz: (k / 4) * Math.PI, color: 0x8a96aa });
        b.add(new THREE.BoxGeometry(80, 0.6, 18), sx, sy - 34, sz, { rx: 1.2, color: 0x2f4a8a });
        ctx.add(b.build(ctx.lit()), 'station');
        if (ctx.low) return;
        const rocks = [];
        for (let i = 0; i < (ctx.high ? 260 : 170); i++) {
            const ang = ctx.rng() * TAU;
            const r = ctx.reach + 150 + ctx.rng() * 180;
            rocks.push({ x: Math.cos(ang) * r, y: -30 + ctx.rng() * 50 + Math.sin(ang * 3) * 14, z: Math.sin(ang) * r, s: 1.5 + ctx.rng() * 6, rx: ctx.rng() * TAU, ry: ctx.rng() * TAU });
        }
        instancedProps(ctx, templateGeometry(bb => bb.add(new THREE.DodecahedronGeometry(1, 0), 0, 0, 0, { color: 0x6a625a })), rocks, 'asteroids');
    },

    // --- identity maps: only the missing far ground (+ a low range) --------
    far_jungle(ctx) {
        groundRing(ctx, { y: -1.4, hole: [310, 310], color: patchy(ctx, [0x2f5a2a, 0x3b6b30, 0x2a4f28], 0.02) });
        buildRidges(ctx, [{ radius: ctx.outer * 0.7, depth: 200, height: 110, base: -6, peak: 1.1, palette: mountainPalette(ctx, 0x2c5a30, 0x456e44, null) }]);
    },
    far_desert(ctx) {
        const { halfW, halfL } = halves(ctx);
        groundRing(ctx, { hole: [halfW + 60, halfL + 60], color: patchy(ctx, [0xd9a66e, 0xe4b67e, 0xcf9a62], 0.015) });
        buildRidges(ctx, [{ radius: ctx.outer * 0.82, depth: 200, height: 45, base: -4, peak: 0.8, freqs: [3, 7, 12], palette: mountainPalette(ctx, 0xd8a472, 0xe8bc88, null) }], 'dunes');
    },
    far_harbor(ctx) {
        const { halfW, halfL } = halves(ctx);
        const quayX = halfW + 34;
        groundRing(ctx, {
            hole: [halfW + 70, halfL + 70],
            color: patchy(ctx, [0x1c1f26, 0x23272e, 0x181a20], 0.03),
            height: x => (x > quayX ? -6 : 0) // stays under the harbour water to the east
        });
        buildRidges(ctx, [{ radius: ctx.outer * 0.7, depth: 200, height: 70, base: -6, arc: [Math.PI * 0.55, Math.PI * 1.45], palette: mountainPalette(ctx, 0x14171c, 0x1f232a, null) }], 'hills');
    },
    far_snow(ctx) {
        const { halfW, halfL } = halves(ctx);
        groundRing(ctx, { hole: [halfW + 90, halfL + 90], color: patchy(ctx, [0xe9eff6, 0xf6f9fc, 0xdbe4ee], 0.02) });
    },
    far_garden(ctx) {
        const { halfW, halfL } = halves(ctx);
        groundRing(ctx, { hole: [halfW + 70, halfL + 70], color: patchy(ctx, [0x5f8048, 0x6d8f52, 0x7a9a5c], 0.02) });
        buildRidges(ctx, [{ radius: ctx.outer * 0.62, depth: 180, height: 60, base: -4, peak: 1, freqs: [3, 5, 9, 14], palette: mountainPalette(ctx, 0x4f7a45, 0x6a8a5a, null) }], 'tea-hills');
    }
};

function halves(ctx) {
    return { halfW: ctx.arena.courtWidth / 2, halfL: ctx.arena.courtLength / 2 };
}

const CITY_STYLES = {
    city_day: {
        ground: [0x6f747a, 0x7c8186, 0x656a70, 0x858a80], parks: true, count: 70,
        heights: [[18, 45], [30, 90], [50, 160]], tints: [0xffffff, 0xe8eef4, 0xf4ece0, 0xdfe8f0],
        facade: { name: 'office', wall: '#c9d1da', glass: '#4f6f8f', cols: 6, rows: 10, gapX: 0.08, litChance: 0.3 },
        hills: { height: 70, foot: 0x5f7f55, rock: 0x7a8a78 }, beaconChance: 0.25
    },
    city_night: {
        ground: [0x14121c, 0x1a1724, 0x100e16], count: 80,
        heights: [[20, 50], [35, 100], [60, 180]], tints: [0xd0c8ff, 0xffd9c0, 0xb8f0ff, 0xffffff],
        facade: { name: 'night', wall: '#1a1a26', glass: '#23263a', cols: 7, rows: 12, litChance: 0.42, lights: ['#ffd27a', '#ffe7b0', '#8fd8ff', '#ff7ad9', '#b6a4ff'] },
        beaconChance: 0.45, crowns: { chance: 0.35, colors: [0xff3d81, 0x2de2e6, 0xb36bff, 0xffd23d], vertical: true }
    },
    cyber_city: {
        ground: [0x0e1a24, 0x122230, 0x0a141c], count: 76,
        heights: [[20, 55], [40, 120], [70, 200]], widths: [12, 26], tints: [0xbff6ff, 0xd8ffff, 0xa8e8ff],
        facade: { name: 'cyber', wall: '#0c1822', glass: '#12303c', cols: 8, rows: 14, gapX: 0.1, litChance: 0.5, lights: ['#35d9cc', '#7ffcff', '#b7ff43', '#ff4fa3'] },
        beacon: 0x35d9cc, beaconChance: 0.5, crowns: { chance: 0.55, colors: [0x35d9cc, 0xb7ff43, 0xff4fa3, 0x22ddff], vertical: true }
    },
    city_high: {
        // Dropworks: the course hangs high among towers; the street is far below.
        groundY: -70, ground: [0x3a3f46, 0x464b52, 0x32363c], count: 60,
        heights: [[-10, 40], [10, 90], [40, 150]], widths: [16, 30], tints: [0xe8e0d0, 0xd8dde2, 0xf0e4d4],
        facade: { name: 'tower', wall: '#b8b2a6', glass: '#3f5468', cols: 6, rows: 10, litChance: 0.3 },
        beaconChance: 0.4
    }
};
for (const id of Object.keys(CITY_STYLES)) THEMES[id] = ctx => THEMES.city(ctx, CITY_STYLES[id]);

export const BACKDROP_THEMES = Object.freeze(Object.keys(THEMES).filter(id => id !== 'city'));

export function backdropThemeFor(mapId) {
    return Object.hasOwn(MAP_BACKDROPS, mapId) ? MAP_BACKDROPS[mapId] : null;
}

// Builds the backdrop for arena.mapId. Returns the meshes added (all through
// arena.add(), so Arena.clearMap() disposes them; textures go to
// arena._artTextures).
export function buildBackdrop(arena, tier = 'medium') {
    const theme = backdropThemeFor(arena.mapId);
    if (!theme || !THEMES[theme] || !arena?.scene) return [];
    const ctx = createContext(arena, tier, theme);
    THEMES[theme](ctx);
    return ctx.meshes;
}
