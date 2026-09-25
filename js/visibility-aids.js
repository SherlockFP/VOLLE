// Far-court readability. With a 75 degree FOV on a 720p screen the ball at the far
// end of a court (~80 units) is about 5 px wide and an opponent's name label is a
// smudge. Two presentation-only aids fix that without touching gameplay:
//   - a ball beacon: a skin-tinted disk that keeps the ball at least BALL_MIN_PX
//     wide on screen, fading out once the real ball is big enough;
//   - enemy markers: a small team-colored chevron above each living opponent, a
//     constant MARKER_PX tall, faded out up close where the body already reads.
// Both are depth-tested (walls still hide what is behind them), unfogged and not
// tone mapped, so team colors stay saturated. The sprites are pooled.
import * as THREE from 'three';

export const BALL_MIN_PX = 12;
export const MARKER_PX = 16;
export const MARKER_NEAR = 14;   // units: marker hidden closer than this
export const MARKER_FAR = 28;    // units: marker fully shown from here
export const MARKER_LIFT = 3.5;  // units above the entity group's origin
const FFA_ENEMY_COLOR = 0xffa23a;
const BEACON_DISK = 0.625; // disk + ring share of the beacon texture's width
const MAX_MARKERS = 16;

// World-space size that spans `px` CSS pixels at `distance` in front of a
// perspective camera with vertical FOV `fovDeg` on a canvas `viewportPx` tall.
export function worldSizeForPixels(distance, fovDeg, viewportPx, px) {
    const halfHeight = Math.max(0, distance) * Math.tan((fovDeg * Math.PI) / 360);
    return (px * 2 * halfHeight) / Math.max(1, viewportPx);
}

// Screen pixels covered by `worldSize` at `distance` (inverse of the above).
export function projectedPixels(worldSize, distance, fovDeg, viewportPx) {
    const halfHeight = Math.max(1e-6, distance) * Math.tan((fovDeg * Math.PI) / 360);
    return (worldSize * Math.max(1, viewportPx)) / (2 * halfHeight);
}

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// 0 when the ball already covers minPx, 1 at half of that or smaller.
export function beaconOpacity(ballPx, minPx = BALL_MIN_PX) {
    return 1 - smoothstep(minPx * 0.5, minPx, ballPx);
}

export function markerOpacity(distance, near = MARKER_NEAR, far = MARKER_FAR) {
    return smoothstep(near, far, distance);
}

function canvasTexture(size, draw) {
    const doc = globalThis.document;
    if (!doc?.createElement) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return null;
    draw(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

// White disk (tinted by the material color) with a dark ring for contrast on
// bright skies and a soft outer glow for dark ones.
function drawBeacon(ctx, size) {
    const c = size / 2;
    const disk = (size * BEACON_DISK) / 2;
    const glow = ctx.createRadialGradient(c, c, disk * 0.8, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,0.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(c, c, disk - size * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = 'rgba(10,12,20,0.9)';
    ctx.stroke();
}

// Downward chevron: white fill (tinted per team) with a dark outline.
function drawMarker(ctx, size) {
    const s = size;
    ctx.beginPath();
    ctx.moveTo(s * 0.12, s * 0.2);
    ctx.lineTo(s * 0.88, s * 0.2);
    ctx.lineTo(s * 0.5, s * 0.84);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.1;
    ctx.strokeStyle = 'rgba(10,12,20,0.92)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
}

function makeSprite(map, name) {
    const material = new THREE.SpriteMaterial({
        map, color: 0xffffff, transparent: true, opacity: 0,
        depthTest: true, depthWrite: false, fog: false, toneMapped: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = name;
    sprite.visible = false;
    sprite.renderOrder = 6;
    sprite.frustumCulled = false;
    return sprite;
}

export class VisibilityAids {
    constructor(scene) {
        this.scene = scene;
        this.beacon = null;
        this.markers = [];
        this._beaconTexture = null;
        this._markerTexture = null;
        this._toCamera = new THREE.Vector3();
        this._ballPos = new THREE.Vector3();
    }

    _attach(sprite) {
        if (this.scene && sprite.parent !== this.scene) this.scene.add(sprite);
    }

    _beaconSprite() {
        if (!this.beacon) {
            this._beaconTexture ||= canvasTexture(64, drawBeacon);
            this.beacon = makeSprite(this._beaconTexture, 'ball-beacon');
        }
        this._attach(this.beacon);
        return this.beacon;
    }

    _marker(index) {
        if (index >= MAX_MARKERS) return null;
        if (!this.markers[index]) {
            this._markerTexture ||= canvasTexture(64, drawMarker);
            this.markers[index] = makeSprite(this._markerTexture, 'enemy-marker');
        }
        this._attach(this.markers[index]);
        return this.markers[index];
    }

    // Hidden beacon + one marker in the scene so Renderer.prewarm compiles them.
    prewarm() {
        if (!this.scene) return;
        this._beaconSprite();
        this._marker(0);
    }

    // ball: the game Ball; camera: PerspectiveCamera; viewportPx: canvas CSS height.
    updateBall(ball, camera, viewportPx) {
        const mesh = ball?.mesh;
        if (!mesh || !camera || !mesh.visible || !mesh.parent) return this.hideBall();
        mesh.getWorldPosition(this._ballPos);
        const distance = camera.position.distanceTo(this._ballPos);
        const diameter = (ball.visualRadius || 0.43) * 2 * (mesh.scale?.x || 1);
        const ballPx = projectedPixels(diameter, distance, camera.fov, viewportPx);
        const opacity = beaconOpacity(ballPx);
        if (opacity <= 0.01) return this.hideBall();
        const sprite = this._beaconSprite();
        const size = worldSizeForPixels(distance, camera.fov, viewportPx, BALL_MIN_PX) / BEACON_DISK;
        sprite.scale.set(size, size, 1);
        // Pull the disk toward the camera by the ball's radius so the floor and
        // the ball itself never clip it.
        this._toCamera.subVectors(camera.position, this._ballPos).normalize();
        sprite.position.copy(this._ballPos).addScaledVector(this._toCamera, diameter / 2);
        sprite.material.color.setHex(ball.skinConfig?.glow ?? 0xff8844);
        sprite.material.opacity = opacity;
        sprite.visible = true;
        return true;
    }

    hideBall() {
        if (this.beacon) this.beacon.visible = false;
        return false;
    }

    // enemies: iterable of { group, alive, team }; ffa: every opponent gets one color.
    updateEnemies(enemies, camera, viewportPx, { ffa = false } = {}) {
        let used = 0;
        if (camera && enemies) {
            for (const enemy of enemies) {
                const group = enemy?.group;
                if (!group || enemy.alive === false || !group.visible || !group.parent) continue;
                const distance = camera.position.distanceTo(group.position);
                const opacity = markerOpacity(distance);
                if (opacity <= 0.01) continue;
                const sprite = this._marker(used);
                if (!sprite) break;
                used++;
                const size = worldSizeForPixels(distance, camera.fov, viewportPx, MARKER_PX);
                sprite.scale.set(size, size, 1);
                sprite.position.set(group.position.x, group.position.y + MARKER_LIFT * (group.scale?.y || 1), group.position.z);
                sprite.material.color.setHex(ffa ? FFA_ENEMY_COLOR : (enemy.team === 'red' ? 0xff4d5e : 0x4d9bff));
                sprite.material.opacity = opacity;
                sprite.visible = true;
            }
        }
        for (let i = used; i < this.markers.length; i++) this.markers[i].visible = false;
        return used;
    }

    hide() {
        this.hideBall();
        for (const marker of this.markers) marker.visible = false;
    }

    dispose() {
        for (const sprite of [this.beacon, ...this.markers]) {
            if (!sprite) continue;
            this.scene?.remove(sprite);
            sprite.material.dispose();
        }
        this._beaconTexture?.dispose();
        this._markerTexture?.dispose();
        this.beacon = null;
        this.markers.length = 0;
        this._beaconTexture = this._markerTexture = null;
    }
}
