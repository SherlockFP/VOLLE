const ACTIONS = Object.freeze(['idle', 'draw', 'slash', 'stab', 'inspect']);

export const KNIFE_ACTION_DURATIONS = Object.freeze({
    idle: Infinity,
    draw: 0.62,
    slash: 0.34,
    stab: 0.42,
    inspect: 1.65,
    rareInspect: 2.35
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const smooth = value => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};
const pulse = value => Math.sin(clamp01(value) * Math.PI);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpDelta = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

const GAIT_START_RESPONSE = 14;
const GAIT_STOP_RESPONSE = 8;
const GAIT_SPEED_RESPONSE = 10;
const GAIT_PHASE_BASE_RATE = 5;
const GAIT_PHASE_SPEED_RATE = 0.35;
export const VIEWMODEL_LANDING_IMPACT_SPEED = 4;
export const VIEWMODEL_LANDING_DURATION = 0.18;
const VIEWMODEL_LANDING_MIN_DEPTH = 0.002;
const VIEWMODEL_LANDING_MID_DEPTH = 0.004;
const VIEWMODEL_LANDING_MAX_DEPTH = 0.006;

// Mutates a persistent gait state so Player.update does not allocate on the render path.
// The phase is deliberately integrated (rather than derived from wall-clock time): changing
// speed never resets or reverses the cycle, and exponential smoothing is frame-rate stable.
export function advanceViewmodelGait(gait, dt, speed = 0, onGround = false, dashActive = false) {
    if (!gait || typeof gait !== 'object') return gait;
    const step = clamp(dt, 0, 0.1);
    const safeSpeed = clamp(speed, 0, 16);
    const moving = onGround && !dashActive && safeSpeed > 0.2;
    const gaitSpeed = dashActive ? 0 : safeSpeed;
    const targetWeight = moving ? 1 : 0;
    const response = targetWeight > (Number(gait.weight) || 0) ? GAIT_START_RESPONSE : GAIT_STOP_RESPONSE;
    const alpha = 1 - Math.exp(-response * step);
    gait.weight = clamp01((Number(gait.weight) || 0) + (targetWeight - (Number(gait.weight) || 0)) * alpha);
    const speedAlpha = 1 - Math.exp(-GAIT_SPEED_RESPONSE * step);
    gait.speed = clamp((Number(gait.speed) || 0) + (gaitSpeed - (Number(gait.speed) || 0)) * speedAlpha, 0, 16);
    gait.phase = (Number.isFinite(gait.phase) ? gait.phase : 0)
        + (GAIT_PHASE_BASE_RATE + gaitSpeed * GAIT_PHASE_SPEED_RATE) * step;
    return gait;
}

export function resolveViewmodelGaitBob(phase = 0, weight = 0, speed = 0, reduceMotion = false) {
    const gaitPhase = Number(phase);
    if (!Number.isFinite(gaitPhase)) return 0;
    const gaitWeight = clamp01(weight);
    const gaitSpeed = clamp(speed, 0, 16);
    const amplitude = gaitSpeed <= 10
        ? 0.006 + gaitSpeed * 0.0004
        : 0.01 + (gaitSpeed - 10) * (0.004 / 3);
    const motionScale = reduceMotion ? 0.25 : 1;
    return Math.sin(gaitPhase) * Math.min(0.014, amplitude) * gaitWeight * motionScale;
}

export function triggerViewmodelLanding(landing, impactSpeed = 0, scale = 1) {
    if (!landing || landing.active || Number(impactSpeed) < VIEWMODEL_LANDING_IMPACT_SPEED) return false;
    const impact = clamp(impactSpeed, VIEWMODEL_LANDING_IMPACT_SPEED, 12);
    const depth = impact <= 8
        ? VIEWMODEL_LANDING_MIN_DEPTH + (impact - VIEWMODEL_LANDING_IMPACT_SPEED) * 0.0005
        : VIEWMODEL_LANDING_MID_DEPTH + (impact - 8) * 0.0005;
    landing.active = true;
    landing.elapsed = 0;
    landing.offset = 0;
    landing.depth = Math.min(VIEWMODEL_LANDING_MAX_DEPTH, depth) * clamp01(scale);
    return true;
}

export function resolveViewmodelLandingOffset(elapsed = 0, depth = 0, reduceMotion = false) {
    const time = clamp(elapsed, 0, VIEWMODEL_LANDING_DURATION);
    if (time === 0 || time >= VIEWMODEL_LANDING_DURATION) return 0;
    return -clamp(depth, 0, VIEWMODEL_LANDING_MAX_DEPTH)
        * Math.sin(Math.PI * time / VIEWMODEL_LANDING_DURATION)
        * (reduceMotion ? 0.25 : 1);
}

export function advanceViewmodelLanding(landing, dt, reduceMotion = false) {
    if (!landing?.active) return 0;
    landing.elapsed = Math.min(VIEWMODEL_LANDING_DURATION, (Number(landing.elapsed) || 0) + clamp(dt, 0, 0.1));
    landing.offset = resolveViewmodelLandingOffset(landing.elapsed, landing.depth, reduceMotion);
    if (landing.elapsed >= VIEWMODEL_LANDING_DURATION) {
        landing.active = false;
        landing.elapsed = 0;
        landing.offset = 0;
        landing.depth = 0;
    }
    return landing.offset;
}

// Quick rise to `1` by `riseEnd`, holds until `fallStart`, eases back to `0` by progress 1.
// Used to make karambit deployment read as a sharp snap rather than butterfly's slow unfold.
const snapEnvelope = (progress, riseEnd, fallStart) => {
    const t = clamp01(progress);
    if (t <= riseEnd) return smooth(t / riseEnd);
    if (t >= fallStart) return smooth(1 - (t - fallStart) / (1 - fallStart));
    return 1;
};

// The one grip pose every held item is framed against: the point in armGroup space where the
// Roblox-style fist (js/player.js buildHandMesh) closes. An item's own grip must land here, so
// each model's frame offset below is the delta that pulls ITS handle centre onto this point.
export const VIEWMODEL_BASE_POSITION = Object.freeze([0.08, -0.12, -0.58]);
export const VIEWMODEL_BASE_ROTATION = Object.freeze([-0.08, 0.18, -0.34]);

// Per-item correction so each silhouette frames consistently in the cramped first-person
// frustum AND so its handle sits inside the fist instead of intersecting it. `z` is the
// dominant term: it is (0.36 - handleCentreLocalZ) for each model, i.e. how far the item must
// be pushed forward for its grip — not its pommel — to be the part the hand closes around.
// `scale` is applied once on equip (js/player.js _syncViewmodelWeapon), never per frame.
export const MODEL_FRAME_OFFSET = Object.freeze({
    classic: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    bayonet: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    karambit: { position: [-0.03, 0.02, 0.06], rotation: [0.08, -0.05, 0], scale: 1 },
    butterfly: { position: [0.015, -0.01, 0.02], rotation: [0, 0.03, 0], scale: 1 },
    tanto: { position: [0, 0.005, 0.02], rotation: [0, 0, 0], scale: 1 },
    cleaver: { position: [0, 0.01, 0.06], rotation: [0, 0, -0.06], scale: 0.95 },
    dagger: { position: [0, 0, 0], rotation: [0, 0.02, 0], scale: 1 },
    // Not a knife and never animated by resolveKnifePose, but it is a held item and shares the
    // same fist, so it lives in the same table (js/player.js reads it via viewmodelFrame).
    rocket: { position: [-0.06, 0.16, 0.19], rotation: [-0.04, -0.34, 0.38], scale: 0.62 }
});

// Absolute rest transform for a held item id. Single source of truth for "where does this thing
// sit in the hand" — used by resolveKnifePose for knives and directly by player.js on equip.
export function viewmodelFrame(model) {
    const frame = MODEL_FRAME_OFFSET[model] || MODEL_FRAME_OFFSET.classic;
    return {
        position: VIEWMODEL_BASE_POSITION.map((value, index) => value + frame.position[index]),
        rotation: VIEWMODEL_BASE_ROTATION.map((value, index) => value + frame.rotation[index]),
        scale: frame.scale
    };
}

// Rest/idle delta applied to the claw (group.userData.inspectParts[0]) — tucks the ring/point
// back along the fist. Delta (0,0,0) is the authored "combat-ready" look (point-down, ring
// forward), so every karambit action animates between this and zero.
// Kept modest: the claw's ring (radius 0.205) and point (~0.29 units off the rotation pivot) sweep
// a wide arc per radian, so anything much larger visibly tears the ring/point away from the fist.
const KARAMBIT_REST = Object.freeze({ x: -0.42, y: 0.1, z: 0.16 });

// Delta triples for butterfly's [left, right, bladeRoot] inspectParts. (0,0,0) everywhere is the
// authored closed/rest silhouette (blade folded back between the rails).
function butterflyParts(leftZ, rightZ, bladeY, bladeZ = 0) {
    return [
        { x: 0, y: 0, z: leftZ },
        { x: 0, y: 0, z: rightZ },
        { x: 0, y: bladeY, z: bladeZ }
    ];
}

export function createKnifeAnimationState(model = 'classic') {
    return {
        model: typeof model === 'string' ? model : 'classic',
        action: 'draw',
        elapsed: 0,
        duration: KNIFE_ACTION_DURATIONS.draw,
        variant: 'standard'
    };
}

export function startKnifeAnimation(state, action, random = Math.random) {
    const nextAction = ACTIONS.includes(action) ? action : 'idle';
    const rare = nextAction === 'inspect' && Number(random?.()) < 0.035;
    state.action = nextAction;
    state.elapsed = 0;
    state.variant = rare ? 'rare' : 'standard';
    state.duration = rare
        ? KNIFE_ACTION_DURATIONS.rareInspect
        : KNIFE_ACTION_DURATIONS[nextAction];
    if (nextAction === 'draw' && state.model === 'butterfly') state.duration += 0.22;
    return state;
}

export function stepKnifeAnimation(state, dt) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    if (Number.isFinite(state.duration)) {
        state.elapsed += step;
        if (state.elapsed >= state.duration) {
            state.action = 'idle';
            state.elapsed = 0;
            state.duration = Infinity;
            state.variant = 'standard';
        }
    }
    return state;
}

export function resolveKnifePose(state, context = {}) {
    const action = ACTIONS.includes(state?.action) ? state.action : 'idle';
    const duration = Number.isFinite(state?.duration) && state.duration > 0 ? state.duration : 1;
    const progress = clamp01((Number(state?.elapsed) || 0) / duration);
    const swayX = Math.max(-1, Math.min(1, Number(context.swayX) || 0));
    const swayY = Math.max(-1, Math.min(1, Number(context.swayY) || 0));
    const bob = resolveViewmodelGaitBob(
        context.gaitPhase,
        context.gaitWeight,
        context.gaitSpeed,
        context.reduceMotion === true
    );
    const landingOffset = resolveViewmodelLandingOffset(
        context.landingElapsed,
        context.landingDepth,
        context.reduceMotion === true
    );
    const model = state?.model;
    const frame = viewmodelFrame(model);
    const pose = {
        armPosition: [0.25 + swayX * 0.025, -0.3 + bob + landingOffset - swayY * 0.018, -0.3],
        armRotation: [-swayY * 0.035, -swayX * 0.05, swayX * 0.025],
        knifePosition: frame.position,
        knifeRotation: frame.rotation,
        parts: [0, 0, 0],
        action,
        progress,
        variant: state?.variant === 'rare' ? 'rare' : 'standard'
    };

    // Rest baseline: closed/tucked silhouette for the two folding models. Action branches below
    // animate away from this and (except idle itself) settle back onto it by progress 1, matching
    // the same start==end-at-baseline convention the arm/knife transforms above already use.
    if (model === 'butterfly') pose.parts = butterflyParts(0, 0, 0, 0);
    else if (model === 'karambit') pose.parts = [{ ...KARAMBIT_REST }];

    if (action === 'draw') {
        const settle = smooth(progress);
        pose.armPosition[0] += (1 - settle) * 0.3;
        pose.armPosition[1] -= (1 - settle) * 0.38;
        pose.armPosition[2] += (1 - settle) * 0.24;
        pose.armRotation[0] += (1 - settle) * 0.75 - pulse(progress) * 0.12;
        pose.knifeRotation[1] += (1 - settle) * 1.1;
        pose.knifeRotation[2] -= (1 - settle) * 0.75;
        if (model === 'butterfly') {
            // Draw presents the blade open, then folds it closed into the resting grip by the end.
            const openAmt = 1 - settle;
            pose.parts = butterflyParts(
                -1.8 * openAmt,
                1.8 * openAmt,
                -Math.PI * openAmt,
                Math.sin(progress * Math.PI * 2) * 0.3 * openAmt
            );
        } else if (model === 'karambit') {
            const combatAmt = snapEnvelope(progress, 0.18, 0.55);
            pose.parts = [lerpDelta(KARAMBIT_REST, { x: 0, y: 0, z: 0 }, combatAmt)];
        }
    } else if (action === 'slash') {
        const windup = progress < 0.22 ? smooth(progress / 0.22) : 1;
        const cut = progress < 0.22 ? 0 : smooth((progress - 0.22) / 0.48);
        const recover = progress < 0.7 ? 0 : smooth((progress - 0.7) / 0.3);
        const force = windup - cut + recover;
        pose.armPosition[0] += 0.08 * force;
        pose.armPosition[2] -= 0.24 * pulse(progress);
        pose.armRotation[0] -= 0.68 * pulse(progress);
        pose.armRotation[2] += 0.32 * force;
        pose.knifeRotation[0] -= 0.38 * pulse(progress);
        pose.knifeRotation[2] += 1.45 * (cut - recover * 0.7) - 0.3 * windup;
        if (model === 'butterfly') {
            const openAmt = pulse(progress);
            pose.parts = butterflyParts(0, 0, -Math.PI * openAmt, 0);
        } else if (model === 'karambit') {
            const combatAmt = snapEnvelope(progress, 0.12, 0.3);
            pose.parts = [lerpDelta(KARAMBIT_REST, { x: 0, y: 0, z: 0 }, combatAmt)];
        }
    } else if (action === 'stab') {
        const thrust = progress < 0.42 ? smooth(progress / 0.42) : 1 - smooth((progress - 0.42) / 0.58);
        pose.armPosition[0] -= 0.12 * thrust;
        pose.armPosition[1] += 0.05 * thrust;
        pose.armPosition[2] -= 0.43 * thrust;
        pose.armRotation[0] += 0.18 * thrust;
        pose.knifeRotation[0] += 0.2 * thrust;
        pose.knifeRotation[2] += 0.32 * thrust;
        if (model === 'butterfly') {
            const openAmt = pulse(progress);
            pose.parts = butterflyParts(0, 0, -Math.PI * openAmt, 0);
        } else if (model === 'karambit') {
            const combatAmt = snapEnvelope(progress, 0.15, 0.4);
            pose.parts = [lerpDelta(KARAMBIT_REST, { x: 0, y: 0, z: 0 }, combatAmt)];
        }
    } else if (action === 'inspect') {
        const reveal = pulse(progress);
        const turns = pose.variant === 'rare' ? 4 : 2;
        pose.armPosition[0] -= 0.18 * reveal;
        pose.armPosition[1] -= 0.08 * reveal;
        pose.armPosition[2] += 0.14 * reveal;
        pose.armRotation[0] -= 0.26 * reveal;
        pose.armRotation[1] += 0.2 * reveal;
        pose.knifeRotation[0] += 0.55 * reveal;
        pose.knifeRotation[1] += Math.sin(progress * Math.PI * turns) * (pose.variant === 'rare' ? 1.4 : 0.82);
        pose.knifeRotation[2] += Math.sin(progress * Math.PI * 2) * 0.72;
        if (model === 'butterfly') {
            // Flourish: open -> spin -> closed, ending back on the resting silhouette.
            const flip = Math.sin(progress * Math.PI * turns);
            const openAmt = pulse(progress);
            pose.parts = butterflyParts(-flip * 1.75, flip * 1.75, -Math.PI * openAmt, flip * 0.6);
        } else if (model === 'karambit') {
            // Continuous multi-turn roll around the ring. Adding whole turns (2*PI*turns, turns an
            // integer) is periodic, so progress===1 lands visually back on KARAMBIT_REST even though
            // the numeric value keeps accumulating — satisfies both "completes a full rotation" and
            // the same start/end-at-rest continuity every other action uses.
            pose.parts = [{
                x: KARAMBIT_REST.x + progress * Math.PI * 2 * turns,
                y: KARAMBIT_REST.y + Math.sin(progress * Math.PI * turns) * 0.4,
                z: KARAMBIT_REST.z
            }];
        }
    }
    return pose;
}
