// tests/viewmodel-cosmetics.test.mjs — pins the cosmetics/viewmodel wave:
//   1. model-swapping ball skins exist and are PHYSICALLY identical to sphere skins,
//   2. the new knives exist in every catalog they need to reach a player,
//   3. the per-item viewmodel frame table covers every held item type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KNIVES, CASES } from '../js/cosmetics.js';
import { COSMETICS } from '../js/cosmetic-catalog.js';
import { BALL_PRICES } from '../js/battlepass.js';
import { SKIN_PRESETS } from '../js/skin-presets.js';
import { MODEL_FRAME_OFFSET, VIEWMODEL_BASE_POSITION, viewmodelFrame, resolveKnifePose, createKnifeAnimationState } from '../js/knife-animation.js';

// ball.js pulls in THREE, which plain `node --test` can't resolve — same string-substitution
// shim tests/ball-skins-catalog.test.mjs uses.
const ballSource = (await readFile(new URL('../js/ball.js', import.meta.url), 'utf8'))
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const { BALL_SKINS, BALL_SHAPES, SHAPE_SPIN } = await import(`data:text/javascript;base64,${Buffer.from(ballSource).toString('base64')}`);

// weapon-models.js also imports THREE; only the id list is needed here.
const weaponSource = (await readFile(new URL('../js/weapon-models.js', import.meta.url), 'utf8'))
    .replace("import * as THREE from 'three';", 'const THREE = {};');
const { KNIFE_MODELS } = await import(`data:text/javascript;base64,${Buffer.from(weaponSource).toString('base64')}`);

const MODEL_SKINS = {
    shuriken: { shape: 'shuriken', rarity: 'epic', price: 280 },
    baseball: { shape: 'baseball', rarity: 'rare', price: 240 },
    blockball: { shape: 'cube', rarity: 'epic', price: 260 },
    dark_eater: { shape: 'orb', rarity: 'legendary', price: 500 }
};

const NEW_KNIVES = {
    dark_eater: { model: 'tanto', rarity: 'legendary' },
    cleaver: { model: 'cleaver', rarity: 'epic' },
    stiletto: { model: 'dagger', rarity: 'rare' },
    courtline: { model: 'bayonet', rarity: 'rare' },
    pulsewing: { model: 'butterfly', rarity: 'epic' },
    rift_hook: { model: 'karambit', rarity: 'legendary' }
};

test('every model skin exists with a real shape, rarity and matching shop price', () => {
    for (const [id, expected] of Object.entries(MODEL_SKINS)) {
        const skin = BALL_SKINS[id];
        assert.ok(skin, `${id} missing from BALL_SKINS`);
        assert.equal(skin.shape, expected.shape, `${id} shape mismatch`);
        assert.ok(BALL_SHAPES.includes(skin.shape), `${id} uses an unknown shape "${skin.shape}"`);
        assert.equal(skin.rarity, expected.rarity, `${id} rarity mismatch`);
        assert.equal(skin.price, expected.price, `${id} price mismatch`);
        assert.equal(BALL_PRICES[id], expected.price, `${id} must be buyable (BALL_PRICES out of sync)`);
        for (const field of ['name', 'effect', 'color', 'glow', 'trail', 'starColor']) {
            assert.ok(skin[field] !== undefined, `${id} missing ${field}`);
        }
    }
});

// The whole point of the feature: a model skin must be a pure re-skin. If a skin ever carries
// its own radius/speed/gravity field, throws stop being fair and this fails.
test('ball skins carry no physics fields — every shape shares one collision sphere', () => {
    const PHYSICS_FIELDS = ['radius', 'visualRadius', 'gravity', 'mass', 'bounce', 'homing', 'hitRange'];
    const offenders = [];
    for (const [id, skin] of Object.entries(BALL_SKINS)) {
        for (const field of PHYSICS_FIELDS) {
            if (field in skin) offenders.push(`${id}.${field}`);
        }
    }
    assert.deepEqual(offenders, [], 'ball skins must stay visual-only');

    // ...and the sphere radius itself is a single constant in the class, not per skin.
    const radiusLines = ballSource.match(/this\.radius = [\d.]+;/g) || [];
    assert.deepEqual(radiusLines, ['this.radius = 0.47;'], 'ball collision radius must be one constant for all skins');
    assert.match(ballSource, /this\.visualRadius = 0\.43;/);
});

test('shape spin is visual-only and bounded', () => {
    for (const [shape, spin] of Object.entries(SHAPE_SPIN)) {
        assert.ok(BALL_SHAPES.includes(shape), `SHAPE_SPIN has unknown shape "${shape}"`);
        assert.ok(Number.isFinite(spin) && spin > 0 && spin <= 20, `${shape} spin out of range`);
    }
    // The spin must be written to the shape group, never to physics state.
    assert.match(ballSource, /this\.shapeGroup\.rotation\.y \+= this\._shapeSpin \* dt;/);
});

test('new knives exist with a real model and are reachable from a case', () => {
    const caseDropIds = new Set(
        Object.values(CASES).flatMap(box => box.drops.filter(drop => !drop.type).map(drop => drop.id))
    );
    for (const [id, expected] of Object.entries(NEW_KNIVES)) {
        const knife = KNIVES[id];
        assert.ok(knife, `${id} missing from KNIVES`);
        assert.equal(knife.id, id);
        assert.equal(knife.model, expected.model, `${id} model mismatch`);
        assert.equal(knife.rarity, expected.rarity, `${id} rarity mismatch`);
        assert.ok(KNIFE_MODELS.includes(knife.model), `${id} uses a model weapon-models.js cannot build`);
        assert.ok(Array.isArray(knife.teams) && knife.teams.length > 0, `${id} has no teams`);
        assert.ok(caseDropIds.has(id), `${id} is unobtainable — knives only drop from cases`);
    }
});

test('every knife in the catalog maps to a buildable model', () => {
    for (const knife of Object.values(KNIVES)) {
        assert.ok(KNIFE_MODELS.includes(knife.model), `${knife.id}: unknown model "${knife.model}"`);
    }
});

// Per-item offsets are the fix for "the item clips through the hand" — an item with no entry
// silently falls back to the classic knife's frame and pokes through the fist again.
test('the viewmodel frame table covers every held item type', () => {
    const held = [...KNIFE_MODELS, 'rocket'];
    for (const id of held) {
        const entry = MODEL_FRAME_OFFSET[id];
        assert.ok(entry, `${id} has no viewmodel frame entry`);
        assert.equal(entry.position.length, 3, `${id} position must be [x,y,z]`);
        assert.equal(entry.rotation.length, 3, `${id} rotation must be [x,y,z]`);
        assert.ok(entry.scale > 0 && entry.scale <= 1.5, `${id} scale out of range`);
        const frame = viewmodelFrame(id);
        for (let axis = 0; axis < 3; axis++) {
            assert.equal(frame.position[axis], VIEWMODEL_BASE_POSITION[axis] + entry.position[axis]);
        }
    }
    assert.deepEqual(Object.keys(MODEL_FRAME_OFFSET).sort(), held.sort(), 'frame table must have exactly one entry per held item');
});

// Grip placement is what stops the handle from spearing the fist: every model's rest
// position must put its grip in the same narrow band the hand block occupies.
test('every held item rests in the fist band, not behind it', () => {
    for (const id of Object.keys(MODEL_FRAME_OFFSET)) {
        const z = viewmodelFrame(id).position[2];
        assert.ok(z > -0.62 && z < -0.38, `${id} rest z ${z} is outside the fist band`);
    }
});

test('knife pose keeps using the shared frame for its rest transform', () => {
    for (const model of KNIFE_MODELS) {
        const pose = resolveKnifePose(createKnifeAnimationState(model), {});
        const frame = viewmodelFrame(model);
        assert.equal(pose.knifePosition.length, 3);
        // draw is the default action, so only compare the axis it does not drive.
        assert.equal(pose.knifePosition[2], frame.position[2], `${model} rest z drifted from the frame table`);
    }
});

test('the Dark Eater set is registered across ball, knife, wearables and character accent', () => {
    assert.equal(BALL_SKINS.dark_eater.rarity, 'legendary');
    assert.equal(KNIVES.dark_eater.rarity, 'legendary');
    for (const id of ['cape_dark_eater', 'aura_dark_eater', 'trail_dark_eater']) {
        const entry = COSMETICS[id];
        assert.ok(entry, `${id} missing from COSMETICS`);
        assert.equal(entry.id, id);
        assert.equal(entry.rarity, 'legendary', `${id} should be legendary like the rest of the set`);
        assert.equal(entry.style, 'void', `${id} should reuse the existing void style`);
        assert.ok(entry.price > 0, `${id} needs a shop price`);
    }
    assert.ok(SKIN_PRESETS.dark_eater, 'character accent preset missing');
    assert.equal(SKIN_PRESETS.dark_eater.theme, 'themed');
});

test('player input keeps ball combat semantics while gating F inspect from practice and spectator flows', async () => {
    const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    assert.match(playerSource, /e\.button === 0[\s\S]*this\.tryAttack\('slash'\)[\s\S]*this\._deflectHeld = true/);
    assert.match(playerSource, /e\.button === 2[\s\S]*this\.tryAttack\('stab'\)/);
    assert.match(playerSource, /e\.code === 'KeyF' \|\| e\.code === 'KeyI'/);
    assert.match(playerSource, /this\.game\?\._practiceMode[\s\S]*!this\.game\?\._cosmeticPractice/);
    assert.match(playerSource, /!this\.game\?\.ui\?\.spectating/);
    assert.match(playerSource, /knifeAnimationActionForAttack\(this\.knifeAttackType\)/);
});

test('premium gloves have authored first-person accents and two complete rig attachments', async () => {
    const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
    const modelSource = await readFile(new URL('../js/cosmetic-models.js', import.meta.url), 'utf8');
    for (const id of ['gloves_kinetic', 'gloves_prism', 'gloves_crown']) {
        assert.equal(COSMETICS[id]?.type, 'gloves', `${id} missing from wearable catalog`);
    }
    assert.match(playerSource, /resolveEquippedGlove\(loadout\)/);
    assert.match(playerSource, /gloveCuff[\s\S]*glovePalm[\s\S]*gloveKnuckles/);
    assert.match(modelSource, /const rightClone = model\.clone\(true\)/);
    assert.match(modelSource, /handL\.add\(leftClone\)[\s\S]*handR\.add\(rightClone\)/);
});
