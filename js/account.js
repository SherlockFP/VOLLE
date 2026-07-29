// account.js — client-side account registration/login, persisted locally with
// bearer token from server. Gameplay remains 100% P2P; account system is only for
// durable login recovery and presence/friends display.
export const ACCOUNT_KEY = 'dodgball_account';
export const PROFILE_TOKEN_KEY = 'dodgball_profile_token';

class Account {
    constructor() {
        this.username = null;
        this.avatar = '';
        this.token = null;
        this._loadLocal();
    }

    _loadLocal() {
        const stored = typeof localStorage !== 'undefined'
            ? localStorage.getItem(ACCOUNT_KEY)
            : null;
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.username = data.username || null;
                this.avatar = data.avatar || '';
                this.token = data.token || null;
            } catch {
                this.username = null;
                this.avatar = '';
                this.token = null;
            }
        }
    }

    _saveLocal() {
        if (typeof localStorage === 'undefined') return;
        if (this.username && this.token) {
            localStorage.setItem(ACCOUNT_KEY, JSON.stringify({
                username: this.username,
                avatar: this.avatar,
                token: this.token
            }));
            localStorage.setItem(PROFILE_TOKEN_KEY, this.token);
        } else {
            localStorage.removeItem(ACCOUNT_KEY);
        }
    }

    async register(username, password, avatar = '') {
        if (!username || username.length < 3 || username.length > 20) {
            return { error: 'username must be 3-20 characters' };
        }
        if (!password || password.length < 8) {
            return { error: 'password must be at least 8 characters' };
        }
        try {
            const response = await fetch('/api/account/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, avatar })
            });
            const data = await response.json();
            if (!response.ok) {
                return { error: data.error || 'registration failed' };
            }
            this.username = data.username;
            this.avatar = data.avatar;
            this.token = data.profileToken;
            this._saveLocal();
            return { ok: true, username: this.username, token: this.token };
        } catch (e) {
            return { error: 'network error: ' + (e.message || 'unknown') };
        }
    }

    async login(username, password) {
        if (!username || !password) {
            return { error: 'username and password required' };
        }
        try {
            const response = await fetch('/api/account/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) {
                return { error: data.error || 'login failed' };
            }
            this.username = data.username;
            this.avatar = data.avatar;
            this.token = data.profileToken;
            this._saveLocal();
            return { ok: true, username: this.username, token: this.token };
        } catch (e) {
            return { error: 'network error: ' + (e.message || 'unknown') };
        }
    }

    logout() {
        this.username = null;
        this.avatar = '';
        this.token = null;
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(ACCOUNT_KEY);
            localStorage.removeItem(PROFILE_TOKEN_KEY);
        }
    }

    isLoggedIn() {
        return !!this.username && !!this.token;
    }

    getToken() {
        return this.token;
    }

    getUsername() {
        return this.username;
    }

    getAvatar() {
        return this.avatar;
    }
}

export const account = new Account();
