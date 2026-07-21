// bot.js — AI players with proper proportioned models, character loadout + skills
import * as THREE from 'three';

import { applyCharacter, CHARACTERS } from './characters.js';
import { applyRunes, tickSkillCooldowns, useSkill } from './skills.js';
import { createKnifeModel, disposeObject3D } from './weapon-models.js';
import { KNIVES } from './cosmetics.js';

// ponytail: depthTest:true — sprites hide behind walls, no punch-through
const DISABLE_SPRITES = false;

const BOT_HIT_DAMAGE = 22;

export class Bot {
    constructor(renderer, arena, name, team, difficulty = 'medium') {
        this.renderer = renderer;
        this.arena = arena;
        this.scene = renderer.scene;
        this.name = name;
        this.team = team;
        this.difficulty = difficulty;

        const diffSettings = {
            easy:   { deflectChance: 0.35, reactionTime: 0.7, moveSpeed: 3.5, skillChance: 0.05 },
            medium: { deflectChance: 0.75, reactionTime: 0.35, moveSpeed: 5.5, skillChance: 0.20 },
            hard:   { deflectChance: 0.92, reactionTime: 0.12, moveSpeed: 7.5, skillChance: 0.45 }
        };
        const s = diffSettings[difficulty] || diffSettings.medium;
        this.deflectChance = s.deflectChance;
        this.reactionTime = s.reactionTime;
        this.moveSpeed = s.moveSpeed;
        this.skillChance = s.skillChance;

        this.position = arena.getPlayerSpawn(team);
        this.velocity = new THREE.Vector3();
        this.radius = 0.5;
        this.attacking = false;
        this.attackTimer = 0;
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        this.strafeTimer = 0;
        this.reactionTimer = 0;
        this.score = 0;
        this.deflectionCount = 0;
        this.spawnAnim = 0; // 0..1 grow-in on respawn

        // Health & combat — karakter yüklenir
        this.maxHp = 100;
        this.hp = 100;
        this._baseMaxHp = 100;
        this._baseSpeed = s.moveSpeed;
        this.consecutiveMisses = 0;
        this.shield = 0;
        this.alive = true;
        this.deflectPower = 1.0;
        this.passive = 'none';
        this.charId = 'rally';
        this.skillCooldowns = {};
        this.runeBonuses = {};
        this.loadout = { skill: 'slow', runes: [] };
        this._gameRef = null; // set by game.js after construction

        // Damage meter
        this.totalDamageDealt = 0;
        this.totalDamageTaken = 0;

        // Random karakter ata (kolaydifficulty'de sadece rally)
        // ponytail fix #6: blazer/frost dahil tüm karakterler, medium+ rune uygula
        const pool = difficulty === 'easy' ? ['rally']
                   : ['rally','tank','scout','sniper','guardian','soldier'];
        const charId = pool[Math.floor(Math.random() * pool.length)];
        applyCharacter(this, charId);
        this._baseMaxHp = this.maxHp;
        this._baseSpeed = this.moveSpeed;
        this._baseDeflect = this.deflectPower;

        // Medium/hard bot'lara random rune uygula (balans)
        if (difficulty !== 'easy') {
            const allRunes = ['hp_bonus','dmg_resist','deflect_power','speed_bonus','stam_regen','lifesteal'];
            const numRunes = difficulty === 'hard' ? 3 : 1;
            const botRunes = [];
            for (let i = 0; i < numRunes; i++) {
                const r = allRunes[Math.floor(Math.random() * allRunes.length)];
                if (!botRunes.includes(r)) botRunes.push(r);
            }
            applyRunes(this, botRunes);
            this.loadout.runes = botRunes;
        }

        this._initModel();
        this.buildTargetOutline();
        this.buildHpBar();
    }

    _initModel() {
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this._buildBoxMesh();
    }

    _buildBoxMesh() {
        // Clear group (empty from constructor) then build box character
        const teamColor = this.team === 'red' ? 0xcc3333 : 0x3355cc;
        const skinColor = 0xf5c6a0;

        this._teamMats = []; // team-colored mats, recolored on setTeam()

        // Body — torso (box, more human proportioned)
        const torsoGeo = new THREE.BoxGeometry(0.7, 0.9, 0.4);
        const torsoMat = this.renderer.createToonMaterial(teamColor);
        this._teamMats.push(torsoMat);
        this.torso = new THREE.Mesh(torsoGeo, torsoMat);
        this.torso.position.y = 1.15;
        this.torso.castShadow = true;
        this.group.add(this.torso);
        this.group.add(this.renderer.createOutlineMesh(torsoGeo));
        this.group.children[this.group.children.length - 1].position.copy(this.torso.position);

        // Head
        const headGeo = new THREE.BoxGeometry(0.42, 0.48, 0.4);
        const headMat = this.renderer.createToonMaterial(skinColor);
        this.head = new THREE.Mesh(headGeo, headMat);
        this.head.position.y = 1.85;
        this.head.castShadow = true;
        this.group.add(this.head);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.08, 1.88, 0.22);
        this.group.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.08, 1.88, 0.22);
        this.group.add(rightEye);

        // Legs
        const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.25);
        const legMat = this.renderer.createToonMaterial(0x444444);
        this.leftLeg = new THREE.Mesh(legGeo, legMat);
        this.leftLeg.position.set(-0.18, 0.35, 0);
        this.leftLeg.castShadow = true;
        this.group.add(this.leftLeg);
        this.rightLeg = new THREE.Mesh(legGeo, legMat);
        this.rightLeg.position.set(0.18, 0.35, 0);
        this.rightLeg.castShadow = true;
        this.group.add(this.rightLeg);

        // Arms
        const armGeo = new THREE.BoxGeometry(0.18, 0.65, 0.2);
        const armMat = this.renderer.createToonMaterial(teamColor);
        this._teamMats.push(armMat);
        this.leftArm = new THREE.Mesh(armGeo, armMat);
        this.leftArm.position.set(-0.5, 1.1, 0);
        this.leftArm.castShadow = true;
        this.group.add(this.leftArm);
        this.rightArm = new THREE.Mesh(armGeo, armMat);
        this.rightArm.position.set(0.5, 1.1, 0);
        this.rightArm.castShadow = true;
        this.group.add(this.rightArm);

        // Hands (skin)
        const handGeo = new THREE.BoxGeometry(0.16, 0.18, 0.16);
        const handMat = this.renderer.createToonMaterial(skinColor);
        this.leftHand = new THREE.Mesh(handGeo, handMat);
        this.leftHand.position.set(0, -0.35, 0);
        this.leftArm.add(this.leftHand);
        this.rightHand = new THREE.Mesh(handGeo, handMat);
        this.rightHand.position.set(0, -0.35, 0);
        this.rightArm.add(this.rightHand);
        this.knifeId = 'training';
        this.knifeGroup = createKnifeModel(KNIVES.training);
        this.knifeGroup.scale.setScalar(0.68);
        this.knifeGroup.position.set(0, -0.45, -0.28);
        this.knifeGroup.rotation.set(-0.35, 0, -0.15);
        this.rightArm.add(this.knifeGroup);

        // Name label + avatar sprites above the head
        if (!DISABLE_SPRITES) this.buildNameSprite();

        // Avatar sprite above head — shows character emoji so identity is clear
        if (!DISABLE_SPRITES) this.buildAvatarSprite();

    }

    buildNameSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 256, 64);
        ctx.font = 'bold 24px Outfit, Arial';
        ctx.fillStyle = this.team === 'red' ? '#ff6666' : '#6688ff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.textAlign = 'center';
        ctx.strokeText(this.name, 128, 40);
        ctx.fillText(this.name, 128, 40);
        const texture = new THREE.CanvasTexture(canvas);
        // depthTest:true so the label hides behind walls/floor instead of punching
        // through and floating over the crosshair when you look up or to the sides.
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
        this.nameSprite = new THREE.Sprite(spriteMat);
        this.nameSprite.position.y = 2.3;
        this.nameSprite.scale.set(2.5, 0.625, 1);
        this.group.add(this.nameSprite);
    }

    buildAvatarSprite() {
        const ac = document.createElement('canvas');
        ac.width = 64; ac.height = 64;
        const acx = ac.getContext('2d');
        const char = CHARACTERS[this.charId] || { emoji: '👤' };
        acx.clearRect(0, 0, 64, 64);
        // Circular background
        acx.fillStyle = this.team === 'red' ? 'rgba(200,50,50,0.3)' : 'rgba(50,80,200,0.3)';
        acx.beginPath(); acx.arc(32, 32, 28, 0, Math.PI * 2); acx.fill();
        acx.font = '32px Arial';
        acx.textAlign = 'center';
        acx.textBaseline = 'middle';
        acx.fillText(char.emoji || '👤', 32, 34);
        const tex = new THREE.CanvasTexture(ac);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
        this.avatarSprite = new THREE.Sprite(mat);
        this.avatarSprite.position.y = 2.8;
        this.avatarSprite.scale.set(1.0, 1.0, 1);
        this.group.add(this.avatarSprite);
    }

    // Target outline — bright red, pulses when this bot is the ball's target.
    buildTargetOutline() {
        const parts = [
            this.torso, this.head, this.leftLeg, this.rightLeg,
            this.leftArm, this.rightArm, this.leftHand, this.rightHand
        ];
        this.targetOutline = this.renderer.createTargetOutline(parts);
        this.group.add(this.targetOutline);
        this.targetOutline.userData.sync?.();
    }

    setTargetOutline(show) {
        if (this.targetOutline) this.targetOutline.visible = show;
        if (show) this.targetOutline?.userData.sync?.();
        this._outlineActive = show;
    }

    // Floating HP bar above the head — canvas texture redrawn on change.
    buildHpBar() {
        this.hpCanvas = document.createElement('canvas');
        this.hpCanvas.width = 128; this.hpCanvas.height = 20;
        this.hpCtx = this.hpCanvas.getContext('2d');
        this.hpTex = new THREE.CanvasTexture(this.hpCanvas);
        const mat = new THREE.SpriteMaterial({ map: this.hpTex, transparent: true, depthTest: true });
        this.hpBar = new THREE.Sprite(mat);
        this.hpBar.position.y = 2.05;
        this.hpBar.scale.set(1.6, 0.25, 1);
        this.group.add(this.hpBar);
        this.drawHpBar();
    }

    drawHpBar() {
        const ctx = this.hpCtx;
        if (!ctx) return;
        const frac = Math.max(0, this.hp / this.maxHp);
        ctx.clearRect(0, 0, 128, 20);
        // Track
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.roundRect(2, 4, 124, 12, 6); ctx.fill();
        // Fill — green→yellow→red by health
        const hue = frac * 120; // 120=green, 0=red
        ctx.fillStyle = `hsl(${hue}, 85%, 55%)`;
        ctx.beginPath(); ctx.roundRect(4, 6, Math.max(0, 120 * frac), 8, 4); ctx.fill();
        // Shield overlay
        if (this.shield > 0) {
            ctx.fillStyle = 'rgba(120,200,255,0.85)';
            const sw = Math.min(120, 120 * (this.shield / this.maxHp));
            ctx.beginPath(); ctx.roundRect(4, 6, sw, 3, 2); ctx.fill();
        }
        this.hpTex.needsUpdate = true;
    }

    takeDamage(amount) {
        const resist = (this.runeBonuses?.dmgResist || 0) + (this.passive === 'damage_reduc' ? 0.2 : 0);
        amount = Math.max(1, Math.round(amount * (1 - resist)));
        this.totalDamageTaken += amount;
        if (this.shield > 0) {
            const absorbed = Math.min(this.shield, amount);
            this.shield -= absorbed; amount -= absorbed;
        }
        this.hp = Math.max(0, this.hp - amount);
        this.drawHpBar();
        return this.hp <= 0;
    }

    onSuccessfulDeflect() {
        this.consecutiveMisses = 0;
        if (this.runeBonuses?.lifesteal) {
            this.hp = Math.min(this.maxHp, this.hp + this.runeBonuses.lifesteal);
            this.drawHpBar();
        }
    }

    onMissDeflect() { this.consecutiveMisses++; }
    recordDamageDealt(amount) { this.totalDamageDealt += amount; }

    update(dt, ball) {
        const moveSpeed = this.moveSpeed * (this._hazardMoveMul || 1);
        // Spawn grow-in animation (bouncy ease-out)
        if (this.spawnAnim < 1) {
            this.spawnAnim = Math.min(1, this.spawnAnim + dt * 3.5);
            const s = this.spawnAnim;
            const ease = 1 - Math.pow(1 - s, 3);
            const overshoot = Math.sin(s * Math.PI) * 0.15;
            this.group.scale.setScalar(ease + overshoot);
        }

        // Target outline pulse
        if (this._outlineActive && this.targetOutline?.visible) {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
            this.targetOutline.userData.sync?.();
            for (const material of this.targetOutline.userData.materials || []) {
                material.uniforms.uPulse.value = pulse;
            }
        }

        // Skill cooldown tick
        tickSkillCooldowns(this, dt);

        // Burn DOT
        if (this._burnTimer > 0) {
            this._burnTimer -= dt;
            this._burnTickTimer = (this._burnTickTimer || 0) + dt;
            if (this._burnTickTimer >= 1) { this._burnTickTimer = 0; this.takeDamage(5); this.drawHpBar(); }
        }
        if (this._chillTimer > 0) this._chillTimer -= dt;

        // Bot occasionally uses skill on incoming ball
        if (!this._gameRef?._skillsDisabled && ball && ball.active && ball.targetPlayer === this && this.skillCooldowns[this.loadout.skill] <= 0
            && Math.random() < this.skillChance * dt) {
            useSkill(this, this.loadout.skill, { ball, target: this, game: this._gameRef });
            if (this.loadout.skill === 'blackhole' && this._gameRef) {
                this._pendingBlackHole = true;
            }
        }

        // Ball-aware movement — intercept, dodge, position
        if (ball && ball.active) {
            const toBall = new THREE.Vector3().subVectors(ball.position, this.position);
            const ballDist = toBall.length();
            toBall.y = 0;

            if (ballDist > 0.1) {
                const angle = Math.atan2(toBall.x, toBall.z);
                this.group.rotation.y = angle;
            }

            const speed = ball.velocity.length();
            const isTargeted = ball.targetPlayer === this;

            // Predict ball position (where it's heading)
            const ballDir = ball.velocity.clone().normalize();
            const predOffset = ballDir.clone().multiplyScalar(Math.min(ballDist * 0.3, 3));
            const interceptTarget = ball.position.clone().add(predOffset);
            const toIntercept = new THREE.Vector3().subVectors(interceptTarget, this.position);
            toIntercept.y = 0;
            const interceptDist = toIntercept.length();

            // Dodge: sidestep perpendicular to ball when it's coming fast and close
            if (isTargeted && speed > 8 && ballDist < 5 && Math.random() < 0.6) {
                const dodgeDir = new THREE.Vector3(-toBall.z, 0, toBall.x).normalize();
                // Randomize dodge direction slightly
                if (Math.random() > 0.5) dodgeDir.negate();
                this.position.add(dodgeDir.multiplyScalar(moveSpeed * 1.8 * dt));
            }

            // Move toward ball's predicted path to intercept
            if (isTargeted && interceptDist > 2.5) {
                const moveDir = toIntercept.normalize().multiplyScalar(moveSpeed * 0.85 * dt);
                this.position.add(moveDir);
            } else if (!isTargeted && ballDist < 8 && Math.random() < 0.3) {
                // Even when not targeted, drift toward ball if close
                const moveDir = toBall.clone().normalize().multiplyScalar(moveSpeed * 0.3 * dt);
                this.position.add(moveDir);
            }

            // Perpendicular strafe relative to ball direction
            if (ballDist > 1.5) {
                const perpDir = new THREE.Vector3(-toBall.z, 0, toBall.x).normalize();
                const strafeAmount = moveSpeed * 0.4 * dt * this.strafeDir;
                this.position.add(perpDir.multiplyScalar(strafeAmount));
            }
        } else {
            // No ball — wander with random strafe
            this.strafeTimer -= dt;
            if (this.strafeTimer <= 0) {
                this.strafeDir *= -1;
                this.strafeTimer = 1.5 + Math.random() * 2.5;
            }
            const wanderVel = new THREE.Vector3(this.strafeDir * moveSpeed * 0.3 * dt, 0, 0);
            this.position.add(wanderVel);
        }

        // Bounds
        const b = this.arena.bounds;
        this.position.x = Math.max(b.minX + 1.5, Math.min(b.maxX - 1.5, this.position.x));
        this.position.z = Math.max(b.minZ + 1.5, Math.min(b.maxZ - 1.5, this.position.z));

        // Team side — allow more forward pressure based on ball position
        const ballZ = ball?.position?.z ?? 0;
        const sideLimit = 1.5;
        if (this.team === 'red') {
            const pushUp = ballZ < -5 ? -3 : -1; // push forward when ball is on blue side
            if (this.position.z > pushUp) this.position.z = pushUp;
        }
        if (this.team === 'blue') {
            const pushUp = ballZ > 5 ? 3 : 1;
            if (this.position.z < pushUp) this.position.z = pushUp;
        }

        this.position.y = 0;
        this.group.position.copy(this.position);

        // Attack cooldown
        if (this.attackTimer > 0) {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) {
                this.attacking = false;
                if (this.rightArm) this.rightArm.rotation.x = 0;
            }
        }

        // Arm swing anim when attacking (box mesh only)
        if (this.attacking && this.rightArm) {
            this.rightArm.rotation.x = -1.2;
        }
        this.targetOutline?.userData.sync?.();
    }

    tryDeflect(ball, dt = 0.016) {
        if (!this.alive || this.attacking || this.attackTimer > 0) return false;
        const dist = ball.distanceTo(this.getPosition());

        // Build reaction timer when ball is within alert range (~8 units),
        // not just attackRange (2.0). Ball at 17u/s crosses 2.0 in 0.12s,
        // shorter than any bot's reactionTime — old code never filled timer.
        // ponytail: alert range ~ ballSpeed * maxReactionTime + attackRange
        if (dist > 8) {
            this.reactionTimer = 0;
            this._deflectDecided = false;
            return false;
        }
        this.reactionTimer += dt;
        if (this.reactionTimer < this.reactionTime) return false;
        if (dist > ball.attackRange) return false;

        if (!this._deflectDecided) {
            this._deflectDecided = true;
            this._willDeflect = Math.random() < this.deflectChance;
        }
        if (!this._willDeflect) return false;

        this.attacking = true;
        this.attackTimer = 0.3;
        this.deflectionCount++;
        this._deflectDecided = false;
        return true;
    }

    isAttacking() {
        return this.attacking;
    }

    getPosition() {
        return new THREE.Vector3(this.position.x, this.position.y + 1.2, this.position.z);
    }

    // Move this bot to a team: recolor body mats, rebuild name/avatar sprites,
    // and re-place at the new team's spawn. Called by game.switchPlayerTeam.
    setTeam(team) {
        if (team === this.team) return;
        this.team = team;
        const c = team === 'red' ? 0xcc3333 : 0x3355cc;
        (this._teamMats || []).forEach(m => {
            if (m.uniforms?.uColor) m.uniforms.uColor.value.setHex(c);
            else if (m.color) m.color.setHex(c);
        });
        // Rebuild the head-label + avatar sprites so the team color/tint updates.
        if (this.nameSprite) { this.group.remove(this.nameSprite); this.nameSprite.material.map?.dispose(); this.nameSprite.material.dispose(); }
        if (this.avatarSprite) { this.group.remove(this.avatarSprite); this.avatarSprite.material.map?.dispose(); this.avatarSprite.material.dispose(); }
        this.buildNameSprite?.();
        this.buildAvatarSprite();
        const spawn = this.arena.getPlayerSpawn(team);
        this.position.copy(spawn);
        this.drawHpBar?.();
    }

    respawn() {
        const spawn = this.arena.getPlayerSpawn(this.team);
        this.position.copy(spawn);
        this.position.x += (Math.random() - 0.5) * 8;
        this.velocity.set(0, 0, 0);
        this.attacking = false;
        this.attackTimer = 0;
        this.reactionTimer = 0;
        this.spawnAnim = 0;
        this.hp = this.maxHp;
        this.shield = 0;
        this.consecutiveMisses = 0;
        this._burnTimer = 0;
        this._chillTimer = 0;
        this.skillCooldowns = {};
        this._deflectDecided = false;
        this._willDeflect = false;
        this.alive = true;
        this.drawHpBar();
        this.group.position.copy(this.position);
        this.group.rotation.y = this.team === 'red' ? 0 : Math.PI;
        this.group.visible = true;
        this.group.scale.setScalar(0.01);
        this.setTargetOutline(false);
    }

    remove() {
        disposeObject3D(this.targetOutline);
        this.scene.remove(this.group);
    }
}
