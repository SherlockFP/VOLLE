// Regression: "the ball circles around the player way too much".
// Runs the REAL Ball.update() (vendored three.js, visual FX stubbed) so the
// whole steering stack is covered, not a re-implementation of it.
// Root cause: aimed (player-steered) shots turn at a speed-independent rate,
// so their minimum turning radius v/omega (~1.5 m at base speed, ~4 m at the
// rally cap) exceeded the hit capsule (~0.9-1.2 m); the aimed rescue only
// turned at a fixed 7/s and could never tighten the circle. Before the fix
// 28/216 matrix configurations orbited, up to 28 revolutions in 6 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const threeUrl = new URL('../vendor/three/three.module.js', import.meta.url).href;
const poolUrl = new URL('../js/objectPool.js', import.meta.url).href;
const source = await readFile(new URL('../js/ball.js', import.meta.url), 'utf8');
const testable = source
    .replace("import * as THREE from 'three';", `import * as THREE from '${threeUrl}';`)
    .replace("import { ObjectPool } from './objectPool.js';", `import { ObjectPool } from '${poolUrl}';`)
    .replace(/import \{[^}]*\} from '\.\/ball-skin-fx\.js';/, 'const getBallSkinTexture = () => null; const rimPowerForSkin = () => 5; const trailIntensityMultiplier = () => 1; class BallImpactFX { spawn() {} update() {} clear() {} }');
const {
    Ball,
    ORBIT_COMMIT_RADIUS,
    ORBIT_COMMIT_SWEEP,
    orbitCommitTurnRate,
    orbitSweepDelta
} = await import(`data:text/javascript;base64,${Buffer.from(testable).toString('base64')}`);
const THREE = await import(threeUrl);

function makeRenderer() {
    const material = () => new THREE.ShaderMaterial({ uniforms: {
        uColor: { value: new THREE.Color() }, uTexture: { value: null },
        uTextureEnabled: { value: false }, uRimPower: { value: 5 }
    } });
    return { scene: new THREE.Scene(), createToonMaterial: material, createOutlineMesh: g => new THREE.Mesh(g), _quality: 'low' };
}

const arena = {
    bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40, maxY: 40 },
    ceilingHeight: 0,
    collidables: [],
    config: {},
    getSpawnPoint: () => new THREE.Vector3(0, 6, 0)
};

// Bot-shaped target: ground position, getPosition() returns +1.2 like bot.js.
function makeTarget(motion) {
    const target = { position: new THREE.Vector3(), alive: true, time: 0 };
    target.getPosition = () => new THREE.Vector3(target.position.x, target.position.y + 1.2, target.position.z);
    target.step = dt => {
        target.time += dt;
        if (motion === 'strafe') target.position.x += 7 * dt;
        else if (motion === 'adad') target.position.x += (Math.floor(target.time / 0.45) % 2 ? -7.5 : 7.5) * dt;
    };
    return target;
}

function makeBall() {
    const ball = new Ball(makeRenderer(), arena);
    ball._emitTrail = () => {};
    ball.updateTrail = () => {};
    ball.maxSpeed = 102; // default mode cap: 6x base
    ball.spawn();
    ball._noHitTimer = 0;
    return ball;
}

// Player deflect from 20 m, aim rotated `offsetDeg` off the target (>= 15 deg
// takes the wide rear-waypoint route). Returns contact time and the signed
// angle the ball swept around the target before contact (game.js capsule test).
function throwAimed({ speed, deflections, fps, offsetDeg, motion = 'still', maxTime = 3 }) {
    const ball = makeBall();
    const target = makeTarget(motion);
    const from = new THREE.Vector3(0, 1.5, -20);
    ball.position.copy(from);
    const aim = new THREE.Vector3().subVectors(target.getPosition(), from).normalize();
    const a = offsetDeg * Math.PI / 180;
    aim.set(aim.x * Math.cos(a) - aim.z * Math.sin(a), aim.y, aim.x * Math.sin(a) + aim.z * Math.cos(a)).normalize();
    ball.deflections = deflections - 1;
    ball.deflectWithAim(from, aim, target);
    ball.bodyZone = 'chest';
    ball.currentSpeed = speed;
    ball._clampSpeed();
    ball._beginPlayerSteering(target, ball.velocity);

    const dt = 1 / fps;
    const capsule = ball.radius + 0.4 + Math.min(speed * 0.003, 2);
    const sample = new THREE.Vector3();
    let sweep = 0;
    let lastAngle = null;
    for (let t = dt; t <= maxTime + 1e-9; t += dt) {
        target.step(dt);
        ball.update(dt);
        const tp = target.getPosition();
        const steps = Math.ceil(ball._prevPosition.distanceTo(ball.position) / (capsule * 0.5));
        for (let s = 0; s <= steps; s++) {
            sample.lerpVectors(ball._prevPosition, ball.position, steps ? s / steps : 1);
            const py = Math.max(0, Math.min(1.7, sample.y));
            const dx = sample.x - tp.x, dy = sample.y - py, dz = sample.z - tp.z;
            if (dx * dx + dy * dy + dz * dz < capsule * capsule) {
                return { hit: t, revolutions: Math.abs(sweep) / (2 * Math.PI), ball };
            }
        }
        const angle = Math.atan2(ball.position.z - tp.z, ball.position.x - tp.x);
        if (lastAngle !== null) sweep += orbitSweepDelta(lastAngle, angle);
        lastAngle = angle;
    }
    return { hit: null, revolutions: Math.abs(sweep) / (2 * Math.PI), ball };
}

const SPEEDS = [[17, 0], [51, 7], [102, 17]]; // base, mid-rally, mode cap
const FRAME_RATES = [30, 60, 144];

test('orbit commit turns tighter than the hit capsule at every rally speed', () => {
    assert.equal(ORBIT_COMMIT_SWEEP, 1.5 * Math.PI);
    const smallestCapsule = 0.47 + 0.4; // ball radius + body capsule at speed 0
    for (const speed of [0, 17, 51, 102, 204, 400]) {
        const radius = speed / orbitCommitTurnRate(speed);
        assert.ok(radius <= ORBIT_COMMIT_RADIUS + 1e-9, `turn radius ${radius} at ${speed}`);
        assert.ok(radius < smallestCapsule);
    }
    assert.equal(orbitCommitTurnRate(0), 7, 'never weaker than the legacy rescue');
    assert.ok(Math.abs(orbitSweepDelta(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9, 'wraps across +-pi');
    assert.equal(orbitSweepDelta(NaN, 1), 0);
});

test('aimed shots never orbit more than one revolution across speed, fps, aim and target motion', () => {
    for (const motion of ['still', 'strafe', 'adad']) {
        for (const offsetDeg of [0, 10, 20, 35]) {
            for (const [speed, deflections] of SPEEDS) {
                for (const fps of FRAME_RATES) {
                    const r = throwAimed({ speed, deflections, fps, offsetDeg, motion });
                    const label = `${motion} aim+${offsetDeg} v=${speed} ${fps}fps`;
                    assert.ok(r.hit !== null, `${label}: no contact in 3 s (orbit)`);
                    assert.ok(r.revolutions < 1, `${label}: ${r.revolutions.toFixed(2)} revolutions before contact`);
                }
            }
        }
    }
});

test('orbit resolution is frame-rate independent for still and strafing targets', () => {
    for (const motion of ['still', 'strafe']) {
        for (const offsetDeg of [20, 35]) {
            for (const [speed, deflections] of SPEEDS) {
                const reference = throwAimed({ speed, deflections, fps: 144, offsetDeg, motion });
                for (const fps of [30, 60]) {
                    const r = throwAimed({ speed, deflections, fps, offsetDeg, motion });
                    assert.ok(Math.abs(r.hit - reference.hit) <= 0.25,
                        `${motion} aim+${offsetDeg} v=${speed}: ${fps}fps ${r.hit} vs 144fps ${reference.hit}`);
                    assert.ok(Math.abs(r.revolutions - reference.revolutions) <= 0.25);
                }
            }
        }
    }
});

test('direct and slightly-off shots never trip the orbit commit (aim skill preserved)', () => {
    for (const offsetDeg of [0, 10]) {
        for (const [speed, deflections] of SPEEDS) {
            for (const fps of FRAME_RATES) {
                const r = throwAimed({ speed, deflections, fps, offsetDeg });
                assert.ok(r.hit !== null);
                assert.equal(r.ball._orbitCommitted, false, `aim+${offsetDeg} v=${speed} ${fps}fps committed`);
            }
        }
    }
});

test('a straight fly-by sweeps under the commit threshold', () => {
    const ball = makeBall();
    ball._resetSteering();
    const center = { x: 0, y: 1, z: 0 };
    for (let z = -30; z <= 30; z += 0.5) {
        ball.position.set(0.3, 1, z); // passes 0.3 m beside the target
        ball._trackOrbitSweep(center);
    }
    assert.ok(Math.abs(ball._orbitSweep) <= Math.PI + 1e-9);
    assert.equal(ball._orbitCommitted, false);
});

test('deflecting a committed ball clears the commit and the new shot flies its aim', () => {
    // Drive into a confirmed orbit commit (wide shot at the rally cap).
    const ball = makeBall();
    const target = makeTarget('still');
    const from = new THREE.Vector3(0, 1.5, -20);
    ball.position.copy(from);
    const aim = new THREE.Vector3().subVectors(target.getPosition(), from).normalize();
    const a = 35 * Math.PI / 180;
    aim.set(aim.x * Math.cos(a) - aim.z * Math.sin(a), aim.y, aim.x * Math.sin(a) + aim.z * Math.cos(a)).normalize();
    ball.deflections = 16;
    ball.deflectWithAim(from, aim, target);
    let committedAt = null;
    for (let i = 0; i < 240 && committedAt === null; i++) {
        ball.update(1 / 60);
        if (ball._orbitCommitted) committedAt = ball.position.clone();
    }
    assert.ok(committedAt, 'orbit commit engaged');

    // The defender deflects back toward the original thrower.
    const thrower = makeTarget('still');
    thrower.position.set(0, 0, -20);
    const back = new THREE.Vector3().subVectors(thrower.getPosition(), ball.position).normalize();
    ball.deflectWithAim(ball.position.clone(), back, thrower);
    assert.equal(ball._orbitCommitted, false);
    assert.equal(ball._orbitSweep, 0);
    ball.update(1 / 60); // inside STEERING_CONTROL_WINDOW: authored heading is kept
    const heading = ball.velocity.clone().normalize();
    assert.ok(heading.dot(back) > 0.99, 'deflect heading preserved');

    // Bot deflect path resets the watchdog as well.
    ball._orbitCommitted = true;
    ball.deflect(ball.position.clone(), new THREE.Vector3(0, 1.5, -20));
    assert.equal(ball._orbitCommitted, false);
});
