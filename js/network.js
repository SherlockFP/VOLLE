// network.js — P2P via PeerJS for multiplayer
export class Network {
    constructor(game) {
        this.game = game;
        this.peer = null;
        this.connections = new Map();
        this.hostConn = null;      // direct reference to host connection (mesh routing)
        this.isHost = false;
        this.roomCode = '';
        this.playerName = 'Player';
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onGameState = null;
        this.connected = false;
        this.isParty = false;
        this.readyPlayers = new Set();
        this.onReadyChange = null;
        this.onPartyChat = null;
        this.lobbyPassword = '';   // host-set; '' = open lobby
        this.onKicked = null;      // callback() when host kicks us
        this.onTeamChange = null;  // callback(name, team) applied on clients
        this.onHostLeft = null;    // callback() when the host connection drops / lobby closes
        this._lastPing = 0;            // ms, son ölçülen RTT
        this._pingAwait = null;        // güncel bekleyen nonce
    }

    async initPeer() {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(undefined, {
                debug: 0
            });
            this.peer.on('open', id => {
                this.roomCode = id;
                this.connected = true;
                resolve(id);
            });
            this.peer.on('error', err => {
                console.error('Peer error:', err);
                reject(err);
            });
            // ALL peers accept incoming connections (mesh: P2P position relay)
            this.peer.on('connection', (conn) => this._onIncomingConnection(conn));
        });
    }

    async hostGame(playerName) {
        this.playerName = playerName;
        this.isHost = true;
        await this.initPeer();
        if (this.game?.player) this.game.player.peerId = this.roomCode;
        return this.roomCode;
    }

    async joinGame(roomCode, playerName, password = '') {
        this.playerName = playerName;
        this.isHost = false;
        await this.initPeer();
        if (this.game?.player && this.peer) this.game.player.peerId = this.peer.id;

        const conn = this.peer.connect(roomCode, {
            metadata: { name: playerName, password }
        });

        return new Promise((resolve, reject) => {
            conn.on('open', () => {
                this.hostConn = conn;
                this.connections.set(roomCode, conn);
                this.setupDataHandlers(conn);
                const avatar = window.__store?.get?.('customAvatar')?.dataURL || '';
                conn.send({ type: 'join', name: playerName, password, avatar });
                resolve();
            });
            // Host went away (closed game / left lobby) → kick us back to menu.
            conn.on('close', () => {
                this.connections.delete(roomCode);
                if (!this.isHost && this.onHostLeft) this.onHostLeft();
            });
            conn.on('error', reject);
        });
    }

    // Route incoming connections: new player join (host) vs P2P mesh (non-host peers)
    _onIncomingConnection(conn) {
        conn.on('open', () => {
            if (conn.metadata?.isMesh) {
                this._handleMeshConn(conn);
            } else if (this.isHost) {
                this._handleJoinConn(conn);
            } else {
                // Non-host receiving a non-mesh connection = odd; close to be safe.
                conn.close();
            }
        });
    }

    _handleJoinConn(conn) {
        const name = conn.metadata?.name || 'Player';
        // Password gate — reject wrong/missing password before admitting the peer.
        if (this.lobbyPassword && conn.metadata?.password !== this.lobbyPassword) {
            conn.send({ type: 'kick', name, reason: 'password' });
            setTimeout(() => conn.close(), 200);
            return;
        }
        this.connections.set(conn.peer, conn);
        this.setupDataHandlers(conn);
        if (this.onPlayerJoin) this.onPlayerJoin(name, conn.peer);

        // Send current game state: lobby + map/mode/score/snapshot — late join
        // için yeni gelen oyuncu tam state'te başlayabilsin.
        conn.send({
            type: 'welcome',
            players: this.game.getPlayerList(),
            state: this.game.state,
            mode: this.game.mode?.id,
            map: this.game?.arena?.mapId,
            round: this.game.scoreboard?.roundNum,
            red: this.game.scoreboard?.redScore,
            blue: this.game.scoreboard?.blueScore,
            time: this.game.scoreboard?.timeRemaining,
            snapshot: this.game.snapshotState?.() || {}
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            if (this.onPlayerLeave) this.onPlayerLeave(conn.peer);
        });
    }

    _handleMeshConn(conn) {
        this.connections.set(conn.peer, conn);
        this.setupDataHandlers(conn);
        conn.on('close', () => {
            this.connections.delete(conn.peer);
        });
    }

    setupDataHandlers(conn) {
        conn.on('data', data => {
            this.handleMessage(data, conn.peer);
        });
    }

    handleMessage(data, peerId) {
        switch (data.type) {
            case 'join':
                if (this.onPlayerJoin) this.onPlayerJoin(data.name, peerId, data.avatar);
                break;
            case 'position':
                this.game.updateRemotePlayer(data.peerId || peerId, data);
                break;
            case 'attack':
                this.game.remoteAttack(peerId, data);
                break;
            case 'skillUse':
                if (this.isHost) this.game.handleSkillUse(peerId, data);
                break;
            case 'skillEffect':
                if (!this.isHost) this.game.handleSkillEffect(data);
                break;
            case 'announce':
                if (!this.isHost) this.game.applyAnnounce(data);
                break;
            case 'chat':
                this.game.addChatMessage(data.name, data.text);
                if (this.isHost) this.broadcast(data);
                break;
            case 'gameState':
                if (this.onGameState) this.onGameState(data);
                break;
            case 'lobbyState':
                this.game.applyLobbyState(data);
                break;
            case 'gameStart':
                this.game.startGameFromNetwork(data);
                break;
            case 'playerHit':
                this.game.applyPlayerHit(data);
                break;
            case 'ping':
                // Periyodik ping alındı → pong ile geri cevap ver.
                this._sendToConn(peerId, { type: 'pong', nonce: data.nonce, t: performance.now() });
                break;
            case 'pong':
                // RTT hesaplayan client tarafında kayıtlı nonce eşleşirse ping kayıt edilir.
                if (this._pingAwait && data.nonce === this._pingAwait.nonce) {
                    const rtt = performance.now() - this._pingAwait.t;
                    this._lastPing = rtt;
                    this._pingAwait = null;
                }
                break;
            case 'ballState':
                this.game.updateBallFromNetwork(data);
                break;
            case 'scoreUpdate':
                this.game.updateScoresFromNetwork(data);
                break;
            case 'roundStart':
                this.game.startRoundFromNetwork(data);
                break;
            case 'roundEnd':
                this.game.applyRoundEnd?.(data);
                break;
            case 'welcome':
                if (this.onGameState) this.onGameState(data);
                break;
            case 'ready':
                // ponytail: host is source of truth for ready set; clients mirror via broadcast
                if (data.ready) this.readyPlayers.add(data.name);
                else this.readyPlayers.delete(data.name);
                if (this.onReadyChange) this.onReadyChange(data.name, data.ready);
                break;
            case 'partyChat':
                if (this.onPartyChat) this.onPartyChat(data.name, data.text);
                break;
            case 'friendDM':
                if (this.onFriendDM) this.onFriendDM(data.from, data.text);
                break;
            case 'kick':
                // Host told us (or the named player) to leave the lobby.
                if (!this.isHost && (data.name === this.playerName || !data.name)) {
                    if (this.onKicked) this.onKicked(data.reason);
                    this.disconnect();
                }
                break;
            case 'teamChange':
                // Hem istemci hem host kendi callback'lerini çalıştırır.
                // Client sadece uygular, host ise uygulayıp yeni lobbyState'i broadcast eder.
                if (this.onTeamChange) this.onTeamChange(data.name, data.team);
                break;
            case 'remoteAttackAnim':
                if (!this.isHost) this.game.handleRemoteAttackAnim(data);
                break;
            case 'botSync':
                if (!this.isHost) this.game.applyBotSync(data);
                break;
            case 'mapChange':
                if (!this.isHost) this.game.applyMapChange(data);
                break;
            case 'modeChange':
                if (!this.isHost) this.game.applyModeChange(data);
                break;
            case 'powerUpState':
                if (!this.isHost) this.game.applyPowerUpState(data);
                break;
            case 'celebrationStart':
                if (!this.isHost) this.game.applyCelebrationStart(data);
                break;
            case 'gameOver':
                if (!this.isHost) this.game.applyGameOver(data);
                break;
            case 'mapVoteOptions':
                if (!this.isHost && this.game.applyMapVoteOptions) this.game.applyMapVoteOptions(data);
                break;
            case 'mapVote':
                if (this.isHost && this.game.handleMapVote) this.game.handleMapVote(data, peerId);
                break;
            case 'mapVoteResult':
                if (!this.isHost && this.game.applyMapVoteResult) this.game.applyMapVoteResult(data);
                break;
            case 'newPeer':
                // Host tells us another client joined — establish mesh connection
                if (!this.isHost && data.peerId && data.peerId !== this.peer?.id && data.peerId !== this.hostConn?.peer) {
                    this.connectToPeer(data.peerId);
                }
                break;
            case 'peerLeft':
                // Host tells us a client left — clean up mesh connection
                if (data.peerId) this.connections.delete(data.peerId);
                break;
            case 'taunt':
                if (this.game) this.game.handleRemoteTaunt(data);
                break;
            case 'lobbyClosed':
                // Lobby kapandı — ana menüye dön.
                if (!this.isHost && this.onHostLeft) this.onHostLeft();
                this.disconnect();
                break;
        }
    }

    // Host: drop a connection whose player metadata name matches.
    kickByName(name) {
        this.connections.forEach((conn, peerId) => {
            if (conn.metadata?.name === name) {
                try { conn.send({ type: 'kick', name }); } catch (e) {}
                setTimeout(() => conn.close(), 150);
                this.connections.delete(peerId);
            }
        });
    }

    setLobbyPassword(pw) { this.lobbyPassword = pw || ''; }

    // Establish a direct P2P mesh connection to another peer (non-host).
    async connectToPeer(peerId) {
        if (this.connections.has(peerId) || peerId === this.peer?.id) return;
        const conn = this.peer.connect(peerId, {
            metadata: { name: this.playerName, isMesh: true }
        });
        return new Promise((resolve) => {
            conn.on('open', () => {
                this.connections.set(peerId, conn);
                this.setupDataHandlers(conn);
                resolve();
            });
            conn.on('close', () => { this.connections.delete(peerId); });
        });
    }

    broadcast(data) {
        this.connections.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }

    broadcastAll(data) {
        this.connections.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }

    sendToHost(data) {
        if (this.hostConn && this.hostConn.open) this.hostConn.send(data);
    }

    send(data) {
        if (this.isHost) {
            this.broadcast(data);
        } else {
            this.sendToHost(data);
        }
    }

    // Sync player pos — goes directly to ALL peers (mesh, skip host relay)
    sendPosition(position, rotation, extra = {}) {
        this.broadcastAll({
            type: 'position',
            x: position.x,
            y: position.y,
            z: position.z,
            ry: rotation,
            ...extra
        });
    }

    _sendToConn(peerId, data) {
        const conn = this.connections.get(peerId);
        if (conn && conn.open) conn.send(data);
    }

    sendAttack(extra = {}) {
        this.send({ type: 'attack', ...extra });
    }

    sendSkillUse(extra = {}) {
        this.send({ type: 'skillUse', ...extra });
    }

    broadcastSkillEffect(skillId, peerId, pos) {
        if (!this.isHost) return;
        this.broadcast({ type: 'skillEffect', skill: skillId, peerId, pos });
    }

    // RTT ölçümü — nonce işaretlenir, periyodik olarak peer'a yollanır.
    sendPing() {
        if (!this.connected) return;
        this._pingAwait = { nonce: Math.random().toString(36).slice(2), t: performance.now() };
        this.send({ type: 'ping', nonce: this._pingAwait.nonce });
    }

    getPing() { return this._lastPing || 0; }

    broadcastBallState(ball) {
        if (!this.isHost) return;
        this.broadcast({
            type: 'ballState',
            x: ball.position.x,
            y: ball.position.y,
            z: ball.position.z,
            vx: ball.velocity.x,
            vy: ball.velocity.y,
            vz: ball.velocity.z,
            speed: ball.currentSpeed,
            active: ball.active
        });
    }

    broadcastScores(scoreboard) {
        if (!this.isHost) return;
        this.broadcast({
            type: 'scoreUpdate',
            red: scoreboard.redScore,
            blue: scoreboard.blueScore,
            players: scoreboard.getPlayerStats(),
            time: scoreboard.timeRemaining,
            round: scoreboard.roundNum
        });
    }

    broadcastRoundStart(snapshot = {}) {
        if (!this.isHost) return;
        this.broadcast({ type: 'roundStart', ...snapshot });
    }

    broadcastRoundEnd(snapshot = {}) {
        if (!this.isHost) return;
        this.broadcast({ type: 'roundEnd', ...snapshot });
    }

    getConnectionCount() {
        return this.connections.size;
    }

    disconnect() {
        this.connections.forEach(conn => conn.close());
        this.connections.clear();
        if (this.peer) this.peer.destroy();
        this.peer = null;
        this.connected = false;
        this.isHost = false;
        this.isParty = false;
        this.readyPlayers.clear();
        // Notify the guest UI when the host connection drops abruptly.
        // Skipped during closeLobby() because that path already fired onHostLeft.
    }

    // Host: lobby kapanıyor — client'lara bildir, sonra bağlantıları kes.
    closeLobby() {
        if (!this.isHost) { this.disconnect(); return; }
        this.broadcast({ type: 'lobbyClosed' });
        this.disconnect();
    }

    // --- Party system ---

    async createParty(playerName) {
        const code = await this.hostGame(playerName);
        this.isParty = true;
        return code;
    }

    async joinParty(code, playerName) {
        await this.joinGame(code, playerName);
        this.isParty = true;
    }

    leaveParty() {
        this.disconnect();
        this.isParty = false;
        this.readyPlayers.clear();
    }

    getPartyMembers() {
        // ponytail: names from conn metadata may be sparse; host's own name prepended
        const members = [this.playerName];
        this.connections.forEach(conn => {
            const name = conn.metadata?.name;
            if (name) members.push(name);
        });
        return members;
    }

    // --- Lobby ready-check ---

    setReady(playerName, ready) {
        if (ready) this.readyPlayers.add(playerName);
        else this.readyPlayers.delete(playerName);
        this.broadcast({ type: 'ready', name: playerName, ready });
    }

    allReady(playerNames) {
        // ponytail: empty list = vacuously ready; caller guards empty lobby
        return playerNames.every(n => this.readyPlayers.has(n));
    }

    // --- Party chat ---

    sendPartyChat(text) {
        this.broadcast({ type: 'partyChat', name: this.playerName, text });
    }

    // --- Friend DM ---

    sendDM(peerId, text) {
        this.sendTo(peerId, { type: 'friendDM', from: this.playerName, text });
    }

    sendTo(peerId, data) {
        const conn = this.connections.get(peerId) || this.hostConn;
        if (conn && conn.open) conn.send(data);
    }
}
