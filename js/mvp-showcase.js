// mvp-showcase.js — small dedicated turntable renderer for the post-game MVP
// card (js/ui.js#_renderMvpCard). Reuses the exact pieces the live game uses to
// draw a player's held knife and gloved fist:
//   - js/weapon-models.js#createKnifeModel / disposeObject3D
//   - js/viewmodel-hand.js#buildViewmodelHand / applyGloveLook / fitGripToModel
//   - js/knife-animation.js#viewmodelFrame (per-model "handle sits in the fist" offset)
// plus a standalone ball mesh built the same way js/main.js#_buildBallPreviewModel
// builds one for the shop/locker preview.
//
// Allocation discipline: every THREE object here is created once in mount()/
// _build(); the render loop only mutates `stage.rotation.y` (or nothing at all
// under reduced motion) — zero per-frame allocation, matching the existing
// js/main.js#_renderCosmeticPreview turntable this mirrors.
import * as THREE from 'three';
import { createKnifeModel, disposeObject3D } from './weapon-models.js';
import { buildViewmodelHand, applyGloveLook, fitGripToModel } from './viewmodel-hand.js';
import { viewmodelFrame } from './knife-animation.js';
import { KNIVES } from './cosmetics.js';
import { resolveEquippedGlove } from './cosmetic-catalog.js';
import { BALL_SKINS, ballShapeParts } from './ball.js';
import { toonVertexShader } from './shaders/toon.vert.js';
import { toonFragmentShader } from './shaders/toon.frag.js';

const TEAM_COLOR = Object.freeze({ red: 0xee5555, blue: 0x5577dd });

function createToonMaterial(color) {
    return new THREE.ShaderMaterial({
        vertexShader: toonVertexShader,
        fragmentShader: toonFragmentShader,
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uTexture: { value: null },
            uTextureEnabled: { value: false },
            uLightDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
            uRimPower: { value: 5.0 }
        }
    });
}

function buildBallModel(ballSkinId) {
    const skin = BALL_SKINS[ballSkinId] || BALL_SKINS.classic;
    const group = new THREE.Group();
    const bodyColor = skin.shape === 'shuriken' ? new THREE.Color(skin.color).multiplyScalar(.62) : skin.color;
    const body = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: .38, metalness: .42, emissive: skin.glow, emissiveIntensity: .1 });
    const accent = new THREE.MeshStandardMaterial({ color: skin.glow, roughness: .3, metalness: .5, emissive: skin.glow, emissiveIntensity: .34 });
    const radius = 0.34;
    const parts = skin.shape
        ? ballShapeParts(skin.shape, radius, THREE)
        : [{ geo: new THREE.SphereGeometry(radius, 22, 16), tint: 'body', owned: true }];
    for (const part of parts) {
        group.add(new THREE.Mesh(part.owned ? part.geo : part.geo.clone(), part.tint === 'accent' ? accent : body));
    }
    if (skin.shape === 'shuriken') group.rotation.x = Math.PI / 2;
    return group;
}

function buildComposite(loadout) {
    const team = loadout?.team === 'blue' ? 'blue' : 'red';
    const teamColor = TEAM_COLOR[team];

    const stage = new THREE.Group();

    // Knife + gloved fist, built exactly like js/player.js#buildHandMesh.
    const armGroup = new THREE.Group();
    const hand = buildViewmodelHand(armGroup, createToonMaterial, teamColor);
    const gloveItem = resolveEquippedGlove({ gloves: loadout?.gloveId });
    applyGloveLook(hand, gloveItem, teamColor);

    const knifeStyle = KNIVES[loadout?.knifeId] || KNIVES.training;
    const knifeGroup = createKnifeModel(knifeStyle);
    const frame = viewmodelFrame(knifeGroup.userData.model);
    knifeGroup.position.set(...frame.position);
    knifeGroup.rotation.set(...frame.rotation);
    knifeGroup.scale.setScalar(frame.scale);
    armGroup.add(knifeGroup);
    fitGripToModel(hand, knifeGroup.userData.model);
    stage.add(armGroup);

    // Ball sits beside the fist so all three earned pieces read in one shot.
    const ball = buildBallModel(loadout?.ballSkinId);
    const armBounds = new THREE.Box3().setFromObject(armGroup);
    const armSize = armBounds.getSize(new THREE.Vector3());
    ball.position.set(armSize.x * 0.62 + 0.4, -0.08, 0.05);
    stage.add(ball);

    // Center + frame the whole composite so it fills the viewport regardless of
    // knife silhouette or ball radius.
    const bounds = new THREE.Box3().setFromObject(stage);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    stage.position.sub(center);
    const inner = new THREE.Group();
    inner.add(stage);
    const scale = 2.1 / Math.max(size.x, size.y, size.z, .1);
    inner.scale.setScalar(scale);
    inner.rotation.set(0.18, 0.55, 0);
    return inner;
}

// container: a DOM element the canvas mounts into. Returns { mount(loadout), dispose() }.
// mount() may be called more than once (a rematch replaces the MVP); it tears down the
// previous composite before building the next one.
export function createMvpShowcaseStage(container, { reducedMotion = false } = {}) {
    let renderer = null;
    let scene = null;
    let camera = null;
    let composite = null;
    let frameHandle = 0;
    let lastFrame = 0;
    let disposed = false;

    const disposeComposite = () => {
        if (!composite) return;
        disposeObject3D(composite);
        composite = null;
    };

    const ensureRenderer = () => {
        if (renderer || !container) return;
        const width = Math.max(80, container.clientWidth || 120);
        const height = Math.max(80, container.clientHeight || 120);
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(30, width / height, .1, 20);
        camera.position.set(0, .15, 3.6);
        // Studio light: soft fill + key + rim, same recipe as js/player.js's viewmodel scene.
        scene.add(new THREE.HemisphereLight(0xe6fbff, 0x1a1420, 1.6));
        const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
        key.position.set(2, 3, 3);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x7fe9ff, 1.2);
        rim.position.set(-2, 1, -2);
        scene.add(rim);
        container.appendChild(renderer.domElement);
    };

    const render = (now = performance.now()) => {
        if (disposed || !container?.isConnected) return;
        if (!document.hidden) {
            const delta = lastFrame ? Math.min(.05, (now - lastFrame) / 1000) : 0;
            lastFrame = now;
            if (!reducedMotion && composite) composite.rotation.y += delta * .55;
            if (renderer && scene && camera) renderer.render(scene, camera);
        }
        if (!reducedMotion) frameHandle = requestAnimationFrame(render);
    };

    const mount = loadout => {
        if (disposed || !container) return;
        ensureRenderer();
        if (!renderer) return;
        disposeComposite();
        composite = buildComposite(loadout || {});
        scene.add(composite);
        lastFrame = 0;
        cancelAnimationFrame(frameHandle);
        render();
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frameHandle);
        disposeComposite();
        if (renderer) {
            renderer.dispose();
            renderer.domElement.remove();
        }
        renderer = null;
        scene = null;
        camera = null;
    };

    return { mount, dispose };
}
