// A short column of light where a player is eliminated, tall and unfogged so it
// reads from the far end of the court. Four pooled slots; update() allocates nothing.
import * as THREE from 'three';

const SLOTS = 4;
const LIFE = 1.3;
const HEIGHT = 22;

export class KillPillars {
    constructor(scene) {
        this.scene = scene;
        this.slots = [];
        this._beamGeo = null;
        this._ringGeo = null;
    }

    _createSlot() {
        if (!this._beamGeo) {
            this._beamGeo = new THREE.CylinderGeometry(0.45, 0.9, 1, 20, 1, true);
            this._beamGeo.translate(0, 0.5, 0);
            this._ringGeo = new THREE.RingGeometry(0.7, 1.05, 40);
            this._ringGeo.rotateX(-Math.PI / 2);
        }
        const material = () => new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0, depthWrite: false, fog: false,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending
        });
        const beam = new THREE.Mesh(this._beamGeo, material());
        const ring = new THREE.Mesh(this._ringGeo, material());
        ring.position.y = 0.06;
        const group = new THREE.Group();
        group.name = 'kill-pillar';
        group.add(beam, ring);
        group.visible = false;
        group.renderOrder = 5;
        const slot = { group, beam, ring, life: 0 };
        this.slots.push(slot);
        this.scene?.add(group);
        return slot;
    }

    spawn(pos, color = 0xffffff) {
        if (!pos || !this.scene) return false;
        let slot = this.slots.find(s => s.life <= 0);
        if (!slot) slot = this.slots.length < SLOTS ? this._createSlot() : this.slots.reduce((a, b) => (a.life < b.life ? a : b));
        slot.life = LIFE;
        slot.group.position.set(pos.x, 0, pos.z);
        slot.beam.material.color.setHex(color);
        slot.ring.material.color.setHex(color);
        if (slot.group.parent !== this.scene) this.scene.add(slot.group);
        slot.group.visible = true;
        this._pose(slot);
        return true;
    }

    _pose(slot) {
        const k = 1 - slot.life / LIFE; // 0 -> 1 over the lifetime
        const rise = Math.min(1, k * 5);
        const width = 1 + k * 0.6;
        slot.beam.scale.set(width, HEIGHT * (1 - (1 - rise) * (1 - rise)), width);
        slot.beam.material.opacity = 0.85 * (1 - k * k);
        slot.ring.scale.setScalar(1 + k * 5);
        slot.ring.material.opacity = 0.9 * (1 - k);
    }

    update(dt) {
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            if (slot.life <= 0) continue;
            slot.life -= dt;
            if (slot.life <= 0) {
                slot.life = 0;
                slot.group.visible = false;
                continue;
            }
            this._pose(slot);
        }
    }

    dispose() {
        for (const slot of this.slots) {
            this.scene?.remove(slot.group);
            slot.beam.material.dispose();
            slot.ring.material.dispose();
        }
        this.slots.length = 0;
        this._beamGeo?.dispose();
        this._ringGeo?.dispose();
        this._beamGeo = this._ringGeo = null;
    }
}
