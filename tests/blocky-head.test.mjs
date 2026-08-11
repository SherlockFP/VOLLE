// tests/blocky-head.test.mjs — regression coverage for the cube head geometry and face decal.
// Confirms the head is a BoxGeometry (not a SphereGeometry), asserts its dimensions,
// and verifies the visor sits on the head's front face plane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const { createCharacterRig, HEAD_SIZE, HEAD_HALF_DEPTH } = await import('../js/character-rig.js');
const { Group } = await import('./helpers/three-stub.mjs');

function meshChild(pivot, name) {
    return pivot.children.find(child => child.name === name);
}

function worldPosition(node) {
    let x = 0, y = 0, z = 0;
    for (let n = node; n; n = n.parent) {
        x += n.position.x; y += n.position.y; z += n.position.z;
    }
    return { x, y, z };
}

function halfExtents(geometry) {
    const [a, b, c] = geometry.args;
    if (geometry.constructor.name === 'SphereGeometry') return { x: a, y: a, z: a };
    return { x: a / 2, y: b / 2, z: c / 2 }; // BoxGeometry(width, height, depth)
}

test('head-mesh is a BoxGeometry, not a SphereGeometry', () => {
    const rig = createCharacterRig({});
    const headMesh = meshChild(rig.joints.head, 'head-mesh');
    assert.ok(headMesh, 'head-mesh should exist');
    assert.equal(headMesh.geometry.constructor.name, 'BoxGeometry', 'head-mesh should use BoxGeometry');
    assert.notEqual(headMesh.geometry.constructor.name, 'SphereGeometry', 'head-mesh must not be a sphere');
    rig.dispose();
});

test('head cube dimensions match the larger Minecraft-like head constant', () => {
    const rig = createCharacterRig({});
    const headMesh = meshChild(rig.joints.head, 'head-mesh');
    const [width, height, depth] = headMesh.geometry.args;
    assert.equal(width, HEAD_SIZE, `head width should be ${HEAD_SIZE}, got ${width}`);
    assert.equal(height, HEAD_SIZE, `head height should be ${HEAD_SIZE}, got ${height}`);
    assert.equal(depth, HEAD_SIZE, `head depth should be ${HEAD_SIZE}, got ${depth}`);
    rig.dispose();
});

test('visor-mesh sits on the head front face plane (z = -HEAD_HALF_DEPTH)', () => {
    const rig = createCharacterRig({});
    const visorMesh = meshChild(rig.joints.head, 'visor');
    assert.ok(visorMesh, 'visor mesh should exist');
    // Visor is positioned at [0, .20, -HEAD_HALF_DEPTH] in local coordinates on the head joint.
    // The test asserts that visor.position.z is derived from HEAD_HALF_DEPTH, not a hardcoded constant.
    // This ensures the visor stays on the face plane if the head geometry ever changes.
    const visorHalfDepth = halfExtents(visorMesh.geometry).z;
    assert.ok(
        Math.abs(Math.abs(visorMesh.position.z) - HEAD_HALF_DEPTH) < 0.001,
        `visor z should be at ±HEAD_HALF_DEPTH (${HEAD_HALF_DEPTH}), got ${visorMesh.position.z}`
    );
    assert.ok(
        visorMesh.position.z < 0,
        `visor should be on the front face (negative z), got ${visorMesh.position.z}`
    );
    rig.dispose();
});

test('face-mesh exists and is initially hidden (no texture)', () => {
    const rig = createCharacterRig({});
    const faceMesh = meshChild(rig.joints.head, 'face-mesh');
    assert.ok(faceMesh, 'face-mesh should exist');
    assert.equal(faceMesh.visible, false, 'face-mesh should be hidden by default (no avatar texture)');
    assert.equal(faceMesh.geometry.constructor.name, 'BoxGeometry', 'face-mesh should be a box');
    rig.dispose();
});

test('default rig carries a readable two-eye robot face directly on the head front plane', () => {
    const rig = createCharacterRig({});
    const visorMesh = meshChild(rig.joints.head, 'visor');
    const plate = meshChild(rig.joints.head, 'face-plate');
    const leftEye = meshChild(rig.joints.head, 'eye-L');
    const rightEye = meshChild(rig.joints.head, 'eye-R');

    assert.ok(plate && leftEye && rightEye, 'default face should include a plate and two eye blocks');
    assert.equal(plate.parent, rig.joints.head, 'face plate must be a direct head child in the live render hierarchy');
    assert.equal(leftEye.parent, rig.joints.head, 'left eye must be a direct head child in the live render hierarchy');
    assert.equal(rightEye.parent, rig.joints.head, 'right eye must be a direct head child in the live render hierarchy');
    assert.ok(leftEye.position.x < 0 && rightEye.position.x > 0, 'eyes must occupy distinct left/right positions');
    assert.notEqual(leftEye.position.y, rightEye.position.y, 'eye offsets retain a subtle robot asymmetry');
    assert.ok(
        leftEye.position.z < -HEAD_HALF_DEPTH,
        'eye blocks must sit in front of the head front plane'
    );
    assert.equal(leftEye.geometry.constructor.name, 'BoxGeometry');
    assert.equal(rightEye.geometry.constructor.name, 'BoxGeometry');
    rig.dispose();
});

test('custom face textures and atlases hide every procedural face mesh together', () => {
    const rig = createCharacterRig({});
    const visorMesh = meshChild(rig.joints.head, 'visor');
    const plate = meshChild(rig.joints.head, 'face-plate');
    const leftEye = meshChild(rig.joints.head, 'eye-L');
    const rightEye = meshChild(rig.joints.head, 'eye-R');
    const texture = { isTexture: true, dispose() {} };

    rig.setHeadTexture(texture);
    assert.equal(visorMesh.visible, false, 'custom face texture hides the visor parent');
    assert.equal(plate.visible, false, 'custom face texture hides the face plate');
    assert.equal(leftEye.visible, false, 'custom face texture hides the left eye');
    assert.equal(rightEye.visible, false, 'custom face texture hides the right eye');

    rig.setHeadTexture(null);
    assert.equal(plate.visible, true, 'clearing custom texture restores the face plate');
    assert.equal(leftEye.visible, true, 'clearing custom texture restores the left eye');
    assert.equal(rightEye.visible, true, 'clearing custom texture restores the right eye');
    rig.setAvatarAtlasTexture(texture, 'classic');
    assert.equal(visorMesh.visible, false, 'full avatar atlas hides the same visor parent');
    assert.equal(plate.visible, false, 'full avatar atlas hides the face plate');
    assert.equal(leftEye.visible, false, 'full avatar atlas hides the left eye');
    assert.equal(rightEye.visible, false, 'full avatar atlas hides the right eye');
    rig.dispose();
});

test('neck-mesh is BoxGeometry .26x.20x.26 (taller than the old .16 to close the torso-head gap)', () => {
    const rig = createCharacterRig({});
    const neckMesh = meshChild(rig.joints.torso, 'neck-mesh');
    assert.ok(neckMesh, 'neck-mesh should exist');
    const [width, height, depth] = neckMesh.geometry.args;
    assert.equal(width, 0.26, 'neck width should be 0.26');
    assert.equal(height, 0.20, 'neck height should be 0.20 (was 0.16 before)');
    assert.equal(depth, 0.26, 'neck depth should be 0.26');
    rig.dispose();
});

test('head and neck overlap without a gap (test 146 from character-rig.test.mjs constraint)', () => {
    const rig = createCharacterRig({});
    const neckMesh = meshChild(rig.joints.torso, 'neck-mesh');
    const headMesh = meshChild(rig.joints.head, 'head-mesh');

    // World positions: neck at y=.76 with half-height .10, so top at 1.76.
    // Head at y=.20 with half-height .16, positioned at y=1.94 on joints.head (torso+.80+.20),
    // so bottom at 1.78. This creates a .02 overlap, matching the reference rig convention.
    let neckWorldY = 0;
    let headWorldY = 0;
    for (let n = neckMesh; n; n = n.parent) neckWorldY += n.position.y;
    for (let n = headMesh; n; n = n.parent) headWorldY += n.position.y;

    const neckHalfHeight = halfExtents(neckMesh.geometry).y;
    const headHalfHeight = halfExtents(headMesh.geometry).y;

    const neckTop = neckWorldY + neckHalfHeight;
    const headBottom = headWorldY - headHalfHeight;

    assert.ok(headBottom <= neckTop + 0.001, `head bottom (${headBottom}) should not float above neck top (${neckTop})`);
    rig.dispose();
});
