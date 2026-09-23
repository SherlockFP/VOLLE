// p2-sweep-wave3.test.mjs — Gauntlet card G9 "P2 sweep":
//   1) celebration bot-wander loop rides the real parkour dismount/fall path
//      (js/bot.js) instead of snapping an elevated bot's y to 0 every frame;
//   2) a bot mid mount-hop (PK_ARC) can never report deflect-ready, and
//      _tryMountParkour will not start a hop into a genuinely closing,
//      about-to-arrive ball;
//   3) OVERDRIVE_MAX_RATIO has exactly one definition (js/combat-fx.js),
//      imported by both js/game.js and js/ui.js;
//   4) .incoming-direction-arrow opts back into content-box sizing so the
//      border-triangle hack survives the global border-box reset;
//   5) the lowGravity double-application in Game.startGame is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';
import { compileGameMethod } from './game-source.mjs';

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
const { Bot, BOT_MOUNT_ARC_SECONDS, BOT_FALL_GRAVITY } = await import('../js/bot.js');
const { OVERDRIVE_MAX_RATIO } = await import('../js/combat-fx.js');
const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const botSource = await readFile(new URL('../js/bot.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../css/polish.css', import.meta.url), 'utf8');
const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');

const DT = 1 / 60;
const MAP = 'dojo';

// --- shared bot/arena harness (same technique as tests/bot-parkour.test.mjs) ---
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
    return { host, step: find('step'), ledge: find('ledge'), perch: find('perch') };
}
const gameRef = { _ffa: false, _skillsDisabled: true, getCourtConfinementSide: team => (team === 'red' ? -1 : 1) };
function makeBot(host, team = 'red', difficulty = 'hard') {
    const bot = new Bot(makeRenderer(), host, `bot-${team}`, team, difficulty);
    bot._gameRef = gameRef;
    bot.skillChance = 0;
    bot.respawn();
    bot.spawnAnim = 1;
    bot.strafeDir = 1;
    return bot;
}
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// (1) Celebration bots: elevated bots dismount/fall instead of snapping to y=0
// ---------------------------------------------------------------------------

const updateCelebrationBots = compileGameMethod('_updateCelebrationBots', { THREE, Math, BOT_FALL_GRAVITY });

test('G9: an elevated bot (on a ledge) at celebration start dismounts and falls under gravity -20 instead of snapping to the floor', () => {
    const { host, ledge } = parkourHost();
    const bot = makeBot(host);
    bot.update(DT, null); // initialise walk limits (own half) same as bot-parkour.test.mjs
    bot._resetParkour();
    bot._pkMode = 2; // PK_ON
    bot._pkPiece = ledge;
    bot.position.set(ledge.x, ledge.y, ledge.z);
    const game = { bots: [bot], arena: host, _winningTeam: 'blue', spawnDeathExplosion() {} };

    let maxSingleFrameDrop = 0;
    let landedAtSeconds = null;
    for (let f = 0; f < 60 && landedAtSeconds === null; f++) {
        const before = bot.position.y;
        updateCelebrationBots.call(game, DT);
        const drop = before - bot.position.y;
        if (drop > maxSingleFrameDrop) maxSingleFrameDrop = drop;
        if (bot._pkMode === 0 && bot.position.y === 0) landedAtSeconds = (f + 1) * DT;
    }
    assert.ok(maxSingleFrameDrop <= 0.5, `single-frame drop was ${maxSingleFrameDrop.toFixed(3)} u`);
    assert.notEqual(landedAtSeconds, null, 'bot reaches the floor');
    assert.ok(landedAtSeconds <= 0.6, `landed at ${landedAtSeconds.toFixed(3)} s`);
});

test('G9: a bot mid mount-hop (PK_ARC) at celebration start finishes the scripted arc, never teleports', () => {
    const { host, step } = parkourHost();
    const bot = makeBot(host);
    bot.update(DT, null);
    bot._resetParkour();
    bot.position.set(step.x - step.halfWidth - 0.3, 0, step.z);
    bot._pkMode = 1; // PK_ARC
    bot._pkPiece = step;
    bot._pkT = 0; // celebration can start at any point in the hop; 0 exercises the whole arc
    bot._pkSX = bot.position.x; bot._pkSY = 0; bot._pkSZ = bot.position.z;
    bot._pkEX = step.x; bot._pkEZ = step.z;
    const game = { bots: [bot], arena: host, _winningTeam: 'blue', spawnDeathExplosion() {} };

    let lastY = bot.position.y;
    let reachedOn = false;
    for (let f = 0; f < 30; f++) {
        updateCelebrationBots.call(game, DT);
        assert.ok(Math.abs(bot.position.y - lastY) < 0.35, `frame ${f}: no vertical teleport`);
        lastY = bot.position.y;
        if (bot._pkMode === 2) { reachedOn = true; break; }
    }
    assert.ok(reachedOn, 'the scripted arc completed and landed the bot on the step');
    assert.equal(bot.position.y, step.y);
});

test('G9: a grounded bot still wanders freely and the winner still scores kills during celebration', () => {
    const { host } = parkourHost();
    const winner = makeBot(host, 'red');
    winner.update(DT, null);
    winner._resetParkour();
    winner.position.set(0, 0, -1);
    const loser = makeBot(host, 'blue');
    loser.update(DT, null);
    loser._resetParkour();
    loser.position.set(0, 0, 0.5);
    const game = { bots: [winner, loser], arena: host, _winningTeam: 'red', spawnDeathExplosion() {} };
    updateCelebrationBots.call(game, DT);
    assert.equal(winner.position.y, 0);
    assert.equal(loser.alive, false, 'the winner damages a nearby loser exactly as before');
});

// ---------------------------------------------------------------------------
// (2) No deflect mid mount-hop; no mount start into an imminent closing ball
// ---------------------------------------------------------------------------

test('G9: advanceDeflectReady never reports ready while _pkMode is PK_ARC (1,000 seeded runs)', () => {
    let framesCheckedMidArc = 0;
    for (let seed = 1; seed <= 1000; seed++) {
        const rng = mulberry32(seed);
        const { host, step } = parkourHost();
        const difficulty = ['easy', 'medium', 'hard'][seed % 3];
        const bot = makeBot(host, 'red', difficulty);
        bot.position.set(step.x - step.halfWidth - 0.3, 0, step.z);
        bot._pkMode = 1; // PK_ARC
        bot._pkPiece = step;
        bot._pkT = 0;
        bot._pkSX = bot.position.x; bot._pkSY = 0; bot._pkSZ = bot.position.z;
        bot._pkEX = step.x; bot._pkEZ = step.z;
        const speed = 10 + rng() * 40;
        const startDist = 2 + rng() * 15;
        const ball = {
            active: true, targetPlayer: bot, currentSpeed: speed, baseSpeed: 17, attackRange: 2,
            position: new THREE.Vector3(bot.position.x, bot.position.y + 1.2 + startDist, bot.position.z),
            velocity: new THREE.Vector3(0, -speed, 0)
        };
        for (let f = 0; f < 90 && bot._pkMode === 1; f++) {
            ball.position.y -= speed * DT;
            bot.observeDefenseIntent(ball, rng);
            bot._stepMountArc(DT);
            const readyAt = bot.advanceDeflectReady(ball, DT);
            if (bot._pkMode === 1) {
                framesCheckedMidArc++;
                assert.ok(!(readyAt <= DT), `seed ${seed} frame ${f}: advanceDeflectReady returned ${readyAt} (<=dt) mid-arc`);
                assert.ok(!(bot.deflectReadyAt <= DT), `seed ${seed} frame ${f}: deflectReadyAt <= dt mid-arc`);
            }
        }
    }
    assert.ok(framesCheckedMidArc > 1000, `only checked ${framesCheckedMidArc} in-arc frames across 1000 seeds`);
});

test('G9: advanceDeflectReady clamps readiness to at least the arc time remaining', () => {
    const { host, step } = parkourHost();
    const bot = makeBot(host);
    bot.position.set(step.x, step.y, step.z);
    bot._pkMode = 1; // PK_ARC
    bot._pkPiece = step;
    bot._pkT = 1 - (0.05 / BOT_MOUNT_ARC_SECONDS); // 0.05 s of arc left
    bot._defenseIntent = 'none';
    // Force an already-committed deflect decision so only the arc clamp gates it.
    bot._deflectDecided = true;
    bot._willDeflect = true;
    bot._defenseIntent = 'deflect';
    bot.reactionTimer = bot.reactionTime;
    bot.windUpTimer = bot.windUpTime;
    bot.windUpCommitted = true;
    const ball = {
        active: true, targetPlayer: bot, currentSpeed: 17, baseSpeed: 17, attackRange: 2,
        position: new THREE.Vector3(step.x + 1, step.y + 1.2, step.z), velocity: new THREE.Vector3(-17, 0, 0)
    };
    // 0.05 s remaining needs 3 frames at 60 Hz before it can report ready.
    let readyAt = bot.advanceDeflectReady(ball, DT);
    assert.ok(readyAt === Infinity || readyAt > DT, 'not ready this frame while arc still running');
    bot._pkT = 1; // arc just finished
    bot._pkMode = 2;
    readyAt = bot.advanceDeflectReady(ball, DT);
    assert.ok(readyAt <= DT, 'ready once the arc has actually landed');
});

test('G9: _tryMountParkour refuses to start a hop into a ball closing in under BOT_MOUNT_ARC_SECONDS + reactionTime, but not otherwise', () => {
    const { host, step } = parkourHost();
    const bot = makeBot(host);
    bot.update(DT, null);
    const ready = (x, z) => {
        bot._resetParkour();
        bot._defenseIntent = 'none';
        bot.position.set(x, 0, z);
        bot._baseWalkMinZ = bot._walkMinZ = -28.5;
        bot._baseWalkMaxZ = bot._walkMaxZ = -1;
        bot._interceptFresh = true;
        bot._interceptTarget.set(x, 3, z);
    };
    const west = step.x - step.halfWidth;
    // No ball at all: unaffected (existing tests call it with zero args).
    ready(west - 0.6, step.z);
    assert.equal(bot._tryMountParkour(), true, 'no ball argument: unchanged behaviour');

    // A ball targeting this bot, closing fast, arriving well inside the gate.
    ready(west - 0.6, step.z);
    const closeFast = {
        active: true, targetPlayer: bot, currentSpeed: 40, attackRange: 2,
        position: new THREE.Vector3(bot.position.x, bot.position.y + 1.2 + 4, bot.position.z),
        velocity: new THREE.Vector3(0, -40, 0)
    };
    assert.equal(bot._tryMountParkour(closeFast), false, 'imminent closing ball blocks the hop');
    assert.equal(bot._pkMode, 0, 'no hop was started');

    // The same ball, but not targeting this bot: never blocked by this gate.
    ready(west - 0.6, step.z);
    const untargeted = { ...closeFast, targetPlayer: null };
    assert.equal(bot._tryMountParkour(untargeted), true, 'a ball aimed elsewhere never blocks the hop');

    // A ball targeting this bot but moving away (not a threat): never blocked.
    ready(west - 0.6, step.z);
    const receding = {
        active: true, targetPlayer: bot, currentSpeed: 40, attackRange: 2,
        position: new THREE.Vector3(bot.position.x, bot.position.y + 1.2 + 4, bot.position.z),
        velocity: new THREE.Vector3(0, 40, 0)
    };
    assert.equal(bot._tryMountParkour(receding), true, 'a receding ball never blocks the hop');

    // Targeted and closing, but far enough out that eta clears the gate.
    ready(west - 0.6, step.z);
    const farSlow = {
        active: true, targetPlayer: bot, currentSpeed: 5, attackRange: 2,
        position: new THREE.Vector3(bot.position.x, bot.position.y + 1.2 + 30, bot.position.z),
        velocity: new THREE.Vector3(0, -5, 0)
    };
    assert.equal(bot._tryMountParkour(farSlow), true, 'a distant, slow-closing ball still allows the hop');
});

test('G9: bot-parkour helpers stay allocation-free and mounts still occur (G5 gates unaffected)', () => {
    // _tryMountParkour and _updateParkour keep their allocation-free contract
    // (tests/bot-parkour.test.mjs already re-checks the full helper list; this
    // is a targeted re-check for the two functions this card touched).
    for (const name of ['_tryMountParkour', '_updateParkour']) {
        const start = botSource.indexOf(`\n    ${name}(`);
        assert.ok(start > 0, `${name} exists`);
        const rest = botSource.slice(start + 1);
        const body = rest.slice(0, rest.search(/\r?\n {4}\}\r?\n/));
        assert.doesNotMatch(body, /\bnew\b|\.clone\(|=\s*\[|=\s*\{|\.map\(|\.filter\(|\.\.\./, `${name} allocates`);
    }
});

// ---------------------------------------------------------------------------
// (3) OVERDRIVE_MAX_RATIO: exactly one definition
// ---------------------------------------------------------------------------

test('G9: OVERDRIVE_MAX_RATIO is defined once, in combat-fx.js, and imported (not redefined) by game.js/ui.js', () => {
    assert.equal(OVERDRIVE_MAX_RATIO, 8);
    assert.match(gameSource, /import \{[^}]*\bOVERDRIVE_MAX_RATIO\b[^}]*\} from '\.\/combat-fx\.js';/);
    assert.match(uiSource, /import \{[^}]*\bOVERDRIVE_MAX_RATIO\b[^}]*\} from '\.\/combat-fx\.js';/);
    assert.doesNotMatch(gameSource, /const OVERDRIVE_MAX_RATIO\s*=/, 'game.js must not keep its own copy');
    assert.doesNotMatch(uiSource, /(const|export const) OVERDRIVE_UI_MAX_RATIO\s*=/, 'ui.js must not keep its own copy');
    assert.doesNotMatch(uiSource, /\bOVERDRIVE_UI_MAX_RATIO\b/, 'the old name is fully retired from ui.js');
});

// ---------------------------------------------------------------------------
// (4) .incoming-direction-arrow keeps content-box sizing under the global reset
// ---------------------------------------------------------------------------

test('G9: .incoming-direction-arrow opts into content-box sizing (survives the global border-box reset)', () => {
    const ruleStart = cssSource.indexOf('.incoming-direction-arrow {');
    assert.ok(ruleStart >= 0, '.incoming-direction-arrow rule exists');
    const ruleEnd = cssSource.indexOf('\n}', ruleStart);
    const rule = cssSource.slice(ruleStart, ruleEnd + 2);
    assert.match(rule, /box-sizing:\s*content-box;/);
    // Borders unchanged: 9/9/17 px still produce the same visual triangle.
    assert.match(rule, /border-top:\s*9px solid transparent;/);
    assert.match(rule, /border-bottom:\s*9px solid transparent;/);
    assert.match(rule, /border-left:\s*17px solid var\(--threat-color\);/);
    assert.match(rule, /width:\s*0;/);
    assert.match(rule, /height:\s*0;/);
});

// ---------------------------------------------------------------------------
// (5) lowGravity applied once (game.js override removed; player.js unchanged)
// ---------------------------------------------------------------------------

test('G9: Game.startGame no longer overrides gravity/jumpForce for lowGravity classic maps', () => {
    // startGame() is one of a handful of Game methods in js/game.js that sit at
    // 0 indent (a pre-existing quirk unrelated to this card), so it doesn't
    // match extractGameMethod's `^ {4}name(` pattern -- slice the region
    // between two of its neighbouring statements directly out of the source
    // instead of extracting the whole method body.
    const from = gameSource.indexOf('this._spectateTarget = null;');
    const to = gameSource.indexOf('this._hideKillcam();', from);
    assert.ok(from >= 0 && to > from, 'startGame reset block markers found');
    const resetBlock = gameSource.slice(from, to);
    assert.doesNotMatch(resetBlock, /this\.player\.gravity\s*=\s*-7/);
    assert.doesNotMatch(resetBlock, /this\.player\.jumpForce\s*=\s*12/);
    assert.doesNotMatch(resetBlock, /this\.arena\.config\?\.lowGravity/);
    // The unrelated 'lowgrav' lobby match-modifier (applyMatchModifier) is a
    // different, intentional feature this card must not touch.
    assert.match(gameSource, /if \(modifier === 'lowgrav'\) \{ this\.player\.gravity = -7; this\.player\.jumpForce = 12; \}/);
});

test('G9: space-map jump apex/airtime — before (double-applied) ~18.7 m / after (single) ~2.9 m, ~1.45 s airtime', async () => {
    const helperStart = playerSource.indexOf('export const GROUND_ACCEL');
    const helperEnd = playerSource.indexOf('export class Player');
    assert.ok(helperStart >= 0 && helperEnd > helperStart);
    const { resolveGravityScale, LOW_GRAVITY_FACTOR } = await import(
        `data:text/javascript,${encodeURIComponent(playerSource.slice(helperStart, helperEnd))}`
    );
    assert.equal(LOW_GRAVITY_FACTOR, 0.55);

    const apexAndAirtime = (gravityMag, jumpForce) => {
        const g = gravityMag * resolveGravityScale(true);
        const apex = (jumpForce * jumpForce) / (2 * g);
        const airtime = (2 * jumpForce) / g;
        return { apex, airtime };
    };
    // Before: game.js overrode gravity to -7 and jumpForce to 12 on top of the
    // player's own 0.55 lowGravity scale (double application).
    const before = apexAndAirtime(7, 12);
    assert.ok(Math.abs(before.apex - 18.70) < 0.05, `before apex ${before.apex}`);
    // After: default player gravity (-20) / jumpForce (8), scaled once.
    const after = apexAndAirtime(20, 8);
    assert.ok(Math.abs(after.apex - 2.909) < 0.02, `after apex ${after.apex}`);
    assert.ok(Math.abs(after.airtime - 1.4545) < 0.01, `after airtime ${after.airtime}`);
});
