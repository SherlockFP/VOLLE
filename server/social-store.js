const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const MESSAGE_MAX_LENGTH = 500;
const MESSAGE_RETENTION_PER_CONVERSATION = 500;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function pair(a, b) {
    return a < b ? [a, b] : [b, a];
}

function messageText(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length >= 1 && text.length <= MESSAGE_MAX_LENGTH ? text : null;
}

class SocialStore {
    constructor(dbPath, { now = () => Date.now() } = {}) {
        this.now = now;
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA foreign_keys = ON');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id TEXT PRIMARY KEY,
                sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'cancelled')),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(sender_account_id, recipient_account_id)
            );
            CREATE INDEX IF NOT EXISTS friend_requests_recipient_idx ON friend_requests(recipient_account_id, status, updated_at DESC);
            CREATE TABLE IF NOT EXISTS friendships (
                account_low_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                account_high_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                PRIMARY KEY(account_low_id, account_high_id),
                CHECK(account_low_id < account_high_id)
            );
            CREATE TABLE IF NOT EXISTS direct_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                CHECK(length(body) BETWEEN 1 AND 500)
            );
            CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON direct_messages(sender_account_id, recipient_account_id, id DESC);
            CREATE TABLE IF NOT EXISTS lobby_invites (
                id TEXT PRIMARY KEY,
                sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                lobby_code TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'expired')),
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS lobby_invites_recipient_idx ON lobby_invites(recipient_account_id, status, expires_at DESC);
        `);
        this._accountByTag = this.db.prepare('SELECT id, username, avatar, friend_tag FROM accounts WHERE friend_tag = ? COLLATE NOCASE');
        this._accountById = this.db.prepare('SELECT id, username, avatar, friend_tag FROM accounts WHERE id = ?');
        this._friendship = this.db.prepare('SELECT 1 FROM friendships WHERE account_low_id = ? AND account_high_id = ?');
        this._insertFriendship = this.db.prepare('INSERT OR IGNORE INTO friendships (account_low_id, account_high_id, created_at) VALUES (?, ?, ?)');
        this._request = this.db.prepare('SELECT * FROM friend_requests WHERE sender_account_id = ? AND recipient_account_id = ?');
        this._insertRequest = this.db.prepare('INSERT INTO friend_requests (id, sender_account_id, recipient_account_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        this._updateRequest = this.db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?');
        this._requestById = this.db.prepare('SELECT * FROM friend_requests WHERE id = ?');
        this._requestsFor = this.db.prepare(`
            SELECT r.*, s.username AS sender_username, s.friend_tag AS sender_friend_tag,
                p.username AS recipient_username, p.friend_tag AS recipient_friend_tag
            FROM friend_requests r
            JOIN accounts s ON s.id = r.sender_account_id
            JOIN accounts p ON p.id = r.recipient_account_id
            WHERE r.sender_account_id = ? OR r.recipient_account_id = ?
            ORDER BY r.updated_at DESC LIMIT 100
        `);
        this._friendsFor = this.db.prepare(`
            SELECT a.id, a.username, a.avatar, a.friend_tag, f.created_at
            FROM friendships f JOIN accounts a ON a.id = CASE WHEN f.account_low_id = ? THEN f.account_high_id ELSE f.account_low_id END
            WHERE f.account_low_id = ? OR f.account_high_id = ? ORDER BY a.username COLLATE NOCASE LIMIT 200
        `);
        this._deleteFriendship = this.db.prepare('DELETE FROM friendships WHERE account_low_id = ? AND account_high_id = ?');
        this._insertMessage = this.db.prepare('INSERT INTO direct_messages (sender_account_id, recipient_account_id, body, created_at) VALUES (?, ?, ?, ?)');
        this._messages = this.db.prepare(`
            SELECT * FROM direct_messages
            WHERE ((sender_account_id = ? AND recipient_account_id = ?) OR (sender_account_id = ? AND recipient_account_id = ?))
                AND id < ? ORDER BY id DESC LIMIT ?
        `);
        this._trimMessages = this.db.prepare(`
            DELETE FROM direct_messages WHERE id IN (
                SELECT id FROM direct_messages
                WHERE (sender_account_id = ? AND recipient_account_id = ?) OR (sender_account_id = ? AND recipient_account_id = ?)
                ORDER BY id DESC LIMIT -1 OFFSET ?
            )
        `);
        this._expireInvites = this.db.prepare("UPDATE lobby_invites SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at <= ?");
        this._pendingInvite = this.db.prepare("SELECT * FROM lobby_invites WHERE sender_account_id = ? AND recipient_account_id = ? AND lobby_code = ? AND status = 'pending' AND expires_at > ?");
        this._insertInvite = this.db.prepare('INSERT INTO lobby_invites (id, sender_account_id, recipient_account_id, lobby_code, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        this._inviteById = this.db.prepare('SELECT * FROM lobby_invites WHERE id = ?');
        this._updateInvite = this.db.prepare('UPDATE lobby_invites SET status = ?, updated_at = ? WHERE id = ?');
        this._invitesFor = this.db.prepare(`
            SELECT i.*, s.username AS sender_username, s.friend_tag AS sender_friend_tag,
                p.username AS recipient_username, p.friend_tag AS recipient_friend_tag
            FROM lobby_invites i
            JOIN accounts s ON s.id = i.sender_account_id
            JOIN accounts p ON p.id = i.recipient_account_id
            WHERE i.sender_account_id = ? OR i.recipient_account_id = ? ORDER BY i.updated_at DESC LIMIT 100
        `);
    }

    _publicAccount(row) { return row && { id: row.id, username: row.username, avatar: row.avatar || '', friendTag: row.friend_tag }; }
    _friendPair(a, b) { return pair(a, b); }
    areFriends(a, b) { const [low, high] = this._friendPair(a, b); return !!this._friendship.get(low, high); }

    getMe(accountId) {
        const account = this._publicAccount(this._accountById.get(accountId));
        if (!account) return null;
        return { account, friends: this.listFriends(accountId), requests: this.listRequests(accountId), invites: this.listInvites(accountId) };
    }

    createFriendRequest(senderId, friendTag) {
        const recipient = this._accountByTag.get(String(friendTag || '').trim());
        // Non-enumerating: unknown/malformed tags have the same public result.
        if (!recipient || recipient.id === senderId) return { status: 202, generic: true };
        if (this.areFriends(senderId, recipient.id)) return { status: 200, state: 'friends', friend: this._publicAccount(recipient) };
        const existing = this._request.get(senderId, recipient.id);
        if (existing?.status === 'pending') return { status: 200, state: 'pending', request: this._publicRequest(existing) };
        const reverse = this._request.get(recipient.id, senderId);
        if (reverse?.status === 'pending') return { status: 200, state: 'incoming_pending', request: this._publicRequest(reverse) };
        const now = this.now();
        if (existing) this._updateRequest.run('pending', now, existing.id);
        else this._insertRequest.run(crypto.randomUUID(), senderId, recipient.id, 'pending', now, now);
        return { status: 201, state: 'pending', friend: this._publicAccount(recipient) };
    }

    _publicRequest(row) { return { id: row.id, senderAccountId: row.sender_account_id, recipientAccountId: row.recipient_account_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }

    listRequests(accountId) {
        return this._requestsFor.all(accountId, accountId).map(row => ({
            ...this._publicRequest(row),
            sender: { id: row.sender_account_id, username: row.sender_username, friendTag: row.sender_friend_tag },
            recipient: { id: row.recipient_account_id, username: row.recipient_username, friendTag: row.recipient_friend_tag }
        }));
    }

    actOnFriendRequest(accountId, requestId, action) {
        const row = this._requestById.get(String(requestId || ''));
        if (!row || row.status !== 'pending') return { status: 404, error: 'request unavailable' };
        const now = this.now();
        if (action === 'accept' && row.recipient_account_id === accountId) {
            const [low, high] = this._friendPair(row.sender_account_id, row.recipient_account_id);
            this.db.exec('BEGIN');
            try { this._insertFriendship.run(low, high, now); this._updateRequest.run('accepted', now, row.id); this.db.exec('COMMIT'); }
            catch (error) { this.db.exec('ROLLBACK'); throw error; }
            return { status: 200, state: 'accepted' };
        }
        if (action === 'decline' && row.recipient_account_id === accountId) { this._updateRequest.run('declined', now, row.id); return { status: 200, state: 'declined' }; }
        if (action === 'cancel' && row.sender_account_id === accountId) { this._updateRequest.run('cancelled', now, row.id); return { status: 200, state: 'cancelled' }; }
        return { status: 403, error: 'action not allowed' };
    }

    listFriends(accountId) { return this._friendsFor.all(accountId, accountId, accountId).map(row => this._publicAccount(row)); }
    removeFriend(accountId, friendId) {
        if (!this._accountById.get(friendId)) return { status: 404, error: 'friend unavailable' };
        const [low, high] = this._friendPair(accountId, friendId);
        return this._deleteFriendship.run(low, high).changes ? { status: 200 } : { status: 404, error: 'friend unavailable' };
    }

    listMessages(accountId, friendId, { beforeId, limit } = {}) {
        if (!this.areFriends(accountId, friendId)) return { status: 403, error: 'friends only' };
        const cursor = Number.isSafeInteger(Number(beforeId)) && Number(beforeId) > 0 ? Number(beforeId) : Number.MAX_SAFE_INTEGER;
        const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
        const rows = this._messages.all(accountId, friendId, friendId, accountId, cursor, safeLimit + 1);
        const hasMore = rows.length > safeLimit;
        const page = rows.slice(0, safeLimit).reverse().map(row => ({ id: row.id, senderAccountId: row.sender_account_id, recipientAccountId: row.recipient_account_id, body: row.body, createdAt: row.created_at }));
        return { status: 200, messages: page, nextBeforeId: hasMore ? String(rows[safeLimit - 1].id) : null };
    }

    sendMessage(accountId, friendId, body) {
        if (!this.areFriends(accountId, friendId)) return { status: 403, error: 'friends only' };
        const text = messageText(body);
        if (!text) return { status: 400, error: `message must be 1-${MESSAGE_MAX_LENGTH} characters` };
        const now = this.now();
        const result = this._insertMessage.run(accountId, friendId, text, now);
        this._trimMessages.run(accountId, friendId, friendId, accountId, MESSAGE_RETENTION_PER_CONVERSATION);
        return { status: 201, message: { id: Number(result.lastInsertRowid), senderAccountId: accountId, recipientAccountId: friendId, body: text, createdAt: now } };
    }

    _expire() { const now = this.now(); this._expireInvites.run(now, now); return now; }
    _publicInvite(row) { return { id: row.id, senderAccountId: row.sender_account_id, recipientAccountId: row.recipient_account_id, lobbyCode: row.lobby_code, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at }; }

    createLobbyInvite(senderId, recipientId, lobbyCode) {
        const now = this._expire();
        if (!recipientId || recipientId === senderId || !this.areFriends(senderId, recipientId)) return { status: 403, error: 'friends only' };
        const existing = this._pendingInvite.get(senderId, recipientId, lobbyCode, now);
        if (existing) return { status: 200, invite: this._publicInvite(existing), replayed: true };
        const id = crypto.randomUUID();
        const expiresAt = now + INVITE_TTL_MS;
        this._insertInvite.run(id, senderId, recipientId, lobbyCode, 'pending', expiresAt, now, now);
        return { status: 201, invite: { id, senderAccountId: senderId, recipientAccountId: recipientId, lobbyCode, status: 'pending', expiresAt, createdAt: now, updatedAt: now }, replayed: false };
    }

    listInvites(accountId) {
        this._expire();
        return this._invitesFor.all(accountId, accountId).map(row => ({
            ...this._publicInvite(row),
            sender: { id: row.sender_account_id, username: row.sender_username, friendTag: row.sender_friend_tag },
            recipient: { id: row.recipient_account_id, username: row.recipient_username, friendTag: row.recipient_friend_tag }
        }));
    }

    actOnLobbyInvite(accountId, inviteId, action) {
        this._expire();
        const row = this._inviteById.get(String(inviteId || ''));
        if (!row || row.status !== 'pending') return { status: 404, error: 'invite unavailable' };
        if (row.recipient_account_id !== accountId || !['accept', 'decline'].includes(action)) return { status: 403, error: 'action not allowed' };
        const state = action === 'accept' ? 'accepted' : 'declined';
        this._updateInvite.run(state, this.now(), row.id);
        return { status: 200, state, lobbyCode: row.lobby_code };
    }

    close() { this.db.close(); }
}

module.exports = { SocialStore, INVITE_TTL_MS, MESSAGE_MAX_LENGTH, MESSAGE_RETENTION_PER_CONVERSATION };
