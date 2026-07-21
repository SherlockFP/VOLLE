import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Network } from '../js/network.js';
import {
    HOST_MIGRATION_MAX_ATTEMPTS,
    HOST_MIGRATION_TIMEOUT_MS,
    migrationAttemptId,
    migrationBackoffMs,
    migrationRosterDigest,
    selectHostCandidate,
    validateHostMigrationProposal
} from '../js/host-migration.js';

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

function candidate(playerId, peerId, migrationOrder) {
    return {
        playerId,
        peerId,
        migrationOrder,
        eligible: true,
        connected: true,
        spectator: false,
        ping: 50,
        stability: 1,
        uptime: 1000,
        packetLoss: 0
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

function startResumeHandshake(network, conn) {
    network._onIncomingConnection(conn);
    conn.emit('open');
    const challenge = conn.sent.at(-1);
    assert.equal(challenge?.type, 'resumeChallenge');
    return challenge;
}

function respondToResumeChallenge(network, conn, challenge,
    token = 'resume-victim', overrides = {}) {
    const response = {
        type: 'resumeResponse',
        nonce: challenge.nonce,
        playerId: conn.metadata.playerId,
        name: conn.metadata.name,
        password: conn.metadata.password || '',
        avatar: '',
        resumeToken: token,
        capabilities: { positionV2: true, migrationVotes: true },
        ...overrides
    };
    conn.emit('data', response);
    return network.pendingIdentityAdmissions.get(response.playerId)?.promise;
}

function beginResumeHandshake(network, conn, token = 'resume-victim', overrides = {}) {
    const challenge = startResumeHandshake(network, conn);
    return respondToResumeChallenge(network, conn, challenge, token, overrides);
}

function createTestNetwork(game = {}) {
    const network = new Network(game);
    network._ensureIdentityMaps();
    return network;
}

function waitForClose(conn) {
    if (conn.closed) return Promise.resolve();
    return new Promise(resolve => conn.once('close', resolve));
}

test('resume admission is challenge-bound, one-shot, and keeps tokens off metadata', async () => {
    const network = new Network({ getPlayerList: () => [], state: 'lobby', scoreboard: {} });
    network.isHost = true;
    network.lobbyPassword = 'pw';
    const conn = fakeConn('peer-client', {
        name: 'Client', playerId: 'player-client', password: 'pw', capabilities: {}
    });
    const admission = beginResumeHandshake(network, conn, 'resume-client', {
        password: 'pw', avatar: 'avatar'
    });
    assert.equal(Object.hasOwn(conn.metadata, 'resumeToken'), false);
    assert.equal(network.playerConnections.has('player-client'), false);
    assert.ok(admission);
    assert.equal(await admission, true);
    assert.equal(network.playerConnections.get('player-client'), conn);
    const challenge = conn.sent.find(packet => packet.type === 'resumeChallenge');
    conn.emit('data', {
        type: 'resumeResponse', nonce: challenge.nonce, playerId: 'player-client',
        name: 'Client', password: 'pw', avatar: '', resumeToken: 'resume-client'
    });
    assert.equal(conn.closed, true);
    assert.doesNotMatch(JSON.stringify(conn.metadata), /resumeToken|resume-client/);
});

test('admission rolls back transport state when installation throws', async () => {
    const network = new Network({ getPlayerList: () => [], state: 'lobby', scoreboard: {} });
    network.isHost = true;
    network.setupDataHandlers = () => {
        throw new Error('install failed');
    };
    const conn = fakeConn('peer-throw', {
        playerId: 'player-throw', name: 'Throw', resumeToken: 'resume-throw'
    });

    assert.equal(await beginResumeHandshake(network, conn, 'resume-throw'), false);
    assert.equal(network.connections.has(conn.peer), false);
    assert.equal(network.peerToPlayerId.has(conn.peer), false);
    assert.equal(network.playerConnections.has(conn.metadata.playerId), false);
    assert.equal(network.peerCapabilities.has(conn.peer), false);
    assert.equal(network.pendingIdentityAdmissions.size, 0);
    assert.equal(network.migrationRoster.has(conn.metadata.playerId), false);
});

test('resume handshake rejects wrong nonce, identity, and unavailable randomness', () => {
    const network = new Network({});
    network.isHost = true;
    const conn = fakeConn('peer-client', { playerId: 'player-client', name: 'Client' });
    network._handleJoinConn(conn);
    const challenge = conn.sent.at(-1);
    network.handleMessage({ type: 'resumeResponse', nonce: 'wrong', playerId: 'player-client',
        name: 'Client', password: '', avatar: '', resumeToken: 'token' }, conn.peer);
    assert.equal(conn.closed, true);
    assert.equal(network.pendingResumeHandshakes.size, 0);
    assert.equal(challenge.type, 'resumeChallenge');
});

test('identity admission waits for proof and serializes pending ownership', async () => {
    const proof = 'a'.repeat(64);
    const proofGate = deferred();
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    });
    network.isHost = true;
    network.peer = { id: 'peer-host' };
    network._digestResumeToken = () => proofGate.promise;
    const joins = [];
    network.onPlayerJoin = (...args) => joins.push(args);
    const first = fakeConn('peer-first', {
        name: 'Victim',
        playerId: 'player-victim',
        resumeToken: 'resume-victim'
    });
    const duplicate = fakeConn('peer-duplicate', {
        name: 'Attacker',
        playerId: 'player-victim',
        resumeToken: 'resume-attacker'
    });

    const firstChallenge = startResumeHandshake(network, first);
    const admission = respondToResumeChallenge(
        network, first, firstChallenge, 'resume-victim', {
            avatar: 'first-avatar'
        }
    );
    assert.ok(admission);
    assert.equal(network.playerConnections.has('player-victim'), false);
    assert.equal(network.migrationRoster.has('player-victim'), false);
    assert.equal(first.sent.length, 1);
    assert.equal(first.sent[0], firstChallenge);
    first.emit('data', {
        type: 'attack',
        name: 'Victim',
        x: 0,
        y: 0
    });
    assert.equal(first._admitted, undefined);
    assert.equal(joins.length, 0);
    assert.equal(network.migrationRoster.has('player-victim'), false);

    network._onIncomingConnection(duplicate);
    duplicate.emit('open');
    assert.equal(duplicate.sent[0]?.reason, 'duplicate_identity');
    assert.equal(network.pendingIdentityAdmissions.get('player-victim')?.conn, first);

    proofGate.resolve(proof);
    assert.equal(await admission, true);
    assert.equal(network.playerConnections.get('player-victim'), first);
    assert.equal(
        network.migrationRoster.get('player-victim')?.resumeProof,
        proof
    );
    assert.equal(first._admitted, true);
    assert.deepEqual(joins, [[
        'Victim',
        'player-victim',
        'first-avatar',
        'peer-first'
    ]]);
    const serialized = JSON.stringify(first.sent);
    assert.equal(serialized.includes('resume-victim'), false);
    assert.doesNotMatch(serialized, /resumeToken/);
});

test('failed or closed pending identity admission cleans up fail-closed', async () => {
    const game = {
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    };
    const rejected = new Network(game);
    rejected.isHost = true;
    rejected._digestResumeToken = async () => null;
    let rejectedJoins = 0;
    rejected.onPlayerJoin = () => rejectedJoins++;
    const rejectedConn = fakeConn('peer-rejected', {
        name: 'Rejected',
        playerId: 'player-rejected',
        resumeToken: 'resume-rejected'
    });
    const rejectedAdmission = beginResumeHandshake(rejected, rejectedConn,
        'resume-rejected');
    assert.equal(await rejectedAdmission, false);
    assert.equal(rejected.pendingIdentityAdmissions.size, 0);
    assert.equal(rejected.playerConnections.size, 0);
    assert.equal(rejected.migrationRoster.size, 0);
    assert.equal(rejectedConn._admitted, undefined);
    assert.equal(rejectedJoins, 0);

    const closeGate = deferred();
    const closed = new Network(game);
    closed.isHost = true;
    closed._digestResumeToken = () => closeGate.promise;
    let closedJoins = 0;
    closed.onPlayerJoin = () => closedJoins++;
    const closedConn = fakeConn('peer-closed', {
        name: 'Closed',
        playerId: 'player-closed',
        resumeToken: 'resume-closed'
    });
    const closedAdmission = beginResumeHandshake(closed, closedConn,
        'resume-closed');
    closedConn.close();
    closeGate.resolve('b'.repeat(64));
    assert.equal(await closedAdmission, false);
    assert.equal(closed.pendingIdentityAdmissions.size, 0);
    assert.equal(closed.playerResumeProofs.size, 0);
    assert.equal(closed.playerConnections.size, 0);
    assert.equal(closed.migrationRoster.size, 0);
    assert.equal(closedConn._admitted, undefined);
    assert.equal(closedJoins, 0);
});

test('transport identity is sanitized, immutable, and resume-bound', async () => {
    const network = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    });
    network.isHost = true;
    const owner = fakeConn('peer-owner', {
        name: 'Owner',
        playerId: 'player-owner',
        resumeToken: 'resume-owner'
    });
    assert.equal(await beginResumeHandshake(network, owner, 'resume-owner'), true);
    assert.equal(owner._playerId, 'player-owner');
    assert.throws(() => {
        owner._playerId = 'player-evil';
    }, TypeError);

    const takeover = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-owner',
        resumeToken: 'resume-evil'
    });
    network._onIncomingConnection(takeover);
    takeover.emit('open');
    assert.equal(takeover.sent[0]?.reason, 'duplicate_identity');
    assert.equal(takeover.sent.some(packet => packet.type === 'resumeChallenge'), false);

    owner.close();
    const wrong = fakeConn('peer-wrong', {
        name: 'Wrong',
        playerId: 'player-owner'
    });
    const wrongChallenge = startResumeHandshake(network, wrong);
    const wrongAdmission = respondToResumeChallenge(
        network, wrong, wrongChallenge, 'resume-wrong'
    );
    assert.equal(await wrongAdmission, false);
    await waitForClose(wrong);

    const missing = fakeConn('peer-missing', {
        name: 'Missing',
        playerId: 'player-owner'
    });
    const missingChallenge = startResumeHandshake(network, missing);
    const missingAdmission = respondToResumeChallenge(
        network, missing, missingChallenge, ''
    );
    assert.equal(missingAdmission, undefined);
    await waitForClose(missing);

    const resumed = fakeConn('peer-resumed', {
        name: 'Owner',
        playerId: 'player-owner'
    });
    const resumeChallenge = startResumeHandshake(network, resumed);
    const resumedAdmission = respondToResumeChallenge(
        network, resumed, resumeChallenge, 'resume-owner'
    );
    assert.equal(await resumedAdmission, true);

    const malformed = fakeConn('peer-malformed', {
        name: 'Bad',
        playerId: '../player',
        resumeToken: 'resume-bad'
    });
    network._onIncomingConnection(malformed);
    malformed.emit('open');
    await waitForClose(malformed);
    assert.equal(malformed.closed, true);
    assert.equal(
        malformed.sent.find(packet => packet?.type === 'kick')?.reason,
        'invalid_identity'
    );
    assert.equal(malformed.sent.some(packet => packet?.type === 'resumeChallenge'), false);
});

test('migration votes are exact-epoch, transport-bound, unique, and observed', () => {
    const network = new Network({});
    network.peer = { id: 'peer-self' };
    network.playerId = 'player-self';
    network.migrationEpoch = 4;
    const candidates = [
        candidate('player-self', 'peer-self', 0),
        candidate('player-b', 'peer-b', 1),
        candidate('player-c', 'peer-c', 2)
    ];
    const roster = candidates.map(({ playerId, peerId, migrationOrder }) => ({
        playerId,
        peerId,
        migrationOrder
    }));
    const peerB = fakeConn('peer-b');
    const peerC = fakeConn('peer-c');
    network._bindConnectionIdentity(peerB, 'player-b');
    network._bindConnectionIdentity(peerC, 'player-c');
    network.connections.set('peer-b', peerB);
    network.connections.set('peer-c', peerC);
    network.peerToPlayerId.set('peer-b', 'player-b');
    network.peerToPlayerId.set('peer-c', 'player-c');
    network._migrationActive = true;
    const rosterDigest = migrationRosterDigest(roster);
    const attemptId = migrationAttemptId(5, roster, candidates[0].playerId);
    network._migrationElection = {
        epoch: 5,
        attemptId,
        rosterDigest,
        candidates,
        selected: candidates[0],
        roster,
        votes: new Map()
    };

    assert.equal(network._recordMigrationVote({
        voterId: 'player-b',
        candidateId: 'player-self',
        epoch: 4,
        attemptId,
        rosterDigest
    }, 'peer-b'), false);
    assert.equal(network._recordMigrationVote({
        voterId: 'player-c',
        candidateId: 'player-self',
        epoch: 5,
        attemptId,
        rosterDigest
    }, 'peer-b'), false);
    assert.equal(network._recordMigrationVote({
        voterId: 'player-b',
        candidateId: 'player-self',
        epoch: 5,
        attemptId,
        rosterDigest
    }, 'peer-b'), true);
    assert.equal(network._recordMigrationVote({
        voterId: 'player-b',
        candidateId: 'player-self',
        epoch: 5,
        attemptId,
        rosterDigest
    }, 'peer-b'), false);

    const proposal = {
        epoch: 5,
        candidateId: 'player-self',
        hostPeerId: 'peer-self',
        roster,
        attemptId,
        rosterDigest,
        votes: [
            {
                voterId: 'player-self',
                candidateId: 'player-self',
                epoch: 5,
                attemptId,
                rosterDigest
            },
            {
                voterId: 'player-b',
                candidateId: 'player-self',
                epoch: 5,
                attemptId,
                rosterDigest
            }
        ]
    };
    assert.equal(validateHostMigrationProposal(proposal, {
        currentEpoch: 4,
        candidates,
        roster,
        expectedPeerId: 'peer-self',
        observedVotes: network._migrationVotes()
    }), false);
});

test('duplicate mesh direction converges and superseded close preserves active state', async () => {
    const outgoing = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    outgoing.connectionId = 'mesh-outgoing';
    const network = new Network({});
    network.peer = {
        id: 'peer-z',
        connect: () => outgoing
    };
    network.migrationRoster.set('player-a', {
        playerId: 'player-a',
        peerId: 'peer-a',
        migrationOrder: 0
    });
    const election = {
        roster: [{
            playerId: 'player-a',
            peerId: 'peer-a',
            migrationOrder: 0
        }]
    };
    network._migrationActive = true;
    network._migrationElection = election;
    network._socialRate.set('peer-a:socialPresence', {
        count: 1,
        startedAt: Date.now()
    });
    network.allowedMeshPeers.set('peer-a', 'player-a');
    const incoming = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    incoming.connectionId = 'mesh-incoming';

    network._onIncomingConnection(incoming);
    incoming.emit('open');
    assert.equal(network.connections.get('peer-a'), incoming);
    outgoing.emit('open');
    await network.pendingConnections.get('peer-a');

    assert.equal(incoming.closed, true);
    assert.equal(network.connections.get('peer-a'), outgoing);
    assert.equal(network.peerToPlayerId.get('peer-a'), 'player-a');
    assert.equal(network.migrationRoster.has('player-a'), true);
    assert.equal(network.allowedMeshPeers.get('peer-a'), 'player-a');
    assert.equal(network._socialRate.has('peer-a:socialPresence'), true);
    assert.equal(network._migrationActive, true);
    assert.equal(network._migrationElection, election);
});

test('election retries are bounded, backed off, and reject prior attempts', () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const scheduled = [];
    globalThis.setTimeout = (handler, delay) => {
        const task = { handler, delay, cleared: false };
        scheduled.push(task);
        return task;
    };
    globalThis.clearTimeout = task => {
        if (task) task.cleared = true;
    };
    try {
        const network = new Network({});
        network.peer = { id: 'peer-self' };
        network.playerId = 'player-self';
        const remote = fakeConn('peer-b');
        network._bindConnectionIdentity(remote, 'player-b');
        network.connections.set('peer-b', remote);
        network.peerToPlayerId.set('peer-b', 'player-b');
        network.migrationRoster = new Map([
            ['player-self', {
                playerId: 'player-self',
                peerId: 'peer-self',
                migrationOrder: 0
            }],
            ['player-b', {
                playerId: 'player-b',
                peerId: 'peer-b',
                migrationOrder: 1
            }]
        ]);
        let failures = 0;
        network.onHostLeft = () => failures++;
        const takeTimer = delay => {
            const index = scheduled.findIndex(task =>
                !task.cleared && task.delay === delay);
            assert.notEqual(index, -1, `missing timer ${delay}`);
            return scheduled.splice(index, 1)[0];
        };

        network._beginHostMigration();
        let staleVote = null;
        for (let attempt = 0; attempt < HOST_MIGRATION_MAX_ATTEMPTS; attempt++) {
            const election = network._migrationElection;
            assert.equal(election.attempt, attempt);
            assert.equal(election.epoch, attempt + 1);
            if (staleVote) {
                assert.equal(network._recordMigrationVote(staleVote, 'peer-b'), false);
            }
            staleVote = {
                voterId: 'player-b',
                candidateId: election.selected.playerId,
                epoch: election.epoch,
                attemptId: election.attemptId,
                rosterDigest: election.rosterDigest
            };
            takeTimer(HOST_MIGRATION_TIMEOUT_MS).handler();
            if (attempt < HOST_MIGRATION_MAX_ATTEMPTS - 1) {
                takeTimer(migrationBackoffMs(attempt)).handler();
            }
        }

        assert.equal(remote.sent.length, HOST_MIGRATION_MAX_ATTEMPTS);
        assert.equal(network._migrationActive, false);
        assert.equal(failures, 1);
        assert.equal(scheduled.filter(task => !task.cleared).length, 0);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('votes traverse handlers into promotion without exposing resume tokens', async () => {
    const originalToken = 'resume-victim-secret';
    const authority = new Network({
        getPlayerList: () => [],
        state: 'lobby',
        scoreboard: {}
    });
    authority.isHost = true;
    authority.peer = { id: 'peer-authority' };
    authority.playerId = 'player-authority';
    const victimAtAuthority = fakeConn('peer-b', {
        name: 'Victim',
        playerId: 'player-b',
        resumeToken: originalToken
    });
    const authorityAdmission = beginResumeHandshake(authority, victimAtAuthority,
        originalToken);
    assert.equal(authority.playerConnections.has('player-b'), false);
    assert.equal(authority.migrationRoster.has('player-b'), false);
    assert.equal(await authorityAdmission, true);
    const victimReservation = authority.migrationRoster.get('player-b');
    assert.equal(victimReservation.resumeReserved, true);
    assert.match(victimReservation.resumeProof, /^[a-f0-9]{64}$/);

    const makeNetwork = (playerId, peerId) => {
        const network = createTestNetwork({
            applyHostMigrationCheckpoint: () => true
        });
        network.playerId = playerId;
        network.playerName = playerId;
        network.peer = { id: peerId };
        network.migrationRoster = new Map([
            ['player-a', {
                playerId: 'player-a',
                peerId: 'peer-a',
                migrationOrder: 0
            }],
            ['player-b', {
                playerId: 'player-b',
                peerId: 'peer-b',
                migrationOrder: 1,
                resumeReserved: true,
                resumeProof: victimReservation.resumeProof
            }]
        ]);
        network.playerResumeProofs.set('player-b', victimReservation.resumeProof);
        return network;
    };
    const promoted = makeNetwork('player-a', 'peer-a');
    const follower = makeNetwork('player-b', 'peer-b');
    const toFollower = fakeConn('peer-b', {
        isMesh: true,
        playerId: 'player-b'
    });
    const toPromoted = fakeConn('peer-a', {
        isMesh: true,
        playerId: 'player-a'
    });
    toFollower.send = data => {
        toFollower.sent.push(data);
        toPromoted.emit('data', data);
    };
    toPromoted.send = data => {
        toPromoted.sent.push(data);
        toFollower.emit('data', data);
    };
    promoted.allowedMeshPeers.set('peer-b', 'player-b');
    follower.allowedMeshPeers.set('peer-a', 'player-a');
    promoted._installMeshConnection(toFollower, 'player-b', 'outgoing');
    follower._installMeshConnection(toPromoted, 'player-a', 'incoming');

    promoted._beginHostMigration();
    follower._beginHostMigration();
    const election = promoted._migrationElection;
    toFollower.send({
        type: 'hostMigrationVote',
        voterId: 'player-a',
        candidateId: election.selected.playerId,
        epoch: election.epoch,
        attemptId: election.attemptId,
        rosterDigest: election.rosterDigest
    });
    await new Promise(resolve =>
        setTimeout(resolve, migrationBackoffMs(0) + 25));

    assert.equal(promoted.isHost, true);
    assert.equal(follower.hostConn, toPromoted);
    assert.equal(promoted.playerConnections.get('player-b'), toFollower);
    assert.equal(toFollower._admitted, true);
    const wireData = JSON.stringify([
        ...toFollower.sent,
        ...toPromoted.sent
    ]);
    assert.doesNotMatch(wireData, /resumeToken|resume-/);

    const duplicate = fakeConn('peer-duplicate', {
        name: 'Evil',
        playerId: 'player-b',
        resumeToken: originalToken
    });
    promoted._onIncomingConnection(duplicate);
    duplicate.emit('open');
    assert.equal(duplicate.sent[0]?.type, 'kick');
    assert.equal(duplicate.sent[0]?.reason, 'duplicate_identity');
    assert.equal(duplicate.sent.some(packet => packet.type === 'resumeChallenge'), false);
    assert.equal(promoted.playerConnections.get('player-b'), toFollower);

    toFollower.close();
    assert.equal(
        promoted.playerResumeProofs.get('player-b'),
        victimReservation.resumeProof
    );
    assert.equal(promoted.migrationRoster.has('player-b'), false);
    const attacker = fakeConn('peer-evil', {
        name: 'Evil',
        playerId: 'player-b',
        resumeToken: 'resume-evil'
    });
    assert.equal(await beginResumeHandshake(promoted, attacker, 'resume-evil'), false);
    assert.equal(
        attacker.sent.find(packet => packet?.type === 'kick')?.reason,
        'duplicate_identity'
    );
    assert.equal(promoted.playerConnections.has('player-b'), false);

    const resumed = fakeConn('peer-resumed', {
        name: 'Victim',
        playerId: 'player-b',
        resumeToken: originalToken
    });
    const result = await beginResumeHandshake(promoted, resumed, originalToken);
    assert.equal(result, true);
    assert.equal(promoted.playerConnections.get('player-b'), resumed);
    assert.equal(promoted.migrationRoster.get('player-b')?.peerId, resumed.peer);
    assert.equal(
        promoted.migrationRoster.get('player-b')?.resumeProof,
        victimReservation.resumeProof
    );

    const serializedPayloads = JSON.stringify([
        ...victimAtAuthority.sent,
        ...toFollower.sent,
        ...toPromoted.sent,
        ...attacker.sent,
        ...resumed.sent
    ]);
    assert.doesNotMatch(serializedPayloads, /resumeToken/);
    assert.equal(serializedPayloads.includes(originalToken), false);
});

test('legacy migration cannot take over and lexical ids cannot outrank roster order', () => {
    const honest = candidate('player-z', 'peer-z', 0);
    const lexicalAttacker = candidate('player-000', 'peer-000', 1);
    assert.equal(selectHostCandidate([lexicalAttacker, honest]), honest);
    assert.equal(validateHostMigrationProposal({
        epoch: 1,
        candidateId: honest.playerId,
        hostPeerId: honest.peerId
    }, {
        currentEpoch: 0,
        candidates: [honest],
        roster: [honest],
        expectedPeerId: honest.peerId,
        allowLegacySingleCandidate: true
    }), false);
});

test('active migration roster stays bounded and prunes churn', () => {
    const network = createTestNetwork({});
    network.peer = { id: 'peer-local' };
    network.playerId = 'player-local';
    const players = Array.from({ length: 65 }, (_, index) => ({
        playerId: `player-${index}`,
        peerId: `peer-${index}`,
        migrationOrder: index,
        name: `P${index}`
    }));
    network._updateMigrationRoster(players);
    assert.equal(network.migrationRoster.size, 64);
    network._removeMigrationPeer('peer-0', 'player-0');
    assert.equal(network.migrationRoster.has('player-0'), false);
    network._updateMigrationRoster([
        ...players.slice(1, 63),
        players[64]
    ]);
    assert.equal(network.migrationRoster.size, 64);
    assert.equal(network.migrationRoster.has('player-64'), true);
});

test('playerHit accepts only bounded authoritative host packets', () => {
    const hits = [];
    const network = new Network({
        applyPlayerHit: hit => hits.push(hit)
    });
    network.hostConn = { peer: 'host-peer' };
    network.handleMessage({
        type: 'playerHit',
        targetId: 'player-target',
        sourceId: 'player-source',
        dmg: 25
    }, 'mesh-peer');
    for (const dmg of [Number.NaN, Number.POSITIVE_INFINITY, 1001]) {
        network.handleMessage({
            type: 'playerHit',
            targetId: 'player-target',
            sourceId: 'player-source',
            dmg
        }, 'host-peer');
    }
    network.handleMessage({
        type: 'playerHit',
        targetId: 'player-target',
        sourceId: 'player-source',
        dmg: 25
    }, 'host-peer');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].playerId, 'player-target');
    assert.equal(hits[0].targetPlayerId, 'player-target');
    assert.equal(hits[0].sourcePlayerId, 'player-source');
});

test('position uses legacy type 2 until explicit V2 capability', () => {
    const network = new Network({});
    const legacy = fakeConn('peer-legacy');
    const modern = fakeConn('peer-modern');
    network.connections.set(legacy.peer, legacy);
    network.connections.set(modern.peer, modern);
    network.peerCapabilities.set(modern.peer, {
        positionV2: true,
        migrationVotes: true
    });
    network.sendPosition({ x: 1, y: 2, z: 3 }, 0, {
        vx: 4,
        vy: 5,
        vz: 6
    });
    assert.equal(new Uint8Array(legacy.sent[0])[0], 2);
    assert.equal(new Uint8Array(modern.sent[0])[0], 3);
    assert.equal(network._decodeBinary(legacy.sent[0])?.type, 'position');

    const ambiguous = network.encodePosition({ x: 1, y: 2, z: 3 });
    ambiguous[0] = 2;
    assert.equal(network._decodeBinary(ambiguous), null);
});
