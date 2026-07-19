import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/avatar.js', import.meta.url), 'utf8');
const avatar = await import(`data:text/javascript,${encodeURIComponent(source)}`);

const {
    AVATAR_MODELS,
    AVATAR_SKINS,
    AvatarPainter,
    HEAD_FRONT,
    composeAvatarAtlas,
    createAvatarAtlas,
    cropAtlasFace,
    getTeamPresetSkinId,
    layoutAvatarPreview,
    migrateAvatarPixels
} = avatar;

test('canonical atlas is 64x64 and face crop uses the head-front UV', () => {
    const atlas = Array(64 * 64).fill(null);
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) atlas[(HEAD_FRONT.y + y) * 64 + HEAD_FRONT.x + x] = `${x},${y}`;
    }

    const face = cropAtlasFace(atlas);
    assert.equal(face.length, 64);
    assert.equal(face[0], '0,0');
    assert.equal(face[63], '7,7');

    const preset = createAvatarAtlas('default');
    assert.equal(preset.length, 4096);
    assert.equal(preset[20 * 64 + 20], AVATAR_SKINS.default.body);
    assert.equal(preset[20 * 64 + 44], AVATAR_SKINS.default.arms);
    assert.equal(preset[20 * 64 + 4], AVATAR_SKINS.default.legs);
});

test('face edits overlay the selected base without mutating it', () => {
    const base = createAvatarAtlas('frost');
    const original = base.slice();
    const overlay = Array(64).fill(null);
    overlay[0] = '#123456';
    overlay[63] = '#abcdef';

    const composed = composeAvatarAtlas(base, overlay);
    assert.equal(composed[8 * 64 + 8], '#123456');
    assert.equal(composed[15 * 64 + 15], '#abcdef');
    assert.equal(composed[20 * 64 + 20], AVATAR_SKINS.frost.body);
    assert.deepEqual(base, original);
});

test('team presets expose team and model metadata and retain identity when saved', () => {
    assert.equal(getTeamPresetSkinId('BLUE'), 'blue_default');
    assert.equal(getTeamPresetSkinId('red'), 'red_guard');
    assert.equal(getTeamPresetSkinId('green'), null);
    assert.equal(AVATAR_SKINS.blue_default.team, 'blue');
    assert.equal(AVATAR_SKINS.red_guard.team, 'red');
    assert.ok(AVATAR_MODELS[AVATAR_SKINS.red_guard.model]);

    const values = new Map();
    const store = {
        get: key => values.get(key),
        set: (key, value) => values.set(key, value)
    };
    const painter = new AvatarPainter(fakeCanvas(), store);
    assert.equal(painter.applyPreset('red_guard'), true);
    assert.equal(values.get('equippedAvatarSkin'), 'red_guard');
    assert.equal(values.get('customAvatar').baseSkinId, 'red_guard');
    assert.equal(values.get('customAvatar').model, AVATAR_SKINS.red_guard.model);
    assert.equal(values.get('customAvatar').pixels.length, 4096);
    assert.equal(values.get('customAvatar').dataURL, 'data:image/png;size=64x64');
});

test('legacy 4096 and 256 pixel saves migrate deterministically to 8x8', () => {
    const atlas = Array(4096).fill(null);
    atlas[8 * 64 + 8] = '#first';
    atlas[15 * 64 + 15] = '#last';
    assert.deepEqual(migrateAvatarPixels(atlas), cropAtlasFace(atlas));

    const legacyFace = Array.from({ length: 256 }, (_, index) => index);
    const migrated = migrateAvatarPixels(legacyFace);
    assert.equal(migrated.length, 64);
    assert.equal(migrated[0], 0);
    assert.equal(migrated[1], 2);
    assert.equal(migrated[8], 32);
    assert.equal(migrated[63], 238);
});

test('preview layout derives part dimensions from model shape without overlap', () => {
    for (const modelId of ['classic', 'slim']) {
        const model = AVATAR_MODELS[modelId];
        const layout = layoutAvatarPreview(modelId, 3, 2);
        const byName = Object.fromEntries(layout.parts.map(part => [part.name, part]));

        assert.equal(byName.head.width, model.head.width * 3);
        assert.equal(byName.body.height, model.body.height * 3);
        assert.equal(byName.leftArm.width, model.arm.width * 3);
        assert.equal(byName.leftArm.atlas.width, model.arm.width);
        assert.equal(byName.rightLeg.height, model.leg.height * 3);

        for (let i = 0; i < layout.parts.length; i++) {
            for (let j = i + 1; j < layout.parts.length; j++) {
                assert.equal(overlaps(layout.parts[i], layout.parts[j]), false);
            }
        }
    }
});

function overlaps(a, b) {
    return a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y;
}

function fakeCanvas() {
    const context = {
        fillStyle: '',
        strokeStyle: '',
        imageSmoothingEnabled: false,
        fillRect() {},
        strokeRect() {}
    };
    const make = () => ({
        width: 0,
        height: 0,
        getContext: () => context,
        toDataURL() {
            return `data:image/png;size=${this.width}x${this.height}`;
        }
    });
    const canvas = make();
    canvas.ownerDocument = { createElement: make };
    canvas.addEventListener = () => {};
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height });
    return canvas;
}
