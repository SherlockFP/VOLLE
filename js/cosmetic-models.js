import * as THREE from 'three';
import {
    HEAD_SIZE, HEAD_MESH_LOCAL_Y, HEAD_HALF_DEPTH,
    HIPS_WORLD_Y, HEAD_SOCKET_LOCAL_Y, FACE_SOCKET_LOCAL_Y, FACE_SOCKET_LOCAL_Z
} from './character-rig.js';
import { COSMETICS, normalizeWearableLoadout } from './cosmetic-catalog.js';
import { disposeObject3D } from './weapon-models.js';

// Derived cosmetic anchor positions from rig geometry constants, so future head resizes
// automatically track instead of silently floating gear. All Y values are absolute world positions.
// joints.head = HIPS_WORLD_Y + 0.80, head mesh top = joints.head + HEAD_MESH_LOCAL_Y + HEAD_HALF_DEPTH
const HEAD_SOCKET_WORLD_Y = HIPS_WORLD_Y + 0.80 + HEAD_SOCKET_LOCAL_Y;  // 2.00
const HEAD_MESH_WORLD_Y = HIPS_WORLD_Y + 0.80 + HEAD_MESH_LOCAL_Y;  // 1.75
const HEAD_TOP_WORLD_Y = HEAD_MESH_WORLD_Y + HEAD_HALF_DEPTH;  // 2.00
const FACE_SOCKET_WORLD_Y = HIPS_WORLD_Y + 0.80 + FACE_SOCKET_LOCAL_Y;  // 1.75

export { HEAD_SOCKET_WORLD_Y, HEAD_MESH_WORLD_Y, HEAD_TOP_WORLD_Y, FACE_SOCKET_WORLD_Y };

const material = (color, emissive = color) => new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.16,
    roughness: 0.52,
    metalness: 0.18
});

const basic = color => new THREE.MeshBasicMaterial({ color });
const activeImpacts = new Set();
const part = (geometry, color, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, basic(color));
    mesh.position.set(x, y, z);
    return mesh;
};

// Built only when equipping; flat silhouettes share the same small polygon path.
function polygonGeometry(points, depth = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) shape.lineTo(points[index][0], points[index][1]);
    shape.closePath();
    return depth > 0
        ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 })
        : new THREE.ShapeGeometry(shape);
}

function addEyes(group, y = 0.05, z = 0.19) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const x of [-0.09, 0.09]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.025), eyeMat);
        eye.position.set(x, y, z);
        group.add(eye);
    }
}

function createCape(item) {
    const group = new THREE.Group();
    if (item.style === 'pennants') {
        group.add(part(new THREE.BoxGeometry(0.62, 0.075, 0.065), item.colors[1], 0, 1.5, 0.25));
        const ribbons = [];
        for (const x of [-0.16, 0.16]) {
            const ribbon = new THREE.Mesh(
                polygonGeometry([[-0.14, 0], [0.14, 0], [0.12, -0.82], [0, -0.68], [-0.12, -0.82]]),
                new THREE.MeshStandardMaterial({ color: item.colors[0], roughness: 0.7, side: THREE.DoubleSide })
            );
            ribbon.position.set(x, 1.48, 0.25);
            ribbon.rotation.x = 0.12;
            ribbon.add(part(new THREE.OctahedronGeometry(0.07), item.colors[1], 0, -0.22, 0.025));
            group.add(ribbon);
            ribbons.push(ribbon);
        }
        group.userData.silhouette = 'pennants';
        group.userData.update = time => {
            ribbons[0].rotation.x = 0.12 + Math.sin(time * 3.2) * 0.08;
            ribbons[1].rotation.x = 0.12 - Math.sin(time * 3.2) * 0.08;
        };
        return group;
    }
    const cape = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 1.05, 1, 4),
        new THREE.MeshStandardMaterial({
            color: item.colors[0],
            emissive: item.colors[1],
            emissiveIntensity: 0.18,
            roughness: 0.68,
            side: THREE.DoubleSide
        })
    );
    cape.position.set(0, 1.08, 0.22);
    cape.rotation.x = 0.12;
    group.add(cape);
    const accent = item.colors[1];
    if (item.style === 'pixel' || item.style === 'glitch') {
        for (let index = 0; index < 5; index++) {
            group.add(part(new THREE.BoxGeometry(0.12, 0.12, 0.025), accent,
                -0.25 + (index % 3) * 0.25, 0.72 + Math.floor(index / 3) * 0.26, 0.205));
        }
    } else if (item.style === 'royal') {
        group.add(part(new THREE.TorusGeometry(0.25, 0.035, 6, 18), '#ffd86a', 0, 1.55, 0.2));
        group.add(part(new THREE.OctahedronGeometry(0.1), '#fff0a3', 0, 1.07, 0.2));
    } else if (item.style === 'ember') {
        for (const x of [-0.22, 0, 0.22]) {
            group.add(part(new THREE.ConeGeometry(0.07, 0.22, 5), accent, x, 0.6, 0.2));
        }
    } else if (item.style === 'frost') {
        for (const x of [-0.24, -0.08, 0.08, 0.24]) {
            group.add(part(new THREE.ConeGeometry(0.05, 0.26, 4), accent, x, 0.58, 0.2));
        }
    } else if (item.style === 'void') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 6, 16), basic(accent));
        ring.position.set(0, 0.78, 0.21);
        group.add(ring);
        group.add(part(new THREE.SphereGeometry(0.09, 8, 7), item.colors[0], 0, 0.78, 0.22));
    } else {
        for (const x of [-0.24, 0, 0.24]) {
            group.add(part(new THREE.OctahedronGeometry(0.055), accent, x, 0.64, 0.2));
        }
    }
    group.userData.cape = cape;
    return group;
}

function createPet(item) {
    const group = new THREE.Group();
    const petMat = material(item.colors[0], item.colors[1]);
    if (item.style === 'satellite') {
        group.add(new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.27, 0.25), petMat));
        group.add(part(new THREE.BoxGeometry(0.65, 0.035, 0.035), item.colors[0]));
        const panels = [];
        for (const x of [-0.32, 0.32]) {
            const panel = part(new THREE.BoxGeometry(0.28, 0.25, 0.035), item.colors[1], x, 0, 0);
            for (const cellX of [-0.07, 0.07]) {
                panel.add(part(new THREE.BoxGeometry(0.012, 0.23, 0.008), item.colors[0], cellX, 0, 0.022));
            }
            panel.add(part(new THREE.BoxGeometry(0.26, 0.012, 0.008), item.colors[0], 0, 0, 0.022));
            group.add(panel);
            panels.push(panel);
        }
        group.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.13, 5), item.colors[1], 0, 0.2, 0));
        group.add(part(new THREE.ConeGeometry(0.085, 0.06, 8), item.colors[0], 0, 0.285, 0));
        group.userData.silhouette = 'satellite';
        group.userData.update = time => {
            panels[0].rotation.y = Math.sin(time * 2.2) * 0.16;
            panels[1].rotation.y = -panels[0].rotation.y;
        };
    } else if (item.style === 'drone') {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), petMat));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 20), basic(item.colors[1]));
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
    } else if (item.style === 'snow') {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), petMat));
        group.add(part(new THREE.SphereGeometry(0.14, 9, 7), item.colors[0], 0, 0.25, 0));
        group.add(part(new THREE.ConeGeometry(0.035, 0.14, 6), '#ff8a28', 0, 0.25, 0.18));
    } else {
        group.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.38), petMat));
    }
    addEyes(group, item.style === 'snow' ? 0.28 : 0.04, item.style === 'snow' || item.style === 'satellite' ? 0.13 : 0.2);
    if (['dragon', 'bee'].includes(item.style)) {
        const wingMat = new THREE.MeshBasicMaterial({ color: item.colors[1], transparent: true, opacity: 0.72, side: THREE.DoubleSide });
        for (const x of [-0.27, 0.27]) {
            const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.16), wingMat);
            wing.position.x = x;
            wing.rotation.y = Math.PI / 2;
            group.add(wing);
        }
    }
    if (item.style === 'dragon') {
        group.add(part(new THREE.ConeGeometry(0.06, 0.2, 5), item.colors[1], -0.11, 0.25, -0.05));
        group.add(part(new THREE.ConeGeometry(0.06, 0.2, 5), item.colors[1], 0.11, 0.25, -0.05));
    } else if (item.style === 'bee') {
        for (const x of [-0.12, 0, 0.12]) group.add(part(new THREE.BoxGeometry(0.055, 0.35, 0.39), item.colors[1], x, 0, 0));
    } else if (item.style === 'axolotl') {
        for (const x of [-0.27, 0.27]) {
            group.add(part(new THREE.BoxGeometry(0.12, 0.32, 0.08), item.colors[1], x, 0.05, 0));
        }
    } else if (item.style === 'slime') {
        group.add(part(new THREE.BoxGeometry(0.3, 0.06, 0.05), item.colors[1], 0, -0.19, 0.14));
    }
    group.position.set(0.9, 0.45, 0.15);
    return group;
}

function createShoes(item) {
    const group = new THREE.Group();
    for (const x of [-0.15, 0.15]) {
        if (item.style === 'court_sneakers') {
            group.add(part(new THREE.BoxGeometry(0.27, 0.06, 0.41), item.colors[1], x, 0.03, -0.075));
            group.add(part(new THREE.BoxGeometry(0.26, 0.15, 0.36), item.colors[0], x, 0.125, -0.07));
            group.add(part(new THREE.BoxGeometry(0.26, 0.08, 0.11), '#fff6e5', x, 0.1, -0.225));
            group.add(part(new THREE.BoxGeometry(0.08, 0.12, 0.035), item.colors[1], x, 0.22, 0.125));
            group.add(part(new THREE.BoxGeometry(0.13, 0.12, 0.045), item.colors[1], x, 0.235, -0.035));
            for (const z of [-0.095, -0.165]) {
                group.add(part(new THREE.BoxGeometry(0.18, 0.023, 0.023), '#fff6e5', x, 0.21, z));
            }
            group.userData.silhouette = 'court_sneakers';
            continue;
        }
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), material(item.colors[0], item.colors[1]));
        shoe.position.set(x, 0.03, -0.08);
        group.add(shoe);
        if (item.style === 'cloud') {
            group.add(part(new THREE.SphereGeometry(0.12, 8, 6), '#ffffff', x, -0.05, 0.05));
        } else if (item.style === 'frost' || item.style === 'electric') {
            group.add(part(new THREE.OctahedronGeometry(0.07), item.colors[1], x, 0.19, -0.12));
        } else if (item.style === 'pixel') {
            group.add(part(new THREE.BoxGeometry(0.11, 0.08, 0.11), item.colors[1], x, 0.14, -0.16));
        } else if (item.style === 'ember') {
            group.add(part(new THREE.ConeGeometry(0.05, 0.18, 5), item.colors[1], x, 0.16, -0.24));
            group.add(part(new THREE.ConeGeometry(0.04, 0.12, 5), '#ffd08a', x, 0.24, -0.2));
        } else if (item.style === 'magma') {
            group.add(part(new THREE.BoxGeometry(0.26, 0.07, 0.4), item.colors[1], x, -0.06, -0.08));
            group.add(part(new THREE.OctahedronGeometry(0.05), '#ffb347', x, 0.14, -0.02));
        } else {
            group.add(part(new THREE.ConeGeometry(0.06, 0.2, 6), item.colors[1], x, 0.2, 0.08));
        }
    }
    return group;
}

function createAura(item) {
    const group = new THREE.Group();
    for (let index = 0; index < 3; index++) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.55 + index * 0.12, 0.025, 6, 28),
            new THREE.MeshBasicMaterial({ color: item.colors[index % item.colors.length], transparent: true, opacity: 0.62, depthWrite: false })
        );
        ring.rotation.x = Math.PI / 2 + index * 0.22;
        ring.position.y = 0.4 + index * 0.32;
        group.add(ring);
    }
    const satelliteGeometry = {
        frost: () => new THREE.OctahedronGeometry(0.08),
        hearts: () => new THREE.BoxGeometry(0.1, 0.1, 0.04),
        music: () => new THREE.CapsuleGeometry(0.035, 0.12, 2, 5),
        toxic: () => new THREE.SphereGeometry(0.075, 7, 5),
        void: () => new THREE.IcosahedronGeometry(0.075),
        ember: () => new THREE.ConeGeometry(0.055, 0.16, 6)
    }[item.style] || (() => new THREE.OctahedronGeometry(0.075));
    for (let index = 0; index < 6; index++) {
        const angle = index / 6 * Math.PI * 2;
        group.add(part(satelliteGeometry(), item.colors[index % item.colors.length],
            Math.cos(angle) * 0.72, 0.78 + (index % 2) * 0.18, Math.sin(angle) * 0.72));
    }
    return group;
}

function createHat(item) {
    const group = new THREE.Group();
    const primary = material(item.colors[0], item.colors[1]);
    if (item.style === 'crown') {
        group.add(part(new THREE.CylinderGeometry(0.24, 0.26, 0.16, 8), item.colors[0], 0, 0.1, 0));
        for (let index = 0; index < 5; index++) {
            const angle = index / 5 * Math.PI * 2;
            group.add(part(new THREE.OctahedronGeometry(0.05), item.colors[1], Math.cos(angle) * 0.22, 0.2, Math.sin(angle) * 0.22));
        }
    } else if (item.style === 'halo') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 6, 20), basic(item.colors[0]));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.28;
        group.add(ring);
    } else if (item.style === 'helm') {
        group.add(part(new THREE.BoxGeometry(0.46, 0.3, 0.46), item.colors[0], 0, 0.04, 0));
        group.add(part(new THREE.BoxGeometry(0.08, 0.16, 0.05), item.colors[1], 0, -0.06, -0.22));
    } else if (item.style === 'wizard') {
        group.add(part(new THREE.ConeGeometry(0.26, 0.55, 8), item.colors[0], 0, 0.32, 0));
        group.add(part(new THREE.OctahedronGeometry(0.045), item.colors[1], 0.14, 0.38, 0.05));
    } else if (item.style === 'horns') {
        group.add(part(new THREE.BoxGeometry(0.42, 0.08, 0.1), item.colors[1], 0, 0.06, 0));
        for (const x of [-0.16, 0.16]) group.add(part(new THREE.ConeGeometry(0.06, 0.24, 5), item.colors[0], x, 0.18, 0.02));
    } else if (item.style === 'pixel') {
        for (let index = 0; index < 4; index++) {
            group.add(part(new THREE.BoxGeometry(0.14, 0.14, 0.14), index % 2 ? item.colors[1] : item.colors[0],
                -0.13 + (index % 2) * 0.26, 0.08 + Math.floor(index / 2) * 0.14, 0));
        }
    } else if (item.style === 'beanie') {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.6), primary));
        group.add(part(new THREE.SphereGeometry(0.06, 7, 6), item.colors[1], 0, 0.3, 0));
    } else if (item.style === 'sport_visor' || item.style === 'antennas') {
        // Open square band clears the voxel head; there is no hidden dome/crown.
        const bandWidth = HEAD_SIZE + 0.05;
        for (const z of [-bandWidth / 2, bandWidth / 2]) {
            group.add(part(new THREE.BoxGeometry(bandWidth, 0.09, 0.03), item.colors[1], 0, 0, z));
        }
        for (const x of [-bandWidth / 2, bandWidth / 2]) {
            group.add(part(new THREE.BoxGeometry(0.03, 0.09, bandWidth), item.colors[1], x, 0, 0));
        }
        if (item.style === 'sport_visor') {
            group.add(part(new THREE.CylinderGeometry(0.31, 0.32, 0.045, 8, 1, false, Math.PI / 2, Math.PI), item.colors[0], 0, -0.045, -0.24));
            group.add(part(new THREE.BoxGeometry(0.12, 0.05, 0.025), item.colors[0], 0, 0.005, -0.3));
        } else {
            const stalks = [];
            for (const x of [-0.22, 0.22]) {
                const stalk = new THREE.Group();
                stalk.position.set(x, 0.04, 0);
                stalk.add(part(new THREE.CylinderGeometry(0.018, 0.022, 0.22, 5), item.colors[1], 0, 0.11, 0));
                stalk.add(part(new THREE.SphereGeometry(0.075, 8, 6), item.colors[0], 0, 0.26, 0));
                group.add(stalk);
                stalks.push(stalk);
            }
            group.userData.update = time => {
                stalks[0].rotation.z = Math.sin(time * 3) * 0.12;
                stalks[1].rotation.z = -stalks[0].rotation.z;
            };
        }
        group.userData.silhouette = item.style;
    } else if (item.style === 'cap') {
        // Anchored to the generic dome's space (local y 0), with the brim behind
        // the head so it reads as a backwards cap instead of another plain dome.
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), primary));
        group.add(part(new THREE.BoxGeometry(0.3, 0.045, 0.22), item.colors[1], 0, -0.01, 0.24));
    } else if (item.style === 'headset') {
        // Head-mounted styles use the same local y≈0 baseline as cap. The group
        // itself is moved into the head socket's authored-space offset below.
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.255, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), primary));
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.025, 5, 14, Math.PI), basic(item.colors[1]));
        // The half-ring arches over the head; flipping it sends the band through the face.
        band.position.set(0, 0.015, 0);
        group.add(band);
        for (const x of [-0.275, 0.275]) {
            group.add(part(new THREE.BoxGeometry(0.055, 0.14, 0.2), item.colors[1], x, -0.045, 0));
        }
        group.userData.silhouette = 'sport-headset';
    } else {
        group.add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), primary));
    }
    // Every hat child uses this one head-top origin, including the legacy styles.
    group.position.y = HEAD_TOP_WORLD_Y - 0.04;  // empirically tuned baseline
    return group;
}
function createMask(item) {
    const group = new THREE.Group();
    // Masks sit on the face socket at the head front plane; local -Z faces forward.
    // Relative positions use the face-relative origin (0, 0, 0).
    if (item.style === 'visor') {
        group.add(part(new THREE.BoxGeometry(0.32, 0.09, 0.06), item.colors[0], 0, 0.02, 0));
    } else if (item.style === 'skull') {
        group.add(part(new THREE.BoxGeometry(0.26, 0.24, 0.14), item.colors[0], 0, 0, 0.02));
        for (const x of [-0.07, 0.07]) group.add(part(new THREE.BoxGeometry(0.06, 0.06, 0.04), item.colors[1], x, 0.03, -0.03));
    } else if (item.style === 'ninja') {
        group.add(part(new THREE.BoxGeometry(0.3, 0.2, 0.12), item.colors[0], 0, -0.02, 0));
        group.add(part(new THREE.BoxGeometry(0.32, 0.05, 0.13), item.colors[1], 0, 0.06, 0));
    } else if (item.style === 'glitch') {
        for (let index = 0; index < 3; index++) {
            group.add(part(new THREE.BoxGeometry(0.28 - index * 0.05, 0.05, 0.03), index % 2 ? item.colors[1] : item.colors[0],
                0, 0.08 - index * 0.07, -index * 0.015));
        }
    } else if (item.style === 'ember') {
        group.add(part(new THREE.BoxGeometry(0.32, 0.12, 0.09), item.colors[0], 0, -0.05, 0));
        group.add(part(new THREE.BoxGeometry(0.08, 0.08, 0.06), item.colors[1], 0.17, -0.03, 0.04));
    } else if (item.style === 'frost') {
        group.add(part(new THREE.BoxGeometry(0.3, 0.1, 0.08), item.colors[0], 0, 0.01, 0));
        for (const x of [-0.08, 0.08]) {
            group.add(part(new THREE.ConeGeometry(0.035, 0.12, 4), item.colors[1], x, -0.08, 0));
        }
    } else {
        group.add(part(new THREE.BoxGeometry(0.28, 0.16, 0.1), item.colors[0], 0, 0, 0));
        group.add(part(new THREE.BoxGeometry(0.3, 0.05, 0.1), item.colors[1], 0, 0.08, 0));
    }
    // Supply both coordinates in feet-origin authored space before the socket offset
    // is removed. Leaving Z at zero buries the mask inside the voxel head.
    group.position.y = FACE_SOCKET_WORLD_Y;
    group.position.z = FACE_SOCKET_LOCAL_Z;
    return group;
}

function createWings(item) {
    const group = new THREE.Group();
    const wingMat = new THREE.MeshStandardMaterial({
        color: item.colors[0], emissive: item.colors[1], emissiveIntensity: 0.2, roughness: 0.6, side: THREE.DoubleSide
    });
    if (item.style === 'comet_fins') {
        const fins = [];
        for (const side of [-1, 1]) {
            const fin = new THREE.Mesh(polygonGeometry([
                [0, 0.08], [side * 0.28, 0.4], [side * 0.52, 0.29],
                [side * 0.25, -0.32], [side * 0.04, -0.16]
            ]), wingMat);
            fin.position.set(side * 0.2, 1.38, 0.26);
            fin.rotation.set(0, -side * 0.25, -side * 0.18);
            const inset = part(polygonGeometry([
                [side * 0.1, 0.08], [side * 0.28, 0.3], [side * 0.4, 0.25], [side * 0.2, -0.12]
            ]), item.colors[1], 0, 0, 0.008);
            inset.material.side = THREE.DoubleSide;
            fin.add(inset);
            group.add(fin);
            fins.push(fin);
        }
        group.userData.silhouette = 'comet_fins';
        group.userData.update = time => {
            const flap = Math.sin(time * 3.4) * 0.14;
            fins[0].rotation.y = 0.25 + flap;
            fins[1].rotation.y = -0.25 - flap;
        };
        return group;
    }
    // Dragon shares the membrane cone with bat/demon; its spines are added below.
    const geometry = item.style === 'bat' || item.style === 'demon' || item.style === 'dragon'
        ? new THREE.ConeGeometry(0.4, 0.7, 4, 1, true)
        : new THREE.PlaneGeometry(0.5, 0.7, 1, 3);
    const wingL = new THREE.Mesh(geometry, wingMat);
    wingL.position.set(-0.28, 1.42, 0.24);
    wingL.rotation.set(0, 0.3, 0.35);
    const wingR = new THREE.Mesh(geometry, wingMat);
    wingR.position.set(0.28, 1.42, 0.24);
    wingR.rotation.set(0, -0.3, -0.35);
    group.add(wingL, wingR);
    if (item.style === 'circuit') {
        for (const x of [-0.28, 0.28]) group.add(part(new THREE.BoxGeometry(0.04, 0.5, 0.02), item.colors[1], x, 1.42, 0.26));
    } else if (item.style === 'dragon') {
        for (const x of [-0.28, 0.28]) {
            for (let index = 0; index < 3; index++) {
                group.add(part(new THREE.ConeGeometry(0.04, 0.13, 4), item.colors[1],
                    x + (x < 0 ? -0.06 : 0.06), 1.62 - index * 0.16, 0.24));
            }
        }
    } else if (item.style === 'angel' || item.style === 'paper') {
        for (const x of [-0.28, 0.28]) group.add(part(new THREE.OctahedronGeometry(0.05), item.colors[1], x, 1.7, 0.28));
    }
    group.userData.wingL = wingL;
    group.userData.wingR = wingR;
    group.userData.baseZ = wingL.rotation.z;
    // ponytail: mutate rotation only — no per-frame allocation.
    group.userData.update = time => {
        const flap = Math.sin(time * 5.4) * 0.32;
        wingL.rotation.z = group.userData.baseZ - flap;
        wingR.rotation.z = -group.userData.baseZ + flap;
    };
    return group;
}

function createBackpack(item) {
    const group = new THREE.Group();
    const bodyMat = material(item.colors[0], item.colors[1]);
    if (item.style === 'popcorn') {
        const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.23, 0.4, 4, 1, false, Math.PI / 4), bodyMat);
        tub.position.set(0, 1.17, 0.35);
        group.add(tub);
        group.add(part(new THREE.BoxGeometry(0.45, 0.045, 0.45), item.colors[1], 0, 1.38, 0.35));
        for (const x of [-0.1, 0.1]) {
            const stripe = part(new THREE.BoxGeometry(0.045, 0.35, 0.018), item.colors[1], x, 1.18, 0.54);
            stripe.rotation.x = 0.12;
            group.add(stripe);
        }
        for (const [x, y, z] of [[-0.13, 1.44, 0.36], [0, 1.46, 0.42], [0.13, 1.44, 0.36], [-0.07, 1.5, 0.24], [0.08, 1.5, 0.25]]) {
            group.add(part(new THREE.SphereGeometry(0.085, 7, 5), '#fff6e5', x, y, z));
        }
        group.userData.silhouette = 'popcorn';
    } else if (item.style === 'star_pack') {
        const points = [];
        for (let index = 0; index < 10; index++) {
            const angle = Math.PI / 2 + index * Math.PI / 5;
            const radius = index % 2 ? 0.15 : 0.32;
            points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        }
        const star = new THREE.Mesh(polygonGeometry(points, 0.16), bodyMat);
        star.position.set(0, 1.2, 0.21);
        group.add(star);
        const pocket = part(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 10), item.colors[1], 0, 1.19, 0.39);
        pocket.rotation.x = Math.PI / 2;
        group.add(pocket);
        group.add(part(new THREE.BoxGeometry(0.18, 0.045, 0.065), item.colors[1], 0, 1.51, 0.29));
        const charm = part(new THREE.OctahedronGeometry(0.055), item.colors[1], 0.3, 1.03, 0.31);
        group.add(charm);
        group.userData.silhouette = 'star_pack';
        group.userData.update = time => {
            charm.position.y = 1.03 + Math.sin(time * 2.8) * 0.035;
            charm.rotation.z = Math.sin(time * 2.8) * 0.25;
        };
    } else if (item.style === 'jetpack' || item.style === 'rocket') {
        for (const x of [-0.14, 0.14]) {
            group.add(part(new THREE.CylinderGeometry(0.09, 0.1, 0.5, 8), item.colors[0], x, 1.25, 0.26));
            group.add(part(new THREE.ConeGeometry(0.09, 0.14, 8), item.colors[1], x, 0.96, 0.26));
        }
    } else if (item.style === 'battery') {
        group.add(part(new THREE.BoxGeometry(0.36, 0.5, 0.22), item.colors[0], 0, 1.24, 0.26));
        group.add(part(new THREE.BoxGeometry(0.38, 0.08, 0.23), item.colors[1], 0, 1.24, 0.26));
    } else if (item.style === 'balloon') {
        for (const x of [-0.16, 0, 0.16]) {
            group.add(part(new THREE.SphereGeometry(0.13, 8, 7), x === 0 ? item.colors[1] : item.colors[0], x, 1.55 + (x === 0 ? 0.08 : 0), 0.28));
        }
    } else if (item.style === 'supplies') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.46, 0.24), bodyMat);
        body.position.set(0, 1.2, 0.26);
        group.add(body);
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), material(item.colors[1], item.colors[1]));
        roll.rotation.z = Math.PI / 2;
        roll.position.set(0, 1.46, 0.26);
        group.add(roll);
        for (const x of [-0.13, 0.13]) {
            group.add(part(new THREE.BoxGeometry(0.05, 0.46, 0.26), item.colors[1], x, 1.2, 0.27));
        }
    } else if (item.style === 'court_bag') {
        // A low-poly duffel instead of another rectangular tech pack: one body,
        // end caps, a front pocket, and a broad court-ready carry strap.
        group.add(part(new THREE.BoxGeometry(0.48, 0.34, 0.28), item.colors[0], 0, 1.18, 0.28));
        for (const x of [-0.25, 0.25]) {
            const endCap = part(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 8), item.colors[1], x, 1.18, 0.28);
            endCap.rotation.z = Math.PI / 2;
            group.add(endCap);
        }
        group.add(part(new THREE.BoxGeometry(0.24, 0.16, 0.035), item.colors[1], 0, 1.14, 0.438));
        group.add(part(new THREE.BoxGeometry(0.30, 0.055, 0.04), item.colors[1], 0, 1.4, 0.28));
        group.userData.silhouette = 'court-bag';
    } else {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.24), bodyMat);
        body.position.set(0, 1.2, 0.26);
        group.add(body);
        group.add(part(new THREE.BoxGeometry(0.42, 0.1, 0.25), item.colors[1], 0, 1.42, 0.26));
    }
    return group;
}

function createBanner(item) {
    const group = new THREE.Group();
    const pole = part(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), '#7a6a52', 0, 1.55, 0.28);
    group.add(pole);
    const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.44, 3, 3),
        new THREE.MeshStandardMaterial({ color: item.colors[0], emissive: item.colors[1], emissiveIntensity: 0.16, roughness: 0.7, side: THREE.DoubleSide })
    );
    flag.position.set(0.19, 1.86, 0.28);
    group.add(flag);
    if (item.style === 'champion') {
        group.add(part(new THREE.OctahedronGeometry(0.06), item.colors[1], 0, 2.12, 0.28));
    } else if (item.style === 'skull') {
        group.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.06), item.colors[1], 0.19, 1.86, 0.32));
    } else if (item.style === 'flame') {
        for (let index = 0; index < 3; index++) {
            group.add(part(new THREE.ConeGeometry(0.045, 0.15, 5), item.colors[1],
                0.34, 1.72 + index * 0.14, 0.28));
        }
    } else if (item.style === 'guild') {
        group.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), item.colors[1], 0.19, 2.06, 0.28));
        group.add(part(new THREE.OctahedronGeometry(0.07), item.colors[1], 0.19, 1.86, 0.32));
    }
    group.userData.flag = flag;
    return group;
}

function createTrail(item) {
    const group = new THREE.Group();
    const segments = [];
    // ponytail: two geometry shapes cover all 6 trail styles — box for pixel, octahedron otherwise.
    const geometry = item.style === 'pixel' ? new THREE.BoxGeometry(0.1, 0.1, 0.1) : new THREE.OctahedronGeometry(0.08);
    for (let index = 0; index < 5; index++) {
        const mat = new THREE.MeshBasicMaterial({
            color: item.colors[index % item.colors.length], transparent: true, opacity: 1 - index * 0.18
        });
        const segment = new THREE.Mesh(geometry, mat);
        segment.position.set(0, 0.06, 0.2 + index * 0.16);
        segment.scale.setScalar(1 - index * 0.12);
        segments.push(segment);
        group.add(segment);
    }
    group.userData.segments = segments;
    // ponytail: opacity/scale pulse only, geometry/material reused — allocation-free per frame.
    group.userData.update = time => {
        for (let index = 0; index < segments.length; index++) {
            const phase = time * 3 - index * 0.5;
            segments[index].position.y = 0.06 + Math.max(0, Math.sin(phase)) * 0.05;
            segments[index].material.opacity = Math.max(0, (1 - index * 0.18) * (0.6 + 0.4 * Math.sin(phase + 1)));
        }
    };
    return group;
}

function createGloves(item) {
    const group = new THREE.Group();
    // Gloves attach to both handL and handR sockets, so we create one per hand below
    // and let attachToRig handle duplicating this group's structure for each hand.
    // For now, create a single left glove in local space; attachToRig will mirror it.
    if (item.style === 'kinetic') {
        group.add(part(new THREE.BoxGeometry(0.17, 0.22, 0.18), item.colors[0], 0, -0.11, 0));
        group.add(part(new THREE.BoxGeometry(0.19, 0.055, 0.205), item.colors[1], 0, 0.025, 0));
        for (const x of [-0.06, 0, 0.06]) {
            group.add(part(new THREE.BoxGeometry(0.042, 0.035, 0.025), item.colors[1], x, -0.08, -0.1));
        }
    } else if (item.style === 'prism') {
        group.add(part(new THREE.BoxGeometry(0.17, 0.22, 0.18), item.colors[0], 0, -0.11, 0));
        for (const x of [-0.065, 0, 0.065]) {
            const plate = part(new THREE.OctahedronGeometry(0.043), item.colors[1], x, -0.08, -0.11);
            plate.scale.set(1, .65, .45);
            group.add(plate);
        }
    } else if (item.style === 'royal') {
        group.add(part(new THREE.BoxGeometry(0.18, 0.23, 0.19), item.colors[0], 0, -0.115, 0));
        group.add(part(new THREE.BoxGeometry(0.20, 0.06, 0.21), item.colors[1], 0, 0.025, 0));
        for (const x of [-0.07, -0.023, 0.023, 0.07]) {
            group.add(part(new THREE.BoxGeometry(0.034, 0.045, 0.03), item.colors[1], x, -0.075, -0.105));
        }
    } else if (item.style === 'leather') {
        group.add(part(new THREE.BoxGeometry(0.16, 0.22, 0.18), item.colors[0], 0, -0.11, 0));
        group.add(part(new THREE.BoxGeometry(0.18, 0.06, 0.2), item.colors[1], 0, 0.03, 0));
    } else if (item.style === 'metal') {
        group.add(part(new THREE.BoxGeometry(0.18, 0.24, 0.2), item.colors[0], 0, -0.12, 0));
        group.add(part(new THREE.OctahedronGeometry(0.05), item.colors[1], -0.08, -0.04, 0.11));
        group.add(part(new THREE.OctahedronGeometry(0.05), item.colors[1], 0.08, -0.04, 0.11));
    } else if (item.style === 'frost') {
        group.add(part(new THREE.BoxGeometry(0.16, 0.22, 0.18), item.colors[0], 0, -0.11, 0));
        for (const y of [-0.18, -0.06, 0.06]) {
            group.add(part(new THREE.ConeGeometry(0.03, 0.08, 4), item.colors[1], 0, y, 0.1));
        }
    } else {
        group.add(part(new THREE.BoxGeometry(0.16, 0.2, 0.16), item.colors[0], 0, -0.1, 0));
    }
    return group;
}

function createShinGuards(item) {
    const group = new THREE.Group();
    // Like gloves, shin guards attach to footL/footR sockets.
    // Create a single guard in local space, attached at the foot socket position.
    if (item.style === 'leather') {
        group.add(part(new THREE.BoxGeometry(0.2, 0.24, 0.16), item.colors[0], 0, -0.12, 0));
        group.add(part(new THREE.BoxGeometry(0.22, 0.05, 0.18), item.colors[1], 0, 0.04, 0));
    } else if (item.style === 'metal') {
        group.add(part(new THREE.BoxGeometry(0.22, 0.28, 0.18), item.colors[0], 0, -0.14, 0));
        for (const x of [-0.11, 0.11]) {
            group.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), item.colors[1], x, -0.12, 0));
        }
    } else if (item.style === 'frost') {
        group.add(part(new THREE.BoxGeometry(0.2, 0.24, 0.16), item.colors[0], 0, -0.12, 0));
        for (const y of [-0.18, -0.06, 0.06]) {
            group.add(part(new THREE.ConeGeometry(0.04, 0.12, 4), item.colors[1], 0, y, 0.09));
        }
    } else {
        group.add(part(new THREE.BoxGeometry(0.2, 0.22, 0.16), item.colors[0], 0, -0.11, 0));
    }
    return group;
}

const createSlot = item => ({
    cape: createCape,
    pet: createPet,
    shoes: createShoes,
    aura: createAura,
    hat: createHat,
    mask: createMask,
    wings: createWings,
    backpack: createBackpack,
    banner: createBanner,
    trail: createTrail,
    gloves: createGloves,
    shin_guards: createShinGuards
}[item.type]?.(item) || null);

const WEARABLE_SLOT_TYPES = ['cape', 'pet', 'shoes', 'aura', 'hat', 'mask', 'wings', 'backpack', 'banner', 'trail', 'gloves', 'shin_guards'];


// Cosmetic type → rig socket name (character-rig.js RIG_SOCKETS), per WARBALL_IO_PLAN.md
// section 3 item 5. Types not listed here (e.g. pet) keep the legacy cosmeticsRoot parenting.
// Pet specifically: both cosmeticsRoot (entity.group at feet) and aura socket (rig.root +0.9Y) are
// root-relative, so migrating pet between them changes no visible behavior. To make a pet follow body
// motion (swing during strafing/lean), it would attach to waist or back socket. For now, keep pet on
// cosmeticsRoot for simplicity — there is no behavioral cost and no visible difference.
const RIG_SOCKET_BY_TYPE = Object.freeze({
    hat: 'head',
    mask: 'face',
    cape: 'back',
    wings: 'back',
    backpack: 'back',
    banner: 'back',
    aura: 'aura',
    trail: 'trail',
    waist: 'waist'
});

// Authored cosmetic models assume a flat parent (entity.group, origin at the
// feet). A rig socket sits somewhere else in that same local space, so we
// compute its current local offset and subtract it — the model lands in the
// exact spot it always has, but now rides the socket (and its animation).
function socketLocalOffset(entity, socket, out) {
    entity.group.updateMatrixWorld(true);
    socket.getWorldPosition(out);
    return entity.group.worldToLocal(out);
}

// Returns the list of objects actually inserted into the rig (for disposal/update
// tracking), or null if this entity/type isn't rig-socketed — caller falls back
// to the legacy cosmeticsRoot parenting.
function attachToRig(entity, model, type) {
    const rig = entity.rig;
    if (!rig) return null;
    const offset = new THREE.Vector3();
    if (type === 'shoes') {
        const { footL, footR } = rig.sockets;
        if (!footL || !footR) return null;
        const attached = [...model.children];
        for (const child of attached) {
            const socket = child.position.x < 0 ? footL : footR;
            child.position.sub(socketLocalOffset(entity, socket, offset));
            socket.add(child);
        }
        return attached;
    }
    if (type === 'gloves') {
        const { handL, handR } = rig.sockets;
        if (!handL || !handR) return null;
        // Gloves are authored in hand-local space, unlike the feet-origin models.
        // Subtracting the socket offset here placed both gloves at the player's feet.
        const rightClone = model.clone(true);
        const leftClone = model;
        handL.add(leftClone);
        // Mirror the right glove by negating x positions of children
        for (const child of rightClone.children) {
            child.position.x = -child.position.x;
            if (child instanceof THREE.Mesh && child.geometry) child.geometry = child.geometry.clone();
            if (child instanceof THREE.Mesh && child.material) child.material = child.material.clone();
        }
        handR.add(rightClone);
        return [leftClone, rightClone];
    }
    if (type === 'shin_guards') {
        const { footL, footR } = rig.sockets;
        if (!footL || !footR) return null;
        // Like gloves, create left and mirrored right
        const leftClone = model;
        leftClone.position.sub(socketLocalOffset(entity, footL, offset));
        footL.add(leftClone);
        const rightClone = new THREE.Group();
        rightClone.copy(model, false);
        rightClone.position.sub(socketLocalOffset(entity, footR, offset));
        for (const child of rightClone.children) {
            child.position.x = -child.position.x;
            if (child instanceof THREE.Mesh && child.geometry) child.geometry = child.geometry.clone();
            if (child instanceof THREE.Mesh && child.material) child.material = child.material.clone();
        }
        footR.add(rightClone);
        return [leftClone, rightClone];
    }
    const socket = rig.sockets[RIG_SOCKET_BY_TYPE[type]];
    if (!socket) return null;
    model.position.sub(socketLocalOffset(entity, socket, offset));
    socket.add(model);
    return [model];
}

export function applyEntityCosmetics(entity, value) {
    if (!entity?.group) return null;
    const loadout = normalizeWearableLoadout(value);
    if (entity.wearableLoadout
        && Object.keys(loadout).every(type => entity.wearableLoadout[type] === loadout[type])) return loadout;
    if (!entity.cosmeticsRoot) {
        entity.cosmeticsRoot = new THREE.Group();
        entity.cosmeticsRoot.name = 'cosmetics-root';
        entity.group.add(entity.cosmeticsRoot);
    }
    for (const child of [...entity.cosmeticsRoot.children]) {
        entity.cosmeticsRoot.remove(child);
        disposeObject3D(child);
    }
    for (const model of entity._rigCosmetics || []) {
        model.parent?.remove(model);
        disposeObject3D(model);
    }
    entity._rigCosmetics = [];
    for (const type of WEARABLE_SLOT_TYPES) {
        const item = COSMETICS[loadout[type]];
        const model = item && createSlot(item);
        if (!model) continue;
        model.name = `cosmetic-${type}`;
        model.userData.cosmeticType = type;
        const attached = entity.rig ? attachToRig(entity, model, type) : null;
        if (attached) entity._rigCosmetics.push(...attached);
        else entity.cosmeticsRoot.add(model);
    }
    entity.wearableLoadout = loadout;
    return loadout;
}

export function updateEntityCosmetics(entity, timeSeconds) {
    const root = entity?.cosmeticsRoot;
    if (!root) return;
    const rigged = entity._rigCosmetics || [];
    const find = name => root.getObjectByName(name) || rigged.find(child => child.name === name);
    const pet = find('cosmetic-pet');
    if (pet) {
        pet.position.y = 0.45 + Math.sin(timeSeconds * 3.2) * 0.08;
        pet.rotation.y = -timeSeconds * 0.8;
    }
    const aura = find('cosmetic-aura');
    if (aura) aura.rotation.y = timeSeconds * 0.9;
    const cape = find('cosmetic-cape')?.userData.cape;
    if (cape) cape.rotation.x = 0.12 + Math.sin(timeSeconds * 4.5) * 0.06;
    // ponytail: generic hook for wings/trail (and any future animated slot) — no per-child name lookups needed.
    for (const child of root.children) child.userData.update?.(timeSeconds);
    for (const child of rigged) child.userData.update?.(timeSeconds);
}

export function spawnImpactCosmetic(scene, id, position) {
    const item = COSMETICS[id];
    if (!scene || item?.type !== 'impact' || !position) return null;
    const group = new THREE.Group();
    group.position.copy(position);
    for (let index = 0; index < 10; index++) {
        const geometry = ['pixel', 'glitch', 'confetti'].includes(item.style)
            ? new THREE.BoxGeometry(0.08, 0.08, 0.08)
            : item.style === 'ember'
                ? new THREE.ConeGeometry(0.05, 0.14, 6)
                : new THREE.OctahedronGeometry(0.07);
        const particle = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: item.colors[index % item.colors.length], transparent: true })
        );
        const angle = index / 10 * Math.PI * 2;
        particle.userData.velocity = new THREE.Vector3(Math.cos(angle), 0.35 + (index % 3) * 0.18, Math.sin(angle)).multiplyScalar(2.2);
        group.add(particle);
    }
    if (activeImpacts.size >= 12) {
        const oldest = activeImpacts.values().next().value;
        oldest.parent?.remove(oldest);
        disposeObject3D(oldest);
        activeImpacts.delete(oldest);
    }
    scene.add(group);
    activeImpacts.add(group);
    const started = performance.now();
    const tick = now => {
        const dt = Math.min(0.04, (now - (group.userData.last || started)) / 1000);
        group.userData.last = now;
        const age = (now - started) / 650;
        for (const particle of group.children) {
            particle.position.addScaledVector(particle.userData.velocity, dt);
            particle.userData.velocity.y -= 4 * dt;
            particle.material.opacity = Math.max(0, 1 - age);
        }
        if (age < 1) requestAnimationFrame(tick);
        else {
            scene.remove(group);
            disposeObject3D(group);
            activeImpacts.delete(group);
        }
    };
    requestAnimationFrame(tick);
    return group;
}

// Per-style particle shape for the elimination burst below.
const FINISHER_GEOMETRY = {
    confetti: () => new THREE.BoxGeometry(0.08, 0.08, 0.02),
    shatter: () => new THREE.OctahedronGeometry(0.08),
    lightning: () => new THREE.ConeGeometry(0.05, 0.2, 4),
    vortex: () => new THREE.OctahedronGeometry(0.07),
    explosion: () => new THREE.ConeGeometry(0.06, 0.18, 6)
};

// ponytail: same burst engine as spawnImpactCosmetic, just bigger/longer for an elimination moment.
export function spawnFinisherCosmetic(scene, id, position) {
    const item = COSMETICS[id];
    if (!scene || item?.type !== 'finisher' || !position) return null;
    const group = new THREE.Group();
    group.position.copy(position);
    const geometry = (FINISHER_GEOMETRY[item.style] || FINISHER_GEOMETRY.explosion)();
    for (let index = 0; index < 18; index++) {
        const particle = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: item.colors[index % item.colors.length], transparent: true })
        );
        const angle = index / 18 * Math.PI * 2;
        particle.userData.velocity = new THREE.Vector3(Math.cos(angle), 0.5 + (index % 4) * 0.22, Math.sin(angle)).multiplyScalar(3.4);
        group.add(particle);
    }
    if (activeImpacts.size >= 12) {
        const oldest = activeImpacts.values().next().value;
        oldest.parent?.remove(oldest);
        disposeObject3D(oldest);
        activeImpacts.delete(oldest);
    }
    scene.add(group);
    activeImpacts.add(group);
    const started = performance.now();
    const tick = now => {
        const dt = Math.min(0.04, (now - (group.userData.last || started)) / 1000);
        group.userData.last = now;
        const age = (now - started) / 1100;
        for (const particle of group.children) {
            particle.position.addScaledVector(particle.userData.velocity, dt);
            particle.userData.velocity.y -= 3.6 * dt;
            particle.material.opacity = Math.max(0, 1 - age);
        }
        if (age < 1) requestAnimationFrame(tick);
        else {
            scene.remove(group);
            disposeObject3D(group);
            activeImpacts.delete(group);
        }
    };
    requestAnimationFrame(tick);
    return group;
}
