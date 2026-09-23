// Local-only deflect result copy. This intentionally owns no timing rewards,
// physics, network state, or chains; it only turns an already-observed click
// lead (ms before body contact) into consistent player-facing feedback for solo
// and client prediction. A lead that could not be measured presents as NORMAL.
import { classifyDeflectLead } from './perfect-deflect.js';

export const DEFLECT_PRESENTATION_DURATION = Object.freeze({
    normal: 750,
    great: 1100,
    perfect: 1800
});

// `leadMs` is the click lead; `timingErrorMs` is its legacy name.
export function getDeflectPresentation({ leadMs, timingErrorMs, chain = 0, shot = 'flat', speedPercent = 100 } = {}) {
    const lead = leadMs !== undefined ? leadMs : timingErrorMs;
    const tier = classifyDeflectLead(lead);
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
        timingErrorMs: Number.isFinite(lead) ? lead : null,
        chain: perfectChain,
        duration: DEFLECT_PRESENTATION_DURATION[tier],
        priority: tier === 'perfect' ? 2 : tier === 'great' ? 1 : 0,
        tone: `deflect-${tier}`,
        message
    });
}
