// affixes.js — temporary map modifiers: damage zones that spawn mid-round.
// Each zone is a red circle on the floor that damages anyone standing in it.
import * as THREE from 'three';

const ZONE_LIFETIME_MIN = 5;
const ZONE_LIFETIME_MAX = 8;
const ZONE_RADIUS_MIN = 3;
const ZONE_RADIUS_MAX = 5;
const DAMAGE_PER_TICK = 4;
const DAMAGE_INTERVAL = 1; // seconds between damage ticks per player per zone

export class AffixManager {
    constructor(arena, scene) {
        this.arena = arena;
        this.scene = scene;
        this.zones = [];
        this.active = false;
    }

    getZoneCount() {
        const area = this.arena.courtWidth * this.arena.courtLength;
        if (area < 3000) return 1;   // small courts
        if (area < 5500) return 2;   // medium courts
        return 3;                     // large+ courts
    }

    // Pick a random X,Z within court bounds, with padding, no overlap with existing zones.
    findFreePosition(radius, attemptsMax) {
        const b = this.arena.bounds;
        const pad = radius + 1;
        for (let i = 0; i < attemptsMax; i++) {
            const x = b.minX + pad + Math.random() * (b.maxX - b.minX - pad * 2);
            const z = b.minZ + pad + Math.random() * (b.maxZ - b.minZ - pad * 2);
            let overlap = false;
            for (const zz of this.zones) {
                const dx = x - zz.position.x;
                const dz = z - zz.position.z;
                if (Math.sqrt(dx * dx + dz * dz) < zz.radius + radius + 1) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap) return { x, z };
        }
        // Fallback — random within bounds
        return {
            x: b.minX + pad + Math.random() * (b.maxX - b.minX - pad * 2),
            z: b.minZ + pad + Math.random() * (b.maxZ - b.minZ - pad * 2)
        };
    }

    spawnZone() {
        const radius = ZONE_RADIUS_MIN + Math.random() * (ZONE_RADIUS_MAX - ZONE_RADIUS_MIN);
        const pos = this.findFreePosition(radius, 50);

        // Filled circle on the floor
        const circGeo = new THREE.CircleGeometry(radius, 24);
        const circMat = new THREE.MeshBasicMaterial({
            color: 0xff2222,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const circle = new THREE.Mesh(circGeo, circMat);
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(pos.x, 0.2, pos.z);
        this.scene.add(circle);

        // Glow ring around the edge
        const ringGeo = new THREE.RingGeometry(radius - 0.3, radius + 0.3, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pos.x, 0.22, pos.z);
        this.scene.add(ring);

        this.zones.push({
            circle,
            ring,
            position: new THREE.Vector3(pos.x, 0, pos.z),
            radius,
            timer: ZONE_LIFETIME_MIN + Math.random() * (ZONE_LIFETIME_MAX - ZONE_LIFETIME_MIN),
            damageTimers: new Map() // player -> last damage timestamp
        });
    }

    // Reposition + reset an expired zone instead of destroying + rebuilding.
    respawnZone(zone) {
        // Clean per-player timers
        zone.damageTimers.clear();
        const radius = ZONE_RADIUS_MIN + Math.random() * (ZONE_RADIUS_MAX - ZONE_RADIUS_MIN);
        // Temporarily remove from overlap checks while finding a new spot
        const idx = this.zones.indexOf(zone);
        if (idx >= 0) this.zones.splice(idx, 1);
        const pos = this.findFreePosition(radius, 50);
        // Put it back
        this.zones.push(zone);

        zone.radius = radius;
        zone.position.set(pos.x, 0, pos.z);
        zone.timer = ZONE_LIFETIME_MIN + Math.random() * (ZONE_LIFETIME_MAX - ZONE_LIFETIME_MIN);

        // Rebuild geometry for new radius
        zone.circle.geometry.dispose();
        zone.circle.geometry = new THREE.CircleGeometry(radius, 24);
        zone.circle.position.set(pos.x, 0.2, pos.z);

        zone.ring.geometry.dispose();
        zone.ring.geometry = new THREE.RingGeometry(radius - 0.3, radius + 0.3, 32);
        zone.ring.position.set(pos.x, 0.22, pos.z);
    }

    startRound() {
        this.clearRound();
        this.active = true;
        const count = this.getZoneCount();
        for (let i = 0; i < count; i++) {
            this.spawnZone();
        }
    }

    update(dt, players) {
        if (!this.active || this.zones.length === 0) return;
        const now = performance.now() / 1000;

        for (let i = this.zones.length - 1; i >= 0; i--) {
            const zone = this.zones[i];

            // Lifetime countdown
            zone.timer -= dt;

            // Pulse opacity: circle pulses, ring glows steadily with a subtle wobble
            const pulse = 0.15 + Math.sin(now * 4) * 0.12;
            zone.circle.material.opacity = Math.max(0.03, pulse);
            zone.ring.material.opacity = 0.5 + Math.sin(now * 4 + 1) * 0.25;

            // Damage players inside the zone
            for (const player of players) {
                if (player.alive === false) continue;
                const p = player.getPosition();
                const dx = p.x - zone.position.x;
                const dz = p.z - zone.position.z;
                if (Math.sqrt(dx * dx + dz * dz) < zone.radius) {
                    const lastHit = zone.damageTimers.get(player) || 0;
                    if (now - lastHit >= DAMAGE_INTERVAL) {
                        player.takeDamage(DAMAGE_PER_TICK);
                        zone.damageTimers.set(player, now);
                    }
                }
            }

            // Expired → respawn at a new position
            if (zone.timer <= 0) {
                this.respawnZone(zone);
            }
        }
    }

    clearRound() {
        for (const zone of this.zones) {
            this.scene.remove(zone.circle);
            this.scene.remove(zone.ring);
            zone.circle.geometry.dispose();
            zone.circle.material.dispose();
            zone.ring.geometry.dispose();
            zone.ring.material.dispose();
            zone.damageTimers.clear();
        }
        this.zones = [];
        this.active = false;
    }
}
