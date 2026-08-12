// Authenticated, ephemeral presence. Account/profile identity is supplied by
// server.js from the session; clients may only choose bounded display state.
const PRESENCE_TTL_MS = 45000;
const PRESENCE_STATES = new Set(['menu', 'lobby', 'social', 'match']);
const INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REGION = /^[a-z0-9-]{1,24}$/;

function cleanText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

class PresenceStore {
    constructor(ttlMs = PRESENCE_TTL_MS, { now = () => Date.now() } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        // Kept for the legacy friend-status API and its established tests.
        this.online = new Map(); // lowercase username -> latest legacy/account entry
        this.accounts = new Map(); // accountId -> server-owned identity + tab instances
    }

    heartbeat(username, avatar) {
        if (!username) return null;
        const entry = { username: cleanText(username, 20), avatar: cleanText(avatar, 64), lastSeen: this.now() };
        this.online.set(entry.username.toLowerCase(), entry);
        return entry;
    }

    heartbeatAccount(identity, input = {}) {
        const accountId = cleanText(identity?.accountId, 80);
        const profileId = cleanText(identity?.profileId, 128);
        const username = cleanText(identity?.username, 20);
        const instanceId = cleanText(input.instanceId, 64);
        if (!accountId || !profileId || !username || !INSTANCE_ID.test(instanceId)) {
            return { status: 400, error: 'invalid presence heartbeat' };
        }
        const state = PRESENCE_STATES.has(input.state) ? input.state : 'menu';
        const rawRegion = cleanText(input.region, 24).toLowerCase();
        const region = REGION.test(rawRegion) ? rawRegion : '';
        const now = this.now();
        let account = this.accounts.get(accountId);
        if (!account) {
            account = { accountId, profileId, username, avatar: cleanText(identity.avatar, 64), instances: new Map() };
            this.accounts.set(accountId, account);
        } else {
            // Refresh identity only from the authenticated server-owned values.
            Object.assign(account, { profileId, username, avatar: cleanText(identity.avatar, 64) });
        }
        account.instances.set(instanceId, {
            instanceId,
            state,
            discoverable: input.discoverable === true,
            region,
            lastSeen: now
        });
        this.online.set(username.toLowerCase(), { username, avatar: account.avatar, lastSeen: now, accountId });
        return { status: 200, presence: { instanceId, state, discoverable: input.discoverable === true, region } };
    }

    _pruneAccount(account, cutoff) {
        for (const [instanceId, instance] of account.instances) {
            if (instance.lastSeen < cutoff) account.instances.delete(instanceId);
        }
        if (account.instances.size) return false;
        this.accounts.delete(account.accountId);
        const legacy = this.online.get(account.username.toLowerCase());
        if (legacy?.accountId === account.accountId) this.online.delete(account.username.toLowerCase());
        return true;
    }

    prune() {
        const cutoff = this.now() - this.ttlMs;
        for (const account of this.accounts.values()) this._pruneAccount(account, cutoff);
        for (const [key, entry] of this.online) if (entry.lastSeen < cutoff) this.online.delete(key);
    }

    removeInstance(accountId, instanceId) {
        const account = this.accounts.get(String(accountId || ''));
        if (!account || !INSTANCE_ID.test(String(instanceId || ''))) return false;
        const removed = account.instances.delete(String(instanceId));
        if (!account.instances.size) this._pruneAccount(account, Number.POSITIVE_INFINITY);
        return removed;
    }

    removeAccount(accountId) {
        const account = this.accounts.get(String(accountId || ''));
        if (!account) return false;
        this.accounts.delete(account.accountId);
        const legacy = this.online.get(account.username.toLowerCase());
        if (legacy?.accountId === account.accountId) this.online.delete(account.username.toLowerCase());
        return true;
    }

    getAccount(accountId) {
        this.prune();
        return this.accounts.get(String(accountId || '')) || null;
    }

    isAccountAvailable(accountId) {
        const account = this.getAccount(accountId);
        if (!account) return false;
        return [...account.instances.values()].some(instance => instance.discoverable && instance.state !== 'match');
    }

    available({ requesterAccountId = '', requesterRegion = '', isProfileActive = () => false, limit = 20 } = {}) {
        this.prune();
        const region = REGION.test(String(requesterRegion || '').toLowerCase()) ? String(requesterRegion).toLowerCase() : '';
        const rows = [];
        for (const account of this.accounts.values()) {
            if (account.accountId === requesterAccountId || isProfileActive(account.profileId)) continue;
            const eligible = [...account.instances.values()].filter(instance => instance.discoverable && instance.state !== 'match');
            if (!eligible.length) continue;
            const sameRegion = region && eligible.some(instance => instance.region === region);
            const selected = eligible.sort((a, b) => b.lastSeen - a.lastSeen || a.instanceId.localeCompare(b.instanceId))[0];
            rows.push({
                accountId: account.accountId,
                username: account.username,
                avatar: account.avatar,
                state: selected.state,
                region: selected.region,
                sameRegion: !!sameRegion,
                lastSeen: selected.lastSeen
            });
        }
        rows.sort((a, b) => Number(b.sameRegion) - Number(a.sameRegion) || b.lastSeen - a.lastSeen || a.username.localeCompare(b.username));
        return rows.slice(0, Math.max(1, Math.min(20, Math.floor(Number(limit) || 20))))
            .map(({ lastSeen, ...publicRow }) => publicRow);
    }

    status(usernames) {
        this.prune();
        return (Array.isArray(usernames) ? usernames : []).slice(0, 200).map(name => {
            const entry = this.online.get(String(name || '').toLowerCase());
            return { username: name, online: !!entry, avatar: entry?.avatar || '' };
        });
    }
}

module.exports = { PresenceStore, PRESENCE_TTL_MS, PRESENCE_STATES };
