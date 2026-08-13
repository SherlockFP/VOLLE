// Local-only deflect result copy. This intentionally owns no timing rewards,
// physics, network state, or chains; it only turns an already-observed contact
// time into consistent player-facing feedback for solo and client prediction.
import { classifyDeflectTiming, DEFLECT_TIMING_WINDOWS } from './perfect-deflect.js';

export const DEFLECT_PRESENTATION_DURATION = Object.freeze({
    normal: 750,
    great: 1100,
    perfect: 1800
});

function safeTimingError(timingErrorMs) {
    return Number.isFinite(timingErrorMs)
        ? timingErrorMs
        : DEFLECT_TIMING_WINDOWS.normal;
}

export function getDeflectPresentation({ timingErrorMs, chain = 0, shot = 'flat', speedPercent = 100 } = {}) {
    const safeTiming = safeTimingError(timingErrorMs);
    const tier = classifyDeflectTiming(safeTiming) || 'normal';
    const speed = Math.max(0, Math.round(Number(speedPercent) || 0));
    const perfectChain = tier === 'perfect' ? Math.max(1, Math.trunc(Number(chain) || 1)) : 0;
    const shotLabel = shot === 'spike' ? 'SPIKE' : shot === 'lob' ? 'LOB' : 'DEFLECT';
    const message = tier === 'perfect'
        ? `PERFECT DEFLECT!${perfectChain > 1 ? ` x${perfectChain}` : ''}`
        : tier === 'great'
            ? `GREAT DEFLECT! ${speed}%`
            : `${shotLabel} ${speed}%`;
    return Object.freeze({
        tier,
        timingErrorMs: Number.isFinite(timingErrorMs) ? timingErrorMs : null,
        chain: perfectChain,
        duration: DEFLECT_PRESENTATION_DURATION[tier],
        priority: tier === 'perfect' ? 2 : tier === 'great' ? 1 : 0,
        tone: `deflect-${tier}`,
        message
    });
}
