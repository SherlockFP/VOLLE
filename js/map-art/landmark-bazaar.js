// map-art/landmark-bazaar.js — Sunbaked Bazaar: a walled market town at golden
// hour. Palette: warm stucco (sand / ochre / rose / chalk), terracotta, indigo
// tile, brass. Landmarks: the Red Gate and Blue Gate (one behind each team's
// back line), the Minaret on the west skyline, the Great Dome to the east.
// Callouts are painted on the gates, house walls and the court itself.
// Cover + colliders live in js/arena.js GAMEPLAY_LAYOUTS (stalls, crates,
// carts, wells); everything here stays outside the court and never collides.
import {
    THREE, GeoBatch, instanced, animate, canvasTexture, courtDecal, addBunting,
    signAtlas, paintSign, facadeBox, wallWithOpening
} from './kit.js';

const STUCCO = [0xf1dcb8, 0xe8c79a, 0xeab8a0, 0xf6ead6, 0xd9b48a, 0xe2cfae];
const TERRACOTTA = 0xb8643c;
const INDIGO = 0x2c4f8f;
const WOOD = 0x6e4426;

export function buildSunbakedBazaarArt(ctx) {
    const { halfW, halfL, rng, animate: live, high } = ctx;
    const plazaX = halfW + 60;
    const plazaZ = halfL + 60;

    // Sandstone paving around the court: worn slabs, sand drifting in.
    const paving = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#d9b98c';
        g.fillRect(0, 0, w, h);
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const v = 190 + Math.floor(rng() * 36);
                g.fillStyle = `rgb(${v},${v - 28},${v - 70})`;
                const off = r % 2 ? 32 : 0;
                g.fillRect((c * 64 + off) % w + 2, r * 64 + 2, 60, 60);
            }
        }
        for (let i = 0; i < 900; i++) {
            g.fillStyle = `rgba(120,80,40,${rng() * 0.12})`;
            g.fillRect(rng() * w, rng() * h, 2, 2);
        }
    }, { repeatX: plazaX / 6, repeatY: plazaZ / 6 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(plazaX * 2, plazaZ * 2),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: paving }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    ctx.add(ground);

    // --- Houses: one facade-textured, vertex-tinted batch --------------------
    const facade = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 1400; i++) {
            g.fillStyle = `rgba(${rng() < 0.5 ? '120,90,60' : '255,255,255'},${rng() * 0.08})`;
            g.fillRect(rng() * w, rng() * h, 3, 3);
        }
        // Three floors: arched windows with shutters, ground-floor door arch.
        for (let floor = 0; floor < 3; floor++) {
            const y0 = floor * (h / 3);
            g.fillStyle = 'rgba(150,110,70,0.35)';
            g.fillRect(0, y0 + h / 3 - 5, w, 4);
            for (let k = 0; k < 2; k++) {
                const cx = w * (0.28 + k * 0.44);
                const ww = floor === 2 ? 34 : 26;
                const wy = y0 + (floor === 2 ? 30 : 18);
                if (floor === 2 && k === 0) {
                    // Door with a pointed arch + step.
                    g.fillStyle = '#4a2c1a';
                    g.beginPath();
                    g.moveTo(cx - 18, h);
                    g.lineTo(cx - 18, h - 40);
                    g.quadraticCurveTo(cx - 18, h - 62, cx, h - 70);
                    g.quadraticCurveTo(cx + 18, h - 62, cx + 18, h - 40);
                    g.lineTo(cx + 18, h);
                    g.fill();
                    g.strokeStyle = 'rgba(90,60,40,0.6)';
                    g.lineWidth = 3;
                    g.stroke();
                    continue;
                }
                g.fillStyle = '#23262e';
                g.beginPath();
                g.moveTo(cx - ww / 2, wy + 40);
                g.lineTo(cx - ww / 2, wy + 12);
                g.arc(cx, wy + 12, ww / 2, Math.PI, 0);
                g.lineTo(cx + ww / 2, wy + 40);
                g.fill();
                g.fillStyle = k ? '#2f6f8f' : '#3a7a5a';
                g.fillRect(cx - ww / 2 - 7, wy + 6, 6, 34);
                g.fillRect(cx + ww / 2 + 1, wy + 6, 6, 34);
                g.fillStyle = 'rgba(80,50,30,0.45)';
                g.fillRect(cx - ww / 2 - 3, wy + 40, ww + 6, 4);
            }
        }
        const grime = g.createLinearGradient(0, h * 0.75, 0, h);
        grime.addColorStop(0, 'rgba(110,70,40,0)');
        grime.addColorStop(1, 'rgba(110,70,40,0.35)');
        g.fillStyle = grime;
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#f4e6cc';
        g.fillRect(0, 0, w, 4);
    });
    if (facade) facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    const houses = new GeoBatch({ colors: true });
    const stucco = () => STUCCO[Math.floor(rng() * STUCCO.length)];
    const house = (x, z, w, h, d, ry = 0) => {
        houses.add(facadeBox(w, h, d, 12, 12), x, h / 2, z, { ry, color: stucco() });
    };
    // Market street houses behind the stands (both flanks), fronts face the court.
    const rowX = halfW + 30;
    for (const sx of [-1, 1]) {
        let z = -halfL - 4;
        while (z < halfL + 4) {
            const w = 9 + rng() * 6;
            const h = 8 + Math.floor(rng() * 3) * 3.6;
            house(sx * (rowX + 5), z + w / 2, 10, h, w, 0);
            z += w + (rng() < 0.25 ? 3 : 0.2);
        }
    }
    // Town beyond the gates and the flanks: lower, denser, fading into haze.
    const townCount = ctx.tier === 'low' ? 60 : high ? 150 : 110;
    for (let i = 0; i < townCount; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 120 + rng() * 150;
        const x = Math.cos(angle) * dist * 1.1;
        const z = Math.sin(angle) * dist;
        const w = 10 + rng() * 14;
        house(x, z, w, 7 + rng() * 14, 8 + rng() * 12, -angle);
    }
    const houseMesh = houses.build(new THREE.MeshLambertMaterial({ color: 0xffffff, map: facade }));
    if (houseMesh) { houseMesh.receiveShadow = true; ctx.add(houseMesh); }

    // --- City wall, gates, towers, domes, minaret (flat-coloured batch) -------
    const stone = new GeoBatch({ colors: true });
    const gateZ = halfL + 14;
    const gateW = 34;
    const gateH = 21;
    for (const sz of [-1, 1]) {
        const tone = sz < 0 ? 0xc0643e : 0xd8c4a0;
        stone.add(wallWithOpening(gateW, gateH, 7, { kind: 'horseshoe', ow: 12, oh: 15 }), 0, 0, sz * gateZ, { color: tone });
        // Crenellations + flanking towers.
        for (let k = -7; k <= 7; k++) stone.add(new THREE.BoxGeometry(1.4, 1.6, 7.2), k * 2.3, gateH + 0.8, sz * gateZ, { color: tone });
        for (const sx of [-1, 1]) {
            stone.add(new THREE.CylinderGeometry(4.4, 5, gateH + 6, 10), sx * (gateW / 2 + 3), (gateH + 6) / 2, sz * gateZ, { color: tone });
            stone.add(new THREE.CylinderGeometry(5.2, 5.2, 1.2, 10), sx * (gateW / 2 + 3), gateH + 6.6, sz * gateZ, { color: 0x8a4a2e });
            // City wall running from the gate to the market streets.
            const wallLen = rowX - gateW / 2 - 4;
            stone.add(new THREE.BoxGeometry(wallLen, 12, 4), sx * (gateW / 2 + 5 + wallLen / 2), 6, sz * gateZ, { color: 0xd9bf94 });
            for (let k = 0; k < Math.floor(wallLen / 2.6); k++) {
                stone.add(new THREE.BoxGeometry(1.3, 1.4, 4.2), sx * (gateW / 2 + 6 + k * 2.6), 12.7, sz * gateZ, { color: 0xd9bf94 });
            }
        }
        // Tile band framing the arch (indigo on the Blue Gate, ochre on the Red).
        stone.add(new THREE.BoxGeometry(18, 1.2, 7.4), 0, 16.8, sz * gateZ, { color: sz < 0 ? 0xe0a02a : INDIGO });
        for (const sx of [-1, 1]) stone.add(new THREE.BoxGeometry(1.2, 16.8, 7.4), sx * 8.4, 8.4, sz * gateZ, { color: sz < 0 ? 0xe0a02a : INDIGO });
    }
    // Minaret (west skyline): octagonal shaft, two balconies, lantern + finial.
    const mx = -(halfW + 78);
    const mz = 14;
    stone.add(new THREE.BoxGeometry(12, 8, 12), mx, 4, mz, { color: 0xe2cfae });
    stone.add(new THREE.CylinderGeometry(3.2, 3.8, 52, 8), mx, 34, mz, { color: 0xe9d6b2 });
    for (const [y, r] of [[30, 5], [50, 4.6]]) {
        stone.add(new THREE.CylinderGeometry(r, r * 0.8, 1.6, 8), mx, y, mz, { color: 0xc98a52 });
        stone.add(new THREE.CylinderGeometry(3.4, 3.4, 0.8, 8), mx, y + 3, mz, { color: INDIGO });
    }
    stone.add(new THREE.CylinderGeometry(2.4, 2.8, 7, 8), mx, 63.5, mz, { color: 0xf1dcb8 });
    stone.add(new THREE.SphereGeometry(2.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mx, 67, mz, { color: 0x2f8f8a });
    stone.add(new THREE.ConeGeometry(0.35, 5, 6), mx, 71.5, mz, { color: 0xd9a441 });
    // Great Dome (east skyline): square hall, drum, turquoise dome, 4 turrets.
    const dx = halfW + 88;
    const dz = -18;
    stone.add(new THREE.BoxGeometry(40, 18, 40), dx, 9, dz, { color: 0xecdcc0 });
    stone.add(new THREE.CylinderGeometry(15, 15, 7, 24), dx, 21.5, dz, { color: 0xd9c49a });
    for (const [ox, oz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) {
        stone.add(new THREE.CylinderGeometry(2, 2.2, 26, 8), dx + ox, 13, dz + oz, { color: 0xe9d6b2 });
        stone.add(new THREE.SphereGeometry(2.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dx + ox, 26, dz + oz, { color: 0x2f8f8a });
    }
    // Small domes + water tanks sprinkled on the town roofs.
    const domeCount = ctx.tier === 'low' ? 10 : 22;
    for (let i = 0; i < domeCount; i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 125 + rng() * 120;
        const r = 3 + rng() * 5;
        stone.add(new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), Math.cos(angle) * dist * 1.1, 10 + rng() * 8,
            Math.sin(angle) * dist, { color: rng() < 0.5 ? 0x2f8f8a : 0xf3ead8 });
    }
    // Awning frames + market tables along the street (Spice Row) — static.
    for (const sx of [-1, 1]) {
        for (let z = -halfL + 6; z < halfL - 4; z += 11) {
            const x = sx * (rowX - 1.2);
            stone.add(new THREE.BoxGeometry(2.4, 0.9, 5.6), sx * (rowX - 4.6), 0.45, z, { color: WOOD });
            for (let k = 0; k < 3; k++) {
                stone.add(new THREE.ConeGeometry(0.55, 0.6, 8), sx * (rowX - 4.6), 1.2, z - 1.8 + k * 1.8,
                    { color: [0xe8b820, 0xc0391e, 0x8a5a2a, 0x6a8a2a][(k + (z > 0 ? 1 : 0)) % 4] });
            }
            stone.add(new THREE.BoxGeometry(0.12, 3.4, 0.12), sx * (rowX - 6.2), 1.7, z - 2.8, { color: WOOD });
            stone.add(new THREE.BoxGeometry(0.12, 3.4, 0.12), sx * (rowX - 6.2), 1.7, z + 2.8, { color: WOOD });
            stone.add(new THREE.BoxGeometry(0.4, 0.4, 0.4), x, 3.6, z, { color: TERRACOTTA });
        }
    }
    // Distant mesas under the haze.
    for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * Math.PI * 2 + 0.3;
        const dist = 420 + rng() * 120;
        const r = 50 + rng() * 60;
        stone.add(new THREE.CylinderGeometry(r * 0.7, r, 26 + rng() * 30, 9), Math.cos(angle) * dist, 8, Math.sin(angle) * dist,
            { color: 0xd8a778 });
    }
    const stoneMesh = stone.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (stoneMesh) { stoneMesh.receiveShadow = true; ctx.add(stoneMesh); }

    // Striped awnings over Spice Row (cloth ripples a little above Low).
    const stripes = canvasTexture(ctx, 64, 64, (g, w, h) => {
        for (let i = 0; i < 8; i++) {
            g.fillStyle = i % 2 ? '#ffffff' : '#f4ead8';
            g.fillRect(i * 8, 0, 8, h);
        }
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(0, h - 6, w, 6);
    });
    const awnings = new GeoBatch({ colors: true });
    const clothColors = [0xc8372d, 0xe0a02a, 0x2a7f8f, 0x7a2f6a, 0x3f7a4a];
    let ai = 0;
    for (const sx of [-1, 1]) {
        for (let z = -halfL + 6; z < halfL - 4; z += 11) {
            // Lying cloth, 6.2 m along the street, sloping down toward the court.
            const cloth = new THREE.PlaneGeometry(5.2, 6.2, 3, 4).rotateX(-Math.PI / 2).rotateZ(sx * 0.32);
            awnings.add(cloth, sx * (rowX - 2.6), 3.3, z, { color: clothColors[ai++ % clothColors.length] });
        }
    }
    const awningMesh = awnings.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, map: stripes, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.05, speed: 1.1, freq: 0.3 }));
    if (awningMesh) ctx.add(awningMesh);

    // Date palms: trunks + frond crowns (one merged crown instanced).
    const palmSpots = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        palmSpots.push([sx * (gateW / 2 + 12), sz * (gateZ - 7)], [sx * (rowX - 9), sz * (halfL + 2)]);
    }
    for (let i = 0; i < (ctx.tier === 'low' ? 14 : 30); i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 100 + rng() * 60;
        palmSpots.push([Math.cos(angle) * dist * 1.1, Math.sin(angle) * dist]);
    }
    const trunks = palmSpots.map(([x, z], i) => ({ x, y: 5.5 * (1 + (i % 3) * 0.15), z, sy: 1 + (i % 3) * 0.15, rz: (rng() - 0.5) * 0.08 }));
    const trunkMesh = instanced(new THREE.CylinderGeometry(0.28, 0.42, 11, 7), new THREE.MeshLambertMaterial({ color: 0x8a6a48 }), trunks);
    if (trunkMesh) ctx.add(trunkMesh);
    const frond = new GeoBatch();
    for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        frond.add(new THREE.BoxGeometry(0.9, 0.06, 4.2), Math.cos(a) * 1.8, -0.5, Math.sin(a) * 1.8, { ry: -a + Math.PI / 2, rx: 0.45 });
    }
    const frondScratch = new THREE.MeshBasicMaterial();
    const frondGeo = frond.build(frondScratch)?.geometry;
    frondScratch.dispose();
    if (frondGeo) {
        const crowns = instanced(frondGeo, new THREE.MeshLambertMaterial({ color: 0x5f8a3a, side: THREE.DoubleSide }),
            palmSpots.map(([x, z], i) => ({ x, y: 11 * (1 + (i % 3) * 0.15), z, ry: rng() * 6, s: 1.1 })));
        if (crowns) ctx.add(crowns);
    }

    // Signs: gates, street, tea house, well + minaret plaques.
    const SIGNS = ['RED GATE', 'BLUE GATE', 'SPICE ROW', 'TEA HOUSE', 'WELL', 'CARTS', 'MINARET', 'GREAT DOME'];
    const atlas = signAtlas(ctx, 2, 4, 256, 96, (g, i, x, y, w, h) => {
        const gate = i < 2;
        paintSign(g, x, y, w, h, SIGNS[i], {
            bg: gate ? (i === 0 ? '#8c2f1c' : '#1f3d73') : '#f4e6cc',
            border: gate ? '#e8c060' : '#8a5a34',
            fg: gate ? '#fff2cc' : '#5a3218',
            font: 'Georgia, serif'
        });
    });
    const signs = new GeoBatch();
    for (const sz of [-1, 1]) {
        signs.add(new THREE.PlaneGeometry(14, 5.2), 0, gateH - 2.6, sz * (gateZ - 3.6), { ry: sz > 0 ? Math.PI : 0, ...atlas.uv(sz < 0 ? 0 : 1) });
    }
    for (const sx of [-1, 1]) {
        const ry = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
        const x = sx * (rowX - 0.02);
        signs.add(new THREE.PlaneGeometry(7, 2.6), x, 6.4, -9, { ry, ...atlas.uv(2) });
        signs.add(new THREE.PlaneGeometry(7, 2.6), x, 6.4, 9, { ry, ...atlas.uv(2) });
        signs.add(new THREE.PlaneGeometry(7, 2.6), x, 6.4, sx * 30, { ry, ...atlas.uv(3) });
        signs.add(new THREE.PlaneGeometry(5, 1.9), x, 5.4, -sx * 30, { ry, ...atlas.uv(sx < 0 ? 6 : 7) });
        signs.add(new THREE.PlaneGeometry(5, 1.9), x, 5.4, 44, { ry, ...atlas.uv(4) });
        signs.add(new THREE.PlaneGeometry(5, 1.9), x, 5.4, -44, { ry, ...atlas.uv(5) });
    }
    const signMesh = signs.build(new THREE.MeshLambertMaterial({ map: atlas.texture, color: atlas.texture ? 0xffffff : 0xf4e6cc, side: THREE.DoubleSide }));
    if (signMesh) ctx.add(signMesh);

    if (live) {
        // Brass lantern strings above the street (warm flicker) + wires.
        const bulbs = [];
        const wire = [];
        for (const sx of [-1, 1]) {
            const x = sx * (rowX - 2.2);
            for (let seg = 0; seg < 6; seg++) {
                const z0 = -halfL + seg * (halfL / 3);
                const z1 = z0 + halfL / 3;
                let prev = null;
                for (let k = 0; k <= 8; k++) {
                    const t = k / 8;
                    const p = { x, y: 7.4 - Math.sin(Math.PI * t) * 1.3, z: z0 + (z1 - z0) * t };
                    if (k > 0 && k < 8) bulbs.push({ ...p, y: p.y - 0.35, color: k % 3 ? 0xffc46a : 0xff8a3a });
                    if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
                    prev = p;
                }
            }
        }
        const lanterns = instanced(new THREE.OctahedronGeometry(0.26, 0),
            animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx, { mode: 'flicker', amp: 0.55, speed: 6 }), bulbs);
        if (lanterns) ctx.add(lanterns);
        const wireGeo = new THREE.BufferGeometry();
        wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
        ctx.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x3a2a1a })));

        // Bunting from the gate towers to the street corners.
        const bunting = new GeoBatch({ colors: true });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            addBunting(bunting, [sx * (gateW / 2 + 3), 18, sz * gateZ], [sx * (rowX + 1), 11, sz * (halfL - 10)],
                { count: 18, sag: 2.2, size: 0.9, colors: [0xc8372d, 0xe0a02a, 0x2a7f8f, 0xf4ead8] });
        }
        const buntingMesh = bunting.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
            { mode: 'wave', amp: 0.18, speed: 2.4, freq: 0.5 }));
        if (buntingMesh) ctx.add(buntingMesh);

        // Pigeons circling the plaza.
        const birds = new GeoBatch();
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const r = 75 + (i % 3) * 14;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.9, 0.2, 0, 0, 0, 0.3, 0, 0, -0.2, 0.9, 0.2, 0, 0, 0, -0.2, 0, 0, 0.3], 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
            birds.add(geo, Math.cos(angle) * r, 30 + (i % 4) * 3, Math.sin(angle) * r, { ry: -angle });
        }
        const birdMesh = birds.build(animate(new THREE.MeshBasicMaterial({ color: 0x4a4038, side: THREE.DoubleSide }), ctx,
            { mode: 'orbit', speed: 0.09, amp: 1.5, freq: 0.7 }));
        if (birdMesh) { birdMesh.frustumCulled = false; ctx.add(birdMesh); }
    }

    // Court: zellige star medallions round the team rings, mosaic baselines,
    // sand drifts and cracks, stencilled gate names at each back line.
    courtDecal(ctx, (g, w, h, ppm) => {
        for (let i = 0; i < 26; i++) {
            const r = (2 + rng() * 5) * ppm;
            const x = rng() < 0.5 ? rng() * 0.15 * w : w - rng() * 0.15 * w;
            const y = rng() * h;
            const grad = g.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(226,190,130,0.35)');
            grad.addColorStop(1, 'rgba(226,190,130,0)');
            g.fillStyle = grad;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
        g.strokeStyle = 'rgba(70,40,20,0.22)';
        g.lineWidth = 0.1 * ppm;
        for (let i = 0; i < 30; i++) {
            let x = rng() * w;
            let y = rng() * h;
            g.beginPath();
            g.moveTo(x, y);
            for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 3 * ppm; y += (rng() - 0.5) * 3 * ppm; g.lineTo(x, y); }
            g.stroke();
        }
        for (const fy of [0.25, 0.75]) {
            const cx = w / 2;
            const cy = fy * h;
            for (let k = 0; k < 16; k++) {
                const a = (k / 16) * Math.PI * 2;
                g.fillStyle = k % 2 ? 'rgba(44,79,143,0.28)' : 'rgba(224,160,42,0.3)';
                g.beginPath();
                g.moveTo(cx + Math.cos(a) * 5 * ppm, cy + Math.sin(a) * 5 * ppm);
                g.lineTo(cx + Math.cos(a + 0.2) * 7.5 * ppm, cy + Math.sin(a + 0.2) * 7.5 * ppm);
                g.lineTo(cx + Math.cos(a + 0.39) * 5 * ppm, cy + Math.sin(a + 0.39) * 5 * ppm);
                g.fill();
            }
            g.strokeStyle = 'rgba(255,240,210,0.3)';
            g.lineWidth = 0.18 * ppm;
            g.beginPath();
            g.arc(cx, cy, 7.8 * ppm, 0, Math.PI * 2);
            g.stroke();
        }
        const band = 1.4 * ppm;
        for (const y0 of [0.3 * ppm, h - 0.3 * ppm - band]) {
            for (let x = 0; x < w; x += band) {
                g.fillStyle = (x / band) % 2 < 1 ? 'rgba(44,79,143,0.3)' : 'rgba(250,240,220,0.3)';
                g.fillRect(x, y0, band, band);
            }
        }
        g.fillStyle = 'rgba(255,245,225,0.2)';
        g.font = `900 ${Math.round(3.6 * ppm)}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('BLUE GATE', w / 2, h * 0.94);
        g.save();
        g.translate(w / 2, h * 0.06);
        g.rotate(Math.PI);
        g.fillText('RED GATE', 0, 0);
        g.restore();
    });
}
