// App methods for Play of the Game: pick the match's best moment
// (js/play-of-game.js), watch it (solo in the arena, online inline on the
// report) and share it as a code (js/potg-code.js). Mixed into App by
// js/main.js (js/app-mixins.js).
import { Arena } from './arena.js';
import { STATES } from './game.js';
import { t } from './i18n.js';
import { pickPlayOfTheGame, playTags } from './play-of-game.js';
import { canEncodePotgCode, decodePotgCode, encodePotgCode } from './potg-code.js';
import { createPotgStage } from './potg-player.js';
import { Replay, extractReplayHighlight } from './replay.js';

export class PlayOfTheGameMethods {
    // Play of the Game: the best moment of the match so far (js/play-of-game.js),
    // cut from the live recording while the report opens.
    _presentPlayOfTheGame(matchId) {
        if (!Replay.recording || !Replay.events.length) {
            this.ui.setPlayOfTheGame?.(null);
            return null;
        }
        const replay = { meta: Replay.meta || {}, events: Replay.events.slice(), duration: Math.max(0, performance.now() - Replay.startTs) };
        const play = pickPlayOfTheGame(replay);
        this._playOfTheGame = play ? { matchId, play, replay: extractReplayHighlight(replay, { label: 'Play of the Game', start: play.start, end: play.end }) } : null;
        // Solo watches in the arena; online it plays inline on the report (_watchPlayOfTheGame).
        this.ui.setPlayOfTheGame?.(play, { canWatch: !!play, canShare: !!play && canEncodePotgCode() });
        return play;
    }

    _watchPlayOfTheGame() {
        const entry = this._playOfTheGame;
        if (!entry || entry.matchId !== this.game.matchId || this.game.state !== STATES.GAME_OVER) return false;
        // Online the report must stay live (rematch votes, a host starting the next
        // match), so the clip plays inline in its own small stage instead.
        if (this.network?.connected) return this._watchPlayOfTheGameInline(entry);
        // The match's own bodies would stand in the replay: hide them until we return.
        const hidden = [...this.game.bots, ...this.game.remotePlayers.values(), this.game.localCosmeticEntity]
            .map(entity => entity?.group)
            .filter(group => group?.visible);
        hidden.forEach(group => { group.visible = false; });
        this._startReplay(entry.replay);
        this._replayReturn = { hidden };
        return true;
    }

    // "Copy code": the clip as a VP1 code (js/potg-code.js) anyone can paste into
    // the Replays screen. Nothing is uploaded.
    async _sharePlayOfTheGame() {
        const entry = this._playOfTheGame;
        if (!entry) return false;
        const code = await encodePotgCode(entry.replay, entry.play).catch(() => null);
        if (!code) {
            this.ui.showMessage?.(t('toast.potgCodeFailed'), 1800);
            return false;
        }
        try {
            await navigator.clipboard.writeText(code);
            this.ui.showMessage?.(t('toast.potgCodeCopied', { size: Math.ceil(code.length / 1024) }), 2000);
        } catch {
            window.prompt(t('toast.lobbyCodeCopyManual'), code);
        }
        return true;
    }

    // Replays screen: paste a VP1 code and watch it (a map this device does not
    // know plays on the current arena).
    async _playPotgCode(code) {
        if (this.game.state !== STATES.MENU) return false;
        const decoded = await decodePotgCode(code);
        if (!decoded.ok) {
            this.ui.showMessage?.(t('toast.potgCodeBad', { reason: decoded.error }), 2200);
            return false;
        }
        const clip = decoded.clip;
        if (!Object.hasOwn(Arena.MAPS, clip.meta.map)) clip.meta.map = this.arena?.mapId;
        this._startReplay(clip);
        const tags = playTags(decoded.play, t).join(' · ');
        this.ui.showMessage?.(`${t('pg.potg')}: ${decoded.play.player || t('potg.rallyOnly')}${tags ? ` — ${tags}` : ''}`, 2600);
        return true;
    }

    _watchPlayOfTheGameInline(entry) {
        const stageEl = document.getElementById('pg-potg-stage');
        if (!stageEl) return false;
        stageEl.hidden = false;
        const caption = document.getElementById('pg-potg-caption');
        this._potgStage ||= createPotgStage(stageEl.querySelector('.pg-potg-canvas') || stageEl, {
            onKill: data => {
                if (caption) caption.textContent = `${String(data?.attacker || '').slice(0, 24)} ✖ ${String(data?.victim || '').slice(0, 24)}`;
            }
        });
        if (caption) caption.textContent = '';
        const spawn = this.arena?.getPlayerSpawn?.('red');
        return this._potgStage.play(entry.replay, {
            focus: entry.play.player,
            court: {
                courtWidth: this.arena?.courtWidth || 80,
                courtLength: this.arena?.courtLength || 110,
                redSide: spawn && spawn.z < 0 ? -1 : 1
            }
        });
    }

    _disposePotgStage() {
        this._potgStage?.dispose();
        this._potgStage = null;
        const stageEl = document.getElementById('pg-potg-stage');
        if (stageEl) stageEl.hidden = true;
    }
}
