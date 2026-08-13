// ball.js — Rally ball with aim-based direction, slow speed scaling, bounce, arc,
// skin system, portal teleport, freeze support.
import * as THREE from 'three';
import { ObjectPool } from './objectPool.js';

export const STEERING_CONTROL_WINDOW = 0.074;
const STEERING_TICK = 1 / 66;
const WIDE_SHOT_DOT = Math.cos(15 * Math.PI / 180);
const SUBTLE_ROUTE_DOT = Math.cos(6 * Math.PI / 180);

const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function steeringTurnAlpha(dt, deflections = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return 0;
    const tickTurn = clamp(0.30 + Math.max(0, deflections) * 0.018, 0, 0.9);
    return 1 - Math.pow(1 - tickTurn, dt / STEERING_TICK);
}

export function proximityHomingTurnRate(distance, homingAge = 0) {
    const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 9);
    const proximity = 1 - clamp(safeDistance / 9, 0, 1);
    const ageBonus = clamp(Number.isFinite(homingAge) ? homingAge * 0.12 : 0, 0, 0.85);
    return clamp(3.5 + proximity * 3.4 + ageBonus, 3.5, 7.5);
}

export function homingRescueRange(speed) {
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    return clamp(safeSpeed * 0.055, 3.5, 6);
}

export function shouldDirectHomingRescue(distance, speed, homingAge, alignment) {
    if (!Number.isFinite(alignment) || !Number.isFinite(distance)) return false;
    const isClose = distance < homingRescueRange(speed);
    const isCircling = isClose && alignment < 0.15;
    const hasOverstayed = Number.isFinite(homingAge) && homingAge > 1.15;
    return isCircling || (hasOverstayed && (isClose || alignment < 0.15));
}

export function floorSafeHomingTargetY(targetY, radius) {
    const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0.35;
    const minimumY = Math.max(0.35, safeRadius);
    return Math.max(minimumY, Number.isFinite(targetY) ? targetY : minimumY);
}

export function createAimRouteOffset(origin, target, aimDirection) {
    if (!finitePoint(origin) || !finitePoint(target) || !finitePoint(aimDirection)) {
        return { x: 0, y: 0, z: 0 };
    }
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const aimLength = Math.hypot(aimDirection.x, aimDirection.z);
    const targetLength = Math.hypot(dx, dz);
    if (aimLength < 0.001 || targetLength < 0.001) return { x: 0, y: clamp(aimDirection.y * 0.75, -0.5, 0.75), z: 0 };

    const direct = { x: dx / targetLength, z: dz / targetLength };
    const aim = { x: aimDirection.x / aimLength, z: aimDirection.z / aimLength };
    const cross = direct.x * aim.z - direct.z * aim.x;
    const dot = clamp(direct.x * aim.x + direct.z * aim.z, -1, 1);
    // Broad throws own the waypoint path at 15 degrees. Between 6 and 15
    // degrees, retain the player's deliberate flick with a modest target-side
    // and rear pursuit bias instead of flattening it into a frontal line.
    // This is calculated once per player deflect, never in the frame loop.
    const subtleRoute = clamp(
        (SUBTLE_ROUTE_DOT - dot) / (SUBTLE_ROUTE_DOT - WIDE_SHOT_DOT),
        0,
        1
    );
    const side = clamp(cross * (0.85 + subtleRoute), -0.55, 0.55);
    const back = clamp((1 - dot) * 0.34 + subtleRoute * 0.2, 0, 0.48);
    return {
        x: -direct.z * side + direct.x * back,
        y: clamp(aimDirection.y * 0.75, -0.5, 0.75),
        z: direct.x * side + direct.z * back
    };
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
    const offsetX = finitePoint(projectile) ? target.x - projectile.x : 0;
    const offsetY = finitePoint(projectile) ? target.y - projectile.y : 0;
    const offsetZ = finitePoint(projectile) ? target.z - projectile.z : 0;
    const distance = Math.hypot(offsetX, offsetY, offsetZ);
    const speed = Number.isFinite(projectileSpeed) && projectileSpeed > 0 ? projectileSpeed : 1;
    if (distance < 0.001) return { x: target.x, y: target.y, z: target.z };
    // Movement perpendicular to the incoming ball needs more lead than a
    // stationary target. A target sprinting away receives a smaller extra
    // pursuit bias, which lets the ball arc in from the rear instead of making
    // an abrupt frontal pull. Velocity is already sampled and bounded before
    // this helper; the time cap keeps the intercept readable at rally speeds.
    const invDistance = 1 / distance;
    const radialSpeed = (velocity.x * offsetX + velocity.y * offsetY + velocity.z * offsetZ) * invDistance;
    const velocityLength = Math.hypot(velocity.x, velocity.y, velocity.z);
    const lateralSpeed = Math.sqrt(Math.max(0, velocityLength * velocityLength - radialSpeed * radialSpeed));
    const lateralRatio = velocityLength > 0.001 ? lateralSpeed / velocityLength : 0;
    const awayRatio = velocityLength > 0.001 ? clamp(radialSpeed / velocityLength, 0, 1) : 0;
    const leadWeight = 0.46 + lateralRatio * 0.16 + awayRatio * 0.12;
    const leadTime = clamp((distance / speed) * leadWeight, 0, 0.42);
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
    fire:      { name: 'Fireball',           price: 150, rarity: 'rare', effect: 'flame', color: 0xff3322, glow: 0xff5500, trail: 0xff6600, starColor: 0xffaa00, trailStyle: 'ember' },
    ice:       { name: 'Ice Sphere',         price: 150, rarity: 'rare', effect: 'frost', color: 0x88ccff, glow: 0xaaeeff, trail: 0xaaddff, starColor: 0xffffff, frostTrail: true, trailStyle: 'frost' },
    lightning: { name: 'Lightning Orb',      price: 150, rarity: 'rare', effect: 'spark', color: 0xffee44, glow: 0xffff88, trail: 0xffff66, starColor: 0xffffff, trailStyle: 'spark' },
    bomb:      { name: 'Bomb Ball',          price: 150, rarity: 'rare', effect: 'flame', color: 0x222222, glow: 0xff4400, trail: 0xff6600, starColor: 0xff4400, burstTrail: true, trailStyle: 'ember' },
    star:      { name: 'Star Core',          price: 150, rarity: 'rare', effect: 'spark', color: 0xffdd44, glow: 0xffffaa, trail: 0xffee88, starColor: 0xffffff, trailStyle: 'spark' },
    rainbow:   { name: 'Rainbow',            price: 150, rarity: 'rare', effect: 'prism', color: 0xff00ff, glow: 0xffffff, trail: 0xff00ff, starColor: 0xffffff, rainbow: true, trailStyle: 'prism' },
    plasma:    { name: 'Plasma Pulse',       price: 180, rarity: 'epic', effect: 'glitch', color: 0x52ddff, glow: 0x72f2ff, trail: 0x39a9ff, starColor: 0xffffff, burstTrail: true, trailStyle: 'plasma' },
    abyss:     { name: 'Abyss Core',         price: 180, rarity: 'epic', effect: 'void', color: 0x23113f, glow: 0x9c5cff, trail: 0x673ab7, starColor: 0xd7b8ff, burstTrail: true, trailStyle: 'void' },
    melon:     { name: 'Melon Pop',          price: 180, rarity: 'epic', effect: 'toxic', color: 0x55d66b, glow: 0xff6b8b, trail: 0x6ee787, starColor: 0xffd6df },
    inferno:   { name: 'Inferno Engine',      price: 220, rarity: 'rare',      effect: 'flame', color: 0x54120b, glow: 0xff5426, trail: 0xff7b28, starColor: 0xffdd71, burstTrail: true, trailStyle: 'ember' },
    frostbite: { name: 'Frostbite',           price: 220, rarity: 'rare',      effect: 'frost', color: 0x9eeeff, glow: 0xe8ffff, trail: 0x8de7ff, starColor: 0xffffff, frostTrail: true, trailStyle: 'frost' },
    voltstorm: { name: 'Voltstorm',           price: 260, rarity: 'epic',      effect: 'spark', color: 0x25345f, glow: 0xffec58, trail: 0xffd92e, starColor: 0xffffd0, trailStyle: 'spark' },
    nebula:    { name: 'Nebula Bloom',        price: 280, rarity: 'epic',      effect: 'void',  color: 0x34194f, glow: 0xd76dff, trail: 0x7f52ff, starColor: 0xffd4ff, burstTrail: true, trailStyle: 'void' },
    creeper:   { name: 'Pixel Creeper',       price: 300, rarity: 'epic',      effect: 'pixel', color: 0x2f8e45, glow: 0x84ff5c, trail: 0x56d84c, starColor: 0x182719, trailStyle: 'comet' },
    happy:     { name: 'Happy Orb',           price: 300, rarity: 'epic',      effect: 'smile', color: 0xffcf2d, glow: 0xffff92, trail: 0xffc928, starColor: 0x4d3212, trailStyle: 'spark' },
    glitch:    { name: 'Glitch Core',         price: 340, rarity: 'legendary', effect: 'glitch', color: 0x241a48, glow: 0xff49e5, trail: 0x45dfff, starColor: 0xffedff, burstTrail: true, trailStyle: 'plasma' },
    void_eye:  { name: 'Void Eye',            price: 340, rarity: 'legendary', effect: 'void',   color: 0x120a25, glow: 0x994dff, trail: 0x5d2bb6, starColor: 0xf6d0ff, burstTrail: true, trailStyle: 'void' },
    candy:     { name: 'Candy Swirl',         price: 260, rarity: 'epic',      effect: 'candy', color: 0xff4c9f, glow: 0xffe1f1, trail: 0xff78bc, starColor: 0xffffff, trailStyle: 'prism' },
    solar:     { name: 'Solar Flare',         price: 360, rarity: 'legendary', effect: 'flame',   color: 0xf06a12, glow: 0xfff0aa, trail: 0xff9d24, starColor: 0xffffff, burstTrail: true, trailStyle: 'ember' },
    toxic:     { name: 'Toxic Slime',         price: 240, rarity: 'rare',      effect: 'toxic',  color: 0x396712, glow: 0xc4ff46, trail: 0x9bdf25, starColor: 0xf2ffac, trailStyle: 'comet' },
    disco:     { name: 'Disco Cube',          price: 320, rarity: 'epic',      effect: 'prism',  color: 0x3b51db, glow: 0xffffff, trail: 0x68f6ff, starColor: 0xfff35a, rainbow: true, trailStyle: 'prism' },
    magma:     { name: 'Magma Planet',        price: 380, rarity: 'legendary', effect: 'flame',  color: 0x3a0903, glow: 0xffb21f, trail: 0xff4d13, starColor: 0xfff0a8, burstTrail: true, trailStyle: 'ember' },
    ocean:     { name: 'Ocean Heart',         price: 300, rarity: 'epic',      effect: 'frost',  color: 0x075985, glow: 0x67e8f9, trail: 0x38bdf8, starColor: 0xe0faff, frostTrail: true, trailStyle: 'frost' },
    honey:     { name: 'Honey Hive',          price: 280, rarity: 'epic',      effect: 'pixel',  color: 0xf5b82e, glow: 0xfff078, trail: 0xe89619, starColor: 0x3b2605, trailStyle: 'comet' },
    dragon:    { name: 'Dragon Eye',          price: 420, rarity: 'legendary', effect: 'void',   color: 0x4a0808, glow: 0xff4b28, trail: 0x8b1020, starColor: 0xffd46a, burstTrail: true, trailStyle: 'void' },
    portal:    { name: 'Portal Core',         price: 400, rarity: 'legendary', effect: 'glitch', color: 0x14285b, glow: 0x4bf4ff, trail: 0xff58d8, starColor: 0xffffff, rainbow: true, trailStyle: 'plasma' },
    moon:      { name: 'Moon Dust',           price: 260, rarity: 'rare',      effect: 'spark',  color: 0x8b93a7, glow: 0xf4f7ff, trail: 0xc6d0e5, starColor: 0xffffff, trailStyle: 'spark' },
    pumpkin:   { name: 'Grinning Pumpkin',   price: 300, rarity: 'epic',      effect: 'smile',  color: 0xd85d0b, glow: 0xffbd3d, trail: 0xf57c18, starColor: 0x291208, trailStyle: 'ember' },
    matrix:    { name: 'Matrix Code',         price: 340, rarity: 'epic',      effect: 'pixel',  color: 0x071d0e, glow: 0x55ff7c, trail: 0x1fca59, starColor: 0xd3ffdb, burstTrail: true, trailStyle: 'comet' },
    sakura:    { name: 'Sakura Spirit',       price: 320, rarity: 'epic',      effect: 'candy',  color: 0xff8fbd, glow: 0xffe3ef, trail: 0xffafd0, starColor: 0xffffff, trailStyle: 'prism' },
    blackhole: { name: 'Event Horizon',       price: 460, rarity: 'legendary', effect: 'void',   color: 0x030207, glow: 0x8f5cff, trail: 0x311766, starColor: 0xe9d7ff, burstTrail: true, trailStyle: 'void' },

    // ponytail: .io shop expansion — 12 new skins (5 rare / 4 epic / 3 legendary).
    // Cosmetic-only: color/glow/trail/effect fields the renderer already reads.
    // Legendary entries reuse the existing burstTrail + trailStyle hook (see
    // _emitTrail/addTrailDot) for a denser afterimage — no new update loop added.
    copper:         { name: 'Copper Core',      price: 200, rarity: 'rare',      effect: 'pixel', color: 0xb87333, glow: 0xffcd94, trail: 0xd9925b, starColor: 0xfff3e0, trailStyle: 'comet' },
    blizzard:       { name: 'Blizzard Shard',   price: 230, rarity: 'rare',      effect: 'frost', color: 0xcfefff, glow: 0xffffff, trail: 0xa8e6ff, starColor: 0xffffff, frostTrail: true, trailStyle: 'frost' },
    ember_wisp:     { name: 'Ember Wisp',       price: 210, rarity: 'rare',      effect: 'flame', color: 0xff6a3d, glow: 0xffcf8a, trail: 0xff8f4d, starColor: 0xffe9b0, trailStyle: 'ember' },
    neon_dash:      { name: 'Neon Dash',        price: 240, rarity: 'rare',      effect: 'spark', color: 0x39ff88, glow: 0xaaffdd, trail: 0x39ffea, starColor: 0xffffff, trailStyle: 'spark' },
    bubblegum:      { name: 'Bubblegum Pop',    price: 220, rarity: 'rare',      effect: 'candy', color: 0xff6ec7, glow: 0xffd6f2, trail: 0xff9adb, starColor: 0xffffff, trailStyle: 'prism' },
    cobalt_storm:   { name: 'Cobalt Storm',     price: 300, rarity: 'epic',      effect: 'spark', color: 0x123a7a, glow: 0x5ec8ff, trail: 0x2f6fd6, starColor: 0xcfe8ff, burstTrail: true, trailStyle: 'spark' },
    venom:          { name: 'Venom Vial',       price: 310, rarity: 'epic',      effect: 'toxic', color: 0x1f3d17, glow: 0xa6ff3d, trail: 0x5ea62b, starColor: 0xddffb0, trailStyle: 'comet' },
    circuit:        { name: 'Circuit Break',    price: 340, rarity: 'epic',      effect: 'glitch', color: 0x0a140d, glow: 0x39ff6a, trail: 0x1fca59, starColor: 0xd3ffdb, burstTrail: true, trailStyle: 'plasma' },
    aurora:         { name: 'Aurora Veil',      price: 290, rarity: 'epic',      effect: 'frost', color: 0x0f3d3a, glow: 0x7dffe0, trail: 0x4fd8c7, starColor: 0xd9fff5, frostTrail: true, trailStyle: 'frost' },
    phoenix:        { name: 'Phoenix Rebirth',  price: 430, rarity: 'legendary', effect: 'flame', color: 0x5c0b0b, glow: 0xffb020, trail: 0xff5a1f, starColor: 0xffe08a, burstTrail: true, trailStyle: 'ember' },
    cosmic_serpent: { name: 'Cosmic Serpent',   price: 450, rarity: 'legendary', effect: 'void', color: 0x140430, glow: 0xb35cff, trail: 0x6b21c9, starColor: 0xe6ccff, burstTrail: true, trailStyle: 'void' },
    prism_king:     { name: 'Prism King',       price: 480, rarity: 'legendary', effect: 'prism', color: 0xffffff, glow: 0xffffff, trail: 0xffffff, starColor: 0xffffff, rainbow: true, burstTrail: true, trailStyle: 'prism' },

    // ponytail: NewSkins pass — 6 more purchasable skins reusing the existing
    // flame/void/glitch/frost effect families (shader-finishers.js already
    // covers all four). 2 rare (cheap), 2 epic (mid), 2 legendary (expensive).
    emberfall:      { name: 'Emberfall',        price: 210, rarity: 'rare',      effect: 'flame',  color: 0x6b1907, glow: 0xff7a33, trail: 0xff9a44, starColor: 0xffe3ad, trailStyle: 'ember' },
    glacies:        { name: 'Glacies Wraith',   price: 230, rarity: 'rare',      effect: 'frost',  color: 0x18354a, glow: 0xbfefff, trail: 0x8fd9ff, starColor: 0xffffff, frostTrail: true, trailStyle: 'frost' },
    binary_ghost:   { name: 'Binary Ghost',     price: 310, rarity: 'epic',      effect: 'glitch', color: 0x0c1220, glow: 0x7dfcff, trail: 0x35e0ff, starColor: 0xffffff, burstTrail: true, trailStyle: 'plasma' },
    event_null:     { name: 'Event Null',       price: 320, rarity: 'epic',      effect: 'void',   color: 0x1b0930, glow: 0xb46bff, trail: 0x7a3fd6, starColor: 0xe8cbff, burstTrail: true, trailStyle: 'void' },
    wildfire_phantom: { name: 'Wildfire Phantom', price: 440, rarity: 'legendary', effect: 'flame', color: 0x2a0502, glow: 0xffae3d, trail: 0xff5a1a, starColor: 0xfff0c2, burstTrail: true, trailStyle: 'ember' },
    oblivion_shard: { name: 'Oblivion Shard',   price: 470, rarity: 'legendary', effect: 'void',   color: 0x05010a, glow: 0xa15cff, trail: 0x4d1f99, starColor: 0xd9baff, burstTrail: true, trailStyle: 'void' },

    // ponytail: model skins — the only skins that carry a `shape`. Everything else
    // (radius, collisions, homing, steering) is identical to a sphere skin; `shape`
    // is read exactly once, by Ball._applyShape(), and never by the physics step.
    shuriken:       { name: 'Iron Shuriken',    price: 280, rarity: 'epic',      effect: 'spark',  color: 0x9aa7b4, glow: 0xdfe9f5, trail: 0xbcd0e2, starColor: 0xffffff, shape: 'shuriken', trailStyle: 'spark' },
    baseball:       { name: 'Sandlot Slugger',  price: 240, rarity: 'rare',      effect: 'spark',  color: 0xf3ece0, glow: 0xfff6e6, trail: 0xffd9cc, starColor: 0xd23a3a, shape: 'baseball', trailStyle: 'comet' },
    blockball:      { name: 'Blockball',        price: 260, rarity: 'epic',      effect: 'glitch', color: 0x3f8f4d, glow: 0x9dff6b, trail: 0x63d15c, starColor: 0xf2ffe0, shape: 'cube', trailStyle: 'comet' },
    dark_eater:     { name: 'Dark Eater',       price: 500, rarity: 'legendary', effect: 'void',   color: 0x0b0416, glow: 0x9a3dff, trail: 0x5a17b8, starColor: 0xe6ccff, shape: 'orb', burstTrail: true, trailStyle: 'void' }
};

export const TRAIL_STYLE_PROFILES = Object.freeze({
    comet: Object.freeze({ geometry: 'orb', x: 1, y: 1, z: 1 }),
    ember: Object.freeze({ geometry: 'shard', x: 0.72, y: 0.72, z: 1.55 }),
    frost: Object.freeze({ geometry: 'crystal', x: 0.82, y: 1.28, z: 0.82 }),
    spark: Object.freeze({ geometry: 'pixel', x: 0.72, y: 0.72, z: 0.72 }),
    plasma: Object.freeze({ geometry: 'pixel', x: 0.88, y: 0.88, z: 0.88 }),
    prism: Object.freeze({ geometry: 'crystal', x: 0.92, y: 1.22, z: 0.92 }),
    void: Object.freeze({ geometry: 'crystal', x: 1.05, y: 1.05, z: 1.05 })
});

let sharedTrailGeometries = null;

function getSharedTrailGeometries() {
    if (!sharedTrailGeometries) {
        sharedTrailGeometries = Object.freeze({
            orb: new THREE.SphereGeometry(1, 4, 4),
            shard: new THREE.TetrahedronGeometry(1, 0),
            crystal: new THREE.OctahedronGeometry(1, 0),
            pixel: new THREE.BoxGeometry(1.35, 1.35, 1.35)
        });
    }
    return sharedTrailGeometries;
}

// ---------------------------------------------------------------------------
// Model skins — VISUAL ONLY.
// Physics reads this.radius / this.position and never touches the mesh, so every
// shape below collides, homes and steers exactly like the default sphere. The
// geometry for a shape is built once per (shape, radius) and shared by every ball
// that equips it; nothing here allocates per frame.
// ---------------------------------------------------------------------------

export const BALL_SHAPES = Object.freeze(['sphere', 'shuriken', 'baseball', 'cube', 'orb']);

// Visual-only spin (radians/second) applied to the shape group. 0 / missing = static.
export const SHAPE_SPIN = Object.freeze({ shuriken: 9, orb: 1.1 });

const shapeGeoCache = new Map();

function buildShapeParts(shape, r, THREE) {
    if (shape === 'shuriken') {
        const star = new THREE.Shape();
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            // Outer point stays inside the 0.47 collision radius (visualRadius is 0.43), so the
            // star never looks bigger than the sphere it actually hits with.
            const radius = i % 2 ? r * 0.44 : r * 1.02;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) star.moveTo(x, y); else star.lineTo(x, y);
        }
        star.closePath();
        const hole = new THREE.Path();
        hole.absarc(0, 0, r * 0.2, 0, Math.PI * 2, true);
        star.holes.push(hole);
        const blade = new THREE.ExtrudeGeometry(star, {
            depth: r * 0.16, bevelEnabled: true, bevelSize: r * 0.05, bevelThickness: r * 0.04, bevelSegments: 1
        });
        blade.translate(0, 0, -r * 0.08);
        blade.rotateX(-Math.PI / 2);   // lie flat so SHAPE_SPIN's Y spin reads as a thrown star
        const hub = new THREE.TorusGeometry(r * 0.28, r * 0.065, 6, 14);
        hub.rotateX(Math.PI / 2);
        return [{ geo: blade, tint: 'body', outline: 1.05 }, { geo: hub, tint: 'accent' }];
    }
    if (shape === 'baseball') {
        const parts = [{ geo: new THREE.SphereGeometry(r, 20, 20), tint: 'body', outline: 1.1 }];
        for (const side of [-1, 1]) {
            // sqrt(0.6^2 + 0.8^2) === 1, so each arc rides exactly on the ball surface.
            const seam = new THREE.TorusGeometry(r * 0.8, r * 0.042, 5, 20, Math.PI * 1.25);
            seam.rotateZ(-Math.PI * 0.62);
            seam.rotateY(Math.PI / 2);
            seam.translate(side * r * 0.6, 0, 0);
            parts.push({ geo: seam, tint: 'accent' });
        }
        return parts;
    }
    if (shape === 'cube') {
        const body = new THREE.BoxGeometry(r * 1.86, r * 1.86, r * 1.86);
        const band = new THREE.BoxGeometry(r * 1.9, r * 0.54, r * 0.54);
        return [{ geo: body, tint: 'body', outline: 1.08 }, { geo: band, tint: 'accent' }];
    }
    if (shape === 'orb') {
        const core = new THREE.IcosahedronGeometry(r * 0.96, 1);
        const parts = [{ geo: core, tint: 'body', outline: 1.12 }];
        for (const tilt of [0, 0.95]) {
            const ring = new THREE.TorusGeometry(r * 1.03, r * 0.045, 6, 24);
            ring.rotateX(Math.PI / 2);
            ring.rotateZ(tilt);
            parts.push({ geo: ring, tint: 'accent' });
        }
        return parts;
    }
    return [];
}

// Shared, lazily built geometry for one shape. Never disposed — a handful of small
// buffers reused by every ball for the whole session.
export function ballShapeParts(shape, radius, THREE) {
    const key = `${shape}:${radius}`;
    let parts = shapeGeoCache.get(key);
    if (!parts) {
        parts = buildShapeParts(shape, radius, THREE);
        shapeGeoCache.set(key, parts);
    }
    return parts;
}

// ---------------------------------------------------------------------------
// Expressive-depth layer: charged throw, strafe curve, rally heat.
// Kept pure and exported so every tuning curve is unit-testable and can be
// retuned without touching the class or the steering math.
// ---------------------------------------------------------------------------

export const CHARGE_FULL_SECONDS = 0.6;
export const CHARGE_OVERCHARGE_SECONDS = 1.05;
export const CHARGE_RATE = 1 / CHARGE_FULL_SECONDS;
export const CHARGE_MAX_POWER = 1.8;
export const CHARGE_OVERCHARGE_POWER = 1.55;
export const CHARGE_FULL_SPREAD = 0.06;
export const CHARGE_MAX_SPREAD = 0.2;
export const CHARGE_MIN_MOVEMENT = 0.62;

const NEUTRAL_CHARGE = Object.freeze({ power: 1, spread: 0, movementScale: 1, overcharged: false, ratio: 0 });

export function chargeProfile(heldSeconds) {
    if (!Number.isFinite(heldSeconds) || heldSeconds <= 0) return { ...NEUTRAL_CHARGE };
    const held = Math.min(heldSeconds, CHARGE_OVERCHARGE_SECONDS);
    const ratio = clamp(held / CHARGE_FULL_SECONDS, 0, 1);
    const ramp = 1 - (1 - ratio) * (1 - ratio);
    if (held <= CHARGE_FULL_SECONDS) {
        return {
            power: 1 + (CHARGE_MAX_POWER - 1) * ramp,
            spread: CHARGE_FULL_SPREAD * ramp,
            movementScale: 1 - (1 - CHARGE_MIN_MOVEMENT) * ramp,
            overcharged: false,
            ratio
        };
    }
    const over = clamp((held - CHARGE_FULL_SECONDS) / (CHARGE_OVERCHARGE_SECONDS - CHARGE_FULL_SECONDS), 0, 1);
    return {
        power: CHARGE_MAX_POWER + (CHARGE_OVERCHARGE_POWER - CHARGE_MAX_POWER) * over,
        spread: CHARGE_FULL_SPREAD + (CHARGE_MAX_SPREAD - CHARGE_FULL_SPREAD) * over,
        movementScale: CHARGE_MIN_MOVEMENT,
        overcharged: over > 0,
        ratio: 1
    };
}

export const SPIN_STRAFE_THRESHOLD = 0.6;
export const SPIN_STRAFE_GAIN = 0.42;
export const SPIN_MAX = 3;
export const SPIN_MAGNUS_COEFF = 0.34;
export const SPIN_DECAY_PER_SECOND = 1.1;
export const SPIN_EPSILON = 0.001;
export const DEFLECT_SPIN_SCALE = Object.freeze({ normal: 0.45, great: 0.75, perfect: 1 });

export function spinFromStrafe(strafeVelocity, forward, tier = 'normal') {
    if (!finitePoint(strafeVelocity) || !finitePoint(forward)) return 0;
    const forwardLength = Math.hypot(forward.x, forward.z);
    if (forwardLength < SPIN_EPSILON) return 0;
    const fx = forward.x / forwardLength;
    const fz = forward.z / forwardLength;
    const lateral = strafeVelocity.x * fz - strafeVelocity.z * fx;
    if (Math.abs(lateral) < SPIN_STRAFE_THRESHOLD) return 0;
    const scale = Number.isFinite(DEFLECT_SPIN_SCALE[tier]) ? DEFLECT_SPIN_SCALE[tier] : DEFLECT_SPIN_SCALE.normal;
    const magnitude = Math.min(SPIN_MAX, (Math.abs(lateral) - SPIN_STRAFE_THRESHOLD) * SPIN_STRAFE_GAIN * scale);
    return magnitude <= 0 ? 0 : Math.sign(lateral) * magnitude;
}

export function spinLateralAcceleration(spin, velocity, dt) {
    if (!Number.isFinite(spin) || spin === 0 || !finitePoint(velocity) || !Number.isFinite(dt) || dt <= 0) {
        return { x: 0, y: 0, z: 0 };
    }
    const horizontal = Math.hypot(velocity.x, velocity.z);
    if (horizontal < SPIN_EPSILON) return { x: 0, y: 0, z: 0 };
    const nx = velocity.x / horizontal;
    const nz = velocity.z / horizontal;
    const strength = SPIN_MAGNUS_COEFF * spin * horizontal * dt;
    return { x: -nz * strength, y: 0, z: nx * strength };
}

export function decaySpin(spin, dt) {
    if (!Number.isFinite(spin) || spin === 0) return 0;
    if (!Number.isFinite(dt) || dt <= 0) return spin;
    const decayed = spin * Math.exp(-SPIN_DECAY_PER_SECOND * dt);
    return Math.abs(decayed) < SPIN_EPSILON ? 0 : decayed;
}

export const BALL_BASE_SPEED = 17;

export const BALL_HEAT_TIERS = Object.freeze([
    Object.freeze({ id: 'cool', index: 0, minRatio: 1, color: 0xffe08a }),
    Object.freeze({ id: 'warm', index: 1, minRatio: 1.5, color: 0xffd447 }),
    Object.freeze({ id: 'hot', index: 2, minRatio: 2.25, color: 0xff4d35 }),
    Object.freeze({ id: 'blazing', index: 3, minRatio: 3.5, color: 0xfff4dc }),
    Object.freeze({ id: 'overdrive', index: 4, minRatio: 5, color: 0xbfe9ff })
]);

export function ballHeatLevel(speed, baseSpeed = BALL_BASE_SPEED) {
    const base = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : BALL_BASE_SPEED;
    const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0;
    const ratio = safeSpeed / base;
    let index = 0;
    for (let i = BALL_HEAT_TIERS.length - 1; i > 0; i--) {
        if (ratio >= BALL_HEAT_TIERS[i].minRatio) { index = i; break; }
    }
    const tier = BALL_HEAT_TIERS[index];
    const next = BALL_HEAT_TIERS[index + 1];
    const span = next ? next.minRatio - tier.minRatio : 0;
    const progress = span > 0 ? clamp((ratio - tier.minRatio) / span, 0, 1) : (next ? 0 : 1);
    return {
        tier: tier.id,
        index,
        color: tier.color,
        intensity: clamp((ratio - 1) / 3, 0, 1),
        progress,
        ratio
    };
}

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
        // Rally speed is intentionally uncapped: each successful return raises
        // the reaction/skill check. Protocol validation remains bounded.
        this.maxRallyMultiplier = Infinity;
        this.maxSpeed = Infinity;
        this.deflections = 0;
        this.radius = 0.47;
        this._baseRadius = this.radius;
        this.visualRadius = 0.43;
        this.attackRange = 2.0;
        this.catchRange = 2.0;
        this.hitRange = 0.7;
        this.active = false;
        this.targetPlayer = null;
        this.state = 'idle';
        this.skinId = 'classic';
        this.skinConfig = BALL_SKINS.classic;
        this._skinHeatColor = new THREE.Color(0xffffff);

        this.trail = [];
        this.trailTimer = 0;
        this._trailLastPosition = new THREE.Vector3();
        this._trailSamplePosition = new THREE.Vector3();
        this._trailHasLastPosition = false;
        this._trailGeometries = getSharedTrailGeometries();
        this._trailPool = new ObjectPool(
            () => new THREE.Mesh(this._trailGeometries.orb, new THREE.MeshBasicMaterial({ transparent: true })),
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
        this._perfectWindowTarget = null;

        // Charge-up throw — hold to charge, release for power throw.
        this.chargeLevel = 0;         // 0..1
        this.isCharging = false;
        this.chargeHeld = 0;          // 0..CHARGE_OVERCHARGE_SECONDS, accumulates
        this.curveSpin = 0;           // physics-only spin from strafe during deflect

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
        const geo = new THREE.SphereGeometry(this.visualRadius, 20, 20);
        this.mat = this.renderer.createToonMaterial(0xff8844);
        this.mesh = new THREE.Mesh(geo, this.mat);
        this.mesh.castShadow = true;

        const outline = this.renderer.createOutlineMesh(geo, 1.1);
        this.mesh.add(outline);

        // Model-skin container. Empty for sphere skins; _applyShape() fills and
        // toggles it, and hides the sphere visuals (material + outline + stars) below.
        this.shapeGroup = new THREE.Group();
        this.mesh.add(this.shapeGroup);
        this._shapeGroups = new Map();
        this._shape = 'sphere';
        this._shapeSpin = 0;
        // Shares this.mat's uColor uniform object, so updateColor()/rainbow keep
        // driving the model skins with zero extra code.
        this._shapeMat = this.renderer.createToonMaterial(0xff8844);
        this._shapeMat.uniforms.uColor = this.mat.uniforms.uColor;

        // Star pattern (skin'den renk alır)
        this.starGeo = new THREE.CircleGeometry(0.12, 5);
        this.starMat = new THREE.MeshBasicMaterial({ color: 0xffee44, side: THREE.DoubleSide });
        this.star = new THREE.Mesh(this.starGeo, this.starMat);
        this.star.position.z = this.visualRadius + 0.01;
        this.mesh.add(this.star);
        this.star2 = this.star.clone();
        this.star2.position.z = -(this.visualRadius + 0.01);
        this.star2.rotation.y = Math.PI;
        this.mesh.add(this.star2);
        this._sphereParts = [outline, this.star, this.star2];

        // Glow — small, doesn't bleed through walls
        const glowGeo = new THREE.SphereGeometry(this.visualRadius * 1.15, 16, 16);
        this.glowMat = new THREE.MeshBasicMaterial({
            color: 0xff8844, transparent: true, opacity: 0.06, depthWrite: true, depthTest: true
        });
        this.glow = new THREE.Mesh(glowGeo, this.glowMat);
        this.mesh.add(this.glow);

        this.heatMat = new THREE.MeshBasicMaterial({
            color: 0xffd447,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true
        });
        this.heatShell = new THREE.Mesh(glowGeo, this.heatMat);
        this.heatShell.scale.setScalar(1.08);
        this.mesh.add(this.heatShell);

        this.mesh.visible = false;
        this.scene.add(this.mesh);
    }

    // Skin değiştir — store'dan equippedBall ile eşle.
    setSkin(skinId) {
        const resolvedId = Object.hasOwn(BALL_SKINS, skinId) ? skinId : 'classic';
        const skin = BALL_SKINS[resolvedId];
        this.skinId = resolvedId;
        this.starMat.color.setHex(skin.starColor);
        this.skinConfig = skin;
        this._applyShape(skin.shape || 'sphere');
        this.clearTrail();
        this.updateColor();
        return resolvedId;
    }

    // Swap the VISUAL mesh only. this.radius / this.visualRadius / every physics field
    // is untouched, so a shuriken collides and homes exactly like the classic sphere.
    _applyShape(shape) {
        const next = BALL_SHAPES.includes(shape) ? shape : 'sphere';
        if (next === this._shape) return;
        this._shape = next;
        this._shapeSpin = SHAPE_SPIN[next] || 0;
        const custom = next !== 'sphere';
        this.mat.visible = !custom;
        for (const part of this._sphereParts) part.visible = !custom;
        for (const [id, group] of this._shapeGroups) group.visible = custom && id === next;
        if (!custom) return;
        let group = this._shapeGroups.get(next);
        if (!group) {
            group = new THREE.Group();
            for (const part of ballShapeParts(next, this.visualRadius, THREE)) {
                const material = part.tint === 'accent' ? this.starMat : this._shapeMat;
                const mesh = new THREE.Mesh(part.geo, material);
                if (part.outline) mesh.add(this.renderer.createOutlineMesh(part.geo, part.outline));
                group.add(mesh);
            }
            this._shapeGroups.set(next, group);
            this.shapeGroup.add(group);
        }
        group.visible = true;
        this.shapeGroup.rotation.set(0, 0, 0);
    }

    spawn() {
        const sp = this.arena.getSpawnPoint();
        this.position.copy(sp);
        this.velocity.set(0, -2, 0);
        this.currentSpeed = this.baseSpeed * (this.skinConfig?.speedBonus || 1) * (this._ffaSpeedMultiplier || 1);
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
        this._perfectWindowTarget = null;
        this.chargeLevel = 0;
        this.isCharging = false;
        this.chargeHeld = 0;
        this.curveSpin = 0;
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
        // Model-skin spin: visual only, runs on host and client alike. Physics never
        // reads mesh rotation, so this cannot influence steering/collision.
        if (this._shapeSpin && dt > 0) this.shapeGroup.rotation.y += this._shapeSpin * dt;
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
                        desired = targetDir.clone().lerp(velDir, 0.22).normalize();
                    } else if (dist < 3) {
                        // Close: moderate blend — direct but not instant
                        desired = targetDir.clone().lerp(velDir, 0.18).normalize();
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
                    const alignment = velDir.dot(targetDir);
                    const directRescue = shouldDirectHomingRescue(
                        dist, this.currentSpeed, this._homingAge, alignment
                    );
                    // ponytail: ordinary homing stays soft. A proven orbit/overstay
                    // gets a terminal heading so rally speed can keep rising safely.
                    const steer = 1 - Math.exp(
                        -proximityHomingTurnRate(dist, this._homingAge) * speedFactor * dt
                    );
                    const newDir = directRescue
                        ? targetDir
                        : velDir.lerp(desired, steer).normalize();
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
                        desired = targetDir.clone().lerp(velDir, 0.22).normalize();
                    } else if (dist < 3) {
                        desired = targetDir.clone().lerp(velDir, 0.18).normalize();
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
                    // ponytail: orbit kurtarma. Bu dalda (_updatePlayerSteering'in aksine)
                    // hic yoktu: donus yaricapi (hiz / donus hizi) force-hit menzilinden
                    // buyuk oldugunda top hedefe kapanamayip etrafinda sonsuz doniyordu.
                    // Ayni esikler _updatePlayerSteering'deki kurtarma ile birebir.
                    const alignment = velDir.dot(targetDir);
                    const rescueRange = homingRescueRange(this.currentSpeed);
                    const isCircling = dist < rescueRange && alignment < 0.15;
                    const hasOverstayed = this._homingAge > 1.15;
                    const rescuing = hasOverstayed || isCircling;
                    const directRescue = shouldDirectHomingRescue(
                        dist, this.currentSpeed, this._homingAge, alignment
                    );
                    if (rescuing) this._targetRouteOffset = { x: 0, y: 0, z: 0 };
                    const steer = Math.max(
                        1 - Math.exp(-proximityHomingTurnRate(dist, this._homingAge) * speedFactor * dt),
                        rescuing ? 1 - Math.exp(-7 * dt) : 0
                    );
                    const newDir = directRescue
                        ? targetDir
                        : velDir.lerp(rescuing ? targetDir : desired, steer).normalize();
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

            // Magnus effect from strafe curve spin: additive lateral velocity
            // based on ball speed and spin direction. Only active in rally.
            if (Math.abs(this.curveSpin) > SPIN_EPSILON) {
                const magnus = spinLateralAcceleration(this.curveSpin, this.velocity, dt);
                this.velocity.x += magnus.x;
                this.velocity.z += magnus.z;
                this.curveSpin = decaySpin(this.curveSpin, dt);
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
            const toTarget = new THREE.Vector3().subVectors(tPos, this.position);
            const approachDot = this.velocity.lengthSq() > 0.001 && toTarget.lengthSq() > 0.001
                ? this.velocity.clone().normalize().dot(toTarget.normalize())
                : 0;
            // Wider proximity range for fast balls — prevents orbiting at high speed
            const effectiveProxRange = this._proximityRange + Math.min(this.currentSpeed * 0.002, 1.5);
            if (proxDist < effectiveProxRange && proxDist > this.hitRange) {
                this._proximityTimer += dt;
                // Faster trigger at high speed — 0.2s instead of 0.4s
                const threshold = clamp(0.42 - this.currentSpeed * 0.0024, 0.18, 0.38);
                if (this._proximityTimer >= threshold && approachDot > -0.15) {
                    this._forceHit = true;
                    this._proximityTimer = 0;
                }
            } else if (proxDist <= this.hitRange && this.currentSpeed > 80 && approachDot > -0.15) {
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
                this.currentSpeed *= 1 + 0.05 * dt;
                if (!Number.isFinite(this.currentSpeed)) this.currentSpeed = this.baseSpeed;
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
            if (dist < this.perfectRange && dist > this.hitRange
                && this._perfectWindowTarget !== this.targetPlayer) {
                this.perfectWindow = this.perfectWindowDuration;
                this._perfectWindowTarget = this.targetPlayer;
            }
        }
        if (this.perfectWindow > 0) this.perfectWindow = Math.max(0, this.perfectWindow - dt);

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
        this._updateHeatVisual();

        // Trail — denser when moving fast for a smooth comet streak.
        this._emitTrail(dt);
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

    _getTargetPos(includeRouteOffset = true) {
        if (!this.targetPlayer) return this.position.clone();
        const base = typeof this.targetPlayer.getPosition === 'function'
            ? this.targetPlayer.getPosition()
            : this.targetPlayer.position.clone();
        const basePos = base.clone();
        // Target the torso center (whole body), not a random zone — stable homing point.
        const usesGroundPosition = this.targetPlayer.group?.position
            && this.targetPlayer.position
            && Math.abs(this.targetPlayer.group.position.y - this.targetPlayer.position.y) < 0.05;
        if (usesGroundPosition) basePos.y += 0.65;
        const zone = Ball.BODY_ZONES[this.bodyZone] || Ball.BODY_ZONES.chest;
        basePos.y = floorSafeHomingTargetY(basePos.y + zone.y, this.radius);
        if (includeRouteOffset && this._targetRouteOffset) {
            basePos.x += this._targetRouteOffset.x;
            basePos.y += this._targetRouteOffset.y;
            basePos.z += this._targetRouteOffset.z;
        }
        // A downward aim offset must never put the pursuit point below the
        // physical ball floor. Otherwise floor recovery steers down again and
        // can form a stable horizontal orbit at high rally speed.
        basePos.y = floorSafeHomingTargetY(basePos.y, this.radius);
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
        this._targetRouteOffset = { x: 0, y: 0, z: 0 };
        this._homingAge = 0;
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
        this._targetRouteOffset = createAimRouteOffset(this.position, targetPos, aimDirection);
        targetPos.copy(this._getTargetPos());
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
        if (this._steeringPhase === 'waypoint'
            && hasCrossedTargetPlane(this.position, targetPos, this._steeringPlaneNormal)) {
            this._steeringPhase = 'torso';
            this._steeringWaypoint = null;
            this._steeringPlaneNormal = null;
            this._targetRouteOffset = { x: 0, y: 0, z: 0 };
            targetPos = this._getTargetPos(false);
        }
        const sampledVelocity = sampleBoundedVelocity(this._steeringTargetSample, targetPos, dt);
        const filteredVelocity = smoothSampledVelocity(this._steeringTargetVelocity, sampledVelocity, dt);
        this._steeringTargetVelocity = filteredVelocity;
        this._steeringTargetSample.copy(targetPos);
        if (steeringDt <= 0) return 0;

        const target = this._steeringPhase === 'waypoint'
            ? this._steeringWaypoint
            : predictLeadTarget(targetPos, this._steeringTargetVelocity, this.position, this.currentSpeed);
        const desired = new THREE.Vector3(target.x, target.y, target.z).sub(this.position);
        const targetDistance = desired.length();
        if (targetDistance < 0.001) return steeringDt;
        desired.normalize();
        const velocityLength = this.velocity.length();
        const current = velocityLength > 0.001
            ? this.velocity.clone().multiplyScalar(1 / velocityLength)
            : this._steeringInitialDir.clone();
        const torsoPos = this._getTargetPos(false);
        const toTorso = new THREE.Vector3().subVectors(torsoPos, this.position);
        const torsoDistance = toTorso.length();
        const torsoDirection = torsoDistance > 0.001 ? toTorso.normalize() : desired;
        const hasOverstayed = this._steeringAge > 1.15;
        const alignment = current.dot(torsoDirection);
        const rescueRange = homingRescueRange(this.currentSpeed);
        const isCircling = torsoDistance < rescueRange && alignment < 0.15;
        const directRescue = shouldDirectHomingRescue(
            torsoDistance, this.currentSpeed, this._steeringAge, alignment
        );
        if (hasOverstayed || isCircling) {
            this._steeringPhase = 'torso';
            this._steeringWaypoint = null;
            this._steeringPlaneNormal = null;
            this._targetRouteOffset = { x: 0, y: 0, z: 0 };
        }
        const direct = hasOverstayed || isCircling
            ? torsoDirection
            : desired;
        const proximityTurn = 1 - Math.exp(
            -proximityHomingTurnRate(torsoDistance, this._steeringAge) * steeringDt
        );
        const rescueTurn = hasOverstayed || isCircling
            ? 1 - Math.exp(-7 * steeringDt)
            : 0;
        const turn = Math.max(
            steeringTurnAlpha(steeringDt, this.deflections),
            proximityTurn,
            rescueTurn
        );
        const next = directRescue ? torsoDirection : current.lerp(direct, turn);
        if (finitePoint(next) && next.lengthSq() > 0.000001) {
            this.velocity.copy(next.normalize().multiplyScalar(this.currentSpeed));
        }
        return steeringDt;
    }

    _clampSpeed() {
        if (!Number.isFinite(this.currentSpeed)) this.currentSpeed = this.baseSpeed;
        this.currentSpeed = Math.max(0, this.currentSpeed);
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
        const deflections = Number.isFinite(this.deflections) ? Math.max(0, this.deflections) : 0;
        const step = Number.isFinite(this.rallySpeedStep) ? Math.max(0, this.rallySpeedStep) : 0;
        const multiplier = 1 + deflections * step;
        return Number.isFinite(multiplier) ? multiplier : 1;
    }

    getRallySpeed() {
        return this.baseSpeed * this.getRallyMultiplier() * (this.skinConfig?.speedBonus || 1);
    }

    _updateHeatVisual() {
        const heat = ballHeatLevel(this.currentSpeed, this.baseSpeed);
        this.heatMat.color.setHex(heat.color);
        this.heatMat.opacity = heat.intensity * 0.3;
        this.heatShell.scale.setScalar(1.08 + heat.intensity * 0.16);
    }

    updateColor() {
        const sr = this.currentSpeed / this.baseSpeed;
        // Cosmetic base color stays authoritative; speed contributes heat only.
        const skin = this.skinConfig || BALL_SKINS.classic;
        // Preserve the equipped skin through spawn/deflect updates. Long
        // rallies still read hotter by blending toward white instead of
        // replacing every cosmetic with the old hard-coded orange/red ramp.
        const heatBlend = Math.min(0.42, Math.max(0, sr - 1) * 0.08);
        this.mat.uniforms.uColor.value.setHex(skin.color).lerp(this._skinHeatColor, heatBlend);
        this.glowMat.color
            .setHex(this._affixGlowColor ?? skin.glow)
            .lerp(this._skinHeatColor, heatBlend * 0.6);
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
            // Keep the 1.2x spike payoff without compounding the previous spike
            // velocity. The uncapped rally ramp remains linear per deflection.
            speed = this.getRallySpeed() * 1.2 * powerBonus;
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

        this.curveSpin = 0;
        if (momentum && Math.hypot(momentum.x, momentum.z) > SPIN_STRAFE_THRESHOLD) {
            const forward = { x: aimDir.x, y: 0, z: aimDir.z };
            this.curveSpin = spinFromStrafe(momentum, forward, 'normal');
        }

        this.currentSpeed = speed;
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
        this.currentSpeed = this.getRallySpeed();
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
        this.curveSpin = 0;
    }

    setTarget(target) {
        if (this.targetPlayer !== target) {
            this._resetSteering();
            this.perfectWindow = 0;
            this._perfectWindowTarget = null;
        }
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
    getPerfectTimingErrorMs() {
        return this.perfectWindow > 0 ? this.perfectWindow * 1000 : Infinity;
    }
    startCharge() { this.isCharging = true; this.chargeLevel = 0; this.chargeHeld = 0; }
    tickCharge(dt) {
        if (this.isCharging) {
            this.chargeHeld += dt;
            this.chargeLevel = Math.min(1, this.chargeHeld * CHARGE_RATE);
        }
    }
    stopCharge() {
        const l = this.chargeLevel;
        this.isCharging = false;
        this.chargeLevel = 0;
        this.chargeHeld = 0;
        return l;
    }
    getChargeLevel() { return this.chargeLevel; }

    getChargeProfile() {
        return chargeProfile(this.chargeHeld);
    }
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
        this.currentSpeed = speed;
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
        const profile = this.getChargeProfile();
        const charge = this.stopCharge();
        this.heldPlayer = null;
        this.state = 'rally';
        this.aimed = true;
        const speed = this.baseSpeed * profile.power;
        this.currentSpeed = speed;
        const dir = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
        if (profile.spread > 0.001) {
            const angle = (Math.random() - 0.5) * 2 * profile.spread;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const jx = dir.x * cos - dir.z * sin;
            const jz = dir.x * sin + dir.z * cos;
            dir.set(jx, dir.y, jz).normalize();
        }
        this.velocity.copy(dir.multiplyScalar(this.currentSpeed));
        this.velocity.y = this.currentSpeed * 0.25;
        this._clampSpeed();
        this.setTarget(target);
        this._beginPlayerSteering(target, this.velocity);
        return { shot: charge > 0.7 ? 'spike' : 'flat', speed: this.currentSpeed };
    }

    _emitTrail(dt) {
        const speed = this.velocity.length();
        const trailGap = Math.max(0.006, 0.042 - speed * 0.002);
        this.trailTimer += dt;
        if (this.trailTimer < trailGap) return;
        this.trailTimer %= trailGap;

        const previous = this._trailLastPosition;
        const hasPrevious = this._trailHasLastPosition;
        const distance = hasPrevious ? previous.distanceTo(this.position) : 0;
        const spacing = clamp(0.25 - speed * 0.0012, 0.1, 0.25);
        const samples = hasPrevious ? clamp(Math.ceil(distance / spacing), 1, 5) : 1;
        for (let i = 1; i <= samples; i++) {
            if (hasPrevious) {
                this._trailSamplePosition.lerpVectors(previous, this.position, i / samples);
            } else {
                this._trailSamplePosition.copy(this.position);
            }
            this.addTrailDot(this._trailSamplePosition);
        }
        previous.copy(this.position);
        this._trailHasLastPosition = true;
    }

    addTrailDot(position = this.position) {
        const sr = Math.min(4, this.currentSpeed / this.baseSpeed);
        const spinFactor = Math.min(1, Math.abs(this.spin) * 0.3);
        // ponytail: bigger trail dots at high speed for dramatic streak
        const style = this.skinConfig?.trailStyle
            || (this.skinConfig?.frostTrail ? 'frost'
                : this.skinConfig?.burstTrail ? 'ember'
                    : this.skinId === 'lightning' || this.skinId === 'star' ? 'spark'
                        : this.skinId === 'rainbow' ? 'prism'
                            : this.skinId === 'abyss' ? 'void' : 'comet');
        const profile = TRAIL_STYLE_PROFILES[style] || TRAIL_STYLE_PROFILES.comet;
        const skinTrailMul = this.skinConfig?.burstTrail ? 1.7 : this.skinConfig?.frostTrail ? 1.35 : style === 'spark' ? 1.18 : 1;
        const r = Math.min(0.3, 0.055 * skinTrailMul * (1 + sr * 0.58 + spinFactor * 0.35));
        const trailColor = this._affixTrailColor ?? (this.skinConfig?.trail || 0xff2222);
        const dot = this._trailPool.acquire();
        dot.visible = true;
        dot.geometry = this._trailGeometries[profile.geometry];
        dot.material.color.setHex(trailColor);
        dot.material.blending = ['ember', 'spark', 'plasma', 'prism'].includes(style)
            ? THREE.AdditiveBlending
            : THREE.NormalBlending;
        dot.material.depthWrite = false;
        dot.material.depthTest = true;
        const opacity = Math.min(0.94, 0.58 + sr * 0.08 + (this.skinConfig?.frostTrail ? 0.12 : 0));
        dot.material.opacity = opacity;
        dot.scale.set(r * profile.x, r * profile.y, r * profile.z);
        dot.position.copy(position);
        // Spin offset — trail spreads slightly in curve direction
        if (Math.abs(this.spin) > 1) {
            const offset = 0.08 * Math.sign(this.spin);
            dot.position.x += offset;
            dot.position.z += offset;
        }
        this.scene.add(dot);
        // Faster ball = longer trail life
        const maxLife = (0.42 + sr * 0.24) * (style === 'frost' ? 1.15 : style === 'void' ? 1.08 : 1);
        this.trail.push({ mesh: dot, life: maxLife, maxLife, radius: r, opacity, profile });
        const maxTrail = 44 + Math.round(sr * 24);
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
            t.mesh.material.opacity = t.opacity * Math.pow(ratio, 0.72);
            const scale = Math.max(0.01, t.radius * (0.32 + ratio * 0.68));
            t.mesh.scale.set(scale * t.profile.x, scale * t.profile.y, scale * t.profile.z);
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
        this.trailTimer = 0;
        this._trailHasLastPosition = false;
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
        this._updateHeatVisual();

        // Trail
        this._emitTrail(dt);
        this.updateTrail(dt);
    }
}
