// game.js — Full game: chat, team switch, death fx, minimap, aim deflection,
// damage ramp, skill system, map ban, damage meter, portal handling.
import * as THREE from 'three';
import { Ball, networkBallStep } from './ball.js';
import { Bot } from './bot.js';
import { Scoreboard } from './scoreboard.js';
import { calcDamage, missRampDamage } from './characters.js';
import { Arena, isFallDeathPosition } from './arena.js';
import { Juice } from './juice.js';
import { applyMode, GAME_MODES } from './gamemodes.js';
import { ChaosManager, CHAOS_MODES } from './chaos.js';
import { EmoteSystem } from './emotes.js';
import { AffixManager } from './affixes.js';
import { SKILLS, useSkill, ULTIMATES } from './skills.js';
import { outlineVertexShader } from './shaders/toon.vert.js';
import { isNewerSequence } from './network.js';
import { resolveKillerName, segmentIntersectsSphere } from './combat.js';
import {
    applyHotPotatoSnapshot,
    createHotPotatoState,
    resetHotPotatoState,
    snapshotHotPotato,
    tickHotPotato,
    transferHotPotato
} from './hot-potato.js';
import {
    createKnifeModel,
    createRocketLauncherModel,
    createRocketProjectileModel,
    disposeObject3D
} from './weapon-models.js';
import { KNIVES } from './cosmetics.js';
import { normalizeWearableLoadout } from './cosmetic-catalog.js';
import { applyEntityCosmetics, spawnImpactCosmetic, updateEntityCosmetics } from './cosmetic-models.js';
import {
    activateQueuedEntity,
    isLiveJoinState,
    queueForNextRound,
    selectQueuedTeam
} from './late-join.js';
import { shouldEndOvertime, shouldStartOvertime } from './competitive-service.js';
import { normalizeNetcode, predictPosition, rewindSnapshot, sampleSnapshots } from './experimental-netcode.js';
import { RuntimeLog } from './runtime-safety.js';
import { PracticeLabMetrics, resolvePerfectDeflect } from './perfect-deflect.js';
import { GuidedDeflectDrill } from './guided-deflect-drill.js';
import { MatchAnalytics } from './match-analytics.js';
import { applyCompetitiveRules } from './competitive-rules.js';
import {
    RALLY_DUEL_MAPS,
    normalizeRallyDuelMap,
    planRallyDuelRoster
} from './rally-duel.js';

const BASE_HIT_DAMAGE = 25;

const POWERUP_TYPES = [
    { id: 'shield', color: 0x44aaff, label: '+SHIELD', duration: 0, weight: 32 },
    { id: 'recovery', color: 0x63f4e8, label: 'RECOVERY CORE', duration: 0, weight: 8 },
    { id: 'speed', color: 0x44ff88, label: 'HYPER SPEED · 20s', duration: 20, weight: 26 },
    { id: 'damage', color: 0xff4444, label: 'POWER SHOT · 12s', duration: 12, weight: 20 },
    { id: 'megaball', color: 0xffaa00, label: 'MEGA BALL', duration: 5, weight: 12 },
    { id: 'rapid', color: 0xffe45c, label: 'RAPID DEFLECT · 20s', duration: 20, weight: 4 },
    { id: 'giant', color: 0xc05cff, label: 'GIANT MODE · 20s', duration: 20, weight: 3 },
    { id: 'tiny', color: 0x5ce1ff, label: 'TINY MODE · 20s', duration: 20, weight: 3 },
];

const POWERUP_FIRST_SPAWN = 30;
const POWERUP_FIRST_VARIANCE = 20;
const POWERUP_RESPAWN = 45;
const POWERUP_RESPAWN_VARIANCE = 15;
const POWERUP_LIFETIME = 30;

export const STATES = {
    MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER',
    CELEBRATION: 'CELEBRATION', PAUSED: 'PAUSED', SOCIAL_HUB: 'SOCIAL_HUB'
};

export class Game {
    constructor(renderer, player, arena, audio, ui, network) {
        this.renderer = renderer;
        this.player = player;
        this.arena = arena;
        this.audio = audio;
        this.ui = ui;
        this.network = network;
        this.arena.onPinballBreak = target => {
            const remaining = this.arena.pinballTargets?.filter(item => !item.broken).length || 0;
            this.broadcastSystemMessage(`PINBALL GLASS ${target.mesh.userData.pinballTarget} BROKEN - ${remaining} LEFT`);
            if (remaining === 0 && this.lastDeflector) {
                const next = this.getEnemyTargets(this.lastDeflector.team, this.lastDeflector)[0];
                if (next) this.ball.setTarget(next);
            }
        };

        this.state = STATES.MENU;
        this.matchId = null;
        this.experimentalNetcode = normalizeNetcode();
        this.perfectDeflectChain = { count: 0, lastPerfectAt: null };
        this._remotePerfectChains = new Map();
        this.practiceMetrics = new PracticeLabMetrics();
        this.guidedDrill = new GuidedDeflectDrill();
        this._guidedDrillArmed = false;
        this._guidedDrillTarget = null;
        this._guidedDrillTargetPosition = new THREE.Vector3();
        this._guidedDrillRestore = null;
        this._guidedDrillCompleted = false;
        this.matchAnalytics = new MatchAnalytics();
        this.ball = new Ball(renderer, arena);
        this.scoreboard = new Scoreboard();
        this.bots = [];
        this.remotePlayers = new Map();
        this.localCosmeticEntity = { group: new THREE.Group() };
        this.localCosmeticEntity.group.name = 'local-cosmetics';
        this.renderer.scene.add(this.localCosmeticEntity.group);
        applyEntityCosmetics(this.localCosmeticEntity, null);
        this._pendingLethalHit = null;
        this._pendingLethalVictim = null;
        this._predictedLocalDeath = false;
        this.rockets = [];
        this._remoteRocketCooldowns = new Map();
        // Player name → remote-Avatar Sprite cache, böylece aynı oyuncu için sprite bir kez oluşur.
        this._avatarCache = new Map();

        this.roundRestartDelay = 4.0;
        this.roundRestartTimer = 0;
        this.preGameDuration = 10;       // saniye, host console'dan degistirebilir
        this.preGameTimer = 0;
        this.lastDeflector = null;
        this.lastDeflectorTeam = null;
        this._resetHotPotato();
        this._openingOwner = null;
        this.arena.pinballTargets?.forEach(target => {
            target.broken = false;
            target.mesh.visible = true;
        });
        this.syncTimer = 0;
        this.syncRate = 0.05;

        this.playerName = 'Player';
        this.botCounter = 0;
        this.botDifficulty = 'hard';
        this.rallyCount = 0;

        // DMC-style kill combo tracker
        this.killStreak = 0;
        this._comboDisplayTimer = 0;

        // Kill streak tracking per player (name → consecutive kills)
        this._killStreaks = new Map();
        this._killStreakTimers = new Map();

        // Occasional bot chatter for life
        this.botChatTimer = 8 + Math.random() * 8;
        this.botLines = [
            'nice one!', 'gg', 'so close 😅', 'my ball!', 'catch this 🏐',
            'wow', 'too fast!', 'get ready', 'haha', 'good game team',
            'incoming!', 'watch out', 'lets go 🔥', 'oops'
        ];

        // Chat
        this.chatMessages = [];
        this.chatBubbles = new Map(); // name → { sprite, timer }

        // Death particles
        this.deathParticles = [];

        // Minimap
        this.minimapCanvas = null;
        this.minimapCtx = null;

        // Map banlama (LoL tarzı)
        this.bannedMaps = new Set();

        // Damage meter — en son hasar atanlar (kill feed için)
        this.killFeed = [];
        this.spikeCount = 0; // maç içi spike sayacı (achievement/daily için)

        // Game feel + modlar + emote
        this.juice = new Juice(this.player.camera, this.renderer);
        this.emotes = new EmoteSystem(this.renderer.scene);
        this.mode = GAME_MODES.classic;
        this.matchModifier = 'none';
        this._oneHitKill = false;
        this._activeBlackHoles = [];
        this._splitBalls = [];
        this._killcamActive = false;
        this._killcamElapsed = 0;
        this._killcamDuration = 2.5;
        this._killcamKillerPos = null;
        this._killcamDeathPos = null;
        this._killcamKillerName = '';
        this._killcamReplayEvents = [];
        this._killcamBufferMs = 2000;
        // Overtime (score tied at timer expiry — escalating ball speed)
        this._overtime = false;
        this._overtimeTimer = 0;
        this._overtimeMaxSpeed = 3.0;
        this._overtimeExtends = 0;
        this._suddenDeathAnnounced = false;

        // Map voting
        this._mapVoteActive = false;
        this._mapVoteOptions = [];     // 3 mapId'ler
        this._mapVotes = new Map();    // peerId → mapId
        this._mapVoteTimer = null;
        this._mapVoteTimeout = 20;     // seconds
        this._mapVoteElapsed = 0;
        this.affixes = new AffixManager(this.arena, this.renderer.scene);
        this.chaosManager = new ChaosManager(this.arena, this.renderer.scene);
        this._chaosModeIds = new Set(Object.values(CHAOS_MODES).map(m => m.id));
        this.currentBallAffix = null;
        this._chaosSyncTimer = 0;

        // Power-up pickups — spawn on map, temporary buffs
        this.powerUps = [];
        this._powerUpTimer = POWERUP_FIRST_SPAWN + Math.random() * POWERUP_FIRST_VARIANCE;
        this._powerUpInterval = POWERUP_RESPAWN;
        this._maxPowerUps = 1;
        this._playerBuffs = {}; // { speed: 0, shield: 0, damage: 0 } timer
        this._respawnTimer = null;

        // Lobby/menu music — rotate between tracks.
        // Uses .sfx aliases + fetch+blob (like audio.js) so IDM never sees a .mp3/.m4a URL to grab.
        this._musicTracks = ['music/1.sfx', 'music/2.sfx', 'music/3.sfx', 'music/4.sfx'];
        this._musicIndex = 0;
        this._musicAudio = null;
        this._musicVolume = 0.02;
        this._blobUrls = {}; // .sfx path → object URL

        // Preload combo sounds to avoid latency (blob so no direct download)
        this._comboAudio = {};
        const comboFiles = ['music/1kill.sfx', 'music/2kill.sfx', 'music/3kill.sfx', 'music/4kill.sfx', 'music/ace.sfx'];
        this._preloadBlobAudio([...this._musicTracks, ...comboFiles]).then(() => {
            comboFiles.forEach(f => {
                const a = new Audio(this._blobUrls[f]);
                a.preload = 'auto';
                a.volume = 0.12; // combo sesleri
                this._comboAudio[f] = a;
            });
            this._startMusic(); // boot music once blobs are ready
        });
    }

    // Fetch each .sfx as a blob and cache an object URL — same trick as audio.js.
    async _preloadBlobAudio(paths) {
        await Promise.all(paths.map(async p => {
            try {
                const resp = await fetch(p);
                const blob = new Blob([await resp.arrayBuffer()], { type: 'audio/mpeg' });
                this._blobUrls[p] = URL.createObjectURL(blob);
            } catch (e) {
                console.warn(`music load failed: ${p}`, e);
            }
        }));
    }

    // --- LOBBY MUSIC ---
    _startMusic() {
        if (this._musicAudio) return;
        // ponytail: her açılışta farklı bir parça rastgele başlasın
        this._musicIndex = Math.floor(Math.random() * this._musicTracks.length);
        const srcFor = (path) => this._blobUrls[path] || path;
        const playNext = () => {
            this._musicIndex = (this._musicIndex + 1) % this._musicTracks.length;
            this._musicAudio = new Audio(srcFor(this._musicTracks[this._musicIndex]));
            this._musicAudio.volume = this._musicVolume;
            this._musicAudio.play().catch(() => {});
            this._musicAudio.onended = playNext;
        };
        const track = this._musicTracks[this._musicIndex];
        this._musicAudio = new Audio(srcFor(track));
        this._musicAudio.volume = this._musicVolume;
        // Browser autoplay policy: need user gesture. Adding retry on first click.
        const tryPlay = () => {
            this._musicAudio.play().then(() => {
                this._musicAudio.onended = playNext;
            }).catch(() => {
                // Retry on next user interaction
                document.addEventListener('click', () => {
                    if (this._musicAudio && this._musicAudio.paused) {
                        this._musicAudio.play().catch(() => {});
                        this._musicAudio.onended = playNext;
                    }
                }, { once: true });
            });
        };
        tryPlay();
    }

    _stopMusic() {
        if (this._musicAudio) { this._musicAudio.pause(); this._musicAudio = null; }
    }

    setMusicVolume(v) {
        this._musicVolume = Math.max(0, Math.min(1, v ?? 0.12));
        if (this._musicAudio) this._musicAudio.volume = this._musicVolume;
    }

    announceStreak(streak, killer) {
        const labels = { 2: 'DOUBLE KILL!', 3: 'TRIPLE KILL!', 4: 'QUADRA KILL!', 5: 'PENTA KILL!' };
        const classes = { 2: 'double', 3: 'triple', 4: 'quadra', 5: 'penta' };
        if (streak >= 5 && this.isTeamAce(killer)) {
            this.ui.showStreak('ACE!', 'ace');
        } else if (labels[streak]) {
            this.ui.showStreak(labels[streak], classes[streak]);
        }
        // Bonus rewards: +50 XP per streak level, +10 coins
        const store = window.__store;
        if (store?.addXP) store.addXP(streak * 50);
        if (store?.addCurrency) store.addCurrency(streak * 10);
    }

    isTeamAce(killer) {
        const killerTeam = killer?.team;
        if (!killerTeam) return false;
        return this.getAllTargets().filter(p => p.team !== killerTeam).every(p => !p.alive);
    }

    setState(s) {
        const prev = this.state;
        RuntimeLog.auditTransition(prev, s);
        this.state = s;
        if (s !== STATES.PLAYING) this.audio?.resetThreatAudio?.();
        if (s === STATES.ROUND_END && prev !== STATES.ROUND_END) this.onRoundEnd?.();
        if (s === STATES.LOBBY || s === STATES.MENU || s === STATES.SOCIAL_HUB) {
            if (prev !== STATES.LOBBY && prev !== STATES.MENU && prev !== STATES.SOCIAL_HUB) this._startMusic();
        } else if (s === STATES.PLAYING || s === STATES.COUNTDOWN) {
            this._stopMusic();
        }
    }

    startSolo() {
        this._practiceMode = false;
        document.querySelectorAll('#btn-add-bot-red, #btn-add-bot-blue').forEach(button => {
            button.disabled = false;
        });
        // ponytail fix OW2-gap2: input'tan isim oku, fallback 'You'
        const input = document.getElementById('player-name-input');
        this.playerName = input?.value?.trim() || 'You';
        this.player.setTeam('red');
        this.player.respawn();
        // ponytail: full reset — yeni scoreboard oluştur, eski veri kalmasın
        this.scoreboard = new Scoreboard();
        this.scoreboard.setTimeLimit(parseInt(document.getElementById('setting-match-time')?.value || 300));
        this.scoreboard.setMaxRounds(parseInt(document.getElementById('setting-max-rounds')?.value || 16));
        this.scoreboard.addPlayer(this.playerName, 'red', { isYou: true });
        this.addBot('blue');
        this.setState(STATES.LOBBY);
        this._startMusic();
        this.updateLobbyUI();
    }

addBot(team, { name: preferredName = null } = {}) {
    if (this._practiceMode) return null;
    this.botCounter++;
    const name = typeof preferredName === 'string'
        && /^[a-zA-Z0-9 _-]{1,24}$/.test(preferredName)
        ? preferredName
        : `Bot-${this.botCounter}`;
        const bot = new Bot(this.renderer, this.arena, name, team, this.botDifficulty);
        bot._gameRef = this;
        this.bots.push(bot);
        this.scoreboard.addPlayer(name, team, { isBot: true });
        this.updateLobbyUI();
        return name;
    }

    removeBot() {
        if (!this.bots.length) return;
        const bot = this.bots.pop();
        this.scoreboard.removePlayer(bot.name);
        bot.remove();
        this.updateLobbyUI();
    }

    removeBotByName(name) {
        const idx = this.bots.findIndex(b => b.name === name);
        if (idx === -1) return;
        const bot = this.bots.splice(idx, 1)[0];
        this.scoreboard.removePlayer(bot.name);
        bot.remove();
        if (this.state === STATES.LOBBY) this.updateLobbyUI();
    }

    switchPlayerTeam(name, team) {
        if (name === this.playerName) {
            this.switchTeam(team);
            return;
        }
        const bot = this.bots.find(b => b.name === name);
        const remote = [...this.remotePlayers.values()].find(p => p.name === name);
        const target = bot || remote;
        if (!target) return;
        target.setTeam?.(team);
        if (remote && !remote.setTeam) target.team = team;
        this.scoreboard.removePlayer(name);
        this.scoreboard.addPlayer(name, team, { isBot: !!bot, peerId: remote?.peerId });
        if (this.state === STATES.LOBBY) this.updateLobbyUI();
    }

    // Black hole — rastgele konumda açılır, topu 4sn çeker.
    spawnBlackHole() {
        const halfW = this.arena.courtWidth / 2 - 3;
        const halfL = this.arena.courtLength / 2 - 3;
        const x = (Math.random() - 0.5) * halfW * 2;
        const z = (Math.random() - 0.5) * halfL * 2;
        const y = 2.5;
        this._createBlackHoleMesh(x, y, z);
        // ponytail: broadcast position so clients render at same spot
        if (this.network?.isHost) this.network.broadcastBlackHoleSpawn(x, y, z);
    }

    // Client: create black hole at fixed position (from host broadcast)
    spawnBlackHoleAt(x, y, z) {
        if (this.network?.isHost) return;
        this._createBlackHoleMesh(x, y, z);
    }

    _createBlackHoleMesh(x, y, z) {
        // Visual: dark sphere with purple glow ring
        const geo = new THREE.SphereGeometry(1.2, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.position.set(x, y, z);
        this.arena.add(sphere);

        // Glow ring
        const ringGeo = new THREE.TorusGeometry(1.5, 0.08, 8, 24);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xaa44ff, transparent: true, opacity: 0.7 });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(x, y, z);
        ring.rotation.x = Math.PI / 2;
        this.arena.add(ring);

        // Accretion particles
        const pCount = 40;
        const pPos = [];
        for (let i = 0; i < pCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 1.3 + Math.random() * 0.8;
            pPos.push(x + Math.cos(angle) * dist, y + (Math.random() - 0.5) * 0.5, z + Math.sin(angle) * dist);
        }
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({ color: 0xaa44ff, size: 0.08, transparent: true, opacity: 0.6 });
        const particles = new THREE.Points(pGeo, pMat);
        this.arena.add(particles);

        this._activeBlackHoles.push({
            pos: new THREE.Vector3(x, y, z),
            timer: 4,
            sphere, ring, particles, pMat, pGeo
        });
    }

    updateBlackHoles(dt) {
        for (let i = this._activeBlackHoles.length - 1; i >= 0; i--) {
            const bh = this._activeBlackHoles[i];
            bh.timer -= dt;

            // Visual: spin & pulse
            bh.ring.rotation.z += dt * 3;
            bh.sphere.material.opacity = 0.7 + Math.sin(bh.timer * 8) * 0.15;
            bh.ring.material.opacity = 0.4 + Math.sin(bh.timer * 5) * 0.3;
            bh.pMat.opacity = 0.3 + Math.sin(bh.timer * 6) * 0.3;

            // Physics: pull ball toward center
            if (this.ball && this.ball.active) {
                const diff = new THREE.Vector3().copy(bh.pos).sub(this.ball.position);
                const dist = diff.length();
                if (dist > 0.1 && dist < 8) {
                    const force = 6 / (dist + 0.5);
                    this.ball.velocity.add(diff.normalize().multiplyScalar(force * dt));
                }
            }

            // Expire
            if (bh.timer <= 0) {
                this.arena.remove(bh.sphere);
                this.arena.remove(bh.ring);
                this.arena.remove(bh.particles);
                this._activeBlackHoles.splice(i, 1);
            }
        }
    }

    clearBlackHoles() {
        this._activeBlackHoles.forEach(bh => {
            this.arena.remove(bh.sphere);
            this.arena.remove(bh.ring);
            this.arena.remove(bh.particles);
        });
        this._activeBlackHoles = [];
    }

    spawnSplitBall(ball, life = 5) {
        const perp = new THREE.Vector3(-ball.velocity.z, 0.3, ball.velocity.x).normalize();
        const pos = ball.position.clone();
        const vel = perp.multiplyScalar(ball.currentSpeed * 0.5).add(new THREE.Vector3(0, 3, 0));
        this._createSplitBallMesh(pos, vel, life);
        // ponytail: broadcast so clients render split ball at same pos/vel
        if (this.network?.isHost) this.network.broadcastSplitBallSpawn(pos.x, pos.y, pos.z, vel.x, vel.y, vel.z);
    }

    // Client: create split ball at fixed pos/vel (from host broadcast)
    spawnSplitBallAt(data) {
        if (this.network?.isHost) return;
        const pos = new THREE.Vector3(data.x, data.y, data.z);
        const vel = new THREE.Vector3(data.vx, data.vy, data.vz);
        this._createSplitBallMesh(pos, vel, 5);
    }

    _createSplitBallMesh(pos, vel, life) {
        const geo = new THREE.SphereGeometry(0.3, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.8 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        this.arena.add(mesh);
        this._splitBalls.push({ mesh, pos: pos.clone(), vel: vel.clone(), life, age: 0 });
    }

    updateSplitBalls(dt) {
        const candidates = this._ffa
            ? this.getAllTargets().filter(p => p !== this.lastDeflector && p.alive)
            : (this.lastDeflectorTeam
                ? this.getAllTargets().filter(p => p.team !== this.lastDeflectorTeam)
                : []);
        for (let i = this._splitBalls.length - 1; i >= 0; i--) {
            const sb = this._splitBalls[i];
            sb.age += dt;
            sb.life -= dt;
            sb.vel.y += -14 * dt;
            sb.pos.add(sb.vel.clone().multiplyScalar(dt));
            sb.mesh.position.copy(sb.pos);
            sb.mesh.material.opacity = Math.min(1, sb.life) * 0.8;
            sb.mesh.scale.setScalar(1 + Math.sin(sb.age * 8) * 0.1);

            // Hit detection (host only)
            if ((!this.network?.connected || this.network?.isHost) && sb.life > 0) {
                for (const target of candidates) {
                    if (!target?.alive) continue;
                    const headPos = target.getPosition();
                    const bodyTop = headPos.y;
                    const bodyBottom = headPos.y - 1.7;
                    const clampedY = Math.max(bodyBottom, Math.min(bodyTop, sb.pos.y));
                    const dx = sb.pos.x - headPos.x;
                    const dz = sb.pos.z - headPos.z;
                    const dy = sb.pos.y - clampedY;
                    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < 0.7) {
                        this.handleHit(target);
                        sb.life = -1;
                        break;
                    }
                }
            }

            if (sb.life <= 0) {
                this.arena.remove(sb.mesh);
                sb.mesh.geometry.dispose();
                sb.mesh.material.dispose();
                this._splitBalls.splice(i, 1);
            }
        }
    }

    clearSplitBalls() {
        this._splitBalls.forEach(sb => {
            this.arena.remove(sb.mesh);
            sb.mesh.geometry.dispose();
            sb.mesh.material.dispose();
        });
        this._splitBalls = [];
    }

    updateLobbyUI() {
        if (this.competitiveRules) applyCompetitiveRules(this, this.competitiveRules);
        const ownAvatar = window.__store?.get?.('customAvatar')?.dataURL || null;
        const players = [{
            name: this.playerName,
            team: this.player.team,
            isBot: false,
            charId: this.player.charId,
            isYou: true,
            isHost: !this.network || !this.network.connected || this.network.isHost,
            peerId: this.network?.peer?.id,
            playerId: this.network?.playerId,
            avatar: ownAvatar
        }];
        this.bots.forEach(b => players.push({
            name: b.name,
            team: b.team,
            isBot: true,
            charId: b.charId,
            isYou: false,
            avatar: null
        }));
        this.remotePlayers.forEach((p, playerId) => players.push({
            name: p.name,
            team: p.team,
            isBot: false,
            charId: p.charId || 'rally',
            isYou: false,
            playerId,
            peerId: p.peerId || playerId,
            avatar: p.avatar || null
        }));
        // Lobby leader = host, or solo (not connected to anyone) → you lead.
        const isHost = !this.network || !this.network.connected || this.network.isHost;
        this.ui.updateLobbyPlayers(players, isHost);
    }

_prepareRallyDuel() {
    const connectedClient = !!this.network?.connected && !this.network?.isHost;
    const plan = planRallyDuelRoster({
        remotePlayers: this.remotePlayers.values(),
        allowFallbackBot: !connectedClient
    });
    if (!plan.accepted) {
        this.ui.showMessage?.(
            plan.reason === 'too-many-players'
                ? 'Rally Duel supports exactly two active players.'
                : 'Waiting for the duel opponent.',
            2200
        );
        return false;
    }
    while (this.bots.length) this.removeBot();
    const localTeam = connectedClient ? 'blue' : 'red';
    const opponentTeam = localTeam === 'red' ? 'blue' : 'red';
    this.player.setTeam(localTeam);
    let opponent = plan.opponent;
    if (plan.needsFallbackBot) {
        this.addBot(opponentTeam, { name: 'Rally BOT' });
        opponent = this.bots.at(-1);
        if (opponent) opponent.isFallbackBot = true;
    }
    if (!opponent) return false;
    opponent.setTeam?.(opponentTeam);
    if (!opponent.setTeam) opponent.team = opponentTeam;
    this.clearPowerUps();
    return true;
}

startGame(skipPreGame = false, matchId = null) {
    if (this._rallyDuel && !this._prepareRallyDuel()) return false;
    this.matchId = typeof matchId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(matchId)
            ? matchId
            : globalThis.crypto?.randomUUID?.()
                || `match-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        this.cancelPreGame();
        this._rewardsClaimed = false;
        this.perfectDeflectChain = { count: 0, lastPerfectAt: null };
        this._remotePerfectChains.clear();
        this.practiceMetrics.reset();
        this.matchAnalytics.reset();
    this.onMatchStart?.();
    this.applyMatchModifier();
    if (this.competitiveRules) applyCompetitiveRules(this, this.competitiveRules);
        this.setState(STATES.COUNTDOWN);
        // Lobby'de gösterilen bot dummy'leri oyun başlamadan temizle
        for (const [peerId, p] of this.remotePlayers) {
            if (p.isBotEntity) this.removeRemotePlayer(peerId);
        }
        const { timeLimit, maxRounds } = this.scoreboard;
        this.scoreboard = new Scoreboard();
        this.scoreboard.setTimeLimit(timeLimit);
        this.scoreboard.setMaxRounds(maxRounds);
        // ponytail: force full reset — clear all players and re-register from current entities
        this.scoreboard.addPlayer(this.playerName, this.player.team, { isYou: true });
        this.bots.forEach(b => this.scoreboard.addPlayer(b.name, b.team, { isBot: true }));
        // ponytail: per-team spawn index for 6m spacing
        const spawnIdx = { red: 0, blue: 0 };
        this.player._spawnIndex = spawnIdx[this.player.team]++;
        this.bots.forEach(b => { b._spawnIndex = spawnIdx[b.team]++; });
        this.remotePlayers.forEach(p => {
            this.scoreboard.addPlayer(p.name, p.team, { peerId: p.peerId });
            p._spawnIndex = spawnIdx[p.team]++;
            const spawn = this.arena.getPlayerSpawn(p.team, p._spawnIndex);
            p.position.copy(spawn);
            p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
            p.group.rotation.y = p.team === 'red' ? 0 : Math.PI;
            p.alive = true;
            p.group.visible = true;
            p.hp = p.maxHp;
        });
        this.rallyCount = 0;
        this.killStreak = 0;
        this._killStreaks.clear();
        this._killStreakTimers.forEach(t => clearTimeout(t));
        this._killStreakTimers.clear();
        this._overtimeExtends = 0;
        this._spectateTarget = null;
        if (this.arena.config?.lowGravity && this.mode?.id === 'classic') {
            this.player.gravity = -7;
            this.player.jumpForce = 12;
        }
        this._hideKillcam();
        this.ui.hideAll();
        this.ui.showHUD();
        this.player.respawn();
        this.bots.forEach(b => b.respawn());
        this.audio.init();
        this.audio.preloadSfx('sfx/');
        this.initMinimap();

        // Late-join: 10 saniyelik pre-game countdown'u atla, anında round'a gir. Host oyun sırasındayken
        // gelen client bu sayede top ve event'leri render eder.
        if (skipPreGame || this._skipPreGame) {
            this._skipPreGame = false;
            this._cancelCountdown = () => {};
            this._preGameActive = false;
            this.startRound();
            return;
        }

        // Pre-game countdown (configurable, host can change)
        this.preGameTimer = this.preGameDuration;
        this._preGameActive = true;
        // Show match intro overlay
        this.ui.showMatchIntro(this.arena.config?.name || 'Arena', this.mode?.name || 'Classic');
        setTimeout(() => this.ui.hideMatchIntro(), 3500);
        // Warmup: spawn ball early so players practice deflecting during countdown
        if (!skipPreGame && !this._skipPreGame) {
            this.ball.spawn();
            this.ball._warmup = true;
        }
        this._cancelCountdown = () => {};
        let cancelled = false;
        const wrap = (fn) => () => { if (!cancelled) fn(); };
        this.ui.showCountdown(this.preGameDuration, wrap(() => {
            this._preGameActive = false;
            this.ui.showCountdown(3, wrap(() => {
                this.audio.playGo();
                this.startRound();
            }));
            [3, 2, 1].forEach((n, i) => setTimeout(() => { if (!cancelled) this.audio.playBeep(440); }, i * 1000));
        }));
        this._cancelCountdown = () => { cancelled = true; this._preGameActive = false; this.ui.hideMessage?.(); };
    }

    cancelPreGame() {
        this._cancelCountdown?.();
        this._cancelCountdown = () => {};
        this._preGameActive = false;
        this.preGameTimer = 0;
        this.ball._warmup = false;
        this.ui.cancelCountdown?.();
        this.ui.hideMatchIntro?.();
    }

    _applyBallAffix() {
        this.currentBallAffix = this.affixes?.getBallAffix?.() || null;
        if (this.currentBallAffix && this.ball) {
            this.currentBallAffix.apply(this.ball);
            this.ball.affix = this.currentBallAffix;
        } else {
            this.ball.affix = null;
        }
    }

    clearPowerUps() {
        this._clearAllPowerUps();
    }

    armGuidedDrill() {
        this.cancelGuidedDrill();
        this._guidedDrillRestore = {
            timeScale: this._timeScale,
            currentSpeed: this.ball.currentSpeed,
            homingStrength: this.ball.homingStrength,
            maxPowerUps: this._maxPowerUps,
            powerUpTimer: this._powerUpTimer
        };
        this._timeScale = 1;
        this._maxPowerUps = 0;
        this.clearPowerUps();
        this.affixes?.clearRound();
        this.chaosManager?.clear();
        this._guidedDrillArmed = true;
        this._guidedDrillCompleted = false;
        this._guidedDrillResultOpen = false;
        this.guidedDrill.arm();
    }

    cancelGuidedDrill() {
        this.guidedDrill.cancel();
        this._guidedDrillArmed = false;
        this._guidedDrillCompleted = false;
        this._guidedDrillResultOpen = false;
        this.ball?.deactivate?.();
        if (this._guidedDrillTarget) this._guidedDrillTarget.visible = false;
        if (this._guidedDrillRestore) {
            this._timeScale = this._guidedDrillRestore.timeScale;
            this.ball.currentSpeed = this._guidedDrillRestore.currentSpeed;
            this.ball.homingStrength = this._guidedDrillRestore.homingStrength;
            this._maxPowerUps = this._guidedDrillRestore.maxPowerUps;
            this._powerUpTimer = this._guidedDrillRestore.powerUpTimer;
            this._guidedDrillRestore = null;
        }
    }

    _beginGuidedDrill() {
        this.ball.deactivate();
        this._guidedDrillResultOpen = false;
        this.guidedDrill.start();
        this._ensureGuidedDrillTarget();
        this.onGuidedDrillUpdate?.(this.guidedDrill.snapshot());
    }

    _ensureGuidedDrillTarget() {
        if (this._guidedDrillTarget) return;
        this._guidedDrillTarget = new THREE.Mesh(
            new THREE.TorusGeometry(2.2, 0.16, 8, 32),
            new THREE.MeshBasicMaterial({
                color: 0x5de8dc,
                transparent: true,
                opacity: 0.9,
                depthTest: false
            })
        );
        this._guidedDrillTarget.renderOrder = 12;
        this._guidedDrillTarget.visible = false;
        this.renderer.scene.add(this._guidedDrillTarget);
    }

    _serveGuidedAttempt(snapshot) {
        const currentSpeed = Number.isFinite(this.ball.currentSpeed) && this.ball.currentSpeed > 0
            ? this.ball.currentSpeed
            : 14;
        const baseSpeed = Number.isFinite(this.ball.baseSpeed) && this.ball.baseSpeed > 0
            ? this.ball.baseSpeed
            : currentSpeed;
        const multiplier = Number.isFinite(snapshot.speedMultiplier)
            && snapshot.speedMultiplier > 0
            ? Math.min(2, Math.max(0.5, snapshot.speedMultiplier))
            : 1;
        const speed = Math.max(6, baseSpeed * multiplier);
        const sourcePosition = this.player.getPosition();
        const playerPosition = this.ball.position.clone().set(
            Number.isFinite(sourcePosition?.x) ? sourcePosition.x : 0,
            Number.isFinite(sourcePosition?.y) ? sourcePosition.y : 2,
            Number.isFinite(sourcePosition?.z)
                ? sourcePosition.z
                : (this.player.team === 'red' ? -12 : 12)
        );
        this.ball.spawn();
        this.ball.position.set(0, Math.max(3, playerPosition.y + 1.2), 0);
        this.ball.currentSpeed = speed;
        this.ball.velocity.copy(playerPosition)
            .sub(this.ball.position)
            .normalize()
            .multiplyScalar(speed);
        this.ball.setTarget(this.player);
        this.ball.state = 'homing';
        this.ball._homingAge = 0;
        const distance = this.ball.position.distanceTo(playerPosition);
        const timeoutMs = Number.isFinite(distance) && Number.isFinite(speed)
            ? distance / speed * 1000 + 1200
            : 2200;
        const attempt = this.guidedDrill.openAttempt({ timeoutMs });
        if (!attempt.accepted) {
            this.ball.deactivate();
            return false;
        }
        this._guidedDrillTargetPosition.set(
            attempt.lane * 10,
            4,
            this.player.team === 'red' ? 14 : -14
        );
        return true;
    }

    _updateGuidedDrill(dt) {
        if (typeof document !== 'undefined' && document.hidden) return;
        let remainingMs = Math.min(Math.max(dt * 1000, 0), 250);
        let beforeAttempt = this.guidedDrill.openAttemptId;
        let snapshot = this.guidedDrill.snapshot();
        let guard = 0;
        while (remainingMs > 0 && this.guidedDrill.active && guard++ < 8) {
            const advanced = this.guidedDrill.advance(remainingMs);
            remainingMs = advanced.remainingMs;
            snapshot = advanced.snapshot;
            if (beforeAttempt !== null && snapshot.openAttemptId === null) {
                this.ball.deactivate();
            }
            let served = false;
            if (snapshot.needsServe) {
                served = this._serveGuidedAttempt(snapshot);
                if (!served) break;
                snapshot = this.guidedDrill.snapshot();
            }
            if (advanced.consumedMs <= 0 && !served) break;
            beforeAttempt = snapshot.openAttemptId;
        }
        if (this._guidedDrillTarget) {
            const visible = snapshot.phase === 'stage'
                && snapshot.stage.id === 'direction'
                && snapshot.openAttemptId !== null;
            this._guidedDrillTarget.visible = visible;
            if (visible) this._guidedDrillTarget.position.copy(this._guidedDrillTargetPosition);
        }
        this.onGuidedDrillUpdate?.(snapshot);
        if (snapshot.complete && !this._guidedDrillCompleted) {
            this._guidedDrillCompleted = true;
            this._guidedDrillResultOpen = true;
            this.ball.deactivate();
            if (this._guidedDrillTarget) this._guidedDrillTarget.visible = false;
            this.onGuidedDrillComplete?.(this.guidedDrill.result());
        }
    }

    startRound() {
        this.clearBlackHoles();
        this.clearSplitBalls();
        this._clearRockets();
        this._hideKillcam();
        this._overtime = false;
        this._overtimeTimer = 0;
        this._suddenDeathAnnounced = false;
        this.setState(STATES.PLAYING);
        this.scoreboard.newRound();
        this.matchAnalytics.recordEvent('round_start', {
            round: this.scoreboard.roundNum,
            red: this.scoreboard.redScore,
            blue: this.scoreboard.blueScore
        });
        this.activateQueuedPlayers();
        if (this.affixes && !this._guidedDrillArmed) this.affixes.startRound();
        if (!this._guidedDrillArmed && this._chaosModeIds.has(this.mode?.id)) this.chaosManager.startRound();
        if (this.ball._warmup) { this.ball.deactivate(); this.ball._warmup = false; }
        if (this._guidedDrillArmed) this._beginGuidedDrill();
        else this.ball.spawn();
        if (this._ffaOpeningDouble && !this._guidedDrillArmed) this.spawnSplitBall(this.ball, 18);
        this.ball._pinballBounce = !!this.arena.config?.isPinball || !!this.mode?.mutators?.pinballBounce;
        if (!this._guidedDrillArmed) this._applyBallAffix();
        this.lastDeflector = null;
        this.lastDeflectorTeam = null;
        this._openingOwner = null;
        this.arena.pinballTargets?.forEach(target => {
            target.broken = false;
            target.mesh.visible = true;
        });
        this._deflectHistory = []; // son 2 deflector (assist için)
        this.rallyCount = 0;
        // ponytail: killStreak sadece yeni oyunda reset — FIRST BLOOD her round'da değil
        this._spectateTarget = null;
        // ponytail fix: ölü oyuncuları spawn noktasında dirilt
        if (!this.player.alive) this.player.respawn();
        this.bots.forEach(b => { if (!b.alive) { b.alive = true; b.respawn(); } });
        this.remotePlayers.forEach(p => {
            if (p.queuedForNextRound) {
                p.alive = false;
                p.group.visible = false;
                return;
            }
            if (!p.alive) {
                p.alive = true;
                p.hp = p.maxHp;
                const spawn = this.arena.getPlayerSpawn(p.team);
                p.position.copy(spawn);
                p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
                p.group.rotation.y = p.team === 'red' ? 0 : Math.PI;
                p.group.visible = true;
            }
        });

        // First target
        const targets = this.guidedDrill.active ? [] : this.getAllTargets();
        if (targets.length) {
            const first = targets[Math.floor(Math.random() * targets.length)];
            setTimeout(() => {
        // ponytail: host-only hit detection — client plays effects from ball/playerHit broadcast
        if (this.ball.active && this.network?.isHost) {
                    this.ball.setTarget(first);
                    this.ball.state = 'homing';
                }
            }, 700);
        }
        this.ui.showRoundBanner(this.scoreboard.roundNum, this.scoreboard.redScore, this.scoreboard.blueScore);
        // P2P: round start state'i tüm client'lara bildiriyoruz, böylece istemciler eşzamanlı başlar.
        if (this.network?.isHost) {
            this.network.broadcastRoundStart(this.snapshotState());
        }
    }

    // Rebuild the arena as a different map (called from the lobby).
selectMap(mapId) {
    if (this.state !== STATES.LOBBY && this.state !== STATES.MENU) return;
    if (this._rallyDuel) mapId = normalizeRallyDuelMap(mapId);
        if (this.arena.mapId === mapId) return;
        this.arena.rebuild(mapId);
        this.player.respawn();
        this.bots.forEach(b => b.respawn());
        this.ui.showMessage(`Arena: ${this.arena.config.name}`, 1400);
        if (this.network?.isHost) {
        this.network.broadcast({ type: 'mapChange', mapId });
    }
    this.onMapChange?.(mapId);
    }

    // Map banlama (LoL tarzı). Lobby'de her takım banlar.
    banMap(mapId) {
        if (this.bannedMaps.has(mapId)) {
            this.bannedMaps.delete(mapId);
        } else {
            this.bannedMaps.add(mapId);
        }
        return Array.from(this.bannedMaps);
    }

    // Banned olmayan map'lerden random seç (startGame sırasında).
    pickRandomMap() {
        const all = Object.keys(Arena.MAPS || {});
        const available = all.filter(id => !this.bannedMaps.has(id));
        if (!available.length) return this.arena.mapId;
        return available[Math.floor(Math.random() * available.length)];
    }

    // Oyun modu seç (lobby'den). Mutator'ları uygular.
selectMode(modeId) {
        if (this.state !== STATES.LOBBY && this.state !== STATES.MENU) return;
    applyMode(this, modeId);
    this.applyMatchModifier();
    if (this._rallyDuel) this.selectMap(normalizeRallyDuelMap(this.arena.mapId));
        this.ui.showMessage?.(`Mode: ${this.mode.name}`, 1400);
        if (this.network?.isHost) {
        this.network.broadcast({ type: 'modeChange', modeId: this.mode.id });
    }
    this.onModeChange?.(this.mode.id);
}

getSelectableMaps() {
    return this._rallyDuel ? [...RALLY_DUEL_MAPS] : Object.keys(Arena.MAPS);
}

    // Emote göster (player veya bot için).
    showEmote(entity, emoteId) {
        this.emotes.show(entity, emoteId);
    }

    getAllTargets() {
        return [this.player, ...this.bots, ...this.remotePlayers.values()]
            .filter(p => !p.queuedForNextRound);
    }

    setMatchModifier(modifier = 'none') {
        if (this.state !== STATES.LOBBY && this.state !== STATES.MENU) return false;
        const ffaModifier = ['ffa_sudden', 'ffa_double'].includes(modifier);
        this.matchModifier = ['none', 'lowgrav', 'pinball', 'night', 'ffa_sudden', 'ffa_double'].includes(modifier)
            && (!ffaModifier || this._ffa) ? modifier : 'none';
        this.applyMatchModifier();
        this.ui.showMessage?.(`Modifier: ${this.matchModifier === 'none' ? 'Standard' : this.matchModifier}`, 1400);
        return true;
    }

    applyMatchModifier() {
        const modifier = this.matchModifier || 'none';
        this.ball._ffaSpeedMultiplier = modifier === 'ffa_sudden' && this._ffa ? 1.3 : 1;
        this._ffaOpeningDouble = modifier === 'ffa_double' && this._ffa;
        if (modifier === 'lowgrav') { this.player.gravity = -7; this.player.jumpForce = 12; }
        if (modifier === 'pinball') this.ball._pinballBounce = true;
        if (modifier === 'night') this.renderer?.setClearColor?.(0x03101f, 1);
    }

    getAliveTeammates(team = this.player.team) {
        return this.getAllTargets().filter(p => p !== this.player && p.alive && p.team === team);
    }

    _claimOpeningOwner(entity) {
        if (this._openingOwner || !entity) return false;
        this._openingOwner = entity;
        this.broadcastSystemMessage(`${entity.name || this.playerName} CLAIMED THE OPENING BALL`);
        return true;
    }

    shouldQueueLateJoin() {
        return isLiveJoinState(this.state);
    }

    queueRemoteForNextRound(playerId) {
        const p = this.remotePlayers.get(playerId);
        if (!p) return null;
        const queued = queueForNextRound(p, {
            team: p.team,
            round: this.scoreboard.roundNum + 1
        });
        const stats = this.scoreboard.players.get(p.name);
        if (stats) Object.assign(stats, { queuedForNextRound: true, pendingTeam: queued.team });
        return queued;
    }

    selectQueuedRemoteTeam(playerId, team) {
        const p = this.remotePlayers.get(playerId);
        if (!selectQueuedTeam(p, team)) return false;
        const stats = this.scoreboard.players.get(p.name);
        if (stats) stats.pendingTeam = team;
        return true;
    }

    selectQueuedLocalTeam(team) {
        if (!selectQueuedTeam(this.player, team)) return false;
        const stats = this.scoreboard.players.get(this.playerName);
        if (stats) stats.pendingTeam = team;
        this.network?.send?.({ type: 'lateJoinTeam', team });
        const status = document.getElementById('late-join-status');
        if (status) status.textContent = `SPECTATING - ${team.toUpperCase()} next round`;
        this.ui.showMessage?.(`Joining ${team.toUpperCase()} next round`, 1600);
        return true;
    }

    activateQueuedPlayers() {
        if (!this.network?.isHost) return;
        this.remotePlayers.forEach(p => {
            if (!activateQueuedEntity(p)) return;
            const stats = this.scoreboard.players.get(p.name);
            if (stats) Object.assign(stats, {
                team: p.team,
                queuedForNextRound: false,
                pendingTeam: null
            });
            this.broadcastSystemMessage(`${p.name} joined ${p.team.toUpperCase()}.`);
        });
    }

    broadcastSystemMessage(text) {
        if (this.network?.connected && !this.network.isHost) return;
        this.addChatMessage('SERVER', text);
        if (this.network?.isHost) this.network.broadcast({ type: 'systemChat', text });
    }

addRemotePlayer(playerId, name = 'Player', team, avatarDataUrl = null, peerId = playerId) {
        if (!playerId || playerId === this.network?.playerId || peerId === this.network?.peer?.id) return null;
        let p = this.remotePlayers.get(playerId);
        if (p) {
            p.peerId = peerId;
            // Re-update avatar only if it changed (first sync may have emoji fallback only).
            if (avatarDataUrl && p.avatar !== avatarDataUrl) {
                p.avatar = avatarDataUrl;
                // Update Minecraft head texture
                if (p.setAvatarTexture) p.setAvatarTexture(avatarDataUrl);
        }
        return p;
    }
    if (this._rallyDuel) {
        const activeHumans = [...this.remotePlayers.values()]
            .filter(player => !player.queuedForNextRound && !player.isBotEntity);
        if (activeHumans.length >= 1) return null;
    }
    const counts = { red: 0, blue: 0 };
        this.getPlayerList().forEach(pl => { counts[pl.team] = (counts[pl.team] || 0) + 1; });
        team = team || (counts.red <= counts.blue ? 'red' : 'blue');
        p = this._createRemotePlayer(playerId, name, team, avatarDataUrl);
        p.playerId = playerId;
        p.peerId = peerId;
        this.remotePlayers.set(playerId, p);
        this.scoreboard.addPlayer(name, team, { peerId });
        this.updateLobbyUI?.();
        return p;
    }

    removeRemotePlayer(playerId) {
        const p = this.remotePlayers.get(playerId);
        if (!p) return;
        Object.values(p._avatarPartTextures || {}).forEach(texture => texture.dispose?.());
        if (p.cosmeticsRoot) {
            p.group.remove(p.cosmeticsRoot);
            disposeObject3D(p.cosmeticsRoot);
            p.cosmeticsRoot = null;
        }
        this.renderer.scene.remove(p.group);
        this.scoreboard.removePlayer(p.name);
        this.remotePlayers.delete(playerId);
        // ponytail: clear per-player streak timer on disconnect to avoid leak
        if (this._killStreakTimers.has(playerId)) {
            clearTimeout(this._killStreakTimers.get(playerId));
            this._killStreakTimers.delete(playerId);
        }
        this._killStreaks?.delete(playerId);
        this.updateLobbyUI?.();
    }

    _createRemotePlayer(peerId, name, team, avatarDataUrl) {
        const group = new THREE.Group();
        const color = team === 'red' ? 0xcc3333 : 0x3355cc;

        // Avatar texture for head (Minecraft-style)
        let headTexture = null;
        if (avatarDataUrl) {
            const img = new Image();
            img.src = avatarDataUrl;
            headTexture = new THREE.Texture(img);
            headTexture.magFilter = THREE.NearestFilter;
            headTexture.minFilter = THREE.NearestFilter;
            img.onload = () => {
                headTexture.image = _avatarFace(img);
                headTexture.needsUpdate = true;
                // Async: after head load, apply avatar pixel colors to body/arms/legs
                const p = this.remotePlayers.get(peerId);
                if (p && p.bodyMesh) _applyAvatarColors(img, p, color);
            };
        }

        // Head — cube with avatar texture (Minecraft style)
        const headMat = new THREE.MeshBasicMaterial({
            map: headTexture,
            color: headTexture ? 0xffffff : 0xffd0aa
        });
        const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), headMat);
        headMesh.position.y = 1.7;
        group.add(headMesh);

        // Body — stretched box, team color
        const bodyMat = new THREE.MeshBasicMaterial({ color });
        const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.35), bodyMat);
        bodyMesh.position.y = 1.05;
        group.add(bodyMesh);

        // Arms
        const armMat = new THREE.MeshBasicMaterial({ color });
        const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.4, 1.1, 0);
        group.add(leftArm);
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.4, 1.1, 0);
        group.add(rightArm);
        const knifeGroup = createKnifeModel(KNIVES.training);
        knifeGroup.scale.setScalar(0.72);
        knifeGroup.position.set(0, -0.42, -0.28);
        knifeGroup.rotation.set(-0.35, 0, -0.15);
        rightArm.add(knifeGroup);

        // Legs
        const legMat = new THREE.MeshBasicMaterial({ color });
        const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.2);
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.15, 0.25, 0);
        group.add(leftLeg);
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.15, 0.25, 0);
        group.add(rightLeg);

        // Name label
        const labelTex = this._makeNameLabelTexture(name, team === 'red' ? 0xff5577 : 0x55aaff);
        const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: true });
        const labelSprite = new THREE.Sprite(labelMat);
        labelSprite.position.y = 2.7;
        labelSprite.scale.set(1.6, 0.45, 1);
        group.add(labelSprite);

        // Target outline — bright red, pulses when this player is the ball's target
        const outlineGeo = new THREE.BoxGeometry(0.9, 2.0, 0.7);
        const outlineMat = new THREE.ShaderMaterial({
            vertexShader: outlineVertexShader,
            fragmentShader: `
                uniform float uPulse;
                void main() {
                    float alpha = 0.3 + 0.3 * uPulse;
                    gl_FragColor = vec4(1.0, 0.0, 0.0, alpha);
                }
            `,
            uniforms: { outlineThickness: { value: 0.08 }, uPulse: { value: 0 } },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false
        });
        const targetOutline = new THREE.Mesh(outlineGeo, outlineMat);
        targetOutline.position.y = 1.25; // center of torso-head group
        targetOutline.visible = false;
        group.add(targetOutline);

        this.renderer.scene.add(group);
        const p = {
            peerId, name, team, group,
            playerId: peerId,
            headMesh, bodyMesh, leftArm, rightArm, leftLeg, rightLeg, knifeGroup,
            targetOutline,
            _outlineActive: false, _teamColor: color,
            _avatarBodyColors: null,
            setTargetOutline(show) {
                if (this.targetOutline) this.targetOutline.visible = show;
                this._outlineActive = show;
            },
            position: this.arena.getPlayerSpawn(team).clone(),
            // Interpolasyon için: snapshotlar arasında lerp. prevPos → targetPos.
            prevPos: this.arena.getPlayerSpawn(team).clone(),
            targetPos: this.arena.getPlayerSpawn(team).clone(),
            interpAlpha: 1,
            velocity: new THREE.Vector3(), radius: 0.7, alive: true,
            hp: 100, maxHp: 100, shield: 0, consecutiveMisses: 0,
            runeBonuses: {}, deflectPower: 1, passive: 'none', totalDamageDealt: 0,
            attacking: false, attackTimer: 0, aimDir: new THREE.Vector3(0, 0, -1),
            labelSprite, avatar: avatarDataUrl || null,
            getPosition() { return this.position.clone(); },
            getAimDirection() { return this.aimDir.clone(); },
            isAttacking() { return this.attacking; },
            setKnifeStyle(style = KNIVES.training) {
                const nextKnife = createKnifeModel(style);
                nextKnife.scale.setScalar(0.72);
                nextKnife.position.set(0, -0.42, -0.28);
                nextKnife.rotation.set(-0.35, 0, -0.15);
                disposeObject3D(this.knifeGroup);
                this.knifeGroup = nextKnife;
                this.rightArm.add(nextKnife);
            },
            recordDamageDealt(amount) { this.totalDamageDealt += amount; },
            onMissDeflect() { this.consecutiveMisses++; },
            onSuccessfulDeflect() { this.consecutiveMisses = 0; },
            drawHpBar() {},
            takeDamage(amount) { this.hp = Math.max(0, this.hp - amount); return this.hp <= 0; },
            revive() { this.alive = true; this.hp = this.maxHp; this.consecutiveMisses = 0; this.group.visible = true; },
            setTeam(nextTeam) {
                this.team = nextTeam;
                this._teamColor = nextTeam === 'red' ? 0xcc3333 : 0x3355cc;
                if (!this.avatar) this._avatarBodyColors = null;
                _applyTeamColor(this, this._teamColor);
            },
            // Update head texture when avatar changes (mesh sync)
            setAvatarTexture(dataUrl) {
                this.avatar = dataUrl || null;
                if (!this.headMesh) return;
                if (dataUrl) {
                    const img = new Image();
                    img.src = dataUrl;
                    const tex = new THREE.Texture(img);
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    img.onload = () => {
                        tex.image = _avatarFace(img);
                        tex.needsUpdate = true;
                        _applyAvatarColors(img, this, this._teamColor);
                    };
                    this.headMesh.material.map = tex;
                    this.headMesh.material.color.setHex(0xffffff);
                } else {
                    this.headMesh.material.map = null;
                    this.headMesh.material.color.setHex(0xffd0aa);
                    Object.values(this._avatarPartTextures || {}).forEach(texture => texture.dispose?.());
                    this._avatarPartTextures = {};
                    [this.bodyMesh, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg].forEach(mesh => {
                        if (!mesh) return;
                        mesh.material.map = null;
                        mesh.material.needsUpdate = true;
                    });
                    // Reset body to team color
                    this._avatarBodyColors = null;
                    _applyTeamColor(this, this._teamColor);
                }
                this.headMesh.material.needsUpdate = true;
            }
        };
        applyEntityCosmetics(p, null);
        group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
        return p;
    }

    getBodyZone(ballPos, playerPos, playerHeight = 1.7) {
        const bottom = playerPos.y - playerHeight;
        const relativeY = (ballPos.y - bottom) / playerHeight;
        if (relativeY > 0.8) return { zone: 'head', multiplier: 2.0, label: 'HEAD' };
        if (relativeY > 0.5) return { zone: 'chest', multiplier: 1.5, label: 'CHEST' };
        if (relativeY > 0.2) return { zone: 'body', multiplier: 1.0, label: 'BODY' };
        return { zone: 'legs', multiplier: 0.8, label: 'LEGS' };
    }

    getDamageFalloff(distance) {
        if (distance < 5) return 1.0;
        if (distance < 15) return 0.8;
        if (distance < 30) return 0.6;
        return 0.5;
    }

    _fireRocket(owner, position, direction, visualOnly = false) {
        const dir = direction.clone().normalize();
        const mesh = createRocketProjectileModel(owner?.team || 'red');
        mesh.position.copy(position).addScaledVector(dir, 1.15);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        this.renderer.scene.add(mesh);
        this.rockets.push({
            mesh,
            position: mesh.position.clone(),
            previous: mesh.position.clone(),
            velocity: dir.multiplyScalar(31),
            owner,
            team: owner?.team || 'red',
            life: 3.2,
            visualOnly
        });
        this.audio?.playSfx?.('rocket_fire', 0.72);
        this.juice?.shake?.(0.08);
        return mesh;
    }

    _explodeRocket(rocket) {
        const origin = rocket.position.clone();
        this.juice?.burst?.(origin, 0xff8a35, 30, 18);
        this.juice?.shockwave?.(origin, 0xffaa44);
        this.juice?.shake?.(0.35);
        this.audio?.playSfx?.('tf2_explosion', 0.55);
        this.audio?.playExplosion?.();
        if (!rocket.visualOnly && this.network?.isHost) {
            this.network.broadcastSkillEffect('soldier_rocket_explode', null, null, {
                x: origin.x, y: origin.y, z: origin.z
            });
        }

        if (!rocket.visualOnly && (!this.network?.connected || this.network?.isHost)) {
            // Soldier rockets are a self-movement tool, never an attack.
            const owner = rocket.owner;
            if (owner?.alive) {
                const ownerPos = owner.getPosition();
                const distance = ownerPos.distanceTo(origin);
                if (distance <= 6.2) {
                    const strength = Math.max(0.25, 1 - distance / 7);
                    if (owner.applyRocketImpulse) owner.applyRocketImpulse(origin, strength);
                    else {
                        const away = owner.position.clone().sub(origin).setY(0);
                        if (away.lengthSq() > 0.001) owner.position.addScaledVector(away.normalize(), 1.7 * strength);
                    }
                    this.onRocketJump?.({ strength, origin });
                }
            }
        }
        disposeObject3D(rocket.mesh);
    }

    _clearRockets() {
        for (const rocket of this.rockets) disposeObject3D(rocket.mesh);
        this.rockets.length = 0;
    }

    _updateRockets(dt) {
        if (!this.rockets.length) return;
        const bounds = this.arena.bounds;
        for (let i = this.rockets.length - 1; i >= 0; i--) {
            const rocket = this.rockets[i];
            rocket.life -= dt;
            rocket.previous.copy(rocket.position);
            rocket.position.addScaledVector(rocket.velocity, dt);
            rocket.mesh.position.copy(rocket.position);
            rocket.mesh.rotateZ(dt * 4);
            const flame = rocket.mesh.userData.flame;
            if (flame) flame.scale.setScalar(0.82 + Math.random() * 0.38);

            let hit = rocket.life <= 0
                || rocket.position.x < bounds.minX || rocket.position.x > bounds.maxX
                || rocket.position.z < bounds.minZ || rocket.position.z > bounds.maxZ
                || rocket.position.y < 0.25
                || rocket.position.y > (this.arena.ceilingHeight || bounds.maxY || 30);
            if (!hit) {
                hit = this.arena.collidables?.some(item =>
                    rocket.position.distanceToSquared(item.pos) <= (item.radius + 0.2) ** 2
                ) || false;
            }
            if (!hit) continue;
            this._explodeRocket(rocket);
            this.rockets.splice(i, 1);
        }
    }

    updateMapHazards(dt) {
        if (this.network?.connected && !this.network?.isHost) return;
        let eliminated = false;
        for (const player of this.getAllTargets()) {
            if (!player?.alive) continue;
            if (isFallDeathPosition(player.getPosition(), this.arena.config)) {
                player.die?.();
                player.alive = false;
                if (player !== this.player && player.group) player.group.visible = false;
                this.scoreboard.recordDeath(player.name || this.playerName);
                this.spawnDeathExplosion(player.getPosition(), player.team);
                eliminated = true;
                continue;
            }
            const hazard = this.arena.getHazardAt?.(player.getPosition());
            player._hazardMoveMul = hazard?.slow || 1;
            if (hazard?.kind !== 'lava') {
                player._hazardDamageTimer = 0;
                continue;
            }

            player._hazardDamageTimer = (player._hazardDamageTimer || 0) - dt;
            if (player._hazardDamageTimer > 0) continue;
            player._hazardDamageTimer = 0.5;
            const lethal = player.takeDamage(hazard.damage);
            player.drawHpBar?.();
            if (player === this.player) this.ui.showMessage?.('🔥 LAVA! Move!', 500);
            if (lethal) {
                player.die?.();
                player.alive = false;
                if (player !== this.player && player.group) player.group.visible = false;
                this.scoreboard.recordDeath(player.name || this.playerName);
                this.spawnDeathExplosion(player.getPosition(), player.team);
                eliminated = true;
            }
        }
        if (eliminated && this._checkTeamElimination()) {
            this.setState(STATES.ROUND_END);
            this.roundRestartTimer = this.roundRestartDelay;
        }
    }

    getEnemyTargets(team, self = null) {
        if (this._ffa) return this.getAllTargets().filter(p => p !== self && p.alive);
        return this.getAllTargets().filter(p => p !== self && p.alive && p.team !== team);
    }

    // Tüm takımın ölü olup olmadığını kontrol et.
    // Ölen takımın karşı tarafına puan verir. İki takım da ölürse draw.
    _checkTeamElimination() {
        const all = this.getAllTargets();
        if (this._ffa) {
            const alive = all.filter(p => p.alive);
            if (alive.length > 1) return false;
            const winnerName = alive[0]?.name || (alive[0] === this.player ? this.playerName : null);
            const winner = winnerName ? 'ffa' : 'draw';
            if (winnerName) {
                this.scoreboard.recordPoint(winnerName, 1);
                this.announce(`${winnerName} WINS THE ROUND!`, 'tf2_domination', 0.5, 2000);
            } else {
                this.ui.showMessage?.('DOUBLE KO - DRAW!', 2000);
            }
            if (this.network?.isHost) {
                this.network.broadcastRoundEnd({
                    winner,
                    winnerName,
                    red: this.scoreboard.redScore,
                    blue: this.scoreboard.blueScore,
                    round: this.scoreboard.roundNum
                });
            }
            return true;
        }
        const redAlive = all.filter(p => p.alive && p.team === 'red');
        const blueAlive = all.filter(p => p.alive && p.team === 'blue');
        let winner = null;
        if (redAlive.length === 0 && blueAlive.length > 0) {
            this.scoreboard.recordRoundWin('blue');
            this.announce('🔵 BLUE TEAM WINS THE ROUND!', 'tf2_domination', 0.5, 2000);
            winner = 'blue';
        } else if (blueAlive.length === 0 && redAlive.length > 0) {
            this.scoreboard.recordRoundWin('red');
            this.announce('🔴 RED TEAM WINS THE ROUND!', 'tf2_domination', 0.5, 2000);
            winner = 'red';
        } else if (redAlive.length === 0 && blueAlive.length === 0) {
            this.ui.showMessage?.('⚔️ DOUBLE KO — DRAW!', 2000);
            winner = 'draw';
        } else return false;
        // P2P: round bitti → client'a bildir ve sonraki round süresini paylaş.
        if (this.network?.isHost) {
            this.network.broadcastRoundEnd({ winner, red: this.scoreboard.redScore, blue: this.scoreboard.blueScore, round: this.scoreboard.roundNum });
        }
        return true;
    }

    getClosestEnemy(fromPos, team) {
        const enemies = this.getEnemyTargets(team);
        if (!enemies.length) return null;
        // %35 random target (not always closest) so ball doesn't always go behind you
        if (Math.random() < 0.35) {
            return enemies[Math.floor(Math.random() * enemies.length)];
        }
        let closest = null, minD = Infinity;
        enemies.forEach(e => {
            const pos = e.getPosition();
            const d = fromPos.distanceTo(pos);
            if (d < minD) { minD = d; closest = e; }
        });
        return closest;
    }

    // Aim-directed target: the enemy whose direction best matches where the player
    // is aiming. Used for aimed (rocketdodge) shots so the ball goes where you look.
    // Falls back to closest enemy if nothing is roughly ahead.
    getAimedEnemy(fromPos, aimDir, team) {
        const enemies = this.getEnemyTargets(team);
        if (!enemies.length) return null;
        let best = null, bestDot = 0.5; // must be within ~60° of aim
        enemies.forEach(e => {
            const dir = new THREE.Vector3().subVectors(e.getPosition(), fromPos).normalize();
            const dot = aimDir.dot(dir);
            if (dot > bestDot) { bestDot = dot; best = e; }
        });
        if (best) return best;
        return enemies.reduce((closest, enemy) => {
            if (!closest) return enemy;
            return fromPos.distanceTo(enemy.getPosition()) < fromPos.distanceTo(closest.getPosition())
                ? enemy
                : closest;
        }, null);
    }

    // --- MAIN LOOP ---

    update(dt) {
        const localCosmetics = this.localCosmeticEntity;
        if (localCosmetics) {
            applyEntityCosmetics(localCosmetics, window.__store?.get?.('equippedWearables'));
            localCosmetics.group.position.copy(this.player.getPosition()).add(new THREE.Vector3(0, -1.2, 0));
            localCosmetics.group.rotation.y = this.player.camera?.rotation?.y || 0;
            localCosmetics.group.visible = this.player.alive !== false
                && [STATES.COUNTDOWN, STATES.PLAYING, STATES.ROUND_END, STATES.CELEBRATION].includes(this.state);
            updateEntityCosmetics(localCosmetics, performance.now() / 1000);
        }
        // Juice: hit-stop/slow-mo/screen shake uygula, effective dt döndür
        const effectiveDt = this.juice.update(dt);
        if (effectiveDt === 0 && this.state !== STATES.CELEBRATION) return; // hit-stop: dünya donar (ama celebration'da değil)
        dt = effectiveDt || dt;

        // Time scale (console: sv_timescale)
        if (this._timeScale && this._timeScale !== 1) dt *= this._timeScale;

        // ponytail: pending-lethal-hit grace window is timeout-based, handled
        // inside handleHit / remoteAttack — no per-frame check needed here.

        // Active black holes — gravitational pull & visual update
        this.updateBlackHoles(dt);

        // Emote sprite'ları güncelle
        this.emotes.update(dt);
        if (this.state === STATES.PLAYING || this.state === STATES.CELEBRATION) this._updateRockets(dt);

        if (this.state === STATES.PLAYING && !this._guidedDrillResultOpen) {
            if (this.guidedDrill.active) this._updateGuidedDrill(dt);
            const hiddenDrill = this.guidedDrill.active
                && typeof document !== 'undefined'
                && document.hidden;
            if (!hiddenDrill && !this._guidedDrillResultOpen) this.updatePlaying(dt);
        } else if (this.state === STATES.COUNTDOWN && this.ball._warmup) {
            if (!this.network?.connected || this.network?.isHost) {
                this.ball.update(dt);
            } else {
                this.ball._clientVisualUpdate(dt);
            }
            if (this.player.alive && this.player.isAttacking()) {
                const dist = this.ball.position.distanceTo(this.player.getPosition());
                if (dist < this.ball.attackRange) this.handlePlayerDeflection();
            }
            if (!this.network?.connected || this.network?.isHost) {
                this.bots.forEach(bot => {
                    if (this.ball.active && bot.tryDeflect(this.ball, dt)) this.handleBotDeflection(bot);
                });
            }
            this.updateSplitBalls(dt);
        } else if (this.state === STATES.CELEBRATION) {
            this._celebrationTimer -= dt;
            // Only update timer message every second (not every frame)
            if (Math.floor(this._celebrationTimer) !== this._lastCelebSec) {
                this._lastCelebSec = Math.floor(this._celebrationTimer);
                this.ui.showMessage?.(`🎉 ${Math.ceil(this._celebrationTimer)}s`, 900);
            }

            this._celebWeapon = 'rocket';
            const wh = document.getElementById('celeb-weapon-hud');
            if (wh) wh.style.display = '';

            // Winner attacks losers with rockets only.
            if (this.player.attacking && this.player.team === this._winningTeam) {
                this._spawnMuzzleFlash('rocket');
                this._fireRocket(this.player, this.player.getPosition(), this.player.getAimDirection());
                this.player.attacking = false;
                return;
            }
            // Bots participate during celebration — everyone moves freely
            this.bots.forEach(bot => {
                if (!bot.alive) return;
                // Periodic random wander target so bots visibly move
                if (!bot._celebTarget || bot.position.distanceTo(bot._celebTarget) < 2) {
                    const b = this.arena.bounds;
                    bot._celebTarget = new THREE.Vector3(
                        b.minX + 2 + Math.random() * (b.maxX - b.minX - 4),
                        0,
                        b.minZ + 2 + Math.random() * (b.maxZ - b.minZ - 4)
                    );
                }
                const dir = new THREE.Vector3().subVectors(bot._celebTarget, bot.position).normalize();
                bot.position.add(dir.multiplyScalar(bot.moveSpeed * 0.6 * dt));
                bot.position.y = 0;
                // Turn to face movement direction
                if (dir.lengthSq() > 0.01) {
                    bot.group.rotation.y = Math.atan2(dir.x, dir.z);
                }
                bot.group.position.copy(bot.position);
                // Attack cooldown
                if (bot.attackTimer > 0) {
                    bot.attackTimer -= dt;
                    if (bot.attackTimer <= 0) bot.attacking = false;
                }
                // Winners damage nearby enemies
                if (bot.team === this._winningTeam) {
                    const targets = this.bots.filter(b => b.alive && b.team !== bot.team);
                    for (const t of targets) {
                        if (bot.position.distanceTo(t.getPosition()) < 2.5) {
                            t.takeDamage?.(6);
                            t.alive = false;
                            t.group.visible = false;
                            this.spawnDeathExplosion(t.getPosition(), t.team);
                        }
                    }
                }
            });

            const isClient = this.network?.connected && !this.network?.isHost;
            if (!isClient && this._celebrationTimer <= 0) this._onCelebrationEnd();
        } else if (this.state === STATES.ROUND_END) {
            this.roundRestartTimer -= dt;
            const curSec = Math.ceil(this.roundRestartTimer);
            if (curSec !== this._lastRoundEndSec) {
                this._lastRoundEndSec = curSec;
                this.ui.showMessage?.(`⏳ Next round in ${curSec}s`, 500);
            }
            const isClient = this.network?.connected && !this.network?.isHost;
            if (!isClient && this.roundRestartTimer <= 0) {
                if (this._overtimeExtends > 0 && shouldEndOvertime({
                    redScore: this.scoreboard.redScore,
                    blueScore: this.scoreboard.blueScore,
                    roundsExtended: this._overtimeExtends
                })) {
                    this.endGame();
                } else if (this.scoreboard.isTimeUp() || this.scoreboard.isMaxRounds()) {
                    if (shouldStartOvertime({
                        redScore: this.scoreboard.redScore,
                        blueScore: this.scoreboard.blueScore,
                        timeUp: this.scoreboard.isTimeUp(),
                        maxRounds: this.scoreboard.isMaxRounds()
                    }) && this._overtimeExtends < 8) {
                        this._overtimeExtends++;
                        this.scoreboard.maxRounds++;
                        this.announce('OVERTIME - next round breaks the tie!', null, 0, 3000);
                        this.startRound();
                    } else {
                        this.endGame();
                    }
                } else {
                    this.startRound();
                }
            }
        }

        // Death particles
        this.updateDeathParticles(dt);

        // Chat bubbles
        this.updateChatBubbles(dt);

        // Bot chatter
        if (this.state === STATES.PLAYING && this.bots.length) {
            this.botChatTimer -= dt;
            if (this.botChatTimer <= 0) {
                this.botChatTimer = 10 + Math.random() * 12;
                const bot = this.bots[Math.floor(Math.random() * this.bots.length)];
                const line = this.botLines[Math.floor(Math.random() * this.botLines.length)];
                this.addChatMessage(bot.name, line);
            }
        }

        this.arena.update(performance.now() / 1000, dt);
        // Map voting countdown (host-side)
        if (this._mapVoteActive && this.network?.isHost) {
            this._mapVoteElapsed += dt;
            if (this._mapVoteElapsed >= this._mapVoteTimeout) {
                this._finalizeMapVote();
            }
        }
    }

    getCompetitiveHUDState() {
        const rules = this.competitiveRules;
        const configuredMaxRounds = Number(this.mode?.mutators?.maxRounds);
        return {
            active: Boolean(rules),
            mode: this.mode?.name || '',
            round: this.scoreboard.roundNum,
            maxRounds: Number.isFinite(configuredMaxRounds)
                ? configuredMaxRounds
                : this.scoreboard.maxRounds,
            overtime: this._overtime || this._overtimeExtends > 0,
            suddenDeath: this._suddenDeathAnnounced === true,
            tiebreakRound: this._overtimeExtends,
            abilities: rules?.abilities !== false,
            runes: rules?.runes !== false,
            passives: rules?.passives !== false,
            powerUps: rules?.powerUps !== false
        };
    }

    _applyOvertimeSnapshot(data = {}) {
        if (Number.isSafeInteger(data.overtimeExtends)) {
            this._overtimeExtends = Math.min(8, Math.max(0, data.overtimeExtends));
        }
        if (typeof data.overtime === 'boolean') this._overtime = data.overtime;
        if (Number.isFinite(data.overtimeTimer)) {
            this._overtimeTimer = Math.min(3600, Math.max(0, data.overtimeTimer));
        }
        if (typeof data.suddenDeathAnnounced === 'boolean') {
            this._suddenDeathAnnounced = data.suddenDeathAnnounced;
        }
    }

    updatePlaying(dt) {
        this.scoreboard.updateTimer(dt);
        if ((!this.network?.connected || this.network?.isHost) && this._updateHotPotato(dt)) return;
        if (this.scoreboard.isTimeUp()) {
            if (this.scoreboard.redScore === this.scoreboard.blueScore && !this._overtime) {
                this._overtime = true;
                this._overtimeTimer = 0;
                this.announce('⚡ OVERTIME!', null, 0, 2000);
                this.ui.showStreak?.('OVERTIME!', 'ace');
            } else if (!this._overtime) {
                this.endGame();
                return;
            }
        }

        // Overtime: escalate ball speed
        if (this._overtime) {
            this._overtimeTimer += dt;
            const speedMul = Math.min(this._overtimeMaxSpeed, 1 + this._overtimeTimer * 0.1);
            if (this.ball.active) {
                this.ball.currentSpeed = this.ball.baseSpeed * speedMul * (this.ball.skinConfig?.speedBonus || 1);
            }
            if (this._overtimeTimer >= 30 && !this._suddenDeathAnnounced) {
                this._suddenDeathAnnounced = true;
                this.announce('SUDDEN DEATH!', null, 0, 2000);
            }
        }

        // Top donmuşsa timer tick
        if (this.ball._frozenTimer > 0) {
            this.ball._frozenTimer -= dt;
            if (this.ball._frozenTimer <= 0) {
                this.ball.velocity.multiplyScalar(100); // yeniden başlat
            } else {
                // donmuşken pozisyon güncellenmesin
                this.bots.forEach(bot => bot.update(dt, this.ball));
                this.updateMinimap();
                return;
            }
        }



        // Map affixes — damage zones, etc
        if (this.affixes) {
            const allPlayers = [this.player, ...this.bots];
            this.affixes.update(dt, allPlayers);
        }
        this.updateMapHazards(dt);
        if (this._chaosModeIds.has(this.mode?.id)) {
            this.chaosManager.update(dt, this);
            // Host: periodically broadcast chaos state to clients
            if (this.network?.isHost) {
                this._chaosSyncTimer += dt;
                if (this._chaosSyncTimer >= 2) {
                    this._chaosSyncTimer = 0;
                    this.network.broadcastChaosState({
                        tornadoes: this.chaosManager.tornadoes.map(t => ({
                            x: t.x, z: t.z, radius: t.radius,
                            strength: t.strength, life: t.life,
                            age: t.age, rotation: t.rotation
                        })),
                        gravityFlipped: this.chaosManager.gravityFlipped
                    });
                }
            }
        }

        // Target outline — kimde sıra varsa kırmızı outline
        const target = this.ball.targetPlayer;
        this.bots.forEach(bot => {
            const isTarget = bot === target && this.ball.active;
            bot.setTargetOutline(isTarget);
        });
        this.remotePlayers.forEach(p => {
            const isTarget = p === target && this.ball.active;
            p.setTargetOutline?.(isTarget);
        });
        // Player skill tuşu (Q) — tap = skill, hold 2s = ultimate
        if (!this._skillsDisabled && this.player.keys['KeyQ'] && this.player.ultimateCharge >= 100 && !this.player.ultimateActive) {
            this.player._qHoldTimer = (this.player._qHoldTimer || 0) + dt;
            if (this.player._qHoldTimer >= 2) {
                this.player._qHoldTimer = 0;
                const ult = this.player.useUltimate();
                if (ult) this.activateUltimate(ult);
            }
        } else {
            this.player._qHoldTimer = 0;
        }
        if (this.player._skillQueued) {
            this.player._skillQueued = false;
            if (!this._skillsDisabled) {
                const ok = this.player.tryUseSkill({ ball: this.ball, target: this.ball.targetPlayer, game: this });
                if (ok) {
                    const skillId = this.player.loadout.skill;
                    this.ui.showMessage(`${skillId.toUpperCase()}!`, 800);
                    this.audio.playSfx('tf2_medic', 0.35);
                    this.audio.playBeep(660);
                    // ponytail: host spawns black hole; client receives broadcast
                    if (skillId === 'blackhole' && (!this.network?.connected || this.network?.isHost)) this.spawnBlackHole();
                    // Client: send skill intent to host for authoritative effects
                    if (this.network?.connected && !this.network?.isHost) {
                        const aim = this.player.getAimDirection();
                        this.network.sendSkillUse({
                            skill: skillId,
                            ax: aim.x, ay: aim.y, az: aim.z,
                            bx: this.ball.position.x, by: this.ball.position.y, bz: this.ball.position.z
                        });
                    }
                }
            }
        }

        // Bot AI only on host — client lerps bots from network
        if (!this.network?.connected || this.network?.isHost) {
            this.bots.forEach(bot => {
                bot.update(dt, this.ball);
                if (bot._pendingBlackHole) {
                    bot._pendingBlackHole = false;
                    this.spawnBlackHole();
                }
            });
        }
        if (this.player._rocketQueued) {
            this.player._rocketQueued = false;
            if (!this._skillsDisabled && this.player.charId === 'soldier' && this.player.rocketCooldown <= 0) {
                this.player.rocketCooldown = 0.82;
                const aim = this.player.getAimDirection();
                if (this.network?.connected && !this.network?.isHost) {
                    this.network.sendSkillUse({
                        skill: 'soldier_rocket',
                        ax: aim.x, ay: aim.y, az: aim.z,
                        x: this.player.position.x, y: this.player.position.y, z: this.player.position.z
                    });
                } else {
                    this._fireRocket(this.player, this.player.getPosition(), aim);
                    this.network?.broadcastSkillEffect?.('soldier_rocket', this.network.playerId, this.network.peer?.id, {
                        x: this.player.position.x, y: this.player.position.y, z: this.player.position.z,
                        ax: aim.x, ay: aim.y, az: aim.z
                    });
                }
            }
        }
        if (!this.ball.active) return;

        // Spin-Dodge (A-D-A-D) — orbit the ball
        if (this.ball.state === 'orbiting') {
            const timedOut = this.ball.orbitTimer !== undefined && this.ball.orbitTimer <= 0;
            if (this.player.attacking || timedOut) {
                const aimDir = this.player.getAimDirection();
                const target = this.getAimedEnemy(this.player.getPosition(), aimDir, this.player.team);
                const result = this.ball.orbitRelease(aimDir, target);
                if (target) this.ball.setTarget(target);
                this.player.attacking = false;
                this.lastDeflector = this.player;
                this.lastDeflectorTeam = this.player.team;
                this._pushDeflectHistory(this.playerName);
                this.ball.lastShotBy = this.playerName;
                this.rallyCount++;
                this.player.onSuccessfulDeflect?.();
                this.audio.playSfx('tf2_hit', 0.35);
                this.audio.playDeflect('flat');
                this.audio.playWhoosh(this.ball.getSpeed());
            }
        } else if (this.player.didSpinDodge() && this.ball.isInAttackRange(this.player.getPosition())) {
            // A-D-A-D trigger: orbit the ball around you
            if (this.ball.state !== 'orbiting') {
                this.ball.startOrbit(this.player);
                this.ui.showMessage?.('🌀 Spin Dodge!', 1000);
            }
        }

        // Player deflection — aim-based
        // CS2-style: never block deflect on ball.active check alone.
        // Host's late-deflect grace window in remoteAttack handles reactivation.
        const practiceAttacking = this.player.alive && this.player.isAttacking();
        if (this._practiceMode && practiceAttacking && !this._practiceAttemptActive) {
            this._practiceAttemptActive = true;
            this._practiceAttemptHit = false;
        } else if (this._practiceMode && !practiceAttacking && this._practiceAttemptActive) {
            if (!this._practiceAttemptHit) {
                this.practiceMetrics.recordAttempt({ hit: false });
                if (this.guidedDrill.active && this.guidedDrill.openAttemptId !== null) {
                    this.guidedDrill.resolveAttempt({
                        attemptId: this.guidedDrill.openAttemptId,
                        hit: false
                    });
                    this.ball.deactivate();
                    this.onGuidedDrillUpdate?.(this.guidedDrill.snapshot());
                }
                this.onPracticeMetrics?.(this.practiceMetrics.summary());
            }
            this._practiceAttemptActive = false;
            this._practiceAttemptHit = false;
        }
        if (practiceAttacking) {
            // Client: use larger range for forgiving prediction (host validates authoritatively)
            const isClient2 = this.network?.connected && !this.network?.isHost;
            const ballPos = this.ball.position;
            const playerPos = this.player.getPosition();
            const dist = ballPos.distanceTo(playerPos);
            // ponytail: unify client prediction range — both use speed-scaled bonus
            const speedBonus = Math.min(this.ball.currentSpeed * 0.003, 3.0);
            const deflectionRange = isClient2
                ? this.ball.attackRange * 1.5 + speedBonus
                : this.ball.attackRange + speedBonus;
            if (dist < deflectionRange || (this.ball._prevPosition &&
                segmentIntersectsSphere(this.ball._prevPosition, ballPos, playerPos, deflectionRange))) {
                this.handlePlayerDeflection(isClient2);
            }
        }

        // Bot deflections — before ball moves
        // ponytail: bot AI/deflection runs on host only; client renders from botSync
        if (!this.network?.connected || this.network?.isHost) {
            this.bots.forEach(bot => {
                if (this.ball.active && bot.tryDeflect(this.ball, dt)) {
                    this.handleBotDeflection(bot);
                }
            });
        }

        // ponytail: ball physics runs on host only; client renders position from snapshot smoothing
        if (!this.network?.connected || this.network?.isHost) {
            const bounced = this.ball.update(dt);
            if (this._practiceMode && !this.guidedDrill.active && bounced) {
                this.ball.setTarget(this.player);
                this.ball.state = 'homing';
                this.ball._homingAge = 0;
            }
            if (bounced && !this.juice._hitStopActive) this.audio.playBounce?.();
            if (this.ball.active) {
                this._analyticsSampleTimer = (this._analyticsSampleTimer || 0) - dt;
                if (this._analyticsSampleTimer <= 0) {
                    this._analyticsSampleTimer = 0.1;
                    this.matchAnalytics.recordTrajectory(this.ball.position);
                }
            }
        } else {
            // ponytail: client ball visual update — trail, glow, rotation, squash
            this.ball._clientVisualUpdate(dt);
        }

        // Hit detection — body volume instead of single point.
        // Ball can hit anywhere: head, chest, abdomen, legs.
        // Aimed shots fly straight, so check EVERY enemy of the thrower's team in the
        // ball's path — you damage whoever you actually hit, not just an assigned target.
        // Ghost affix: skip player collision entirely.
        if (this.ball.active && !this._practiceMode && !this.ball._affixGhost && !this.ball._warmup && this.ball._noHitTimer <= 0) {
            const ballPos = this.ball.position;
            const throwerTeam = this.lastDeflectorTeam;
            // Candidates: enemies of the thrower (or just the assigned target as fallback).
            const candidates = this._ffa
                ? this.getAllTargets().filter(p => p !== this.lastDeflector && p.alive)
                : (throwerTeam
                    ? this.getAllTargets().filter(p => p.team !== throwerTeam)
                    : (this.ball.targetPlayer ? [this.ball.targetPlayer] : []));
            for (const target of candidates) {
                if (!target || target.alive === false) continue;
                const headPos = target.getPosition();
                const hitBonus = this.ball.effectiveHitRange ? (this.ball.effectiveHitRange - this.ball.hitRange) : 0;
                const sizeScale = target._sizeScale || 1;
                if (this.capsuleHitTest(ballPos, headPos, 1.7 * sizeScale, (0.4 + hitBonus) * sizeScale)) {
                    this.handleHit(target);
                    return;
                }
            // ponytail: swept sphere check — test ball trajectory for tunneling prevention
            // Catches moderate-speed tunneling; steps scale with speed
            if (this.ball._prevPosition && this.ball.currentSpeed > 12) {
                const steps = Math.min(3, Math.ceil(this.ball.currentSpeed * 0.015));
                for (let s = 1; s <= steps; s++) {
                    const t = s / (steps + 1);
                    const interpPos = new THREE.Vector3().lerpVectors(this.ball._prevPosition, ballPos, t);
                    if (this.capsuleHitTest(interpPos, headPos, 1.7 * sizeScale, (0.4 + hitBonus) * sizeScale)) {
                        this.handleHit(target);
                        return;
                    }
                }
            }
                // ponytail: proximity forced-hit — top hedefe çok yakınken oyuncu
                // vurmazsa zorunlu hit. Sonsuz döngü engeli + tunneling fix.
                if (this.ball._forceHit) {
                    const px = headPos.x, pz = headPos.z;
                    const py = headPos.y;
                    const dx2 = ballPos.x - px, dz2 = ballPos.z - pz, dy2 = ballPos.y - py;
                    const proxDistSq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
                    // ponytail: expanded proximity range for fast balls
                    const effectiveRange = this.ball._proximityRange + Math.min(this.ball.currentSpeed * 0.002, 1.5);
                    if (proxDistSq < effectiveRange * effectiveRange) {
                        this.handleHit(target);
                        return;
                    }
                }
            }
        }

        // ponytail: near-miss effect — ball passes close to player without hitting
        if (this.ball.active && this.player.alive && this.ball.targetPlayer !== this.player) {
            const ballToPlayer = this.ball.position.distanceTo(this.player.getPosition());
            if (ballToPlayer < 2.5 && ballToPlayer > 1.0 && this.ball.currentSpeed > 30) {
                if (!this._nearMissCooldown || performance.now() - this._nearMissCooldown > 500) {
                    this._nearMissCooldown = performance.now();
                    this.juice.shake(0.06);
                    this.ui.showMessage?.('⚡ NEAR MISS!', 400);
                }
            }
        }

        // Split affix projectiles
        this.updateSplitBalls(dt);

        // HUD — damage meter dahil
        this.ui.updateHUD({
            time: this.scoreboard.getFormattedTime(),
            redScore: this.scoreboard.redScore,
            blueScore: this.scoreboard.blueScore,
            ballSpeed: this.ball.getSpeed(),
            round: this.scoreboard.roundNum,
            deflections: this.rallyCount,
            hotPotato: this.getHotPotatoSnapshot(),
            competitive: this.getCompetitiveHUDState()
        });
        this.ui.updateBallAffix(this.currentBallAffix);
        this.ui.updateVitals(this.player.hp, this.player.maxHp, this.player.shield,
            this.player.stamina, this.player.staminaMax, this.player.exhausted);
        this.ui.updateSkillCooldown?.(this.player.skillCooldowns, this.player.loadout.skill);
        this.ui.updateUltimate?.(this.player.ultimateCharge, this.player.ultimateCharge >= 100);

        // Combo display — continuous update with labels
        this.ui.updateCombo(this.juice.combo, this.juice.combo > 4 ? 'GODLIKE!' : this.juice.combo > 3 ? 'UNSTOPPABLE!' : this.juice.combo > 2 ? 'DOMINATING!' : this.juice.combo > 1 ? 'DOUBLE KILL!' : '');

        // Kill feed — render & prune expired entries
        this.ui.renderKillFeed(this.killFeed);
        this.killFeed = this.killFeed.filter(e => performance.now() - e.time < 5000);

        // Power-up spawn/pickup
        if (!this._powerUpsDisabled) this.updatePowerUps(dt);

        this.updateMinimap();
    }

    handlePlayerDeflection(skipAimCheck = false) {
        const pos = this.player.getPosition();
        const aimDir = this.player.getAimDirection();
        const team = this.player.team;

        // Skill check: must be roughly looking at the ball (~100° cone).
        // Client-side prediction skips this so the hit ALWAYS feels connected
        // (host is authoritative and still enforces it via remoteAttack).
        const ballDir = new THREE.Vector3().subVectors(this.ball.position, pos).normalize();
        if (!skipAimCheck && aimDir.dot(ballDir) < -0.2) return;
        this._cancelPendingLethalHit(this.player);

        // ponytail: client-side prediction. Deflect locally for instant feedback,
        // send intent to host. Host broadcasts authoritative state to correct if needed.
        const isClientCP = this.network?.connected && !this.network?.isHost;
        if (isClientCP) {
            this.player.attacking = false;
            this.player._p2pAttackQueued = false;
            // Predict deflection locally
            const flick = this.player.getFlick();
            const nextTarget = this.getAimedEnemy(pos, aimDir, team);
            const result = this.ball.deflectWithAim(pos, aimDir, nextTarget, flick, null, this.player.deflectPower);
            if (nextTarget) this.ball.setTarget(nextTarget);
            if (this.ball._affixSplit) this.spawnSplitBall(this.ball);
            this.lastDeflector = this.player;
            this.lastDeflectorTeam = team;
            this._pushDeflectHistory(this.playerName);
            this.ball.lastShotBy = this.playerName;
            this.rallyCount++;
            this.player.onSuccessfulDeflect();
            this.scoreboard.recordDeflection(this.playerName);
            // Update ball smoothing target to match predicted state
            this._ballTarget = {
                x: this.ball.position.x, y: this.ball.position.y, z: this.ball.position.z,
                vx: this.ball.velocity.x, vy: this.ball.velocity.y, vz: this.ball.velocity.z
            };
            this._ballTargetTime = performance.now();
            // Send attack intent to host for authoritative processing
            const localFlick = this.player.getFlick();
            this.network?.sendAttack?.({
                attackId: `${this.network?.playerId || 'client'}:${this._attackSeq = (this._attackSeq || 0) + 1}`,
                name: this.playerName, team: this.player.team,
                x: pos.x, y: pos.y, z: pos.z,
                ax: aimDir.x, ay: aimDir.y, az: aimDir.z,
                bx: this.ball.position.x, by: this.ball.position.y, bz: this.ball.position.z,
                ping: Math.min(250, Math.max(0, this.network?.getPing?.() || 0)),
                action: this.player.knifeAttackType === 'stab' ? 'stab' : 'slash',
                flick: { vertical: localFlick?.vertical || 0, horizontal: localFlick?.horizontal || 0, power: localFlick?.power || 0 }
            });
            // Effects
            this.player.kick(result.shot);
            this.audio.playSfx(result.shot === 'spike' ? 'tf2_frying_pan' : 'tf2_hit', 0.35);
            this.audio.playDeflect(result.shot);
            this.audio.playWhoosh(this.ball.getSpeed());
            const slashDir = new THREE.Vector3().subVectors(this.ball.position, pos).normalize();
            this.juice.slashEffect(pos.clone().add(new THREE.Vector3(0, 1, 0)), slashDir, 0x00ffee);
            this.juice.sparks(this.ball.position.clone(), 0xff8844, 6);
            this.juice.shake(0.08);
            this.ui.showMessage('🏐 Deflect!', 600);
            return;
        }

        // Pick the enemy closest to where you're looking
        const nextTarget = this.getAimedEnemy(pos, aimDir, team);
        const flick = this.player.getFlick();
        const momentum = this.player._frameVel;
        const result = this.ball.deflectWithAim(pos, aimDir, nextTarget, flick, momentum, this.player.deflectPower);
        if (nextTarget) this.ball.setTarget(nextTarget);
        if (this.ball._affixSplit) this.spawnSplitBall(this.ball);

        // Blazer pasif: top hedefi yakar
        if (nextTarget && this.player.passive === 'burn_touch') {
            nextTarget._burnTimer = 2;
        }
        // Frost pasif: top hedefi yavaşlatır
        if (nextTarget && this.player.passive === 'chill_touch') {
            nextTarget._chillTimer = 2;
        }

        // Consume the swing so one click = one deflect (no multi-hit spam).
        this.player.attacking = false;

        this.lastDeflector = this.player;
        this.lastDeflectorTeam = team;
        this._claimOpeningOwner(this.player);
        this._pushDeflectHistory(this.playerName);
        this.ball.lastShotBy = this.playerName;
        this.rallyCount++;
        this.player.onSuccessfulDeflect();
        this.scoreboard.recordDeflection(this.playerName);
        // Shot-dependent SFX: spike=pan clang, flat=standard hit
        const shotSfx = result.shot === 'spike' ? 'tf2_frying_pan' : 'tf2_hit';
        this.audio.playSfx(shotSfx, 0.35);
        this.audio.playDeflect(result.shot);
        this.audio.playWhoosh(this.ball.getSpeed());

        // Camera punch + screen kick for game feel
        this.player.kick(result.shot);

        // Genji-style deflect slash effect
        const slashDir = new THREE.Vector3().subVectors(this.ball.position, this.player.getPosition()).normalize();
        this.juice.slashEffect(this.player.getPosition().clone().add(new THREE.Vector3(0, 1, 0)), slashDir, 0x00ffee);

        // PERFECT-CATCH: perfect window aktifse bonus (Knockout City tarzı)
        const timingErrorMs = this.ball.getPerfectTimingErrorMs();
        const resolvedDeflect = resolvePerfectDeflect({
            timingErrorMs,
            at: performance.now(),
            chain: this.perfectDeflectChain,
            homingStrength: this.ball.homingStrength || 0
        });
        this.perfectDeflectChain = resolvedDeflect.chain;
        const timingTier = resolvedDeflect.tier;
        const isPerfect = timingTier === 'perfect';
        this.matchAnalytics.recordDeflect({
            player: {
                id: this.network?.playerId || 'local',
                name: this.playerName,
                team
            },
            tier: timingTier || 'normal'
        });
        if (this._practiceMode) {
            this._practiceAttemptHit = true;
            this.practiceMetrics.recordAttempt({
                hit: true,
                tier: timingTier || 'normal',
                reactionMs: Number.isFinite(timingErrorMs) ? timingErrorMs : null
            });
            this.onPracticeMetrics?.(this.practiceMetrics.summary());
        }
        if (this.guidedDrill.active && this.guidedDrill.openAttemptId !== null) {
            let directionErrorDeg = null;
            const drillSnapshot = this.guidedDrill.snapshot();
            if (drillSnapshot.stage.id === 'direction') {
                const outgoing = this.ball.velocity.clone().normalize();
                const desired = this._guidedDrillTargetPosition.clone()
                    .sub(this.ball.position)
                    .normalize();
                directionErrorDeg = Math.acos(
                    THREE.MathUtils.clamp(outgoing.dot(desired), -1, 1)
                ) * 180 / Math.PI;
            }
            this.guidedDrill.resolveAttempt({
                attemptId: this.guidedDrill.openAttemptId,
                hit: true,
                tier: timingTier || 'normal',
                directionErrorDeg
            });
            this.ball.deactivate();
            this.onGuidedDrillUpdate?.(this.guidedDrill.snapshot());
        }
        this.onPerfectDeflect?.({
            tier: timingTier || 'normal',
            chain: this.perfectDeflectChain.count,
            timingErrorMs: Number.isFinite(timingErrorMs) ? timingErrorMs : null,
            reward: resolvedDeflect.reward
        });
        if (isPerfect) {
            this.ball.lastPerfectBy = this.player;
            // Perfect deflect improves timing/reward, not rally speed.
            this.juice.hitStop(100);     // 100ms donma (daha vurucu impact)
            this.juice.shake(0.35);      // daha güçlü shake
            this.juice.sparks(this.ball.position.clone(), 0xffbb00, 16);
            this.juice.shockwave(this.ball.position.clone(), 0xffbb00); // Altın şok dalgası!
            this.juice.addCombo();
            this.ui.showCombo(this.juice.combo, this.juice.maxCombo);
            this.ui.showMessage(`✨ PERFECT DEFLECT! x${this.juice.combo} combo`, 2500);
            this.audio.playSfx('tf2_crit', 0.65);
        } else {
            // Normal deflect — spark + small flash for impact feel
            this.juice.sparks(this.ball.position.clone(), 0xff8844, 8);
            this.juice.shockwave(this.ball.position.clone(), 0xff8844);
            this.juice.shake(0.1);
            this.juice.flash(0.15);
        }

        const spd = Math.round((this.ball.getSpeed() / this.ball.baseSpeed) * 100);
        const tag = result.shot === 'spike' ? '💥 SPIKE!' : result.shot === 'lob' ? '🌈 Lob' : isPerfect ? '✨ PERFECT' : `Rally ${this.rallyCount}`;
        if (result.shot === 'spike') this.spikeCount++;
        this.ui.showMessage(`🏐 ${tag} — ${spd}%`, 800);
    }

    handleBotDeflection(bot) {
        const pos = bot.getPosition();
        const nextTarget = this.getClosestEnemy(pos, bot.team);
        if (!nextTarget) return;

        // Botlar da lob/spike atsın — difficulty'e göre çeşitlilik
        const diff = bot.difficulty || 'medium';
        const skillRate = diff === 'hard' ? 0.4 : diff === 'medium' ? 0.2 : 0.05;
        const aimDir = new THREE.Vector3().subVectors(nextTarget.getPosition(), pos).normalize();
        if (Math.random() < skillRate) {
            const fakeFlick = {
                vertical: Math.random() > 0.5 ? -35 : 35, // spike or lob
                horizontal: (Math.random() - 0.5) * 20,
                power: 0.4 + Math.random() * 0.4
            };
            this.ball.deflectWithAim(pos, aimDir, nextTarget, fakeFlick, null, bot.deflectPower);
        } else {
            this.ball.deflect(pos, nextTarget.getPosition(), bot.deflectPower);
        }
        if (this.ball._affixSplit) this.spawnSplitBall(this.ball);
        this.ball.setTarget(nextTarget);

        // Bot pasifleri
        if (bot.passive === 'burn_touch') nextTarget._burnTimer = 2;
        if (bot.passive === 'chill_touch') nextTarget._chillTimer = 2;

        this.lastDeflector = bot;
        this.lastDeflectorTeam = bot.team;
        this._claimOpeningOwner(bot);
        this._pushDeflectHistory(bot.name);
        this.ball.lastShotBy = bot.name;
        this.rallyCount++;
        bot.onSuccessfulDeflect();
        this.scoreboard.recordDeflection(bot.name);
        this.audio.playSfx('tf2_hit', 0.35);
        this.audio.playDeflect();
        this.audio.playWhoosh(this.ball.getSpeed());

        const spd = Math.round((this.ball.getSpeed() / this.ball.baseSpeed) * 100);
        this.ui.showMessage(`🏐 Rally ${this.rallyCount} — ${spd}%`, 800);
    }

    activateUltimate(ult) {
        this.ui.showMessage?.(`⚡ ${ult.name}!`, 2000);
        this.juice.slowMo(0.5, 0.5);
        this.juice.shake(0.5);
        switch (this.player.charId) {
            case 'tank':
                this.player.shield += 100;
                this.player._damageReduction = 0.3;
                setTimeout(() => { this.player._damageReduction = 0; this.player.ultimateActive = false; }, ult.duration * 1000);
                break;
            case 'scout':
                this.player.speed *= 1.5;
                this.player._transparent = true;
                setTimeout(() => { this.player.speed /= 1.5; this.player._transparent = false; this.player.ultimateActive = false; }, ult.duration * 1000);
                break;
            case 'sniper':
                this.ball._pierceWalls = true;
                this.ball.currentSpeed *= 1.5;
                this.player.ultimateActive = false;
                break;
            case 'guardian':
                this.getAllTargets().filter(p => p.team === this.player.team && p.alive).forEach(p => {
                    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3);
                });
                this.player.ultimateActive = false;
                break;
            case 'rally':
                this.ball.currentSpeed *= 1.5;
                this.ball.velocity.multiplyScalar(1);
                setTimeout(() => { this.player.ultimateActive = false; }, ult.duration * 1000);
                break;
            case 'blazer':
                setTimeout(() => { this.player.ultimateActive = false; }, ult.duration * 1000);
                break;
            case 'frost':
                if (this.ball.active) {
                    this.ball._frozenTimer = 3;
                    this.ball.velocity.multiplyScalar(0.01);
                }
                setTimeout(() => { this.player.ultimateActive = false; }, ult.duration * 1000);
                break;
            default:
                setTimeout(() => { this.player.ultimateActive = false; }, ult.duration * 1000);
        }
    }

    capsuleHitTest(ballPos, playerPos, playerHeight = 1.7, capsuleRadius = 0.4) {
        const px = playerPos.x, pz = playerPos.z;
        const py = Math.max(0, Math.min(playerHeight, ballPos.y));
        const dx = ballPos.x - px;
        const dz = ballPos.z - pz;
        const dy = ballPos.y - py;
        const distSq = dx * dx + dy * dy + dz * dz;
        const totalRadius = this.ball.radius + capsuleRadius;
        return distSq < totalRadius * totalRadius;
    }

    handleHit(hitTarget) {
        const isClient = this.network?.connected && !this.network?.isHost;
        const name = hitTarget === this.player ? this.playerName : hitTarget.name;
        const attacker = this.lastDeflector;
        const scorerName = resolveKillerName(
            attacker,
            this.player,
            this.playerName,
            this.ball.lastShotBy,
            name
        );
        const shot = this.ball.lastShot;

        // ponytail: host-side lethal hits get an 80ms grace window — late client
        // attacks (remoteAttack) cancel the hit. Non-lethal hits go through fast.
        if (!isClient && hitTarget.alive !== false) {
            // ponytail: pre-check lethality without mutating state. oneHitKill / instagib
            // is always lethal; otherwise conservative worst-case estimate.
            const conservativeHp = this._oneHitKill ? 0 : (hitTarget.hp <= BASE_HIT_DAMAGE ? hitTarget.hp - 1 : 0);
            if (this._oneHitKill || conservativeHp <= 0) {
                if (this._pendingLethalHit) clearTimeout(this._pendingLethalHit);
                this._pendingLethalVictim = hitTarget;
                this._pendingLethalHit = setTimeout(() => {
                    this._pendingLethalHit = null;
                    this._pendingLethalVictim = null;
                    this._ballTarget = null;
                    this._ballTargetTime = 0;
                    this._ballPredicting = false;
                    // Re-check: still alive? (client attack may have deflected)
                    if (hitTarget.alive !== false) {
                        this._doApplyHit(hitTarget, name, scorerName, attacker, shot);
                    }
                }, 80);
                return;
            }
        }

        this._doApplyHit(hitTarget, name, scorerName, attacker, shot);
    }

    _cancelPendingLethalHit(deflector) {
        if (!this._pendingLethalHit || this._pendingLethalVictim !== deflector) return false;
        clearTimeout(this._pendingLethalHit);
        this._pendingLethalHit = null;
        this._pendingLethalVictim = null;
        return true;
    }

    _doApplyHit(hitTarget, name, scorerName, attacker, shot) {
        if (hitTarget.alive === false) return;
        const isClient = this.network?.connected && !this.network?.isHost;
        // Hasar hesapla: miss ramp + karakter deflectPower + pasifler + combo bonusu
        const base = missRampDamage(BASE_HIT_DAMAGE, hitTarget.consecutiveMisses);
        const comboMul = this.juice.getComboMultiplier();
        let dmg = calcDamage(Math.round(base * comboMul), attacker, hitTarget, shot);
        const damageMultiplier = attacker?._powerUpDamageMul
            || (attacker === this.player ? this._damageMul : null);
        if (damageMultiplier) dmg = Math.round(dmg * damageMultiplier);
        // Body zone multiplier
        const hitZone = this.getBodyZone(this.ball.position, hitTarget.getPosition());
        dmg = Math.round(dmg * hitZone.multiplier);
        // Distance falloff: damage scales down based on thrower distance
        if (attacker) {
            const throwerPos = attacker.getPosition();
            const dist = throwerPos.distanceTo(hitTarget.getPosition());
            dmg = Math.round(dmg * this.getDamageFalloff(dist));
        }
        if (this._oneHitKill) dmg = hitTarget.maxHp;

        // Client-side prediction: apply state locally, server may correct later
        const lethal = hitTarget.takeDamage(dmg);
        const analyticsAttacker = {
            id: attacker?.playerId || attacker?.peerId || scorerName || 'unknown',
            name: scorerName || 'Unknown',
            team: attacker?.team
        };
        const analyticsVictim = {
            id: hitTarget.playerId || hitTarget.peerId || name,
            name,
            team: hitTarget.team
        };
        this.matchAnalytics.recordHit({
            attacker: analyticsAttacker,
            victim: analyticsVictim,
            damage: dmg
        });
        if (lethal) {
            this.matchAnalytics.recordKO({
                attacker: analyticsAttacker,
                victim: analyticsVictim
            });
        }
        if (isClient && lethal && hitTarget === this.player) this._predictedLocalDeath = true;
        if (lethal) this.killStreak++;
        // Ball affix on-hit effect (e.g. burn)
        if (this.ball?._affixOnHit) {
            this.ball._affixOnHit(hitTarget);
        }
        if (attacker) attacker.recordDamageDealt(dmg);
        // Ultimate charge: attacker gains from dealing, victim from taking
        if (attacker?.addUltimateCharge) attacker.addUltimateCharge(dmg * 0.3);
        if (hitTarget?.addUltimateCharge) hitTarget.addUltimateCharge(dmg * 0.5);
        hitTarget.onMissDeflect();
        // ponytail: thorns host-only — client's attacker is this.player, not remote wrapper.
        // Host applies thorns to remote wrapper (no visible effect). Client skipping prevents
        // self-damage since host never broadcasts attacker correction for thorns.
        if (!isClient && hitTarget.runeBonuses?.thorns && attacker && attacker !== hitTarget) {
            attacker.takeDamage(hitTarget.runeBonuses.thorns);
            if (attacker.drawHpBar) attacker.drawHpBar();
        }
        if (!isClient) {
            // Host: scoreboard tracking (authoritative)
            this.scoreboard.recordHit(name);
            if (scorerName) this.scoreboard.recordDamageDealt(scorerName, dmg);
            this.scoreboard.recordDamageTaken(name, dmg);
        }

        // P2P: host broadcasts authoritative hit to all clients
        if (this.network?.isHost) {
            const victimPeerId = hitTarget.peerId || (hitTarget === this.player ? this.network?.peer?.id : null);
            const victimPlayerId = hitTarget.playerId || (hitTarget === this.player ? this.network?.playerId : null);
            const hitPos = hitTarget.getPosition();
            const missTag = hitTarget.consecutiveMisses >= 3 ? ' 💢CRITICAL' : hitTarget.consecutiveMisses >= 1 ? ` (x${hitTarget.consecutiveMisses+1} miss)` : '';
            const perfectTag = this.ball.lastPerfectBy === attacker ? ' ✨PERFECT' : '';
            this.network.broadcast({
                type: 'playerHit', victimPlayerId, victimPeerId, victimName: name,
                hp: hitTarget.hp, alive: hitTarget.alive !== false,
                dmg, lethal: hitTarget.hp <= 0, attackerName: scorerName, victimTeam: hitTarget.team,
                hitX: hitPos.x, hitY: hitPos.y, hitZ: hitPos.z,
                missTag, perfectTag, combo: this.juice.combo,
                killStreak: this.killStreak, rallyCount: this.rallyCount,
                hitZone: hitZone.label, hitZoneId: hitZone.zone
            });
        }

        const hitPos = hitTarget.getPosition();
        const impactId = attacker === this.player
            ? window.__store?.get?.('equippedWearables')?.impact
            : attacker?.wearableLoadout?.impact;
        spawnImpactCosmetic(this.renderer.scene, impactId, hitPos);
        const isLethal = lethal || hitTarget.hp <= 0;
        if (attacker === this.player) {
            this.onReplayEvent?.({
                type: 'hit',
                data: { damage: dmg, eliminated: isLethal, victim: name, zone: hitZone.zone }
            });
        }

        // EFFECTS — play on BOTH host and client for immediate feedback
        // Floating damage number
        const scrPos = hitPos.clone().project(this.player.camera);
        const sx = (scrPos.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-scrPos.y * 0.5 + 0.5) * window.innerHeight;
        this.ui.spawnDamageNumber(sx, sy, dmg, isLethal, hitZone.label);

        // Hit marker — show when the local player lands a hit
        if (attacker === this.player) {
            this.ui.showHitMarker(hitZone.zone === 'head');
        }

        if (hitTarget === this.player) {
            // Directional damage indicator — calculate angle from attacker to player
            if (attacker) {
                const attackerPos = attacker.getPosition();
                const playerPos = hitTarget.getPosition();
                const dx = attackerPos.x - playerPos.x;
                const dz = attackerPos.z - playerPos.z;
                const damageAngle = Math.atan2(dx, dz) * (180 / Math.PI);
                // Convert to screen-space angle (0 = top, clockwise)
                const camYaw = this.player.camera?.rotation?.y || 0;
                const screenAngle = damageAngle - (camYaw * 180 / Math.PI);
                this.ui.showDamageDirection(screenAngle);
            }
            const df = document.getElementById('damage-flash');
            if (df) {
                df.classList.remove('fade');
                df.classList.add('active');
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    df.classList.remove('active');
                    df.classList.add('fade');
                }));
            }
        }

        // Kill feed
        const missTag = hitTarget.consecutiveMisses >= 3 ? ' 💢CRITICAL' : hitTarget.consecutiveMisses >= 1 ? ` (x${hitTarget.consecutiveMisses+1} miss)` : '';
        const perfectTag = this.ball.lastPerfectBy === attacker ? ' ✨PERFECT' : '';
        this.killFeed.unshift({ attacker: scorerName, victim: name, dmg, time: performance.now(), tag: missTag + perfectTag });
        if (this.killFeed.length > 5) this.killFeed.pop();
        this.ui.renderKillFeed?.(this.killFeed);

        // Juice effects — ponytail: enhanced impact feel
        if (isLethal) {
            this.juice.killBurst(hitPos);
            // ponytail: extra upward spark fountain for dramatic death
            this.juice.sparks(hitPos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffffff, 8);
        } else {
            this.juice.hitBurst(hitPos);
        }
        this.juice.shockwave(hitPos, isLethal ? 0xff3333 : 0xff8844);
        this.juice.hitStop(isLethal ? 120 : 50);
        this.juice.flash(isLethal ? 0.5 : 0.3);

        // Death explosion + audio
        this.spawnDeathExplosion(hitPos, hitTarget.team);
        this.audio.playSfx('tf2_explosion', 0.5);
        this.audio.playExplosion();
        if (hitTarget === this.player) {
            this.audio.playSfx('tf2_you_are_dead', 0.5);
            this.audio.playSfx('tf2_scout_scream', 0.45);
        }
        this.audio.playHit();

        // Client-side non-lethal hit message
        if (isClient && !isLethal) {
            this.ui.showMessage(`💥 ${name} -${dmg} HP${missTag}${perfectTag}`, 1500);
        }

        // Client-side lethal effects (predicted — host authority may override)
        if (isClient && isLethal) {
            if (hitTarget === this.player) {
                this.player.die();
                this.ui.flashHit();
                this._killcamDeathPos = this.player.getPosition();
                this._showKillcam(scorerName || (this.ball.lastShotBy || 'Unknown'));
                const aliveTargets = this._ffa
                    ? this.getAllTargets().filter(p => p !== this.player && p.alive)
                    : this.bots.filter(b => b.alive && b.team === this.player.team);
                if (aliveTargets.length > 0) this._spectateTarget = aliveTargets[0];
            }
        }

        // Host-only state continuation
        if (!isClient) {
            if (isLethal) {
                if (hitTarget !== this.player) this.audio.playSfx('tf2_notification', 0.4);
                if (hitTarget === this.player) {
                    this.player.die();
                    this.ui.flashHit();
                    if (attacker) {
                        const kp = attacker.getPosition();
                        this._killcamKillerPos = kp instanceof THREE.Vector3 ? kp.clone() : new THREE.Vector3(kp.x, kp.y, kp.z);
                    } else {
                        this._killcamKillerPos = this.ball.position.clone();
                    }
                    this._killcamDeathPos = this.player.getPosition();
                    this._showKillcam(scorerName || (this.ball.lastShotBy || 'Unknown'));
                    const aliveTargets = this._ffa
                        ? this.getAllTargets().filter(p => p !== this.player && p.alive)
                        : this.bots.filter(b => b.alive && b.team === this.player.team);
                    if (aliveTargets.length > 0) this._spectateTarget = aliveTargets[0];
                } else {
                    hitTarget.alive = false;
                    if (hitTarget.group) hitTarget.group.visible = false;
                }
                this.ball.deactivate();
                const comboNames = ['', 'FIRST BLOOD', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTA KILL', 'ACE'];
                const comboSounds = ['', 'music/1kill.sfx', 'music/2kill.sfx', 'music/3kill.sfx', 'music/4kill.sfx', 'music/4kill.sfx', 'music/ace.sfx'];
                const tf2ComboSounds = ['', 'tf2_domination', 'tf2_crit', 'tf2_victory', 'tf2_victory', 'tf2_victory', 'tf2_victory'];
                const idx = Math.min(this.killStreak, 6);
                const comboName = comboNames[idx] || '';
                if (comboName) {
                    this._playComboSound(comboSounds[idx]);
                    if (tf2ComboSounds[idx]) this.audio.playSfx(tf2ComboSounds[idx], 0.5);
                    this.ui.showCombo(idx, 8.0);
                    this.announce(`🔥 ${comboName}!`, tf2ComboSounds[idx] || null, 0.5, 2500);
                }
                const rallyMsg = this.rallyCount > 2 ? ` (${this.rallyCount} rally!)` : '';
                this.announce(`💥 ${name} KO'd!${rallyMsg}${missTag}${perfectTag}`, null, 0.4, 2000);
                if (scorerName) this.scoreboard.recordPoint(scorerName, 1);
                this.scoreboard.recordDeath(name);
                const assistCandidates = this._deflectHistory.filter(n => n !== scorerName);
                const seen = new Set();
                assistCandidates.forEach(a => { if (a && !seen.has(a)) { seen.add(a); this.scoreboard.recordAssist(a); } });
                this.juice.resetCombo();

                // Kill streak tracking (per-player)
                if (scorerName) {
                    const streak = (this._killStreaks.get(scorerName) || 0) + 1;
                    this._killStreaks.set(scorerName, streak);
                    this.announceStreak(streak, attacker);
                    // Reset streak timer (8s timeout)
                    if (this._killStreakTimers.has(scorerName)) clearTimeout(this._killStreakTimers.get(scorerName));
                    this._killStreakTimers.set(scorerName, setTimeout(() => {
                        this._killStreaks.delete(scorerName);
                        this._killStreakTimers.delete(scorerName);
                    }, 8000));
                }

                // Reset victim's streak
                const victimName = name;
                if (this._killStreaks.has(victimName)) {
                    this._killStreaks.delete(victimName);
                    if (this._killStreakTimers.has(victimName)) {
                        clearTimeout(this._killStreakTimers.get(victimName));
                        this._killStreakTimers.delete(victimName);
                    }
                }

                if (this._checkTeamElimination()) {
                    this.setState(STATES.ROUND_END);
                    this.roundRestartTimer = this.roundRestartDelay;
                } else {
                    this._respawnBall();
                }
            } else {
                this.ball.deactivate();
                if (hitTarget.drawHpBar) hitTarget.drawHpBar();
                this.ui.updateVitals?.(this.player.hp, this.player.maxHp, this.player.shield,
                    this.player.stamina, this.player.staminaMax, this.player.exhausted);
                this.ui.showMessage(`💥 ${name} -${dmg} HP${missTag}${perfectTag}`, 1500);
                if (scorerName) this.scoreboard.recordPoint(scorerName, 0.5);
                this._respawnBall();
            }
        }
    }

    // Son 2 deflector'ı hatırla (assist credit için)
    _pushDeflectHistory(name) {
        this._deflectHistory.push(name);
        if (this._deflectHistory.length > 3) this._deflectHistory.shift();
    }

    // ponytail: single-instance respawn timer — guards against overlapping calls
    _respawnBall() {
        if (this.state !== STATES.PLAYING) return;
        if (this._respawnTimer) { clearTimeout(this._respawnTimer); this._respawnTimer = null; }
        const countdown = (n) => {
            this.ui.showMessage(`🏐 Ball returns in ${n}...`, 1000);
            this._respawnTimer = setTimeout(() => {
                this._respawnTimer = null;
                if (this.state !== STATES.PLAYING) return;
                if (n <= 1) {
                    if (this.ball.active) return;
                    this.ball.spawn();
                    this._applyBallAffix();
                    this.lastDeflector = null;
                    this.lastDeflectorTeam = null;
                    const targets = this.getAllTargets().filter(p => p.alive);
                    if (targets.length) {
                        const next = targets[Math.floor(Math.random() * targets.length)];
                        this.ball.setTarget(next);
                        this.ball.state = 'homing';
                    }
                } else {
                    countdown(n - 1);
                }
            }, 1000);
        };
        countdown(3);
    }

    // --- DEATH EXPLOSION ---

    spawnDeathExplosion(pos, team) {
        const color = team === 'red' ? 0xff4444 : 0x4488ff;
        for (let i = 0; i < 20; i++) {
            const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
            const mat = new THREE.MeshBasicMaterial({
                color: i % 3 === 0 ? color : 0xffcc44,
                transparent: true, opacity: 1
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(pos);
            const vel = new THREE.Vector3(
                (Math.random() - 0.5) * 12,
                Math.random() * 10 + 3,
                (Math.random() - 0.5) * 12
            );
            this.renderer.scene.add(p);
            this.deathParticles.push({ mesh: p, vel, life: 1.5, gravity: -15 });
        }

        // Star burst
        for (let i = 0; i < 8; i++) {
            const geo = new THREE.CircleGeometry(0.3, 5);
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffee44, transparent: true, opacity: 0.8, side: THREE.DoubleSide
            });
            const s = new THREE.Mesh(geo, mat);
            s.position.copy(pos);
            const vel = new THREE.Vector3(
                (Math.random() - 0.5) * 8,
                Math.random() * 6 + 2,
                (Math.random() - 0.5) * 8
            );
            this.renderer.scene.add(s);
            this.deathParticles.push({ mesh: s, vel, life: 1.0, gravity: -8, spin: true });
        }
    }

    updateDeathParticles(dt) {
        for (let i = this.deathParticles.length - 1; i >= 0; i--) {
            const p = this.deathParticles[i];
            p.life -= dt;
            p.vel.y += (p.gravity || -15) * dt;
            p.mesh.position.add(p.vel.clone().multiplyScalar(dt));
            p.mesh.material.opacity = Math.max(0, p.life);
            if (p.scaleRate) {
                p.mesh.scale.addScalar(p.scaleRate * dt);
            } else {
                p.mesh.scale.setScalar(Math.max(0.1, p.life));
            }
            if (p.spin) p.mesh.rotation.z += dt * 5;
            if (p.mesh.position.y < 0) { p.vel.y *= -0.3; p.mesh.position.y = 0; }
            if (p.life <= 0) {
                this.renderer.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.deathParticles.splice(i, 1);
            }
        }
    }

    // --- CHAT ---

    addChatMessage(name, text) {
        // ponytail: strip HTML at input boundary, not just at render
        const safe = text.replace(/<[^>]*>/g, '');
        if (window.__store?.get?.('mutedPlayers')?.includes(name)) return;
        this.chatMessages.push({ name, text: safe, time: Date.now() });
        if (this.chatMessages.length > 50) this.chatMessages.shift();
        this.ui.addChatMessage(name, safe);
        this.audio.playChat();

        // Speech bubble above bot/player
        const bot = this.bots.find(b => b.name === name);
        const entity = bot || (name === this.playerName ? this.player : null);
        if (entity) this.showSpeechBubble(entity, text);

        // Chat emoji detection — show emote above character
        const emojiMap = {
            ':D': 'laugh', ':d': 'laugh', 'XD': 'laugh', 'xd': 'laugh',
            ':)': 'nice', ':(': 'cry', ';(': 'cry',
            ';)': 'wow', ':O': 'wow', ':o': 'wow',
            '<3': 'heart', ':P': 'flex', ':p': 'flex',
            'RIP': 'skull', 'rip': 'skull',
        };
        for (const [pattern, emoteId] of Object.entries(emojiMap)) {
            if (text.includes(pattern) && entity) {
                this.emotes.show(entity, emoteId);
                break; // one emote per message
            }
        }
    }

    _broadcastTaunt(tauntId) {
        // ponytail: whitelist taunt ids to reject rogue/malformed taunts
        const ALLOWED = ['loop', 'daymissin'];
        if (!ALLOWED.includes(tauntId)) return;
        if (this.network?.connected && this.network?.isHost) {
            this.network.broadcast({ type: 'taunt', tauntId, playerId: this.network.playerId, peerId: this.network.peer?.id });
        } else if (this.network?.connected) {
            this.network.send({ type: 'taunt', tauntId, playerId: this.network.playerId, peerId: this.network.peer?.id });
        }
    }

    handleRemoteTaunt(data) {
        if (!data?.tauntId) return;
        const ALLOWED = ['loop', 'daymissin'];
        if (!ALLOWED.includes(data.tauntId)) return;
        const playerId = data.playerId || data.peerId;
        const isLocal = data.playerId ? data.playerId === this.network?.playerId : data.peerId === this.network?.peer?.id;
        if (isLocal) return;
        const p = this.remotePlayers.get(playerId);
        if (!p) return; // ponytail: ignore taunts from unknown/spoofed peers
        const entity = p;
        if (data.tauntId === 'loop') {
            this.ui.showMessage?.('🔄 LOOP!', 1000);
            let count = 0;
            const taunts = ['flex', 'laugh', 'nice', 'heart'];
            const loop = () => {
                if (count >= 4 || !this.remotePlayers.has(playerId)) return;
                this.showEmote(entity, taunts[count % taunts.length]);
                count++;
                setTimeout(loop, 500);
            };
            loop();
        } else if (data.tauntId === 'daymissin') {
            this.ui.showMessage?.('💪 Dayı mısın?!', 2000);
            this.showEmote(entity, 'flex');
            this.audio?.playSfx?.('tf2_domination', 0.35);
        }
    }

    executeChatCommand(text) {
        const args = text.slice(1).trim().split(/\s+/);
        const cmd = args[0].toLowerCase();
        if (cmd === 'loop') {
            const sub = args.slice(1).join(' ');
            if (sub === 'daymissin' || sub === 'dayı mısın') {
                this.ui.showMessage?.('💪 Dayı mısın?!', 2000);
                this.showEmote(this.player, 'flex');
                this.audio?.playSfx?.('tf2_domination', 0.45);
                this._broadcastTaunt('daymissin');
            } else {
                let count = 0;
                const taunts = ['flex', 'laugh', 'nice', 'heart'];
                const loop = () => {
                    if (count >= 4) return;
                    this.showEmote(this.player, taunts[count % taunts.length]);
                    this.audio?.playSfx?.('tf2_notification', 0.25);
                    count++;
                    setTimeout(loop, 500);
                };
                loop();
                this.ui.showMessage?.('🔄 LOOP!', 1000);
                this._broadcastTaunt('loop');
            }
            return true;
        }
        return false;
    }

    sendChat(text) {
        if (!text.trim()) return;
        if (text.startsWith('/')) {
            if (this.executeChatCommand(text)) return;
        }
        this.addChatMessage(this.playerName, text);
        this.showSpeechBubble(this.player, text);
        if (this.network && this.network.connected) {
            this.network.send({ type: 'chat', name: this.playerName, text });
        }
    }

    showSpeechBubble(entity, text) {
        const key = entity.name || '__player__';
        // Remove old bubble
        const old = this.chatBubbles.get(key);
        if (old) { this.renderer.scene.remove(old.sprite); }

        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Bubble bg
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.roundRect(10, 10, 492, 90, 20);
        ctx.fill();

        // Text
        ctx.fillStyle = '#333';
        ctx.font = '22px Outfit, Arial';
        ctx.textAlign = 'center';
        const shortText = text.length > 30 ? text.slice(0, 30) + '...' : text;
        ctx.fillText(shortText, 256, 60);

        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(3, 0.75, 1);

        this.renderer.scene.add(sprite);
        this.chatBubbles.set(key, { sprite, timer: 4, entity });
    }

    updateChatBubbles(dt) {
        this.chatBubbles.forEach((data, name) => {
            data.timer -= dt;
            const pos = data.entity.getPosition ? data.entity.getPosition() : data.entity.position;
            data.sprite.position.set(pos.x, pos.y + 2.5, pos.z);
            data.sprite.material.opacity = Math.min(1, data.timer);
            if (data.timer <= 0) {
                this.renderer.scene.remove(data.sprite);
                this.chatBubbles.delete(name);
            }
        });
    }

    // --- TEAM SWITCH ---

    switchTeam(forcedTeam) {
        const newTeam = forcedTeam || (this.player.team === 'red' ? 'blue' : 'red');
        if (this.player.queuedForNextRound) {
            this.selectQueuedLocalTeam(newTeam);
            this.ui?._renderTeamLists?.(this);
            return;
        }
        const prevTeam = this.player.team;
        if (prevTeam === newTeam) return;
        this.player.setTeam(newTeam);
        this.scoreboard.removePlayer(this.playerName);
        this.scoreboard.addPlayer(this.playerName, newTeam, { isYou: true });
        this.ui.showMessage(`Switched to ${newTeam.toUpperCase()} team`, 1500);
        if (this.state === STATES.LOBBY) this.updateLobbyUI();
        // Takım menüsü (M overlay) açıksa yeniden render et ki kullanıcı kendi hareketini görsün.
        if (typeof this.ui?._renderTeamLists === 'function') {
            try { this.ui._renderTeamLists(this); } catch (_) {}
        }
        // P2P: bağlıysak → host'a teamChange bildir; host ise yeni liste yayınla.
        if (this.network?.connected && !this.network.isHost) {
            this.network.send({ type: 'teamChange', name: this.playerName, team: newTeam });
        } else if (this.network?.isHost) {
            // Host kendi değişimini broadcasting lobbyState ile halleder, böylece herkes görür.
            this.network.broadcast({ type: 'lobbyState', players: this.getPlayerList() });
        }
    }

    // --- POWER-UPS ---

updatePowerUps(dt) {
    if (this._powerUpsDisabled) return;
        const authoritative = !this.network?.connected || this.network.isHost;
        // Decrement buff timers
        for (const k of ['speed', 'damage', 'rapid', 'size']) {
            if (this._playerBuffs[k] > 0) {
                this._playerBuffs[k] -= dt;
                if (this._playerBuffs[k] <= 0) this._clearBuff(k);
            }
        }

        // Power-up floating animation + expiration
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const pu = this.powerUps[i];
            pu.mesh.rotation.y += dt * 2;
            pu.mesh.position.y = pu.pos.y + Math.sin(performance.now() / 500) * 0.3;
            if (authoritative) pu.timer -= dt;
            if (authoritative && pu.timer <= 0) {
                this.renderer.scene.remove(pu.mesh);
                pu.mesh.geometry?.dispose();
                pu.mesh.material?.dispose();
                this.powerUps.splice(i, 1);
            }
        }

        // Rare map interaction: one contested core at a time, never a pickup flood.
        if (authoritative) this._powerUpTimer -= dt;
        if (authoritative && this._powerUpTimer <= 0 && this.powerUps.length < this._maxPowerUps) {
            this.spawnPowerUp();
            this._powerUpTimer = POWERUP_RESPAWN + Math.random() * POWERUP_RESPAWN_VARIANCE;
        }

        // Pickup check
        const pp = this.player.getPosition();
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const pu = this.powerUps[i];
            const dx = pp.x - pu.pos.x, dz = pp.z - pu.pos.z;
            if (Math.sqrt(dx * dx + dz * dz) < 2.0) {
                if (authoritative) {
                    this.pickupPowerUp(this.player, pu);
                    this.powerUps.splice(i, 1);
                } else if (!pu._pickupRequested) {
                    pu._pickupRequested = true;
                    this.network.send({
                        type: 'powerUpPickup',
                        powerUpType: pu.type.id,
                        x: pu.pos.x,
                        z: pu.pos.z
                    });
                }
            }
        }
    }

    pickupPowerUp(player, powerUp) {
        const type = powerUp.type;
        this.renderer.scene.remove(powerUp.mesh);
        powerUp.mesh.geometry.dispose();
        powerUp.mesh.material.dispose();
        this.applyPowerUpEffect(player, type);
    }

    applyPowerUpEffect(player, type) {
        this.ui.showMessage?.(type.label, 1500);
        switch (type.id) {
            case 'shield':
                player.shield += 50;
                break;
            case 'recovery':
                player.hp = Math.min(player.maxHp, player.hp + 35);
                player.stamina = player.staminaMax;
                player.drawHpBar?.();
                break;
            case 'speed':
                if (!player._baseSpeed) player._baseSpeed = player.speed;
                player.speed = player._baseSpeed * 1.3;
                this._playerBuffs.speed = type.duration;
                break;
            case 'damage':
                this._damageMul = 1.5;
                player._powerUpDamageMul = 1.5;
                this._playerBuffs.damage = type.duration;
                break;
        case 'megaball':
            if (!this._megaballActive) {
                this.ball.mesh.scale.setScalar(2);
                this.ball.radius *= 2;
                this._megaballActive = true;
            }
            this._megaballToken = (this._megaballToken || 0) + 1;
            {
                const token = this._megaballToken;
            setTimeout(() => {
                    if (this._megaballToken !== token || !this._megaballActive) return;
                this.ball.mesh.scale.setScalar(1);
                    this.ball.radius = this.ball._baseRadius;
                    this._megaballActive = false;
            }, 5000);
            }
            break;
            case 'rapid':
                player._rapidDeflect = true;
                this._playerBuffs.rapid = type.duration;
                break;
            case 'giant':
            case 'tiny': {
                const scale = type.id === 'giant' ? 1.45 : 0.68;
                player._sizeScale = scale;
                player.armGroup?.scale.setScalar(scale);
                this._playerBuffs.size = type.duration;
                break;
            }
        }
    }

handlePowerUpPickup(data, peerId) {
    if (!this.network?.isHost) return false;
    if (this._powerUpsDisabled) return false;
        const playerId = this.network.peerToPlayerId?.get(peerId) || peerId;
        const player = this.remotePlayers.get(playerId);
        if (!player?.alive) return false;
        const index = this.powerUps.findIndex(powerUp =>
            powerUp.type.id === data.powerUpType
            && Math.hypot(powerUp.pos.x - data.x, powerUp.pos.z - data.z) < 0.25
            && Math.hypot(player.position.x - powerUp.pos.x, player.position.z - powerUp.pos.z) < 2.4
        );
        if (index < 0) return false;
        const powerUp = this.powerUps[index];
        this.renderer.scene.remove(powerUp.mesh);
        powerUp.mesh.geometry?.dispose();
        powerUp.mesh.material?.dispose();
        this.powerUps.splice(index, 1);
        this._applyAuthoritativeRemotePowerUp(player, powerUp.type);
        this.network.broadcast({
            type: 'powerUpGranted',
            playerId,
            powerUpType: powerUp.type.id
        });
        return true;
    }

    _applyAuthoritativeRemotePowerUp(player, type) {
        if (type.id === 'shield') player.shield = (player.shield || 0) + 50;
        if (type.id === 'recovery') {
            player.hp = Math.min(player.maxHp, player.hp + 35);
            player.stamina = player.staminaMax;
            player.drawHpBar?.();
        }
        if (type.id === 'damage') player._powerUpDamageMul = 1.5;
        if (type.id === 'speed') player._powerUpSpeedMultiplier = 1.3;
        if (type.id === 'rapid') player._rapidDeflect = true;
        if (type.id === 'giant' || type.id === 'tiny') {
            const scale = type.id === 'giant' ? 1.45 : 0.68;
            player._sizeScale = scale;
            player.group?.scale.setScalar(scale);
        }
        player._powerUpTokens ||= {};
        const token = (player._powerUpTokens[type.id] || 0) + 1;
        player._powerUpTokens[type.id] = token;
        if (!type.duration) return;
        setTimeout(() => {
            if (player._powerUpTokens?.[type.id] !== token) return;
            if (type.id === 'damage') player._powerUpDamageMul = null;
            if (type.id === 'speed') player._powerUpSpeedMultiplier = 1;
            if (type.id === 'rapid') player._rapidDeflect = false;
            if (type.id === 'giant' || type.id === 'tiny') {
                player._sizeScale = 1;
                player.group?.scale.setScalar(1);
            }
        }, type.duration * 1000);
    }

applyPowerUpGrant(data) {
    if (this._powerUpsDisabled) return false;
        if (data?.playerId !== this.network?.playerId) return false;
        const type = POWERUP_TYPES.find(candidate => candidate.id === data.powerUpType);
        if (!type) return false;
        this.applyPowerUpEffect(this.player, type);
        return true;
    }

spawnPowerUp() {
    if (this._powerUpsDisabled) return;
        if (this.powerUps.length >= this._maxPowerUps) return;
        const roll = Math.random() * POWERUP_TYPES.reduce((sum, candidate) => sum + candidate.weight, 0);
        let cursor = 0;
        const type = POWERUP_TYPES.find(candidate => (cursor += candidate.weight) >= roll) || POWERUP_TYPES[0];
        const pos = this.arena.getSpawnPoint();
        pos.y = 1.5;
        const geo = new THREE.OctahedronGeometry(0.5);
        const mat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.8 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        this.renderer.scene.add(mesh);
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.72, 0.045, 6, 18),
            new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.72 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = -1.25;
        mesh.add(ring);
        this.powerUps.push({ mesh, type, pos: pos.clone(), timer: POWERUP_LIFETIME });
    }

    _applyBuff(type) {
        // Legacy compat — new typed power-ups use pickupPowerUp directly
        this._playerBuffs[type] = 6;
        if (type === 'speed') this.player.speed = this.player._baseSpeed * 1.4;
        if (type === 'shield') this.player.shield += 30;
        if (type === 'damage') this._damageMul = 1.5;
    }

    _clearBuff(type) {
        if (type === 'speed') this.player.speed = this.player._baseSpeed;
        if (type === 'damage') this._damageMul = null;
        if (type === 'damage') this.player._powerUpDamageMul = null;
        if (type === 'rapid') this.player._rapidDeflect = false;
        if (type === 'size') {
            this.player._sizeScale = 1;
            this.player.armGroup?.scale.setScalar(1);
        }
    }

    _clearAllPowerUps() {
        for (const pu of this.powerUps) {
            this.renderer.scene.remove(pu.mesh);
            pu.mesh.traverse?.(part => {
                part.geometry?.dispose();
                if (Array.isArray(part.material)) {
                    part.material.forEach(material => material?.dispose());
                } else {
                    part.material?.dispose();
                }
            });
        }
        this.powerUps = [];
        this._playerBuffs = {};
        this._damageMul = null;
        this.player._powerUpDamageMul = null;
        if (Number.isFinite(this.player._baseSpeed)) this.player.speed = this.player._baseSpeed;
        this.player._rapidDeflect = false;
        this.player._sizeScale = 1;
        this.player.armGroup?.scale.setScalar(1);
        this._megaballToken = (this._megaballToken || 0) + 1;
        if (this.ball) {
            this._megaballActive = false;
            this.ball.mesh.scale.setScalar(1);
            this.ball.radius = this.ball._baseRadius;
        }
    }

    // --- MINIMAP ---

    initMinimap() {
        this.minimapCanvas = document.getElementById('minimap-canvas');
        if (this.minimapCanvas) {
            this.minimapCtx = this.minimapCanvas.getContext('2d');
        }
    }

    updateMinimap() {
        if (!this.minimapCtx) return;
        const ctx = this.minimapCtx;
        const w = 160, h = 120;
        const scaleX = w / this.arena.courtWidth;
        const scaleZ = h / this.arena.courtLength;

        ctx.clearRect(0, 0, w, h);

        // Court
        ctx.fillStyle = 'rgba(180,60,60,0.4)';
        ctx.fillRect(0, 0, w, h / 2);
        ctx.fillStyle = 'rgba(60,80,180,0.4)';
        ctx.fillRect(0, h / 2, w, h / 2);

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Player
        const px = (this.player.position.x + this.arena.courtWidth / 2) * scaleX;
        const pz = (this.player.position.z + this.arena.courtLength / 2) * scaleZ;
        ctx.fillStyle = this.player.team === 'red' ? '#ff4444' : '#4488ff';
        ctx.beginPath();
        ctx.arc(px, pz, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Bots
        this.bots.forEach(bot => {
            const bx = (bot.position.x + this.arena.courtWidth / 2) * scaleX;
            const bz = (bot.position.z + this.arena.courtLength / 2) * scaleZ;
            ctx.fillStyle = bot.team === 'red' ? '#ff6666' : '#6699ff';
            ctx.beginPath();
            ctx.arc(bx, bz, 3, 0, Math.PI * 2);
            ctx.fill();
        });

        // Ball
        if (this.ball.active) {
            const ballX = (this.ball.position.x + this.arena.courtWidth / 2) * scaleX;
            const ballZ = (this.ball.position.z + this.arena.courtLength / 2) * scaleZ;
            ctx.fillStyle = '#ffaa33';
            ctx.beginPath();
            ctx.arc(ballX, ballZ, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    endGame() {
        const stats = this.scoreboard.getPlayerStats();
        const rankedFfa = [...stats].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        const winner = this._ffa && rankedFfa[0] && rankedFfa[0].score !== rankedFfa[1]?.score
            ? rankedFfa[0].name
            : this.scoreboard.getWinner();
        this.clearBlackHoles();
        this.clearSplitBalls();
        this._clearRockets();
        if (this.affixes) this.affixes.clearRound();
        this.chaosManager?.clear();
        this.currentBallAffix = null;
        this.audio.playSfx('tf2_domination', 0.55);
        this.audio.playScore();

        // 30 second celebration — winners punch losers, no menu
        this.setState(STATES.CELEBRATION);
        this._celebrationTimer = 30;
        this._winningTeam = winner === 'RED' ? 'red' : winner === 'BLUE' ? 'blue' : null;
        this._won = this._ffa ? winner === this.playerName : this._winningTeam !== null && this.player.team === this._winningTeam;

        // Winner/loser TF2 anouncer
        if (this._won) {
            this.audio.playSfx('tf2_victory', 0.55);
        } else {
            this.audio.playSfx('tf2_you_failed', 0.5);
        }
        this._finalStats = stats;
        this._finalWinner = winner;
        this._showCelebrationBanner(this._winningTeam);

        // ponytail: let everyone move/look, only winners shoot
        this.ball.deactivate();
        // Kaybedenler vuramaz
        this.player._celebNoAttack = this._ffa ? !this._won : this.player.team !== this._winningTeam;
        this.player.respawn();
        this.bots.forEach(bot => { if (!bot.alive) bot.respawn(); });
        this.ui.setPlayerTarget(false);
        this.bots.forEach(bot => bot.setTargetOutline(false));
        this.remotePlayers.forEach(p => p.setTargetOutline?.(false));

        // Show the winner's rocket launcher viewmodel.
        this._celebWeapon = 'rocket';
        this._prevHandVisible = this.player.armGroup?.visible ?? false;
        const wh = document.getElementById('celeb-weapon-hud');
        if (this._won) {
            this.player.setHandVisible?.(true);
            this._setCelebrationGloveColor(0xff8800);
            this._buildCelebWeapons();
            this._showCelebWeapon('rocket');
        } else {
            this.player.setHandVisible?.(false);
        }
        if (wh && this._won) {
            wh.classList.remove('hidden');
            wh.style.display = 'flex';
        } else if (wh) {
            wh.classList.add('hidden');
            wh.style.display = 'none';
        }
        if (this._won) this.ui.showMessage?.('WINNER LOADOUT: ROCKET', 4000);

        // P2P: celebration state'ini client'lara yayınla
        if (this.network?.isHost) {
            this.network.broadcast({
                type: 'celebrationStart',
                winner: this._winningTeam,
                duration: 30,
                message: `${winner} TEAM WINS!`
            });
        }
    }

    _setCelebrationGloveColor(hex) {
        const material = this.player.gloveMat;
        if (material?.uniforms?.uColor?.value) material.uniforms.uColor.value.setHex(hex);
        else material?.color?.setHex?.(hex);
    }

    selectCelebrationWeapon(weaponId) {
        if (this.state !== STATES.CELEBRATION || !this._won || weaponId !== 'rocket') return;
        this._celebWeapon = 'rocket';
        this._setCelebrationGloveColor(0xff8800);
        this._showCelebWeapon('rocket');
    }

    _buildCelebWeapons() {
        const cam = this.player.camera;
        if (!cam) return;
        // Remove old weapon meshes
        if (this._celebWpnMeshes) {
            Object.values(this._celebWpnMeshes).forEach(m => {
                m.traverse(child => {
                    child.geometry?.dispose?.();
                    if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose?.());
                    else child.material?.dispose?.();
                });
                cam.remove(m);
            });
        }
        this._celebWpnMeshes = {};

        const launcher = createRocketLauncherModel(this.player.team);
        launcher.position.set(0.3, -0.24, -0.58);
        launcher.rotation.set(-0.08, 0.04, 0);
        launcher.scale.setScalar(0.74);
        launcher.visible = false;
        cam.add(launcher);
        this._celebWpnMeshes.rocket = launcher;
    }

    _showCelebWeapon(weaponId) {
        if (!this._celebWpnMeshes) return;
        Object.keys(this._celebWpnMeshes).forEach(k => {
            this._celebWpnMeshes[k].visible = (k === weaponId);
        });
        // Silah seçilince el/diveni gizle (Half-Life tarzı)
        if (this.player.handMesh) this.player.handMesh.visible = false;
        if (this.player.gloveMesh) this.player.gloveMesh.visible = false;
        if (this.player.knifeGroup) this.player.knifeGroup.visible = false;
        this._showCelebWeaponHUD(weaponId);
    }

    _showCelebWeaponHUD(weaponId) {
        const el = document.getElementById('celeb-weapon-hud');
        if (!el) return;
        const weapons = [['rocket', '2', 'ROCKET']];
        el.replaceChildren(...weapons.map(([id, slot, name]) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `celeb-weapon-slot${id === weaponId ? ' active' : ''}`;
            item.dataset.weapon = id;
            item.innerHTML = `<span>${slot}</span><b>${name}</b>`;
            item.addEventListener('click', () => this.selectCelebrationWeapon(id));
            return item;
        }));
        el.classList.remove('hidden');
        el.style.display = 'flex';
    }

    _playWeaponSound(type) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.06;
            if (type === 'rocket') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(250, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.35);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            }
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
        } catch (_) {}
    }

    _onCelebrationEnd() {
        this.setState(STATES.GAME_OVER);
        this.player.unlock(); // free mouse for XP screen buttons
        this.player._celebNoAttack = false; // attack restriction cleared
        const gm = document.getElementById('game-message');
        if (gm) gm.classList.add('hidden');
        const wh = document.getElementById('celeb-weapon-hud');
        if (wh) {
            wh.classList.add('hidden');
            wh.style.display = 'none';
        }
        this._hideCelebrationBanner();
        // Restore viewmodel to its pre-celebration state
        this.player.setHandVisible?.(this._prevHandVisible);
        if (this.player.handMesh) this.player.handMesh.visible = true;
        if (this.player.gloveMesh) this.player.gloveMesh.visible = true;
        // Clean up weapon meshes
        if (this._celebWpnMeshes && this.player.camera) {
            Object.values(this._celebWpnMeshes).forEach(m => {
                m.traverse(child => {
                    child.geometry?.dispose?.();
                    if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose?.());
                    else child.material?.dispose?.();
                });
                this.player.camera.remove(m);
            });
        }
        this._celebWpnMeshes = {};
        const kills = this.player.totalDamageDealt > 0 ? Math.floor(this.player.totalDamageDealt / 25) : 0;
        // Win pays ~5x a loss; losers still earn a small consolation.
        const xp = this._won ? 400 + kills * 30 : 80 + kills * 8;
        const winnerText = this._finalWinner === 'DRAW'
            ? this._ffa ? 'DRAW: FFA tie' : `DRAW: Red ${this.scoreboard.redScore} - ${this.scoreboard.blueScore} Blue`
            : this._ffa ? `${this._finalWinner} WINS FFA` : `${this._finalWinner} TEAM WINS: Red ${this.scoreboard.redScore} - ${this.scoreboard.blueScore} Blue`;
        const playerStats = this.scoreboard.getPlayerStats();
        this.onMatchComplete?.();
        const analytics = this.matchAnalytics.getReport({
            heatmap: {
                columns: 12,
                rows: 8,
                bounds: { minX: -24, maxX: 24, minZ: -18, maxZ: 18 }
            }
        });
        this.ui.showPostGame(this._won, xp, 1, kills, this.rallyCount, this.audio, {
            winnerText,
            playerStats,
            analytics
        });
        // P2P: gameOver state'ini client'lara yayınla
        if (this.network?.isHost) {
            this.network.broadcast({
                type: 'gameOver',
                winner: this._finalWinner,
                redScore: this.scoreboard.redScore,
                blueScore: this.scoreboard.blueScore,
                xp, kills, rally: this.rallyCount,
                playerStats
            });
        }
        // Start map voting after a brief delay (post-game screen must render first)
        setTimeout(() => this._startMapVoting(), 500);
    }

    // --- Map Voting ---
    _startMapVoting() {
        if (this._mapVoteActive) return;
        const allMaps = Object.keys(Arena.MAPS || {});
        if (allMaps.length < 2) return;
        const current = this.arena?.mapId;
        const pool = allMaps.filter(m => m !== current);
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const options = shuffled.slice(0, Math.min(3, shuffled.length));
        if (options.length < 2) return;
        this._mapVoteActive = true;
        this._mapVoteOptions = options;
        this._mapVotes.clear();
        this._mapVoteElapsed = 0;

        const isMultiplayer = !!this.network?.connected;

        if (isMultiplayer) {
            if (this.network.isHost) {
                this._mapVotes.set('host', null);
                this.network.broadcast({ type: 'mapVoteOptions', options });
            }
        }

        if (isMultiplayer) {
            this.ui.showMapVoting?.(options, this.network?.isHost || false, (mapId) => {
                this._castMapVote(mapId);
            });
        } else {
            // Solo: just apply a random map directly
            this._mapVoteActive = false;
            const picked = options[Math.floor(Math.random() * options.length)];
            if (this.arena?.mapId !== picked) {
                this.arena.rebuild(picked);
                this.player.respawn();
                this.bots.forEach(b => b.respawn());
                this.ui.showMessage(`🗺️ Next map: ${Arena.MAPS[picked]?.name || picked}`, 2000);
            }
        }
    }

    _castMapVote(mapId) {
        if (!this._mapVoteActive) return;
        const id = this.network?.isHost ? 'host' : (this.network?.peerId || 'local');
        this._mapVotes.set(id, mapId);
        // If host, broadcast vote to others (for transparency)
        if (this.network?.isHost) {
            this.network.broadcast({ type: 'mapVote', mapId, from: id });
        } else if (this.network?.connected) {
            this.network.send({ type: 'mapVote', mapId });
        }
        // Visual feedback: disable selected card
        this.ui.highlightMapVote?.(mapId);
    }

    handleMapVote(data, peerId) {
        if (!this._mapVoteActive || !this.network?.isHost) return;
        const voter = data.from || peerId;
        if (this._mapVotes.has(voter)) return; // already voted
        this._mapVotes.set(voter, data.mapId);
        // Check if all voted
        this._checkMapVoteComplete();
    }

    applyMapVoteOptions(data) {
        if (this.network?.isHost) return;
        this._mapVoteActive = true;
        this._mapVoteOptions = data.options || [];
        this._mapVotes.clear();
        this._mapVoteElapsed = 0;
        this.ui.showMapVoting?.(this._mapVoteOptions, false, (mapId) => {
            this._castMapVote(mapId);
        });
    }

    applyMapVoteResult(data) {
        if (this.network?.isHost) return;
        this._mapVoteActive = false;
        if (this._mapVoteTimer) clearTimeout(this._mapVoteTimer);
        this._mapVoteTimer = null;
        const winner = data?.winner;
        if (winner && this.arena?.mapId !== winner) {
            this.arena.rebuild(winner);
            this.player.respawn();
            this.bots.forEach(b => b.respawn());
            this.ui.showMessage(`🗺️ Next map: ${Arena.MAPS[winner]?.name || winner}`, 2000);
        }
        // Re-enable play again button if it was disabled
        const playBtn = document.getElementById('pg-play-again');
        if (playBtn) playBtn.disabled = false;
    }

    _checkMapVoteComplete() {
        if (!this.network?.isHost) return;
        // Count connected peers + host
        const totalVoters = this.network.connections.size + 1; // +1 for host
        const votedCount = this._mapVotes.size;
        if (votedCount >= totalVoters) {
            this._finalizeMapVote();
        }
    }

    _finalizeMapVote() {
        this._mapVoteActive = false;
        if (this._mapVoteTimer) clearTimeout(this._mapVoteTimer);
        this._mapVoteTimer = null;
        // Tally votes
        const tally = {};
        this._mapVoteOptions.forEach(m => tally[m] = 0);
        this._mapVotes.forEach((vote) => {
            if (vote && tally[vote] !== undefined) tally[vote]++;
        });
        // Find winner(s)
        let maxVotes = 0;
        let winners = [];
        for (const [mapId, count] of Object.entries(tally)) {
            if (count > maxVotes) { maxVotes = count; winners = [mapId]; }
            else if (count === maxVotes && count > 0) winners.push(mapId);
        }
        const winningMap = winners.length > 0 ? winners[Math.floor(Math.random() * winners.length)] : this._mapVoteOptions[0];
        // Apply
        if (this.arena?.mapId !== winningMap) {
            this.arena.rebuild(winningMap);
            this.player.respawn();
            this.bots.forEach(b => b.respawn());
            this.ui.showMessage(`🗺️ Next map: ${Arena.MAPS[winningMap]?.name || winningMap}`, 2000);
        }
        this.network.broadcast({ type: 'mapVoteResult', winner: winningMap });
        // Re-enable play again
        const playBtn = document.getElementById('pg-play-again');
        if (playBtn) playBtn.disabled = false;
    }

    _playBoo() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 150 + Math.random() * 50;
            const g = ctx.createGain(); g.gain.value = 0.04;
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.2);
        } catch (_) {}
    }

    // Silah ateşlenince namlu parlaması
    _spawnMuzzleFlash(weaponId) {
        const mesh = this._celebWpnMeshes?.[weaponId];
        if (!mesh) return;
        const flash = new THREE.Mesh(
            new THREE.SphereGeometry(weaponId === 'rocket' ? 0.2 : 0.08, 6, 6),
            new THREE.MeshBasicMaterial({ color: weaponId === 'rocket' ? 0xff6600 : 0xffee44, transparent: true, opacity: 0.9 })
        );
        flash.position.set(0, 0, -0.35);
        mesh.add(flash);
        setTimeout(() => { mesh.remove(flash); flash.geometry.dispose(); flash.material.dispose(); }, 80);
    }

    // Roket patlaması — geniş yarıçaplı partikül patlaması
    _spawnExplosion(pos, color, count = 30) {
        for (let i = 0; i < count; i++) {
            const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
            const mat = new THREE.MeshBasicMaterial({
                color: i % 3 === 0 ? 0xffcc00 : i % 3 === 1 ? color : 0xff4400,
                transparent: true, opacity: 1
            });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(pos);
            const vel = new THREE.Vector3(
                (Math.random() - 0.5) * 18,
                Math.random() * 14 + 2,
                (Math.random() - 0.5) * 18
            );
            this.renderer.scene.add(p);
            this.deathParticles.push({ mesh: p, vel, life: 1.2, gravity: -12 });
        }
        // Ateş topu
        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(2, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.7 })
        );
        ball.position.copy(pos);
        this.renderer.scene.add(ball);
        this.deathParticles.push({ mesh: ball, vel: new THREE.Vector3(), life: 0.4, gravity: 0, scaleRate: 8 });
    }

    // Improved killcam — free camera + killer direction + distance
    _showKillcam(killerName) {
        const kc = document.getElementById('killcam');
        if (!kc) return;
        kc.classList.remove('hidden');
        kc.classList.add('visible');
        const sub = document.getElementById('killcam-subtitle');
        if (sub) {
            let info = `Killed by ${killerName}`;
            // Show distance to killer
            if (this._killcamKillerPos && this._killcamDeathPos) {
                const dist = Math.round(this._killcamKillerPos.distanceTo(this._killcamDeathPos));
                info += ` — ${dist}m`;
            }
            sub.textContent = info;
        }
        // Activate killcam camera mode
        this._killcamActive = true;
        this._killcamElapsed = 0;
        this._killcamKillerName = killerName;
        // Auto-hide after duration
        if (this._killcamTimer) clearTimeout(this._killcamTimer);
        this._killcamTimer = setTimeout(() => this._hideKillcam(), this._killcamDuration * 1000);
        // Stop player camera control
        this.player.killcamLock = true;
        // Save death position for camera
        this._killcamDeathPos = this._killcamDeathPos || this.player.getPosition();
    }
    _hideKillcam() {
        const kc = globalThis.document?.getElementById?.('killcam');
        if (kc) {
            kc.classList.remove('visible');
            kc.classList.add('hidden');
        }
        if (this._killcamTimer) { clearTimeout(this._killcamTimer); this._killcamTimer = null; }
        this._killcamActive = false;
        this.player.killcamLock = false;
        this._killcamKillerPos = null;
        this._killcamDeathPos = null;
    }

    recordKillcamEvent(type, data) {
        if (!this._killcamActive) return;
        this._killcamReplayEvents.push({ t: performance.now(), type, data });
        const cutoff = performance.now() - this._killcamBufferMs;
        while (this._killcamReplayEvents.length && this._killcamReplayEvents[0].t < cutoff) {
            this._killcamReplayEvents.shift();
        }
    }

    _playComboSound(file) {
        try {
            const a = this._comboAudio[file];
            if (a) {
                a.volume = 0.12;
                a.currentTime = 0;
                a.play().catch(() => {});
            }
        } catch (_) {}
    }

    getPlayerList() {
        // Lokaldeki kendi avatarımızı da paylaşıyoruz ki diğer oyuncular sprite'ımızı görsün.
        const ownAvatar = window.__store?.get?.('customAvatar')?.dataURL || null;
        const list = [{
            name: this.playerName,
            team: this.player.team,
            isBot: false,
            peerId: this.network?.peer?.id,
            playerId: this.network?.playerId,
            charId: this.player.charId,
            avatar: ownAvatar,
            cosmetics: normalizeWearableLoadout(window.__store?.get?.('equippedWearables')),
            queuedForNextRound: !!this.player.queuedForNextRound,
            pendingTeam: this.player.pendingTeam || null,
            activateRound: this.player.activateRound || null
        }];
        this.bots.forEach(b => list.push({ name: b.name, team: b.team, isBot: true, charId: b.charId }));
        this.remotePlayers.forEach((p, playerId) => list.push({
            name: p.name,
            team: p.team,
            isBot: !!p.isBotEntity,
            playerId,
            peerId: p.peerId || playerId,
            charId: p.charId || 'rally',
            avatar: p.avatar || null,
            cosmetics: normalizeWearableLoadout(p.wearableLoadout),
            queuedForNextRound: !!p.queuedForNextRound,
            pendingTeam: p.pendingTeam || null,
            activateRound: p.activateRound || null
        }));
        return list;
    }

    _pushPosBuffer(p, x, y, z, time, vx = 0, vy = 0, vz = 0) {
        if (!p._posBuffer) p._posBuffer = [];
        // Teleport check (>5m jump) → clear buffer, jump instantly
        if (p._posBuffer.length > 0) {
            const last = p._posBuffer[p._posBuffer.length - 1];
            const dx = x - last.x, dy = y - last.y, dz = z - last.z;
            if (dx*dx + dy*dy + dz*dz > 25) {
                p._posBuffer.length = 0;
                p.position.set(x, y, z);
                p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
                return;
            }
        }
        p._posBuffer.push({ x, y, z, vx, vy, vz, time });
        if (p._posBuffer.length > 12) p._posBuffer.shift();
    }

    updateRemotePlayer(playerId, data, peerId = data.peerId || playerId) {
        if (playerId === this.network?.playerId || peerId === this.network?.peer?.id) return;
        const p = this.addRemotePlayer(playerId, data.name || `P-${playerId.slice(0, 4)}`, data.team, null, peerId);
        if (!p) return;
        if (p.queuedForNextRound) {
            p.alive = false;
            p.group.visible = false;
            return;
        }
        this._pushPosBuffer(p, data.x, data.y, data.z, performance.now(), data.vx, data.vy, data.vz);
        p.lastPacketTime = performance.now();
        p.group.rotation.y = data.ry || 0;
        p.team = data.team || p.team;
        p.alive = data.alive !== false;
        p.group.visible = p.alive;
        p.hp = data.hp ?? p.hp;
        if (data.charId) p.charId = data.charId;
        if (data.knifeId && data.knifeId !== p.knifeId && KNIVES[data.knifeId]) {
            p.knifeId = data.knifeId;
            p.setKnifeStyle?.(KNIVES[data.knifeId]);
        }
        if (data.ax !== undefined) p.aimDir.set(data.ax, data.ay, data.az).normalize();
        // ponytail: peer-to-peer mesh handles position directly. Host only relays as fallback if peer silent >500ms.
        if (this.network?.isHost) {
            const now = performance.now();
            const lastSeen = this._peerLastSeen?.get(playerId) || 0;
            if (now - lastSeen > 500) {
                this.network.broadcast({ ...data, type: 'position', playerId, peerId });
            }
            if (!this._peerLastSeen) this._peerLastSeen = new Map();
            this._peerLastSeen.set(playerId, now);
        }
    }

    // Her frame'de çağrılır — remote player'ların pozisyonlarını lerp ile
    // interpolate eder (30Hz snapshot aktarımı akıcı görülür).
    setRemoteCosmetics(playerId, loadout) {
        const player = this.remotePlayers.get(playerId);
        if (!player) return null;
        const safe = normalizeWearableLoadout(loadout);
        applyEntityCosmetics(player, safe);
        return safe;
    }

    invokeRemoteSnapshots(dt) {
        if (!this.remotePlayers.size) return;
        const netcode = normalizeNetcode(this.experimentalNetcode);
        const interpDelay = netcode.enabled ? netcode.interpolationMs : 60;
        const now = performance.now();
        const renderTime = now - interpDelay;
        for (const p of this.remotePlayers.values()) {
            updateEntityCosmetics(p, now / 1000);
            p.attackTimer = Math.max(0, (p.attackTimer || 0) - dt);
            if (p.rightArm) {
                const duration = p.attackType === 'stab' ? 0.42 : 0.34;
                const progress = 1 - Math.min(1, p.attackTimer / duration);
                const impact = p.attackTimer > 0 ? Math.sin(progress * Math.PI) : 0;
                const targetSwing = p.attackTimer > 0
                    ? (p.attackType === 'stab' ? -0.48 : -1.2) * impact
                    : 0;
                p.rightArm.rotation.x += (targetSwing - p.rightArm.rotation.x) * (1 - Math.exp(-18 * dt));
                if (p.knifeGroup?.userData.weaponType === 'knife') {
                    p.knifeGroup.rotation.z = -0.15 + (p.attackType === 'stab' ? 0.3 : 1.05) * impact;
                    p.knifeGroup.position.z = -0.28 - (p.attackType === 'stab' ? 0.22 : 0.05) * impact;
                }
            }
            const buf = p._posBuffer;
            if (!buf || buf.length < 2) {
                // Not enough data yet — stick with current pos
                if (buf?.length === 1) {
                    p.position.set(buf[0].x, buf[0].y, buf[0].z);
                }
                // ponytail: bots have feet at origin (position.y=0); real players carry height (~1.2)
                const yOff = p.isBotEntity ? 0 : -1.2;
                p.group.position.copy(p.position).add(new THREE.Vector3(0, yOff, 0));
                continue;
            }
            const sample = sampleSnapshots(buf, renderTime);
            let t1 = sample.from, t2 = sample.to;
            if (renderTime >= t2.time) {
                const maxLead = (netcode.enabled ? netcode.maxExtrapolationMs : 80);
                const predicted = predictPosition(t2, { x: t2.vx, y: t2.vy, z: t2.vz }, Math.min(renderTime - t2.time, maxLead),
                    netcode.enabled ? netcode.predictionStrength : 1);
                p.position.set(predicted.x, predicted.y, predicted.z);
            } else if (t1 === t2 || t1.time === t2.time) {
                p.position.set(t1.x, t1.y, t1.z);
            } else {
                const alpha = (renderTime - t1.time) / (t2.time - t1.time);
                const clamped = Math.max(0, Math.min(1, alpha));
                p.position.set(
                    t1.x + (t2.x - t1.x) * clamped,
                    t1.y + (t2.y - t1.y) * clamped,
                    t1.z + (t2.z - t1.z) * clamped
                );
            }
            // Garbage collect: keep at least 2, remove entries older than renderTime-100ms
            while (buf.length > 2 && buf[1].time < renderTime - 100) {
                buf.shift();
            }
            // ponytail: bots have feet at origin (position.y=0); real players carry height (~1.2)
            const yOff = p.isBotEntity ? 0 : -1.2;
            p.group.position.copy(p.position).add(new THREE.Vector3(0, yOff, 0));

            // Target outline pulse
            if (p._outlineActive && p.targetOutline?.visible) {
                const pulse = 0.5 + 0.5 * Math.sin(now / 300);
                p.targetOutline.material.uniforms.uPulse.value = pulse;
            }
        }
    }

    remoteAttack(playerId, data = {}, peerId = data.peerId || playerId) {
        if (!this.network?.isHost) return;
        let p = this.remotePlayers.get(playerId);
        if (!p) {
            if (!data.name || data.x === undefined) return;
            p = this.addRemotePlayer(playerId, data.name, data.team, null, peerId);
            if (!p) return;
            p.position.set(data.x, data.y, data.z);
            p.targetPos?.set(data.x, data.y, data.z);
        }
        if (p.queuedForNextRound) return;

        const now = performance.now();
        if (data.attackId) {
            if (!this._remoteAttackIds) this._remoteAttackIds = new Map();
            if (this._remoteAttackIds.has(data.attackId)) return;
            this._remoteAttackIds.set(data.attackId, now);
            if (this._remoteAttackIds.size > 128) this._remoteAttackIds.delete(this._remoteAttackIds.keys().next().value);
        }
        // A successful deflect can be followed by a fast return. Keep this below one attack animation.
        if (this._lastRemoteAttack && this._lastRemoteAttack[playerId] && now - this._lastRemoteAttack[playerId] < 90) return;
        if (!this._lastRemoteAttack) this._lastRemoteAttack = {};

        p.aimDir.set(data.ax ?? p.aimDir.x, data.ay ?? p.aimDir.y, data.az ?? p.aimDir.z).normalize();

        let attackPos = new THREE.Vector3(data.x ?? p.position.x, data.y ?? p.position.y, data.z ?? p.position.z);
        const netcode = normalizeNetcode(this.experimentalNetcode);
        if (netcode.enabled && p._posBuffer?.length > 1) {
            const rewind = rewindSnapshot(p._posBuffer, now, data.ping, netcode.lagCompensationMs);
            if (rewind) {
                const { from, to, alpha } = rewind;
                attackPos = new THREE.Vector3(
                    from.x + (to.x - from.x) * alpha,
                    from.y + (to.y - from.y) * alpha,
                    from.z + (to.z - from.z) * alpha
                );
            }
        }
        const clientBallPos = new THREE.Vector3(data.bx ?? this.ball.position.x, data.by ?? this.ball.position.y, data.bz ?? this.ball.position.z);
        // ponytail: trust client range check; also accept if near authoritative ball pos
        // (client ball render lags via smoothing, so clientBallPos can desync from host ball)
        const hostBallDist = attackPos.distanceTo(this.ball.position);
        const clientBallDist = attackPos.distanceTo(clientBallPos);
        const reportedPing = Math.min(250, Math.max(0, Number(data.ping) || 0));
        const latencyAllowance = Math.min(
            10,
            (reportedPing / 1000) * Math.max(15, this.ball.currentSpeed || 0)
        );
        const hostRange = this.ball.attackRange * 3.5 + latencyAllowance;
        const predictionRange = this.ball.attackRange * 2.5 + latencyAllowance * 0.35;
        if (hostBallDist <= hostRange || clientBallDist <= predictionRange) {
            this._lastRemoteAttack[playerId] = now;
            if (this._pendingLethalHit) {
                clearTimeout(this._pendingLethalHit);
                this._pendingLethalHit = null;
                this._pendingLethalVictim = null;
            }
            if (!p.alive) {
                p.alive = true;
                p.hp = p.maxHp;
                p.group.visible = true;
                this.network.broadcast({
                    type: 'playerHit', victimPlayerId: playerId, victimPeerId: p.peerId, victimName: p.name,
                    hp: p.hp, alive: true, dmg: 0, lethal: false,
                    hitX: p.position.x, hitY: p.position.y, hitZ: p.position.z,
                    victimTeam: p.team
                });
            }
            if (!this.ball.active) {
                this.ball.active = true;
                this.ball.mesh.visible = true;
                this.ball.state = 'rally';
            }
            p.attacking = true;
            p.attackType = data.action === 'stab' ? 'stab' : 'slash';
            p.attackTimer = p.attackType === 'stab' ? 0.42 : 0.34;
            this.ball.position.copy(clientBallPos);
            const target = this.getAimedEnemy(attackPos, p.aimDir, p.team);
            const remoteTimingMs = this.ball.getPerfectTimingErrorMs();
            const remoteResolved = resolvePerfectDeflect({
                timingErrorMs: remoteTimingMs,
                at: now,
                chain: this._remotePerfectChains.get(playerId) || { count: 0, lastPerfectAt: null },
                homingStrength: this.ball.homingStrength || 0
            });
            this._remotePerfectChains.set(playerId, remoteResolved.chain);
            const isPerfect = remoteResolved.tier === 'perfect';
            let finalDeflectPower = p.deflectPower || 1.0;
            if (isPerfect) {
                this.ball.lastPerfectBy = p;
                finalDeflectPower *= 1.3;
            }
            const result = this.ball.deflectWithAim(attackPos, p.aimDir, target, data.flick || { vertical: 0, horizontal: 0, power: 0 }, null, finalDeflectPower);
            if (target) this.ball.setTarget(target);
            if (this.ball._affixSplit) this.spawnSplitBall(this.ball);
            this.lastDeflector = p;
            this.lastDeflectorTeam = p.team;
            this._claimOpeningOwner(p);
            this._pushDeflectHistory(p.name);
            this.ball.lastShotBy = p.name;
            this.rallyCount++;
            p.onSuccessfulDeflect();
            this.scoreboard.recordDeflection(p.name);
            this.matchAnalytics.recordDeflect({
                player: { id: playerId, name: p.name, team: p.team },
                tier: remoteResolved.tier || 'normal'
            });
            this.audio.playDeflect(result.shot);
            this.network.broadcast({
                type: 'remoteAttackAnim',
                playerId,
                peerId: p.peerId,
                ax: p.aimDir.x, ay: p.aimDir.y, az: p.aimDir.z,
                attacking: true,
                action: p.attackType,
                shot: result.shot,
                pos: { x: attackPos.x, y: attackPos.y, z: attackPos.z },
                perfect: isPerfect
            });
        }
        setTimeout(() => { if (p) p.attacking = false; }, 300);
    }

    // Host: client gönderdiği skill intent'i authoritative işler.
    // Topu/hedefi/oyuncuyu değiştirir, sonra efekti tüm client'lara yayınlar.
    handleSkillUse(playerId, data = {}) {
        if (!this.network?.isHost) return;
        if (this._skillsDisabled) return;
        const p = this.remotePlayers.get(playerId);
        if (!p || p.queuedForNextRound || !data.skill) return;
        const skillId = data.skill;
        if (skillId === 'soldier_rocket') {
            const now = performance.now();
            if (p.charId !== 'soldier' || now < (this._remoteRocketCooldowns.get(playerId) || 0)) return;
            const aim = new THREE.Vector3(Number(data.ax), Number(data.ay), Number(data.az));
            if (![aim.x, aim.y, aim.z].every(Number.isFinite) || aim.lengthSq() < 0.5) return;
            this._remoteRocketCooldowns.set(playerId, now + 820);
            aim.normalize();
            this._fireRocket(p, p.getPosition(), aim);
            this.network.broadcastSkillEffect(skillId, playerId, p.peerId, {
                x: p.position.x, y: p.position.y, z: p.position.z,
                ax: aim.x, ay: aim.y, az: aim.z
            });
            return;
        }
        const target = this.ball.targetPlayer;
        // Remote player bir Player instance'ı değil — useSkill fonksiyonunu doğrudan çağır.
        const ok = useSkill(p, skillId, { ball: this.ball, target, game: this });
        if (ok) {
            // Black hole topu çeker — host'ta authoritative spawn (bal fiziği için).
            if (skillId === 'blackhole') this.spawnBlackHole();
            this.network.broadcastSkillEffect(skillId, playerId, p.peerId, {
                x: p.position.x, y: p.position.y, z: p.position.z
            });
        }
    }

    applyLobbyState(data, { deferLocalPlayer = false } = {}) {
        if (!data.players) return;
        // Lobby name
        if (data.lobbyName) {
            const el = document.getElementById('lobby-name-input');
            if (el) el.value = data.lobbyName;
        }
        // Oyun ayarlarını uygula (varsa)
        if (data.settings) {
            const s = data.settings;
            const timeEl = document.getElementById('setting-match-time');
            const roundEl = document.getElementById('setting-max-rounds');
            const diffEl = document.getElementById('setting-bot-difficulty');
            if (timeEl) { timeEl.value = s.matchTime; this.scoreboard.setTimeLimit(s.matchTime); }
            if (roundEl) { roundEl.value = s.maxRounds; this.scoreboard.setMaxRounds(s.maxRounds); }
            if (diffEl) { diffEl.value = s.botDifficulty || 'hard'; this.setBotDifficulty(s.botDifficulty || 'hard'); }
        }
        // Authoritative reconcile: the host's list is the source of truth.
        // Add/refresh present peers, then drop any remote player no longer in it.
        const myId = this.network?.playerId;
        const myPeerId = this.network?.peer?.id;
        const seen = new Set();
        for (const pl of data.players) {
            if ((pl.playerId && pl.playerId === myId) || (!pl.playerId && pl.peerId === myPeerId)) {
                if (deferLocalPlayer) continue;
                const revived = this.player.alive === false && pl.alive === true;
                this.player.setTeam(pl.team);
                this.player.queuedForNextRound = !!pl.queuedForNextRound;
                this.player.pendingTeam = pl.pendingTeam || null;
                this.player.activateRound = pl.activateRound || null;
                if (this.player.queuedForNextRound) {
                    this.player.alive = false;
                    this.player.setHandVisible?.(false);
                } else if (revived) {
                    this.player.alive = true;
                    this.player.setHandVisible?.(true);
                    this._spectateTarget = null;
                }
                continue;
            }
            if (pl.isBot) {
                // Bot'lar peerId'siz gelir — bot görünümü için remote player dummy'si.
                const botPeerId = `bot:${pl.name}`;
                seen.add(botPeerId);
                let p = this.remotePlayers.get(botPeerId);
                if (!p) {
                    p = this._createRemotePlayer(botPeerId, pl.name, pl.team, pl.avatar || null);
                    p.isBotEntity = true;
                    this.remotePlayers.set(botPeerId, p);
                    this.scoreboard.addPlayer(pl.name, pl.team, { isBot: true, peerId: botPeerId });
                } else {
                    p.team = pl.team || p.team;
                    const c = p.team === 'red' ? 0xcc3333 : 0x3355cc;
                    p.group.children.forEach(ch => { if (ch.isMesh && ch.geometry.type === 'CylinderGeometry') ch.material.color.setHex(c); });
                }
                continue;
            }
            const playerId = pl.playerId || pl.peerId;
            if (playerId && playerId !== myId) {
                seen.add(playerId);
                const p = this.addRemotePlayer(playerId, pl.name, pl.team, pl.avatar || null, pl.peerId || playerId);
                if (p) {
                    p.team = pl.team || p.team;
                    p.queuedForNextRound = !!pl.queuedForNextRound;
                    p.pendingTeam = pl.pendingTeam || null;
                    p.activateRound = pl.activateRound || null;
                    if (p.queuedForNextRound) {
                        p.alive = false;
                        p.group.visible = false;
                    }
                    if (pl.charId) p.charId = pl.charId;
                    if (pl.avatar && p.avatar !== pl.avatar) {
                        p.avatar = pl.avatar;
                        if (p.setAvatarTexture) p.setAvatarTexture(pl.avatar);
                    }
                    applyEntityCosmetics(p, pl.cosmetics ? normalizeWearableLoadout(pl.cosmetics) : null);
                }
            }
        }
        for (const peerId of [...this.remotePlayers.keys()]) {
            if (!seen.has(peerId)) this.removeRemotePlayer(peerId);
        }
        this.updateLobbyUI?.();
    }
    // Late-join: host oyun başlamışken yeni gelen oyuncu, aynı state'e
    // (mode/arena/round) otomatik başlar; top ve diğer eventler render'a gelir.
    handleLateJoin(data = {}) {
        if (this.network?.isHost) return;
        if (data.state === STATES.SOCIAL_HUB) return;
        if (typeof data.state === 'string' && data.state !== STATES.MENU && data.state !== STATES.LOBBY) {
            // Mode ve map'i senkronize et
            if (data.mode) this.selectMode(data.mode);
            if (data.map && this.arena.mapId !== data.map) this.arena.rebuild(data.map);
            // Skoru koru — startGame reset'lemesin diye önce sakla
            const savedScore = {
                red: typeof data.red === 'number' ? data.red : this.scoreboard.redScore,
                blue: typeof data.blue === 'number' ? data.blue : this.scoreboard.blueScore,
                round: typeof data.round === 'number' ? data.round : this.scoreboard.roundNum,
                time: typeof data.time === 'number' ? data.time : this.scoreboard.timeRemaining
            };
            if (data.snapshot?.players) this.applyLobbyState(data.snapshot);
            else if (data.players) this.applyLobbyState(data);
            // Direkt PLAYING: countdown yok. skipPreGame ile pre-game atla.
            this.setState(STATES.COUNTDOWN);
            this.scoreboard.reset();
            this.scoreboard.players.clear();
            this.scoreboard.addPlayer(this.playerName, this.player.team, { isYou: true });
            this.bots.forEach(b => this.scoreboard.addPlayer(b.name, b.team, { isBot: true }));
            this.remotePlayers.forEach(p => {
                if (p.isBotEntity) return;
                this.scoreboard.addPlayer(p.name, p.team, {
                    peerId: p.peerId,
                    queuedForNextRound: !!p.queuedForNextRound,
                    pendingTeam: p.pendingTeam || null
                });
                if (p.queuedForNextRound) {
                    p.alive = false;
                    p.group.visible = false;
                    return;
                }
                const spawn = this.arena.getPlayerSpawn(p.team);
                p.position.copy(spawn);
                // ponytail: bots have feet at origin (position.y=0); real players carry height (~1.2)
                const yOff = p.isBotEntity ? 0 : -1.2;
                p.group.position.copy(p.position).add(new THREE.Vector3(0, yOff, 0));
                p.group.rotation.y = p.team === 'red' ? 0 : Math.PI;
                p.alive = true;
                p.group.visible = true;
                p.hp = p.maxHp;
            });
            // Saklanan skoru geri yükle
            this.scoreboard.redScore = savedScore.red;
            this.scoreboard.blueScore = savedScore.blue;
            this.scoreboard.roundNum = savedScore.round;
            this.scoreboard.timeRemaining = savedScore.time;
            this._applyOvertimeSnapshot(data.snapshot || data);
            this.rallyCount = 0;
            this.killStreak = 0;
            this._spectateTarget = null;
            this._hideKillcam();
            this.ui.hideAll();
            this.ui.showHUD();
            const queued = !!this.player.queuedForNextRound;
            if (queued) {
                this.player.alive = false;
                this.player.hp = 0;
                this.player.setHandVisible?.(false);
            } else {
                this.player.respawn();
            }
            this.bots.forEach(b => b.respawn());
            this.audio.init();
            this.audio.preloadSfx('sfx/');
            this.initMinimap();
            this._skipPreGame = true;
            // ponytail: apply host ball state immediately so late joiner starts synced
            if (data.ball) {
                this.ball.position.set(data.ball.x, data.ball.y, data.ball.z);
                this.ball.velocity.set(data.ball.vx, data.ball.vy, data.ball.vz);
                this.ball.currentSpeed = data.ball.speed || this.ball.currentSpeed;
                this.ball.active = !!data.ball.active;
                this.ball.mesh.visible = this.ball.active;
                this._ballTarget = { x: data.ball.x, y: data.ball.y, z: data.ball.z, vx: data.ball.vx, vy: data.ball.vy, vz: data.ball.vz };
                this._ballTargetTime = performance.now();
                this._ballTargetActive = data.ball.active;
            }
            // Don't call startRound() — that spawns ball locally and desyncs from host.
            // Match host state; ball position comes from ballState broadcast.
            this.clearBlackHoles();
            this.clearSplitBalls();
            this.chaosManager?.clear();
            this._clearAllPowerUps();
            // ponytail: host in COUNTDOWN -> show countdown on client too, then go PLAYING
            if (data.state === STATES.COUNTDOWN) {
                this.setState(STATES.COUNTDOWN);
                this.ui.showCountdown(3, () => { this.setState(STATES.PLAYING); });
            } else {
                this.setState(data.state || STATES.PLAYING);
            }
            return queued ? {
                queued: true,
                team: this.player.pendingTeam || this.player.team,
                activateRound: this.player.activateRound
            } : { queued: false };
        }
    }

    startGameFromNetwork(data = {}) {
        if (this.network?.isHost) return;
        this.onMatchLoading?.(data);
        if (data.mode) this.selectMode(data.mode);
        if (data.map && this.arena.mapId !== data.map) {
            this.arena.rebuild(data.map);
        }
        // ponytail: client skips warmup/countdown — host already playing
        this._skipPreGame = true;
        const started = this.startGame(false, data.matchId);
        if (started !== false) this._applyOvertimeSnapshot(data);
    }

    applyPlayerHit(data = {}) {
        let target = this.remotePlayers.get(data.victimPlayerId || data.victimPeerId);
        if (!target) target = data.victimName === this.playerName ? this.player : this.bots.find(b => b.name === data.victimName);
        if (!target) target = [...this.remotePlayers.values()].find(p => p.isBotEntity && p.name === data.victimName);
        if (!target) return;

        const isClient = this.network?.connected && !this.network?.isHost;
        const isLethal = data.lethal || data.alive === false;

        // Client: play effects for every playerHit (host already played them)
        if (isClient && data.hitX !== undefined) {
            const hitPos = new THREE.Vector3(data.hitX, data.hitY, data.hitZ);

            // Damage number (project to local player's screen)
            const scrPos = hitPos.clone().project(this.player.camera);
            const sx = (scrPos.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-scrPos.y * 0.5 + 0.5) * window.innerHeight;
            this.ui.spawnDamageNumber(sx, sy, data.dmg || 0, isLethal, data.hitZone || null);

            // Hit marker — show when the local player lands a hit
            if (data.attackerName === this.playerName) {
                this.ui.showHitMarker(data.hitZoneId === 'head');
            }

            // Explosion at hit position (visible to everyone)
            this.spawnDeathExplosion(hitPos, data.victimTeam);
            this.audio.playSfx('tf2_explosion', 0.5);
            if (isLethal) {
                this.juice.killBurst(hitPos);
                this.juice.sparks(hitPos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffffff, 8);
            } else {
                this.juice.hitBurst(hitPos);
            }
            this.juice.shockwave(hitPos, isLethal ? 0xff3333 : 0xff8844);
            this.juice.shake(isLethal ? 0.6 : 0.25);
            this.juice.hitStop(isLethal ? 100 : 50);
            this.juice.flash(isLethal ? 0.4 : 0.2);

            // Kill feed
            const tag = (data.missTag || '') + (data.perfectTag || '');
            this.killFeed.unshift({ attacker: data.attackerName, victim: data.victimName, dmg: data.dmg || 0, time: performance.now(), tag });
            if (this.killFeed.length > 5) this.killFeed.pop();
            this.ui.renderKillFeed?.(this.killFeed);

            // Local player hit effects
            if (target === this.player) {
                const df = document.getElementById('damage-flash');
                if (df) {
                    df.classList.remove('fade');
                    df.classList.add('active');
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        df.classList.remove('active');
                        df.classList.add('fade');
                    }));
                }
                this.audio.playSfx('tf2_scout_scream', 0.45);
                // Directional damage indicator
                if (data.attackerName && data.attackerName !== this.playerName) {
                    const attacker = this.getAllTargets().find(t => t.name === data.attackerName);
                    if (attacker) {
                        const attackerPos = attacker.getPosition();
                        const playerPos = this.player.getPosition();
                        const dx = attackerPos.x - playerPos.x;
                        const dz = attackerPos.z - playerPos.z;
                        const damageAngle = Math.atan2(dx, dz) * (180 / Math.PI);
                        const camYaw = this.player.camera?.rotation?.y || 0;
                        const screenAngle = damageAngle - (camYaw * 180 / Math.PI);
                        this.ui.showDamageDirection(screenAngle);
                    }
                }
                if (isLethal) {
                    // Only play death effects if not already dead (prediction may have handled it)
                    if (this.player.alive) {
                        this.audio.playSfx('tf2_you_are_dead', 0.5);
                        this.player.die();
                        this.ui.flashHit();
                        this._killcamDeathPos = this.player.getPosition();
                        this._showKillcam(data.attackerName || 'Unknown');
                        this.juice.slowMo(0.25, 0.8);
                        this.juice.burst(hitPos, 0xffee44, 24, 14);
                        const aliveTeammates = this.bots.filter(b => b.alive && b.team === this.player.team);
                        if (aliveTeammates.length > 0) this._spectateTarget = aliveTeammates[0];
                    }
                }
            }
        }

        // Reconcile: host is authoritative
        const hostAlive = data.alive !== false;
        if (hostAlive) {
            this._reconcileHostRevive(target, data.hp);
        } else {
            // Host says dead
            target.hp = 0;
            target.alive = false;
            if (target === this.player) {
                this._predictedLocalDeath = false;
                if (this.player.alive) {
                    // We missed the hit locally — die now
                    this.player.die();
                    this.ui.flashHit();
                    this._killcamDeathPos = this.player.getPosition();
                    this._showKillcam(data.attackerName || 'Unknown');
                } // else already dead from prediction — no-op
            } else if (target.group) {
                target.group.visible = false;
            }
        }
    }

    _reconcileHostRevive(target, hp, authoritative = false, deferPresentation = false) {
        if (!target) return false;
        const localDeath = target === this.player && target.alive === false;
        const clearDeathPresentation = localDeath
            && (authoritative || this._predictedLocalDeath === true);
        const captureVector = vector => vector ? {
            x: vector.x,
            y: vector.y,
            z: vector.z
        } : null;
        const restoreVector = (vector, snapshot) => {
            if (!vector || !snapshot) return;
            try {
                if (typeof vector.set === 'function') {
                    vector.set(snapshot.x, snapshot.y, snapshot.z);
                    return;
                }
            } catch (_) {}
            try {
                vector.x = snapshot.x;
                vector.y = snapshot.y;
                vector.z = snapshot.z;
            } catch (_) {}
        };
        const previous = {
            alive: target.alive,
            hp: target.hp,
            position: captureVector(target.position),
            velocity: captureVector(target.velocity),
            euler: captureVector(target.euler),
            groupPosition: captureVector(target.group?.position),
            groupVisible: target.group?.visible
        };
        if (localDeath
            && (typeof this.player.revive !== 'function'
                || typeof this.player.respawn !== 'function')) return false;
        try {
            if (!target.alive) {
                if (target === this.player) {
                    this.player.revive();
                    this.player.respawn();
                } else if (target.group) {
                    target.group.visible = true;
                }
                target.alive = true;
            }
            target.hp = hp ?? target.maxHp;
        } catch (_) {
            target.alive = previous.alive;
            target.hp = previous.hp;
            restoreVector(target.position, previous.position);
            restoreVector(target.velocity, previous.velocity);
            restoreVector(target.euler, previous.euler);
            restoreVector(target.group?.position, previous.groupPosition);
            if (target.group && previous.groupVisible !== undefined) {
                target.group.visible = previous.groupVisible;
            }
            return false;
        }
        if (!clearDeathPresentation) return false;
        if (deferPresentation) return true;
        this._predictedLocalDeath = false;
        this._spectateTarget = null;
        try { this._hideKillcam?.(); } catch (_) {}
        this._killcamActive = false;
        this._killcamTimer = null;
        this._killcamKillerPos = null;
        this._killcamDeathPos = null;
        this._killcamKillerName = '';
        this.player.killcamLock = false;
        if (this.ui) this.ui.spectating = false;
        try { this.ui?.setPlayerTarget?.(false); } catch (_) {}
        try {
            globalThis.document?.getElementById?.('spectator-info')?.classList.add('hidden');
        } catch (_) {}
        return true;
    }

    _resetHotPotato() {
        const enabled = this.mode?.id === 'hotpotato';
        const duration = this._ballExplodeTimer || 5;
        this._hotPotato = resetHotPotatoState(
            this._hotPotato || createHotPotatoState(duration),
            duration,
            enabled
        );
        this.ui?.updateHotPotato?.(this.getHotPotatoSnapshot());
    }

    _hotPotatoEntityId(entity) {
        return String(
            entity?.playerId
            || entity?.peerId
            || entity?._networkId
            || entity?.name
            || ''
        ).slice(0, 128);
    }

    _updateHotPotato(dt) {
        if (this.mode?.id !== 'hotpotato' || this.state !== STATES.PLAYING) return false;
        if (!this._hotPotato) this._resetHotPotato();
        const target = this.ball.active ? this.ball.targetPlayer : null;
        const targetId = this._hotPotatoEntityId(target);
        if (target?.alive !== false && targetId && targetId !== this._hotPotato.holderId) {
            transferHotPotato(this._hotPotato, {
                id: targetId,
                name: target.name || this.playerName,
                team: target.team,
                entity: target
            }, this._ballExplodeTimer || 5);
        }
        if (!tickHotPotato(this._hotPotato, dt)) return false;

        const holder = this._hotPotato.holder;
        if (!holder || !['red', 'blue'].includes(holder.team)) return false;
        const position = holder.getPosition();
        holder.die?.();
        holder.hp = 0;
        holder.alive = false;
        if (holder !== this.player && holder.group) holder.group.visible = false;
        this.ball.deactivate();
        this.scoreboard.recordDeath(holder.name || this.playerName);
        this.spawnDeathExplosion(position, holder.team);

        const winner = holder.team === 'red' ? 'blue' : 'red';
        this.scoreboard.recordRoundWin(winner);
        this.announce(`HOT POTATO: ${holder.name || 'Player'} EXPLODED!`, 'tf2_explosion', 0.6, 2000);
        this.setState(STATES.ROUND_END);
        this.roundRestartTimer = this.roundRestartDelay;
        this.ui?.updateHotPotato?.(this.getHotPotatoSnapshot());
        if (this.network?.isHost) {
            this.network.broadcastRoundEnd({
                winner,
                red: this.scoreboard.redScore,
                blue: this.scoreboard.blueScore,
                round: this.scoreboard.roundNum
            });
        }
        return true;
    }

    getHotPotatoSnapshot() {
        const state = snapshotHotPotato(this._hotPotato);
        if (this.network?.connected && !this.network?.isHost && state.active && this._hotPotato?.receivedAt) {
            const elapsed = Math.max(0, (performance.now() - this._hotPotato.receivedAt) / 1000);
            state.remaining = Math.max(0, state.remaining - elapsed);
        }
        return state;
    }

    applyHotPotatoState(data) {
        this._hotPotato = applyHotPotatoSnapshot(
            this._hotPotato || createHotPotatoState(data?.duration),
            data,
            performance.now()
        );
        this.ui?.updateHotPotato?.(this.getHotPotatoSnapshot());
    }

    snapshotState() {
        // ponytail: include ball state so late joiner doesn't see a spawn pop
        const b = this.ball;
        return {
            matchId: this.matchId,
            players: this.getPlayerList(),
            state: this.state,
            mode: this.mode?.id,
            map: this.arena?.mapId,
            maxRounds: this.scoreboard.maxRounds,
            timeLimit: this.scoreboard.timeLimit,
            round: this.scoreboard.roundNum,
            red: this.scoreboard.redScore,
            blue: this.scoreboard.blueScore,
            time: this.scoreboard.timeRemaining,
            overtimeExtends: this._overtimeExtends,
            overtime: this._overtime,
            overtimeTimer: this._overtimeTimer,
            suddenDeathAnnounced: this._suddenDeathAnnounced,
            hotPotato: this.getHotPotatoSnapshot(),
            ball: b ? {
                x: b.position.x, y: b.position.y, z: b.position.z,
                vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z,
                speed: b.currentSpeed, active: b.active
            } : null
        };
    }

    applyHostMigrationCheckpoint(state, becomingHost = false) {
        let localPlayer = null;
        let remotePlayers = null;
        let previousPlayers = null;
        const score = this.scoreboard;
        const rollbacks = [];
        const captureVector = vector => vector ? {
            x: vector.x,
            y: vector.y,
            z: vector.z
        } : null;
        const restoreVector = (vector, snapshot) => {
            if (!vector || !snapshot) return;
            try {
                if (typeof vector.set === 'function') {
                    vector.set(snapshot.x, snapshot.y, snapshot.z);
                    return;
                }
            } catch (_) {}
            try {
                vector.x = snapshot.x;
                vector.y = snapshot.y;
                vector.z = snapshot.z;
            } catch (_) {}
        };
        const capturePlayer = player => player ? {
            alive: player.alive,
            hp: player.hp,
            team: player.team,
            queuedForNextRound: player.queuedForNextRound,
            pendingTeam: player.pendingTeam,
            activateRound: player.activateRound,
            killcamLock: player.killcamLock,
            position: captureVector(player.position),
            velocity: captureVector(player.velocity),
            euler: captureVector(player.euler),
            groupPosition: captureVector(player.group?.position),
            groupVisible: player.group?.visible,
            armVisible: player.armGroup?.visible,
            handVisible: player.handMesh?.visible,
            gloveVisible: player.gloveMesh?.visible,
            knifeVisible: player.knifeGroup?.visible
        } : null;
        const restorePlayer = (player, snapshot) => {
            if (!player || !snapshot) return;
            try {
                if (typeof player.setTeam === 'function') player.setTeam(snapshot.team);
            } catch (_) {}
            try { player.team = snapshot.team; } catch (_) {}
            try {
                player.alive = snapshot.alive;
                player.hp = snapshot.hp;
                player.queuedForNextRound = snapshot.queuedForNextRound;
                player.pendingTeam = snapshot.pendingTeam;
                player.activateRound = snapshot.activateRound;
                player.killcamLock = snapshot.killcamLock;
            } catch (_) {}
            restoreVector(player.position, snapshot.position);
            restoreVector(player.velocity, snapshot.velocity);
            restoreVector(player.euler, snapshot.euler);
            restoreVector(player.group?.position, snapshot.groupPosition);
            try {
                if (player.group && snapshot.groupVisible !== undefined) {
                    player.group.visible = snapshot.groupVisible;
                }
                if (player.armGroup && snapshot.armVisible !== undefined) {
                    player.armGroup.visible = snapshot.armVisible;
                }
                if (player.handMesh && snapshot.handVisible !== undefined) {
                    player.handMesh.visible = snapshot.handVisible;
                }
                if (player.gloveMesh && snapshot.gloveVisible !== undefined) {
                    player.gloveMesh.visible = snapshot.gloveVisible;
                }
                if (player.knifeGroup && snapshot.knifeVisible !== undefined) {
                    player.knifeGroup.visible = snapshot.knifeVisible;
                }
            } catch (_) {}
        };
        const rollback = () => {
            for (let index = rollbacks.length - 1; index >= 0; index--) {
                try { rollbacks[index](); } catch (_) {}
            }
        };
        let playerBefore = null;
        let scoreBefore = null;
        let ballBefore = null;
        let overtimeBefore = null;
        let presentationBefore = null;
        let modeBefore = null;
        let mapBefore = null;
        let stateBefore;
        let revivedLocal = false;
        let updateHandVisibility = false;
        try {
            if (!this._validateHostMigrationCheckpointState(state)) return false;
            localPlayer = state.players?.find(player =>
                player.playerId === this.network?.playerId
                || (!player.playerId && player.peerId === this.network?.peer?.id)
            ) || null;
            remotePlayers = state.players?.filter(player => player !== localPlayer) || null;
            if (state.players && typeof this.applyLobbyState !== 'function') return false;
            if (state.mode && this.mode?.id !== state.mode && typeof this.selectMode !== 'function') return false;
            if (state.map && this.arena?.mapId !== state.map && typeof this.selectMap !== 'function') return false;
            if (score && state.maxRounds !== undefined && typeof score.setMaxRounds !== 'function') return false;
            if (score && state.timeLimit !== undefined && typeof score.setTimeLimit !== 'function') return false;
            if (typeof this._applyOvertimeSnapshot !== 'function'
                || typeof this._restoreHostMigrationState !== 'function') return false;
            if (state.ball && this.ball
                && (typeof this.ball.position?.set !== 'function'
                    || typeof this.ball.velocity?.set !== 'function')) return false;
            if (localPlayer?.alive === true && this.player?.alive === false
                && (typeof this.player.revive !== 'function'
                    || typeof this.player.respawn !== 'function')) return false;
            if (state.players && typeof this.snapshotState === 'function') {
                const previous = this.snapshotState();
                if (!previous || !Array.isArray(previous.players)) return false;
                previousPlayers = previous.players.map(player => ({ ...player }));
            }
            stateBefore = this.state;
            modeBefore = { ref: this.mode, id: this.mode?.id };
            mapBefore = { arena: this.arena, id: this.arena?.mapId };
            playerBefore = capturePlayer(this.player);
            scoreBefore = score ? {
                maxRounds: score.maxRounds,
                timeLimit: score.timeLimit,
                roundNum: score.roundNum,
                redScore: score.redScore,
                blueScore: score.blueScore,
                timeRemaining: score.timeRemaining
            } : null;
            overtimeBefore = {
                overtime: this._overtime,
                overtimeTimer: this._overtimeTimer,
                overtimeExtends: this._overtimeExtends,
                suddenDeathAnnounced: this._suddenDeathAnnounced
            };
            ballBefore = this.ball ? {
                position: captureVector(this.ball.position),
                velocity: captureVector(this.ball.velocity),
                meshPosition: captureVector(this.ball.mesh?.position),
                currentSpeed: this.ball.currentSpeed,
                active: this.ball.active,
                clientOnly: this.ball._clientOnly,
                target: this.ball.target,
                state: this.ball.state,
                meshVisible: this.ball.mesh?.visible,
                ballTarget: this._ballTarget,
                ballTargetTime: this._ballTargetTime
            } : null;
            presentationBefore = {
                predictedLocalDeath: this._predictedLocalDeath,
                spectateTarget: this._spectateTarget,
                killcamActive: this._killcamActive,
                killcamTimer: this._killcamTimer,
                killcamKillerPos: this._killcamKillerPos,
                killcamDeathPos: this._killcamDeathPos,
                killcamKillerName: this._killcamKillerName,
                uiSpectating: this.ui?.spectating
            };
        } catch (_) {
            return false;
        }

        try {
            if (state.players) {
                rollbacks.push(() => {
                    if (!previousPlayers) return;
                    const previousLocal = previousPlayers.find(player =>
                        player.playerId === this.network?.playerId
                        || (!player.playerId && player.peerId === this.network?.peer?.id)
                    );
                    const previousRemote = previousPlayers.filter(player => player !== previousLocal);
                    this.applyLobbyState(
                        { players: previousRemote },
                        { deferLocalPlayer: true }
                    );
                });
                this.applyLobbyState(
                    { players: remotePlayers },
                    { deferLocalPlayer: true }
                );
            }
            if (state.mode && this.mode?.id !== state.mode) {
                rollbacks.push(() => {
                    try {
                        if (modeBefore.id !== undefined) this.selectMode(modeBefore.id);
                    } catch (_) {}
                    if (this.mode?.id !== modeBefore.id) this.mode = modeBefore.ref;
                });
                if (this.selectMode(state.mode) === false) {
                    throw new Error('host checkpoint mode restore failed');
                }
            }
            if (state.map && this.arena?.mapId !== state.map) {
                rollbacks.push(() => {
                    try {
                        if (mapBefore.id !== undefined) this.selectMap(mapBefore.id);
                    } catch (_) {}
                    if (this.arena?.mapId !== mapBefore.id) {
                        if (mapBefore.arena) mapBefore.arena.mapId = mapBefore.id;
                        this.arena = mapBefore.arena;
                    }
                });
                if (this.selectMap(state.map) === false) {
                    throw new Error('host checkpoint map restore failed');
                }
            }
            if (score) {
                rollbacks.push(() => {
                    try {
                        if (typeof score.setMaxRounds === 'function') {
                            score.setMaxRounds(scoreBefore.maxRounds);
                        }
                    } catch (_) {}
                    try {
                        if (typeof score.setTimeLimit === 'function') {
                            score.setTimeLimit(scoreBefore.timeLimit);
                        }
                    } catch (_) {}
                    try {
                        score.maxRounds = scoreBefore.maxRounds;
                        score.timeLimit = scoreBefore.timeLimit;
                        score.roundNum = scoreBefore.roundNum;
                        score.redScore = scoreBefore.redScore;
                        score.blueScore = scoreBefore.blueScore;
                        score.timeRemaining = scoreBefore.timeRemaining;
                    } catch (_) {}
                });
                if (state.maxRounds !== undefined) score.setMaxRounds(state.maxRounds);
                if (state.timeLimit !== undefined) score.setTimeLimit(state.timeLimit);
                if (state.round !== undefined) score.roundNum = state.round;
                if (state.red !== undefined) score.redScore = state.red;
                if (state.blue !== undefined) score.blueScore = state.blue;
                if (state.time !== undefined) score.timeRemaining = state.time;
            }
            rollbacks.push(() => {
                this._overtime = overtimeBefore.overtime;
                this._overtimeTimer = overtimeBefore.overtimeTimer;
                this._overtimeExtends = overtimeBefore.overtimeExtends;
                this._suddenDeathAnnounced = overtimeBefore.suddenDeathAnnounced;
            });
            this._applyOvertimeSnapshot(state);
            if (state.ball && this.ball) {
                rollbacks.push(() => {
                    restoreVector(this.ball?.position, ballBefore.position);
                    restoreVector(this.ball?.velocity, ballBefore.velocity);
                    restoreVector(this.ball?.mesh?.position, ballBefore.meshPosition);
                    try {
                        this.ball.currentSpeed = ballBefore.currentSpeed;
                        this.ball.active = ballBefore.active;
                        this.ball._clientOnly = ballBefore.clientOnly;
                        this.ball.target = ballBefore.target;
                        this.ball.state = ballBefore.state;
                        if (this.ball.mesh && ballBefore.meshVisible !== undefined) {
                            this.ball.mesh.visible = ballBefore.meshVisible;
                        }
                        this._ballTarget = ballBefore.ballTarget;
                        this._ballTargetTime = ballBefore.ballTargetTime;
                    } catch (_) {}
                });
                const b = state.ball;
                this.ball.position.set(b.x, b.y, b.z);
                this.ball.velocity.set(b.vx, b.vy, b.vz);
                this.ball.mesh?.position.copy(this.ball.position);
                this.ball.currentSpeed = b.speed;
                this.ball.active = b.active;
            }
            if (this.ball) this.ball._clientOnly = !becomingHost;
            this._ballTarget = null;
            this._ballTargetTime = 0;
            if (localPlayer && this.player) {
                rollbacks.push(() => {
                    restorePlayer(this.player, playerBefore);
                    this._predictedLocalDeath = presentationBefore.predictedLocalDeath;
                    this._spectateTarget = presentationBefore.spectateTarget;
                    this._killcamActive = presentationBefore.killcamActive;
                    this._killcamTimer = presentationBefore.killcamTimer;
                    this._killcamKillerPos = presentationBefore.killcamKillerPos;
                    this._killcamDeathPos = presentationBefore.killcamDeathPos;
                    this._killcamKillerName = presentationBefore.killcamKillerName;
                    if (this.ui && presentationBefore.uiSpectating !== undefined) {
                        this.ui.spectating = presentationBefore.uiSpectating;
                    }
                });
                if (typeof this.player.setTeam === 'function') {
                    if (this.player.setTeam(localPlayer.team) === false) {
                        throw new Error('host checkpoint team restore failed');
                    }
                } else {
                    this.player.team = localPlayer.team;
                }
                this.player.queuedForNextRound = !!localPlayer.queuedForNextRound;
                this.player.pendingTeam = localPlayer.pendingTeam || null;
                this.player.activateRound = localPlayer.activateRound || null;
                if ([localPlayer.x, localPlayer.y, localPlayer.z].every(Number.isFinite)) {
                    if (typeof this.player.position?.set !== 'function') {
                        throw new Error('host checkpoint player position unavailable');
                    }
                    this.player.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
                }
                if (this.player.queuedForNextRound) {
                    this.player.alive = false;
                    updateHandVisibility = true;
                } else if (localPlayer.alive === true && this.player.alive === false) {
                    if (!this._reconcileHostRevive(this.player, localPlayer.hp, true, true)) {
                        throw new Error('host checkpoint revive failed');
                    }
                    revivedLocal = true;
                    updateHandVisibility = true;
                } else {
                    this.player.alive = localPlayer.alive !== false;
                    if (localPlayer.hp !== undefined) this.player.hp = localPlayer.hp;
                    if (localPlayer.alive === false) updateHandVisibility = true;
                }
            }
            rollbacks.push(() => { this.state = stateBefore; });
            if (!this._restoreHostMigrationState(state.state)) {
                throw new Error('host checkpoint state restore failed');
            }
        } catch (_) {
            rollback();
            return false;
        }

        if (revivedLocal) {
            this._predictedLocalDeath = false;
            this._spectateTarget = null;
            try { this._hideKillcam?.(); } catch (_) {}
            this._killcamActive = false;
            this._killcamTimer = null;
            this._killcamKillerPos = null;
            this._killcamDeathPos = null;
            this._killcamKillerName = '';
            this.player.killcamLock = false;
            if (this.ui) this.ui.spectating = false;
            try { this.ui?.setPlayerTarget?.(false); } catch (_) {}
            try {
                globalThis.document?.getElementById?.('spectator-info')?.classList.add('hidden');
            } catch (_) {}
        }
        if (updateHandVisibility) {
            try {
                this.player?.setHandVisible?.(
                    !this.player.queuedForNextRound && this.player.alive !== false
                );
            } catch (_) {}
        }
        try { this.ui?.updateScores?.(score); } catch (_) {}
        return true;
    }

    _validateHostMigrationCheckpointState(state) {
        if (!state || typeof state !== 'object' || Array.isArray(state)
            || !Object.values(STATES).includes(state.state)) return false;
        const bounded = (value, min, max, integer = false) =>
            Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isSafeInteger(value));
        const safeText = (value, max) =>
            typeof value === 'string' && value.length > 0 && value.length <= max;
        const validCoordinate = value => bounded(value, -512, 512);

        if (state.players !== undefined) {
            if (!Array.isArray(state.players) || state.players.length > 64) return false;
            const identities = new Set();
            for (const player of state.players) {
                if (!player || typeof player !== 'object' || Array.isArray(player)
                    || !safeText(player.name, 32)
                    || !['red', 'blue'].includes(player.team)
                    || (player.alive !== undefined && typeof player.alive !== 'boolean')
                    || (player.hp !== undefined && !bounded(player.hp, 0, 10000))
                    || ['x', 'y', 'z'].some(key =>
                        player[key] !== undefined && !validCoordinate(player[key]))) return false;
                const identity = player.playerId || player.peerId
                    || (player.isBot === true ? `bot:${player.name}` : null);
                if (!safeText(identity, 128) || identities.has(identity)) return false;
                identities.add(identity);
            }
        }

        for (const [key, max] of [
            ['maxRounds', 1024],
            ['round', 1000000],
            ['red', 1000000],
            ['blue', 1000000]
        ]) {
            if (state[key] !== undefined && !bounded(state[key], 0, max, true)) return false;
        }
        for (const [key, max] of [['timeLimit', 86400], ['time', 86400]]) {
            if (state[key] !== undefined && !bounded(state[key], 0, max)) return false;
        }
        if (state.mode !== undefined && !safeText(state.mode, 64)) return false;
        if (state.map !== undefined && !safeText(state.map, 64)) return false;
        if (state.overtime !== undefined && typeof state.overtime !== 'boolean') return false;
        if (state.overtimeExtends !== undefined
            && !bounded(state.overtimeExtends, 0, 8, true)) return false;
        if (state.overtimeTimer !== undefined
            && !bounded(state.overtimeTimer, 0, 3600)) return false;
        if (state.suddenDeathAnnounced !== undefined
            && typeof state.suddenDeathAnnounced !== 'boolean') return false;

        if (state.ball !== undefined && state.ball !== null) {
            const ball = state.ball;
            if (!ball || typeof ball !== 'object' || Array.isArray(ball)
                || ![ball.x, ball.y, ball.z].every(validCoordinate)
                || ![ball.vx, ball.vy, ball.vz].every(value => bounded(value, -512, 512))
                || !bounded(ball.speed, 0, 512)
                || typeof ball.active !== 'boolean') return false;
        }
        return true;
    }

    _restoreHostMigrationState(state) {
        if (!Object.values(STATES).includes(state)) return false;
        try {
            this.state = state;
        } catch (_) {
            return false;
        }
        try { this.audio?.resetThreatAudio?.(); } catch (_) {}
        return true;
    }

    updateBallFromNetwork(data) {
        if (this.network?.isHost) return;
        // ponytail: stale ballState guard — ignore packets older than last seen
        if (data.seq !== undefined) {
            if (this._ballSeq !== undefined && !isNewerSequence(data.seq, this._ballSeq)) return;
            this._ballSeq = data.seq;
        }
        // ponytail: client only renders — host runs authoritative physics
        this.ball._clientOnly = true;
        // ponytail: store target for exponential smoothing (same approach as remote players)
        this._ballTarget = { x: data.x, y: data.y, z: data.z, vx: data.vx, vy: data.vy, vz: data.vz };
        this._ballTargetTime = performance.now();
        this._ballTargetActive = data.active;
        // ponytail: sync currentSpeed from host — prevents client scalar drift
        if (data.speed !== undefined) this.ball.currentSpeed = data.speed;
        // ponytail: client keeps ball active until host sends explicit respawn (state='idle' or new spawn).
        // This prevents "ball became inactive before client could deflect" race.
        if (data.active && data.state !== 'idle') {
            if (!this.ball.active) {
                this.ball.active = true;
                this.ball.mesh.visible = true;
            }
        } else if (data.state === 'idle') {
            this.ball.active = false;
            this.ball.mesh.visible = false;
        }
        if (Object.hasOwn(data, 'targetPlayerId')
            || Object.hasOwn(data, 'targetPeerId')
            || Object.hasOwn(data, 'targetName')) {
            const stableTarget = data.targetPlayerId || data.targetPeerId;
            let target = data.targetPlayerId === this.network?.playerId
                || data.targetPeerId === this.network?.peer?.id
                ? this.player
                : null;
            if (!target && data.targetPlayerId) target = this.remotePlayers.get(data.targetPlayerId) || null;
            if (!target && data.targetPeerId) {
                target = this.remotePlayers.get(data.targetPeerId)
                    || [...this.remotePlayers.values()].find(player => player.peerId === data.targetPeerId)
                    || null;
            }
            if (!target && !stableTarget) {
                target = data.targetName === this.playerName ? this.player : null;
                if (!target) target = this.bots.find(bot => bot.name === data.targetName) || null;
                if (!target) target = [...this.remotePlayers.values()].find(player => player.name === data.targetName) || null;
            }
            this.ball.setTarget(target);
        }
        this.ball.state = data.state || this.ball.state;
        // Sync ball affix from host
        if (data.affix && this.currentBallAffix?.id !== data.affix) {
            this.currentBallAffix = { id: data.affix, color: data.affixColor || 0x44ff88 };
            this.ball.affix = this.currentBallAffix;
            this.ui.updateBallAffix(this.currentBallAffix);
        } else if (!data.affix && this.currentBallAffix) {
            this.currentBallAffix = null;
            this.ball.affix = null;
            this.ui.updateBallAffix(null);
        }
    }

    // ponytail: client-side ball smoothing toward host snapshot.
    // Velocity-extrapolated so fast balls don't lag behind host.
    invokeBallSmoothing(dt) {
        if (this.network?.isHost || !this._ballTarget || !this._ballTargetTime || !this.ball.active) return;
        this.ball._prevPosition ??= this.ball.position.clone();
        this.ball._prevPosition.copy(this.ball.position);
        const elapsed = (performance.now() - this._ballTargetTime) / 1000;
        // ponytail: extrapolate target forward by velocity × elapsed since snapshot
        const next = networkBallStep(
            this.ball.position,
            { x: this._ballTarget.vx, y: this._ballTarget.vy, z: this._ballTarget.vz },
            this._ballTarget,
            dt,
            elapsed
        );
        this.ball.position.set(next.x, next.y, next.z);
        this.ball.velocity.set(this._ballTarget.vx, this._ballTarget.vy, this._ballTarget.vz);
        // ponytail: mesh position handled by _clientVisualUpdate in game.update — not here
    }
    updateScoresFromNetwork(data) {
        if (this.network && !this.network.isHost) {
            this.scoreboard.redScore = data.red;
            this.scoreboard.blueScore = data.blue;
            this.scoreboard.timeRemaining = data.time;
            this.scoreboard.roundNum = data.round;
            if (data.hotPotato) this.applyHotPotatoState(data.hotPotato);
            // Kill feed sync
            if (data.killFeed) {
                this.killFeed = data.killFeed;
                this.ui.renderKillFeed?.(this.killFeed);
            }
        }
    }
    // Client tarafında roundEnd sadece UI/IPC amaçlı: round bitti mesajını göster ve round timer'i başlat.
    applyRoundEnd(data) {
        if (this.network?.isHost) return;
        this.ball.deactivate();
        this._ballSeq = 0; // reset seq, ignore stale ballState
        this.setState(STATES.ROUND_END);
        this.roundRestartTimer = this.roundRestartDelay;
        this.clearSplitBalls();
        this.chaosManager?.clear();
        if (data?.winner === 'red') this.ui.showMessage?.('🔴 RED TEAM WINS THE ROUND!', 2000);
        else if (data?.winner === 'blue') this.ui.showMessage?.('🔵 BLUE TEAM WINS THE ROUND!', 2000);
        else if (data?.winner === 'ffa' && data.winnerName) this.ui.showMessage?.(`${data.winnerName} WINS THE ROUND!`, 2000);
        else if (data?.winner === 'draw') this.ui.showMessage?.('⚔️ DOUBLE KO — DRAW!', 2000);
    }
    startRoundFromNetwork(data = {}) {
        if (this.network?.isHost) return;
        const wasQueued = !!this.player.queuedForNextRound;
        if (Array.isArray(data.players)) this.applyLobbyState(data);
        const own = data.players?.find(pl =>
            pl.playerId === this.network?.playerId
            || (!pl.playerId && pl.peerId === this.network?.peer?.id)
        );
        if (wasQueued && own && !own.queuedForNextRound) {
            this.player.pendingTeam = own.team;
            activateQueuedEntity(this.player);
            this.player.setTeam(own.team);
        }
        this.startRound();
        this._applyOvertimeSnapshot(data);
        if (wasQueued && !this.player.queuedForNextRound) {
            this.onLateJoinActivated?.(this.player.team);
        }
    }

    // Client: host'tan remoteAttackAnim mesajı gelince, remote player'ın
    // saldırı animasyonunu göster (kol sallama, efekt).
    // Client: chaos state from host — sync tornadoes and gravity flip
    applyChaosState(data) {
        if (!data || this.network?.isHost) return;
        if (!this.chaosManager) return;
        // ponytail: clear existing tornadoes and rebuild from snapshot
        for (const t of this.chaosManager.tornadoes) {
            this.arena.remove(t.mesh);
            t.mesh.geometry.dispose();
            t.mesh.material.dispose();
        }
        this.chaosManager.tornadoes = [];
        this.chaosManager.gravityFlipped = !!data.gravityFlipped;
        if (data.tornadoes) {
            for (const td of data.tornadoes) {
                const geo = new THREE.ConeGeometry(td.radius * 0.3, 8, 12, 1, true);
                const mat = new THREE.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(td.x, 4, td.z);
                this.arena.add(mesh);
                this.chaosManager.tornadoes.push({
                    mesh, x: td.x, z: td.z,
                    radius: td.radius, strength: td.strength,
                    life: td.life, age: td.age || 0, rotation: td.rotation || 0
                });
            }
        }
        // apply gravity flip ball/player effect
        if (data.gravityFlipped !== undefined && this.chaosManager.flipGravity) {
            this.chaosManager.flipGravity(data.gravityFlipped, this);
        }
    }

    // Client: host'tan gelen bot pozisyon verilerini bot dummy'lerine uygula.
    applyBotSync(data) {
        if (!data?.bots || this.network?.isHost) return;
        for (const bd of data.bots) {
            const peerId = `bot:${bd.name}`;
            let p = this.remotePlayers.get(peerId);
            if (!p) {
                p = this._createRemotePlayer(peerId, bd.name, bd.team);
                p.isBotEntity = true;
                this.remotePlayers.set(peerId, p);
            }
                this._pushPosBuffer(p, bd.x, bd.y, bd.z, performance.now());
            p.team = bd.team || p.team;
            p.group.rotation.y = bd.ry || 0;
            p.alive = bd.alive !== false;
            p.group.visible = p.alive;
            p.hp = bd.hp ?? p.hp;
            if (bd.charId) p.charId = bd.charId;
        }
    }

    handleRemoteAttackAnim(data) {
        if (!data || this.network?.isHost) return;
        const playerId = data.playerId || data.peerId;
        const isLocal = data.playerId ? data.playerId === this.network?.playerId : data.peerId === this.network?.peer?.id;
        const p = isLocal ? this.player : this.remotePlayers.get(playerId);
        if (!p) return;
        p.attacking = true;
        p.attackType = data.action === 'stab' ? 'stab' : 'slash';
        p.attackTimer = p.attackType === 'stab' ? 0.42 : 0.34;
        if (data.ax !== undefined) p.aimDir.set(data.ax, data.ay, data.az).normalize();
        // Track deflector so hit detection candidates work on client
        this.lastDeflector = p;
        this.lastDeflectorTeam = p.team;
        this.rallyCount = Math.max(this.rallyCount, data.rally ?? this.rallyCount);
        this.audio?.playSfx?.('tf2_hit', 0.15);
        if (data.shot && this.audio?.playDeflect) {
            this.audio.playDeflect(data.shot);
        }
        // Trail burst on deflect — client-side visual: dump extra trail dots for smooth comet
        if (this.ball?.active && !this.network?.isHost) {
            for (let i = 0; i < 8; i++) {
                setTimeout(() => this.ball?.addTrailDot?.(), i * 20);
            }
        }
        if (data.perfect && this.juice) {
            const hitPos = data.pos ? new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z) : p.getPosition();
            this.juice.sparks(hitPos, 0xffbb00, 16);
            this.juice.shockwave(hitPos, 0xffbb00);
            this.audio?.playSfx?.('tf2_crit', 0.55);
            this.juice.shake(0.2);
        } else if (data.pos && this.juice?.sparks) {
            this.juice.sparks(new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z), 0x88ddff, 4);
        }
        setTimeout(() => { if (p) p.attacking = false; }, 300);
    }

    // Client: host'tan gelen skill efektini oynat (ses + mesaj + görsel).
handleSkillEffect(data = {}) {
    if (this._skillsDisabled) return false;
        if (!data || this.network?.isHost) return;
        if (data.skill === 'soldier_rocket' && data.pos) {
            const aim = new THREE.Vector3(data.pos.ax, data.pos.ay, data.pos.az);
            if (aim.lengthSq() > 0.5) {
                const owner = this.remotePlayers.get(data.playerId) || { team: 'red' };
                this._fireRocket(owner, new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z), aim, true);
            }
            return;
        }
        if (data.skill === 'soldier_rocket_explode' && data.pos) {
            const origin = new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z);
            let index = -1;
            let distance = Infinity;
            this.rockets.forEach((rocket, candidate) => {
                const d = rocket.position.distanceToSquared(origin);
                if (rocket.visualOnly && d < distance) {
                    distance = d;
                    index = candidate;
                }
            });
            if (index >= 0) {
                const [rocket] = this.rockets.splice(index, 1);
                rocket.position.copy(origin);
                this._explodeRocket(rocket);
            } else {
                this.juice?.burst?.(origin, 0xff8a35, 30, 18);
                this.juice?.shockwave?.(origin, 0xffaa44);
                this.audio?.playSfx?.('tf2_explosion', 0.55);
            }
            return;
        }
        const skill = SKILLS[data.skill];
        const name = skill ? skill.name.toUpperCase() : (data.skill || 'SKILL');
        this.ui?.showMessage?.(`${name}!`, 800);
        this.audio?.playSfx?.('tf2_medic', 0.35);
        if (data.pos && this.juice?.sparks) {
            this.juice.sparks(new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z), 0x88ddff, 10);
        }
        // ponytail: black hole visual handled by blackHoleSpawn broadcast, not here
    }

    // Host: announcement'ı hem local oynat hem tüm client'lara yayınla.
    // first blood, KO, combo, round/team win gibi juicy mesajlar herkeste çalsın.
    announce(text, sfx, sfxVol = 0.4, duration = 1500) {
        this.ui?.showMessage?.(text, duration);
        if (sfx && this.audio) this.audio.playSfx(sfx, sfxVol);
        if (this.network?.isHost) {
            this.network.broadcast({ type: 'announce', text, sfx, sfxVol, duration });
        }
    }

    // Client: host'tan gelen announcement'ı oynat.
    applyAnnounce(data = {}) {
        if (!data || this.network?.isHost) return;
        this.ui?.showMessage?.(data.text, data.duration || 1500);
        if (data.sfx && this.audio) this.audio.playSfx(data.sfx, data.sfxVol || 0.4);
    }

    // --- P2P SYNC HANDLERS ---

applyMapChange(data) {
    if (!data?.mapId || this.network?.isHost) return;
    const mapId = this._rallyDuel ? normalizeRallyDuelMap(data.mapId) : data.mapId;
    if (this.arena.mapId === mapId) return;
    this.arena.rebuild(mapId);
    this.ui.showMessage?.(`Arena: ${this.arena.config?.name || mapId}`, 1400);
        // Oyuncuları yeni haritada spawn et
        this.player.respawn();
        this.bots.forEach(b => b.respawn());
    this.remotePlayers.forEach(p => {
            if (p.position && !p.isBotEntity) {
                p.position.copy(this.arena.getPlayerSpawn(p.team));
                p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
        }
    });
    this.onMapChange?.(mapId);
}

    applyModeChange(data) {
        if (!data?.modeId || this.network?.isHost) return;
        this.selectMode(data.modeId);
    }

applyPowerUpState(data) {
    if (this._powerUpsDisabled) return false;
        if (!data?.powerUps || this.network?.isHost) return;
        // ponytail: keep existing meshes/timers when powerups are unchanged (avoid 2Hz churn).
        // Key by position so we don't recreate geometry every sync.
        const incoming = new Set(data.powerUps.map(pu => `${pu.type}:${pu.x.toFixed(1)}:${pu.z.toFixed(1)}`));
        // Remove powerups no longer present
        for (const pu of this.powerUps) {
            const key = `${pu.type.id}:${pu.pos.x.toFixed(1)}:${pu.pos.z.toFixed(1)}`;
            if (!incoming.has(key)) {
                this.renderer.scene.remove(pu.mesh);
                pu.mesh.geometry?.dispose();
                pu.mesh.material?.dispose();
            }
        }
        this.powerUps = this.powerUps.filter(pu => {
            const key = `${pu.type.id}:${pu.pos.x.toFixed(1)}:${pu.pos.z.toFixed(1)}`;
            return incoming.has(key);
        });
        // Add new powerups (preserve existing timers)
        for (const pu of data.powerUps) {
            const key = `${pu.type}:${pu.x.toFixed(1)}:${pu.z.toFixed(1)}`;
            if (this.powerUps.some(existing => `${existing.type.id}:${existing.pos.x.toFixed(1)}:${existing.pos.z.toFixed(1)}` === key)) continue;
            const type = POWERUP_TYPES.find(t => t.id === pu.type) || POWERUP_TYPES[0];
            const geo = new THREE.OctahedronGeometry(0.5);
            const mat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.8 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pu.x, 1.5, pu.z);
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.72, 0.045, 6, 18),
                new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.72 })
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.y = -1.25;
            mesh.add(ring);
            this.renderer.scene.add(mesh);
            this.powerUps.push({ mesh, type, pos: new THREE.Vector3(pu.x, 1.5, pu.z), timer: POWERUP_LIFETIME });
        }
    }

    applyCelebrationStart(data) {
        if (!data || this.network?.isHost) return;
        // Client celebration state'ine gir — winner/loser UI'ı göster
        this.setState(STATES.CELEBRATION);
        this._celebrationTimer = data.duration || 30;
        this._winningTeam = data.winner || null;
        this._won = this._winningTeam !== null && this.player.team === this._winningTeam;
        this.ball.deactivate();
        this.player._celebNoAttack = (this.player.team !== this._winningTeam);
        this.player.respawn();
        this.ui.setPlayerTarget(false);
        this.bots.forEach(bot => bot.setTargetOutline(false));
        this.remotePlayers.forEach(p => p.setTargetOutline?.(false));
        this._celebWeapon = 'rocket';
        this._prevHandVisible = this.player.armGroup?.visible ?? false;
        this.player.setHandVisible?.(this._won);
        if (this._won) {
            this._setCelebrationGloveColor(0xff8800);
            this._buildCelebWeapons();
            this._showCelebWeapon('rocket');
        } else {
            const wh = document.getElementById('celeb-weapon-hud');
            if (wh) {
                wh.classList.add('hidden');
                wh.style.display = 'none';
            }
        }
        this.ui.showMessage?.(data.message || '', 3000);
        if (this._won) {
            this.audio?.playSfx?.('tf2_victory', 0.55);
        } else {
            this.audio?.playSfx?.('tf2_you_failed', 0.5);
        }
        // ponytail: show winner banner at top during celebration
        this._showCelebrationBanner(data.winner);
    }

    _showCelebrationBanner(winner) {
        const banner = document.getElementById('celebration-banner');
        if (!banner) return;
        const teamEl = document.getElementById('cb-team');
        const subEl = document.getElementById('cb-sub');
        const cls = winner === 'red' ? 'cb-red' : winner === 'blue' ? 'cb-blue' : 'cb-draw';
        if (teamEl) {
            teamEl.textContent = winner ? (this._won ? 'VICTORY' : 'LOSE') : 'DRAW';
            teamEl.className = 'cb-team ' + cls;
        }
        if (subEl) subEl.textContent = '';
        banner.classList.remove('hidden');
    }

    _hideCelebrationBanner() {
        document.getElementById('celebration-banner')?.classList.add('hidden');
    }

    applyGameOver(data) {
        if (!data || this.network?.isHost) return;
        this.setState(STATES.GAME_OVER);
        this.player.unlock();
        this.player._celebNoAttack = false;
        this._hideCelebrationBanner();
        const weaponHud = document.getElementById('celeb-weapon-hud');
        if (weaponHud) {
            weaponHud.classList.add('hidden');
            weaponHud.style.display = 'none';
        }
        this.player.setHandVisible?.(this._prevHandVisible);
        if (this.player.handMesh) this.player.handMesh.visible = true;
        if (this.player.gloveMesh) this.player.gloveMesh.visible = true;
        if (this.player.knifeGroup) this.player.knifeGroup.visible = true;
        if (this._celebWpnMeshes && this.player.camera) {
            Object.values(this._celebWpnMeshes).forEach(mesh => {
                mesh.traverse(child => {
                    child.geometry?.dispose?.();
                    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose?.());
                    else child.material?.dispose?.();
                });
                this.player.camera.remove(mesh);
            });
        }
        this._celebWpnMeshes = {};
        // XP / reward screen — host'tan gelen verilerle
        const winner = data.winner || (data.redScore > data.blueScore ? 'RED' : data.blueScore > data.redScore ? 'BLUE' : 'DRAW');
        const winnerText = winner === 'DRAW'
            ? `DRAW: RED ${data.redScore} - ${data.blueScore} BLUE`
            : `${winner} TEAM WINS: RED ${data.redScore} - ${data.blueScore} BLUE`;
        this.onMatchComplete?.();
        this.ui.showPostGame?.(this._won, data.xp || 0, 1, data.kills || 0, data.rally || 0, this.audio, { winnerText, playerStats: data.playerStats || [] });
    }

    setBotDifficulty(d) { this.botDifficulty = d; }

    // --- Sprite helpers for remote players ---
    // İsim etiketi: canvas üzerinde yazı + yarı saydam arka plan.
    _makeNameLabelTexture(name, colorHex) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 64;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, 256, 64);
        // Pill background
        const hex = '#' + colorHex.toString(16).padStart(6, '0');
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        this._roundRect(ctx, 8, 12, 240, 40, 20);
        ctx.fill();
        ctx.strokeStyle = hex;
        ctx.lineWidth = 2;
        this._roundRect(ctx, 8, 12, 240, 40, 20);
        ctx.stroke();
        // Name text
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 22px Outfit, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const display = (name || 'Player').slice(0, 18);
        ctx.fillText(display, 128, 33);
        const tex = new THREE.CanvasTexture(c);
        tex.needsUpdate = true;
        return tex;
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // Local cached avatar — client'ın kendi store'undaki custom avatar.
    // Remote name ile aynı olanı eşler (oyuncuların kendi seçtikleri avatar).
    _makeAvatarSprite(name, team, avatarDataUrl) {
        const cacheKey = `mpAvatar:${name}`;
        const cached = this._avatarCache?.get(cacheKey);
        if (cached) return cached;
        // Only use the provided avatarDataUrl from network. No local fallback.
        let tex;
        const dataUrl = avatarDataUrl;
        if (dataUrl) {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            const ctx = c.getContext('2d');
            const img = new Image();
            img.onload = () => { ctx.drawImage(img, 0, 0, 64, 64); tex.needsUpdate = true; };
            img.src = dataUrl;
            tex = new THREE.CanvasTexture(c);
            try { ctx.drawImage(img, 0, 0, 64, 64); } catch (e) {}
        } else {
            // Fallback — emoji avatar yerine baş harf sprite
            const cb = document.createElement('canvas');
            cb.width = 64; cb.height = 64;
            const ctx = cb.getContext('2d');
            const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
            grd.addColorStop(0, team === 'red' ? '#ff99aa' : '#99ccff');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, 64, 64);
            ctx.lineWidth = 2;
            ctx.strokeStyle = team === 'red' ? '#ee5555' : '#5577dd';
            ctx.beginPath();
            ctx.arc(32, 32, 24, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = '700 28px Outfit';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((name || '?').charAt(0).toUpperCase(), 32, 34);
            tex = new THREE.CanvasTexture(cb);
        }
        tex.needsUpdate = true;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
        const sprite = new THREE.Sprite(mat);
        sprite.position.y = 3.1;
        sprite.scale.set(0.9, 0.9, 1);
        if (!this._avatarCache) this._avatarCache = new Map();
        this._avatarCache.set(cacheKey, sprite);
        return sprite;
    }

    _makeEmojiAvatar(name, team) {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        // background halo — takım rengi
        const grd = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
        grd.addColorStop(0, team === 'red' ? '#ff99aa' : '#99ccff');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, 64, 64);
        // Ring
        ctx.lineWidth = 2;
        ctx.strokeStyle = team === 'red' ? '#ee5555' : '#5577dd';
        ctx.beginPath();
        ctx.arc(32, 32, 24, 0, Math.PI * 2);
        ctx.stroke();
        // Initial of name
        ctx.fillStyle = '#fff';
        ctx.font = '700 28px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((name || '?').charAt(0).toUpperCase(), 32, 34);
        return c;
    }
}

// Avatar pixel color extraction — reads 16×16 skin data and applies to body parts
function _avatarFace(img) {
    const size = img.naturalWidth >= 64 ? 8 : img.naturalWidth;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (img.naturalWidth >= 64) ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
    else ctx.drawImage(img, 0, 0, size, size);
    return canvas;
}

function _applyAvatarColors(img, p, fallbackColor) {
    const size = img.naturalWidth >= 64 ? 64 : 16;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const avg = (x0, y0, w, h) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
            const i = (y * size + x) * 4;
            if (pixels[i + 3] > 128) { r += pixels[i]; g += pixels[i+1]; b += pixels[i+2]; n++; }
        }
        return n > 0 ? new THREE.Color(r/n/255, g/n/255, b/n/255) : null;
    };
    p._avatarBodyColors = size === 64 ? {
        body: avg(20, 20, 8, 12) || new THREE.Color(fallbackColor),
        arms: avg(44, 20, 4, 12) || new THREE.Color(fallbackColor),
        legs: avg(4, 20, 8, 12) || new THREE.Color(fallbackColor)
    } : {
        body: avg(0, 4, 16, 4) || new THREE.Color(fallbackColor),
        arms: avg(0, 8, 16, 4) || new THREE.Color(fallbackColor),
        legs: avg(0, 12, 16, 4) || new THREE.Color(fallbackColor)
    };
    if (size === 64) {
        const texturePart = (mesh, key, x, y, width, height) => {
            if (!mesh) return;
            const partCanvas = document.createElement('canvas');
            partCanvas.width = width;
            partCanvas.height = height;
            const partCtx = partCanvas.getContext('2d');
            partCtx.imageSmoothingEnabled = false;
            partCtx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
            const texture = new THREE.CanvasTexture(partCanvas);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            p._avatarPartTextures ||= {};
            p._avatarPartTextures[key]?.dispose?.();
            p._avatarPartTextures[key] = texture;
            if (!mesh.userData.avatarMaterial) {
                mesh.material = mesh.material.clone();
                mesh.userData.avatarMaterial = true;
            }
            mesh.material.map = texture;
            mesh.material.needsUpdate = true;
        };
        texturePart(p.bodyMesh, 'body', 20, 20, 8, 12);
        texturePart(p.leftArm, 'leftArm', 36, 52, 4, 12);
        texturePart(p.rightArm, 'rightArm', 44, 20, 4, 12);
        texturePart(p.leftLeg, 'leftLeg', 20, 52, 4, 12);
        texturePart(p.rightLeg, 'rightLeg', 4, 20, 4, 12);
    }
    _applyFromColors(p);
}

function _applyFromColors(p) {
    const c = p._avatarBodyColors;
    if (!c) { _applyTeamColor(p, p._teamColor); return; }
    const apply = (mesh, color) => {
        if (!mesh) return;
        if (mesh.material.map) mesh.material.color.setHex(0xffffff);
        else mesh.material.color.copy(color);
    };
    apply(p.bodyMesh, c.body);
    apply(p.leftArm, c.arms);
    apply(p.rightArm, c.arms);
    apply(p.leftLeg, c.legs);
    apply(p.rightLeg, c.legs);
}

function _applyTeamColor(p, hex) {
    if (p._avatarBodyColors) { _applyFromColors(p); return; }
    if (p.bodyMesh) p.bodyMesh.material.color.setHex(hex);
    if (p.leftArm) p.leftArm.material.color.setHex(hex);
    if (p.rightArm) p.rightArm.material.color.setHex(hex);
    if (p.leftLeg) p.leftLeg.material.color.setHex(hex);
    if (p.rightLeg) p.rightLeg.material.color.setHex(hex);
}
