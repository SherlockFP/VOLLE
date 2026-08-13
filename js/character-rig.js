// character-rig.js — THREE skeleton + sockets + materials for the canonical Warrball character.
// ponytail: geometri sabit sayılar plan diyagramından birebir; oran/renk shop-showcase'ten import.
import * as THREE from 'three';
import { JOINTS } from './character-pose.js';
import { AVATAR_SKINS, getAvatarArmScale, getAvatarAtlasBoxes } from './avatar.js';
import { getShowcaseMaterialPalette, getShowcaseCharacterShape, normalizeShowcaseState } from './shop-showcase.js';

export const RIG_SOCKETS = Object.freeze([
    'head', 'face', 'back', 'chest', 'waist',
    'handL', 'handR', 'footL', 'footR', 'aura', 'trail'
]);

const MATERIAL_SLOTS = Object.freeze(['head', 'body', 'arms', 'legs', 'accent', 'detail', 'visor']);
const TEAM_COLORS = Object.freeze({ red: 0xcc3333, blue: 0x3355cc });
const ATLAS_SIZE = 64;
// Small, socket-safe silhouette signatures make each selectable hero and skin
// legible from range without replacing the shared skeleton. Each tuple is
// [width,height,depth,x,y,z,rotX,rotY,rotZ] and is applied only when identity
// changes, never in the render/update loop.
const signature = values => Object.freeze(values);
const CHARACTER_SIGNATURES = Object.freeze({
    rally: signature({ crest: [.28, .12, .24, -.08, .49, -.01, 0, 0, -.12], chest: [.20, .30, .035, -.05, .42, -.15, 0, 0, -.18], back: [.14, .34, .07, .16, .36, .18, 0, 0, .12] }),
    tank: signature({ crest: [.44, .11, .34, 0, .49, 0], temples: [.09, .28, .30, .29, .20, 0], chest: [.46, .34, .05, 0, .43, -.15], back: [.46, .42, .18, 0, .36, .25] }),
    scout: signature({ crest: [.34, .06, .44, -.08, .46, -.03, 0, 0, -.05], chest: [.09, .35, .03, -.10, .42, -.15, 0, 0, -.24], back: [.18, .24, .08, 0, .39, .19] }),
    sniper: signature({ crest: [.38, .05, .30, 0, .46, 0], temples: [.04, .20, .26, .27, .20, 0], chest: [.06, .30, .03, .11, .40, -.145], back: [.18, .30, .10, 0, .38, .20] }),
    guardian: signature({ crest: [.34, .10, .22, 0, .48, 0], temples: [.08, .18, .24, .28, .20, 0], chest: [.36, .28, .04, 0, .42, -.15], back: [.36, .20, .15, 0, .38, .23] }),
    blazer: signature({ crest: [.10, .24, .16, 0, .55, .02], chest: [.20, .18, .03, 0, .48, -.145], back: [.20, .22, .09, 0, .40, .19] }),
    frost: signature({ crest: [.30, .14, .24, 0, .50, 0], temples: [.05, .12, .22, .27, .24, 0], chest: [.28, .22, .03, 0, .45, -.145], back: [.28, .20, .11, 0, .38, .21] }),
    volt: signature({ crest: [.12, .19, .16, .08, .52, 0], chest: [.08, .28, .03, .09, .42, -.145], back: [.20, .26, .09, 0, .39, .20] }),
    nova: signature({ crest: [.24, .15, .20, 0, .51, 0], chest: [.22, .22, .03, 0, .44, -.145], back: [.30, .18, .11, 0, .38, .22] }),
    ripple: signature({ crest: [.34, .07, .24, 0, .47, 0], chest: [.34, .10, .03, 0, .47, -.145], back: [.34, .13, .13, 0, .36, .22] }),
    soldier: signature({ crest: [.30, .08, .26, 0, .47, 0], temples: [.05, .14, .24, .27, .20, 0], chest: [.28, .24, .04, 0, .42, -.15], back: [.32, .30, .14, 0, .36, .24] }),
    anchor: signature({ crest: [.34, .10, .26, 0, .49, 0], temples: [.07, .20, .24, .28, .20, 0], chest: [.34, .26, .04, 0, .42, -.15], back: [.38, .25, .15, 0, .36, .25] }),
    phantom: signature({ crest: [.34, .05, .28, 0, .46, .02], temples: [.04, .24, .24, .27, .20, 0], chest: [.12, .26, .03, 0, .42, -.145], back: [.16, .20, .07, 0, .39, .19] }),
    hardy: signature({ crest: [.28, .13, .24, 0, .50, 0], chest: [.38, .24, .04, 0, .42, -.15], back: [.38, .22, .15, 0, .36, .24] }),
    swift: signature({ crest: [.20, .11, .22, -.09, .49, 0], chest: [.12, .20, .03, -.10, .44, -.145], back: [.18, .16, .07, 0, .40, .19] })
});

// Premium skins add a recognisable costume layer over whichever gameplay hero
// is selected. This is intentionally small geometry, not a second rig/model.
const SKIN_SIGNATURES = Object.freeze({
    neon: signature({ crest: [.13, .28, .15, .09, .56, 0, 0, 0, -.18], chest: [.08, .34, .025, .10, .42, -.155, 0, 0, -.28], back: [.20, .30, .10, 0, .39, .22] }),
    samurai: signature({ crest: [.44, .09, .32, 0, .50, 0], temples: [.09, .30, .28, .30, .20, 0], chest: [.44, .32, .05, 0, .43, -.15], back: [.34, .32, .14, 0, .37, .24] }),
    frost: signature({ crest: [.30, .16, .22, 0, .51, 0], temples: [.05, .14, .22, .27, .23, 0], chest: [.30, .24, .03, 0, .44, -.15] }),
    astro: signature({ crest: [.40, .08, .34, 0, .48, 0], temples: [.08, .30, .28, .29, .20, 0], chest: [.34, .22, .04, 0, .43, -.15], back: [.38, .36, .17, 0, .38, .25] }),
    arcade: signature({ crest: [.30, .07, .28, -.07, .47, 0], chest: [.22, .20, .03, 0, .44, -.15], back: [.22, .20, .10, 0, .40, .21] }),
    moss: signature({ crest: [.28, .15, .25, -.05, .51, 0], temples: [.06, .12, .20, .27, .24, 0], chest: [.32, .20, .04, 0, .44, -.15], back: [.36, .28, .16, 0, .38, .24] }),
    striker: signature({ crest: [.10, .23, .17, 0, .55, 0], chest: [.10, .28, .03, 0, .43, -.15], back: [.20, .24, .09, 0, .40, .21] }),
    void: signature({ crest: [.38, .06, .30, 0, .47, 0], temples: [.05, .26, .25, .28, .20, 0], chest: [.18, .26, .03, 0, .43, -.15], back: [.24, .30, .10, 0, .38, .21] }),
    royal: signature({ crest: [.32, .17, .24, 0, .52, 0], temples: [.05, .12, .22, .27, .24, 0], chest: [.38, .26, .04, 0, .43, -.15], back: [.38, .22, .14, 0, .38, .23] }),
    circuit: signature({ crest: [.18, .14, .20, .08, .51, 0], chest: [.08, .30, .03, -.10, .42, -.15], back: [.25, .30, .11, 0, .38, .22] }),
    creeper_knight: signature({ crest: [.38, .09, .30, 0, .49, 0], temples: [.07, .22, .26, .28, .20, 0], chest: [.38, .28, .04, 0, .43, -.15] }),
    ender_mage: signature({ crest: [.40, .06, .32, 0, .47, 0], temples: [.05, .29, .27, .28, .19, 0], chest: [.14, .30, .03, 0, .42, -.15], back: [.24, .34, .10, 0, .38, .22] }),
    magma_guard: signature({ crest: [.28, .20, .20, 0, .55, 0], temples: [.06, .18, .23, .27, .22, 0], chest: [.36, .26, .04, 0, .43, -.15], back: [.34, .25, .14, 0, .38, .24] }),
    bee_runner: signature({ crest: [.28, .08, .22, 0, .48, 0], chest: [.38, .12, .03, 0, .46, -.15], back: [.32, .26, .14, 0, .39, .24] }),
    axolotl_scout: signature({ crest: [.24, .08, .22, 0, .48, 0], temples: [.09, .26, .10, .30, .20, 0], chest: [.22, .20, .03, 0, .44, -.15], back: [.18, .20, .08, 0, .40, .20] }),
    ghost_keeper: signature({ crest: [.40, .06, .32, 0, .47, 0], temples: [.05, .28, .27, .28, .20, 0], chest: [.30, .24, .035, 0, .43, -.15] }),
    infernal_smile: signature({ crest: [.28, .22, .20, 0, .56, 0], temples: [.06, .18, .23, .27, .22, 0], chest: [.30, .24, .04, 0, .43, -.15], back: [.28, .26, .12, 0, .38, .23] }),
    galaxy_idol: signature({ crest: [.34, .14, .24, 0, .51, 0], temples: [.05, .12, .22, .27, .24, 0], chest: [.24, .24, .03, 0, .43, -.15], back: [.28, .22, .11, 0, .39, .22] })
});
// --- Canonical Minecraft-compatible geometry --------------------------------
// 32 vertical pixels map to exactly 2 world units. Every core dimension derives
// from this one unit so classic/slim skins keep the original 64x64 atlas ratios.
export const VOXEL_UNIT = 1 / 16;
export const TOTAL_BODY_HEIGHT = 32 * VOXEL_UNIT;
export const HEAD_SIZE = 8 * VOXEL_UNIT;
export const HEAD_HALF_DEPTH = HEAD_SIZE / 2;
// The long-lived head pivot remains .80 above hips for socket/API compatibility;
// its mesh is offset .20 so the cube still touches the torso at exactly y=1.50.
export const HEAD_MESH_LOCAL_Y = 0.20;
export const HEAD_MESH_LOCAL_Z_FRONT = -HEAD_HALF_DEPTH;  // local -Z is front face plane
export const FACE_DECAL_DEPTH = 0.01;

// Kept as zero-valued compatibility exports; the exact silhouette has no neck mesh.
export const NECK_WIDTH = 0;
export const NECK_HEIGHT = 0;
export const NECK_DEPTH = 0;
export const NECK_HALF_HEIGHT = 0;
export const NECK_MESH_LOCAL_Y = 12 * VOXEL_UNIT;

export const TORSO_WIDTH = 8 * VOXEL_UNIT;
export const TORSO_HEIGHT = 12 * VOXEL_UNIT;
export const TORSO_DEPTH = 4 * VOXEL_UNIT;
export const TORSO_HALF_HEIGHT = TORSO_HEIGHT / 2;
export const TORSO_MESH_LOCAL_Y = TORSO_HALF_HEIGHT;
export const CLASSIC_ARM_WIDTH = 4 * VOXEL_UNIT;
export const SLIM_ARM_WIDTH = 3 * VOXEL_UNIT;
export const ARM_HEIGHT = 12 * VOXEL_UNIT;
export const ARM_DEPTH = 4 * VOXEL_UNIT;
export const LEG_WIDTH = 4 * VOXEL_UNIT;
export const LEG_HEIGHT = 12 * VOXEL_UNIT;
export const LEG_DEPTH = 4 * VOXEL_UNIT;
export const LIMB_SEGMENT_HEIGHT = 6 * VOXEL_UNIT;

// Visor (thin bar on head front plane, straddles it half-embedded/half-proud)
export const VISOR_WIDTH = 0.22;
export const VISOR_HEIGHT = 0.05;
export const VISOR_DEPTH = 0.04;
export const VISOR_MESH_LOCAL_Y = HEAD_MESH_LOCAL_Y;
export const VISOR_MESH_LOCAL_Z = -HEAD_HALF_DEPTH;  // derives from head front plane

// Rig skeleton: joints positioned relative to their parents (for cosmetics to compute socket world positions)
export const HIPS_WORLD_Y = LEG_HEIGHT;
export const HEAD_SOCKET_LOCAL_Y = 0.45;
export const FACE_SOCKET_LOCAL_Y = HEAD_MESH_LOCAL_Y;
export const FACE_SOCKET_LOCAL_Z = -(HEAD_HALF_DEPTH + 0.02);
export const HAND_SOCKET_LOCAL_Y = -LIMB_SEGMENT_HEIGHT;
export const FOOT_SOCKET_LOCAL_Y = -LIMB_SEGMENT_HEIGHT;

const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function disposeMaterial(material) {
    if (!material) return;
    for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose?.();
    }
    material.dispose?.();
}

function setMaterialColor(material, hex) {
    if (!material) return;
    const uColor = material.uniforms?.uColor?.value;
    if (uColor?.setHex) { uColor.setHex(hex); return; }
    material.color?.setHex?.(hex);
}

// BoxGeometry writes its six faces in +X, -X, +Y, -Y, +Z, -Z order. Scale its
// existing UV orientation into the matching Minecraft atlas rectangle instead
// of recreating geometry, keeping the established joints and sockets intact.
function mapBoxGeometryToAtlas(geometry, box, verticalStart = 0, verticalHeight = box?.height) {
    const uv = geometry?.getAttribute?.('uv') || geometry?.attributes?.uv;
    if (!uv?.getX || !uv?.getY || !uv?.setXY || !box?.faces) return;
    const userData = geometry.userData || (geometry.userData = {});
    const base = userData.avatarAtlasBaseUv || (userData.avatarAtlasBaseUv = Array.from(
        { length: uv.count }, (_, index) => [uv.getX(index), uv.getY(index)]
    ));
    const cropSide = face => ({
        ...face,
        y: face.y + verticalStart,
        height: Math.min(face.height - verticalStart, verticalHeight)
    });
    const faces = [
        cropSide(box.faces.right), cropSide(box.faces.left), box.faces.top,
        box.faces.bottom, cropSide(box.faces.back), cropSide(box.faces.front)
    ];
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        const face = faces[faceIndex];
        const u0 = face.x / ATLAS_SIZE;
        const v0 = 1 - (face.y + face.height) / ATLAS_SIZE;
        const uScale = face.width / ATLAS_SIZE;
        const vScale = face.height / ATLAS_SIZE;
        const start = faceIndex * 4;
        for (let vertex = 0; vertex < 4; vertex++) {
            const index = start + vertex;
            uv.setXY(index, u0 + base[index][0] * uScale, v0 + base[index][1] * vScale);
        }
    }
    uv.needsUpdate = true;
}

function pivot(name, parent, x = 0, y = 0, z = 0) {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(x, y, z);
    parent.add(object);
    return object;
}

/**
 * @param {object} options { characterId, skinId, team, materialFactory, outlineFactory, castShadow }
 * @returns RigHandle
 */
export function createCharacterRig(options = {}) {
    const state = {
        ...normalizeShowcaseState({ characterId: options.characterId, skinId: options.skinId }),
        team: TEAM_COLORS[options.team] ? options.team : 'red'
    };
    const materialFactory = typeof options.materialFactory === 'function' ? options.materialFactory : null;
    const outlineFactory = typeof options.outlineFactory === 'function' ? options.outlineFactory : null;
    const castShadow = options.castShadow !== false;

    const buildMaterial = hex => (materialFactory
        ? materialFactory(hex)
        : new THREE.MeshStandardMaterial({ color: hex, roughness: .58, metalness: .08 }));

    const initialPalette = getShowcaseMaterialPalette(state);
    const materials = {};
    for (const slot of MATERIAL_SLOTS) materials[slot] = buildMaterial(initialPalette[slot]);
    // Not a palette slot (MATERIAL_SLOTS drives applyPalette): stays white so the avatar face
    // texture renders unmodulated. Lives in `materials` purely so dispose()'s Object.values sweep
    // frees it and its map along with the rest -- no parallel bookkeeping to forget.
    materials.face = buildMaterial(0xffffff);
    const teamMaterials = [materials.body, materials.arms];

    const geometries = new Set();
    const outlineMaterials = new Set();

    const root = new THREE.Group();
    root.name = 'character-rig';

    // --- skeleton (pivots at the joint; meshes offset below/above the pivot) ---
    const joints = {};
    joints.hips = pivot('hips', root, 0, HIPS_WORLD_Y, 0);
    joints.torso = pivot('torso', joints.hips, 0, 0, 0);
    joints.head = pivot('head', joints.torso, 0, 0.80, 0);
    const classicShoulderX = TORSO_WIDTH / 2 + CLASSIC_ARM_WIDTH / 2;
    joints.shoulderL = pivot('shoulderL', joints.torso, -classicShoulderX, TORSO_HEIGHT, 0);
    joints.elbowL = pivot('elbowL', joints.shoulderL, 0, -LIMB_SEGMENT_HEIGHT, 0);
    joints.shoulderR = pivot('shoulderR', joints.torso, classicShoulderX, TORSO_HEIGHT, 0);
    joints.elbowR = pivot('elbowR', joints.shoulderR, 0, -LIMB_SEGMENT_HEIGHT, 0);
    joints.hipL = pivot('hipL', joints.hips, -LEG_WIDTH / 2, 0, 0);
    joints.kneeL = pivot('kneeL', joints.hipL, 0, -LIMB_SEGMENT_HEIGHT, 0);
    joints.hipR = pivot('hipR', joints.hips, LEG_WIDTH / 2, 0, 0);
    joints.kneeR = pivot('kneeR', joints.hipR, 0, -LIMB_SEGMENT_HEIGHT, 0);

    // ponytail: kaymayı önlemek için isimlerin character-pose.js JOINTS ile birebir eşleştiğini doğrula.
    for (const name of JOINTS) {
        if (!joints[name]) throw new Error(`character-rig: missing joint "${name}"`);
    }

    // --- sockets (empty anchors for cosmetics, no geometry) ---
    const sockets = {};
    sockets.head = pivot('socket:head', joints.head, 0, HEAD_SOCKET_LOCAL_Y, 0);
    sockets.face = pivot('socket:face', joints.head, 0, FACE_SOCKET_LOCAL_Y, FACE_SOCKET_LOCAL_Z);
    sockets.back = pivot('socket:back', joints.torso, 0, TORSO_HALF_HEIGHT, TORSO_DEPTH / 2 + .02);
    sockets.chest = pivot('socket:chest', joints.torso, 0, TORSO_HALF_HEIGHT, -(TORSO_DEPTH / 2 + .02));
    sockets.waist = pivot('socket:waist', joints.hips, 0, 0, 0);
    sockets.handL = pivot('socket:handL', joints.elbowL, 0, HAND_SOCKET_LOCAL_Y, 0);
    sockets.handR = pivot('socket:handR', joints.elbowR, 0, HAND_SOCKET_LOCAL_Y, 0);
    sockets.footL = pivot('socket:footL', joints.kneeL, 0, FOOT_SOCKET_LOCAL_Y, 0);
    sockets.footR = pivot('socket:footR', joints.kneeR, 0, FOOT_SOCKET_LOCAL_Y, 0);
    sockets.aura = pivot('socket:aura', root, 0, TOTAL_BODY_HEIGHT / 2, 0);
    sockets.trail = pivot('socket:trail', root, 0, 0.1, 0);

    for (const name of RIG_SOCKETS) {
        if (!sockets[name]) throw new Error(`character-rig: missing socket "${name}"`);
    }

    // --- meshes ---
    const armMeshes = [];

    function addPart(parent, { name, geometry, position, material, outline = true }) {
        geometries.add(geometry);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.position.set(...position);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = castShadow;
        parent.add(mesh);
        if (outline && outlineFactory) {
            const outlineMesh = outlineFactory(geometry);
            outlineMesh.position.copy(mesh.position);
            mesh.userData.outlineMesh = outlineMesh;
            outlineMaterials.add(outlineMesh.material);
            parent.add(outlineMesh);
        }
        return mesh;
    }

    const torsoMesh = addPart(joints.torso, {
        name: 'torso-mesh', geometry: new THREE.BoxGeometry(TORSO_WIDTH, TORSO_HEIGHT, TORSO_DEPTH),
        position: [0, TORSO_MESH_LOCAL_Y, 0], material: materials.body
    });
    const headMesh = addPart(joints.head, {
        name: 'head-mesh', geometry: new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE),
        position: [0, HEAD_MESH_LOCAL_Y, 0], material: materials.head
    });

    const upperArmL = addPart(joints.shoulderL, {
        name: 'upper-arm-L', geometry: new THREE.BoxGeometry(CLASSIC_ARM_WIDTH, LIMB_SEGMENT_HEIGHT, ARM_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.arms
    });
    const forearmL = addPart(joints.elbowL, {
        name: 'forearm-L', geometry: new THREE.BoxGeometry(CLASSIC_ARM_WIDTH, LIMB_SEGMENT_HEIGHT, ARM_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.arms
    });
    const upperArmR = addPart(joints.shoulderR, {
        name: 'upper-arm-R', geometry: new THREE.BoxGeometry(CLASSIC_ARM_WIDTH, LIMB_SEGMENT_HEIGHT, ARM_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.arms
    });
    const forearmR = addPart(joints.elbowR, {
        name: 'forearm-R', geometry: new THREE.BoxGeometry(CLASSIC_ARM_WIDTH, LIMB_SEGMENT_HEIGHT, ARM_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.arms
    });
    armMeshes.push(upperArmL, forearmL, upperArmR, forearmR);

    const thighL = addPart(joints.hipL, {
        name: 'thigh-L', geometry: new THREE.BoxGeometry(LEG_WIDTH, LIMB_SEGMENT_HEIGHT, LEG_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.legs
    });
    const calfL = addPart(joints.kneeL, {
        name: 'calf-L', geometry: new THREE.BoxGeometry(LEG_WIDTH, LIMB_SEGMENT_HEIGHT, LEG_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.legs
    });
    const thighR = addPart(joints.hipR, {
        name: 'thigh-R', geometry: new THREE.BoxGeometry(LEG_WIDTH, LIMB_SEGMENT_HEIGHT, LEG_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.legs
    });
    const calfR = addPart(joints.kneeR, {
        name: 'calf-R', geometry: new THREE.BoxGeometry(LEG_WIDTH, LIMB_SEGMENT_HEIGHT, LEG_DEPTH),
        position: [0, -LIMB_SEGMENT_HEIGHT / 2, 0], material: materials.legs
    });

    // trim — gives the accent/detail/visor palette slots somewhere to live
    const shoulderPadL = addPart(joints.shoulderL, {
        name: 'pad-L', geometry: new THREE.BoxGeometry(.26, .14, .26),
        position: [0, 0, 0], material: materials.accent, outline: false
    });
    const shoulderPadR = addPart(joints.shoulderR, {
        name: 'pad-R', geometry: new THREE.BoxGeometry(.26, .14, .26),
        position: [0, 0, 0], material: materials.accent, outline: false
    });
    const beltMesh = addPart(joints.hips, {
        name: 'belt', geometry: new THREE.BoxGeometry(.5, .12, .3),
        position: [0, .02, 0], material: materials.detail, outline: false
    });
    // Front of the character is -Z. The visor's center sits exactly on the cube's front plane so
    // it straddles it (half embedded, half proud), derived from HEAD_HALF_DEPTH so it tracks any
    // future head resize instead of drifting inside/off the face like the sphere-era -.19 would.
    const visorMesh = addPart(joints.head, {
        name: 'visor', geometry: new THREE.BoxGeometry(.28, .025, .025),
        position: [0, HEAD_MESH_LOCAL_Y + .12, -HEAD_HALF_DEPTH], material: materials.accent, outline: false
    });
    // Default skins need a readable face at Shop distance too. These are direct
    // head children: the live renderer's visible scene now has no Mesh-parent
    // dependency, while the existing visor remains intact for compatibility.
    const facePlate = addPart(joints.head, {
        name: 'face-plate', geometry: new THREE.BoxGeometry(.34, .27, .018),
        position: [0, HEAD_MESH_LOCAL_Y - .015, -(HEAD_HALF_DEPTH + .016)], material: materials.head, outline: false
    });
    const leftEye = addPart(joints.head, {
        name: 'eye-L', geometry: new THREE.BoxGeometry(.055, .052, .016),
        position: [-.075, HEAD_MESH_LOCAL_Y + .025, -(HEAD_HALF_DEPTH + .030)], material: materials.visor, outline: false
    });
    const rightEye = addPart(joints.head, {
        name: 'eye-R', geometry: new THREE.BoxGeometry(.055, .052, .016),
        position: [.075, HEAD_MESH_LOCAL_Y + .025, -(HEAD_HALF_DEPTH + .030)], material: materials.visor, outline: false
    });
    const leftBrow = addPart(joints.head, {
        name: 'brow-L', geometry: new THREE.BoxGeometry(.07, .014, .014),
        position: [-.075, HEAD_MESH_LOCAL_Y + .073, -(HEAD_HALF_DEPTH + .031)], material: materials.detail, outline: false
    });
    const rightBrow = addPart(joints.head, {
        name: 'brow-R', geometry: new THREE.BoxGeometry(.07, .014, .014),
        position: [.075, HEAD_MESH_LOCAL_Y + .073, -(HEAD_HALF_DEPTH + .031)], material: materials.detail, outline: false
    });
    const mouthMesh = addPart(joints.head, {
        name: 'mouth', geometry: new THREE.BoxGeometry(.11, .018, .014),
        position: [0, HEAD_MESH_LOCAL_Y - .070, -(HEAD_HALF_DEPTH + .031)], material: materials.detail, outline: false
    });
    const proceduralFaceParts = [visorMesh, facePlate, leftEye, rightEye, leftBrow, rightBrow, mouthMesh];

    function setProceduralFaceVisible(visible) {
        for (const part of proceduralFaceParts) part.visible = visible;
    }
    // A painted avatar face covers the whole front plane, so it replaces the visor rather than
    // layering over it -- setHeadTexture swaps which of the two is visible.
    const faceMesh = addPart(joints.head, {
        name: 'face-mesh', geometry: new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, FACE_DECAL_DEPTH),
        position: [0, HEAD_MESH_LOCAL_Y, -(HEAD_HALF_DEPTH + FACE_DECAL_DEPTH / 2)],
        material: materials.face, outline: false
    });
    faceMesh.visible = false;
    // Distinct blocky silhouettes; configured in applyShape() and never touched
    // by the animation update, so hero identity has no per-frame cost.
    const signatureCrest = addPart(joints.head, {
        name: 'signature-crest', geometry: new THREE.BoxGeometry(1, 1, 1),
        position: [0, .40, 0], material: materials.accent, outline: false
    });
    const signatureBack = addPart(joints.torso, {
        name: 'signature-back', geometry: new THREE.BoxGeometry(1, 1, 1),
        position: [0, .38, .24], material: materials.detail, outline: false
    });
    const signatureTempleL = addPart(joints.head, {
        name: 'signature-temple-L', geometry: new THREE.BoxGeometry(1, 1, 1),
        position: [-.28, .20, 0], material: materials.accent, outline: false
    });
    const signatureTempleR = addPart(joints.head, {
        name: 'signature-temple-R', geometry: new THREE.BoxGeometry(1, 1, 1),
        position: [.28, .20, 0], material: materials.accent, outline: false
    });
    const signatureChest = addPart(joints.torso, {
        name: 'signature-chest', geometry: new THREE.BoxGeometry(1, 1, 1),
        position: [0, .42, -.15], material: materials.accent, outline: false
    });

    // --- palette / proportions ---
    const PART_SLOTS = ['body', 'arms', 'legs'];
    // ponytail: avatar part colors (setPartColors) win over palette/team recolor
    // while active -- setSkin/setCharacter/setTeam still update state so the right
    // color comes back once setPartColors(null) releases the latch.
    let avatarColorsActive = false;
    let avatarAtlasActive = false;
    let avatarAtlasTexture = null;
    let avatarModelId = null;

    function applySignature() {
        const heroSignature = CHARACTER_SIGNATURES[state.characterId] || CHARACTER_SIGNATURES.rally;
        const skinSignature = SKIN_SIGNATURES[state.skinId];
        const valuesFor = key => skinSignature?.[key] || heroSignature?.[key];
        const place = (mesh, values) => {
            mesh.visible = Array.isArray(values);
            if (!Array.isArray(values)) return;
            mesh.scale.set(values[0], values[1], values[2]);
            mesh.position.set(values[3], values[4], values[5]);
            mesh.rotation.set(values[6] || 0, values[7] || 0, values[8] || 0);
        };
        place(signatureCrest, valuesFor('crest'));
        place(signatureBack, valuesFor('back'));
        place(signatureChest, valuesFor('chest'));
        const temples = valuesFor('temples');
        if (Array.isArray(temples)) {
            place(signatureTempleL, temples);
            place(signatureTempleR, temples);
            signatureTempleL.position.x = -Math.abs(temples[3]);
            signatureTempleR.position.x = Math.abs(temples[3]);
        } else {
            signatureTempleL.visible = false;
            signatureTempleR.visible = false;
        }

        // Armor-heavy identities get readable shoulder mass; agile identities
        // retain the canonical slim block silhouette. This is static mutation.
        const armored = Boolean(temples || valuesFor('chest')?.[0] >= .34);
        const padScale = armored ? 1.12 : .82;
        shoulderPadL.scale.set(padScale, armored ? 1.08 : .72, padScale);
        shoulderPadR.scale.set(padScale, armored ? 1.08 : .72, padScale);
        beltMesh.scale.y = armored ? 1.08 : .78;
    }

    function applyPalette() {
        const palette = getShowcaseMaterialPalette(state);
        for (const slot of MATERIAL_SLOTS) {
            if ((avatarColorsActive || avatarAtlasActive) && PART_SLOTS.includes(slot)) continue;
            if (avatarAtlasActive && slot === 'head') continue;
            setMaterialColor(materials[slot], palette[slot]);
        }
        return palette;
    }

    function applyShape() {
        const shape = getShowcaseCharacterShape(state.characterId);
        // Character size may vary, but Minecraft proportions never stretch on
        // individual axes. Gear/signatures carry the remaining hero identity.
        const uniformScale = Number.isFinite(shape.width) ? shape.width : 1;
        root.scale.set(uniformScale, uniformScale, uniformScale);
        // Derived from the avatar atlas (slim arm 3px vs classic 4px = .75) so a 'slim' pick
        // narrows the in-game arms by exactly what the avatar preview draws -- the old hardcoded
        // .82 rendered arms thicker than the avatar advertised.
        const armWidth = getAvatarArmScale(avatarModelId || AVATAR_SKINS[state.skinId]?.model);
        const shoulderX = TORSO_WIDTH / 2 + CLASSIC_ARM_WIDTH * armWidth / 2;
        joints.shoulderL.position.x = -shoulderX;
        joints.shoulderR.position.x = shoulderX;
        for (const mesh of armMeshes) {
            mesh.scale.x = armWidth;
            if (mesh.userData.outlineMesh) mesh.userData.outlineMesh.scale.x = armWidth;
        }
        applySignature();
    }

    function applyTeam() {
        const hex = TEAM_COLORS[state.team] || TEAM_COLORS.red;
        if (!avatarAtlasActive) {
            for (const material of teamMaterials) setMaterialColor(material, hex);
        }
    }

    applyShape();
    applyTeam();

    // --- public API ---
    let disposed = false;

    function applyPose(pose) {
        if (!pose) return;
        root.position.y = num(pose.offsetY);
        for (const name of JOINTS) {
            const joint = joints[name];
            const angles = pose[name];
            if (!joint || !angles) continue;
            joint.rotation.x = num(angles.x);
            joint.rotation.y = num(angles.y);
            joint.rotation.z = num(angles.z);
        }
        joints.hips.rotation.z = num(pose.lean);
    }

    function setSkin(skinId) {
        state.skinId = normalizeShowcaseState({ ...state, skinId }).skinId;
        applyPalette();
        applyShape();
        return state.skinId;
    }

    function setCharacter(characterId) {
        state.characterId = normalizeShowcaseState({ ...state, characterId }).characterId;
        applyPalette();
        applyShape();
        return state.characterId;
    }

    function setTeam(team) {
        state.team = TEAM_COLORS[team] ? team : 'red';
        if (!avatarColorsActive) applyTeam();
        return state.team;
    }

    function applyPartPalette() {
        const palette = getShowcaseMaterialPalette(state);
        for (const slot of PART_SLOTS) setMaterialColor(materials[slot], palette[slot]);
    }

    // Per-part override for custom-painted avatars (js/avatar.js sampling). Pass
    // hex numbers for the slots to recolor; pass null/undefined to release the
    // latch and fall back to the skin palette (legs) / team color (body, arms).
    function setPartColors(colors) {
        if (avatarAtlasActive) return;
        if (!colors) {
            avatarColorsActive = false;
            applyPartPalette();
            applyTeam();
            return;
        }
        avatarColorsActive = true;
        for (const slot of PART_SLOTS) {
            if (typeof colors[slot] === 'number') setMaterialColor(materials[slot], colors[slot]);
        }
    }

    function setVisible(visible) {
        root.visible = Boolean(visible);
    }

    // ponytail: the texture (game.js _avatarFace = HEAD_FRONT's 8x8 crop) goes on the face decal,
    // not the shared "head" slot -- one material on a cube tiles that crop onto all 6 faces, which
    // puts a face on the back of the head. The cube keeps its palette head color, which already is
    // the avatar skin's head hex (shop-showcase getShowcaseMaterialPalette), so the result is a
    // skin-toned blocky head wearing the player's painted face. Works for the default
    // MeshStandardMaterial (supports .map); avatar textures aren't used together with a toon
    // materialFactory anywhere today, so no shader branch needed. Texture disposal still falls out
    // of the existing dispose() pass (materials.face is in the Object.values scan).
    function setHeadTexture(texture) {
        if (avatarAtlasActive) setAvatarAtlasTexture(null);
        const face = materials.face;
        if (!face) return;
        if (face.map && face.map !== texture) face.map.dispose?.();
        face.map = texture || null;
        face.needsUpdate = true;
        faceMesh.visible = Boolean(texture);
        setProceduralFaceVisible(!texture);
    }

    // Takes ownership of one shared 64x64 atlas texture. Each skinnable box has
    // static UVs into that atlas, so a custom skin shows on head, torso, both
    // arms and both legs without any rendering-loop allocations.
    function setAvatarAtlasTexture(texture, modelId = 'classic') {
        if (texture && materials.face?.map) {
            materials.face.map.dispose?.();
            materials.face.map = null;
            materials.face.needsUpdate = true;
        }
        if (avatarAtlasTexture && avatarAtlasTexture !== texture) avatarAtlasTexture.dispose?.();
        avatarAtlasTexture = texture || null;
        avatarAtlasActive = Boolean(texture);
        avatarModelId = avatarAtlasActive ? (modelId === 'slim' ? 'slim' : 'classic') : null;
        const maps = [materials.head, materials.body, materials.arms, materials.legs];
        for (const material of maps) {
            if (!material) continue;
            material.map = avatarAtlasTexture;
            material.needsUpdate = true;
            if (avatarAtlasActive) setMaterialColor(material, 0xffffff);
        }
        const boxes = getAvatarAtlasBoxes(avatarModelId || AVATAR_SKINS[state.skinId]?.model);
        if (avatarAtlasActive) {
            mapBoxGeometryToAtlas(headMesh.geometry, boxes.head);
            mapBoxGeometryToAtlas(torsoMesh.geometry, boxes.body);
            mapBoxGeometryToAtlas(upperArmL.geometry, boxes.leftArm, 0, 6);
            mapBoxGeometryToAtlas(forearmL.geometry, boxes.leftArm, 6, 6);
            mapBoxGeometryToAtlas(upperArmR.geometry, boxes.rightArm, 0, 6);
            mapBoxGeometryToAtlas(forearmR.geometry, boxes.rightArm, 6, 6);
            mapBoxGeometryToAtlas(thighL.geometry, boxes.leftLeg, 0, 6);
            mapBoxGeometryToAtlas(calfL.geometry, boxes.leftLeg, 6, 6);
            mapBoxGeometryToAtlas(thighR.geometry, boxes.rightLeg, 0, 6);
            mapBoxGeometryToAtlas(calfR.geometry, boxes.rightLeg, 6, 6);
        }
        faceMesh.visible = false;
        setProceduralFaceVisible(!avatarAtlasActive);
        if (!avatarAtlasActive) {
            applyPalette();
            applyTeam();
        }
        applyShape();
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        avatarAtlasTexture = null;
        for (const geometry of geometries) geometry.dispose?.();
        const allMaterials = new Set([...Object.values(materials), ...outlineMaterials]);
        const disposedTextures = new Set();
        for (const material of allMaterials) {
            for (const value of Object.values(material || {})) {
                if (value?.isTexture && !disposedTextures.has(value)) {
                    disposedTextures.add(value);
                    value.dispose?.();
                }
            }
            material?.dispose?.();
        }
        root.removeFromParent?.();
        root.clear?.();
    }

    const handle = {
        root, joints, sockets,
        applyPose, setSkin, setCharacter, setTeam, setVisible,
        setHeadTexture, setAvatarAtlasTexture, setPartColors, dispose
    };
    Object.defineProperty(handle, 'state', {
        enumerable: true,
        get: () => Object.freeze({ ...state })
    });
    return handle;
}
