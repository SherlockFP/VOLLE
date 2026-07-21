import * as THREE from 'three';
import { COSMETICS, normalizeWearableLoadout } from './cosmetic-catalog.js';
import { disposeObject3D } from './weapon-models.js';

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
    if (item.style === 'drone') {
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
    addEyes(group, item.style === 'snow' ? 0.28 : 0.04, item.style === 'snow' ? 0.13 : 0.2);
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
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.38), material(item.colors[0], item.colors[1]));
        shoe.position.set(x, 0.03, -0.08);
        group.add(shoe);
        if (item.style === 'cloud') {
            group.add(part(new THREE.SphereGeometry(0.12, 8, 6), '#ffffff', x, -0.05, 0.05));
        } else if (item.style === 'frost' || item.style === 'electric') {
            group.add(part(new THREE.OctahedronGeometry(0.07), item.colors[1], x, 0.19, -0.12));
        } else if (item.style === 'pixel') {
            group.add(part(new THREE.BoxGeometry(0.11, 0.08, 0.11), item.colors[1], x, 0.14, -0.16));
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

const createSlot = item => ({
    cape: createCape,
    pet: createPet,
    shoes: createShoes,
    aura: createAura
}[item.type]?.(item) || null);

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
    for (const type of ['cape', 'pet', 'shoes', 'aura']) {
        const item = COSMETICS[loadout[type]];
        const model = item && createSlot(item);
        if (!model) continue;
        model.name = `cosmetic-${type}`;
        model.userData.cosmeticType = type;
        entity.cosmeticsRoot.add(model);
    }
    entity.wearableLoadout = loadout;
    return loadout;
}

export function updateEntityCosmetics(entity, timeSeconds) {
    const root = entity?.cosmeticsRoot;
    if (!root) return;
    const pet = root.getObjectByName('cosmetic-pet');
    if (pet) {
        pet.position.y = 0.45 + Math.sin(timeSeconds * 3.2) * 0.08;
        pet.rotation.y = -timeSeconds * 0.8;
    }
    const aura = root.getObjectByName('cosmetic-aura');
    if (aura) aura.rotation.y = timeSeconds * 0.9;
    const cape = root.getObjectByName('cosmetic-cape')?.userData.cape;
    if (cape) cape.rotation.x = 0.12 + Math.sin(timeSeconds * 4.5) * 0.06;
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
