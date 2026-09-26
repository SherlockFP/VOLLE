// App methods around a match: drop announcements (js/drop-feed.js), the
// weekly event entry (js/weekly-event.js), balance facts for analytics
// (js/balance-outcome.js), coded maps (js/map-code.js) and the adaptive bot
// level (js/adaptive-difficulty.js). Mixed into App by
// js/main.js (js/app-mixins.js).
import { packDrops } from './drop-feed.js';
import { GAME_MODES } from './gamemodes.js';
import { STATES } from './game.js';
import { t } from './i18n.js';
import { matchOutcomeFacts } from './balance-outcome.js';
import { decodeMapCode } from './map-code.js';
import { isTerminalRematchState } from './rematch.js';
import { WEEKLY_EVENT_XP_BONUS, weeklyEvent } from './weekly-event.js';
import { ADAPTIVE_DIFFICULTY, nextSkill, normalizeSkill, skillPercent } from './adaptive-difficulty.js';

export class MatchMetaMethods {
    // Shows this player's drops on the right and tells the lobby (the host relays
    // them under the sender's real name), CS:GO style. Ids only on the wire.
    _announceMatchDrops(matchId, drops) {
        const wire = packDrops(drops);
        if (!wire.length) return false;
        const playerKey = this.network?.playerId || 'local';
        this.dropFeed?.announce({ matchId, playerKey, name: this.game.playerName, self: true, drops: wire });
        if (this.network?.connected) {
            this.network.send({ type: 'matchDrops', matchId, playerId: playerKey, name: this.game.playerName, drops: wire });
        }
        return true;
    }

    // Menu "Weekly event" card: a bot match in this week's mode, via the normal
    // solo path (same preset, same lobby), with the mode switched to the event.
    _playWeeklyEvent() {
        if (this.network?.connected || this.game.state !== STATES.MENU) return false;
        const event = weeklyEvent();
        document.getElementById('solo-paths-start')?.click();
        if (this.game.state !== STATES.LOBBY) return false;
        this.game.selectMode(event.modeId);
        const mode = GAME_MODES[event.modeId]?.name || event.modeId;
        this.ui.showMessage?.(t('event.selected', { mode, bonus: Math.round(WEEKLY_EVENT_XP_BONUS * 100) }), 2200);
        return true;
    }

    // Balance facts for match_complete (js/balance-outcome.js ->
    // scripts/balance-report.js). Practice, spectating and an already-claimed
    // match report none. Clients see host bots without a difficulty ('none').
    _matchBalanceFacts() {
        if (!isTerminalRematchState(this.game.state) || this.game._rewardsClaimed) return null;
        if (this.game.localSpectator || this.game._practiceMode) return null;
        const scoreboard = this.game.scoreboard;
        const me = scoreboard?.players?.get?.(this.game.playerName) || {};
        const ffa = !!this.game._ffa;
        const winner = ffa ? this.game._finalWinner : scoreboard?.getWinner?.();
        const team = this.player.team;
        const won = ffa ? winner === this.game.playerName : winner === String(team).toUpperCase();
        return matchOutcomeFacts({
            queue: this._activeMatchMode, mapId: this.arena?.mapId, result: winner === 'DRAW' ? 'draw' : won ? 'win' : 'loss',
            team, ffa, character: this.store.get('selectedChar') || 'rally',
            players: this.game.getPlayerList(), bots: this.game.bots,
            redScore: scoreboard?.redScore, blueScore: scoreboard?.blueScore, roundHistory: scoreboard?.roundHistory,
            kills: me.score, deaths: me.deaths, bestRally: this.game.getMatchBestRally?.()
        });
    }

    // Host / solo: play a custom map from its share code. The code travels with the
    // lobby's mapChange / game-start snapshot, so every client builds the same map.
    _playLobbyMapCode(rawCode) {
        if (!this.isLobbyHost()) {
            this.ui.showMessage?.(t('toast.hostOnlyMap'), 1400);
            return false;
        }
        const code = String(rawCode || '').trim();
        const decoded = decodeMapCode(code);
        const mapId = decoded.ok ? this.game.adoptMapCode(code) : null;
        if (!mapId) {
            this.ui.showMessage?.(t('toast.mapCodeInvalid', { reason: decoded.error || 'map is not valid' }), 2600);
            return false;
        }
        // "Choose map" on, or the random roll at match start would replace it.
        this.store.set('lobbyCustomMap', true);
        const toggle = document.getElementById('lobby-custom-map');
        if (toggle) toggle.checked = true;
        this._syncMapChoiceUI();
        this.game.selectMap(mapId);
        this.updateCarousel();
        this.broadcastLobbyState();
        this.ui.showMessage?.(t('toast.mapCodeLoaded', { name: decoded.config.name }), 2200);
        return true;
    }

    // The player's adaptive bot level ("Matched to you" preset, "Auto" setting).
    _adaptiveSkill() {
        return normalizeSkill(this.store.get('adaptiveBotSkill'));
    }

    _adaptiveSkillPercent() {
        return skillPercent(this._adaptiveSkill());
    }

    // A finished solo match against adaptive bots moves the level: a win up, a
    // loss down, a bigger round margin further. The toast says which way.
    _settleAdaptiveSkill(balance) {
        if (!balance || this.network?.connected || this.game.botDifficulty !== ADAPTIVE_DIFFICULTY) return null;
        const before = this._adaptiveSkill();
        const after = nextSkill(before, { result: balance.dimensions?.result, roundsWon: balance.metrics?.roundsWon, roundsLost: balance.metrics?.roundsLost });
        this.store.set('adaptiveBotSkill', after);
        if (skillPercent(after) !== skillPercent(before)) {
            // Queued: the level-up / coins toasts of the same report must not wipe it.
            const text = t(after > before ? 'solo.adaptiveUp' : 'solo.adaptiveDown', { from: skillPercent(before), to: skillPercent(after) });
            if (!this.ui.queueToast?.(text, 2600)) this.ui.showMessage?.(text, 2600);
        }
        return after;
    }
}
