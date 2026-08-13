const test = require('node:test');
const assert = require('node:assert/strict');
const { PartyStore, PARTY_INVITE_TTL_MS, PARTY_INVITE_COOLDOWN_MS, PARTY_MAX_MEMBERS, PARTY_LOBBY_TARGET_TTL_MS } = require('../server/party-store');

function fixture() {
    let now = 1000;
    const available = new Set();
    const active = new Set();
    const parties = new PartyStore({ now: () => now, isAccountAvailable: id => available.has(id), isAccountActive: id => active.has(id) });
    return { parties, available, active, tick: ms => { now += ms; } };
}

test('party invites enforce availability, leader ownership and idempotent pending pairs', () => {
    const f = fixture();
    f.available.add('a'); f.available.add('b'); f.available.add('c');
    const first = f.parties.invite('a', 'b');
    assert.equal(first.status, 201);
    assert.equal(f.parties.invite('a', 'b').replayed, true);
    assert.equal(f.parties.act('b', first.invite.id, 'accept').state, 'accepted');
    assert.equal(f.parties.invite('b', 'c').status, 403, 'non-leader cannot invite');
    assert.equal(f.parties.invite('a', 'a').status, 403);
    f.active.add('c');
    assert.equal(f.parties.invite('a', 'c').status, 409);
});

test('expiry, decline and cooldown leave no reusable pending invite', () => {
    const f = fixture(); f.available.add('a'); f.available.add('b');
    const first = f.parties.invite('a', 'b');
    f.tick(PARTY_INVITE_TTL_MS + 1);
    assert.equal(f.parties.act('b', first.invite.id, 'accept').status, 404);
    const second = f.parties.invite('a', 'b');
    assert.equal(second.status, 201);
    assert.equal(f.parties.act('b', second.invite.id, 'decline').state, 'declined');
    assert.equal(f.parties.invite('a', 'b').status, 429);
    f.tick(PARTY_INVITE_COOLDOWN_MS);
    assert.equal(f.parties.invite('a', 'b').status, 201);
});

test('accept is atomic, invalidates competing invites and converges all snapshots', () => {
    const f = fixture(); ['a', 'b', 'c'].forEach(id => f.available.add(id));
    const fromA = f.parties.invite('a', 'c');
    const fromB = f.parties.invite('b', 'c');
    const accepted = f.parties.act('c', fromA.invite.id, 'accept');
    assert.equal(accepted.party.revision, 2);
    assert.deepEqual(accepted.party.memberAccountIds, ['a', 'c']);
    assert.equal(f.parties.act('c', fromB.invite.id, 'accept').status, 404);
    assert.deepEqual(f.parties.snapshot('a').party, f.parties.snapshot('c').party);
    assert.equal(f.parties.snapshot('b').invites.length, 0);
    assert.equal(f.parties.snapshot('b').party, null, 'losing provisional party is torn down');
});

test('party capacity and deterministic leader transfer/teardown are bounded', () => {
    const f = fixture();
    for (let n = 0; n <= PARTY_MAX_MEMBERS; n++) f.available.add(`p${n}`);
    for (let n = 1; n < PARTY_MAX_MEMBERS; n++) {
        const invite = f.parties.invite('p0', `p${n}`);
        assert.equal(f.parties.act(`p${n}`, invite.invite.id, 'accept').status, 200);
    }
    assert.equal(f.parties.invite('p0', `p${PARTY_MAX_MEMBERS}`).status, 409);
    const transfer = f.parties.leave('p0');
    assert.equal(transfer.party.leaderAccountId, 'p1');
    assert.equal(transfer.party.revision, PARTY_MAX_MEMBERS + 1);
    for (let n = 1; n < PARTY_MAX_MEMBERS; n++) f.parties.leave(`p${n}`);
    assert.equal(f.parties.snapshot(`p${PARTY_MAX_MEMBERS - 1}`).party, null);
});

test('casual party target is leader-only, revisioned, expires, and clears on membership changes', () => {
    const f = fixture(); f.available.add('a'); f.available.add('b');
    const invite = f.parties.invite('a', 'b');
    assert.equal(f.parties.act('b', invite.invite.id, 'accept').status, 200);
    const party = f.parties.snapshot('a').party;
    assert.equal(f.parties.beginCasualQueue('b', party.revision).status, 403);
    assert.equal(f.parties.beginCasualQueue('a', party.revision).status, 200);
    assert.equal(f.parties.lobbyIntent('b').queueState.state, 'choosing');
    assert.equal(f.parties.setLobbyTarget('a', party.revision + 1, 'room').status, 409);
    const target = f.parties.setLobbyTarget('a', party.revision, 'room');
    assert.equal(target.status, 200);
    assert.deepEqual(f.parties.lobbyIntent('b').lobbyTarget, { code: 'room', partyRevision: party.revision, revision: 1, expiresAt: 1000 + PARTY_LOBBY_TARGET_TTL_MS });
    f.tick(PARTY_LOBBY_TARGET_TTL_MS + 1);
    assert.equal(f.parties.lobbyIntent('a').lobbyTarget, null);
    assert.equal(f.parties.setLobbyTarget('a', party.revision, 'room').status, 200);
    f.parties.leave('b');
    assert.equal(f.parties.lobbyIntent('a').lobbyTarget, null);
});

test('active leader cannot create or publish a party queue intent', () => {
    const f = fixture(); f.available.add('a'); f.available.add('b');
    const invite = f.parties.invite('a', 'b');
    f.parties.act('b', invite.invite.id, 'accept');
    const revision = f.parties.snapshot('a').party.revision;
    f.active.add('a');
    assert.deepEqual(f.parties.beginCasualQueue('a', revision), { status: 409, error: 'party unavailable' });
    assert.deepEqual(f.parties.setLobbyTarget('a', revision, 'room'), { status: 409, error: 'party unavailable' });
    assert.equal(f.parties.lobbyIntent('b').queueState, null);
    assert.equal(f.parties.lobbyIntent('b').lobbyTarget, null);
});

test('closing a target room clears every matching party without leaking another room', () => {
    const f = fixture(); ['a', 'b', 'c', 'd'].forEach(id => f.available.add(id));
    for (const [leader, member, code] of [['a', 'b', 'same-room'], ['c', 'd', 'other-room']]) {
        const invite = f.parties.invite(leader, member);
        f.parties.act(member, invite.invite.id, 'accept');
        const revision = f.parties.snapshot(leader).party.revision;
        f.parties.setLobbyTarget(leader, revision, code);
    }
    assert.equal(f.parties.clearLobbyTargetByCode('same-room'), 1);
    assert.equal(f.parties.lobbyIntent('a').lobbyTarget, null);
    assert.equal(f.parties.lobbyIntent('c').lobbyTarget.code, 'other-room');
});
