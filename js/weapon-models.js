import * as THREE from 'three';

function mat(color, metalness = 0.2, roughness = 0.55, emissive = 0x000000) {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive });
}

export function createKnifeModel(style = {}) {
    const group = new THREE.Group();
    const color = new THREE.Color(style.color || '#d7f3ff');
    const bladeMat = mat(color, 0.88, 0.2, color.clone().multiplyScalar(0.06));
    const dark = mat(0x101820, 0.6, 0.32);
    const accent = mat(color.clone().offsetHSL(0, 0.08, -0.18), 0.72, 0.24);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 0.48), bladeMat);
    blade.position.z = -0.24;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.041, 0.16, 4), bladeMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.56;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.065), accent);
    guard.position.z = 0.035;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.075, 0.22), dark);
    handle.position.z = 0.16;
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8), accent);
    pommel.rotation.x = Math.PI / 2;
    pommel.position.z = 0.3;
    group.add(blade, tip, guard, handle, pommel);
    group.userData.weaponType = 'knife';
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
