// map-art.test.mjs — the map-art pass: three new maps (Neon Rooftop, Sunken
// Temple, Orbital Station), per-map lighting presets, the lazily loaded
// js/map-art/ layer (identity scenery + polish for the eight most-played maps)
// and its performance contract. Runs the REAL vendored three.js (no WebGL
// needed to build scene graphs) with a no-op canvas for CanvasTextures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { formatMapSize } from '../js/map-display.js';
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
    MAPS, MAP_THEMES, Arena, MAP_LIGHTING, MAP_ART_IDENTITY, MAP_ART_POLISH,
    mapLightingPreset, arenaPresentationProfile, ARENA_PRESENTATION_PROFILES, getGameplayLayout
} = await import('../js/arena.js');
const art = await import('../js/map-art/index.js');

const NEW_MAPS = Object.freeze({
    neon_rooftop: 'isRooftop',
    sunken_temple: 'isSunkenTemple',
    orbital_station: 'isOrbital',
    sunbaked_bazaar: 'isBazaar',
    harbor_nightworks: 'isHarbor',
    alpine_research: 'isAlpine',
    jade_garden: 'isJadeGarden'
});
const LANDMARK_IDS = ['sunbaked_bazaar', 'harbor_nightworks', 'alpine_research', 'jade_garden'];
const NEW_IDS = Object.keys(NEW_MAPS);

// Scene draw calls (renderables the arena adds, no frustum culling) measured
// with the pre-pass js/arena.js at Medium. Budget: <= +20%.
const PRE_PASS_DRAW_CALLS = Object.freeze({
    beach_open: 209, industrial: 143, neon: 214, grand_stadium: 155,
    pillar: 147, circuit_dome: 190, volcano: 193, mecha: 174
});

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
    const visit = (object, visible) => {
        const shown = visible && object.visible !== false;
        if (shown && (object.isMesh || object.isPoints || object.isLine)) calls += 1;
        for (const child of object.children || []) visit(child, shown);
    };
    for (const object of objects) visit(object, true);
    return calls;
}

function buildWithArt(id, quality = 'medium') {
    const arena = new Arena(makeRenderer(quality), id);
    const baseCalls = drawCalls(arena.objects);
    const collidersBefore = arena.collidables.length;
    const tier = arena._mapArtTier();
    const added = art.hasMapArt(id, tier) ? art.buildMapArt(arena, tier) : 0;
    return { arena, tier, baseCalls, collidersBefore, added, totalCalls: drawCalls(arena.objects) };
}

test('three new maps are registered with full config, rotation visibility and a UI theme', () => {
    const selectable = Object.keys(MAPS).filter(id => !MAPS[id].hiddenFromRotation);
    for (const [id, flag] of Object.entries(NEW_MAPS)) {
        const config = MAPS[id];
        assert.ok(config, `${id} exists`);
        for (const field of ['name', 'courtWidth', 'courtLength', 'wallHeight', 'floorRed', 'floorBlue', 'wallColor', 'skyTop', 'skyBottom', 'fogColor', 'size', 'weather']) {
            assert.notEqual(config[field], undefined, `${id}.${field}`);
        }
        assert.equal(config[flag], true, `${id} sets ${flag}`);
        for (const [otherId, other] of Object.entries(MAPS)) {
            if (otherId !== id) assert.ok(!other[flag], `${otherId} must not set ${flag}`);
        }
        assert.ok(selectable.includes(id), `${id} is in the carousel / random rotation`);
        assert.equal(formatMapSize(config), config.size, `${id} size bucket matches its width`);
        assert.ok(MAP_THEMES[id], `${id} has a UI theme`);
        assert.ok(ARENA_PRESENTATION_PROFILES[id] && arenaPresentationProfile(id) === ARENA_PRESENTATION_PROFILES[id]);
        // Visual-only identities: no gameplay mutators ride along.
        assert.ok(!config.lowGravity && !config.slippery && !config.waterZones && !config.hasPortals, `${id} adds no mutators`);
        assert.equal(config.gameplay.symmetric, true);
        assert.ok(config.gameplay.playerSpawnZ > 0 && config.gameplay.playerSpawnZ < config.courtLength / 2);
        const sides = new Set(config.spectator.stands.map(stand => stand.side));
        assert.ok(sides.has('west') && sides.has('east'), `${id} has sideline stands`);
        assert.ok(getGameplayLayout(id), `${id} has a real gameplay layout`);
        assert.equal(JSON.stringify(config).includes('http'), false, `${id} pulls no remote asset`);
    }
    assert.equal(MAPS.orbital_station.lowGravity, undefined, 'orbital look stays visual only');
    assert.equal(MAPS.neon_rooftop.sky.stars, 1);
});

test('lighting presets cover every polished and new map and are well-formed', () => {
    for (const id of [...MAP_ART_POLISH, ...MAP_ART_IDENTITY]) {
        const preset = mapLightingPreset(id);
        assert.ok(preset, `${id} has a lighting preset`);
        assert.equal(preset.sun.length, 3);
        assert.ok(preset.sun[1] > 0.2, `${id} sun is above the horizon`);
        for (const key of ['sunColor', 'hemiSky', 'hemiGround', 'ambient']) {
            assert.ok(Number.isInteger(preset[key]) && preset[key] >= 0 && preset[key] <= 0xffffff, `${id}.${key}`);
        }
        assert.ok(preset.fogNear > 0 && preset.fogFar > preset.fogNear, `${id} fog range`);
        assert.ok(preset.hemiIntensity > 0 && preset.ambientIntensity > 0);
    }
    assert.equal(mapLightingPreset('beach'), null);
    assert.equal(mapLightingPreset('__proto__'), null);
    assert.ok(Object.isFrozen(MAP_LIGHTING));
});

test('switching maps applies a preset in place and restores the renderer rig on preset-less maps', () => {
    const renderer = makeRenderer();
    const hemi = renderer.scene.children.find(child => child.isHemisphereLight);
    const ambient = renderer.scene.children.find(child => child.isAmbientLight);
    const lightCount = renderer.scene.children.filter(child => child.isLight).length;
    const arena = new Arena(renderer, 'beach');
    assert.deepEqual(renderer.sun.position.toArray(), [15, 30, 10], 'preset-less map keeps the original sun');
    arena.rebuild('neon_rooftop');
    const preset = MAP_LIGHTING.neon_rooftop;
    const dir = new THREE.Vector3(...preset.sun).normalize();
    assert.ok(renderer.sun.position.clone().normalize().distanceTo(dir) < 1e-6, 'sun follows the preset direction');
    assert.equal(renderer.sun.color.getHex(), preset.sunColor);
    assert.equal(hemi.color.getHex(), preset.hemiSky);
    assert.equal(ambient.intensity, preset.ambientIntensity);
    assert.equal(renderer.scene.fog.far, preset.fogFar);
    assert.equal(arena.skybox.material.uniforms.starAmount.value, 1);
    arena.rebuild('beach');
    assert.deepEqual(renderer.sun.position.toArray(), [15, 30, 10]);
    assert.equal(renderer.sun.color.getHex(), 0xfff4e6);
    assert.equal(hemi.color.getHex(), 0xbfe6ff);
    assert.equal(hemi.intensity, 0.45);
    assert.equal(ambient.intensity, 0.6);
    assert.equal(renderer.scene.fog.near, 60);
    assert.equal(renderer.scene.fog.far, 180);
    assert.equal(arena.skybox.material.uniforms.starAmount.value, 0);
    assert.equal(renderer.scene.children.filter(child => child.isLight && !arena.objects.includes(child)).length, lightCount,
        'presets retint the renderer rig instead of adding lights');
    arena.clearMap();
});

test('arena art lists mirror the lazily loaded art module', () => {
    assert.deepEqual([...MAP_ART_IDENTITY].sort(), Object.keys(art.IDENTITY_BUILDERS).sort());
    assert.deepEqual([...MAP_ART_POLISH].sort(), Object.keys(art.POLISH_BUILDERS).sort());
    for (const id of [...MAP_ART_IDENTITY, ...MAP_ART_POLISH]) assert.ok(MAPS[id], `${id} is a real map`);
    assert.equal(art.hasMapArt('beach_open', 'low'), false, 'Low quality gets no polish layer');
    assert.equal(art.hasMapArt('neon_rooftop', 'low'), true, 'new maps keep their identity on Low');
    assert.equal(art.hasMapArt('beach', 'high'), false);
});

test('polished maps stay within +20% of their pre-pass Medium draw calls', () => {
    for (const id of MAP_ART_POLISH) {
        const { arena, totalCalls, added } = buildWithArt(id, 'medium');
        assert.ok(added > 0, `${id} gets polish`);
        assert.ok(added <= 8, `${id} polish adds ${added} draw calls (max 8)`);
        assert.ok(totalCalls <= PRE_PASS_DRAW_CALLS[id] * 1.2, `${id}: ${totalCalls} > ${PRE_PASS_DRAW_CALLS[id]} * 1.2`);
        arena.clearMap();
    }
});

test('new maps build their identity on every tier within a fixed budget', () => {
    for (const id of NEW_IDS) {
        const counts = {};
        for (const quality of ['low', 'medium', 'high']) {
            const { arena, added, totalCalls } = buildWithArt(id, quality);
            assert.ok(added >= 6, `${id}@${quality} builds identity scenery (${added})`);
            assert.ok(added <= 20, `${id}@${quality} art stays merged/instanced (${added} draw calls)`);
            assert.ok(totalCalls <= 140, `${id}@${quality} total ${totalCalls}`);
            counts[quality] = added;
            arena.clearMap();
        }
        assert.ok(counts.low <= counts.medium && counts.medium <= counts.high, `${id} tiers scale up`);
    }
});

test('the art layer never collides, is deterministic and only uses animated materials above Low', () => {
    for (const id of [...NEW_IDS, ...MAP_ART_POLISH]) {
        for (const quality of ['low', 'medium']) {
            const first = buildWithArt(id, quality);
            if (!first.added) { first.arena.clearMap(); continue; }
            assert.equal(first.arena.collidables.length, first.collidersBefore, `${id} art adds no colliders`);
            const artObjects = first.arena.objects.filter(object => object.userData.mapArt);
            assert.equal(artObjects.length, first.added);
            const shape = objects => objects.map(object => `${object.type}:${object.geometry?.getAttribute('position')?.count}`).join(',');
            const second = buildWithArt(id, quality);
            assert.equal(shape(second.arena.objects.filter(object => object.userData.mapArt)), shape(artObjects), `${id} art is seeded`);
            const animated = artObjects.filter(object => object.material?.userData?.artMode);
            if (quality === 'low') assert.equal(animated.length, 0, `${id} Low has no animation`);
            for (const object of animated) {
                assert.equal(typeof object.material.onBeforeCompile, 'function');
                assert.equal(object.castShadow, false);
            }
            first.arena.clearMap();
            second.arena.clearMap();
        }
    }
});

test('animated art materials splice into real three.js shader chunks and share one time uniform', () => {
    const lib = { MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshStandardMaterial: 'standard' };
    const seen = new Set();
    for (const id of [...NEW_IDS, ...MAP_ART_POLISH]) {
        const { arena } = buildWithArt(id, 'high');
        for (const object of arena.objects) {
            const material = object.material;
            if (!material?.userData?.artMode) continue;
            const source = THREE.ShaderLib[lib[material.type]];
            assert.ok(source, `${material.type} has a ShaderLib entry`);
            const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader };
            material.onBeforeCompile(shader);
            assert.equal(shader.uniforms.uArtTime, arena._artTime, 'shares the arena time uniform');
            assert.match(shader.vertexShader, /vArtWorld = \(modelMatrix \* artWorld\)\.xyz;/);
            const mode = material.userData.artMode;
            if (['shimmer', 'blink', 'flicker', 'pulse'].includes(mode)) assert.match(shader.fragmentShader, /#include <opaque_fragment>\n\s+float art/);
            if (['wave', 'bob', 'orbit'].includes(mode)) assert.match(shader.vertexShader, /#include <begin_vertex>\n\s+(float art|transformed)/);
            if (mode === 'scroll') assert.match(shader.vertexShader, /vMapUv\.x \+= uArtTime/);
            assert.equal(material.customProgramCacheKey(), `volle-art-${mode}`);
            seen.add(mode);
        }
        arena.update(12.5, 1 / 60);
        assert.equal(arena._artTime.value, 12.5);
        arena.clearMap();
    }
    for (const mode of ['wave', 'shimmer', 'blink', 'flicker', 'pulse', 'scroll', 'orbit', 'bob']) {
        assert.ok(seen.has(mode), `${mode} is exercised`);
    }
});

test('clearMap disposes art textures and instanced buffers; late art loads are dropped', () => {
    const { arena } = buildWithArt('neon_rooftop', 'medium');
    const textures = [...arena._artTextures];
    assert.ok(textures.length >= 3, 'art registers its CanvasTextures');
    let disposedTextures = 0;
    for (const texture of textures) texture.addEventListener('dispose', () => { disposedTextures++; });
    const instancedMeshes = arena.objects.filter(object => object.isInstancedMesh);
    assert.ok(instancedMeshes.length >= 1);
    let disposedInstanced = 0;
    for (const mesh of instancedMeshes) mesh.addEventListener('dispose', () => { disposedInstanced++; });
    const token = arena._artToken;
    arena.clearMap();
    assert.equal(disposedTextures, textures.length);
    assert.equal(disposedInstanced, instancedMeshes.length);
    assert.equal(arena._artTextures.length, 0);
    assert.notEqual(arena._artToken, token, 'an in-flight art import resolves into nothing');
});

test('ambient particles are one Points draw that updates in place', () => {
    const arena = new Arena(makeRenderer(), 'pillar');
    const particles = arena._sceneParticles;
    assert.ok(particles.points.isPoints);
    assert.equal(arena.objects.filter(object => object.isPoints && object === particles.points).length, 1);
    const positions = particles.positions;
    const before = Array.from(positions.slice(0, 6));
    for (let i = 0; i < 10; i++) arena.update(i * 0.016, 0.016);
    assert.equal(particles.positions, positions, 'buffer is reused (no per-frame allocation)');
    assert.notDeepEqual(Array.from(positions.slice(0, 6)), before, 'particles drift');
    assert.ok(Array.from(positions).every(Number.isFinite));
    arena.clearMap();
});

test('landmark maps: callouts, distinct mood presets, one ambient particle system, <= 130 draw calls at Medium', () => {
    const sunColors = new Set();
    const skies = new Set();
    for (const id of LANDMARK_IDS) {
        const config = MAPS[id];
        assert.ok(Array.isArray(config.callouts) && config.callouts.length >= 6, `${id} lists its callout zones`);
        assert.equal(new Set(config.callouts).size, config.callouts.length, `${id} callouts are unique`);
        assert.ok(config.callouts.every(name => typeof name === 'string' && name.length <= 14), `${id} callouts are short`);
        sunColors.add(mapLightingPreset(id).sunColor);
        skies.add(config.skyTop);
        const { arena, added, totalCalls } = buildWithArt(id, 'medium');
        assert.ok(totalCalls <= 130, `${id} Medium draw calls ${totalCalls} <= 130`);
        assert.ok(added >= 8, `${id} builds a real place (${added} art draws)`);
        const points = arena.objects.filter(object => object.isPoints);
        assert.equal(points.length, 1, `${id} has exactly one ambient particle system`);
        assert.equal(points[0], arena._sceneParticles.points);
        arena.clearMap();
        const low = buildWithArt(id, 'low');
        assert.ok(low.totalCalls < totalCalls, `${id} Low skips decorative detail (${low.totalCalls} < ${totalCalls})`);
        assert.equal(low.arena.scene.environment, null, `${id} Low sets no environment map`);
        low.arena.clearMap();
    }
    assert.equal(sunColors.size, LANDMARK_IDS.length, 'each landmark map has its own light');
    assert.equal(skies.size, LANDMARK_IDS.length, 'each landmark map has its own sky');
    assert.equal(MAPS.jade_garden.ambientParticles, 'petal');
    assert.equal(MAPS.harbor_nightworks.weather, 'rain');
    assert.equal(MAPS.alpine_research.weather, 'snow');
});

test('harbor wet ground reflects a painted environment that clearMap drops', () => {
    const { arena } = buildWithArt('harbor_nightworks', 'medium');
    const env = arena.scene.environment;
    assert.ok(env?.isTexture, 'environment set from a CanvasTexture');
    assert.equal(env.mapping, THREE.EquirectangularReflectionMapping);
    assert.ok(arena._artTextures.includes(env), 'registered for disposal');
    arena.clearMap();
    assert.equal(arena.scene.environment, null);
});

// Every map-art object that reaches into the playable volume (court footprint,
// above the floor decals, below the ball ceiling) must be flagged decorative
// with a reason: anything a player would take for solid lives in the
// collider-backed gameplay layout instead (js/arena.js GAMEPLAY_LAYOUTS).
test('map-art never puts undeclared solid-looking geometry inside the play area', () => {
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const offenders = [];
    for (const id of [...NEW_IDS, ...MAP_ART_POLISH]) {
        const { arena } = buildWithArt(id, 'high');
        const halfW = arena.courtWidth / 2;
        const halfL = arena.courtLength / 2;
        const top = arena.ceilingHeight > 0 ? arena.ceilingHeight : arena.bounds.maxY;
        for (const object of arena.objects.filter(o => o.userData.mapArt)) {
            const pos = object.geometry?.getAttribute('position');
            if (!pos) continue;
            object.updateMatrixWorld(true);
            const count = object.isInstancedMesh ? object.count : 1;
            let inside = false;
            for (let i = 0; i < count && !inside; i++) {
                if (object.isInstancedMesh) { object.getMatrixAt(i, m); m.premultiply(object.matrixWorld); }
                else m.copy(object.matrixWorld);
                for (let k = 0; k < pos.count; k++) {
                    v.fromBufferAttribute(pos, k).applyMatrix4(m);
                    if (Math.abs(v.x) < halfW - 0.01 && Math.abs(v.z) < halfL - 0.01 && v.y > 0.05 && v.y < top) { inside = true; break; }
                }
            }
            if (!inside) continue;
            const reason = object.userData.decorative;
            if (!(typeof reason === 'string' && reason.length >= 8)) {
                offenders.push(`${id}: ${object.type} ${object.material?.type}/${object.material?.userData?.artMode || '-'} #${arena.objects.indexOf(object)}`);
            }
        }
        arena.clearMap();
    }
    assert.deepEqual(offenders, [], 'art inside the play area must be declared decorative');
});
