// ui.js — Full UI: menus, HUD, chat, minimap, scoreboard, skill cooldown, kill feed,
// damage meter, character select, shop, battlepass.
import { CHARACTERS } from './characters.js';
import { SKILLS, RUNES } from './skills.js';
import { BALL_SKINS } from './ball.js';
import { ACHIEVEMENTS } from './achievements.js';
import { getRank, getRankProgress } from './ranked.js';
import { Leaderboard } from './leaderboard.js';
import { Tutorial, TUTORIAL_STEPS } from './tutorial.js';

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
            achievements: document.getElementById('achievements-screen'),
            daily: document.getElementById('daily-screen'),
            ranked: document.getElementById('ranked-screen'),
            leaderboard: document.getElementById('leaderboard-screen'),
            tournament: document.getElementById('tournament-screen'),
            tutorial: document.getElementById('tutorial-screen')
        };
    }

    showScreen(name) {
        Object.values(this.screens).forEach(s => { if (s) s.classList.add('hidden'); });
        if (this.screens[name]) this.screens[name].classList.remove('hidden');
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

        if (el('hud-timer')) el('hud-timer').textContent = time;
        if (el('hud-red-score')) el('hud-red-score').textContent = redScore;
        if (el('hud-blue-score')) el('hud-blue-score').textContent = blueScore;
        if (el('hud-speed')) {
            const pct = Math.round((ballSpeed / 14) * 100);
            el('hud-speed').textContent = `🏐 ${pct}%`;
            if (pct > 250) el('hud-speed').style.color = '#ff00ff';
            else if (pct > 160) el('hud-speed').style.color = '#ff5555';
            else if (pct > 120) el('hud-speed').style.color = '#ffaa33';
            else el('hud-speed').style.color = '#55ff88';
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
            const level = p.level || (p.isBot ? Math.floor(Math.random() * 20 + 1) : (store?.get?.('level') || 1));
            row.innerHTML = `
                <td class="team-${p.team}">${p.name}${p.isYou ? ' 👈' : ''}</td>
                <td>${p.team.toUpperCase()}</td>
                <td>${rank}</td>
                <td>${level}</td>
                <td>${p.score}</td>
                <td>${p.deflections}</td>
                <td>${p.hits}</td>
            `;
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
        // Lobby leader = host, or solo (not connected) → you lead.
        const isHost = !game.network || !game.network.connected || game.network.isHost;
        redList.innerHTML = '';
        blueList.innerHTML = '';

        // Overwatch-style: each player is a clickable row. Clicking moves them to
        // the OTHER team. Host can move anyone; a non-host can only move themselves.
        players.forEach(p => {
            const li = document.createElement('li');
            const isYou = p.name === game.playerName;
            li.textContent = (p.isBot ? '🤖 ' : isYou ? '⭐ ' : '') + p.name;
            if (isYou) li.classList.add('you');
            const canMove = isHost || isYou;
            if (canMove) {
                li.classList.add('clickable');
                li.title = 'Click → switch team';
                li.onclick = () => {
                    const dest = p.team === 'red' ? 'blue' : 'red';
                    if (isYou) game.switchTeam(dest);
                    else game.switchPlayerTeam(p.name, dest);
                    this._renderTeamLists(game);
                };
            }
            (p.team === 'red' ? redList : blueList).appendChild(li);
        });

        const balance = document.getElementById('team-balance-toggle');
        const joinBtn = (id, team) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.onclick = () => {
                const autoBalance = balance?.checked ?? true;
                const counts = { red: 0, blue: 0 };
                players.forEach(p => counts[p.team]++);
                if (autoBalance && counts[team] > counts[team === 'red' ? 'blue' : 'red']) return;
                game.switchTeam(team);
                this._renderTeamLists(game);
            };
        };
        joinBtn('btn-team-popup-red', 'red');
        joinBtn('btn-team-popup-blue', 'blue');

        // Spectator enter/leave — wired by main.js via callbacks so ui.js stays
        // free of the Spectator import. Label reflects current spectator state.
        const specBtn = document.getElementById('btn-team-popup-spectate');
        if (specBtn && this.onToggleSpectate) {
            specBtn.textContent = this.spectating ? '↩ Leave Spectator' : '👁 Spectate';
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
        document.getElementById('pg-stats').innerHTML = `<span>💥 ${kills} kills</span><span>🏐 ${deflects} deflects</span>`;
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

    showCombo(text, duration = 2.0) {
        const el = document.getElementById('combo-display');
        if (!el) return;
        el.textContent = text;
        el.classList.remove('hidden');
        el.classList.add('combo-pop');
        // Color based on combo level
        const colors = { 'FIRST BLOOD': '#ff6644', 'DOUBLE KILL': '#ffaa00', 'TRIPLE KILL': '#ffdd00', 'QUADRA KILL': '#55ff88', 'PENTA KILL': '#44aaff', 'ACE': '#ff44ff' };
        el.style.color = colors[text] || '#ff8844';
        setTimeout(() => el.classList.remove('combo-pop'), 300);
        setTimeout(() => el.classList.add('hidden'), duration * 1000);
    }

    spawnDamageNumber(screenX, screenY, dmg, lethal = false) {
        const existing = document.querySelectorAll('.dmg-num');
        if (existing.length > 8) {
            const oldest = existing[0];
            if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
        }
        const el = document.createElement('div');
        el.className = 'dmg-num' + (lethal ? ' lethal' : '');
        el.textContent = '-' + dmg;
        el.style.left = screenX + 'px';
        el.style.top = screenY + 'px';
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.style.transform = 'translateY(-40px)';
            el.style.opacity = '0';
        });
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 800);
    }

    updateLobbyPlayers(players, isHost) {
        document.getElementById('cs-team-red').innerHTML = '';
        document.getElementById('cs-team-blue').innerHTML = '';
        const reds = players.filter(p => p.team === 'red');
        const blues = players.filter(p => p.team === 'blue');
        const renderCard = (p, container) => {
            const card = document.createElement('div');
            card.className = `cs-player-card${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}`;
            card.draggable = !!isHost;
            card.dataset.playerName = p.name;
            card.dataset.playerTeam = p.team;
            const char = CHARACTERS[p.charId] || CHARACTERS.rally;
            const avatarData = window.__store?.get?.('customAvatar');
            const avatarHTML = avatarData?.dataURL
                ? `<img src="${avatarData.dataURL}">`
                : (char?.emoji || '👤');
            card.innerHTML = `
                <div class="cs-player-avatar">${avatarHTML}</div>
                <div class="cs-player-info">
                    <div class="cs-player-name${p.isYou ? ' you' : ''}${p.isBot ? ' bot' : ''}">${this.escapeHTML(p.name)} ${p.isBot ? '🤖' : ''}</div>
                    <div class="cs-player-sub"><span class="char-emoji-sm">${char.emoji || ''}</span> ${char.name || ''}</div>
                </div>
                ${isHost && !p.isYou ? '<button class="cs-btn-kick" data-kick-name="'+this.escapeHTML(p.name)+'" data-kick-bot="'+(p.isBot?1:0)+'" title="Kick">✕</button>' : ''}
            `;
            container.appendChild(card);
        };
        reds.forEach(p => renderCard(p, document.getElementById('cs-team-red')));
        blues.forEach(p => renderCard(p, document.getElementById('cs-team-blue')));
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
        const hpFill = document.getElementById('hp-fill');
        const shieldFill = document.getElementById('shield-fill');
        const staFill = document.getElementById('stamina-fill');
        const hpNum = document.getElementById('hp-num');
        if (hpFill) hpFill.style.width = `${Math.max(0, hp / maxHp * 100)}%`;
        if (shieldFill) shieldFill.style.width = `${Math.max(0, (shield || 0) / maxHp * 100)}%`;
        if (staFill) {
            staFill.style.width = `${Math.max(0, stamina / staminaMax * 100)}%`;
            staFill.classList.toggle('exhausted', !!exhausted);
        }
        if (hpNum) hpNum.textContent = Math.ceil(hp);
    }

    // Red damage vignette flash (when the local player is hit)
    flashHit() {
        const el = document.getElementById('hit-flash');
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth; // restart animation
        el.classList.add('flash');
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

    // Kill feed — sağ üstte son hasarlar.
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
    updateCombo(combo, multiplier) {
        let el = document.getElementById('combo-display');
        if (!el) {
            el = document.createElement('div');
            el.id = 'combo-display';
            el.className = 'combo-display';
            document.body.appendChild(el);
        }
        if (combo >= 2) {
            el.textContent = `${combo}x COMBO`;
            el.style.opacity = '1';
            el.style.transform = `scale(${1 + Math.min(0.5, combo * 0.05)})`;
        } else {
            el.style.opacity = '0';
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
            card.className = `char-card ${isSelected ? 'selected' : ''} ${!isOwned ? 'locked' : ''}`;
            card.dataset.char = c.id;
            card.innerHTML = `
                <div class="char-emoji">${c.emoji}</div>
                <div class="char-name">${c.name}</div>
                <div class="char-stats">
                    ❤️${c.maxHp} 💨${c.speed} 🎯${c.deflectPower}
                </div>
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

    // ===== TUTORIAL EKRANI =====
    renderTutorial() {
        const el = document.getElementById('tutorial-steps');
        if (!el) return;
        el.innerHTML = '';
        TUTORIAL_STEPS.forEach((s, i) => {
            const div = document.createElement('div');
            div.className = 'tutorial-step';
            div.innerHTML = `<span class="tut-num">${i+1}</span> ${s.text}`;
            el.appendChild(div);
        });
    }
}
