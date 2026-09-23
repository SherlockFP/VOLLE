// tests/item-thumbnails.test.mjs — real 3D item thumbnails + the 3D case reveal stage.
// Uses the REAL vendored Three.js (geometry/bounds math runs fine in Node) with the
// WebGLRenderer replaced by a stub, so framing is checked against the actual game
// models while nothing needs a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';

const THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
        return nextResolve(specifier, context);
    }
});

const THREE = await import(THREE_URL);
const Thumbs = await import('../js/item-thumbnails.js');
const Reveal = await import('../js/case-reveal-3d.js');
const { KNIVES, getCaseDropRates, rollCase } = await import('../js/cosmetics.js');

const {
    ThumbnailLRU, ThumbnailService, describeThumbnailItem, fitCameraDistance, frameSubject,
    buildThumbnailSubject, subjectBounds, thumbnailCacheKey, THUMBNAIL_POSES, insertThumbnail
} = Thumbs;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function stubRenderer() {
    const canvas = {
        className: '', removed: false, listeners: {},
        setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; }, remove() { this.removed = true; }
    };
    return {
        domElement: canvas, renders: 0, disposed: 0, lost: 0, compiles: 0,
        render() { this.renders++; },
        compileAsync() { this.compiles++; return Promise.resolve(); },
        dispose() { this.disposed++; },
        forceContextLoss() { this.lost++; },
        setPixelRatio() {}, setSize() {}
    };
}

function manualScheduler() {
    const pending = [];
    const schedule = callback => {
        pending.push(callback);
        return () => { const i = pending.indexOf(callback); if (i !== -1) pending.splice(i, 1); };
    };
    schedule.pending = pending;
    schedule.flush = async (rounds = 60) => {
        for (let i = 0; i < rounds && pending.length; i++) {
            const callback = pending.shift();
            callback({ didTimeout: false, timeRemaining: () => 50 });
            await new Promise(resolve => setImmediate(resolve));
        }
    };
    return schedule;
}

function fakeElement(doc) {
    const children = [];
    const classes = new Set();
    return {
        ownerDocument: doc, isConnected: true, dataset: {}, children,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        appendChild(child) { children.push(child); return child; },
        querySelector() { return children.find(child => child.className?.includes('item-thumb')) || null; }
    };
}

const fakeDocument = {
    createElement: () => ({ className: '', src: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === 'src' ? this.src : this.attrs[k]; } })
};

function trackingBuilder() {
    const log = { built: [], disposed: [] };
    const build = desc => {
        log.built.push(desc.id);
        const object = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), new THREE.MeshBasicMaterial());
        return { object, dispose: () => { log.disposed.push(desc.id); object.geometry.dispose(); } };
    };
    return { build, log };
}

function projectedExtent(object, camera) {
    const box = subjectBounds(object, new THREE.Box3());
    let maxX = 0; let maxY = 0;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        corner.project(camera);
        maxX = Math.max(maxX, Math.abs(corner.x));
        maxY = Math.max(maxY, Math.abs(corner.y));
    }
    return { maxX, maxY };
}

// ---------------------------------------------------------------------------
// LRU
// ---------------------------------------------------------------------------
test('ThumbnailLRU evicts least-recently-used entries and reports each eviction', () => {
    const evicted = [];
    const lru = new ThumbnailLRU(3, (value, key) => evicted.push(key));
    lru.set('a', 1); lru.set('b', 2); lru.set('c', 3);
    assert.equal(lru.get('a'), 1, 'get refreshes recency');
    lru.set('d', 4);
    assert.deepEqual(evicted, ['b'], 'oldest untouched entry goes first');
    assert.equal(lru.size, 3);
    assert.deepEqual(lru.keys(), ['c', 'a', 'd']);
    lru.set('a', 5);
    assert.deepEqual(evicted, ['b', 'a'], 'replacing a value releases the old one');
    assert.equal(lru.clear(), 3);
    assert.equal(lru.size, 0);
    assert.deepEqual(evicted.slice(2).sort(), ['a', 'c', 'd']);
});

test('cache keys carry kind, id, version and size so a look change never serves stale art', () => {
    assert.equal(thumbnailCacheKey('knife', 'fade', 256, 1), 'knife:fade:v1:256');
    assert.notEqual(thumbnailCacheKey('knife', 'fade', 256, 1), thumbnailCacheKey('knife', 'fade', 256, 2));
    assert.notEqual(thumbnailCacheKey('knife', 'fade', 128), thumbnailCacheKey('knife', 'fade', 256));
});

// ---------------------------------------------------------------------------
// descriptors
// ---------------------------------------------------------------------------
test('describeThumbnailItem resolves every shape the UI passes', () => {
    assert.equal(describeThumbnailItem({ id: 'fade' }, 'knife').kind, 'knife');
    assert.equal(describeThumbnailItem(KNIVES.fade).kind, 'knife', 'KNIVES entries carry no type');
    assert.equal(describeThumbnailItem({ id: 'magma', type: 'ball' }).kind, 'ball');
    assert.equal(describeThumbnailItem({ id: 'neon' }, 'avatar').kind, 'avatar');
    // Rolled cosmetic rewards arrive as type 'cosmetic' — the real slot comes from the catalog.
    assert.equal(describeThumbnailItem({ id: 'gloves_supernova', type: 'cosmetic' }).kind, 'glove');
    assert.equal(describeThumbnailItem({ id: 'gloves_supernova', type: 'gloves' }).kind, 'glove');
    assert.equal(describeThumbnailItem({ id: 'cape_royal', type: 'cosmetic' }).kind, 'wearable');
    assert.equal(describeThumbnailItem({ id: 'impact_fire', type: 'cosmetic' }), null, 'no 3D model → caller fallback');
    assert.equal(describeThumbnailItem({ id: 'nope', type: 'knife' }), null);
    assert.equal(describeThumbnailItem(null), null);
    assert.equal(describeThumbnailItem({ id: 'fade', rarity: 'epic' }, 'knife').rarity, 'epic', 'explicit rarity wins');
});

test('every case drop and every rolled reward maps to a thumbnail or a deliberate fallback', () => {
    for (const caseId of ['kickoff', 'chroma', 'arsenal', 'elemental', 'companions', 'mythic', 'gloves', 'blades']) {
        for (const drop of getCaseDropRates(caseId)) {
            const desc = describeThumbnailItem(drop, drop.type);
            if (drop.type === 'cosmetic' && /^(impact|finisher)_/.test(drop.id)) assert.equal(desc, null, drop.id);
            else assert.ok(desc, `${caseId}:${drop.id} should resolve to a 3D thumbnail`);
        }
        const reward = rollCase(caseId, () => 0.5);
        if (reward && !/^(impact|finisher)_/.test(reward.id)) assert.ok(describeThumbnailItem(reward, reward.type), `${caseId} rolled reward resolves`);
    }
});

// ---------------------------------------------------------------------------
// framing math
// ---------------------------------------------------------------------------
test('fitCameraDistance keeps a box inside the frustum, growing with margin and narrow aspect', () => {
    const size = new THREE.Vector3(2, 1, 0.5);
    const d = fitCameraDistance(size, 30, 1, 1);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
    const { maxX, maxY } = projectedExtent(mesh, camera);
    assert.ok(maxX <= 1.0001 && maxY <= 1.0001, `box fits (x ${maxX}, y ${maxY})`);
    assert.ok(maxX > 0.95, 'and fills the limiting axis');
    assert.ok(fitCameraDistance(size, 30, 1, 1.3) > d);
    assert.ok(fitCameraDistance(size, 30, 0.5, 1) > d);
    assert.ok(Number.isFinite(fitCameraDistance({ x: 0, y: 0, z: 0 })), 'degenerate input stays finite');
});

test('every item type has its own hero pose and frames the real model tightly', () => {
    const poses = new Set(Object.values(THUMBNAIL_POSES).map(p => `${p.x}|${p.y}|${p.z}|${p.order}`));
    assert.equal(poses.size, Object.keys(THUMBNAIL_POSES).length, 'poses are distinct per type');
    const samples = [
        [{ id: 'fade' }, 'knife'], [{ id: 'aurora' }, 'knife'], [{ id: 'kukri_void' }, 'knife'],
        [{ id: 'gloves_supernova' }, 'cosmetic'], [{ id: 'magma' }, 'ball'], [{ id: 'shuriken' }, 'ball'],
        [{ id: 'neon' }, 'avatar'], [{ id: 'pet_dragon' }, 'cosmetic']
    ];
    for (const [item, hint] of samples) {
        const desc = describeThumbnailItem(item, hint);
        const subject = buildThumbnailSubject(desc);
        assert.ok(subject?.object, `${item.id} builds`);
        const pivot = new THREE.Group();
        const camera = new THREE.PerspectiveCamera();
        const distance = frameSubject(pivot, subject.object, camera, desc.kind);
        assert.ok(distance > 0 && Number.isFinite(distance), `${item.id} distance`);
        camera.updateMatrixWorld(true);
        const centre = subjectBounds(pivot, new THREE.Box3()).getCenter(new THREE.Vector3());
        assert.ok(centre.length() < 1e-6 + distance * 1e-3, `${item.id} is centred`);
        const { maxX, maxY } = projectedExtent(pivot, camera);
        assert.ok(Math.max(maxX, maxY) <= 1.0001, `${item.id} fits the frame`);
        assert.ok(Math.max(maxX, maxY) > 0.7, `${item.id} fills the frame (${Math.max(maxX, maxY).toFixed(2)})`);
        subject.dispose();
    }
});

test('knife subjects carry the viewmodel rarity rim; dispose frees it and the knife', () => {
    const desc = describeThumbnailItem({ id: 'fade' }, 'knife');
    const subject = buildThumbnailSubject(desc);
    const rims = [];
    subject.object.traverse(child => { if (child.name === 'viewmodel-rim') rims.push(child); });
    assert.ok(rims.length > 0, 'legendary knife thumbnail shows the rarity rim');
    let disposed = 0;
    subject.object.traverse(child => {
        if (child.isMesh && child.name !== 'viewmodel-rim') {
            const original = child.geometry.dispose.bind(child.geometry);
            child.geometry.dispose = () => { disposed++; original(); };
        }
    });
    subject.dispose();
    assert.ok(disposed > 0, 'knife geometry is released');
    assert.equal(subject.object.parent, null);
});

test('ball model skins never dispose the shared ball.js shape geometry', async () => {
    const { ballShapeParts } = await import('../js/ball.js');
    const desc = describeThumbnailItem({ id: 'shuriken' }, 'ball');
    const shared = ballShapeParts('shuriken', 0.43, THREE).map(part => part.geo);
    let sharedDisposed = 0;
    for (const geo of shared) geo.addEventListener('dispose', () => sharedDisposed++);
    const subject = buildThumbnailSubject(desc);
    subject.dispose();
    assert.equal(sharedDisposed, 0);
});

// ---------------------------------------------------------------------------
// service: queue, idle pump, cache, dispose, fallback
// ---------------------------------------------------------------------------
test('service renders in idle slots, dedupes requests, disposes each subject and caches the URL', async () => {
    const renderer = stubRenderer();
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    let encodes = 0;
    const service = new ThumbnailService({
        createRenderer: () => renderer, buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => `data:image/webp;base64,${++encodes}`
    });
    const a = service.request({ id: 'fade' }, 'knife');
    const b = service.request({ id: 'fade' }, 'knife');
    assert.equal(renderer.renders, 0, 'nothing renders synchronously');
    await scheduler.flush();
    const [urlA, urlB] = await Promise.all([a, b]);
    assert.equal(urlA, 'data:image/webp;base64,1');
    assert.equal(urlB, urlA, 'both waiters share one render');
    assert.deepEqual(log.built, ['fade']);
    assert.deepEqual(log.disposed, ['fade'], 'subject disposed right after its render');
    assert.equal(renderer.compiles, 1, 'shaders compile asynchronously before the render');
    assert.equal(await service.request({ id: 'fade' }, 'knife'), urlA, 'cache hit');
    assert.equal(log.built.length, 1, 'cache hit builds nothing');
    assert.equal(service.pendingCount, 0);
    service.dispose();
});

test('each idle slot runs a bounded number of steps', async () => {
    const renderer = stubRenderer();
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    const service = new ThumbnailService({
        createRenderer: () => renderer, buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => 'data:x', maxStepsPerIdle: 2
    });
    for (const id of ['fade', 'aurora', 'sherlock', 'doppler']) service.request({ id }, 'knife');
    const callback = scheduler.pending.shift();
    callback({ didTimeout: false, timeRemaining: () => 50 });
    assert.ok(log.built.length <= 1, 'one build per slot; its render waits for the async compile');
    const low = new ThumbnailService({
        createRenderer: () => stubRenderer(), buildSubject: build, scheduler: manualScheduler(), probe: () => true,
        createEnvironment: () => null, encode: () => 'data:x'
    });
    low._enqueue(describeThumbnailItem({ id: 'fade' }, 'knife'), 'k', { resolve() {} }, false);
    const before = log.built.length;
    low._pump({ didTimeout: false, timeRemaining: () => 1 });
    assert.equal(log.built.length, before, 'no work starts in an idle slot with no budget left');
    service.dispose();
    low.dispose();
});

test('priority batches render in their own order, ahead of normal work', async () => {
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    const service = new ThumbnailService({
        createRenderer: () => stubRenderer(), buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => 'data:x'
    });
    service.request({ id: 'training' }, 'knife');
    const chase = ['sherlock', 'doppler', 'fade'];
    await Promise.all([...chase.map(id => service.request({ id }, 'knife', { priority: true })), scheduler.flush(200)]);
    assert.deepEqual(log.built.slice(0, 3), chase, 'chase items first, in the order asked');
    assert.equal(log.built[3], 'training');
    service.dispose();
});

test('the thumbnail cache is bounded (LRU) across many items', async () => {
    const scheduler = manualScheduler();
    const { build } = trackingBuilder();
    let n = 0;
    const service = new ThumbnailService({
        createRenderer: () => stubRenderer(), buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => `data:${n++}`, limit: 4
    });
    const ids = Object.keys(KNIVES).slice(0, 9);
    const all = ids.map(id => service.request({ id }, 'knife'));
    await scheduler.flush(200);
    await Promise.all(all);
    assert.equal(service.cache.size, 4);
    assert.deepEqual(service.cache.keys(), ids.slice(-4).map(id => thumbnailCacheKey('knife', id)));
    service.dispose();
});

test('dispose tears down the renderer, releases the context and settles pending work', async () => {
    const renderer = stubRenderer();
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    const service = new ThumbnailService({
        createRenderer: () => renderer, buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => 'data:x'
    });
    const first = service.request({ id: 'fade' }, 'knife');
    await scheduler.flush();
    await first;
    const pending = service.request({ id: 'aurora' }, 'knife');
    scheduler.pending.shift()?.({ didTimeout: false, timeRemaining: () => 50 }); // aurora mid-compile
    service.dispose();
    assert.equal(await pending, null);
    assert.equal(renderer.disposed, 1);
    assert.equal(renderer.lost, 1, 'WebGL context is released');
    assert.equal(service.cache.size, 0);
    assert.deepEqual(log.disposed.sort(), log.built.sort(), 'every built subject was disposed');
    assert.equal(await service.request({ id: 'fade' }, 'knife'), null, 'a disposed service yields nothing');
});

test('no WebGL: requests resolve null, attach reports false and leaves the fallback art alone', async () => {
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    const broken = new ThumbnailService({
        createRenderer: () => { throw new Error('Error creating WebGL context.'); },
        buildSubject: build, scheduler, probe: () => true, createEnvironment: () => null
    });
    const container = fakeElement(fakeDocument);
    assert.equal(broken.attach(container, { id: 'fade' }, 'knife', { lazy: false }), true, 'context creation is deferred to idle');
    const result = broken.request({ id: 'aurora' }, 'knife');
    await scheduler.flush();
    assert.equal(await result, null);
    assert.equal(broken.supported, false);
    assert.equal(container.dataset.thumb, 'fallback');
    assert.equal(container.children.length, 0, 'orb/icon untouched');
    assert.equal(broken.attach(fakeElement(fakeDocument), { id: 'fade' }, 'knife'), false);
    assert.equal(log.built.length, 0, 'no subject is built without a renderer');

    const noGl = new ThumbnailService({ probe: () => false, scheduler });
    const untouched = fakeElement(fakeDocument);
    assert.equal(noGl.attach(untouched, { id: 'fade' }, 'knife'), false);
    assert.deepEqual(untouched.dataset, {});
    assert.equal(await noGl.request({ id: 'fade' }, 'knife'), null);
});

test('attach inserts the image when ready; tiles that left the DOM are skipped', async () => {
    const scheduler = manualScheduler();
    const { build, log } = trackingBuilder();
    const service = new ThumbnailService({
        createRenderer: () => stubRenderer(), buildSubject: build, scheduler, probe: () => true,
        createEnvironment: () => null, encode: () => 'data:image/webp;base64,AA'
    });
    const live = fakeElement(fakeDocument);
    const gone = fakeElement(fakeDocument);
    service.attach(live, { id: 'fade' }, 'knife', { lazy: false });
    service.attach(gone, { id: 'aurora' }, 'knife', { lazy: false });
    gone.isConnected = false; // shop re-rendered before the idle slot came
    await scheduler.flush();
    assert.equal(live.dataset.thumb, 'ready');
    assert.ok(live.classList.contains('has-item-thumb'));
    assert.equal(live.children[0].src, 'data:image/webp;base64,AA');
    assert.deepEqual(log.built, ['fade'], 'detached tile costs no render');
    assert.equal(service.stats.skipped, 1);
    // Cached → synchronous insert, no second image element.
    service.attach(live, { id: 'fade' }, 'knife');
    assert.equal(live.children.length, 1);
    service.dispose();
});

test('insertThumbnail is idempotent', () => {
    const el = fakeElement(fakeDocument);
    insertThumbnail(el, 'data:a', 'k');
    insertThumbnail(el, 'data:b', 'k');
    assert.equal(el.children.length, 1);
    assert.equal(el.children[0].src, 'data:b');
});

// ---------------------------------------------------------------------------
// 3D reveal stage
// ---------------------------------------------------------------------------
test('reveal profile: reduced motion = static hero shot; OS preference keeps spin but no particles', () => {
    const legendary = Reveal.revealStageProfile('legendary');
    const epic = Reveal.revealStageProfile('epic');
    const rare = Reveal.revealStageProfile('rare');
    assert.ok(legendary.particles > epic.particles && epic.particles > 0 && rare.particles === 0);
    assert.equal(legendary.rays, true);
    assert.equal(epic.rays, false);
    assert.equal(legendary.sting, 'legendary');
    const reduced = Reveal.revealStageProfile('legendary', { reducedMotion: true });
    assert.equal(reduced.static, true);
    assert.equal(reduced.spin, false);
    assert.equal(reduced.particles, 0);
    assert.equal(reduced.rays, false);
    assert.equal(reduced.sting, 'legendary', 'the audio payoff survives reduced motion');
    const calm = Reveal.revealStageProfile('legendary', { calmMotion: true });
    assert.equal(calm.static, false);
    assert.equal(calm.particles, 0);
    assert.equal(calm.rays, false);
});

test('reveal timeline: static stays put; animated pops in, keeps spinning, bursts once, allocates nothing', () => {
    const out = {};
    const still = Reveal.revealStageProfile('legendary', { reducedMotion: true });
    for (const t of [0, 0.5, 3]) {
        const sample = Reveal.sampleRevealTimeline(t, still, out);
        assert.equal(sample, out);
        assert.equal(sample.scale, 1);
        assert.equal(sample.angle, 0);
        assert.equal(sample.burst, -1);
    }
    const live = Reveal.revealStageProfile('legendary');
    assert.ok(Reveal.sampleRevealTimeline(0, live, out).scale < 0.05, 'starts tiny');
    assert.equal(Reveal.sampleRevealTimeline(0.1, live, out).burst, -1, 'no burst before its beat');
    let lastAngle = -1;
    for (let t = 0; t <= 4; t += 0.05) {
        const sample = Reveal.sampleRevealTimeline(t, live, out);
        assert.equal(sample, out, 'same object every frame');
        assert.ok(sample.angle > lastAngle, 'turntable never reverses');
        lastAngle = sample.angle;
    }
    assert.ok(Math.abs(Reveal.sampleRevealTimeline(Reveal.REVEAL_INTRO_SEC + 1, live, out).scale - 1) < 1e-9);
    const burstAt = Reveal.REVEAL_INTRO_SEC * Reveal.REVEAL_BURST_AT;
    assert.ok(Reveal.sampleRevealTimeline(burstAt + 0.01, live, out).rim > 1.5, 'rim flares at the burst');
});

function stubMount() {
    const classes = new Set();
    const children = [];
    return {
        clientWidth: 800, clientHeight: 300, children,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        appendChild(child) { children.push(child); return child; },
        querySelector() { return null; }
    };
}

test('reduced-motion reveal renders one static frame, never starts a loop, and tears down fully', async () => {
    const rafCalls = [];
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.requestAnimationFrame = fn => { rafCalls.push(fn); return rafCalls.length; };
    globalThis.cancelAnimationFrame = () => {};
    const renderer = stubRenderer();
    const mount = stubMount();
    const reveal = Reveal.createCaseReveal3D(mount, { ...KNIVES.fade, type: 'knife' }, {
        typeHint: 'knife', reducedMotion: true, createRenderer: () => renderer
    });
    assert.ok(reveal, 'stage builds with a renderer');
    assert.equal(reveal.particles, null, 'no particle system at all');
    assert.equal(reveal.rays, null);
    assert.equal(await reveal.play(), true);
    assert.equal(renderer.renders, 1, 'exactly one hero render');
    assert.equal(rafCalls.length, 0, 'no animation loop');
    assert.ok(mount.classList.contains('is-playing'));
    reveal.dispose();
    assert.equal(renderer.disposed, 1);
    assert.equal(renderer.lost, 1, 'context released on close');
    assert.equal(renderer.domElement.removed, true);
    reveal.dispose(); // idempotent
    assert.equal(renderer.disposed, 1);
});

test('animated legendary reveal loops on rAF with preallocated particles and stops on dispose', async () => {
    const rafCalls = [];
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.requestAnimationFrame = fn => { rafCalls.push(fn); return rafCalls.length; };
    let cancelled = 0;
    globalThis.cancelAnimationFrame = () => { cancelled++; };
    const renderer = stubRenderer();
    const reveal = Reveal.createCaseReveal3D(stubMount(), { id: 'gloves_supernova', type: 'cosmetic', rarity: 'legendary' }, {
        createRenderer: () => renderer
    });
    assert.ok(reveal.particles && reveal.rays, 'legendary gets particles + rays');
    const positions = reveal.particles.positions;
    await reveal.play();
    const t0 = reveal._t0;
    for (let i = 1; i <= 40; i++) rafCalls[rafCalls.length - 1](t0 + i * 33);
    assert.ok(renderer.renders >= 40);
    assert.equal(reveal.particles.positions, positions, 'particle buffer reused in place');
    reveal.dispose();
    assert.equal(cancelled, 1);
    const before = renderer.renders;
    rafCalls[rafCalls.length - 1](t0 + 5000);
    assert.equal(renderer.renders, before, 'no frame after dispose');
});

test('no WebGL for the reveal → null so the classic reveal runs', () => {
    const mount = stubMount();
    const reveal = Reveal.createCaseReveal3D(mount, { ...KNIVES.fade, type: 'knife' }, {
        createRenderer: () => { throw new Error('no webgl'); }
    });
    assert.equal(reveal, null);
    assert.equal(Reveal.createCaseReveal3D(mount, { id: 'impact_fire', type: 'cosmetic' }), null, 'nothing 3D to show');
});

// ---------------------------------------------------------------------------
// wiring (source-level: ui.js cannot be imported under plain Node)
// ---------------------------------------------------------------------------
test('ui.js wires thumbnails and the reveal stage without breaking the reel contract', async () => {
    const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
    const audio = await readFile(new URL('../js/audio.js', import.meta.url), 'utf8');
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(ui, /^import \* as ItemThumbnails from '\.\/item-thumbnails\.js';$/m, 'single-line import (tests strip imports by line)');
    assert.match(ui, /typeof ItemThumbnails === 'undefined'/);
    assert.match(ui, /typeof createCaseReveal3D !== 'function'/);
    const reel = ui.slice(ui.indexOf('showCaseReel('), ui.indexOf('\n    _scheduleReelTicks(', ui.indexOf('showCaseReel(')));
    assert.match(reel, /class="case-reel-orb" data-type="\$\{kind\}"/, 'the orb stays as the fallback');
    assert.match(reel, /this\._attachReelThumbnails\(track, arrangedItems, targetIndex\)/);
    assert.match(reel, /revealStage\?\.dispose\(\);/, 'stage torn down whenever the reel closes');
    assert.match(reel, /reducedMotion: presentation\.reducedMotion|_prepareCaseRevealStage\(overlay, result\.reward, presentation\)/);
    assert.match(ui, /reducedMotion: presentation\.reducedMotion,/);
    for (const where of ['_renderTierList(grid)', 'renderLockerInventory(store)', "tab === 'balls'"]) {
        const start = ui.indexOf(where);
        assert.ok(start !== -1, where);
        assert.match(ui.slice(start, start + 12000), /_attachItemThumb\(/, `${where} uses thumbnails`);
    }
    assert.match(ui, /this\.audio\.playCaseReelTick\(progress, gapMs\)/, 'ticks slow with the reel');
    assert.match(audio, /playCaseReelTick\(progress = 0, gapMs = 60\)/);
    assert.match(audio, /playCaseRevealSting\(rarity = 'rare'\)/);
    assert.match(audio, /playCaseTick\(pitchMul = 1\)/, 'existing tick left intact');
    assert.match(html, /<div id="case-reveal-stage" class="case-reveal-stage" hidden aria-hidden="true"><\/div>/);
});
