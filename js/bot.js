// bot.js — AI players with proper proportioned models, character loadout + skills
import * as THREE from 'three';

import { applyCharacter, CHARACTERS } from './characters.js';
import { applyRunes, tickSkillCooldowns, useSkill } from './skills.js';
import { createKnifeModel, disposeObject3D } from './weapon-models.js';
import { KNIVES } from './cosmetics.js';
import { createCharacterRig } from './character-rig.js';
import { createCharacterAnimator } from './character-anim.js';
import { clampToCourtHalf } from './court-rules.js';

// Bot body radius used against the cross-court midline.
export const BOT_MIDLINE_MARGIN = 0.6;

// ponytail: depthTest:true — sprites hide behind walls, no punch-through
const DISABLE_SPRITES = false;

const BOT_HIT_DAMAGE = 22;
const MAX_DEFENSE_SPEED = 10;
const DEFENSE_DODGE_LATCH_SECONDS = 0.25;

// Parkour (js/arena.js buildParkour tags each top 'step' | 'ledge' | 'perch').
// A bot may climb a step or a ledge — never the perch — with a scripted hop
// when the ball's play is on/above that piece (see _tryMountParkour).
export const BOT_MOUNT_MAX_RISE = 1.2;       // m above the current feet
export const BOT_MOUNT_EDGE_REACH = 0.8;     // u from the piece edge
export const BOT_MOUNT_TARGET_MARGIN = 1.0;  // intercept target within footprint + this
export const BOT_MOUNT_HIGH_BALL = 2.0;      // or predicted ball height at intercept >= this
export const BOT_MOUNT_ARC_SECONDS = 0.3;
export const BOT_MOUNT_ARC_PEAK = 0.4;       // m above the top
export const BOT_DISMOUNT_DELAY = 1.0;       // s the reason must stay false
export const BOT_FALL_GRAVITY = -20;
export const BOT_SEEK_RANGE = 12;             // u: an idle bot contests the high ground this close
// Unstick: wanting to move but covering < BOT_STUCK_DISTANCE in BOT_STUCK_SECONDS.
export const BOT_STUCK_SECONDS = 1.0;
export const BOT_STUCK_DISTANCE = 0.1;
const BOT_DETOUR_SECONDS = 1.5;
const BOT_MOUNTABLE = Object.freeze({ step: true, ledge: true });
const PK_NONE = 0;  // on the floor
const PK_ARC = 1;   // scripted mount hop
const PK_ON = 2;    // standing on _pkPiece, clamped to its footprint
const PK_OFF = 3;   // walking off / falling to the surface below

// Difficulty base stats, hoisted so the tendency helpers below can read the same
// canonical table the constructor uses (was previously a constructor-local literal).
const DIFFICULTY_SETTINGS = {
    easy:   { deflectChance: 0.35, reactionTime: 0.65, windUp: 0.30, mishitRate: 0.20, moveSpeed: 3.5, skillChance: 0.05 },
    medium: { deflectChance: 0.75, reactionTime: 0.35, windUp: 0.15, mishitRate: 0.08, moveSpeed: 5.5, skillChance: 0.20 },
    hard:   { deflectChance: 0.92, reactionTime: 0.18, windUp: 0.08, mishitRate: 0.02, moveSpeed: 7.5, skillChance: 0.45 }
};

// G4 uncapped rallies — a probability curve instead of a timing wall. At the
// deflect decision (Bot.observeDefenseIntent), with r = ball speed / base:
//   p = deflectChance · decay^max(0, r − r0)
// and when the ball was assigned closer than reaction + wind-up allows
// (T = (distance − attackRange) / speed < reaction + wind-up), both are
// squeezed proportionally to fit T − 0.02 s, never below `floor` s in total;
// below the floor the bot cannot deflect.
export const RALLY_CRACK_SETTINGS = Object.freeze({
    easy:   Object.freeze({ r0: 2, decay: 0.75, floor: 0.20 }),
    medium: Object.freeze({ r0: 4, decay: 0.85, floor: 0.12 }),
    hard:   Object.freeze({ r0: 6, decay: 0.90, floor: 0.08 })
});
export const DEFENSE_SQUEEZE_MARGIN_SECONDS = 0.02;

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

// An assigned target alone is not a threat: after a bounce or a stale target
// hand-off the ball can still be moving away from the bot. Starting a deflect
// telegraph in that state looks like a fake read to the player. `dx/dy/dz`
// point from the bot's defense point to the ball, so a negative radial velocity
// means the ball is closing in. This is intentionally a decision-entry gate;
// once a readable telegraph has started, steering noise cannot retract it.
export function isIncomingDefenseThreat(ball, dx, dy, dz, distance) {
    const velocity = ball?.velocity;
    if (!velocity || !Number.isFinite(distance) || distance <= 1e-4
        || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) || !Number.isFinite(velocity.z)) {
        return false;
    }
    return (velocity.x * dx + velocity.y * dy + velocity.z * dz) / distance < -0.001;
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
        const crack = RALLY_CRACK_SETTINGS[difficulty] || RALLY_CRACK_SETTINGS.medium;
        this.deflectDecayStart = crack.r0;
        this.deflectDecay = crack.decay;
        this.defenseTimeFloor = crack.floor;
        this.defenseSqueezeMargin = DEFENSE_SQUEEZE_MARGIN_SECONDS;

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
        this._defenseIntent = 'none';
        this._defenseDodgeSign = 0;
        this._defenseDodgeLatch = 0;
        this._defenseStrafe = 0;
        this._defenseDistance = Infinity;
        this._defenseBracePlayed = false;
        this._defenseTimeScale = 1;
        this._defenseSeenOutside = false;
        // Persistent scratch vectors keep bot movement allocation-free per frame.
        this._toBall = new THREE.Vector3();
        this._ballDir = new THREE.Vector3();
        this._predOffset = new THREE.Vector3();
        this._interceptTarget = new THREE.Vector3();
        this._toIntercept = new THREE.Vector3();
        this._dodgeDir = new THREE.Vector3();
        this._perpDir = new THREE.Vector3();
        this._interceptFresh = false;
        this._resetParkour();
        // First-session safety net. It is armed by Game for one opposing solo
        // bot only, and changes at most one declined chance roll into the next
        // readable deflect opportunity; difficulty, wind-up and mishit remain
        // otherwise untouched.
        this._firstSoloDeflectGuard = null;
        this.score = 0;
        this.deflectionCount = 0;
        this.spawnAnim = 0; // 0..1 grow-in on respawn
        // Knockout/flinch presentation (G6) — scalar state driven by Game._updateKnockouts.
        // Cosmetic only: alive/scoring never read these.
        this._koActive = false;
        this._koTime = 0;
        this._koDirX = 0;
        this._koDirZ = 0;
        this._koBaseX = 0;
        this._koBaseZ = 0;
        this._koOffsetX = 0;
        this._koOffsetZ = 0;
        this._koScale0 = 1;
        this._koProxy = false;
        this._koPose = null;
        this._flinchTime = -1;
        this._flinchDirX = 0;
        this._flinchDirZ = 0;
        this._bodyFxListed = false;

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
        if (!this.alive || !Number.isFinite(dt) || dt <= 0) return;
        const hazard = Number.isFinite(this._hazardMoveMul) && this._hazardMoveMul > 0 ? this._hazardMoveMul : 1;
        const moveSpeed = this.moveSpeed * hazard * (this._chillTimer > 0 ? 0.8 : 1);
        const previousX = this.position.x;
        const previousZ = this.position.z;
        this._interceptFresh = false;
        // A declined deflect gets one short, committed lateral escape. Consume
        // only the remaining latch time so its total displacement is stable at
        // every frame rate; after that the bot holds rather than running away
        // from the same incoming ball or rolling a new chance decision.
        const defenseDodgeSeconds = Math.min(this._defenseDodgeLatch, Math.max(0, dt));
        if (this._defenseDodgeLatch > 0) {
            this._defenseDodgeLatch = Math.max(0, this._defenseDodgeLatch - Math.max(0, dt));
        }
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
        if (this.alive && !this._gameRef?._skillsDisabled && ball && ball.active && ball.targetPlayer === this && !(this.skillCooldowns[this.loadout.skill] > 0)
            && Math.random() < this.skillChance * dt) {
            useSkill(this, this.loadout.skill, { ball, target: this, game: this._gameRef });
            if (this.loadout.skill === 'blackhole' && this._gameRef) {
                this._pendingBlackHole = true;
            }
        }

        // Ball-aware movement — intercept, dodge, position
        if (ball && ball.active) {
            const toBall = this._toBall.subVectors(ball.position, this.position);
            const ballDist = toBall.length();
            toBall.y = 0;

            if (ballDist > 0.1) {
                const angle = Math.atan2(toBall.x, toBall.z);
                this.group.rotation.y = angle;
            }

            const speed = ball.velocity.length();
            const isTargeted = ball.targetPlayer === this;
            const defenseIntent = isTargeted ? this._defenseIntent : 'none';
            this._defenseStrafe = 0;

            // An active incoming intent owns one movement branch. Deflects brace;
            // declines keep a stable side-step, never additive dodge/intercept/strafe.
            if ((defenseIntent === 'dodge-left' || defenseIntent === 'dodge-right') && defenseDodgeSeconds > 0) {
                const planarLength = Math.hypot(toBall.x, toBall.z);
                if (planarLength > 1e-4) {
                    const sign = this._defenseDodgeSign;
                    const step = Math.min(MAX_DEFENSE_SPEED, moveSpeed * 1.8) * defenseDodgeSeconds;
                    this._dodgeDir.set(-toBall.z / planarLength * sign, 0, toBall.x / planarLength * sign);
                    this.position.addScaledVector(this._dodgeDir, step);
                    this._defenseStrafe = sign;
                }
            } else if (defenseIntent === 'dodge-left' || defenseIntent === 'dodge-right') {
                // The declined opportunity is still in flight. Do not re-enter
                // intercept/ambient dodge movement or re-roll its decision.
                // Holding here keeps hard bots inside a readable deflect range.
                this._defenseStrafe = 0;
            } else if (defenseIntent !== 'deflect') {
                // Predict ball position using persistent scratch vectors.
                this._ballDir.copy(ball.velocity).normalize();
                this._predOffset.copy(this._ballDir).multiplyScalar(Math.min(ballDist * 0.3, 3));
                this._interceptTarget.copy(ball.position).add(this._predOffset);
                this._interceptFresh = true;
                const toIntercept = this._toIntercept.subVectors(this._interceptTarget, this.position);
                toIntercept.y = 0;
                const interceptDist = toIntercept.length();

                if (isTargeted && speed > 8 && ballDist < 5 && Math.random() < 0.6) {
                    this._dodgeDir.set(-toBall.z, 0, toBall.x).normalize();
                    if (Math.random() > 0.5) this._dodgeDir.negate();
                    this.position.addScaledVector(this._dodgeDir, moveSpeed * 1.8 * dt);
                }
                if (isTargeted && interceptDist > 2.5) {
                    this.position.addScaledVector(toIntercept.normalize(), moveSpeed * 0.85 * this._tendencyApproachMul * dt);
                } else if (!isTargeted && ballDist < 8 && Math.random() < 0.3) {
                    this.position.addScaledVector(toBall.normalize(), moveSpeed * 0.3 * dt);
                }
                if (ballDist > 1.5) {
                    this._perpDir.set(-toBall.z, 0, toBall.x).normalize();
                    const strafeAmount = moveSpeed * 0.4 * dt * this.strafeDir * this._tendencyLateralMul;
                    this.position.addScaledVector(this._perpDir, strafeAmount);
                    this._defenseStrafe = this.strafeDir;
                }
                if (!isTargeted) this._seekParkour(moveSpeed, dt);
            }
        } else {
            // No ball — wander with random strafe
            this.strafeTimer -= dt;
            if (this.strafeTimer <= 0) {
                this.strafeDir *= -1;
                this.strafeTimer = 1.5 + Math.random() * 2.5;
            }
            this.position.x += this.strafeDir * moveSpeed * 0.3 * dt;
        }

        // The scripted mount hop owns the body (the AI step above is dropped); a
        // dismount walk or an unstick detour replaces the AI step while no
        // defense intent holds the bot. Every piece sits >= 3 u inside its own
        // half, so the clamps below leave a hop alone.
        const arcing = this._pkMode === PK_ARC;
        if (arcing) {
            this.position.x = previousX;
            this.position.z = previousZ;
            this._stepMountArc(dt);
        } else if (this._defenseIntent === 'none') {
            this._applyScriptedWalk(dt, moveSpeed, previousX, previousZ);
        }
        // Up on a piece the soft depth line below yields to the piece.
        const elevated = (this._pkMode || PK_NONE) !== PK_NONE && this._pkPiece;

        // Bounds
        const b = this.arena.bounds;
        this.position.x = Math.max(b.minX + 1.5, Math.min(b.maxX - 1.5, this.position.x));
        this.position.z = Math.max(b.minZ + 1.5, Math.min(b.maxZ - 1.5, this.position.z));

        // Team side — allow more forward pressure based on ball position
        const ballZ = ball?.position?.z ?? 0;
        this._walkMinZ = b.minZ + 1.5;
        this._walkMaxZ = b.maxZ - 1.5;
        if (!this._gameRef?._ffa && this.team === 'red') {
            // depthBias<0 (aggressive) shifts pushUp toward 0 = more forward pressure allowed.
            const pushUp = (ballZ < -5 ? -3 : -1) - this._tendencyDepthBias; // push forward when ball is on blue side
            this._walkMaxZ = Math.min(this._walkMaxZ, pushUp);
            if (this.position.z > pushUp && !elevated) this.position.z = pushUp;
        }
        if (!this._gameRef?._ffa && this.team === 'blue') {
            const pushUp = (ballZ > 5 ? 3 : 1) + this._tendencyDepthBias;
            this._walkMinZ = Math.max(this._walkMinZ, pushUp);
            if (this.position.z < pushUp && !elevated) this.position.z = pushUp;
        }
        // Cross-court rule (js/court-rules.js): an aggressive depth bias may push the
        // line above past z=0 — while crossing is locked the midline is a hard wall.
        const courtSide = this._gameRef?.getCourtConfinementSide?.(this.team) || 0;
        if (courtSide) {
            this.position.z = clampToCourtHalf(this.position.z, courtSide, BOT_MIDLINE_MARGIN);
            if (courtSide < 0) this._walkMaxZ = Math.min(this._walkMaxZ, -BOT_MIDLINE_MARGIN);
            else this._walkMinZ = Math.max(this._walkMinZ, BOT_MIDLINE_MARGIN);
        }
        this._baseWalkMinZ = this._walkMinZ;
        this._baseWalkMaxZ = this._walkMaxZ;
        if (elevated) {
            const piece = this._pkPiece;
            const margin = (this.radius || 0.5) + 0.2;
            this._walkMinZ = Math.max(b.minZ + 1.5, Math.min(this._walkMinZ, piece.z - piece.halfDepth - margin));
            this._walkMaxZ = Math.min(b.maxZ - 1.5, Math.max(this._walkMaxZ, piece.z + piece.halfDepth + margin));
        }

        if (!arcing) {
            const wanted = Math.hypot(this.position.x - previousX, this.position.z - previousZ);
            this._moveAroundProps(previousX, previousZ);
            // Feet height = what the bot stands on (floor, or a parkour top).
            this._resolveBotHeight(dt);
            this._updateParkour(dt, ball);
            this._updateUnstick(dt, wanted, moveSpeed);
        }
        this.group.position.copy(this.position);

        // Attack cooldown
        if (this.attackTimer > 0) {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) this.attacking = false;
        }

        // Drive the rig's animator — facts derived from what the bot already
        // tracks (airborne only during a mount hop or a dismount fall).
        // ponytail: speed via position delta, reused facts object, 0 alloc/frame.
        if (this.animator) {
            const invDt = dt > 1e-4 ? 1 / dt : 0;
            const moved = Math.hypot(this.position.x - this._animPrevX, this.position.z - this._animPrevZ);
            this._animPrevX = this.position.x;
            this._animPrevZ = this.position.z;
            const facts = this._animFacts;
            facts.speed = moved * invDt;
            facts.grounded = this._pkMode !== PK_ARC && !(this._fallVy < 0);
            facts.verticalSpeed = this._fallVy || 0;
            facts.alive = this.alive;
            facts.aim = 0;
            facts.strafe = this._defenseStrafe;
            this.animator.update(dt, facts);
        }
    }

    // Same arena colliders as the player, using the bot's feet-based position.
    // Scalar checks and bounded substeps avoid both per-tick vectors and tunneling.
    // `y` = feet height to test at; `piece` = the parkour top the bot stands on
    // (it stays inside that footprint until it deliberately walks off).
    _canStandAt(x, z, y = this.position.y, piece = this._pkMode === PK_ON ? this._pkPiece : null) {
        const bounds = this.arena.bounds;
        if (x < bounds.minX + 1.5 || x > bounds.maxX - 1.5
            || z < this._walkMinZ || z > this._walkMaxZ) return false;
        if (piece && (x < piece.x - piece.halfWidth || x > piece.x + piece.halfWidth
            || z < piece.z - piece.halfDepth || z > piece.z + piece.halfDepth)) return false;
        const radius = this.radius || 0.5;
        for (const prop of this.arena.collidables || []) {
            if (prop.broken || prop.ballOnly) continue;
            if (Number.isFinite(prop.minX)) {
                if (y + 1.9 <= prop.minY || y >= prop.maxY) continue;
                if (x > prop.minX - radius && x < prop.maxX + radius
                    && z > prop.minZ - radius && z < prop.maxZ + radius) return false;
            } else if (prop.pos && Number.isFinite(prop.radius) && prop.radius > 0) {
                // Solid columns carry exact extents; legacy ones a centre band.
                if (Number.isFinite(prop.top)
                    ? y + 1.9 <= prop.bottom || y >= prop.top
                    : Math.abs(y + 1.7 - prop.pos.y) >= prop.radius + radius + 2) continue;
                const dx = x - prop.pos.x;
                const dz = z - prop.pos.z;
                if (dx * dx + dz * dz < (radius + prop.radius) ** 2 - 1e-10) return false;
            }
        }
        return true;
    }

    _moveAroundProps(previousX, previousZ) {
        if (!this.arena.collidables?.length) return;
        const position = this.position;
        // Map changes, team changes and random spawn offsets can begin in cover.
        // Resolve those overlaps once instead of trapping the bot inside the prop.
        if (!this._canStandAt(previousX, previousZ)) {
            this._separateFromProps();
            return;
        }
        const dx = position.x - previousX;
        const dz = position.z - previousZ;
        const length = Math.hypot(dx, dz);
        if (length < 1e-9) return;
        const steps = Math.min(128, Math.max(1, Math.ceil(length / ((this.radius || 0.5) * 0.5))));
        const stepX = dx / steps;
        const stepZ = dz / steps;
        const canDetour = this._defenseIntent !== 'deflect'
            && this._defenseIntent !== 'dodge-left' && this._defenseIntent !== 'dodge-right';
        let x = previousX;
        let z = previousZ;
        for (let i = 0; i < steps; i++) {
            if (this._canStandAt(x + stepX, z + stepZ)) {
                x += stepX;
                z += stepZ;
            } else if (Math.abs(stepX) > 1e-9 && this._canStandAt(x + stepX, z)) {
                x += stepX;
            } else if (Math.abs(stepZ) > 1e-9 && this._canStandAt(x, z + stepZ)) {
                z += stepZ;
            } else if (canDetour) {
                // A stable tangent walks around cover; no random rerolls or speed
                // bonus, and no detour during an already committed defensive move.
                let side = this._obstacleSide || this.strafeDir || 1;
                if (!this._canStandAt(x - stepZ * side, z + stepX * side)) side = -side;
                if (this._canStandAt(x - stepZ * side, z + stepX * side)) {
                    this._obstacleSide = side;
                    x -= stepZ * side;
                    z += stepX * side;
                }
            }
        }
        position.x = x;
        position.z = z;
    }

    _separateFromProps() {
        const position = this.position;
        const radius = this.radius || 0.5;
        const bounds = this.arena.bounds;
        for (let pass = 0; pass < 3; pass++) {
            for (const prop of this.arena.collidables) {
                if (prop.broken || prop.ballOnly) continue;
                if (Number.isFinite(prop.minX)) {
                    if (position.y + 1.9 <= prop.minY || position.y >= prop.maxY) continue;
                    const left = position.x - (prop.minX - radius);
                    const right = prop.maxX + radius - position.x;
                    const back = position.z - (prop.minZ - radius);
                    const front = prop.maxZ + radius - position.z;
                    if (left <= 0 || right <= 0 || back <= 0 || front <= 0) continue;
                    // Do not select an exit face beyond the court boundary: the
                    // bounds clamp would put the spawn straight back in the wall.
                    const leftExit = prop.minX - radius >= bounds.minX + 1.5 ? left : Infinity;
                    const rightExit = prop.maxX + radius <= bounds.maxX - 1.5 ? right : Infinity;
                    const backExit = prop.minZ - radius >= this._walkMinZ ? back : Infinity;
                    const frontExit = prop.maxZ + radius <= this._walkMaxZ ? front : Infinity;
                    const depth = Math.min(leftExit, rightExit, backExit, frontExit);
                    if (!Number.isFinite(depth)) continue;
                    if (depth === leftExit) position.x -= left + 1e-6;
                    else if (depth === rightExit) position.x += right + 1e-6;
                    else if (depth === backExit) position.z -= back + 1e-6;
                    else position.z += front + 1e-6;
                } else if (prop.pos && Number.isFinite(prop.radius) && prop.radius > 0) {
                    if (Number.isFinite(prop.top)
                        ? position.y + 1.9 <= prop.bottom || position.y >= prop.top
                        : Math.abs(position.y + 1.7 - prop.pos.y) >= prop.radius + radius + 2) continue;
                    const dx = position.x - prop.pos.x;
                    const dz = position.z - prop.pos.z;
                    const distance = Math.hypot(dx, dz);
                    const reach = radius + prop.radius;
                    if (distance >= reach) continue;
                    let nextX = prop.pos.x + (distance > 1e-6 ? dx / distance : 1) * (reach + 1e-6);
                    let nextZ = prop.pos.z + (distance > 1e-6 ? dz / distance : 0) * (reach + 1e-6);
                    if (!this._canStandAt(nextX, nextZ)) {
                        let nearest = Infinity;
                        for (let side = 0; side < 4; side++) {
                            const x = prop.pos.x + (side === 0 ? -reach - 1e-6 : side === 1 ? reach + 1e-6 : 0);
                            const z = prop.pos.z + (side === 2 ? -reach - 1e-6 : side === 3 ? reach + 1e-6 : 0);
                            const separation = (x - position.x) ** 2 + (z - position.z) ** 2;
                            if (separation < nearest && this._canStandAt(x, z)) {
                                nearest = separation;
                                nextX = x;
                                nextZ = z;
                            }
                        }
                    }
                    position.x = nextX;
                    position.z = nextZ;
                }
            }
            position.x = Math.max(bounds.minX + 1.5, Math.min(bounds.maxX - 1.5, position.x));
            position.z = Math.max(this._walkMinZ, Math.min(this._walkMaxZ, position.z));
            if (this._canStandAt(position.x, position.z)) break;
        }
    }

    // --- Parkour + unstick (all scalar state, 0 alloc per frame) ----------------

    _resetParkour() {
        this._pkMode = PK_NONE;
        this._pkPiece = null;
        this._pkT = 0;
        this._pkFalseFor = 0;
        this._fallVy = 0;
        this._detourTime = 0;
        this._stuckTime = 0;
        this._stuckX = NaN;
        this._stuckZ = NaN;
    }

    // Why a bot goes (or stays) up: the ball's play is on this piece, or the
    // ball will be high where the bot meets it.
    _parkourReason(piece) {
        if (!this._interceptFresh || !piece) return false;
        const target = this._interceptTarget;
        if (target.y >= BOT_MOUNT_HIGH_BALL) return true;
        return Math.abs(target.x - piece.x) <= piece.halfWidth + BOT_MOUNT_TARGET_MARGIN
            && Math.abs(target.z - piece.z) <= piece.halfDepth + BOT_MOUNT_TARGET_MARGIN;
    }

    // Highest parkour top under the bot's body (same expanded box as the
    // collider test) at or below `maxY`; 0 = the floor. Sets _supportPiece.
    _parkourSupportAt(x, z, maxY) {
        const platforms = this.arena.platforms;
        const radius = this.radius || 0.5;
        let best = 0;
        this._supportPiece = null;
        for (let i = 0; platforms && i < platforms.length; i++) {
            const p = platforms[i];
            if (!p.parkour || p.y > maxY + 1e-6 || p.y <= best) continue;
            if (Math.abs(x - p.x) < p.halfWidth + radius && Math.abs(z - p.z) < p.halfDepth + radius) {
                best = p.y;
                this._supportPiece = p;
            }
        }
        return best;
    }

    // Floor bots stand at y = 0 (as always). Up on a piece: its top. Walking
    // off: fall with gravity to the surface below (a lower piece or the floor).
    _resolveBotHeight(dt) {
        const position = this.position;
        const mode = this._pkMode || PK_NONE;
        if (mode === PK_ON) {
            const piece = this._pkPiece;
            if (piece && Math.abs(position.y - piece.y) < 0.05) {
                position.y = piece.y;
                this._fallVy = 0;
                return;
            }
            this._resetParkour(); // moved off-script (celebration, team switch): back to the floor
        }
        if (mode !== PK_OFF) {
            position.y = 0;
            this._fallVy = 0;
            return;
        }
        const support = this._parkourSupportAt(position.x, position.z, position.y);
        if (position.y > support + 1e-6) {
            this._fallVy = (this._fallVy || 0) + BOT_FALL_GRAVITY * dt;
            position.y = Math.max(support, position.y + this._fallVy * dt);
            if (position.y > support) return;
        }
        position.y = support;
        this._fallVy = 0;
        const landed = this._supportPiece;
        if (!landed) {
            this._pkMode = PK_NONE;
            this._pkPiece = null;
        } else if (landed !== this._pkPiece) {
            // Dropped onto a lower piece: keep walking down unless the reason returns.
            this._pkMode = PK_ON;
            this._pkPiece = landed;
            this._pkFalseFor = BOT_DISMOUNT_DELAY;
        }
    }

    // Dismount walk (toward the chosen exit) or unstick detour (toward a corner).
    _applyScriptedWalk(dt, moveSpeed, previousX, previousZ) {
        let tx;
        let tz;
        let speed;
        if (this._pkMode === PK_OFF) {
            tx = this._pkExitX;
            tz = this._pkExitZ;
            speed = moveSpeed * 0.6;
        } else if ((this._pkMode || PK_NONE) === PK_NONE && this._detourTime > 0) {
            this._detourTime -= dt;
            tx = this._detourX;
            tz = this._detourZ;
            speed = this._detourSpeed;
        } else {
            return;
        }
        this.position.x = previousX;
        this.position.z = previousZ;
        const dx = tx - previousX;
        const dz = tz - previousZ;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.2 && this._pkMode !== PK_OFF) this._detourTime = 0;
        if (distance < 1e-4) return;
        const step = Math.min(distance, speed * dt);
        this.position.x += dx / distance * step;
        this.position.z += dz / distance * step;
    }

    _stepMountArc(dt) {
        const piece = this._pkPiece;
        this._pkT = Math.min(1, this._pkT + dt / BOT_MOUNT_ARC_SECONDS);
        const s = this._pkT;
        const top = piece.y;
        const y0 = this._pkSY;
        const peak = top + BOT_MOUNT_ARC_PEAK;
        const riseEnd = 0.6;
        this.position.y = s <= riseEnd
            ? y0 + (peak - y0) * Math.sin(s / riseEnd * Math.PI / 2)
            : top + BOT_MOUNT_ARC_PEAK * Math.cos((s - riseEnd) / (1 - riseEnd) * Math.PI / 2);
        // Feet clear the top before the body moves over the edge.
        const clearAt = riseEnd * Math.asin(Math.min(1, (top - y0) / (peak - y0))) * 2 / Math.PI;
        const h = s <= clearAt ? 0 : (s - clearAt) / (1 - clearAt);
        const eased = h * h * (3 - 2 * h);
        this.position.x = this._pkSX + (this._pkEX - this._pkSX) * eased;
        this.position.z = this._pkSZ + (this._pkEZ - this._pkSZ) * eased;
        if (s >= 1) {
            this.position.y = top;
            this._pkMode = PK_ON;
            this._pkFalseFor = 0;
            this._fallVy = 0;
        }
    }

    // A bot may mount a step (floor -> 1.2 m) or a ledge (step -> 2.4 m), never
    // the perch, and only: no defense intent, within BOT_MOUNT_EDGE_REACH of the
    // edge, rise <= BOT_MOUNT_MAX_RISE, piece inside its walk limits on its own
    // half, and a reason (_parkourReason). Returns true when a hop starts.
    // Edge distance to a piece this bot may climb from where it stands now, or
    // -1: a step/ledge (never the perch), rise <= BOT_MOUNT_MAX_RISE, on its own
    // half and inside its walk limits.
    _climbableEdge(piece) {
        if (BOT_MOUNTABLE[piece.parkour] !== true || piece === this._pkPiece) return -1;
        const position = this.position;
        const rise = piece.y - position.y;
        if (rise <= 0.05 || rise > BOT_MOUNT_MAX_RISE + 1e-6) return -1;
        const minX = piece.x - piece.halfWidth;
        const maxX = piece.x + piece.halfWidth;
        const minZ = piece.z - piece.halfDepth;
        const maxZ = piece.z + piece.halfDepth;
        if (this.team === 'blue' ? minZ <= 0 : maxZ >= 0) return -1;
        const bounds = this.arena.bounds;
        if (minX < bounds.minX + 1.5 || maxX > bounds.maxX - 1.5
            || !(minZ >= this._baseWalkMinZ && maxZ <= this._baseWalkMaxZ)) return -1;
        return Math.hypot(Math.max(minX - position.x, 0, position.x - maxX),
            Math.max(minZ - position.z, 0, position.z - maxZ));
    }

    // An idle bot (not the ball's target) walks toward a climbable piece
    // within BOT_SEEK_RANGE while the ball will be high, so the high ground is
    // contested; the mount itself still needs every _tryMountParkour gate.
    _seekParkour(moveSpeed, dt) {
        const mode = this._pkMode || PK_NONE;
        const platforms = this.arena.platforms;
        if ((mode !== PK_NONE && mode !== PK_ON) || !platforms?.length || this._defenseIntent !== 'none'
            || !this._interceptFresh || this._interceptTarget.y < BOT_MOUNT_HIGH_BALL) return;
        let best = null;
        let bestEdge = BOT_SEEK_RANGE;
        for (let i = 0; i < platforms.length; i++) {
            const edge = this._climbableEdge(platforms[i]);
            if (edge >= 0 && edge < bestEdge) {
                bestEdge = edge;
                best = platforms[i];
            }
        }
        if (!best || bestEdge < BOT_MOUNT_EDGE_REACH - 0.2) return;
        const position = this.position;
        const dx = Math.max(best.x - best.halfWidth, Math.min(best.x + best.halfWidth, position.x)) - position.x;
        const dz = Math.max(best.z - best.halfDepth, Math.min(best.z + best.halfDepth, position.z)) - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-4) return;
        const step = moveSpeed * 0.5 * dt;
        position.x += dx / distance * step;
        position.z += dz / distance * step;
    }

    _tryMountParkour(ball) {
        const platforms = this.arena.platforms;
        if (!platforms?.length || this._defenseIntent !== 'none') return false;
        // G9: a hop hands the body to a BOT_MOUNT_ARC_SECONDS scripted arc that
        // cannot deflect until it lands (advanceDeflectReady) -- never start one
        // while the ball is actually closing in on this bot (same threat test
        // observeDefenseIntent uses) with less than the hop plus reaction time
        // left before contact. Only guards the narrow gap before the ball
        // enters alert range and _defenseIntent takes over (already 'none'
        // here); a targeted ball that isn't closing, or isn't close yet, is
        // never blocked.
        if (ball?.active && ball.targetPlayer === this && ball.currentSpeed > 0) {
            const dx = ball.position.x - this.position.x;
            const dy = ball.position.y - (this.position.y + 1.2);
            const dz = ball.position.z - this.position.z;
            const dist = Math.hypot(dx, dy, dz);
            if (isIncomingDefenseThreat(ball, dx, dy, dz, dist)) {
                const eta = (dist - ball.attackRange) / ball.currentSpeed;
                if (eta < BOT_MOUNT_ARC_SECONDS + this.reactionTime) return false;
            }
        }
        const position = this.position;
        const radius = this.radius || 0.5;
        for (let i = 0; i < platforms.length; i++) {
            const piece = platforms[i];
            const edge = this._climbableEdge(piece);
            if (edge < 0 || edge > BOT_MOUNT_EDGE_REACH) continue;
            if (!this._parkourReason(piece)) continue;
            const minX = piece.x - piece.halfWidth;
            const maxX = piece.x + piece.halfWidth;
            const minZ = piece.z - piece.halfDepth;
            const maxZ = piece.z + piece.halfDepth;
            const insetX = Math.min(radius + 0.1, piece.halfWidth);
            const insetZ = Math.min(radius + 0.1, piece.halfDepth);
            let landX = Math.max(minX + insetX, Math.min(maxX - insetX, position.x));
            let landZ = Math.max(minZ + insetZ, Math.min(maxZ - insetZ, position.z));
            if (!this._mountPathClear(landX, landZ, piece.y)) {
                landX = piece.x;
                landZ = piece.z;
                if (!this._mountPathClear(landX, landZ, piece.y)) continue;
            }
            this._pkMode = PK_ARC;
            this._pkPiece = piece;
            this._pkT = 0;
            this._pkSX = position.x;
            this._pkSY = position.y;
            this._pkSZ = position.z;
            this._pkEX = landX;
            this._pkEZ = landZ;
            this._pkFalseFor = 0;
            this._detourTime = 0;
            this.mountCount = (this.mountCount || 0) + 1;
            return true;
        }
        return false;
    }

    // The hop's horizontal path, tested at the top height (the body only moves
    // over the edge once the feet are above it).
    _mountPathClear(landX, landZ, top) {
        const sx = this.position.x;
        const sz = this.position.z;
        for (let k = 0; k <= 6; k++) {
            const t = k / 6;
            if (!this._canStandAt(sx + (landX - sx) * t, sz + (landZ - sz) * t, top, null)) return false;
        }
        return true;
    }

    // Straight floor walk from here to (x, z) fits the body all the way.
    _walkClear(x, z) {
        const sx = this.position.x;
        const sz = this.position.z;
        const steps = Math.max(2, Math.ceil(Math.hypot(x - sx, z - sz) / 0.25));
        for (let k = 1; k <= steps; k++) {
            const t = k / steps;
            if (!this._canStandAt(sx + (x - sx) * t, sz + (z - sz) * t)) return false;
        }
        return true;
    }

    // Stay up while the reason holds; walk off once it has been false for
    // BOT_DISMOUNT_DELAY. From the floor or a lower piece, try to mount. `ball`
    // is threaded through to _tryMountParkour for its targeted-contact gate.
    _updateParkour(dt, ball) {
        if (!this.alive) return;
        const mode = this._pkMode || PK_NONE;
        if (mode === PK_ON) {
            if (this._parkourReason(this._pkPiece)) this._pkFalseFor = 0;
            else this._pkFalseFor += dt;
            if (this._defenseIntent === 'none' && this._tryMountParkour(ball)) return;
            if (this._pkFalseFor >= BOT_DISMOUNT_DELAY && this._defenseIntent === 'none') this._beginDismount();
        } else if (mode === PK_NONE) {
            this._tryMountParkour(ball);
        }
    }

    // Nearest edge to walk off: an exit just past the edge where the body fits
    // at the current height (never toward a taller neighbour such as the
    // perch), preferring exits inside the normal walk limits.
    _beginDismount() {
        const piece = this._pkPiece;
        const position = this.position;
        const radius = this.radius || 0.5;
        const out = radius + 0.1;
        let best = Infinity;
        let bestX = 0;
        let bestZ = 0;
        for (let pass = 0; pass < 2 && !Number.isFinite(best); pass++) {
            for (let side = 0; side < 4; side++) {
                const x = side === 0 ? piece.x - piece.halfWidth - out
                    : side === 1 ? piece.x + piece.halfWidth + out : position.x;
                const z = side === 2 ? piece.z - piece.halfDepth - out
                    : side === 3 ? piece.z + piece.halfDepth + out : position.z;
                if (pass === 0 && (z < this._baseWalkMinZ || z > this._baseWalkMaxZ)) continue;
                const cost = Math.abs(x - position.x) + Math.abs(z - position.z);
                if (cost >= best || !this._canStandAt(x, z, position.y, null)) continue;
                best = cost;
                bestX = x;
                bestZ = z;
            }
        }
        if (!Number.isFinite(best)) return; // boxed in up here: hold, retry next frame
        this._pkMode = PK_OFF;
        this._pkExitX = bestX;
        this._pkExitZ = bestZ;
        this._fallVy = 0;
    }

    // Wanting to move (no defense intent holding the bot) yet covering less
    // than BOT_STUCK_DISTANCE in BOT_STUCK_SECONDS: flip the detour side and
    // head for the nearest corner of the blocking piece.
    _updateUnstick(dt, wanted, moveSpeed) {
        const position = this.position;
        const wantsToMove = (this._pkMode || PK_NONE) === PK_NONE && this._defenseIntent === 'none'
            && wanted > moveSpeed * dt * 0.25;
        if (!wantsToMove || !Number.isFinite(this._stuckX)
            || Math.hypot(position.x - this._stuckX, position.z - this._stuckZ) >= BOT_STUCK_DISTANCE) {
            this._stuckTime = 0;
            this._stuckX = position.x;
            this._stuckZ = position.z;
            if (!wantsToMove) return;
        }
        this._stuckTime += dt;
        if (this._stuckTime < BOT_STUCK_SECONDS) return;
        this._stuckTime = 0;
        this.stuckEpisodes = (this.stuckEpisodes || 0) + 1;
        this._obstacleSide = -(this._obstacleSide || this.strafeDir || 1);
        this._beginDetour(Math.min(moveSpeed * 0.85, Math.max(wanted / dt, moveSpeed * 0.3)));
    }

    _beginDetour(speed) {
        const position = this.position;
        const radius = this.radius || 0.5;
        const y = position.y;
        const collidables = this.arena.collidables;
        let blocker = null;
        let nearest = radius + 0.35;
        for (let i = 0; collidables && i < collidables.length; i++) {
            const prop = collidables[i];
            if (prop.broken || prop.ballOnly) continue;
            let gap;
            if (Number.isFinite(prop.minX)) {
                if (y + 1.9 <= prop.minY || y >= prop.maxY) continue;
                gap = Math.hypot(Math.max(prop.minX - position.x, 0, position.x - prop.maxX),
                    Math.max(prop.minZ - position.z, 0, position.z - prop.maxZ));
            } else if (prop.pos && prop.radius > 0) {
                if (Number.isFinite(prop.top) && (y + 1.9 <= prop.bottom || y >= prop.top)) continue;
                gap = Math.hypot(position.x - prop.pos.x, position.z - prop.pos.z) - prop.radius;
            } else continue;
            if (gap < nearest) {
                nearest = gap;
                blocker = prop;
            }
        }
        if (!blocker) return;
        const reach = radius + 0.3;
        const box = Number.isFinite(blocker.minX);
        const minX = (box ? blocker.minX : blocker.pos.x - blocker.radius) - reach;
        const maxX = (box ? blocker.maxX : blocker.pos.x + blocker.radius) + reach;
        const minZ = (box ? blocker.minZ : blocker.pos.z - blocker.radius) - reach;
        const maxZ = (box ? blocker.maxZ : blocker.pos.z + blocker.radius) + reach;
        // Nearest standable corner, preferring one whose straight walk is clear
        // (a corner tucked against a neighbouring piece would pin it again).
        let best = Infinity;
        for (let corner = 0; corner < 8; corner++) {
            const x = corner & 1 ? maxX : minX;
            const z = corner & 2 ? maxZ : minZ;
            const distance = Math.hypot(x - position.x, z - position.z) + (corner < 4 ? 0 : 1e6);
            if (distance >= best || !this._canStandAt(x, z)) continue;
            if (corner < 4 && !this._walkClear(x, z)) continue;
            best = distance;
            this._detourX = x;
            this._detourZ = z;
        }
        if (!Number.isFinite(best)) return;
        this._detourTime = BOT_DETOUR_SECONDS;
        this._detourSpeed = speed;
    }

    armFirstSoloDeflectGuard() {
        this._firstSoloDeflectGuard = { forceNextOpportunity: false };
    }

    _resetDefenseIntent() {
        this.reactionTimer = 0;
        this.windUpTimer = 0;
        this.windUpCommitted = false;
        this._deflectDecided = false;
        this._willDeflect = false;
        this._defenseIntent = 'none';
        this._defenseDodgeSign = 0;
        this._defenseDodgeLatch = 0;
        this._defenseStrafe = 0;
        this._defenseDistance = Infinity;
        this._defenseBracePlayed = false;
        this._defenseTimeScale = 1;
        this._defenseSeenOutside = false;
    }

    // Called before update() so movement can react to a stable defense decision
    // on the very first alert frame. It is also safe to call from tryDeflect().
    observeDefenseIntent(ball, rng = Math.random) {
        if (!this.alive || this.attacking || this.attackTimer > 0 || !ball?.active || ball.targetPlayer !== this) {
            this._resetDefenseIntent();
            return 'none';
        }
        const dx = ball.position.x - this.position.x;
        const dy = ball.position.y - (this.position.y + 1.2);
        const dz = ball.position.z - this.position.z;
        const dist = Math.hypot(dx, dy, dz);
        const alertRange = ball.currentSpeed * (this.reactionTime + this.windUpTime) + ball.attackRange;
        if (!this._deflectDecided && !isIncomingDefenseThreat(ball, dx, dy, dz, dist)) {
            this._resetDefenseIntent();
            return 'none';
        }
        if (dist > alertRange) {
            if ((this._defenseIntent === 'dodge-left' || this._defenseIntent === 'dodge-right')
                && this._defenseDodgeLatch > 0) {
                this._defenseDistance = dist;
                return this._defenseIntent;
            }
            this._resetDefenseIntent();
            // G4: this approach crossed into the alert range normally, so
            // reaction + wind-up fit and the decision keeps the full timers.
            this._defenseSeenOutside = true;
            return 'none';
        }
        this._defenseDistance = dist;
        if (!this._deflectDecided) {
            this._deflectDecided = true;
            // G4 uncapped rally curve (RALLY_CRACK_SETTINGS): the chance decays
            // past r0; a ball assigned already inside the alert range squeezes
            // reaction + wind-up to the time left, or cannot be deflected when
            // that is under the floor. At or below r0, and on a normal alert
            // crossing, both are exactly the pre-G4 values.
            let chance = this.deflectChance;
            let reachable = true;
            const ratio = ball.baseSpeed > 0 ? ball.currentSpeed / ball.baseSpeed : 0;
            if (Number.isFinite(this.deflectDecay) && ratio > this.deflectDecayStart) {
                chance *= Math.pow(this.deflectDecay, ratio - this.deflectDecayStart);
            }
            if (!this._defenseSeenOutside && this.defenseTimeFloor > 0 && ball.currentSpeed > 0) {
                const need = this.reactionTime + this.windUpTime;
                const available = (dist - ball.attackRange) / ball.currentSpeed;
                if (available < need) {
                    const fit = available - this.defenseSqueezeMargin;
                    reachable = fit >= this.defenseTimeFloor;
                    this._defenseTimeScale = (reachable ? fit : this.defenseTimeFloor) / need;
                }
            }
            const rolledWillDeflect = rng() < chance && reachable;
            const guard = this._firstSoloDeflectGuard;
            if (guard?.forceNextOpportunity) {
                this._willDeflect = true;
                this._firstSoloDeflectGuard = null;
            } else {
                this._willDeflect = rolledWillDeflect;
                if (guard) this._firstSoloDeflectGuard = rolledWillDeflect ? null : { forceNextOpportunity: true };
            }
            if (this._willDeflect) {
                this._defenseIntent = 'deflect';
                if (!this._defenseBracePlayed) {
                    this._defenseBracePlayed = true;
                    this.animator?.play('deflect');
                }
            } else {
                this._defenseDodgeSign = rng() < 0.5 ? -1 : 1;
                this._defenseDodgeLatch = DEFENSE_DODGE_LATCH_SECONDS;
                this._defenseIntent = this._defenseDodgeSign < 0 ? 'dodge-left' : 'dodge-right';
            }
        }
        return this._defenseIntent;
    }

    // Frame-edge deflect (countdown warm-up path): readiness, then one distance
    // sample of the frame-start ball state. Live play resolves the contact
    // inside the frame instead (Game._resolveFrameContacts).
    tryDeflect(ball, dt = 0.016) {
        if (this.observeDefenseIntent(ball) !== 'deflect') return false;
        const dist = this._defenseDistance;

        // Reaction + wind-up must both finish within this frame first.
        if (!(this.advanceDeflectReady(ball, dt) <= dt)) return false;

        // The animation completes on approach, but the ball may only be redirected
        // when it has actually reached deflect range.
        if (dist > ball.attackRange) return false;

        return this.commitDeflect();
    }

    // G2 ready time: advances the reaction/wind-up timers by dt and returns
    // the exact moment inside this frame (seconds after its start; 0 once
    // committed earlier) at which both have finished, or Infinity when the
    // bot is not ready by the frame end. Also stored as deflectReadyAt for the
    // in-frame contact resolution after the ball steps.
    advanceDeflectReady(ball, dt = 0.016) {
        this.deflectReadyAt = Infinity;
        if (this.observeDefenseIntent(ball) !== 'deflect') return Infinity;

        // Alert range must cover the FULL commit budget — reaction time AND the
        // wind-up telegraph that follows it, not just reaction time. Wind-up was
        // added later (telegraphed wind-ups, ea037d5) but this range was never
        // widened to cover it, so the ball crossed the whole engagement window
        // before a bot ever finished committing — it never got a chance to
        // deflect at all. Scales with the ball's actual current speed so slow
        // and fast throws both leave a fair window.
        // ponytail: alert range ~ ballSpeed * (reactionTime + windUpTime) + attackRange
        // G4: a squeezed decision (observeDefenseIntent) runs both timers at
        // _defenseTimeScale; 1 (the default) leaves them exactly as tuned.
        const timeScale = this._defenseTimeScale > 0 ? this._defenseTimeScale : 1;
        const reactionTime = this.reactionTime * timeScale;
        const windUpTime = this.windUpTime * timeScale;
        const reactionBefore = this.reactionTimer;
        this.reactionTimer += dt;
        if (this.reactionTimer < reactionTime) return Infinity;
        let readyAt = Math.max(0, reactionTime - reactionBefore);

        // Wind-up telegraphing: bot shows intent before committing to deflect
        // Start wind-up if not already committed
        if (!this.windUpCommitted) {
            const windUpBefore = this.windUpTimer;
            this.windUpTimer += dt;
            if (this.windUpTimer < windUpTime) return Infinity;  // still winding up
            this.windUpCommitted = true;  // committed - now check for mishit
            readyAt = Math.max(readyAt, windUpTime - windUpBefore);
        }
        // G9: mid a scripted mount hop the arc owns the body until it lands —
        // never ready to deflect before then, however far reaction/wind-up
        // have already progressed (deflectReadyAt stays Infinity, which is
        // "at least" any remaining arc time, including the last sub-frame
        // sliver before _stepMountArc flips _pkMode off PK_ARC).
        if (this._pkMode === PK_ARC) return Infinity;
        this.deflectReadyAt = Math.min(readyAt, dt);
        return this.deflectReadyAt;
    }

    // Commit to a deflect the game has accepted: attack pose + mishit roll.
    commitDeflect() {
        // Commit to deflect, but check if bot will mishit (realistic skill variance)
        if (Math.random() < this.mishitRate) {
            this.attacking = true;
            this.attackTimer = 0.3;
            this.deflectionCount++;
            this._resetDefenseIntent();
            this._mishit = true;  // flag for game.js to apply angle deviation
            return true;  // attack animation plays, but ball goes off-target
        }

        this.attacking = true;
        this.attackTimer = 0.3;
        this.deflectionCount++;
        this._resetDefenseIntent();
        this._mishit = false;
        return true;
    }

    isAttacking() {
        return this.attacking;
    }

    getPosition() {
        return new THREE.Vector3(this.position.x, this.position.y + 1.2, this.position.z);
    }

    // Bot position is feet-based (see _moveAroundProps); hit capsule anchors here.
    getFeetY() {
        return this.position.y;
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
        this._resetParkour();
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
        this._resetParkour();
        this._resetDefenseIntent();
        this.alive = true;
        this.drawHpBar();
        this.group.position.copy(this.position);
        this.group.rotation.y = this.team === 'red' ? 0 : Math.PI;
        this.group.visible = true;
        this.group.scale.setScalar(0.01);
        this.setTargetOutline(false);
    }

    remove() {
        if (this._removed) return;
        this._removed = true;
        disposeObject3D(this.knifeGroup);
        this.targetOutline?.userData.dispose?.();
        this.rig?.dispose();
        // These sprites belong to the outer bot group, not to rig.dispose().
        for (const sprite of [this.nameSprite, this.avatarSprite, this.hpBar]) {
            sprite?.material?.map?.dispose();
            sprite?.material?.dispose();
        }
        this.scene.remove(this.group);
    }
}
