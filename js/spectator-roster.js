// spectator-roster.js — who is watching and where they sit. Pure (no THREE/DOM).
// The host owns the roster (seat assignment, moves); clients mirror the host's list
// from lobbyState/welcome. Spectators are never players: they are not in
// game.remotePlayers, getPlayerList(), getAllTargets() or the scoreboard.
import { findFreeSeat, isValidSeatIndex } from './spectator-seats.js';

export const MAX_SPECTATOR_LIST = 64;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function safeId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && ID_PATTERN.test(value)
        ? value
        : null;
}

function safeName(value) {
    const name = String(value ?? '').trim().slice(0, 32);
    return name || 'Spectator';
}

// Untrusted wire list → bounded, de-duplicated entries with seat indices in range
// (-1 when the seat does not exist on this client's map).
export function sanitizeSpectatorList(list, seatCount = 0) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seenIds = new Set();
    const seenSeats = new Set();
    for (const raw of list.slice(0, MAX_SPECTATOR_LIST)) {
        const playerId = safeId(raw?.playerId);
        if (!playerId || seenIds.has(playerId)) continue;
        seenIds.add(playerId);
        let seat = Number.isSafeInteger(raw?.seat) && raw.seat >= 0 && raw.seat < seatCount ? raw.seat : -1;
        if (seat >= 0 && seenSeats.has(seat)) seat = -1;
        if (seat >= 0) seenSeats.add(seat);
        out.push({ playerId, name: safeName(raw?.name), seat });
    }
    return out;
}

export class SpectatorRoster {
    constructor() {
        this.entries = new Map(); // playerId -> { playerId, name, peerId, seat }
    }

    get size() {
        return this.entries.size;
    }

    get(playerId) {
        return this.entries.get(playerId) || null;
    }

    has(playerId) {
        return this.entries.has(playerId);
    }

    occupied(exceptId = null) {
        const seats = new Set();
        for (const entry of this.entries.values()) {
            if (entry.playerId !== exceptId && entry.seat >= 0) seats.add(entry.seat);
        }
        return seats;
    }

    // Host: new spectator — fill the two sidelines alternately, front row first.
    add(playerId, name, peerId, seats = []) {
        const id = safeId(playerId);
        if (!id) return null;
        const existing = this.entries.get(id);
        if (existing) return existing;
        const preferredSide = this.entries.size % 2 === 0 ? 'west' : 'east';
        const entry = {
            playerId: id,
            name: safeName(name),
            peerId: safeId(peerId) || id,
            seat: findFreeSeat(seats, this.occupied(), preferredSide)
        };
        this.entries.set(id, entry);
        return entry;
    }

    remove(playerId) {
        return this.entries.delete(playerId);
    }

    // Host: validated seat change — the seat must exist and be free.
    move(playerId, seat, seats = []) {
        const entry = this.entries.get(playerId);
        if (!entry || !isValidSeatIndex(seats, seat)) return false;
        if (entry.seat === seat) return true;
        if (this.occupied(playerId).has(seat)) return false;
        entry.seat = seat;
        return true;
    }

    // Host: after a map change the seat list changes; keep valid seats, re-seat the rest.
    reseat(seats = []) {
        let changed = false;
        const taken = new Set();
        for (const entry of this.entries.values()) {
            if (isValidSeatIndex(seats, entry.seat) && !taken.has(entry.seat)) {
                taken.add(entry.seat);
                continue;
            }
            const seat = findFreeSeat(seats, taken, taken.size % 2 === 0 ? 'west' : 'east');
            if (seat !== entry.seat) changed = true;
            entry.seat = seat;
            if (seat >= 0) taken.add(seat);
        }
        return changed;
    }

    // Client: mirror the host's list.
    apply(list, seats = []) {
        const clean = sanitizeSpectatorList(list, seats.length);
        const next = new Map();
        for (const entry of clean) {
            const previous = this.entries.get(entry.playerId);
            next.set(entry.playerId, { ...entry, peerId: previous?.peerId || entry.playerId });
        }
        this.entries = next;
        return clean;
    }

    list() {
        return [...this.entries.values()].map(({ playerId, name, seat }) => ({ playerId, name, seat }));
    }

    clear() {
        this.entries.clear();
    }
}
