// Account identity is separate from the internal ProfileStore bearer. Profiles
// retain their old token for store compatibility; browser/API sessions use only
// hashed, revocable account-session tokens.
const crypto = require('crypto');
const { promisify } = require('util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const SCRYPT_KEYLEN = 64;
const PASSWORD_MAX_LENGTH = 256;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 8;
const MAX_KDF_CONCURRENCY = 4;
const MAX_KDF_QUEUE = 16;

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function scryptHash(password, salt) {
    return (await scrypt(password, salt, SCRYPT_KEYLEN)).toString('hex');
}

function safeEqualHex(left, right) {
    const a = Buffer.from(String(left || ''), 'hex');
    const b = Buffer.from(String(right || ''), 'hex');
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function friendCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

class AccountStore {
    constructor(dbPath, profileStore, { now = () => Date.now() } = {}) {
        this.profiles = profileStore;
        this.now = now;
        this.dbPath = dbPath;
        this._kdfActive = 0;
        this._kdfQueue = [];
        this._dummySalt = crypto.randomBytes(16).toString('hex');
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON');
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
        this._migrateAccounts();
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS account_sessions (
                token_hash TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS account_sessions_active_idx
                ON account_sessions(account_id, revoked_at, expires_at, created_at);
        `);
        this._insert = this.db.prepare(
            'INSERT INTO accounts (id, username, password_hash, salt, avatar, profile_token, friend_code, friend_tag, created_at, last_login) '
            + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        this._byUsername = this.db.prepare('SELECT * FROM accounts WHERE username = ?');
        this._byFriendTag = this.db.prepare('SELECT * FROM accounts WHERE friend_tag = ? COLLATE NOCASE');
        this._byProfileToken = this.db.prepare('SELECT * FROM accounts WHERE profile_token = ?');
        this._byId = this.db.prepare('SELECT * FROM accounts WHERE id = ?');
        this._touchLogin = this.db.prepare('UPDATE accounts SET last_login = ? WHERE id = ?');
        this._updateAvatar = this.db.prepare('UPDATE accounts SET avatar = ? WHERE username = ?');
        this._insertSession = this.db.prepare('INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
        this._sessionByHash = this.db.prepare(`
            SELECT s.token_hash, s.account_id, s.expires_at, a.*
            FROM account_sessions s JOIN accounts a ON a.id = s.account_id
            WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        `);
        this._revoke = this.db.prepare('UPDATE account_sessions SET revoked_at = ? WHERE token_hash = ? AND account_id = ? AND revoked_at IS NULL');
        this._deleteExpired = this.db.prepare('DELETE FROM account_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL');
        this._trimSessions = this.db.prepare(`
            DELETE FROM account_sessions WHERE token_hash IN (
                SELECT token_hash FROM account_sessions
                WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ?
                ORDER BY created_at DESC LIMIT -1 OFFSET ?
            )
        `);
    }

    _migrateAccounts() {
        const columns = new Set(this.db.prepare('PRAGMA table_info(accounts)').all().map(column => column.name));
        if (!columns.has('friend_code')) this.db.exec("ALTER TABLE accounts ADD COLUMN friend_code TEXT NOT NULL DEFAULT ''");
        if (!columns.has('friend_tag')) this.db.exec("ALTER TABLE accounts ADD COLUMN friend_tag TEXT NOT NULL DEFAULT ''");
        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_friend_code_unique ON accounts(friend_code) WHERE friend_code <> \'\'');
        this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS accounts_friend_tag_unique ON accounts(friend_tag COLLATE NOCASE) WHERE friend_tag <> \'\'');
        const missing = this.db.prepare("SELECT id, username FROM accounts WHERE friend_code = '' OR friend_tag = ''").all();
        const update = this.db.prepare('UPDATE accounts SET friend_code = ?, friend_tag = ? WHERE id = ?');
        for (const row of missing) {
            let code = friendCode();
            while (this.db.prepare('SELECT 1 FROM accounts WHERE friend_code = ?').get(code)) code = friendCode();
            update.run(code, `${row.username}#${code}`, row.id);
        }
    }

    _publicAccount(row) {
        if (!row) return null;
        return { id: row.id, username: row.username, avatar: row.avatar || '', friendTag: row.friend_tag };
    }

    _issueSession(accountId) {
        const now = this.now();
        const sessionToken = crypto.randomBytes(32).toString('base64url');
        this._deleteExpired.run(now);
        this._insertSession.run(hashToken(sessionToken), accountId, now, now + SESSION_TTL_MS);
        this._trimSessions.run(accountId, now, MAX_ACTIVE_SESSIONS);
        return sessionToken;
    }

    async _derivePassword(password, salt) {
        if (this._kdfActive >= MAX_KDF_CONCURRENCY) {
            if (this._kdfQueue.length >= MAX_KDF_QUEUE) {
                const error = new Error('authentication busy');
                error.code = 'KDF_BUSY';
                throw error;
            }
            await new Promise(resolve => this._kdfQueue.push(resolve));
        }
        this._kdfActive += 1;
        try { return await scryptHash(password, salt); }
        finally {
            this._kdfActive -= 1;
            this._kdfQueue.shift()?.();
        }
    }

    async register(username, password, avatar) {
        const name = String(username || '').trim();
        if (!USERNAME_RE.test(name)) return { status: 400, error: 'username must be 3-20 letters, numbers, or underscores' };
        if (typeof password !== 'string' || password.length < 8 || password.length > PASSWORD_MAX_LENGTH) {
            return { status: 400, error: `password must be 8-${PASSWORD_MAX_LENGTH} characters` };
        }
        if (this._byUsername.get(name)) return { status: 409, error: 'username already taken' };
        const salt = crypto.randomBytes(16).toString('hex');
        let passwordHash;
        try { passwordHash = await this._derivePassword(password, salt); }
        catch (error) {
            if (error?.code === 'KDF_BUSY') return { status: 503, error: 'authentication busy; retry shortly' };
            throw error;
        }
        // Re-check after the asynchronous KDF so two requests cannot create a duplicate.
        if (this._byUsername.get(name)) return { status: 409, error: 'username already taken' };
        const avatarValue = typeof avatar === 'string' ? avatar.slice(0, 64) : '';
        const { token: profileToken, profile } = this.profiles.create(name, null);
        const id = crypto.randomUUID();
        let code = friendCode();
        while (this.db.prepare('SELECT 1 FROM accounts WHERE friend_code = ?').get(code)) code = friendCode();
        const now = this.now();
        try {
            this._insert.run(id, name, passwordHash, salt, avatarValue, profileToken, code, `${name}#${code}`, now, now);
        } catch (error) {
            // A unique username collision is safe to report; no password/hash details leak.
            if (String(error?.message || '').includes('accounts.username')) return { status: 409, error: 'username already taken' };
            throw error;
        }
        const account = this._byId.get(id);
        return { status: 201, sessionToken: this._issueSession(id), profile, account: this._publicAccount(account) };
    }

    async login(username, password) {
        const row = this._byUsername.get(String(username || '').trim());
        if (typeof password !== 'string' || password.length > PASSWORD_MAX_LENGTH) {
            return { status: 401, error: 'invalid credentials' };
        }
        let candidate;
        try { candidate = await this._derivePassword(password, row?.salt || this._dummySalt); }
        catch (error) {
            if (error?.code === 'KDF_BUSY') return { status: 503, error: 'authentication busy; retry shortly' };
            throw error;
        }
        if (!row) return { status: 401, error: 'invalid credentials' };
        if (!safeEqualHex(candidate, row.password_hash)) return { status: 401, error: 'invalid credentials' };
        const profile = this.profiles.authenticate(row.profile_token);
        if (!profile) return { status: 500, error: 'account profile missing' };
        this._touchLogin.run(this.now(), row.id);
        return {
            status: 200,
            sessionToken: this._issueSession(row.id),
            profile: this.profiles._public(profile),
            account: this._publicAccount(row)
        };
    }

    resolveSession(sessionToken) {
        if (typeof sessionToken !== 'string' || sessionToken.length < 32 || sessionToken.length > 256) return null;
        const row = this._sessionByHash.get(hashToken(sessionToken), this.now());
        if (!row) return null;
        const profile = this.profiles.authenticate(row.profile_token);
        if (!profile) return null;
        return { account: this._publicAccount(row), profile, profileToken: row.profile_token, expiresAt: row.expires_at };
    }

    logout(sessionToken, accountId) {
        if (typeof sessionToken !== 'string' || !accountId) return false;
        return this._revoke.run(this.now(), hashToken(sessionToken), accountId).changes > 0;
    }

    getByProfileToken(token) {
        if (typeof token !== 'string' || !token) return null;
        return this._publicAccount(this._byProfileToken.get(token));
    }

    getById(id) { return this._publicAccount(this._byId.get(String(id || ''))); }
    getByFriendTag(tag) { return this._publicAccount(this._byFriendTag.get(String(tag || '').trim())); }
    usernameExists(username) { return !!this._byUsername.get(String(username || '').trim()); }

    setAvatar(username, avatar) {
        const value = typeof avatar === 'string' ? avatar.slice(0, 64) : '';
        this._updateAvatar.run(value, String(username || '').trim());
        return value;
    }

    close() { this.db.close(); }
}

module.exports = {
    AccountStore,
    MAX_ACTIVE_SESSIONS,
    MAX_KDF_CONCURRENCY,
    MAX_KDF_QUEUE,
    PASSWORD_MAX_LENGTH,
    SESSION_TTL_MS,
    hashToken
};
