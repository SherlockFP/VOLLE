// game.js — Full game: chat, team switch, death fx, minimap, aim deflection,
// damage ramp, skill system, map ban, damage meter, portal handling.
import * as THREE from 'three';
import { Ball } from './ball.js';
import { Bot } from './bot.js';
import { Scoreboard } from './scoreboard.js';
import { calcDamage, missRampDamage } from './characters.js';
import { Arena } from './arena.js';
import { Juice } from './juice.js';
import { applyMode, GAME_MODES } from './gamemodes.js';
import { EmoteSystem } from './emotes.js';
import { AffixManager } from './affixes.js';

const BASE_HIT_DAMAGE = 25;

export const STATES = {
    MENU: 'MENU', LOBBY: 'LOBBY', COUNTDOWN: 'COUNTDOWN',
    PLAYING: 'PLAYING', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER',
    CELEBRATION: 'CELEBRATION'
};

export class Game {
    constructor(renderer, player, arena, audio, ui, network) {
        this.renderer = renderer;
        this.player = player;
        this.arena = arena;
        this.audio = audio;
        this.ui = ui;
        this.network = network;

        this.state = STATES.MENU;
        this.ball = new Ball(renderer, arena);
        this.scoreboard = new Scoreboard();
        this.bots = [];
        this.remotePlayers = new Map();
        // Player name → remote-Avatar Sprite cache, böylece aynı oyuncu için sprite bir kez oluşur.
        this._avatarCache = new Map();

        this.roundRestartDelay = 4.0;
        this.roundRestartTimer = 0;
        this.preGameDuration = 10;       // saniye, host console'dan degistirebilir
        this.preGameTimer = 0;
        this.lastDeflector = null;
        this.lastDeflectorTeam = null;
        this.syncTimer = 0;
        this.syncRate = 0.05;

        this.playerName = 'Player';
        this.botCounter = 0;
        this.botDifficulty = 'hard';
        this.rallyCount = 0;

        // DMC-style kill combo tracker
        this.killStreak = 0;
        this._comboDisplayTimer = 0;

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
        this.mode = GAME_MODES.instagib; // ponytail: default instakill (HP'li seçilirse kapanır)
        this._oneHitKill = true;
        this._activeBlackHoles = [];
        this._killcamActive = false;
        this._killcamElapsed = 0;
        this._killcamDuration = 2.5;
        this._killcamKillerPos = null;
        this._killcamDeathPos = null;
        this._killcamKillerName = '';
        // Map voting
        this._mapVoteActive = false;
        this._mapVoteOptions = [];     // 3 mapId'ler
        this._mapVotes = new Map();    // peerId → mapId
        this._mapVoteTimer = null;
        this._mapVoteTimeout = 20;     // seconds
        this._mapVoteElapsed = 0;
        this.affixes = new AffixManager(this.arena, this.renderer.scene);

        // Power-up pickups — spawn on map, temporary buffs
        this.powerUps = [];
        this._powerUpTimer = 10 + Math.random() * 5;  // first spawn
        this._powerUpInterval = 12;  // seconds between spawns
        this._maxPowerUps = 3;
        this._playerBuffs = {}; // { speed: 0, shield: 0, damage: 0 } timer

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

    setState(s) {
        const prev = this.state;
        this.state = s;
        if (s === STATES.LOBBY || s === STATES.MENU) {
            if (prev !== STATES.LOBBY && prev !== STATES.MENU) this._startMusic();
        } else if (s === STATES.PLAYING || s === STATES.COUNTDOWN) {
            this._stopMusic();
        }
    }

    startSolo() {
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
        this.state = STATES.LOBBY;
        this._startMusic();
        this.updateLobbyUI();
    }

    addBot(team) {
        this.botCounter++;
        const name = `Bot-${this.botCounter}`;
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

    updateLobbyUI() {
        const ownAvatar = window.__store?.get?.('customAvatar')?.dataURL || null;
        const players = [{
            name: this.playerName,
            team: this.player.team,
            isBot: false,
            charId: this.player.charId,
            isYou: true,
            peerId: this.network?.peer?.id,
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
        this.remotePlayers.forEach((p, peerId) => players.push({
            name: p.name,
            team: p.team,
            isBot: false,
            charId: p.charId || 'rally',
            isYou: false,
            peerId,
            avatar: p.avatar || null
        }));
        // Lobby leader = host, or solo (not connected to anyone) → you lead.
        const isHost = !this.network || !this.network.connected || this.network.isHost;
        this.ui.updateLobbyPlayers(players, isHost);
    }

    startGame(skipPreGame = false) {
        this.setState(STATES.COUNTDOWN);
        // Lobby'de gösterilen bot dummy'leri oyun başlamadan temizle
        for (const [peerId, p] of this.remotePlayers) {
            if (p.isBotEntity) this.removeRemotePlayer(peerId);
        }
        this.scoreboard.reset();
        // ponytail: force full reset — clear all players and re-register from current entities
        this.scoreboard.players.clear();
        this.scoreboard.addPlayer(this.playerName, this.player.team, { isYou: true });
        this.bots.forEach(b => this.scoreboard.addPlayer(b.name, b.team, { isBot: true }));
        this.remotePlayers.forEach((p, peerId) => {
            this.scoreboard.addPlayer(p.name, p.team, { peerId });
            const spawn = this.arena.getPlayerSpawn(p.team);
            p.position.copy(spawn);
            p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
            p.group.rotation.y = p.team === 'red' ? 0 : Math.PI;
            p.alive = true;
            p.group.visible = true;
            p.hp = p.maxHp;
        });
        this.rallyCount = 0;
        this.killStreak = 0;
        this._spectateTarget = null;
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

    startRound() {
        this.clearBlackHoles();
        this._hideKillcam();
        this.setState(STATES.PLAYING);
        this.scoreboard.newRound();
        if (this.affixes) this.affixes.startRound();
        this._clearAllPowerUps();
        this.ball.spawn();
        this.lastDeflector = null;
        this.lastDeflectorTeam = null;
        this._deflectHistory = []; // son 2 deflector (assist için)
        this.rallyCount = 0;
        // ponytail: killStreak sadece yeni oyunda reset — FIRST BLOOD her round'da değil
        this._spectateTarget = null;
        // ponytail fix: sadece ölü oyuncuları revive et — HP'si düşenler resetlenmesin
        if (!this.player.alive) this.player.revive();
        this.bots.forEach(b => { if (!b.alive) { b.alive = true; b.respawn(); } });
        this.remotePlayers.forEach(p => {
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
        const targets = this.getAllTargets();
        if (targets.length) {
            const first = targets[Math.floor(Math.random() * targets.length)];
            setTimeout(() => {
                if (this.ball.active) {
                    this.ball.setTarget(first);
                    this.ball.state = 'homing';
                }
            }, 700);
        }
        this.ui.showMessage(`Round ${this.scoreboard.roundNum}`, 1500);
        // P2P: round start state'i tüm client'lara bildiriyoruz, böylece istemciler eşzamanlı başlar.
        if (this.network?.isHost) {
            this.network.broadcastRoundStart(this.snapshotState());
        }
    }

    // Rebuild the arena as a different map (called from the lobby).
    selectMap(mapId) {
        if (this.state !== STATES.LOBBY && this.state !== STATES.MENU) return;
        if (this.arena.mapId === mapId) return;
        this.arena.rebuild(mapId);
        this.player.respawn();
        this.bots.forEach(b => b.respawn());
        this.ui.showMessage(`Arena: ${this.arena.config.name}`, 1400);
        if (this.network?.isHost) {
            this.network.broadcast({ type: 'mapChange', mapId });
        }
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
        this.ui.showMessage?.(`Mode: ${this.mode.name}`, 1400);
        if (this.network?.isHost) {
            this.network.broadcast({ type: 'modeChange', modeId });
        }
    }

    // Emote göster (player veya bot için).
    showEmote(entity, emoteId) {
        this.emotes.show(entity, emoteId);
    }

    getAllTargets() { return [this.player, ...this.bots, ...this.remotePlayers.values()]; }

    addRemotePlayer(peerId, name = 'Player', team, avatarDataUrl = null) {
        if (!peerId || peerId === this.network?.peer?.id) return null;
        let p = this.remotePlayers.get(peerId);
        if (p) {
            // Re-update avatar only if it changed (first sync may have emoji fallback only).
            if (avatarDataUrl && p.avatar !== avatarDataUrl) {
                p.avatar = avatarDataUrl;
                // Update Minecraft head texture
                if (p.setAvatarTexture) p.setAvatarTexture(avatarDataUrl);
                // Update floating avatar sprite
                if (p.avatarSprite) {
                    p.group.remove(p.avatarSprite);
                    p.avatarSprite.material.map?.dispose();
                    p.avatarSprite.material.dispose();
                    p.avatarSprite = this._makeAvatarSprite(p.name, p.team, avatarDataUrl);
                    p.group.add(p.avatarSprite);
                }
            }
            return p;
        }
        const counts = { red: 0, blue: 0 };
        this.getPlayerList().forEach(pl => { counts[pl.team] = (counts[pl.team] || 0) + 1; });
        team = team || (counts.red <= counts.blue ? 'red' : 'blue');
        p = this._createRemotePlayer(peerId, name, team, avatarDataUrl);
        this.remotePlayers.set(peerId, p);
        this.scoreboard.addPlayer(name, team, { peerId });
        this.updateLobbyUI?.();
        return p;
    }

    removeRemotePlayer(peerId) {
        const p = this.remotePlayers.get(peerId);
        if (!p) return;
        this.renderer.scene.remove(p.group);
        this.scoreboard.removePlayer(p.name);
        this.remotePlayers.delete(peerId);
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
            img.onload = () => { headTexture.needsUpdate = true; };
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

        // Avatar sprite — floating above head as nameplate
        const avatarSprite = this._makeAvatarSprite(name, team, avatarDataUrl);
        group.add(avatarSprite);

        this.renderer.scene.add(group);
        const p = {
            peerId, name, team, group,
            headMesh, bodyMesh, leftArm, rightArm, leftLeg, rightLeg,
            position: this.arena.getPlayerSpawn(team).clone(),
            // Interpolasyon için: snapshotlar arasında lerp. prevPos → targetPos.
            prevPos: this.arena.getPlayerSpawn(team).clone(),
            targetPos: this.arena.getPlayerSpawn(team).clone(),
            interpAlpha: 1,
            velocity: new THREE.Vector3(), radius: 0.7, alive: true,
            hp: 100, maxHp: 100, shield: 0, consecutiveMisses: 0,
            runeBonuses: {}, deflectPower: 1, passive: 'none', totalDamageDealt: 0,
            attacking: false, attackTimer: 0, aimDir: new THREE.Vector3(0, 0, -1),
            labelSprite, avatarSprite, avatar: avatarDataUrl || null,
            getPosition() { return this.position.clone(); },
            getAimDirection() { return this.aimDir.clone(); },
            isAttacking() { return this.attacking; },
            recordDamageDealt(amount) { this.totalDamageDealt += amount; },
            onMissDeflect() { this.consecutiveMisses++; },
            onSuccessfulDeflect() { this.consecutiveMisses = 0; },
            drawHpBar() {},
            takeDamage(amount) { this.hp = Math.max(0, this.hp - amount); return this.hp <= 0; },
            revive() { this.alive = true; this.hp = this.maxHp; this.consecutiveMisses = 0; this.group.visible = true; },
            setTeam(nextTeam) {
                this.team = nextTeam;
                const c = nextTeam === 'red' ? 0xcc3333 : 0x3355cc;
                if (this.bodyMesh) this.bodyMesh.material.color.setHex(c);
                if (this.leftArm) this.leftArm.material.color.setHex(c);
                if (this.rightArm) this.rightArm.material.color.setHex(c);
                if (this.leftLeg) this.leftLeg.material.color.setHex(c);
                if (this.rightLeg) this.rightLeg.material.color.setHex(c);
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
                    img.onload = () => { tex.needsUpdate = true; };
                    this.headMesh.material.map = tex;
                    this.headMesh.material.color.setHex(0xffffff);
                } else {
                    this.headMesh.material.map = null;
                    this.headMesh.material.color.setHex(0xffd0aa);
                }
                this.headMesh.material.needsUpdate = true;
            }
        };
        group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
        return p;
    }

    getEnemyTargets(team, self = null) {
        if (this._ffa) return this.getAllTargets().filter(p => p !== self && p.alive);
        return this.getAllTargets().filter(p => p.team !== team);
    }

    // Tüm takımın ölü olup olmadığını kontrol et.
    // Ölen takımın karşı tarafına puan verir. İki takım da ölürse draw.
    _checkTeamElimination() {
        const all = this.getAllTargets();
        const redAlive = all.filter(p => p.alive && p.team === 'red');
        const blueAlive = all.filter(p => p.alive && p.team === 'blue');
        let winner = null;
        if (redAlive.length === 0 && blueAlive.length > 0) {
            this.scoreboard.blueScore++;
            this.ui.showMessage?.('🔵 BLUE TEAM WINS THE ROUND!', 2000);
            winner = 'blue';
        } else if (blueAlive.length === 0 && redAlive.length > 0) {
            this.scoreboard.redScore++;
            this.ui.showMessage?.('🔴 RED TEAM WINS THE ROUND!', 2000);
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
        return best || this.getClosestEnemy(fromPos, team);
    }

    // --- MAIN LOOP ---

    update(dt) {
        // P2P guard: bağlı ama host olmayan client'lar authoritative simülasyonu
        // ÇALIŞTIRMAZ. Top fiziği, hit detection, round logic sadece host'ta.
        // Client sadece render + remote interpolation + HUD yapar.
        const isClient = this.network && this.network.connected && !this.network.isHost;
        if (isClient && this.state === STATES.PLAYING) {
            this.updateDeathParticles(dt);
            this.updateChatBubbles(dt);
            this.arena.update(performance.now() / 1000);
            // Client yine de minimap'i güncellemeli ki remote player'ları görsün
            this.updateMinimap();
            // Power-up pickup görseli client'ta da dönsün
            for (const pu of this.powerUps) {
                pu.mesh.rotation.y += dt * 2;
                pu.mesh.position.y = 0.6 + Math.sin(pu.time + performance.now() * 0.003) * 0.15;
            }
            return;
        }

        // Juice: hit-stop/slow-mo/screen shake uygula, effective dt döndür
        const effectiveDt = this.juice.update(dt);
        if (effectiveDt === 0 && this.state !== STATES.CELEBRATION) return; // hit-stop: dünya donar (ama celebration'da değil)
        dt = effectiveDt || dt;

        // Time scale (console: sv_timescale)
        if (this._timeScale && this._timeScale !== 1) dt *= this._timeScale;

        // Active black holes — gravitational pull & visual update
        this.updateBlackHoles(dt);

        // Emote sprite'ları güncelle
        this.emotes.update(dt);

        if (this.state === STATES.PLAYING) {
            this.updatePlaying(dt);
        } else if (this.state === STATES.CELEBRATION) {
            this._celebrationTimer -= dt;
            // Only update timer message every second (not every frame)
            if (Math.floor(this._celebrationTimer) !== this._lastCelebSec) {
                this._lastCelebSec = Math.floor(this._celebrationTimer);
                this.ui.showMessage?.(`🎉 ${Math.ceil(this._celebrationTimer)}s`, 900);
            }

            // Weapon switch 1/2/3 — gloves / pistol / rocket
            const CELEB_WEAPONS = {
                fists:  { name: '🥊 GLOVES', dmg: 50,  range: 3.5, splash: 0, glove: this.player.team === 'red' ? 0xee5555 : 0x5577dd },
                pistol: { name: '🔫 PISTOL', dmg: 34,  range: 14,  splash: 0, glove: 0x888888 },
                rocket: { name: '🚀 ROCKET', dmg: 100, range: 20,  splash: 6, glove: 0xff8800 },
            };
            if (!this._celebWeapon) this._celebWeapon = 'fists';
            const prevW = this._celebWeapon;
            // Manual weapon selection with 1/2/3 keys
            if (this.player.keys['Digit1']) this._celebWeapon = 'fists';
            if (this.player.keys['Digit2']) this._celebWeapon = 'pistol';
            if (this.player.keys['Digit3']) this._celebWeapon = 'rocket';
            const weapon = CELEB_WEAPONS[this._celebWeapon];
            if (this._celebWeapon !== prevW) {
                if (this.player.gloveMat) this.player.gloveMat.color.setHex(weapon.glove);
                this._showCelebWeapon(this._celebWeapon);
            }
            const wh = document.getElementById('celeb-weapon-hud');
            if (wh) { wh.textContent = `${weapon.name}  [1/2/3]`; wh.style.display = ''; }

            // Winner attacks losers with the selected weapon
            if (this.player.attacking && this.player.team === this._winningTeam) {
                this._playWeaponSound(this._celebWeapon);
                this._spawnMuzzleFlash(this._celebWeapon);
                const ppos = this.player.getPosition();
                let best = null, bestDist = weapon.range;
                for (const bot of this.bots) {
                    if (!bot.alive || bot.team === this._winningTeam) continue;
                    const d = ppos.distanceTo(bot.getPosition());
                    if (d < bestDist) { bestDist = d; best = bot; }
                }
                if (best) {
                    // Primary + splash targets (rocket)
                    const bpos = best.getPosition().clone();
                    const targets = [best];
                    if (weapon.splash > 0) {
                        for (const bot of this.bots) {
                            if (bot === best || !bot.alive || bot.team === this._winningTeam) continue;
                            if (bot.getPosition().distanceTo(bpos) < weapon.splash) targets.push(bot);
                        }
                    }
                    for (const t of targets) {
                        const lethal = t.takeDamage?.(weapon.dmg);
                        const tp = t.getPosition().clone();
                        const sp = tp.clone().project(this.player.camera);
                        const sx = (sp.x * 0.5 + 0.5) * window.innerWidth;
                        const sy = (-sp.y * 0.5 + 0.5) * window.innerHeight;
                        this.ui.spawnDamageNumber(sx, sy, weapon.dmg, lethal);
                        if (lethal) {
                            t.alive = false;
                            t.group.visible = false;
                            this.spawnDeathExplosion(tp, t.team);
                            this.juice.burst(tp, 0xff0000, 24, 16); // blood everywhere
                        } else {
                            this.juice.burst(tp, 0xff0000, 8, 6);
                        }
                    }
                    // Roket patlaması — büyük patlama efekti
                    if (weapon.splash > 0) {
                        this._spawnExplosion(bpos, 0xff6600, 40);
                        this.juice.shake(0.8);
                    }
                    this._playBoo();
                    this.juice.shake(weapon.splash > 0 ? 0.5 : 0.3);
                }
                this.player.attacking = false;
            }
            // Bots participate during celebration
            this.bots.forEach(bot => {
                if (!bot.alive) return;
                const isWinner = bot.team === this._winningTeam;
                // Find nearest opposite team bot
                const enemies = this.bots.filter(b => b.alive && b.team !== bot.team);
                if (enemies.length > 0) {
                    const closest = enemies.reduce((a, b) => {
                        const da = bot.position.distanceTo(a.getPosition());
                        const db = bot.position.distanceTo(b.getPosition());
                        return da < db ? a : b;
                    });
                    const dist = bot.position.distanceTo(closest.getPosition());
                    if (isWinner) {
                        // Winners chase
                        bot.position.lerp(closest.getPosition(), Math.min(1, 3 * dt / Math.max(dist, 1)));
                        if (dist < 2.5 && closest.takeDamage?.(6)) {
                            closest.alive = false;
                            closest.group.visible = false;
                            this.spawnDeathExplosion(closest.getPosition(), closest.team);
                        }
                    } else {
                        // Losers flee
                        const away = new THREE.Vector3().subVectors(bot.position, closest.getPosition()).normalize();
                        bot.position.add(away.multiplyScalar(8 * dt));
                    }
                }
                bot.update(dt, null);
            });

            if (this._celebrationTimer <= 0) this._onCelebrationEnd();
        } else if (this.state === STATES.ROUND_END) {
            this.roundRestartTimer -= dt;
            const curSec = Math.ceil(this.roundRestartTimer);
            if (curSec !== this._lastRoundEndSec) {
                this._lastRoundEndSec = curSec;
                this.ui.showMessage?.(`⏳ Next round in ${curSec}s`, 500);
            }
            if (this.roundRestartTimer <= 0) {
                if (this.scoreboard.isTimeUp() || this.scoreboard.isMaxRounds()) {
                    this.endGame();
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

        this.arena.update(performance.now() / 1000);

        // Map voting countdown (host-side)
        if (this._mapVoteActive && this.network?.isHost) {
            this._mapVoteElapsed += dt;
            if (this._mapVoteElapsed >= this._mapVoteTimeout) {
                this._finalizeMapVote();
            }
        }
    }

    updatePlaying(dt) {
        this.scoreboard.updateTimer(dt);
        if (this.scoreboard.isTimeUp()) { this.endGame(); return; }

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

        // Target outline — kimde sıra varsa kırmızı outline
        const target = this.ball.targetPlayer;
        this.bots.forEach(bot => {
            const isTarget = bot === target && this.ball.active;
            bot.setTargetOutline(isTarget);
        });
        // Player target indicator — incoming!
        this.ui.setPlayerTarget(target === this.player && this.ball.active);

        // Player skill tuşu (Q)
        if (this.player._skillQueued) {
            this.player._skillQueued = false;
            const ok = this.player.tryUseSkill({ ball: this.ball, target: this.ball.targetPlayer, game: this });
            if (ok) {
                const skillId = this.player.loadout.skill;
                this.ui.showMessage(`${skillId.toUpperCase()}!`, 800);
                this.audio.playSfx('tf2_medic', 0.35);
                this.audio.playBeep(660);
                if (skillId === 'blackhole') this.spawnBlackHole();
            }
        }

        this.bots.forEach(bot => {
            bot.update(dt, this.ball);
            if (bot._pendingBlackHole) {
                bot._pendingBlackHole = false;
                this.spawnBlackHole();
            }
        });
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
        if (this.player.alive && this.player.isAttacking() &&
            this.ball.isInAttackRange(this.player.getPosition())) {
            this.handlePlayerDeflection();
        }

        // Bot deflections — before ball moves
        this.bots.forEach(bot => {
            if (this.ball.active && bot.tryDeflect(this.ball, dt)) {
                this.handleBotDeflection(bot);
            }
        });

        const bounced = this.ball.update(dt);
        if (bounced) this.audio.playBounce();

        // Hit detection — body volume instead of single point.
        // Ball can hit anywhere: head, chest, abdomen, legs.
        // Aimed shots fly straight, so check EVERY enemy of the thrower's team in the
        // ball's path — you damage whoever you actually hit, not just an assigned target.
        if (this.ball.active) {
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
                // Clamp ball Y to body range [ground, head], measure 3D distance
                const bodyTop = headPos.y;
                const bodyBottom = headPos.y - 1.7;
                const clampedY = Math.max(bodyBottom, Math.min(bodyTop, ballPos.y));
                const dx = ballPos.x - headPos.x;
                const dz = ballPos.z - headPos.z;
                const dy = ballPos.y - clampedY;
                const bodyDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (bodyDist < this.ball.hitRange) {
                    this.handleHit(target);
                    return;
                }
            }
        }

        // HUD — damage meter dahil
        this.ui.updateHUD({
            time: this.scoreboard.getFormattedTime(),
            redScore: this.scoreboard.redScore,
            blueScore: this.scoreboard.blueScore,
            ballSpeed: this.ball.getSpeed(),
            round: this.scoreboard.roundNum,
            deflections: this.rallyCount
        });
        this.ui.updateVitals(this.player.hp, this.player.maxHp, this.player.shield,
            this.player.stamina, this.player.staminaMax, this.player.exhausted);
        this.ui.updateSkillCooldown?.(this.player.skillCooldowns, this.player.loadout.skill);

        // Power-up spawn/pickup
        this.updatePowerUps(dt);

        this.updateMinimap();
    }

    handlePlayerDeflection() {
        const pos = this.player.getPosition();
        const aimDir = this.player.getAimDirection();
        const team = this.player.team;

        // Skill check: must be roughly looking at the ball (~100° cone)
        const ballDir = new THREE.Vector3().subVectors(this.ball.position, pos).normalize();
        if (aimDir.dot(ballDir) < -0.2) return;

        // Pick the enemy closest to where you're looking
        const nextTarget = this.getAimedEnemy(pos, aimDir, team);
        const flick = this.player.getFlick();
        const momentum = this.player._frameVel;
        const result = this.ball.deflectWithAim(pos, aimDir, nextTarget, flick, momentum);
        if (nextTarget) this.ball.setTarget(nextTarget);

        // DeflectPower uygula (karakter + rune)
        if (this.player.deflectPower) {
            this.ball.velocity.multiplyScalar(this.player.deflectPower);
        }

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
        const isPerfect = this.ball.isPerfectCatch();
        if (isPerfect) {
            this.ball.lastPerfectBy = this.player;
            this.ball.velocity.multiplyScalar(1.3); // perfect = +30% hız
            this.juice.hitStop(60);      // kısa donma
            this.juice.shake(0.2);       // hafif shake
            this.juice.sparks(this.ball.position.clone(), 0xffee44, 12);
            this.juice.addCombo();
            const comboMul = this.juice.getComboMultiplier();
            this.ui.showMessage(`✨ PERFECT! x${this.juice.combo} combo`, 2500);
            this.audio.playSfx('tf2_crit', 0.55);
        } else {
            // Normal deflect — küçük spark
            this.juice.sparks(this.ball.position.clone(), 0xff8844, 6);
            this.juice.shake(0.08);
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
            this.ball.deflectWithAim(pos, aimDir, nextTarget, fakeFlick);
        } else {
            this.ball.deflect(pos, nextTarget.getPosition());
        }
        this.ball.setTarget(nextTarget);
        if (bot.deflectPower) this.ball.velocity.multiplyScalar(bot.deflectPower);

        // Bot pasifleri
        if (bot.passive === 'burn_touch') nextTarget._burnTimer = 2;
        if (bot.passive === 'chill_touch') nextTarget._chillTimer = 2;

        this.lastDeflector = bot;
        this.lastDeflectorTeam = bot.team;
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

    handleHit(hitTarget) {
        // P2P: host her hit'i client'lara yayınla (victim peerId ile)
        if (this.network?.isHost) {
            const victimPeerId = hitTarget.peerId || null;
            const victimName = hitTarget === this.player ? this.playerName : hitTarget.name;
            this.network.broadcast({
                type: 'playerHit', victimPeerId, victimName,
                hp: hitTarget.hp, alive: hitTarget.alive !== false
            });
        }
        const name = hitTarget === this.player ? this.playerName : hitTarget.name;
        const scorerName = this.lastDeflector
            ? (this.lastDeflector === this.player ? this.playerName : this.lastDeflector.name)
            : null;
        const attacker = this.lastDeflector;
        const shot = this.ball.lastShot;

        // Hasar hesapla: miss ramp + karakter deflectPower + pasifler + combo bonusu
        const base = missRampDamage(BASE_HIT_DAMAGE, hitTarget.consecutiveMisses);
        const comboMul = this.juice.getComboMultiplier();
        let dmg = calcDamage(Math.round(base * comboMul), attacker, hitTarget, shot);
        if (this._damageMul) dmg = Math.round(dmg * this._damageMul);
        if (this._oneHitKill) dmg = hitTarget.maxHp;
        const lethal = hitTarget.takeDamage(dmg);
        if (attacker) attacker.recordDamageDealt(dmg);
        // Scoreboard damage tracking
        if (scorerName) this.scoreboard.recordDamageDealt(scorerName, dmg);
        this.scoreboard.recordDamageTaken(name, dmg);

        // Get hit position early — used for damage number + juice
        const hitPos = hitTarget.getPosition();

        // Floating damage number — project 3D pos to screen
        const scrPos = hitPos.clone().project(this.player.camera);
        const sx = (scrPos.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-scrPos.y * 0.5 + 0.5) * window.innerHeight;
        this.ui.spawnDamageNumber(sx, sy, dmg, lethal);

        // Damage flash — player vurulunca ekran kızarır
        if (hitTarget === this.player) {
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

        // ponytail fix #2: target deflect'i kaçırdı → miss sayacı artar, bir sonraki hit daha çok acır
        hitTarget.onMissDeflect();

        // ponytail fix #3: thorns rune — vurana geri hasar
        if (hitTarget.runeBonuses?.thorns && attacker && attacker !== hitTarget) {
            attacker.takeDamage(hitTarget.runeBonuses.thorns);
            if (attacker.drawHpBar) attacker.drawHpBar();
        }

        this.scoreboard.recordHit(name);
        // ponytail: puanlar branch'lerde — hit 0.5, kill 2

        // Kill feed
        const missTag = hitTarget.consecutiveMisses >= 3 ? ' 💢CRITICAL' : hitTarget.consecutiveMisses >= 1 ? ` (x${hitTarget.consecutiveMisses+1} miss)` : '';
        const perfectTag = this.ball.lastPerfectBy === attacker ? ' ✨PERFECT' : '';
        this.killFeed.unshift({ attacker: scorerName, victim: name, dmg, time: performance.now()/1000, tag: missTag + perfectTag });
        if (this.killFeed.length > 5) this.killFeed.pop();
        this.ui.updateKillFeed?.(this.killFeed);

        // JUICE: hit-stop + shake + particles + slow-mo on KO
        this.juice.burst(hitPos, hitTarget.team === 'red' ? 0xff4444 : 0x4488ff, 16, 10);
        this.juice.shockwave(hitPos, 0xff8844);
        this.juice.shake(lethal ? 0.5 : 0.25);
        this.juice.hitStop(lethal ? 100 : 50);
        this.juice.flash(0.3);

        // Death explosion + TF2 audio
        this.spawnDeathExplosion(hitPos, hitTarget.team);
        this.audio.playSfx('tf2_explosion', 0.5);
        this.audio.playExplosion();
        if (hitTarget === this.player) {
            this.audio.playSfx('tf2_you_are_dead', 0.5);
            this.audio.playSfx('tf2_scout_scream', 0.45);
        }
        this.audio.playHit();

        if (lethal) {
            // Kill confirm sound when player scores
            if (hitTarget !== this.player) this.audio.playSfx('tf2_notification', 0.4);
            // KO — slow-mo dramatik an
            this.juice.slowMo(0.25, 0.8);
            this.juice.burst(hitPos, 0xffee44, 24, 14);
            if (hitTarget === this.player) {
                this.player.die();
                this.ui.flashHit();
                // Save killer position for killcam camera
                if (attacker) {
                    const kp = attacker.getPosition();
                    this._killcamKillerPos = kp instanceof THREE.Vector3 ? kp.clone() : new THREE.Vector3(kp.x, kp.y, kp.z);
                } else {
                    // Fallback: ball direction from death pos
                    this._killcamKillerPos = this.ball.position.clone();
                }
                this._killcamDeathPos = this.player.getPosition();
                // Killcam with camera switch + direction indicator
                this._showKillcam(scorerName || (this.ball.lastShotBy || 'Unknown'));
                // Start spectating a teammate
                const aliveTeammates = this.bots.filter(b => b.alive && b.team === this.player.team);
                if (aliveTeammates.length > 0) {
                    this._spectateTarget = aliveTeammates[0];
                }
            } else {
                hitTarget.alive = false;
            }
            this.ball.deactivate();

            // DMC-style kill combo + TF2 announcer
            this.killStreak++;
            const comboNames = ['', 'FIRST BLOOD', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTA KILL', 'ACE'];
            const comboSounds = ['', 'music/1kill.sfx', 'music/2kill.sfx', 'music/3kill.sfx', 'music/4kill.sfx', 'music/4kill.sfx', 'music/ace.sfx'];
            const tf2ComboSounds = ['', 'tf2_domination', 'tf2_crit', 'tf2_victory', 'tf2_victory', 'tf2_victory', 'tf2_victory'];
            const idx = Math.min(this.killStreak, 6);
            const comboName = comboNames[idx] || '';
            if (comboName) {
                this._playComboSound(comboSounds[idx]);
                if (tf2ComboSounds[idx]) this.audio.playSfx(tf2ComboSounds[idx], 0.5);
                this.ui.showCombo(comboName, 8.0);
            }
            const rallyMsg = this.rallyCount > 2 ? ` (${this.rallyCount} rally!)` : '';
            this.ui.showMessage(`💥 ${name} KO'd!${rallyMsg}${missTag}${perfectTag}`, 2000);
            if (scorerName) this.scoreboard.recordPoint(scorerName, 1); // ponytail: kill = 1 puan
            this.scoreboard.recordDeath(name); // victim death
            // Assist: son 2 deflector'a (scorer dışında) assist ver
            const assistCandidates = this._deflectHistory.filter(n => n !== scorerName);
            const seen = new Set();
            assistCandidates.forEach(a => { if (a && !seen.has(a)) { seen.add(a); this.scoreboard.recordAssist(a); } });
            this.juice.resetCombo();

            // Takım eleme kontrolü — round sadece tüm takım ölünce biter
            if (this._checkTeamElimination()) {
                this.setState(STATES.ROUND_END);
                this.roundRestartTimer = this.roundRestartDelay;
            } else {
                // ponytail: takım hâlâ yaşıyorsa top yeniden spawn — oyun devam
                this._respawnBall();
            }
        } else {
            // Ölmüyorsa — hasar alındı, top reset. HP bar kalıcı, resetlenmez.
            this.ball.deactivate();
            if (hitTarget.drawHpBar) hitTarget.drawHpBar();
            this.ui.updateVitals?.(this.player.hp, this.player.maxHp, this.player.shield,
                this.player.stamina, this.player.staminaMax, this.player.exhausted);
            this.ui.showMessage(`💥 ${name} -${dmg} HP${missTag}${perfectTag}`, 1500);
            if (scorerName) this.scoreboard.recordPoint(scorerName, 0.5); // ponytail: hit = 0.5 puan
            // ponytail: non-lethal hit — top yeniden spawn, oyun devam
            this._respawnBall();
        }
    }

    // Son 2 deflector'ı hatırla (assist credit için)
    _pushDeflectHistory(name) {
        this._deflectHistory.push(name);
        if (this._deflectHistory.length > 3) this._deflectHistory.shift();
    }

    // ponytail: hit sonrası topu 3sn gecikmeyle doğur — üstte geri sayım
    _respawnBall() {
        if (this.state !== STATES.PLAYING) return;
        let t = 3;
        this.ui.showMessage(`🏐 Ball returns in ${t}...`, 900);
        const tick = () => {
            if (this.state !== STATES.PLAYING) return;
            t--;
            if (t > 0) {
                this.ui.showMessage(`🏐 Ball returns in ${t}...`, 900);
                setTimeout(tick, 1000);
            } else {
                if (this.ball.active) return; // başka kaynaktan zaten aktifse atlama
                this.ball.spawn();
                this.lastDeflector = null;
                this.lastDeflectorTeam = null;
                const targets = this.getAllTargets().filter(p => p.alive);
                if (targets.length) {
                    const next = targets[Math.floor(Math.random() * targets.length)];
                    this.ball.setTarget(next);
                    this.ball.state = 'homing';
                }
            }
        };
        setTimeout(tick, 1000);
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
        this.chatMessages.push({ name, text, time: Date.now() });
        if (this.chatMessages.length > 50) this.chatMessages.shift();
        this.ui.addChatMessage(name, text);
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

    sendChat(text) {
        if (!text.trim()) return;
        this.addChatMessage(this.playerName, text);
        // Bubble above the local player's head (visible in 3rd person / to others).
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
        // Decrement buff timers
        for (const k of ['speed', 'shield', 'damage']) {
            if (this._playerBuffs[k] > 0) {
                this._playerBuffs[k] -= dt;
                if (this._playerBuffs[k] <= 0) this._clearBuff(k);
            }
        }

        // Rotate power-up meshes
        for (const pu of this.powerUps) {
            pu.mesh.rotation.y += dt * 2;
            pu.mesh.position.y = 0.6 + Math.sin(pu.time + performance.now() * 0.003) * 0.15;
        }

        // Spawn timer
        this._powerUpTimer -= dt;
        if (this._powerUpTimer <= 0 && this.powerUps.length < this._maxPowerUps) {
            this.spawnPowerUp();
            this._powerUpTimer = this._powerUpInterval + Math.random() * 5;
        }

        // Pickup check
        const pp = this.player.getPosition();
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const pu = this.powerUps[i];
            const dx = pp.x - pu.x, dz = pp.z - pu.z;
            if (Math.sqrt(dx*dx + dz*dz) < 2.0) {
                this._applyBuff(pu.type);
                this.renderer.scene.remove(pu.mesh);
                pu.mesh.geometry?.dispose();
                pu.mesh.material?.dispose();
                this.powerUps.splice(i, 1);
                this.ui.showMessage?.(`${pu.label} picked up!`, 1200);
            }
        }
    }

    spawnPowerUp() {
        const types = ['speed', 'shield', 'damage'];
        const type = types[Math.floor(Math.random() * types.length)];
        const labels = { speed: '⚡ Speed Boost', shield: '🛡️ Shield', damage: '💥 Power' };
        const colors = { speed: 0xffee00, shield: 0x44aaff, damage: 0xff4444 };

        // Random position on the court floor
        const bx = this.arena.bounds;
        const x = bx.minX + Math.random() * (bx.maxX - bx.minX);
        const z = bx.minZ + Math.random() * (bx.maxZ - bx.minZ);

        const geo = new THREE.SphereGeometry(0.4, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: colors[type], transparent: true, opacity: 0.85 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 1.2, z);
        this.renderer.scene.add(mesh);

        this.powerUps.push({ type, mesh, x, z, time: performance.now(), label: labels[type] });
    }

    _applyBuff(type) {
        this._playerBuffs[type] = 6; // 6 seconds
        if (type === 'speed') this.player.speed = this.player._baseSpeed * 1.4;
        if (type === 'shield') this.player.shield += 30;
        if (type === 'damage') this._damageMul = 1.5;
    }

    _clearBuff(type) {
        if (type === 'speed') this.player.speed = this.player._baseSpeed;
        if (type === 'damage') this._damageMul = null;
    }

    _clearAllPowerUps() {
        for (const pu of this.powerUps) {
            this.renderer.scene.remove(pu.mesh);
            pu.mesh.geometry?.dispose();
            pu.mesh.material?.dispose();
        }
        this.powerUps = [];
        this._playerBuffs = {};
        this._damageMul = null;
        this.player.speed = this.player._baseSpeed;
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
        const winner = this.scoreboard.getWinner();
        const stats = this.scoreboard.getPlayerStats();
        this.clearBlackHoles();
        if (this.affixes) this.affixes.clearRound();
        this.audio.playSfx('tf2_domination', 0.55);
        this.audio.playScore();

        // 30 second celebration — winners punch losers, no menu
        this.state = STATES.CELEBRATION;
        this._celebrationTimer = 30;
        this._winningTeam = winner === 'RED' ? 'red' : winner === 'BLUE' ? 'blue' : null;
        this._won = this._winningTeam !== null && this.player.team === this._winningTeam;

        // Winner/loser TF2 anouncer
        if (this._won) {
            this.audio.playSfx('tf2_victory', 0.55);
        } else {
            this.audio.playSfx('tf2_you_failed', 0.5);
        }
        this._finalStats = stats;
        this._finalWinner = winner;

        // Keep ball inactive, let players move — keep mouse captured for celebration
        this.ball.deactivate();
        this.player.lock();
        // Kaybedenler kaçabilir ama vuramaz
        this.player._celebNoAttack = (this.player.team !== this._winningTeam);
        this.ui.setPlayerTarget(false);
        this.bots.forEach(bot => bot.setTargetOutline(false));

        // Show first-person glove viewmodel for the punch/weapon fun
        this._celebWeapon = 'fists';
        this._prevHandVisible = this.player.armGroup?.visible ?? false;
        this.player.setHandVisible?.(true);
        if (this.player.gloveMat) {
            this.player.gloveMat.color.setHex(this.player.team === 'red' ? 0xee5555 : 0x5577dd);
        }
        this._buildCelebWeapons();
        this._showCelebWeaponHUD?.('fists');
        const wh = document.getElementById('celeb-weapon-hud');
        if (wh) wh.style.display = 'block';
        this.ui.showMessage?.('🥊 STRESS RELIEF! 1 Gloves · 2 Pistol · 3 Rocket', 4000);

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

    _buildCelebWeapons() {
        const cam = this.player.camera;
        if (!cam) return;
        // Remove old weapon meshes
        if (this._celebWpnMeshes) {
            Object.values(this._celebWpnMeshes).forEach(m => cam.remove(m));
        }
        this._celebWpnMeshes = {};

        // Pistol — görünür silah modeli (Half-Life tarzı)
        const pistol = new THREE.Group();
        // Gövde
        const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.28), new THREE.MeshBasicMaterial({ color: 0x444444 }));
        pBody.position.z = -0.02;
        pistol.add(pBody);
        // Namlu
        const pBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0x222222 }));
        pBarrel.rotation.x = Math.PI / 2;
        pBarrel.position.set(0, 0, -0.28);
        pistol.add(pBarrel);
        // Tetik
        const pTrigger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x333333 }));
        pTrigger.position.set(0, -0.12, 0.06);
        pistol.add(pTrigger);
        pistol.position.set(0.25, -0.2, -0.45);
        cam.add(pistol);
        this._celebWpnMeshes.pistol = pistol;

        // Rocket — büyük kırmızı roket
        const rocket = new THREE.Group();
        const rBody = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xcc3333 }));
        rBody.rotation.x = Math.PI / 2;
        rocket.add(rBody);
        const rNose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.15, 8), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
        rNose.rotation.x = Math.PI / 2;
        rNose.position.set(0, 0, -0.28);
        rocket.add(rNose);
        // Arka kanatçıklar
        for (let i = 0; i < 3; i++) {
            const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.1, 0.08), new THREE.MeshBasicMaterial({ color: 0xff6600 }));
            const a = (i / 3) * Math.PI * 2;
            fin.position.set(Math.cos(a) * 0.14, 0, 0.18);
            fin.rotation.y = a;
            rocket.add(fin);
        }
        rocket.position.set(0.25, -0.2, -0.5);
        cam.add(rocket);
        this._celebWpnMeshes.rocket = rocket;

        // Başlangıçta gizle (fists = gloves görünür)
        pistol.visible = false;
        rocket.visible = false;
    }

    _showCelebWeapon(weaponId) {
        if (!this._celebWpnMeshes) return;
        Object.keys(this._celebWpnMeshes).forEach(k => {
            this._celebWpnMeshes[k].visible = (k === weaponId);
        });
        // Silah seçilince el/diveni gizle (Half-Life tarzı)
        const hasWeapon = weaponId !== 'fists';
        if (this.player.handMesh) this.player.handMesh.visible = !hasWeapon;
        if (this.player.gloveMesh) this.player.gloveMesh.visible = !hasWeapon;
        this._showCelebWeaponHUD(weaponId);
    }

    _showCelebWeaponHUD(weaponId) {
        const el = document.getElementById('celeb-weapon-hud');
        if (!el) return;
        const names = { fists: 'KNUCKLES', pistol: 'PISTOL', rocket: 'ROCKET' };
        el.textContent = names[weaponId] || weaponId.toUpperCase();
    }

    _playWeaponSound(type) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.06;
            if (type === 'fists') {
                osc.type = 'square';
                osc.frequency.value = 80 + Math.random() * 40;
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
            } else if (type === 'pistol') {
                osc.type = 'sawtooth';
                osc.frequency.value = 900 + Math.random() * 300;
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
            } else if (type === 'rocket') {
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
        this.state = STATES.GAME_OVER;
        this.player.unlock(); // free mouse for XP screen buttons
        this.player._celebNoAttack = false; // attack restriction cleared
        const gm = document.getElementById('game-message');
        if (gm) gm.classList.add('hidden');
        const wh = document.getElementById('celeb-weapon-hud');
        if (wh) wh.style.display = 'none';
        // Restore viewmodel to its pre-celebration state
        this.player.setHandVisible?.(this._prevHandVisible);
        if (this.player.handMesh) this.player.handMesh.visible = true;
        if (this.player.gloveMesh) this.player.gloveMesh.visible = true;
        // Clean up weapon meshes
        if (this._celebWpnMeshes && this.player.camera) {
            Object.values(this._celebWpnMeshes).forEach(m => this.player.camera.remove(m));
        }
        this._celebWpnMeshes = {};
        const kills = this.player.totalDamageDealt > 0 ? Math.floor(this.player.totalDamageDealt / 25) : 0;
        // Win pays ~5x a loss; losers still earn a small consolation.
        const xp = this._won ? 400 + kills * 30 : 80 + kills * 8;
        const winnerText = this._finalWinner === 'DRAW'
            ? `DRAW: Red ${this.scoreboard.redScore} - ${this.scoreboard.blueScore} Blue`
            : `${this._finalWinner} TEAM WINS: Red ${this.scoreboard.redScore} - ${this.scoreboard.blueScore} Blue`;
        const playerStats = this.scoreboard.getPlayerStats();
        this.ui.showPostGame(this._won, xp, 1, kills, this.rallyCount, this.audio, { winnerText, playerStats });
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
        const kc = document.getElementById('killcam');
        if (!kc) return;
        kc.classList.remove('visible');
        kc.classList.add('hidden');
        if (this._killcamTimer) { clearTimeout(this._killcamTimer); this._killcamTimer = null; }
        this._killcamActive = false;
        this.player.killcamLock = false;
        this._killcamKillerPos = null;
        this._killcamDeathPos = null;
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
            charId: this.player.charId,
            avatar: ownAvatar
        }];
        this.bots.forEach(b => list.push({ name: b.name, team: b.team, isBot: true, charId: b.charId }));
        this.remotePlayers.forEach((p, peerId) => list.push({ name: p.name, team: p.team, isBot: !!p.isBotEntity, peerId, charId: p.charId || 'rally', avatar: p.avatar || null }));
        return list;
    }

    updateRemotePlayer(peerId, data) {
        if (peerId === this.network?.peer?.id) return;
        const p = this.addRemotePlayer(peerId, data.name || `P-${peerId.slice(0, 4)}`, data.team);
        if (!p) return;
        // Snapshot: snapshot'taki poz önceki prevPos olur, hedef targetPos olur. Render tarafı
        // her frame invokeSnapshots(dt) ile bunlar arasında lerp ediyor — atlayış / dithering yok.
        p.prevPos.set(p.position.x, p.position.y, p.position.z);
        p.targetPos.set(data.x, data.y, data.z);
        p.interpAlpha = 0;
        p.lastPacketTime = data.clientTime || performance.now();
        p.group.rotation.y = data.ry || 0;
        p.team = data.team || p.team;
        p.alive = data.alive !== false;
        p.group.visible = p.alive;
        p.hp = data.hp ?? p.hp;
        if (data.charId) p.charId = data.charId;
        if (data.ax !== undefined) p.aimDir.set(data.ax, data.ay, data.az).normalize();
        // Fallback relay: client sends position via mesh, but host ALWAYS relays
        // so positions arrive even if mesh fails.
        if (this.network?.isHost) {
            this.network.broadcast({ ...data, type: 'position', peerId });
        }
    }

    // Her frame'de çağrılır — remote player'ların pozisyonlarını lerp ile
    // interpolate eder (30Hz snapshot aktarımı akıcı görülür).
    invokeRemoteSnapshots(dt) {
        if (!this.remotePlayers.size) return;
        for (const p of this.remotePlayers.values()) {
            if (!p.targetPos) continue;
            const dx = p.targetPos.x - p.position.x;
            const dy = p.targetPos.y - p.position.y;
            const dz = p.targetPos.z - p.position.z;
            const distSq = dx*dx + dy*dy + dz*dz;
            if (distSq > 25) {
                // >5m teleport: packet loss recovery
                p.position.copy(p.targetPos);
            } else if (distSq > 0.0001) {
                // Exponential smoothing: position ~20% closer every frame at 60fps
                // No stop/go stutter, handles variable packet rate naturally
                const factor = 1 - Math.exp(-dt * 12);
                p.position.x += dx * factor;
                p.position.y += dy * factor;
                p.position.z += dz * factor;
            }
            p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
        }
    }

    remoteAttack(peerId, data = {}) {
        if (!this.network?.isHost) return;
        let p = this.remotePlayers.get(peerId);
        if (!p) {
            // Attack position'dan önce geldi — remote player'ı anında oluştur
            if (!data.name || data.x === undefined) return;
            p = this.addRemotePlayer(peerId, data.name, data.team);
            if (!p) return;
            p.position.set(data.x, data.y, data.z);
            p.targetPos?.set(data.x, data.y, data.z);
        }
        if (!p.alive || !this.ball.active) return;
        p.aimDir.set(data.ax ?? p.aimDir.x, data.ay ?? p.aimDir.y, data.az ?? p.aimDir.z).normalize();
        p.attacking = true;
        p.attackTimer = 0.3;
        // Gelen pozisyonu kullan (interpolated değil, client'ın o anki gerçek pozisyonu)
        const attackPos = (data.x !== undefined)
            ? new THREE.Vector3(data.x, data.y, data.z)
            : p.getPosition();
        if (this.ball.isInAttackRange(attackPos)) {
            const target = this.getAimedEnemy(attackPos, p.aimDir, p.team);
            const result = this.ball.deflectWithAim(attackPos, p.aimDir, target, data.flick || { vertical: 0, horizontal: 0, power: 0 });
            if (target) this.ball.setTarget(target);
            this.lastDeflector = p;
            this.lastDeflectorTeam = p.team;
            this._pushDeflectHistory(p.name);
            this.ball.lastShotBy = p.name;
            this.rallyCount++;
            p.onSuccessfulDeflect();
            this.scoreboard.recordDeflection(p.name);
            this.audio.playDeflect(result.shot);
            // Remote attack görselini diğer client'lara yayınla
            if (this.network?.isHost) {
                this.network.broadcast({
                    type: 'remoteAttackAnim',
                    peerId,
                    ax: p.aimDir.x, ay: p.aimDir.y, az: p.aimDir.z,
                    attacking: true
                });
            }
        }
        setTimeout(() => { if (p) p.attacking = false; }, 300);
    }

    applyLobbyState(data) {
        if (!data.players) return;
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
        const myId = this.network?.peer?.id;
        const seen = new Set();
        for (const pl of data.players) {
            if (pl.name === this.playerName) {
                this.player.setTeam(pl.team);
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
            if (pl.peerId && pl.peerId !== myId) {
                seen.add(pl.peerId);
                const p = this.addRemotePlayer(pl.peerId, pl.name, pl.team, pl.avatar || null);
                if (p) {
                    p.team = pl.team || p.team;
                    if (pl.charId) p.charId = pl.charId;
                    if (pl.avatar && p.avatar !== pl.avatar) {
                        p.avatar = pl.avatar;
                        if (p.setAvatarTexture) p.setAvatarTexture(pl.avatar);
                        if (p.avatarSprite) {
                            p.group.remove(p.avatarSprite);
                            p.avatarSprite.material.map?.dispose();
                            p.avatarSprite.material.dispose();
                            p.avatarSprite = this._makeAvatarSprite(p.name, p.team, pl.avatar);
                            p.group.add(p.avatarSprite);
                        }
                    }
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
            this.remotePlayers.forEach((p, peerId) => {
                if (p.isBotEntity) return;
                this.scoreboard.addPlayer(p.name, p.team, { peerId });
                const spawn = this.arena.getPlayerSpawn(p.team);
                p.position.copy(spawn);
                p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
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
            this.rallyCount = 0;
            this.killStreak = 0;
            this._spectateTarget = null;
            this._hideKillcam();
            this.ui.hideAll();
            this.ui.showHUD();
            this.player.respawn();
            this.bots.forEach(b => b.respawn());
            this.audio.init();
            this.audio.preloadSfx('sfx/');
            this.initMinimap();
            this._skipPreGame = true;
            this.startRound();
        }
    }

    startGameFromNetwork(data = {}) {
        if (this.network?.isHost) return;
        if (data.mode) this.selectMode(data.mode);
        if (data.map && this.arena.mapId !== data.map) {
            this.arena.rebuild(data.map);
        }
        this.startGame();
    }

    applyPlayerHit(data = {}) {
        const target = data.victimPeerId ? this.remotePlayers.get(data.victimPeerId) : (data.victimName === this.playerName ? this.player : null);
        if (!target) return;
        target.hp = data.hp ?? target.hp;
        target.alive = data.alive !== false;
        if (!target.alive) {
            if (target === this.player) this.player.die();
            else if (target.group) target.group.visible = false;
        }
    }

    snapshotState() {
        return {
            players: this.getPlayerList(),
            state: this.state,
            mode: this.mode?.id,
            map: this.arena?.mapId,
            maxRounds: this.scoreboard.maxRounds,
            timeLimit: this.scoreboard.timeLimit
        };
    }
    updateBallFromNetwork(data) {
        if (this.network && !this.network.isHost) {
            // Her gelen snapshot'ı hedef olarak kaydet. prev = o anki pozisyon.
            const now = performance.now();
            if (this._ballTargetPos) {
                // Önceki hedefi prev'e kaydır (gerçek pozisyon değil, lerp'in kaldığı yer)
                this._ballPrevPos = { x: this.ball.position.x, y: this.ball.position.y, z: this.ball.position.z };
            } else {
                this._ballPrevPos = { x: data.x, y: data.y, z: data.z };
                this.ball.position.set(data.x, data.y, data.z);
                this.ball.mesh.position.copy(this.ball.position);
            }
            this._ballTargetPos = { x: data.x, y: data.y, z: data.z };
            this._ballLerpStart = now;
            this._ballLerpDuration = 50; // ms — 20Hz'de 50ms aralık

            // Velocity + state her zaman güncel
            this.ball.velocity.set(data.vx, data.vy, data.vz);
            this.ball.currentSpeed = data.speed;
            this.ball.active = data.active;
            this.ball.mesh.visible = data.active;
            this.ball.state = data.state || this.ball.state;
            if (data.targetId) {
                const t = this.remotePlayers.get(data.targetId);
                if (t) this.ball.setTarget(t);
                else if (data.targetName === this.playerName) this.ball.setTarget(this.player);
            }
            if (data.targetName === this.playerName && !this.ball.targetPlayer) {
                this.ball.setTarget(this.player);
            }
        }
    }
    // Client tarafında top mesh pozisyonunu lerp ile her frame yumuşat.
    // Her gelen snapshot yeni hedef olur ve pozisyon buna doğru linear interpolate edilir.
    // Snapshot gecikmelerinde velocity extrapolation da eklenir.
    invokeBallLerp(dt) {
        if (!this._ballTargetPos || this.network?.isHost) return;
        const p = this._ballPrevPos;
        const tg = this._ballTargetPos;
        if (!p || !tg) { this.ball.mesh.position.copy(this.ball.position); return; }

        const elapsed = performance.now() - (this._ballLerpStart || 0);
        const alpha = Math.min(1, elapsed / (this._ballLerpDuration || 50));

        // Her frame pozisyonu lerp ile güncelle
        this.ball.position.x = p.x + (tg.x - p.x) * alpha;
        this.ball.position.y = p.y + (tg.y - p.y) * alpha;
        this.ball.position.z = p.z + (tg.z - p.z) * alpha;

        // Extrapolation: yeni snapshot gelmediyse velocity ile devam et
        if (alpha >= 1) {
            this.ball.position.x += this.ball.velocity.x * dt;
            this.ball.position.y += this.ball.velocity.y * dt;
            this.ball.position.z += this.ball.velocity.z * dt;
        }

        this.ball.mesh.position.copy(this.ball.position);
    }
    updateScoresFromNetwork(data) {
        if (this.network && !this.network.isHost) {
            this.scoreboard.redScore = data.red;
            this.scoreboard.blueScore = data.blue;
            this.scoreboard.timeRemaining = data.time;
            this.scoreboard.roundNum = data.round;
            // Kill feed sync
            if (data.killFeed) {
                this.killFeed = data.killFeed;
                this.ui.updateKillFeed?.(this.killFeed);
            }
        }
    }
    // Client tarafında roundEnd sadece UI/IPC amaçlı: round bitti mesajını göster ve round timer'i başlat.
    applyRoundEnd(data) {
        if (this.network?.isHost) return;
        this.setState(STATES.ROUND_END);
        this.roundRestartTimer = this.roundRestartDelay;
        if (data?.winner === 'red') this.ui.showMessage?.('🔴 RED TEAM WINS THE ROUND!', 2000);
        else if (data?.winner === 'blue') this.ui.showMessage?.('🔵 BLUE TEAM WINS THE ROUND!', 2000);
        else if (data?.winner === 'draw') this.ui.showMessage?.('⚔️ DOUBLE KO — DRAW!', 2000);
    }
    startRoundFromNetwork() { this.startRound(); }

    // Client: host'tan remoteAttackAnim mesajı gelince, remote player'ın
    // saldırı animasyonunu göster (kol sallama, efekt).
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
            p.prevPos.set(p.position.x, p.position.y, p.position.z);
            p.targetPos.set(bd.x, bd.y, bd.z);
            p.interpAlpha = 0;
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
        const p = this.remotePlayers.get(data.peerId);
        if (!p) return;
        p.attacking = true;
        p.attackTimer = 0.3;
        if (data.ax !== undefined) p.aimDir.set(data.ax, data.ay, data.az).normalize();
        // Attack sesi — uzaktan gelen top vuruşu
        this.audio?.playSfx?.('tf2_hit', 0.15);
        setTimeout(() => { if (p) p.attacking = false; }, 300);
    }

    // --- P2P SYNC HANDLERS ---

    applyMapChange(data) {
        if (!data?.mapId || this.network?.isHost) return;
        if (this.arena.mapId === data.mapId) return;
        this.arena.rebuild(data.mapId);
        this.ui.showMessage?.(`Arena: ${this.arena.config?.name || data.mapId}`, 1400);
        // Oyuncuları yeni haritada spawn et
        this.player.respawn();
        this.bots.forEach(b => b.respawn());
        this.remotePlayers.forEach(p => {
            if (p.position && !p.isBotEntity) {
                p.position.copy(this.arena.getPlayerSpawn(p.team));
                p.group.position.copy(p.position).add(new THREE.Vector3(0, -1.2, 0));
            }
        });
    }

    applyModeChange(data) {
        if (!data?.modeId || this.network?.isHost) return;
        this.selectMode(data.modeId);
    }

    applyPowerUpState(data) {
        if (!data?.powerUps || this.network?.isHost) return;
        // Mevcut power-up'ları temizle
        for (const pu of this.powerUps) {
            this.renderer.scene.remove(pu.mesh);
            pu.mesh.geometry?.dispose();
            pu.mesh.material?.dispose();
        }
        this.powerUps = [];
        // Host'tan gelen power-up'ları oluştur
        for (const pu of data.powerUps) {
            const colors = { speed: 0xffee00, shield: 0x44aaff, damage: 0xff4444 };
            const geo = new THREE.SphereGeometry(0.4, 8, 8);
            const mat = new THREE.MeshBasicMaterial({ color: colors[pu.type] || 0xffffff, transparent: true, opacity: 0.85 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pu.x, 1.2, pu.z);
            this.renderer.scene.add(mesh);
            this.powerUps.push({ type: pu.type, mesh, x: pu.x, z: pu.z, time: performance.now(), label: '' });
        }
    }

    applyCelebrationStart(data) {
        if (!data || this.network?.isHost) return;
        // Client celebration state'ine gir — winner/loser UI'ı göster
        this.state = STATES.CELEBRATION;
        this._celebrationTimer = data.duration || 30;
        this._winningTeam = data.winner || null;
        this._won = this._winningTeam !== null && this.player.team === this._winningTeam;
        this.ball.deactivate();
        this.player.lock();
        this.player._celebNoAttack = (this.player.team !== this._winningTeam);
        this.ui.setPlayerTarget(false);
        this.bots.forEach(bot => bot.setTargetOutline(false));
        this.ui.showMessage?.(data.message || '', 3000);
        if (this._won) {
            this.audio?.playSfx?.('tf2_victory', 0.55);
        } else {
            this.audio?.playSfx?.('tf2_you_failed', 0.5);
        }
    }

    applyGameOver(data) {
        if (!data || this.network?.isHost) return;
        this.state = STATES.GAME_OVER;
        this.player.unlock();
        this.player._celebNoAttack = false;
        // XP / reward screen — host'tan gelen verilerle
        const winnerText = `RED ${data.redScore} - ${data.blueScore} BLUE`;
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
        // Avatar dataURL'i önce parametre ile gelen değerden, sonra local own avatar'dan, sonra fallback.
        const localStore = window.__store;
        let tex;
        const dataUrl = avatarDataUrl || localStore?.get?.('customAvatar')?.dataURL;
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
