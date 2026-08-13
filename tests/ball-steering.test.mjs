import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('../js/game.js', import.meta.url), 'utf8');
const testableSource = source
    .replace("import * as THREE from 'three';", 'const THREE = {};')
    .replace("import { ObjectPool } from './objectPool.js';", 'class ObjectPool {}');
const ballModule = await import(`data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}`);

const {
    Ball,
    BALL_SKINS,
    BOUNCE_ROUTE_OWNERSHIP_WINDOW,
    STEERING_CONTROL_WINDOW,
    createAimRouteOffset,
    createWideWaypoint,
    floorSafeHomingTargetY,
    hasCrossedTargetPlane,
    homingRescueRange,
    isSteeringControlLocked,
    networkBallStep,
    predictLeadTarget,
    proximityHomingTurnRate,
    recoverCornerHoming,
    sampleBoundedVelocity,
    smoothSampledVelocity,
    splitSteeringDisplacement,
    steeringActiveDt,
    steeringDtAfterBounceOwnership,
    steeringTurnAlpha,
    postBounceRouteOwnershipDt,
    shouldDirectHomingRescue
} = ballModule;

test('every purchasable ball skin is cosmetic-only and ready for the shop', () => {
    for (const [id, skin] of Object.entries(BALL_SKINS)) {
        if (id === 'classic') continue;
        assert.ok(Number.isInteger(skin.price) && skin.price > 0, `${id} needs a price`);
        assert.match(skin.rarity, /^(rare|epic|legendary)$/);
        assert.equal(Object.hasOwn(skin, 'speedBonus'), false, `${id} must not change speed`);
    }
});

test('sample smoothing absorbs target jitter without changing direction instantly', () => {
    const filtered = smoothSampledVelocity(
        { x: 0, y: 0, z: 0 },
        { x: 14, y: 0, z: 0 },
        1 / 60
    );
    assert.ok(filtered.x > 0);
    assert.ok(filtered.x < 14);
    assert.deepEqual(smoothSampledVelocity(filtered, { x: NaN }, -1), filtered);
});

test('network ball prediction advances every frame and bounds packet extrapolation', () => {
    const position = { x: 0, y: 1, z: 0 };
    const velocity = { x: 20, y: 0, z: 0 };
    const target = { x: 0, y: 1, z: 0 };
    const fresh = networkBallStep(position, velocity, target, 1 / 60, 0);
    const stale = networkBallStep(position, velocity, target, 1 / 60, 5);

    assert.ok(fresh.x > 0);
    assert.ok(stale.x > fresh.x);
    assert.ok(stale.x < 2);
});

test('client ball visual smoothing is frame-rate bounded', () => {
    assert.match(source, /1 - Math\.exp\(-22 \* Math\.min\(Math\.max\(dt \|\| 0, 0\), 0\.05\)\)/);
    assert.match(source, /this\._visualPosition\.lerp\(this\.position, blend\)/);
});

test('straight shot leads a moving target with bounded sampled velocity', () => {
    const velocity = sampleBoundedVelocity(
        { x: 0, y: 1, z: -10 },
        { x: 2, y: 1, z: -10 },
        0.1,
        5
    );
    assert.ok(Math.abs(Math.hypot(velocity.x, velocity.y, velocity.z) - 5) < 1e-9);

    const lead = predictLeadTarget(
        { x: 2, y: 1, z: -10 },
        velocity,
        { x: 0, y: 1, z: 0 },
        20
    );
    assert.ok(lead.x > 2);
    assert.ok(lead.x <= 4.2);
    assert.equal(lead.z, -10);
});

test('player steering preserves a stationary baseline, leads laterally, and pursues a bounded rear intercept', () => {
    const target = { x: 0, y: 1, z: -10 };
    const projectile = { x: 0, y: 1, z: 0 };
    const stationary = predictLeadTarget(target, { x: 0, y: 0, z: 0 }, projectile, 20);
    const lateral = predictLeadTarget(target, { x: 6, y: 0, z: 0 }, projectile, 20);
    const movingAway = predictLeadTarget(target, { x: 0, y: 0, z: -14 }, projectile, 20);

    assert.deepEqual(stationary, target, 'a stationary target must keep the direct baseline');
    assert.ok(lateral.x > 1.7 && lateral.x < 2.6,
        `lateral movement should produce a readable lead, got ${lateral.x}`);
    assert.ok(movingAway.z < target.z,
        'a target moving away should be pursued from behind rather than pulled back to a frontal point');
    assert.ok(movingAway.z >= target.z - 5.88,
        'rear pursuit must remain bounded by the 0.42s intercept cap');
});

test('wide shot creates a deterministic side/back waypoint and switches at target plane', () => {
    const origin = { x: 0, y: 1, z: 0 };
    const target = { x: 0, y: 1, z: -10 };
    const aim = { x: 1, y: 0, z: 0 };
    const first = createWideWaypoint(origin, aim, target);
    const second = createWideWaypoint(origin, aim, target);

    assert.deepEqual(first, second);
    assert.notEqual(first.position.x, target.x);
    assert.ok(Math.abs(first.position.x - target.x) <= 3.25);
    assert.ok(first.position.z <= target.z - 6);
    assert.ok(Math.abs(first.position.z - target.z) > Math.abs(first.position.x - target.x));
    assert.equal(hasCrossedTargetPlane({ x: 0, y: 1, z: -9 }, target, first.planeNormal), false);
    assert.equal(hasCrossedTargetPlane({ x: 0, y: 1, z: -11 }, target, first.planeNormal), true);
    assert.equal(createWideWaypoint(origin, { x: 0, y: 0, z: -1 }, target), null);
    assert.notEqual(createWideWaypoint(origin, { x: 0.4, y: 0, z: -1 }, target), null);
});

test('control delay preserves initial aim for 0.074 seconds', () => {
    assert.equal(isSteeringControlLocked(0), true);
    assert.equal(isSteeringControlLocked(STEERING_CONTROL_WINDOW - 1e-6), true);
    assert.equal(isSteeringControlLocked(STEERING_CONTROL_WINDOW), false);
    assert.equal(steeringActiveDt(0.05, 0.02), 0);
    assert.ok(Math.abs(steeringActiveDt(0.07, 0.01) - 0.006) < 1e-12);
    assert.ok(Math.abs(steeringActiveDt(0.08, 0.01) - 0.01) < 1e-12);
});

test('control-window boundary splits displacement within the frame', () => {
    const displacement = splitSteeringDisplacement(
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 0, z: 10 },
        0.1,
        0.026
    );

    assert.ok(Math.abs(displacement.x - 0.74) < 1e-12);
    assert.ok(Math.abs(displacement.z - 0.26) < 1e-12);
});

test('turn rate is frame-rate independent and grows per deflection', () => {
    const oneTick = steeringTurnAlpha(1 / 66, 0);
    const halfTick = steeringTurnAlpha(1 / 132, 0);
    const compounded = 1 - (1 - halfTick) ** 2;

    assert.ok(Math.abs(oneTick - 0.30) < 1e-12);
    assert.ok(Math.abs(compounded - oneTick) < 1e-12);
    assert.ok(Math.abs(steeringTurnAlpha(1 / 66, 3) - (0.30 + 3 * 0.018)) < 1e-12);
    assert.equal(steeringTurnAlpha(1 / 66, 999), 0.9);
});

test('aim routes can target side, back, and above-body positions', () => {
    const offset = createAimRouteOffset(
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: -10 },
        { x: 1, y: 1, z: -1 }
    );

    assert.ok(offset.x > 0);
    assert.ok(offset.y > 0);
    assert.ok(offset.z < 0);
    assert.deepEqual(createAimRouteOffset(null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: 0 });
});

test('clean bank-shot ownership is exact at 30/60/144 FPS and composes with the aim lock', () => {
    assert.ok(BOUNCE_ROUTE_OWNERSHIP_WINDOW >= 0.075 && BOUNCE_ROUTE_OWNERSHIP_WINDOW <= 0.09);
    assert.equal(postBounceRouteOwnershipDt(0.082, 1 / 30), 1 / 30);
    assert.equal(postBounceRouteOwnershipDt(0.01, 1 / 30), 0.01);
    assert.equal(postBounceRouteOwnershipDt(0.01, -1), 0);
    assert.ok(Math.abs(steeringDtAfterBounceOwnership(0.05, 0.05, 0.03) - 0.02) < 1e-12);
    assert.ok(Math.abs(steeringDtAfterBounceOwnership(0.05, 0.05, 0.01) - 0.026) < 1e-12);
});

function bankShotTrace(kind, fps) {
    const position = kind === 'floor' ? { x: -3, z: 20 } : { x: -9, z: 14 };
    const target = { x: 0, z: 0 };
    const velocity = kind === 'floor' ? { x: 7, z: -22 } : { x: 16, z: -18 };
    const initial = { ...velocity };
    const speed = Math.hypot(velocity.x, velocity.z);
    const hitRadius = 1.4;
    let remaining = BOUNCE_ROUTE_OWNERSHIP_WINDOW;
    let time = 0;
    let owned = 0;
    let headingAt75 = null;
    let hitTime = null;

    for (let frame = 0; frame < fps * 3; frame++) {
        const dt = Math.min(1 / fps, 3 - time);
        const ownedDt = postBounceRouteOwnershipDt(remaining, dt);
        remaining -= ownedDt;
        owned += ownedDt;
        const steerDt = dt - ownedDt;
        const dx = target.x - position.x;
        const dz = target.z - position.z;
        const distance = Math.hypot(dx, dz);
        const targetX = dx / distance;
        const targetZ = dz / distance;
        const currentLength = Math.hypot(velocity.x, velocity.z);
        const currentX = velocity.x / currentLength;
        const currentZ = velocity.z / currentLength;
        const alignment = currentX * targetX + currentZ * targetZ;
        const rescue = shouldDirectHomingRescue(distance, speed, time + dt, alignment);
        let nextX = currentX;
        let nextZ = currentZ;
        if (rescue) {
            nextX = targetX;
            nextZ = targetZ;
        } else if (steerDt > 0) {
            const turn = 1 - Math.exp(-proximityHomingTurnRate(distance, time + dt) * steerDt);
            nextX += (targetX - nextX) * turn;
            nextZ += (targetZ - nextZ) * turn;
            const nextLength = Math.hypot(nextX, nextZ);
            nextX /= nextLength;
            nextZ /= nextLength;
        }

        const before = { ...position };
        position.x += initial.x * ownedDt + nextX * speed * steerDt;
        position.z += initial.z * ownedDt + nextZ * speed * steerDt;
        velocity.x = nextX * speed;
        velocity.z = nextZ * speed;
        if (time < 0.075 && time + ownedDt >= 0.075) headingAt75 = { x: initial.x, z: initial.z };
        if (segmentEntersRadius(before, position, hitRadius)) {
            hitTime = time + dt;
            break;
        }
        time += dt;
    }

    const initialLength = Math.hypot(initial.x, initial.z);
    const headingLength = Math.hypot(headingAt75.x, headingAt75.z);
    const headingDot = (initial.x * headingAt75.x + initial.z * headingAt75.z) / (initialLength * headingLength);
    return {
        owned,
        hitTime,
        headingDegrees: Math.acos(Math.max(-1, Math.min(1, headingDot))) * 180 / Math.PI,
        lateralSign: Math.sign(initial.x),
        depthSign: Math.sign(initial.z)
    };
}

test('floor and wall bank shots preserve their reflected sign before converging in three seconds', () => {
    for (const kind of ['floor', 'wall']) {
        for (const fps of [30, 60, 144]) {
            const trace = bankShotTrace(kind, fps);
            assert.ok(Math.abs(trace.owned - BOUNCE_ROUTE_OWNERSHIP_WINDOW) < 1e-12, `${kind}/${fps} ownership drifted`);
            assert.ok(trace.headingDegrees <= 8, `${kind}/${fps} changed reflected heading too early`);
            assert.equal(trace.lateralSign, 1, `${kind}/${fps} lost reflected lateral sign`);
            assert.equal(trace.depthSign, -1, `${kind}/${fps} lost reflected depth sign`);
            assert.ok(trace.hitTime !== null && trace.hitTime <= 3, `${kind}/${fps} bank route did not converge`);
        }
    }
    assert.match(source, /if \(!cleanBounce \|\| !this\._beginBounceRouteOwnership\(\)\)/);
    assert.match(source, /this\._getTargetPos\(true, this\._bounceRouteTarget\)/);
    assert.match(source, /if \(shouldDirectHomingRescue\(distance, this\.currentSpeed, this\._homingAge, alignment\)\) return false;/);
});

function subtleRouteTrace(angleDegrees, fps) {
    const target = { x: 0, y: 1, z: -10 };
    const radians = angleDegrees * Math.PI / 180;
    const aim = { x: Math.sin(radians), y: 0, z: -Math.cos(radians) };
    const route = createAimRouteOffset({ x: 0, y: 1, z: 0 }, target, aim);
    const routeTarget = { x: target.x + route.x, z: target.z + route.z };
    const speed = 24;
    const position = { x: 0, z: 0 };
    let velocity = { x: aim.x * speed, z: aim.z * speed };
    let age = 0;
    let time = 0;

    while (time < 0.25 - 1e-12) {
        const dt = Math.min(1 / fps, 0.25 - time);
        const activeDt = steeringActiveDt(age, dt);
        age += dt;
        time += dt;
        const before = velocity;
        if (activeDt > 0) {
            let desiredX = routeTarget.x - position.x;
            let desiredZ = routeTarget.z - position.z;
            const desiredLength = Math.hypot(desiredX, desiredZ);
            desiredX /= desiredLength;
            desiredZ /= desiredLength;
            const velocityLength = Math.hypot(velocity.x, velocity.z);
            const currentX = velocity.x / velocityLength;
            const currentZ = velocity.z / velocityLength;
            const turn = steeringTurnAlpha(activeDt);
            let nextX = currentX + (desiredX - currentX) * turn;
            let nextZ = currentZ + (desiredZ - currentZ) * turn;
            const nextLength = Math.hypot(nextX, nextZ);
            velocity = { x: nextX / nextLength * speed, z: nextZ / nextLength * speed };
        }
        const displacement = splitSteeringDisplacement(before, velocity, dt, activeDt);
        position.x += displacement.x;
        position.z += displacement.z;
    }

    return { route, position };
}

test('subtle aimed routes preserve zero-degree shots and stay bounded through 10-15 degrees', () => {
    const origin = { x: 0, y: 1, z: 0 };
    const target = { x: 0, y: 1, z: -10 };
    const direct = createAimRouteOffset(origin, target, { x: 0, y: 0, z: -1 });
    assert.deepEqual(direct, { x: 0, y: 0, z: 0 }, '0-degree aim keeps the exact direct baseline');

    const routes = [10, 12.5, 15].map(angle => {
        const radians = angle * Math.PI / 180;
        return createAimRouteOffset(origin, target, {
            x: Math.sin(radians), y: 0, z: -Math.cos(radians)
        });
    });

    assert.ok(routes[0].x > 0.19 && routes[0].z < -0.06,
        `10-degree aim should make a visible side/rear route, got ${JSON.stringify(routes[0])}`);
    assert.ok(routes[1].x > routes[0].x && routes[1].z < routes[0].z);
    assert.ok(routes[2].x > routes[1].x && routes[2].z < routes[1].z);
    for (const route of routes) {
        assert.ok(Math.abs(route.x) <= 0.55, `lateral route escaped bound: ${route.x}`);
        assert.ok(route.z >= -0.48 && route.z <= 0, `rear route escaped bound: ${route.z}`);
    }
});

test('subtle aimed route trace is frame-rate equivalent at 30/60/120 FPS', () => {
    const traces = [30, 60, 120].map(fps => subtleRouteTrace(12.5, fps));
    const baseline = traces[1];
    for (const trace of traces) {
        assert.deepEqual(trace.route, baseline.route, 'route is chosen once and is frame-rate invariant');
        assert.ok(Math.abs(trace.position.x - baseline.position.x) < 0.04,
            `lateral trace drifted at route rate: ${trace.position.x}`);
        assert.ok(Math.abs(trace.position.z - baseline.position.z) < 0.04,
            `forward trace drifted at route rate: ${trace.position.z}`);
    }
});

test('homing gains strength near its target without exceeding its turn cap', () => {
    const far = proximityHomingTurnRate(12, 0);
    const close = proximityHomingTurnRate(1, 2);

    assert.ok(close > far);
    assert.ok(close <= 7.5);
    assert.equal(proximityHomingTurnRate(0, 999), 7.5);
});

function segmentEntersRadius(from, to, radius) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0
        ? Math.max(0, Math.min(1, -(from.x * dx + from.z * dz) / lengthSq))
        : 0;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    return x * x + z * z <= radius * radius;
}

function simulateTerminalRescue(speed, fps, headingDegrees) {
    const dt = 1 / fps;
    const heading = headingDegrees * Math.PI / 180;
    const position = { x: 12, z: 0 };
    const velocity = { x: Math.cos(heading) * speed, z: Math.sin(heading) * speed };
    const hitRadius = 0.4 + Math.min(speed * 0.003, 2);
    let homingAge = 0;
    let directRescueObserved = false;

    for (let frame = 0; frame < fps * 3; frame++) {
        const distance = Math.hypot(position.x, position.z);
        const targetX = -position.x / distance;
        const targetZ = -position.z / distance;
        const velocityLength = Math.hypot(velocity.x, velocity.z);
        const currentX = velocity.x / velocityLength;
        const currentZ = velocity.z / velocityLength;
        const alignment = currentX * targetX + currentZ * targetZ;
        homingAge += dt;

        const directRescue = shouldDirectHomingRescue(
            distance, speed, homingAge, alignment
        );
        directRescueObserved ||= directRescue;
        let nextX = targetX;
        let nextZ = targetZ;
        if (!directRescue) {
            const turn = 1 - Math.exp(-proximityHomingTurnRate(distance, homingAge) * dt);
            nextX = currentX + (targetX - currentX) * turn;
            nextZ = currentZ + (targetZ - currentZ) * turn;
            const nextLength = Math.hypot(nextX, nextZ);
            nextX /= nextLength;
            nextZ /= nextLength;
        }

        velocity.x = nextX * speed;
        velocity.z = nextZ * speed;
        assert.ok(
            Math.abs(Math.hypot(velocity.x, velocity.z) - speed) < 1e-9,
            `rescue changed speed ${speed} at ${fps} FPS`
        );

        const before = { x: position.x, z: position.z };
        position.x += velocity.x * dt;
        position.z += velocity.z * dt;
        if (segmentEntersRadius(before, position, hitRadius)) {
            return { hitTime: (frame + 1) * dt, directRescueObserved };
        }
    }
    return { hitTime: null, directRescueObserved };
}

test('terminal rescue ends tangent and away orbits without capping rally speed', () => {
    const speeds = [17, 22.1, 27.2, 51, 102, 204];
    const frameRates = [20, 60, 144];
    const headings = [90, 0]; // tangent orbit and exact antiparallel deadlock

    for (const speed of speeds) {
        for (const fps of frameRates) {
            for (const heading of headings) {
                const result = simulateTerminalRescue(speed, fps, heading);
                if (heading === 0) {
                    assert.equal(result.directRescueObserved, true, `no away rescue at ${speed}/${fps}`);
                }
                assert.ok(
                    result.hitTime !== null && result.hitTime <= 3,
                    `orbit survived at ${speed} speed, ${fps} FPS, heading ${heading}`
                );
            }
        }
    }

    assert.equal(homingRescueRange(17), 3.5);
    assert.equal(homingRescueRange(204), 6);
    assert.equal(shouldDirectHomingRescue(20, 204, 0.5, 0.2), false);
    assert.equal(shouldDirectHomingRescue(3, 51, 1.2, 0.4), true);
    assert.equal(shouldDirectHomingRescue(20, 51, 1.2, -0.4), true);
    assert.equal((source.match(/shouldDirectHomingRescue\(/g) || []).length, 5);
});

function simulateFloorOrbit(targetY, speed = 204, fps = 60, rescueDecision = shouldDirectHomingRescue) {
    const dt = 1 / fps;
    const position = { x: 1.7, y: 0.47, z: 0 };
    const heading = -70 * Math.PI / 180;
    const velocity = {
        x: -Math.cos(heading) * speed,
        y: 0,
        z: -Math.sin(heading) * speed
    };
    const hitRadius = 0.47 + 0.4 + Math.min(speed * 0.003, 2);
    let homingAge = 0;
    let bounces = 0;

    for (let frame = 0; frame < fps * 5; frame++) {
        const dx = -position.x;
        const dy = targetY - position.y;
        const dz = -position.z;
        const distance = Math.hypot(dx, dy, dz);
        const targetDir = { x: dx / distance, y: dy / distance, z: dz / distance };
        const velocityLength = Math.hypot(velocity.x, velocity.y, velocity.z);
        const current = {
            x: velocity.x / velocityLength,
            y: velocity.y / velocityLength,
            z: velocity.z / velocityLength
        };
        homingAge += dt;
        const alignment = current.x * targetDir.x + current.y * targetDir.y + current.z * targetDir.z;
        const direct = rescueDecision(distance, speed, homingAge, alignment);
        const momentum = distance < 1.5 ? 0.22 : distance < 3 ? 0.18 : Math.min(distance / 10, 1) * 0.4;
        let next = direct ? targetDir : {
            x: targetDir.x * (1 - momentum) + current.x * momentum,
            y: targetDir.y * (1 - momentum) + current.y * momentum,
            z: targetDir.z * (1 - momentum) + current.z * momentum
        };
        let nextLength = Math.hypot(next.x, next.y, next.z);
        next = { x: next.x / nextLength, y: next.y / nextLength, z: next.z / nextLength };
        if (!direct) {
            const turn = 1 - Math.exp(-proximityHomingTurnRate(distance, homingAge) * dt);
            next = {
                x: current.x + (next.x - current.x) * turn,
                y: current.y + (next.y - current.y) * turn,
                z: current.z + (next.z - current.z) * turn
            };
            nextLength = Math.hypot(next.x, next.y, next.z);
            next.x /= nextLength;
            next.y /= nextLength;
            next.z /= nextLength;
        }
        velocity.x = next.x * speed;
        velocity.y = next.y * speed;
        velocity.z = next.z * speed;

        const before = { x: position.x, z: position.z };
        position.x += velocity.x * dt;
        position.y += velocity.y * dt;
        position.z += velocity.z * dt;
        if (position.y < 0.47) {
            position.y = 0.47;
            const floorBounce = 0.62 + Math.min(0.33, speed * 0.014);
            velocity.y = Math.max(4.5, Math.abs(velocity.y) * floorBounce);
            const recovered = recoverCornerHoming(
                velocity,
                position,
                { x: 0, y: targetY, z: 0 },
                speed
            );
            velocity.x = recovered.x;
            velocity.y = recovered.y;
            velocity.z = recovered.z;
            homingAge = Math.max(homingAge, 0.75);
            bounces++;
        }
        if (segmentEntersRadius(before, position, hitRadius)) {
            return { hitTime: (frame + 1) * dt, bounces };
        }
    }
    return { hitTime: null, bounces };
}

test('floor-safe target breaks the close horizontal orbit without changing speed', () => {
    const legacyRescue = (distance, speed, homingAge, alignment) => (
        alignment < 0.15
        && (distance < homingRescueRange(speed) || homingAge > 1.15)
    );
    const unsafe = simulateFloorOrbit(0.35, 204, 60, legacyRescue);
    const safeTargetY = floorSafeHomingTargetY(0.35, 0.47);
    const rescued = simulateFloorOrbit(safeTargetY);

    assert.equal(unsafe.hitTime, null);
    assert.equal(unsafe.bounces, 300);
    assert.equal(safeTargetY, 0.47);
    assert.ok(rescued.hitTime !== null && rescued.hitTime <= 0.05);
    assert.ok(rescued.bounces <= 1);
});

test('leg and downward-route targeting cannot steer below the ball floor', () => {
    const ball = Object.create(Ball.prototype);
    ball.radius = 0.47;
    ball.bodyZone = 'legs';
    ball._targetRouteOffset = { x: 0, y: -0.8, z: 0 };
    ball.targetPlayer = {
        getPosition() {
            return {
                x: 2,
                y: 1.7,
                z: 3,
                clone() { return { x: this.x, y: this.y, z: this.z }; }
            };
        }
    };

    assert.equal(ball._getTargetPos().y, 0.47);
});

// Regresyon koruması: orbit kurtarma yalnızca _updatePlayerSteering'de vardı.
// Aimed/steering aktif olmayan yolda (bot atışları, steering penceresi bittikten
// sonra) yoktu ve top hedefin etrafında sonsuz dönüyordu.
test('non-steering homing branch also rescues from orbiting', () => {
    const branch = source.slice(
        source.indexOf('                } else if (dist > 0.5) {'),
        source.indexOf('            // Close range (<2): skip gravity to avoid orbiting')
    );
    assert.ok(branch.length > 0, 'homing branch not found');
    assert.match(branch, /const alignment = velDir\.dot\(targetDir\)/);
    assert.match(branch, /const isCircling = dist < rescueRange && alignment < 0\.15/);
    assert.match(branch, /const hasOverstayed = this\._homingAge > 1\.15/);
    assert.match(branch, /rescuing \? 1 - Math\.exp\(-7 \* homingDt\) : 0/);
    // Patolojik yörünge, aynı yumuşak lerp'e geri düşmeden doğrudan kapanmalı.
    assert.match(branch, /const newDir = directRescue\s+\? targetDir/);
    // eşikler _updatePlayerSteering'deki kurtarma ile aynı kalmalı
    assert.match(source, /const rescueRange = homingRescueRange\(this\.currentSpeed\)/);
});

test('homing age resets with steering so a new target starts a fresh rescue clock', () => {
    const reset = source.slice(
        source.indexOf('    _resetSteering() {'),
        source.indexOf('    _clampSpeed()')
    );
    assert.match(reset, /this\._homingAge = 0;/);
});

test('steering measures distance before normalization and clears route offsets for torso rescue', () => {
    const method = source.slice(
        source.indexOf('    _updatePlayerSteering(dt, targetPos, bounceRouteDt = 0) {'),
        source.indexOf('    _clampSpeed() {')
    );
    assert.ok(method.indexOf('const targetDistance = desired.length();') >= 0);
    assert.ok(method.indexOf('const targetDistance = desired.length();') < method.indexOf('desired.normalize();'));
    assert.match(method, /this\._targetRouteOffset = \{ x: 0, y: 0, z: 0 \};/);
    assert.match(method, /const rescueTurn = hasOverstayed \|\| isCircling/);
});

// Regresyon koruması: V27-07-2026 bu geri-düşmeyi silmişti, top hedefsiz kalıp
// sonsuza uçuyordu. c405d7a davranışı geri getirildi — tekrar silinmesin.
test('aim targeting falls back to the closest enemy outside the aim cone', () => {
    const method = gameSource.slice(
        gameSource.indexOf('    getAimedEnemy(fromPos, aimDir, team) {'),
        gameSource.indexOf('    // --- MAIN LOOP ---')
    );
    assert.match(method, /let best = null, bestDot = 0\.5/);
    assert.match(method, /if \(best\) return best;/);
    assert.match(method, /enemies\.reduce/);
});

test('corner recovery bends a reflected ball back toward its target', () => {
    const recovered = recoverCornerHoming(
        { x: -20, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 12, y: 1, z: 0 },
        20
    );

    assert.ok(recovered.x > 0);
    assert.ok(Math.abs(Math.hypot(recovered.x, recovered.y, recovered.z) - 20) < 1e-9);
});

test('spawn, deactivate, and retarget reset steering; clamp repairs non-finite values', () => {
    const ball = Object.create(Ball.prototype);
    ball.arena = { getSpawnPoint: () => ({ x: 0, y: 4, z: 0 }) };
    ball.position = { copy() { return this; } };
    ball.velocity = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
    };
    ball.baseSpeed = 17;
    ball.mesh = { position: { copy() {} }, visible: false };
    ball.clearTrail = () => {};
    ball.updateColor = () => {};
    ball._steeringActive = true;
    ball.spawn();
    assert.equal(ball._steeringActive, false);

    ball._steeringActive = true;
    ball.deactivate();
    assert.equal(ball._steeringActive, false);

    ball.targetPlayer = {};
    ball._steeringActive = true;
    ball._steeringAge = 1;
    ball._steeringWaypoint = {};
    ball.setTarget({});

    assert.equal(ball._steeringActive, false);
    assert.equal(ball._steeringAge, 0);
    assert.equal(ball._steeringWaypoint, null);

    ball.maxSpeed = 102;
    ball.currentSpeed = Infinity;
    ball._steeringInitialDir = { x: 1, y: 0, z: 0 };
    ball.velocity = {
        x: NaN,
        y: 0,
        z: 0,
        copy(other) {
            this.x = other.x;
            this.y = other.y;
            this.z = other.z;
            return this;
        },
        multiplyScalar(scale) {
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
            return this;
        }
    };

    ball._clampSpeed();
    assert.equal(ball.currentSpeed, 17);
    assert.deepEqual(
        [ball.velocity.x, ball.velocity.y, ball.velocity.z].map(Number.isFinite),
        [true, true, true]
    );
});
