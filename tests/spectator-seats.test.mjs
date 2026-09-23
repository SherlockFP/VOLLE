// Stands seating for joined spectators: per-map seat anchors on the sidelines,
// symmetric left/right, outside the court, backed by real stand geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    computeSpectatorSeats,
    findFreeSeat,
    generatedSidelineStands,
    neighborSeat
} from '../js/spectator-seats.js';
import { SpectatorRoster, sanitizeSpectatorList } from '../js/spectator-roster.js';
import { clampStandsLook, CAMERA_MODES, JOINED_SPECTATOR_MODES, SpectatorClass, STANDS_YAW_LIMIT, povEyeOffset } from '../js/spectator.js';

// Load the real MAPS (ensureMapMetadata applied) the same way the arena suites do.
const arenaSource = await readFile(new URL('../js/arena.js', import.meta.url), 'utf8');
const moduleSource = arenaSource
    .replace(/^import \* as THREE from 'three';?[\r\n]*/m, '')
    .replace(/^import \{ WeatherSystem \} from '\.\/weather\.js';?[\r\n]*/m, 'const WeatherSystem = {};\n')
    .replace(/^import \{ computeGoalZones \} from '\.\/goal-mode\.js';?[\r\n]*/m, 'const computeGoalZones = () => null;\n')
    .replace(/^import \{ getTexture, clearTextureCache \} from '\.\/procedural-textures\.js';?[\r\n]*/m, 'const getTexture = () => null; const clearTextureCache = () => {};\n')
    .replace(/^import \{ loadArenaDecor, disposeArenaDecor, preloadTrophyTemplate \} from '\.\/arena-decor\.js';?[\r\n]*/m, 'const loadArenaDecor = async () => null; const disposeArenaDecor = () => {}; const preloadTrophyTemplate = () => {};\n')
    .replace(/^import \{ loadSkyboxTexture, resolveFogColor \} from '\.\/skybox-loader\.js';?[\r\n]*/m, 'const loadSkyboxTexture = async () => null; const resolveFogColor = (hex) => hex;\n');
assert.equal(/^import /m.test(moduleSource), false, 'arena.js must stay loadable by the arena test transform');
const { MAPS } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);

const playable = Object.entries(MAPS).filter(([, config]) => !config.practiceOnly && !config.isCosmeticStudio);

test('every playable map has sideline stands built by the arena (no floating seats)', () => {
    for (const [id, config] of playable) {
        const sides = new Set(config.spectator.stands.map(stand => stand.side));
        assert.ok(sides.has('west') && sides.has('east'), `${id} needs west+east stands`);
        // The arena already added them, so the seat module's fallback generator is a no-op.
        assert.deepEqual(generatedSidelineStands(config), [], `${id} arena/seat stand generators diverged`);
    }
});

test('arena-generated sideline stands match the seat module generator exactly', () => {
    const raw = { courtWidth: 60, courtLength: 80, spectator: { stands: [{ side: 'north', tiers: 3 }] } };
    const expected = generatedSidelineStands(raw);
    const temple = MAPS.temple_sym; // no configured stands -> default north/south + generated sidelines
    const generated = temple.spectator.stands.filter(stand => stand.generated);
    assert.deepEqual(generated, generatedSidelineStands({ ...temple, spectator: { stands: [] } }));
    assert.equal(expected.length, 2);
});

test('seat anchors are left/right symmetric, outside the court and facing it', () => {
    for (const [id, config] of playable) {
        const seats = computeSpectatorSeats(config);
        assert.ok(seats.length >= 2, `${id} has seats`);
        const west = seats.filter(seat => seat.side === 'west');
        const east = seats.filter(seat => seat.side === 'east');
        assert.equal(west.length, east.length, `${id} same seat count per side`);
        const halfW = config.courtWidth / 2;
        west.forEach((seat, i) => {
            const mirror = east[i];
            assert.equal(mirror.x, -seat.x, `${id} seat ${i} x mirror`);
            assert.equal(mirror.y, seat.y);
            assert.equal(mirror.z, seat.z);
            assert.equal(mirror.tier, seat.tier);
            assert.ok(seat.x < -halfW && mirror.x > halfW, `${id} seats are off the court`);
            assert.ok(seat.y > 0);
            // Facing the court: forward = (-sin(yaw), 0, -cos(yaw)) points toward x = 0.
            assert.ok(-Math.sin(seat.yaw) > 0.99 && -Math.sin(mirror.yaw) < -0.99);
        });
        seats.forEach((seat, index) => assert.equal(seat.index, index));
    }
});

test('seat picking fills the front row centre first and alternates sides', () => {
    const seats = computeSpectatorSeats(MAPS.beach_open);
    const roster = new SpectatorRoster();
    const a = roster.add('p-a', 'A', 'peer-a', seats);
    const b = roster.add('p-b', 'B', 'peer-b', seats);
    assert.equal(seats[a.seat].side, 'west');
    assert.equal(seats[b.seat].side, 'east');
    assert.equal(seats[a.seat].tier, 0);
    assert.ok(Math.abs(seats[a.seat].z) <= 1);
    assert.equal(findFreeSeat(seats, new Set(seats.map(seat => seat.index))), -1);
});

test('seat hops move along the row / up the tiers and skip occupied seats', () => {
    const seats = computeSpectatorSeats(MAPS.beach_open);
    const start = findFreeSeat(seats, new Set(), 'west');
    const right = neighborSeat(seats, start, 'right');
    assert.equal(seats[right].tier, seats[start].tier);
    assert.ok(seats[right].z > seats[start].z, 'west spectator: right hand is +z');
    const skip = neighborSeat(seats, start, 'right', new Set([right]));
    assert.equal(seats[skip].slot, seats[start].slot + 2);
    const up = neighborSeat(seats, start, 'up');
    assert.equal(seats[up].tier, seats[start].tier + 1);
    assert.equal(neighborSeat(seats, start, 'down'), start, 'front row cannot go lower');
    const across = neighborSeat(seats, start, 'across');
    assert.equal(seats[across].side, 'east');
    assert.equal(seats[across].x, -seats[start].x);
    const eastRight = neighborSeat(seats, across, 'right');
    assert.ok(seats[eastRight].z < seats[across].z, 'east spectator: right hand is -z');
});

test('roster: host validates moves, reseats after a map change, clients sanitize the wire list', () => {
    const seats = computeSpectatorSeats(MAPS.beach_open);
    const roster = new SpectatorRoster();
    const a = roster.add('p-a', 'A', 'peer-a', seats);
    const b = roster.add('p-b', 'B', 'peer-b', seats);
    assert.equal(roster.move('p-a', b.seat, seats), false, 'occupied seat');
    assert.equal(roster.move('p-a', seats.length, seats), false, 'seat out of range');
    assert.equal(roster.move('p-a', 0, seats), true);
    assert.equal(roster.get('p-a').seat, 0);
    assert.equal(roster.move('nobody', 1, seats), false);

    const smaller = seats.slice(0, 1);
    assert.equal(roster.reseat(smaller), true);
    const assigned = roster.list().map(entry => entry.seat);
    assert.equal(new Set(assigned.filter(seat => seat >= 0)).size, assigned.filter(seat => seat >= 0).length);

    const clean = sanitizeSpectatorList([
        { playerId: 'ok-1', name: 'x'.repeat(80), seat: 2 },
        { playerId: 'ok-1', name: 'dup', seat: 3 },
        { playerId: 'bad id', name: 'nope', seat: 1 },
        { playerId: 'ok-2', name: '', seat: 2 },
        { playerId: 'ok-3', seat: 99 }
    ], 10);
    assert.deepEqual(clean, [
        { playerId: 'ok-1', name: 'x'.repeat(32), seat: 2 },
        { playerId: 'ok-2', name: 'Spectator', seat: -1 },
        { playerId: 'ok-3', name: 'Spectator', seat: -1 }
    ]);
    assert.equal(a.playerId, 'p-a');
});

test('stands camera: limited look-around, no free roam, seated eye height', () => {
    const look = clampStandsLook(-Math.PI / 2 + 3, 2, -Math.PI / 2);
    assert.ok(Math.abs(look.yaw - (-Math.PI / 2 + STANDS_YAW_LIMIT)) < 1e-9);
    assert.ok(look.pitch <= 0.45);
    assert.equal(JOINED_SPECTATOR_MODES.includes(CAMERA_MODES.FREE_ROAM), false);

    const lookAt = [];
    const camera = {
        position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        lookAt: (x, y, z) => lookAt.push([x, y, z])
    };
    const spectator = new SpectatorClass();
    spectator.camera = camera;
    spectator.active = true;
    spectator.setAllowedModes(JOINED_SPECTATOR_MODES);
    assert.equal(spectator.setCameraMode(CAMERA_MODES.FREE_ROAM), false, 'joined spectators cannot free roam');
    assert.equal(spectator.setCameraMode(CAMERA_MODES.STANDS), false, 'stands needs a seat first');
    const seat = computeSpectatorSeats(MAPS.beach_open)[0];
    spectator.setSeat(seat);
    assert.equal(spectator.setCameraMode(CAMERA_MODES.STANDS), CAMERA_MODES.STANDS);
    spectator.yaw += 10;
    spectator.update(1 / 60);
    assert.ok(Math.abs(camera.position.x - seat.x) < 1e-9 && Math.abs(camera.position.z - seat.z) < 1e-9);
    assert.ok(camera.position.y > seat.y && camera.position.y < seat.y + 1.5);
    assert.ok(Math.abs(spectator.yaw - seat.yaw) <= STANDS_YAW_LIMIT + 1e-9);
    const [lx] = lookAt.at(-1);
    assert.ok(lx > camera.position.x, 'west seat keeps looking toward the court');
    assert.equal(spectator.getState().context, 'joined');
    spectator.setAllowedModes(null);
    assert.equal(spectator.getState().context, undefined);
    assert.equal(povEyeOffset({ position: { y: 0 } }), 1.55);
    assert.equal(povEyeOffset({ position: { y: 1.7 } }), 0.1);
});
