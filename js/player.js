// player.js — FPS controller with jump, aim-based throw, death/respawn,
// character loadout, skill/rune system, stamina-based spam protection, damage meter.
import * as THREE from 'three';
import { applyCharacter } from './characters.js';
import { applyRunes, tickSkillCooldowns, useSkill, DEFAULT_LOADOUT, ULTIMATES } from './skills.js';

const STAMINA_PER_DEFLECT = 7;
const STAMINA_REGEN = 20;     // per second
const STAMINA_EXHAUST_THRESHOLD = 15;
const ATTACK_COOLDOWN = 0.6;  // spam protection — wider window for fast balls
const BASE_HIT_DAMAGE = 25;

export class Player {
    constructor(renderer, camera, arena) {
        this.renderer = renderer;
        this.camera = camera;
        this.arena = arena;
        this.scene = renderer.scene;

        this.position = new THREE.Vector3(0, 1.7, -10);
        this.velocity = new THREE.Vector3();
        this.speed = 10;
        this.height = 1.7;
        this.radius = 0.7;          // ponytail: hand clipping fix — walls'a daha uzak

        // Jump — double jump
        this.jumpForce = 8;
        this.gravity = -20;
        this.onGround = true;
        this.verticalVel = 0;
        this.jumpsRemaining = 2;  // ponytail: double jump, reset on ground

        // Mouse
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.sensitivity = 0.002;
        this.locked = false;

        // Flick tracking — recent mouse motion for Genji-style spike/lob
        this.flickX = 0;      // smoothed horizontal motion
        this.flickY = 0;      // smoothed vertical motion (negative = flick down)
        this.flickDecay = 12; // how fast flick energy fades

        // Camera kick (recoil punch on deflect) — decays back to 0
        this.kickAmt = 0;
        this.kickTarget = 0;
        this.killcamLock = false;

        // Attack + SPAM PROTECTION (stamina gate)
        this.keys = {};
        this.team = 'red';
        this.attacking = false;
        this.catchRequested = false;
        this.attackCooldown = 0;
        this.attackDuration = ATTACK_COOLDOWN;
        this.canAttack = true;
        this.swingAnim = 0;
        this.stamina = 100;          // ponytail: stamina gate blocks mouse-1 spam
        this.staminaMax = 100;
        this.exhausted = false;

        // Sprint — hold Shift, drains stamina
        this.sprintMultiplier = 1.3;
        this.sprintDrain = 50;       // stamina per second (net after regen block)

        // Dash — tap Ctrl, burst in movement direction
        this.dashCooldown = 0;
        this.dashCost = 25;
        this.dashForce = 12;
        this.dashDuration = 0.12;
        this.dashTimer = 0;
        this.dashDir = new THREE.Vector3();
        this._dashWasDown = false;

        // A-D-A-D spin dodge — rapid strafe to orbit ball
        this._strafeHistory = [];  // [{ key: 'A'|'D', time }]

        // State
        this.alive = true;
        this.deathTimer = 0;

        // Health & combat — karakter + rune ile override edilir
        this.maxHp = 100;
        this.hp = 100;
        this._baseMaxHp = 100;
        this._baseSpeed = 10;
        this.consecutiveMisses = 0;  // tutamama ramp'i
        this.shield = 0;
        this.deflectPower = 1.0;
        this.charId = 'rally';
        this.passive = 'none';

        // Loadout
        this.loadout = { ...DEFAULT_LOADOUT };
        this.skillCooldowns = {};
        this.runeBonuses = {};

        // Damage meter
        this.totalDamageDealt = 0;
        this.totalDamageTaken = 0;
        this.lastDamageAt = 0;

        // Chat bubble
        this.chatBubble = null;
        this.chatTimer = 0;

        // Ultimate
        this.ultimateCharge = 0;    // 0-100
        this.ultimateActive = false;
        this.ultimateTimer = 0;

        this.buildHandMesh();
        this.setupInput();
    }

    // Karakter + rune loadout uygula (lobby'den veya store'dan).
    applyLoadout(charId, runeIds) {
        const c = applyCharacter(this, charId);
        this._baseMaxHp = c.maxHp;
        this._baseSpeed = c.speed;
        if (runeIds && runeIds.length) {
            applyRunes(this, runeIds);
            this.loadout.runes = runeIds;
        }
        this.loadout.char = charId;
    }

    buildHandMesh() {
        // Right arm — closer to camera + shorter for wall clipping fix
        this.armGroup = new THREE.Group();
        this.armGroup.position.set(0.25, -0.2, -0.1);

        const armGeo = new THREE.BoxGeometry(0.1, 0.1, 0.3);
        this.armMat = this.renderer.createToonMaterial(
            this.team === 'red' ? 0xee5555 : 0x5577dd,
        );
        this.armMesh = new THREE.Mesh(armGeo, this.armMat);
        this.armMesh.position.set(0, 0, -0.1);
        this.armGroup.add(this.armMesh);

        const handGeo = new THREE.BoxGeometry(0.12, 0.11, 0.12);
        const handMat = this.renderer.createToonMaterial(0xf5c6a0);
        this.handMesh = new THREE.Mesh(handGeo, handMat);
        this.handMesh.position.set(0, 0, -0.28);
        this.armGroup.add(this.handMesh);

        const gloveGeo = new THREE.SphereGeometry(0.09, 8, 8);
        this.gloveMat = this.renderer.createToonMaterial(
            this.team === 'red' ? 0xee5555 : 0x5577dd,
        );
        this.gloveMesh = new THREE.Mesh(gloveGeo, this.gloveMat);
        this.gloveMesh.position.set(0, 0, -0.36);
        this.armGroup.add(this.gloveMesh);

        this.camera.add(this.armGroup);
        this.armGroup.visible = false; // default off — toggle via sv_hand

        // ponytail: tek el — sol el kaldırıldı
    }

    setHandVisible(on) {
        this.armGroup.visible = on;
    }

    setupInput() {
        // ponytail: AbortController so game restart doesn't accumulate listeners
        this._abort = new AbortController();
        const signal = this._abort.signal;
        document.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            // Track strafe pattern for spin-dodge (A-D-A-D)
            if (e.code === 'KeyA' || e.code === 'KeyD') {
                const now = performance.now();
                this._strafeHistory.push({ key: e.code, time: now });
                // Keep only last 8 events within 1 second
                while (this._strafeHistory.length > 0 && now - this._strafeHistory[0].time > 1000) {
                    this._strafeHistory.shift();
                }
            }
        }, { signal });
        document.addEventListener('keyup', e => { this.keys[e.code] = false; }, { signal });
        document.addEventListener('mousemove', e => {
            // Pointer lock OPTIONAL: camera turns with or without it (movementX/Y works ungated).
            // Only look during live play and when not typing in a chat/text input.
            if (!this.alive) return;
            const st = this.game?.state;
            if (st !== 'PLAYING' && st !== 'COUNTDOWN') return;
            if (st === 'PAUSED') return;
            if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
            this.euler.y -= e.movementX * this.sensitivity;
            this.euler.x -= e.movementY * this.sensitivity;
            this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
            this.camera.quaternion.setFromEuler(this.euler);

            // Accumulate flick energy (raw pixel motion this frame)
            this.flickX += e.movementX;
            this.flickY += e.movementY; // +down, -up on screen
        }, { signal });
        document.addEventListener('mousedown', e => {
            // ponytail: pointer lock re-activation removed — causes mouse bug during pause
            if (e.button === 0 && this.alive && this.game?.state === 'PLAYING') {
                this.tryAttack();
            }
        }, { signal });
        // ponytail: Q tuşu aktif skill (sadece oyun sırasında)
        document.addEventListener('keydown', e => {
            if (e.code === 'KeyQ' && this.alive && this.game?.state === 'PLAYING') {
                this._skillQueued = true;
            }
        }, { signal });
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === this.renderer.domElement;
        }, { signal });
    }

    cleanupInput() {
        this._abort?.abort();
        this._abort = null;
    }

    lock() { try { this.renderer.domElement.requestPointerLock(); } catch (_) {} }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    tryAttack() {
        // SPAM PROTECTION: stamina yetersizse veya cooldown varsa attack yok.
        // Mouse-1 spam ile sınırsız top atılamaz.
        if (this._celebNoAttack) return false; // celebration'da loser'lar vuramaz
        if (this.attackCooldown > 0) return false;
        if (this.stamina < STAMINA_PER_DEFLECT) {
            this.exhausted = true;
            return false;
        }
        this.stamina -= STAMINA_PER_DEFLECT;
        if (this.stamina < STAMINA_EXHAUST_THRESHOLD) this.exhausted = true;
        this.attacking = true;
        this.attackCooldown = this.attackDuration;
        this.canAttack = false;
        this.swingAnim = 1.0;
        this._p2pAttackQueued = true; // main.js P2P attack intent yollar
        return true;
    }

    // Aktif skill kullan (Q tuşu). Context: { ball, target }.
    tryUseSkill(context) {
        return useSkill(this, this.loadout.skill, context);
    }

    addUltimateCharge(amount) {
        if (this.ultimateActive) return;
        this.ultimateCharge = Math.min(100, this.ultimateCharge + amount);
    }

    useUltimate() {
        if (this.ultimateCharge < 100 || this.ultimateActive) return null;
        this.ultimateCharge = 0;
        this.ultimateActive = true;
        const ult = ULTIMATES[this.charId];
        this.ultimateTimer = ult?.duration || 0;
        return ult;
    }

    // Get aim direction (where camera looks)
    getAimDirection() {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        return dir.normalize();
    }

    // Flick state at the moment of a swing — used for spike/lob.
    // Returns { vertical, horizontal, power } in normalized-ish units.
    getFlick() {
        // vertical: negative = flicking up (lob), positive = flicking down (spike)
        return {
            vertical: this.flickY,
            horizontal: this.flickX,
            power: Math.min(1, Math.hypot(this.flickX, this.flickY) / 90)
        };
    }

    // Camera recoil punch when deflecting.
    kick(shot) {
        this.kickAmt = shot === 'spike' ? 0.12 : shot === 'lob' ? 0.06 : 0.08;
    }

    update(dt) {
        if (!this.alive) {
            this.deathTimer -= dt;
            // ponytail: auto-respawn after death timer expires (round-mid death)
            if (this.deathTimer <= 0 && this.game?.state === 'PLAYING') {
                this.respawn();
            }
            return;
        }

        // Stamina regen (skip if holding Shift while moving)
        const holdingShift = (this.keys['ShiftLeft'] || this.keys['ShiftRight']);
        if (!holdingShift || !this.onGround) {
            const regenRate = this.exhausted ? STAMINA_REGEN * 0.4 : STAMINA_REGEN;
            const stamBonus = 1 + (this.runeBonuses?.stamRegen || 0)
                + (this.passive === 'fast_stam' ? 0.5 : 0);
            this.stamina = Math.min(this.staminaMax, this.stamina + regenRate * stamBonus * dt);
        }
        if (this.exhausted && this.stamina >= STAMINA_EXHAUST_THRESHOLD) this.exhausted = false;

        // Skill cooldowns tick
        tickSkillCooldowns(this, dt);

        // Guardian shield regen pasifi
        if (this.passive === 'shield_regen') {
            this._shieldRegenTimer = (this._shieldRegenTimer || 0) + dt;
            if (this._shieldRegenTimer >= 3) {
                this._shieldRegenTimer = 0;
                this.shield = Math.min((this.shield || 0) + 5, this.maxHp * 0.5);
            }
        }

        // Burn DOT (skill ile yakıldıysa)
        if (this._burnTimer > 0) {
            this._burnTimer -= dt;
            this._burnTickTimer = (this._burnTickTimer || 0) + dt;
            if (this._burnTickTimer >= 1) {
                this._burnTickTimer = 0;
                this.takeDamage(5);
            }
        }

        // Chill slow (skill ile yavaşlatıldıysa)
        const chillMul = this._chillTimer > 0 ? 0.8 : 1;
        if (this._chillTimer > 0) this._chillTimer -= dt;

        // Flick energy decays toward 0 each frame
        const decay = Math.exp(-this.flickDecay * dt);
        this.flickX *= decay;
        this.flickY *= decay;

        // Attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= dt;
            if (this.attackCooldown <= 0) {
                this.attacking = false;
                this.canAttack = true;
            }
        }

        // Swing anim
        if (this.swingAnim > 0) {
            this.swingAnim -= dt * 6;
            if (this.swingAnim < 0) this.swingAnim = 0;
            const swing = Math.sin(this.swingAnim * Math.PI) * 0.7;
            this.armGroup.rotation.x = -swing;
            this.armGroup.position.z = -0.3 - swing * 0.3;
        } else {
            const bob = Math.sin(performance.now() / 600) * 0.008;
            this.armGroup.position.y = -0.3 + bob;
            this.armGroup.rotation.x = 0;
            this.armGroup.position.z = -0.3;
        }

        // Movement (chill yavaşlatması uygulanır)
        const prevPos = this.position.clone();
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDir = new THREE.Vector3();
        if (this.keys['KeyW']) moveDir.add(forward);
        if (this.keys['KeyS']) moveDir.sub(forward);
        if (this.keys['KeyA']) moveDir.sub(right);
        if (this.keys['KeyD']) moveDir.add(right);

        // Dash — tap Ctrl for burst in movement direction
        this.dashCooldown -= dt;
        if (this.dashTimer > 0) {
            // Dashing: move at burst speed
            this.position.add(this.dashDir.clone().multiplyScalar(this.dashForce * dt));
            this.dashTimer -= dt;
        } else if (moveDir.length() > 0) {
            // Sprint — hold Shift for speed boost, drains stamina
            const sprinting = holdingShift && this.onGround && this.stamina > 0;
            const spd = sprinting ? this.speed * this.sprintMultiplier : this.speed;
            if (sprinting) this.stamina = Math.max(0, this.stamina - this.sprintDrain * dt);
            moveDir.normalize().multiplyScalar(spd * chillMul * dt);
            this.position.add(moveDir);
        }

        // Dash trigger — Ctrl tap
        const ctrlDown = this.keys['ControlLeft'] || this.keys['ControlRight'];
        if (ctrlDown && !this._dashWasDown && this.dashCooldown <= 0 && this.dashTimer <= 0 && this.stamina >= this.dashCost) {
            this.dashCooldown = 1.0;
            this.dashTimer = this.dashDuration;
            this.stamina -= this.dashCost;
            // Dash in movement direction, or forward if no input
            this.dashDir.copy(moveDir.length() > 0 ? moveDir.normalize() : forward);
            this._justDashed = true; // ponytail: dash trail için flag
        }
        this._dashWasDown = ctrlDown;

        // Store frame velocity for momentum deflection (after movement + before vertical)
        this._frameVel = new THREE.Vector3(
            (this.position.x - prevPos.x) / Math.max(dt, 0.001),
            this.verticalVel,
            (this.position.z - prevPos.z) / Math.max(dt, 0.001)
        );

        // Wall jump — push off walls when airborne (costs stamina).
        // ponytail fix: yükseklik kapısı — belli yüksekliğin üstünde wall-jump çalışmaz,
        // yoksa duvara yaslanıp sonsuza tırmanılabiliyordu. Yüksek ama sonlu.
        const ab = this.arena.bounds;
        const ceil = this.arena.ceilingHeight > 0 ? this.arena.ceilingHeight : (ab.maxY || 30);
        const wallJumpMaxY = ceil * 0.6;
        const nearWall = this.position.x - this.radius - 1 < ab.minX || this.position.x + this.radius + 1 > ab.maxX
                      || this.position.z - this.radius - 1 < ab.minZ || this.position.z + this.radius + 1 > ab.maxZ;
        this._wallJumpCD = (this._wallJumpCD || 0) - dt;
        if (this.keys['Space'] && !this.onGround && nearWall && this.position.y < wallJumpMaxY
            && !this._jumpHeld && this._wallJumpCD <= 0 && this.stamina >= 15) {
            this.verticalVel = this.jumpForce * 0.85;
            this.stamina -= 15;
            this._wallJumpCD = 0.6; // 600ms cooldown
            // Push away from closest wall
            if (this.position.x - this.radius - 1 < ab.minX) this.position.x = ab.minX + this.radius + 1;
            if (this.position.x + this.radius + 1 > ab.maxX) this.position.x = ab.maxX - this.radius - 1;
            if (this.position.z - this.radius - 1 < ab.minZ) this.position.z = ab.minZ + this.radius + 1;
            if (this.position.z + this.radius + 1 > ab.maxZ) this.position.z = ab.maxZ - this.radius - 1;
            this._jumpHeld = true;
            if (this.audio) this.audio.playJump();
        }

        // Double jump — 2 jumps, reset on ground
        if (this.keys['Space'] && this.jumpsRemaining > 0 && !this._jumpHeld) {
            this.verticalVel = this.jumpForce;
            this.jumpsRemaining--;
            this._jumpHeld = true;
            this.onGround = false;
            if (this.audio) this.audio.playJump();
        }
        if (!this.keys['Space']) this._jumpHeld = false;

        // Vertical physics
        this.verticalVel += this.gravity * dt;
        this.position.y += this.verticalVel * dt;

        // Dikey tavan — görünür tavan yok ama haritayı aşma (sonsuz yükselme engeli).
        const ceilY = (this.arena.ceilingHeight > 0 ? this.arena.ceilingHeight : (this.arena.bounds.maxY || 30)) - 0.5;
        if (this.position.y > ceilY) {
            this.position.y = ceilY;
            if (this.verticalVel > 0) this.verticalVel = 0;
        }

        if (this.position.y <= this.height) {
            if (!this.onGround) {
                this.jumpsRemaining = 2;
                if (this.audio) this.audio.playLand();
            }
            this.position.y = this.height;
            this.verticalVel = 0;
            this.onGround = true;
        }

        // Bounds
        const b = this.arena.bounds;
        this.position.x = Math.max(b.minX + this.radius, Math.min(b.maxX - this.radius, this.position.x));
        this.position.z = Math.max(b.minZ + this.radius, Math.min(b.maxZ - this.radius, this.position.z));

        // Collision with map props (trees, pillars, walls, etc.)
        if (this.arena.collidables) {
            for (const c of this.arena.collidables) {
                const dx = this.position.x - c.pos.x;
                const dz = this.position.z - c.pos.z;
                const dy = Math.abs(this.position.y - c.pos.y);
                const minDist = this.radius + c.radius;
                if (dx * dx + dz * dz < minDist * minDist && dy < c.radius + this.radius + 2) {
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if (dist > 0.01) {
                        const overlap = minDist - dist;
                        this.position.x += (dx / dist) * overlap;
                        this.position.z += (dz / dist) * overlap;
                    }
                }
            }
        }

        if (!this.killcamLock) {
            this.camera.position.copy(this.position);

            // Camera kick — brief upward punch that eases back out.
            this.kickAmt *= Math.exp(-14 * dt);
            if (this.kickAmt < 0.0005) this.kickAmt = 0;
            if (this.kickAmt > 0) {
                const kicked = this.euler.clone();
                kicked.x += this.kickAmt;
                this.camera.quaternion.setFromEuler(kicked);
            } else {
                this.camera.quaternion.setFromEuler(this.euler);
            }
        }

        // Chat bubble timer
        if (this.chatTimer > 0) {
            this.chatTimer -= dt;
            if (this.chatTimer <= 0 && this.chatBubble) {
                this.scene.remove(this.chatBubble);
                this.chatBubble = null;
            }
        }
    }

    // Apply damage through shield first. Returns true if this blow is lethal.
    // dmgResist rune + tank pasif burada uygulanır.
    takeDamage(amount) {
        const resist = (this.runeBonuses?.dmgResist || 0) + (this.passive === 'damage_reduc' ? 0.2 : 0) + (this._damageReduction || 0);
        amount = Math.max(1, Math.round(amount * (1 - resist)));
        this.totalDamageTaken += amount;
        this.lastDamageAt = performance.now() / 1000;
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, amount);
            this.shield -= absorbed;
            amount -= absorbed;
        }
        this.hp = Math.max(0, this.hp - amount);
        return this.hp <= 0;
    }

    // Deflect sonrası: consecutiveMisses sıfırla, lifesteal rune uygula.
    onSuccessfulDeflect() {
        this.consecutiveMisses = 0;
        if (this.runeBonuses?.lifesteal) {
            this.hp = Math.min(this.maxHp, this.hp + this.runeBonuses.lifesteal);
        }
    }

    // Top kaçırdı (tutamadı) → miss sayacı artar, ekstra hasar riski.
    onMissDeflect() {
        this.consecutiveMisses++;
    }

    // Top başkasına çarptığında bu deflector'a hasarAttribution yapılır.
    recordDamageDealt(amount) {
        this.totalDamageDealt += amount;
    }

    die() {
        this.alive = false;
        this.deathTimer = 2.0;
        this.hp = 0;
        this.setHandVisible(false); // ponytail: ölünce hand gizle — spectate temiz
    }

    revive() {
        this.alive = true;
        this.deathTimer = 0;
        this.hp = this.maxHp;
        this.shield = 0;
        this.stamina = this.staminaMax;
        this.exhausted = false;
        this.consecutiveMisses = 0;
        this._burnTimer = 0;
        this._chillTimer = 0;
        // ponytail: hand default OFF — sv_hand ile açılır, auto-start'ta görünmez
    }

    getPosition() { return this.position.clone(); }
    isAttacking() { return this.attacking; }

    // Check for A-D-A-D spin pattern (within 0.5s, 4 presses)
    didSpinDodge() {
        if (this._strafeHistory.length < 4) return false;
        const now = performance.now();
        const recent = this._strafeHistory.filter(e => now - e.time < 500);
        if (recent.length < 4) return false;
        // Check alternating pattern: last 4 must be A-D-A-D or D-A-D-A
        const keys = recent.slice(-4).map(e => e.key);
        const pattern = keys.join('');
        if (pattern === 'KeyAKeyDKeyAKeyD' || pattern === 'KeyDKeyAKeyDKeyA') {
            this._strafeHistory = []; // consume
            return true;
        }
        return false;
    }

    setTeam(team) {
        this.team = team;
        const c = team === 'red' ? 0xee5555 : 0x5577dd;
        if (this.armMat) this.armMat.uniforms.uColor.value.set(c);
        if (this.gloveMat) this.gloveMat.uniforms.uColor.value.set(c);
    }

    respawn() {
        const spawn = this.arena.getPlayerSpawn(this.team);
        this.position.copy(spawn);
        this.position.y = this.height;
        this.velocity.set(0, 0, 0);
        this.verticalVel = 0;
        this.onGround = true;
        this.euler.set(0, this.team === 'red' ? 0 : Math.PI, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(this.euler);
        this.alive = true;
        this.hp = this.maxHp;
        this.shield = 0;
        this.stamina = this.staminaMax;
        this.exhausted = false;
        this.consecutiveMisses = 0;
        this._burnTimer = 0;
        this._chillTimer = 0;
        this.skillCooldowns = {};
        this.ultimateCharge = 0;
        this.ultimateActive = false;
        this._qHoldTimer = 0;
        // ponytail: hand default OFF — auto-start'ta görünmez, sv_hand ile açılır
    }

    setSensitivity(val) { this.sensitivity = val; }
}
