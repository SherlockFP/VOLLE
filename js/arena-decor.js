// arena-decor.js — optional CC-BY GLTF arena decor (bleachers, seats, scoreboard,
// floodlights, gym clutter) + a reusable trophy template for round/match celebrations.
// ponytail: mirrors js/social-lobby.js _loadAssets — GLTFLoader + MeshoptDecoder,
// loadAsync().catch(() => null). A missing/corrupt .glb is a silent no-op; the game
// never depends on these models to function.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const DECOR_BASE = 'assets/cc-by/sketchfab/';

// key -> { url, targetHeight } — targetHeight is the world-unit Y span each model is
// uniformly scaled to after bounding-box normalization. Source units vary wildly
// between sketchfab authors (raw glTF bounds span from ~5 units to ~800 units across
// these six files), so the *target* is the only meaningful tuning constant; the scale
// factor itself is always derived at load time from the model's own bounding box.
export const DECOR_ASSETS = Object.freeze({
    bleachers: { url: `${DECOR_BASE}bleachers-small.glb`, targetHeight: 4.2 },
    seats: { url: `${DECOR_BASE}arena-seats.glb`, targetHeight: 4.6 },
    scoreboard: { url: `${DECOR_BASE}scoreboard.glb`, targetHeight: 6 },
    lights: { url: `${DECOR_BASE}stadium-light.glb`, targetHeight: 9 },
    gym: { url: `${DECOR_BASE}gym-assets.glb`, targetHeight: 2.1 },
    trophy: { url: `${DECOR_BASE}trophy-gold.glb`, targetHeight: 1.2 }
});

// ---------------------------------------------------------------------------
// Pure helpers — no THREE dependency, directly unit-testable without a WebGL/
// three.js runtime.
// ---------------------------------------------------------------------------

// Filters a map's `decor` list down to known, deduplicated asset keys. Unknown
// keys (typos, future assets) are silently dropped rather than throwing.
export function resolveDecorKinds(decor) {
    if (!Array.isArray(decor)) return [];
    const seen = new Set();
    for (const key of decor) {
        if (DECOR_ASSETS[key]) seen.add(key);
    }
    return [...seen];
}

// Uniform scale factor mapping a model's raw bounding-box height to targetHeight.
export function computeNormalizeScale(bboxHeight, targetHeight) {
    if (!(bboxHeight > 0) || !(targetHeight > 0)) return 1;
    return targetHeight / bboxHeight;
}

// Local-space Y offset that, once `scale` is applied, plants the model's lowest
// vertex at world Y=0 — grounds every decor piece regardless of its source pivot.
export function computeGroundOffset(bboxMinY, scale) {
    return -bboxMinY * scale;
}

// Placement math per decor kind, independent of THREE. Bleachers/seats reuse the
// exact side/setback/tiers geometry Arena.buildSpectatorStands() uses for the
// procedural stands, so GLB decor lines up flush against the existing tribunes
// instead of floating apart from them.
export function computeDecorPlacements(mapDef, arenaSize) {
    const halfW = (arenaSize?.courtWidth ?? mapDef?.courtWidth ?? 80) / 2;
    const halfL = (arenaSize?.courtLength ?? mapDef?.courtLength ?? 80) / 2;
    const wallHeight = arenaSize?.wallHeight ?? mapDef?.wallHeight ?? 18;
    const ceilingHeight = arenaSize?.ceilingHeight ?? mapDef?.ceilingHeight ?? (wallHeight + 6);
    const stands = Array.isArray(mapDef?.spectator?.stands) ? mapDef.spectator.stands.slice(0, 8) : [];

    const standPlacements = stands.map(stand => {
        const setback = Math.max(2, stand.setback || 4);
        const depth = Math.max(1, stand.depth || 2);
        const tiers = Math.min(8, Math.max(1, Math.floor(stand.tiers || 1)));
        const offset = setback + depth * tiers * 0.5;
        const x = stand.side === 'west' ? -halfW - offset : stand.side === 'east' ? halfW + offset : 0;
        const z = stand.side === 'north' ? -halfL - offset : stand.side === 'south' ? halfL + offset : 0;
        const rotationY = stand.side === 'west' ? Math.PI / 2
            : stand.side === 'east' ? -Math.PI / 2
                : stand.side === 'north' ? Math.PI : 0;
        return { x, y: 0, z, rotationY };
    });

    return {
        bleachers: standPlacements,
        seats: standPlacements,
        scoreboard: [{ x: 0, y: ceilingHeight * 0.55, z: halfL + 1.5, rotationY: Math.PI }],
        lights: [
            { x: -(halfW + 3), y: 0, z: -(halfL + 3), rotationY: Math.PI * 0.25 },
            { x: halfW + 3, y: 0, z: -(halfL + 3), rotationY: -Math.PI * 0.25 },
            { x: -(halfW + 3), y: 0, z: halfL + 3, rotationY: Math.PI * 0.75 },
            { x: halfW + 3, y: 0, z: halfL + 3, rotationY: -Math.PI * 0.75 }
        ],
        gym: [{ x: -halfW * 0.85, y: 0, z: halfL * 0.7, rotationY: Math.PI / 4 }]
    };
}

// ---------------------------------------------------------------------------
// THREE-dependent runtime
// ---------------------------------------------------------------------------

// Scales `root` uniformly so its bounding-box height matches targetHeight, then
// centers it on X/Z and grounds its lowest point to local Y=0.
function normalizeAndGround(root, targetHeight) {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = computeNormalizeScale(size.y, targetHeight);
    const center = box.getCenter(new THREE.Vector3());
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, computeGroundOffset(box.min.y, scale), -center.z * scale);
    return root;
}

// Loads the decor kinds listed in `mapDef.decor` (e.g. ['bleachers','lights']),
// places one instance per computed placement slot, and returns the group holding
// them all (already added to `scene`). Returns null when the map has no decor,
// or when disposeArenaDecor() tears the group down again before loads settle.
export async function loadArenaDecor(scene, mapDef, arenaSize) {
    const kinds = resolveDecorKinds(mapDef?.decor);
    if (!kinds.length) return null;

    const group = new THREE.Group();
    group.name = 'arena-decor';
    scene.add(group);

    // ponytail: one cheap, shadowless PointLight stands in for the stadium-light
    // fixtures' glow — never a real SpotLight (shadow-map cost). Skipped outright
    // when the renderer says quality/hub-performance mode disallows it.
    if (kinds.includes('lights') && arenaSize?.allowDecorLight !== false) {
        const glow = new THREE.PointLight(0xfff2c9, 0.35, Math.max(30, (arenaSize?.courtWidth || 90) * 0.4));
        glow.castShadow = false;
        glow.position.set(0, Math.max(10, (arenaSize?.ceilingHeight || 24) - 2), 0);
        group.add(glow);
    }

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const placements = computeDecorPlacements(mapDef, arenaSize);

    const jobs = kinds.flatMap(kind => {
        const asset = DECOR_ASSETS[kind];
        const spots = placements[kind] || [];
        return spots.map(async spot => {
            const gltf = await loader.loadAsync(asset.url).catch(() => null);
            if (!gltf || group.userData.disposed) return;
            const model = normalizeAndGround(gltf.scene, asset.targetHeight);
            model.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = false;
                child.receiveShadow = false;
                if (kind !== 'lights' || !child.material) return;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => { if ('emissiveIntensity' in mat) mat.emissiveIntensity = 1.5; });
            });
            const holder = new THREE.Group();
            holder.position.set(spot.x, spot.y, spot.z);
            holder.rotation.y = spot.rotationY || 0;
            holder.add(model);
            group.add(holder);
        });
    });

    await Promise.allSettled(jobs);
    return group.userData.disposed ? null : group;
}

// Tears a decor group down: removes it from the scene and disposes every
// geometry/material/texture it owns. Safe to call with null/undefined.
export function disposeArenaDecor(group) {
    if (!group) return;
    group.userData.disposed = true;
    group.parent?.remove(group);
    group.traverse(child => {
        if (child.isLight) return;
        if (child.geometry) child.geometry.dispose();
        if (!child.material) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'].forEach(key => {
                mat[key]?.dispose?.();
            });
            mat.dispose?.();
        });
    });
}

let trophyTemplatePromise = null;

// Loads & normalizes the trophy once (cached across calls/maps), then publishes it
// at `window.arenaDecor.trophy` so other slices can consume it via optional chaining
// (`window.arenaDecor?.trophy?.clone()`). Wiring it into round/match-win celebration
// is a different slice's job — this only guarantees the template exists when ready.
export function preloadTrophyTemplate() {
    if (trophyTemplatePromise) return trophyTemplatePromise;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    trophyTemplatePromise = loader.loadAsync(DECOR_ASSETS.trophy.url)
        .then(gltf => {
            const template = normalizeAndGround(gltf.scene, DECOR_ASSETS.trophy.targetHeight);
            template.name = 'arena-decor-trophy-template';
            if (typeof window !== 'undefined') {
                window.arenaDecor = Object.assign(window.arenaDecor || {}, { trophy: template });
            }
            return template;
        })
        .catch(() => null);
    return trophyTemplatePromise;
}
