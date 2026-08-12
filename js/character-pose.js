// character-pose.js — pure procedural skeletal poses (no THREE, node-testable).
// ponytail: rig sadece euler açı okur; poz matematiği burada saf kalır.

export const JOINTS = Object.freeze([
    'hips', 'torso', 'head',
    'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
    'hipL', 'kneeL', 'hipR', 'kneeR'
]);

export const POSE_STATES = Object.freeze([
    'idle', 'walk', 'run', 'jump', 'fall', 'land',
    'throw', 'deflect', 'hit', 'dead', 'emote', 'victory'
]);

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
// A square voxel torso reads much more dramatically than a rounded humanoid at
// the same Euler angle. Keep living silhouettes upright enough that hit +
// strafe reactions never fold the head and torso sideways across the legs.
export const MAX_LIVE_LEAN = .06;
export const MAX_LIVE_TORSO_ROLL = .08;
export const MAX_LIVE_HEAD_ROLL = .12;

/** Zero euler set for every joint. Callers mutate the returned object. */
export function neutralPose() {
    const pose = { offsetY: 0, lean: 0 };
    for (const joint of JOINTS) pose[joint] = { x: 0, y: 0, z: 0 };
    return pose;
}

export function isPoseState(value) {
    return POSE_STATES.includes(value);
}

const swingArms = (pose, phase, amount) => {
    const swing = Math.sin(phase) * amount;
    pose.shoulderL.x = swing;
    pose.shoulderR.x = -swing;
    pose.elbowL.x = -Math.max(0, swing) * .55 - amount * .18;
    pose.elbowR.x = -Math.max(0, -swing) * .55 - amount * .18;
};

const swingLegs = (pose, phase, amount) => {
    const swing = Math.sin(phase) * amount;
    pose.hipL.x = -swing;
    pose.hipR.x = swing;
    pose.kneeL.x = Math.max(0, swing) * .9;
    pose.kneeR.x = Math.max(0, -swing) * .9;
};

/**
 * Deterministic pose for a state.
 * @param {string} state one of POSE_STATES
 * @param {number} time seconds (animation clock)
 * @param {object} params { speed, strafe, aim, progress, seed }
 */
export function poseFor(state, time = 0, params = {}) {
    const pose = neutralPose();
    // ponytail: faz periyodik — büyük saat değerini sarmak taşmayı (sin(Infinity)=NaN) önler.
    const t = num(time) % 1e5;
    const speed = clamp(num(params.speed), 0, 24);
    const aim = clamp(num(params.aim), -1.2, 1.2);
    const progress = clamp(num(params.progress), 0, 1);
    const strafe = clamp(num(params.strafe), -1, 1);
    const seed = num(params.seed) % TAU;

    switch (state) {
        case 'walk': {
            const phase = t * 5.4 + seed;
            swingLegs(pose, phase, .46);
            swingArms(pose, phase, .32);
            pose.offsetY = Math.abs(Math.sin(phase)) * .035;
            pose.torso.y = Math.sin(phase) * .035;
            break;
        }
        case 'run': {
            const rate = 6.2 + clamp(speed, 0, 18) * .28;
            const phase = t * rate + seed;
            const amount = .56 + clamp(speed / 18, 0, 1) * .22;
            swingLegs(pose, phase, amount);
            swingArms(pose, phase, amount * .82);
            pose.offsetY = Math.abs(Math.sin(phase)) * .055;
            pose.torso.x = .09 + clamp(speed / 18, 0, 1) * .07;
            pose.torso.y = Math.sin(phase) * .045;
            pose.head.x = -pose.torso.x * .52;
            break;
        }
        case 'jump':
            pose.hipL.x = -.62; pose.kneeL.x = .78;
            pose.hipR.x = -.24; pose.kneeR.x = .34;
            pose.shoulderL.x = -1.15; pose.shoulderR.x = -1.15;
            pose.elbowL.x = -.5; pose.elbowR.x = -.5;
            pose.torso.x = -.12;
            break;
        case 'fall':
            pose.hipL.x = .3; pose.kneeL.x = .5;
            pose.hipR.x = -.18; pose.kneeR.x = .62;
            pose.shoulderL.x = -1.55; pose.shoulderL.z = -.35;
            pose.shoulderR.x = -1.55; pose.shoulderR.z = .35;
            pose.torso.x = .1;
            break;
        case 'land': {
            const ease = 1 - progress;
            pose.hipL.x = -.7 * ease; pose.kneeL.x = 1.1 * ease;
            pose.hipR.x = -.7 * ease; pose.kneeR.x = 1.1 * ease;
            pose.shoulderL.x = .5 * ease; pose.shoulderR.x = .5 * ease;
            pose.offsetY = -.24 * ease;
            pose.torso.x = .18 * ease;
            break;
        }
        case 'throw': {
            // wind-up (0-.4) → release (.4-.62) → recover
            const wind = clamp(progress / .4, 0, 1);
            const release = clamp((progress - .4) / .22, 0, 1);
            const recover = clamp((progress - .62) / .38, 0, 1);
            const arc = wind - release;
            pose.shoulderR.x = -2.5 * wind + 3.1 * release - 1.2 * recover;
            pose.shoulderR.z = .45 * arc;
            pose.elbowR.x = -1.5 * wind + 1.35 * release;
            pose.shoulderL.x = -.55 * wind + .3 * release;
            pose.torso.y = .38 * wind - .62 * release + .24 * recover;
            pose.hips.y = pose.torso.y * .22;
            pose.head.y = -pose.torso.y * .32;
            pose.torso.x = -.1 * wind + .18 * release;
            break;
        }
        case 'deflect': {
            const push = Math.sin(progress * Math.PI);
            pose.shoulderL.x = -1.75 * push; pose.shoulderL.z = -.5 * push;
            pose.shoulderR.x = -1.75 * push; pose.shoulderR.z = .5 * push;
            pose.elbowL.x = -.95 * push; pose.elbowR.x = -.95 * push;
            pose.torso.x = -.12 * push;
            pose.offsetY = -.06 * push;
            break;
        }
        case 'hit': {
            const shock = (1 - progress) * Math.sin(progress * 22 + seed);
            pose.torso.x = -.18 * (1 - progress);
            pose.torso.z = .07 * shock;
            pose.head.z = -.11 * shock;
            pose.shoulderL.z = -.24 * (1 - progress);
            pose.shoulderR.z = .24 * (1 - progress);
            break;
        }
        case 'dead': {
            const fall = clamp(progress * 1.4, 0, 1);
            pose.hips.x = -1.52 * fall;
            pose.offsetY = -.72 * fall;
            pose.torso.x = .3 * fall;
            pose.head.x = .45 * fall;
            pose.shoulderL.z = -1.1 * fall; pose.shoulderR.z = 1.1 * fall;
            pose.hipL.x = .35 * fall; pose.hipR.x = .2 * fall;
            break;
        }
        case 'emote': {
            const phase = t * 6 + seed;
            pose.shoulderL.z = -2.3 + Math.sin(phase) * .35;
            pose.shoulderR.z = 2.3 - Math.sin(phase) * .35;
            pose.elbowL.x = -.4; pose.elbowR.x = -.4;
            pose.torso.y = Math.sin(phase * .5) * .14;
            pose.offsetY = Math.abs(Math.sin(phase * .5)) * .07;
            break;
        }
        case 'victory': {
            const phase = t * 3.4 + seed;
            pose.shoulderL.z = -2.6; pose.shoulderR.z = 2.6;
            pose.shoulderL.x = -.3 + Math.sin(phase) * .2;
            pose.shoulderR.x = -.3 + Math.sin(phase + Math.PI) * .2;
            pose.hipL.x = -.18; pose.kneeL.x = .3;
            pose.offsetY = Math.abs(Math.sin(phase)) * .16;
            pose.head.x = -.18;
            break;
        }
        case 'idle':
        default: {
            const phase = t * 1.6 + seed;
            pose.offsetY = Math.sin(phase) * .022;
            pose.torso.x = Math.sin(phase) * .028;
            pose.shoulderL.x = Math.sin(phase) * .06;
            pose.shoulderR.x = -Math.sin(phase) * .06;
            pose.shoulderL.z = -.09; pose.shoulderR.z = .09;
            pose.head.y = Math.sin(phase * .42) * .16;
            break;
        }
    }

    // Aim pitch + strafe lean apply on top of every state except dead.
    if (state !== 'dead') {
        pose.head.x += aim * .55;
        pose.torso.x += aim * .08;
        pose.lean = clamp(-strafe * MAX_LIVE_LEAN, -MAX_LIVE_LEAN, MAX_LIVE_LEAN);
        pose.torso.z = clamp(pose.torso.z, -MAX_LIVE_TORSO_ROLL, MAX_LIVE_TORSO_ROLL);
        pose.head.z = clamp(pose.head.z, -MAX_LIVE_HEAD_ROLL, MAX_LIVE_HEAD_ROLL);
    }
    return pose;
}

/** Linear blend of two poses; amount 0 → from, 1 → to. */
export function blendPose(from, to, amount) {
    const ratio = clamp(num(amount), 0, 1);
    const out = neutralPose();
    out.offsetY = num(from?.offsetY) + (num(to?.offsetY) - num(from?.offsetY)) * ratio;
    out.lean = num(from?.lean) + (num(to?.lean) - num(from?.lean)) * ratio;
    for (const joint of JOINTS) {
        for (const axis of ['x', 'y', 'z']) {
            const a = num(from?.[joint]?.[axis]);
            const b = num(to?.[joint]?.[axis]);
            out[joint][axis] = a + (b - a) * ratio;
        }
    }
    return out;
}

/** One-shot states hold the rig until progress reaches 1. */
export const ONE_SHOT_STATES = Object.freeze(['throw', 'deflect', 'hit', 'land']);
export const STATE_DURATION = Object.freeze({
    throw: .52, deflect: .34, hit: .38, land: .26
});

/**
 * Pure locomotion picker — chooses the looping state from movement facts.
 * Kept separate so bot/player/replay all classify identically.
 */
export function locomotionState({ speed = 0, grounded = true, verticalSpeed = 0, alive = true } = {}) {
    if (!alive) return 'dead';
    if (!grounded) return num(verticalSpeed) > .4 ? 'jump' : 'fall';
    if (num(speed) > 7.5) return 'run';
    if (num(speed) > .45) return 'walk';
    return 'idle';
}

/**
 * Stateless animator step. Returns the next controller state; callers keep it.
 * ponytail: sınıf yok — saf reducer, hem oyunda hem testte aynı.
 */
export function stepAnimator(controller, dt, facts = {}) {
    const previous = controller && typeof controller === 'object' ? controller : {};
    const step = clamp(num(dt), 0, .25);
    const loco = locomotionState(facts);
    const oneShot = previous.oneShot;
    const elapsed = num(previous.elapsed) + step;
    const time = num(previous.time) + step;

    if (oneShot && isPoseState(oneShot)) {
        const duration = STATE_DURATION[oneShot] || .35;
        if (elapsed < duration) {
            return {
                state: oneShot, oneShot, elapsed, time,
                progress: clamp(elapsed / duration, 0, 1),
                blend: 1, previousState: previous.previousState || loco, seed: num(previous.seed)
            };
        }
    }
    const changed = previous.state !== loco;
    return {
        state: loco,
        oneShot: null,
        elapsed: changed ? 0 : elapsed,
        time,
        progress: loco === 'dead' ? clamp(elapsed / .6, 0, 1) : 0,
        blend: changed ? 0 : clamp(num(previous.blend) + step * 6, 0, 1),
        previousState: changed ? (previous.state || loco) : (previous.previousState || loco),
        seed: num(previous.seed)
    };
}

/** Begin a one-shot action (throw/deflect/hit/land). Returns new controller state. */
export function triggerAction(controller, action) {
    if (!ONE_SHOT_STATES.includes(action)) return controller;
    const previous = controller && typeof controller === 'object' ? controller : {};
    return {
        ...previous,
        state: action,
        oneShot: action,
        elapsed: 0,
        progress: 0,
        blend: 0,
        previousState: previous.state || 'idle',
        seed: num(previous.seed),
        time: num(previous.time)
    };
}

export function createAnimatorState(seed = 0) {
    return {
        state: 'idle', oneShot: null, elapsed: 0, time: 0,
        progress: 0, blend: 1, previousState: 'idle', seed: num(seed) % TAU
    };
}

/** Final pose for a controller state, with cross-fade from the previous state. */
export function resolvePose(controller, facts = {}) {
    const state = controller?.state || 'idle';
    const target = poseFor(state, num(controller?.time), {
        ...facts, progress: num(controller?.progress), seed: num(controller?.seed)
    });
    const blend = clamp(num(controller?.blend, 1), 0, 1);
    if (blend >= 1 || !controller?.previousState || controller.previousState === state) return target;
    const from = poseFor(controller.previousState, num(controller.time), {
        ...facts, progress: 1, seed: num(controller?.seed)
    });
    return blendPose(from, target, blend);
}
