// main.js — App bootstrap, scene setup, game loop, screen handlers, loadout.
import * as THREE from 'three';
import { Renderer } from './renderer.js';
import { Player } from './player.js';
import { Arena } from './arena.js';
import { Game, STATES } from './game.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { Store } from './store.js';
import { DEFAULT_LOADOUT } from './skills.js';
import { AvatarPainter } from './avatar.js';
import { checkAchievements } from './achievements.js';
import { Daily } from './daily.js';
import { Replay } from './replay.js';
import { Spectator } from './spectator.js';
import { BALL_SKINS } from './ball.js';
import { Console } from './console.js';
import { Tutorial } from './tutorial.js';
import { tournament } from './tournament.js';
import { CHARACTERS } from './characters.js';

class App {
    constructor() {
        this.chatOpen = false;
        this.carouselIndex = 0;
        this.clock = new THREE.Clock();
        this.netSyncTimer = 0;
        this.netBroadcastTimer = 0;
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.2, 200);
        this.store = Store;
        this.store.load();
        window.__store = this.store; // ui.js avatar lookup
        // Init new setting toggles from store
        const portalsToggle = document.getElementById('setting-portals');
        if (portalsToggle) portalsToggle.checked = this.store.get('portalsEnabled') !== false;
        const balanceToggle = document.getElementById('setting-team-balance');
        if (balanceToggle) balanceToggle.checked = this.store.get('teamBalance') !== false;
        const dmgMult = document.getElementById('setting-damage-mult');
        if (dmgMult) dmgMult.value = this.store.get('damageMultiplier') || 1;
        this.avatarPainter = null;

        // Init systems
        const container = document.getElementById('game-container');
        this.renderer = new Renderer(container);
        this.arena = new Arena(this.renderer, 'beach_open'); // default: Beach Volleyball
        this.player = new Player(this.renderer, this.camera, this.arena);
        this.audio = new Audio();
        this.ui = new UI();
        this.network = new Network(null);
        this.game = new Game(this.renderer, this.player, this.arena, this.audio, this.ui, this.network);
        this.network.game = this.game;
        this.player.audio = this.audio;

        // Loadout uygula
        this.applyLoadout();

        this.renderer.scene.add(this.camera);

        // Resize handler — respects custom resolution
        this._customRes = null;
        window.addEventListener('resize', () => {
            if (this._customRes) {
                this.renderer.updateSize(this._customRes.w, this._customRes.h);
                this.camera.aspect = this._customRes.w / this._customRes.h;
            } else {
                this.renderer.updateSize(window.innerWidth, window.innerHeight);
                this.camera.aspect = window.innerWidth / window.innerHeight;
            }
            this.camera.updateProjectionMatrix();
        });

        // Spectate click — left=next, right=prev (no context menu)
        document.addEventListener('mousedown', e => {
            if (!this.player.alive && this.game._spectateTarget) {
                e.preventDefault();
                const teammates = this.game.bots.filter(b => b.alive && b.team === this.player.team);
                if (teammates.length > 0) {
                    const idx = teammates.indexOf(this.game._spectateTarget);
                    if (e.button === 0) {
                        this.game._spectateTarget = teammates[(idx + 1) % teammates.length];
                    } else if (e.button === 2) {
                        this.game._spectateTarget = teammates[(idx - 1 + teammates.length) % teammates.length];
                    }
                }
            }
        });
        // Block the browser right-click menu everywhere (menu, lobby, settings, in-game).
        // Right-click is still usable as a game input via mousedown button===2.
        document.addEventListener('contextmenu', e => e.preventDefault());

        // Tab key → scoreboard
        document.addEventListener('keydown', e => {
            // Console visible → skip all other handlers
            if (this.gameConsole?.visible) return;

            // While typing in chat, only Enter/Escape matter (handled below).
            if (this.chatOpen) {
                if (e.code === 'Enter') {
                    this.sendChatFromInput();
                } else if (e.code === 'Escape') {
                    this.closeChat();
                }
                return;
            }

            if (e.code === 'Tab' && this.game.state === STATES.PLAYING) {
                e.preventDefault();
                this.ui.showScoreboard();
                this.ui.updateScoreboard(this.game.scoreboard.getPlayerStats());
            }
            // Y/T/Enter → open chat during play, lobby, celebration, or post-game
            if ((e.code === 'KeyY' || e.code === 'KeyT' || e.code === 'Enter') &&
                (this.game.state === STATES.PLAYING || this.game.state === STATES.LOBBY || this.game.state === STATES.CELEBRATION || this.game.state === STATES.GAME_OVER)) {
                e.preventDefault();
                this.openChat();
            }
            // Spectate cycling when dead
            if (!this.player.alive && this.game._spectateTarget) {
                const teammates = this.game.bots.filter(b => b.alive && b.team === this.player.team);
                if (teammates.length > 0) {
                    const idx = teammates.indexOf(this.game._spectateTarget);
                    if (e.code === 'BracketRight') {
                        this.game._spectateTarget = teammates[(idx + 1) % teammates.length];
                    } else if (e.code === 'BracketLeft') {
                        this.game._spectateTarget = teammates[(idx - 1 + teammates.length) % teammates.length];
                    }
                }
            }

            // Spectator controls — but let M still open the team menu so you can
            // leave spectator from it.
            if (Spectator.active) {
                if (e.code === 'BracketRight') Spectator.cycleTarget();
                if (e.code === 'BracketLeft') Spectator.prevTarget();
                if (e.code === 'KeyF') Spectator.setFreeCam(!Spectator.freeCam);
                if (e.code === 'KeyM') { e.preventDefault(); this.toggleTeamPopup(); }
                return;
            }

            // M → team popup
            if (e.code === 'KeyM' &&
                (this.game.state === STATES.PLAYING || this.game.state === STATES.LOBBY)) {
                e.preventDefault();
                this.toggleTeamPopup();
            }
            // B → cycle ball skin in-game
            if (e.code === 'KeyB' && (this.game.state === STATES.PLAYING || this.game.state === STATES.LOBBY)) {
                e.preventDefault();
                const skins = Object.keys(BALL_SKINS);
                const owned = this.store.get('ownedBalls') || ['classic'];
                const current = this.store.get('equippedBall') || 'classic';
                let idx = skins.indexOf(current);
                let next = null;
                // Try next owned skin, loop around if needed
                for (let i = 0; i < skins.length; i++) {
                    idx = (idx + 1) % skins.length;
                    if (owned.includes(skins[idx])) { next = skins[idx]; break; }
                }
                if (next && next !== current) {
                    this.store.set('equippedBall', next);
                    this.game.ball.setSkin(next);
                    this.ui.updateBallSkin?.(next);
                    this.ui.showMessage?.(`🎾 Ball: ${BALL_SKINS[next].name}`, 1500);
                }
            }
            // Z or G → emote wheel toggle
            if ((e.code === 'KeyZ' || e.code === 'KeyG') && this.game.state === STATES.PLAYING) {
                e.preventDefault();
                if (this.game.emotes.wheelOpen) {
                    this.closeEmoteWheel();
                } else {
                    this.openEmoteWheel();
                }
            }
            // ESC → close emote wheel
            if (e.code === 'Escape' && this.game.emotes.wheelOpen) {
                this.closeEmoteWheel();
                return;
            }
            // V → push-to-talk voice (basılı tut)
            if (e.code === 'KeyV' && this.voice) {
                this.voice.pttDown();
            }
            if (e.code === 'Escape') {
                if (this.gameConsole?.visible) return;
                if (this.ui.isTeamPopupOpen()) { this.ui.hideTeamPopup(); return; }
                const settingsModal = document.getElementById('unified-settings');
                if (settingsModal && !settingsModal.classList.contains('hidden')) {
                    this.closeSettingsModal();
                    // If settings was opened from pause menu, return to pause
                    const pauseEl = document.getElementById('pause-menu');
                    if (pauseEl && !pauseEl.classList.contains('hidden')) return;
                }
                const pauseEl = document.getElementById('pause-menu');
                if (pauseEl && !pauseEl.classList.contains('hidden')) {
                    // ESC while paused → resume
                    pauseEl.classList.add('hidden');
                    this.player.lock();
                    return;
                }
                if (this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN) {
                    // Pause instead of hard exit
                    this.player.unlock();
                    this.ui.setPlayerTarget(false);
                    pauseEl?.classList.remove('hidden');
                }
            }
        });
        document.addEventListener('keyup', e => {
            if (e.code === 'Tab') {
                this.ui.hideScoreboard();
            }
            if (e.code === 'KeyZ') {
                this.closeEmoteWheel();
            }
            if (e.code === 'KeyV' && this.voice) {
                this.voice.pttUp();
            }
        });

        this.setupMenuHandlers();
        this.refreshMetaStats();
        this.ui.showScreen('mainMenu');

        // In-game console (~)
        this.gameConsole = new Console();
        this.gameConsole.init(this.game);
        this.game.console = this.gameConsole; // game loop can check visibility

        this.loop();
    }

    // Store'dan loadout uygula (karakter + rune + ball skin).
    applyLoadout() {
        const loadout = this.store.get('loadout') || DEFAULT_LOADOUT;
        const charId = this.store.get('selectedChar') || 'rally';
        this.player.applyLoadout(charId, loadout.runes);
        this.player.loadout.skill = loadout.skill || 'slow';
        // Ball skin uygula
        const ballSkin = this.store.get('equippedBall') || 'classic';
        this.game.ball.setSkin(ballSkin);
        this.ui.updateBallSkin?.(ballSkin);
        // FOV
        const fov = this.store.get('settings').fov || 75;
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
        // Music volume
        const vol = (this.store.get('settings').volume || 50) / 100;
        this.game.setMusicVolume(vol * 0.03);
    }

    refreshMetaStats() {
        this.ui.updateMetaStats?.(this.store);
        // ponytail fix OW2-gap1: ow-avatar div'ini populate et
        const avEl = document.getElementById('ow-avatar');
        if (avEl) {
            const avatar = this.store.get('customAvatar');
            const charId = this.store.get('selectedChar') || 'rally';
            if (avatar?.dataURL) {
                avEl.innerHTML = `<img src="${avatar.dataURL}" style="width:100%;height:100%;border-radius:50%;image-rendering:pixelated">`;
            } else {
                avEl.textContent = CHARACTERS[charId]?.emoji || '🏐';
            }
        }
        // ponytail fix OW2-gap2: player-name-input'u store'dan init et
        const nameInput = document.getElementById('player-name-input');
        if (nameInput && !nameInput.dataset.init) {
            const saved = this.store.get('playerName');
            if (saved) nameInput.value = saved;
            nameInput.dataset.init = '1';
            nameInput.addEventListener('change', () => {
                this.store.set('playerName', nameInput.value || 'Player');
            });
        }
    }

    // Maç sonu reward: coins + xp, battlepass tier dolum, istatistik, achievement, daily.
    awardMatchRewards() {
        if (this.game._practiceMode) {
            this.game._practiceMode = false;
            return; // practice'ten reward yok
        }
        const stats = this.game.scoreboard.getPlayerStats();
        const myStat = stats.find(s => s.name === this.game.playerName) || { score:0, deflections:0, hits:0 };
        const winner = this.game.scoreboard.getWinner();
        const myTeam = this.player.team;
        const won = winner === myTeam.toUpperCase();
        const coins = 30 + myStat.deflections * 2 + myStat.score * 5 + (won ? 50 : 0);
        const xp = 50 + myStat.deflections * 3 + (won ? 100 : 30);
        const result = this.store.grant({ currency: coins, xp });
        const rally = this.game.rallyCount;
        const damageDealt = this.player.totalDamageDealt;
        const damageTaken = this.player.totalDamageTaken;
        const finalHp = this.player.hp;
        const cleanWin = won && damageTaken === 0;
        const criticalHit = this.game.killFeed.some(k => k.tag?.includes('CRITICAL'));
        const spikes = this.game.spikeCount || 0;

        this.store.recordGame({ won, deflects: myStat.deflections, hits: myStat.hits, rally });

        // Daily challenge ilerlemesi
        Daily.progress({ won, deflects: myStat.deflections, bestRally: rally, spikes, damage: damageDealt, winStreak: this.store.getWinStreak(), cleanWin });

        // Achievement kontrol
        const newAch = checkAchievements(this.store, {
            rally, won, damageTaken, spikes, criticalHit, finalHp
        });
        newAch.forEach(a => {
            this.ui.showMessage?.(`🏆 Achievement: ${a.name}! +${a.reward} coins`, 3000);
        });

        if (result.leveledUp) {
            this.ui.showMessage?.(`Level Up! Now Lv ${result.level}`, 3000);
        }
        this.ui.showMessage?.(`+${coins} coins, +${xp} XP`, 3000);

        // Replay kaydet
        const replay = Replay.stopRecording();
        if (replay && replay.events.length > 5) Replay.save(replay);
    }

    setupMenuHandlers() {
        // Main menu buttons
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };

        bind('btn-play-solo', () => {
            // PLAY → multiplayer seçim ekranı (create / join / solo)
            this.ui.showScreen('multiplayerMenu');
            this._refreshLobbyList();
            this._mpRefreshTimer = setInterval(() => this._refreshLobbyList(), 5000);
        });

        // Multiplayer menü butonları
        bind('btn-mp-create', () => {
            clearInterval(this._mpRefreshTimer);
            this._doHostGame();
        });
        bind('btn-mp-join', () => {
            clearInterval(this._mpRefreshTimer);
            this.ui.showScreen('joinMenu');
        });
        bind('btn-mp-solo', () => {
            clearInterval(this._mpRefreshTimer);
            this.game.startSolo();
            this.ui.showScreen('lobby');
        });
        bind('btn-mp-back', () => {
            clearInterval(this._mpRefreshTimer);
            this.ui.showScreen('mainMenu');
        });
        bind('btn-mp-refresh', () => {
            this._refreshLobbyList();
        });

        bind('btn-host-game', async () => { this._doHostGame(); });

        bind('btn-join-game', () => {
            this.ui.showScreen('joinMenu');
        });

        bind('btn-join-connect', async () => {
            try {
                const code = document.getElementById('join-code-input')?.value;
                const name = document.getElementById('join-name-input')?.value || 'Player';
                const password = document.getElementById('join-pass-input')?.value || '';
                if (!code) return;
                // If host kicks us or rejects our password, bounce back to the menu.
                this.network.onKicked = (reason) => {
                    this.ui.showScreen('mainMenu');
                    this.ui.showMessage?.(reason === 'password' ? '❌ Wrong lobby password' : '❌ Kicked from lobby', 2500);
                };
                this.network.onTeamChange = (pName, team) => {
                    this.game.switchPlayerTeam?.(pName, team);
                };
                this.network.onGameState = (data) => {
                    if (data.type === 'welcome') this.game.applyLobbyState(data);
                };
                await this.network.joinGame(code, name, password);
                this.game.playerName = name;
                this.ui.showScreen('lobby');
            } catch (e) {
                alert('Failed to join: ' + e.message);
            }
        });

        bind('btn-join-back', () => {
            this.ui.showScreen('mainMenu');
        });

        bind('btn-settings', () => {
            this.openSettingsModal();
        });

        bind('btn-character', () => {
            this.ui.renderCharacterSelect(this.store);
            this.ui.showScreen('character');
        });

        bind('btn-shop', () => {
            this.ui.renderShop(this.store, 'chars');
            this.ui.showScreen('shop');
        });

        bind('btn-battlepass', () => {
            this.ui.renderBattlepass(this.store);
            this.ui.showScreen('battlepass');
        });

        bind('btn-avatar', () => {
            this.ui.showScreen('avatar');
            this.initAvatarPainter();
        });

        bind('btn-achievements', () => {
            this.ui.renderAchievements(this.store);
            this.ui.showScreen('achievements');
        });

        bind('btn-daily', () => {
            this.ui.renderDaily(Daily);
            this.ui.showScreen('daily');
        });

        bind('btn-ranked', () => {
            this.ui.renderRanked(this.store);
            this.ui.showScreen('ranked');
        });

        bind('btn-leaderboard', () => {
            this.ui.renderLeaderboard?.(this.store);
            this.ui.showScreen('leaderboard');
        });

        bind('btn-tournament', () => {
            this.ui.showScreen('tournament');
        });

        bind('btn-tutorial', () => {
            this.ui.showScreen('tutorial');
            this.ui.renderTutorial?.();
        });

        bind('btn-leaderboard-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-tournament-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-tutorial-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-tournament-start', () => {
            const input = document.getElementById('tournament-players')?.value;
            if (input) {
                const players = input.split(',').map(s => s.trim()).filter(Boolean);
                this.startTournament(players);
            }
        });

        bind('btn-tutorial-start', () => {
            this.startTutorial();
        });

        bind('btn-practice', () => {
            this.startPractice();
        });

        bind('btn-achievements-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-daily-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-ranked-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-settings-close', () => {
            this.closeSettingsModal();
        });

        bind('btn-lobby-settings', () => {
            this.openSettingsModal();
        });

        // Pause menu
        bind('pause-resume', () => {
            document.getElementById('pause-menu')?.classList.add('hidden');
            this.player.lock();
        });
        bind('pause-settings', () => {
            this.openSettingsModal();
        });
        bind('pause-exit', () => {
            document.getElementById('pause-menu')?.classList.add('hidden');
            this.player.unlock();
            this.ui.setPlayerTarget(false);
            this.ui.showScreen('mainMenu');
            this.game.setState(STATES.MENU);
        });

        // Lobby chat send
        const lobbySend = id => {
            const input = document.getElementById('lobby-chat-input');
            const text = input?.value.trim();
            if (text) { this.game.sendChat(text); input.value = ''; }
        };
        document.getElementById('lobby-chat-send')?.addEventListener('click', () => lobbySend());
        document.getElementById('lobby-chat-input')?.addEventListener('keydown', e => {
            if (e.code === 'Enter') lobbySend();
        });

        // Lobby team card drag — host drags player cards to switch teams
        this._setupLobbyDragDrop();

        bind('btn-char-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-shop-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-bp-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-avatar-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-char-save', () => {
            // Seçili karakter/skill/rune'ları topla
            const selectedChar = document.querySelector('.char-card.selected')?.dataset.char;
            const selectedSkill = document.querySelector('.skill-card.selected')?.dataset.skill;
            const selectedRunes = Array.from(document.querySelectorAll('.rune-card.selected')).map(el => el.dataset.rune).slice(0, 4);
            if (selectedChar) this.store.set('selectedChar', selectedChar);
            const loadout = { ...this.store.get('loadout'), skill: selectedSkill, runes: selectedRunes };
            this.store.set('loadout', loadout);
            this.applyLoadout();
            this.ui.showMessage?.('Loadout saved!');
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-avatar-clear', () => {
            this.avatarPainter?.clear();
        });

        // ponytail: eski lobby "👁" spectator butonu kaldırıldı — lobide spectator'a
        // geçmek Spectator.active'i bozuyordu. Spectator artık M menüsünden (oyun içi).

        // Spectator toggle for the M-menu. UI shows a Spectate/Leave button that
        // calls this; also keeps ui.spectating in sync for the button label.
        this.ui.onToggleSpectate = () => this.toggleSpectate();

        bind('btn-start-game', () => {
            if (this.network.connected && !this.isLobbyHost()) {
                this.ui.showMessage?.('Only host can start', 1500);
                return;
            }
            this.audio.init();
            this.player.lock();
            this.game.startGame();
            if (this.network.connected && this.network.isHost) {
                this.network.broadcast({ type: 'gameStart', ...this.game.snapshotState() });
            }
            // Replay kaydı başlat
            Replay.startRecording({
                map: this.arena.mapId,
                mode: this.game.mode?.id || 'classic',
                players: this.game.getPlayerList().map(p => p.name)
            });
        });

        bind('btn-add-bot-red', () => {
            this.game.addBot('red');
            this.broadcastLobbyState();
        });

        bind('btn-add-bot-blue', () => {
            this.game.addBot('blue');
            this.broadcastLobbyState();
        });

        bind('btn-remove-bot', () => {
            this.game.removeBot();
            this.broadcastLobbyState();
        });

        bind('btn-team-red', () => {
            this.player.setTeam('red');
            this.game.scoreboard.removePlayer(this.game.playerName);
            this.game.scoreboard.addPlayer(this.game.playerName, 'red', { isYou: true });
            this.game.updateLobbyUI();
        });

        bind('btn-team-blue', () => {
            this.player.setTeam('blue');
            this.game.scoreboard.removePlayer(this.game.playerName);
            this.game.scoreboard.addPlayer(this.game.playerName, 'blue', { isYou: true });
            this.game.updateLobbyUI();
        });

        bind('btn-lobby-back', () => {
            clearInterval(this._lobbyKeepAlive);
            if (this._lobbyCode) this._unregisterLobby(this._lobbyCode);
            this._lobbyCode = null;
            this.game.bots.forEach(b => b.remove());
            this.game.bots = [];
            this.game.botCounter = 0;
            this.game.scoreboard.reset();
            this.ui.showScreen('mainMenu');
        });

        // Game over
        bind('btn-play-again', () => {
            this.game.scoreboard.reset();
            this.game.startGame();
            this.player.lock();
        });

        bind('btn-main-menu', () => {
            this.awardMatchRewards();
            this.game.bots.forEach(b => b.remove());
            this.game.bots = [];
            this.game.botCounter = 0;
            this.game.ball.deactivate();
            if (this.game.affixes) this.game.affixes.clearRound();
            this.ui.setPlayerTarget(false);
            this.game.setState(STATES.MENU);
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        // Post-game screen actions
        window._postGameAction = (action) => {
            if (action === 'play_again') {
                this.game.scoreboard.reset();
                this.game.startGame();
                this.player.lock();
            } else if (action === 'lobby') {
                this.awardMatchRewards();
                this.game.ball.deactivate();
                if (this.game.affixes) this.game.affixes.clearRound();
                // Clear old bots, then re-init lobby via the same path as Play Solo
                this.game.bots.forEach(b => b.remove());
                this.game.bots = [];
                this.game.botCounter = 0;
                this.ui.setPlayerTarget(false);
                this.game.startSolo();
                this.ui.showScreen('lobby');
                this.player.unlock();
                this.refreshMetaStats();
            } else if (action === 'main_menu') {
                this.awardMatchRewards();
                this.game.bots.forEach(b => b.remove());
                this.game.bots = [];
                this.game.botCounter = 0;
                this.game.ball.deactivate();
                if (this.game.affixes) this.game.affixes.clearRound();
                this.ui.setPlayerTarget(false);
                this.game.setState(STATES.MENU);
                this.ui.showScreen('mainMenu');
                this.refreshMetaStats();
            }
        };

        const sendPostGameChat = () => {
            const input = document.getElementById('pg-chat-input');
            const text = input?.value.trim();
            if (!text) return;
            this.game.sendChat(text);
            input.value = '';
        };
        document.getElementById('pg-chat-send')?.addEventListener('click', sendPostGameChat);
        document.getElementById('pg-chat-input')?.addEventListener('keydown', e => {
            if (e.code === 'Enter') {
                e.preventDefault();
                sendPostGameChat();
            }
        });

        // Carousel navigation
        bind('carousel-prev', () => {
            const keys = Object.keys(Arena.MAPS);
            this.carouselIndex = (this.carouselIndex - 1 + keys.length) % keys.length;
            this.game.selectMap(keys[this.carouselIndex]);
            this.updateCarousel();
            updateCSLobbyInfo();
        });
        bind('carousel-next', () => {
            const keys = Object.keys(Arena.MAPS);
            this.carouselIndex = (this.carouselIndex + 1) % keys.length;
            this.game.selectMap(keys[this.carouselIndex]);
            this.updateCarousel();
            updateCSLobbyInfo();
        });

        // Settings bindings
        const bindSetting = (id, onChange) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', onChange);
        };

        // Settings tab switching
        const tabs = document.querySelectorAll('.settings-tab');
        const sections = document.querySelectorAll('.settings-section');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('selected'));
                tab.classList.add('selected');
                const idx = parseInt(tab.dataset.tab);
                sections.forEach((s, i) => s.style.display = i === idx ? '' : 'none');
            });
        });
        // Init: show only first section
        sections.forEach((s, i) => s.style.display = i === 0 ? '' : 'none');

        bindSetting('setting-sensitivity', e => {
            this.player.setSensitivity(parseFloat(e.target.value) / 1000);
        });
        bindSetting('setting-volume', e => {
            const vol = parseFloat(e.target.value) / 100;
            this.audio.setVolume(vol);
            this.game.setMusicVolume(vol * 0.03); // music very quiet
        });
        bindSetting('setting-fov', e => {
            this.camera.fov = parseFloat(e.target.value);
            this.camera.updateProjectionMatrix();
            const s = this.store.get('settings');
            s.fov = parseFloat(e.target.value);
            this.store.set('settings', s);
        });
        // Resolution — apply immediately, persist against resize
        bindSetting('setting-resolution', e => {
            const [w, h] = e.target.value.split('x').map(Number);
            this._customRes = { w, h };
            this.store.set('resolution', { w, h });
            this.renderer.updateSize(w, h);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.ui.showMessage?.(`Resolution: ${w}×${h}`, 1500);
        });
        // VSync
        bindSetting('setting-vsync', e => {
            this.store.set('vsync', e.target.value === 'on');
            this.ui.showMessage?.(`VSync: ${e.target.value} (reload to take full effect)`, 2000);
        });
        // FPS limit
        bindSetting('setting-fps-limit', e => {
            const limit = parseInt(e.target.value);
            this.store.set('fpsLimit', limit);
            this.ui.showMessage?.(`FPS limit: ${limit || 'Unlimited'}`, 1500);
        });
        // Bot difficulty
        bindSetting('setting-bot-difficulty', e => {
            this.game.setBotDifficulty(e.target.value);
            const s = this.store.get('settings');
            s.botDifficulty = e.target.value;
            this.store.set('settings', s);
        });
        // Match time
        bindSetting('setting-match-time', e => {
            this.game.scoreboard.setTimeLimit(parseInt(e.target.value));
        });
        // Max rounds
        bindSetting('setting-max-rounds', e => {
            this.game.scoreboard.setMaxRounds(parseInt(e.target.value));
        });
        // Graphics quality
        bindSetting('setting-quality', e => {
            const s = this.store.get('settings');
            s.quality = e.target.value;
            this.store.set('settings', s);
            this.ui.showMessage?.(`Quality: ${e.target.value} (refresh to apply)`, 1500);
        });
        // Crosshair settings
        const applyCrosshair = () => {
            const chEl = document.querySelector('.crosshair');
            // Only show crosshair during gameplay
            if (this.game.state !== STATES.PLAYING) {
                if (chEl) chEl.style.display = 'none';
                return;
            }
            if (chEl) chEl.style.display = '';
            const ch = this.store.get('crosshairSettings') || {};
            const style = ch.style || 'dot';
            const color = ch.color || '#00ff88';
            const size = ch.size || 12;
            const gap = ch.gap || 6;
            const thick = ch.thickness || 2;
            const showDot = ch.dot !== false;

            const lines = document.querySelectorAll('.crosshair-line');
            const dot = document.querySelector('.crosshair-dot');
            if (!chEl) return;

            // Show/hide dot
            if (dot) dot.style.display = showDot ? '' : 'none';

            // Style: cross shows lines + dot, dot hides lines, circle replaces
            chEl.querySelectorAll('.crosshair-line, .crosshair-dot, .crosshair-circle').forEach(el => el.remove());
            // Rebuild
            if (style === 'dot') {
                const c = document.createElement('div');
                c.className = 'crosshair-dot';
                c.style.cssText = `width:${thick+4}px;height:${thick+4}px;background:${color};border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);`;
                chEl.appendChild(c);
                return;
            }
            if (style === 'circle') {
                const c = document.createElement('div');
                c.className = 'crosshair-circle';
                const r = size;
                c.style.cssText = `width:${r*2}px;height:${r*2}px;border:${thick}px solid ${color};border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);`;
                chEl.appendChild(c);
                if (showDot) {
                    const d = document.createElement('div');
                    d.className = 'crosshair-dot';
                    d.style.cssText = `width:${thick+2}px;height:${thick+2}px;background:${color};border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);`;
                    chEl.appendChild(d);
                }
                return;
            }
            // Cross
            const half = size / 2;
            const directions = [
                { cls: 'top', x: '50%', y: `calc(50% - ${half + gap}px)`, w: `${thick}px`, h: `${size}px`, tx: 'translateX(-50%)' },
                { cls: 'bottom', x: '50%', y: `calc(50% + ${gap}px)`, w: `${thick}px`, h: `${size}px`, tx: 'translateX(-50%)' },
                { cls: 'left', x: `calc(50% - ${half + gap}px)`, y: '50%', w: `${size}px`, h: `${thick}px`, ty: 'translateY(-50%)' },
                { cls: 'right', x: `calc(50% + ${gap}px)`, y: '50%', w: `${size}px`, h: `${thick}px`, ty: 'translateY(-50%)' },
            ];
            directions.forEach(d => {
                const el = document.createElement('div');
                el.className = 'crosshair-line ' + d.cls;
                el.style.cssText = `position:absolute;background:${color};left:${d.x};top:${d.y};width:${d.w};height:${d.h};${d.tx||''};${d.ty||''};`;
                chEl.appendChild(el);
            });
            if (showDot) {
                const d = document.createElement('div');
                d.className = 'crosshair-dot';
                d.style.cssText = `width:${thick+2}px;height:${thick+2}px;background:${color};border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);`;
                chEl.appendChild(d);
            }
        };
        bindSetting('setting-crosshair', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.style = e.target.value;
            this.store.set('crosshairSettings', s);
            applyCrosshair();
        });
        bindSetting('setting-crosshair-color', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.color = e.target.value;
            this.store.set('crosshairSettings', s);
            applyCrosshair();
        });
        bindSetting('setting-crosshair-size', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.size = parseInt(e.target.value);
            this.store.set('crosshairSettings', s);
            applyCrosshair();
        });
        bindSetting('setting-crosshair-gap', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.gap = parseInt(e.target.value);
            this.store.set('crosshairSettings', s);
            applyCrosshair();
        });
        bindSetting('setting-crosshair-thickness', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.thickness = parseInt(e.target.value);
            this.store.set('crosshairSettings', s);
            applyCrosshair();
        });
        const chDot = document.getElementById('setting-crosshair-dot');
        if (chDot) {
            chDot.addEventListener('change', e => {
                const s = this.store.get('crosshairSettings') || {};
                s.dot = e.target.checked;
                this.store.set('crosshairSettings', s);
                applyCrosshair();
            });
        }
        // Load saved crosshair settings + expose so the loop can re-apply on state change
        this.applyCrosshair = applyCrosshair;
        applyCrosshair();
        // Damage multiplier
        bindSetting('setting-damage-mult', e => {
            this.store.set('damageMultiplier', parseFloat(e.target.value));
            this.ui.showMessage?.(`Damage: ${e.target.value}x`, 1000);
        });
        // Portal toggle (checkbox → change event)
        const portalsToggle = document.getElementById('setting-portals');
        if (portalsToggle) {
            portalsToggle.addEventListener('change', e => {
                this.store.set('portalsEnabled', e.target.checked);
            });
        }
        // Auto team balance
        const balanceToggle = document.getElementById('setting-team-balance');
        if (balanceToggle) {
            balanceToggle.addEventListener('change', e => {
                this.store.set('teamBalance', e.target.checked);
                const cb = document.getElementById('team-balance-toggle');
                if (cb) cb.checked = e.target.checked;
            });
        }

        const updateCSLobbyInfo = () => {
            const mapEl = document.getElementById('cs-lobby-map');
            const modeEl = document.getElementById('cs-lobby-mode');
            if (mapEl) mapEl.textContent = this.arena?.config?.name || 'Beach';
            if (modeEl) modeEl.textContent = this.game?.mode?.name || 'Classic';
            // Sync carousel with current map
            this.updateCarousel();
        };

        bind('btn-random-map', () => {
            const keys = Object.keys(Arena.MAPS);
            const picked = this.game.pickRandomMap();
            this.carouselIndex = keys.indexOf(picked);
            if (this.carouselIndex < 0) this.carouselIndex = 0;
            this.game.selectMap(picked);
            this.updateCarousel();
            updateCSLobbyInfo();
            this.ui.showMessage?.(`Random: ${this.arena.config.name}`, 1400);
        });

        // Lobby password (host only) — sets/clears the join gate.
        bind('btn-lobby-lock', () => {
            if (!this.isLobbyHost()) {
                this.ui.showMessage?.('Only the host can lock the lobby', 1600);
                return;
            }
            const lockBtn = document.getElementById('btn-lobby-lock');
            const current = this.network?.lobbyPassword || this._localLobbyPassword || '';
            const pw = prompt(current ? 'Change lobby password (empty = remove):' : 'Set lobby password (empty = none):', current);
            if (pw === null) return; // cancelled
            this._localLobbyPassword = pw;
            this.network?.setLobbyPassword?.(pw);
            if (lockBtn) {
                lockBtn.textContent = pw ? '🔒' : '🔓';
                lockBtn.title = pw ? 'Lobby locked — click to change' : 'Set lobby password (host)';
            }
            this.ui.showMessage?.(pw ? '🔒 Lobby locked' : '🔓 Lobby unlocked', 1500);
        });

        // Game mode selection buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.game.selectMode(btn.dataset.mode);
                updateCSLobbyInfo();
            });
        });
        updateCSLobbyInfo();
        this.initCarousel();

        // Karakter kart tıklama
        document.addEventListener('click', e => {
            const charCard = e.target.closest('.char-card');
            if (charCard) {
                const charId = charCard.dataset.char;
                if (!this.store.ownsCharacter(charId)) {
                    // Satın almayı dene
                    if (this.store.buyCharacter(charId)) {
                        this.ui.renderCharacterSelect(this.store);
                        this.refreshMetaStats();
                    } else {
                        this.ui.showMessage?.('Not enough coins!');
                    }
                    return;
                }
                document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
                charCard.classList.add('selected');
            }
            const skillCard = e.target.closest('.skill-card');
            if (skillCard) {
                const skillId = skillCard.dataset.skill;
                if (!this.store.ownsSkill(skillId)) {
                    if (this.store.buySkill(skillId)) {
                        this.ui.renderCharacterSelect(this.store);
                        this.refreshMetaStats();
                    } else {
                        this.ui.showMessage?.('Not enough coins!');
                    }
                    return;
                }
                document.querySelectorAll('.skill-card').forEach(c => c.classList.remove('selected'));
                skillCard.classList.add('selected');
            }
            const runeCard = e.target.closest('.rune-card');
            if (runeCard) {
                const runeId = runeCard.dataset.rune;
                if (!this.store.owns(runeId)) {
                    if (this.store.data.currency >= 80) {
                        this.store.data.currency -= 80;
                        this.store.data.ownedItems.push(runeId);
                        this.store.save();
                        this.ui.renderCharacterSelect(this.store);
                        this.refreshMetaStats();
                    } else {
                        this.ui.showMessage?.('Not enough coins!');
                    }
                    return;
                }
                // Toggle equip (max 4)
                const equipped = Array.from(document.querySelectorAll('.rune-card.selected')).map(el => el.dataset.rune);
                if (runeCard.classList.contains('selected')) {
                    runeCard.classList.remove('selected');
                } else if (equipped.length < 4) {
                    runeCard.classList.add('selected');
                }
            }
            // Shop buy buttons
            const buyBtn = e.target.closest('.shop-buy');
            if (buyBtn) {
                const type = buyBtn.dataset.type;
                const id = buyBtn.dataset.id;
                let ok = false;
                if (type === 'char') ok = this.store.buyCharacter(id);
                else if (type === 'ball') ok = this.store.buyBall(id);
                else if (type === 'skill') ok = this.store.buySkill(id);
                if (ok) {
                    this.ui.showMessage?.('Purchased!');
                    const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                    this.ui.renderShop(this.store, activeTab);
                    this.refreshMetaStats();
                } else {
                    this.ui.showMessage?.('Not enough coins or owned!');
                }
            }
            // Equip ball from shop
            const equipBtn = e.target.closest('.shop-equip');
            if (equipBtn) {
                const ballId = equipBtn.dataset.id;
                this.store.set('equippedBall', ballId);
                this.game.ball.setSkin(ballId);
                this.ui.showMessage?.(`🎾 Equipped: ${BALL_SKINS[ballId].name}!`);
                const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                this.ui.renderShop(this.store, activeTab);
            }
            // Battlepass claim
            const claimBtn = e.target.closest('.bp-claim');
            if (claimBtn) {
                const tier = parseInt(claimBtn.dataset.tier);
                const reward = this.store.claimBattlepassReward(tier);
                if (reward) {
                    this.ui.showMessage?.(`Claimed: ${reward.name}!`);
                    this.ui.renderBattlepass(this.store);
                    this.refreshMetaStats();
                }
            }
            // Daily challenge claim
            const dailyClaim = e.target.closest('.daily-claim');
            if (dailyClaim) {
                const reward = Daily.claim(dailyClaim.dataset.id);
                if (reward) {
                    this.store.grant({ currency: reward });
                    this.ui.showMessage?.(`Claimed: +${reward} coins!`);
                    this.ui.renderDaily(Daily);
                    this.refreshMetaStats();
                }
            }
            // Tournament bracket play
            const bracketPlay = e.target.closest('.bracket-play');
            if (bracketPlay) {
                const matchId = bracketPlay.dataset.match;
                const matches = tournament.getCurrentMatches();
                const m = matches.find(x => x.id === matchId);
                if (!m) return;
                if (m.p1 === 'You' || m.p2 === 'You') {
                    this.ui.showMessage?.('Tournament match starting!', 2000);
                    this.game.startSolo();
                    this.ui.showScreen('lobby');
                    this._pendingTournamentMatch = matchId;
                } else {
                    // Bot vs Bot — random winner
                    const winner = Math.random() > 0.5 ? m.p1 : m.p2;
                    const s1 = Math.floor(Math.random() * 5) + 3;
                    const s2 = Math.floor(Math.random() * 5) + 3;
                    tournament.recordResult(matchId, winner, s1, s2);
                    this.ui.renderTournament?.(tournament);
                    if (tournament.getChampion()) {
                        this.ui.showMessage?.(`🏆 Champion: ${tournament.getChampion()}`, 4000);
                    }
                }
            }
            // Shop tabs
            const tabBtn = e.target.closest('.shop-tab');
            if (tabBtn) {
                document.querySelectorAll('.shop-tab').forEach(t => t.classList.remove('selected'));
                tabBtn.classList.add('selected');
                this.ui.renderShop(this.store, tabBtn.dataset.tab);
            }
        });

        // Mouse wheel — spectator target cycle
        document.addEventListener('wheel', e => {
            if (Spectator.active) {
                e.preventDefault();
                if (e.deltaY > 0) Spectator.cycleTarget();
                else Spectator.prevTarget();
            }
        }, { passive: false });

        // Click to lock pointer during game
        const gameContainer = document.getElementById('game-container');
        gameContainer.addEventListener('click', () => {
            if (this.game.state === STATES.PLAYING && !this.player.locked && !this.chatOpen) {
                this.player.lock();
            }
        });

        // Click backdrop to close settings modal
        const settingsOverlay = document.getElementById('unified-settings');
        if (settingsOverlay) {
            settingsOverlay.addEventListener('click', (e) => {
                if (e.target === settingsOverlay) this.closeSettingsModal();
            });
        }
    }

    // --- CHAT INPUT ---

    openEmoteWheel() {
        if (this.game.emotes.wheelOpen) return;
        this.player.unlock();
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.game.emotes.showWheel({ x: cx, y: cy });
        this.game.emotes.onEmoteSelect = (emoteId) => {
            this.game.showEmote(this.player, emoteId);
            this.player.lock();
        };
    }

    closeEmoteWheel() {
        if (!this.game.emotes.wheelOpen) return;
        // Seçilmediyse kapat, seçildiyse showEmote çağrıldı
        this.game.emotes.hideWheel();
        if (this.game.state === STATES.PLAYING) this.player.lock();
    }

    // Tournament başlat — bracket oluştur, UI'da göster.
    startTournament(playerNames) {
        tournament.create(playerNames);
        this.ui.renderTournament?.(tournament);
    }

    // Tutorial başlat — adım adım kontrol öğret.
    startTutorial() {
        Tutorial.start({ player: this.player, game: this.game });
        Tutorial.onStepChange = (step) => {
            this.ui.showMessage?.(`📖 ${step.text}`, 3000);
        };
        Tutorial.onComplete = () => {
            this.ui.showMessage?.('🎉 Tutorial complete! +50 coins', 3000);
            this.store.grant({ currency: 50 });
            this.refreshMetaStats();
        };
        this.ui.showScreen('mainMenu');
        this.game.startSolo();
        this.ui.showScreen('lobby');
    }

    initAvatarPainter() {
        const canvas = document.getElementById('avatar-canvas');
        if (!canvas || this.avatarPainter) return;
        this.avatarPainter = new AvatarPainter(canvas, this.store);
        // Palette
        const paletteEl = document.getElementById('avatar-palette');
        if (paletteEl) {
            paletteEl.innerHTML = '';
            AvatarPainter.getPalette().forEach(c => {
                const sw = document.createElement('div');
                sw.className = 'palette-swatch';
                sw.style.background = c;
                sw.addEventListener('click', () => this.avatarPainter.setColor(c));
                paletteEl.appendChild(sw);
            });
        }
        // Tool buttons
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => this.avatarPainter.setTool(btn.dataset.tool));
        });
    }

    // --- CAROUSEL METHODS ---

    initCarousel() {
        const dotsContainer = document.getElementById('carousel-dots');
        if (!dotsContainer) return;
        const keys = Object.keys(Arena.MAPS);
        // Build dots
        dotsContainer.innerHTML = '';
        keys.forEach((id, i) => {
            const dot = document.createElement('button');
            dot.className = 'carousel-dot' + (i === this.carouselIndex ? ' active' : '');
            dot.dataset.index = i;
            dot.addEventListener('click', () => {
                if (i === this.carouselIndex) return;
                this.carouselIndex = i;
                this.game.selectMap(keys[i]);
                this.updateCarousel();
                const mapEl = document.getElementById('cs-lobby-map');
                if (mapEl) mapEl.textContent = this.arena?.config?.name || 'Map';
            });
            dotsContainer.appendChild(dot);
        });
        // Set initial index from current arena map
        const idx = keys.indexOf(this.arena?.mapId);
        if (idx >= 0) this.carouselIndex = idx;
        this.updateCarousel();
    }

    updateCarousel() {
        const keys = Object.keys(Arena.MAPS);
        const mapId = keys[this.carouselIndex];
        const config = Arena.MAPS[mapId];
        if (!config) return;

        const toHex = (c) => '#' + c.toString(16).padStart(6, '0');
        const gradEl = document.getElementById('carousel-gradient');
        if (gradEl) {
            gradEl.style.background = `linear-gradient(145deg, ${toHex(config.floorRed)}, ${toHex(config.floorBlue)})`;
        }

        const nameEl = document.getElementById('carousel-name');
        if (nameEl) {
            // Strip emoji prefix
            const cleanName = config.name.replace(/^[^\s]+\s/, '');
            nameEl.textContent = cleanName || config.name;
        }

        const weatherMap = { clear: '☀️', rain: '🌧️', storm: '⛈️', snow: '❄️' };
        const weatherEl = document.getElementById('carousel-weather');
        if (weatherEl) weatherEl.textContent = weatherMap[config.weather] || '☀️';

        const sizeEl = document.getElementById('carousel-size');
        if (sizeEl) sizeEl.textContent = config.size || 'medium';

        // Update dots
        document.querySelectorAll('.carousel-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === this.carouselIndex);
        });

        // Selected glow
        const card = document.getElementById('carousel-card');
        if (card) {
            card.classList.toggle('selected', mapId === this.arena?.mapId);
        }
    }

    // --- SETTINGS MODAL ---

    openSettingsModal() {
        const modal = document.getElementById('unified-settings');
        if (modal) modal.classList.remove('hidden');
        // ponytail: round/match ayarları sadece lobi sahibinde değişebilir
        const host = this.isLobbyHost();
        const lock = (id) => {
            const el = document.getElementById(id);
            if (el) { el.disabled = !host; el.style.opacity = host ? '' : '0.4'; }
        };
        lock('setting-max-rounds');
        lock('setting-match-time');
    }

    closeSettingsModal() {
        const modal = document.getElementById('unified-settings');
        if (modal) modal.classList.add('hidden');
    }

    // Practice range — bot yok, sınırsız top, spawn/taşı.
    startPractice() {
        this.game.state = STATES.LOBBY;
        this.player.setTeam('red');
        this.player.respawn();
        this.game.scoreboard.reset();
        this.game.scoreboard.addPlayer('You', 'red', { isYou: true });
        // Practice: bot yok, sadece top spawnla
        this.game.bots.forEach(b => b.remove());
        this.game.bots = [];
        this.game._practiceMode = true;
        this.ui.showScreen('lobby');
        // Practice lobby'sinde farklı butonlar göster
        this.ui.showMessage?.('Practice mode: R spawn ball, F move ball', 3000);
    }

    // Lobby leader = host, or solo (not connected to any peer) → you lead.
    isLobbyHost() {
        return !this.network || !this.network.connected || this.network.isHost;
    }

    _setupLobbyDragDrop() {
        const redCol = document.getElementById('cs-team-red');
        const blueCol = document.getElementById('cs-team-blue');

        // Delegated dragstart — store dragged player name (host drags anyone to a team)
        document.addEventListener('dragstart', e => {
            const card = e.target.closest('.cs-player-card');
            if (!card || !this.isLobbyHost()) return;
            e.dataTransfer.setData('text/plain', card.dataset.playerName);
            e.dataTransfer.effectAllowed = 'move';
        });

        // Allow drops on team columns
        [redCol, blueCol].forEach(col => {
            if (!col) return;
            col.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                col.classList.add('drag-over');
            });
            col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
            col.addEventListener('drop', e => {
                e.preventDefault();
                col.classList.remove('drag-over');
                if (!this.isLobbyHost()) return;
                const name = e.dataTransfer.getData('text/plain');
                if (!name) return;
                const targetTeam = col.id === 'cs-team-red' ? 'red' : 'blue';
                const allPlayers = this.game.getPlayerList();
                const player = allPlayers.find(p => p.name === name);
                if (!player || player.team === targetTeam) return;
                this.game.switchPlayerTeam(name, targetTeam);
                // MP: tell peers about the move.
                this.network?.send?.({ type: 'teamChange', name, team: targetTeam });
            });
        });

        // Delegated kick click — host kicks bots OR players.
        document.addEventListener('click', e => {
            const btn = e.target.closest('.cs-btn-kick');
            if (!btn || !this.isLobbyHost()) return;
            const name = btn.dataset.kickName;
            if (!name) return;
            if (btn.dataset.kickBot === '1') {
                this.game.removeBotByName(name);
            } else {
                this.kickPlayer(name);
            }
        });
    }

    // Host kicks a human player: drop their P2P connection + tell them.
    kickPlayer(name) {
        this.network?.send?.({ type: 'kick', name });
        if (this.network?.kickByName) this.network.kickByName(name);
        this.ui.showMessage?.(`Kicked ${name}`, 1400);
        this.game.updateLobbyUI?.();
    }

    broadcastLobbyState() {
        if (!(this.network?.isHost)) return;
        const players = this.game.getPlayerList();
        this.network.broadcast({ type: 'lobbyState', players });
    }

    // --- Lobby Browser API helpers ---
    _lobbyApi(path, opts = {}) {
        return fetch(path, opts).then(r => r.json()).catch(() => ({}));
    }

    async _registerLobby(code, name, players, map, mode) {
        await this._lobbyApi('/api/lobbies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, name, hostName: this.game.playerName, players, map, mode })
        });
    }

    async _unregisterLobby(code) {
        await this._lobbyApi(`/api/lobbies/${encodeURIComponent(code)}`, { method: 'DELETE' });
    }

    async _refreshLobbyList() {
        const list = await this._lobbyApi('/api/lobbies', { method: 'GET' });
        const container = document.getElementById('mp-lobby-list');
        if (!container) return;
        if (!Array.isArray(list) || list.length === 0) {
            container.innerHTML = '<div class="mp-lobby-empty">No open lobbies found. Create one or refresh.</div>';
            return;
        }
        container.innerHTML = list.map(l => `
            <div class="mp-lobby-card" data-code="${this._esc(l.code)}">
                <div class="lobby-icon">🏐</div>
                <div class="lobby-info">
                    <div class="lobby-name">${this._esc(l.name || 'Lobby')}</div>
                    <div class="lobby-meta">${this._esc(l.hostName)} · ${this._esc(l.map)} · ${this._esc(l.mode)}</div>
                </div>
                <div class="lobby-players">👤 ${l.players || 1}</div>
                <button class="btn btn-primary btn-join btn-small">Join</button>
            </div>
        `).join('');
        // Quick join click
        container.querySelectorAll('.mp-lobby-card').forEach(card => {
            card.querySelector('.btn-join').addEventListener('click', (e) => {
                e.stopPropagation();
                this._quickJoin(card.dataset.code);
            });
        });
    }

    _esc(s) { return String(s).replace(/[<>&"']/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m])); }

    async _quickJoin(code) {
        const name = document.getElementById('player-name-input')?.value || 'Player';
        try {
            this.network.onKicked = (reason) => {
                this.ui.showScreen('mainMenu');
                this.ui.showMessage?.(reason === 'password' ? '❌ Wrong lobby password' : '❌ Kicked from lobby', 2500);
            };
            this.network.onTeamChange = (pName, team) => {
                this.game.switchPlayerTeam?.(pName, team);
            };
            this.network.onGameState = (data) => {
                if (data.type === 'welcome') this.game.applyLobbyState(data);
            };
            await this.network.joinGame(code, name);
            this.game.playerName = name;
            this.ui.showScreen('lobby');
            this.ui.showMessage?.('🔗 Joined lobby!', 2000);
        } catch (e) {
            alert('Failed to join: ' + e.message);
        }
    }

    // Host: sunucu kur (P2P oda aç)
    async _doHostGame() {
        try {
            const name = document.getElementById('player-name-input')?.value || 'Host';
            this.game.playerName = name;
            const code = await this.network.hostGame(name);
            if (this._localLobbyPassword) this.network.setLobbyPassword(this._localLobbyPassword);
            this.game.startSolo();
            this.ui.setRoomCode(code);
            this.ui.showScreen('lobby');
            this.network.onPlayerJoin = (pName, peerId) => {
                this.game.addRemotePlayer(peerId, pName);
                this.ui.showMessage(`${pName} joined!`);
                this.game.updateLobbyUI();
                this.broadcastLobbyState();
                this._registerLobby(code, `Lobby`, this.network.connections.size + 1, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            };
            this.network.onPlayerLeave = (peerId) => {
                this.game.removeRemotePlayer(peerId);
                this.ui.showMessage?.('A player left');
                this.game.updateLobbyUI();
                this.broadcastLobbyState();
                this._registerLobby(code, `Lobby`, this.network.connections.size, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            };
            this.network.onGameState = (data) => {
                if (data.type === 'welcome') this.game.applyLobbyState(data);
            };
            this._registerLobby(code, `Lobby`, 1, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            this.ui.showMessage?.(`🏠 Lobby created! Code: ${code}`, 3000);
            // Auto-re-register every 12s to keep lobby alive
            this._lobbyKeepAlive = setInterval(() => {
                if (this.network.connected && this.network.isHost) {
                    this._registerLobby(code, `Lobby`, this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
                }
            }, 12000);
            this._lobbyCode = code;
        } catch (e) {
            alert('Failed to create lobby: ' + e.message);
        }
    }

    // Open/close the M team menu. Releases pointer lock while open so you can
    // click players, re-locks on close (unless spectating).
    toggleTeamPopup() {
        if (this.ui.isTeamPopupOpen()) {
            this.ui.hideTeamPopup();
            if (!Spectator.active && (this.game.state === STATES.PLAYING)) this.player.lock();
        } else {
            this.ui.spectating = Spectator.active;
            this.ui.showTeamPopup(this.game);
            this.player.unlock(); // free the mouse for clicking
        }
    }

    // Enter/leave spectator from the M-menu. On leave, resume the player.
    toggleSpectate() {
        if (Spectator.active) {
            Spectator.exit();
            this.ui.spectating = false;
            this.ui.showMessage?.('↩ Left spectator', 1200);
            if (this.game.state === STATES.PLAYING) this.player.lock();
        } else {
            Spectator.enter(this.game);
            this.ui.spectating = true;
            this.ui.showMessage?.('👁 Spectating — cycle: [ ] / wheel · free cam: F · M: menu', 2500);
        }
        // Refresh the menu so the button label + clickability update.
        if (this.ui.isTeamPopupOpen()) this.ui._renderTeamLists(this.game);
    }

    openChat() {
        // In lobby, just focus the lobby chat panel input
        if (this.game.state === STATES.LOBBY) {
            const li = document.getElementById('lobby-chat-input');
            if (li) { li.focus(); return; }
        }
        if (this.game.state === STATES.GAME_OVER) {
            const pi = document.getElementById('pg-chat-input');
            if (pi) { pi.focus(); return; }
        }
        const input = document.getElementById('chat-input');
        if (!input) return;
        this.chatOpen = true;
        this.player.unlock();          // release mouse so the ball doesn't fire
        input.classList.remove('hidden');
        input.value = '';
        input.focus();
    }

    closeChat() {
        const input = document.getElementById('chat-input');
        if (!input) return;
        this.chatOpen = false;
        input.classList.add('hidden');
        input.blur();
        if (this.game.state === STATES.PLAYING) this.player.lock();
    }

    sendChatFromInput() {
        const input = document.getElementById('chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (text) this.game.sendChat(text);
        this.closeChat();
    }

    loop() {
        requestAnimationFrame(() => this.loop());
        const dt = Math.min(this.clock.getDelta(), 0.05);

        // Re-apply crosshair whenever game state changes (shows it on entering PLAYING)
        if (this.game.state !== this._prevCrosshairState) {
            this.applyCrosshair?.();
            this._prevCrosshairState = this.game.state;
        }

        // Force pointer lock during gameplay (like m_rawinput 1)
        if ((this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN || this.game.state === STATES.CELEBRATION)
            && !document.pointerLockElement) {
            try { this.renderer.renderer.domElement.requestPointerLock(); } catch (_) {}
        }

        // Spectator mode overrides player input
        if (Spectator.active) {
            Spectator.update(dt);
        }

        if (this.game.state === STATES.PLAYING || this.game.state === STATES.ROUND_END || this.game.state === STATES.COUNTDOWN || this.game.state === STATES.CELEBRATION) {
            if (!Spectator.active) this.player.update(dt);
            this.game.update(dt);
            // Dash trail
            if (this.player._justDashed) {
                this.player._justDashed = false;
                this.game.juice.dashTrail(this.player.position.clone(), this.player.dashDir);
            }
            // Damage meter live update
            this.ui.updateDamageMeter?.(this.player.totalDamageDealt, this.player.totalDamageTaken);
            // Combo HUD
            const cs = this.game.juice.getComboState();
            this.ui.updateCombo?.(cs.combo, cs.multiplier);
            // Flash overlay
            this.ui.updateFlash?.(this.game.juice.flashAmt);
        }

        // Practice mode özel tuşlar
        if (this.game._practiceMode && this.game.state === STATES.PLAYING) {
            if (this.player.keys['KeyR']) {
                this.player.keys['KeyR'] = false;
                this.game.ball.spawn();
                this.ui.showMessage?.('Ball spawned', 800);
            }
            if (this.player.keys['KeyF']) {
                this.player.keys['KeyF'] = false;
                const aim = this.player.getAimDirection();
                const pos = this.player.getPosition();
                this.game.ball.position.copy(pos).add(aim.multiplyScalar(5));
                this.game.ball.position.y = Math.max(3, this.game.ball.position.y);
                this.game.ball.velocity.set(0, -2, 0);
                this.game.ball.active = true;
                this.game.ball.mesh.visible = true;
                this.ui.showMessage?.('Ball moved', 800);
            }
        }

        // Tutorial update — adım kontrolü
        if (this.game.state === STATES.PLAYING && Tutorial.getCurrentStep()) {
            Tutorial.update({ player: this.player, game: this.game });
        }

        // Replay kaydı — deflect olayları
        if (this.game.state === STATES.PLAYING && Replay.recording) {
            if (this.game.rallyCount !== this._lastRally) {
                Replay.record({ type: 'deflect', rally: this.game.rallyCount });
                this._lastRally = this.game.rallyCount;
            }
        }

        // P2P: lokal oyuncu pozisyonunu + attack intent'i host'a / peer'lara yolla
        this._p2pTimer = (this._p2pTimer || 0) - dt;
        if (this._p2pTimer <= 0 && this.network?.connected) {
            this._p2pTimer = 0.05; // 20Hz
            if (this.game.state === STATES.PLAYING) {
                const p = this.player;
                this.network.sendPosition(p.position, p.euler.y, {
                    name: this.game.playerName, team: p.team, alive: p.alive,
                    hp: p.hp, ax: p.getAimDirection().x, ay: p.getAimDirection().y, az: p.getAimDirection().z
                });
            }
        }
        // Attack intent: tıklayınca host'a aim bilgisiyle yolla (sadece bağlıyken)
        if (this._p2pAttackQueued) {
            this._p2pAttackQueued = false;
            if (this.network?.connected && this.game.state === STATES.PLAYING) {
                const aim = this.player.getAimDirection();
                this.network.sendAttack({
                    name: this.game.playerName, team: this.player.team,
                    ax: aim.x, ay: aim.y, az: aim.z
                });
            }
        }

        // Host: top + skor state'ini peer'lara yayın (authoritative)
        if (this.network?.isHost && this.game.state === STATES.PLAYING) {
            this._hostSyncTimer = (this._hostSyncTimer || 0) - dt;
            if (this._hostSyncTimer <= 0) {
                this._hostSyncTimer = 0.05;
                this.network.broadcast({
                    type: 'ballState',
                    x: this.game.ball.position.x, y: this.game.ball.position.y, z: this.game.ball.position.z,
                    vx: this.game.ball.velocity.x, vy: this.game.ball.velocity.y, vz: this.game.ball.velocity.z,
                    speed: this.game.ball.currentSpeed, active: this.game.ball.active,
                    state: this.game.ball.state, targetId: this.game.ball.targetPlayer?.peerId || null
                });
                this.network.broadcast({
                    type: 'scoreUpdate',
                    red: this.game.scoreboard.redScore, blue: this.game.scoreboard.blueScore,
                    time: this.game.scoreboard.timeRemaining, round: this.game.scoreboard.roundNum,
                    players: this.game.scoreboard.getPlayerStats()
                });
            }
        }

        // Menu background — show arena with slow cinematic camera
        if (this.game.state === STATES.MENU) {
            const t = performance.now() / 1000;
            // Look at center of court from a cinematic angle
            const dist = 50;
            const y = 18 + Math.sin(t * 0.3) * 4;
            const x = Math.cos(t * 0.2) * dist;
            const z = Math.sin(t * 0.2) * dist;
            this.camera.position.set(x, y, z);
            this.camera.lookAt(0, 4, 0);
            this.renderer.render(this.camera);
        } else {
            // Spectate dead — follow alive teammate
            if (!this.player.alive && this.game._spectateTarget && this.game._spectateTarget.alive) {
                const t = this.game._spectateTarget;
                const tpos = t.getPosition();
                const tdir = t.getAimDirection?.() || new THREE.Vector3(0, 0, -1);
                this.camera.position.copy(tpos).add(new THREE.Vector3(-tdir.x * 2, 0.5, -tdir.z * 2));
                this.camera.lookAt(tpos.x, tpos.y, tpos.z);
            }
            this.renderer.render(this.camera);
        }
    }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    new App();
});
