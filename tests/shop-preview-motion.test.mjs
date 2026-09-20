import test from 'node:test';
import assert from 'node:assert/strict';
import { registerThreeStub } from './helpers/three-loader.mjs';

registerThreeStub();

const { SHOWCASE_ANIMATIONS, normalizeShowcaseAnimation, createShopShowcase } = await import('../js/shop-showcase.js');
const { JOINTS } = await import('../js/character-pose.js');
const { Color } = await import('./helpers/three-stub.mjs');

class FakeTarget {
    constructor(tagName = '') {
        this.tagName = tagName;
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
        this.children = [];
        this.clientWidth = 640;
        this.clientHeight = 480;
        this.captured = new Set();
        this.released = [];
    }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    dispatch(type, event = {}) {
        event.target ??= this;
        event.currentTarget = this;
        event.defaultPrevented ??= false;
        event.preventDefault ??= () => { event.defaultPrevented = true; };
        for (const listener of this.listeners.get(type) || []) listener(event);
        return event;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight }; }
    appendChild(child) { this.children.push(child); child.parentNode = this; }
    remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); }
    setPointerCapture(pointerId) {
        if (this.captureThrows) throw new Error('Pointer is no longer active');
        this.captured.add(pointerId);
    }
    hasPointerCapture(pointerId) { return this.captured.has(pointerId); }
    releasePointerCapture(pointerId) {
        if (this.releaseThrows) throw new Error('Canvas was detached');
        assert.ok(this.captured.has(pointerId), 'release must only target a captured pointer');
        this.captured.delete(pointerId);
        this.released.push(pointerId);
        this.dispatch('lostpointercapture', { pointerId });
    }
}

function setup(t, { reducedMotion = false, container = false, ...options } = {}) {
    const media = new FakeTarget();
    media.matches = reducedMotion;
    const window = new FakeTarget();
    const observers = [];
    window.devicePixelRatio = 2;
    window.matchMedia = () => media;
    window.getComputedStyle = () => ({ getPropertyValue: () => '' });
    window.ResizeObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
    };
    const document = new FakeTarget();
    document.defaultView = window;
    document.documentElement = new FakeTarget('HTML');
    document.hidden = false;
    document.createElement = tagName => {
        const element = new FakeTarget(tagName.toUpperCase());
        element.ownerDocument = document;
        return element;
    };
    const mount = document.createElement(container ? 'div' : 'canvas');
    const preview = createShopShowcase(mount, { autoStart: false, ...options });
    t.after(() => preview.dispose());

    // Fill only material/light fields absent from the shared minimal THREE stub.
    const emissive = new Color(0);
    emissive.copy = other => emissive.setHex(other.hex);
    preview._floorMaterial.emissive = emissive;
    preview._rimLight.color = new Color(0);
    const poses = [];
    const applyPose = preview.avatar.rig.applyPose;
    preview.avatar.rig.applyPose = pose => { poses.push(pose); applyPose(pose); };
    const cosmetics = [];
    preview.avatar.onPoseTime = (seconds, reduced) => cosmetics.push({ seconds, reduced });
    return { preview, mount, canvas: preview.canvas, document, window, media, observers, poses, cosmetics };
}

function poseSnapshot(preview) {
    const rig = preview.avatar.rig;
    return [rig.root.position.y, ...JOINTS.flatMap(name => {
        const rotation = rig.joints[name].rotation;
        return [rotation.x, rotation.y, rotation.z];
    })];
}

function step(preview, count = 8, start = 0) {
    for (let index = 0; index < count; index++) preview.renderer.loop(start + index * 1000 / 60);
}

test('preview modes are frozen, bounded, and do not coerce invalid animation identifiers', t => {
    assert.deepEqual(SHOWCASE_ANIMATIONS, ['idle', 'run', 'celebrate']);
    assert.ok(Object.isFrozen(SHOWCASE_ANIMATIONS));
    const { preview } = setup(t);
    const invalidIds = [null, undefined, 1, '', 'RUN', 'victory', '__proto__', 'constructor',
        ['run'], { id: 'run' }, Symbol('run'), { toString() { throw new Error('do not coerce'); } }];
    for (const id of SHOWCASE_ANIMATIONS) assert.equal(normalizeShowcaseAnimation(id), id);
    for (const id of invalidIds) {
        preview.setAnimation('celebrate');
        assert.equal(normalizeShowcaseAnimation(id), 'idle');
        assert.equal(preview.setAnimation(id), 'idle');
        assert.equal(preview.animation, 'idle');
    }
    assert.equal(preview.renderer.renderCount, 0, 'configuration must not start a stopped preview');
});

test('Idle, Run and Celebrate produce distinct looping poses on the same rig and sockets', t => {
    const { preview } = setup(t);
    const rig = preview.avatar.rig;
    const hand = rig.sockets.handR;
    const hipRotation = rig.joints.hipL.rotation;
    preview.start();
    assert.equal(preview.animation, 'idle');
    assert.equal(preview.autoRotate, true);
    step(preview);
    const idle = poseSnapshot(preview);

    assert.equal(preview.setAnimation('run'), 'run');
    step(preview, 8, 1000);
    const run = poseSnapshot(preview);
    assert.ok(Math.abs(rig.joints.hipL.rotation.x) > .2, 'run visibly swings the legs');
    assert.ok(Math.abs(rig.joints.shoulderL.rotation.x) > .1, 'run also swings the arms');
    assert.notDeepEqual(run, idle);

    assert.equal(preview.setAnimation('celebrate'), 'celebrate');
    assert.ok(Math.abs(rig.joints.shoulderL.rotation.z) > 2, 'celebration raises both arms');
    assert.ok(Math.abs(rig.joints.shoulderR.rotation.z) > 2);
    const celebrationStart = poseSnapshot(preview);
    step(preview, 8, 2000);
    assert.notDeepEqual(poseSnapshot(preview), celebrationStart, 'celebration continues moving');
    assert.ok(rig.root.position.y > 0, 'celebration has a visible bounce');
    preview.setAnimation('idle');
    assert.ok(Math.abs(rig.joints.shoulderL.rotation.z) < .2, 'returning to idle clears raised arms');
    assert.equal(rig.joints.hipL.rotation.x, 0, 'returning to idle clears the run/celebration legs');
    assert.equal(preview.avatar.rig, rig);
    assert.equal(rig.sockets.handR, hand);
    assert.equal(rig.joints.hipL.rotation, hipRotation);
    assert.ok([...idle, ...run, ...poseSnapshot(preview)].every(Number.isFinite));
});

test('reselecting a mode and syncing cosmetics preserve phase; changing modes restarts cleanly', t => {
    const { preview, poses } = setup(t);
    preview.start();
    preview.setAnimation('run');
    step(preview);
    const phase = preview._elapsed;
    const run = poseSnapshot(preview);
    const drawCount = preview.renderer.renderCount;
    const poseCount = poses.length;
    preview.setAnimation('run');
    assert.equal(preview._elapsed, phase);
    assert.equal(preview.renderer.renderCount, drawCount);
    assert.equal(poses.length, poseCount);
    preview.sync({ skinId: 'frost', characterId: 'tank' });
    assert.equal(preview.animation, 'run');
    assert.equal(preview._elapsed, phase);
    assert.deepEqual(poseSnapshot(preview), run);
    preview.setAnimation('celebrate');
    assert.equal(preview._elapsed, 0);
    preview.renderer.loop(10_000);
    assert.equal(preview._elapsed, 0, 'selection does not absorb the previous clock gap');
    preview.setAnimation('missing');
    assert.equal(preview.animation, 'idle');
    assert.ok(Math.abs(preview.avatar.rig.joints.shoulderL.rotation.z) < .2);
});

test('automatic rotation defaults on and can pause independently of pose animation', t => {
    const { preview } = setup(t);
    preview.start();
    step(preview);
    assert.ok(preview.avatar.root.rotation.y > Math.PI);
    assert.equal(preview.setAutoRotate(false), false);
    const yaw = preview._yaw;
    const pose = poseSnapshot(preview);
    step(preview, 8, 200);
    assert.equal(preview.avatar.root.rotation.y, yaw);
    assert.notDeepEqual(poseSnapshot(preview), pose, 'pausing rotation does not pause the rig');
    assert.equal(preview.setAutoRotate(true), true);
    step(preview, 8, 400);
    assert.ok(preview.avatar.root.rotation.y > yaw);
});

test('resetView and Home restore the front view without changing animation, framing or auto rotation', t => {
    const { preview, canvas } = setup(t, { camera: { fov: 34, position: [0, 1.62, 1.85], target: [0, 1.55, 0] } });
    preview.start();
    preview.setAnimation('run');
    preview.setAutoRotate(false);
    step(preview);
    const phase = preview._elapsed;
    canvas.dispatch('pointerdown', { pointerId: 7, clientX: 10, clientY: 10 });
    canvas.dispatch('pointermove', { pointerId: 7, clientX: 80, clientY: 40 });
    assert.notEqual(preview.avatar.root.rotation.y, Math.PI);
    assert.equal(preview.resetView(), true);
    assert.equal(preview.avatar.root.rotation.y, Math.PI);
    assert.equal(preview.avatar.root.rotation.x, -.02);
    assert.deepEqual(canvas.released, [7]);
    canvas.dispatch('pointermove', { pointerId: 7, clientX: 120, clientY: 120 });
    assert.equal(preview.avatar.root.rotation.y, Math.PI, 'reset ends an in-flight drag');
    canvas.dispatch('keydown', { key: 'ArrowLeft' });
    canvas.dispatch('keydown', { key: 'ArrowUp' });
    const home = canvas.dispatch('keydown', { key: 'Home' });
    assert.equal(home.defaultPrevented, true);
    assert.equal(preview.avatar.root.rotation.y, Math.PI);
    assert.equal(preview.avatar.root.rotation.x, -.02);
    assert.equal(preview.animation, 'run');
    assert.equal(preview.autoRotate, false);
    assert.equal(preview._elapsed, phase);
    assert.equal(preview.camera.fov, 34);
    assert.deepEqual([preview.camera.position.x, preview.camera.position.y, preview.camera.position.z], [0, 1.62, 1.85]);
});

test('reduced motion neutralizes every mode and cosmetics while remembering controls', t => {
    const { preview, media, canvas, cosmetics, poses } = setup(t);
    preview.start();
    preview.setAnimation('run');
    step(preview);
    const staleFrame = preview.renderer.loop;
    preview.setReducedMotion(true);
    const restingPose = poses.at(-1);
    const phase = preview._elapsed;
    for (const mode of SHOWCASE_ANIMATIONS) {
        preview.setAnimation(mode);
        assert.equal(preview.renderer.loop, null);
        assert.ok(poseSnapshot(preview).every(value => value === 0), `${mode} remains neutral`);
        assert.deepEqual(cosmetics.at(-1), { seconds: 0, reduced: true });
        assert.equal(poses.at(-1), restingPose, 'static refreshes reuse one neutral pose');
    }
    const draws = preview.renderer.renderCount;
    staleFrame(60_000);
    assert.equal(preview.renderer.renderCount, draws);
    assert.ok(preview._elapsed <= phase);
    canvas.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(preview.avatar.root.rotation.y > Math.PI, 'manual inspection remains available');
    preview.setAutoRotate(false);
    media.matches = true;
    media.dispatch('change', { matches: true });
    assert.equal(preview.setReducedMotion(false), true, 'OS preference still overrides the in-app flag');
    media.matches = false;
    media.dispatch('change', { matches: false });
    assert.equal(preview.reducedMotion, false);
    assert.equal(preview.animation, 'celebrate');
    assert.equal(preview.autoRotate, false);
    assert.equal(typeof preview.renderer.loop, 'function');
    assert.ok(Math.abs(preview.avatar.rig.joints.shoulderL.rotation.z) > 2);
});

test('OS motion changes cannot override an active in-app motion reduction', t => {
    const { preview, media } = setup(t, { reducedMotion: true });
    preview.start();
    assert.equal(preview.renderer.loop, null);
    assert.ok(poseSnapshot(preview).every(value => value === 0));
    preview.setReducedMotion(true);
    media.matches = false;
    media.dispatch('change', { matches: false });
    assert.equal(preview.reducedMotion, true);
    assert.equal(preview.renderer.loop, null);
    preview.setReducedMotion(false);
    assert.equal(typeof preview.renderer.loop, 'function');
});

test('stopped previews defer drawing, pose callbacks and backing-buffer resize until start', t => {
    const { preview, poses, cosmetics, canvas } = setup(t);
    assert.equal(preview.renderer.renderCount, 0);
    assert.equal(preview.renderer.size, undefined);
    preview.setAnimation('run');
    preview.setAutoRotate(false);
    preview.resetView();
    preview.sync({ skinId: 'frost' });
    preview.setCharacter('tank');
    preview.setSkin('neon');
    preview.refreshTheme();
    preview.setAccent('#123456');
    preview.setReducedMotion(true);
    preview.resize(800, 500);
    canvas.dispatch('keydown', { key: 'ArrowRight' });
    canvas.dispatch('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
    canvas.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 10 });
    assert.equal(preview.renderer.renderCount, 0);
    assert.equal(poses.length, 0);
    assert.equal(cosmetics.length, 0);
    assert.equal(preview.renderer.size, undefined);
    assert.equal(preview._yaw, Math.PI, 'inactive input cannot change the saved view');
    preview.start();
    assert.equal(preview.renderer.renderCount, 1);
    assert.equal(poses.length, 1);
    assert.deepEqual(preview.renderer.size, { width: 800, height: 500 });
    assert.equal(preview.renderer.loop, null);
    assert.ok(poseSnapshot(preview).every(value => value === 0));
});

test('visibility and stop discard stale callbacks, release dragging and resume without catch-up', t => {
    const { preview, canvas, document, media, window, observers, poses } = setup(t);
    preview.start();
    step(preview);
    const phase = preview._elapsed;
    const staleFrame = preview.renderer.loop;
    canvas.dispatch('pointerdown', { pointerId: 3, clientX: 1, clientY: 2 });
    document.hidden = true;
    document.dispatch('visibilitychange');
    const drawCount = preview.renderer.renderCount;
    const poseCount = poses.length;
    const lastSize = preview.renderer.size;
    assert.equal(canvas.captured.size, 0);
    assert.equal(preview.renderer.loop, null);
    staleFrame(1_000_000);
    preview.resize(900, 400);
    window.dispatch('resize');
    observers[0].callback();
    preview.refreshTheme();
    preview.setAccent('#345678');
    preview.sync({ skinId: 'frost' });
    media.matches = true;
    media.dispatch('change', { matches: true });
    canvas.dispatch('keydown', { key: 'ArrowRight' });
    assert.equal(preview.renderer.renderCount, drawCount);
    assert.equal(poses.length, poseCount);
    assert.equal(preview.renderer.size, lastSize);
    assert.equal(preview._elapsed, phase);
    document.hidden = false;
    document.dispatch('visibilitychange');
    assert.equal(preview.renderer.renderCount, drawCount + 1, 'static mode also redraws on visibility return');
    assert.ok(poseSnapshot(preview).every(value => value === 0));
    assert.equal(preview.renderer.loop, null);
    media.matches = false;
    media.dispatch('change', { matches: false });
    preview.renderer.loop(2_000_000);
    assert.equal(preview._elapsed, phase);
    canvas.dispatch('pointerdown', { pointerId: 4, clientX: 1, clientY: 2 });
    preview.stop();
    assert.equal(canvas.captured.size, 0);
    const stoppedDraws = preview.renderer.renderCount;
    const stoppedPoses = poses.length;
    staleFrame(3_000_000);
    preview.resetView();
    preview.resize(450, 700);
    assert.equal(preview.renderer.renderCount, stoppedDraws);
    assert.equal(poses.length, stoppedPoses);
    preview.start();
    preview.renderer.loop(4_000_000);
    assert.equal(preview._elapsed, phase);
    assert.deepEqual(preview.renderer.size, { width: 450, height: 700 });
});

test('frame-limited previews evaluate poses and cosmetics only for actual draws in every mode', t => {
    for (const mode of SHOWCASE_ANIMATIONS) {
        const { preview, poses, cosmetics } = setup(t);
        preview.setAnimation(mode);
        preview.setFrameLimit(30);
        preview.start();
        poses.length = 0;
        cosmetics.length = 0;
        preview.renderer.renderCount = 0;
        for (let frame = 0; frame < 240; frame++) preview.renderer.loop(frame * 1000 / 240);
        assert.equal(preview.renderer.renderCount, 30, `${mode}: 30 draws at 240 Hz`);
        assert.equal(poses.length, 30, `${mode}: no pose allocations on skipped frames`);
        assert.equal(cosmetics.length, 30, `${mode}: no cosmetic work on skipped frames`);
    }
});

test('Unlimited (0) draws at the decorative ceiling and visibly advances Run within 120ms', t => {
    for (const fps of [0, '0']) {
        for (const sourceHz of [60, 144, 240]) {
            const { preview, poses, cosmetics } = setup(t);
            preview.setFrameLimit(fps);
            preview.setAnimation('run');
            preview.start();
            poses.length = 0;
            cosmetics.length = 0;
            preview.renderer.renderCount = 0;
            preview.renderer.loop(0);
            const firstPose = poseSnapshot(preview);
            const earlyFrames = Math.floor(.12 * sourceHz);
            for (let frame = 1; frame <= earlyFrames; frame++) preview.renderer.loop(frame * 1000 / sourceHz);
            assert.notDeepEqual(poseSnapshot(preview), firstPose, `Unlimited at ${sourceHz} Hz must not freeze the visible Run pose`);
            assert.ok(Math.abs(preview.avatar.rig.joints.hipL.rotation.x) > .2);
            for (let frame = earlyFrames + 1; frame < sourceHz; frame++) preview.renderer.loop(frame * 1000 / sourceHz);
            assert.equal(preview.renderer.renderCount, 60, 'Unlimited retains the 60 FPS decorative budget');
            assert.equal(poses.length, 60);
            assert.equal(cosmetics.length, 60);
        }
    }
});

test('an explicit 1 FPS cap stays distinct from Unlimited and changing caps resets its draw deadline', t => {
    for (const fps of [1, '1']) {
        const { preview, poses } = setup(t);
        assert.equal(preview.setFrameLimit(fps), 1);
        preview.setAnimation('run');
        preview.start();
        preview.renderer.renderCount = 0;
        poses.length = 0;
        step(preview, 60);
        assert.equal(preview.renderer.renderCount, 1);
        assert.equal(poses.length, 1, 'an intentional slow cap also limits pose evaluations');
        const phase = preview._elapsed;
        assert.equal(preview.setFrameLimit(0), 60);
        assert.equal(preview.renderer.renderCount, 1, 'setting a budget does not draw or create another loop');
        preview.renderer.loop(1000);
        assert.equal(preview._elapsed, phase, 'the new cadence does not absorb a clock gap');
        assert.equal(preview.renderer.renderCount, 2, 'the old one-second deadline cannot delay the new budget');
        preview.renderer.loop(1000 + 1000 / 60);
        assert.equal(preview.renderer.renderCount, 3);
        preview.setReducedMotion(true);
        preview.setFrameLimit(0);
        assert.equal(preview.renderer.loop, null, 'Unlimited cannot override reduced motion');
    }
});

test('missing or nonpositive FPS settings use the decorative default while positive caps retain their bounds', t => {
    const { preview } = setup(t);
    for (const value of [undefined, null, '', NaN, Infinity, -Infinity, -30, 'invalid']) {
        assert.equal(preview.setFrameLimit(value), 60);
    }
    for (const [value, expected] of [[.5, 1], [1, 1], [30, 30], [30.9, 30], [60, 60], [144, 60]]) {
        assert.equal(preview.setFrameLimit(value), expected);
    }
    assert.equal(preview.renderer.renderCount, 0, 'configuration never starts a stopped preview');
});

test('large stalls have bounded motion, invalid/backwards timestamps are ignored, and repeated start keeps time', t => {
    const { preview } = setup(t);
    preview.start();
    preview.renderer.loop(0);
    preview.renderer.loop(1e12);
    assert.ok(preview._elapsed > 0 && preview._elapsed <= .05);
    assert.ok(preview.avatar.root.rotation.y - Math.PI <= .05 * .18 + 1e-12);
    assert.ok(Number.isFinite(preview._nextDrawAt) && preview._nextDrawAt > 1e12);
    const phase = preview._elapsed;
    const draws = preview.renderer.renderCount;
    for (const time of [NaN, Infinity, -Infinity, -1, 'bad', 1]) preview.renderer.loop(time);
    assert.equal(preview._elapsed, phase);
    assert.equal(preview.renderer.renderCount, draws);
    const loop = preview.renderer.loop;
    preview.start();
    assert.equal(preview.renderer.loop, loop, 'one renderer retains one animation callback');
    preview.renderer.loop(1e12 + 1000 / 60);
    assert.ok(preview._elapsed > phase, 'an idempotent start does not reset the running clock');
});

test('a second pointer cannot hijack a drag and lost capture makes later movement inert', t => {
    const { preview, canvas } = setup(t);
    preview.start();
    preview.setAutoRotate(false);
    const pointerStorage = preview._lastPointer;
    canvas.dispatch('pointerdown', { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    canvas.dispatch('pointerdown', { pointerId: 2, clientX: 500, clientY: 10, button: 0 });
    canvas.dispatch('pointermove', { pointerId: 2, clientX: 550, clientY: 30 });
    canvas.dispatch('pointerup', { pointerId: 2 });
    assert.equal(preview.avatar.root.rotation.y, Math.PI);
    assert.equal(preview._dragging, true);
    canvas.dispatch('pointermove', { pointerId: 1, clientX: 30, clientY: 20 });
    const yaw = preview.avatar.root.rotation.y;
    assert.ok(yaw > Math.PI);
    assert.equal(preview._lastPointer, pointerStorage, 'drag storage is reused');
    canvas.captured.delete(1);
    canvas.dispatch('lostpointercapture', { pointerId: 1 });
    canvas.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
    canvas.dispatch('pointerup', { pointerId: 1 });
    assert.equal(preview._dragging, false);
    assert.equal(preview.avatar.root.rotation.y, yaw);
    assert.equal(canvas.released.length, 0, 'lost capture must not be released twice');
});

test('capture failures, cancellation, window blur and missing capture APIs cannot leave a stuck drag', t => {
    const { preview, canvas, window } = setup(t);
    preview.start();
    const down = () => canvas.dispatch('pointerdown', { pointerId: 1, clientX: 1, clientY: 1 });
    canvas.captureThrows = true;
    assert.doesNotThrow(down);
    assert.equal(preview._dragging, false);
    canvas.captureThrows = false;
    down();
    canvas.releaseThrows = true;
    assert.doesNotThrow(() => canvas.dispatch('pointercancel', { pointerId: 1 }));
    assert.equal(preview._dragging, false);
    canvas.releaseThrows = false;
    down();
    window.dispatch('blur');
    assert.equal(preview._dragging, false);
    canvas.setPointerCapture = undefined;
    canvas.hasPointerCapture = undefined;
    canvas.releasePointerCapture = undefined;
    down();
    window.dispatch('pointerup', { pointerId: 1 });
    assert.equal(preview._dragging, false, 'window release covers a pointer finishing outside the canvas');
    canvas.dispatch('pointerdown', { pointerId: 2, clientX: 1, clientY: 1, button: 2 });
    assert.equal(preview._dragging, false, 'right click is not a rotate gesture');
    canvas.dispatch('pointerdown', { pointerId: 3, clientX: 1, clientY: 1, isPrimary: false });
    assert.equal(preview._dragging, false);
});

test('owned-canvas keyboard events rotate once when bubbling and restore mount accessibility on disposal', t => {
    const { preview, canvas, mount } = setup(t, { container: true });
    preview.start();
    preview.setAutoRotate(false);
    const event = canvas.dispatch('keydown', { key: 'ArrowRight' });
    const yaw = preview.avatar.root.rotation.y;
    mount.dispatch('keydown', event);
    assert.equal(preview.avatar.root.rotation.y, yaw, 'bubbling does not apply a second rotation');
    mount.dispatch('keydown', { key: 'ArrowRight' });
    assert.ok(preview.avatar.root.rotation.y > yaw, 'the focusable mount remains a keyboard alternative');
    assert.equal(mount.getAttribute('tabindex'), '0');
    preview.dispose();
    assert.equal(mount.children.length, 0);
    assert.equal(mount.getAttribute('tabindex'), null);
});

test('dispose removes listeners and observers, releases capture once and makes queued callbacks inert', t => {
    const { preview, canvas, document, media, window, observers, poses } = setup(t);
    preview.start();
    preview.setAnimation('celebrate');
    const staleFrame = preview.renderer.loop;
    const resources = new Set(preview._environmentResources);
    preview.avatar.root.traverse(node => {
        if (node.geometry) resources.add(node.geometry);
        if (node.material) resources.add(node.material);
    });
    canvas.dispatch('pointerdown', { pointerId: 9, clientX: 10, clientY: 10 });
    preview.dispose();
    const poseCount = poses.length;
    const drawCount = preview.renderer.renderCount;
    assert.deepEqual(canvas.released, [9]);
    assert.equal(preview.renderer.loop, null);
    assert.equal(preview.renderer.disposed, true);
    for (const target of [canvas, document, media, window]) {
        for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
    }
    assert.ok(observers.every(observer => observer.disconnected));
    for (const resource of resources) assert.equal(resource.disposeCalls, 1);
    assert.doesNotThrow(() => {
        staleFrame(10_000);
        observers[0].callback();
        preview.setAnimation('run');
        preview.setAutoRotate(false);
        preview.setReducedMotion(true);
        preview.refreshTheme();
        preview.avatar.setPoseTime(5, false, 'run');
        preview.stop();
        preview.dispose();
    });
    assert.equal(preview.start(), false);
    assert.equal(preview.resetView(), false);
    assert.equal(preview.resize(), false);
    assert.equal(preview.animation, 'celebrate');
    assert.equal(poses.length, poseCount);
    assert.equal(preview.renderer.renderCount, drawCount);
    for (const resource of resources) assert.equal(resource.disposeCalls, 1);
});
