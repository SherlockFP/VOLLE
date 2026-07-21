// ui.js — Full UI: menus, HUD, chat, minimap, scoreboard, skill cooldown, kill feed,
// damage meter, character select, shop, battlepass.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES } from './skills.js';
import { BALL_SKINS } from './ball.js';
import { AVATAR_SKINS } from './avatar.js';
import { CASES, KNIVES, getCaseDropRates } from './cosmetics.js';
import { ACHIEVEMENTS } from './achievements.js';
import { MatchHistory } from './matchhistory.js';
import { getRank, getRankProgress } from './ranked.js';
import { Leaderboard } from './leaderboard.js';
import { Arena } from './arena.js';
import { COSMETICS, COSMETIC_TYPES, cosmeticsByType } from './cosmetic-catalog.js';

const CHARACTER_ATLAS = 'assets/generated/characters/character-atlas.png';
const BALL_BASE_SPEED = 17;

export function getBallHeat(ballSpeed, baseSpeed = BALL_BASE_SPEED) {
    const speed = Number.isFinite(ballSpeed) ? Math.max(0, ballSpeed) : 0;
    const base = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : BALL_BASE_SPEED;
    const ratio = speed / base;
    const level = ratio >= 3.5 ? 'critical' : ratio >= 2.25 ? 'danger' : ratio >= 1.35 ? 'warm' : 'track';
    return {
        speed,
        ratio,
        percent: Math.round(ratio * 100),
        level,
        label: level === 'critical' ? 'CRITICAL' : level === 'danger' ? 'DANGER' : level === 'warm' ? 'WARM' : 'BALL'
    };
}

export function getBallThreat(isTarget, ballSpeed, distance) {
    if (!isTarget) return { active: false, level: 'track', eta: Infinity, label: '' };
    const heat = getBallHeat(ballSpeed);
    const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
    const eta = heat.speed > 0 ? safeDistance / heat.speed : Infinity;
    const level = eta <= 0.45 || heat.level === 'critical'
        ? 'critical'
        : eta <= 0.85 || heat.level === 'danger'
            ? 'danger'
            : 'alert';
    return {
        active: true,
        level,
        eta,
        label: Number.isFinite(eta) ? `INCOMING ${eta.toFixed(1)}S` : 'INCOMING'
    };
}

function characterPortrait(index) {
    const x = (index % 4) * (100 / 3);
    const y = Math.floor(index / 4) * 50;
    return `<div class="char-portrait" style="background-image:url('${CHARACTER_ATLAS}');background-position:${x}% ${y}%"></div>`;
}

export class UI {
    constructor() {
        this.screens = {
            mainMenu: document.getElementById('main-menu'),
            lobby: document.getElementById('lobby-screen'),
            hud: document.getElementById('hud'),
            scoreboardOverlay: document.getElementById('scoreboard-overlay'),
            gameOver: document.getElementById('game-over-screen'),
            joinMenu: document.getElementById('join-menu'),
            multiplayerMenu: document.getElementById('multiplayer-menu'),
            character: document.getElementById('character-screen'),
            shop: document.getElementById('shop-screen'),
            battlepass: document.getElementById('battlepass-screen'),
            avatar: document.getElementById('avatar-screen'),
            mapEditor: document.getElementById('map-editor-screen'),
            achievements: document.getElementById('achievements-screen'),
            daily: document.getElementById('daily-screen'),
            ranked: document.getElementById('ranked-screen'),
            socialCenter: document.getElementById('social-center-screen'),
            leaderboard: document.getElementById('leaderboard-screen'),
            replays: document.getElementById('replays-screen'),
            social: document.getElementById('social-screen'),
            patchnotes: document.getElementById('patchnotes-screen'),
            tournament: document.getElementById('tournament-screen'),
            profile: document.getElementById('screen-profile')
        };
        this.competitiveHUD = {
            root: document.getElementById('hud-competitive-status'),
            mode: document.getElementById('hud-competitive-mode'),
            round: document.getElementById('hud-competitive-round'),
            phase: document.getElementById('hud-competitive-phase'),
            rules: document.getElementById('hud-competitive-rules')
        };
        this._competitiveHUDKey = '';
        this.initSettings();
    }

    initSettings() {
        const tabs = document.querySelectorAll('#settings-panel .settings-tabs button');
        tabs.forEach(t => t.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            t.classList.add('active');
            document.querySelectorAll('#settings-panel .settings-content').forEach(c => c.classList.add('hidden'));
            document.getElementById('settings-' + t.dataset.tab)?.classList.remove('hidden');
        }));
        document.querySelectorAll('#settings-panel input[type="range"]').forEach(inp => {
            const val = inp.parentElement.querySelector('.value');
            inp.addEventListener('input', () => { if (val) val.textContent = inp.value; });
        });
        document.getElementById('set-fov')?.addEventListener('input', e => {
            if (window._game?.player?.camera) window._game.player.camera.fov = +e.target.value;
        });
        document.getElementById('set-music')?.addEventListener('input', e => {
            window._game?.setMusicVolume?.(+e.target.value / 100);
        });
        document.getElementById('set-bloom')?.addEventListener('input', e => {
            window._game?.renderer?.bloomStrength?.(+e.target.value / 100);
        });
    }

    showSettings() {
        this.hideScoreboard();
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.remove('hidden');
    }

    hideSettings() {
        const panel = document.getElementById('settings-panel');
        if (panel) panel.classList.add('hidden');
    }

    showScreen(name) {
        this.hideScoreboard();
        Object.values(this.screens).forEach(s => { if (s) s.classList.add('hidden'); });
        const target = this.screens[name];
        if (target) {
            target.classList.remove('hidden');
            void target.offsetHeight; // force reflow for entrance animation
        }
        document.body.dataset.screen = name;
        // Close floating menus that aren't in screens
        const extras = ['pause-menu', 'settings-screen', 'post-game-screen', 'team-popup', 'celeb-weapon-hud'];
        extras.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    hideAll() {
        Object.values(this.screens).forEach(s => { if (s) s.classList.add('hidden'); });
    }

    showHUD() {
        this.updateCompetitiveHUD();
        if (this.screens.hud) this.screens.hud.classList.remove('hidden');
    }
    hideHUD() { if (this.screens.hud) this.screens.hud.classList.add('hidden'); }

    updateHUD(data) {
        const { time, redScore, blueScore, ballSpeed, hotPotato, competitive } = data;
        const el = id => document.getElementById(id);

        if (el('hud-round-timer')) el('hud-round-timer').textContent = time;
        if (el('hud-score-red')) el('hud-score-red').textContent = redScore;
        if (el('hud-score-blue')) el('hud-score-blue').textContent = blueScore;
        if (el('hud-speed')) {
            const heat = getBallHeat(ballSpeed);
            el('hud-speed').textContent = `${heat.label} ${heat.percent}%`;
            el('hud-speed').dataset.heat = heat.level;
        }
        // Ball speed indicator (bottom-right)
        const speedEl = document.getElementById('speed-val');
        if (speedEl && ballSpeed !== undefined) {
            const heat = getBallHeat(ballSpeed);
            speedEl.textContent = Math.round(heat.speed);
            speedEl.parentElement.dataset.heat = heat.level;
        }
        this.updateHotPotato(hotPotato);
        this.updateCompetitiveHUD(competitive);
    }

    updateCompetitiveHUD(state) {
        const hud = this.competitiveHUD;
        if (!hud?.root) return;
        const view = getCompetitiveHUDView(state);
        hud.root.classList.toggle('hidden', !view.active);
        hud.root.setAttribute('aria-hidden', String(!view.active));
        if (!view.active) {
            this._competitiveHUDKey = '';
            return;
        }
        if (view.key === this._competitiveHUDKey) return;
        this._competitiveHUDKey = view.key;
        if (hud.mode) hud.mode.textContent = view.mode;
        if (hud.round) hud.round.textContent = view.roundLabel;
        if (hud.phase) hud.phase.textContent = view.phase;
        if (hud.rules) hud.rules.textContent = view.rulesLabel;
        hud.root.dataset.phase = view.phase.toLowerCase().replaceAll(' ', '-');
        hud.root.setAttribute('aria-label', view.ariaLabel);
    }

    updateMovementHUD(speed = 0, state = 'MOVE', social = false) {
        const root = document.getElementById(social ? 'social-movement-hud' : 'movement-hud');
        const value = document.getElementById(social ? 'social-speed-value' : 'movement-speed-value');
        const label = document.getElementById(social ? 'social-movement-state' : 'movement-state');
        if (!root || !value || !label) return;
        const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
        value.textContent = Math.round(safeSpeed);
        label.textContent = state;
        root.classList.toggle('hidden', safeSpeed < 4 && state === 'MOVE');
        root.classList.toggle('boost', safeSpeed >= 11 || state === 'BHOP');
        root.classList.toggle('bhop', state === 'BHOP');
        root.classList.toggle('longjump', state === 'LONGJUMP');
    }

    updateMovementTrialHUD(state) {
        const root = document.getElementById('movement-trial-hud');
        if (!root) return;
        root.classList.toggle('hidden', !state?.active);
        if (!state?.active) return;
        const name = document.getElementById('movement-trial-name');
        const time = document.getElementById('movement-trial-time');
        const progress = document.getElementById('movement-trial-progress');
        const detail = document.getElementById('movement-trial-detail');
        if (name) name.textContent = state.trial.name;
        if (time) time.textContent = `${(state.elapsed / 1000).toFixed(2)}s`;
        if (progress) progress.style.width = `${Math.min(100, state.distance / state.trial.targetDistance * 100)}%`;
        if (detail) {
            const best = state.trial.requiredRocketJumps
                ? `${state.rocketJumps}/${state.trial.requiredRocketJumps} rocket jumps`
                : `${Math.round(state.distance)}/${state.trial.targetDistance}m`;
            detail.textContent = best;
        }
    }

    updateScoreboard(stats, ffa = false) {
        this.updateScoreboardTable('scoreboard-body', stats, ffa);
        const heading = document.querySelector('#scoreboard-overlay th:nth-child(2)');
        if (heading) heading.textContent = ffa ? 'Mode' : 'Team';
    }

    updateScoreboardTable(tbodyId, stats, ffa = false) {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';
        const store = window.__store;
        stats.forEach((p, i) => {
            const row = document.createElement('tr');
            row.className = p.team;
            const rank = p.rank || (p.isBot ? ['🥉','🥈','🥇'][Math.min(2, i)] : '🔰');
            const level = p.level || (p.isBot ? Math.min(20, i + 1) : (store?.get?.('level') || 1));
            const values = [
                `${p.name}${p.isYou ? ' (YOU)' : ''}`,
                ffa ? 'SOLO' : String(p.team || '').toUpperCase(),
                String(rank),
                String(level),
                String(p.score ?? 0),
                String(p.deflections ?? 0),
                String(p.hits ?? 0)
            ];
            values.forEach((value, cellIndex) => {
                const cell = document.createElement('td');
                cell.textContent = value;
                if (cellIndex === 0) cell.className = `team-${p.team}`;
                row.appendChild(cell);
            });
            const action = document.createElement('td');
            if (!p.isYou && !p.isBot) {
                const inspect = document.createElement('button');
                inspect.type = 'button';
                inspect.className = 'scoreboard-safety inspect';
                inspect.textContent = 'Inspect';
                inspect.addEventListener?.('click', () => this.onPlayerInspect?.(p));
                const safety = document.createElement('button');
                safety.type = 'button';
                safety.className = 'scoreboard-safety';
                safety.textContent = 'Report';
                safety.setAttribute?.('aria-label', `Mute or report ${p.name}`);
                safety.addEventListener?.('click', () => this.onPlayerSafety?.(p));
                action.appendChild(inspect);
                action.appendChild(safety);
            } else action.textContent = '-';
            row.appendChild(action);
            tbody.appendChild(row);
        });
    }

    showScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.remove('hidden');
        const tracker = document.getElementById('contract-tracker');
        if (tracker?.dataset.ready === 'true') tracker.classList.remove('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = '';
    }

    hideScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.add('hidden');
        document.getElementById('contract-tracker')?.classList.add('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = 'none';
    }

    // Incoming indicator with speed and time-to-impact readability.
    setPlayerTarget(isTarget, ballSpeed = 0, distance = Infinity) {
        const el = document.getElementById('incoming-indicator');
        if (!el) return;
        const threat = getBallThreat(isTarget, ballSpeed, distance);
        const previousLevel = el.dataset.threat;
        el.classList.toggle('active', threat.active);
        el.classList.toggle('hidden', !threat.active);
        el.dataset.threat = threat.level;
        el.dataset.label = threat.label;
        el.setAttribute('aria-hidden', String(!threat.active));
        if (threat.active && previousLevel !== threat.level) {
            el.setAttribute('role', 'status');
            el.setAttribute('aria-label', threat.label);
        }
    }

    updateHotPotato(state) {
        const root = document.getElementById('hot-potato-hud');
        if (!root) return;
        const enabled = state?.enabled === true;
        root.classList.toggle('hidden', !enabled);
        if (!enabled) return;
        const time = document.getElementById('hot-potato-time');
        const holder = document.getElementById('hot-potato-holder');
        const remaining = Math.max(0, Number(state.remaining) || 0);
        const ratio = remaining / Math.max(1, Number(state.duration) || 5);
        root.dataset.urgency = ratio <= 0.25 ? 'critical' : ratio <= 0.55 ? 'danger' : 'armed';
        if (time) time.textContent = state.active ? remaining.toFixed(1) : '--';
        if (holder) {
            holder.textContent = state.active
                ? `${state.holderName || 'PLAYER'} - ${String(state.holderTeam || '').toUpperCase()}`
                : state.holderName
                    ? `${state.holderName} EXPLODED`
                    : 'WAITING FOR TARGET';
        }
    }

    // Team switch popup (M)
    showTeamPopup(game) {
        const overlay = document.getElementById('team-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        const classSwitcher = document.getElementById('class-switcher-template');
        const popup = overlay.querySelector('.team-popup');
        if (classSwitcher && popup) popup.insertBefore(classSwitcher, popup.querySelector('.team-popup-actions'));
        this.selectedTeam = game.player.pendingTeam || game.player.team;
        classSwitcher?.classList.remove('hidden');
        this._renderTeamLists(game);
        this._renderClassSwitch(game);
    }

    hideTeamPopup() {
        const overlay = document.getElementById('team-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    isTeamPopupOpen() {
        const overlay = document.getElementById('team-overlay');
        return overlay && !overlay.classList.contains('hidden');
    }

    _renderTeamLists(game) {
        const redList = document.getElementById('team-list-red');
        const blueList = document.getElementById('team-list-blue');
        if (!redList || !blueList) return;
        const players = game.getPlayerList();
        const isHost = !game.network || !game.network.connected || game.network.isHost;
        redList.innerHTML = '';
        blueList.innerHTML = '';

        players.forEach(p => {
            const li = document.createElement('li');
            const isYou = p.name === game.playerName;
            const queued = !!p.queuedForNextRound;
            const displayTeam = queued ? (p.pendingTeam || p.team) : p.team;
            li.textContent = (p.isBot ? '🤖 ' : isYou ? '⭐ ' : '')
                + p.name
                + (queued ? ' · NEXT ROUND' : '');
            if (isYou) li.classList.add('you');
            li.title = isHost || isYou ? 'Team selection is confirmed below' : '';
            (displayTeam === 'red' ? redList : blueList).appendChild(li);
        });

        const selectTeam = (team) => {
            this.selectedTeam = team;
            this._renderTeamLists(game);
        };
        const headerRed = document.getElementById('team-header-red');
        const headerBlue = document.getElementById('team-header-blue');
        headerRed?.classList.toggle('selected', this.selectedTeam === 'red');
        headerBlue?.classList.toggle('selected', this.selectedTeam === 'blue');
        if (headerRed) headerRed.onclick = () => selectTeam('red');
        if (headerBlue) headerBlue.onclick = () => selectTeam('blue');

        const confirm = document.getElementById('btn-team-popup-confirm');
        if (confirm) {
            confirm.textContent = `JOIN ${String(this.selectedTeam || game.player.team).toUpperCase()} TEAM`;
            confirm.onclick = () => this.onTeamConfirm?.(this.selectedTeam || game.player.team);
        }

        const specBtn = document.getElementById('btn-team-popup-spectate');
        if (specBtn && this.onToggleSpectate) {
            const waiting = !!game.player.queuedForNextRound;
            specBtn.textContent = waiting
                ? 'Waiting for next round'
                : (this.spectating ? '↩ Leave Spectator' : '👁 Spectate');
            specBtn.disabled = waiting;
            specBtn.onclick = () => { this.onToggleSpectate(); };
        }
    }

    showGameOver(winner, stats, ffa = false) {
        this.showScreen('gameOver');
        const el = document.getElementById('winner-text');
        if (el) {
            el.textContent = winner === 'DRAW' ? "It's a Draw!" : ffa ? `${winner} Wins!` : `${winner} Team Wins!`;
            el.className = `winner-${winner.toLowerCase()}`;
        }
        this.updateScoreboard(stats, ffa);
        this.updateScoreboardTable('scoreboard-body-final', stats, ffa);
        const heading = document.querySelector('#game-over .scoreboard-table th:nth-child(2)');
        if (heading) heading.textContent = ffa ? 'Mode' : 'Team';
    }

    showCountdown(num, callback, token = ++this._countdownToken) {
        const el = document.getElementById('countdown');
        if (!el) return;
        el.classList.remove('hidden');
        el.textContent = num;
        el.classList.add('countdown-anim');
        setTimeout(() => {
            if (token !== this._countdownToken) return;
            el.classList.remove('countdown-anim');
            if (num > 1) {
                this.showCountdown(num - 1, callback, token);
            } else {
                el.textContent = 'GO!';
                setTimeout(() => {
                    if (token !== this._countdownToken) return;
                    el.classList.add('hidden');
                    if (callback) callback();
                }, 500);
            }
        }, 1000);
    }

    cancelCountdown() {
        this._countdownToken = (this._countdownToken || 0) + 1;
        document.getElementById('countdown')?.classList.add('hidden');
    }

    showRoundBanner(round, redScore, blueScore) {
        const el = document.getElementById('round-banner');
        if (!el) return;
        el.querySelector('.round-number').textContent = round;
        el.querySelector('.round-teams').textContent = `RED ${redScore} - ${blueScore} BLUE`;
        el.classList.remove('hidden', 'show');
        void el.offsetWidth; // force reflow
        el.classList.add('show');
        setTimeout(() => el.classList.add('hidden'), 2500);
    }

    showMatchIntro(mapName, modeName) {
        const el = document.getElementById('match-intro');
        if (!el) return;
        const mapEl = document.getElementById('mi-map-name');
        const modeEl = document.getElementById('mi-mode-name');
        if (mapEl) mapEl.textContent = mapName;
        if (modeEl) modeEl.textContent = modeName;
        el.classList.remove('hidden');
        el.style.animation = 'none';
        void el.offsetHeight;
        el.style.animation = '';
    }
    hideMatchIntro() {
        const el = document.getElementById('match-intro');
        if (el) el.classList.add('hidden');
    }

    showMessage(text, duration = 2000) {
        const el = document.getElementById('game-message');
        if (!el) return;
        el.textContent = text;
        // Fixed position — no random placement
        el.classList.remove('hidden');
        el.classList.add('message-anim');
        setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('message-anim');
        }, duration);
    }

    showPostGame(won, xpGained, level, kills, deflects, audio, result = {}) {
        const el = document.getElementById('post-game-screen');
        if (!el) return;
        el.classList.remove('hidden');
        document.getElementById('pg-result').textContent = won ? '🏆 VICTORY!' : '💀 DEFEAT';
        const winnerEl = document.getElementById('pg-winner');
        if (winnerEl) winnerEl.textContent = result.winnerText || '';
        document.getElementById('pg-level').textContent = `Level ${level}`;
        // Detailed AAR stats table
        const playerStats = result.playerStats || [];
        const statsHTML = this._buildAARTable(playerStats, kills, deflects);
        document.getElementById('postgame-stats').innerHTML = statsHTML;
        const pgLog = document.getElementById('pg-chat-log');
        if (pgLog) pgLog.innerHTML = '';
        const perc = Math.min(100, (xpGained / 1000) * 100);
        const xpFill = document.getElementById('pg-xp-fill');
        const xpText = document.getElementById('pg-xp-text');
        if (xpFill) { xpFill.style.width = '0%'; requestAnimationFrame(() => { xpFill.style.width = perc + '%'; }); }
        if (xpText) xpText.textContent = `+${xpGained} XP`;
        this.renderMatchAnalysis(result.analytics);
        const dings = Math.min(10, Math.ceil(perc / 10));
        let delay = 0;
        for (let i = 0; i < dings; i++) {
            setTimeout(() => {
                if (audio?.playDing) audio.playDing(660 + i * 40, 0.16);
            }, delay);
            delay += 150;
        }
        const playAgain = document.getElementById('pg-play-again');
        const lobby = document.getElementById('pg-lobby');
        const mainMenu = document.getElementById('pg-main-menu');
        if (playAgain) playAgain.onclick = () => window._postGameAction?.('play_again');
        if (lobby) lobby.onclick = () => {
            el.classList.add('hidden');
            window._postGameAction?.('lobby');
        };
        if (mainMenu) mainMenu.onclick = () => {
            el.classList.add('hidden');
            window._postGameAction?.('main_menu');
        };
    }

    renderMatchAnalysis(report, initialTab = 'overview') {
        const content = document.getElementById('pg-analysis-content');
        const tabs = document.querySelectorAll('[data-analysis-tab]');
        if (!content) return;
        const safe = report && typeof report === 'object' ? report : {};
        const render = tab => {
            tabs.forEach(button => button.classList.toggle('selected', button.dataset.analysisTab === tab));
            if (tab === 'timeline') {
                const events = Array.isArray(safe.timeline) ? safe.timeline.slice(-80).reverse() : [];
                content.innerHTML = events.length ? `<div class="pg-timeline">${events.map(event => {
                    const seconds = Math.max(0, Number(event.t) || 0) / 1000;
                    const who = event.data?.name || event.data?.playerId || event.data?.attackerId || '';
                    return `<div><time>${seconds.toFixed(1)}s</time><b>${this._esc(event.type || 'event')}</b><span>${this._esc(who)}</span></div>`;
                }).join('')}</div>` : '<p>No timeline events recorded.</p>';
                return;
            }
            if (tab === 'heatmap') {
                const heatmap = safe.heatmap;
                const cells = Array.isArray(heatmap?.cells) ? heatmap.cells.flat() : [];
                const max = Math.max(1, Number(heatmap?.max) || 1);
                content.innerHTML = cells.length
                    ? `<div class="pg-heatmap" style="--heat-cols:${heatmap.columns || 12}">${cells.map(value =>
                        `<i style="--heat:${Math.max(0, Number(value) || 0) / max}" title="${Number(value) || 0} samples"></i>`
                    ).join('')}</div><small>${heatmap.total || 0} ball trajectory samples</small>`
                    : '<p>No trajectory data recorded.</p>';
                return;
            }
            const players = Array.isArray(safe.players) ? safe.players : [];
            const totals = players.reduce((sum, player) => {
                sum.deflects += player.deflects || 0;
                sum.perfects += player.deflectTiers?.perfect || 0;
                sum.kos += player.kos || 0;
                return sum;
            }, { deflects: 0, perfects: 0, kos: 0 });
            content.innerHTML = `<div class="pg-analysis-grid">
                <article><span>MVP</span><b>${this._esc(safe.mvp?.name || '--')}</b></article>
                <article><span>Deflects</span><b>${totals.deflects}</b></article>
                <article><span>Perfects</span><b>${totals.perfects}</b></article>
                <article><span>KOs</span><b>${totals.kos}</b></article>
            </div>`;
        };
        tabs.forEach(button => {
            button.onclick = () => render(button.dataset.analysisTab || 'overview');
        });
        render(initialTab);
    }

    _buildAARTable(playerStats, totalKills, totalDeflects) {
        if (!playerStats.length) return `<span>💥 ${totalKills} kills</span><span>🏐 ${totalDeflects} deflects</span>`;
        // Team totals
        let redTot = { score:0, deaths:0, assists:0, deflections:0, rally:0, damageDealt:0, damageTaken:0 };
        let blueTot = { score:0, deaths:0, assists:0, deflections:0, rally:0, damageDealt:0, damageTaken:0 };
        playerStats.forEach(p => {
            const t = p.team === 'blue' ? blueTot : redTot;
            t.score += p.score || 0;
            t.deaths += p.deaths || 0;
            t.assists += p.assists || 0;
            t.deflections += p.deflections || 0;
            t.rally += p.hits || 0;
            t.damageDealt += p.damageDealt || 0;
            t.damageTaken += p.damageTaken || 0;
        });
        // Find MVP (highest score)
        const mvp = playerStats.reduce((best, p) => (p.score > (best?.score || 0) ? p : best), null);
        // Build table
        let rows = '';
        playerStats.forEach(p => {
            const kd = (p.deaths || 1) > 0 ? ((p.score || 0) / (p.deaths || 1)).toFixed(1) : '∞';
            const isMvp = mvp && p.name === mvp.name;
            rows += `<tr class="${isMvp ? 'pg-mvp' : ''} ${p.team}">
                <td class="pg-name">${this._esc(p.name)}${isMvp ? ' 👑' : ''}</td>
                <td>${p.score || 0}</td>
                <td>${p.deaths || 0}</td>
                <td>${p.deflections || 0}</td>
                <td>${p.hits || 0}</td>
                <td>${p.assists || 0}</td>
                <td>${p.damageDealt || 0}</td>
                <td>${kd}</td>
            </tr>`;
        });
        return `
            <table class="pg-aar-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Kills</th>
                        <th>Deaths</th>
                        <th>Defl</th>
                        <th>Rally</th>
                        <th>Assists</th>
                        <th>Dmg</th>
                        <th>K/D</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="pg-team-red"><td colspan="8">🔴 RED — K:${redTot.score} D:${redTot.deaths} Defl:${redTot.deflections} Rally:${redTot.rally} Dmg:${redTot.damageDealt}</td></tr>
                    <tr class="pg-team-blue"><td colspan="8">🔵 BLUE — K:${blueTot.score} D:${blueTot.deaths} Defl:${blueTot.deflections} Rally:${blueTot.rally} Dmg:${blueTot.damageDealt}</td></tr>
                </tfoot>
            </table>`;
    }

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    _playDing() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 800 + Math.random() * 400;
            const g = ctx.createGain(); g.gain.value = 0.06;
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.15);
        } catch (_) {}
    }

    showCombo(combo, maxCombo) {
        const el = document.getElementById('combo-display');
        if (!el || combo < 2) { el?.classList.remove('active'); return; }
        const labels = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'HEXA!', 'ULTRA!', 'MEGA!'];
        const label = labels[Math.min(combo, labels.length - 1)] || 'GODLIKE!';
        const numEl = el.querySelector('.combo-num') || el.querySelector('.combo-count');
        const lblEl = el.querySelector('.combo-label');
        if (numEl) numEl.textContent = combo + 'x';
        if (lblEl) lblEl.textContent = label;
        el.classList.add('active');
        el.classList.remove('hidden');
        clearTimeout(this._comboHideTimer);
        this._comboHideTimer = setTimeout(() => el.classList.remove('active'), 1500);
    }

    showStreak(text, cls) {
        const el = document.getElementById('streak-banner');
        if (!el) return;
        const textEl = el.querySelector('.streak-text');
        textEl.textContent = text;
        textEl.className = 'streak-text ' + (cls || '');
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    }

    spawnDamageNumber(screenX, screenY, dmg, lethal = false, zoneLabel = null) {
        const existing = document.querySelectorAll('.dmg-num');
        if (existing.length > 8) {
            const oldest = existing[0];
            if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
        }
        const el = document.createElement('div');
        el.className = 'dmg-num' + (lethal ? ' lethal' : '');
        if (zoneLabel) {
            el.innerHTML = `<span class="dmg-value">-${dmg}</span><span class="dmg-zone">${zoneLabel}</span>`;
        } else {
            el.textContent = '-' + dmg;
        }
        el.style.left = screenX + 'px';
        el.style.top = screenY + 'px';
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.style.transform = 'translateY(-40px)';
            el.style.opacity = '0';
        });
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 800);
    }

    // --- Map Voting UI ---
    showMapVoting(options, isHost, onVote) {
        const container = document.getElementById('pg-map-vote');
        if (!container) return;
        container.classList.remove('hidden');
        // Disable play again during voting
        const playBtn = document.getElementById('pg-play-again');
        if (playBtn) playBtn.disabled = true;
        container.innerHTML = '<div class="mv-label">🗺️ VOTE FOR NEXT MAP</div>';
        const cards = document.createElement('div');
        cards.className = 'mv-cards';
        options.forEach((mapId) => {
            const config = Arena.MAPS?.[mapId];
            const name = config?.name || mapId;
            const card = document.createElement('div');
            card.className = 'mv-card';
            card.dataset.mapId = mapId;
            card.innerHTML = `<div class="mv-card-name">${name}</div>`;
            card.addEventListener('click', () => {
                if (card.classList.contains('mv-voted')) return;
                // Deselect others
                cards.querySelectorAll('.mv-card').forEach(c => c.classList.remove('mv-voted', 'mv-selected'));
                card.classList.add('mv-voted', 'mv-selected');
                onVote(mapId);
            });
            cards.appendChild(card);
        });
        container.appendChild(cards);
        if (isHost) {
            const info = document.createElement('div');
            info.className = 'mv-info';
            info.textContent = 'Waiting for votes... (20s timeout)';
            container.appendChild(info);
        }
    }

    highlightMapVote(mapId) {
        const cards = document.querySelectorAll('.mv-card');
        cards.forEach(c => {
            if (c.dataset.mapId === mapId) {
                c.classList.add('mv-voted', 'mv-selected');
            } else {
                c.classList.remove('mv-selected');
            }
        });
    }

    updateLobbyPlayers(players, isHost) {
        const redEl = document.getElementById('cs-team-red');
        const blueEl = document.getElementById('cs-team-blue');
        if (redEl) redEl.innerHTML = '';
        if (blueEl) blueEl.innerHTML = '';
        const reds = players.filter(p => p.team === 'red');
        const blues = players.filter(p => p.team === 'blue');
        const maxSlots = 6;
        const renderCard = (p, container, isPlaceholder) => {
            if (!container) return;
            if (isPlaceholder) {
                const card = document.createElement('div');
                card.className = 'cs-player-card empty';
                card.textContent = '⏳ Waiting…';
                container.appendChild(card);
                return;
            }
            const card = document.createElement('div');
            card.className = `cs-player-card team-${p.team}${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}`;
            card.draggable = !!isHost && !p.isBot;
            card.dataset.playerName = p.name;
            card.dataset.playerTeam = p.team;
            const char = CHARACTERS[p.charId] || CHARACTERS.rally;
            const emoji = char?.emoji || '👤';
            const ownAvatarOnly = window.__store?.get?.('customAvatar');
            const avatarHTML = p.isYou
                ? (ownAvatarOnly?.dataURL ? `<img src="${ownAvatarOnly.dataURL}">` : emoji)
                : (p.avatar ? `<img src="${p.avatar}">` : emoji);
            const kickBtn = (isHost && !p.isYou)
                ? `<button class="cs-btn-kick" data-kick-name="${this.escapeHTML(p.name)}" data-kick-peer="${this.escapeHTML(p.peerId || '')}" data-kick-bot="${p.isBot?1:0}" title="Kick">✕</button>`
                : '';
            const hostBadge = p.isHost ? '<span class="cs-badge cs-badge-host">HOST</span>' : '';
            const botBadge = p.isBot ? '<span class="cs-badge cs-badge-bot">BOT</span>' : '';
            const pingHtml = p.ping != null ? `<span class="cs-badge-ping">${Math.round(p.ping)}ms</span>` : '';
            card.innerHTML = `
                <div class="cs-player-avatar">${avatarHTML}</div>
                <div class="cs-player-info">
                    <div class="cs-player-name${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}">${this.escapeHTML(p.name)}</div>
                    <div class="cs-player-sub" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">${hostBadge}${botBadge}${pingHtml}</div>
                </div>
                ${kickBtn}
            `;
            container.appendChild(card);
        };
        reds.forEach(p => renderCard(p, redEl));
        for (let i = reds.length; i < maxSlots; i++) renderCard(null, redEl, true);
        blues.forEach(p => renderCard(p, blueEl));
        for (let i = blues.length; i < maxSlots; i++) renderCard(null, blueEl, true);
        // Update bot count
        const botCount = players.filter(p => p.isBot).length;
        const bc = document.getElementById('cs-bot-count');
        if (bc) bc.textContent = `Bots: ${botCount}`;
    }

    setRoomCode(code) {
        const el = document.getElementById('room-code');
        if (el) el.textContent = code;
    }

    // --- CHAT ---

    addChatMessage(name, text) {
        // In-game chat log (floating overlay)
        const chatLog = document.getElementById('chat-log');
        if (chatLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${name}:</span> ${this.escapeHTML(text)}`;
            chatLog.appendChild(msg);
            chatLog.scrollTop = chatLog.scrollHeight;
            setTimeout(() => { msg.classList.add('chat-fade'); }, 8000);
            setTimeout(() => { msg.remove(); }, 12000);
        }
        // Lobby chat log (persistent panel)
        const lobbyLog = document.getElementById('lobby-chat-log');
        if (lobbyLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${name}:</span> ${this.escapeHTML(text)}`;
            lobbyLog.appendChild(msg);
            lobbyLog.scrollTop = lobbyLog.scrollHeight;
            // Keep last 50 messages
            while (lobbyLog.children.length > 50) lobbyLog.firstChild.remove();
        }
        const postLog = document.getElementById('pg-chat-log');
        if (postLog) {
            const msg = document.createElement('div');
            msg.className = 'chat-msg';
            msg.innerHTML = `<span class="chat-name">${this.escapeHTML(name)}:</span> ${this.escapeHTML(text)}`;
            postLog.appendChild(msg);
            postLog.scrollTop = postLog.scrollHeight;
            while (postLog.children.length > 50) postLog.firstChild.remove();
        }
    }

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Update HP / shield / stamina bars for the local player.
    updateVitals(hp, maxHp, shield, stamina, staminaMax, exhausted) {
        const hpPct = Math.max(0, hp / maxHp * 100);
        const stPct = Math.max(0, stamina / staminaMax * 100);
        const hpFill = document.getElementById('hp-fill');
        const shieldFill = document.getElementById('shield-fill');
        const staFill = document.getElementById('stamina-fill');
        const hpNum = document.getElementById('hp-num');
        if (hpFill) {
            hpFill.style.width = hpPct + '%';
            hpFill.className = 'vital-fill hp' + (hpPct < 30 ? ' low' : hpPct < 60 ? ' mid' : '');
        }
        if (shieldFill) shieldFill.style.width = `${Math.max(0, (shield || 0) / maxHp * 100)}%`;
        if (staFill) {
            staFill.style.width = stPct + '%';
            staFill.classList.toggle('exhausted', !!exhausted);
            // Dynamic stamina color gradient: green→yellow→red
            if (!exhausted) {
                const r = stPct < 50 ? 255 : Math.round(68 + (stPct - 50) / 50 * (255 - 68));
                const g = stPct > 50 ? 170 : Math.round(170 * stPct / 50);
                const b = 0;
                staFill.style.background = `linear-gradient(90deg, rgb(${Math.round(r * 0.8)},${Math.round(g * 0.8)},${b}), rgb(${r},${g},${b}))`;
            }
        }
        if (hpNum) hpNum.textContent = Math.ceil(hp) + (shield > 0 ? ' +' + Math.ceil(shield) : '');
    }

    // Red damage vignette flash (when the local player is hit)
    flashHit() {
        const el = document.getElementById('hit-flash');
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth; // restart animation
        el.classList.add('flash');
    }

    showHitMarker(headshot = false) {
        const el = document.getElementById('hit-marker');
        if (!el) return;
        el.style.color = headshot ? '#ffdd00' : 'white';
        el.style.fontSize = headshot ? '2em' : '1.5em';
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    }

    showDamageDirection(angle) {
        const el = document.getElementById('dmg-direction');
        if (!el) return;
        el.innerHTML = '';
        const arc = document.createElement('div');
        arc.className = 'dmg-arc';
        arc.style.transform = `rotate(${angle}deg)`;
        el.appendChild(arc);
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
    }

    // Ultimate charge HUD
    updateUltimate(charge, isReady) {
        const hud = document.getElementById('ultimate-hud');
        const fill = document.getElementById('ult-fill');
        const pct = document.getElementById('ult-pct');
        const ready = document.getElementById('ult-ready');
        if (hud) hud.classList.remove('hidden');
        if (fill) fill.style.setProperty('--pct', charge + '%');
        if (pct) pct.textContent = Math.round(charge);
        if (ready) ready.classList.toggle('hidden', !isReady);
    }

    showKillCamOverlay(killerName, duration = 2.5) {
        const el = document.getElementById('killcam-overlay');
        if (!el) return;
        el.innerHTML = `<div class="killcam-killer">KILLED BY: ${this.escapeHTML(killerName)}</div>`;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), duration * 1000);
    }

    // Skill cooldown bar — HUD'da Q skill için.
    updateSkillCooldown(cooldowns, skillId) {
        const skill = SKILLS[skillId];
        const fill = document.getElementById('skill-fill');
        const cd = document.getElementById('skill-cd');
        const icon = document.getElementById('skill-icon');
        if (!fill || !skill) return;
        const remaining = cooldowns[skillId] || 0;
        const pct = Math.max(0, 100 - (remaining / skill.cooldown) * 100);
        fill.style.width = `${pct}%`;
        if (cd) cd.textContent = remaining > 0 ? `${remaining.toFixed(1)}s` : 'Ready';
        if (icon) icon.textContent = skill.emoji;
        fill.classList.toggle('ready', remaining <= 0);
    }

    // Kill feed — animated entries, max 5, slide in, fade out after 5s.
    renderKillFeed(killFeed) {
        const el = document.getElementById('kill-feed');
        if (!el) return;
        const now = performance.now();
        // Trim expired entries
        const visible = killFeed.filter(e => now - e.time < 5000);
        // Max 5 entries
        const entries = visible.slice(-5);
        // Remove excess DOM children
        while (el.children.length > entries.length) el.removeChild(el.firstChild);
        entries.forEach((e, i) => {
            let row = el.children[i];
            if (!row) {
                row = document.createElement('div');
                el.appendChild(row);
            }
            const isHeadshot = e.headshot;
            const age = now - e.time;
            // Apply fade-out class for entries older than 4s
            if (age > 4000 && !row.classList.contains('fade-out')) {
                row.classList.add('fade-out');
            }
            row.className = 'kill-entry' + (isHeadshot ? ' headshot' : '') + (age > 4000 ? ' fade-out' : '');
            row.innerHTML = `<span class="killer">${this.escapeHTML(e.killer || e.attacker || 'Bot')}</span>` +
                `<span class="weapon-icon">${isHeadshot ? '💀' : '🏐'}</span>` +
                `<span class="victim">${this.escapeHTML(e.victim || 'Bot')}</span>`;
        });
    }

    // Kill feed — legacy.
    updateKillFeed(feed) {
        const el = document.getElementById('kill-feed');
        if (!el) return;
        el.innerHTML = '';
        feed.forEach(item => {
            const div = document.createElement('div');
            div.className = 'kf-msg';
            div.innerHTML = `<span class="kf-atk">${item.attacker || 'Ball'}</span> → <span class="kf-vic">${item.victim}</span> <span class="kf-dmg">-${item.dmg}${item.tag||''}</span>`;
            el.appendChild(div);
        });
    }

    // Damage meter — sol üstte.
    updateDamageMeter(dealt, taken) {
        const dEl = document.getElementById('dm-dealt');
        const tEl = document.getElementById('dm-taken');
        if (dEl) dEl.textContent = Math.round(dealt);
        if (tEl) tEl.textContent = Math.round(taken);
    }

    // Combo göstergesi — ortada büyük sayı (juice).
    updateCombo(combo, label) {
        const el = document.getElementById('combo-display');
        if (!el) return;
        if (combo > 1) {
            el.classList.add('active');
            const numEl = el.querySelector('.combo-num') || el.querySelector('.combo-count');
            const lblEl = el.querySelector('.combo-label');
            if (numEl) numEl.textContent = combo;
            if (lblEl) lblEl.textContent = label || 'COMBO';
        } else {
            el.classList.remove('active');
        }
    }

    // Flash overlay — hit alınca beyaz/kırmızı parıltı.
    updateFlash(amt) {
        let el = document.getElementById('juice-flash');
        if (!el) {
            el = document.createElement('div');
            el.id = 'juice-flash';
            el.className = 'juice-flash';
            document.body.appendChild(el);
        }
        el.style.opacity = Math.min(0.6, amt);
    }

    // Meta stats — main menu'de coins/level/tier.
    updateBallSkin(skinId) {
        const el = document.getElementById('hud-ball-skin');
        if (el) {
            const skin = BALL_SKINS[skinId];
            el.textContent = skin ? skin.name : '🏐';
        }
    }

    updateBallAffix(affix) {
        const el = document.getElementById('ball-affix-indicator');
        if (!el) return;
        if (affix) {
            el.classList.remove('hidden');
            el.innerHTML = `<span class="affix-dot" style="background:#${affix.color.toString(16).padStart(6,'0')}"></span><span class="affix-name">${affix.name}</span>`;
        } else {
            el.classList.add('hidden');
        }
    }

    updateMetaStats(store) {
        const c = document.getElementById('meta-coins');
        const l = document.getElementById('meta-level');
        const t = document.getElementById('meta-bp-tier');
        if (c) c.textContent = store.get('currency');
        if (l) l.textContent = store.get('level');
        if (t) t.textContent = store.get('battlepass').tier;
    }

    // ===== KARAKTER SELECT EKRANI =====
    renderCharacterSelect(store) {
        const grid = document.getElementById('char-grid');
        if (!grid) return;
        const iconStyle = index => `style="--icon-x:${index % 4 * 33.333}%;--icon-y:${Math.floor(index / 4) * 33.333}%"`;
        grid.innerHTML = '';
        const owned = store.get('unlockedChars');
        const selected = store.get('selectedChar');
        Object.values(CHARACTERS).forEach((c, index) => {
            const card = document.createElement('div');
            const isOwned = owned.includes(c.id);
            const isSelected = selected === c.id;
            const mastery = store.getCharacterProgress(c.id);
            const masteryNeed = mastery.level < 10 ? mastery.level * 250 : 0;
            card.className = `char-card ${isSelected ? 'selected' : ''} ${!isOwned ? 'locked' : ''}`;
            card.dataset.char = c.id;
            card.innerHTML = `
                ${characterPortrait(index)}
                <div class="char-name">${c.name}</div>
                <div class="char-stats">
                    ❤️${c.maxHp} 💨${c.speed} 🎯${c.deflectPower}
                </div>
                <div class="char-mastery">Mastery Lv ${mastery.level}${masteryNeed ? ` · ${mastery.xp}/${masteryNeed} XP` : ' · MAX'}</div>
                <div class="char-desc">${c.desc}</div>
                ${!isOwned && c.price ? `<div class="char-price">🪙 ${c.price}</div>` : ''}
            `;
            grid.appendChild(card);
        });

        // Skill grid
        const sg = document.getElementById('skill-grid');
        if (sg) {
            sg.innerHTML = '';
            const ownedSkills = store.get('ownedSkills');
            const currentSkill = store.get('loadout').skill;
            Object.values(SKILLS).forEach((s, index) => {
                const card = document.createElement('div');
                const owned = ownedSkills.includes(s.id);
                card.className = `skill-card ${currentSkill === s.id ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.skill = s.id;
                card.innerHTML = `<div class="loadout-icon" ${iconStyle(index)} aria-hidden="true"></div><div class="loadout-card-title">${s.name}</div><div class="char-desc">${s.desc}</div><div class="loadout-card-meta">${s.cooldown}s cooldown</div>${!owned ? '<div class="char-price">🪙 100</div>' : ''}`;
                sg.appendChild(card);
            });
        }

        // Rune grid
        const rg = document.getElementById('rune-grid');
        if (rg) {
            rg.innerHTML = '';
            const ownedRunes = store.get('ownedItems');
            const currentRunes = store.get('loadout').runes || [];
            Object.values(RUNES).forEach((r, index) => {
                const card = document.createElement('div');
                const owned = ownedRunes.includes(r.id);
                const equipped = currentRunes.includes(r.id);
                card.className = `rune-card ${equipped ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.rune = r.id;
                card.innerHTML = `<div class="loadout-icon rune-icon" ${iconStyle(index + 8)} aria-hidden="true"></div><div class="loadout-card-title">${r.name}</div><div class="char-desc">${r.desc}</div>${!owned ? '<div class="char-price">🪙 80</div>' : ''}`;
                rg.appendChild(card);
            });
        }
    }

    // ===== SHOP EKRANI =====
    renderShop(store, tab = 'chars') {
        const grid = document.getElementById('shop-grid');
        const coinsEl = document.getElementById('shop-coins');
        if (coinsEl) coinsEl.textContent = store.get('currency');
        if (!grid) return;
        grid.innerHTML = '';

        if (tab === 'live') {
            const market = store.getLiveMarket?.() || { offers: [] };
            const until = Number.isFinite(market.expiresAt)
                ? new Date(market.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            if (!market.offers?.length) {
                grid.innerHTML = '<p class="shop-empty">Loading today\'s deals...</p>';
                return;
            }
            market.offers.forEach(offer => {
                const item = offer.kind === 'cosmetic' ? COSMETICS[offer.itemId] : BALL_SKINS[offer.itemId];
                if (!item) return;
                const owned = offer.kind === 'cosmetic'
                    ? store.ownsCosmetic(offer.itemId)
                    : store.ownsBall(offer.itemId);
                const card = document.createElement('div');
                card.className = `shop-card live-deal rarity-${item.rarity || 'common'} ${owned ? 'owned' : ''}`;
                const visual = offer.kind === 'cosmetic'
                    ? `<div class="cosmetic-preview cosmetic-preview-${item.type}" style="--cosmetic-primary:${item.colors[0]};--cosmetic-secondary:${item.colors[1]}"></div>`
                    : '<div class="ball-inspect-stage"><div class="ball-preview"></div><span class="ball-inspect-trail" aria-hidden="true"></span></div>';
                card.innerHTML = `<div class="live-deal-badge">-${offer.discount}% TODAY</div>${visual}<div class="char-name">${item.name}</div><div class="char-desc">Rotates at ${until || 'midnight'}.</div>${owned ? '<div class="shop-owned">Owned</div>' : `<button class="btn btn-primary btn-small live-offer-buy" data-offer-id="${offer.id}"><s>${offer.basePrice}</s> COINS ${offer.price}</button>`}`;
                const preview = card.querySelector('.ball-preview');
                if (preview) preview.dataset.effect = item.effect || 'core';
                grid.appendChild(card);
            });
        } else if (tab === 'chars') {
            Object.values(CHARACTERS).forEach((c, index) => {
                if (!c.price) return;
                const owned = store.ownsCharacter(c.id);
                const card = document.createElement('div');
                card.className = `shop-card char-${c.id} ${owned ? 'owned' : ''}`;
                card.innerHTML = `<div class="char-emoji">${c.emoji}</div><div class="char-name">${c.name}</div><div class="char-desc">${c.desc}</div>${owned ? '<div class="shop-owned">Owned</div>' : `<button class="btn btn-primary btn-small shop-buy" data-type="char" data-id="${c.id}">🪙 ${c.price}</button>`}`;
                grid.appendChild(card);
            });
        } else if (tab === 'balls') {
            Object.entries(BALL_SKINS).forEach(([id, b]) => {
                if (id === 'classic') return;
                const owned = store.ownsBall(id);
                const card = document.createElement('div');
                card.className = `shop-card ball-skin rarity-${b.rarity || 'common'} ${owned ? 'owned' : ''}`;
                const equipped = store.get('equippedBall') === id;
                card.innerHTML = `<div class="ball-inspect-stage"><div class="ball-preview" style="background:${'#'+b.color.toString(16).padStart(6,'0')}"></div><span class="ball-inspect-trail" aria-hidden="true"></span></div><div class="char-name">${b.name}</div><button class="btn btn-small ball-inspect" data-id="${id}" aria-pressed="false">Inspect trail</button>${owned ? (equipped ? '<div class="shop-owned">✔ Equipped</div>' : `<button class="btn btn-small shop-equip" data-type="ball" data-id="${id}">🎯 Equip</button>`) : `<button class="btn btn-primary btn-small shop-buy" data-type="ball" data-id="${id}">🪙 150</button>`}`;
                const preview = card.querySelector('.ball-preview');
                if (preview) {
                    preview.style.background = '';
                    preview.dataset.effect = b.effect || 'core';
                    preview.style.setProperty('--ball-color', `#${b.color.toString(16).padStart(6, '0')}`);
                    preview.style.setProperty('--ball-glow', `#${b.glow.toString(16).padStart(6, '0')}`);
                }
                if (b.rarity) {
                    const rarity = document.createElement('div');
                    rarity.className = 'ball-rarity';
                    rarity.textContent = b.rarity;
                    card.querySelector('.char-name')?.after(rarity);
                }
                const buy = card.querySelector('.shop-buy');
                if (buy) buy.textContent = `COINS ${b.price || 150}`;
                grid.appendChild(card);
            });
        } else if (tab === 'skills') {
            Object.values(SKILLS).forEach(s => {
                const owned = store.ownsSkill(s.id);
                const card = document.createElement('div');
                card.className = `shop-card ${owned ? 'owned' : ''}`;
                card.innerHTML = `<div class="skill-emoji">${s.emoji}</div><div class="char-name">${s.name}</div><div class="char-desc">${s.desc}</div>${owned ? '<div class="shop-owned">Owned</div>' : `<button class="btn btn-primary btn-small shop-buy" data-type="skill" data-id="${s.id}">🪙 100</button>`}`;
                grid.appendChild(card);
            });
        } else if (tab === 'avatars') {
            Object.values(AVATAR_SKINS).forEach(s => {
                if (s.id === 'default') return;
                const owned = s.price === 0 || store.hasAvatarAccess(s.id);
                const equipped = store.get('equippedAvatarSkin') === s.id;
                const card = document.createElement('div');
                card.className = `shop-card ${owned ? 'owned' : ''}`;
                card.innerHTML = `<div class="char-emoji">🎨</div><div class="char-name">${s.name}</div><div class="skin-preview" style="--skin-head:${s.head};--skin-body:${s.body};--skin-arms:${s.arms};--skin-legs:${s.legs}"></div>${owned ? (equipped ? '<div class="shop-owned">✔ Equipped</div>' : `<button class="btn btn-small shop-equip" data-type="avatar" data-id="${s.id}">Equip</button>`) : `<button class="btn btn-primary btn-small shop-buy" data-type="avatar" data-id="${s.id}">🪙 ${s.price}</button>`}`;
                grid.appendChild(card);
            });
            grid.querySelectorAll('.shop-card').forEach((card, index) => {
                const skin = Object.values(AVATAR_SKINS).filter(item => item.id !== 'default')[index];
                if (!skin || store.hasAvatarAccess(skin.id)) return;
                const trial = document.createElement('button');
                trial.className = 'btn btn-secondary btn-small shop-trial';
                trial.dataset.id = skin.id;
                trial.textContent = '15m Trial';
                card.appendChild(trial);
            });
        } else if (tab === 'wearables') {
            const equipped = store.get('equippedWearables') || {};
            Object.entries(COSMETIC_TYPES).forEach(([type, label]) => {
                const heading = document.createElement('h3');
                heading.className = 'cosmetic-category-title';
                heading.textContent = label;
                if (equipped[type] && equipped[type] !== 'none') {
                    const clear = document.createElement('button');
                    clear.className = 'btn btn-small cosmetic-clear';
                    clear.dataset.type = type;
                    clear.textContent = `Remove ${label}`;
                    heading.appendChild(clear);
                }
                grid.appendChild(heading);
                cosmeticsByType(type).forEach(item => {
                    const owned = store.ownsCosmetic(item.id);
                    const active = equipped[type] === item.id;
                    const card = document.createElement('article');
                    card.className = `shop-card cosmetic-card rarity-${item.rarity} ${owned ? 'owned' : ''} ${active ? 'equipped' : ''}`;
                    card.style.setProperty('--cosmetic-primary', item.colors[0]);
                    card.style.setProperty('--cosmetic-secondary', item.colors[1]);
                    const preview = document.createElement('div');
                    preview.className = `cosmetic-preview cosmetic-preview-${type}`;
                    preview.dataset.style = item.style;
                    preview.setAttribute('aria-hidden', 'true');
                    const name = document.createElement('div');
                    name.className = 'char-name';
                    name.textContent = item.name;
                    const rarity = document.createElement('span');
                    rarity.className = `skin-rarity rarity-${item.rarity}`;
                    rarity.textContent = item.rarity;
                    const description = document.createElement('div');
                    description.className = 'char-desc';
                    description.textContent = item.description;
                    const action = document.createElement('button');
                    action.className = owned ? 'btn btn-small shop-equip' : 'btn btn-primary btn-small shop-buy';
                    action.dataset.type = 'cosmetic';
                    action.dataset.id = item.id;
                    action.textContent = active ? 'Equipped' : owned ? 'Equip' : `COINS ${item.price}`;
                    action.disabled = active;
                    card.append(preview, name, rarity, description, action);
                    grid.appendChild(card);
                });
            });
        } else if (tab === 'boosts') {
            const card = document.createElement('div');
            card.className = 'shop-card';
            card.innerHTML = '<div class="skill-emoji">XP</div><div class="char-name">Arcade XP Boost</div><div class="char-desc">1.5x match XP for 60 minutes.</div><button class="btn btn-primary btn-small shop-buy" data-type="boost" data-id="xp-15">120 coins</button>';
            grid.appendChild(card);
        } else if (tab === 'cases') {
            Object.values(CASES).forEach(box => {
                const card = document.createElement('div');
                card.className = `shop-card case-card case-${box.id}`;
                const pity = store.getCasePityState(box.id);
                const rates = getCaseDropRates(box.id, pity.nextGuaranteed ? { minimumRarity: 'epic' } : {});
                card.innerHTML = `
                    <div class="case-art" aria-hidden="true"><i></i><span>${box.name.replace(' Case', '')}</span></div>
                    <div class="char-name">${box.name}</div>
                    <div class="case-balance">Balance: ${store.get('currency')} coins</div>
                    <div class="case-pity ${pity.nextGuaranteed ? 'ready' : ''}">
                        Epic+ guarantee: ${pity.nextGuaranteed ? 'NEXT OPEN' : `${pity.count}/${pity.threshold}`}
                    </div>
                    <div class="case-drop-rates">${rates.map(drop =>
                        `<span class="rarity-${drop.rarity} case-drop ${drop.type}">${drop.preview?.head ? `<i class="case-avatar-preview" style="--case-head:${drop.preview.head};--case-body:${drop.preview.body};--case-arms:${drop.preview.arms}"></i>` : ''}<b>${drop.name}<small>${drop.type === 'avatar' ? 'CHARACTER SKIN' : drop.type === 'ball' ? 'BALL SKIN' : drop.type === 'cosmetic' ? String(drop.preview?.type || 'COSMETIC').toUpperCase() : 'KNIFE'}</small></b><em>${(drop.chance * 100).toFixed(0)}%</em></span>`
                    ).join('')}</div>
                    <button class="btn btn-primary btn-small case-open" data-id="${box.id}">${box.price} coins / Open</button>`;
                grid.appendChild(card);
            });
        } else if (tab === 'inventory') {
            const owned = new Set(store.get('ownedKnives') || []);
            const equipped = store.get('equippedKnives') || {};
            Object.values(KNIVES).filter(knife => owned.has(knife.id)).forEach(knife => {
                const card = document.createElement('div');
                card.className = `shop-card inventory-card rarity-${knife.rarity}`;
                const kills = Number(store.get('knifeStats')?.[knife.id]) || 0;
                card.innerHTML = `<div class="knife-preview knife-preview-3d model-${knife.model}" style="--knife-color:${knife.color};--knife-accent:${knife.accent}" aria-hidden="true"></div><div class="char-name">${knife.name}</div><div class="char-desc">${knife.rarity.toUpperCase()} / ${knife.model.toUpperCase()} / ${(knife.finish || 'satin').toUpperCase()} / ${knife.teams.map(t => t.toUpperCase()).join(' + ')}</div><div class="stat-track"><span>STATTRACK</span><b>${String(kills).padStart(6, '0')}</b></div><button class="btn btn-small knife-inspect" data-id="${knife.id}">3D Inspect</button><div class="inventory-actions">${knife.teams.map(team => equipped[team] === knife.id ? `<span class="shop-owned">${team.toUpperCase()} equipped</span>` : `<button class="btn btn-small knife-equip" data-id="${knife.id}" data-team="${team}">Equip ${team}</button>`).join('')}</div>`;
                grid.appendChild(card);
            });
        }
    }

    updateContractTracker(daily, store) {
        const tracker = document.getElementById('contract-tracker');
        if (!tracker) return;
        const dailies = daily?.getChallenges?.() || [];
        const contracts = store?.getSeasonContracts?.() || [];
        const items = [
            ...dailies.filter(item => !item.claimed).slice(0, 2).map(item => ({ ...item, tag: 'DAILY' })),
            ...contracts.filter(item => !item.claimed).slice(0, 1).map(item => ({ ...item, tag: 'WEEKLY' }))
        ];
        if (!items.length) {
            tracker.dataset.ready = 'false';
            return tracker.classList.add('hidden');
        }
        tracker.dataset.ready = 'true';
        tracker.classList.add('hidden');
        tracker.innerHTML = `<header>LIVE OBJECTIVES</header>${items.map(item => {
            const progress = Math.min(item.target, item.progress || 0);
            return `<div class="contract-track-row"><small>${item.tag}</small><b>${item.name}</b><span>${progress}/${item.target}</span><i><em style="width:${Math.round(progress / item.target * 100)}%"></em></i></div>`;
        }).join('')}`;
    }

    showCaseReel(box, result) {
        const overlay = document.getElementById('case-reel');
        const track = document.getElementById('case-reel-track');
        const resultEl = document.getElementById('case-reel-result');
        if (!overlay || !track || !resultEl || !result?.reward) return;
        const drops = getCaseDropRates(box?.id);
        const targetIndex = 24;
        const items = Array.from({ length: 31 }, (_, index) => drops[index % Math.max(1, drops.length)] || result.reward);
        items[targetIndex] = result.reward;
        track.className = 'case-reel-track';
        track.innerHTML = items.map(item => {
            const type = item.type === 'avatar' ? 'CHARACTER SKIN'
                : item.type === 'ball' ? 'BALL SKIN'
                : item.type === 'cosmetic' ? String(item.preview?.type || 'COSMETIC').toUpperCase()
                : item.model === 'butterfly' ? 'BUTTERFLY KNIFE'
                : item.model === 'karambit' ? 'KARAMBIT'
                : 'KNIFE';
            return `<div class="case-reel-item rarity-${item.rarity || result.reward.rarity}"><span class="case-reel-orb ${item.type === 'avatar' ? 'avatar' : ''}" aria-hidden="true"></span><small>${type}</small><b>${item.name || item.id}</b></div>`;
        }).join('');
        resultEl.textContent = '';
        const preview = document.getElementById('case-reward-preview');
        if (preview) {
            preview.className = 'case-reward-preview';
            preview.removeAttribute('style');
        }
        overlay.classList.remove('hidden');
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            track.classList.add('settled');
            const rewardPreview = document.getElementById('case-reward-preview');
            if (rewardPreview) {
                rewardPreview.className = `case-reward-preview active rarity-${result.reward.rarity || 'common'} ${result.reward.type === 'avatar' ? 'avatar' : `model-${result.reward.model || 'classic'}`}`;
                rewardPreview.style.setProperty('--reward-color', result.reward.color || result.reward.body || '#55eadc');
                rewardPreview.style.setProperty('--reward-accent', result.reward.accent || result.reward.head || '#153e64');
            }
            resultEl.innerHTML = `<span>${result.duplicate ? `Duplicate +${result.refund}` : 'UNLOCKED - INVENTORY READY'}</span><strong>${result.reward.name}</strong>`;
            this.onCaseRewardReveal?.(result.reward);
            setTimeout(() => overlay.classList.add('hidden'), 3600);
        };
        requestAnimationFrame(() => {
            const selected = track.children[targetIndex];
            const stop = overlay.querySelector('.case-reel-window').clientWidth / 2
                - (selected.offsetLeft + selected.offsetWidth / 2);
            track.style.setProperty('--case-reel-stop', `${Math.round(stop)}px`);
            track.getBoundingClientRect();
            requestAnimationFrame(() => track.classList.add('spin'));
        });
        const timer = setTimeout(finish, 3700);
        document.getElementById('case-reel-skip')?.addEventListener('click', () => { clearTimeout(timer); finish(); }, { once: true });
    }

    // ===== BATTLEPASS EKRANI =====
    renderBattlepass(store) {
        const track = document.getElementById('bp-track');
        const tierEl = document.getElementById('bp-tier');
        const xpEl = document.getElementById('bp-xp');
        const bp = store.getBattlepassProgress();
        if (tierEl) tierEl.textContent = bp.tier;
        if (xpEl) xpEl.textContent = bp.xp;
        if (!track) return;
        track.innerHTML = '';
        const rewards = store.getBattlepassRewards();
        const nextReward = rewards.find(reward => reward.tier > bp.tier);
        const nextEl = document.getElementById('bp-next-reward');
        const ringEl = document.getElementById('bp-progress-ring');
        const ring = document.querySelector('.progression-ring');
        if (nextEl) nextEl.textContent = nextReward
            ? `Tier ${nextReward.tier}: ${nextReward.name}`
            : 'Season track complete';
        if (ringEl) ringEl.textContent = `${bp.xp}%`;
        if (ring) ring.style.setProperty('--bp-progress', `${bp.xp}%`);
        rewards.forEach(r => {
            const div = document.createElement('div');
            const claimed = bp.claimed.includes(r.tier);
            const unlocked = bp.tier >= r.tier;
            div.className = `bp-tier ${claimed ? 'claimed' : ''} ${!unlocked ? 'locked' : ''}`;
            const label = r.type === 'currency' ? `+${r.amount}🪙` : `${r.type === 'character' ? '🦸' : r.type === 'ball' ? '🏐' : r.type === 'skill' ? '⚡' : '🔷'} ${r.name}`;
            div.innerHTML = `<div class="bp-tier-num">${r.tier}</div><div class="bp-reward">${label}</div>${unlocked && !claimed ? `<button class="btn btn-primary btn-small bp-claim" data-tier="${r.tier}">Claim</button>` : ''}`;
            track.appendChild(div);
        });
    }

    // ===== ACHIEVEMENTS EKRANI =====
    renderAchievements(store) {
        const grid = document.getElementById('achievement-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const unlocked = store.get('unlockedAchievements') || [];
        Object.values(ACHIEVEMENTS).forEach(a => {
            const isUnlocked = unlocked.includes(a.id);
            const card = document.createElement('div');
            card.className = `achievement-card ${isUnlocked ? 'unlocked' : 'locked'}`;
            card.innerHTML = `
                <div class="ach-emoji">${a.emoji}</div>
                <div class="ach-name">${a.name}</div>
                <div class="ach-desc">${a.desc}</div>
                <div class="ach-reward">🪙 ${a.reward}</div>
                ${isUnlocked ? '<div class="ach-check">✅</div>' : '<div class="ach-lock">🔒</div>'}
            `;
            grid.appendChild(card);
        });
    }

    // ===== DAILY CHALLENGES EKRANI =====
    renderDaily(daily, store) {
        const grid = document.getElementById('daily-grid');
        if (!grid) return;
        grid.innerHTML = '';
        if (store) {
            const state = store.getDailyRewardState();
            const login = document.createElement('div');
            login.className = `daily-card daily-login-card ${state.loginClaimed ? 'claimed' : 'ready'}`;
            login.innerHTML = `
                <div class="daily-emoji">7D</div>
                <div class="daily-name">Daily Login</div>
                <div class="daily-count">Day ${state.streak}/7 - ${state.loginCoins} coins</div>
                <button class="btn btn-primary btn-small daily-login-claim" ${state.loginClaimed ? 'disabled' : ''}>
                    ${state.loginClaimed ? 'Claimed' : 'Claim Coins'}
                </button>`;
            grid.appendChild(login);

            const freeCase = document.createElement('div');
            const dailyPity = store.getCasePityState('kickoff');
            const dailyRates = getCaseDropRates('kickoff', dailyPity.nextGuaranteed ? { minimumRarity: 'epic' } : {});
            freeCase.className = `daily-card daily-case-card ${state.freeCaseClaimed ? 'claimed' : 'ready'}`;
            freeCase.innerHTML = `
                <div class="daily-emoji">CASE</div>
                <div class="daily-name">Daily Kickoff Case</div>
                <div class="daily-count">One free opening every day</div>
                <div class="case-pity ${dailyPity.nextGuaranteed ? 'ready' : ''}">
                    Epic+ guarantee: ${dailyPity.nextGuaranteed ? 'THIS OPEN' : `${dailyPity.count}/10`}
                </div>
                <div class="case-drop-rates">${dailyRates.map(drop =>
                    `<span class="rarity-${drop.rarity}"><b>${drop.name}</b><em>${(drop.chance * 100).toFixed(0)}%</em></span>`
                ).join('')}</div>
                <button class="btn btn-primary btn-small daily-case-open" data-id="kickoff" ${state.freeCaseClaimed ? 'disabled' : ''}>
                    ${state.freeCaseClaimed ? 'Opened Today' : 'Open Free'}
                </button>`;
            grid.appendChild(freeCase);
        }
        const challenges = daily.getChallenges();
        challenges.forEach(c => {
            const pct = Math.min(100, (c.progress / c.target) * 100);
            const done = c.progress >= c.target;
            const card = document.createElement('div');
            card.className = `daily-card ${c.claimed ? 'claimed' : ''} ${done && !c.claimed ? 'ready' : ''}`;
            card.innerHTML = `
                <div class="daily-emoji">${c.emoji}</div>
                <div class="daily-name">${c.name}</div>
                <div class="daily-progress-bar"><div class="daily-progress-fill" style="width:${pct}%"></div></div>
                <div class="daily-count">${c.progress}/${c.target}</div>
                <div class="ach-reward">🪙 ${c.reward}</div>
                ${done && !c.claimed ? `<button class="btn btn-primary btn-small daily-claim" data-id="${c.id}">Claim</button>` : ''}
                ${c.claimed ? '<div class="ach-check">✅</div>' : ''}
            `;
            grid.appendChild(card);
        });
    }

    // ===== RANKED EKRANI =====
    renderRanked(store) {
        const el = document.getElementById('ranked-info');
        if (!el) return;
        const elo = store.getElo();
        const prog = getRankProgress(elo);
        const stats = store.get('stats');
        el.innerHTML = `
            <div class="ranked-rank" style="color:${prog.rank.color}">
                <span class="ranked-emoji">${prog.rank.emoji}</span>
                <span class="ranked-name">${prog.rank.name}</span>
            </div>
            <div class="ranked-elo">ELO: ${elo}</div>
            <div class="ranked-progress-bar"><div class="ranked-progress-fill" style="width:${prog.pct}%;background:${prog.rank.color}"></div></div>
            ${prog.next ? `<div class="ranked-next">Next: ${prog.next.emoji} ${prog.next.name} (${prog.next.min - elo} ELO)</div>` : '<div class="ranked-next">Max rank reached! 👑</div>'}
            <div class="ranked-stats">
                <div>Ranked Games: ${stats.rankedGames || 0}</div>
                <div>Win Streak: ${store.getWinStreak()} 🔥</div>
                <div>Total Wins: ${stats.totalWins}</div>
            </div>
        `;
    }

    renderCareer(store) {
        const el = document.getElementById('ranked-info');
        if (!el) return;
        const elo = store.getElo();
        const prog = getRankProgress(elo);
        const stats = store.get('stats');
        const games = Math.max(0, stats.gamesPlayed || 0);
        const wins = Math.max(0, stats.totalWins || 0);
        const winRate = games ? Math.round(wins / games * 100) : 0;
        const contracts = store.getSeasonContracts();
        const rankedState = store.get('rankedState') || {};
        const season = rankedState.currentSeason || {};
        const history = Array.isArray(season.matches) ? season.matches.slice(-8).reverse() : [];
        const placementTarget = Number(season.placements?.required) || 5;
        const placementGames = Math.min(
            placementTarget,
            Number(season.placements?.completed) || 0
        );
        el.innerHTML = `
            <div class="career-dashboard">
                <section class="career-rank-card">
                    <span class="shell-kicker">CURRENT RANK</span>
                    <div class="ranked-rank" style="color:${prog.rank.color}">
                        <span class="ranked-emoji">${prog.rank.emoji}</span>
                        <span class="ranked-name">${prog.rank.name}</span>
                    </div>
                    <div class="ranked-elo">${elo} ELO</div>
                    <div class="ranked-progress-bar"><div class="ranked-progress-fill" style="width:${prog.pct}%;background:${prog.rank.color}"></div></div>
                    <div class="ranked-next">${prog.next ? `${prog.next.min - elo} ELO to ${prog.next.name}` : 'Top rank reached'}</div>
                </section>
                <section class="career-stats-grid">
                    <div class="career-stat-card"><b>${games}</b><span>Matches</span></div>
                    <div class="career-stat-card"><b>${wins}</b><span>Wins</span></div>
                    <div class="career-stat-card"><b>${winRate}%</b><span>Win rate</span></div>
                    <div class="career-stat-card"><b>${stats.totalHits || 0}</b><span>Hits</span></div>
                    <div class="career-stat-card"><b>${stats.totalDeflects || 0}</b><span>Deflects</span></div>
                    <div class="career-stat-card"><b>${store.getWinStreak()}</b><span>Win streak</span></div>
                </section>
                <section class="career-milestones">
                    <div class="career-milestone-card"><span class="shell-kicker">RALLY</span><strong>${stats.bestRally || 0}</strong><p>Best rally chain</p></div>
                    <div class="career-milestone-card"><span class="shell-kicker">RANKED</span><strong>${stats.rankedGames || 0}</strong><p>Competitive matches</p></div>
                    <div class="career-milestone-card"><span class="shell-kicker">MASTERY</span><strong>${store.get('level') || 1}</strong><p>Account level</p></div>
                </section>
                <section class="career-season-history">
                    <header><span class="shell-kicker">COMPETITIVE</span><h2>${season.id || 'Launch Season'}</h2><small>Placements ${placementGames}/${placementTarget}</small></header>
                    <div class="career-placement-track"><i style="width:${placementGames / placementTarget * 100}%"></i></div>
                    <div class="career-history-list">${history.length ? history.map(match => `<div><b class="${match.result === 'win' ? 'win' : 'loss'}">${match.result.toUpperCase()}</b><span>Opponent ${match.opponentElo} ELO</span><strong>${match.delta >= 0 ? '+' : ''}${match.delta || 0} ELO</strong></div>`).join('') : '<p>Complete competitive matches to build your history.</p>'}</div>
                </section>
                <section class="career-contracts">
                    <header><span class="shell-kicker">LAUNCH SEASON</span><h2>Season Contracts</h2></header>
                    <div class="career-contract-grid">${contracts.map(contract => {
                        const pct = Math.min(100, contract.progress / contract.target * 100);
                        const ready = contract.progress >= contract.target && !contract.claimed;
                        return `<article class="career-contract ${ready ? 'ready' : ''} ${contract.claimed ? 'claimed' : ''}">
                            <div><strong>${contract.name}</strong><span>${contract.description}</span></div>
                            <div class="career-contract-track"><i style="width:${pct}%"></i></div>
                            <small>${Math.floor(contract.progress)}/${contract.target} - ${contract.reward} coins</small>
                            ${ready ? `<button class="btn btn-primary btn-small contract-claim" data-id="${contract.id}">Claim</button>` : ''}
                            ${contract.claimed ? '<b class="contract-complete">COMPLETED</b>' : ''}
                        </article>`;
                    }).join('') || '<p class="career-empty">No active season contracts.</p>'}</div>
                </section>
            </div>`;
    }

    _renderClassSwitch(game) {
        const list = document.getElementById('class-switch-list');
        const status = document.getElementById('class-switch-status');
        const detail = document.getElementById('class-switch-detail');
        if (!list) return;
        const round = Number(game.scoreboard?.roundNum) || 0;
        const locked = game.state === 'PLAYING' && game.player?._classChangeRound === round;
        if (status) status.textContent = locked ? 'Class change used this round' : 'One change per round';
        const selected = CHARACTERS[game.player?.charId] || CHARACTERS.rally;
        if (detail) {
            detail.replaceChildren();
            const badge = document.createElement('span');
            badge.className = 'class-switch-detail-badge';
            badge.textContent = selected.emoji || selected.name.slice(0, 1);
            badge.style.setProperty('--class-color', `#${selected.color.toString(16).padStart(6, '0')}`);
            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = selected.name;
            const desc = document.createElement('p');
            desc.textContent = selected.desc;
            copy.append(title, desc);
            const stats = document.createElement('small');
            stats.textContent = `HP ${selected.maxHp} | SPD ${selected.speed} | POWER ${selected.deflectPower.toFixed(2)}`;
            detail.append(badge, copy, stats);
        }
        list.replaceChildren(...Object.values(CHARACTERS).map(character => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `class-switch-choice${game.player?.charId === character.id ? ' selected' : ''}`;
            button.setAttribute('role', 'listitem');
            button.setAttribute('aria-label', `${character.name}: ${character.desc}`);
            button.style.setProperty('--class-color', `#${character.color.toString(16).padStart(6, '0')}`);
            const badge = document.createElement('span');
            badge.className = 'class-switch-avatar';
            badge.textContent = character.emoji || character.name.slice(0, 1);
            const name = document.createElement('b');
            name.textContent = character.name;
            const stat = document.createElement('small');
            stat.textContent = `${character.maxHp} HP`;
            button.append(badge, name, stat);
            button.disabled = locked || game.player?.charId === character.id;
            button.addEventListener('click', () => this.onClassSelect?.(character.id));
            return button;
        }));
    }

    // ===== LEADERBOARD EKRANI =====
    renderLeaderboard(store, filter = 'global') {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        const top = Leaderboard.getFiltered(filter, {
            limit: 20,
            friends: store.get('socialProfile')?.friends || [],
            classId: store.get('selectedChar')
        });
        const myElo = store.getElo();
        const myName = 'You';
        top.forEach((p, i) => {
            const displayElo = p.displayElo ?? p.elo;
            const rank = getRank(displayElo);
            const isMe = p.name === myName;
            const row = document.createElement('tr');
            row.className = isMe ? 'is-you' : '';
            const cells = [i + 1, `${p.name}${isMe ? ' (You)' : ''}`, displayElo, `${rank.emoji} ${rank.name}`];
            cells.forEach((value, index) => {
                const cell = document.createElement('td');
                cell.textContent = String(value);
                if (index === 3) cell.style.color = rank.color;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        const playerRank = document.getElementById('leaderboard-your-rank');
        if (playerRank) {
            const rank = getRank(myElo);
            playerRank.innerHTML = `<span>YOUR POSITION</span><strong>#${Leaderboard.getPlayerRank(myElo)}</strong><b style="color:${rank.color}">${rank.emoji} ${rank.name}</b><em>${myElo} ELO</em>`;
        }
    }

    renderReplays(replays) {
        const list = document.getElementById('replay-list');
        if (!list) return;
        list.innerHTML = '';
        if (!replays.length) {
            list.innerHTML = '<p>No saved replays yet.</p>';
            return;
        }
        replays.slice().reverse().forEach((replay, reverseIndex) => {
            const index = replays.length - 1 - reverseIndex;
            const card = document.createElement('div');
            card.className = 'replay-card';
            const duration = Math.max(0, Math.round((replay.duration || 0) / 1000));
            const highlights = replay.highlights || [];
            card.innerHTML = `
                <div>
                    <strong>${replay.meta?.map || 'Unknown map'}</strong>
                    <span>${replay.meta?.mode || 'classic'} - ${duration}s - ${(replay.events || []).length} events</span>
                    ${highlights.length ? `<div class="replay-highlights">${highlights.map((highlight, highlightIndex) =>
                        `<button class="replay-highlight" data-index="${index}" data-highlight="${highlightIndex}">
                            <span>HIGHLIGHT ${highlightIndex + 1}</span><b>${highlight.label}</b>
                        </button><button class="replay-highlight-copy" data-index="${index}" data-highlight="${highlightIndex}" aria-label="Copy highlight ${highlightIndex + 1}">Copy</button>`
                    ).join('')}</div>` : '<small class="replay-no-highlight">No highlight event detected</small>'}
                </div>
                <div class="btn-row">
                    <button class="btn btn-small replay-play" data-index="${index}">Play</button>
                    <button class="btn btn-small replay-export" data-index="${index}">Copy</button>
                    <button class="btn btn-small btn-secondary replay-delete" data-index="${index}">Delete</button>
                </div>`;
            list.appendChild(card);
        });
    }

    // ===== TOURNAMENT EKRANI =====
    async renderTournament(tournament) {
        const el = document.getElementById('tournament-bracket');
        if (!el) return;
        const bracket = tournament.getBracket();
        if (!bracket) { el.innerHTML = '<p>No active tournament</p>'; return; }
        el.innerHTML = '';
        bracket.rounds.forEach((round, ri) => {
            const roundDiv = document.createElement('div');
            roundDiv.className = 'bracket-round';
            roundDiv.innerHTML = `<h3>Round ${ri+1}</h3>`;
            round.forEach(m => {
                const matchDiv = document.createElement('div');
                matchDiv.className = `bracket-match ${m.played ? 'played' : ''}`;
                const p1Win = m.winner === m.p1;
                const p2Win = m.winner === m.p2;
                matchDiv.innerHTML = `
                    <div class="bracket-player ${p1Win ? 'win' : ''}">${m.p1} ${m.played ? `<span>${m.score1}</span>` : ''}</div>
                    <div class="bracket-player ${p2Win ? 'win' : ''}">${m.p2} ${m.played ? `<span>${m.score2}</span>` : ''}</div>
                    ${!m.played && !m.p1.startsWith('BYE') && !m.p2.startsWith('BYE') ? `<button class="btn btn-primary btn-small bracket-play" data-match="${m.id}">Play</button>` : ''}
                `;
                roundDiv.appendChild(matchDiv);
            });
            el.appendChild(roundDiv);
        });
        if (bracket.champion) {
            const champDiv = document.createElement('div');
            champDiv.className = 'bracket-champion';
            champDiv.innerHTML = `🏆 Champion: ${bracket.champion}`;
            el.appendChild(champDiv);
        }
    }

    showProfile() {
        const stats = MatchHistory.getStats();
        const elo = this.store?.data?.elo || 1000;
        const { rank, pct } = getRankProgress(elo);

        document.getElementById('profile-rank').innerHTML = `
            <div class="rank-icon">${rank.emoji}</div>
            <div class="rank-name" style="color:${rank.color}">${rank.name}</div>
            <div class="rank-progress"><div class="rank-bar" style="width:${pct}%"></div></div>
            <div style="color:#aaa;font-size:12px">${elo} ELO</div>`;

        document.getElementById('profile-stats').innerHTML = `
            <div class="stat-card"><div class="stat-value">${stats.wins}</div><div class="stat-label">Wins</div></div>
            <div class="stat-card"><div class="stat-value">${stats.losses}</div><div class="stat-label">Losses</div></div>
            <div class="stat-card"><div class="stat-value">${MatchHistory.getWinRate()}%</div><div class="stat-label">Win Rate</div></div>
            <div class="stat-card"><div class="stat-value">${stats.kills}</div><div class="stat-label">Kills</div></div>
            <div class="stat-card"><div class="stat-value">${stats.deaths}</div><div class="stat-label">Deaths</div></div>
            <div class="stat-card"><div class="stat-value">${stats.damage}</div><div class="stat-label">Damage</div></div>`;

        this.showScreen('screen-profile');
    }

    hideProfile() { this.showScreen('mainMenu'); }

    showMatchResult(winner, stats) {
        const el = document.getElementById('match-result');
        if (!el) return;
        const textEl = el.querySelector('.result-text');
        const isVictory = winner === 'red' || winner === 'blue';
        textEl.textContent = isVictory ? 'VICTORY' : 'DEFEAT';
        textEl.className = 'result-text ' + (isVictory ? 'victory' : 'defeat');
        document.getElementById('mr-kills').textContent = stats.kills || 0;
        document.getElementById('mr-deaths').textContent = stats.deaths || 0;
        document.getElementById('mr-damage').textContent = Math.round(stats.damage || 0);
        el.classList.remove('hidden');
        requestAnimationFrame(() => el.classList.add('show'));
    }
}
import { getCompetitiveHUDView } from './competitive-hud.js';
