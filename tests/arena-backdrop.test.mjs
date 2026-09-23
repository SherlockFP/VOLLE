// arena-backdrop.test.mjs — the world outside the court (js/map-art/backdrop.js),
// the procedural sky and the rolled weather (js/arena.js + js/weather.js), on
// the REAL vendored three.js (no WebGL; no-op canvas for CanvasTextures):
//   * every themed backdrop stays strictly outside the court and the stands,
//     never collides, and fits its draw-call budget on every quality tier;
//   * weather is rolled from the map's pool + arena.weatherSeed: identical for
//     identical inputs (network-safe), mostly clear, and rain/snow only where
//     the biome allows it; setWeatherSeed re-rolls in place;
//   * rain/snow are GPU particles that fade at the lens and cost no per-frame
//     buffer uploads; the sky stays one draw call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { installFakeDocument } from './helpers/fake-canvas.mjs';

const vendor = new URL('../vendor/three/', import.meta.url);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
        if (specifier.startsWith('three/addons/')) {
            return { url: new URL(`addons/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    }
});
installFakeDocument();
globalThis.window ||= { innerWidth: 1280, innerHeight: 720 };

const THREE = await import('three');
const {
    Arena, MAPS, MAP_BACKDROPS, MAP_WEATHER_POOLS, WEATHER_KINDS, WEATHER_LOOK,
    rollMapWeather, mapWeatherPool, arenaPresentationProfile
} = await import('../js/arena.js');
const backdrop = await import('../js/map-art/backdrop.js');
const art = await import('../js/map-art/index.js');
const { WeatherSystem, WEATHER_PARTICLE_COUNTS } = await import('../js/weather.js');
const { SPORTS } = await import('../js/sports.js');

const DODGEBALL_MAPS = SPORTS.dodgeball.mapIds;
// Biomes where snow is believable; everything else may only rain.
const SNOW_MAPS = new Set(['ice', 'alpine_research', 'dojo', 'crystal', 'minecraft']);
// Enclosed rooms, space and underwater never get weather.
const DRY_MAPS = new Set(['space', 'circuit_dome', 'esport_arena', 'aquarium', 'museum', 'casino', 'subway',
    'orbital_station', 'atlantis', 'cloud', 'mega_pinball', 'lava', 'sunbaked_bazaar']);

function makeRenderer(quality = 'medium') {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x6fdfd9, 60, 180);
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
    sun.position.set(15, 30, 10);
    scene.add(sun, new THREE.AmbientLight(0x8899cc, 0.6), new THREE.HemisphereLight(0xbfe6ff, 0xffd8a8, 0.45));
    return {
        scene, sun, _quality: quality,
        renderer: { setClearColor() {}, toneMappingExposure: 1 },
        createToonMaterial: color => new THREE.MeshBasicMaterial({ color }),
        shouldLightDecor: () => quality !== 'low',
        setBloomProfile() {}
    };
}

function drawCalls(objects) {
    let calls = 0;
    const visit = object => {
        if (object.visible === false) return;
        if (object.isMesh || object.isPoints || object.isLine) calls += 1;
        for (const child of object.children || []) visit(child);
    };
    for (const object of objects) visit(object);
    return calls;
}

const vertex = new THREE.Vector3();
const instanceMatrix = new THREE.Matrix4();
function forEachWorldVertex(mesh, fn) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute('position');
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    for (let i = 0; i < count; i++) {
        let matrix = mesh.matrixWorld;
        if (mesh.isInstancedMesh) {
            mesh.getMatrixAt(i, instanceMatrix);
            matrix = instanceMatrix.premultiply(mesh.matrixWorld);
        }
        for (let v = 0; v < position.count; v++) fn(vertex.fromBufferAttribute(position, v).applyMatrix4(matrix));
    }
}

function buildBackdrop(id, quality = 'medium') {
    const arena = new Arena(makeRenderer(quality), id);
    const collidables = arena.collidables.length;
    const platforms = arena.platforms.length;
    const meshes = backdrop.buildBackdrop(arena, arena._mapArtTier());
    return { arena, meshes, collidables, platforms };
}

test('every dodgeball map has a weather pool and backdrop decision; themes exist', () => {
    for (const id of DODGEBALL_MAPS) {
        assert.ok(Object.hasOwn(MAP_WEATHER_POOLS, id), `${id} has a weather pool`);
        const theme = MAP_BACKDROPS[id];
        if (theme) assert.ok(backdrop.BACKDROP_THEMES.includes(theme), `${id}: theme ${theme} is implemented`);
    }
    // Open-air maps all get a backdrop; only enclosed rooms / self-dressed maps skip it.
    const skipped = DODGEBALL_MAPS.filter(id => !MAP_BACKDROPS[id]).sort();
    assert.deepEqual(skipped, ['aquarium', 'casino', 'museum', 'neon_rooftop', 'orbital_station', 'subway']);
    assert.equal(art.buildBackdrop, backdrop.buildBackdrop, 'shipped in the lazily loaded map-art chunk');
});

test('backdrops stay strictly outside the court and the stands, never collide, fit the draw-call budget', () => {
    for (const id of DODGEBALL_MAPS.filter(map => MAP_BACKDROPS[map])) {
        const calls = {};
        for (const quality of ['low', 'medium', 'high']) {
            const { arena, meshes, collidables, platforms } = buildBackdrop(id, quality);
            const { hx, hz } = backdrop.backdropExclusion(arena);
            const halfW = arena.courtWidth / 2;
            const halfL = arena.courtLength / 2;
            assert.ok(meshes.length > 0, `${id}/${quality} builds a backdrop`);
            calls[quality] = drawCalls(meshes);
            assert.ok(calls[quality] <= backdrop.BACKDROP_DRAW_CALL_BUDGET,
                `${id}/${quality}: ${calls[quality]} draw calls <= ${backdrop.BACKDROP_DRAW_CALL_BUDGET}`);
            assert.equal(arena.collidables.length, collidables, `${id}: backdrop registers no collider`);
            assert.equal(arena.platforms.length, platforms, `${id}: backdrop registers no platform`);
            for (const mesh of meshes) {
                assert.ok(mesh.isMesh && !mesh.isPoints && !mesh.isLine, `${id}: ${mesh.name} is a mesh`);
                assert.equal(mesh.userData.passThrough, true, `${id}: ${mesh.name} is pass-through`);
                assert.ok(arena.objects.includes(mesh), `${id}: ${mesh.name} is owned by the arena (disposed on clearMap)`);
                assert.equal(mesh.castShadow, false, `${id}: ${mesh.name} casts no shadow`);
                const ground = mesh.name === 'backdrop-ground' || mesh.name === 'backdrop-sea' || mesh.name === 'backdrop-cloud-sea';
                let bad = 0;
                forEachWorldVertex(mesh, p => {
                    if (ground) {
                        // Court cut out; under the stands it stays below the floor.
                        if (Math.abs(p.x) < halfW - 1e-3 && Math.abs(p.z) < halfL - 1e-3) bad++;
                        else if (Math.abs(p.x) < hx && Math.abs(p.z) < hz && p.y > 0) bad++;
                    } else if (Math.abs(p.x) < hx && Math.abs(p.z) < hz) {
                        bad++;
                    }
                });
                assert.equal(bad, 0, `${id}/${quality}: ${mesh.name} has ${bad} vertices inside the court/stands`);
            }
            arena.clearMap();
        }
        assert.ok(calls.low <= calls.medium, `${id}: Low (${calls.low}) is never heavier than Medium (${calls.medium})`);
    }
});

test('backdrops are deterministic and fully disposed with the map', () => {
    const signature = id => {
        const { arena, meshes } = buildBackdrop(id);
        const sig = meshes.map(mesh => {
            const pos = mesh.geometry.getAttribute('position');
            return `${mesh.name}:${pos.count}:${mesh.count ?? 1}:${pos.getX(pos.count - 1).toFixed(3)}`;
        }).join('|');
        const before = arena.scene.children.length;
        arena.clearMap();
        assert.ok(arena.scene.children.length < before, 'clearMap removes the backdrop');
        assert.equal(arena._backdropHaze, null, 'clearMap drops the haze uniforms');
        return sig;
    };
    for (const id of ['beach_open', 'alpine_research', 'neon', 'minecraft']) assert.equal(signature(id), signature(id), id);
});

test('the resort backdrop is a hotel beach: sea, hotels with lit windows, palms, pool decks', () => {
    const { arena, meshes } = buildBackdrop('beach_open');
    const names = meshes.map(mesh => mesh.name);
    for (const name of ['backdrop-ground', 'backdrop-sea', 'backdrop-hotels', 'backdrop-palms', 'backdrop-resort-props']) {
        assert.ok(names.includes(name), `resort has ${name}`);
    }
    const hotels = meshes.find(mesh => mesh.name === 'backdrop-hotels');
    assert.ok(hotels.material.map && hotels.material.emissiveMap, 'hotel facades carry a window texture + lit-window mask');
    const low = buildBackdrop('beach_open', 'low');
    assert.ok(!low.meshes.some(mesh => mesh.name === 'backdrop-palms'), 'Low skips the palm grove');
    low.arena.clearMap();
    arena.clearMap();
});

test('the map-art loader builds the backdrop lazily (token-guarded) and the generic tree line is gone', async () => {
    const arena = new Arena(makeRenderer(), 'canyon');
    assert.ok(!arena.objects.some(o => o.userData?.backdrop), 'not built synchronously');
    await Arena._mapArtModule;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(arena.objects.some(o => o.userData?.backdrop === 'canyon'), 'the lazy chunk dressed the map');
    arena.clearMap();

    const stale = new Arena(makeRenderer(), 'jungle');
    stale.clearMap(); // switched away before the chunk resolved
    await Arena._mapArtModule;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(!stale.objects.some(o => o.userData?.backdrop), 'a stale load is dropped');

    // buildOpenEnv's random trees/hills no longer duplicate a themed backdrop.
    const lava = new Arena(makeRenderer(), 'lava');
    const cones = lava.objects.filter(o => o.isMesh && o.geometry?.type === 'ConeGeometry' && o.material?.opacity === 0.65);
    assert.equal(cones.length, 0, 'no generic cone trees on a themed map');
    lava.clearMap();
});

test('weather pools: mostly clear, and rain/snow only where the biome allows', () => {
    for (const id of DODGEBALL_MAPS) {
        const pool = MAP_WEATHER_POOLS[id];
        let wet = 0;
        for (const [kind, chance] of Object.entries(pool)) {
            assert.ok(WEATHER_KINDS.includes(kind) && kind !== 'clear', `${id}: ${kind} is a weather`);
            assert.ok(chance > 0 && chance <= 0.5, `${id}: ${kind} chance ${chance}`);
            if (kind === 'snow') assert.ok(SNOW_MAPS.has(id), `${id} may not snow`);
            wet += chance;
        }
        assert.ok(wet <= 0.5, `${id}: at most half the matches have weather (${wet})`);
        if (DRY_MAPS.has(id)) assert.equal(wet, 0, `${id} never has weather`);
        if (MAPS[id].weather === 'indoor') assert.equal(wet, 0, `${id} is indoor`);
    }
    // The classic open-air maps really do get weather sometimes.
    for (const id of ['beach', 'beach_open', 'jungle', 'harbor_nightworks', 'neon']) assert.ok((MAP_WEATHER_POOLS[id].rain || 0) > 0, `${id} can rain`);
    for (const id of ['alpine_research', 'ice']) assert.ok(MAP_WEATHER_POOLS[id].snow > 0, `${id} can snow`);
    // Custom maps (no pool) keep their configured weather.
    assert.deepEqual(mapWeatherPool('custom-x', { weather: 'snow' }), { snow: 1 });
    assert.deepEqual(mapWeatherPool('custom-y', { weather: 'indoor' }), {});
    assert.equal(rollMapWeather('custom-x', 3, { weather: 'snow' }), 'snow');
});

test('the weather roll is deterministic per (mapId, seed) and matches the pool odds', () => {
    for (const id of DODGEBALL_MAPS) {
        const pool = MAP_WEATHER_POOLS[id];
        const counts = { clear: 0, rain: 0, snow: 0, storm: 0 };
        for (let seed = 0; seed < 1000; seed++) {
            const kind = rollMapWeather(id, seed);
            assert.equal(rollMapWeather(id, seed), kind, `${id}#${seed} is stable`);
            counts[kind]++;
        }
        for (const kind of ['rain', 'snow', 'storm']) {
            const expected = (pool[kind] || 0) * 1000;
            assert.ok(Math.abs(counts[kind] - expected) <= 60, `${id}: ${kind} ${counts[kind]} ~ ${expected}`);
        }
        assert.ok(counts.clear >= 450, `${id}: mostly clear (${counts.clear}/1000)`);
    }
    // Seeds change the outcome somewhere (the roll is not constant per map).
    const outcomes = new Set(Array.from({ length: 40 }, (_, seed) => rollMapWeather('jungle', seed)));
    assert.ok(outcomes.size >= 2);
});

test('Arena applies the rolled weather from weatherSeed and re-rolls in place', () => {
    const renderer = makeRenderer();
    const arena = new Arena(renderer, 'alpine_research');
    assert.equal(arena.weatherSeed, 0, 'weatherSeed defaults to 0');
    const findSeed = kind => {
        for (let seed = 0; seed < 200; seed++) if (rollMapWeather('alpine_research', seed) === kind) return seed;
        throw new Error(`no ${kind} seed`);
    };
    const snowSeed = findSeed('snow');
    const clearSeed = findSeed('clear');

    arena.weatherSeed = snowSeed;
    arena.rebuild('alpine_research');
    assert.equal(arena.weatherType, 'snow');
    assert.ok(arena.weather?.snowMesh, 'snow particles exist');
    assert.equal(arena.skybox.material.uniforms.overcast.value, WEATHER_LOOK.snow.overcast, 'sky clouds over');
    assert.ok(Math.abs(renderer.sun.intensity - arenaPresentationProfile('alpine_research').sun * WEATHER_LOOK.snow.sunScale) < 1e-9);
    const groups = () => renderer.scene.children.filter(child => child.name === 'weather').length;
    assert.equal(groups(), 1);

    assert.equal(arena.setWeatherSeed(clearSeed), 'clear');
    assert.equal(arena.weather, null, 'clear weather has no particle system');
    assert.equal(groups(), 0, 'the old weather group left the scene');
    assert.equal(arena.skybox.material.uniforms.overcast.value, 0);
    assert.equal(renderer.sun.intensity, arenaPresentationProfile('alpine_research').sun);

    assert.equal(arena.setWeatherSeed(snowSeed), 'snow');
    arena.clearMap();
    assert.equal(arena.weather, null);
    assert.equal(groups(), 0, 'clearMap disposes the weather');

    // Same seed on two "clients" -> same weather on every map.
    for (const id of ['beach_open', 'harbor_nightworks', 'jungle', 'volcano']) {
        const a = new Arena(makeRenderer(), id, { weatherSeed: 7 });
        const b = new Arena(makeRenderer(), id, { weatherSeed: 7 });
        assert.equal(a.weatherType, b.weatherType, id);
        assert.equal(a.weatherType, rollMapWeather(id, 7), id);
        a.clearMap();
        b.clearMap();
    }
});

test('rain and snow are GPU particles: near-fade, frustum-free, no per-frame uploads', () => {
    const scene = new THREE.Scene();
    for (const kind of ['rain', 'snow', 'storm']) {
        const weather = new WeatherSystem(scene, { minX: -50, maxX: 50, minZ: -50, maxZ: 50, maxY: 30 }, { quality: 'low' });
        weather.setWeather(kind);
        const mesh = kind === 'snow' ? weather.snowMesh : weather.rainMesh;
        assert.ok(mesh, `${kind} mesh`);
        assert.equal(mesh.frustumCulled, false);
        assert.equal(mesh.material.depthWrite, false);
        assert.match(mesh.material.vertexShader, /smoothstep\((0\.8|1\.4), (2\.6|4\.5), -mv\.z\)/, `${kind} fades out at the lens`);
        const expected = kind === 'snow' ? WEATHER_PARTICLE_COUNTS.low.snow : WEATHER_PARTICLE_COUNTS.low.rain * 2;
        assert.equal(mesh.geometry.getAttribute('position').count, expected);
        if (kind === 'snow') assert.match(mesh.material.vertexShader, /gl_PointSize = min\(/, 'flakes have a capped on-screen size');
        const version = mesh.geometry.getAttribute('position').version;
        for (let i = 0; i < 30; i++) weather.update(1 / 60, i / 60);
        assert.equal(mesh.geometry.getAttribute('position').version, version, `${kind}: no buffer re-upload per frame`);
        assert.ok(mesh.material.uniforms.uTime.value > 0, `${kind} advances on the GPU clock`);
        weather.dispose();
        assert.equal(scene.children.length, 0, `${kind} dispose detaches the group`);
    }
    const storm = new WeatherSystem(scene, { maxY: 30 });
    storm.setWeather('storm');
    storm._playThunder = () => {};
    let flashed = false;
    for (let i = 0; i < 60 * 12; i++) {
        storm.update(1 / 60, i / 60);
        if (storm.flashIntensity > 0.5) flashed = true;
    }
    assert.ok(flashed, 'storms flash (Arena lights the sky with flashIntensity)');
    storm.dispose();
});

test('the sky is one draw call with drifting fbm clouds, a moon at night and weather uniforms', () => {
    const arena = new Arena(makeRenderer(), 'harbor_nightworks');
    const sky = arena.skybox;
    const { uniforms, fragmentShader, defines } = sky.material;
    assert.equal(sky.geometry.type, 'SphereGeometry');
    assert.equal(arena.objects.filter(o => o === sky).length, 1);
    assert.equal(uniforms.time, arena._artTime, 'clouds drift on the shared art clock');
    for (const name of ['overcast', 'flash', 'starAmount', 'cloudAmount']) assert.ok(uniforms[name], `${name} uniform`);
    assert.match(fragmentShader, /float fbm\(vec2 p\)/);
    assert.match(fragmentShader, /moonDisc/);
    assert.ok(defines.CLOUD_OCTAVES >= 3 && defines.CLOUD_OCTAVES <= 5);
    assert.ok(uniforms.starAmount.value > 0, 'a night sky gets stars without per-map config');
    arena.update(12.5, 1 / 60);
    assert.equal(uniforms.time.value, 12.5);
    arena.clearMap();

    const low = new Arena(makeRenderer('low'), 'beach');
    assert.equal(low.skybox.material.defines.CLOUD_OCTAVES, 3, 'Low sky uses fewer cloud octaves');
    assert.equal(low.skybox.material.defines.CLOUD_DETAIL, undefined, 'Low skips the cirrus layer');
    assert.ok(low.skybox.material.uniforms.cloudAmount.value > 0, 'the classic beach sky has clouds now');
    assert.equal(low.skybox.material.uniforms.starAmount.value, 0, 'day skies have no stars');
    low.clearMap();
});
