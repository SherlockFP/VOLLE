// main.js — App bootstrap, scene setup, game loop, screen handlers, loadout.
import * as THREE from 'three';
import { Renderer } from './renderer.js';
import { Player, isEditableTarget } from './player.js';
import { Arena, registerCustomMap } from './arena.js';
import { Game, STATES } from './game.js';
import { GAME_MODES } from './gamemodes.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { Store } from './store.js';
import { DEFAULT_LOADOUT } from './skills.js';
import { AvatarPainter, AVATAR_SKINS } from './avatar.js';
import { CASES, KNIVES } from './cosmetics.js';
import { MapEditorController } from './map-editor.js';
import { normalizeMapConfig } from './map-config.js';
import { checkAchievements } from './achievements.js';
import { Daily } from './daily.js';
import { Replay, extractReplayHighlight } from './replay.js';
import { ReplayView } from './replay-view.js';
import { Spectator } from './spectator.js';
import { BALL_SKINS } from './ball.js';
import { Console } from './console.js';
import { tournament } from './tournament.js';
import { Friends } from './friends.js';
import { CHARACTERS } from './characters.js';
import { appendClanMessage, createClan, listClans } from './social.js';
import { SOCIAL_HUB_MAPS, SocialLobby, getSocialLobbyMapState } from './social-lobby.js';
import { applyUiPreferences, loadUiPreferences, normalizeTheme, normalizeUiScale } from './ui-theme.js';
import { initSettingsTabs } from './settings-controller.js';
import { formatMapSize } from './map-display.js';
import { MOVEMENT_TRIALS, MovementTrialClass } from './movement-trials.js';
import {
    exportCrosshairCode,
    importCrosshairCode,
    normalizeCrosshairConfig,
    renderCrosshair
} from './crosshair.js';

class App {
    constructor() {
        this.chatOpen = false;
        this._voicePingAttempts = [];
        this._voicePingMutedUntil = 0;
        this._lastVoicePingAt = -Infinity;
        this.carouselIndex = 0;
        this.clock = new THREE.Clock();
        this.netSyncTimer = 0;
        this.netBroadcastTimer = 0;
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.2, 2000);
        this.store = Store;
        this.store.load();
        this._mutedPlayers = new Set(this.store.get('mutedPlayers') || []);
        for (const entry of this.store.get('customMaps') || []) {
            registerCustomMap(entry.id, normalizeMapConfig(entry.config));
        }
        window.__store = this.store; // ui.js avatar lookup
        // Init new setting toggles from store
        const portalsToggle = document.getElementById('setting-portals');
        if (portalsToggle) portalsToggle.checked = this.store.get('portalsEnabled') !== false;
        const balanceToggle = document.getElementById('setting-team-balance');
        if (balanceToggle) balanceToggle.checked = this.store.get('teamBalance') !== false;
        const dmgMult = document.getElementById('setting-damage-mult');
        if (dmgMult) dmgMult.value = this.store.get('damageMultiplier') || 1;
        this.avatarPainter = null;
        this.mapEditor = null;
        this.replayView = null;
        this._replaySpectatorGame = null;

        // Init systems
        const container = document.getElementById('game-container');
        this.renderer = new Renderer(container);
        this.arena = new Arena(this.renderer, 'beach_open', {
            portalsEnabled: this.store.get('portalsEnabled') !== false
        });
        this.player = new Player(this.renderer, this.camera, this.arena);
        this.audio = new Audio();
        this.ui = new UI();
        this.network = new Network(null);
        this.game = new Game(this.renderer, this.player, this.arena, this.audio, this.ui, this.network);
        this.network.game = this.game;
        this.movementTrials = new MovementTrialClass();
        this.game.onReplayEvent = event => Replay.record(event);
        this.game.onRocketJump = event => {
            this.movementTrials.addRocketJump();
            this.store.progressSeasonContracts({ rocketJumps: 1 });
            Replay.record({ type: 'rocketJump', data: { strength: event?.strength || 0 } });
        };
        this.game.onMatchLoading = data => this._showMatchLoading(900, data);
        this.game.onLateJoinActivated = team => this._exitLateJoinSpectator(team);
        this.game.onMatchComplete = () => {
            this.awardMatchRewards();
            this.refreshMetaStats();
            this.ui.updateContractTracker(Daily, this.store);
        };
        this.game.onRoundEnd = () => this._queueRoundReplay();
        this.game.onMatchStart = () => {
            if (Spectator.active) Spectator.exit('match-start');
            this.ui.spectating = false;
            this.ui.hideTeamPopup();
        };
        this.player.game = this.game;
        this.player.audio = this.audio;
        this.socialLobby = new SocialLobby(this.renderer, this.player, {
            onPresence: presence => this._updateSocialPresence(presence)
        });
        this._socialRemoteSeen = new Map();
        this.network.onSocialPresence = data => this._receiveSocialPresence(data);
        this.network.onSocialChat = data => this._receiveSocialChat(data);

        Spectator.onTargetChange = name => {
            const el = document.getElementById('spectator-info');
            if (!el) return;
            if (Spectator.active) {
                el.textContent = `👁 ${name}${Spectator.freeCam ? ' • FREE CAM' : ''}`;
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        };

        this.initFriendsSidebar();

        // Loadout uygula
        this.applyLoadout();

        this.renderer.scene.add(this.camera);

        // Fallback loop — alt-tab'da RAF durunca network ayakta kalsın
        this._bgInterval = null;
        this._tabHidden = false;
        this._lastSentPos = new Map();
        this._bgPosSent = new Map();
        this._bgScoreTimer = 0;
        this._bgPowerUpTimer = 0;
        this._bgBallTimer = 0;
        this._bgBotTimer = 0;
        // ponytail: AbortController prevents listener accumulation on game restart
        this._mainAbort = new AbortController();
        document.addEventListener('visibilitychange', () => this._onVisibilityChange(), { signal: this._mainAbort.signal });

        // Canvas remains viewport-sized; resolution changes only the internal render buffer.
        window.addEventListener('resize', () => {
            this.renderer.updateSize(window.innerWidth, window.innerHeight);
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }, { signal: this._mainAbort.signal });

        // Spectate click — left=next, right=prev (no context menu)
        document.addEventListener('mousedown', e => {
            if (!this.player.alive && this.game._spectateTarget) {
                e.preventDefault();
                const teammates = this.game.getAliveTeammates();
                if (teammates.length > 0) {
                    const idx = teammates.indexOf(this.game._spectateTarget);
                    if (e.button === 0) {
                        this.game._spectateTarget = teammates[(idx + 1) % teammates.length];
                    } else if (e.button === 2) {
                        this.game._spectateTarget = teammates[(idx - 1 + teammates.length) % teammates.length];
                    }
                }
            }
        }, { signal: this._mainAbort.signal });
        // Block the browser right-click menu everywhere (menu, lobby, settings, in-game).
        // Right-click is still usable as a game input via mousedown button===2.
        document.addEventListener('contextmenu', e => e.preventDefault(), { signal: this._mainAbort.signal });

        // Tab key → scoreboard
        document.addEventListener('keydown', e => {
            if (e.code === 'Backquote') this.ui.hideScoreboard();

            // Console visible → skip all other handlers
            if (this.gameConsole?.visible) return;

            // While typing in chat, only Enter/Escape matter (handled below).
            if (this.chatOpen) {
                if (e.code === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.sendChatFromInput();
                } else if (e.code === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeChat();
                }
                return;
            }
            if (isEditableTarget(e.target) && e.code !== 'Escape') return;

            if (e.code === 'Tab' && [STATES.PLAYING, STATES.COUNTDOWN, STATES.CELEBRATION, STATES.ROUND_END].includes(this.game.state)) {
                e.preventDefault();
                e.stopPropagation();
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
                const teammates = this.game.getAliveTeammates();
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
            // leave spectator from it. Chat açıkken M menü açmasın.
            if (Spectator.active && !this.chatOpen) {
                if (e.code === 'Escape' && Replay.playing) {
                    e.preventDefault();
                    this._exitReplay();
                    return;
                }
                if (e.code === 'BracketRight') Spectator.cycleTarget();
                if (e.code === 'BracketLeft') Spectator.prevTarget();
                if (e.code === 'KeyF') Spectator.setFreeCam(!Spectator.freeCam);
                if (e.code === 'KeyM' && !Replay.playing) { e.preventDefault(); this.toggleTeamPopup(); }
                return;
            }

            // Chat açıkken M tuşu takım menüsü açmasın.
            if (this.chatOpen) return;

            if (['F1', 'F2', 'F3'].includes(e.code) && this.game.state === STATES.PLAYING) {
                e.preventDefault();
                const ping = { F1: ['incoming', 'BALL INCOMING!'], F2: ['help', 'NEED HELP!'], F3: ['save', 'NICE SAVE!'] }[e.code];
                this._tryVoicePing(ping);
                return;
            }

            // M → team popup (only in-game, lobby has team buttons)
            if (e.code === 'KeyM' && (this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN)) {
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
            if ((e.code === 'KeyZ' || e.code === 'KeyG') && (this.game.state === STATES.PLAYING || this.game.state === STATES.SOCIAL_HUB)) {
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
                if (this.game.state === STATES.SOCIAL_HUB) {
                    if (!document.getElementById('social-lobby-chat')?.classList.contains('hidden')) {
                        e.preventDefault();
                        document.getElementById('social-lobby-chat')?.classList.add('hidden');
                        this.player.lock();
                        return;
                    }
                    e.preventDefault();
                    this._exitSocialLobby();
                    return;
                }
                if (Replay.playing) {
                    e.preventDefault();
                    this._exitReplay();
                    return;
                }
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
                    this.game.setState(this._pausedFromState || STATES.PLAYING);
                    this._pausedFromState = null;
                    this.player.lock();
                    return;
                }
                if ([STATES.PLAYING, STATES.COUNTDOWN, STATES.ROUND_END, STATES.CELEBRATION].includes(this.game.state)) {
                    this._pausedFromState = this.game.state;
                    this.game.setState(STATES.PAUSED);
                    this.ui.hideScoreboard();
                    this.player.unlock();
                    this.ui.setPlayerTarget(false);
                    pauseEl?.classList.remove('hidden');
                }
            }
            if (this.game.state === STATES.SOCIAL_HUB) {
                if (e.code === 'KeyY' || e.code === 'Enter') {
                    e.preventDefault();
                    document.getElementById('social-lobby-chat')?.classList.remove('hidden');
                    this.player.unlock();
                    document.getElementById('social-lobby-chat-input')?.focus();
                }
            }
        }, { signal: this._mainAbort.signal, capture: true });
        document.addEventListener('keyup', e => {
            if (e.code !== 'Tab') return;
            e.preventDefault();
            this.ui.hideScoreboard();
        }, { signal: this._mainAbort.signal, capture: true });
        document.addEventListener('keyup', e => {
            if (e.code === 'KeyZ') {
                this.closeEmoteWheel();
            }
            if (e.code === 'KeyV' && this.voice) {
                this.voice.pttUp();
            }
        }, { signal: this._mainAbort.signal });

        // ponytail: mouse-follow glow + custom cursor for main menu
        this._setupMenuMouse();

        this.setupMenuHandlers();
        this.applyAccessibility();
        this.refreshMetaStats();
        this.store.connectRemote(this.store.get('playerName')).then(connected => {
            if (!connected) return;
            this.applyLoadout();
            this.refreshMetaStats();
        });
        this.store.set('onboardingSeen', true);
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
        const knifeId = this.store.get('equippedKnives')?.[this.player.team] || 'training';
        this.player.knifeId = knifeId;
        this.player.setKnifeStyle?.(KNIVES[knifeId] || KNIVES.training);
        this.ui.updateBallSkin?.(ballSkin);
        // FOV
        const fov = this.store.get('settings').fov || 75;
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
        const fovDisplay = document.getElementById('fov-value');
        if (fovDisplay) fovDisplay.textContent = `${fov}°`;
        // Music volume
        const settings = this.store.get('settings');
        this.audio.setSoundVolume((settings.soundVolume ?? settings.volume ?? 50) / 100);
        this.game.setMusicVolume((settings.musicVolume ?? settings.volume ?? 2) / 100);
    }

    applyAccessibility() {
        const settings = this.store.get('settings');
        this.renderer.setQuality(settings.quality || 'medium');
        const resolution = this.store.get('resolution');
        if (resolution?.w && resolution?.h) this.renderer.setResolutionTarget(resolution.w, resolution.h);
        this.renderer.setRenderScale(this.store.get('renderScale') || 1);
        this.game.juice.reducedMotion = !!settings.reduceMotion;
        this.game.juice.screenShakeEnabled = settings.screenShake !== false;
        this.game.juice.screenFlashEnabled = settings.screenFlash !== false;
        document.body.classList.toggle('reduced-motion', !!settings.reduceMotion);
        document.body.classList.toggle('high-contrast', !!settings.highContrast);
        document.body.dataset.colorBlind = settings.colorBlind || 'none';

        const values = {
            'setting-quality': settings.quality || 'medium',
            'setting-music-volume': settings.musicVolume ?? settings.volume ?? 2,
            'setting-sound-volume': settings.soundVolume ?? settings.volume ?? 50,
            'setting-reduce-motion': !!settings.reduceMotion,
            'setting-screen-shake': settings.screenShake !== false,
            'setting-screen-flash': settings.screenFlash !== false,
            'setting-high-contrast': !!settings.highContrast,
            'setting-color-blind': settings.colorBlind || 'none'
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (!element) return;
            if (element.type === 'checkbox') element.checked = value;
            else element.value = value;
        });
        const resolutionSelect = document.getElementById('setting-resolution');
        if (resolutionSelect && resolution?.w && resolution?.h) {
            resolutionSelect.value = `${resolution.w}x${resolution.h}`;
        }
        const renderScale = this.store.get('renderScale') || 1;
        const renderScaleInput = document.getElementById('setting-render-scale');
        if (renderScaleInput) renderScaleInput.value = Math.round(renderScale * 100);
        const renderScaleOutput = document.getElementById('setting-render-scale-value');
        if (renderScaleOutput) renderScaleOutput.textContent = `${Math.round(renderScale * 100)}%`;
    }

    refreshMetaStats() {
        this.ui.updateMetaStats?.(this.store);
        const showcase = document.getElementById('menu-character-showcase');
        if (showcase) {
            const charId = this.store.get('selectedChar') || 'rally';
            const skinId = this.store.get('equippedAvatarSkin') || 'default';
            const character = CHARACTERS[charId] || CHARACTERS.rally;
            const skin = AVATAR_SKINS[skinId] || AVATAR_SKINS.default;
            showcase.style.setProperty('--showcase-body', skin.body);
            showcase.style.setProperty('--showcase-skin', skin.head);
            showcase.style.setProperty('--showcase-ball', `#${character.color.toString(16).padStart(6, '0')}`);
        }
        // ponytail fix OW2-gap1: ow-avatar div'ini populate et
        const avEl = document.getElementById('ow-avatar');
        if (avEl) {
            const avatar = this.store.get('customAvatar');
            const charId = this.store.get('selectedChar') || 'rally';
            if (avatar?.dataURL) {
                avEl.style.backgroundImage = '';
                avEl.innerHTML = `<img src="${avatar.dataURL}" style="width:100%;height:100%;border-radius:50%;image-rendering:pixelated">`;
            } else {
                const index = Object.keys(CHARACTERS).indexOf(charId);
                const x = (Math.max(0, index) % 4) * (100 / 3);
                const y = Math.floor(Math.max(0, index) / 4) * 50;
                avEl.replaceChildren();
                avEl.style.backgroundImage = "url('assets/generated/characters/character-atlas.png')";
                avEl.style.backgroundSize = '400% 300%';
                avEl.style.backgroundPosition = `${x}% ${y}%`;
                avEl.style.backgroundRepeat = 'no-repeat';
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
        if (this.game._rewardsClaimed) return;
        this.game._rewardsClaimed = true;
        if (this.game._practiceMode) {
            this.game._practiceMode = false;
            return; // practice'ten reward yok
        }
        const stats = this.game.scoreboard.getPlayerStats();
        const myStat = stats.find(s => s.name === this.game.playerName) || { score:0, deflections:0, hits:0 };
        const winner = this.game.scoreboard.getWinner();
        const myTeam = this.player.team;
        const won = winner === myTeam.toUpperCase();
        if (this._rankedMatch) {
            const draw = winner === 'DRAW';
            const ranked = this.store.recordRankedMatch({
                matchId: `match-${Date.now()}`,
                opponentElo: this._rankedMatch.opponentElo,
                result: draw ? 'draw' : won ? 'win' : 'loss',
                playedAt: Date.now()
            });
            this.ui.showMessage?.(`Ranked ${won ? 'win' : draw ? 'draw' : 'loss'}: ${ranked.elo} ELO`, 3500);
            this._rankedMatch = null;
        }
        const coins = won ? 5 : 1;
        const xp = this.store.boostedXp(50 + myStat.deflections * 3 + (won ? 100 : 30));
        const result = this.store.grant({ currency: coins, xp });
        const matchId = globalThis.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.store.grantMatchRemote({
            matchId,
            won,
            deflections: myStat.deflections,
            score: myStat.score
        }).then(synced => {
            if (synced) this.refreshMetaStats();
        });
        const rally = this.game.rallyCount;
        const damageDealt = this.player.totalDamageDealt;
        const damageTaken = this.player.totalDamageTaken;
        const finalHp = this.player.hp;
        const cleanWin = won && damageTaken === 0;
        const criticalHit = this.game.killFeed.some(k => k.tag?.includes('CRITICAL'));
        const spikes = this.game.spikeCount || 0;

        const mastery = this.store.recordGame({
            won,
            deflects: myStat.deflections,
            hits: myStat.hits,
            rally,
            characterId: this.player.charId,
            characterXp: 35 + myStat.deflections * 2 + (won ? 75 : 20)
        });

        // Daily challenge ilerlemesi
        Daily.progress({ won, deflects: myStat.deflections, bestRally: rally, spikes, damage: damageDealt, winStreak: this.store.getWinStreak(), cleanWin });
        this.store.progressSeasonContracts({
            games: 1,
            wins: won ? 1 : 0,
            deflects: myStat.deflections
        });

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
        if (mastery.masteryLeveledUp) {
            this.ui.showMessage?.(`${CHARACTERS[this.player.charId]?.name || 'Character'} Mastery Lv ${mastery.masteryLevel}!`, 3000);
        }
        this.ui.showMessage?.(`+${coins} coins, +${xp} XP`, 3000);

        // Replay kaydet
        const replay = Replay.stopRecording();
        if (replay && replay.events.length > 0) Replay.save(replay);
    }

    // ponytail: mouse-follow glow + custom ball cursor on the main menu
    _setupMenuMouse() {
        const menu = document.getElementById('main-menu');
        const glow = menu?.querySelector('.ow-mouse-glow');
        const cursor = menu?.querySelector('.ow-cursor');
        if (!menu || !glow || !cursor) return;
        const onMove = (e) => {
            const x = (e.clientX / window.innerWidth) * 100;
            const y = (e.clientY / window.innerHeight) * 100;
            menu.style.setProperty('--mx', x + '%');
            menu.style.setProperty('--my', y + '%');
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        };
        const onDown = () => { cursor.style.transform = 'scale(0.7)'; };
        const onUp = () => { cursor.style.transform = 'scale(1)'; };
        // Only react when the menu is visible
        const handler = (e) => {
            if (menu.classList.contains('hidden')) return;
            onMove(e);
        };
        document.addEventListener('mousemove', handler, { signal: this._mainAbort.signal });
        document.addEventListener('mousedown', onDown, { signal: this._mainAbort.signal });
        document.addEventListener('mouseup', onUp, { signal: this._mainAbort.signal });
        // Hide custom cursor when leaving the menu
        menu.addEventListener('mouseleave', () => { cursor.style.opacity = '0'; });
        menu.addEventListener('mouseenter', () => { cursor.style.opacity = '1'; });
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

        bind('replay-toggle-pause', () => {
            Replay.togglePause();
            this._updateReplayControls();
        });
        bind('replay-prev', () => Spectator.prevTarget());
        bind('replay-next', () => Spectator.nextTarget());
        bind('replay-exit', () => this._exitReplay());
        document.getElementById('replay-seek')?.addEventListener('input', event => {
            const state = Replay.getPlaybackState();
            Replay.seek((Number(event.target.value) / 1000) * state.duration);
            this._updateReplayControls();
        });
        document.getElementById('replay-speed')?.addEventListener('change', event => {
            Replay.setPlaybackSpeed(Number(event.target.value));
        });
        document.getElementById('replay-camera-mode')?.addEventListener('change', event => {
            Spectator.setCameraMode(event.target.value);
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
                this._setupClientNetHandlers();
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
        bind('btn-map-editor', () => {
            this.ui.showScreen('mapEditor');
            this.initMapEditor();
        });

        bind('btn-achievements', () => {
            this.ui.renderAchievements(this.store);
            this.ui.showScreen('achievements');
        });

        bind('btn-daily', () => {
            this.ui.renderDaily(Daily, this.store);
            this.ui.showScreen('daily');
        });

        bind('btn-ranked', () => {
            this.ui.renderCareer(this.store);
            this.ui.showScreen('ranked');
        });
        bind('btn-ranked-play', () => {
            const elo = this.store.getElo();
            this._rankedMatch = {
                opponentElo: Math.max(0, Math.round(elo + (Math.random() * 200 - 100)))
            };
            this.game.startSolo();
            this.ui.showScreen('lobby');
            this.ui.showMessage?.(`Ranked opponent: ${this._rankedMatch.opponentElo} ELO`, 2200);
        });
        bind('btn-social', () => this._openSocialHubBrowser());
        bind('btn-social-lobby', () => this._openSocialHubBrowser());
        bind('social-hub-browser-close', () => this._closeSocialHubBrowser());
        bind('social-hub-browser-refresh', () => this._refreshSocialHubList());
        bind('social-lobby-exit', () => this._exitSocialLobby());
        bind('social-lobby-chat-send', () => this._sendSocialLobbyChat());
        document.getElementById('social-lobby-chat-input')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                this._sendSocialLobbyChat();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                event.currentTarget.blur();
                this.player.lock();
            }
        });
        bind('social-back', () => this.ui.showScreen('mainMenu'));
        bind('social-create-clan', () => this._createClan());
        bind('social-chat-send', () => this._sendClanMessage());
        document.getElementById('social-chat-input')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') this._sendClanMessage();
        });

        bind('btn-leaderboard', () => {
            this.ui.renderLeaderboard?.(this.store);
            this.ui.showScreen('leaderboard');
        });
        bind('btn-replays', () => {
            this.ui.renderReplays?.(Replay.loadAll());
            this.ui.showScreen('replays');
        });
        bind('btn-patchnotes', () => this.ui.showScreen('patchnotes'));
        bind('btn-patchnotes-back', () => this.ui.showScreen('mainMenu'));

        bind('btn-tournament', () => {
            this.ui.showScreen('tournament');
        });

        bind('btn-leaderboard-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });
        bind('btn-replays-back', () => {
            Replay.stopPlayback();
            this.ui.showScreen('mainMenu');
        });

        bind('btn-tournament-back', () => {
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
            this.game.setState(this._pausedFromState || STATES.PLAYING);
            this._pausedFromState = null;
            this.player.lock();
        });
        bind('pause-settings', () => {
            this.openSettingsModal();
        });
        bind('pause-exit', () => {
            document.getElementById('pause-menu')?.classList.add('hidden');
            this.player.unlock();
            this.ui.setPlayerTarget(false);
            this.network?.closeLobby();
            this.game.bots.forEach(b => b.remove());
            this.game.bots = [];
            this.game.botCounter = 0;
            this.game.ball.deactivate();
            this.game.clearBlackHoles?.();
            this.game.clearSplitBalls?.();
            if (this.game.affixes) this.game.affixes.clearRound();
            this.game.setState(STATES.MENU);
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
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
        bind('btn-map-editor-back', () => this.ui.showScreen('mainMenu'));
        bind('btn-map-delete', () => this.mapEditor?.deleteSelected());
        bind('btn-map-save', () => {
            if (!this.mapEditor) return;
            const config = this.mapEditor.getConfig();
            config.name = document.getElementById('map-editor-name')?.value || config.name;
            config.dimensions.width = Number(document.getElementById('map-editor-width')?.value) || config.dimensions.width;
            config.dimensions.length = Number(document.getElementById('map-editor-length')?.value) || config.dimensions.length;
            const safe = normalizeMapConfig(config);
            const id = 'custom-local';
            const maps = (this.store.get('customMaps') || []).filter(map => map.id !== id);
            maps.push({ id, config: safe });
            this.store.set('customMaps', maps.slice(-10));
            registerCustomMap(id, safe);
            this.mapEditor.setConfig(safe);
            this.arena.rebuild(id);
            this.startPractice();
        });

        bind('btn-char-save', () => {
            // Seçili karakter/skill/rune'ları topla
            const selectedChar = document.querySelector('.char-card.selected')?.dataset.char;
            const selectedSkill = document.querySelector('.skill-card.selected')?.dataset.skill;
            const selectedRunes = Array.from(document.querySelectorAll('.rune-card.selected')).map(el => el.dataset.rune).slice(0, 1);
            if (selectedChar) this.store.set('selectedChar', selectedChar);
            const loadout = { ...this.store.get('loadout'), skill: selectedSkill, runes: selectedRunes };
            this.store.setLoadout(loadout);
            this.applyLoadout();
            this.ui.showMessage?.('Loadout saved!');
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-avatar-clear', () => {
            this.avatarPainter?.clear();
        });

        // UI sound effects for menu buttons
        document.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const inMenu = this.game.state === STATES.MENU || this.game.state === STATES.LOBBY;
            if (inMenu || btn.closest('.panel, .pause-panel, .settings-modal')) {
                this.audio?.playClick?.();
            }
        }, { passive: true });

        // ponytail: eski lobby "👁" spectator butonu kaldırıldı — lobide spectator'a
        // geçmek Spectator.active'i bozuyordu. Spectator artık M menüsünden (oyun içi).

        // Spectator toggle for the M-menu. UI shows a Spectate/Leave button that
        // calls this; also keeps ui.spectating in sync for the button label.
        this.ui.onToggleSpectate = () => this.toggleSpectate();
        this.ui.onClassSelect = charId => this._changeRoundClass(charId);
        this.ui.onTeamConfirm = team => this._confirmTeamSelection(team);
        this.ui.onPlayerSafety = player => this._handlePlayerSafety(player);

        bind('btn-start-game', async () => {
            if (this.network.connected && !this.isLobbyHost()) {
                this.ui.showMessage?.('Only host can start', 1500);
                return;
            }
            const startButton = document.getElementById('btn-start-game');
            if (startButton?.disabled) return;
            if (startButton) startButton.disabled = true;
            clearInterval(this._lobbyKeepAlive);
            if (this._lobbyCode) this._unregisterLobby(this._lobbyCode);
            this._lobbyCode = null;
            this.audio.init();
            await this._showMatchLoading(950);
            this.player.lock();
            this.game.startGame();
            this.ui.updateContractTracker(Daily, this.store);
            if (this.network.connected && this.network.isHost) {
                this.network.broadcast({ type: 'gameStart', ...this.game.snapshotState() });
            }
            // Replay kaydı başlat
            Replay.startRecording({
                map: this.arena.mapId,
                mode: this.game.mode?.id || 'classic',
                players: this.game.getPlayerList().map(p => p.name)
            });
            this._lastRally = this.game.rallyCount;
            if (startButton) startButton.disabled = false;
        });

        bind('btn-party-ready', () => {
            const button = document.getElementById('btn-party-ready');
            const ready = !button?.classList.contains('is-ready');
            button?.classList.toggle('is-ready', ready);
            button?.setAttribute('aria-pressed', String(ready));
            if (button) button.textContent = ready ? 'READY!' : 'READY';
            this.game.broadcastSystemMessage(`${this.game.playerName} is ${ready ? 'READY' : 'not ready'}`);
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
            this.game.switchTeam('red');
        });

        bind('btn-team-blue', () => {
            this.game.switchTeam('blue');
        });

        bind('btn-lobby-back', () => {
            this.leaveLobby();
        });

        // Tab close / refresh while in a lobby → free the lobby immediately
        // instead of waiting for the 30s server TTL, and drop the P2P peer.
        window.addEventListener('beforeunload', () => {
            if (this.network?.isHost && this._lobbyCode) {
                try {
                    // sendBeacon only supports POST → server'un POST /api/lobbies/:code
                    // handler'ı lobby'yi tek seferde siler.
                    const url = `/api/lobbies/${encodeURIComponent(this._lobbyCode)}`;
                    navigator.sendBeacon(url, '');
                } catch (e) {}
            }
            try { this.network?.disconnect?.(); } catch (e) {}
        });

        // Game over
        bind('btn-play-again', () => {
            this.awardMatchRewards();
            this.game.startGame();
            this.player.lock();
        });

        bind('btn-main-menu', () => {
            this.awardMatchRewards();
            this.network?.closeLobby();
            this.game.bots.forEach(b => b.remove());
            this.game.bots = [];
            this.game.botCounter = 0;
            this.game.ball.deactivate();
            this.game.clearBlackHoles?.();
            this.game.clearSplitBalls?.();
            if (this.game.affixes) this.game.affixes.clearRound();
            this.ui.setPlayerTarget(false);
            this.game.setState(STATES.MENU);
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        // Post-game screen actions
        window._postGameAction = (action) => {
            if (action === 'play_again') {
                this.awardMatchRewards();
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
                this.network?.closeLobby();
                this.game.bots.forEach(b => b.remove());
                this.game.bots = [];
                this.game.botCounter = 0;
                this.game.ball.deactivate();
                this.game.clearBlackHoles?.();
                this.game.clearSplitBalls?.();
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
        const setRangePreview = range => {
            const min = Number(range.min) || 0;
            const max = Number(range.max) || 100;
            const value = Number(range.value);
            const progress = Math.min(100, Math.max(0, (value - min) / Math.max(1, max - min) * 100));
            range.style.setProperty('--range-progress', `${progress}%`);
        };
        document.querySelectorAll('#unified-settings input[type="range"]').forEach(range => {
            setRangePreview(range);
            range.addEventListener('input', () => setRangePreview(range));
        });
        const lobbyRegion = document.getElementById('lobby-region');
        if (lobbyRegion) {
            lobbyRegion.value = this.store.get('preferredRegion') || 'auto';
            lobbyRegion.addEventListener('change', event => {
                this.store.set('preferredRegion', event.target.value);
                this.ui.showMessage?.(`Preferred region: ${event.target.options[event.target.selectedIndex].text}`, 1400);
            });
        }

        this.settingsTabs = initSettingsTabs(document);
        const uiPreferences = loadUiPreferences(this.store);
        const themeInput = document.getElementById('setting-theme');
        if (themeInput) themeInput.value = uiPreferences.theme;
        const uiScaleInput = document.getElementById('setting-ui-scale');
        if (uiScaleInput) uiScaleInput.value = Math.round(uiPreferences.scale * 100);
        const uiScaleOutput = document.getElementById('setting-ui-scale-value');
        if (uiScaleOutput) uiScaleOutput.textContent = `${Math.round(uiPreferences.scale * 100)}%`;
        applyUiPreferences(document.documentElement, uiPreferences);

        bindSetting('setting-theme', event => {
            const theme = normalizeTheme(event.target.value);
            this.store.set('uiTheme', theme);
            applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
        });
        bindSetting('setting-ui-scale', event => {
            const scale = normalizeUiScale(Number(event.target.value) / 100);
            this.store.set('uiScale', scale);
            document.getElementById('setting-ui-scale-value').textContent = `${Math.round(scale * 100)}%`;
            applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
        });

        bindSetting('setting-sensitivity', e => {
            const value = parseFloat(e.target.value);
            this.player.setSensitivity(value / 1000);
            this.store.set('mouseSensitivity', value);
        });
        bindSetting('setting-music-volume', e => {
            const settings = this.store.get('settings');
            settings.musicVolume = parseFloat(e.target.value);
            this.store.set('settings', settings);
            this.game.setMusicVolume(settings.musicVolume / 100);
        });
        bindSetting('setting-sound-volume', e => {
            const settings = this.store.get('settings');
            settings.soundVolume = parseFloat(e.target.value);
            this.store.set('settings', settings);
            this.audio.setSoundVolume(settings.soundVolume / 100);
        });
        bindSetting('setting-fov', e => {
            const val = parseFloat(e.target.value);
            this.camera.fov = val;
            this.camera.updateProjectionMatrix();
            const s = this.store.get('settings');
            s.fov = val;
            this.store.set('settings', s);
            const display = document.getElementById('fov-value');
            if (display) display.textContent = `${val}°`;
        });
        // Resolution — apply immediately, persist against resize
        const ALLOWED_RESOLUTIONS = ['640x480','800x600','1024x768','1280x720','1366x768','1600x900','1920x1080','2560x1440','3840x2160'];
        bindSetting('setting-resolution', e => {
            const val = e.target.value;
            if (!ALLOWED_RESOLUTIONS.includes(val)) {
                this.ui.showMessage?.(`⚠️ Unsupported resolution: ${val}`, 2000);
                return;
            }
            const [w, h] = val.split('x').map(Number);
            this.store.set('resolution', { w, h });
            this.renderer.setResolutionTarget(w, h);
            this.ui.showMessage?.(`Render resolution: ${w}×${h}`, 1500);
        });
        bindSetting('setting-render-scale', e => {
            const scale = Math.min(1.5, Math.max(0.5, Number(e.target.value) / 100));
            this.store.set('renderScale', scale);
            this.renderer.setRenderScale(scale);
            const output = document.getElementById('setting-render-scale-value');
            if (output) output.textContent = `${Math.round(scale * 100)}%`;
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
            this.renderer.setQuality(e.target.value);
            this.ui.showMessage?.(`Quality: ${e.target.value}`, 1500);
        });
        const bindAccessibility = (id, key, checkbox = true) => {
            bindSetting(id, e => {
                const s = this.store.get('settings');
                s[key] = checkbox ? e.target.checked : e.target.value;
                this.store.set('settings', s);
                this.applyAccessibility();
                applyUiPreferences(document.documentElement, loadUiPreferences(this.store));
            });
        };
        bindAccessibility('setting-reduce-motion', 'reduceMotion');
        bindAccessibility('setting-screen-shake', 'screenShake');
        bindAccessibility('setting-screen-flash', 'screenFlash');
        bindAccessibility('setting-high-contrast', 'highContrast');
        bindAccessibility('setting-color-blind', 'colorBlind', false);
        // Crosshair settings
        const applyCrosshairLegacy = () => {
            const chEl = document.querySelector('.crosshair');
            // Only show crosshair during gameplay
            if (this.game.state !== STATES.PLAYING && this.game.state !== STATES.CELEBRATION) {
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
                if (!showDot) return;
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
            const directions = [
                { cls: 'top', x: '50%', y: `calc(50% - ${gap + size}px)`, w: `${thick}px`, h: `${size}px`, tx: 'translateX(-50%)' },
                { cls: 'bottom', x: '50%', y: `calc(50% + ${gap}px)`, w: `${thick}px`, h: `${size}px`, tx: 'translateX(-50%)' },
                { cls: 'left', x: `calc(50% - ${gap + size}px)`, y: '50%', w: `${size}px`, h: `${thick}px`, ty: 'translateY(-50%)' },
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
        const applyCrosshair = (dynamicScale = this._crosshairDynamicScale || 0) => {
            const hud = document.querySelector('.crosshair');
            const preview = document.getElementById('crosshair-preview-reticle');
            const config = normalizeCrosshairConfig(this.store.get('crosshairSettings'));
            if (hud) {
                const visible = this.game.state === STATES.PLAYING || this.game.state === STATES.CELEBRATION;
                hud.style.display = visible ? '' : 'none';
                if (visible) renderCrosshair(hud, config, dynamicScale);
            }
            if (preview) renderCrosshair(preview, config, dynamicScale);
            const previewCard = document.querySelector('.crosshair-preview-card');
            if (previewCard) {
                previewCard.style.setProperty('--preview-crosshair-color', config.color);
                previewCard.style.setProperty('--preview-crosshair-opacity', `${Math.round(config.opacity * 18)}%`);
                previewCard.classList.toggle('has-outline', config.outline);
            }
            return config;
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
        const chOutline = document.getElementById('setting-crosshair-outline');
        if (chOutline) {
            chOutline.addEventListener('change', e => {
                const s = this.store.get('crosshairSettings') || {};
                s.outline = e.target.checked;
                this.store.set('crosshairSettings', normalizeCrosshairConfig(s));
                applyCrosshair();
            });
        }
        bindSetting('setting-crosshair-opacity', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.opacity = Number(e.target.value) / 100;
            this.store.set('crosshairSettings', normalizeCrosshairConfig(s));
            applyCrosshair();
        });
        bindSetting('setting-crosshair-dynamic', e => {
            const s = this.store.get('crosshairSettings') || {};
            s.dynamicGap = Number(e.target.value);
            this.store.set('crosshairSettings', normalizeCrosshairConfig(s));
            applyCrosshair();
        });
        const crosshairSettings = {
            style: 'dot', color: '#00ff88', size: 12, gap: 6, thickness: 2, dot: true,
            ...(this.store.get('crosshairSettings') || {})
        };
        const hydrateSetting = (id, value, checked = false) => {
            const el = document.getElementById(id);
            if (el) checked ? (el.checked = value) : (el.value = value);
        };
        hydrateSetting('setting-crosshair', crosshairSettings.style);
        hydrateSetting('setting-crosshair-color', crosshairSettings.color);
        hydrateSetting('setting-crosshair-size', crosshairSettings.size);
        hydrateSetting('setting-crosshair-gap', crosshairSettings.gap);
        hydrateSetting('setting-crosshair-thickness', crosshairSettings.thickness);
        hydrateSetting('setting-crosshair-dot', crosshairSettings.dot, true);
        hydrateSetting('setting-crosshair-outline', crosshairSettings.outline, true);
        hydrateSetting('setting-crosshair-opacity', Math.round((crosshairSettings.opacity ?? 1) * 100));
        hydrateSetting('setting-crosshair-dynamic', crosshairSettings.dynamicGap ?? 0);
        const crosshairCodeInput = document.getElementById('crosshair-code-input');
        bind('crosshair-code-copy', async () => {
            const code = exportCrosshairCode(this.store.get('crosshairSettings'));
            if (crosshairCodeInput) crosshairCodeInput.value = code;
            try {
                await navigator.clipboard?.writeText(code);
                this.ui.showMessage?.('Crosshair code copied', 1400);
            } catch {
                crosshairCodeInput?.select();
                this.ui.showMessage?.('Crosshair code ready to copy', 1600);
            }
        });
        bind('crosshair-code-paste', async () => {
            try {
                const code = await navigator.clipboard?.readText();
                if (!code || !crosshairCodeInput) throw new Error('Clipboard empty');
                crosshairCodeInput.value = code.trim();
                crosshairCodeInput.focus();
                this.ui.showMessage?.('Crosshair code pasted - press Apply', 1500);
            } catch {
                crosshairCodeInput?.focus();
                this.ui.showMessage?.('Paste the code here, then press Apply', 1700);
            }
        });
        bind('crosshair-code-import', () => {
            const config = importCrosshairCode(crosshairCodeInput?.value.trim());
            if (!config) {
                this.ui.showMessage?.('Invalid crosshair code', 1800);
                return;
            }
            this.store.set('crosshairSettings', config);
            hydrateSetting('setting-crosshair', config.style);
            hydrateSetting('setting-crosshair-color', config.color);
            hydrateSetting('setting-crosshair-size', config.size);
            hydrateSetting('setting-crosshair-gap', config.gap);
            hydrateSetting('setting-crosshair-thickness', config.thickness);
            hydrateSetting('setting-crosshair-dot', config.dot, true);
            hydrateSetting('setting-crosshair-outline', config.outline, true);
            hydrateSetting('setting-crosshair-opacity', Math.round(config.opacity * 100));
            hydrateSetting('setting-crosshair-dynamic', config.dynamicGap);
            applyCrosshair();
            this.ui.showMessage?.('Crosshair applied and saved', 1600);
        });
        const savedSensitivity = this.store.get('mouseSensitivity') || 2;
        hydrateSetting('setting-sensitivity', savedSensitivity);
        this.player.setSensitivity(savedSensitivity / 1000);
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
                this.arena.setPortalsEnabled(e.target.checked);
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
        document.getElementById('match-modifier')?.addEventListener('change', event => this.game.setMatchModifier(event.target.value));
        updateCSLobbyInfo();
        this.initCarousel();

        // Karakter kart tıklama
        document.addEventListener('click', async e => {
            const charCard = e.target.closest('.char-card');
            if (charCard) {
                const charId = charCard.dataset.char;
                if (!this.store.ownsCharacter(charId)) {
                    // Satın almayı dene
                    if (await this.store.purchase('character', charId)) {
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
                    if (await this.store.purchase('skill', skillId)) {
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
                    if (await this.store.purchase('rune', runeId)) {
                        this.ui.renderCharacterSelect(this.store);
                        this.refreshMetaStats();
                    } else {
                        this.ui.showMessage?.('Not enough coins!');
                    }
                    return;
                }
                // Rune slot is deliberately single-choice for readable counterplay.
                if (runeCard.classList.contains('selected')) {
                    runeCard.classList.remove('selected');
                } else {
                    document.querySelectorAll('.rune-card.selected').forEach(card => card.classList.remove('selected'));
                    runeCard.classList.add('selected');
                }
            }
            // Shop buy buttons
            const buyBtn = e.target.closest('.shop-buy');
            if (buyBtn) {
                const type = buyBtn.dataset.type;
                const id = buyBtn.dataset.id;
                if (type === 'boost') {
                    const ok = this.store.buyAndActivateXpBoost();
                    this.ui.showMessage?.(ok ? '1.5x XP boost active for 1 hour!' : 'Not enough coins or boost active!');
                    this.ui.renderShop(this.store, 'boosts');
                    this.refreshMetaStats();
                    return;
                }
                const kind = type === 'char' ? 'character' : type;
                const ok = await this.store.purchase(kind, id);
                if (ok) {
                    this.ui.showMessage?.('Purchased!');
                    const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                    this.ui.renderShop(this.store, activeTab);
                    this.refreshMetaStats();
                } else {
                    this.ui.showMessage?.('Not enough coins or owned!');
                }
            }
            const trialBtn = e.target.closest('.shop-trial');
            if (trialBtn) {
                const id = trialBtn.dataset.id;
                if (this.store.startAvatarTrial(id)) {
                    this.initAvatarPainter();
                    this.avatarPainter?.applyPreset(id);
                    this.ui.showMessage?.('15 minute trial activated!');
                    this.ui.renderShop(this.store, 'avatars');
                } else {
                    this.ui.showMessage?.('Trial unavailable or already active.');
                }
            }
            // Equip ball from shop
            const equipBtn = e.target.closest('.shop-equip');
            if (equipBtn) {
                const ballId = equipBtn.dataset.id;
                if (equipBtn.dataset.type === 'avatar') {
                    this.store.equipAvatarSkin(ballId);
                    this.initAvatarPainter();
                    this.avatarPainter?.applyPreset(ballId);
                    this.ui.showMessage?.(`🎨 Equipped: ${AVATAR_SKINS[ballId].name}!`);
                } else {
                    this.store.set('equippedBall', ballId);
                    this.game.ball.setSkin(ballId);
                    this.ui.showMessage?.(`🎾 Equipped: ${BALL_SKINS[ballId].name}!`);
                }
                const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                this.ui.renderShop(this.store, activeTab);
                this.refreshMetaStats();
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
                    this.ui.renderDaily(Daily, this.store);
                    this.refreshMetaStats();
                }
                return;
            }
            const loginClaim = e.target.closest('.daily-login-claim');
            if (loginClaim) {
                const reward = this.store.claimDailyLogin();
                this.ui.showMessage?.(reward
                    ? `Daily login: +${reward.coins} coins - ${reward.streak} day streak`
                    : 'Daily login already claimed.');
                this.ui.renderDaily(Daily, this.store);
                this.refreshMetaStats();
                return;
            }
            const contractClaim = e.target.closest('.contract-claim');
            if (contractClaim) {
                const reward = this.store.claimSeasonContract(contractClaim.dataset.id);
                this.ui.showMessage?.(reward ? `Contract complete: +${reward} coins` : 'Contract is not ready.');
                this.ui.renderCareer(this.store);
                this.refreshMetaStats();
                return;
            }
            const trialStart = e.target.closest('.movement-trial-start');
            if (trialStart) {
                this._startMovementTrial(trialStart.dataset.id);
                return;
            }
            const dailyCase = e.target.closest('.daily-case-open');
            if (dailyCase) {
                const result = this.store.openDailyCase(dailyCase.dataset.id);
                this.ui.showMessage?.(result
                    ? `${result.duplicate ? `Duplicate +${result.refund} coins` : 'Unlocked'}: ${result.reward.name}`
                    : 'Free case already opened today.');
                this.ui.renderDaily(Daily, this.store);
                this.refreshMetaStats();
                return;
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
            const caseBtn = e.target.closest('.case-open');
            if (caseBtn) {
                const box = CASES[caseBtn.dataset.id];
                const balance = Number(this.store.get('currency')) || 0;
                const result = this.store.openCase(caseBtn.dataset.id);
                this.ui.showMessage?.(result
                    ? `${result.duplicate ? `Duplicate +${result.refund} coins` : 'Unlocked'}: ${result.reward.name}`
                    : !box ? 'Case unavailable.' : `Need ${box.price} coins - Balance ${balance}`);
                if (result) this.ui.showCaseReel(box, result);
                this.ui.renderShop(this.store, 'cases');
                this.refreshMetaStats();
                return;
            }
            const knifeBtn = e.target.closest('.knife-equip');
            if (knifeBtn) {
                const ok = this.store.equipKnife(knifeBtn.dataset.id, knifeBtn.dataset.team);
                this.ui.showMessage?.(ok ? `Equipped for ${knifeBtn.dataset.team.toUpperCase()}` : 'This knife cannot be equipped.');
                this.ui.renderShop(this.store, 'inventory');
                return;
            }
            const replayButton = e.target.closest('.replay-play, .replay-export, .replay-delete, .replay-highlight, .replay-highlight-copy');
            if (replayButton) {
                const all = Replay.loadAll();
                const index = Number(replayButton.dataset.index);
                const replay = all[index];
                if (!replay) return;
                if (replayButton.classList.contains('replay-highlight-copy')) {
                    const highlight = replay.highlights?.[Number(replayButton.dataset.highlight)];
                    const copy = highlight && navigator.clipboard?.writeText(Replay.exportJSON(extractReplayHighlight(replay, highlight)));
                    if (copy) copy.then(() => this.ui.showMessage?.('Highlight copied', 1200))
                        .catch(() => this.ui.showMessage?.('Clipboard unavailable', 1200));
                    else this.ui.showMessage?.('Clipboard unavailable', 1200);
                } else if (replayButton.classList.contains('replay-highlight')) {
                    const highlight = replay.highlights?.[Number(replayButton.dataset.highlight)];
                    if (highlight) this._startReplay(extractReplayHighlight(replay, highlight));
                } else if (replayButton.classList.contains('replay-delete')) {
                    if (Replay.delete(index)) this.ui.renderReplays?.(Replay.loadAll());
                } else if (replayButton.classList.contains('replay-export')) {
                    const copy = navigator.clipboard?.writeText(Replay.exportJSON(replay));
                    if (copy) copy.then(() => this.ui.showMessage?.('Replay copied', 1200))
                        .catch(() => this.ui.showMessage?.('Clipboard unavailable', 1200));
                    else this.ui.showMessage?.('Clipboard unavailable', 1200);
                } else {
                    this._startReplay(replay);
                }
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

        // Click to lock pointer during game (not when pause/settings open)
        const gameContainer = document.getElementById('game-container');
        gameContainer.addEventListener('click', () => {
            if ((this.game.state !== STATES.PLAYING
                && this.game.state !== STATES.CELEBRATION
                && this.game.state !== STATES.SOCIAL_HUB) || this.player.locked) return;
            if (this.chatOpen) return;
            const pauseEl = document.getElementById('pause-menu');
            if (pauseEl && !pauseEl.classList.contains('hidden')) return;
            const settingsEl = document.getElementById('unified-settings');
            if (settingsEl && !settingsEl.classList.contains('hidden')) return;
            this.player.lock();
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

    _setMatchWorldVisible(visible) {
        const nodes = [
            ...(this.arena.objects || []),
            this.game.ball?.mesh,
            ...this.game.bots.map(bot => bot.group),
            ...[...this.game.remotePlayers.values()].map(player => player.group || player.mesh)
        ].filter(Boolean);
        if (!visible) {
            this._matchWorldVisibility = nodes.map(node => [node, node.visible]);
            this._matchWorldVisibility.forEach(([node]) => { node.visible = false; });
            return;
        }
        for (const [node, wasVisible] of this._matchWorldVisibility || []) node.visible = wasVisible;
        if (this.game.ball?.mesh) this.game.ball.mesh.visible = !!this.game.ball.active;
        for (const bot of this.game.bots) {
            if (bot.group) bot.group.visible = bot.alive !== false;
        }
        for (const player of this.game.remotePlayers.values()) {
            const node = player.group || player.mesh;
            if (node) node.visible = player.alive !== false;
        }
        this._matchWorldVisibility = null;
    }

    _suppressMatchWorldDuringHub() {
        if (!this._matchWorldVisibility) return;
        const nodes = [
            ...(this.arena.objects || []),
            this.game.ball?.mesh,
            ...this.game.bots.map(bot => bot.group),
            ...[...this.game.remotePlayers.values()].map(player => player.group || player.mesh)
        ].filter(Boolean);
        const known = new Set(this._matchWorldVisibility.map(([node]) => node));
        for (const node of nodes) {
            if (!known.has(node)) this._matchWorldVisibility.push([node, node.visible]);
            node.visible = false;
        }
    }

    _socialHubApi(path, options = {}) {
        return fetch(path, options).then(response => response.json()).catch(() => ({}));
    }

    _tryVoicePing([sound, message]) {
        const now = performance.now();
        this._voicePingAttempts = this._voicePingAttempts.filter(at => now - at < 60_000);
        if (now < this._voicePingMutedUntil) return false;
        this._voicePingAttempts.push(now);
        if (this._voicePingAttempts.length >= 10) {
            this._voicePingMutedUntil = now + 60_000;
            this._voicePingAttempts.length = 0;
            this.ui.showMessage?.('Voice pings muted for 1 minute.', 1800);
            return false;
        }
        if (now - this._lastVoicePingAt < 5_000) return false;
        this._lastVoicePingAt = now;
        this.audio.playVoicePing(sound);
        this.game.broadcastSystemMessage(`${this.game.playerName}: ${message}`);
        return true;
    }

    async _openSocialHubBrowser() {
        const browser = document.getElementById('social-hub-browser');
        if (!browser) return;
        this.player.unlock();
        browser.classList.remove('hidden');
        await this._refreshSocialHubList();
        clearInterval(this._socialHubRefreshTimer);
        this._socialHubRefreshTimer = setInterval(() => this._refreshSocialHubList(), 8000);
    }

    _closeSocialHubBrowser() {
        clearInterval(this._socialHubRefreshTimer);
        this._socialHubRefreshTimer = null;
        document.getElementById('social-hub-browser')?.classList.add('hidden');
    }

    async _refreshSocialHubList() {
        const response = await this._socialHubApi('/api/social-hubs');
        const active = Array.isArray(response) ? response : [];
        const container = document.getElementById('social-hub-room-list');
        if (!container) return;
        const byMap = new Map(active.map(room => [room.mapId, room]));
        container.replaceChildren(...Object.values(SOCIAL_HUB_MAPS).map(map => {
            const room = byMap.get(map.id) || null;
            const card = document.createElement('article');
            card.className = `social-hub-room ${map.id}`;
            const meta = document.createElement('div');
            meta.className = 'social-hub-room-meta';
            meta.innerHTML = `<span>${room ? 'ACTIVE ROOM' : 'OPEN WORLD'}</span><span>${room?.players || 0} ONLINE</span>`;
            const title = document.createElement('h3');
            title.textContent = map.name;
            const copy = document.createElement('p');
            copy.textContent = room ? `${room.hostName}'s public ${map.name} room is ready.` : `No one is here yet. Open the first ${map.name} room.`;
            const join = document.createElement('button');
            join.type = 'button';
            join.className = 'social-hub-room-enter';
            join.textContent = room ? 'Join room' : `Open ${map.name}`;
            join.addEventListener('click', () => this._joinSocialHubRoom(map.id, room?.code));
            card.append(meta, title, copy, join);
            return card;
        }));
    }

    async _registerSocialHub(code) {
        if (!code || !this._socialHubMapId) return;
        await this._socialHubApi('/api/social-hubs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, mapId: this._socialHubMapId, hostName: this.game.playerName, players: this.network.connections.size + 1 })
        });
    }

    _setupSocialHubHost(code) {
        this.network.onPlayerJoin = (name, playerId, avatar, peerId) => {
            this.network.broadcast({ type: 'newPeer', playerId, peerId, name });
            this._registerSocialHub(code);
            this._appendSocialLobbyChat('VOLLE', `${name} entered the hub.`, true);
        };
        this.network.onPlayerLeave = playerId => {
            this.socialLobby.removeRemoteVisitor(playerId);
            this._registerSocialHub(code);
        };
        this._socialHubKeepAlive = setInterval(() => {
            if (this.network.connected && this.network.isHost) this._registerSocialHub(code);
        }, 12000);
    }

    async _joinSocialHubRoom(mapId, roomCode) {
        const map = SOCIAL_HUB_MAPS[mapId];
        if (!map) return;
        const name = document.getElementById('player-name-input')?.value?.trim() || this.store.get('playerName') || 'Player';
        this.game.playerName = name;
        this.network.playerName = name;
        this._socialHubMapId = mapId;
        this._closeSocialHubBrowser();
        try {
            if (roomCode) {
                this.network.onHostLeft = () => {
                    if (this.socialLobby.active) this._exitSocialLobby();
                    this.ui.showMessage?.('Social Hub host left.', 2500);
                };
                await this.network.joinGame(roomCode, name);
            } else {
                const code = await this.network.hostGame(name);
                this._socialHubCode = code;
                this._setupSocialHubHost(code);
                await this._registerSocialHub(code);
            }
            await this._showMatchLoading(950, { name: map.name, modeName: 'Social Hub' });
            this._enterSocialLobby(mapId);
        } catch (error) {
            this._socialHubCode = null;
            this.network.disconnect();
            this.ui.showMessage?.(`Could not join ${map.name}.`, 2500);
        }
    }

    _enterSocialLobby(mapId = this._socialHubMapId || 'island') {
        if (this.socialLobby.active) return;
        this._longJumpTrack = null;
        const name = document.getElementById('player-name-input')?.value?.trim()
            || this.store.get('playerName')
            || 'Player';
        this.game.playerName = name;
        this.network.playerName = name;
        this._setMatchWorldVisible(false);
        this._hubVisualState = {
            clearColor: this.renderer.renderer.getClearColor(new THREE.Color()).clone(),
            fogColor: this.renderer.scene.fog?.color.clone(),
            fogNear: this.renderer.scene.fog?.near,
            fogFar: this.renderer.scene.fog?.far,
            handVisible: this.player.armGroup?.visible === true
        };
        this.renderer.renderer.setClearColor(0x8ed8f3);
        this.renderer.setHubPerformance?.(true);
        if (this.renderer.scene.fog) {
            this.renderer.scene.fog.color.set(0xa9e8f4);
            this.renderer.scene.fog.near = 110;
            this.renderer.scene.fog.far = 390;
        }
        this.ui.hideAll();
        document.getElementById('social-lobby-hud')?.classList.remove('hidden');
        document.body.classList.add('social-hub-active');
        this.game.setState(STATES.SOCIAL_HUB);
        this.player.setHandVisible(false);
        const map = this.socialLobby.selectMap(mapId);
        this.socialLobby.enter(undefined, map.id);
        const status = document.getElementById('social-lobby-status');
        if (status) status.textContent = `Loading ${map.name}...`;
        const mapTitle = document.getElementById('social-lobby-map-title');
        if (mapTitle) mapTitle.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#i-map"></use></svg> ${map.name.toUpperCase()} MAP`;
        const mapCredit = document.getElementById('social-lobby-map-credit');
        if (mapCredit) mapCredit.textContent = map.credit;
        this.socialLobby.ready.then(() => {
            if (!this.socialLobby.active || !status) return;
            status.textContent = `${map.name} - public room active`;
        });
        this._appendSocialLobbyChat('VOLLE', `Welcome to ${map.name}. Explore and chat with the room.`, true);
        this.player.lock();
    }

    _leaveSocialLobby() {
        if (!this.socialLobby.active) return;
        clearInterval(this._socialHubKeepAlive);
        this._socialHubKeepAlive = null;
        if (this._socialHubCode) this._socialHubApi(`/api/social-hubs/${encodeURIComponent(this._socialHubCode)}`, { method: 'DELETE' });
        this._socialHubCode = null;
        this._socialHubMapId = null;
        if (this.network.connected) this.network.closeLobby();
        this._longJumpTrack = null;
        this.socialLobby.exit();
        for (const id of this._socialRemoteSeen.keys()) this.socialLobby.removeRemoteVisitor(id);
        this._socialRemoteSeen.clear();
        document.getElementById('social-lobby-hud')?.classList.add('hidden');
        document.body.classList.remove('social-hub-active');
        this._setMatchWorldVisible(true);
        if (this._hubVisualState) {
            this.renderer.renderer.setClearColor(this._hubVisualState.clearColor);
            if (this.renderer.scene.fog && this._hubVisualState.fogColor) {
                this.renderer.scene.fog.color.copy(this._hubVisualState.fogColor);
                this.renderer.scene.fog.near = this._hubVisualState.fogNear;
                this.renderer.scene.fog.far = this._hubVisualState.fogFar;
            }
            this.player.setHandVisible(this._hubVisualState.handVisible);
        }
        this._hubVisualState = null;
        this.renderer.setHubPerformance?.(false);
        this.player.unlock();
        this.game.setState(STATES.MENU);
    }

    _exitSocialLobby() {
        this._leaveSocialLobby();
        this.ui.showScreen('mainMenu');
        this.refreshMetaStats();
    }

    _updateSocialPresence(presence) {
        const remoteCount = presence.filter(visitor => !visitor.local).length;
        const online = document.getElementById('social-lobby-online');
        if (online) online.textContent = `${1 + remoteCount} online`;
        this._drawSocialLobbyMap(presence);
    }

    _drawSocialLobbyMap(presence = this.socialLobby.getPresence()) {
        const canvas = document.getElementById('social-lobby-map');
        const ctx = canvas?.getContext?.('2d');
        if (!canvas || !ctx) return;
        const state = getSocialLobbyMapState(this.player, presence, this.socialLobby.mapId);
        const width = canvas.width;
        const height = canvas.height;
        const point = marker => ({ x: marker.x * width, y: marker.z * height });
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#041820';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(112,221,255,0.09)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) {
            ctx.beginPath();
            ctx.moveTo(width * i / 6, 0);
            ctx.lineTo(width * i / 6, height);
            ctx.moveTo(0, height * i / 6);
            ctx.lineTo(width, height * i / 6);
            ctx.stroke();
        }
        const rangeX = state.bounds.maxX - state.bounds.minX;
        const rangeZ = state.bounds.maxZ - state.bounds.minZ;
        ctx.fillStyle = 'rgba(112,221,255,0.16)';
        for (const block of this.socialLobby.getMapBlocks?.() || []) {
            const x = (block.minX - state.bounds.minX) / rangeX * width;
            const y = (block.minZ - state.bounds.minZ) / rangeZ * height;
            const blockWidth = Math.max(1, (block.maxX - block.minX) / rangeX * width);
            const blockHeight = Math.max(1, (block.maxZ - block.minZ) / rangeZ * height);
            ctx.fillRect(x, y, blockWidth, blockHeight);
        }
        for (const visitor of state.visitors) {
            const marker = point(visitor);
            ctx.fillStyle = visitor.local ? 'rgba(255,255,255,0.38)' : '#72bfff';
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, visitor.local ? 3 : 4, 0, Math.PI * 2);
            ctx.fill();
        }
        if (state.player) {
            const marker = point(state.player);
            ctx.fillStyle = '#6af4e5';
            ctx.shadowColor = '#6af4e5';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(marker.x, marker.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    _updateMovementPolish(social = false) {
        const speed = Number(this.player.horizontalSpeed) || 0;
        const now = performance.now();
        if (this.player.longJumpEvent && !this._longJumpTrack) {
            this._longJumpTrack = {
                start: this.player.position.clone(),
                startedAt: now,
                maxSpeed: speed,
                social
            };
        }
        if (this._longJumpTrack) {
            this._longJumpTrack.maxSpeed = Math.max(this._longJumpTrack.maxSpeed, speed);
            if ((this.player.onGround && now - this._longJumpTrack.startedAt > 120)
                || now - this._longJumpTrack.startedAt > 3500) {
                const dx = this.player.position.x - this._longJumpTrack.start.x;
                const dz = this.player.position.z - this._longJumpTrack.start.z;
                const distance = Math.hypot(dx, dz);
                const message = `${this.game.playerName || 'Player'} longjumped ${distance.toFixed(1)}m at ${Math.round(this._longJumpTrack.maxSpeed)} u/s`;
                this.store.progressSeasonContracts({ longjumpDistance: distance });
                if (this._longJumpTrack.social) this._appendSocialLobbyChat('MOVEMENT', message, true);
                else this.game.addChatMessage('MOVEMENT', message);
                this._longJumpTrack = null;
            }
        }
        const movementState = this.player.longJumpEvent || (this._longJumpTrack && !this.player.onGround)
            ? 'LONGJUMP'
            : !this.player.onGround && speed > this.player.speed
                ? 'BHOP'
                : speed > this.player.speed * 1.08
                    ? 'SPRINT'
                    : 'MOVE';
        this.ui.updateMovementHUD(speed, movementState, social);
        if (!social) {
            const dynamic = Math.min(1, Math.max(0, (speed - this.player.speed * 0.7) / Math.max(1, this.player.speed)));
            const bucket = Math.round(dynamic * 10) / 10;
            if (bucket !== this._crosshairDynamicScale) {
                this._crosshairDynamicScale = bucket;
                this.applyCrosshair?.(bucket);
            }
        }
    }

    _receiveSocialPresence(data) {
        if (!this.socialLobby.active || data.playerId === this.network.playerId) return;
        const modelIds = ['a', 'f', 'k', 'r'];
        const modelIndex = Math.max(0, modelIds.indexOf(String(data.skin || '').replace('character-', '')));
        this.socialLobby.setRemoteVisitor(data.playerId, {
            name: data.name,
            modelIndex,
            position: data,
            rotationY: data.ry
        });
        this._socialRemoteSeen.set(data.playerId, performance.now());
        this._updateSocialPresence(this.socialLobby.getPresence());
    }

    _receiveSocialChat(data) {
        if (!this.socialLobby.active || data.playerId === this.network.playerId) return;
        this._appendSocialLobbyChat(data.name, data.text);
    }

    _appendSocialLobbyChat(name, text, system = false) {
        const log = document.getElementById('social-lobby-chat-log');
        if (!log) return;
        log.querySelector('.social-lobby-chat-empty')?.remove();
        const row = document.createElement('p');
        row.className = system ? 'social-lobby-chat-message system' : 'social-lobby-chat-message';
        const sender = document.createElement('strong');
        sender.textContent = `${String(name).slice(0, 24)}: `;
        row.append(sender, document.createTextNode(String(text).slice(0, 160)));
        log.appendChild(row);
        while (log.children.length > 40) log.firstElementChild?.remove();
        log.scrollTop = log.scrollHeight;
    }

    _sendSocialLobbyChat() {
        const input = document.getElementById('social-lobby-chat-input');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';
        const name = this.game.playerName || 'Player';
        this._appendSocialLobbyChat(name, text);
        this.network.sendSocialChat(text);
        input.blur();
        document.getElementById('social-lobby-chat')?.classList.add('hidden');
        this.player.lock();
    }

    _socialUserId() {
        const clean = String(this.game.playerName || this.store.get('playerName') || 'player')
            .replace(/[^A-Za-z0-9_.:-]/g, '-')
            .replace(/^-+/, '')
            .slice(0, 48);
        return clean || 'player';
    }

    _renderSocial() {
        const state = this.store.get('socialState');
        const clans = listClans(state);
        const userId = this._socialUserId();
        const selected = clans.find(clan => clan.id === this._selectedClanId)
            || clans.find(clan => clan.members.some(member => member.userId === userId))
            || clans[0];
        this._selectedClanId = selected?.id || null;
        const list = document.getElementById('social-clan-list');
        if (list) {
            list.replaceChildren();
            if (!clans.length) {
                const empty = document.createElement('div');
                empty.className = 'social-empty';
                empty.textContent = 'No clans yet. Create the first crew.';
                list.appendChild(empty);
            }
            for (const clan of clans) {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = `social-clan-card${clan.id === this._selectedClanId ? ' selected' : ''}`;
                card.textContent = `[${clan.tag}] ${clan.name} - ${clan.members.length} members`;
                card.addEventListener('click', () => {
                    this._selectedClanId = clan.id;
                    this._renderSocial();
                }, { once: true });
                list.appendChild(card);
            }
        }
        const chat = document.getElementById('social-chat-log');
        if (chat) {
            chat.replaceChildren();
            const messages = selected ? state.clanChats[selected.id] || [] : [];
            for (const message of messages) {
                const row = document.createElement('p');
                row.className = 'social-chat-message';
                row.textContent = `${message.senderId}: ${message.text}`;
                chat.appendChild(row);
            }
            if (!messages.length) chat.textContent = selected ? 'No messages yet.' : 'Join or create a clan to chat.';
        }
    }

    _createClan() {
        const input = document.getElementById('social-clan-name');
        const name = input?.value.trim();
        if (!name) return;
        const userId = this._socialUserId();
        const tag = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).padEnd(2, 'X');
        try {
            const next = createClan(this.store.get('socialState'), {
                clanId: `clan-${Date.now()}`,
                name,
                tag,
                ownerId: userId,
                createdAt: Date.now()
            });
            this.store.set('socialState', next);
            input.value = '';
            this._renderSocial();
        } catch (error) {
            this.ui.showMessage?.(error.message, 1800);
        }
    }

    _sendClanMessage() {
        const input = document.getElementById('social-chat-input');
        const text = input?.value;
        if (!text || !this._selectedClanId) return;
        try {
            const next = appendClanMessage(this.store.get('socialState'), {
                clanId: this._selectedClanId,
                messageId: `msg-${Date.now()}`,
                senderId: this._socialUserId(),
                text,
                sentAt: Date.now()
            });
            this.store.set('socialState', next);
            input.value = '';
            this._renderSocial();
        } catch (error) {
            this.ui.showMessage?.(error.message, 1800);
        }
    }

    _queueRoundReplay() {
        const end = Math.max(0, performance.now() - (Replay.startTs || performance.now()));
        const replay = { meta: Replay.meta || {}, events: Replay.events.slice(), duration: end };
        this._latestRoundReplay = extractReplayHighlight(replay, {
            label: 'Last 5 Seconds', start: Math.max(0, end - 5000), end
        });
        this.ui.showMessage?.('Last 5 seconds captured - replay available after match', 1800);
    }

    _startReplay(replay) {
        this._exitReplay(false);
        this.game.selectMap(replay.meta?.map);
        this.game._hideKillcam?.();
        this.player.killcamLock = false;
        this.game.setState(STATES.PAUSED);
        this.ui.hideAll();
        this.ui.showHUD();
        this.player.unlock();
        this.replayView = new ReplayView(this.renderer.scene);
        this._replaySpectatorGame = {
            player: { camera: this.camera },
            camera: this.camera,
            playerName: 'Replay',
            arena: this.arena,
            getAllTargets: () => this.replayView?.targets || []
        };
        Spectator.enter(this._replaySpectatorGame, { mode: 'chase' });
        document.getElementById('replay-controls')?.classList.remove('hidden');
        Replay.play(replay, {
            deflect: data => this.ui.showMessage?.(`Rally ${data?.rally || ''}`, 500),
            hit: data => this.ui.showMessage?.(`Hit ${data?.damage || ''}`, 500),
            renderSnapshot: snapshot => {
                if (snapshot.ball) {
                    this.game.ball.active = true;
                    this.game.ball.mesh.visible = true;
                    this.game.ball.position.set(snapshot.ball.x, snapshot.ball.y, snapshot.ball.z);
                    this.game.ball.mesh.position.copy(this.game.ball.position);
                }
                this.replayView?.apply(snapshot);
                Spectator.refreshTargets();
            },
            time: () => this._updateReplayControls(),
            pause: () => this._updateReplayControls(),
            resume: () => this._updateReplayControls(),
            complete: () => this._exitReplay()
        });
        this._updateReplayControls();
        this.ui.showMessage?.('Replay: [ ] target, F camera, WASD freecam, ESC exit', 2400);
    }

    _exitReplay(showList = true) {
        Replay.stopPlayback();
        Spectator.exit();
        this.replayView?.clear();
        this.replayView = null;
        this._replaySpectatorGame = null;
        this.game?.ball?.deactivate();
        document.getElementById('replay-controls')?.classList.add('hidden');
        if (!showList || !this.game) return;
        this.game.setState(STATES.MENU);
        this.ui.renderReplays?.(Replay.loadAll());
        this.ui.showScreen('replays');
    }

    _updateReplayControls() {
        const state = Replay.getPlaybackState();
        const toggle = document.getElementById('replay-toggle-pause');
        if (toggle) {
            const label = state.paused ? 'Play replay' : 'Pause replay';
            toggle.setAttribute('aria-label', label);
            toggle.title = label;
            toggle.querySelector('use')?.setAttribute('href', state.paused ? '#i-play' : '#i-pause');
        }
        const seek = document.getElementById('replay-seek');
        if (seek && state.duration > 0 && document.activeElement !== seek) {
            seek.value = Math.round((state.time / state.duration) * 1000);
        }
        const format = value => {
            const seconds = Math.max(0, Math.floor(value / 1000));
            return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        };
        const time = document.getElementById('replay-time');
        if (time) time.textContent = `${format(state.time)} / ${format(state.duration)}`;
    }

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
        if ([STATES.PLAYING, STATES.COUNTDOWN, STATES.ROUND_END, STATES.CELEBRATION].includes(this.game.state)) this.player.lock();
    }

    // Tournament başlat — bracket oluştur, UI'da göster.
    startTournament(playerNames) {
        tournament.create(playerNames);
        this.ui.renderTournament?.(tournament);
    }

    initAvatarPainter() {
        const canvas = document.getElementById('avatar-canvas');
        if (!canvas) return;
        const preview = document.getElementById('avatar-preview');
        if (!this.avatarPainter) this.avatarPainter = new AvatarPainter(canvas, this.store);
        // Live 3D preview update on every stroke
        const updatePreview = () => {
            const teamColor = this.game?.player?.team === 'red' ? '#cc3333' : '#3355cc';
            this.avatarPainter.renderPreview(preview, teamColor);
            const selected = document.getElementById('avatar-selected-skin');
            if (selected) selected.textContent = AVATAR_SKINS[this.avatarPainter.skinId]?.name || 'Selected skin';
        };
        this.avatarPainter.onchange = updatePreview;
        updatePreview(); // initial render
        // Palette
        const paletteEl = document.getElementById('avatar-palette');
        if (paletteEl) {
            paletteEl.innerHTML = '';
            AvatarPainter.getPalette().forEach(c => {
                const sw = document.createElement('button');
                sw.type = 'button';
                sw.className = 'palette-swatch';
                sw.style.background = c;
                sw.title = c;
                sw.setAttribute('aria-label', `Use ${c}`);
                sw.addEventListener('click', () => {
                    this.avatarPainter.setColor(c);
                    paletteEl.querySelectorAll('.palette-swatch').forEach(item => item.classList.remove('selected'));
                    sw.classList.add('selected');
                });
                paletteEl.appendChild(sw);
            });
            paletteEl.firstElementChild?.classList.add('selected');
        }
        // Tool buttons
        document.querySelectorAll('[data-tool]').forEach(btn => {
            if (btn.dataset.avatarBound) return;
            btn.dataset.avatarBound = 'true';
            btn.addEventListener('click', () => {
                this.avatarPainter.setTool(btn.dataset.tool);
                document.querySelectorAll('[data-tool]').forEach(item => {
                    const selected = item === btn;
                    item.classList.toggle('selected', selected);
                    item.setAttribute('aria-pressed', String(selected));
                });
            });
        });
        const library = document.getElementById('avatar-skin-library');
        if (library) {
            const owned = new Set(this.store.get('ownedAvatarSkins') || []);
            library.replaceChildren(...Object.values(AVATAR_SKINS).map(skin => {
                const free = skin.price === 0;
                const unlocked = free || owned.has(skin.id);
                const card = document.createElement('button');
                card.type = 'button';
                card.className = `avatar-skin-card${this.avatarPainter.skinId === skin.id ? ' selected' : ''}`;
                card.disabled = !unlocked;
                card.innerHTML = `<span class="avatar-skin-head" style="--skin-head:${skin.head};--skin-body:${skin.body}"></span>
                    <b>${skin.name}</b><small>${skin.team ? skin.team.toUpperCase() : skin.model.toUpperCase()}${unlocked ? '' : ` · ${skin.price} coins`}</small>`;
                card.addEventListener('click', () => {
                    this.avatarPainter.applyPreset(skin.id);
                    library.querySelectorAll('.avatar-skin-card').forEach(item => item.classList.remove('selected'));
                    card.classList.add('selected');
                    updatePreview();
                });
                return card;
            }));
        }
    }

    initMapEditor() {
        const canvas = document.getElementById('map-editor-canvas');
        if (!canvas) return;
        const saved = this.store.get('customMaps')?.find(map => map.id === 'custom-local')?.config;
        const status = document.getElementById('map-editor-status');
        const refresh = config => {
            if (status) status.textContent = `${config.props.length} / 64 props`;
        };
        if (!this.mapEditor) {
            this.mapEditor = new MapEditorController(canvas, saved || {}, { onChange: refresh });
            document.getElementById('map-editor-tool')?.addEventListener('change', e => this.mapEditor.setTool(e.target.value));
            document.getElementById('map-editor-primitive')?.addEventListener('change', e => this.mapEditor.setPrimitive(e.target.value));
        }
        const config = this.mapEditor.getConfig();
        const name = document.getElementById('map-editor-name');
        const width = document.getElementById('map-editor-width');
        const length = document.getElementById('map-editor-length');
        if (name) name.value = config.name;
        if (width) width.value = config.dimensions.width;
        if (length) length.value = config.dimensions.length;
        refresh(config);
        this.mapEditor.render();
    }

    // --- CAROUSEL METHODS ---

    _showMatchLoading(duration = 900, match = {}) {
        const overlay = document.getElementById('match-loading');
        if (!overlay) return Promise.resolve();
        const mapId = match.map || this.arena?.mapId;
        const config = Arena.MAPS[mapId] || this.arena?.config || {};
        const mode = match.mode || this.game?.mode?.id || 'classic';
        const modeName = match.modeName || GAME_MODES[mode]?.name || this.game?.mode?.name || mode;
        const tips = [
            'Tip: move after every throw.',
            'Tip: pass angles beat raw power.',
            'Tip: a late deflect can reverse a rally.',
            'Tip: keep space between teammates.'
        ];
        const mapEl = document.getElementById('match-loading-map');
        const modeEl = document.getElementById('match-loading-mode');
        const tipEl = document.getElementById('match-loading-tip');
        if (mapEl) mapEl.textContent = match.name || config.name || String(mapId || 'Arena');
        if (modeEl) modeEl.textContent = String(modeName).toUpperCase();
        if (tipEl) tipEl.textContent = tips[Math.floor(Math.random() * tips.length)];
        overlay.classList.remove('hidden', 'active');
        void overlay.offsetWidth;
        overlay.classList.add('active');
        return new Promise(resolve => {
            window.setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('active');
                resolve();
            }, duration);
        });
    }

    initCarousel() {
        const keys = Object.keys(Arena.MAPS);
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

        const weatherMap = { clear: '☀️', rain: '🌧️', storm: '⛈️', snow: '❄️', indoor: '🏟️' };
        const weatherEl = document.getElementById('carousel-weather');
        if (weatherEl) weatherEl.textContent = weatherMap[config.weather] || '☀️';

        const sizeEl = document.getElementById('carousel-size');
        if (sizeEl) sizeEl.textContent = formatMapSize(config);
        this._drawLobbyMapPreview(config);

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

    _drawLobbyMapPreview(config) {
        const canvas = document.getElementById('lobby-map-canvas');
        const ctx = canvas?.getContext?.('2d');
        if (!canvas || !ctx || !config) return;
        const width = canvas.width;
        const height = canvas.height;
        const toHex = color => `#${Number(color || 0).toString(16).padStart(6, '0').slice(-6)}`;
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, toHex(config.floorRed || 0x2b7d82));
        gradient.addColorStop(1, toHex(config.floorBlue || 0x287caa));
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#061820';
        ctx.fillRect(0, 0, width, height);
        ctx.save();
        ctx.translate(width * 0.1, height * 0.12);
        const courtWidth = width * 0.8;
        const courtHeight = height * 0.72;
        ctx.fillStyle = gradient;
        ctx.strokeStyle = 'rgba(221,255,252,0.72)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(0, 0, courtWidth, courtHeight, 18);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(courtWidth / 2, 0);
        ctx.lineTo(courtWidth / 2, courtHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#effffd';
        for (const x of [courtWidth * 0.18, courtWidth * 0.82]) {
            ctx.beginPath();
            ctx.arc(x, courtHeight / 2, 7, 0, Math.PI * 2);
            ctx.fill();
        }
        const props = Array.isArray(config.props) ? config.props.slice(0, 24) : [];
        props.forEach((prop, index) => {
            const px = ((Number(prop.position?.x ?? prop.x ?? index) % 40) + 40) % 40 / 40;
            const pz = ((Number(prop.position?.z ?? prop.z ?? index * 3) % 40) + 40) % 40 / 40;
            ctx.fillStyle = index % 2 ? 'rgba(255,211,107,0.82)' : 'rgba(111,243,227,0.82)';
            ctx.fillRect(px * (courtWidth - 16), pz * (courtHeight - 16), 8, 8);
        });
        ctx.restore();
    }

    // --- SETTINGS MODAL ---

    openSettingsModal() {
        this.ui.hideScoreboard();
        const modal = document.getElementById('unified-settings');
        if (modal) modal.classList.remove('hidden');
        this.applyCrosshair?.(0);
        // ponytail: round/match ayarları sadece lobi sahibinde değişebilir
        const host = this.isLobbyHost();
        const lock = (id) => {
            const el = document.getElementById(id);
            if (el) { el.disabled = !host; el.style.opacity = host ? '' : '0.4'; }
        };
        lock('setting-max-rounds');
        lock('setting-match-time');
        lock('lobby-name-input');
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
        document.querySelectorAll('#btn-add-bot-red, #btn-add-bot-blue').forEach(button => {
            button.disabled = true;
        });
        this.ui.showScreen('lobby');
        // Practice lobby'sinde farklı butonlar göster
        this.ui.showMessage?.('Practice mode: R spawn ball, F move ball', 3000);
    }

    _startMovementTrial(trialId) {
        const trial = MOVEMENT_TRIALS[trialId];
        if (!trial) return;
        this.game.selectMap(trial.map);
        this.startPractice();
        if (trial.character) {
            const loadout = this.store.get('loadout') || DEFAULT_LOADOUT;
            this.player.applyLoadout(trial.character, loadout.runes);
        }
        this._pendingMovementTrial = trialId;
        this.game.startGame();
        this.player.lock();
        this.ui.showMessage?.(`${trial.name}: reach ${trial.targetDistance}m before time expires`, 2600);
    }

    _ensureMovementGhost() {
        if (this._movementGhost) return this._movementGhost;
        const material = new THREE.MeshBasicMaterial({
            color: 0x61f4e8,
            transparent: true,
            opacity: 0.32,
            depthWrite: false
        });
        const ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.1, 4, 8), material);
        ghost.visible = false;
        ghost.renderOrder = 10;
        this.renderer.scene.add(ghost);
        this._movementGhost = ghost;
        return ghost;
    }

    _updateMovementTrial(dt) {
        if (this._pendingMovementTrial && this.game.state === STATES.PLAYING) {
            const best = this.store.getMovementTrialBest(this._pendingMovementTrial);
            this.movementTrials.start(this._pendingMovementTrial, this.player.getPosition(), best);
            this._pendingMovementTrial = null;
        }
        const active = this.movementTrials.active;
        if (!active) {
            this.ui.updateMovementTrialHUD(null);
            if (this._movementGhost) this._movementGhost.visible = false;
            return;
        }
        const state = this.movementTrials.update(this.player.getPosition(), {
            dt,
            onGround: this.player.onGround,
            speed: this.player.horizontalSpeed
        });
        if (!state) return;
        this.ui.updateMovementTrialHUD(state);
        const ghost = this._ensureMovementGhost();
        if (state.active && state.ghost) {
            ghost.position.set(
                state.origin.x + state.ghost.x,
                state.origin.y + state.ghost.y + 0.9,
                state.origin.z + state.ghost.z
            );
            ghost.visible = true;
        } else {
            ghost.visible = false;
        }
        if (state.status === 'completed') {
            const result = this.store.saveMovementTrialResult(state.trial, state.record);
            const suffix = `${result.personalBest ? ' - NEW PB' : ''}${result.reward ? ` - +${result.reward} coins` : ''}`;
            this.ui.showMessage?.(`${state.trial.name}: ${(state.elapsed / 1000).toFixed(2)}s${suffix}`, 4200);
            this.refreshMetaStats();
        } else if (state.status === 'failed') {
            this.ui.showMessage?.(`${state.trial.name}: time expired`, 2600);
        }
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
                this.broadcastLobbyState();
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
        const name = document.getElementById('lobby-name-input')?.value || 'Lobby';
        this._lobbyName = name;
        this.network.broadcast({
            type: 'lobbyState', players, lobbyName: name,
            settings: {
                matchTime: parseInt(document.getElementById('setting-match-time')?.value || 300),
                maxRounds: parseInt(document.getElementById('setting-max-rounds')?.value || 16),
                botDifficulty: document.getElementById('setting-bot-difficulty')?.value || 'hard'
            }
        });
    }

    // Wire the client-side network callbacks (used by every join path).
    _setupClientNetHandlers() {
        this._setupReconnectUI();
        this.network.onKicked = (reason) => {
            this._exitToMenu(reason === 'password' ? '❌ Wrong lobby password' : '❌ Kicked from lobby');
        };
        this.network.onTeamChange = (pName, team) => {
            this.game.switchPlayerTeam?.(pName, team);
            if (this.network.isHost) this.broadcastLobbyState();
        };
        // Live lobby updates + initial welcome — host broadcasts a fresh
        // player list whenever someone joins or leaves. Late-join: welcome
        // içindeki state PLAYING/COUNTDOWN ise client otomatik startGame tetikler.
        this.network.onGameState = (data) => {
            if (data?.type === 'lobbyState' || data?.type === 'welcome') {
                this.game.applyLobbyState(data);
                if (data?.type === 'welcome' && data.state) {
                    if (data.state === STATES.SOCIAL_HUB) this._enterSocialLobby();
                    else {
                        const result = this.game.handleLateJoin?.(data);
                        if (result?.queued) this._enterLateJoinSpectator(result);
                    }
                }
            }
            // Mesh: on welcome, connect to all existing peers directly (skip host relay)
            if (data?.type === 'welcome' && !this.network.isHost && data.players) {
                const myId = this.network.playerId;
                const myPeerId = this.network.peer?.id;
                const hostId = this.network.hostConn?.peer;
                data.players.forEach(pl => {
                    if (pl.peerId && (pl.playerId || pl.peerId) !== myId && pl.peerId !== myPeerId && pl.peerId !== hostId) {
                        this.network.connectToPeer(pl.peerId, pl.playerId);
                    }
                });
            }
        };
        this.network.onHostLeft = () => {
            this._exitToMenu('🚪 Host left — lobby closed');
        };
    }

    _setupReconnectUI() {
        this.network.onReconnectState = (state, attempt) => {
            const status = document.getElementById('lobby-network-status');
            if (state === 'reconnecting') {
                this.ui.showMessage?.(`Reconnecting... ${attempt}/3`, 1800);
                if (status) {
                    status.textContent = `RECONNECTING ${attempt}/3`;
                    status.className = 'is-reconnecting';
                }
            } else if (state === 'connected') {
                this.ui.showMessage?.('Reconnected', 1800);
                if (status) {
                    status.textContent = 'CONNECTED';
                    status.className = '';
                }
            } else if (status) {
                status.textContent = 'DISCONNECTED';
                status.className = 'is-offline';
            }
        };
    }

    // Leave the lobby cleanly. Host closes it for everyone; clients just drop.
    leaveLobby() {
        clearInterval(this._lobbyKeepAlive);
        this._stopBgLoop();
        this._cleanupListeners();
        if (this.network?.isHost && this._lobbyCode) this._unregisterLobby(this._lobbyCode);
        this._lobbyCode = null;
        // Tell peers + tear down the P2P connection.
        this.network?.closeLobby?.();
        this._cleanupLobbyEntities();
        this.ui.showScreen('mainMenu');
    }

    // Shared cleanup when returning to the menu from a lobby (host or client).
    _exitToMenu(message) {
        clearInterval(this._lobbyKeepAlive);
        this._stopBgLoop();
        this._cleanupListeners();
        this._lobbyCode = null;
        this.network?.disconnect();
        this._cleanupLobbyEntities();
        this.game.ball.deactivate();
        this.game.setState(STATES.MENU);
        this.ui.showScreen('mainMenu');
        if (message) this.ui.showMessage?.(message, 2500);
    }

    // ponytail: abort + re-setup player input listeners (game-specific, avoids leak on restart)
    _cleanupListeners() {
        this.player?.cleanupInput?.();
        this.player?.setupInput?.();
    }

    _cleanupLobbyEntities() {
        this.game._avatarCache?.clear();
        this.game.bots.forEach(b => b.remove());
        this.game.bots = [];
        this.game.botCounter = 0;
        this.game.remotePlayers.forEach((p, id) => this.game.removeRemotePlayer(id));
        this.game.scoreboard.reset();
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
            this._setupClientNetHandlers();
            await this.network.joinGame(code, name);
            this.game.playerName = name;
            // ponytail: bg loop runs client-side interpolation + state handling throughout the game
            this._startBgLoop();
            this.ui.showScreen('lobby');
            this.ui.showMessage?.('🔗 Joined lobby!', 2000);
        } catch (e) {
            alert('Failed to join: ' + e.message);
        }
    }

    // Host: sunucu kur (P2P oda aç)
    async _doHostGame() {
        try {
            clearInterval(this._lobbyKeepAlive); // önceki varsa durdur
            if (this._lobbyCode) this._unregisterLobby(this._lobbyCode); // eski varsa sil
            const name = document.getElementById('player-name-input')?.value || 'Host';
            this.game.playerName = name;
            const code = await this.network.hostGame(name);
            if (this._localLobbyPassword) this.network.setLobbyPassword(this._localLobbyPassword);
            // ponytail: bg loop is the authoritative host sim — must run regardless of tab visibility
            this._startBgLoop();
            this.game.startSolo();
            this.ui.setRoomCode(code);
            this.ui.showScreen('lobby');
            const nameInput = document.getElementById('lobby-name-input');
            if (nameInput) { nameInput.disabled = false; nameInput.value = 'Lobby'; }
            this._lobbyName = 'Lobby';
            // Lobby name change handler
            const onLobbyNameChange = () => {
                if (!this.network?.isHost) return;
                const v = document.getElementById('lobby-name-input')?.value?.trim() || 'Lobby';
                if (v !== this._lobbyName) {
                    this._lobbyName = v;
                    this.broadcastLobbyState();
                    this._registerLobby(code, v, this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
                }
            };
            const onLobbyNameInput = () => {
                if (this._lobbyNameTimeout) clearTimeout(this._lobbyNameTimeout);
                this._lobbyNameTimeout = setTimeout(onLobbyNameChange, 400);
            };
            if (nameInput) nameInput.addEventListener('input', onLobbyNameInput);
            this.network.onPlayerJoin = (pName, playerId, avatar, peerId) => {
                const existing = this.game.remotePlayers.has(playerId);
                this.game.addRemotePlayer(playerId, pName, null, avatar, peerId);
                if (!existing && this.game.shouldQueueLateJoin()) {
                    this.game.queueRemoteForNextRound(playerId);
                    this.game.broadcastSystemMessage(`${pName} joined as spectator.`);
                } else {
                    this.ui.showMessage(`${pName} joined!`);
                }
                this.game.updateLobbyUI();
                this.refreshFriendsSidebar();
                // Mesh: tell existing clients to P2P-connect to the new peer
                this.network.broadcast({ type: 'newPeer', playerId, peerId, name: pName });
                this.broadcastLobbyState();
                this._registerLobby(code, this._lobbyName, this.network.connections.size + 1, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            };
            this.network.onPlayerLeave = (playerId, peerId) => {
                this.game.removeRemotePlayer(playerId);
                this.ui.showMessage?.('A player left');
                this.game.updateLobbyUI();
                this.refreshFriendsSidebar();
                // Mesh: tell remaining clients to drop P2P connection
                this.network.broadcast({ type: 'peerLeft', playerId, peerId });
                this.broadcastLobbyState();
                this._registerLobby(code, this._lobbyName, this.network.connections.size, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            };
            // Host: client kendi takımını değiştirmek isterse uygula, sonra broadcast et.
            this.network.onTeamChange = (pName, team, playerId) => {
                const p = this.game.remotePlayers.get(playerId);
                if (p?.queuedForNextRound) {
                    if (this.game.selectQueuedRemoteTeam(playerId, team)) {
                        this.game.broadcastSystemMessage(`${p.name} will join ${team.toUpperCase()} next round.`);
                    }
                    this.broadcastLobbyState();
                    return;
                }
                this.game.switchPlayerTeam?.(pName, team);
                this.broadcastLobbyState();
            };
            this.network.onLateJoinTeam = (playerId, team) => {
                const p = this.game.remotePlayers.get(playerId);
                if (!p || !this.game.selectQueuedRemoteTeam(playerId, team)) return;
                this.game.broadcastSystemMessage(`${p.name} will join ${team.toUpperCase()} next round.`);
                this.broadcastLobbyState();
            };
            this.network.onGameState = (data) => {
                if (data.type === 'welcome') this.game.applyLobbyState(data);
            };
            this._registerLobby(code, this._lobbyName, 1, this.arena.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            this.ui.showMessage?.(`🏠 Lobby created! Code: ${code}`, 3000);
            // Auto-re-register every 12s to keep lobby alive
            this._lobbyKeepAlive = setInterval(() => {
                if (this.network.connected && this.network.isHost) {
                    this._registerLobby(code, this._lobbyName, this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
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
            if (!Spectator.active && [STATES.PLAYING, STATES.COUNTDOWN, STATES.ROUND_END, STATES.CELEBRATION].includes(this.game.state)) this.player.lock();
        } else {
            this.ui.spectating = Spectator.active;
            this.ui.showTeamPopup(this.game);
            this.player.unlock(); // free the mouse for clicking
        }
    }

    _confirmTeamSelection(team) {
        if (team !== 'red' && team !== 'blue') return;
        this.game.switchTeam(team);
        this.ui.showMessage?.(`Selected ${team.toUpperCase()} team.`, 1200);
        this.ui._renderTeamLists(this.game);
    }

    _handlePlayerSafety(player) {
        const name = String(player?.name || '').slice(0, 24);
        if (!name) return;
        if (this._mutedPlayers.has(name)) {
            this._mutedPlayers.delete(name);
            this.ui.showMessage?.(`${name} unmuted.`, 1200);
        } else {
            this._mutedPlayers.add(name);
            this.ui.showMessage?.(`${name} muted. Local report saved.`, 1600);
        }
        this.store.set('mutedPlayers', [...this._mutedPlayers].slice(-100));
    }

    _changeRoundClass(charId) {
        const character = CHARACTERS[charId];
        if (!character || this.player.charId === charId) return false;
        const round = Number(this.game.scoreboard?.roundNum) || 0;
        if (this.game.state === STATES.PLAYING && this.player._classChangeRound === round) {
            this.ui.showMessage?.('You can change class once per round.', 1800);
            return false;
        }
        const loadout = this.store.get('loadout') || DEFAULT_LOADOUT;
        this.player.applyLoadout(charId, loadout.runes);
        this.player.loadout.skill = loadout.skill || 'slow';
        this.player._classChangeRound = round;
        this.store.set('selectedChar', charId);
        this.refreshMetaStats();
        this.ui.showMessage?.(`Class changed to ${character.name}.`, 1600);
        this.ui._renderClassSwitch?.(this.game);
        return true;
    }

    // Enter/leave spectator from the M-menu. On leave, resume the player.
    toggleSpectate() {
        if (this.player.queuedForNextRound && Spectator.active) {
            this.ui.showMessage?.('Waiting for next round', 1200);
            return;
        }
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

    _enterLateJoinSpectator(info = {}) {
        Spectator.enter(this.game);
        this.ui.spectating = true;
        this.player.alive = false;
        this.player.setHandVisible?.(false);
        this.player.unlock();
        const status = document.getElementById('late-join-status');
        if (status) {
            status.textContent = `SPECTATING - ${String(info.team || 'red').toUpperCase()} next round`;
            status.classList.remove('hidden');
        }
        this.ui.showTeamPopup(this.game);
        this.ui.showMessage?.('Match in progress. Choose a team; you spawn next round.', 2600);
    }

    _exitLateJoinSpectator(team) {
        Spectator.exit('round-start');
        this.ui.spectating = false;
        document.getElementById('late-join-status')?.classList.add('hidden');
        this.ui.hideTeamPopup();
        this.ui.showMessage?.(`Joined ${String(team).toUpperCase()}`, 1500);
        if (this.game.state === STATES.PLAYING) this.player.lock();
    }

    initFriendsSidebar() {
        Friends.onChange = () => this.refreshFriendsSidebar();
        this._chattingWith = null;

        document.getElementById('fbar-toggle')?.addEventListener('click', () => {
            const sidebar = document.getElementById('friends-sidebar');
            if (!sidebar) return;
            sidebar.classList.toggle('collapsed');
            document.getElementById('fbar-toggle').textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
        });

        document.getElementById('fbar-add-input')?.addEventListener('keydown', e => {
            if (e.code !== 'Enter') return;
            const input = document.getElementById('fbar-add-input');
            const name = input?.value.trim();
            if (name && name.length >= 2) {
                Friends.add(name);
                input.value = '';
                this.refreshFriendsSidebar();
            }
        });

        document.getElementById('fbar-chat-send')?.addEventListener('click', () => this._sendFriendDM());
        document.getElementById('fbar-chat-input')?.addEventListener('keydown', e => {
            if (e.code === 'Enter') this._sendFriendDM();
        });
        document.getElementById('fbar-chat-close')?.addEventListener('click', () => {
            this._chattingWith = null;
            document.getElementById('fbar-chat')?.classList.add('hidden');
        });

        Friends.onDM = (friendName, from, text) => {
            if (this._chattingWith === friendName) this._renderChatThread(friendName);
        };

        if (this.network) {
            this.network.onFriendDM = (from, text) => {
                Friends.addDM(from, from, text);
            };
        }
    }

    refreshFriendsSidebar() {
        const allOnline = [];
        if (this.game) {
            allOnline.push({ name: this.game.playerName, isMe: true });
            this.game.bots.forEach(b => allOnline.push({ name: b.name }));
            this.game.remotePlayers.forEach(p => allOnline.push({ name: p.name }));
        }
        const friendSet = new Set(Friends.friends.map(f => f.toLowerCase()));
        const onlineEl = document.getElementById('fbar-online');
        const offlineList = document.getElementById('fbar-offline-list');
        const offSub = document.querySelector('.friends-sidebar-subtitle');
        const countEl = document.getElementById('fbar-count');
        if (!onlineEl) return;

        // Separate: friend online vs non-friend online
        const onlineFriends = allOnline.filter(p => friendSet.has(p.name.toLowerCase()) && !p.isMe);
        const onlineOthers = allOnline.filter(p => !friendSet.has(p.name.toLowerCase()) && !p.isMe);
        if (countEl) countEl.textContent = onlineFriends.length ? `${onlineFriends.length} online` : '';

        // Online friends
        if (!onlineFriends.length && !onlineOthers.length) {
            onlineEl.innerHTML = '<div class="friends-sidebar-empty">No players online</div>';
        } else {
            let html = '';
            // Friend section
            if (onlineFriends.length) {
                html += `<div class="friends-sidebar-subtitle">FRIENDS • ${onlineFriends.length}</div>`;
                html += onlineFriends.map(n =>
                    `<div class="fbar-friend" data-name="${n.name}">
                        <div class="fbar-avatar online-avatar">${n.name.charAt(0).toUpperCase()}<span class="fbar-status-dot online"></span></div>
                        <span class="fbar-name">${this._escapeHTML(n.name)}</span>
                        <div class="fbar-actions">
                            <button class="fbar-msg-btn" title="Message">💬</button>
                            <button class="fbar-remove-btn" title="Remove">✕</button>
                        </div>
                    </div>`
                ).join('');
            }
            // Other online players (not friends)
            if (onlineOthers.length) {
                html += `<div class="friends-sidebar-subtitle">IN LOBBY • ${onlineOthers.length}</div>`;
                html += onlineOthers.map(n =>
                    `<div class="fbar-friend" data-name="${n.name}">
                        <div class="fbar-avatar online-avatar">${n.name.charAt(0).toUpperCase()}<span class="fbar-status-dot online"></span></div>
                        <span class="fbar-name">${this._escapeHTML(n.name)}</span>
                        <div class="fbar-actions">
                            <button class="fbar-add-btn" title="Add friend">＋</button>
                        </div>
                    </div>`
                ).join('');
            }
            onlineEl.innerHTML = html;

            onlineEl.querySelectorAll('.fbar-friend').forEach(el => {
                const name = el.dataset.name;
                el.addEventListener('click', e => {
                    if (e.target.closest('.fbar-actions')) return;
                    this._openChatWith(name);
                });
                el.querySelector('.fbar-msg-btn')?.addEventListener('click', e => {
                    e.stopPropagation();
                    this._openChatWith(name);
                });
                el.querySelector('.fbar-remove-btn')?.addEventListener('click', e => {
                    e.stopPropagation();
                    Friends.remove(name);
                    this.refreshFriendsSidebar();
                });
                el.querySelector('.fbar-add-btn')?.addEventListener('click', e => {
                    e.stopPropagation();
                    Friends.add(name);
                    this.refreshFriendsSidebar();
                });
            });
        }

        // Offline friends
        const offline = Friends.friends.filter(f => !allOnline.some(p => p.name.toLowerCase() === f.toLowerCase()));
        if (offSub) offSub.style.display = offline.length ? '' : 'none';
        if (!offline.length) {
            if (offlineList) offlineList.innerHTML = '';
        } else if (offlineList) {
            offlineList.innerHTML = offline.map(n =>
                `<div class="fbar-friend" data-name="${n}">
                    <div class="fbar-avatar offline-avatar">${n.charAt(0).toUpperCase()}<span class="fbar-status-dot offline"></span></div>
                    <span class="fbar-name offline-name">${this._escapeHTML(n)}</span>
                    <div class="fbar-actions">
                        <button class="fbar-remove-btn" title="Remove">✕</button>
                    </div>
                </div>`
            ).join('');
            offlineList.querySelectorAll('.fbar-friend').forEach(el => {
                el.querySelector('.fbar-remove-btn')?.addEventListener('click', e => {
                    e.stopPropagation();
                    Friends.remove(el.dataset.name);
                    this.refreshFriendsSidebar();
                });
            });
        }

        if (this._chattingWith) this._renderChatThread(this._chattingWith);
    }

    _openChatWith(name) {
        this._chattingWith = name;
        document.getElementById('fbar-chat')?.classList.remove('hidden');
        document.getElementById('fbar-chat-name').textContent = name;
        this._renderChatThread(name);
    }

    _renderChatThread(name) {
        const log = document.getElementById('fbar-chat-log');
        if (!log) return;
        const msgs = Friends.getDMs(name);
        const me = this.game?.playerName || 'You';
        if (!msgs.length) { log.innerHTML = '<div style="opacity:0.3;padding:12px 0;font-style:italic;text-align:center;font-size:0.85em">No messages yet</div>'; return; }
        log.innerHTML = msgs.map(m =>
            `<div class="friends-chat-msg ${m.from === me ? 'msg-mine' : ''}">
                <span class="msg-from">${this._escapeHTML(m.from)}</span>
                <span class="msg-text">${this._escapeHTML(m.text)}</span>
            </div>`
        ).join('');
        log.scrollTop = log.scrollHeight;
    }

    _sendFriendDM() {
        const input = document.getElementById('fbar-chat-input');
        const text = input?.value.trim();
        if (!text || !this._chattingWith) return;
        input.value = '';
        const me = this.game?.playerName || 'You';
        Friends.addDM(this._chattingWith, me, text);
        this._renderChatThread(this._chattingWith);
        const peer = this.game?.remotePlayers?.forEach(p => {
            if (p.name === this._chattingWith && p.peerId && this.network) {
                this.network.sendDM(p.peerId, text);
            }
        });
        // Also try host relay for non-peer-connected friends
        if (this.network?.hostConn && this.network.hostConn.peer !== this._chattingWith) {
            this.network.sendDM(this.network.hostConn.peer, text);
        }
    }

    _escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    openChat() {
        this.ui.hideScoreboard();
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

    // ===== ALT-TAB KORUMA: RAF donunca network background timer'la çalışsın =====
    _onVisibilityChange() {
        // ponytail: bg loop continues running (host sim depends on it now); only audio + render throttle
        if (document.hidden) {
            this._tabHidden = true;
            if (this.audio?.ctx?.state === 'running') this.audio.ctx.suspend();
        } else {
            this._tabHidden = false;
            if (this.audio?.ctx?.state === 'suspended') this.audio.ctx.resume();
        }
    }
    _startBgLoop() {
        if (this._bgInterval) return;
        this._bgAccumulator = 0;
        this._lastBgDt = performance.now();
        this._bgPosSent = new Map(); // playerName → lastPos for delta filter
        this._bgScoreTimer = 0;
        this._bgPowerUpTimer = 0;
        this._bgInterval = setInterval(() => {
            // ponytail: bg loop is now the authoritative host simulation path — must run regardless of tab visibility.
            // Only condition: a network connection must exist (otherwise no game to simulate).
            if (!this.network?.connected) return;
            if (!document.hidden && this._tabHidden) this._tabHidden = false;
            const now = performance.now();
            const dt = Math.min((now - this._lastBgDt) / 1000, 0.1);
            this._lastBgDt = now;
            // Fixed 60Hz authoritative simulation.
            this._bgAccumulator += dt;
            const step = 1 / 60;
            let steps = 0;
            while (this._bgAccumulator >= step && steps < 8) {
                this._bgTick(step);
                this._bgAccumulator -= step;
                steps++;
            }
            if (steps === 0 && document.hidden) {
                // Remote lerp even if no full step
                this.game.invokeRemoteSnapshots(dt);
                this.game.invokeBallSmoothing?.(dt);
            }
            // Host broadcasts use packet-specific rate limits.
            if (this.game.state === STATES.PLAYING) {
                this._hostBgSlowBroadcast(dt);
            }
            if (this.game.state === STATES.MENU) {
                this._renderMenuBg();
            }
        }, 1000 / 60);
    }
    _stopBgLoop() {
        if (this._bgInterval) {
            clearInterval(this._bgInterval);
            this._bgInterval = null;
        }
    }
    _bgTick(dt) {
        // Remote player lerp always
        if (document.hidden) {
            this.game.invokeRemoteSnapshots(dt);
            this.game.invokeBallSmoothing?.(dt);
        }
        // Process attack queue (bg tab hidden icin — main loop calismaz)
        this._bgProcessAttackQueue();
        // Game simulation only for host (all states need update — round timing, celebration, etc.)
        if (this.network?.isHost) {
            this.game.update(dt);
            // Host position to clients (delta filtered) — player can move during these states
            if (document.hidden && (this.game.state === STATES.PLAYING || this.game.state === STATES.CELEBRATION)) {
                this._bgSendPosition(dt);
            }
        } else {
            // Client: send position when alt-tabbed
            if (document.hidden && (this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN)) {
                this._bgSendPosition(dt);
            }
        }
    }
    _bgProcessAttackQueue() {
        if (this.player._p2pAttackQueued) {
            this.player._p2pAttackQueued = false;
        }
    }
    // Host position with delta filter — sadece threshold aşınca gönder
    _bgSendPosition(dt) {
        const p = this.player;
        if (p.queuedForNextRound) return;
        const key = this.game.playerName || 'host';
        const last = this._bgPosSent.get(key);
        const pos = p.position;
        this._bgPosKeepalive = (this._bgPosKeepalive || 0) + 1;
        const moved = !last
            || pos.distanceTo(last.pos) > 0.15
            || Math.abs(p.euler.y - last.ry) > 0.05
            || this._bgPosKeepalive >= 20; // force every ~1s
        if (moved) {
            this._bgPosKeepalive = 0;
            this._bgPosSent.set(key, { pos: pos.clone(), ry: p.euler.y });
            // ponytail: delta-compress — only changed static/rarely-changed fields
            this._bgLastFull = this._bgLastFull || {};
            const prev = this._bgLastFull;
            const extra = {
                ax: p.getAimDirection().x, ay: p.getAimDirection().y, az: p.getAimDirection().z,
                vx: p._frameVel?.x || 0, vy: p._frameVel?.y || 0, vz: p._frameVel?.z || 0
            };
            if (prev.name !== this.game.playerName) { extra.name = this.game.playerName; prev.name = this.game.playerName; }
            if (prev.team !== p.team) { extra.team = p.team; prev.team = p.team; }
            if (prev.charId !== p.charId) { extra.charId = p.charId; prev.charId = p.charId; }
            if (prev.knifeId !== p.knifeId) { extra.knifeId = p.knifeId; prev.knifeId = p.knifeId; }
            if (prev.alive !== p.alive) { extra.alive = p.alive; prev.alive = p.alive; }
            if (prev.hp !== p.hp) { extra.hp = p.hp; prev.hp = p.hp; }
            this.network.sendPosition(pos, p.euler.y, extra);
        }
    }
    // Host slow-rate broadcasts: score 2Hz, powerUp 2Hz, ballState 15Hz
    _hostBgSlowBroadcast(dt) {
        if (!this.network?.isHost) return;
        this._bgBallTimer += dt;
        // Ball state: 30Hz binary position/velocity; state/target only when changed.
        if (this._bgBallTimer >= 1 / 30 && (this.game.ball.active || this.game.ball.state !== 'idle')) {
            this._bgBallTimer %= 1 / 30;
            this._ballSeq = (this._ballSeq || 0) + 1;
            const b = this.game.ball;
            const newState = b.state;
            const newTarget = b.targetPlayer?.name || null;
            // ponytail: delta — only include state/target when they change (rare)
            const ballExtra = {};
            if (this._lastBallState !== newState) { ballExtra.state = newState; this._lastBallState = newState; }
            if (this._lastBallTarget !== newTarget) { ballExtra.targetName = newTarget; this._lastBallTarget = newTarget; }
            this.network.broadcastBinary(this.network.encodeBallState({
                seq: this._ballSeq,
                x: b.position.x, y: b.position.y, z: b.position.z,
                vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
                speed: b.currentSpeed, active: b.active,
                ...ballExtra
            }));
        }
        // Score 2Hz
        this._bgScoreTimer += dt;
        if (this._bgScoreTimer >= 0.5) {
            this._bgScoreTimer = 0;
            this.network.broadcast({
                type: 'scoreUpdate',
                red: this.game.scoreboard.redScore, blue: this.game.scoreboard.blueScore,
                time: this.game.scoreboard.timeRemaining, round: this.game.scoreboard.roundNum,
                players: this.game.scoreboard.getPlayerStats(),
                killFeed: this.game.killFeed.slice(0, 5).map(k => ({
                    attacker: k.attacker, victim: k.victim, dmg: k.dmg, tag: k.tag
                }))
            });
        }
        // Bot positions 10Hz
        this._bgBotTimer += dt;
        if (this._bgBotTimer >= 0.1 && this.game.bots.length > 0) {
            this._bgBotTimer %= 0.1;
            const botData = this.game.bots.map(b => ({
                name: b.name, team: b.team,
                x: b.position.x, y: b.position.y, z: b.position.z,
                ry: b.rotation?.y || 0,
                alive: b.alive, hp: b.hp, charId: b.charId
            }));
            this.network.broadcast({ type: 'botSync', bots: botData });
        }
        // PowerUps 2Hz
        this._bgPowerUpTimer += dt;
        if (this._bgPowerUpTimer >= 0.5) {
            this._bgPowerUpTimer = 0;
            if (this.game.powerUps.length > 0) {
                const puData = this.game.powerUps.map(pu => ({ x: pu.pos.x, z: pu.pos.z, type: pu.type.id }));
                this.network.broadcast({ type: 'powerUpState', powerUps: puData });
            } else {
                this.network.broadcast({ type: 'powerUpState', powerUps: [] });
            }
        }
    }
    _renderMenuBg() {
        const t = performance.now() / 1000;
        const dist = 50;
        const y = 18 + Math.sin(t * 0.3) * 4;
        const x = Math.cos(t * 0.2) * dist;
        const z = Math.sin(t * 0.2) * dist;
        this.camera.position.set(x, y, z);
        this.camera.lookAt(0, 4, 0);
        this.renderer.render(this.camera);
    }

    loop() {
        requestAnimationFrame(() => this.loop());
        const dt = Math.min(this.clock.getDelta(), 0.05);

        this._diagnosticsTimer = (this._diagnosticsTimer || 0) - dt;
        if (this._diagnosticsTimer <= 0) {
            this._diagnosticsTimer = 0.5;
            const value = document.getElementById('network-diagnostics-value');
            if (value) {
                const diag = this.network?.getDiagnostics?.();
                const fps = Math.round(1 / Math.max(dt, 0.001));
                value.textContent = diag?.peers ? `${fps} FPS | ${Math.round(diag.ping || 0)}ms | ${diag.peers}P` : `${fps} FPS | LOCAL`;
            }
        }

        // Tab hidden → RAF'ı boşver, bgInterval işi görür
        if (this._tabHidden) return;

        // Re-apply crosshair whenever game state changes (shows it on entering PLAYING)
        if (this.game.state !== this._prevCrosshairState) {
            this.applyCrosshair?.();
            this._prevCrosshairState = this.game.state;
        }

        // ponytail: pointer lock only when actively playing (no menus, no chat, no pause)
        const pauseOpen = !document.getElementById('pause-menu')?.classList.contains('hidden');
        const settingsOpen = !document.getElementById('unified-settings')?.classList.contains('hidden');
        const teamPopup = this.ui.isTeamPopupOpen?.();
        const socialChatFocused = document.activeElement?.id === 'social-lobby-chat-input';
        const canLock = (this.game.state === STATES.PLAYING
            || this.game.state === STATES.COUNTDOWN
            || this.game.state === STATES.ROUND_END
            || this.game.state === STATES.CELEBRATION
            || this.game.state === STATES.SOCIAL_HUB)
            && !Spectator.active
            && !pauseOpen && !settingsOpen && !this.chatOpen && !socialChatFocused && !teamPopup;
        if (canLock && !document.pointerLockElement) {
            if (!this._plRetry || performance.now() - this._plRetry > 500) {
                this._plRetry = performance.now();
                try { this.renderer.renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (_) {}
            }
        } else if (!canLock && document.pointerLockElement && document.exitPointerLock) {
            document.exitPointerLock();
        }

        // Hide friends sidebar during gameplay
        const sidebar = document.getElementById('friends-sidebar');
        if (sidebar) {
            const inGame = this.game.state === STATES.LOBBY || this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN || this.game.state === STATES.CELEBRATION || this.game.state === STATES.ROUND_END || this.game.state === STATES.GAME_OVER || this.game.state === STATES.SOCIAL_HUB;
            sidebar.classList.toggle('hidden', inGame);
        }

        // Spectator mode overrides player input
        if (Spectator.active) {
            Spectator.update(dt);
        }

        // P2P: Hâlâ simülasyon akıyor olmasa (countdown/ROUND_END/celebration) bile
        // remote player sprite'ları lerp ile akıcı hareket etsin — rakip oyuncuyu sürekli gör.
        if (this.network?.connected) {
            this.game.invokeRemoteSnapshots(dt);
            this.game.invokeBallSmoothing?.(dt);
            if (this.network.isHost) this.game.ball.renderInterpolated?.((this._bgAccumulator || 0) * 60);
        }

        if (this.game.state === STATES.PLAYING || this.game.state === STATES.ROUND_END || this.game.state === STATES.COUNTDOWN || this.game.state === STATES.CELEBRATION) {
            if (!Spectator.active && !teamPopup) this.player.update(dt);
            if (!Spectator.active && !teamPopup) this._updateMovementPolish(false);
            if (!Spectator.active && !teamPopup) this._updateMovementTrial(dt);
            // Host simulation runs in the 60Hz background loop; clients update here.
            if (!this.network?.isHost) this.game.update(dt);
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

        if (this.game.state === STATES.SOCIAL_HUB) {
            this.socialLobby.update(dt);
            this._updateMovementPolish(true);
            this._suppressMatchWorldDuringHub();
            this._socialPresenceTimer = (this._socialPresenceTimer || 0) - dt;
            if (this._socialPresenceTimer <= 0) {
                this._socialPresenceTimer = 0.1;
                const skinIds = ['character-a', 'character-f', 'character-k', 'character-r'];
                const charId = this.store.get('selectedChar') || 'rally';
                const skin = skinIds[Math.abs([...charId].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % skinIds.length];
                this.network.sendSocialPresence(this.player.position, this.player.euler.y, skin);
                const expiry = performance.now() - 5000;
                for (const [id, seenAt] of this._socialRemoteSeen) {
                    if (seenAt >= expiry) continue;
                    this.socialLobby.removeRemoteVisitor(id);
                    this._socialRemoteSeen.delete(id);
                }
                this._updateSocialPresence(this.socialLobby.getPresence());
            }
        }

        // Killcam camera — free camera orbit around death scene
        if (this.game._killcamActive) {
            this.game._killcamElapsed += dt;
            const t = this.game._killcamElapsed / this.game._killcamDuration;
            const deathPos = this.game._killcamDeathPos;
            const killerPos = this.game._killcamKillerPos;
            if (deathPos) {
                // Orbit: sin/cos around death pos, looking at it
                const angle = t * Math.PI * 2;
                const radius = 8 + Math.sin(t * Math.PI) * 3;
                const height = 3 + Math.sin(t * Math.PI) * 2;
                const cx = deathPos.x + Math.sin(angle) * radius;
                const cz = deathPos.z + Math.cos(angle) * radius;
                const cy = deathPos.y + height;
                this.camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.08);
                this.camera.lookAt(deathPos.x, deathPos.y + 1.5, deathPos.z);
            }
        } else {
            this.game._killcamElapsed = 0;
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

        // Replay kaydı — deflect olayları
        if (this.game.state === STATES.PLAYING && Replay.recording) {
            Replay.recordSnapshot({
                ball: this.game.ball.position,
                player: {
                    id: 'local',
                    name: this.game.playerName,
                    team: this.player.team,
                    alive: this.player.alive,
                    position: this.player.getPosition(),
                    yaw: this.player.euler.y,
                    pitch: this.player.euler.x
                },
                players: [
                    ...this.game.bots.map(bot => ({
                        id: bot.name, name: bot.name, team: bot.team, alive: bot.alive,
                        position: bot.position, yaw: bot.rotation?.y || 0
                    })),
                    ...[...this.game.remotePlayers.values()].map(player => ({
                        id: player.name, name: player.name, team: player.team, alive: player.alive,
                        position: player.position, yaw: player.rotation?.y || 0
                    }))
                ],
                camera: {
                    position: this.camera.position,
                    yaw: this.player.euler.y,
                    pitch: this.player.euler.x
                }
            });
            if (this.game.rallyCount !== this._lastRally) {
                Replay.record({ type: 'deflect', data: { rally: this.game.rallyCount } });
                this._lastRally = this.game.rallyCount;
            }
        }

        // P2P: adaptive rate position send (CS2-like — rate scales with player speed)
        this._p2pTimer = (this._p2pTimer || 0) - dt;
        if (this._p2pTimer <= 0 && this.network?.connected) {
            // Adaptive rate: faster when moving more, slower when idle
            const playerSpeed = this.player?._frameVel?.length?.() ?? 0;
            let desiredMs = 100; // 10Hz — idle/standing
            if (playerSpeed > 8) desiredMs = 16;  // 60Hz — sprint/dash
            else if (playerSpeed > 3) desiredMs = 33;  // 30Hz — running
            else if (playerSpeed > 0.5) desiredMs = 50; // 20Hz — walking
            // Attack burst: 60Hz after hitting the ball for precise deflection tracking
            if ((this._p2pAttackBurst || 0) > 0) {
                desiredMs = Math.min(desiredMs, 16);
                this._p2pAttackBurst--;
            }
            this._p2pTimer = desiredMs / 1000;
            if (this.game.state === STATES.PLAYING
                || this.game.state === STATES.COUNTDOWN
                || this.game.state === STATES.CELEBRATION
                || this.game.state === STATES.LOBBY
            ) {
                const p = this.player;
                if (p.queuedForNextRound) {
                    this._p2pTimer = 0.1;
                } else {
                const lastKey = this.game.playerName || 'me';
                const lastPos = this._lastSentPos?.get?.(lastKey);
                let shouldSend = true;
                if (lastPos) {
                    const dist = p.position.distanceTo(lastPos.pos);
                    const yawDelta = Math.abs(p.euler.y - lastPos.ry);
                    // Force send every 30 packets (~1s) even when still
                    this._p2pKeepalive = (this._p2pKeepalive || 0) + 1;
                    if (dist < 0.06 && yawDelta < 0.03 && this._p2pKeepalive < 10) {
                        shouldSend = false;
                    }
                }
                if (shouldSend) {
                    this._p2pKeepalive = 0;
                    if (!this._lastSentPos) this._lastSentPos = new Map();
                    this._lastSentPos.set(lastKey, { pos: p.position.clone(), ry: p.euler.y });
                    // ponytail: delta-compress — only send static/rarely-changed fields when they change
                    if (!this._p2pLastFull) this._p2pLastFull = new Map();
                    const prev = this._p2pLastFull.get(lastKey) || {};
                    const extra = {
                        ax: p.getAimDirection().x, ay: p.getAimDirection().y, az: p.getAimDirection().z,
                        vx: p._frameVel?.x || 0, vy: p._frameVel?.y || 0, vz: p._frameVel?.z || 0,
                        clientTime: performance.now()
                    };
                    if (prev.name !== this.game.playerName) { extra.name = this.game.playerName; prev.name = this.game.playerName; }
                    if (prev.team !== p.team) { extra.team = p.team; prev.team = p.team; }
                    if (prev.charId !== p.charId) { extra.charId = p.charId; prev.charId = p.charId; }
                    if (prev.knifeId !== p.knifeId) { extra.knifeId = p.knifeId; prev.knifeId = p.knifeId; }
                    if (prev.alive !== p.alive) { extra.alive = p.alive; prev.alive = p.alive; }
                    if (prev.hp !== p.hp) { extra.hp = p.hp; prev.hp = p.hp; }
                    this._p2pLastFull.set(lastKey, prev);
                    this.network.sendPosition(p.position, p.euler.y, extra);
                }
                }
            }
        }
        // Attack intent: tıklayınca host'a aim + pozisyon yolla (sadece bağlıyken)
        if (this.player._p2pAttackQueued) {
            this.player._p2pAttackQueued = false;
        }

        // Host: authoritative state broadcast
        if (this.network?.isHost && this.game.state === STATES.PLAYING) {
            // BallState: selective — skip if ball follows predicted path, send if deviation > threshold
            // Reduces packet count ~50% on straight shots, client extrapolates between updates.
            if (this.game.ball.active || this.game.ball.state !== 'idle') {
                this._hostBallTimer = (this._hostBallTimer || 0) - dt;
                if (this._hostBallTimer <= 0) {
                    this._hostBallTimer = 1 / 60;
                    const ball = this.game.ball;
                    let shouldSend = true;
                    if (this._lastSentBall) {
                        const elapsed = (performance.now() - this._lastSentBall.time) / 1000;
                        const px = this._lastSentBall.x + this._lastSentBall.vx * elapsed;
                        const py = this._lastSentBall.y + this._lastSentBall.vy * elapsed;
                        const pz = this._lastSentBall.z + this._lastSentBall.vz * elapsed;
                        const dx = ball.position.x - px;
                        const dy = ball.position.y - py;
                        const dz = ball.position.z - pz;
                        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                        this._ballSendSkipCount = (this._ballSendSkipCount || 0) + 1;
                        if (dist < 0.1 && this._ballSendSkipCount < 1) shouldSend = false;
                        else this._ballSendSkipCount = 0;
                    }
                    if (shouldSend) {
                        this._ballSeq = (this._ballSeq || 0) + 1;
                        this._lastSentBall = {
                            x: ball.position.x, y: ball.position.y, z: ball.position.z,
                            vx: ball.velocity.x, vy: ball.velocity.y, vz: ball.velocity.z,
                            time: performance.now()
                        };
                        this.network.broadcast({
                            type: 'ballState',
                            seq: this._ballSeq,
                            x: ball.position.x, y: ball.position.y, z: ball.position.z,
                            vx: ball.velocity.x, vy: ball.velocity.y, vz: ball.velocity.z,
                            speed: ball.currentSpeed, active: ball.active,
                            state: ball.state,
                            targetId: ball.targetPlayer?.peerId || null,
                            targetName: ball.targetPlayer?.name || null
                        });
                    }
                }
            }
            // Score: 2Hz
            this._hostScoreTimer = (this._hostScoreTimer || 0) - dt;
            if (this._hostScoreTimer <= 0) {
                this._hostScoreTimer = 0.5;
                this.network.broadcast({
                    type: 'scoreUpdate',
                    red: this.game.scoreboard.redScore, blue: this.game.scoreboard.blueScore,
                    time: this.game.scoreboard.timeRemaining, round: this.game.scoreboard.roundNum,
                    players: this.game.scoreboard.getPlayerStats(),
                    killFeed: this.game.killFeed.slice(0, 5).map(k => ({
                        attacker: k.attacker, victim: k.victim, dmg: k.dmg, tag: k.tag
                    }))
                });
            }
            // BotSync: 10Hz
            if (this.game.bots.length > 0) {
                this._hostBotTimer = (this._hostBotTimer || 0) - dt;
                if (this._hostBotTimer <= 0) {
                    this._hostBotTimer = 0.1;
                    const botData = this.game.bots.map(b => ({
                        name: b.name, team: b.team,
                        x: b.position.x, y: b.position.y, z: b.position.z,
                        ry: b.rotation?.y || 0,
                        alive: b.alive, hp: b.hp, charId: b.charId
                    }));
                    this.network.broadcast({ type: 'botSync', bots: botData });
                }
            }
            // PowerUps: 2Hz
            this._hostPuTimer = (this._hostPuTimer || 0) - dt;
            if (this._hostPuTimer <= 0) {
                this._hostPuTimer = 0.5;
                if (this.game.powerUps.length > 0) {
                    const puData = this.game.powerUps.map(pu => ({ x: pu.pos.x, z: pu.pos.z, type: pu.type.id }));
                    this.network.broadcast({ type: 'powerUpState', powerUps: puData });
                }
            }
        }

        // P2P: 2 saniyede bir ping göndererek RTT ölç
        this._pingTimer = (this._pingTimer || 0) - dt;
        if (this._pingTimer <= 0 && this.network?.connected) {
            this._pingTimer = 2.0;
            this.network.sendPing();
            const pingEl = document.getElementById('scoreboard-ping-value');
            if (pingEl) {
                const p = this.network.getPing();
                pingEl.textContent = p > 0 ? `${Math.round(p)} ms` : 'measuring…';
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
            if (!Spectator.active && !this.player.alive && this.game._spectateTarget && this.game._spectateTarget.alive) {
                const t = this.game._spectateTarget;
                const tpos = t.getPosition();
                const tdir = t.getAimDirection?.() || new THREE.Vector3(0, 0, -1);
                const eye = tpos.clone().add(new THREE.Vector3(0, t.eyeHeight || 1.55, 0));
                const alpha = 1 - Math.exp(-18 * dt);
                this.camera.position.lerp(eye, alpha);
                const look = eye.clone().add(tdir);
                this.camera.lookAt(look.x, look.y, look.z);
                const info = document.getElementById('spectator-info');
                if (info) {
                    info.textContent = `TEAM POV  ${t.name || 'TEAMMATE'}  [ / ] switch`;
                    info.classList.remove('hidden');
                }
            }
            this.renderer.render(this.camera);
        }
    }
}

// Menu particle background — canvas-based floating dots
function initMenuParticles() {
    const c = document.getElementById('menu-particles');
    if (!c) return;
    const ctx = c.getContext('2d');
    let w, h, particles = [], running = true;
    function resize() { w = c.width = window.innerWidth; h = c.height = window.innerHeight; }
    window.addEventListener('resize', resize);
    resize();
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
            r: 1 + Math.random() * 2, a: 0.2 + Math.random() * 0.5
        });
    }
    function draw() {
        if (!running) return;
        ctx.clearRect(0, 0, w, h);
        for (const p of particles) {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,180,100,${p.a})`;
            ctx.fill();
        }
        requestAnimationFrame(draw);
    }
    draw();
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    new App();
    // Hide loading screen after everything initializes
    const ls = document.getElementById('loading-screen');
    if (ls) setTimeout(() => ls.classList.add('done'), 300);
    // Menu particle background
    initMenuParticles();
});
