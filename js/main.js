// main.js — App bootstrap, scene setup, game loop, screen handlers, loadout.
import * as THREE from 'three';
import {
    RematchVote,
    connectedRematchParticipants,
    createMatchId,
    isSafeMatchId,
    isTerminalRematchState,
    snapshotRematchParticipants
} from './rematch.js';
import { Renderer } from './renderer.js';
import { Player, isEditableTarget } from './player.js';
import { Arena, getLobbyPreviewCommands, registerCustomMap } from './arena.js';
import { Game, STATES } from './game.js';
import { GAME_MODES } from './gamemodes.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Network } from './network.js';
import { VoiceChat } from './voice.js';
import { Store } from './store.js';
import { DEFAULT_LOADOUT } from './skills.js';
import { ARENA_CARDS, CARD_RARITIES } from './cards.js';
import { AvatarPainter, AVATAR_SKINS, resolveAvatarAtlas } from './avatar.js';
import { ProductAnalytics, joinLatencyBucket, matchStartTimingMetrics } from './product-analytics.js';
import { SKIN_PRESETS, SKIN_PRESET_IDS, renderSkinPreset } from './skin-presets.js';
import { createShowcaseAvatar, ShopShowcaseRenderer } from './shop-showcase.js';
import { createMenuStage } from './menu-stage.js';
import { deriveFeaturedStrip } from './menu-featured.js';
import { COSMETIC_PRACTICE_MAP_ID, CosmeticPracticeSession } from './cosmetic-practice.js';
import { CASES, KNIVES, getCaseDropRates } from './cosmetics.js';
import { createKnifeModel, disposeObject3D } from './weapon-models.js';
import { applyEntityCosmetics, updateEntityCosmetics } from './cosmetic-models.js';
import { COSMETICS } from './cosmetic-catalog.js';
import { MapEditorController } from './map-editor.js';
import { normalizeMapConfig, validateMapConfig } from './map-config.js';
import { checkAchievements } from './achievements.js';
import { Daily } from './daily.js';
import { getReward as getBattlepassRewardEntry } from './battlepass.js';
import { Replay, extractReplayHighlight } from './replay.js';
import { ReplayView } from './replay-view.js';
import { CAMERA_MODES, Spectator } from './spectator.js';
import { BALL_SKINS, ballShapeParts } from './ball.js';
import { accountRankLabel, MATCH_XP, matchXp, prestigeTitle } from './prestige.js';
import { Console } from './console.js';
import { tournament } from './tournament.js';
import { Friends } from './friends.js';
import { MatchHistory } from './matchhistory.js';
import { getRank } from './ranked.js';
import { CHARACTERS } from './characters.js';
import { appendClanMessage, createClan, listClans } from './social.js';
import { account } from './account.js';
import { SOCIAL_HUB_MAPS, SOCIAL_HUB_MAP_ID, SocialLobby, getSocialLobbyMapState } from './social-lobby.js';
import { applyUiPreferences, loadUiPreferences, normalizeTheme, normalizeUiScale } from './ui-theme.js';
import { initSettingsTabs, initThemeSwatches, initSettingsExtras, shouldRenderFrame } from './settings-controller.js';
import { formatMapSize } from './map-display.js';
import {
    createDraftState,
    rankQueueCandidates,
    updateDraftPick
} from './competitive-service.js';
import { filterLobbies, pickQuickLobby, formatLobbyAge, lobbyCapacity } from './lobby-browser.js';
import {
    createParty,
    createSocialProfile,
    rememberPlayer,
    reportPlayer,
    setMuted,
    setPartyReady
} from './social-service.js';
import { normalizeNetcode } from './experimental-netcode.js';
import { RuntimeLog } from './runtime-safety.js';
import { AfkMonitor, RollingNetworkMonitor, ModerationReportQueue } from './release-safety.js';
import {
    migrateCosmeticLoadout,
    normalizeCosmeticLoadout
} from './cosmetic-customization.js';
import { MOVEMENT_TRIALS, MovementTrialClass } from './movement-trials.js';
import {
    exportCrosshairCode,
    importCrosshairCode,
    normalizeCrosshairConfig,
    renderCrosshair
} from './crosshair.js';

const SOCIAL_DISCOVERY_KEY = 'warrball.social.discovery.v1';
const PARTY_FOLLOW_SCREENS = new Set(['mainMenu', 'multiplayerMenu', 'joinMenu']);
const PARTY_INVITE_BLOCKED_STATES = new Set([STATES.PLAYING, STATES.COUNTDOWN, STATES.ROUND_END, STATES.CELEBRATION]);

const SPECTATOR_MODE_LABELS = Object.freeze({
    [CAMERA_MODES.FIRST_PERSON]: 'PLAYER CAM',
    [CAMERA_MODES.CHASE]: 'CHASE CAM',
    [CAMERA_MODES.FREE_ROAM]: 'FREE CAM'
});

function renderSpectatorHUD(name, state = {}) {
    const surface = document.getElementById('spectator-info');
    if (!surface) return;
    const active = state.active !== false;
    surface.classList.toggle('hidden', !active);
    if (!active) return;
    const mode = state.mode || CAMERA_MODES.CHASE;
    const targetName = document.getElementById('spectator-target-name');
    const modeLabel = document.getElementById('spectator-mode-label');
    if (targetName && targetName.textContent !== name) targetName.textContent = name || 'Player';
    if (modeLabel) modeLabel.textContent = SPECTATOR_MODE_LABELS[mode] || 'CHASE CAM';
    surface.dataset.context = state.context || 'spectator';
    surface.querySelectorAll('[data-spectator-mode]').forEach(button => {
        const selected = button.dataset.spectatorMode === mode;
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = state.controls === false;
    });
    surface.querySelectorAll('#spectator-prev-target, #spectator-next-target').forEach(button => {
        button.disabled = state.controls === false;
    });
}

function presenceStateFor(screen, gameState) {
    if (PARTY_INVITE_BLOCKED_STATES.has(gameState)) return 'match';
    if (['lobby', 'multiplayerMenu', 'joinMenu'].includes(screen)) return 'lobby';
    if (['socialCenter', 'socialLobby'].includes(screen)) return 'social';
    return 'menu';
}

// Only catalog effect ids map to these existing sprite symbols. Keep the slot
// fallback below so a future catalog entry remains readable before it gets art.
const CARD_EFFECT_ICON_IDS = Object.freeze({
    slow: '#i-ball',
    heal: '#i-refresh',
    freeze: '#i-target',
    burn: '#i-trophy',
    shield: '#i-access',
    teleport: '#i-play',
    blackhole: '#i-ball',
    smash: '#i-trophy',
    deflect_power: '#i-target',
    hp_bonus: '#i-access',
    speed_bonus: '#i-play',
    stam_regen: '#i-refresh',
    cooldown_red: '#i-chart',
    lifesteal: '#i-ball',
    dmg_resist: '#i-access',
    thorns: '#i-trophy'
});

const HOST_CHECKPOINT_INTERVAL_MS = 750;
const HOST_CHECKPOINT_SIGNATURE_MAX_CHARS = 64 * 1024;

class App {
    constructor() {
        // Lifetime owner for every App-level DOM/window listener. This must exist
        // before any subsystem initializer (including initFriendsSidebar) binds
        // with its signal; a later assignment would both crash startup and orphan
        // listeners attached to the previous controller.
        this._mainAbort = new AbortController();
        this._partyQueueState = null;
        this._partyLobbyTarget = null;
        this._partyFollowAttemptedTarget = '';
        this._partyFollowInFlight = false;
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
        this.productAnalytics = new ProductAnalytics(this.store);
        this.productAnalytics.start();
        window.addEventListener('warrball:screen', event => {
            const screen = event.detail?.screen;
            if (['mainMenu', 'shop', 'battlepass', 'multiplayerMenu', 'joinMenu', 'lobby', 'practiceMenu'].includes(screen)) {
                this.productAnalytics.track('screen_view', { screen });
            }
        });
        RuntimeLog.install(window);
        this.afkMonitor = new AfkMonitor();
        this.networkHealth = new RollingNetworkMonitor();
        this.reportQueue = new ModerationReportQueue();
        this.socialProfile = createSocialProfile(this.store.get('socialProfile'));
        this.party = this.socialProfile.party || createParty(this.store.get('playerName') || 'Player');
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
        const netcodeToggle = document.getElementById('setting-experimental-netcode');
        if (netcodeToggle) netcodeToggle.checked = this.store.get('experimentalNetcode')?.enabled === true;
        const voiceToggle = document.getElementById('setting-voice-chat');
        if (voiceToggle) voiceToggle.checked = this.store.get('voiceChatEnabled') !== false;
        const voiceMuteToggle = document.getElementById('setting-voice-mute');
        if (voiceMuteToggle) voiceMuteToggle.checked = this.store.get('voiceMuted') === true;
        this.avatarPainter = null;
        this.avatarStage3D = null;
        this._avatarPreviewMode = '2d';
        this.shopShowcase = null;
        this.cosmeticPractice = new CosmeticPracticeSession({
            currency: this.store.get('currency'),
            ownedSkinIds: this.store.get('ownedAvatarSkins'),
            equippedSkinId: this.store.get('equippedAvatarSkin')
        });
        this._cosmeticPracticeAvatar = null;
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
        this.ui.audio = this.audio;
        this._setupAuthModal();
        this.ui.onCaseRewardReveal = reward => {
            if (reward?.type === 'knife') this._renderCosmeticPreview(document.getElementById('case-reward-preview'), reward);
        };
        this.network = new Network(null);
        this.game = new Game(this.renderer, this.player, this.arena, this.audio, this.ui, this.network);
        this.voice = new VoiceChat(this.network);
        this.rematchVote = new RematchVote();
        this._completedMatchPlayerIds = new Set();
        this.game.experimentalNetcode = normalizeNetcode(this.store.get('experimentalNetcode'));
        this.network.game = this.game;
        this.movementTrials = new MovementTrialClass();
        this.game.onReplayEvent = event => Replay.record(event);
        this.game.onRocketJump = event => {
            this.movementTrials.addRocketJump();
            this.store.progressSeasonContracts({ rocketJumps: 1 });
            Replay.record({ type: 'rocketJump', data: { strength: event?.strength || 0 } });
        };
        this.game.onMatchLoading = data => {
            const startedAt = performance.now();
            this._matchLaunchTiming = { requestedAt: startedAt, setupStartedAt: startedAt };
            return this._showMatchLoading(900, data);
        };
        this.game.onLateJoinActivated = team => this._exitLateJoinSpectator(team);
        this.game.onMatchEnded = () => {
            if (!Number.isFinite(this._analyticsGameplayEndedAt)) this._analyticsGameplayEndedAt = Date.now();
        };
        this.game.onMatchComplete = () => {
            const postgameReadyAt = Date.now();
            const gameplayEndedAt = Number.isFinite(this._analyticsGameplayEndedAt)
                ? this._analyticsGameplayEndedAt
                : postgameReadyAt;
            this._analyticsPostgameReadyAt = postgameReadyAt;
            const connectedIds = [...this.network.playerConnections.keys()];
            const queuedIds = connectedIds.filter(playerId =>
                this.game.remotePlayers.get(playerId)?.queuedForNextRound
            );
            this._completedMatchPlayerIds = new Set(snapshotRematchParticipants(
                this.network.playerId,
                connectedIds,
                queuedIds
            ));
            this.awardMatchRewards();
            this.productAnalytics.track('match_complete', {
                mode: this.game.mode?.id || 'classic',
                networkRole: this.network.isHost ? 'host' : this.network.connected ? 'client' : 'solo',
                ...(typeof this.game.matchId === 'string' && this.game.matchId.length <= 40 ? { matchId: this.game.matchId } : {})
            }, {
                matchDurationSec: this._analyticsMatchStartedAt ? Math.max(0, (gameplayEndedAt - this._analyticsMatchStartedAt) / 1000) : 0,
                postgameDelaySec: Math.max(0, (postgameReadyAt - gameplayEndedAt) / 1000)
            });
            this.refreshMetaStats();
            this.ui.updateContractTracker(Daily, this.store);
        };
        this.game.onRoundEnd = () => this._queueRoundReplay();
        this.game.onMatchStart = () => {
            clearTimeout(this._deferredRewardRetryTimer);
            this._deferredRewardRetryTimer = null;
            this.ui.clearPostGameMatchDrops?.();
            this._analyticsMatchStartedAt = Date.now();
            this._analyticsGameplayEndedAt = null;
            this._analyticsPostgameReadyAt = null;
            this._activeMatchMode = !this.network.connected ? 'solo' : (this._rankedMatch
                ? 'ranked'
                : (this._analyticsMatchEntry === 'rematch' && this._lastMatchAuthorityMode === 'ranked' ? 'ranked' : 'casual'));
            this._lastMatchAuthorityMode = this._activeMatchMode;
            this._matchAuthorityReady = this.store.remoteReady && !this.game._practiceMode
                ? this.store.beginMatchRemote({ matchId: this.game.matchId, mode: this._activeMatchMode, lobbyCode: this._lobbyCode || '' })
                : Promise.resolve(false);
            const networkRole = this.network.isHost ? 'host' : this.network.connected ? 'client' : 'solo';
            this._pendingMatchStartAnalytics = {
                mode: this.game.mode?.id || 'classic',
                entry: this._analyticsMatchEntry || 'lobby',
                networkRole,
                ...(typeof this.game.matchId === 'string' && this.game.matchId.length <= 40 ? { matchId: this.game.matchId } : {})
            };
            this.productAnalytics.track('cosmetic_match_use', {
                itemType: 'avatar',
                itemId: this.store.get('equippedAvatarSkin') || 'default',
                networkRole
            });
            this._analyticsMatchEntry = null;
            clearTimeout(this._rematchTimer);
            this._rematchTimer = null;
            this._rematchStarting = false;
            this.rematchVote.reset();
            this._updateRematchUI?.();
            if (Spectator.active) Spectator.exit('match-start');
            this.ui.spectating = false;
            this.ui.hideTeamPopup();
        };
        this.game.onCountdownReady = () => {
            const match = this._pendingMatchStartAnalytics;
            const matchId = match?.matchId || this.game.matchId;
            if (!match || this._analyticsMatchStartTrackedId === matchId) return;
            this._analyticsMatchStartTrackedId = matchId;
            this.productAnalytics.track('match_start', match, matchStartTimingMetrics(this._matchLaunchTiming, performance.now()));
            this._matchLaunchTiming = null;
            this._pendingMatchStartAnalytics = null;
        };
        this.game.onDeflectResult = result => this._showDeflectResult(result);
        this.game.onPracticeMetrics = summary => this._updatePracticeLab(summary);
        this.game.onGuidedDrillUpdate = snapshot => this._updateGuidedDrillHUD(snapshot);
        this.game.onGuidedDrillComplete = result => {
            const firstRun = this._ftueGuidedRun === true;
            const resultState = result.allPassed === true ? 'passed' : 'finished';
            this.productAnalytics.track('practice_complete', { practiceType: 'guided_deflect', result: resultState });
            if (this._ftueGuidedRun === true && this.store.get('ftueCompleted') !== true) {
                this.store.set('ftueCompleted', true);
                void this.store.syncOnboarding({ ftueCompleted: true });
                this.productAnalytics.track('ftue_complete', { source: 'guided_deflect', result: resultState });
            }
            this._showGuidedDrillResult(result, { firstRun });
            this._ftueGuidedRun = false;
        };
        this.player.game = this.game;
        this.player.audio = this.audio;
        this.socialLobby = new SocialLobby(this.renderer, this.player, {
            onPresence: presence => this._updateSocialPresence(presence),
            onAssetProgress: state => {
                const fill = document.querySelector('#loading-screen .loading-bar-fill');
                const status = document.querySelector('#loading-screen .loading-status');
                if (fill) fill.style.width = `${Math.round(state.progress * 100)}%`;
                if (status) status.textContent = `Loading social assets ${state.loaded}/${state.total}`;
            },
            onPoseArea: inside => {
                if (inside) this.ui.showMessage?.('Pose area - open Community for photo mode.', 1800);
            }
        });
        this._socialRemoteSeen = new Map();
        this.network.onSocialPresence = data => this._receiveSocialPresence(data);
        this.network.onSocialChat = data => this._receiveSocialChat(data);
        this.network.onPartyReady = data => {
            this.party = setPartyReady(this.party, data.name, data.ready);
            this._saveSocialProfile();
            this._renderSocialCenter();
        };

        Spectator.onTargetChange = (name, state) => renderSpectatorHUD(name, state);

        this.initFriendsSidebar();

        // Loadout uygula
        this.applyLoadout();
        // Default mode = instagib ("one shot"). Must run AFTER applyLoadout(): that
        // call resets player.maxHp from character base stats (player.js), which would
        // silently clobber a maxHp mutator applied any earlier (e.g. in Game's own
        // constructor). selectMode() is the same call the lobby's mode-chip click
        // handler makes, so this stays perfectly consistent with manual mode picks.
        this.game.selectMode('instagib');

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
        this._hostCheckpointInterval = null;
        this._hostCheckpointGeneration = 0;
        this._lastHostCheckpointSignature = null;
        this._lastHostCheckpointEpoch = null;
        this._lastHostCheckpointSequence = null;
        // ponytail: the constructor-owned AbortController prevents listener accumulation on game restart
        document.addEventListener('visibilitychange', () => this._onVisibilityChange(), { signal: this._mainAbort.signal });
        ['pointerdown', 'keydown', 'mousemove'].forEach(type => {
            document.addEventListener(type, () => this.afkMonitor.recordActivity(), {
                passive: true,
                signal: this._mainAbort.signal
            });
        });

        // Canvas remains viewport-sized; resolution changes only the internal render buffer.
        window.addEventListener('resize', () => {
            this.renderer.updateSize(window.innerWidth, window.innerHeight);
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }, { signal: this._mainAbort.signal });

        // Spectate click — left=next, right=prev (no context menu)
        document.addEventListener('mousedown', e => {
            if (Spectator.active) {
                Spectator.handlePointerButton(e);
                return;
            }
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
        document.addEventListener('mousemove', e => {
            if (this.player.alive || !this.game._spectateTarget || e.movementX == null) return;
            const view = this._deadSpectateView ||= { distance: 0.5, yaw: null, pitch: 0 };
            const targetYaw = this.game._spectateTarget.euler?.y ?? this.game._spectateTarget.rotation?.y ?? 0;
            view.yaw = Number.isFinite(view.yaw) ? view.yaw - e.movementX * 0.0025 : targetYaw;
            view.pitch = Math.max(-1.15, Math.min(1.15, view.pitch - e.movementY * 0.0025));
        }, { signal: this._mainAbort.signal });
        // Block the browser right-click menu everywhere (menu, lobby, settings, in-game).
        // Right-click is still usable as a game input via mousedown button===2.
        document.addEventListener('contextmenu', e => e.preventDefault(), { signal: this._mainAbort.signal });

        // Tab key → scoreboard
        document.addEventListener('keydown', e => {
            if (e.code === 'Backquote') this.ui.hideScoreboard();

            // Console visible → skip all other handlers
            if (this.gameConsole?.visible) return;

            if (this.cosmeticPractice?.active && e.code === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this._exitCosmeticPractice();
                return;
            }

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
                this.ui.updateScoreboard(this.game.scoreboard.getPlayerStats(), this.game._ffa);
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
                if (e.code === 'BracketRight') { Spectator.cycleTarget(); return; }
                if (e.code === 'BracketLeft') { Spectator.prevTarget(); return; }
                if (e.code === 'KeyF') { Spectator.setFreeCam(!Spectator.freeCam); return; }
                if (e.code === 'KeyM' && !Replay.playing) { e.preventDefault(); this.toggleTeamPopup(); return; }
                // ESC falls through to the normal pause/settings flow.
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
                    if (this.store.equipBall(next)) {
                        this.game.ball.setSkin(next);
                        this.ui.updateBallSkin?.(next);
                        this.ui.showMessage?.(`🎾 Ball: ${BALL_SKINS[next].name}`, 1500);
                    }
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
            if (e.code === 'KeyV' && this.voice && !isEditableTarget(e.target)) {
                e.preventDefault();
                void this._startVoicePtt();
            }
            if (e.code === 'Escape') {
                if (this.gameConsole?.visible) return;
                const ftueEl = document.getElementById('ftue-welcome');
                if (ftueEl && !ftueEl.classList.contains('hidden')) {
                    e.preventDefault();
                    this.hideFtueWelcome({ reason: 'escape', trackExit: true });
                    return;
                }
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
                const earnEl = document.getElementById('earn-overlay');
                if (earnEl && !earnEl.classList.contains('hidden')) { this.ui.hideEarnOverlay(); return; }
                const inspectorEl = document.getElementById('case-inspector');
                if (inspectorEl && !inspectorEl.classList.contains('hidden')) {
                    inspectorEl.classList.add('hidden');
                    this.ui._closeExclusive('caseInspector');
                    return;
                }
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
        this._initShopShowcase();
        this._initMenuHero();
        this._initMenuStage();
        this.applyAccessibility();
        this.refreshMetaStats();
        this._authenticated = false;
        this.ui.hideAll();
        this._beginAuthenticatedBoot();

        // In-game console (~)
        this.gameConsole = new Console();
        this.gameConsole.init(this.game);
        this.game.console = this.gameConsole; // game loop can check visibility

        this.loop();
    }

    async _beginAuthenticatedBoot() {
        this._showAuthGate('Checking your saved session…');
        const restored = await account.restore();
        if (!restored.ok) {
            const retry = account.isLoggedIn() || /network|unable|retry/i.test(restored.error || '');
            this._showAuthGate(restored.error || 'Sign in to continue.', { retry });
            return;
        }
        await this._completeAuthentication();
    }

    _showAuthGate(status, { retry = false } = {}) {
        this._authenticated = false;
        this.ui?.hideAll();
        const modal = document.getElementById('auth-modal');
        const statusEl = document.getElementById('auth-status');
        if (statusEl) statusEl.textContent = status;
        modal?.classList.remove('hidden');
        document.getElementById('auth-retry')?.classList.toggle('hidden', !retry);
        if (!account.isLoggedIn()) document.getElementById('auth-login-username')?.focus();
    }

    async _completeAuthentication() {
        const profileName = account.getUsername();
        if (!profileName) return this._showAuthGate('Sign in to continue.');
        this.store.set('playerName', profileName);
        this.game.playerName = profileName;
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) { nameInput.value = profileName; nameInput.readOnly = true; }
        const statusEl = document.getElementById('auth-status');
        if (statusEl) statusEl.textContent = 'Syncing your profile…';
        const connected = await this.store.connectRemote(profileName);
        if (!connected) return this._showAuthGate('Your account is valid, but profile sync failed. Retry connection.', { retry: true });
        this._authenticated = true;
        document.getElementById('auth-modal')?.classList.add('hidden');
        this.store.set('onboardingSeen', true);
        void this.productAnalytics.flush();
        this.applyLoadout();
        this.game.selectMode(this.game.mode.id);
        this.refreshMetaStats();
        this.ui.showScreen('mainMenu');
        this._setupPresenceHeartbeat();
        this._startSocialPolling();
    }

    _setupAuthModal() {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        
        // Tab switching
        document.querySelectorAll('.auth-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.getAttribute('data-tab');
                document.querySelectorAll('.auth-tab-btn').forEach(b => {
                    b.classList.remove('auth-tab-active');
                    b.setAttribute('aria-selected', 'false');
                });
                document.querySelectorAll('.auth-tab-content').forEach(c => c.classList.add('hidden'));
                e.target.classList.add('auth-tab-active');
                e.target.setAttribute('aria-selected', 'true');
                document.getElementById(`auth-${tab}-tab`)?.classList.remove('hidden');
                document.getElementById(`auth-${tab}-username`)?.focus();
            });
        });
        
        // Tab link switching
        document.querySelectorAll('[data-switch-tab]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = e.target.getAttribute('data-switch-tab');
                document.querySelector(`[data-tab="${tab}"]`).click();
            });
        });
        
        // Login form
        document.getElementById('auth-login-submit')?.addEventListener('click', () => this._handleLogin());
        document.getElementById('auth-login-username')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._handleLogin();
        });
        document.getElementById('auth-login-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._handleLogin();
        });
        
        // Register form
        document.getElementById('auth-register-submit')?.addEventListener('click', () => this._handleRegister());
        document.getElementById('auth-register-username')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._handleRegister();
        });
        document.getElementById('auth-register-email')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._handleRegister();
        });
        document.getElementById('auth-register-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this._handleRegister();
        });
        
        document.getElementById('auth-retry')?.addEventListener('click', () => this._beginAuthenticatedBoot());
    }

    async _handleLogin() {
        if (this._authBusy) return;
        const username = document.getElementById('auth-login-username')?.value || '';
        const password = document.getElementById('auth-login-password')?.value || '';
        const errorDiv = document.getElementById('auth-login-error');
        
        if (!username || !password) {
            if (errorDiv) {
                errorDiv.textContent = 'Username and password required';
                errorDiv.classList.remove('hidden');
            }
            return;
        }
        
        this._authBusy = true;
        const submit = document.getElementById('auth-login-submit');
        if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); }
        let result;
        try { result = await account.login(username, password); }
        finally {
            this._authBusy = false;
            if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
        }
        if (result.error) {
            if (errorDiv) {
                errorDiv.textContent = result.error;
                errorDiv.classList.remove('hidden');
            }
        } else {
            if (errorDiv) errorDiv.classList.add('hidden');
            document.getElementById('auth-login-username').value = '';
            document.getElementById('auth-login-password').value = '';
            await this._completeAuthentication();
        }
    }

    async _handleRegister() {
        if (this._authBusy) return;
        const username = document.getElementById('auth-register-username')?.value || '';
        const email = document.getElementById('auth-register-email')?.value || '';
        const password = document.getElementById('auth-register-password')?.value || '';
        const errorDiv = document.getElementById('auth-register-error');
        
        if (!username || !email || !password) {
            if (errorDiv) {
                errorDiv.textContent = 'Username, email and password required';
                errorDiv.classList.remove('hidden');
            }
            return;
        }
        
        this._authBusy = true;
        const submit = document.getElementById('auth-register-submit');
        if (submit) { submit.disabled = true; submit.setAttribute('aria-busy', 'true'); }
        let result;
        try { result = await account.register(username, password, email); }
        finally {
            this._authBusy = false;
            if (submit) { submit.disabled = false; submit.removeAttribute('aria-busy'); }
        }
        if (result.error) {
            if (errorDiv) {
                errorDiv.textContent = result.error;
                errorDiv.classList.remove('hidden');
            }
        } else {
            if (errorDiv) errorDiv.classList.add('hidden');
            document.getElementById('auth-register-username').value = '';
            document.getElementById('auth-register-email').value = '';
            document.getElementById('auth-register-password').value = '';
            await this._completeAuthentication();
        }
    }

    _setupPresenceHeartbeat() {
        clearInterval(this._presenceHeartbeatInterval);
        const heartbeat = () => {
            if (!this._authenticated || !account.isLoggedIn()) return;
            const preferences = this._socialDiscoveryPreferences();
            fetch('/api/social/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.getToken()}` },
                body: JSON.stringify({
                    instanceId: this.network.playerId,
                    state: presenceStateFor(document.body.dataset.screen, this.game.state),
                    discoverable: preferences.discoverable,
                    region: preferences.region
                })
            }).catch(() => {});
        };
        this._presenceHeartbeatNow = heartbeat;
        heartbeat();
        this._presenceHeartbeatInterval = setInterval(heartbeat, 20000);
        if (!this._presenceScreenBound) {
            this._presenceScreenBound = true;
            window.addEventListener('warrball:screen', event => {
                heartbeat();
                if (event.detail?.screen === 'mainMenu') this._socialPollNow?.();
                else this._closePartyInviteDialog();
            }, { signal: this._mainAbort.signal });
        }
    }

    _socialDiscoveryPreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem(SOCIAL_DISCOVERY_KEY) || '{}');
            const region = /^[a-z0-9-]{1,24}$/.test(String(saved.region || '').toLowerCase()) ? String(saved.region).toLowerCase() : 'global';
            return { discoverable: saved.discoverable !== false, region };
        } catch { return { discoverable: true, region: 'global' }; }
    }

    _saveSocialDiscoveryPreferences(discoverable, region) {
        const safeRegion = /^[a-z0-9-]{1,24}$/.test(String(region || '').toLowerCase()) ? String(region).toLowerCase() : 'global';
        try { localStorage.setItem(SOCIAL_DISCOVERY_KEY, JSON.stringify({ discoverable: discoverable !== false, region: safeRegion })); } catch {}
        return { discoverable: discoverable !== false, region: safeRegion };
    }

    _canFollowPartyLobby() {
        return PARTY_FOLLOW_SCREENS.has(document.body.dataset.screen)
            && !this._socialHubCode
            && !this.network?.connected;
    }

    _partyFollowKey(target = this._partyLobbyTarget) {
        if (!target?.code || !Number.isSafeInteger(target?.revision)) return '';
        return `${target.partyRevision}:${target.revision}:${target.code}`;
    }

    async _partyLobbyApi(path, options = {}) {
        const token = account.getToken();
        if (!token) return { error: 'Sign in required.' };
        try {
            const response = await fetch(path, {
                ...options,
                headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
            });
            const data = await response.json().catch(() => ({}));
            return response.ok ? data : { error: data.error || 'Squad service unavailable.' };
        } catch { return { error: 'Squad service unavailable.' }; }
    }

    async _beginPartyCasualQueue(party) {
        const partyRevision = Number(party?.revision);
        if (!Number.isSafeInteger(partyRevision)) return false;
        const result = await this._partyLobbyApi('/api/party/queue-state', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyRevision })
        });
        if (result.error || !result.queueState) {
            this.ui.showMessage?.(result.error || 'Your squad changed. Try again.', 2000);
            return false;
        }
        this._partyQueueState = result.queueState;
        this._partyLobbyTarget = null;
        this.productAnalytics.track('party_queue_start', { queue: 'casual', source: 'party' });
        this.refreshFriendsSidebar();
        return true;
    }

    async _publishPartyLobbyTarget(code, party) {
        const partyRevision = Number(party?.revision);
        if (!Number.isSafeInteger(partyRevision) || !code) return false;
        const result = await this._partyLobbyApi('/api/party/lobby-target', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyRevision, lobbyCode: code })
        });
        if (result.error || !result.lobbyTarget) {
            this.ui.showMessage?.(result.error || 'Squad could not follow this lobby.', 2200);
            return false;
        }
        this._partyQueueState = null;
        this._partyLobbyTarget = result.lobbyTarget;
        this.refreshFriendsSidebar();
        this._socialPollNow?.();
        return true;
    }

    async _refreshPartyLobbyIntent({ allowAutoFollow = true } = {}) {
        const result = await this._partyLobbyApi('/api/party/lobby-target');
        if (result.error) return false;
        this._partyQueueState = result.queueState || null;
        this._partyLobbyTarget = result.lobbyTarget || null;
        this.refreshFriendsSidebar();
        if (allowAutoFollow) await this._followPartyLobbyTarget();
        return true;
    }

    async _followPartyLobbyTarget({ manual = false } = {}) {
        const party = Friends.party;
        const target = this._partyLobbyTarget;
        const myId = account.getAccount()?.id;
        const key = this._partyFollowKey(target);
        if (!target || !key || !party || party.leaderAccountId === myId || target.partyRevision !== party.revision
            || !this._canFollowPartyLobby() || this._partyFollowInFlight || (!manual && this._partyFollowAttemptedTarget === key)) return false;
        this._partyFollowAttemptedTarget = key;
        this._partyFollowInFlight = true;
        this.refreshFriendsSidebar();
        const joined = await this._quickJoin(target.code, { partyFollow: true });
        this._partyFollowInFlight = false;
        this.productAnalytics.track(joined ? 'party_queue_follow_success' : 'party_queue_follow_failure', {
            queue: 'casual', source: 'party', result: joined ? 'joined' : 'join_error'
        });
        if (!joined) this.ui.showMessage?.('Squad lobby is still available. Select Join squad to retry.', 2400);
        this.refreshFriendsSidebar();
        return joined;
    }

    _startSocialPolling() {
        clearInterval(this._socialPollTimer);
        const socialScreens = new Set(['mainMenu', 'multiplayerMenu', 'joinMenu', 'lobby', 'socialCenter']);
        const poll = async () => {
            if (!this._authenticated || document.hidden || !socialScreens.has(document.body.dataset.screen)) return;
            const { region } = this._socialDiscoveryPreferences();
            this._socialRailSyncing = true;
            this.refreshFriendsSidebar();
            const results = await Promise.all([Friends.sync(), Friends.refreshAvailable(region), Friends.refreshParty()]);
            this._socialRailSyncing = false;
            this._socialRailLoaded = true;
            this._socialRailError = results.find(result => result?.error)?.error || '';
            this.refreshFriendsSidebar();
            await this._refreshPartyLobbyIntent();
            this._presentPendingPartyInvite();
            if (document.body.dataset.screen === 'socialCenter') this._renderSocialCenter();
        };
        this._socialPollNow = poll;
        poll();
        this._socialPollTimer = setInterval(poll, 5000);
        if (!this._socialVisibilityBound) {
            this._socialVisibilityBound = true;
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && this._authenticated) this._socialPollNow?.();
            }, { signal: this._mainAbort.signal });
        }
    }

    async _logout() {
        this._closePartyInviteDialog();
        if (this._socialHubCode) {
            await this._socialHubApi(`/api/social-hubs/${encodeURIComponent(this._socialHubCode)}`, { method: 'DELETE' });
            this._socialHubCode = null;
        }
        if (this._lobbyCode && this.network?.isHost) await this._unregisterLobby(this._lobbyCode);
        this._lobbyCode = null;
        this._stopHostCheckpointLifecycle();
        if (this.network?.isHost) this.network.closeLobby?.();
        else this.network?.disconnect?.();
        this.game.cancelPreGame?.();
        this.game.setState(STATES.MENU);
        this._authenticated = false;
        clearInterval(this._presenceHeartbeatInterval);
        clearInterval(this._socialPollTimer);
        this._presenceHeartbeatInterval = null;
        this._socialPollTimer = null;
        this.store.remoteReady = false;
        this.store.sessionToken = '';
        await account.logout();
        this._showAuthGate('Signed out. Sign in to continue.');
    }

    _getKnifeStyle(id) {
        const base = KNIVES[id] || KNIVES.training;
        const custom = migrateCosmeticLoadout(this.store.get('cosmeticLoadout')).knife;
        return custom.id === base.id
            ? { ...base, patternSeed: custom.patternSeed, wear: custom.wear }
            : base;
    }

    _renderCardCollection() {
        const grid = document.getElementById('card-collection-grid');
        const status = document.getElementById('card-collection-status');
        const select = document.getElementById('card-tradeup-select');
        if (!grid || !status || !select) return;
        const collection = this.store.getCardCollection();
        const equipped = this.store.getEquippedCards();
        const cache = this.store.get('arenaCache') || {};
        const cards = Object.values(ARENA_CARDS).sort((left, right) => {
            const rarity = CARD_RARITIES[left.rarity].rank - CARD_RARITIES[right.rarity].rank;
            return rarity || left.name.localeCompare(right.name);
        });
        const ownedUnique = cards.filter(card => (collection[card.id] || 0) > 0).length;
        status.textContent = `${ownedUnique}/${cards.length} unique owned · ${cache.opened || 0} Arena Caches opened. Casual/Arcade only; Ranked uses the shared baseline.`;
        grid.replaceChildren();
        for (const card of cards) {
            const copies = collection[card.id] || 0;
            const isEquipped = equipped[card.slot] === card.id;
            const article = document.createElement('article');
            article.className = `arena-card${isEquipped ? ' is-equipped' : ''}${copies < 1 ? ' is-locked' : ''}`;
            article.dataset.rarity = card.rarity;
            article.dataset.cardId = card.id;
            article.dataset.slot = card.slot;
            article.dataset.state = isEquipped ? 'equipped' : copies ? 'owned' : 'locked';
            article.tabIndex = -1;
            const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            art.setAttribute('class', 'ui-icon card-art');
            art.setAttribute('aria-hidden', 'true');
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            icon.setAttribute('href', CARD_EFFECT_ICON_IDS[card.effectId] || (card.slot === 'active' ? '#i-target' : '#i-chart'));
            art.appendChild(icon);
            const rarity = document.createElement('span');
            rarity.className = 'card-rarity';
            rarity.textContent = CARD_RARITIES[card.rarity].label;
            const name = document.createElement('strong');
            name.className = 'card-name';
            name.textContent = card.name;
            const copy = document.createElement('p');
            copy.className = 'card-copy';
            copy.textContent = card.description;
            const count = document.createElement('span');
            count.className = 'card-count';
            count.textContent = `Owned: ${copies}`;
            article.append(art, rarity, name, copy, count);
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'btn btn-secondary btn-small card-equip';
            action.dataset.cardId = card.id;
            action.dataset.slot = card.slot;
            action.disabled = copies < 1 || isEquipped;
            action.textContent = isEquipped ? 'Equipped' : copies ? `Equip ${card.slot}` : 'Locked in Arena Cache';
            article.appendChild(action);
            grid.appendChild(article);
        }
        select.replaceChildren();
        const tradeable = cards.filter(card => card.rarity !== 'legendary' && (collection[card.id] || 0) >= 5);
        if (!tradeable.length) {
            const option = new Option('Need 5 duplicate cards', '');
            option.disabled = true;
            option.selected = true;
            select.add(option);
        } else {
            for (const card of tradeable) {
                select.add(new Option(`${card.name} x5 → next rarity`, card.id));
            }
        }
        document.getElementById('btn-card-tradeup').disabled = !tradeable.length;
    }

    // Store'dan loadout uygula (karakter + rune + ball skin).
    applyLoadout() {
        const loadout = this.store.getCardEffects?.(this.game.mode?.id) || this.store.get('loadout') || DEFAULT_LOADOUT;
        const charId = this.store.get('selectedChar') || 'rally';
        this.player.applyLoadout(charId, loadout.runes);
        this.player.loadout.skill = loadout.skill || 'slow';
        // Ball skin uygula
        const ballSkin = this.store.get('equippedBall') || 'classic';
        this.game.ball.setSkin(ballSkin);
        const knifeId = this.store.get('equippedKnives')?.[this.player.team] || 'training';
        this.player.knifeId = knifeId;
        this.player.setKnifeStyle?.(this._getKnifeStyle(knifeId));
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
        this.menuHero?.setReducedMotion(!!settings.reduceMotion);
        this.menuStage?.setReducedMotion(!!settings.reduceMotion);
        this.game.juice.screenShakeEnabled = settings.screenShake !== false;
        this.game.juice.screenFlashEnabled = settings.screenFlash !== false;
        document.body.classList.toggle('reduced-motion', !!settings.reduceMotion);
        document.body.classList.toggle('high-contrast', !!settings.highContrast);
        document.body.dataset.colorBlind = settings.colorBlind || 'none';

        const values = {
            'setting-quality': settings.quality || 'medium',
            'setting-auto-quality': settings.autoQuality !== false,
            'setting-public-diagnostics': settings.publicDiagnostics !== false,
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
                this._renderMenuIdentity();
            });
        }
        this._renderMenuIdentity();
        this._renderMenuFeatured();
        this._renderRetentionBadge();
        this._renderRetentionStrip();
    }

    // The home screen only mirrors existing profile and party state; it never opens
    // a network session or invents a second social-state representation.
    _renderMenuIdentity() {
        const name = this.game.playerName || this.store.get('playerName') || 'Player';
        const elo = Number(this.store.getElo?.()) || 1000;
        const rank = getRank(elo);
        const nameNode = document.getElementById('menu-player-name');
        const rankNode = document.getElementById('menu-player-rank');
        const eloNode = document.getElementById('menu-player-elo');
        const badge = document.getElementById('menu-rank-badge');
        if (nameNode) nameNode.textContent = name;
        if (rankNode) rankNode.textContent = rank.name;
        if (eloNode) eloNode.textContent = `${elo} ELO`;
        if (badge) {
            badge.dataset.rank = rank.name.toLowerCase();
            badge.style.setProperty('--menu-rank-color', rank.color);
        }
        this._renderMenuPartyRail(name);
    }

    _renderMenuPartyRail(localName = this.game.playerName || this.store.get('playerName') || 'Player') {
        const list = document.getElementById('menu-party-list');
        const count = document.getElementById('menu-party-count');
        const accountId = account.getAccount()?.id;
        const party = Friends.party;
        const members = party?.memberAccountIds?.length ? party.memberAccountIds : (accountId ? [accountId] : []);
        if (count) count.textContent = `${Math.max(1, members.length)} / ${party?.maxMembers || 8}`;
        if (!list) return;
        const rows = members.slice(0, 4).map(memberId => {
            const row = document.createElement('div');
            row.className = 'menu-party-member';
            const identity = document.createElement('span');
            const name = document.createElement('b');
            name.textContent = this._socialAccountName(memberId, localName);
            identity.append(name);
            if (party?.leaderAccountId === memberId) {
                const leader = document.createElement('small');
                leader.textContent = 'LEADER';
                identity.append(leader);
            }
            const state = document.createElement('em');
            state.textContent = memberId === accountId ? 'YOU' : 'IN PARTY';
            row.append(identity, state);
            return row;
        });
        if (this._partyQueueState && party?.leaderAccountId !== accountId) {
            const status = document.createElement('div');
            status.className = 'menu-party-member';
            status.textContent = 'LEADER IS CHOOSING A CASUAL LOBBY…';
            rows.push(status);
        }
        list.replaceChildren(...rows);
    }

    _socialAccountName(accountId, fallback = 'Player') {
        if (accountId === account.getAccount()?.id) return account.getUsername() || fallback;
        return Friends.getFriend(accountId)?.username
            || Friends.available.find(player => player.accountId === accountId)?.username
            || 'Squad member';
    }

    // Retention strip: daily-challenge + battlepass progress cards on the main
    // menu, so "why come back today" is visible before any click (2026 retention
    // pass). Pulls live state from js/daily.js (Daily singleton) and
    // js/store.js#getBattlepassProgress — both already the single source of
    // truth for their screens, this only mirrors them into a compact summary.
    _renderRetentionStrip() {
        const dailyCard = document.getElementById('menu-daily-card');
        if (dailyCard) {
            const challenges = this.store.getDailyChallenges?.() || Daily.getChallenges();
            const total = challenges.length;
            const done = challenges.filter(c => c.progress >= c.target).length;
            dailyCard.hidden = total === 0;
            const sub = document.getElementById('menu-daily-sub');
            if (sub) sub.textContent = `${done}/${total} done`;
            const fill = document.getElementById('menu-daily-fill');
            if (fill) fill.style.width = `${total ? (done / total) * 100 : 0}%`;
        }

        const bpCard = document.getElementById('menu-bp-card');
        if (bpCard) {
            const bp = this.store.getBattlepassProgress();
            bpCard.hidden = false;
            const title = document.getElementById('menu-bp-title');
            if (title) title.textContent = `Battle Pass — Tier ${bp.tier}`;
            const maxed = bp.tier >= 50;
            const next = maxed ? null : getBattlepassRewardEntry(Math.min(50, bp.tier + 1), 'free');
            const sub = document.getElementById('menu-bp-sub');
            if (sub) sub.textContent = maxed ? 'Max Tier' : `Next: ${next?.name || '—'}`;
            const needXp = this.store.getBattlepassXpForNextTier();
            const fill = document.getElementById('menu-bp-fill');
            if (fill) fill.style.width = `${maxed || !needXp ? 100 : Math.min(100, (bp.xp / needXp) * 100)}%`;
        }
    }

    // Kompakt "FEATURED" vitrin: günün kasası + 1-2 top skin, tıklayınca shop'a
    // götürür. Katalogdan dinamik (CASES/BALL_SKINS), yeni skin/kasa eklenince
    // otomatik döner — bu dosyaya dokunmaya gerek yok.
    _renderMenuFeatured() {
        const root = document.getElementById('menu-featured');
        if (!root) return;
        const data = deriveFeaturedStrip({ cases: CASES, skins: BALL_SKINS, liveMarket: this.store.getLiveMarket?.(), count: 2 });
        const items = [];
        if (data.case) items.push({ kind: 'case', tab: 'cases', id: data.case.id, name: data.case.name, art: data.case.art, color: null });
        for (const skin of data.skins) items.push({ kind: 'skin', tab: 'balls', id: skin.id, name: skin.name, art: null, color: skin.color });
        root.replaceChildren();
        if (!items.length) {
            root.hidden = true;
            return;
        }
        root.hidden = false;
        const kicker = document.createElement('span');
        kicker.className = 'ow-featured-kicker';
        kicker.textContent = 'Featured';
        root.appendChild(kicker);
        for (const item of items) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `ow-featured-item ow-featured-${item.kind}`;
            btn.dataset.tab = item.tab;
            btn.setAttribute('aria-label', `${item.name} — open in shop`);
            if (item.art) {
                const img = document.createElement('img');
                img.className = 'ow-featured-art';
                img.src = item.art;
                img.alt = '';
                img.loading = 'lazy';
                btn.appendChild(img);
            } else {
                const orb = document.createElement('span');
                orb.className = 'ow-featured-orb';
                orb.setAttribute('aria-hidden', 'true');
                orb.style.setProperty('--fs-color', `#${(item.color ?? 0).toString(16).padStart(6, '0')}`);
                btn.appendChild(orb);
            }
            const label = document.createElement('span');
            label.className = 'ow-featured-name';
            label.textContent = item.name;
            btn.appendChild(label);
            btn.addEventListener('click', () => {
                this.ui.renderShop(this.store, item.tab);
                this.ui.showScreen('shop');
                this._syncShopShowcase();
                this.shopShowcase?.start();
            });
            root.appendChild(btn);
        }
    }

    // Retention: main-menu login-streak badge (js/store.js#getLoginStreakState /
    // #claimLoginStreak). Separate surface from the Daily Challenges screen's
    // "Daily Login" card (js/ui.js#renderDaily) — different formula, different
    // persisted state, always visible instead of buried in a sub-screen.
    _renderRetentionBadge() {
        const badge = document.getElementById('menu-streak-badge');
        if (!badge) return;
        const state = this.store.getLoginStreakState();
        badge.hidden = false;
        badge.disabled = state.claimed;
        badge.classList.toggle('claimed', state.claimed);
        badge.replaceChildren();
        const fire = document.createElement('span');
        fire.className = 'ow-streak-fire';
        fire.setAttribute('aria-hidden', 'true');
        fire.textContent = state.claimed ? '✓' : '🔥';
        const label = document.createElement('span');
        label.className = 'ow-streak-label';
        label.textContent = state.claimed
            ? `Day ${state.day}`
            : `Daily Streak: ${state.day} — Claim +${state.reward}`;
        badge.appendChild(fire);
        badge.appendChild(label);
    }

    async _claimRetentionStreak() {
        const badge = document.getElementById('menu-streak-badge');
        if (!badge || badge.disabled) return;
        badge.disabled = true;
        const requestId = `streak:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const result = await this.store.claimLoginStreak(requestId);
        if (result?.ok) {
            this.ui.showMessage?.(`Daily Streak Day ${result.day}: +${result.reward} coins`, 2500);
        }
        this._renderRetentionBadge();
    }

    // Maç sonu reward: coins + xp, battlepass tier dolum, istatistik, achievement, daily.
    async awardMatchRewards() {
        if (!isTerminalRematchState(this.game.state)) return;
        if (this.game._rewardsClaimed) return;
        this.game._rewardsClaimed = true;
        if (this.game._practiceMode) {
            this.game._practiceMode = false;
            return; // practice'ten reward yok
        }
        const stats = this.game.scoreboard.getPlayerStats();
        const myStat = stats.find(s => s.name === this.game.playerName) || { score:0, deflections:0, hits:0 };
        const winner = this.game._ffa ? this.game._finalWinner : this.game.scoreboard.getWinner();
        const myTeam = this.player.team;
        const won = this.game._ffa ? winner === this.game.playerName : winner === myTeam.toUpperCase();
        const draw = winner === 'DRAW';
        const matchId = this.game.matchId || createMatchId();
        const isRanked = this._activeMatchMode === 'ranked';
        const matchResult = draw ? 'draw' : won ? 'win' : 'loss';
        const ranked = !this.store.remoteReady && isRanked
            ? this.store.recordRankedMatch({
                matchId,
                opponentElo: this._rankedMatch?.opponentElo ?? this.store.getElo(),
                result: matchResult,
                playedAt: Date.now()
            })
            : { elo: this.store.getElo() };
        MatchHistory.add({
            playerName: this.game.playerName,
            winner: won ? this.game.playerName : winner,
            loser: !won && !draw ? this.game.playerName : '',
            result: draw ? 'draw' : won ? 'win' : 'loss',
            mode: this.game.mode?.id || 'classic',
            map: this.arena.mapId,
            redScore: this.game.scoreboard.redScore,
            blueScore: this.game.scoreboard.blueScore,
            kills: myStat.score || 0,
            deaths: myStat.deaths || 0,
            damage: myStat.damageDealt || 0,
            elo: ranked.elo
        });
        const knifeId = this.store.get('equippedKnives')?.[myTeam] || 'training';
        this.store.addKnifeKill(knifeId, myStat.score || 0);
        for (const player of this.game.getPlayerList()) {
            if (!player.isYou && !player.isBot) {
                this.socialProfile = rememberPlayer(this.socialProfile, {
                    name: player.name,
                    elo: player.elo || 1000
                });
            }
        }
        this._saveSocialProfile();
        this._rankedMatch = null;
        // Free earning route: today's first completed match pays a flat bonus
        // (docs/V3_ECONOMY.md "First match of day"). Guest truth lives here;
        // account players get the server's own decision inside grantMatchRemote()
        // below (server never trusts this local guess for the real grant).
        const firstOfDay = this.store.remoteReady ? false : this.store.claimFirstMatchOfDay();
        const rewardCalc = this.store.matchRewardBreakdown({
            won, kills: myStat.score || 0, deflects: myStat.deflections || 0, firstOfDay
        });
        // Casual-first XP: weighted on how the match was played rather than on the
        // result, so a strong loss still out-earns a passive win (js/prestige.js).
        const rally = this.game.rallyCount;
        const rawXp = matchXp({
            deflections: myStat.deflections,
            kills: myStat.score,
            rally,
            survived: (myStat.deaths || 0) === 0,
            won
        });
        const xp = this.store.boostedXp(rawXp);
        const xpSources = [
            { label: 'Match played', value: MATCH_XP.base },
            { label: `Deflections x${myStat.deflections || 0}`, value: (myStat.deflections || 0) * MATCH_XP.perDeflection },
            { label: `Eliminations x${myStat.score || 0}`, value: (myStat.score || 0) * MATCH_XP.perKill },
            { label: `Rally x${rally || 0}`, value: (rally || 0) * MATCH_XP.perRally },
            { label: (myStat.deaths || 0) === 0 ? 'Survival bonus' : 'Match result', value: (myStat.deaths || 0) === 0 ? MATCH_XP.survivalBonus : 0 },
            { label: won ? 'Victory bonus' : 'Match played bonus', value: won ? MATCH_XP.win : MATCH_XP.loss },
            { label: 'Active XP boost', value: xp - rawXp }
        ];
        // Authenticated matches never add client-issued currency. XP remains
        // local presentation/progression while the economy profile is synced
        // from the lifecycle completion response.
        const result = this.store.grant({ currency: this.store.remoteReady ? 0 : rewardCalc.total, xp });
        // Account profiles receive their cache result only from the server's
        // idempotent match-reward record. Local fallback remains for legacy
        // offline development profiles.
        let cardReward = null;
        if (!this.store.remoteReady) cardReward = this.store.awardArenaCache({ matchId, won, leveledUp: result.leveledUp });
        this.ui._lastMatchReward = { ...rewardCalc, kills: myStat.score || 0, deflects: myStat.deflections || 0 };
        const started = await this._matchAuthorityReady;
        const synced = started && await this.store.grantMatchRemote({
            matchId,
            mode: this._activeMatchMode || (isRanked ? 'ranked' : 'solo'),
            lobbyCode: this._lobbyCode || '',
            result: matchResult,
            won,
            deflections: myStat.deflections,
            score: myStat.score
        });
        if (synced) {
            cardReward = synced.cardReward || null;
            if (!synced.replayed && Array.isArray(synced.dailyProgress?.completed)) {
                for (const challengeId of synced.dailyProgress.completed) {
                    this.productAnalytics.track('daily_challenge_completed', { itemId: challengeId, source: 'match_authority' });
                }
            }
            this.refreshMetaStats();
        }
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
        if (!this.store.remoteReady) Daily.progress({ won, deflects: myStat.deflections, bestRally: rally, spikes, damage: damageDealt, winStreak: this.store.getWinStreak(), cleanWin });
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

        if (result.prestiged) {
            this.ui.showMessage?.(`⭐ PRESTIGE ${result.prestige} — ${prestigeTitle(result.prestige)}!`, 4500);
        } else if (result.leveledUp) {
            this.ui.showMessage?.(`Level Up! ${accountRankLabel(result)}`, 3000);
        }
        if (mastery.masteryLeveledUp) {
            this.ui.showMessage?.(`${CHARACTERS[this.player.charId]?.name || 'Character'} Mastery Lv ${mastery.masteryLevel}!`, 3000);
        }
        // Complete the visual handoff only after the local or authoritative
        // result settles. A replay is a historical receipt, never a fresh drop.
        const freshAuthorityResult = !synced || synced.replayed !== true;
        const matchDrops = [];
        if (freshAuthorityResult && cardReward?.card) {
            const card = cardReward.card;
            const dropResult = cardReward.duplicate ? 'duplicate' : 'new';
            this.productAnalytics.track('arena_cache_earned', { itemId: card.id, itemType: card.rarity, result: synced ? 'match_drop' : result.leveledUp ? 'level_up' : 'match_drop' });
            this.productAnalytics.track('arena_cache_opened', { itemId: card.id, itemType: card.rarity, result: dropResult });
            this.productAnalytics.track('card_earned', { itemId: card.id, itemType: card.rarity, result: dropResult });
            matchDrops.push({ type: 'card', id: card.id, name: card.name, rarity: card.rarity });
            this.ui.showMessage?.(`Arena Cache: ${card.name} (${CARD_RARITIES[card.rarity].label})`, 4200);
        }
        if (freshAuthorityResult && synced?.earnedCase && CASES[synced.earnedCase]) {
            const box = CASES[synced.earnedCase];
            this.productAnalytics.track('earned_case_granted', { itemId: box.id, itemType: 'cosmetic_case', result: synced.earnedCaseSource || 'match_roll' });
            matchDrops.push({ type: 'case', id: box.id, name: box.name, rarity: 'earned' });
            this.ui.showMessage?.(`MATCH DROP: Earned ${box.name} — open it free in Cases.`, 4200);
        }
        // The report receives a receipt only after this player's local or
        // authoritative settlement. A pending remote completion stays pending;
        // it must not borrow the host's P2P economy or invent a total.
        const settledReceipt = this.store.remoteReady && (!synced || synced.pending) ? null : {
            xp,
            xpSources,
            coins: synced ? {
                base: synced.base,
                bonus: synced.bonus,
                firstOfDay: synced.firstOfDay,
                total: synced.coins
            } : rewardCalc,
            battlepassXp: synced ? synced.battlepassXp : xp,
            dailies: synced ? synced.dailyRows : Daily.takeLastMatchProgress?.()
        };
        // An async remote result may arrive after the post-game overlay rendered.
        // Never let that receipt paint onto a new rematch or a non-terminal game.
        if (this.game.matchId === matchId && isTerminalRematchState(this.game.state)) {
            if (settledReceipt && synced?.replayed !== true) this.ui.setPostGameRewardReceipt?.(matchId, settledReceipt, this.store);
            this.ui.setPostGameMatchDrops?.(matchId, matchDrops);
            if (!settledReceipt && this.store.remoteReady) this._startDeferredMatchRewardRetry(matchId, { xp, xpSources });
        }
        if (settledReceipt && synced?.replayed !== true) this.ui.showMessage?.(`+${settledReceipt.coins.total} coins, +${xp} XP`, 3000);

        // Replay kaydet
        const replay = Replay.stopRecording();
        if (replay && replay.events.length > 0) Replay.save(replay);
    }

    _startDeferredMatchRewardRetry(matchId, context) {
        clearTimeout(this._deferredRewardRetryTimer);
        const active = () => this.game.matchId === matchId
            && isTerminalRematchState(this.game.state)
            && this.ui._postGameRewardMatchId === matchId
            && !document.getElementById('post-game-screen')?.classList.contains('hidden');
        const paint = synced => {
            if (!active() || !synced?.ok || synced.pending || synced.replayed) return false;
            const receipt = {
                xp: context.xp,
                xpSources: context.xpSources,
                coins: { base: synced.base, bonus: synced.bonus, firstOfDay: synced.firstOfDay, total: synced.coins },
                battlepassXp: synced.battlepassXp,
                dailies: synced.dailyRows
            };
            const painted = this.ui.setPostGameRewardReceipt?.(matchId, receipt, this.store);
            if (painted && synced.earnedCase && CASES[synced.earnedCase]) {
                const box = CASES[synced.earnedCase];
                this.ui.setPostGameMatchDrops?.(matchId, [{ type: 'case', id: box.id, name: box.name, rarity: 'earned' }]);
            } else if (painted && synced.cardReward?.card) {
                const card = synced.cardReward.card;
                this.ui.setPostGameMatchDrops?.(matchId, [{ type: 'card', id: card.id, name: card.name, rarity: card.rarity }]);
            }
            return painted;
        };
        let attempts = 0;
        const retry = async () => {
            if (!active()) return false;
            const pendingStatus = await this.store.getSettledMatchRemote(matchId);
            // The GET can finish after a rematch/menu transition. Recheck before
            // touching Store so an inactive receipt cannot update profile cache.
            if (!active()) return false;
            const settled = pendingStatus?.status
                ? this.store.applySettledMatchRemote(pendingStatus.status)
                : pendingStatus;
            if (paint(settled)) return true;
            if (!active()) return false;
            attempts++;
            this.ui.setPostGameRewardRetry?.(matchId, retry, { exhausted: attempts >= 12 });
            if (attempts < 12) this._deferredRewardRetryTimer = setTimeout(() => { void retry(); }, 2500);
            return false;
        };
        this.ui.setPostGameRewardRetry?.(matchId, retry);
        this._deferredRewardRetryTimer = setTimeout(() => { void retry(); }, 2500);
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

    // ===== Manual help / practice entry =====
    // Authentication lands directly on the menu. This panel opens only when the
    // player asks for help and never interrupts a first session automatically.
    showFtueWelcome() {
        if (this.game.state !== STATES.MENU) return;
        this._ftueWelcomeFirstRun = false;
        document.getElementById('ftue-welcome')?.classList.remove('hidden');
        this.productAnalytics.track('ftue_view', { source: 'manual' });
    }

    hideFtueWelcome({ reason = 'dismiss', trackExit = false } = {}) {
        document.getElementById('ftue-welcome')?.classList.add('hidden');
        if (trackExit) this.productAnalytics.track('ftue_exit', { reason, source: 'manual' });
        this._ftueWelcomeFirstRun = false;
    }

    startFtueGuidedDrill() {
        this.hideFtueWelcome({ reason: 'start_guided_drill' });
        this.startGuidedDeflectDrill({ source: 'manual_help' });
    }

    // Preserve the first-solo bot reliability guard without showing automatic
    // tutorial overlays or timed HUD hints.
    _armFirstSoloBotGuard() {
        this.game.armFirstSoloBotDeflectGuard();
    }

    setupMenuHandlers() {
        // Main menu buttons
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };

        // Mobile primary navigation is intentionally swipeable. Always return it
        // to PLAY when re-entering the menu so a previous sub-screen cannot leave
        // the first routes off-screen.
        const primaryNav = document.querySelector('#main-menu .ow-tabs');
        window.addEventListener('warrball:screen', event => {
            if (event.detail?.screen === 'mainMenu' && primaryNav) primaryNav.scrollLeft = 0;
        }, { signal: this._mainAbort.signal });

        bind('menu-streak-badge', () => this._claimRetentionStreak());

        bind('btn-how-to-play', () => this.showFtueWelcome());
        bind('ftue-welcome-start', () => this.startFtueGuidedDrill());
        bind('ftue-welcome-practice', () => this.hideFtueWelcome({ reason: 'skip', trackExit: true }));

        const openMultiplayer = () => {
            // QUICK PLAY opens the multiplayer hub (user decision 2026-07-30): lobby
            // browser + create/host + join-by-code + Solo vs Bots all live there.
            // Bot matches are one click further via btn-mp-solo.
            this.ui.showScreen('multiplayerMenu');
            this._refreshLobbyList();
            clearInterval(this._mpRefreshTimer);
            this._mpRefreshTimer = setInterval(() => this._refreshLobbyList(), 5000);
        };
        bind('btn-play-solo', openMultiplayer);
        bind('btn-play', openMultiplayer);

        // Multiplayer menü butonları
        bind('btn-mp-create', () => {
            clearInterval(this._mpRefreshTimer);
            this._doHostGame();
        });
        bind('btn-mp-host-strip', () => {
            clearInterval(this._mpRefreshTimer);
            this._doHostGame();
        });
        // The loading, empty and service-error lobby states each expose one
        // in-context Host action. Delegate once so the initial loading markup
        // and every refreshed empty state preserve the same keyboard path.
        document.getElementById('mp-lobby-list')?.addEventListener('click', event => {
            if (event.target.closest('.mp-lobby-empty-cta')) {
                document.getElementById('btn-mp-create')?.click();
                return;
            }
            if (event.target.closest('.mp-lobby-empty-join')) {
                document.getElementById('btn-mp-join')?.click();
            }
        });
        bind('btn-mp-join', () => {
            clearInterval(this._mpRefreshTimer);
            this.ui.showScreen('joinMenu');
        });
        bind('btn-mp-solo', () => {
            clearInterval(this._mpRefreshTimer);
            this.game.startSolo();
            this._armFirstSoloBotGuard();
            this.ui.showScreen('lobby');
        });
        bind('btn-mp-quick', () => this._startQuickPlay());
        bind('btn-mp-back', () => {
            clearInterval(this._mpRefreshTimer);
            this.ui.showScreen('mainMenu');
        });
        bind('btn-mp-refresh', () => {
            this._refreshLobbyList();
        });
        ['mp-lobby-mode-filter', 'mp-lobby-map-filter', 'mp-lobby-queue-filter', 'mp-lobby-open-filter'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this._refreshLobbyList());
        });
        document.getElementById('mp-lobby-map-filter')?.addEventListener('input', () => this._refreshLobbyList());

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
        bind('spectator-prev-target', () => Spectator.prevTarget());
        bind('spectator-next-target', () => Spectator.nextTarget());
        document.querySelectorAll('[data-spectator-mode]').forEach(button => {
            button.addEventListener('click', () => Spectator.setCameraMode(button.dataset.spectatorMode));
        });

        bind('btn-join-connect', async () => {
            try {
                const code = document.getElementById('join-code-input')?.value;
                const name = document.getElementById('join-name-input')?.value || 'Player';
                const password = document.getElementById('join-pass-input')?.value || '';
                if (!code) return;
                this._setupClientNetHandlers();
                await this.network.joinGame(code, name, password);
                this._lobbyCode = code;
                await this._confirmLobbyAdmission(code);
                this.game.playerName = name;
                // Same client bootstrap _quickJoin does — without the bg loop this join
                // path stops interpolating and stops sending positions whenever the tab
                // is hidden, so the joiner freezes for everyone else.
                this._startBgLoop();
                this.ui.showScreen('lobby');
                this._finalizeClientLobbyJoin(code);
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
            this.ui.renderLockerInventory(this.store);
            this.ui.setLockerTab('loadout');
            this.ui.showScreen('character');
        });

        bind('btn-shop', () => {
            this.ui.renderShop(this.store, 'chars');
            this.ui.showScreen('shop');
            this._syncShopShowcase();
            this.shopShowcase?.start();
        });

        bind('btn-battlepass', () => {
            this.ui.renderBattlepass(this.store);
            this.ui.showScreen('battlepass');
        });
        bind('menu-bp-card', () => {
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
        bind('menu-daily-card', () => {
            this.ui.renderDaily(Daily, this.store);
            this.ui.showScreen('daily');
        });

        bind('btn-ranked', () => {
            this.ui.renderCareer(this.store);
            this.ui.showScreen('ranked');
        });
        bind('btn-profile', () => this.ui.showProfile());
        bind('btn-ranked-play', () => this._startRankedQueue());
        bind('ranked-queue-cancel', () => this._cancelRankedQueue());
        bind('btn-social', () => this._openSocialHubBrowser());
        bind('btn-social-lobby', () => this._openSocialHubBrowser());
        bind('social-hub-browser-close', () => this._closeSocialHubBrowser());
        bind('social-hub-browser-refresh', () => this._refreshSocialHubList());
        bind('social-lobby-exit', () => this._exitSocialLobby());
        bind('social-lobby-photo', () => this._togglePhotoMode());
        bind('social-lobby-inspect', () => this._inspectNearestSocialPlayer());
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
        document.getElementById('leaderboard-filters')?.addEventListener('click', event => {
            const button = event.target.closest('[data-filter]');
            if (!button) return;
            document.querySelectorAll('#leaderboard-filters [data-filter]').forEach(item => item.classList.toggle('selected', item === button));
            this.ui.renderLeaderboard?.(this.store, button.dataset.filter);
        });
        const openSocialCenter = () => {
            this._renderSocialCenter();
            this.ui.showScreen('socialCenter');
        };
        bind('btn-social-center', openSocialCenter);
        bind('btn-menu-party-invite', () => {
            if (!Friends.isPartyLeader(account.getAccount()?.id)) {
                this.ui.showMessage?.('Only the party leader can invite players.', 1800);
                return;
            }
            this._setFriendsRailTab('nearby');
            this._setMobileSocialRailOpen(true);
        });
        bind('btn-menu-squad-center', openSocialCenter);
        bind('profile-logout', () => this._logout());
        bind('btn-social-center-back', () => {
            if (this._socialInspectReturnToHub && this.socialLobby.active) {
                this._socialInspectReturnToHub = false;
                this.ui.hideAll();
                document.getElementById('social-lobby-hud')?.classList.remove('hidden');
                this.player.lock();
                return;
            }
            this.ui.showScreen('mainMenu');
        });
        bind('community-friend-tag', async () => {
            const tag = account.getFriendTag();
            if (!tag) return;
            try { await navigator.clipboard?.writeText(tag); this.ui.showMessage?.('Friend tag copied.', 1200); } catch { this.ui.showMessage?.(tag, 2200); }
        });
        bind('community-friend-add', async () => {
            const input = document.getElementById('community-friend-name');
            const tag = input?.value?.trim();
            if (!tag) return;
            const result = await Friends.request(tag);
            if (result.error) this.ui.showMessage?.(result.error, 1800);
            else this.ui.showMessage?.('Friend request sent.', 1400);
            if (input) input.value = '';
            this._renderSocialCenter();
        });
        bind('party-ready-check', () => {
            const me = this.game.playerName || this.store.get('playerName') || 'Player';
            const member = this.party.members.find(item => item.name === me);
            this.party = setPartyReady(this.party, me, !member?.ready);
            this._saveSocialProfile();
            this._renderSocialCenter();
        });
        document.getElementById('showcase-emote')?.addEventListener('change', event => {
            this.socialProfile.showcase.emote = event.target.value;
            this._saveSocialProfile();
        });
        document.getElementById('showcase-skin')?.addEventListener('change', event => {
            this.socialProfile.showcase.skin = event.target.value;
            this._saveSocialProfile();
        });
        document.getElementById('showcase-pose')?.addEventListener('change', event => {
            this.socialProfile.showcase.pose = event.target.value;
            this._saveSocialProfile();
            this._renderSocialCenter();
        });
        bind('photo-mode-toggle', () => this._togglePhotoMode());
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
            this.ui.showScreen('practiceMenu');
        });
        bind('btn-guided-deflect', () => this.startGuidedDeflectDrill());
        bind('btn-drill-first-bot', () => this._startFirstBotMatchFromDrill());
        bind('btn-free-practice', () => this.startPractice({ launch: true }));
        bind('btn-practice-back', () => this.ui.showScreen('mainMenu'));
        bind('btn-drill-retry', () => this.startGuidedDeflectDrill());
        bind('btn-drill-free-lab', () => {
            document.getElementById('guided-drill-result')?.classList.add('hidden');
            this.startPractice({ launch: true });
        });
        bind('btn-drill-menu', () => {
            this._exitPracticeSession();
            this.game.setState(STATES.MENU);
            this.player.unlock();
            this.ui.showScreen('mainMenu');
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
        bind('copy-crash-report', async () => {
            const report = RuntimeLog.report({
                state: this.game.state,
                map: this.arena.mapId,
                mode: this.game.mode?.id,
                network: this.network.connected ? (this.network.isHost ? 'host' : 'client') : 'offline'
            });
            const text = JSON.stringify(report, null, 2);
            try {
                await navigator.clipboard.writeText(text);
                this.ui.showMessage?.('Crash report copied.', 1400);
            } catch {
                window.prompt('Copy crash report', text);
            }
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
            this._exitPracticeSession();
            this.player.unlock();
            this.ui.setPlayerTarget(false);
            this.game.cancelPreGame?.();
            this._stopHostCheckpointLifecycle();
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
            this.shopShowcase?.stop();
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });
        bind('btn-shop-practice', event => {
            const skinId = event.currentTarget?.dataset.id || this.store.get('equippedAvatarSkin');
            this._startCosmeticPractice(skinId);
        });
        bind('cosmetic-practice-prev', () => this._selectCosmeticPracticeSkin(-1));
        bind('cosmetic-practice-next', () => this._selectCosmeticPracticeSkin(1));
        bind('cosmetic-practice-buy', () => void this._purchaseCosmeticPracticeSkin());
        bind('cosmetic-practice-equip', () => this._equipCosmeticPracticeSkin());
        bind('cosmetic-practice-exit', () => this._exitCosmeticPractice());

        bind('btn-bp-back', () => {
            this.ui.showScreen('mainMenu');
            this.refreshMetaStats();
        });

        bind('btn-avatar-back', () => {
            this.avatarStage3D?.stop();
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
            const currentMaps = this.store.get('customMaps') || [];
            const previous = currentMaps.find(map => map.id === id);
            const maps = currentMaps.filter(map => map.id !== id);
            maps.push({ id, config: safe, publishedId: previous?.publishedId || '' });
            this.store.set('customMaps', maps.slice(-10));
            registerCustomMap(id, safe);
            this.mapEditor.setConfig(safe);
            this.arena.rebuild(id);
            this.startPractice();
        });

        bind('btn-map-publish', async () => {
            if (!this.mapEditor) return;
            const button = document.getElementById('btn-map-publish');
            const status = document.getElementById('map-publish-status');
            const config = this.mapEditor.getConfig();
            config.name = document.getElementById('map-editor-name')?.value || config.name;
            config.dimensions.width = Number(document.getElementById('map-editor-width')?.value) || config.dimensions.width;
            config.dimensions.length = Number(document.getElementById('map-editor-length')?.value) || config.dimensions.length;
            const validation = validateMapConfig(config);
            if (!validation.valid) {
                if (status) status.textContent = validation.errors[0] || 'Map validation failed';
                return;
            }
            if (button) button.disabled = true;
            if (status) status.textContent = 'Submitting for review...';
            if (!this.store.remoteReady) {
                await this.store.connectRemote(this.store.get('playerName'));
            }
            const local = (this.store.get('customMaps') || []).find(map => map.id === 'custom-local');
            const result = await this.store.publishMap(validation.config, local?.publishedId || '');
            if (result.ok) {
                const maps = (this.store.get('customMaps') || []).filter(map => map.id !== 'custom-local');
                maps.push({ id: 'custom-local', config: validation.config, publishedId: result.map.id });
                this.store.set('customMaps', maps.slice(-10));
                if (status) status.textContent = `${result.map.name} - pending review (v${result.map.revision})`;
                this.refreshWorkshop(true);
            } else if (status) {
                status.textContent = result.error;
            }
            if (button) button.disabled = false;
        });

        bind('btn-workshop-public', () => this.refreshWorkshop(false));
        bind('btn-workshop-mine', () => this.refreshWorkshop(true));
        document.getElementById('workshop-search')?.addEventListener('keydown', event => {
            if (event.key === 'Enter') this.refreshWorkshop(this.workshopMine === true);
        });
        document.getElementById('workshop-sort')?.addEventListener('change', () => {
            this.refreshWorkshop(this.workshopMine === true);
        });
        document.getElementById('map-workshop-grid')?.addEventListener('click', async event => {
            const button = event.target.closest('button[data-workshop-action]');
            if (!button) return;
            button.disabled = true;
            if (button.dataset.workshopAction === 'vote') {
                if (!this.store.remoteReady) await this.store.connectRemote(this.store.get('playerName'));
                const result = await this.store.votePublishedMap(
                    button.dataset.mapId,
                    Number(button.dataset.voteValue)
                );
                if (result.ok) await this.refreshWorkshop(this.workshopMine === true);
                else document.getElementById('map-workshop-status').textContent = result.error;
                button.disabled = false;
                return;
            }
            await this.openWorkshopMap(
                button.dataset.mapId,
                button.dataset.mine === '1',
                button.dataset.workshopAction === 'play'
            );
            button.disabled = false;
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
            // Same applyLoadout()-clobbers-mode-HP issue as above: re-sync so saving
            // a loadout mid-instagib-lobby doesn't silently restore normal HP.
            this.game.selectMode(this.game.mode.id);
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
        this.ui.onPlayerInspect = player => this._inspectPlayerProfile(player);

        this._updateRematchUI = (snapshot = null) => {
            const buttons = [
                document.getElementById('btn-play-again'),
                document.getElementById('pg-play-again'),
                document.getElementById('btn-match-result-rematch')
            ].filter(Boolean);
            const statuses = [
                document.getElementById('rematch-status'),
                document.getElementById('pg-rematch-status')
            ].filter(Boolean);
            const ready = Array.isArray(snapshot?.readyPlayerIds) ? snapshot.readyPlayerIds : [];
            const required = Array.isArray(snapshot?.requiredPlayerIds) ? snapshot.requiredPlayerIds : [];
            const localReady = ready.includes(this.network.playerId);
            const label = this._rematchStarting
                ? 'STARTING...'
                : localReady
                    ? required.length ? `READY ${ready.length}/${required.length}` : 'READY SENT'
                    : 'REMATCH';
            buttons.forEach(button => {
                button.textContent = label;
                button.disabled = this._rematchStarting || localReady;
            });
            const text = snapshot?.expired
                ? 'Vote expired. Press Rematch to open a new vote.'
                : this.network.connected && required.length
                    ? `${ready.length}/${required.length} players ready - 30 second vote window`
                    : this.network.connected ? 'Press Rematch when ready.' : 'Instant solo rematch.';
            statuses.forEach(status => { status.textContent = text; });
        };

        this._activeRematchPlayerIds = () => connectedRematchParticipants(
            this._completedMatchPlayerIds,
            this.network.playerId,
            this.network.playerConnections.keys()
        );

        this._publishRematchState = (extra = {}) => {
            const snapshot = { ...this.rematchVote.snapshot(), ...extra };
            this.network.broadcastRematchState(snapshot);
            this._updateRematchUI(snapshot);
            return snapshot;
        };

        this._startRematchMatch = (matchId, sourceMatchId = null) => {
            this._analyticsMatchEntry = 'rematch';
            const startedAt = performance.now();
            this._matchLaunchTiming = {
                requestedAt: startedAt,
                matchLoadElapsedMs: 0,
                setupStartedAt: startedAt
            };
            const started = this.game.startGame(false, matchId);
            if (started === false) {
                this._matchLaunchTiming = null;
                return false;
            }
            this.productAnalytics.track('rematch_start', {
                networkRole: this.network.isHost ? 'host' : this.network.connected ? 'client' : 'solo',
                ...(typeof matchId === 'string' && matchId.length <= 40 ? { matchId } : {}),
                ...(typeof sourceMatchId === 'string' && sourceMatchId.length <= 40 ? { source: sourceMatchId } : {})
            });
            clearTimeout(this._rematchTimer);
            this._rematchTimer = null;
            this.player.lock();
            if (this.network.connected && this.network.isHost && sourceMatchId) {
                this.network.broadcastRematchStart({
                    sourceMatchId,
                    ...this.game.snapshotState(),
                    matchId: this.game.matchId
                });
            }
            Replay.startRecording({
                map: this.arena.mapId,
                mode: this.game.mode?.id || 'classic',
                players: this.game.getPlayerList().map(player => player.name),
                matchId: this.game.matchId
            });
            this._lastRally = this.game.rallyCount;
            return true;
        };

        this._launchRematch = sourceMatchId => {
            if (this._rematchStarting || !this.network.isHost) return;
            const rollback = this.rematchVote.snapshot();
            const nextMatchId = createMatchId();
            if (!this.rematchVote.markStarted(sourceMatchId, nextMatchId).accepted) return;
            this._rematchStarting = true;
            this._updateRematchUI(this.rematchVote.snapshot());
            if (this._startRematchMatch(nextMatchId, sourceMatchId) !== false) return;
            this.rematchVote.begin(sourceMatchId, rollback.requiredPlayerIds);
            for (const playerId of rollback.readyPlayerIds) {
                this.rematchVote.vote(sourceMatchId, playerId, true);
            }
            this._rematchStarting = false;
            this._publishRematchState();
        };

        this._receiveRematchReady = ({ playerId, sourceMatchId, ready }) => {
            if (!this.network.isHost || sourceMatchId !== this.game.matchId) return;
            if (!isTerminalRematchState(this.game.state)) return;
            if (this.rematchVote.sourceMatchId !== sourceMatchId) {
                if (!this.rematchVote.begin(sourceMatchId, this._activeRematchPlayerIds()).accepted) return;
            } else {
                this.rematchVote.setRequired(this._activeRematchPlayerIds());
            }
            const vote = this.rematchVote.vote(sourceMatchId, playerId, ready);
            if (!vote.accepted || !vote.changed) return;
            if (!this._rematchTimer) {
                this._rematchTimer = setTimeout(() => {
                    this._rematchTimer = null;
                    this.rematchVote.begin(sourceMatchId, this._activeRematchPlayerIds());
                    this._publishRematchState({ expired: true });
                }, 30000);
            }
            const snapshot = this._publishRematchState();
            if (snapshot.complete) this._launchRematch(sourceMatchId);
        };

        this._syncRematchRoster = () => {
            if (!this.network.isHost || this.rematchVote.sourceMatchId !== this.game.matchId) return;
            const snapshot = this.rematchVote.setRequired(this._activeRematchPlayerIds());
            this._publishRematchState();
            if (snapshot.complete) this._launchRematch(this.game.matchId);
        };

        this._requestRematch = () => {
            if (!isTerminalRematchState(this.game.state)) return;
            const sourceMatchId = this.game.matchId;
            if (!isSafeMatchId(sourceMatchId) || this._rematchStarting) return;
            const rematchMetrics = Number.isFinite(this._analyticsPostgameReadyAt)
                ? { postgameToRematchSec: Math.max(0, (Date.now() - this._analyticsPostgameReadyAt) / 1000) }
                : {};
            this.productAnalytics.track('rematch_click', {
                networkRole: this.network.isHost ? 'host' : this.network.connected ? 'client' : 'solo',
                ...(sourceMatchId.length <= 40 ? { source: sourceMatchId } : {})
            }, rematchMetrics);
            if (!this.network.connected) {
                this._startRematchMatch(createMatchId(), sourceMatchId);
                return;
            }
            this.network.sendRematchReady(sourceMatchId, true);
            if (!this.network.isHost) {
                this._updateRematchUI({
                    sourceMatchId,
                    requiredPlayerIds: [],
                    readyPlayerIds: [this.network.playerId]
                });
            }
        };

        this.network.onRematchReady = payload => this._receiveRematchReady(payload);
        this.network.onRematchState = data => {
            if (data.sourceMatchId === this.game.matchId) this._updateRematchUI(data);
        };
        this.network.onRematchStart = data => {
            if (data.sourceMatchId !== this.game.matchId || !isSafeMatchId(data.matchId)) return;
            this._rematchStarting = true;
            this._updateRematchUI(data);
            this.game.startGameFromNetwork(data);
        };

        bind('btn-start-game', async () => {
            if (this.network.connected && !this.isLobbyHost()) {
                this.ui.showMessage?.('Only host can start', 1500);
                return;
            }
            const startButton = document.getElementById('btn-start-game');
            if (startButton?.disabled) return;
            if (startButton) startButton.disabled = true;
            this.audio.init();
            const requestedAt = performance.now();
            this._matchLaunchTiming = { requestedAt };
            const matchLoadElapsedMs = await this._showMatchLoading(950);
            this._matchLaunchTiming.matchLoadElapsedMs = matchLoadElapsedMs;
            this._matchLaunchTiming.setupStartedAt = performance.now();
            const started = this.game.startGame();
            if (started === false) {
                this._matchLaunchTiming = null;
                if (startButton) startButton.disabled = false;
                return;
            }
            // Late join is a supported feature (shouldQueueLateJoin / handleLateJoin /
            // _enterLateJoinSpectator), so an in-progress lobby MUST stay in the registry.
            // This used to unregister it and kill the keep-alive here, which deleted every
            // started match from the lobby browser — the real reason "join later" never
            // worked, and why a host that quits mid-match left a stale record behind
            // (_lobbyCode was nulled, so beforeunload/leaveLobby had nothing to delete).
            // Keep-alive keeps running; just refresh the record with the live player count.
            if (this._lobbyCode && this.network?.isHost) {
                this._registerLobby(
                    this._lobbyCode,
                    this._lobbyName || 'Lobby',
                    this.network.connections.size + 1,
                    this.arena?.config?.name || 'Unknown',
                    this.game.mode?.name || 'Classic'
                );
            }
            this.player.lock();
            this.ui.updateContractTracker(Daily, this.store);
            if (this.network.connected && this.network.isHost) {
                this.network.broadcastGameStart(this.game.snapshotState());
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
            this.party = setPartyReady(this.party, this.game.playerName, ready);
            this._saveSocialProfile();
            if (this.network?.connected) this.network.broadcast({ type: 'partyReady', name: this.game.playerName, ready });
            this.game.broadcastSystemMessage(`${this.game.playerName} is ${ready ? 'READY' : 'not ready'}`);
        });

bind('btn-add-bot-red', () => {
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can manage bots.', 1400);
        return;
    }
    this.game.addBot('red');
            this.broadcastLobbyState();
        });

bind('btn-add-bot-blue', () => {
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can manage bots.', 1400);
        return;
    }
    this.game.addBot('blue');
            this.broadcastLobbyState();
        });

bind('btn-remove-bot', () => {
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can manage bots.', 1400);
        return;
    }
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
        // instead of waiting for the server TTL, and drop the P2P peer.
        window.addEventListener('beforeunload', () => {
            this._stopHostCheckpointLifecycle();
            if (this.network?.isHost && this._lobbyCode) {
                try {
                    // sendBeacon only supports POST → server'un POST /api/lobbies/:code
                    // handler'ı lobby'yi tek seferde siler.
                    const url = `/api/lobbies/${encodeURIComponent(this._lobbyCode)}`;
                    fetch(url, {
                        method: 'DELETE',
                        keepalive: true,
                        headers: { Authorization: `Bearer ${account.getToken()}` }
                    });
                } catch (e) {}
            }
            try {
                // Host: closeLobby() messages survivors first (close for 1v1, migrate
                // for 2v2+) instead of just vanishing like a crash (P2P_HOST_FIXES #1).
                if (this.network?.isHost) this.network.closeLobby();
                else this.network?.disconnect?.();
            } catch (e) {}
        });

        // Game over
        bind('btn-play-again', () => {
            this._requestRematch();
        });
        bind('btn-match-result-rematch', () => this._requestRematch());

        bind('btn-main-menu', () => {
            this.awardMatchRewards();
            this.game.cancelPreGame?.();
            this._stopHostCheckpointLifecycle();
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
        window._postGameDropAction = drop => {
            if (drop?.type === 'case' && CASES[drop.id]) {
                this.ui.showScreen('shop');
                this.ui.renderShop(this.store, 'cases');
                this.shopShowcase?.start();
                requestAnimationFrame(() => document.querySelector(`.case-select[data-id="${drop.id}"]`)?.click());
            } else if (drop?.type === 'card' && ARENA_CARDS[drop.id]) {
                this.ui.renderCharacterSelect(this.store);
                this.ui.renderLockerInventory(this.store);
                this._renderCardCollection();
                this.ui.setLockerTab('cards');
                this.ui.showScreen('character');
                requestAnimationFrame(() => document.querySelector(`[data-card-id="${drop.id}"]`)?.focus?.({ preventScroll: true }));
            }
        };
        window._postGameAction = (action) => {
            if (action === 'play_again') {
                this._requestRematch();
            } else if (action === 'lobby') {
                clearTimeout(this._rematchTimer);
                this.awardMatchRewards();
                this.game.ball.deactivate();
                if (this.game.affixes) this.game.affixes.clearRound();
                // Clear old bots, then re-init lobby via the same path as Play Solo
                this.game.bots.forEach(b => b.remove());
                this.game.bots = [];
                this.game.botCounter = 0;
                this.ui.setPlayerTarget(false);
                this.game.startSolo();
                this._armFirstSoloBotGuard();
                this.ui.showScreen('lobby');
                this.player.unlock();
                this.refreshMetaStats();
            } else if (action === 'main_menu') {
                clearTimeout(this._rematchTimer);
                this.awardMatchRewards();
                this._stopHostCheckpointLifecycle();
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
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can change the map.', 1400);
        return;
    }
    const keys = this.game.getSelectableMaps();
            this.carouselIndex = (this.carouselIndex - 1 + keys.length) % keys.length;
            this.game.selectMap(keys[this.carouselIndex]);
            this.updateCarousel();
            updateCSLobbyInfo();
        });
bind('carousel-next', () => {
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can change the map.', 1400);
        return;
    }
    const keys = this.game.getSelectableMaps();
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
            document.dispatchEvent(new CustomEvent('warrball:theme', { detail: { theme } }));
        });
        this.themeSwatches = initThemeSwatches(document);
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
        // Settings-modal extras (master volume/mute, invert-Y, killfeed toggle) —
        // wiring + persistence live in js/settings-controller.js#initSettingsExtras;
        // this just hands it the live instances. Registered after the music/sound
        // volume bindSetting calls above so its own secondary listeners on those
        // same sliders see the already-updated store values.
        initSettingsExtras({ store: this.store, audio: this.audio, game: this.game, player: this.player });
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
        bindAccessibility('setting-auto-quality', 'autoQuality');
        bindAccessibility('setting-public-diagnostics', 'publicDiagnostics');
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
            this.audio.playCue('settings-apply');
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
        const voiceToggle = document.getElementById('setting-voice-chat');
        if (voiceToggle) {
            voiceToggle.addEventListener('change', event => {
                this.store.set('voiceChatEnabled', event.target.checked);
                if (!event.target.checked) this.voice.disable();
            });
        }
        const voiceMuteToggle = document.getElementById('setting-voice-mute');
        if (voiceMuteToggle) {
            voiceMuteToggle.addEventListener('change', event => {
                this.store.set('voiceMuted', event.target.checked);
                this.voice.setMuted(event.target.checked);
            });
        }
        const netcodeToggle = document.getElementById('setting-experimental-netcode');
        if (netcodeToggle) {
            netcodeToggle.addEventListener('change', event => {
                const config = normalizeNetcode({
                    ...this.store.get('experimentalNetcode'),
                    enabled: event.target.checked
                });
                this.store.set('experimentalNetcode', config);
                this.game.experimentalNetcode = config;
                this.ui.showMessage?.(`Experimental netcode ${config.enabled ? 'enabled' : 'disabled'}.`, 1500);
            });
        }

const updateCSLobbyInfo = () => {
            const mapEl = document.getElementById('cs-lobby-map');
            const modeEl = document.getElementById('cs-lobby-mode');
    const host = this.isLobbyHost();
    document.getElementById('lobby-screen')?.classList.toggle('lobby-client', !host);
    if (mapEl) mapEl.textContent = this.arena?.config?.name || 'Beach';
    if (modeEl) modeEl.textContent = this.game?.mode?.name || 'Classic';
    const modifierSelect = document.getElementById('match-modifier');
    modifierSelect?.querySelectorAll('option[value^="ffa_"]').forEach(option => {
        option.disabled = !this.game?._ffa;
    });
    if (modifierSelect) modifierSelect.value = this.game.matchModifier || 'none';
    document.querySelectorAll('.mode-btn').forEach(button => {
        const selected = button.dataset.mode === this.game?.mode?.id;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = !host;
    });
    const keys = this.game.getSelectableMaps();
    const selectedMapIndex = keys.indexOf(this.arena?.mapId);
    if (selectedMapIndex >= 0) this.carouselIndex = selectedMapIndex;
    this.updateCarousel();
    if (host && this._lobbyCode) {
        this._registerLobby(
            this._lobbyCode,
            this._lobbyName || 'Lobby',
            this.network?.connections.size + 1 || 1,
            this.arena?.config?.name || 'Unknown',
            this.game?.mode?.name || 'Classic'
        );
    }
};

bind('btn-random-map', () => {
    if (!this.isLobbyHost()) {
        this.ui.showMessage?.('Only the lobby host can change the map.', 1400);
        return;
    }
            const keys = this.game.getSelectableMaps();
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
        if (!this.isLobbyHost()) {
            this.ui.showMessage?.('Only the lobby host can change the mode.', 1400);
            updateCSLobbyInfo();
            return;
        }
                this.game.selectMode(btn.dataset.mode);
                this.applyLoadout();
                this.game.selectMode(this.game.mode.id);
                updateCSLobbyInfo();
            });
});
document.getElementById('match-modifier')?.addEventListener('change', event => {
    if (!this.isLobbyHost()) {
        event.target.value = this.game.matchModifier || 'none';
        return;
    }
    this.game.setMatchModifier(event.target.value);
});
this.game.onModeChange = updateCSLobbyInfo;
this.game.onMapChange = updateCSLobbyInfo;
updateCSLobbyInfo();
        this.initCarousel();

        // Karakter kart tıklama
        document.addEventListener('click', async e => {
            const cardEquip = e.target.closest('.card-equip');
            if (cardEquip) {
                const equipped = await this.store.equipCardRemote(cardEquip.dataset.cardId, cardEquip.dataset.slot);
                if (!equipped) {
                    this.ui.showMessage?.('Earn this card from an Arena Cache first.', 1800);
                    return;
                }
                const card = ARENA_CARDS[cardEquip.dataset.cardId];
                this.productAnalytics.track('card_equipped', { itemId: card.id, itemType: card.rarity, result: card.slot });
                this.applyLoadout();
                this.game.selectMode(this.game.mode.id);
                this._renderCardCollection();
                this.ui.renderCharacterSelect(this.store);
                this.ui.showMessage?.(`${card.name} equipped for casual and Arcade. Ranked stays normalized.`, 2600);
                return;
            }
            const lockerTab = e.target.closest('[data-locker-tab]');
            if (lockerTab && lockerTab.closest('#character-screen')) {
                const tab = this.ui.setLockerTab(lockerTab.dataset.lockerTab);
                if (tab === 'inventory') this.ui.renderLockerInventory(this.store);
                if (tab === 'cards') this._renderCardCollection();
                document.querySelector(`[data-locker-panel="${tab}"]`)?.focus?.({ preventScroll: true });
                return;
            }
            const cardTradeup = e.target.closest('#btn-card-tradeup');
            if (cardTradeup) {
                const cardId = document.getElementById('card-tradeup-select')?.value;
                const card = ARENA_CARDS[cardId];
                const result = card && await this.store.tradeUpCardsRemote(Array(5).fill(cardId));
                if (!result) {
                    this.ui.showMessage?.('You need five duplicate non-legendary cards.', 2000);
                    return;
                }
                this.productAnalytics.track('card_trade_up', { itemId: result.reward.id, itemType: result.reward.rarity, result: card.rarity });
                this._renderCardCollection();
                this.ui.renderCharacterSelect(this.store);
                this.ui.showMessage?.(`Trade-up complete: ${result.reward.name}!`, 3200);
                return;
            }
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
                this.audio.playCue('equip-change');
            }
            const skillCard = e.target.closest('.skill-card');
            if (skillCard) {
                const skillId = skillCard.dataset.skill;
                if (!this.store.ownsSkill(skillId)) {
                    this.ui.showMessage?.('Abilities are earned from Arena Cache cards in Locker.', 2200);
                    return;
                }
                document.querySelectorAll('.skill-card').forEach(c => c.classList.remove('selected'));
                skillCard.classList.add('selected');
            }
            const runeCard = e.target.closest('.rune-card');
            if (runeCard) {
                const runeId = runeCard.dataset.rune;
                if (!this.store.owns(runeId)) {
                    this.ui.showMessage?.('Passive runes are earned from Arena Cache cards in Locker.', 2200);
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
            const liveOfferBtn = e.target.closest('.live-offer-buy');
            if (liveOfferBtn) {
                const ok = await this.store.purchaseLiveOffer(liveOfferBtn.dataset.offerId);
                if (ok) {
                    this.productAnalytics.track('shop_purchase_success', { itemType: 'live_offer', itemId: liveOfferBtn.dataset.offerId });
                    this.ui.showMessage?.('Live deal purchased!');
                    await this.store.refreshLiveMarket();
                    this.ui.renderShop(this.store, 'live');
                    this.refreshMetaStats();
                } else {
                    this.productAnalytics.track('shop_purchase_failure', { itemType: 'live_offer', itemId: liveOfferBtn.dataset.offerId, reason: 'unavailable' });
                    this.ui.showMessage?.('Live deal is unavailable, owned, or you need more coins.');
                }
                return;
            }
            const buyBtn = e.target.closest('.shop-buy');
            if (buyBtn) {
                const type = buyBtn.dataset.type;
                const id = buyBtn.dataset.id;
                if (type === 'boost') {
                    const ok = this.store.buyAndActivateXpBoost();
                    this.productAnalytics.track(ok ? 'shop_purchase_success' : 'shop_purchase_failure', {
                        itemType: 'boost', itemId: id, reason: ok ? 'success' : 'unavailable'
                    });
                    this.ui.showMessage?.(ok ? '1.5x XP boost active for 1 hour!' : 'Not enough coins or boost active!');
                    this.ui.renderShop(this.store, 'boosts');
                    this.refreshMetaStats();
                    return;
                }
                const kind = type === 'char' ? 'character' : type;
                const ok = await this.store.purchase(kind, id);
                if (ok) {
                    this.productAnalytics.track('shop_purchase_success', { itemType: type, itemId: id });
                    this.ui.showMessage?.('Purchased!');
                    const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                    if (type === 'avatar') this.ui._shopPreviewAvatar = id;
                    if (type === 'char') this.ui._shopPreviewCharacter = id;
                    this.ui.renderShop(this.store, activeTab);
                    if (type === 'avatar' && AVATAR_SKINS[id]) this.ui._setShopShowcase(this.store, AVATAR_SKINS[id], true, true);
                    if (type === 'char' && CHARACTERS[id]) this.ui._setShopCharacterDetail(this.store, CHARACTERS[id], true);
                    this.refreshMetaStats();
                } else {
                    this.productAnalytics.track('shop_purchase_failure', { itemType: type, itemId: id, reason: 'unavailable' });
                    this.ui.showMessage?.('Not enough coins or owned!');
                }
            }
            const skillEquip = e.target.closest('.skill-equip');
            if (skillEquip) {
                const skillId = skillEquip.dataset.id;
                const loadout = { ...this.store.get('loadout'), skill: skillId };
                const equipped = this.store.setLoadout(loadout);
                if (equipped) this.player.loadout.skill = skillId;
                this.ui.showMessage?.(equipped ? 'Skill equipped.' : 'Unlock this skill first.');
                this.ui.renderShop(this.store, 'skills');
                return;
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
            const cosmeticClear = e.target.closest('.cosmetic-clear');
            if (cosmeticClear) {
                this.store.clearCosmeticSlot(cosmeticClear.dataset.type);
                await this._syncWearableLoadout();
                this.ui.renderShop(this.store, 'wearables');
                this.ui.showMessage?.('Cosmetic removed.');
                return;
            }
            const wearableInspect = e.target.closest('.wearable-inspect');
            if (wearableInspect) {
                const cosmetic = COSMETICS[wearableInspect.dataset.id];
                if (cosmetic && typeof CustomEvent !== 'undefined') {
                    const fromLocker = Boolean(wearableInspect.closest('#character-screen'));
                    if (!fromLocker) return;
                    this.ui.showScreen('shop');
                    this.ui.renderShop(this.store, 'wearables');
                    this.shopShowcase?.start();
                    window.dispatchEvent(new CustomEvent('warrball:shop-preview', {
                        detail: { type: 'cosmetic', id: cosmetic.id, cosmetic, source: 'locker' }
                    }));
                }
                return;
            }
            // Equip ball from shop
            const equipBtn = e.target.closest('.shop-equip');
            if (equipBtn) {
                const ballId = equipBtn.dataset.id;
                const itemType = equipBtn.dataset.type || 'ball';
                let equippedForAnalytics = true;
                if (equipBtn.dataset.type === 'cosmetic') {
                    const ok = this.store.equipCosmetic(ballId);
                    equippedForAnalytics = ok;
                    this.ui.showMessage?.(ok ? 'Cosmetic equipped!' : 'This cosmetic cannot be equipped.');
                    if (ok) await this._syncWearableLoadout();
                } else if (equipBtn.dataset.type === 'avatar') {
                    const avatarSkin = AVATAR_SKINS[ballId];
                    equippedForAnalytics = Boolean(avatarSkin) && this.store.equipAvatarSkin(ballId);
                    if (equippedForAnalytics) {
                        this.initAvatarPainter();
                        this.avatarPainter?.applyPreset(ballId);
                    }
                    this.ui.showMessage?.(equippedForAnalytics ? `🎨 Equipped: ${avatarSkin.name}!` : 'This character skin is not owned.');
                } else if (equipBtn.dataset.type === 'char' && CHARACTERS[ballId]) {
                    equippedForAnalytics = this.store.setLoadout({ ...this.store.get('loadout'), char: ballId });
                    this.applyLoadout();
                    this.game.selectMode(this.game.mode.id);
                    this.ui.showMessage?.(`Using ${CHARACTERS[ballId].name}.`);
                } else {
                    equippedForAnalytics = this.store.equipBall(ballId);
                    if (equippedForAnalytics) this.game.ball.setSkin(ballId);
                    this.ui.showMessage?.(equippedForAnalytics ? `🎾 Equipped: ${BALL_SKINS[ballId].name}!` : 'This ball skin is not owned.');
                }
                const activeTab = document.querySelector('.shop-tab.selected')?.dataset.tab || 'chars';
                if (equippedForAnalytics) this.productAnalytics.track('cosmetic_equip', { itemType, itemId: ballId });
                if (equipBtn.closest('#character-screen')) this.ui.renderLockerInventory(this.store);
                else this.ui.renderShop(this.store, activeTab);
                this.refreshMetaStats();
            }
            const ballInspect = e.target.closest('.ball-inspect');
            if (ballInspect) {
                const card = ballInspect.closest('.ball-skin, .inventory-card');
                const inspecting = card?.classList.toggle('inspecting') === true;
                ballInspect.setAttribute('aria-pressed', String(inspecting));
                const skin = BALL_SKINS[ballInspect.dataset.id];
                const stage = card?.querySelector('.ball-inspect-stage, .inventory-icon-area');
                // Model skins (shuriken / baseball / blockball / dark eater) are only
                // distinguishable as geometry, so inspect spins the real mesh for them.
                if (skin?.shape && stage) {
                    if (inspecting) this._renderCosmeticPreview(stage, skin, () => this._buildBallPreviewModel(skin));
                    else this._disposeCosmeticPreview(stage);
                    ballInspect.textContent = inspecting ? 'Stop 3D preview' : 'Inspect in 3D';
                } else {
                    ballInspect.textContent = inspecting ? 'Stop preview' : 'Inspect trail';
                }
                // The shop's persistent status/detail panel already announces this
                // selection. A second toast used to overlap the catalog heading.
                if (!ballInspect.closest('#shop-grid')) {
                    this.ui.showMessage?.(inspecting ? `${skin?.name || 'Ball'} preview` : 'Preview stopped', 1100);
                }
            }
            // Battlepass claim
            const claimBtn = e.target.closest('.bp-claim');
            if (claimBtn) {
                const tier = parseInt(claimBtn.dataset.tier);
                const track = claimBtn.dataset.track === 'premium' ? 'premium' : 'free';
                const reward = await this.store.claimBattlepassReward(tier, track);
                if (reward) {
                    const displayReward = getBattlepassRewardEntry(tier, track) || reward;
                    this.productAnalytics.track('battlepass_reward_claimed', {
                        itemId: displayReward.id,
                        itemType: track,
                        source: 'battlepass'
                    });
                    this.ui.showMessage?.(`Claimed: ${displayReward.name || 'Battle Pass reward'}!`);
                    this.ui.renderBattlepass(this.store);
                    this.refreshMetaStats();
                } else if (this.store.lastBattlepassError) {
                    this.ui.showMessage?.(this.store.lastBattlepassError);
                }
            }
            const bpBoostBtn = e.target.closest('.bp-boost-activate');
            if (bpBoostBtn && bpBoostBtn.dataset.boostId) {
                const boostId = bpBoostBtn.dataset.boostId;
                bpBoostBtn.disabled = true;
                const activation = await this.store.activateBattlepassBoost(boostId);
                if (activation.ok) {
                    if (!activation.replayed) {
                        this.productAnalytics.track('battlepass_boost_activated', {
                            itemId: boostId,
                            source: 'battlepass'
                        });
                    }
                    const multiplier = Number(activation.activeBoost?.multiplier || 1)
                        .toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
                    this.ui.showMessage?.(`${multiplier}x Battle Pass XP boost activated!`);
                } else {
                    this.ui.showMessage?.(activation.error || this.store.lastBattlepassError || 'Battle Pass boost unavailable');
                }
                this.ui.renderBattlepass(this.store);
                this.refreshMetaStats();
                return;
            }
            // Battlepass premium track unlock
            const bpPremiumBtn = e.target.closest('.bp-premium-buy');
            if (bpPremiumBtn) {
                const bought = await this.store.buyPremiumBattlepass();
                if (bought) {
                    this.productAnalytics.track('battlepass_premium_unlocked', { source: 'soft_currency' });
                    this.ui.showMessage?.('Premium Battle Pass unlocked!');
                    this.ui.renderBattlepass(this.store);
                    this.refreshMetaStats();
                } else {
                    this.ui.showMessage?.(this.store.lastBattlepassError || 'Not enough coins for Premium Battle Pass');
                }
            }
            // Daily challenge claim
            const dailyClaim = e.target.closest('.daily-claim');
            if (dailyClaim) {
                // ponytail: store.claimDailyChallenge tek giris noktasi — coin + battlepass
                // XP'yi birlikte verir, kendi icinde idempotent (Daily.claim bayragi guard).
                // Remote accounts await the server receipt; only guest mode
                // reaches Daily's persisted local idempotency guard.
                const reward = await this.store.claimDailyChallenge(dailyClaim.dataset.id);
                if (reward) {
                    if (this.store.remoteReady && reward.replayed !== true) {
                        this.productAnalytics.track('daily_challenge_claimed', { itemId: dailyClaim.dataset.id, source: 'account_daily' });
                    }
                    this.ui.showMessage?.(reward.xpGranted > 0
                        ? `Claimed: +${reward.coins} coins, +${reward.xpGranted} Battle Pass XP!`
                        : `Claimed: +${reward.coins} coins.`);
                    this.ui.renderDaily(Daily, this.store);
                    this.ui.renderBattlepass?.(this.store);
                    this.refreshMetaStats();
                } else {
                    this.ui.showMessage?.(this.store.lastDailyChallengeError || 'Daily challenge is not ready to claim.');
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
                    this._armFirstSoloBotGuard();
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
                if (tabBtn.dataset.tab === 'live') {
                    void this.store.refreshLiveMarket().then(() => this.ui.renderShop(this.store, 'live'));
                }
            }
            const caseClose = e.target.closest('#case-inspector-close');
            if (caseClose || (e.target.id === 'case-inspector')) {
                document.getElementById('case-inspector')?.classList.add('hidden');
                this.ui._closeExclusive('caseInspector');
                return;
            }
            const caseSelect = e.target.closest('.case-select');
            if (caseSelect) {
                const box = CASES[caseSelect.dataset.id];
                if (!box) return;
                const balance = Number(this.store.get('currency')) || 0;
                const pity = this.store.getCasePityState(box.id);
                const earned = this.store.getEarnedCaseState?.(box.id)?.cases || 0;
                const rates = getCaseDropRates(box.id);
                const inspector = document.getElementById('case-inspector');
                const art = document.getElementById('case-inspector-art');
                const open = document.getElementById('case-inspector-open');
                if (art) {
                    art.src = box.art;
                    art.alt = `${box.name} crate`;
                }
                document.getElementById('case-inspector-title').textContent = box.name;
                document.getElementById('case-inspector-meta').textContent = earned
                    ? 'You earned this opening by completing matches. Confirm to reveal it free.'
                    : 'Confirm to purchase, then the case reel starts.';
                document.getElementById('case-inspector-balance').textContent = `${balance} credits`;
                document.getElementById('case-inspector-pity').textContent = pity.nextGuaranteed
                    ? 'Next open'
                    : `${pity.count}/${pity.threshold}`;
                document.getElementById('case-inspector-earned').textContent = earned ? `${earned} free` : 'None';
                const ratesEl = document.getElementById('case-inspector-rates');
                if (ratesEl) {
                    const totals = rates.reduce((acc, entry) => ({ ...acc, [entry.rarity]: (acc[entry.rarity] || 0) + entry.chance }), {});
                    ratesEl.innerHTML = `<small>VERIFIED DROP RATES</small>${['rare', 'epic', 'legendary'].filter(rarity => totals[rarity]).map(rarity => `<span class="rarity-${rarity}">${rarity} <b>${(totals[rarity] * 100).toFixed(1)}%</b></span>`).join('')}`;
                }
                if (open) {
                    open.dataset.id = box.id;
                    open.disabled = false;
                    open.lastChild.textContent = earned ? `Open earned case (${earned})` : `Open for ${box.price} credits`;
                }
                inspector?.classList.remove('hidden');
                this.ui._openExclusive('caseInspector', () => { document.getElementById('case-inspector')?.classList.add('hidden'); });
                open?.focus();
                return;
            }
            const caseOpen = e.target.closest('#case-inspector-open');
            if (caseOpen) {
                const box = CASES[caseOpen.dataset.id];
                if (!box || caseOpen.disabled) return;
                await this._openShopCase(box, caseOpen);
                return;
            }
            const knifeBtn = e.target.closest('.knife-equip');
            if (knifeBtn) {
                const ok = this.store.equipKnife(knifeBtn.dataset.id, knifeBtn.dataset.team);
                if (ok && knifeBtn.dataset.team === this.player.team) {
                    const custom = migrateCosmeticLoadout(this.store.get('cosmeticLoadout'));
                    custom.knife.id = knifeBtn.dataset.id;
                    this.store.set('cosmeticLoadout', normalizeCosmeticLoadout(custom));
                    this.player.knifeId = knifeBtn.dataset.id;
                    this.player.setKnifeStyle?.(this._getKnifeStyle(knifeBtn.dataset.id));
                }
                this.ui.showMessage?.(ok ? `Equipped for ${knifeBtn.dataset.team.toUpperCase()}` : 'This knife cannot be equipped.');
                if (ok) this.audio.playCue('equip-change');
                this.ui.renderLockerInventory(this.store);
                return;
            }
            const inspectBtn = e.target.closest('.knife-inspect');
            if (inspectBtn) {
                const card = inspectBtn.closest('.inventory-card');
                card?.classList.toggle('inspecting');
                this._renderCosmeticPreview(card?.querySelector('.knife-preview'), this._getKnifeStyle(inspectBtn.dataset.id));
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

        // Mouse wheel — spectator zoom / dead-team camera zoom
        document.addEventListener('wheel', e => {
            if (Spectator.active) {
                Spectator.handleWheel(e);
            } else if (!this.player.alive && this.game._spectateTarget) {
                const view = this._deadSpectateView ||= { distance: 0.5, yaw: null, pitch: 0 };
                view.distance = Math.max(0.5, Math.min(14, view.distance + Math.sign(e.deltaY) * 1.15));
                e.preventDefault();
            }
        }, { passive: false });

        // Click to lock pointer during game (not when pause/settings open)
        const gameContainer = document.getElementById('game-container');
        gameContainer.addEventListener('click', () => {
            if ((this.game.state !== STATES.PLAYING
                && this.game.state !== STATES.CELEBRATION
                && this.game.state !== STATES.COSMETIC_PRACTICE
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
        const headers = { ...(options.headers || {}) };
        if (account.getToken()) headers.Authorization = `Bearer ${account.getToken()}`;
        return fetch(path, { ...options, headers }).then(response => response.json()).catch(() => ({}));
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
            this._appendSocialLobbyChat('WARRBALL', `${name} entered the hub.`, true);
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

    _enterSocialLobby(mapId = this._socialHubMapId || SOCIAL_HUB_MAP_ID, { autoLock = true } = {}) {
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
            sunIntensity: this.renderer.sun?.intensity,
            exposure: this.renderer.renderer.toneMappingExposure,
            handVisible: this.player.armGroup?.visible === true
        };
        if (this.renderer.sun) this.renderer.sun.intensity = 0.9;
        this.renderer.renderer.toneMappingExposure = 0.9;
        this.renderer.renderer.setClearColor(0x8ed8f3);
        this.renderer.setHubPerformance?.(true);
        if (this.renderer.scene.fog) {
            this.renderer.scene.fog.color.set(0xc6ddef);
            this.renderer.scene.fog.near = 170;
            this.renderer.scene.fog.far = 720;
        }
        this.ui.hideAll();
        document.getElementById('social-lobby-hud')?.classList.remove('hidden');
        document.body.classList.add('social-hub-active');
        this.game.setState(STATES.SOCIAL_HUB);
        this.player.setHandTemporarilyVisible(false);
        const map = this.socialLobby.selectMap(mapId);
        this.socialLobby.enter(undefined, map.id);
        const status = document.getElementById('social-lobby-status');
        if (status) status.textContent = `Loading ${map.name}...`;
        const mapTitle = document.getElementById('social-lobby-map-title');
        if (mapTitle) mapTitle.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#i-map"></use></svg> ${map.name.toUpperCase()} MAP`;
        const mapCredit = document.getElementById('social-lobby-map-credit');
        if (mapCredit) mapCredit.textContent = map.credit;
        this.socialLobby.loadAssets().then(() => {
            if (!this.socialLobby.active || !status) return;
            status.textContent = `${map.name} - public room active`;
        });
        this._appendSocialLobbyChat('WARRBALL', `Welcome to ${map.name}. Explore and chat with the room.`, true);
        if (autoLock) this.player.lock();
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
            if (this.renderer.sun && Number.isFinite(this._hubVisualState.sunIntensity)) {
                this.renderer.sun.intensity = this._hubVisualState.sunIntensity;
            }
            if (Number.isFinite(this._hubVisualState.exposure)) {
                this.renderer.renderer.toneMappingExposure = this._hubVisualState.exposure;
            }
            this.player.setHandTemporarilyVisible(this._hubVisualState.handVisible);
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
        const state = getSocialLobbyMapState(this.player, presence);
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
        const dashActive = this.player._justDashed || this.player.dashTimer > 0;
        const movementState = this.player.longJumpEvent || (this._longJumpTrack && !this.player.onGround)
            ? 'LONGJUMP'
            : dashActive
                ? 'DASH'
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
        this.ui._openExclusive('emoteWheel', () => this.closeEmoteWheel());
        this.player.unlock();
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        this.game.emotes.showWheel({ x: cx, y: cy });
        this.game.emotes.onEmoteSelect = (emoteId) => {
            this.game.showEmote(this.player, emoteId);
            this.closeEmoteWheel();
        };
    }

    closeEmoteWheel() {
        if (!this.game.emotes.wheelOpen) return;
        // Seçilmediyse kapat, seçildiyse showEmote çağrıldı
        this.game.emotes.hideWheel();
        this.ui._closeExclusive('emoteWheel');
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
            this._updateAvatar3DStage();
        };
        this.avatarPainter.onchange = updatePreview;
        updatePreview(); // initial render
        // 2D/3D preview toggle -- 3D reuses ShopShowcaseRenderer through the same public API
        // as the shop/menu hero (sync/setHeadTexture/setPartColors), so there is no second
        // renderer path (MIMO.md convention).
        const stage3dEl = document.getElementById('avatar-3d-stage');
        const btn2d = document.getElementById('btn-avatar-mode-2d');
        const btn3d = document.getElementById('btn-avatar-mode-3d');
        const previewWrap = document.querySelector('.avatar-preview-wrap');
        const setPreviewMode = mode => {
            this._avatarPreviewMode = mode;
            if (previewWrap) previewWrap.dataset.mode = mode;
            if (preview) preview.hidden = mode !== '2d';
            if (stage3dEl) stage3dEl.hidden = mode !== '3d';
            btn2d?.classList.toggle('selected', mode === '2d');
            btn2d?.setAttribute('aria-pressed', String(mode === '2d'));
            btn3d?.classList.toggle('selected', mode === '3d');
            btn3d?.setAttribute('aria-pressed', String(mode === '3d'));
            if (mode === '3d' && this._ensureAvatar3DStage()) {
                this.avatarStage3D.start();
                this._updateAvatar3DStage();
            } else {
                this.avatarStage3D?.stop();
            }
        };
        if (btn2d && !btn2d.dataset.avatarBound) {
            btn2d.dataset.avatarBound = 'true';
            btn2d.addEventListener('click', () => setPreviewMode('2d'));
        }
        if (btn3d && !btn3d.dataset.avatarBound) {
            btn3d.dataset.avatarBound = 'true';
            btn3d.addEventListener('click', () => setPreviewMode('3d'));
        }
        setPreviewMode(this._avatarPreviewMode || '2d');
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
        // Preset strip -- click a preset to apply it as a starting point (team-tinted atlas,
        // still fully editable with the paint tools above).
        const presetStrip = document.getElementById('avatar-preset-strip');
        if (presetStrip) {
            presetStrip.replaceChildren(...SKIN_PRESET_IDS.map(id => {
                const meta = SKIN_PRESETS[id];
                const card = document.createElement('button');
                card.type = 'button';
                card.setAttribute('role', 'listitem');
                card.className = `avatar-preset-card${this.avatarPainter.presetId === id ? ' selected' : ''}`;
                const thumb = document.createElement('canvas');
                thumb.className = 'avatar-preset-thumb';
                thumb.width = 40;
                thumb.height = 40;
                const thumbCtx = thumb.getContext('2d');
                thumbCtx.imageSmoothingEnabled = false;
                for (let y = 0; y < 8; y++) {
                    for (let x = 0; x < 8; x++) {
                        const color = meta.face[y * 8 + x];
                        if (color) {
                            thumbCtx.fillStyle = color;
                            thumbCtx.fillRect(x * 5, y * 5, 5, 5);
                        }
                    }
                }
                const label = document.createElement('b');
                label.textContent = meta.name;
                const tag = document.createElement('small');
                tag.textContent = meta.theme === 'themed' ? 'Themed' : 'Expression';
                card.append(thumb, label, tag);
                card.addEventListener('click', () => {
                    const team = this.game?.player?.team === 'blue' ? 'blue' : 'red';
                    const atlas = renderSkinPreset(id, team);
                    if (!atlas || !this.avatarPainter.applySkinPreset(id, atlas, team)) return;
                    presetStrip.querySelectorAll('.avatar-preset-card').forEach(item => item.classList.remove('selected'));
                    card.classList.add('selected');
                    library?.querySelectorAll('.avatar-skin-card').forEach(item => item.classList.remove('selected'));
                    updatePreview();
                });
                return card;
            }));
        }
    }

    // Lazily creates the avatar editor's live 3D cube-rig preview the first time the user
    // switches to 3D mode -- avoids a second WebGL context while the toggle sits unused.
    _ensureAvatar3DStage() {
        if (this.avatarStage3D) return this.avatarStage3D;
        const canvas = document.getElementById('avatar-3d-canvas');
        if (!canvas) return null;
        try {
            this.avatarStage3D = new ShopShowcaseRenderer(canvas, {
                characterId: this.store.get('selectedChar'),
                skinId: this.avatarPainter?.skinId || 'default',
                autoStart: false,
                // Closer "bust" framing (vs. the full-body shop/menu default) so the painted
                // face is actually legible while editing -- same options.camera override
                // mechanism _initMenuHero() uses, no second renderer path.
                camera: { fov: 34, position: [0, 1.62, 1.85], target: [0, 1.55, 0] }
            });
        } catch (error) {
            this.avatarStage3D = null;
        }
        return this.avatarStage3D;
    }

    // Resolve the one presentation state used by every non-gameplay avatar
    // surface. A saved atlas only wins for its matching base skin inside
    // resolveAvatarAtlas(), so previewing another catalog skin never mutates
    // the stored custom avatar or leaks its pixels onto the wrong product.
    _resolveAvatarPreview(skinId, characterId = this.store.get('selectedChar'), atlasOverride = null) {
        const resolvedSkinId = AVATAR_SKINS[skinId] ? skinId : 'default';
        const resolvedCharacterId = CHARACTERS[characterId] ? characterId : 'rally';
        const hasOverride = Array.isArray(atlasOverride?.pixels) && atlasOverride.pixels.length === 4096;
        const resolvedAtlas = hasOverride
            ? Object.freeze({
                pixels: atlasOverride.pixels,
                modelId: atlasOverride.modelId === 'slim' ? 'slim' : 'classic'
            })
            : resolveAvatarAtlas(resolvedSkinId, this.store.get('customAvatar'));
        return Object.freeze({
            characterId: resolvedCharacterId,
            skinId: resolvedSkinId,
            atlas: resolvedAtlas
        });
    }

    // Applies the canonical presentation state to Shop, Menu, Studio and
    // Cosmetic Practice. `target` is either a ShopShowcaseRenderer or the
    // lightweight createShowcaseAvatar() practice instance; both retain one
    // shared rig implementation and no path writes back into Store.
    _syncAvatarPreview(target, skinId, characterId = this.store.get('selectedChar'), atlasOverride = null) {
        const preview = this._resolveAvatarPreview(skinId, characterId, atlasOverride);
        target?.sync?.({ characterId: preview.characterId, skinId: preview.skinId });
        this._applyAvatarAtlasToRig(target?.avatar?.rig || target?.rig, preview.atlas.pixels, preview.atlas.modelId);
        return preview;
    }

    // Repaints the 3D preview's rig from the painter's live atlas -- the same
    // full-body atlas path as Shop/menu/in-game remote avatars.
    _updateAvatar3DStage() {
        if (!this.avatarStage3D || !this.avatarPainter) return;
        this._syncAvatarPreview(this.avatarStage3D, this.avatarPainter.skinId, this.store.get('selectedChar'), {
            pixels: this.avatarPainter.getAtlasPixels(),
            modelId: AVATAR_SKINS[this.avatarPainter.skinId]?.model
        });
        this.avatarStage3D.resize();
    }

    async refreshWorkshop(mine = false) {
        const grid = document.getElementById('map-workshop-grid');
        const status = document.getElementById('map-workshop-status');
        if (!grid) return;
        this.workshopMine = mine;
        grid.dataset.loaded = '1';
        grid.replaceChildren();
        if (status) status.textContent = mine ? 'Loading your submissions...' : 'Loading approved maps...';
        if (mine && !this.store.remoteReady) {
            await this.store.connectRemote(this.store.get('playerName'));
        }
        const query = document.getElementById('workshop-search')?.value || '';
        const sort = document.getElementById('workshop-sort')?.value || 'trending';
        const result = await this.store.listPublishedMaps({ mine, query, sort, limit: 24 });
        if (result.error) {
            if (status) status.textContent = result.error;
            return;
        }
        document.getElementById('btn-workshop-public')?.setAttribute('aria-pressed', String(!mine));
        document.getElementById('btn-workshop-mine')?.setAttribute('aria-pressed', String(mine));
        if (!result.maps.length) {
            if (status) status.textContent = mine
                ? 'No submissions yet. Publish your first arena.'
                : 'No approved maps match this search.';
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const map of result.maps) {
            const card = document.createElement('article');
            card.className = 'workshop-card';
            card.dataset.status = ['approved', 'pending', 'rejected'].includes(map.status)
                ? map.status
                : 'pending';

            const top = document.createElement('div');
            top.className = 'workshop-card-top';
            const title = document.createElement('h3');
            title.textContent = map.name;
            const badge = document.createElement('span');
            badge.className = 'workshop-status';
            badge.textContent = map.status;
            top.append(title, badge);

            const creator = document.createElement('p');
            creator.className = 'workshop-creator';
            creator.textContent = `by ${map.creatorName} | v${map.revision} | ${map.propCount} props | score ${map.score || 0}`;
            const description = document.createElement('p');
            description.className = 'workshop-description';
            description.textContent = map.description || 'Competitive arena prototype.';
            card.append(top, creator, description);

            if (mine && map.moderationNote) {
                const note = document.createElement('p');
                note.className = 'workshop-note';
                note.textContent = `Review: ${map.moderationNote}`;
                card.append(note);
            }

            const actions = document.createElement('div');
            actions.className = 'workshop-actions';
            if (!mine) {
                const votes = document.createElement('div');
                votes.className = 'workshop-votes';
                for (const [value, label] of [[1, 'Upvote'], [-1, 'Downvote']]) {
                    const vote = document.createElement('button');
                    vote.type = 'button';
                    vote.className = 'btn btn-secondary workshop-vote';
                    vote.dataset.workshopAction = 'vote';
                    vote.dataset.mapId = map.id;
                    vote.dataset.voteValue = String(value);
                    vote.setAttribute('aria-pressed', String(map.viewerVote === value));
                    vote.textContent = value > 0 ? `+ ${map.upvotes || 0}` : `- ${map.downvotes || 0}`;
                    vote.setAttribute('aria-label', `${label} ${map.name}`);
                    votes.append(vote);
                }
                actions.append(votes);
            }
            for (const [action, label] of [['open', 'Open in Editor'], ['play', 'Play Solo']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = action === 'play' ? 'btn btn-primary' : 'btn btn-secondary';
                button.dataset.workshopAction = action;
                button.dataset.mapId = map.id;
                button.dataset.mine = mine ? '1' : '0';
                button.textContent = label;
                actions.append(button);
            }
            card.append(actions);
            fragment.append(card);
        }
        grid.append(fragment);
        if (status) status.textContent = `${result.maps.length} map loaded`;
    }

    async openWorkshopMap(mapId, mine = false, play = false) {
        const status = document.getElementById('map-workshop-status');
        if (status) status.textContent = 'Validating map package...';
        const map = await this.store.getPublishedMap(mapId);
        const validation = map ? validateMapConfig(map.config) : { valid: false, errors: ['Map unavailable'] };
        if (!validation.valid) {
            if (status) status.textContent = validation.errors[0] || 'Unsafe map package';
            return;
        }
        const safe = normalizeMapConfig(validation.config);
        if (play) {
            const id = `workshop-${map.id}`;
            registerCustomMap(id, safe);
            this.arena.rebuild(id);
            this.startPractice();
            return;
        }
        const maps = (this.store.get('customMaps') || []).filter(entry => entry.id !== 'custom-local');
        maps.push({
            id: 'custom-local',
            config: safe,
            publishedId: mine ? map.id : ''
        });
        this.store.set('customMaps', maps.slice(-10));
        registerCustomMap('custom-local', safe);
        this.mapEditor?.setConfig(safe);
        const name = document.getElementById('map-editor-name');
        const width = document.getElementById('map-editor-width');
        const length = document.getElementById('map-editor-length');
        if (name) name.value = safe.name;
        if (width) width.value = safe.dimensions.width;
        if (length) length.value = safe.dimensions.length;
        this.mapEditor?.render();
        if (status) status.textContent = `${safe.name} downloaded to your local editor`;
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
        const workshop = document.getElementById('map-workshop-grid');
        if (workshop && workshop.dataset.loaded !== '1') this.refreshWorkshop(false);
    }

    async _startRankedQueue() {
        if (this._rankedQueueActive) return;
        this._rankedQueueActive = true;
        const overlay = document.getElementById('ranked-queue-overlay');
        overlay?.classList.remove('hidden');
        const startedAt = performance.now();
        const status = document.getElementById('ranked-queue-status');
        try {
            const lobbies = await this._lobbyApi('/api/lobbies', { method: 'GET' });
            if (!this._rankedQueueActive) return;
            const candidates = rankQueueCandidates(lobbies, {
                elo: this.store.getElo(),
                waitedSeconds: (performance.now() - startedAt) / 1000
            });
            if (candidates.length) {
                const match = candidates[0];
                if (status) status.textContent = `${match.eloGap} ELO gap - joining ${match.hostName || 'host'}`;
                this._rankedMatch = { opponentElo: Number(match.averageElo) || this.store.getElo(), queue: 'online' };
                this.game.selectMode('competitive');
                this.applyLoadout();
                this.game.selectMode(this.game.mode.id);
                await this._quickJoin(match.code);
            } else {
                if (status) status.textContent = 'No close match. Creating a ranked room.';
                this._rankedMatch = { opponentElo: this.store.getElo(), queue: 'host' };
                this._rankedHosting = true;
                this.game.selectMode('competitive');
                this.applyLoadout();
                this.game.selectMode(this.game.mode.id);
                await this._doHostGame();
            }
            overlay?.classList.add('hidden');
            if (this._rankedQueueActive) this._openDraftPhase();
        } catch (error) {
            RuntimeLog.log('ranked-queue', { message: String(error?.message || error) });
            overlay?.classList.add('hidden');
            this.ui.showMessage?.('Ranked queue unavailable.', 2200);
        } finally {
            this._rankedQueueActive = false;
        }
    }

    _cancelRankedQueue() {
        this._rankedQueueActive = false;
        document.getElementById('ranked-queue-overlay')?.classList.add('hidden');
    }

    _openDraftPhase() {
        const overlay = document.getElementById('draft-overlay');
        const list = document.getElementById('draft-class-list');
        if (!overlay || !list) return;
        this._draftState = createDraftState([{
            id: 'local',
            name: this.game.playerName,
            team: this.player.team,
            classId: this.player.charId
        }], Object.keys(CHARACTERS));
        this._draftPick = { team: this.player.team, classId: this.player.charId };
        list.replaceChildren(...Object.values(CHARACTERS).map(character => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.draftClass = character.id;
            button.className = `draft-class${character.id === this.player.charId ? ' selected' : ''}`;
            button.innerHTML = `<b>${character.emoji || character.name[0]}</b><span>${character.name}</span><small>${character.maxHp} HP</small>`;
            button.addEventListener('click', () => {
                this._draftPick.classId = character.id;
                list.querySelectorAll('.draft-class').forEach(item => item.classList.toggle('selected', item === button));
                this._refreshDraftConfirm();
            });
            return button;
        }));
        overlay.querySelectorAll('[data-draft-team]').forEach(button => {
            button.classList.toggle('selected', button.dataset.draftTeam === this.player.team);
            button.onclick = () => {
                this._draftPick.team = button.dataset.draftTeam;
                overlay.querySelectorAll('[data-draft-team]').forEach(item => item.classList.toggle('selected', item === button));
                this._refreshDraftConfirm();
            };
        });
        const confirm = document.getElementById('draft-confirm');
        confirm.onclick = () => {
            this._draftState = updateDraftPick(this._draftState, 'local', { ...this._draftPick, ready: true });
            this.game.switchTeam(this._draftPick.team);
            this._changeRoundClass(this._draftPick.classId);
            overlay.classList.add('hidden');
            this.player.unlock();
            this.ui.showMessage?.('Draft locked. Ready for competitive.', 1800);
        };
        this._refreshDraftConfirm();
        overlay.classList.remove('hidden');
        this.player.unlock();
    }

    _refreshDraftConfirm() {
        const confirm = document.getElementById('draft-confirm');
        if (confirm) confirm.disabled = !this._draftPick?.team || !this._draftPick?.classId;
    }

    _saveSocialProfile() {
        this.socialProfile = { ...this.socialProfile, party: this.party };
        this.store.set('socialProfile', this.socialProfile);
    }

    _renderSocialCenter() {
        const me = this.game.playerName || this.store.get('playerName') || 'Player';
        if (!this.party?.members?.some(member => member.name === me)) this.party = createParty(me);
        const party = document.getElementById('community-party-list');
        if (party) party.innerHTML = this.party.members.map(member =>
            `<div class="community-row"><b>${this._esc(member.name)}</b><span class="${member.ready ? 'ready' : ''}">${member.ready ? 'READY' : 'WAITING'}</span></div>`).join('');
        const friends = document.getElementById('community-friend-list');
        if (friends) {
            const makeRow = friend => {
                const row = document.createElement('div'); row.className = 'community-row';
                const label = document.createElement('b'); label.textContent = friend.username;
                const state = document.createElement('span'); state.textContent = Friends.isOnline(friend) ? 'ONLINE' : 'OFFLINE';
                const message = document.createElement('button'); message.className = 'btn btn-small'; message.type = 'button'; message.textContent = 'Message'; message.onclick = () => this._openChatWith(friend.id);
                row.append(label, state, message);
                if (this.network?.isHost && this._lobbyCode) {
                    const invite = document.createElement('button'); invite.className = 'btn btn-small'; invite.type = 'button'; invite.textContent = 'Invite';
                    invite.onclick = async () => { const result = await Friends.createLobbyInvite(this._lobbyCode, friend.id); this.ui.showMessage?.(result.error || 'Lobby invite sent.', 1600); };
                    row.append(invite);
                }
                return row;
            };
            friends.replaceChildren(...(Friends.friends.length ? Friends.friends.map(makeRow) : [Object.assign(document.createElement('p'), { className: 'community-empty', textContent: 'Add a friend by their full friend tag.' })]));
        }
        const ownTag = document.getElementById('community-friend-tag');
        if (ownTag) ownTag.textContent = account.getFriendTag() || 'Loading…';
        const requests = document.getElementById('community-friend-requests');
        if (requests) requests.replaceChildren(...Friends.requests.filter(request => request.status === 'pending' && request.recipientAccountId === account.getAccount()?.id).map(request => {
            const row = document.createElement('div'); row.className = 'community-row';
            const label = document.createElement('b'); label.textContent = `${request.sender?.username || 'Player'} wants to be friends`;
            const accept = document.createElement('button'); accept.className = 'btn btn-small'; accept.textContent = 'Accept'; accept.onclick = () => Friends.actOnRequest(request.id, 'accept');
            const decline = document.createElement('button'); decline.className = 'btn btn-small'; decline.textContent = 'Decline'; decline.onclick = () => Friends.actOnRequest(request.id, 'decline');
            row.append(label, accept, decline); return row;
        }));
        const invites = document.getElementById('community-friend-invites');
        if (invites) invites.replaceChildren(...Friends.invites.filter(invite => invite.status === 'pending' && invite.recipientAccountId === account.getAccount()?.id).map(invite => {
            const row = document.createElement('div'); row.className = 'community-row';
            const label = document.createElement('b'); label.textContent = `${invite.sender?.username || 'Friend'} invited you to a lobby`;
            const join = document.createElement('button'); join.className = 'btn btn-small'; join.textContent = 'Join'; join.onclick = async () => { const result = await Friends.actOnInvite(invite.id, 'accept'); if (!result.error && result.lobbyCode) this._quickJoin(result.lobbyCode); };
            const decline = document.createElement('button'); decline.className = 'btn btn-small'; decline.textContent = 'Decline'; decline.onclick = () => Friends.actOnInvite(invite.id, 'decline');
            row.append(label, join, decline); return row;
        }));
        const recent = document.getElementById('community-recent-list');
        if (recent) recent.innerHTML = this.socialProfile.recent.length ? this.socialProfile.recent.map(player =>
            `<div class="community-row"><div><b>${this._esc(player.name)}</b><small>${player.elo} ELO</small></div><button class="community-mute btn btn-small" data-name="${this._esc(player.name)}">${this.socialProfile.muted.includes(player.name) ? 'Unmute' : 'Mute'}</button><button class="community-report btn btn-small" data-name="${this._esc(player.name)}">Report</button></div>`).join('')
            : '<p class="community-empty">Play an online match to populate this list.</p>';
        recent?.querySelectorAll('.community-mute').forEach(button => button.onclick = () => {
            this.socialProfile = setMuted(this.socialProfile, button.dataset.name, !this.socialProfile.muted.includes(button.dataset.name));
            this._saveSocialProfile();
            this._renderSocialCenter();
        });
        recent?.querySelectorAll('.community-report').forEach(button => button.onclick = () => {
            this.socialProfile = reportPlayer(this.socialProfile, { name: button.dataset.name, reason: 'scoreboard' });
            this._saveSocialProfile();
            this.ui.showMessage?.('Local report saved for review.', 1500);
        });
        const emote = document.getElementById('showcase-emote');
        const skin = document.getElementById('showcase-skin');
        const pose = document.getElementById('showcase-pose');
        if (skin) skin.value = this.socialProfile.showcase.skin;
        if (emote) emote.value = this.socialProfile.showcase.emote;
        if (pose) pose.value = this.socialProfile.showcase.pose;
        const poseName = document.getElementById('showcase-pose-name');
        if (poseName) poseName.textContent = this.socialProfile.showcase.pose.toUpperCase();
        this._renderMenuPartyRail(me);
    }

    _inspectPlayerProfile(player) {
        this._socialInspectReturnToHub = this.socialLobby.active;
        this._renderSocialCenter();
        const preview = document.getElementById('community-showcase-preview');
        if (preview) preview.innerHTML = `<span>PLAYER PROFILE</span><b>${this._esc(player.name)}</b><small>${String(player.team || '').toUpperCase()} - ${player.score || 0} SCORE</small>`;
        this.ui.showScreen('socialCenter');
    }

    _inspectNearestSocialPlayer() {
        const origin = this.player.getPosition();
        const nearest = this.socialLobby.getPresence()
            .filter(visitor => !visitor.local)
            .map(visitor => ({
                ...visitor,
                distance: Math.hypot(visitor.position.x - origin.x, visitor.position.z - origin.z)
            }))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!nearest || nearest.distance > 18) {
            this.ui.showMessage?.('No player close enough to inspect.', 1400);
            return;
        }
        this.socialProfile = rememberPlayer(this.socialProfile, { name: nearest.name, elo: 1000 });
        this._saveSocialProfile();
        this._inspectPlayerProfile({ name: nearest.name, team: 'hub', score: 0 });
        this.player.unlock();
    }

    _disposeCosmeticPreview(container) {
        if (!container) return;
        this._cosmeticPreviews?.get(container)?.dispose();
        this._cosmeticPreviews?.delete(container);
    }

    // Shop preview for a BALL_SKINS entry that carries a `shape`. Geometry comes from
    // js/ball.js's shared cache, so it is cloned here: _renderCosmeticPreview disposes
    // whatever it is handed, and disposing the cached buffers would break every ball
    // that equips the same shape later in the session.
    _buildBallPreviewModel(skin) {
        const group = new THREE.Group();
        const content = new THREE.Group();
        const bodyColor = skin.shape === 'shuriken'
            ? new THREE.Color(skin.color).multiplyScalar(.62)
            : skin.color;
        const body = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: .38, metalness: .42, emissive: skin.glow, emissiveIntensity: .1 });
        const accent = new THREE.MeshStandardMaterial({ color: skin.glow, roughness: .3, metalness: .5, emissive: skin.glow, emissiveIntensity: .34 });
        const parts = skin.shape
            ? ballShapeParts(skin.shape, .45, THREE)
            : [{ geo: new THREE.SphereGeometry(.45, 24, 18), tint: 'body', owned: true }];
        for (const part of parts) {
            content.add(new THREE.Mesh(part.owned ? part.geo : part.geo.clone(), part.tint === 'accent' ? accent : body));
        }
        // Gameplay's shuriken lies in the XZ plane so it spins like a thrown
        // blade. Face that plane toward the showcase camera; keep the outer
        // group free for the shared preview turntable rotation below.
        if (skin.shape === 'shuriken') {
            content.rotation.x = Math.PI / 2;
            group.userData.previewSpinAxis = 'z';
        }
        group.add(content);
        return group;
    }

    _togglePhotoMode() {
        this._photoMode = !this._photoMode;
        document.body.classList.toggle('photo-mode', this._photoMode);
        const button = document.getElementById('photo-mode-toggle');
        if (button) button.textContent = this._photoMode ? 'Exit photo mode' : 'Photo mode';
        this.ui.showMessage?.(this._photoMode ? 'Photo mode: HUD hidden.' : 'Photo mode closed.', 1200);
    }

    // `build` lets a caller supply its own Object3D (the model-skin balls do); without
    // it this stays exactly the knife preview it always was.
    _renderCosmeticPreview(container, style, build = null, autoDispose = true) {
        if (!container || !style) return;
        try {
            this._cosmeticPreviews ??= new Map();
            this._cosmeticPreviews.get(container)?.dispose();
            container.querySelector('canvas')?.remove();
            const width = Math.max(150, container.clientWidth || 180);
            const height = Math.max(100, container.clientHeight || 120);
            const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
            renderer.setSize(width, height, false);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(32, width / height, .1, 20);
            camera.position.set(0, .25, 3.4);
            scene.add(new THREE.HemisphereLight(0xc8ffff, 0x153047, 2.4));
            const key = new THREE.DirectionalLight(0xffffff, 3);
            key.position.set(2, 3, 4);
            scene.add(key);
            const model = build ? build() : createKnifeModel(style);
            const bounds = new THREE.Box3().setFromObject(model);
            const center = bounds.getCenter(new THREE.Vector3());
            const size = bounds.getSize(new THREE.Vector3());
            model.position.sub(center);
            model.scale.setScalar(1.8 / Math.max(size.x, size.y, size.z, .1));
            const previewSpinAxis = model.userData?.previewSpinAxis === 'z' ? 'z' : 'y';
            model.rotation.set(previewSpinAxis === 'z' ? .08 : .2, previewSpinAxis === 'z' ? 0 : -.7, -.25);
            scene.add(model);
            container.classList.add('actual-preview');
            container.appendChild(renderer.domElement);
            let frame = 0;
            let disposed = false;
            const render = () => {
                if (disposed || !container.isConnected) return;
                model.rotation[previewSpinAxis] += .012;
                renderer.render(scene, camera);
                frame = requestAnimationFrame(render);
            };
            const dispose = () => {
                if (disposed) return;
                disposed = true;
                cancelAnimationFrame(frame);
                disposeObject3D(model);
                renderer.dispose();
                renderer.domElement.remove();
                container.classList.remove('actual-preview');
            };
            this._cosmeticPreviews.set(container, { dispose });
            if (autoDispose) {
                window.setTimeout(() => {
                    if (this._cosmeticPreviews.get(container)?.dispose === dispose) {
                        dispose();
                        this._cosmeticPreviews.delete(container);
                    }
                }, 10000);
            }
            render();
        } catch (error) {
            RuntimeLog.log('cosmetic-preview', { message: String(error?.message || error) });
        }
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
        const progress = document.getElementById('match-loading-progress');
        const percent = document.getElementById('match-loading-percent');
        if (progress) progress.style.width = '0%';
        if (percent) percent.textContent = '0%';
        overlay.classList.remove('hidden', 'active');
        void overlay.offsetWidth;
        overlay.classList.add('active');
        return new Promise(resolve => {
            const started = performance.now();
            const tick = () => {
                const ratio = Math.min(1, (performance.now() - started) / duration);
                const value = Math.round(ratio * 100);
                if (progress) progress.style.width = `${value}%`;
                if (percent) percent.textContent = `${value}%`;
                if (ratio < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            window.setTimeout(() => {
                this._loadedMapIds ??= new Set();
                this._loadedMapIds.add(mapId);
                overlay.classList.add('hidden');
                overlay.classList.remove('active');
                resolve(Math.max(0, performance.now() - started));
            }, duration);
        });
    }

initCarousel() {
    const keys = this.game.getSelectableMaps();
        const idx = keys.indexOf(this.arena?.mapId);
        if (idx >= 0) this.carouselIndex = idx;
        this.updateCarousel();
    }

updateCarousel() {
    const keys = this.game.getSelectableMaps();
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
        getLobbyPreviewCommands(config).forEach(command => {
            const x = Number.isFinite(command.x) ? command.x * courtWidth : courtWidth / 2;
            const y = Number.isFinite(command.y) ? command.y * courtHeight : courtHeight / 2;
            switch (command.kind) {
                case 'shore': {
                    const shoreY = command.edge === 'north' ? 0 : courtHeight - 18;
                    ctx.fillStyle = 'rgba(255,230,162,0.76)';
                    ctx.fillRect(0, shoreY, courtWidth, 18);
                    break;
                }
                case 'net':
                    ctx.strokeStyle = 'rgba(245,255,255,0.96)';
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(courtWidth / 2 - 3, 6);
                    ctx.lineTo(courtWidth / 2 - 3, courtHeight - 6);
                    ctx.moveTo(courtWidth / 2 + 3, 6);
                    ctx.lineTo(courtWidth / 2 + 3, courtHeight - 6);
                    ctx.stroke();
                    break;
                case 'palm':
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.strokeStyle = 'rgba(112, 70, 30, 0.94)';
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(0, 13);
                    ctx.lineTo(0, -9);
                    ctx.stroke();
                    ctx.strokeStyle = 'rgba(43, 130, 84, 0.94)';
                    ctx.lineWidth = 4;
                    for (const angle of [-0.82, -0.28, 0.28, 0.82]) {
                        ctx.beginPath();
                        ctx.moveTo(0, -8);
                        ctx.lineTo(Math.sin(angle) * 15, -18 - Math.cos(angle) * 7);
                        ctx.stroke();
                    }
                    ctx.restore();
                    break;
                case 'service-rings':
                    ctx.strokeStyle = 'rgba(255, 248, 207, 0.82)';
                    ctx.lineWidth = 2;
                    for (const ringX of [courtWidth * 0.24, courtWidth * 0.76]) {
                        ctx.beginPath();
                        ctx.arc(ringX, courtHeight / 2, 15, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                    break;
                case 'truss': {
                    const trussY = command.edge === 'north' ? 12 : courtHeight - 12;
                    ctx.strokeStyle = 'rgba(188, 213, 236, 0.86)';
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.moveTo(12, trussY);
                    ctx.lineTo(courtWidth - 12, trussY);
                    for (let trussX = 18; trussX < courtWidth - 14; trussX += 24) {
                        ctx.moveTo(trussX, trussY - 9);
                        ctx.lineTo(trussX + 12, trussY + 9);
                        ctx.lineTo(trussX + 24, trussY - 9);
                    }
                    ctx.stroke();
                    break;
                }
                case 'conveyor':
                    ctx.fillStyle = 'rgba(24, 42, 58, 0.74)';
                    ctx.fillRect(12, y - 7, courtWidth - 24, 14);
                    ctx.strokeStyle = 'rgba(255, 180, 58, 0.82)';
                    ctx.lineWidth = 2;
                    for (let conveyorX = 20; conveyorX < courtWidth - 18; conveyorX += 16) {
                        ctx.beginPath();
                        ctx.moveTo(conveyorX, y - 5);
                        ctx.lineTo(conveyorX + 8, y + 5);
                        ctx.stroke();
                    }
                    break;
                case 'crate':
                    ctx.fillStyle = 'rgba(205, 135, 64, 0.95)';
                    ctx.fillRect(x - 10, y - 10, 20, 20);
                    ctx.strokeStyle = 'rgba(68, 43, 30, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x - 10, y - 10, 20, 20);
                    break;
                case 'safety-lamps':
                    ctx.fillStyle = 'rgba(255, 198, 66, 0.96)';
                    for (const lampX of [courtWidth * 0.13, courtWidth * 0.35, courtWidth * 0.65, courtWidth * 0.87]) {
                        ctx.beginPath();
                        ctx.arc(lampX, courtHeight - 12, 5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    break;
            }
        });
        ctx.restore();
    }

    // --- SETTINGS MODAL ---

    openSettingsModal() {
        this.ui.hideScoreboard();
        this.ui._openExclusive('settings', () => this.closeSettingsModal());
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
        this.ui._closeExclusive('settings');
    }

    // Practice range — bot yok, sınırsız top, spawn/taşı.
    _initShopShowcase() {
        const canvas = document.getElementById('shop-showcase-canvas');
        if (!canvas || this.shopShowcase) return;
        try {
            this.shopShowcase = new ShopShowcaseRenderer(canvas, {
                characterId: this.store.get('selectedChar'),
                skinId: this.store.get('equippedAvatarSkin'),
                autoStart: false
            });
        } catch (error) {
            const status = document.getElementById('shop-showcase-status');
            if (status) status.textContent = '3D preview unavailable. Catalog controls remain active.';
        }
        window.addEventListener('warrball:shop-preview', event => {
            const detail = event.detail;
            if (detail?.type === 'avatar' && AVATAR_SKINS[detail.id]) {
                this._syncShopShowcase(detail.id);
                this.productAnalytics.track('shop_inspect', { shopTab: 'avatars', itemType: 'avatar', itemId: detail.id });
            }
            if (detail?.type === 'character' && CHARACTERS[detail.id]) {
                this._syncShopShowcase(null, detail.id);
                this.productAnalytics.track('shop_inspect', { shopTab: 'chars', itemType: 'character', itemId: detail.id });
            }
            if (detail?.type === 'ball' && BALL_SKINS[detail.id]) {
                const skin = BALL_SKINS[detail.id];
                const visual = document.getElementById('shop-selected-product-visual');
                this._renderCosmeticPreview(visual, skin, () => this._buildBallPreviewModel(skin), false);
                visual?.querySelector('canvas')?.setAttribute('aria-hidden', 'true');
                this.productAnalytics.track('shop_inspect', { shopTab: 'balls', itemType: 'ball', itemId: detail.id });
            }
            if (detail?.type === 'cosmetic' && COSMETICS[detail.id]) {
                const cosmetic = COSMETICS[detail.id];
                const equipped = this.store.get('equippedWearables') || {};
                this._applyShopShowcaseCosmetics({ ...equipped, [cosmetic.type]: cosmetic.id }, cosmetic.type);
                this.ui._setShopCosmeticShowcase?.(this.store, cosmetic, true);
                this.productAnalytics.track('shop_inspect', { shopTab: 'wearables', itemType: 'cosmetic', itemId: detail.id });
            }
        }, { signal: this._mainAbort.signal });
        window.addEventListener('warrball:shop-preview-reset', () => {
            this._applyShopShowcaseCosmetics(this.store.get('equippedWearables'));
            this.ui._resetShopCosmeticShowcase?.(this.store);
        }, { signal: this._mainAbort.signal });
        window.addEventListener('warrball:screen', event => {
            if (event.detail?.screen !== 'shop') this._applyShopShowcaseCosmetics(this.store.get('equippedWearables'));
        }, { signal: this._mainAbort.signal });
    }

    _applyShopShowcaseCosmetics(loadout, focusType = '') {
        const avatar = this.shopShowcase?.avatar?.root;
        if (!avatar) return false;
        applyEntityCosmetics(avatar, loadout);
        this.shopShowcase.avatar.onPoseTime = seconds => updateEntityCosmetics(avatar, seconds);
        if (focusType && ['cape', 'wings', 'backpack', 'banner'].includes(focusType)) this.shopShowcase._yaw = 0;
        else if (!focusType) this.shopShowcase._yaw = Math.PI;
        this.shopShowcase._renderFrame?.();
        return true;
    }

    _presentCaseResult(box, result) {
        this.ui.showCaseReel(box, result, { onSettled: settled => {
            if (settled.free) this.productAnalytics.track('earned_case_opened', { itemId: box.id, itemType: 'cosmetic_case', result: 'earned' });
            this.ui.showMessage?.(settled.duplicate ? `Duplicate converted: +${settled.refund} credits` : `Unlocked: ${settled.reward.name}`);
        }, onInspect: settled => {
            this.ui.renderLockerInventory(this.store);
            this.ui.renderCharacterSelect(this.store);
            this.ui.setLockerTab('inventory');
            this.ui.showScreen('character');
            const item = settled.reward;
            if (item.type === 'cosmetic' && COSMETICS[item.id] && typeof CustomEvent !== 'undefined') {
                this.ui.showScreen('shop');
                this.ui.renderShop(this.store, 'wearables');
                this.shopShowcase?.start();
                window.dispatchEvent(new CustomEvent('warrball:shop-preview', { detail: { type: 'cosmetic', id: item.id, cosmetic: COSMETICS[item.id], source: 'case' } }));
            }
        }, onEquip: settled => this._equipCaseReward(settled.reward), onOpenAnother: () => {
            void this._openShopCase(box);
        } });
    }

    _showCaseOpenError(box, message) {
        this.ui.showMessage?.(message);
        this.ui.renderShop(this.store, 'cases');
        document.querySelector(`.case-select[data-id="${box.id}"]`)?.click();
    }

    async _openShopCase(box, trigger = null) {
        if (!box || this._caseOpenInFlight) return false;
        const balance = Number(this.store.get('currency')) || 0;
        const earned = this.store.getEarnedCaseState?.(box.id)?.cases || 0;
        if (!earned && balance < box.price) {
            this._showCaseOpenError(box, `Need ${box.price} credits - Balance ${balance}`);
            return false;
        }
        this._caseOpenInFlight = true;
        if (trigger) {
            trigger.disabled = true;
            trigger.classList.add('is-opening');
        }
        let result = null;
        try {
            result = await this.store.openCaseRemote(box.id);
            if (!result && !this.store.remoteReady) result = this.store.openCase(box.id);
        } finally {
            this._caseOpenInFlight = false;
            if (trigger) {
                trigger.disabled = false;
                trigger.classList.remove('is-opening');
            }
        }
        if (!result) {
            this._showCaseOpenError(box, earned ? 'Case opening failed. Your earned case was not consumed.' : 'Case opening failed. No credits were charged.');
            this.refreshMetaStats();
            return false;
        }
        document.getElementById('case-inspector')?.classList.add('hidden');
        this.ui._closeExclusive('caseInspector');
        this.ui.renderShop(this.store, 'cases');
        this._presentCaseResult(box, result);
        this.refreshMetaStats();
        return true;
    }

    async _equipCaseReward(reward) {
        if (!reward || reward.type === 'knife') return false;
        let equipped = false;
        if (reward.type === 'ball') {
            equipped = this.store.equipBall(reward.id);
            if (equipped) this.game.ball.setSkin(reward.id);
        } else if (reward.type === 'avatar') {
            equipped = this.store.equipAvatarSkin(reward.id);
            if (equipped) this._syncShopShowcase(reward.id);
        } else if (reward.type === 'cosmetic') {
            equipped = this.store.equipCosmetic(reward.id);
            if (equipped) await this._syncWearableLoadout();
        }
        if (equipped) {
            this.productAnalytics.track('cosmetic_equip', { itemType: reward.type, itemId: reward.id, source: 'case_reveal' });
            this.ui.showMessage?.(`Equipped: ${reward.name}`);
            this.refreshMetaStats();
        } else {
            this.ui.showMessage?.(reward.type === 'knife' ? 'Equip knives per team from Locker.' : 'This reward cannot be equipped.');
        }
        return equipped;
    }

    // Shared consistency-wiring helper: paints one live 64x64 skin sheet onto every
    // skinnable rig box. Shop, menu hero and Studio therefore show the same full-body
    // skin that remote in-game players receive.
    _applyAvatarAtlasToRig(rig, pixels, modelId = 'classic') {
        if (!rig) return;
        if (!Array.isArray(pixels) || pixels.length !== 4096) {
            rig.setAvatarAtlasTexture(null);
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 64; x++) {
                const color = pixels[y * 64 + x];
                if (color) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        rig.setAvatarAtlasTexture(texture, modelId);
    }

    _syncShopShowcase(skinId = null, characterId = null) {
        const selected = skinId
            || document.getElementById('shop-showcase-stage')?.dataset.skinId
            || this.store.get('equippedAvatarSkin');
        this._syncAvatarPreview(this.shopShowcase, selected, characterId || this.store.get('selectedChar'));
        this._applyShopShowcaseCosmetics(this.store.get('equippedWearables'));
        this.shopShowcase?.resize();
    }

    // Live 3D hero on the main menu. Reuses the shop showcase rig instead of adding a
    // second renderer path; the CSS character stays as the no-WebGL fallback.
    _initMenuHero() {
        const canvas = document.getElementById('menu-hero-canvas');
        const showcase = document.getElementById('menu-character-showcase');
        if (!canvas || this.menuHero) return;
        try {
            this.menuHero = new ShopShowcaseRenderer(canvas, {
                characterId: this.store.get('selectedChar'),
                skinId: this.store.get('equippedAvatarSkin'),
                autoStart: false,
                camera: { fov: 30, position: [0, 1.42, 6.4], target: [0, 1.02, 0] }
            });
        } catch (error) {
            return;
        }
        showcase?.setAttribute('data-live', 'on');
        window.addEventListener('warrball:screen', event => {
            if (event.detail?.screen === 'mainMenu') {
                this._syncMenuHero();
                this.menuHero.start();
            } else {
                this.menuHero.stop();
            }
        }, { signal: this._mainAbort.signal });
    }

    // Full-viewport Three.js backdrop behind the main menu (js/menu-stage.js). Mirrors
    // _initMenuHero's structure (built once, then started/stopped per screen change) but
    // fully disposes instead of merely pausing: leaving mainMenu is always either a menu
    // sub-screen (background invisible anyway, no reason to hold its GPU resources) or the
    // path into an actual match, so disposing on every departure is a safe superset of
    // "dispose when a match starts" without needing to hook every match-start call site.
    _initMenuStage() {
        const canvas = document.getElementById('menu-stage-canvas');
        if (!canvas) return;
        const create = () => {
            try {
                this.menuStage = createMenuStage({ canvas, window, document, autoStart: false });
                this.menuStage.setReducedMotion(!!this.store.get('settings').reduceMotion);
            } catch (error) {
                this.menuStage = null;
            }
        };
        create();
        window.addEventListener('warrball:screen', event => {
            if (event.detail?.screen === 'mainMenu') {
                if (!this.menuStage) create();
                this.menuStage?.start();
            } else {
                this.menuStage?.dispose();
                this.menuStage = null;
            }
        }, { signal: this._mainAbort.signal });
    }

    _syncMenuHero() {
        const skinId = this.store.get('equippedAvatarSkin');
        this._syncAvatarPreview(this.menuHero, skinId);
        // Apply equipped cosmetics to the hero avatar
        if (this.menuHero?.root?.rig) {
            const knifeId = this.store.get('equippedKnife');
            const rig = this.menuHero.root.rig;
            // Dispose old knife if any
            if (this.menuHero._heroKnife) {
                disposeObject3D(this.menuHero._heroKnife);
                this.menuHero._heroKnife = null;
            }
            // Attach new knife unless it's the training knife (default, not a cosmetic)
            if (knifeId && knifeId !== 'training') {
                const knifeStyle = KNIVES[knifeId]?.style || '';
                const knifeModel = createKnifeModel(knifeStyle);
                if (knifeModel && rig.sockets.handR) {
                    rig.sockets.handR.add(knifeModel);
                    this.menuHero._heroKnife = knifeModel;
                }
            }
        }
        this.menuHero?.resize();
    }

    _syncCosmeticPracticeCommerce() {
        return this.cosmeticPractice.syncCommerce({
            currency: this.store.get('currency'),
            ownedSkinIds: this.store.get('ownedAvatarSkins'),
            equippedSkinId: this.store.get('equippedAvatarSkin')
        });
    }

    _startCosmeticPractice(skinId = this.store.get('equippedAvatarSkin')) {
        if (!AVATAR_SKINS[skinId]) return false;
        this.productAnalytics.track('practice_start', { practiceType: 'cosmetic', itemType: 'avatar', itemId: skinId });
        if (this.cosmeticPractice.active) {
            this._renderCosmeticPractice(this.cosmeticPractice.selectSkin(skinId));
            return true;
        }
        this._capturePracticeSession();
        this._syncCosmeticPracticeCommerce();
        const snapshot = this.cosmeticPractice.open(skinId, 'shop');
        this.shopShowcase?.stop();
        this.game.cancelGuidedDrill();
        this.game.clearPowerUps?.();
        this.game.affixes?.clearRound();
        this.game.chaosManager?.clear();
        this.game.state = STATES.LOBBY;
        this.game.selectMode('classic');
        this.game.selectMap(COSMETIC_PRACTICE_MAP_ID);
        this.player.setTeam('red');
        this.player.respawn();
        // Twelve metres to the display stage gives the first-person preview a
        // useful full-body scale without putting the player inside its plinth.
        this.player.position.set(0, this.player.height, -8);
        this.player.velocity.set(0, 0, 0);
        this.player.euler.set(0, 0, 0, 'YXZ');
        this.player.camera.quaternion.setFromEuler(this.player.euler);
        this.game.bots.forEach(bot => bot.remove());
        this.game.bots = [];
        this.game._practiceMode = true;
        this.game._cosmeticPractice = true;
        this.game.ball.active = false;
        this.game.ball.velocity.set(0, 0, 0);
        this.game.ball.mesh.visible = false;
        this.game.setState(STATES.COSMETIC_PRACTICE);
        this.ui.hideAll();
        this.ui.hideHUD();
        document.getElementById('practice-lab-hud')?.classList.add('hidden');
        document.body.classList.remove('practice-lab-active', 'guided-deflect-active');
        document.getElementById('cosmetic-practice-hud')?.classList.remove('hidden');
        document.body.classList.add('cosmetic-practice-active');
        this.player.setHandTemporarilyVisible(false);
        this._cosmeticPracticeAvatar = createShowcaseAvatar({
            characterId: this.store.get('selectedChar'),
            skinId: snapshot.selectedSkinId
        });
        this._cosmeticPracticeAvatar.root.rotation.y = Math.PI;
        this._cosmeticPracticeAvatar.root.scale.setScalar(1.55);
        this.arena.cosmeticStudio?.previewAnchor?.add(this._cosmeticPracticeAvatar.root);
        this._renderCosmeticPractice(snapshot);
        return true;
    }

    _renderCosmeticPractice(snapshot = this.cosmeticPractice.snapshot()) {
        if (!snapshot?.skin) return;
        this._syncAvatarPreview(this._cosmeticPracticeAvatar, snapshot.selectedSkinId);
        const eligibility = snapshot.eligibility;
        const setText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        setText('cosmetic-practice-name', snapshot.skin.name);
        setText('cosmetic-practice-meta', `${snapshot.catalogIndex + 1}/${snapshot.catalogSize} - ${snapshot.skin.model === 'slim' ? 'Slim' : 'Classic'} model`);
        setText('cosmetic-practice-balance', `${eligibility.balance} credits`);
        setText('cosmetic-practice-status', eligibility.equipped
            ? 'Equipped now.'
            : eligibility.owned
                ? 'Owned. Equip when ready.'
                : `Previewing before purchase - ${eligibility.price} credits`);
        const buy = document.getElementById('cosmetic-practice-buy');
        if (buy) {
            buy.disabled = !eligibility.canPurchase;
            buy.textContent = eligibility.owned ? 'Owned' : eligibility.canPurchase ? `Buy - ${eligibility.price}` : `Need ${eligibility.price} credits`;
        }
        const equip = document.getElementById('cosmetic-practice-equip');
        if (equip) {
            equip.disabled = !eligibility.canEquip;
            equip.textContent = eligibility.equipped ? 'Equipped' : 'Equip Skin';
        }
    }

    _selectCosmeticPracticeSkin(direction) {
        if (!this.cosmeticPractice.active) return;
        const snapshot = direction < 0 ? this.cosmeticPractice.previous() : this.cosmeticPractice.next();
        this._renderCosmeticPractice(snapshot);
    }

    async _purchaseCosmeticPracticeSkin() {
        if (!this.cosmeticPractice.active) return false;
        const snapshot = this.cosmeticPractice.snapshot();
        if (!snapshot.eligibility.canPurchase) return false;
        const button = document.getElementById('cosmetic-practice-buy');
        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.textContent = 'Purchasing...';
        }
        const purchased = await this.store.purchase('avatar', snapshot.selectedSkinId);
        this.productAnalytics.track(purchased ? 'shop_purchase_success' : 'shop_purchase_failure', {
            itemType: 'avatar',
            itemId: snapshot.selectedSkinId,
            reason: purchased ? 'success' : 'unavailable'
        });
        button?.removeAttribute('aria-busy');
        this._renderCosmeticPractice(this._syncCosmeticPracticeCommerce());
        this.refreshMetaStats();
        this.ui.showMessage?.(purchased ? `${snapshot.skin.name} purchased.` : 'Purchase failed or item already owned.', 1800);
        return purchased;
    }

    _equipCosmeticPracticeSkin() {
        if (!this.cosmeticPractice.active) return false;
        const snapshot = this.cosmeticPractice.snapshot();
        const equipped = this.store.equipAvatarSkin(snapshot.selectedSkinId);
        if (!equipped) return false;
        this.productAnalytics.track('cosmetic_equip', { itemType: 'avatar', itemId: snapshot.selectedSkinId });
        this.initAvatarPainter();
        this.avatarPainter?.applyPreset(snapshot.selectedSkinId);
        this._renderCosmeticPractice(this._syncCosmeticPracticeCommerce());
        this._syncShopShowcase(snapshot.selectedSkinId);
        this.refreshMetaStats();
        this.ui.showMessage?.(`${snapshot.skin.name} equipped.`, 1600);
        return true;
    }

    _exitCosmeticPractice() {
        if (!this.cosmeticPractice.active) return false;
        const returnScreen = this.cosmeticPractice.snapshot().returnScreen;
        this.cosmeticPractice.close();
        this._cosmeticPracticeAvatar?.dispose();
        this._cosmeticPracticeAvatar = null;
        this.game._cosmeticPractice = false;
        this._exitPracticeSession();
        this.game.setState(STATES.MENU);
        document.getElementById('cosmetic-practice-hud')?.classList.add('hidden');
        document.body.classList.remove('cosmetic-practice-active');
        this.player.restoreHandVisibility();
        this.ui.renderShop(this.store, 'avatars');
        this.ui.showScreen(returnScreen);
        this._syncShopShowcase();
        this.shopShowcase?.start();
        this.player.unlock();
        return true;
    }

    _capturePracticeSession() {
        if (this._practiceSessionRestore) return;
        this._practiceSessionRestore = {
            mapId: this.arena.mapId,
            modeId: this.game.mode?.id || 'classic',
            team: this.player.team
        };
    }

    _exitPracticeSession() {
        if (!this.game._practiceMode
            && !this._practiceSessionRestore
            && !this.game.guidedDrill?.active
            && !this.game._guidedDrillResultOpen) {
            document.body.classList.remove('practice-lab-active', 'guided-deflect-active');
            return false;
        }
        const restore = this._practiceSessionRestore;
        this.game.cancelGuidedDrill();
        this.game.clearPowerUps?.();
        this.game.affixes?.clearRound();
        this.game.chaosManager?.clear();
        this.game._practiceMode = false;
        this.game._guidedDrillResultOpen = false;
        document.getElementById('guided-drill-result')?.classList.add('hidden');
        document.getElementById('practice-lab-hud')?.classList.add('hidden');
        document.body.classList.remove('practice-lab-active', 'guided-deflect-active');
        document.querySelectorAll('#btn-add-bot-red, #btn-add-bot-blue').forEach(button => {
            button.disabled = false;
        });
        if (restore) {
            this.game.state = STATES.LOBBY;
            this.game.selectMode(restore.modeId);
            this.game.selectMap(restore.mapId);
            this.player.setTeam(restore.team === 'blue' ? 'blue' : 'red');
            this.player.respawn();
        }
        this._practiceSessionRestore = null;
        return true;
    }

    _startFirstBotMatchFromDrill() {
        // The result overlay belongs to a local practice session. Never turn a
        // connected lobby into an automatic multiplayer match from this CTA.
        if (this.network?.connected) {
            this.ui.showMessage?.('Leave the party before starting a bot match.', 2200);
            return false;
        }
        this._exitPracticeSession();
        this.game.startSolo();
        this._armFirstSoloBotGuard();
        this.ui.showScreen('lobby');
        document.getElementById('btn-start-game')?.click();
        return true;
    }

    startGuidedDeflectDrill({ source = 'practice_menu' } = {}) {
        const firstRun = source === 'ftue';
        this.productAnalytics.track('practice_start', { practiceType: 'guided_deflect', source });
        this._capturePracticeSession();
        document.getElementById('guided-drill-result')?.classList.add('hidden');
        this.game.state = STATES.LOBBY;
        this.game.selectMode('classic');
        this.game.selectMap('esport_arena');
        this.startPractice({ track: false });
        this.game.armGuidedDrill({ profile: firstRun ? 'first_run' : 'full' });
        this._ftueGuidedRun = firstRun;
        document.body.classList.add('guided-deflect-active');
        this.game.startGame(true);
        this.player.lock();
    }

    startPractice({ launch = false, track = true } = {}) {
        if (track) this.productAnalytics.track('practice_start', { practiceType: launch ? 'free_play' : 'setup' });
        this._capturePracticeSession();
        this.game.cancelGuidedDrill();
        this.game.clearPowerUps?.();
        this.game.affixes?.clearRound();
        this.game.chaosManager?.clear();
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
        document.body.classList.add('practice-lab-active');
        document.body.classList.remove('guided-deflect-active');
        this.game.practiceMetrics.reset();
        this._updatePracticeLab(this.game.practiceMetrics.summary());
        document.getElementById('practice-lab-hud')?.classList.remove('hidden');
        this.ui.showScreen('lobby');
        if (launch) {
            this.game.startGame();
            this.player.lock();
        }
        // Practice lobby'sinde farklı butonlar göster
        this.ui.showMessage?.('Practice Lab: R spawn, F reposition, T reset', 3000);
    }

    _startMovementTrial(trialId) {
        const trial = MOVEMENT_TRIALS[trialId];
        if (!trial) return;
        this._capturePracticeSession();
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


    _showDeflectResult(result = {}) {
        if (result.tier !== 'perfect' && result.tier !== 'great') return;
        const hud = document.getElementById('perfect-deflect-hud');
        if (!hud) return;
        const perfect = result.tier === 'perfect';
        hud.classList.toggle('is-perfect', perfect);
        hud.classList.toggle('is-great', !perfect);
        document.getElementById('perfect-deflect-tier').textContent = result.tier.toUpperCase();
        const chain = document.getElementById('perfect-deflect-chain');
        chain.textContent = perfect ? `x${result.chain || 1}` : '';
        chain.hidden = !perfect;
        document.getElementById('perfect-deflect-timing').textContent = `${Math.round(result.timingErrorMs || 0)} ms`;
        hud.classList.remove('hidden');
        clearTimeout(this._perfectDeflectTimer);
        this._perfectDeflectTimer = setTimeout(() => hud.classList.add('hidden'), perfect ? 1800 : 1100);
    }

    _updateGuidedDrillHUD(snapshot = {}) {
        const stage = snapshot.stage || {};
        const displayStage = snapshot.phase === 'transition'
            ? snapshot.nextStage || stage
            : stage;
        const stats = snapshot.stats || {};
        const seconds = Math.ceil((snapshot.phaseRemainingMs || 0) / 1000);
        const values = {
            'practice-lab-mode': displayStage.name || 'GUIDED',
            'drill-stage': snapshot.phase === 'countdown'
                ? 'READY'
                : snapshot.phase === 'transition'
                    ? `NEXT ${Math.min((snapshot.stageIndex || 0) + 2, snapshot.stageCount || 1)}/${snapshot.stageCount || 1}`
                    : `STAGE ${Math.min((snapshot.stageIndex || 0) + 1, snapshot.stageCount || 1)}/${snapshot.stageCount || 1}`,
            'drill-timer': `00:${String(seconds).padStart(2, '0')}`,
            'drill-speed': `${Number(snapshot.speedMultiplier || 0).toFixed(2)}x`,
            'drill-hits': stats.hits || 0,
            'drill-directed': stats.directed || 0,
            'drill-perfect': stats.perfect || 0,
            'practice-hint': snapshot.phase === 'countdown'
                ? 'Get ready. First serve incoming.'
                : snapshot.phase === 'transition'
                    ? `Next: ${displayStage.instruction || ''}`
                    : stage.instruction || ''
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        const track = document.getElementById('drill-stage-progress');
        if (track && stage.durationMs) {
            track.style.width = `${Math.min(
                100,
                (snapshot.phaseElapsedMs || 0) / stage.durationMs * 100
            )}%`;
        }
    }

    _showGuidedDrillResult(result = {}, { firstRun = false } = {}) {
        const overlay = document.getElementById('guided-drill-result');
        if (!overlay) return;
        overlay.dataset.firstRun = firstRun ? 'true' : 'false';
        const kicker = document.getElementById('drill-result-kicker');
        const headline = document.getElementById('drill-result-headline');
        if (kicker) kicker.textContent = firstRun ? 'FIRST DRILL COMPLETE' : 'SESSION COMPLETE';
        if (headline) headline.textContent = firstRun ? 'YOU’RE READY FOR A MATCH' : 'DRILL RESULTS';
        const grade = document.getElementById('drill-result-grade');
        const score = document.getElementById('drill-result-score');
        grade?.closest('.drill-grade')?.toggleAttribute('hidden', firstRun);
        score?.closest('.drill-score')?.toggleAttribute('hidden', firstRun);
        if (grade) grade.textContent = result.grade || 'D';
        if (score) score.textContent = String(result.score || 0);
        const list = document.getElementById('drill-result-stages');
        if (list) {
            list.replaceChildren();
            for (const stage of result.stages || []) {
                const row = document.createElement('div');
                const name = document.createElement('span');
                const value = document.createElement('b');
                if (firstRun) {
                    const metric = stage.id === 'control'
                        ? `${stage.hits || 0} contacts`
                        : stage.id === 'direction'
                            ? `${stage.directed || 0} on target`
                            : `${stage.perfect || 0} perfect`;
                    name.textContent = stage.name[0] + stage.name.slice(1).toLowerCase();
                    value.textContent = metric;
                    row.dataset.passed = '1';
                } else {
                    name.textContent = stage.name;
                    value.textContent = `${stage.score} ${stage.passed ? 'PASS' : 'RETRY'}`;
                    row.dataset.passed = stage.passed ? '1' : '0';
                }
                row.append(name, value);
                list.append(row);
            }
        }
        const retry = document.getElementById('btn-drill-retry');
        const freeLab = document.getElementById('btn-drill-free-lab');
        if (retry) retry.textContent = firstRun ? 'Practice Again' : 'Retry';
        freeLab?.toggleAttribute('hidden', firstRun);
        overlay.classList.remove('hidden');
        this.game._guidedDrillResultOpen = true;
        this.player.unlock();
    }

    _updatePracticeLab(summary = {}) {
        const accuracy = Math.round(summary.accuracy || 0);
        const values = {
            'practice-accuracy': `${accuracy}%`,
            'practice-perfects': summary.perfects || 0,
            'practice-best': Number.isFinite(summary.best)
                ? `${Math.round(summary.best)}ms`
                : '--'
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
        const progress = document.getElementById('practice-lab-progress');
        if (progress) progress.style.width = `${accuracy}%`;
    }

    _installMigratedHostHandlers(code) {
        this.network.onPlayerJoin = (name, playerId, avatar, peerId, avatarModel) => {
            const existing = this.game.remotePlayers.has(playerId);
            this.game.addRemotePlayer(playerId, name, null, avatar, peerId, avatarModel);
            if (!existing && this.game.shouldQueueLateJoin()) this.game.queueRemoteForNextRound(playerId);
            this.broadcastLobbyState();
        };
        this.network.onPlayerLeave = (playerId, peerId) => {
            this.game.removeRemotePlayer(playerId);
            this.network.broadcast({ type: 'peerLeft', playerId, peerId });
            this.broadcastLobbyState();
            this._syncRematchRoster?.();
        };
        this.network.onTeamChange = (name, team) => {
            this.game.switchPlayerTeam?.(name, team);
            this.broadcastLobbyState();
        };
        this.network.onLateJoinTeam = (playerId, team) => {
            if (this.game.selectQueuedRemoteTeam(playerId, team)) this.broadcastLobbyState();
        };
        this._lobbyCode = code;
        this._registerLobby(
            code,
            this._lobbyName || 'Migrated Lobby',
            this.network.connections.size + 1,
            this.arena.config?.name || 'Unknown',
            this.game.mode?.name || 'Classic'
        );
        // ponytail: migration promotes a new host mid-match — without a keep-alive
        // handoff the re-registered lobby just expires at the server TTL (P2P_HOST_FIXES #2).
        clearInterval(this._lobbyKeepAlive);
        this._lobbyKeepAlive = setInterval(() => {
            if (this.network.connected && this.network.isHost) {
                this._registerLobby(this._lobbyCode || code, this._lobbyName || 'Migrated Lobby', this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            }
        }, 12000);
    }

    broadcastLobbyState() {
        if (!(this.network?.isHost)) return;
        const players = this.game.getPlayerList();
        const name = document.getElementById('lobby-name-input')?.value || 'Lobby';
        this._lobbyName = name;
        this.network.broadcast({
            type: 'lobbyState',
            players,
            lobbyName: name,
            mode: this.game.mode?.id,
            map: this.arena?.mapId,
            settings: {
                matchTime: parseInt(document.getElementById('setting-match-time')?.value || 300),
                maxRounds: parseInt(document.getElementById('setting-max-rounds')?.value || 16),
                botDifficulty: document.getElementById('setting-bot-difficulty')?.value || 'hard'
            }
        });
    }

    async _syncWearableLoadout() {
        const playerId = this.network?.playerId;
        if (!playerId) return false;
        const entitlement = await this.store.syncCosmeticLoadout(playerId);
        if (!entitlement) return false;
        if (this.network?.isHost) this.broadcastLobbyState();
        else if (this.network?.connected) this.network.send({ type: 'cosmeticLoadout', entitlement });
        return true;
    }

    // Wire the client-side network callbacks (used by every join path).
    _syncClientLobbyIdentity(code) {
        const rawRoomCode = this.network?.hostRoomCode ?? code;
        const trustedRoomCode = typeof rawRoomCode === 'string' ? rawRoomCode.trim() : '';
        if (trustedRoomCode && trustedRoomCode.length <= 128) {
            this._lobbyCode = trustedRoomCode;
            this.ui.setRoomCode(trustedRoomCode);
        }
        this.game.onModeChange?.(this.game.mode?.id);
    }

    _applyClientLobbyStatePresentation(data) {
        const lobbyMode = data?.mode;
        if (typeof lobbyMode === 'string' && Object.hasOwn(GAME_MODES, lobbyMode)) {
            this.game.applyModeChange({ modeId: lobbyMode });
        }
        const lobbyMap = data?.map;
        if (typeof lobbyMap === 'string' && this.game.getSelectableMaps?.().includes(lobbyMap)) {
            this.game.applyMapChange({ mapId: lobbyMap });
        }
        this.game.onModeChange?.(this.game.mode?.id);
    }

    _applyInitialLobbyWelcome(data) {
        const welcomeState = data?.state || data?.snapshot?.state;
        if (this.network?.isHost || data?.type !== 'welcome' || welcomeState === STATES.SOCIAL_HUB) return false;

        // The transport owns this code from joinGame(); never take a room code
        // from the welcome payload itself.
        const knownRoomCode = typeof this.network?.hostRoomCode === 'string'
            ? this.network.hostRoomCode.trim()
            : '';
        if (knownRoomCode && knownRoomCode.length <= 128) {
            this._lobbyCode = knownRoomCode;
            this.ui.setRoomCode(knownRoomCode);
        }

        const welcomeMode = data.mode ?? data.snapshot?.mode;
        if (typeof welcomeMode === 'string' && Object.hasOwn(GAME_MODES, welcomeMode)) {
            this.game.applyModeChange({ modeId: welcomeMode });
        }
        const welcomeMap = data.map ?? data.snapshot?.map;
        if (typeof welcomeMap === 'string' && this.game.getSelectableMaps?.().includes(welcomeMap)) {
            this.game.applyMapChange({ mapId: welcomeMap });
        }

        // selectMode/selectMap notify when they change; this also refreshes the
        // client role controls for an idempotent repeated welcome.
        this.game.onModeChange?.(this.game.mode?.id);
        return true;
    }

    _finalizeClientLobbyJoin(code) {
        const rawRoomCode = this.network?.hostRoomCode ?? code;
        const trustedRoomCode = typeof rawRoomCode === 'string' ? rawRoomCode.trim() : '';
        if (trustedRoomCode && trustedRoomCode.length <= 128) {
            this._lobbyCode = trustedRoomCode;
            this.ui.setRoomCode(trustedRoomCode);
        }

        const pendingWelcome = this._pendingInitialLobbyWelcome;
        if (pendingWelcome) {
            this._applyInitialLobbyWelcome(pendingWelcome);
            this._pendingInitialLobbyWelcome = null;
        }
        this.game.onModeChange?.(this.game.mode?.id);
    }

    _setupClientNetHandlers() {
        this._setupReconnectUI();
        this.network.onKicked = (reason) => {
            this._exitToMenu(reason === 'password' ? 'Wrong lobby password.' : 'You were kicked from the lobby.');
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
                if (data?.type === 'welcome') this._pendingInitialLobbyWelcome = data;
                this.game.applyLobbyState(data);
                if (data?.type === 'lobbyState' && !this.network.isHost) {
                    this._applyClientLobbyStatePresentation(data);
                    this._syncClientLobbyIdentity(this.network.hostRoomCode);
                }
                if (data?.type === 'welcome') {
                    this._applyInitialLobbyWelcome(data);
                    const welcomeState = data.state || data.snapshot?.state;
                    if (welcomeState === STATES.SOCIAL_HUB) this._enterSocialLobby();
                    else if (welcomeState) {
                        const result = this.game.handleLateJoin?.(data);
                        if (result?.queued) this._enterLateJoinSpectator(result);
                    }
                }
            }
            // Mesh: on welcome, connect to all existing peers directly (skip host relay)
            if (data?.type === 'welcome' && !this.network.isHost && data.players) {
                void this._syncWearableLoadout();
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
        this.network.onHostMigration = ({ candidate }) => {
            this._stopHostCheckpointLifecycle();
            const banner = document.getElementById('host-migration-banner');
            const title = document.getElementById('host-migration-title');
            if (title) title.textContent = `${candidate?.name || 'Player'} is becoming host...`;
            banner?.classList.remove('hidden');
            requestAnimationFrame(() => {
                const progress = document.getElementById('host-migration-progress');
                if (progress) progress.style.width = '100%';
            });
        };
        this.network.onHostMigrated = ({ isHost, roomCode }) => {
            document.getElementById('host-migration-banner')?.classList.add('hidden');
            const progress = document.getElementById('host-migration-progress');
            if (progress) progress.style.width = '0%';
            this._lobbyCode = roomCode;
            if (isHost) {
                this._installMigratedHostHandlers(roomCode);
                this.game.ball._clientOnly = false;
                this._startBgLoop();
                this._startHostCheckpointLifecycle();
                this.ui.setRoomCode(roomCode);
                this.ui.showMessage?.('You are the new host. Match resumed.', 2600);
            } else {
                this._stopHostCheckpointLifecycle();
                this.ui.showMessage?.('Host migrated. Match resumed.', 2200);
            }
        };
    }

    _setupReconnectUI() {
        this.network.onReconnectState = (state, attempt) => {
            const status = document.getElementById('lobby-network-status');
            if (state === 'reconnecting') {
                this.productAnalytics.track('network_reconnect', { result: 'attempt' });
                this.ui.showMessage?.(`Reconnecting... ${attempt}/3`, 1800);
                if (status) {
                    status.textContent = `RECONNECTING ${attempt}/3`;
                    status.className = 'is-reconnecting';
                }
            } else if (state === 'migrating') {
                if (status) {
                    status.textContent = 'MIGRATING HOST';
                    status.className = 'is-reconnecting';
                }
            } else if (state === 'connected') {
                this.productAnalytics.track('network_reconnect', { result: 'success' });
                this.ui.showMessage?.('Reconnected', 1800);
                if (status) {
                    status.textContent = 'CONNECTED';
                    status.className = '';
                }
            } else {
                this.productAnalytics.track('network_disconnect', { reason: 'peer_closed' });
                if (status) {
                    status.textContent = 'DISCONNECTED';
                    status.className = 'is-offline';
                }
            }
        };
    }

    // Leave the lobby cleanly. Host closes it for everyone; clients just drop.
    leaveLobby() {
        this._stopHostCheckpointLifecycle();
        clearInterval(this._lobbyKeepAlive);
        this._stopBgLoop();
        this._cleanupListeners();
        if (this.network?.isHost && this._lobbyCode) this._unregisterLobby(this._lobbyCode);
        else if (this._lobbyCode) this._lobbyApi(`/api/lobbies/${encodeURIComponent(this._lobbyCode)}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        this._lobbyCode = null;
        this._exitPracticeSession();
        document.getElementById('practice-lab-hud')?.classList.add('hidden');
        // Tell peers + tear down the P2P connection.
        this.network?.closeLobby?.();
        this.game.cancelPreGame?.();
        this.game.ball.deactivate();
        this.game.setState(STATES.MENU);
        this._cleanupLobbyEntities();
        this.ui.showScreen('mainMenu');
    }

    // Shared cleanup when returning to the menu from a lobby (host or client).
    _exitToMenu(message) {
        this._stopHostCheckpointLifecycle();
        clearInterval(this._lobbyKeepAlive);
        this._stopBgLoop();
        this._cleanupListeners();
        if (!this.network?.isHost && this._lobbyCode) this._lobbyApi(`/api/lobbies/${encodeURIComponent(this._lobbyCode)}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        this._lobbyCode = null;
        this._exitPracticeSession();
        document.getElementById('practice-lab-hud')?.classList.add('hidden');
        this.network?.disconnect();
        this.game.cancelPreGame?.();
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
    // Lobby cross-tab bug audit: this used to swallow every failure into a bare `{}`,
    // so a broken fetch (offline dev server, CORS misconfig, non-2xx response) looked
    // identical to "server has zero lobbies" — nothing in the console, no way to tell
    // the two apart. Surface a console.warn and a distinct marker so _refreshLobbyList
    // can show "Lobby service unreachable" instead of the misleading empty-lobby state.
    _lobbyApi(path, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (account.getToken()) headers.Authorization = `Bearer ${account.getToken()}`;
        return fetch(path, { ...opts, headers }).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        }).catch(err => {
            console.warn('[lobby] API request failed:', path, err?.message || err);
            return { __lobbyApiError: true };
        });
    }

    async _registerLobby(code, name, players, map, mode) {
        const ranked = this.game.mode?.id === 'competitive' || this._rankedHosting === true;
        const result = await this._lobbyApi('/api/lobbies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code, name, hostName: this.game.playerName, players, map, mode,
                ranked,
                averageElo: ranked ? this.store.getElo() : undefined,
                maxPlayers: 8
            })
        });
        if (result?.__lobbyApiError || !result?.admissionToken) return false;
        if (!this.network?.isHost || this.network.hostRoomCode !== code) return false;
        this.network.setLobbyAdmissionToken(result.admissionToken);
        return true;
    }

    async _confirmLobbyAdmission(code) {
        const proof = await this.network.waitForLobbyAdmissionProof();
        if (!proof) throw new Error('Lobby admission proof was not received. Please try again.');
        const admitted = await this._lobbyApi(`/api/lobbies/${encodeURIComponent(code)}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admissionToken: proof })
        });
        if (!admitted?.ok) throw new Error('Lobby admission failed. Please try again.');
        return true;
    }

    async _unregisterLobby(code) {
        await this._lobbyApi(`/api/lobbies/${encodeURIComponent(code)}`, { method: 'DELETE' });
    }

    // Shared public-board presentation: reserve the list area for clear state
    // guidance, one primary host action, and the secondary join-by-code route.
    // This keeps an empty P2P directory useful without fabricating a room.
    _renderLobbyEmpty(container, message, state = 'empty') {
        const copy = {
            loading: { eyebrow: 'LIVE DIRECTORY', title: 'Finding public rooms', icon: 'i-globe' },
            error: { eyebrow: 'DIRECTORY OFFLINE', title: 'Public rooms unavailable', icon: 'i-refresh' },
            filtered: { eyebrow: 'FILTER RESULTS', title: 'No rooms match these filters', icon: 'i-globe' },
            empty: { eyebrow: 'PUBLIC ROOMS', title: 'No public rooms right now', icon: 'i-globe' }
        }[state] || { eyebrow: 'PUBLIC ROOMS', title: 'No public rooms right now', icon: 'i-globe' };
        container.dataset.lobbyState = state;
        container.toggleAttribute('aria-busy', state === 'loading');
        container.innerHTML = `
            <div class="mp-lobby-empty" data-empty-kind="${this._esc(state)}">
                <span class="mp-lobby-empty-icon" aria-hidden="true"><svg class="ui-icon"><use href="#${copy.icon}"></use></svg></span>
                <span class="shell-kicker">${copy.eyebrow}</span>
                <h3>${copy.title}</h3>
                <p>${this._esc(message)}</p>
                <p class="mp-lobby-empty-code">Have a room code? <button class="mp-lobby-empty-join" type="button">Join by Code</button></p>
                <button class="btn btn-primary btn-small mp-lobby-empty-cta" type="button">Host a game</button>
                <small><i></i> Public rooms refresh automatically</small>
            </div>`;
    }

    async _refreshLobbyList() {
        const list = await this._lobbyApi('/api/lobbies', { method: 'GET' });
        const container = document.getElementById('mp-lobby-list');
        if (!container) return;
        if (list?.__lobbyApiError) {
            this._renderLobbyEmpty(container, 'Lobby service unreachable. Check your connection and try again.', 'error');
            return;
        }
        if (!Array.isArray(list) || list.length === 0) {
            this._renderLobbyEmpty(container, 'No open lobbies right now.');
            return;
        }
        const modeFilter = document.getElementById('mp-lobby-mode-filter');
        const mapFilter = document.getElementById('mp-lobby-map-filter');
        const queueFilter = document.getElementById('mp-lobby-queue-filter');
        const openFilter = document.getElementById('mp-lobby-open-filter');
        if (modeFilter) {
            const selected = modeFilter.value || 'all';
            const modes = [...new Set(list.map(l => l.mode).filter(Boolean))].sort();
            modeFilter.replaceChildren(new Option('All modes', 'all'), ...modes.map(mode => new Option(mode, mode)));
            modeFilter.value = modes.includes(selected) ? selected : 'all';
        }
        const filtered = filterLobbies(list, {
            mode: modeFilter?.value,
            map: mapFilter?.value,
            queue: queueFilter?.value,
            openOnly: openFilter?.checked
        });
        if (!filtered.length) {
            this._renderLobbyEmpty(container, 'Try widening mode, map, queue, or open-slot filters.', 'filtered');
            return;
        }
        const now = Date.now();
        container.dataset.lobbyState = 'populated';
        container.removeAttribute('aria-busy');
        container.innerHTML = filtered.map(l => {
            const { players, maxPlayers } = lobbyCapacity(l);
            return `
            <div class="mp-lobby-card" data-code="${this._esc(l.code)}">
                <div class="lobby-icon">🏐</div>
                <div class="lobby-info">
                    <div class="lobby-name">${this._esc(l.name || 'Lobby')}</div>
                    <div class="lobby-meta">${this._esc(l.hostName)} · ${this._esc(l.map)} · ${this._esc(formatLobbyAge(l.lastSeen ?? l.updatedAt, now))}</div>
                </div>
                <div class="lobby-mode-badge">MODE: ${this._esc(l.mode || 'Classic')}</div>
                <div class="lobby-players">👤 ${players}/${maxPlayers}</div>
                <button class="btn btn-primary btn-join btn-small">Join</button>
            </div>
        `;
        }).join('');
        // Quick join click
        container.querySelectorAll('.mp-lobby-card').forEach(card => {
            card.querySelector('.btn-join').addEventListener('click', (e) => {
                e.stopPropagation();
                this._quickJoin(card.dataset.code);
            });
        });
    }

    async _startQuickPlay() {
        const button = document.getElementById('btn-mp-quick');
        const queue = document.getElementById('quick-play-queue')?.value || 'casual';
        const modeId = document.getElementById('quick-play-mode')?.value || 'all';
        const mapId = document.getElementById('quick-play-map')?.value || 'all';
        const mode = modeId === 'all' ? 'all' : GAME_MODES[modeId]?.name || modeId;
        const map = mapId === 'all' ? '' : Arena.MAPS[mapId]?.name || mapId;
        const quickPlayStartedAt = performance.now();
        const quickDimensions = { queue, mode: modeId, map: mapId };
        const party = Friends.party;
        const partySize = party?.memberAccountIds?.length || 1;
        const partyQuickPlay = queue === 'casual' && partySize > 1;
        if (partyQuickPlay && !Friends.isPartyLeader(account.getAccount()?.id)) {
            this.ui.showMessage?.('Only the party leader can start Casual Quick Play.', 2200);
            return;
        }
        if (partyQuickPlay && !await this._beginPartyCasualQueue(party)) return;
        this.productAnalytics.track('quick_play_click', quickDimensions);
        this._analyticsMatchEntry = 'quick_play';
        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        try {
            const lobbies = await this._lobbyApi('/api/lobbies', { method: 'GET' });
            const match = partyQuickPlay
                ? pickQuickLobby(lobbies, { queue, mode, map, openOnly: true, minOpenSlots: partySize })
                : pickQuickLobby(lobbies, { queue, mode, map, openOnly: true });
            if (match) {
                const joined = await this._quickJoin(match.code, { ...quickDimensions, quickPlayStartedAt });
                if (partyQuickPlay && joined) await this._publishPartyLobbyTarget(match.code, party);
                return;
            }
            const hostedMode = queue === 'ranked' ? 'competitive' : modeId;
            if (hostedMode !== 'all' && GAME_MODES[hostedMode]) this.game.selectMode(hostedMode);
            if (mapId !== 'all' && Arena.MAPS[mapId] && !Arena.MAPS[mapId].hiddenFromRotation) {
                this.game.selectMap(mapId);
            }
            this._rankedHosting = queue === 'ranked';
            this.ui.showMessage?.(`No matching ${queue} lobby - creating one.`, 1800);
            const hosted = await this._doHostGame();
            if (!hosted) {
                this.productAnalytics.track('quick_play_failure', { ...quickDimensions, result: 'host_error' });
                return;
            }
            if (partyQuickPlay) await this._publishPartyLobbyTarget(this._lobbyCode, party);
            const joinLatencyMs = Math.max(0, performance.now() - quickPlayStartedAt);
            this.productAnalytics.track('quick_play_success', {
                ...quickDimensions,
                result: 'hosted',
                latencyBucket: joinLatencyBucket(joinLatencyMs)
            }, { joinLatencyMs });
        } catch {
            this.productAnalytics.track('quick_play_failure', { ...quickDimensions, result: 'error' });
            this.ui.showMessage?.('Quick Play is unavailable. Please try again.', 2200);
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    }

    _esc(s) { return String(s).replace(/[<>&"']/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m])); }

    async _quickJoin(code, quickPlay = null) {
        const name = document.getElementById('player-name-input')?.value || 'Player';
        try {
            this._setupClientNetHandlers();
            await this.network.joinGame(code, name);
            this._lobbyCode = code;
            await this._confirmLobbyAdmission(code);
            this.game.playerName = name;
            // ponytail: bg loop runs client-side interpolation + state handling throughout the game
            this._startBgLoop();
            this.ui.showScreen('lobby');
            this._finalizeClientLobbyJoin(code);
            this.ui.showMessage?.('🔗 Joined lobby!', 2000);
            this.productAnalytics.track('lobby_join', { networkRole: 'client' });
            this.productAnalytics.track('network_role', { networkRole: 'client' });
            if (quickPlay?.quickPlayStartedAt) {
                const joinLatencyMs = Math.max(0, performance.now() - quickPlay.quickPlayStartedAt);
                this.productAnalytics.track('quick_play_success', {
                    queue: quickPlay.queue,
                    mode: quickPlay.mode,
                    map: quickPlay.map,
                    result: 'joined',
                    latencyBucket: joinLatencyBucket(joinLatencyMs)
                }, { joinLatencyMs });
            }
            return true;
        } catch (e) {
            if (quickPlay?.quickPlayStartedAt) this.productAnalytics.track('quick_play_failure', {
                queue: quickPlay.queue, mode: quickPlay.mode, map: quickPlay.map, result: 'join_error'
            });
            alert('Failed to join: ' + e.message);
            return false;
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
            this._lobbyName = 'Lobby';
            // ponytail: bg loop is the authoritative host sim — must run regardless of tab visibility
            this._startBgLoop();
            this.game.startSolo();
            this._startHostCheckpointLifecycle();
            this.ui.setRoomCode(code);
            this.ui.showScreen('lobby');
            this.productAnalytics.track('lobby_host', { networkRole: 'host' });
            this.productAnalytics.track('network_role', { networkRole: 'host' });
            const nameInput = document.getElementById('lobby-name-input');
            if (nameInput) { nameInput.disabled = false; nameInput.value = 'Lobby'; }
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
            this.network.onPlayerJoin = (pName, playerId, avatar, peerId, avatarModel) => {
                const existing = this.game.remotePlayers.has(playerId);
                this.game.addRemotePlayer(playerId, pName, null, avatar, peerId, avatarModel);
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
                this._registerLobby(code, this._lobbyName, this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
            };
            this.network.onPlayerLeave = (playerId, peerId) => {
                this.game.removeRemotePlayer(playerId);
                this.ui.showMessage?.('A player left');
                this.game.updateLobbyUI();
                this.refreshFriendsSidebar();
                // Mesh: tell remaining clients to drop P2P connection
                this.network.broadcast({ type: 'peerLeft', playerId, peerId });
                this.broadcastLobbyState();
                this._syncRematchRoster?.();
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
            const registered = await this._registerLobby(
                code,
                this._lobbyName,
                1,
                this.arena?.config?.name || 'Unknown',
                this.game.mode?.name || 'Classic'
            );
            if (!registered) {
                this.network.disconnect();
                throw new Error('Lobby service registration failed. Please try again.');
            }
            this.ui.showMessage?.(`🏠 Lobby created! Code: ${code}`, 3000);
            // Auto-re-register every 12s to keep lobby alive
            this._lobbyKeepAlive = setInterval(() => {
                if (this.network.connected && this.network.isHost) {
                    this._registerLobby(this._lobbyCode || code, this._lobbyName, this.network.connections.size + 1, this.arena?.config?.name || 'Unknown', this.game.mode?.name || 'Classic');
                }
            }, 12000);
            this._lobbyCode = code;
            return true;
        } catch (e) {
            alert('Failed to create lobby: ' + e.message);
            return false;
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
            this.socialProfile = setMuted(this.socialProfile, name, false);
            this.ui.showMessage?.(`${name} unmuted.`, 1200);
        } else {
            this._mutedPlayers.add(name);
            this.socialProfile = setMuted(this.socialProfile, name, true);
            this.socialProfile = reportPlayer(this.socialProfile, { name, reason: 'scoreboard' });
            this.ui.showMessage?.(`${name} muted. Local report saved.`, 1600);
        }
        this.store.set('mutedPlayers', [...this._mutedPlayers].slice(-100));
        this._saveSocialProfile();
    }

    _changeRoundClass(charId) {
        const character = CHARACTERS[charId];
        if (!character || this.player.charId === charId) return false;
        const round = Number(this.game.scoreboard?.roundNum) || 0;
        if (this.game.state === STATES.PLAYING && this.player._classChangeRound === round) {
            this.ui.showMessage?.('You can change class once per round.', 1800);
            return false;
        }
        const loadout = this.store.getCardEffects?.(this.game.mode?.id) || this.store.get('loadout') || DEFAULT_LOADOUT;
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
        this.player.setHandTemporarilyVisible?.(false);
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
        Friends.onChange = () => {
            this.refreshFriendsSidebar();
            if (document.body.dataset.screen === 'socialCenter') this._renderSocialCenter();
        };
        this._chattingWith = null;
        this._friendsRailTab = 'friends';
        this._socialRailLoaded = false;
        this._socialRailSyncing = false;
        this._socialRailError = '';
        const preferences = this._socialDiscoveryPreferences();
        const discoverable = document.getElementById('fbar-discoverable');
        if (discoverable) discoverable.checked = preferences.discoverable;

        const desktopToggle = document.getElementById('fbar-toggle');
        const sidebar = document.getElementById('friends-sidebar');
        const mobileRailQuery = window.matchMedia?.('(max-width: 760px)');
        const compactRailQuery = window.matchMedia?.('(min-width: 761px) and (max-width: 1339px)');
        const setDesktopRailExpanded = expanded => {
            if (!sidebar || !desktopToggle) return false;
            const next = expanded === true;
            sidebar.classList.toggle('collapsed', !next);
            desktopToggle.setAttribute('aria-expanded', String(next));
            desktopToggle.setAttribute('aria-label', next ? 'Collapse social panel' : 'Open social panel');
            desktopToggle.querySelector('use')?.setAttribute('href', next ? '#i-arrow-left' : '#i-arrow-right');
            return next;
        };
        const syncDesktopRailLayout = () => {
            if (mobileRailQuery?.matches) return;
            // Wide desktop is the social-first composition. Compact desktop
            // keeps the same panel as an overlay and exposes only its 44px handle.
            setDesktopRailExpanded(compactRailQuery?.matches !== true);
        };
        desktopToggle?.addEventListener('click', () => {
            if (!sidebar) return;
            setDesktopRailExpanded(sidebar.classList.contains('collapsed'));
        });
        document.getElementById('fbar-sheet-handle')?.addEventListener('click', () => {
            const sidebar = document.getElementById('friends-sidebar');
            this._setMobileSocialRailOpen(!sidebar?.classList.contains('mobile-open'));
        });
        document.getElementById('friends-sidebar')?.addEventListener('keydown', event => {
            if (event.key === 'Escape' && event.currentTarget.classList.contains('mobile-open')) {
                event.preventDefault();
                this._setMobileSocialRailOpen(false);
            }
        });
        this._setMobileSocialRailOpen(false, { moveFocus: false });
        syncDesktopRailLayout();
        mobileRailQuery?.addEventListener?.('change', () => {
            this._setMobileSocialRailOpen(false, { moveFocus: false });
            syncDesktopRailLayout();
        }, { signal: this._mainAbort.signal });
        compactRailQuery?.addEventListener?.('change', syncDesktopRailLayout, { signal: this._mainAbort.signal });
        const socialTabs = [...document.querySelectorAll('[data-fbar-tab]')];
        socialTabs.forEach(button => button.addEventListener('click', () => this._setFriendsRailTab(button.dataset.fbarTab)));
        document.querySelector('.fbar-tabs')?.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const current = socialTabs.indexOf(document.activeElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? socialTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + socialTabs.length) % socialTabs.length;
            socialTabs[next]?.focus();
            this._setFriendsRailTab(socialTabs[next]?.dataset.fbarTab);
        });
        this._setFriendsRailTab(this._friendsRailTab);
        const savePresence = () => {
            const next = this._saveSocialDiscoveryPreferences(discoverable?.checked !== false, 'global');
            this._presenceHeartbeatNow?.();
            Friends.refreshAvailable('global').then(() => this.refreshFriendsSidebar());
        };
        discoverable?.addEventListener('change', savePresence);
        document.getElementById('fbar-party-leave')?.addEventListener('click', async () => {
            const result = await Friends.leaveParty();
            if (result.error) this.ui.showMessage?.(result.error, 1800);
            this.refreshFriendsSidebar();
        });
        for (const id of ['fbar-party-follow', 'btn-menu-party-follow', 'btn-mp-party-follow', 'btn-join-party-follow']) {
            document.getElementById(id)?.addEventListener('click', () => this._followPartyLobbyTarget({ manual: true }));
        }
        document.getElementById('party-invite-accept')?.addEventListener('click', () => this._actOnPresentedPartyInvite('accept'));
        document.getElementById('party-invite-decline')?.addEventListener('click', () => this._actOnPresentedPartyInvite('decline'));
        document.getElementById('party-invite-dialog')?.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); this._actOnPresentedPartyInvite('decline'); }
            if (event.key === 'Tab') {
                const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
                if (!buttons.length) return;
                const index = buttons.indexOf(document.activeElement);
                const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index >= buttons.length - 1 ? 0 : index + 1);
                event.preventDefault();
                buttons[next].focus();
            }
        });

        const submitFriendRequest = async () => {
            const input = document.getElementById('fbar-add-input');
            const submit = document.getElementById('fbar-add-submit');
            const status = document.getElementById('fbar-add-status');
            const friendTag = input?.value.trim();
            if (!friendTag) { if (status) status.textContent = 'Enter a profile code first.'; input?.focus(); return; }
            if (submit) { submit.disabled = true; submit.textContent = 'Sending'; }
            if (status) status.textContent = 'Sending friend request...';
            const result = await Friends.request(friendTag);
            if (submit) { submit.disabled = false; submit.textContent = 'Send'; }
            if (result.error) {
                if (status) status.textContent = result.error;
                this.ui.showMessage?.(result.error, 1800);
                return;
            }
            input.value = '';
            if (status) status.textContent = 'Friend request sent.';
        };
        document.getElementById('fbar-add-toggle')?.addEventListener('click', () => {
            const toggle = document.getElementById('fbar-add-toggle');
            const form = document.getElementById('fbar-add-form');
            if (!toggle || !form) return;
            const expanded = form.classList.toggle('hidden') === false;
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.classList.toggle('is-open', expanded);
            if (expanded) document.getElementById('fbar-add-input')?.focus();
        });
        document.getElementById('fbar-add-submit')?.addEventListener('click', submitFriendRequest);
        document.getElementById('fbar-add-input')?.addEventListener('keydown', e => {
            if (e.code !== 'Enter') return;
            e.preventDefault();
            submitFriendRequest();
        });
        document.getElementById('fbar-own-tag')?.addEventListener('click', async () => {
            const tag = account.getFriendTag();
            if (!tag) return;
            try { await navigator.clipboard?.writeText(tag); this.ui.showMessage?.('Friend tag copied.', 1200); } catch { this.ui.showMessage?.(tag, 2200); }
        });

        document.getElementById('fbar-chat-send')?.addEventListener('click', () => this._sendFriendDM());
        document.getElementById('fbar-chat-input')?.addEventListener('keydown', e => {
            if (e.code === 'Enter') this._sendFriendDM();
        });
        document.getElementById('fbar-chat-close')?.addEventListener('click', () => {
            this._chattingWith = null;
            document.getElementById('fbar-chat')?.classList.add('hidden');
        });

        Friends.onDM = (friendId) => {
            if (this._chattingWith === friendId) this._renderChatThread(friendId);
        };
    }

    refreshFriendsSidebar() {
        const directory = document.getElementById('fbar-directory');
        const countEl = document.getElementById('fbar-count');
        const sheetCount = document.getElementById('fbar-sheet-count');
        const syncState = document.getElementById('fbar-sync-state');
        const directoryTitle = document.getElementById('fbar-directory-title');
        const ownTag = document.getElementById('fbar-own-tag');
        if (!directory) return;
        const ownCode = account.getFriendTag() || 'Profile code unavailable';
        const ownCodeNode = document.getElementById('fbar-own-tag-code');
        if (ownCodeNode) ownCodeNode.textContent = ownCode;
        if (ownTag) ownTag.setAttribute('aria-label', `Copy profile code ${ownCode}`);
        const online = Friends.friends.filter(friend => Friends.isOnline(friend));
        const onlineLabel = `${online.length} online`;
        if (countEl) {
            countEl.replaceChildren();
            const dot = document.createElement('i');
            dot.setAttribute('aria-hidden', 'true');
            countEl.append(dot, onlineLabel);
        }
        if (sheetCount) sheetCount.textContent = onlineLabel;
        if (syncState) {
            syncState.textContent = this._socialRailSyncing ? 'Syncing' : this._socialRailError ? 'Offline' : 'Live';
            syncState.dataset.state = this._socialRailError ? 'error' : this._socialRailSyncing ? 'loading' : 'live';
        }
        if (directoryTitle) directoryTitle.textContent = this._friendsRailTab === 'nearby' ? 'Nearby players' : this._friendsRailTab === 'online' ? 'Friends online' : 'All friends';
        const currentAccountId = account.getAccount()?.id;
        const partyMembers = new Set(Friends.party?.memberAccountIds || []);
        const canInvite = Friends.isPartyLeader(currentAccountId);
        let players;
        if (this._friendsRailTab === 'nearby') players = Friends.available.map(player => ({ ...player, id: player.accountId, online: true, nearby: true }));
        else if (this._friendsRailTab === 'online') players = online.map(friend => ({ ...friend, online: true }));
        else players = Friends.friends.map(friend => ({ ...friend, online: Friends.isOnline(friend) })).sort((left, right) => Number(right.online) - Number(left.online) || String(left.username).localeCompare(String(right.username)));
        const row = player => {
            const item = document.createElement('div');
            item.className = 'fbar-friend';
            item.dataset.presence = player.online ? 'online' : 'offline';
            const avatar = document.createElement('div');
            avatar.className = `fbar-avatar ${player.online ? 'online-avatar' : 'offline-avatar'}`;
            avatar.textContent = String(player.username || 'P').slice(0, 1).toUpperCase();
            const dot = document.createElement('span');
            dot.className = `fbar-status-dot ${player.online ? 'online' : 'offline'}`;
            avatar.append(dot);
            const identity = document.createElement('span');
            identity.className = 'fbar-identity';
            const name = document.createElement('b');
            name.className = 'fbar-name';
            name.textContent = String(player.username || 'Player');
            const state = document.createElement('small');
            state.textContent = player.nearby ? `${player.sameRegion ? 'Your region' : (player.region || 'Global')} / ${player.state || 'menu'}` : (player.friendTag || (player.online ? 'Available to play' : 'Offline'));
            identity.append(name, state);
            const presence = document.createElement('span');
            presence.className = 'fbar-presence-badge';
            presence.dataset.state = player.online ? (player.state || 'online') : 'offline';
            presence.textContent = player.online ? (player.state === 'lobby' ? 'IN LOBBY' : player.state === 'social' ? 'IN HUB' : 'ONLINE') : 'OFFLINE';
            const actions = document.createElement('div');
            actions.className = 'fbar-actions';
            if (Friends.getFriend(player.id)) {
                const message = document.createElement('button');
                message.className = 'fbar-msg-btn';
                message.type = 'button';
                message.setAttribute('aria-label', `Message ${player.username || 'friend'}`);
                message.title = 'Message';
                message.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="#i-message"></use></svg>';
                message.addEventListener('click', () => this._openChatWith(player.id));
                actions.append(message);
            }
            if (player.online && canInvite && player.id !== currentAccountId && !partyMembers.has(player.id)) {
                const invite = document.createElement('button');
                invite.className = 'fbar-invite-btn';
                invite.type = 'button';
                invite.setAttribute('aria-label', `Invite ${player.username || 'player'} to party`);
                invite.title = 'Invite to party';
                invite.innerHTML = '<svg class="ui-icon" aria-hidden="true"><use href="#i-user-plus"></use></svg>';
                invite.addEventListener('click', async () => {
                    invite.disabled = true;
                    invite.classList.add('is-loading');
                    const result = await Friends.inviteToParty(player.id);
                    invite.disabled = false;
                    invite.classList.remove('is-loading');
                    this.ui.showMessage?.(result.error || 'Party invite sent.', 1600);
                    this.refreshFriendsSidebar();
                });
                actions.append(invite);
            }
            const detail = document.createElement('div');
            detail.className = 'fbar-row-detail';
            detail.append(identity, presence);
            item.append(avatar, detail, actions);
            return item;
        };
        const emptyState = () => {
            const empty = document.createElement('div');
            empty.className = 'fbar-empty-state';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'ui-icon');
            icon.setAttribute('aria-hidden', 'true');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', this._socialRailError ? '#i-refresh' : '#i-users');
            icon.append(use);
            const title = document.createElement('strong');
            const copy = document.createElement('span');
            const action = document.createElement('button');
            action.type = 'button';
            if (this._socialRailError) {
                title.textContent = 'Social is offline';
                copy.textContent = 'We could not refresh players. Your game is still available.';
                action.textContent = 'Retry';
                action.addEventListener('click', () => this._socialPollNow?.());
            } else if (this._friendsRailTab === 'nearby') {
                title.textContent = 'No nearby players yet';
                copy.textContent = 'Stay discoverable and try again shortly.';
                action.textContent = 'Refresh nearby';
                action.addEventListener('click', () => this._socialPollNow?.());
            } else if (this._friendsRailTab === 'online') {
                title.textContent = 'Your squad is offline';
                copy.textContent = 'Invite new friends with a profile code.';
                action.textContent = 'Add a friend';
                action.addEventListener('click', () => document.getElementById('fbar-add-toggle')?.click());
            } else {
                title.textContent = 'Find friends to team up';
                copy.textContent = 'Add friends using their profile code.';
                action.textContent = 'Add a friend';
                action.addEventListener('click', () => document.getElementById('fbar-add-toggle')?.click());
            }
            empty.append(icon, title, copy, action);
            return empty;
        };
        directory.setAttribute('aria-busy', String(this._socialRailSyncing));
        if (this._socialRailSyncing && !this._socialRailLoaded && !players.length) {
            directory.replaceChildren(...Array.from({ length: 3 }, () => {
                const skeleton = document.createElement('div');
                skeleton.className = 'fbar-skeleton';
                skeleton.innerHTML = '<i></i><span></span><b></b>';
                return skeleton;
            }));
        } else directory.replaceChildren(...(players.length ? players.map(row) : [emptyState()]));
        this._renderAuthoritativeParty();
        this._renderMenuPartyRail();
        if (this._chattingWith) this._renderChatThread(this._chattingWith);
    }

    _setFriendsRailTab(tab) {
        this._friendsRailTab = ['friends', 'online', 'nearby'].includes(tab) ? tab : 'friends';
        document.querySelectorAll('[data-fbar-tab]').forEach(button => {
            const selected = button.dataset.fbarTab === this._friendsRailTab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        this.refreshFriendsSidebar();
    }

    _setMobileSocialRailOpen(open, { moveFocus = true } = {}) {
        const sidebar = document.getElementById('friends-sidebar');
        const body = document.getElementById('fbar-body');
        const handle = document.getElementById('fbar-sheet-handle');
        if (!sidebar || !body || !handle) return false;
        const mobile = window.matchMedia?.('(max-width: 760px)').matches === true;
        const expanded = mobile && open === true;
        sidebar.classList.toggle('mobile-open', expanded);
        handle.setAttribute('aria-expanded', String(expanded));
        handle.setAttribute('aria-label', expanded ? 'Close social and party panel' : 'Open social and party panel');
        body.inert = mobile && !expanded;
        body.setAttribute('aria-hidden', String(mobile && !expanded));
        if (moveFocus) {
            if (expanded) document.querySelector('[data-fbar-tab][aria-selected="true"]')?.focus();
            else handle.focus();
        }
        return expanded;
    }

    _renderAuthoritativeParty() {
        const list = document.getElementById('fbar-party-members');
        const count = document.getElementById('fbar-party-count');
        const leave = document.getElementById('fbar-party-leave');
        const queue = document.getElementById('fbar-party-queue');
        const follow = document.getElementById('fbar-party-follow');
        if (!list) return;
        const myId = account.getAccount()?.id;
        const party = Friends.party;
        const members = party?.memberAccountIds?.length ? party.memberAccountIds : (myId ? [myId] : []);
        if (count) count.textContent = `${Math.max(1, members.length)} / ${party?.maxMembers || 8}`;
        if (leave) leave.hidden = !party;
        const leader = party?.leaderAccountId === myId;
        const targetReady = !!this._partyLobbyTarget && this._partyLobbyTarget.partyRevision === party?.revision;
        const canFollow = targetReady && !leader && this._canFollowPartyLobby();
        if (queue) {
            queue.hidden = !this._partyQueueState && !targetReady;
            queue.textContent = this._partyQueueState && !leader
                ? 'Leader is choosing a casual lobby…'
                : targetReady && !leader ? 'Squad lobby is ready.' : targetReady ? 'Squad lobby ready.' : '';
        }
        if (follow) {
            follow.hidden = !canFollow;
            follow.disabled = this._partyFollowInFlight;
            follow.textContent = this._partyFollowInFlight ? 'Joining squad…' : 'Join squad';
        }
        for (const id of ['btn-menu-party-follow', 'btn-mp-party-follow', 'btn-join-party-follow']) {
            const action = document.getElementById(id);
            if (!action) continue;
            action.hidden = !canFollow;
            action.disabled = this._partyFollowInFlight;
            action.textContent = this._partyFollowInFlight ? 'Joining squad…' : 'Join squad';
        }
        list.replaceChildren(...members.map(memberId => {
            const row = document.createElement('div');
            row.className = 'fbar-party-member';
            const memberName = this._socialAccountName(memberId);
            const avatar = document.createElement('span');
            avatar.className = 'fbar-party-avatar';
            avatar.textContent = memberName.slice(0, 1).toUpperCase();
            const identity = document.createElement('span');
            identity.className = 'fbar-party-identity';
            const name = document.createElement('b');
            name.textContent = memberName;
            const role = document.createElement('small');
            role.textContent = party?.leaderAccountId === memberId ? 'Leader' : memberId === myId ? 'You' : 'Member';
            identity.append(name, role);
            const status = document.createElement('em');
            status.textContent = memberId === myId ? 'YOU' : 'READY';
            row.append(avatar, identity, status);
            return row;
        }));
    }

    _presentPendingPartyInvite() {
        if (document.body.dataset.screen !== 'mainMenu' || PARTY_INVITE_BLOCKED_STATES.has(this.game.state)) {
            this._closePartyInviteDialog();
            return false;
        }
        const myId = account.getAccount()?.id;
        const invite = Friends.partyInvites.find(item => item.recipientAccountId === myId && item.expiresAt > Date.now());
        if (!invite) { this._closePartyInviteDialog(); return false; }
        if (this._presentedPartyInviteId === invite.id) return true;
        this._closePartyInviteDialog();
        this._presentedPartyInviteId = invite.id;
        this._partyInviteFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = document.getElementById('party-invite-dialog');
        const copy = document.getElementById('party-invite-copy');
        if (copy) copy.textContent = `${this._socialAccountName(invite.senderAccountId)} invited you to their party.`;
        dialog?.classList.remove('hidden');
        const updateCountdown = () => {
            const seconds = Math.max(0, Math.ceil((invite.expiresAt - Date.now()) / 1000));
            const output = document.getElementById('party-invite-countdown');
            if (output) output.textContent = `${seconds}s`;
            if (seconds <= 0) { this._closePartyInviteDialog(); this._socialPollNow?.(); }
        };
        updateCountdown();
        this._partyInviteCountdownTimer = setInterval(updateCountdown, 250);
        document.getElementById('party-invite-accept')?.focus();
        return true;
    }

    async _actOnPresentedPartyInvite(action) {
        const inviteId = this._presentedPartyInviteId;
        if (!inviteId) return;
        this._closePartyInviteDialog();
        const result = await Friends.actOnPartyInvite(inviteId, action);
        if (result.error) this.ui.showMessage?.(result.error, 1800);
        this.refreshFriendsSidebar();
        this._socialPollNow?.();
    }

    _closePartyInviteDialog() {
        if (this._partyInviteCountdownTimer) clearInterval(this._partyInviteCountdownTimer);
        this._partyInviteCountdownTimer = null;
        this._presentedPartyInviteId = null;
        document.getElementById('party-invite-dialog')?.classList.add('hidden');
        const focusReturn = this._partyInviteFocusReturn;
        this._partyInviteFocusReturn = null;
        if (document.body.dataset.screen === 'mainMenu' && focusReturn?.isConnected) focusReturn.focus();
    }

    _openChatWith(name) {
        this._chattingWith = name;
        document.getElementById('fbar-chat')?.classList.remove('hidden');
        document.getElementById('fbar-chat-name').textContent = Friends.getFriend(name)?.username || 'Friend';
        Friends.loadMessages(name).then(() => this._renderChatThread(name));
        this._renderChatThread(name);
    }

    _renderChatThread(name) {
        const log = document.getElementById('fbar-chat-log');
        if (!log) return;
        const safeMessages = Friends.getMessages(name);
        if (!safeMessages.length) {
            const empty = document.createElement('div');
            empty.className = 'friends-sidebar-empty';
            empty.textContent = 'No messages yet';
            log.replaceChildren(empty);
            return;
        }
        const myId = account.getAccount()?.id;
        log.replaceChildren(...safeMessages.map(message => {
            const row = document.createElement('div');
            row.className = `friends-chat-msg ${message.senderAccountId === myId ? 'msg-mine' : ''}`;
            const from = document.createElement('span'); from.className = 'msg-from'; from.textContent = message.senderAccountId === myId ? 'You' : (Friends.getFriend(name)?.username || 'Friend');
            const body = document.createElement('span'); body.className = 'msg-text'; body.textContent = String(message.body || '');
            row.append(from, body); return row;
        }));
        log.scrollTop = log.scrollHeight;
    }

    _sendFriendDM() {
        const input = document.getElementById('fbar-chat-input');
        const text = input?.value.trim();
        if (!text || !this._chattingWith) return;
        input.value = '';
        Friends.sendMessage(this._chattingWith, text).then(result => {
            if (result.error) this.ui.showMessage?.(result.error, 1800);
            this._renderChatThread(this._chattingWith);
        });
    }

    _escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    openChat() {
        this.ui.hideScoreboard();
        this.ui._openExclusive('chat', () => this.closeChat());
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
        this.ui._closeExclusive('chat');
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
            // Offline RAF is suspended by browsers. Settle only the already
            // incoming ball; player input, bots and the match clock stay paused.
            if (!this.network?.connected && this.game.armIncomingSettlement?.()) this._startBgLoop();
            if (this.audio?.ctx?.state === 'running') this.audio.ctx.suspend();
        } else {
            this._tabHidden = false;
            this.game.cancelIncomingSettlement?.();
            if (!this.network?.connected) this._stopBgLoop();
            if (this.audio?.ctx?.state === 'suspended') this.audio.ctx.resume();
        }
    }
    _publishHostCheckpointIfChanged() {
        const network = this.network;
        if (!network?.connected || !network.isHost
            || typeof network.publishHostCheckpoint !== 'function') return false;
        let state;
        let signature;
        try {
            state = this.game?.snapshotState?.();
            if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
            signature = JSON.stringify(state);
        } catch (_) {
            return false;
        }
        if (!signature || signature.length > HOST_CHECKPOINT_SIGNATURE_MAX_CHARS) return false;
        const epoch = Number.isSafeInteger(network.migrationEpoch) ? network.migrationEpoch : 0;
        const versionedSignature = `${epoch}:${signature}`;
        if (versionedSignature === this._lastHostCheckpointSignature) return false;
        let checkpoint;
        try {
            checkpoint = network.publishHostCheckpoint(state);
        } catch (_) {
            return false;
        }
        if (!checkpoint
            || !Number.isSafeInteger(checkpoint.epoch)
            || !Number.isSafeInteger(checkpoint.sequence)) return false;
        this._lastHostCheckpointSignature = versionedSignature;
        this._lastHostCheckpointEpoch = checkpoint.epoch;
        this._lastHostCheckpointSequence = checkpoint.sequence;
        return true;
    }

    _startHostCheckpointLifecycle() {
        this._stopHostCheckpointLifecycle();
        if (!this.network?.connected || !this.network.isHost) return false;
        const generation = this._hostCheckpointGeneration;
        this._publishHostCheckpointIfChanged();
        this._hostCheckpointInterval = setInterval(() => {
            if (generation !== this._hostCheckpointGeneration
                || !this.network?.connected
                || !this.network.isHost) {
                if (generation === this._hostCheckpointGeneration) {
                    this._stopHostCheckpointLifecycle();
                }
                return;
            }
            this._publishHostCheckpointIfChanged();
        }, HOST_CHECKPOINT_INTERVAL_MS);
        return true;
    }

    _stopHostCheckpointLifecycle() {
        if (this._hostCheckpointInterval !== null) {
            clearInterval(this._hostCheckpointInterval);
            this._hostCheckpointInterval = null;
        }
        this._hostCheckpointGeneration = Number.isSafeInteger(this._hostCheckpointGeneration)
            ? this._hostCheckpointGeneration + 1
            : 1;
        this._lastHostCheckpointSignature = null;
        this._lastHostCheckpointEpoch = null;
        this._lastHostCheckpointSequence = null;
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
            if (!this.network?.connected && !this.game.hasPendingIncomingSettlement?.()) {
                this._stopBgLoop();
                return;
            }
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
            // The RAF is the sole visible-tab host publisher. The interval only
            // takes over transport publication once browsers throttle RAF.
            if (document.hidden && this.game.state === STATES.PLAYING) {
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
        const settlingIncoming = this.game.hasPendingIncomingSettlement?.() === true;
        // Remote player lerp always
        if (document.hidden) {
            this.game.invokeRemoteSnapshots(dt);
            this.game.invokeBallSmoothing?.(dt);
            const advancesPlayer = this.game.state === STATES.PLAYING
                || this.game.state === STATES.ROUND_END
                || this.game.state === STATES.COUNTDOWN
                || this.game.state === STATES.CELEBRATION;
            if (advancesPlayer && !settlingIncoming && !Spectator.active && !this.ui.isTeamPopupOpen?.()) {
                this.player.update(dt);
            }
        }
        // Process attack queue (bg tab hidden icin — main loop calismaz)
        this._bgProcessAttackQueue();
        // Game simulation only for host (all states need update — round timing, celebration, etc.)
        if (settlingIncoming) {
            this.game.updateIncomingSettlement?.(dt);
        } else if (this.network?.isHost) {
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
    // Hidden-tab host publisher: score 2Hz, powerUp 2Hz, ballState 30Hz.
    _hostBgSlowBroadcast(dt) {
        // Never publish alongside the foreground RAF: duplicate ball snapshots
        // waste bandwidth and can arrive out of cadence on P2P clients.
        if (!this.network?.isHost || !document.hidden) return;
        this._bgBallTimer += dt;
        // Ball state: 30Hz binary position/velocity; state/target only when changed.
        if (this._bgBallTimer >= 1 / 30 && (this.game.ball.active || this.game.ball.state !== 'idle')) {
            this._bgBallTimer %= 1 / 30;
            this._ballSeq = (this._ballSeq || 0) + 1;
            const b = this.game.ball;
            this.network.broadcastBallState(b, this._ballSeq);
        }
        // Score 2Hz
        this._bgScoreTimer += dt;
        if (this._bgScoreTimer >= 0.5) {
            this._bgScoreTimer = 0;
            this.network.broadcast({
                type: 'scoreUpdate',
                red: this.game.scoreboard.redScore, blue: this.game.scoreboard.blueScore,
                time: this.game.scoreboard.timeRemaining, round: this.game.scoreboard.roundNum,
                hotPotato: this.game.getHotPotatoSnapshot?.(),
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
                ry: b.group?.rotation.y ?? 0,
                alive: b.alive, hp: b.hp, charId: b.charId,
                intent: b._defenseIntent || 'none', strafe: b._defenseStrafe || 0,
                attacking: !!b.attacking
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

    _voiceTargets() {
        if (!this.network?.peer || !this.network.connected) return [];
        const localPosition = this.player.getPosition();
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        cameraRight.y = 0;
        cameraRight.normalize();
        return [...this.game.remotePlayers.values()].filter(target => {
            if (!target.alive || !target.peerId) return false;
            if (!this.game._ffa) return target.team === this.player.team;
            return target.position?.distanceTo?.(localPosition) <= 22;
        }).map(target => {
            const dx = (target.position?.x || 0) - localPosition.x;
            const dz = (target.position?.z || 0) - localPosition.z;
            const distance = Math.hypot(dx, dz);
            return {
                peerId: target.peerId,
                muted: this._mutedPlayers.has(target.name) || this.socialProfile.muted?.includes(target.name),
                distance,
                maxDistance: this.game._ffa ? 22 : 80,
                teamChannel: !this.game._ffa,
                pan: distance > .001 ? (dx * cameraRight.x + dz * cameraRight.z) / distance : 0
            };
        });
    }

    _syncVoiceChat() {
        if (!this.voice?.enabled) return;
        this.voice.syncTargets(this._voiceTargets());
    }

    async _startVoicePtt() {
        if (this.store.get('voiceChatEnabled') === false) {
            this.ui.showMessage?.('Voice chat is disabled in Settings.', 1600);
            return;
        }
        if (!this.network?.peer || !this.network.connected) {
            this.ui.showMessage?.('Voice chat requires an online lobby.', 1600);
            return;
        }
        const wasEnabled = this.voice.enabled;
        if (!await this.voice.enable()) {
            this.ui.showMessage?.('Microphone permission is required for voice chat.', 2200);
            return;
        }
        this.voice.setPushToTalk(true);
        this.voice.setMuted(this.store.get('voiceMuted') === true);
        this._syncVoiceChat();
        this.voice.pttDown();
        if (!wasEnabled) this.ui.showMessage?.(this.game._ffa ? 'Voice ready: FFA proximity.' : 'Voice ready: team channel.', 1800);
    }

    loop() {
        const _now = performance.now();
        if (!shouldRenderFrame(this.store.get('fpsLimit') || 0, this._lastFrameTime || 0, _now)) {
            requestAnimationFrame(() => this.loop());
            return;
        }
        this._lastFrameTime = _now;
        requestAnimationFrame(() => this.loop());
        const dt = Math.min(this.clock.getDelta(), 0.05);

        this._voiceSyncTimer = (this._voiceSyncTimer || 0) - dt;
        if (this._voiceSyncTimer <= 0) {
            this._voiceSyncTimer = 0.5;
            this._syncVoiceChat();
        }

        this._diagnosticsTimer = (this._diagnosticsTimer || 0) - dt;
        if (this._diagnosticsTimer <= 0) {
            this._diagnosticsTimer = 0.5;
            const value = document.getElementById('network-diagnostics-value');
            if (value) {
                const diag = this.network?.getDiagnostics?.();
                const fps = Math.round(1 / Math.max(dt, 0.001));
                const health = this.networkHealth.addSample({
                    expectedPackets: Math.max(1, diag?.received || 1),
                    receivedPackets: Math.max(1, diag?.received || 1),
                    desyncMs: Math.abs(this.network?.getClockOffset?.() || 0)
                });
                value.textContent = diag?.peers
                    ? `${fps} FPS | ${Math.round(diag.ping || 0)}ms | ${(health.packetLoss * 100).toFixed(0)}% LOSS | ${diag.peers}P`
                    : `${fps} FPS | LOCAL`;
                value.parentElement?.classList.toggle('hidden', this.store.get('settings').publicDiagnostics === false);
                const fpsCounter = document.getElementById('fps-counter');
                if (fpsCounter && this.game._showFps) fpsCounter.textContent = `${fps} FPS`;
            }
            const afk = this.afkMonitor.status();
            if (afk.warning && !this._afkWarned) {
                this._afkWarned = true;
                this.ui.showMessage?.('AFK warning: move or press a key.', 3000);
            } else if (afk.state === 'active') {
                this._afkWarned = false;
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
            || this.game.state === STATES.COSMETIC_PRACTICE
            || this.game.state === STATES.SOCIAL_HUB)
            && !pauseOpen && !settingsOpen && !this.chatOpen && !socialChatFocused && !teamPopup;
        if (canLock && this.game.state !== STATES.COSMETIC_PRACTICE && !document.pointerLockElement) {
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
            const inGame = this.game.state === STATES.LOBBY || this.game.state === STATES.PLAYING || this.game.state === STATES.COUNTDOWN || this.game.state === STATES.CELEBRATION || this.game.state === STATES.ROUND_END || this.game.state === STATES.GAME_OVER || this.game.state === STATES.COSMETIC_PRACTICE || this.game.state === STATES.SOCIAL_HUB;
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
            // That loop only simulates while network.connected (see _startBgLoop), so an
            // isHost session with no live peer — hostGame() sets isHost before awaiting
            // initPeer, and a failed host keeps the flag — fell through BOTH loops and
            // nothing ever ticked: ball frozen mid-air, bots idle, timer stuck. Mirror the
            // bg loop's own condition here so exactly one of the two always runs.
            if (!this.network?.isHost || !this.network?.connected) this.game.update(dt);
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

        if (this.game.state === STATES.PAUSED && !this.network?.connected) {
            this.game.updateIncomingSettlement?.(dt);
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
        if (this.cosmeticPractice.active && this._cosmeticPracticeAvatar) {
            const reduceMotion = this.store.get('settings')?.reduceMotion === true
                || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
            this._cosmeticPracticeAvatar.setPoseTime(performance.now() / 1000, reduceMotion);
        }

        if (this.game.state === STATES.COSMETIC_PRACTICE) {
            if (!Spectator.active && !teamPopup) this.player.update(dt);
            if (!Spectator.active && !teamPopup) this._updateMovementPolish(false);
            this.game.ball.deactivate();
        }

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
        if (this.game._practiceMode
            && !this.game._cosmeticPractice
            && !this.game.guidedDrill.active
            && !this.game._guidedDrillResultOpen
            && this.game.state === STATES.PLAYING) {
            if (this.player.keys['KeyR']) {
                this.player.keys['KeyR'] = false;
                this.game.ball.spawn();
                this.ui.showMessage?.('Ball spawned', 800);
            }
            if (this.player.keys['KeyF']) {
                this.player.keys['KeyF'] = false;
                this.game.ball.spawn();
                const aim = this.player.getAimDirection();
                const pos = this.player.getPosition();
                this.game.ball.position.copy(pos).add(aim.multiplyScalar(5));
                this.game.ball.position.y = Math.max(3, this.game.ball.position.y);
                this.game.ball.velocity.set(0, -2, 0);
                this.game.ball.active = true;
                this.game.ball.state = 'falling';
                this.game.ball.target = null;
                this.game.ball._homingAge = 0;
                this.game.ball.mesh.visible = true;
                this.ui.showMessage?.('Ball moved', 800);
            }
            if (this.player.keys['KeyT']) {
                this.player.keys['KeyT'] = false;
                this.game.practiceMetrics.reset();
                this._updatePracticeLab(this.game.practiceMetrics.summary());
                this.ui.showMessage?.('Practice metrics reset', 800);
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
                        this.network.broadcastBallState(ball, this._ballSeq);
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
                    hotPotato: this.game.getHotPotatoSnapshot?.(),
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
                        ry: b.group?.rotation.y ?? 0,
                        alive: b.alive, hp: b.hp, charId: b.charId,
                        intent: b._defenseIntent || 'none', strafe: b._defenseStrafe || 0,
                        attacking: !!b.attacking
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
                } else {
                    // A clear is state, too: clients must remove an expired pickup.
                    this.network.broadcast({ type: 'powerUpState', powerUps: [] });
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
            // Spectate dead — teammate first-person or mouse-orbit TPS
            if (!Spectator.active && !this.player.alive && this.game._spectateTarget && this.game._spectateTarget.alive) {
                const t = this.game._spectateTarget;
                const tpos = t.getPosition();
                const tdir = t.getAimDirection?.() || new THREE.Vector3(0, 0, -1);
                const eye = tpos.clone().add(new THREE.Vector3(0, t.eyeHeight || 1.55, 0));
                const alpha = 1 - Math.exp(-18 * dt);
                const view = this._deadSpectateView ||= { distance: 0.5, yaw: null, pitch: 0 };
                if (!Number.isFinite(view.yaw)) view.yaw = t.euler?.y ?? t.rotation?.y ?? 0;
                if (view.distance <= 1) {
                    this.camera.position.lerp(eye, alpha);
                    const look = eye.clone().add(tdir);
                    this.camera.lookAt(look.x, look.y, look.z);
                } else {
                    const horizontal = Math.cos(view.pitch) * view.distance;
                    const chase = new THREE.Vector3(
                        tpos.x + Math.sin(view.yaw) * horizontal,
                        tpos.y + 2.35 + Math.sin(view.pitch) * view.distance,
                        tpos.z + Math.cos(view.yaw) * horizontal
                    );
                    this.camera.position.lerp(chase, alpha);
                    this.camera.lookAt(tpos.x, tpos.y + 1.25, tpos.z);
                }
                renderSpectatorHUD(t.name || (this.game._ffa ? 'PLAYER' : 'TEAMMATE'), {
                    active: true,
                    context: this.game._ffa ? 'ffa' : 'team',
                    controls: false,
                    mode: view.distance <= 1 ? CAMERA_MODES.FIRST_PERSON : CAMERA_MODES.CHASE
                });
            } else if (this.player.alive) {
                this._deadSpectateView = null;
                if (!Spectator.active) renderSpectatorHUD('', { active: false });
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
