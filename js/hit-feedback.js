// hit-feedback.js — Optional combat-feel overlay for the kill-confirm "hot ball"
// window (docs/V3_UX_ROADMAP.md 3.2). Self-contained: builds its own DOM element
// lazily and registers itself on `window.hitFeedback`, so callers use the usual
// `window.hitFeedback?.showHotBall?.()` no-op-when-absent pattern. Never touches
// ui.js or index.html.
const EL_ID = 'hot-ball-indicator';
const STYLE_ID = 'hit-feedback-style';

let hideTimer = null;

function ensureElement() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(EL_ID);
    if (el) return el;
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#${EL_ID} {
    position: fixed;
    top: 13%;
    left: 50%;
    transform: translateX(-50%) scale(0.92);
    padding: 4px 14px;
    border-radius: 999px;
    background: rgba(255, 90, 20, 0.16);
    border: 1px solid rgba(255, 140, 40, 0.7);
    color: #ffcf8a;
    font: 700 13px/1.4 system-ui, sans-serif;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease, transform 0.15s ease;
    z-index: 40;
    white-space: nowrap;
}
#${EL_ID}.active { opacity: 1; transform: translateX(-50%) scale(1); }
`;
        document.head.appendChild(style);
    }
    el = document.createElement('div');
    el.id = EL_ID;
    document.body.appendChild(el);
    return el;
}

export const hitFeedback = {
    // durationSeconds: how long the window lasts. bonusPercent: label only
    // (game.js owns the actual damage multiplier).
    showHotBall(durationSeconds = 3.5, bonusPercent = 15) {
        const el = ensureElement();
        if (!el) return;
        el.textContent = `\u{1F525} HOT BALL +${Math.round(bonusPercent)}%`;
        el.classList.add('active');
        clearTimeout(hideTimer);
        const ms = Math.max(0, Number(durationSeconds) || 0) * 1000;
        hideTimer = setTimeout(() => {
            el.classList.remove('active');
            hideTimer = null;
        }, ms);
    },
    // Called when the bonus is consumed (or manually cancelled) before its
    // natural expiry — hides immediately instead of waiting out the timer.
    hideHotBall() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        const el = typeof document !== 'undefined' ? document.getElementById(EL_ID) : null;
        if (el) el.classList.remove('active');
    }
};

if (typeof window !== 'undefined') window.hitFeedback = hitFeedback;
