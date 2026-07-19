import * as THREE from 'three';

function mat(color, metalness = 0.2, roughness = 0.55, emissive = 0x000000) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive });
}

export function createKnifeModel(style = {}) {
    const group = new THREE.Group();
    const color = new THREE.Color(style.color || '#d7f3ff');
    const accentColor = new THREE.Color(style.accent || style.color || '#4e7d99');
    const bladeMat = mat(color, 0.88, 0.2, color.clone().multiplyScalar(0.06));
    const dark = mat(0x101820, 0.6, 0.32);
    const accent = mat(accentColor, 0.72, 0.24, accentColor.clone().multiplyScalar(0.04));
    const model = style.model || 'classic';

    const addClassicBlade = (parent, scale = 1) => {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11 * scale, 0.028 * scale, 0.38 * scale), bladeMat);
        blade.position.z = -0.2 * scale;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.118 * scale, 0.01 * scale, 0.32 * scale), accent);
        edge.position.set(0, -0.018 * scale, -0.24 * scale);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.062 * scale, 0.16 * scale, 4), bladeMat);
        tip.rotation.x = -Math.PI / 2;
        tip.rotation.z = Math.PI / 4;
        tip.position.z = -0.47 * scale;
        parent.add(blade, edge, tip);
    };

    if (model === 'karambit') {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.033, 6, 20, Math.PI * 1.35), bladeMat);
        arc.rotation.set(Math.PI / 2, 0.18, -0.54);
        arc.position.set(0.015, 0.01, -0.2);
        const edge = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.009, 5, 20, Math.PI * 1.16), accent);
        edge.rotation.copy(arc.rotation);
        edge.position.set(0.015, -0.025, -0.2);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.27, 8), dark);
        grip.rotation.x = Math.PI / 2;
        grip.position.z = 0.13;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.017, 6, 12), accent);
        ring.rotation.x = Math.PI / 2;
        ring.position.z = 0.29;
        group.add(arc, edge, grip, ring);
    } else if (model === 'butterfly') {
        const bladeRoot = new THREE.Group();
        addClassicBlade(bladeRoot, 0.9);
        bladeRoot.position.z = -0.04;
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.055, 0.34), dark);
        const right = left.clone();
        left.position.set(-0.075, -0.01, 0.13);
        right.position.set(0.075, -0.01, 0.13);
        left.rotation.z = -0.16;
        right.rotation.z = 0.16;
        const latch = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.08), accent);
        latch.position.z = 0.31;
        group.add(bladeRoot, left, right, latch);
        group.userData.inspectParts = [left, right, bladeRoot];
    } else {
        addClassicBlade(group);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.065), accent);
        guard.position.z = 0.01;
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.24, 8), dark);
        handle.rotation.x = Math.PI / 2;
        handle.position.z = 0.15;
        const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 8), accent);
        pommel.rotation.x = Math.PI / 2;
        pommel.position.z = 0.28;
        group.add(guard, handle, pommel);
    }
    group.userData.weaponType = 'knife';
    group.userData.model = model;
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
