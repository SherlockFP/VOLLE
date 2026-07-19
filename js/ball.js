// ball.js — Rally ball with aim-based direction, slow speed scaling, bounce, arc,
// skin system, portal teleport, freeze support.
import * as THREE from 'three';
import { ObjectPool } from './objectPool.js';

export const STEERING_CONTROL_WINDOW = 0.074;
const STEERING_TICK = 1 / 66;
const WIDE_SHOT_DOT = Math.cos(15 * Math.PI / 180);

const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function steeringTurnAlpha(dt, deflections = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    const tickTurn = clamp(0.26 + Math.max(0, deflections) * 0.018, 0, 0.9);
    return 1 - Math.pow(1 - tickTurn, dt / STEERING_TICK);
}

export function isSteeringControlLocked(age) {
    return Number.isFinite(age) && age < STEERING_CONTROL_WINDOW;
}

export function steeringActiveDt(age, dt) {
    if (!Number.isFinite(age) || !Number.isFinite(dt) || dt <= 0) return 0;
    return Math.max(0, age + dt - Math.max(age, STEERING_CONTROL_WINDOW));
}

export function splitSteeringDisplacement(before, after, dt, activeDt) {
    const active = clamp(Number.isFinite(activeDt) ? activeDt : 0, 0, Math.max(0, dt));
    const locked = Math.max(0, dt - active);
    return {
        x: before.x * locked + after.x * active,
        y: before.y * locked + after.y * active,
        z: before.z * locked + after.z * active
    };
}

export function recoverCornerHoming(velocity, position, target, speed, turn = 0.58) {
    if (!finitePoint(velocity) || !finitePoint(position) || !finitePoint(target) || !Number.isFinite(speed) || speed <= 0) {
        return finitePoint(velocity) ? { ...velocity } : { x: 0, y: 0, z: 0 };
    }
    const currentLength = Math.hypot(velocity.x, velocity.y, velocity.z);
    const desired = { x: target.x - position.x, y: target.y - position.y, z: target.z - position.z };
    const desiredLength = Math.hypot(desired.x, desired.y, desired.z);
    if (currentLength < 0.001 || desiredLength < 0.001) return { ...velocity };
    const blend = clamp(turn, 0, 1);
    const x = velocity.x / currentLength * (1 - blend) + desired.x / desiredLength * blend;
    const y = velocity.y / currentLength * (1 - blend) + desired.y / desiredLength * blend;
    const z = velocity.z / currentLength * (1 - blend) + desired.z / desiredLength * blend;
    const length = Math.hypot(x, y, z);
    return length > 0.001 ? { x: x / length * speed, y: y / length * speed, z: z / length * speed } : { ...velocity };
}

export function sampleBoundedVelocity(previous, current, dt, maxSpeed = 14) {
    if (!finitePoint(previous) || !finitePoint(current) || !Number.isFinite(dt) || dt <= 0) {
        return { x: 0, y: 0, z: 0 };
    }
    const velocity = {
        x: (current.x - previous.x) / dt,
        y: (current.y - previous.y) / dt,
        z: (current.z - previous.z) / dt
    };
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const limit = Math.max(0, Number.isFinite(maxSpeed) ? maxSpeed : 0);
    if (speed > limit && speed > 0) {
        const scale = limit / speed;
        velocity.x *= scale;
        velocity.y *= scale;
        velocity.z *= scale;
    }
    return velocity;
}

export function smoothSampledVelocity(previous, sampled, dt, response = 12) {
    const from = finitePoint(previous) ? previous : { x: 0, y: 0, z: 0 };
    const to = finitePoint(sampled) ? sampled : { x: 0, y: 0, z: 0 };
    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const alpha = 1 - Math.exp(-Math.max(0, response) * safeDt);
    return {
        x: from.x + (to.x - from.x) * alpha,
        y: from.y + (to.y - from.y) * alpha,
        z: from.z + (to.z - from.z) * alpha
    };
}

export function networkBallStep(position, velocity, target, dt, packetAge) {
    if (!finitePoint(position) || !finitePoint(velocity) || !finitePoint(target)) {
        return finitePoint(position) ? { ...position } : { x: 0, y: 0, z: 0 };
    }
    const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    const age = clamp(Number.isFinite(packetAge) ? packetAge : 0, 0, 0.08);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const predicted = {
        x: position.x + velocity.x * safeDt,
        y: position.y + velocity.y * safeDt,
        z: position.z + velocity.z * safeDt
    };
    const host = {
        x: target.x + velocity.x * age,
        y: target.y + velocity.y * age,
        z: target.z + velocity.z * age
    };
    const dx = host.x - predicted.x;
    const dy = host.y - predicted.y;
    const dz = host.z - predicted.z;
    if (dx * dx + dy * dy + dz * dz > 144) return host;
    const correction = 1 - Math.exp(-safeDt * (10 + Math.min(14, speed * 0.25)));
    return {
        x: predicted.x + dx * correction,
        y: predicted.y + dy * correction,
        z: predicted.z + dz * correction
    };
}

export function predictLeadTarget(target, targetVelocity, projectile, projectileSpeed) {
    if (!finitePoint(target)) return { x: 0, y: 0, z: 0 };
    const velocity = finitePoint(targetVelocity) ? targetVelocity : { x: 0, y: 0, z: 0 };
    const distance = finitePoint(projectile)
        ? Math.hypot(target.x - projectile.x, target.y - projectile.y, target.z - projectile.z)
        : 0;
    const speed = Number.isFinite(projectileSpeed) && projectileSpeed > 0 ? projectileSpeed : 1;
    const leadTime = clamp((distance / speed) * 0.25, 0, 0.3);
    return {
        x: target.x + velocity.x * leadTime,
        y: target.y + velocity.y * leadTime,
        z: target.z + velocity.z * leadTime
    };
}

export function createWideWaypoint(origin, aimDirection, target) {
    if (!finitePoint(origin) || !finitePoint(aimDirection) || !finitePoint(target)) return null;
    const directLength = Math.hypot(target.x - origin.x, target.z - origin.z);
    const aimLength = Math.hypot(aimDirection.x, aimDirection.z);
    if (directLength < 0.001 || aimLength < 0.001) return null;
    const direct = { x: (target.x - origin.x) / directLength, z: (target.z - origin.z) / directLength };
    const aim = { x: aimDirection.x / aimLength, z: aimDirection.z / aimLength };
    if (direct.x * aim.x + direct.z * aim.z >= WIDE_SHOT_DOT) return null;
    const cross = direct.x * aim.z - direct.z * aim.x;
    const sideSign = cross === 0 ? (direct.x >= 0 ? 1 : -1) : Math.sign(cross);
    // Keep wide throws mostly on the target's forward/back axis. A small lateral
    // offset makes the route readable without orbiting around the player.
    const sideDistance = clamp(directLength * 0.16, 1.25, 3.25);
    const backDistance = clamp(directLength * 0.68, 6, 12);
    return {
        position: {
            x: target.x + direct.x * backDistance - direct.z * sideSign * sideDistance,
            y: target.y,
            z: target.z + direct.z * backDistance + direct.x * sideSign * sideDistance
        },
        planeNormal: { x: direct.x, y: 0, z: direct.z }
    };
}

export function hasCrossedTargetPlane(position, target, planeNormal) {
    if (!finitePoint(position) || !finitePoint(target) || !finitePoint(planeNormal)) return false;
    return (position.x - target.x) * planeNormal.x
        + (position.y - target.y) * planeNormal.y
        + (position.z - target.z) * planeNormal.z >= 0;
}

// ponytail: top skin'leri — görsel + küçük efekt. Store ile eşle.
export const BALL_SKINS = {
    classic:   { name: 'Classic Volleyball', color: 0xff8844, glow: 0xff8844, trail: 0xff8844, starColor: 0xffee44 },
    fire:      { name: 'Fireball',           color: 0xff3322, glow: 0xff5500, trail: 0xff6600, starColor: 0xffaa00 },
    ice:       { name: 'Ice Sphere',         color: 0x88ccff, glow: 0xaaeeff, trail: 0xaaddff, starColor: 0xffffff, frostTrail: true },
    lightning: { name: 'Lightning Orb',      color: 0xffee44, glow: 0xffff88, trail: 0xffff66, starColor: 0xffffff },
    bomb:      { name: 'Bomb Ball',          color: 0x222222, glow: 0xff4400, trail: 0xff6600, starColor: 0xff4400, burstTrail: true },
    star:      { name: 'Star Core',          color: 0xffdd44, glow: 0xffffaa, trail: 0xffee88, starColor: 0xffffff },
    rainbow:   { name: 'Rainbow',            color: 0xff00ff, glow: 0xffffff, trail: 0xff00ff, starColor: 0xffffff, rainbow: true },
    plasma:    { name: 'Plasma Pulse',        color: 0x52ddff, glow: 0x72f2ff, trail: 0x39a9ff, starColor: 0xffffff, burstTrail: true },
    abyss:     { name: 'Abyss Core',          color: 0x23113f, glow: 0x9c5cff, trail: 0x673ab7, starColor: 0xd7b8ff, burstTrail: true },
    melon:     { name: 'Melon Pop',           color: 0x55d66b, glow: 0xff6b8b, trail: 0x6ee787, starColor: 0xffd6df }
};

export class Ball {
    constructor(renderer, arena) {
        this.renderer = renderer;
        this.arena = arena;
        this.scene = renderer.scene;

        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.gravity = -14;
        this.baseSpeed = 17;
        this.currentSpeed = this.baseSpeed;
        this.rallySpeedStep = 0.30;             // 100 -> 130 -> 160 ...
        this.maxRallyMultiplier = 6.0;          // hard cap: 600% base speed
        this.maxSpeed = 102;
        this.deflections = 0;
        this.radius = 0.47;
        this._baseRadius = this.radius;
        this.attackRange = 2.0;
        this.catchRange = 2.0;
        this.hitRange = 0.7;
        this.active = false;
        this.targetPlayer = null;
        this.state = 'idle';
        this.skinId = 'classic';

        this.trail = [];
        this.trailTimer = 0;
        this._trailGeometry = new THREE.SphereGeometry(1, 4, 4);
        this._trailPool = new ObjectPool(
            () => new THREE.Mesh(this._trailGeometry, new THREE.MeshBasicMaterial({ transparent: true })),
            mesh => { this.scene.remove(mesh); mesh.visible = false; },
            mesh => mesh.material.dispose(),
            64
        );
        this.bounceCount = 0;
        this.spin = 0;
        this.lastShot = 'flat';
        this.heldPlayer = null;  // ponytail: catch mechanic — player holding the ball
        this.lastShotBy = null;  // ponytail: kill credit — who last hit the ball
        // Homing strength per rally shot. Player aim-shots use a tiny assist so the
        // ball flies where you aim (rocketdodge/Genji feel); bots keep strong homing.
        this.homingStrength = 0.30;
        this.aimed = false;
        this.bodyZone = 'head'; // head, chest, abdomen, legs
        this.ricochetTarget = null; // wall bounce waypoint
        this.ricochetChance = 0.2;   // configurable via console sv_ricochet
        this._squashTimer = 0;
        this._homingAge = 0; // ponytail: homing ramp timer — her 2 saniyede +%50 çekim

        // Perfect-catch window — Knockout City tarzı.
        // Top hedefe yaklaştığında kısa "perfect" penceresi açılır.
        // Bu pencerede deflect = perfect (bonus hasar + hız + slow-mo).
        this.perfectWindow = 0;       // saniye, >0 ise perfect mümkün
        this.perfectWindowDuration = 0.25;
        this.perfectRange = 2.8;      // hedefe bu mesafede perfect açılır
        this.lastPerfectBy = null;    // son perfect yapan entity

        // Charge-up throw — hold to charge, release for power throw.
        this.chargeLevel = 0;         // 0..1
        this.isCharging = false;

        // ponytail: proximity forced-hit — top hedefe 1.5 birimden az yaklaşınca
        // süre sayacı başlar. Oyuncu vurmazsa 0.4s sonra zorunlu hit.
        this._proximityTimer = 0;
        this._proximityThreshold = 0.4; // saniye
        this._proximityRange = 1.5;     // hitRange'den büyük ama çok da değil
        this._forceHit = false;

        this._resetSteering();
        this.buildMesh();
    }

    buildMesh() {
        const geo = new THREE.SphereGeometry(this.radius, 20, 20);
        this.mat = this.renderer.createToonMaterial(0xff8844);
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.castShadow = true;

        const outline = this.renderer.createOutlineMesh(geo, 1.1);
        this.mesh.add(outline);

        // Star pattern (skin'den renk alır)
        this.starGeo = new THREE.CircleGeometry(0.12, 5);
        this.starMat = new THREE.MeshBasicMaterial({ color: 0xffee44, side: THREE.DoubleSide });
        this.star = new THREE.Mesh(this.starGeo, this.starMat);
        this.star.position.z = this.radius + 0.01;
        this.mesh.add(this.star);
        this.star2 = this.star.clone();
        this.star2.position.z = -(this.radius + 0.01);
        this.star2.rotation.y = Math.PI;
        this.mesh.add(this.star2);

        // Glow — small, doesn't bleed through walls
        const glowGeo = new THREE.SphereGeometry(this.radius * 1.15, 16, 16);
        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0xff8844, transparent: true, opacity: 0.06, depthWrite: true, depthTest: true
        });
        this.glow = new THREE.Mesh(glowGeo, this.glowMat);
        this.mesh.add(this.glow);

        this.mesh.visible = false;
        this.scene.add(this.mesh);
    }

    // Skin değiştir — store'dan equippedBall ile eşle.
    setSkin(skinId) {
        const skin = BALL_SKINS[skinId] || BALL_SKINS.classic;
        this.skinId = skinId;
        this.mat.uniforms.uColor.value.setHex(skin.color);
        this.glowMat.color.setHex(skin.glow);
        this.starMat.color.setHex(skin.starColor);
        this.skinConfig = skin;
    }

    spawn() {
        const sp = this.arena.getSpawnPoint();
        this.position.copy(sp);
        this.velocity.set(0, -2, 0);
        this.currentSpeed = this.baseSpeed * (this.skinConfig?.speedBonus || 1);
        this.deflections = 0;
        this.bounceCount = 0;
        this.active = true;
        this.state = 'falling';
        // Ponytail fix: client tarafında update() çağrılmıyor; spawn sonrası mesh'i
        // hemen pozisyona eşitle ki ilk frame'de görünür olsun.
        this.mesh.position.copy(this.position);
        this.mesh.visible = true;
        this.targetPlayer = null;
        this.heldPlayer = null;
        this.aimed = false;
        this.spin = 0;
        this._frozenTimer = 0;
        this.perfectWindow = 0;
        this.chargeLevel = 0;
        this.isCharging = false;
        this.bodyZone = ['head','chest','abdomen','legs'][Math.floor(Math.random() * 4)];
        this.ricochetTarget = null;
        this.lastShotBy = null;
        this._homingAge = 0;
        this._bounceTimestamps = [];
        this._visualPosition = null;
        this._resetSteering();
        this.clearTrail();
        this.updateColor();
        this._lerping = false;
        this._noHitTimer = 0.3;
        this._proximityTimer = 0;
        this._forceHit = false;
        // Reset affix state
        this.affix = null;
        this._affixTrailColor = null;
        this._affixGlowColor = null;
        this._affixOnHit = null;
        this._affixWobble = null;
        this._affixNoGravity = false;
        this._affixFloorBounce = 1;
        this._affixGhost = false;
        this._affixReturn = false;
        this._affixReturnTimer = 0;
        this._pinballBounce = false;
    }

    deactivate() {
        this.active = false;
        this.state = 'idle';
        this.mesh.visible = false;
        this.targetPlayer = null;
        this.lastShotBy = null;
        this._homingAge = 0;
        this._resetSteering();
        this.clearTrail();
        this._lerping = false;
        this.affix = null;
        this._affixTrailColor = null;
        this._affixGlowColor = null;
        this._affixOnHit = null;
        this._affixWobble = null;
        this._affixNoGravity = false;
        this._affixFloorBounce = 1;
        this._affixGhost = false;
        this._affixReturn = false;
        this._affixReturnTimer = 0;
        this._pinballBounce = false;
        this._warmup = false;
        this._noHitTimer = 0;
        this._proximityTimer = 0;
        this._forceHit = false;
        this._affixSplit = false;
        this._affixShrink = false;
        this._affixGrow = false;
        this._affixShrinkTimer = 0;
        this._affixGrowTimer = 0;
    }

    update(dt) {
        // ponytail: client just plays visuals — host runs authoritative physics.
        if (this._clientOnly) {
            this.mesh.position.copy(this.position);
            return false;
        }
        if (!this.active) return;
        const arenaGravity = this.gravity
            * (this.arena.config?.lowGravity ? 0.55 : 1)
            * (this.arena.config?.gameplay?.ballGravityScale ?? 1);
        // ponytail: store previous position for swept sphere hit detection
        this._prevPosition = this.position.clone();
        if (this._noHitTimer > 0) this._noHitTimer -= dt;

        // NaN guard — position bozulursa topu resetle
        if (!finitePoint(this.position)) {
            this.spawn();
            return false;
        }

        // Rainbow skin — HSL döngü
        if (this.skinConfig?.rainbow) {
            const t = performance.now() / 1000;
            const c = new THREE.Color().setHSL((t * 0.3) % 1, 1, 0.55);
            this.mat.uniforms.uColor.value.copy(c);
            this.glowMat.color.copy(c);
        }

        if (this._frozenTimer > 0) {
            // Donmuş — hareket yok, sadece mesh güncellenir
            this.mesh.position.copy(this.position);
            return false;
        }

        if (this.state === 'held') {
            // Stay with player, charge up
            if (this.heldPlayer) {
                const hp = this.heldPlayer.getPosition();
                this.position.copy(hp);
                this.position.y += 0.3;
                this.mesh.position.copy(this.position);
                this.tickCharge(dt);
            }
            return false;
        } else if (this.state === 'orbiting') {
            // Circle around player, speeds up over time, auto-releases
            if (this.heldPlayer && this.orbitTimer > 0) {
                this.orbitTimer -= dt;
                // Speed ramps up: starts slow, ends fast
                const elapsed = (2.5 - this.orbitTimer) / 2.5; // 0→1
                this.orbitSpeed = 6 + elapsed * 18; // 6→24 rad/s
                this.orbitAngle += this.orbitSpeed * dt;
                const hp = this.heldPlayer.getPosition();
                this.position.x = hp.x + Math.cos(this.orbitAngle) * this.orbitRadius;
                this.position.z = hp.z + Math.sin(this.orbitAngle) * this.orbitRadius;
                this.position.y = hp.y + 0.5;
                this.mesh.position.copy(this.position);
            } else if (this.orbitTimer <= 0) {
                // Orbit expired — will be auto-released by game.js
            }
            return false;
        } else if (this.state === 'falling') {
            if (!this._affixNoGravity) this.velocity.y += arenaGravity * dt;
            this.position.add(this.velocity.clone().multiplyScalar(dt));
            if (this.position.y < 4) this.state = 'homing';
        } else if (this.state === 'homing') {
            let dist = 999;
            if (this.targetPlayer) {
                const targetPos = this._getTargetPos();
                const toTarget = new THREE.Vector3().subVectors(targetPos, this.position);
                dist = toTarget.length();
                if (dist > 0.5) {
                    const targetDir = toTarget.clone().normalize();
                    const velDir = this.velocity.clone().normalize();
                    // ponytail: graduated approach — slowing near target for fair deflect window
                    let desired;
                    if (dist < 1.5) {
                        // Very close: mostly momentum (slows approach, player can react)
                        desired = targetDir.clone().lerp(velDir, 0.6).normalize();
                    } else if (dist < 3) {
                        // Close: moderate blend — direct but not instant
                        desired = targetDir.clone().lerp(velDir, 0.3).normalize();
                    } else {
                        const momentum = 0.40;
                        const aimW = Math.min(dist / 10, 1) * momentum;
                        const deflPull = Math.max(0.10, 1 - this.deflections * 0.065);
                        desired = targetDir.clone().lerp(velDir, aimW * deflPull).normalize();
                    }
                    const speedFactor = this.currentSpeed > 500
                        ? 1 + (this.currentSpeed - 500) / 400
                        : 1;
                    this._homingAge = (this._homingAge || 0) + dt;
                    const ageBoost = this._homingAge > 0 ? 1 + Math.floor(this._homingAge / 2.5) * 0.35 : 1;
                    // ponytail: softer steer at close range — prevents aggressive snap
                    const s = dist < 1.5 ? 4.2 : dist < 3 ? 5.6 : 3.5;
                    const steer = Math.min(s * speedFactor * ageBoost * dt, 1);
                    const newDir = velDir.lerp(desired, steer).normalize();
                    this.velocity.copy(newDir.multiplyScalar(this.currentSpeed));
                }
            }
            if (dist >= 2 && !this._affixNoGravity) this.velocity.y += arenaGravity * 0.3 * dt;
            this._clampSpeed();
            this.position.add(this.velocity.clone().multiplyScalar(dt));
        } else if (this.state === 'rally') {
            let dist = 999;
            let playerSteeringDt = null;
            const preSteerVelocity = this.velocity.clone();
            if (this.targetPlayer) {
                const targetPos = this._getTargetPos();
                const toTarget = new THREE.Vector3().subVectors(targetPos, this.position);
                dist = toTarget.length();
                if (this.aimed && this._steeringActive) {
                    playerSteeringDt = this._updatePlayerSteering(dt, targetPos);
                } else if (dist > 0.5) {
                    const targetDir = toTarget.clone().normalize();
                    const velDir = this.velocity.clone().normalize();
                    // ponytail: graduated approach — slowing near target for fair deflect window
                    let desired;
                    if (dist < 1.5) {
                        desired = targetDir.clone().lerp(velDir, 0.6).normalize();
                    } else if (dist < 3) {
                        desired = targetDir.clone().lerp(velDir, 0.3).normalize();
                    } else {
                        const momentum = this.aimed ? 0.64 : 0.40;
                        const aimW = Math.min(dist / 10, 1) * momentum;
                        const deflPull = Math.max(0.10, 1 - this.deflections * 0.065);
                        desired = targetDir.clone().lerp(velDir, aimW * deflPull).normalize();
                    }
                    const speedFactor = this.currentSpeed > 500
                        ? 1 + (this.currentSpeed - 500) / 400
                        : 1;
                    this._homingAge = (this._homingAge || 0) + dt;
                    const ageBoost = this._homingAge > 0 ? 1 + Math.floor(this._homingAge / 2.5) * 0.35 : 1;
                    const s = dist < 1.5 ? 4.2 : dist < 3 ? 5.6 : 3.5;
                    const steer = Math.min(s * speedFactor * ageBoost * dt, 1);
                    const newDir = velDir.lerp(desired, steer).normalize();
                    this.velocity.copy(newDir.multiplyScalar(this.currentSpeed));
                }
            }
            // Close range (<2): skip gravity to avoid orbiting
            const gravityDt = playerSteeringDt ?? dt;
            if (dist >= 2 && !this._affixNoGravity && gravityDt > 0) {
                this.velocity.y += arenaGravity * 0.3 * gravityDt;
            }
            this._clampSpeed();
            if (playerSteeringDt !== null && playerSteeringDt < dt) {
                const displacement = splitSteeringDisplacement(
                    preSteerVelocity,
                    this.velocity,
                    dt,
                    playerSteeringDt
                );
                this.position.add(new THREE.Vector3(displacement.x, displacement.y, displacement.z));
            } else {
                this.position.add(this.velocity.clone().multiplyScalar(dt));
            }

            // Spin remains visual only; physical steering owns the flight path.
            if (Math.abs(this.spin) > 0.001) {
                this.spin *= Math.exp(-0.3 * dt);
            }

            // Ricochet waypoint cleanup
            if (this.ricochetTarget && this.targetPlayer) {
                const toRic = new THREE.Vector3().subVectors(this.ricochetTarget, this.position);
                if (toRic.length() < 3) this.ricochetTarget = null;
            }
        }

        // ponytail: proximity forced-hit — rally/homing durumunda top hedefe
        // _proximityRange içine girdiğinde sayaç başlar. Oyuncu vurmazsa
        // _proximityThreshold sonra _forceHit = true → game.js zorunlu hit uygular.
        // ponytail: also force-hit when ball is VERY close and moving fast (tunneling prevention)
        this._forceHit = false;
        if ((this.state === 'rally' || this.state === 'homing') && this.targetPlayer) {
            const tPos = this._getTargetPos();
            const proxDist = this.position.distanceTo(tPos);
            // Wider proximity range for fast balls — prevents orbiting at high speed
            const effectiveProxRange = this._proximityRange + Math.min(this.currentSpeed * 0.002, 1.5);
            if (proxDist < effectiveProxRange && proxDist > this.hitRange) {
                this._proximityTimer += dt;
                // Faster trigger at high speed — 0.2s instead of 0.4s
                const threshold = this.currentSpeed > 100 ? 0.2 : this._proximityThreshold;
                if (this._proximityTimer >= threshold) {
                    this._forceHit = true;
                    this._proximityTimer = 0;
                }
            } else if (proxDist <= this.hitRange && this.currentSpeed > 80) {
                // Ball is within hit range and moving fast → force hit immediately (tunneling fix)
                this._forceHit = true;
            } else {
                this._proximityTimer = 0;
            }
        } else {
            this._proximityTimer = 0;
        }

        // ponytail: effective hit range scales with speed to prevent tunneling
        this.effectiveHitRange = this.hitRange + Math.min(this.currentSpeed * 0.003, 2.0);

        // Ball affix wobble — sine-wave displacement on XZ
        if (this._affixWobble && this.active) {
            const t = performance.now() / 1000;
            const w = this._affixWobble;
            this.position.x += Math.sin(t * w.freq) * w.amp * dt;
            this.position.z += Math.cos(t * w.freq * 0.7) * w.amp * dt;
        }

        // Chaos affixes: shrink (smaller + faster), grow (bigger + slower)
        if (this._affixShrink && this.active) {
            this._affixShrinkTimer += dt;
            if (this._affixShrinkTimer < 10 && this.radius > 0.15) {
                this.radius -= 0.05 * dt;
                this.mesh.scale.multiplyScalar(1 - 0.05 * dt);
                this.currentSpeed = Math.min(this.currentSpeed * (1 + 0.05 * dt), this.maxSpeed);
            }
        }
        if (this._affixGrow && this.active) {
            this._affixGrowTimer += dt;
            if (this._affixGrowTimer < 10 && this.radius < 2.0) {
                this.radius += 0.05 * dt;
                this.mesh.scale.multiplyScalar(1 + 0.05 * dt);
                this.currentSpeed *= 1 - 0.03 * dt;
            }
        }

        // Wall collision removed — ball goes outside map. Players chase it anywhere.
        let bounced = false;
        let bounceSpeed = 0;

        // Collision with map props (trees, pillars, mecha legs, canyon rocks)
        if (this.arena.collidables) {
            for (const c of this.arena.collidables) {
                if (c.breakable && c.broken) continue;
                const dx = this.position.x - c.pos.x;
                const dz = this.position.z - c.pos.z;
                const dy = Math.abs(this.position.y - c.pos.y);
                const minDist = this.radius + c.radius;
                if (dx * dx + dz * dz < minDist * minDist && dy < c.radius + this.radius + 2) {
                    if (c.breakable && !c.broken) {
                        c.broken = true;
                        c.mesh.visible = false;
                        this.arena.onPinballBreak?.(c);
                    }
                    // Push ball out of the collision cylinder
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if (dist > 0.01) {
                        const overlap = minDist - dist;
                        this.position.x += (dx / dist) * overlap;
                        this.position.z += (dz / dist) * overlap;
                    }
                    // Reflect velocity (cylinder bounce)
                    const normal = dist > 0.01
                        ? new THREE.Vector3(dx / dist, 0, dz / dist)
                        : new THREE.Vector3(1, 0, 0);
                    const dot = this.velocity.dot(normal);
                    if (dot < 0) {
                        const speed = this.velocity.length();
                        this.velocity.addScaledVector(normal, -dot * 1.8);
                        this.velocity.y *= 0.85;
                        bounced = true;
                        this.bounceCount++;
                    }
                    break;
                }
            }
        }

        // Floor bounce — speed-dependent: fast ball bounces higher, slow dies
        if (this.position.y - this.radius < 0) {
            this.position.y = this.radius;
            const speed = this.velocity.length();
            const floorBounce = (0.62 + Math.min(0.33, speed * 0.014)) * this._affixFloorBounce;
            this.velocity.y = Math.max(4.5, Math.abs(this.velocity.y) * floorBounce);
            bounced = true;
            bounceSpeed = Math.max(bounceSpeed, speed * floorBounce);
        }

        // Ceiling (use bounds.maxY as fallback for open-air maps)
        const ceilY = this.arena.ceilingHeight > 0 ? this.arena.ceilingHeight : (this.arena.bounds.maxY || 40);
        if (this.position.y + this.radius > ceilY) {
            this.position.y = ceilY - this.radius;
            const speed = this.velocity.length();
            this.velocity.y = -Math.abs(this.velocity.y) * (0.35 + Math.min(0.3, speed * 0.008));
            bounced = true;
        }

        // ponytail: clamp ball to court bounds with small margin instead of reflecting.
        // Prevents erratic wall-bouncing; ball stays in play, players chase it.
        const bb = this.arena.bounds;
        let wallHit = false;
        if (bb) {
            const m = this.radius + 0.5;
            const wallRestitution = this._pinballBounce ? 1.2 : 0.5;
            if (this.position.x < bb.minX + m) { this.position.x = bb.minX + m; this.velocity.x = Math.abs(this.velocity.x) * wallRestitution; wallHit = true; }
            if (this.position.x > bb.maxX - m) { this.position.x = bb.maxX - m; this.velocity.x = -Math.abs(this.velocity.x) * wallRestitution; wallHit = true; }
            if (this.position.z < bb.minZ + m) { this.position.z = bb.minZ + m; this.velocity.z = Math.abs(this.velocity.z) * wallRestitution; wallHit = true; }
            if (this.position.z > bb.maxZ - m) { this.position.z = bb.maxZ - m; this.velocity.z = -Math.abs(this.velocity.z) * wallRestitution; wallHit = true; }
        }
        if (wallHit) {
            bounced = true;
            bounceSpeed = Math.max(bounceSpeed, this.velocity.length());
        }
        if (bounced && this.targetPlayer && (this.state === 'rally' || this.state === 'homing')) {
            const recovered = recoverCornerHoming(this.velocity, this.position, this._getTargetPos(), this.currentSpeed);
            this.velocity.set(recovered.x, recovered.y, recovered.z);
            this._homingAge = Math.max(this._homingAge || 0, 0.75);
        }

        // Stuck detection: bounce çok hızlı tekrarlıyorsa top sıkışmıştır,
        // random velocity ekleyip döngüyü kır.
        if (bounced) {
            const now = performance.now();
            this._bounceTimestamps.push(now);
            while (this._bounceTimestamps.length > 0 && now - this._bounceTimestamps[0] > 500) {
                this._bounceTimestamps.shift();
            }
            if (this._bounceTimestamps.length >= 6) {
                this.velocity.x += (Math.random() - 0.5) * 8;
                this.velocity.z += (Math.random() - 0.5) * 8;
                this.velocity.y += (Math.random() - 0.5) * 6; // random up/down, not always up
                this._bounceTimestamps.length = 0;
            }
        }

        // Squash/stretch on bounce — quick visual compression then recovery
        if (bounced && bounceSpeed > 0) {
            const squashFactor = Math.min(0.55, bounceSpeed * 0.004);
            this.mesh.scale.set(
                1 + squashFactor * 0.8,
                1 - squashFactor * 0.7,
                1 + squashFactor * 0.8
            );
            this._squashTimer = 0.18;
        }

        // Portal teleport — top portala girince diğerinden çıkar + hız bonusu
        if (this.arena.checkPortalTeleport?.(this.position, this.radius)) {
            this.velocity.multiplyScalar(1.2);
            bounced = true; // ponytail: ses efekti için
        }


        // Portal collision — teleport ball through portals
        if (this.arena?.checkPortalCollision) {
            this.arena.checkPortalCollision(this);
        }

        // Return affix: timer expired → reverse direction
        if (this._affixReturnTimer > 0) {
            this._affixReturnTimer -= dt;
            if (this._affixReturnTimer <= 0) {
                this.velocity.multiplyScalar(-1.2);
                this.currentSpeed = this.velocity.length();
                this._affixReturnTimer = 0;
            }
        }

        // Perfect-catch window tick — hedefe yaklaştığında açılır
        if (this.targetPlayer && this.state === 'rally') {
            const tPos = this._getTargetPos();
            const dist = this.position.distanceTo(tPos);
            if (dist < this.perfectRange && dist > this.hitRange) {
                this.perfectWindow = this.perfectWindowDuration;
            }
        }
        if (this.perfectWindow > 0) this.perfectWindow -= dt;

        // Mesh updates — Source Engine feel: ball visibly spins in curve direction
        this.mesh.position.copy(this.position);
        const baseRot = 2 + this.currentSpeed * 0.15;
        this.mesh.rotation.x += dt * baseRot;
        this.mesh.rotation.z += dt * baseRot * 0.6;
        // Spin axis: when curving, ball spins on Y axis visibly
        this.mesh.rotation.y += dt * this.spin * 3;
        // Add slight visual wobble for strong flick spin.
        if (Math.abs(this.spin) > 0.5) {
            const wobble = Math.sin(performance.now() / 80) * 0.03 * Math.sign(this.spin);
            this.mesh.rotation.x += dt * wobble * this.spin;
        }

        // Squash/stretch recovery — spring back to normal after bounce
        if (this._squashTimer > 0) {
            this._squashTimer -= dt;
            if (this._squashTimer <= 0) {
                this.mesh.scale.set(1, 1, 1);
            } else {
                // Spring back: scale lerps toward 1 each frame
                this.mesh.scale.x += (1 - this.mesh.scale.x) * 0.25;
                this.mesh.scale.y += (1 - this.mesh.scale.y) * 0.25;
                this.mesh.scale.z += (1 - this.mesh.scale.z) * 0.25;
            }
        }

        // Glow — more dramatic at high speed + spin
        if (this._affixGlowColor) {
            this.glowMat.color.setHex(this._affixGlowColor);
        }
        const srGlow = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinGlow = Math.min(0.15, Math.abs(this.spin) * 0.02);
        this.glowMat.opacity = Math.min(0.5, 0.06 + srGlow * 0.035 + spinGlow);
        this.glow.scale.setScalar(Math.min(1.5, 1 + srGlow * 0.05 + spinGlow * 0.5));

        // Trail — denser when moving fast for a smooth comet streak.
        const sp = this.velocity.length();
        this.trailTimer += dt;
        const trailGap = Math.max(0.006, 0.045 - sp * 0.002);
        if (this.trailTimer > trailGap) {
            this.trailTimer = 0;
            this.addTrailDot();
        }
        this.updateTrail(dt);

        return bounced;
    }

    // Body zone vertical offsets from head position
    static BODY_ZONES = {
        head:    { y: 0,     label: 'HEAD' },
        chest:   { y: -0.45, label: 'CHEST' },
        abdomen: { y: -0.85, label: 'BODY' },
        legs:    { y: -1.35, label: 'LEGS' }
    };

    _getTargetPos() {
        if (!this.targetPlayer) return this.position.clone();
        const base = typeof this.targetPlayer.getPosition === 'function'
            ? this.targetPlayer.getPosition()
            : this.targetPlayer.position.clone();
        const basePos = base.clone();
        // Target the torso center (whole body), not a random zone — stable homing point.
        basePos.y = Math.max(0.8, basePos.y - 0.6);
        return basePos;
    }

    // Keep speed locked to currentSpeed — gravity/spin may nudge magnitude, this resets it.
    _resetSteering() {
        this._steeringActive = false;
        this._steeringAge = 0;
        this._steeringTargetSample = null;
        this._steeringTargetVelocity = { x: 0, y: 0, z: 0 };
        this._steeringWaypoint = null;
        this._steeringPlaneNormal = null;
        this._steeringPhase = 'torso';
        this._steeringInitialDir = null;
    }

    _beginPlayerSteering(target, aimDirection) {
        this._resetSteering();
        if (!target || !finitePoint(aimDirection)) return;
        const length = Math.hypot(aimDirection.x, aimDirection.y, aimDirection.z);
        if (length < 0.001) return;
        this._steeringActive = true;
        this._steeringInitialDir = new THREE.Vector3(
            aimDirection.x / length,
            aimDirection.y / length,
            aimDirection.z / length
        );
        const targetPos = this._getTargetPos();
        this._steeringTargetSample = targetPos.clone();
        const wide = createWideWaypoint(this.position, aimDirection, targetPos);
        if (wide) {
            this._steeringPhase = 'waypoint';
            this._steeringWaypoint = new THREE.Vector3(wide.position.x, wide.position.y, wide.position.z);
            this._steeringPlaneNormal = new THREE.Vector3(
                wide.planeNormal.x,
                wide.planeNormal.y,
                wide.planeNormal.z
            );
        }
    }

    _updatePlayerSteering(dt, targetPos) {
        const oldAge = this._steeringAge;
        const steeringDt = steeringActiveDt(oldAge, dt);
        this._steeringAge += Number.isFinite(dt) && dt > 0 ? dt : 0;
        const sampledVelocity = sampleBoundedVelocity(this._steeringTargetSample, targetPos, dt);
        const filteredVelocity = smoothSampledVelocity(this._steeringTargetVelocity, sampledVelocity, dt);
        this._steeringTargetVelocity = filteredVelocity;
        this._steeringTargetSample.copy(targetPos);
        if (steeringDt <= 0) return 0;

        if (this._steeringPhase === 'waypoint'
            && hasCrossedTargetPlane(this.position, targetPos, this._steeringPlaneNormal)) {
            this._steeringPhase = 'torso';
            this._steeringWaypoint = null;
        }
        const target = this._steeringPhase === 'waypoint'
            ? this._steeringWaypoint
            : predictLeadTarget(targetPos, this._steeringTargetVelocity, this.position, this.currentSpeed);
        const desired = new THREE.Vector3(target.x, target.y, target.z).sub(this.position);
        if (desired.lengthSq() < 0.000001) return steeringDt;
        desired.normalize();
        const velocityLength = this.velocity.length();
        const current = velocityLength > 0.001
            ? this.velocity.clone().multiplyScalar(1 / velocityLength)
            : this._steeringInitialDir.clone();
        const targetDistance = desired.length();
        const hasOverstayed = this._steeringAge > 1.15;
        const isCircling = targetDistance < 7 && current.dot(desired.clone().normalize()) < 0.2;
        if (hasOverstayed || isCircling) {
            this._steeringPhase = 'torso';
            this._steeringWaypoint = null;
        }
        const direct = hasOverstayed || isCircling
            ? new THREE.Vector3().subVectors(targetPos, this.position).normalize()
            : desired.normalize();
        const turn = Math.max(steeringTurnAlpha(steeringDt, this.deflections), (hasOverstayed || isCircling) ? 0.18 : 0);
        const next = current.lerp(direct, turn);
        if (finitePoint(next) && next.lengthSq() > 0.000001) {
            this.velocity.copy(next.normalize().multiplyScalar(this.currentSpeed));
        }
        return steeringDt;
    }

    _clampSpeed() {
        if (!Number.isFinite(this.currentSpeed)) this.currentSpeed = this.baseSpeed;
        this.currentSpeed = clamp(this.currentSpeed, 0, this.maxSpeed);
        if (!finitePoint(this.velocity)) {
            const fallback = this._steeringInitialDir || new THREE.Vector3(1, 0, 0);
            this.velocity.copy(fallback).multiplyScalar(this.currentSpeed);
            return;
        }
        const sp = this.velocity.length();
        if (sp > 0.001) {
            this.velocity.multiplyScalar(this.currentSpeed / sp);
        } else if (this.currentSpeed > 0) {
            const fallback = this._steeringInitialDir || new THREE.Vector3(1, 0, 0);
            this.velocity.copy(fallback).normalize().multiplyScalar(this.currentSpeed);
        }
    }

    renderInterpolated(alpha = 1) {
        if (!this.active || !this._prevPosition || !finitePoint(this.position) || !finitePoint(this._prevPosition)) return;
        this.mesh.position.lerpVectors(this._prevPosition, this.position, clamp(alpha, 0, 1));
    }

    getRallyMultiplier() {
        return Math.min(1 + this.deflections * this.rallySpeedStep, this.maxRallyMultiplier);
    }

    getRallySpeed() {
        return this.baseSpeed * this.getRallyMultiplier() * (this.skinConfig?.speedBonus || 1);
    }

    updateColor() {
        const sr = this.currentSpeed / this.baseSpeed;
        // ponytail: orange → pink → red → white as speed increases
        const hue = Math.max(0, 0.08 - (sr - 1) * 0.012);
        const sat = Math.min(1, 0.8 + sr * 0.015);
        const light = Math.min(0.75, 0.55 + sr * 0.02);
        const color = new THREE.Color().setHSL(hue, sat, light);
        this.mat.uniforms.uColor.value.copy(color);
        this.glowMat.color.copy(color);
        // ponytail: glow intensity scales with speed — fast ball = bright glow
        this.glowMat.opacity = Math.min(0.6, 0.2 + sr * 0.04);
    }

    // Genji-style deflection — ball goes EXACTLY where you aim, flick adds spike/lob.
    // flick.vertical: -up (lob) / +down (spike); flick.power 0..1
    // Returns a shot descriptor so the caller can play the right sound / FX.
    deflectWithAim(fromPos, aimDir, target, flick = { vertical: 0, horizontal: 0, power: 0 }, momentum = null, deflectPower = 1.0) {
        this.setTarget(target);
        this.deflections++;
        this._proximityTimer = 0;
        this.bodyZone = ['head','chest','abdomen','legs'][Math.floor(Math.random() * 4)];
        // Source-style rally ramp: fixed steps, no multiplicative snowball.
        this.state = 'rally';
        this.aimed = true;

        // Classify the flick.
        const spike = flick.vertical > 20 && flick.power > 0.25;
        const lob = flick.vertical < -20 && flick.power > 0.25;
        // ponytail: reduced power bonus multiplier to slow exponential ramp
        const powerBonus = 1 + (flick.power || 0) * 0.025;
        let shot = 'flat';
        let speed = this.getRallySpeed() * powerBonus * 1.04;

        if (spike) {
            shot = 'spike';
            speed = this.currentSpeed * 1.2 * powerBonus;
            const dir = aimDir.clone();
            dir.y = Math.min(dir.y - 0.3, -0.1);
            dir.normalize();
            this.velocity.copy(dir.multiplyScalar(speed));
        } else if (lob) {
            shot = 'lob';
            const dir = aimDir.clone();
            dir.y = Math.max(dir.y + 0.3, 0.3);
            dir.normalize();
            this.velocity.copy(dir.multiplyScalar(speed * 0.9));
            this.velocity.y = Math.max(this.velocity.y, 5);
        } else {
            // Full aim direction control — no auto-vertical minimum
            // Player aims exactly where ball goes; walls removed so ball can fly anywhere
            this.velocity.copy(aimDir.clone().normalize().multiplyScalar(speed));
        }

        // Source Engine momentum — player movement adds to ball velocity
        if (momentum) {
            const momLen = momentum.length() || 0;
            const momScale = Math.min(0.3, momLen / 25); // ponytail: cap lower so dash doesn't over-accelerate ball
            this.velocity.x += momentum.x * momScale * 0.3;
            this.velocity.y += Math.abs(momentum.y) * momScale * 0.25;
            this.velocity.z += momentum.z * momScale * 0.3;
        }

        // Flick spin is visual only. Steering controls the physical flight path.
        const flickPower = flick.power || 0;
        this.spin = 0;
        if (flickPower > 0.3) {
            const hSpin = Math.sign(flick.horizontal || 0) * flickPower * 1.4;
            const vSpin = -Math.sign(flick.vertical || 0) * flickPower * 0.9;
            this.spin = Math.min(3.0, Math.max(-3.0, hSpin + vSpin));
        }

        this.currentSpeed = Math.min(speed, this.maxSpeed);
        // Clamp velocity magnitude to currentSpeed so physics stays consistent
        this._clampSpeed();
        this._beginPlayerSteering(target, this.velocity);
        this.lastShot = shot;
        this.updateColor();
        // Return affix: ball reverses after 0.6s, single use
        if (this._affixReturn) {
            this._affixReturnTimer = 0.6;
            this._affixReturn = false; // single use
        }
        return { shot, speed: this.currentSpeed };
    }

    // Simple deflect (for bots) — keeps homing so bots still track targets.
    deflect(fromPos, towardPos, deflectPower = 1.0) {
        this._resetSteering();
        this.deflections++;
        this._proximityTimer = 0;
        this.bodyZone = ['head','chest','abdomen','legs'][Math.floor(Math.random() * 4)];
        // Source-style rally ramp: fixed steps, no multiplicative snowball.
        this.currentSpeed = Math.min(this.getRallySpeed(), this.maxSpeed);
        this.state = 'rally';
        this.aimed = false;

        const dir = new THREE.Vector3().subVectors(towardPos, fromPos).normalize();
        // Bots add slight randomness
        dir.x += (Math.random() - 0.5) * 0.3;
        dir.z += (Math.random() - 0.5) * 0.3;
        dir.normalize();

        this.velocity.copy(dir.multiplyScalar(this.currentSpeed));
        this.velocity.y = Math.max(this.velocity.y, 2 + Math.random() * 2);
        this._clampSpeed();
        this.lastShot = 'flat'; // bots throw flat shots
        this.updateColor();
    }

    setTarget(target) {
        if (this.targetPlayer !== target) this._resetSteering();
        this.targetPlayer = target;
    }
    distanceTo(pos) { return this.position.distanceTo(pos); }
    isInAttackRange(pos) {
        return this.distanceTo(pos) < this.attackRange;
    }
    isHitting(pos) { return this.distanceTo(pos) < this.hitRange; }
    getSpeed() { return this.currentSpeed; }

    // Perfect-catch kontrolü — deflect anında çağrılır.
    // Perfect window aktifse ve mesafe uygunsa perfect = true.
    isPerfectCatch() {
        return this.perfectWindow > 0;
    }

    // Charge-up throw — hold L-Click to charge, release for power.
    // game.js/player.js'den çağrılır. level 0..1.
    startCharge() { this.isCharging = true; this.chargeLevel = 0; }
    tickCharge(dt) { if (this.isCharging) this.chargeLevel = Math.min(1, this.chargeLevel + dt * 1.5); }
    stopCharge() { const l = this.chargeLevel; this.isCharging = false; this.chargeLevel = 0; return l; }
    getChargeLevel() { return this.chargeLevel; }

    // A-D-A-D spin — orbit ball around player (limited time, speeds up)
    startOrbit(holder) {
        this.state = 'orbiting';
        this.heldPlayer = holder;
        this.active = true;
        this.mesh.visible = true;
        this.orbitAngle = Math.random() * Math.PI * 2;
        this.orbitSpeed = 6;   // start slower
        this.orbitRadius = 3.0;
        this.orbitTimer = 2.5; // seconds — auto-release after this
        this.clearTrail();
    }

    orbitRelease(aimDir, target) {
        this.heldPlayer = null;
        this.state = 'rally';
        this.aimed = true;
        // Speed scales with how long you orbited
        const bonus = 1 + Math.max(0, (2.5 - (this.orbitTimer || 0)) / 2.5); // up to 2x at full duration
        const speed = this.baseSpeed * 1.2 * bonus;
        this.currentSpeed = Math.min(speed, this.maxSpeed);
        const dir = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
        this.velocity.copy(dir.multiplyScalar(this.currentSpeed));
        this.velocity.y = this.currentSpeed * 0.25;
        this.setTarget(target);
        this._beginPlayerSteering(target, this.velocity);
        this.orbitAngle = 0;
        this.orbitSpeed = 0;
        this.orbitRadius = 0;
        this.orbitTimer = 0;
        return { shot: 'flat', speed: this.currentSpeed };
    }

    // Catch — scoop up ball, hold for charged throw (Right Click)
    catchBall(holder) {
        this.state = 'held';
        this.heldPlayer = holder;
        this.active = true;
        this.mesh.visible = true;
        this.clearTrail();
        this.startCharge();
    }

    // Release — throw held ball with charge bonus (Left Click or auto-release)
    releaseBall(aimDir, target) {
        const charge = this.stopCharge();
        this.heldPlayer = null;
        this.state = 'rally';
        this.aimed = true;
        const speed = this.baseSpeed * (1 + charge * 0.8);
        this.currentSpeed = Math.min(speed, this.maxSpeed);
        const dir = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
        this.velocity.copy(dir.multiplyScalar(this.currentSpeed));
        this.velocity.y = this.currentSpeed * 0.25;
        this._clampSpeed();
        this.setTarget(target);
        this._beginPlayerSteering(target, this.velocity);
        return { shot: charge > 0.7 ? 'spike' : 'flat', speed: this.currentSpeed };
    }

    addTrailDot() {
        const sr = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinFactor = Math.min(1, Math.abs(this.spin) * 0.3);
        // ponytail: bigger trail dots at high speed for dramatic streak
        const skinTrailMul = this.skinConfig?.burstTrail ? 1.7 : this.skinConfig?.frostTrail ? 1.35 : 1;
        const r = Math.min(0.27, 0.052 * skinTrailMul * (1 + sr * 0.55 + spinFactor * 0.35));
        const trailColor = this._affixTrailColor ?? (this.skinConfig?.trail || 0xff2222);
        const dot = this._trailPool.acquire();
        dot.visible = true;
        dot.material.color.setHex(trailColor);
        dot.material.opacity = Math.min(0.9, 0.56 + sr * 0.08 + (this.skinConfig?.frostTrail ? 0.12 : 0));
        dot.scale.setScalar(r);
        dot.position.copy(this.position);
        // Spin offset — trail spreads slightly in curve direction
        if (Math.abs(this.spin) > 1) {
            const offset = 0.08 * Math.sign(this.spin);
            dot.position.x += offset;
            dot.position.z += offset;
        }
        this.scene.add(dot);
        // Faster ball = longer trail life
        const maxLife = 0.38 + sr * 0.23;
        this.trail.push({ mesh: dot, life: maxLife, maxLife, radius: r });
        const maxTrail = 38 + Math.round(sr * 22);
        if (this.trail.length > maxTrail) {
            const old = this.trail.shift();
            this._trailPool.release(old.mesh);
        }
    }

    updateTrail(dt) {
        for (let i = this.trail.length - 1; i >= 0; i--) {
            const t = this.trail[i];
            t.life -= dt;
            const ratio = Math.max(0, t.life / t.maxLife);
            t.mesh.material.opacity = ratio * 0.8;
            t.mesh.scale.setScalar(Math.max(0.01, t.radius * ratio));
            if (t.life <= 0) {
                this._trailPool.release(t.mesh);
                this.trail.splice(i, 1);
            }
        }
    }

    clearTrail() {
        this.trail.forEach(t => {
            this._trailPool.release(t.mesh);
        });
        this.trail = [];
    }

    // Client-side: visual-only update when lerping from network
    _clientVisualUpdate(dt) {
        if (!this._visualPosition) this._visualPosition = this.mesh.position.clone();
        const blend = 1 - Math.exp(-22 * Math.min(Math.max(dt || 0, 0), 0.05));
        this._visualPosition.lerp(this.position, blend);
        this.mesh.position.copy(this._visualPosition);
        if (this._noHitTimer > 0) this._noHitTimer -= dt;

        // Rotation
        const baseRot = 2 + this.currentSpeed * 0.15;
        this.mesh.rotation.x += dt * baseRot;
        this.mesh.rotation.z += dt * baseRot * 0.6;
        this.mesh.rotation.y += dt * this.spin * 3;

        // Squash recovery
        if (this._squashTimer > 0) {
            this._squashTimer -= dt;
            if (this._squashTimer <= 0) {
                this.mesh.scale.set(1, 1, 1);
            } else {
                this.mesh.scale.x += (1 - this.mesh.scale.x) * 0.25;
                this.mesh.scale.y += (1 - this.mesh.scale.y) * 0.25;
                this.mesh.scale.z += (1 - this.mesh.scale.z) * 0.25;
            }
        }

        // Glow
        if (this._affixGlowColor) {
            this.glowMat.color.setHex(this._affixGlowColor);
        }
        const srGlow = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinGlow = Math.min(0.15, Math.abs(this.spin) * 0.02);
        this.glowMat.opacity = Math.min(0.5, 0.06 + srGlow * 0.035 + spinGlow);
        this.glow.scale.setScalar(Math.min(1.5, 1 + srGlow * 0.05 + spinGlow * 0.5));

        // Trail
        const sp = this.velocity.length();
        this.trailTimer += dt;
        const trailGap = Math.max(0.006, 0.045 - sp * 0.002);
        if (this.trailTimer > trailGap) {
            this.trailTimer = 0;
            this.addTrailDot();
        }
        this.updateTrail(dt);
    }
}
