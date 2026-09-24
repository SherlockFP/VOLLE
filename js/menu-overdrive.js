// js/menu-overdrive.js — "Night Broadcast" menu behaviour (docs/MENU_DESIGN.md).
// Deliberately tiny and dependency-free. All visuals live in css/menu-overdrive.css;
// this module only writes a few custom properties / classes:
//   - magnetic PLAY slab (≤ 6 px pull) with a cursor-tracked sheen (--mag-x/y, --hx/hy)
//   - a one-shot knife "slash" wipe when moving between menu screens
//   - html.ovd-still mirroring every reduced-motion source, so CSS has one switch
// Nothing here runs per frame while idle: pointer work is rAF-coalesced and stops
// when the pointer leaves; the wipe is a CSS animation restarted by class toggle.

// Screens that share the broadcast shell. Gameplay / postgame / HUD are excluded on
// purpose: entering a match must never be delayed or decorated by a menu wipe.
export const MENU_SCREENS = Object.freeze(new Set([
    'mainMenu', 'multiplayerMenu', 'joinMenu', 'lobby', 'practiceMenu', 'character', 'shop',
    'battlepass', 'avatar', 'mapEditor', 'achievements', 'daily', 'ranked', 'socialCenter',
    'leaderboard', 'replays', 'social', 'patchnotes', 'tournament', 'profile'
]));

// Pure: pointer position -> magnet translation (clamped) + sheen origin in % of the rect.
export function magnetOffset(px, py, rect, { strength = 0.14, max = 6 } = {}) {
    const width = Math.max(1, rect?.width || 0);
    const height = Math.max(1, rect?.height || 0);
    const left = rect?.left || 0;
    const top = rect?.top || 0;
    const clamp = value => Math.max(-max, Math.min(max, value));
    return {
        x: clamp((px - (left + width / 2)) * strength),
        y: clamp((py - (top + height / 2)) * strength),
        hx: Math.max(0, Math.min(100, ((px - left) / width) * 100)),
        hy: Math.max(0, Math.min(100, ((py - top) / height) * 100))
    };
}

// Pure: wipe only between two different menu screens and never under reduced motion.
export function shouldWipe(previous, next, still) {
    return !still && previous !== next && MENU_SCREENS.has(previous) && MENU_SCREENS.has(next);
}

export function isStill(doc = globalThis.document, win = globalThis.window) {
    return Boolean(
        doc?.documentElement?.classList?.contains('reduce-motion')
        || doc?.body?.classList?.contains('reduced-motion')
        || win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    );
}

export function initMenuOverdrive({ doc = globalThis.document, win = globalThis.window, signal } = {}) {
    if (!doc?.body || !win) return null;
    const root = doc.documentElement;
    const listen = (target, type, handler, options = {}) => target?.addEventListener?.(type, handler, { ...options, signal });

    // --- reduced-motion mirror -------------------------------------------------
    const syncStill = () => root.classList.toggle('ovd-still', isStill(doc, win));
    syncStill();
    const motionQuery = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    listen(motionQuery, 'change', syncStill);
    if (typeof win.MutationObserver === 'function') {
        const observer = new win.MutationObserver(syncStill);
        observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        signal?.addEventListener?.('abort', () => observer.disconnect());
    }

    // --- magnetic PLAY slab ------------------------------------------------------
    const play = doc.getElementById('btn-play-solo');
    const finePointer = win.matchMedia?.('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let pending = null;
    const applyMagnet = () => {
        frame = 0;
        if (!play || !pending) return;
        const { x, y, hx, hy } = pending;
        play.style.setProperty('--mag-x', `${x.toFixed(2)}px`);
        play.style.setProperty('--mag-y', `${y.toFixed(2)}px`);
        play.style.setProperty('--hx', `${hx.toFixed(1)}%`);
        play.style.setProperty('--hy', `${hy.toFixed(1)}%`);
    };
    const resetMagnet = () => {
        pending = null;
        if (frame) win.cancelAnimationFrame?.(frame);
        frame = 0;
        play?.style.setProperty('--mag-x', '0px');
        play?.style.setProperty('--mag-y', '0px');
    };
    if (play) {
        listen(play, 'pointermove', event => {
            if (event.pointerType !== 'mouse' || finePointer?.matches === false || isStill(doc, win)) return;
            pending = magnetOffset(event.clientX, event.clientY, play.getBoundingClientRect());
            if (!frame) frame = win.requestAnimationFrame?.(applyMagnet) || 0;
        });
        listen(play, 'pointerleave', resetMagnet);
        listen(play, 'blur', resetMagnet);
    }

    // --- screen-change slash wipe ---------------------------------------------
    let wipe = doc.querySelector('.ovd-wipe');
    if (!wipe) {
        wipe = doc.createElement('div');
        wipe.className = 'ovd-wipe';
        wipe.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(wipe);
    }
    let previous = doc.body.dataset?.screen || '';
    listen(win, 'warrball:screen', event => {
        const next = event?.detail?.screen || '';
        if (shouldWipe(previous, next, isStill(doc, win))) {
            wipe.classList.remove('is-running');
            void wipe.offsetWidth; // restart the CSS animation
            wipe.classList.add('is-running');
        }
        if (next !== 'mainMenu') resetMagnet();
        previous = next;
    });
    listen(wipe, 'animationend', () => wipe.classList.remove('is-running'));

    return { syncStill, wipe };
}
