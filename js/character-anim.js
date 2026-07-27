// character-anim.js — bridges character-pose.js reducers to a RigHandle. No THREE.AnimationMixer.
// ponytail: rig.applyPose her frame çağrılır, controller sade obje, 0 alloc hedefiyle blend/loop burada.
import { createAnimatorState, stepAnimator, triggerAction, resolvePose } from './character-pose.js';

const LOOP_STATES = Object.freeze(['emote', 'victory']);
const clampDt = dt => Math.min(Math.max(Number(dt) || 0, 0), .25);

/**
 * @param {object} rig RigHandle from character-rig.js (needs .applyPose)
 * @param {object} options { seed }
 * @returns AnimatorHandle { update, play, setLoop, controller }
 */
export function createCharacterAnimator(rig, options = {}) {
    let controller = createAnimatorState(options.seed || 0);
    let loop = null;

    function update(dt, facts = {}) {
        const step = clampDt(dt);
        if (loop) {
            // loop overrides locomotion entirely; keep the clock running so poseFor's phase animates.
            controller = {
                ...controller,
                state: loop,
                oneShot: null,
                elapsed: controller.elapsed + step,
                time: controller.time + step,
                progress: 0,
                blend: 1,
                previousState: loop
            };
        } else {
            controller = stepAnimator(controller, step, facts);
        }
        const pose = resolvePose(controller, facts);
        rig.applyPose?.(pose);
        return pose;
    }

    function play(action) {
        loop = null;
        controller = triggerAction(controller, action);
    }

    function setLoop(state) {
        loop = LOOP_STATES.includes(state) ? state : null;
    }

    return {
        update, play, setLoop,
        get controller() { return { ...controller }; }
    };
}
