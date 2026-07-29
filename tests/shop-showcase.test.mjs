// tests/shop-showcase.test.mjs — regression coverage for js/shop-showcase.js.
// Now that createShowcaseAvatar builds on js/character-rig.js, this file loads the module for real
// (dynamic import, no string-substitution shim) via tests/helpers/three-loader.mjs, which redirects
// the bare 'three' specifier to tests/helpers/three-stub.mjs -- see that file for why (node:module
// registerHooks, no CLI flags needed). This also lets the shop-showcase <-> character-rig import
// cycle exercise for real instead of being papered over by a fake single-file THREE stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const showcase = await import('../js/shop-showcase.js');

function descendants(root) {
    return root.children.flatMap(child => [child, ...descendants(child)]);
}

class FakeTarget {
    constructor() {
        this.listeners = new Map();
        this.attributes = new Map();
    }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) listener(event); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
}

function fakeBrowser(reducedMotion = false) {
    const media = new FakeTarget();
    media.matches = reducedMotion;
    const window = new FakeTarget();
    window.devicePixelRatio = 2.5;
    window.matchMedia = () => media;
    const document = new FakeTarget();
    document.defaultView = window;
    document.hidden = false;
    const canvas = new FakeTarget();
    canvas.tagName = 'CANVAS';
    canvas.ownerDocument = document;
    canvas.style = {};
    canvas.clientWidth = 640;
    canvas.clientHeight = 480;
    canvas.getBoundingClientRect = () => ({ width: 640, height: 480 });
    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    return { canvas, document, media, window };
}

test('normalizes catalog state and derives a deterministic material palette', () => {
    assert.deepEqual(showcase.normalizeShowcaseState(), { characterId: 'rally', skinId: 'default' });
    assert.deepEqual(
        showcase.normalizeShowcaseState({ characterId: 'tank', skinId: 'frost' }),
        { characterId: 'tank', skinId: 'frost' }
    );
    assert.deepEqual(
        showcase.normalizeShowcaseState({ characterId: '__proto__', skinId: 'missing' }),
        { characterId: 'rally', skinId: 'default' }
    );

    const palette = showcase.getShowcaseMaterialPalette({ characterId: 'tank', skinId: 'frost' });
    assert.equal(palette.head, 0xffffff);
    assert.equal(palette.body, 0x4488ff);
    assert.equal(palette.arms, 0x88ccff);
    assert.ok(showcase.getShowcaseCharacterShape('tank').width > showcase.getShowcaseCharacterShape('rally').width);
});

test('reusable avatar rig swaps skin materials in place and disposes GPU resources', () => {
    const avatar = showcase.createShowcaseAvatar({ characterId: 'scout', skinId: 'neon' });
    const torso = descendants(avatar.root).find(item => item.name === 'torso-mesh');
    const arm = descendants(avatar.root).find(item => item.name === 'upper-arm-L');
    const material = torso.material;
    const oldColor = material.color.hex;

    assert.equal(avatar.root.name, 'warrball-showcase-avatar');
    assert.deepEqual(avatar.state, { characterId: 'scout', skinId: 'neon' });
    // Slim arm scale is 0.75 (slim arm 3px vs classic 4px = 3/4 = 0.75, derived from AVATAR_MODELS).
    // The old hardcoded 0.82 was an incorrect guess that never matched the avatar atlas specification.
    assert.equal(arm.scale.x, 0.75);
    assert.equal(avatar.setSkin('frost'), 'frost');
    assert.equal(torso.material, material, 'setSkin must recolor materials in place, not replace them');
    assert.notEqual(material.color.hex, oldColor);
    assert.equal(material.color.hex, 0x4488ff);
    assert.equal(arm.scale.x, 1);
    assert.equal(avatar.setCharacter('tank'), 'tank');
    // avatar.root.children[0] is the character rig's own root group -- applyShape() scales it directly.
    assert.equal(avatar.root.children[0].scale.x, 1.18);

    const meshes = descendants(avatar.root).filter(item => item.geometry);
    assert.ok(meshes.length > 0, 'rig should have produced mesh children');
    avatar.dispose();
    assert.equal(avatar.root.userData.disposed, true);
    assert.ok(meshes.every(mesh => mesh.geometry.disposeCalls === 1 && mesh.material.disposeCalls === 1));

    // idempotent
    assert.doesNotThrow(() => avatar.dispose());
    assert.ok(meshes.every(mesh => mesh.geometry.disposeCalls === 1 && mesh.material.disposeCalls === 1));
});

test('setPoseTime drives the rig through an idle pose, and is fully static under reduced motion', () => {
    const avatar = showcase.createShowcaseAvatar({ characterId: 'rally', skinId: 'default' });
    const rigRoot = avatar.root.children[0];
    const hips = rigRoot.children.find(child => child.name === 'hips');

    avatar.setPoseTime(0.35, false);
    const movedY = rigRoot.position.y;
    const movedShoulderX = hips.children.find(c => c.name === 'torso')
        .children.find(c => c.name === 'shoulderL').rotation.x;
    // idle sway should perturb something off the resting zero pose at a non-zero time.
    assert.ok(movedY !== 0 || movedShoulderX !== 0, 'idle pose should not be perfectly neutral at t=0.35');

    avatar.setPoseTime(0.9, true);
    assert.equal(rigRoot.position.y, 0, 'reduced motion must fully neutralize offsetY');
    const shoulderL = hips.children.find(c => c.name === 'torso').children.find(c => c.name === 'shoulderL');
    assert.equal(shoulderL.rotation.x, 0, 'reduced motion must fully neutralize joint rotations');
    assert.equal(shoulderL.rotation.z, 0);

    avatar.dispose();
});

test('renderer supports canvas mounts, keyboard rotation, reactive reduced motion, and cleanup', () => {
    const { canvas, document, media } = fakeBrowser(false);
    const renderer = showcase.createShopShowcase(canvas, {
        characterId: 'rally',
        skinId: 'default',
        autoStart: false
    });

    assert.equal(canvas.getAttribute('role'), 'img');
    assert.match(canvas.getAttribute('aria-label'), /arrow keys/i);
    assert.deepEqual(renderer.resize(), { width: 640, height: 480, pixelRatio: 2 });
    assert.equal(renderer.camera.aspect, 4 / 3);
    assert.equal(renderer.start(), true);
    assert.equal(typeof renderer.renderer.loop, 'function');

    const initialYaw = renderer.avatar.root.rotation.y;
    let prevented = false;
    canvas.dispatch('keydown', { key: 'ArrowRight', shiftKey: false, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.ok(renderer.avatar.root.rotation.y > initialYaw);
    const keyboardYaw = renderer.avatar.root.rotation.y;
    canvas.dispatch('pointerdown', { clientX: 10, clientY: 20, pointerId: 1 });
    canvas.dispatch('pointermove', { clientX: 30, clientY: 24, pointerId: 1 });
    canvas.dispatch('pointerup', { pointerId: 1 });
    assert.ok(renderer.avatar.root.rotation.y > keyboardYaw);
    assert.deepEqual(renderer.sync({ skinId: 'neon' }), { characterId: 'rally', skinId: 'neon' });

    media.matches = true;
    media.dispatch('change', { matches: true });
    assert.equal(renderer.reducedMotion, true);
    assert.equal(renderer.renderer.loop, null);
    media.matches = false;
    media.dispatch('change', { matches: false });
    assert.equal(typeof renderer.renderer.loop, 'function');

    document.hidden = true;
    document.dispatch('visibilitychange');
    assert.equal(renderer.renderer.loop, null);
    renderer.dispose();
    assert.equal(renderer.renderer.disposed, true);
    assert.equal(canvas.getAttribute('role'), null);
    assert.equal(canvas.style.touchAction, '');
});
