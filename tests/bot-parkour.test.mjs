// bot-parkour.test.mjs — bots climb parkour (step/ledge, never the perch),
// stand at the height of what they are on, walk off and fall with gravity, and
// recover when pinned against a prop. Runs the REAL Bot (js/bot.js) against
// parkour colliders the real Arena helpers registered (tagged by buildParkour).
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
const { Arena, getParkourLayout } = await import('../js/arena.js');
const {
    Bot, BOT_MOUNT_ARC_SECONDS, BOT_MOUNT_ARC_PEAK, BOT_DISMOUNT_DELAY, BOT_STUCK_SECONDS
} = await import('../js/bot.js');
const { capsuleContact, targetFeetY } = await import('../js/combat.js');
const { encodeBotSync, decodeBotSync } = await import('../js/net-codec.js');
const botSource = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');

const DT = 1 / 60;
const MAP = 'dojo';

function makeRenderer() {
    return {
        scene: new THREE.Scene(), _quality: 'low',
        renderer: { setClearColor() {}, toneMappingExposure: 1 },
        createToonMaterial: color => new THREE.ShaderMaterial({ uniforms: {
            uColor: { value: new THREE.Color(color) }, uTexture: { value: null },
            uTextureEnabled: { value: false }, uRimPower: { value: 5 }, uPulse: { value: 0 }
        } }),
        createOutlineMesh: g => new THREE.Mesh(g),
        createTargetOutline: () => ({ userData: { materials: [], setVisible() {}, dispose() {} } }),
        shouldLightDecor: () => true,
        setBloomProfile() {}
    };
}

// The map's red-half parkour (both wings), registered exactly as buildParkour does.
function parkourHost(id = MAP) {
    const host = {
        bounds: { minX: -44, maxX: 44, minY: 0, minZ: -30, maxZ: 30, maxY: 30 },
        collidables: [], platforms: [],
        addCollidable: Arena.prototype.addCollidable,
        getPlayerSpawn: team => new THREE.Vector3(0, 1.7, team === 'red' ? -20 : 20)
    };
    const pieces = getParkourLayout(id).pieces;
    for (const p of pieces) {
        Arena.prototype._addSolidBox.call(host, null, p.x, p.z, p.halfWidth, p.halfDepth, p.height, 'always', 0, p.kind);
    }
    const find = (kind, sx = 1, sz = -1) => host.platforms.find(q => q.parkour === kind && Math.sign(q.x) === sx && Math.sign(q.z) === sz);
    return { host, step: find('step'), ledge: find('ledge'), perch: find('perch'), blueStep: find('step', 1, 1) };
}

const game = { _ffa: false, _skillsDisabled: true, getCourtConfinementSide: team => (team === 'red' ? -1 : 1) };
function makeBot(host, team = 'red') {
    const bot = new Bot(makeRenderer(), host, `bot-${team}`, team, 'hard');
    bot._gameRef = game;
    bot.skillChance = 0;
    bot.respawn();
    bot.spawnAnim = 1;
    bot.strafeDir = 1;
    return bot;
}

// A live ball somewhere else, flying high (predicted height >= 2 m), not at this bot.
function highBall(x, z, y = 5) {
    return { active: true, position: new THREE.Vector3(x, y, z), velocity: new THREE.Vector3(0.01, 0, 0), targetPlayer: null, currentSpeed: 17, attackRange: 3 };
}
function lowBall(x, z) {
    return { active: true, position: new THREE.Vector3(x, 1, z), velocity: new THREE.Vector3(0.01, 0, 0), targetPlayer: null, currentSpeed: 17, attackRange: 3 };
}

function insideCollider(host, bot) {
    const r = bot.radius - 1e-4;
    const { x, y, z } = bot.position;
    return host.collidables.some(c => !(y + 1.9 <= c.minY + 1e-6 || y >= c.maxY - 1e-6)
        && x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
}

test('buildParkour tags every parkour top step / ledge / perch on the platform record', () => {
    const arena = new Arena(makeRenderer(), MAP);
    const tagged = arena.platforms.filter(p => p.parkour);
    const layout = getParkourLayout(MAP).pieces;
    assert.equal(tagged.length, layout.length);
    for (const kind of ['step', 'ledge', 'perch']) assert.equal(tagged.filter(p => p.parkour === kind).length, 4, kind);
    for (const p of layout) {
        assert.ok(tagged.some(q => q.x === p.x && q.z === p.z && q.y === p.height && q.parkour === p.kind), `${p.kind} (${p.x}, ${p.z})`);
    }
    assert.ok(arena.platforms.filter(p => !p.parkour).every(p => p.parkour === undefined), 'other platforms untouched');
    arena.clearMap();
});

test('mount = a scripted 0.30 s hop peaking 0.4 m over the top, no teleport, never inside a collider', () => {
    const { host, step } = parkourHost();
    const bot = makeBot(host);
    bot.position.set(step.x - step.halfWidth - 0.6, 0, step.z);
    const ball = highBall(step.x - 8, step.z - 4);
    let started = null;
    let peak = 0;
    let lastX = bot.position.x;
    let lastZ = bot.position.z;
    let lastY = bot.position.y;
    for (let f = 0; f < 120; f++) {
        bot.update(DT, ball);
        if (bot._pkMode === 1 && started === null) started = f;
        peak = Math.max(peak, bot.position.y);
        assert.ok(Math.hypot(bot.position.x - lastX, bot.position.z - lastZ) < 0.35, `frame ${f}: no horizontal teleport`);
        assert.ok(Math.abs(bot.position.y - lastY) < 0.35, `frame ${f}: no vertical teleport`);
        assert.ok(!insideCollider(host, bot), `frame ${f}: inside a collider at (${bot.position.x.toFixed(2)}, ${bot.position.y.toFixed(2)}, ${bot.position.z.toFixed(2)})`);
        lastX = bot.position.x; lastZ = bot.position.z; lastY = bot.position.y;
        if (started !== null && bot._pkMode === 2) {
            const frames = f - started;
            assert.ok(Math.abs(frames * DT - BOT_MOUNT_ARC_SECONDS) <= DT + 1e-9, `hop took ${(frames * DT).toFixed(3)} s`);
            break;
        }
    }
    assert.notEqual(started, null, 'the bot hopped onto the step');
    assert.equal(bot._pkMode, 2);
    assert.equal(bot._pkPiece, step);
    assert.equal(bot.position.y, step.y, 'stands at the step top');
    assert.ok(Math.abs(peak - (step.y + BOT_MOUNT_ARC_PEAK)) < 0.02, `arc peak ${peak.toFixed(3)}`);
    assert.equal(bot.getFeetY(), step.y, 'hit capsule anchors at the feet it stands on');
    // Stays clamped to the step footprint while the reason holds.
    for (let f = 0; f < 120; f++) {
        bot.update(DT, ball);
        if (bot._pkPiece !== step) break;
        assert.ok(Math.abs(bot.position.x - step.x) <= step.halfWidth + 1e-9 && Math.abs(bot.position.z - step.z) <= step.halfDepth + 1e-9);
    }
});

test('a high ball takes a bot step -> ledge; it never mounts the perch and never crosses the midline', () => {
    const { host, step, ledge, perch } = parkourHost();
    for (const startX of [step.x - step.halfWidth - 3, step.x, step.x + 3]) {
        const bot = makeBot(host);
        bot.position.set(startX, 0, step.z - step.halfDepth - 3);
        const ball = highBall(ledge.x, ledge.z, 4);
        let onLedge = false;
        for (let f = 0; f < 60 * 8; f++) {
            bot.update(DT, ball);
            assert.notEqual(bot._pkPiece, perch, 'never the perch');
            assert.ok(bot.position.y <= ledge.y + BOT_MOUNT_ARC_PEAK + 1e-9, `y ${bot.position.y.toFixed(2)} stays below the perch`);
            assert.ok(bot.position.z < 0, 'red bot stays on its own half');
            assert.ok(!insideCollider(host, bot), `frame ${f}: inside a collider`);
            if (bot._pkMode === 2 && bot._pkPiece === ledge) onLedge = true;
        }
        assert.ok(onLedge, `start x ${startX.toFixed(1)}: climbed step -> ledge (mode ${bot._pkMode}, y ${bot.position.y})`);
    }
});

test('mount gates: step/ledge only, rise <= 1.2 m, within 0.8 u, own half, walk limits, no defense intent, a reason', () => {
    const { host, step, ledge, perch, blueStep } = parkourHost();
    const bot = makeBot(host);
    bot.update(DT, lowBall(0, -10)); // initialise walk limits
    const ready = (x, z, targetY = 3, tx = x, tz = z) => {
        bot._resetParkour();
        bot._defenseIntent = 'none';
        bot.position.set(x, 0, z);
        bot._baseWalkMinZ = bot._walkMinZ = -28.5;
        bot._baseWalkMaxZ = bot._walkMaxZ = -1;
        bot._interceptFresh = true;
        bot._interceptTarget.set(tx, targetY, tz);
    };
    const west = step.x - step.halfWidth;
    ready(west - 0.6, step.z);
    assert.equal(bot._tryMountParkour(), true, 'edge 0.6, high ball');
    ready(west - 0.9, step.z);
    assert.equal(bot._tryMountParkour(), false, 'edge 0.9 is out of reach');
    ready(west - 0.6, step.z);
    bot._defenseIntent = 'deflect';
    assert.equal(bot._tryMountParkour(), false, 'holding a deflect');
    ready(west - 0.6, step.z, 1.0, -30, -25);
    assert.equal(bot._tryMountParkour(), false, 'no reason: low ball far away');
    ready(west - 0.6, step.z, 1.0, step.x + step.halfWidth + 0.9, step.z);
    assert.equal(bot._tryMountParkour(), true, 'intercept target within the footprint + 1.0');
    ready(west - 0.6, step.z);
    bot._baseWalkMinZ = step.z + 0.5;
    assert.equal(bot._tryMountParkour(), false, 'piece outside the walk limits');
    // The ledge is 2.4 m above the floor: out of a single hop from the floor.
    ready(ledge.x, ledge.z - ledge.halfDepth - 0.6);
    assert.equal(bot._tryMountParkour(), false, 'ledge from the floor (rise 2.4)');
    // Opponent half.
    ready(blueStep.x - blueStep.halfWidth - 0.6, blueStep.z);
    bot._baseWalkMinZ = bot._walkMinZ = -28.5; bot._baseWalkMaxZ = bot._walkMaxZ = 28.5;
    assert.equal(bot._tryMountParkour(), false, 'never a piece on the other half');
    // Up on the ledge right next to the perch (rise 1.2): still never the perch.
    bot._resetParkour();
    bot._pkMode = 2; bot._pkPiece = ledge;
    bot.position.set(ledge.x + ledge.halfWidth - 0.55, ledge.y, ledge.z);
    bot._interceptFresh = true; bot._interceptTarget.set(perch.x, 5, perch.z);
    assert.equal(bot._tryMountParkour(), false, 'the perch is never mounted');
});

test('reason false for 1.0 s: the bot walks off and falls with gravity -20 to the surface below', () => {
    const { host, ledge, step } = parkourHost();
    const bot = makeBot(host);
    bot._pkMode = 2; bot._pkPiece = ledge;
    bot.position.set(ledge.x, ledge.y, ledge.z);
    const ball = lowBall(-30, -25); // no reason to stay up
    let offAt = null;
    let landedAt = null;
    let prevVy = 0;
    let sawFall = false;
    for (let f = 0; f < 60 * 6; f++) {
        bot.update(DT, ball);
        const t = (f + 1) * DT;
        if (offAt === null && bot._pkMode === 3) offAt = t;
        if (offAt === null) assert.equal(bot.position.y, ledge.y, 'stays up until the reason has been false for 1.0 s');
        if (bot._fallVy < 0) {
            sawFall = true;
            assert.ok(bot._fallVy <= prevVy + 1e-9, 'gravity only accelerates the fall');
            assert.ok(Math.abs((bot._fallVy - prevVy) - (-20 * DT)) < 1e-6 || prevVy === 0, 'g = -20');
        }
        prevVy = bot._fallVy;
        assert.ok(!insideCollider(host, bot), `frame ${f}: inside a collider (${bot.position.x.toFixed(2)}, ${bot.position.y.toFixed(2)}, ${bot.position.z.toFixed(2)})`);
        assert.ok(bot._pkPiece?.parkour !== 'perch');
        if (bot.position.y === 0 && bot._pkMode === 0) { landedAt = t; break; }
    }
    assert.ok(offAt !== null && offAt >= BOT_DISMOUNT_DELAY - 1e-9 && offAt <= BOT_DISMOUNT_DELAY + 2 * DT, `walked off at ${offAt}`);
    assert.ok(sawFall, 'fell with gravity');
    assert.notEqual(landedAt, null, 'back on the floor (possibly via the step)');
    assert.ok(step, 'layout has a step');
});

test('pinned against a prop while wanting to move: flips _obstacleSide and heads for the nearest corner', () => {
    const host = {
        bounds: { minX: -44, maxX: 44, minY: 0, minZ: -30, maxZ: 30, maxY: 30 },
        collidables: [], platforms: [], addCollidable: Arena.prototype.addCollidable,
        getPlayerSpawn: () => new THREE.Vector3(0, 1.7, -20)
    };
    Arena.prototype._addSolidBox.call(host, null, 0, -10, 2, 1, 3, false);
    const bot = makeBot(host);
    bot.update(DT, null);
    bot._resetParkour();
    bot.position.set(0.3, 0, -10 - 1 - 0.5 - 1e-3); // touching the box's -z face
    bot._obstacleSide = 1;
    let episodes = 0;
    for (let t = 0; t < BOT_STUCK_SECONDS + 2 * DT; t += DT) {
        bot._updateUnstick(DT, 0.1, bot.moveSpeed); // wants to move, does not
        if (bot.stuckEpisodes > episodes) break;
    }
    assert.equal(bot.stuckEpisodes, 1, 'one stuck episode after 1.0 s');
    assert.equal(bot._obstacleSide, -1, 'detour side flipped');
    const reach = bot.radius + 0.3;
    assert.ok(bot._detourTime > 0);
    assert.deepEqual([bot._detourX, bot._detourZ].map(v => +v.toFixed(6)), [2 + reach, -11 - reach], 'nearest clear corner, offset radius + 0.3');
    const start = bot.position.clone();
    for (let f = 0; f < 30; f++) bot.update(DT, null);
    assert.ok(bot.position.distanceTo(start) >= 0.1, 'moving again');
    assert.ok(!insideCollider(host, bot));
});

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('seeded bot-vs-bot: no stuck > 2 s, no perch, no midline crossing, never inside a collider, bots do mount', t => {
    const random = Math.random;
    Math.random = mulberry32(5);
    t.after(() => { Math.random = random; });
    let mounts = 0;
    for (const id of ['dojo', 'neon']) {
        const arena = new Arena(makeRenderer(), id);
        const bots = ['red', 'red', 'blue', 'blue'].map((team, i) => {
            const bot = new Bot(makeRenderer(), arena, `${team}${i}`, team, 'hard');
            bot._gameRef = game;
            bot.skillChance = 0;
            bot.respawn();
            bot.position.x += (i % 2) * 6 - 3;
            // Record the post-clamp step the bot wanted, before props resolved it.
            const move = bot._moveAroundProps;
            bot._moveAroundProps = function (px, pz) {
                this._testWanted = Math.hypot(this.position.x - px, this.position.z - pz);
                return move.call(this, px, pz);
            };
            return bot;
        });
        const perches = arena.platforms.filter(p => p.parkour === 'perch');
        // A ball that keeps flying high between the halves (a lob rally).
        const ball = { active: true, position: new THREE.Vector3(), velocity: new THREE.Vector3(), targetPlayer: null, currentSpeed: 17, attackRange: 3 };
        const stuck = bots.map(() => ({ t: 0, x: NaN, z: NaN }));
        for (let f = 0; f < 60 * 20; f++) {
            const time = f * DT;
            ball.position.set(Math.sin(time * 0.7) * 20, 3 + Math.sin(time * 1.3) * 2, Math.sin(time * 0.4) * 18);
            ball.velocity.set(Math.cos(time * 0.7) * 14, Math.cos(time * 1.3) * 2.6, Math.cos(time * 0.4) * 7.2);
            ball.targetPlayer = bots[Math.floor(time / 2.5) % bots.length];
            bots.forEach((bot, i) => {
                bot._testWanted = 0;
                bot.update(DT, ball);
                assert.ok(!insideCollider(arena, bot), `${id} ${bot.name} frame ${f}: inside a collider`);
                assert.ok(bot.team === 'red' ? bot.position.z < 0 : bot.position.z > 0, `${id} ${bot.name}: midline`);
                assert.ok(!perches.some(p => Math.abs(bot.position.x - p.x) < p.halfWidth + bot.radius
                    && Math.abs(bot.position.z - p.z) < p.halfDepth + bot.radius && bot.position.y >= p.y - 0.05), `${id} ${bot.name}: on a perch`);
                // Stuck = wants to move (no defense intent, on the floor) yet stays within 0.1 u.
                const s = stuck[i];
                const wants = bot._testWanted > bot.moveSpeed * DT * 0.25 && bot._defenseIntent === 'none' && bot._pkMode === 0;
                if (!wants || !Number.isFinite(s.x) || Math.hypot(bot.position.x - s.x, bot.position.z - s.z) >= 0.1) {
                    s.t = 0; s.x = bot.position.x; s.z = bot.position.z;
                }
                if (wants) s.t += DT;
                assert.ok(s.t <= 2.0, `${id} ${bot.name}: stuck ${s.t.toFixed(2)} s`);
            });
        }
        mounts += bots.reduce((sum, bot) => sum + (bot.mountCount || 0), 0);
        arena.clearMap();
    }
    assert.ok(mounts > 0, 'bots use the parkour');
});

test('G1: an elevated bot is hit through its feet-anchored capsule; bot height rides botSync unchanged', () => {
    const { host, ledge } = parkourHost();
    const bot = makeBot(host);
    bot._pkMode = 2; bot._pkPiece = ledge;
    bot.position.set(ledge.x, ledge.y, ledge.z);
    assert.equal(bot.getFeetY(), ledge.y);
    assert.equal(targetFeetY(bot), ledge.y);
    const ballAtChest = { x: ledge.x + 0.5, y: ledge.y + 1.2, z: ledge.z };
    assert.equal(capsuleContact(ballAtChest, bot.position.x, bot.position.z, targetFeetY(bot), 1.7, 0.45, 0.47), true);
    assert.equal(capsuleContact(ballAtChest, bot.position.x, bot.position.z, 0, 1.7, 0.45, 0.47), false, 'a floor capsule would miss it');
    // Host payload carries position.y; the codec round-trips it and the client
    // pushes it into the remote bot's interpolation buffer (no protocol change).
    const packed = encodeBotSync([{ name: 'B', team: 'red', x: bot.position.x, y: bot.position.y, z: bot.position.z, ry: 0, alive: true, hp: 100, intent: 'none', strafe: 0, attacking: false }], 1);
    const decoded = decodeBotSync(new DataView(packed.buffer, packed.byteOffset, packed.byteLength));
    assert.ok(Math.abs(decoded.bots[0].y - ledge.y) < 1 / 64);
    assert.match(gameSource, /this\._pushPosBuffer\(p, bd\.x, bd\.y, bd\.z,/);
});

test('parkour + unstick helpers are allocation-free per frame', () => {
    for (const name of ['_parkourReason', '_parkourSupportAt', '_resolveBotHeight', '_applyScriptedWalk', '_stepMountArc',
        '_climbableEdge', '_seekParkour', '_tryMountParkour', '_mountPathClear', '_walkClear', '_updateParkour',
        '_beginDismount', '_updateUnstick', '_beginDetour']) {
        const start = botSource.indexOf(`\n    ${name}(`);
        assert.ok(start > 0, `${name} exists`);
        const rest = botSource.slice(start + 1);
        const body = rest.slice(0, rest.search(/\r?\n {4}\}\r?\n/));
        assert.doesNotMatch(body, /\bnew\b|\.clone\(|=\s*\[|=\s*\{|\.map\(|\.filter\(|\.\.\./, `${name} allocates`);
    }
    assert.doesNotMatch(botSource, /this\.position\.y = 0;\r?\n\s*this\._moveAroundProps/, 'feet are no longer forced to the floor');
});
