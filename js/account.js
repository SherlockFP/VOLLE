// account.js — the browser retains only a revocable account session and public identity.
export const ACCOUNT_KEY = 'dodgball_account';

function publicAccount(value) {
    if (!value || typeof value !== 'object' || !value.id || !value.username || !value.friendTag) return null;
    return {
        id: String(value.id),
        username: String(value.username).slice(0, 20),
        avatar: typeof value.avatar === 'string' ? value.avatar.slice(0, 64) : '',
        friendTag: String(value.friendTag).slice(0, 32)
    };
}

export class Account {
    constructor({ storage = globalThis.localStorage, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
        this.storage = storage;
        this.fetchImpl = fetchImpl;
        this.sessionToken = '';
        this.public = null;
        this._loadLocal();
    }

    _loadLocal() {
        try {
            const saved = JSON.parse(this.storage?.getItem(ACCOUNT_KEY) || 'null');
            this.sessionToken = typeof saved?.sessionToken === 'string' ? saved.sessionToken : '';
            this.public = publicAccount(saved?.account);
            if (!this.sessionToken || !this.public) this.clear();
        } catch { this.clear(); }
    }

    _saveLocal() {
        if (!this.sessionToken || !this.public) return this.clear();
        try {
            this.storage?.setItem(ACCOUNT_KEY, JSON.stringify({ sessionToken: this.sessionToken, account: this.public }));
        } catch {}
    }

    _accept(data) {
        const next = publicAccount(data?.account);
        if (!next || typeof data?.sessionToken !== 'string' || !data.sessionToken) return { error: 'Invalid account response. Please try again.' };
        this.sessionToken = data.sessionToken;
        this.public = next;
        this._saveLocal();
        return { ok: true, account: next };
    }

    async register(username, password, email) {
        return this._submit('/api/account/register', { username, password, email }, 'registration');
    }

    async login(username, password) {
        return this._submit('/api/account/login', { username, password }, 'sign in');
    }

    async _submit(path, body, label) {
        if (!String(body.username || '').trim() || !String(body.password || '')) return { error: 'Username and password are required.' };
        if (path.endsWith('/register') && !String(body.email || '').trim()) return { error: 'Email is required.' };
        try {
            const response = await this.fetchImpl(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) return { error: data.error || `Unable to ${label}.` };
            return this._accept(data);
        } catch { return { error: 'Network unavailable. Check your connection and retry.' }; }
    }

    async restore() {
        if (!this.sessionToken) return { error: 'No saved session.' };
        try {
            const response = await this.fetchImpl('/api/account/me', { headers: { Authorization: `Bearer ${this.sessionToken}` } });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 401) this.clear();
                return { error: response.status === 401 ? 'Your session has expired. Sign in again.' : 'Unable to verify your session. Retry.' };
            }
            this.public = publicAccount(data.account || data) || this.public;
            if (!this.public) return { error: 'Invalid account response. Please try again.' };
            this._saveLocal();
            return { ok: true, account: this.public };
        } catch { return { error: 'Network unavailable. Check your connection and retry.' }; }
    }

    async logout() {
        const token = this.sessionToken;
        this.clear();
        if (!token) return;
        try { await this.fetchImpl('/api/account/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); } catch {}
    }

    clear() {
        this.sessionToken = '';
        this.public = null;
        try { this.storage?.removeItem(ACCOUNT_KEY); } catch {}
    }

    isLoggedIn() { return Boolean(this.sessionToken && this.public); }
    getToken() { return this.sessionToken; }
    getAccount() { return this.public ? { ...this.public } : null; }
    getUsername() { return this.public?.username || ''; }
    getAvatar() { return this.public?.avatar || ''; }
    getFriendTag() { return this.public?.friendTag || ''; }
}

export const account = new Account();
