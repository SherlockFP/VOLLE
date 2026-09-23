// viewmodel-hand.js — the first-person arm and gloved fist.
// Replaces the old block mitt with a stylized but anatomical hand: a tapered team
// sleeve, a cuff, and a fist whose four fingers are arcs wrapped around the held
// item's handle axis (the handle literally sits inside the curl). The fist lives in
// a `wrist` group that player.js drives with the knife's animation deltas, so the
// grip never slides off the handle mid-swing or mid-inspect.
//
// Gloves are data, not meshes: a glove style = colours + pattern + finish + extras
// (knuckle plates, gems, glow). One mesh set, re-skinned per equip, so adding a
// hundred gloves costs zero geometry.
import * as THREE from 'three';
import { VIEWMODEL_BASE_POSITION, VIEWMODEL_BASE_ROTATION } from './knife-animation.js';

// Finger arcs are authored for this handle radius and scaled per held item.
const REFERENCE_GRIP_RADIUS = 0.04;
export const GRIP_RADIUS_BY_MODEL = Object.freeze({
    classic: 0.036, bayonet: 0.038, karambit: 0.034, butterfly: 0.045,
    tanto: 0.036, cleaver: 0.04, dagger: 0.034, rocket: 0.07,
    kukri: 0.04, gut: 0.04, huntsman: 0.042, talon: 0.036, flip: 0.034
});

export const GLOVE_PATTERNS = Object.freeze(['plain', 'stripes', 'hex', 'carbon', 'camo', 'checker', 'circuit', 'scales', 'flame', 'galaxy']);
export const GLOVE_FINISHES = Object.freeze(['leather', 'rubber', 'metal', 'iridescent', 'emissive']);

// Pure: normalised glove look from a catalogue item (or null → team default).
export function resolveGloveLook(item, teamColor = '#ee5555') {
    const colors = Array.isArray(item?.colors) ? item.colors : [];
    const look = item?.look || {};
    return {
        id: item?.id || 'team-default',
        base: colors[0] || teamColor,
        accent: colors[1] || '#9bdcff',
        detail: colors[2] || colors[1] || '#1a2635',
        pattern: GLOVE_PATTERNS.includes(look.pattern) ? look.pattern : legacyPattern(item?.style),
        finish: GLOVE_FINISHES.includes(look.finish) ? look.finish : legacyFinish(item?.style),
        knuckles: look.knuckles ?? Boolean(item),
        glow: Math.max(0, Math.min(1, Number(look.glow) || 0)),
        rarity: item?.rarity || 'common'
    };
}

function legacyPattern(style) {
    return { kinetic: 'stripes', prism: 'hex', royal: 'scales' }[style] || 'plain';
}
function legacyFinish(style) {
    return { prism: 'iridescent', royal: 'metal' }[style] || 'leather';
}

// Cached per (pattern, base, accent, detail) — gloves share textures across players.
const patternCache = new Map();
export function glovePatternTexture(look) {
    if (look.pattern === 'plain' || typeof document === 'undefined') return null;
    const key = `${look.pattern}|${look.base}|${look.accent}|${look.detail}`;
    if (patternCache.has(key)) return patternCache.get(key);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = look.base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = look.accent;
    ctx.strokeStyle = look.accent;
    const p = look.pattern;
    if (p === 'stripes') {
        for (let x = -size; x < size * 2; x += 24) { ctx.save(); ctx.translate(x, 0); ctx.rotate(0.5); ctx.fillRect(0, -size, 8, size * 3); ctx.restore(); }
    } else if (p === 'hex') {
        ctx.lineWidth = 3;
        for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
            const cx = col * 20 + (row % 2) * 10, cy = row * 18;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9); }
            ctx.closePath(); ctx.stroke();
        }
    } else if (p === 'carbon') {
        for (let y = 0; y < size; y += 8) for (let x = 0; x < size; x += 8) {
            ctx.globalAlpha = ((x + y) / 8) % 2 ? 0.55 : 0.2;
            ctx.fillRect(x, y, 8, 4);
        }
        ctx.globalAlpha = 1;
    } else if (p === 'camo') {
        let seed = 7;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let i = 0; i < 26; i++) {
            ctx.fillStyle = i % 2 ? look.accent : look.detail;
            ctx.beginPath();
            ctx.ellipse(rnd() * size, rnd() * size, 8 + rnd() * 18, 5 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (p === 'checker') {
        for (let y = 0; y < size; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < size; x += 32) ctx.fillRect(x, y, 16, 16);
    } else if (p === 'circuit') {
        ctx.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
            const y = (i * 37) % size, x = (i * 53) % size;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30, y); ctx.lineTo(x + 30, y + 22); ctx.stroke();
            ctx.beginPath(); ctx.arc(x + 30, y + 22, 3, 0, Math.PI * 2); ctx.fill();
        }
    } else if (p === 'scales') {
        ctx.lineWidth = 2.5;
        for (let row = 0; row < 9; row++) for (let col = -1; col < 9; col++) {
            ctx.beginPath(); ctx.arc(col * 16 + (row % 2) * 8, row * 14, 9, 0, Math.PI); ctx.stroke();
        }
    } else if (p === 'flame') {
        const gradient = ctx.createLinearGradient(0, size, 0, 0);
        gradient.addColorStop(0, look.accent); gradient.addColorStop(0.55, look.detail); gradient.addColorStop(1, look.base);
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.moveTo(0, size);
        for (let x = 0; x <= size; x += 16) ctx.quadraticCurveTo(x + 8, size * (0.2 + ((x / 16) % 3) * 0.12), x + 16, size * 0.6);
        ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
    } else if (p === 'galaxy') {
        const gradient = ctx.createRadialGradient(size * 0.4, size * 0.4, 4, size / 2, size / 2, size * 0.7);
        gradient.addColorStop(0, look.accent); gradient.addColorStop(0.5, look.detail); gradient.addColorStop(1, look.base);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.3 + (i % 5) * 0.14; ctx.fillRect((i * 71) % size, (i * 43) % size, 1.5, 1.5); }
        ctx.globalAlpha = 1;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    patternCache.set(key, texture);
    return texture;
}

function finishParams(finish) {
    switch (finish) {
        case 'rubber': return { roughness: 0.85, metalness: 0, iridescence: 0 };
        case 'metal': return { roughness: 0.28, metalness: 0.85, iridescence: 0 };
        case 'iridescent': return { roughness: 0.35, metalness: 0.4, iridescence: 1 };
        case 'emissive': return { roughness: 0.45, metalness: 0.2, iridescence: 0 };
        default: return { roughness: 0.62, metalness: 0.05, iridescence: 0 };
    }
}

// Builds the arm + gloved fist into `armGroup`. `toon(color)` is the renderer's toon
// material factory (the sleeve keeps the world's toon look and team colour).
export function buildViewmodelHand(armGroup, toon, teamColor) {
    const sleeveMat = toon(teamColor);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.064, 0.44, 14, 1), sleeveMat);
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.set(0.05, -0.1, -0.16);
    sleeve.name = 'viewmodel-sleeve';
    armGroup.add(sleeve);

    const gloveMat = new THREE.MeshPhysicalMaterial({ color: teamColor, roughness: 0.62, metalness: 0.05, clearcoat: 0.25 });
    const accentMat = new THREE.MeshPhysicalMaterial({ color: 0x9bdcff, roughness: 0.3, metalness: 0.7, clearcoat: 0.6 });
    const palmMat = new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: 0.9 });

    // Wrist: everything that grips follows the held item's animation.
    const wrist = new THREE.Group();
    wrist.name = 'viewmodel-wrist';
    wrist.position.set(...VIEWMODEL_BASE_POSITION);
    wrist.rotation.set(...VIEWMODEL_BASE_ROTATION);
    armGroup.add(wrist);

    // handMesh: the glove root (kept under this name — game.js hides it for celebrations).
    const handMesh = new THREE.Group();
    handMesh.name = 'viewmodel-glove';
    wrist.add(handMesh);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.06, 0.05, 16, 1, true), accentMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0.018, -0.02, 0.135);
    handMesh.add(cuff);
    const backOfHand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 12), gloveMat);
    backOfHand.scale.set(1.05, 0.72, 1.45);
    backOfHand.position.set(0.028, -0.006, 0.07);
    handMesh.add(backOfHand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.046, 16, 10), palmMat);
    palm.scale.set(0.8, 0.9, 1.3);
    palm.position.set(0.034, -0.03, 0.05);
    handMesh.add(palm);

    // Fingers: arcs around the handle axis (z). Index nearest the blade.
    const fingerGroup = new THREE.Group();
    fingerGroup.name = 'viewmodel-fingers';
    const fingerSpecs = [
        { z: -0.018, radius: 0.052, tube: 0.0145, arc: 4.3 },
        { z: 0.011, radius: 0.053, tube: 0.015, arc: 4.4 },
        { z: 0.039, radius: 0.051, tube: 0.0145, arc: 4.3 },
        { z: 0.064, radius: 0.047, tube: 0.0125, arc: 4.1 }
    ];
    const knuckles = [];
    for (const spec of fingerSpecs) {
        const finger = new THREE.Group();
        const arc = new THREE.Mesh(new THREE.TorusGeometry(spec.radius, spec.tube, 8, 20, spec.arc), gloveMat);
        finger.add(arc);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(spec.tube * 1.05, 10, 8), gloveMat);
        tip.position.set(Math.cos(spec.arc) * spec.radius, Math.sin(spec.arc) * spec.radius, 0);
        finger.add(tip);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, 0.022), accentMat);
        plate.position.set(Math.cos(0.9) * (spec.radius + spec.tube), Math.sin(0.9) * (spec.radius + spec.tube), 0);
        plate.rotation.z = 0.9;
        finger.add(plate);
        knuckles.push(plate);
        // Arc starts on the palm side (+x) and wraps over the top to the thumb side.
        finger.position.z = spec.z;
        finger.userData.baseRotZ = -0.55;
        finger.rotation.z = finger.userData.baseRotZ;
        fingerGroup.add(finger);
    }
    handMesh.add(fingerGroup);

    const thumb = new THREE.Group();
    const thumbBase = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.05, 4, 10), gloveMat);
    thumbBase.rotation.x = Math.PI / 2;
    thumbBase.position.set(0, 0, 0.012);
    const thumbTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0155, 0.035, 4, 10), gloveMat);
    thumbTip.rotation.set(Math.PI / 2 + 0.35, 0, 0);
    thumbTip.position.set(0.004, -0.008, -0.036);
    thumb.add(thumbBase, thumbTip);
    thumb.position.set(-0.03, 0.05, 0.03);
    thumb.rotation.set(0.1, -0.35, 0.4);
    handMesh.add(thumb);

    const glowMat = new THREE.MeshBasicMaterial({ color: 0x9bdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowBand = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 28), glowMat);
    glowBand.position.set(0.018, -0.02, 0.112);
    handMesh.add(glowBand);

    return {
        sleeve, sleeveMat, wrist, handMesh, fingerGroup, thumb, knuckles,
        gloveMat, accentMat, palmMat, glowMat, cuff,
        gripScale: 1
    };
}

// Re-skins the hand for a glove (or team default when `item` is null).
export function applyGloveLook(hand, item, teamColor) {
    const look = resolveGloveLook(item, `#${new THREE.Color(teamColor).getHexString()}`);
    const fin = finishParams(look.finish);
    const map = glovePatternTexture(look);
    hand.gloveMat.color.set(map ? '#ffffff' : look.base);
    hand.gloveMat.map = map;
    hand.gloveMat.roughness = fin.roughness;
    hand.gloveMat.metalness = fin.metalness;
    hand.gloveMat.iridescence = fin.iridescence;
    hand.gloveMat.emissive.set(look.finish === 'emissive' ? look.accent : '#000000');
    hand.gloveMat.emissiveIntensity = look.finish === 'emissive' ? 0.35 : 0;
    hand.gloveMat.needsUpdate = true;
    hand.accentMat.color.set(look.accent);
    hand.palmMat.color.set(item ? look.detail : '#27313b');
    for (const plate of hand.knuckles) plate.visible = look.knuckles;
    hand.glowMat.color.set(look.accent);
    hand.glowMat.opacity = look.glow * 0.8;
    hand.look = look;
    return look;
}

// Fits the finger curl to the held item's handle thickness.
export function fitGripToModel(hand, model) {
    const radius = GRIP_RADIUS_BY_MODEL[model] || REFERENCE_GRIP_RADIUS;
    const scale = Math.max(0.7, Math.min(1.6, radius / REFERENCE_GRIP_RADIUS * 0.82));
    hand.fingerGroup.scale.set(scale, scale, 1);
    hand.gripScale = scale;
}

// Per-frame, allocation-free: the wrist follows the item's animated offset from its
// rest frame; fingers squeeze on swings. `pose` is resolveKnifePose's result.
export function updateViewmodelHand(hand, pose, frame, grip = 0, time = 0, glowPulse = false) {
    if (!hand || !pose || !frame) return;
    const w = hand.wrist;
    w.position.set(
        VIEWMODEL_BASE_POSITION[0] + pose.knifePosition[0] - frame.position[0],
        VIEWMODEL_BASE_POSITION[1] + pose.knifePosition[1] - frame.position[1],
        VIEWMODEL_BASE_POSITION[2] + pose.knifePosition[2] - frame.position[2]
    );
    w.rotation.set(
        VIEWMODEL_BASE_ROTATION[0] + pose.knifeRotation[0] - frame.rotation[0],
        VIEWMODEL_BASE_ROTATION[1] + pose.knifeRotation[1] - frame.rotation[1],
        VIEWMODEL_BASE_ROTATION[2] + pose.knifeRotation[2] - frame.rotation[2]
    );
    const fingers = hand.fingerGroup.children;
    for (let index = 0; index < fingers.length; index++) {
        const finger = fingers[index];
        finger.rotation.z = finger.userData.baseRotZ - grip * (0.16 + index * 0.02);
    }
    if (glowPulse && hand.look?.glow > 0) {
        hand.glowMat.opacity = hand.look.glow * (0.55 + 0.3 * Math.sin(time * 3.1));
    }
}
