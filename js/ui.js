// ui.js — Full UI: menus, HUD, chat, minimap, scoreboard, skill cooldown, kill feed,
// damage meter, character select, shop, battlepass.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES } from './skills.js';
import { BALL_SKINS } from './ball.js';
import { AVATAR_SKINS } from './avatar.js';
import { ACHIEVEMENTS } from './achievements.js';
import { MatchHistory } from './matchhistory.js';
import { getRank, getRankProgress } from './ranked.js';
import { Leaderboard } from './leaderboard.js';
import { Arena } from './arena.js';

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
            leaderboard: document.getElementById('leaderboard-screen'),
            replays: document.getElementById('replays-screen'),
            social: document.getElementById('social-screen'),
            tournament: document.getElementById('tournament-screen'),
            profile: document.getElementById('screen-profile')
        };
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

    showHUD() { if (this.screens.hud) this.screens.hud.classList.remove('hidden'); }
    hideHUD() { if (this.screens.hud) this.screens.hud.classList.add('hidden'); }

    updateHUD(data) {
        const { time, redScore, blueScore, ballSpeed } = data;
        const el = id => document.getElementById(id);

        if (el('hud-round-timer')) el('hud-round-timer').textContent = time;
        if (el('hud-score-red')) el('hud-score-red').textContent = redScore;
        if (el('hud-score-blue')) el('hud-score-blue').textContent = blueScore;
        if (el('hud-speed')) {
            const pct = Math.round((ballSpeed / 17) * 100);
            el('hud-speed').textContent = `🏐 ${pct}%`;
            if (pct > 250) el('hud-speed').style.color = '#ff00ff';
            else if (pct > 160) el('hud-speed').style.color = '#ff5555';
            else if (pct > 120) el('hud-speed').style.color = '#ffaa33';
            else el('hud-speed').style.color = '#55ff88';
            // ponytail: danger pulse when ball is very fast
            if (pct > 200) {
                el('hud-speed').style.textShadow = `0 0 ${Math.min(20, (pct - 200) * 0.2)}px #ff4444`;
            } else {
                el('hud-speed').style.textShadow = 'none';
            }
        }
        // Ball speed indicator (bottom-right)
        const speedEl = document.getElementById('speed-val');
        if (speedEl && ballSpeed !== undefined) {
            speedEl.textContent = Math.round(ballSpeed);
            const ratio = ballSpeed / 17;
            speedEl.style.color = ratio > 3 ? '#ff4444' : ratio > 2 ? '#ffaa22' : 'var(--accent)';
            // ponytail: glow effect at high speed
            if (ratio > 2) {
                speedEl.style.textShadow = `0 0 ${Math.min(15, (ratio - 2) * 5)}px ${ratio > 3 ? '#ff0000' : '#ffaa00'}`;
            } else {
                speedEl.style.textShadow = 'none';
            }
        }
    }

    updateScoreboard(stats) {
        this.updateScoreboardTable('scoreboard-body', stats);
    }

    updateScoreboardTable(tbodyId, stats) {
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
                String(p.team || '').toUpperCase(),
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
            tbody.appendChild(row);
        });
    }

    showScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.remove('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = '';
    }

    hideScoreboard() {
        const s = this.screens.scoreboardOverlay;
        if (s) s.classList.add('hidden');
        const dm = document.getElementById('damage-meter');
        if (dm) dm.style.display = 'none';
    }

    // Incoming indicator — red edge glow when ball is coming at you
    setPlayerTarget(isTarget) {
        const el = document.getElementById('incoming-indicator');
        if (el) el.classList.toggle('active', isTarget);
    }

    // Team switch popup (M)
    showTeamPopup(game) {
        const overlay = document.getElementById('team-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        this._renderTeamLists(game);
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
            const canMove = isHost || isYou;
            if (canMove) {
                li.classList.add('clickable');
                li.title = 'Click → switch team';
                li.onclick = () => {
                    const dest = displayTeam === 'red' ? 'blue' : 'red';
                    if (isYou) game.switchTeam(dest);
                    else game.switchPlayerTeam(p.name, dest);
                    this._renderTeamLists(game);
                };
            }
            (displayTeam === 'red' ? redList : blueList).appendChild(li);
        });

        // TF2/CSGO-style: click team header to join
        const joinTeam = (team) => {
            game.switchTeam(team);
            this._renderTeamLists(game);
        };
        const headerRed = document.getElementById('team-header-red');
        const headerBlue = document.getElementById('team-header-blue');
        if (headerRed) headerRed.onclick = () => joinTeam('red');
        if (headerBlue) headerBlue.onclick = () => joinTeam('blue');

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

    showGameOver(winner, stats) {
        this.showScreen('gameOver');
        const el = document.getElementById('winner-text');
        if (el) {
            el.textContent = winner === 'DRAW' ? "It's a Draw!" : `${winner} Team Wins!`;
            el.className = `winner-${winner.toLowerCase()}`;
        }
        this.updateScoreboard(stats);
        this.updateScoreboardTable('scoreboard-body-final', stats);
    }

    showCountdown(num, callback) {
        const el = document.getElementById('countdown');
        if (!el) return;
        el.classList.remove('hidden');
        el.textContent = num;
        el.classList.add('countdown-anim');
        setTimeout(() => {
            el.classList.remove('countdown-anim');
            if (num > 1) {
                this.showCountdown(num - 1, callback);
            } else {
                el.textContent = 'GO!';
                setTimeout(() => { el.classList.add('hidden'); if (callback) callback(); }, 500);
            }
        }, 1000);
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
        const dings = Math.min(10, Math.ceil(perc / 10));
        let delay = 0;
        for (let i = 0; i < dings; i++) {
            setTimeout(() => {
                if (audio?.playDing) audio.playDing(660 + i * 40, 0.16);
            }, delay);
            delay += 150;
        }
        document.getElementById('pg-play-again')?.addEventListener('click', () => { el.classList.add('hidden'); window._postGameAction?.('play_again'); });
        document.getElementById('pg-lobby')?.addEventListener('click', () => { el.classList.add('hidden'); window._postGameAction?.('lobby'); });
        document.getElementById('pg-main-menu')?.addEventListener('click', () => { el.classList.add('hidden'); window._postGameAction?.('main_menu'); });
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
        grid.innerHTML = '';
        const owned = store.get('unlockedChars');
        const selected = store.get('selectedChar');
        Object.values(CHARACTERS).forEach(c => {
            const card = document.createElement('div');
            const isOwned = owned.includes(c.id);
            const isSelected = selected === c.id;
            const mastery = store.getCharacterProgress(c.id);
            const masteryNeed = mastery.level < 10 ? mastery.level * 250 : 0;
            card.className = `char-card ${isSelected ? 'selected' : ''} ${!isOwned ? 'locked' : ''}`;
            card.dataset.char = c.id;
            card.innerHTML = `
                <div class="char-emoji">${c.emoji}</div>
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
            Object.values(SKILLS).forEach(s => {
                const card = document.createElement('div');
                const owned = ownedSkills.includes(s.id);
                card.className = `skill-card ${currentSkill === s.id ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.skill = s.id;
                card.innerHTML = `<div class="skill-emoji">${s.emoji}</div><div>${s.name}</div><div class="char-desc">${s.desc}</div><div>CD: ${s.cooldown}s</div>${!owned ? '<div class="char-price">🪙 100</div>' : ''}`;
                sg.appendChild(card);
            });
        }

        // Rune grid
        const rg = document.getElementById('rune-grid');
        if (rg) {
            rg.innerHTML = '';
            const ownedRunes = store.get('ownedItems');
            const currentRunes = store.get('loadout').runes || [];
            Object.values(RUNES).forEach(r => {
                const card = document.createElement('div');
                const owned = ownedRunes.includes(r.id);
                const equipped = currentRunes.includes(r.id);
                card.className = `rune-card ${equipped ? 'selected' : ''} ${!owned ? 'locked' : ''}`;
                card.dataset.rune = r.id;
                card.innerHTML = `<div class="skill-emoji">${r.emoji}</div><div>${r.name}</div><div class="char-desc">${r.desc}</div>${!owned ? '<div class="char-price">🪙 80</div>' : ''}`;
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

        if (tab === 'chars') {
            Object.values(CHARACTERS).forEach(c => {
                if (!c.price) return;
                const owned = store.ownsCharacter(c.id);
                const card = document.createElement('div');
                card.className = `shop-card ${owned ? 'owned' : ''}`;
                card.innerHTML = `<div class="char-emoji">${c.emoji}</div><div class="char-name">${c.name}</div><div class="char-desc">${c.desc}</div>${owned ? '<div class="shop-owned">Owned</div>' : `<button class="btn btn-primary btn-small shop-buy" data-type="char" data-id="${c.id}">🪙 ${c.price}</button>`}`;
                grid.appendChild(card);
            });
        } else if (tab === 'balls') {
            Object.entries(BALL_SKINS).forEach(([id, b]) => {
                if (id === 'classic') return;
                const owned = store.ownsBall(id);
                const card = document.createElement('div');
                card.className = `shop-card ${owned ? 'owned' : ''}`;
                const equipped = store.get('equippedBall') === id;
                card.innerHTML = `<div class="ball-preview" style="background:${'#'+b.color.toString(16).padStart(6,'0')}"></div><div class="char-name">${b.name}</div>${owned ? (equipped ? '<div class="shop-owned">✔ Equipped</div>' : `<button class="btn btn-small shop-equip" data-type="ball" data-id="${id}">🎯 Equip</button>`) : `<button class="btn btn-primary btn-small shop-buy" data-type="ball" data-id="${id}">🪙 150</button>`}`;
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
        } else if (tab === 'boosts') {
            const card = document.createElement('div');
            card.className = 'shop-card';
            card.innerHTML = '<div class="skill-emoji">XP</div><div class="char-name">Arcade XP Boost</div><div class="char-desc">1.5x match XP for 60 minutes.</div><button class="btn btn-primary btn-small shop-buy" data-type="boost" data-id="xp-15">120 coins</button>';
            grid.appendChild(card);
        }
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
    renderDaily(daily) {
        const grid = document.getElementById('daily-grid');
        if (!grid) return;
        grid.innerHTML = '';
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

    // ===== LEADERBOARD EKRANI =====
    renderLeaderboard(store) {
        const tbody = document.getElementById('leaderboard-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        const top = Leaderboard.getTop(20);
        const myElo = store.getElo();
        const myName = this._playerName || 'You';
        top.forEach((p, i) => {
            const rank = getRank(p.elo);
            const isMe = p.name === myName;
            const row = document.createElement('tr');
            if (isMe) row.style.background = 'rgba(255,136,0,0.2)';
            row.innerHTML = `<td>${i+1}</td><td>${p.name}${isMe ? ' (You)' : ''}</td><td>${p.elo}</td><td style="color:${rank.color}">${rank.emoji} ${rank.name}</td>`;
            tbody.appendChild(row);
        });
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
            card.innerHTML = `
                <div>
                    <strong>${replay.meta?.map || 'Unknown map'}</strong>
                    <span>${replay.meta?.mode || 'classic'} · ${duration}s · ${(replay.events || []).length} events</span>
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

    hideProfile() { this.showScreen('screen-menu'); }

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
