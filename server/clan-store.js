'use strict';
// Server clans (accounts only): create, join by tag, leave (the oldest member
// inherits a clan whose owner leaves; the last one out disbands it), a small
// per-clan chat ring, a top list, and clan matches. A settled lobby match is a
// clan match when every winner is in one clan and every loser in another; each
// side's record then counts it. Persisted as one JSON file in DATA_DIR.
const fs = require('node:fs');
const crypto = require('node:crypto');

const LIMITS = Object.freeze({ clans: 5000, members: 50, chat: 50, chatLength: 160, recent: 10 });
const NAME = /^[\p{L}\p{N} _'-]{3,24}$/u;
const TAG = /^[A-Z0-9]{2,5}$/;
const UNSAFE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;
const CHAT_MIN_INTERVAL_MS = 1000;

const cleanText = (value, max) => String(value ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

class ClanStore {
    constructor(file = null, { now = () => Date.now() } = {}) {
        this.file = file;
        this.now = now;
        this.clans = {};      // id -> { id, name, tag, ownerId, members: [{ profileId, name, joinedAt }], createdAt, record, recent, chat }
        this.byMember = new Map();
        this._lastChat = new Map();
        this._load();
    }

    _load() {
        if (!this.file) return;
        try {
            const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            for (const clan of Object.values(stored?.clans || {})) {
                if (!clan || typeof clan.id !== 'string' || !TAG.test(clan.tag) || !Array.isArray(clan.members) || !clan.members.length) continue;
                this.clans[clan.id] = {
                    id: clan.id, name: cleanText(clan.name, 24), tag: clan.tag, ownerId: String(clan.ownerId),
                    members: clan.members.slice(0, LIMITS.members).map(m => ({ profileId: String(m.profileId), name: cleanText(m.name, 16) || 'Player', joinedAt: Number(m.joinedAt) || 0 })),
                    createdAt: Number(clan.createdAt) || 0,
                    record: { matches: Math.max(0, Number(clan.record?.matches) || 0), wins: Math.max(0, Number(clan.record?.wins) || 0), losses: Math.max(0, Number(clan.record?.losses) || 0) },
                    recent: Array.isArray(clan.recent) ? clan.recent.slice(-LIMITS.recent) : [],
                    chat: Array.isArray(clan.chat) ? clan.chat.slice(-LIMITS.chat) : []
                };
            }
        } catch { /* first start */ }
        for (const clan of Object.values(this.clans)) for (const member of clan.members) this.byMember.set(member.profileId, clan.id);
    }

    _save() {
        if (!this.file) return;
        try {
            const temp = `${this.file}.tmp`;
            fs.writeFileSync(temp, JSON.stringify({ clans: this.clans }));
            fs.renameSync(temp, this.file);
        } catch { /* keep serving from memory */ }
    }

    clanOf(profileId) {
        const id = this.byMember.get(String(profileId || ''));
        return id ? this.clans[id] || null : null;
    }

    _public(clan, viewerId = null) {
        if (!clan) return null;
        return {
            id: clan.id, name: clan.name, tag: clan.tag,
            members: clan.members.map(m => ({ name: m.name, role: m.profileId === clan.ownerId ? 'owner' : 'member', you: m.profileId === viewerId })),
            record: { ...clan.record },
            recent: clan.recent.map(entry => ({ ...entry }))
        };
    }

    mine(profile) {
        return this._public(this.clanOf(profile?.id), profile?.id);
    }

    create(profile, { name, tag } = {}) {
        if (!profile?.id) return { status: 401, error: 'account required', code: 'sign_in_required' };
        if (this.clanOf(profile.id)) return { status: 409, error: 'already in a clan', code: 'in_clan' };
        const cleanName = cleanText(name, 24);
        const cleanTag = String(tag ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (!NAME.test(cleanName)) return { status: 400, error: 'clan name must be 3-24 letters, digits or spaces', code: 'bad_name' };
        if (!TAG.test(cleanTag)) return { status: 400, error: 'tag must be 2-5 letters or digits', code: 'bad_tag' };
        if (Object.keys(this.clans).length >= LIMITS.clans) return { status: 429, error: 'clan limit reached', code: 'full' };
        const clash = Object.values(this.clans).find(c => c.tag === cleanTag || c.name.toLowerCase() === cleanName.toLowerCase());
        if (clash) return { status: 409, error: clash.tag === cleanTag ? 'tag taken' : 'name taken', code: clash.tag === cleanTag ? 'tag_taken' : 'name_taken' };
        const now = this.now();
        const clan = {
            id: `clan_${crypto.randomUUID()}`, name: cleanName, tag: cleanTag, ownerId: profile.id,
            members: [{ profileId: profile.id, name: cleanText(profile.playerName, 16) || 'Player', joinedAt: now }],
            createdAt: now, record: { matches: 0, wins: 0, losses: 0 }, recent: [], chat: []
        };
        this.clans[clan.id] = clan;
        this.byMember.set(profile.id, clan.id);
        this._save();
        return { status: 200, clan: this._public(clan, profile.id) };
    }

    join(profile, { tag } = {}) {
        if (!profile?.id) return { status: 401, error: 'account required', code: 'sign_in_required' };
        if (this.clanOf(profile.id)) return { status: 409, error: 'already in a clan', code: 'in_clan' };
        const cleanTag = String(tag ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const clan = Object.values(this.clans).find(c => c.tag === cleanTag);
        if (!clan) return { status: 404, error: 'no clan with that tag', code: 'not_found' };
        if (clan.members.length >= LIMITS.members) return { status: 409, error: 'clan is full', code: 'full' };
        clan.members.push({ profileId: profile.id, name: cleanText(profile.playerName, 16) || 'Player', joinedAt: this.now() });
        this.byMember.set(profile.id, clan.id);
        this._save();
        return { status: 200, clan: this._public(clan, profile.id) };
    }

    leave(profile) {
        const clan = this.clanOf(profile?.id);
        if (!clan) return { status: 404, error: 'not in a clan', code: 'not_in_clan' };
        clan.members = clan.members.filter(m => m.profileId !== profile.id);
        this.byMember.delete(profile.id);
        if (!clan.members.length) delete this.clans[clan.id];
        else if (clan.ownerId === profile.id) clan.ownerId = [...clan.members].sort((a, b) => a.joinedAt - b.joinedAt)[0].profileId;
        this._save();
        return { status: 200, left: clan.tag };
    }

    // Clans with clan matches rank by record; clans that have not played one yet
    // follow by size, so a fresh server still shows who is around.
    top(limit = 20) {
        return Object.values(this.clans)
            .sort((a, b) => (b.record.matches > 0) - (a.record.matches > 0)
                || b.record.wins - a.record.wins || a.record.losses - b.record.losses
                || b.members.length - a.members.length || a.createdAt - b.createdAt)
            .slice(0, Math.max(1, Math.min(50, limit)))
            .map((clan, index) => ({ rank: index + 1, name: clan.name, tag: clan.tag, members: clan.members.length, ...clan.record }));
    }

    // winners/losers: profile ids of a settled lobby match. Returns
    // { winner: tag, loser: tag } when it was a clan match, else null.
    recordClanMatch(winners = [], losers = []) {
        if (!winners.length || !losers.length) return null;
        const clanOfAll = ids => {
            const clans = new Set(ids.map(id => this.byMember.get(String(id))));
            return clans.size === 1 && !clans.has(undefined) ? this.clans[[...clans][0]] : null;
        };
        const winner = clanOfAll(winners);
        const loser = clanOfAll(losers);
        if (!winner || !loser || winner.id === loser.id) return null;
        const at = this.now();
        winner.record.matches++; winner.record.wins++;
        loser.record.matches++; loser.record.losses++;
        winner.recent = [...winner.recent, { vs: loser.tag, won: true, at }].slice(-LIMITS.recent);
        loser.recent = [...loser.recent, { vs: winner.tag, won: false, at }].slice(-LIMITS.recent);
        this._save();
        return { winner: winner.tag, loser: loser.tag };
    }

    chat(profile, afterId = 0) {
        const clan = this.clanOf(profile?.id);
        if (!clan) return { status: 404, error: 'not in a clan', code: 'not_in_clan' };
        const after = Math.max(0, Math.floor(Number(afterId) || 0));
        return { status: 200, messages: clan.chat.filter(m => m.id > after) };
    }

    post(profile, text) {
        const clan = this.clanOf(profile?.id);
        if (!clan) return { status: 404, error: 'not in a clan', code: 'not_in_clan' };
        const clean = cleanText(text, LIMITS.chatLength);
        if (!clean) return { status: 400, error: 'empty message', code: 'empty' };
        const now = this.now();
        if (now - (this._lastChat.get(profile.id) || -Infinity) < CHAT_MIN_INTERVAL_MS) return { status: 429, error: 'slow down', code: 'rate_limited' };
        this._lastChat.set(profile.id, now);
        const message = { id: (clan.chat.at(-1)?.id || 0) + 1, at: now, author: cleanText(profile.playerName, 16) || 'Player', text: clean };
        clan.chat = [...clan.chat, message].slice(-LIMITS.chat);
        this._save();
        return { status: 200, message };
    }
}

module.exports = { ClanStore, CLAN_LIMITS: LIMITS };
