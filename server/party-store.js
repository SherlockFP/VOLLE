const crypto = require('crypto');

const PARTY_MAX_MEMBERS = 8;
const PARTY_INVITE_TTL_MS = 30000;
const PARTY_INVITE_COOLDOWN_MS = 2000;
const PARTY_RECIPIENT_PENDING_CAP = 20;
const CLOSED_INVITE_RETENTION_MS = 5 * 60 * 1000;

class PartyStore {
    constructor({ now = () => Date.now(), isAccountAvailable = () => false, isAccountActive = () => false } = {}) {
        this.now = now;
        this.isAccountAvailable = isAccountAvailable;
        this.isAccountActive = isAccountActive;
        this.parties = new Map();
        this.partyByAccount = new Map();
        this.invites = new Map();
        this.pendingByPair = new Map();
        this.lastInviteByPair = new Map();
    }

    _pair(senderId, recipientId) { return `${senderId}\0${recipientId}`; }
    _publicParty(party) { return party && { partyId: party.partyId, leaderAccountId: party.leaderAccountId, maxMembers: PARTY_MAX_MEMBERS, revision: party.revision, memberAccountIds: [...party.members].sort() }; }
    _publicInvite(invite) { return invite && { id: invite.id, partyId: invite.partyId, senderAccountId: invite.senderAccountId, recipientAccountId: invite.recipientAccountId, status: invite.status, expiresAt: invite.expiresAt, createdAt: invite.createdAt }; }

    _expire(now = this.now()) {
        for (const invite of this.invites.values()) {
            if (invite.status === 'pending' && invite.expiresAt <= now) this._closeInvite(invite, 'expired');
            if (invite.status !== 'pending' && now - (invite.closedAt || now) > CLOSED_INVITE_RETENTION_MS) this.invites.delete(invite.id);
        }
        return now;
    }

    _closeInvite(invite, status) {
        invite.status = status;
        invite.closedAt = this.now();
        this.pendingByPair.delete(this._pair(invite.senderAccountId, invite.recipientAccountId));
        this._teardownProvisionalParty(invite.partyId);
    }

    _teardownProvisionalParty(partyId) {
        const party = this.parties.get(partyId);
        if (!party || party.established || party.members.size !== 1) return;
        const stillPending = [...this.invites.values()].some(invite => invite.partyId === partyId && invite.status === 'pending');
        if (stillPending) return;
        this.parties.delete(partyId);
        this.partyByAccount.delete(party.leaderAccountId);
    }

    _createParty(leaderAccountId) {
        const party = { partyId: crypto.randomUUID(), leaderAccountId, revision: 1, established: false, members: new Set([leaderAccountId]) };
        this.parties.set(party.partyId, party);
        this.partyByAccount.set(leaderAccountId, party.partyId);
        return party;
    }

    _partyFor(accountId) { return this.parties.get(this.partyByAccount.get(accountId)) || null; }

    snapshot(accountId) {
        this._expire();
        const invites = [...this.invites.values()]
            .filter(invite => invite.status === 'pending' && (invite.senderAccountId === accountId || invite.recipientAccountId === accountId))
            .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
            .map(invite => this._publicInvite(invite));
        return { party: this._publicParty(this._partyFor(accountId)), invites };
    }

    invite(senderAccountId, recipientAccountId) {
        const now = this._expire();
        if (!senderAccountId || !recipientAccountId || senderAccountId === recipientAccountId) return { status: 403, error: 'invite unavailable' };
        const pairKey = this._pair(senderAccountId, recipientAccountId);
        const existingId = this.pendingByPair.get(pairKey);
        const existing = existingId && this.invites.get(existingId);
        if (existing?.status === 'pending') return { status: 200, invite: this._publicInvite(existing), replayed: true };
        if (!this.isAccountAvailable(senderAccountId) || !this.isAccountAvailable(recipientAccountId)
            || this.isAccountActive(senderAccountId) || this.isAccountActive(recipientAccountId)) return { status: 409, error: 'player unavailable' };
        let party = this._partyFor(senderAccountId);
        if (party && party.leaderAccountId !== senderAccountId) return { status: 403, error: 'party leader only' };
        if (this._partyFor(recipientAccountId)) return { status: 409, error: 'player already in a party' };
        if (party?.members.size >= PARTY_MAX_MEMBERS) return { status: 409, error: 'party full' };
        if (now - (this.lastInviteByPair.get(pairKey) ?? Number.NEGATIVE_INFINITY) < PARTY_INVITE_COOLDOWN_MS) return { status: 429, error: 'invite cooldown' };
        const recipientPending = [...this.invites.values()].filter(invite => invite.recipientAccountId === recipientAccountId && invite.status === 'pending').length;
        if (recipientPending >= PARTY_RECIPIENT_PENDING_CAP) return { status: 429, error: 'recipient invite limit' };
        if (!party) party = this._createParty(senderAccountId);
        const invite = { id: crypto.randomUUID(), partyId: party.partyId, senderAccountId, recipientAccountId, status: 'pending', expiresAt: now + PARTY_INVITE_TTL_MS, createdAt: now };
        this.invites.set(invite.id, invite);
        this.pendingByPair.set(pairKey, invite.id);
        this.lastInviteByPair.set(pairKey, now);
        return { status: 201, invite: this._publicInvite(invite), replayed: false };
    }

    act(accountId, inviteId, action) {
        this._expire();
        const invite = this.invites.get(String(inviteId || ''));
        if (!invite || invite.status !== 'pending') return { status: 404, error: 'invite unavailable' };
        if (invite.recipientAccountId !== accountId || !['accept', 'decline'].includes(action)) return { status: 403, error: 'action not allowed' };
        if (action === 'decline') { this._closeInvite(invite, 'declined'); return { status: 200, state: 'declined' }; }
        const party = this.parties.get(invite.partyId);
        if (!party || party.leaderAccountId !== invite.senderAccountId || this._partyFor(accountId)
            || party.members.size >= PARTY_MAX_MEMBERS || !this.isAccountAvailable(accountId) || !this.isAccountAvailable(invite.senderAccountId)
            || this.isAccountActive(accountId) || this.isAccountActive(invite.senderAccountId)) return { status: 409, error: 'party unavailable' };
        // The mutation is one synchronous critical section: no await may expose a
        // half-accepted invite or double membership.
        party.members.add(accountId);
        party.established = true;
        party.revision += 1;
        this.partyByAccount.set(accountId, party.partyId);
        this._closeInvite(invite, 'accepted');
        for (const other of this.invites.values()) {
            if (other.status === 'pending' && other.recipientAccountId === accountId) this._closeInvite(other, 'expired');
        }
        return { status: 200, state: 'accepted', party: this._publicParty(party) };
    }

    leave(accountId) {
        this._expire();
        const party = this._partyFor(accountId);
        if (!party) return { status: 200, left: false, party: null };
        party.members.delete(accountId);
        this.partyByAccount.delete(accountId);
        if (!party.members.size) {
            this.parties.delete(party.partyId);
            for (const invite of this.invites.values()) if (invite.partyId === party.partyId && invite.status === 'pending') this._closeInvite(invite, 'expired');
            return { status: 200, left: true, party: null };
        }
        if (party.leaderAccountId === accountId) {
            party.leaderAccountId = [...party.members].sort()[0];
            for (const invite of this.invites.values()) if (invite.partyId === party.partyId && invite.status === 'pending') this._closeInvite(invite, 'expired');
        }
        party.revision += 1;
        return { status: 200, left: true, party: this._publicParty(party) };
    }
}

module.exports = { PartyStore, PARTY_MAX_MEMBERS, PARTY_INVITE_TTL_MS, PARTY_INVITE_COOLDOWN_MS, PARTY_RECIPIENT_PENDING_CAP };
