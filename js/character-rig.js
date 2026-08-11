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
const SHOULDER_X = 0.44;
const ATLAS_SIZE = 64;
// Small, socket-safe silhouette signatures make each selectable hero legible from
// range without replacing the shared animation skeleton or adding per-frame work.
const CHARACTER_SIGNATURES = Object.freeze({
    rally: Object.freeze({ crest: [.18, .06, .08, 0, .40, 0], back: [.24, .16, .10, 0, .38, .24] }),
    tank: Object.freeze({ crest: [.30, .08, .12, 0, .40, 0], back: [.42, .28, .16, 0, .34, .28] }),
    scout: Object.freeze({ crest: [.12, .15, .08, -.12, .38, 0], back: [.16, .12, .08, 0, .42, .22] }),
    sniper: Object.freeze({ crest: [.08, .18, .08, .10, .40, 0], back: [.18, .30, .10, 0, .38, .24] }),
    guardian: Object.freeze({ crest: [.34, .05, .12, 0, .40, 0], back: [.36, .18, .16, 0, .36, .26] }),
    blazer: Object.freeze({ crest: [.16, .20, .10, 0, .44, 0], back: [.22, .22, .10, 0, .40, .24] }),
    frost: Object.freeze({ crest: [.28, .12, .08, 0, .43, 0], back: [.28, .20, .12, 0, .38, .24] }),
    volt: Object.freeze({ crest: [.18, .13, .10, .08, .42, 0], back: [.20, .26, .10, 0, .39, .24] }),
    nova: Object.freeze({ crest: [.24, .10, .14, 0, .43, 0], back: [.30, .18, .12, 0, .38, .26] }),
    ripple: Object.freeze({ crest: [.30, .06, .14, 0, .41, 0], back: [.34, .13, .14, 0, .36, .26] }),
    soldier: Object.freeze({ crest: [.22, .07, .12, 0, .41, 0], back: [.32, .30, .15, 0, .34, .27] }),
    anchor: Object.freeze({ crest: [.32, .09, .12, 0, .42, 0], back: [.38, .25, .16, 0, .34, .28] }),
    phantom: Object.freeze({ crest: [.10, .24, .06, 0, .44, 0], back: [.16, .20, .08, 0, .39, .24] }),
    hardy: Object.freeze({ crest: [.26, .12, .14, 0, .42, 0], back: [.38, .22, .16, 0, .36, .27] }),
    swift: Object.freeze({ crest: [.14, .16, .08, -.08, .42, 0], back: [.18, .16, .08, 0, .40, .23] })
});
// --- Canonical geometry constants (one definition per surface, consumed by rig and exported for cosmetics) ---
// Head cube (Minecraft-style; .44 reads as a deliberate block head against the
// .62 torso instead of the prior tiny-head mannequin silhouette).
export const HEAD_SIZE = 0.44;
export const HEAD_HALF_DEPTH = HEAD_SIZE / 2; // .22
export const HEAD_MESH_LOCAL_Y = 0.20;  // offset on joints.head
export const HEAD_MESH_LOCAL_Z_FRONT = -HEAD_HALF_DEPTH;  // local -Z is front face plane
export const FACE_DECAL_DEPTH = 0.01;

// Neck box (bridges torso top to head bottom; height raised .16->.20 to close gap)
export const NECK_WIDTH = 0.26;
export const NECK_HEIGHT = 0.20;
export const NECK_DEPTH = 0.26;
export const NECK_HALF_HEIGHT = NECK_HEIGHT / 2;  // .10
export const NECK_MESH_LOCAL_Y = 0.76;  // offset on joints.torso

// Torso box (body proportions, unchanged)
export const TORSO_WIDTH = 0.62;
export const TORSO_HEIGHT = 0.68;
export const TORSO_DEPTH = 0.36;
export const TORSO_HALF_HEIGHT = TORSO_HEIGHT / 2;  // .34
export const TORSO_MESH_LOCAL_Y = 0.34;  // offset on joints.torso

// Visor (thin bar on head front plane, straddles it half-embedded/half-proud)
export const VISOR_WIDTH = 0.22;
export const VISOR_HEIGHT = 0.05;
export const VISOR_DEPTH = 0.04;
export const VISOR_MESH_LOCAL_Y = 0.20;  // same as head center, on joints.head
export const VISOR_MESH_LOCAL_Z = -HEAD_HALF_DEPTH;  // derives from head front plane

// Rig skeleton: joints positioned relative to their parents (for cosmetics to compute socket world positions)
export const HIPS_WORLD_Y = 0.94;
export const HEAD_SOCKET_LOCAL_Y = 0.42;  // offset on joints.head (world: 2.16)
export const FACE_SOCKET_LOCAL_Y = 0;     // offset on joints.head (world: 1.74)
export const FACE_SOCKET_LOCAL_Z = -0.24;  // offset on joints.head
export const HAND_SOCKET_LOCAL_Y = -0.46; // offset on elbow joints (world: ~0.66)
export const FOOT_SOCKET_LOCAL_Y = -0.46; // offset on knee joints (world: ~0)

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
    joints.hips = pivot('hips', root, 0, 0.94, 0);
    joints.torso = pivot('torso', joints.hips, 0, 0, 0);
    joints.head = pivot('head', joints.torso, 0, 0.80, 0);
    joints.shoulderL = pivot('shoulderL', joints.torso, -SHOULDER_X, 0.60, 0);
    joints.elbowL = pivot('elbowL', joints.shoulderL, 0, -0.46, 0);
    joints.shoulderR = pivot('shoulderR', joints.torso, SHOULDER_X, 0.60, 0);
    joints.elbowR = pivot('elbowR', joints.shoulderR, 0, -0.46, 0);
    joints.hipL = pivot('hipL', joints.hips, -0.19, 0, 0);
    joints.kneeL = pivot('kneeL', joints.hipL, 0, -0.48, 0);
    joints.hipR = pivot('hipR', joints.hips, 0.19, 0, 0);
    joints.kneeR = pivot('kneeR', joints.hipR, 0, -0.48, 0);

    // ponytail: kaymayı önlemek için isimlerin character-pose.js JOINTS ile birebir eşleştiğini doğrula.
    for (const name of JOINTS) {
        if (!joints[name]) throw new Error(`character-rig: missing joint "${name}"`);
    }

    // --- sockets (empty anchors for cosmetics, no geometry) ---
    const sockets = {};
    sockets.head = pivot('socket:head', joints.head, 0, 0.42, 0);
    sockets.face = pivot('socket:face', joints.head, 0, 0, -0.24);
    sockets.back = pivot('socket:back', joints.torso, 0, 0.34, 0.24);
    sockets.chest = pivot('socket:chest', joints.torso, 0, 0.36, -0.26);
    sockets.waist = pivot('socket:waist', joints.hips, 0, 0.02, 0);
    sockets.handL = pivot('socket:handL', joints.elbowL, 0, -0.46, 0);
    sockets.handR = pivot('socket:handR', joints.elbowR, 0, -0.46, 0);
    sockets.footL = pivot('socket:footL', joints.kneeL, 0, -0.46, 0);
    sockets.footR = pivot('socket:footR', joints.kneeR, 0, -0.46, 0);
    sockets.aura = pivot('socket:aura', root, 0, 0.9, 0);
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
            outlineMaterials.add(outlineMesh.material);
            parent.add(outlineMesh);
        }
        return mesh;
    }

    const torsoMesh = addPart(joints.torso, {
        name: 'torso-mesh', geometry: new THREE.BoxGeometry(.62, .68, .36),
        position: [0, .34, 0], material: materials.body
    });
    // ponytail: neck bridges the fixed 0.12 gap between torso top (0.94+.34+.34=1.62) and
    // the head joint (torso+0.80=1.74) — parented to torso (not head) so it stays fused to
    // the shoulders instead of swinging away and reopening a gap during head pitch/aim
    // (head.x swings up to ~aim*.55 + idle sway, torso barely rotates). Overlaps both
    // neighbors by .02 on purpose (matches the shop-showcase.js reference rig's overlap
    // convention) so float error / pose blending never exposes a seam.
    // ponytail: neck bridges torso top (0.94+.34+.34=1.62) and the cube head's flat underside
    // (head joint 1.74 + .20 - HEAD_SIZE/2 = 1.78) — parented to torso (not head) so it stays
    // fused to the shoulders instead of swinging away and reopening a gap during head pitch/aim
    // (head.x swings up to ~aim*.55 + idle sway, torso barely rotates). Overlaps both neighbors
    // by .02 on purpose (matches the shop-showcase.js reference rig's overlap convention) so
    // float error / pose blending never exposes a seam. Height .16->.20 and y .74->.76 because
    // the cube's underside sits .04 above where the old sphere's bottom tangent point did.
    const neckMesh = addPart(joints.torso, {
        name: 'neck-mesh', geometry: new THREE.BoxGeometry(.26, .20, .26),
        position: [0, .76, 0], material: materials.head
    });
    const headMesh = addPart(joints.head, {
        name: 'head-mesh', geometry: new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE),
        position: [0, .20, 0], material: materials.head
    });

    const upperArmL = addPart(joints.shoulderL, {
        name: 'upper-arm-L', geometry: new THREE.BoxGeometry(.20, .48, .22),
        position: [0, -.24, 0], material: materials.arms
    });
    const forearmL = addPart(joints.elbowL, {
        name: 'forearm-L', geometry: new THREE.BoxGeometry(.18, .44, .20),
        position: [0, -.22, 0], material: materials.arms
    });
    const upperArmR = addPart(joints.shoulderR, {
        name: 'upper-arm-R', geometry: new THREE.BoxGeometry(.20, .48, .22),
        position: [0, -.24, 0], material: materials.arms
    });
    const forearmR = addPart(joints.elbowR, {
        name: 'forearm-R', geometry: new THREE.BoxGeometry(.18, .44, .20),
        position: [0, -.22, 0], material: materials.arms
    });
    armMeshes.push(upperArmL, forearmL, upperArmR, forearmR);

    // ponytail: legs narrowed (.26->.20 thigh, .24->.18 calf) so the leg silhouette (outer
    // edge -.29) sits strictly inside the torso's (-.31..+.31) instead of matching it
    // exactly -- was reading as one solid block from a distance. hip/knee joint x is
    // untouched (cosmetic-models.js footL/footR sockets hang off it).
    const thighL = addPart(joints.hipL, {
        name: 'thigh-L', geometry: new THREE.BoxGeometry(.20, .52, .28),
        position: [0, -.26, 0], material: materials.legs
    });
    // ponytail: calf offset -.24->-.22 so its bottom lands on the floor exactly (was -0.02,
    // sinking 2cm through it); the .02 raise stays inside the existing knee/thigh overlap.
    const calfL = addPart(joints.kneeL, {
        name: 'calf-L', geometry: new THREE.BoxGeometry(.18, .48, .26),
        position: [0, -.22, 0], material: materials.legs
    });
    const thighR = addPart(joints.hipR, {
        name: 'thigh-R', geometry: new THREE.BoxGeometry(.20, .52, .28),
        position: [0, -.26, 0], material: materials.legs
    });
    const calfR = addPart(joints.kneeR, {
        name: 'calf-R', geometry: new THREE.BoxGeometry(.18, .48, .26),
        position: [0, -.22, 0], material: materials.legs
    });

    // trim — gives the accent/detail/visor palette slots somewhere to live
    addPart(joints.shoulderL, {
        name: 'pad-L', geometry: new THREE.BoxGeometry(.26, .14, .26),
        position: [0, 0, 0], material: materials.accent, outline: false
    });
    addPart(joints.shoulderR, {
        name: 'pad-R', geometry: new THREE.BoxGeometry(.26, .14, .26),
        position: [0, 0, 0], material: materials.accent, outline: false
    });
    addPart(joints.hips, {
        name: 'belt', geometry: new THREE.BoxGeometry(.5, .12, .3),
        position: [0, .02, 0], material: materials.detail, outline: false
    });
    // Front of the character is -Z. The visor's center sits exactly on the cube's front plane so
    // it straddles it (half embedded, half proud), derived from HEAD_HALF_DEPTH so it tracks any
    // future head resize instead of drifting inside/off the face like the sphere-era -.19 would.
    const visorMesh = addPart(joints.head, {
        name: 'visor', geometry: new THREE.BoxGeometry(.22, .05, .04),
        position: [0, .20, -HEAD_HALF_DEPTH], material: materials.visor, outline: false
    });
    // Default skins need a readable face at Shop distance too. These are direct
    // head children: the live renderer's visible scene now has no Mesh-parent
    // dependency, while the existing visor remains intact for compatibility.
    const facePlate = addPart(joints.head, {
        name: 'face-plate', geometry: new THREE.BoxGeometry(.30, .22, .018),
        position: [0, .20, -(HEAD_HALF_DEPTH + .035)], material: materials.detail, outline: false
    });
    const leftEye = addPart(joints.head, {
        name: 'eye-L', geometry: new THREE.BoxGeometry(.064, .056, .016),
        position: [-.072, .216, -(HEAD_HALF_DEPTH + .062)], material: materials.visor, outline: false
    });
    const rightEye = addPart(joints.head, {
        name: 'eye-R', geometry: new THREE.BoxGeometry(.070, .056, .016),
        position: [.072, .204, -(HEAD_HALF_DEPTH + .062)], material: materials.visor, outline: false
    });
    const proceduralFaceParts = [visorMesh, facePlate, leftEye, rightEye];

    function setProceduralFaceVisible(visible) {
        for (const part of proceduralFaceParts) part.visible = visible;
    }
    // A painted avatar face covers the whole front plane, so it replaces the visor rather than
    // layering over it -- setHeadTexture swaps which of the two is visible.
    const faceMesh = addPart(joints.head, {
        name: 'face-mesh', geometry: new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, FACE_DECAL_DEPTH),
        position: [0, .20, -(HEAD_HALF_DEPTH + FACE_DECAL_DEPTH / 2)],
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
        const signature = CHARACTER_SIGNATURES[state.characterId] || CHARACTER_SIGNATURES.rally;
        const place = (mesh, values) => {
            mesh.visible = Array.isArray(values);
            if (!Array.isArray(values)) return;
            mesh.scale.set(values[0], values[1], values[2]);
            mesh.position.set(values[3], values[4], values[5]);
        };
        place(signatureCrest, signature.crest);
        place(signatureBack, signature.back);
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
        root.scale.set(shape.width, shape.height, shape.depth);
        joints.shoulderL.position.x = -SHOULDER_X * shape.shoulder;
        joints.shoulderR.position.x = SHOULDER_X * shape.shoulder;
        // Derived from the avatar atlas (slim arm 3px vs classic 4px = .75) so a 'slim' pick
        // narrows the in-game arms by exactly what the avatar preview draws -- the old hardcoded
        // .82 rendered arms thicker than the avatar advertised.
        const armWidth = getAvatarArmScale(avatarModelId || AVATAR_SKINS[state.skinId]?.model);
        for (const mesh of armMeshes) mesh.scale.x = armWidth;
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
            mapBoxGeometryToAtlas(neckMesh.geometry, boxes.head);
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
