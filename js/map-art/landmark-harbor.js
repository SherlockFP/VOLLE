// map-art/landmark-harbor.js — Harbor Nightworks: a rain-soaked container
// port at night. Palette: wet asphalt, sodium orange, container primaries
// dulled by rain, cold moon-blue fill. Landmarks: the ship-to-shore gantry
// Crane over the quay (east), Shed 9 behind the red back line, Gate B behind
// the blue one, the moored Ship and a city skyline across the bay.
// Wet ground = low-roughness MeshStandard + a painted night environment map
// (scene.environment, cleared by Arena.clearMap). Rain is the map's weather.
import * as THREE from 'three';
import {
    GeoBatch, instanced, animate, canvasTexture, courtDecal,
    signAtlas, paintSign, facadeBox, paintedEnvironment, glowTexture
} from './kit.js';

const STEEL = [0x8e3326, 0x2b5d8a, 0x3f7a4a, 0xc9692a, 0x7a8088, 0x5e3560, 0xb8a13a];

export function buildHarborNightworksArt(ctx) {
    const { halfW, halfL, rng, animate: live, high } = ctx;
    const quayX = halfW + 34;          // concrete quay edge (water beyond, east)
    const yardX = halfW + 70;          // container yard extent (west)
    const yardZ = halfL + 70;

    // Painted night environment: dark sky, sodium glow along the horizon,
    // a few hot lamp spots — every wet MeshStandard surface reflects it.
    if (ctx.animate) {
        const env = paintedEnvironment(ctx, (g, w, h) => {
            const sky = g.createLinearGradient(0, 0, 0, h);
            sky.addColorStop(0, '#05070c');
            sky.addColorStop(0.42, '#1a1d26');
            sky.addColorStop(0.5, '#6a4526');
            sky.addColorStop(0.56, '#1a1510');
            sky.addColorStop(1, '#0a0a0c');
            g.fillStyle = sky;
            g.fillRect(0, 0, w, h);
            for (let i = 0; i < 26; i++) {
                const x = rng() * w;
                const y = h * (0.4 + rng() * 0.12);
                const r = 4 + rng() * 10;
                const glow = g.createRadialGradient(x, y, 0, x, y, r);
                glow.addColorStop(0, 'rgba(255,190,110,0.95)');
                glow.addColorStop(1, 'rgba(255,150,60,0)');
                g.fillStyle = glow;
                g.fillRect(x - r, y - r, r * 2, r * 2);
            }
        });
        if (env) ctx.arena.scene.environment = env;
    }

    // Wet asphalt yard: tyre tracks, lane paint, drains, oil sheen.
    const asphalt = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#2a2b2e';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2200; i++) {
            const v = 30 + Math.floor(rng() * 30);
            g.fillStyle = `rgb(${v},${v},${v + 3})`;
            g.fillRect(rng() * w, rng() * h, 2, 2);
        }
        for (let i = 0; i < 6; i++) {
            const r = 14 + rng() * 26;
            const x = rng() * w;
            const y = rng() * h;
            const pool = g.createRadialGradient(x, y, 0, x, y, r);
            pool.addColorStop(0, 'rgba(8,10,14,0.7)');
            pool.addColorStop(1, 'rgba(8,10,14,0)');
            g.fillStyle = pool;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 3;
        g.strokeRect(0, 0, w, h);
    }, { repeatX: 14, repeatY: 14 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(yardX + quayX, yardZ * 2),
        new THREE.MeshStandardMaterial({ color: 0x9a9aa0, map: asphalt, roughness: 0.28, metalness: 0.3 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((quayX - yardX) / 2, -0.03, 0);
    ground.receiveShadow = true;
    ctx.add(ground);

    // Harbour water beyond the quay: dark, rain-stippled shimmer.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900),
        animate(new THREE.MeshStandardMaterial({ color: 0x0c1824, roughness: 0.12, metalness: 0.4 }), ctx,
            { mode: 'shimmer', amp: 0.035, speed: 1.6, freq: 0.6 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(quayX + 450, -2.4, 0);
    ctx.add(water);

    // --- Yard containers: stacked walls west + deck cargo on the ship --------
    const boxes = [];
    const container = (x, y, z, ry, tier) => boxes.push({
        x, y: y + 1.3, z, ry, sx: 2.44, sy: 2.58, sz: 6.06, color: STEEL[Math.floor(rng() * STEEL.length)], tier
    });
    for (let row = 0; row < 5; row++) {
        const x = -(halfW + 24 + row * 7.5);
        for (let z = -halfL - 12; z < halfL + 12; z += 6.4) {
            const height = 1 + Math.floor(rng() * (2 + row * 0.6));
            for (let t = 0; t < Math.min(5, height); t++) container(x, t * 2.6, z + 3.2, Math.PI / 2 * 0, t);
        }
    }
    // Behind Shed 9 and Gate B: cross stacks.
    for (const sz of [-1, 1]) {
        for (let x = -halfW; x < halfW; x += 6.4) {
            const height = 2 + Math.floor(rng() * 3);
            for (let t = 0; t < height; t++) container(x, t * 2.6, sz * (halfL + 52), Math.PI / 2, t);
        }
    }
    const shipX = quayX + 22;
    const shipLen = 190;
    for (let bay = 0; bay < 18; bay++) {
        const z = -shipLen / 2 + 40 + bay * 6.6;
        for (let col = -2; col <= 2; col++) {
            const height = 2 + Math.floor(rng() * 3);
            for (let t = 0; t < height; t++) container(shipX + col * 2.6, 9 + t * 2.6, z, 0, t);
        }
    }
    const ribs = canvasTexture(ctx, 128, 128, (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 12) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(x, 0, 4, h);
            g.fillStyle = 'rgba(255,255,255,0.3)';
            g.fillRect(x + 6, 0, 2, h);
        }
        const rust = g.createLinearGradient(0, h * 0.6, 0, h);
        rust.addColorStop(0, 'rgba(60,30,15,0)');
        rust.addColorStop(1, 'rgba(60,30,15,0.5)');
        g.fillStyle = rust;
        g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(20,20,24,0.8)';
        g.fillRect(0, 0, 3, h);
        g.fillRect(w - 3, 0, 3, h);
    });
    const shown = ctx.tier === 'low' ? boxes.filter((b, i) => b.tier < 2 || i % 3 === 0) : boxes;
    const containerMesh = instanced(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, map: ribs, roughness: 0.5, metalness: 0.35 }), shown);
    if (containerMesh) { containerMesh.receiveShadow = true; ctx.add(containerMesh); }

    // --- Steel: gantry crane, ship hull/superstructure, Shed 9, gatehouse,
    // light poles, quay bollards and fence posts — one vertex-coloured batch.
    const s = new GeoBatch({ colors: true });
    const CRANE = 0x3e6f96;
    const craneZ = -24;
    const legX = [quayX - 4, quayX + 26];
    // Portal legs (two A-frames), sill beams, boom over the water, back reach.
    for (const lz of [-9, 9]) {
        for (const lx of legX) s.add(new THREE.BoxGeometry(1.6, 44, 1.6), lx, 22, craneZ + lz, { color: CRANE });
        s.add(new THREE.BoxGeometry(legX[1] - legX[0], 1.6, 1.6), (legX[0] + legX[1]) / 2, 44, craneZ + lz, { color: CRANE });
        s.add(new THREE.BoxGeometry(legX[1] - legX[0], 1.2, 1.2), (legX[0] + legX[1]) / 2, 16, craneZ + lz, { color: CRANE });
        // Diagonal brace.
        const len = Math.hypot(legX[1] - legX[0], 28);
        s.add(new THREE.BoxGeometry(len, 0.8, 0.8), (legX[0] + legX[1]) / 2, 30, craneZ + lz, { rz: Math.atan2(28, legX[1] - legX[0]), color: CRANE });
        for (const lx of legX) s.add(new THREE.BoxGeometry(3.4, 1.4, 3.4), lx, 0.7, craneZ + lz, { color: 0x25303a });
    }
    for (const lx of legX) s.add(new THREE.BoxGeometry(1.6, 1.6, 18), lx, 44, craneZ, { color: CRANE });
    s.add(new THREE.BoxGeometry(1.2, 1.2, 18), legX[0], 16, craneZ, { color: CRANE });
    s.add(new THREE.BoxGeometry(110, 2.4, 3.2), quayX + 30, 47, craneZ, { color: 0xd8dde2 });
    s.add(new THREE.BoxGeometry(110, 0.5, 0.5), quayX + 30, 45.6, craneZ - 1.4, { color: 0xc03a2a });
    s.add(new THREE.BoxGeometry(110, 0.5, 0.5), quayX + 30, 45.6, craneZ + 1.4, { color: 0xc03a2a });
    s.add(new THREE.BoxGeometry(12, 6, 10), quayX + 2, 51, craneZ, { color: 0xd8dde2 });             // machinery house
    s.add(new THREE.BoxGeometry(1.2, 18, 1.2), quayX + 11, 57, craneZ, { color: CRANE });              // A-frame apex
    s.add(new THREE.BoxGeometry(3.4, 3, 3.4), quayX + 52, 44, craneZ, { color: 0x25303a });            // trolley
    s.add(new THREE.BoxGeometry(0.15, 26, 0.15), quayX + 51, 30, craneZ - 1, { color: 0x111418 });     // hoist cables
    s.add(new THREE.BoxGeometry(0.15, 26, 0.15), quayX + 53, 30, craneZ + 1, { color: 0x111418 });
    s.add(new THREE.BoxGeometry(2.8, 0.8, 6.6), quayX + 52, 17, craneZ, { color: 0xe0b020 });           // spreader
    // Ship: hull, red boot-top, bridge superstructure + funnel at the stern.
    s.add(new THREE.BoxGeometry(30, 12, shipLen), shipX, 3, 0, { color: 0x1c2a36 });
    s.add(new THREE.BoxGeometry(30.2, 2.4, shipLen + 0.2), shipX, -2.4, 0, { color: 0x7a2420 });
    s.add(new THREE.ConeGeometry(15, 26, 4, 1), shipX, 3, -shipLen / 2 - 12, { rx: -Math.PI / 2, ry: Math.PI / 4, sx: 1, sz: 0.46, color: 0x1c2a36 });
    s.add(new THREE.BoxGeometry(26, 2, 12), shipX, 10, shipLen / 2 - 18, { color: 0xd8dde2 });
    s.add(new THREE.BoxGeometry(5, 12, 5), shipX + 6, 22, shipLen / 2 - 12, { color: 0x2a2f36 });
    // Quay edge: kerb, bollards, tyre fenders.
    s.add(new THREE.BoxGeometry(1.2, 0.5, yardZ * 2), quayX - 0.6, 0.25, 0, { color: 0xc9c2a8 });
    s.add(new THREE.BoxGeometry(2, 4, yardZ * 2), quayX + 1, -2, 0, { color: 0x4a4a4c });
    // Shed 9 (behind the red back line): corrugated shed, roof, roller doors.
    const shedZ = -(halfL + 26);
    s.add(new THREE.BoxGeometry(88, 2, 26), 0, 17, shedZ, { color: 0x3a3e44 });
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(2, 16, 26), sx * 44, 8, shedZ, { color: 0x6f7780 });
    // Gate B (behind the blue back line): gatehouse, barrier posts, canopy.
    const gateZ = halfL + 20;
    for (const sx of [-1, 1]) {
        s.add(new THREE.BoxGeometry(8, 5, 6), sx * 16, 2.5, gateZ, { color: 0xd8d4c8 });
        s.add(new THREE.BoxGeometry(8.6, 0.4, 6.6), sx * 16, 5.2, gateZ, { color: 0x3a3e44 });
        s.add(new THREE.BoxGeometry(0.5, 1.2, 0.5), sx * 11, 0.6, gateZ - 3.5, { color: 0xe0b020 });
        s.add(new THREE.BoxGeometry(9, 0.25, 0.25), sx * 6.5, 1.1, gateZ - 3.5, { color: 0xd83a2a });   // barrier arms
    }
    s.add(new THREE.BoxGeometry(46, 0.8, 14), 0, 8, gateZ, { color: 0xd8d4c8 });
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(0.8, 8, 0.8), sx * 22.6, 4, gateZ - 6, { color: 0x6f7780 });
    // Sodium light poles: both flanks + behind each end.
    const poles = [];
    for (const sx of [-1, 1]) for (const z of [-48, -16, 16, 48]) poles.push([sx * (halfW + 18), z, sx]);
    for (const sz of [-1, 1]) for (const x of [-30, 30]) poles.push([x, sz * (halfL + 10), 0]);
    for (const [x, z, sx] of poles) {
        s.add(new THREE.CylinderGeometry(0.22, 0.32, 16, 8), x, 8, z, { color: 0x3a3f46 });
        s.add(new THREE.BoxGeometry(sx ? 3.2 : 0.3, 0.25, sx ? 0.3 : 3.2), x - sx * 1.5, 16, z - (sx ? 0 : Math.sign(z) * 1.5), { color: 0x3a3f46 });
    }
    // Chain-link fence posts along the yard edges.
    for (const sz of [-1, 1]) for (let x = -halfW - 20; x <= quayX - 4; x += 6) s.add(new THREE.BoxGeometry(0.15, 3.2, 0.15), x, 1.6, sz * (halfL + 8), { color: 0x6f7780 });
    const steel = s.build(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.45 }));
    if (steel) { steel.receiveShadow = true; ctx.add(steel); }

    // Bollards + fenders (instanced).
    const bollards = [];
    for (let z = -yardZ + 8; z < yardZ; z += 12) bollards.push({ x: quayX - 2, y: 0.5, z, s: 1 });
    const bollardMesh = instanced(new THREE.CylinderGeometry(0.4, 0.5, 1, 10), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.6 }), bollards);
    if (bollardMesh) ctx.add(bollardMesh);

    // Shed 9 + gatehouse facades, ship bridge windows, city across the bay:
    // one self-lit facade batch (windows / painted numerals / roller doors).
    const windows = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#0b0d12';
        g.fillRect(0, 0, w, h);
        for (let r = 0; r < 12; r++) for (let c = 0; c < 8; c++) {
            const on = rng() < 0.42;
            g.fillStyle = on ? ['#ffcf8a', '#ffe2b0', '#9fd0ff'][Math.floor(rng() * 3)] : '#161a22';
            g.globalAlpha = on ? 0.5 + rng() * 0.5 : 1;
            g.fillRect(c * 32 + 7, r * 21 + 6, 18, 10);
        }
        g.globalAlpha = 1;
    });
    if (windows) windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
    const city = new GeoBatch({ colors: true });
    const cityCount = ctx.tier === 'low' ? 40 : high ? 100 : 70;
    for (let i = 0; i < cityCount; i++) {
        const t = i / cityCount;
        const z = -380 + t * 760 + (rng() - 0.5) * 10;
        const x = 330 + rng() * 120;
        const top = 12 + rng() * (Math.abs(z) < 150 ? 90 : 40);
        const base = -40;
        city.add(facadeBox(14 + rng() * 14, top - base, 14 + rng() * 10, 16, 24), x, base + (top - base) / 2, z, { color: 0xffffff });
    }
    // Ship bridge windows.
    city.add(facadeBox(24, 10, 10, 16, 24, [0.02, 0.02]), shipX, 16, shipLen / 2 - 18, { color: 0xffffff });
    const cityMesh = city.build(new THREE.MeshBasicMaterial({ color: 0xffffff, map: windows }));
    if (cityMesh) ctx.add(cityMesh);

    // Shed 9 corrugated front wall with its huge painted numeral + doors.
    const shedTex = canvasTexture(ctx, 1024, 256, (g, w, h) => {
        g.fillStyle = '#5e666e';
        g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 10) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(x, 0, 3, h);
        }
        const rust = g.createLinearGradient(0, h * 0.55, 0, h);
        rust.addColorStop(0, 'rgba(80,40,20,0)');
        rust.addColorStop(1, 'rgba(80,40,20,0.55)');
        g.fillStyle = rust;
        g.fillRect(0, 0, w, h);
        for (const x of [0.12, 0.66]) {
            g.fillStyle = '#3b4148';
            g.fillRect(w * x, h * 0.3, w * 0.22, h * 0.7);
            for (let y = h * 0.3; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(w * x, y, w * 0.22, 2); }
            g.fillStyle = '#f2c230';
            g.fillRect(w * x, h * 0.26, w * 0.22, h * 0.04);
        }
        g.fillStyle = '#e8e2d0';
        g.font = '900 230px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('9', w * 0.5, h * 0.56);
        g.font = '900 44px Arial, sans-serif';
        g.fillText('SHED', w * 0.5, h * 0.1);
    });
    const shedFront = new THREE.Mesh(new THREE.PlaneGeometry(86, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, map: shedTex, roughness: 0.6, metalness: 0.3 }));
    shedFront.position.set(0, 8, shedZ + 13.05);
    ctx.add(shedFront);

    // Signs (callouts): SHED 9 / GATE B / BERTH 4 / STACKS / QUAY / CRANE 2.
    const SIGNS = ['SHED 9', 'GATE B', 'BERTH 4', 'STACKS', 'QUAY', 'CRANE 2', 'PALLETS', 'NO ENTRY'];
    const atlas = signAtlas(ctx, 2, 4, 256, 96, (g, i, x, y, w, h) => {
        paintSign(g, x, y, w, h, SIGNS[i], {
            bg: i === 7 ? '#b22a22' : i < 2 ? '#101418' : '#1f4f7a', border: i < 2 ? '#f2c230' : '#e8eef4',
            fg: i < 2 ? '#f2c230' : '#ffffff'
        });
    });
    const signs = new GeoBatch();
    signs.add(new THREE.PlaneGeometry(12, 4.5), 0, 13, gateZ - 7.1, { ry: Math.PI, ...atlas.uv(1) });
    for (const sx of [-1, 1]) {
        signs.add(new THREE.PlaneGeometry(6, 2.2), sx * 16, 3.6, gateZ - 3.05, { ry: Math.PI, ...atlas.uv(7) });
        signs.add(new THREE.PlaneGeometry(8, 3), sx * 24, 12, shedZ + 13.1, { ...atlas.uv(0) });
    }
    // Banner hung under the crane's lower sill beam, facing the court.
    signs.add(new THREE.PlaneGeometry(9, 3.4), quayX - 4.9, 13.6, craneZ, { ry: -Math.PI / 2, ...atlas.uv(5) });
    // Painted on the ship's hull and on the crane leg footing.
    signs.add(new THREE.PlaneGeometry(20, 7.5), shipX - 15.05, 4, 30, { ry: -Math.PI / 2, ...atlas.uv(2) });
    signs.add(new THREE.PlaneGeometry(3.2, 1.2), quayX - 5.72, 0.7, craneZ + 9, { ry: -Math.PI / 2, ...atlas.uv(4) });
    // On the first container row facing the west stands.
    signs.add(new THREE.PlaneGeometry(9, 2.2), -(halfW + 22.74), 4, -22, { ry: Math.PI / 2, ...atlas.uv(3) });
    signs.add(new THREE.PlaneGeometry(9, 2.2), -(halfW + 22.74), 4, 22, { ry: Math.PI / 2, ...atlas.uv(3) });
    const signMesh = signs.build(new THREE.MeshBasicMaterial({ map: atlas.texture, color: atlas.texture ? 0xdddddd : 0x1f4f7a, side: THREE.DoubleSide }));
    if (signMesh) ctx.add(signMesh);

    // Sodium lamp heads (buzzing flicker) + aviation lights on the crane.
    const heads = poles.map(([x, z, sx]) => ({ x: x - sx * 3, y: 15.8, z: z - (sx ? 0 : Math.sign(z) * 3), sx: 1.4, sy: 0.3, sz: 0.8, color: 0xffa84a }));
    const headMesh = instanced(new THREE.BoxGeometry(1, 1, 1),
        animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx, { mode: 'flicker', amp: 0.4, speed: 11 }), heads);
    if (headMesh) ctx.add(headMesh);
    const beacons = [
        { x: quayX + 84, y: 48.6, z: craneZ }, { x: quayX + 11, y: 66.4, z: craneZ }, { x: quayX - 24, y: 48.6, z: craneZ },
        { x: shipX + 6, y: 28.6, z: shipLen / 2 - 12 }, { x: 0, y: 18.4, z: shedZ + 12 }
    ];
    const beaconMesh = instanced(new THREE.SphereGeometry(0.6, 8, 6),
        animate(new THREE.MeshBasicMaterial({ color: 0xff2a1a }), ctx, { mode: 'blink', amp: 0.1, speed: 0.8 }), beacons);
    if (beaconMesh) ctx.add(beaconMesh);

    if (live) {
        // Light cones under the sodium heads: rain caught in the beam.
        const coneTex = glowTexture(ctx, '255,170,80');
        const cones = instanced(new THREE.ConeGeometry(6, 15.5, 16, 1, true),
            new THREE.MeshBasicMaterial({
                map: coneTex, color: coneTex ? 0xffffff : 0x442200, transparent: true, opacity: 0.09,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            }), heads.map(h => ({ x: h.x, y: 7.9, z: h.z })));
        if (cones) ctx.add(cones);

        // Chain-link fence panels (alpha-tested lattice).
        const mesh = canvasTexture(ctx, 64, 64, (g, w, h) => {
            g.clearRect(0, 0, w, h);
            g.strokeStyle = 'rgba(170,180,190,0.9)';
            g.lineWidth = 2;
            for (let i = -w; i < w * 2; i += 12) {
                g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
                g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
            }
        }, { repeatX: 40, repeatY: 1 });
        const fence = new GeoBatch();
        for (const sz of [-1, 1]) {
            const x0 = -halfW - 20;
            const len = quayX - 4 - x0;
            fence.add(new THREE.PlaneGeometry(len, 3), x0 + len / 2, 1.6, sz * (halfL + 8), { uvScale: [len / 4, 1] });
        }
        const fenceMesh = fence.build(new THREE.MeshBasicMaterial({ map: mesh, color: mesh ? 0xffffff : 0x556070, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
        if (fenceMesh) ctx.add(fenceMesh);

        // Gulls wheeling in the lamp glow over the water.
        const gulls = new GeoBatch();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0.25, 0, 0, 0, 0.3, 0, 0, -0.2, 1, 0.25, 0, 0, 0, -0.2, 0, 0, 0.3], 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
            gulls.add(geo, Math.cos(angle) * 110, 34 + (i % 3) * 4, Math.sin(angle) * 110, { ry: -angle });
        }
        const gullMesh = gulls.build(animate(new THREE.MeshBasicMaterial({ color: 0xb8bcc4, side: THREE.DoubleSide }), ctx,
            { mode: 'orbit', speed: 0.06, amp: 2, freq: 0.5 }));
        if (gullMesh) { gullMesh.frustumCulled = false; ctx.add(gullMesh); }
    }

    // Court: wet sheen streaks under the lamps, painted yard bay lines,
    // drain grates, BERTH 4 stencil — mirrored so neither half reads differently.
    courtDecal(ctx, (g, w, h, ppm) => {
        const streak = (x, y, color) => {
            const grad = g.createLinearGradient(x, y - 10 * ppm, x, y + 10 * ppm);
            grad.addColorStop(0, `rgba(${color},0)`);
            grad.addColorStop(0.5, `rgba(${color},0.22)`);
            grad.addColorStop(1, `rgba(${color},0)`);
            g.fillStyle = grad;
            g.fillRect(x - 1.2 * ppm, y - 10 * ppm, 2.4 * ppm, 20 * ppm);
        };
        for (const z of [-48, -16, 16, 48]) {
            const y = h / 2 + z * ppm;
            streak(1.5 * ppm, y, '255,170,80');
            streak(w - 1.5 * ppm, y, '255,170,80');
        }
        for (let i = 0; i < 8; i++) {
            const x = (0.1 + rng() * 0.35) * w;
            const y = (0.08 + rng() * 0.36) * h;
            const r = (2 + rng() * 4) * ppm;
            for (const [px, py] of [[x, y], [w - x, h - y]]) {
                const pool = g.createRadialGradient(px, py, 0, px, py, r);
                pool.addColorStop(0, 'rgba(6,8,12,0.4)');
                pool.addColorStop(1, 'rgba(6,8,12,0)');
                g.fillStyle = pool;
                g.fillRect(px - r, py - r, r * 2, r * 2);
            }
        }
        g.strokeStyle = 'rgba(242,194,48,0.32)';
        g.lineWidth = 0.22 * ppm;
        g.setLineDash([2 * ppm, 1.4 * ppm]);
        for (const fx of [0.22, 0.78]) { g.beginPath(); g.moveTo(fx * w, 0.04 * h); g.lineTo(fx * w, 0.96 * h); g.stroke(); }
        g.setLineDash([]);
        g.fillStyle = 'rgba(20,20,24,0.45)';
        for (const fy of [0.33, 0.67]) for (const fx of [0.5]) g.fillRect(fx * w - 0.6 * ppm, fy * h - 0.3 * ppm, 1.2 * ppm, 0.6 * ppm);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.font = `900 ${Math.round(4 * ppm)}px Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('GATE B', w / 2, h * 0.94);
        g.save();
        g.translate(w / 2, h * 0.06);
        g.rotate(Math.PI);
        g.fillText('SHED 9', 0, 0);
        g.restore();
    });
}
