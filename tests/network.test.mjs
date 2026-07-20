import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

import {
    NETWORK_SPEED_BOUND,
    NETWORK_WORLD_BOUND,
    Network,
    TARGET_ID_MAX_BYTES,
    isNewerSequence,
    isSafeTargetId,
    reconnectDelay
} from '../js/network.js';

test('position packet preserves movement and identity fields', () => {
    const network = new Network({});
    const encoded = network.encodePosition({
        seq: 42,
        x: 1, y: 2, z: 3,
        ry: 4,
        ax: 5, ay: 6, az: 7,
        vx: 8, vy: 9, vz: 10,
        alive: true,
        hp: 80,
        team: 'red',
        name: 'Player',
        charId: 'rally',
        playerId: 'player-stable'
    });
    const decoded = network._decodeBinary(encoded);

    assert.equal(decoded.type, 'position');
    assert.equal(decoded.seq, 42);
    assert.deepEqual(
        [decoded.x, decoded.y, decoded.z, decoded.vx, decoded.vy, decoded.vz],
        [1, 2, 3, 8, 9, 10]
    );
    assert.equal(decoded.hp, 80);
    assert.equal(decoded.name, 'Player');
    assert.equal(decoded.charId, 'rally');
    assert.equal(decoded.playerId, 'player-stable');
});

test('sequence ordering handles duplicates, stale packets, and wraparound', () => {
    assert.equal(isNewerSequence(11, 10), true);
    assert.equal(isNewerSequence(10, 10), false);
    assert.equal(isNewerSequence(9, 10), false);
    assert.equal(isNewerSequence(0, 65535), true);
    assert.equal(isNewerSequence(65535, 0), false);
});

test('stale position packets never reach the game', () => {
    let updates = 0;
    const network = new Network({ updateRemotePlayer: () => updates++ });
    network.handleMessage({ type: 'position', seq: 5, x: 1, y: 0, z: 1 }, 'peer');
    network.handleMessage({ type: 'position', seq: 5, x: 2, y: 0, z: 2 }, 'peer');
    network.handleMessage({ type: 'position', seq: 4, x: 3, y: 0, z: 3 }, 'peer');
    network.handleMessage({ type: 'position', seq: 6, x: 4, y: 0, z: 4 }, 'peer');
    assert.equal(updates, 2);
});

test('reconnect backoff is bounded', () => {
    assert.deepEqual([1, 2, 3, 4].map(reconnectDelay), [500, 1000, 2000, 2000]);
});

test('legacy position packet remains readable', () => {
    const network = new Network({});
    const buffer = new ArrayBuffer(30);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setFloat32(1, 1);
    view.setFloat32(5, 2);
    view.setFloat32(9, 3);
    view.setUint8(29, 0);

    const decoded = network._decodeBinary(buffer);
    assert.equal(decoded.x, 1);
    assert.equal(decoded.vx, 0);
    assert.equal(decoded.seq, undefined);
});

test('long legacy position packet is decoded structurally, not by total length', () => {
    const network = new Network({});
    const name = 'legacy-player-with-optional-fields';
    const nameBytes = new TextEncoder().encode(name);
    const buffer = new ArrayBuffer(34 + nameBytes.length);
    const view = new DataView(buffer);
    view.setUint8(0, 2);
    view.setFloat32(1, 1);
    view.setFloat32(5, 2);
    view.setFloat32(9, 3);
    view.setUint8(29, 1 | 2 | 4 | 8);
    view.setUint8(30, 1);
    view.setUint8(31, 75);
    view.setUint8(32, 0);
    view.setUint8(33, nameBytes.length);
    new Uint8Array(buffer, 34).set(nameBytes);

    const decoded = network._decodeBinary(buffer);
    assert.equal(buffer.byteLength > 44, true);
    assert.equal(decoded.name, name);
    assert.equal(decoded.alive, true);
    assert.equal(decoded.hp, 75);
    assert.equal(decoded.seq, undefined);
    assert.deepEqual([decoded.vx, decoded.vy, decoded.vz], [0, 0, 0]);
});

test('ball packet preserves stable target identity with legacy name fallback', () => {
    const network = new Network({});
    const modern = network._decodeBinary(network.encodeBallState({
        seq: 7,
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6,
        speed: 12,
        active: true,
        targetName: 'Duplicate Name',
        targetPlayerId: 'player-stable',
        targetPeerId: 'peer-current'
    }));
    assert.equal(modern.targetName, 'Duplicate Name');
    assert.equal(modern.targetPlayerId, 'player-stable');
    assert.equal(modern.targetPeerId, 'peer-current');

    const legacy = network._decodeBinary(network.encodeBallState({
        x: 1, y: 2, z: 3,
        vx: 0, vy: 0, vz: 0,
        speed: 8,
        active: true,
        targetName: 'Legacy Name'
    }));
    assert.equal(legacy.targetName, 'Legacy Name');
    assert.equal(legacy.targetPlayerId, undefined);
    assert.equal(legacy.targetPeerId, undefined);
});

test('host ball broadcast derives target playerId and peerId', () => {
    const target = { name: 'Remote', peerId: 'peer-new' };
    const network = new Network({
        player: {},
        remotePlayers: new Map([['player-stable', target]])
    });
    network.isHost = true;
    let packet;
    network.broadcastBinary = data => {
        packet = network._decodeBinary(data);
    };

    network.broadcastBallState({
        position: { x: 1, y: 2, z: 3 },
        velocity: { x: 4, y: 5, z: 6 },
        currentSpeed: 12,
        active: true,
        state: 'rally',
        targetPlayer: target,
        affix: null
    });

    assert.equal(packet.targetName, 'Remote');
    assert.equal(packet.targetPlayerId, 'player-stable');
    assert.equal(packet.targetPeerId, 'peer-new');
});

test('foreground and background host paths use the stable ball broadcast helper', () => {
    const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
    assert.equal((source.match(/this\.network\.broadcastBallState\((?:b|ball), this\._ballSeq\)/g) || []).length, 2);
    assert.doesNotMatch(source, /\btargetId\s*:/);
});

test('target ids use a strict charset and byte bound without codec truncation', () => {
    const network = new Network({});
    const valid = `player-${'a'.repeat(TARGET_ID_MAX_BYTES - 7)}`;
    assert.equal(isSafeTargetId(valid), true);
    for (const invalid of ['player with space', 'oyuncu-ş', `p${'x'.repeat(TARGET_ID_MAX_BYTES)}`]) {
        assert.equal(isSafeTargetId(invalid), false);
        const decoded = network._decodeBinary(network.encodeBallState({
            x: 1, y: 2, z: 3,
            vx: 0, vy: 0, vz: 0,
            speed: 8,
            active: true,
            targetName: 'Legacy',
            targetPlayerId: invalid,
            targetPeerId: invalid
        }));
        assert.equal(Object.hasOwn(decoded, 'targetPlayerId'), false);
        assert.equal(Object.hasOwn(decoded, 'targetPeerId'), false);
    }
});

test('binary decoder gracefully drops every truncated ball segment', () => {
    const network = new Network({});
    const packet = network.encodeBallState({
        seq: 1,
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6,
        speed: 12,
        active: true,
        state: 'rally',
        targetName: 'Legacy',
        affix: { id: 'burn', color: 0xff4400 },
        targetPlayerId: 'player-stable',
        targetPeerId: 'peer-current'
    });
    for (let length = 0; length < packet.byteLength; length++) {
        assert.equal(network._decodeBinary(packet.slice(0, length)), null, `length ${length}`);
    }
    assert.equal(network._decodeBinary(packet)?.targetPlayerId, 'player-stable');
});

test('JSON ball target ids are sanitized while legacy names remain compatible', () => {
    const network = new Network({});
    const base = {
        type: 'ballState',
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6,
        speed: 12,
        targetName: 'Legacy'
    };
    assert.equal(network._validateMsg(base), true);
    assert.equal(network._validateMsg({ ...base, targetPlayerId: 'player-stable' }), true);
    assert.equal(network._validateMsg({ ...base, targetPlayerId: 'bad id' }), false);
    assert.equal(network._validateMsg({ ...base, targetPeerId: 'x'.repeat(TARGET_ID_MAX_BYTES + 1) }), false);
});

test('malformed and out-of-bounds motion packets are dropped without mutation', () => {
    let positions = 0;
    let balls = 0;
    const network = new Network({
        updateRemotePlayer: () => positions++,
        updateBallFromNetwork: () => balls++
    });
    network.hostConn = { peer: 'host-peer' };
    const position = {
        type: 'position',
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6
    };
    const ball = {
        type: 'ballState',
        x: 1, y: 2, z: 3,
        vx: 4, vy: 5, vz: 6,
        speed: 12
    };
    for (const malformed of [
        { ...position, x: Number.NaN },
        { ...position, y: Number.POSITIVE_INFINITY },
        { ...position, z: NETWORK_WORLD_BOUND + 1 },
        { ...position, vx: NETWORK_SPEED_BOUND + 1 }
    ]) network.handleMessage(malformed, 'peer-a');
    for (const malformed of [
        { ...ball, vx: Number.NaN },
        { ...ball, vy: Number.NEGATIVE_INFINITY },
        { ...ball, z: NETWORK_WORLD_BOUND + 1 },
        { ...ball, speed: NETWORK_SPEED_BOUND + 1 }
    ]) network.handleMessage(malformed, 'host-peer');

    assert.equal(positions, 0);
    assert.equal(balls, 0);
    assert.equal(network._decodeBinary(network.encodePosition({
        x: Number.NaN, y: 0, z: 0
    })), null);
    assert.equal(network._decodeBinary(network.encodeBallState({
        x: 0, y: 0, z: 0,
        vx: Number.POSITIVE_INFINITY, vy: 0, vz: 0,
        speed: 1
    })), null);
});

test('playerId persists in session storage and constructor tolerates no storage', () => {
    const original = globalThis.sessionStorage;
    const values = new Map();
    globalThis.sessionStorage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
    };
    try {
        const first = new Network({});
        const second = new Network({});
        assert.equal(second.playerId, first.playerId);
        assert.equal(second.resumeToken, first.resumeToken);
    } finally {
        if (original === undefined) delete globalThis.sessionStorage;
        else globalThis.sessionStorage = original;
    }
    assert.ok(new Network({}).playerId);
});

function fakeConn(peer, metadata = {}) {
    const conn = new EventEmitter();
    const transportMetadata = { ...metadata };
    const resumeToken = transportMetadata.resumeToken;
    delete transportMetadata.resumeToken;
    Object.assign(conn, {
        peer, metadata: transportMetadata, _resumeToken: resumeToken,
        open: true, sent: [], closed: false
    });
    conn.send = data => conn.sent.push(data);
    conn.close = () => {
        if (conn.closed) return;
        conn.closed = true;
        conn.open = false;
        conn.emit('close');
    };
    return conn;
}

async function completeIdentityAdmission(network, conn, ...joins) {
    network._onIncomingConnection(conn);
    conn.emit('open');
    const join = joins[0] || {};
    const challenge = conn.sent.at(-1);
    assert.equal(challenge?.type, 'resumeChallenge');
    conn.emit('data', {
        type: 'resumeResponse',
        nonce: challenge.nonce,
        playerId: join.playerId ?? conn.metadata.playerId,
        name: join.name ?? conn.metadata.name,
        password: join.password ?? conn.metadata.password ?? '',
        avatar: join.avatar ?? '',
        ...(conn._resumeToken === undefined
            ? {}
            : { resumeToken: conn._resumeToken })
        , capabilities: { positionV2: true, migrationVotes: true }
    });
    for (const extra of joins.slice(1)) conn.emit('data', extra);
    const admission = network.pendingIdentityAdmissions.get(conn.metadata.playerId)?.promise;
    await admission;
}

function startIdentityAdmission(network, conn) {
    network._onIncomingConnection(conn);
    conn.emit('open');
    const challenge = conn.sent.at(-1);
    assert.equal(challenge?.type, 'resumeChallenge');
    return {
        challenge
    };
}

function waitForClose(conn) {
    if (conn.closed) return Promise.resolve();
    return new Promise(resolve => conn.once('close', resolve));
}

function configureMigration(network) {
    const candidates = [
        {
            playerId: 'player-a',
            peerId: 'peer-a',
            eligible: true,
            connected: true,
            spectator: false,
            ping: 50,
            stability: 1,
            uptime: 1000,
            packetLoss: 0
        },
        {
            playerId: 'player-b',
            peerId: 'peer-b',
            eligible: true,
            connected: true,
            spectator: false,
            ping: 50,
            stability: 1,
            uptime: 1000,
            packetLoss: 0
        },
        {
            playerId: 'player-c',
            peerId: 'peer-c',
            eligible: true,
            connected: true,
            spectator: false,
            ping: 50,
            stability: 1,
            uptime: 1000,
            packetLoss: 0
        }
    ];
    network._migrationActive = true;
    network._migrationElection = {
        epoch: 3,
        candidates,
        selected: candidates[0],
        roster: candidates.map(({ playerId, peerId }) => ({ playerId, peerId })),
        votes: candidates.map(({ playerId }) => ({
            voterId: playerId,
            candidateId: 'player-a',
            epoch: 3
        }))
    };
    for (const candidate of candidates) {
        network.connections.set(candidate.peerId, fakeConn(candidate.peerId));
    }
    return network._migrationElection;
}

test('host migration rejects unauthorized, wrong-candidate, wrong-epoch and no-quorum proposals', () => {
    const proposals = [
        election => ({
            epoch: 99,
            candidateId: 'player-a',
            hostPeerId: 'peer-a',
            roster: election.roster,
            votes: election.votes
        }),
        election => ({
            epoch: 3,
            candidateId: 'player-b',
            hostPeerId: 'peer-b',
            roster: election.roster,
            votes: election.votes.map(vote => ({ ...vote, candidateId: 'player-b' }))
        }),
        election => ({
            epoch: 3,
            candidateId: 'player-a',
            hostPeerId: 'peer-a',
            roster: election.roster,
            votes: [election.votes[0]]
        })
    ];
    for (const build of proposals) {
        const network = new Network({});
        network.migrationEpoch = 2;
        const election = configureMigration(network);
        const proposal = build(election);
        network._acceptHostMigration(proposal, proposal.hostPeerId);
        assert.equal(network.migrationEpoch, 2);
        assert.equal(network.hostConn, null);
        assert.equal(network._migrationActive, true);
    }

    const outsider = new Network({});
    outsider.migrationEpoch = 2;
    const election = configureMigration(outsider);
    outsider.connections.set('peer-evil', fakeConn('peer-evil'));
    outsider._acceptHostMigration({
        epoch: 3,
        candidateId: 'player-a',
        hostPeerId: 'peer-evil',
        roster: election.roster,
        votes: election.votes
    }, 'peer-evil');
    assert.equal(outsider.migrationEpoch, 2);
    assert.equal(outsider.hostConn, null);
});

test('host admits each connection once while preserving join avatar', async () => {
    const joins = [];
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    });
    network.isHost = true;
    network.onPlayerJoin = (...args) => joins.push(args);
    const conn = fakeConn('peer-a', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    const join = { type: 'join', name: 'A', playerId: 'player-a', avatar: 'avatar' };

    await completeIdentityAdmission(network, conn, join, join);

    assert.deepEqual(joins, [['A', 'player-a', 'avatar', 'peer-a']]);
    assert.deepEqual(network.peerCapabilities.get('peer-a'), {
        positionV2: true,
        migrationVotes: true
    });
});

test('active connection rejects replacement and closed identity resumes with its token', async () => {
    const leaves = [];
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    network.onPlayerLeave = (...args) => leaves.push(args);
    const oldConn = fakeConn('peer-old', { name: 'A', playerId: 'player-a', resumeToken: 'resume-a' });
    const newConn = fakeConn('peer-new', { name: 'A', playerId: 'player-a', resumeToken: 'resume-a' });

    await completeIdentityAdmission(network, oldConn, {
        type: 'join',
        name: 'A',
        playerId: 'player-a'
    });
    network._onIncomingConnection(newConn);
    newConn.emit('open');
    assert.equal(network.playerConnections.get('player-a'), oldConn);
    assert.equal(newConn.sent[0]?.reason, 'duplicate_identity');
    assert.equal(newConn.sent.some(packet => packet.type === 'resumeChallenge'), false);

    oldConn.close();
    const resumed = fakeConn('peer-resumed', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    await completeIdentityAdmission(network, resumed, {
        type: 'join',
        name: 'A',
        playerId: 'player-a'
    });

    assert.equal(network.playerConnections.get('player-a'), resumed);
    assert.deepEqual(leaves, [['player-a', 'peer-old']]);
});

test('active identity cannot be replaced without its resume token', async () => {
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    const oldConn = fakeConn('peer-old', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    const attacker = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-a'
    });

    await completeIdentityAdmission(network, oldConn);
    network._onIncomingConnection(attacker);
    attacker.emit('open');

    assert.equal(network.playerConnections.get('player-a'), oldConn);
    assert.deepEqual(attacker.sent, [{
        type: 'kick',
        name: 'Evil',
        reason: 'duplicate_identity'
    }]);
});

test('disconnected identity still requires its original resume token', async () => {
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    const oldConn = fakeConn('peer-old', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });
    const attacker = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-a',
        resumeToken: 'resume-evil'
    });

    await completeIdentityAdmission(network, oldConn);
    oldConn.close();
    const { challenge } = startIdentityAdmission(network, attacker);
    attacker.emit('data', {
        type: 'resumeResponse',
        nonce: challenge.nonce,
        playerId: 'player-a',
        name: 'Evil',
        password: '',
        avatar: '',
        resumeToken: 'resume-evil',
        capabilities: { positionV2: true, migrationVotes: true }
    });
    const admission = network.pendingIdentityAdmissions.get('player-a')?.promise;
    assert.ok(admission);
    assert.equal(await admission, false);
    await waitForClose(attacker);

    const missing = fakeConn('peer-missing', {
        name: 'Missing',
        playerId: 'player-a'
    });
    const missingStart = startIdentityAdmission(network, missing);
    missing.emit('data', {
        type: 'resumeResponse',
        nonce: missingStart.challenge.nonce,
        playerId: 'player-a',
        name: 'Missing',
        password: '',
        avatar: '',
        capabilities: { positionV2: true, migrationVotes: true }
    });
    const missingAdmission = network.pendingIdentityAdmissions.get('player-a')?.promise;
    assert.equal(missingAdmission, undefined);
    await waitForClose(missing);

    const resumed = fakeConn('peer-resumed', {
        name: 'A',
        playerId: 'player-a'
    });
    const resumedStart = startIdentityAdmission(network, resumed);
    resumed.emit('data', {
        type: 'resumeResponse',
        nonce: resumedStart.challenge.nonce,
        playerId: 'player-a',
        name: 'A',
        password: '',
        avatar: '',
        resumeToken: 'resume-a',
        capabilities: { positionV2: true, migrationVotes: true }
    });
    const resumedAdmission = network.pendingIdentityAdmissions.get('player-a')?.promise;
    assert.ok(resumedAdmission);
    assert.equal(await resumedAdmission, true);

    assert.equal(network.playerConnections.get('player-a'), resumed);
    assert.equal(attacker.closed, true);
    assert.equal(attacker.sent.some(packet => packet?.type === 'kick'), true);
    assert.equal(attacker.sent.some(packet => Object.prototype.hasOwnProperty.call(packet ?? {}, 'resumeToken')), false);
    assert.equal(attacker.sent.some(packet => JSON.stringify(packet).includes('resume-')), false);
});

test('join payload cannot claim an identity different from transport metadata', async () => {
    const joins = [];
    const game = { getPlayerList: () => [], state: 'lobby', scoreboard: {} };
    const network = new Network(game);
    network.isHost = true;
    network.onPlayerJoin = (...args) => joins.push(args);
    const conn = fakeConn('peer-a', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });

    await completeIdentityAdmission(network, conn, {
        type: 'join',
        name: 'A',
        playerId: 'player-b'
    });

    assert.deepEqual(joins, []);
    assert.equal(conn._admitted, undefined);
    assert.equal(conn.closed, true);
});

test('host ignores gameplay packets until transport completes admission', () => {
    let attacks = 0;
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {},
        remoteAttack: () => attacks++
    });
    network.isHost = true;
    const conn = fakeConn('peer-a', {
        name: 'A',
        playerId: 'player-a',
        resumeToken: 'resume-a'
    });

    network._handleJoinConn(conn);
    network.handleMessage({ type: 'attack', name: 'A', x: 0, y: 0 }, 'peer-a');

    assert.equal(attacks, 0);
});

test('host rejects mesh connections and client requires host-announced identity', () => {
    const host = new Network({});
    host.isHost = true;
    const hostMesh = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    host._onIncomingConnection(hostMesh);
    hostMesh.emit('open');
    assert.equal(hostMesh.closed, true);

    const client = new Network({});
    const unknown = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    client._handleMeshConn(unknown);
    assert.equal(unknown.closed, true);

    const known = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    client.allowedMeshPeers.set('peer-a', 'player-a');
    client._handleMeshConn(known);
    assert.equal(client.connections.get('peer-a'), known);
});

test('direct position packet cannot spoof another logical player', () => {
    const updates = [];
    const network = new Network({
        updateRemotePlayer: (...args) => updates.push(args)
    });
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'position',
        playerId: 'player-b',
        seq: 1,
        x: 1,
        z: 2
    }, 'peer-a');

    assert.deepEqual(updates, []);
});

test('host-relayed position keeps the logical player identity', () => {
    const updates = [];
    const network = new Network({
        updateRemotePlayer: (...args) => updates.push(args)
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({
        type: 'position',
        peerId: 'mesh-peer',
        playerId: 'player-a',
        seq: 1,
        x: 1,
        y: 0,
        z: 2
    }, 'host-peer');

    assert.equal(updates.length, 1);
    assert.equal(updates[0][0], 'player-a');
    assert.equal(updates[0][2], 'mesh-peer');
});

test('concurrent mesh connect shares one pending transport', async () => {
    let connects = 0;
    const conn = fakeConn('peer-b');
    const network = new Network({});
    network.peer = {
        id: 'self',
        connect() {
            connects++;
            return conn;
        }
    };

    const first = network.connectToPeer('peer-b');
    const second = network.connectToPeer('peer-b');
    assert.equal(connects, 1);
    conn.emit('open');
    await Promise.all([first, second]);
    assert.equal(network.connections.get('peer-b'), conn);
});

test('social presence and chat reject malformed packets', () => {
    const presence = [];
    const chat = [];
    const network = new Network({});
    network.onSocialPresence = data => presence.push(data);
    network.onSocialChat = data => chat.push(data);

    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: 1, y: 2 }, 'peer');
    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: Infinity, y: 2, z: 3 }, 'peer');
    network.handleMessage({ type: 'socialChat', name: 'Player', text: 'x'.repeat(161) }, 'peer');
    network.handleMessage({ type: 'socialPresence', playerId: 'p1', x: 1, y: 2, z: 3 }, 'peer');
    network.handleMessage({ type: 'socialChat', playerId: 'p1', name: 'Player', text: 'hello' }, 'peer');

    assert.equal(presence.length, 1);
    assert.equal(chat.length, 1);
});

test('host rejects spoofed social identity', () => {
    let presence = 0;
    const network = new Network({});
    network.isHost = true;
    network.onSocialPresence = () => presence++;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'socialPresence',
        playerId: 'player-b',
        x: 1,
        y: 2,
        z: 3
    }, 'peer-a');

    assert.equal(presence, 0);
});

test('host rate limits social packets per peer and type', () => {
    let presence = 0;
    const network = new Network({});
    network.isHost = true;
    network.onSocialPresence = () => presence++;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    for (let i = 0; i < 100; i++) {
        network.handleMessage({
            type: 'socialPresence',
            playerId: 'player-a',
            x: 1,
            y: 2,
            z: 3
        }, 'peer-a');
    }

    assert.equal(presence, 30);
});

test('rematch messages validate ids, booleans, and bounded rosters', () => {
    const network = new Network({});
    assert.equal(network._validateMsg({
        type: 'rematchReady',
        sourceMatchId: 'match-a',
        ready: true
    }), true);
    assert.equal(network._validateMsg({
        type: 'rematchReady',
        sourceMatchId: '<script>',
        ready: true
    }), false);
    assert.equal(network._validateMsg({
        type: 'rematchReady',
        sourceMatchId: 'match-a',
        ready: 'yes'
    }), false);
    assert.equal(network._validateMsg({
        type: 'rematchState',
        sourceMatchId: 'match-a',
        requiredPlayerIds: Array(65).fill('player-a'),
        readyPlayerIds: [],
        complete: false
    }), false);
    assert.equal(network._validateMsg({
        type: 'rematchStart',
        sourceMatchId: 'match-a',
        matchId: 'match-b'
    }), true);
});

test('host binds and rate limits rematch readiness per admitted transport', () => {
    let readiness = 0;
    const network = new Network({});
    network.isHost = true;
    network.onRematchReady = ({ playerId }) => {
        assert.equal(playerId, 'player-a');
        readiness++;
    };
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    for (let i = 0; i < 100; i++) {
        network.handleMessage({
            type: 'rematchReady',
            sourceMatchId: 'match-a',
            ready: true,
            playerId: 'spoofed'
        }, 'peer-a');
    }
    assert.equal(readiness, 4);

    const outsider = new Network({});
    outsider.isHost = true;
    outsider.onRematchReady = () => readiness++;
    outsider.handleMessage({
        type: 'rematchReady',
        sourceMatchId: 'match-a',
        ready: true
    }, 'unknown-peer');
    assert.equal(readiness, 4);
});

test('closing a connection clears its rematch rate state', () => {
    const network = new Network({});
    const conn = fakeConn('peer-a');
    network.connections.set('peer-a', conn);
    network.setupDataHandlers(conn);
    network._allowSocialPacket('peer-a', 'rematchReady');
    assert.equal(network._socialRate.has('peer-a:rematchReady'), true);
    conn.close();
    assert.equal(network._socialRate.has('peer-a:rematchReady'), false);
});

test('closing a peer clears its social rate state', () => {
    const network = new Network({});
    const conn = fakeConn('peer-a');
    network.connections.set('peer-a', conn);
    network._allowSocialPacket('peer-a', 'socialPresence', 1);
    network._allowSocialPacket('peer-a', 'socialChat', 1);
    network._socialRate.set('peer-a:futureSocialPacket', {
        count: 1,
        startedAt: Date.now()
    });
    network.setupDataHandlers(conn);

    conn.emit('close');

    assert.equal(network._socialRate.size, 0);
});

test('social send helpers sanitize chat and include identity', () => {
    const sent = [];
    const network = new Network({});
    network.connected = true;
    network.playerId = 'player-1';
    network.playerName = 'Rally';
    network.send = data => sent.push(data);

    assert.equal(network.sendSocialChat('  hello hub  '), true);
    network.sendSocialPresence({ x: 1, y: 2, z: 3 }, 0.5, 'character-f');

    assert.deepEqual(sent[0], {
        type: 'socialChat',
        playerId: 'player-1',
        name: 'Rally',
        text: 'hello hub'
    });
    assert.equal(sent[1].skin, 'character-f');
    assert.equal(sent[1].ry, 0.5);
});

test('late-join team selection uses transport-bound identity', () => {
    const selections = [];
    const game = { remotePlayers: new Map([['player-a', { name: 'Alice' }]]) };
    const network = new Network(game);
    network.isHost = true;
    network.onLateJoinTeam = (playerId, team) => selections.push([playerId, team]);
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.peerToPlayerId.set('peer-a', 'player-a');

    network.handleMessage({
        type: 'lateJoinTeam',
        playerId: 'player-b',
        team: 'blue'
    }, 'peer-a');

    assert.deepEqual(selections, [['player-a', 'blue']]);
});

test('system chat is accepted only from the host transport', () => {
    const messages = [];
    const network = new Network({
        addChatMessage: (name, text) => messages.push([name, text])
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({ type: 'systemChat', text: 'trusted' }, 'host-peer');
    network.handleMessage({ type: 'systemChat', text: 'spoofed' }, 'mesh-peer');

    assert.deepEqual(messages, [['SERVER', 'trusted']]);
});

test('round and lobby state are accepted only from the host transport', () => {
    let rounds = 0;
    let lobbies = 0;
    const network = new Network({
        startRoundFromNetwork: () => rounds++,
        applyLobbyState: () => lobbies++
    });
    network.hostConn = { peer: 'host-peer' };

    network.handleMessage({ type: 'roundStart' }, 'mesh-peer');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'mesh-peer');
    network.handleMessage({ type: 'roundStart' }, 'host-peer');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'host-peer');

    assert.equal(rounds, 1);
    assert.equal(lobbies, 1);
});

test('mode and map changes are accepted only from the host transport', () => {
    let modes = 0;
    let maps = 0;
    const network = new Network({
        applyModeChange: () => modes++,
        applyMapChange: () => maps++
    });
    network.hostConn = { peer: 'host-peer' };
    network.handleMessage({ type: 'modeChange', modeId: 'rally_duel' }, 'mesh-peer');
    network.handleMessage({ type: 'mapChange', mapId: 'industrial' }, 'mesh-peer');
    network.handleMessage({ type: 'modeChange', modeId: 'rally_duel' }, 'host-peer');
    network.handleMessage({ type: 'mapChange', mapId: 'industrial' }, 'host-peer');
    assert.equal(modes, 1);
    assert.equal(maps, 1);
});

test('skill and power-up presentation state is accepted only from the host transport', () => {
    let skills = 0;
    let states = 0;
    let grants = 0;
    const network = new Network({
        handleSkillEffect: () => skills++,
        applyPowerUpState: () => states++,
        applyPowerUpGrant: () => grants++
    });
    network.hostConn = { peer: 'host-peer' };
    for (const peerId of ['mesh-peer', 'host-peer']) {
        network.handleMessage({ type: 'skillEffect', skill: 'dash' }, peerId);
        network.handleMessage({ type: 'powerUpState', powerUps: [] }, peerId);
        network.handleMessage({ type: 'powerUpGranted', playerId: 'local' }, peerId);
    }
    assert.equal(skills, 1);
    assert.equal(states, 1);
    assert.equal(grants, 1);
});

test('host rejects client-authored mode and map changes', () => {
    let modes = 0;
    let maps = 0;
    const network = new Network({
        applyModeChange: () => modes++,
        applyMapChange: () => maps++
    });
    network.isHost = true;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);
    network.handleMessage({ type: 'modeChange', modeId: 'rally_duel' }, 'peer-a');
    network.handleMessage({ type: 'mapChange', mapId: 'industrial' }, 'peer-a');
    assert.equal(modes, 0);
    assert.equal(maps, 0);
});

test('host rejects client-authored round and lobby state', () => {
    let rounds = 0;
    let lobbies = 0;
    const network = new Network({
        startRoundFromNetwork: () => rounds++,
        applyLobbyState: () => lobbies++
    });
    network.isHost = true;
    const conn = fakeConn('peer-a');
    conn._admitted = true;
    network.connections.set('peer-a', conn);

    network.handleMessage({ type: 'roundStart' }, 'peer-a');
    network.handleMessage({ type: 'lobbyState', players: [] }, 'peer-a');

    assert.equal(rounds, 0);
    assert.equal(lobbies, 0);
});
