// friends.js — server-owned social graph. Legacy local data is intentionally never uploaded.
import { account } from './account.js';

const LEGACY_KEY = 'dodgball_friends_v1';
const LEGACY_DM_KEY = 'dodgball_friend_dms_v1';

export class FriendsList {
    constructor() {
        this.friends = [];
        this.requests = [];
        this.invites = [];
        this.statuses = new Map();
        this.messages = new Map();
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
