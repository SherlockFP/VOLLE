// map-art/polish.js — the visual polish layer for the eight most-played maps
// (default + rally-duel + flagship-layout + stadium maps). Each map gets:
// a subtle court decal (one plane), 1-3 merged/instanced ambient prop
// families and GPU-side ambient animation. Nothing here collides, and the
// whole layer is skipped on Low quality (see Arena._loadMapArt).
import * as THREE from 'three';
import { GeoBatch, instanced, animate, canvasTexture, courtDecal, addBunting } from './kit.js';
import { drawNeonSign } from './new-maps.js';

const TEAM_TEXT = 'rgba(255,255,255,0.14)';

// --- Beach Volleyball -------------------------------------------------------------
function beachOpen(ctx) {
    const { halfW, halfL, rng } = ctx;
    const s = new GeoBatch({ colors: true });
    const corners = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * (halfW + 2), sz * (halfL + 2)]);
    for (const [x, z] of corners) s.add(new THREE.CylinderGeometry(0.09, 0.11, 6.4, 6), x, 3.2, z, { color: 0xf4efe0 });
    // Lifeguard towers on the shore, point-mirrored.
    for (const [x, z] of [[-14, -(halfL + 11)], [14, halfL + 11]]) {
        const face = z < 0 ? 0 : Math.PI;
        for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
            s.add(new THREE.BoxGeometry(0.22, 3.6, 0.22), x + lx * 1.1, 1.8, z + lz * 1.1, { color: 0xf4efe0 });
        }
        s.add(new THREE.BoxGeometry(2.8, 0.2, 2.8), x, 3.6, z, { color: 0xd8c9a6 });
        s.add(new THREE.BoxGeometry(2.4, 1.6, 2.2), x, 4.5, z, { ry: face, color: 0xe8474f });
        s.add(new THREE.ConeGeometry(2.3, 1, 4), x, 5.8, z, { ry: Math.PI / 4, color: 0xf6f2e6 });
        s.add(new THREE.BoxGeometry(0.9, 0.06, 3.4), x, 1.8, z - Math.sign(z) * 2.6, { rx: Math.sign(z) * 0.95, color: 0xd8c9a6 });
    }
    const posts = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (posts) ctx.add(posts);

    const flags = new GeoBatch({ colors: true });
    const colors = [0xff5d6c, 0xffd23d, 0x21b6d9, 0xffffff];
    const top = 6.2;
    const loop = [corners[0], corners[1], corners[3], corners[2], corners[0]];
    for (let i = 0; i < 4; i++) {
        const [x0, z0] = loop[i];
        const [x1, z1] = loop[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        addBunting(flags, [x0, top, z0], [x1, top, z1], { count: Math.round(len / 2.2), sag: 1.1, size: 0.75, colors });
    }
    const bunting = flags.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.16, speed: 3.2, freq: 0.6, anchorTop: true }));
    if (bunting) ctx.add(bunting);

    // Sun glitter on the sea: additive black plane, only the shimmer shows.
    const glitter = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), animate(new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }), ctx, { mode: 'shimmer', amp: 0.16, speed: 1.4, freq: 0.9 }));
    glitter.rotation.x = -Math.PI / 2;
    glitter.position.y = -0.28;
    ctx.add(glitter);

    courtDecal(ctx, (g, w, h, ppm) => {
        g.lineWidth = 0.1 * ppm;
        for (let k = 0; k < 60; k++) {
            const y0 = (k / 60) * h;
            g.strokeStyle = k % 2 ? 'rgba(255,240,210,0.10)' : 'rgba(120,70,40,0.08)';
            g.beginPath();
            for (let x = 0; x <= w; x += 8) {
                const y = y0 + Math.sin(x / (3.1 * ppm) + k) * 0.35 * ppm;
                if (x) g.lineTo(x, y); else g.moveTo(x, y);
            }
            g.stroke();
        }
        g.fillStyle = 'rgba(110,60,30,0.10)';
        for (let i = 0; i < 90; i++) {
            g.beginPath();
            g.ellipse(rng() * w, rng() * h, 0.12 * ppm, 0.22 * ppm, rng() * Math.PI, 0, Math.PI * 2);
            g.fill();
        }
    }, { opacity: 0.9 });
}

// --- Factory ------------------------------------------------------------------------
function industrial(ctx) {
    const { halfW, halfL, config, rng } = ctx;
    const lampSpots = [];
    for (const sx of [-1, 1]) for (const z of [-40, -13, 13, 40]) lampSpots.push([sx * (halfW - 6), z]);
    const s = new GeoBatch({ colors: true });
    for (const [x, z] of lampSpots) {
        s.add(new THREE.BoxGeometry(0.08, 8, 0.08), x, 20.5, z, { color: 0x222831 });
        s.add(new THREE.ConeGeometry(1.3, 1.1, 14, 1, true), x, 16.1, z, { color: 0x3b4a5c });
    }
    const hardware = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    if (hardware) ctx.decor(hardware, 'hanging lamp rig up under the factory roof');
    const glows = instanced(new THREE.CircleGeometry(1.05, 16), new THREE.MeshBasicMaterial({ color: 0xfff1c9, side: THREE.DoubleSide }),
        lampSpots.map(([x, z]) => ({ x, y: 15.58, z, rx: Math.PI / 2 })));
    if (glows) ctx.decor(glows, 'lamp lenses on the roof rig, no surface to hit');
    // Soft light cones under the lamps.
    const cones = instanced(new THREE.ConeGeometry(4.2, 14, 18, 1, true), new THREE.MeshBasicMaterial({
        color: 0xfff0c8, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }), lampSpots.map(([x, z]) => ({ x, y: 8.6, z })));
    if (cones) ctx.decor(cones, 'additive light volume, not a surface');

    // Amber warning beacons on the end frames.
    const beacons = instanced(new THREE.SphereGeometry(0.42, 10, 8),
        animate(new THREE.MeshBasicMaterial({ color: 0xffa72d }), ctx, { mode: 'blink', amp: 0.15, speed: 1.2 }),
        [-1, 1].flatMap(sz => [-1, 1].map(sx => ({ x: sx * halfW * 0.52, y: 16.3, z: sz * (halfL - 1.4) }))));
    if (beacons) ctx.decor(beacons, 'warning beacons on the end frames, above play height');

    // Team banners hanging from the end-frame crossbars.
    const banners = new GeoBatch({ colors: true });
    for (const sz of [-1, 1]) {
        for (const x of [-halfW * 0.24, halfW * 0.24]) {
            banners.add(new THREE.PlaneGeometry(3.4, 7, 4, 10), x, 11, sz * (halfL - 2.2), { color: sz < 0 ? config.floorRed : config.floorBlue });
        }
    }
    const bannerMesh = banners.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.18, speed: 1.6, freq: 0.3, anchorTop: true }));
    if (bannerMesh) ctx.decor(bannerMesh, 'cloth banners hung from the end-frame crossbars');

    courtDecal(ctx, (g, w, h, ppm) => {
        for (let i = 0; i < 26; i++) {
            const r = (0.8 + rng() * 2.6) * ppm;
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
            grad.addColorStop(0, 'rgba(20,18,16,0.22)');
            grad.addColorStop(1, 'rgba(20,18,16,0)');
            g.save();
            g.translate(rng() * w, rng() * h);
            g.scale(1, 0.6 + rng() * 0.6);
            g.fillStyle = grad;
            g.fillRect(-r, -r, 2 * r, 2 * r);
            g.restore();
        }
        chevronBand(g, w, 0.5 * ppm, 1.1 * ppm, 'rgba(255,190,40,0.30)');
        chevronBand(g, w, h - 1.6 * ppm, 1.1 * ppm, 'rgba(255,190,40,0.30)');
        g.strokeStyle = 'rgba(255,200,60,0.24)';
        g.lineWidth = 0.18 * ppm;
        g.setLineDash([2 * ppm, 1.4 * ppm]);
        for (const fx of [0.06, 0.94]) {
            g.beginPath(); g.moveTo(fx * w, 2.4 * ppm); g.lineTo(fx * w, h - 2.4 * ppm); g.stroke();
        }
        g.setLineDash([]);
        stencil(g, 'BAY 01', w / 2, h * 0.9, 4 * ppm, 0);
        stencil(g, 'BAY 02', w / 2, h * 0.1, 4 * ppm, Math.PI);
    });
}

// --- Neon City ------------------------------------------------------------------------
function neon(ctx) {
    const { halfW, halfL, rng } = ctx;
    const signs = [
        { text: 'VOLLE', color: '#ff3d81', sub: 'NEON CITY' },
        { text: 'RAMEN', color: '#2de2e6', sub: 'LATE NIGHT' },
        { text: 'ARCADE', color: '#f5d300', sub: 'HIGH SCORE' },
        { text: 'CLUB', color: '#a855f7', sub: 'RAIN OR SHINE' }
    ];
    const atlas = canvasTexture(ctx, 1024, 512, (g, w, h) => {
        signs.forEach((sign, i) => drawNeonSign(g, (i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2, sign));
    });
    const posts = new GeoBatch({ colors: true });
    const signBatch = new GeoBatch();
    const spots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    spots.forEach(([sx, sz], i) => {
        const x = sx * (halfW + 7);
        const z = sz * (halfL * 0.55);
        posts.add(new THREE.BoxGeometry(0.4, 12, 0.4), x, 6, z, { color: 0x1d1a2b });
        signBatch.add(new THREE.PlaneGeometry(12, 6), x - sx * 0.3, 14, z, {
            ry: sx < 0 ? Math.PI / 2 : -Math.PI / 2,
            uvScale: [0.5, 0.5], uvOffset: [(i % 2) * 0.5, 0.5 - Math.floor(i / 2) * 0.5]
        });
    });
    const postMesh = posts.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (postMesh) ctx.add(postMesh);
    const signMesh = signBatch.build(animate(new THREE.MeshBasicMaterial({
        map: atlas, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: atlas ? 0xffffff : 0xff3d81
    }), ctx, { mode: 'flicker', amp: 0.3, speed: 8 }));
    if (signMesh) ctx.add(signMesh);

    // Wet-street reflections: coloured vertical streaks + a pulsing grid.
    courtDecal(ctx, (g, w, h, ppm) => {
        const colors = ['255,61,129', '45,226,230', '245,211,0', '168,85,247'];
        for (let i = 0; i < 18; i++) {
            const x = rng() * w;
            const y = rng() * h;
            const len = (4 + rng() * 10) * ppm;
            const grad = g.createLinearGradient(x, y, x, y + len);
            const c = colors[i % colors.length];
            grad.addColorStop(0, `rgba(${c},0)`);
            grad.addColorStop(0.5, `rgba(${c},0.22)`);
            grad.addColorStop(1, `rgba(${c},0)`);
            g.fillStyle = grad;
            g.fillRect(x - 0.6 * ppm, y, 1.2 * ppm, len);
        }
        g.strokeStyle = 'rgba(45,226,230,0.16)';
        g.lineWidth = 0.08 * ppm;
        for (let x = 0; x <= w; x += 6 * ppm) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        for (let y = 0; y <= h; y += 6 * ppm) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }, { anim: { mode: 'pulse', amp: 0.55, speed: 1.6, freq: 0.12 } });
}

// --- Grand Stadium ------------------------------------------------------------------------
function grandStadium(ctx) {
    const { halfW, halfL, config } = ctx;
    // LED ribbon boards around the court with scrolling text.
    const led = canvasTexture(ctx, 1024, 64, (g, w, h) => {
        g.fillStyle = '#081221';
        g.fillRect(0, 0, w, h);
        g.font = '900 40px Arial, sans-serif';
        g.textBaseline = 'middle';
        const items = [['VOLLE', '#ffffff'], ['GRAND STADIUM', '#7fd0ff'], ['VOLLE', '#ffd166'], ['DEFLECT • DODGE • WIN', '#ff8a8a']];
        let x = 12;
        for (const [text, color] of items) {
            g.fillStyle = color;
            g.fillText(text, x, h / 2 + 2);
            x += g.measureText(text).width + 60;
        }
    });
    if (led) { led.wrapS = THREE.RepeatWrapping; }
    const boards = new GeoBatch();
    const boardH = 1.1;
    const unit = 16; // metres per texture repeat
    for (const sx of [-1, 1]) {
        const len = halfL * 2;
        boards.add(new THREE.BoxGeometry(0.3, boardH, len), sx * (halfW + 1.8), boardH / 2, 0, { uvScale: [len / unit, 1] });
    }
    for (const sz of [-1, 1]) {
        const len = halfW * 2;
        boards.add(new THREE.BoxGeometry(len, boardH, 0.3), 0, boardH / 2, sz * (halfL + 1.8), { uvScale: [len / unit, 1] });
    }
    const boardMesh = boards.build(animate(new THREE.MeshBasicMaterial({ map: led, color: led ? 0xffffff : 0x182536 }), ctx,
        { mode: 'scroll', speed: 0.08 }));
    if (boardMesh) ctx.add(boardMesh);

    // Pennants on the eight floodlight masts.
    const flags = new GeoBatch({ colors: true });
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = Math.cos(angle) * (halfW + 16);
        const z = Math.sin(angle) * (halfL + 16);
        flags.add(new THREE.PlaneGeometry(4, 2.2, 8, 2), x + 2.2, 19.6, z, { color: z < 0 ? config.floorRed : config.floorBlue });
    }
    const flagMesh = flags.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.35, speed: 3.4, freq: 0.4 }));
    if (flagMesh) ctx.decor(flagMesh, 'pennants flying from the floodlight mast tops');

    courtDecal(ctx, (g, w, h, ppm) => {
        stencil(g, 'VOLLE', w / 2, h * 0.36, 7 * ppm, Math.PI, TEAM_TEXT);
        stencil(g, 'VOLLE', w / 2, h * 0.64, 7 * ppm, 0, TEAM_TEXT);
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 0.12 * ppm;
        for (const r of [7.5, 8.2]) { g.beginPath(); g.arc(w / 2, h / 2, r * ppm, 0, Math.PI * 2); g.stroke(); }
        // Mown-grass style alternating bands.
        for (let k = 0; k < 12; k++) {
            if (k % 2) continue;
            g.fillStyle = 'rgba(255,255,255,0.035)';
            g.fillRect(0, (k / 12) * h, w, h / 12);
        }
    });
}

// --- Pillar Hall ---------------------------------------------------------------------------
function pillar(ctx) {
    const { halfW, halfL, config } = ctx;
    const s = new GeoBatch({ colors: true });
    const spots = [];
    for (const sx of [-1, 1]) for (const z of [-44, -22, 22, 44]) spots.push([sx * (halfW + 4), z]);
    for (const [x, z] of spots) {
        s.add(new THREE.CylinderGeometry(0.22, 0.28, 17, 8), x, 8.5, z, { color: 0x5a4a3a });
        s.add(new THREE.BoxGeometry(0.2, 0.2, 4.4), x, 16.6, z, { color: 0x5a4a3a });
        s.add(new THREE.SphereGeometry(0.4, 8, 6), x, 17.2, z, { color: 0xc9a24a });
    }
    const poles = s.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (poles) ctx.add(poles);
    const trim = canvasTexture(ctx, 128, 256, (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(201,162,74,0.95)';
        g.lineWidth = 8;
        g.strokeRect(8, 8, w - 16, h - 16);
        meander(g, 18, 24, w - 36, 16, 'rgba(201,162,74,0.9)');
        meander(g, 18, h - 40, w - 36, 16, 'rgba(201,162,74,0.9)');
        g.fillStyle = 'rgba(201,162,74,0.85)';
        g.beginPath();
        g.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
        g.fill();
    });
    const cloth = new GeoBatch({ colors: true });
    for (const [x, z] of spots) {
        cloth.add(new THREE.PlaneGeometry(4, 9, 4, 12), x, 11.9, z, { ry: Math.PI / 2, color: z < 0 ? config.floorRed : config.floorBlue });
    }
    const clothMesh = cloth.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, map: trim, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.16, speed: 1.2, freq: 0.25, anchorTop: true }));
    if (clothMesh) ctx.add(clothMesh);
    addShafts(ctx, [[-halfW + 6, -halfL * 0.5], [halfW - 6, halfL * 0.5], [-halfW + 6, halfL * 0.5], [halfW - 6, -halfL * 0.5]], 0xfff0d0, 0.18);

    courtDecal(ctx, (g, w, h, ppm) => {
        g.strokeStyle = 'rgba(80,60,40,0.12)';
        g.lineWidth = 0.06 * ppm;
        for (let i = 0; i < 30; i++) {
            let x = ((i * 37) % 100) / 100 * w;
            let y = ((i * 61) % 100) / 100 * h;
            g.beginPath();
            g.moveTo(x, y);
            for (let k = 0; k < 8; k++) {
                x += Math.sin(i * 3 + k) * 3 * ppm;
                y += Math.cos(i * 5 + k * 1.3) * 3 * ppm;
                g.lineTo(x, y);
            }
            g.stroke();
        }
        meander(g, 1.2 * ppm, 1.2 * ppm, w - 2.4 * ppm, 1.4 * ppm, 'rgba(230,200,140,0.26)');
        meander(g, 1.2 * ppm, h - 2.6 * ppm, w - 2.4 * ppm, 1.4 * ppm, 'rgba(230,200,140,0.26)');
        for (const fy of [0.25, 0.75]) compass(g, w / 2, fy * h, 8 * ppm, 'rgba(230,200,140,0.22)');
    });
}

// --- Circuit Dome ----------------------------------------------------------------------------
function circuitDome(ctx) {
    const { halfW, halfL, rng } = ctx;
    const ribs = new GeoBatch({ colors: true });
    const edges = new GeoBatch({ colors: true });
    const rx = Math.hypot(halfW, halfL) + 10;
    const ry = 36;
    for (let r = 0; r < 8; r++) {
        const yaw = (r / 8) * Math.PI;
        const segs = 16;
        for (let k = 0; k < segs; k++) {
            const a0 = (k / segs) * Math.PI;
            const a1 = ((k + 1) / segs) * Math.PI;
            const p0 = [Math.cos(a0) * rx, Math.sin(a0) * ry];
            const p1 = [Math.cos(a1) * rx, Math.sin(a1) * ry];
            const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const mx = (p0[0] + p1[0]) / 2;
            const my = (p0[1] + p1[1]) / 2;
            const tilt = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
            // Build in the arc's local XY plane, then yaw around Y.
            const geo = new THREE.BoxGeometry(len + 0.2, 0.9, 1.2);
            geo.rotateZ(tilt);
            geo.translate(mx, my, 0);
            ribs.add(geo, 0, 0, 0, { ry: yaw, color: 0x0f3346 });
            if (k % 2 === 0) {
                const strip = new THREE.BoxGeometry(len * 0.8, 0.16, 0.2);
                strip.rotateZ(tilt);
                strip.translate(mx - Math.sin(tilt) * 0.6, my + Math.cos(tilt) * -0.6, 0);
                edges.add(strip, 0, 0, 0, { ry: yaw, color: r % 2 ? 0x35d9cc : 0xb7ff43 });
            }
        }
    }
    const ribMesh = ribs.build(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    if (ribMesh) ctx.decor(ribMesh, 'dome ribs arcing overhead, 15 m+ above the court');
    const edgeMesh = edges.build(animate(new THREE.MeshBasicMaterial({ color: 0xffffff }), ctx, { mode: 'pulse', amp: 0.35, speed: 2.4, freq: 0.08 }));
    if (edgeMesh) ctx.decor(edgeMesh, 'light strips on the overhead dome ribs');

    courtDecal(ctx, (g, w, h, ppm) => {
        g.lineCap = 'round';
        const trace = (x, y, steps, color) => {
            g.strokeStyle = color;
            g.lineWidth = 0.14 * ppm;
            g.beginPath();
            g.moveTo(x, y);
            for (let k = 0; k < steps; k++) {
                const dir = Math.floor(rng() * 4);
                const len = (2 + rng() * 5) * ppm;
                if (dir === 0) x += len; else if (dir === 1) x -= len; else if (dir === 2) y += len; else y -= len;
                x = Math.max(0, Math.min(w, x));
                y = Math.max(0, Math.min(h, y));
                g.lineTo(x, y);
            }
            g.stroke();
            g.fillStyle = color;
            g.beginPath();
            g.arc(x, y, 0.32 * ppm, 0, Math.PI * 2);
            g.fill();
        };
        // Mirrored traces keep both halves identical.
        const save = [];
        for (let i = 0; i < 26; i++) save.push([rng() * w, rng() * h * 0.5, 4 + Math.floor(rng() * 5), i % 2 ? 'rgba(183,255,67,0.34)' : 'rgba(53,217,204,0.34)']);
        for (const [x, y, steps, color] of save) {
            trace(x, y, steps, color);
        }
        g.save();
        g.translate(w, h);
        g.rotate(Math.PI);
        g.drawImage(g.canvas, 0, 0, w, h / 2, 0, 0, w, h / 2);
        g.restore();
    }, { anim: { mode: 'pulse', amp: 0.35, speed: 2.4, freq: 0.08 }, blending: THREE.AdditiveBlending });
}

// --- Volcano ------------------------------------------------------------------------------------
function volcano(ctx) {
    const { halfW, halfL, rng } = ctx;
    const spires = new GeoBatch({ colors: true });
    for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2 + rng() * 0.12;
        const dist = Math.max(halfW, halfL) + 22 + rng() * 24;
        const hgt = 10 + rng() * 22;
        spires.add(new THREE.ConeGeometry(2.4 + rng() * 3, hgt, 6), Math.cos(angle) * dist, hgt / 2 - 0.5, Math.sin(angle) * dist,
            { ry: rng() * 3, rz: (rng() - 0.5) * 0.18, color: i % 3 ? 0x1c1414 : 0x2b1a16 });
    }
    const spireMesh = spires.build(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a0400 }));
    if (spireMesh) ctx.add(spireMesh);

    const smokeTex = canvasTexture(ctx, 64, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, 'rgba(60,40,36,0)');
        grad.addColorStop(0.25, 'rgba(60,40,36,0.55)');
        grad.addColorStop(1, 'rgba(60,40,36,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
    });
    const smoke = new GeoBatch();
    for (const [x, z] of [[-halfW - 30, -halfL - 22], [halfW + 30, halfL + 22], [-halfW - 40, halfL + 10], [halfW + 40, -halfL - 10]]) {
        smoke.add(new THREE.CylinderGeometry(9, 3, 50, 12, 1, true), x, 30, z);
    }
    const smokeMesh = smoke.build(animate(new THREE.MeshBasicMaterial({
        map: smokeTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: smokeTex ? 0xffffff : 0x3c2824, opacity: smokeTex ? 1 : 0.2
    }), ctx, { mode: 'bob', amp: 0.8, speed: 0.4 }));
    if (smokeMesh) ctx.add(smokeMesh);

    courtDecal(ctx, (g, w, h, ppm) => {
        g.lineCap = 'round';
        const crack = (x, y, a, len, width, depth) => {
            if (depth <= 0 || len < 0.5 * ppm) return;
            const x1 = x + Math.cos(a) * len;
            const y1 = y + Math.sin(a) * len;
            g.strokeStyle = `rgba(255,${90 + depth * 20},20,${0.12 + depth * 0.07})`;
            g.lineWidth = width;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
            crack(x1, y1, a + (rng() - 0.5) * 1.1, len * 0.75, width * 0.7, depth - 1);
            if (rng() < 0.45) crack(x1, y1, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len * 0.6, width * 0.6, depth - 1);
        };
        const seeds = [];
        for (let i = 0; i < 9; i++) seeds.push([rng() * w, rng() * h * 0.5, rng() * Math.PI * 2]);
        for (const [x, y, a] of seeds) {
            crack(x, y, a, (3 + rng() * 3) * ppm, 0.4 * ppm, 5);
            crack(w - x, h - y, a + Math.PI, (3 + rng() * 3) * ppm, 0.4 * ppm, 5);
        }
    }, { anim: { mode: 'pulse', amp: 0.4, speed: 1.3, freq: 0.1 }, blending: THREE.AdditiveBlending });
}

// --- Mecha Hangar ---------------------------------------------------------------------------------
function mecha(ctx) {
    const { halfW, halfL, config } = ctx;
    const beacons = instanced(new THREE.SphereGeometry(0.5, 10, 8),
        animate(new THREE.MeshBasicMaterial({ color: 0xffb02e }), ctx, { mode: 'blink', amp: 0.12, speed: 1.1 }),
        [-1, 1].flatMap(sx => [-1, 1].map(sz => ({ x: sx * (halfW - 10), y: 8.5, z: sz * (halfL - 10) }))));
    if (beacons) ctx.decor(beacons, 'warning beacons on the hangar gantry, above head height');

    // Team banners behind each back line (kept out of the mid-court sky so
    // they never hide a high ball).
    const banners = new GeoBatch({ colors: true });
    for (const sz of [-1, 1]) {
        for (const x of [-halfW * 0.3, halfW * 0.3]) {
            banners.add(new THREE.PlaneGeometry(4, 10, 4, 12), x, 14, sz * (halfL + 2), { color: sz < 0 ? config.floorRed : config.floorBlue });
        }
    }
    const bannerMesh = banners.build(animate(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), ctx,
        { mode: 'wave', amp: 0.12, speed: 1.4, freq: 0.3, anchorTop: true }));
    if (bannerMesh) ctx.add(bannerMesh);

    courtDecal(ctx, (g, w, h, ppm) => {
        const cx = x => w / 2 + x * ppm;
        const cz = z => h / 2 + z * ppm;
        // Hazard frames around the four gantry deck footprints.
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const x0 = cx(sx * 30 - 8.6);
            const z0 = cz(sz * 60 - 5.6);
            const bw = 17.2 * ppm;
            const bh = 11.2 * ppm;
            g.strokeStyle = 'rgba(255,196,40,0.34)';
            g.lineWidth = 0.6 * ppm;
            g.setLineDash([1 * ppm, 1 * ppm]);
            g.strokeRect(x0, z0, bw, bh);
            g.setLineDash([]);
        }
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 0.2 * ppm;
        for (const fx of [0.3, 0.7]) { g.beginPath(); g.moveTo(fx * w, 0); g.lineTo(fx * w, h); g.stroke(); }
        stencil(g, 'HANGAR 07', w / 2, h * 0.92, 5 * ppm, 0);
        stencil(g, 'HANGAR 07', w / 2, h * 0.08, 5 * ppm, Math.PI);
    });
}

// --- helpers ----------------------------------------------------------------------------------------
function chevronBand(g, w, y0, band, color) {
    g.save();
    g.beginPath();
    g.rect(0, y0, w, band);
    g.clip();
    g.fillStyle = color;
    for (let x = -band; x < w + band; x += band * 1.4) {
        g.beginPath();
        g.moveTo(x, y0);
        g.lineTo(x + band * 0.7, y0);
        g.lineTo(x + band * 1.4, y0 + band);
        g.lineTo(x + band * 0.7, y0 + band);
        g.fill();
    }
    g.restore();
}

function stencil(g, text, x, y, size, rotation, color = 'rgba(255,255,255,0.16)') {
    g.save();
    g.translate(x, y);
    g.rotate(rotation);
    g.font = `900 ${Math.round(size)}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
}

function meander(g, x, y, w, size, color) {
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, size * 0.14);
    g.beginPath();
    g.moveTo(x, y + size);
    for (let px = x; px + size <= x + w; px += size) {
        g.lineTo(px, y);
        g.lineTo(px + size * 0.75, y);
        g.lineTo(px + size * 0.75, y + size * 0.6);
        g.lineTo(px + size * 0.3, y + size * 0.6);
        g.lineTo(px + size * 0.3, y + size * 0.3);
        g.moveTo(px + size, y + size);
    }
    g.stroke();
}

function compass(g, x, y, r, color) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = r * 0.02;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const len = k % 2 ? r * 0.55 : r * 0.8;
        g.beginPath();
        g.moveTo(Math.cos(a) * len, Math.sin(a) * len);
        g.lineTo(Math.cos(a + 0.35) * r * 0.16, Math.sin(a + 0.35) * r * 0.16);
        g.lineTo(Math.cos(a - 0.35) * r * 0.16, Math.sin(a - 0.35) * r * 0.16);
        g.closePath();
        g.globalAlpha = k % 2 ? 0.6 : 1;
        g.fill();
    }
    g.restore();
}

// Additive light shafts slanting in from above (placed at the court edges).
function addShafts(ctx, spots, color, opacity) {
    const tex = canvasTexture(ctx, 64, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
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
    if (!tex) return;
    const shafts = new GeoBatch();
    for (const [x, z] of spots) shafts.add(new THREE.PlaneGeometry(7, 44), x, 18, z, { rz: Math.sign(x) * 0.36, ry: 0.5 });
    const mesh = shafts.build(new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    if (mesh) ctx.add(mesh);
}

export const POLISH_BUILDERS = Object.freeze({
    beach_open: beachOpen,
    industrial,
    neon,
    grand_stadium: grandStadium,
    pillar,
    circuit_dome: circuitDome,
    volcano,
    mecha
});
