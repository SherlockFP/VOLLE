'use strict';
// Main-menu global chat: an in-memory ring of recent messages (no persistence).
// Anyone reads; accounts and guest lobby sessions post. Text is stored as sent:
// the slur/swear filter runs on each reader so the player's setting decides.
// Lobby invites are only accepted from the lobby's own host.

const DEFAULTS = Object.freeze({
    capacity: 100,
    maxLength: 200,
    minIntervalMs: 1500,
    burst: 5,
    burstWindowMs: 20000,
    duplicateWindowMs: 15000,
    inviteCooldownMs: 30000,
    pageSize: 50
});

// C0 controls, DEL, zero-width/bidi marks and line/paragraph separators.
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

function cleanText(value, maxLength) {
    return String(value ?? '')
        .replace(CONTROL_CHARS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function inviteSnapshot(lobby) {
    const number = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : fallback);
    return {
        code: String(lobby.code).slice(0, 64),
        name: cleanText(lobby.name, 32) || 'Lobby',
        mode: cleanText(lobby.mode, 24),
        map: cleanText(lobby.map, 32),
        players: number(lobby.players, 1),
        maxPlayers: number(lobby.maxPlayers, 0),
        locked: lobby.locked === true,
        ranked: lobby.ranked === true
    };
}

class GlobalChat {
    constructor(options = {}) {
        this.options = { ...DEFAULTS, ...options };
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.messages = [];
        this.nextId = 1;
        this.authors = new Map(); // authorId -> { last, recent: [], lastText, invites: Map(code -> at) }
    }

    _author(id) {
        let state = this.authors.get(id);
        if (!state) {
            state = { last: -Infinity, recent: [], lastText: '', lastTextAt: -Infinity, invites: new Map() };
            this.authors.set(id, state);
            if (this.authors.size > 5000) this.authors.delete(this.authors.keys().next().value);
        }
        return state;
    }

    _rateLimited(state, now) {
        const { minIntervalMs, burst, burstWindowMs } = this.options;
        if (now - state.last < minIntervalMs) return true;
        state.recent = state.recent.filter(at => now - at < burstWindowMs);
        return state.recent.length >= burst;
    }

    _push(author, body, now) {
        const message = {
            id: this.nextId++,
            at: now,
            author: cleanText(author.name, 24) || 'Player',
            guest: author.guest === true,
            ...body
        };
        this.messages.push(message);
        if (this.messages.length > this.options.capacity) this.messages.splice(0, this.messages.length - this.options.capacity);
        return message;
    }

    // author: { id, name, guest }. Returns { status, message } or { status, error, code }.
    post(author, { text } = {}) {
        if (!author?.id) return { status: 401, error: 'unauthorized', code: 'sign_in_required' };
        const now = this.now();
        const clean = cleanText(text, this.options.maxLength);
        if (!clean) return { status: 400, error: 'empty message', code: 'empty' };
        const state = this._author(author.id);
        if (this._rateLimited(state, now)) return { status: 429, error: 'slow down', code: 'rate_limited' };
        if (clean.toLowerCase() === state.lastText && now - state.lastTextAt < this.options.duplicateWindowMs) {
            return { status: 409, error: 'duplicate message', code: 'duplicate' };
        }
        state.last = now;
        state.recent.push(now);
        state.lastText = clean.toLowerCase();
        state.lastTextAt = now;
        return { status: 200, message: this._push(author, { kind: 'text', text: clean }, now) };
    }

    // lobby: the registry record (server.js lobbies map). Only its host may invite.
    postInvite(author, lobby) {
        if (!author?.id) return { status: 401, error: 'unauthorized', code: 'sign_in_required' };
        if (!lobby) return { status: 404, error: 'lobby unavailable', code: 'lobby_unavailable' };
        if (lobby.ownerAccountId !== author.id) return { status: 403, error: 'only the host can share this lobby', code: 'not_host' };
        const now = this.now();
        const state = this._author(author.id);
        if (this._rateLimited(state, now)) return { status: 429, error: 'slow down', code: 'rate_limited' };
        const lastInvite = state.invites.get(lobby.code) ?? -Infinity;
        if (now - lastInvite < this.options.inviteCooldownMs) return { status: 429, error: 'already shared', code: 'invite_cooldown' };
        state.last = now;
        state.recent.push(now);
        state.invites.set(lobby.code, now);
        if (state.invites.size > 20) state.invites.delete(state.invites.keys().next().value);
        return { status: 200, message: this._push(author, { kind: 'invite', invite: inviteSnapshot(lobby) }, now) };
    }

    // Messages newer than `afterId` (or the latest page when afterId is 0/absent).
    since(afterId = 0) {
        const after = Math.max(0, Math.floor(Number(afterId) || 0));
        const list = after > 0 ? this.messages.filter(message => message.id > after) : this.messages;
        return { messages: list.slice(-this.options.pageSize), latestId: this.nextId - 1 };
    }
}

module.exports = { GlobalChat, cleanText };
