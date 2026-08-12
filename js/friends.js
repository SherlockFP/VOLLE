// friends.js — server-owned social graph. Legacy local data is intentionally never uploaded.
import { account } from './account.js';

const LEGACY_KEY = 'dodgball_friends_v1';
const LEGACY_DM_KEY = 'dodgball_friend_dms_v1';
const SOCIAL_STATES = new Set(['menu', 'lobby', 'social', 'match']);

function safeText(value, max = 80) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeAvailablePlayers(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 20).map(entry => ({
        accountId: safeText(entry?.accountId, 80),
        username: safeText(entry?.username, 20) || 'Player',
        avatar: safeText(entry?.avatar, 64),
        state: SOCIAL_STATES.has(entry?.state) ? entry.state : 'menu',
        region: safeText(entry?.region, 24).toLowerCase(),
        sameRegion: entry?.sameRegion === true
    })).filter(entry => entry.accountId);
}

export function normalizePartySnapshot(value) {
    const party = value?.party;
    const memberAccountIds = Array.isArray(party?.memberAccountIds)
        ? [...new Set(party.memberAccountIds.map(id => safeText(id, 80)).filter(Boolean))].slice(0, 8)
        : [];
    const normalizedParty = party && safeText(party.partyId, 80) ? {
        partyId: safeText(party.partyId, 80),
        leaderAccountId: safeText(party.leaderAccountId, 80),
        maxMembers: Math.max(1, Math.min(8, Math.floor(Number(party.maxMembers) || 8))),
        revision: Math.max(0, Math.floor(Number(party.revision) || 0)),
        memberAccountIds
    } : null;
    const invites = Array.isArray(value?.invites) ? value.invites.slice(0, 40).map(invite => ({
        id: safeText(invite?.id, 80),
        partyId: safeText(invite?.partyId, 80),
        senderAccountId: safeText(invite?.senderAccountId, 80),
        recipientAccountId: safeText(invite?.recipientAccountId, 80),
        status: invite?.status === 'pending' ? 'pending' : safeText(invite?.status, 16),
        expiresAt: Number.isFinite(Number(invite?.expiresAt)) ? Number(invite.expiresAt) : 0,
        createdAt: Number.isFinite(Number(invite?.createdAt)) ? Number(invite.createdAt) : 0
    })).filter(invite => invite.id && invite.status === 'pending') : [];
    return { party: normalizedParty, invites };
}

export class FriendsList {
    constructor() {
        this.friends = [];
        this.requests = [];
        this.invites = [];
        this.statuses = new Map();
        this.messages = new Map();
        this.available = [];
        this.party = null;
        this.partyInvites = [];
        this._partyRefreshEpoch = 0;
        this.legacy = this._readLegacy();
        this.onChange = null;
        this.onDM = null;
    }

    _readLegacy() {
        try { return { friends: JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'), messages: JSON.parse(localStorage.getItem(LEGACY_DM_KEY) || '{}') }; } catch { return { friends: [], messages: {} }; }
    }

    _headers(json = false) {
        const token = account.getToken();
        return token ? { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` } : null;
    }

    async _request(path, options = {}) {
        const headers = { ...(options.headers || {}), ...this._headers(Boolean(options.body)) };
        if (!headers.Authorization) return { error: 'Sign in required.', status: 401 };
        try {
            const response = await fetch(path, { ...options, headers });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) return { error: data.error || 'Social service unavailable.', status: response.status };
            return { ...data, status: response.status };
        } catch { return { error: 'Network unavailable. Retry shortly.', status: 0 }; }
    }

    _changed() { this.onChange?.(); }

    async sync() {
        const data = await this._request('/api/social/me');
        if (data.error) return data;
        this.friends = Array.isArray(data.friends) ? data.friends : [];
        this.requests = Array.isArray(data.requests) ? data.requests : [];
        this.invites = Array.isArray(data.invites) ? data.invites : [];
        await this.refreshPresence();
        this._changed();
        return { ok: true };
    }

    async refreshPresence() {
        const usernames = this.friends.map(friend => friend.username).filter(Boolean);
        if (!usernames.length) { this.statuses.clear(); return []; }
        const data = await this._request('/api/social/status', { method: 'POST', body: JSON.stringify({ usernames }) });
        if (data.error) return [];
        this.statuses = new Map((data.statuses || []).map(status => [String(status.username || '').toLowerCase(), status]));
        this._changed();
        return data.statuses || [];
    }

    async refreshAvailable(region = 'global') {
        const safeRegion = /^[a-z0-9-]{1,24}$/.test(String(region || '').toLowerCase()) ? String(region).toLowerCase() : 'global';
        const data = await this._request(`/api/social/available?region=${encodeURIComponent(safeRegion)}`);
        if (data.error) return data;
        this.available = normalizeAvailablePlayers(data.players);
        this._changed();
        return { ok: true, players: this.available };
    }

    async refreshParty() {
        const epoch = ++this._partyRefreshEpoch;
        const data = await this._request('/api/party');
        if (data.error) return data;
        const snapshot = normalizePartySnapshot(data);
        if (epoch !== this._partyRefreshEpoch) return { ok: true, stale: true, party: this.party, invites: this.partyInvites };
        this.party = snapshot.party;
        this.partyInvites = snapshot.invites;
        this._changed();
        return { ok: true, ...snapshot };
    }

    isPartyLeader(accountId = account.getAccount()?.id) {
        return !this.party || this.party.leaderAccountId === accountId;
    }

    async inviteToParty(recipientAccountId) {
        const data = await this._request('/api/party/invites', { method: 'POST', body: JSON.stringify({ recipientAccountId: safeText(recipientAccountId, 80) }) });
        if (!data.error) {
            this._partyRefreshEpoch += 1;
            await this.refreshParty();
        }
        return data;
    }

    async actOnPartyInvite(id, action) {
        const safeAction = action === 'accept' ? 'accept' : 'decline';
        const data = await this._request(`/api/party/invites/${encodeURIComponent(safeText(id, 80))}`, { method: 'POST', body: JSON.stringify({ action: safeAction }) });
        // Invalidate every GET that began before this authoritative mutation
        // completed; its older snapshot must never overwrite the accepted state.
        this._partyRefreshEpoch += 1;
        await this.refreshParty();
        return data;
    }

    async leaveParty() {
        const data = await this._request('/api/party/leave', { method: 'POST', body: '{}' });
        this._partyRefreshEpoch += 1;
        if (!data.error) await this.refreshParty();
        return data;
    }

    isOnline(friend) { return Boolean(this.statuses.get(String(friend?.username || '').toLowerCase())?.online); }
    getFriend(id) { return this.friends.find(friend => friend.id === id) || null; }

    async request(friendTag) {
        const data = await this._request('/api/social/friend-requests', { method: 'POST', body: JSON.stringify({ friendTag: String(friendTag || '').trim() }) });
        if (!data.error) await this.sync();
        return data;
    }

    async actOnRequest(id, action) {
        const data = await this._request(`/api/social/friend-requests/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) });
        if (!data.error) await this.sync();
        return data;
    }

    async remove(friendId) {
        const data = await this._request(`/api/social/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE' });
        if (!data.error) await this.sync();
        return data;
    }

    async loadMessages(friendId, beforeId = null) {
        const query = beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : '';
        const data = await this._request(`/api/social/conversations/${encodeURIComponent(friendId)}${query}`);
        if (data.error) return data;
        const current = this.messages.get(friendId) || [];
        const merged = beforeId ? [...data.messages, ...current] : data.messages;
        this.messages.set(friendId, merged);
        this._changed();
        return { ok: true, messages: merged, nextBeforeId: data.nextBeforeId || null };
    }

    getMessages(friendId) { return this.messages.get(friendId) || []; }

    async sendMessage(friendId, body) {
        const data = await this._request(`/api/social/conversations/${encodeURIComponent(friendId)}`, { method: 'POST', body: JSON.stringify({ body }) });
        if (!data.error) {
            const current = this.messages.get(friendId) || [];
            this.messages.set(friendId, [...current, data.message]);
            this.onDM?.(friendId, data.message);
            this._changed();
        }
        return data;
    }

    async createLobbyInvite(lobbyCode, friendAccountId) {
        const data = await this._request('/api/social/lobby-invites', { method: 'POST', body: JSON.stringify({ lobbyCode, friendAccountId }) });
        if (!data.error) await this.sync();
        return data;
    }

    async actOnInvite(id, action) {
        const data = await this._request(`/api/social/lobby-invites/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) });
        if (!data.error) await this.sync();
        return data;
    }
}

export const Friends = new FriendsList();
