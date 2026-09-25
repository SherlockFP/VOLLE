import * as THREE from 'three';
import { createCharacterRig } from './character-rig.js';

function material(color) {
    return new THREE.MeshLambertMaterial({ color });
}

// Replay actors wear the real team-colored character rig; the box figure below
// is only the fallback if a rig cannot be built.
function createRigActor(team) {
    try {
        const rig = createCharacterRig({ characterId: 'rally', team, castShadow: false });
        const group = new THREE.Group();
        group.add(rig.root);
        return { group, rig };
    } catch {
        return null;
    }
}

function createActor(team) {
    const group = new THREE.Group();
    const color = team === 'blue' ? 0x3d8bff : 0xff5364;
    const bodyMaterial = material(color);
    const skinMaterial = material(0xffd1aa);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.42), bodyMaterial);
    body.position.y = 1.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), skinMaterial);
    head.position.y = 1.9;
    group.add(body, head);
    for (const x of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.28), bodyMaterial);
        leg.position.set(x, 0.4, 0);
        group.add(leg);
    }
    return group;
}

export class ReplayView {
    constructor(scene) {
        this.scene = scene;
        this.actors = new Map();
        this.targets = [];
    }

    apply(snapshot) {
        const visible = new Set();
        for (const data of snapshot?.players || []) {
            if (!data?.id) continue;
            let actor = this.actors.get(data.id);
            if (!actor) {
                const built = createRigActor(data.team);
                const group = built?.group || createActor(data.team);
                this.scene.add(group);
                actor = {
                    id: data.id,
                    name: data.name || data.id,
                    team: data.team,
                    position: group.position,
                    rotation: group.rotation,
                    yaw: 0,
                    pitch: 0,
                    eyeHeight: 1.7,
                    group,
                    rig: built?.rig || null,
                    getPosition: () => group.position.clone()
                };
                this.actors.set(data.id, actor);
            }
            actor.name = data.name || actor.name;
            actor.group.visible = data.alive !== false;
            actor.group.position.set(data.x || 0, data.y || 0, data.z || 0);
            actor.group.rotation.y = Number(data.yaw) || 0;
            actor.yaw = actor.group.rotation.y;
            actor.pitch = Number(data.pitch) || 0;
            visible.add(data.id);
        }
        for (const [id, actor] of this.actors) {
            if (!visible.has(id)) actor.group.visible = false;
        }
        this.targets = [...this.actors.values()].filter(actor => actor.group.visible);
        return this.targets;
    }

    clear() {
        for (const actor of this.actors.values()) {
            if (actor.rig) actor.rig.dispose();
            else actor.group.traverse(child => {
                child.geometry?.dispose?.();
                child.material?.dispose?.();
            });
            this.scene.remove(actor.group);
        }
        this.actors.clear();
        this.targets = [];
    }
}
