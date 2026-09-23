const ACTIONS = Object.freeze(['idle', 'draw', 'slash', 'stab', 'heavy', 'inspect', 'twirl']);

export const KNIFE_ACTION_DURATIONS = Object.freeze({
    idle: Infinity,
    draw: 0.62,
    slash: 0.38,
    stab: 0.42,
    heavy: 0.48,
    inspect: 1.65,
    rareInspect: 2.35,
    // Quick flourish on R: short enough to spam, chains seamlessly (ends on rest).
    twirl: 0.62
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const smooth = value => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};
const pulse = value => Math.sin(clamp01(value) * Math.PI);
const lerp = (a, b, t) => a + (b - a) * t;
const setLerpDelta = (out, a, b, t) => {
    out.x = lerp(a.x, b.x, t);
    out.y = lerp(a.y, b.y, t);
    out.z = lerp(a.z, b.z, t);
};

// ---------------------------------------------------------------------------
// Keyframed choreography (CS2-style): every action is a list of keys
//   [t, armX, armY, armZ, armRotX, armRotY, armRotZ, knifeRotX, knifeRotY, knifeRotZ, knifeX, knifeY, knifeZ]
// holding deltas from the rest pose. Catmull-Rom through the keys gives C1-smooth
// motion: anticipation, fast action, overshoot and settle come from where keys sit,
// not from stacked sine pulses. Every track starts and ends at rest.
const K = 13;
const ZERO_KEY = Object.freeze(new Array(K - 1).fill(0));
const key = (t, arm = [0, 0, 0], armRot = [0, 0, 0], knifeRot = [0, 0, 0], knife = [0, 0, 0]) =>
    Object.freeze([t, ...arm, ...armRot, ...knifeRot, ...knife]);
const rest = t => Object.freeze([t, ...ZERO_KEY]);

export const KNIFE_TRACKS = Object.freeze({
    draw: Object.freeze([
        key(0, [0.2, -0.36, 0.18], [0.75, -0.25, 0.35], [0.25, 1.15, -0.85]),
        key(0.38, [-0.012, 0.016, -0.014], [-0.07, 0.04, -0.04], [-0.06, -0.12, 0.1]),
        key(0.62, [0.005, -0.005, 0.005], [0.022, -0.012, 0.012], [0.02, 0.035, -0.025]),
        rest(1)
    ]),
    slash: Object.freeze([
        rest(0),
        key(0.18, [0.06, 0.045, 0.045], [0.14, -0.12, -0.2], [0.1, 0.16, -0.38]),
        key(0.42, [-0.1, -0.03, -0.2], [-0.58, 0.3, 0.36], [-0.36, -0.22, 1.28]),
        key(0.62, [-0.14, -0.06, -0.14], [-0.42, 0.36, 0.42], [-0.26, -0.26, 1.08]),
        key(0.82, [-0.03, -0.015, -0.03], [-0.08, 0.06, 0.06], [-0.04, -0.04, 0.16]),
        rest(1)
    ]),
    stab: Object.freeze([
        rest(0),
        key(0.16, [0.035, -0.02, 0.07], [0.1, 0, 0], [0.08, 0, 0.05]),
        key(0.34, [-0.1, 0.05, -0.4], [-0.12, 0.08, 0], [0.2, 0, 0.3]),
        key(0.5, [-0.098, 0.048, -0.385], [-0.11, 0.075, 0], [0.19, 0, 0.29]),
        key(0.78, [-0.02, 0.01, -0.06], [-0.02, 0.015, 0], [0.03, 0, 0.05]),
        rest(1)
    ]),
    heavy: Object.freeze([
        rest(0),
        key(0.18, [0.06, -0.035, 0.11], [0.16, -0.04, 0.02], [0.14, 0.02, 0.08]),
        key(0.34, [-0.13, 0.06, -0.52], [-0.18, 0.1, 0], [0.24, 0, 0.36]),
        key(0.5, [-0.128, 0.058, -0.5], [-0.17, 0.095, 0], [0.23, 0, 0.35]),
        key(0.8, [-0.025, 0.012, -0.08], [-0.03, 0.02, 0], [0.04, 0, 0.06]),
        rest(1)
    ]),
    // Show the left face, flip, show the right face, settle back.
    inspect: Object.freeze([
        rest(0),
        key(0.14, [-0.13, 0.07, 0.1], [-0.1, 0.26, 0.1], [0.48, 0.36, 0.62]),
        key(0.4, [-0.16, 0.085, 0.12], [-0.14, 0.32, 0.12], [0.52, 0.46, 0.76]),
        key(0.5, [-0.155, 0.09, 0.12], [-0.13, 0.3, 0.12], [0.48, 0.42, 0.76 + Math.PI * 0.55]),
        key(0.58, [-0.15, 0.085, 0.12], [-0.12, 0.28, 0.11], [0.44, 0.38, 0.76 + Math.PI]),
        key(0.8, [-0.12, 0.07, 0.1], [-0.08, 0.22, 0.08], [0.3, 0.58, 0.7 + Math.PI]),
        key(0.92, [-0.02, 0.012, 0.015], [-0.015, 0.035, 0.012], [0.04, 0.08, Math.PI * 2 - 0.02]),
        key(1, [0, 0, 0], [0, 0, 0], [0, 0, Math.PI * 2])
    ]),
    // Blade-edge look: tip toward the camera, slow tilt along the edge.
    inspectEdge: Object.freeze([
        rest(0),
        key(0.16, [-0.08, 0.1, 0.12], [-0.3, 0.2, 0.05], [1.05, 0.3, 0.2]),
        key(0.45, [-0.09, 0.11, 0.13], [-0.34, 0.25, 0.08], [1.15, 0.55, 0.35]),
        key(0.7, [-0.07, 0.09, 0.11], [-0.28, 0.15, 0.04], [0.95, -0.2, 0.15]),
        key(0.88, [-0.015, 0.02, 0.02], [-0.05, 0.03, 0.01], [0.15, -0.04, 0.03]),
        rest(1)
    ]),
    twirl: Object.freeze([
        rest(0),
        key(0.12, [0.01, -0.012, 0.012], [0.05, -0.03, 0], [0.05, -0.25, 0]),
        key(0.3, [-0.02, 0.03, 0.01], [-0.06, 0.05, 0.02], [0.08, Math.PI * 0.75, 0.1]),
        key(0.6, [-0.025, 0.035, 0.012], [-0.07, 0.06, 0.02], [0.06, Math.PI * 1.55, 0.08]),
        key(0.82, [-0.006, 0.006, 0.003], [-0.012, 0.01, 0.004], [0.01, Math.PI * 2 + 0.06, 0.01]),
        key(1, [0, 0, 0], [0, 0, 0], [0, Math.PI * 2, 0])
    ]),
    // Rare: toss it up, two tumbles, catch with a dip.
    inspectRare: Object.freeze([
        rest(0),
        key(0.12, [-0.06, -0.03, 0.05], [0.12, 0.1, 0], [0.1, 0.2, 0.2]),
        key(0.3, [-0.1, 0.12, 0.04], [-0.25, 0.18, 0.05], [Math.PI * 1.3, 0.25, 0.35], [0, 0.16, 0]),
        key(0.5, [-0.1, 0.16, 0.04], [-0.3, 0.2, 0.05], [Math.PI * 2.6, 0.3, 0.4], [0, 0.26, 0]),
        key(0.68, [-0.09, 0.02, 0.05], [-0.1, 0.16, 0.04], [Math.PI * 4 - 0.1, 0.25, 0.3], [0, 0.02, 0]),
        key(0.76, [-0.09, -0.02, 0.05], [0.06, 0.14, 0.03], [Math.PI * 4 + 0.08, 0.22, 0.28]),
        key(0.9, [-0.02, 0, 0.01], [0.01, 0.03, 0.005], [Math.PI * 4, 0.05, 0.05]),
        key(1, [0, 0, 0], [0, 0, 0], [Math.PI * 4, 0, 0])
    ])
});

// Allocation-free Catmull-Rom sample of a track into `out` (length K-1).
export function sampleKnifeTrack(track, progress, out) {
    const t = clamp01(progress);
    let index = 0;
    while (index < track.length - 2 && t > track[index + 1][0]) index++;
    const a = track[index];
    const b = track[Math.min(index + 1, track.length - 1)];
    const span = b[0] - a[0];
    const u = span > 0 ? clamp01((t - a[0]) / span) : 1;
    const p0 = track[Math.max(0, index - 1)];
    const p3 = track[Math.min(track.length - 1, index + 2)];
    const u2 = u * u;
    const u3 = u2 * u;
    for (let c = 1; c < K; c++) {
        const v0 = p0[c], v1 = a[c], v2 = b[c], v3 = p3[c];
        out[c - 1] = 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 + (-v0 + 3 * v1 - 3 * v2 + v3) * u3);
    }
    return out;
}

const TWIRL_IN_PLACE = Object.freeze({
    twirlParts: Object.freeze([
        rest(0),
        key(0.2, [0, 0.015, 0], [-0.04, 0.03, 0], [0.04, 0.08, 0.06]),
        key(0.8, [0, 0.015, 0], [-0.04, 0.03, 0], [0.04, 0.08, 0.06]),
        rest(1)
    ])
});

function trackFor(action, variant, model) {
    if (action === 'twirl') {
        return model === 'butterfly' || model === 'karambit' || model === 'talon'
            ? TWIRL_IN_PLACE.twirlParts
            : KNIFE_TRACKS.twirl;
    }
    if (action === 'inspect') {
        if (variant === 'rare') return KNIFE_TRACKS.inspectRare;
        if (variant === 'edge') return KNIFE_TRACKS.inspectEdge;
        return KNIFE_TRACKS.inspect;
    }
    return KNIFE_TRACKS[action] || null;
}

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
export const VIEWMODEL_BASE_POSITION = Object.freeze([0.035, -0.065, -0.49]);
export const VIEWMODEL_BASE_ROTATION = Object.freeze([-0.13, 0.24, -0.28]);

// Per-item correction so each silhouette frames consistently in the cramped first-person
// frustum AND so its handle sits inside the fist instead of intersecting it. `z` is the
// dominant term: it is (0.36 - handleCentreLocalZ) for each model, i.e. how far the item must
// be pushed forward for its grip — not its pommel — to be the part the hand closes around.
// `scale` is applied once on equip (js/player.js _syncViewmodelWeapon), never per frame.
export const MODEL_FRAME_OFFSET = Object.freeze({
    classic: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    bayonet: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
    // Rolled ~90° so the crescent hooks down and forward from the fist, CS-style.
    karambit: { position: [-0.02, -0.01, 0.05], rotation: [0.1, -0.05, -1.35], scale: 1 },
    butterfly: { position: [0.015, -0.01, 0.02], rotation: [0, 0.03, 0], scale: 1 },
    tanto: { position: [0, 0.005, 0.02], rotation: [0, 0, 0], scale: 1 },
    cleaver: { position: [0, 0.01, 0.06], rotation: [0, 0, -0.06], scale: 0.95 },
    dagger: { position: [0, 0, 0], rotation: [0, 0.02, 0], scale: 1 },
    kukri: { position: [0, 0, 0.02], rotation: [0, 0, -0.04], scale: 0.96 },
    gut: { position: [0, 0, 0.01], rotation: [0, 0.02, 0], scale: 1 },
    huntsman: { position: [0, 0, 0.02], rotation: [0, 0, 0], scale: 0.95 },
    talon: { position: [-0.02, -0.01, 0.04], rotation: [0.08, -0.04, -1.3], scale: 1 },
    flip: { position: [0, 0, 0.01], rotation: [0, 0.02, 0], scale: 1 },
    // Not a knife and never animated by resolveKnifePose, but it is a held item and shares the
    // same fist, so it lives in the same table (js/player.js reads it via viewmodelFrame).
    rocket: { position: [-0.06, 0.16, 0.09], rotation: [-0.04, -0.34, 0.38], scale: 0.62 }
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
const KARAMBIT_REST = Object.freeze({ x: -0.14, y: 0.04, z: 0.06 });
const ZERO_DELTA = Object.freeze({ x: 0, y: 0, z: 0 });

// Delta triples for butterfly's [left, right, bladeRoot] inspectParts. (0,0,0) everywhere is the
// authored closed/rest silhouette (blade folded back between the rails).
function setButterflyParts(parts, leftZ, rightZ, bladeY, bladeZ = 0) {
    parts[0].x = 0; parts[0].y = 0; parts[0].z = leftZ;
    parts[1].x = 0; parts[1].y = 0; parts[1].z = rightZ;
    parts[2].x = 0; parts[2].y = bladeY; parts[2].z = bladeZ;
}

const isHookModel = model => model === 'karambit' || model === 'hook' || model === 'talon';

export function knifeAnimationActionForAttack(action) {
    return action === 'stab' || action === 'heavy' ? 'heavy' : 'slash';
}

function createPose(model, frame) {
    const parts = model === 'butterfly'
        ? [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
        : isHookModel(model) ? [{ x: 0, y: 0, z: 0 }] : [0, 0, 0];
    return {
        armPosition: [0, 0, 0], armRotation: [0, 0, 0],
        knifePosition: [...frame.position], knifeRotation: [...frame.rotation],
        parts, action: 'draw', progress: 0, variant: 'standard',
        _track: new Float64Array(K - 1)
    };
}

export function createKnifeAnimationState(model = 'classic') {
    const resolvedModel = typeof model === 'string' ? model : 'classic';
    const frame = viewmodelFrame(resolvedModel);
    return {
        model: resolvedModel,
        action: 'draw',
        elapsed: 0,
        duration: KNIFE_ACTION_DURATIONS.draw,
        variant: 'standard',
        _frame: frame,
        _pose: createPose(resolvedModel, frame)
    };
}

export function startKnifeAnimation(state, action, random = Math.random) {
    const nextAction = ACTIONS.includes(action) ? action : 'idle';
    if (nextAction === 'twirl' && state.action === 'twirl') {
        state._twirlQueued = true;
        return state;
    }
    state._twirlQueued = false;
    const rare = nextAction === 'inspect' && Number(random?.()) < 0.035;
    state.action = nextAction;
    state.elapsed = 0;
    // Inspect alternates face-flip and edge-look so repeated presses stay fresh.
    if (nextAction === 'inspect' && !rare) state._inspectCount = (Number(state._inspectCount) || 0) + 1;
    state.variant = rare ? 'rare'
        : nextAction === 'inspect' && state._inspectCount % 2 === 0 ? 'edge' : 'standard';
    state.duration = rare
        ? KNIFE_ACTION_DURATIONS.rareInspect
        : KNIFE_ACTION_DURATIONS[nextAction];
    if (nextAction === 'draw' && state.model === 'butterfly') state.duration += 0.22;
    return state;
}

export function stepKnifeAnimation(state, dt) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    state.clock = (Number(state.clock) || 0) + step;
    if (Number.isFinite(state.duration)) {
        state.elapsed += step;
        if (state.elapsed >= state.duration) {
            if (state.action === 'twirl' && state._twirlQueued) {
                // Chain: twirl ends on rest, so the next one starts seamlessly.
                state._twirlQueued = false;
                state.elapsed -= state.duration;
                return state;
            }
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
    const frame = state?._frame || viewmodelFrame(model);
    const pose = state?._pose || createPose(model, frame);
    // Idle breathing: tiny, slow, and scaled like the gait bob under reduced motion.
    const breathScale = context.reduceMotion === true ? 0.25 : 1;
    const breath = state?.action === 'idle'
        ? Math.sin((Number(state?.clock) || 0) * 1.7) * 0.0022 * breathScale
        : 0;
    pose.armPosition[0] = 0.25 + swayX * 0.025;
    pose.armPosition[1] = -0.3 + bob + landingOffset - swayY * 0.018 + breath;
    pose.armPosition[2] = -0.3;
    pose.armRotation[0] = -swayY * 0.035 + breath * 1.4;
    pose.armRotation[1] = -swayX * 0.05;
    pose.armRotation[2] = swayX * 0.025;
    for (let index = 0; index < 3; index++) {
        pose.knifePosition[index] = frame.position[index];
        pose.knifeRotation[index] = frame.rotation[index];
    }
    pose.action = action;
    pose.progress = progress;
    pose.variant = state?.variant === 'rare' ? 'rare' : state?.variant === 'edge' ? 'edge' : 'standard';
    const track = trackFor(action, pose.variant, model);
    if (track) {
        const d = sampleKnifeTrack(track, progress, pose._track || (pose._track = new Float64Array(K - 1)));
        pose.armPosition[0] += d[0]; pose.armPosition[1] += d[1]; pose.armPosition[2] += d[2];
        pose.armRotation[0] += d[3]; pose.armRotation[1] += d[4]; pose.armRotation[2] += d[5];
        pose.knifeRotation[0] += d[6]; pose.knifeRotation[1] += d[7]; pose.knifeRotation[2] += d[8];
        pose.knifePosition[0] += d[9]; pose.knifePosition[1] += d[10]; pose.knifePosition[2] += d[11];
    }

    // Rest baseline: closed/tucked silhouette for the two folding models. Action branches below
    // animate away from this and (except idle itself) settle back onto it by progress 1, matching
    // the same start==end-at-baseline convention the arm/knife transforms above already use.
    if (model === 'butterfly') setButterflyParts(pose.parts, 0, 0, 0, 0);
    else if (isHookModel(model)) {
        pose.parts[0].x = KARAMBIT_REST.x;
        pose.parts[0].y = KARAMBIT_REST.y;
        pose.parts[0].z = KARAMBIT_REST.z;
    }

    if (action === 'draw') {
        const settle = smooth(progress);
        if (model === 'butterfly') {
            // Draw presents the blade open, then folds it closed into the resting grip by the end.
            const openAmt = 1 - settle;
            setButterflyParts(pose.parts,
                -1.8 * openAmt,
                1.8 * openAmt,
                -Math.PI * openAmt,
                Math.sin(progress * Math.PI * 2) * 0.3 * openAmt
            );
        } else if (isHookModel(model)) {
            const combatAmt = snapEnvelope(progress, 0.18, 0.55);
            setLerpDelta(pose.parts[0], KARAMBIT_REST, ZERO_DELTA, combatAmt);
        }
    } else if (action === 'slash') {
        if (model === 'butterfly') {
            const openAmt = pulse(progress);
            setButterflyParts(pose.parts, 0, 0, -Math.PI * openAmt, 0);
        } else if (isHookModel(model)) {
            const combatAmt = snapEnvelope(progress, 0.12, 0.3);
            setLerpDelta(pose.parts[0], KARAMBIT_REST, ZERO_DELTA, combatAmt);
        }
    } else if (action === 'stab' || action === 'heavy') {
        if (model === 'butterfly') {
            const openAmt = pulse(progress);
            setButterflyParts(pose.parts, 0, 0, -Math.PI * openAmt, 0);
        } else if (isHookModel(model)) {
            const combatAmt = snapEnvelope(progress, 0.15, 0.4);
            setLerpDelta(pose.parts[0], KARAMBIT_REST, ZERO_DELTA, combatAmt);
            pose.knifeRotation[2] -= pulse(progress) * .48;
        }
    } else if (action === 'twirl') {
        const eased = smooth(progress);
        if (model === 'butterfly') {
            // Two quick open/close flips of the handles around the pivot.
            const flip = Math.sin(eased * Math.PI * 4);
            setButterflyParts(pose.parts, -flip * 1.9, flip * 1.9, -Math.PI * pulse(progress), flip * 0.4);
        } else if (isHookModel(model)) {
            // Two full spins around the ring finger.
            pose.parts[0].x = KARAMBIT_REST.x + eased * Math.PI * 4;
            pose.parts[0].y = KARAMBIT_REST.y;
            pose.parts[0].z = KARAMBIT_REST.z;
        }
    } else if (action === 'inspect') {
        const turns = pose.variant === 'rare' ? 4 : 2;
        if (model === 'butterfly') {
            // Flourish: open -> spin -> closed, ending back on the resting silhouette.
            const flip = Math.sin(progress * Math.PI * turns);
            const openAmt = pulse(progress);
            setButterflyParts(pose.parts, -flip * 1.75, flip * 1.75, -Math.PI * openAmt, flip * 0.6);
        } else if (isHookModel(model)) {
            // Continuous multi-turn roll around the ring. Adding whole turns (2*PI*turns, turns an
            // integer) is periodic, so progress===1 lands visually back on KARAMBIT_REST even though
            // the numeric value keeps accumulating — satisfies both "completes a full rotation" and
            // the same start/end-at-rest continuity every other action uses.
            pose.parts[0].x = KARAMBIT_REST.x + progress * Math.PI * 2 * turns;
            pose.parts[0].y = KARAMBIT_REST.y + Math.sin(progress * Math.PI * turns) * 0.4;
            pose.parts[0].z = KARAMBIT_REST.z;
        }
    }
    return pose;
}
