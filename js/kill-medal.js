// Killer-side elimination medal: a centre-top badge that lands on every kill the
// local player scores, however far away the victim was (the world burst is
// invisible across a full court). Pure streak logic is exported for tests.
import { t } from './i18n.js';

export const KILL_STREAK_WINDOW_MS = 4000;
export const KILL_MEDAL_MS = 1400;

// 1 -> plain elimination, 2..4 -> multi-kill names, 5+ -> rampage.
export function killStreakTier(count) {
    const n = Math.floor(Number(count) || 0);
    if (n >= 5) return 'rampage';
    if (n === 4) return 'quadKill';
    if (n === 3) return 'tripleKill';
    if (n === 2) return 'doubleKill';
    return '';
}

export class KillStreakTracker {
    constructor(windowMs = KILL_STREAK_WINDOW_MS) {
        this.windowMs = windowMs;
        this.count = 0;
        this.lastAt = -Infinity;
    }

    note(now) {
        this.count = now - this.lastAt <= this.windowMs ? this.count + 1 : 1;
        this.lastAt = now;
        return this.count;
    }

    reset() {
        this.count = 0;
        this.lastAt = -Infinity;
    }
}

export class KillMedal {
    constructor(doc = globalThis.document) {
        this.el = doc?.getElementById?.('kill-medal') || null;
        this.title = this.el?.querySelector('[data-kill-title]') || null;
        this.victim = this.el?.querySelector('[data-kill-victim]') || null;
        this.tags = this.el?.querySelector('[data-kill-tags]') || null;
        this._timer = null;
    }

    show({ victimName = '', streak = 1, headshot = false, perfect = false } = {}) {
        if (!this.el) return false;
        const tier = killStreakTier(streak);
        if (this.title) this.title.textContent = t(tier ? `hud.${tier}` : 'hud.killMedal');
        if (this.victim) this.victim.textContent = victimName;
        if (this.tags) {
            this.tags.replaceChildren();
            for (const [on, key] of [[headshot, 'hud.killHeadshot'], [perfect, 'hud.killPerfect']]) {
                if (!on) continue;
                const chip = this.el.ownerDocument.createElement('span');
                chip.textContent = t(key);
                this.tags.append(chip);
            }
        }
        this.el.dataset.tier = tier || 'single';
        this.el.hidden = false;
        this.el.classList.remove('is-live');
        void this.el.offsetWidth; // restart the pop animation on back-to-back kills
        this.el.classList.add('is-live');
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.hide(), KILL_MEDAL_MS);
        return true;
    }

    hide() {
        clearTimeout(this._timer);
        this._timer = null;
        if (!this.el) return;
        this.el.hidden = true;
        this.el.classList.remove('is-live');
    }
}
