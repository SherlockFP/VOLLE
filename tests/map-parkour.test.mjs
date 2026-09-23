// map-parkour.test.mjs — climbable parkour on every dodgeball map
// (getParkourLayout / Arena.buildParkour): themed per map, mirror-symmetric
// for both teams and both wings, every piece on its own half (never bridging
// the midline the cross-court rule walls off), clear of spawns, the centre
// lane, hazards, portals and every other prop, each rise one comfortable
// single jump, and solid for the ball. The climb and the ball bounce run the
// REAL Player.update() / Ball.update() against colliders the real Arena
// helpers registered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
const threeUrl = new URL('three.module.js', vendor).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const THREE = await import(threeUrl);
const {
    Arena, MAPS, getParkourLayout, PARKOUR_THEMES, PARKOUR_STEP_RISE,
    PARKOUR_CENTER_GAP, PARKOUR_LANE_HALF_WIDTH
} = await import('../js/arena.js');
const { SPORTS } = await import('../js/sports.js');
const { clampToCourtHalf } = await import('../js/court-rules.js');

const DODGEBALL_MAPS = SPORTS.dodgeball.mapIds;
// Player defaults (js/player.js constructor) — pinned against the real Player below.
const JUMP_FORCE = 8;
const GRAVITY = 20;
const JUMP_APEX = JUMP_FORCE ** 2 / (2 * GRAVITY); // 1.6 m
const EYE = 1.7;
const DT = 1 / 60;

const footprint = p => ({ minX: p.x - p.halfWidth, maxX: p.x + p.halfWidth, minZ: p.z - p.halfDepth, maxZ: p.z + p.halfDepth });
const gapBetween = (a, b) => Math.max(a.minX - b.maxX, b.minX - a.maxX, a.minZ - b.maxZ, b.minZ - a.maxZ);
const pointDistance = (f, x, z) => Math.hypot(Math.max(f.minX - x, 0, x - f.maxX), Math.max(f.minZ - z, 0, z - f.maxZ));
const key = (...values) => values.map(v => (Object.is(v, -0) ? 0 : v).toFixed(3)).join('|');

function makeRenderer() {
    return {
        scene: new THREE.Scene(), _quality: 'medium',
        renderer: { setClearColor() {}, toneMappingExposure: 1 },
        createToonMaterial: color => new THREE.MeshBasicMaterial({ color }),
        shouldLightDecor: () => true,
        setBloomProfile() {}
    };
}

test('every dodgeball map has themed parkour; nothing else does', () => {
    assert.deepEqual(Object.keys(PARKOUR_THEMES).sort(), [...DODGEBALL_MAPS].sort());
    for (const id of DODGEBALL_MAPS) {
        const layout = getParkourLayout(id);
        assert.ok(layout, `${id} has parkour`);
        assert.ok(['wood', 'stone', 'container', 'pad', 'ice', 'block'].includes(layout.theme.style), `${id} style`);
        assert.equal(layout.pieces.length, 12, `${id}: a three-piece chain in each quadrant`);
    }
    assert.equal(getParkourLayout('cosmetic_studio'), null);
    assert.equal(getParkourLayout('custom-anything', { courtWidth: 60, courtLength: 60 }), null);
});

test('parkour is mirror-symmetric: same for both teams and both wings', () => {
    for (const id of DODGEBALL_MAPS) {
        const pieces = getParkourLayout(id).pieces;
        const spots = new Set(pieces.map(p => key(p.x, p.z, p.halfWidth, p.halfDepth, p.height)));
        for (const p of pieces) {
            assert.ok(spots.has(key(-p.x, p.z, p.halfWidth, p.halfDepth, p.height)), `${id} (${p.x}, ${p.z}) X mirror`);
            assert.ok(spots.has(key(p.x, -p.z, p.halfWidth, p.halfDepth, p.height)), `${id} (${p.x}, ${p.z}) Z mirror`);
        }
    }
});

test('every piece stays on its own half, clear of the midline, the centre lane and the walls', () => {
    for (const id of DODGEBALL_MAPS) {
        const config = MAPS[id];
        const halfW = config.courtWidth / 2;
        const halfL = config.courtLength / 2;
        const pieces = getParkourLayout(id).pieces;
        assert.equal(pieces.filter(p => p.z < 0).length, 6, `${id}: six pieces on the red half`);
        assert.equal(pieces.filter(p => p.z > 0).length, 6, `${id}: six pieces on the blue half`);
        for (const p of pieces) {
            const f = footprint(p);
            // Entirely on one side of z = 0, with room to spare.
            assert.ok(f.minZ >= PARKOUR_CENTER_GAP || f.maxZ <= -PARKOUR_CENTER_GAP, `${id} (${p.x}, ${p.z}) never bridges the midline`);
            // A player standing anywhere on it is inside his own half (the
            // cross-court clamp never has to move him).
            const side = Math.sign(p.z);
            for (const z of [f.minZ, f.maxZ]) assert.equal(clampToCourtHalf(z, side, 0.7), z);
            assert.ok(Math.abs(p.x) - p.halfWidth >= PARKOUR_LANE_HALF_WIDTH, `${id} centre lane stays open`);
            assert.ok(Math.abs(p.x) + p.halfWidth <= halfW - 1.5, `${id} (${p.x}, ${p.z}) inside the side wall`);
            assert.ok(Math.abs(p.z) + p.halfDepth <= halfL - 1.5, `${id} (${p.x}, ${p.z}) inside the end wall`);
            if (config.ceilingHeight > 0) {
                assert.ok(p.height + EYE + 0.2 + 1 <= config.ceilingHeight, `${id} headroom above the perch`);
            }
        }
    }
});

test('every rise is one single jump from the floor or a touching lower piece, topping out at a height-advantage perch', () => {
    assert.ok(PARKOUR_STEP_RISE <= JUMP_APEX - 0.3, 'step rise keeps a 0.3 m margin under the jump apex');
    for (const id of DODGEBALL_MAPS) {
        const pieces = getParkourLayout(id).pieces;
        for (const p of pieces) {
            const from = [0, ...pieces
                .filter(q => q !== p && q.height < p.height && gapBetween(footprint(q), footprint(p)) <= 1e-9
                    && Math.sign(q.z) === Math.sign(p.z))
                .map(q => q.height)];
            const rise = p.height - Math.max(...from);
            assert.ok(rise > 0 && rise <= JUMP_APEX - 0.3, `${id} (${p.x}, ${p.z}) rise ${rise.toFixed(2)} from the nearest lower surface`);
        }
        const perch = Math.max(...pieces.map(p => p.height));
        assert.ok(perch >= 3 * PARKOUR_STEP_RISE, `${id} perch lifts the eye to ${perch + EYE} m`);
        assert.ok(perch > JUMP_APEX * 2, `${id} perch is higher than a double jump from the floor`);
    }
});

test('built parkour: solid boxes with standable tops, clear of spawns, hazards, portals and other props', () => {
    for (const id of DODGEBALL_MAPS) {
        const arena = new Arena(makeRenderer(), id);
        const layout = getParkourLayout(id);
        const meshes = arena.objects.filter(o => o.userData.parkour);
        assert.ok(meshes.length >= 3 && meshes.length <= 4, `${id} parkour is a handful of instanced draw calls`);
        const own = arena.collidables.filter(c => c.mesh?.userData?.parkour);
        assert.equal(own.length, layout.pieces.length, `${id} one collider per piece`);
        for (const p of layout.pieces) {
            const f = footprint(p);
            const c = own.find(entry => entry.minX === f.minX && entry.maxZ === f.maxZ);
            assert.ok(c, `${id} piece (${p.x}, ${p.z}) has its exact box`);
            assert.equal(c.minY, 0);
            assert.equal(c.maxY, p.height);
            assert.equal(c.top, p.height);
            assert.ok(arena.platforms.some(q => q.solid && q.x === p.x && q.z === p.z && q.y === p.height
                && q.halfWidth === p.halfWidth && q.halfDepth === p.halfDepth), `${id} piece top is standable`);
            // Spawn rows (up to eight per team) stay clear.
            for (const team of ['red', 'blue']) {
                for (let i = 0; i < 8; i++) {
                    const spawn = arena.getPlayerSpawn(team, i);
                    assert.ok(pointDistance(f, spawn.x, spawn.z) >= 3, `${id} ${team} spawn ${i} is clear`);
                }
            }
            for (const zone of arena.hazardZones) {
                assert.ok(pointDistance(f, zone.x, zone.z) >= zone.radius + 1.5, `${id} clear of the ${zone.kind} zone`);
            }
            for (const portal of arena.portals || []) {
                assert.ok(pointDistance(f, portal.pos.x, portal.pos.z) >= 3.5, `${id} clear of a portal`);
            }
            assert.ok(pointDistance(f, 0, 0) > 8, `${id} ball drop zone stays clear`);
            // Walking room around every piece: no other prop within 1.5 m.
            for (const other of arena.collidables) {
                if (other.mesh?.userData?.parkour) continue;
                const low = Number.isFinite(other.minY) ? other.minY : Number.isFinite(other.bottom) ? other.bottom : other.pos.y - other.radius - 2.5;
                if (low > 6) continue;
                const g = Number.isFinite(other.minX)
                    ? gapBetween(f, other)
                    : pointDistance(f, other.pos.x, other.pos.z) - other.radius;
                assert.ok(g >= 1.5, `${id} piece (${p.x}, ${p.z}) crowds a prop (gap ${g.toFixed(2)})`);
            }
            for (const deck of arena.platforms.filter(q => !q.solid)) {
                assert.ok(gapBetween(f, footprint(deck)) >= 1.5, `${id} piece clear of a deck`);
            }
        }
        arena.clearMap();
    }
});

test('parkour builds on the Minecraft path too and is disposed with the map', () => {
    const arena = new Arena(makeRenderer(), 'minecraft');
    assert.equal(arena.collidables.filter(c => c.mesh?.userData?.parkour).length, 12);
    arena.rebuild('dojo');
    assert.equal(arena.objects.filter(o => o.userData.parkour).length, 4, 'wood style adds corner posts');
    assert.equal(arena.collidables.filter(c => c.mesh?.userData?.parkour).length, 12, 'only the new map parkour colliders remain');
    arena.clearMap();
    assert.equal(arena.collidables.length, 0);
});

// --- real physics ----------------------------------------------------------------
function parkourArena(id) {
    const host = {
        bounds: { minX: -60, maxX: 60, minY: 0, minZ: -60, maxZ: 60, maxY: 30 },
        ceilingHeight: 0,
        config: {},
        collidables: [],
        platforms: [],
        jumpPads: [],
        addCollidable: Arena.prototype.addCollidable,
        _addSolidBox: Arena.prototype._addSolidBox,
        getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
    };
    const pieces = getParkourLayout(id).pieces.filter(p => p.x > 0 && p.z > 0);
    for (const p of pieces) Arena.prototype._addSolidBox.call(host, null, p.x, p.z, p.halfWidth, p.halfDepth, p.height, 'always');
    return { host, pieces };
}

async function makePlayer(t, arena) {
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
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
    const { Player } = await import('../js/player.js');
    const player = new Player(
        { scene: new THREE.Scene(), domElement: canvas, createToonMaterial: color => new THREE.MeshBasicMaterial({ color }) },
        new THREE.PerspectiveCamera(75, 1, 0.1, 100),
        arena
    );
    player.game = { state: 'PLAYING', ui: { spectating: false }, ball: { _warmup: false } };
    t.after(() => {
        player.cleanupInput();
        player.armGroup.removeFromParent();
        if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
        else delete globalThis.document;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    });
    return player;
}

test('a real player hops up the chain (step, ledge, perch) with plain jumps and stands on the perch', async t => {
    for (const id of ['dojo', 'harbor_nightworks', 'temple_sym']) {
        const { host, pieces } = parkourArena(id);
        const player = await makePlayer(t, host);
        assert.equal(player.jumpForce, JUMP_FORCE, 'jump force the layout is tuned for');
        assert.equal(-player.gravity, GRAVITY, 'gravity the layout is tuned for');
        const sorted = [...pieces].sort((a, b) => a.height - b.height);
        const [step, , perch] = sorted;
        // Start on the floor at the lane side of the step, facing +x (the chain direction).
        player.position.set(step.x - step.halfWidth - 3, EYE, step.z);
        player.euler.y = -Math.PI / 2;
        player.camera.quaternion.setFromEuler(player.euler);
        player.keys.KeyW = true;
        let stoodOnPerch = false;
        let sankIntoPiece = false;
        for (let i = 0; i < 600 && !stoodOnPerch; i++) {
            // Plain single jumps, pressed right at the next face (no double jump).
            const next = sorted.find(p => p.height > player.position.y - EYE + 0.05);
            const ahead = next ? next.x - next.halfWidth - player.position.x : Infinity;
            player.keys.Space = player.onGround && ahead < 1.6;
            player.update(DT);
            const feet = player.position.y - EYE;
            for (const p of pieces) {
                const inside = Math.abs(player.position.x - p.x) < p.halfWidth - 0.05 && Math.abs(player.position.z - p.z) < p.halfDepth - 0.05;
                if (inside && feet < p.height - 0.06) sankIntoPiece = true;
            }
            const onPerch = Math.abs(player.position.x - perch.x) <= perch.halfWidth && Math.abs(player.position.z - perch.z) <= perch.halfDepth;
            if (onPerch && player.onGround && Math.abs(feet - perch.height) < 1e-6) {
                player.keys.KeyW = false;
                stoodOnPerch = true;
            }
        }
        assert.equal(sankIntoPiece, false, `${id}: feet never pass through a top face`);
        assert.ok(stoodOnPerch, `${id}: reached the perch (feet ${(player.position.y - EYE).toFixed(2)}, x ${player.position.x.toFixed(2)})`);
        // Standing on the perch is stable.
        player.keys.Space = false;
        for (let i = 0; i < 60; i++) player.update(DT);
        assert.ok(player.onGround && Math.abs(player.position.y - EYE - perch.height) < 1e-6, `${id}: stays on the perch`);
    }
});

const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const ballSource = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const { Ball } = await import(`data:text/javascript;base64,${Buffer.from(ballSource
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }')
).toString('base64')}`);

function makeBall(arena) {
    const material = () => new THREE.ShaderMaterial({ uniforms: {
        uColor: { value: new THREE.Color() }, uTexture: { value: null },
        uTextureEnabled: { value: false }, uRimPower: { value: 5 }
    } });
    const ball = new Ball({ scene: new THREE.Scene(), createToonMaterial: material, createOutlineMesh: g => new THREE.Mesh(g), _quality: 'low' }, arena);
    ball._emitTrail = () => {};
    ball.updateTrail = () => {};
    ball.spawn();
    ball._noHitTimer = 0;
    ball.targetPlayer = null;
    ball.state = 'homing';
    return ball;
}

test('the ball bounces off a parkour perch face at rally speed and off its top like the floor', () => {
    const { host, pieces } = parkourArena('dojo');
    const perch = pieces.reduce((best, p) => (p.height > best.height ? p : best));
    // Side face, fast shot along -x toward the perch's outer (+x) face.
    for (const speed of [30, 250]) {
        const ball = makeBall(host);
        ball.position.set(perch.x + perch.halfWidth + 8, 2, perch.z);
        ball.velocity.set(-speed, 0, 0);
        ball.currentSpeed = speed;
        let bounced = false;
        for (let i = 0; i < 40 && !bounced; i++) {
            ball.update(DT);
            assert.ok(ball.position.x >= perch.x + perch.halfWidth - 1e-6, `${speed} m/s: never inside the perch (x ${ball.position.x.toFixed(2)})`);
            if (ball.velocity.x > 0) bounced = true;
        }
        assert.ok(bounced, `${speed} m/s: reflected off the perch face`);
    }
    // Top face: dropped from above, it bounces up off the perch top.
    const ball = makeBall(host);
    ball.position.set(perch.x, perch.height + 6, perch.z);
    ball.velocity.set(0, -25, 0);
    ball.currentSpeed = 25;
    let topBounce = false;
    for (let i = 0; i < 120 && !topBounce; i++) {
        ball.update(DT);
        assert.ok(ball.position.y >= perch.height + ball.radius - 1e-3 || Math.abs(ball.position.x - perch.x) > perch.halfWidth,
            'ball never sinks into the perch top');
        if (ball.velocity.y > 0 && ball.position.y > perch.height) topBounce = true;
    }
    assert.ok(topBounce, 'bounced off the perch top');
});
