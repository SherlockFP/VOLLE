// tests/avatar-model-parity.test.mjs — regression coverage for avatar/rig parity.
// Asserts that the avatar spec and the character rig's rendering match in part list,
// proportions, color slots, and model scaling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const {
    AVATAR_ATLAS_BOXES, AVATAR_MODELS, AVATAR_SKINS, HEAD_FRONT,
    layoutAvatarPreview, getAvatarArmScale
} = await import('../js/avatar.js');
const { createCharacterRig } = await import('../js/character-rig.js');

test('AVATAR_MODELS.classic.head is a cube (8x8x8)', () => {
    const head = AVATAR_MODELS.classic.head;
    assert.equal(head.width, 8, 'classic head width should be 8 (cube)');
    assert.equal(head.height, 8, 'classic head height should be 8 (cube)');
    assert.equal(head.depth, 8, 'classic head depth should be 8 (cube)');
});

test('AVATAR_MODELS.slim.head is also a cube (8x8x8), matching classic', () => {
    const head = AVATAR_MODELS.slim.head;
    assert.equal(head.width, 8, 'slim head width should be 8 (cube)');
    assert.equal(head.height, 8, 'slim head height should be 8 (cube)');
    assert.equal(head.depth, 8, 'slim head depth should be 8 (cube)');
});

test('HEAD_FRONT is an 8x8 region, matching the head cube dimensions', () => {
    assert.equal(HEAD_FRONT.width, 8, 'HEAD_FRONT width should be 8');
    assert.equal(HEAD_FRONT.height, 8, 'HEAD_FRONT height should be 8');
});

test('slim arm scale is 3/4 = 0.75 (slim 3px vs classic 4px)', () => {
    const classicScale = getAvatarArmScale('classic');
    const slimScale = getAvatarArmScale('slim');
    assert.equal(classicScale, 1.0, 'classic arm scale should be 1.0 (4/4)');
    assert.equal(slimScale, 0.75, 'slim arm scale should be 0.75 (3/4)');
});

test('getAvatarArmScale returns 1.0 for unknown models (defaults to classic)', () => {
    const scale = getAvatarArmScale('__unknown_model__');
    assert.equal(scale, 1.0, 'unknown model should default to classic scale (1.0)');
});

test('layoutAvatarPreview head box is square (width === height)', () => {
    const layout = layoutAvatarPreview('classic');
    const headPart = layout.parts.find(p => p.name === 'head');
    assert.ok(headPart, 'head part should exist in layout');
    assert.equal(headPart.width, headPart.height, 'head box should be square');
});

test('layoutAvatarPreview slim head box matches classic (both 8x8)', () => {
    const classicLayout = layoutAvatarPreview('classic');
    const slimLayout = layoutAvatarPreview('slim');
    const classicHead = classicLayout.parts.find(p => p.name === 'head');
    const slimHead = slimLayout.parts.find(p => p.name === 'head');
    assert.equal(classicHead.width, slimHead.width, 'classic and slim head widths should match');
    assert.equal(classicHead.height, slimHead.height, 'classic and slim head heights should match');
});

test('setPartColors only affects body/arms/legs (not head)', () => {
    const rig = createCharacterRig({ team: 'red' });
    const headMaterial = rig.joints.head.children.find(m => m.name === 'head-mesh')?.material;
    const headColorBefore = headMaterial?.color?.hex;

    // Apply avatar part colors to body/arms/legs
    rig.setPartColors({ body: 0x111111, arms: 0x222222, legs: 0x333333 });

    // Head color should NOT have changed (it's not in setPartColors, and not in PART_SLOTS)
    const headColorAfter = headMaterial?.color?.hex;
    assert.equal(headColorBefore, headColorAfter, 'setPartColors should not recolor the head material');

    rig.dispose();
});

test('every AVATAR_SKINS entry declares the same 4 colors (head, body, arms, legs)', () => {
    for (const [id, skin] of Object.entries(AVATAR_SKINS)) {
        assert.ok(skin.head, `${id} should have a head color`);
        assert.ok(skin.body, `${id} should have a body color`);
        assert.ok(skin.arms, `${id} should have an arms color`);
        assert.ok(skin.legs, `${id} should have a legs color`);
    }
});

test('AVATAR_MODELS classic and slim are the only valid model ids', () => {
    const validIds = Object.keys(AVATAR_MODELS);
    assert.deepEqual(validIds, ['classic', 'slim'], 'should have exactly classic and slim models');
});

test('slim arms are narrower than classic in the texture (3px vs 4px)', () => {
    const classicArm = AVATAR_MODELS.classic.arm;
    const slimArm = AVATAR_MODELS.slim.arm;
    assert.equal(classicArm.width, 4, 'classic arm width should be 4px');
    assert.equal(slimArm.width, 3, 'slim arm width should be 3px');
    assert.ok(slimArm.width < classicArm.width, 'slim arms should be narrower than classic');
});

test('both skin models expose deterministic six-face boxes for the complete body atlas', () => {
    for (const modelId of ['classic', 'slim']) {
        const boxes = AVATAR_ATLAS_BOXES[modelId];
        for (const part of ['head', 'body', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
            const box = boxes[part];
            assert.ok(box, `${modelId}.${part} box should exist`);
            for (const face of ['top', 'bottom', 'left', 'front', 'right', 'back']) {
                assert.ok(box.faces[face], `${modelId}.${part}.${face} UV should exist`);
            }
        }
    }
    assert.equal(AVATAR_ATLAS_BOXES.classic.leftArm.width, 4);
    assert.equal(AVATAR_ATLAS_BOXES.slim.leftArm.width, 3);
});
