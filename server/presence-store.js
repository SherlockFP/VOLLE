// server/presence-store.js — ponytail: in-memory online-heartbeat map for the
// friends sidebar, same shape as server.js's lobbies/socialHubs Maps. This is
// a display hint only (client polls it to show a green dot) — it never
// carries match state, which stays fully P2P via js/network.js.
const PRESENCE_TTL_MS = 45000; // client heartbeats every ~20s; 2 missed beats = offline

class PresenceStore {
    constructor(ttlMs = PRESENCE_TTL_MS) {
        this.ttlMs = ttlMs;
        this.online = new Map(); // username (lowercase) -> { username, avatar, lastSeen }
    }

    heartbeat(username, avatar) {
        if (!username) return;
        this.online.set(String(username).toLowerCase(), {
            username,
            avatar: typeof avatar === 'string' ? avatar : '',
            lastSeen: Date.now()
        });
    }

    prune() {
        const cutoff = Date.now() - this.ttlMs;
        for (const [key, entry] of this.online) {
            if (entry.lastSeen < cutoff) this.online.delete(key);
        }
    }

    status(usernames) {
        this.prune();
        return usernames.map(name => {
            const entry = this.online.get(String(name || '').toLowerCase());
            return { username: name, online: !!entry, avatar: entry?.avatar || '' };
        });
    }
}

module.exports = { PresenceStore };
