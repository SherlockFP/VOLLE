// network.js — P2P via PeerJS for multiplayer
// ponytail: binary message types for hot-path packets (ballState/position) — ~4x smaller than JSON
const BIN = { BALL: 1, POS: 2 };
const PLAYER_ID_KEY = 'dodgb.playerId';
const RESUME_TOKEN_KEY = 'dodgb.resumeToken';

function createSessionValue(key, prefix) {
    try {
        const stored = globalThis.sessionStorage?.getItem(key);
        if (stored) return stored;
    } catch (_) {}
    const id = globalThis.crypto?.randomUUID?.()
        || `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { globalThis.sessionStorage?.setItem(key, id); } catch (_) {}
    return id;
}

export function isNewerSequence(next, previous) {
    const delta = (next - previous + 0x10000) & 0xffff;
    return delta > 0 && delta < 0x8000;
}

export function reconnectDelay(attempt) {
    return Math.min(2000, 500 * (2 ** Math.max(0, attempt - 1)));
}

export class Network {
    constructor(game) {
        this.game = game;
        this.peer = null;
        this.connections = new Map();
        this.peerToPlayerId = new Map();
        this.playerConnections = new Map();
        this.playerResumeTokens = new Map();
        this.allowedMeshPeers = new Map();
        this.pendingConnections = new Map();
        this.hostConn = null;      // direct reference to host connection (mesh routing)
        this.isHost = false;
        this.roomCode = '';
        this.playerId = createSessionValue(PLAYER_ID_KEY, 'player');
        this.resumeToken = createSessionValue(RESUME_TOKEN_KEY, 'resume');
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
        this._clockOffset = 0;
        this._positionSeq = 0;
        this._lastPositionSeq = new Map();
        this.hostRoomCode = '';
        this.joinPassword = '';
        this.onReconnectState = null;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        this._reconnectTimer = null;
        this._joinPromise = null;
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

    joinGame(roomCode, playerName, password = '') {
        if (this._joinPromise) return this._joinPromise;
        const promise = this._joinGame(roomCode, playerName, password);
        this._joinPromise = promise;
        promise.finally(() => {
            if (this._joinPromise === promise) this._joinPromise = null;
        }).catch(() => {});
        return promise;
    }

    async _joinGame(roomCode, playerName, password = '') {
        this.playerName = playerName;
        this.isHost = false;
        this.hostRoomCode = roomCode;
        this.joinPassword = password;
        this._manualDisconnect = false;
        this._reconnectAttempts = 0;
        await this.initPeer();
        if (this.game?.player && this.peer) this.game.player.peerId = this.peer.id;

        const conn = this.peer.connect(roomCode, {
            metadata: {
                name: playerName,
                password,
                playerId: this.playerId,
                resumeToken: this.resumeToken
            }
        });

        return new Promise((resolve, reject) => {
            conn.on('open', () => {
                this._reconnectAttempts = 0;
                this.hostConn = conn;
                this.connections.set(roomCode, conn);
                this.setupDataHandlers(conn);
                const avatar = globalThis.window?.__store?.get?.('customAvatar')?.dataURL || '';
                conn.send({ type: 'join', name: playerName, password, avatar, playerId: this.playerId });
                resolve();
            });
            // Host went away (closed game / left lobby) → kick us back to menu.
            conn.on('close', () => {
                if (this.connections.get(roomCode) === conn) this.connections.delete(roomCode);
                if (this.hostConn === conn) this.hostConn = null;
                this._scheduleReconnect();
            });
            conn.on('error', reject);
        });
    }

    // Route incoming connections: new player join (host) vs P2P mesh (non-host peers)
    _scheduleReconnect() {
        if (this._manualDisconnect || this.isHost || !this.peer || this._reconnectTimer) return;
        const attempt = ++this._reconnectAttempts;
        if (attempt > 3) {
            this.onReconnectState?.('failed', attempt - 1);
            this.onHostLeft?.();
            return;
        }
        this.onReconnectState?.('reconnecting', attempt);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._reconnectOnce();
        }, reconnectDelay(attempt));
    }

    _reconnectOnce() {
        if (this._manualDisconnect || !this.peer || !this.hostRoomCode) return;
        const conn = this.peer.connect(this.hostRoomCode, {
            metadata: {
                name: this.playerName,
                password: this.joinPassword,
                playerId: this.playerId,
                resumeToken: this.resumeToken
            }
        });
        conn.on('open', () => {
            this._reconnectAttempts = 0;
            this.hostConn = conn;
            this.connections.set(this.hostRoomCode, conn);
            this.setupDataHandlers(conn);
            const avatar = globalThis.window?.__store?.get?.('customAvatar')?.dataURL || '';
            conn.send({ type: 'join', name: this.playerName, password: this.joinPassword, avatar, playerId: this.playerId });
            this.onReconnectState?.('connected', 0);
        });
        conn.on('close', () => {
            if (this.connections.get(this.hostRoomCode) === conn) this.connections.delete(this.hostRoomCode);
            if (this.hostConn === conn) this.hostConn = null;
            this._scheduleReconnect();
        });
        conn.on('error', () => this._scheduleReconnect());
    }

    _onIncomingConnection(conn) {
        conn.on('open', () => {
            if (conn.metadata?.isMesh) {
                if (this.isHost) conn.close();
                else this._handleMeshConn(conn);
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
        const playerId = conn.metadata?.playerId || conn.peer;
        const resumeToken = conn.metadata?.resumeToken || null;
        // Password gate — reject wrong/missing password before admitting the peer.
        if (this.lobbyPassword && conn.metadata?.password !== this.lobbyPassword) {
            conn.send({ type: 'kick', name, reason: 'password' });
            setTimeout(() => conn.close(), 200);
            return;
        }
        const previous = this.playerConnections.get(playerId);
        const expectedToken = this.playerResumeTokens.get(playerId);
        if (expectedToken && expectedToken !== resumeToken) {
            conn.send({ type: 'kick', name, reason: 'duplicate_identity' });
            setTimeout(() => conn.close(), 200);
            return;
        }
        if (resumeToken && !expectedToken) this.playerResumeTokens.set(playerId, resumeToken);
        this.connections.set(conn.peer, conn);
        this.peerToPlayerId.set(conn.peer, playerId);
        this.playerConnections.set(playerId, conn);
        if (previous && previous !== conn) this._lastPositionSeq.delete(playerId);
        this.setupDataHandlers(conn);
        if (previous && previous !== conn) {
            if (this.connections.get(previous.peer) === previous) this.connections.delete(previous.peer);
            if (previous.peer !== conn.peer) this.peerToPlayerId.delete(previous.peer);
            previous.close();
        }

        // Send current game state: lobby + map/mode/score/snapshot — late join
        // için yeni gelen oyuncu tam state'te başlayabilsin.
        conn._sendWelcome = () => conn.send({
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
            if (this.connections.get(conn.peer) === conn) {
                this.connections.delete(conn.peer);
                this.peerToPlayerId.delete(conn.peer);
            }
            if (this.playerConnections.get(playerId) !== conn) return;
            this.playerConnections.delete(playerId);
            this._lastPositionSeq.delete(playerId);
            if (this.onPlayerLeave) this.onPlayerLeave(playerId, conn.peer);
        });
    }

    _handleMeshConn(conn) {
        const playerId = this.allowedMeshPeers.get(conn.peer);
        if (!playerId || conn.metadata?.playerId !== playerId) {
            conn.close();
            return;
        }
        this.connections.set(conn.peer, conn);
        this.peerToPlayerId.set(conn.peer, playerId);
        this._lastPositionSeq.delete(playerId);
        this.setupDataHandlers(conn);
        conn.on('close', () => {
            if (this.connections.get(conn.peer) === conn) {
                this.connections.delete(conn.peer);
                this.peerToPlayerId.delete(conn.peer);
            }
        });
    }

    setupDataHandlers(conn) {
        conn.on('data', data => {
            if (this.connections.get(conn.peer) !== conn) return;
            this.handleMessage(data, conn.peer);
        });
    }

    // --- ponytail: binary codec for hot-path packets ---
    _decodeBinary(data) {
        const dv = data instanceof Uint8Array
            ? new DataView(data.buffer, data.byteOffset, data.byteLength)
            : new DataView(data);
        const t = dv.getUint8(0);
        if (t === BIN.BALL) return this._decodeBallState(dv);
        if (t === BIN.POS) return this._decodePosition(dv);
        return null;
    }

    _decodeBallState(dv) {
        const msg = { type: 'ballState', seq: dv.getUint16(1) };
        msg.x = dv.getFloat32(3); msg.y = dv.getFloat32(7); msg.z = dv.getFloat32(11);
        msg.vx = dv.getFloat32(15); msg.vy = dv.getFloat32(19); msg.vz = dv.getFloat32(23);
        msg.speed = dv.getFloat32(27);
        const flags = dv.getUint8(31);
        msg.active = !!(flags & 1);
        let off = 32;
        if (flags & 2) { const sc = dv.getUint8(off); off += 1; msg.state = { 0: 'idle', 1: 'rally', 2: 'hold', 3: 'warmup', 4: 'other' }[sc] || 'rally'; }
        if (flags & 4) { const len = dv.getUint8(off); off += 1; msg.targetName = len ? new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + off, len)) : null; off += len; }
        if (flags & 8) { const len = dv.getUint8(off); off += 1; msg.affix = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + off, len)); off += len; msg.affixColor = dv.getUint32(off); off += 4; }
        return msg;
    }

    _decodePosition(dv) {
        const msg = { type: 'position' };
        msg.x = dv.getFloat32(1); msg.y = dv.getFloat32(5); msg.z = dv.getFloat32(9);
        msg.ry = dv.getFloat32(13);
        msg.ax = dv.getFloat32(17); msg.ay = dv.getFloat32(21); msg.az = dv.getFloat32(25);
        const sequenced = dv.byteLength >= 44;
        const modern = dv.byteLength >= 42;
        msg.vx = modern ? dv.getFloat32(29) : 0; msg.vy = modern ? dv.getFloat32(33) : 0; msg.vz = modern ? dv.getFloat32(37) : 0;
        if (sequenced) msg.seq = dv.getUint16(41);
        const flags = dv.getUint8(sequenced ? 43 : modern ? 41 : 29);
        let off = sequenced ? 44 : modern ? 42 : 30;
        if (flags & 1) { msg.alive = dv.getUint8(off) === 1; off += 1; }
        if (flags & 2) { msg.hp = dv.getUint8(off); off += 1; }
        if (flags & 4) { msg.team = dv.getUint8(off) === 0 ? 'red' : 'blue'; off += 1; }
        if (flags & 8) { const len = dv.getUint8(off); off += 1; msg.name = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + off, len)); off += len; }
        if (flags & 16) { const len = dv.getUint8(off); off += 1; msg.charId = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + off, len)); off += len; }
        if (flags & 32) { const len = dv.getUint8(off); off += 1; msg.playerId = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + off, len)); off += len; }
        return msg;
    }

    encodeBallState(b) {
        const hasState = Object.prototype.hasOwnProperty.call(b, 'state');
        const hasTarget = Object.prototype.hasOwnProperty.call(b, 'targetName');
        const hasAffix = !!b.affix;
        let size = 32;
        let stateCode = 1, targetBytes = null, affixBytes = null;
        if (hasState) { size += 1; stateCode = { idle: 0, hold: 2, warmup: 3, rally: 1, other: 4 }[b.state] ?? 4; }
        if (hasTarget) { targetBytes = new TextEncoder().encode(b.targetName || ''); size += 1 + targetBytes.length; }
        if (hasAffix) { affixBytes = new TextEncoder().encode(String(b.affix.id || b.affix.name)); size += 1 + affixBytes.length + 4; }
        const buf = new ArrayBuffer(size);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        dv.setUint8(0, BIN.BALL);
        dv.setUint16(1, (b.seq || 0) & 0xffff);
        dv.setFloat32(3, b.x); dv.setFloat32(7, b.y); dv.setFloat32(11, b.z);
        dv.setFloat32(15, b.vx); dv.setFloat32(19, b.vy); dv.setFloat32(23, b.vz);
        dv.setFloat32(27, b.speed);
        let flags = b.active ? 1 : 0, off = 32;
        if (hasState) { flags |= 2; dv.setUint8(off, stateCode); off += 1; }
        if (hasTarget) { flags |= 4; dv.setUint8(off, targetBytes.length); off += 1; u8.set(targetBytes, off); off += targetBytes.length; }
        if (hasAffix) { flags |= 8; dv.setUint8(off, affixBytes.length); off += 1; u8.set(affixBytes, off); off += affixBytes.length; dv.setUint32(off, b.affix.color || 0); off += 4; }
        dv.setUint8(31, flags);
        return u8;
    }

    encodePosition(p) {
        let size = 44;
        let nameBytes = null, charBytes = null, playerIdBytes = null;
        if (p.alive !== undefined) size += 1;
        if (p.hp !== undefined) size += 1;
        if (p.team) size += 1;
        if (p.name) { nameBytes = new TextEncoder().encode(p.name); size += 1 + nameBytes.length; }
        if (p.charId) { charBytes = new TextEncoder().encode(p.charId); size += 1 + charBytes.length; }
        if (p.playerId) { playerIdBytes = new TextEncoder().encode(p.playerId); size += 1 + playerIdBytes.length; }
        const buf = new ArrayBuffer(size);
        const dv = new DataView(buf);
        const u8 = new Uint8Array(buf);
        dv.setUint8(0, BIN.POS);
        dv.setFloat32(1, p.x); dv.setFloat32(5, p.y); dv.setFloat32(9, p.z);
        dv.setFloat32(13, p.ry || 0);
        dv.setFloat32(17, p.ax || 0); dv.setFloat32(21, p.ay || 0); dv.setFloat32(25, p.az || 0);
        dv.setFloat32(29, p.vx || 0); dv.setFloat32(33, p.vy || 0); dv.setFloat32(37, p.vz || 0);
        dv.setUint16(41, (p.seq || 0) & 0xffff);
        let flags = 0, off = 44;
        if (p.alive !== undefined) { flags |= 1; dv.setUint8(off, p.alive ? 1 : 0); off += 1; }
        if (p.hp !== undefined) { flags |= 2; dv.setUint8(off, Math.max(0, Math.min(255, p.hp | 0))); off += 1; }
        if (p.team) { flags |= 4; dv.setUint8(off, p.team === 'red' ? 0 : 1); off += 1; }
        if (p.name) { flags |= 8; dv.setUint8(off, nameBytes.length); off += 1; u8.set(nameBytes, off); off += nameBytes.length; }
        if (p.charId) { flags |= 16; dv.setUint8(off, charBytes.length); off += 1; u8.set(charBytes, off); off += charBytes.length; }
        if (p.playerId) { flags |= 32; dv.setUint8(off, playerIdBytes.length); off += 1; u8.set(playerIdBytes, off); off += playerIdBytes.length; }
        dv.setUint8(43, flags);
        return u8;
    }

    broadcastBinary(u8) {
        this.connections.forEach(conn => { if (conn.open) conn.send(u8); });
    }

    broadcastAllBinary(u8) {
        this.connections.forEach(conn => { if (conn.open) conn.send(u8); });
    }

    // ponytail: validate critical message fields to reject rogue peer data
    _validateMsg(data) {
        if (typeof data !== 'object' || !data.type) return false;
        switch (data.type) {
            case 'kick':
                return typeof data.name === 'string' && data.name.length > 0;
            case 'playerHit':
                return typeof data.dmg === 'number';
            case 'ballState':
                return typeof data.x === 'number' && typeof data.y === 'number' && typeof data.z === 'number';
            case 'attack':
                return typeof data.name === 'string' && typeof data.x === 'number' && typeof data.y === 'number';
            case 'position':
                return typeof data.x === 'number' && typeof data.z === 'number';
            case 'chat':
                return typeof data.text === 'string' && data.text.length <= 500;
            case 'teamChange':
                return data.team === 'red' || data.team === 'blue';
            default:
                return true;
        }
    }

    handleMessage(data, peerId) {
        // ponytail: decode binary hot-path packets to plain objects
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            data = this._decodeBinary(data);
            if (!data) return;
        }
        // ponytail: reject malformed messages
        if (!this._validateMsg(data)) return;
        const sourceConn = this.connections.get(peerId);
        if (this.isHost && data.type !== 'join' && (!sourceConn || !sourceConn._admitted)) return;
        switch (data.type) {
            case 'join':
                if (!this.isHost) break;
                {
                    const conn = this.connections.get(peerId);
                    if (!conn) break;
                    const playerId = this.peerToPlayerId.get(peerId) || peerId;
                    if (data.playerId && data.playerId !== playerId) {
                        conn.close();
                        break;
                    }
                    if (conn._admitted) break;
                    conn._admitted = true;
                    if (this.onPlayerJoin) this.onPlayerJoin(data.name, playerId, data.avatar, peerId);
                    conn._sendWelcome?.();
                }
                break;
            case 'position':
                {
                    const trustedRelay = !this.isHost && peerId === this.hostConn?.peer;
                    const transportPeerId = trustedRelay && data.peerId ? data.peerId : peerId;
                    const boundPlayerId = this.peerToPlayerId.get(peerId);
                    if (!trustedRelay && boundPlayerId && data.playerId && data.playerId !== boundPlayerId) return;
                    const playerId = trustedRelay
                        ? (data.playerId || this.peerToPlayerId.get(transportPeerId) || transportPeerId)
                        : (boundPlayerId || data.playerId || peerId);
                    if (trustedRelay) this.peerToPlayerId.set(transportPeerId, playerId);
                if (data.seq !== undefined) {
                    const previous = this._lastPositionSeq.get(playerId);
                    if (previous !== undefined && !isNewerSequence(data.seq, previous)) return;
                    this._lastPositionSeq.set(playerId, data.seq);
                }
                    this.game.updateRemotePlayer(playerId, data, transportPeerId);
                }
                break;
            case 'attack':
                this.game.remoteAttack(this.peerToPlayerId.get(peerId) || data.playerId || peerId, data, peerId);
                break;
            case 'skillUse':
                if (this.isHost) this.game.handleSkillUse(this.peerToPlayerId.get(peerId) || data.playerId || peerId, data);
                break;
            case 'skillEffect':
                if (!this.isHost) this.game.handleSkillEffect(data);
                break;
            case 'announce':
                if (!this.isHost) this.game.applyAnnounce(data);
                break;
            case 'chat':
                if (data.name !== this.playerName) this.game.addChatMessage(data.name, data.text);
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
                this._sendToConn(peerId, { type: 'pong', nonce: data.nonce, remoteTime: performance.now() });
                break;
            case 'pong':
                // RTT hesaplayan client tarafında kayıtlı nonce eşleşirse ping kayıt edilir.
                if (this._pingAwait && data.nonce === this._pingAwait.nonce) {
                    const now = performance.now();
                    const rtt = now - this._pingAwait.t;
                    this._lastPing = rtt;
                    if (typeof data.remoteTime === 'number') {
                        const sample = data.remoteTime - (this._pingAwait.t + now) * 0.5;
                        this._clockOffset += (sample - this._clockOffset) * 0.2;
                    }
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
                if (this.isHost || peerId !== this.hostConn?.peer) break;
                if (Array.isArray(data.players)) {
                    data.players.forEach(player => {
                        const meshPeerId = player?.peerId;
                        const meshPlayerId = player?.playerId || meshPeerId;
                        if (meshPeerId && meshPlayerId) this.allowedMeshPeers.set(meshPeerId, meshPlayerId);
                    });
                }
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
                if (!this.isHost && peerId === this.hostConn?.peer
                    && data.peerId && data.peerId !== this.peer?.id && data.peerId !== this.hostConn?.peer) {
                    this.allowedMeshPeers.set(data.peerId, data.playerId || data.peerId);
                    this.connectToPeer(data.peerId, data.playerId);
                }
                break;
            case 'peerLeft':
                // Host tells us a client left — clean up mesh connection
                if (!this.isHost && peerId === this.hostConn?.peer && data.peerId) {
                    this.connections.get(data.peerId)?.close();
                    this.connections.delete(data.peerId);
                    this.allowedMeshPeers.delete(data.peerId);
                }
                break;
            case 'taunt':
                if (this.game) this.game.handleRemoteTaunt(data);
                break;
            case 'blackHoleSpawn':
                if (!this.isHost && this.game.spawnBlackHoleAt) this.game.spawnBlackHoleAt(data.x, data.y, data.z);
                break;
            case 'blackHoleDespawn':
                if (!this.isHost) this.game.clearBlackHoles();
                break;
            case 'splitBallSpawn':
                if (!this.isHost && this.game.spawnSplitBallAt) this.game.spawnSplitBallAt(data);
                break;
            case 'chaosState':
                if (!this.isHost && this.game.applyChaosState) this.game.applyChaosState(data);
                break;
            case 'lobbyClosed':
                // Lobby kapandı — ana menüye dön.
                this._manualDisconnect = true;
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
    async connectToPeer(peerId, playerId = peerId) {
        this.allowedMeshPeers.set(peerId, playerId);
        if (this.connections.has(peerId) || this.pendingConnections.has(peerId) || peerId === this.peer?.id) {
            return this.pendingConnections.get(peerId);
        }
        const conn = this.peer.connect(peerId, {
            metadata: { name: this.playerName, playerId: this.playerId, isMesh: true }
        });
        const pending = new Promise((resolve) => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            conn.on('open', () => {
                this.connections.set(peerId, conn);
                this.peerToPlayerId.set(peerId, playerId);
                this._lastPositionSeq.delete(playerId);
                this.setupDataHandlers(conn);
                finish(true);
            });
            conn.on('close', () => {
                if (this.connections.get(peerId) === conn) {
                    this.connections.delete(peerId);
                    this.peerToPlayerId.delete(peerId);
                }
                finish(false);
            });
            conn.on('error', () => finish(false));
        });
        this.pendingConnections.set(peerId, pending);
        pending.finally(() => {
            if (this.pendingConnections.get(peerId) === pending) this.pendingConnections.delete(peerId);
        });
        return pending;
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
        this._positionSeq = (this._positionSeq + 1) & 0xffff;
        this.broadcastAllBinary(this.encodePosition({
            seq: this._positionSeq,
            playerId: this.playerId,
            x: position.x,
            y: position.y,
            z: position.z,
            ry: rotation,
            ...extra
        }));
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

    broadcastSkillEffect(skillId, playerId, peerId, pos) {
        if (!this.isHost) return;
        this.broadcast({ type: 'skillEffect', skill: skillId, playerId, peerId, pos });
    }

    // RTT ölçümü — nonce işaretlenir, periyodik olarak peer'a yollanır.
    sendPing() {
        if (!this.connected) return;
        this._pingAwait = { nonce: Math.random().toString(36).slice(2), t: performance.now() };
        this.send({ type: 'ping', nonce: this._pingAwait.nonce });
    }

    getPing() { return this._lastPing || 0; }
    getClockOffset() { return this._clockOffset || 0; }

    broadcastBlackHoleSpawn(x, y, z) {
        if (!this.isHost) return;
        this.broadcast({ type: 'blackHoleSpawn', x, y, z });
    }

    broadcastBlackHoleDespawn() {
        if (!this.isHost) return;
        this.broadcast({ type: 'blackHoleDespawn' });
    }

    broadcastSplitBallSpawn(x, y, z, vx, vy, vz) {
        if (!this.isHost) return;
        this.broadcast({ type: 'splitBallSpawn', x, y, z, vx, vy, vz });
    }

    broadcastChaosState(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'chaosState', ...state });
    }

    broadcastBallState(ball) {
        if (!this.isHost) return;
        this.broadcastBinary(this.encodeBallState({
            seq: this._ballSeq || 0,
            x: ball.position.x,
            y: ball.position.y,
            z: ball.position.z,
            vx: ball.velocity.x,
            vy: ball.velocity.y,
            vz: ball.velocity.z,
            speed: ball.currentSpeed,
            active: ball.active,
            affix: ball.affix ? { id: ball.affix.id || ball.affix.name, color: ball.affix.color } : null
        }));
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
        this._manualDisconnect = true;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        const conns = [...this.connections.values()];
        conns.forEach(conn => conn.close());
        this.connections.clear();
        this.peerToPlayerId.clear();
        this.playerConnections.clear();
        this.playerResumeTokens.clear();
        this.allowedMeshPeers.clear();
        this.pendingConnections.clear();
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
