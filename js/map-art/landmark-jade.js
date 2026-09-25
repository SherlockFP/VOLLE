// map-art/landmark-jade.js — Jade Garden Temple: a walled temple garden on
// a soft spring morning. Palette: vermilion lacquer, grey roof tile, white
// plaster, jade water, blossom pink, moss. Landmarks: the seven-tier Pagoda
// behind the blue back line, the Bell Tower behind the red one, the Moon
// Gate in the east wall; the Koi Pond + Red Bridge on the west flank and a
// Bamboo grove to the east. Ambient life: falling petals (particles), koi
// and lily pads, swaying lanterns and banners, cranes circling.
import * as THREE from 'three';
import {
    GeoBatch, instanced, animate, canvasTexture, courtDecal,
    signAtlas, paintSign, wallWithOpening
} from './kit.js';

const VERMILION = 0xc8372d;
const TILE = 0x4d545c;
const PLASTER = 0xf2ede2;
const STONE = 0xa8a498;
const GOLD = 0xd9a441;

export function buildJadeGardenArt(ctx) {
    const { halfW, halfL, rng, animate: live, high } = ctx;
    const yardX = halfW + 70;
    const yardZ = halfL + 70;

    // Flagstone paving with moss joints.
    const paving = canvasTexture(ctx, 256, 256, (g, w, h) => {
        g.fillStyle = '#5c6a4c';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 26; i++) {
            const x = rng() * w;
            const y = rng() * h;
            const v = 150 + Math.floor(rng() * 40);
            g.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
            g.beginPath();
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2 + rng() * 0.3;
                const r = 22 + rng() * 16;
                if (k) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
            g.fill();
        }
    }, { repeatX: yardX / 8, repeatY: yardZ / 8 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(yardX * 2, yardZ * 2),
        new THREE.MeshLambertMaterial({ color: 0xffffff, map: paving }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    ctx.add(ground);

    // --- Architecture: walls, curved roofs, pagoda, bell tower, bridge -------
    const s = new GeoBatch({ colors: true });
    // Hipped roof with upturned eaves: flattened 4-sided cone + corner tips.
    const roof = (x, y, z, w, d, rise, color = TILE, ry = 0) => {
        s.add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1), x, y + rise / 2, z, { ry: ry + Math.PI / 4, sx: w, sy: rise, sz: d, color });
        const c = Math.cos(ry);
        const sn = Math.sin(ry);
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const lx = ox * w * 0.5;
            const lz = oz * d * 0.5;
            s.add(new THREE.ConeGeometry(0.28, 1.4, 5), x + lx * c + lz * sn, y + 0.5, z - lx * sn + lz * c,
                { rx: oz * 0.9, rz: -ox * 0.9, color });
        }
    };
    // Courtyard walls (plaster + tile coping) with the Moon Gate in the east wall.
    const wallX = halfW + 28;
    const wallZ = halfL + 26;
    for (const sx of [-1, 1]) {
        if (sx > 0) {
            const gateLen = 16;
            const segLen = (wallZ * 2 - gateLen) / 2;
            for (const sz of [-1, 1]) s.add(new THREE.BoxGeometry(1.2, 6, segLen), wallX, 3, sz * (gateLen / 2 + segLen / 2), { color: PLASTER });
            s.add(wallWithOpening(gateLen, 9, 1.6, { kind: 'circle', ow: 7.2, oh: 4.2 }), wallX, 0, 0, { ry: Math.PI / 2, color: PLASTER });
            roof(wallX, 9, 0, 3, gateLen + 1, 1.6);
        } else {
            s.add(new THREE.BoxGeometry(1.2, 6, wallZ * 2), -wallX, 3, 0, { color: PLASTER });
        }
        s.add(new THREE.BoxGeometry(2.6, 0.5, wallZ * 2 + 2), sx * wallX, 6.25, 0, { color: TILE });
        s.add(new THREE.BoxGeometry(1.3, 0.6, wallZ * 2), sx * wallX, 0.3, 0, { color: 0x8a8a84 });
    }
    for (const sz of [-1, 1]) {
        s.add(new THREE.BoxGeometry(wallX * 2, 6, 1.2), 0, 3, sz * wallZ, { color: PLASTER });
        s.add(new THREE.BoxGeometry(wallX * 2 + 2, 0.5, 2.6), 0, 6.25, sz * wallZ, { color: TILE });
        s.add(new THREE.BoxGeometry(wallX * 2, 0.6, 1.3), 0, 0.3, sz * wallZ, { color: 0x8a8a84 });
    }
    // Seven-tier pagoda behind the blue back line.
    const pz = halfL + 46;
    s.add(new THREE.BoxGeometry(22, 2.4, 22), 0, 1.2, pz, { color: STONE });
    let y = 2.4;
    for (let tier = 0; tier < 7; tier++) {
        const w = 13 - tier * 1.25;
        const hgt = tier === 0 ? 6 : 4;
        s.add(new THREE.BoxGeometry(w, hgt, w), 0, y + hgt / 2, pz, { color: tier % 2 ? 0xb8322a : VERMILION });
        for (const ox of [-1, 1]) for (const oz of [-1, 1]) s.add(new THREE.BoxGeometry(0.5, hgt, 0.5), ox * (w / 2 + 0.2), y + hgt / 2, pz + oz * (w / 2 + 0.2), { color: 0x7a1e18 });
        s.add(new THREE.BoxGeometry(w + 0.3, 0.5, w + 0.3), 0, y + hgt - 0.6, pz, { color: 0x2f7f72 });
        roof(0, y + hgt, pz, w + 6, w + 6, 2.2);
        y += hgt + 1.4;
    }
    s.add(new THREE.CylinderGeometry(0.25, 0.5, 9, 8), 0, y + 4, pz, { color: GOLD });
    for (let k = 0; k < 5; k++) s.add(new THREE.TorusGeometry(0.9 - k * 0.12, 0.14, 6, 14), 0, y + 1.5 + k * 1.2, pz, { rx: Math.PI / 2, color: GOLD });
    // Bell tower behind the red back line: stone base, pavilion, bronze bell.
    const bz = -(halfL + 38);
    s.add(new THREE.BoxGeometry(16, 7, 16), 0, 3.5, bz, { color: STONE });
    for (const ox of [-1, 1]) for (const oz of [-1, 1]) s.add(new THREE.CylinderGeometry(0.45, 0.45, 7, 10), ox * 5.5, 10.5, bz + oz * 5.5, { color: VERMILION });
    s.add(new THREE.BoxGeometry(13, 0.8, 13), 0, 14.2, bz, { color: 0x7a1e18 });
    roof(0, 14.6, bz, 18, 18, 4.2);
    s.add(new THREE.CylinderGeometry(1.4, 2.2, 3.6, 16), 0, 11.2, bz, { color: 0x6a5a38 });
    s.add(new THREE.BoxGeometry(6, 0.4, 0.4), 0, 13.6, bz, { color: 0x4a2c1a });
    // Side halls along the walls (behind the stands), lacquer columns + roofs.
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const hx = sx * (wallX - 6);
            const hz = sz * 44;
            s.add(new THREE.BoxGeometry(9, 5, 20), hx, 2.5 + 0.8, hz, { color: PLASTER });
            s.add(new THREE.BoxGeometry(10, 0.8, 21), hx, 0.4, hz, { color: STONE });
            for (let k = 0; k < 5; k++) s.add(new THREE.CylinderGeometry(0.3, 0.3, 5, 8), hx - sx * 4.8, 3.3, hz - 9 + k * 4.5, { color: VERMILION });
            roof(hx, 5.8, hz, 12, 23, 3.4);
        }
    }
    // Koi pond (west flank): stone rim; Red Bridge arching across it.
    const pondX = -(halfW + 20);
    const pondL = 64;
    for (const sx of [-1, 1]) s.add(new THREE.BoxGeometry(0.9, 0.7, pondL), pondX + sx * 5.2, 0.35, 0, { color: STONE });
    for (const sz of [-1, 1]) s.add(new THREE.BoxGeometry(11.3, 0.7, 0.9), pondX, 0.35, sz * pondL / 2, { color: STONE });
    for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const bx = pondX - 6 + t * 12;
        const by = 0.6 + Math.sin(Math.PI * t) * 2.4;
        const slope = Math.cos(Math.PI * t) * 0.62;
        s.add(new THREE.BoxGeometry(1.1, 0.25, 3.2), bx, by, 0, { rz: slope, color: VERMILION });
        if (k % 2 === 0) for (const sz of [-1.5, 1.5]) s.add(new THREE.BoxGeometry(0.16, 1.1, 0.16), bx, by + 0.6, sz, { color: VERMILION });
    }
    // Rockery islands + stepping stones in the pond.
    for (let k = 0; k < 6; k++) s.add(new THREE.DodecahedronGeometry(0.9 + rng() * 1.3, 0), pondX + (rng() - 0.5) * 7, 0.2, -26 + k * 10 + rng() * 3, { color: 0x7f8a86 });
    // Distant karst peaks through the mist.
    const peakCount = ctx.tier === 'low' ? 10 : 18;
    for (let i = 0; i < peakCount; i++) {
        const angle = (i / peakCount) * Math.PI * 2 + rng() * 0.2;
        const dist = 300 + rng() * 200;
        const hgt = 90 + rng() * 120;
        s.add(new THREE.CylinderGeometry(8 + rng() * 10, 30 + rng() * 20, hgt, 9), Math.cos(angle) * dist, hgt / 2 - 10, Math.sin(angle) * dist, { color: 0x6f8a7c });
        s.add(new THREE.SphereGeometry(18, 10, 6), Math.cos(angle) * dist, hgt - 12, Math.sin(angle) * dist, { sy: 0.8, color: 0x5f7a6a });
    }
    const arch = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (arch) { arch.receiveShadow = true; ctx.add(arch); }

    // Pond water (jade shimmer).
    const pond = new THREE.Mesh(new THREE.PlaneGeometry(10.4, pondL),
        animate(new THREE.MeshStandardMaterial({ color: 0x2f7f72, roughness: 0.15, metalness: 0.1 }), ctx, { mode: 'shimmer', amp: 0.06, speed: 0.9, freq: 0.8 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(pondX, 0.28, 0);
    ctx.add(pond);

    // Cherry trees: trunks + pink canopies; bamboo grove on the east flank.
    const trees = [];
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
        trees.push([sx * (halfW + 20), sz * (halfL + 12)], [sx * (halfW + 21), sz * 38]);
    }
    for (let i = 0; i < (ctx.tier === 'low' ? 14 : 30); i++) {
        const angle = rng() * Math.PI * 2;
        const dist = 110 + rng() * 60;
        trees.push([Math.cos(angle) * dist, Math.sin(angle) * dist]);
    }
    const trunkMesh = instanced(new THREE.CylinderGeometry(0.3, 0.55, 6, 7), new THREE.MeshLambertMaterial({ color: 0x4a3226 }),
        trees.map(([x, z]) => ({ x, y: 3, z, rz: (rng() - 0.5) * 0.25 })));
    if (trunkMesh) ctx.add(trunkMesh);
    const blossoms = [];
    for (const [x, z] of trees) {
        for (let k = 0; k < 4; k++) {
            blossoms.push({ x: x + (rng() - 0.5) * 4, y: 6.5 + rng() * 2.2, z: z + (rng() - 0.5) * 4, s: 2.2 + rng() * 1.2, ry: rng() * 6,
                color: [0xf6b8cc, 0xf29ab8, 0xfbd3de, 0xe98aa8][k] });
        }
    }
    const canopy = instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), blossoms);
    if (canopy) ctx.add(canopy);
    const culms = [];
    const culmCount = ctx.tier === 'low' ? 60 : high ? 180 : 130;
    for (let i = 0; i < culmCount; i++) {
        const clump = i % 6;
        const cz = -40 + clump * 16;
        culms.push({ x: halfW + 19 + (rng() - 0.5) * 6, y: 5, z: cz + (rng() - 0.5) * 8, sy: 0.8 + rng() * 0.5, rz: (rng() - 0.5) * 0.12, rx: (rng() - 0.5) * 0.12,
            color: rng() < 0.3 ? 0x8fae4a : 0x5f8a3a });
    }
    const bamboo = instanced(new THREE.CylinderGeometry(0.12, 0.14, 10, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), culms);
    if (bamboo) ctx.add(bamboo);

    // Plaques (callouts): pagoda, bell tower, moon gate, koi pond, bamboo.
    const SIGNS = ['PAGODA', 'BELL TOWER', 'MOON GATE', 'KOI POND', 'RED BRIDGE', 'BAMBOO', 'LANTERNS', 'ROCKERY'];
    const atlas = signAtlas(ctx, 2, 4, 256, 96, (g, i, x, y, w, h) => {
        paintSign(g, x, y, w, h, SIGNS[i], { bg: '#1f2a24', border: '#d9a441', fg: '#f3d48a', font: 'Georgia, serif' });
    });
    const signs = new GeoBatch();
    signs.add(new THREE.PlaneGeometry(8, 3), 0, 4.6, pz - 11.05, { ry: Math.PI, ...atlas.uv(0) });
    signs.add(new THREE.PlaneGeometry(8, 3), 0, 4.2, bz + 8.05, { ...atlas.uv(1) });
    signs.add(new THREE.PlaneGeometry(5, 1.9), wallX - 0.62, 3.8, 11, { ry: -Math.PI / 2, ...atlas.uv(2) });
    signs.add(new THREE.PlaneGeometry(5, 1.9), -(wallX - 0.62), 4.2, -20, { ry: Math.PI / 2, ...atlas.uv(3) });
    signs.add(new THREE.PlaneGeometry(5, 1.9), -(wallX - 0.62), 4.2, 20, { ry: Math.PI / 2, ...atlas.uv(4) });
    signs.add(new THREE.PlaneGeometry(5, 1.9), wallX - 0.62, 4.2, -24, { ry: -Math.PI / 2, ...atlas.uv(5) });
    signs.add(new THREE.PlaneGeometry(5, 1.9), wallX - 0.62, 4.2, 24, { ry: -Math.PI / 2, ...atlas.uv(6) });
    const signMesh = signs.build(new THREE.MeshLambertMaterial({ map: atlas.texture, color: atlas.texture ? 0xffffff : 0x1f2a24, side: THREE.DoubleSide }));
    if (signMesh) ctx.add(signMesh);

    // Red paper lanterns under the hall eaves and the pagoda tiers (glow).
    const lanterns = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        for (let k = 0; k < 4; k++) lanterns.push({ x: sx * (wallX - 6) - sx * 5.6, y: 5.2, z: sz * 44 - 7 + k * 4.6, sx: 0.9, sy: 1.1, sz: 0.9 });
    }
    let ly = 2.4;
    for (let tier = 0; tier < 6; tier++) {
        const hgt = tier === 0 ? 6 : 4;
        const w = 13 - tier * 1.25;
        for (const ox of [-1, 1]) lanterns.push({ x: ox * (w / 2 + 2.4), y: ly + hgt - 0.4, z: pz - w / 2 - 2.4, sx: 0.8, sy: 1, sz: 0.8 });
        ly += hgt + 1.4;
    }
    const lanternMesh = instanced(new THREE.SphereGeometry(0.5, 10, 8),
        animate(new THREE.MeshBasicMaterial({ color: 0xff5a3a }), ctx, { mode: 'bob', amp: 0.06, speed: 1.4 }), lanterns);
    if (lanternMesh) ctx.add(lanternMesh);

    if (live) {
        // Koi + lily pads.
        const koi = [];
        for (let i = 0; i < 16; i++) {
            koi.push({ x: pondX + (rng() - 0.5) * 8, y: 0.2, z: (rng() - 0.5) * (pondL - 6), sx: 0.35, sy: 0.18, sz: 1.1, ry: rng() * 6,
                color: [0xff7a2a, 0xffffff, 0xe8402a, 0xffc04a][i % 4] });
        }
        const koiMesh = instanced(new THREE.SphereGeometry(0.5, 8, 6), animate(new THREE.MeshLambertMaterial({ color: 0xffffff }), ctx,
            { mode: 'bob', amp: 0.05, speed: 2.2 }), koi);
        if (koiMesh) ctx.add(koiMesh);
        const pads = [];
        for (let i = 0; i < 22; i++) pads.push({ x: pondX + (rng() - 0.5) * 8.5, y: 0.31, z: (rng() - 0.5) * (pondL - 4), s: 0.5 + rng() * 0.6, ry: rng() * 6, color: rng() < 0.2 ? 0xf6b8cc : 0x4e8f3c });
        const padMesh = instanced(new THREE.CylinderGeometry(1, 1, 0.05, 10), animate(new THREE.MeshLambertMaterial({ color: 0xffffff }), ctx,
            { mode: 'bob', amp: 0.02, speed: 1.1 }), pads);
        if (padMesh) ctx.add(padMesh);

        // Team banners on the pagoda plinth + bell tower (wave).
        const banners = new GeoBatch({ colors: true });
        for (const ox of [-1, 1]) {
            banners.add(new THREE.PlaneGeometry(2, 7, 3, 8), ox * 9, 9.5, pz - 11.2, { color: ctx.config.floorBlue });
            banners.add(new THREE.PlaneGeometry(2, 6, 3, 8), ox * 7, 3.8, bz + 8.2, { color: ctx.config.floorRed });
        }
        const bannerMesh = banners.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
            { mode: 'wave', amp: 0.2, speed: 1.6, freq: 0.4, anchorTop: true }));
        if (bannerMesh) ctx.add(bannerMesh);

        // Cranes (birds) circling the pagoda.
        const birds = new GeoBatch();
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute([-1.6, 0.3, 0, 0, 0, 0.5, 0, 0, -0.4, 1.6, 0.3, 0, 0, 0, -0.4, 0, 0, 0.5], 3));
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
            birds.add(geo, Math.cos(angle) * 95, 44 + (i % 3) * 5, Math.sin(angle) * 95, { ry: -angle });
        }
        const birdMesh = birds.build(animate(new THREE.MeshBasicMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide }), ctx,
            { mode: 'orbit', speed: 0.04, amp: 2.5, freq: 0.4 }));
        if (birdMesh) { birdMesh.frustumCulled = false; ctx.add(birdMesh); }
    }

    // Court: raked-gravel ripples along the sidelines, petal drifts, a
    // stone-inlay cloud motif round each team ring.
    courtDecal(ctx, (g, w, h, ppm) => {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 0.1 * ppm;
        for (const x0 of [1 * ppm, w - 3.5 * ppm]) {
            for (let k = 0; k < 5; k++) {
                g.beginPath();
                for (let y = 0; y <= h; y += 2 * ppm) {
                    const x = x0 + k * 0.5 * ppm + Math.sin(y / (3 * ppm)) * 0.3 * ppm;
                    if (y) g.lineTo(x, y); else g.moveTo(x, y);
                }
                g.stroke();
            }
        }
        for (let i = 0; i < 160; i++) {
            g.fillStyle = `rgba(250,${170 + Math.floor(rng() * 40)},${190 + Math.floor(rng() * 30)},${0.3 + rng() * 0.4})`;
            const x = rng() < 0.5 ? rng() * 0.2 * w : w - rng() * 0.2 * w;
            g.beginPath();
            g.ellipse(x, rng() * h, 0.18 * ppm, 0.1 * ppm, rng() * 3, 0, Math.PI * 2);
            g.fill();
        }
        for (const fy of [0.25, 0.75]) {
            const cx = w / 2;
            const cy = fy * h;
            g.strokeStyle = 'rgba(245,235,210,0.24)';
            g.lineWidth = 0.22 * ppm;
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2;
                g.beginPath();
                g.arc(cx + Math.cos(a) * 6.4 * ppm, cy + Math.sin(a) * 6.4 * ppm, 1.2 * ppm, a + Math.PI * 0.5, a + Math.PI * 1.5);
                g.stroke();
            }
        }
        g.fillStyle = 'rgba(255,245,230,0.18)';
        g.font = `900 ${Math.round(3.6 * ppm)}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('PAGODA', w / 2, h * 0.94);
        g.save();
        g.translate(w / 2, h * 0.06);
        g.rotate(Math.PI);
        g.fillText('BELL TOWER', 0, 0);
        g.restore();
    });
}
