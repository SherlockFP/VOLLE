// App methods for lobby bot backfill (js/bot-backfill.js): the host fills
// empty seats with AUTO bots and a kicked seat stays empty. Mixed into App by
// js/main.js (js/app-mixins.js).
import { backfillPlan } from './bot-backfill.js';
import { t } from './i18n.js';

export class LobbyBackfillMethods {
    // Casual online lobby: empty seats get bots (tagged AUTO in the lobby list),
    // bots this added leave again when humans take their seats, and a seat the
    // host kicked a bot out of stays empty (js/bot-backfill.js). broadcastLobbyState
    // runs this on every lobby change, so the host sees and can kick every bot
    // before Start.
    _backfillLobbyBots({ quiet = false, broadcast = true, removeOnly = false } = {}) {
        if (!this.network?.connected || !this.network.isHost || this._backfillRunning) return 0;
        this._backfillRunning = true;
        try {
            return this._applyBackfillPlan({ quiet, broadcast, removeOnly });
        } finally {
            this._backfillRunning = false;
        }
    }

    // A kicked (or "- BOT") bot's seat stays empty; "+ Bot" and re-ticking the
    // toggle hand seats back.
    _noteBackfillSeat(team, delta) {
        this._backfillSkips ||= { red: 0, blue: 0 };
        if (!Object.hasOwn(this._backfillSkips, team)) return;
        this._backfillSkips[team] = Math.max(0, this._backfillSkips[team] + delta);
    }

    _applyBackfillPlan({ quiet, broadcast, removeOnly = false }) {
        const teams = { red: 0, blue: 0 };
        const filled = { red: 0, blue: 0 };
        const tally = entity => {
            if (!entity || entity.isBotEntity || !Object.hasOwn(teams, entity.team)) return;
            teams[entity.team]++;
            if (entity._backfill) filled[entity.team]++;
        };
        tally(this.player);
        this.game.bots.forEach(tally);
        this.game.remotePlayers.forEach(tally);
        const skips = this._backfillSkips || { red: 0, blue: 0 };
        const plan = backfillPlan({
            red: teams.red, blue: teams.blue, backfillRed: filled.red, backfillBlue: filled.blue,
            skipRed: skips.red, skipBlue: skips.blue,
            enabled: document.getElementById('lobby-fill-bots')?.checked !== false,
            ranked: this._rankedHosting === true,
            modeId: this.game.mode?.id || '',
            ffa: this.game.mode?.ffa === true || this.game._ffa === true
        });
        let added = 0;
        for (const team of ['red', 'blue']) {
            for (let i = 0; i < (removeOnly ? 0 : plan[team]); i++) {
                if (!this.game.addBot(team)) break;
                const bot = this.game.bots[this.game.bots.length - 1];
                if (bot) bot._backfill = true;
                added++;
            }
            for (let i = 0; i < -plan[team]; i++) {
                const bot = [...this.game.bots].reverse().find(entry => entry._backfill && entry.team === team);
                if (bot) this.game.removeBotByName(bot.name);
            }
        }
        if (added) this.game.updateLobbyUI?.(); // addBot drew the rows before the AUTO tag was set
        if (broadcast && (plan.red || plan.blue)) this.broadcastLobbyState();
        if (added && !quiet) this.ui.showMessage?.(t('toast.botsFilled', { count: added }), 1800);
        return added;
    }
}
