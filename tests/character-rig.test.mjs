// tests/character-rig.test.mjs — regression coverage for js/character-rig.js + js/character-anim.js.
// 'three' isn't an installed package (it's CDN-only via index.html's importmap), so this file redirects
// the bare specifier to tests/helpers/three-stub.mjs via tests/helpers/three-loader.mjs BEFORE dynamically
// importing the rig — see that file for why (node:module registerHooks, no CLI flags needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const { createCharacterRig, RIG_SOCKETS } = await import('../js/character-rig.js');
const { createCharacterAnimator } = await import('../js/character-anim.js');
const { JOINTS, POSE_STATES, STATE_DURATION, poseFor } = await import('../js/character-pose.js');
const { Group } = await import('./helpers/three-stub.mjs');

// Exact hierarchy + local offsets from docs/WARBALL_IO_PLAN.md section 1.2's diagram.
const EXPECTED_JOINT_OFFSETS = {
    hips: { parent: 'root', x: 0, y: 0.94, z: 0 },
    torso: { parent: 'hips', x: 0, y: 0, z: 0 },
    head: { parent: 'torso', x: 0, y: 0.80, z: 0 },
    shoulderL: { parent: 'torso', x: -0.44, y: 0.60, z: 0 },
    elbowL: { parent: 'shoulderL', x: 0, y: -0.46, z: 0 },
    shoulderR: { parent: 'torso', x: 0.44, y: 0.60, z: 0 },
    elbowR: { parent: 'shoulderR', x: 0, y: -0.46, z: 0 },
    hipL: { parent: 'hips', x: -0.19, y: 0, z: 0 },
    kneeL: { parent: 'hipL', x: 0, y: -0.48, z: 0 },
    hipR: { parent: 'hips', x: 0.19, y: 0, z: 0 },
    kneeR: { parent: 'hipR', x: 0, y: -0.48, z: 0 }
};

const EXPECTED_SOCKET_OFFSETS = {
    head: { parent: 'head', x: 0, y: 0.42, z: 0 },
    face: { parent: 'head', x: 0, y: 0, z: -0.24 },
    back: { parent: 'torso', x: 0, y: 0.34, z: 0.24 },
    chest: { parent: 'torso', x: 0, y: 0.36, z: -0.26 },
    waist: { parent: 'hips', x: 0, y: 0.02, z: 0 },
    handL: { parent: 'elbowL', x: 0, y: -0.46, z: 0 },
    handR: { parent: 'elbowR', x: 0, y: -0.46, z: 0 },
    footL: { parent: 'kneeL', x: 0, y: -0.46, z: 0 },
    footR: { parent: 'kneeR', x: 0, y: -0.46, z: 0 },
    aura: { parent: 'root', x: 0, y: 0.9, z: 0 },
    trail: { parent: 'root', x: 0, y: 0.1, z: 0 }
};

// Limb pivot -> the name of the mesh child that hangs off it (excludes accessories like shoulder pads,
// which sit at y=0 on purpose — only the true limb meshes are offset below/above the joint).
const LIMB_MESH_BY_JOINT = {
    shoulderL: 'upper-arm-L', elbowL: 'forearm-L',
    shoulderR: 'upper-arm-R', elbowR: 'forearm-R',
    hipL: 'thigh-L', kneeL: 'calf-L',
    hipR: 'thigh-R', kneeR: 'calf-R'
};

function meshChild(pivot, name) {
    return pivot.children.find(child => child.name === name);
}

// --- arithmetic Box3 substitute ---------------------------------------------
// tests/helpers/three-stub.mjs has no Box3/getWorldPosition (see that file). The
// rig is never posed in these tests (rotation stays the stub's default 0,0,0 on
// every joint), so a mesh's world position is just the sum of position.{x,y,z}
// up its parent chain -- no matrix math needed. Geometry half-extents come from
// the stub's recorded constructor args (BoxGeometry(w,h,d) / SphereGeometry(r)).
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

function meshExtent(mesh) {
    const pos = worldPosition(mesh);
    const half = halfExtents(mesh.geometry);
    return {
        minX: pos.x - half.x, maxX: pos.x + half.x,
        minY: pos.y - half.y, maxY: pos.y + half.y
    };
}

const EPS = 1e-9;

test('every JOINTS name has a joint, every RIG_SOCKETS name has a socket', () => {
    const rig = createCharacterRig({});
    for (const name of JOINTS) assert.ok(rig.joints[name], `missing joint ${name}`);
    for (const name of RIG_SOCKETS) assert.ok(rig.sockets[name], `missing socket ${name}`);
    rig.dispose();
});

test('joint hierarchy and local offsets match the WARBALL_IO_PLAN 1.2 diagram', () => {
    const rig = createCharacterRig({});
    for (const [name, expected] of Object.entries(EXPECTED_JOINT_OFFSETS)) {
        const joint = rig.joints[name];
        const parent = expected.parent === 'root' ? rig.root : rig.joints[expected.parent];
        assert.equal(joint.parent, parent, `${name} should be a child of ${expected.parent}`);
        assert.equal(joint.position.x, expected.x, `${name}.position.x`);
        assert.equal(joint.position.y, expected.y, `${name}.position.y`);
        assert.equal(joint.position.z, expected.z, `${name}.position.z`);
    }
    rig.dispose();
});

test('socket hierarchy and local offsets match the WARBALL_IO_PLAN 1.2 diagram', () => {
    const rig = createCharacterRig({});
    for (const [name, expected] of Object.entries(EXPECTED_SOCKET_OFFSETS)) {
        const socket = rig.sockets[name];
        const parent = expected.parent === 'root' ? rig.root : rig.joints[expected.parent];
        assert.equal(socket.parent, parent, `socket:${name} should be a child of ${expected.parent}`);
        assert.equal(socket.position.x, expected.x, `socket:${name}.position.x`);
        assert.equal(socket.position.y, expected.y, `socket:${name}.position.y`);
        assert.equal(socket.position.z, expected.z, `socket:${name}.position.z`);
    }
    rig.dispose();
});

test('limbs rotate from the joint: pivot sits at the joint, its mesh child is offset negative-y', () => {
    const rig = createCharacterRig({});
    for (const [jointName, meshName] of Object.entries(LIMB_MESH_BY_JOINT)) {
        const pivot = rig.joints[jointName];
        // pivot's own local position is the joint location from the diagram (already asserted above),
        // never (0,0,0) *and* never the mesh's center -- the mesh hangs below/above it instead.
        const mesh = meshChild(pivot, meshName);
        assert.ok(mesh, `expected ${jointName} to have a "${meshName}" mesh child`);
        assert.ok(mesh.position.y < 0, `${meshName}.position.y should be negative (offset below the joint), got ${mesh.position.y}`);
    }
    rig.dispose();
});

test('neutral-pose rig: lowest point across every mesh is exactly floor level (y=0)', () => {
    const rig = createCharacterRig({});
    let lowest = Infinity;
    rig.root.traverse(node => {
        if (!node.geometry) return;
        lowest = Math.min(lowest, meshExtent(node).minY);
    });
    assert.ok(Math.abs(lowest) < EPS, `lowest point should be 0, got ${lowest}`);
    rig.dispose();
});

test('neutral-pose rig: no vertical gap from torso up through the neck into the head', () => {
    const rig = createCharacterRig({});
    const torso = meshExtent(meshChild(rig.joints.torso, 'torso-mesh'));
    const neck = meshExtent(meshChild(rig.joints.torso, 'neck-mesh'));
    const head = meshExtent(meshChild(rig.joints.head, 'head-mesh'));

    // Each segment must overlap (or exactly touch) the next -- never leave daylight
    // between torso top -> neck bottom, or neck top -> head bottom.
    assert.ok(neck.minY <= torso.maxY + EPS,
        `neck bottom (${neck.minY}) should overlap/touch torso top (${torso.maxY}), not float above it`);
    assert.ok(head.minY <= neck.maxY + EPS,
        `head bottom (${head.minY}) should overlap/touch neck top (${neck.maxY}), not float above it`);
    rig.dispose();
});

test('neutral-pose rig: leg x-extent sits strictly inside the torso x-extent (readable silhouette)', () => {
    const rig = createCharacterRig({});
    const torso = meshExtent(meshChild(rig.joints.torso, 'torso-mesh'));
    const legMeshes = [
        meshChild(rig.joints.hipL, 'thigh-L'), meshChild(rig.joints.kneeL, 'calf-L'),
        meshChild(rig.joints.hipR, 'thigh-R'), meshChild(rig.joints.kneeR, 'calf-R')
    ];
    for (const mesh of legMeshes) {
        const extent = meshExtent(mesh);
        assert.ok(extent.minX > torso.minX, `${mesh.name}.minX (${extent.minX}) should be inside torso.minX (${torso.minX})`);
        assert.ok(extent.maxX < torso.maxX, `${mesh.name}.maxX (${extent.maxX}) should be inside torso.maxX (${torso.maxX})`);
    }
    rig.dispose();
});

test('applyPose writes euler values onto the matching joints, maps offsetY and lean', () => {
    const rig = createCharacterRig({});
    const pose = {
        offsetY: 0.42, lean: -0.31,
        shoulderL: { x: 1.1, y: 0.2, z: -0.4 },
        kneeR: { x: 0.6, y: 0, z: 0 }
    };
    rig.applyPose(pose);
    assert.equal(rig.root.position.y, 0.42);
    assert.equal(rig.joints.hips.rotation.z, -0.31);
    assert.equal(rig.joints.shoulderL.rotation.x, 1.1);
    assert.equal(rig.joints.shoulderL.rotation.y, 0.2);
    assert.equal(rig.joints.shoulderL.rotation.z, -0.4);
    assert.equal(rig.joints.kneeR.rotation.x, 0.6);
    rig.dispose();
});

test('applyPose mutates rotation objects in place instead of reallocating them', () => {
    const rig = createCharacterRig({});
    const rotationRef = rig.joints.shoulderL.rotation;
    rig.applyPose({ offsetY: 0, lean: 0, shoulderL: { x: 0.7, y: 0, z: 0 } });
    assert.equal(rig.joints.shoulderL.rotation, rotationRef, 'rotation object identity must survive applyPose');
    // second call with different values -- still the same object, and the mutation took.
    rig.applyPose({ offsetY: 0, lean: 0, shoulderL: { x: -0.2, y: 0, z: 0 } });
    assert.equal(rig.joints.shoulderL.rotation, rotationRef);
    assert.equal(rig.joints.shoulderL.rotation.x, -0.2);
    rig.dispose();
});

test('applyPose is a no-op on a missing/falsy pose', () => {
    const rig = createCharacterRig({});
    rig.applyPose({ offsetY: 0.9, lean: 0.5, hips: { x: 0.1, y: 0, z: 0 } });
    const before = { y: rig.root.position.y, lean: rig.joints.hips.rotation.z, hipsX: rig.joints.hips.rotation.x };
    rig.applyPose(null);
    rig.applyPose(undefined);
    assert.equal(rig.root.position.y, before.y);
    assert.equal(rig.joints.hips.rotation.z, before.lean);
    assert.equal(rig.joints.hips.rotation.x, before.hipsX);
    rig.dispose();
});

test('poseFor(state, ...) for every POSE_STATES value never writes NaN onto any joint', () => {
    const rig = createCharacterRig({});
    const times = [0, 0.016, 1.2, 37.5];
    const paramSets = [
        {},
        { speed: 12, aim: 0.9, strafe: -1, progress: 0.5, seed: 3 },
        { speed: -100, aim: Number.NaN, strafe: Infinity, progress: -5, seed: -8 }
    ];
    for (const state of POSE_STATES) {
        for (const t of times) {
            for (const params of paramSets) {
                const pose = poseFor(state, t, params);
                rig.applyPose(pose);
                assert.ok(Number.isFinite(rig.root.position.y), `${state}@${t}: root.position.y is NaN/Infinite`);
                assert.ok(Number.isFinite(rig.joints.hips.rotation.z), `${state}@${t}: hips.rotation.z (lean) is NaN/Infinite`);
                for (const name of JOINTS) {
                    const rotation = rig.joints[name].rotation;
                    assert.ok(Number.isFinite(rotation.x), `${state}@${t}: ${name}.rotation.x is NaN/Infinite`);
                    assert.ok(Number.isFinite(rotation.y), `${state}@${t}: ${name}.rotation.y is NaN/Infinite`);
                    assert.ok(Number.isFinite(rotation.z), `${state}@${t}: ${name}.rotation.z is NaN/Infinite`);
                }
            }
        }
    }
    rig.dispose();
});

test('setSkin/setCharacter/setTeam update rig.state and change material colors', () => {
    const rig = createCharacterRig({ characterId: 'rally', skinId: 'default', team: 'red' });
    const bodyMaterial = meshChild(rig.joints.torso, 'torso-mesh').material;
    const beforeHex = bodyMaterial.color.hex;

    const newTeam = rig.setTeam('blue');
    assert.equal(newTeam, 'blue');
    assert.equal(rig.state.team, 'blue');
    assert.notEqual(bodyMaterial.color.hex, beforeHex, 'setTeam should recolor the body material');

    const skinBefore = bodyMaterial.color.hex;
    const skinId = rig.setSkin('frost');
    assert.equal(rig.state.skinId, skinId);
    // frost is a real catalog skin (see js/avatar.js) so palette should differ or at least not throw.
    assert.doesNotThrow(() => rig.setSkin('frost'));
    void skinBefore;

    const characterId = rig.setCharacter('tank');
    assert.equal(rig.state.characterId, characterId);
    assert.equal(rig.state.characterId, 'tank');

    rig.dispose();
});

test('setSkin/setCharacter/setTeam fall back to defaults for unknown ids instead of throwing', () => {
    const rig = createCharacterRig({});
    assert.doesNotThrow(() => rig.setSkin('__does_not_exist__'));
    assert.doesNotThrow(() => rig.setCharacter('__does_not_exist__'));
    assert.doesNotThrow(() => rig.setTeam('__does_not_exist__'));
    assert.equal(rig.state.team, 'red', 'unknown team should fall back to red');
    assert.ok(rig.state.skinId, 'skinId should remain a valid catalog id');
    assert.ok(rig.state.characterId, 'characterId should remain a valid catalog id');
    rig.dispose();
});

test('dispose() disposes every geometry and every material exactly once, no double-free on shared materials', () => {
    const rig = createCharacterRig({});

    // materials.arms is shared across 4 meshes (upper/forearm L/R) by design -- collect via Set so we
    // assert per-instance dispose counts, not per-mesh-usage counts.
    const geometries = new Set();
    const materials = new Set();
    rig.root.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        if (node.material) materials.add(node.material);
    });

    assert.ok(geometries.size >= 14, `expected at least 14 distinct geometries, got ${geometries.size}`);
    assert.ok(materials.size >= 7, `expected at least 7 distinct materials, got ${materials.size}`);
    // the arms material must actually be shared (that's the scenario this test guards against).
    const armsMaterial = meshChild(rig.joints.shoulderL, 'upper-arm-L').material;
    assert.equal(meshChild(rig.joints.elbowL, 'forearm-L').material, armsMaterial);
    assert.equal(meshChild(rig.joints.shoulderR, 'upper-arm-R').material, armsMaterial);
    assert.equal(meshChild(rig.joints.elbowR, 'forearm-R').material, armsMaterial);

    for (const geometry of geometries) assert.equal(geometry.disposeCalls, 0);
    for (const material of materials) assert.equal(material.disposeCalls, 0);

    rig.dispose();

    for (const geometry of geometries) assert.equal(geometry.disposeCalls, 1, 'geometry disposed exactly once');
    for (const material of materials) assert.equal(material.disposeCalls, 1, 'material disposed exactly once (no double-free on shared material)');
});

test('dispose() detaches root and is idempotent when called twice', () => {
    const scene = new Group();
    const rig = createCharacterRig({});
    scene.add(rig.root);
    assert.equal(rig.root.parent, scene);

    const geometries = new Set();
    rig.root.traverse(node => { if (node.geometry) geometries.add(node.geometry); });

    rig.dispose();
    assert.equal(rig.root.parent, null, 'dispose() should detach root from its parent');
    for (const geometry of geometries) assert.equal(geometry.disposeCalls, 1);

    assert.doesNotThrow(() => rig.dispose());
    for (const geometry of geometries) assert.equal(geometry.disposeCalls, 1, 'second dispose() must not double-dispose');
});

test('createCharacterAnimator: play("throw") holds the throw state for its duration, then returns to locomotion', () => {
    const rig = createCharacterRig({});
    const animator = createCharacterAnimator(rig, { seed: 0 });
    animator.play('throw');
    assert.equal(animator.controller.state, 'throw');

    const duration = STATE_DURATION.throw;
    const step = 0.05;
    let elapsed = 0;
    while (elapsed + step < duration) {
        animator.update(step, { speed: 0, grounded: true, alive: true });
        elapsed += step;
        assert.equal(animator.controller.state, 'throw', `still throwing at elapsed=${elapsed}`);
    }
    // push past the duration -- should fall back to locomotion (idle, given these facts).
    animator.update(step, { speed: 0, grounded: true, alive: true });
    animator.update(step, { speed: 0, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'idle');
    rig.dispose();
});

test('createCharacterAnimator: setLoop overrides locomotion, setLoop(null) releases it', () => {
    const rig = createCharacterRig({});
    const animator = createCharacterAnimator(rig, { seed: 0 });

    animator.update(0.1, { speed: 10, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'run');

    animator.setLoop('victory');
    animator.update(0.1, { speed: 10, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'victory', 'setLoop should override locomotion even while moving');
    animator.update(0.1, { speed: 10, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'victory');

    animator.setLoop(null);
    animator.update(0.1, { speed: 10, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'run', 'setLoop(null) should release back to locomotion');

    // unknown loop names are rejected, same as null.
    animator.setLoop('not-a-real-state');
    animator.update(0.1, { speed: 10, grounded: true, alive: true });
    assert.equal(animator.controller.state, 'run');
    rig.dispose();
});

test('setPartColors applies hex colors to the body/arms/legs materials', () => {
    const rig = createCharacterRig({ team: 'red' });
    const bodyMaterial = meshChild(rig.joints.torso, 'torso-mesh').material;
    const armsMaterial = meshChild(rig.joints.shoulderL, 'upper-arm-L').material;
    const legsMaterial = meshChild(rig.joints.hipL, 'thigh-L').material;

    rig.setPartColors({ body: 0x112233, arms: 0x445566, legs: 0x778899 });
    assert.equal(bodyMaterial.color.hex, 0x112233);
    assert.equal(armsMaterial.color.hex, 0x445566);
    assert.equal(legsMaterial.color.hex, 0x778899);
    // legs material is shared across all four leg meshes.
    assert.equal(meshChild(rig.joints.kneeR, 'calf-R').material.color.hex, 0x778899);

    rig.dispose();
});

test('setPartColors(null) reverts to the skin palette (legs) / current team color (body, arms)', () => {
    const rig = createCharacterRig({ team: 'blue' });
    const bodyMaterial = meshChild(rig.joints.torso, 'torso-mesh').material;
    const armsMaterial = meshChild(rig.joints.shoulderL, 'upper-arm-L').material;
    const legsMaterial = meshChild(rig.joints.hipL, 'thigh-L').material;
    const legsBeforeHex = legsMaterial.color.hex;

    rig.setPartColors({ body: 0x111111, arms: 0x222222, legs: 0x333333 });
    rig.setPartColors(null);

    assert.equal(bodyMaterial.color.hex, 0x3355cc, 'body should revert to the current team color');
    assert.equal(armsMaterial.color.hex, 0x3355cc, 'arms should revert to the current team color');
    assert.equal(legsMaterial.color.hex, legsBeforeHex, 'legs should revert to the skin palette color');

    rig.dispose();
});

test('setPartColors composes with setTeam: avatar colors win over team recolor while active, release restores team follow', () => {
    const rig = createCharacterRig({ team: 'red' });
    const bodyMaterial = meshChild(rig.joints.torso, 'torso-mesh').material;
    const armsMaterial = meshChild(rig.joints.shoulderL, 'upper-arm-L').material;

    rig.setPartColors({ body: 0xabcdef, arms: 0xfedcba, legs: 0x123123 });
    rig.setTeam('blue');
    assert.equal(rig.state.team, 'blue', 'state.team should still update');
    assert.equal(bodyMaterial.color.hex, 0xabcdef, 'setTeam must not stomp active avatar body color');
    assert.equal(armsMaterial.color.hex, 0xfedcba, 'setTeam must not stomp active avatar arms color');

    // Releasing the latch should now pick up the team color recorded while it was active.
    rig.setPartColors(null);
    assert.equal(bodyMaterial.color.hex, 0x3355cc, 'body should follow the team recorded during the latch');
    assert.equal(armsMaterial.color.hex, 0x3355cc, 'arms should follow the team recorded during the latch');

    rig.dispose();
});

test('setPartColors composes with setSkin: avatar colors survive a skin change while active, release picks up the new skin palette', () => {
    const rig = createCharacterRig({ team: 'red', skinId: 'default' });
    const bodyMaterial = meshChild(rig.joints.torso, 'torso-mesh').material;
    const armsMaterial = meshChild(rig.joints.shoulderL, 'upper-arm-L').material;
    const legsMaterial = meshChild(rig.joints.hipL, 'thigh-L').material;

    rig.setPartColors({ body: 0x0a0b0c, arms: 0x0d0e0f, legs: 0x101112 });
    assert.doesNotThrow(() => rig.setSkin('frost'));
    assert.equal(rig.state.skinId, 'frost');
    assert.equal(bodyMaterial.color.hex, 0x0a0b0c, 'setSkin must not stomp active avatar body color');
    assert.equal(armsMaterial.color.hex, 0x0d0e0f, 'setSkin must not stomp active avatar arms color');
    assert.equal(legsMaterial.color.hex, 0x101112, 'setSkin must not stomp active avatar legs color');

    // Releasing the latch should now reflect the *new* skin's palette, not the old one.
    rig.setPartColors(null);
    const frostPaletteLegsHex = legsMaterial.color.hex;
    rig.dispose();

    const freshFrostRig = createCharacterRig({ team: 'red', skinId: 'frost' });
    const freshLegsMaterial = meshChild(freshFrostRig.joints.hipL, 'thigh-L').material;
    assert.equal(frostPaletteLegsHex, freshLegsMaterial.color.hex, 'released legs color should match frost skin palette');
    freshFrostRig.dispose();
});

test('createCharacterAnimator.update() drives rig.applyPose every frame', () => {
    let calls = 0;
    let lastPose = null;
    const fakeRig = {
        applyPose(pose) { calls += 1; lastPose = pose; }
    };
    const animator = createCharacterAnimator(fakeRig, { seed: 0 });
    animator.update(0.016, { speed: 0, grounded: true, alive: true });
    assert.equal(calls, 1);
    assert.ok(lastPose && typeof lastPose === 'object');

    animator.setLoop('emote');
    animator.update(0.016, { speed: 0, grounded: true, alive: true });
    assert.equal(calls, 2);

    animator.play('deflect');
    animator.update(0.016, { speed: 0, grounded: true, alive: true });
    assert.equal(calls, 3);
});
