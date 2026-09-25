// map-art/landmark-alpine.js — Alpine Research Base: a snowed-in mountain
// lab under a cold overcast sky. Palette: snow white / blue shadow, raw
// concrete, safety orange, teal-lit glass. Landmarks: the big Dish behind the
// red back line, the Hangar behind the blue one, the Radome on the east
// ridge; Lab 2 lines the west flank, pines fill the east. Ambient life:
// blowing spindrift, snowfall (weather), flags, blinking beacons, ravens.
import * as THREE from 'three';
import {
    GeoBatch, instanced, animate, canvasTexture, courtDecal,
    signAtlas, paintSign
} from './kit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CONCRETE = 0xa7adb3;
const ORANGE = 0xff6a2a;

export function buildAlpineResearchArt(ctx) {
    const { halfW, halfL, rng, animate: live, high } = ctx;
    const fieldX = halfW + 90;
    const fieldZ = halfL + 90;

    // Snowfield: blue-shadowed drifts, vehicle tracks, trodden paths.
    const snow = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#eef3f8';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) {
            const r = 10 + rng() * 40;
            const x = rng() * w;
            const y = rng() * h;
            const drift = g.createRadialGradient(x, y, 0, x, y, r);
            drift.addColorStop(0, 'rgba(170,190,220,0.28)');
            drift.addColorStop(1, 'rgba(170,190,220,0)');
            g.fillStyle = drift;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 1600; i++) {
            g.fillStyle = `rgba(255,255,255,${rng() * 0.5})`;
            g.fillRect(rng() * w, rng() * h, 1, 1);
        }
        g.strokeStyle = 'rgba(140,160,190,0.35)';
        g.lineWidth = 5;
        g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(40, 0); g.bezierCurveTo(80, 90, 20, 170, 60, 256); g.stroke();
        g.beginPath(); g.moveTo(56, 0); g.bezierCurveTo(96, 90, 36, 170, 76, 256); g.stroke();
    }, { repeatX: fieldX / 12, repeatY: fieldZ / 12 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(fieldX * 2, fieldZ * 2),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: snow }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    ctx.add(ground);

    // --- Buildings: Lab 2, Hangar, dish pedestal, radome tower, huts ---------
    const s = new GeoBatch({ colors: true });
    const glow = new GeoBatch({ colors: true });
    const labX = -(halfW + 34);
    const labLen = 64;
    s.add(new THREE.BoxGeometry(16, 9, labLen), labX, 4.5, 0, { color: CONCRETE });
    s.add(new THREE.BoxGeometry(16.4, 0.5, labLen + 0.4), labX, 9.25, 0, { color: 0x6f757c });
    s.add(new THREE.BoxGeometry(16.2, 0.6, labLen + 0.2), labX, 9.8, 0, { color: 0xf4f8fc });
    s.add(new THREE.BoxGeometry(16.1, 0.7, labLen + 0.1), labX, 2.2, 0, { color: ORANGE });
    for (let z = -labLen / 2 + 6; z < labLen / 2; z += 9) {
        s.add(new THREE.BoxGeometry(3, 1.6, 3), labX - 2, 10.9, z, { color: 0x8a9096 });   // roof HVAC
        s.add(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), labX + 4, 12.3, z + 3, { color: 0x3a3f46 });
        glow.add(new THREE.BoxGeometry(0.1, 1.6, 5.4), labX + 8.02, 5.6, z, { color: 0x8fe3f0 });
    }
    // Lab entrance airlock facing the court.
    s.add(new THREE.BoxGeometry(4, 4.4, 6), labX + 10, 2.2, -12, { color: CONCRETE });
    glow.add(new THREE.BoxGeometry(0.1, 3, 2.4), labX + 12.03, 1.6, -12, { color: 0xffe2a8 });
    // Hangar (quonset) behind the blue back line, big door facing the court.
    const hangarZ = halfL + 36;
    s.add(new THREE.CylinderGeometry(15, 15, 34, 22, 1, false, -Math.PI / 2, Math.PI), 0, 0, hangarZ, { rx: -Math.PI / 2, color: 0xb8c0c8 });
    s.add(new THREE.BoxGeometry(18, 11, 0.4), 0, 5.5, hangarZ - 17.1, { color: 0x4a5058 });
    s.add(new THREE.BoxGeometry(19, 0.8, 0.6), 0, 11.3, hangarZ - 17.2, { color: ORANGE });
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(0.6, 11.4, 0.6), sx * 9.3, 5.7, hangarZ - 17.2, { color: ORANGE });
    for (let k = 0; k < 6; k++) s.add(new THREE.BoxGeometry(17.6, 0.12, 0.45), 0, 1 + k * 1.8, hangarZ - 17.35, { color: 0x3a3f46 });
    // Snowcat parked by the hangar.
    s.add(new THREE.BoxGeometry(4, 2.2, 6), 20, 2.1, hangarZ - 22, { color: ORANGE });
    s.add(new THREE.BoxGeometry(3.6, 1.6, 3), 20, 4, hangarZ - 23, { color: 0xe8ecf0 });
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(1.2, 1.2, 7), 20 + sx * 2.3, 0.6, hangarZ - 22, { color: 0x22262c });
    glow.add(new THREE.BoxGeometry(3.2, 1, 0.1), 20, 4.1, hangarZ - 24.52, { color: 0x9fd8ff });
    // Dish pedestal (the dish itself is in the white batch below).
    const dishZ = -(halfL + 46);
    s.add(new THREE.BoxGeometry(16, 3, 16), 0, 1.5, dishZ, { color: CONCRETE });
    for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        s.add(new THREE.BoxGeometry(0.7, 16, 0.7), lx * 0.8, 11, dishZ + lz * 0.8, { rx: lz * -0.02, rz: lx * 0.02, color: 0xd8dde2 });
    }
    for (const y of [6, 11, 16]) {
        s.add(new THREE.BoxGeometry(7, 0.35, 0.35), 0, y, dishZ - 3.2, { color: 0xd8dde2 });
        s.add(new THREE.BoxGeometry(7, 0.35, 0.35), 0, y, dishZ + 3.2, { color: 0xd8dde2 });
        s.add(new THREE.BoxGeometry(0.35, 0.35, 7), -3.2, y, dishZ, { color: 0xd8dde2 });
        s.add(new THREE.BoxGeometry(0.35, 0.35, 7), 3.2, y, dishZ, { color: 0xd8dde2 });
    }
    s.add(new THREE.BoxGeometry(6, 4, 6), 0, 20.5, dishZ, { color: 0x8a9096 });
    // Radome tower on the east ridge.
    const domeX = halfW + 62;
    const domeZ = 18;
    s.add(new THREE.CylinderGeometry(4, 5, 14, 12), domeX, 7, domeZ, { color: CONCRETE });
    s.add(new THREE.CylinderGeometry(6.4, 6.4, 1.2, 16), domeX, 14.4, domeZ, { color: 0x6f757c });
    // Fuel tanks + huts + comms masts scattered outside the court.
    for (const [x, z] of [[-(halfW + 20), -(halfL + 20)], [-(halfW + 26), halfL + 18], [halfW + 22, -(halfL + 24)]]) {
        s.add(new THREE.CylinderGeometry(2.4, 2.4, 9, 14), x, 2.6, z, { rz: Math.PI / 2, color: 0xd8dde2 });
        s.add(new THREE.BoxGeometry(6, 3.6, 5), x + 8, 1.8, z, { color: ORANGE });
        s.add(new THREE.BoxGeometry(6.4, 0.5, 5.4), x + 8, 3.85, z, { color: 0xf4f8fc });
    }
    for (const [x, z] of [[-(halfW + 18), 34], [halfW + 18, -34]]) {
        s.add(new THREE.CylinderGeometry(0.25, 0.35, 24, 6), x, 12, z, { color: 0xe0402a });
        for (const y of [8, 16, 23]) s.add(new THREE.BoxGeometry(3, 0.12, 0.12), x, y, z, { color: 0xd8dde2 });
    }
    // Snow fence posts beyond the stands.
    for (const sx of [-1, 1]) for (let z = -halfL - 6; z <= halfL + 6; z += 5) s.add(new THREE.BoxGeometry(0.14, 1.6, 0.14), sx * (halfW + 17), 0.8, z, { color: 0x6b4a2a });
    // Flag poles at the lab entrance.
    for (let k = 0; k < 3; k++) s.add(new THREE.CylinderGeometry(0.1, 0.12, 10, 6), labX + 11, 5, 4 + k * 4, { color: 0xd8dde2 });
    const buildings = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (buildings) { buildings.receiveShadow = true; ctx.add(buildings); }
    const glowMesh = glow.build(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    if (glowMesh) ctx.add(glowMesh);

    // Dish + radome: faceted white, double-sided (the dish is an open bowl).
    const white = new GeoBatch({ colors: true });
    const bowl = [];
    for (let i = 0; i <= 10; i++) {
        const r = (i / 10) * 17;
        bowl.push(new THREE.Vector2(Math.max(0.01, r), (r * r) / 60));
    }
    const dishGeo = new THREE.LatheGeometry(bowl, 28);
    white.add(dishGeo, 0, 26, dishZ, { rx: 0.75, color: 0xf2f5f8 });
    white.add(new THREE.CylinderGeometry(0.8, 1.2, 4, 10), 0, 26 + Math.cos(0.75) * 6.5, dishZ + Math.sin(0.75) * 6.5, { rx: 0.75, color: 0xd8dde2 });
    white.add(new THREE.IcosahedronGeometry(9, 2), domeX, 22.5, domeZ, { color: 0xf4f7fa });
    const whiteMesh = white.build(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true }));
    if (whiteMesh) ctx.add(whiteMesh);

    // Mountains: jagged ring, rock below / snow above (per-vertex colour).
    const peaks = [];
    const rock = new THREE.Color(0x5f6874);
    const snowC = new THREE.Color(0xf4f7fa);
    const tmp = new THREE.Color();
    const peakCount = ctx.tier === 'low' ? 12 : 20;
    for (let i = 0; i < peakCount; i++) {
        const angle = (i / peakCount) * Math.PI * 2 + rng() * 0.2;
        const dist = 330 + rng() * 160;
        const height = 90 + rng() * 150;
        const radius = 90 + rng() * 80;
        const geo = new THREE.ConeGeometry(radius, height, 9, 5).toNonIndexed();
        const pos = geo.getAttribute('position');
        const colors = new Float32Array(pos.count * 3);
        for (let v = 0; v < pos.count; v++) {
            const y = pos.getY(v);
            const t = (y + height / 2) / height;
            const k = Math.sin(pos.getX(v) * 0.05 + i) * Math.cos(pos.getZ(v) * 0.04) * 0.5 + 0.5;
            if (t < 0.98) {
                pos.setX(v, pos.getX(v) * (0.85 + k * 0.3));
                pos.setZ(v, pos.getZ(v) * (0.85 + (1 - k) * 0.3));
            }
            tmp.copy(rock).lerp(snowC, t > 0.42 + k * 0.18 ? 1 : t * 0.4);
            colors[v * 3] = tmp.r; colors[v * 3 + 1] = tmp.g; colors[v * 3 + 2] = tmp.b;
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.deleteAttribute('uv');
        geo.computeVertexNormals();
        geo.translate(Math.cos(angle) * dist, height / 2 - 20, Math.sin(angle) * dist);
        peaks.push(geo);
    }
    const peakGeo = mergeGeometries(peaks, false);
    for (const geo of peaks) geo.dispose();
    if (peakGeo) {
        peakGeo.computeBoundingSphere();
        ctx.add(new THREE.Mesh(peakGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true })));
    }

    // Snow-laden pines (one merged tree, instanced) — the "Pines" east slope.
    const tree = new GeoBatch({ colors: true });
    tree.add(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), 0, 1.5, 0, { color: 0x4a3526 });
    for (let k = 0; k < 3; k++) {
        const r = 2.6 - k * 0.7;
        tree.add(new THREE.ConeGeometry(r, 3.2, 8), 0, 3.2 + k * 2, 0, { color: 0x24452f });
        tree.add(new THREE.ConeGeometry(r * 0.72, 1.4, 8), 0, 4.3 + k * 2, 0, { color: 0xeef3f8 });
    }
    const treeScratch = new THREE.MeshBasicMaterial();
    const treeGeo = tree.build(treeScratch)?.geometry;
    treeScratch.dispose();
    const pines = [];
    const pineCount = ctx.tier === 'low' ? 70 : high ? 190 : 140;
    for (let i = 0; i < pineCount; i++) {
        const east = i % 3 !== 0;
        const angle = east ? -0.9 + rng() * 1.8 : rng() * Math.PI * 2;
        const dist = east ? halfW + 40 + rng() * 80 : 150 + rng() * 90;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist * (east ? 1.2 : 1);
        if (Math.abs(x) < halfW + 22 && Math.abs(z) < halfL + 30) continue;
        if (Math.hypot(x - domeX, z - domeZ) < 14) continue;
        pines.push({ x, y: 0, z, s: 1 + rng() * 1.3, ry: rng() * 6 });
    }
    if (treeGeo) {
        const pineMesh = instanced(treeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), pines);
        if (pineMesh) ctx.add(pineMesh);
    }

    // Signs: callouts on buildings + a ridge signpost.
    const SIGNS = ['LAB 2', 'HANGAR', 'DISH', 'RADOME', 'RIDGE', 'PINES', 'STATION 7', 'THIN ICE'];
    const atlas = signAtlas(ctx, 2, 4, 256, 96, (g, i, x, y, w, h) => {
        paintSign(g, x, y, w, h, SIGNS[i], {
            bg: i === 7 ? '#f2c230' : i === 6 ? '#ff6a2a' : '#1c232c',
            border: i === 7 ? '#1c1c1c' : '#ffffff',
            fg: i === 7 ? '#1c1c1c' : '#ffffff'
        });
    });
    const signs = new GeoBatch();
    signs.add(new THREE.PlaneGeometry(10, 3.6), labX + 8.03, 7.2, 12, { ry: Math.PI / 2, ...atlas.uv(0) });
    signs.add(new THREE.PlaneGeometry(10, 3.6), labX + 8.03, 7.2, -30, { ry: Math.PI / 2, ...atlas.uv(6) });
    signs.add(new THREE.PlaneGeometry(12, 4.2), 0, 13.6, hangarZ - 17.45, { ry: Math.PI, ...atlas.uv(1) });
    signs.add(new THREE.PlaneGeometry(9, 3.2), 0, 1.6, dishZ + 8.03, { ...atlas.uv(2) });
    signs.add(new THREE.PlaneGeometry(6, 2.2), domeX - 4.6, 6, domeZ, { ry: -Math.PI / 2, ...atlas.uv(3) });
    signs.add(new THREE.PlaneGeometry(4, 1.5), halfW + 17, 2.6, 30, { ry: -Math.PI / 2, ...atlas.uv(5) });
    signs.add(new THREE.PlaneGeometry(4, 1.5), halfW + 17, 2.6, -30, { ry: -Math.PI / 2, ...atlas.uv(4) });
    signs.add(new THREE.PlaneGeometry(4, 1.5), -(halfW + 17), 2.6, 40, { ry: Math.PI / 2, ...atlas.uv(7) });
    const signMesh = signs.build(new THREE.MeshLambertMaterial({ map: atlas.texture, color: atlas.texture ? 0xffffff : 0x1c232c, side: THREE.DoubleSide }));
    if (signMesh) ctx.add(signMesh);

    // Red aviation beacons: dish, masts, radome, lab antennas.
    const beacons = [{ x: 0, y: 23, z: dishZ }, { x: domeX, y: 31.8, z: domeZ },
        { x: -(halfW + 18), y: 24.3, z: 34 }, { x: halfW + 18, y: 24.3, z: -34 }, { x: 0, y: 15.5, z: hangarZ }];
    const beaconMesh = instanced(new THREE.SphereGeometry(0.5, 8, 6),
        animate(new THREE.MeshBasicMaterial({ color: 0xff2a1a }), ctx, { mode: 'blink', amp: 0.1, speed: 0.7 }), beacons);
    if (beaconMesh) ctx.add(beaconMesh);

    if (live) {
        // Spindrift: wisps of snow streaming low across the field.
        const wisps = canvasTexture(ctx, 256, 64, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            for (let i = 0; i < 60; i++) {
                const y = h * (0.2 + rng() * 0.6);
                const x = rng() * w;
                const len = 30 + rng() * 90;
                const grad = g.createLinearGradient(x, 0, x + len, 0);
                grad.addColorStop(0, 'rgba(255,255,255,0)');
                grad.addColorStop(0.5, `rgba(255,255,255,${0.25 + rng() * 0.4})`);
                grad.addColorStop(1, 'rgba(255,255,255,0)');
                g.fillStyle = grad;
                g.fillRect(x, y, len, 1 + rng() * 2);
            }
            const fade = g.createLinearGradient(0, 0, 0, h);
            fade.addColorStop(0, 'rgba(0,0,0,1)');
            fade.addColorStop(0.35, 'rgba(0,0,0,0)');
            fade.addColorStop(0.65, 'rgba(0,0,0,0)');
            fade.addColorStop(1, 'rgba(0,0,0,1)');
            g.globalCompositeOperation = 'destination-out';
            g.fillStyle = fade;
            g.fillRect(0, 0, w, h);
        });
        if (wisps) wisps.wrapS = THREE.RepeatWrapping;
        const drift = new GeoBatch();
        for (const sx of [-1, 1]) {
            for (let k = 0; k < 3; k++) {
                const x = sx * (halfW + 20 + k * 22);
                drift.add(new THREE.PlaneGeometry((halfL + 50) * 2, 2.4), x, 1.1 + k * 0.4, 0, { ry: Math.PI / 2, uvScale: [6, 1] });
            }
        }
        for (const sz of [-1, 1]) drift.add(new THREE.PlaneGeometry((halfW + 40) * 2, 2.2), 0, 1.2, sz * (halfL + 16), { uvScale: [5, 1] });
        const driftMesh = drift.build(animate(new THREE.MeshBasicMaterial({
            map: wisps, color: wisps ? 0xffffff : 0x000000, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide
        }), ctx, { mode: 'scroll', speed: 0.18 }));
        if (driftMesh) ctx.add(driftMesh);

        // Flags at the lab entrance (station orange, white, team colours).
        const flags = new GeoBatch({ colors: true });
        [ORANGE, 0xf4f8fc, ctx.config.floorBlue].forEach((color, k) => {
            flags.add(new THREE.PlaneGeometry(3.2, 2, 6, 3), labX + 11, 8.8, 4 + k * 4 + 1.6, { ry: Math.PI / 2, color });
        });
        const flagMesh = flags.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
            { mode: 'wave', amp: 0.3, speed: 4, freq: 0.6 }));
        if (flagMesh) ctx.add(flagMesh);

        // Ravens circling the dish.
        const ravens = new GeoBatch();
        for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * Math.PI * 2;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0.25, 0, 0, 0, 0.3, 0, 0, -0.2, 1, 0.25, 0, 0, 0, -0.2, 0, 0, 0.3], 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
            ravens.add(geo, Math.cos(angle) * 90, 40 + (i % 3) * 5, Math.sin(angle) * 90, { ry: -angle });
        }
        const ravenMesh = ravens.build(animate(new THREE.MeshBasicMaterial({ color: 0x1a1c20, side: THREE.DoubleSide }), ctx,
            { mode: 'orbit', speed: 0.05, amp: 2, freq: 0.5 }));
        if (ravenMesh) { ravenMesh.frustumCulled = false; ctx.add(ravenMesh); }
    }

    // Court: blown snow on the edges, ice sheen, station markings.
    courtDecal(ctx, (g, w, h, ppm) => {
        for (let i = 0; i < 40; i++) {
            const r = (2 + rng() * 6) * ppm;
            const x = rng() < 0.5 ? rng() * 0.12 * w : w - rng() * 0.12 * w;
            const y = rng() * h;
            const grad = g.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(245,249,255,0.55)');
            grad.addColorStop(1, 'rgba(245,249,255,0)');
            g.fillStyle = grad;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 5; i++) {
            const x = (0.2 + rng() * 0.25) * w;
            const y = (0.1 + rng() * 0.3) * h;
            for (const [px, py] of [[x, y], [w - x, h - y]]) {
                const r = (3 + rng() * 3) * ppm;
                const ice = g.createRadialGradient(px, py, 0, px, py, r);
                ice.addColorStop(0, 'rgba(200,230,255,0.22)');
                ice.addColorStop(1, 'rgba(200,230,255,0)');
                g.fillStyle = ice;
                g.fillRect(px - r, py - r, r * 2, r * 2);
            }
        }
        const band = 1.1 * ppm;
        for (const y0 of [0.35 * ppm, h - 0.35 * ppm - band]) {
            g.save();
            g.beginPath();
            g.rect(0, y0, w, band);
            g.clip();
            for (let x = -band; x < w + band; x += band * 1.4) {
                g.fillStyle = 'rgba(255,106,42,0.34)';
                g.beginPath();
                g.moveTo(x, y0); g.lineTo(x + band * 0.7, y0); g.lineTo(x + band * 1.4, y0 + band); g.lineTo(x + band * 0.7, y0 + band);
                g.fill();
            }
            g.restore();
        }
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.font = `900 ${Math.round(4 * ppm)}px Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('HANGAR', w / 2, h * 0.93);
        g.save();
        g.translate(w / 2, h * 0.07);
        g.rotate(Math.PI);
        g.fillText('DISH', 0, 0);
        g.restore();
    });
}
