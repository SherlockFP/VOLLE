// ball.js — Rally ball with aim-based direction, slow speed scaling, bounce, arc,
// skin system, portal teleport, freeze support.
import * as THREE from 'three';

// ponytail: top skin'leri — görsel + küçük efekt. Store ile eşle.
export const BALL_SKINS = {
    classic:   { name: 'Classic Volleyball', color: 0xff8844, glow: 0xff8844, trail: 0xff8844, starColor: 0xffee44 },
    fire:      { name: 'Fireball',           color: 0xff3322, glow: 0xff5500, trail: 0xff6600, starColor: 0xffaa00, speedBonus: 1.05 },
    ice:       { name: 'Ice Sphere',         color: 0x88ccff, glow: 0xaaeeff, trail: 0xaaddff, starColor: 0xffffff, slowEffect: true },
    lightning: { name: 'Lightning Orb',      color: 0xffee44, glow: 0xffff88, trail: 0xffff66, starColor: 0xffffff },
    bomb:      { name: 'Bomb Ball',          color: 0x222222, glow: 0xff4400, trail: 0xff6600, starColor: 0xff4400, burstEffect: true },
    star:      { name: 'Star Core',          color: 0xffdd44, glow: 0xffffaa, trail: 0xffee88, starColor: 0xffffff },
    rainbow:   { name: 'Rainbow',            color: 0xff00ff, glow: 0xffffff, trail: 0xff00ff, starColor: 0xffffff, rainbow: true }
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
        this.speedMultiplier = 1.08;            // her deflect %6 ramp
        this.maxSpeed = 80;                     // ponytail: real cap — 999 was no cap, caused runaway
        this.deflections = 0;
        this.radius = 0.45;
        this.attackRange = 2.0;
        this.catchRange = 2.0;
        this.hitRange = 0.7;
        this.active = false;
        this.targetPlayer = null;
        this.state = 'idle';
        this.skinId = 'classic';

        this.trail = [];
        this.trailTimer = 0;
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
        this.clearTrail();
        this.updateColor();
        this._lerping = false;
    }

    deactivate() {
        this.active = false;
        this.state = 'idle';
        this.mesh.visible = false;
        this.targetPlayer = null;
        this.lastShotBy = null;
        this._homingAge = 0;
        this.clearTrail();
        this._lerping = false;
    }

    update(dt) {
        // ponytail: client just plays visuals — host runs authoritative physics.
        if (this._clientOnly) {
            this.mesh.position.copy(this.position);
            return false;
        }
        if (!this.active) return;

        // NaN guard — position bozulursa topu resetle
        if (isNaN(this.position.x) || isNaN(this.position.y) || isNaN(this.position.z)) {
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
            this.velocity.y += this.gravity * dt;
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
                    const momentum = this.aimed ? 0.55 : 0.30;
                    const aimW = dist < 3
                        ? (dist / 3) * momentum * 0.15
                        : Math.min(dist / 10, 1) * momentum;
                    // ponytail: 500+ hızda çekim gücü ramp — hızlandıkça top hedefe daha güçlü çekilsin
                    const speedFactor = this.currentSpeed > 500
                        ? 1 + (this.currentSpeed - 500) / 400
                        : 1;
                    // ponytail: her 2 saniyede bir homing çekimi +%50 artsın (geçici)
                    this._homingAge = (this._homingAge || 0) + dt;
                    const ageBoost = this._homingAge > 0 ? 1 + Math.floor(this._homingAge / 2) * 0.5 : 1;
                    const deflPull = Math.max(0.10, 1 - this.deflections * 0.065);
                    const desired = targetDir.clone().lerp(velDir, aimW * deflPull).normalize();
                    const s = dist < 3 ? 28.0 : 11.4;
                    const steer = Math.min(s * speedFactor * ageBoost * dt, 1);
                    const newDir = velDir.lerp(desired, steer).normalize();
                    this.velocity.copy(newDir.multiplyScalar(this.currentSpeed));
                }
            }
            if (dist >= 2) this.velocity.y += this.gravity * 0.3 * dt;
            this._clampSpeed();
            this.position.add(this.velocity.clone().multiplyScalar(dt));
        } else if (this.state === 'rally') {
            let dist = 999;
            if (this.targetPlayer) {
                const targetPos = this._getTargetPos();
                const toTarget = new THREE.Vector3().subVectors(targetPos, this.position);
                dist = toTarget.length();
                if (dist > 0.5) {
                    const targetDir = toTarget.clone().normalize();
                    const velDir = this.velocity.clone().normalize();
                    const momentum = this.aimed ? 0.55 : 0.30;
                    const aimW = dist < 3
                        ? (dist / 3) * momentum * 0.15
                        : Math.min(dist / 10, 1) * momentum;
                    const speedFactor = this.currentSpeed > 500
                        ? 1 + (this.currentSpeed - 500) / 400
                        : 1;
                    this._homingAge = (this._homingAge || 0) + dt;
                    const ageBoost = this._homingAge > 0 ? 1 + Math.floor(this._homingAge / 2) * 0.5 : 1;
                    const deflPull = Math.max(0.10, 1 - this.deflections * 0.065);
                    const desired = targetDir.clone().lerp(velDir, aimW * deflPull).normalize();
                    const s = dist < 3 ? 28.0 : 11.4;
                    const steer = Math.min(s * speedFactor * ageBoost * dt, 1);
                    const newDir = velDir.lerp(desired, steer).normalize();
                    this.velocity.copy(newDir.multiplyScalar(this.currentSpeed));
                }
            }
            // Close range (<2): skip gravity to avoid orbiting
            if (dist >= 2) {
                this.velocity.y += this.gravity * 0.3 * dt;
            }
            this._clampSpeed();
            this.position.add(this.velocity.clone().multiplyScalar(dt));

            // Ricochet waypoint cleanup
            if (this.ricochetTarget && this.targetPlayer) {
                const toRic = new THREE.Vector3().subVectors(this.ricochetTarget, this.position);
                if (toRic.length() < 3) this.ricochetTarget = null;
            }
        }

        // Source Engine-style curve from flick spin:
        // - Horizontal spin bends the ball mid-flight (like a curveball)
        // - Magnus effect lifts/drops ball based on spin direction
        // - Spin fades gradually so curve tapers naturally
        if (Math.abs(this.spin) > 0.001) {
            const speed = this.velocity.length();
            const vx = this.velocity.x, vz = this.velocity.z;
            const s = this.spin * dt * (1 + speed * 0.01); // faster ball = sharper curve
            this.velocity.x = vx * Math.cos(s) - vz * Math.sin(s);
            this.velocity.z = vx * Math.sin(s) + vz * Math.cos(s);

            // Magnus vertical lift — spin × speed curves ball up/down
            const magnus = this.spin * speed * 0.4 * dt;
            this.velocity.y += magnus;

            // Spin decay — slower fade = longer curve
            this.spin *= Math.exp(-0.8 * dt); // was -1.5, longer-lasting curve
        }

        // Wall collision removed — ball goes outside map. Players chase it anywhere.
        let bounced = false;
        let bounceSpeed = 0;

        // Collision with map props (trees, pillars, mecha legs, canyon rocks)
        if (this.arena.collidables) {
            for (const c of this.arena.collidables) {
                const dx = this.position.x - c.pos.x;
                const dz = this.position.z - c.pos.z;
                const dy = Math.abs(this.position.y - c.pos.y);
                const minDist = this.radius + c.radius;
                if (dx * dx + dz * dz < minDist * minDist && dy < c.radius + this.radius + 2) {
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
            const floorBounce = 0.62 + Math.min(0.33, speed * 0.014);
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
        // Add slight wobble from Magnus effect when curving hard
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
        const srGlow = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinGlow = Math.min(0.15, Math.abs(this.spin) * 0.02);
        this.glowMat.opacity = Math.min(0.5, 0.06 + srGlow * 0.035 + spinGlow);
        this.glow.scale.setScalar(Math.min(1.5, 1 + srGlow * 0.05 + spinGlow * 0.5));

        // Trail — denser when moving fast for a smooth comet streak.
        const sp = this.velocity.length();
        this.trailTimer += dt;
        const trailGap = Math.max(0.008, 0.05 - sp * 0.002);
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
    _clampSpeed() {
        const sp = this.velocity.length();
        if (sp > 0.001) this.velocity.multiplyScalar(this.currentSpeed / sp);
    }

    updateColor() {
        const sr = this.currentSpeed / this.baseSpeed;
        // Orange → pink → red as speed increases
        const hue = Math.max(0, 0.08 - (sr - 1) * 0.015);
        const sat = Math.min(1, 0.8 + sr * 0.02);
        const color = new THREE.Color().setHSL(hue, sat, 0.55);
        this.mat.uniforms.uColor.value.copy(color);
        this.glowMat.color.copy(color);
    }

    // Genji-style deflection — ball goes EXACTLY where you aim, flick adds spike/lob.
    // flick.vertical: -up (lob) / +down (spike); flick.power 0..1
    // Returns a shot descriptor so the caller can play the right sound / FX.
    deflectWithAim(fromPos, aimDir, target, flick = { vertical: 0, horizontal: 0, power: 0 }, momentum = null) {
        this.deflections++;
        this.bodyZone = ['head','chest','abdomen','legs'][Math.floor(Math.random() * 4)];
        // Speed ramp: gentle curve after 500% to avoid 6000-8000% bug
        const speedPct = this.currentSpeed / this.baseSpeed;
        let rampMul = this.speedMultiplier;
        if (speedPct > 5) rampMul = 1 + (this.speedMultiplier - 1) * (5 / speedPct);
        this.currentSpeed = Math.min(this.currentSpeed * rampMul, this.maxSpeed);
        this.state = 'rally';
        this.aimed = true;

        // Classify the flick.
        const spike = flick.vertical > 20 && flick.power > 0.25;
        const lob = flick.vertical < -20 && flick.power > 0.25;
        const powerBonus = 1 + (flick.power || 0) * 0.2;
        let shot = 'flat';
        let speed = this.currentSpeed * powerBonus;

        if (spike) {
            shot = 'spike';
            speed = Math.min(this.currentSpeed * 1.2 * powerBonus, this.maxSpeed * 1.1);
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
            const momScale = Math.min(1, momLen / 12); // full effect at 12 m/s
            this.velocity.x += momentum.x * momScale * 0.9;
            this.velocity.y += Math.abs(momentum.y) * momScale * 0.6;
            this.velocity.z += momentum.z * momScale * 0.9;
        }

        // Source Engine-style spin from flick:
        // - Horizontal flick → side curve (bend the ball like a curveball)
        // - Vertical flick down → topspin (ball dips faster = spike)
        // - Vertical flick up → backspin (ball floats/lifts = lob)
        // Only apply spin on a real flick, not from normal mouse aiming.
        const flickPower = flick.power || 0;
        this.spin = 0;
        if (flickPower > 0.3) {
            const hSpin = Math.sign(flick.horizontal || 0) * flickPower * 0.8;
            const vSpin = -Math.sign(flick.vertical || 0) * flickPower * 0.5;
            this.spin = Math.min(1.5, Math.max(-1.5, hSpin + vSpin));
        }

        this.currentSpeed = speed;
        this.lastShot = shot; // ponytail fix: game.handleHit reads this for spike dmg bonus
        this.updateColor();
        return { shot, speed };
    }

    // Simple deflect (for bots) — keeps homing so bots still track targets.
    deflect(fromPos, towardPos) {
        this.deflections++;
        this.bodyZone = ['head','chest','abdomen','legs'][Math.floor(Math.random() * 4)];
        const speedPct = this.currentSpeed / this.baseSpeed;
        let rampMul = this.speedMultiplier;
        if (speedPct > 5) rampMul = 1 + (this.speedMultiplier - 1) * (5 / speedPct);
        this.currentSpeed = Math.min(this.currentSpeed * rampMul, this.maxSpeed);
        this.state = 'rally';
        this.aimed = false;

        const dir = new THREE.Vector3().subVectors(towardPos, fromPos).normalize();
        // Bots add slight randomness
        dir.x += (Math.random() - 0.5) * 0.3;
        dir.z += (Math.random() - 0.5) * 0.3;
        dir.normalize();

        this.velocity.copy(dir.multiplyScalar(this.currentSpeed));
        this.velocity.y = Math.max(this.velocity.y, 2 + Math.random() * 2);
        this.lastShot = 'flat'; // bots throw flat shots
        this.updateColor();
    }

    setTarget(target) { this.targetPlayer = target; }
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
        this.setTarget(target);
        return { shot: charge > 0.7 ? 'spike' : 'flat', speed: this.currentSpeed };
    }

    addTrailDot() {
        const sr = Math.min(4, this.currentSpeed / this.baseSpeed); // cap sr at 4x
        const spinFactor = Math.min(1, Math.abs(this.spin) * 0.3);
        const r = Math.min(0.15, 0.04 * (1 + sr * 0.4 + spinFactor * 0.3)); // cap radius
        const geo = new THREE.SphereGeometry(r, 4, 4);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff2222,
            transparent: true, opacity: 0.6
        });
        const dot = new THREE.Mesh(geo, mat);
        dot.position.copy(this.position);
        // Spin offset — trail spreads slightly in curve direction
        if (Math.abs(this.spin) > 1) {
            const offset = 0.08 * Math.sign(this.spin);
            dot.position.x += offset;
            dot.position.z += offset;
        }
        this.scene.add(dot);
        // Faster ball = longer trail life
        const maxLife = 0.3 + sr * 0.15;
        this.trail.push({ mesh: dot, life: maxLife });
        const maxTrail = 30 + Math.round(sr * 15);
        if (this.trail.length > maxTrail) {
            const old = this.trail.shift();
            this.scene.remove(old.mesh);
            old.mesh.geometry.dispose();
            old.mesh.material.dispose();
        }
    }

    updateTrail(dt) {
        for (let i = this.trail.length - 1; i >= 0; i--) {
            const t = this.trail[i];
            t.life -= dt;
            t.mesh.material.opacity = Math.max(0, t.life * 1.4);
            t.mesh.scale.setScalar(Math.max(0.05, t.life * 1.8));
            if (t.life <= 0) {
                this.scene.remove(t.mesh);
                t.mesh.geometry.dispose();
                t.mesh.material.dispose();
                this.trail.splice(i, 1);
            }
        }
    }

    clearTrail() {
        this.trail.forEach(t => {
            this.scene.remove(t.mesh);
            t.mesh.geometry.dispose();
            t.mesh.material.dispose();
        });
        this.trail = [];
    }

    // Client-side: visual-only update when lerping from network
    _clientVisualUpdate(dt) {
        this.mesh.position.copy(this.position);

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
        const srGlow = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinGlow = Math.min(0.15, Math.abs(this.spin) * 0.02);
        this.glowMat.opacity = Math.min(0.5, 0.06 + srGlow * 0.035 + spinGlow);
        this.glow.scale.setScalar(Math.min(1.5, 1 + srGlow * 0.05 + spinGlow * 0.5));

        // Trail
        const sp = this.velocity.length();
        this.trailTimer += dt;
        const trailGap = Math.max(0.008, 0.05 - sp * 0.002);
        if (this.trailTimer > trailGap) {
            this.trailTimer = 0;
            this.addTrailDot();
        }
        this.updateTrail(dt);
    }
}
