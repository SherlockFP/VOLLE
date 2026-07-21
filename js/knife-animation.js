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
const smooth = value => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};
const pulse = value => Math.sin(clamp01(value) * Math.PI);

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
    const time = Number(context.time) || 0;
    const speed = Math.max(0, Math.min(1, (Number(context.speed) || 0) / 12));
    const swayX = Math.max(-1, Math.min(1, Number(context.swayX) || 0));
    const swayY = Math.max(-1, Math.min(1, Number(context.swayY) || 0));
    const bob = Math.sin(time * (7 + speed * 5)) * (0.006 + speed * 0.016);
    const pose = {
        armPosition: [0.25 + swayX * 0.025, -0.3 + bob - swayY * 0.018, -0.3],
        armRotation: [-swayY * 0.035, -swayX * 0.05, swayX * 0.025],
        knifePosition: [0.08, -0.08, -0.5],
        knifeRotation: [-0.08, 0.18, -0.34],
        parts: [0, 0, 0],
        action,
        progress,
        variant: state?.variant === 'rare' ? 'rare' : 'standard'
    };

    if (action === 'draw') {
        const settle = smooth(progress);
        pose.armPosition[0] += (1 - settle) * 0.3;
        pose.armPosition[1] -= (1 - settle) * 0.38;
        pose.armPosition[2] += (1 - settle) * 0.24;
        pose.armRotation[0] += (1 - settle) * 0.75 - pulse(progress) * 0.12;
        pose.knifeRotation[1] += (1 - settle) * 1.1;
        pose.knifeRotation[2] -= (1 - settle) * 0.75;
        if (state?.model === 'butterfly') {
            pose.parts = [-1.8 * (1 - settle), 1.8 * (1 - settle), Math.sin(progress * Math.PI * 2) * 0.55];
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
    } else if (action === 'stab') {
        const thrust = progress < 0.42 ? smooth(progress / 0.42) : 1 - smooth((progress - 0.42) / 0.58);
        pose.armPosition[0] -= 0.12 * thrust;
        pose.armPosition[1] += 0.05 * thrust;
        pose.armPosition[2] -= 0.43 * thrust;
        pose.armRotation[0] += 0.18 * thrust;
        pose.knifeRotation[0] += 0.2 * thrust;
        pose.knifeRotation[2] += 0.32 * thrust;
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
        if (state?.model === 'butterfly') {
            const flip = Math.sin(progress * Math.PI * turns);
            pose.parts = [-flip * 1.75, flip * 1.75, flip * 0.72];
        } else if (state?.model === 'karambit') {
            pose.parts[0] = Math.sin(progress * Math.PI * turns) * 0.65;
        }
    }
    return pose;
}
