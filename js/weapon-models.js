import * as THREE from 'three';

function mat(color, metalness = 0.2, roughness = 0.55, emissive = 0x000000) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive });
}

function finishMaterials(style) {
    const color = new THREE.Color(style.color || '#d7f3ff');
    const accentColor = new THREE.Color(style.accent || style.color || '#4e7d99');
    const finish = style.finish || 'satin';
    const wear = Math.max(0, Math.min(1, Number(style.wear) || 0));
    const energetic = ['ember', 'frost', 'reactor', 'aurora'].includes(finish);
    const spectral = ['prism', 'aurora', 'sunset'].includes(finish);
    const blade = new THREE.MeshPhysicalMaterial({
        color,
        metalness: Math.max(0.58, 0.94 - wear * 0.28),
        roughness: Math.min(0.72, 0.16 + wear * 0.45),
        clearcoat: 0.72,
        clearcoatRoughness: 0.12 + wear * 0.3,
        iridescence: spectral ? 0.85 : 0,
        iridescenceIOR: 1.7,
        emissive: energetic ? color.clone().multiplyScalar(0.11) : color.clone().multiplyScalar(0.025),
        emissiveIntensity: energetic ? 1.35 : 0.55
    });
    const edge = new THREE.MeshPhysicalMaterial({
        color: accentColor,
        metalness: 0.9,
        roughness: Math.min(0.62, 0.12 + wear * 0.42),
        clearcoat: 0.9,
        emissive: energetic ? accentColor.clone().multiplyScalar(0.15) : accentColor.clone().multiplyScalar(0.035),
        emissiveIntensity: energetic ? 1.5 : 0.6
    });
    return {
        blade,
        edge,
        dark: mat(0x111820, 0.66, 0.3 + wear * 0.2),
        grip: mat(style.grip || 0x202a32, 0.38, 0.64),
        finish,
        accentColor
    };
}

function bladeGeometry(length, width, profile = 'drop') {
    const shape = new THREE.Shape();
    const shoulder = profile === 'bayonet' ? 0.42 : 0.22;
    const tipBack = profile === 'bayonet' ? 0.9 : 0.76;
    shape.moveTo(-width * 0.5, 0);
    shape.lineTo(-width * 0.48, length * shoulder);
    shape.lineTo(-width * 0.24, length * tipBack);
    shape.lineTo(0, length);
    shape.lineTo(width * 0.48, length * (profile === 'bayonet' ? 0.78 : 0.66));
    shape.lineTo(width * 0.52, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.028, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2 });
    geometry.translate(0, 0, -0.014);
    geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

function addBlade(parent, materials, { length = 0.52, width = 0.14, profile = 'drop', z = 0 } = {}) {
    const blade = new THREE.Mesh(bladeGeometry(length, width, profile), materials.blade);
    blade.position.z = z;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.009, length * 0.62), materials.edge);
    edge.position.set(width * 0.09, -0.019, z - length * 0.43);
    edge.rotation.y = profile === 'bayonet' ? -0.045 : -0.08;
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(width * 0.32, 0.008, length * 0.5), materials.dark);
    fuller.position.set(-width * 0.12, 0.019, z - length * 0.38);
    fuller.rotation.y = 0.035;
    parent.add(blade, edge, fuller);
    return blade;
}

function addGripRibs(parent, material, z, count = 5, spread = 0.24) {
    for (let index = 0; index < count; index++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.061, 0.009, 5, 10), material);
        rib.rotation.x = Math.PI / 2;
        rib.position.z = z + (index / Math.max(1, count - 1) - 0.5) * spread;
        parent.add(rib);
    }
}

function saveInspectBase(part) {
    part.userData.inspectBase = {
        x: part.rotation.x,
        y: part.rotation.y,
        z: part.rotation.z
    };
    return part;
}

function addCombatKnife(group, materials, bayonet = false) {
    addBlade(group, materials, { length: bayonet ? 0.62 : 0.54, width: bayonet ? 0.125 : 0.16, profile: bayonet ? 'bayonet' : 'drop', z: 0.015 });
    const guard = new THREE.Mesh(new THREE.BoxGeometry(bayonet ? 0.22 : 0.24, 0.055, 0.07), materials.edge);
    guard.position.z = 0.04;
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.25, 4, 10), materials.grip);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.22;
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.065, 10), materials.dark);
    pommel.rotation.x = Math.PI / 2;
    pommel.position.z = 0.39;
    group.add(guard, handle, pommel);
    addGripRibs(group, materials.edge, 0.22, bayonet ? 6 : 5, 0.23);
    if (bayonet) {
        const guardRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), materials.edge);
        guardRing.rotation.x = Math.PI / 2;
        guardRing.position.set(-0.1, 0, 0.035);
        group.add(guardRing);
    }
}

function addKarambit(group, materials) {
    const claw = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.046, 8, 32, Math.PI * 1.24), materials.blade);
    outer.rotation.set(Math.PI / 2, 0.1, -0.62);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.012, 5, 32, Math.PI * 1.12), materials.edge);
    edge.rotation.copy(outer.rotation);
    edge.position.y = -0.042;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.047, 0.17, 8), materials.blade);
    point.rotation.set(-Math.PI / 2, 0, -0.7);
    point.position.set(-0.17, 0, -0.24);
    claw.add(outer, edge, point);
    claw.position.set(0.02, 0, -0.22);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.23, 4, 10), materials.grip);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.16;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.02, 8, 18), materials.edge);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.36;
    group.add(saveInspectBase(claw), handle, ring);
    addGripRibs(group, materials.dark, 0.16, 5, 0.21);
    group.userData.inspectParts = [claw];
}

function addButterfly(group, materials) {
    const bladeRoot = new THREE.Group();
    addBlade(bladeRoot, materials, { length: 0.5, width: 0.13, profile: 'bayonet', z: 0.01 });
    const left = new THREE.Group();
    const right = new THREE.Group();
    for (const [side, holder] of [[-1, left], [1, right]]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), materials.grip);
        rail.position.set(side * 0.075, 0, 0.2);
        holder.add(rail);
        for (let index = 0; index < 3; index++) {
            const cutout = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.008, 5, 10), materials.edge);
            cutout.rotation.x = Math.PI / 2;
            cutout.position.set(side * 0.075, -0.034, 0.09 + index * 0.1);
            holder.add(cutout);
        }
    }
    left.rotation.z = -0.08;
    right.rotation.z = 0.08;
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 12), materials.edge);
    pivot.rotation.z = Math.PI / 2;
    pivot.position.z = 0.035;
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.038, 0.07), materials.dark);
    latch.position.z = 0.39;
    group.add(saveInspectBase(bladeRoot), saveInspectBase(left), saveInspectBase(right), pivot, latch);
    group.userData.inspectParts = [left, right, bladeRoot];
}

export function createKnifeModel(style = {}) {
    const group = new THREE.Group();
    const materials = finishMaterials(style);
    const model = ['classic', 'bayonet', 'karambit', 'butterfly'].includes(style.model) ? style.model : 'classic';
    if (model === 'karambit') addKarambit(group, materials);
    else if (model === 'butterfly') addButterfly(group, materials);
    else addCombatKnife(group, materials, model === 'bayonet');

    const seed = Math.abs(Math.trunc(Number(style.patternSeed) || 0));
    if (materials.finish !== 'satin') {
        for (let index = 0; index < 3; index++) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.008, 0.2), index % 2 ? materials.edge : materials.blade);
            band.position.set(((seed + index * 7) % 11 - 5) * 0.008, 0.026, -0.11 - index * 0.1);
            band.rotation.y = ((seed + index * 13) % 17 - 8) * 0.025;
            group.add(band);
        }
    }
    group.userData.weaponType = 'knife';
    group.userData.model = model;
    group.userData.finish = materials.finish;
    return group;
}

export function createKnucklesModel(team = 'red') {
    const group = new THREE.Group();
    const teamColor = team === 'red' ? 0xe94b55 : 0x3f8fff;
    const metal = mat(teamColor, 0.8, 0.22, new THREE.Color(teamColor).multiplyScalar(0.05));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.07, 0.1), metal);
    grip.position.set(0, -0.045, 0.02);
    group.add(grip);
    for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.014, 6, 12), metal);
        ring.rotation.x = Math.PI / 2;
        ring.position.set((i - 1.5) * 0.055, 0.025, -0.05);
        group.add(ring);
    }
    group.userData.weaponType = 'knuckles';
    return group;
}

export function createRocketLauncherModel(team = 'red') {
    const group = new THREE.Group();
    const teamColor = team === 'red' ? 0xb52f38 : 0x2869b8;
    const barrelMat = mat(0x30373c, 0.72, 0.34);
    const bodyMat = mat(teamColor, 0.58, 0.38);
    const accentMat = mat(0xe6aa45, 0.7, 0.28, 0x241400);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.82, 12), barrelMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -0.18;
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.3, 12), bodyMat);
    jacket.rotation.x = Math.PI / 2;
    jacket.position.z = -0.05;
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 16), accentMat);
    muzzle.position.z = -0.6;
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.16, 12), bodyMat);
    rear.rotation.x = Math.PI / 2;
    rear.position.z = 0.3;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.12), barrelMat);
    grip.position.set(0, -0.18, 0.02);
    grip.rotation.x = -0.2;
    group.add(tube, jacket, muzzle, rear, grip);
    group.userData.weaponType = 'rocket';
    return group;
}

export function createRocketProjectileModel(team = 'red') {
    const group = new THREE.Group();
    const bodyMat = mat(team === 'red' ? 0xd94747 : 0x3f7ed8, 0.48, 0.35);
    const noseMat = mat(0xd8dde3, 0.8, 0.22);
    const finMat = mat(0x24292e, 0.55, 0.4);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.48, 10), bodyMat);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 10), noseMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.32;
    group.add(body, nose);
    for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.16), finMat);
        const angle = i * Math.PI / 2;
        fin.position.set(Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, 0.2);
        fin.rotation.z = angle;
        group.add(fin);
    }
    const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.28, 8),
        new THREE.MeshBasicMaterial({ color: 0xffb132, transparent: true, opacity: 0.88 })
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 0.38;
    group.add(flame);
    group.userData.flame = flame;
    return group;
}

export function disposeObject3D(object) {
    object?.traverse(child => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.());
        else child.material?.dispose?.();
    });
    object?.removeFromParent?.();
}
