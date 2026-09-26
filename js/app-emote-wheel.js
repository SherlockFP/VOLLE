// App methods for the Z / G emote wheel (js/emotes.js): translated labels,
// hold-to-aim-and-release on Z, and teammates' callouts as a HUD line. The
// wheel itself opens and closes in js/main.js (openEmoteWheel/closeEmoteWheel).
// Mixed into App by js/main.js (js/app-mixins.js).
import { t } from './i18n.js';

// Z held at least this long is a hold: releasing it sends the aimed emote. A
// quicker tap leaves the wheel open (click / Enter / 1-0 send, Z again closes).
export const EMOTE_HOLD_MS = 220;

export class EmoteWheelMethods {
    _bindEmoteWheel() {
        const emotes = this.game?.emotes;
        if (!emotes) return;
        emotes.label = emote => this._emoteLabel(emote);
        emotes.pageLabel = page => {
            const key = `emotes.page.${page.id}`;
            const text = t(key);
            return text === key ? page.label : text;
        };
        // A teammate's callout (Incoming!, Cover me...) is also a HUD line: the
        // sprite above their head is easy to miss mid-rally.
        emotes.onEmote = (emote, entity) => {
            if (!emote?.callout || !entity || entity === this.player || !entity.team) return;
            if (entity.team !== this.player?.team || this.game?._ffa) return;
            this.ui?.showMessage?.(`${String(entity.name || 'Teammate').slice(0, 24)}: ${emote.emoji} ${this._emoteLabel(emote)}`, 1600);
        };
    }

    _emoteLabel(emote) {
        const key = `emotes.${emote.id}`;
        const text = t(key);
        return text === key ? emote.text : text;
    }

    _emoteWheelHint() {
        if (this.touchControls?.active) return t('emotes.hintTouch');
        return t(this._emoteWheelHeldSince != null ? 'emotes.hintHold' : 'emotes.hint');
    }

    // Z released (`at`: the keyup's timeStamp): after a hold, send what was
    // aimed (or close if nothing was).
    _releaseEmoteWheelKey(at = performance.now()) {
        const since = this._emoteWheelHeldSince;
        this._emoteWheelHeldSince = null;
        if (!this.game?.emotes?.wheelOpen || since == null) return false;
        const now = Number.isFinite(at) && at > 0 ? at : performance.now();
        if (now - since < EMOTE_HOLD_MS) return false;
        if (this.game.emotes.wheelSelection?.()?.aimed) return this.game.emotes.confirmWheel();
        this.closeEmoteWheel();
        return false;
    }
}
