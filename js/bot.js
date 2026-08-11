// bot.js — AI players with proper proportioned models, character loadout + skills
import * as THREE from 'three';

import { applyCharacter, CHARACTERS } from './characters.js';
import { applyRunes, tickSkillCooldowns, useSkill } from './skills.js';
import { createKnifeModel, disposeObject3D } from './weapon-models.js';
import { KNIVES } from './cosmetics.js';
import { createCharacterRig } from './character-rig.js';
import { createCharacterAnimator } from './character-anim.js';

// ponytail: depthTest:true — sprites hide behind walls, no punch-through
const DISABLE_SPRITES = false;

const BOT_HIT_DAMAGE = 22;

// Difficulty base stats, hoisted so the tendency helpers below can read the same
// canonical table the constructor uses (was previously a constructor-local literal).
const DIFFICULTY_SETTINGS = {
    easy:   { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20, moveSpeed: 3.5, skillChance: 0.05 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08, moveSpeed: 5.5, skillChance: 0.20 },
    hard:   { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02, moveSpeed: 7.5, skillChance: 0.45 }
};

// Round personalities: rolled once per round (Bot.rollTendency), held for the whole
// round, and only ever bias EXISTING decision parameters — no new capabilities, no
// hidden-state reads, same competitive gates as any other bot.
//   aggressive — closes distance harder, commits to deflects earlier, leans spike.
//   defensive  — holds depth, reacts more cautiously, leans safer lob when improvising.
//   flanker    — strong lateral bias, mixes in more trick shots, roughly neutral timing.
const BOT_TENDENCIES = ['aggressive', 'defensive', 'flanker'];

// Multiplier/offset deltas layered on top of DIFFICULTY_SETTINGS. Every value stays
// inside TENDENCY_BOUNDS below (asserted by tests/bot-tendency.test.mjs).
const TENDENCY_PROFILES = {
    aggressive: { reactionMul: 0.88, windUpMul: 0.85, approachMul: 1.25, lateralMul: 0.85, depthBias: -1.0, shotBias:  0.08, lobBias: -0.15 },
    defensive:  { reactionMul: 1.12, windUpMul: 1.20, approachMul: 0.80, lateralMul: 1.00, depthBias:  1.0, shotBias: -0.05, lobBias:  0.10 },
    flanker:    { reactionMul: 1.00, windUpMul: 1.00, approachMul: 0.95, lateralMul: 1.40, depthBias:  0.0, shotBias:  0.05, lobBias:  0.20 }
};

// Documented [min, max] envelope every TENDENCY_PROFILES value must live inside.
const TENDENCY_BOUNDS = {
    reactionMul: [0.85, 1.15],
    windUpMul:   [0.80, 1.25],
    approachMul: [0.75, 1.30],
    lateralMul:  [0.80, 1.50],
    depthBias:   [-1.5, 1.5],
    shotBias:    [-0.10, 0.10],
    lobBias:     [-0.20, 0.20]
};

// Picks a tendency from a single seed in [0,1) — pure/deterministic so game.js can drive
// it with an injected RNG and tests can assert an exact outcome per seed.
function pickTendency(seed) {
    const clamped = Math.max(0, Math.min(0.999999, Number(seed) || 0));
    const idx = Math.min(BOT_TENDENCIES.length - 1, Math.floor(clamped * BOT_TENDENCIES.length));
    return BOT_TENDENCIES[idx];
}

// The fastest (lowest) reaction/wind-up time a tendency may push a bot to: one tier
// below its own difficulty's baseline, or a small self-relative floor at the top tier.
// This is what keeps "an easy aggressive bot is still easy" true (difficulty invariance).
function tierFloor(param, difficulty) {
    if (difficulty === 'easy') return DIFFICULTY_SETTINGS.medium[param];
    if (difficulty === 'medium') return DIFFICULTY_SETTINGS.hard[param];
    return DIFFICULTY_SETTINGS.hard[param] * 0.85; // hard (or unrecognized): absolute floor, no tier below
}

// Applies a tendency's reactionMul/windUpMul to a difficulty base value, clamped so the
// result never reaches the tier above.
function tendencyBoundedTime(param, difficulty, tendencyKey) {
    const settings = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
    const profile = TENDENCY_PROFILES[tendencyKey] || TENDENCY_PROFILES.flanker;
    const mul = param === 'reactionTime' ? profile.reactionMul : profile.windUpMul;
    const biased = settings[param] * mul;
    return Math.max(biased, tierFloor(param, difficulty));
}

// Once a bot has chosen a successful deflect, keep its feet planted through the
// telegraph. It may still miss according to difficulty; this only prevents its own
// dodge/strafe movement from stepping out of the already-earned deflect window.
export function shouldHoldDeflectPosition(deflectDecided, willDeflect) {
    return deflectDecided === true && willDeflect === true;
}

export class Bot {
    constructor(renderer, arena, name, team, difficulty = 'medium') {
        this.renderer = renderer;
        this.arena = arena;
        this.scene = renderer.scene;
        this.name = name;
        this.team = team;
        this.difficulty = difficulty;

        const s = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;
        this.deflectChance = s.deflectChance;
        this.reactionTime = s.reactionTime;
        this.windUpTime = s.windUp;
        this.mishitRate = s.mishitRate;
        this.moveSpeed = s.moveSpeed;
        this.skillChance = s.skillChance;

        // Round tendency (rollTendency, called by game.startRound each round) biases
        // reactionTime/windUpTime plus the movement/shot-selection multipliers below.
        // Neutral defaults here mean an un-rolled bot behaves exactly as before.
        this.tendency = null;
        this._tendencyApproachMul = 1;
        this._tendencyLateralMul = 1;
        this._tendencyDepthBias = 0;
        this._tendencyShotBias = 0;
        this._tendencyLobBias = 0;

        this.position = arena.getPlayerSpawn(team);
        this.velocity = new THREE.Vector3();
        this.radius = 0.5;
        this.attacking = false;
        this.attackTimer = 0;
        this.windUpTimer = 0;
        this.windUpCommitted = false;
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
            const numRunes = difficulty === 'hard' ? 2 : 1;  // reduced from 3 to 2
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
        this._buildRig();
    }

    // ponytail: canonical procedural rig replaces the old hand-built box mesh
    // (WARBALL_IO_PLAN.md section 3.1). Keeps this.group as the scene-attached
    // container so external code (position/rotation/visible on bot.group) is untouched.
    _buildRig() {
        this.rig = createCharacterRig({
            characterId: this.charId,
            team: this.team,
            materialFactory: hex => this.renderer.createToonMaterial(hex),
            outlineFactory: geo => this.renderer.createOutlineMesh(geo)
        });
        // Snapshot the rig's own body meshes now, before the knife/cosmetics attach
        // below (they ride rig sockets and would otherwise get swept up by a later
        // traversal) — this is what buildTargetOutline() traces.
        this._outlineParts = [];
        this.rig.root.traverse(o => { if (o.isMesh) this._outlineParts.push(o); });
        this.group.add(this.rig.root);
        this.animator = createCharacterAnimator(this.rig);
        // Reused every frame in update() — 0 alloc.
        this._animFacts = { speed: 0, grounded: true, verticalSpeed: 0, alive: true, aim: 0, strafe: 0 };
        this._animPrevX = this.position.x;
        this._animPrevZ = this.position.z;

        // team-colored mats are handled by rig.setTeam() now — kept for API parity
        // with anything still checking bot._teamMats (nothing currently does).
        this._teamMats = [];

        this.knifeId = 'training';
        this.knifeGroup = createKnifeModel(KNIVES.training);
        this.knifeGroup.scale.setScalar(0.68);
        this.knifeGroup.position.set(0, -0.02, -0.1);
        this.knifeGroup.rotation.set(-0.3, 0, -0.15);
        this.rig.sockets.handR.add(this.knifeGroup);

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

    // Target outline — bright red silhouette traced from the rig's own meshes,
    // pulses when this bot is the ball's target. See js/renderer.js#createTargetOutline.
    buildTargetOutline() {
        this.targetOutline = this.renderer.createTargetOutline(this._outlineParts || []);
    }

    setTargetOutline(show) {
        this.targetOutline?.userData.setVisible?.(show);
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
        this.animator?.play('hit');
        return this.hp <= 0;
    }

    onSuccessfulDeflect() {
        this.consecutiveMisses = 0;
        if (this.runeBonuses?.lifesteal) {
            this.hp = Math.min(this.maxHp, this.hp + this.runeBonuses.lifesteal);
            this.drawHpBar();
        }
    }

    // Rolls this bot's round tendency (see TENDENCY_PROFILES) and recomputes the
    // tendency-biased decision parameters from the canonical difficulty table — so
    // repeated calls across rounds never compound. `rng` is injectable (defaults to
    // Math.random) so game.startRound() can drive it deterministically for replays/tests.
    rollTendency(rng = Math.random) {
        this.tendency = pickTendency(rng());
        const profile = TENDENCY_PROFILES[this.tendency];
        this.reactionTime = tendencyBoundedTime('reactionTime', this.difficulty, this.tendency);
        this.windUpTime = tendencyBoundedTime('windUp', this.difficulty, this.tendency);
        this._tendencyApproachMul = profile.approachMul;
        this._tendencyLateralMul = profile.lateralMul;
        this._tendencyDepthBias = profile.depthBias;
        this._tendencyShotBias = profile.shotBias;
        this._tendencyLobBias = profile.lobBias;
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
        if (this._outlineActive) {
            const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
            for (const material of this.targetOutline?.userData.materials || []) {
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
            const holdingDeflectPosition = isTargeted && shouldHoldDeflectPosition(this._deflectDecided, this._willDeflect);

            // Predict ball position (where it's heading)
            const ballDir = ball.velocity.clone().normalize();
            const predOffset = ballDir.clone().multiplyScalar(Math.min(ballDist * 0.3, 3));
            const interceptTarget = ball.position.clone().add(predOffset);
            const toIntercept = new THREE.Vector3().subVectors(interceptTarget, this.position);
            toIntercept.y = 0;
            const interceptDist = toIntercept.length();

            // Dodge: sidestep perpendicular to ball when it's coming fast and close
            if (!holdingDeflectPosition && isTargeted && speed > 8 && ballDist < 5 && Math.random() < 0.6) {
                const dodgeDir = new THREE.Vector3(-toBall.z, 0, toBall.x).normalize();
                // Randomize dodge direction slightly
                if (Math.random() > 0.5) dodgeDir.negate();
                this.position.add(dodgeDir.multiplyScalar(moveSpeed * 1.8 * dt));
            }

            // Move toward ball's predicted path to intercept
            if (!holdingDeflectPosition && isTargeted && interceptDist > 2.5) {
                const moveDir = toIntercept.normalize().multiplyScalar(moveSpeed * 0.85 * this._tendencyApproachMul * dt);
                this.position.add(moveDir);
            } else if (!holdingDeflectPosition && !isTargeted && ballDist < 8 && Math.random() < 0.3) {
                // Even when not targeted, drift toward ball if close
                const moveDir = toBall.clone().normalize().multiplyScalar(moveSpeed * 0.3 * dt);
                this.position.add(moveDir);
            }

            // Perpendicular strafe relative to ball direction
            if (!holdingDeflectPosition && ballDist > 1.5) {
                const perpDir = new THREE.Vector3(-toBall.z, 0, toBall.x).normalize();
                const strafeAmount = moveSpeed * 0.4 * dt * this.strafeDir * this._tendencyLateralMul;
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
            // depthBias<0 (aggressive) shifts pushUp toward 0 = more forward pressure allowed.
            const pushUp = (ballZ < -5 ? -3 : -1) - this._tendencyDepthBias; // push forward when ball is on blue side
            if (this.position.z > pushUp) this.position.z = pushUp;
        }
        if (this.team === 'blue') {
            const pushUp = (ballZ > 5 ? 3 : 1) + this._tendencyDepthBias;
            if (this.position.z < pushUp) this.position.z = pushUp;
        }

        this.position.y = 0;
        this.group.position.copy(this.position);

        // Attack cooldown
        if (this.attackTimer > 0) {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) this.attacking = false;
        }

        // Drive the rig's animator — facts derived from what the bot already
        // tracks (bots never leave the ground, so grounded/verticalSpeed are fixed).
        // ponytail: speed via position delta, reused facts object, 0 alloc/frame.
        if (this.animator) {
            const invDt = dt > 1e-4 ? 1 / dt : 0;
            const moved = Math.hypot(this.position.x - this._animPrevX, this.position.z - this._animPrevZ);
            this._animPrevX = this.position.x;
            this._animPrevZ = this.position.z;
            const facts = this._animFacts;
            facts.speed = moved * invDt;
            facts.grounded = true;
            facts.verticalSpeed = 0;
            facts.alive = this.alive;
            facts.aim = 0;
            facts.strafe = 0;
            this.animator.update(dt, facts);
        }
    }

    tryDeflect(ball, dt = 0.016) {
        if (!this.alive || this.attacking || this.attackTimer > 0) return false;
        const dist = ball.distanceTo(this.getPosition());

        // Alert range must cover the FULL commit budget — reaction time AND the
        // wind-up telegraph that follows it, not just reaction time. Wind-up was
        // added later (telegraphed wind-ups, ea037d5) but this range was never
        // widened to cover it, so the ball crossed the whole engagement window
        // before a bot ever finished committing — it never got a chance to
        // deflect at all. Scales with the ball's actual current speed so slow
        // and fast throws both leave a fair window.
        // ponytail: alert range ~ ballSpeed * (reactionTime + windUpTime) + attackRange
        const alertRange = ball.currentSpeed * (this.reactionTime + this.windUpTime) + ball.attackRange;
        if (dist > alertRange) {
            this.reactionTimer = 0;
            this._deflectDecided = false;
            this._willDeflect = false;
            this.windUpTimer = 0;
            this.windUpCommitted = false;
            return false;
        }

        // Choose once at the beginning of the readable reaction window. A bot that
        // will deflect can now hold its position through reaction + wind-up instead
        // of repeatedly dodging itself out of range; failures retain their normal AI.
        if (!this._deflectDecided) {
            this._deflectDecided = true;
            this._willDeflect = Math.random() < this.deflectChance;
        }
        if (!this._willDeflect) return false;

        this.reactionTimer += dt;
        if (this.reactionTimer < this.reactionTime) return false;

        // Wind-up telegraphing: bot shows intent before committing to deflect
        // Start wind-up if not already committed
        if (!this.windUpCommitted) {
            this.windUpTimer += dt;
            if (this.windUpTimer < this.windUpTime) return false;  // still winding up
            this.windUpCommitted = true;  // committed - now check for mishit
        }

        // The animation completes on approach, but the ball may only be redirected
        // when it has actually reached deflect range.
        if (dist > ball.attackRange) return false;

        // Commit to deflect, but check if bot will mishit (realistic skill variance)
        if (Math.random() < this.mishitRate) {
            this.attacking = true;
            this.attackTimer = 0.3;
            this.deflectionCount++;
            this._deflectDecided = false;
            this.windUpTimer = 0;
            this.windUpCommitted = false;
            this.animator?.play('deflect');
            this._mishit = true;  // flag for game.js to apply angle deviation
            return true;  // attack animation plays, but ball goes off-target
        }

        this.attacking = true;
        this.attackTimer = 0.3;
        this.deflectionCount++;
        this._deflectDecided = false;
        this.windUpTimer = 0;
        this.windUpCommitted = false;
        this.animator?.play('deflect');
        this._mishit = false;
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
        this.rig?.setTeam(team);
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
        this.windUpTimer = 0;
        this.windUpCommitted = false;
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
        disposeObject3D(this.knifeGroup);
        this.targetOutline?.userData.dispose?.();
        this.rig?.dispose();
        this.scene.remove(this.group);
    }
}
