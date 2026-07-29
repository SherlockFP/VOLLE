// server/account-store.js — ponytail: SQLite-backed username/password accounts,
// layered on top of the existing ProfileStore bearer-token system instead of
// replacing it. register()/login() hand back the exact token shape
// /api/profile/* already accepts, so no other client or server code changes.
//
// Zero new dependency: node:sqlite is a Node.js built-in (stable use, still
// flagged experimental by the runtime) — same "Three.js + vanilla JS + Node
// built-in" rule as the rest of this server (AGENTS.md rule 4).
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const SCRYPT_KEYLEN = 64;

function scryptHash(password, salt) {
    return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

class AccountStore {
    constructor(dbPath, profileStore) {
        this.profiles = profileStore;
        this.db = new DatabaseSync(dbPath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                avatar TEXT NOT NULL DEFAULT '',
                profile_token TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_login INTEGER NOT NULL
            )
        `);
        this._insert = this.db.prepare(
            'INSERT INTO accounts (id, username, password_hash, salt, avatar, profile_token, created_at, last_login) '
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        this._byUsername = this.db.prepare('SELECT * FROM accounts WHERE username = ?');
        this._byToken = this.db.prepare('SELECT username, avatar FROM accounts WHERE profile_token = ?');
        this._touchLogin = this.db.prepare('UPDATE accounts SET last_login = ? WHERE id = ?');
        this._updateAvatar = this.db.prepare('UPDATE accounts SET avatar = ? WHERE username = ?');
    }

    register(username, password, avatar) {
        const name = String(username || '').trim();
        if (!USERNAME_RE.test(name)) {
            return { status: 400, error: 'username must be 3-20 letters, numbers, or underscores' };
        }
        if (typeof password !== 'string' || password.length < 8) {
            return { status: 400, error: 'password must be at least 8 characters' };
        }
        if (this._byUsername.get(name)) {
            return { status: 409, error: 'username already taken' };
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = scryptHash(password, salt);
        const avatarValue = typeof avatar === 'string' ? avatar.slice(0, 64) : '';
        // Mint through the existing profile system so /api/profile/* (purchases,
        // rewards, cosmetics, cases) works against this token exactly like a
        // guest session's token — accounts only add durable login recovery.
        const { token, profile } = this.profiles.create(name, null);
        const now = Date.now();
        this._insert.run(crypto.randomUUID(), name, passwordHash, salt, avatarValue, token, now, now);
        return { status: 200, profileToken: token, profile, avatar: avatarValue, username: name };
    }

    login(username, password) {
        const row = this._byUsername.get(String(username || '').trim());
        if (!row) return { status: 401, error: 'invalid username or password' };
        const candidate = scryptHash(String(password || ''), row.salt);
        const a = Buffer.from(candidate, 'hex');
        const b = Buffer.from(row.password_hash, 'hex');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return { status: 401, error: 'invalid username or password' };
        }
        const profile = this.profiles.authenticate(row.profile_token);
        if (!profile) return { status: 500, error: 'account profile missing' };
        this._touchLogin.run(Date.now(), row.id);
        return {
            status: 200,
            profileToken: row.profile_token,
            profile: this.profiles._public(profile),
            avatar: row.avatar,
            username: row.username
        };
    }

    // Resolves the account owning a profile bearer token — used by presence/
    // friends routes, which authenticate the same way every other /api/profile/*
    // route does (Authorization: Bearer <profileToken>).
    getByProfileToken(token) {
        if (typeof token !== 'string' || !token) return null;
        return this._byToken.get(token) || null;
    }

    usernameExists(username) {
        return !!this._byUsername.get(String(username || '').trim());
    }

    setAvatar(username, avatar) {
        const value = typeof avatar === 'string' ? avatar.slice(0, 64) : '';
        this._updateAvatar.run(value, String(username || '').trim());
        return value;
    }

    close() {
        this.db.close();
    }
}

module.exports = { AccountStore };
