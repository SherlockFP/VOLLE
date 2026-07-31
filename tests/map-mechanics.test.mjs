// map-mechanics.test.mjs — Ice/Cloud/Jungle map mechanics (slippery, lowGravity,
// waterZones). Verifies the three flags are opt-in per map (default off for every
// pre-existing map) and exercises the pure friction/gravity/water helper functions
// in js/player.js with normal and hostile (NaN/undefined) inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// --- arena.js: load with THREE/weather/goal-mode stubbed out, same technique as
// tests/arena-config.test.mjs (no `three` package installed for this project). ---
const arenaPath = new URL('../js/arena.js', import.meta.url);
const arenaSource = await readFile(arenaPath, 'utf8');
const arenaModuleSource = arenaSource
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, '')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');

const { MAPS, Arena } = await import(
    `data:text/javascript;base64,${Buffer.from(arenaModuleSource).toString('base64')}`
);

// --- player.js: extract only the pure helper section (before `export class Player`),
// same technique as tests/player-movement.test.mjs, to avoid importing THREE/DOM deps. ---
const playerSource = await readFile(new URL('../js/player.js', import.meta.url), 'utf8');
const helperStart = playerSource.indexOf('export const GROUND_ACCEL');
const helperEnd = playerSource.indexOf('export class Player');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'player.js helper section markers found');
const {
    moveHorizontalState,
    resolveGravityScale,
    resolveMovementSpeedMultiplier,
    SLIPPERY_SURFACE_FACTOR,
    LOW_GRAVITY_FACTOR
} = await import(`data:text/javascript,${encodeURIComponent(playerSource.slice(helperStart, helperEnd))}`);

const NEW_MAP_IDS = ['ice', 'cloud', 'jungle'];
// space already shipped map-specific low gravity before this task (see MIMO.md /
// AGENTS.md) — its lowGravity:true predates and is unrelated to the new opt-in flag.
const PREEXISTING_LOW_GRAVITY_ALLOWLIST = new Set(['space']);

const REQUIRED_FIELDS = [
    'name', 'courtWidth', 'courtLength', 'wallHeight', 'ceilingHeight',
    'floorRed', 'floorBlue', 'wallColor', 'skyTop', 'skyBottom', 'fogColor',
    'size', 'weather'
];

test('ice/cloud/jungle maps exist with all required fields populated', () => {
    for (const id of NEW_MAP_IDS) {
        const config = MAPS[id];
        assert.ok(config, `MAPS.${id} exists`);
        for (const field of REQUIRED_FIELDS) {
            assert.notEqual(config[field], undefined, `MAPS.${id}.${field} is set`);
        }
        assert.equal(typeof config.name, 'string');
        assert.ok(config.name.length > 0);
        assert.ok(Number.isFinite(config.courtWidth) && config.courtWidth > 0);
        assert.ok(Number.isFinite(config.courtLength) && config.courtLength > 0);
    }
});

test('ice map opts into slippery, cloud into lowGravity, jungle into waterZones', () => {
    assert.equal(MAPS.ice.slippery, true);
    assert.equal(MAPS.cloud.lowGravity, true);
    assert.equal(MAPS.jungle.waterZones, true);

    // Cross-flag isolation — each map opts into exactly its own mechanic, not the others.
    assert.ok(!MAPS.ice.lowGravity);
    assert.ok(!MAPS.ice.waterZones);
    assert.ok(!MAPS.cloud.slippery);
    assert.ok(!MAPS.cloud.waterZones);
    assert.ok(!MAPS.jungle.slippery);
    assert.ok(!MAPS.jungle.lowGravity);
});

test('slippery/lowGravity/waterZones default off on every pre-existing map', () => {
    for (const [id, config] of Object.entries(MAPS)) {
        if (NEW_MAP_IDS.includes(id)) continue;
        assert.ok(!config.slippery, `${id}.slippery should be falsy`);
        assert.ok(!config.waterZones, `${id}.waterZones should be falsy`);
        if (!PREEXISTING_LOW_GRAVITY_ALLOWLIST.has(id)) {
            assert.ok(!config.lowGravity, `${id}.lowGravity should be falsy`);
        }
    }
    // The allowlisted exception is exactly what it claims to be.
    assert.equal(MAPS.space.lowGravity, true);
});

test('jungle waterZones config drives Arena hazard-zone generation (kind: water, slow)', () => {
    const fakeArena = {
        config: MAPS.jungle,
        courtWidth: MAPS.jungle.courtWidth,
        courtLength: MAPS.jungle.courtLength,
        hazardZones: []
    };
    Arena.prototype._buildHazardZones.call(fakeArena);
    assert.ok(fakeArena.hazardZones.length > 0, 'jungle produces at least one water zone');
    for (const zone of fakeArena.hazardZones) {
        assert.equal(zone.kind, 'water');
        assert.equal(zone.slow, 0.55);
        assert.ok(Number.isFinite(zone.x) && Number.isFinite(zone.z) && Number.isFinite(zone.radius));
    }

    // getHazardAt finds a zone when standing in it, and null outside it.
    const zone = fakeArena.hazardZones[0];
    const inside = Arena.prototype.getHazardAt.call(fakeArena, { x: zone.x, z: zone.z });
    assert.equal(inside, zone);
    const outside = Arena.prototype.getHazardAt.call(fakeArena, { x: zone.x + 10000, z: zone.z + 10000 });
    assert.equal(outside, null);
});

test('maps without waterZones never generate water hazard zones', () => {
    for (const [id, config] of Object.entries(MAPS)) {
        if (config.waterZones) continue;
        const fakeArena = {
            config,
            courtWidth: config.courtWidth,
            courtLength: config.courtLength,
            hazardZones: []
        };
        Arena.prototype._buildHazardZones.call(fakeArena);
        assert.ok(
            !fakeArena.hazardZones.some(z => z.kind === 'water'),
            `${id} must not produce water hazard zones`
        );
    }
});

test('slippery ground factor reduces both friction and acceleration (matches existing ice mechanic)', () => {
    const coast = moveHorizontalState({ x: 10, z: 0 }, { x: 0, z: 0 }, 10, 1 / 120, true, SLIPPERY_SURFACE_FACTOR);
    const normalCoast = moveHorizontalState({ x: 10, z: 0 }, { x: 0, z: 0 }, 10, 1 / 120, true, 1);
    // Slippery surface bleeds off far less speed per step than a normal surface.
    assert.ok((10 - coast.velocity.x) < (10 - normalCoast.velocity.x));
    assert.ok(Number.isFinite(coast.velocity.x));
});

test('slippery factor does not touch airborne movement (dash/wall-jump/longjump velocity unaffected)', () => {
    // onGround=false path ignores surfaceFactor entirely — bhop/dash/walljump/longjump
    // set velocity.x/z directly and are never routed through moveHorizontalState's
    // ground-friction branch, so a slippery map cannot desync those mechanics.
    const airNormal = moveHorizontalState({ x: 5, z: 0 }, { x: 1, z: 0 }, 10, 1 / 60, false, 1);
    const airSlippery = moveHorizontalState({ x: 5, z: 0 }, { x: 1, z: 0 }, 10, 1 / 60, false, SLIPPERY_SURFACE_FACTOR);
    assert.equal(airNormal.velocity.x, airSlippery.velocity.x);
    assert.equal(airNormal.velocity.z, airSlippery.velocity.z);
});

test('resolveGravityScale reuses the Space map lowGravity mechanism (no NaN for hostile input)', () => {
    assert.equal(resolveGravityScale(true), LOW_GRAVITY_FACTOR);
    assert.equal(LOW_GRAVITY_FACTOR, 0.55);
    assert.equal(resolveGravityScale(false), 1);
    assert.equal(resolveGravityScale(undefined), 1);
    assert.equal(resolveGravityScale(null), 1);
    assert.equal(resolveGravityScale(NaN), 1);
    assert.equal(resolveGravityScale(0), 1);
    assert.ok(Number.isFinite(resolveGravityScale(undefined)));
    assert.ok(Number.isFinite(resolveGravityScale(true)));
});

test('resolveMovementSpeedMultiplier (water/hazard slow) is always finite for hostile input', () => {
    // Normal cases
    assert.equal(resolveMovementSpeedMultiplier(false, undefined), 1);
    assert.equal(resolveMovementSpeedMultiplier(false, 0.55), 0.55);
    assert.equal(resolveMovementSpeedMultiplier(true, undefined), 0.8);
    assert.equal(resolveMovementSpeedMultiplier(true, 0.55), 0.8 * 0.55);

    // Hostile inputs must never produce NaN or a runaway multiplier
    for (const hostile of [NaN, undefined, null, -1, 0, Infinity, -Infinity, 'water']) {
        const result = resolveMovementSpeedMultiplier(false, hostile);
        assert.ok(Number.isFinite(result), `finite result for hazardMoveMul=${String(hostile)}`);
        assert.ok(result > 0, `positive result for hazardMoveMul=${String(hostile)}`);
    }
    for (const hostile of [NaN, undefined, null]) {
        const result = resolveMovementSpeedMultiplier(hostile, 0.55);
        assert.ok(Number.isFinite(result), `finite result for chillActive=${String(hostile)}`);
    }
});
