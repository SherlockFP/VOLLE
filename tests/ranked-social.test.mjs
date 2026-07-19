import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RANKED_LIMITS,
    calculateEloChange,
    createRankedState,
    recordRankedMatch,
    startRankedSeason
} from '../js/ranked-service.js';
import {
    SOCIAL_LIMITS,
    activateXpBoost,
    appendClanMessage,
    appendLobbyMessage,
    applyXpBoost,
    createClan,
    createPrivateRoom,
    createSocialState,
    getActiveCosmeticTrials,
    getActiveXpBoost,
    grantXpBoost,
    joinClan,
    joinPrivateRoom,
    leaveClan,
    leavePrivateRoom,
    listClans,
    listPrivateRooms,
    pruneExpiredCosmeticTrials,
    sanitizeMessage,
    setClanMemberRole,
    startCosmeticTrial
} from '../js/social.js';

test('ranked placements use bounded provisional Elo and preserve input', () => {
    const initial = createRankedState({ seasonId: 's1', placementsRequired: 2 });
    const first = recordRankedMatch(initial, {
        matchId: 'm1',
        opponentElo: 5000,
        result: 'win',
        playedAt: 10
    });
    const second = recordRankedMatch(first, {
        matchId: 'm2',
        opponentElo: 0,
        result: 'loss',
        playedAt: 20
    });

    assert.equal(initial.elo, 1000);
    assert.equal(initial.currentSeason.matches.length, 0);
    assert.ok(first.elo - initial.elo <= RANKED_LIMITS.placementMaxDelta);
    assert.ok(second.elo - first.elo >= -RANKED_LIMITS.placementMaxDelta);
    assert.deepEqual(second.currentSeason.placements, {
        required: 2,
        completed: 2,
        placed: true
    });
    assert.deepEqual(second.currentSeason.record, {
        games: 2,
        wins: 1,
        losses: 1,
        draws: 0,
        highestElo: first.elo,
        lowestElo: second.elo
    });
});

test('normal Elo, draws, bounds, and duplicate matches are enforced', () => {
    let state = createRankedState({ seasonId: 's1', elo: 4999, placementsRequired: 0 });
    state = recordRankedMatch(state, {
        matchId: 'm1',
        opponentElo: 5000,
        result: 'win',
        playedAt: 1
    });
    assert.equal(state.elo, 5000);
    assert.equal(state.currentSeason.matches[0].delta, 1);
    assert.throws(() => recordRankedMatch(state, {
        matchId: 'm1',
        opponentElo: 1000,
        result: 'draw',
        playedAt: 2
    }), /already recorded/);
    assert.equal(calculateEloChange({
        playerElo: 1000,
        opponentElo: 1000,
        result: 'draw'
    }), 0);
    assert.throws(() => calculateEloChange({
        playerElo: 1000,
        opponentElo: 1000,
        result: 'invalid'
    }), /result/);
});

test('ranked history and season archive remain bounded', () => {
    let state = createRankedState({ seasonId: 's0', placementsRequired: 0 });
    for (let i = 0; i < RANKED_LIMITS.maxMatches + 3; i++) {
        state = recordRankedMatch(state, {
            matchId: `m${i}`,
            opponentElo: 1000,
            result: i % 2 ? 'loss' : 'win',
            playedAt: i
        });
    }
    assert.equal(state.currentSeason.matches.length, RANKED_LIMITS.maxMatches);
    assert.equal(state.currentSeason.matches[0].id, 'm3');

    const before = state.elo;
    let expectedReset = before;
    for (let i = 1; i <= RANKED_LIMITS.maxSeasons + 2; i++) {
        state = startRankedSeason(state, { seasonId: `s${i}`, startedAt: 1000 + i });
        expectedReset = Math.round(1000 + (expectedReset - 1000) * 0.5);
    }
    assert.equal(state.pastSeasons.length, RANKED_LIMITS.maxSeasons);
    assert.equal(state.elo, expectedReset);
    assert.throws(() => startRankedSeason(state, {
        seasonId: state.currentSeason.id,
        startedAt: 9999
    }), /already exists/);
});

test('ranked validation rejects malformed and unsafe values', () => {
    assert.throws(() => createRankedState({ seasonId: '__proto__' }), /invalid/);
    assert.throws(() => createRankedState({ elo: -1 }), /elo/);
    assert.throws(() => createRankedState({
        placementsRequired: RANKED_LIMITS.maxPlacements + 1
    }), /placementsRequired/);
    const state = createRankedState();
    assert.throws(() => recordRankedMatch(state, {
        matchId: 'm',
        opponentElo: Infinity,
        result: 'win',
        playedAt: 1
    }), /opponentElo/);
});

test('clans support create, join, roles, ownership transfer, leave, and listing', () => {
    const empty = createSocialState();
    const created = createClan(empty, {
        clanId: 'c1',
        name: 'Alpha Clan',
        tag: 'ac',
        ownerId: 'u1',
        createdAt: 1
    });
    const joined = joinClan(created, { clanId: 'c1', userId: 'u2', joinedAt: 2 });
    const promoted = setClanMemberRole(joined, {
        clanId: 'c1',
        actorId: 'u1',
        userId: 'u2',
        role: 'officer'
    });
    const transferred = setClanMemberRole(promoted, {
        clanId: 'c1',
        actorId: 'u1',
        userId: 'u2',
        role: 'owner'
    });

    assert.equal(empty.clans.c1, undefined);
    assert.equal(listClans(transferred)[0].tag, 'AC');
    assert.equal(transferred.clans.c1.ownerId, 'u2');
    assert.equal(transferred.clans.c1.members.find(m => m.userId === 'u1').role, 'officer');
    assert.throws(() => leaveClan(transferred, { clanId: 'c1', userId: 'u2' }), /transfer/);
    const left = leaveClan(transferred, { clanId: 'c1', userId: 'u1' });
    const deleted = leaveClan(left, { clanId: 'c1', userId: 'u2' });
    assert.equal(deleted.clans.c1, undefined);
});

test('clan authorization and unique membership are enforced', () => {
    let state = createClan(createSocialState(), {
        clanId: 'c1', name: 'Alpha', tag: 'AA', ownerId: 'u1', createdAt: 1
    });
    state = joinClan(state, { clanId: 'c1', userId: 'u2', joinedAt: 2 });
    state = joinClan(state, { clanId: 'c1', userId: 'u3', joinedAt: 3 });
    assert.throws(() => setClanMemberRole(state, {
        clanId: 'c1', actorId: 'u2', userId: 'u3', role: 'officer'
    }), /manager/);
    assert.throws(() => createClan(state, {
        clanId: 'c2', name: 'Beta', tag: 'BB', ownerId: 'u2', createdAt: 4
    }), /already belongs/);
    assert.throws(() => joinClan(state, {
        clanId: 'c1', userId: 'u2', joinedAt: 4
    }), /already belongs/);
});

test('clan and lobby chat sanitize content, reject duplicates, and remain bounded', () => {
    let state = createClan(createSocialState(), {
        clanId: 'c1', name: 'Alpha', tag: 'AA', ownerId: 'u1', createdAt: 1
    });
    state = appendClanMessage(state, {
        clanId: 'c1',
        messageId: 'm0',
        senderId: 'u1',
        text: '  <b>Hello</b>\nworld  ',
        sentAt: 1
    });
    assert.equal(state.clanChats.c1[0].text, '&lt;b&gt;Hello&lt;/b&gt; world');
    assert.equal(sanitizeMessage('"x" & y'), '&quot;x&quot; &amp; y');
    assert.throws(() => appendClanMessage(state, {
        clanId: 'c1', messageId: 'm0', senderId: 'u1', text: 'again', sentAt: 2
    }), /already exists/);
    assert.throws(() => appendClanMessage(state, {
        clanId: 'c1', messageId: 'm1', senderId: 'outsider', text: 'x', sentAt: 2
    }), /not a clan member/);
    assert.throws(() => sanitizeMessage(' '.repeat(10)), /empty/);

    for (let i = 0; i < SOCIAL_LIMITS.messagesPerChannel + 2; i++) {
        state = appendLobbyMessage(state, {
            lobbyId: 'l1',
            messageId: `lm${i}`,
            senderId: 'u1',
            text: `message ${i}`,
            sentAt: i
        });
    }
    assert.equal(state.lobbyChats.l1.length, SOCIAL_LIMITS.messagesPerChannel);
    assert.equal(state.lobbyChats.l1[0].id, 'lm2');
});

test('private rooms validate codes, capacity, redaction, and owner closure', () => {
    let state = createPrivateRoom(createSocialState(), {
        roomId: 'r1',
        ownerId: 'u1',
        name: 'Invite Only',
        code: 'code-123',
        maxPlayers: 2,
        createdAt: 1
    });
    assert.equal(listPrivateRooms(state)[0].code, undefined);
    assert.throws(() => joinPrivateRoom(state, {
        roomId: 'r1', userId: 'u2', code: 'wrong', joinedAt: 2
    }), /code is invalid/);
    state = joinPrivateRoom(state, {
        roomId: 'r1', userId: 'u2', code: 'code-123', joinedAt: 2
    });
    assert.throws(() => joinPrivateRoom(state, {
        roomId: 'r1', userId: 'u3', code: 'code-123', joinedAt: 3
    }), /full/);
    state = leavePrivateRoom(state, { roomId: 'r1', userId: 'u2', leftAt: 4 });
    assert.deepEqual(state.privateRooms.r1.members, ['u1']);
    state = leavePrivateRoom(state, { roomId: 'r1', userId: 'u1', leftAt: 5 });
    assert.equal(state.privateRooms.r1, undefined);
});

test('cosmetic trials use explicit time, expire exactly, prune, and preserve input', () => {
    const initial = createSocialState();
    const state = startCosmeticTrial(initial, {
        userId: 'u1',
        cosmeticId: 'skin-red',
        startedAt: 100,
        durationMs: 50
    });
    assert.deepEqual(initial.cosmetics, {});
    assert.equal(getActiveCosmeticTrials(state, 'u1', 149).length, 1);
    assert.equal(getActiveCosmeticTrials(state, 'u1', 150).length, 0);
    assert.throws(() => startCosmeticTrial(state, {
        userId: 'u1',
        cosmeticId: 'skin-red',
        startedAt: 120,
        durationMs: 50
    }), /already active/);
    assert.deepEqual(pruneExpiredCosmeticTrials(state, 150).cosmetics, {});
    assert.throws(() => startCosmeticTrial(initial, {
        userId: 'u1',
        cosmeticId: 'skin-red',
        startedAt: 0,
        durationMs: SOCIAL_LIMITS.trialDurationMs + 1
    }), /durationMs/);
    assert.throws(() => startCosmeticTrial(initial, {
        userId: 'u1',
        cosmeticId: 'skin-red',
        startedAt: Number.MAX_SAFE_INTEGER,
        durationMs: 1
    }), /safe time range/);
});

test('XP boosts grant, stack, activate, expire, and multiply with safe bounds', () => {
    const initial = createSocialState();
    let state = grantXpBoost(initial, {
        userId: 'u1',
        boostId: 'double-1h',
        quantity: 2,
        multiplier: 2,
        durationMs: 100
    });
    state = grantXpBoost(state, {
        userId: 'u1',
        boostId: 'double-1h',
        multiplier: 2,
        durationMs: 100
    });
    assert.equal(state.xpBoosts.u1.inventory['double-1h'].quantity, 3);
    state = activateXpBoost(state, {
        userId: 'u1',
        boostId: 'double-1h',
        activatedAt: 1000
    });
    assert.equal(state.xpBoosts.u1.inventory['double-1h'].quantity, 2);
    assert.equal(applyXpBoost(state, { userId: 'u1', baseXp: 25, at: 1099 }), 50);
    assert.equal(applyXpBoost(state, { userId: 'u1', baseXp: 25, at: 1100 }), 25);
    assert.equal(getActiveXpBoost(state, 'u1', 1100), null);
    assert.throws(() => activateXpBoost(state, {
        userId: 'u1', boostId: 'double-1h', activatedAt: 1050
    }), /already active/);
    assert.throws(() => activateXpBoost(state, {
        userId: 'u1',
        boostId: 'double-1h',
        activatedAt: Number.MAX_SAFE_INTEGER
    }), /safe time range/);
});

test('XP boost definitions, inventory, and reward values are bounded', () => {
    const initial = createSocialState();
    assert.throws(() => grantXpBoost(initial, {
        userId: 'u1', boostId: 'bad', multiplier: 1, durationMs: 10
    }), /multiplier/);
    assert.throws(() => grantXpBoost(initial, {
        userId: 'u1',
        boostId: 'bad',
        quantity: SOCIAL_LIMITS.boostInventory,
        multiplier: 2,
        durationMs: SOCIAL_LIMITS.boostDurationMs + 1
    }), /durationMs/);
    let state = grantXpBoost(initial, {
        userId: 'u1',
        boostId: 'x',
        quantity: SOCIAL_LIMITS.boostInventory,
        multiplier: 2,
        durationMs: 10
    });
    assert.throws(() => grantXpBoost(state, {
        userId: 'u1', boostId: 'x', multiplier: 2, durationMs: 10
    }), /inventory limit/);
    assert.throws(() => grantXpBoost(state, {
        userId: 'u1', boostId: 'x', multiplier: 3, durationMs: 10
    }), /definition/);
    assert.throws(() => applyXpBoost(state, {
        userId: 'u1', baseXp: SOCIAL_LIMITS.boostedXp + 1, at: 0
    }), /baseXp/);
});

test('social identifiers block prototype-key injection', () => {
    const state = createSocialState();
    assert.throws(() => createClan(state, {
        clanId: '__proto__',
        name: 'Alpha',
        tag: 'AA',
        ownerId: 'u1',
        createdAt: 1
    }), /invalid/);
    assert.throws(() => appendLobbyMessage(state, {
        lobbyId: 'constructor',
        messageId: 'm1',
        senderId: 'u1',
        text: 'hello',
        sentAt: 1
    }), /invalid/);
});
