// Free-cam ground ping. Split out of spectator.js (which stays importable in Node
// without three) and imported by name: a dynamic import('three') would keep all of
// three.js in the bundle.
import { DoubleSide, Mesh, MeshBasicMaterial, Plane, Raycaster, RingGeometry, Vector2, Vector3 } from 'three';

const raycaster = new Raycaster();
const pointer = new Vector2();
const ground = new Plane(new Vector3(0, 1, 0), 0);

// Where a click on the screen meets the floor (y = 0), or null.
export function groundPointFromClick(clientX, clientY, camera) {
    pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const denominator = raycaster.ray.direction.dot(ground.normal);
    if (Math.abs(denominator) <= 1e-6) return null;
    const distance = -(raycaster.ray.origin.dot(ground.normal) + ground.constant) / denominator;
    if (distance <= 0) return null;
    return new Vector3().copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, distance);
}

export function createPingMesh(position) {
    const ring = new Mesh(
        new RingGeometry(0.5, 1, 24),
        new MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7, side: DoubleSide })
    );
    ring.position.set(position.x, 0.05, position.z);
    ring.rotation.x = -Math.PI / 2;
    return ring;
}
