// leaderboard.js — real ranked/season/wins leaderboard, backed by the
// server's authoritative ELO/season records (server/profile-store.js).
// ponytail: this used to be 50 seeded fake bots in localStorage next to the
// real player — deceptive and useless. Replaced with a thin fetch client:
// no bots, no local roster, server is the only source of truth.
import { account } from './account.js';

// One-time migration: delete the old fake-roster cache so it never
// resurfaces or confuses a stale reload.
const LEGACY_LEADERBOARD_KEY = 'dodgball_leaderboard_v1';
try { globalThis.localStorage?.removeItem(LEGACY_LEADERBOARD_KEY); } catch {}

export const LEADERBOARD_BOARDS = Object.freeze(['ranked', 'season', 'wins']);
const DEFAULT_LIMIT = 50;
// Purely a client-side de-dupe against click-spam; the server's own cache
// window (server.js LEADERBOARD_CACHE_TTL) is the real source of freshness.
const CLIENT_CACHE_MS = 15000;

function normalizeBoard(board) {
    return LEADERBOARD_BOARDS.includes(board) ? board : 'ranked';
}

class LeaderboardClass {
    constructor({ fetchImpl = (...args) => globalThis.fetch?.(...args) } = {}) {
        this.fetchImpl = fetchImpl;
        this._cache = new Map(); // `${board}:${limit}:${around}` -> { at, data }
        this._inflight = new Map();
    }

    // The signed-in account's bearer token ('' for guests), for boards read elsewhere.
    token() {
        return account.getToken?.() || '';
    }

    // Fetches one board. Never throws — failures resolve with { ok: false }
    // so a render call can always show a loading/error/offline state.
    async fetchBoard(board = 'ranked', { limit = DEFAULT_LIMIT, around = true, force = false } = {}) {
        const normalized = normalizeBoard(board);
        const boundedLimit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || DEFAULT_LIMIT));
        const key = `${normalized}:${boundedLimit}:${around ? 1 : 0}`;
        const cached = this._cache.get(key);
        if (!force && cached && Date.now() - cached.at < CLIENT_CACHE_MS) return cached.data;
        if (this._inflight.has(key)) return this._inflight.get(key);
        const request = this._load(normalized, boundedLimit, around)
            .then(data => {
                if (data.ok) this._cache.set(key, { at: Date.now(), data });
                return data;
            })
            .finally(() => this._inflight.delete(key));
        this._inflight.set(key, request);
        return request;
    }

    async _load(board, limit, around) {
        if (typeof this.fetchImpl !== 'function') {
            return { ok: false, offline: true, error: 'Leaderboard unavailable offline.', board, entries: [], me: null };
        }
        try {
            const params = new URLSearchParams({ board, season: 'current', limit: String(limit) });
            if (around) params.set('around', 'me');
            const headers = {};
            const token = around ? account.getToken?.() : '';
            if (token) headers.Authorization = `Bearer ${token}`;
            const response = await this.fetchImpl(`/api/leaderboard?${params.toString()}`, { headers });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                return { ok: false, error: body.error || `Leaderboard request failed (${response.status}).`, board, entries: [], me: null };
            }
            return {
                ok: true,
                board: normalizeBoard(body.board),
                season: body.season || 'current',
                total: Number.isFinite(body.total) ? body.total : 0,
                generatedAt: body.generatedAt || 0,
                entries: Array.isArray(body.entries) ? body.entries : [],
                me: body.me || null
            };
        } catch {
            return { ok: false, offline: true, error: 'Could not reach the leaderboard service.', board, entries: [], me: null };
        }
    }

    // Guest = playing without a signed-in account; the server never ranks
    // sessions it can't authenticate, so guests are told to sign up instead
    // of being shown a misleading position.
    isGuest() {
        return !account.isLoggedIn?.();
    }

    invalidate() { this._cache.clear(); }
}

export const Leaderboard = new LeaderboardClass();
