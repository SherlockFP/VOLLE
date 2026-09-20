import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : nextResolve(specifier, context);
    }
});
const THREE = await import(threeUrl);
const { Player } = await import('../js/player.js');

function dispatch(target, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) {
        Object.defineProperty(event, key, { value });
    }
    target.dispatchEvent(event);
    return event;
}

function harness(t) {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const document = new EventTarget();
    const window = new EventTarget();
    const canvas = { tagName: 'CANVAS' };
    document.activeElement = canvas;
    document.pointerLockElement = null;
    document.hidden = false;
    document.body = { classList: { contains: () => false } };
    window.matchMedia = () => ({ matches: false });
    canvas.requestPointerLock = () => {
        document.pointerLockElement = canvas;
        dispatch(document, 'pointerlockchange');
    };
    document.exitPointerLock = () => {
        document.pointerLockElement = null;
        dispatch(document, 'pointerlockchange');
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    t.after(() => {
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    });

    const renderer = {
        scene: new THREE.Scene(),
        domElement: canvas,
        createToonMaterial: color => new THREE.MeshBasicMaterial({ color })
    };
    const arena = {
        bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40, maxY: 30 },
        config: {}, collidables: [], platforms: [], jumpPads: []
    };
    const player = new Player(renderer, new THREE.PerspectiveCamera(75, 1, 0.1, 100), arena);
    player.game = { state: 'PLAYING', ui: { spectating: false }, ball: { _warmup: false } };
    t.after(() => {
        player.cleanupInput();
        const resources = new Set();
        player.armGroup.traverse(node => {
            if (node.geometry) resources.add(node.geometry);
            for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                if (material) resources.add(material);
            }
        });
        for (const resource of resources) resource.dispose();
        player.armGroup.removeFromParent();
    });
    const key = (code, type = 'keydown', target = document.activeElement) => dispatch(document, type, { code, target, repeat: false });
    const mouse = (button, type = 'mousedown', target = canvas) => dispatch(document, type, { button, target });
    const focus = target => {
        document.activeElement = target;
        dispatch(document, 'focusin', { target });
    };
    return { player, document, window, canvas, key, mouse, focus };
}

function queueInputs({ player, key, mouse }) {
    for (const code of ['KeyA', 'KeyD', 'Space', 'ControlLeft', 'KeyQ']) key(code);
    mouse(0);
    player.charId = 'soldier';
    mouse(2);
    assert.equal(player._deflectHeld, true);
    assert.equal(player._skillQueued, true);
    assert.equal(player._rocketQueued, true);
}

function assertReleased(player) {
    assert.ok(Object.values(player.keys).every(value => value === false), 'held keys are released');
    assert.equal(player._deflectHeld, false, 'old mouse hold cannot keep charging');
    assert.equal(player._skillQueued, false, 'old Q press cannot activate after returning');
    assert.equal(player._rocketQueued, false, 'old secondary press cannot fire after returning');
    assert.equal(player._jumpHeld, false);
    assert.equal(player._dashWasDown, false);
    assert.equal(player._longJumpWasDown, false);
    assert.equal(player.didSpinDodge(), false);
}

test('chat focus clears prior gameplay holds even when pointer lock is unavailable', t => {
    const h = harness(t);
    h.key('KeyW');
    h.player.update(1 / 60);
    assert.ok(h.player.horizontalSpeed > 0, 'real update accelerates from the real key event');
    queueInputs(h);
    const momentum = h.player.velocity.clone();
    const stamina = h.player.stamina;
    const cooldown = h.player.attackCooldown;

    // main.openChat() unlocks then focuses an input without pausing the game.
    h.player.unlock();
    h.focus({ tagName: 'INPUT', id: 'chat-input' });
    assertReleased(h.player);
    assert.deepEqual(h.player.velocity, momentum, 'focus loss must not erase physical momentum');
    assert.equal(h.player.stamina, stamina, 'accepted actions are not refunded');
    assert.equal(h.player.attackCooldown, cooldown, 'accepted action timing stays intact');
    h.player.update(1 / 60);
    assert.ok(h.player.horizontalSpeed < Math.hypot(momentum.x, momentum.z), 'released W coasts under normal friction');
    assert.equal(h.player.onGround, true, 'queued Space never becomes a jump in chat');
    assert.equal(h.player.dashTimer, 0, 'queued Ctrl never becomes a dash in chat');

    h.key('KeyW');
    h.key('Space');
    h.key('KeyQ');
    assertReleased(h.player);
    h.focus(h.canvas);
    h.key('Space');
    h.player.update(1 / 60);
    assert.equal(h.player.onGround, false, 'a fresh gameplay press still jumps normally');
    assert.equal(h.player.jumpsRemaining, 1);
});

test('losing an owned pointer lock clears holds but preserves an already accepted dash', t => {
    const h = harness(t);
    h.player.lock();
    assert.equal(h.player.locked, true);
    h.key('ControlLeft');
    h.player.update(1 / 60);
    assert.equal(h.player.dashTimer, h.player.dashDuration, 'Ctrl started its normal dash');
    queueInputs(h);
    const remaining = h.player.dashTimer;
    const cooldown = h.player.dashCooldown;
    const stamina = h.player.stamina;
    h.player.unlock();

    assert.equal(h.player.locked, false);
    assertReleased(h.player);
    assert.equal(h.player.dashTimer, remaining, 'lock loss cannot cancel the accepted 120ms dash');
    assert.equal(h.player.dashCooldown, cooldown);
    assert.equal(h.player.stamina, stamina);
    h.player.update(1 / 60);
    assert.ok(Math.abs(h.player.dashTimer - (remaining - 1 / 60)) < 1e-9);
    assert.equal(h.player.onGround, true);
});

test('lock acquisition and unrelated lock events leave optional-lock gameplay responsive', t => {
    const h = harness(t);
    h.key('KeyW');
    dispatch(h.document, 'pointerlockchange');
    assert.equal(h.player.keys.KeyW, true, 'an already-unlocked canvas can still move');
    h.player.lock();
    assert.equal(h.player.keys.KeyW, true, 'acquiring the lock does not lose an active press');
    dispatch(h.document, 'pointerlockchange');
    assert.equal(h.player.keys.KeyW, true, 'unchanged lock ownership does not clear input');
    h.player.update(1 / 60);
    assert.ok(h.player.horizontalSpeed > 0);
    h.player.unlock();
    h.key('KeyW');
    h.mouse(0);
    assert.equal(h.player.keys.KeyW, true, 'new movement works without reacquiring pointer lock');
    assert.equal(h.player._deflectHeld, true, 'new primary input works without pointer lock');
});

test('all editable focus targets clear held inputs while non-editable focus preserves them', t => {
    const h = harness(t);
    const inputs = [
        { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' },
        { tagName: 'DIV', isContentEditable: true },
        { tagName: 'SPAN', closest: () => ({ isContentEditable: true }) }
    ];
    for (const input of inputs) {
        h.focus(h.canvas);
        h.key('KeyW');
        h.focus(input);
        assert.equal(h.player.keys.KeyW, false, `${input.tagName}: no stale movement`);
    }
    h.focus(h.canvas);
    h.key('KeyW');
    h.focus({ tagName: 'DIV' });
    assert.equal(h.player.keys.KeyW, true, 'ordinary canvas-wrapper focus does not interrupt movement');
});

test('blur and hidden-page transitions retain unconditional input release', t => {
    const h = harness(t);
    queueInputs(h);
    dispatch(h.window, 'blur');
    assertReleased(h.player);
    queueInputs(h);
    h.document.hidden = true;
    dispatch(h.document, 'visibilitychange');
    assertReleased(h.player);
    h.document.hidden = false;
    h.key('KeyW');
    dispatch(h.document, 'visibilitychange');
    assert.equal(h.player.keys.KeyW, true, 'becoming visible is not another input reset');
});

test('keyup and mouseup release holds even when their event targets are text fields', t => {
    const h = harness(t);
    h.key('KeyW');
    h.mouse(0);
    h.key('KeyW', 'keyup', { tagName: 'INPUT' });
    h.mouse(0, 'mouseup', { tagName: 'TEXTAREA' });
    assert.equal(h.player.keys.KeyW, false);
    assert.equal(h.player._deflectHeld, false);
});

test('cleanup aborts focus and lock listeners with the existing input listener lifetime', t => {
    const h = harness(t);
    h.player.lock();
    h.key('KeyW');
    h.player.cleanupInput();
    h.focus({ tagName: 'INPUT' });
    h.player.unlock();
    h.key('KeyW', 'keyup');
    h.key('Space', 'keydown', h.canvas);
    assert.equal(h.player.keys.KeyW, true, 'disposed controller no longer receives events');
    assert.equal(h.player.keys.Space, undefined);
    assert.equal(h.player.locked, true, 'disposed controller is no longer mutated by document lock changes');
});
