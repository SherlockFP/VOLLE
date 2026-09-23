// viewmodel-fx.js — rarity presentation layered onto the first-person knife.
// A skin's rarity must read in the player's own hands, not only in the case reel:
//   rare      → fresnel rim glow in the skin's accent colour
//   epic      → + swing trail on slash/stab/inspect
//   legendary → + orbiting sparkles and a slow rim pulse
// Everything is built once per equip (attachViewmodelFx) and updated in place per
// frame (updateViewmodelFx) — no allocation on the render path. Reduced motion
// keeps the static rim and drops trail, sparkles and pulse.
import * as THREE from 'three';

export const VIEWMODEL_RARITY_FX = Object.freeze({
    common: Object.freeze({ rim: 0, trail: false, sparkles: 0, pulse: 0 }),
    uncommon: Object.freeze({ rim: 0.28, trail: false, sparkles: 0, pulse: 0 }),
    rare: Object.freeze({ rim: 0.55, trail: false, sparkles: 0, pulse: 0 }),
    epic: Object.freeze({ rim: 0.8, trail: true, sparkles: 0, pulse: 0 }),
    legendary: Object.freeze({ rim: 1, trail: true, sparkles: 14, pulse: 0.35 }),
    exotic: Object.freeze({ rim: 1, trail: true, sparkles: 18, pulse: 0.45 })
});

export const TRAIL_SEGMENTS = 14;
const TRAIL_ACTIONS = new Set(['slash', 'stab', 'heavy', 'inspect']);

// Pure: the effect profile for a rarity, collapsed for reduced motion.
export function viewmodelFxForRarity(rarity, { reduceMotion = false } = {}) {
    const key = typeof rarity === 'string' ? rarity.trim().toLowerCase() : '';
    const fx = VIEWMODEL_RARITY_FX[key] || VIEWMODEL_RARITY_FX.common;
    if (!reduceMotion) return fx;
    return { rim: fx.rim, trail: false, sparkles: 0, pulse: 0 };
}

// Pure: 0..1 trail brightness for a knife action. Fades in fast, out over the
// last 35% so the ribbon never pops off mid-swing.
export function trailStrength(action, progress) {
    if (!TRAIL_ACTIONS.has(action)) return 0;
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    const rise = Math.min(1, t / 0.12);
    const fall = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    return Math.max(0, Math.min(rise, fall));
}

const RIM_VERTEX = `
varying vec3 vNormal;
varying vec3 vView;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
}`;

const RIM_FRAGMENT = `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vView;
void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
    // Alpha-blended (not additive) so the tint also reads on bright daylight maps.
    gl_FragColor = vec4(uColor, clamp(fresnel * uIntensity, 0.0, 0.92));
}`;

let sparkleTexture = null;
function getSparkleTexture() {
    if (sparkleTexture || typeof document === 'undefined') return sparkleTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    sparkleTexture = new THREE.CanvasTexture(canvas);
    return sparkleTexture;
}

// Deterministic PRNG so a skin's sparkle layout is stable between equips.
function seeded(seed) {
    let state = (Math.abs(Math.trunc(seed)) || 1) >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

// Builds the rarity layer for a freshly created knife group (call BEFORE the
// viewmodel frame transform is applied, while the group is still at identity).
// `host` is the object the trail lives under (the camera), so the ribbon is in
// view space and does not smear when the player turns.
export function attachViewmodelFx(knifeGroup, style = {}, host = null, { reduceMotion = false } = {}) {
    if (!knifeGroup) return null;
    const fx = viewmodelFxForRarity(style.rarity, { reduceMotion });
    if (fx.rim <= 0 && !fx.trail && fx.sparkles <= 0) return null;

    const accent = new THREE.Color(style.accent || style.color || '#6ef0dc');
    const glow = accent.clone().lerp(new THREE.Color(style.color || '#ffffff'), 0.35);
    const state = {
        fx, knifeGroup, host,
        rimMaterial: null, rimMeshes: [],
        trail: null, sparkles: null,
        tip: null, heel: null,
        time: 0,
        _world: new THREE.Vector3(),
        _inverse: new THREE.Matrix4()
    };

    knifeGroup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(knifeGroup);
    const center = bounds.getCenter(new THREE.Vector3());

    if (fx.rim > 0) {
        state.rimMaterial = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: glow }, uIntensity: { value: 1.6 * fx.rim } },
            vertexShader: RIM_VERTEX,
            fragmentShader: RIM_FRAGMENT,
            blending: THREE.NormalBlending,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const meshes = [];
        knifeGroup.traverse(object => { if (object.isMesh) meshes.push(object); });
        for (const mesh of meshes) {
            const shell = new THREE.Mesh(mesh.geometry, state.rimMaterial);
            shell.name = 'viewmodel-rim';
            shell.userData.sharedGeometry = true;
            shell.renderOrder = 2;
            mesh.add(shell);
            state.rimMeshes.push(shell);
        }
    }

    if (fx.trail || fx.sparkles > 0) {
        // Markers ride the knife through every pose; the trail samples them.
        state.tip = new THREE.Object3D();
        state.tip.position.set(center.x, center.y, bounds.min.z);
        state.heel = new THREE.Object3D();
        state.heel.position.set(center.x, center.y, bounds.min.z * 0.45 + bounds.max.z * 0.55);
        knifeGroup.add(state.tip, state.heel);
    }

    if (fx.trail && host) {
        const count = TRAIL_SEGMENTS * 2;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const indices = [];
        for (let i = 0; i < TRAIL_SEGMENTS - 1; i++) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setIndex(indices);
        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'viewmodel-trail';
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        mesh.visible = false;
        host.add(mesh);
        state.trail = { mesh, positions, colors, color: glow, primed: false };
    }

    if (fx.sparkles > 0) {
        const random = seeded(Number(style.patternSeed) || style.id?.length || 7);
        const positions = new Float32Array(fx.sparkles * 3);
        const length = Math.max(0.05, bounds.max.z - bounds.min.z);
        for (let i = 0; i < fx.sparkles; i++) {
            const angle = random() * Math.PI * 2;
            const radius = 0.03 + random() * 0.05;
            positions[i * 3] = center.x + Math.cos(angle) * radius;
            positions[i * 3 + 1] = center.y + Math.sin(angle) * radius;
            positions[i * 3 + 2] = bounds.min.z + random() * length * 0.75;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: glow,
            size: 0.018,
            map: getSparkleTexture(),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            opacity: 0.8
        });
        const points = new THREE.Points(geometry, material);
        points.name = 'viewmodel-sparkles';
        points.frustumCulled = false;
        knifeGroup.add(points);
        state.sparkles = { points, material, pivotZ: center.z };
    }

    knifeGroup.userData.viewmodelFx = state;
    return state;
}

// Per-frame, allocation-free. `pose` is resolveKnifePose's result.
export function updateViewmodelFx(state, dt, pose) {
    if (!state) return;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    state.time += step;
    const { fx } = state;

    if (state.rimMaterial) {
        const pulse = fx.pulse > 0 ? 1 + fx.pulse * Math.sin(state.time * 2.6) : 1;
        const swing = trailStrength(pose?.action, pose?.progress);
        state.rimMaterial.uniforms.uIntensity.value = 1.6 * fx.rim * pulse * (1 + swing * 0.6);
    }

    if (state.sparkles) {
        const { points, material } = state.sparkles;
        points.rotation.z = state.time * 0.9;
        material.opacity = 0.55 + 0.35 * Math.sin(state.time * 4.1);
    }

    const trail = state.trail;
    if (!trail || !state.tip || !state.host) return;
    const strength = trailStrength(pose?.action, pose?.progress);
    const { positions, colors, color, mesh } = trail;
    const world = state._world;
    // Samples are stored in host (camera) space so turning never smears the ribbon.
    state.host.updateMatrixWorld();
    state._inverse.copy(state.host.matrixWorld).invert();

    // Newest sample goes to slot 0; older samples shift back one slot.
    positions.copyWithin(6, 0, positions.length - 6);
    state.tip.getWorldPosition(world).applyMatrix4(state._inverse);
    positions[0] = world.x; positions[1] = world.y; positions[2] = world.z;
    state.heel.getWorldPosition(world).applyMatrix4(state._inverse);
    positions[3] = world.x; positions[4] = world.y; positions[5] = world.z;

    if (!trail.primed) {
        // First sample: collapse the whole ribbon onto the blade so it never
        // streaks in from the origin.
        for (let i = 6; i < positions.length; i += 6) {
            positions[i] = positions[0]; positions[i + 1] = positions[1]; positions[i + 2] = positions[2];
            positions[i + 3] = positions[3]; positions[i + 4] = positions[4]; positions[i + 5] = positions[5];
        }
        trail.primed = true;
    }

    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
        const fade = strength * (1 - i / (TRAIL_SEGMENTS - 1));
        const tipFade = fade * fade;
        const o = i * 6;
        colors[o] = color.r * tipFade; colors[o + 1] = color.g * tipFade; colors[o + 2] = color.b * tipFade;
        colors[o + 3] = color.r * tipFade * 0.35; colors[o + 4] = color.g * tipFade * 0.35; colors[o + 5] = color.b * tipFade * 0.35;
    }
    mesh.visible = strength > 0.001;
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
}

// Releases everything attachViewmodelFx created. Knife geometry is shared with the
// rim shells and is disposed by the knife's own disposal, never here.
export function disposeViewmodelFx(state) {
    if (!state) return;
    for (const shell of state.rimMeshes) shell.parent?.remove(shell);
    state.rimMeshes.length = 0;
    state.rimMaterial?.dispose();
    if (state.trail) {
        state.trail.mesh.parent?.remove(state.trail.mesh);
        state.trail.mesh.geometry.dispose();
        state.trail.mesh.material.dispose();
    }
    if (state.sparkles) {
        state.sparkles.points.parent?.remove(state.sparkles.points);
        state.sparkles.points.geometry.dispose();
        state.sparkles.material.dispose();
    }
    if (state.knifeGroup?.userData.viewmodelFx === state) delete state.knifeGroup.userData.viewmodelFx;
}
