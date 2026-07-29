// character-rig.js — THREE skeleton + sockets + materials for the canonical Warrball character.
// ponytail: geometri sabit sayılar plan diyagramından birebir; oran/renk shop-showcase'ten import.
import * as THREE from 'three';
import { JOINTS } from './character-pose.js';
import { AVATAR_SKINS } from './avatar.js';
import { getShowcaseMaterialPalette, getShowcaseCharacterShape, normalizeShowcaseState } from './shop-showcase.js';

export const RIG_SOCKETS = Object.freeze([
    'head', 'face', 'back', 'chest', 'waist',
    'handL', 'handR', 'footL', 'footR', 'aura', 'trail'
]);

const MATERIAL_SLOTS = Object.freeze(['head', 'body', 'arms', 'legs', 'accent', 'detail', 'visor']);
const TEAM_COLORS = Object.freeze({ red: 0xcc3333, blue: 0x3355cc });
const SHOULDER_X = 0.44;

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

function pivot(name, parent, x = 0, y = 0, z = 0) {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(x, y, z);
    parent.add(object);
    return object;
}

/**
 * @param {object} options { characterId, skinId, team, materialFactory, outlineFactory, quality, castShadow }
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
    const segments = options.quality === 'low' ? 6 : 10;

    const buildMaterial = hex => (materialFactory
        ? materialFactory(hex)
        : new THREE.MeshStandardMaterial({ color: hex, roughness: .58, metalness: .08 }));

    const initialPalette = getShowcaseMaterialPalette(state);
    const materials = {};
    for (const slot of MATERIAL_SLOTS) materials[slot] = buildMaterial(initialPalette[slot]);
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

    addPart(joints.torso, {
        name: 'torso-mesh', geometry: new THREE.BoxGeometry(.62, .68, .36),
        position: [0, .34, 0], material: materials.body
    });
    // ponytail: neck bridges the fixed 0.12 gap between torso top (0.94+.34+.34=1.62) and
    // the head joint (torso+0.80=1.74) — parented to torso (not head) so it stays fused to
    // the shoulders instead of swinging away and reopening a gap during head pitch/aim
    // (head.x swings up to ~aim*.55 + idle sway, torso barely rotates). Overlaps both
    // neighbors by .02 on purpose (matches the shop-showcase.js reference rig's overlap
    // convention) so float error / pose blending never exposes a seam.
    addPart(joints.torso, {
        name: 'neck-mesh', geometry: new THREE.BoxGeometry(.26, .16, .26),
        position: [0, .74, 0], material: materials.head
    });
    addPart(joints.head, {
        name: 'head-mesh', geometry: new THREE.SphereGeometry(.20, segments, segments - 2),
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
    addPart(joints.hipL, {
        name: 'thigh-L', geometry: new THREE.BoxGeometry(.20, .52, .28),
        position: [0, -.26, 0], material: materials.legs
    });
    // ponytail: calf offset -.24->-.22 so its bottom lands on the floor exactly (was -0.02,
    // sinking 2cm through it); the .02 raise stays inside the existing knee/thigh overlap.
    addPart(joints.kneeL, {
        name: 'calf-L', geometry: new THREE.BoxGeometry(.18, .48, .26),
        position: [0, -.22, 0], material: materials.legs
    });
    addPart(joints.hipR, {
        name: 'thigh-R', geometry: new THREE.BoxGeometry(.20, .52, .28),
        position: [0, -.26, 0], material: materials.legs
    });
    addPart(joints.kneeR, {
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
    addPart(joints.head, {
        name: 'visor', geometry: new THREE.BoxGeometry(.22, .05, .04),
        position: [0, .20, -.19], material: materials.visor, outline: false
    });

    // --- palette / proportions ---
    const PART_SLOTS = ['body', 'arms', 'legs'];
    // ponytail: avatar part colors (setPartColors) win over palette/team recolor
    // while active -- setSkin/setCharacter/setTeam still update state so the right
    // color comes back once setPartColors(null) releases the latch.
    let avatarColorsActive = false;

    function applyPalette() {
        const palette = getShowcaseMaterialPalette(state);
        for (const slot of MATERIAL_SLOTS) {
            if (avatarColorsActive && PART_SLOTS.includes(slot)) continue;
            setMaterialColor(materials[slot], palette[slot]);
        }
        return palette;
    }

    function applyShape() {
        const shape = getShowcaseCharacterShape(state.characterId);
        root.scale.set(shape.width, shape.height, shape.depth);
        joints.shoulderL.position.x = -SHOULDER_X * shape.shoulder;
        joints.shoulderR.position.x = SHOULDER_X * shape.shoulder;
        const armWidth = AVATAR_SKINS[state.skinId]?.model === 'slim' ? .82 : 1;
        for (const mesh of armMeshes) mesh.scale.x = armWidth;
    }

    function applyTeam() {
        const hex = TEAM_COLORS[state.team] || TEAM_COLORS.red;
        for (const material of teamMaterials) setMaterialColor(material, hex);
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

    // ponytail: reuses the shared "head" material slot directly — works for the
    // default MeshStandardMaterial (supports .map); avatar textures aren't used
    // together with a toon materialFactory anywhere today, so no shader branch needed.
    // Texture disposal falls out of the existing dispose() pass (Object.values scan).
    function setHeadTexture(texture) {
        const head = materials.head;
        if (!head) return;
        if (head.map && head.map !== texture) head.map.dispose?.();
        head.map = texture || null;
        if (head.color?.setHex) head.color.setHex(texture ? 0xffffff : getShowcaseMaterialPalette(state).head);
        head.needsUpdate = true;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (const geometry of geometries) geometry.dispose?.();
        const allMaterials = new Set([...Object.values(materials), ...outlineMaterials]);
        for (const material of allMaterials) disposeMaterial(material);
        root.removeFromParent?.();
        root.clear?.();
    }

    const handle = {
        root, joints, sockets,
        applyPose, setSkin, setCharacter, setTeam, setVisible, setHeadTexture, setPartColors, dispose
    };
    Object.defineProperty(handle, 'state', {
        enumerable: true,
        get: () => Object.freeze({ ...state })
    });
    return handle;
}
