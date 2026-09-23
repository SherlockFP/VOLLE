// player.js — FPS controller with jump, aim-based throw, death/respawn,
// character loadout, skill/rune system, stamina-based spam protection, damage meter.
import * as THREE from 'three';
import { applyCharacter } from './characters.js';
import { clampToCourtHalf } from './court-rules.js';
import { applyRunes, tickSkillCooldowns, useSkill, DEFAULT_LOADOUT, ULTIMATES } from './skills.js';
import { createKnifeModel, createRocketLauncherModel, disposeObject3D } from './weapon-models.js';
import { advanceViewmodelGait, advanceViewmodelLanding, createKnifeAnimationState, knifeAnimationActionForAttack, resolveKnifePose, startKnifeAnimation, stepKnifeAnimation, triggerViewmodelLanding, viewmodelFrame } from './knife-animation.js';
import { resolveEquippedGlove } from './cosmetic-catalog.js';
import { attachViewmodelFx, disposeViewmodelFx, updateViewmodelFx } from './viewmodel-fx.js';
import { applyGloveLook, buildViewmodelHand, fitGripToModel, updateViewmodelHand } from './viewmodel-hand.js';

// Viewmodel camera FOV — CS/Valorant-style: narrower than the world camera so the
// held item keeps its proportions at any gameplay FOV.
// Default framing pulls the viewmodel camera back a little from the authored arm pose
// so knives read as held objects rather than filling the lower third of the screen.
const VIEWMODEL_CAMERA_BACKSET = 0.1;
// Tuned in-game: item sits bottom-right, blade clear of the crosshair (CS-like framing).
export const VIEWMODEL_DEFAULTS = Object.freeze({ fov: 60, x: 1.5, y: -0.3, z: 0.8 });
export const VIEWMODEL_SCALE = 0.64;
export const VIEWMODEL_LIMITS = Object.freeze({ fov: [54, 80], offset: [-2, 2] });

// Pure: clamps player viewmodel options (console viewmodel_fov / viewmodel_offset_*).
export function normalizeViewmodelOptions(options = {}) {
    const clamp = (value, [min, max], fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };
    return {
        fov: clamp(options.fov, VIEWMODEL_LIMITS.fov, VIEWMODEL_DEFAULTS.fov),
        x: clamp(options.x, VIEWMODEL_LIMITS.offset, VIEWMODEL_DEFAULTS.x),
        y: clamp(options.y, VIEWMODEL_LIMITS.offset, VIEWMODEL_DEFAULTS.y),
        z: clamp(options.z, VIEWMODEL_LIMITS.offset, VIEWMODEL_DEFAULTS.z)
    };
}

const STAMINA_PER_DEFLECT = 7;
const RAPID_DEFLECT_COST_STEP = 2;
const RAPID_DEFLECT_MAX_FATIGUE = 4;
const RAPID_DEFLECT_FATIGUE_DECAY = 3;
const STAMINA_REGEN = 20;     // per second
const STAMINA_EXHAUST_THRESHOLD = 15;
const ATTACK_COOLDOWN = 0.6;  // spam protection — wider window for fast balls
const SUCCESSFUL_DEFLECT_RECOVERY = 0.18;
// The blade only deflects for this long; the rest of ATTACK_COOLDOWN is recovery.
// When the live window equalled the cooldown, holding/spamming Mouse1 kept a
// deflect hitbox up 100% of the time and returned the ball with no aim or timing.
export const SWING_ACTIVE_WINDOW = 0.22;
const BASE_HIT_DAMAGE = 25;
export const GROUND_ACCEL = 14;
export const AIR_ACCEL = 12;
export const GROUND_FRICTION = 4;
export const STOP_SPEED = 3.125;
export const AIR_WISH_CAP = 0.94;
export const SLIPPERY_SURFACE_FACTOR = 0.28;
export const LOW_GRAVITY_FACTOR = 0.55;
export const HORIZONTAL_STEP = 1 / 120;
export const MAX_HORIZONTAL_STEPS = 8;
export const LONG_JUMP_SPEED = 14;
export const LONG_JUMP_MAX_SPEED = 16;
export const LONG_JUMP_VERTICAL_BOOST = 5.5;
export const LONG_JUMP_COOLDOWN = 1;
export const LONG_JUMP_STAMINA_COST = 30;

// Three.js cameras look down local -Z. Red spawns begin south of center and
// therefore need to face north (+Z); blue begins north and faces south (-Z).
export function spawnYawForTeam(team) {
    return team === 'red' ? Math.PI : 0;
}

export function applyGroundFriction(velocity, friction, stopSpeed, dt) {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed === 0) return { x: 0, z: 0 };
    const drop = Math.max(speed, stopSpeed) * friction * dt;
    const scale = Math.max(0, speed - drop) / speed;
    return { x: velocity.x * scale, z: velocity.z * scale };
}

export function sourceAccelerate(velocity, wishDir, wishSpeed, accel, dt, projectionCap = wishSpeed) {
    const wishLength = Math.hypot(wishDir.x, wishDir.z);
    if (wishLength === 0 || wishSpeed <= 0) return { ...velocity };
    const wishX = wishDir.x / wishLength;
    const wishZ = wishDir.z / wishLength;
    const currentSpeed = velocity.x * wishX + velocity.z * wishZ;
    const addSpeed = projectionCap - currentSpeed;
    if (addSpeed <= 0) return { ...velocity };

    const accelSpeed = Math.min(addSpeed, accel * wishSpeed * dt);
    return {
        x: velocity.x + wishX * accelSpeed,
        z: velocity.z + wishZ * accelSpeed
    };
}

export function moveHorizontalState(velocity, wishDir, wishSpeed, dt, onGround, surfaceFactor = 1) {
    let horizontal = { x: velocity.x, z: velocity.z };
    const displacement = { x: 0, z: 0 };
    const duration = Math.min(Math.max(dt, 0), HORIZONTAL_STEP * MAX_HORIZONTAL_STEPS);
    if (duration === 0) return { velocity: horizontal, displacement };

    const steps = Math.ceil(duration / HORIZONTAL_STEP);
    const stepDt = duration / steps;
    const hasInput = Math.hypot(wishDir.x, wishDir.z) > 0;
    const groundFactor = Math.max(0, surfaceFactor);

    for (let i = 0; i < steps; i++) {
        if (onGround) {
            horizontal = applyGroundFriction(
                horizontal,
                GROUND_FRICTION * groundFactor,
                STOP_SPEED,
                stepDt
            );
        }

        if (hasInput) {
            horizontal = onGround
                ? sourceAccelerate(horizontal, wishDir, wishSpeed, GROUND_ACCEL * groundFactor, stepDt)
                : sourceAccelerate(
                    horizontal,
                    wishDir,
                    wishSpeed,
                    AIR_ACCEL,
                    stepDt,
                    Math.min(wishSpeed, AIR_WISH_CAP)
                );
        }

        displacement.x += horizontal.x * stepDt;
        displacement.z += horizontal.z * stepDt;
    }

    return { velocity: horizontal, displacement };
}

// Consume only the dash time that remains this frame. This keeps dash reach
// invariant across render frame rates without changing its input gates.
export function consumeDashTime(remaining, dt) {
    return Math.min(Math.max(0, Number(remaining) || 0), Math.max(0, Number(dt) || 0));
}

export function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return !!target.closest?.('[contenteditable]:not([contenteditable="false"])');
}

// Countdown only accepts a primary attack while its warm-up ball is explicitly live.
// This keeps menus/lobby countdowns inert while making the first practice deflect reliable.
export function canStartPrimaryAttack(state, ball) {
    return state === 'PLAYING'
        || state === 'CELEBRATION'
        || (state === 'COUNTDOWN' && ball?._warmup === true);
}

export function resolveJump({ spaceDown, onGround, jumpHeld, jumpsRemaining, verticalVel, jumpForce, bhopEnabled }) {
    if (!spaceDown) {
        return { onGround, jumpHeld: false, jumpsRemaining, verticalVel, kind: null };
    }
    if (onGround && (bhopEnabled || !jumpHeld)) {
        return {
            onGround: false,
            jumpHeld: true,
            jumpsRemaining: 1,
            verticalVel: jumpForce,
            kind: 'ground'
        };
    }
    if (!onGround && !jumpHeld && jumpsRemaining > 0) {
        return {
            onGround: false,
            jumpHeld: true,
            jumpsRemaining: jumpsRemaining - 1,
            verticalVel: jumpForce,
            kind: 'double'
        };
    }
    return { onGround, jumpHeld, jumpsRemaining, verticalVel, kind: null };
}

export function resolveLongJump({
    ctrlDown,
    spaceDown,
    forwardDown,
    onGround,
    comboHeld,
    dashActive,
    cooldown,
    stamina,
    velocity,
    verticalVel = 0,
    forward,
    targetSpeed = LONG_JUMP_SPEED,
    maxSpeed = LONG_JUMP_MAX_SPEED,
    verticalBoost = LONG_JUMP_VERTICAL_BOOST,
    staminaCost = LONG_JUMP_STAMINA_COST,
    cooldownDuration = LONG_JUMP_COOLDOWN
}) {
    const comboDown = ctrlDown && spaceDown && forwardDown;
    const unchanged = {
        triggered: false,
        comboHeld: comboDown,
        onGround,
        cooldown,
        stamina,
        velocity: { x: velocity.x, z: velocity.z },
        verticalVel,
        event: null
    };
    if (!comboDown || comboHeld || !onGround || dashActive || cooldown > 0 || stamina < staminaCost) {
        return unchanged;
    }

    const forwardLength = Math.hypot(forward.x, forward.z);
    if (forwardLength === 0 || maxSpeed <= 0) return unchanged;

    const fx = forward.x / forwardLength;
    const fz = forward.z / forwardLength;
    const safeTarget = Math.min(Math.max(0, targetSpeed), maxSpeed);
    const forwardSpeed = velocity.x * fx + velocity.z * fz;
    const addedSpeed = Math.max(0, safeTarget - forwardSpeed);
    let x = velocity.x + fx * addedSpeed;
    let z = velocity.z + fz * addedSpeed;
    const speed = Math.hypot(x, z);
    if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        x *= scale;
        z *= scale;
    }

    return {
        triggered: true,
        comboHeld: true,
        onGround: false,
        cooldown: cooldownDuration,
        stamina: stamina - staminaCost,
        velocity: { x, z },
        verticalVel: verticalBoost,
        event: {
            type: 'longjump',
            staminaCost,
            cooldown: cooldownDuration
        }
    };
}

export function resolveWaterMovement({ verticalVel = 0, dt = 0, swimUp = false, dive = false, surfaceY = 3, floorY = -5, y = 0 }) {
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.1));
    const input = swimUp ? 16 : dive ? -13 : 3.5;
    const nextVelocity = Math.max(-7, Math.min(7, (verticalVel + input * step) * Math.exp(-4.5 * step)));
    const nextY = Math.max(floorY + 0.35, Math.min(surfaceY + 0.25, y + nextVelocity * step));
    return { verticalVel: nextVelocity, y: nextY, submerged: nextY < surfaceY - 0.2 };
}

// lowGravity map flag reuses this scale — same mechanism as arena.config.lowGravity
// consumed by ball.js, so player fall speed and ball flight stay consistent.
export function resolveGravityScale(lowGravity) {
    return lowGravity ? LOW_GRAVITY_FACTOR : 1;
}

// Combines chill-skill slow with hazard-zone slow (waterZones etc). Hostile
// hazardMoveMul (NaN/undefined/<=0/Infinity) falls back to no slow (1).
export function resolveMovementSpeedMultiplier(chillActive, hazardMoveMul) {
    const chill = chillActive ? 0.8 : 1;
    const hazard = Number.isFinite(hazardMoveMul) && hazardMoveMul > 0 ? hazardMoveMul : 1;
    return chill * hazard;
}

export function clipInwardVelocity(velocity, normal) {
    const normalLength = Math.hypot(normal.x, normal.z);
    if (normalLength === 0) return { ...velocity };
    const nx = normal.x / normalLength;
    const nz = normal.z / normalLength;
    const inwardSpeed = velocity.x * nx + velocity.z * nz;
    if (inwardSpeed >= 0) return { ...velocity };
    return {
        x: velocity.x - nx * inwardSpeed,
        z: velocity.z - nz * inwardSpeed
    };
}

export function clipMovementState(velocity, dashDir, normal, clipDash) {
    return {
        velocity: clipInwardVelocity(velocity, normal),
        dashDir: clipDash ? clipInwardVelocity(dashDir, normal) : { x: dashDir.x, z: dashDir.z }
    };
}

export function resolvePlanarBoxCollision(position, previous, radius, height, collider) {
    const values = [
        collider?.minX, collider?.maxX, collider?.minY,
        collider?.maxY, collider?.minZ, collider?.maxZ
    ];
    if (!values.every(Number.isFinite)) return { hit: false, x: position.x, z: position.z };
    const feet = position.y - height;
    const head = position.y + 0.2;
    if (head <= collider.minY || feet >= collider.maxY - PROP_STEP_TOLERANCE) {
        return { hit: false, x: position.x, z: position.z };
    }

    const minX = collider.minX - radius;
    const maxX = collider.maxX + radius;
    const minZ = collider.minZ - radius;
    const maxZ = collider.maxZ + radius;
    if (position.x < minX || position.x > maxX || position.z < minZ || position.z > maxZ) {
        return { hit: false, x: position.x, z: position.z };
    }

    const dx = position.x - previous.x;
    const dz = position.z - previous.z;
    const previousOutside = previous.x < minX || previous.x > maxX
        || previous.z < minZ || previous.z > maxZ;
    if (previousOutside && (dx !== 0 || dz !== 0)) {
        let entry = 0;
        let exit = 1;
        let nx = 0;
        let nz = 0;
        for (const axis of [
            { start: previous.x, delta: dx, min: minX, max: maxX, nearNormal: [-1, 0], farNormal: [1, 0] },
            { start: previous.z, delta: dz, min: minZ, max: maxZ, nearNormal: [0, -1], farNormal: [0, 1] }
        ]) {
            if (axis.delta === 0) {
                if (axis.start < axis.min || axis.start > axis.max) {
                    return { hit: false, x: position.x, z: position.z };
                }
                continue;
            }
            let near = (axis.min - axis.start) / axis.delta;
            let far = (axis.max - axis.start) / axis.delta;
            let nearNormal = axis.nearNormal;
            if (near > far) {
                [near, far] = [far, near];
                nearNormal = axis.farNormal;
            }
            if (near > entry) {
                entry = near;
                [nx, nz] = nearNormal;
            }
            exit = Math.min(exit, far);
            if (entry > exit) return { hit: false, x: position.x, z: position.z };
        }
        if (entry >= 0 && entry <= 1) {
            const safeEntry = Math.max(0, entry - 0.0001);
            return {
                hit: true,
                x: previous.x + dx * safeEntry,
                z: previous.z + dz * safeEntry,
                nx,
                nz
            };
        }
    }

    const sides = [
        { distance: position.x - minX, x: minX, z: position.z, nx: -1, nz: 0 },
        { distance: maxX - position.x, x: maxX, z: position.z, nx: 1, nz: 0 },
        { distance: position.z - minZ, x: position.x, z: minZ, nx: 0, nz: -1 },
        { distance: maxZ - position.z, x: position.x, z: maxZ, nx: 0, nz: 1 }
    ];
    const nearest = sides.reduce((best, side) => side.distance < best.distance ? side : best);
    return { hit: true, x: nearest.x, z: nearest.z, nx: nearest.nx, nz: nearest.nz };
}

// Solid map props (js/arena.js _addSolidBox / _markSolidColumn) carry exact
// vertical extents (`bottom`/`top`; boxes also minY/maxY). A body is blocked
// only while its feet are below the top (minus a small step tolerance), so a
// player can jump onto a prop and stand there instead of sinking into it.
export const PROP_STEP_TOLERANCE = 0.05;

export function solidPropSpansBody(feetY, headY, collider) {
    return feetY < collider.top - PROP_STEP_TOLERANCE && headY > collider.bottom;
}

// Head vs the underside of a raised solid (collider.bottom > 0). When the head
// (eye + 0.2) was at or below the underside last frame and has risen into it
// while the body overlaps the footprint, clamp the eye so the head rests on
// the underside and return true (the caller zeroes upward speed). Mutates
// `position.y` only. Walking into the side of a slab is left to the planar
// resolvers.
export function resolveHeadBump(position, previous, radius, height, collider) {
    const bottom = collider.bottom;
    if (!(bottom > 0) || !Number.isFinite(collider.top)) return false;
    const head = position.y + 0.2;
    const previousHead = previous.y + 0.2;
    if (previousHead > bottom + 1e-6 || head <= bottom) return false;
    // Feet already above the top: the body is over the prop, not under it.
    if (position.y - height >= collider.top) return false;
    const inside = Number.isFinite(collider.minX)
        ? position.x > collider.minX - radius && position.x < collider.maxX + radius
            && position.z > collider.minZ - radius && position.z < collider.maxZ + radius
        : Math.hypot(position.x - collider.pos.x, position.z - collider.pos.z) < collider.radius + radius;
    if (!inside) return false;
    position.y = bottom - 0.2 - 1e-4;
    return true;
}

// Landing footprint of a one-way platform. Decks (mecha, social hub) need the
// whole body over the slab; solid prop tops only need the body centre over
// the box / circle, so landing on a crate edge works and stepping past the
// edge drops the player (the side collider then pushes them clear).
// Solid tops also hold a body whose centre is just past the edge (up to
// SOLID_EDGE_SUPPORT of its radius): a player hopping straight up against a
// crate / parkour step from a standstill clears the top by a few tenths of a
// metre and would otherwise slide back down its face.
export const SOLID_EDGE_SUPPORT = 0.75;

export function platformSupports(entry, x, z, radius) {
    const dx = x - entry.x;
    const dz = z - entry.z;
    if (entry.solid) {
        const lip = (Number.isFinite(radius) ? radius : 0) * SOLID_EDGE_SUPPORT;
        if (Number.isFinite(entry.radius)) return Math.hypot(dx, dz) <= entry.radius + lip;
        return Math.abs(dx) <= entry.halfWidth + lip && Math.abs(dz) <= entry.halfDepth + lip;
    }
    return Math.abs(dx) <= entry.halfWidth - radius && Math.abs(dz) <= entry.halfDepth - radius;
}

export class Player {
    constructor(renderer, camera, arena) {
        this.renderer = renderer;
        this.camera = camera;
        this.arena = arena;
        this.scene = renderer.scene;

        this.position = new THREE.Vector3(0, 1.7, -10);
        this.velocity = new THREE.Vector3();
        this.speed = 10;
        this._chargeMoveScale = 1; // set by Game._updateCharge while charging a deflect
        this.height = 1.7;
        this.radius = 0.7;          // ponytail: hand clipping fix — walls'a daha uzak

        // Jump — double jump
        this.jumpForce = 8;
        this.gravity = -20;
        this.onGround = true;
        this.inWater = false;
        this.verticalVel = 0;
        this.jumpsRemaining = 2;  // ponytail: double jump, reset on ground
        this.bhopEnabled = true;

        // Mouse
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.sensitivity = 0.002;
        this.invertY = false;
        this.locked = false;

        // Flick tracking — recent mouse motion for Genji-style spike/lob
        this.flickX = 0;      // smoothed horizontal motion
        this.flickY = 0;      // smoothed vertical motion (negative = flick down)
        this.flickDecay = 12; // how fast flick energy fades

        // Camera kick (recoil punch on deflect) — decays back to 0
        this.kickAmt = 0;
        this.kickTarget = 0;
        // FOV kick (short zoom punch on a charged deflect release) — same decay
        // curve as kickAmt, applied to camera.fov instead of pitch.
        this.fovKickAmt = 0;
        this._fovKickApplied = 0;
        this.killcamLock = false;

        // Attack + SPAM PROTECTION (stamina gate)
        this.keys = {};
        // Analog stick from js/touch-controls.js (x = strafe, y = forward, |v| <= 1).
        // touchInput = touch controls enabled: pointer lock is skipped.
        this.touchMove = { x: 0, y: 0 };
        this.touchInput = false;
        this.team = 'red';
        this.attacking = false;
        this._deflectHeld = false; // raw mouse-button state — Game._updateCharge gates on this
        this.catchRequested = false;
        this.attackCooldown = 0;
        this.attackActive = 0;
        this.attackDuration = ATTACK_COOLDOWN;
        this.canAttack = true;
        this.knifeAnimation = createKnifeAnimationState('classic');
        this.knifeAttackType = 'slash';
        this._viewSwayX = 0;
        this._viewSwayY = 0;
        this._viewGait = { phase: 0, weight: 0, speed: 0 };
        this._viewLanding = { active: false, elapsed: 0, offset: 0, depth: 0 };
        this._viewmodelPoseContext = { gaitPhase: 0, gaitWeight: 0, gaitSpeed: 0, landingElapsed: 0, landingDepth: 0, reduceMotion: false, swayX: 0, swayY: 0 };
        this._reducedMotionMedia = typeof window !== 'undefined'
            ? window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
            : null;
        this.rocketCooldown = 0;
        this._rocketQueued = false;
        this.stamina = 100;          // ponytail: stamina gate blocks mouse-1 spam
        this.staminaMax = 100;
        this.exhausted = false;
        this.deflectFatigue = 0;
        this._lastDeflectAttemptAt = -Infinity;

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

        // Longjump - Ctrl+Space+W from the ground.
        this.longJumpCooldown = 0;
        this.longJumpCost = LONG_JUMP_STAMINA_COST;
        this.longJumpSpeed = LONG_JUMP_SPEED;
        this.longJumpMaxSpeed = LONG_JUMP_MAX_SPEED;
        this.longJumpVerticalBoost = LONG_JUMP_VERTICAL_BOOST;
        this._longJumpWasDown = false;
        this.longJumpEvent = null;
        this.horizontalSpeed = 0;

        // A-D-A-D spin dodge — rapid strafe to orbit ball
        this._strafeHistory = [];  // [{ key: 'A'|'D', time }]

        // State
        this.alive = true;
        this.deathTimer = 0;
        this._handRequested = false;

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
        this._syncViewmodelWeapon();
    }

    buildHandMesh() {
        // Right arm — closer to camera + shorter for wall clipping fix
        this.armGroup = new THREE.Group();
        this.armGroup.position.set(0.25, -0.2, -0.1);

        // Tapered team sleeve + gloved fist whose fingers wrap the held item's handle
        // (js/viewmodel-hand.js). The fist rides a wrist group that follows the item's
        // animation, so grips never slide off mid-swing. Field names below are kept
        // for game.js (handMesh visibility, gloveMat celebration tint).
        const teamColor = this.team === 'red' ? 0xee5555 : 0x5577dd;
        this.viewmodelHand = buildViewmodelHand(this.armGroup, color => this.renderer.createToonMaterial(color), teamColor);
        this.armMat = this.viewmodelHand.sleeveMat;
        this.armMesh = this.viewmodelHand.sleeve;
        this.gloveMat = this.viewmodelHand.gloveMat;
        this.handMesh = this.viewmodelHand.handMesh;
        this.fingerGroup = this.viewmodelHand.fingerGroup;

        this._viewmodelGloveId = null;
        this._syncViewmodelGlove();

        this.knifeStyle = { id: 'training', model: 'classic', finish: 'satin', color: '#d7f3ff', accent: '#4e7d99' };
        this.knifeGroup = createKnifeModel(this.knifeStyle);
        this._applyViewmodelFrame(this.knifeGroup, 'classic');
        this.armGroup.add(this.knifeGroup);
        this._viewKick = 0;

        // Viewmodel lives in its own scene with a narrow, fixed FOV camera (see
        // Renderer#setViewmodel): the world FOV slider (60-110) no longer balloons the
        // hand, and the knife can't clip into walls. armGroup keeps camera-local coords.
        this.viewmodelScene = new THREE.Scene();
        this.viewmodelCamera = new THREE.PerspectiveCamera(VIEWMODEL_DEFAULTS.fov, window.innerWidth / window.innerHeight, 0.01, 20);
        this.viewmodelScene.add(this.viewmodelCamera);
        this.viewmodelScene.add(new THREE.HemisphereLight(0xe6fbff, 0x2b2436, 1.5));
        const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
        keyLight.position.set(1.2, 2, 1.5);
        const rimLight = new THREE.DirectionalLight(0x7fe9ff, 1.1);
        rimLight.position.set(-1.5, 0.6, -1);
        this.viewmodelScene.add(keyLight, rimLight);
        // Scene root, not a camera child: moving the camera (viewmodel_offset_*) must reframe the arm.
        this.viewmodelScene.add(this.armGroup);
        this.viewmodelSuppressed = false;
        this.renderer.setViewmodel?.(this.viewmodelScene, this.viewmodelCamera, () => this.armGroup.visible && !this.viewmodelSuppressed);
        // Whole hand + item scaled together so the fist keeps its grip on every handle.
        this.armGroup.scale.setScalar(VIEWMODEL_SCALE);
        this.setViewmodelOptions(VIEWMODEL_DEFAULTS);
        this.armGroup.visible = false;

        // ponytail: tek el — sol el kaldırıldı
    }

    _renderHandVisibility(on) {
        const wasVisible = this.armGroup.visible;
        if (on) this._syncViewmodelGlove();
        this.armGroup.visible = Boolean(on);
        if (on && !wasVisible && this.knifeGroup?.userData.weaponType === 'knife') {
            startKnifeAnimation(this.knifeAnimation, 'draw');
            this.game?.audio?.playKnife?.('draw', this.knifeGroup.userData.model);
        }
    }

    // Console/user preference. Forced death, spectate and preview states use the
    // temporary API below so a later respawn restores sv_hand instead of erasing it.
    setHandVisible(on) {
        this._handRequested = Boolean(on);
        this._renderHandVisibility(this._handRequested && this.alive !== false);
    }

    setHandTemporarilyVisible(on) {
        this._renderHandVisibility(Boolean(on) && this.alive !== false);
    }

    restoreHandVisibility() {
        this._renderHandVisibility(this._handRequested && this.alive !== false);
    }

    // CS-style viewmodel_fov / viewmodel_offset_x|y|z. Offsets move the viewmodel
    // camera (not the arm) so every animation keeps its authored pose.
    setViewmodelOptions(options = {}) {
        const next = normalizeViewmodelOptions(options);
        this.viewmodelOptions = next;
        if (!this.viewmodelCamera) return next;
        this.viewmodelCamera.fov = next.fov;
        this.viewmodelCamera.position.set(-next.x * 0.05, -next.y * 0.05, next.z * 0.06 + VIEWMODEL_CAMERA_BACKSET);
        this.viewmodelCamera.updateProjectionMatrix();
        return next;
    }

    setKnifeStyle(style = {}) {
        this.knifeStyle = { ...style };
        this._syncViewmodelWeapon();
    }

    // One place decides where a held item sits in the fist, for knives and the launcher alike.
    _applyViewmodelFrame(group, model) {
        const frame = viewmodelFrame(model);
        group.position.set(...frame.position);
        group.rotation.set(...frame.rotation);
        group.scale.setScalar(frame.scale);
    }

    _syncViewmodelWeapon() {
        if (!this.armGroup) return;
        const visible = this.knifeGroup?.visible !== false;
        disposeViewmodelFx(this.knifeGroup?.userData.viewmodelFx);
        disposeObject3D(this.knifeGroup);
        if (this.charId === 'soldier') {
            this.knifeGroup = createRocketLauncherModel(this.team);
            this._applyViewmodelFrame(this.knifeGroup, 'rocket');
        } else {
            this.knifeGroup = createKnifeModel(this.knifeStyle);
            // Rarity layer is measured at identity, before the in-hand frame transform.
            attachViewmodelFx(this.knifeGroup, this.knifeStyle, this.armGroup, { reduceMotion: this._prefersReducedMotion() });
            this._applyViewmodelFrame(this.knifeGroup, this.knifeGroup.userData.model);
            this.knifeAnimation = createKnifeAnimationState(this.knifeGroup.userData.model);
            if (this.viewmodelHand) fitGripToModel(this.viewmodelHand, this.knifeGroup.userData.model);
        }
        this.knifeGroup.visible = visible;
        this.armGroup.add(this.knifeGroup);
    }

    setupInput() {
        // ponytail: AbortController so game restart doesn't accumulate listeners
        this._abort = new AbortController();
        const signal = this._abort.signal;
        document.addEventListener('keydown', e => {
            if (isEditableTarget(e.target)) return;
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
            this.applyLookDelta(e.movementX, e.movementY, this.sensitivity);
        }, { signal });
        document.addEventListener('mousedown', e => {
            if (isEditableTarget(e.target)) return;
            // ponytail: pointer lock re-activation removed — causes mouse bug during pause
            if (e.button === 0) this.pressPrimary();
            if (e.button === 2 && this.pressSecondary()) e.preventDefault();
        }, { signal });
        document.addEventListener('mouseup', e => {
            if (e.button === 0) this.releasePrimary();
        }, { signal });
        document.addEventListener('contextmenu', e => {
            if (this.game?.state === 'PLAYING') e.preventDefault();
        }, { signal });
        // ponytail: Q tuşu aktif skill (sadece oyun sırasında)
        document.addEventListener('keydown', e => {
            if (isEditableTarget(e.target)) return;
            this.handleActionKey(e);
        }, { signal });
        document.addEventListener('pointerlockchange', () => {
            const wasLocked = this.locked;
            this.locked = document.pointerLockElement === this.renderer.domElement;
            if (wasLocked && !this.locked) this._clearInputState();
        }, { signal });
        document.addEventListener('focusin', e => {
            // Chat also works without pointer lock; old holds must not keep moving
            // or charging while subsequent text keydowns are correctly ignored.
            if (isEditableTarget(e.target)) this._clearInputState();
        }, { signal });
        window.addEventListener('blur', () => this._clearInputState(), { signal });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this._clearInputState();
        }, { signal });
    }

    // Shared input entry points — mouse/keyboard listeners above and the touch
    // overlay (js/touch-controls.js) both call these, so gameplay rules live once.

    // Camera look from any pointer. dx/dy in screen px; radPerPx = sensitivity.
    // Flick/sway are accumulated in mouse-equivalent px so spike/lob and view sway
    // feel the same at any sensitivity (touch uses a different rad/px than mouse).
    applyLookDelta(dx, dy, radPerPx = this.sensitivity) {
        // Only look during live play and when not typing in a chat/text input.
        if (!this.alive) return false;
        const st = this.game?.state;
        if (st !== 'PLAYING' && st !== 'COUNTDOWN' && st !== 'ROUND_END' && st !== 'CELEBRATION' && st !== 'SOCIAL_HUB') return false;
        if (this.game?.ui?.isTeamPopupOpen?.()) return false;
        if (this.game?.ui?.spectating) return false;
        if (isEditableTarget(document.activeElement)) return false;
        this.euler.y -= dx * radPerPx;
        this.euler.x += (this.invertY ? 1 : -1) * dy * radPerPx;
        this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
        this.camera.quaternion.setFromEuler(this.euler);

        // Accumulate flick energy (raw pixel motion this frame)
        const flickScale = this.sensitivity > 0 ? radPerPx / this.sensitivity : 1;
        const fx = dx * flickScale;
        const fy = dy * flickScale;
        this.flickX += fx;
        this.flickY += fy; // +down, -up on screen
        this._viewSwayX = Math.max(-1, Math.min(1, this._viewSwayX + fx * 0.008));
        this._viewSwayY = Math.max(-1, Math.min(1, this._viewSwayY + fy * 0.008));
        return true;
    }

    // Left mouse down / touch Deflect press: swing now, then hold-to-charge.
    pressPrimary() {
        const state = this.game?.state;
        if (!this.alive || this.game?.ui?.spectating || !canStartPrimaryAttack(state, this.game?.ball)) return false;
        this.tryAttack('slash');
        this._deflectHeld = true;
        return true;
    }

    // Ends the hold-to-charge window (Game._updateCharge) regardless of
    // game state — mirrors keyup's unconditional release semantics.
    releasePrimary() {
        this._deflectHeld = false;
    }

    // Right mouse / touch Stab. Returns true when the press was consumed.
    pressSecondary() {
        const state = this.game?.state;
        if (!this.alive || state !== 'PLAYING') return false;
        if (this.charId === 'soldier' && this.rocketCooldown <= 0) {
            this._rocketQueued = true;
            return true;
        }
        if (this.game?.ui?.spectating) return false;
        this.tryAttack('stab');
        return true;
    }

    // Q skill, F/I inspect, R twirl — takes the KeyboardEvent, or any { code, repeat }
    // (touch buttons pass constant objects), so both paths share one gate.
    handleActionKey(e) {
        if (e.code === 'KeyQ' && this.alive && this.game?.state === 'PLAYING') {
            this._skillQueued = true;
        }
        const isInspectKey = e.code === 'KeyF' || e.code === 'KeyI';
        // Free Lab uses F/R for ball tools, except during a knife test drive.
        const practiceOwnsKey = (e.code === 'KeyF' || e.code === 'KeyR')
            && this.game?._practiceMode
            && !this.game?._cosmeticPractice
            && !this.game?._knifeTrial;
        const canFlourish = !e.repeat && !practiceOwnsKey
            && this.alive && this.game?.state === 'PLAYING'
            && !this.game?.ui?.spectating && !this.game?.sport;
        if (e.code === 'KeyR' && canFlourish) this.twirlKnife();
        if (isInspectKey && !e.repeat && !practiceOwnsKey
            && this.alive && this.game?.state === 'PLAYING'
            && !this.game?.ui?.spectating) {
            this.inspectKnife();
        }
    }

    // R: quick CS2-style flourish. Presses during a twirl queue one follow-up so
    // spamming chains smoothly instead of snapping back to the start.
    twirlKnife() {
        if (this.attackCooldown > 0 || this.charId === 'soldier' || !this.knifeGroup || this.knifeGroup.userData.weaponType !== 'knife') return false;
        const chaining = this.knifeAnimation.action === 'twirl';
        startKnifeAnimation(this.knifeAnimation, 'twirl');
        if (!chaining) this.game?.audio?.playKnife?.('twirl', this.knifeGroup.userData.model);
        return true;
    }

    inspectKnife() {
        if (this.attackCooldown > 0 || this.charId === 'soldier' || !this.knifeGroup || this.knifeGroup.userData.weaponType !== 'knife') return false;
        startKnifeAnimation(this.knifeAnimation, 'inspect');
        this.game?.audio?.playKnife?.('inspect', this.knifeGroup.userData.model);
        return true;
    }

    _updateKnifeViewmodel(dt) {
        stepKnifeAnimation(this.knifeAnimation, dt);
        const context = this._viewmodelPoseContext;
        context.gaitPhase = this._viewGait.phase;
        context.gaitWeight = this._viewGait.weight;
        context.gaitSpeed = this._viewGait.speed;
        context.landingElapsed = this._viewLanding.elapsed;
        context.landingDepth = this._viewLanding.depth;
        context.reduceMotion = this._prefersReducedMotion();
        context.swayX = this._viewSwayX;
        context.swayY = this._viewSwayY;
        const pose = resolveKnifePose(this.knifeAnimation, context);
        this.armGroup.position.set(...pose.armPosition);
        this.armGroup.rotation.set(...pose.armRotation);
        // Deflect recoil: the hand snaps back and up, then springs home.
        if (this._viewKick > 0.001) {
            const kick = this._viewKick * (context.reduceMotion ? 0.3 : 1);
            this.armGroup.position.z += kick * 0.055;
            this.armGroup.position.y += kick * 0.012;
            this.armGroup.rotation.x += kick * 0.16;
            this._viewKick *= Math.exp(-16 * dt);
        } else {
            this._viewKick = 0;
        }
        this.knifeGroup.position.set(...pose.knifePosition);
        this.knifeGroup.rotation.set(...pose.knifeRotation);
        const inspectParts = this.knifeGroup.userData.inspectParts;
        for (let index = 0; index < (inspectParts?.length || 0); index++) {
            const part = inspectParts[index];
            const base = part.userData.inspectBase;
            const delta = pose.parts[index] || 0;
            if (typeof delta === 'number') {
                part.rotation.set(base?.x || 0, base?.y || 0, (base?.z || 0) + delta);
            } else {
                part.rotation.set((base?.x || 0) + (delta.x || 0), (base?.y || 0) + (delta.y || 0), (base?.z || 0) + (delta.z || 0));
            }
        }
        updateViewmodelFx(this.knifeGroup.userData.viewmodelFx, dt, pose);
        const grip = pose.action === 'heavy' || pose.action === 'stab' || pose.action === 'slash'
            ? Math.sin(pose.progress * Math.PI)
            : 0;
        updateViewmodelHand(this.viewmodelHand, pose, this.knifeAnimation._frame, grip, this.knifeAnimation.clock, !context.reduceMotion);
    }

    _syncViewmodelGlove() {
        const loadout = typeof window !== 'undefined'
            ? window.__store?.get?.('equippedWearables')
            : null;
        const glove = resolveEquippedGlove(loadout);
        const id = glove?.id || 'team-default';
        if (this._viewmodelGloveId === id) return;
        this._viewmodelGloveId = id;
        const teamColor = this.team === 'red' ? 0xee5555 : 0x5577dd;
        if (this.viewmodelHand) applyGloveLook(this.viewmodelHand, glove, teamColor);
    }

    _prefersReducedMotion() {
        const bodyReduced = typeof document !== 'undefined'
            && document.body?.classList?.contains('reduced-motion');
        const osReduced = this._reducedMotionMedia?.matches === true;
        return bodyReduced || osReduced;
    }

    _onViewmodelLanding(impactSpeed, visualScale = 1) {
        this.audio?.playLand?.();
        return triggerViewmodelLanding(this._viewLanding, impactSpeed, visualScale);
    }

    _resetViewmodelLanding() {
        this._viewLanding.active = false;
        this._viewLanding.elapsed = 0;
        this._viewLanding.offset = 0;
        this._viewLanding.depth = 0;
    }

    cleanupInput() {
        this._abort?.abort();
        this._abort = null;
    }

    _clearInputState() {
        for (const code of Object.keys(this.keys)) this.keys[code] = false;
        this._dashWasDown = false;
        this._longJumpWasDown = false;
        this._jumpHeld = false;
        this._skillQueued = false;
        this._rocketQueued = false;
        this._strafeHistory = [];
        this._deflectHeld = false;
        this.touchMove.x = 0;
        this.touchMove.y = 0;
    }

    lock() {
        if (this.touchInput) return; // touch controls: no pointer lock
        try { this.renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (_) {}
    }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    tryAttack(action = 'slash') {
        // SPAM PROTECTION: stamina yetersizse veya cooldown varsa attack yok.
        // Mouse-1 spam ile sınırsız top atılamaz.
        if (this._celebNoAttack) return false; // celebration'da loser'lar vuramaz
        if (this.attackCooldown > 0) return false;
        const now = performance.now() / 1000;
        const elapsed = now - this._lastDeflectAttemptAt;
        this.deflectFatigue = Math.max(0, this.deflectFatigue - elapsed * RAPID_DEFLECT_FATIGUE_DECAY);
        const staminaCost = STAMINA_PER_DEFLECT
            + Math.ceil(this.deflectFatigue) * RAPID_DEFLECT_COST_STEP;
        if (this.stamina < staminaCost) {
            this.exhausted = true;
            return false;
        }
        this.stamina -= staminaCost;
        this.deflectFatigue = Math.min(RAPID_DEFLECT_MAX_FATIGUE, this.deflectFatigue + 1);
        this._lastDeflectAttemptAt = now;
        if (this.stamina < STAMINA_EXHAUST_THRESHOLD) this.exhausted = true;
        this.attacking = true;
        this.attackCooldown = this.attackDuration;
        this.attackActive = Math.min(SWING_ACTIVE_WINDOW, this.attackDuration);
        this.canAttack = false;
        this.knifeAttackType = action === 'stab' ? 'stab' : 'slash';
        if (this.knifeGroup?.userData.weaponType === 'knife') {
            startKnifeAnimation(this.knifeAnimation, knifeAnimationActionForAttack(this.knifeAttackType));
            this.game?.audio?.playKnife?.(knifeAnimationActionForAttack(this.knifeAttackType), this.knifeGroup?.userData.model);
        }
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
        if (this.game?._skillsDisabled) return null;
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
        this._viewKick = Math.min(1, this.kickAmt / 0.12);
    }

    // Short FOV punch on a charged deflect release — see fovKickAmt decay in update().
    fovKick(amountDeg = 4) {
        this.fovKickAmt = amountDeg;
    }

    update(dt) {
        this.longJumpEvent = null;
        if (!this.alive) {
            this.deathTimer -= dt;
            // ponytail: auto-respawn after death timer expires (round-mid death)
            if (this.deathTimer <= 0 && this.game?.state === 'PLAYING' && !this.game?._ffa) {
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
        const chillMul = resolveMovementSpeedMultiplier(this._chillTimer > 0, this._hazardMoveMul);
        if (this._chillTimer > 0) this._chillTimer -= dt;

        // Flick energy decays toward 0 each frame
        const decay = Math.exp(-this.flickDecay * dt);
        this.flickX *= decay;
        this.flickY *= decay;
        const swayDecay = Math.exp(-9 * dt);
        this._viewSwayX *= swayDecay;
        this._viewSwayY *= swayDecay;

        // Attack cooldown
        this.rocketCooldown = Math.max(0, this.rocketCooldown - dt);
        if (this.attackActive > 0) {
            this.attackActive -= dt;
            if (this.attackActive <= 0) {
                this.attackActive = 0;
                this.attacking = false; // hitbox closes; recovery continues below
            }
        }
        if (this.attackCooldown > 0) {
            this.attackCooldown -= dt;
            if (this.attackCooldown <= 0) {
                this.attacking = false;
                this.canAttack = true;
            }
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
        // Touch joystick (js/touch-controls.js): analog direction + magnitude.
        // Keys win when both are held; otherwise |stick| scales the wish speed.
        const touchMove = this.touchMove;
        let analogScale = 1;
        if (touchMove.x !== 0 || touchMove.y !== 0) {
            if (moveDir.lengthSq() === 0) analogScale = Math.min(1, Math.hypot(touchMove.x, touchMove.y));
            moveDir.addScaledVector(forward, touchMove.y).addScaledVector(right, touchMove.x);
        }

        const ctrlDown = !!(this.keys['ControlLeft'] || this.keys['ControlRight']);
        this.longJumpCooldown = Math.max(0, this.longJumpCooldown - dt);
        const longJump = resolveLongJump({
            ctrlDown,
            spaceDown: !!this.keys['Space'],
            forwardDown: !!this.keys['KeyW'] || touchMove.y > 0.5,
            onGround: this.onGround,
            comboHeld: this._longJumpWasDown,
            dashActive: this.dashTimer > 0,
            cooldown: this.longJumpCooldown,
            stamina: this.stamina,
            velocity: this.velocity,
            verticalVel: this.verticalVel,
            forward,
            targetSpeed: this.longJumpSpeed,
            maxSpeed: this.longJumpMaxSpeed,
            verticalBoost: this.longJumpVerticalBoost,
            staminaCost: this.longJumpCost
        });
        this._longJumpWasDown = longJump.comboHeld;
        this.longJumpCooldown = longJump.cooldown;
        this.stamina = longJump.stamina;
        this.velocity.x = longJump.velocity.x;
        this.velocity.z = longJump.velocity.z;
        if (longJump.triggered) {
            this.onGround = longJump.onGround;
            this.verticalVel = longJump.verticalVel;
            this._jumpHeld = true;
            this.jumpsRemaining = 1;
            this.longJumpEvent = longJump.event;
            this.audio?.playJump();
        }

        // Wall jump gets first claim on an airborne jump press.
        const ab = this.arena.bounds;
        const ceil = this.arena.ceilingHeight > 0 ? this.arena.ceilingHeight : (ab.maxY || 30);
        const wallJumpMaxY = ceil * 0.6;
        const nearWall = this.position.x - this.radius - 1 < ab.minX || this.position.x + this.radius + 1 > ab.maxX
                      || this.position.z - this.radius - 1 < ab.minZ || this.position.z + this.radius + 1 > ab.maxZ;
        this._wallJumpCD = (this._wallJumpCD || 0) - dt;
        let jumpClaimed = longJump.triggered;
        if (!jumpClaimed && this.keys['Space'] && !this.onGround && nearWall && this.position.y < wallJumpMaxY
            && !this._jumpHeld && this._wallJumpCD <= 0 && this.stamina >= 15) {
            this.verticalVel = this.jumpForce * 0.85;
            this.stamina -= 15;
            this._wallJumpCD = 0.6;
            if (this.position.x - this.radius - 1 < ab.minX) {
                this.position.x = ab.minX + this.radius + 1;
                this._clipHorizontalVelocity(1, 0);
            }
            if (this.position.x + this.radius + 1 > ab.maxX) {
                this.position.x = ab.maxX - this.radius - 1;
                this._clipHorizontalVelocity(-1, 0);
            }
            if (this.position.z - this.radius - 1 < ab.minZ) {
                this.position.z = ab.minZ + this.radius + 1;
                this._clipHorizontalVelocity(0, 1);
            }
            if (this.position.z + this.radius + 1 > ab.maxZ) {
                this.position.z = ab.maxZ - this.radius - 1;
                this._clipHorizontalVelocity(0, -1);
            }
            this._jumpHeld = true;
            jumpClaimed = true;
            if (this.audio) this.audio.playJump();
        }

        if (!jumpClaimed) {
            const jump = resolveJump({
                spaceDown: !!this.keys['Space'],
                onGround: this.onGround,
                jumpHeld: !!this._jumpHeld,
                jumpsRemaining: this.jumpsRemaining,
                verticalVel: this.verticalVel,
                jumpForce: this.jumpForce,
                bhopEnabled: this.bhopEnabled
            });
            this.onGround = jump.onGround;
            this._jumpHeld = jump.jumpHeld;
            this.jumpsRemaining = jump.jumpsRemaining;
            this.verticalVel = jump.verticalVel;
            if (jump.kind && this.audio) this.audio.playJump();
        }

        // Dash — tap Ctrl for burst in movement direction
        this.dashCooldown -= dt;
        const wasDashing = this.dashTimer > 0;
        if (wasDashing) {
            // Dashing: move at burst speed
            const dashDt = consumeDashTime(this.dashTimer, dt);
            this.position.addScaledVector(this.dashDir, this.dashForce * dashDt);
            this.dashTimer = Math.max(0, this.dashTimer - dashDt);
        } else {
            // Sprint — hold Shift for speed boost, drains stamina
            const sprinting = moveDir.lengthSq() > 0 && holdingShift && this.onGround && this.stamina > 0;
            const spd = sprinting ? this.speed * this.sprintMultiplier : this.speed;
            if (sprinting) this.stamina = Math.max(0, this.stamina - this.sprintDrain * dt);
            this._moveHorizontal(moveDir, spd * analogScale * chillMul * this._chargeMoveScale, dt);
        }

        // Dash trigger — Ctrl tap
        if (ctrlDown && !this._dashWasDown && !longJump.triggered
            && this.dashCooldown <= 0 && this.dashTimer <= 0 && this.stamina >= this.dashCost) {
            this.dashCooldown = 1.0;
            this.dashTimer = this.dashDuration;
            this.stamina -= this.dashCost;
            // Dash in movement direction, or forward if no input
            this.dashDir.copy(moveDir.length() > 0 ? moveDir.normalize() : forward);
            this.audio?.playCue?.('dash');
            this._justDashed = true; // ponytail: dash trail için flag
        }
        this._dashWasDown = ctrlDown;

        // Vertical physics / island water volume. Space swims up, C dives.
        const water = this.arena.getWaterAt?.(this.position);
        const swimming = Boolean(water && this.position.y <= water.surfaceY + 0.25);
        this.inWater = swimming;
        if (swimming) {
            const waterState = resolveWaterMovement({
                verticalVel: this.verticalVel,
                dt,
                swimUp: this.keys['Space'],
                dive: this.keys['KeyC'],
                surfaceY: water.surfaceY,
                floorY: water.floorY,
                y: this.position.y
            });
            this.verticalVel = waterState.verticalVel;
            this.position.y = waterState.y;
            this.onGround = false;
        } else {
            const gravity = this.gravity * resolveGravityScale(this.arena.config?.lowGravity);
            this.verticalVel += gravity * dt;
            this.position.y += this.verticalVel * dt;
        }

        // Dikey tavan — görünür tavan yok ama haritayı aşma (sonsuz yükselme engeli).
        const ceilY = (this.arena.ceilingHeight > 0 ? this.arena.ceilingHeight : (this.arena.bounds.maxY || 30)) - 0.5;
        if (this.position.y > ceilY) {
            this.position.y = ceilY;
            if (this.verticalVel > 0) this.verticalVel = 0;
        }

        const standingHazard = this.arena.getHazardAt?.(this.position);
        if (standingHazard?.kind === 'void') this.onGround = false;
        const wasAirborneBeforeLanding = !this.onGround;
        const landingImpactSpeed = Math.max(0, -this.verticalVel);
        let pendingLanding = false;
        let supported = false;
        if (this.verticalVel <= 0) {
            const platform = this.arena.platforms?.find(entry => {
                const landingY = entry.y + this.height;
                return prevPos.y >= landingY
                    && this.position.y <= landingY
                    && platformSupports(entry, this.position.x, this.position.z, this.radius);
            });
            if (platform) {
                this.position.y = platform.y + this.height;
                this.verticalVel = 0;
                this.onGround = true;
                this.jumpsRemaining = 2;
                pendingLanding = wasAirborneBeforeLanding;
                supported = true;
            }
        }
        if (!swimming && this.position.y <= this.height && standingHazard?.kind !== 'void') {
            if (!this.onGround) {
                this.jumpsRemaining = 2;
                pendingLanding = true;
            }
            this.position.y = this.height;
            this.verticalVel = 0;
            this.onGround = true;
            supported = true;
        }
        // Walked off a deck / prop top: airborne again with one air jump left,
        // as if the player had jumped (no ground jump in mid-air).
        if (this.onGround && !supported && !swimming) {
            this.onGround = false;
            this.jumpsRemaining = Math.min(this.jumpsRemaining, 1);
        }

        this._jumpPadCooldown = Math.max(0, (this._jumpPadCooldown || 0) - dt);
        if (this.onGround && this._jumpPadCooldown === 0) {
            const pad = this.arena.jumpPads?.find(entry => {
                const dx = this.position.x - entry.position.x;
                const dz = this.position.z - entry.position.z;
                return dx * dx + dz * dz <= 8;
            });
            if (pad) {
                this.verticalVel = pad.impulse;
                this.onGround = false;
                this._jumpPadCooldown = 0.45;
                this.audio?.playJump();
            }
        }
        if (pendingLanding && !swimming && this.onGround) {
            const landingScale = this.bhopEnabled && this.keys['Space'] ? 0.4 : 1;
            this._onViewmodelLanding(landingImpactSpeed, landingScale);
        }

        // Bounds
        const b = this.arena.bounds;
        const minX = b.minX + this.radius;
        const maxX = b.maxX - this.radius;
        const minZ = b.minZ + this.radius;
        const maxZ = b.maxZ - this.radius;
        if (this.position.x < minX) {
            this.position.x = minX;
            this._clipHorizontalVelocity(1, 0, wasDashing);
        } else if (this.position.x > maxX) {
            this.position.x = maxX;
            this._clipHorizontalVelocity(-1, 0, wasDashing);
        }
        if (this.position.z < minZ) {
            this.position.z = minZ;
            this._clipHorizontalVelocity(0, 1, wasDashing);
        } else if (this.position.z > maxZ) {
            this.position.z = maxZ;
            this._clipHorizontalVelocity(0, -1, wasDashing);
        }
        // Cross-court rule: game.js sets courtSide (-1 red half, +1 blue half, 0 free);
        // the midline is then a wall for the player only (js/court-rules.js).
        if (this.courtSide) {
            const halfZ = clampToCourtHalf(this.position.z, this.courtSide, this.radius);
            if (halfZ !== this.position.z) {
                this.position.z = halfZ;
                this._clipHorizontalVelocity(0, this.courtSide, wasDashing);
            }
        }

        // Collision with map props (trees, pillars, walls, etc.)
        if (this.arena.collidables) {
            const collidables = this.arena.getNearbyCollidables?.(this.position)
                || this.arena.collidables;
            for (const c of collidables) {
                // Ball-only slabs under one-way decks (players jump through them).
                if (c.ballOnly) continue;
                // Raised solids (slabs, canopies, arches): a player rising into
                // the underside stops there instead of being shoved sideways.
                if (c.bottom > 0 && resolveHeadBump(this.position, prevPos, this.radius, this.height, c)) {
                    if (this.verticalVel > 0) this.verticalVel = 0;
                    continue;
                }
                if (Number.isFinite(c.minX)) {
                    const result = resolvePlanarBoxCollision(
                        this.position,
                        prevPos,
                        this.radius,
                        this.height,
                        c
                    );
                    if (result.hit) {
                        this.position.x = result.x;
                        this.position.z = result.z;
                        this._clipHorizontalVelocity(result.nx, result.nz, wasDashing);
                    }
                    continue;
                }
                const dx = this.position.x - c.pos.x;
                const dz = this.position.z - c.pos.z;
                const dy = Math.abs(this.position.y - c.pos.y);
                const minDist = this.radius + c.radius;
                const spans = Number.isFinite(c.top)
                    ? solidPropSpansBody(this.position.y - this.height, this.position.y + 0.2, c)
                    : dy < c.radius + this.radius + 2;
                if (dx * dx + dz * dz < minDist * minDist && spans) {
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    const previousDx = prevPos.x - c.pos.x;
                    const previousDz = prevPos.z - c.pos.z;
                    const previousDist = Math.hypot(previousDx, previousDz);
                    const speed = Math.hypot(this.velocity.x, this.velocity.z);
                    const nx = dist > 0.01 ? dx / dist
                        : previousDist > 0.01 ? previousDx / previousDist
                            : speed > 0 ? -this.velocity.x / speed : 1;
                    const nz = dist > 0.01 ? dz / dist
                        : previousDist > 0.01 ? previousDz / previousDist
                            : speed > 0 ? -this.velocity.z / speed : 0;
                    const overlap = minDist - dist;
                    this.position.x += nx * overlap;
                    this.position.z += nz * overlap;
                    this._clipHorizontalVelocity(nx, nz, wasDashing);
                }
            }
        }

        // Momentum deflection observes the final jump, gravity, and collision result.
        this._frameVel = new THREE.Vector3(
            wasDashing ? this.dashDir.x * this.dashForce : this.velocity.x,
            this.verticalVel,
            wasDashing ? this.dashDir.z * this.dashForce : this.velocity.z
        );
        this.horizontalSpeed = Math.hypot(this._frameVel.x, this._frameVel.z);
        if (this.longJumpEvent) {
            this.longJumpEvent.horizontalSpeed = this.horizontalSpeed;
        }

        advanceViewmodelGait(this._viewGait, dt, this.horizontalSpeed, this.onGround && !this._viewLanding.active, wasDashing);
        advanceViewmodelLanding(this._viewLanding, dt, this._prefersReducedMotion());
        if (this.knifeGroup?.userData.weaponType === 'knife') {
            this._updateKnifeViewmodel(dt);
        } else {
            this.armGroup.position.set(0.25, -0.3 + this._viewLanding.offset, -0.3);
            this.armGroup.rotation.set(0, 0, 0);
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

            // FOV kick — same decay curve as the camera punch above, applied to fov
            // instead of pitch. Delta-based (undoes last frame's addition before
            // applying the new one) so it never fights a live settings FOV change.
            this.fovKickAmt *= Math.exp(-14 * dt);
            if (this.fovKickAmt < 0.01) this.fovKickAmt = 0;
            if (this._fovKickApplied || this.fovKickAmt) {
                if (this._fovKickApplied) this.camera.fov -= this._fovKickApplied;
                this._fovKickApplied = this.fovKickAmt;
                if (this._fovKickApplied) this.camera.fov += this._fovKickApplied;
                this.camera.updateProjectionMatrix();
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

    applyRocketImpulse(origin, strength = 1) {
        const away = this.position.clone().sub(origin);
        away.y = 0;
        if (away.lengthSq() < 0.001) away.copy(this.getAimDirection()).multiplyScalar(-1).setY(0).normalize();
        else away.normalize();
        this.velocity.x += away.x * 11 * strength;
        this.velocity.z += away.z * 11 * strength;
        this.verticalVel = Math.max(this.verticalVel, 10.5 * strength);
        this.onGround = false;
        this._jumpHeld = true;
    }

    // Deflect sonrası: consecutiveMisses sıfırla, lifesteal rune uygula.
    onSuccessfulDeflect() {
        this.consecutiveMisses = 0;
        this.attackCooldown = Math.min(this.attackCooldown, this._rapidDeflect ? 0.08 : SUCCESSFUL_DEFLECT_RECOVERY);
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
        this.velocity.set(0, 0, 0);
        this.verticalVel = 0;
        this._resetViewmodelLanding();
        this._clearInputState();
        this.setHandTemporarilyVisible(false);
    }

    revive() {
        this.alive = true;
        this.deathTimer = 0;
        this.hp = this.maxHp;
        this.shield = 0;
        this.stamina = this.staminaMax;
        this.exhausted = false;
        this.deflectFatigue = 0;
        this._lastDeflectAttemptAt = -Infinity;
        this.consecutiveMisses = 0;
        this._burnTimer = 0;
        this._chillTimer = 0;
        this.restoreHandVisibility();
    }

    getPosition() { return this.position.clone(); }
    isAttacking() { return this.attacking; }

    _moveHorizontal(wishDir, wishSpeed, dt) {
        const surfaceFactor = this.arena.config?.slippery
            ? SLIPPERY_SURFACE_FACTOR
            : (this.arena.config?.gameplay?.sandTraction ?? 1);
        const moved = moveHorizontalState(
            this.velocity,
            wishDir,
            wishSpeed,
            dt,
            this.onGround,
            surfaceFactor
        );
        this.velocity.x = moved.velocity.x;
        this.velocity.z = moved.velocity.z;
        this.position.x += moved.displacement.x;
        this.position.z += moved.displacement.z;
    }

    _clipHorizontalVelocity(nx, nz, wasDashing = false) {
        const clipped = clipMovementState(
            this.velocity,
            this.dashDir,
            { x: nx, z: nz },
            wasDashing || this.dashTimer > 0
        );
        this.velocity.x = clipped.velocity.x;
        this.velocity.z = clipped.velocity.z;
        this.dashDir.x = clipped.dashDir.x;
        this.dashDir.z = clipped.dashDir.z;
    }

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
        this._viewmodelGloveId = null;
        this._syncViewmodelGlove();
    }

    respawn() {
        const spawn = this.arena.getPlayerSpawn(this.team);
        this.position.copy(spawn);
        this.position.y = this.height;
        this.velocity.set(0, 0, 0);
        this.verticalVel = 0;
        this.onGround = true;
        this._resetViewmodelLanding();
        this.euler.set(0, spawnYawForTeam(this.team), 0, 'YXZ');
        this.camera.quaternion.setFromEuler(this.euler);
        this.alive = true;
        this.hp = this.maxHp;
        this.shield = 0;
        this.stamina = this.staminaMax;
        this.exhausted = false;
        this.deflectFatigue = 0;
        this._lastDeflectAttemptAt = -Infinity;
        this.consecutiveMisses = 0;
        this._burnTimer = 0;
        this._chillTimer = 0;
        this.skillCooldowns = {};
        this.ultimateCharge = 0;
        this.ultimateActive = false;
        this._qHoldTimer = 0;
        this.restoreHandVisibility();
    }

    setSensitivity(val) { this.sensitivity = val; }
    setInvertY(val) { this.invertY = !!val; }
}
