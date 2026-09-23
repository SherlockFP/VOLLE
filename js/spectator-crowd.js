// spectator-crowd.js — seated avatars for joined spectators in the sideline stands.
// Cheap on purpose: two shared geometries, one Lambert material per avatar, a small
// name label, zero per-frame allocation (hop animation mutates positions in place).
import * as THREE from 'three';

const CROWD_PALETTE = Object.freeze([0xf2a65a, 0x7cc6fe, 0xb8e986, 0xf78fb3, 0xffd166, 0x9d8df1, 0x5ee6c8, 0xff8c69]);
const HOP_DURATION = 0.42;
const HOP_HEIGHT = 0.45;
// Emote sprites float at entity.y + 2.8 (js/emotes.js); lower the anchor so the emoji
// sits just above a seated head instead of two metres over it.
const EMOTE_ANCHOR_DROP = 1.05;

let bodyGeometry = null;
let headGeometry = null;

export function crowdColorFor(name = '') {
    let hash = 0;
    const text = String(name);
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return CROWD_PALETTE[Math.abs(hash) % CROWD_PALETTE.length];
}

function makeLabel(name) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const text = String(name || 'Fan').slice(0, 16);
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(1.5, 0.375, 1);
    sprite.position.y = 1.75;
    return sprite;
}

export class SpectatorCrowd {
    constructor(scene) {
        this.scene = scene;
        this.avatars = new Map(); // playerId -> avatar
        this.hiddenId = null;     // local spectator's own avatar while the camera sits in it
    }

    _createAvatar(playerId, name) {
        bodyGeometry ||= new THREE.CylinderGeometry(0.3, 0.36, 0.85, 8);
        headGeometry ||= new THREE.SphereGeometry(0.26, 12, 10);
        const material = new THREE.MeshLambertMaterial({ color: crowdColorFor(name) });
        const group = new THREE.Group();
        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.y = 0.45;
        const head = new THREE.Mesh(headGeometry, material);
        head.position.y = 1.12;
        group.add(body, head);
        const label = makeLabel(name);
        if (label) group.add(label);
        group.name = `spectator:${playerId}`;
        this.scene?.add(group);
        const anchor = new THREE.Vector3();
        return {
            playerId,
            name,
            group,
            material,
            label,
            seatIndex: -1,
            baseY: 0,
            hopT: 0,
            hopDelay: 0,
            // EmoteSystem entity contract: stable key + a position source.
            entity: {
                name: `__spectator__${playerId}`,
                getPosition() {
                    anchor.copy(group.position);
                    anchor.y -= EMOTE_ANCHOR_DROP;
                    return anchor;
                }
            }
        };
    }

    _disposeAvatar(avatar) {
        this.scene?.remove(avatar.group);
        avatar.material.dispose();
        avatar.label?.material?.map?.dispose();
        avatar.label?.material?.dispose();
    }

    // list: [{ playerId, name, seat }]; seats: js/spectator-seats.js anchors.
    sync(list = [], seats = []) {
        const seen = new Set();
        for (const entry of list) {
            const seat = seats[entry.seat];
            if (!entry?.playerId || !seat) continue;
            seen.add(entry.playerId);
            let avatar = this.avatars.get(entry.playerId);
            if (avatar && avatar.name !== entry.name) {
                this._disposeAvatar(avatar);
                this.avatars.delete(entry.playerId);
                avatar = null;
            }
            if (!avatar) {
                avatar = this._createAvatar(entry.playerId, entry.name);
                this.avatars.set(entry.playerId, avatar);
            }
            if (avatar.seatIndex !== seat.index) {
                if (avatar.seatIndex >= 0) this.hop(entry.playerId);
                avatar.seatIndex = seat.index;
                avatar.baseY = seat.y;
                avatar.group.position.set(seat.x, seat.y, seat.z);
                // Face the court: west seats look toward +x, east seats toward -x.
                avatar.group.rotation.y = seat.side === 'west' ? Math.PI / 2 : -Math.PI / 2;
            }
            avatar.group.visible = entry.playerId !== this.hiddenId;
        }
        for (const [playerId, avatar] of this.avatars) {
            if (seen.has(playerId)) continue;
            this._disposeAvatar(avatar);
            this.avatars.delete(playerId);
        }
    }

    setHidden(playerId) {
        this.hiddenId = playerId || null;
        for (const [id, avatar] of this.avatars) avatar.group.visible = id !== this.hiddenId;
    }

    entityFor(playerId) {
        return this.avatars.get(playerId)?.entity || null;
    }

    hop(playerId, delay = 0) {
        const avatar = this.avatars.get(playerId);
        if (!avatar || avatar.hopT > 0) return false;
        avatar.hopT = HOP_DURATION;
        avatar.hopDelay = Math.max(0, delay);
        return true;
    }

    // Whole-crowd reaction (big plays): staggered hops read as a small wave.
    cheer() {
        let i = 0;
        for (const playerId of this.avatars.keys()) this.hop(playerId, (i++ % 8) * 0.06);
        return this.avatars.size;
    }

    update(dt) {
        if (!this.avatars.size || !(dt > 0)) return;
        for (const avatar of this.avatars.values()) {
            if (avatar.hopT <= 0) continue;
            if (avatar.hopDelay > 0) {
                avatar.hopDelay -= dt;
                continue;
            }
            avatar.hopT = Math.max(0, avatar.hopT - dt);
            const phase = 1 - avatar.hopT / HOP_DURATION;
            avatar.group.position.y = avatar.baseY + Math.sin(phase * Math.PI) * HOP_HEIGHT;
        }
    }

    clear() {
        for (const avatar of this.avatars.values()) this._disposeAvatar(avatar);
        this.avatars.clear();
    }
}
