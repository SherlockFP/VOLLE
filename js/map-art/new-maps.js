// map-art/new-maps.js — scenery for the three procedural maps added in the
// map-art pass: Neon Rooftop, Sunken Temple and Orbital Station.
//
// Gameplay cover (AC units, broken columns, reactor pylons, ...) is NOT built
// here: it lives in js/arena.js GAMEPLAY_LAYOUTS so colliders exist
// synchronously and deterministically on every client. This file only dresses
// the space OUTSIDE the court lines, so nothing here can collide or block.
// Budget: every family of props is one merged mesh or one InstancedMesh.
import * as THREE from 'three';
import {
    GeoBatch, instanced, animate, canvasTexture, courtDecal
} from './kit.js';

// ---------------------------------------------------------------------------
// Neon Rooftop — night skyline, parapet, water tower, neon billboards.
// ---------------------------------------------------------------------------
export function buildNeonRooftopArt(ctx) {
    const { halfW, halfL, rng } = ctx;
    const deckX = halfW + 34;
    const deckZ = halfL + 22;

    // Roof deck under the court and stands; tar-and-gravel tile.
    const gravel = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#23212c';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) {
            const v = 30 + Math.floor(rng() * 40);
            g.fillStyle = `rgb(${v},${v - 2},${v + 8})`;
            g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
        }
        g.strokeStyle = 'rgba(0,0,0,0.45)';
        g.lineWidth = 3;
        g.strokeRect(0, 0, w, h);
    }, { repeatX: deckX / 8, repeatY: deckZ / 8 });
    const deck = new THREE.Mesh(
        new THREE.PlaneGeometry(deckX * 2, deckZ * 2),
        new THREE.MeshStandardMaterial({ color: 0x5a5668, map: gravel, roughness: 0.92, metalness: 0.05 })
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.03;
    deck.receiveShadow = true;
    ctx.add(deck);

    // Static rooftop structures: parapet, water towers, billboard scaffolds,
    // stair house, antenna mast, duct runs — one vertex-coloured batch.
    const s = new GeoBatch({ colors: true });
    const CONCRETE = 0x46424f;
    const STEEL = 0x2c3038;
    const WOOD = 0x6b4a33;
    for (const sx of [-1, 1]) {
        s.add(new THREE.BoxGeometry(0.8, 1.3, deckZ * 2 + 0.8), sx * deckX, 0.65, 0, { color: CONCRETE });
    }
    for (const sz of [-1, 1]) {
        s.add(new THREE.BoxGeometry(deckX * 2 + 0.8, 1.3, 0.8), 0, 0.65, sz * deckZ, { color: CONCRETE });
    }
    // Water towers on two opposite corners (visual only, far outside play).
    for (const [x, z] of [[-deckX + 9, -deckZ + 9], [deckX - 9, deckZ - 9]]) {
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
            s.add(new THREE.BoxGeometry(0.35, 7, 0.35), x + lx * 2.6, 3.5, z + lz * 2.6, { color: STEEL });
        }
        s.add(new THREE.BoxGeometry(6.2, 0.3, 6.2), x, 7, z, { color: STEEL });
        s.add(new THREE.CylinderGeometry(3.4, 3.4, 6.5, 18, 1, true), x, 10.4, z, { color: WOOD });
        s.add(new THREE.CylinderGeometry(3.42, 3.42, 0.25, 18), x, 8.4, z, { color: STEEL });
        s.add(new THREE.CylinderGeometry(3.42, 3.42, 0.25, 18), x, 12.2, z, { color: STEEL });
        s.add(new THREE.ConeGeometry(3.8, 2.6, 18), x, 14.9, z, { color: 0x3a2a22 });
    }
    // Stair house + antenna mast on the other diagonal.
    for (const [x, z] of [[deckX - 10, -deckZ + 8], [-deckX + 10, deckZ - 8]]) {
        s.add(new THREE.BoxGeometry(8, 4.5, 6), x, 2.25, z, { color: CONCRETE });
        s.add(new THREE.BoxGeometry(8.6, 0.4, 6.6), x, 4.7, z, { color: STEEL });
        s.add(new THREE.BoxGeometry(0.5, 22, 0.5), x + 2.5, 15.5, z, { color: STEEL });
        for (let k = 0; k < 4; k++) s.add(new THREE.BoxGeometry(3 - k * 0.6, 0.15, 0.15), x + 2.5, 10 + k * 4, z, { color: STEEL });
    }
    // Billboard scaffolds behind each baseline, facing the court.
    const boardW = 34;
    const boardH = 9;
    const boardZ = deckZ - 3;
    for (const sz of [-1, 1]) {
        for (const lx of [-0.42, 0, 0.42]) {
            s.add(new THREE.BoxGeometry(0.5, 14, 0.5), lx * boardW, 7, sz * (boardZ + 1.2), { color: STEEL });
        }
        s.add(new THREE.BoxGeometry(boardW + 1.4, boardH + 1.4, 0.6), 0, 10 + boardH / 2, sz * (boardZ + 0.6), { color: 0x15161c });
        s.add(new THREE.BoxGeometry(boardW + 2, 0.3, 2.2), 0, 9.6, sz * (boardZ - 0.2), { color: STEEL });
    }
    // Duct runs along the parapet.
    for (const sx of [-1, 1]) {
        s.add(new THREE.CylinderGeometry(0.5, 0.5, deckZ * 1.6, 10), sx * (deckX - 2), 0.6, 0, { rx: Math.PI / 2, color: 0x5b6069 });
    }
    const structures = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (structures) { structures.receiveShadow = true; ctx.add(structures); }

    // Parapet neon edge strip.
    const strip = new GeoBatch({ colors: true });
    for (const sx of [-1, 1]) strip.add(new THREE.BoxGeometry(0.2, 0.12, deckZ * 2), sx * deckX, 1.36, 0, { color: sx < 0 ? 0xff3d9a : 0x35e0ff });
    for (const sz of [-1, 1]) strip.add(new THREE.BoxGeometry(deckX * 2, 0.12, 0.2), 0, 1.36, sz * deckZ, { color: sz < 0 ? 0xff3d9a : 0x35e0ff });
    const stripMesh = strip.build(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    if (stripMesh) ctx.add(stripMesh);

    // Skyline: one merged mesh, windows from a tiled facade texture.
    const facade = canvasTexture(ctx, 256, 512, (g, w, h) => {
        g.fillStyle = '#07080f';
        g.fillRect(0, 0, w, h);
        const cols = 8;
        const rows = 16;
        const cw = w / cols;
        const rh = h / rows;
        const lit = ['#ffd27a', '#ffe7b0', '#8fd8ff', '#ff7ad9', '#b6a4ff'];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const on = rng() < 0.38;
                g.fillStyle = on ? lit[Math.floor(rng() * lit.length)] : '#141827';
                g.globalAlpha = on ? 0.55 + rng() * 0.45 : 1;
                g.fillRect(c * cw + cw * 0.18, r * rh + rh * 0.22, cw * 0.64, rh * 0.5);
            }
        }
        g.globalAlpha = 1;
        g.fillStyle = '#05060b';
        g.fillRect(0, 0, w, 6);
        g.fillRect(0, h - 6, w, 6);
    }, { repeatX: 1, repeatY: 1 });
    if (facade) facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    const sky = new GeoBatch({ colors: true });
    const tops = [];
    const count = ctx.tier === 'low' ? 56 : ctx.high ? 130 : 92;
    const tints = [0x9fb0ff, 0xd0c8ff, 0xffd9c0, 0xb8f0ff, 0xffffff];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rng() * 0.05;
        const ring = i % 3;
        const dist = [118, 165, 235][ring] + rng() * 40;
        const w = 12 + rng() * 16;
        const d = 12 + rng() * 16;
        const top = [-14 + rng() * 34, 6 + rng() * 70, 30 + rng() * 110][ring];
        const base = -90;
        const h = top - base;
        const geo = buildingGeometry(w, h, d);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        sky.add(geo, x, base + h / 2, z, { ry: -angle, color: tints[i % tints.length] });
        if (ring > 0 && rng() < 0.45) {
            const mast = 4 + rng() * 10;
            sky.add(new THREE.BoxGeometry(0.6, mast, 0.6), x, top + mast / 2, z, { color: 0x222633, uvConst: [0.001, 0.001] });
            tops.push({ x, y: top + mast, z });
        }
    }
    // Sign towers on the nearest ring carry the rooftop neon signs.
    const signSpots = [];
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + 0.52;
        const spot = { angle, x: Math.cos(angle) * 112, z: Math.sin(angle) * 112, y: 16 + (i % 3) * 7 };
        signSpots.push(spot);
        const towerTop = spot.y - 5.5;
        sky.add(buildingGeometry(8, towerTop + 90, 14), spot.x + Math.cos(angle) * 5, (towerTop - 90) / 2,
            spot.z + Math.sin(angle) * 5, { ry: -angle, color: 0xc8c0ff });
    }
    const skyline = sky.build(new THREE.MeshBasicMaterial({ color: 0xffffff, map: facade }));
    if (skyline) ctx.add(skyline);

    // Aircraft-warning beacons on skyline masts and the rooftop antennas.
    tops.push({ x: deckX - 7.5, y: 26.5, z: -deckZ + 8 }, { x: -deckX + 12.5, y: 26.5, z: deckZ - 8 });
    const beacons = instanced(
        new THREE.SphereGeometry(0.55, 8, 6),
        animate(new THREE.MeshBasicMaterial({ color: 0xff2a2a }), ctx, { mode: 'blink', amp: 0.12, speed: 0.7 }),
        tops.map(t => ({ ...t, s: t.y > 60 ? 2.6 : 1.2 }))
    );
    if (beacons) ctx.add(beacons);

    // Neon signs: one atlas, one merged mesh, flicker on medium+.
    const signs = [
        { text: 'VOLLE', color: '#ff3d9a', sub: 'ROOFTOP LEAGUE' },
        { text: 'ARCADE', color: '#35e0ff', sub: 'OPEN 24/7' },
        { text: 'NOODLE', color: '#ffd23d', sub: 'BAR' },
        { text: 'HOTEL', color: '#b36bff', sub: 'SKYVIEW' }
    ];
    const atlas = canvasTexture(ctx, 1024, 1024, (g, w) => {
        const cell = w / 2;
        signs.forEach((sign, i) => {
            const ox = (i % 2) * cell;
            const oy = Math.floor(i / 2) * (cell / 2);
            drawNeonSign(g, ox, oy, cell, cell / 2, sign);
        });
    });
    const signBatch = new GeoBatch();
    const signUv = i => ({ uvScale: [0.5, 0.25], uvOffset: [(i % 2) * 0.5, 0.75 - Math.floor(i / 2) * 0.25] });
    for (const sz of [-1, 1]) {
        // Big billboard faces the court from behind each baseline.
        signBatch.add(new THREE.PlaneGeometry(boardW, boardH), 0, 10 + boardH / 2, sz * (boardZ + 0.25),
            { ry: sz > 0 ? Math.PI : 0, ...signUv(sz < 0 ? 0 : 1) });
    }
    // Rooftop signs on the nearest skyline ring, all facing the court.
    signSpots.forEach((spot, i) => {
        signBatch.add(new THREE.PlaneGeometry(22, 11), spot.x, spot.y, spot.z,
            { ry: -spot.angle - Math.PI / 2, ...signUv((i + 2) % 4) });
    });
    const signMesh = signBatch.build(animate(new THREE.MeshBasicMaterial({
        map: atlas, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: atlas ? 0xffffff : 0xff3d9a
    }), ctx, { mode: 'flicker', amp: 0.35, speed: 9 }));
    if (signMesh) ctx.add(signMesh);

    if (ctx.animate) {
        // String lights above both stands: bulbs + wire.
        const bulbs = [];
        const wire = [];
        for (const sx of [-1, 1]) {
            const x = sx * (halfW + 12);
            for (let seg = 0; seg < 4; seg++) {
                const z0 = -halfL + seg * (halfL / 2);
                const z1 = z0 + halfL / 2;
                let prev = null;
                for (let k = 0; k <= 10; k++) {
                    const t = k / 10;
                    const p = { x, y: 9 - Math.sin(Math.PI * t) * 1.6, z: z0 + (z1 - z0) * t };
                    if (k > 0 && k < 10) bulbs.push({ ...p, color: k % 2 ? 0xffd9a0 : 0xff9ad8 });
                    if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
                    prev = p;
                }
            }
        }
        const bulbMesh = instanced(new THREE.SphereGeometry(0.16, 6, 4),
            animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx, { mode: 'blink', amp: 0.55, speed: 0.35 }), bulbs);
        if (bulbMesh) ctx.add(bulbMesh);
        const wireGeo = new THREE.BufferGeometry();
        wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
        ctx.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x1a1a22 })));

        // Delivery drones circling the block (whole batch orbits in the shader).
        const drones = new GeoBatch({ colors: true });
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const r = 88 + i * 9;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = 24 + i * 5;
            drones.add(new THREE.BoxGeometry(1.6, 0.4, 1.6), x, y, z, { color: 0x1c1f28 });
            drones.add(new THREE.BoxGeometry(2.8, 0.1, 0.18), x, y + 0.3, z, { ry: 0.78, color: 0x30343f });
            drones.add(new THREE.BoxGeometry(2.8, 0.1, 0.18), x, y + 0.3, z, { ry: -0.78, color: 0x30343f });
            drones.add(new THREE.SphereGeometry(0.28, 6, 4), x, y - 0.35, z, { color: i % 2 ? 0x35e0ff : 0xff3d9a });
        }
        const droneMesh = drones.build(animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx,
            { mode: 'orbit', speed: 0.05, amp: 1.2, freq: 0.8 }));
        if (droneMesh) { droneMesh.frustumCulled = false; ctx.add(droneMesh); }
    }

    // Painted rooftop court: worn paint, grime and neon puddle reflections.
    courtDecal(ctx, (g, w, h, ppm) => {
        for (let i = 0; i < 70; i++) {
            const r = (1 + rng() * 5) * ppm;
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
            grad.addColorStop(0, 'rgba(8,6,14,0.22)');
            grad.addColorStop(1, 'rgba(8,6,14,0)');
            g.save();
            g.translate(rng() * w, rng() * h);
            g.scale(1, 0.5 + rng() * 0.8);
            g.fillStyle = grad;
            g.fillRect(-r, -r, r * 2, r * 2);
            g.restore();
        }
        const puddle = (x, y, rx, ry, color) => {
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
            grad.addColorStop(0, color.replace('A', '0.34'));
            grad.addColorStop(0.7, color.replace('A', '0.12'));
            grad.addColorStop(1, color.replace('A', '0'));
            g.save();
            g.translate(x, y);
            g.scale(1, ry / rx);
            g.fillStyle = grad;
            g.beginPath();
            g.arc(0, 0, rx, 0, Math.PI * 2);
            g.fill();
            g.restore();
        };
        // Mirrored puddles so neither half reads differently.
        for (let i = 0; i < 5; i++) {
            const x = (0.1 + rng() * 0.35) * w;
            const y = (0.08 + rng() * 0.36) * h;
            const rx = (2.5 + rng() * 4) * ppm;
            const color = i % 2 ? 'rgba(255,61,154,A)' : 'rgba(53,224,255,A)';
            puddle(x, y, rx, rx * 0.55, color);
            puddle(w - x, h - y, rx, rx * 0.55, color);
        }
        // Stencilled lane marks + VOLLE at each baseline.
        g.strokeStyle = 'rgba(255,255,255,0.22)';
        g.lineWidth = 0.18 * ppm;
        g.setLineDash([1.6 * ppm, 1.2 * ppm]);
        for (const fx of [0.3, 0.7]) {
            g.beginPath();
            g.moveTo(fx * w, 0.05 * h);
            g.lineTo(fx * w, 0.95 * h);
            g.stroke();
        }
        g.setLineDash([]);
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.font = `900 ${Math.round(5 * ppm)}px Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('VOLLE', w / 2, h * 0.93);
        g.save();
        g.translate(w / 2, h * 0.07);
        g.rotate(Math.PI);
        g.fillText('VOLLE', 0, 0);
        g.restore();
    });
}

// Box whose side UVs tile a facade texture by metres and whose roof/floor
// faces sample the dark texture border.
function buildingGeometry(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.getAttribute('uv');
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each).
    for (let face = 0; face < 6; face++) {
        for (let v = 0; v < 4; v++) {
            const i = face * 4 + v;
            if (face === 2 || face === 3) { uv.setXY(i, 0.5, 0.995); continue; }
            const span = face < 2 ? d : w;
            uv.setXY(i, uv.getX(i) * span / 16, uv.getY(i) * h / 32);
        }
    }
    return geo;
}

export function drawNeonSign(g, x, y, w, h, sign) {
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(10,8,20,0.82)';
    roundRect(g, w * 0.04, h * 0.08, w * 0.92, h * 0.84, h * 0.08);
    g.fill();
    g.lineWidth = h * 0.035;
    g.strokeStyle = sign.color;
    g.shadowColor = sign.color;
    g.shadowBlur = h * 0.12;
    roundRect(g, w * 0.07, h * 0.14, w * 0.86, h * 0.72, h * 0.06);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 0.4)}px Arial, sans-serif`;
    g.fillStyle = '#ffffff';
    g.shadowBlur = h * 0.18;
    g.fillText(sign.text, w / 2, h * 0.43);
    g.font = `700 ${Math.round(h * 0.13)}px Arial, sans-serif`;
    g.fillStyle = sign.color;
    g.shadowBlur = h * 0.08;
    g.fillText(sign.sub, w / 2, h * 0.73);
    g.restore();
}

function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

// ---------------------------------------------------------------------------
// Sunken Temple — flooded ruins: stone platform, moat, ziggurats, jungle.
// ---------------------------------------------------------------------------
export function buildSunkenTempleArt(ctx) {
    const { halfW, halfL, rng, config } = ctx;
    const platX = halfW + 20;
    const platZ = halfL + 16;

    const tiles = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#b8a47c';
        g.fillRect(0, 0, w, h);
        const n = 4;
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                const v = 150 + Math.floor(rng() * 50);
                g.fillStyle = `rgb(${v + 20},${v + 6},${v - 30})`;
                g.fillRect(c * w / n + 3, r * h / n + 3, w / n - 6, h / n - 6);
                if (rng() < 0.4) {
                    g.fillStyle = `rgba(70,110,50,${0.2 + rng() * 0.3})`;
                    g.beginPath();
                    g.arc(c * w / n + rng() * w / n, r * h / n + rng() * h / n, 6 + rng() * 14, 0, Math.PI * 2);
                    g.fill();
                }
            }
        }
    }, { repeatX: platX / 6, repeatY: platZ / 6 });
    const platform = new THREE.Mesh(
        new THREE.PlaneGeometry(platX * 2, platZ * 2),
        new THREE.MeshStandardMaterial({ color: 0xd8c8a4, map: tiles, roughness: 0.95 })
    );
    platform.rotation.x = -Math.PI / 2;
    platform.position.y = -0.03;
    platform.receiveShadow = true;
    ctx.add(platform);

    // Moat — shimmering jade water around the platform.
    const water = new THREE.Mesh(
        new THREE.PlaneGeometry(620, 620),
        animate(new THREE.MeshStandardMaterial({ color: 0x2e7c74, roughness: 0.18, metalness: 0.12 }), ctx,
            { mode: 'shimmer', amp: 0.06, speed: 1.1, freq: 0.35 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1.1;
    ctx.add(water);

    // Stone: platform skirt, steps, ziggurats, ruins — one batch.
    const s = new GeoBatch({ colors: true });
    const SAND = [0xc9b48a, 0xbca57c, 0xd4c196, 0xa99470];
    const MOSS = 0x5f7d45;
    const pick = () => SAND[Math.floor(rng() * SAND.length)];
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(1.2, 2.2, platZ * 2 + 1.2), sx * (platX + 0.6), -1.1, 0, { color: 0xa0895f });
    for (const sz of [-1, 1]) s.add(new THREE.BoxGeometry(platX * 2 + 2.4, 2.2, 1.2), 0, -1.1, sz * (platZ + 0.6), { color: 0xa0895f });
    // Ziggurats beyond both baselines (mirrored).
    for (const sz of [-1, 1]) {
        const cz = sz * (platZ + 46);
        for (let step = 0; step < 7; step++) {
            const size = 58 - step * 7.5;
            const y = -1.1 + step * 3.2 + 1.6;
            s.add(new THREE.BoxGeometry(size, 3.2, size * 0.7), 0, y, cz, { color: step % 2 ? SAND[1] : SAND[3] });
            s.add(new THREE.BoxGeometry(size + 0.3, 0.35, size * 0.7 + 0.3), 0, y + 1.6, cz, { color: MOSS });
        }
        // Central stair facing the court + shrine.
        s.add(new THREE.BoxGeometry(8, 22, 10), 0, 9, cz - sz * 20, { rx: sz * 0.62, color: SAND[2] });
        s.add(new THREE.BoxGeometry(10, 6, 8), 0, 24, cz, { color: SAND[0] });
        s.add(new THREE.BoxGeometry(11, 0.8, 9), 0, 27.4, cz, { color: MOSS });
        for (const px of [-3.2, 3.2]) s.add(new THREE.BoxGeometry(1.2, 5, 1.2), px, 23.5, cz - sz * 4.2, { color: SAND[3] });
    }
    // Broken colonnade lining the platform edge + fallen drums (outside play).
    for (const sx of [-1, 1]) {
        for (let k = 0; k < 6; k++) {
            const z = -platZ + 12 + k * ((platZ * 2 - 24) / 5);
            const hgt = [9, 4.5, 7.5, 3, 8.5, 5.5][k];
            const x = sx * (platX - 3);
            s.add(new THREE.CylinderGeometry(1.1, 1.25, hgt, 12), x, hgt / 2, z, { color: pick() });
            s.add(new THREE.BoxGeometry(3, 0.6, 3), x, 0.3, z, { color: SAND[3] });
            if (hgt > 7) s.add(new THREE.BoxGeometry(3.2, 0.8, 3.2), x, hgt + 0.4, z, { color: SAND[2] });
            else s.add(new THREE.DodecahedronGeometry(0.9, 0), x + sx * 1.8, 0.5, z + 1.5, { color: pick() });
        }
    }
    // Half-sunken statues/heads in the water on the diagonals.
    for (const [x, z] of [[-platX - 22, -platZ + 10], [platX + 22, platZ - 10], [-platX - 30, platZ - 24], [platX + 30, -platZ + 24]]) {
        s.add(new THREE.BoxGeometry(7, 9, 6), x, 2.5, z, { ry: Math.atan2(-x, -z), color: 0x9c8a66 });
        s.add(new THREE.BoxGeometry(7.6, 1.4, 6.4), x, 7.4, z, { ry: Math.atan2(-x, -z), color: MOSS });
        s.add(new THREE.BoxGeometry(1.6, 2.4, 1.6), x, 3.4, z + (z > 0 ? -3 : 3), { color: 0x8a7856 });
    }
    // Banner poles at the court corners (cloth is animated separately).
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        s.add(new THREE.CylinderGeometry(0.16, 0.2, 9, 8), sx * (halfW + 4), 4.5, sz * (halfL + 4), { color: 0x4a3524 });
        s.add(new THREE.BoxGeometry(3.4, 0.2, 0.2), sx * (halfW + 4) - sx * 1.5, 8.8, sz * (halfL + 4), { color: 0x4a3524 });
    }
    const stone = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (stone) { stone.receiveShadow = true; ctx.add(stone); }

    // Jungle rim: trunks + canopies instanced on the far shore.
    const trunks = [];
    const crowns = [];
    const treeCount = ctx.tier === 'low' ? 40 : ctx.high ? 90 : 64;
    for (let i = 0; i < treeCount; i++) {
        const angle = (i / treeCount) * Math.PI * 2 + rng() * 0.06;
        const dist = 170 + rng() * 70;
        const hgt = 18 + rng() * 22;
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        trunks.push({ x, y: hgt / 2 - 1, z, sx: 1, sy: hgt / 10, sz: 1 });
        const greens = [0x2f6b35, 0x3d7d3a, 0x285a31, 0x4a8a3f];
        for (let c = 0; c < 2; c++) {
            crowns.push({
                x: x + (rng() - 0.5) * 6, y: hgt + c * 4 - 1, z: z + (rng() - 0.5) * 6,
                s: 7 + rng() * 5, ry: rng() * Math.PI, color: greens[Math.floor(rng() * greens.length)]
            });
        }
    }
    const trunkMesh = instanced(new THREE.CylinderGeometry(0.9, 1.4, 10, 7), new THREE.MeshLambertMaterial({ color: 0x5a4632 }), trunks);
    if (trunkMesh) ctx.add(trunkMesh);
    const crownMesh = instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), crowns);
    if (crownMesh) ctx.add(crownMesh);

    if (ctx.animate) {
        // Lily pads + lotus bob gently on the moat.
        const pads = [];
        for (let i = 0; i < 70; i++) {
            const angle = rng() * Math.PI * 2;
            const edge = Math.max(platX, platZ) + 4 + rng() * 26;
            pads.push({ x: Math.cos(angle) * edge, y: -1.02, z: Math.sin(angle) * edge * 0.95, s: 0.8 + rng() * 1.2, ry: rng() * 6, color: rng() < 0.15 ? 0xf4a3c8 : 0x4e8f3c });
        }
        const padMesh = instanced(new THREE.CylinderGeometry(1, 1, 0.08, 10), animate(new THREE.MeshLambertMaterial({ color: 0xffffff }), ctx,
            { mode: 'bob', amp: 0.05, speed: 1.3 }), pads);
        if (padMesh) ctx.add(padMesh);

        // Team pennant banners on the corner poles.
        const glyphs = canvasTexture(ctx, 128, 256, (g, w, h) => {
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = 'rgba(40,24,10,0.55)';
            g.lineWidth = 6;
            g.strokeRect(10, 10, w - 20, h - 20);
            for (let k = 0; k < 3; k++) {
                const cy = 50 + k * 72;
                g.beginPath();
                g.arc(w / 2, cy, 20, 0, Math.PI * 2);
                g.moveTo(w / 2 - 28, cy);
                g.lineTo(w / 2 + 28, cy);
                g.stroke();
            }
        });
        const banners = new GeoBatch({ colors: true });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const color = sz < 0 ? config.floorRed : config.floorBlue;
            banners.add(new THREE.PlaneGeometry(2.6, 5.2, 4, 8), sx * (halfW + 4) - sx * 1.5, 6.1, sz * (halfL + 4) + 0.02, { color });
        }
        const bannerMesh = banners.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, map: glyphs, side: THREE.DoubleSide }), ctx,
            { mode: 'wave', amp: 0.22, speed: 2.2, freq: 0.4, anchorTop: true }));
        if (bannerMesh) ctx.add(bannerMesh);

        // Shrine braziers + god rays through the canopy haze.
        const flames = [];
        for (const sz of [-1, 1]) for (const px of [-3.2, 3.2]) flames.push({ x: px, y: 26.6, z: sz * (platZ + 46) - sz * 4.2, s: 1 });
        const flameMesh = instanced(new THREE.ConeGeometry(0.9, 2.4, 8), animate(new THREE.MeshBasicMaterial({
            color: 0xffa640, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
        }), ctx, { mode: 'pulse', amp: 0.55, speed: 7, freq: 0.9 }), flames);
        if (flameMesh) ctx.add(flameMesh);

        const rayTex = canvasTexture(ctx, 64, 256, (g, w, h) => {
            const grad = g.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(255,244,200,0)');
            grad.addColorStop(0.35, 'rgba(255,244,200,0.55)');
            grad.addColorStop(1, 'rgba(255,244,200,0)');
            g.fillStyle = grad;
            g.fillRect(0, 0, w, h);
            const side = g.createLinearGradient(0, 0, w, 0);
            side.addColorStop(0, 'rgba(0,0,0,1)');
            side.addColorStop(0.5, 'rgba(0,0,0,0)');
            side.addColorStop(1, 'rgba(0,0,0,1)');
            g.globalCompositeOperation = 'destination-out';
            g.fillStyle = side;
            g.fillRect(0, 0, w, h);
        });
        const rays = new GeoBatch();
        for (let i = 0; i < 6; i++) {
            const sx = i < 3 ? -1 : 1;
            const z = ((i % 3) - 1) * 36;
            rays.add(new THREE.PlaneGeometry(9, 60), sx * (halfW + 9), 24, z, { rz: sx * 0.38, ry: 0.4 + (i % 3) * 0.5 });
        }
        const rayMesh = rays.build(new THREE.MeshBasicMaterial({
            map: rayTex, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide, color: rayTex ? 0xffffff : 0x000000
        }));
        if (rayMesh) ctx.add(rayMesh);

        // Birds wheeling over the jungle.
        const birds = new GeoBatch();
        for (let i = 0; i < 9; i++) {
            const angle = (i / 9) * Math.PI * 2;
            const r = 70 + (i % 3) * 18;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute([-1.2, 0.3, 0, 0, 0, 0.4, 0, 0, -0.2, 1.2, 0.3, 0, 0, 0, -0.2, 0, 0, 0.4], 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
            birds.add(geo, Math.cos(angle) * r, 38 + (i % 4) * 4, Math.sin(angle) * r, { ry: -angle, sx: 1.4, sy: 1.4, sz: 1.4 });
        }
        const birdMesh = birds.build(animate(new THREE.MeshBasicMaterial({ color: 0x1d2418, side: THREE.DoubleSide }), ctx,
            { mode: 'orbit', speed: 0.08, amp: 2, freq: 0.6 }));
        if (birdMesh) { birdMesh.frustumCulled = false; ctx.add(birdMesh); }
    }

    // Carved inlay: glyph border, sun-disc mosaic, moss and cracks.
    courtDecal(ctx, (g, w, h, ppm) => {
        g.strokeStyle = 'rgba(60,40,20,0.28)';
        g.lineWidth = 0.12 * ppm;
        for (let i = 0; i < 40; i++) {
            let x = rng() * w;
            let y = rng() * h;
            g.beginPath();
            g.moveTo(x, y);
            for (let k = 0; k < 5; k++) {
                x += (rng() - 0.5) * 4 * ppm;
                y += (rng() - 0.5) * 4 * ppm;
                g.lineTo(x, y);
            }
            g.stroke();
        }
        for (let i = 0; i < 28; i++) {
            const r = (1 + rng() * 3.5) * ppm;
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
            grad.addColorStop(0, 'rgba(70,110,45,0.3)');
            grad.addColorStop(1, 'rgba(70,110,45,0)');
            g.save();
            g.translate(rng() < 0.5 ? rng() * 0.12 * w : w - rng() * 0.12 * w, rng() * h);
            g.fillStyle = grad;
            g.fillRect(-r, -r, r * 2, r * 2);
            g.restore();
        }
        // Glyph band along both sidelines.
        const band = 2.2 * ppm;
        g.fillStyle = 'rgba(70,45,20,0.18)';
        g.fillRect(0.6 * ppm, 0, band, h);
        g.fillRect(w - 0.6 * ppm - band, 0, band, h);
        g.strokeStyle = 'rgba(245,230,190,0.25)';
        g.lineWidth = 0.14 * ppm;
        for (let y = band; y < h; y += band * 1.4) {
            for (const x0 of [0.6 * ppm, w - 0.6 * ppm - band]) {
                g.strokeRect(x0 + band * 0.2, y - band * 0.4, band * 0.6, band * 0.8);
                g.beginPath();
                g.arc(x0 + band * 0.5, y, band * 0.16, 0, Math.PI * 2);
                g.stroke();
            }
        }
        // Sun-disc mosaic in each half (mirrored) — around the zone rings.
        for (const fy of [0.25, 0.75]) {
            const cx = w / 2;
            const cy = fy * h;
            g.strokeStyle = 'rgba(255,236,170,0.22)';
            g.lineWidth = 0.2 * ppm;
            for (const r of [6, 7.2, 9]) {
                g.beginPath();
                g.arc(cx, cy, r * ppm, 0, Math.PI * 2);
                g.stroke();
            }
            for (let k = 0; k < 16; k++) {
                const a = (k / 16) * Math.PI * 2;
                g.beginPath();
                g.moveTo(cx + Math.cos(a) * 7.2 * ppm, cy + Math.sin(a) * 7.2 * ppm);
                g.lineTo(cx + Math.cos(a) * 9 * ppm, cy + Math.sin(a) * 9 * ppm);
                g.stroke();
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Orbital Station — deck, glass panels, arches, planet, beacons, shuttles.
// ---------------------------------------------------------------------------
export function buildOrbitalStationArt(ctx) {
    const { halfW, halfL, rng } = ctx;
    const deckX = halfW + 26;
    const deckZ = halfL + 20;

    const plates = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#5d6878';
        g.fillRect(0, 0, w, h);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
            const v = 88 + Math.floor(rng() * 22);
            g.fillStyle = `rgb(${v},${v + 8},${v + 20})`;
            g.fillRect(c * 128 + 3, r * 128 + 3, 122, 122);
            g.fillStyle = 'rgba(20,24,32,0.6)';
            for (const [dx, dy] of [[10, 10], [112, 10], [10, 112], [112, 112]]) g.fillRect(c * 128 + dx, r * 128 + dy, 5, 5);
        }
    }, { repeatX: deckX / 5, repeatY: deckZ / 5 });
    const deck = new THREE.Mesh(
        new THREE.PlaneGeometry(deckX * 2, deckZ * 2),
        new THREE.MeshStandardMaterial({ color: 0xc8d4e6, map: plates, roughness: 0.42, metalness: 0.55 })
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.03;
    deck.receiveShadow = true;
    ctx.add(deck);

    // Glass floor panels ringing the court: a window down into space.
    const glassTex = canvasTexture(ctx, 256, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#040816');
        grad.addColorStop(1, '#0b1a3c');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 160; i++) {
            const a = 0.3 + rng() * 0.7;
            g.fillStyle = `rgba(${200 + rng() * 55},${210 + rng() * 45},255,${a})`;
            const s = rng() < 0.9 ? 1 : 2;
            g.fillRect(rng() * w, rng() * h, s, s);
        }
        g.strokeStyle = 'rgba(140,200,255,0.55)';
        g.lineWidth = 4;
        g.strokeRect(2, 2, w - 4, h - 4);
    }, { repeatX: 1, repeatY: 1 });
    if (glassTex) glassTex.wrapS = glassTex.wrapT = THREE.RepeatWrapping;
    const glass = new GeoBatch();
    const panel = 4;
    for (const sx of [-1, 1]) {
        for (let z = -halfL; z < halfL; z += panel) {
            glass.add(new THREE.PlaneGeometry(panel - 0.3, panel - 0.3), sx * (halfW + 2.6), 0.004, z + panel / 2, { rx: -Math.PI / 2 });
        }
    }
    for (const sz of [-1, 1]) {
        for (let x = -halfW; x < halfW; x += panel) {
            glass.add(new THREE.PlaneGeometry(panel - 0.3, panel - 0.3), x + panel / 2, 0.004, sz * (halfL + 2.6), { rx: -Math.PI / 2 });
        }
    }
    const glassMesh = glass.build(new THREE.MeshBasicMaterial({ color: glassTex ? 0xffffff : 0x0b1a3c, map: glassTex }));
    if (glassMesh) ctx.add(glassMesh);

    // Station frame: elliptical truss arches over the court + spine beams,
    // habitat modules and docking arms outside the stands.
    const s = new GeoBatch({ colors: true });
    const HULL = 0xd6dde8;
    const DARK = 0x3a4150;
    const archRX = deckX + 4;
    const archRY = 44;
    const archZ = [-halfL - 6, -halfL * 0.36, halfL * 0.36, halfL + 6];
    for (const z of archZ) {
        const segs = 18;
        for (let k = 0; k < segs; k++) {
            const a0 = (k / segs) * Math.PI;
            const a1 = ((k + 1) / segs) * Math.PI;
            const x0 = Math.cos(a0) * archRX; const y0 = Math.sin(a0) * archRY;
            const x1 = Math.cos(a1) * archRX; const y1 = Math.sin(a1) * archRY;
            const len = Math.hypot(x1 - x0, y1 - y0);
            s.add(new THREE.BoxGeometry(len + 0.3, 1.4, 2.2), (x0 + x1) / 2, (y0 + y1) / 2, z, { rz: Math.atan2(y1 - y0, x1 - x0), color: k % 2 ? HULL : 0xbfc8d6 });
        }
        for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(3.2, 2.2, 3.6), sx * archRX, 1.1, z, { color: DARK });
    }
    for (const sx of [-1, 0, 1]) {
        const x = sx * archRX * 0.72;
        const y = sx === 0 ? archRY : Math.sqrt(Math.max(0, 1 - 0.72 * 0.72)) * archRY;
        s.add(new THREE.BoxGeometry(1, 1, archZ[3] - archZ[0]), x, y - 0.8, 0, { color: DARK });
    }
    // Habitat modules + docking arms beyond the stands (mirrored).
    for (const sx of [-1, 1]) {
        const x = sx * (deckX + 26);
        s.add(new THREE.CylinderGeometry(7, 7, 60, 20), x, 6, 0, { rx: Math.PI / 2, color: HULL });
        for (const z of [-30, 30]) s.add(new THREE.SphereGeometry(7, 16, 10), x, 6, z, { sz: 0.6, color: HULL });
        s.add(new THREE.CylinderGeometry(1.4, 1.4, 22, 10), sx * (deckX + 12), 5, 0, { rz: Math.PI / 2, color: DARK });
        for (const z of [-halfL - 30, halfL + 30]) {
            s.add(new THREE.BoxGeometry(4, 4, 36), x * 0.8, 3, z, { color: DARK });
            s.add(new THREE.CylinderGeometry(3.4, 3.4, 9, 14), x * 0.8, 3, z + Math.sign(z) * 20, { rx: Math.PI / 2, color: HULL });
        }
    }
    const frame = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (frame) ctx.add(frame);

    // Light strips under each arch + module window bands (self-lit).
    const lights = new GeoBatch({ colors: true });
    for (const z of archZ) {
        const segs = 18;
        for (let k = 1; k < segs - 1; k++) {
            const a = ((k + 0.5) / segs) * Math.PI;
            const x = Math.cos(a) * (archRX - 0.9);
            const y = Math.sin(a) * (archRY - 0.9);
            lights.add(new THREE.BoxGeometry(2.2, 0.18, 0.5), x, y, z, { rz: a + Math.PI / 2, color: 0x9fe8ff });
        }
    }
    for (const sx of [-1, 1]) {
        lights.add(new THREE.CylinderGeometry(7.08, 7.08, 44, 20, 1, true, (sx < 0 ? Math.PI / 2 : -Math.PI / 2) - 0.35, 0.7), sx * (deckX + 26), 6, 0,
            { rx: Math.PI / 2, color: 0xffe2a8 });
    }
    const lightMesh = lights.build(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    if (lightMesh) ctx.add(lightMesh);

    // Solar arrays far out on both flanks.
    const solarTex = canvasTexture(ctx, 128, 128, (g, w, h) => {
        g.fillStyle = '#10204a';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#6f8fd6';
        g.lineWidth = 2;
        for (let i = 0; i <= 8; i++) {
            g.beginPath(); g.moveTo(i * w / 8, 0); g.lineTo(i * w / 8, h); g.stroke();
            g.beginPath(); g.moveTo(0, i * h / 8); g.lineTo(w, i * h / 8); g.stroke();
        }
    });
    const solar = new GeoBatch();
    for (const sx of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
            solar.add(new THREE.BoxGeometry(24, 0.3, 14), sx * (deckX + 62 + k * 26), 14, 0, { rz: sx * 0.2 });
        }
    }
    const solarMesh = solar.build(new THREE.MeshLambertMaterial({ color: solarTex ? 0xffffff : 0x10204a, map: solarTex, emissive: 0x0a1430 }));
    if (solarMesh) ctx.add(solarMesh);

    buildPlanet(ctx);

    // Navigation beacons along the arch feet and module ends.
    const beaconSpots = [];
    for (const z of archZ) for (const sx of [-1, 1]) beaconSpots.push({ x: sx * archRX, y: 2.6, z, color: sx < 0 ? 0xff4a4a : 0x4aff8a });
    for (const sx of [-1, 1]) for (const z of [-halfL - 50, halfL + 50]) beaconSpots.push({ x: sx * (deckX + 26) * 0.8, y: 3, z, color: 0xffffff, s: 1.6 });
    const beaconMesh = instanced(new THREE.SphereGeometry(0.45, 8, 6),
        animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx, { mode: 'blink', amp: 0.1, speed: 0.9 }), beaconSpots);
    if (beaconMesh) ctx.add(beaconMesh);

    if (ctx.animate) {
        // Shuttles drifting around the station.
        const shuttles = new GeoBatch({ colors: true });
        for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + 0.4;
            const r = 150 + i * 30;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const y = 30 + i * 12;
            shuttles.add(new THREE.BoxGeometry(3, 2, 9), x, y, z, { ry: -angle, color: HULL });
            shuttles.add(new THREE.BoxGeometry(9, 0.3, 3), x, y - 0.6, z, { ry: -angle, color: DARK });
            shuttles.add(new THREE.SphereGeometry(0.7, 6, 4), x, y, z, { color: 0x7fd8ff });
        }
        const shuttleMesh = shuttles.build(animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx,
            { mode: 'orbit', speed: 0.03, amp: 3, freq: 0.3 }));
        if (shuttleMesh) { shuttleMesh.frustumCulled = false; ctx.add(shuttleMesh); }
    }

    // Deck plating on the court: panel seams, hazard chevrons, glass inserts.
    courtDecal(ctx, (g, w, h, ppm) => {
        g.strokeStyle = 'rgba(210,235,255,0.12)';
        g.lineWidth = 0.08 * ppm;
        for (let x = 0; x <= w; x += 8 * ppm) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        for (let y = 0; y <= h; y += 8 * ppm) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        // Glass inserts in the back corners (mirrored both axes).
        for (const fx of [0.12, 0.88]) for (const fy of [0.1, 0.9]) {
            const pw = 7 * ppm;
            const ph = 7 * ppm;
            const x = fx * w - pw / 2;
            const y = fy * h - ph / 2;
            g.fillStyle = 'rgba(4,10,30,0.55)';
            g.fillRect(x, y, pw, ph);
            for (let i = 0; i < 24; i++) {
                g.fillStyle = `rgba(220,235,255,${0.3 + rng() * 0.6})`;
                g.fillRect(x + rng() * pw, y + rng() * ph, 0.12 * ppm, 0.12 * ppm);
            }
            g.strokeStyle = 'rgba(140,210,255,0.5)';
            g.lineWidth = 0.15 * ppm;
            g.strokeRect(x, y, pw, ph);
        }
        // Hazard chevrons along both baselines.
        const band = 1.2 * ppm;
        for (const y0 of [0.4 * ppm, h - 0.4 * ppm - band]) {
            g.save();
            g.beginPath();
            g.rect(0, y0, w, band);
            g.clip();
            for (let x = -band; x < w + band; x += band * 1.4) {
                g.fillStyle = 'rgba(255,196,40,0.28)';
                g.beginPath();
                g.moveTo(x, y0);
                g.lineTo(x + band * 0.7, y0);
                g.lineTo(x + band * 1.4, y0 + band);
                g.lineTo(x + band * 0.7, y0 + band);
                g.fill();
            }
            g.restore();
        }
    });
}

function buildPlanet(ctx) {
    const { rng } = ctx;
    const dir = new THREE.Vector3(0.72, 0.2, 0.9).normalize();
    const center = dir.clone().multiplyScalar(880);
    const radius = 300;
    const surface = canvasTexture(ctx, 1024, 512, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#dff4ff');
        grad.addColorStop(0.12, '#2f78b8');
        grad.addColorStop(0.5, '#1f5f9a');
        grad.addColorStop(0.88, '#2f78b8');
        grad.addColorStop(1, '#e8f6ff');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        // Continents.
        for (let i = 0; i < 14; i++) {
            const cx = rng() * w;
            const cy = h * (0.2 + rng() * 0.6);
            g.fillStyle = ['#3e7d4a', '#8a7a4c', '#4f8c50'][i % 3];
            g.beginPath();
            for (let k = 0; k < 14; k++) {
                const a = (k / 14) * Math.PI * 2;
                const r = (26 + rng() * 60) * (0.7 + 0.3 * Math.sin(a * 3));
                const px = cx + Math.cos(a) * r * 1.6;
                const py = cy + Math.sin(a) * r;
                if (k) g.lineTo(px, py); else g.moveTo(px, py);
            }
            g.closePath();
            g.fill();
        }
        // Cloud swirls.
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 60; i++) {
            g.lineWidth = 2 + rng() * 8;
            const y = rng() * h;
            const x = rng() * w;
            g.beginPath();
            g.moveTo(x, y);
            g.bezierCurveTo(x + 40, y - 10 * rng(), x + 90, y + 12 * rng(), x + 140 + rng() * 80, y);
            g.stroke();
        }
    });
    const planet = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 40),
        new THREE.MeshLambertMaterial({ color: surface ? 0xffffff : 0x2f78b8, map: surface, fog: false })
    );
    planet.position.copy(center);
    planet.rotation.set(0.35, 0.8, 0.12);
    planet.name = 'map-art-planet';
    ctx.add(planet);

    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.045, 64, 40),
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
            uniforms: { glow: { value: new THREE.Color(0x6fc6ff) } },
            vertexShader: `
                varying vec3 vN;
                varying vec3 vV;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    vN = normalize(normalMatrix * normal);
                    vV = normalize(-mv.xyz);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform vec3 glow;
                varying vec3 vN;
                varying vec3 vV;
                void main() {
                    float rim = pow(clamp(1.0 + dot(vN, vV), 0.0, 1.0), 2.2);
                    gl_FragColor = vec4(glow * rim * 1.4, rim);
                }`
        })
    );
    atmosphere.position.copy(center);
    ctx.add(atmosphere);

    const ringTex = canvasTexture(ctx, 512, 8, (g, w, h) => {
        for (let x = 0; x < w; x++) {
            const t = x / w;
            const a = Math.max(0, Math.sin(t * Math.PI)) * (0.35 + 0.65 * Math.abs(Math.sin(t * 40 + rng())));
            g.fillStyle = `rgba(220,210,190,${a * 0.75})`;
            g.fillRect(x, 0, 1, h);
        }
    });
    const ringGeo = new THREE.RingGeometry(radius * 1.35, radius * 2.05, 96, 1);
    // Radial UVs so the 1D band texture runs inner->outer edge.
    const pos = ringGeo.getAttribute('position');
    const uv = ringGeo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - radius * 1.35) / (radius * 0.7), 0.5);
    }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: ringTex, color: ringTex ? 0xffffff : 0xccbb99, transparent: true, opacity: ringTex ? 1 : 0.4,
        side: THREE.DoubleSide, depthWrite: false, fog: false
    }));
    ring.position.copy(center);
    ring.rotation.set(Math.PI / 2 - 0.32, 0.1, 0.25);
    ctx.add(ring);

    const moon = new THREE.Mesh(
        new THREE.SphereGeometry(34, 24, 16),
        new THREE.MeshLambertMaterial({ color: 0xb9b4ad, fog: false })
    );
    moon.position.set(-430, 280, -640);
    ctx.add(moon);
}

